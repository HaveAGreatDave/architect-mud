// Stands hands, the 3-D half: a small WebGL renderer for what you hold in a box's suite
// (stands-hands.js). Meshes are lathed, extruded or swept once and kept; every draw is one mesh
// under one matrix with one material, lit by a warm key, a cool fill and a made-up room for the
// chrome and glass to reflect. The camera sits at the origin looking down -Z, in centimetres,
// so a thing's place on screen and its size there both come from how far away it's held.

// ── matrices (column-major) ──────────────────────────────────────────────────
export const I = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
export function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export const M = (...ms) => ms.reduce((a, b) => mul(a, b), I());
export const T = (x, y, z) => { const m = I(); m[12] = x; m[13] = y; m[14] = z; return m; };
export const S = (x, y = x, z = x) => { const m = I(); m[0] = x; m[5] = y; m[10] = z; return m; };
export const RX = (a) => { const m = I(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
export const RY = (a) => { const m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; };
export const RZ = (a) => { const m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; };
// a rotation taking +Y onto the direction d
export function alignY(d) {
  const l = Math.hypot(...d), y = d.map((v) => v / l);
  const ref = Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let x = [y[1] * ref[2] - y[2] * ref[1], y[2] * ref[0] - y[0] * ref[2], y[0] * ref[1] - y[1] * ref[0]];
  const xl = Math.hypot(...x); x = x.map((v) => v / xl);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const m = I();
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2]; m[4] = y[0]; m[5] = y[1]; m[6] = y[2]; m[8] = z[0]; m[9] = z[1]; m[10] = z[2];
  return m;
}
export const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
function normalMat(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-9;
  // the inverse transpose of the upper 3x3
  return new Float32Array([
    A / det, B / det, C / det,
    -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
    (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det,
  ]);
}

// ── geometry ─────────────────────────────────────────────────────────────────
// Each builder returns { p, n } as flat triangle lists.
// A lathe turns a profile of [r, y] about Y. Between segments meeting at more than about 40°
// the crease stays hard; otherwise the normals are averaged. `wave` ruffles the radius by angle.
export function lathe(prof, seg = 40, { wave = null, smooth = true } = {}) {
  const p = [], n = [];
  const segN = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1], l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
  }
  const vn = (i, at) => {   // the normal at profile point `at` (0 start, 1 end) of segment i
    const own = segN[i], j = at ? i + 1 : i - 1, other = segN[j];
    if (!smooth || !other || own[0] * other[0] + own[1] * other[1] < 0.77) return own;
    const x = own[0] + other[0], y = own[1] + other[1], l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  for (let i = 0; i < prof.length - 1; i++) {
    const n0 = vn(i, 0), n1 = vn(i, 1);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const rw = (r, a) => (wave ? r * (1 + wave.amp * Math.sin(a * wave.n)) : r);
      const P = (r, y, a) => [rw(r, a) * Math.cos(a), y, rw(r, a) * Math.sin(a)];
      const N = (q, a) => [q[0] * Math.cos(a), q[1], q[0] * Math.sin(a)];
      const v = [P(prof[i][0], prof[i][1], a0), P(prof[i][0], prof[i][1], a1), P(prof[i + 1][0], prof[i + 1][1], a1), P(prof[i + 1][0], prof[i + 1][1], a0)];
      const w = [N(n0, a0), N(n0, a1), N(n1, a1), N(n1, a0)];
      for (const q of [0, 2, 1, 0, 3, 2]) { p.push(...v[q]); n.push(...w[q]); }
    }
  }
  return { p, n };
}
// A rounded rectangle w (x) by d (z), extruded from y0 to y1, with both ends capped.
export function rprism(w, d, y0, y1, r, seg = 6) {
  const out = [];
  const cs = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI], [w / 2 - r, -d / 2 + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of cs) for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * Math.PI / 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
  const p = [], n = [];
  for (let i = 0; i < out.length; i++) {
    const A = out[i], B = out[(i + 1) % out.length];
    const v = [[A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]]];
    const w2 = [[A[2], 0, A[3]], [B[2], 0, B[3]], [B[2], 0, B[3]], [A[2], 0, A[3]]];
    for (const q of [0, 2, 1, 0, 3, 2]) { p.push(...v[q]); n.push(...w2[q]); }
    p.push(0, y1, 0, B[0], y1, B[1], A[0], y1, A[1]); n.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    p.push(0, y0, 0, A[0], y0, A[1], B[0], y0, B[1]); n.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
  }
  return { p, n };
}
// A tube swept along a path of [x, y, z, r].
export function tube(path, seg = 10) {
  const p = [], n = [];
  const frames = path.map((q, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(...t) || 1; t = t.map((v) => v / tl);
    const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]; const ul = Math.hypot(...u); u = u.map((v) => v / ul);
    const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    return { q, u, v };
  });
  const ring = (f, k) => { const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); const nn = [f.u[0] * c + f.v[0] * s, f.u[1] * c + f.v[1] * s, f.u[2] * c + f.v[2] * s]; return [[f.q[0] + nn[0] * f.q[3], f.q[1] + nn[1] * f.q[3], f.q[2] + nn[2] * f.q[3]], nn]; };
  for (let i = 0; i < frames.length - 1; i++) for (let k = 0; k < seg; k++) {
    const v = [ring(frames[i], k), ring(frames[i], k + 1), ring(frames[i + 1], k + 1), ring(frames[i + 1], k)];
    for (const q of [0, 1, 2, 0, 2, 3]) { p.push(...v[q][0]); n.push(...v[q][1]); }
  }
  return { p, n };
}
export const sphere = (r = 1, seg = 20) => lathe(Array.from({ length: 13 }, (_, k) => { const a = -Math.PI / 2 + (k / 12) * Math.PI; return [Math.cos(a) * r, Math.sin(a) * r]; }), seg);
export const cylinder = (seg = 32) => lathe([[0, 0], [1, 0], [1, 1], [0, 1]], seg, { smooth: false });
// a capsule along Y, radius r, the straight part `len` long, centred on the origin
export const capsule = (r, len, seg = 28) => lathe(Array.from({ length: 21 }, (_, k) => {
  const a = -Math.PI / 2 + (k / 20) * Math.PI;
  return [Math.cos(a) * r, Math.sin(a) * r + (k < 10 ? -len / 2 : k > 10 ? len / 2 : 0)];
}).flatMap((q, k) => (k === 10 ? [[q[0], -len / 2], [q[0], len / 2]] : [q])), seg);

// ── the renderer ─────────────────────────────────────────────────────────────
const VS = `attribute vec3 aP; attribute vec3 aN;
uniform mat4 uPr; uniform mat4 uM; uniform mat3 uNm;
varying vec3 vW; varying vec3 vN; varying vec3 vL;
void main() { vec4 w = uM * vec4(aP, 1.0); vW = w.xyz; vN = uNm * aN; vL = aP; gl_Position = uPr * w; }`;
const FS = `precision mediump float;
uniform vec3 uC; uniform float uA; uniform float uMetal; uniform float uSpec; uniform float uNoise; uniform float uBrush;
uniform float uStripe; uniform float uClipY; uniform float uBandLo; uniform float uBandHi; uniform float uCutX;
uniform vec3 uEmit; uniform float uGlass;
varying vec3 vW; varying vec3 vN; varying vec3 vL;
float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 room(vec3 r) {
  // what a polished thing sees: a dark floor, warm walls, a bright band of lamps and the glass front
  vec3 c = mix(vec3(0.08, 0.06, 0.05), vec3(0.55, 0.45, 0.36), smoothstep(-0.35, 0.15, r.y));
  c = mix(c, vec3(0.95, 0.9, 0.82), smoothstep(0.45, 0.8, r.y));
  c += vec3(1.2, 1.05, 0.85) * smoothstep(0.06, 0.0, abs(r.y - 0.28)) * 0.8;
  c += vec3(0.5, 0.6, 0.8) * smoothstep(0.7, 0.95, -r.z) * 0.25;
  // behind you, the lit room and the lamps over the bar
  c += vec3(0.75, 0.66, 0.55) * smoothstep(0.1, 0.9, r.z) + vec3(0.6) * smoothstep(0.85, 0.99, r.z) * smoothstep(-0.1, 0.3, r.x);
  return c;
}
void main() {
  if (vW.y > uClipY || vL.y < uBandLo || vL.y > uBandHi) discard;
  if (vW.x > uCutX + 0.35 * sin(vW.y * 3.1 + vW.z * 2.3) + 0.2 * sin(vW.y * 7.0)) discard;
  vec3 n = normalize(vN); bool back = !gl_FrontFacing; if (back) n = -n;
  vec3 v = normalize(-vW);
  vec3 c = uC;
  if (uNoise > 0.0) c *= 1.0 - uNoise * h(floor(vL * 30.0));
  if (uBrush > 0.0) c *= 1.0 - uBrush * h(vec3(floor(vL.x * 70.0), floor(vL.z * 70.0), 1.0));
  if (uStripe > 0.0) c *= 0.7 + 0.3 * step(0.0, sin(atan(vL.z, vL.x) * uStripe));
  vec3 L1 = normalize(vec3(-0.5, 0.85, 0.55)), L2 = normalize(vec3(0.75, 0.15, 0.5));
  float d1 = max(dot(n, L1), 0.0), d2 = max(dot(n, L2), 0.0);
  float sp = pow(max(dot(n, normalize(L1 + v)), 0.0), uSpec) + 0.45 * pow(max(dot(n, normalize(L2 + v)), 0.0), uSpec);
  vec3 env = room(reflect(-v, n));
  float fr = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 diff = c * (0.2 + d1 * vec3(1.0, 0.9, 0.78) * 0.95 + d2 * vec3(0.5, 0.6, 0.8) * 0.4);
  vec3 col = mix(diff, c * env * 1.25, uMetal);
  col += sp * mix(vec3(0.35), c + 0.4, uMetal) * (uSpec > 2.0 ? 1.0 : 0.0);
  col += fr * env * (0.18 + uGlass * 0.6);
  if (back) col *= 0.55;
  col += uEmit;
  float a = clamp(uA + fr * uGlass * 0.7 + sp * uGlass * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

export function createGl(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = {}; for (const k of ['uPr', 'uM', 'uNm', 'uC', 'uA', 'uMetal', 'uSpec', 'uNoise', 'uBrush', 'uStripe', 'uClipY', 'uBandLo', 'uBandHi', 'uCutX', 'uEmit', 'uGlass']) U[k] = gl.getUniformLocation(prog, k);
  const aP = gl.getAttribLocation(prog, 'aP'), aN = gl.getAttribLocation(prog, 'aN');
  gl.enableVertexAttribArray(aP); gl.enableVertexAttribArray(aN);
  const meshes = new Map();
  const mesh = (key, build) => {
    let m = meshes.get(key);
    if (m) return m;
    const g = build();
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.p), gl.STATIC_DRAW);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.n), gl.STATIC_DRAW);
    m = { pb, nb, count: g.p.length / 3, pts: g.p };
    meshes.set(key, m);
    return m;
  };
  const FOV_T = Math.tan((50 / 2) * Math.PI / 180);
  let W = 1, H = 1, queue = [];
  const hex = (c) => { const v = parseInt(c.slice(1), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
  return {
    FOV_T,
    mesh,
    begin(w, h) {
      W = w; H = h; queue = [];
    },
    // material: { color, alpha, metal, spec, noise, brush, stripe, clipY, band, cutX, emit, glass }
    draw(m, mat, o = {}) { queue.push({ m, mat, o, z: apply(mat, [0, 0, 0])[2] }); },
    end() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!queue.length) return;
      const near = 0.4, far = 400, f = 1 / FOV_T, a = W / H;
      const P = new Float32Array([f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
      gl.uniformMatrix4fv(U.uPr, false, P);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const solid = queue.filter((q) => (q.o.alpha ?? 1) >= 1), clear = queue.filter((q) => (q.o.alpha ?? 1) < 1).sort((x, y) => x.z - y.z);
      const run = (q) => {
        const o = q.o;
        gl.uniformMatrix4fv(U.uM, false, q.mat); gl.uniformMatrix3fv(U.uNm, false, normalMat(q.mat));
        gl.uniform3fv(U.uC, hex(o.color || '#cccccc')); gl.uniform1f(U.uA, o.alpha ?? 1);
        gl.uniform1f(U.uMetal, o.metal || 0); gl.uniform1f(U.uSpec, o.spec ?? 24); gl.uniform1f(U.uNoise, o.noise || 0);
        gl.uniform1f(U.uBrush, o.brush || 0); gl.uniform1f(U.uStripe, o.stripe || 0); gl.uniform1f(U.uGlass, o.glass || 0);
        gl.uniform1f(U.uClipY, o.clipY ?? 1e6); gl.uniform1f(U.uBandLo, o.band?.[0] ?? -1e6); gl.uniform1f(U.uBandHi, o.band?.[1] ?? 1e6);
        gl.uniform1f(U.uCutX, o.cutX ?? 1e6); gl.uniform3fv(U.uEmit, o.emit || [0, 0, 0]);
        gl.bindBuffer(gl.ARRAY_BUFFER, q.m.pb); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, q.m.nb); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, q.m.count);
      };
      gl.depthMask(true); solid.forEach(run);
      gl.depthMask(false); clear.forEach(run); gl.depthMask(true);
    },
    // a screen point at distance d, and back
    unproject(px, py, d) { return [((px - W / 2) / (H / 2)) * FOV_T * d, (-(py - H / 2) / (H / 2)) * FOV_T * d, -d]; },
    project(v) { const d = -v[2] || 1e-3; return [W / 2 + (v[0] / d / FOV_T) * (H / 2), H / 2 - (v[1] / d / FOV_T) * (H / 2), (H / 2) / (FOV_T * d)]; },
    lost: () => gl.isContextLost(),
  };
}
