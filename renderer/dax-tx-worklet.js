// DAX TX worklet — taps the WebRTC mic stream and posts 128-sample mono
// Float32 chunks at 24 kHz back to the main thread, which forwards them
// via IPC to lib/smartsdr-audio.js → VITA-49 dax_tx packets to the radio.
//
// Sample-rate conversion: the parent AudioContext is constructed with
// sampleRate: 24000, which makes the engine resample the underlying
// MediaStreamSource (typically 48 kHz from WebRTC) down to 24 kHz before
// it reaches this worklet. So we don't do any DSP ourselves — process()
// always sees 128 frames at 24 kHz, exactly one VITA packet's worth.
//
// We copy the input buffer before posting because the AudioWorklet runtime
// reuses the Float32Array across process() invocations.
class DaxTxProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.port.postMessage(new Float32Array(ch));
    }
    return true; // keep processor alive until externally disconnected
  }
}
registerProcessor('dax-tx-processor', DaxTxProcessor);
