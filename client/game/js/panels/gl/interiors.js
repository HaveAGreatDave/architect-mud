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
import { viewProjMatrix, mat4f } from './camera.js';
import { makeVertexStream } from './stream.js';
import { layerProgram } from './programs.js';
import { linearOut, applyLinOut } from './colour.js';
import { STRIDE, createBatch } from './ballpark-mesh.js';

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
out vec3 vCol; out vec3 vNor; flat out float vMat; out vec3 vW; out vec4 vStill;
void main() {
  vCol = aCol; vMat = aMat;
  vNor = normalize(mat3(uModel) * aNor);
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vStill = uStillVP * vec4(aPos, 1.0);
  gl_Position = uVP * w;
}`;

const FS = linearOut(`#version 300 es
precision highp float;
in vec3 vCol; in vec3 vNor; flat in float vMat; in vec3 vW; in vec4 vStill;
uniform vec3 uTint;      // a textured batch's mean colour, or white
uniform vec3 uAmb;       // the day through the windows
uniform vec3 uSun;       // the frame's sun direction (GLASS world, z up), and its strength in its length
uniform vec3 uLamp;      // the room's lamps, warm, all round
uniform vec4 uClip;      // through a street door: only what's past the doorway (xy . n > w), when uClipOn
uniform float uClipOn;
uniform sampler2D uStill;
uniform float uStillOn;  // paint what the still saw where it saw it
out vec4 outColor;
void main() {
  if (uClipOn > 0.5 && dot(vW.xy, uClip.xy) < uClip.w) discard;
  if (uStillOn > 0.5 && vStill.w > 1e-4) {
    vec2 s = vStill.xy / vStill.w;
    if (abs(s.x) < 0.995 && abs(s.y) < 0.995) {
      outColor = vec4(texture(uStill, vec2(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5)).rgb, 1.0);
      return;
    }
  }
  vec3 base = vCol * uTint;
  if (vMat == 40.0 || vMat == 42.0 || vMat == 43.0) { outColor = vec4(pow(base, vec3(1.0 / 2.2)), 1.0); return; }
  vec3 n = normalize(vNor);
  float sun = max(dot(n, normalize(uSun + vec3(0.0, 0.0, 1e-4))), 0.0) * length(uSun) * 0.35;
  float up = 0.65 + 0.35 * n.z;
  vec3 lit = base * (uAmb * up + vec3(sun) + uLamp);
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
out vec4 outColor;
void main() { outColor = vec4(texture(uTex, (gl_FragCoord.xy - uView.xy) / uView.zw).rgb, 1.0); }`, 'outColor');
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

  const part = (batch, tint) => {
    const vao = gl.createVertexArray(), st = makeVertexStream(gl, vao, STRIDE, ATTRS);
    st.write(batch.data, batch.n * STRIDE);
    return { vao, st, n: batch.n, tint: tint || [1, 1, 1] };
  };
  const drop = (key) => {
    const h = held.get(key);
    if (!h) return;
    for (const p of h.parts) { gl.deleteVertexArray(p.vao); gl.deleteBuffer(p.st.buf); }
    held.delete(key);
  };

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
          try { h = { parts: r.parts().filter((p) => p.batch && p.batch.n > 0).map((p) => part(p.batch, p.tint)), seen: frame }; held.set(r.key, h); }
          catch (e) { console.warn('[interiors] a room would not build:', r.key, e?.message); held.set(r.key, h = { parts: [], seen: frame }); }
        }
        if (h) { h.seen = frame; ready.push({ r, h }); }
      }
      for (const [key, h] of held) if (frame - h.seen > KEEP_FRAMES) drop(key);
      this.ready = ready;
      return ready.length;
    },
    ready: [],
    // `cam` is the map-window camera; ox, oy the window's origin in the same tiles M is in. `portals` (windshield.js
    // streetPortals) are street doors to draw these rooms through; a room behind one is drawn only through it.
    draw(cam, cssH, ox, oy, light = {}, portals = null) {
      const ready = this.ready;
      if (!ready.length) return 0;
      const vp = mat4f(viewProjMatrix(cam, cssH));
      const through = portals && portals.length ? new Set(portals.map((p) => p.tile)) : null;
      begin(vp, light, LIN_ON);
      let tris = 0;
      for (const e of ready) if (!through || !through.has(e.r.tile)) tris += drawRoom(e, ox, oy, null);
      if (through) tris += drawPortals(vp, ox, oy, light, portals, ready);
      gl.bindVertexArray(null);
      // `globalThis.__interiorStats = {}` in the console fills it each frame: what was drawn and how
      if (globalThis.__interiorStats) Object.assign(globalThis.__interiorStats, { rooms: ready.length, portals: portals ? portals.length : 0,
        behind: through ? ready.filter((e) => through.has(e.r.tile)).map((e) => e.r.key + (e.r.still ? ' (still)' : '')) : [], tris });
      return tris;
    },
    dispose() {
      for (const key of [...held.keys()]) drop(key);
      for (const s of stills.values()) gl.deleteTexture(s.tex);
      stills.clear(); dropTarget();
      if (pbuf) { gl.deleteVertexArray(pbuf.vao); gl.deleteBuffer(pbuf.buf); }
      gl.deleteProgram(prog); if (pprog) gl.deleteProgram(pprog);
    },
  };

  function begin(vp, light, lin) {
    gl.useProgram(prog); applyLinOut(gl, prog, lin === LIN_ON ? undefined : lin);
    gl.uniformMatrix4fv(u('uVP'), false, vp);
    gl.uniform3fv(u('uAmb'), light.amb || [0.5, 0.5, 0.5]);
    gl.uniform3fv(u('uSun'), light.sun || [0, 0, 0]);
    gl.uniform1i(u('uStill'), STILL_UNIT);
    gl.uniform1f(u('uClipOn'), 0); gl.uniform1f(u('uStillOn'), 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  }
  // one room's parts; `clip` is the portal's plane (about the same origin as M, after ox, oy come off)
  function drawRoom({ r, h }, ox, oy, clip) {
    const M = r.M.slice(); M[12] -= ox; M[13] -= oy;
    gl.uniformMatrix4fv(u('uModel'), false, new Float32Array(M));
    gl.uniform3fv(u('uLamp'), r.lamp || [0, 0, 0]);
    if (clip) { gl.uniform4f(u('uClip'), clip[0], clip[1], 0, clip[2]); gl.uniform1f(u('uClipOn'), 1); }
    const s = clip && r.still ? stillTexture(r.key, r.still) : null;
    if (s) { gl.activeTexture(gl.TEXTURE0 + STILL_UNIT); gl.bindTexture(gl.TEXTURE_2D, s.tex); gl.activeTexture(gl.TEXTURE0);
      gl.uniformMatrix4fv(u('uStillVP'), false, r.still.vp); }
    gl.uniform1f(u('uStillOn'), s ? 1 : 0);
    let tris = 0;
    for (const p of h.parts) {
      gl.uniform3fv(u('uTint'), p.tint);
      gl.bindVertexArray(p.vao);
      gl.drawArrays(gl.TRIANGLES, 0, p.n);
      tris += p.n / 3;
    }
    gl.uniform1f(u('uClipOn'), 0); gl.uniform1f(u('uStillOn'), 0);
    return tris;
  }

  // the rooms behind each street door into a target of their own, then each doorway filled from it
  function drawPortals(vp, ox, oy, light, portals, ready) {
    const view = gl.getParameter(gl.VIEWPORT), w = view[2], h = view[3];
    if (!(w > 0 && h > 0)) return 0;
    const prevFb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), scissor = gl.isEnabled(gl.SCISSOR_TEST), clear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    const T = target(w, h);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.fb); gl.viewport(0, 0, w, h);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(PORTAL_CLEAR[0], PORTAL_CLEAR[1], PORTAL_CLEAR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // ⚠ GAMMA IN THE TARGET: the room's shader writes display colour when uGlassLinOut is off, and the quad that reads
    // the target back converts it as the scene wants, so a linear frame and a plain one both get the room right
    begin(vp, light, 0);
    let tris = 0;
    for (const p of portals) {
      // the plane moves with the origin: n . (x - o) > w  is  n . x > w + n . o
      const clip = [p.clip[0], p.clip[1], p.clip[2] - (p.clip[0] * ox + p.clip[1] * oy)];
      for (const e of ready) if (e.r.tile === p.tile) tris += drawRoom(e, ox, oy, clip);
    }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevFb); gl.viewport(view[0], view[1], w, h);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    // the doorways, on the scene's depth, a touch in front of whatever the model drew in them
    const P = portalProg(), B = portalBuf(portals.length);
    let n = 0;
    for (const p of portals) for (const i of [0, 1, 2, 0, 2, 3]) { const q = p.quad[i]; B.data.set([q[0] - ox, q[1] - oy, q[2]], n * 3); n++; }
    gl.bindBuffer(gl.ARRAY_BUFFER, B.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, B.data, 0, n * 3);
    gl.useProgram(P.prog); applyLinOut(gl, P.prog);
    gl.uniformMatrix4fv(P.vp, false, vp); gl.uniform4f(P.view, view[0], view[1], w, h); gl.uniform1i(P.tex, STILL_UNIT);
    const eye = portals.eye || [0, 0, 0];
    gl.uniform3f(P.eye, eye[0] - ox, eye[1] - oy, eye[2]); gl.uniform1f(P.pull, portals.eye ? PORTAL_PULL : 0);
    gl.activeTexture(gl.TEXTURE0 + STILL_UNIT); gl.bindTexture(gl.TEXTURE_2D, T.tex); gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(B.vao);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    return tris + n / 3;
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
    return (pinfo = { prog: pprog, vp: loc('uVP'), view: loc('uView'), tex: loc('uTex'), eye: loc('uEye'), pull: loc('uPull') });
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
const LIN_ON = 'scene';

export { EMISSIVE as INTERIOR_EMISSIVE };
