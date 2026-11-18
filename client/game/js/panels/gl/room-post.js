// ROOM'S POST PASS: GLASS's bloom and the ballpark's ambient occlusion, on a room (docs/proposals/gl-core.md,
// phase 3 step 5).
//
// The room's picture, a colour and a depth texture, goes through:
//
//   - the occlusion: gl/ssao.js's depth-only SSAO, the pass the ballpark runs on its stands, at half size, so a
//     chair darkens the floor under it and a body the wall it leans on. The room's own baked occlusion (per
//     vertex, room-mesh.js) is coarse and knows nothing of the people or the props;
//   - the bloom: what's over the threshold, blurred at half and quarter size, so a bulb, a screen, a neon tube
//     or the day through a pane glows past its edge the way the city's lamps do (gl/hdr.js does the same for
//     GLASS);
//   - one pass that puts them together: the scene darkened by the occlusion, with the bloom added.
//
// Two ways in. With the lens on (gl/room-dof.js), the lens hands its resolved colour and depth to `grade`, and
// draws the result through the lens. With it off, `begin` binds a target of this file's own for the room to
// draw into, and `finish` resolves it and puts the result on the canvas.
//
// ⚠ AT NOUGHT IT IS THE PICTURE THAT SHIPPED. With the bloom and the occlusion both off, the composite writes
// back exactly what the scene holds, colour and coverage. Turning this on changes only what the two add.
//
// ⚠ DISPLAY VALUES, NOT LINEAR LIGHT, FOR NOW. The room's finish (gl/room-light.js) tone-maps every lit
// surface itself, and the fire, the screens, the glows, the shutters and the mirror write display values
// straight out, so the threshold is on display values, as GLASS's own bright pass is (hdr.js uLinear). A linear
// float target (uStreet 3, as the ballpark's figures use) is the next step, once those outputs are turned back.
//
// ⚠ ALPHA IS KEPT. With `see` the panes are holes onto the live GLASS view under the canvas, and the canvas
// isn't premultiplied: the composite keeps the scene's coverage, so a hole stays a hole and a glow over it is
// lost there. Without `see`, a glow raises the coverage it spreads onto, as GLASS's composite does.
//
// Off (ROOM_POST.on 0), on a phone, or on a target that won't build, the room draws as before. Every exit
// returns null or false.

import { createDepthSSAO, ssaoConstants } from './ssao.js';
import { declareProgram, layerProgram } from './programs.js';
import { texture2D } from './core/texture.js';

// The dials. `bloom` is the strength of the glow, `threshold` and `knee` where it starts (display values),
// `ao` how much of the occlusion shows and `aoRadius` how far it reaches, in metres. Phones get none of it.
export const ROOM_POST = { on: 1, bloom: 0.5, threshold: 0.78, knee: 0.22, ao: 0.6, aoRadius: 0.4, aoBias: 0.02 };

const FULL_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// What's over the threshold, with a soft knee (hdr.js BRIGHT_FRAG's curve), read as straight colour.
const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTx;
uniform float uThreshold;
uniform float uKnee;
out vec4 outColor;
vec3 pick(vec2 uv) {
  vec4 s = texture(uSrc, uv);
  vec3 c = s.rgb / max(s.a, 1e-3) * min(s.a, 1.0);
  float l = max(c.r, max(c.g, c.b));
  float w = l <= uThreshold ? 0.0 : (l < uThreshold + uKnee ? (l - uThreshold) * (l - uThreshold) / max(1e-4, 2.0 * uKnee) : l - uThreshold - uKnee * 0.5);
  return c * (w / max(l, 1e-4));
}
void main() {
  // four taps, so a one-pixel highlight isn't lost in the halving
  outColor = vec4((pick(vUV + vec2(-0.5, -0.5) * uTx) + pick(vUV + vec2(0.5, -0.5) * uTx) + pick(vUV + vec2(-0.5, 0.5) * uTx) + pick(vUV + vec2(0.5, 0.5) * uTx)) * 0.25, 1.0);
}`;

// A nine-tap gaussian along `uStep`.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec3 c = texture(uSrc, vUV).rgb * 0.2270270270;
  c += (texture(uSrc, vUV + uStep * 1.3846153846).rgb + texture(uSrc, vUV - uStep * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(uSrc, vUV + uStep * 3.2307692308).rgb + texture(uSrc, vUV - uStep * 3.2307692308).rgb) * 0.0702702703;
  outColor = vec4(c, 1.0);
}`;

const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform sampler2D uAo;
uniform float uBloom;
uniform float uAoK;
// 1 when the canvas isn't premultiplied (the room drawn over the live city, 'see'): the coverage stays
// what the scene wrote. 0, and a glow raises the coverage it spreads onto.
uniform float uStraight;
out vec4 outColor;
void main() {
  vec4 s = texture(uScene, vUV);
  // the occlusion darkens the colour and leaves the coverage alone; at uAoK 0 this is a multiply by one
  float ao = mix(1.0, clamp(texture(uAo, vUV).r, 0.0, 1.0), uAoK);
  vec3 bloom = (texture(uBloom0, vUV).rgb + texture(uBloom1, vUV).rgb) * uBloom;
  float bl = max(bloom.r, max(bloom.g, bloom.b));
  float a = uStraight > 0.5 ? s.a : clamp(s.a + bl, 0.0, 1.0);
  outColor = vec4(s.rgb * ao + bloom, a);
}`;

for (const fs of [BRIGHT_FS, BLUR_FS, COMP_FS]) declareProgram(FULL_VS, fs, null, { scenes: ['room'] });

export function createRoomPost(gl, { see = false } = {}) {
  const prog = (fs, label) => { const p = layerProgram(gl, FULL_VS, fs, label), u = {}; return { p, u: (n) => (u[n] ??= gl.getUniformLocation(p, n)) }; };
  let BRIGHT, BLUR, COMP;
  try { BRIGHT = prog(BRIGHT_FS, 'room bloom bright'); BLUR = prog(BLUR_FS, 'room bloom blur'); COMP = prog(COMP_FS, 'room post'); }
  catch (err) { console.warn('[room] no post pass:', err && err.message); return null; }
  const ssao = createDepthSSAO(gl);
  const vao = gl.createVertexArray();
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
  const tex = (w, h, o = {}) => texture2D(gl, { w, h, ...o });
  const fboOf = (t, depth = null) => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    return f;
  };
  const complete = () => gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  const white = tex(1, 1, { filter: gl.NEAREST, data: new Uint8Array([255, 255, 255, 255]) });
  const black = tex(1, 1, { filter: gl.NEAREST, data: new Uint8Array([0, 0, 0, 0]) });

  // The bloom's octaves (half and quarter size, a pair each for the two blur directions) and, for the room
  // drawn without the lens, this file's own scene target. Rebuilt at a new size; `broken` once one won't build.
  let W = 0, H = 0, B = null, S = null, G = null, broken = false, last = null;
  const freeAll = () => {
    for (const o of [B, S, G]) if (o) {
      for (const f of o.fbos || []) gl.deleteFramebuffer(f);
      for (const t of o.texs || []) gl.deleteTexture(t);
      for (const r of o.rbs || []) gl.deleteRenderbuffer(r);
    }
    B = S = G = null; W = H = 0;
  };
  function size(w, h) {
    if (B && w === W && h === H) return true;
    freeAll();
    const oct = [[Math.max(1, w >> 1), Math.max(1, h >> 1)], [Math.max(1, w >> 2), Math.max(1, h >> 2)]];
    B = { texs: [], fbos: [], oct: [] };
    let ok = true;
    for (const [ow, oh] of oct) {
      const a = tex(ow, oh), b = tex(ow, oh);
      const fa = fboOf(a); ok = ok && complete();
      const fb = fboOf(b); ok = ok && complete();
      B.texs.push(a, b); B.fbos.push(fa, fb); B.oct.push({ w: ow, h: oh, a, b, fa, fb });
    }
    // the graded picture, for the lens to read (grade)
    const gt = tex(w, h);
    const gf = fboOf(gt); ok = ok && complete();
    G = { texs: [gt], fbos: [gf], tex: gt, fbo: gf };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    W = w; H = h;
    if (!ok) { freeAll(); broken = true; console.warn('[room] no post pass: a target would not build'); return false; }
    return true;
  }
  // The scene target for a room drawn without the lens: multisampled, resolved to a colour and a depth texture.
  function sceneTarget() {
    if (S) return true;
    const col = tex(W, H), dep = tex(W, H, { depth: true });
    const res = fboOf(col, dep);
    let ok = complete(), ms = res;
    const rbs = [];
    if (samples > 1) {
      ms = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, ms);
      const c = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, c);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      const d = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, d);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      ok = ok && complete();
      rbs.push(c, d);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    S = { col, dep, res, ms, texs: [col, dep], fbos: ms === res ? [res] : [res, ms], rbs };
    if (!ok) { freeAll(); broken = true; console.warn('[room] no post pass: the scene target would not build'); return false; }
    return true;
  }

  const full = (P, fbo, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(P.p); };
  // The occlusion and the bloom off `col` and `dep`, put together into `outFbo` (null: the canvas).
  function compose(col, dep, outFbo, proj, T) {
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    const ao = T.ao > 0 && ssao && proj && dep
      ? ssao.render(dep, Math.max(1, W >> 1), Math.max(1, H >> 1), ssaoConstants(proj), { radius: T.aoRadius, bias: T.aoBias, slope: 3 }) : null;
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    const bloomOn = T.bloom > 0;
    if (bloomOn) {
      for (let i = 0; i < B.oct.length; i++) {
        const o = B.oct[i], src = i === 0 ? col : B.oct[i - 1].b, sw = i === 0 ? W : B.oct[i - 1].w, sh = i === 0 ? H : B.oct[i - 1].h;
        if (i === 0) {
          full(BRIGHT, o.fb, o.w, o.h);
          gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(BRIGHT.u('uSrc'), 0);
          gl.uniform2f(BRIGHT.u('uTx'), 1 / sw, 1 / sh);
          gl.uniform1f(BRIGHT.u('uThreshold'), T.threshold); gl.uniform1f(BRIGHT.u('uKnee'), T.knee);
        } else {
          // the next octave down is the last one's blurred result, halved by the filter
          full(BLUR, o.fb, o.w, o.h);
          gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(BLUR.u('uSrc'), 0);
          gl.uniform2f(BLUR.u('uStep'), 0, 0);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        full(BLUR, o.fa, o.w, o.h);
        gl.bindTexture(gl.TEXTURE_2D, o.b); gl.uniform1i(BLUR.u('uSrc'), 0); gl.uniform2f(BLUR.u('uStep'), 1 / o.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        full(BLUR, o.fb, o.w, o.h);
        gl.bindTexture(gl.TEXTURE_2D, o.a); gl.uniform1i(BLUR.u('uSrc'), 0); gl.uniform2f(BLUR.u('uStep'), 0, 1 / o.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    full(COMP, outFbo, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, col); gl.uniform1i(COMP.u('uScene'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomOn ? B.oct[0].b : black); gl.uniform1i(COMP.u('uBloom0'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bloomOn ? B.oct[1].b : black); gl.uniform1i(COMP.u('uBloom1'), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ao || white); gl.uniform1i(COMP.u('uAo'), 3);
    gl.uniform1f(COMP.u('uBloom'), bloomOn ? T.bloom : 0);
    gl.uniform1f(COMP.u('uAoK'), ao ? T.ao : 0);
    // into the lens's input the coverage is what the lens expects to read back; onto a straight canvas, the scene's
    gl.uniform1f(COMP.u('uStraight'), see ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 3; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
    last = { w: W, h: H, bloom: bloomOn, ao: !!ao };
  }

  return {
    // Without the lens: bind this file's target for the room to draw into, w by h. False, and the caller draws
    // to the canvas as before.
    begin(w, h) {
      if (broken || !size(w, h) || !sceneTarget()) return false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.ms);
      gl.viewport(0, 0, w, h);
      return true;
    },
    // ...then resolve it and put the graded picture on the canvas. `proj` is the room's projection (roomProj),
    // for the occlusion's view-space depth.
    finish(proj, T = ROOM_POST) {
      if (!S) return false;
      if (S.ms !== S.res) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, S.ms); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, S.res);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      }
      compose(S.col, S.dep, null, proj, T);
      return true;
    },
    // With the lens: its resolved colour and depth in, the graded picture out, as a texture the lens reads in
    // place of its own colour. Null, and the lens reads its own.
    grade(col, dep, w, h, proj, T = ROOM_POST) {
      if (broken || !size(w, h)) return null;
      compose(col, dep, G.fbo, proj, T);
      return G.tex;
    },
    get last() { return last; },
    dispose() {
      try { freeAll(); } catch { /* the context may be gone already */ }
      try { ssao?.dispose(); } catch { /* the context may be gone already */ }
      try { gl.deleteVertexArray(vao); gl.deleteTexture(white); gl.deleteTexture(black); } catch { /* gone */ }
    },
  };
}
