// Dedicated SmartSDR audio subscriber — separate TCP connection.
//
// The primary SmartSdrClient (lib/smartsdr.js) holds a TCP connection
// to port 4992 that's `client bind`-ed to an existing GUI client so
// CW keying / power / filter / spot-marker commands inherit the GUI
// client's scope. That binding is required for CW to work, but it
// also means the modern `audio client 0 slice N 1` command — and as
// of run #2, even the legacy `audio stream N dax=0` — get rejected
// on that connection with 0x500000aa "Invalid command for this
// client type (... or GUI vs NON-GUI)".
//
// Two connections to a single Flex is the supported pattern. This
// module opens a second TCP to the same host, intentionally does NOT
// `client bind`, and uses that connection purely for audio. The
// primary client is undisturbed (CW, spots, meters all keep
// working).
//
// Architecture:
//   - Open TCP to host:4992, no bind → registers as a non-GUI client.
//   - Open a dedicated UDP socket, send `client udpport <port>`.
//   - `stream create type=remote_audio_rx` → captures stream_id from
//     the reply.
//   - `audio client 0 slice N 1` → enables audio for that slice
//     routed to our UDP port.
//   - Parse VITA-49 packets on the dedicated UDP socket, emit each
//     payload as 'audio-frame' (Buffer of Opus bytes).
//
// Failure modes all surface as 'audio-fallback':
//   - TCP connect fails / refused.
//   - cmd-error on either subscribe command.
//   - 5 s pass after subscribe with no audio packets.
const net = require('net');
const dgram = require('dgram');
const { EventEmitter } = require('events');

class SmartSdrAudio extends EventEmitter {
  constructor() {
    super();
    this._sock = null;
    this._udpSock = null;
    this._buf = '';
    this._seq = 1;
    this._connected = false;
    this._sliceIdx = 0;
    this._streamIds = new Set();
    this._cmdSeqs = new Set();
    this._frameSeen = false;
    this._watchdog = null;
    this._gaveUp = false;
  }

  start(host, sliceIdx = 0) {
    this.stop();
    this._sliceIdx = sliceIdx;
    this._frameSeen = false;
    this._gaveUp = false;

    const sock = new net.Socket();
    sock.setNoDelay(true);
    this._sock = sock;

    sock.on('connect', () => {
      this._connected = true;
      this.emit('log', `Audio TCP connected to ${host}:4992 (non-GUI client)`);
      this._setupUdp(() => {
        // Subscribe sequence runs after UDP port is bound + reported.
        const cmd1 = 'stream create type=remote_audio_rx';
        const seq1 = this._send(cmd1);
        if (seq1 != null) this._cmdSeqs.add(seq1);
        this.emit('log', `Audio TX: C${seq1}|${cmd1}`);

        setTimeout(() => {
          if (!this._connected) return;
          const cmd2 = `audio client 0 slice ${sliceIdx} 1`;
          const seq2 = this._send(cmd2);
          if (seq2 != null) this._cmdSeqs.add(seq2);
          this.emit('log', `Audio TX: C${seq2}|${cmd2}`);
        }, 200);
      });

      // Arm the watchdog whether or not subscribe succeeds. cmd-error
      // path fires fallback immediately on rejection; this catches the
      // "subscribed silently and got nothing" case.
      this._armWatchdog();
    });

    sock.on('data', (chunk) => {
      this._buf += chunk.toString();
      let nl;
      while ((nl = this._buf.indexOf('\n')) !== -1) {
        const line = this._buf.slice(0, nl).replace(/\r$/, '');
        this._buf = this._buf.slice(nl + 1);
        this._handleLine(line);
      }
    });

    sock.on('error', (err) => {
      this.emit('log', `Audio TCP error: ${err.message}`);
      this._fallback(`tcp error: ${err.message}`);
    });

    sock.on('close', () => {
      const wasConnected = this._connected;
      this._connected = false;
      this._sock = null;
      if (wasConnected && !this._gaveUp) {
        this.emit('log', 'Audio TCP closed unexpectedly');
        this._fallback('tcp closed');
      }
    });

    sock.connect(4992, host);
  }

  stop() {
    this._gaveUp = true;
    if (this._watchdog) {
      clearTimeout(this._watchdog);
      this._watchdog = null;
    }
    if (this._streamIds.size && this._connected) {
      for (const id of this._streamIds) {
        try { this._send(`stream remove 0x${id.toString(16)}`); } catch {}
      }
    }
    this._streamIds.clear();
    this._cmdSeqs.clear();
    if (this._udpSock) {
      try { this._udpSock.close(); } catch {}
      this._udpSock = null;
    }
    if (this._sock) {
      try { this._sock.destroy(); } catch {}
      this._sock = null;
    }
    this._connected = false;
    this._buf = '';
  }

  _send(cmd) {
    if (!this._sock || !this._connected) return null;
    const seq = this._seq++;
    this._sock.write(`C${seq}|${cmd}\n`);
    return seq;
  }

  _setupUdp(after) {
    const sock = dgram.createSocket('udp4');
    this._udpSock = sock;
    sock.on('message', (buf) => this._parseUdpPacket(buf));
    sock.on('error', (err) => this.emit('log', `Audio UDP error: ${err.message}`));
    sock.bind(0, () => {
      const port = sock.address().port;
      this.emit('log', `Audio UDP listening on port ${port}`);
      this._send(`client udpport ${port}`);
      // Give Flex a beat to register the port before the stream
      // create lands; cheap insurance against a race where the
      // stream-create reply arrives but the udpport command hasn't
      // fully registered yet.
      setTimeout(after, 50);
    });
  }

  _armWatchdog() {
    if (this._watchdog) clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      if (!this._frameSeen) {
        this.emit('log', 'No audio frames in 5s after subscribe — falling back');
        this._fallback('no frames in 5s');
      }
    }, 5000);
  }

  _handleLine(line) {
    // Capture stream_id from any reply that mentions it.
    const sm = line.match(/stream_id=0x([0-9a-fA-F]+)/);
    if (sm) {
      const id = parseInt(sm[1], 16);
      this._streamIds.add(id);
      this.emit('log', `Audio stream id 0x${id.toString(16)} captured`);
    }

    // Command responses: R<seq>|<status hex>|...
    const rMatch = line.match(/^R(\d+)\|([0-9A-Fa-f]+)/);
    if (!rMatch) return;
    const seq = parseInt(rMatch[1]);
    const status = parseInt(rMatch[2], 16);
    if (status !== 0 && this._cmdSeqs.has(seq)) {
      this._cmdSeqs.delete(seq);
      this.emit('log', `Audio cmd error: R${seq}|${status.toString(16)}|${line}`);
      if (!this._frameSeen) {
        this._fallback(`subscribe rejected 0x${status.toString(16)}`);
      }
    }
  }

  _parseUdpPacket(buf) {
    if (buf.length < 28) return;
    if ((buf[0] & 0xF8) !== 0x38) return;
    const streamId = buf.readUInt32BE(4);
    if (!this._streamIds.has(streamId)) return; // not ours
    const payload = buf.slice(28);
    if (payload.length === 0) return;
    if (!this._frameSeen) {
      this._frameSeen = true;
      if (this._watchdog) {
        clearTimeout(this._watchdog);
        this._watchdog = null;
      }
      this.emit('log', `First audio frame received: ${payload.length} bytes (Opus)`);
    }
    this.emit('audio-frame', payload, streamId);
  }

  _fallback(reason) {
    if (this._gaveUp) return;
    this._gaveUp = true;
    if (this._watchdog) {
      clearTimeout(this._watchdog);
      this._watchdog = null;
    }
    this.emit('audio-fallback', { reason });
    // Don't tear the connection down here — caller may want to retry
    // or hold it open for diagnostics. main.js calls stop() on the
    // fallback event.
  }
}

module.exports = { SmartSdrAudio };
