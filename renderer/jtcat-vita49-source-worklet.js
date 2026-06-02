// JTCAT VITA-49 source AudioWorkletProcessor — replaces the
// per-frame createBuffer + createBufferSource pattern that was
// allocating ~190 Web Audio nodes/sec on SmartSDR Direct. Each
// VITA-49 PCM frame from main arrives via port.postMessage and lands
// in a ring buffer; process() drains the ring buffer with linear
// interpolation from the source rate (24 kHz dax_rx) up/down to the
// AudioContext's native rate. One node, allocated once, fed forever.
//
// K3SBP 2026-06-02 — replaces the BufferSource churn that caused
// "[Audio] Backpressure on jtcat-vita49-audio" to spiral as soon as
// the renderer fell behind on Web Audio node scheduling.

class Vita49SourceProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.sourceRate = opts.sourceRate || 24000;
    // sampleRate is a global in the worklet scope — the AudioContext's
    // native rate (typically 48000 on desktop).
    this.targetRate = sampleRate;
    this.step = this.sourceRate / this.targetRate; // 0.5 for 24k→48k

    // 500 ms of source-rate samples — enough to ride out a GC pause
    // without running dry, but not so large that an IPC burst strands
    // playback seconds behind real time.
    this.bufSize = Math.ceil(this.sourceRate * 0.5);
    this.buf = new Float32Array(this.bufSize);
    this.bufRead = 0;
    this.bufWrite = 0;
    this.bufAvailable = 0;

    // Sub-sample read cursor for linear interpolation.
    this.fracPos = 0;

    // Diagnostics counters (read via port.postMessage on demand).
    this.underruns = 0;
    this.overflows = 0;

    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg && msg.cmd === 'reset') {
        this.bufRead = 0;
        this.bufWrite = 0;
        this.bufAvailable = 0;
        this.fracPos = 0;
        return;
      }
      const pcm = msg;
      if (!pcm || !pcm.length) return;

      // If the incoming frame would overflow our 500 ms window, drop
      // the oldest half of what's queued and append the new frame.
      // Brief garble beats unbounded latency.
      if (this.bufAvailable + pcm.length > this.bufSize) {
        const drop = (this.bufAvailable + pcm.length) - Math.floor(this.bufSize * 0.5);
        this.bufRead = (this.bufRead + drop) % this.bufSize;
        this.bufAvailable -= drop;
        this.overflows++;
      }
      for (let i = 0; i < pcm.length; i++) {
        this.buf[this.bufWrite] = pcm[i];
        this.bufWrite = (this.bufWrite + 1) % this.bufSize;
      }
      this.bufAvailable += pcm.length;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const len = out.length;
    const bufSize = this.bufSize;
    const buf = this.buf;
    const step = this.step;

    for (let i = 0; i < len; i++) {
      if (this.bufAvailable < 2) {
        out[i] = 0;
        if (this.bufAvailable === 0) this.underruns++;
        continue;
      }
      const a = buf[this.bufRead];
      const nextIdx = (this.bufRead + 1) % bufSize;
      const b = buf[nextIdx];
      out[i] = a + (b - a) * this.fracPos;
      this.fracPos += step;
      while (this.fracPos >= 1) {
        this.fracPos -= 1;
        this.bufRead = (this.bufRead + 1) % bufSize;
        this.bufAvailable--;
        if (this.bufAvailable < 1) break;
      }
    }
    return true;
  }
}

registerProcessor('jtcat-vita49-source', Vita49SourceProcessor);
