// THE FLY-THROUGH CLOUD DECK, ON THE DEPTH BUFFER.
//
// The deck is a swarm of small puffs, each a short stack of CARDS: a flat shadowed base slab, mid
// billows, a bright crown. Every card is already the same shape the lights and the scatter are — a
// world point, a radius in SCREEN pixels, an alpha — because the 2-D renderer projects the card's
// world offset and fills an ellipse at `R·FL/f`. It never had a third dimension to lose.
//
// ⚠ WHY MOVE IT. Two reasons, and the first is simply the size of it. `npm run shapes:clouds` was
// written before this file and put the deck at **2,757–9,460 canvas calls a frame**, median 5,386,
// against a whole city block's 17,400 — a third of the frame, in radial gradients and ellipse fills,
// and invisible to every gate in the repo because no harness passed a weather field. The second is
// that a painter's queue has to choose: the deck is drawn AFTER the world, so it paints over
// everything, and a thirty-storey tower standing in a 1,600 ft overcast is in front of the cloud on
// the way up and behind it on the way down with no way to say so.
//
// ⚠ IT DRAWS INTO THE SAME BUFFER THE WORLD PASS LEFT, AND CLEARS ONLY THE COLOUR. That is the
// whole trick that makes this cheap: `gl.clear(COLOR_BUFFER_BIT)` keeps the depth the city wrote a
// moment ago, so the cards test against real buildings without the mass being uploaded twice or the
// frame being reordered. Clear DEPTH here as well and every cloud draws over every tower again,
// which looks exactly like it did before and is the bug this exists to fix.
//
// ⚠ DEPTH-TESTED, DEPTH-WRITE OFF, AND SORTED FAR-TO-NEAR ON THE CPU. A card is a translucent
// gradient with no interior: writing depth from it would let its empty half occlude the card behind,
// and alpha-over compositing is order-dependent whatever the depth buffer says. The sort is the same
// `b.f - a.f` the 2-D queue already did, so nothing new is computed.
//
// ⚠ AND EVERY CARD NOW GETS THE TREATMENT ONLY THE BIG ONES COULD AFFORD. In 2-D a card wider than
// 26 px gets a directional gradient raked toward the sun plus a value-noise mottle, and everything
// below that — the bulk of the swarm — blits one of twelve baked sprites lit from straight above,
// with no mottle at all. Both are a fragment shader's ordinary work, so the split does not exist
// here: the two-circle cone the canvas gradient describes is solved per pixel, and the curdle tile
// is a texture read. Same argument as the mesh capturing at ADORN_NEAR — the tier existed because a
// canvas could not afford it.
import { viewProjMatrix } from './camera.js';

// pos3, corner2, half-extent px 2, alpha1, lit1, kind1
const STRIDE = 10;

const VERT = `#version 300 es
in vec3 aPos;
in vec2 aCorner;
in vec2 aSize;
in float aAlpha;
in float aLit;
in float aKind;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform vec2 uLight;
uniform float uLightStr;
out vec2 vCorner;
out vec2 vFocus;
out float vAlpha;
out float vLit;
out float vKind;
out float vYs;
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  // ⚠ CORNER +y IS DOWN, because every number this reproduces was written against a 2-D canvas —
  // the focus offset, the squash, the stop positions. Flipping here once means the fragment stage
  // reads the same way as the code it is a port of, rather than being its mirror image.
  clip.xy += vec2(aCorner.x * aSize.x, -aCorner.y * aSize.y) * (2.0 / uViewport) * clip.w;
  gl_Position = clip;
  vCorner = aCorner;
  vAlpha = aAlpha;
  vLit = aLit;
  vKind = aKind;
  // The gradient is a CIRCLE of radius aSize.x while the shape is an ellipse squashed to aSize.y —
  // that mismatch is what gives a base slab its hard top and bottom edge, so it is carried across
  // rather than tidied away. In corner space the ellipse is the unit circle, so the gradient has to
  // be evaluated at the corner scaled back by the squash.
  vYs = aSize.y / max(1.0, aSize.x);
  // Directional light, per card: the 2-D painter takes the direction from THIS card's screen point
  // to the sun's, so it is not one global vector and cannot be a uniform on its own.
  vec2 ctr = vec2((clip.x / clip.w * 0.5 + 0.5) * uViewport.x, (0.5 - clip.y / clip.w * 0.5) * uViewport.y);
  vec2 d = uLight - ctr;
  float L = max(1e-3, length(d));
  vFocus = uLightStr > 0.05 ? vec2(d.x / L * 0.44, d.y / L * 0.44 - 0.05) : vec2(0.0, -0.12);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vCorner;
in vec2 vFocus;
in float vAlpha;
in float vLit;
in float vKind;
in float vYs;
uniform vec3 uBase;
uniform vec3 uLitCol;
uniform vec3 uStormBase;
uniform vec3 uStormLit;
uniform float uLightStr;
uniform float uMottle;
uniform sampler2D uNoise;
out vec4 outColor;

// The canvas two-circle radial gradient, solved. createRadialGradient(fx, fy, r0, 0, 0, r1) asks,
// for a point p, which t satisfies |p - mix(f, 0, t)| = mix(r0, r1, t) — a quadratic, and the same
// one every 2-D canvas implementation solves internally. Approximating it (treating the focus as a
// simple offset, say) is visibly wrong wherever the sun is low, which is most of the time this
// renderer looks good.
float coneT(vec2 p, vec2 f, float r0, float r1) {
  vec2 d = p - f, cd = -f;
  float dr = r1 - r0;
  float a = dot(cd, cd) - dr * dr;
  float b = dot(d, cd) + r0 * dr;
  float c = dot(d, d) - r0 * r0;
  if (abs(a) < 1e-5) return b == 0.0 ? 1.0 : c / (2.0 * b);
  float disc = b * b - a * c;
  if (disc < 0.0) return 1.0;
  float s = sqrt(disc);
  return max((b + s) / a, (b - s) / a);
}

vec3 overlay(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
}

void main() {
  // In corner space the card's ellipse is exactly the unit circle.
  float rr = length(vCorner);
  if (rr > 1.0) discard;
  vec2 p = vec2(vCorner.x, vCorner.y * vYs);

  // The ambient-occlusion pool sunk under the lobes: concentric, one colour, a straight fade.
  if (vKind > 1.5) {
    float t = clamp((length(p) - 0.1) / 0.9, 0.0, 1.0);
    float a = vAlpha * (1.0 - t);
    outColor = vec4(vec3(18.0, 24.0, 32.0) / 255.0 * a, a);
    return;
  }

  float storm = step(0.5, vKind);
  vec3 bt = mix(uBase, uStormBase, storm);
  vec3 lt = mix(uLitCol, uStormLit, storm);
  vec3 col = mix(bt, lt, clamp(vLit, 0.0, 1.0));
  vec3 litCol = mix(col, lt, 0.4 * uLightStr);   // the side facing the sun warms toward the lit tint
  vec3 shadeCol = mix(col, bt, 0.5);             // the far edge falls into the puff's own form shadow

  float t = clamp(coneT(p, vFocus, 0.14, 1.0), 0.0, 1.0);
  // The four stops the baked sprite and the hero gradient both use: a dense core that holds opacity,
  // then a roll-off to a firm edge — a solid cloud mass rather than a wispy smoke ring.
  vec3 rgbv; float am;
  if (t < 0.5) { float u = t / 0.5; rgbv = mix(litCol, col, u); am = mix(1.0, 0.95, u); }
  else if (t < 0.82) { float u = (t - 0.5) / 0.32; rgbv = mix(col, shadeCol, u); am = mix(0.95, 0.5, u); }
  else { float u = (t - 0.82) / 0.18; rgbv = shadeCol; am = mix(0.5, 0.0, u); }

  if (uMottle > 0.5) {
    vec3 n = texture(uNoise, vCorner * 0.5 + 0.5).rgb;
    rgbv = mix(rgbv, overlay(rgbv, n), clamp(vAlpha * 0.6, 0.0, 0.5));
  }
  float a = vAlpha * am;
  outColor = vec4(rgbv * a, a);   // premultiplied, because the canvas this lands on is
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' cloud shader: ' + log);
  }
  return sh;
}

// A card is `{ x, y, z, s, ys, a, lit, kind }` — the world point, the half-extent in DEVICE pixels,
// the vertical squash, the alpha, where it sits between the base and lit tints, and which of the
// three kinds it is (0 fair, 1 stormy, 2 the occlusion pool).
export function createCloudLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('cloud link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    corner: gl.getAttribLocation(prog, 'aCorner'),
    size: gl.getAttribLocation(prog, 'aSize'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    lit: gl.getAttribLocation(prog, 'aLit'),
    kind: gl.getAttribLocation(prog, 'aKind'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    viewport: gl.getUniformLocation(prog, 'uViewport'),
    light: gl.getUniformLocation(prog, 'uLight'),
    lightStr: gl.getUniformLocation(prog, 'uLightStr'),
    base: gl.getUniformLocation(prog, 'uBase'),
    litCol: gl.getUniformLocation(prog, 'uLitCol'),
    stormBase: gl.getUniformLocation(prog, 'uStormBase'),
    stormLit: gl.getUniformLocation(prog, 'uStormLit'),
    mottle: gl.getUniformLocation(prog, 'uMottle'),
    noise: gl.getUniformLocation(prog, 'uNoise'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  let count = 0;
  let noiseTex = null, noiseRef = null;

  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

  // The curdle tile, uploaded once. It is a 64×64 canvas the 2-D deck bakes and memoises for the
  // life of the page, so identity is a sound cache key — a different canvas means a different tile.
  function setNoise(canvas) {
    if (!canvas || canvas === noiseRef) return;
    if (!noiseTex) noiseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    noiseRef = canvas;
  }

  function upload(cards) {
    count = cards.length * 6;
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 8192));
    let o = 0;
    for (const c of cards) {
      const sy = c.s * (c.ys == null ? 1 : c.ys);
      for (const [cx, cy] of CORNERS) {
        data[o] = c.x; data[o + 1] = c.y; data[o + 2] = c.z;
        data[o + 3] = cx; data[o + 4] = cy;
        data[o + 5] = c.s; data[o + 6] = sy;
        data[o + 7] = c.a;
        data[o + 8] = c.lit == null ? 0.5 : c.lit;
        data[o + 9] = c.kind || 0;
        o += STRIDE;
      }
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.pos, 3, 0); bind(loc.corner, 2, 12); bind(loc.size, 2, 20);
    bind(loc.alpha, 1, 28); bind(loc.lit, 1, 32); bind(loc.kind, 1, 36);
    gl.bindVertexArray(null);
    return cards.length;
  }

  function draw(cam, W, H, cssH, opts = {}) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, cssH || H)));
    gl.uniform2f(loc.viewport, W, H);
    const L = opts.light || [W * 0.5, -H];
    gl.uniform2f(loc.light, L[0], L[1]);
    gl.uniform1f(loc.lightStr, opts.lightStr || 0);
    const b = opts.base || [0.7, 0.72, 0.76], l = opts.lit || [0.95, 0.95, 0.95];
    gl.uniform3f(loc.base, b[0], b[1], b[2]);
    gl.uniform3f(loc.litCol, l[0], l[1], l[2]);
    // The stormy tints are the same two mixed halfway toward a bruised grey — the 2-D deck's own
    // constants, resolved on the JS side so the shader carries no palette of its own.
    const sb = opts.stormBase || b, sl = opts.stormLit || l;
    gl.uniform3f(loc.stormBase, sb[0], sb[1], sb[2]);
    gl.uniform3f(loc.stormLit, sl[0], sl[1], sl[2]);
    gl.uniform1f(loc.mottle, noiseTex && opts.mottle !== false ? 1 : 0);
    if (noiseTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(loc.noise, 0); }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);          // a cloud is translucent all the way through
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return count / 6;
  }

  return { upload, draw, setNoise, get cards() { return count / 6; } };
}
