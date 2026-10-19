// GLASS 2 · THE PARK'S WEATHER. What falls on the park and the lightning over the skyline, drawn into
// the ballpark's float target after the park (gl/ballpark.js); what falls and when the bolts strike
// is diamond/weather.js's.
//
//   · what falls: one instanced draw of stateless drops or flakes. Each instance is a seed; the vertex
//     shader puts it in the air the camera looks through, from a little in front of the lens to past
//     what it's looking at, spread across the frame at that distance and from above the top of the
//     frame to below its foot, and drops it through that at its own speed by the world's clock,
//     wrapping it to the top once it's through. Rain is a streak down its fall catching the floods,
//     added as light; snow and ash are flakes over what's behind them. Nothing is stepped, so a
//     stopped clock draws the same frame, and a cut has the same rain in the new shot's air.
//   · lightning: each bolt (client/shared/lightning.js growBolt) as a ribbon of quads standing out
//     past the outfield, facing the eye, burning as boltBright says, the trunk brighter than the
//     branches; its flash lights the sky and the park's ambient (flashAt, which ballpark.js reads)
//     as one smooth pulse a bolt, not with each restrike, so the frame never flashes three times in
//     a second, and not at all for a viewer who's asked for less motion.
//
// Depth-tested and not written, so the stands hide what's behind them. Neither gets thinner on the
// screen than MIN_PX pixels.

import { weatherOf, boltsBetween, BOLT } from '../diamond/weather.js';
import { growBolt, boltBright } from '../../../../shared/lightning.js';
import { makeVertexStream } from './stream.js';
import { declareProgram } from './programs.js';

const MIN_PX = 1.2;
// The air what falls is drawn in: from NEAR to FAR times the distance to what the camera looks at
// (and no nearer than NEAR_FT feet), and how far either side of the frame and above and below it.
const AIR = Object.freeze({ near: 0.22, nearFt: 14, far: 1.35, spill: 1.2 });
// how bright a bolt's flash makes the sky and the park's ambient at its peak, and its pulse: up in
// `rise` seconds, then down by e every `fall`
const FLASH = Object.freeze({ sky: 0.06, up: 0.05, rise: 0.04, fall: 0.3 });

const FALL_VS = `#version 300 es
layout(location = 0) in vec4 aSeed;
uniform mat4 uVP;
uniform vec3 uEye; uniform vec3 uFwd; uniform vec3 uRight;
uniform float uTanX; uniform float uFovY; uniform float uPitch;
uniform float uD0; uniform float uD1; uniform float uT; uniform float uCount;
uniform float uSpeed; uniform float uLen; uniform float uSize; uniform float uSway; uniform float uMinW;
out vec2 vQ; out float vA;
void main() {
  int c = gl_VertexID;
  float along = (c == 1 || c == 4 || c == 5) ? 1.0 : 0.0, side = (c == 2 || c == 3 || c == 5) ? 1.0 : -1.0;
  if (float(gl_InstanceID) >= uCount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vA = 0.0; return; }
  vec4 s = aSeed;
  // how far out, along the ground, more of them near the lens than far from it
  float d = mix(uD0, uD1, s.z * s.z);
  float x = (s.x * 2.0 - 1.0) * uTanX * d * ${AIR.spill.toFixed(2)};
  // the air at that distance, from above the frame's top to below its foot, and never below ground
  float hi = d * tan(min(uPitch + uFovY * ${(AIR.spill / 2).toFixed(2)}, 1.35)), lo = d * tan(max(uPitch - uFovY * ${(AIR.spill / 2).toFixed(2)}, -1.35));
  float y1 = uEye.y + hi, y0 = max(uEye.y + lo, 0.0), h = max(y1 - y0, 1.0);
  float y = y1 - fract(s.y + uT * uSpeed / h) * h;
  // a flake sways as it falls
  float ph = s.w * 6.2832, sw = uSway * sin(uT * (0.7 + s.w * 0.9) + ph);
  vec3 head = vec3(uEye.x, 0.0, uEye.z) + uFwd * (d + sw * 0.4) + uRight * (x + sw) + vec3(0.0, y, 0.0);
  vec3 toEye = uEye - head; float de = length(toEye); toEye /= de;
  float w = max(uSize, de * uMinW);
  vec3 p;
  if (uLen > 0.0) {
    // a streak down its fall: from the head up to where it was a moment ago, facing the eye
    vec3 dir = vec3(0.0, 1.0, 0.0), sv = normalize(cross(dir, toEye) + vec3(1e-5, 0.0, 0.0));
    p = mix(head - dir * w * 0.5, head + dir * (uLen + w * 0.5), along) + sv * side * w * 0.5;
  } else {
    // a flake: a square facing the eye
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), toEye) + vec3(1e-5, 0.0, 0.0)), u = cross(toEye, r);
    p = head + r * (along - 0.5) * w + u * side * 0.5 * w;
  }
  vQ = vec2(along, side);
  // thinned out toward the far end of the air, and right in front of the lens
  vA = smoothstep(uD0, uD0 * 2.0, d) * (1.0 - smoothstep(uD1 * 0.55, uD1, d));
  gl_Position = uVP * vec4(p, 1.0);
}`;
const FALL_FS = `#version 300 es
precision highp float;
in vec2 vQ; in float vA; out vec4 o;
uniform vec3 uCol; uniform int uAdd;
void main() {
  if (uAdd == 1) {
    // a drop catching the floods: brightest down its middle
    float core = exp(-3.0 * vQ.y * vQ.y);
    o = vec4(uCol * vA * core, 1.0);
  } else {
    // a flake, soft round its edge
    vec2 q = vec2(vQ.x * 2.0 - 1.0, vQ.y);
    float disc = 1.0 - smoothstep(0.5, 1.0, length(q));
    o = vec4(uCol, vA * disc);
  }
}`;
// A bolt: pos3, across (-1..1) and how bright.
const BOLT_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in float aSide; layout(location = 2) in float aGlow;
uniform mat4 uVP;
out float vSide; out float vGlow;
void main() { vSide = aSide; vGlow = aGlow; gl_Position = uVP * vec4(aPos, 1.0); }`;
const BOLT_FS = `#version 300 es
precision highp float;
in float vSide; in float vGlow; out vec4 o;
uniform vec3 uCol;
void main() { o = vec4(uCol * vGlow * exp(-2.5 * vSide * vSide), 1.0); }`;

for (const [vs, fs] of [[FALL_VS, FALL_FS], [BOLT_VS, BOLT_FS]]) declareProgram(vs, fs);

// Seeds for the most anything falls, the same for every park.
function seeds(n) {
  const out = new Float32Array(n * 4);
  let a = 0x2545f491;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < out.length; i++) out[i] = r();
  return out;
}
const MAX_FALL = 2800;

// A bolt's ribbon in the park: its tree (growBolt) standing at `b.dist` feet out on bearing
// `b.bearing` (degrees from centre field), as tall as a third of that, facing the eye, `ch` and
// `br` its trunk's and branches' brightness now. Appends to `out` (floats, 5 a vertex) from `k`;
// returns the new end.
export function boltRibbon(tree, b, eye, ch, br, minW, out, k) {
  const a = (b.bearing * Math.PI) / 180, base = [b.dist * Math.sin(a), 0, b.dist * Math.cos(a)];
  const H = b.dist * 0.34, W = H * 0.3, fwd = [Math.sin(a), 0, Math.cos(a)], right = [Math.cos(a), 0, -Math.sin(a)];
  const at = (p) => [base[0] + right[0] * p.ox * W + fwd[0] * p.oy * W, p.f * H, base[2] + right[2] * p.ox * W + fwd[2] * p.oy * W];
  tree.branches.forEach((br0, j) => {
    const glow = j === 0 ? ch : br, wFt = j === 0 ? 5 : 2.4;
    if (!(glow > 0.01)) return;
    const pts = br0.pts.map(at);
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
      const ex = eye[0] - p[0], ey = eye[1] - p[1], ez = eye[2] - p[2], de = Math.hypot(ex, ey, ez);
      let sx = dy * ez - dz * ey, sy = dz * ex - dx * ez, sz = dx * ey - dy * ex;
      const l = Math.hypot(sx, sy, sz) || 1, w = Math.max(wFt, de * minW) * 0.5;
      sx *= w / l; sy *= w / l; sz *= w / l;
      const put = (v, s) => { out[k++] = v[0] + sx * s; out[k++] = v[1] + sy * s; out[k++] = v[2] + sz * s; out[k++] = s; out[k++] = glow; };
      put(p, -1); put(q, -1); put(p, 1); put(p, 1); put(q, -1); put(q, 1);
    }
  });
  return k;
}

// `prog(vs, fs)` is the ballpark's own builder. Draw after the park, before the added light.
export function createWeather(gl, prog) {
  const F = prog(FALL_VS, FALL_FS), B = prog(BOLT_VS, BOLT_FS);
  const fvao = gl.createVertexArray(), fbuf = gl.createBuffer();
  gl.bindVertexArray(fvao);
  gl.bindBuffer(gl.ARRAY_BUFFER, fbuf);
  gl.bufferData(gl.ARRAY_BUFFER, seeds(MAX_FALL), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
  gl.bindVertexArray(null);
  const bvao = gl.createVertexArray(), bst = makeVertexStream(gl, bvao, 5, [[0, 3, 0], [1, 1, 12], [2, 1, 16]], 4096);
  let bData = new Float32Array(6 * 5 * 512);
  const trees = new Map();
  const treeOf = (seed) => { let t = trees.get(seed); if (!t) { t = growBolt(seed, { gens: 3, segs: 12 }); trees.set(seed, t); if (trees.size > 24) trees.delete(trees.keys().next().value); } return t; };

  let we = weatherOf(null), now = 0, flashes = true;
  // the payload's weather (its `wx`), whether bolts light the frame (`o.flash`, off for less
  // motion), and the world's time now
  function set(wx, o = {}) { we = weatherOf(wx); flashes = o.flash !== false; }
  function setTime(t) { now = Number.isFinite(t) ? t : 0; }
  // the bolts burning now, with their brightness
  function burning() {
    const out = [];
    for (const b of boltsBetween(we, now - BOLT.life, now)) {
      const tree = treeOf(b.seed), age = (now - b.t) * 1000, { ch, br } = boltBright(tree, age);
      if (ch > 0.01 || br > 0.01) out.push({ b, tree, ch, br });
    }
    return out;
  }
  // How much the bolts burning now light the sky and the park's ambient: { sky, up } to add, as
  // colours (linear).
  function flashAt() {
    if (!flashes || !we.bolts) return null;
    let k = 0;
    for (const b of boltsBetween(we, now - BOLT.life, now)) {
      const age = now - b.t;
      k = Math.max(k, age < FLASH.rise ? age / FLASH.rise : Math.exp(-(age - FLASH.rise) / FLASH.fall));
    }
    const col = we.bolts.col, m = Math.max(...col);
    return k > 0.002 ? { sky: col.map((v) => (v / m) * k * FLASH.sky), up: col.map((v) => (v / m) * k * FLASH.up) } : null;
  }

  // M: the frame's matrices, eye and lens (camera.js shotMatrices); w, h the canvas's size in pixels;
  // `o.fall` false for a camera nothing falls on (under a shut roof). Returns { draws, tris }.
  function draw(M, w, h, o = {}) {
    let draws = 0, tris = 0;
    const minW = (MIN_PX * 2 * Math.tan(((M.fov || 40) * Math.PI) / 360)) / Math.max(1, h || 1);
    const f = o.fall === false ? null : we.fall;
    if (f) {
      const n = Math.round(MAX_FALL * Math.min(1, f.n / MAX_FALL) * (0.35 + 0.65 * f.rate));
      const fw = [M.at[0] - M.eye[0], M.at[1] - M.eye[1], M.at[2] - M.eye[2]], fl = Math.hypot(fw[0], fw[2]) || 1;
      const fwd = [fw[0] / fl, 0, fw[2] / fl], right = [fwd[2], 0, -fwd[0]];
      const pitch = Math.atan2(fw[1], fl), fovY = ((M.fov || 40) * Math.PI) / 180, tanX = Math.tan(fovY / 2) * (w > 0 && h > 0 ? w / h : 4 / 3);
      const D = Math.max(AIR.nearFt * 3, Math.hypot(fw[0], fw[1], fw[2]));
      gl.useProgram(F.p);
      gl.uniformMatrix4fv(F.u('uVP'), false, M.viewProj);
      gl.uniform3fv(F.u('uEye'), M.eye); gl.uniform3fv(F.u('uFwd'), fwd); gl.uniform3fv(F.u('uRight'), right);
      gl.uniform1f(F.u('uTanX'), tanX); gl.uniform1f(F.u('uFovY'), fovY); gl.uniform1f(F.u('uPitch'), pitch);
      gl.uniform1f(F.u('uD0'), Math.max(AIR.nearFt, D * AIR.near)); gl.uniform1f(F.u('uD1'), D * AIR.far);
      gl.uniform1f(F.u('uT'), now); gl.uniform1f(F.u('uCount'), n);
      gl.uniform1f(F.u('uSpeed'), f.speed); gl.uniform1f(F.u('uLen'), f.len); gl.uniform1f(F.u('uSize'), f.size); gl.uniform1f(F.u('uSway'), f.sway || 0);
      gl.uniform1f(F.u('uMinW'), minW); gl.uniform3fv(F.u('uCol'), f.col); gl.uniform1i(F.u('uAdd'), f.add ? 1 : 0);
      if (f.add) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(fvao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      draws++; tris += 2 * n;
    }
    const lit = burning();
    if (lit.length) {
      let k = 0;
      for (const x of lit) {
        const need = k + x.tree.branches.reduce((s, b) => s + (b.pts.length - 1) * 30, 0);
        if (need > bData.length) { const g = new Float32Array(Math.max(need, bData.length * 2)); g.set(bData.subarray(0, k)); bData = g; }
        k = boltRibbon(x.tree, x.b, M.eye, x.ch, x.br, minW, bData, k);
      }
      if (k) {
        bst.write(bData, k);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(B.p);
        gl.uniformMatrix4fv(B.u('uVP'), false, M.viewProj);
        gl.uniform3fv(B.u('uCol'), we.bolts?.col || BOLT.col);
        gl.bindVertexArray(bvao); gl.drawArrays(gl.TRIANGLES, 0, k / 5);
        draws++; tris += k / 15;
      }
    }
    return { draws, tris };
  }
  function dispose() {
    gl.deleteVertexArray(fvao); gl.deleteBuffer(fbuf); gl.deleteVertexArray(bvao); gl.deleteBuffer(bst.buf);
  }
  return { set, setTime, flashAt, draw, dispose, get look() { return we; } };
}
