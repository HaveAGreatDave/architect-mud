// GLASS 2 · THE ARENA. Rinkside drawn by WebGL2 rather than a 2-D canvas.
//
// The 2-D renderer (rink/render.js) is a careful painter: every man is a few hundred
// gradient-filled paths, sorted back to front, then painted a second time upside down for
// his reflection. The JavaScript for that is about ten milliseconds a frame, and the
// browser rasterising it is as much again, most of it in exactly the frames a big hit puts
// eight men and a spray of blood on screen. This draws the same world, through the same
// camera (rink/camera.js), as triangles with a depth buffer:
//
//   · bodies, nets, the Zamboni and the loose things are meshes rebuilt each frame from
//     the sim's joints by arena-mesh.js (pure, so the smoke gate checks them in node);
//   · the ice is the same painted canvas, kept as a texture and re-uploaded a tile at a
//     time as it gets marked (rink/textures.js lists the tiles);
//   · the reflection is a real one: the same buffers through a camera flipped about the
//     ice, into gl/mirror.js's half-size target, read back by the ice shader at its own
//     screen position, with the light banks' highlights worked out per pixel;
//   · the lamp, the vignette, the mourning and the flash are one full-screen pass, and the
//     HUD text is a 2-D canvas laid over the top (rink/hud.js, shared with render.js).
//
// Nothing here changes what happens: it reads the world and draws it. `createArenaRenderer`
// returns null when there is no WebGL2 (or a shader won't build), and the view falls back
// to the 2-D renderer, which is still the one the smoke gate drives.
//
// ⚠ NO FACE CULLING. The mesh builders don't keep one winding (a tube's quads and a box's
// faces go round different ways), and the lit shader lights whichever side faces the eye.
// A body is closed, so the depth test hides its inside anyway.

import { RL, RW, BOARD_H, GLASS_H, GOAL_X, MID_Y, NET_HALF, NET_DEPTH, NET_H, SEGS, PANELS, PANEL_X0, PANEL_W } from '../rink/geo.js';
import { CX0, CX1, CROWS, ROWH, sharedTextures } from '../rink/textures.js';
import { createRinkCamera, matrices } from '../rink/camera.js';
import { bodyOpts, drawHud, hudActive } from '../rink/hud.js';
import { TAU, clamp, hash, rng } from '../rink/util.js';
import * as M from './arena-mesh.js';
import { makeVertexStream } from './stream.js';
import { declareProgram, prewarmPrograms, takeWarm } from './programs.js';
import { createMirrorLayer, MIRROR_SCALE } from './mirror.js';

const FACE = '"Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';

// ── shaders ─────────────────────────────────────────────────────────────────
const LIT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec4 aCol;
layout(location = 3) in vec2 aUV;
layout(location = 4) in float aTex;
uniform mat4 uVP;
uniform vec2 uShake;
out vec3 vPos; out vec3 vNor; out vec4 vCol; out vec2 vUV; out float vTex;
void main() {
  vPos = aPos; vNor = aNor; vCol = aCol; vUV = aUV; vTex = aTex;
  vec4 p = uVP * vec4(aPos, 1.0);
  p.xy += uShake * p.w;
  gl_Position = p;
}`;
// Overhead banks: a key from above and a little towards the camera side, a hemisphere fill,
// the white sheet bouncing light up under chins and gloves, and a tight highlight on
// helmets and pads. A zero normal is an unlit vertex (crowd, ads, beacon, shadows).
const LIT_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec4 vCol; in vec2 vUV; in float vTex;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform float uMourn;
uniform float uClipZ;
out vec4 outColor;
const vec3 L = vec3(0.2453, -0.4416, 0.8635);
void main() {
  if (vPos.z < uClipZ) discard;
  vec4 c = vCol;
  if (vTex > 0.5) c *= texture(uTex, vUV);
  if (c.a < 0.004) discard;
  vec3 rgb = c.rgb;
  float nl = dot(vNor, vNor);
  if (nl > 0.01) {
    vec3 n = vNor * inversesqrt(nl);
    vec3 v = normalize(uEye - vPos);
    if (dot(n, v) < 0.0) n = -n;
    float diff = max(dot(n, L), 0.0);
    float hemi = 0.5 + 0.5 * n.z;
    float bounce = max(-n.z, 0.0) * 0.3;
    float spec = pow(max(dot(n, normalize(L + v)), 0.0), 32.0) * 0.22;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.1;
    rgb = rgb * (0.3 + 0.24 * hemi + 0.6 * diff + bounce) + vec3(spec + rim);
  }
  float g = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vec3(g), uMourn * 0.75) * (1.0 - 0.22 * uMourn);
  outColor = vec4(rgb * c.a, c.a);
}`;

const ICE_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat4 uVP;
uniform vec2 uShake;
out vec2 vW;
void main() {
  vW = aPos;
  vec4 p = uVP * vec4(aPos, 0.0, 1.0);
  p.xy += uShake * p.w;
  gl_Position = p;
}`;
// The sheet: the painted ice, darker and bluer where the Zamboni left water, the mirror
// image laid over it (stronger at grazing angles and on wet ice), and the five light banks
// as highlights. A highlight is where the half-vector between the eye and a lamp stands
// straight up off the ice, which is what stretches each one into a streak towards the
// camera, the way they look on television.
const ICE_FS = `#version 300 es
precision highp float;
in vec2 vW;
uniform sampler2D uIce;
uniform sampler2D uWet;
uniform sampler2D uMir;
uniform vec2 uRes;
uniform vec3 uEye;
uniform float uRefl;
uniform float uWetK;
uniform float uGloss;
uniform float uMourn;
uniform float uHasMir;
uniform vec3 uLights[5];
out vec4 outColor;
void main() {
  vec2 uv = vec2(vW.x / ${RL.toFixed(1)}, (${RW.toFixed(1)} - vW.y) / ${RW.toFixed(1)});
  vec4 ic = texture(uIce, uv);
  if (ic.a < 0.5) discard;
  vec3 rgb = ic.rgb;
  float wet = texture(uWet, uv).a * uWetK;
  rgb = mix(rgb, rgb * vec3(0.8, 0.88, 0.97), wet * 0.55);
  vec3 p = vec3(vW, 0.0);
  vec3 v = normalize(uEye - p);
  float fres = 0.9 + 0.9 * pow(1.0 - v.z, 3.0);
  if (uHasMir > 0.5) {
    float k = clamp(uRefl * fres * (1.0 + 0.7 * wet), 0.0, 0.85);
    vec4 m = texture(uMir, gl_FragCoord.xy / uRes);
    rgb = rgb * (1.0 - k * m.a) + m.rgb * k;
  }
  float sp = 0.0;
  for (int i = 0; i < 5; i++) {
    vec3 h = normalize(normalize(uLights[i] - p) + v);
    float c = max(h.z, 0.0);
    sp += pow(c, 600.0) * 1.6 + pow(c, 60.0) * 0.12;
  }
  rgb += vec3(0.95, 0.98, 1.0) * sp * uGloss * (1.0 + 1.3 * wet);
  float g = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vec3(g), uMourn * 0.75) * (1.0 - 0.22 * uMourn);
  outColor = vec4(rgb, 1.0);
}`;

const PT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec4 aCol;
layout(location = 4) in float aSize;
uniform mat4 uVP;
uniform vec2 uShake;
uniform float uF;
out vec4 vCol;
void main() {
  vec4 p = uVP * vec4(aPos, 1.0);
  p.xy += uShake * p.w;
  gl_Position = p;
  gl_PointSize = clamp(aSize * uF / max(p.w, 0.1), 1.0, 48.0);
  vCol = aCol;
}`;
const PT_FS = `#version 300 es
precision mediump float;
in vec4 vCol;
uniform float uMourn;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  vec3 rgb = vCol.rgb;
  float g = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vec3(g), uMourn * 0.75);
  outColor = vec4(rgb * vCol.a, vCol.a);
}`;

// One full-screen triangle over everything: the lamp behind the net, its red wash over
// the building, the vignette, a death's darkening and the cut's white flash, composited
// in that order.
const POST_VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const POST_FS = `#version 300 es
precision mediump float;
uniform vec2 uRes;
uniform vec4 uWash;
uniform vec3 uLamp;
uniform float uVig;
uniform float uDark;
uniform float uFlash;
out vec4 outColor;
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 acc = vec4(0.0);
  if (uLamp.z > 0.0) { float l = max(0.0, 1.0 - length(p - uLamp.xy) / uLamp.z) * 0.95; acc = over(vec4(vec3(1.0, 0.24, 0.2) * l, l), acc); }
  acc = over(uWash, acc);
  float d = length(p - uRes * 0.5);
  float vg = smoothstep(uRes.y * 0.35, uRes.x * 0.62, d) * uVig;
  acc = over(vec4(0.0, 0.0, 0.0, vg), acc);
  acc = over(vec4(0.0, 0.0, 0.0, uDark), acc);
  acc = over(vec4(vec3(uFlash), uFlash), acc);
  outColor = acc;
}`;

declareProgram(LIT_VS, LIT_FS);
declareProgram(ICE_VS, ICE_FS);
declareProgram(PT_VS, PT_FS);
declareProgram(POST_VS, POST_FS);

// The quality rungs the view's frame-time governor steps through (gameday-rink.js).
export const ARENA_RUNGS = [
  { dpr: 1.5, mirror: MIRROR_SCALE, reflBodies: true },
  { dpr: 1.25, mirror: MIRROR_SCALE, reflBodies: true },
  { dpr: 1, mirror: 0.35, reflBodies: true },
  { dpr: 1, mirror: 0.35, reflBodies: false },
];

const LIT_ATTRS = [[0, 3, 0], [1, 3, 12], [2, 4, 24], [3, 2, 40], [4, 1, 48]];
const PT_STRIDE = 8;
const ATLAS = 1024, SLOT = 128, SLOTS = (ATLAS / SLOT) ** 2;
const GPX = 16;                                   // glass decal texels per foot
const LIGHTS = [40, 70, 100, 130, 160].map((x) => [x, MID_Y - 4, 46]);

export function createArenaRenderer(canvas, overlay, W, ice) {
  const doc = canvas.ownerDocument;
  let gl = null;
  try { gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, depth: true, powerPreference: 'high-performance' }); } catch { gl = null; }
  if (!gl) return null;
  try { return build(); } catch (err) { console.warn('[rink] GLASS 2 arena unavailable, drawing in 2-D:', err && err.message); return null; }

  function build() {
    prewarmPrograms(gl);
    const prog = (vs, fs) => {
      let p = takeWarm(gl, vs, fs);
      if (!p) {
        p = gl.createProgram();
        for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
          const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('arena shader: ' + gl.getShaderInfoLog(sh));
          gl.attachShader(p, sh); gl.deleteShader(sh);
        }
        gl.linkProgram(p);
      }
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('arena link: ' + gl.getProgramInfoLog(p));
      const u = {};
      return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) };
    };
    const LIT = prog(LIT_VS, LIT_FS), ICE = prog(ICE_VS, ICE_FS), PT = prog(PT_VS, PT_FS), POST = prog(POST_VS, POST_FS);

    // ── textures ──────────────────────────────────────────────────────────────
    const T2 = gl.TEXTURE_2D;
    function texture(src, { repeat = false, mip = false, w = 1, h = 1 } = {}) {
      const t = gl.createTexture();
      gl.bindTexture(T2, t);
      if (src) gl.texImage2D(T2, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      else gl.texImage2D(T2, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      if (mip && src) gl.generateMipmap(T2);
      return t;
    }
    const cv = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
    const white = (() => { const t = gl.createTexture(); gl.bindTexture(T2, t); gl.texImage2D(T2, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255])); return t; })();
    const shared = sharedTextures(doc);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const texAds = texture(shared.boards, { mip: true });
    const texSit = texture(shared.crowdSit, { repeat: true, mip: true }), texUp = texture(shared.crowdUp, { repeat: true, mip: true });
    const texIce = texture(ice.canvas, { mip: true });
    if (aniso) { gl.bindTexture(T2, texIce); gl.texParameterf(T2, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT))); }
    ice.dirtyAll = false; ice.dirty.fill(0);
    const texWet = texture(ice.wet);
    const texShadow = texture((() => {
      const c = cv(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
    })());
    const texNet = texture((() => {
      const c = cv(32, 32), x = c.getContext('2d');
      x.strokeStyle = 'rgba(244,246,248,0.95)'; x.lineWidth = 3; x.strokeRect(0, 0, 32, 32); return c;
    })(), { repeat: true, mip: true });
    const texLabel = texture((() => {
      const c = cv(256, 64), x = c.getContext('2d');
      x.fillStyle = '#1f4fbf'; x.font = `800 50px ${FACE}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('ICE CREW', 128, 34, 240); return c;
    })(), { mip: true });
    const atlas = texture(null, { w: ATLAS, h: ATLAS });
    const slotCv = cv(SLOT, SLOT), sctx = slotCv.getContext('2d');
    const glassCv = cv(PANELS * PANEL_W * GPX, (GLASS_H - BOARD_H) * GPX), gctx = glassCv.getContext('2d');
    const texGlass = texture(glassCv);

    // ── vertex layers ─────────────────────────────────────────────────────────
    const layer = (stride = M.STRIDE, attrs = LIT_ATTRS) => { const vao = gl.createVertexArray(); return { vao, st: makeVertexStream(gl, vao, stride, attrs), n: 0 }; };
    const put = (L, b) => { L.st.write(b.data, b.n * M.STRIDE); L.n = b.n; };
    const L = {
      stat: layer(), ads: layer(), stands: layer(), glass: layer(),
      rows: layer(), dyn: layer(), jers: layer(), label: layer(), tr: layer(), netm: layer(), gdec: layer(), shad: layer(),
      ice: layer(2, [[0, 2, 0]]), pts: layer(PT_STRIDE, [[0, 3, 0], [2, 4, 12], [4, 1, 28]]),
    };
    const postVao = gl.createVertexArray();
    {
      const q = new Float32Array([0, 0, RL, 0, RL, RW, 0, 0, RL, RW, 0, RW]);
      L.ice.st.write(q, q.length); L.ice.n = 6;
    }
    const B = Object.fromEntries(['stat', 'ads', 'stands', 'glass', 'rows', 'dyn', 'jers', 'label', 'tr', 'netm', 'gdec', 'shad'].map((k) => [k, M.createBatch(k === 'dyn' ? 1 << 16 : 1 << 12)]));
    let ptData = new Float32Array(PT_STRIDE * 1024);
    buildStatic();
    const mirror = createMirrorLayer(gl);

    let lost = false;
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); lost = true; api.lost = true; });

    const camera = createRinkCamera(W);
    let flash = 0, frame = 0, hudShown = false;
    const st = { tris: 0, draws: 0, tiles: 0 };

    // ── the building, once ────────────────────────────────────────────────────
    function buildStatic() {
      const b = B.stat, white3 = M.rgb('#e8ecf0'), dark = M.rgb('#1e242c'), cap = M.rgb('#c3c9cf'), kick = M.rgb('#d9b032');
      const gl0 = [190 / 255, 222 / 255, 242 / 255, 0.09], seam = [1, 1, 1, 0.2], top = [220 / 255, 235 / 255, 245 / 255, 0.45];
      for (const sg of SEGS) {
        const n = [sg.nx, sg.ny, 0], o = [-sg.nx * 0.28, -sg.ny * 0.28, 0];
        const A = (z, off = [0, 0, 0]) => [sg.x0 + off[0], sg.y0 + off[1], z], Bp = (z, off = [0, 0, 0]) => [sg.x1 + off[0], sg.y1 + off[1], z];
        const lift = [sg.nx * 0.01, sg.ny * 0.01, 0];
        if (sg.kind === 'far') {
          M.quad(B.ads, A(0), Bp(0), Bp(BOARD_H), A(BOARD_H), [1, 1, 1, 1], [0, 0, 1, 1], n);
        } else {
          M.quad(b, A(0), Bp(0), Bp(BOARD_H), A(BOARD_H), white3, null, n);
          M.quad(b, A(0, lift), Bp(0, lift), Bp(0.55, lift), A(0.55, lift), kick, null, n);
          M.quad(B.glass, A(BOARD_H), Bp(BOARD_H), Bp(GLASS_H), A(GLASS_H), gl0, null, n);
          M.quad(B.glass, A(GLASS_H - 0.12, lift), Bp(GLASS_H - 0.12, lift), Bp(GLASS_H, lift), A(GLASS_H, lift), top, null, null);
          // the seams between panes, every pane's width along a straight and at every corner joint
          const len = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0), k = sg.kind === 'corner' ? 1 : Math.max(1, Math.round(len / PANEL_W));
          for (let i = 0; i < k; i++) {
            const t = i / k, x = sg.x0 + (sg.x1 - sg.x0) * t, y = sg.y0 + (sg.y1 - sg.y0) * t, ux = (sg.x1 - sg.x0) / len * 0.06, uy = (sg.y1 - sg.y0) / len * 0.06;
            M.quad(B.glass, [x - ux + lift[0], y - uy + lift[1], BOARD_H], [x + ux + lift[0], y + uy + lift[1], BOARD_H], [x + ux + lift[0], y + uy + lift[1], GLASS_H], [x - ux + lift[0], y - uy + lift[1], GLASS_H], seam, null, null);
          }
        }
        M.quad(b, A(0, o), Bp(0, o), Bp(BOARD_H, o), A(BOARD_H, o), dark, null, [-sg.nx, -sg.ny, 0]);
        M.quad(b, A(BOARD_H), Bp(BOARD_H), Bp(BOARD_H, o), A(BOARD_H, o), cap, null, [0, 0, 1]);
      }
      // the concourse floor round the sheet, under everything
      M.quad(b, [-150, -120, -0.06], [350, -120, -0.06], [350, 160, -0.06], [-150, 160, -0.06], M.rgb('#0b0f14'), null, null);
      // the stands: a dark tread between each row of the crowd, and the risers they sit on.
      // These go with the crowd, which the reflection leaves out: treads alone in the ice
      // read as stripes.
      const tread = M.rgb('#0c1015');
      for (let i = 0; i < CROWS; i++) {
        const y = 89 + i * 3, z0 = 4.2 + i * 2.2;
        M.quad(B.stands, [CX0, y, z0 + 2.2], [CX1, y, z0 + 2.2], [CX1, y + 3, z0 + 2.2], [CX0, y + 3, z0 + 2.2], tread, null, null);
      }
      M.quad(B.stands, [CX0, RW + 0.3, 0], [CX1, RW + 0.3, 0], [CX1, 89, 4.2], [CX0, 89, 4.2], tread, null, null);
      // the end stands, the bowl's back wall and its sides: more crowd, in the dark
      const dim = [0.3, 0.3, 0.32, 1], far = [0.17, 0.17, 0.19, 1];
      for (const [x0, x1] of [[0, -45], [RL, RL + 45]]) M.quad(B.stands, [x0, -10, BOARD_H], [x0, 95, BOARD_H], [x1, 95, 40], [x1, -10, 40], dim, [0, 0, 0.4, 1], null);
      M.quad(B.stands, [-220, 150, 0], [420, 150, 0], [420, 150, 140], [-220, 150, 140], far, [0, 0, 2.4, 2.2], null);
      for (const x of [-120, RL + 120]) M.quad(B.stands, [x, -140, 0], [x, 150, 0], [x, 150, 140], [x, -140, 140], far, [0, 0, 1.1, 2.2], null);
      M.quad(B.stands, [CX0 - 60, 89 + CROWS * 3, 4.2 + CROWS * 2.2], [CX1 + 60, 89 + CROWS * 3, 4.2 + CROWS * 2.2], [CX1 + 60, 150, 70], [CX0 - 60, 150, 70], far, [0, 0, 1.2, 0.6], null);
      for (const k of ['stat', 'ads', 'stands', 'glass']) put(L[k], B[k]);
    }

    // ── the jerseys, a slot each in one atlas ─────────────────────────────────
    const slots = new Map();
    function jerseySlot(o) {
      const K = o.kit;
      const key = [K.jersey, K.trim, K.stripes ? 1 : 0, K.crest || '', o.num ?? '', o.name || '', Math.round((o.blood || 0) * 4), o.goalie ? 1 : 0].join('|');
      let s = slots.get(key);
      if (!s) {
        let i = slots.size;
        if (i >= SLOTS) {
          let oldK = null, oldS = null;
          for (const [k, v] of slots) if (!oldS || v.used < oldS.used) { oldK = k; oldS = v; }
          slots.delete(oldK); i = oldS.i;
        }
        s = { i, used: frame };
        slots.set(key, s);
        paintJersey(o);
        gl.bindTexture(T2, atlas);
        gl.texSubImage2D(T2, 0, (i % 8) * SLOT, Math.floor(i / 8) * SLOT, gl.RGBA, gl.UNSIGNED_BYTE, slotCv);
      }
      s.used = frame;
      const e = 1.5 / ATLAS, u0 = (s.i % 8) / 8, v0 = Math.floor(s.i / 8) / 8;
      return [u0 + e, v0 + e, u0 + 1 / 8 - e, v0 + 1 / 8 - e];
    }
    // The sweater flattened: u runs round the body (a quarter in is the chest, three
    // quarters the back), v from the collar at the top to the hem. Lettering is drawn
    // mirrored because u runs right to left as you look at him.
    function paintJersey(o) {
      const K = o.kit, c = sctx, S = SLOT;
      const vy = (f) => S * (1 - (f + 0.14) / 1.17);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = K.jersey; c.fillRect(0, 0, S, S);
      if (K.stripes) {
        c.fillStyle = '#141414';
        for (let x = 0; x < S; x += 8) c.fillRect(x, 0, 3.4, S);
      } else {
        c.fillStyle = K.trim; c.fillRect(0, vy(0.0) - 3, S, 6); c.fillRect(0, vy(0.1) - 1.5, S, 3);
        // the crest on the chest
        const cx = S * 0.25, cy = vy(0.64);
        c.beginPath(); c.arc(cx, cy, 12, 0, TAU); c.fill();
        c.fillStyle = K.jersey; c.beginPath();
        if (K.crest === 'v') { c.moveTo(cx - 7.6, cy - 7.2); c.lineTo(cx, cy + 8.6); c.lineTo(cx + 7.6, cy - 7.2); c.lineTo(cx + 3.6, cy - 7.2); c.lineTo(cx, cy + 1.4); c.lineTo(cx - 3.6, cy - 7.2); }
        else if (K.crest === 'd') { c.moveTo(cx, cy - 9.4); c.lineTo(cx + 7.2, cy); c.lineTo(cx, cy + 9.4); c.lineTo(cx - 7.2, cy); }
        else c.arc(cx, cy, 5.8, 0, TAU);
        c.closePath(); c.fill();
        // a laced V at the collar
        c.fillStyle = K.trim; c.beginPath(); c.moveTo(cx - 6, 0); c.lineTo(cx, 11); c.lineTo(cx + 6, 0); c.closePath(); c.fill();
        // the number on the back, the name over it
        c.save(); c.translate(S * 0.75, vy(0.58)); c.scale(-1, 1);
        c.font = `800 34px ${FACE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineJoin = 'round'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.45)'; c.strokeText(String(o.num ?? ''), 0, 1, 40);
        c.fillStyle = K.trim; c.fillText(String(o.num ?? ''), 0, 1, 40);
        if (o.name) { c.font = `700 9px ${FACE}`; c.fillText(String(o.name).toUpperCase(), 0, vy(0.9) - vy(0.58), 38); }
        c.restore();
      }
      if ((o.blood || 0) > 0.05) {
        const r = rng(hash(o.name || o.num || 'x'));
        c.fillStyle = 'rgba(110,8,12,0.85)';
        for (let i = 0, n = Math.round(2 + o.blood * 6); i < n; i++) {
          const x = S * (0.08 + r() * 0.4), y = S * (0.25 + r() * 0.5), rr = 2 + r() * 4 * o.blood;
          c.beginPath(); c.ellipse(x, y, rr, rr * 1.3, 0, 0, TAU); c.fill();
          c.fillRect(x - rr * 0.2, y, rr * 0.4, rr * (2 + r() * 3));
        }
      }
    }

    // ── cracks and blood on the far glass ─────────────────────────────────────
    let glassSig = '';
    function paintGlass() {
      const sig = W.cracks.length + ':' + W.glassBlood.length + ':' + (W.glassBlood.length ? W.glassBlood[W.glassBlood.length - 1].seed : 0);
      if (sig === glassSig) return;
      glassSig = sig;
      const c = gctx, X = (x) => (x - PANEL_X0) * GPX, Z = (z) => (GLASS_H - z) * GPX;
      c.clearRect(0, 0, glassCv.width, glassCv.height);
      for (const g of W.glassBlood) {
        const r = rng(g.seed), x = X(g.x), y = Z(g.z);
        c.fillStyle = 'rgba(130,8,14,0.8)'; c.beginPath(); c.ellipse(x, y, g.r * GPX, g.r * GPX * 0.8, 0, 0, TAU); c.fill();
        c.fillStyle = 'rgba(130,8,14,0.75)';
        for (let k = 0; k < 3; k++) { const dx = (r() - 0.5) * g.r * 2 * GPX, len = (0.6 + r() * 1.6) * GPX; c.fillRect(x + dx - 1, y, 2, len); }
      }
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1;
      for (const k of W.cracks) {
        const r = rng(k.seed), cx = X(k.x), cy = Z(k.z);
        c.beginPath();
        for (let i = 0; i < 9; i++) {
          const an = r() * TAU, l = (0.8 + r() * 2.2) * GPX; let x = cx, y = cy;
          c.moveTo(x, y);
          for (let j = 0; j < 3; j++) { x += Math.cos(an + (r() - 0.5) * 0.6) * l / 3; y += Math.sin(an + (r() - 0.5) * 0.6) * l / 3; c.lineTo(x, y); }
        }
        c.stroke(); c.beginPath(); c.arc(cx, cy, 0.35 * GPX, 0, TAU); c.stroke();
      }
      gl.bindTexture(T2, texGlass);
      gl.texImage2D(T2, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glassCv);
    }

    // ── the ice, a tile at a time ─────────────────────────────────────────────
    const tiles = new Map();
    const tileCv = (w, h) => { const k = w * 4096 + h; let t = tiles.get(k); if (!t) { t = cv(w, h); tiles.set(k, t); } return t; };
    function uploadIce() {
      ice.flush?.();
      gl.bindTexture(T2, texIce);
      let changed = false;
      if (ice.dirtyAll) {
        gl.texImage2D(T2, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ice.canvas);
        ice.dirtyAll = false; ice.dirty.fill(0); changed = true; st.tiles = -1;
      } else {
        // ⚠ A TILE IS COPIED OUT FIRST. A canvas upload with UNPACK_SKIP_PIXELS/ROWS is in the
        // WebGL2 spec, and Chromium on SwiftShader ignores the skips: every tile arrived as the
        // sheet's top-left corner, which is transparent past the rounded boards, so the ice
        // grew black holes wherever it was marked. A canvas-to-canvas copy works everywhere.
        const { TX, size } = ice.tiles, d = ice.dirty, cw = ice.canvas.width, ch = ice.canvas.height;
        let n = 0;
        for (let k = 0; k < d.length && n < 28; k++) {
          if (!d[k]) continue;
          d[k] = 0; n++;
          const x = (k % TX) * size, y = Math.floor(k / TX) * size, w = Math.min(size, cw - x), h = Math.min(size, ch - y);
          const t = tileCv(w, h), c = t.getContext('2d');
          c.clearRect(0, 0, w, h); c.drawImage(ice.canvas, x, y, w, h, 0, 0, w, h);
          gl.texSubImage2D(T2, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, t);
        }
        if (n) changed = true;
        st.tiles = n;
      }
      if (changed) gl.generateMipmap(T2);
      if (ice.wetDirty && frame % 3 === 0) {
        ice.wetDirty = false;
        gl.bindTexture(T2, texWet);
        gl.texImage2D(T2, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ice.wet);
      }
    }

    // ── this frame's geometry ─────────────────────────────────────────────────
    let propsN = 0;
    function buildFrame(P) {
      for (const k of ['rows', 'dyn', 'jers', 'label', 'tr', 'netm', 'gdec', 'shad']) M.reset(B[k]);
      const d = B.dyn;
      // the crowd rows, standing when the building is up
      const up = W.crowd > 0.45, H = CROWS * ROWH;
      for (let i = CROWS - 1; i >= 0; i--) {
        const y = 89 + i * 3, z0 = 4.2 + i * 2.2;
        const bob = up ? W.crowd * 0.35 * Math.max(0, Math.sin(W.t * 13 + i * 1.7)) : 0;
        M.quad(B.rows, [CX0, y, z0 + bob], [CX1, y, z0 + bob], [CX1, y, z0 + 2.2 + bob], [CX0, y, z0 + 2.2 + bob], [1, 1, 1, 1], [0, (i * ROWH) / H, 1, ((i + 1) * ROWH - 0.5) / H], null);
      }
      // the props the ice reflects whatever the quality: nets, the Zamboni
      for (const [gx, dir, side] of [[GOAL_X[0], -1, 'a'], [GOAL_X[1], 1, 'h']]) M.buildNet(d, B.netm, gx, dir, MID_Y, NET_HALF, NET_DEPTH, NET_H, (W.netBulge[side] || 0) * 0.7);
      if (W.zamboni) M.buildZamboni(d, B.label, W.zamboni, W.t);
      propsN = d.n;
      // the men
      for (const b of W.bodies()) {
        const o = bodyOpts(W, b);
        if (!o.kit) continue;
        const J = W.rigOf(b), hp = J[3] && P(J[3][0], J[3][1], J[3][2]);
        o.detail = hp && hp.s > 24 ? 1 : 0;
        o.slot = jerseySlot(o);
        M.buildBody(d, B.jers, J, o);
        M.buildVisor(B.tr, o);
        const p = b.rag ? b.rag.pts[0] : b;
        shadow(p.x, p.y, b.rag ? 2.6 : b.kind === 'goalie' ? 1.7 : 1.3);
      }
      if (!W.puck.hidden) { M.buildPuck(d, W.puck); shadow(W.puck.x, W.puck.y, 0.35); }
      for (const x of W.debris) M.buildDebris(d, x, W.kits[x.side] || W.kits.a);
      for (const l of W.limbs) { const o = bodyOpts(W, l.owner || { side: l.side }); if (o.kit) M.buildSevered(d, l, o); }
      if (W.stretcher) M.buildStretcher(d, W.stretcher);
      if (W.zamboni) shadow(W.zamboni.x, W.zamboni.y, 6.5);
      farGlass();
      return particles();
    }
    function shadow(x, y, r) {
      for (const [ox, oy, a] of [[0, 0, 0.3], [1.3, 0.9, 0.1], [-1.3, 0.9, 0.1]]) {
        const cx = x + ox, cy = y + oy, ry = r * 0.7;
        M.quad(B.shad, [cx - r, cy - ry, 0.03], [cx + r, cy - ry, 0.03], [cx + r, cy + ry, 0.03], [cx - r, cy + ry, 0.03], [14 / 255, 24 / 255, 38 / 255, a], [0, 0, 1, 1], null);
      }
    }
    function farGlass() {
      const t = B.tr, by = W.boardShake * 0.25 * Math.sin(W.t * 60);
      const frameCol = [20 / 255, 26 / 255, 32 / 255, 0.6], streak = [1, 1, 1, 0.1];
      const decal = W.cracks.length || W.glassBlood.length;
      if (decal) paintGlass();
      for (let i = 0; i < PANELS; i++) {
        const x0 = PANEL_X0 + i * PANEL_W, x1 = x0 + PANEL_W, f = W.flex[i] || 0, y = RW + f * 0.9 + by;
        M.quad(t, [x0 - 0.05, y - 0.02, BOARD_H], [x0 + 0.05, y - 0.02, BOARD_H], [x0 + 0.05, y - 0.02, GLASS_H], [x0 - 0.05, y - 0.02, GLASS_H], frameCol, null, null);
        if (W.broken.has(i)) {
          // a shattered pane: an empty frame with teeth of glass left in it
          const r = rng(i * 131 + 7), col = [200 / 255, 232 / 255, 250 / 255, 0.35];
          for (let k = 0; k < 6; k++) {
            const a = x0 + (k / 6) * PANEL_W, b2 = x0 + ((k + 1) / 6) * PANEL_W, hgt = BOARD_H + 0.3 + r() * 1.2;
            M.quad(t, [a, y, BOARD_H], [b2, y, BOARD_H], [b2, y, BOARD_H + 0.2], [(a + b2) / 2, y, hgt], col, null, null);
          }
          continue;
        }
        M.quad(t, [x0, y, BOARD_H], [x1, y, BOARD_H], [x1, y, GLASS_H], [x0, y, GLASS_H], [190 / 255, 222 / 255, 242 / 255, 0.09 + f * 0.25], null, null);
        M.quad(t, [x0 + 1.1, y - 0.01, BOARD_H], [x0 + 1.4, y - 0.01, BOARD_H], [x0 + 3.0, y - 0.01, GLASS_H], [x0 + 2.7, y - 0.01, GLASS_H], streak, null, null);
        if (decal) {
          const u0 = (x0 - PANEL_X0) / (PANELS * PANEL_W), u1 = (x1 - PANEL_X0) / (PANELS * PANEL_W);
          M.quad(B.gdec, [x0, y - 0.04, BOARD_H], [x1, y - 0.04, BOARD_H], [x1, y - 0.04, GLASS_H], [x0, y - 0.04, GLASS_H], [1, 1, 1, 1], [u0, 0, u1, 1], null);
        }
      }
      M.quad(t, [PANEL_X0, RW + by - 0.03, GLASS_H - 0.12], [RL - PANEL_X0, RW + by - 0.03, GLASS_H - 0.12], [RL - PANEL_X0, RW + by - 0.03, GLASS_H], [PANEL_X0, RW + by - 0.03, GLASS_H], [220 / 255, 235 / 255, 245 / 255, 0.5], null, null);
    }
    const PCOL = { spray: [245 / 255, 250 / 255, 1, 0.7], tooth: M.rgb('#f4f1e6'), sweat: [220 / 255, 235 / 255, 1, 0.7], shard: [200 / 255, 232 / 255, 250 / 255, 0.85] };
    function particles() {
      const need = (W.parts.length + 8) * PT_STRIDE;
      if (ptData.length < need) ptData = new Float32Array(need * 2);
      let n = 0;
      const pt = (x, y, z, c, s) => { const o = n * PT_STRIDE; ptData[o] = x; ptData[o + 1] = y; ptData[o + 2] = z; ptData[o + 3] = c[0]; ptData[o + 4] = c[1]; ptData[o + 5] = c[2]; ptData[o + 6] = c[3]; ptData[o + 7] = s; n++; };
      for (const p of W.parts) {
        if (p.type === 'blood') pt(p.x, p.y, p.z, M.rgb(p.col), p.size * 1.6);
        else pt(p.x, p.y, p.z, PCOL[p.type] || PCOL.shard, p.size * 2);
      }
      // a few phones going off in the stands when the building is up
      if (W.crowd > 0.5 && W.mourning < 0.2) for (let i = 0; i < 6; i++) { if (Math.random() > W.crowd * 0.5) continue; pt(CX0 + Math.random() * (CX1 - CX0), 89 + Math.random() * 40, 6 + Math.random() * 30, [1, 1, 1, 0.9], 0.3 + Math.random() * 0.3); }
      return n;
    }

    function fit() {
      const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
      const dpr = Math.min(api.quality.dpr, (doc.defaultView && doc.defaultView.devicePixelRatio) || 1);
      const w = Math.max(2, Math.round((r.width || canvas.width || 640) * dpr)), h = Math.max(2, Math.round((r.height || canvas.height || 360) * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (overlay && (overlay.width !== w || overlay.height !== h)) { overlay.width = w; overlay.height = h; hudShown = true; }
      return { w, h, u: w / 900 };
    }

    // ── drawing ───────────────────────────────────────────────────────────────
    function useLit(vp, eye, shake, clipZ) {
      gl.useProgram(LIT.p);
      gl.uniformMatrix4fv(LIT.u('uVP'), false, vp);
      gl.uniform2fv(LIT.u('uShake'), shake);
      gl.uniform3fv(LIT.u('uEye'), eye);
      gl.uniform1f(LIT.u('uMourn'), W.mourning || 0);
      gl.uniform1f(LIT.u('uClipZ'), clipZ);
      gl.uniform1i(LIT.u('uTex'), 0);
      gl.activeTexture(gl.TEXTURE0);
    }
    function draw(Ly, tex, first = 0, count = Ly.n - first) {
      if (count <= 0) return;
      gl.bindVertexArray(Ly.vao);
      gl.bindTexture(T2, tex || white);
      gl.drawArrays(gl.TRIANGLES, first, count);
      st.draws++; st.tris += count / 3;
    }
    const reflStrength = () => clamp(0.3 - 0.2 * ice.wear + 0.14 * ice.wetness, 0.08, 0.42) * (1 - 0.35 * (W.mourning || 0));

    function render() {
      if (lost) return;
      frame++;
      const { w, h, u } = fit();
      camera.view = api.view;
      const { C, P } = camera.update(w, h);
      if (camera.flash) { flash = camera.flash; camera.flash = 0; }
      const crowdTex = W.crowd > 0.45 ? texUp : texSit;
      const sh = W.shake * 5 * u, sx = sh * (Math.sin(W.t * 47) + 0.5 * Math.sin(W.t * 83 + 1)) / 1.5, sy = sh * (Math.sin(W.t * 59 + 2) + 0.5 * Math.sin(W.t * 97)) / 1.5;
      const shake = [2 * sx / w, -2 * sy / h];
      st.draws = 0; st.tris = 0;

      const nPts = buildFrame(P);
      for (const k of ['rows', 'dyn', 'jers', 'label', 'tr', 'netm', 'gdec', 'shad']) put(L[k], B[k]);
      L.pts.st.write(ptData, nPts * PT_STRIDE); L.pts.n = nPts;
      uploadIce();

      gl.disable(gl.CULL_FACE);
      // the reflection: everything that stands on the ice, through a camera flipped under it
      const MR = matrices(C, true), eyeR = [C.x, C.y, -C.z];
      const hasMir = mirror.bind(w, h, api.quality.mirror);
      if (hasMir) {
        useLit(new Float32Array(MR.viewProj), eyeR, shake, -0.05);
        gl.depthMask(true);
        // the boards and their ads; not the crowd, which is dim against a lit sheet
        draw(L.stat); draw(L.ads, texAds);
        if (api.quality.reflBodies) { draw(L.dyn); draw(L.jers, atlas); } else draw(L.dyn, null, 0, propsN);
        draw(L.label, texLabel);
        mirror.release();
      }

      // the picture
      const M0 = matrices(C), vp = new Float32Array(M0.viewProj), eye = [C.x, C.y, C.z];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.025, 0.033, 0.045, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      useLit(vp, eye, shake, -1e9);
      draw(L.stands, crowdTex); draw(L.rows, crowdTex); draw(L.stat); draw(L.ads, texAds);
      draw(L.dyn); draw(L.jers, atlas); draw(L.label, texLabel);

      gl.useProgram(ICE.p);
      gl.uniformMatrix4fv(ICE.u('uVP'), false, vp);
      gl.uniform2fv(ICE.u('uShake'), shake);
      gl.uniform3fv(ICE.u('uEye'), eye);
      gl.uniform2f(ICE.u('uRes'), w, h);
      gl.uniform1f(ICE.u('uRefl'), reflStrength());
      gl.uniform1f(ICE.u('uWetK'), Math.min(1, ice.wetness * 1.5));
      gl.uniform1f(ICE.u('uGloss'), (0.07 + 0.09 * (1 - ice.wear) + 0.08 * ice.wetness) * (1 - 0.7 * (W.mourning || 0)) * 4);
      gl.uniform1f(ICE.u('uMourn'), W.mourning || 0);
      gl.uniform1f(ICE.u('uHasMir'), hasMir && mirror.texture ? 1 : 0);
      gl.uniform3fv(ICE.u('uLights'), LIGHTS.flat());
      gl.uniform1i(ICE.u('uIce'), 0); gl.uniform1i(ICE.u('uWet'), 1); gl.uniform1i(ICE.u('uMir'), 2);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(T2, texWet);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(T2, hasMir && mirror.texture ? mirror.texture : white);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(T2, texIce);
      gl.bindVertexArray(L.ice.vao); gl.drawArrays(gl.TRIANGLES, 0, 6); st.draws++;
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(T2, null); gl.activeTexture(gl.TEXTURE0);

      // shadows on the ice, then everything see-through, without writing depth
      useLit(vp, eye, shake, -1e9);
      gl.depthMask(false);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2);
      draw(L.shad, texShadow);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      draw(L.netm, texNet); draw(L.tr); draw(L.gdec, texGlass); draw(L.glass);
      if (nPts) {
        gl.useProgram(PT.p);
        gl.uniformMatrix4fv(PT.u('uVP'), false, vp);
        gl.uniform2fv(PT.u('uShake'), shake);
        gl.uniform1f(PT.u('uF'), C.f);
        gl.uniform1f(PT.u('uMourn'), W.mourning || 0);
        gl.bindVertexArray(L.pts.vao); gl.drawArrays(gl.POINTS, 0, nPts); st.draws++;
      }

      // the light over the top of it all
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(POST.p);
      gl.uniform2f(POST.u('uRes'), w, h);
      const lampOn = W.lamp > 0 && W.lampSide;
      const k = lampOn ? (Math.sin(W.t * 18) > 0 ? 0.1 : 0.035) * Math.min(1, W.lamp) : 0;
      gl.uniform4f(POST.u('uWash'), k, 30 / 255 * k, 40 / 255 * k, k);
      let lamp = [0, 0, 0];
      if (lampOn) {
        const gx = W.lampSide === 'a' ? GOAL_X[0] : GOAL_X[1], dir = W.lampSide === 'a' ? -1 : 1;
        const l = P(gx + dir * (NET_DEPTH + 6), MID_Y, GLASS_H + 1);
        if (l) lamp = [l.x + sx, h - (l.y + sy), 3 * l.s];
      }
      gl.uniform3fv(POST.u('uLamp'), lamp);
      gl.uniform1f(POST.u('uVig'), 0.42 + 0.3 * (W.mourning || 0));
      gl.uniform1f(POST.u('uDark'), 0.22 * (W.mourning || 0));
      gl.uniform1f(POST.u('uFlash'), flash * 0.5);
      flash = Math.max(0, flash - 0.12);
      gl.bindVertexArray(postVao); gl.drawArrays(gl.TRIANGLES, 0, 3); st.draws++;
      gl.bindVertexArray(null);
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);

      // the HUD, in 2-D over the top, and only while there's any
      if (overlay) {
        const on = hudActive(W);
        if (on || hudShown) {
          const o = overlay.getContext('2d');
          o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h);
          if (on) drawHud(o, W, w, h, u);
          hudShown = on;
        }
      }
    }

    const api = { render, stats: st, cam: camera.cam, view: 'broadcast', kind: 'gl', lost: false, rungs: ARENA_RUNGS, quality: { ...ARENA_RUNGS[0] },
      // the reflection buffer, for a bench that wants to know it isn't empty
      mirrorPeak: () => mirror.peak() };
    return api;
  }
}
