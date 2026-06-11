/**
 * Lightweight SNTP client for measuring clock offset against NTP servers.
 * Uses Node's built-in dgram — no extra dependencies.
 *
 * FT8/FT4 digital modes require clock accuracy within ~0.5 seconds of UTC.
 * This module queries NTP servers and returns the offset in milliseconds.
 */

const dgram = require('dgram');

// Public NTP servers — pool.ntp.org round-robins globally
const DEFAULT_SERVERS = [
  'pool.ntp.org',
  'time.google.com',
  'time.cloudflare.com',
  'time.nist.gov',
];

const NTP_PORT = 123;
const NTP_EPOCH_OFFSET = 2208988800; // seconds from 1900-01-01 to 1970-01-01
const TIMEOUT_MS = 3000;

/**
 * Query a single NTP server and return the clock offset in milliseconds.
 * Positive offset = local clock is AHEAD of NTP (need to subtract).
 * Negative offset = local clock is BEHIND NTP (need to add).
 *
 * @param {string} server — NTP server hostname
 * @returns {Promise<{offset: number, roundtrip: number, server: string}>}
 */
function queryNtp(server) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const packet = Buffer.alloc(48);

    // Set LI=0, Version=4, Mode=3 (client) in first byte
    packet[0] = 0x23; // 00 100 011

    const t1 = Date.now(); // local transmit time

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`NTP timeout: ${server}`));
    }, TIMEOUT_MS);

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.on('message', (msg) => {
      clearTimeout(timer);
      const t4 = Date.now(); // local receive time

      if (msg.length < 48) {
        socket.close();
        reject(new Error('NTP response too short'));
        return;
      }

      // Parse server transmit timestamp (bytes 40-47)
      const seconds = msg.readUInt32BE(40) - NTP_EPOCH_OFFSET;
      const fraction = msg.readUInt32BE(44);
      const t3 = seconds * 1000 + (fraction / 0x100000000) * 1000;

      // Parse server receive timestamp (bytes 32-39)
      const rxSeconds = msg.readUInt32BE(32) - NTP_EPOCH_OFFSET;
      const rxFraction = msg.readUInt32BE(36);
      const t2 = rxSeconds * 1000 + (rxFraction / 0x100000000) * 1000;

      // NTP offset formula: ((t2 - t1) + (t3 - t4)) / 2
      const offset = ((t2 - t1) + (t3 - t4)) / 2;
      const roundtrip = (t4 - t1) - (t3 - t2);

      socket.close();
      resolve({ offset: Math.round(offset), roundtrip: Math.round(roundtrip), server });
    });

    socket.send(packet, 0, 48, NTP_PORT, server, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

/**
 * Query multiple NTP servers and return the median offset.
 * Filters outliers by using median rather than mean.
 *
 * @param {string[]} [servers] — list of servers (default: pool + Google + Cloudflare + NIST)
 * @returns {Promise<{offset: number, roundtrip: number, server: string, results: Array}>}
 */
async function checkClockOffset(servers) {
  const serverList = servers || DEFAULT_SERVERS;
  const results = [];

  // Query all servers in parallel
  const promises = serverList.map(s =>
    queryNtp(s).catch(err => ({ error: err.message, server: s }))
  );
  const responses = await Promise.all(promises);

  for (const r of responses) {
    if (r.error) {
      results.push(r);
    } else {
      results.push(r);
    }
  }

  // Get successful results, sorted by offset
  const good = results.filter(r => !r.error).sort((a, b) => a.offset - b.offset);
  if (good.length === 0) {
    throw new Error('All NTP servers failed');
  }

  // Use median
  const mid = Math.floor(good.length / 2);
  const median = good.length % 2 === 0
    ? Math.round((good[mid - 1].offset + good[mid].offset) / 2)
    : good[mid].offset;

  return {
    offset: median,
    roundtrip: good[mid].roundtrip,
    server: good[mid].server,
    results,
  };
}

/**
 * Attempt to sync the system clock on Windows via w32tm.
 * Requires administrator privileges.
 *
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function syncSystemClock() {
  if (process.platform !== 'win32') {
    return { success: false, message: 'System clock sync only supported on Windows' };
  }

  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('w32tm /resync /force', { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        // Common error: "The service has not been started" or access denied
        const msg = stderr || err.message;
        if (msg.includes('access') || msg.includes('privilege') || msg.includes('denied')) {
          resolve({ success: false, message: 'Requires administrator privileges. Run POTACAT as Administrator to sync clock.' });
        } else {
          resolve({ success: false, message: msg.trim() });
        }
      } else {
        resolve({ success: true, message: stdout.trim() || 'Clock synchronized' });
      }
    });
  });
}

module.exports = { queryNtp, checkClockOffset, syncSystemClock, DEFAULT_SERVERS };
