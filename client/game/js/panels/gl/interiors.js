// THE ROOMS INSIDE THE CITY. ROOM's rooms drawn in GLASS 2's own scene, on its depth buffer and through its
// camera, where the building stands (docs/proposals/one-world-interiors.md). A room isn't a second picture of the
// world any more: it's in the world, so a window looks at the real city and a doorway is just a doorway.
//
// Two levels, picked per room by glass/interiors-near.js from how far the eye is:
//   lod 0  the room's own mesh (gl/room-mesh.js batches), close up
//   lod 1  a lit box: floor, walls and ceiling in the room's tones, a lamp's glow at night. Cheap, for a room
//          a few tiles off that you'd only see as a lit window
// and past that nothing: the building's own model stands for it.
//
// ⚠ BUILT OFF THE FRAME, A FEW AT A TIME. A full room is thousands of triangles, so `sync` uploads at most
// `budget` new rooms a frame and keeps what's on the GPU until the room's been out of the list for KEEP_FRAMES.
// ⚠ THE ROOM'S FRAME IN, GLASS'S OUT. Vertices stay in the room renderer's metres (x, z across, y up); `M`
// (room-view.js roomToGlass) carries them to the building's tile in GLASS tiles, and the map window's origin is
// taken off here, as strokes.js does it, so precision holds far from the map's centre.
// ⚠ ONE LIGHTING MODEL, KEPT SMALL. The Room Stage lights per lamp and per pane; this is ambient, the frame's sun
// and a lamp term, enough for a room seen through glass or a door. The Stage's own renderer still draws a room
// you stand in until the one-world walk replaces it.
import { viewProjMatrix, mat4f, projectThrough } from './camera.js';
import { makeVertexStream } from './stream.js';
import { layerProgram } from './programs.js';
import { linearOut, applyLinOut, LIN, linRgb } from './colour.js';
import { multiply, invert } from './core/mat4.js';
import { texture2D } from './core/texture.js';
import { STRIDE, createBatch } from './ballpark-mesh.js';
import { HALO_VS, HALO_FS } from './beast-light.js';   // the soft shells round what glows, as gl/room.js adds them

const ATTRS = [[0, 3, 0], [1, 3, 12], [2, 2, 24], [3, 3, 32], [4, 1, 44]];
const KEEP_FRAMES = 240;
// materials that light themselves (gl/room.js): a light's own face, a lamp on the dimmer, a fire
const EMISSIVE = [40, 42, 43];

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aCol;
layout(location = 4) in float aMat;
uniform mat4 uVP;
uniform mat4 uModel;
uniform mat4 uStillVP;   // the still's own camera, in the room's frame (lobby-still.js)
out vec3 vCol; out vec3 vNor; flat out float vMat; out vec3 vW; out vec4 vStill; out vec2 vUv;
out float vLy;   // height in the room's own frame, for uTop
void main() {
  vCol = aCol; vMat = aMat; vUv = aUv; vLy = aPos.y;
  vNor = normalize(mat3(uModel) * aNor);
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vStill = uStillVP * vec4(aPos, 1.0);
  gl_Position = uVP * w;
}`;

const FS = linearOut(`#version 300 es
precision highp float;
in vec3 vCol; in vec3 vNor; flat in float vMat; in vec3 vW; in vec4 vStill; in vec2 vUv;
in float vLy;
// a room is cut off at its own ceiling (uTop, its frame's height): what its mesh builds above it (a rink room's arena
// seating) would come up through the floor of the room over it, as Rinkside's did through the Stands' (2026-11-23)
uniform float uTopOn; uniform float uTop;
uniform vec3 uTint;      // a textured batch's mean colour, or white
uniform vec3 uAmb;       // the day through the windows
uniform vec3 uSun;       // the frame's sun direction (GLASS world, z up), and its strength in its length
uniform vec3 uLamp;      // the room's lamps, warm, all round (or, with uLampN, their colour)
uniform float uDayK;     // how much of the day gets into this room (flags.room.daylight), 1 for most
uniform int uLampN;      // the room's own lamps, where they hang (GLASS tiles about the window, w their strength), up to 6
uniform vec4 uLampP[6];
uniform float uLampM;    // GLASS tiles a metre, for the lamps' fall-off
uniform vec4 uClip;      // through a street door: only what's past the doorway (xy . n > w), when uClipOn
uniform float uClipOn;
uniform sampler2D uStill;
uniform float uStillOn;  // paint what the still saw where it saw it
uniform sampler2D uScreen;
uniform float uScreenOn; // a set that's on: its picture, unlit, as gl/room.js draws a screen (uMode 2); 2, the picture by where it lands on the screen (the ice under a rink's opening)
uniform vec2 uViewPx;    // the viewport's size in pixels, for uScreenOn 2
uniform float uDecalOn;  // paint on a wall (a poster, a tag): uScreen's picture, cut out by its alpha, lit as the wall is;
                         // at 2, light off a wall ('glow': a screen, a seam, a glyph), added; at 3, foil lettering
uniform float uDecalK;   // the glow's or the foil's strength (setDecals 'glow', 'foil')
uniform float uFoilT;    // seconds, for the foil's shimmer
uniform int uVatN;       // a vat hall's lit columns (gl/room-vat.js lights), nearest first, up to 6: base xyz, radius w
uniform vec4 uVatP[6];
uniform vec4 uVatC[6];   // and each one's colour, its height in w
uniform float uVatT;     // seconds, for the caustics moving through their light
uniform float uGlassOn;  // a vat hall's glass, drawn after the fluid: see-through, more so face on, premultiplied
uniform vec3 uEyeW;      // the eye in the frame's tiles, for the glass
out vec4 outColor;
// a vat's caustics where a point is (gl/room.js vatCaustic, z up here and 'p' in metres): two layers of bent light, sharp
// where they cross. ONE CALL SITE, in the vats' loop.
float vatCaustic(vec3 p, vec3 n, float t) {
  vec2 q = (abs(n.z) > 0.6 ? p.xy : (abs(n.x) > abs(n.y) ? p.yz : p.xz)) * 8.5;
  vec2 a = q + vec2(sin(q.y * 1.3 + t * 0.9), cos(q.x * 1.1 - t * 0.7));
  vec2 b = q * 1.6 + vec2(cos(q.y * 0.8 - t * 0.6), sin(q.x * 1.4 + t * 0.8)) * 1.4;
  float c = 1.0 - abs(sin(a.x) * sin(a.y)), d = 1.0 - abs(sin(b.x + 1.3) * sin(b.y));
  return pow(c, 14.0) + pow(d, 18.0) * 0.6;
}
void main() {
  if (uTopOn > 0.5 && vLy > uTop) discard;
  if (uClipOn > 0.5 && dot(vW.xy, uClip.xy) < uClip.w) discard;
  if (uStillOn > 0.5 && vStill.w > 1e-4) {
    vec2 s = vStill.xy / vStill.w;
    if (abs(s.x) < 0.995 && abs(s.y) < 0.995) {
      outColor = vec4(texture(uStill, vec2(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5)).rgb, 1.0);
      return;
    }
  }
  if (uScreenOn > 1.5) { vec2 q = gl_FragCoord.xy / max(uViewPx, vec2(1.0)); outColor = vec4(texture(uScreen, vec2(q.x, 1.0 - q.y)).rgb, 1.0); return; }
  if (uScreenOn > 0.5) { outColor = vec4(texture(uScreen, vUv).rgb, 1.0); return; }
  vec3 base = vCol * uTint;
  // light off a wall: the canvas added over the picture, as strong as it's asked, lit by nothing in the room (gl/room.js mode 7)
  if (uDecalOn > 1.5 && uDecalOn < 2.5) { vec4 t = texture(uScreen, vUv); outColor = vec4(t.rgb * t.a * uDecalK, 0.0); return; }
  // foil: lettering over a picture, lit by nothing, a bright band running across it as you move and as time goes, and
  // gone from far enough round to the side (gl/room.js mode 8, z up here and in metres)
  if (uDecalOn > 2.5) {
    vec4 t = texture(uScreen, vUv);
    if (t.a < 0.01) discard;
    vec3 fn = normalize(vNor), e = normalize(uEyeW - vW), rt = normalize(vec3(-fn.y, fn.x, 0.0) + vec3(1e-5, 0.0, 0.0));
    float side = dot(e, rt), off = abs(side) + 0.35 * max(0.0, abs(e.z) - 0.45), vis = 1.0 - smoothstep(0.5, 0.74, off);
    float pm = 1.0 / max(uLampM, 1e-5), along = dot(vW, rt) * pm;
    float band = pow(max(0.0, sin((along * 1.6 + vW.z * pm * 0.8) * 6.2831853 - side * 12.0 - uFoilT * 0.7)), 14.0);
    float glint = 0.94 + 0.06 * sin(uFoilT * 2.7 + along * 31.0);
    vec3 c = t.rgb * glint * (1.0 + band * 0.8) + vec3(1.0, 0.86, 0.55) * band * 0.3;
    float a = t.a * vis * clamp(uDecalK, 0.0, 1.0);
    outColor = vec4(c * a, a);
    return;
  }
  if (uDecalOn > 0.5) { vec4 t = texture(uScreen, vUv); if (t.a < 0.06) discard; base = pow(t.rgb, vec3(2.2)); }
  if (vMat == 40.0 || vMat == 42.0 || vMat == 43.0) { outColor = vec4(pow(base, vec3(1.0 / 2.2)), 1.0); return; }
  vec3 n = normalize(vNor);
  float sun = max(dot(n, normalize(uSun + vec3(0.0, 0.0, 1e-4))), 0.0) * length(uSun) * 0.35 * uDayK;
  float up = 0.65 + 0.35 * n.z;
  // ONE LAMP AT A TIME, from where it hangs: a little of it all round still, so a corner isn't black, and the rest
  // falling off with the distance in metres and turned by the surface's facing, as a room's own lamps light it on the
  // Stage. With no lamps given (a box, a room still building), the old all-round tint.
  vec3 lamps = uLampN > 0 ? uLamp * 0.3 : uLamp;
  for (int i = 0; i < 6; i++) {
    if (i >= uLampN) break;
    vec3 dl = uLampP[i].xyz - vW;
    float dm = length(dl) / max(uLampM, 1e-5);
    float face = 0.35 + 0.65 * max(dot(n, normalize(dl)), 0.0);
    lamps += uLamp * uLampP[i].w * face / (1.0 + dm * dm * 0.22);
  }
  // the vats' own light, from the nearest point of each column's axis, falling off over a few metres (gl/room.js)
  float perM = 1.0 / max(uLampM, 1e-5);
  for (int k = 0; k < 6; k++) {
    if (k >= uVatN) break;
    vec4 P = uVatP[k], C = uVatC[k];
    vec3 L = vec3(P.x, P.y, clamp(vW.z, P.z, P.z + C.w)) - vW;
    float dm = max(length(L) * perM, 1e-3), fall = smoothstep(3.4, 0.3, dm) / (1.0 + 2.2 * dm * dm);
    if (fall <= 0.0) continue;
    // a glow (glowLight: a MORPHEX pod's ring, a stage's flame) is a plain point, its w below 0, with no caustic in it
    float cs = P.w < 0.0 ? 0.625 : vatCaustic(vW * perM, n, uVatT + float(k) * 3.7);
    lamps += C.rgb * C.rgb * fall * max(0.0, dot(n, normalize(L)) * 0.7 + 0.3) * (0.5 + 0.8 * cs);
  }
  vec3 lit = base * (uAmb * uDayK * up + vec3(sun) + lamps);
  if (uGlassOn > 0.5) {
    float fr = pow(1.0 - abs(dot(n, normalize(uEyeW - vW))), 4.0), a = clamp(0.1 + 0.6 * fr, 0.0, 0.85);
    outColor = vec4(pow(lit * 0.5 + (uAmb + lamps) * fr * 0.6, vec3(1.0 / 2.2)) * a, a);
    return;
  }
  outColor = vec4(pow(lit, vec3(1.0 / 2.2)), 1.0);
}`, 'outColor');

// A room as a lit box, for lod 1: its four walls, floor and ceiling, facing in, in the room renderer's frame.
// `L` is a roomLayout; `tone` the walls' colour (linear).
export function roomBox(L, tone = [0.42, 0.38, 0.33], floorTone = [0.22, 0.17, 0.13]) {
  const b = createBatch(64), w = L.w / 2, d = L.d, h = L.h;
  const quad = (pts, n, col) => {
    const P = pts.map(([u, v, y]) => L.world(u, v, y)), N = [L.r[0] * n[0] - L.f[0] * n[1], n[2], L.r[2] * n[0] - L.f[2] * n[1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const o = b.n * STRIDE, p = P[i];
      b.data.set([p[0], p[1], p[2], N[0], N[1], N[2], 0, 0, col[0], col[1], col[2], 0], o);
      b.n++;
    }
  };
  quad([[-w, 0, 0], [w, 0, 0], [w, d, 0], [-w, d, 0]], [0, 0, 1], floorTone);
  quad([[-w, 0, h], [-w, d, h], [w, d, h], [w, 0, h]], [0, 0, -1], tone.map((c) => c * 1.15));
  quad([[-w, d, 0], [w, d, 0], [w, d, h], [-w, d, h]], [0, -1, 0], tone);
  quad([[-w, 0, 0], [-w, d, 0], [-w, d, h], [-w, 0, h]], [1, 0, 0], tone.map((c) => c * 0.9));
  quad([[w, 0, 0], [w, 0, h], [w, d, h], [w, d, 0]], [-1, 0, 0], tone.map((c) => c * 0.9));
  // and the front: a room whose street door is in a side wall is seen across its front wall from that door. Through
  // a door the doorway's own wall is cut away (drawPortals' clip), so a closed box opens on the side you look in from
  quad([[-w, 0, 0], [-w, 0, h], [w, 0, h], [w, 0, 0]], [0, 1, 0], tone.map((c) => c * 0.95));
  return b;
}
// '#rrggbb' to linear [r, g, b], or null
export function linearHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
}

// THE PORTAL: a street door seen from the street. The building's model is solid, so its rooms, drawn on the scene's
// depth buffer, are hidden behind its walls (doors included). So the rooms behind a street door are drawn again into a
// target of their own, from the same camera, cut at the doorway's plane, and the doorway is filled with that picture:
// a quad on the scene's depth buffer, so a lamp post in front of the door still stands in front of it, and the
// leaves (glass/street-doors.js, decals, after this) stand in front of both. You see the lobby with true parallax as
// you walk past, whether it's the room's box (lod 1) or its whole mesh (lod 0).
// ⚠ PULLED ALONG THE LINE OF SIGHT, NOT SET OUT FROM THE WALL. What a model draws in its doorway is mesh lifted
// toward the eye (windshield.js DETAIL_LIFT, 0.02), and a portal stood a few millimetres off the wall lost to it.
// Moving each corner toward the eye leaves it where it is on the screen and only brings its depth forward, so the
// jambs still frame it and only the back of their reveal is covered.
const PVS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uVP;
uniform vec3 uEye;
uniform float uPull;
void main() {
  vec3 d = uEye - aPos;
  float l = length(d);
  gl_Position = uVP * vec4(aPos + d / max(l, 1e-5) * min(uPull, l * 0.5), 1.0);
}`;
const PORTAL_PULL = 0.03;
const PFS = linearOut(`#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uView;   // the viewport the scene is drawn in: x, y, w, h
uniform vec4 uFog;    // rgb, and a > 0 for a pane whose room isn't loaded: frosted glass instead of the room
out vec4 outColor;
void main() {
  if (uFog.a > 0.5) {
    // a soft lighter band down the pane, so it reads as glass and not a painted panel
    float s = 0.92 + 0.08 * sin(gl_FragCoord.x * 0.013 + gl_FragCoord.y * 0.004);
    outColor = vec4(uFog.rgb * s, 1.0); return;
  }
  outColor = vec4(texture(uTex, (gl_FragCoord.xy - uView.xy) / uView.zw).rgb, 1.0);
}`, 'outColor');
// the colour the target is cleared to: a room's dark, behind anything a room doesn't cover
const PORTAL_CLEAR = [0.07, 0.055, 0.05];

// The mean colour of a painted texture, so a textured batch reads as its material at a glance (lod 0 draws no
// textures yet: interiors-near.js passes this as the batch's tint).
export function meanColour(canvas) {
  try {
    const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(4, 4) : Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
    const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, 4, 4);
    const px = x.getImageData(0, 0, 4, 4).data, s = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) s[k] += px[i + k];
    return s.map((v) => Math.pow(v / 16 / 255, 2.2));
  } catch { return [0.6, 0.6, 0.6]; }
}

export function createInteriorLayer(gl) {
  const prog = layerProgram(gl, VS, FS, 'interiors');
  const loc = {};
  const u = (n) => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(prog, n)));
  // key -> { parts: [{ vao, st, n, tint }], seen: frame }
  const held = new Map();
  let frame = 0;
  // the portals' own target, program and quad buffer, and each room's still on the GPU (made the first time needed)
  const stills = new Map();
  let tgt = null, pprog = null, pinfo = null, pbuf = null;

  const part = (batch, tint, screenPart = false, glass = false, cut = null) => {
    const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, STRIDE, ATTRS);
    st.write(batch.data, batch.n * STRIDE);
    return { vao, st, n: batch.n, tint: tint || [1, 1, 1], screen: !!screenPart, glass: !!glass, cut: cut && cut.length ? cut : null };
  };
  // PAINT ON THE WALLS (one-world phase B): a room's decals as gl/room.js setDecals takes them ({ key, src, quad, n,
  // fresh?, glow?, foil? }, the quad's corners in the room's frame), a texture each, kept by key and uploaded again when
  // the canvas changes or says it's `fresh`, and the room's quads in one buffer, made again only when they move.
  // ⚠ PAINT ONLY: a decal with `glow` or `foil` (the poster join's seams and lettering) isn't drawn here yet.
  const decalTex = new Map();   // key -> { tex, src, w, h, seen }
  const decalGeo = new Map();   // room key -> { vao, st, sig, runs: [{ key, first }], seen }
  function decalTexture(d) {
    let t = decalTex.get(d.key);
    const same = t && t.src === d.src && t.w === d.src.width && t.h === d.src.height;
    if (same && !d.fresh) { t.seen = frame; return t; }
    gl.activeTexture(gl.TEXTURE0 + SCREEN_UNIT);
    // (made linear and clamped once, by gl/core; each upload after keeps that)
    if (!t) decalTex.set(d.key, (t = { tex: texture2D(gl, { w: 1, h: 1 }) }));
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, d.src); }
    catch (e) { console.warn('[interiors] a decal would not upload:', d.key, e?.message); gl.activeTexture(gl.TEXTURE0); return null; }
    gl.activeTexture(gl.TEXTURE0);
    Object.assign(t, { src: d.src, w: d.src.width, h: d.src.height, seen: frame });
    return t;
  }
  function decalBatch(key, list) {
    const sig = list.map((d) => d.key + ':' + d.quad.flat().join(',')).join('|');
    let g = decalGeo.get(key);
    if (g && g.sig === sig) { g.seen = frame; return g; }
    if (g) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.st.buf); }
    const b = createBatch(list.length * 6 + 6), uv = [[0, 0], [1, 0], [1, 1], [0, 1]], runs = [];
    list.forEach((d, i) => {
      const n = d.n || [0, 0, 1];
      for (const c of [0, 1, 2, 0, 2, 3]) { const q = d.quad[c]; b.data.set([q[0], q[1], q[2], n[0], n[1], n[2], uv[c][0], uv[c][1], 1, 1, 1, 13], b.n * STRIDE); b.n++; }
      runs.push({ key: d.key, first: i * 6 });
    });
    const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, STRIDE, ATTRS);
    st.write(b.data, b.n * STRIDE);
    decalGeo.set(key, (g = { vao, st, sig, runs, seen: frame }));
    return g;
  }
  // A ROOM'S LIVE PARTS (one-world phases B and F): batches that change while the room's drawn, a depot's vehicle on its
  // stand (room-hoist.js `into`) and a locked doorway's steel leaves (room-lock.js), as `extra` ([{ batch, ver }], or
  // one) on the room. Each uploaded again only when its `ver` moves.
  const extras = new Map();   // room key # index -> { vao, st, ver, n, seen }
  // `glass`: only the parts marked glass (a MORPHEX pod's visor), drawn last in the room as the vat hall's glass is;
  // without it, only the rest
  function drawExtra(r, glass = false) {
    const xs = Array.isArray(r.extra) ? r.extra : [r.extra];
    let tris = 0;
    gl.uniform3fv(u('uTint'), [1, 1, 1]);
    xs.forEach((x, i) => {
      if (!x || !x.batch || !x.batch.n || !!x.glass !== glass) return;
      const key = r.key + '#' + i;
      let g = extras.get(key);
      if (!g || g.ver !== x.ver || g.src !== x.batch) {
        if (g) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.st.buf); }
        const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, STRIDE, ATTRS);
        st.write(x.batch.data, x.batch.n * STRIDE);
        extras.set(key, (g = { vao, st, ver: x.ver, src: x.batch, n: x.batch.n }));
      }
      g.seen = frame;
      // the ice under a rink's openings (freelook-view.js owRinkTick): its picture, laid where it lands on the screen
      const under = x.under ? screenTexture(key + '#under', { canvas: x.under, ver: x.uver }) : null;
      if (under) {
        const vw = gl.getParameter(gl.VIEWPORT);
        gl.activeTexture(gl.TEXTURE0 + SCREEN_UNIT); gl.bindTexture(gl.TEXTURE_2D, under.tex); gl.activeTexture(gl.TEXTURE0);
        gl.uniform2f(u('uViewPx'), vw[2], vw[3]); gl.uniform1f(u('uScreenOn'), 2);
      }
      gl.bindVertexArray(g.vao);
      gl.drawArrays(gl.TRIANGLES, 0, g.n);
      if (under) gl.uniform1f(u('uScreenOn'), 0);
      tris += g.n / 3;
    });
    return tris;
  }
  function drawDecals(r) {
    const list = (r.decals || []).filter((d) => d && d.key && d.src && d.src.width > 1 && Array.isArray(d.quad) && d.quad.length === 4);
    if (!list.length) return 0;
    const g = decalBatch(r.key, list);
    gl.uniform3fv(u('uTint'), [1, 1, 1]);
    gl.bindVertexArray(g.vao);
    gl.uniform1f(u('uFoilT'), (performance.now() / 1000) % 1000);
    // the paint first, then the foil over it (premultiplied over, writing no depth), then the light off them, added
    const kind = (d) => (d.glow != null ? 2 : d.foil != null ? 3 : 1);
    for (const pass of [1, 3, 2]) {
      if (pass === 3) { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false); }
      if (pass === 2) { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); gl.depthMask(false); }
      gl.uniform1f(u('uDecalOn'), pass);
      list.forEach((d, i) => {
        if (kind(d) !== pass) return;
        const t = decalTexture(d);
        if (!t) return;
        gl.activeTexture(gl.TEXTURE0 + SCREEN_UNIT); gl.bindTexture(gl.TEXTURE_2D, t.tex);
        if (pass !== 1) gl.uniform1f(u('uDecalK'), Math.max(0, +(pass === 2 ? d.glow : d.foil) || 0));
        gl.drawArrays(gl.TRIANGLES, g.runs[i].first, 6);
      });
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(u('uDecalOn'), 0);
    return list.length * 2;
  }
  // a set's picture on the GPU, by room: uploaded again only when its canvas has a new one (`ver`)
  const screens = new Map();   // key -> { tex, ver }
  const lampP = new Float32Array(24);
  function screenTexture(key, sc) {
    let t = screens.get(key);
    if (t && t.ver === sc.ver) return t;
    gl.activeTexture(gl.TEXTURE0 + SCREEN_UNIT);
    if (!t) screens.set(key, (t = { tex: texture2D(gl, { w: 1, h: 1 }), ver: -1 }));
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sc.canvas); }
    catch (e) { console.warn('[interiors] a screen would not upload:', key, e?.message); gl.activeTexture(gl.TEXTURE0); return null; }
    gl.activeTexture(gl.TEXTURE0);
    t.ver = sc.ver;
    return t;
  }
  const drop = (key) => {
    const h = held.get(key);
    if (!h) return;
    for (const p of h.parts) { gl.deleteVertexArray(p.vao); gl.deleteBuffer(p.st.buf); }
    held.delete(key);
  };

  // ⚠ STATE THE FUNCTIONS BELOW THE RETURN USE IS DECLARED HERE, ABOVE IT. Functions hoist past a return; a let or
  // const after it is never set, and the vat hall in GLASS threw on every frame and took the whole 3-D pass down.
  let vatMod = null, vatLayer, vatList = null;
  // a place's void (gl/room-void.js): the field behind its rooms and the floor where something stands, made the first
  // time a room with no shell is drawn whole
  let voidMod = null, voidLayer, voidSeen = -Infinity, voidHeld = null;
  const VOID_AWAY_MS = 5000;   // a place not drawn for this long arrives again when it's next drawn
  const vatP = new Float32Array(24), vatC = new Float32Array(24);
  const glowP = new Float32Array(24), glowC = new Float32Array(24);
  let haloProg = null, haloBuf = null;
  return {
    get held() { return held.size; },
    // `list`: [{ key, M (16, room frame -> GLASS tiles about the map window's centre), parts: () => [{ batch, tint }] }]
    // Uploads up to `budget` rooms it hasn't got; returns the ones ready to draw.
    sync(list, budget = 1) {
      frame++;
      const ready = [];
      for (const r of list || []) {
        let h = held.get(r.key);
        if (!h && budget > 0) {
          budget--;
          try { h = { parts: r.parts().filter((p) => p.batch && p.batch.n > 0).map((p) => part(p.batch, p.tint, p.screen, p.glass, p.cut)), seen: frame }; held.set(r.key, h); }
          catch (e) { console.warn('[interiors] a room would not build:', r.key, e?.message); held.set(r.key, h = { parts: [], seen: frame }); }
        }
        if (h) { h.seen = frame; ready.push({ r, h }); }
      }
      for (const [key, h] of held) if (frame - h.seen > KEEP_FRAMES) drop(key);
      for (const [key, g] of decalGeo) if (frame - g.seen > KEEP_FRAMES) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.st.buf); decalGeo.delete(key); }
      for (const [key, g] of extras) if (frame - (g.seen || 0) > KEEP_FRAMES) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.st.buf); extras.delete(key); }
      for (const [key, t] of decalTex) if (frame - (t.seen || 0) > KEEP_FRAMES) { gl.deleteTexture(t.tex); decalTex.delete(key); }
      this.ready = ready;
      return ready.length;
    },
    ready: [],
    lastVp: null, lastO: null,
    // A point in the frame's tiles (the rooms' list: about the map window's centre, z up) as a share of the picture,
    // { x, y } from its top left, and `f` its distance ahead (0 or less behind the eye), by last frame's camera; null
    // before a frame's been drawn. For a page laid onto a room's glass (freelook-view.js, room-envctl.js `project`).
    project(x, y, z) {
      if (!this.lastVp) return null;
      const p = projectThrough(this.lastVp, x - this.lastO[0], y - this.lastO[1], z, 1, 1);
      return { x: p.sx, y: p.sy, f: p.f };
    },
    // `cam` is the map-window camera; ox, oy the window's origin in the same tiles M is in. `portals` (windshield.js
    // streetPortals) are street doors to draw these rooms through; a room behind one is drawn only through it.
    draw(cam, cssH, ox, oy, light = {}, portals = null) {
      const ready = this.ready;
      if (!ready.length) return 0;
      const vp = mat4f(viewProjMatrix(cam, cssH));
      // kept for `project`: where a point of a room is on the picture, by the matrix it was drawn with
      this.lastVp = vp; this.lastO = [ox, oy];
      const through = portals && portals.length ? new Set(portals.map((p) => p.tile)) : null;
      // a vat hall you're in, ready before its room is drawn, which its vats light
      const open = (e) => !through || !through.has(e.r.tile);
      const vr = ready.find((e) => e.r.vatLive && open(e)), V = vr ? vatPrep(vr, vp, ox, oy) : null;
      // and the room whose close-up figures are up (the vat hall's own frame when it's that one)
      const fr = ready.find((e) => (e.r.figLive || e.r.catLive) && open(e)), FV = fr ? (V && V.e === fr ? V : roomFrame(fr, vp, ox, oy)) : V;
      // a place's void: its field first, behind every room, and nothing of the city was drawn under it (gl/world.js PLACE)
      const PV = voidPrep(ready.filter((e) => e.r.voidNow && open(e)), vp, ox, oy);
      // (its people held back while it arrives: liveDraw skips these rooms)
      voidHeld = PV && PV.hideFigs ? PV.rooms : null;
      if (PV) voidLayer.field(PV.vp, PV.eye, PV.now, PV.o);
      begin(vp, light, LIN_ON);
      let tris = 0;
      for (const e of ready) if (!through || !through.has(e.r.tile)) tris += drawRoom(e, ox, oy, null, V && V.e === e ? V.light : glowLight(e.r, ox, oy));
      if (FV) tris += liveDraw(FV, light);
      for (const e of ready) if (e.r.haloLive && e.r.haloLive.batch && e.r.haloLive.batch.n && open(e)) tris += haloDraw(e, vp, ox, oy);
      if (V && FV !== V) tris += liveDraw(V, light);
      if (through) tris += drawPortals(vp, ox, oy, light, portals, ready);
      // and its floor, only where something stands, over the rooms' pieces' feet
      if (PV) { voidLayer.floor(PV.vp, PV.eye, PV.now, PV.o); voidLayer.points(PV.vp, PV.eye, PV.now); gl.useProgram(prog); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); }
      gl.bindVertexArray(null);
      // `globalThis.__interiorStats = {}` in the console fills it each frame: what was drawn and how
      if (globalThis.__interiorStats) Object.assign(globalThis.__interiorStats, { rooms: ready.length, portals: portals ? portals.length : 0,
        behind: through ? ready.filter((e) => through.has(e.r.tile)).map((e) => e.r.key + (e.r.still ? ' (still)' : '')) : [], tris });
      return tris;
    },
    dispose() {
      for (const key of [...held.keys()]) drop(key);
      if (haloBuf) { gl.deleteVertexArray(haloBuf.vao); gl.deleteBuffer(haloBuf.st.buf); haloBuf = null; }
      for (const s of stills.values()) gl.deleteTexture(s.tex);
      for (const t of screens.values()) gl.deleteTexture(t.tex);
      screens.clear();
      for (const t of decalTex.values()) gl.deleteTexture(t.tex);
      for (const g of decalGeo.values()) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.st.buf); }
      decalTex.clear(); decalGeo.clear();
      for (const g of extras.values()) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.st.buf); }
      extras.clear();
      if (vatLayer) { try { vatLayer.dispose(); } catch { /* the context may be gone already */ } }
      vatLayer = undefined; vatList = null;
      if (voidLayer) { try { voidLayer.dispose(); } catch { /* the context may be gone already */ } }
      voidLayer = undefined;
      stills.clear(); dropTarget();
      if (pbuf) { gl.deleteVertexArray(pbuf.vao); gl.deleteBuffer(pbuf.buf); }
      gl.deleteProgram(prog); if (pprog) gl.deleteProgram(pprog);
    },
  };

  function begin(vp, light, lin) {
    gl.useProgram(prog); gl.uniform1f(u('uTopOn'), 0); applyLinOut(gl, prog, lin === LIN_ON ? undefined : lin);
    gl.uniformMatrix4fv(u('uVP'), false, vp);
    // the eye, for the foil and the glass: the point the view-projection sends to w = 0
    const Vi = invert(vp, new Float32Array(16));
    if (Vi) { const ew = Vi[11] || 1e-9; gl.uniform3f(u('uEyeW'), Vi[8] / ew, Vi[9] / ew, Vi[10] / ew); }
    gl.uniform3fv(u('uAmb'), light.amb || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u('uSun'), light.sun || [0, 0, 0]); gl.uniform1f(u('uDayK'), 1);
    gl.uniform1i(u('uStill'), STILL_UNIT); gl.uniform1i(u('uScreen'), SCREEN_UNIT); gl.uniform1f(u('uScreenOn'), 0); gl.uniform1f(u('uDecalOn'), 0);
    gl.uniform1f(u('uClipOn'), 0); gl.uniform1f(u('uStillOn'), 0); gl.uniform1f(u('uGlassOn'), 0); gl.uniform1i(u('uVatN'), 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  }

  // THE CLONE VATS (one-world phase F): a vat hall's fluid, its machines and its sleepers, by the Stage's own layer
  // (gl/room-vat.js) through the room's matrix, so the march, the copy of the picture behind each vat and the depth test
  // all run in the room's metres and land on GLASS's picture. Only the room whose entry carries 'vatLive' (freelook-view.js
  // owVatTick: the cycle's scene and levels, the sleepers posed in the room's frame, their capsules and their light).
  // ⚠ LOADED THE FIRST TIME A VAT HALL IS DRAWN, and made once a context; null for good if it won't build.
  // A ROOM'S GLOWS ('glowLive' on its entry: [{ p in the room's frame, c }], a MORPHEX pod's ring and visor), through the
  // vats' own six lights as plain points (w -1, no caustic), as gl/room.js setGlows lights what's round them
  // A ROOM'S HALOS ('haloLive' on its entry: { batch, ver } in the room's frame, a MORPHEX pod's steam and ring): the
  // beasts' halo shader (gl/beast-light.js), through the room's matrix, added over the picture and writing no depth, as
  // gl/room.js draws its stage halos. Its program is made the first time a room has any.
  function haloDraw(e, vp, ox, oy) {
    const x = e.r.haloLive, Fr = roomFrame(e, vp, ox, oy);
    if (!Fr) return 0;
    if (!haloProg) { try { haloProg = layerProgram(gl, HALO_VS, linearOut(HALO_FS), 'interior halos'); } catch (err) { haloProg = false; console.warn('[interiors] no halos:', err && err.message); } }
    if (!haloProg) return 0;
    if (!haloBuf || haloBuf.ver !== x.ver || haloBuf.src !== x.batch) {
      if (haloBuf) { gl.deleteVertexArray(haloBuf.vao); gl.deleteBuffer(haloBuf.st.buf); }
      const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, STRIDE, ATTRS);
      st.write(x.batch.data, x.batch.n * STRIDE);
      haloBuf = { vao, st, ver: x.ver, src: x.batch, n: x.batch.n };
    }
    gl.useProgram(haloProg); applyLinOut(gl, haloProg);
    const hu = (n) => gl.getUniformLocation(haloProg, n);
    gl.uniformMatrix4fv(hu('uVP'), false, Fr.vp);
    gl.uniform3fv(hu('uEye'), Fr.eye);
    gl.uniform1f(hu('uTime'), performance.now() / 1000 % 1000);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(haloBuf.vao);
    gl.drawArrays(gl.TRIANGLES, 0, haloBuf.n);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);
    gl.useProgram(prog); gl.uniform1f(u('uTopOn'), 0);
    return haloBuf.n / 3;
  }
  function glowLight(r, ox, oy) {
    const list = r.glowLive;
    if (!list || !list.length) return null;
    const M = r.M, n = Math.min(6, list.length);
    glowP.fill(0); glowC.fill(0);
    for (let i = 0; i < n; i++) {
      const p = list[i].p, c = list[i].c || [1, 1, 1];
      glowP.set([M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12] - ox, M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13] - oy, M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14], -1], i * 4);
      glowC.set([Math.sqrt(Math.max(0, c[0])), Math.sqrt(Math.max(0, c[1])), Math.sqrt(Math.max(0, c[2])), 0], i * 4);
    }
    return { n, P: glowP, C: glowC, t: 0 };
  }
  // a room's frame on this frame's picture: its matrix about the window, the view-projection through it, the eye in it
  function roomFrame(e, vp, ox, oy) {
    const M = e.r.M.slice(); M[12] -= ox; M[13] -= oy;
    const Mi = invert(M, new Float32Array(16)), Vi = invert(vp, new Float32Array(16));
    if (!Mi || !Vi) return null;
    // the eye: the one point the view-projection sends to w = 0 at the screen's middle
    const ew = Vi[11] || 1e-9, E = [Vi[8] / ew, Vi[9] / ew, Vi[10] / ew];
    const eye = [Mi[0] * E[0] + Mi[4] * E[1] + Mi[8] * E[2] + Mi[12], Mi[1] * E[0] + Mi[5] * E[1] + Mi[9] * E[2] + Mi[13], Mi[2] * E[0] + Mi[6] * E[1] + Mi[10] * E[2] + Mi[14]];
    return { e, M, eye, eyeW: E, vp: multiply(vp, M, new Float32Array(16)) };
  }
  // A PLACE'S VOID (docs/proposals/the-inbetween.md): drawn in the frame of the first of its rooms (by key, so it's the same
  // room every frame), with every room's pieces brought into that frame, and its look blended between the rooms' kinds by
  // how near you are to each, so walking north the white goes to the Lattice's blue, the Broadcast's black, the Collapse.
  function voidPrep(list, vp, ox, oy) {
    const VOID_REACH = 9;   // metres: how far a room's look carries
    const vs = list.map((e) => ({ e, v: e.r.voidNow() })).filter((x) => x.v).sort((a, b) => (a.e.r.key < b.e.r.key ? -1 : 1));
    if (!vs.length) return null;
    if (!voidMod) { voidMod = import('./room-void.js').then((m) => { voidMod = m; }, (err) => { voidMod = false; console.warn('[interiors] no void:', err && err.message); }); return null; }
    if (voidMod instanceof Promise || voidMod === false) return null;
    if (voidLayer === undefined) { try { voidLayer = voidMod.createVoidLayer(gl, {}); } catch (err) { voidLayer = null; console.warn('[interiors] no void:', err && err.message); } }
    if (!voidLayer) return null;
    const F = roomFrame(vs[0].e, vp, ox, oy);
    if (!F) return null;
    const Fi = invert(F.M, new Float32Array(16));
    if (!Fi) return null;
    // a point of room i's frame into the first room's: through i's matrix about the window, then back through the first's
    const into = (e, x, y, z) => {
      const M = e.r.M, X = M[0] * x + M[4] * y + M[8] * z + M[12] - ox, Y = M[1] * x + M[5] * y + M[9] * z + M[13] - oy, Z = M[2] * x + M[6] * y + M[10] * z + M[14];
      return [Fi[0] * X + Fi[4] * Y + Fi[8] * Z + Fi[12], Fi[1] * X + Fi[5] * Y + Fi[9] * Z + Fi[13], Fi[2] * X + Fi[6] * Y + Fi[10] * Z + Fi[14]];
    };
    const now = performance.now(), eye = F.eye, pieces = [], K = voidMod.KIND_LOOK, look = { dark: 0, blue: 0, rush: 0 };
    let wsum = 0;
    for (const { e, v } of vs) {
      for (const [x, z, r] of v.pieces || []) { const p = into(e, x, v.floor || 0, z); pieces.push([p[0], p[2], r]); }
      const c = into(e, v.centre[0], v.centre[1], v.centre[2]), d = Math.hypot(eye[0] - c[0], eye[2] - c[2]), w = Math.exp(-((d / VOID_REACH) ** 2)) + 1e-6, k = K[v.kind] || K.white;
      look.dark += k.dark * w; look.blue += k.blue * w; look.rush += k.rush * w; wsum += w;
    }
    look.dark /= wsum; look.blue /= wsum; look.rush /= wsum;
    voidLayer.step(now, eye);
    const v0 = vs[0].v;
    // THE ARRIVAL (gl/room-void.js): the first frame a place is drawn after it's been away a while starts it, and while it
    // runs, every room of the place is printed in from the floor up (its mesh cut at the sweep, interiors.js uTop) and its
    // people are held back
    if (now - voidSeen > VOID_AWAY_MS) voidLayer.arrive(now, eye, F.vp, v0.floor || 0);
    voidSeen = now;
    const A = voidLayer.arrival(now);
    // (the frame's own cut kept aside, so a room object drawn again next frame gets it back when the print's done)
    for (const { e, v } of vs) {
      if (!('topBase' in e.r)) e.r.topBase = e.r.top;
      const base = Number.isFinite(e.r.topBase) ? e.r.topBase : Infinity;
      e.r.top = A && A.print < 1 ? Math.min(base, (v.floor || 0) + A.print * voidLayer.PRINT_H - 0.01) : e.r.topBase;
    }
    return { vp: F.vp, eye, now, hideFigs: !!(A && !A.people), rooms: new Set(vs.map((x) => x.e)), o: { kind: v0.kind, north: v0.north, floor: v0.floor || 0, pieces, look } };
  }
  function vatPrep(e, vp, ox, oy) {
    const r = e.r, live = r.vatLive, list = live && r.vatsNow ? r.vatsNow() : null;
    if (!live || !list || !list.length) return null;
    if (!vatMod) { vatMod = import('./room-vat.js').then((m) => { vatMod = m; }, (err) => { vatMod = false; console.warn('[interiors] no fluid in the vats:', err && err.message); }); return null; }
    if (vatMod instanceof Promise || vatMod === false) return null;
    if (vatLayer === undefined) { try { vatLayer = vatMod.createVatLayer(gl, {}); } catch (err) { vatLayer = null; console.warn('[interiors] no fluid in the vats:', err && err.message); } }
    if (!vatLayer) return null;
    if (vatList !== list) { vatList = list; vatLayer.setVats(list); vatLayer.setGantries(r.gantriesNow ? r.gantriesNow() : []); }
    vatLayer.setScene(live.scene || null);
    for (const l of live.levels || []) vatLayer.setLevel(l.id, l.k);
    vatLayer.setBodies(live.bodies || []);
    const Fr = roomFrame(e, vp, ox, oy);
    if (!Fr) return null;
    const { M, eye } = Fr;
    // each lit column into the frame's tiles: its base through the matrix, its radius and height by the room's scale
    const sc = Math.hypot(M[4], M[5], M[6]) || 1, L = vatLayer.lights(eye, live.gain || 1);
    vatP.fill(0); vatC.fill(0);
    for (let i = 0; i < L.n; i++) {
      const p = [L.P[i * 4], L.P[i * 4 + 1], L.P[i * 4 + 2]];
      vatP.set([M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14], L.P[i * 4 + 3] * sc], i * 4);
      vatC.set([L.C[i * 4], L.C[i * 4 + 1], L.C[i * 4 + 2], L.C[i * 4 + 3] * sc], i * 4);
    }
    return { ...Fr, live, light: { n: L.n, P: vatP, C: vatC, t: (performance.now() / 1000) % 600 } };
  }
  // After the rooms, the room you're in comes alive: its close-up figures ('figLive', freelook-view.js owFigTick: whoever's
  // lying down, a vat's sleeper), then a vat hall's fluid and machines (it reads the picture drawn so far through the bent
  // ray) and its glass over them, then the censor's panels over the picture as it then stands. `V` is the vat hall's
  // frame (vatPrep), or the figures' room's own (roomFrame).
  function liveDraw(V, light) {
    if (voidHeld && voidHeld.has(V.e)) return 0;
    const fig = V.e.r.figLive, F = light.figures, recs = fig && fig.recs;
    let tris = 0;
    const dim = (light.amb || [0.3, 0.3, 0.3]).map((c) => c * 0.4);
    if (F && recs && recs.length) F.draw(V.vp, recs, { eye: V.eye, lamps: fig.lamps, amb: fig.amb || dim });
    // and its cats (freelook-view.js owCatTick, gl/cat-layer.js)
    const cats = V.e.r.catLive;
    if (F && F.cats && cats && cats.cats.length) F.cats(V.vp, cats.cats, { eye: V.eye, lamps: cats.lamps, amb: cats.amb || dim });
    if (V.live) tris += vatDraw(V);
    if (F && recs && recs.length && F.censor) F.censor(V.vp, recs, V.eye);
    gl.useProgram(prog); gl.uniform1f(u('uTopOn'), 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    return tris;
  }
  function vatDraw(V) {
    const view = gl.getParameter(gl.VIEWPORT), w = view[2], h = view[3], now = performance.now();
    let tris = 0;
    vatLayer.step(now, V.eye);
    const lk = 0.035 + 0.1 * (V.e.r.lamp ? 1 : 0.2), amb = LIN.out ? linRgb([lk, lk, lk]) : [lk, lk, lk];
    vatLayer.draw(V.vp, V.eye, w, h, { now, amb, lin: LIN.out > 0 });
    // the glass, premultiplied over what's behind it, writing no depth; each vat's own still fill left out of it
    const glass = V.e.h.parts.filter((p) => p.glass);
    if (glass.length) {
      gl.useProgram(prog); gl.uniform1f(u('uTopOn'), 0); applyLinOut(gl, prog);
      gl.uniformMatrix4fv(u('uModel'), false, new Float32Array(V.M));
      gl.uniform3fv(u('uLamp'), V.e.r.lamp || [0, 0, 0]); gl.uniform1i(u('uLampN'), 0);
      gl.uniform1i(u('uVatN'), V.light.n);
      if (V.light.n) { gl.uniform4fv(u('uVatP'), V.light.P); gl.uniform4fv(u('uVatC'), V.light.C); gl.uniform1f(u('uVatT'), V.light.t); }
      gl.uniform1f(u('uGlassOn'), 1); gl.uniform3fv(u('uEyeW'), V.eyeW); gl.uniform1f(u('uClipOn'), 0); gl.uniform1f(u('uStillOn'), 0); gl.uniform1f(u('uScreenOn'), 0); gl.uniform1f(u('uDecalOn'), 0);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const p of glass) {
        gl.uniform3fv(u('uTint'), p.tint);
        gl.bindVertexArray(p.vao);
        if (!p.cut) { gl.drawArrays(gl.TRIANGLES, 0, p.n); tris += p.n / 3; continue; }
        const cut = p.cut.filter((g) => g[0] + g[1] <= p.n).sort((a, b) => a[0] - b[0]);
        let at = 0;
        for (const [a, n] of cut) { if (a > at) gl.drawArrays(gl.TRIANGLES, at, a - at); at = Math.max(at, a + n); }
        if (p.n > at) gl.drawArrays(gl.TRIANGLES, at, p.n - at);
        tris += p.n / 3;
      }
      gl.uniform1f(u('uGlassOn'), 0); gl.uniform1i(u('uVatN'), 0);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    return tris;
  }
  // one room's parts; `clip` is the portal's plane (about the same origin as M, after ox, oy come off)
  function drawRoom({ r, h }, ox, oy, clip, vat = null) {
    const M = r.M.slice(); M[12] -= ox; M[13] -= oy;
    gl.uniform1f(u('uLampM'), Math.hypot(M[4], M[5], M[6]) || 1);
    gl.uniform1i(u('uVatN'), vat ? vat.n : 0);
    if (vat && vat.n) { gl.uniform4fv(u('uVatP'), vat.P); gl.uniform4fv(u('uVatC'), vat.C); gl.uniform1f(u('uVatT'), vat.t); }
    gl.uniformMatrix4fv(u('uModel'), false, new Float32Array(M));
    gl.uniform3fv(u('uLamp'), r.lamp || [0, 0, 0]); gl.uniform1f(u('uDayK'), r.dayK ?? 1);
    // cut off at its own ceiling (uTop), if the frame says where that is (interiors-near.js interiorsFrame 'top')
    gl.uniform1f(u('uTopOn'), Number.isFinite(r.top) ? 1 : 0); if (Number.isFinite(r.top)) gl.uniform1f(u('uTop'), r.top);
    // the room's lamps, through its matrix to the window's tiles, as its vertices go (uModel)
    const ls = r.lamp && r.lamps ? r.lamps.slice(0, 6) : [];
    lampP.fill(0);
    ls.forEach((l, i) => { const p = l.p; lampP.set([M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14], (l.k ?? 1) * 0.55], i * 4); });
    gl.uniform1i(u('uLampN'), ls.length);
    if (ls.length) { gl.uniform4fv(u('uLampP'), lampP); gl.uniform1f(u('uLampM'), Math.hypot(M[4], M[5], M[6]) || 1); }
    if (clip) { gl.uniform4f(u('uClip'), clip[0], clip[1], 0, clip[2]); gl.uniform1f(u('uClipOn'), 1); }
    const s = clip && r.still ? stillTexture(r.key, r.still) : null;
    if (s) { gl.activeTexture(gl.TEXTURE0 + STILL_UNIT); gl.bindTexture(gl.TEXTURE_2D, s.tex); gl.activeTexture(gl.TEXTURE0);
      gl.uniformMatrix4fv(u('uStillVP'), false, r.still.vp); }
    gl.uniform1f(u('uStillOn'), s ? 1 : 0);
    let tris = 0;
    const sc = r.screen && r.screen.canvas ? screenTexture(r.key, r.screen) : null;
    for (const p of h.parts) {
      if (p.glass) continue;
      gl.uniform3fv(u('uTint'), p.tint);
      const lit = !!(p.screen && sc);
      if (lit) { gl.activeTexture(gl.TEXTURE0 + SCREEN_UNIT); gl.bindTexture(gl.TEXTURE_2D, sc.tex); gl.activeTexture(gl.TEXTURE0); }
      gl.uniform1f(u('uScreenOn'), lit ? 1 : 0);
      gl.bindVertexArray(p.vao);
      gl.drawArrays(gl.TRIANGLES, 0, p.n);
      tris += p.n / 3;
    }
    gl.uniform1f(u('uScreenOn'), 0);
    if (r.extra) tris += drawExtra(r);
    if (r.decals) tris += drawDecals(r);
    // glass hung on the room, see-through over everything in it, writing no depth
    if (Array.isArray(r.extra) && r.extra.some((x) => x?.glass && x.batch?.n)) {
      gl.uniform1f(u('uGlassOn'), 1); gl.uniform1f(u('uScreenOn'), 0); gl.uniform1f(u('uDecalOn'), 0);
      gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      tris += drawExtra(r, true);
      gl.uniform1f(u('uGlassOn'), 0); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.uniform1f(u('uClipOn'), 0); gl.uniform1f(u('uStillOn'), 0);
    return tris;
  }

  // The rooms behind each portal (a street door, or a room's own pane) into a target of their own, then the opening
  // filled from it. ⚠ ONE PORTAL AT A TIME, IN ITS OWN PATCH OF THE TARGET. Each portal cuts its rooms by its own plane,
  // so a room drawn for a pane in its side wall keeps its front wall, and in a shared target that wall stood over the
  // lobby seen through the door. Each one is drawn scissored to its quad's box on the screen and filled at once.
  function drawPortals(vp, ox, oy, light, portals, ready) {
    const view = gl.getParameter(gl.VIEWPORT), w = view[2], h = view[3];
    if (!(w > 0 && h > 0)) return 0;
    const prevFb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), scissor = gl.isEnabled(gl.SCISSOR_TEST), clear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    const prevBox = scissor ? gl.getParameter(gl.SCISSOR_BOX) : null;
    const T = target(w, h), P = portalProg(), B = portalBuf(Math.max(1, ...portals.map((p) => (p.quads ? p.quads.length : 1)))), eye = portals.eye || [0, 0, 0];
    let tris = 0;
    for (const p of portals) {
      const quads = p.quads || [p.quad];
      // a pane whose room isn't loaded (not built yet, or only its box this far off) is frosted glass until it is
      const fog = !!p.room && (p.fog || !ready.some((e) => e.r.key === p.room));
      const box = screenBox(vp, quads.flat(), ox, oy, w, h);
      if (!box) continue;
      if (!fog) {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.fb); gl.viewport(0, 0, w, h);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(box[0], box[1], box[2], box[3]);
      gl.clearColor(PORTAL_CLEAR[0], PORTAL_CLEAR[1], PORTAL_CLEAR[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // ⚠ GAMMA IN THE TARGET: the room's shader writes display colour when uGlassLinOut is off, and the quad that reads
      // the target back converts it as the scene wants, so a linear frame and a plain one both get the room right
      begin(vp, light, 0);
      // the plane moves with the origin: n . (x - o) > w  is  n . x > w + n . o
      const clip = [p.clip[0], p.clip[1], p.clip[2] - (p.clip[0] * ox + p.clip[1] * oy)];
      for (const e of ready) if (e.r.tile === p.tile && (!p.room || e.r.key === p.room)) tris += drawRoom(e, ox, oy, clip);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevFb); gl.viewport(view[0], view[1], w, h);
      if (scissor) gl.scissor(prevBox[0], prevBox[1], prevBox[2], prevBox[3]); else gl.disable(gl.SCISSOR_TEST);
      }
      // the opening, on the scene's depth, a touch in front of whatever the model drew in it
      let n = 0;
      for (const Q of quads) for (const i of [0, 1, 2, 0, 2, 3]) { const q = Q[i]; B.data.set([q[0] - ox, q[1] - oy, q[2]], n * 3); n++; }
      gl.bindBuffer(gl.ARRAY_BUFFER, B.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, B.data, 0, n * 3);
      gl.useProgram(P.prog); applyLinOut(gl, P.prog);
      gl.uniformMatrix4fv(P.vp, false, vp); gl.uniform4f(P.view, view[0], view[1], w, h); gl.uniform1i(P.tex, STILL_UNIT);
      gl.uniform3f(P.eye, eye[0] - ox, eye[1] - oy, eye[2]); gl.uniform1f(P.pull, portals.eye ? (p.pull ?? PORTAL_PULL) : 0);
      const amb = light.amb || [0.5, 0.5, 0.5];
      if (fog) gl.uniform4f(P.fog, Math.min(1, amb[0] * 0.7 + 0.1), Math.min(1, amb[1] * 0.72 + 0.11), Math.min(1, amb[2] * 0.75 + 0.13), 1);
      else gl.uniform4f(P.fog, 0, 0, 0, 0);
      gl.activeTexture(gl.TEXTURE0 + STILL_UNIT); gl.bindTexture(gl.TEXTURE_2D, T.tex); gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(B.vao);
      gl.drawArrays(gl.TRIANGLES, 0, n);
      // ⚠ the target off its unit before the next portal draws into it, or the room shader samples what it writes
      gl.activeTexture(gl.TEXTURE0 + STILL_UNIT); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);
      tris += n / 3;
    }
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    return tris;
  }
  // a quad's box on the target in pixels [x, y, w, h], the whole target when a corner is behind the eye, null off it
  function screenBox(vp, quad, ox, oy, w, h) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of quad) {
      const x = q[0] - ox, y = q[1] - oy, z = q[2];
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (!(cw > 1e-6)) return [0, 0, w, h];
      const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw * 0.5 + 0.5) * w;
      const sy = ((vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw * 0.5 + 0.5) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const a = Math.max(0, Math.floor(x0) - 2), b = Math.max(0, Math.floor(y0) - 2), c = Math.min(w, Math.ceil(x1) + 2), d = Math.min(h, Math.ceil(y1) + 2);
    return c > a && d > b ? [a, b, c - a, d - b] : null;
  }
  function target(w, h) {
    if (tgt && tgt.w === w && tgt.h === h) return tgt;
    dropTarget();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fb = gl.createFramebuffer(), was = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, was);
    return (tgt = { fb, tex, depth, w, h });
  }
  function dropTarget() {
    if (!tgt) return;
    gl.deleteFramebuffer(tgt.fb); gl.deleteTexture(tgt.tex); gl.deleteRenderbuffer(tgt.depth);
    tgt = null;
  }
  function portalProg() {
    if (pprog) return pinfo;
    pprog = layerProgram(gl, PVS, PFS, 'interior-portals');
    const loc = (n) => gl.getUniformLocation(pprog, n);
    return (pinfo = { prog: pprog, vp: loc('uVP'), view: loc('uView'), tex: loc('uTex'), eye: loc('uEye'), pull: loc('uPull'), fog: loc('uFog') });
  }
  function portalBuf(count) {
    const need = count * 6 * 3;
    if (pbuf && pbuf.data.length >= need) return pbuf;
    if (pbuf) { gl.deleteVertexArray(pbuf.vao); gl.deleteBuffer(pbuf.buf); }
    const vao = gl.createVertexArray(), buf = gl.createBuffer(), data = new Float32Array(Math.max(need, 6 * 3 * 4));
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    return (pbuf = { vao, buf, data });
  }
  // a still's picture on the GPU, by room, made again when the picture changes
  function stillTexture(key, still) {
    const img = still.img;
    if (!img) return null;
    let s = stills.get(key);
    if (s && s.img === img) return s;
    const tex = s ? s.tex : gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + STILL_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); }
    catch (e) { console.warn('[interiors] a still would not upload:', key, e?.message); gl.activeTexture(gl.TEXTURE0); return null; }
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.activeTexture(gl.TEXTURE0);
    s = { tex, img };
    stills.set(key, s);
    return s;
  }
}
// the unit the still and the portal's target are bound on, clear of unit 0 that the other layers bind as they go
const STILL_UNIT = 7;
const SCREEN_UNIT = 30;   // a set's picture (screenTexture): clear of every unit GLASS binds (0 to 27), under WebGL2's 32
const LIN_ON = 'scene';

export { EMISSIVE as INTERIOR_EMISSIVE };
