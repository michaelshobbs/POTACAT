// Dedicated SmartSDR audio subscriber — separate TCP connection.
//
// History (don't repeat the dead ends):
//
//   Attempt 1 (`audio client 0 slice 0 1` on the GUI-bound primary):
//     rejected with 0x500000aa. The primary is `client bind`-ed to a
//     GUI client for CW, and modern `audio client …` requires non-GUI
//     scope.
//
//   Attempt 2 (legacy `audio stream 0 dax=0` on the same primary):
//     same rejection — the scope problem isn't a syntax problem.
//
//   Attempt 3 (`stream create type=remote_audio_rx` on a separate
//     non-GUI TCP): rejected with 0x500000aa AGAIN. Per the FlexRadio
//     API docs, `type=remote_audio_rx` is for SSL/SmartLink (port
//     4993) clients only. The "SSL vs TCP" branch of the error
//     message turned out to be the real cause, not GUI/non-GUI.
//
//   Attempt 4 (this file, current): the documented form for local
//     TCP audio subscribe is `stream create type=dax_rx
//     dax_channel=<N>`. The audio that flows is whatever the user has
//     mapped DAX RX channel N → slice in their DAX panel. Most users
//     have DAX RX 1 mapped to slice 0, so we default to channel 1.
//
// Payload format: DAX RX audio is uncompressed PCM, not Opus. Each
// VITA-49 packet carries 32-bit big-endian IEEE floats, L/R
// interleaved, at 24 kHz (Flex 6000) or 48 kHz (Flex 8000). We parse
// them into Float32Array mono PCM and emit on 'audio-frame' so the
// renderer can use the same direct-PCM injection path the Kiwi/WebSDR
// audio uses (no WebCodecs needed).
//
// Failure modes all surface as 'audio-fallback':
//   - TCP connect fails / refused.
//   - cmd-error on the subscribe command.
//   - 5 s pass after subscribe with no audio packets (most often:
//     user doesn't have DAX RX <N> mapped to any slice).
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

  start(host, daxChannel = 1) {
    this.stop();
    this._daxChannel = daxChannel;
    this._frameSeen = false;
    this._gaveUp = false;

    const sock = new net.Socket();
    sock.setNoDelay(true);
    this._sock = sock;

    sock.on('connect', () => {
      this._connected = true;
      this.emit('log', `Audio TCP connected to ${host}:4992 (non-GUI client)`);
      this._setupUdp(() => {
        // `stream create type=dax_rx dax_channel=<N>` IS the
        // subscription — no follow-up command needed. The audio that
        // arrives is whatever the user has mapped DAX RX <N> to in
        // the DAX panel (typically RX 1 → slice 0).
        const cmd = `stream create type=dax_rx dax_channel=${this._daxChannel}`;
        const seq = this._send(cmd);
        if (seq != null) this._cmdSeqs.add(seq);
        this.emit('log', `Audio TX: C${seq}|${cmd}`);
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

    // DAX RX payload: 32-bit big-endian IEEE floats, L/R interleaved.
    // Drop a stray odd-channel byte if the radio ever sends a partial
    // sample (defensive — shouldn't happen in practice).
    const floatBytes = payload.length - (payload.length % 8);
    const stereoSamples = floatBytes / 8; // 4 bytes/L + 4 bytes/R = 8 per sample-pair
    const pcm = new Float32Array(stereoSamples);
    for (let i = 0; i < stereoSamples; i++) {
      // Mono — DAX RX is the same on both channels for a slice. Take L.
      pcm[i] = payload.readFloatBE(i * 8);
    }

    if (!this._frameSeen) {
      this._frameSeen = true;
      if (this._watchdog) {
        clearTimeout(this._watchdog);
        this._watchdog = null;
      }
      this.emit('log', `First audio frame received: ${payload.length} bytes → ${stereoSamples} mono samples (PCM f32 BE)`);
    }
    // Sample rate is 24 kHz on Flex 6000-series; 8000-series uses
    // 48 kHz. The renderer's AudioContext resamples either way, so
    // sending the wrong rate just shifts pitch — but 24 kHz is right
    // for Casey's 6500 and the most common use case.
    this.emit('audio-frame', { pcm, sampleRate: 24000 });
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
