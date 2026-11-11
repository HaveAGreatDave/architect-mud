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
out vec3 vCol; out vec3 vNor; flat out float vMat;
void main() {
  vCol = aCol; vMat = aMat;
  vNor = normalize(mat3(uModel) * aNor);
  gl_Position = uVP * uModel * vec4(aPos, 1.0);
}`;

const FS = linearOut(`#version 300 es
precision highp float;
in vec3 vCol; in vec3 vNor; flat in float vMat;
uniform vec3 uTint;      // a textured batch's mean colour, or white
uniform vec3 uAmb;       // the day through the windows
uniform vec3 uSun;       // the frame's sun direction (GLASS world, z up), and its strength in its length
uniform vec3 uLamp;      // the room's lamps, warm, all round
out vec4 outColor;
void main() {
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
  // the front wall stays open: it's the side with the glass, and the building's own facade stands there
  return b;
}

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
    // `cam` is the map-window camera; ox, oy the window's origin in the same tiles M is in
    draw(cam, cssH, ox, oy, light = {}) {
      const ready = this.ready;
      if (!ready.length) return 0;
      gl.useProgram(prog); applyLinOut(gl, prog);
      gl.uniformMatrix4fv(u('uVP'), false, mat4f(viewProjMatrix(cam, cssH)));
      gl.uniform3fv(u('uAmb'), light.amb || [0.5, 0.5, 0.5]);
      gl.uniform3fv(u('uSun'), light.sun || [0, 0, 0]);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      let tris = 0;
      for (const { r, h } of ready) {
        const M = r.M.slice(); M[12] -= ox; M[13] -= oy;
        gl.uniformMatrix4fv(u('uModel'), false, new Float32Array(M));
        gl.uniform3fv(u('uLamp'), r.lamp || [0, 0, 0]);
        for (const p of h.parts) {
          gl.uniform3fv(u('uTint'), p.tint);
          gl.bindVertexArray(p.vao);
          gl.drawArrays(gl.TRIANGLES, 0, p.n);
          tris += p.n / 3;
        }
      }
      gl.bindVertexArray(null);
      return tris;
    },
    dispose() { for (const key of [...held.keys()]) drop(key); gl.deleteProgram(prog); },
  };
}

export { EMISSIVE as INTERIOR_EMISSIVE };
