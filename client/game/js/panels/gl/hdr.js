// A FLOAT TARGET, SO LIGHT CAN BE BRIGHTER THAN WHITE.
//
// Every pass in GLASS 2 renders straight into the default framebuffer, which is eight bits a
// channel. That is the ceiling under every other thing in this renderer: a neon sign, a lit window,
// the sun's highlight and the city's wall wash all resolve into the same 0..1 and CLIP. What a
// bright thing looks like here is therefore a flat white patch, and the only way anything has ever
// glowed is `shadowBlur` on the 2-D canvas or a hand-placed sprite standing in front of it.
//
// This renders the whole GL frame into an RGBA16F buffer instead, and resolves it at the end. Two
// things fall out of that and nothing else does:
//
//   1. Additive layers stop clipping. The sprites, the curtain and the wall wash all blend ONE,ONE,
//      so a dense frontage was already summing past 1.0 and throwing the remainder away.
//   2. There is something for a bright-pass to find. Bloom is not a blur of the picture — it is a
//      blur of the part of the picture that is brighter than the display can show, which in an
//      8-bit buffer does not exist by definition.
//
// ⚠ THE TONE CURVE IS A SEPARATE KNOB FROM THE BUFFER, AND THAT SPLIT IS THE WHOLE SAFETY ARGUMENT.
// A filmic curve touches EVERY pixel: it would re-grade the palettes, the three occlusion terms, the
// material response and the wall-wash gain, all of which were tuned by eye against a linear 8-bit
// output over months. So `glHdr` buys the headroom and the bloom, and `glTonemap` is what decides
// how much of the curve is applied — at 0 the composite is a clamp, which is arithmetically the
// same thing the 8-bit buffer was doing, and the frame differs only by the bloom that is added.
//
// ⚠ AND MSAA IS RESOLVED, NOT DROPPED. The default framebuffer was created with `antialias`, and
// moving the world into a single-sample texture would quietly hand back aliased building edges —
// a regression nobody asked for, arriving inside a change about brightness. The colour and depth
// attachments are multisampled renderbuffers and `blitFramebuffer` resolves them.
//
// ⚠ EVERY EXIT RETURNS null, for the reason the shadow and occlusion layers do: half-installed is
// worse than absent. If the float format is not renderable on this device, or a framebuffer will
// not complete, or a program will not link, the caller renders to the default framebuffer exactly
// as it always has.

// How far down the chain bloom is gathered. Two octaves: a half-resolution pass for the tight halo
// around a sign, and a quarter-resolution one for the broad wash a lit street throws into the air.
// One octave alone reads as an outline rather than a glow, and it is the cheaper half.
const OCTAVES = [2, 4];

const FULL_VERT = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// ⚠ THE THRESHOLD IS ON UN-PREMULTIPLIED COLOUR AND THE RESULT IS RE-PREMULTIPLIED. The buffer holds
// premultiplied pixels, so a half-covered sign is stored at half its brightness — threshold that
// directly and a thin neon tube against the sky fails to bloom purely because it is thin. What
// decides whether something is bright is its COLOUR; how much light it contributes is its coverage.
const BRIGHT_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform float uThreshold;
uniform float uKnee;
// 1 when the scene is linear light (RENDER_TUNE.glLinear). The threshold, knee and blur were tuned on
// display values, and in linear light an emitter just over white carries several times the energy
// above the threshold and its blurred tail lifts when encoded: every glow came out larger. So the
// bloom is gathered, blurred and added on display values, exactly as at 0.
uniform float uLinear;
out vec4 outColor;
${LINEAR_GLSL}
void main() {
  vec4 s = texture(uSrc, vUV);
  // ⚠ CLAMPED TO 1, AND THIS ONE LINE IS THE DIFFERENCE BETWEEN A BLOOM AND NO BLOOM AT ALL. The
  // additive layers blend ONE,ONE — which adds the ALPHA as well as the colour — and in an 8-bit
  // buffer that saturated at 1.0 on its own. A float buffer does not saturate, so three overlapping
  // glows leave coverage at 3.0, and un-premultiplying by it divides away precisely the brightness
  // this pass exists to find. Measured before the clamp: 0.0% of the frame moved at every bloom
  // strength, which is the signature of a feature that is wired, correct and pointed at nothing.
  // Coverage is a fraction by definition; energy is what is allowed to exceed one.
  float a = clamp(s.a, 1e-4, 1.0);
  vec3 c = s.rgb / a;
  if (uLinear > 0.5) c = glassSrgb(c);
  float l = max(c.r, max(c.g, c.b));
  // A soft knee, so a surface drifting across the threshold does not pop. The curve is flat below
  // the knee, quadratic through it and linear above.
  float w = l <= uThreshold ? 0.0
          : (l < uThreshold + uKnee
             ? (l - uThreshold) * (l - uThreshold) / max(1e-4, 2.0 * uKnee)
             : l - uThreshold - uKnee * 0.5);
  outColor = vec4(c * (w / max(l, 1e-4)) * s.a, s.a);
}`;

// Separable gaussian. Nine taps, which at two octaves is a wide enough kernel that the second
// octave is doing the reaching rather than this one.
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec4 s = texture(uSrc, vUV) * 0.2270270270;
  s += (texture(uSrc, vUV + uStep * 1.3846153846) + texture(uSrc, vUV - uStep * 1.3846153846)) * 0.3162162162;
  s += (texture(uSrc, vUV + uStep * 3.2307692308) + texture(uSrc, vUV - uStep * 3.2307692308)) * 0.0702702703;
  outColor = s;
}`;

const DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec4 s = texture(uSrc, vUV + uStep * vec2(-1.0, -1.0));
  s += texture(uSrc, vUV + uStep * vec2(1.0, -1.0));
  s += texture(uSrc, vUV + uStep * vec2(-1.0, 1.0));
  s += texture(uSrc, vUV + uStep * vec2(1.0, 1.0));
  outColor = s * 0.25;
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform float uBloom;
uniform float uTonemap;
uniform float uExposure;
// 1 when the scene is linear light (RENDER_TUNE.glLinear), which goes back to display values here.
uniform float uLinear;
out vec4 outColor;
${LINEAR_GLSL}
// Narkowicz's fit of the ACES filmic curve. Cheap, and it is the curve almost every real-time
// renderer means when it says "tonemapped".
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
// ⚠ THE CLAMP KEEPS THE HUE OF WHAT GOES PAST WHITE. Clamping each channel on its own turns any
// colour pushed past 1.0 toward white: a pink tube at 1.9x has its red and blue both pinned at 1,
// and every neon sign in the city came out pale pink-white with a coloured fringe. Past 1.0 the
// colour is scaled down to its brightest channel instead, and white comes in only as the overshoot
// grows, so a tube's walls stay saturated and its axis still blows out. At or under 1.0 this is
// exactly the clamp, and only quads that declare themselves light ever reach past it.
vec3 keepHue(vec3 c) {
  c = max(c, 0.0);
  float m = max(c.r, max(c.g, c.b));
  if (m <= 1.0) return c;
  float k = clamp((m - 1.0) / 1.5, 0.0, 1.0);
  return mix(c / m, vec3(1.0), k * k * 0.7);
}

void main() {
  vec4 s = texture(uScene, vUV);
  // ⚠ A LINEAR SCENE GOES BACK TO DISPLAY VALUES HERE, BEFORE THE BLOOM AND THE CURVE. Both were tuned
  // on display values (see uLinear in the bright-pass), so from this line on the composite is the one
  // that ships at 0. The light was added in linear upstream; this only changes what the curve reads.
  if (uLinear > 0.5) { float sa = max(s.a, 1e-4); s.rgb = glassSrgb(s.rgb / sa) * sa; }
  // Both octaves are premultiplied energy, exactly as the scene is, so they add directly.
  vec3 bloom = (texture(uBloom0, vUV).rgb + texture(uBloom1, vUV).rgb) * uBloom;

  // ⚠ BLOOM HAS TO RAISE THE ALPHA OR IT IS INVISIBLE WHERE IT MATTERS MOST. This buffer is
  // composited onto the 2-D frame, so a pixel with no coverage contributes nothing however bright
  // it is — and the whole point of a glow is that it spreads OFF the sign and onto the sky behind
  // it. So the light a pixel gained becomes coverage it did not have.
  float bl = max(bloom.r, max(bloom.g, bloom.b));
  // ⚠ THE SCENE'S OWN COVERAGE IS CLAMPED FIRST, for the reason the bright-pass is: ONE,ONE
  // accumulates alpha, so an additive pixel arrives claiming coverage of three.
  float a = clamp(min(s.a, 1.0) + bl, 0.0, 1.0);
  if (a <= 0.0) { outColor = vec4(0.0); return; }

  // Un-premultiply against the NEW coverage, grade, and put it back. Tonemapping a premultiplied
  // value is wrong — the curve is not linear, so T(c·a) is not T(c)·a — and at low coverage that
  // error is the whole pixel.
  vec3 c = (s.rgb + bloom) / a * uExposure;
  // ⚠ A LERP, NOT A SWITCH, AND AT 0 IT IS EXACTLY THE CLAMP AN 8-BIT BUFFER ALREADY DID. The curve
  // touches every pixel in the city, including palettes and three occlusion terms tuned by eye
  // against a linear output; this is what lets the headroom and the bloom ship without also
  // shipping a re-grade nobody asked for.
  vec3 graded = mix(keepHue(c), aces(c), clamp(uTonemap, 0.0, 1.0));
  outColor = vec4(graded * a, a);
}`;

import { declareProgram, takeWarm } from './programs.js';
import { LINEAR_GLSL } from './colour.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('hdr shader: ' + log);
  }
  return sh;
}

function link(gl, fsrc) {
  // Prewarmed with the context when it can be (programs.js).
  const warm = takeWarm(gl, FULL_VERT, fsrc);
  if (warm) return gl.getProgramParameter(warm, gl.LINK_STATUS) ? warm : null;
  const prog = gl.createProgram();
  let vs, fs;
  try { vs = compile(gl, gl.VERTEX_SHADER, FULL_VERT); fs = compile(gl, gl.FRAGMENT_SHADER, fsrc); }
  catch { return null; }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  return prog;
}

function target(gl, w, h, fmt) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, fmt === gl.RGBA16F ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  // ⚠ LINEAR, AND THE BLOOM CHAIN DEPENDS ON IT. Every stage below samples at a different
  // resolution from the one it was written at; with NEAREST the glow comes back as visible blocks.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // ⚠ CLAMP, or a bright sign at one edge of the frame throws a glow off the opposite edge.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return null; }
  return { tex, fbo, w, h };
}

// ── FXAA, AFTER THE GRADE ────────────────────────────────────────────────────
//
// Lottes' FXAA, the console-quality variant cut down: a luma edge test, a direction from the local
// gradient, and a blend along it. It runs on the GRADED eight-bit frame because that is what the
// eye compares — edge contrast in linear HDR would weight a neon tube a hundred times a wall.
//
// ⚠ THE BUFFER IS PREMULTIPLIED AND GOES ONTO THE 2-D CANVAS, so all four channels are filtered
// together. Luma is taken from the premultiplied colour, which makes an edge against transparent
// sky (no coverage) register as an edge, which is exactly the silhouette that most wants smoothing.
const FXAA_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 outColor;
float luma(vec4 c) { return dot(c.rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 cM = texture(uSrc, vUV);
  float lM = luma(cM);
  float lNW = luma(texture(uSrc, vUV + vec2(-1.0, -1.0) * uTexel));
  float lNE = luma(texture(uSrc, vUV + vec2( 1.0, -1.0) * uTexel));
  float lSW = luma(texture(uSrc, vUV + vec2(-1.0,  1.0) * uTexel));
  float lSE = luma(texture(uSrc, vUV + vec2( 1.0,  1.0) * uTexel));
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  // Below this contrast the pixel is left alone: flat surfaces and texture grain are not edges, and
  // filtering them is how FXAA earns its reputation for blurring everything.
  if (lMax - lMin < max(0.0312, lMax * 0.125)) { outColor = cM; return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
  vec4 a = 0.5 * (texture(uSrc, vUV + dir * (1.0 / 3.0 - 0.5)) + texture(uSrc, vUV + dir * (2.0 / 3.0 - 0.5)));
  vec4 b = a * 0.5 + 0.25 * (texture(uSrc, vUV - dir * 0.5) + texture(uSrc, vUV + dir * 0.5));
  float lB = luma(b);
  // The wide tap can jump across a second edge; if it lands outside the local range, keep the narrow one.
  outColor = (lB < lMin || lB > lMax) ? a : b;
}`;

export function createHDRLayer(gl) {
  // ⚠ WITHOUT THIS EXTENSION RGBA16F IS NOT COLOUR-RENDERABLE, and the framebuffer simply comes
  // back incomplete. It is core-adjacent and near-universal on anything that runs WebGL2 at all,
  // but "near-universal" is exactly the class of assumption every other layer here refuses to make.
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  const bright = link(gl, BRIGHT_FRAG);
  const blur = link(gl, BLUR_FRAG);
  const down = link(gl, DOWN_FRAG);
  const comp = link(gl, COMPOSITE_FRAG);
  if (!bright || !blur || !down || !comp) return null;
  // Optional: a device that will not link it simply composites without FXAA.
  const fxaa = link(gl, FXAA_FRAG);

  const u = {
    brightSrc: gl.getUniformLocation(bright, 'uSrc'),
    brightT: gl.getUniformLocation(bright, 'uThreshold'),
    brightK: gl.getUniformLocation(bright, 'uKnee'),
    brightLin: gl.getUniformLocation(bright, 'uLinear'),
    blurSrc: gl.getUniformLocation(blur, 'uSrc'), blurStep: gl.getUniformLocation(blur, 'uStep'),
    downSrc: gl.getUniformLocation(down, 'uSrc'), downStep: gl.getUniformLocation(down, 'uStep'),
    compScene: gl.getUniformLocation(comp, 'uScene'),
    compB0: gl.getUniformLocation(comp, 'uBloom0'), compB1: gl.getUniformLocation(comp, 'uBloom1'),
    compBloom: gl.getUniformLocation(comp, 'uBloom'),
    compTone: gl.getUniformLocation(comp, 'uTonemap'),
    compExp: gl.getUniformLocation(comp, 'uExposure'),
    compLin: gl.getUniformLocation(comp, 'uLinear'),
    fxaaSrc: fxaa ? gl.getUniformLocation(fxaa, 'uSrc') : null,
    fxaaTexel: fxaa ? gl.getUniformLocation(fxaa, 'uTexel') : null,
  };
  const emptyVao = gl.createVertexArray();

  let W = 0, H = 0, samples = 0;
  let msFbo = null, msColor = null, msDepth = null, resolved = null;
  let ldr = null;     // the graded eight-bit frame FXAA reads; built on first use
  let chain = [];      // per octave: { bright, a, b }
  let bound = false;

  function dispose() {
    if (msFbo) gl.deleteFramebuffer(msFbo);
    if (msColor) gl.deleteRenderbuffer(msColor);
    if (msDepth) gl.deleteRenderbuffer(msDepth);
    for (const t of [resolved, ldr, ...chain.flatMap((c) => [c.bright, c.a, c.b])]) {
      if (t) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
    }
    msFbo = msColor = msDepth = resolved = ldr = null; chain = []; W = H = 0;
  }

  function resize(w, h) {
    if (w === W && h === H && msFbo) return true;
    dispose();
    W = w; H = h;
    // The device's own best sample count for this format, capped — four is where the returns on a
    // building edge stop being visible and the bandwidth keeps going up.
    const avail = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    samples = Math.min(4, (avail && avail.length ? avail[0] : 0) || 0);

    msColor = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
    if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h);
    else gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA16F, w, h);
    msDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
    if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    msFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { dispose(); return false; }

    resolved = target(gl, w, h, gl.RGBA16F);
    if (!resolved) { dispose(); return false; }
    for (const div of OCTAVES) {
      const bw = Math.max(1, Math.floor(w / div)), bh = Math.max(1, Math.floor(h / div));
      const c = { bright: target(gl, bw, bh, gl.RGBA16F), a: target(gl, bw, bh, gl.RGBA16F), b: target(gl, bw, bh, gl.RGBA16F) };
      if (!c.bright || !c.a || !c.b) { dispose(); return false; }
      chain.push(c);
    }
    return true;
  }

  // Bind the float target so everything that follows renders into it. ⚠ DOES NOT CLEAR: the world
  // pass clears colour and depth itself and the cloud pass deliberately clears only colour, and
  // that difference is what lets the deck test against the city's depth. Clearing here would
  // quietly delete the second half of that.
  function bind(w, h) {
    if (!resize(w, h)) { bound = false; return false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
    gl.viewport(0, 0, w, h);
    bound = true;
    return true;
  }

  const fullscreen = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
  const use = (prog, fbo, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
  };

  // Resolve, gather the bloom and grade it onto the default framebuffer. Returns what it did, or
  // null if there was nothing bound to resolve.
  function composite(opts = {}) {
    if (!bound) return null;
    bound = false;

    // ⚠ THE STATE THE SCENE LEFT BEHIND HAS TO GO BEFORE ANY OF THIS. A full-screen pass with the
    // depth test still enabled is tested against whatever the city wrote, which on a frame with a
    // building in the middle of it means the composite is drawn everywhere EXCEPT where the city is.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(emptyVao);

    // 1. Multisample resolve. ⚠ NEAREST and matching rectangles: a resolve blit is not a scale.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolved.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    const bloomOn = opts.bloom > 0;
    gl.activeTexture(gl.TEXTURE0);
    if (bloomOn) {
      // 2. Bright-pass into the first octave, then each later octave downsamples the one above it.
      for (let i = 0; i < chain.length; i++) {
        const c = chain[i];
        if (i === 0) {
          use(bright, c.bright.fbo, c.bright.w, c.bright.h);
          gl.bindTexture(gl.TEXTURE_2D, resolved.tex);
          gl.uniform1i(u.brightSrc, 0);
          gl.uniform1f(u.brightT, opts.threshold == null ? 1 : opts.threshold);
          gl.uniform1f(u.brightK, opts.knee == null ? 0.5 : opts.knee);
          gl.uniform1f(u.brightLin, opts.linear > 0 ? 1 : 0);
        } else {
          use(down, c.bright.fbo, c.bright.w, c.bright.h);
          gl.bindTexture(gl.TEXTURE_2D, chain[i - 1].b.tex);
          gl.uniform1i(u.downSrc, 0);
          gl.uniform2f(u.downStep, 0.5 / chain[i - 1].b.w, 0.5 / chain[i - 1].b.h);
        }
        fullscreen();
        // 3. Separable blur, horizontal then vertical.
        use(blur, c.a.fbo, c.a.w, c.a.h);
        gl.bindTexture(gl.TEXTURE_2D, c.bright.tex);
        gl.uniform1i(u.blurSrc, 0);
        gl.uniform2f(u.blurStep, 1 / c.a.w, 0);
        fullscreen();
        use(blur, c.b.fbo, c.b.w, c.b.h);
        gl.bindTexture(gl.TEXTURE_2D, c.a.tex);
        gl.uniform1i(u.blurSrc, 0);
        gl.uniform2f(u.blurStep, 0, 1 / c.b.h);
        fullscreen();
      }
    }

    // 4. Grade onto the canvas — or, with FXAA, into an eight-bit target that pass then reads.
    // ⚠ Built lazily and kept, so a frame with FXAA off allocates nothing new.
    let aa = false;
    if (opts.fxaa > 0 && fxaa) {
      if (!ldr) ldr = target(gl, W, H, gl.RGBA8);
      aa = !!ldr;
    }
    use(comp, aa ? ldr.fbo : null, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, resolved.tex); gl.uniform1i(u.compScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomOn ? chain[0].b.tex : resolved.tex); gl.uniform1i(u.compB0, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bloomOn ? chain[1].b.tex : resolved.tex); gl.uniform1i(u.compB1, 2);
    gl.uniform1f(u.compBloom, bloomOn ? opts.bloom : 0);
    gl.uniform1f(u.compTone, opts.tonemap > 0 ? opts.tonemap : 0);
    gl.uniform1f(u.compExp, opts.exposure > 0 ? opts.exposure : 1);
    gl.uniform1f(u.compLin, opts.linear > 0 ? 1 : 0);
    fullscreen();
    if (aa) {
      // 5. FXAA onto the canvas. ⚠ The source is NEAREST-agnostic: the taps sit on texel centres or
      // between them on purpose, and the target's LINEAR filter is what the sub-pixel taps need.
      use(fxaa, null, W, H);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ldr.tex); gl.uniform1i(u.fxaaSrc, 0);
      gl.uniform2f(u.fxaaTexel, 1 / W, 1 / H);
      fullscreen();
    }

    gl.bindVertexArray(null);
    // ⚠ AND THE STATE GOES BACK, which is the mistake the occlusion pass shipped once: leave the
    // depth mask closed and the NEXT pass into this canvas — the cloud deck, on the same depth
    // buffer — writes none of its own.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    return { samples, octaves: chain.length, fxaa: aa };
  }

  // ── WHAT IS ACTUALLY IN THE BUFFER ─────────────────────────────────────────
  //
  // ⚠ A DIAGNOSTIC, AND IT EXISTS BECAUSE THE BLOOM READ 0.0% AT EVERY STRENGTH AND THERE WAS NO WAY
  // TO TELL WHY. A bright-pass finding nothing is indistinguishable from a bright-pass that is not
  // running, which is indistinguishable from a scene with nothing bright in it — three very
  // different problems with one symptom, and the frame cannot be interrogated afterwards because
  // the drawing buffer is not preserved. This answers the third directly.
  //
  // Reads the RESOLVED float target, so it must be called after a composite. Expensive: a full
  // readPixels and a scan, for a bench rather than for a frame.
  function peak() {
    if (!resolved) return null;
    const buf = new Float32Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolved.fbo);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let maxRGB = 0, maxA = 0, maxUn = 0, over = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const m = Math.max(buf[i], buf[i + 1], buf[i + 2]);
      if (m > maxRGB) maxRGB = m;
      if (buf[i + 3] > maxA) maxA = buf[i + 3];
      // What the bright-pass actually thresholds: premultiplied colour over clamped coverage.
      const a = Math.min(1, Math.max(1e-4, buf[i + 3]));
      const un = m / a;
      if (un > maxUn) maxUn = un;
      if (un > 1) over++;
    }
    return { maxRGB: +maxRGB.toFixed(3), maxAlpha: +maxA.toFixed(3), maxUnpremult: +maxUn.toFixed(3),
      overOnePct: +(over / (W * H) * 100).toFixed(2) };
  }

  return { bind, composite, peak, dispose, get size() { return [W, H]; }, get samples() { return samples; },
    // The framebuffer the scene is drawing into while bound, so a pass that has to rebind it after
    // drawing somewhere else can say so without asking the driver (see cloudvol.js).
    get drawFbo() { return bound ? msFbo : null; } };
}

for (const f of [BRIGHT_FRAG, BLUR_FRAG, DOWN_FRAG, COMPOSITE_FRAG, FXAA_FRAG]) declareProgram(FULL_VERT, f);
