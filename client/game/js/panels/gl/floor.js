// THE GROUND ITSELF, ON THE GPU.
//
// `drawMode7Floor` is the last large thing in GLASS 1 that has no GL path at all, and it is the one
// that decides whether GLASS 1 can ever be retired: switch the 2-D renderer off today and there is
// simply no ground. It is also the biggest fixed cost in the frame — a software per-pixel raster
// that costs the same over an empty desert as over a city, and the reason `PERF_DS` exists at all,
// a dial that degrades the WHOLE frame when the floor alone is struggling.
//
// ⚠ AND IT IS ALREADY A FRAGMENT SHADER, written in the only language that was available. Read the
// per-texel loop in windshield.js: it inverts the projection to a world point, samples a per-tile
// LUT, and layers material on top. Nothing about it is inherently CPU work. This is that same
// function, moved to where it belongs — not a re-imagining of it.
//
// ⚠ THE TERM ORDER IS THE RASTER'S, NOT A TIDIER ONE. Material multiplies into one `tex` scalar in
// a fixed sequence — concrete, grass, hillshade, arid, water, shoreline, near field, downwash — and
// the specular adds ride outside it. Several of those steps read what an earlier one wrote (the
// hillshade is gated on waterness; the shoreline emboss reads the same waterW the surf band does),
// so re-ordering them is not a refactor, it is a different picture.
//
// ⚠ THE ONE THING THAT DOES NOT MATCH TEXEL FOR TEXEL IS THE NOISE. `vnoise2` hashes through
// `frac(n) = fract(sin(n * 12.9898) * 43758.5453)`, which needs a 64-bit mantissa to mean anything:
// at highp the multiply lands around 1e9 with 24 bits to spend, so the fractional part comes out as
// quantisation rather than as the CPU's number. An integer hash is used instead — same amplitude,
// same frequency, same statistics, and the cracked-clay patches and the wind lanes on open water
// simply fall in different places. That is a grain, not a position: nothing in the world stands on
// it and no other term reads it.
//
// ⚠ WHAT IT STILL DOES NOT DO: nothing. Every term in `drawMode7Floor` is here, and it is the
// DEFAULT — `RENDER_TUNE.glFloor = 0` puts the software raster back. Measured over twenty scenes
// by `__glFloor()`: worst 2.30% of pixels differing, mean colour 0.10–0.72%. Worth 32.9 ms → 1.3
// on a city cab frame and 65.4 → 0.6 over open sea.
//
// ⚠ THE FAIL-SAFE IS IN windshield.js, NOT HERE. Every way this can fail to draw ends at
// `RENDER_TUNE.gl = 0`, and `drawMode7Floor` tests THAT as well as `glFloor` before it returns
// early — otherwise a machine with no WebGL2 gets no ground at all rather than a slower one.

// ⚠ THE CLIP RANGE IS IMPORTED, AND IT USED TO BE A LITERAL COPY. The z uniforms below read
// `const near = 0.06, far = 400.0` until the plane became something the frame fits to its camera
// — the exact second copy the ⚠ on NEAR/FAR in camera.js warns about, and the exact thing that
// goes wrong quietly once the number moves: the mass clips at the frame's own plane while the
// floor writes depth for one nothing else uses, so the ground sits a hair off every building
// standing on it and nothing in the picture says why.
import { NEAR, zRow } from './camera.js';
import { HEIGHT_FOG_GLSL } from './fog.js';
import { seaSlopeVariance } from '../../../../shared/sea-swell.js';
import { SEA_GLSL } from './sea-glsl.js';   // the ONE GLSL copy of the swell — water.js includes the same string, and client/shared/sea-swell.js is the JS original

// A screen-filling triangle rather than a quad: no diagonal seam, one fewer vertex, and the
// interpolators do not care. The vertex shader synthesises it from gl_VertexID, so there is no
// buffer to bind at all.
const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;

// The camera, as drawMode7Floor's own terms. Every one of these is lifted from that function
// rather than re-derived, because a floor drawn from a slightly different camera is a floor the
// buildings do not stand on.
uniform float uEH;         // eye height, after the chase lift and the floor
uniform float uHorizonY;   // in CSS pixels, and it can sit off the canvas in a steep chase
uniform float uDepth;      // the vertical focal length
uniform float uCx;         // principal point across
uniform float uHalfW;
uniform float uLAT;        // halfW / the camera's lateral focal length — see viewLatFocal
uniform float uSinh;
uniform float uCosh;
uniform vec2  uA;          // the craft's ground point, chase offset already folded in
uniform float uDpr;        // gl_FragCoord is in device pixels; everything above is in CSS
uniform float uViewH;

uniform sampler2D uLut0;   // rgb = tile colour, a = waterness
uniform sampler2D uLut1;   // r = grassness, g = hillshade/2, b = paved
uniform int   uMh;         // the LUT is uMh x uMh
uniform float uR;          // the window's half-width in tiles

uniform vec3  uHor;        // horizon colour the haze mixes toward, 0-1
uniform float uHz;         // the haze slider
uniform float uHazeMax;
uniform float uNm;         // night dim, 1 - night * 0.42
uniform float uFreq;       // RENDER_TUNE.tile
uniform float uCwarp;      // coast warp amplitude, in tiles
uniform vec2  uWc;         // the window centre in WORLD tiles — the warp phase is absolute
uniform float uSeamEB;

// The wildlands palette, for the ground past the window. Uniforms rather than literals because
// these two are BIOME_GROUND.badlands and .redrock, which the LUT paints the near half of the same
// desert with: a second copy here would be a copy that could be retuned on one side only, and the
// symptom would be a colour step at the window edge that looks like the blend being wrong.
uniform vec3 uFarDirt;
uniform vec3 uFarRock;
uniform float uFarOn;     // RENDER_TUNE.farTerrain; 0 puts the clamp back

// THE VOID HIGHWAY, PAST THE WINDOW. Segment endpoints in window-relative tiles (the frame wx/wy
// are already in), a half-width, and the packed-dirt colour the near road paints with. See farRoad.
// ⚠ AN ARRAY THIS LONG IS A UNIFORM BUDGET QUESTION, AND THE ANSWER WAS MEASURED RATHER THAN
// ASSUMED. A vec4[48] is 48 of the fragment shader’s uniform vectors; WebGL2 only GUARANTEES 224,
// and a floor that will not link does not degrade — it throws, which hands the whole city back to
// the 2-D renderer. Linked and counted: 114 of 224, so there is room for this and for the twelve
// the wet-road reflection already takes. Raise it and re-count.
const int MAX_ROAD = 48;
uniform int   uNRoad;
uniform vec4  uRoadSeg[MAX_ROAD];   // xy = one end, zw = the other
uniform float uRoadW;
uniform vec3  uRoadCol;

// The N64 fog band, which is a SECOND distance term and not the haze above it: the haze is a
// per-row wash toward the horizon, and this is a squared ramp between two world distances that the
// BUILDING pass shares. Leaving it out made the far ground and the far towers dissolve at
// different rates, which reads as a skyline floating over the plain.
uniform float uFogAmt;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogCol;
// The air at street level — see gl/fog.js. The terrain is at z = 0 like the streets are, so this
// is the same degenerate case the ground pass takes, and it must be the same arithmetic: the road
// is drawn over this floor and a seam between the two would be a line of haze along every kerb.
uniform float uFogH;
uniform float uFogHScale;     // the horizon colour times the night dim, already resolved

// Water, and the weather over it.
uniform float uT;          // seconds
// ── THE LIT SEA ───────────────────────────────────────────────────────────────────────────────
// uSeaLit is RENDER_TUNE.glSeaLit: how much of the water's shading comes from a real surface
// normal rather than from the shipped brightness tint. 0 is bit-identical to the sea that shipped,
// which is the whole reason the two models are mixed rather than added.
// uSeaRoll is the long swell's amplitude in TILES — the 8.6-tile train that carries the rolling
// read and that a hull rides. It is the term Phase 5 drives off the sea state; at 0 there is no
// roll at all and only the 1-tile chop remains.
// uSeaAmp is the chop's own physical amplitude, also in tiles.
uniform float uSeaLit;
uniform float uSeaRoll;
uniform float uSeaWind;   // the wind sea amplitude — the steep 3.2-tile train
uniform float uShoal;    // how far, in tiles, a crest is dragged along the shore as it shallows
uniform float uSpread;   // 0 = the single-train sea that shipped, 1 = the full spectral band
uniform float uSeaAmp;
uniform vec2  uSunDir;
uniform float uSunElev;
uniform vec2  uMoonDir;
uniform float uMoonElev;
uniform float uNight;
// ── THE CITY'S LIGHT LYING ON THE WATER ────────────────────────────────────────────────────────
// The same six the mesh takes, and the same Cox & Munk glitter — see 'seaGlitter' in sea-glsl.js.
// ⚠ THE FLOOR NEEDS IT AS WELL AS THE MESH, AND NOT ONLY FOR THE FAR FIELD. water.js returns
// without drawing at all when the swell is zero ("no swell, no mesh — the flat floor is the whole
// sea"), so a GLASSY sea has no mesh anywhere — and a glassy sea is the single case where a
// reflection matters most. Measured before this was here: 3.91% of a night frame at sea state 0.55
// and 0.00% at state 0, which reads as a reflection that switches itself off on flat water.
#define NEON_MAX 6
uniform int   uNeonN;
uniform vec4  uNeonP[NEON_MAX];   // xyz = ground point and height, w = reach in tiles
uniform vec3  uNeonC[NEON_MAX];
uniform float uNeonGain;
uniform vec2  uSig2;              // slope variance: x along the wind, y across it
uniform vec2  uSeaWindDir;        // the axis the glitter stretches along
uniform float uHeliDown;   // downwash strength; 0 for anything that is not a heli in ground effect
uniform float uRotor;
uniform vec2  uDC;         // the craft's ground point, for the downwash disc

// The z mapping projMatrix uses, so the floor lands in the SAME depth buffer the mass does.
uniform float uZA;
uniform float uZB;

// ── WET TARMAC: THE CITY'S OWN LIGHTS, REFLECTED ───────────────────────────────────────────────
//
// Every one of the reference boards this was built from has neon lying on wet asphalt, and this
// shader already holds all three things that needs: the world point under the pixel, how far away
// it is, and — in uLut1.b — whether it is PAVED. The lights are the same list the mass shader takes
// for its wall wash, so nothing new is collected and nothing new is authored.
//
// ⚠ SIX, NOT TWELVE. The brightest few are the whole effect, and this is per-pixel over the entire
// lower half of the frame rather than over the walls.
//
// ⚠ AND IT IS SWITCHED OFF, BECAUSE THIS SHADER CANNOT SEE MOST OF THE ROAD. Measured: on bare
// ground the floor is 55.6% of the frame, and on a paved street it is 17.9% — GROUND_FULL draws
// every road and pavement tile as an opaque quad at SURF_EPS, ON TOP of the floor, so the surface
// this term is gated to (pavedW) is precisely the surface the ground pass then covers. The term is
// correct and invisible. Finishing it means putting the same reflection in gl/ground.js's shader,
// or stopping the tile fill from being opaque over the floor — a design decision, not a tune.
const int MAX_WET = 6;
uniform int   uNWet;
uniform vec3  uWetP[MAX_WET];   // ground point x,y in THIS shader's frame + the light's height
uniform vec3  uWetC[MAX_WET];   // colour, 0-1
uniform float uWetR[MAX_WET];   // reach in tiles, the same figure pickLights gives the wall wash
uniform float uWet;             // how wet the ground is, 0-1

// ── SNOW LYING ON THE GROUND ───────────────────────────────────────────────────────────────────
//
// How deep it lies, 0-1, integrated from the weather in windshield.js — see 'SNOW_NOW'. Snow is an
// accumulation rather than a film, which is why it is not another reading of 'uWet'.
//
// ⚠ THE FLOOR IS THE TERRAIN AND NOT THE STREETS. 'GROUND_FULL' paints every road and pavement tile
// as an opaque quad on top of this shader, so what is covered here is the open ground — the grass,
// the desert, the verges, the parks and everything outside the city — and the city's own snow is in
// gl/ground.js. That is the same split the wet reflections were forced into, in the same words, and
// the note on 'uWet' above is the record of finding it out the expensive way. This one was built
// with it already known.
uniform float uSnow;

// ── WHEEL TRACKS CUT INTO IT ───────────────────────────────────────────────────────────────────
//
// Points of a path in the same window-relative tiles this shader already works in, collected on
// the CPU from the own ship and from every CONTACT with its wheels down — see the store in
// windshield.js. xy is the point, z is how far from buried it is (1 fresh, 0 gone), and w is 1
// when it joins the NEXT point and 0 when it is the last of a run.
//
// ⚠ ONE ARRAY, POINTS RATHER THAN SEGMENTS, AND THAT IS WHAT PAYS FOR THE FADE. A segment list
// would be a vec4 of two endpoints with nowhere left to put the burial, so the fade would need a
// second array and twice the uniform vectors. A polyline carries n-1 segments in n vec4s AND has
// a spare component per point, which the run-break flag then rides for nothing.
const int MAX_TRACK = 40;
uniform int   uNTrack;
uniform vec4  uTrack[MAX_TRACK];
uniform float uTrackHalf;   // half the wheel track: the two marks sit this far either side
uniform float uTrackW;      // half-width of ONE wheel mark
uniform vec4  uTrackBox;    // the whole path bounded, padded — see the reject below

// How much of the cover this fragment has had cut out of it, 0-1.
//
// ⚠ ONE DISTANCE, TWO WHEELS. The perpendicular distance to the centreline is all that is needed:
// a pair of marks either side of it is abs(d - half) tested against the width, so nothing has to
// store, upload or walk a second polyline. ⚠ It is the perpendicular to the segment's own LINE and
// not the distance to the segment — see the trap inside.
//
// ⚠ AND IT CONSERVES INK AT RANGE, the rule gl/strokes.js states for a sub-pixel wire and
// roadCoverage repeats for a distant road: a mark thinner than the pixel it lands in is drawn
// faint rather than by a coin toss, or a track a long way off is a crawling dotted line.
float trackCut(vec2 gp, float fp) {
  if (uNTrack < 2) return 0.0;
  // The rectangle reject. Thirty-nine segments a fragment is far more than the six the wet
  // reflections run, and almost none of the frame is near a track.
  if (gp.x < uTrackBox.x || gp.y < uTrackBox.y || gp.x > uTrackBox.z || gp.y > uTrackBox.w) return 0.0;
  float hw  = max(uTrackW, fp);
  float ink = min(1.0, uTrackW / max(fp, 1e-5));
  float best = 0.0;
  for (int i = 0; i < MAX_TRACK - 1; i++) {
    if (i + 1 >= uNTrack) break;
    vec4 A = uTrack[i];
    if (A.w < 0.5) continue;              // last point of a run: it joins nothing
    vec4 B = uTrack[i + 1];
    vec2 ab = B.xy - A.xy;
    float l2 = dot(ab, ab);
    if (l2 < 1e-9) continue;              // the live head on the frame it is born
    float len = sqrt(l2);
    vec2 dir = ab / len;
    vec2 pa  = gp - A.xy;
    // ⚠ THE PERPENDICULAR TO THE INFINITE LINE, WITH 't' UNCLAMPED — WHICH IS THE WHOLE FIX.
    // This used to be the distance to the SEGMENT, clamped, and 'abs(d - uTrackHalf)' over that is
    // an ANNULUS around a capsule: two parallel rails, and a semicircular arc of radius uTrackHalf
    // wrapped round each end. Consecutive segments share a vertex, so the arc off the end of one
    // and the arc off the start of the next close into a full CIRCLE at every point in the path —
    // and on a dead straight drive those are a string of beads down the middle of the track,
    // tangent to both rails, 0.32 tiles across and one every TRACK_STEP for ever. Measuring the
    // perpendicular to the LINE and cutting the segment off square at its own ends draws the rails
    // and nothing else.
    float t = dot(pa, dir) / len;
    float s = abs(pa.x * dir.y - pa.y * dir.x);
    float cov = (1.0 - smoothstep(hw - fp, hw + fp, abs(s - uTrackHalf))) * ink;
    // ⚠ AND THE SQUARE END IS MITRED ONLY WHERE THE RUN CARRIES ON. A butt cap on every segment
    // leaves a wedge on the OUTSIDE of every bend, because the rail is offset uTrackHalf from a
    // centreline that just changed direction; the gap is uTrackHalf * tan(half the turn), so half
    // the wheel track covers a 53° kink and a rig takes a junction in about 25° a point. At a true
    // run end — the head under the wheels, the tail falling out of the buffer, either side of a
    // relay gap — there is nothing to mitre INTO, and the end stays square.
    float mit = min(uTrackHalf * 0.5, len * 0.5) / len;
    float pw  = i > 0 ? uTrack[max(i - 1, 0)].w : 0.0;
    float m0  = pw  > 0.5 ? mit : 0.0;
    float m1  = B.w > 0.5 ? mit : 0.0;
    // ⚠ THE LONGITUDINAL FEATHER IS FOR A RUN END AND NOWHERE ELSE. A joint is already covered
    // twice over by the mitre, so a screen-width ramp there only dims the seam — and 'fp' is most
    // of a segment long at the far end of a street, which would put a grey dot at every point in
    // the path rather than at none.
    float aa  = min(0.40, max(fp, 1e-5) / len);
    float e0  = m0 > 0.0 ? 1e-4 : aa;
    float e1  = m1 > 0.0 ? 1e-4 : aa;
    float ends = smoothstep(-m0 - e0, -m0 + e0, t) * smoothstep(-m1 - e1, -m1 + e1, 1.0 - t);
    best = max(best, cov * ends * mix(A.z, B.z, clamp(t, 0.0, 1.0)));
  }
  return clamp(best, 0.0, 1.0);
}

// A term-by-term readout, because a floor that is 25% dark says nothing about WHICH factor did it.
// 0 = the picture; 1 = the raw LUT colour; 2 = tex as grey; 3 = the haze weight; 4 = shade as grey;
// 5 = a marker at each light's ground point, which is how the FRAME was settled — see the ⚠ in
// world.js. Reading the conversion off the code gets you a sub-tile error that looks like art.
uniform int uDebug;

out vec4 outColor;

// The LUT is read by TEXEL, never sampled: the bilinear this floor does is not the hardware's.
// Colour is blended through a SHARPENED fraction so a patch of terrain reads as a tile with a
// crisp edge, while water, grass, shade and paved blend smoothly so the shoreline and the
// materials feather across the same seam. Two different blends of the same four taps.
vec4 lut0At(int x, int y) {
  return texelFetch(uLut0, ivec2(clamp(x, 0, uMh - 1), clamp(y, 0, uMh - 1)), 0);
}
vec4 lut1At(int x, int y) {
  return texelFetch(uLut1, ivec2(clamp(x, 0, uMh - 1), clamp(y, 0, uMh - 1)), 0);
}
float pavedAt(float fx, float fy) {
  return lut1At(int(floor(fx)), int(floor(fy))).b;
}
float seamF(float u) {
  float t = clamp((u - 0.5 + uSeamEB) / (2.0 * uSeamEB), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// The same smooth value noise the raster runs, on a hash a 32-bit float can hold — see the note at
// the top of this file for why it is not the raster's own hash.
float vn2h(int a, int b) {
  uint h = uint(a) * 374761393u + uint(b) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h & 0xffffu) / 65535.0;
}
float vnoise2(float x, float y) {
  float xi = floor(x), yi = floor(y);
  float xf = x - xi, yf = y - yi;
  int ix = int(xi), iy = int(yi);
  float u = xf * xf * (3.0 - 2.0 * xf), v = yf * yf * (3.0 - 2.0 * yf);
  float a = vn2h(ix, iy), b = vn2h(ix + 1, iy), c = vn2h(ix, iy + 1), e = vn2h(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
}

// ── THE GROUND PAST THE MAP WINDOW ───────────────────────────────────────
//
// The long note lives in windshield.js beside 'farGround'. The short of it: 'lut0At' CLAMPS, and a
// clamp radiating outward is one ring of tiles smeared to infinity — the long converging streaks
// that run to the horizon over open country and never change however far you fly. Past the window
// the ground is synthesised from the absolute world coordinate instead.
//
// ⚠ AND THIS IS THE ONE PLACE THE SHADER DOES NOT GET ITS OWN GRAIN. The note at the top of this
// file says the raster's 'frac' hash cannot survive highp and that running a different one here is
// harmless — true of the cracked clay, and false of this. It is the same ground the CPU raster
// paints when glFloor is 0, and it is the same ground the LUT itself carries on the near side of
// the boundary: a relief that disagreed would hang a ring of mismatched hillshade round the
// aircraft at exactly the window edge. So the terrain hashes through THIS hash on both sides —
// windshield.js runs the identical integer mix, because 'Math.imul' is a 32-bit multiply and
// '>>> 0' is the unsigned read.

const float GE_WARP = 80.0, GE_WARP_F = 0.0055;
// fBm, mirroring windshield.js character for character — see the long note there. A relief the two
// floors disagree about draws a ring of mismatched hillshade at the map-window edge, so the octave
// count, the frequencies, the offsets and the gain are all copied rather than re-derived.
float fbm2(float x, float y, int oct, float pers) {
  float amp = 0.5, f = 1.0, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    sum += (vnoise2(x * f, y * f) - 0.5) * amp;
    norm += amp; f *= 2.0; amp *= pers;
  }
  return sum / (norm * 2.0);
}
const float GE_F = 0.026, GE_PERS = 0.58, GE_GAIN = 7.55;
const int GE_OCT = 4;
float groundElev(float gx0, float gy0) {
  float wx = gx0 + (vnoise2(gx0 * GE_WARP_F - 3.1, gy0 * GE_WARP_F + 7.7) - 0.5) * GE_WARP;
  float wy = gy0 + (vnoise2(gx0 * GE_WARP_F + 17.3, gy0 * GE_WARP_F - 11.9) - 0.5) * GE_WARP;
  return fbm2(wx * GE_F + 11.3, wy * GE_F - 4.9, GE_OCT, GE_PERS) * GE_GAIN;
}
const float WILD_WARP = 42.0, WILD_PROV_F = 0.0065;
float wildsRelief(float x, float y) {
  float wx = x + (vnoise2(x * 0.021 + 13.7, y * 0.021 - 5.3) - 0.5) * WILD_WARP;
  float wy = y + (vnoise2(x * 0.021 - 8.1, y * 0.021 + 21.9) - 0.5) * WILD_WARP;
  float prov = vnoise2(x * WILD_PROV_F + 4.5, y * WILD_PROV_F + 9.25);
  float ridgeAmp = 0.35 + prov * 1.45;
  float terrAmp = 0.45 + (1.0 - prov) * 1.25;
  float ridge = 1.0 - abs(fbm2(wx * 0.026 + 5.7, wy * 0.026 - 2.4, 3, 0.55) * 2.0);
  // ⚠ floor(v + 0.5), NEVER round(v). JavaScript's Math.round breaks a .5 tie upward and GLSL's
  // round() is implementation-defined there (most drivers round half to even). A terrace is a
  // quantiser, so the tie lands on every escarpment edge in the field — precisely the lines the eye
  // is drawn to — and the two renderers would disagree by a whole step along all of them.
  float terrace = floor(fbm2(wx * 0.017 - 1.9, wy * 0.017 + 6.1, 3, 0.55) * 4.0 * 1.5 + 0.5) / 1.5;
  return terrace * 1.3 * terrAmp + ridge * ridge * 1.1 * ridgeAmp;
}
float aridElev(float x, float y) { return groundElev(x, y) + wildsRelief(x, y); }
// The finite-difference hillshade 'reliefShade' runs, at arid = 1: the far field is dry land by
// construction, and whether it is SEA out there is the boundary tile’s answer rather than this
// function’s. See the windshield note on why that one bit stays with the clamp.
float farShade(float awx, float awy, vec2 lit) {
  float e0 = aridElev(awx, awy);
  float gx = aridElev(awx + 0.5, awy) - e0, gy = aridElev(awx, awy + 0.5) - e0;
  return clamp(1.0 + (-gx * lit.x - gy * lit.y) * 3.0, 0.66, 1.34);
}
// rgb + hillshade for one far tile.
// COAST_WOBBLE is windshield.js's own constant, and it has to be the same number: it is what
// 'fillOffMap' ragged-izes the off-map coast INSIDE the window with, and this file ragged-izes the
// continuation of that same coast outside it.
const float FAR_FADE = 26.0, DEEP_INTO = 0.786, COAST_WOBBLE = 6.0;
vec4 farGround(float awx, float awy, vec2 lit) {
  float rr = clamp(DEEP_INTO * 0.7 + vnoise2(awx * 0.06, awy * 0.06) * 0.6 - 0.15, 0.0, 1.0);
  return vec4(mix(uFarDirt, uFarRock, rr), farShade(awx, awy, lit));
}
// How far outside the LUT a sampling position sits, in tiles; 0 anywhere inside it. Chebyshev, to
// match the clamp's own per-axis shape — the band then runs parallel to the window edge instead of
// bulging at the corners.
float outsideBy(float fx, float fy) {
  float m = float(uMh - 1);
  return max(max(-fx, fx - m), max(-fy, fy - m));
}

// ── THE HIGHWAY AT A RANGE THE MAP WINDOW CANNOT REACH ────────────────────────────────────────
//
// The corridor is real ground: a truck drives it, a walker stands on it, and it carries boards
// counting down the miles. Inside the window it arrives as ordinary cells and is drawn as tarmac
// with lane markings on it. Past the window it used to stop dead in mid-desert, because the window
// is where cells stop. The server sends the geometry instead (see registerFarRoads), and this is
// the rasteriser: distance from the ground point to the nearest segment, against a half-width.
//
// ⚠ IT ONLY RUNS OUTSIDE THE WINDOW, AND THAT IS NOT AN OPTIMISATION. Inside it the road is drawn
// from cells, with its markings, its wear and its taper; painting a flat band over that as well
// would be two roads on top of each other disagreeing about the paint. The crossfade that brings
// the far terrain in brings the far road in with it, so the band appears exactly as the cells run
// out.
//
// ⚠ AND THE BAND IS WIDENED TO A PIXEL WITH THE SHORTFALL CARRIED IN THE BLEND. At 200 tiles a
// 4.3-tile road is a fraction of one pixel across, and a hard in/out test on a sub-pixel line does
// not draw a thin road — it draws a dotted one that crawls as you fly. Same rule gl/strokes.js
// states for a sub-pixel wire, and for the same reason: ink is conserved, so a road half a pixel
// wide is one pixel at half strength rather than a coin toss per pixel.
float roadCoverage(vec2 gp, float fp) {
  if (uNRoad <= 0 || uRoadW <= 0.0) return 0.0;
  float best = 1e9;
  for (int i = 0; i < MAX_ROAD; i++) {
    if (i >= uNRoad) break;
    vec4 sg = uRoadSeg[i];
    vec2 ab = sg.zw - sg.xy;
    float l2 = dot(ab, ab);
    float t = l2 < 1e-9 ? 0.0 : clamp(dot(gp - sg.xy, ab) / l2, 0.0, 1.0);
    best = min(best, length(gp - (sg.xy + t * ab)));
  }
  float hw = max(uRoadW, fp);
  return (1.0 - smoothstep(hw - fp, hw + fp, best)) * min(1.0, uRoadW / max(fp, 1e-5));
}

${HEIGHT_FOG_GLSL}
${SEA_GLSL}
void main() {
  // CSS pixel coordinates, which is the frame drawMode7Floor works in.
  float sx = gl_FragCoord.x / uDpr;
  float sy = (uViewH - gl_FragCoord.y) / uDpr;

  // The inverse of the projection, exactly as the raster walks it: a screen row is a depth.
  float p = max(0.004, (sy - uHorizonY) / uDepth);
  float d = uEH / p;
  float l = ((sx - uCx) / uHalfW) * d * uLAT;
  float wx = uA.x + d * uSinh + l * uCosh;
  float wy = uA.y - d * uCosh + l * uSinh;

  // Everything above the horizon belongs to the sky pass; leave it alone rather than painting over
  // it, because this buffer is composited onto a frame that already has a sky in it.
  if (sy <= uHorizonY) discard;

  // High-frequency detail aliases into a checkerboard once one pixel spans several world units.
  // Fading the AMPLITUDE with distance is the cheap mip-map the 2-D pass uses, and dropping it
  // would put the shimmer back.
  float detail = clamp(1.15 - d * 0.7, 0.15, 1.0);
  // Schlick, for the water: a steep view sees the body colour, a grazing one mirrors the sky.
  // ⚠ 'd' IS THE FORWARD DISTANCE AND NOT THE GROUND RANGE, which is a real error this term has
  // always carried: the range to the point is sqrt(d² + l²), and dropping 'l' overstates cosI at
  // the frame edges. It is invisible in a Schlick wash — the sheen is simply a touch weaker out at
  // the corners — and it is NOT invisible under a specular lobe, where it walks the highlight
  // toward the horizon as you look sideways. Fixed with the lit sea so the shipped picture is
  // bit-identical at uSeaLit 0, since 'fres' has exactly one consumer and it is the water.
  float gr2 = d * d + (uSeaLit > 0.001 ? l * l : 0.0);
  float cosI = uEH / sqrt(gr2 + uEH * uEH);
  float fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);

  // Domain-warp the sampling position so a coast meanders off the tile grid — but never near
  // anything man-made, or a kerb wobbles. The phase reads ABSOLUTE world coords so the wave is
  // pinned to the world and does not snap a whole tile when the window recentres.
  //
  // ⚠ TWO OCTAVES, BECAUSE ONE OF THEM FOLDED THE DOMAIN. This was a single sine at amplitude
  // 0.9 tiles and frequency 1.9 rad/tile, and a domain warp stops being injective once
  // amplitude × frequency passes 1: the Jacobian determinant of that pair bottoms out at
  // -2.13, so the map turns the plane inside out over a lens at every antinode. What that
  // draws is not a meander — it is a row of CUSPS at the sine's own 3.3-tile period, which is
  // why every shoreline in the game was a sawtooth and why the river south of Coldwater came
  // out as a zigzag with the pond on the end of it rendered as a starburst. The warp was doing
  // the opposite of its job: it exists to take the 90° corners off a tile-quantised coast, and
  // it was replacing them with sharper ones at a higher frequency.
  //
  // The amplitude is what a coast wants and the FREQUENCY was what could not be paid for, so
  // the displacement is split: a slow octave carries most of it (0.55 rad/tile, an 11-tile
  // wavelength — a bay-sized meander) and a fast one keeps the fine raggedness at the original
  // frequency with a fifth of the throw. Min determinant 0.383, so it never folds at any
  // phase; rms displacement 0.73 tiles against 0.90, so the coast moves about as far as it did.
  //
  // ⚠ WINDSHIELD.JS HOLDS THE SAME EXPRESSION AND THE TWO MUST MATCH TERM FOR TERM. The raster
  // and this shader are two renderings of one ground, and a coast that meanders differently
  // depending on which one is drawing it is the drift 'drawMode7Floor' exists to prevent.
  // Both are pinned by scripts/shapes/coastwarp.mjs, which reads the coefficients out of the
  // two files rather than restating them.
  float wpx = wx, wpy = wy;
  if (uCwarp > 0.001 && pavedAt(uR + wx, uR + wy) < 0.5) {
    float awx = wx + uWc.x, awy = wy + uWc.y;
    float nx = wx + uCwarp * (0.78 * sin(awy * 0.55 + awx * 0.15) + 0.22 * sin(awy * 1.9 + awx * 0.5));
    float ny = wy + uCwarp * (0.78 * sin(awx * 0.55 - awy * 0.15 + 2.1) + 0.22 * sin(awx * 1.9 - awy * 0.5 + 2.1));
    float jx = uR + nx, jy = uR + ny;
    if (pavedAt(jx, jy) < 0.5 && pavedAt(jx + 1.0, jy) < 0.5
     && pavedAt(jx, jy + 1.0) < 0.5 && pavedAt(jx + 1.0, jy + 1.0) < 0.5) { wpx = nx; wpy = ny; }
  }

  float fx = uR + wpx, fy = uR + wpy;
  // How far outside the window this sampling position sits — needed HERE, before the taps, because
  // the wobble below has to move the taps themselves.
  float fOut = uFarOn > 0.5 ? outsideBy(fx, fy) : 0.0;
  // ── THE COAST OUT THERE IS RAGGED, NOT RULED ────────────────────────────────────────────────
  //
  // Past the window every tap collapses onto the boundary tile the ray happens to leave through,
  // so the land/sea answer is a ring of 288 whole-tile decisions smeared radially — and where that
  // ring changes its mind, the coastline is a dead-straight ray out of the camera with one
  // triangular tooth per boundary tile along it. Softening the blend only blurs the teeth; the
  // ruled line survives it, because a ruled line is what a radial smear of a quantised ring IS.
  //
  // So wobble the SAMPLING POSITION rather than the result. It is the same two-octave noise, at the
  // same frequencies and the same COAST_WOBBLE amplitude, that 'fillOffMap' already uses to stop
  // its own off-map coast being a clean offset of the built one — so the coast past the window
  // meanders in exactly the way the coast inside it does, and for the same reason.
  //
  // ⚠ IT MOVES BOTH THE COLOUR AND THE WATERNESS, WHICH IS THE WHOLE POINT. A noise laid on waterW
  // alone ragged-izes where the far GROUND is suppressed while the sea/desert colour step stays
  // ruled underneath it, which looks like a wobbly mask over a straight edge — worse than either.
  // ⚠ AND THE AMPLITUDE RAMPS FROM ZERO AT THE WINDOW EDGE, so the near/far handoff is still
  // continuous by construction: at the edge this displaces nothing at all.
  if (fOut > 0.0) {
    float awx0 = wpx + uWc.x, awy0 = wpy + uWc.y;
    float amp = COAST_WOBBLE * clamp(fOut / FAR_FADE, 0.0, 1.0);
    fx += ((vnoise2(awx0 * 0.09, awy0 * 0.09) - 0.5)
         + (vnoise2(awx0 * 0.23, awy0 * 0.23) - 0.5) * 0.45) * amp;
    fy += ((vnoise2(awx0 * 0.09 + 31.7, awy0 * 0.09 - 12.3) - 0.5)
         + (vnoise2(awx0 * 0.23 - 7.1, awy0 * 0.23 + 19.4) - 0.5) * 0.45) * amp;
  }
  int ix = int(floor(fx)), iy = int(floor(fy));
  float fxr = fx - floor(fx), fyr = fy - floor(fy);

  vec4 s00 = lut0At(ix, iy),         s10 = lut0At(ix + 1, iy);
  vec4 s01 = lut0At(ix, iy + 1),     s11 = lut0At(ix + 1, iy + 1);
  vec4 m00 = lut1At(ix, iy),         m10 = lut1At(ix + 1, iy);
  vec4 m01 = lut1At(ix, iy + 1),     m11 = lut1At(ix + 1, iy + 1);

  float w00 = (1.0 - fxr) * (1.0 - fyr), w10 = fxr * (1.0 - fyr);
  float w01 = (1.0 - fxr) * fyr,         w11 = fxr * fyr;
  float cxr = seamF(fxr), cyr = seamF(fyr);
  float c00 = (1.0 - cxr) * (1.0 - cyr), c10 = cxr * (1.0 - cyr);
  float c01 = (1.0 - cxr) * cyr,         c11 = cxr * cyr;

  vec3 base = s00.rgb * c00 + s10.rgb * c10 + s01.rgb * c01 + s11.rgb * c11;
  float waterW = s00.a * w00 + s10.a * w10 + s01.a * w01 + s11.a * w11;
  float grassW = m00.r * w00 + m10.r * w10 + m01.r * w01 + m11.r * w11;
  float shadeW = (m00.g * w00 + m10.g * w10 + m01.g * w01 + m11.g * w11) * 2.0;
  float pavedW = m00.b * w00 + m10.b * w10 + m01.b * w01 + m11.b * w11;

  // Past the window edge all four taps above are the same clamped boundary tile. Replace what the
  // ground LOOKS like with the synthesis, keeping the waterness the clamp gave us — see farGround.
  // Grass and tarmac fade out with it: a park or an apron at the window edge used to smear its own
  // colour to the horizon, and out here the ground is wildlands. (The one man-made thing that does
  // run on is the highway, and it is put back below.)
  //
  // 'lit' is the raster's own litX/litY, spelled out rather than sent: a fixed north-west key after
  // dark, the sun by day.
  vec2 lit = uSunElev > 0.05 ? uSunDir : vec2(-0.62, -0.62);
  float dbgRoad = 0.0;
  // How much of this texel is far SEA — hoisted because the aerial perspective at the bottom of the
  // shader needs it. See the note there.
  float farSea = 0.0;
  if (fOut > 0.0) {
    float k = clamp(fOut / FAR_FADE, 0.0, 1.0);
    // ⚠ THE SYNTHESIS IS DRY LAND, SO IT MAY ONLY REPLACE DRY LAND. 'farGround' is dirt-to-rust
    // wildlands with a carved hillshade on it, and it was being laid over EVERY far texel — the
    // waterness the clamp hands out was kept, so the sea's waves, glint, foam and moon path all
    // still ran, on top of a base colour that was now desert. The bay therefore turned to rust
    // about 26 tiles past the window and stayed rust to the horizon: from over the water, open
    // sea that becomes open desert while you are flying across it.
    //
    // 'farShade' already says in its own comment that "whether it is SEA out there is the boundary
    // tile's answer rather than this function's" — this is that sentence applied to the two terms
    // that were not honouring it.
    //
    // ⚠ AND THE COAST IT UNCOVERS HAS TO BE SOFTENED TO ONE BOUNDARY TILE, OR IT IS A SAWTOOTH.
    // Out here the land/sea answer is only known PER BOUNDARY TILE and is then smeared radially, so
    // its angular resolution is frozen at one tile seen from 36 out while a far pixel's keeps
    // shrinking: the edge between them ends up arbitrarily sharp relative to everything around it,
    // and it draws as a ruled line with a regular row of triangular teeth running to the horizon —
    // one tooth per boundary tile. Both terms below are that softening, and the widest honest one
    // is exactly one tile, which is all the classification actually resolves:
    //
    //   · 'seamF' sharpens the colour blend to a narrow band at the tile seam, which is right
    //     inside the window (a tile of terrain should read as a crisp tile) and is what makes the
    //     teeth hard out here. Past the edge the plain bilinear weights are faded back in, so the
    //     colour ramps across the whole tile instead of snapping inside it.
    //   · 'wet' ramps over the FULL 0..1 of waterness for the same reason. Matching 'dryW' below
    //     (which saturates at 0.25) would be four times sharper than the data underneath it.
    //
    // The coastline is still the window edge's answer extended radially — that is what the note
    // above 'farGround' means by the land/sea decision being the window's — but it now meanders,
    // because the wobble 'fillOffMap' ragged-izes its own coast with is carried along with it.
    //
    // ⚠ THE RASTER SPELLS THAT WOBBLE 'hnoise2' AND NOT 'vnoise2', WHICH IS NOT A TYPO AT EITHER
    // END. This shader's 'vnoise2' hashes through 'vn2h', the integer mix; windshield.js has TWO
    // lattice noises and its 'vnoise2' is the SINE one, so the matching name is the wrong function
    // and 'hnoise2' is the right one. Write it the obvious way and the two floors draw two
    // different coastlines — the one thing they may not do — while the raster also pays four
    // 'Math.sin' per call for it.
    vec3 baseSmooth = s00.rgb * w00 + s10.rgb * w10 + s01.rgb * w01 + s11.rgb * w11;
    base = mix(base, baseSmooth, k);
    float wet = smoothstep(0.0, 1.0, waterW);
    float kl = k * (1.0 - wet);
    farSea = k * wet;
    vec4 far = farGround(wpx + uWc.x, wpy + uWc.y, lit);
    base = mix(base, far.rgb, kl);
    shadeW = mix(shadeW, far.a, kl);
    grassW *= 1.0 - k;
    pavedW *= 1.0 - k;
    // Half the ground footprint of this pixel, in tiles. A screen row IS a depth here, so the
    // vertical span is d*d / (EH * depth) and the lateral one is the ray spread; the road takes
    // whichever is coarser, because that is the axis it can dissolve along.
    float fp = 0.5 * max(d * d / max(uEH * uDepth, 1e-4), d * uLAT / max(uHalfW, 1.0));
    float rc = roadCoverage(vec2(wx, wy), fp) * k;
    dbgRoad = rc;
    if (rc > 0.001) {
      base = mix(base, uRoadCol, rc);
      // A graded road is cut flat through whatever it crosses, so it does not take the hillside
      // shading of the ground either side of it.
      shadeW = mix(shadeW, 1.0, rc);
      // ⚠ AND IT IS PAVED, WHICH IS THE ONLY THING THAT STOPS THE DESERT EATING IT AGAIN. Every
      // arid term below reads dryW, and dryW is 1 wherever there is no water, no grass and no
      // tarmac — so without this the far road gets wind-blown sand laid across it AND the
      // aerial-perspective wash that fades an open plain into the horizon, both of which pull it
      // straight back to the colour of the ground it is meant to stand out from. Measured, that
      // was the difference between a road you can see and a 6/255 tint you cannot: it is the same
      // mistake, in the same term, that the long note in windshield.js records the near road
      // having shipped with for months.
      pavedW = mix(pavedW, 1.0, rc);
    }
  }
  // Bare dry land: 1 over open desert, 0 over water, turf or tarmac. Asphalt has no water and no
  // grass, so without the paved term every road in the game reads as the driest ground there is
  // and gets sand blown across it — the long note on this is in windshield.js.
  float dryW = clamp(1.0 - waterW * 4.0, 0.0, 1.0) * (1.0 - grassW) * (1.0 - pavedW);

  // Base material: a whisper of concrete variation plus a within-tile diagonal gradient. Kept low
  // on purpose — stronger and flat asphalt pulses like a chessboard as you fly over it.
  float wxf = wx * uFreq, wyf = wy * uFreq;
  // ⚠ INTEGER XOR, NOT A FLOAT APPROXIMATION OF IT. The raster hashes these with (a ^ b) & 3
  // on 32-bit ints; mod() and abs() do not reproduce that for negative coordinates, and half the
  // world has negative coordinates. GLSL ES 3.00 has the same operators on the same width, so the
  // shader can run the identical expression rather than something that looks similar.
  int tx = int(floor(wxf * 2.0)), ty = int(floor(wyf * 2.0));
  float grad = ((wxf - floor(wxf)) + (wyf - floor(wyf))) * 0.03 - 0.03;
  float chk = ((tx + ty) & 1) != 0 ? 0.022 : -0.022;
  float spk = (((tx * 5) ^ (ty * 3)) & 3) == 0 ? 0.018 : 0.0;
  float tex = 1.0 + (chk + spk + grad) * detail;

  if (grassW > 0.002) {
    int gx = int(floor(wx * 5.3)), gy = int(floor(wy * 5.3));
    float g = float(((gx * 7) ^ (gy * 13)) & 3) * 0.05 - 0.075;
    tex = tex * (1.0 - grassW) + (1.0 + g * detail) * grassW;
  }

  // Relief hillshade on land only — water is flat and carries its own wave shading below.
  tex *= shadeW * (1.0 - waterW) + waterW;

  // Arid ground: wind-blown sand ripple over broad cracked-clay patches, so the dry wildlands read
  // as textured desert rather than a flat tinted plate. Near and mid field only, like the water
  // mottle, so the far plain stays flat instead of aliasing into a checker.
  if (dryW > 0.02 && detail > 0.3) {
    float rip = sin(wx * 2.4 + wy * 0.8) + 0.6 * sin(wx * 0.9 - wy * 1.7);
    float clay = vnoise2(wx * 0.85 + 5.0, wy * 0.85 - 3.0) - 0.5;
    tex *= 1.0 + (rip * 0.025 + clay * 0.11) * dryW * detail;
  }

  // ── WATER AND SHORELINE ────────────────────────────────────────────────────
  // waterW rises 0 to 1 across the shore seam, so it doubles as a shoreline coordinate and ~0.5 is
  // the waterline. Everything below is placed against that number rather than against a distance,
  // which is what lets one expression serve a beach, a harbour wall and the open sea.
  float cr = 0.0, foam = 0.0, gln = 0.0, moon = 0.0, cap = 0.0;
  // The lit sea's own specular, declared out here with the rest so it reaches the composite below.
  float spc = 0.0;
  if (waterW > 0.002) {
    // Sky sheen: a grazing sea mirrors the horizon, a steep one keeps its body colour.
    float sheen = fres * 0.5 * waterW;
    base = base * (1.0 - sheen) + uHor * sheen;
    // A slow coherent swell — three crossing sine trains, phase-modulated by one shared
    // low-frequency sine so the crests wander instead of forming a corrugated diamond lattice. The
    // raster does it this way to avoid two noise lookups per water texel; kept identical here,
    // because a renderer that de-lattices differently disagrees about where every crest is.
    // ⚠ THE SWELL ITSELF LIVES IN gl/sea-glsl.js NOW, because water.js displaces the same surface
    // this shades and a mesh standing a few centimetres off the sea being painted under it is a
    // seam. One string, included by both, is the only arrangement in which they cannot disagree.
    // ⚠ THE SHORE NORMAL IS FREE HERE: the four corners of this tile have already been fetched for
    // the bilinear blend above, so the gradient of waterness across the cell costs two subtractions
    // rather than four more texel reads.
    vec2 gW = vec2((s10.a + s11.a) - (s00.a + s01.a), (s01.a + s11.a) - (s00.a + s10.a)) * 0.5;
    vec2 sw = seaShoal(vec2(wx, wy), waterW, gW, uShoal);
    float swx = sw.x, swy = sw.y;
    float ph = seaPh(vec2(swx, swy), uT);
    float wv = seaChop(vec2(swx, swy), uT, ph);
    // ── THE LIT SURFACE ──────────────────────────────────────────────────────────────────────
    //
    // ⚠ THIS IS THE GLSL TWIN OF client/shared/sea-swell.js. A shader cannot import, so the
    // coefficients are stated in two places and 'scripts/shapes/sea.mjs' reads them out of both
    // and fails when they drift — the same arrangement 'landform.js' has with the relief noise and
    // 'coastwarp.mjs' guards for the coast.
    //
    // Water is the one surface in this renderer with no normal and no lighting at all: the
    // hillshade is bypassed above and 'wv' is spent as a brightness multiplier, which is a tint
    // rather than a surface. Every train here is a sine of an argument linear in swx/swy plus one
    // shared 'ph', so the chain rule closes and a true normal costs four more cosines and NO
    // texture taps. That is the only reason lighting the sea is affordable.
    //
    // ⚠ AND THE THREE TRAINS ARE CHOP, NOT SWELL. Their wavelengths are 1.09, 1.20 and 0.60 tiles
    // — wind waves, four to eight metres. Lighting them alone gives a sparkling sea and not a
    // rolling one, so 'uSeaRoll' adds one long 8.6-tile train whose amplitude is the sea state.
    float rollA = uSeaRoll * waterW;
    float lit = wv * 0.15;   // the shipped tint, kept verbatim as the uSeaLit 0 case
    if (uSeaLit > 0.001 && detail > 0.3) {
      // The slope comes from gl/sea-glsl.js, which water.js includes too — so the surface this
      // shades and the mesh that displaces it cannot disagree about where a crest is.
      vec2 dd = seaSlope(vec2(swx, swy), uT, ph, uSeaAmp, rollA, uSeaWind * waterW, uSpread);
      float du = dd.x, dv = dd.y;
      vec3 N = normalize(vec3(-du, -dv, 1.0));
      // The eye, in world tiles. 'l' is the lateral offset the projection already recovered above,
      // so the view ray is exact and costs no new uniform.
      vec3 Vw = normalize(vec3(-(d * uSinh + l * uCosh), d * uCosh - l * uSinh, uEH));
      // ⚠ sun.elev IS sin(elevation) and sun.dir a unit bearing (windshield.js), so the 3-D light
      // vector is free and exact — there is no third sun uniform to add and keep in step.
      float se = max(uSunElev, 0.0), me = max(uMoonElev, 0.0);
      float upS = step(0.02, se), upM = step(0.02, me) * clamp(uNight, 0.0, 1.0);
      vec3 L  = vec3(uSunDir  * sqrt(max(0.0, 1.0 - se * se)), se);
      vec3 Lm = vec3(uMoonDir * sqrt(max(0.0, 1.0 - me * me)), me);
      // ⚠ THE LOBE IS AS WIDE AS THE SEA IS ROUGH, AND THAT IS NOT A TUNING CHOICE. A near-level
      // eye can only mirror light arriving within about twice the steepest facet of the mirror
      // direction, so a tight lobe on a flat sea reflects the horizon and nothing else — a sun 60
      // degrees up then puts literally NOTHING on the water, which is what this shipped as. The
      // exponent is derived from the slope the amplitude actually produces (2/tan^2 of the steepest
      // facet), so roughening the sea widens its glitter path by arithmetic rather than by anybody
      // remembering to move a second number.
      float mxs = max(0.02, uSeaAmp * 5.9);
      float shin = clamp(2.0 / (mxs * mxs), 4.0, 400.0);
      float sunS = upS * pow(max(0.0, dot(N, normalize(L  + Vw))), shin) * (0.35 + 0.65 * se);
      // ⚠ THE MOON GETS THE SAME LOBE, or the term measures as no change for half the day and
      // reads exactly like a dead flag. Broader and far weaker: it is the night's only light here.
      float mnS = upM * pow(max(0.0, dot(N, normalize(Lm + Vw))), shin * 0.5) * 0.45;
      spc = (sunS + mnS) * waterW * uSeaLit;
      // ⚠ THE DIFFUSE COMES FROM WHICHEVER LIGHT IS UP, AND FROM NEITHER IN TRUE DARK. With the
      // sun below the horizon its vector goes flat, every facet reads dot ~= 0, and the term
      // collapses to a CONSTANT -0.15 — which is not shading at all, it is the whole sea uniformly
      // darker with no crests in it. Measured: 0% of a night frame moved, and every pixel that did
      // moved by the same amount.
      // ⚠ AND IT IS MEASURED AGAINST THE FLAT SEA, NOT AGAINST A CONSTANT. A flat surface gets
      // dot(up, L), which IS the light's elevation sine — so (lam - elev) is exactly how much this
      // FACET deviates from flat, and the term is zero-mean by construction at every hour. Written
      // against a literal 0.5 instead it carries the sun's height as a brightness offset: at a low
      // sun every facet reads dark, the whole sea drops about 9%, and what should have been crest
      // shading came out as the sea simply being darker in the evening.
      float flatL = upS > 0.5 ? se : me;
      float lam = upS > 0.5 ? dot(N, L) : dot(N, Lm);
      float key = max(upS, upM * 0.6);
      lit = mix(lit, (lam - flatL) * 0.45, uSeaLit * key);
    }
    tex = tex * (1.0 - waterW) + (1.0 + lit * detail) * waterW;
    float deep = clamp((waterW - 0.5) * 2.0, 0.0, 1.0);
    tex *= 1.0 - deep * 0.18;   // shallows near the line stay lighter; open water sits darker
    if (detail > 0.35) {
      float mott = vnoise2(swx * 0.55 + 11.0, swy * 0.55 - 7.0) - 0.5;
      tex *= 1.0 + mott * 0.12 * detail * deep;   // wind lanes, so open water is not one flat blue
    }
    // Scatter the breaking crests. Foaming every crest above a threshold lands the whitecaps on
    // the swell's own regular spacing, which is a grid of bright dots; a noise mask breaks some
    // and not others, which is what real water does.
    float foamMask = wv > 0.75 ? clamp(vnoise2(swx * 1.15 + 20.0, swy * 1.15 - 6.0) * 1.7 - 0.4, 0.0, 1.0) : 0.0;
    if (wv > 0.78) cr = (wv - 0.78) * 5.0 * waterW * foamMask;
    if (wv > 0.90) cap = (wv - 0.90) * 9.0 * waterW * foamMask;
    // Sun glitter: a broken specular path toward the real bearing of the sun, chopped by the swell
    // into a trail of gold flecks. Anchored on the sun, never on the drift.
    if (uSunElev > 0.05) {
      float along = ((wx - uA.x) * uSunDir.x + (wy - uA.y) * uSunDir.y) / max(0.6, d);
      if (along > 0.12) gln = clamp((along - 0.12) * 1.7, 0.0, 1.0) * (0.58 + 0.42 * max(0.0, wv)) * (0.4 + 0.6 * uSunElev) * waterW;
    }
    // Moonlight: the night twin of the glitter, and added after the night dim rather than through
    // it, because it IS the night's light.
    if (uMoonElev > 0.05 && uNight > 0.3) {
      float path = 0.0;
      float alongM = ((wx - uA.x) * uMoonDir.x + (wy - uA.y) * uMoonDir.y) / max(0.6, d);
      if (alongM > 0.1) path = clamp((alongM - 0.1) * 1.4, 0.0, 1.0) * (0.4 + 0.6 * max(0.0, wv));
      moon = uNight * uMoonElev * waterW * (0.12 + 0.24 * max(0.0, wv) + 0.95 * path);
    }
    // Surf: a bright band just on the water side of the line, pulsing with the swell and breaking
    // unevenly along the coast.
    float band = clamp(1.0 - abs(waterW - 0.56) / 0.16, 0.0, 1.0);
    if (band > 0.0) foam = band * band * (0.55 + 0.45 * sin(uT * 1.6 + (wx + wy) * 2.7 + wv * 1.5));
  }
  // Wet sand where the wash reaches, then a sunlit bank lip over a contact shadow in the shallows.
  // With no vertical displacement on a flat floor the coast lies flush with the sea and reads as a
  // pancake; the lip-over-shadow pair is what stands the land up out of the water.
  if (waterW > 0.14 && waterW < 0.5) tex *= 1.0 - clamp(1.0 - abs(waterW - 0.32) / 0.18, 0.0, 1.0) * 0.14;
  if (waterW > 0.38 && waterW < 0.5) tex *= 1.0 + clamp(1.0 - abs(waterW - 0.44) / 0.06, 0.0, 1.0) * 0.11;
  if (waterW >= 0.5 && waterW < 0.60) tex *= 1.0 - clamp(1.0 - abs(waterW - 0.53) / 0.05, 0.0, 1.0) * 0.17;

  // Near-camera grain. Forward resolution collapses as d approaches the eye height — the classic
  // Mode-7 near smear — so the closest rows sample a razor-thin slice of world, the mid-field
  // texture barely varies across them, and the foreground flattens into one dark colour that reads
  // as a hole in the floor. A finer grain whose strength rises as the ground nears carries real
  // world-space texture down to the bottom edge. On a cab frame this is most of the picture.
  float nearK = clamp((0.55 - d) / 0.55, 0.0, 1.0);
  if (nearK > 0.01) {
    if (waterW > 0.002) {
      float nwx = wx, nwy = wy;
      float nph = sin(nwx * 2.3 - nwy * 1.7 + uT * 0.4);
      float wv2 = 0.5 * sin(nwx * 22.0 + nwy * 15.0 - uT * 1.3 + nph * 0.9)
                + 0.5 * sin((nwx + nwy) * 17.0 + uT * 1.0 + nph * 0.7);
      tex *= 1.0 + (0.06 + wv2 * 0.11) * nearK * waterW;
      if (wv2 > 0.7) cr = max(cr, (wv2 - 0.7) * 2.6 * nearK * waterW);
      if (wv2 > 0.86) cap = max(cap, (wv2 - 0.86) * 6.0 * nearK * waterW);
    } else {
      int gnx = int(floor(wx * 14.7)), gny = int(floor(wy * 14.7));
      tex *= 1.0 + (float(((gnx * 7) ^ (gny * 13)) & 3) * 0.045 - 0.065) * nearK;
    }
  }

  // Rotor downwash — a heli low over water beats a matted crater into the surface, ringed with
  // spray, with ripples running outward at a rate that follows the rotor's own rpm.
  if (uHeliDown > 0.002 && waterW > 0.002) {
    float rdx = wx - uDC.x, rdy = wy - uDC.y, rr = sqrt(rdx * rdx + rdy * rdy);
    if (rr < 1.8) {
      float dwv = uHeliDown * clamp(1.0 - rr / 1.8, 0.0, 1.0) * waterW;
      float ring = sin(rr * 9.0 - uT * (3.0 + 7.0 * uRotor));
      float core = exp(-rr * rr / 0.25);
      float rim = exp(-((rr - 0.55) * (rr - 0.55)) / 0.18);
      tex *= 1.0 + (ring * 0.09 - core * 0.1) * dwv * detail;
      foam = max(foam, rim * 0.9 * dwv);
      cap = max(cap, rim * (0.3 + 0.4 * max(0.0, ring)) * dwv);
    }
  }

  // ── SNOW, LYING ON ALL OF IT ───────────────────────────────────────────────────────────────
  //
  // Last of the material terms and after every one of them, because that is what snow IS: a layer
  // on top of whatever was there. Putting it earlier would have the arid ripple and the grass grain
  // modulating the snow instead of being buried by it.
  //
  // ⚠ IT BURIES THE MATERIAL AND KEEPS THE LANDFORM, which is one line and is the whole difference
  // between snow and a white tint. 'tex' at this point is the material multiplier with the
  // hillshade already folded into it, so mixing it toward 1.0 — the obvious way to write "cover it
  // up" — deletes the relief along with the texture and hands back a flat white sheet with no shape
  // in it at all. Mixed toward 'shadeW' instead, the cracked clay, the wind ripple, the concrete
  // mottle and the turf grain all go under, and the hills stay: on a real snowfield the shading IS
  // the only thing you can see.
  //
  // ⚠ AND IT DOES NOT LIE ON OPEN WATER. It melts. It does gather right up to the waterline, which
  // is why this is a ramp across the shore seam rather than a test — 'waterW' doubles as a shoreline
  // coordinate (see the block above), so the same number that places the surf places the snow's edge
  // and the two cannot disagree about where the water starts.
  //
  // ⚠ AND THE COVER IS A LEVEL AGAINST A DRIFT FIELD, NOT AN OPACITY. Faded in as a flat alpha,
  // early snow is a grey wash over the whole map; what actually happens is that the first of it
  // catches in the lee and the hollows and the exposed ground stays bare, and then the patches
  // spread and join. That is the identical question the puddle field answers one shader along — a
  // substance finding the low ground as its quantity rises — so it is the identical shape of
  // answer, and deliberately so.
  float snowW = 0.0;
  if (uSnow > 0.001) {
    float land = 1.0 - clamp((waterW - 0.30) / 0.22, 0.0, 1.0);
    // Two octaves: a broad one that decides which side of a rise is bare, and a finer one that
    // gives the edge of a patch its ragged shoreline. ⚠ The fine octave is faded with 'detail' like
    // every other high-frequency term in this shader — left in at range it aliases into the same
    // checkerboard the arid ripple is guarded against.
    float drift = vnoise2(wx * 0.55 + 31.0, wy * 0.55 - 17.0)
                + (vnoise2(wx * 2.1 - 8.0, wy * 2.1 + 5.0) - 0.5) * 0.45 * detail;
    // ⚠ THE LEVEL RUNS PAST BOTH ENDS OF THE FIELD ON PURPOSE. 'drift' spans about 0..1, so a top
    // of 1.05 means a dusting covers genuinely nothing on the exposed ground, and a floor of -0.06
    // means a full fall leaves no bare patches at all. Stopping at 0 and 1 would make the first
    // flake and the last one both visible as a step.
    float level = mix(1.05, -0.06, uSnow);
    // Screen-widened, exactly as the puddle shoreline is and for the same reason: a hard threshold
    // on a world-space field crawls as the camera moves.
    float band = max(0.06, fwidth(drift) * 1.6);
    snowW = smoothstep(level, level + band, drift) * land;
    // ⚠ AND THE WHEELS CUT IT BACK. Here rather than at the colour, because everything below
    // reads snowW — the material burial, the dry sparkle, the surf and crest suppression — and
    // a track is an ABSENCE of cover rather than a mark painted on top of one.
    //
    // ⚠ AND IT CUTS ALL THE WAY. At 0.88 an eighth of the cover stayed in the rut, which reads as a
    // grey smear rather than as bare ground — and cutting it HERE is what makes the difference: at
    // zero the terrain comes back with its own colour and its own material, rather than with a
    // paler snow painted over the top of it.
    if (uNTrack > 1) {
      // Half this pixel's ground footprint, the same figure the far road dissolves against.
      float tfp = 0.5 * max(d * d / max(uEH * uDepth, 1e-4), d * uLAT / max(uHalfW, 1.0));
      snowW *= 1.0 - trackCut(vec2(wx, wy), tfp);
    }
  }
  if (snowW > 0.001) {
    // ⚠ SNOW IS NOT WHITE, IT IS THE SKY. It is a near-perfect diffuse reflector of the whole
    // hemisphere above it, so what it hands back is what is up there — blue at noon, and the reason
    // a snowy dusk goes pink. 'uHor' is the horizon colour this shader already mixes its haze
    // toward, so the tint comes from the frame's own sky rather than from a constant somebody would
    // have to retune every time the palette moved.
    //
    // ⚠ AND THE NIGHT DIM BELOW IS LEFT TO DO ITS WORK. Snow at night is the brightest thing in the
    // frame and the temptation is to protect it from 'uNm'; it does not need protecting, because
    // 0.93 through a 0.58 dim is still three times the ground beside it. Exempting it would make a
    // snowfield glow in the dark.
    vec3 snowCol = mix(vec3(0.93, 0.95, 0.99), uHor, 0.22);
    base = mix(base, snowCol, snowW);
    tex = mix(tex, shadeW, snowW);
    // A fine dry sparkle, near field only — the one thing that stops a big even area of snow
    // reading as paper. Same grain frequency the near-camera term uses, because it is the same
    // problem: a flat surface with no world-space texture in it flattens into a hole.
    if (nearK > 0.01) {
      int sx0 = int(floor(wx * 19.0)), sy0 = int(floor(wy * 19.0));
      tex *= 1.0 + (vn2h(sx0, sy0) > 0.93 ? 0.16 : 0.0) * nearK * snowW;
    }
    // Snow smothers the shoreline surf and the wet-sand band under it: both are specular adds that
    // belong to a wet beach, and a beach under snow is not one.
    foam *= 1.0 - snowW; cr *= 1.0 - snowW;
  }

  // The bright specular spikes fade out with distance too, exactly as the material does.
  cr *= detail; foam *= detail; gln *= detail; moon *= detail; cap *= detail;
  // ⚠ AND SO DOES THE LIT SEA'S LOBE, on the SAME ramp. The swell's amplitude is already faded by
  // 'detail', so a highlight that outlived it would sparkle on a horizon that has gone flat.
  spc *= detail;

  float haze = clamp(1.0 - p * uHz, 0.0, uHazeMax);
  float ih = 1.0 - haze;
  // The raster composes in 0-255 and this works in 0-1, so every constant below is its own over 255.
  // The lit sea's lobe rides in the same composite as the rest of the water's specular adds, in
  // sunlight's own colour rather than white, so a low sun lays a warm path and a high one a pale
  // one without a second table to keep in step.
  vec3 spec = vec3(cr * 55.0 + foam * 150.0 + gln * 150.0 + spc * 235.0,
                   cr * 70.0 + foam * 165.0 + gln * 132.0 + spc * 230.0,
                   cr * 90.0 + foam * 175.0 + gln * 66.0 + spc * 205.0) / 255.0;
  float capAdd = cap * 205.0 * ih * (0.45 + 0.55 * uNm) / 255.0;
  vec3 mAdd = moon * ih * vec3(120.0, 140.0, 185.0) / 255.0;
  vec3 col = ((base * tex + spec) * ih + uHor * haze) * uNm
           + mAdd + capAdd * vec3(1.0, 1.0, 1.06);

  // Aerial perspective for the arid wildlands. Clear-weather haze is deliberately light, so a dry
  // plain would otherwise keep near-full saturation up to a high horizon and read as a looming
  // wall. Only bare dry land washes out: water has its own glint and turf has its own colour.
  //
  // ⚠ AND THE OPEN SEA PAST THE WINDOW WASHES OUT WITH IT, WHICH THE GATE ABOVE WOULD NOT DO. That
  // exemption is a NEAR-FIELD argument — glint and swell carry water, so washing it would flatten
  // them — and it does not survive to 60 tiles, where there is no swell left to read. It cost
  // nothing while the far field was desert everywhere, because there was no far sea for it to
  // exempt; the moment the bay ran on to the horizon it became the one visible term that treats the
  // two sides of a coastline differently, and a plain washed 60% toward the sky meeting an unwashed
  // sea IS the hard bright line down the middle of that picture. 'farSea' is zero inside the window,
  // so the bay off the end of a pier is exactly the water it has always been.
  float washW = max(dryW, farSea);
  if (washW > 0.02) {
    float lh = washW * clamp((d - 10.0) / 44.0, 0.0, 1.0) * 0.6;
    col = col * (1.0 - lh) + uHor * uNm * lh;
  }
  // ── THE REFLECTIONS, BEFORE THE FOG ────────────────────────────────────────────────────────
  //
  // A reflection is part of the SURFACE, so it has to recede with it — put this after the fog and a
  // neon streak stays crisp on ground that has already dissolved into the horizon.
  //
  // ⚠ IT IS A SMEAR TOWARD THE VIEWER, NOT A MIRRORED IMAGE. A mirror reflection would be a second
  // copy of the light below the horizon, which is what a still puddle does; wet tarmac is a rough
  // surface, so what you actually see is the light drawn out along the line between its own ground
  // point and your eye, narrow across and long toward you. Two Gaussians in that frame, which is
  // three dot products and no square roots per light.
  //
  // ⚠ AND IT IS GATED ON pavedW, WHICH THE SHADER ALREADY HAD. Neon on wet road is the picture;
  // neon on wet grass is a bug. Nothing new is authored to get that — the LUT has carried a paved
  // weight since it was written.
  if (uWet > 0.001 && pavedW > 0.02 && uNWet > 0) {
    vec2 here = vec2(wx, wy);
    vec3 wetAdd = vec3(0.0);
    for (int i = 0; i < MAX_WET; i++) {
      if (i >= uNWet) break;
      vec2 gp = uWetP[i].xy;
      vec2 toEye = uA - gp;
      float el = length(toEye);
      if (el < 0.001) continue;
      toEye /= el;
      vec2 rel = here - gp;
      // Along the eye direction the streak is long and scales with how high the light is — a sign
      // three storeys up throws further than a kerb lamp. Across it, it is tight.
      float along = dot(rel, toEye);
      float lat = dot(rel, vec2(-toEye.y, toEye.x));
      float len = max(0.35, uWetP[i].z * 1.9);
      // Behind the light (away from the eye) there is a short stub, not nothing: a rough surface
      // scatters both ways. A quarter of the length reads right and costs one more multiply.
      float a = along >= 0.0 ? along / len : along / (len * 0.25);
      float t = lat / max(0.08, uWetR[i] * 0.10);
      float amp = exp(-a * a) * exp(-t * t);
      // And it fades with how far the light is from the patch at all, on the same reach the wall
      // wash uses, so a light that is not lighting anything does not lie on the road either.
      float reach = clamp(1.0 - el / max(0.001, uWetR[i] * 2.2), 0.0, 1.0);
      wetAdd += uWetC[i] * (amp * reach * reach);
    }
    // ⚠ SCALED BY THE NIGHT AS WELL AS BY THE WET. Signage is drawn by day too, and a pink streak
    // down a road at noon is not a reflection, it is a decal.
    col += wetAdd * (uWet * pavedW * 1.35 * clamp(uNight, 0.0, 1.0));
  }

  // ── AND THE SAME THING ON THE WATER, WHICH IS A DIFFERENT CALCULATION ───────────────────────
  //
  // ⚠ NOT THE LOOP ABOVE WITH 'pavedW' SWAPPED FOR 'waterW'. That one is two hand-fitted Gaussians
  // in the eye frame with a length somebody chose, which is a reasonable model of a rough opaque
  // surface. Water has a measured answer: how long and how wide a glitter path is IS the slope
  // distribution of the surface, and that is a function of the wind the sea is already integrating.
  // So the shape is derived and only the strength is a number here.
  if (uNeonGain > 0.001 && uNeonN > 0 && waterW > 0.02 && uNight > 0.01) {
    float wdeep = clamp((waterW - 0.5) * 2.0, 0.0, 1.0);
    vec3 neon = vec3(0.0);
    for (int i = 0; i < NEON_MAX; i++) {
      if (i >= uNeonN) break;
      vec4 L = uNeonP[i];
      float g = seaGlitter(vec2(wx, wy), uA, max(0.02, uEH), L.xyz, uSeaWindDir, uSig2.x, uSig2.y);
      float dl = length(L.xy - vec2(wx, wy)) / max(0.001, L.w);
      neon += uNeonC[i] * (g / (1.0 + dl * dl));
    }
    // ⚠ WEIGHED ON 'wdeep' AND NOT ON 'waterW', the same term the mesh uses. waterW rises across the
    // shore seam and doubles as a shoreline coordinate, so weighing on it lays neon along the wet
    // sand and into the surf band — which is a beach glowing pink rather than a harbour.
    col += neon * (uNeonGain * wdeep * clamp(uNight, 0.0, 1.0));
  }

  // N64 distance fog, last and uniformly over every material, so the far field recedes into the
  // sky. A squared ramp: a crisp foreground thickening into the far.
  // ⚠ ONE MIX FOR BOTH, because they are two things the light has to get through and what
  // multiplies is what gets THROUGH — see gl/fog.js. Applied separately they sum past 1 in thick
  // weather and the far field becomes a flat plate of fog colour.
  float ffd = clamp((d - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  float fw = 1.0 - (1.0 - ffd * ffd * uFogAmt) * (1.0 - heightFog(uEH, 0.0, d, uFogH, uFogHScale));
  if (fw > 0.001) col = col * (1.0 - fw) + uFogCol * fw;

  // ⚠ A SCREEN-FILLING TRIANGLE HAS ONE DEPTH, AND THE GROUND HAS A THOUSAND. Left alone this
  // would write a single constant z and the city would be entirely in front of the floor or
  // entirely behind it. 'd' here IS the camera-space forward distance — substitute wz = 0 into
  // the projection and sy - horizonY = depth * EH / f, so f = EH / p = d — which is exactly what
  // projMatrix divides by. So the real depth is recoverable, and this is that same mapping.
  gl_FragDepth = clamp((uZA + uZB / max(d, 1e-4) + 1.0) * 0.5, 0.0, 1.0);
  if (uDebug == 1) { outColor = vec4(base, 1.0); return; }
  if (uDebug == 2) { outColor = vec4(vec3(tex * 0.5), 1.0); return; }
  if (uDebug == 3) { outColor = vec4(vec3(haze * 4.0), 1.0); return; }
  if (uDebug == 4) { outColor = vec4(vec3(shadeW * 0.5), 1.0); return; }
  // 6 - the far field, as a map rather than as a picture: red is how far outside the window this
  // pixel sampled, green is the far-road coverage. The only way to tell "the branch never ran"
  // from "it ran and painted nothing", which are the same black screen in the finished frame.
  if (uDebug == 6) { outColor = vec4(clamp(fOut / 60.0, 0.0, 1.0), dbgRoad, 0.0, 1.0); return; }
  // 5 — a disc at each light's own ground point, in THIS shader's frame. The only honest way to
  // settle the frame conversion: if the discs do not sit under the lights, the conversion is wrong,
  // and every other symptom of that is a reflection sitting beside its sign, which reads as art.
  if (uDebug == 5) {
    vec3 mark = vec3(0.04);
    for (int i = 0; i < MAX_WET; i++) {
      if (i >= uNWet) break;
      if (length(vec2(wx, wy) - uWetP[i].xy) < 0.18) mark = uWetC[i] * 4.0 + vec3(0.2);
    }
    outColor = vec4(clamp(mark, 0.0, 1.0), 1.0); return;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' floor shader: ' + log);
  }
  return sh;
}

// ⚠ THE SAME SIX AS THE SHADER'S `MAX_WET`, AND THEY HAVE TO AGREE. The GLSL one is inside a
// template literal and cannot be read from here, so this is the second copy — the shader would
// happily accept a longer array and silently ignore the tail, which is a reflection that is there
// on one machine and missing on another. Kept adjacent so a change to one is a visible diff on both.
const MAX_WET = 6;
// ⚠ THE SAME FORTY AS THE SHADER'S OWN MAX_TRACK, AND THEY HAVE TO AGREE — the rule MAX_WET
// above states for the same reason. The GLSL one is inside a template literal and cannot be read
// from here, so this is the second copy, kept adjacent so a change to one is a visible diff.
const MAX_TRACK_PTS = 40;
// ⚠ THE SAME SIX AS THE SHADER'S OWN 'NEON_MAX', the MAX_WET arrangement one block down.
const NEON_MAX = 6;
const NEON_P = new Float32Array(NEON_MAX * 4);
const NEON_C = new Float32Array(NEON_MAX * 3);
const EMPTY_NEON = [];
const WET_P = new Float32Array(MAX_WET * 3);
const WET_C = new Float32Array(MAX_WET * 3);
const WET_R = new Float32Array(MAX_WET);
const EMPTY_WET = [];
// Scratch for the far-road segment upload, allocated once: this is written every frame a road is
// in range, and a fresh Float32Array per frame is exactly the kind of garbage the LUT's own cache
// note exists to avoid.
const MAX_ROAD = 48;
const ROAD_SEG = new Float32Array(MAX_ROAD * 4);

export function createFloorLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('floor link: ' + gl.getProgramInfoLog(prog));

  const U = (n) => gl.getUniformLocation(prog, n);
  const loc = {
    EH: U('uEH'), horizonY: U('uHorizonY'), depth: U('uDepth'), cx: U('uCx'), halfW: U('uHalfW'),
    LAT: U('uLAT'), sinh: U('uSinh'), cosh: U('uCosh'), A: U('uA'), dpr: U('uDpr'), viewH: U('uViewH'),
    lut0: U('uLut0'), lut1: U('uLut1'), mh: U('uMh'), R: U('uR'),
    hor: U('uHor'), hz: U('uHz'), hazeMax: U('uHazeMax'), nm: U('uNm'),
    freq: U('uFreq'), cwarp: U('uCwarp'), wc: U('uWc'), seamEB: U('uSeamEB'),
    farDirt: U('uFarDirt'), farRock: U('uFarRock'), farOn: U('uFarOn'),
    nRoad: U('uNRoad'), roadSeg: U('uRoadSeg'), roadW: U('uRoadW'), roadCol: U('uRoadCol'),
    fogAmt: U('uFogAmt'), fogNear: U('uFogNear'), fogFar: U('uFogFar'), fogCol: U('uFogCol'),
    fogH: U('uFogH'), fogHScale: U('uFogHScale'),
    t: U('uT'), seaLit: U('uSeaLit'), seaRoll: U('uSeaRoll'), seaWind: U('uSeaWind'), seaAmp: U('uSeaAmp'), spread: U('uSpread'), shoal: U('uShoal'),
    sunDir: U('uSunDir'), sunElev: U('uSunElev'),
    moonDir: U('uMoonDir'), moonElev: U('uMoonElev'), night: U('uNight'),
    heliDown: U('uHeliDown'), rotor: U('uRotor'), dc: U('uDC'),
    zA: U('uZA'), zB: U('uZB'), debug: U('uDebug'),
    nWet: U('uNWet'), wetP: U('uWetP'), wetC: U('uWetC'), wetR: U('uWetR'), wet: U('uWet'),
    neonN: U('uNeonN'), neonP: U('uNeonP'), neonC: U('uNeonC'), neonGain: U('uNeonGain'),
    sig2: U('uSig2'), seaWindDir: U('uSeaWindDir'),
    snow: U('uSnow'),
    nTrack: U('uNTrack'), track: U('uTrack'), trackHalf: U('uTrackHalf'),
    trackW: U('uTrackW'), trackBox: U('uTrackBox'),
  };

  const vao = gl.createVertexArray();   // nothing bound: the triangle is synthesised from gl_VertexID
  let t0 = null, t1 = null, lutTag = null, lutN = 0;

  function tex(unit) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ⚠ RE-UPLOADED ONLY WHEN THE LUT CHANGES. groundLUT already caches on (map, window centre, sun,
  // sky) and hands back the same object when nothing moved, so the tag is that object's own
  // identity plus its size — no hashing, and no texture upload on a frame that is standing still.
  function setLut(n, a0, a1, tag) {
    if (tag != null && tag === lutTag && n === lutN) return;
    lutTag = tag; lutN = n;
    if (!t0) { t0 = tex(0); t1 = tex(1); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, a0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, a1);
  }

  function draw(s, near = NEAR) {
    if (!s || !s.lut0 || !s.n) return 0;
    gl.useProgram(prog);
    setLut(s.n, s.lut0, s.lut1, s.tag);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t0); gl.uniform1i(loc.lut0, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t1); gl.uniform1i(loc.lut1, 1);
    gl.uniform1f(loc.EH, s.EH); gl.uniform1f(loc.horizonY, s.horizonY); gl.uniform1f(loc.depth, s.depth);
    gl.uniform1f(loc.cx, s.cx); gl.uniform1f(loc.halfW, s.halfW); gl.uniform1f(loc.LAT, s.LAT);
    gl.uniform1f(loc.sinh, s.sinh); gl.uniform1f(loc.cosh, s.cosh);
    gl.uniform2f(loc.A, s.ax, s.ay);
    gl.uniform1f(loc.dpr, s.dpr || 1); gl.uniform1f(loc.viewH, s.viewH);
    gl.uniform1i(loc.mh, s.n); gl.uniform1f(loc.R, s.R);
    gl.uniform3f(loc.hor, s.hor[0], s.hor[1], s.hor[2]);
    gl.uniform1f(loc.hz, s.hz); gl.uniform1f(loc.hazeMax, s.hazeMax); gl.uniform1f(loc.nm, s.nm);
    gl.uniform1f(loc.freq, s.freq); gl.uniform1f(loc.cwarp, s.cwarp);
    gl.uniform2f(loc.wc, s.wcx, s.wcy); gl.uniform1f(loc.seamEB, s.seamEB);
    const fd = s.farDirt || [150, 112, 72], fr = s.farRock || [150, 82, 54];
    gl.uniform3f(loc.farDirt, fd[0] / 255, fd[1] / 255, fd[2] / 255);
    gl.uniform3f(loc.farRock, fr[0] / 255, fr[1] / 255, fr[2] / 255);
    gl.uniform1f(loc.farOn, s.farOn == null ? 1 : s.farOn);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES WITH NO ROAD — the same rule the wet-reflection
    // lights below follow. A uniform holds its last value, so a pass that only set these when it had
    // a road would leave the last highway painted across the desert after you flew off the end of it.
    const rs = s.roadSegs, nr = rs ? Math.min(MAX_ROAD, rs.length / 4) : 0;
    gl.uniform1i(loc.nRoad, nr);
    gl.uniform1f(loc.roadW, nr ? (s.roadW || 0) : 0);
    if (nr) {
      ROAD_SEG.set(rs.subarray ? rs.subarray(0, nr * 4) : rs.slice(0, nr * 4));
      gl.uniform4fv(loc.roadSeg, ROAD_SEG.subarray(0, nr * 4));
      const rc = s.roadCol || [111, 92, 56];
      gl.uniform3f(loc.roadCol, rc[0] / 255, rc[1] / 255, rc[2] / 255);
    }
    gl.uniform1f(loc.fogAmt, s.fogAmt || 0);
    gl.uniform1f(loc.fogH, s.fogH || 0);
    gl.uniform1f(loc.fogHScale, s.fogHScale > 0 ? s.fogHScale : 0.5);
    gl.uniform1f(loc.fogNear, s.fogNear == null ? 6 : s.fogNear);
    gl.uniform1f(loc.fogFar, s.fogFar == null ? 34 : s.fogFar);
    const fc = s.fogCol || [0, 0, 0];
    gl.uniform3f(loc.fogCol, fc[0], fc[1], fc[2]);
    gl.uniform1f(loc.t, s.t || 0);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES OVER DRY LAND — same rule as the road segments,
    // the snow and the wet lights below. A uniform holds its last value, so a sea state written
    // only when there is water in the window leaves the last gale on the sea for the session.
    gl.uniform1f(loc.seaLit, s.seaLit == null ? 0 : s.seaLit);
    gl.uniform1f(loc.seaRoll, s.seaRoll || 0);
    gl.uniform1f(loc.seaWind, s.seaWind || 0);
    gl.uniform1f(loc.seaAmp, s.seaAmp == null ? 0.02 : s.seaAmp);
    gl.uniform1f(loc.spread, s.seaSpread == null ? 0 : s.seaSpread);
    gl.uniform1f(loc.shoal, s.seaShoal == null ? 0 : s.seaShoal);
    const sd = s.sunDir || [0, 0], md = s.moonDir || [0, 0];
    gl.uniform2f(loc.sunDir, sd[0], sd[1]); gl.uniform1f(loc.sunElev, s.sunElev || 0);
    gl.uniform2f(loc.moonDir, md[0], md[1]); gl.uniform1f(loc.moonElev, s.moonElev || 0);
    gl.uniform1f(loc.night, s.night || 0);
    gl.uniform1f(loc.heliDown, s.heliDown || 0); gl.uniform1f(loc.rotor, s.rotor || 0);
    gl.uniform2f(loc.dc, s.dcx || 0, s.dcy || 0);
    gl.uniform1i(loc.debug, s.debug | 0);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES WITH NO SNOW — the rule the road segments and
    // the wet lights below both carry, and the one a new uniform is likeliest to be added without.
    // A uniform holds its last value, so a pass that only set this when it had snow would leave the
    // whole world white for the rest of the session after one blizzard thawed.
    gl.uniform1f(loc.snow, s.snow || 0);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES WITH NO TRACKS. A uniform holds its last value,
    // so a pass that set these only when it had a path would leave the last one carved into the
    // snow for the rest of the session — the rule the road segments and the wet lights carry.
    {
      const tk = s.tracks;
      const tn = tk && tk.pts ? Math.min(MAX_TRACK_PTS, tk.n | 0) : 0;
      gl.uniform1i(loc.nTrack, tn);
      if (tn > 1) {
        gl.uniform4fv(loc.track, tk.pts.subarray(0, tn * 4));
        gl.uniform1f(loc.trackHalf, tk.half); gl.uniform1f(loc.trackW, tk.w);
        gl.uniform4f(loc.trackBox, tk.box[0], tk.box[1], tk.box[2], tk.box[3]);
      }
    }
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES WITH NO REFLECTION. A uniform holds its last
    // value, so a pass that only set these when it had lights would leave yesterday's streaks on
    // the road after the signs went out — the same rule the sun strength above it follows.
    const wl = (s.wet > 0 ? s.wetLights : null) || EMPTY_WET;
    const nw = Math.min(MAX_WET, wl.length);
    gl.uniform1f(loc.wet, nw ? (s.wet || 0) : 0);
    gl.uniform1i(loc.nWet, nw);
    if (nw) {
      for (let i = 0; i < nw; i++) {
        const L = wl[i];
        WET_P[i * 3] = L.p[0]; WET_P[i * 3 + 1] = L.p[1]; WET_P[i * 3 + 2] = L.p[2];
        WET_C[i * 3] = L.rgb[0]; WET_C[i * 3 + 1] = L.rgb[1]; WET_C[i * 3 + 2] = L.rgb[2];
        WET_R[i] = L.r;
      }
      gl.uniform3fv(loc.wetP, WET_P.subarray(0, nw * 3));
      gl.uniform3fv(loc.wetC, WET_C.subarray(0, nw * 3));
      gl.uniform1fv(loc.wetR, WET_R.subarray(0, nw));
    }
    // ── THE LIGHTS ON THE WATER ───────────────────────────────────────────────────────────────
    //
    // ⚠ 'seaLights', NOT 'wetLights'. world.js nulls the wet list for the floor on purpose — every
    // surface that term is gated to is repainted opaquely by GROUND_FULL a moment later — and none
    // of that is true of water, which nothing repaints.
    const nl = (s.seaNeon > 0 ? s.seaLights : null) || EMPTY_NEON;
    const nn = Math.min(NEON_MAX, nl.length);
    for (let i = 0; i < nn; i++) {
      const L = nl[i];
      NEON_P[i * 4] = L.p[0]; NEON_P[i * 4 + 1] = L.p[1]; NEON_P[i * 4 + 2] = L.p[2]; NEON_P[i * 4 + 3] = L.r;
      // ⚠ 'rgbRaw', NEVER 'rgb' — see the same ⚠ in water.js and in ground.js. 'rgb' is the colour
      // as a WALL WASH, scaled by that term's gain and by the night, and it is flatly zero whenever
      // the wash is off: a reflection reading it measures 0.000% at every gain.
      const c = L.rgbRaw || L.rgb;
      NEON_C[i * 3] = c[0]; NEON_C[i * 3 + 1] = c[1]; NEON_C[i * 3 + 2] = c[2];
    }
    gl.uniform1i(loc.neonN, nn);
    if (nn > 0) { gl.uniform4fv(loc.neonP, NEON_P); gl.uniform3fv(loc.neonC, NEON_C); }
    gl.uniform1f(loc.neonGain, nn > 0 ? (s.seaNeon || 0) : 0);
    const sv = seaSlopeVariance(s.seaKt || 0);
    gl.uniform2f(loc.sig2, sv.u, sv.c);
    const swd = s.seaWindDir || [1, 0];
    gl.uniform2f(loc.seaWindDir, swd[0], swd[1]);

    const zr = zRow(near);
    gl.uniform1f(loc.zA, zr[0]);
    gl.uniform1f(loc.zB, zr[1]);
    // ⚠ THE FLOOR IS DRAWN AFTER THE MASS AND IT WRITES DEPTH. Everything else in this pass — the
    // road, the scatter, the shadows — stands ON it, so a surface behind a building has to lose to
    // it. See the ordering note in world.js for why it cannot simply be drawn first.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    return 1;
  }

  // ⚠ THE WATER MESH READS THE SAME LUT, RATHER THAN BEING HANDED A SECOND ONE. gl/water.js needs
  // waterness to know where the sea is and how far it has shoaled, and a second upload of the same
  // bytes is a second answer to 'where is the coast' that would drift the moment either changed.
  // It is exposed rather than passed because the floor owns the upload and the mesh draws after it.
  // ⚠ BOTH PLANES, because the water mesh needs the SHELTER in uLut1.a as well as the waterness in
  // uLut0.a — and a getter that hands over only the first is a mesh that samples shelter from the
  // tile COLOUR, which is a number between 0 and 1 that varies plausibly and is not shelter.
  return { draw, get lut() { return t0 ? { tex: t0, tex1: t1, mh: lutN } : null; } };
}
