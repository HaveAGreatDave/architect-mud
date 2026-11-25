// BREAKING WAVES ON THE OPEN SEA: which crests are breaking, where, and how far through it they are.
//
// The sea in sea-swell.js is a height field, and a height field can't overturn, so a wave there can
// steepen but never break. This file adds breakers as EVENTS laid on top of it: a stretch of a
// wind-sea crest that, for a few seconds, steepens, throws its lip, plunges and leaves foam. The
// renderer draws the curl, foam and spray from them, and a hull takes a shove from them.
//
// Like the sea itself and fish.js, a breaker is a pure function of place and the sea clock. Nothing
// is stored and nothing goes over the wire, so every client and the server see the same breaker at
// the same moment.
//
// How it works:
// - Crests are those of the wind sea's peak train (SEA_WIND), with its phase modulation, found by
//   a few Newton steps so a breaker sits on the crest the picture draws. The sidebands move the
//   drawn crest a little off this one; the curl is drawn on the real surface, so that's absorbed.
// - Each crest is cut into cells along its length. Each (crest, cell, epoch) is hashed once, and
//   it breaks during that epoch if the hash says so. The chance is set so breaking covers
//   BREAK_SHARE of Monahan's whitecap fraction for the wind; the chop's own whitecaps cover the rest.
// - Epochs divide SEA_PERIOD_S exactly and a breaker lives inside one epoch, so nothing jumps when
//   seaClock wraps.
//
// Surf breakers (depth-limited, at the shore) aren't here: they need the seabed depth, which only
// the client has. sea-lip.js keeps drawing those.

import {
  SEA_WIND, SEA_PH, SEA_K, SEA_PERIOD_S,
  seaToFrame, seaFromFrame, seaWind, whitecapFraction,
} from './sea-swell.js';

// What share of the whitecap coverage comes from these breakers rather than from the chop's threshold.
export const BREAK_SHARE = 0.5;
// Epochs per sea period. 64 gives 9.82 s each, which has to be a whole fraction of the period.
export const BREAK_EPOCHS = 64;
export const BREAK_EPOCH_S = SEA_PERIOD_S / BREAK_EPOCHS;
// How long a breaker lasts, in seconds. The wind sea's period is about 22 s; a breaker is a few seconds of it.
export const BREAK_LIFE_S = 5;
// Cell length along the crest, and how much of a cell a breaker spans, in wavelengths and cells.
export const BREAK_CELL = 0.8;
export const BREAK_LEN_LO = 0.4, BREAK_LEN_HI = 0.9;
// The breaker's footprint across the crest, in wavelengths: ahead on the face, and behind in the foam.
export const BREAK_AHEAD = 0.12, BREAK_BEHIND = 0.18;
// Which breakers plunge rather than spill: the tallest crests of a strong sea. Read off the crest's
// height against its own sea (env, the wind sea at amplitude 1, 1.8 to 2.3 on a breaking crest at
// every wind) and not off its absolute steepness, which moves with the fetch tune: at the game's
// 50 km fetch no crest is ever steep enough by k·A alone. The bar is the tallest third at 45 kt and
// rises BREAK_PLUNGE_PER_KT for every knot below that: about one in twelve at 38 kt, none at 30.
export const BREAK_PLUNGE_ENV = 2.126;
export const BREAK_PLUNGE_PER_KT = 0.03;
export const BREAK_PLUNGE_FULL_KT = 45;

// Where in its life a breaker is: steepen, throw, plunge, foam. Phase boundaries.
export const BREAK_STAGES = [0.25, 0.5, 0.75];
export function breakerStage(phase) {
  return phase < BREAK_STAGES[0] ? 'steepen' : phase < BREAK_STAGES[1] ? 'throw' : phase < BREAK_STAGES[2] ? 'plunge' : 'foam';
}
// How hard the breaker is hitting at this phase, 0..1: nothing while it steepens, peaking as the
// lip lands, gone by the time it's just foam. What a hull or a swimmer feels.
export function breakerForce(phase) {
  if (phase <= 0.2 || phase >= 0.85) return 0;
  return phase < 0.55 ? (phase - 0.2) / 0.35 : (0.85 - phase) / 0.3;
}

const K = Math.hypot(SEA_WIND.ku, SEA_WIND.kv);
const KX = SEA_WIND.ku / K, KY = SEA_WIND.kv / K;   // across the crest, frame units
const EX = -KY, EY = KX;                            // along the crest
const LAMBDA = 2 * Math.PI / K;                     // wavelength, frame units
const CELL = BREAK_CELL * LAMBDA;
const PH_K = SEA_PH.ku * KX + SEA_PH.kv * KY;       // d(phase-mod argument)/d(across)
const PH_E = SEA_PH.ku * EX + SEA_PH.kv * EY;
const LEN_MEAN = (BREAK_LEN_LO + BREAK_LEN_HI) / 2;
const DUTY = BREAK_LIFE_S / BREAK_EPOCH_S;
const FOOT = BREAK_AHEAD + BREAK_BEHIND;

// The chance a (crest, cell, epoch) breaks, for a wind in knots.
export function breakChance(kt) {
  const target = BREAK_SHARE * whitecapFraction(kt);
  return Math.min(1, target / (DUTY * LEN_MEAN * FOOT));
}

// FNV-1a over three ints, then murmur3's finaliser: plain FNV clusters keys that differ in the last digit.
function hash(a, b, c, salt) {
  let h = 2166136261 ^ salt;
  for (const x of [a | 0, b | 0, c | 0]) {
    h = Math.imul(h ^ (x & 0xffff), 16777619);
    h = Math.imul(h ^ (x >>> 16), 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Across-crest position of crest n at along-crest s, in frame units: solves the wind train's
// phase = pi/2 + 2 pi n, phase modulation included.
function crestAcross(n, s, t) {
  const target = Math.PI / 2 + 2 * Math.PI * n;
  const base = SEA_WIND.w * t;
  let a = (target - base) / K;
  for (let i = 0; i < 4; i++) {
    const arg = SEA_PH.ku * (a * KX + s * EX) + SEA_PH.kv * (a * KY + s * EY) + SEA_PH.w * t;
    const f = K * a + base + SEA_WIND.pm * Math.sin(arg) - target;
    const df = K + SEA_WIND.pm * Math.cos(arg) * PH_K;
    a -= f / df;
  }
  return a;
}

// Frame vector to a unit world vector.
function worldDir(fx, fy) {
  const o = seaFromFrame(0, 0), p = seaFromFrame(fx, fy);
  const dx = p[0] - o[0], dy = p[1] - o[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

// Every breaker within r tiles of (x, y) at sea time t, for a wind of kt knots and a wind-sea
// amplitude windA (tiles, from seaAmpsFor). Each:
//   { id, x, y, dir: [dx, dy] travel, along: [ax, ay], len, ahead, behind (tiles),
//     height (tiles, the crest's wind-sea height), ka, phase 0..1, kind: 'spill'|'plunge' }
export function breakersNear(x, y, r, t, kt, windA) {
  const out = [];
  const p = breakChance(kt);
  if (!(p > 0) || !(windA > 0)) return out;
  const e = Math.floor(t / BREAK_EPOCH_S) % BREAK_EPOCHS;
  const tl = t - e * BREAK_EPOCH_S;
  const [fx, fy] = seaToFrame(x, y);
  const rf = r * SEA_K + LAMBDA;                       // a crest's length can reach in from outside r
  const a0 = fx * KX + fy * KY, s0 = fx * EX + fy * EY;
  const base = SEA_WIND.w * t;
  const nLo = Math.floor((K * (a0 - rf) + base - Math.PI / 2 - SEA_WIND.pm) / (2 * Math.PI));
  const nHi = Math.ceil((K * (a0 + rf) + base - Math.PI / 2 + SEA_WIND.pm) / (2 * Math.PI));
  const jLo = Math.floor((s0 - rf) / CELL), jHi = Math.floor((s0 + rf) / CELL);
  const dir = worldDir(-KX, -KY), along = worldDir(EX, EY);
  for (let n = nLo; n <= nHi; n++) {
    for (let j = jLo; j <= jHi; j++) {
      if (hash(n, j, e, 1) >= p) continue;
      const start = hash(n, j, e, 2) * (BREAK_EPOCH_S - BREAK_LIFE_S);
      const phase = (tl - start) / BREAK_LIFE_S;
      if (phase < 0 || phase > 1) continue;
      const lenF = CELL * (BREAK_LEN_LO + (BREAK_LEN_HI - BREAK_LEN_LO) * hash(n, j, e, 3));
      const s = (j + 0.5 + (hash(n, j, e, 4) - 0.5) * 0.3) * CELL;
      const a = crestAcross(n, s, t);
      const [wx, wy] = seaFromFrame(a * KX + s * EX, a * KY + s * EY);
      const reach = lenF / 2 / SEA_K;
      if (Math.hypot(wx - x, wy - y) > r + reach + LAMBDA / SEA_K) continue;
      const env = Math.max(0.3, seaWind(wx, wy, t, 1));
      const plungeAt = BREAK_PLUNGE_ENV + Math.max(0, BREAK_PLUNGE_FULL_KT - kt) * BREAK_PLUNGE_PER_KT;
      const height = env * windA;
      const ka = SEA_WIND.k * SEA_K * height;
      out.push({
        id: `${n}:${j}:${e}`, x: wx, y: wy, dir, along,
        len: lenF / SEA_K, ahead: BREAK_AHEAD * LAMBDA / SEA_K, behind: BREAK_BEHIND * LAMBDA / SEA_K,
        height, ka, env, phase, kind: env > plungeAt ? 'plunge' : 'spill',
      });
    }
  }
  return out;
}

// ── THE SHAPE, FOR THE SEA'S SHADERS (gl/water.js) ───────────────────────────────────────────
//
// What a breaker does to the surface. Per breaker, x across the crest (positive ahead, the way it's
// travelling) and a along it:
// - lift: the crest stands up taller and sharper, a narrow bump just ahead of the crest that rises
//   while it steepens and throws, and drops away as it collapses;
// - hollow: the trough just ahead deepens, so the face the lip falls down is taller than the
//   crest alone; half the lift, wider, a third of a wavelength ahead;
// - fold: the top runs ahead of its base, written as the vertex sliding forward by a bump of its
//   own, as seaBreakFold does in the surf. Its Jacobian J goes toward 0 on the face, which steepens
//   the lighting there and is where the lip is going over. Plunging breakers fold further.
// Both taper off the breaker's ends. The JS twin is breakerShape, for the gate and for hulls.
export const BREAK_MAX = 24;                 // breakers uploaded per frame, nearest first
// The lift is the crest's own height again. At the game's 50 km fetch a gale's wind sea is gentle
// (k·A about 0.08), and 0.4 of it over the old 0.12-wavelength bump changed no pixel by more than
// 15 levels from any seat: measured, not guessed. A breaking crest is the steepest thing in the sea.
export const BREAK_LIFT = 1.0;               // crest lift at its height, as a share of the crest
export const BREAK_SIGMA = 0.08;             // width of the lift and fold bumps, in wavelengths
export const BREAK_HOLLOW = 0.5;             // depth of the hollow ahead, as a share of the lift
export const BREAK_HOLLOW_AT = 0.3;          // where the hollow is, in wavelengths ahead
export const BREAK_HOLLOW_W = 2.0;           // its width, in lift widths
// How far behind the crest a breaker's white water reaches by the end of its life, in wavelengths.
export const BREAK_TRAIL = 0.4;
export const BREAK_LAMBDA_T = LAMBDA / SEA_K;   // the wind sea's wavelength in tiles
export function breakerLiftAt(phase) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ss(0, 0.35, phase) * (1 - ss(0.55, 0.8, phase));
}
export function breakerFoldAt(phase, plunge) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ss(0.15, 0.5, phase) * (1 - ss(0.6, 0.85, phase)) * (plunge ? 1 : 0.6);
}
// { dh (tiles), fx (tiles of forward slide), J } for one breaker at (x, y).
export function breakerShape(b, x, y) {
  const dx = x - b.x, dy = y - b.y;
  const ax = dx * b.dir[0] + dy * b.dir[1];
  const al = Math.abs(dx * b.along[0] + dy * b.along[1]);
  const t = Math.min(1, Math.max(0, (al / (b.len / 2) - 0.55) / 0.45));
  const el = 1 - t * t * (3 - 2 * t);
  const sg = BREAK_SIGMA * BREAK_LAMBDA_T, x0 = 0.25 * sg;
  const u = (ax - x0) / sg, v = ax / sg, w = (ax - BREAK_HOLLOW_AT * BREAK_LAMBDA_T) / (BREAK_HOLLOW_W * sg);
  const g = Math.exp(-u * u) - BREAK_HOLLOW * Math.exp(-w * w), e = Math.exp(-v * v);
  const F = breakerFoldAt(b.phase, b.kind === 'plunge') * el;
  const lift = (b.kind === 'plunge' ? 1.25 : 1) * BREAK_LIFT;
  return { dh: lift * b.height * breakerLiftAt(b.phase) * el * g, fx: F * 0.95 * sg * e, J: 1 - 1.9 * F * (ax / sg) * e };
}

const gf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
// uBrkP[i] = (x, y, dir.x, dir.y) in the window frame the wakes use; uBrkS[i] = (half length,
// crest height in tiles, phase, 1 if plunging). seaBreakers adds into h, the slide, the slope and J.
export const BREAK_GLSL = `
#define BREAK_MAX ${BREAK_MAX}
uniform highp int uNBrk;   // highp in both stages, or the link fails on differing precisions
uniform vec4 uBrkP[BREAK_MAX];
uniform vec4 uBrkS[BREAK_MAX];
void seaBreakers(vec2 w, float amt, inout float h, inout vec2 slide, inout vec2 grad, inout float J, inout vec2 jDir) {
  const float SG = ${gf(BREAK_SIGMA * BREAK_LAMBDA_T)};
  const float X0 = ${gf(0.25 * BREAK_SIGMA * BREAK_LAMBDA_T)};
  const float REACH = ${gf(0.6 * BREAK_LAMBDA_T)};
  const float HX = ${gf(BREAK_HOLLOW_AT * BREAK_LAMBDA_T)};
  const float HW = ${gf(BREAK_HOLLOW_W * BREAK_SIGMA * BREAK_LAMBDA_T)};
  for (int i = 0; i < BREAK_MAX; i++) {
    if (i >= uNBrk) break;
    vec4 P = uBrkP[i], S = uBrkS[i];
    vec2 q = w - P.xy;
    float ax = dot(q, P.zw);
    if (abs(ax) > REACH) continue;
    float al = abs(dot(q, vec2(-P.w, P.z)));
    float el = 1.0 - smoothstep(0.55, 1.0, al / S.x);
    if (el <= 0.0) continue;
    float ph = S.z;
    float lift = smoothstep(0.0, 0.35, ph) * (1.0 - smoothstep(0.55, 0.8, ph));
    float F = smoothstep(0.15, 0.5, ph) * (1.0 - smoothstep(0.6, 0.85, ph)) * mix(0.6, 1.0, S.w) * el * amt;
    float u = (ax - X0) / SG;
    float k = ${gf(BREAK_LIFT)} * mix(1.0, 1.25, S.w) * S.y * lift * el * amt;
    float o = (ax - HX) / HW;
    float eu = exp(-u * u), eo = ${gf(BREAK_HOLLOW)} * exp(-o * o);
    h += k * (eu - eo);
    grad += P.zw * (k * (-2.0 * u / SG * eu + 2.0 * o / HW * eo));
    float v = ax / SG, e = exp(-v * v);
    slide += P.zw * (F * 0.95 * SG * e);
    float Jb = 1.0 - 1.9 * F * v * e;
    if (Jb < J) { J = Jb; jDir = P.zw; }
  }
}
// The white water a breaker makes, 0..1, at w. 'froth' is the chop's own 0..1 froth field, which
// tears the edges so none of it is a ruled shape. Two pieces:
// - the face: once the lip lands (phase 0.22 on) a band of white on the crest and just ahead of it,
//   wider on a plunger, gone by the end of its life;
// - the trail: a blanket behind the crest, the water the breaker has already gone through, longer
//   the older the breaker is and thinning to lace at its far end.
// The water shader draws this live; gl/sea-foam.js lays it into the foam field, which is what keeps
// it in the water after the breaker has moved on.
float seaBreakerFoam(vec2 w, float froth, float amt) {
  const float L = ${gf(BREAK_LAMBDA_T)};
  float f = 0.0;
  for (int i = 0; i < BREAK_MAX; i++) {
    if (i >= uNBrk) break;
    vec4 P = uBrkP[i], S = uBrkS[i];
    vec2 q = w - P.xy;
    float ax = dot(q, P.zw);
    if (ax > 0.2 * L || ax < -${gf(BREAK_TRAIL)} * L) continue;
    float al = abs(dot(q, vec2(-P.w, P.z))) / S.x + 0.3 * (froth - 0.5);
    float el = 1.0 - smoothstep(0.7, 1.0, al);
    if (el <= 0.0) continue;
    float ph = S.z, pl = S.w;
    float act = smoothstep(0.22, 0.45, ph) * (1.0 - smoothstep(0.82, 1.0, ph));
    float fw = (0.05 + 0.04 * pl) * L;
    float fu = (ax - 0.03 * L) / fw;
    float face = exp(-fu * fu) * act;
    float len = ${gf(BREAK_TRAIL)} * L * smoothstep(0.3, 1.0, ph) + 1e-4;
    float back = clamp(-ax / len, 0.0, 1.0);
    float trail = ax < 0.03 * L ? smoothstep(0.0, 0.45, (1.0 - back) + 0.6 * (froth - 0.5)) : 0.0;
    trail *= smoothstep(0.3, 0.5, ph) * (1.0 - smoothstep(0.88, 1.0, ph)) * mix(0.75, 1.0, pl);
    f = max(f, el * amt * max(face * mix(0.85, 1.0, pl), trail * (0.55 + 0.45 * (1.0 - back))));
  }
  return f;
}
`;

// The breakers to upload for a frame: the nearest BREAK_MAX within r tiles of (x, y), packed for
// uBrkP and uBrkS. Returns null when there are none, so the shader skips its loop. The two arrays
// are reused frame to frame (the renderer uploads them at once), so a frame makes no garbage.
const UP_P = new Float32Array(BREAK_MAX * 4), UP_S = new Float32Array(BREAK_MAX * 4);
export function breakerUpload(x, y, r, t, kt, windA) {
  const bs = breakersNear(x, y, r, t, kt, windA);
  if (!bs.length) return null;
  bs.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  const n = Math.min(BREAK_MAX, bs.length);
  const P = UP_P, S = UP_S;
  for (let i = 0; i < n; i++) {
    const b = bs[i];
    P.set([b.x, b.y, b.dir[0], b.dir[1]], i * 4);
    S.set([b.len / 2, b.height, b.phase, b.kind === 'plunge' ? 1 : 0], i * 4);
  }
  return { n, P, S, list: bs.slice(0, n) };
}

// The breaker whose footprint covers (x, y), with how hard it's hitting there, or null. For a hull
// or a swimmer: the footprint runs from `behind` the crest to `ahead` of it, and tapers at the ends.
export function breakerAt(x, y, t, kt, windA) {
  let best = null, bestF = 0;
  for (const b of breakersNear(x, y, 0, t, kt, windA)) {
    const dx = x - b.x, dy = y - b.y;
    const across = dx * b.dir[0] + dy * b.dir[1];
    const al = Math.abs(dx * b.along[0] + dy * b.along[1]);
    if (across > b.ahead || across < -b.behind || al > b.len / 2) continue;
    const taper = Math.min(1, (b.len / 2 - al) / (0.15 * b.len));
    const f = breakerForce(b.phase) * taper;
    if (!best || f > bestF) { best = b; bestF = f; }
  }
  return best ? { ...best, force: bestF } : null;
}
