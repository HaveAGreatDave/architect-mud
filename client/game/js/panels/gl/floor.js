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
uniform float uLAT;        // the lateral 1.15 the projection carries
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

// The N64 fog band, which is a SECOND distance term and not the haze above it: the haze is a
// per-row wash toward the horizon, and this is a squared ramp between two world distances that the
// BUILDING pass shares. Leaving it out made the far ground and the far towers dissolve at
// different rates, which reads as a skyline floating over the plain.
uniform float uFogAmt;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3  uFogCol;     // the horizon colour times the night dim, already resolved

// Water, and the weather over it.
uniform float uT;          // seconds
uniform vec2  uSS;         // sea scroll — the Helm chase holds position and streams the swell past
uniform vec2  uSunDir;
uniform float uSunElev;
uniform vec2  uMoonDir;
uniform float uMoonElev;
uniform float uNight;
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
  float cosI = uEH / sqrt(d * d + uEH * uEH);
  float fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);

  // Domain-warp the sampling position so a coast meanders off the tile grid — but never near
  // anything man-made, or a kerb wobbles. The phase reads ABSOLUTE world coords so the wave is
  // pinned to the world and does not snap a whole tile when the window recentres.
  float wpx = wx, wpy = wy;
  if (uCwarp > 0.001 && pavedAt(uR + wx, uR + wy) < 0.5) {
    float awx = wx + uWc.x, awy = wy + uWc.y;
    float nx = wx + uCwarp * sin(awy * 1.9 + awx * 0.5);
    float ny = wy + uCwarp * sin(awx * 1.9 - awy * 0.5 + 2.1);
    float jx = uR + nx, jy = uR + ny;
    if (pavedAt(jx, jy) < 0.5 && pavedAt(jx + 1.0, jy) < 0.5
     && pavedAt(jx, jy + 1.0) < 0.5 && pavedAt(jx + 1.0, jy + 1.0) < 0.5) { wpx = nx; wpy = ny; }
  }

  float fx = uR + wpx, fy = uR + wpy;
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
  if (waterW > 0.002) {
    // Sky sheen: a grazing sea mirrors the horizon, a steep one keeps its body colour.
    float sheen = fres * 0.5 * waterW;
    base = base * (1.0 - sheen) + uHor * sheen;
    // A slow coherent swell — three crossing sine trains, phase-modulated by one shared
    // low-frequency sine so the crests wander instead of forming a corrugated diamond lattice. The
    // raster does it this way to avoid two noise lookups per water texel; kept identical here,
    // because a renderer that de-lattices differently disagrees about where every crest is.
    float swx = wx + uSS.x, swy = wy + uSS.y;
    float ph = sin(swx * 0.6 - swy * 0.45 + uT * 0.25);
    float wv = 0.5 * sin(swx * 5.6 + swy * 1.3 + uT * 0.9 + ph * 1.6)
             + 0.4 * sin((swx - swy) * 3.7 - uT * 0.66 + ph * 1.1)
             + 0.11 * sin((swx + swy) * 7.4 + uT * 1.25 + ph * 0.7);
    tex = tex * (1.0 - waterW) + (1.0 + wv * 0.15 * detail) * waterW;
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
      float nwx = wx + uSS.x, nwy = wy + uSS.y;
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

  // The bright specular spikes fade out with distance too, exactly as the material does.
  cr *= detail; foam *= detail; gln *= detail; moon *= detail; cap *= detail;

  float haze = clamp(1.0 - p * uHz, 0.0, uHazeMax);
  float ih = 1.0 - haze;
  // The raster composes in 0-255 and this works in 0-1, so every constant below is its own over 255.
  vec3 spec = vec3(cr * 55.0 + foam * 150.0 + gln * 150.0,
                   cr * 70.0 + foam * 165.0 + gln * 132.0,
                   cr * 90.0 + foam * 175.0 + gln * 66.0) / 255.0;
  float capAdd = cap * 205.0 * ih * (0.45 + 0.55 * uNm) / 255.0;
  vec3 mAdd = moon * ih * vec3(120.0, 140.0, 185.0) / 255.0;
  vec3 col = ((base * tex + spec) * ih + uHor * haze) * uNm
           + mAdd + capAdd * vec3(1.0, 1.0, 1.06);

  // Aerial perspective for the arid wildlands. Clear-weather haze is deliberately light, so a dry
  // plain would otherwise keep near-full saturation up to a high horizon and read as a looming
  // wall. Only bare dry land washes out: water has its own glint and turf has its own colour.
  if (dryW > 0.02) {
    float lh = dryW * clamp((d - 10.0) / 44.0, 0.0, 1.0) * 0.6;
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

  // N64 distance fog, last and uniformly over every material, so the far field recedes into the
  // sky. A squared ramp: a crisp foreground thickening into the far.
  if (uFogAmt > 0.001) {
    float ff = clamp((d - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
    float fw = ff * ff * uFogAmt;
    col = col * (1.0 - fw) + uFogCol * fw;
  }

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
const WET_P = new Float32Array(MAX_WET * 3);
const WET_C = new Float32Array(MAX_WET * 3);
const WET_R = new Float32Array(MAX_WET);
const EMPTY_WET = [];

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
    fogAmt: U('uFogAmt'), fogNear: U('uFogNear'), fogFar: U('uFogFar'), fogCol: U('uFogCol'),
    t: U('uT'), ss: U('uSS'), sunDir: U('uSunDir'), sunElev: U('uSunElev'),
    moonDir: U('uMoonDir'), moonElev: U('uMoonElev'), night: U('uNight'),
    heliDown: U('uHeliDown'), rotor: U('uRotor'), dc: U('uDC'),
    zA: U('uZA'), zB: U('uZB'), debug: U('uDebug'),
    nWet: U('uNWet'), wetP: U('uWetP'), wetC: U('uWetC'), wetR: U('uWetR'), wet: U('uWet'),
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

  function draw(s) {
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
    gl.uniform1f(loc.fogAmt, s.fogAmt || 0);
    gl.uniform1f(loc.fogNear, s.fogNear == null ? 6 : s.fogNear);
    gl.uniform1f(loc.fogFar, s.fogFar == null ? 34 : s.fogFar);
    const fc = s.fogCol || [0, 0, 0];
    gl.uniform3f(loc.fogCol, fc[0], fc[1], fc[2]);
    gl.uniform1f(loc.t, s.t || 0);
    gl.uniform2f(loc.ss, s.ssx || 0, s.ssy || 0);
    const sd = s.sunDir || [0, 0], md = s.moonDir || [0, 0];
    gl.uniform2f(loc.sunDir, sd[0], sd[1]); gl.uniform1f(loc.sunElev, s.sunElev || 0);
    gl.uniform2f(loc.moonDir, md[0], md[1]); gl.uniform1f(loc.moonElev, s.moonElev || 0);
    gl.uniform1f(loc.night, s.night || 0);
    gl.uniform1f(loc.heliDown, s.heliDown || 0); gl.uniform1f(loc.rotor, s.rotor || 0);
    gl.uniform2f(loc.dc, s.dcx || 0, s.dcy || 0);
    gl.uniform1i(loc.debug, s.debug | 0);
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
    const near = 0.06, far = 400.0;
    gl.uniform1f(loc.zA, (far + near) / (far - near));
    gl.uniform1f(loc.zB, -2.0 * far * near / (far - near));
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

  return { draw };
}
