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

// The crowd's vertex shader, for gl/ballpark.js's crowd program (its fragment shader lights it).
// Per vertex the three poses and the part; per fan (instanced) where he sits and faces, his shirt
// and size, his skin. uBase is the pose he rests in (0 sit, 1 stand, 2 cheer), one draw each;
// uRoar the home fans' and the visitors' levels; uT the clock; uMove 0 for a viewer who's asked
// for less motion, who gets the crowd up without the bouncing.
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
out vec3 vPos; out vec3 vN; out vec3 vAlb;
float hash(vec2 p, vec2 k, float m) { return fract(sin(dot(p, k)) * m); }
void main() {
  float h = hash(iA.xz, vec2(12.99, 78.23), 43758.5), h2 = hash(iA.xz, vec2(39.35, 11.13), 24634.6);
  // whose fan he is: the visitors' are thicker up the third-base line (+x), by their dugout
  float away = step(hash(iA.xz, vec2(7.17, 91.3), 13371.3), iA.x > 0.0 ? 0.3 : 0.06);
  float roar = mix(uRoar.x, uRoar.y, away);
  // he's up once the roar passes his own threshold, the keenest at the least
  float thr = 0.12 + 0.75 * h2, up = smoothstep(thr, thr + 0.18, roar);
  // his pose, from where he rests up through standing to cheering
  float k = max(uBase * 0.5, up);
  vec3 p = k < 0.5 ? mix(aSit, aStand, k * 2.0) : mix(aStand, aCheer, k * 2.0 - 1.0);
  vec3 n = k < 0.5 ? mix(aSitN, aStandN, k * 2.0) : mix(aStandN, aCheerN, k * 2.0 - 1.0);
  // up and cheering, a bounce and a sway above the waist, each on his own beat
  float joy = up * uMove;
  p.y += joy * 0.22 * max(0.0, sin(uT * 7.0 + h * 6.283));
  p.x += joy * max(0.0, p.y - 3.0) * 0.06 * sin(uT * 4.3 + h2 * 6.283);
  p *= iB.w;
  float c = cos(iA.w), s = sin(iA.w);
  vec3 w = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iA.xyz;
  vN = normalize(vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z));
  vec3 pants = mix(vec3(0.03, 0.04, 0.07), vec3(0.12, 0.10, 0.07), h);
  vAlb = aPart < 0.5 ? iC : (aPart < 1.5 ? iB.rgb : (aPart < 2.5 ? pants : (aPart < 3.5 ? vec3(0.02, 0.016, 0.012) + 0.05 * h : vec3(0.82, 0.62, 0.16))));
  vPos = w; gl_Position = uVP * vec4(w, 1.0);
}`;
