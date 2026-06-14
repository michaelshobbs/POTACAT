// WebRTC ANSWERER for the desktop-as-client audio leg (remote-desktop
// Phase 2). The shack is the OFFERER (lib/remote-audio bridge); this desktop
// receives its SDP offer + ICE + TURN iceServers (via stun-config), answers,
// plays the rig RX audio, and sends its mic for PTT TX.
//
// Deliberately PURE: no IPC, no DOM lookups, no globals. The transport is
// injected (onSignal to send to the shack, onTrack to play received audio,
// getUserMedia for the mic). That keeps the renderer shim
// (remote-audio-client.html) thin AND makes this unit-testable against a
// real loopback offerer in a browser (test-output/answerer-loopback-test.js)
// instead of only being eyeballed. Mirrors the proven answerer in
// renderer/remote.js, minus the UI.
(function (global) {
  'use strict';

  class RemoteAudioAnswerer {
    constructor(opts) {
      opts = opts || {};
      this._onSignal = opts.onSignal || function () {}; // (data) -> send to shack (wrapped in `signal` upstream)
      this._onTrack = opts.onTrack || function () {};   // (MediaStream) -> play rig audio
      this._onState = opts.onState || function () {};    // (state) -> diagnostics/status
      // Injectable for tests; defaults to the platform getUserMedia.
      this._getUserMedia = opts.getUserMedia ||
        ((c) => global.navigator.mediaDevices.getUserMedia(c));
      this._pc = null;
      this._mic = null;
      this._iceServers = [];
      this._relayOnly = false;
      this._started = false;
      // ICE that arrives before we've applied the remote offer must be
      // buffered, or addIceCandidate throws and the candidate is lost.
      this._pendingIce = [];
    }

    // Adopt ICE config from the shack's stun-config. Full TURN iceServers
    // when present (Model A), else legacy STUN, else local-only. Applying to
    // a live pc takes effect on the next ICE gather (re-mint / reconnect).
    setIceConfig(cfg) {
      cfg = cfg || {};
      if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
        this._iceServers = cfg.iceServers;
      } else if (cfg.useStun) {
        this._iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
      } // else: leave as-is (don't let a bare useStun ping wipe a TURN list)
      if (typeof cfg.relayOnly === 'boolean') this._relayOnly = cfg.relayOnly;
      if (this._pc) {
        try { this._pc.setConfiguration(this._rtcConfig()); } catch (e) { /* not all engines allow live setConfiguration */ }
      }
    }

    _rtcConfig() {
      const c = { iceServers: this._iceServers };
      if (this._relayOnly) c.iceTransportPolicy = 'relay'; // force relay for testing
      return c;
    }

    // Begin: grab the mic (for PTT), build the peer, ask the shack to start.
    async start() {
      if (this._started) return;
      this._started = true;
      try {
        this._mic = await this._getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        // Muted until PTT — no VOX, no accidental open mic.
        this._mic.getAudioTracks().forEach((t) => { t.enabled = false; });
      } catch (e) {
        this._onState({ error: 'mic: ' + (e && e.message || e) });
        // RX-only still works (recvonly transceiver below).
      }
      this._ensurePc();
      this._onSignal({ type: 'start-audio' });
    }

    _ensurePc() {
      if (this._pc) return this._pc;
      const RTCPC = global.RTCPeerConnection || (global.window && global.window.RTCPeerConnection);
      const pc = new RTCPC(this._rtcConfig());
      this._pc = pc;
      if (this._mic && this._mic.getTracks().length) {
        for (const t of this._mic.getTracks()) pc.addTrack(t, this._mic);
      } else {
        // No mic → still negotiate an audio m-line so we RECEIVE rig audio.
        try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch (e) {}
      }
      pc.ontrack = (ev) => {
        const stream = (ev.streams && ev.streams[0]) || new (global.MediaStream || global.window.MediaStream)([ev.track]);
        this._onTrack(stream);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this._onSignal({ type: 'ice', candidate: {
            candidate: ev.candidate.candidate,
            sdpMid: ev.candidate.sdpMid,
            sdpMLineIndex: ev.candidate.sdpMLineIndex,
          } });
        }
      };
      pc.onconnectionstatechange = () => { this._onState({ connectionState: pc.connectionState }); };
      pc.oniceconnectionstatechange = () => { this._onState({ iceConnectionState: pc.iceConnectionState }); };
      return pc;
    }

    // Inbound WebRTC payload from the shack: { type:'sdp', sdp } | { type:'ice', candidate }.
    async handleSignal(data) {
      if (!data || !data.type) return;
      const pc = this._ensurePc();
      try {
        if (data.type === 'sdp' && data.sdp) {
          if (data.sdp.type === 'offer') {
            await pc.setRemoteDescription(data.sdp);
            for (const c of this._pendingIce.splice(0)) {
              try { await pc.addIceCandidate(c); } catch (e) {}
            }
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this._onSignal({ type: 'sdp', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          } else if (data.sdp.type === 'answer') {
            // We answer, so this is unusual; apply defensively for renegotiation.
            await pc.setRemoteDescription(data.sdp);
          }
        } else if (data.type === 'ice' && data.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(data.candidate);
          } else {
            this._pendingIce.push(data.candidate);
          }
        }
      } catch (e) {
        this._onState({ error: 'signal: ' + (e && e.message || e) });
      }
    }

    // PTT: open/close the mic track during transmit.
    setMicEnabled(on) {
      if (this._mic) this._mic.getAudioTracks().forEach((t) => { t.enabled = !!on; });
    }

    stop() {
      this._started = false;
      if (this._pc) { try { this._pc.close(); } catch (e) {} this._pc = null; }
      if (this._mic) { this._mic.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} }); this._mic = null; }
      this._pendingIce = [];
    }
  }

  // CommonJS (renderer require / future test) + browser global (script tag).
  if (typeof module !== 'undefined' && module.exports) module.exports = { RemoteAudioAnswerer };
  global.RemoteAudioAnswerer = RemoteAudioAnswerer;
})(typeof window !== 'undefined' ? window : globalThis);
