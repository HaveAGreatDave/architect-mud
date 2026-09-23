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

// Per instance: x, y, z, scale | heading, pitch, roll, row | alpha
const STRIDE = 9;
// A unit no other layer binds (0-5 are taken), so a pose texture can never be left where another
// layer expects its own — and never be read by a program whose target it is.
const UNIT = 7;

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
    const g = { vao, stream, tex, verts: bake.verts, rows: bake.rows, n: 0, list: [] };
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

  return {
    upload, draw,
    get instances() { return instances; },
    get skipped() { return skipped; },
    get groups() { return groups.size; },
  };
}
