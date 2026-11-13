// THE STREET LAMPS, ON WHAT STANDS UNDER THEM. RENDER_TUNE.glLampShadow.
// A lamp lays a pool on the road (poolLight in ground.js), and until this nothing stood in it: a
// person under a lamp at night lit the tarmac at their feet as brightly as the empty kerb. This
// draws a depth map straight down from each of the few strongest lamps near the eye, and the
// ground takes the shadowed share of that lamp's pool back out.
// ⚠ SUBTRACTED, NOT MASKED. The pool loop sums every light in the cell (the light grid) or the list,
// and has no idea which of them has a map. So the shader adds every pool as it did, then takes away
// (1 - lit) of each mapped lamp's own pool, worked out by the same poolLight. A lamp that isn't in
// the sum can't be one of these: they are picked from the list the pool reads (`lampShadowFor` in
// world.js), and the sum is clamped at zero for the fringe the grid didn't bin.
// ⚠ PLAIN DEPTH SAMPLERS, AS gl/propshadow.js, NOT spotshadow.js's sampler2DShadow. A shadow sampler
// makes every draw of the host illegal unless a compare-mode texture sits on its own unit, on or
// off (the ballpark keeps a 1x1 set for that). The road draws on every machine, phones included,
// and with these off it samples nothing at all.
// ⚠ ONE CASTER BUFFER FOR EVERY LAMP. buildPropCasters is run once with no light direction, so each
// slab is an X and casts from any side; the maps differ only in their matrices.
import { perspective, lookAt, mul4 } from '../diamond/camera.js';
import { buildPropCasters, keptArena, keptGroupsIn, PROP_SHADOW_TUNE } from './propshadow.js';
import { compileShader } from './programs.js';

// ⚠ Four, and the shader's if-chain below has exactly four arms: a sampler array can only be indexed
// with a constant in GLSL ES 3.00.
export const LAMP_SHADOW_MAX = 4;
export const LAMP_SHADOW_SIZE = 1024;

// `reach`: the map covers the ground out to this many lamp heights from the lamp's foot. The pool is
//   3% of its peak there (h^3 / (d^2 + h^2)^1.5), so a shadow ending at the edge ends in the dark.
// `minH`: a light lower than this many tiles is a doorway lamp or a sign at head height, whose pool
//   is the size of a doormat; it isn't worth a map.
// `minPeak`: the pool's peak, as the shader's poolLum times the inverse-square cap above a lamp
//   head, below which a lamp isn't picked. A neon sign pools nothing (POOL_NEON 0) and drops out here.
// `far`: tiles from the eye past which no lamp is picked; `farFade` is the share of that over which
//   a lamp's shadow thins out first, so walking away from a lamp never switches its shadow off.
// `fade`: how close the next lamp down may come before the fourth one's shadow starts to thin. The
//   strength goes as (score - next) / (fade * score), so a lamp losing its place fades rather than pops.
// `near`: tiles below the lamp where the map starts, so the lamp's own head and arm aren't in it.
// `soft`: the read's disc radius in texels. 3 is about 10 cm under a lamp 6 m up: a lamp head is
//   half a metre across and a hard edge reads as a spotlight.
// `bias`: on the depth comparison, in the map's depth units. Looking straight down, the road sits at
//   one view depth everywhere, so one constant serves the whole map (about 2 cm at the ground).
export const LAMP_SHADOW_TUNE = { reach: 3, minH: 0.12, minPeak: 0.05, far: 14, farFade: 0.3, fade: 0.25, near: 0.04, soft: 3, bias: 0.0006 };

// The shader's poolLum, for picking: luminance, and nothing for a saturated colour (POOL_NEON 0).
const poolLum = (c) => {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  const sat = mx > 1e-5 ? (mx - mn) / mx : 0;
  const t = Math.min(1, Math.max(0, (sat - 0.15) / 0.2));
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) * (1 - t * t * (3 - 2 * t));
};

// Up to LAMP_SHADOW_MAX lamps from `lights` (the records the pool reads), strongest near the eye
// first, each with its weight `w` (0..1). `eye` is in the lights' frame. Pure, for the gate.
export function pickShadowLamps(lights, eye, T = LAMP_SHADOW_TUNE) {
  if (!lights || !lights.length || !eye) return [];
  const cand = [];
  for (const L of lights) {
    if (!L || !L.p || L.wash) continue;
    const h = L.p[2];
    if (!(h >= T.minH)) continue;
    const c = L.rgbRaw || L.rgb;
    if (!c) continue;
    const peak = Math.min(1, (0.33 * 0.33) / (h * h)) * poolLum(c);
    if (!(peak >= T.minPeak)) continue;
    const d = Math.hypot(L.p[0] - eye[0], L.p[1] - eye[1]);
    if (d >= T.far) continue;
    // The score falls with distance in lamp heights, so a tall lamp a little further off still wins.
    const k = d / Math.max(h, 0.05);
    cand.push({ L, d, score: peak / (1 + 0.05 * k * k) });
  }
  if (!cand.length) return [];
  cand.sort((a, b) => b.score - a.score);
  const next = cand.length > LAMP_SHADOW_MAX ? cand[LAMP_SHADOW_MAX].score : 0;
  const out = [];
  for (let i = 0; i < Math.min(LAMP_SHADOW_MAX, cand.length); i++) {
    const { L, d, score } = cand[i];
    const rank = next > 0 ? Math.min(1, Math.max(0, (score - next) / (T.fade * score))) : 1;
    const dist = Math.min(1, Math.max(0, (T.far - d) / (T.far * T.farFade)));
    const w = rank * dist;
    if (w > 0.001) out.push({ p: L.p, c: L.rgbRaw || L.rgb, w });
  }
  return out;
}

// The map's view-projection: straight down from the lamp, a square cone wide enough for `reach`
// lamp heights, from `near` under the lamp to just past the ground.
export function lampMatrix(p, T = LAMP_SHADOW_TUNE) {
  const h = Math.max(0.05, p[2]);
  const fov = 2 * Math.atan(T.reach * 1.05) * 180 / Math.PI;
  const n = Math.min(T.near, h * 0.5);
  return mul4(perspective(fov, 1, n, h + 0.05), lookAt([p[0], p[1], p[2]], [p[0], p[1], p[2] - 1]));
}

// The ground the chosen lamps light, as buildPropCasters' box.
export function lampBox(lamps, T = LAMP_SHADOW_TUNE) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = 0;
  for (const l of lamps) {
    const r = T.reach * Math.max(0.05, l.p[2]);
    x0 = Math.min(x0, l.p[0] - r); x1 = Math.max(x1, l.p[0] + r);
    y0 = Math.min(y0, l.p[1] - r); y1 = Math.max(y1, l.p[1] + r);
    z1 = Math.max(z1, l.p[2]);
  }
  return { x0, x1, y0, y1, z0: -0.02, z1 };
}

const VERT = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightVP;
void main() { gl_Position = uLightVP * vec4(aPos, 1.0); }`;
const FRAG = `#version 300 es
precision mediump float;
void main() { }`;

// The read. `lampShadow(i, p)` is 1 lit and 0 in shadow for map i at the world point p, 1 off the map.
// ⚠ THE HOST DECLARES THE UNIFORMS, as for PROP_SHADOW_GLSL. Every host carries these lines:
//   uniform highp sampler2D uLshMap0; uniform highp sampler2D uLshMap1;
//   uniform highp sampler2D uLshMap2; uniform highp sampler2D uLshMap3;
//   uniform mat4 uLshVP[4]; uniform vec3 uLshP[4]; uniform vec3 uLshC[4]; uniform float uLshW[4];
//   uniform int uNLsh; uniform float uLshTexel; uniform float uLshBias;
export const LAMP_SHADOW_GLSL = `
const vec2 LSH_PD[8] = vec2[8](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893));
float lshRead(highp sampler2D m, mat4 M, vec3 wp) {
  vec4 c = M * vec4(wp, 1.0);
  if (c.w <= 0.0) return 1.0;
  vec3 q = c.xyz / c.w * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  float r = q.z - uLshBias, s = 0.0;
  for (int k = 0; k < 8; k++) s += step(r, textureLod(m, q.xy + LSH_PD[k] * uLshTexel, 0.0).r);
  return s * 0.125;
}
float lampShadow(int i, vec3 wp) {
  if (i == 0) return lshRead(uLshMap0, uLshVP[0], wp);
  if (i == 1) return lshRead(uLshMap1, uLshVP[1], wp);
  if (i == 2) return lshRead(uLshMap2, uLshVP[2], wp);
  if (i == 3) return lshRead(uLshMap3, uLshVP[3], wp);
  return 1.0;
}
`;
export const LAMP_SHADOW_UNIFORMS = ['uLshMap0', 'uLshMap1', 'uLshMap2', 'uLshMap3', 'uLshVP', 'uLshP', 'uLshC', 'uLshW', 'uNLsh', 'uLshTexel', 'uLshBias'];

// Writes the read's uniforms from what render() returned, or null, which is the exact off switch
// (uNLsh 0 and no sampling). The samplers are bound either way, to the maps or to nothing, on four
// units from `unit`, so none is left pointing at a texture another pass is drawing into.
export function bindLampShadow(gl, loc, unit, F) {
  const n = F ? F.n : 0;
  gl.uniform1i(loc.uNLsh, n);
  if (n) {
    gl.uniformMatrix4fv(loc.uLshVP, false, F.vp);
    gl.uniform3fv(loc.uLshP, F.P);
    gl.uniform3fv(loc.uLshC, F.C);
    gl.uniform1fv(loc.uLshW, F.W);
    gl.uniform1f(loc.uLshTexel, F.texel);
    gl.uniform1f(loc.uLshBias, F.bias);
  }
  for (let i = 0; i < LAMP_SHADOW_MAX; i++) {
    gl.activeTexture(gl.TEXTURE0 + unit + i);
    gl.bindTexture(gl.TEXTURE_2D, i < n ? F.tex[i] : null);
    gl.uniform1i(loc['uLshMap' + i], unit + i);
  }
  gl.activeTexture(gl.TEXTURE0);
}

// ── THE MAPS ──────────────────────────────────────────────────────────────────
// Every exit returns null, as in propshadow.js.
export function createLampShadowLayer(gl, size = LAMP_SHADOW_SIZE) {
  const dim = Math.min(size, gl.getParameter(gl.MAX_TEXTURE_SIZE) || size);
  let vs, fs;
  try {
    vs = compileShader(gl, gl.VERTEX_SHADER, VERT, 'lamp shadow vertex');
    fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG, 'lamp shadow fragment');
  } catch { return null; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const uLightVP = gl.getUniformLocation(prog, 'uLightVP');

  const maps = [];
  for (let i = 0; i < LAMP_SHADOW_MAX; i++) {
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
    if (!ok) {
      gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
      for (const m of maps) { gl.deleteFramebuffer(m.fbo); gl.deleteTexture(m.tex); }
      return null;
    }
    maps.push({ tex, fbo });
  }

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
  const VP = new Float32Array(16 * LAMP_SHADOW_MAX);
  const P = new Float32Array(3 * LAMP_SHADOW_MAX), C = new Float32Array(3 * LAMP_SHADOW_MAX), Wt = new Float32Array(LAMP_SHADOW_MAX);
  const texs = maps.map((m) => m.tex);
  // The street kit's casters stay on the GPU, as in propshadow.js (keptGroupsIn).
  const arena = keptArena(gl);
  let last = null;

  // Builds the casters once and draws one map per lamp. `lamps` is pickShadowLamps' answer, `k` the
  // strength. Returns what the readers need, or null when there's nothing to draw. Leaves the
  // default framebuffer bound; the caller sets its own viewport after, as after propPass.
  function render(lamps, casters, k = 1) {
    last = null;
    if (!lamps || !lamps.length || !(k > 0)) return null;
    const n = Math.min(LAMP_SHADOW_MAX, lamps.length);
    const box = lampBox(lamps.slice(0, n));
    const keep = PROP_SHADOW_TUNE.keep >= 2;
    const built = buildPropCasters(buf, box, { ...casters, kept: keep ? null : casters.kept, travel: null });
    const runs = keep ? arena.retain(keptGroupsIn(casters.kept, box)) : null;
    const kv = runs ? arena.verts : 0;
    last = { ...built, kept: kv, lamps: n, box };
    if (!built.verts && !kv) return null;
    if (built.verts) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      const bytes = built.verts * 12;
      if (bytes > cap) { cap = Math.max(bytes, cap * 2, 1 << 16); gl.bufferData(gl.ARRAY_BUFFER, cap, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.data, 0, built.verts * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    gl.viewport(0, 0, dim, dim);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.0, 2.0);
    gl.useProgram(prog);
    for (let i = 0; i < n; i++) {
      const l = lamps[i], m = lampMatrix(l.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, maps[i].fbo);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uLightVP, false, m);
      if (kv) { gl.bindVertexArray(arena.vao); for (const r of runs) gl.drawArrays(gl.TRIANGLES, r[0], r[1]); }
      if (built.verts) { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, built.verts); }
      VP.set(m, i * 16);
      P[i * 3] = l.p[0]; P[i * 3 + 1] = l.p[1]; P[i * 3 + 2] = l.p[2];
      C[i * 3] = l.c[0]; C[i * 3 + 1] = l.c[1]; C[i * 3 + 2] = l.c[2];
      Wt[i] = Math.min(1, l.w * k);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { n, tex: texs, vp: VP, P, C, W: Wt, texel: LAMP_SHADOW_TUNE.soft / dim, bias: LAMP_SHADOW_TUNE.bias, size: dim, tris: (built.verts + kv) / 3 };
  }
  return { render, size: dim, get last() { return last; } };
}
