'use strict';

// POTACAT Cloud — desktop-side tunnel manager.
//
// Owns:
//   - persisted state file (userData/cloud-tunnel.json)
//   - in-memory state machine: off | provisioning | connecting | live | reconnecting | error
//   - 5-min health-check poll against GET /v1/cloud-tunnel/status
//   - (later, #35) the cloudflared child process + provision/revoke API calls
//
// Emits 'change' on every state transition. Consumers (tray indicator,
// Settings panel, pairing QR) read getState() and listen to 'change'.
//
// Hard guardrails:
//   1. Health-check interval is 300_000 ms (5 min). NEVER 60s — cost
//      guardrail, the cloud's Workers free tier overflows at 60s × 1000
//      users.
//   2. Hostname pattern (<callsign>.cloud.potacat.com) is returned by
//      the cloud /provision endpoint; never constructed client-side.
//   3. JWT auth is owned by lib/cloud-sync.js; this module never rolls
//      its own auth path — it calls into the shared CloudSyncClient.

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min — see guardrail #1 above.
const CONFIG_FILENAME = 'cloud-tunnel.json';

// Spawn restart backoff (#35): exponential 1s → 30s cap, up to 5 attempts.
const SPAWN_RESTART_MAX = 5;
const SPAWN_RESTART_BASE_MS = 1000;
const SPAWN_RESTART_CAP_MS = 30000;

class CloudTunnelManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.userDataPath - app.getPath('userData')
   * @param {() => object} opts.getCloudSync - returns the shared CloudSyncClient (auth + http)
   * @param {() => string|null} opts.getCloudflaredPath - resolveCloudflaredPath() from lib/cloudflared
   * @param {(msg: string) => void} [opts.log] - optional logger
   * @param {object} [opts.safeStorage] - Electron safeStorage (if available)
   */
  constructor(opts) {
    super();
    this._userDataPath = opts.userDataPath;
    this._configPath = path.join(this._userDataPath, CONFIG_FILENAME);
    this._getCloudSync = opts.getCloudSync;
    this._getCloudflaredPath = opts.getCloudflaredPath;
    this._log = opts.log || (() => {});
    this._safeStorage = opts.safeStorage || null;

    // Persisted state (mirrors what lives in cloud-tunnel.json on disk).
    // tunnelToken is kept in memory ONLY after decrypt; never logged.
    this._enabled = false;
    this._cloudHost = '';
    this._tunnelId = '';
    this._tunnelToken = '';
    this._createdAt = '';

    // Volatile runtime state.
    this._status = 'off'; // off | provisioning | connecting | live | reconnecting | error
    this._lastError = '';
    this._lastCheckAt = 0;
    this._child = null;
    this._healthTimer = null;
    this._restartAttempts = 0;
    this._restartTimer = null;
    this._stopping = false;
  }

  // ── Public API ────────────────────────────────────────────────────

  getState() {
    return {
      enabled: this._enabled,
      cloudHost: this._cloudHost,
      tunnelId: this._tunnelId,
      status: this._status,
      lastError: this._lastError,
      lastCheckAt: this._lastCheckAt,
      // tunnelToken is NEVER returned — it's a secret.
    };
  }

  /** Cloud host string for the pairing QR, or '' when LAN-only. */
  getCloudHost() {
    return (this._enabled && this._cloudHost) ? this._cloudHost : '';
  }

  /**
   * Read cloud-tunnel.json at startup. If the file says enabled, the
   * health-check + child process come up automatically (#35 handles
   * the spawn; #38 starts the health-check).
   */
  loadFromDisk() {
    try {
      if (!fs.existsSync(this._configPath)) {
        this._setStatus('off');
        return false;
      }
      const raw = fs.readFileSync(this._configPath, 'utf8');
      const cfg = JSON.parse(raw);
      this._enabled = !!cfg.enabled;
      this._cloudHost = String(cfg.cloudHost || '');
      this._tunnelId = String(cfg.tunnelId || '');
      this._createdAt = String(cfg.createdAt || '');
      this._tunnelToken = this._decryptToken(cfg.tunnelToken, !!cfg.tokenEncrypted);
      this._setStatus(this._enabled ? 'connecting' : 'off');
      return this._enabled;
    } catch (err) {
      this._log('[cloud-tunnel] loadFromDisk failed: ' + (err.message || err));
      this._setStatus('off');
      return false;
    }
  }

  // ── Health check (#38) ────────────────────────────────────────────

  startHealthCheck() {
    if (this._healthTimer) return;
    if (!this._enabled) return;
    // First check fires on next tick so callers see the initial state
    // settle before the network call lands.
    this._healthTimer = setInterval(() => this._checkOnce(), HEALTH_CHECK_INTERVAL_MS);
    // Fire an immediate check so the tray doesn't sit in 'connecting'
    // for the full 5 minutes after enable.
    setImmediate(() => this._checkOnce());
  }

  stopHealthCheck() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  async _checkOnce() {
    if (!this._enabled) return;
    const sync = this._getCloudSync && this._getCloudSync();
    if (!sync) {
      this._log('[cloud-tunnel] health-check skipped — no cloud-sync client');
      return;
    }
    try {
      // `_authedRequest` is the existing client helper — see the
      // top-of-file guardrail #3 (no new auth path).
      const res = await sync._authedRequest('GET', '/v1/cloud-tunnel/status');
      this._lastCheckAt = Date.now();
      if (res && res.healthy) {
        this._lastError = '';
        this._setStatus('live');
        // Cloud is the source of truth for cloudHost — refresh in case
        // we drifted (e.g. after a server-side rebuild).
        if (res.cloudHost && res.cloudHost !== this._cloudHost) {
          this._cloudHost = res.cloudHost;
          this._persist();
        }
      } else {
        this._setStatus('reconnecting');
        // If the child has already exited, restart it (#35). The
        // health-check is the recovery path that picks up where the
        // immediate spawn-restart backoff gave up.
        if (this._enabled && !this._child) {
          this._log('[cloud-tunnel] status unhealthy + no child running — respawn');
          this._spawnCloudflared();
        }
      }
    } catch (err) {
      this._lastCheckAt = Date.now();
      this._lastError = err.message || String(err);
      // Network errors / 401s are not fatal — keep showing
      // 'reconnecting' so the user knows something's off, and the
      // next poll re-tries.
      this._setStatus('reconnecting');
      this._log('[cloud-tunnel] health-check error: ' + this._lastError);
    }
  }

  // ── Provision / Revoke / Child process (#35) ──────────────────────
  // Stubs for now — #35 fills in the bodies.

  async enable() {
    throw new Error('cloud-tunnel.enable() not implemented yet — #35');
  }

  async disable() {
    throw new Error('cloud-tunnel.disable() not implemented yet — #35');
  }

  _spawnCloudflared() {
    // #35: spawn `cloudflared tunnel run --token <token>` with stdio
    // pipe; watch stderr for "connection registered" → 'live'; on exit,
    // schedule restart with exponential backoff (1s → 30s cap × 5).
    // Stubbed for #38 commit — health-check will log this NOP and the
    // tray (#36) will show 'reconnecting' indefinitely until #35 lands.
    this._log('[cloud-tunnel] _spawnCloudflared not implemented yet — #35');
  }

  _killCloudflared() {
    if (!this._child) return;
    try {
      this._child.removeAllListeners();
      this._child.kill();
    } catch {}
    this._child = null;
  }

  // ── Persistence ───────────────────────────────────────────────────

  _persist() {
    const cfg = {
      enabled: this._enabled,
      cloudHost: this._cloudHost,
      tunnelId: this._tunnelId,
      createdAt: this._createdAt,
    };
    if (this._tunnelToken) {
      const enc = this._encryptToken(this._tunnelToken);
      cfg.tunnelToken = enc.value;
      cfg.tokenEncrypted = enc.encrypted;
    }
    try {
      const tmp = this._configPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this._configPath);
      // chmod is a no-op on Windows but harmless.
      try { fs.chmodSync(this._configPath, 0o600); } catch {}
    } catch (err) {
      this._log('[cloud-tunnel] persist failed: ' + (err.message || err));
    }
  }

  _wipe() {
    this._enabled = false;
    this._cloudHost = '';
    this._tunnelId = '';
    this._tunnelToken = '';
    this._createdAt = '';
    try {
      if (fs.existsSync(this._configPath)) fs.unlinkSync(this._configPath);
    } catch (err) {
      this._log('[cloud-tunnel] wipe failed: ' + (err.message || err));
    }
  }

  _encryptToken(plain) {
    if (this._safeStorage && this._safeStorage.isEncryptionAvailable && this._safeStorage.isEncryptionAvailable()) {
      try {
        const buf = this._safeStorage.encryptString(plain);
        return { value: buf.toString('base64'), encrypted: true };
      } catch (err) {
        this._log('[cloud-tunnel] safeStorage.encrypt failed, falling back to plaintext: ' + (err.message || err));
      }
    }
    return { value: plain, encrypted: false };
  }

  _decryptToken(stored, encrypted) {
    if (!stored) return '';
    if (!encrypted) return stored;
    if (this._safeStorage && this._safeStorage.isEncryptionAvailable && this._safeStorage.isEncryptionAvailable()) {
      try {
        return this._safeStorage.decryptString(Buffer.from(stored, 'base64'));
      } catch (err) {
        this._log('[cloud-tunnel] safeStorage.decrypt failed: ' + (err.message || err));
        return '';
      }
    }
    // Persisted as encrypted but safeStorage is no longer available
    // (e.g. user moved profile dir). Caller will need to re-provision.
    return '';
  }

  // ── Internals ─────────────────────────────────────────────────────

  _setStatus(next) {
    if (this._status === next) return;
    const prev = this._status;
    this._status = next;
    this._log(`[cloud-tunnel] status ${prev} → ${next}` + (this._lastError ? ` (err: ${this._lastError.slice(0, 80)})` : ''));
    this.emit('change', this.getState());
  }

  // For tests + clean shutdown.
  shutdown() {
    this._stopping = true;
    this.stopHealthCheck();
    this._killCloudflared();
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
    this.removeAllListeners();
  }
}

module.exports = {
  CloudTunnelManager,
  HEALTH_CHECK_INTERVAL_MS,
  SPAWN_RESTART_MAX,
  SPAWN_RESTART_BASE_MS,
  SPAWN_RESTART_CAP_MS,
};
