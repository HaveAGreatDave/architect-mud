// GLASS · THE CROWD. Every seat's fan, instanced: one figure that can sit, stand and cheer
// (gl/ballpark-mesh.js crowdMorph), and a vertex shader that moves each fan between the three by
// how loud his side is. A fan gets up when the roar passes his own threshold, a hash of his seat,
// so a big play brings the whole stand up and a small one a few; up and cheering he bounces and
// sways on his own beat. Nothing is stepped: the pose is a function of the roar and the time, so a
// stopped clock draws the same crowd.
//
// The roar (`createRoar`) is a pure function of time too: each cheer rises, holds and falls away,
// and the loudest at any moment is the side's. The view (gameday-grandstand.js) cheers on the plays
// and hands the renderer the two levels each frame (ballpark.js setCrowd). Which fans are whose
// is a hash of the seat as well: most are the home side's, more of the visitors' up the third-base
// line by their dugout.
//
// Pure apart from the shader's source: no DOM and no GL.

// How a cheer comes and goes (s): up over `rise`, held, and gone over `fall`.
export const ROAR = Object.freeze({ rise: 0.35, fall: 2.2 });

// The two sides' roars: `cheer(side, amp, at, hold)` (side 0 the home fans, 1 the visitors';
// amp 0 to 1; at and hold in seconds of the game's clock), and `at(t)` the two levels then.
export function createRoar() {
  let cheers = [];
  const endOf = (c) => c.at + ROAR.rise + c.hold + ROAR.fall;
  return {
    cheer(side, amp, at, hold = 1.5) {
      if (!(amp > 0) || !Number.isFinite(at)) return;
      cheers.push({ side: side ? 1 : 0, amp: Math.min(1, amp), at, hold: Math.max(0, hold) });
    },
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

// The crowd's vertex shader, for gl/ballpark.js's crowd program (its fragment shader lights it).
// Per vertex the three poses and the part; per fan (instanced) where he sits and faces, his shirt
// and size, his skin. uBase is the pose he rests in (0 sit, 1 stand, 2 cheer), one draw each;
// uRoar the home fans' and the visitors' levels; uT the clock; uMove 0 for a viewer who's asked
// for less motion, who gets the crowd up without the bouncing; uLook where the play is on the
// field (x, z, and how much it holds them, 0 to 1), which the fans' heads turn to follow, each
// as far as his own interest takes him. Sat quiet, each leans forward and back on his own slow
// beat and his head wanders when nothing holds it. uFanHome and uFanAway are the two clubs'
// colours (linear), worn while uFanKit is 1: 30% of the park in the home side's, 10% in the
// visitors'.
export const CROWD_VS = `#version 300 es
layout(location = 0) in vec3 aSit;
layout(location = 1) in vec3 aSitN;
layout(location = 2) in vec3 aStand;
layout(location = 6) in vec3 aStandN;
layout(location = 7) in vec3 aCheer;
layout(location = 8) in vec3 aCheerN;
layout(location = 9) in float aPart;
layout(location = 3) in vec4 iA;
layout(location = 4) in vec4 iB;
layout(location = 5) in vec3 iC;
uniform mat4 uVP;
uniform float uBase;
uniform vec2 uRoar;
uniform float uT;
uniform float uMove;
uniform vec3 uLook;
uniform vec3 uFanHome; uniform vec3 uFanAway; uniform float uFanKit;
out vec3 vPos; out vec3 vN; out vec3 vAlb;
float hash(vec2 p, vec2 k, float m) { return fract(sin(dot(p, k)) * m); }
void main() {
  float h = hash(iA.xz, vec2(12.99, 78.23), 43758.5), h2 = hash(iA.xz, vec2(39.35, 11.13), 24634.6);
  float h3 = hash(iA.xz, vec2(53.71, 27.19), 31887.3);
  // whose fan he is: a tenth of the park the visitors', thicker up the third-base line (+x) by
  // their dugout
  float away = step(hash(iA.xz, vec2(7.17, 91.3), 13371.3), iA.x > 0.0 ? 0.16 : 0.04);
  float roar = mix(uRoar.x, uRoar.y, away);
  // he's up once the roar passes his own threshold, the keenest at the least
  float thr = 0.12 + 0.75 * h2, up = smoothstep(thr, thr + 0.18, roar);
  // his pose, from where he rests up through standing to cheering; he rests standing at most, so
  // arms go up only when the roar takes him there
  float k = max(min(uBase, 1.0) * 0.5, up);
  vec3 p = k < 0.5 ? mix(aSit, aStand, k * 2.0) : mix(aStand, aCheer, k * 2.0 - 1.0);
  vec3 n = k < 0.5 ? mix(aSitN, aStandN, k * 2.0) : mix(aStandN, aCheerN, k * 2.0 - 1.0);
  float c = cos(iA.w), s = sin(iA.w);
  // his head (the face and neck, and the hair over it), turned about his neck toward the play as
  // far as his interest takes him, and wandering a little of its own; the neck is at the top of
  // the shoulders sitting or standing (gl/ballpark-mesh.js CROWD_POSE)
  bool head = aPart < 0.2 || abs(aPart - 3.0) < 0.1;
  if (head) {
    vec2 d = uLook.xy - iA.xz;
    float want = atan(c * d.x - s * d.y, s * d.x + c * d.y);
    float yaw = clamp(want, -0.9, 0.9) * uLook.z * (0.45 + 0.55 * h3) + 0.22 * sin(uT * 0.31 + h * 6.283) * (1.0 - 0.7 * uLook.z);
    vec3 pv = vec3(0.0, mix(3.51, 4.96, min(1.0, k * 2.0)), mix(-0.1, 0.0, min(1.0, k * 2.0)));
    vec3 q = p - pv; float cy = cos(yaw), sy = sin(yaw);
    p = pv + vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
    n = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
  }
  // sat quiet, his upper body leans forward and back on his own slow beat
  float rest = (1.0 - up) * (1.0 - min(1.0, uBase)) * uMove;
  p.z += rest * max(0.0, p.y - 1.9) * 0.07 * sin(uT * 0.23 + h2 * 6.283);
  // up and cheering, a bounce and a sway above the waist, each on his own beat: the bounce a
  // smooth hop, sharpest at its top, with no kink where it lands
  float joy = up * uMove;
  p.y += joy * 0.22 * pow(0.5 + 0.5 * sin(uT * 7.0 + h * 6.283), 1.6);
  p.x += joy * max(0.0, p.y - 3.0) * 0.06 * sin(uT * 4.3 + h2 * 6.283);
  // his build: broader or slighter through the body and the limbs (the head as it is), a little
  // taller or shorter, so a stand isn't one man in sixteen shirts
  float h4 = hash(iA.xz, vec2(17.31, 63.77), 21357.9), h5 = hash(iA.xz, vec2(71.13, 5.29), 37771.1);
  if (!head && aPart > 0.2) p.x *= 0.9 + 0.26 * h4 * h4;
  p.y *= 0.95 + 0.1 * h5;
  p *= iB.w;
  vec3 w = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iA.xyz;
  vN = normalize(vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z));
  vec3 pants = mix(vec3(0.03, 0.04, 0.07), vec3(0.12, 0.10, 0.07), h);
  // what's on his head: a cap in about a third of the stand, the rest their own hair, dark, brown,
  // fair or grey; and about a quarter in a jacket over the shirt, its sleeves the jacket's
  float h6 = hash(iA.xz, vec2(29.81, 47.53), 17093.7), h7 = hash(iA.xz, vec2(83.37, 13.91), 28411.3);
  vec3 hair = h6 < 0.34 ? mix(vec3(0.03, 0.04, 0.12), vec3(0.32, 0.03, 0.03), step(0.17, h6)) * (0.8 + 0.4 * h7)
    : h6 < 0.62 ? vec3(0.02, 0.016, 0.012) + 0.03 * h : h6 < 0.82 ? vec3(0.09, 0.05, 0.025) : h6 < 0.93 ? vec3(0.32, 0.22, 0.1) : vec3(0.3, 0.29, 0.27);
  vec3 jacket = h7 < 0.4 ? vec3(0.025, 0.025, 0.03) : h7 < 0.7 ? vec3(0.03, 0.045, 0.09) : h7 < 0.85 ? vec3(0.09, 0.1, 0.06) : vec3(0.12, 0.14, 0.18);
  // in his club's colour: every visitors' fan and a third of the rest, with no jacket over it
  float club = uFanKit * max(away, step(hash(iA.xz, vec2(61.7, 19.3), 15731.9), 1.0 / 3.0));
  vec3 shirt = club > 0.5 ? mix(uFanHome, uFanAway, away) : (h2 < 0.25 && abs(aPart - 1.25) < 0.1) ? jacket : iB.rgb;
  vec3 dark = abs(aPart - 3.0) < 0.1 ? hair : vec3(0.02, 0.016, 0.012) + 0.05 * h;
  vAlb = aPart < 0.5 ? iC : (aPart < 1.5 ? shirt : (aPart < 2.5 ? pants : (aPart < 3.5 ? dark : vec3(0.82, 0.62, 0.16))));
  vPos = w; gl_Position = uVP * vec4(w, 1.0);
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
uniform vec2 uRoar;
uniform float uT;
uniform float uMove;
uniform vec3 uEyeC;
uniform vec3 uFanHome; uniform vec3 uFanAway; uniform float uFanKit;
out vec3 vPos; out vec3 vN; out vec2 vQ;
flat out vec3 vShirt; flat out vec3 vSkin; flat out vec3 vHair; flat out float vK; flat out float vH;
float hash(vec2 p, vec2 k, float m) { return fract(sin(dot(p, k)) * m); }
void main() {
  float h = hash(iA.xz, vec2(12.99, 78.23), 43758.5), h2 = hash(iA.xz, vec2(39.35, 11.13), 24634.6);
  float away = step(hash(iA.xz, vec2(7.17, 91.3), 13371.3), iA.x > 0.0 ? 0.16 : 0.04);
  float roar = mix(uRoar.x, uRoar.y, away);
  float thr = 0.12 + 0.75 * h2, up = smoothstep(thr, thr + 0.18, roar);
  float k = max(min(uBase, 1.0) * 0.5, up);
  // the top of his head sitting and standing (gl/ballpark-mesh.js CROWD_POSE), his hands over it
  // when he cheers
  float h4 = hash(iA.xz, vec2(17.31, 63.77), 21357.9), h5 = hash(iA.xz, vec2(71.13, 5.29), 37771.1);
  float H = mix(4.15, 5.6, min(1.0, k * 2.0)) * (0.95 + 0.1 * h5), top = H + max(0.0, k * 2.0 - 1.0) * 0.95;
  float hw = 0.62 * (0.9 + 0.26 * h4 * h4);
  float joy = up * uMove, bounce = joy * 0.22 * pow(0.5 + 0.5 * sin(uT * 7.0 + h * 6.283), 1.6);
  vec2 d = normalize((uEyeC - iA.xyz).xz + vec2(1e-4, 0.0));
  vec3 right = vec3(d.y, 0.0, -d.x);
  vQ = vec2(aCorner.x * hw, aCorner.y * top);
  vec3 w = iA.xyz + (right * vQ.x + vec3(0.0, vQ.y + bounce, 0.0)) * iB.w;
  vN = normalize(vec3(d.x, 0.35, d.y));
  float h6 = hash(iA.xz, vec2(29.81, 47.53), 17093.7), h7 = hash(iA.xz, vec2(83.37, 13.91), 28411.3);
  vHair = h6 < 0.34 ? mix(vec3(0.03, 0.04, 0.12), vec3(0.32, 0.03, 0.03), step(0.17, h6)) * (0.8 + 0.4 * h7)
    : h6 < 0.62 ? vec3(0.02, 0.016, 0.012) + 0.03 * h : h6 < 0.82 ? vec3(0.09, 0.05, 0.025) : h6 < 0.93 ? vec3(0.32, 0.22, 0.1) : vec3(0.3, 0.29, 0.27);
  vec3 jacket = h7 < 0.4 ? vec3(0.025, 0.025, 0.03) : h7 < 0.7 ? vec3(0.03, 0.045, 0.09) : h7 < 0.85 ? vec3(0.09, 0.1, 0.06) : vec3(0.12, 0.14, 0.18);
  float club = uFanKit * max(away, step(hash(iA.xz, vec2(61.7, 19.3), 15731.9), 1.0 / 3.0));
  vShirt = club > 0.5 ? mix(uFanHome, uFanAway, away) : h2 < 0.25 ? jacket : iB.rgb; vSkin = iC; vK = k; vH = H;
  vPos = w; gl_Position = uVP * vec4(w, 1.0);
}`;
// The card's corners: two triangles, x across and y up.
export const CARD_QUAD = new Float32Array([-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1]);
