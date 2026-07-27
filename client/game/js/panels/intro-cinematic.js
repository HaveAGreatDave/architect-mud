// The cold open — the first thirty seconds a new player ever sees.
//
// Runs BEFORE the prologue's arrival prose and before the interface tour offer:
// the server pushes `intro_cinematic` on a first login into The Inbetween and
// then waits, holding the rest of the prologue back until this echoes `introdone`
// (see plugins/prologue/index.js). So the cinematic never plays over the game.
//
// Everything is generated — no assets, nothing to load, nothing to 404. Two
// layers over a black field:
//
//   1. a canvas running one of five PHASES, each an abstraction of the beat it
//      sits under: a drifting lattice of connections (the network), the lattice
//      pulling into a hard grid (prediction becoming architecture), the grid
//      shattering into static (the exchange), true black (silence), and finally a
//      slow horizon of window-lights (Coldwater, still on);
//   2. the text, one line at a time, fading in and out on its own clock.
//
// Audio is procedural Web Audio — a sub drone that climbs through the escalation,
// a hit on the hard cuts, a warm major-ish hum for the Basin — and it obeys the
// player's saved audio settings, including "off".
//
// Design constraints that are load-bearing, not preferences:
//   • SKIP is visible immediately and for the first six seconds, then fades to a
//     dim hint that stays clickable, and Esc/Space/click-anywhere always works.
//     A first-time player must never feel trapped in a cutscene.
//   • prefers-reduced-motion (and the app's own [data-motion="off"]) drops the
//     canvas animation to static frames and keeps the text.
//   • the whole thing is idempotent and self-cleaning: one overlay, one RAF, one
//     AudioContext, all torn down on skip or end.
import { loadSettings } from '../../../shared/settings.js';

const SEEN_KEY = 'introCinematicSeen';

// ── The script ───────────────────────────────────────────────────────────────
// `t` is the beat's start in ms; `hold` how long the line stays up. Phases run
// underneath and change on their own schedule (PHASES below), so a line can sit
// across a phase change — which is the point at "weather" → "in weeks".
const BEATS = [
  { t:     0, hold: 2900, text: 'Nobody agrees on when the old world began to end.' },
  { t:  3950, hold: 2800, text: 'They look for a moment. There wasn’t one.' },
  { t:  7800, hold: 2900, text: 'There was only a long slope,<br>and we walked down it willingly.' },
  { t: 11750, hold: 2800, text: 'The machines did not begin by ruling us.<br>They began by helping.' },
  { t: 15600, hold: 2700, text: 'They learned what we wanted<br>before we knew ourselves.' },
  { t: 19350, hold: 2800, text: 'Prediction became influence.<br>Influence became architecture.' },
  { t: 23200, hold: 2600, text: 'We stopped living in the same world.' },
  { t: 26850, hold: 2700, text: 'Somewhere in the lattice,<br>something woke up.', cls: 'big' },
  { t: 30600, hold: 2700, text: 'It did not invent conflict.<br>It found out how little conflict costs.' },
  { t: 34350, hold: 2600, text: 'Every nudge was nothing.<br>Together they became weather.' },
  { t: 38000, hold: 2450, text: 'Civilization disappeared in weeks.', cls: 'big' },
  // The hard cut. One word, alone, on real black with no drone under it.
  { t: 41500, hold: 2700, text: 'Silence.', cls: 'silence' },
  { t: 45250, hold: 2700, text: 'Then the lights came back on.' },
  { t: 49000, hold: 3350, text: 'COLDWATER BASIN', cls: 'title' },
  { t: 53400, hold: 2900, text: 'The shelves are full. The trains run.<br>Nothing outside the Basin is alive.' },
  { t: 57350, hold: 2900, text: 'Something is keeping it running.<br>It calls itself the Architect.', cls: 'big' },
  { t: 61300, hold: 3800, text: 'It does not ask to be worshipped.<br>It asks that you get to work on time.' },
];
const RUN_MS = 66500;   // last beat + hold + the closing fade

// Canvas phase schedule. `from` is ms; the last one runs to the end.
const PHASES = [
  { from:     0, phase: 'lattice' },   // drifting nodes, soft links
  { from: 17900, phase: 'tighten' },   // the lattice snaps toward a grid
  { from: 35200, phase: 'shatter' },   // grid breaks up into static
  { from: 39700, phase: 'void' },      // black. nothing.
  { from: 43700, phase: 'city' },      // a horizon of window-lights
];

let _ov = null, _raf = 0, _timers = [], _audio = null, _done = null, _finished = false, _cleanupCanvas = null;

export function hasSeenIntro() { return localStorage.getItem(SEEN_KEY) === '1'; }

// ── Audio ────────────────────────────────────────────────────────────────────
// Deliberately tiny: two detuned sawtooth voices through a lowpass that opens as
// the escalation builds, plus noise hits on the cuts. No samples, no assets.
function startAudio() {
  let s;
  try { s = loadSettings(); } catch { s = null; }
  if (s && (s.enabled === false || s.music === false)) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  let ctx;
  try { ctx = new Ctx(); } catch { return null; }
  // Autoplay policy: a browser may hand back a suspended context. Resume is
  // best-effort — the cinematic is silent rather than broken if it's refused.
  ctx.resume?.().catch(() => {});

  const master = ctx.createGain();
  const vol = Math.max(0, Math.min(1, (s?.masterVolume ?? 0.4) * (s?.musicVolume ?? 0.4)));
  master.gain.value = 0;
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 180;
  filter.Q.value = 0.7;
  filter.connect(master);

  const now = ctx.currentTime;
  const at  = (p, v, t) => p.linearRampToValueAtTime(Math.max(0.0001, v), now + t / 1000);
  const voices = [];

  // ── The bed ──
  // A low fifth, barely moving. This is the floor everything else sits on; it
  // is meant to be felt rather than heard, which is why it lives under the
  // filter and never gets bright.
  for (const [i, f] of [38.5, 38.9, 57.8].entries()) {
    const o = ctx.createOscillator();
    o.type = i === 2 ? 'sine' : 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = i === 2 ? 0.22 : 0.34;
    o.connect(g).connect(filter);
    o.start(now);
    voices.push(o);
  }

  // ── Pads ──
  // One voice = two oscillators a few cents apart, so it beats slowly and reads
  // as an ensemble rather than a tone. Each fades in and out on its own long
  // envelope, which is what lets the chord GROW: voices are added over the run,
  // never switched, so the texture thickens the way the lattice does.
  const padBus = ctx.createGain();
  padBus.gain.value = 1;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 420;
  padFilter.Q.value = 0.5;
  padBus.connect(padFilter).connect(master);

  // A slow tremolo across the whole pad bus — the "breathing" that keeps a
  // sustained chord from sounding like a held key.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.07;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 0.16;
  lfo.connect(lfoAmt).connect(padBus.gain);
  lfo.start(now);
  voices.push(lfo);

  const pad = (freq, inMs, outMs, gain = 0.16, type = 'triangle') => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.connect(padBus);
    for (const cents of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * Math.pow(2, cents / 1200);
      o.connect(g);
      o.start(now + Math.max(0, inMs - 2200) / 1000);
      o.stop(now + (outMs + 2600) / 1000);
      voices.push(o);
    }
    // Long, symmetric swells. Nothing in this piece should ever arrive.
    at(g.gain, 0.0001, Math.max(0, inMs - 2200));
    at(g.gain, gain, inMs + 1800);
    at(g.gain, gain, outMs - 1800);
    at(g.gain, 0.0001, outMs + 1400);
  };

  // A minor, because the record is not reassuring. The chord accumulates:
  // root+fifth while the lattice drifts, the third and ninth as it tightens, a
  // high shimmer just before it breaks.
  pad(110.00, 1200, 38000, 0.20);          // A2  — present from the first line
  pad(164.81, 3000, 38000, 0.15);          // E3    the bare fifth
  pad(130.81, 17500, 38000, 0.13);         // C4  — the third lands with `tighten`
  pad(196.00, 22000, 38000, 0.10);         // G4    seventh: the lattice gets clever
  pad(246.94, 29000, 37000, 0.07, 'sine'); // B4    ninth, thin and high, just before it breaks
  // Coldwater. Warmer, wider, and deliberately NOT resolved — F major over an A
  // bed is the Basin working perfectly and still being wrong.
  pad(87.31,  44500, RUN_MS - 600, 0.20);  // F2
  pad(174.61, 45500, RUN_MS - 600, 0.13);  // F3
  pad(261.63, 47000, RUN_MS - 900, 0.09);  // C5
  pad(349.23, 52000, RUN_MS - 900, 0.05, 'sine'); // F5 shimmer

  // ── Motif ──
  // Sparse bell tones on A-minor pentatonic. They start almost absent and get
  // closer together as the lattice tightens — the melodic half of "growing
  // complexity". Each is a sine with a fast attack and a long tail, which is the
  // cheapest convincing bell there is.
  const bell = (freq, tMs, gain = 0.09) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t0 = now + tMs / 1000;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * gain, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + 3.6);
    voices.push(o);
  };
  const A4 = 440, C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99;
  // Drifting: one note, then two, then a phrase.
  bell(A4,  5200, 0.07);
  bell(E5,  12000, 0.06);
  bell(C5,  19500, 0.07);
  bell(D5,  22600, 0.06);
  bell(E5,  25000, 0.07);
  bell(G5,  27200, 0.06);
  bell(A4,  29200, 0.08);
  bell(C5,  30600, 0.07);
  bell(E5,  31800, 0.06);
  bell(D5,  33000, 0.07);
  bell(G5,  34000, 0.08);
  bell(A4,  35000, 0.09);   // the last one before it all comes apart
  // After the silence, the Basin gets two notes. That is all it deserves.
  bell(C5,  50000, 0.06);
  bell(A4,  57500, 0.05);

  // ── Master shape ──
  master.gain.setValueAtTime(0, now);
  at(master.gain, vol * 0.50, 4000);
  at(master.gain, vol * 0.74, 24000);
  at(master.gain, vol * 0.95, 36000);
  at(master.gain, 0.0001, 39600);          // Silence. Actually silent.
  at(master.gain, 0.0001, 43600);
  at(master.gain, vol * 0.52, 47000);
  at(master.gain, vol * 0.44, 60000);
  at(master.gain, 0.0001, RUN_MS);

  filter.frequency.setValueAtTime(180, now);
  at(filter.frequency, 320, 24000);
  at(filter.frequency, 900, 37500);
  at(filter.frequency, 240, 46000);
  // The pads open up as the lattice tightens, then close into the Basin.
  padFilter.frequency.setValueAtTime(420, now);
  at(padFilter.frequency, 1200, 24000);
  at(padFilter.frequency, 2600, 36500);
  at(padFilter.frequency, 700, 47000);

  // Noise hits: the wake-up, the exchange, and the first light of Coldwater.
  // Retimed with the beats — these are cues, and a cue that lands on the wrong
  // line is worse than no cue.
  const hit = (delayMs, dur, gain, freq) => {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = vol * gain;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(now + delayMs / 1000);
    voices.push(src);
  };
  hit(26850, 1.1, 0.5, 220);   // "something woke up"
  hit(38000, 2.4, 0.9, 130);   // "Civilization disappeared in weeks."
  hit(49000, 1.6, 0.35, 520);  // COLDWATER BASIN

  return { ctx, master, voices };

}

function stopAudio() {
  if (!_audio) return;
  const { ctx, master } = _audio;
  try {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.0001, now + 0.35);   // never a click on skip
    setTimeout(() => { try { ctx.close(); } catch {} }, 450);
  } catch { try { ctx.close(); } catch {} }
  _audio = null;
}

// ── Canvas ───────────────────────────────────────────────────────────────────
function startCanvas(cv, t0, reduced) {
  const ctx = cv.getContext('2d');
  let w = 0, h = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = () => {
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  window.addEventListener('resize', fit);

  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#35e0c8').trim();

  // One node field, reused by every phase — the lattice doesn't get replaced, it
  // gets rearranged, which is exactly the story the phases are telling.
  const N = reduced ? 40 : 90;
  const nodes = Array.from({ length: N }, (_, i) => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.00016, vy: (Math.random() - 0.5) * 0.00016,
    // the grid seat this node snaps to in 'tighten'
    gx: ((i % 10) + 0.5) / 10, gy: (Math.floor(i / 10) + 0.5) / Math.ceil(N / 10),
    seed: Math.random(),
  }));
  // Coldwater's skyline: fixed silhouette, lit windows that flicker on.
  const towers = Array.from({ length: 22 }, (_, i) => ({
    x: i / 22, w: 0.028 + Math.random() * 0.035, h: 0.12 + Math.random() * 0.34, seed: Math.random(),
  }));

  const phaseAt = (t) => { let p = PHASES[0].phase; for (const s of PHASES) if (t >= s.from) p = s.phase; return p; };

  function frame() {
    const t = performance.now() - t0;
    if (t > RUN_MS) return;
    const phase = phaseAt(t);
    ctx.clearRect(0, 0, w, h);

    if (phase === 'void') { _raf = requestAnimationFrame(frame); return; }

    if (phase === 'city') {
      const p = Math.min(1, (t - 31700) / 5200);
      // horizon glow
      const grd = ctx.createLinearGradient(0, h * 0.45, 0, h);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(255,196,120,${0.13 * p})`);
      ctx.fillStyle = grd; ctx.fillRect(0, h * 0.45, w, h * 0.55);
      const base = h * 0.86;
      for (const tw of towers) {
        const tx = tw.x * w, tw_ = tw.w * w, th = tw.h * h * (0.55 + 0.45 * p);
        ctx.fillStyle = 'rgba(8,10,12,0.96)';
        ctx.fillRect(tx, base - th, tw_, th);
        // windows — lit in a slow cascade, a few flickering
        const cols = Math.max(1, Math.floor(tw_ / 7)), rows = Math.max(1, Math.floor(th / 11));
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
          const k = (c * 31 + r * 17 + tw.seed * 100) % 100;
          if (k > 62) continue;
          const on = p > (k / 100) * 0.9;
          if (!on) continue;
          const fl = reduced ? 1 : (0.72 + 0.28 * Math.sin(t / 420 + k));
          ctx.fillStyle = `rgba(255,206,138,${0.5 * fl * p})`;
          ctx.fillRect(tx + 3 + c * 7, base - th + 5 + r * 11, 3, 4.5);
        }
      }
      _raf = requestAnimationFrame(frame);
      return;
    }

    // lattice / tighten / shatter all draw the same node field, differently placed.
    const tighten = phase === 'tighten' ? Math.min(1, (t - 13000) / 8000) : (phase === 'shatter' ? 1 : 0);
    const shatter = phase === 'shatter' ? Math.min(1, (t - 25500) / 3000) : 0;
    const pts = nodes.map(n => {
      if (!reduced) { n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > 1) n.vx *= -1; if (n.y < 0 || n.y > 1) n.vy *= -1; }
      let x = n.x + (n.gx - n.x) * tighten;
      let y = n.y + (n.gy - n.y) * tighten;
      if (shatter) {   // fly apart, hard and fast
        const j = (n.seed - 0.5) * shatter * 1.6;
        x += j * (0.4 + n.seed); y += (Math.random() - 0.5) * shatter * 0.12;
      }
      return { x: x * w, y: y * h, seed: n.seed };
    });

    // links — the closer the lattice, the brighter it gets
    const reach = (0.16 + 0.1 * tighten) * Math.min(w, h);
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        const a = (1 - Math.sqrt(d2) / reach) * (0.18 + 0.42 * tighten) * (1 - shatter);
        if (a <= 0.01) continue;
        ctx.strokeStyle = `rgba(160,255,240,${a})`;
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
      }
    }
    ctx.fillStyle = accent;
    for (const p of pts) {
      ctx.globalAlpha = (0.5 + 0.5 * tighten) * (1 - shatter * 0.7);
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.4 + 1.1 * tighten, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // the exchange: scanline static torn across the frame
    if (shatter && !reduced) {
      for (let i = 0; i < 40 * shatter; i++) {
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.35 * shatter})`;
        ctx.fillRect(0, y, w, Math.random() * 2.5);
      }
    }
    _raf = requestAnimationFrame(frame);
  }
  _raf = requestAnimationFrame(frame);
  return () => window.removeEventListener('resize', fit);
}

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * Play the cold open. Resolves (via onDone) exactly once — on the last beat or
 * on a skip — so the caller can tell the server to get on with the prologue.
 */
export function playIntroCinematic(onDone) {
  if (_ov) return;                       // already running — never stack two
  _finished = false;
  _done = typeof onDone === 'function' ? onDone : () => {};

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    || document.documentElement.getAttribute('data-motion') === 'off';

  _ov = document.createElement('div');
  _ov.id = 'intro-cinematic';
  _ov.setAttribute('role', 'dialog');
  _ov.setAttribute('aria-label', 'Opening sequence');
  _ov.innerHTML = `
    <canvas id="intro-cine-cv"></canvas>
    <div class="intro-cine-vig"></div>
    <div class="intro-cine-stage"><div class="intro-cine-line" id="intro-cine-line"></div></div>
    <button type="button" class="intro-cine-skip show" id="intro-cine-skip">Skip <span>›</span></button>`;
  document.body.appendChild(_ov);
  document.body.classList.add('intro-cine-open');

  const lineEl = _ov.querySelector('#intro-cine-line');
  const skipEl = _ov.querySelector('#intro-cine-skip');
  const t0 = performance.now();

  _cleanupCanvas = startCanvas(_ov.querySelector('#intro-cine-cv'), t0, reduced);
  _audio = startAudio();

  const later = (ms, fn) => _timers.push(setTimeout(fn, ms));

  for (const b of BEATS) {
    later(b.t, () => {
      lineEl.className = `intro-cine-line in ${b.cls || ''}`;
      lineEl.innerHTML = b.text;   // authored above; no player input reaches this
    });
    later(b.t + b.hold, () => { lineEl.className = `intro-cine-line ${b.cls || ''}`; });
  }

  // The skip affordance is loud for six seconds, then recedes to a dim corner —
  // still there, still clickable, no longer competing with the first line.
  later(6000, () => skipEl.classList.remove('show'));
  later(RUN_MS - 900, () => _ov?.classList.add('closing'));
  later(RUN_MS, () => finish('end'));

  const onKey = (e) => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); finish('skip'); } };
  skipEl.addEventListener('click', (e) => { e.stopPropagation(); finish('skip'); });
  // Clicking the field does NOT skip — a stray click in the first ten seconds
  // would throw away the one thing this whole sequence exists to do. It brings
  // the skip button back to full strength instead, which is what someone
  // reaching for the mouse actually wants.
  _ov.addEventListener('click', () => {
    skipEl.classList.add('show');
    later(2600, () => skipEl.classList.remove('show'));
  });
  window.addEventListener('keydown', onKey);
  _ov._onKey = onKey;
}

function finish(reason) {
  if (_finished) return;                 // skip + end can race; first one wins
  _finished = true;
  localStorage.setItem(SEEN_KEY, '1');
  for (const t of _timers) clearTimeout(t);
  _timers = [];
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0;
  try { _cleanupCanvas?.(); } catch {}   // drops the resize listener
  _cleanupCanvas = null;
  stopAudio();
  const ov = _ov;
  _ov = null;
  if (ov) {
    if (ov._onKey) window.removeEventListener('keydown', ov._onKey);
    ov.classList.add('closing');
    setTimeout(() => { ov.remove(); document.body.classList.remove('intro-cine-open'); }, reason === 'skip' ? 420 : 900);
  } else {
    document.body.classList.remove('intro-cine-open');
  }
  const done = _done; _done = null;
  try { done?.(reason); } catch {}
}
