// THE MURMURATION, SIMULATED ON THE GPU.
//
// One fragment is one starling. Each frame, for each cloud, one pass reads every bird's position and
// velocity out of two float textures, finds its seven nearest flockmates, applies the rule, and writes
// the next position and velocity into the other pair of textures. Nothing is read back: gl/fauna.js
// draws the birds straight out of the same textures.
//
// ⚠ IT IS THE CPU RULE, PORTED, NOT A NEW ONE. murmur.js is the reference and the source every
// number here comes from — the weights through MURMUR_RULES, the flock's own memory (its clock, the
// trail its centre has flown, the stoop, the band table) through flockFrame, the starting cloud
// through seedPoints. What is ported is the per-bird loop, term for term: separation, alignment and
// cohesion over the seven nearest, the pull to the bird's station on the trail, the hawk's bubble,
// the calm vertical, the renormalise to cruise and the bank-limited turn.
//
// ⚠ ONE DIFFERENCE, ON PURPOSE: THE NEIGHBOURS ARE FOUND FRESH EVERY FRAME. The CPU re-scans each
// bird only every other frame because the search is 80% of its step, and murmur.js's own note says
// what that staleness costs: the flock packs tighter and flatter, 1 : 3.5 : 5.5 at every second
// frame against 1 : 3.1 : 5.3 with no cache and real starlings at 1 : 2.8 : 5.6. On a GPU the search
// is a loop per fragment, so there is no reason to buy that drift back.
//
// ⚠ THE SEARCH IS BRUTE FORCE AND EXACT: every visible bird is offered, ties go to the lower index,
// exactly as the CPU's grid search guarantees. It is n^2, which at 4,000 birds is sixteen million
// distance tests a frame — nothing to a discrete GPU, unmeasured on an integrated one.
//
// ⚠ THERE IS NO CPU FALLBACK IN THE GAME (decided 2026-09-23). A machine that cannot render to a
// float texture draws no murmuration at all.
import { flockFrame, seedPoints, scatterOf, bandWaves, MURMUR_RULES as R } from '../murmur.js';

const W = 64;                       // birds per texture row
const UNIT0 = 8;                    // texture units 8-11: no other layer binds these
const IDLE_EVICT_MS = 4000;         // murmur.js's own eviction rule, for the same reason
const MAX_CLOUDS = 12;
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));   // a JS number as a GLSL float literal

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPos;      // xyz, roll
uniform highp sampler2D uVel;      // xyz, vis
uniform highp sampler2D uStat0;    // station, speed factor, rank, beat offset
uniform highp sampler2D uStat1;    // unit scatter xyz
uniform int uN;
uniform float uDt;
uniform float uSpeed;
uniform float uSepR;
uniform float uTurn;
uniform float uSpread;
uniform float uTrailW;
uniform float uShow;
uniform float uFadeK;
uniform float uHeading;
uniform vec3 uC;
uniform vec3 uOff;
uniform int uHasTrail;
uniform vec3 uTrail[${R.TRAIL_SAMP}];
uniform vec4 uScare;               // x, y, damp, live
uniform vec4 uBand[${R.BAND_N}];
uniform int uBandN;
uniform vec3 uShift;               // a frozen flock is carried with its centre
uniform int uFrozen;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
const int K = ${R.K};
const int TW = ${W};
ivec2 at(int i) { return ivec2(i % TW, i / TW); }
void main() {
  ivec2 me = ivec2(gl_FragCoord.xy);
  int i = me.y * TW + me.x;
  vec4 P = texelFetch(uPos, me, 0);
  vec4 V = texelFetch(uVel, me, 0);
  if (i >= uN) { oPos = P; oVel = V; return; }
  if (uFrozen == 1) { oPos = vec4(P.xyz + uShift, P.w); oVel = V; return; }
  vec4 S0 = texelFetch(uStat0, me, 0);
  vec4 S1 = texelFetch(uStat1, me, 0);
  vec3 p = P.xyz, v = V.xyz;
  // the bird's station on the trail its centre has flown (murmur.js: target)
  vec3 target = uC;
  if (uHasTrail == 1) {
    int k = min(${R.TRAIL_SAMP - 1}, int(floor(S0.x * ${f(R.TRAIL_SAMP - 1)})));
    target = uC + (uTrail[k] + uOff - uC) * uTrailW;
  }
  // thinning: fade toward rank < show; a bird fading back in is placed on its own station
  float was = V.w;
  float vis = S0.z < uShow ? min(1.0, was + uFadeK) : max(0.0, was - uFadeK);
  if (was <= 0.0 && vis > 0.0) {
    p = target + vec3(S1.x * uSpread, S1.y * uSpread, S1.z * uSpread * ${f(0.6 / R.FLAT_Z)});
    float sp0 = uSpeed * S0.y;
    v = vec3(cos(uHeading) * sp0, sin(uHeading) * sp0, 0.0);
  }
  if (vis <= 0.0) { oPos = vec4(p, P.w); oVel = vec4(v, vis); return; }

  // the seven nearest visible flockmates, exact, ties to the lower index
  float nd[K]; int nj[K]; int cnt = 0;
  for (int m = 0; m < K; m++) { nd[m] = 1e30; nj[m] = -1; }
  for (int j = 0; j < uN; j++) {
    if (j == i) continue;
    ivec2 t = at(j);
    if (texelFetch(uVel, t, 0).w <= 0.0) continue;
    vec3 d = texelFetch(uPos, t, 0).xyz - p;
    float d2 = dot(d, d);
    if (cnt == K && d2 >= nd[K - 1]) continue;
    int m = cnt < K ? cnt : K - 1;
    if (cnt < K) cnt++;
    for (int s = K - 1; s > 0; s--) {
      if (s > m) continue;
      if (nd[s - 1] > d2) { nd[s] = nd[s - 1]; nj[s] = nj[s - 1]; m = s - 1; } else break;
    }
    nd[m] = d2; nj[m] = j;
  }

  vec3 sep = vec3(0.0), ali = vec3(0.0), coh = vec3(0.0);
  for (int m = 0; m < K; m++) {
    if (m >= cnt) break;
    ivec2 t = at(nj[m]);
    vec3 q = texelFetch(uPos, t, 0).xyz;
    vec3 vq = texelFetch(uVel, t, 0).xyz;
    float d = sqrt(nd[m]); d = d > 0.0 ? d : 1e-4;
    if (d < uSepR) sep += (p - q) * ((uSepR - d) / uSepR / d);
    ali += vq; coh += q;
  }
  if (cnt > 0) { ali /= float(cnt); coh = coh / float(cnt) - p; }

  vec3 dh = target - p;
  float dl = length(dh); dl = dl > 0.0 ? dl : 1e-4;
  float over = max(0.0, dl - uSpread) / uSpread;
  float pull = 0.25 + over * over * 3.0;
  vec3 e = vec3(0.0);
  if (uScare.w > 0.5) {
    vec2 s2 = p.xy - uScare.xy;
    float sd = length(s2); sd = sd > 0.0 ? sd : 1e-4;
    float kk = exp(-(sd / ${f(R.SCARE_R)}) * (sd / ${f(R.SCARE_R)})) * uScare.z;
    if (kk > 1e-4) e = vec3(s2 / sd * kk, 0.35 * kk);
  }
  vec3 acc;
  acc.xy = sep.xy * ${f(R.wSep)} + ali.xy * ${f(R.wAli)} + coh.xy * ${f(R.wCoh)} + (dh.xy / dl) * pull * ${f(R.wHome)} + e.xy * ${f(R.wScare)};
  acc.z = (sep.z * ${f(R.wSep)} + ali.z * ${f(R.wAli)} + coh.z * ${f(R.wCoh)}) * ${f(R.Z_SOFT)}
        + (dh.z / dl) * pull * ${f(R.wHome)} * ${f(R.FLAT_Z)} + e.z * ${f(R.wScare)};
  vec3 nv = v + acc * uDt;
  float want = uSpeed * S0.y;
  float sp = length(nv); sp = sp > 0.0 ? sp : 1e-4;
  nv = nv / sp * want;
  // the bank limit: rotate toward the wanted direction by at most what TURN_G allows
  float osp = length(v);
  if (osp > 1e-6) {
    vec3 u = v / osp, w = nv / want;
    float cosA = clamp(dot(u, w), -1.0, 1.0);
    float maxA = (uTurn * 9.81 * ${f(R.TILE_PER_M)}) / max(want, 1e-4) * uDt;
    if (cosA < cos(maxA)) {
      vec3 e2 = w - u * cosA;
      float el = length(e2);
      if (el > 1e-9) { e2 /= el; nv = (u * cos(maxA) + e2 * sin(maxA)) * want; }
    }
  }
  p += nv * uDt;
  // roll: a bird leaning into its own turn, plus the flock's rolling bands (murmur.js: bandAt)
  float roll = clamp(atan(nv.y, nv.x) - uHeading, -1.2, 1.2) * 0.16;
  vec2 uxy = p.xy - uC.xy;
  for (int b = 0; b < ${R.BAND_N}; b++) {
    if (b >= uBandN) break;
    float u = (dot(uxy, uBand[b].xy) - uBand[b].z) / ${f(R.BAND_WIDTH)};
    if (u >= -3.0 && u <= 3.0) roll += uBand[b].w * exp(-u * u);
  }
  oPos = vec4(p, roll);
  oVel = vec4(nv, vis);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' murmur shader: ' + log);
  }
  return sh;
}

export function createMurmurGPU(gl) {
  // ⚠ RENDERING TO A FLOAT TEXTURE IS AN EXTENSION EVEN IN WEBGL2. Without it there is nowhere to
  // put the flock, and — the decision above — no murmuration is drawn.
  const ok = !!gl.getExtension('EXT_color_buffer_float');
  let prog = null, loc = null, vao = null;
  const clouds = new Map();
  const bandScratch = new Float64Array(R.BAND_N * 4);
  const trailBuf = new Float32Array(R.TRAIL_SAMP * 3);
  const bandBuf = new Float32Array(R.BAND_N * 4);

  function build() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('murmur link: ' + gl.getProgramInfoLog(prog));
    const u = (n) => gl.getUniformLocation(prog, n);
    loc = {};
    for (const n of ['uPos', 'uVel', 'uStat0', 'uStat1', 'uN', 'uDt', 'uSpeed', 'uSepR', 'uTurn', 'uSpread', 'uTrailW',
      'uShow', 'uFadeK', 'uHeading', 'uC', 'uOff', 'uHasTrail', 'uTrail', 'uScare', 'uBand', 'uBandN', 'uShift', 'uFrozen']) loc[n] = u(n);
    vao = gl.createVertexArray();
  }

  function tex(w, h, data) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function create(rec) {
    const n = rec.n, H = Math.ceil(n / W);
    const { pts, sd } = seedPoints(rec.key, n, rec.cx, rec.cy, rec.cz, rec.spread);
    const pos = new Float32Array(W * H * 4), vel = new Float32Array(W * H * 4);
    const s0 = new Float32Array(W * H * 4), s1 = new Float32Array(W * H * 4);
    for (let i = 0; i < n; i++) {
      const p = pts[i], o = i * 4, sc = scatterOf(i);
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z; pos[o + 3] = 0;
      vel[o + 3] = 1;                                     // visible, as seedPoints leaves it
      s0[o] = p.st; s0[o + 1] = p.wk; s0[o + 2] = p.rank;
      // the wingbeat offset is windshield.js's own, handed over as a function so its hash has one home
      s0[o + 3] = rec.beatOff ? rec.beatOff(i) : 0;
      s1[o] = sc[0]; s1[o + 1] = sc[1]; s1[o + 2] = sc[2];
    }
    const t = [tex(W, H, pos), tex(W, H, vel), tex(W, H, pos), tex(W, H, vel)];
    const fbo = [0, 1].map((k) => {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t[k * 2], 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t[k * 2 + 1], 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      const okFb = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      return okFb ? fb : null;
    });
    const C = {
      key: rec.key, n, H, tex: t, fbo, cur: 0,
      stat0: tex(W, H, s0), stat1: tex(W, H, s1),
      c: { last: null, seen: rec.now, trail: [], sd },
      bad: !fbo[0] || !fbo[1],
    };
    clouds.set(rec.key, C);
    return C;
  }

  function drop(C) {
    for (const t of C.tex) gl.deleteTexture(t);
    gl.deleteTexture(C.stat0); gl.deleteTexture(C.stat1);
    for (const fb of C.fbo) if (fb) gl.deleteFramebuffer(fb);
    clouds.delete(C.key);
  }

  /**
   * Advance one cloud by this frame. `rec` is the record windshield.js pushes for a murmuration —
   * the same arguments it used to hand murmur(). Saves and restores every piece of GL state it
   * touches, because it runs in the middle of the world pass with a render target already bound.
   */
  function step(rec) {
    if (!ok) return null;
    if (!prog) build();
    let C = clouds.get(rec.key);
    if (C && C.n !== rec.n) { drop(C); C = null; }
    if (!C) C = create(rec);
    if (C.bad) return null;
    C.c.seen = rec.now;
    const F = flockFrame(C.c, rec.cx, rec.cy, rec.cz, rec.now, rec.spread, { trail: rec.trail, scare: rec.scare });
    if (!F.dt) return C;
    let shift = null;
    if (rec.frozen) {
      shift = [rec.cx - (C.c.fx ?? rec.cx), rec.cy - (C.c.fy ?? rec.cy), rec.cz - (C.c.fz ?? rec.cz)];
      C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz;
      if (!shift[0] && !shift[1] && !shift[2]) return C;
    } else { C.c.fx = rec.cx; C.c.fy = rec.cy; C.c.fz = rec.cz; }

    // ── save what this pass changes ──
    const fbWas = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const vpWas = gl.getParameter(gl.VIEWPORT);
    const en = [gl.BLEND, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.CULL_FACE].map((k) => [k, gl.isEnabled(k)]);
    try {
      for (const [k] of en) gl.disable(k);
      const src = C.cur, dst = 1 - C.cur;
      gl.bindFramebuffer(gl.FRAMEBUFFER, C.fbo[dst]);
      gl.viewport(0, 0, W, C.H);
      gl.useProgram(prog);
      const bind = (unit, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc[name], unit); };
      bind(UNIT0, C.tex[src * 2], 'uPos');
      bind(UNIT0 + 1, C.tex[src * 2 + 1], 'uVel');
      bind(UNIT0 + 2, C.stat0, 'uStat0');
      bind(UNIT0 + 3, C.stat1, 'uStat1');
      gl.uniform1i(loc.uN, C.n);
      gl.uniform1i(loc.uFrozen, shift ? 1 : 0);
      gl.uniform3f(loc.uShift, shift ? shift[0] : 0, shift ? shift[1] : 0, shift ? shift[2] : 0);
      if (!shift) {
        gl.uniform1f(loc.uDt, F.dt);
        gl.uniform1f(loc.uSpeed, rec.speed ?? R.speed);
        gl.uniform1f(loc.uSepR, rec.sep ?? R.sepR);
        gl.uniform1f(loc.uTurn, rec.turnG ?? R.turnG);
        gl.uniform1f(loc.uSpread, F.localSpread);
        gl.uniform1f(loc.uTrailW, F.trailW);
        gl.uniform1f(loc.uShow, Math.min(1, Math.max(0, rec.show ?? 1)));
        gl.uniform1f(loc.uFadeK, F.dt / Math.max(0.05, rec.showFade ?? R.SHOW_FADE_S));
        gl.uniform1f(loc.uHeading, rec.heading);
        gl.uniform3f(loc.uC, rec.cx, rec.cy, rec.cz);
        gl.uniform3f(loc.uOff, F.offX, F.offY, F.offZ);
        gl.uniform1i(loc.uHasTrail, F.samp ? 1 : 0);
        if (F.samp) {
          for (let k = 0; k < R.TRAIL_SAMP; k++) { trailBuf[k * 3] = F.samp[k].x; trailBuf[k * 3 + 1] = F.samp[k].y; trailBuf[k * 3 + 2] = F.samp[k].z; }
          gl.uniform3fv(loc.uTrail, trailBuf);
        }
        gl.uniform4f(loc.uScare, F.scare ? F.scare.x : 0, F.scare ? F.scare.y : 0, F.scareDamp || 0, F.scare ? 1 : 0);
        const bn = bandWaves(rec.spread, C.c.sd, rec.now, bandScratch);
        for (let k = 0; k < bandBuf.length; k++) bandBuf[k] = bandScratch[k];
        gl.uniform4fv(loc.uBand, bandBuf);
        gl.uniform1i(loc.uBandN, bn);
      }
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      C.cur = dst;
    } finally {
      for (let u = 0; u < 4; u++) { gl.activeTexture(gl.TEXTURE0 + UNIT0 + u); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbWas);
      gl.viewport(vpWas[0], vpWas[1], vpWas[2], vpWas[3]);
      for (const [k, was] of en) if (was) gl.enable(k); else gl.disable(k);
    }
    return C;
  }

  /** Drop clouds nobody has stepped for a while, and hold a hard ceiling (murmur.js's sweep). */
  function sweep(now) {
    for (const C of [...clouds.values()]) if (now - C.c.seen > IDLE_EVICT_MS) drop(C);
    if (clouds.size > MAX_CLOUDS) {
      const old = [...clouds.values()].sort((a, b) => a.c.seen - b.c.seen);
      for (let i = 0; i < old.length - MAX_CLOUDS; i++) drop(old[i]);
    }
  }

  /** The textures gl/fauna.js draws from, for one cloud: current position and velocity. */
  function state(key) {
    const C = clouds.get(key);
    if (!C || C.bad) return null;
    return { pos: C.tex[C.cur * 2], vel: C.tex[C.cur * 2 + 1], stat0: C.stat0, n: C.n, W };
  }

  /**
   * Read a cloud back to the CPU. ⚠ FOR BENCHES ONLY: readPixels stalls the pipeline, and nothing in
   * a frame may call it. This is how the Modelshop measures the GPU flock's shape against the CPU's.
   */
  function readback(key) {
    const C = clouds.get(key);
    if (!C || C.bad) return null;
    const fbWas = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const out = { pos: new Float32Array(W * C.H * 4), vel: new Float32Array(W * C.H * 4), n: C.n };
    gl.bindFramebuffer(gl.FRAMEBUFFER, C.fbo[C.cur]);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, W, C.H, gl.RGBA, gl.FLOAT, out.pos);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, W, C.H, gl.RGBA, gl.FLOAT, out.vel);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbWas);
    return out;
  }

  return {
    ok, step, sweep, state, readback,
    get clouds() { return clouds.size; },
    get birds() { let n = 0; for (const C of clouds.values()) n += C.n; return n; },
  };
}
