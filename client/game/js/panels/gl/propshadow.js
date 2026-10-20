// THE SUN, ON WHAT STANDS IN THE STREET.
// The city's sun map (gl/shadow.js) holds the building mass and nothing else, and the road never
// samples it: a building's shadow on the ground is the footprint hull drawBuildingShadow lays down.
// So a lamp post, a signal mast, a park bench, a depot shed or a person cast nothing at all by day.
// This is a second, small depth map that holds only those, fitted to the ground in front of the
// camera, and read by the walls (context.js) and the road (ground.js). RENDER_TUNE.glPropShadow.
// ⚠ A SECOND MAP, NOT MORE CASTERS IN THE FIRST. The mass map is drawn again only when the mesh or
// the sun moves (sunKept in context.js); a person walking would redraw the whole city every frame.
// And the road can't read the mass map: it already has the hulls, so every building would shade
// the pavement twice. This map has no buildings in it, so the road reads it without counting any.
// ⚠ AND NEAR, NOT WHOLE. The mass map spans the window: 62 texels a tile from a cab and 28 from an
// aircraft. A lamp column is 0.016 of a tile across, a quarter of a texel there, so it would cast
// a dotted line or nothing. Over the ground in front of the eye the same 2048 gives about 100 from a cab.
// ⚠ BUILT ON THE CPU FROM THE RECORDS THE FRAME ALREADY HAS: a solid's `p`, a stroke's two ends, an
// actor's foot point. A few thousand triangles in one buffer and one draw. The solids and actors
// layers' own VAOs can't be borrowed: an actor is skinned from a texture in its vertex shader, and
// a stroke is expanded to a SCREEN width there, which from the sun is no width at all.
import { lightMatrix } from './camera.js';
import { compileShader } from './programs.js';

export const PROP_SHADOW_SIZE = 2048;
// Tiles of slack on the depth comparison, as SHADOW_BIAS_TILES. Smaller than the mass map's,
// because a post's shadow starts at its foot and a gap there reads as the post floating.
export const PROP_BIAS_TILES = 0.012;

// What is drawn into the map, and how. `near` is the box's half-size from a seat at the ground, in
// tiles; it grows with the eye's height, as a higher eye sees more ground (`perEye`) up to `far`.
// `ahead` puts the box's centre that share of the half-size in front of the eye.
// `wMin`/`wMax` clamp a stroke's world width: its pixel width over its depth gives the true width
// for a lamp (emitWire's own sum, inverted), but a far wire is widened to a pixel on screen, and
// that would be a plank of shadow on the road.
// `actorH`/`actorW`: a person, in metres, as a slab turned to face the sun. `top` is the box's
// ceiling in tiles: anything higher clips out of the map (an aircraft overhead).
export const PROP_SHADOW_TUNE = { near: 6, perEye: 10, far: 18, ahead: 0.55, wMin: 0.002, wMax: 0.016, actorH: 1.75, actorW: 0.5, top: 1.4, flat: 0.02 };

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightVP;
void main() { gl_Position = uLightVP * vec4(aPos, 1.0); }`;
const FRAG = `#version 300 es
precision mediump float;
void main() { }`;

// The read, for any program that wants it. 'uPropOn' is the off switch: 0 skips the four taps.
// Outside the box is lit, never shadowed, for the reason sunShadow in context.js gives.
// ⚠ NO SLOPE TERM. The receivers are the road, which faces up, and walls, which take the mass map's
// slope bias already; a post's shadow climbing a wall is a few texels, and acne there is not seen.
// ⚠ THE HOST DECLARES THE UNIFORMS, NOT THIS SNIPPET: glsl-smoke reads each file's own shaders and
// can't see into an import, as with the light grid. Every host carries these five lines:
//   uniform highp sampler2D uPropMap; uniform mat4 uPropVP; uniform float uPropOn;
//   uniform float uPropTexel; uniform float uPropBias;
export const PROP_SHADOW_GLSL = `
float propShadow(vec3 wp) {
  vec4 ls = uPropVP * vec4(wp, 1.0);
  vec3 p = ls.xyz * 0.5 + 0.5;
  float inside = (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) ? 0.0 : 1.0;
  float r = clamp(p.z - uPropBias, 0.0, 1.0);
  vec2 uv = clamp(p.xy, 0.0, 1.0);
  float t = uPropTexel;
  float s = step(r, textureLod(uPropMap, uv + vec2(-0.5, -0.5) * t, 0.0).r)
          + step(r, textureLod(uPropMap, uv + vec2( 0.5, -0.5) * t, 0.0).r)
          + step(r, textureLod(uPropMap, uv + vec2(-0.5,  0.5) * t, 0.0).r)
          + step(r, textureLod(uPropMap, uv + vec2( 0.5,  0.5) * t, 0.0).r);
  // Faded over the box's last tenth, so a shadow leaving the near field thins out rather than
  // stopping on a straight line across the road.
  float edge = clamp(min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)) * 10.0, 0.0, 1.0);
  float k = (1.0 - s * 0.25) * inside * edge;
  return k > 0.0 ? min(k, 1.0) : 0.0;
}
`;
export const PROP_SHADOW_UNIFORMS = ['uPropMap', 'uPropVP', 'uPropOn', 'uPropTexel', 'uPropBias'];

// Writes the read's uniforms. `P` is what render() returned, or null, and null is the exact off
// switch. The sampler is bound either way, to the map or to nothing, so it is never left pointing
// at a texture another pass is drawing into.
export function bindPropShadow(gl, loc, unit, P) {
  gl.uniform1f(loc.uPropOn, P ? 1 : 0);
  if (P) {
    gl.uniformMatrix4fv(loc.uPropVP, false, P.vp32);
    gl.uniform1f(loc.uPropTexel, P.texel);
    gl.uniform1f(loc.uPropBias, P.bias);
  }
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, P ? P.tex : null);
  gl.uniform1i(loc.uPropMap, unit);
  gl.activeTexture(gl.TEXTURE0);
}

// ── THE CASTERS ───────────────────────────────────────────────────────────────
// The box, in the map window's frame: the ground in front of the eye. `eye` is eyePos of the
// shifted camera; `fwd` the ground direction it looks along.
export function propBox(eye, fwd, T = PROP_SHADOW_TUNE) {
  const h = Math.min(T.far, T.near + Math.max(0, eye[2] || 0) * T.perEye);
  const cx = eye[0] + fwd[0] * h * T.ahead, cy = eye[1] + fwd[1] * h * T.ahead;
  return { x0: cx - h, x1: cx + h, y0: cy - h, y1: cy + h, z0: -0.02, z1: T.top };
}

const inBox = (b, x, y) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1;

// Triangles for every caster in the box, as xyz floats in the map window's frame. `buf` is reused.
//   solids:  lists of solid records ({ p: [[x,y,z]...] }), map window. Film, the room, the birds and
//            the cloth are skipped: see the ⚠s below.
//   strokes: { runs: [{ list, ox, oy }], vp, FL }: the stroke list cut where a retained group
//            carries its own shift (strokeRuns), the window camera's view-projection (for each end's
//            depth) and its focal length in the stroke widths' device pixels.
//   travel:  the light's travel direction, world, unit.
export function buildPropCasters(buf, box, { solids, strokes, travel }, T = PROP_SHADOW_TUNE) {
  let d = buf.data, o = 0;
  const need = (n) => {
    if (o + n <= d.length) return;
    const nd = new Float32Array(Math.max(o + n, d.length * 2));
    nd.set(d.subarray(0, o)); d = nd;
  };
  const put = (x, y, z) => { d[o] = x; d[o + 1] = y; d[o + 2] = z; o += 3; };
  // A slab from A to B, `hw` either side, turned square to the light so it casts its full width.
  const slab = (ax, ay, az, bx, by, bz, hw) => {
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    let px = ey * travel[2] - ez * travel[1], py = ez * travel[0] - ex * travel[2], pz = ex * travel[1] - ey * travel[0];
    const pl = Math.hypot(px, py, pz);
    if (pl < 1e-9) return;
    px *= hw / pl; py *= hw / pl; pz *= hw / pl;
    need(18);
    put(ax - px, ay - py, az - pz); put(ax + px, ay + py, az + pz); put(bx + px, by + py, bz + pz);
    put(ax - px, ay - py, az - pz); put(bx + px, by + py, bz + pz); put(bx - px, by - py, bz - pz);
  };
  let nSolid = 0, nStroke = 0, nActor = 0;
  for (const L of solids || []) {
    if (!L) continue;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      if (!q) continue;
      if (q.actor) {
        // ⚠ `s` IS TILES PER METRE (actors.js STRIDE), so a person is T.actorH of them tall.
        if (!(q.s > 0) || !inBox(box, q.x, q.y) || (q.a != null && q.a < 0.5)) continue;
        const z = q.z || 0;
        slab(q.x, q.y, z, q.x, q.y, z + T.actorH * q.s, T.actorW * 0.5 * q.s);
        nActor++;
        continue;
      }
      // ⚠ FILM IS SEE-THROUGH (a rotor disc), THE ROOM IS INSIDE THE NEAR PLANE, AND A BIRD, A CLOTH
      // OR A MURMURATION IS AN INSTANCE RECORD WITH NO `p`. Nothing else is filtered: a translucent
      // solid is a fading one, and its shadow fades with it below half.
      if (q.film || q.interior || q.inst || q.cloth || q.cloud) continue;
      const P = q.p;
      if (!P || P.length < 3 || (q.a != null && q.a < 0.5)) continue;
      const p0 = P[0];
      if (!inBox(box, p0[0], p0[1])) continue;
      // ⚠ A FACE THAT NEVER LEAVES THE GROUND CASTS NOTHING BUT ACNE. A kerb top, a plinth, a paving
      // slab lies within a hair of the road it would shade, and the bias can't separate them: it
      // came out as blotches all over a crossing. Above T.flat at one corner or it is skipped.
      let top = -1;
      for (let k = 0; k < P.length; k++) if (P[k][2] > top) top = P[k][2];
      if (top < T.flat) continue;
      need((P.length - 2) * 9);
      for (let k = 1; k + 1 < P.length; k++) {
        put(p0[0], p0[1], p0[2]); put(P[k][0], P[k][1], P[k][2]); put(P[k + 1][0], P[k + 1][1], P[k + 1][2]);
      }
      nSolid++;
    }
  }
  const S = strokes;
  if (S && S.runs && S.vp && S.FL > 0) {
    // `vp` is the WINDOW camera's (windowFrame in context.js), the frame every run is shifted into.
    const m = S.vp;
    const depth = (x, y, z) => m[3] * x + m[7] * y + m[11] * z + m[15];
    for (const run of S.runs) {
      const ox = run.ox || 0, oy = run.oy || 0;
      for (const st of run.list) {
        // ⚠ ONLY A PLAIN CORE CASTS. A halo (`glow`) and an additive stroke (`add`, the rainbow) are
        // light; a feathered core is a rain column; a lit neon tube is a light source.
        if (!st || !st.a || !st.b || st.add || st.glow > 0 || (st.feather > 0) || (st.alpha != null && st.alpha < 0.5)) continue;
        // The unpulled ends when the layer pulls in its shader (strokes.js putStroke).
        const A = st.pl > 0 ? st.ra : st.a, B = st.pl > 0 ? st.rb : st.b;
        // Lying on the ground, a crossing stripe or a kerb line, is paint: T.flat, as for a solid.
        if (A[2] < T.flat && B[2] < T.flat) continue;
        const ax = A[0] + ox, ay = A[1] + oy, bx = B[0] + ox, by = B[1] + oy;
        if (!inBox(box, ax, ay) && !inBox(box, bx, by)) continue;
        const f = Math.max(0.06, Math.min(depth(ax, ay, A[2]), depth(bx, by, B[2])));
        const w = Math.min(T.wMax, Math.max(T.wMin, (st.w || 1) * f / S.FL));
        slab(ax, ay, A[2], bx, by, B[2], w * 0.5);
        nStroke++;
      }
    }
  }
  buf.data = d;
  return { verts: o / 3, solids: nSolid, strokes: nStroke, actors: nActor };
}

// The stroke list as runs of one shift each: a retained group (`list.groups`) was sent in its own
// window and carries its own ox/oy, as splitGroups in context.js reads it; the rest take the frame's.
export function strokeRuns(list, ox, oy) {
  if (!list || !list.length) return [];
  const G = list.groups;
  if (!G || !G.length) return [{ list, ox, oy }];
  const runs = [], rest = [];
  let gi = 0;
  for (let i = 0; i < list.length; i++) {
    while (gi < G.length && G[gi].at < i) gi++;
    if (gi < G.length && G[gi].at === i) {
      const g = G[gi++], recs = g.recs, n = recs.length;
      if (n && i + n <= list.length && list[i] === recs[0] && list[i + n - 1] === recs[n - 1]) {
        runs.push({ list: recs, ox: g.ox == null ? ox : g.ox, oy: g.oy == null ? oy : g.oy });
        i += n - 1; continue;
      }
    }
    rest.push(list[i]);
  }
  if (rest.length) runs.push({ list: rest, ox, oy });
  return runs;
}

// ── THE MAP ───────────────────────────────────────────────────────────────────
// Every exit returns null, as in shadow.js: a map that half-exists samples undefined, which is a
// shadow everywhere.
export function createPropShadowLayer(gl, size = PROP_SHADOW_SIZE) {
  const dim = Math.min(size, gl.getParameter(gl.MAX_TEXTURE_SIZE) || size);
  let vs, fs;
  try {
    vs = compileShader(gl, gl.VERTEX_SHADER, VERT, 'prop shadow vertex');
    fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG, 'prop shadow fragment');
  } catch { return null; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const uLightVP = gl.getUniformLocation(prog, 'uLightVP');

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, dim, dim, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  // A plain depth read and NEAREST, for the ANGLE reason written in shadow.js.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return null; }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  let cap = 0;
  const buf = { data: new Float32Array(1 << 14) };
  const vp32 = new Float32Array(16);
  let last = null;

  // Builds and draws the map. Returns what the readers need, or null when nothing in the box casts
  // (and then the readers' four taps are skipped: an empty map would answer lit everywhere anyway).
  // Leaves the default framebuffer bound; the caller sets its own viewport after, as after sunPass.
  function render(sun, eye, fwd, casters) {
    const box = propBox(eye, fwd);
    const vp = lightMatrix(sun, box);
    // The light's travel direction is the matrix's third row, normalised (see lightMatrix).
    const tl = Math.hypot(vp[2], vp[6], vp[10]) || 1;
    const travel = [vp[2] / tl, vp[6] / tl, vp[10] / tl];
    const n = buildPropCasters(buf, box, { ...casters, travel });
    last = { ...n, box };
    if (!n.verts) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const bytes = n.verts * 12;
    if (bytes > cap) { cap = Math.max(bytes, cap * 2, 1 << 16); gl.bufferData(gl.ARRAY_BUFFER, cap, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.data, 0, n.verts * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, dim, dim);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);   // slabs and open solids, as shadow.js
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.0, 2.0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uLightVP, false, vp);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, n.verts);
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let i = 0; i < 16; i++) vp32[i] = vp[i];
    // The bias in this box's depth range, as sunShadowFor converts the mass map's.
    const span = Math.max(1, Math.hypot(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0));
    return { tex, vp32, texel: 1 / dim, bias: PROP_BIAS_TILES / span, size: dim, tris: n.verts / 3 };
  }
  return { render, size: dim, get last() { return last; } };
}
