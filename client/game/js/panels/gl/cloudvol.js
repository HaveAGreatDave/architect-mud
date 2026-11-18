// ── GLASS 2 · THE CLOUD DECK AS A VOLUME (RENDER_TUNE.glCloudVol) ─────────────────────────────
// clouds.js's cards read as nothing from inside; this marches a density slab, so a cloud has depth.
// ⚠ IT READS THE SAME WEATHER THE CARDS DO: coverage is baked each frame from the CELLS
// drawVolumetricClouds uses, never a second layout. In-cell detail is a baked tiling 3-D noise;
// shader noise cost ~14k hashes a pixel and tripped the Windows GPU watchdog.
// ⚠ QUARTER RESOLUTION, THEN A FULL-RES COMPOSITE (8-14 ms full against 1-4 ms quarter). The
// composite writes the depth of WHERE THE CLOUD IS (transmittance-weighted mean hit) and tests it
// against the city's depth, so towers stand in clouds without resolving the MSAA float target.
// ⚠ HIT DISTANCE IS PACKED INTO RGBA8 (float targets need EXT_color_buffer_float): two bytes give
// ~0.001 tiles, read with texelFetch since bilinear on packed bytes is garbage.
// ⚠ TEMPORAL ACCUMULATION (RENDER_TUNE.cloudVolTemporal, 0 is raw): jittered starts, each pixel
// reprojects its cloud point into last frame's matrix. ⚠ The frame is CAMERA-RELATIVE, so add the
// origin shift ('uShift') or clouds smear back along the path. ⚠ Reproject the HIT point, not the
// far point, or a near cloud gets the sky's history. History drops on resize or a jump over four
// tiles and is damped where coverage changes sharply.

import { viewProjMatrix, mat4f } from './camera.js';
import { compileShader } from './programs.js';
import { invert as invert4 } from './core/mat4.js';
import { linearOut, applyLinOut } from './colour.js';

const NOISE_N = 64;
const COVER_N = 64;          // coverage texels a side
const COVER_RANGE = 56;   // tiles either side of the camera the coverage map spans
const FRONT_ASPECT = 1.7;  // a cell is this much longer across its motion and this much shorter along it (2.9:1 overall)
const GLOW_R = 4;                 // tiles a lit tile's glow spreads across the base
const GLOW_GAIN = 0.12;           // how many summed sources it takes to saturate (1 - e^-gain·sum)
// ⚠ The base it lands on is near black at night, so whatever this adds IS the colour: at 0.55 of
// pure sodium the deck's underside read as a red glow. A dim, mostly-grey warmth is what a lit
// city puts on an overcast.
const GLOW_STR = 0.14;            // the glow's full-night strength on the base
const GLOW_COL = [0.8, 0.7, 0.58];    // sodium, washed out by the vapour

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

// The cloud's matter, shared by the march and the shadow bake, so a shadow is the cloud it's under.
const DENSITY_GLSL = `
uniform sampler3D uNoise;
uniform sampler2D uCover;       // R coverage, G cumulonimbus, B heap (0 stratus .. 1 cumulus), A nimbus (rain-bearing)
uniform vec2 uCoverOff;         // that texel centre's offset from the camera (see bakeCover)
uniform float uCoverRange;
uniform vec2 uOrigin;           // world position of the camera-relative origin, so noise stays put
uniform float uBase;
uniform float uTop;
uniform float uTime;
uniform vec2 uWind;
uniform float uSheet;           // how much of a continuous stratus sheet the day's cloud floor is (floorSheet)
// A change of sheet crosses the sky as a front (stepSkySheet in windshield.js): xy the downwind
// axis, z the edge's distance along it from the camera. Downwind of the edge the sky is still
// uSheetOld; upwind of it, uSheet. With no front, z is far upwind and uSheet is everywhere.
uniform float uSheetOld;
uniform vec3 uSheetFront;
// The upper decks' genera, from the day's weather (CLOUD_UPPER in windshield.js), laid everywhere and
// not only inside a cell: cirrus (fibrous ice), cirrostratus (an ice veil), altocumulus (small
// regular heaps) and altostratus (a grey mid-level sheet).
uniform float uCirrus;
uniform float uCirSheet;
uniform float uAlto;
uniform float uAltoSheet;

vec4 cover(vec3 p) {
  vec2 uv = (p.xy - uCoverOff) / (2.0 * uCoverRange) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0, 0.0, 0.5, 0.0);
  return texture(uCover, uv);
}

// ── THE FLOW ─────────────────────────────────────────────────────────────────────────────────
// Without this every sample slid with uWind * uTime and the sky moved as one painted sheet. A slow
// low-frequency field displaces each deck's matter by its own amount, and the field itself evolves
// (time runs through the noise's third axis), so parts of a cloud stretch, curl and roll against
// their neighbours. Each z rate is a whole number of noise periods per 3600 s, so the uTime wrap is
// seamless. 'hf' feeds the field, so decks at different heights churn independently.
float evo(float r) { return uTime * (r / 3600.0); }
vec2 flow(vec2 xy, float hf, float amp) {
  vec3 q = vec3(xy * 0.011, hf * 0.7 + evo(1.0));
  float a = texture(uNoise, q).r, b = texture(uNoise, q + vec3(0.37, 0.61, 0.29)).r;
  // Mostly a quarter-turn of the pair, so it swirls rather than only pushing apart.
  vec2 v = vec2(a, b) - 0.5;
  return vec2(v.y, -v.x) * amp + v * amp * 0.35;
}

// A finer eddy for the detail octaves. ⚠ Never run time through a detail octave's z: the noise
// is a coarse 64^3 grid, so whole patches crossfade between slices and the sky flickers in blocks.
// Carry the detail by motion instead; only this slow field evolves.
vec2 eddy(vec2 xy, float hf, float amp) {
  vec3 q = vec3(xy * 0.05, hf * 1.3 + evo(2.0) + 0.5);
  vec2 v = vec2(texture(uNoise, q).r, texture(uNoise, q + vec3(0.53, 0.19, 0.71)).r) - 0.5;
  return vec2(v.y, -v.x) * amp;
}

// 'ice' comes back as the share of this sample that is ice crystal rather than droplet: the high
// deck, the cirrostratus veil and a cumulonimbus's anvil. The march lights ice with its own phase.
float density(vec3 p, vec4 cs, out float ice) {
  ice = 0.0;
  float cov = cs.x;
  if (cov < 0.01 && max(uSheet, uSheetOld) < 0.01 && uCirrus < 0.01 && uCirSheet < 0.01 && uAlto < 0.01 && uAltoSheet < 0.01) return 0.0;
  float hf = (p.z - uBase) / (uTop - uBase);
  if (hf < 0.0 || hf > 1.0) return 0.0;
  float heap = cs.z, cb = cs.y, rain = cs.w;
  vec2 drift = uWind * uTime;
  vec2 veer = vec2(-uWind.y, uWind.x) * uTime;
  // The overcast's footprint: a sheet across the bottom of the slab wherever the day's floor is high.
  // The front's edge is ragged: a coarse octave pushes it a few tiles either way, so the overcast
  // tears off in a broken line rather than a ruled one.
  float sAlong = dot(p.xy, uSheetFront.xy);
  float rag = uSheetFront.z < -1e3 ? 0.0 : (texture(uNoise, vec3((p.xy + uOrigin + drift) * 0.03, 0.31)).r - 0.5) * 16.0;
  float sheetHere = mix(uSheet, uSheetOld, smoothstep(uSheetFront.z - 6.0, uSheetFront.z + 6.0, sAlong + rag));
  float shF = sheetHere * smoothstep(0.0, 0.08, hf) * (1.0 - smoothstep(0.24, 0.46, hf));

  // ── CUMULONIMBUS ─────────────────────────────────────────────────────────────────────────────
  // One tower through all three decks: the middle of a storm cell climbs nearly to the top, glaciates,
  // and spreads downwind as a flat anvil; under the anvil's overhang hang mammatus pouches. It ignores
  // the deck gaps, which is what makes it read as a different animal from the layered sky around it.
  float dCb = 0.0, iCb = 0.0;
  if (cb * cov > 0.02) {
    vec2 sh = drift * (1.0 + 2.2 * hf) + veer * (0.9 * hf * hf);
    vec3 w = vec3(p.xy + uOrigin + sh + vec2(91.0, 377.0), p.z);
    w.xy += flow(w.xy, hf, 10.0);
    float n = texture(uNoise, w * vec3(0.032, 0.032, 0.05)).r;
    // The towers boil: the detail rides a finer eddy of its own, so it moves rather than fades.
    float d = texture(uNoise, vec3(w.xy + eddy(w.xy, hf, 4.0), w.z) * vec3(0.16, 0.16, 0.2)).r;
    float core = smoothstep(0.4, 0.95, cov * cb);
    float topH = mix(0.5, 0.86, core);
    float tower = smoothstep(0.0, 0.04, hf) * (1.0 - smoothstep(topH - 0.12, topH, hf));
    float c = mix(0.62, 0.97, core);
    float body = clamp((n - (1.0 - c)) / c, 0.0, 1.0);
    body = clamp(body - (1.0 - d) * 0.22 * (1.0 - body), 0.0, 1.0);
    // A tower narrows a little as it climbs, so the cauliflower sits on a broad dark base.
    tower *= smoothstep(hf * 0.5, hf * 0.5 + 0.2, body + 0.1);
    // The anvil is blown downwind of its tower: it reads the storm's coverage six tiles upwind as
    // well as here, so the shelf overhangs the clear air on the lee side.
    float shelf = 0.0;
    if (hf > 0.66) {
      vec2 wdir = normalize(uWind + vec2(1e-3, 0.0));
      vec4 ca = cover(vec3(p.xy - wdir * 6.0, p.z));
      shelf = smoothstep(0.76, 0.82, hf) * (1.0 - smoothstep(0.9, 0.97, hf)) * smoothstep(0.03, 0.3, max(cov * cb, ca.x * ca.y));
    }
    float an = clamp((0.55 * n + 0.45 * d) - 0.3, 0.0, 1.0) * 2.2 * shelf;
    // Mammatus: rounded pouches off the anvil's underside, from a coarse lumpy octave.
    float m = texture(uNoise, w * vec3(0.11, 0.11, 0.0)).r;
    float pouch = smoothstep(0.55, 0.8, m) * smoothstep(0.66, 0.74, hf) * (1.0 - smoothstep(0.76, 0.79, hf))
      * smoothstep(0.1, 0.4, cov * cb) * (1.0 - core);
    dCb = max(max(body * tower * 3.4, an * 1.5), pouch * 1.8) * cb;
    iCb = an * 1.5 * cb + body * tower * 3.4 * cb * smoothstep(0.6, 0.85, hf);
  }

  // ── THE LAYERED DECKS ────────────────────────────────────────────────────────────────────────
  // Three decks in one slab, each with its own seed, scale and wind: a deep low deck (0..0.58),
  // a middle deck (0.62..0.84) and a thin high one (0.87..1). The gaps between them are clear air,
  // so a deck's seed can jump there without a seam. The wind grows and veers with height, so towers
  // lean downwind and the decks slide over each other at different rates.
  float L = hf < 0.6 ? 0.0 : (hf < 0.855 ? 1.0 : 2.0);
  float lo = L == 0.0 ? 0.0 : (L == 1.0 ? 0.62 : 0.87);
  float hi = L == 0.0 ? 0.58 : (L == 1.0 ? 0.84 : 1.0);
  float dL = 0.0;
  if (hf >= lo && hf <= hi) {
    float lf = (hf - lo) / (hi - lo);
    vec2 shear = drift * (1.0 + 2.2 * hf) + veer * (0.9 * hf * hf) + vec2(517.0, 263.0) * L;
    vec3 w = vec3(p.xy + uOrigin + shear, p.z);
    // Each deck churns with its own strength: the convective low deck most, the cirrus least.
    w.xy += flow(w.xy + vec2(31.0, 7.0) * L, hf, L == 0.0 ? 12.0 : (L == 1.0 ? 7.0 : 4.0));
    if (L == 0.0) {
      // The low deck's genus is the cell's own: stratus (heap 0) is a flat low lid, stratocumulus
      // (about 0.5) is rolls and cells with gaps between, cumulus (1) is towers with flat bases.
      // A nimbus cell (rain) is a deep, featureless, ragged-based nimbostratus.
      float n = texture(uNoise, w * vec3(0.045, 0.045, 0.07)).r;
      // Cumulus churns harder than stratus.
      float d = texture(uNoise, vec3(w.xy + eddy(w.xy, hf, mix(1.5, 4.0, heap)), w.z) * vec3(0.19, 0.19, 0.24)).r;
      float topF = mix(0.3, 1.0, max(heap, rain * 0.85));
      float shape = smoothstep(0.0, mix(0.07, 0.02, rain), lf) * smoothstep(topF, topF * mix(0.8, 0.3, heap), lf);
      float c = cov * (mix(1.15, 0.84, heap) + 0.35 * rain);
      float body = clamp((n - (1.0 - c)) / max(c, 0.05), 0.0, 1.0);
      // Stratocumulus: the detail octave cuts the deck into cells, strongest at heap 0.5.
      float scW = 1.0 - abs(heap - 0.5) * 2.0;
      body *= mix(1.0, smoothstep(0.32, 0.6, d), scW * 0.75 * (1.0 - rain));
      float bite = mix(0.22, 0.4, lf) * mix(0.15, 1.0, heap) + rain * 0.35 * (1.0 - smoothstep(0.0, 0.25, lf));
      body = clamp(body - (1.0 - d) * bite * (1.0 - body), 0.0, 1.0);
      // Towers: in a cumulus a dense core climbs higher than a thin edge.
      shape *= mix(1.0, smoothstep(lf * 0.85, lf * 0.85 + 0.25, body + 0.15), heap);
      dL = body * shape * (2.6 + rain * 1.2);
    } else if (L == 1.0) {
      // Altocumulus: small regular heaps on a finer grid. Altostratus: a grey sheet, thinner in
      // patches. Cells raise both, so the mid deck thickens ahead of the weather.
      float c1 = max(cov * 0.55, uAlto + uAltoSheet * 0.6);
      float n = texture(uNoise, w * vec3(0.06, 0.06, 0.08) * 1.35).r;
      float d = texture(uNoise, vec3(w.xy + eddy(w.xy, hf, 1.5), w.z) * vec3(0.3, 0.3, 0.3)).r;
      float shape = smoothstep(0.0, 0.18, lf) * smoothstep(1.0, 0.55, lf);
      float heaps = clamp((d * 0.6 + n * 0.4 - (1.0 - c1)) / max(c1, 0.05), 0.0, 1.0);
      heaps = smoothstep(0.15, 0.6, heaps);
      float veil = clamp(n * 0.8 + 0.35 - (1.0 - uAltoSheet) * 0.9, 0.0, 1.0) * smoothstep(0.0, 0.3, lf) * smoothstep(0.7, 0.4, lf);
      dL = max(heaps * shape * 1.8, veil * 1.3);
    } else {
      // Cirrus: fibres combed out along the high wind (the noise is stretched along it and squeezed
      // across), hooked where the wind veers. Cirrostratus: a thin even ice veil. Both are ice.
      float c2 = max(cov * 0.42, uCirrus);
      vec2 wd = normalize(uWind + vec2(1e-3, 0.0));
      vec2 q = vec2(dot(w.xy, wd), dot(w.xy, vec2(-wd.y, wd.x)));
      q.y += 6.0 * sin(q.x * 0.05);                       // the hooks (uncinus)
      vec3 wf = vec3(q.x * 0.018, q.y * 0.24, p.z * 0.1);
      float n = texture(uNoise, w * vec3(0.03, 0.03, 0.05)).r;
      float f = texture(uNoise, wf).r;
      float shape = smoothstep(0.0, 0.25, lf) * smoothstep(1.0, 0.5, lf);
      float fib = clamp((f * 0.65 + n * 0.35 - (1.0 - c2)) / max(c2, 0.05), 0.0, 1.0);
      float veil = uCirSheet * (0.55 + 0.45 * n) * smoothstep(0.0, 0.4, lf) * smoothstep(1.0, 0.6, lf);
      dL = max(fib * fib * shape * 1.1, veil * 0.45);
      ice = 1.0;
    }
  }
  // The low octave thins the sheet in patches, so it is a ceiling with lighter spots, not a lid.
  float dS = shF <= 0.0 ? 0.0 : shF * 3.4 * (0.5 + 0.5 * texture(uNoise, vec3(p.xy + uOrigin + drift, p.z) * vec3(0.045, 0.045, 0.07)).r);
  float dn = max(max(dL, dS), dCb);
  if (dn <= 0.0) return 0.0;
  ice = clamp((ice * dL + iCb) / dn, 0.0, 1.0);
  return dn;
}
float density(vec3 p, vec4 cs) { float i; return density(p, cs, i); }
`;

// ── THE SHADOW BAKE (gl/cloudshadow.js reads it) ─────────────────────────────────────────────
// One texel per patch of cloud base: march from the base up the sun to the top in eight steps and
// keep how much of the sun the deck stops. The same grid and centre as the coverage map. The sheet
// is left out (uSheet 0 here): the overcast's dimming is sunFx.cloud's, not a shadow's.
const SHADOW_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
out vec4 outSh;
${DENSITY_GLSL}
uniform vec3 uSun;
uniform vec2 uShRes;
void main() {
  vec2 uv = gl_FragCoord.xy / uShRes;
  vec2 xy = (uv - 0.5) * 2.0 * uCoverRange + uCoverOff;
  // A sun near the horizon would march the whole map sideways; below about 7 degrees it's held
  // there, and the light is going by then anyway (cloudShadowFor fades it with the sun's alpha).
  vec3 sd = uSun.z > 0.12 ? uSun : normalize(vec3(uSun.xy, 0.12));
  float ds = (uTop - uBase) / sd.z / 8.0, od = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 p = vec3(xy, uBase) + sd * ((float(i) + 0.5) * ds);
    od += density(p, cover(p)) * ds;
  }
  outSh = vec4(1.0 - exp(-od * 1.3), 0.0, 0.0, 1.0);
}`;
const SHADOW_N = 128;   // shadow texels a side, over the coverage map's span (0.9 tiles a texel)

const MARCH_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
layout(location = 0) out vec4 outCol;
layout(location = 1) out vec4 outDist;
${RAY_GLSL}
${DENSITY_GLSL}
uniform vec2 uRes;
uniform float uFar;
uniform float uFrame;
uniform int uSteps;
uniform vec3 uSun;
uniform float uSunStr;
uniform vec3 uBaseCol;
uniform vec3 uLitCol;
// The sun's own colour on the deck, apart from the sky-lit tint: the same by day, and red going on
// for the half hour after sunset while the sun is under the deck and lights it from below.
uniform vec3 uSunCol;
// Sun shafts on the sky (RENDER_TUNE.glSunShafts): this frame's shadow bake, how much haze the
// air holds (per tile), and the strength. uShOn 0 skips the walk.
uniform sampler2D uShMap;
uniform float uAir;
uniform float uShOn;
uniform vec3 uStormBase;
uniform vec3 uStormLit;
// City underglow: lit ground under the deck, on the coverage map's grid, lifting the base from below.
uniform sampler2D uGlow;
uniform float uGlowStr;
uniform vec3 uGlowCol;
uniform vec2 uGlowOff;          // the map is baked about the whole tile; this is the eye's fraction off it
// Temporal accumulation: last frame's march result, the matrix it was drawn with, and how far the
// camera-relative origin moved since (the frame is camera-relative, so a world point's coordinates
// change by exactly that between frames).
uniform sampler2D uHist;
uniform mat4 uPrevVP;
uniform vec2 uShift;
uniform float uHistW;

uniform float uPhaseG;          // forward lobe eccentricity (RENDER_TUNE.cloudVolPhase); 0 is the old view-blind light
uniform int uMs;                // scattering octaves, 1..3 (1 on the cheap path)
// Lightning inside the deck: up to four strikes, xy camera-relative tiles, z brightness. A strike
// lights the cloud it comes out of from within, brightest low in the cell where the channel is.
uniform vec3 uFlash[4];
uniform vec3 uFlashCol;

// Light-march step lengths, tiles, nearest first.
const float LSTEP[6] = float[6](0.3, 0.6, 1.0, 1.6, 2.4, 3.5);

float hg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
}
// Forward lobe g, back lobe -0.3g, mixed 70/30. The 1/4pi cancels in the normalisation.
float phase2(float mu, float g) { return mix(hg(mu, g), hg(mu, -0.3 * g / 0.6), 0.3); }

// The shadow bake at a point in the air: up the sun to the base, then the map, which shares the
// coverage map's grid. The slope matches the bake's (it holds a low sun at 0.12).
float airSh(vec3 p) {
  vec2 q = p.xy + uSun.xy / max(uSun.z, 0.12) * (uBase - p.z);
  vec2 uv = (q - uCoverOff) / (2.0 * uCoverRange) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return texture(uShMap, uv).r;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 ro, rd; camRay(ndc, ro, rd);
  // ── SUN SHAFTS ON THE SKY ────────────────────────────────────────────────────────────────
  // A ray going up from under the deck crosses the air to the cloud base, and the part of that air
  // in a cloud's shadow scatters less sun toward the eye: a dark veil laid over the sky in lanes,
  // which with the lit lanes between is the beams. Black with an alpha, in front of the cloud, so
  // the walls and the road (gl/cloudshadow.js airShadow) and the sky darken the same air alike.
  float dark = 0.0;
  if (uShOn > 0.0 && rd.z > 0.02 && ro.z < uBase) {
    float L = min((uBase - ro.z) / rd.z, uFar), ds = L / 16.0, s = 0.0;
    float j0 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
    for (int i = 0; i < 16; i++) s += airSh(ro + rd * ((float(i) + j0) * ds)) * ds;
    float muS = dot(rd, uSun);
    // Faded in over the first few degrees above level, or the beams end on a line at the horizon.
    dark = min(0.6, (1.0 - exp(-uAir * s)) * mix(0.35, 1.0, smoothstep(0.2, 1.0, muS)) * uShOn) * smoothstep(0.02, 0.12, rd.z);
  }
  // An empty ray writes empty history too: the history target is whatever this pass wrote last.
  outCol = vec4(0.0, 0.0, 0.0, dark); outDist = vec4(1.0, 1.0, 0.0, 0.0);
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
  // The phase, once a ray: the sun's angle to the view doesn't change along it. Two Henyey-
  // Greenstein lobes (Hillaire 2016), forward and a weaker back, divided by their side-on value so
  // a cloud seen across the sun is as bright as it always was; one value per scattering octave,
  // each with half the last one's eccentricity.
  float mu = dot(rd, uSun);
  float fwd = smoothstep(0.5, 0.95, mu);
  float phaseOct[3], phaseIce[3];
  float g = uPhaseG;
  // Ice crystals (cirrus, the anvil) throw far more of the light straight on than droplets do, and
  // have almost no back lobe: a thin cirrus is nearly invisible side-on and blazes round the sun.
  float gi = max(uPhaseG, 0.3) * 1.35;
  for (int o = 0; o < 3; o++) {
    phaseOct[o] = phase2(mu, g) / phase2(0.0, g);
    phaseIce[o] = hg(mu, min(gi, 0.88)) / hg(0.0, min(gi, 0.88));
    g *= 0.5; gi *= 0.5;
  }
  // The 22-degree halo: hexagonal plates and columns refract the sun through 22 degrees, so a
  // cirrostratus veil carries a ring round the sun, red on its inner edge. Once a ray, like the phase.
  float ang = acos(clamp(mu, -1.0, 1.0));
  float halo = exp(-pow((ang - 0.384) / 0.03, 2.0));
  vec3 haloCol = vec3(1.0, 0.82, 0.62) * exp(-pow((ang - 0.375) / 0.01, 2.0)) + vec3(0.75, 0.85, 1.0) * halo;
  for (int i = 0; i < 128; i++) {
    if (i >= uSteps) break;
    float t = t0 + (float(i) + jit) * dt;
    vec3 p = ro + rd * t;
    vec4 cs = cover(p);
    float ice;
    // ⚠ THE FAR END IS A FADE, NOT A WALL. The march stops at uFar, and a cloud at uFar minus a hair
    // was full density, so weather arrived as a hard line about 9° above the horizon and grew down
    // out of it as you flew in. It thins over the last 30% of the reach instead, which is the band
    // the dome sprites fade in over ('edge' in paintWindshieldFrame), so the two hand over rather than swap. The
    // light march below is left alone: a far cloud is fainter, not lit differently.
    float dn = density(p, cs, ice) * (1.0 - smoothstep(uFar * 0.7, uFar, t));
    if (dn > 0.002) {
      // ── LIGHT MARCH ─────────────────────────────────────────────────────────────────────────
      // Six steps toward the sun, each longer than the last (9.4 tiles in all), so the top of a
      // tall cumulus shadows its own base. Four 0.45-tile steps reached 1.8 tiles and every base
      // was lit as if the cloud above it were a sheet. The near steps reuse this sample's coverage;
      // the far ones read their own, or a cloud's shadow would end at its own cell's edge. Once
      // the ray is mostly spent the last three are skipped: what they'd change is under 15%.
      float ld = 0.0, lt = 0.0;
      int nl = T > 0.15 ? 6 : 3;
      for (int j = 0; j < 6; j++) {
        if (j >= nl) break;
        float len = LSTEP[j];
        vec3 q = p + uSun * (lt + len * 0.5);
        ld += density(q, j < 3 ? cs : cover(q)) * len;
        lt += len;
      }
      ld *= 1.3;
      // ── SCATTERING ──────────────────────────────────────────────────────────────────────────
      // Wrenninge's octaves: each extra bounce is fainter, sees less extinction and is less
      // peaked, which keeps a thick body bright inside instead of going black at the core.
      float sun = 0.0, norm = 0.0, ka = 1.0, kb = 1.0;
      for (int o = 0; o < 3; o++) {
        if (o >= uMs) break;
        sun += ka * exp(-ld * kb) * mix(phaseOct[o], phaseIce[o], ice);
        norm += ka; ka *= 0.5; kb *= 0.5;
      }
      sun /= norm;
      // Powder (Schneider): a thin edge seen from the side or away from the sun has had nothing
      // scatter toward the eye yet, so it is dimmer than the body. Looking into the sun it is the
      // opposite (the silver lining), so the term fades out there.
      // Ice has no powder darkening worth the name: the crystals are sparse and the veil is thin.
      float powder = mix(mix(1.0 - exp(-dn * 2.0), 1.0, fwd), 1.0, ice);
      float hf = clamp((p.z - uBase) / (uTop - uBase), 0.0, 1.0);
      // The storm tint follows how much of this sample is the cumulonimbus or the nimbus, low down:
      // its upper tower and anvil stand in sunlight and are white, the base under them is slate.
      float grim = max(cs.y, cs.w * 0.7) * (1.0 - ice) * (1.0 - smoothstep(0.35, 0.8, hf) * 0.7);
      vec3 bc = mix(uBaseCol, uStormBase, grim), lc = mix(uLitCol, uStormLit, grim);
      // A nimbostratus is so deep that its base sees little of the sky above it.
      bc *= 1.0 - 0.3 * cs.w * (1.0 - hf) * (1.0 - ice);
      // Ice is whiter in the shade too: thin, so the sky shows through it.
      bc = mix(bc, lc, ice * 0.5);
      // Sky light from above, apart from the sun: the base is the shade tint, the top half way to
      // the lit tint. The sun then takes the colour toward its own tint (so a sunset reddens only
      // the side it reaches), and past full strength (the forward lobe) adds over it, clamped:
      // the target is 8-bit, so a silver lining is the rim going white against a darker body.
      vec3 amb = mix(bc, mix(bc, lc, 0.45), hf);
      vec3 sc = mix(uSunCol, uStormLit, grim);
      float f = sun * powder * uSunStr;
      vec3 col = min(mix(amb, sc, min(f, 1.0)) + sc * max(f - 1.0, 0.0) * 0.5, vec3(1.0));
      // The halo, on the ice veil only, where the sun reaches it.
      col += haloCol * (ice * uCirSheet * 0.12 * exp(-ld * 0.5) * uSunStr);
      // Lightning: each strike lights the cell around its channel from inside, softest at the top,
      // and the light dies through the cloud between the strike and this point (the optical depth
      // here is roughly the density times the distance).
      for (int k = 0; k < 4; k++) {
        vec3 fl = uFlash[k];
        if (fl.z <= 0.0) continue;
        float r = length(p.xy - fl.xy);
        float reach = exp(-r * r / 20.0) * exp(-r * dn * 0.35);
        col += uFlashCol * (fl.z * reach * mix(1.0, 0.45, hf) * (1.0 - ice * 0.5));
      }
      if (uGlowStr > 0.0) {
        // Light from below reaches the base and dies going up through the cloud above it.
        float g = texture(uGlow, (p.xy - uGlowOff) / (2.0 * uCoverRange) + 0.5).r;
        float up = 1.0 - hf;
        col += uGlowCol * (g * uGlowStr * up * up * up);
      }
      float a = 1.0 - exp(-dn * dt * 1.4);
      float w = T * a;
      acc += w * col; wsum += w; tsum += w * t;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
  }
  float alpha = 1.0 - T;
  // The shaded air is in front of the cloud: black at 'dark' over it, premultiplied.
  vec4 cur = vec4(acc * (1.0 - dark), 1.0 - T * (1.0 - dark));
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

const COMP_FS = linearOut(`#version 300 es
precision highp float;
out vec4 outColor;
${RAY_GLSL}
uniform mat4 uVP;
uniform vec2 uRes;       // full-resolution viewport, device pixels
uniform vec2 uLowRes;    // the march target
uniform sampler2D uCol;
uniform sampler2D uDist;
uniform float uFar;
uniform float uFade;     // the crossfade with the card deck (st.volMix in windshield.js); 1 is all volume
uniform float uSlice;    // this pass's place through the cloud, -1 (near) to 1 (far)
uniform float uSlices;   // how many passes share the cloud's alpha
uniform float uSpread;   // tiles either side of the hit the slices reach
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c = texture(uCol, uv) * uFade;
  if (c.a < 0.003) discard;
  ivec2 q = clamp(ivec2(uv * uLowRes), ivec2(0), ivec2(uLowRes) - 1);
  vec4 dp = texelFetch(uDist, q, 0);
  float t = (dp.r * 255.0 * 256.0 + dp.g * 255.0) / 65535.0 * uFar;
  // ⚠ ONE DEPTH WAS A WALL. A tower either stood wholly in front of the cloud or wholly behind it,
  // so a face went from clear to white along one line. The cloud is laid down in slices spread
  // through it instead, each a share of the alpha, so a wall reaching deeper in is covered more.
  // The slice depth is dithered per pixel so the steps between slices read as a gradient.
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float spread = min(uSpread, t * 0.5);
  t = max(0.0, t + (uSlice + (n - 0.5) * 2.0 / max(uSlices, 1.0)) * spread);
  vec3 ro, rd; camRay(uv * 2.0 - 1.0, ro, rd);
  vec4 clip = uVP * vec4(ro + rd * t, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  // Premultiplied: N passes of alpha s over each other make 1-(1-a)^N, so s = 1-(1-a)^(1/N).
  float s = 1.0 - pow(1.0 - min(c.a, 0.999), 1.0 / uSlices);
  outColor = c * (s / c.a);
}`, 'outColor');


function link(gl, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, FULL_VS, label + ' vertex'));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs, label + ' fragment'));
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
  const upperU = (p) => ({ cirrus: U(p, 'uCirrus'), cirSheet: U(p, 'uCirSheet'), alto: U(p, 'uAlto'), altoSheet: U(p, 'uAltoSheet') });
  // The upper decks' genera (vol.upper, from CLOUD_UPPER in windshield.js): [cirrus, cirrostratus,
  // altocumulus, altostratus], each 0..1. A caller that sends none (the ballpark) gets a little cirrus.
  const setUpper = (u, vol) => {
    const g = vol.upper || [0.15, 0, 0.1, 0];
    gl.uniform1f(u.cirrus, g[0]); gl.uniform1f(u.cirSheet, g[1]); gl.uniform1f(u.alto, g[2]); gl.uniform1f(u.altoSheet, g[3]);
  };
  const um = {
    invVP: U(march, 'uInvVP'), res: U(march, 'uRes'), noise: U(march, 'uNoise'), cover: U(march, 'uCover'), coverOff: U(march, 'uCoverOff'),
    coverRange: U(march, 'uCoverRange'), origin: U(march, 'uOrigin'), base: U(march, 'uBase'), top: U(march, 'uTop'),
    far: U(march, 'uFar'), time: U(march, 'uTime'), frame: U(march, 'uFrame'), cum: U(march, 'uCum'), steps: U(march, 'uSteps'),
    sun: U(march, 'uSun'), sunStr: U(march, 'uSunStr'), baseCol: U(march, 'uBaseCol'), litCol: U(march, 'uLitCol'),
    stormBase: U(march, 'uStormBase'), stormLit: U(march, 'uStormLit'), wind: U(march, 'uWind'), sheet: U(march, 'uSheet'), sheetOld: U(march, 'uSheetOld'), sheetFront: U(march, 'uSheetFront'),
    glow: U(march, 'uGlow'), glowStr: U(march, 'uGlowStr'), glowCol: U(march, 'uGlowCol'), glowOff: U(march, 'uGlowOff'),
    phaseG: U(march, 'uPhaseG'), ms: U(march, 'uMs'), sunCol: U(march, 'uSunCol'),
    flash: U(march, 'uFlash'), flashCol: U(march, 'uFlashCol'), ...upperU(march),
    shMap: U(march, 'uShMap'), air: U(march, 'uAir'), shOn: U(march, 'uShOn'),
    hist: U(march, 'uHist'), prevVP: U(march, 'uPrevVP'), shift: U(march, 'uShift'), histW: U(march, 'uHistW'),
  };
  const uc = {
    invVP: U(comp, 'uInvVP'), vp: U(comp, 'uVP'), res: U(comp, 'uRes'), lowRes: U(comp, 'uLowRes'),
    col: U(comp, 'uCol'), dist: U(comp, 'uDist'), far: U(comp, 'uFar'), fade: U(comp, 'uFade'),
    slice: U(comp, 'uSlice'), slices: U(comp, 'uSlices'), spread: U(comp, 'uSpread'),
  };
  // The shadow bake: its program, an R8 target the walls and the road read (gl/cloudshadow.js),
  // and what the last bake was, in world tiles. Built on first use, so a caller that never asks for
  // shadows (the ballpark) never compiles it.
  let shProg = null, shU = null, shTex = null, shFbo = null, shFrame = null;
  function shadowSetup() {
    shProg = link(gl, SHADOW_FS, 'shadow');
    shU = {
      noise: U(shProg, 'uNoise'), cover: U(shProg, 'uCover'), coverOff: U(shProg, 'uCoverOff'), coverRange: U(shProg, 'uCoverRange'),
      origin: U(shProg, 'uOrigin'), base: U(shProg, 'uBase'), top: U(shProg, 'uTop'), time: U(shProg, 'uTime'), cum: U(shProg, 'uCum'),
      wind: U(shProg, 'uWind'), sheet: U(shProg, 'uSheet'), sun: U(shProg, 'uSun'), res: U(shProg, 'uShRes'),
      ...upperU(shProg),
    };
    shTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SHADOW_N, SHADOW_N, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    shFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shTex, 0);
  }
  // Runs before the march, so the sky's shafts read this frame's map; the walls and the road read it
  // next frame. The values are the march's own, so the shadow is the cloud that is drawn.
  function bakeShadow(vol, coverOff, s, t, now) {
    if (!shProg) shadowSetup();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo);
    gl.viewport(0, 0, SHADOW_N, SHADOW_N);
    gl.useProgram(shProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, noiseTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.uniform1i(shU.noise, 0); gl.uniform1i(shU.cover, 1);
    gl.uniform2f(shU.coverOff, coverOff[0], coverOff[1]);
    gl.uniform1f(shU.coverRange, COVER_RANGE);
    gl.uniform2f(shU.origin, (vol.ox || 0) % 2000, (vol.oy || 0) % 2000);
    gl.uniform1f(shU.base, vol.base); gl.uniform1f(shU.top, vol.top);
    gl.uniform1f(shU.time, t);
    gl.uniform1f(shU.cum, vol.cum == null ? 0.5 : vol.cum);
    const wd = vol.wind || [0.05, 0.02];
    gl.uniform2f(shU.wind, wd[0], wd[1]);
    gl.uniform1f(shU.sheet, 0);
    setUpper(shU, vol);
    gl.uniform3f(shU.sun, s[0], s[1], s[2]);
    gl.uniform2f(shU.res, SHADOW_N, SHADOW_N);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // The reader's frame: the map's centre in WORLD tiles (the volume's frame is the eye's, which
    // moves), its half-span, the cloud base, and the sun as ground offset per unit of height.
    const sz = Math.max(0.12, s[2]);
    shFrame = {
      tex: shTex, at: now, half: COVER_RANGE, base: vol.base,
      cx: (vol.ox || 0) + coverOff[0], cy: (vol.oy || 0) + coverOff[1],
      slope: [s[0] / sz, s[1] / sz],
    };
  }

  const noiseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, noiseTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, NOISE_N, NOISE_N, NOISE_N, 0, gl.RED, gl.UNSIGNED_BYTE, bakeNoise());
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const coverTex = gl.createTexture();
  const coverData = new Uint8Array(COVER_N * COVER_N * 4);
  gl.bindTexture(gl.TEXTURE_2D, coverTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, COVER_N, COVER_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, coverData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // The underglow map: the same grid as the coverage, so one uv serves both.
  const glowTex = gl.createTexture();
  const glowAcc = new Float32Array(COVER_N * COVER_N), glowData = new Uint8Array(COVER_N * COVER_N);
  gl.bindTexture(gl.TEXTURE_2D, glowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, COVER_N, COVER_N, 0, gl.RED, gl.UNSIGNED_BYTE, glowData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let glowFrom = null;   // the point list last baked; the caller memoises it, so same list = same map

  // Each source is splatted as a soft disc a few tiles wide (light scatters before it reaches the
  // base), summed, then rolled off so a dense downtown saturates rather than clipping hard.
  function bakeGlow(pts) {
    if (pts === glowFrom) return;
    glowFrom = pts;
    glowAcc.fill(0);
    const step = (2 * COVER_RANGE) / COVER_N, R = GLOW_R / step, R2 = R * R;
    for (const p of pts) {
      const gx = (p.x + COVER_RANGE) / step, gy = (p.y + COVER_RANGE) / step;
      const x0 = Math.max(0, Math.floor(gx - R)), x1 = Math.min(COVER_N - 1, Math.ceil(gx + R));
      const y0 = Math.max(0, Math.floor(gy - R)), y1 = Math.min(COVER_N - 1, Math.ceil(gy + R));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - gx, dy = y + 0.5 - gy, d2 = (dx * dx + dy * dy) / R2;
        if (d2 < 1) glowAcc[x + COVER_N * y] += p.w * (1 - d2) * (1 - d2);
      }
    }
    for (let k = 0; k < glowAcc.length; k++) glowData[k] = Math.round(255 * (1 - Math.exp(-glowAcc[k] * GLOW_GAIN)));
    // Its own unit: by the time the march calls this, unit 1 holds the coverage map, and binding
    // here on whatever unit is active swapped the city in for the clouds for one frame.
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, glowTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, COVER_N, COVER_N, gl.RED, gl.UNSIGNED_BYTE, glowData);
  }

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
  // ⚠ THE GRID IS SNAPPED TO THE WORLD, NOT THE CAMERA. Centred on the eye, every texel (1.75 tiles)
  // slid under the clouds as you moved and their edges resampled, so a cloud's outline swam with
  // the camera. The bake is centred on the world texel nearest the eye; 'uCoverOff' carries the gap.
  function bakeCover(cells, offX, offY, cum = 0.5, wind = null) {
    coverData.fill(0);
    // Clear air carries the day's heap, so a cloud's filtered edge keeps its own genus.
    const h0 = Math.round(255 * Math.max(0, Math.min(1, cum)));
    for (let k = 2; k < coverData.length; k += 4) coverData[k] = h0;
    const step = (2 * COVER_RANGE) / COVER_N;
    for (const c0 of cells) {
      const c = { x: c0.x - offX, y: c0.y - offY, r: c0.r, i: c0.i, storm: c0.storm };
      // The genus channels: a cell that names none (the ballpark's) is read from its storm flag and
      // the day's cumulus share, as before.
      const cb = Math.round(255 * (c0.cb ?? (c0.storm ? 1 : 0)));
      const heap = Math.round(255 * Math.max(0, Math.min(1, c0.heap ?? cum)));
      const rain = Math.round(255 * (c0.rain ?? (c0.storm ? 1 : 0)));
      const inten = Math.max(0, Math.min(1, c.i));
      if (inten <= 0.02) continue;
      const r = c.r * 1.05;
      // The front's axis of motion: the cell's own drift, else the day's wind.
      const mv = (c0.vx != null ? [c0.vx, c0.vy] : (wind || [1, 0]));
      const ml = Math.hypot(mv[0], mv[1]) || 1, fu = mv[0] / ml, fv = mv[1] / ml;
      const x0 = Math.max(0, Math.floor((c.x - r * FRONT_ASPECT + COVER_RANGE) / step)), x1 = Math.min(COVER_N - 1, Math.ceil((c.x + r * FRONT_ASPECT + COVER_RANGE) / step));
      const y0 = Math.max(0, Math.floor((c.y - r * FRONT_ASPECT + COVER_RANGE) / step)), y1 = Math.min(COVER_N - 1, Math.ceil((c.y + r * FRONT_ASPECT + COVER_RANGE) / step));
      for (let y = y0; y <= y1; y++) {
        const wy = (y + 0.5) * step - COVER_RANGE;
        for (let x = x0; x <= x1; x++) {
          const wx = (x + 0.5) * step - COVER_RANGE;
          // A cell is a front, not a disc: long across its motion, short along it (FRONT_ASPECT).
          const dx = wx - c.x, dy = wy - c.y;
          const d = Math.hypot((dx * fu + dy * fv) * FRONT_ASPECT, (dy * fu - dx * fv) / FRONT_ASPECT) / r;
          if (d >= 1) continue;
          const e = d < 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
          const k = (x + COVER_N * y) * 4;
          const v = Math.round(255 * inten * e * e * (3 - 2 * e));
          if (v > coverData[k]) { coverData[k] = v; coverData[k + 1] = cb; coverData[k + 2] = heap; coverData[k + 3] = rain; }
        }
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, COVER_N, COVER_N, gl.RGBA, gl.UNSIGNED_BYTE, coverData);
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
    const cstep = (2 * COVER_RANGE) / COVER_N, ox0 = vol.ox || 0, oy0 = vol.oy || 0;
    const coverOff = [Math.round(ox0 / cstep) * cstep - ox0, Math.round(oy0 / cstep) * cstep - oy0];
    bakeCover(vol.cells, coverOff[0], coverOff[1], vol.cum == null ? 0.5 : vol.cum, vol.wind);
    // `opts.vp` is a caller's own matrix into this frame (camera-relative tiles, z up): the ballpark's
    const vp = opts.vp || viewProjMatrix(cam, cssH || H);
    const inv = invert4(vp);
    if (!inv) return 0;
    const far = Math.min(COVER_RANGE, vol.far || 48);

    // Pass 0: the shadow bake (gl/cloudshadow.js), for the city's cloud shadows and the shafts.
    const s = vol.sun || [0.4, 0.2, 0.9];
    const shaftOn = (vol.shaft || 0) > 0;
    if (opts.shadow || shaftOn) bakeShadow(vol, coverOff, s, ((opts.now || 0) / 1000) % 3600, opts.now || 0);
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
    gl.uniform2f(um.coverOff, coverOff[0], coverOff[1]);
    gl.uniform2f(um.origin, (vol.ox || 0) % 2000, (vol.oy || 0) % 2000);   // 2000: both noise octaves tile on it
    gl.uniform1f(um.base, vol.base); gl.uniform1f(um.top, vol.top);
    gl.uniform1f(um.far, far);
    gl.uniform1f(um.time, ((opts.now || 0) / 1000) % 3600);
    gl.uniform1f(um.frame, (frame = (frame + 1) % 64));
    gl.uniform1f(um.cum, vol.cum == null ? 0.5 : vol.cum);
    gl.uniform1i(um.steps, Math.max(8, Math.min(128, Math.round(opts.steps || 48))));
    gl.uniform3f(um.sun, s[0], s[1], s[2]);
    gl.uniform1f(um.sunStr, vol.sunStr == null ? 1 : vol.sunStr);
    gl.uniform1f(um.phaseG, Math.max(0, Math.min(0.9, opts.phase == null ? 0.6 : opts.phase)));
    gl.uniform1i(um.ms, Math.max(1, Math.min(3, Math.round(opts.ms == null ? 3 : opts.ms))));
    const b = opts.base || [0.7, 0.72, 0.76], l = opts.lit || [0.95, 0.95, 0.95];
    const sb = opts.stormBase || b, sl = opts.stormLit || l;
    gl.uniform3f(um.baseCol, b[0], b[1], b[2]); gl.uniform3f(um.litCol, l[0], l[1], l[2]);
    const sc = opts.sunCol || l;
    gl.uniform3f(um.sunCol, sc[0], sc[1], sc[2]);
    gl.uniform3f(um.stormBase, sb[0], sb[1], sb[2]); gl.uniform3f(um.stormLit, sl[0], sl[1], sl[2]);
    const wd = vol.wind || [0.05, 0.02];
    gl.uniform2f(um.wind, wd[0], wd[1]);
    gl.uniform1f(um.sheet, Math.max(0, Math.min(1, vol.sheet || 0)));
    const sf = vol.sheetFront || [0, 1, -1e4];
    gl.uniform1f(um.sheetOld, Math.max(0, Math.min(1, vol.sheetOld == null ? (vol.sheet || 0) : vol.sheetOld)));
    gl.uniform3f(um.sheetFront, sf[0], sf[1], sf[2]);
    setUpper(um, vol);
    const fl = new Float32Array(12);
    (vol.flashes || []).slice(0, 4).forEach((q, i) => { fl[i * 3] = q[0]; fl[i * 3 + 1] = q[1]; fl[i * 3 + 2] = q[2]; });
    gl.uniform3fv(um.flash, fl);
    gl.uniform3f(um.flashCol, 0.78, 0.82, 1.0);
    const glowOn = !!(vol.glow && vol.glow.length && vol.glowStr > 0);
    if (glowOn) bakeGlow(vol.glow);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, glowTex); gl.uniform1i(um.glow, 3);
    gl.uniform1f(um.glowStr, glowOn ? vol.glowStr * GLOW_STR : 0);
    gl.uniform3f(um.glowCol, GLOW_COL[0], GLOW_COL[1], GLOW_COL[2]);
    const go = vol.glowOff || [0, 0];
    gl.uniform2f(um.glowOff, go[0], go[1]);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, hist); gl.uniform1i(um.hist, 2);
    gl.uniformMatrix4fv(um.prevVP, false, new Float32Array(prevVP || vp));
    gl.uniform2f(um.shift, ox - prevOx, oy - prevOy);
    gl.uniform1f(um.histW, histW);
    // Unit 4: the shadow bake, for the shafts. Bound to nothing when there's no bake.
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, shaftOn && shTex ? shTex : null); gl.uniform1i(um.shMap, 4);
    gl.uniform1f(um.shOn, shaftOn && shTex ? Math.min(1, vol.shaft) : 0);
    gl.uniform1f(um.air, vol.air == null ? 0.015 : vol.air);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);
    prevVP = vp; prevOx = ox; prevOy = oy; histOK = true;

    // Pass 2: the composite, at full resolution, on the caller's depth buffer.
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevFb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    // ⚠ colour only: the city's depth is what we test against. `opts.over` draws over the caller's
    // picture instead (the ballpark draws its sky and park on the same target first)
    if (!opts.over) gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(comp); applyLinOut(gl, comp, opts.linOut);
    gl.uniformMatrix4fv(uc.invVP, false, new Float32Array(inv));
    gl.uniformMatrix4fv(uc.vp, false, mat4f(vp));
    gl.uniform2f(uc.res, W, H);
    gl.uniform2f(uc.lowRes, w, h);
    gl.uniform1f(uc.far, far);
    gl.uniform1f(uc.fade, opts.fade == null ? 1 : Math.max(0, Math.min(1, opts.fade)));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, colTexs[cur]); gl.uniform1i(uc.col, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, distTex); gl.uniform1i(uc.dist, 1);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Four slices, near to far, through ±1.5 tiles of the hit (see COMP_FS).
    const SLICES = 4;
    gl.uniform1f(uc.slices, SLICES);
    gl.uniform1f(uc.spread, 1.5);
    for (let k = 0; k < SLICES; k++) {
      gl.uniform1f(uc.slice, -1 + (2 * k + 1) / SLICES);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.depthMask(true);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return vol.cells.length;
  }

  // The last shadow bake (gl/cloudshadow.js), or null before the first.
  return { draw, shadowFrame: () => shFrame };
}

// Column-major 4x4 inverse (the layout camera.js builds). Null when singular (gl/core/mat4.js).
export { invert4 };
