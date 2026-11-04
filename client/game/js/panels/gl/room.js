// GLASS 2 · THE ROOM STAGE'S RENDERER. A flat drawn on its own WebGL2 canvas
// (docs/proposals/room-stage.md, "Renderer"): the batches room-mesh.js builds, lit per pixel.
//
// The suite is drawn by the ballpark, whose room is all baked light. A flat lights itself here
// instead: the vertex colour is the surface times its baked occlusion, and the pendant lamp and the
// window (an area light, four points across the glass) light it per pixel, with a specular term by
// material (GLOSS on enamel and glass, METAL on steel, LEATHER, SATIN, CLOTH, MATTE), so the lamp
// switching and the hour turning move the light with no rebuild. Then ACES, the sRGB curve and a
// vignette. With the comic look on (gl/house-style.js) it draws the ink first and bands the light.
//
// ⚠ NO FACE CULLING: the kit's builders don't keep one winding (arena.js's reason).
// ⚠ TEXTURES ARE sRGB. Every painted canvas is uploaded SRGB8_ALPHA8, so a sample is linear light, as
// the vertex colours are (ballpark-mesh.js lin).

import { makeVertexStream } from './stream.js';
import { declareProgram, prewarmPrograms, layerProgram } from './programs.js';
import { INK_VS, INK_FS } from './ink.js';
import { comicOn, inkOf, HOUSE } from './house-style.js';
import { STRIDE } from './ballpark-mesh.js';
import { ROOM_LIGHT_GLSL } from './room-light.js';
import { createFigureLayer } from './figure-hd.js';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNor; out vec2 vUv; out vec3 vCol; flat out float vMat;
void main() {
  vPos = aPos; vNor = aNor; vUv = aUv; vCol = aCol; vMat = aMat;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec2 vUv; in vec3 vCol; flat in float vMat;
uniform sampler2D uTex;
uniform int uMode;          // 0 plain, 1 textured, 2 a picture (the view, a screen), 3 glass
out vec4 outColor;
${ROOM_LIGHT_GLSL}
void main() {
  vec3 base = vCol;
  if (uMode == 1 || uMode == 2) base *= texture(uTex, vUv).rgb;
  // a light itself, or a picture: as it is
  if (uMode == 2 || vMat == 40.0) { outColor = vec4(finish(base), 1.0); return; }
  vec3 n = normalize(vNor), v = normalize(uEye - vPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 diff, spec;
  roomLight(vPos, n, v, vMat, diff, spec);
  if (uMode == 3) { outColor = roomGlass(spec, fresnelOf(n, v)); return; }
  outColor = vec4(finish(roomShade(base, diff, spec, vMat)), 1.0);
}`;
declareProgram(VS, FS);
declareProgram(INK_VS, INK_FS);

const ATTRS = [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 3, 32], [4, 1, 44]];
const INK_COL = [0.05, 0.045, 0.06];

// ── the camera ──────────────────────────────────────────────────────────────────────────────────
// `cam` is { eye, yaw, pitch, fov (degrees, vertical) }: yaw 0 looks along +z and grows to the left
// (room-layout.js's frame), pitch up is positive.
export function roomMatrices(cam, aspect) {
  const y = cam.yaw || 0, p = cam.pitch || 0;
  const f = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  const r = norm(cross(f, [0, 1, 0])), u = cross(r, f), e = cam.eye;
  const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
  const near = 0.04, far = 120, t = 1 / Math.tan(((cam.fov || 70) * Math.PI / 180) / 2);
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return new Float32Array(mat4mul(proj, view));
}
// A point in the room to the picture's pixels, or null behind the eye.
export function projectWith(vp, p, w, h) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const W = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (W <= 1e-4) return null;
  return { x: (x / W + 1) / 2 * w, y: (1 - y / W) / 2 * h };
}

export function createRoomRenderer(canvas, { phone = false } = {}) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: phone ? 'low-power' : 'high-performance' }); } catch { gl = null; }
  if (!gl) return null;
  try { return build(); } catch (err) { console.warn('[room] the 3-D room is unavailable:', err && err.message); return null; }

  function build() {
    prewarmPrograms(gl);
    const prog = (vs, fs, label) => { const p = layerProgram(gl, vs, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
    const LIT = prog(VS, FS, 'room lit'), INK = prog(INK_VS, INK_FS, 'room ink');
    const layer = () => { const vao = gl.createVertexArray(); return { vao, st: makeVertexStream(gl, vao, STRIDE, ATTRS), n: 0 }; };
    const upload = (L, b) => { L.st.write(b.data, b.n * STRIDE); L.n = b.n; };
    const drop = (L) => { if (!L) return; gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.st.buf); };
    let lost = false;
    const onLost = (e) => { e.preventDefault(); lost = true; };
    canvas.addEventListener('webglcontextlost', onLost);

    const tex = new Map();
    const texture = (src, { repeat = true, mips = true } = {}) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      if (mips) gl.generateMipmap(gl.TEXTURE_2D);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      const af = gl.getExtension('EXT_texture_filter_anisotropic');
      if (af && mips) gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      return t;
    };
    const refill = (t, src) => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src); };

    // what's in the room: the solid batch, one per material, the screens, the glass, the view, and
    // the people: the close-up figures (gl/figure-hd.js, posed by the stage every frame) and a batch
    // the Figure Lab fills with the crowd's body to set beside them
    let room = null, view = null, screen = null, figures = [];
    const people = layer(), fig = createFigureLayer(gl, { half: phone });
    function setRoom(m, paint) {
      if (room) { for (const L of [room.solid, room.screen, room.glass, room.view, ...room.mats]) drop(L); }
      const one = (b) => { const L = layer(); upload(L, b); return L; };
      for (const key of m.textured.keys()) if (!tex.has(key)) tex.set(key, texture(paint(key)));
      room = { solid: one(m.solid), screen: one(m.screen), glass: one(m.glass), view: one(m.view), mats: [...m.textured].map(([key, b]) => ({ key, ...one(b) })) };
    }
    function setView(src) { if (view && src.width === view.w) refill(view.t, src); else { view = { t: texture(src, { repeat: false }), w: src.width }; } }
    function setScreen(src) { if (screen && src.width === screen.w) refill(screen.t, src); else { screen = { t: texture(src, { repeat: false, mips: false }), w: src.width }; } }
    function setPeople(b) { upload(people, b); }
    function setFigures(recs) { figures = recs || []; }

    let vp = null;
    return {
      get lost() { return lost; },
      setRoom, setView, setScreen, setPeople, setFigures,
      get figureTris() { return fig.tris; },
      prepareFigure: (key) => fig.prepare(key),
      project(p, w, h) { return vp ? projectWith(vp, p, w, h) : null; },
      // one frame. `light` is { lamp: [x,y,z], lampOn, day: 0..1, sky: [r,g,b], win: { p, n, a, b } }
      render(cam, light) {
        if (lost || gl.isContextLost()) { lost = true; return false; }
        if (!room) return false;
        const dpr = Math.min(phone ? 1.5 : 2, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        vp = roomMatrices(cam, w / h);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.02, 0.02, 0.025, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
        gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
        const comic = comicOn();
        const opaque = [room.solid, ...room.mats, people];
        const draw = (L) => { if (L.n > 0) { gl.bindVertexArray(L.vao); gl.drawArrays(gl.TRIANGLES, 0, L.n); } };

        if (comic) {
          gl.useProgram(INK.p);
          gl.uniformMatrix4fv(INK.u('uVP'), false, vp);
          gl.uniform2f(INK.u('uShake'), 0, 0);
          gl.uniform2f(INK.u('uRes'), w, h);
          // 6 mm of the thing, between 1 and 3 px of a 900-tall picture: the house line
          const ink = inkOf({ ft: 0.006, px: phone ? [0.9, 2.2] : [1.1, 3.0], col: INK_COL }), k = h / 900;
          gl.uniform4f(INK.u('uInk'), ink.ft, ink.px[0] * k, ink.px[1] * k, 0.0004);
          gl.uniform3fv(INK.u('uCol'), ink.col);
          gl.uniform3f(INK.u('uKey'), 0, -1, 0);
          opaque.forEach(draw);
        }
        // the people are always inked, at the house's line, weighted under the light: the close-up
        // figure is drawn in the comic manner whether or not the room is (gl/figure-hd.js)
        fig.ink(vp, figures, (P) => {
          const k = h / 900;
          gl.uniform2f(P.u('uRes'), w, h);
          gl.uniform4f(P.u('uInk'), 0.01, HOUSE.px[0] * k * (phone ? 0.8 : 1), HOUSE.px[1] * k * (phone ? 0.8 : 1), 0);
          gl.uniform3fv(P.u('uEyeI'), cam.eye);
          gl.uniform1f(P.u('uBack'), 0.02);
          gl.uniform3fv(P.u('uCol'), HOUSE.ink);
          gl.uniform3f(P.u('uKey'), 0, 1, 0);
          gl.uniform1f(P.u('uWeigh'), HOUSE.weigh);
        });

        const day = Math.max(0, Math.min(1, light.day || 0)), sky = light.sky || [0.7, 0.8, 1];
        const lampK = light.lampOn ? 2.6 : 0;
        // the room's light (gl/room-light.js), on the room's program and the figures' alike
        const setLight = (P) => {
          gl.uniform3fv(P.u('uEye'), cam.eye);
          gl.uniform3fv(P.u('uLampP'), light.lamp);
          gl.uniform3f(P.u('uLampC'), 1.0 * lampK, 0.82 * lampK, 0.6 * lampK);
          gl.uniform3fv(P.u('uWinP'), light.win.p); gl.uniform3fv(P.u('uWinN'), light.win.n);
          gl.uniform3fv(P.u('uWinA'), light.win.a); gl.uniform3fv(P.u('uWinB'), light.win.b);
          const wk = 0.25 + 3.4 * day;
          gl.uniform3f(P.u('uWinC'), sky[0] * wk, sky[1] * wk, sky[2] * wk);
          // what bounces round the room off the walls: some of the lamp and some of the day
          const amb = 0.035 + 0.16 * day + (light.lampOn ? 0.1 : 0);
          gl.uniform3f(P.u('uAmb'), amb * (0.9 + 0.1 * sky[0]), amb * (0.92 + 0.08 * sky[1]), amb);
          gl.uniform1f(P.u('uExpo'), 1.15);
          gl.uniform1f(P.u('uComic'), comic ? 1 : 0);
          gl.uniform2f(P.u('uRes'), w, h);
        };
        fig.draw(vp, figures, setLight);
        gl.useProgram(LIT.p);
        gl.uniformMatrix4fv(LIT.u('uVP'), false, vp);
        setLight(LIT);
        gl.uniform1i(LIT.u('uTex'), 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(LIT.u('uMode'), 0);
        draw(room.solid); draw(people);
        gl.uniform1i(LIT.u('uMode'), 1);
        for (const m of room.mats) { gl.bindTexture(gl.TEXTURE_2D, tex.get(m.key)); draw(m); }
        gl.uniform1i(LIT.u('uMode'), 2);
        if (view) { gl.bindTexture(gl.TEXTURE_2D, view.t); draw(room.view); }
        if (screen) { gl.bindTexture(gl.TEXTURE_2D, screen.t); draw(room.screen); }
        // the glass last, blended over what's behind it, writing no depth
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.uniform1i(LIT.u('uMode'), 3);
        draw(room.glass);
        gl.depthMask(true); gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
        return true;
      },
      dispose() {
        canvas.removeEventListener('webglcontextlost', onLost);
        try { fig.dispose(); } catch { /* the context may be gone already */ }
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
      },
    };
  }
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
// column-major a * b
function mat4mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
