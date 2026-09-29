// ── GLASS 2 · THE CLOUD DECK AS A VOLUME (RENDER_TUNE.glCloudVol) ─────────────────────────────
//
// The card deck in clouds.js is a billboard swarm: every puff is a flat quad with a cone solved per
// pixel, which reads as a cloud from outside and as nothing at all from inside. This layer marches
// rays through a slab of density instead, so a cloud has thickness, shades itself, and thickens
// around you as you fly into it.
//
// ⚠ IT READS THE SAME WEATHER THE CARDS DO. Coverage is baked every frame from the weather CELLS
// that drawVolumetricClouds builds its swarm from — never from a second cloud layout — so the
// volume and the fallback deck always agree about where the weather is. The detail inside a cell
// is a baked, tiling 3-D noise texture. Computing that noise in the shader instead was measured
// first: about 14k hash evaluations a pixel, which trips the Windows GPU watchdog and kills the
// renderer outright.
//
// ⚠ QUARTER RESOLUTION, THEN A FULL-RESOLUTION COMPOSITE. The march is the whole cost (a spike
// measured 8-14 ms at full res against 1-4 ms at a quarter), so it runs into a small target of its
// own. The composite then writes, per pixel, the depth of WHERE THE CLOUD IS (the
// transmittance-weighted mean hit distance) and tests it against the city's depth buffer. That is
// how a tower stands in a cloud without this pass ever reading the depth buffer back — which
// would mean resolving the MSAA float target first.
//
// ⚠ THE HIT DISTANCE IS PACKED INTO RGBA8, NOT A FLOAT TARGET. Float render targets need
// EXT_color_buffer_float, and the whole point of the auto setting is to behave on weak devices, so
// the layer asks for nothing the WebGL2 floor does not guarantee. Two bytes over the march range is
// about 0.001 tiles, and the target is read with texelFetch, because bilinear filtering of a
// packed value is garbage at every byte boundary.
//
// ⚠ TEMPORAL ACCUMULATION (RENDER_TUNE.cloudVolTemporal, 0 is the raw per-frame march). The ray
// start is jittered every frame, which is a fine grain on its own; each pixel reprojects the point
// where its cloud IS into last frame's matrix and blends with what was drawn there. Two traps.
// The frame is CAMERA-RELATIVE, so a world point's coordinates change between frames by exactly
// how far the origin moved (`uShift`). Leave that out and every cloud smears backward along the
// flight path. And reprojecting the FAR point rather than the hit point puts a near cloud's history
// wherever the sky behind it was. History is dropped on a resize or a jump of more than four tiles,
// and damped where coverage changed sharply, so a cloud edge crossing the frame leaves no ghost.

import { viewProjMatrix, mat4f } from './camera.js';

const NOISE_N = 64;
const COVER_N = 64;          // coverage texels a side
export const COVER_RANGE = 56;   // tiles either side of the camera the coverage map spans

const FULL_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by both passes: the camera ray through a pixel, recovered from the deck's own matrix, so
// it lands in the same camera-relative tiles the cards and the city use, pitch and bank included.
const RAY_GLSL = `
uniform mat4 uInvVP;
void camRay(vec2 ndc, out vec3 ro, out vec3 rd) {
  vec4 a = uInvVP * vec4(ndc, -1.0, 1.0); a /= a.w;
  vec4 b = uInvVP * vec4(ndc,  1.0, 1.0); b /= b.w;
  ro = a.xyz; rd = normalize(b.xyz - a.xyz);
}`;

const MARCH_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
layout(location = 0) out vec4 outCol;
layout(location = 1) out vec4 outDist;
${RAY_GLSL}
uniform vec2 uRes;
uniform sampler3D uNoise;
uniform sampler2D uCover;       // R coverage, G storm share; camera-centred
uniform float uCoverRange;
uniform vec2 uOrigin;           // world position of the camera-relative origin, so noise stays put
uniform float uBase;
uniform float uTop;
uniform float uFar;
uniform float uTime;
uniform float uFrame;
uniform float uCum;
uniform int uSteps;
uniform vec3 uSun;
uniform float uSunStr;
uniform vec3 uBaseCol;
uniform vec3 uLitCol;
uniform vec3 uStormBase;
uniform vec3 uStormLit;
uniform vec2 uWind;
// Temporal accumulation: last frame's march result, the matrix it was drawn with, and how far the
// camera-relative origin moved since (the frame is camera-relative, so a world point's coordinates
// change by exactly that between frames).
uniform sampler2D uHist;
uniform mat4 uPrevVP;
uniform vec2 uShift;
uniform float uHistW;

vec2 cover(vec3 p) {
  vec2 uv = p.xy / (2.0 * uCoverRange) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec2(0.0);
  return texture(uCover, uv).rg;
}

float density(vec3 p, float cov) {
  if (cov < 0.01) return 0.0;
  float hf = (p.z - uBase) / (uTop - uBase);
  if (hf < 0.0 || hf > 1.0) return 0.0;
  // Flat stratus base, rounded cumulus tops: a cumulus deck (uCum 1) tapers from half way up.
  float shape = smoothstep(0.0, 0.08, hf) * smoothstep(1.0, mix(0.85, 0.35, uCum), hf);
  vec3 w = vec3(p.xy + uOrigin + uWind * uTime, p.z);
  float n = texture(uNoise, w * vec3(0.045, 0.045, 0.07)).r;
  float d = texture(uNoise, w * vec3(0.19, 0.19, 0.24)).r;
  // Coverage decides how much of the low-frequency noise survives (a remap, not a subtraction, so a
  // full cell is still broken into puffs); the detail octave then erodes the edges it leaves.
  float c = cov * mix(0.62, 0.8, uCum);
  float base = clamp((n - (1.0 - c)) / max(c, 0.05), 0.0, 1.0);
  base = clamp(base - (1.0 - d) * 0.45 * (1.0 - base), 0.0, 1.0);
  return base * shape * 2.2;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 ro, rd; camRay(ndc, ro, rd);
  // An empty ray writes empty history too: the history target is whatever this pass wrote last.
  outCol = vec4(0.0); outDist = vec4(1.0, 1.0, 0.0, 0.0);
  if (abs(rd.z) < 1e-5 && (ro.z < uBase || ro.z > uTop)) return;
  float t0, t1;
  if (abs(rd.z) < 1e-5) { t0 = 0.0; t1 = uFar; }
  else {
    t0 = (uBase - ro.z) / rd.z; t1 = (uTop - ro.z) / rd.z;
    if (t0 > t1) { float s = t0; t0 = t1; t1 = s; }
  }
  t0 = max(t0, 0.0); t1 = min(t1, uFar);
  if (t1 <= t0) return;
  float dt = (t1 - t0) / float(uSteps);
  // Interleaved gradient noise, rotated per frame: breaks the step banding into a fine grain.
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
  float T = 1.0, wsum = 0.0, tsum = 0.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 128; i++) {
    if (i >= uSteps) break;
    float t = t0 + (float(i) + jit) * dt;
    vec3 p = ro + rd * t;
    vec2 cs = cover(p);
    float dn = density(p, cs.x);
    if (dn > 0.002) {
      // Four short steps toward the sun for self-shadowing, reusing this sample's coverage.
      float ld = 0.0;
      for (int j = 1; j <= 4; j++) ld += density(p + uSun * (0.45 * float(j)), cs.x);
      float sunT = exp(-ld * 0.45 * 1.3);
      float powder = 1.0 - exp(-dn * 2.0);
      float hf = clamp((p.z - uBase) / (uTop - uBase), 0.0, 1.0);
      vec3 bc = mix(uBaseCol, uStormBase, cs.y), lc = mix(uLitCol, uStormLit, cs.y);
      vec3 col = mix(bc, lc, clamp(sunT * powder * uSunStr + hf * 0.35, 0.0, 1.0));
      float a = 1.0 - exp(-dn * dt * 1.4);
      float w = T * a;
      acc += w * col; wsum += w; tsum += w * t;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
  }
  float alpha = 1.0 - T;
  vec4 cur = vec4(acc, alpha);   // premultiplied
  float tHit = wsum > 1e-4 ? tsum / wsum : uFar;
  // ── REPROJECTION ─────────────────────────────────────────────────────────────────────────────
  // The jitter moves every frame, so blending with where this cloud point was last frame averages the
  // grain away. The point reprojected is where the cloud IS (the hit distance), which is what moves
  // with the camera; history off the edge of last frame is rejected, and a big change in coverage
  // damps the blend so a cloud edge sweeping across the frame does not leave a ghost behind it.
  outCol = cur;
  if (uHistW > 0.0) {
    vec3 p = ro + rd * min(tHit, uFar) + vec3(uShift, 0.0);
    vec4 c = uPrevVP * vec4(p, 1.0);
    if (c.w > 1e-4) {
      vec2 uvp = c.xy / c.w * 0.5 + 0.5;
      if (all(greaterThanEqual(uvp, vec2(0.0))) && all(lessThanEqual(uvp, vec2(1.0)))) {
        vec4 h = texture(uHist, uvp);
        float w = uHistW * (1.0 - smoothstep(0.15, 0.5, abs(h.a - cur.a)));
        outCol = mix(cur, h, w);
      }
    }
  }
  float v = clamp(tHit / uFar, 0.0, 1.0) * 65535.0;
  outDist = vec4(floor(v / 256.0) / 255.0, mod(floor(v), 256.0) / 255.0, 0.0, 1.0);
}`;

const COMP_FS = `#version 300 es
precision highp float;
out vec4 outColor;
${RAY_GLSL}
uniform mat4 uVP;
uniform vec2 uRes;       // full-resolution viewport, device pixels
uniform vec2 uLowRes;    // the march target
uniform sampler2D uCol;
uniform sampler2D uDist;
uniform float uFar;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c = texture(uCol, uv);
  if (c.a < 0.003) discard;
  ivec2 q = clamp(ivec2(uv * uLowRes), ivec2(0), ivec2(uLowRes) - 1);
  vec4 dp = texelFetch(uDist, q, 0);
  float t = (dp.r * 255.0 * 256.0 + dp.g * 255.0) / 65535.0 * uFar;
  vec3 ro, rd; camRay(uv * 2.0 - 1.0, ro, rd);
  vec4 clip = uVP * vec4(ro + rd * t, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  outColor = c;
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' cloud-volume shader: ' + log);
  }
  return sh;
}

function link(gl, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, FULL_VS, label + ' vertex'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, label + ' fragment'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('cloud-volume link (' + label + '): ' + gl.getProgramInfoLog(p));
  return p;
}

// A tiling fBm volume, baked once per context. Deterministic (a fixed LCG), so two clients and two
// reloads draw the same weather.
function bakeNoise() {
  const N = NOISE_N, P = 8, d = new Uint8Array(N * N * N);
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const g = new Float32Array(P * P * P);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const lat = (x, y, z) => g[(x & 7) + 8 * (y & 7) + 64 * (z & 7)];
  const fade = (t) => t * t * (3 - 2 * t);
  const vn = (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = fade(x - X), fy = fade(y - Y), fz = fade(z - Z);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(lat(X, Y, Z), lat(X + 1, Y, Z), fx), L(lat(X, Y + 1, Z), lat(X + 1, Y + 1, Z), fx), fy),
      L(L(lat(X, Y, Z + 1), lat(X + 1, Y, Z + 1), fx), L(lat(X, Y + 1, Z + 1), lat(X + 1, Y + 1, Z + 1), fx), fy), fz);
  };
  const sc = P / N;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Octaves at 1, 2 and 4 cells a period; every one divides P, so the volume tiles.
    let v = 0, a = 0.5, f = 1;
    for (let o = 0; o < 3; o++) { v += a * vn(x * sc * f, y * sc * f, z * sc * f); a *= 0.5; f *= 2; }
    d[x + N * y + N * N * z] = Math.min(255, Math.round(v / 0.875 * 255));
  }
  return d;
}

export function createCloudVolume(gl) {
  const march = link(gl, MARCH_FS, 'march');
  const comp = link(gl, COMP_FS, 'composite');
  const U = (p, n) => gl.getUniformLocation(p, n);
  const um = {
    invVP: U(march, 'uInvVP'), res: U(march, 'uRes'), noise: U(march, 'uNoise'), cover: U(march, 'uCover'),
    coverRange: U(march, 'uCoverRange'), origin: U(march, 'uOrigin'), base: U(march, 'uBase'), top: U(march, 'uTop'),
    far: U(march, 'uFar'), time: U(march, 'uTime'), frame: U(march, 'uFrame'), cum: U(march, 'uCum'), steps: U(march, 'uSteps'),
    sun: U(march, 'uSun'), sunStr: U(march, 'uSunStr'), baseCol: U(march, 'uBaseCol'), litCol: U(march, 'uLitCol'),
    stormBase: U(march, 'uStormBase'), stormLit: U(march, 'uStormLit'), wind: U(march, 'uWind'),
    hist: U(march, 'uHist'), prevVP: U(march, 'uPrevVP'), shift: U(march, 'uShift'), histW: U(march, 'uHistW'),
  };
  const uc = {
    invVP: U(comp, 'uInvVP'), vp: U(comp, 'uVP'), res: U(comp, 'uRes'), lowRes: U(comp, 'uLowRes'),
    col: U(comp, 'uCol'), dist: U(comp, 'uDist'), far: U(comp, 'uFar'),
  };

  const noiseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, noiseTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, NOISE_N, NOISE_N, NOISE_N, 0, gl.RED, gl.UNSIGNED_BYTE, bakeNoise());
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const coverTex = gl.createTexture();
  const coverData = new Uint8Array(COVER_N * COVER_N * 2);
  gl.bindTexture(gl.TEXTURE_2D, coverTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, COVER_N, COVER_N, 0, gl.RG, gl.UNSIGNED_BYTE, coverData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // The low-resolution march target: premultiplied colour, and the packed hit distance. The colour
  // target is a PAIR that swaps roles every frame — one is written while the other is read as the
  // history — because a texture cannot be sampled while it is the target being drawn into.
  const fbo = gl.createFramebuffer();
  const colTexs = [gl.createTexture(), gl.createTexture()], distTex = gl.createTexture();
  let cur = 0, prevVP = null, prevOx = 0, prevOy = 0, histOK = false;
  let lw = 0, lh = 0;
  function sizeTarget(w, h) {
    if (w === lw && h === lh) return;
    lw = w; lh = h;
    histOK = false;   // a resized target has no history worth reading
    for (const [t, filt] of [[colTexs[0], gl.LINEAR], [colTexs[1], gl.LINEAR], [distTex, gl.NEAREST]]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colTexs[0], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, distTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('cloud-volume target incomplete');
  }

  // Coverage from the weather cells: the same falloff the card swarm scatters puffs inside, max-
  // combined so two overlapping cells are one cloud rather than a doubly dense one.
  function bakeCover(cells) {
    coverData.fill(0);
    const step = (2 * COVER_RANGE) / COVER_N;
    for (const c of cells) {
      const inten = Math.max(0, Math.min(1, c.i));
      if (inten <= 0.02) continue;
      const r = c.r * 1.05;
      const x0 = Math.max(0, Math.floor((c.x - r + COVER_RANGE) / step)), x1 = Math.min(COVER_N - 1, Math.ceil((c.x + r + COVER_RANGE) / step));
      const y0 = Math.max(0, Math.floor((c.y - r + COVER_RANGE) / step)), y1 = Math.min(COVER_N - 1, Math.ceil((c.y + r + COVER_RANGE) / step));
      for (let y = y0; y <= y1; y++) {
        const wy = (y + 0.5) * step - COVER_RANGE;
        for (let x = x0; x <= x1; x++) {
          const wx = (x + 0.5) * step - COVER_RANGE;
          const d = Math.hypot(wx - c.x, wy - c.y) / r;
          if (d >= 1) continue;
          const e = d < 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
          const k = (x + COVER_N * y) * 2;
          const v = Math.round(255 * inten * e * e * (3 - 2 * e));
          if (v > coverData[k]) { coverData[k] = v; coverData[k + 1] = c.storm ? 255 : 0; }
        }
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, COVER_N, COVER_N, gl.RG, gl.UNSIGNED_BYTE, coverData);
  }

  let frame = 0;
  // Draws into whatever framebuffer the caller has bound (the float target when HDR is live), on
  // its depth buffer. Returns the number of cells that fed it, so 0 means "drew nothing".
  function draw(cam, W, H, cssH, vol, opts = {}) {
    if (!vol || !vol.cells || !vol.cells.length) return 0;
    // Whatever the caller had bound, named by the caller: a getParameter here was a synchronous round
    // trip to the GPU process every frame the deck was up. context.js knows which target is live.
    const prevFb = opts.fb === undefined ? gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) : opts.fb;
    const scale = Math.max(0.125, Math.min(1, opts.res || 0.25));
    const w = Math.max(16, Math.round(W * scale)), h = Math.max(16, Math.round(H * scale));
    sizeTarget(w, h);
    bakeCover(vol.cells);
    const vp = viewProjMatrix(cam, cssH || H);
    const inv = invert4(vp);
    if (!inv) return 0;
    const far = Math.min(COVER_RANGE, vol.far || 48);

    // Pass 1: the march, at low resolution, into this frame's half of the colour pair.
    const ox = vol.ox || 0, oy = vol.oy || 0;
    // A jump (a respawn, a teleport, a seat change) makes last frame a different place entirely.
    if (histOK && Math.hypot(ox - prevOx, oy - prevOy) > 4) histOK = false;
    const histW = histOK && prevVP ? Math.max(0, Math.min(0.97, opts.temporal == null ? 0.85 : opts.temporal)) : 0;
    const hist = colTexs[cur];
    cur ^= 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colTexs[cur], 0);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.useProgram(march);
    gl.uniformMatrix4fv(um.invVP, false, new Float32Array(inv));
    gl.uniform2f(um.res, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, noiseTex); gl.uniform1i(um.noise, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coverTex); gl.uniform1i(um.cover, 1);
    gl.uniform1f(um.coverRange, COVER_RANGE);
    gl.uniform2f(um.origin, (vol.ox || 0) % 4096, (vol.oy || 0) % 4096);
    gl.uniform1f(um.base, vol.base); gl.uniform1f(um.top, vol.top);
    gl.uniform1f(um.far, far);
    gl.uniform1f(um.time, ((opts.now || 0) / 1000) % 3600);
    gl.uniform1f(um.frame, (frame = (frame + 1) % 64));
    gl.uniform1f(um.cum, vol.cum == null ? 0.5 : vol.cum);
    gl.uniform1i(um.steps, Math.max(8, Math.min(128, Math.round(opts.steps || 48))));
    const s = vol.sun || [0.4, 0.2, 0.9];
    gl.uniform3f(um.sun, s[0], s[1], s[2]);
    gl.uniform1f(um.sunStr, vol.sunStr == null ? 1 : vol.sunStr);
    const b = opts.base || [0.7, 0.72, 0.76], l = opts.lit || [0.95, 0.95, 0.95];
    const sb = opts.stormBase || b, sl = opts.stormLit || l;
    gl.uniform3f(um.baseCol, b[0], b[1], b[2]); gl.uniform3f(um.litCol, l[0], l[1], l[2]);
    gl.uniform3f(um.stormBase, sb[0], sb[1], sb[2]); gl.uniform3f(um.stormLit, sl[0], sl[1], sl[2]);
    const wd = vol.wind || [0.05, 0.02];
    gl.uniform2f(um.wind, wd[0], wd[1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, hist); gl.uniform1i(um.hist, 2);
    gl.uniformMatrix4fv(um.prevVP, false, new Float32Array(prevVP || vp));
    gl.uniform2f(um.shift, ox - prevOx, oy - prevOy);
    gl.uniform1f(um.histW, histW);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
    prevVP = vp; prevOx = ox; prevOy = oy; histOK = true;

    // Pass 2: the composite, at full resolution, on the caller's depth buffer.
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevFb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);           // ⚠ colour only: the city's depth is what we test against
    gl.useProgram(comp);
    gl.uniformMatrix4fv(uc.invVP, false, new Float32Array(inv));
    gl.uniformMatrix4fv(uc.vp, false, mat4f(vp));
    gl.uniform2f(uc.res, W, H);
    gl.uniform2f(uc.lowRes, w, h);
    gl.uniform1f(uc.far, far);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, colTexs[cur]); gl.uniform1i(uc.col, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, distTex); gl.uniform1i(uc.dist, 1);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return vol.cells.length;
  }

  return { draw };
}

// Column-major 4x4 inverse (the layout camera.js builds). Null when singular.
export function invert4(m) {
  const a = m, o = new Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}
