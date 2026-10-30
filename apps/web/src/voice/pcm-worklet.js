/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Captures the mic stream and resamples it to 24 kHz mono 16-bit PCM for
// Muse Voice Transcribe realtime (audioEncoding PCM_24KHZ). Posts one
// 100 ms frame (2400 little-endian int16 samples) per message, transferring
// the buffer. Runs in an AudioWorkletGlobalScope: no DOM, no imports.

const TARGET_RATE = 24000;
const FRAME_SAMPLES = 2400; // 100 ms at 24 kHz.

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Buffered mono input samples (floats). */
    this.input = [];
    /** Absolute input samples dropped from the head of `input`. */
    this.dropped = 0;
    /** Total resampled samples produced (absolute output clock). */
    this.outputCount = 0;
    /** Resampled floats awaiting framing. */
    this.pending = [];
  }

  process(inputs) {
    const channel = inputs[0] ? inputs[0][0] : null;
    if (channel) {
      for (let i = 0; i < channel.length; i += 1) this.input.push(channel[i]);
    }
    const ratio = sampleRate / TARGET_RATE;
    // Linear interpolation: each output sample reads between the two
    // bracketing inputs. The loop stops while the second bracket is
    // missing, so block boundaries stay continuous.
    for (;;) {
      const pos = this.outputCount * ratio - this.dropped;
      const i0 = Math.floor(pos);
      if (i0 < 0 || i0 + 1 >= this.input.length) break;
      const frac = pos - i0;
      this.pending.push(this.input[i0] * (1 - frac) + this.input[i0 + 1] * frac);
      this.outputCount += 1;
    }
    // Drop input strictly behind the next read position, keeping one
    // sample for the next interpolation.
    const nextAbs = Math.floor(this.outputCount * ratio) - 1;
    const drop = Math.min(this.input.length, Math.max(0, nextAbs - this.dropped));
    if (drop > 0) {
      this.input.splice(0, drop);
      this.dropped += drop;
    }
    while (this.pending.length >= FRAME_SAMPLES) {
      const frame = this.pending.splice(0, FRAME_SAMPLES);
      const pcm = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i += 1) {
        const s = Math.max(-1, Math.min(1, frame[i]));
        pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
