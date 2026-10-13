/**
 * SIREN's retro stage: sample-and-hold and bit depth, for one cue.
 *
 * Loaded by audio-engine.js (loadRetro) into each AudioContext as an AudioWorklet module,
 * from beside that file, and used through retroStage() there. It is not a page script.
 *
 * `rate` holds each input sample for 1/rate of a second, so the output steps the way an
 * 8–16 kHz cartridge sample did: the steps are the grit, and nothing smooths them. `bits`
 * then rounds what's held to that many bits (half up, symmetrically, so silence stays
 * silent and nothing drifts off zero). The engine has already scaled the cue to its own
 * full scale (±1) on the way in and scales it back on the way out. Nothing is clipped: a
 * peak past full scale is rounded like the rest.
 *
 * The engine's output rate never changes; this colours one cue.
 */
class SirenRetro extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    // (how far one output sample moves the hold clock; 1 = no hold)
    this.inc = o.rate > 0 ? Math.min(1, o.rate / sampleRate) : 1;
    this.q = o.bits > 0 ? Math.pow(2, Math.min(16, o.bits) - 1) : 0;
    this.phase = 1;
    this.held = 0;
    // (alive until the cue's end, in context time, even across a gap between its layers;
    // 0 = only while something upstream is playing)
    this.until = +o.until || 0;
  }

  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    // nothing upstream: past the cue's end the node can go; before it, a layer is still to come
    if (!input || !input.length) return currentTime < this.until;
    const x = input[0], y = output[0], q = this.q, inc = this.inc;
    let phase = this.phase, held = this.held;
    for (let i = 0; i < y.length; i++) {
      phase += inc;
      if (phase >= 1) { phase -= 1; held = x[i]; }
      let v = held;
      if (q) v = v >= 0 ? Math.floor(v * q + 0.5) / q : -Math.floor(-v * q + 0.5) / q;
      y[i] = v;
    }
    this.phase = phase;
    this.held = held;
    for (let ch = 1; ch < output.length; ch++) output[ch].set(y);
    return true;
  }
}

registerProcessor('siren-retro', SirenRetro);
