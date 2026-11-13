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
import { BEAST_VS, BEAST_FS, HALO_VS, HALO_FS } from './beast-light.js';
import { SHUTTER_GLSL, setShutterUniforms, shutterWinC } from './room-shutters.js';
import { createRoomDof, roomDofOn } from './room-dof.js';
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
uniform int uMode;          // 0 plain, 1 textured, 2 a picture (a screen), 3 glass, 4 the view out, 5 the city, 6 paint on a wall
uniform vec2 uPanoLens;     // the city's paints: their projection scales, x and y
uniform float uPanoTilt;    // the down and up faces' pitch (room-outlook.js TILT)
out vec4 outColor;
${ROOM_LIGHT_GLSL}
uniform float uLampDim;      // how far down the dimmer has a lamp's own face
// A stage's glows (setGlows): up to eight coloured points that light what's round them, a flame on a bench or
// a reaction's light. xyz is where, w how far it reaches; none in an ordinary room, so the loop never runs.
uniform vec4 uStageGlowP[8];
uniform vec3 uStageGlowC[8];
uniform int uStageGlowN;
// The room seen from its chrome (bakeProbe): a cube of the room, display-ready, from uProbeP, looked up box-projected
// onto the room's bounds so a reflection stays put on the wall it's of. uProbeOn is 0 in the bake itself and in a
// room with no chrome, and the chrome falls back to its painted room.
uniform samplerCube uProbe;
uniform int uProbeOn;
uniform vec3 uProbeP;
uniform vec3 uProbeMin;
uniform vec3 uProbeMax;
// A direction as east and north.
vec2 compass(vec3 d) {
  float fw = dot(d, uFront), rt = dot(d, uRight), s = sin(uBearing), c = cos(uBearing);
  return vec2(s * fw + c * rt, c * fw - s * rt);
}
${ROOM_SKY_GLSL}
${SHUTTER_GLSL}
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
  // a tag on the plaster (setDecals): the bake's own alpha is the paint's edge, lit like the wall it's on
  float paintA = 1.0;
  if (uMode == 6) {
    vec4 t = texture(uTex, vUv);
    if (t.a < 0.02) discard;
    base *= t.rgb;
    paintA = t.a;
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
  for (int g = 0; g < 8; g++) {
    if (g >= uStageGlowN) break;
    vec3 L = uStageGlowP[g].xyz - vPos; float dl = max(length(L), 1e-4), r = uStageGlowP[g].w;
    float fall = clamp(1.0 - dl / r, 0.0, 1.0); fall *= fall;
    vec3 Ld = L / dl;
    diff += uStageGlowC[g] * fall * max(0.0, dot(n, Ld) * 0.8 + 0.2);
    spec += uStageGlowC[g] * fall * pow(max(dot(n, normalize(Ld + v)), 0.0), 40.0) * 0.5;
  }
  // a liquid (material 44, a stage's props glass): its own colour, lit, and see-through, more so face on
  if (uMode == 3 && vMat == 44.0) {
    float fr = fresnelOf(n, v);
    outColor = vec4(finish(base * (uAmb * 1.4 + diff * 0.85) + spec * 1.3 + base * 0.08), 0.62 + 0.3 * fr);
    return;
  }
  if (uMode == 3) {
    // the shutters down over a pane, dark or showing a scene (gl/room-shutters.js)
    vec4 sh = shutterAt(diff, spec, fresnelOf(n, v));
    if (sh.a > 0.0) { outColor = sh; return; }
    // a doorway's shutter line (uv from 300) is nothing with the shutters up
    if (vUv.x > 250.0) discard;
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
  // chrome (material 45): a mirror of the room by the reflected ray, a dark floor, the walls, a bright band of
  // ceiling light, tinted by the room's own light and the lamps' highlights, and stronger at a grazing angle
  if (vMat == 45.0) {
    vec3 rf = reflect(-v, n);
    if (uProbeOn == 1) {
      vec3 sr = sign(rf) * max(abs(rf), vec3(1e-4));
      vec3 fa = max((uProbeMax - vPos) / sr, (uProbeMin - vPos) / sr);
      float dd = max(0.0, min(min(fa.x, fa.y), fa.z));
      vec3 dir = vPos + rf * dd - uProbeP;
      // steel, not a mirror: the room comes off the blurred mips, half its colour taken out by the metal's own
      // grey; a brushed (textured) face blurs it further. The bake's flat vignette is taken back out
      vec3 envD = textureLod(uProbe, dir, uMode == 1 ? 2.8 : 1.7).rgb / 0.744;
      vec3 envL = pow(clamp(envD, 0.0, 1.4), vec3(2.2));
      envL = mix(vec3(dot(envL, vec3(0.333))), envL, 0.5);
      float fr = fresnelOf(n, v);
      // a faint grain along the face, so a flat panel reads as worked metal, not glass
      float grain = 0.94 + 0.06 * sin(dot(vPos, vec3(173.0, 61.0, 191.0)));
      vec3 metal = envL * base * mix(0.48, 0.85, fr) * grain + envL * fr * 0.12 + (uAmb + diff) * base * 0.3;
      if (uMode == 1) metal = metal * 0.85 + base * (uAmb + diff) * 0.08;
      outColor = vec4(finish(metal + spec * 1.1), 1.0);
      return;
    }
    float up = rf.y;
    // the floor, warm and dim; a hard bright horizon where the walls and windows are; the walls; the ceiling's light
    vec3 env = mix(vec3(0.16, 0.12, 0.08), vec3(0.05, 0.05, 0.055), smoothstep(-0.25, -0.03, up));
    env = mix(env, vec3(1.05, 1.08, 1.12), smoothstep(-0.03, 0.0, up) * (1.0 - smoothstep(0.1, 0.2, up)));
    env = mix(env, vec3(0.42, 0.43, 0.45), smoothstep(0.12, 0.22, up));
    env += vec3(1.3, 1.32, 1.35) * smoothstep(0.7, 0.85, up) * (1.0 - smoothstep(0.95, 1.0, up));
    // a few vertical streaks of the room's things going by, so a flat panel isn't one flat tone
    env *= 0.8 + 0.35 * smoothstep(0.2, 0.9, sin(dot(rf.xz, vec2(9.0, 7.0)) + vPos.y * 0.7));
    env += (uAmb + diff) * 0.12 + uWinC * 0.05 * smoothstep(-0.05, 0.3, up);
    // steel's softer than chrome: the painted room's contrast pressed down to a grey
    env = mix(vec3(0.36), env, 0.5);
    float fr = fresnelOf(n, v);
    outColor = vec4(finish(env * base * mix(0.6, 0.95, fr) + (uAmb + diff) * base * 0.25 + spec * 1.1), 1.0);
    return;
  }
  // carbon fibre (material 46): a 2x2 twill of 9 mm tows under lacquer, mapped on the face's own metres (vUv), so
  // it's the same on the moving layer. The two sets of tows catch the light out of step, and swap as you move round
  if (vMat == 46.0) {
    vec2 q = vUv * 110.0, c = fract(q);
    bool warp = mod(floor(q.x) + floor(q.y), 4.0) < 2.0;
    float tow = sin((warp ? c.y : c.x) * 3.14159);
    float k = 1.0 - smoothstep(0.35, 1.0, length(fwidth(q)));
    float s = 0.5 + 0.5 * sin(dot(v, vec3(3.1, 1.7, 2.3)) * 2.2 + (warp ? 1.7 : 0.0));
    float h = mix(0.8, (0.45 + 0.55 * tow) * mix(0.55, 1.4, s), k);
    float fr = fresnelOf(n, v);
    outColor = vec4(finish(base * h * (uAmb + diff) + spec * 1.4 + (uAmb + diff) * fr * 0.18), 1.0);
    return;
  }
  outColor = vec4(finish(roomShade(base, diff, spec, vMat)), paintA);
}`;
// ⚠ THE DEPTH PREPASS. The lit shader is the frame's cost (up to 14 lamps and 12 points of window, each a
// pow), and a sofa in front of a wall used to light the wall's pixels too. So the opaque batches lay their
// depth first with this, and the lit pass draws on LEQUAL and shades each pixel once. Both vertex shaders
// keep gl_Position `invariant`, or the two depths differ in the last bit and the walls speckle.
// A layer of an animal's fur (gl/beast-kit.js furShells, material 50..65) lays no depth here: it's mostly holes, cut in
// the beast shader, and its depth would hide the coat and the body under it.
const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 4) in float aMat;
uniform mat4 uVP;
invariant gl_Position;
void main() {
  if (aMat > 49.5 && aMat < 65.5) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  gl_Position = uVP * vec4(aPos, 1.0);
}`;
const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 outColor;
void main() { outColor = vec4(0.0); }`;
declareProgram(VS, FS, null, { scenes: ['room'] });
declareProgram(INK_VS, INK_FS, null, { scenes: ['room'] });
declareProgram(DEPTH_VS, DEPTH_FS, null, { scenes: ['room'] });
declareProgram(BEAST_VS, BEAST_FS, null, { scenes: ['room'] });
declareProgram(HALO_VS, HALO_FS, null, { scenes: ['room'] });

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
    prewarmPrograms(gl, 'room');
    const prog = (vs, fs, label) => { const p = layerProgram(gl, vs, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
    const LIT = prog(VS, FS, 'room lit'), INK = prog(INK_VS, INK_FS, 'room ink'), DEPTH = prog(DEPTH_VS, DEPTH_FS, 'room depth');
    // the beasts' own light and the halos round what glows on them (gl/beast-light.js)
    const BEAST = prog(BEAST_VS, BEAST_FS, 'room beasts'), HALO = prog(HALO_VS, HALO_FS, 'room halos');
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
    // paint on the walls (setDecals): one quad a tag, each with its own baked texture, drawn blended over the plaster
    const decals = layer();
    let decalRuns = [];
    const decalTex = new Map();   // key -> { t, src }
    // an animal on the floor (gl/room-beasts.js), inked like the people and lit by gl/beast-light.js
    const beasts = layer(), halos = layer();
    // a stage's own see-through props (liquids, gl/lab-matter.js) and its own halos, drawn with the room's glass and halos
    const propsGlass = layer(), stageHalos = layer();
    const stageGlowP = new Float32Array(32), stageGlowC = new Float32Array(24);
    let stageGlowN = 0;
    // what glows on them lights them: up to eight { p: [x, y, z], c: [r, g, b], r } a frame
    const glowP = new Float32Array(32), glowC = new Float32Array(24);
    let glowN = 0;
    const dropLayers = (r) => { for (const L of [r.solid, r.screen, r.glass, r.view, ...r.mats]) drop(L); };
    const uploadRoom = (m, paint) => {
      const one = (b) => { const L = layer(); upload(L, b); L.kit = b.kit || []; return L; };
      for (const key of m.textured.keys()) if (!tex.has(key)) tex.set(key, texture(paint(key)));
      return { solid: one(m.solid), screen: one(m.screen), glass: one(m.glass), view: one(m.view), mats: [...m.textured].map(([key, b]) => ({ key, ...one(b) })), probeAt: measureProbe([m.solid, ...m.textured.values()]) };
    };
    // ⚠ A ROOM UPLOADED AHEAD (room-stage.js composes the rooms past the next doorway with their shells during the
    // bake). The upload and the probe's pass over every vertex were most of what a crossing still cost once the
    // meshes were baked; a prepared room is swapped in by the mesh object, so setRoom on a mesh that wasn't
    // prepared uploads as it always did. Kept by mesh object, a few at most; dropPrepared frees the ones not taken.
    const ready = new Map(), READY_MAX = phone ? 2 : 4;
    function prepareRoom(m, paint) {
      if (ready.has(m)) return;
      ready.set(m, uploadRoom(m, paint));
      for (const [k, r] of ready) { if (ready.size <= READY_MAX) break; ready.delete(k); dropLayers(r); }
    }
    function dropPrepared() { for (const r of ready.values()) dropLayers(r); ready.clear(); }
    function setRoom(m, paint) {
      if (room) dropLayers(room);
      room = ready.get(m) || uploadRoom(m, paint);
      ready.delete(m);
      placeProbe(room.probeAt);
    }
    // ── the chrome's probe ──────────────────────────────────────────────────────────────────────
    // A room with chrome in it (material 45) gets a cube of itself to reflect: placed between the chrome and the
    // middle of the room at about eye height, its box the room's own bounds (six metres at most round it), drawn
    // from there six ways at a small size and mipped. No chrome, no probe, no cost.
    let probe = null;
    gl.useProgram(LIT.p); gl.uniform1i(LIT.u('uProbe'), 1); gl.uniform1i(LIT.u('uProbeOn'), 0);
    const dropProbe = () => { if (probe) { gl.deleteTexture(probe.t); gl.deleteFramebuffer(probe.fb); gl.deleteRenderbuffer(probe.rb); } probe = null; };
    function measureProbe(batches) {
      const fl = STRIDE, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], cs = [0, 0, 0];
      let nc = 0;
      for (const b of batches) {
        const d = b.data;
        for (let i = 0; i < b.n; i++) {
          const o = i * fl;
          for (let k = 0; k < 3; k++) { const x = d[o + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
          if (d[o + 11] === 45) { cs[0] += d[o]; cs[1] += d[o + 1]; cs[2] += d[o + 2]; nc++; }
        }
      }
      if (!nc) return null;
      const c = cs.map((x) => x / nc), mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
      // the floor is y 0 (the batch reaches below it: the view, the ground outside), the ceiling whatever's above, four metres at most
      const p = [c[0] + (mid[0] - c[0]) * 0.4, Math.max(1.1, Math.min(1.7, c[1])), c[2] + (mid[2] - c[2]) * 0.4];
      const min = [Math.max(lo[0], p[0] - 6) - 0.01, -0.01, Math.max(lo[2], p[2] - 6) - 0.01], max = [Math.min(hi[0], p[0] + 6) + 0.01, Math.min(hi[1], 4) + 0.01, Math.min(hi[2], p[2] + 6) + 0.01];
      return { p, min, max };
    }
    function placeProbe(at) {
      if (!at) { dropProbe(); return; }
      const { p, min, max } = at;
      if (!probe) {
        const size = phone ? 64 : 192, t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
        gl.texStorage2D(gl.TEXTURE_CUBE_MAP, Math.floor(Math.log2(size)) + 1, gl.RGBA8, size, size);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        for (const a of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, a, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, size, size);
        probe = { t, fb, rb, size, at: 0, next: 0 };
      }
      Object.assign(probe, { p, min, max, dirty: true });
    }
    // the six faces: where each looks, and its up (the cube map's own convention)
    const FACES = [[[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]], [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, -1]], [[0, 0, 1], [0, -1, 0]], [[0, 0, -1], [0, -1, 0]]];
    function bakeProbe(setLight, light, level, faces = [0, 1, 2, 3, 4, 5]) {
      const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING), S = probe.size, e = probe.p;
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_CUBE_MAP, null); gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, probe.fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, probe.rb);
      gl.viewport(0, 0, S, S);
      gl.useProgram(LIT.p);
      // uRes far out makes the vignette one flat 0.744 over the face, which the lookup takes back out
      setLight(LIT, e, 1e9, 1e9);
      gl.uniform1i(LIT.u('uProbeOn'), 0);
      gl.uniform1i(LIT.u('uTex'), 0);
      gl.uniform1f(LIT.u('uLampDim'), 0.28 + 0.72 * level);
      setOutsideUniforms(gl, LIT, light.outside || null);
      gl.uniform1f(LIT.u('uFlame'), light.flame ?? 0.7);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
      const near = 0.05, far = 40;
      const proj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
      const draw = (L) => { if (L.n > 0) { gl.bindVertexArray(L.vao); gl.drawArrays(gl.TRIANGLES, 0, L.n); } };
      for (const i of faces) {
        const [f, up] = FACES[i];
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, probe.t, 0);
        gl.clearColor(0.03, 0.03, 0.035, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const r = norm(cross(f, up)), u = cross(r, f);
        const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
        gl.uniformMatrix4fv(LIT.u('uVP'), false, new Float32Array(mat4mul(proj, view)));
        gl.uniform1i(LIT.u('uMode'), 0);
        draw(room.solid); draw(people); draw(props); draw(locks);
        gl.uniform1i(LIT.u('uMode'), 1);
        for (const m of room.mats) { gl.bindTexture(gl.TEXTURE_2D, tex.get(m.key)); draw(m); }
        if (screen) { gl.uniform1i(LIT.u('uMode'), 2); gl.bindTexture(gl.TEXTURE_2D, screen.t); draw(room.screen); }
      }
      // the mips once the cube is whole again
      if (faces.includes(5)) { gl.bindTexture(gl.TEXTURE_CUBE_MAP, probe.t); gl.generateMipmap(gl.TEXTURE_CUBE_MAP); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
      gl.bindVertexArray(null);
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
    function setPropsGlass(b) { upload(propsGlass, b || { data: new Float32Array(0), n: 0 }); }
    function setStageHalos(b) { upload(stageHalos, b || { data: new Float32Array(0), n: 0 }); }
    // up to eight { p: [x, y, z], c: [r, g, b], r } lighting the room this frame
    function setGlows(list) {
      const ls = (list || []).slice(0, 8);
      stageGlowN = ls.length; stageGlowP.fill(0); stageGlowC.fill(0);
      ls.forEach((g, i) => { stageGlowP.set([g.p[0], g.p[1], g.p[2], g.r], i * 4); stageGlowC.set(g.c, i * 3); });
    }
    function setLocks(b) { upload(locks, b); }
    // [{ key, src, quad: [tl, tr, br, bl] (room points), n (the wall's inward normal), fresh? }]: a tag a quad, its
    // texture the canvas it was baked on. A key already uploaded keeps its texture unless `fresh` says the canvas
    // was painted again (the spray session filling a section in); a key no longer listed is let go.
    function setDecals(list) {
      const ls = (list || []).filter((d) => d && d.key && d.src && Array.isArray(d.quad) && d.quad.length === 4);
      const keep = new Set(ls.map((d) => d.key));
      for (const [k, v] of decalTex) if (!keep.has(k)) { gl.deleteTexture(v.t); decalTex.delete(k); }
      const data = new Float32Array(ls.length * 6 * STRIDE);
      decalRuns = [];
      let o = 0;
      ls.forEach((d, i) => {
        const had = decalTex.get(d.key);
        if (!had || had.src !== d.src || had.w !== d.src.width || had.h !== d.src.height) {
          if (had) gl.deleteTexture(had.t);
          decalTex.set(d.key, { t: texture(d.src, { repeat: false }), src: d.src, w: d.src.width, h: d.src.height });
        } else if (d.fresh) { refill(had.t, d.src); gl.generateMipmap(gl.TEXTURE_2D); }
        const n = d.n || [0, 0, 1], uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (const c of [0, 1, 2, 0, 2, 3]) {
          const p = d.quad[c];
          data.set([p[0], p[1], p[2], n[0], n[1], n[2], uv[c][0], uv[c][1], 1, 1, 1, 13], o);
          o += STRIDE;
        }
        decalRuns.push({ key: d.key, first: i * 6 });
      });
      upload(decals, { data, n: ls.length * 6 });
    }
    // a beasts batch may carry its halos (b.halos, a batch) and its glows (b.lights, [{ p, c, r }]) (gl/beast-kit.js toBatch)
    function setBeasts(b) {
      upload(beasts, b);
      upload(halos, b.halos || { data: new Float32Array(0), n: 0 });
      const ls = (b.lights || []).slice(0, 8);
      glowN = ls.length;
      ls.forEach((g, i) => { glowP.set([g.p[0], g.p[1], g.p[2], g.r], i * 4); glowC.set(g.c, i * 3); });
    }
    function setFigures(recs) { figures = recs || []; }

    let vp = null;
    // the lens, made the first frame it's wanted; null if it wouldn't build
    let dof;
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
      setRoom, prepareRoom, dropPrepared, setView, setPano, setScreen, setLive, setPeople, setProps, setLocks, setBeasts, setFigures, setPropsGlass, setStageHalos, setGlows, setDecals,
      get figureTris() { return fig.tris; },
      // where the chrome's probe stands and the box it's projected on, for a bench to check (null with no chrome)
      get probe() { return probe ? { p: probe.p, min: probe.min, max: probe.max, size: probe.size } : null; },
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
        // the depth of field (gl/room-dof.js): the room drawn into its target, then through the lens onto the canvas
        if (roomDofOn() && dof === undefined) dof = createRoomDof(gl, { phone });
        const lensOn = roomDofOn() && light.dof !== false && !!dof && dof.begin(w, h);
        gl.viewport(0, 0, w, h);
        // with `see` the canvas is premultiplied, so any colour at alpha 0 is added to the city through every pane
        gl.clearColor(see ? 0 : 0.02, see ? 0 : 0.02, see ? 0 : 0.025, see ? 0 : 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS);
        gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
        const comic = comicOn();
        const opaque = [room.solid, ...room.mats, people, locks, beasts];
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
        // an animal is always inked at the people's line, comic or not, so it reads as one of the cast
        if (beasts.n > 0 && !comic) {
          const k = h / 900, s = phone ? 0.8 : 1;
          gl.useProgram(INK.p);
          gl.uniformMatrix4fv(INK.u('uVP'), false, vp);
          gl.uniform2f(INK.u('uShake'), 0, 0);
          gl.uniform2f(INK.u('uRes'), w, h);
          gl.uniform4f(INK.u('uInk'), 0.01, HOUSE.px[0] * k * s, HOUSE.px[1] * k * s, 0.0004);
          gl.uniform2f(INK.u('uBack'), 2 * FAR * NEAR / (FAR - NEAR), INK_BACK);
          gl.uniform4f(INK.u('uInkEye'), cam.eye[0], cam.eye[1], cam.eye[2], 1);
          gl.uniform3fv(INK.u('uCol'), HOUSE.ink);
          gl.uniform3f(INK.u('uKey'), 0, 1, 0);
          gl.uniform1f(INK.u('uWeigh'), HOUSE.weigh);
          draw(beasts);
          gl.uniform1f(INK.u('uWeigh'), 0);
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
        const setLight = (P, eye = cam.eye, rw = w, rh = h) => {
          gl.uniform3fv(P.u('uEye'), eye);
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
          // the shutters down: the slats keep the day out, and a scene on them glows (gl/room-shutters.js)
          gl.uniform3fv(P.u('uWinC'), shutterWinC([sky[0] * wk, sky[1] * wk, sky[2] * wk], light.shut));
          // what bounces round the room off the walls: some of the lamp and some of the day
          const amb = 0.035 + 0.16 * day * (light.shut ? 1 - 0.8 * Math.max(light.shut.drop, light.shut.vane * 0.8) : 1) + 0.1 * level;
          gl.uniform3f(P.u('uAmb'), amb * (0.9 + 0.1 * sky[0]), amb * (0.92 + 0.08 * sky[1]), amb);
          gl.uniform1f(P.u('uExpo'), 1.15);
          gl.uniform1f(P.u('uComic'), comic ? 1 : 0);
          gl.uniform2f(P.u('uRes'), rw, rh);
          gl.uniform1i(P.u('uStageGlowN'), stageGlowN);
          if (stageGlowN) { gl.uniform4fv(P.u('uStageGlowP'), stageGlowP); gl.uniform3fv(P.u('uStageGlowC'), stageGlowC); }
        };
        // the chrome's view of the room: all six faces when the room changes, then (not on a phone) one face a frame
        // every second and a half, so the people and the light moving round it show up without a frame paying for six
        const now = performance.now();
        if (probe && (probe.dirty || (!phone && (probe.next > 0 || now - probe.at > 1500)))) {
          if (probe.dirty) { bakeProbe(setLight, light, level); probe.next = 0; probe.at = now; probe.dirty = false; }
          else { bakeProbe(setLight, light, level, [probe.next]); probe.next = (probe.next + 1) % 6; if (!probe.next) probe.at = now; }
          gl.viewport(0, 0, w, h);
        }
        fig.draw(vp, figures, setLight);
        // the opaque room's depth, then everything lit on it shades only what's in front
        gl.useProgram(DEPTH.p);
        gl.uniformMatrix4fv(DEPTH.u('uVP'), false, vp);
        gl.colorMask(false, false, false, false);
        draw(room.solid); draw(people); draw(props); draw(locks); draw(beasts);
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
        gl.uniform1i(LIT.u('uProbeOn'), probe ? 1 : 0);
        if (probe) {
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_CUBE_MAP, probe.t); gl.activeTexture(gl.TEXTURE0);
          gl.uniform3fv(LIT.u('uProbeP'), probe.p); gl.uniform3fv(LIT.u('uProbeMin'), probe.min); gl.uniform3fv(LIT.u('uProbeMax'), probe.max);
        }
        gl.uniform1i(LIT.u('uMode'), 0);
        draw(room.solid); draw(people); draw(props); draw(locks);
        // an animal is lit in the comic manner whatever the room is, as the people are (gl/beast-kit.js)
        if (beasts.n > 0) {
          gl.useProgram(BEAST.p);
          gl.uniformMatrix4fv(BEAST.u('uVP'), false, vp);
          setLight(BEAST);
          gl.uniform1f(BEAST.u('uComic'), 1);
          gl.uniform1f(BEAST.u('uTime'), (light.now ?? performance.now()) / 1000);
          gl.uniform3f(BEAST.u('uShadeTint'), 0.6, 0.55, 0.8);
          gl.uniform1f(BEAST.u('uRimK'), light.rim ?? 1);
          gl.uniform1i(BEAST.u('uGlowN'), glowN);
          gl.uniform4fv(BEAST.u('uGlowP'), glowP);
          gl.uniform3fv(BEAST.u('uGlowC'), glowC);
          draw(beasts);
          gl.useProgram(LIT.p);
        }
        gl.uniform1i(LIT.u('uMode'), 1);
        for (const m of room.mats) { gl.bindTexture(gl.TEXTURE_2D, tex.get(m.key)); draw(m); }
        // paint on the walls, over the plaster it's on: blended, writing no depth, and the canvas's own alpha kept
        // (with `see` a transparent pixel is a hole to the street)
        if (decals.n > 0) {
          gl.uniform1i(LIT.u('uMode'), 6);
          gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
          gl.bindVertexArray(decals.vao);
          for (const r of decalRuns) { const d = decalTex.get(r.key); if (!d) continue; gl.bindTexture(gl.TEXTURE_2D, d.t); gl.drawArrays(gl.TRIANGLES, r.first, 6); }
          gl.disable(gl.BLEND); gl.depthMask(true); gl.depthFunc(gl.LESS);
        }
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
        // the glass last, blended over what's behind it, writing no depth; under the shutters it's opaque
        setShutterUniforms(gl, LIT, light.shut || null);
        if (light.shut) { gl.uniform3fv(LIT.u('uFront'), light.front || [0, 0, 1]); gl.uniform3fv(LIT.u('uRight'), light.right || [-1, 0, 0]); }
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
        gl.uniform1i(LIT.u('uMode'), 3);
        // a stage's liquids first, so the glass round them puts its highlights on top
        draw(propsGlass);
        draw(room.glass);
        // the halos round what glows, added over everything, writing no depth
        if (halos.n > 0 || stageHalos.n > 0) {
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(HALO.p);
          gl.uniformMatrix4fv(HALO.u('uVP'), false, vp);
          gl.uniform3fv(HALO.u('uEye'), cam.eye);
          gl.uniform1f(HALO.u('uTime'), (light.now ?? performance.now()) / 1000);
          draw(halos); draw(stageHalos);
        }
        gl.depthMask(true); gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
        gl.bindVertexArray(null);
        // light.focus pins the lens in metres (a stage's own camera on its bench); without it, it focuses itself
        if (lensOn) dof.finish({ near: NEAR, far: FAR, focus: light.focus || 0, at: light.focusAt || null, band: light.focusBand || null, sharp: light.focusSharp || 0 });
        return true;
      },
      dispose() {
        canvas.removeEventListener('webglcontextlost', onLost);
        try { dof?.dispose(); } catch { /* the context may be gone already */ }
        try { fig.dispose(); } catch { /* the context may be gone already */ }
        try { dropProbe(); } catch { /* the context may be gone already */ }
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
