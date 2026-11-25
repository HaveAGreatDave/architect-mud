// OCCLUSION ON FOOT, PHASE 1: THE GPU'S DEPTH, READ BACK LATE (docs/proposals/foot-occlusion.md).
//
// The SSAO prepass (gl/ssao.js) draws the city's mass into a depth texture from the camera. Right after the mass and
// before anything else goes in (vehicles, people and tents move, and an answer read a frame late must not let a truck
// hide what's behind it), `request` reduces that depth to a GW by GH grid, each cell the FARTHEST depth in its block,
// and copies it into a pixel-pack buffer behind a fence. `poll`, a frame or more later, takes the newest copy whose
// fence has signalled, without waiting, the way gl/murmur-gpu.js reads the starlings back.
//
// `boxHidden(answer, box)` then asks of a box in the answer's frame: is every cell it covers already filled by mass
// nearer than its nearest corner? Only then is it hidden. A cell where the sky shows (depth 1), a box crossing the
// eye's plane, or no answer at all, and it's visible.
//
// ⚠ NEVER WAITS. No readPixels into memory, no clientWaitSync with a timeout. An answer that hasn't come is no answer.
// ⚠ PHASE 1 SKIPS NOTHING. Callers count with it (windshield.js gpuOccCensus); culling is phase 2.
import { compileShader } from './programs.js';
import { texture2D } from './core/texture.js';

export const OCC_GW = 64, OCC_GH = 40;

// The newest answer for each view (its GL id), as gl/context.js polls it at the top of a frame, for the windshield to
// ask with boxHidden. A view that never asks has none.
const ANSWERS = new Map();
export function occPublish(id, ans) { if (ans) ANSWERS.set(id, ans); }
export function occAnswer(id) { return ANSWERS.get(id) || null; }
export function occForget(id) { ANSWERS.delete(id); }
// For checking from the console: the views with an answer, and each live readback's counts.
const LIVE = new Set();
export function occDebug() { return { ids: [...ANSWERS.keys()], readbacks: [...LIVE].map((r) => r.stats()) }; }
const SLOTS = 3;

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The farthest depth in this cell's block, as 24 bits in RGB. Every texel of the block is read, so a single gap
// (sky between two fronts) keeps the cell open.
const FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uDepth;
uniform ivec2 uSrc;
uniform ivec2 uGrid;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int x0 = c.x * uSrc.x / uGrid.x, x1 = max(x0 + 1, (c.x + 1) * uSrc.x / uGrid.x);
  int y0 = c.y * uSrc.y / uGrid.y, y1 = max(y0 + 1, (c.y + 1) * uSrc.y / uGrid.y);
  float m = 0.0;
  for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) m = max(m, texelFetch(uDepth, ivec2(x, y), 0).r);
  float v = floor(clamp(m, 0.0, 1.0) * 16777215.0);
  float r = floor(v / 65536.0), g = floor((v - r * 65536.0) / 256.0), b = v - r * 65536.0 - g * 256.0;
  outColor = vec4(r, g, b, 255.0) / 255.0;
}`;

export function createOccReadback(gl) {
  let prog = null, uDepth, uSrc, uGrid, vao = null, tex = null, fbo = null, failed = false;
  const slots = Array.from({ length: SLOTS }, () => ({ buf: null, fence: null, meta: null }));
  let latest = null, asked = 0, got = 0;

  function setup() {
    if (prog || failed) return !!prog;
    try {
      const vs = compileShader(gl, gl.VERTEX_SHADER, VS, 'occ-readback vertex');
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS, 'occ-readback fragment');
      prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      uDepth = gl.getUniformLocation(prog, 'uDepth'); uSrc = gl.getUniformLocation(prog, 'uSrc'); uGrid = gl.getUniformLocation(prog, 'uGrid');
      vao = gl.createVertexArray();
      tex = texture2D(gl, { w: OCC_GW, h: OCC_GH, filter: gl.NEAREST });
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo');
      for (const s of slots) {
        s.buf = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.buf);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, OCC_GW * OCC_GH * 4, gl.STREAM_READ);
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return true;
    } catch (e) {
      failed = true; prog = null;
      console.warn('[occ-readback] off:', e?.message || e);
      return false;
    }
  }

  const self = {
    // `depthTex` (DW by DH) holds the mass's depth from `vp` (a Float32Array, column-major). `meta` rides with the
    // answer: what frame `vp` is in (the window's centre), so a caller can move a box into it.
    // Leaves the framebuffer, viewport, program and VAO unbound; the caller rebinds what it needs.
    request(depthTex, DW, DH, vp, meta) {
      if (!depthTex || !(DW > 0 && DH > 0) || !setup()) return false;
      const s = slots.find((q) => !q.fence);
      if (!s) return false;   // all three still in flight: skip this frame rather than wait
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, OCC_GW, OCC_GH);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.uniform1i(uDepth, 0); gl.uniform2i(uSrc, DW, DH); gl.uniform2i(uGrid, OCC_GW, OCC_GH);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.buf);
      gl.readPixels(0, 0, OCC_GW, OCC_GH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      s.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();   // a fence never flushed never signals
      s.meta = { vp: Float32Array.from(vp), at: ++asked, ...meta };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    },
    // The newest answer whose fence has signalled, or the last one kept. Never blocks.
    poll() {
      let best = null;
      for (const s of slots) {
        if (!s.fence) continue;
        const st = gl.clientWaitSync(s.fence, 0, 0);
        if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) continue;
        gl.deleteSync(s.fence); s.fence = null;
        if (!best || s.meta.at > best.meta.at) best = s;
        else continue;
      }
      if (best && (!latest || best.meta.at > latest.at)) {
        const px = new Uint8Array(OCC_GW * OCC_GH * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, best.buf);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const d = new Float32Array(OCC_GW * OCC_GH);
        for (let i = 0; i < d.length; i++) d[i] = (px[i * 4] * 65536 + px[i * 4 + 1] * 256 + px[i * 4 + 2]) / 16777215;
        latest = { d, ...best.meta };
        got++;
      }
      return latest;
    },
    latest: () => latest,
    stats: () => ({ asked, got, inFlight: slots.filter((s) => s.fence).length, off: failed }),
    dispose() {
      for (const s of slots) { if (s.fence) gl.deleteSync(s.fence); if (s.buf) gl.deleteBuffer(s.buf); s.fence = s.buf = null; }
      if (fbo) gl.deleteFramebuffer(fbo); if (tex) gl.deleteTexture(tex); if (vao) gl.deleteVertexArray(vao); if (prog) gl.deleteProgram(prog);
      fbo = tex = vao = prog = null; latest = null;
      LIVE.delete(self);
    },
  };
  LIVE.add(self);
  return self;
}

// Is a box [x0, y0, x1, y1, z0, z1] (the answer's frame: tiles about its window's centre, z up) wholly behind the mass
// the answer saw? Every cell it covers must hold mass nearer than the box's nearest corner, less `eps` of depth.
export function boxHidden(ans, b, eps = 1e-5) {
  if (!ans) return false;
  const m = ans.vp;
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity, zmin = Infinity;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? b[2] : b[0], y = i & 2 ? b[3] : b[1], z = i & 4 ? b[5] : b[4];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!(cw > 1e-6)) return false;   // a corner at or behind the eye: it can't be wholly behind anything
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
    const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    const nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / cw;
    if (nx < sx0) sx0 = nx; if (nx > sx1) sx1 = nx; if (ny < sy0) sy0 = ny; if (ny > sy1) sy1 = ny;
    const wz = nz * 0.5 + 0.5; if (wz < zmin) zmin = wz;
  }
  if (sx1 < -1 || sx0 > 1 || sy1 < -1 || sy0 > 1) return false;   // off screen is another question
  const cx0 = Math.max(0, Math.floor((sx0 * 0.5 + 0.5) * OCC_GW)), cx1 = Math.min(OCC_GW - 1, Math.floor((sx1 * 0.5 + 0.5) * OCC_GW));
  const cy0 = Math.max(0, Math.floor((sy0 * 0.5 + 0.5) * OCC_GH)), cy1 = Math.min(OCC_GH - 1, Math.floor((sy1 * 0.5 + 0.5) * OCC_GH));
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (!(ans.d[cy * OCC_GW + cx] < zmin - eps)) return false;
  return true;
}
