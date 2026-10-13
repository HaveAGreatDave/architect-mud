// GLASS 2 · THE SPECTACLE. Fireworks, sparks off the bat and the comet's tail on a ball hit hard,
// drawn into the ballpark's float target as light added over the frame, so they bloom off the
// lamps' threshold as the lamps do (gl/ballpark.js). What each is, when and where is planned in
// diamond/spectacle.js; this draws them at a time.
//
//   · particles: instanced streaks, stateless. The templates (diamond/spectacle.js TEMPLATES) go up
//     once; each effect is one instanced draw whose vertex shader works out every particle's way
//     at the frame's time (the same sum as `wayAt` there) and stretches a quad from where it was a
//     moment ago to where it is, facing the eye. Nothing is stepped, so a frame at any time is the
//     same frame: the sandbox's stopped clock, a replay.
//   · the tail: a ribbon down the ball's last third of a second (trailAt), built on the CPU each
//     frame, facing the eye, narrowing and fading to its end.
//
// Additive, tested against the park's depth and not written to it: a shell behind the stands is
// hidden by them, and two bursts add. Neither gets thinner on the screen than MIN_PX pixels, so a
// burst a few hundred feet out still reads as a line, not a lost pixel; the floor is in pixels, not
// feet, because a long lens (centre field's, 3.7 degrees, on a replay) would otherwise draw sparks
// at the plate two feet wide.

import { TEMPLATES, TEMPLATE_N, KINDS, TRAIL, DOWN, trailAt, endOf } from '../diamond/spectacle.js';
import { makeVertexStream } from './stream.js';
import { declareProgram } from './programs.js';

// how thin a streak or the tail may get on the screen, in pixels
const MIN_PX = 1.6;

const PART_VS = `#version 300 es
layout(location = 0) in vec3 aDir;
layout(location = 1) in vec3 aK;
uniform mat4 uVP;
uniform vec3 uEye;
uniform int uKind;
uniform vec3 uAt;
uniform vec3 uFrom;
uniform vec3 uAxis;
uniform float uSpin;
uniform float uScale;
uniform float uTau;
uniform float uV;
uniform float uDrag;
uniform float uG;
uniform float uLife;
uniform float uWidth;
uniform float uStreak;
uniform float uGlow;
uniform float uSpread;
uniform float uRise;
uniform float uMinW;
uniform float uDown;
uniform vec3 uCol;
uniform vec3 uCol2;
out vec3 vCol; out vec2 vQ; out float vGlow;
vec3 dirOf() {
  if (uKind == 0) return normalize(uAxis + aDir * uSpread);
  float c = cos(uSpin), s = sin(uSpin);
  return vec3(c * aDir.x + s * aDir.z, aDir.y < 0.0 ? aDir.y * uDown : aDir.y, -s * aDir.x + c * aDir.z);
}
vec3 wayAt(vec3 d, float tau) {
  float v = uV * aK.x * uScale, ex = exp(-uDrag * tau);
  float along = v * (1.0 - ex) / uDrag, fall = uG * (tau / uDrag - (1.0 - ex) / (uDrag * uDrag));
  return uAt + d * along - vec3(0.0, fall, 0.0);
}
void main() {
  int c = gl_VertexID;
  float along = (c == 1 || c == 4 || c == 5) ? 1.0 : 0.0, side = (c == 2 || c == 3 || c == 5) ? 1.0 : -1.0;
  float life = uLife * aK.y, glow = 0.0, fade = 1.0;
  vec3 head, tail;
  bool alive;
  if (uKind == 1 && uTau < 0.0) {
    // the shell on its way up, the first particle only
    float u = clamp((uTau + uRise) / uRise, 0.0, 1.0), u0 = clamp(u - 0.14, 0.0, 1.0);
    alive = gl_InstanceID == 0 && uTau + uRise >= 0.0;
    head = mix(uFrom, uAt, 1.0 - (1.0 - u) * (1.0 - u)); tail = mix(uFrom, uAt, 1.0 - (1.0 - u0) * (1.0 - u0));
    glow = uGlow * 0.5;
  } else {
    alive = uTau >= 0.0 && uTau <= life;
    vec3 d = dirOf();
    head = wayAt(d, uTau); tail = wayAt(d, max(0.0, uTau - uStreak));
    fade = 1.0 - uTau / life;
    glow = uGlow * fade * fade * (uTau < 0.08 ? 1.6 : 1.0);
  }
  if (!alive) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); vQ = vec2(0.0); vGlow = 0.0; return; }
  // a quad from the tail to the head, facing the eye, running a half-width past either end
  vec3 ax = head - tail; float len = length(ax);
  vec3 toEye = normalize(uEye - head), dir = len > 1e-4 ? ax / len : vec3(0.0, 1.0, 0.0);
  vec3 sv = cross(dir, toEye); float sl = length(sv);
  sv = sl > 1e-4 ? sv / sl : normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-4, 0.0, 0.0));
  float w = max(uWidth * (uKind == 1 ? 0.55 + 0.45 * fade : 1.0), distance(uEye, head) * uMinW);
  vec3 p = mix(tail - dir * w * 0.5, head + dir * w * 0.5, along) + sv * side * w * 0.5;
  vQ = vec2(along, side);
  vCol = uKind == 0 ? mix(vec3(1.0, 0.93, 0.78), vec3(1.0, 0.5, 0.14), aK.z)
                    : mix(vec3(1.0, 0.97, 0.9), aK.z > 0.82 ? uCol2 : uCol, smoothstep(0.0, 0.3, uTau));
  vGlow = glow;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const PART_FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec2 vQ; in float vGlow; out vec4 o;
void main() {
  // hot down the middle, the tail end dimmer than the head
  float core = exp(-3.2 * vQ.y * vQ.y), run = mix(0.3, 1.0, vQ.x);
  o = vec4(vCol * vGlow * core * run, 1.0);
}`;

// The tail: pos3, along (0 at the head, 1 at the end), across (-1..1), and its glow.
const TRAIL_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec2 aQ; layout(location = 2) in float aGlow;
uniform mat4 uVP;
out vec2 vQ; out float vGlow;
void main() { vQ = aQ; vGlow = aGlow; gl_Position = uVP * vec4(aPos, 1.0); }`;
const TRAIL_FS = `#version 300 es
precision highp float;
in vec2 vQ; in float vGlow; out vec4 o;
void main() {
  // white-hot along the middle, gold to orange out to its edges, gone by its end
  float core = exp(-3.0 * vQ.y * vQ.y), end = pow(1.0 - clamp(vQ.x, 0.0, 1.0), 1.4);
  vec3 c = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.92, 0.74), core);
  o = vec4(c * vGlow * core * end, 1.0);
}`;

for (const [vs, fs] of [[PART_VS, PART_FS], [TRAIL_VS, TRAIL_FS]]) declareProgram(vs, fs);

// `prog(vs, fs)` is the ballpark's own builder (a prewarmed program, or one built and checked),
// returning { p, u(name) }. Draw inside the frame's added light, depth-tested and not written.
export function createSpectacle(gl, prog) {
  const P = prog(PART_VS, PART_FS), TR = prog(TRAIL_VS, TRAIL_FS);
  // the templates, one per instance
  const tvao = gl.createVertexArray(), tbuf = gl.createBuffer();
  gl.bindVertexArray(tvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, tbuf);
  gl.bufferData(gl.ARRAY_BUFFER, TEMPLATES, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12); gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  // the tail, rebuilt each frame: two vertices a point, as triangles
  const trvao = gl.createVertexArray(), trst = makeVertexStream(gl, trvao, 6, [[0, 3, 0], [1, 2, 12], [2, 1, 20]], 2048);
  const trData = new Float32Array((TRAIL.n - 1) * 6 * 6);

  let list = [], now = 0;
  // the effects of the payload on the field, and the world's time now
  function set(effects, t) { list = Array.isArray(effects) ? effects : []; now = Number.isFinite(t) ? t : 0; }

  function trailTris(e, eye) {
    const T = trailAt(e, now);
    if (!T) return 0;
    const pts = T.pts, n = pts.length;
    let k = 0;
    const sideOf = (i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], p = pts[i];
      const tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
      const ex = eye[0] - p[0], ey = eye[1] - p[1], ez = eye[2] - p[2];
      let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex;
      const l = Math.hypot(sx, sy, sz) || 1, dist = Math.hypot(ex, ey, ez);
      const w = Math.max(TRAIL.width, dist * minW) * (1 - 0.85 * i / (n - 1)) * 0.5;
      sx *= w / l; sy *= w / l; sz *= w / l;
      return [sx, sy, sz];
    };
    const put = (p, s, sign, u) => { trData.set([p[0] + s[0] * sign, p[1] + s[1] * sign, p[2] + s[2] * sign, u, sign, T.glow], k); k += 6; };
    let s0 = sideOf(0);
    for (let i = 0; i + 1 < n; i++) {
      const s1 = sideOf(i + 1), u0 = i / (n - 1), u1 = (i + 1) / (n - 1);
      put(pts[i], s0, -1, u0); put(pts[i + 1], s1, -1, u1); put(pts[i], s0, 1, u0);
      put(pts[i], s0, 1, u0); put(pts[i + 1], s1, -1, u1); put(pts[i + 1], s1, 1, u1);
      s0 = s1;
    }
    trst.write(trData, k);
    return k / 6;
  }

  // M: the frame's matrices and eye (camera.js shotMatrices, its lens fitted to the screen); h: the
  // canvas's height in pixels; o.fx the tier's spectacle (diamond/quality.js): 2 all of it, 1 half
  // the particles in each burst, 0 only the trails. Returns { draws, tris }.
  let minW = 0;
  function draw(M, h, o = {}) {
    let draws = 0, tris = 0;
    if (!list.length) return { draws, tris };
    const share = o.fx === 0 ? 0 : o.fx === 1 ? 0.5 : 1;
    // the thinnest a streak may be, in feet for each foot from the eye: MIN_PX of this lens's pixels
    minW = MIN_PX * 2 * Math.tan((M.fov || 40) * Math.PI / 360) / Math.max(1, h || 1);
    for (const e of list) {
      if (e.kind === 'trail') {
        const n = trailTris(e, M.eye);
        if (!n) continue;
        gl.useProgram(TR.p);
        gl.uniformMatrix4fv(TR.u('uVP'), false, M.viewProj);
        gl.bindVertexArray(trvao); gl.drawArrays(gl.TRIANGLES, 0, n);
        draws++; tris += n / 3;
        continue;
      }
      const K = KINDS[e.kind];
      if (!K || !share) continue;
      const tau = now - e.t;
      if (tau < -(K.rise || 0) || now > endOf(e)) continue;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u('uVP'), false, M.viewProj);
      gl.uniform3fv(P.u('uEye'), M.eye);
      gl.uniform1i(P.u('uKind'), e.kind === 'sparks' ? 0 : 1);
      gl.uniform3fv(P.u('uAt'), e.at); gl.uniform3fv(P.u('uFrom'), e.from || e.at); gl.uniform3fv(P.u('uAxis'), e.dir || [0, 1, 0]);
      gl.uniform1f(P.u('uSpin'), e.spin || 0); gl.uniform1f(P.u('uScale'), e.scale || 1); gl.uniform1f(P.u('uTau'), tau);
      gl.uniform1f(P.u('uV'), K.v); gl.uniform1f(P.u('uDrag'), K.drag); gl.uniform1f(P.u('uG'), K.g); gl.uniform1f(P.u('uLife'), K.life);
      gl.uniform1f(P.u('uWidth'), K.width); gl.uniform1f(P.u('uStreak'), K.streak); gl.uniform1f(P.u('uGlow'), K.glow);
      gl.uniform1f(P.u('uSpread'), K.spread || 0); gl.uniform1f(P.u('uRise'), K.rise || 0); gl.uniform1f(P.u('uMinW'), minW); gl.uniform1f(P.u('uDown'), DOWN);
      gl.uniform3fv(P.u('uCol'), e.colour || [1, 1, 1]); gl.uniform3fv(P.u('uCol2'), e.second || e.colour || [1, 1, 1]);
      // the first of the templates: they're dealt round the sphere, so any first share of them is
      // the whole burst, thinner
      const n = Math.max(1, Math.round(Math.min(K.n, TEMPLATE_N) * share));
      gl.bindVertexArray(tvao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      draws++; tris += 2 * n;
    }
    gl.bindVertexArray(null);
    return { draws, tris };
  }

  function dispose() {
    gl.deleteVertexArray(tvao); gl.deleteBuffer(tbuf);
    gl.deleteVertexArray(trvao); gl.deleteBuffer(trst.buf);
    gl.deleteProgram(P.p); gl.deleteProgram(TR.p);
  }
  return { set, draw, dispose };
}
