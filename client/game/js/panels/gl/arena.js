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
//   · the lamp, the vignette and the mourning are one full-screen pass, and the HUD (text,
//     the replay's wipe) is a 2-D canvas laid over the top (rink/hud.js, shared with
//     render.js).
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
import { bodyOpts, drawHud, hudActive, maskColours, drawnJoints, drawnAt, drawnPuck, glowTail, GLOW } from '../rink/hud.js';
import { TAU, clamp, hash, rng } from '../rink/util.js';
import { inkOf, figureLightOf, rinkInkOf, comicOn, HOUSE } from './house-style.js';
import { CEL, CEL_GLSL } from './cel-figure.js';
import { INK, PAINTED, inkLine, fold, patch } from '../comic-pen.js';
import { createDepthSSAO } from './ssao.js';
import * as M from './arena-mesh.js';
import { crowdMorph, CROWD_MORPH } from './ballpark-mesh.js';
import { GATE_Y, GATE_HALF } from '../rink/zamboni.js';
import { paintLivery } from '../rink/livery.js';
import { goalLights } from '../rink/goal-lights.js';
import { RINK_CROWD_VS, RINK_CROWD_FS, INST as CROWD_INST, buildBowl, crowdInstances, hideFor, nearR, nearDrop, seesRing, roarOf } from './arena-crowd.js';
import { paintCrest, paintLayers, settCanvas } from '../club-crest.js';
import { makeVertexStream } from './stream.js';
import { INK_VS, INK_FS } from './ink.js';
import { declareProgram, prewarmPrograms, takeWarm } from './programs.js';
import { createMirrorLayer, MIRROR_SCALE } from './mirror.js';
import { createRinkHeads, HEAD_VS, HEAD_FS, KEY } from './arena-heads.js';
import { buildXray } from './arena-xray.js';
import { createArenaKen, kenRig } from './arena-ken.js';

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
//
// THE COMIC LOOK (gl/house-style.js, docs/proposals/comic-ink.md) lights the men and what's on
// the ice through gl/cel-figure.js celKey, as the park lights its players: two bands over the
// painted shade, no rim, a line where the light steps and hatching in full shadow. uCel is set
// per draw (the building keeps its own light, as the park's stands do), and the branch is on a
// uniform for toonBands' fwidth. The hatching rides the man: an untextured vertex of his carries
// its place in his own frame, in feet, in its uv (arena-mesh.js hatchBody), and a sweater's uv
// already runs round his body, at uHatchUV feet a unit.
const LIT_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec4 vCol; in vec2 vUV; in float vTex;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform float uMourn;
uniform float uClipZ;
uniform float uCel; uniform vec3 uCelInk; uniform float uCelGap; uniform vec2 uHatchUV;
out vec4 outColor;
const vec3 L = vec3(${KEY.join(', ')});
${CEL_GLSL}
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
    if (uCel > 0.5) {
      rgb = celKey(rgb, n, v, L, 0.22, vec3(vTex > 0.5 ? vUV * uHatchUV : vUV, 0.0), uCelGap, uCelInk);
    } else {
      float diff = max(dot(n, L), 0.0);
      float hemi = 0.5 + 0.5 * n.z;
      float bounce = max(-n.z, 0.0) * 0.3;
      float spec = pow(max(dot(n, normalize(L + v)), 0.0), 32.0) * 0.22;
      float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.1;
      rgb = rgb * (0.3 + 0.24 * hemi + 0.6 * diff + bounce) + vec3(spec + rim);
    }
  }
  float g = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vec3(g), uMourn * 0.75) * (1.0 - 0.22 * uMourn);
  outColor = vec4(rgb * c.a, c.a);
}`;

// THE INK round the players is gl/ink.js's, shared with the kitchen.

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

// A negative alpha marks a soft point: a glow (the glowing puck's halo), added to what's
// under it and fading to nothing at its edge, and allowed to be bigger on screen.
const PT_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec4 aCol;
layout(location = 4) in float aSize;
uniform mat4 uVP;
uniform vec2 uShake;
uniform float uF;
out vec4 vCol;
out float vSoft;
void main() {
  vec4 p = uVP * vec4(aPos, 1.0);
  p.xy += uShake * p.w;
  gl_Position = p;
  vSoft = aCol.a < 0.0 ? 1.0 : 0.0;
  gl_PointSize = clamp(aSize * uF / max(p.w, 0.1), 1.0, vSoft > 0.5 ? 160.0 : 48.0);
  vCol = vec4(aCol.rgb, abs(aCol.a));
}`;
const PT_FS = `#version 300 es
precision mediump float;
in vec4 vCol;
in float vSoft;
uniform float uMourn;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  vec3 rgb = vCol.rgb;
  float g = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vec3(g), uMourn * 0.75);
  if (vSoft > 0.5) { float k = 1.0 - r2; outColor = vec4(rgb * vCol.a * k * k, 0.0); return; }
  outColor = vec4(rgb * vCol.a, vCol.a);
}`;

// One full-screen triangle over everything: the lamp behind the net, its red wash over
// the building, the vignette and a death's darkening, composited in that order.
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
uniform float uDim;
uniform float uVig;
uniform float uDark;
uniform float uShow;
uniform vec3 uSpots[4];
out vec4 outColor;
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 acc = vec4(0.0);
  // Cup night's house lights down: the building dark but for the spotlights, each a soft-edged
  // pool (xy its middle on the screen, z its radius in pixels), warm where it falls
  float lit = 0.0;
  for (int i = 0; i < 4; i++) { if (uSpots[i].z > 0.0) lit = max(lit, smoothstep(uSpots[i].z, uSpots[i].z * 0.55, length(p - uSpots[i].xy))); }
  if (uShow > 0.0) { acc = over(vec4(vec3(1.0, 0.9, 0.7) * 0.07 * lit * uShow, 0.0), acc); acc = over(vec4(0.0, 0.0, 0.0, uShow * (1.0 - lit)), acc); }
  // a goal's house lights down (rink/goal-lights.js), under the lamp so the lamp still burns
  acc = over(vec4(0.0, 0.0, 0.0, uDim), acc);
  if (uLamp.z > 0.0) { float l = max(0.0, 1.0 - length(p - uLamp.xy) / uLamp.z) * 0.95; acc = over(vec4(vec3(1.0, 0.24, 0.2) * l, l), acc); }
  acc = over(uWash, acc);
  float d = length(p - uRes * 0.5);
  float vg = smoothstep(uRes.y * 0.35, uRes.x * 0.62, d) * uVig;
  acc = over(vec4(0.0, 0.0, 0.0, vg), acc);
  acc = over(vec4(0.0, 0.0, 0.0, uDark), acc);
  outColor = acc;
}`;

// The comic look's outlines (gl/ssao.js ink's g channel) laid over the picture in the house ink.
const LINES_FS = `#version 300 es
precision mediump float;
uniform sampler2D uInk;
uniform vec2 uRes;
uniform vec3 uCol;
out vec4 outColor;
void main() {
  float a = texture(uInk, gl_FragCoord.xy / uRes).g;
  outColor = vec4(uCol * a, a);
}`;

declareProgram(LIT_VS, LIT_FS);
declareProgram(POST_VS, LINES_FS);
declareProgram(INK_VS, INK_FS);
declareProgram(RINK_CROWD_VS, RINK_CROWD_FS);
declareProgram(ICE_VS, ICE_FS);
declareProgram(PT_VS, PT_FS);
declareProgram(POST_VS, POST_FS);
declareProgram(HEAD_VS, HEAD_FS);

// The quality rungs the view's frame-time governor steps through (gameday-rink.js).
// (`crowd` is the share of the night's fans drawn: a device that can't keep up loses the upper
// rows and the far corners first, since the fans are in the order their seats sell)
// (`lines` is the comic look's screen-pass outlines, which draw the bowl, the fans and the men a
// second time into a depth of their own: the last rung gives them up, and the men keep their hull)
const ARENA_RUNGS = [
  { dpr: 1.5, mirror: MIRROR_SCALE, reflBodies: true, crowd: 1, lines: true },
  { dpr: 1.25, mirror: MIRROR_SCALE, reflBodies: true, crowd: 1, lines: true },
  { dpr: 1, mirror: 0.35, reflBodies: true, crowd: 0.7, lines: true },
  { dpr: 1, mirror: 0.35, reflBodies: false, crowd: 0.45, lines: false },
];

const LIT_ATTRS = [[0, 3, 0], [1, 3, 12], [2, 4, 24], [3, 2, 40], [4, 1, 48]];
const PT_STRIDE = 8;
const ATLAS = 1024, SLOT = 128, SLOTS = (ATLAS / SLOT) ** 2;
// The keepers' masks: their own texture, four cells of 512 x 256 (M.maskUV's flattening, so a
// texel is about the same size both ways at the eyes), mipmapped, since a mask is often small.
const MASK_W = 512, MASK_H = 256, MASK_COLS = 2, MASK_ROWS = 2;
const GPX = 16;                                   // glass decal texels per foot
const LIGHTS = [40, 70, 100, 130, 160].map((x) => [x, MID_Y - 4, 46]);

export function createArenaRenderer(canvas, overlay, W0, ice) {
  // the world it draws: the live one, or the replay's stand-in while a replay runs
  let W = W0, rcam = null;
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
    const INK = prog(INK_VS, INK_FS), FANS = prog(RINK_CROWD_VS, RINK_CROWD_FS), LINES = prog(POST_VS, LINES_FS);
    // The heads: the street figures' generator, drawn per body from a record arena-mesh.js leaves
    // in `headList` (gl/arena-heads.js). If its program won't build, the bodies keep the old
    // heads arena-mesh.js makes itself, rather than the whole arena going to 2-D.
    let heads = null;
    try { heads = createRinkHeads(gl, prog, doc); } catch (err) { console.warn('[rink] generator heads unavailable, drawing the old ones:', err && err.message); }
    const headList = [], headsTo = () => (heads ? headList : null);
    // Ken Raven at the Zamboni's wheel, as the close-up figure (gl/arena-ken.js); without it, the mesh's own driver
    let ken = null;
    try { ken = createArenaKen(gl); } catch (err) { console.warn('[rink] the close-up Ken is unavailable, drawing the old one:', err && err.message); }
    let kenOn = false;

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
    // the Zamboni's lettering: ICE CREW over Ken Raven's Cup final piece (M.ZAMBONI_LABEL)
    const texLabel = texture((() => {
      const Z = M.ZAMBONI_LABEL, c = cv(Z.w, Z.h), x = c.getContext('2d');
      x.fillStyle = '#1f4fbf'; x.font = `800 100px ${FACE}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('ICE CREW', Z.w / 2, 68, Z.w - 32);
      x.save(); x.translate(0, Z.crew); paintLivery(x); x.restore();
      return c;
    })(), { mip: true });
    const atlas = texture(null, { w: ATLAS, h: ATLAS });
    const slotCv = cv(SLOT, SLOT), sctx = slotCv.getContext('2d');
    const maskCv = cv(MASK_W, MASK_H), mctx = maskCv.getContext('2d');
    const maskTex = (() => {
      const t = gl.createTexture();
      gl.bindTexture(T2, t);
      gl.texImage2D(T2, 0, gl.RGBA, MASK_W * MASK_COLS, MASK_H * MASK_ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(T2, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // (cells sit on 256-texel lines, so no mip this deep mixes two masks)
      gl.texParameteri(T2, gl.TEXTURE_MAX_LEVEL, 7);
      return t;
    })();
    const glassCv = cv(PANELS * PANEL_W * GPX, (GLASS_H - BOARD_H) * GPX), gctx = glassCv.getContext('2d');
    const texGlass = texture(glassCv);

    // ── vertex layers ─────────────────────────────────────────────────────────
    const layer = (stride = M.STRIDE, attrs = LIT_ATTRS) => { const vao = gl.createVertexArray(); return { vao, st: makeVertexStream(gl, vao, stride, attrs), n: 0 }; };
    const put = (L, b) => { L.st.write(b.data, b.n * M.STRIDE); L.n = b.n; };
    const L = {
      stat: layer(), ads: layer(), glass: layer(),
      rows: layer(), dyn: layer(), jers: layer(), masks: layer(), label: layer(), tr: layer(), netm: layer(), gdec: layer(), shad: layer(),
      ice: layer(2, [[0, 2, 0]]), pts: layer(PT_STRIDE, [[0, 3, 0], [2, 4, 12], [4, 1, 28]]),
      bowl: [layer(), layer(), layer(), layer()],
      xglow: layer(), xsolid: layer(),
    };
    const postVao = gl.createVertexArray();
    {
      const q = new Float32Array([0, 0, RL, 0, RL, RW, 0, 0, RL, RW, 0, RW]);
      L.ice.st.write(q, q.length); L.ice.n = 6;
    }
    const B = Object.fromEntries(['stat', 'ads', 'glass', 'rows', 'dyn', 'jers', 'masks', 'label', 'tr', 'netm', 'gdec', 'shad'].map((k) => [k, M.createBatch(k === 'dyn' ? 1 << 16 : 1 << 12)]));
    let ptData = new Float32Array(PT_STRIDE * 1024);
    const spotBuf = new Float32Array(12);
    // the X-ray's two batches, filled only while one is on (gl/arena-xray.js)
    const XB = { glow: M.createBatch(1 << 13), solid: M.createBatch(1 << 15) };
    buildStatic();
    const mirror = createMirrorLayer(gl);

    let lost = false;
    canvas.addEventListener?.('webglcontextlost', (e) => { e.preventDefault(); lost = true; api.lost = true; });

    const camera = createRinkCamera(W);
    let frame = 0, hudShown = false, nHalo = 0;
    const st = { tris: 0, draws: 0, tiles: 0 };

    // ── the building, once ────────────────────────────────────────────────────
    function buildStatic() {
      const b = B.stat, white3 = M.rgb('#e8ecf0'), dark = M.rgb('#1e242c'), cap = M.rgb('#c3c9cf'), kick = M.rgb('#d9b032');
      const gl0 = [190 / 255, 222 / 255, 242 / 255, 0.09], seam = [1, 1, 1, 0.2], top = [220 / 255, 235 / 255, 245 / 255, 0.45];
      // (each end wall with its gate cut out of it: the doors are drawn each frame, buildDoors)
      const doorway = (sg) => {
        if (sg.kind !== 'end') return [sg];
        const lo = GATE_Y - GATE_HALF, hi = GATE_Y + GATE_HALF, up = sg.y1 > sg.y0, a = Math.min(sg.y0, sg.y1), b2 = Math.max(sg.y0, sg.y1);
        return [[a, Math.min(b2, lo)], [Math.max(a, hi), b2]].filter(([p, q]) => q - p > 0.01).map(([p, q]) => ({ ...sg, y0: up ? p : q, y1: up ? q : p }));
      };
      for (const sg of SEGS.flatMap(doorway)) {
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
      // THE BOWL: every row of seats round the sheet, a seat a place, in four layers by which
      // views draw them (gl/arena-crowd.js); its fans are drawn instanced in render(). They go
      // with the crowd, which the reflection leaves out.
      const BB = [0, 1, 2, 3].map(() => M.createBatch(1 << 15));
      buildBowl(M, BB);
      BB.forEach((bb, i) => put(L.bowl[i], bb));
      for (const k of ['stat', 'ads', 'glass']) put(L[k], B[k]);
    }

    // ── the jerseys, a slot each in one atlas, and the keepers' masks ─────────
    const slots = new Map();
    function atlasSlot(key, paint) {
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
        paint();
        gl.bindTexture(T2, atlas);
        gl.texSubImage2D(T2, 0, (i % 8) * SLOT, Math.floor(i / 8) * SLOT, gl.RGBA, gl.UNSIGNED_BYTE, slotCv);
      }
      s.used = frame;
      const e = 1.5 / ATLAS, u0 = (s.i % 8) / 8, v0 = Math.floor(s.i / 8) / 8;
      return [u0 + e, v0 + e, u0 + 1 / 8 - e, v0 + 1 / 8 - e];
    }
    function jerseySlot(o) {
      const K = o.kit;
      // (the look is in the key, so a flip to or from the comic look paints the sweater again)
      return atlasSlot([K.clubName || '', K.jersey, K.trim, K.stripes ? 1 : 0, K.crest || '', o.num ?? '', o.name || '', Math.round((o.blood || 0) * 4), o.goalie ? 1 : 0, comicOn() ? 'ink' : ''].join('|'), () => paintJersey(o));
    }
    // a keeper's mask: a cell of the mask texture, the least recently used given up for a new one
    const maskCells = new Map();
    function maskSlot(o) {
      const key = [o.kit.clubName || `${o.kit.jersey}${o.kit.trim}`, o.num ?? ''].join('|');
      let s = maskCells.get(key);
      if (!s) {
        let i = maskCells.size;
        if (i >= MASK_COLS * MASK_ROWS) {
          let oldK = null, oldS = null;
          for (const [k, v] of maskCells) if (!oldS || v.used < oldS.used) { oldK = k; oldS = v; }
          maskCells.delete(oldK); i = oldS.i;
        }
        s = { i, used: frame };
        maskCells.set(key, s);
        paintMask(o);
        gl.bindTexture(T2, maskTex);
        gl.texSubImage2D(T2, 0, (i % MASK_COLS) * MASK_W, Math.floor(i / MASK_COLS) * MASK_H, gl.RGBA, gl.UNSIGNED_BYTE, maskCv);
        gl.generateMipmap(T2);
      }
      s.used = frame;
      const TW = MASK_W * MASK_COLS, TH = MASK_H * MASK_ROWS, ex = 1.5 / TW, ey = 1.5 / TH;
      const u0 = ((s.i % MASK_COLS) * MASK_W) / TW, v0 = (Math.floor(s.i / MASK_COLS) * MASK_H) / TH;
      return [u0 + ex, v0 + ey, u0 + MASK_W / TW - ex, v0 + MASK_H / TH - ey];
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
      } else if (K.club) {
        paintClubJersey(o, vy);
      } else {
        c.fillStyle = K.trim; c.fillRect(0, vy(0.0) - 3, S, 6); c.fillRect(0, vy(0.1) - 1.5, S, 3);
        // the shoulder yoke, across the top of the sweater above the nameplate
        c.fillRect(0, vy(0.985) - 1.5, S, 3);
        // the crest on the chest
        const cx = S * 0.25, cy = vy(0.64);
        c.beginPath(); c.arc(cx, cy, 12, 0, TAU); c.fill();
        if (comicOn()) { c.lineWidth = 1.3; c.strokeStyle = INK; c.stroke(); }
        c.fillStyle = K.jersey; c.beginPath();
        if (K.crest === 'v') { c.moveTo(cx - 7.6, cy - 7.2); c.lineTo(cx, cy + 8.6); c.lineTo(cx + 7.6, cy - 7.2); c.lineTo(cx + 3.6, cy - 7.2); c.lineTo(cx, cy + 1.4); c.lineTo(cx - 3.6, cy - 7.2); }
        else if (K.crest === 'd') { c.moveTo(cx, cy - 9.4); c.lineTo(cx + 7.2, cy); c.lineTo(cx, cy + 9.4); c.lineTo(cx - 7.2, cy); }
        else c.arc(cx, cy, 5.8, 0, TAU);
        c.closePath(); c.fill();
        // a laced V at the collar
        c.fillStyle = K.trim; c.beginPath(); c.moveTo(cx - 6, 0); c.lineTo(cx, 11); c.lineTo(cx + 6, 0); c.closePath(); c.fill();
        backLettering(o, vy, K.trim, 'rgba(0,0,0,0.45)');
      }
      if (comicOn()) inkSweater(o, vy);
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

    // A keeper's mask, flattened the way M.maskUV flattens it: x once round his head from behind
    // his right ear through the face (half way) and his left side to behind his left ear; y from
    // the crown down to the chin cup's edge. The cut-out over the face is never seen, so paint
    // can run under it. A club's own art is content (`club.mask`, authored by
    // scripts/content/build-cphl-clubs.mjs in that flattening): its base colour, its layers and
    // where the number goes on the backplate. A club with no mask art gets plainMask.
    function paintMask(o) {
      const K = o.kit, club = K.club, m = club && club.mask, c = mctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (!m || !Array.isArray(m.layers)) { plainMask(o); return; }
      c.fillStyle = m.base || maskColours(K).base; c.fillRect(0, 0, MASK_W, MASK_H);
      const w = m.w || MASK_W, h = m.h || MASK_H;
      c.setTransform(MASK_W / w, 0, 0, MASK_H / h, 0, 0);
      paintLayers(c, m.layers, club, m.settUnit || 1);
      // his number, on the backplate (and again across the seam behind, where x wraps)
      const n = m.number, num = String(o.num ?? '');
      if (n && num) {
        const size = n.size || 26;
        c.font = `800 ${size}px ${FACE}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
        for (const dx of [0, -w, w]) {
          const x = n.at[0] + dx;
          if (x < -size * 2 || x > w + size * 2) continue;
          c.lineWidth = Math.max(2, size * 0.18); c.strokeStyle = n.edge || '#141414'; c.strokeText(num, x, n.at[1]);
          c.fillStyle = n.fill || '#ffffff'; c.fillText(num, x, n.at[1]);
        }
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    // The generic mask, for a club with no mask art: drawn in a 128 box stretched over the cell. The
    // colours are hud.js's maskColours: the shell in the first, a stripe over the crown and
    // blades swept back from the cage in the second, edged in the third; the backplate, his
    // number, the crest on each temple, the ear holes.
    function plainMask(o) {
      const K = o.kit, c = mctx, S = 128, club = K.club;
      c.setTransform(MASK_W / S, 0, 0, MASK_H / S, 0, 0);
      const at = (az, el) => { const [u, v] = M.maskUV(az, el); return [u * S, v * S]; };
      const { base, trim, edge } = maskColours(K);
      c.fillStyle = base; c.fillRect(0, 0, S, S);
      // the flashes: three blades a side, swept back from the cage and tapering to points
      // (base top and bottom on the cage's side, the point, and how far each edge bows up)
      const BLADES = [[0.56, 0.36, 0.12, 2.15, 0.62, 0.16], [0.6, 0.02, -0.22, 2.3, 0.08, 0.1], [0.5, -0.36, -0.62, 1.95, -0.5, 0.06]];
      for (const sd of [1, -1]) for (const [az0, e0, e1, az1, et, bow] of BLADES) {
        const [xa, ya] = at(sd * az0, e0), [xb, yb] = at(sd * az0, e1), [xt, yt] = at(sd * az1, et);
        const [xm, ym] = at(sd * (az0 + az1) / 2, (e0 + et) / 2 + bow), [xn, yn] = at(sd * (az0 * 0.4 + az1 * 0.6), (e1 + et) / 2 + bow * 0.4);
        c.beginPath(); c.moveTo(xa, ya); c.quadraticCurveTo(xm, ym, xt, yt); c.quadraticCurveTo(xn, yn, xb, yb); c.closePath();
        c.fillStyle = trim; c.fill();
        c.lineWidth = 1.6; c.lineJoin = 'miter'; c.strokeStyle = edge; c.stroke();
      }
      // the stripe over the crown: from the top of the cage up, and down the back to the plate
      const stripe = (x, y0, y1) => { c.fillStyle = edge; c.fillRect(x - 4.5, y0, 9, y1 - y0); c.fillStyle = trim; c.fillRect(x - 3, y0, 6, y1 - y0); };
      stripe(S / 2, 0, at(0, 0.2)[1]); stripe(0, 0, at(Math.PI, 0.5)[1]); stripe(S, 0, at(Math.PI, 0.5)[1]);
      // the backplate behind the seam, with the strap across it and his number
      const xs = at(-2.15, 0)[0], xe = at(2.15, 0)[0], ys = at(Math.PI, 0.5)[1];
      c.fillStyle = trim; c.fillRect(0, ys, xs, S - ys); c.fillRect(xe, ys, S - xe, S - ys);
      c.fillStyle = '#141414'; c.fillRect(xs - 1, 0, 2, S); c.fillRect(xe - 1, 0, 2, S);
      c.fillStyle = 'rgba(20,20,20,0.85)'; c.fillRect(0, at(0, -0.05)[1] - 2, xs, 4); c.fillRect(xe, at(0, -0.05)[1] - 2, S - xe, 4);
      const num = String(o.num ?? '');
      if (num) {
        c.font = `800 15px ${FACE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const x of [0, S]) { c.lineWidth = 3; c.strokeStyle = edge; c.strokeText(num, x, ys + 12); c.fillStyle = base; c.fillText(num, x, ys + 12); }
      }
      // the crest on each temple
      if (K.badge) for (const sd of [1, -1]) { const [x, y] = at(sd * 1.3, 0.92); paintCrest(c, club, x, y, 17, { small: true }); }
      // the ear holes
      c.fillStyle = 'rgba(16,16,18,0.9)';
      for (const sd of [1, -1]) { const [x, y] = at(sd * 1.72, -0.18); c.beginPath(); c.ellipse(x, y, 2.4, 3.6, 0, 0, TAU); c.fill(); }
      c.setTransform(1, 0, 0, 1, 0, 0);
    }

    // the number on the back, the name over it, mirrored (u runs right to left there); with the
    // comic look on, each outlined in ink outside its own edge first, as the park's numbers are
    function backLettering(o, vy, fill, edge) {
      const c = sctx, S = SLOT, ink = comicOn(), num = String(o.num ?? ''), name = String(o.name || '').toUpperCase(), ny = vy(0.9) - vy(0.58);
      c.save(); c.translate(S * 0.75, vy(0.58)); c.scale(-1, 1);
      c.font = `800 34px ${FACE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      if (ink) { c.lineJoin = 'round'; c.lineWidth = 7; c.strokeStyle = INK; c.strokeText(num, 0, 1, 40); }
      c.lineJoin = 'round'; c.lineWidth = 4; c.strokeStyle = edge; c.strokeText(num, 0, 1, 40);
      c.fillStyle = fill; c.fillText(num, 0, 1, 40);
      if (name) {
        c.font = `700 9px ${FACE}`;
        if (ink) { c.lineWidth = 3.8; c.strokeStyle = INK; c.strokeText(name, 0, ny, 38); c.strokeStyle = edge; }
        c.lineWidth = 2.4; c.strokeText(name, 0, ny, 38); c.fillText(name, 0, ny, 38);
      }
      c.restore();
    }
    // The comic look's ink over a sweater (comic-pen.js, the strokes the park's kits are inked
    // with, at this slot's scale): a quarter-strength painted shadow under the arms and above the
    // hem, the side seams and the collar ruled by hand, folds gathered under the arms and pulling up
    // off the hem. The sides are at u 0, a half and 1; the chest at a quarter, the back at three.
    function inkSweater(o, vy) {
      const c = sctx, S = SLOT, r = rng(hash(`${o.name || ''}#${o.num ?? ''}`) + 7), arm = vy(0.86), hem = vy(0.02);
      for (const x of [0, S / 2, S]) patch(c, x, arm, 18, 16, PAINTED);
      c.fillStyle = PAINTED + '0.22)'; c.fillRect(0, vy(0.1), S, hem - vy(0.1));
      for (const x of [1, S / 2, S - 1]) inkLine(c, r, x, 0, x + (r() - 0.5), hem, 1.4, 0.5);
      inkLine(c, r, 0, vy(1.02), S, vy(1.02), 1.3, 0.4);
      for (let i = 0; i < 10; i++) fold(c, r, r() * S, vy(0.04 + r() * 0.14), 8 + r() * 8, -Math.PI / 2 + (r() - 0.5) * 0.9, 0.9 + r() * 0.5);
      for (const x of [3, S / 2 - 3, S / 2 + 3, S - 3]) for (let i = 0; i < 2; i++) fold(c, r, x + (r() - 0.5) * 4, arm - 6 + r() * 10, 7 + r() * 5, Math.PI / 2 + (r() - 0.5), 0.8);
    }
    // A club's designed sweater (club-crest.js keeps the identity): the body, woven in
    // the club's sett if it has one, its own bands at the hem, the yoke, the club crest
    // on the chest and its own lettering. A band's pattern is 'gems' (a row of set
    // stones, the Warlords' stripe), 'sett' (a band of the tartan) or 'dice' (squares of
    // the band's colour and its `alt`, `rows` deep: the chequer on a police cap).
    const _setts = new WeakMap();
    function settFill(sett) {
      let p = _setts.get(sett);
      if (p === undefined) { const cv = settCanvas(sett, 0.18); p = cv ? sctx.createPattern(cv, 'repeat') : null; _setts.set(sett, p); }
      return p;
    }
    function paintClubJersey(o, vy) {
      const K = o.kit, c = sctx, S = SLOT, club = K.club;
      if (K.body === 'sett' && club.sett) { const p = settFill(club.sett); if (p) { c.fillStyle = p; c.fillRect(0, 0, S, S); } }
      // bands: `at` and `w` run from the hem (0) to the collar (1); the first band sits
      // on the hem itself, so it starts a little below 0
      const bandY = (b) => [vy(b.at + b.w - 0.04), vy(b.at - 0.04)];
      for (const b of K.hem || []) {
        const [y0, y1] = bandY(b), h = Math.max(1, y1 - y0);
        if (b.pattern === 'sett' && club.sett) { const p = settFill(club.sett); c.fillStyle = p || b.col; }
        else c.fillStyle = b.col;
        c.fillRect(0, y0, S, h);
        if (b.pattern === 'gems') gemRow(c, y0, h, club.gems || {});
        if (b.pattern === 'dice') diceRow(c, y0, h, b.alt || K.trim, b.rows || 2);
      }
      if (K.yoke) { c.fillStyle = K.yoke; c.fillRect(0, vy(0.99) - 2, S, 4.5); }
      // the laced V at the collar, in the yoke's colour
      const cx = S * 0.25, cy = vy(0.63);
      c.fillStyle = K.yoke || K.trim; c.beginPath(); c.moveTo(cx - 6, 0); c.lineTo(cx, 11); c.lineTo(cx + 6, 0); c.closePath(); c.fill();
      if (K.badge) paintCrest(c, club, cx, cy, 30, { small: true });
      backLettering(o, vy, K.number || K.trim, K.numberEdge || 'rgba(0,0,0,0.45)');
    }
    // a row of stones set in a band, edged above and below: the bezel of the Warlords'
    // crest, run round the sweater
    function gemRow(c, y0, h, g) {
      const S = SLOT, r = Math.max(1, h * 0.3), step = Math.max(4, h * 1.25), y = y0 + h / 2;
      c.fillStyle = g.edge || '#000'; c.fillRect(0, y0, S, Math.max(0.8, h * 0.1)); c.fillRect(0, y0 + h - Math.max(0.8, h * 0.1), S, Math.max(0.8, h * 0.1));
      for (let x = step / 2; x < S; x += step) {
        c.fillStyle = g.edge || '#000'; c.beginPath(); c.arc(x, y, r + 0.7, 0, TAU); c.fill();
        c.fillStyle = g.gem || '#fff'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        c.fillStyle = 'rgba(150,200,235,0.9)'; c.beginPath(); c.arc(x + r * 0.15, y + r * 0.15, r * 0.45, 0, TAU); c.fill();
      }
    }

    // squares of `alt` over a band, `rows` deep, sized so a whole number of pairs runs
    // round the body and the seam at the back doesn't show
    function diceRow(c, y0, h, alt, rows) {
      const S = SLOT, n = Math.max(1, rows | 0), ch = h / n, pairs = Math.max(1, Math.round(S / (2 * ch))), cw = S / (2 * pairs);
      c.fillStyle = alt;
      for (let r = 0; r < n; r++) for (let x = (r % 2) * cw; x < S; x += 2 * cw) c.fillRect(x, y0 + r * ch, cw, ch);
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
    let propsN = 0, doorsN = 0;
    function buildFrame(P, eye) {
      for (const k of ['rows', 'dyn', 'jers', 'masks', 'label', 'tr', 'netm', 'gdec', 'shad']) M.reset(B[k]);
      headList.length = 0;
      const d = B.dyn;
      // the props the ice reflects whatever the quality: the gates' doors first, which are the
      // building's and keep its light under the comic look (doorsN), then the nets and the Zamboni
      M.buildDoors(d, B.tr, W.doors, GATE_Y, GATE_HALF, RL, BOARD_H, GLASS_H);
      doorsN = d.n;
      for (const [gx, dir, side] of [[GOAL_X[0], -1, 'a'], [GOAL_X[1], 1, 'h']]) {
        // (a net the ice crew have off its pegs is drawn where they have it, and not once it's out the gate)
        const o = W.nets && W.nets[side];
        if (!(o && o.out)) M.buildNet(d, B.netm, gx + (o ? o.dx : 0), dir, MID_Y + (o ? o.dy : 0), NET_HALF, NET_DEPTH, NET_H, (W.netBulge[side] || 0) * 0.7);
      }
      kenOn = false;
      if (W.zamboni) {
        try { kenOn = !!(ken && ken.pose(W.zamboni, W.t)); } catch (err) { console.warn('[rink] Ken:', err && err.message); ken = null; }
        M.buildZamboni(d, B.label, W.zamboni, W.t, !!W0.cup, kenOn ? kenRig() : null);
        if (kenOn) { ken.glasses(d, null, M.tube, M.rgb); ken.scarf(d, M.quad, M.tube, M.rgb); }
      }
      propsN = d.n;
      // the men (and, with the comic look on, where each vertex of theirs is on him, for the hatching)
      const comic = comicOn();
      for (const b of W.bodies()) {
        const o = bodyOpts(W, b);
        if (!o.kit) continue;
        const J = drawnJoints(W, b), hp = J[3] && P(J[3][0], J[3][1], J[3][2]);
        // close up (a fight, the winner's head and shoulders) a body gets the third level
        o.detail = !hp ? 0 : hp.s > 64 ? 2 : hp.s > 24 ? 1 : 0;
        // the head's level by its size on screen: a head is about 0.9 ft, so L0 from about 32 px
        o.heads = headsTo(); o.headLv = !hp ? 2 : hp.s > 36 ? 0 : hp.s > 9 ? 1 : 2;
        o.slot = jerseySlot(o);
        if (o.goalie) { o.maskSlot = maskSlot(o); o.maskBatch = B.masks; }
        const n0 = d.n;
        M.buildBody(d, B.jers, J, o);
        if (comic) M.hatchBody(d, n0, J);
        M.buildVisor(B.tr, o);
        const p = drawnAt(W, b);
        shadow(p[0], p[1], b.rag ? 2.6 : b.kind === 'goalie' ? 1.7 : 1.3);
      }
      if (!W.puck.hidden) { const pp = drawnPuck(W); M.buildPuck(d, { x: pp[0], y: pp[1], z: pp[2] }); shadow(pp[0], pp[1], 0.35); tail(eye, pp); }
      for (const x of W.debris) M.buildDebris(d, x, W.kits[x.side] || W.kits.a);
      for (const l of W.limbs) { const o = bodyOpts(W, l.owner || { side: l.side }); if (o.kit) { o.heads = headsTo(); if (o.goalie) { o.maskSlot = maskSlot(o); o.maskBatch = B.masks; } M.buildSevered(d, l, o, B.jers); } }
      if (W.stretcher) M.buildStretcher(d, W.stretcher);
      // the Coldwater Cup, carried out and lifted on Cup night (rink/director.js stageCrown)
      if (W.trophy) { M.buildCup(d, W.trophy); if (W.trophy.z < 1) shadow(W.trophy.x, W.trophy.y, 0.9); }
      if (W.zamboni) shadow(W.zamboni.x, W.zamboni.y, 6.5);
      farGlass();
      return particles();
    }
    // The light tail behind a shot: a faint slate streak (the ice is white, so a white tail
    // vanishes on it) through the puck's last fifth of a second, nothing at the old end,
    // strongest at the puck, and strongest of all on a snap shot. With the glowing puck on,
    // its comet tail instead (hud.js), lifted clear of the ice by its own half width.
    function tail(eye, pp) {
      const gt = api.glow ? glowTail(W) : null;
      if (gt) {
        const lift = (q) => [q[0], q[1], q[2] + 0.22];
        M.ribbon(B.tr, gt.pts.map(lift), eye, 0.06, 0.44, [...gt.col, 0], [...gt.col, 0.85]);
        return;
      }
      const T = W.puck.tail;
      if (!T || T.pts.length < 2 || !(T.fade > 0)) return;
      const pts = [...T.pts, [pp[0], pp[1], pp[2] + 0.06]], a = 0.5 * T.k * T.fade;
      M.ribbon(B.tr, pts, eye, 0.04, 0.26 + 0.2 * T.k, [0.3, 0.4, 0.55, 0], [0.24, 0.33, 0.47, a]);
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
      const need = (W.parts.length + (W.spray ? W.spray.length : 0) + 8) * PT_STRIDE;
      if (ptData.length < need) ptData = new Float32Array(need * 2);
      let n = 0;
      const pt = (x, y, z, c, s) => { const o = n * PT_STRIDE; ptData[o] = x; ptData[o + 1] = y; ptData[o + 2] = z; ptData[o + 3] = c[0]; ptData[o + 4] = c[1]; ptData[o + 5] = c[2]; ptData[o + 6] = c[3]; ptData[o + 7] = s; n++; };
      for (const p of W.parts) {
        if (p.type === 'blood') pt(p.x, p.y, p.z, M.rgb(p.col), p.size * 1.6);
        // the Cup's confetti: each piece turning over as it falls, so it flickers between its
        // face and its edge
        else if (p.type === 'confetti') pt(p.x, p.y, p.z, M.rgb(p.col), p.size * (0.45 + 0.55 * Math.abs(Math.sin(p.life * p.spin + p.seed))));
        else pt(p.x, p.y, p.z, PCOL[p.type] || PCOL.shard, p.size * 2);
      }
      if (W.spray) for (const p of W.spray) pt(p.x, p.y, p.z, PCOL.spray, p.size * 2);
      // a few phones going off in the stands when the building is up
      if (W.crowd > 0.5 && W.mourning < 0.2) for (let i = 0; i < 6; i++) { if (Math.random() > W.crowd * 0.5) continue; pt(CX0 + Math.random() * (CX1 - CX0), 89 + Math.random() * 40, 6 + Math.random() * 30, [1, 1, 1, 0.9], 0.3 + Math.random() * 0.3); }
      // the glowing puck's halo goes last: it's drawn over whatever is in front of the puck,
      // the way the broadcast's glow was
      nHalo = 0;
      if (api.glow && !W.puck.hidden) { const pp = drawnPuck(W); pt(pp[0], pp[1], pp[2] + 0.1, [...GLOW.halo, -0.95], 2.6); nHalo = 1; }
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
      fl = figureLightOf({ bands: CEL.bands, shade: CEL.shade });
      gl.uniform1f(LIT.u('uCelBands'), fl.bands); gl.uniform3fv(LIT.u('uCelShade'), fl.shade); gl.uniform1f(LIT.u('uCelComic'), fl.comic);
      gl.uniform3fv(LIT.u('uCelInk'), HOUSE.ink); gl.uniform1f(LIT.u('uCelGap'), HOUSE.hatchFt);
      celFor(false);
    }
    // The comic look on what's drawn next (LIT_FS uCel): on for the men and what's on the ice, off for
    // the building. `hatch` is a sweater's feet per uv unit: once round the body across an atlas slot
    // (8 to the atlas) about 6 ft, the collar to the hem about 2.6 ft, which runs down the slot.
    let fl = null;
    const SWEATER_FT = [8 * 6, -8 * 2.6];
    function celFor(on, hatch = null) {
      gl.uniform1f(LIT.u('uCel'), on && fl.comic ? 1 : 0);
      gl.uniform2fv(LIT.u('uHatchUV'), hatch || [0, 0]);
    }
    // the men, their sweaters and the keepers' masks, and what's on the ice, lit as figures
    function drawFigures() {
      draw(L.dyn, null, 0, doorsN);
      celFor(true); draw(L.dyn, null, doorsN);
      celFor(true, SWEATER_FT); draw(L.jers, atlas);
      celFor(true); draw(L.masks, maskTex);
      celFor(false);
    }
    // ── the fans (gl/arena-crowd.js) ──────────────────────────────────────────
    // One figure in three poses, instanced a seat; the seats' instance data rebuilt only when the
    // clubs' colours change. As many are drawn as the night's gate and the quality rung allow.
    const fanMorph = crowdMorph({ far: true, towels: false }), FAN_V = fanMorph.length / CROWD_MORPH;
    const fanVao = gl.createVertexArray(), fanMb = gl.createBuffer(), fanIb = gl.createBuffer();
    gl.bindVertexArray(fanVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, fanMb); gl.bufferData(gl.ARRAY_BUFFER, fanMorph, gl.STATIC_DRAW);
    for (const [loc, size, off] of [[0, 3, 0], [1, 3, 12], [2, 3, 24], [6, 3, 36], [7, 3, 48], [8, 3, 60], [9, 1, 72]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, CROWD_MORPH * 4, off); }
    gl.bindBuffer(gl.ARRAY_BUFFER, fanIb);
    for (const [loc, size, off] of [[3, 4, 0], [4, 4, 16], [5, 3, 32]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, CROWD_INST * 4, off); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    let fanKey = null, fanGroups = null;
    function drawFans(vp, shake, view, eye) {
      const K = W0.kits || {}, key = [K.a?.jersey, K.a?.trim, K.h?.jersey, K.h?.trim].join('|');
      if (key !== fanKey) { fanKey = key; const fi = crowdInstances(K); fanGroups = fi; gl.bindBuffer(gl.ARRAY_BUFFER, fanIb); gl.bufferData(gl.ARRAY_BUFFER, fi.data, gl.STATIC_DRAW); }
      const share = clamp(W0.gate ?? 0.7, 0, 1) * clamp(api.quality.crowd ?? 1, 0, 1);
      if (share <= 0) return;
      const roar = roarOf(W);
      gl.useProgram(FANS.p);
      gl.uniformMatrix4fv(FANS.u('uVP'), false, vp); gl.uniform2fv(FANS.u('uShake'), shake);
      gl.uniform2f(FANS.u('uRoar'), roar[0], roar[1]); gl.uniform1f(FANS.u('uT'), W.t || 0); gl.uniform1f(FANS.u('uMove'), 1);
      gl.uniform4fv(FANS.u('uHide'), hideFor(view));
      gl.uniform4f(FANS.u('uNear'), eye[0], eye[1], eye[2] - nearDrop(view), nearR(view));
      gl.uniform1f(FANS.u('uDim'), 0.62); gl.uniform1f(FANS.u('uMourn'), W.mourning || 0);
      // (each group the view shows, from its first seat, its own instance attributes moved on to it)
      const ring = seesRing(view);
      gl.bindVertexArray(fanVao); gl.bindBuffer(gl.ARRAY_BUFFER, fanIb);
      for (let i = 0; i < 4; i++) {
        if ((i & 1) && !ring) continue;
        const n = Math.round(fanGroups.count[i] * share), base = fanGroups.start[i] * CROWD_INST * 4;
        if (n <= 0) continue;
        for (const [loc, size, off] of [[3, 4, 0], [4, 4, 16], [5, 3, 32]]) gl.vertexAttribPointer(loc, size, gl.FLOAT, false, CROWD_INST * 4, base + off);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, FAN_V, n);
        st.draws++; st.tris += FAN_V / 3 * n;
      }
    }
    // ── the ink round the players ─────────────────────────────────────────────
    const INK_COL = [0.035, 0.04, 0.05], INK_BACK = 0.3;
    function drawInk(vp, proj, shake, w, h, u) {
      gl.useProgram(INK.p);
      gl.uniformMatrix4fv(INK.u('uVP'), false, vp); gl.uniform2fv(INK.u('uShake'), shake);
      gl.uniform2f(INK.u('uRes'), w, h);
      // one even width: comic mode's line matches the cel line here, unweighted
      gl.uniform3fv(INK.u('uKey'), KEY);
      gl.uniform1f(INK.u('uWeigh'), 1);
      // 0.09 ft of the man, between 1.2 and 3.6 px of a 900-wide picture; the house style's line
      // in either look (gl/house-style.js gives the comic look its colour)
      const own = { ft: 0.09, px: [1.2, 3.6], col: INK_COL }, ink = inkOf(own);
      gl.uniform3fv(INK.u('uCol'), ink.col);
      const pass = (ft, px, depth, back) => {
        gl.uniform4f(INK.u('uInk'), ft, px[0] * u, px[1] * u, depth);
        gl.uniform2f(INK.u('uBack'), -proj[14], back);
        for (const [Ly, first] of [[L.dyn, propsN], [L.jers, 0], [L.masks, 0]]) {
          if (Ly.n - first <= 0) continue;
          gl.bindVertexArray(Ly.vao); gl.drawArrays(gl.TRIANGLES, first, Ly.n - first);
          st.draws++; st.tris += (Ly.n - first) / 3;
        }
      };
      // The comic look takes only the house ink here, never the house width: that read as a slab.
      // The line goes a few inches behind the man (gl/ink.js): an arm keeps its line across his body.
      pass(own.ft, own.px, 0, INK_BACK);
    }
    // ── the comic look's outlines ─────────────────────────────────────────────
    // The park lines its picture off the depth it already keeps (gl/ssao.js createDepthSSAO ink,
    // docs/proposals/comic-ink.md step 4). The rink draws straight to the canvas, whose depth can't
    // be read, so what wants a line is drawn again into a depth of its own: the bowl and its fans,
    // the boards, the men and what's on the ice. The ice and the glass stay out, so a man is lined
    // against the sheet and so are the boards. Outlines only, as in the park: the detail channel
    // reads every row of seats as a crease. The depth and its pass are made the first time the
    // look asks for them; a device that can't make them gets no lines and nothing else changes.
    let lineDepth = null, lineSsao;
    function lineTarget(w, h) {
      if (lineDepth && lineDepth.w === w && lineDepth.h === h) return lineDepth;
      if (lineDepth) { gl.deleteFramebuffer(lineDepth.fbo); gl.deleteTexture(lineDepth.tex); lineDepth = null; }
      const tex = gl.createTexture();
      gl.bindTexture(T2, tex);
      gl.texStorage2D(T2, 1, gl.DEPTH_COMPONENT24, w, h);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(T2, k, v);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, T2, tex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return null; }
      return (lineDepth = { tex, fbo, w, h });
    }
    // The lines for this frame, or null. rink/camera.js's projection puts the depth in w, so its
    // constants aren't ssaoConstants' (a GL perspective's): ndc z is P[10] + P[14] / depth, and
    // the camera's offset centre (P[9]) is the line's cy0.
    function lines(ri, proj, vp, eye, shake, shown, w, h) {
      if (lineSsao === undefined) lineSsao = createDepthSSAO(gl);
      const D = lineSsao && lineTarget(w, h);
      if (!D) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, D.fbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      useLit(vp, eye, shake, -1e9);
      const ring = seesRing(shown);
      for (let i = 0; i < 4; i++) if (!((i & 1) && !ring)) draw(L.bowl[i]);
      drawFans(vp, shake, shown, eye);
      useLit(vp, eye, shake, -1e9);
      draw(L.stat); draw(L.ads, texAds); draw(L.dyn); draw(L.jers, atlas); draw(L.masks, maskTex);
      if (heads) heads.draw(headList, vp, eye, shake, -1e9, 0, st);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return lineSsao.ink(D.tex, w, h, { fxn: proj[0], fyn: proj[5], cy0: proj[9], A: proj[10], B: proj[14] }, { step: ri.step });
    }
    function draw(Ly, tex, first = 0, count = Ly.n - first) {
      if (count <= 0) return;
      gl.bindVertexArray(Ly.vao);
      gl.bindTexture(T2, tex || white);
      gl.drawArrays(gl.TRIANGLES, first, count);
      st.draws++; st.tris += count / 3;
    }
    // ── the X-ray ─────────────────────────────────────────────────────────────
    // Over the finished picture: the building darkened and blued by the X-ray's strength, the
    // depth cleared, then his bones (and, at full gore, his insides) lit and depth-tested, and
    // last his flesh and the flash at the break added on top as light.
    function drawXray(xr, vp, eye, shake, w, h) {
      M.reset(XB.glow); M.reset(XB.solid);
      if (!buildXray(XB, W, xr, api.xrayGore)) return;
      put(L.xglow, XB.glow); put(L.xsolid, XB.solid);
      const k = xr.k, a = 0.86 * k;
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(POST.p);
      gl.uniform2f(POST.u('uRes'), w, h);
      gl.uniform4f(POST.u('uWash'), 0.012 * a, 0.05 * a, 0.075 * a, a);
      gl.uniform3fv(POST.u('uLamp'), [0, 0, 0]);
      gl.uniform1f(POST.u('uVig'), 0.6 * k);
      gl.uniform1f(POST.u('uDark'), 0);
      gl.uniform1f(POST.u('uShow'), 0);
      gl.bindVertexArray(postVao); gl.drawArrays(gl.TRIANGLES, 0, 3); st.draws++;
      gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      useLit(vp, eye, shake, -1e9);
      gl.uniform1f(LIT.u('uMourn'), 0);
      draw(L.xsolid);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.blendFunc(gl.ONE, gl.ONE);
      draw(L.xglow);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    }
    const reflStrength = () => clamp(0.3 - 0.2 * ice.wear + 0.14 * ice.wetness, 0.08, 0.42) * (1 - 0.35 * (W.mourning || 0));

    function render(now) {
      if (lost) return;
      frame++;
      const { w, h, u } = fit();
      const rp = W0.replay && W0.replay.active ? W0.replay : null;
      W = rp ? rp.frame() : W0;
      camera.view = api.view; camera.seat = api.seat || null;
      // the live camera keeps following the play under a replay, so it's on it when it ends
      const live = camera.update(w, h, now);
      // (what the live picture shows, for the director: a hit it misses is replayed later)
      W0.view = { P: live.P, w, h, t: W0.t };
      const { C, P } = rp ? (rcam ??= createRinkCamera(rp.source, { snap: true })).update(w, h, now) : live;
      api.lastP = P;
      const sh = W.shake * 5 * u, sx = sh * (Math.sin(W.t * 47) + 0.5 * Math.sin(W.t * 83 + 1)) / 1.5, sy = sh * (Math.sin(W.t * 59 + 2) + 0.5 * Math.sin(W.t * 97)) / 1.5;
      const shake = [2 * sx / w, -2 * sy / h];
      st.draws = 0; st.tris = 0;

      const nPts = buildFrame(P, [C.x, C.y, C.z]);
      for (const k of ['rows', 'dyn', 'jers', 'masks', 'label', 'tr', 'netm', 'gdec', 'shad']) put(L[k], B[k]);
      L.pts.st.write(ptData, nPts * PT_STRIDE); L.pts.n = nPts;
      uploadIce();

      gl.disable(gl.CULL_FACE);
      // the reflection: everything that stands on the ice, through a camera flipped under it
      const MR = matrices(C, true), eyeR = [C.x, C.y, -C.z];
      const hasMir = mirror.bind(w, h, api.quality.mirror);
      if (hasMir) {
        const vpR = new Float32Array(MR.viewProj);
        useLit(vpR, eyeR, shake, -0.05);
        gl.depthMask(true);
        // the boards and their ads; not the crowd, which is dim against a lit sheet
        draw(L.stat); draw(L.ads, texAds);
        if (api.quality.reflBodies) drawFigures(); else { draw(L.dyn, null, 0, doorsN); celFor(true); draw(L.dyn, null, doorsN, propsN - doorsN); }
        celFor(true); draw(L.label, texLabel); celFor(false);
        if (heads && api.quality.reflBodies) heads.draw(headList, vpR, eyeR, shake, -0.05, W.mourning, st);
        mirror.release();
      }

      // the picture
      const M0 = matrices(C), vp = new Float32Array(M0.viewProj), eye = [C.x, C.y, C.z];
      // (by the view the camera is in, which a fight swings to broadcast: camera.js `shown`; a
      // seat in the stands is in the bowl, and sees all of it)
      const shown = rp ? 'broadcast' : api.seat ? 'seat' : camera.shown || api.view, ring = seesRing(shown);
      // the comic look's outlines, off a depth of their own, laid over the picture after the ice
      const rInk = api.quality.lines !== false ? rinkInkOf(w) : null;
      const inkTex = rInk ? lines(rInk, M0.proj, vp, eye, shake, shown, w, h) : null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.025, 0.033, 0.045, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      useLit(vp, eye, shake, -1e9);
      // the bowl, less the stands this view's camera stands in, and the fans in it
      for (let i = 0; i < 4; i++) if (!((i & 1) && !ring)) draw(L.bowl[i]);
      drawFans(vp, shake, shown, eye);
      if (api.ink) { drawInk(vp, M0.proj, shake, w, h, u); }
      useLit(vp, eye, shake, -1e9);
      draw(L.stat); draw(L.ads, texAds);
      drawFigures();
      if (kenOn) { ken.draw(vp, eye, w, h); useLit(vp, eye, shake, -1e9); }
      celFor(true); draw(L.label, texLabel); celFor(false);
      if (heads) heads.draw(headList, vp, eye, shake, -1e9, W.mourning, st);

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
      if (inkTex) {
        // the lines over everything solid, under the glass, the nets and the spray
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(LINES.p);
        gl.uniform2f(LINES.u('uRes'), w, h); gl.uniform3fv(LINES.u('uCol'), rInk.col); gl.uniform1i(LINES.u('uInk'), 0);
        gl.bindTexture(T2, inkTex);
        gl.bindVertexArray(postVao); gl.drawArrays(gl.TRIANGLES, 0, 3); st.draws++;
        gl.enable(gl.DEPTH_TEST);
      }

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
        gl.bindVertexArray(L.pts.vao); gl.drawArrays(gl.POINTS, 0, nPts - nHalo); st.draws++;
        if (nHalo) { gl.disable(gl.DEPTH_TEST); gl.drawArrays(gl.POINTS, nPts - nHalo, nHalo); gl.enable(gl.DEPTH_TEST); st.draws++; }
      }

      // a grave hit's replay, seen through the man (gl/arena-xray.js)
      const xr = W.xray && W.xray.k > 0.002 && api.xrayGore !== 'off' ? W.xray : null;
      if (xr) drawXray(xr, vp, eye, shake, w, h);

      // the light over the top of it all
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(POST.p);
      gl.uniform2f(POST.u('uRes'), w, h);
      // a goal: the house lights down and the red lamp strobing (rink/goal-lights.js)
      const lights = goalLights(W), lampOn = lights.wash > 0;
      const k = lights.wash;
      gl.uniform4f(POST.u('uWash'), k, 30 / 255 * k, 40 / 255 * k, k);
      gl.uniform1f(POST.u('uDim'), 0.42 * lights.dim);
      let lamp = [0, 0, 0];
      if (lampOn) {
        const gx = W.lampSide === 'a' ? GOAL_X[0] : GOAL_X[1], dir = W.lampSide === 'a' ? -1 : 1;
        const l = P(gx + dir * (NET_DEPTH + 6), MID_Y, GLASS_H + 1);
        if (l) lamp = [l.x + sx, h - (l.y + sy), (lights.on ? 5 : 1.5) * l.s];
      }
      gl.uniform3fv(POST.u('uLamp'), lamp);
      gl.uniform1f(POST.u('uVig'), 0.42 + 0.3 * (W.mourning || 0));
      gl.uniform1f(POST.u('uDark'), 0.22 * (W.mourning || 0));
      // the spotlights, at chest height on the man they're on (rink/director.js W.show)
      const show = W.show && W.show.dark > 0.002 ? W.show : null;
      gl.uniform1f(POST.u('uShow'), show ? show.dark : 0);
      spotBuf.fill(0);
      if (show) (show.spots || []).slice(0, 4).forEach((s, i) => {
        const q = P(s.x, s.y, s.z ?? 3);
        if (q) { spotBuf[i * 3] = q.x + sx; spotBuf[i * 3 + 1] = h - (q.y + sy); spotBuf[i * 3 + 2] = clamp(s.r * q.s, 8, h * 0.2); }
      });
      gl.uniform3fv(POST.u('uSpots[0]'), spotBuf);
      gl.bindVertexArray(postVao); gl.drawArrays(gl.TRIANGLES, 0, 3); st.draws++;
      gl.bindVertexArray(null);
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);

      // the HUD, in 2-D over the top, and only while there's any
      if (overlay) {
        const on = hudActive(W, W0);
        if (on || hudShown) {
          const o = overlay.getContext('2d');
          o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h);
          if (on) drawHud(o, W, w, h, u, W0);
          hudShown = on;
        }
      }
    }

    // A view that's done gives its context back: a browser keeps about sixteen, and past that it
    // kills the oldest, which may be the room's or the windshield's.
    const dispose = () => { lost = true; api.lost = true; gl.getExtension('WEBGL_lose_context')?.loseContext(); };
    const api = { render, dispose, stats: st, cam: camera.cam, view: 'broadcast', glow: false, ink: true, xrayGore: 'full', kind: 'gl', lost: false, rungs: ARENA_RUNGS, quality: { ...ARENA_RUNGS[0] },
      // the reflection buffer, for a bench that wants to know it isn't empty
      mirrorPeak: () => mirror.peak() };
    return api;
  }
}
