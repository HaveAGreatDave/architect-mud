// ROOM's depth of field. The room is drawn into a multisampled target instead of the canvas, resolved to a
// colour and a depth texture, and drawn to the canvas through a lens: a golden-angle gather whose radius is the
// circle of confusion, the same weighting as the broadcast's (gl/broadcast.js), so a sharp subject doesn't take
// on the blur of what's behind it.
//
// The lens focuses itself on what's at the middle of the picture (the nearest of nine depth taps there) and
// racks to it over a fraction of a second, the way a camera's autofocus hunts. The focus lives on the GPU in a
// pair of 1x1 textures, 16 bits packed in r and g, so nothing is read back. A caller can pin it in metres.
//
// ⚠ ALPHA IS KEPT. With `see` the panes are holes onto the live GLASS view under the canvas; the gather works
// on premultiplied colour, so a hole's edge blurs into the glass without a dark fringe. The city through the
// hole isn't blurred: it's another canvas.
//
// Settings → Depth of Field (roomDof). Off, or a target that won't build, and the room draws straight to the
// canvas as before.

import { declareProgram, layerProgram } from './programs.js';

const FULL_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// the focus range in metres the 16 bits span
const SPAN = 40;

const FOCUS_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uDepth; uniform sampler2D uPrev;
uniform float uNear; uniform float uFar; uniform float uRate; uniform float uFix; uniform vec2 uAt;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
vec4 enc(float m) { float v = floor(clamp(m / ${SPAN.toFixed(1)}, 0.0, 1.0) * 65535.0 + 0.5); return vec4(floor(v / 256.0) / 255.0, mod(v, 256.0) / 255.0, 1.0, 1.0); }
float dec(vec4 f) { return (f.r * 255.0 * 256.0 + f.g * 255.0) / 65535.0 * ${SPAN.toFixed(1)}; }
void main() {
  float t;
  if (uFix > 0.0) t = uFix;
  else {
    // the nearest thing near the middle: a ring of eight round the centre, then a wider ring, so a thin
    // chair leg doesn't flick the focus to the far wall and back
    t = lin(texture(uDepth, uAt).r);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      t = min(t, lin(texture(uDepth, uAt + vec2(cos(a), sin(a)) * vec2(0.018, 0.03)).r));
      t = min(t, lin(texture(uDepth, uAt + vec2(cos(a + 0.39), sin(a + 0.39)) * vec2(0.04, 0.065)).r) * 1.15);
    }
  }
  t = clamp(t, 0.35, ${(SPAN - 1).toFixed(1)});
  vec4 p = texture(uPrev, vec2(0.5));
  // the first frame takes it outright; after that, rack toward it in inverse distance, as a lens moves
  float f = p.b < 0.5 ? t : 1.0 / mix(1.0 / max(dec(p), 0.05), 1.0 / t, uRate);
  o = enc(f);
}`;

const LENS_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uFocus;
uniform float uNear; uniform float uFar; uniform float uK; uniform float uMax; uniform int uTaps; uniform vec2 uTx; uniform vec2 uBand; uniform float uSharp;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float dec(vec4 f) { return (f.r * 255.0 * 256.0 + f.g * 255.0) / 65535.0 * ${SPAN.toFixed(1)}; }
float F;
// with a band (uBand.y > 0) everything between its two distances is sharp, and the blur grows from its edges
float coc(vec2 t) {
  float d = lin(texture(uDepth, t).r);
  float s = uBand.y > 0.0 ? clamp(d, uBand.x, uBand.y) : F;
  // with uSharp nothing nearer than it blurs and the focus never comes in past it, so only the far city goes soft
  if (uSharp > 0.0) { if (d <= uSharp) return 0.0; s = max(s, uSharp); }
  // in front of the focus the inverse-distance sum runs away (blinds at half a metre went to mush), so the near
  // side blurs at a third the rate and stops at half the far side's cap
  if (d < s) return clamp((1.0 / d - 1.0 / s) * uK * 0.33, 0.0, uMax * 0.5);
  return clamp((1.0 / s - 1.0 / d) * uK, 0.0, uMax);
}
vec4 pm(vec2 t) { vec4 c = texture(uScene, t); return vec4(c.rgb * c.a, c.a); }
void main() {
  F = max(dec(texture(uFocus, vec2(0.5))), 0.05);
  vec4 c = pm(vUV);
  float r0 = coc(vUV);
  if (r0 > 0.6) {
    // a per-pixel turn of the spiral, so the taps' pattern goes to fine grain instead of rings
    float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec4 acc = c; float wsum = 1.0;
    for (int i = 0; i < 48; i++) {
      if (i >= uTaps) break;
      float fi = float(i), a = fi * 2.39996 + spin, rr = sqrt((fi + 0.5) / float(uTaps)) * r0;
      vec2 t = vUV + vec2(cos(a), sin(a)) * rr * uTx;
      float w = smoothstep(rr - 1.0, rr + 0.5, coc(t));
      // the bright bits bloom into discs, as out-of-focus lamps do through a real lens
      vec4 s = pm(t);
      w *= 1.0 + 1.5 * smoothstep(0.75, 1.0, max(s.r, max(s.g, s.b)));
      acc += s * w; wsum += w;
    }
    c = acc / wsum;
  }
  o = vec4(c.a > 1e-4 ? c.rgb / c.a : vec3(0.0), c.a);
}`;

declareProgram(FULL_VS, FOCUS_FS);
declareProgram(FULL_VS, LENS_FS);

// Is the lens wanted: the setting (main.js leaves it on window), on unless it's been turned off. The Room Lab
// and the gates have no settings, and get it.
export const roomDofOn = () => globalThis.__roomDof !== 0;

export function createRoomDof(gl, { phone = false } = {}) {
  const prog = (fs, label) => { const p = layerProgram(gl, FULL_VS, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
  let FOCUS = null, LENS = null;
  try { FOCUS = prog(FOCUS_FS, 'room focus'); LENS = prog(LENS_FS, 'room lens'); } catch (err) { console.warn('[room] no depth of field:', err && err.message); return null; }
  const vao = gl.createVertexArray();
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
  let W = 0, H = 0, T = null, broken = false, last = 0;

  const texture = (fmt, type, base, w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, base, type, null);
    const f = fmt === gl.DEPTH_COMPONENT24 ? gl.NEAREST : gl.LINEAR;
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, f], [gl.TEXTURE_MAG_FILTER, f], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const complete = () => gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  function free() {
    if (!T) return;
    for (const f of [T.ms, T.res, ...T.ff]) gl.deleteFramebuffer(f);
    for (const r of [T.msC, T.msD]) if (r) gl.deleteRenderbuffer(r);
    for (const t of [T.col, T.dep, ...T.ft]) gl.deleteTexture(t);
    T = null; W = H = 0;
  }
  function size(w, h) {
    if (T && w === W && h === H) return true;
    // the focus survives a resize: it's in its own pair
    const ft = T ? T.ft : null, ff = T ? T.ff : null;
    if (T) { T.ft = []; T.ff = []; free(); }
    const t = { ft: ft || [], ff: ff || [] };
    t.col = texture(gl.RGBA8, gl.UNSIGNED_BYTE, gl.RGBA, w, h);
    t.dep = texture(gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT, gl.DEPTH_COMPONENT, w, h);
    t.res = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.res);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.col, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.dep, 0);
    let ok = complete();
    if (samples > 1) {
      t.ms = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.ms);
      t.msC = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, t.msC);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.msC);
      t.msD = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, t.msD);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.msD);
      ok = ok && complete();
    } else t.ms = t.res;
    if (!t.ft.length) for (let i = 0; i < 2; i++) {
      const ftx = texture(gl.RGBA8, gl.UNSIGNED_BYTE, gl.RGBA, 1, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ftx, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      t.ft.push(ftx); t.ff.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    T = t; W = w; H = h;
    if (!ok) { free(); broken = true; console.warn('[room] no depth of field: the target would not build'); return false; }
    return true;
  }

  return {
    // Point the room's drawing at the lens's target. False: draw to the canvas as before.
    begin(w, h) {
      if (broken || !size(w, h)) return false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.ms);
      return true;
    },
    // Resolve, find the focus, and draw the picture through the lens onto the canvas. `focus` pins it in metres;
    // `at` is where in the picture to focus, [0..1, 0..1] from the bottom left (the middle by default).
    // `band`, [near, far] in metres, holds everything between them sharp (the people round a table you sit at).
    finish({ near, far, focus = 0, at = null, band = null, sharp = 0, strength = 1 }) {
      if (T.ms !== T.res) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.res);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      }
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(vao);
      const now = performance.now(), dt = last ? Math.min(0.25, (now - last) / 1000) : 1;
      last = now;
      // 1. the focus: read the old one, write the new one, swap
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.ff[1]); gl.viewport(0, 0, 1, 1);
      gl.useProgram(FOCUS.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.dep);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.ft[0]);
      gl.uniform1i(FOCUS.u('uDepth'), 0); gl.uniform1i(FOCUS.u('uPrev'), 1);
      gl.uniform1f(FOCUS.u('uNear'), near); gl.uniform1f(FOCUS.u('uFar'), far);
      gl.uniform1f(FOCUS.u('uRate'), 1 - Math.exp(-dt * 5));
      gl.uniform1f(FOCUS.u('uFix'), focus > 0 ? focus : 0);
      gl.uniform2f(FOCUS.u('uAt'), at ? at[0] : 0.5, at ? at[1] : 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      T.ft.reverse(); T.ff.reverse();
      // 2. the lens, onto the canvas. The blur is sized to the picture's height, so it reads the same at any res.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(LENS.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.col);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.dep);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.ft[0]);
      gl.uniform1i(LENS.u('uScene'), 0); gl.uniform1i(LENS.u('uDepth'), 1); gl.uniform1i(LENS.u('uFocus'), 2);
      gl.uniform1f(LENS.u('uNear'), near); gl.uniform1f(LENS.u('uFar'), far);
      const k = H / 900;
      // ~ a 50 mm at f/4 on a 35 mm frame: focused at 1.5 m, the far wall is a 13 px blur on a 900 px picture
      // (f/2.8 would be 22 px, which reads as a miniature)
      gl.uniform1f(LENS.u('uK'), 20 * k * strength); gl.uniform1f(LENS.u('uMax'), Math.min(phone ? 10 : 18, 16 * k));
      gl.uniform1i(LENS.u('uTaps'), phone ? 20 : 40);
      gl.uniform2f(LENS.u('uTx'), 1 / W, 1 / H);
      gl.uniform2f(LENS.u('uBand'), band ? band[0] : 0, band ? band[1] : 0);
      // `sharp`, in metres: everything nearer stays in focus and only what's further off blurs (the street)
      gl.uniform1f(LENS.u('uSharp'), sharp > 0 ? sharp : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    },
    dispose() { if (T) { const ft = T.ft, ff = T.ff; free(); for (const f of ff) gl.deleteFramebuffer(f); for (const t of ft) gl.deleteTexture(t); } gl.deleteVertexArray(vao); },
  };
}
