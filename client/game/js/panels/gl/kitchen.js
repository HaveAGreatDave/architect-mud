// GLASS 2 · THE KITCHEN STAGE. A counter in front of the stove, cel-shaded, in its own WebGL2
// context (docs/proposals/kitchen-stage.md).
//
// Like the rink (arena.js) this draws one small scene and nothing of the city: its own context, its
// own camera, its own two programs. Every body is drawn twice, first as ink (gl/ink.js, the rink's
// outline) and then lit in hard bands (gl/toon.js, the city's cel steps): a cool shadow tone, a
// hard rim, a hard-edged highlight on glossy food, and halftone dots in the shadow, as a printed
// cooking manga would have them.
//
// The geometry is kitchen-mesh.js's: the set once into a static layer, everything that moves
// rebuilt by the panel each frame into a dynamic one. `createKitchenRenderer` returns null when
// there is no WebGL2 or a shader won't build, and the panel falls back to the workspace HUD.
//
// ⚠ GLOSS RIDES IN THE VERTEX ALPHA. The kitchen draws nothing translucent, so a food's colour
// carries `1 - gloss / 2` in its alpha (kitchen-mesh.js `foodPiece`) and the shader reads it back.
// Everything else has alpha 1, which is no gloss.
//
// ⚠ NO FACE CULLING, for arena.js's reason: the builders don't keep one winding.

import { makeVertexStream } from './stream.js';
import { declareProgram, prewarmPrograms, layerProgram } from './programs.js';
import { INK_VS, INK_FS } from './ink.js';
import { TOON_GLSL } from './toon.js';
import { STRIDE } from './kitchen-mesh.js';

const LIT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec4 aCol;
uniform mat4 uVP;
uniform vec2 uShake;
out vec3 vPos; out vec3 vNor; out vec4 vCol;
void main() {
  vPos = aPos; vNor = aNor; vCol = aCol;
  vec4 p = uVP * vec4(aPos, 1.0);
  p.xy += uShake * p.w;
  gl_Position = p;
}`;
const LIT_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec4 vCol;
uniform vec3 uEye;
uniform vec3 uKey;
uniform float uBands;
uniform float uDotPx;
uniform float uFlash;
out vec4 outColor;
${TOON_GLSL}
const vec3 SHADE = vec3(0.6, 0.62, 0.8);
void main() {
  vec3 rgb = vCol.rgb;
  float nl = dot(vNor, vNor);
  if (nl > 0.01) {
    vec3 n = vNor * inversesqrt(nl);
    vec3 v = normalize(uEye - vPos);
    if (dot(n, v) < 0.0) n = -n;
    float d = max(dot(n, uKey), 0.0);
    float lit = toonBands(min(d * 1.15, 0.999), uBands);
    vec3 c = mix(rgb * SHADE, rgb, lit);
    // halftone in the shadow band: dots on a screen grid, bigger the darker the face
    vec2 g = fract(gl_FragCoord.xy / uDotPx) - 0.5;
    float dotR = 0.34 * (1.0 - lit);
    c *= 1.0 - 0.14 * (1.0 - toonStep(dotR, length(g)));
    float rim = toonStep(0.68, 1.0 - max(dot(n, v), 0.0)) * toonStep(0.2, d);
    c += rim * 0.16;
    float gloss = clamp((1.0 - vCol.a) * 2.0, 0.0, 1.0);
    float spec = toonStep(0.965 - 0.03 * gloss, max(dot(n, normalize(uKey + v)), 0.0));
    c = mix(c, vec3(1.0, 0.99, 0.95), spec * gloss * 0.85);
    rgb = c;
  }
  rgb = mix(rgb, vec3(1.0) - rgb, uFlash);
  outColor = vec4(rgb, 1.0);
}`;
declareProgram(LIT_VS, LIT_FS);
declareProgram(INK_VS, INK_FS);

const ATTRS = [[0, 3, 0], [1, 3, 12], [2, 4, 24]];
const INK_COL = [0.06, 0.05, 0.07];
const KEY = norm([-0.45, -0.55, 0.7]);    // from above, left, and towards the cook
const CLEAR = [0.93, 0.88, 0.8];

// ── the camera, as pure maths (the panel picks with the same matrices) ───────────────────────────
// `cam` is { eye: [x,y,z], at: [x,y,z], fov (radians, vertical), roll (radians) }.
export function cameraMatrices(cam, aspect) {
  const f = norm(sub(cam.at, cam.eye));
  let up = [0, 0, 1];
  const r0 = norm(cross(f, up));
  const u0 = cross(r0, f);
  const cr = Math.cos(cam.roll || 0), sr = Math.sin(cam.roll || 0);
  const r = add(mul(r0, cr), mul(u0, sr)), u = add(mul(u0, cr), mul(r0, -sr));
  up = u;
  const view = [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, cam.eye), -dot(u, cam.eye), dot(f, cam.eye), 1,
  ];
  const near = 2, far = 600, t = 1 / Math.tan((cam.fov || 0.7) / 2);
  const proj = [
    t / aspect, 0, 0, 0,
    0, t, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
  return { vp: new Float32Array(mat4mul(proj, view)), r, u, f, t, aspect };
}
// Where a screen point (0..1 across, 0..1 down) meets the plane z = h. Null when the ray runs away
// from it.
export function pickPlane(cam, M, sx, sy, h = 0) {
  const nx = (sx * 2 - 1) * M.aspect / M.t, ny = (1 - sy * 2) / M.t;
  const d = norm(add(add(M.f, mul(M.r, nx)), mul(M.u, ny)));
  if (Math.abs(d[2]) < 1e-5) return null;
  const k = (h - cam.eye[2]) / d[2];
  if (k <= 0) return null;
  return add(cam.eye, mul(d, k));
}
// A world point to screen fractions, for labels on the overlay.
export function toScreen(M, p) {
  const v = M.vp, x = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12], y = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
  const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
  if (w <= 0) return null;
  return [(x / w + 1) / 2, (1 - y / w) / 2];
}

export function createKitchenRenderer(canvas, { phone = false } = {}) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: !phone, alpha: false, depth: true, powerPreference: phone ? 'low-power' : 'high-performance' }); } catch { gl = null; }
  if (!gl) return null;
  try { return build(); } catch (err) { console.warn('[kitchen] GLASS 2 stage unavailable, using the workspace panel:', err && err.message); return null; }

  function build() {
    prewarmPrograms(gl);
    const prog = (vs, fs, label) => {
      const p = layerProgram(gl, vs, fs, label), u = {};
      return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) };
    };
    const LIT = prog(LIT_VS, LIT_FS, 'kitchen lit'), INK = prog(INK_VS, INK_FS, 'kitchen ink');
    const layer = () => { const vao = gl.createVertexArray(); return { vao, st: makeVertexStream(gl, vao, STRIDE, ATTRS), n: 0 }; };
    const stat = layer(), dyn = layer();
    let lost = false;
    const onLost = (e) => { e.preventDefault(); lost = true; };
    canvas.addEventListener('webglcontextlost', onLost);

    function upload(L, b) { L.st.write(b.data, b.n * STRIDE); L.n = b.n; }
    function drawLayers(both) {
      for (const L of both) {
        if (L.n <= 0) continue;
        gl.bindVertexArray(L.vao);
        gl.drawArrays(gl.TRIANGLES, 0, L.n);
      }
    }

    return {
      get lost() { return lost; },
      setStatic(batch) { upload(stat, batch); },
      // One frame. `batch` is this frame's moving geometry; `fx` is { shake: [x, y], flash 0..1 }.
      render(cam, batch, fx = {}) {
        if (lost || gl.isContextLost()) { lost = true; return false; }
        const dpr = Math.min(phone ? 1.5 : 2, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        upload(dyn, batch);
        const M = cameraMatrices(cam, w / h), shake = fx.shake || [0, 0], u = h / 900;
        gl.viewport(0, 0, w, h);
        gl.clearColor(CLEAR[0], CLEAR[1], CLEAR[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);

        gl.useProgram(INK.p);
        gl.uniformMatrix4fv(INK.u('uVP'), false, M.vp);
        gl.uniform2fv(INK.u('uShake'), shake);
        gl.uniform2f(INK.u('uRes'), w, h);
        // 0.3 cm of the thing, between 1.4 and 4 px of a 900-tall picture (thinner on a phone)
        gl.uniform4f(INK.u('uInk'), 0.3, (phone ? 1.0 : 1.4) * u, (phone ? 2.6 : 4.0) * u, 0.0004);
        gl.uniform3fv(INK.u('uCol'), INK_COL);
        drawLayers([stat, dyn]);

        gl.useProgram(LIT.p);
        gl.uniformMatrix4fv(LIT.u('uVP'), false, M.vp);
        gl.uniform2fv(LIT.u('uShake'), shake);
        gl.uniform3fv(LIT.u('uEye'), cam.eye);
        gl.uniform3fv(LIT.u('uKey'), KEY);
        gl.uniform1f(LIT.u('uBands'), 3);
        gl.uniform1f(LIT.u('uDotPx'), Math.max(4, 6 * dpr));
        gl.uniform1f(LIT.u('uFlash'), Math.max(0, Math.min(1, fx.flash || 0)));
        drawLayers([stat, dyn]);
        gl.bindVertexArray(null);
        return M;
      },
      dispose() {
        canvas.removeEventListener('webglcontextlost', onLost);
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
      },
    };
  }
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
// column-major a * b
function mat4mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
