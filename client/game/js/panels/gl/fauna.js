// BIRDS AS INSTANCED MESHES, THEIR WINGBEAT BAKED INTO A TEXTURE.
//
// The solids layer draws a bird the way it draws the rig: every vertex transformed on the CPU,
// fan-expanded, uploaded, every frame. At a 1,651-bird murmuration that was measured as three
// quarters of the whole bird cost — 4.1-4.5 ms in the per-bird loop building faces and ~3.5 ms of
// GL upload and draw, against 2.4 ms for the flock simulation itself. This layer moves the
// transform onto the GPU and hands over nine floats a bird instead of about a thousand.
//
// ⚠ THE POSES ARE NOT A SECOND MODEL. `faunaPoseBake` in fauna3d.js walks the same `faunaPose`
// cache the CPU path reads, fan-expanded exactly as solids.js expands it, so the instanced bird and
// the solids bird are the same triangles in the same colours. It was checked for every one of the
// 152 pose groups before this file was written: 0 vertices differ.
//
// ⚠ ONE MESH PER POSE GROUP — kind, id, state, flare, gear, tier — and the wingbeat is a TEXTURE ROW.
// Within a group only positions move; the topology is identical across all sixteen beat steps. The
// feet are the one part that adds faces, which is why gear is a group and not a row.
//
// ⚠ THE TRANSFORM IS faunaWorldFacesInto's, TERM FOR TERM. Heading, pitch and roll build the same
// F/S/U basis in the same order, so a bird cannot come out mirrored or banked the other way on the
// GPU. Read the note on that function before changing either.
//
// ⚠ AND THE SHADING IS solids.js's: flat colour, the same fog, premultiplied alpha, depth written,
// no culling. A bird drawn here and a bird drawn there must be indistinguishable in a still.
import { viewProjMatrix } from './camera.js';
import { makeVertexStream } from './stream.js';
import { faunaPoseSlot, faunaPoseBake } from '../fauna3d.js';
import { zRow, NEAR } from './camera.js';
import { LIGHT_PULL } from './sprites.js';

// Per instance: x, y, z, scale | heading, pitch, roll, row | alpha
const STRIDE = 9;
// A unit no other layer binds (0-5 are taken), so a pose texture can never be left where another
// layer expects its own — and never be read by a program whose target it is.
const UNIT = 7;
// The murmuration's state textures when drawing, 12-14: clear of the simulation's own 8-11 in
// gl/murmur-gpu.js, so neither pass can find a texture of the other's still bound where it samples.
const CLOUD_UNIT = 12;

const VERT = `#version 300 es
in vec3 aColor;
in vec4 iPos;
in vec4 iAng;
in float iAlpha;
uniform highp sampler2D uPose;
uniform mat4 uViewProj;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vColor;
out float vFog;
out float vAlpha;
void main() {
  vec3 m = texelFetch(uPose, ivec2(gl_VertexID, int(iAng.w + 0.5)), 0).xyz * iPos.w;
  float ch = cos(iAng.x), sh = sin(iAng.x);
  float cp = cos(iAng.y), sp = sin(iAng.y);
  float cr = cos(iAng.z), sr = sin(iAng.z);
  vec3 F = vec3(ch * cp, sh * cp, sp);
  vec3 S0 = vec3(-sh, ch, 0.0);
  vec3 U0 = vec3(-ch * sp, -sh * sp, cp);
  vec3 S = S0 * cr + U0 * sr;
  vec3 U = U0 * cr - S0 * sr;
  vec3 w = iPos.xyz + F * m.x + S * m.y + U * m.z;
  vec4 clip = uViewProj * vec4(w, 1.0);
  gl_Position = clip;
  vColor = aColor;
  vAlpha = iAlpha;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFog;
in float vAlpha;
uniform vec3 uFog;
out vec4 outColor;
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 c = mix(vColor, uFog, vFog);
  outColor = vec4(c * vAlpha, vAlpha);
}`;

// ── A MURMURATION, DRAWN STRAIGHT OUT OF THE GPU FLOCK'S TEXTURES ─────────────
//
// gl/murmur-gpu.js keeps every starling's position (with its roll) and velocity (with its visibility)
// in float textures. These two programs draw the flock from them with nothing read back to the CPU:
// one instanced draw per detail level, over EVERY bird, each vertex shader working out for its own
// bird what windshield.js's per-bird loop and pushFauna used to work out on the CPU — the camera-forward
// cull and the fade toward the draw limit, the bird's wingspan in pixels, which detail level that
// buys, the wingbeat row, the bank (its own roll plus the hawk's wave) — and collapsing to nothing if
// the bird belongs to another level. The numbers arrive in the record windshield.js pushes, so this
// file imports nothing from it.
//
// ⚠ THE DETAIL LADDER IS pushFauna's, WITHOUT ITS BUDGETS. On the CPU a bird that lost the mesh budget
// was demoted to a glyph or a dot; here a mesh costs a vertex shader and nothing is rationed, so every
// bird is drawn at the level its own size earns.
const CLOUD_HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPosT;
uniform highp sampler2D uVelT;
uniform highp sampler2D uStat0;
uniform mat4 uViewProj;
uniform vec2 uOrigin;
uniform vec4 uCull;        // cam ox, oy, sinh, cosh
uniform vec4 uCull2;       // fwdOff, near, far, alpha multiplier
uniform float uFL;
uniform float uSpan;
uniform vec4 uTierPx;      // glyph from, mesh from, glyph below, coarse below
uniform float uFarHi;
uniform vec4 uAgit;        // x, y, front, amplitude
uniform float uWaveW;
uniform vec2 uBank;        // bank per radian, bank max
const int TW = 64;
ivec2 at(int i) { return ivec2(i % TW, i / TW); }
float sstep(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
int tierOf(float px) {
  if (px < uTierPx.x) return 4;
  if (px < uTierPx.y) return 3;
  int t = 0;
  if (uFarHi > 0.0 && px < uFarHi) t = 1;
  if (px < uTierPx.w) t = 2;
  if (px < uTierPx.z) t = 3;
  return t;
}
// Everything both programs need about one bird. ok = false collapses it.
struct Bird { bool ok; vec3 w; float a; float px; float heading; float roll; float beat; };
Bird bird(int id, int wantTier) {
  Bird b; b.ok = false;
  ivec2 t = at(id);
  vec4 P = texelFetch(uPosT, t, 0), V = texelFetch(uVelT, t, 0);
  if (V.w <= 0.0) return b;
  vec3 w = vec3(P.xy - uOrigin, P.z);
  float f = (w.x - uCull.x) * uCull.z - (w.y - uCull.y) * uCull.w;
  if (f + uCull2.x <= uCull2.y || f > uCull2.z) return b;
  float a = sstep((uCull2.z - f) / 5.0) * uCull2.w * V.w;
  if (a <= 0.03) return b;
  // ⚠ THE DEPTH cam.proj DIVIDES BY, NOT THE CLIP w. pushFauna sizes a bird as FL x span / pr.f, and
  // pr.f is the craft-forward distance plus the camera's own offset. The clip-space w of the GL matrix
  // is not that number, and using it sized birds differently from the CPU: measured, the GPU sent
  // birds at five tiles to mesh tiers the CPU drew as dots.
  float fe = f + uCull2.x;
  float px = fe > 0.07 ? uFL * uSpan / fe : 0.0;
  int tier = fe > 0.07 ? tierOf(px) : 0;
  if (tier != wantTier) return b;
  float ag = 0.0;
  if (uAgit.w > 0.0) {
    float u = (distance(P.xy, uAgit.xy) - uAgit.z) / uWaveW;
    if (u >= -3.0 && u <= 3.0) ag = uAgit.w * exp(-u * u);
  }
  b.ok = true; b.w = w; b.a = a; b.px = px;
  b.heading = atan(V.y, V.x);
  b.roll = clamp((P.w + ag) * uBank.x, -uBank.y, uBank.y);
  b.beat = texelFetch(uStat0, t, 0).w;
  return b;
}
`;

const VERT_CLOUD = CLOUD_HEAD + `
layout(location = 0) in vec3 aColor;
uniform highp sampler2D uPose;
uniform int uTier;
uniform float uBeatBase;
uniform float uPitch;
uniform float uScale;
uniform vec2 uMinPx;       // faunaMinPx, faunaMinFade
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vColor; out float vFog; out float vAlpha;
void main() {
  Bird b = bird(gl_InstanceID, uTier);
  if (!b.ok) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); vFog = 0.0; return; }
  float scale = uScale, a = b.a;
  if (uMinPx.x > 0.0 && b.px > 0.0 && b.px < uMinPx.x) {
    float mag = uMinPx.x / b.px;
    scale *= mag; a *= 1.0 - uMinPx.y + uMinPx.y / mag;
  }
  int row = int(floor(fract(uBeatBase + b.beat) * 16.0));
  vec3 m = texelFetch(uPose, ivec2(gl_VertexID, row), 0).xyz * scale;
  float ch = cos(b.heading), sh = sin(b.heading), cp = cos(uPitch), sp = sin(uPitch), cr = cos(b.roll), sr = sin(b.roll);
  vec3 F = vec3(ch * cp, sh * cp, sp), S0 = vec3(-sh, ch, 0.0), U0 = vec3(-ch * sp, -sh * sp, cp);
  vec3 S = S0 * cr + U0 * sr, U = U0 * cr - S0 * sr;
  vec4 clip = uViewProj * vec4(b.w + F * m.x + S * m.y + U * m.z, 1.0);
  gl_Position = clip;
  vColor = aColor; vAlpha = a;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const VERT_DOT = CLOUD_HEAD + `
uniform vec2 uViewport;
uniform vec2 uAB;
uniform float uPull;
uniform float uDpr;
uniform float uFlash;
uniform vec3 uFlashK;      // floor, bank share, area share
uniform vec2 uInk;         // smallest radius in device px, soft/hard ink gain
out vec2 vCorner; out float vAlpha;
const vec2 CORNERS[6] = vec2[6](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
void main() {
  Bird b = bird(gl_InstanceID, 4);
  vCorner = CORNERS[gl_VertexID];
  if (!b.ok) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  // the flash: a bird broadside to you and banking shows more wing (pushFauna's dot branch)
  float along = cos(b.heading) * uCull.z - sin(b.heading) * uCull.w;
  float broad = sqrt(max(0.0, 1.0 - along * along));
  float shown = broad * (1.0 - uFlashK.y + uFlashK.y * abs(sin(b.roll)));
  float dim = uFlash > 0.0 ? (1.0 - uFlash) + uFlash * (uFlashK.x + (1.0 - uFlashK.x) * shown) : 1.0;
  float area = uFlash > 0.0 ? 1.0 - uFlash * uFlashK.z + uFlash * uFlashK.z * (0.55 + 0.9 * shown) : 1.0;
  // ink conserved: drawn wide enough to reach a pixel centre, faint by the area it was given
  float rTrue = b.px * 0.30 * area;
  float R = max(rTrue, uInk.x / uDpr);
  vAlpha = b.a * dim * min(1.0, (rTrue * rTrue) / (R * R) * uInk.y);
  vec4 clip = uViewProj * vec4(b.w, 1.0);
  clip.xy += vCorner * (2.0 * R * uDpr / uViewport) * clip.w;
  float fp = max(0.02, clip.w - uPull);
  clip.z = (uAB.x + uAB.y / fp) * clip.w;
  gl_Position = clip;
}`;

const FRAG_DOT = `#version 300 es
precision highp float;
in vec2 vCorner; in float vAlpha;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  float d = length(vCorner);
  if (d > 1.0 || vAlpha <= 0.002) discard;
  float a = vAlpha * pow(max(0.0, 1.0 - d), 1.8);   // sprites.js's soft profile
  outColor = vec4(uColor * a, a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' fauna shader: ' + log);
  }
  return sh;
}

export function createFaunaLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('fauna link: ' + gl.getProgramInfoLog(prog));
  const loc = {
    color: gl.getAttribLocation(prog, 'aColor'),
    pos: gl.getAttribLocation(prog, 'iPos'),
    ang: gl.getAttribLocation(prog, 'iAng'),
    alpha: gl.getAttribLocation(prog, 'iAlpha'),
    pose: gl.getUniformLocation(prog, 'uPose'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
  };
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;

  // group key -> { vao, stream, tex, verts, rows, n } ; null for a group that would not bake.
  // Bounded by the pose table (152 groups today), so it is never evicted.
  const groups = new Map();
  let data = new Float32Array(1 << 10);
  let live = [];          // the groups with instances this frame, in the order they are drawn
  let instances = 0, skipped = 0;

  function groupFor(kind, id, state, flare, gear, far, key) {
    if (groups.has(key)) return groups.get(key);
    const bake = faunaPoseBake(kind, id, state, flare, gear, far);
    if (!bake || bake.verts > maxTex) { groups.set(key, null); return null; }
    const vao = gl.createVertexArray();
    // The colours are per VERTEX and constant for the group, so they are uploaded once, here.
    const col = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, col);
    gl.bufferData(gl.ARRAY_BUFFER, bake.rgb, gl.STATIC_DRAW);
    if (loc.color >= 0) { gl.enableVertexAttribArray(loc.color); gl.vertexAttribPointer(loc.color, 3, gl.FLOAT, false, 12, 0); }
    gl.bindVertexArray(null);
    const stream = makeVertexStream(gl, vao, STRIDE, [[loc.pos, 4, 0], [loc.ang, 4, 16], [loc.alpha, 1, 32]], 576);   // 64 birds
    // ⚠ ONE ADVANCE PER INSTANCE, NOT PER VERTEX. The stream records the pointers into the VAO; the
    // divisor is VAO state too, so it is set once, here, with the VAO bound.
    gl.bindVertexArray(vao);
    for (const l of [loc.pos, loc.ang, loc.alpha]) if (l >= 0) gl.vertexAttribDivisor(l, 1);
    gl.bindVertexArray(null);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, bake.verts, bake.rows, 0, gl.RGBA, gl.FLOAT, bake.pos);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const g = { vao, stream, tex, col, verts: bake.verts, rows: bake.rows, n: 0, list: [], cloudVao: null };
    groups.set(key, g);
    return g;
  }

  /**
   * Take this frame's instance records. Each is { kind, sp, state, beat, flare, gear, far, x, y, z,
   * heading, pitch, roll, scale, a } — the arguments faunaWorldFacesInto would have been given.
   */
  function upload(recs) {
    for (const g of live) { g.n = 0; g.list.length = 0; }
    live = [];
    instances = 0; skipped = 0;
    if (!recs || !recs.length) return 0;
    for (const r of recs) {
      const slot = faunaPoseSlot(r.kind || 'bird', r.sp, r.state, r.beat, r.flare, r.gear, r.far);
      const g = groupFor(r.kind || 'bird', r.sp, r.state, r.flare, r.gear, r.far, slot.group);
      if (!g) { skipped++; continue; }
      if (!g.n) live.push(g);
      g.n++;
      g.list.push(r, slot.row);
    }
    for (const g of live) {
      const floats = g.n * STRIDE;
      if (data.length < g.n * STRIDE) data = new Float32Array(Math.max(floats, data.length * 2));
      let o = 0;
      for (let i = 0; i < g.list.length; i += 2) {
        const r = g.list[i], row = g.list[i + 1];
        data[o] = r.x; data[o + 1] = r.y; data[o + 2] = r.z; data[o + 3] = r.scale;
        data[o + 4] = r.heading || 0; data[o + 5] = r.pitch || 0; data[o + 6] = r.roll || 0; data[o + 7] = row;
        data[o + 8] = r.a == null ? 1 : r.a;
        o += STRIDE;
      }
      g.stream.write(data, floats);
      instances += g.n;
    }
    return instances;
  }

  function draw(cam, cssH, opts = {}) {
    if (!instances) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, viewProjMatrix(cam, cssH, opts.near, opts.far));
    const f = opts.fog;
    gl.uniform3f(loc.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(loc.fogNear, f ? f.near : 1e9);
    gl.uniform1f(loc.fogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(loc.fogAmt, f ? f.amt : 0);
    gl.uniform1i(loc.pose, UNIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let tris = 0;
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    for (const g of live) {
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.bindVertexArray(g.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, g.verts, g.n);
      tris += (g.verts / 3) * g.n;
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return tris;
  }

  // ── the cloud programs, built on first use ──
  let cp = null;
  function cloudProgs() {
    if (cp) return cp;
    const link = (v, fr, label) => {
      const pr = gl.createProgram();
      gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, v, label + ' vertex'));
      gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, fr, label + ' fragment'));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(label + ' link: ' + gl.getProgramInfoLog(pr));
      const u = {};
      const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(pr, i).name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(pr, nm); }
      return { pr, u };
    };
    cp = { mesh: link(VERT_CLOUD, FRAG, 'cloud mesh'), dot: link(VERT_DOT, FRAG_DOT, 'cloud dot'), dotVao: gl.createVertexArray() };
    return cp;
  }
  function cloudVaoOf(g) {
    if (g.cloudVao) return g.cloudVao;
    g.cloudVao = gl.createVertexArray();
    gl.bindVertexArray(g.cloudVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.col);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    return g.cloudVao;
  }
  // the uniforms both cloud programs share, set per cloud
  function cloudCommon(u, r, st, vp) {
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform2f(u.uOrigin, r.origin[0], r.origin[1]);
    gl.uniform4f(u.uCull, r.camO[0], r.camO[1], r.sc[0], r.sc[1]);
    gl.uniform4f(u.uCull2, r.fwdOff, r.nearF, r.farF, r.alphaMul);
    gl.uniform1f(u.uFL, r.FL);
    gl.uniform1f(u.uSpan, r.span);
    gl.uniform4f(u.uTierPx, r.tiers.glyphPx, r.tiers.thr, r.tiers.glyphHi, r.tiers.coarseHi);
    gl.uniform1f(u.uFarHi, r.tiers.farHi);
    const ag = r.agit;
    gl.uniform4f(u.uAgit, ag ? ag.x : 0, ag ? ag.y : 0, ag ? ag.front : 0, ag ? ag.amp : 0);
    gl.uniform1f(u.uWaveW, r.waveW);
    gl.uniform2f(u.uBank, r.bank[0], r.bank[1]);
    const tex = (unit, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[name], unit); };
    tex(CLOUD_UNIT, st.pos, 'uPosT');
    tex(CLOUD_UNIT + 1, st.vel, 'uVelT');
    tex(CLOUD_UNIT + 2, st.stat0, 'uStat0');
  }

  /**
   * Draw this frame's murmurations. `list` is [{ rec, st }] — the record windshield.js pushed and the
   * GPU flock's textures for it. Meshes first (they write depth, like solids), then the dots (tested,
   * writing none, like sprites).
   */
  function drawClouds(cam, cssH, W, H, opts, list) {
    if (!list || !list.length) return 0;
    const P = cloudProgs();
    const vp = viewProjMatrix(cam, cssH, opts.near, opts.far);
    const f = opts.fog;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let drawn = 0;
    // meshes
    gl.useProgram(P.mesh.pr);
    gl.depthMask(true);
    const um = P.mesh.u;
    gl.uniform3f(um.uFog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(um.uFogNear, f ? f.near : 1e9);
    gl.uniform1f(um.uFogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(um.uFogAmt, f ? f.amt : 0);
    for (const { rec: r, st } of list) {
      cloudCommon(um, r, st, vp);
      gl.uniform1f(um.uBeatBase, r.beatBase);
      gl.uniform1f(um.uPitch, r.pitch);
      gl.uniform1f(um.uScale, r.scale);
      gl.uniform2f(um.uMinPx, r.minPx[0], r.minPx[1]);
      for (const tier of [0, 1, 2, 3]) {
        if (tier === 1 && !(r.tiers.farHi > 0)) continue;
        const slot = faunaPoseSlot('bird', r.sp, 'air', 0, r.flare, r.gear, tier);
        const g = groupFor('bird', r.sp, 'air', r.flare, r.gear, tier, slot.group);
        if (!g) continue;
        gl.uniform1i(um.uTier, tier);
        gl.activeTexture(gl.TEXTURE0 + UNIT);
        gl.bindTexture(gl.TEXTURE_2D, g.tex);
        gl.uniform1i(um.uPose, UNIT);
        gl.bindVertexArray(cloudVaoOf(g));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, g.verts, st.n);
        drawn++;
      }
    }
    // dots
    gl.useProgram(P.dot.pr);
    gl.depthMask(false);
    const ud = P.dot.u;
    const zr = zRow((cam && cam.near) || NEAR);
    gl.uniform2f(ud.uViewport, W, H);
    gl.uniform2f(ud.uAB, zr[0], zr[1]);
    gl.uniform1f(ud.uPull, LIGHT_PULL);
    gl.bindVertexArray(P.dotVao);
    for (const { rec: r, st } of list) {
      cloudCommon(ud, r, st, vp);
      gl.uniform1f(ud.uDpr, r.dpr);
      gl.uniform1f(ud.uFlash, r.flash);
      gl.uniform3f(ud.uFlashK, r.flashK[0], r.flashK[1], r.flashK[2]);
      gl.uniform2f(ud.uInk, r.ink[0], r.ink[1]);
      gl.uniform3f(ud.uColor, r.dot[0] / 255, r.dot[1] / 255, r.dot[2] / 255);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, st.n);
      drawn++;
    }
    gl.depthMask(true);
    gl.bindVertexArray(null);
    for (const k of [UNIT, CLOUD_UNIT, CLOUD_UNIT + 1, CLOUD_UNIT + 2]) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.activeTexture(gl.TEXTURE0);
    return drawn;
  }

  return {
    upload, draw, drawClouds,
    get instances() { return instances; },
    get skipped() { return skipped; },
    get groups() { return groups.size; },
  };
}
