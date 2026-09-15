// THE OCCLUSION THE OTHER TWO TERMS CANNOT SEE.
//
// GLASS already has two ambient-occlusion terms and they are both deliberately local. `uAo` is a
// HEIGHT term — the ground robs a surface of sky the closer it is to the ground — and `vBakedAo` is
// sampled at mesh-capture time against THE MODEL'S OWN solid volume, so it finds a recessed
// doorway, the underside of a sill and the inner corner of a setback. Neither can see past the
// edge of the building it belongs to.
//
// So the case neither answers is the one a city is made of: a narrow gap between two DIFFERENT
// buildings, a canopy over a neighbour's frontage, an alley. The baked pass would have to sample
// every other building in the window — which changes with the camera, so it could not live in the
// per-model memo that makes it affordable — and the height term has no idea anything is there.
// That is what a screen-space pass is for, and it is the one kind of occlusion that gets the
// neighbours for free, because the depth buffer already has all of them in it.
//
// ⚠ IT NEEDS A DEPTH TEXTURE, AND THE MAIN PASS CANNOT GIVE IT ONE. GLASS 2 renders into the
// DEFAULT framebuffer, whose depth is a renderbuffer nothing can sample, and moving the world into
// an offscreen target is the float-target change this renderer has deliberately not made yet. A
// depth-only PREPASS avoids the whole question: one more draw of a vertex buffer that is already
// built and already resident, exactly what the sun's shadow pass does, which measures at 0 ms.
//
// ⚠ AND IT NEEDS NO MATRIX INVERSE, WHICH IS WHY THERE IS NO invert4 IN camera.js. The textbook
// reconstruction multiplies a clip-space point by the inverse view-projection; this projection
// hands the answer over directly instead. From `projMatrix`:
//
//     clip.x = fxn·v.x        clip.y = fyn·v.y + cy0·v.z        clip.z = A·v.z + B        clip.w = v.z
//
// so `clip.w` IS the camera-forward distance, and a depth sample inverts to it with one divide:
// ndcZ = A + B/w, therefore w = B / (ndcZ − A). The other two axes fall out of the same three
// constants. Five scalars, no inverse, and nothing that can drift from the matrix the vertices
// actually went through — the parity gate holds that matrix still, and this reads its own terms
// off the same function.
//
// ⚠ VIEW SPACE IS METRIC HERE. `viewMatrix` is a rotation and a translation with no scale, so a
// radius in view space is a radius in TILES and the one tunable that matters can be written in the
// unit the rest of the renderer thinks in.
//
// ⚠ AND EVERY EXIT RETURNS null. A framebuffer the driver will not complete, a texture it will not
// allocate, a program that will not link: each of those leaves the main shader sampling something
// undefined, and undefined in an occlusion term is not a missing shadow, it is a BLACK CITY. So
// nothing is half-installed — either the layer reports a texture, or the caller runs the pass it
// has always run with the strength at zero, where the multiply is by exactly 1.0.

// How many taps the hemisphere is sampled with. Twelve is where the noise stops being structured
// enough for the blur to leave streaks, and it is a per-fragment loop bound so it is stamped into
// the source the way MAX_LIGHTS is rather than being a uniform.
export const SSAO_TAPS = 12;

// The kernel, generated once and shared by every view. ⚠ FIXED, NOT RANDOM PER RUN: an unseeded
// kernel makes two runs of the same bench disagree, and every measurement in this renderer is a
// before/after on one scene. The per-pixel rotation below is what turns twelve fixed directions
// into something the blur can average; the kernel itself must not move.
function buildKernel(n) {
  const out = new Float32Array(n * 3);
  // A deterministic low-discrepancy-ish spread rather than Math.random, for the reason above.
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963229728653;              // the golden angle, in radians
    const z = (i + 0.5) / n;                      // 0..1 up the hemisphere
    const r = Math.sqrt(1 - z * z);
    // ⚠ THE LENGTH IS SCALED SO SAMPLES CLUSTER NEAR THE ORIGIN. A uniform hemisphere puts most of
    // its points near the rim, where they answer "is there something a whole radius away" — which
    // is a question about the scene rather than about this corner, and it reads as a grey wash over
    // everything instead of a darkening in the crease.
    const L = 0.35 + 0.65 * ((i + 1) / n) * ((i + 1) / n);
    out[i * 3] = Math.cos(a) * r * L;
    out[i * 3 + 1] = Math.sin(a) * r * L;
    out[i * 3 + 2] = z * L;
  }
  return out;
}
const KERNEL = buildKernel(SSAO_TAPS);

// ── THE RECONSTRUCTION, IN JS, SO SOMETHING CAN CHECK IT ──────────────────────────────────────
//
// The two lines below are the whole of what this pass depends on being right, and they live inside
// a fragment shader where nothing without a GPU can reach them. A wrong constant here does not
// throw and does not draw nothing: it draws occlusion in the wrong places, which looks like the
// radius being badly tuned. So this is the same arithmetic as a plain function, and
// `npm run gl:ssao` round-trips it against camera.js's own `projMatrix` — the matrix the vertices
// actually go through — so a change to the projection fails a gate instead of quietly moving the
// occlusion off the geometry.
//
// ⚠ THIS IS A TRANSCRIPTION PAIR AND THE TWO MUST BE EDITED TOGETHER. The GLSL below is the copy
// that runs; this is the copy that is tested. Nothing enforces that they say the same thing, which
// is exactly the same deliberate duplication as the tangent frame shared by `faceEdges` and the
// mass shader, and it is flagged here for the same reason.
export const RECONSTRUCT = {
  // A depth-buffer sample back to the camera-forward distance, in tiles.
  dist(dz, A, B) {
    if (dz >= 0.999999) return Infinity;
    const den = dz * 2 - 1 - A;
    return den < -1e-6 ? B / den : Infinity;
  },
  // And a pixel plus that distance back to the view-space point behind it.
  view(ndcX, ndcY, w, fxn, fyn, cy0) {
    return [ndcX * w / fxn, (ndcY - cy0) * w / fyn, w];
  },
};

const DEPTH_VERT = `#version 300 es
in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

const DEPTH_FRAG = `#version 300 es
precision mediump float;
void main() { }`;

// One screen-filling triangle from gl_VertexID, so the pass owns no vertex buffer at all.
const FULL_VERT = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const AO_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUV;
uniform sampler2D uDepth;
uniform vec3 uKernel[SSAO_TAPS];
// The five projection constants — see the header. fxn, fyn, cy0 place a point on the screen; A and
// B are the depth mapping, and they are what makes a depth sample a distance in tiles.
// ⚠ ONE PER LINE, NEVER 'uniform float uFxn, uFyn, ...'. The GLSL name gate reads declarations with
// a regex and takes the FIRST name off a multi-declarator, so four of these five would be invisible
// to it — the same miss imports:smoke records for a multi-declarator export. The gate caught this
// one, which is the argument for spelling them out rather than for loosening the gate.
uniform float uFxn;
uniform float uFyn;
uniform float uCy0;
uniform float uA;
uniform float uB;
uniform float uRadius;    // in tiles, because view space here is metric
uniform float uBias;      // how far a sample must be in front before it counts, in tiles
uniform vec2 uTexel;
out vec4 outColor;

// A depth sample, as the camera-forward distance in tiles. Returns a huge number for the far plane
// so the sky never occludes anything.
float distAt(vec2 uv) {
  float dz = texture(uDepth, uv).r;
  if (dz >= 0.999999) return 1e6;
  float ndc = dz * 2.0 - 1.0;
  float den = ndc - uA;
  // ⚠ A COMPARISON, NOT A CLAMP. den is zero exactly at the far plane and the divide is an
  // infinity, which propagates into every term downstream; the same argument as the shadow's NaN
  // guard, where one bad value painted 10% of the city black.
  return den < -1e-6 ? uB / den : 1e6;
}

// The view-space point behind a pixel. See the header for the three lines this inverts.
vec3 viewAt(vec2 uv, float w) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * w / uFxn, (ndc.y - uCy0) * w / uFyn, w);
}

void main() {
  float w = distAt(vUV);
  // Sky, or beyond the far plane. Nothing to occlude, and writing 1.0 is what makes the blur below
  // average toward "open" at the silhouette instead of dragging a dark rim off the building.
  if (w > 9e5) { outColor = vec4(1.0); return; }
  vec3 P = viewAt(vUV, w);

  // ⚠ THE NORMAL COMES FROM THE DEPTH BUFFER'S OWN DERIVATIVES, NOT FROM A G-BUFFER. Writing normals
  // would mean a second attachment, a float format to hold them and a fallback for the devices that
  // cannot render to one. The cross product of the screen-space derivatives of the reconstructed
  // position is the same normal to within a pixel, and it costs two subtractions.
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  // The eye is at the origin of view space, so a normal facing away from it is facing the wrong
  // way — which happens on the far side of a silhouette where the derivative straddles an edge.
  if (dot(N, P) > 0.0) N = -N;

  // A per-pixel rotation of the kernel, so twelve fixed directions do not print twelve fixed bands
  // across every wall. The blur afterwards is what turns this back into a smooth term.
  float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float ca = cos(h * 6.2831853), sa = sin(h * 6.2831853);

  // An orthonormal frame about N. ⚠ The seed axis must not be parallel to N, or the cross product
  // is zero and every sample direction collapses onto the normal — a model-wide uniform grey, which
  // reads as a strength setting rather than as a bug. Same trap as the baked bake's frame.
  vec3 up = abs(N.z) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 T = normalize(cross(up, N));
  vec3 B2 = cross(N, T);

  float occ = 0.0;
  for (int i = 0; i < SSAO_TAPS; i++) {
    vec3 k = uKernel[i];
    vec2 kr = vec2(k.x * ca - k.y * sa, k.x * sa + k.y * ca);
    vec3 q = P + (T * kr.x + B2 * kr.y + N * k.z) * uRadius;
    if (q.z < 0.05) continue;                     // behind the eye; nothing to project to
    // Project the sample back to the screen with the same three lines the vertex shader uses.
    vec2 sUV = vec2(uFxn * q.x / q.z, uFyn * q.y / q.z + uCy0) * 0.5 + 0.5;
    if (sUV.x < 0.0 || sUV.x > 1.0 || sUV.y < 0.0 || sUV.y > 1.0) continue;
    float sceneW = distAt(sUV);
    // Occluded when the scene at that pixel is NEARER than the sample point we placed there.
    if (sceneW < q.z - uBias) {
      // ⚠ AND RANGE-CHECKED, WHICH IS WHAT STOPS THE HALO. Without this, a tower a hundred tiles
      // behind a lamp post counts as occluding it, and every silhouette in the city wears a dark
      // outline against whatever is far away behind it — the single most recognisable way a
      // screen-space pass announces itself.
      occ += smoothstep(0.0, 1.0, uRadius / max(1e-4, abs(P.z - sceneW)));
    }
  }
  outColor = vec4(1.0 - occ / float(SSAO_TAPS));
}`;

// A separable-ish box over the noise. Four by four, one pass, because the kernel rotation is
// per pixel and uncorrelated — there is no structure left for a wider or a two-pass blur to find.
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  float s = 0.0;
  for (int y = -2; y < 2; y++) {
    for (int x = -2; x < 2; x++) {
      s += texture(uSrc, vUV + vec2(float(x) + 0.5, float(y) + 0.5) * uTexel).r;
    }
  }
  outColor = vec4(s / 16.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('ssao shader: ' + log);
  }
  return sh;
}

function link(gl, vsrc, fsrc, bindPos) {
  const prog = gl.createProgram();
  let vs, fs;
  try { vs = compile(gl, gl.VERTEX_SHADER, vsrc); fs = compile(gl, gl.FRAGMENT_SHADER, fsrc); }
  catch { return null; }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (bindPos != null) gl.bindAttribLocation(prog, bindPos, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  return prog;
}

function colorTarget(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return null; }
  return { tex, fbo };
}

// `posLoc` is the attribute location the MASS program uses for aPos, forced to match for exactly
// the reason shadow.js gives: a VAO records its pointers against LOCATIONS, and this layer draws
// the mass program's own VAO rather than building a second copy of the city.
export function createSSAOLayer(gl, posLoc) {
  const withTaps = (s) => s.split('SSAO_TAPS').join(String(SSAO_TAPS));
  const depthProg = link(gl, DEPTH_VERT, DEPTH_FRAG, posLoc);
  const aoProg = link(gl, FULL_VERT, withTaps(AO_FRAG));
  const blurProg = link(gl, FULL_VERT, BLUR_FRAG);
  if (!depthProg || !aoProg || !blurProg) return null;

  const uDepthVP = gl.getUniformLocation(depthProg, 'uViewProj');
  const ao = {
    depth: gl.getUniformLocation(aoProg, 'uDepth'),
    kernel: gl.getUniformLocation(aoProg, 'uKernel'),
    fxn: gl.getUniformLocation(aoProg, 'uFxn'), fyn: gl.getUniformLocation(aoProg, 'uFyn'),
    cy0: gl.getUniformLocation(aoProg, 'uCy0'), A: gl.getUniformLocation(aoProg, 'uA'),
    B: gl.getUniformLocation(aoProg, 'uB'), radius: gl.getUniformLocation(aoProg, 'uRadius'),
    bias: gl.getUniformLocation(aoProg, 'uBias'), texel: gl.getUniformLocation(aoProg, 'uTexel'),
  };
  const bl = { src: gl.getUniformLocation(blurProg, 'uSrc'), texel: gl.getUniformLocation(blurProg, 'uTexel') };
  if (!uDepthVP || !ao.depth || !ao.kernel) return null;

  // An empty VAO for the screen-filling triangle. It has no attributes — the vertices come from
  // gl_VertexID — but a bound VAO is what keeps the mass program's own array state out of it.
  const emptyVao = gl.createVertexArray();

  let W = 0, H = 0, depthTex = null, depthFbo = null, raw = null, blurred = null;

  function resize(w, h) {
    if (w === W && h === H && depthTex) return true;
    dispose();
    W = w; H = h;
    depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    depthFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, depthFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    // ⚠ NO COLOUR ATTACHMENT, SO BOTH BUFFERS HAVE TO BE SAID TO BE NONE — a framebuffer pointing
    // at a colour attachment that is not there is INCOMPLETE, and an incomplete one fails the pass
    // with no error anybody sees. Same note as shadow.js.
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { dispose(); return false; }
    raw = colorTarget(gl, w, h);
    blurred = colorTarget(gl, w, h);
    if (!raw || !blurred) { dispose(); return false; }
    return true;
  }

  function dispose() {
    if (depthFbo) gl.deleteFramebuffer(depthFbo);
    if (depthTex) gl.deleteTexture(depthTex);
    for (const t of [raw, blurred]) if (t) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
    depthFbo = depthTex = raw = blurred = null; W = H = 0;
  }

  // Draws the mass into depth from the camera, then resolves occlusion into a texture. Returns the
  // texture to sample, or null — and null is a full answer: the caller sets the strength to 0.
  function render(vao, count, viewProj, cam, w, h, opts) {
    if (!count || !vao || !cam) return null;
    if (!resize(w, h)) return null;

    // ── 1. DEPTH, FROM THE CAMERA ──────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, depthFbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    // ⚠ NO CULL, for shadow.js's reason: GLASS's buildings are not closed solids, so culling drops
    // exactly the soffits and canopy undersides a cab looks up at.
    gl.disable(gl.CULL_FACE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(depthProg);
    gl.uniformMatrix4fv(uDepthVP, false, viewProj);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);

    // ── 2. OCCLUSION ───────────────────────────────────────────────────────
    const fxn = 2 * cam.FL / cam.W;
    const fyn = 2 * cam.depth / cam.H;
    const cy0 = 1 - 2 * cam.horizonY / cam.H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, raw.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(aoProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(ao.depth, 0);
    gl.uniform3fv(ao.kernel, KERNEL);
    gl.uniform1f(ao.fxn, fxn); gl.uniform1f(ao.fyn, fyn); gl.uniform1f(ao.cy0, cy0);
    gl.uniform1f(ao.A, opts.A); gl.uniform1f(ao.B, opts.B);
    gl.uniform1f(ao.radius, opts.radius);
    gl.uniform1f(ao.bias, opts.bias);
    gl.uniform2f(ao.texel, 1 / W, 1 / H);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── 3. AND THE NOISE OFF IT ────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurred.fbo);
    gl.useProgram(blurProg);
    gl.bindTexture(gl.TEXTURE_2D, raw.tex);
    gl.uniform1i(bl.src, 0);
    gl.uniform2f(bl.texel, 1 / W, 1 / H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // ⚠ AND THE STATE THIS PASS CHANGED GOES BACK, WHICH IS NOT TIDINESS. The two full-screen draws
    // above need the depth test off and the depth mask closed; leave the MASK closed and the pass
    // that follows — the whole city, then the ground, then every sprite and decal — writes no depth
    // at all. What that looks like is not a missing occlusion term: the ground draws over the
    // buildings, the sort collapses, and pixels come back BRIGHTER than they were.
    //
    // It was measured before it was found. `__glSsao()` reported 55% of moved pixels going darker
    // where occlusion can only ever be 100%, and 16% of the OFF-BUILDING frame moving in a term
    // that may only touch mass. Both are impossible for an occlusion multiply and neither points
    // anywhere near this line, which is the argument for the bench carrying those two columns.
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    // Unit 0 is the atlas's, and this pass borrowed it. A caller drawing untextured leaves uAtlas
    // pointing at whatever is bound, and that would be the occlusion buffer.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return blurred.tex;
  }

  return { render, dispose, get size() { return [W, H]; } };
}
