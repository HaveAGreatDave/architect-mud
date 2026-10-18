/**
 * ORACLE's sample-level back end: an LF glottal source and a Klatt-style cascade, per sample.
 *
 * Loaded by audio-engine.js (loadOracleWorklet) into an AudioContext as an AudioWorklet
 * module, from beside that file. It is not a page script. A prototype beside the node-graph
 * back end, chosen per line with `backend: 'worklet'` (the Voice Lab toggle): the text,
 * phoneme, accent and prosody stages are the same for both, and so is every target they
 * schedule. speak() records those targets into parameter tracks, one frame per FRAME
 * seconds, and posts them here. Nothing here knows a phoneme.
 *
 * What the node graph can't do, and this does:
 *   - a glottal pulse built per CYCLE (the Liljencrants-Fant model), so open quotient,
 *     return phase (spectral tilt), jitter and shimmer change from one period to the next
 *     instead of being one PeriodicWave for the whole line plus LFOs;
 *   - a CASCADE of resonators for the voiced path (and aspiration), as in a real tube, so
 *     formant levels fall out of where the formants are rather than being told;
 *   - a parallel branch for frication and bursts, which bypass the tract as before;
 *   - a nasal pole-zero pair, where the graph has a peaking filter with negative gain.
 *
 * Track layout: Float32Array of frames * NP, NP values per frame, in TRACK order below
 * (audio-engine.js holds the same list). Values are linearly interpolated between frames.
 */
const TRACK = ['f0', 'jitA', 'jitB', 'av', 'ah', 'af', 'f1', 'f2', 'f3', 'f4', 'q1', 'q2', 'q3', 'q4',
  'nf', 'nq', 'nzf', 'nzdb', 'tilt', 'closure'];
const NP = TRACK.length;
const IX = Object.fromEntries(TRACK.map((k, i) => [k, i]));
const TAU = Math.PI * 2;

// Klatt's second-order resonator: y = a*x + b*y1 + c*y2, unity gain at DC.
class Reson {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.y1 = 0; this.y2 = 0; }
  set(f, bw, T) {
    const r = Math.exp(-Math.PI * bw * T);
    this.c = -r * r;
    this.b = 2 * r * Math.cos(TAU * f * T);
    this.a = 1 - this.b - this.c;
  }
  run(x) {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
// The antiresonator: the resonator's inverse, an FIR zero pair, unity gain at DC.
class AntiReson {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.x1 = 0; this.x2 = 0; }
  set(f, bw, T) {
    const r = Math.exp(-Math.PI * bw * T);
    const c = -r * r, b = 2 * r * Math.cos(TAU * f * T), a = 1 - b - c;
    this.a = 1 / a; this.b = -b / a; this.c = -c / a;
  }
  run(x) {
    const y = this.a * x + this.b * this.x1 + this.c * this.x2;
    this.x2 = this.x1; this.x1 = x;
    return y;
  }
}

// ── The LF pulse ─────────────────────────────────────────────────────────────
// Flow DERIVATIVE over one period, normalised to T0 = 1:
//   open    0..te   E0 * e^(alpha t) * sin(pi t / tp)
//   return  te..1   -(1 / (eps ta)) * (e^(-eps (t-te)) - e^(-eps (1-te)))
// The negative peak at te is the closure, normalised to -1. eps makes the return phase
// meet zero at the period's end; alpha makes the whole period integrate to zero (no net
// flow change per cycle). Both are solved per cycle, which is a few dozen exp() calls a
// period: nothing, at a voice's 80-300 periods a second.
function lfSolve(te, tp, ta) {
  const D = 1 - te;
  let eps = 1 / ta;
  for (let i = 0; i < 12; i++) {             // Newton on eps*ta - 1 + e^(-eps D) = 0
    const e = Math.exp(-eps * D);
    const f = eps * ta - 1 + e, df = ta - D * e;
    const n = eps - f / df;
    if (!(n > 0) || !Number.isFinite(n)) break;
    if (Math.abs(n - eps) < 1e-6 * eps) { eps = n; break; }
    eps = n;
  }
  const eD = Math.exp(-eps * D);
  // area of the return phase (Ee = 1)
  const ret = -(1 / (eps * ta)) * ((1 - eD) / eps - D * eD);
  const wg = Math.PI / tp, swe = Math.sin(wg * te), cwe = Math.cos(wg * te);
  const open = (alpha) => {
    const ea = Math.exp(alpha * te);
    const E0 = -1 / (ea * swe);
    return E0 * (ea * (alpha * swe - wg * cwe) + wg) / (alpha * alpha + wg * wg);
  };
  // The open-phase area falls as alpha rises; bisect for open + ret = 0.
  let lo = -40, hi = 120;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (open(m) + ret > 0) lo = m; else hi = m;
  }
  const alpha = (lo + hi) / 2;
  return { te, tp, ta, eps, eD, alpha, wg, E0: -1 / (Math.exp(alpha * te) * swe) };
}
function lfAt(p, x) {
  if (x < p.te) return p.E0 * Math.exp(p.alpha * x) * Math.sin(p.wg * x);
  return -(1 / (p.eps * p.ta)) * (Math.exp(-p.eps * (x - p.te)) - p.eD);
}

// A bandpass with 0 dB at its centre (the RBJ form Web Audio's BiquadFilter uses), for
// the frication branch: a Klatt resonator passes DC, and frication through one would
// carry every low rumble the noise has.
class BandPass {
  constructor() { this.b0 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(f, q, T) {
    const w = TAU * f * T, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Pink noise, Paul Kellett's filter, the same colour as speechNoise() in the engine.
class Pink {
  constructor(seed) { this.s = seed >>> 0 || 1; this.b = new Float64Array(7); }
  white() {
    let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0;
    return (this.s / 4294967296) * 2 - 1;
  }
  next() {
    const w = this.white(), b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.96900 * b[2] + w * 0.1538520; b[3] = 0.86650 * b[3] + w * 0.3104856;
    b[4] = 0.55000 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.0168980;
    const y = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return y * 0.16;    // RMS near 0.5, as the engine's buffer is normalised
  }
}

class OracleVoice extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.tracks = null; this.frames = 0; this.frame = 0.005; this.t0 = 0;
    this.k = {};       // per-line constants (see speak() in the engine)
    this.T = 1 / sampleRate;
    this.ph = 0; this.period = 0; this.lf = null; this.amp = 1;
    this.cyc = 0;
    this.noise = new Pink(o.seed || 12345);
    this.rand = new Pink((o.seed || 12345) ^ 0x9e3779b9);
    this.R = [0, 1, 2, 3, 4].map(() => new Reson());       // cascade F1-F5
    this.np = new Reson(); this.nz = new AntiReson();      // the nasal pair
    this.fb1 = new BandPass(); this.fb2 = new BandPass();  // the frication band, twice
    this.lpf = 0; this.done = false; this.stopped = false; this.tilt = 0;
    this.rms = 0; this.n = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'line') {
        this.tracks = d.tracks; this.frames = d.frames; this.frame = d.frame; this.t0 = d.t0;
        this.k = d.k || {};
      } else if (d.type === 'stop') this.stopped = true;
    };
  }

  // Track value at line time `lt`, linearly between frames.
  at(i, lt) {
    const tr = this.tracks, fx = lt / this.frame;
    let f = Math.floor(fx);
    if (f < 0) return tr[i];
    if (f >= this.frames - 1) return tr[(this.frames - 1) * NP + i];
    const u = fx - f;
    return tr[f * NP + i] * (1 - u) + tr[(f + 1) * NP + i] * u;
  }

  // A new glottal period starts: draw its length, its amplitude and its shape.
  cycle(lt) {
    const k = this.k;
    let f0 = this.at(IX.f0, lt);
    // The graph's two jitter LFOs keep their shapes here (the slow wander is real and the
    // drawn vowel's 6 Hz waver is a deliberate gesture), sampled once per period ...
    const jA = this.at(IX.jitA, lt), jB = this.at(IX.jitB, lt);
    const tri = 1 - 4 * Math.abs(((lt * 9) % 1) - 0.5);
    f0 += jA * tri + jB * Math.sin(TAU * 6.3 * lt);
    // ... and growl as a sub-period FM on the source, as the graph wires it.
    if (k.growl > 0) f0 += k.f0 * k.growl * Math.sin(TAU * k.f0 * k.growlRatio * lt);
    if (k.growl2 > 0) f0 += k.f0 * k.growl2 * Math.sin(TAU * k.f0 * k.growl2Ratio * lt);
    // PER-CYCLE JITTER: the aperiodic half the LFOs can't give. Scaled by how much jitter
    // the line has asked for at this moment, so a creak's end gets rougher on its own.
    const jf = Math.min(0.25, (Math.abs(jA) + Math.abs(jB)) / Math.max(30, f0));
    f0 *= 1 + this.rand.white() * jf * k.cycJitter;
    f0 = Math.max(40, Math.min(900, f0));
    this.period = 1 / f0;
    // PER-CYCLE SHIMMER: amplitude drawn per period, larger as jitter grows.
    this.amp = 1 + this.rand.white() * (k.shimmer + jf * 2);
    // OPEN QUOTIENT per cycle. A louder voice closes harder (lower OQ, pressed); breath
    // holds the folds apart (higher OQ). The line's base is the voice's own oq.
    const av = this.at(IX.av, lt), ah = this.at(IX.ah, lt);
    let oq = k.oq - k.oqEffort * (av - 0.8) + k.oqBreath * ah + this.rand.white() * 0.01;
    oq = Math.max(0.35, Math.min(0.9, oq));
    // RETURN PHASE = spectral tilt. The graph's tilt lowpass corner becomes Ta = 1/(2 pi Fa),
    // as a fraction of this period, never shorter than a sample.
    const tilt = this.at(IX.tilt, lt) * k.tiltK;
    const ta = Math.min(0.2, Math.max(this.T, 1 / (TAU * Math.max(300, tilt))) * f0);
    const te = Math.min(oq, 0.97 - ta);
    this.lf = lfSolve(te, te * k.rk, Math.max(ta, 1e-4));
    this.cyc++;
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (this.stopped) return false;
    if (!this.tracks) { out.fill(0); return true; }
    const T = this.T, k = this.k, R = this.R;
    const t0 = this.t0, len = this.frames * this.frame;
    let lt = currentTime - t0;
    if (lt > len + 0.05) {
      if (!this.done) { this.done = true; this.port.postMessage({ type: 'done', rms: Math.sqrt(this.rms / Math.max(1, this.n)), cycles: this.cyc }); }
      return false;
    }
    for (let i = 0; i < out.length; i++, lt += T) {
      if (lt < 0) { out[i] = 0; continue; }
      // Coefficients every 16 samples (a third of a millisecond): far finer than the
      // 5 ms tracks, and an eighth of the trig.
      if ((i & 15) === 0) {
        const fs = k.fshift;
        for (let n = 0; n < 4; n++) {
          const f = Math.max(60, Math.min(sampleRate * 0.45, this.at(IX.f1 + n, lt)));
          const q = Math.max(0.5, this.at(IX.q1 + n, lt));
          R[n].set(f, Math.max(30, f / q) * k.bwK, T);
        }
        R[4].set(4800 * fs, 400, T);
        const nzf = Math.max(200, this.at(IX.nzf, lt));
        const depth = Math.pow(10, Math.min(0, this.at(IX.nzdb, lt)) / 20);
        // A pole and a zero at one frequency: the notch depth is their bandwidth ratio,
        // so 0 dB is a perfect cancel and -22 dB a deep zero, with no step between.
        this.np.set(nzf, 300, T);
        this.nz.set(nzf, Math.max(15, 300 * depth), T);
        const nf = Math.max(200, Math.min(sampleRate * 0.45, this.at(IX.nf, lt)));
        const nq = Math.max(0.5, this.at(IX.nq, lt));
        this.fb1.set(nf, nq, T); this.fb2.set(nf, nq, T);
      }
      // The source. A period ends: start the next one.
      if (this.lf === null || this.ph >= 1) {
        if (this.ph >= 1) this.ph -= 1;
        this.cycle(lt);
      }
      const g = lfAt(this.lf, this.ph) * this.amp;
      this.ph += T / this.period;
      const av = this.at(IX.av, lt), ah = this.at(IX.ah, lt), af = this.at(IX.af, lt);
      const nse = this.noise.next();
      // Aspiration goes INTO the tract, as the graph's aspG does; Klatt modulates it by
      // the glottal opening so breathy voice is noise pulsed at F0, not beside it.
      const open = this.ph < this.lf.te ? 1 : 0.5;
      let x = g * av * k.srcK + nse * ah * k.aspK * (av > 0.05 ? open : 1);
      // The cascade: nasal pair, then F1 and the rest.
      x = this.nz.run(this.np.run(x));
      const r1 = R[0].run(x);
      let y = r1;
      for (let n = 1; n < 5; n++) y = R[n].run(y);
      // A CLOSED TRACT radiates only its lowest resonance: the voice bar under /b d g/ and
      // the murmur under /v z/. F1's output alone, crossfaded by the closure track.
      const cl = this.at(IX.closure, lt);
      y = y * (1 - cl) + r1 * cl * k.closureK;
      // The parallel branch: frication and bursts, through a doubled band and a top cut.
      const fz = this.fb2.run(this.fb1.run(nse * af)) * k.fricK;
      this.lpf += (fz - this.lpf) * k.lpA;
      const s = y * k.cascK + this.lpf;
      out[i] = s;
      this.rms += s * s; this.n++;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor('oracle-voice', OracleVoice);
