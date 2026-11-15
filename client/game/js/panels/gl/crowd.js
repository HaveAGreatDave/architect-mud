// GLASS · THE CROWD. Every seat's fan, instanced: gl/fan-vat.js's figure, his clips baked into a
// texture, and a vertex shader (FAN_GLSL) that plays them by how loud his side is. A fan gets up
// when the roar passes his own threshold, a hash of his seat, so a big play brings the whole stand
// up and a small one a few; up and cheering he bounces and sways on his own beat. Nothing is
// stepped: the pose is a function of the roar and the time, so a stopped clock draws the same crowd.
//
// The roar (`createRoar`) is a pure function of time too: each cheer rises, holds and falls away,
// and the loudest at any moment is the side's. The view (gameday-grandstand.js) cheers on the plays
// and hands the renderer the two levels each frame (ballpark.js setCrowd). Which fans are whose
// is a hash of the seat as well: most are the home side's, more of the visitors' up the third-base
// line by their dugout.
//
// Pure apart from the shader's source: no DOM and no GL.
import { FAN_CLIPS, FAN_PART, FAN_GROUP } from './fan-vat.js';

// How a cheer comes and goes (s): up over `rise`, held, and gone over `fall`.
export const ROAR = Object.freeze({ rise: 0.35, fall: 2.2 });

// How a cheer moves the fans, apart from how it sounds (s). The noise goes first and they follow
// `late` after it; however long the noise holds they're up for `hold` at most and back down over
// `fall`, so a big moment is a punch that settles. A cheer that lands while the last one still has
// them up builds on it by `build` of what's left, so a rally keeps them up and climbing.
export const STIR = Object.freeze({ late: 0.25, hold: 2.5, fall: 3, build: 0.5 });

// The two sides' roars: `cheer(side, amp, at, hold)` (side 0 the home fans, 1 the visitors';
// amp 0 to 1; at and hold in seconds of the game's clock), and `at(t)` the two levels then.
export function createRoar() {
  let cheers = [];
  const endOf = (c) => c.at + Math.max(ROAR.rise + c.hold + ROAR.fall, STIR.late + ROAR.rise + STIR.hold + STIR.fall);
  const stirOf = (t) => {
    const out = [0, 0];
    for (const c of cheers) {
      const x = t - c.at - STIR.late, hold = Math.min(c.hold, STIR.hold);
      if (x < 0) continue;
      const k = x < ROAR.rise ? x / ROAR.rise : x < ROAR.rise + hold ? 1 : Math.max(0, 1 - (x - ROAR.rise - hold) / STIR.fall);
      out[c.side] = Math.max(out[c.side], (c.stir ?? c.amp) * k);
    }
    return out;
  };
  return {
    cheer(side, amp, at, hold = 1.5) {
      if (!(amp > 0) || !Number.isFinite(at)) return;
      side = side ? 1 : 0;
      const stir = Math.min(1, amp + STIR.build * stirOf(at)[side]);
      cheers.push({ side, amp: Math.min(1, amp), stir, at, hold: Math.max(0, hold) });
    },
    // how stirred each side's fans are at t: what the renderer moves them by (STIR)
    stir: (t) => stirOf(t),
    at(t) {
      const out = [0, 0];
      for (const c of cheers) {
        const x = t - c.at;
        if (x < 0) continue;
        const k = x < ROAR.rise ? x / ROAR.rise : x < ROAR.rise + c.hold ? 1 : Math.max(0, 1 - (x - ROAR.rise - c.hold) / ROAR.fall);
        out[c.side] = Math.max(out[c.side], c.amp * k);
      }
      return out;
    },
    // a cheer that's over by t is forgotten
    prune(t) { cheers = cheers.filter((c) => endOf(c) > t); },
    clear() { cheers = []; },
    get size() { return cheers.length; },
  };
}

// How late each fan hears the roar (s): a fan takes one of these, by a hash of his seat, and gets
// up on the roar as it was that long ago, so a cheer runs through the stand over a second instead
// of bringing whole sections up on the same frame. `createRoarLag()` keeps the levels the renderer
// is handed and gives them back at each lag: `push(t, home, away)`, then `home` and `away` are
// four levels each, LAG[0] to LAG[3] ago. A clock that runs backwards (a replay) starts it afresh.
export const LAG = Object.freeze([0, 0.3, 0.65, 1.1]);
export function createRoarLag() {
  let hist = [];
  const home = [0, 0, 0, 0], away = [0, 0, 0, 0];
  const at = (t, side) => {
    for (let i = hist.length - 1; i > 0; i--) {
      const a = hist[i - 1], z = hist[i];
      if (a.t <= t) return z.t > a.t ? a[side] + (z[side] - a[side]) * Math.min(1, (t - a.t) / (z.t - a.t)) : z[side];
    }
    return hist.length ? hist[0][side] : 0;
  };
  return {
    push(t, h, a) {
      if (!Number.isFinite(t)) return;
      if (hist.length && t < hist[hist.length - 1].t) hist = [];
      hist.push({ t, h: +h || 0, a: +a || 0 });
      while (hist.length > 2 && hist[1].t < t - LAG[3]) hist.shift();
      for (let i = 0; i < 4; i++) { home[i] = at(t - LAG[i], 'h'); away[i] = at(t - LAG[i], 'a'); }
    },
    home, away,
  };
}

// The crowd's camera flashes at night. A window of FLASH.window seconds has one at most, between a
// tenth and nine tenths of the way through it, so three in a row span at least 1.2 windows and no
// second of the picture ever has more than two; whether a window has one is a hash
// of it against how loud the louder side is (a few a minute in a quiet park, nearly every window on
// a home run), and which fan, and when in the window, are hashed too. Each is a small point of
// light at his face, gone in FLASH.life. `flashesAt(t, loud, n)`: those burning at t (s) for a roar
// of `loud` (0 to 1) among n fans, as [{ i (his index), age (s) }].
export const FLASH = Object.freeze({ window: 0.85, life: 0.12, quiet: 0.06, loud: 0.9 });
function hash01(k, salt) {
  let h = Math.imul((k | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export function flashesAt(t, loud, n) {
  const out = [];
  if (!(n > 0) || !Number.isFinite(t)) return out;
  const p = FLASH.quiet + (FLASH.loud - FLASH.quiet) * Math.min(1, Math.max(0, loud || 0)), k1 = Math.floor(t / FLASH.window);
  for (let k = k1 - 1; k <= k1; k++) {
    if (hash01(k, 1) >= p) continue;
    const at = (k + 0.1 + 0.8 * hash01(k, 2)) * FLASH.window, age = t - at;
    if (age >= 0 && age < FLASH.life) out.push({ i: Math.floor(hash01(k, 3) * n), age });
  }
  return out;
}

// How many fans at most are drawn at gl/fan-vat.js's near level, a frame: a long lens across a full
// stand would otherwise bring thousands of them over the height, at three times the far level's cost.
export const NEAR_MAX = 400;
// The height on the screen (device px) from which a fan is drawn at the near level: `nearPx`, or
// higher when more than NEAR_MAX fans in `px` (each fan's height, the first `n`) reach it, so only the
// NEAR_MAX biggest do.
export function nearCut(px, n, nearPx, max = NEAR_MAX) {
  const over = [];
  for (let i = 0; i < n; i++) if (px[i] >= nearPx) over.push(px[i]);
  if (over.length <= max) return nearPx;
  over.sort((a, b) => b - a);
  return over[max] + 1e-3;
}

// ── THE FANS' POSE (FAN_GLSL), shared by the park's crowd (CROWD_VS) and the rink's (gl/arena-crowd.js) ──
// Each fan is gl/fan-vat.js's figure, his clips baked into a texture (uVat, a column a vertex and a row
// a frame, the last column his head's pivot), so the shader poses him with a texel fetch for each clip
// he's in and the CPU does nothing a frame. Everything about him comes off his seat by hash, as before:
// his side, how keen he is, how he sits, what he does on his feet, his build, whether he's a woman,
// his hair, cap, beard and glasses, and his eyes.
//
//   · SAT, he sits one of four ways (back with his hands in his lap, at rest, leant forward, arms
//     folded), on his own slow beat. A little noise from his side and he claps where he sits; when
//     the other side are roaring, a third of the quiet ones put their hands on their heads.
//   · UP, past his own threshold, he gets to his feet through the baked rise (played by how far up he
//     is, not the clock), then cheers one of four ways: both arms pumping, clapping, a fist punched
//     up, or shouting through his hands. On a final most of them whirl a rally towel. His mouth opens
//     with the clip.
//   · HIS HEAD turns about its pivot by `look` (radians in his own frame), each part by how much it
//     follows the head (the neck fading out down to the collar).
//
// `fanPose(seat, away, base, look, shirt, skin)` fills fP (feet, his own frame: y up, facing +z, his
// tread at the origin), fN and fAlb; fFace is 1 for a part of the face, which the caller draws a hair
// toward the eye. The caller turns, places and lights him. Needs `hash`, `heard` (and through it uLagH
// and uLagA), uT and uMove declared before it.
const glf = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const CLIP_GLSL = FAN_CLIPS.map((c) => `const vec4 C_${c.name.toUpperCase()} = vec4(${glf(c.row0)}, ${glf(c.frames)}, ${c.once ? '1.0' : '0.0'}, ${glf(c.dur)});`).join('\n');
const PART_GLSL = Object.entries(FAN_PART).map(([k, v]) => `const int P_${k.toUpperCase()} = ${v};`).join('\n');
const GROUP_GLSL = Object.entries(FAN_GROUP).map(([k, v]) => `const int G_${k.toUpperCase()} = ${v};`).join('\n');
// The static attributes, [location, size, byte offset] in gl/fan-vat.js's FAN_STATIC floats: part,
// group and turn; the four build offsets; the soft head's offset. Clear of the instance's 3, 4 and 5.
export const FAN_ATTRS = Object.freeze([[0, 3, 0], [1, 4, 12], [2, 3, 28]]);
// The texture unit the bake is bound to, clear of every other the park and the rink use.
export const FAN_VAT_UNIT = 13;
export const FAN_GLSL = `
uniform highp sampler2D uVat;
uniform int uVatW;
uniform float uTowel;
layout(location = 0) in vec3 aFan;
layout(location = 1) in vec4 aBody;
layout(location = 2) in vec3 aAlt;
${CLIP_GLSL}
${PART_GLSL}
${GROUP_GLSL}
vec3 fP; vec3 fN; vec3 fPv; vec3 fAlb; float fFace;
vec3 octDec(float w) {
  float u = floor(w + 0.5);
  vec2 e = vec2(mod(u, 4096.0), floor(u / 4096.0)) / 4095.0 * 2.0 - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(e.yx)) * vec2(e.x >= 0.0 ? 1.0 : -1.0, e.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
// w of clip c at phase ph (a loop's in cycles, a once clip's 0 to 1), the frames either side mixed
void vatAdd(vec4 c, float ph, float w, int col, bool piv) {
  if (w <= 0.001) return;
  float f = c.z > 0.5 ? clamp(ph, 0.0, 1.0) * (c.y - 1.0) : fract(ph) * c.y;
  float f0 = floor(f), t = f - f0;
  float f1 = c.z > 0.5 ? min(f0 + 1.0, c.y - 1.0) : mod(f0 + 1.0, c.y);
  int r0 = int(c.x + f0), r1 = int(c.x + f1);
  vec4 a = texelFetch(uVat, ivec2(col, r0), 0), b = texelFetch(uVat, ivec2(col, r1), 0);
  fP += w * mix(a.xyz, b.xyz, t); fN += w * mix(octDec(a.w), octDec(b.w), t);
  if (piv) { vec4 pa = texelFetch(uVat, ivec2(uVatW, r0), 0), pb = texelFetch(uVat, ivec2(uVatW, r1), 0); fPv += w * mix(pa.xyz, pb.xyz, t); }
}
// a loop's phase at uT for this fan: his own pace and his own start
float phaseOf(vec4 c, float pace, float at) { return uT / c.w * pace + at; }
void fanPose(vec2 seat, float away, float base, float look, vec3 shirt, vec3 skin) {
  fP = vec3(0.0); fN = vec3(0.0); fPv = vec3(0.0); fFace = 0.0;
  int col = gl_VertexID, part = int(aFan.x + 0.5), grp = int(aFan.y + 0.5);
  bool piv = aFan.z > 0.0;
  float h = hash(seat, vec2(12.99, 78.23), 43758.5), h2 = hash(seat, vec2(39.35, 11.13), 24634.6), h3 = hash(seat, vec2(53.71, 27.19), 31887.3);
  float h4 = hash(seat, vec2(17.31, 63.77), 21357.9), h5 = hash(seat, vec2(71.13, 5.29), 37771.1), h6 = hash(seat, vec2(29.81, 47.53), 17093.7);
  float h7 = hash(seat, vec2(83.37, 13.91), 28411.3), h8 = hash(seat, vec2(5.53, 41.9), 19391.7), h9 = hash(seat, vec2(88.1, 23.7), 27109.3);
  float hs = hash(seat, vec2(14.7, 92.1), 11939.3), hc = hash(seat, vec2(66.3, 8.41), 25117.9), hd = hash(seat, vec2(3.19, 57.7), 30011.1);
  float he = hash(seat, vec2(47.2, 31.3), 18803.3), hw = hash(seat, vec2(9.71, 71.9), 22441.7), hg = hash(seat, vec2(35.9, 2.71), 15559.1);
  // how loud his side is as he hears it, and the other side
  float roar = heard(seat, away), anti = heard(seat, 1.0 - away);
  // up once the roar passes his own threshold; most thresholds are high, so a single brings a
  // handful up, a big hit half the park and a home run all of it
  float thr = 0.2 + 0.72 * sqrt(h2), up = smoothstep(thr, thr + 0.12, roar);
  float k = max(min(base, 1.0) * 0.5, up), s = clamp(k * 2.0, 0.0, 1.0), c = clamp(k * 2.0 - 1.0, 0.0, 1.0);
  // sat: a clap for anything his side makes, his head in his hands for the other side's
  float clap = smoothstep(thr * 0.5, thr * 0.5 + 0.1, roar) * step(hd, 0.65);
  float despair = (1.0 - clap) * smoothstep(0.55, 0.75, anti) * step(hd, 0.33) * (1.0 - smoothstep(0.1, 0.25, roar));
  // with less motion asked for, nobody moves on the clock: each holds his own frame
  float pace = (0.85 + 0.3 * h8) * uMove, at = h * 7.0;
  float rest = 1.0 - clap - despair, blend = smoothstep(0.0, 0.35, s), sitW = (1.0 - blend) * (1.0 - c);
  // how he sits: back with his hands in his lap, at rest, leant forward, arms folded
  vec4 sv = hs < 0.4 ? C_SIT : hs < 0.65 ? C_REST : hs < 0.8 ? C_LEAN : C_FOLD;
  vatAdd(sv, phaseOf(sv, pace, at), sitW * rest, col, piv);
  vatAdd(C_SITCLAP, phaseOf(C_SITCLAP, pace, at), sitW * clap, col, piv);
  vatAdd(C_DESPAIR, phaseOf(C_DESPAIR, pace, at), sitW * despair, col, piv);
  // getting up, by how far up he is, and stood once he is
  vatAdd(C_RISE, s, blend * (1.0 - c), col, piv);
  // and on his feet: arms up, clapping, a fist, shouting through his hands; a towel on a final
  bool towel = uTowel > 0.5 && he < 0.7;
  vec4 cv = towel ? C_TOWEL : hc < 0.35 ? C_CHEER : hc < 0.65 ? C_CLAP : hc < 0.85 ? C_FIST : C_CUP;
  vatAdd(cv, phaseOf(cv, (0.85 + 0.3 * h9) * uMove, at), c, col, piv);
  vec3 p = fP, n = normalize(fN), pv = fPv;
  // who he is: a woman in five or so, and a build from slight through average to heavy
  float woman = step(hw, 0.42), b = h4;
  vec4 bw = vec4(max(0.0, 1.0 - 2.0 * b), 1.0 - abs(2.0 * b - 1.0), max(0.0, 2.0 * b - 1.0), woman);
  p += n * dot(aBody, bw) + aAlt * woman;
  // what he has on his head: a woman's hair mostly long, a man's cropped, a few bald; a cap on a
  // third of them; a beard on a quarter of the men; glasses on one in eleven
  float hair = woman > 0.5 ? (hg < 0.7 ? 2.0 : 1.0) : (hg < 0.14 ? 0.0 : hg < 0.2 ? 2.0 : 1.0);
  bool cap = h6 < 0.34, shown = grp == G_ALL || (grp == G_CROP && hair > 0.5) || (grp == G_LONG && hair > 1.5) || (grp == G_CAP && cap)
    || (grp == G_BEARD && woman < 0.5 && h7 < 0.25) || (grp == G_GLASSES && he > 0.91) || (grp == G_TOWEL && towel && c > 0.0);
  // his head turned, about its pivot
  if (piv) {
    float yaw = look * aFan.z;
    vec3 q = p - pv; float cy = cos(yaw), sy = sin(yaw);
    p = pv + vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
    n = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
  }
  // up and cheering, a bounce and a sway above the waist, each on his own beat
  float joy = up * uMove;
  p.y += joy * 0.22 * pow(0.5 + 0.5 * sin(uT * 7.0 * (0.85 + 0.3 * h8) + h * 6.283), 1.6);
  p.x += joy * max(0.0, p.y - 3.0) * 0.06 * sin(uT * 4.3 * (0.75 + 0.5 * h9) + h2 * 6.283);
  p.y *= 0.95 + 0.1 * h5;
  // what he isn't wearing, folded to one point under the stand
  if (!shown) p = vec3(0.0, -50.0, 0.0);
  fP = p; fN = n;
  // his colours: a darker skin with dark hair and brown eyes
  vec3 pants = mix(vec3(0.03, 0.04, 0.07), vec3(0.12, 0.10, 0.07), h);
  float dark = smoothstep(0.35, 0.2, dot(skin, vec3(0.33)));
  vec3 hairC = h7 < 0.3 ? vec3(0.02, 0.016, 0.012) + 0.03 * h : h7 < 0.6 ? vec3(0.09, 0.05, 0.025) : h7 < 0.8 ? vec3(0.32, 0.22, 0.1) : h7 < 0.88 ? vec3(0.45, 0.18, 0.06) : vec3(0.3, 0.29, 0.27);
  hairC = mix(hairC, vec3(0.02, 0.016, 0.012), dark);
  vec3 capC = mix(mix(vec3(0.03, 0.04, 0.12), vec3(0.32, 0.03, 0.03), step(0.17, h6)) * (0.8 + 0.4 * h7), shirt, step(0.5, h3));
  vec3 iris = mix(h9 < 0.55 ? vec3(0.1, 0.05, 0.025) : h9 < 0.75 ? vec3(0.16, 0.12, 0.05) : h9 < 0.9 ? vec3(0.08, 0.16, 0.26) : vec3(0.1, 0.17, 0.09), vec3(0.06, 0.03, 0.015), dark);
  vec3 lips = skin * mix(vec3(0.72, 0.5, 0.48), vec3(0.8, 0.28, 0.3), woman * step(h3, 0.45));
  fAlb = part == P_SKIN ? skin : part == P_SHIRT ? shirt : part == P_LEGS ? pants : part == P_SHOES ? vec3(0.02, 0.016, 0.012) + 0.05 * h
    : part == P_HAIR ? hairC : part == P_WHITE ? vec3(0.7, 0.68, 0.64) : part == P_IRIS ? iris : part == P_INK ? vec3(0.02, 0.016, 0.014)
    : part == P_BROW ? hairC * 0.6 + vec3(0.01) : part == P_LIP ? lips * 0.85 : part == P_LIPLOW ? lips : part == P_MOUTH ? vec3(0.08, 0.015, 0.02)
    : part == P_CAP ? capC : part == P_BRIM ? capC * 0.7 : part == P_BEARD ? hairC * 0.9 : part == P_LENS ? vec3(0.02, 0.025, 0.03)
    : part == P_TOWEL ? vec3(0.82, 0.62, 0.16) : part == P_SHADE ? skin * 0.55 : shirt;
  fFace = (part >= P_WHITE && part <= P_MOUTH) || part == P_BEARD || part == P_LENS || part == P_SHADE ? 1.0 : 0.0;
}`;

// The crowd's vertex shader, for gl/ballpark.js's crowd program (its fragment shader lights it).
// Per vertex the figure's static attributes (FAN_GLSL); per fan (instanced) where he sits and faces,
// his shirt and size, his skin. uBase is the pose he rests in (0 sit, 1 stand, 2 cheer), one draw
// each; uLagH and uLagA each side's levels at the four lags; uT the clock; uMove 0 for a viewer who's
// asked for less motion, who gets the crowd up without the bouncing; uLook where the play is on the
// field (x, z, and how much it holds them, 0 to 1), which the fans' heads turn to follow, each as far
// as his own interest takes him. uFanHome and uFanAway are the two clubs' colours (linear), worn
// while uFanKit is 1: 30% of the park in the home side's, 10% in the visitors'. uEyeC is the camera,
// toward which the face's parts are drawn a hair.
export const CROWD_VS = `#version 300 es
layout(location = 3) in vec4 iA;
layout(location = 4) in vec4 iB;
layout(location = 5) in vec3 iC;
uniform mat4 uVP;
uniform float uBase;
uniform vec4 uLagH; uniform vec4 uLagA;
uniform float uT;
uniform float uMove;
uniform vec3 uLook;
uniform vec4 uNear;
uniform vec3 uEyeC;
uniform vec3 uFanHome; uniform vec3 uFanAway; uniform float uFanKit;
out vec3 vPos; out vec3 vN; out vec3 vAlb;
// a number from his seat, no sin() in it: sin of a position in feet loses its low bits on a GPU, so
// neighbours drew the same number and a whole section moved in step
float hash(vec2 p, vec2 k, float m) { vec3 q = fract(vec3(p.xyx) * 0.1031 + vec3(k, m) * 0.00731); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// the roar as he hears it, late by his own lag (crowd.js LAG): uLagH and uLagA are each side's
// levels at the four lags, and he sits somewhere between two of them
float heard(vec2 seat, float away) { float l = 3.0 * hash(seat, vec2(31.7, 66.1), 22717.3); vec4 r = mix(uLagH, uLagA, away); float a = l < 1.0 ? r.x : l < 2.0 ? r.y : r.z, b = l < 1.0 ? r.y : l < 2.0 ? r.z : r.w; return mix(a, b, fract(l)); }
${FAN_GLSL}
void main() {
  // the seat a viewer sits in (ballpark.js seatFor) has nobody in it
  if (distance(iA.xyz, uNear.xyz) < uNear.w) { vPos = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vAlb = vec3(0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float h = hash(iA.xz, vec2(12.99, 78.23), 43758.5), h3 = hash(iA.xz, vec2(53.71, 27.19), 31887.3), h9 = hash(iA.xz, vec2(88.1, 23.7), 27109.3);
  // whose fan he is: a tenth of the park the visitors', thicker up the third-base line (+x) by
  // their dugout
  float away = step(hash(iA.xz, vec2(7.17, 91.3), 13371.3), iA.x > 0.0 ? 0.16 : 0.04);
  // only one in eight's head wanders sat quiet; the rest sit still and watch
  float fidget = step(hash(iA.xz, vec2(44.9, 3.71), 29399.1), 0.125);
  float c = cos(iA.w), s = sin(iA.w);
  // where his head turns: toward the play as far as his interest takes him, wandering a little of
  // its own when nothing holds him
  vec2 d = uLook.xy - iA.xz;
  float want = atan(c * d.x - s * d.y, s * d.x + c * d.y);
  float yaw = clamp(want, -0.9, 0.9) * uLook.z * (0.45 + 0.55 * h3) + 0.22 * fidget * uMove * sin(uT * 0.31 * (0.6 + 0.8 * h9) + h * 6.283) * (1.0 - 0.7 * uLook.z);
  // in his club's colour: every visitors' fan and a third of the rest; a quarter of the rest in a jacket
  float club = uFanKit * max(away, step(hash(iA.xz, vec2(61.7, 19.3), 15731.9), 1.0 / 3.0));
  float h7 = hash(iA.xz, vec2(83.37, 13.91), 28411.3), h2 = hash(iA.xz, vec2(39.35, 11.13), 24634.6);
  vec3 jacket = h7 < 0.4 ? vec3(0.025, 0.025, 0.03) : h7 < 0.7 ? vec3(0.03, 0.045, 0.09) : h7 < 0.85 ? vec3(0.09, 0.1, 0.06) : vec3(0.12, 0.14, 0.18);
  vec3 shirt = club > 0.5 ? mix(uFanHome, uFanAway, away) : h2 < 0.25 ? jacket : iB.rgb;
  fanPose(iA.xz, away, uBase, yaw, shirt, iC);
  vec3 p = fP * iB.w, n = fN;
  vec3 w = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iA.xyz;
  vN = normalize(vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z));
  vAlb = fAlb;
  vPos = w;
  // the face's parts a hair toward the eye, so they never fight the skin under them
  vec3 toEye = uEyeC - w; float de = length(toEye);
  if (fFace > 0.5) w += toEye / max(de, 1e-3) * clamp(de * 0.0015, 0.01, 0.25);
  gl_Position = uVP * vec4(w, 1.0);
}`;

// A fan too far off to be more than a few pixels tall, as a card: a quad (aCorner, x -1 to 1 across
// and y 0 to 1 up) on his seat, turned to the camera about the vertical, as tall as he stands and
// with his arms' height over his head when he cheers. He gets up, bounces and wears his shirt, hair
// or cap and jacket exactly as CROWD_VS has him (the same hashes off his seat, kept in step with
// it), so a stand drawn part in figures and part in cards gets up together. The fragment shader
// (gl/ballpark.js CARD_FS) draws his outline from vQ, the point on the card in feet. uEyeC is the
// camera, for the turn.
export const CARD_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 3) in vec4 iA;
layout(location = 4) in vec4 iB;
layout(location = 5) in vec3 iC;
uniform mat4 uVP;
uniform float uBase;
uniform vec2 uRoar; uniform vec4 uLagH; uniform vec4 uLagA;
uniform float uT;
uniform float uMove;
uniform vec3 uEyeC;
uniform vec4 uNear;
uniform vec3 uFanHome; uniform vec3 uFanAway; uniform float uFanKit;
out vec3 vPos; out vec3 vN; out vec2 vQ;
flat out vec3 vShirt; flat out vec3 vSkin; flat out vec3 vHair; flat out float vK; flat out float vH;
// a number from his seat, no sin() in it: sin of a position in feet loses its low bits on a GPU, so
// neighbours drew the same number and a whole section moved in step
float hash(vec2 p, vec2 k, float m) { vec3 q = fract(vec3(p.xyx) * 0.1031 + vec3(k, m) * 0.00731); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// the roar as he hears it, late by his own lag (crowd.js LAG): uLagH and uLagA are each side's
// levels at the four lags, and he sits somewhere between two of them
float heard(vec2 seat, float away) { float l = 3.0 * hash(seat, vec2(31.7, 66.1), 22717.3); vec4 r = mix(uLagH, uLagA, away); float a = l < 1.0 ? r.x : l < 2.0 ? r.y : r.z, b = l < 1.0 ? r.y : l < 2.0 ? r.z : r.w; return mix(a, b, fract(l)); }
void main() {
  if (distance(iA.xyz, uNear.xyz) < uNear.w) { vPos = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vQ = vec2(0.0); vShirt = vec3(0.0); vSkin = vec3(0.0); vHair = vec3(0.0); vK = 0.0; vH = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float h = hash(iA.xz, vec2(12.99, 78.23), 43758.5), h2 = hash(iA.xz, vec2(39.35, 11.13), 24634.6);
  float away = step(hash(iA.xz, vec2(7.17, 91.3), 13371.3), iA.x > 0.0 ? 0.16 : 0.04);
  float roar = heard(iA.xz, away);
  float thr = 0.2 + 0.72 * sqrt(h2), up = smoothstep(thr, thr + 0.12, roar);
  float k = max(min(uBase, 1.0) * 0.5, up);
  // the top of his head sitting and standing (gl/fan-vat.js's sit and rise clips), his hands over it
  // when he cheers
  float h4 = hash(iA.xz, vec2(17.31, 63.77), 21357.9), h5 = hash(iA.xz, vec2(71.13, 5.29), 37771.1);
  float H = mix(4.25, 5.75, min(1.0, k * 2.0)) * (0.95 + 0.1 * h5), top = H + max(0.0, k * 2.0 - 1.0) * 0.95;
  float hw = 0.62 * (0.9 + 0.26 * h4 * h4);
  float h8 = hash(iA.xz, vec2(5.53, 41.9), 19391.7);
  float joy = up * uMove, bounce = joy * 0.22 * pow(0.5 + 0.5 * sin(uT * 7.0 * (0.85 + 0.3 * h8) + h * 6.283), 1.6);
  vec2 d = normalize((uEyeC - iA.xyz).xz + vec2(1e-4, 0.0));
  vec3 right = vec3(d.y, 0.0, -d.x);
  vQ = vec2(aCorner.x * hw, aCorner.y * top);
  vec3 w = iA.xyz + (right * vQ.x + vec3(0.0, vQ.y + bounce, 0.0)) * iB.w;
  vN = normalize(vec3(d.x, 0.35, d.y));
  float h6 = hash(iA.xz, vec2(29.81, 47.53), 17093.7), h7 = hash(iA.xz, vec2(83.37, 13.91), 28411.3);
  // his cap or his hair, as FAN_GLSL colours them
  float dark = smoothstep(0.35, 0.2, dot(iC, vec3(0.33)));
  vec3 hairC = h7 < 0.3 ? vec3(0.02, 0.016, 0.012) + 0.03 * h : h7 < 0.6 ? vec3(0.09, 0.05, 0.025) : h7 < 0.8 ? vec3(0.32, 0.22, 0.1) : h7 < 0.88 ? vec3(0.45, 0.18, 0.06) : vec3(0.3, 0.29, 0.27);
  vHair = h6 < 0.34 ? mix(vec3(0.03, 0.04, 0.12), vec3(0.32, 0.03, 0.03), step(0.17, h6)) * (0.8 + 0.4 * h7) : mix(hairC, vec3(0.02, 0.016, 0.012), dark);
  vec3 jacket = h7 < 0.4 ? vec3(0.025, 0.025, 0.03) : h7 < 0.7 ? vec3(0.03, 0.045, 0.09) : h7 < 0.85 ? vec3(0.09, 0.1, 0.06) : vec3(0.12, 0.14, 0.18);
  float club = uFanKit * max(away, step(hash(iA.xz, vec2(61.7, 19.3), 15731.9), 1.0 / 3.0));
  vShirt = club > 0.5 ? mix(uFanHome, uFanAway, away) : h2 < 0.25 ? jacket : iB.rgb; vSkin = iC; vK = k; vH = H;
  vPos = w; gl_Position = uVP * vec4(w, 1.0);
}`;
// The card's corners: two triangles, x across and y up.
export const CARD_QUAD = new Float32Array([-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1]);
