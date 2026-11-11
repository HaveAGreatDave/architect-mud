// GLASS 2 · THE ROOM STAGE'S RENDERER. A flat drawn on its own WebGL2 canvas
// (docs/proposals/room-stage.md, "Renderer"): the batches room-mesh.js builds, lit per pixel.
//
// The suite is drawn by the ballpark, whose room is all baked light. A flat lights itself here
// instead: the vertex colour is the surface times its baked occlusion, and the lamps and the panes
// (each an area light, four points across the glass) light it per pixel, with a specular term by
// material (GLOSS on enamel and glass, METAL on steel, LEATHER, SATIN, CLOTH, MATTE), so the lamp
// switching and the hour turning move the light with no rebuild. Then ACES, the sRGB curve and a
// vignette. With the comic look on (gl/house-style.js) it draws the ink first and bands the light.
//
// ⚠ NO FACE CULLING: the kit's builders don't keep one winding (arena.js's reason).
// ⚠ TEXTURES ARE sRGB. Every painted canvas is uploaded SRGB8_ALPHA8, so a sample is linear light, as
// the vertex colours are (ballpark-mesh.js lin).
//
// ⚠ WITH `see` A PANE IS A HOLE. The canvas is transparent there and the live GLASS view under it
// (panels/room-outlook.js) shows through. Without it, the painted street is looked up by direction.

import { makeVertexStream } from './stream.js';
import { declareProgram, prewarmPrograms, layerProgram } from './programs.js';
import { INK_VS, INK_FS } from './ink.js';
import { comicOn, inkOf, HOUSE } from './house-style.js';
import { STRIDE } from './ballpark-mesh.js';
import { ROOM_LIGHT_GLSL } from './room-light.js';
import { createFigureLayer } from './figure-hd.js';
import { ROOM_SKY_GLSL, setOutsideUniforms } from './room-sky.js';
// the city's faces round a room (room-outlook.js): how many, and the down and up faces' pitch
const PANO_FACES = 6, PANO_TILT = 1.45;

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
out vec3 vPos; out vec3 vNor; out vec2 vUv; out vec3 vCol; flat out float vMat;
invariant gl_Position;
void main() {
  vPos = aPos; vNor = aNor; vUv = aUv; vCol = aCol; vMat = aMat;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec2 vUv; in vec3 vCol; flat in float vMat;
uniform sampler2D uTex;
uniform float uBearing;     // the way the room's front wall faces, radians clockwise from north
uniform vec3 uFront;        // the room's front and right, in the frame the eye is in
uniform vec3 uRight;
uniform bool uLive;         // the broadcast: its texture is plain RGBA, so it's decoded here
uniform int uMode;          // 0 plain, 1 textured, 2 a picture (a screen), 3 glass, 4 the view out, 5 the city
uniform vec2 uPanoLens;     // the city's paints: their projection scales, x and y
uniform float uPanoTilt;    // the down and up faces' pitch (room-outlook.js TILT)
out vec4 outColor;
${ROOM_LIGHT_GLSL}
uniform float uLampDim;      // how far down the dimmer has a lamp's own face
// A direction as east and north.
vec2 compass(vec3 d) {
  float fw = dot(d, uFront), rt = dot(d, uRight), s = sin(uBearing), c = cos(uBearing);
  return vec2(s * fw + c * rt, c * fw - s * rt);
}
${ROOM_SKY_GLSL}
void main() {
  vec3 base = vCol;
  gCurve = smoothstep(0.004, 0.03, length(fwidth(normalize(vNor))));
  if (vMat == 43.0) { outColor = fireAt(vUv); return; }
  if (uMode == 5) {
    // the city round the building (room-outlook.js): six GLASS paints side by side, the front, right, back and
    // left of the room, then down and up (pitched uPanoTilt), from one fixed eye, each a 90° square. Looked up by
    // direction, so it stays where it is in the world however you turn or walk, as a real view does. The face is
    // the one facing the pixel most nearly. Already display-ready, so no finish.
    vec3 d = normalize(vPos - uEye);
    float f = dot(d, uFront), r = dot(d, uRight);
    float bi = 0.0, bf = -2.0, bx = 0.0, by = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = i < 4 ? float(i) * 1.5707963 : 0.0, p = i == 4 ? -uPanoTilt : (i == 5 ? uPanoTilt : 0.0);
      float ca = cos(a), sa = sin(a), cp = cos(p), sp = sin(p), dh = f * ca + r * sa;
      float fw = cp * dh + sp * d.y;
      if (fw > bf) { bf = fw; bi = float(i); bx = r * ca - f * sa; by = cp * d.y - sp * dh; }
    }
    vec2 ndc = vec2(bx, by) / max(bf, 0.05) * uPanoLens;
    vec2 uv = vec2((bi + clamp(ndc.x * 0.5 + 0.5, 0.002, 0.998)) / 6.0, clamp(0.5 - ndc.y * 0.5, 0.0, 1.0));
    outColor = vec4(texture(uTex, uv).rgb, 1.0);
    return;
  }
  if (uMode == 4) {
    vec3 d = normalize(vPos - uEye);
    // the painted street, wrapped round: it mirrors every half turn so there's no seam to find
    float az = atan(dot(d, uRight), dot(d, uFront)) / 3.14159265;
    float t = d.y / max(length(vec2(dot(d, uRight), dot(d, uFront))), 0.05);
    outColor = vec4(fallOver(d, finish(texture(uTex, vec2(abs(fract(az * 0.5 + 0.25) * 2.0 - 1.0), clamp(0.62 - t * 0.42, 0.01, 0.99))).rgb)), 1.0);
    return;
  }
  if (uMode == 1 || uMode == 2) {
    vec3 t = texture(uTex, vUv).rgb;
    base *= uLive ? mix(t / 12.92, pow((t + 0.055) / 1.055, vec3(2.4)), step(0.04045, t)) : t;
  }
  // frosted glass: the day through it and nothing else
  if (vMat == 41.0) { outColor = vec4(finish(base * (uWinC * 0.3 + vec3(0.03))), 1.0); return; }
  // a lamp, on the dimmer
  if (vMat == 42.0) { outColor = vec4(finish(base * uLampDim), 1.0); return; }
  // a light itself, or a picture: as it is
  if (uMode == 2 || vMat == 40.0) { outColor = vec4(finish(base), 1.0); return; }
  vec3 n = normalize(vNor), v = normalize(uEye - vPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 diff, spec;
  roomLight(vPos, n, v, vMat, diff, spec);
  if (uMode == 3) {
    vec4 g = roomGlass(spec, fresnelOf(n, v));
    // a pane to the weather (its uv is metres on the glass, from 100): what's on it bends the view
    if (vUv.x > 50.0 && uFall.z > 0.004 && uEye.z <= uOutZ) {
      vec3 dr = paneDrops(vUv);
      vec3 pic = uWinC * 0.2 + 0.1;
      g = vec4(mix(g.rgb, pic * 0.92 + 0.03, dr.z), max(g.a, dr.z * 0.3));
    }
    outColor = g;
    return;
  }
  outColor = vec4(finish(roomShade(base, diff, spec, vMat)), 1.0);
}`;
// ⚠ THE DEPTH PREPASS. The lit shader is the frame's cost (up to 14 lamps and 12 points of window, each a
// pow), and a sofa in front of a wall used to light the wall's pixels too. So the opaque batches lay their
// depth first with this, and the lit pass draws on LEQUAL and shades each pixel once. Both vertex shaders
// keep gl_Position `invariant`, or the two depths differ in the last bit and the walls speckle.
const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
invariant gl_Position;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;
const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 outColor;
void main() { outColor = vec4(0.0); }`;
declareProgram(VS, FS);
declareProgram(INK_VS, INK_FS);
declareProgram(DEPTH_VS, DEPTH_FS);

const ATTRS = [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 3, 32], [4, 1, 44]];
const INK_COL = [0.05, 0.045, 0.06];
const NEAR = 0.04, FAR = 120;
// How far behind its body the ink sits, in metres. Only the faces turned away are pushed out
// (ink.js uInkEye): pushed too, a face seen at a slant blacked out whole fridges and ceilings.
const INK_BACK = 0.03;

// ── the camera ──────────────────────────────────────────────────────────────────────────────────
// `cam` is { eye, yaw, pitch, fov (degrees, vertical) }: yaw 0 looks along +z and grows to the left
// (room-layout.js's frame), pitch up is positive.
// `lens` is [x, y], the projection's own scales, for a room drawn over a camera with a lens of its own.
export function roomMatrices(cam, aspect, lens = null) {
  const y = cam.yaw || 0, p = cam.pitch || 0;
  const f = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  let r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const e = cam.eye;
  // `roll` tilts the picture (the kitchen's dutch angle on the knife), radians
  if (cam.roll) {
    const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll), r0 = r, u0 = u;
    r = r0.map((x, i) => x * cr + u0[i] * sr); u = u0.map((x, i) => x * cr - r0[i] * sr);
  }
  const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
  const near = NEAR, far = FAR, t = 1 / Math.tan(((cam.fov || 70) * Math.PI / 180) / 2);
  const proj = [lens ? lens[0] : t / aspect, 0, 0, 0, 0, lens ? lens[1] : t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const vp = new Float32Array(mat4mul(proj, view));
  // `shake` [x, y] moves the picture in clip space (a hit on the board)
  if (cam.shake) for (let c = 0; c < 4; c++) { vp[c * 4] += cam.shake[0] * vp[c * 4 + 3]; vp[c * 4 + 1] += cam.shake[1] * vp[c * 4 + 3]; }
  return vp;
}
// A point in the room to the picture's pixels, or null behind the eye.
export function projectWith(vp, p, w, h) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const W = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (W <= 1e-4) return null;
  return { x: (x / W + 1) / 2 * w, y: (1 - y / W) / 2 * h };
}

// `see`: the panes are holes. The canvas is transparent there and a live GLASS view under it is the view out.
export function createRoomRenderer(canvas, { phone = false, see = false } = {}) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: see, premultipliedAlpha: !see, depth: true, powerPreference: phone ? 'low-power' : 'high-performance' }); } catch { gl = null; }
  if (!gl) return null;
  try { return build(); } catch (err) { console.warn('[room] the 3-D room is unavailable:', err && err.message); return null; }

  function build() {
    prewarmPrograms(gl);
    const prog = (vs, fs, label) => { const p = layerProgram(gl, vs, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
    const LIT = prog(VS, FS, 'room lit'), INK = prog(INK_VS, INK_FS, 'room ink'), DEPTH = prog(DEPTH_VS, DEPTH_FS, 'room depth');
    const layer = () => { const vao = gl.createVertexArray(); return { vao, st: makeVertexStream(gl, vao, STRIDE, ATTRS), n: 0 }; };
    const upload = (L, b) => { L.st.write(b.data, b.n * STRIDE); L.n = b.n; };
    const drop = (L) => { if (!L) return; gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.st.buf); };
    let lost = false;
    const onLost = (e) => { e.preventDefault(); lost = true; };
    canvas.addEventListener('webglcontextlost', onLost);

    const tex = new Map();
    const texture = (src, { repeat = true, mips = true, format = gl.SRGB8_ALPHA8 } = {}) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, gl.RGBA, gl.UNSIGNED_BYTE, src);
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
    let room = null, view = null, screen = null, live = null, figures = [];
    const people = layer(), fig = createFigureLayer(gl, { half: phone });
    // what people are handling, posed each frame: a pan on the hob, a camping stove on the floor, a plate in a hand (gl/room-meals.js)
    const props = layer();
    // a locked doorway's door and the reader beside it (gl/room-lock.js), slid by the stage as the lock gives
    const locks = layer();
    function setRoom(m, paint) {
      if (room) { for (const L of [room.solid, room.screen, room.glass, room.view, ...room.mats]) drop(L); }
      const one = (b) => { const L = layer(); upload(L, b); L.kit = b.kit || []; return L; };
      for (const key of m.textured.keys()) if (!tex.has(key)) tex.set(key, texture(paint(key)));
      room = { solid: one(m.solid), screen: one(m.screen), glass: one(m.glass), view: one(m.view), mats: [...m.textured].map(([key, b]) => ({ key, ...one(b) })) };
    }
    function setView(src) { if (view && src.width === view.w) refill(view.t, src); else { view = { t: texture(src, { repeat: false }), w: src.width }; } }
    // one face of the city round the building (room-outlook.js): i 0..5 is front, right, back, left, down, up
    let pano = null;
    function setPano(i, src, lens) {
      const fw = src.width, fh = src.height;
      if (!pano || pano.fw !== fw || pano.fh !== fh) {
        if (pano) gl.deleteTexture(pano.t);
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw * PANO_FACES, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        pano = { t, fw, fh, lens };
      }
      pano.lens = lens;
      gl.bindTexture(gl.TEXTURE_2D, pano.t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, i * fw, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    function setScreen(src) { if (screen && src.width === screen.w) refill(screen.t, src); else { screen = { t: texture(src, { repeat: false, mips: false }), w: src.width }; } }
    // what's on the set that's on (room-tv.js): mipped, or the words on it shimmer from across the room.
    // ⚠ RGBA8, NOT SRGB8_ALPHA8. Filling an sRGB texture from a canvas took 11 ms against 0.7, on every
    // new picture; the shader decodes it instead (uLive).
    function setLive(src) {
      if (live && src.width === live.w) { refill(live.t, src); gl.generateMipmap(gl.TEXTURE_2D); } else live = { t: texture(src, { repeat: false, format: gl.RGBA8 }), w: src.width };
    }
    function setPeople(b) { upload(people, b); }
    function setProps(b) { upload(props, b); }
    function setLocks(b) { upload(locks, b); }
    function setFigures(recs) { figures = recs || []; }

    let vp = null;
    // ⚠ THE PICTURE'S RESOLUTION FOLLOWS THE FRAME RATE (room-stage.js `paceRes`): 1 is the screen's own pixels up to
    // the cap, stepping down to 0.5 while frames run long. The ink is worked out from the picture's height, so the
    // lines keep their weight at any of them.
    let res = 1;
    // the light's arrays, made once and filled each frame, so walking round the room makes no garbage for them
    const buf = { lampRoom: new Float32Array(14), nextBox: new Float32Array(16), lampP: new Float32Array(42), lampKs: new Float32Array(14), winK: new Float32Array(3), lampTint: new Float32Array(42), winP: new Float32Array(9), winN: new Float32Array(9), winA: new Float32Array(9), winB: new Float32Array(9) };
    return {
      get res() { return res; },
      setRes(k) { res = Math.max(0.5, Math.min(1, k)); },
      get lost() { return lost; },
      setRoom, setView, setPano, setScreen, setLive, setPeople, setProps, setLocks, setFigures,
      get figureTris() { return fig.tris; },
      prepareFigure: (key) => fig.prepare(key),
      // a material painted and uploaded before a room that wears it is set (room-stage.js bakes the rooms past the
      // next doorway): a new one is 5 to 35 ms of painting, and a room could bring half a dozen to its first frame
      prepareTexture(key, paint) { if (!tex.has(key)) tex.set(key, texture(paint(key))); },
      project(p, w, h) { return vp ? projectWith(vp, p, w, h) : null; },
      // one frame. `light` is { lamps: [{ p: [x,y,z], k }], lampOn, day: 0..1, sky: [r,g,b],
      // wins: [{ p, n, a, b, k }], annex: [x0, x1, z0, z1] | null, outZ, outRing, front, right, bearing, panoU, panoV,
      // lampLevel (the dimmer, 0..1), fire (how a lamp marked `fire` is burning, 0..1) and outside (what
      // panels/room-window.js says is going on past the glass) }
      // (or one `lamp` and one `win`, for a caller with a room of its own)
      // `light.next` is the rooms next door, nearest first: [{ box: [x0, x1, z0, z1], lamps }]
      // `light.tvOn` is { first, count }, the stretch of the screen batch showing the broadcast, or null
      render(cam, light) {
        if (lost || gl.isContextLost()) { lost = true; return false; }
        if (!room) return false;
        const dpr = Math.min(phone ? 1.5 : 2, window.devicePixelRatio || 1) * res;
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        vp = roomMatrices(cam, w / h, light.lens);
        gl.viewport(0, 0, w, h);
        // with `see` the canvas is premultiplied, so any colour at alpha 0 is added to the city through every pane
        gl.clearColor(see ? 0 : 0.02, see ? 0 : 0.02, see ? 0 : 0.025, see ? 0 : 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS);
        gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
        const comic = comicOn();
        const opaque = [room.solid, ...room.mats, people, locks];
        const draw = (L) => { if (L.n > 0) { gl.bindVertexArray(L.vao); gl.drawArrays(gl.TRIANGLES, 0, L.n); } };

        if (comic) {
          gl.useProgram(INK.p);
          gl.uniformMatrix4fv(INK.u('uVP'), false, vp);
          gl.uniform2f(INK.u('uShake'), 0, 0);
          gl.uniform2f(INK.u('uRes'), w, h);
          // 6 mm of the thing, between 1 and 3 px of a 900-tall picture: the house line
          const ink = inkOf({ ft: 0.006, px: phone ? [0.9, 2.2] : [1.1, 3.0], col: INK_COL }), k = h / 900;
          gl.uniform4f(INK.u('uInk'), ink.ft, ink.px[0] * k, ink.px[1] * k, 0.0004);
          gl.uniform2f(INK.u('uBack'), 2 * FAR * NEAR / (FAR - NEAR), INK_BACK);
          gl.uniform4f(INK.u('uInkEye'), cam.eye[0], cam.eye[1], cam.eye[2], 1);
          gl.uniform3fv(INK.u('uCol'), ink.col);
          gl.uniform3f(INK.u('uKey'), 0, -1, 0);
          opaque.forEach(draw);
          // the props a finer, softer line than the room: a pan is small, and a full line swallows it
          if (props.n > 0) {
            gl.uniform4f(INK.u('uInk'), ink.ft * 0.5, ink.px[0] * k * 0.45, ink.px[1] * k * 0.45, 0.0004);
            gl.uniform3f(INK.u('uCol'), 0.24, 0.22, 0.24);
            draw(props);
          }
        }
        // the furniture is always inked, in the house line weighted away from the light, like the people: a
        // Borderlands sofa whether or not the walls are drawn that way. Over the comic room's own line it's
        // the heavier of the two that shows.
        {
          const kit = [room.solid, ...room.mats].filter((L) => L.n > 0 && L.kit.length);
          if (kit.length) {
            const k = h / 900, s = phone ? 0.8 : 1;
            gl.useProgram(INK.p);
            gl.uniformMatrix4fv(INK.u('uVP'), false, vp);
            gl.uniform2f(INK.u('uShake'), 0, 0);
            gl.uniform2f(INK.u('uRes'), w, h);
            gl.uniform4f(INK.u('uInk'), 0.015, HOUSE.px[0] * k * s * 0.7, HOUSE.px[1] * k * s * 0.7, 0.0004);
            gl.uniform2f(INK.u('uBack'), 2 * FAR * NEAR / (FAR - NEAR), INK_BACK);
            gl.uniform4f(INK.u('uInkEye'), cam.eye[0], cam.eye[1], cam.eye[2], 1);
            gl.uniform3fv(INK.u('uCol'), HOUSE.ink);
            gl.uniform3f(INK.u('uKey'), 0, 1, 0);
            gl.uniform1f(INK.u('uWeigh'), HOUSE.weigh);
            for (const L of kit) { gl.bindVertexArray(L.vao); for (const [a, c] of L.kit) gl.drawArrays(gl.TRIANGLES, a, c); }
            // what people are handling, a finer line: a pan is small, and a full one swallows it
            if (props.n > 0) {
              gl.uniform4f(INK.u('uInk'), 0.007, HOUSE.px[0] * k * s * 0.4, HOUSE.px[1] * k * s * 0.4, 0.0004);
              draw(props);
            }
            gl.uniform1f(INK.u('uWeigh'), 0);
          }
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
        // the dimmer is on the lamps one by one, since a fire isn't on the switch
        const level = light.lampOn ? (light.lampLevel ?? 1) : 0, lampK = 2.6;
        const home = (light.lamps || [{ p: light.lamp, k: 1 }]).slice(0, 6), wins = (light.wins || [light.win]).slice(0, 3);
        // the rooms next door (`light.next`, each { box: [x0, x1, z0, z1], lamps }): up to four, their lamps after
        // the room's own, each lighting only inside its own box (gl/room-light.js)
        const nextRooms = (light.next || []).slice(0, 4), lampRoom = buf.lampRoom.fill(0), nextBox = buf.nextBox.fill(0);
        const lamps = [...home];
        nextRooms.forEach((r, b) => { nextBox.set(r.box, b * 4); for (const q of r.lamps) if (lamps.length < 14) { lampRoom[lamps.length] = b + 1; lamps.push(q); } });
        const flat = (list, key, o) => { o.fill(0); list.forEach((q, i) => o.set(q[key], i * 3)); return o; };
        const lampP = flat(lamps, 'p', buf.lampP), lampKs = buf.lampKs.fill(0), winK = buf.winK.fill(0);
        lamps.forEach((q, i) => { lampKs[i] = (q.k ?? 1) * (q.fire ? (light.fire ?? 1) : level * level); });
        // a club's rig (gl/room-mesh.js clubRig): each lamp its own colour, and some of them moving
        const tinted = lamps.some((q) => q.tint), lampTint = buf.lampTint.fill(1);
        if (tinted || lamps.some((q) => q.fx)) {
          const t = (light.now ?? performance.now()) / 1000;
          lamps.forEach((q, i) => {
            if (q.tint) lampTint.set(q.tint, i * 3);
            const fx = q.fx;
            if (!fx) return;
            if (fx.kind === 'strobe') {
              // bursts of flashes on the drop, then dark: on for `on` seconds of every `every`
              const ph = (t + (fx.off || 0)) % (fx.every || 14);
              lampKs[i] *= ph < (fx.on || 3.5) && (t * (fx.rate || 9)) % 1 < 0.22 ? 1 : 0;
            } else if (fx.kind === 'sweep') {
              // a moving head's pool of colour, wandering an ellipse round its middle
              const a = t * (fx.speed || 0.5) + (fx.off || 0), [rx, rz] = fx.r || [2, 2];
              lampP[i * 3] = fx.c[0] + Math.cos(a) * rx; lampP[i * 3 + 1] = fx.c[1]; lampP[i * 3 + 2] = fx.c[2] + Math.sin(a * 1.37) * rz;
            } else if (fx.kind === 'beat') {
              // up hard on the beat and falling away before the next
              lampKs[i] *= 0.45 + 0.55 * Math.exp(-((t * (fx.bpm || 124) / 60) % 1) * 5);
            }
          });
        }
        wins.forEach((q, i) => { winK[i] = q.k ?? 1; });
        const winP = flat(wins, 'p', buf.winP), winN = flat(wins, 'n', buf.winN), winA = flat(wins, 'a', buf.winA), winB = flat(wins, 'b', buf.winB), ax = light.annex || [0, 0, 0, 0];
        // the room's light (gl/room-light.js), on the room's program and the figures' alike
        const setLight = (P) => {
          gl.uniform3fv(P.u('uEye'), cam.eye);
          gl.uniform3fv(P.u('uLampP'), lampP); gl.uniform1fv(P.u('uLampK'), lampKs); gl.uniform1i(P.u('uLampN'), lamps.length);
          gl.uniform1fv(P.u('uLampRoom'), lampRoom); gl.uniform1i(P.u('uLampHome'), home.length);
          gl.uniform4fv(P.u('uNextBox'), nextBox); gl.uniform1i(P.u('uNextN'), nextRooms.length);
          gl.uniform3f(P.u('uLampC'), 1.0 * lampK, 0.82 * lampK, 0.6 * lampK);
          gl.uniform1i(P.u('uLampTinted'), tinted ? 1 : 0);
          if (tinted) gl.uniform3fv(P.u('uLampTint'), lampTint);
          gl.uniform3fv(P.u('uWinP'), winP); gl.uniform3fv(P.u('uWinN'), winN);
          gl.uniform3fv(P.u('uWinA'), winA); gl.uniform3fv(P.u('uWinB'), winB);
          gl.uniform1fv(P.u('uWinK'), winK); gl.uniform1i(P.u('uWinCount'), wins.length);
          gl.uniform4f(P.u('uAnnex'), ax[0], ax[1], ax[2], ax[3]);
          gl.uniform1f(P.u('uOutZ'), light.outZ ?? 1e6);
          gl.uniform3fv(P.u('uOutRing'), light.outRing ?? [-1e6, 1e6, -1e6]);
          const wk = 0.25 + 3.4 * day;
          gl.uniform3f(P.u('uWinC'), sky[0] * wk, sky[1] * wk, sky[2] * wk);
          // what bounces round the room off the walls: some of the lamp and some of the day
          const amb = 0.035 + 0.16 * day + 0.1 * level;
          gl.uniform3f(P.u('uAmb'), amb * (0.9 + 0.1 * sky[0]), amb * (0.92 + 0.08 * sky[1]), amb);
          gl.uniform1f(P.u('uExpo'), 1.15);
          gl.uniform1f(P.u('uComic'), comic ? 1 : 0);
          gl.uniform2f(P.u('uRes'), w, h);
        };
        fig.draw(vp, figures, setLight);
        // the opaque room's depth, then everything lit on it shades only what's in front
        gl.useProgram(DEPTH.p);
        gl.uniformMatrix4fv(DEPTH.u('uVP'), false, vp);
        gl.colorMask(false, false, false, false);
        draw(room.solid); draw(people); draw(props); draw(locks);
        for (const m of room.mats) draw(m);
        gl.colorMask(true, true, true, true);
        gl.depthFunc(gl.LEQUAL);
        gl.useProgram(LIT.p);
        gl.uniformMatrix4fv(LIT.u('uVP'), false, vp);
        setLight(LIT);
        gl.uniform1i(LIT.u('uTex'), 0);
        gl.uniform1f(LIT.u('uLampDim'), 0.28 + 0.72 * level);
        setOutsideUniforms(gl, LIT, light.outside || null);
        gl.uniform1f(LIT.u('uFlame'), light.flame ?? 0.7);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(LIT.u('uMode'), 0);
        draw(room.solid); draw(people); draw(props); draw(locks);
        gl.uniform1i(LIT.u('uMode'), 1);
        for (const m of room.mats) { gl.bindTexture(gl.TEXTURE_2D, tex.get(m.key)); draw(m); }
        gl.uniform1i(LIT.u('uMode'), 2);
        if (screen) {
          const on = live && light.tvOn, S = room.screen, part = (a, n) => { if (n > 0) { gl.bindVertexArray(S.vao); gl.drawArrays(gl.TRIANGLES, a, n); } };
          gl.bindTexture(gl.TEXTURE_2D, screen.t);
          if (on) { part(0, on.first); part(on.first + on.count, S.n - on.first - on.count); gl.bindTexture(gl.TEXTURE_2D, live.t); gl.uniform1i(LIT.u('uLive'), 1); part(on.first, on.count); gl.uniform1i(LIT.u('uLive'), 0); } else draw(S);
        }
        // the painted street, on a phone or a room with no tile; with `see` the panes are holes
        if (see && pano) {
          gl.uniform1i(LIT.u('uMode'), 5);
          gl.uniform3fv(LIT.u('uFront'), light.front || [0, 0, 1]);
          gl.uniform3fv(LIT.u('uRight'), light.right || [-1, 0, 0]);
          gl.uniform2f(LIT.u('uPanoLens'), pano.lens[0], pano.lens[1]);
          gl.uniform1f(LIT.u('uPanoTilt'), PANO_TILT);
          gl.bindTexture(gl.TEXTURE_2D, pano.t);
          draw(room.view);
        } else if (!see && view) {
          gl.uniform1i(LIT.u('uMode'), 4);
          gl.uniform1f(LIT.u('uBearing'), (light.bearing || 0) * Math.PI / 180);
          gl.uniform3fv(LIT.u('uFront'), light.front || [0, 0, 1]);
          gl.uniform3fv(LIT.u('uRight'), light.right || [-1, 0, 0]);
          if (view) gl.bindTexture(gl.TEXTURE_2D, view.t);
          draw(room.view);
        }
        // the glass last, blended over what's behind it, writing no depth
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.uniform1i(LIT.u('uMode'), 3);
        draw(room.glass);
        gl.depthMask(true); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
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
