// THE SEA, AS ACTUAL GEOMETRY.
//
// Every other water in GLASS is paint on a flat plane. `floor.js` shades a screen-filling triangle
// whose world point is recovered by inverting the Mode-7 projection ASSUMING z = 0, so however
// good the crests, the glitter and the foam look, the surface they are drawn on has no relief at
// all: nothing occludes anything, the horizon is a ruled line, and a hull sits on a sheet of glass.
// Its own comment has said so since it was written — "with no vertical displacement on a flat floor
// the coast lies flush with the sea and reads as a pancake".
//
// ⚠ AND IT CANNOT BE FIXED WHERE IT IS. The obvious move is to offset the recovered world point
// along the view ray by the wave height and write a corrected `gl_FragDepth` — parallax mapping,
// which the floor is already set up for because it owns its own depth mapping. It diverges. The
// fixed point is `d <- d0 * (1 - H(A + d*dir) / EH)` and its contraction factor is
// `(d0 / EH) * |grad H|`; `uEH` is the eye height in TILES and a truck cab sits at 0.12, while `d`
// runs past 40. So the factor is 200-350 times a slope of ~0.1, which is 20 to 35: ONE iteration
// overshoots and two diverge. That is geometry, not tuning — at grazing incidence a two-centimetre
// crest moves the horizon-ward intersection by metres, which is why real oceans ray-march, and
// Mode-7 makes it worse than usual because everything past the near rows IS grazing.
//
// So the water gets vertices.
//
// ── WHAT IS DISPLACED, AND WHAT IS NOT ────────────────────────────────────────────────────────
//
// ⚠ THE MESH CARRIES THE ROLL AND THE FRAGMENT SHADER CARRIES THE CHOP, AND THE WHOLE COST OF THE
// FEATURE RESTS ON THAT SPLIT. The three trains GLASS has always drawn have wavelengths of 1.09,
// 1.20 and 0.60 tiles — wind chop, four to eight metres. Carrying a 0.6-tile wave in a vertex grid
// needs about eight vertices across it, so ~13 per tile, which over a 36-tile window is 470x470
// vertices and a quarter of a million triangles REBUILT AS THE CAMERA MOVES. The 8.6-tile roll
// needs three per tile. Sixty times cheaper, and it is also the honest split: chop is what a
// normal map is FOR, and a hull fitted to 1-tile chop is a hull fitted to noise.
//
// ── THE GRID IS STATIC, WHICH IS THE OTHER HALF OF THE COST ───────────────────────────────────
//
// ⚠ NOTHING IS REBUILT PER FRAME, EVER. The vertex buffer holds a unit grid in TILE OFFSETS from
// the camera's ground point, built once on first use; the camera's position, the clock and the sea
// state arrive as uniforms and the vertex shader does the rest. So the sea costs one draw call and
// zero uploads, where the mass buffer — which is rebuilt when the map window recentres — is the
// expensive thing in the frame this renderer already works hardest to avoid.
//
// ⚠ AND BECAUSE IT FOLLOWS THE CAMERA, THE PHASE MUST NOT. The wave is a function of the WORLD
// point, so a grid that slides under a moving camera has to sample the field at the world position
// each vertex lands on rather than at its own index — otherwise the sea travels with you, which
// reads as a conveyor belt — which is exactly why the old per-client `seaScroll` offset was removed.
//
// ── WHY IT IS ITS OWN LAYER AND NOT `solids.js` ───────────────────────────────────────────────
//
// That layer takes finished FLAT-SHADED polygons and does nothing to them but project — which is
// right for a truck, whose shading is already computed on the CPU, and useless here: flat-shading
// the sea per triangle throws away the foam, the glitter, the whitecaps, the surf band and the
// sheen, which is all the water anybody has ever seen in this game.
import { viewProjMatrix, mat4f, zRow, NEAR } from './camera.js';
import { SEA_GLSL } from './sea-glsl.js';
import { seaSlopeVariance, SEA_FOAM_LEAD, SEA_FOAM_RAMP, SEA_FOAM_A } from '../../../../shared/sea-swell.js';

// ⚠ THE SAME SIX AS THE SHADER'S OWN 'NEON_MAX', AND THEY HAVE TO AGREE — the GLSL one is inside a
// template literal and cannot read this, which is the arrangement floor.js's MAX_WET already has.
const NEON_MAX = 6;
const NEON_P = new Float32Array(NEON_MAX * 4);
const NEON_C = new Float32Array(NEON_MAX * 3);
const EMPTY_NEON = [];

// How far the displaced patch reaches, in tiles, and how many vertices per tile. 3/tile carries an
// 8.6-tile swell with ~26 vertices across a wavelength, which is smooth; past the rim the flat
// floor takes over and the two are crossfaded so there is no ring.
//
// ⚠ THE RIM FADE IS NOT DECORATION. Displaced sea meeting flat sea at full amplitude is a visible
// circular step the size of the patch, and it MOVES WITH YOU, which is worse than either surface.
// ⚠ THE DENSITY IS SET BY THE SHORTEST TRAIN IN THE MESH, NOT BY THE LONGEST. The 8.6-tile swell
// is smooth at 3 per tile; the 3.2-tile WIND SEA is not — at 3 it gets 9.6 vertices a wavelength
// and reads as faceted, which on a steep wave is the one artefact that looks like broken geometry
// rather than like weather. 5 gives it 16, and the reach comes in to pay for it: a wave you can
// see individually is a near-field thing anyway, and past the rim the flat floor carries the sea.
// ⚠ THE PATCH IS TWICE THE RADIUS AND A THIRD OF THE TRIANGLES, WHICH IS THE WHOLE REASON A BIGGER
// SEA IS AFFORDABLE. A uniform grid at this radius is 504 divisions a side — 254,000 cells, four
// times what 14 tiles cost — and it spends almost all of them where nothing fine is being drawn:
// the chop is only displaced inside 'glSeaChopR' (6 tiles), so past that the shortest thing the
// mesh has to resolve is the wind sea, and a cell a tile and a half across carries that with room.
// Graded, 28 tiles costs 140 divisions a side: 19,600 cells against the 63,504 the 14-tile uniform
// grid was already paying. ⚠ It is the standard answer for ocean rendering and it is here for the
// standard reason — the eye is at the centre, so that is the only place resolution is worth buying.
export const PATCH_R = 28;
// The radius of the FINE zone. ⚠ IT MUST NOT FALL BELOW 'glSeaChopR', because the chop is the only
// thing in this sea short enough to need nine samples a tile: displaced in a cell it cannot resolve,
// a 0.6-tile wave does not read as rougher water, it reads as torn geometry — and silently, because
// the LIGHTING goes on describing a smooth wave over the top of it. 'gl:sea' asserts the pair.
export const PATCH_FINE_R = 6;
// The coarse zone's target spacing, in tiles. Set against the shortest wave still DISPLACED out
// there — the wind sea — at about five samples across it.
export const PATCH_RIM_STEP = 1.4;
export const PATCH_PER_TILE = 9;
export const RIM_FADE = 5;      // tiles of crossfade at the outer edge
// ⚠ KEEP IN STEP WITH THE MAX_WAKES IN THE VERTEX SHADER — GLSL cannot read a JS constant, so this
// is the second statement of one number and the array it sizes is silently truncated if it shrinks.
export const MAX_WAKES = 6;

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aOff;     // tile offset from the camera's ground point

uniform mat4  uViewProj;
uniform vec2  uA;        // the camera's ground point, in the window frame the floor uses
uniform float uT;
uniform float uRoll;     // the long swell's amplitude, in tiles
uniform float uPatchR;
uniform float uRimFade;
uniform float uWind;     // the wind sea's amplitude, in tiles
uniform float uWakeAmp;  // how tall a boat's own disturbance stands, in tiles
uniform float uShelter;  // 0 = open sea everywhere, 1 = land upwind takes the swell away
uniform float uShoal;    // how far, in tiles, a crest is dragged along the shore as it shallows
uniform float uChopR;    // tiles within which the chop is real geometry rather than a normal
uniform float uAmp;      // the chop's own amplitude, in tiles
uniform float uSpread;   // 0 = the single-train sea that shipped, 1 = the full spectral band
uniform sampler2D uLut0; // rgb = tile colour, a = waterness — the SAME lut the floor reads
uniform sampler2D uLut1; // a = how sheltered this tile is: 0 against a beach, 1 in open water
uniform int   uMh;
uniform float uR;        // the window's half-width in tiles

// Up to MAX_WAKES boats, as the two things a wake needs: where it is and which way it points
// (xy = position, zw = unit heading), and how fast it is going and how wide it is.
#define MAX_WAKES 6
uniform int   uNWake;
uniform vec4  uWakeP[MAX_WAKES];
uniform vec2  uWakeS[MAX_WAKES];

out vec2  vWorld;        // window-frame world position, which is what the floor calls wx/wy
out float vWater;        // waterness at this vertex
out float vRim;          // 1 in the middle of the patch, 0 at its outer edge
out float vH;            // the height this vertex was actually displaced to
out float vWake;         // how much of that height a hull put there, for the foam below
out float vShelter;      // 0 against a beach, 1 in open water — land upwind takes the sea away
out vec2  vShoal;        // how far the sampling position was warped, so the fragment agrees

${SEA_GLSL}

// ⚠ THE SAME CLAMPED texelFetch THE FLOOR USES. A different sampling rule here is a mesh whose
// edge disagrees with the coast the floor is painting, which is a seam along every shoreline.
float waterAt(vec2 p) {
  vec2 f = vec2(uR, uR) + p;
  ivec2 i = ivec2(floor(f));
  vec2 fr = f - floor(f);
  float s00 = texelFetch(uLut0, clamp(i,               ivec2(0), ivec2(uMh - 1)), 0).a;
  float s10 = texelFetch(uLut0, clamp(i + ivec2(1, 0), ivec2(0), ivec2(uMh - 1)), 0).a;
  float s01 = texelFetch(uLut0, clamp(i + ivec2(0, 1), ivec2(0), ivec2(uMh - 1)), 0).a;
  float s11 = texelFetch(uLut0, clamp(i + ivec2(1),    ivec2(0), ivec2(uMh - 1)), 0).a;
  return s00 * (1.0 - fr.x) * (1.0 - fr.y) + s10 * fr.x * (1.0 - fr.y)
       + s01 * (1.0 - fr.x) * fr.y         + s11 * fr.x * fr.y;
}

// ⚠ THE SAME CLAMPED RULE AS waterAt, and for the same reason: a different sampling rule between
// the two planes puts the shelter a texel off the water it belongs to, which is a calm strip
// lying beside a coast rather than along it.
float shelterAt(vec2 pt) {
  vec2 f = vec2(uR, uR) + pt;
  ivec2 i = ivec2(floor(f));
  vec2 fr = f - floor(f);
  float s00 = texelFetch(uLut1, clamp(i,               ivec2(0), ivec2(uMh - 1)), 0).a;
  float s10 = texelFetch(uLut1, clamp(i + ivec2(1, 0), ivec2(0), ivec2(uMh - 1)), 0).a;
  float s01 = texelFetch(uLut1, clamp(i + ivec2(0, 1), ivec2(0), ivec2(uMh - 1)), 0).a;
  float s11 = texelFetch(uLut1, clamp(i + ivec2(1),    ivec2(0), ivec2(uMh - 1)), 0).a;
  return s00 * (1.0 - fr.x) * (1.0 - fr.y) + s10 * fr.x * (1.0 - fr.y)
       + s01 * (1.0 - fr.x) * fr.y         + s11 * fr.x * fr.y;
}

void main() {
  vec2 w = uA + aOff;
  vWorld = w;
  float water = waterAt(w);
  vWater = water;

  // ⚠ THE GRADIENT IS OFF THE SAME waterAt THE MESH ALREADY SAMPLES, at one tile — a second
  // sampling rule would put the shore normal a texel from the shore it belongs to.
  vec2 gW = vec2(waterAt(w + vec2(1.0, 0.0)) - waterAt(w - vec2(1.0, 0.0)),
                 waterAt(w + vec2(0.0, 1.0)) - waterAt(w - vec2(0.0, 1.0)));
  vec2 sw = seaShoal(w, water, gW, uShoal);
  vShoal = sw - w;

  float r = length(aOff);
  vRim = clamp((uPatchR - r) / max(0.001, uRimFade), 0.0, 1.0);

  // ⚠ AMPLITUDE TAPERS ON WATERNESS, NOT ON DISTANCE. 'waterW' is simultaneously the shoreline
  // COORDINATE the floor places the surf band, the snow line and the bank lip against — 0.5 is the
  // waterline — so a mesh that stood up at full height right to the beach would disagree with all
  // three about where the water starts, and would push a wall of sea through the sand. Squared, so
  // it is zero at the waterline and full only in genuinely open water. Physically this is right
  // anyway: waves shoal.
  float deep = clamp((water - 0.5) * 2.0, 0.0, 1.0);
  float gate = deep * deep * vRim;

  vec2 sp = w;
  float ph = seaPh(sp, uT);
  // ⚠ SHELTER MULTIPLIES THE AMPLITUDE AND MUST NOT TOUCH THE CHOP. A harbour is flat in the
  // SWELL, not glass: the short wind waves are generated locally over metres and are there even
  // in a dock, so taking them away too turns every sheltered basin into a mirror.
  float shel = mix(1.0, shelterAt(w), uShelter);
  vShelter = shel;
  float h = seaRoll(sw, uT, uRoll * gate * shel, uSpread) + seaWind(sw, uT, ph, uWind * gate * shel, uSpread);

  // ── AND THE CHOP GETS A SILHOUETTE, NEAR THE EYE ────────────────────────────────────────────
  //
  // The chop has always been a NORMAL and never geometry, which is the honest split at range and
  // the single biggest thing between this sea and a spectral one up close: a normal map lights a
  // surface that is still flat, so a crest a metre from the hull has no edge, occludes nothing and
  // does not break the horizon. Within a few tiles of the eye that is the difference between water
  // and a photograph of water.
  //
  // ⚠ IT IS TAPERED HARD AND THAT IS THE WHOLE COST STORY. Carrying a 0.6-tile wave in a vertex
  // grid needs about eight vertices across it, so displacing chop over the WHOLE patch means a
  // grid sixty times denser than the swell needs — the arithmetic at the top of this file. Near
  // the eye is where silhouette reads at all, so it is displaced over a few tiles and faded out,
  // and past that the normal carries it exactly as it always did.
  //
  // ⚠ AND THE LIGHTING NEEDS NO CHANGE, which is what makes this cheap rather than a second seam:
  // the fragment normal comes from the same height field either way, so it describes the chop
  // whether or not the mesh has also moved to it. Displaced or not, the two agree.
  float chopF = clamp((uChopR - r) / max(0.001, uChopR * 0.4), 0.0, 1.0);
  h += seaChop(sp, uT, ph) * uAmp * gate * chopF;

  // ── AND WHAT THE BOATS HAVE DONE TO IT ──────────────────────────────────────────────────────
  //
  // ⚠ SUMMED, NOT MAXED. Two boats crossing leave a chop where their wakes meet, and that
  // interference IS what a busy anchorage looks like; taking the strongest would draw one wake
  // passing cleanly through another, which is the one thing water never does.
  //
  // ⚠ AND GATED ON THE SAME 'deep', so a wake cannot push a trough through a beach.
  float wk = 0.0;
  for (int i = 0; i < MAX_WAKES; i++) {
    if (i >= uNWake) break;
    wk += seaWake(w, uWakeP[i].xy, uWakeP[i].zw, uWakeS[i].x, uWakeS[i].y);
  }
  wk *= gate;
  vWake = wk;
  h += wk * uWakeAmp;

  vH = h;
  gl_Position = uViewProj * vec4(w, h, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2  vWorld;
in float vWater;
in float vRim;
in float vH;
in float vWake;
in float vShelter;
in vec2  vShoal;

uniform float uT;
uniform float uRoll;
uniform float uAmp;       // the chop's amplitude, for the normal
uniform float uWind;      // the wind sea's amplitude
uniform float uState;     // 0 glass, 1 gale — the spindrift rides on this
uniform float uFoam;      // the wv above which water is breaking, solved from Monahan coverage
uniform float uTear;      // how torn the foam's edge is; 0 is the smooth threshold that shipped
// ⚠ UNITS 3 AND 4. The floor holds 0 and 1 for its two LUTs, this layer holds 2 for the one it
// borrows, and mirror.js already clears a unit before its prepass because ground.js leaves a
// sampler bound — a collision is a failed draw, and a failed draw draws NOTHING and says nothing.
uniform sampler2D uRefl;
uniform sampler2D uSky;
uniform float uReflOn;
uniform float uReflGain;   // 0..32, where 32 is as hard as Fresnel says it should reflect
uniform float uReflBend;   // how far the wave normal drags the lookup, in PIXELS
uniform float uSkyOn;
uniform vec2  uReflVP;
uniform vec3  uSkyTop;
uniform vec3  uSkyHor;
uniform vec2  uWindDir;   // where the wind is going, for the spindrift streaks
uniform float uSeaLit;
uniform float uSpread;   // 0 = the single-train sea that shipped, 1 = the full spectral band
uniform float uSss;       // the backlit-crest gain; 0 is the sea exactly as it shipped
// Foam left on the water where a hull has already been. xy = position in the same window frame
// vWorld uses, z = how fresh (1 just laid, 0 dispersed), w = 1 when this point joins the next.
#define FOAM_MAX 32
uniform int   uFoamN;
uniform vec4  uFoamP[FOAM_MAX];
uniform vec4  uFoamBox;   // minx, miny, maxx, maxy — the loop is skipped outside it
uniform float uFoamBeam;  // the widest hull in the buffer, in tiles
uniform float uFoamSpread;
// The city's own lights, for the streak each one lays down the water toward you. xyz = ground
// point and height in the frame vWorld uses, w = reach in tiles.
#define NEON_MAX 6
uniform int   uNeonN;
uniform vec4  uNeonP[NEON_MAX];
uniform vec3  uNeonC[NEON_MAX];
uniform float uNeonGain;  // 0 is the sea exactly as it shipped
// ⚠ Cox & Munk slope variance: x along the wind, y across it. The AXIS is 'uWindDir', which this
// shader already carries for the spindrift — one wind, so the streaks and the glitter cannot be set
// to disagree about which way it is blowing.
uniform vec2  uSig2;
uniform vec3  uSunDir3;   // the sun as a real 3-vector
uniform vec3  uMoonDir3;
uniform float uNight;
uniform float uNm;        // the night dim the floor applies, so the two agree after dark
uniform vec3  uHor;       // horizon colour, what a grazing sea mirrors
uniform vec3  uBody;      // the water's own body colour, from the biome
// ── THE EYE IS UNDER THE SURFACE ──────────────────────────────────────────────────────────────
// 0 while the camera is clear of the water and 1 once it is a band's depth under — see
// 'seaSubmersion' in sea-swell.js for why it is a band rather than a boolean.
uniform float uUnder;
uniform float uUnderD;    // how deep, in tiles, for the extinction
uniform float uUnderExt;  // extinction strength; 0 is water you can see across for ever
uniform vec3  uEye;       // camera position in the same frame, z in tiles
uniform float uHz;
uniform float uHazeMax;
uniform float uDepth;     // vertical focal length, for the haze ramp

out vec4 fragColor;

${SEA_GLSL}

void main() {
  // ⚠ THE FRAGMENT MUST USE THE WARP THE VERTEX SHADER APPLIED, carried across rather than
  // recomputed: the mesh is displaced at its vertices and shaded per pixel, so two independent
  // reads of the tile grid put the lighting on crests a fraction of a tile from the ones the
  // geometry actually bent.
  vec2 sp = vWorld + vShoal;
  float ph = seaPh(sp, uT);
  float wv = seaChop(sp, uT, ph);
  // ⚠ A SECOND SAMPLE, FOR THE FOAM ALONE. 'wv' above also drives the surface shading, so shifting
  // it wholesale would slide the lighting off the geometry it is describing.
  vec2 spF = sp - uWindDir * ${SEA_FOAM_LEAD.toFixed(3)};
  float wvF = seaChop(spF, uT, ph);

  float deep = clamp((vWater - 0.5) * 2.0, 0.0, 1.0);
  float gate = deep * deep * vRim;
  // ⚠ ONE SLOPE FOR EVERY TERM. The chop is not in the mesh, so its relief has to arrive as a
  // normal — and the roll and the wind sea ARE in the mesh, so their slopes have to be in the same
  // normal or the lighting and the silhouette disagree about which way a face is pointing.
  // ⚠ THE SAME SHELTER THE VERTEX SHADER DISPLACED BY. Leave it out and the lighting describes a
  // full sea over a harbour the mesh has already flattened — every crest lit that is not there.
  vec2 dd = seaSlope(sp, uT, ph, uAmp, uRoll * gate * vShelter, uWind * gate * vShelter, uSpread);
  vec3 N = normalize(vec3(-dd.x, -dd.y, 1.0));

  vec3 toEye = uEye - vec3(vWorld, vH);
  float dist = length(toEye);
  vec3 V = toEye / max(0.0001, dist);

  // Schlick. A steep view sees the body colour, a grazing one mirrors the sky.
  float cosI = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);

  vec3 base = mix(uBody, uHor, fres * 0.5);
  base *= 1.0 - deep * 0.18;   // shallows near the line stay lighter; open water sits darker

  // The lit surface, on the same terms floor.js uses — the diffuse measured against the FLAT sea
  // so it is zero-mean at every hour, and a lobe as wide as the sea is rough.
  float se = uSunDir3.z, me = uMoonDir3.z;
  float upS = step(0.02, se), upM = step(0.02, me) * clamp(uNight, 0.0, 1.0);
  float mxs = max(0.02, uAmp * 5.9);
  float shin = clamp(2.0 / (mxs * mxs), 4.0, 400.0);
  float spc = upS * pow(max(0.0, dot(N, normalize(uSunDir3 + V))), shin) * (0.35 + 0.65 * se)
            + upM * pow(max(0.0, dot(N, normalize(uMoonDir3 + V))), shin * 0.5) * 0.45;
  float flatL = upS > 0.5 ? se : me;
  float lam = upS > 0.5 ? dot(N, uSunDir3) : dot(N, uMoonDir3);
  float key = max(upS, upM * 0.6);
  float lit = mix(wv * 0.15, (lam - flatL) * 0.45, uSeaLit * key);

  vec3 col = base * (1.0 + lit);

  // ── A BACKLIT CREST ─────────────────────────────────────────────────────────────────────────
  //
  // The green glow through the top of a wave with the sun behind it. It is most of what separates
  // water from a shiny surface, and it is the one thing a reflection and a specular lobe between
  // them cannot say: both describe light coming OFF the surface, and this is light that went
  // THROUGH it.
  //
  // ⚠ IT IS NOT REAL SUBSURFACE SCATTERING AND MUST NOT PRETEND TO BE. Real SSS needs a thickness
  // to integrate through, and this sea is an opaque skin over a height field with no volume at all
  // — the same finding 'matFrost' records one surface over, where a grab pass was rejected because
  // there is nothing behind the pane to read. What IS expressible is the three things that decide
  // when a crest lights up, and they are all already in this shader.
  //
  // ⚠ THE SUN MUST BE BEYOND THE WAVE, WHICH IS A SIGN THAT IS EASY TO GET BACKWARDS. 'uSunDir3'
  // points from the surface TO the sun and 'V' from the surface TO the eye, so light travels along
  // -L and leaves toward V; it continues into your eye when those agree, which is dot(V, -L) high
  // — the sun in FRONT of you, past the wave. With the sun over your shoulder dot(V, L) is positive
  // and this term is zero, which is correct and is the half that a 'abs()' would silently destroy.
  float back = max(0.0, -dot(V, uSunDir3));
  // ⚠ AND A LOW SUN TRANSMITS AND A HIGH ONE DOES NOT, because a steep sun goes down INTO the water
  // rather than through the crest toward a near-level eye. 'se' is the elevation sine already
  // solved above, so this costs nothing and it is why the effect belongs to evening.
  float graze = 1.0 - se;
  // ⚠ THE LIFT IS THE MESH'S OWN DISPLACEMENT, NOT THE CHOP. 'vH' is the height this vertex was
  // actually moved to, so it is zero on a glass day BY ARITHMETIC rather than by a guard — there is
  // no crest to light through when nothing is displaced. Normalised by the amplitude that produced
  // it so a gale and a swell both read, rather than only the biggest sea in the game.
  float amp = uRoll * gate + uWind * gate;
  float lift = amp > 1e-5 ? clamp(vH / amp, 0.0, 1.0) : 0.0;
  // ⚠ RED IS ABSORBED FIRST, which is why water that has been travelled through comes back green.
  // Derived off 'uBody' rather than authored, so a biome that changes the water's colour changes
  // what its crests transmit and the two cannot drift apart.
  // ⚠ AND BLUE IS ABSORBED SECOND, WHICH IS THE HALF THE FIRST CUT GOT WRONG. Lifting green and
  // blue together makes CYAN, and cyan on a crest reads as a neon tube laid along it rather than as
  // light coming through water — measured on screen at gain 1.4, where the effect was in exactly
  // the right place and the wrong colour. Water's absorption is least in the green, so a path
  // through it comes back green with the blue down as well as the red, just less far down.
  vec3 scat = uBody * vec3(0.30, 1.50, 0.70);
  col += scat * (uSss * upS * key * lift * graze * pow(back, 3.0) * gate);

  // ── THE CITY, IN THE WATER ──────────────────────────────────────────────────────────────────
  //
  // The same planar reflection the wet road has had since the puddle pass shipped: the mass, the
  // lights and the signage rendered once more through a camera flipped about z = 0, which is the
  // sea's own plane. Nothing is re-uploaded and no second idea of what a building looks like exists
  // — 'gl/mirror.js' was always general, and 'world.js' says in as many words that it kept its
  // uniforms "for the day somebody wants reflections on unpaved ground".
  //
  // ⚠ THE LOOKUP IS A SCREEN POSITION, NOT A RAY. A mirrored camera puts a reflected point on the
  // SAME PIXEL, which is the whole reason a planar reflection is affordable — so the buffer is read
  // at this fragment's own coordinate and the only thing that moves it is the surface being tilted.
  //
  // ⚠ AND THE BEND IS THE WAVE'S OWN NORMAL, IN PIXELS. The road wobbles its lookup with a pair of
  // sines invented for the purpose; here there is a real normal already solved for the lighting, so
  // using anything else would be a second opinion about which way the surface is facing — a
  // reflection that disagreed with its own specular. Divided by the viewport so the amplitude is
  // pixels: a constant in UV is a bend that doubles when somebody halves the resolution dial.
  if (uReflOn > 0.5) {
    vec2 ruv = gl_FragCoord.xy / uReflVP + N.xy * (uReflBend / uReflVP.y);
    vec4 im = texture(uRefl, ruv);
    // ⚠ AND WHERE THERE IS NO CITY OVERHEAD, THE WATER IS LOOKING AT THE SKY. The buffer holds the
    // city and nothing else and is cleared transparent, so open water would reflect NOTHING and
    // show only the warm smear off the lamps — the "yellow puddles" report, one surface over.
    // The 0.86 is drawSky's own dome mapping, not a taste constant: elevation lands on the screen
    // at horizonY * (1 - sin(el) * 0.86), so the zenith sits 86% along that gradient.
    vec3 sky = mix(uSkyHor, uSkyTop, cosI * 0.86);
    if (uSkyOn > 0.5) sky = texture(uSky, vec2(gl_FragCoord.x / max(1.0, uReflVP.x), 1.0 - cosI * 0.86)).rgb;
    vec3 img = im.rgb + sky * (1.0 - im.a);
    // ⚠ WEIGHTED BY FRESNEL AND BY HOW MUCH WATER IS HERE. A steep view sees the body colour and a
    // grazing one mirrors — which on a sea seen from a low seat is nearly everything, so the gain
    // is what keeps it a reflection rather than a chrome sheet.
    float mirK = clamp(fres * gate * uReflGain * (1.0 / 32.0), 0.0, 1.0);
    col = col * (1.0 - mirK) + img * mirK;
  }

  // ── AND THE NEON LIES DOWN THE WATER ────────────────────────────────────────────────────────
  //
  // ⚠ AFTER THE MIRROR AND ADDED, NEVER MIXED. The two are not competing accounts of one thing:
  // the mirror is the city's IMAGE, which on broken water is dim and mostly destroyed, and this is
  // its LIGHT, which survives the roughness by being smeared instead. A harbour at night is almost
  // entirely the second, which is why the water under a full skyline measured black with the mirror
  // working perfectly. Mixed in, a streak would REPLACE the image it is supposed to be lying over.
  if (uNeonGain > 0.001 && uNeonN > 0 && uNight > 0.01) {
    vec3 neon = vec3(0.0);
    for (int i = 0; i < NEON_MAX; i++) {
      if (i >= uNeonN) break;
      vec4 L = uNeonP[i];
      // ⚠ 'vWorld', NEVER 'sp'. 'sp' is the SAMPLING position, dragged sideways by the shoal warp
      // so a crest bends round to face a beach; where this fragment actually IS on the water is
      // 'vWorld'. A reflection is pure geometry — where the eye is, where the light is, where the
      // surface is — so asking it at a warped position slides every streak along the shore.
      float g = seaGlitter(vWorld, uEye.xy, max(0.02, uEye.z), L.xyz, uWindDir, uSig2.x, uSig2.y);
      // ⚠ AND IT FALLS OFF AS AN INVERSE SQUARE, NOT ON THE WALL WASH'S REACH. That reach is how far
      // a lamp LIGHTS something, and it hard-cuts: the tarmac smear uses it and is right to, because
      // a wet-road streak is short and the cut almost never binds. A glitter streak is the opposite
      // — its whole nature is to run a long way from its source, and a sign on the far quay lays one
      // all the way to your feet. Copied across, the cut zeroed every light more than 2.2 reaches
      // from the water it was lighting, which in a harbour is all of them: measured at 0.000% of the
      // frame moved at every gain, with the glitter term itself computing perfectly.
      //
      // So it is 1/(1 + (d/r)^2) — an inverse square softened at the origin, with the light's own
      // reach as the scale rather than a second authored distance. A distant sign is dimmer and is
      // never absent, which is what a harbour looks like.
      float dl = length(L.xy - vWorld) / max(0.001, L.w);
      neon += uNeonC[i] * (g / (1.0 + dl * dl));
    }
    // ⚠ GATED ON THE WATER AND ON THE NIGHT. Signage is drawn by day too, and a pink streak across
    // a bay at noon is not a reflection, it is a decal — the same sentence floor.js writes over the
    // wet road. 'gate' is the waterness-and-rim term every other water add here is weighed by.
    col += neon * (uNeonGain * gate * clamp(uNight, 0.0, 1.0));
  }

  // Whitecaps, scattered so they do not land on the swell's own regular spacing.
  //
  // ⚠ THE THRESHOLDS MOVE WITH THE SEA STATE AND THEY HAVE TO. They are tested against 'wv', whose
  // range does not change — so a fixed pair means a glass sea foams exactly as much as a gale does.
  // At uState 0 they sit above the chop's own maximum and NOTHING breaks, which is the whole point
  // of a calm day; at 1 they are low enough that the tops are coming off.
  // ⚠ THE THRESHOLDS ARE CALIBRATED AGAINST MEASURED WHITECAP COVERAGE, NOT CHOSEN BY EYE. Monahan
  // and O'Muircheartaigh (1980) give the fraction of the sea surface covered in breaking foam as
  // W = 3.84e-6 * U^3.41 — about 1% of the surface at Force 5, 10.5% at Force 8, 22.5% at Force 10.
  // 'wv' runs -1.01..1.01 and its distribution is known, so the threshold that produces a given
  // coverage is arithmetic: 0.950 gives 0.5%, 0.824 gives 3%, 0.630 gives 10.5%, 0.378 gives 22.5%.
  // At uState 0 the threshold sits ABOVE the chop own maximum, so nothing breaks at all — which is
  // the entire point of a calm day and is not something a tuned number would reliably give you.
  //
  // ⚠ AND THE CURVE BETWEEN THEM IS A POWER LAW BECAUSE THE PHYSICS IS. Coverage goes as U^3.41,
  // so a linear ramp foams a moderate breeze like a gale; pow(uState, 1.9) tracks Monahan to about
  // a point of coverage across the whole range.
  // ⚠ THE THRESHOLD ARRIVES SOLVED. It is the quantile of the chop own distribution at Monahan's
  // coverage for this wind — inverted in JS once at module load, where the distribution is knowable
  // — so the sea has EXACTLY the observed fraction of breaking water at every wind speed. A curve
  // fitted here to three points would drift the moment the trains changed, and drift silently.
  float thW = uFoam;
  // ⚠ AND THE FOAM GOES ON THE BIG WAVES CRESTS, WHICH IS WHERE IT BREAKS. Scattered uniformly it
  // reads as speckle on a moving surface; concentrated where the WIND SEA is cresting it reads as
  // tops being blown off, and it is the same number of white pixels either way.
  float wcrest = seaWind(sp, uT, ph, 1.0, uSpread);
  // ⚠ AND THE CREST BIAS IS ZERO-MEAN, WHICH IT WAS NOT. Lowering the threshold on the wind sea's
  // crests concentrates foam where water actually breaks — right, and the note beside it claimed it
  // was "the same number of white pixels either way", which is only true if the bias takes foam OFF
  // somewhere as well as putting it ON. It only ever subtracted, so it ADDED coverage on top of the
  // quantile and the sea foamed over more of itself than its wind says. Centred on 0.5 it moves
  // foam onto the crests and off the troughs and leaves the fraction alone.
  //
  // ⚠ AND THIS IS WHAT MAKES A WHITECAP A STREAK RATHER THAN A DISC. The chop is near-isotropic, so
  // thresholding it alone can only ever give round islands however torn their edges are; the wind
  // sea's crests are long lines, so biasing onto them is what elongates foam ALONG the crest — which
  // is what every photograph of a gale shows and what the tear on its own could never produce.
  thW -= uState * 0.52 * (smoothstep(0.15, 0.9, wcrest) - 0.5);
  float thC = thW - 0.22;

  // ── TORN, AND IN TWO STAGES ─────────────────────────────────────────────────────────────────
  //
  // ⚠ THE TEAR PERTURBS THE FIELD AND NOT THE FINISHED MASK, which is what keeps the coverage
  // honest: 'uFoam' is the QUANTILE OF THIS FIELD, inverted in JS against Monahan's observed
  // whitecap fraction, so eroding the mask afterwards would foam over less of the sea than the wind
  // says while every gate stayed green. Perturb the field, quantile THAT, and the fraction is
  // preserved by construction — measured across 10/22/34/45 kt it tracks Monahan to ~1%.
  //
  // ⚠ AND IT FADES WITH DISTANCE, because it is deliberately high-frequency — the finest octave is
  // about 0.4 m — and there is no mip chain on a procedural field, so carried to the horizon it
  // aliases into a crawling shimmer. Past a few tiles a whitecap is a few pixels and has no texture
  // to resolve anyway. A zero-mean perturbation moves the expected coverage only at second order,
  // so the far water keeps the fraction it should have.
  float tearFade = uTear * (1.0 - smoothstep(6.0, 22.0, dist));
  // ⚠ THE FINE TRAINS DECIDE HOW BIG A WHITECAP IS, the tear decides how ragged its edge is, and
  // they are not interchangeable — six times the tear leaves the biggest patches almost untouched.
  // ⚠ AND IT RIDES THE SAME SWITCH rather than taking a uniform of its own: 'step' off uTear, so the
  // flag's 0 is still the sea exactly as it shipped and there is no second thing to remember to
  // wire — the off switch that does not fully switch off cost a round trip here already.
  float wvT = wvF + seaFoamFine(spF, uT) * step(0.0001, uTear)
            + seaFoamTorn(spF, uT, uWindDir, tearFade);

  float cr = 0.0, cap = 0.0;
  if (wvT > thC) cr = (wvT - thC) * 5.0;
  // ⚠ THE RAMP WAS x9 AND THAT IS THE OTHER HALF OF WHY FOAM READ AS BLOBS. It crossed 0 to 1 within
  // about a tenth of the chop's range, so very nearly every foam pixel saturated and a whitecap was
  // a flat white slab with a hard rim — one population and one brightness, which is neither of the
  // two that real foam has.
  if (wvT > thW) cap = (wvT - thW) * (uTear > 0.0 ? ${SEA_FOAM_RAMP.toFixed(2)} : 9.0);

  // ── SPINDRIFT ───────────────────────────────────────────────────────────────────────────────
  //
  // Beaufort 9 is "dense streaks of foam along the direction of the wind" and Force 10 is "the
  // surface takes on a white appearance". The streaks are the single most recognisable thing about
  // a storm sea and the one part of it that is not a wave at all — foam already torn off crests and
  // dragged downwind. Dead below about Force 7, so it costs nothing on any ordinary day.
  //
  // ⚠ ALIGNED WITH THE WIND AND NOT WITH THE WAVE TRAIN. Blown foam runs downwind; a streak that
  // ran with the swell would turn as the swell turned, which is the tell that it is decoration.
  if (uState > 0.55) {
    vec2 wd = normalize(uWindDir + vec2(1e-5, 0.0));
    float along = dot(sp, wd), across = dot(sp, vec2(-wd.y, wd.x));
    // Long and thin: low frequency along the wind, high across it, and wandering on two scales so
    // it is a set of streaks rather than a comb.
    float stk = sin(across * 3.3 + sin(along * 0.34) * 2.4 + sin(along * 0.11) * 3.1) * 0.5 + 0.5;
    stk = pow(stk, 4.0) * smoothstep(0.55, 1.0, uState);
    cap = max(cap, stk * 0.55);
  }

  // ── THE FOAM A HULL LEAVES ──────────────────────────────────────────────────────────────────
  //
  // The geometry already put a trough and two arms in the surface; this is what that disturbed
  // water LOOKS like. ⚠ IT READS THE SAME 'vWake' THE VERTEX SHADER DISPLACED BY, so the white is
  // on the water that actually moved — a wake painted from a second expression would sit beside its
  // own trough, which is the sub-tile slide 'world.js' warns about for the puddle reflections.
  float wfoam = clamp(abs(vWake) * 1.45 - 0.12, 0.0, 1.0);
  cap = max(cap, wfoam * wfoam * 0.85);
  col += vec3(cr * 55.0 + spc * 235.0, cr * 70.0 + spc * 230.0, cr * 90.0 + spc * 205.0) / 255.0;
  // ── FOAM WHERE THE HULL HAS ALREADY BEEN ────────────────────────────────────────────────────
  //
  // 'vWake' above is the wake bolted to the boat and swings round with her. This is the trail she
  // left: a polyline of points on the water, each fading on its own clock.
  //
  // ⚠ A WAKE IS ONE BAND, NEVER TWO RAILS. The snow shader measures 'abs(d - half)' because a
  // vehicle has two contact patches with clean snow between them; a hull is one object and churns a
  // single strip. Carrying that form across draws every boat's wake as two parallel lines with
  // untouched water down the middle, which is a catamaran.
  //
  // ⚠ AND IT IS THE PERPENDICULAR TO THE SEGMENT'S OWN LINE, with 't' clamped to the segment and
  // the ends cut square. A capsule distance wraps a half-disc round every joint, and consecutive
  // segments share a vertex — so the disc off the end of one and the disc off the start of the next
  // merge into a blob at every single point in the path. That is the exact defect the snow tracks
  // shipped with, diagnosed on a straight line, and it looks like foam boiling up in circles.
  float foam = 0.0;
  if (uFoamN > 1 && sp.x > uFoamBox.x && sp.x < uFoamBox.z && sp.y > uFoamBox.y && sp.y < uFoamBox.w) {
    for (int i = 0; i < FOAM_MAX - 1; i++) {
      if (i >= uFoamN - 1) break;
      vec4 A = uFoamP[i];
      if (A.w < 0.5) continue;              // this point joins nothing — end of a run
      vec4 B = uFoamP[i + 1];
      vec2 e = B.xy - A.xy;
      float L2 = dot(e, e);
      if (L2 < 1e-9) continue;
      float t = clamp(dot(sp - A.xy, e) / L2, 0.0, 1.0);
      float d = length(sp - (A.xy + e * t));
      // Freshness along the segment, so a trail fades smoothly from its tail rather than in steps.
      float fresh = mix(A.z, B.z, t);
      // ⚠ AND IT WIDENS AS IT AGES, which is most of what makes it read as dispersing rather than
      // as simply dimming. A fresh cut is the hull's own beam; by the end it has spread to several
      // times that and is nearly transparent, which is what foam on water actually does.
      float age = 1.0 - fresh;
      // 'half' is a RESERVED WORD in GLSL ES and this shader would not compile with it — which took
      // the WHOLE GL pass down to the 2-D fallback, silently, with every headless gate green.
      float hw = uFoamBeam * mix(0.5, uFoamSpread, age);
      foam = max(foam, smoothstep(hw, hw * 0.25, d) * fresh * fresh);
    }
  }
  // ⚠ IT JOINS THE WHITECAPS RATHER THAN BEING ADDED OVER THEM, so a trail through a breaking sea
  // does not stack to white on water that was already foaming.
  cap = max(cap, foam * 0.9);

  // ── STAGE A AND STAGE B (Monahan & Lu 1990) ─────────────────────────────────────────────────
  //
  // There are two populations of foam and the mask had one. STAGE A is the actively breaking crest:
  // about a second of life, dense, bright, lying along the crest. STAGE B is the patch it leaves —
  // five to ten times the lifetime, spreading and dimming, and at any instant covering between 1.5
  // and 40 times the area of the active crests. A single white slab is neither.
  //
  // ⚠ THEY ARE NESTED RATHER THAN SEPARATE, which is what keeps one coverage number meaningful: the
  // active core sits INSIDE the patch it is generating, so the thresholded region is still exactly
  // Monahan's fraction and what changes is how it is shaded across its own depth. Two independent
  // masks would be two coverages, and the physical claim would have nothing left to attach to.
  //
  // ⚠ AND STAGE B IS NOT WHITE. Decaying foam is a thinning raft of bubbles with water showing
  // through it, so it reads as a desaturated blue-grey; painted the same white as the active crest
  // it just makes the slab bigger, which is the defect rather than the fix.
  // ⚠ AND 0 IS THE SEA AS IT SHIPPED, WHICH COST A ROUND TRIP TO GET RIGHT. The ramp and the two
  // stages went in unconditionally at first, so turning the flag off restored the smooth threshold
  // and left the foam dimmer and differently coloured than the renderer it was meant to be
  // reverting to — an off switch that does not switch off is worse than no off switch, because it
  // is the thing every later A/B is measured against.
  if (uTear > 0.0) {
    float capB = clamp(cap, 0.0, 1.0);
    float capA = smoothstep(${SEA_FOAM_A.toFixed(2)}, 1.0, capB);
    vec3 foamCol = mix(vec3(150.0, 168.0, 182.0), vec3(240.0, 246.0, 250.0), capA) / 255.0;
    col += foamCol * (capB * 0.82 + capA * 0.52) * (0.45 + 0.55 * uNm);
  } else {
    col += vec3(cap * 205.0 / 255.0) * (0.45 + 0.55 * uNm);
  }

  col *= uNm;

  // The same distance haze the floor applies, so the patch recedes with the sea beyond it.
  float p = clamp(uDepth / max(0.02, dist), 0.0, 4.0);
  float haze = clamp(1.0 - p * uHz, 0.0, uHazeMax);
  col = mix(col, uHor, haze);

  // ── SEEN FROM UNDERNEATH ────────────────────────────────────────────────────────────────────
  //
  // The mesh is drawn two-sided ('disable(CULL_FACE)', so a trough seen from a crest shows the far
  // side of the wave), which means that when the eye goes under a crest the surface overhead is
  // ALREADY being drawn — and it was being drawn with the sky reflection, the sun glitter and the
  // whitecaps it wears when seen from above. That is the whole bug: not a missing effect, a surface
  // confidently shaded for the wrong side.
  //
  // ⚠ 'gl_FrontFacing' IS THE PER-FRAGMENT QUESTION AND 'uUnder' IS THE PER-CAMERA ONE, and they are
  // not the same question. The frame that matters most is the eye AT the waterline with a crest
  // between it and the horizon: part of that surface is over you and part of it is still in front of
  // you, so a single camera-wide switch shades half of it wrong. The camera scalar decides how much
  // water you are looking THROUGH; the facing decides whether THIS piece of surface is a ceiling.
  if (uUnder > 0.001 && !gl_FrontFacing) {
    // ⚠ SNELL'S WINDOW, WHICH IS THE ONE THING THAT SAYS "UNDERWATER" ON ITS OWN. Looking up from
    // inside water, the whole sky above the horizon is refracted into a cone of half-angle 48.6
    // degrees (asin(1/1.33)); OUTSIDE that cone nothing can get in at all, and the surface turns
    // into a mirror by total internal reflection. So there is a bright disc of daylight overhead
    // with a dark mirrored ring around it, and the edge of the disc is sharp.
    //
    // ⚠ cos(48.6) = 0.661, and it is written as the cosine rather than as an angle because the
    // fragment already has the dot product and an acos would buy nothing.
    float up = abs(dot(normalize(vec3(-dd, 1.0)), normalize(toEye)));
    float win = smoothstep(0.615, 0.705, up);       // soft edge: a wave's own slope blurs it anyway
    // Inside the window: the sky, compressed. Outside: the water below, mirrored back down.
    vec3 sky = mix(uHor, uSkyTop, clamp(up, 0.0, 1.0) * 0.86);
    col = mix(uBody * 0.55, sky, win);
    // A rim of brighter light right at the critical angle — the compressed horizon piling up there.
    col += vec3(0.16, 0.20, 0.22) * (1.0 - abs(up - 0.661) / 0.09) * step(abs(up - 0.661), 0.09) * uNm;
    col *= uNm;
  }
  // ⚠ AND EXTINCTION IS WAVELENGTH-DEPENDENT, WHICH IS MOST OF THE LOOK AND COSTS ONE exp() A
  // CHANNEL. Water absorbs red first, green next and blue last, so anything more than a metre or two
  // away goes blue-green and then simply goes — real underwater visibility is tens of metres, not
  // the hundreds this renderer draws. Written as a grey fog it reads as smoke; written per channel
  // it reads as water. The coefficients are in the ratio Beer-Lambert gives for clear coastal water.
  if (uUnder > 0.001) {
    float ext = dist + uUnderD * 2.0;               // the slant path, near enough at these depths
    vec3 trans = exp(-ext * vec3(1.05, 0.34, 0.22) * uUnderExt);
    col = mix(col, mix(uBody * 0.6 * uNm, col * trans, trans.g), uUnder);
  }

  // ⚠ THE RIM IS AN ALPHA, NOT A DISCARD. Past the patch the flat floor is still painting the same
  // sea, so the mesh has to hand over gradually — a hard edge is a circle on the water that follows
  // the camera, which is worse than the flat sea it is replacing.
  float a = clamp(vRim, 0.0, 1.0) * smoothstep(0.35, 0.6, vWater);
  if (a < 0.004) discard;
  fragColor = vec4(col * a, a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' water shader: ' + log);
  }
  return sh;
}

export function createWaterLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('water link: ' + gl.getProgramInfoLog(prog));

  const U = (n) => gl.getUniformLocation(prog, n);
  const loc = {
    viewProj: U('uViewProj'), a: U('uA'), t: U('uT'),
    roll: U('uRoll'), patchR: U('uPatchR'), rimFade: U('uRimFade'),
    neonN: U('uNeonN'), neonP: U('uNeonP'), neonC: U('uNeonC'), neonGain: U('uNeonGain'), sig2: U('uSig2'),
    under: U('uUnder'), underD: U('uUnderD'), underExt: U('uUnderExt'),
    wind: U('uWind'), state: U('uState'), foam: U('uFoam'), tear: U('uTear'), wakeAmp: U('uWakeAmp'), windDir: U('uWindDir'),
    refl: U('uRefl'), sky: U('uSky'), reflOn: U('uReflOn'), reflGain: U('uReflGain'),
    reflBend: U('uReflBend'), skyOn: U('uSkyOn'), reflVP: U('uReflVP'), skyTop: U('uSkyTop'), skyHor: U('uSkyHor'),
    nWake: U('uNWake'), wakeP: U('uWakeP'), wakeS: U('uWakeS'),
    lut0: U('uLut0'), mh: U('uMh'), r: U('uR'),
    amp: U('uAmp'), seaLit: U('uSeaLit'), sss: U('uSss'), spread: U('uSpread'),
    lut1: U('uLut1'), shelter: U('uShelter'), shoal: U('uShoal'), chopR: U('uChopR'),
    foamN: U('uFoamN'), foamP: U('uFoamP'), foamBox: U('uFoamBox'),
    foamBeam: U('uFoamBeam'), foamSpread: U('uFoamSpread'),
    sunDir3: U('uSunDir3'), moonDir3: U('uMoonDir3'), night: U('uNight'), nm: U('uNm'),
    hor: U('uHor'), body: U('uBody'), eye: U('uEye'),
    hz: U('uHz'), hazeMax: U('uHazeMax'), depth: U('uDepth'),
  };

  // ── THE GRID, BUILT ONCE ────────────────────────────────────────────────────────────────────
  //
  // Tile offsets from the camera's ground point, as a triangle list. Built on first draw and never
  // touched again — see the note at the top about why nothing here is per-frame.
  let vao = null, buf = null, count = 0, cells = 0;
  // ⚠ THE GRADING IS SEPARABLE AND THE FINE ZONE IS THEREFORE A SQUARE, which is what makes the
  // knee land on an exact index in both axes and keeps every cell a clean quad. It costs a little
  // waste on the diagonals (the fine square reaches 8.5 tiles at its corners against the 6 it owes)
  // and it buys the one thing a radial grid cannot give without stitching: no T-junctions anywhere.
  //
  // ⚠ AND THE DIVISION COUNTS ARE DERIVED FROM THE CONSTRAINTS RATHER THAN PICKED. The fine zone
  // owes 'PATCH_PER_TILE' samples a tile because of the chop; the rim owes 'PATCH_RIM_STEP' because
  // of the wind sea. A grid sized by hand goes quietly wrong the moment either of those moves.
  function warpAxis(a, u0) {
    const sg = a < 0 ? -1 : 1, t = Math.abs(a);
    return t <= u0
      ? sg * (PATCH_FINE_R / u0) * t
      : sg * (PATCH_FINE_R + (PATCH_R - PATCH_FINE_R) * (t - u0) / (1 - u0));
  }
  function build() {
    const even = (x) => 2 * Math.ceil(x / 2);
    const nFine = even(2 * PATCH_FINE_R * PATCH_PER_TILE);
    const nRim = even(2 * (PATCH_R - PATCH_FINE_R) / PATCH_RIM_STEP);
    const n = Math.max(4, nFine + nRim);
    const u0 = nFine / n;
    const X = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) X[i] = warpAxis(-1 + (2 * i) / n, u0);
    // Two triangles per cell, and cells outside the patch circle are skipped entirely — a square
    // grid clipped to a disc is about 21% fewer triangles for exactly the same picture, because
    // the rim fade has already taken the corners to zero.
    const verts = [];
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const x0 = X[ix], y0 = X[iy], x1 = X[ix + 1], y1 = X[iy + 1];
        const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
        // ⚠ The reject margin is this CELL's own size rather than one global step, because the
        // cells are no longer all the same size — a fixed margin either clips the rim short or
        // keeps a ring of coarse cells nobody can see.
        if (Math.hypot(cx, cy) > PATCH_R + Math.max(x1 - x0, y1 - y0)) continue;
        verts.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
        cells++;
      }
    }
    const data = new Float32Array(verts);
    count = data.length / 2;
    if (typeof window !== 'undefined') window.__seaPatch = { cells, verts: count, R: PATCH_R };
    vao = gl.createVertexArray();
    buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
  }

  // `s` is the floor's own state object, so every term below is the number the floor is using this
  // frame rather than a second opinion about it.
  function draw(cam, s, cssH, lut, refl) {
    if (!s || !lut || !lut.tex) return 0;
    const roll = s.seaRoll || 0;
    if (roll <= 0.0001 || !(s.swell > 0)) return 0;   // no swell, no mesh — the flat floor is the whole sea
    if (!vao) build();
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, mat4f(viewProjMatrix(cam, cssH)));
    gl.uniform2f(loc.a, s.ax || 0, s.ay || 0);
    gl.uniform1f(loc.t, s.t || 0);
    gl.uniform1f(loc.roll, roll);
    gl.uniform1f(loc.patchR, PATCH_R);
    gl.uniform1f(loc.rimFade, RIM_FADE);
    gl.uniform1f(loc.wind, s.seaWind || 0);
    gl.uniform1f(loc.state, s.seaState == null ? 0 : s.seaState);
    gl.uniform1f(loc.foam, s.seaFoam == null ? 1.2 : s.seaFoam);
    // ⚠ THE THRESHOLD ABOVE WAS QUANTILED WITH THIS EXACT GAIN. They travel together or the sea
    // foams over the wrong fraction of itself — which is why the tune key reaches the JS inversion
    // as well as the shader, rather than being a shader-side switch.
    gl.uniform1f(loc.tear, s.seaTear == null ? 0 : s.seaTear);
    const wd = s.seaWindDir || [1, 0];
    gl.uniform2f(loc.windDir, wd[0], wd[1]);
    gl.uniform1f(loc.wakeAmp, s.wakeAmp == null ? 0.06 : s.wakeAmp);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES WITH NO BOATS IN THEM. A uniform holds its last
    // value, so a count left over from a frame that had one leaves a wake standing in open water
    // for the rest of the session, with nothing moving to explain it.
    const wk = s.wakes || [];
    const n = Math.min(wk.length, MAX_WAKES);
    gl.uniform1i(loc.nWake, n);
    if (n > 0) {
      const P = new Float32Array(MAX_WAKES * 4), S = new Float32Array(MAX_WAKES * 2);
      for (let i = 0; i < n; i++) {
        const w = wk[i];
        P[i * 4] = w.x; P[i * 4 + 1] = w.y; P[i * 4 + 2] = w.dx; P[i * 4 + 3] = w.dy;
        S[i * 2] = w.spd; S[i * 2 + 1] = w.beam;
      }
      gl.uniform4fv(loc.wakeP, P);
      gl.uniform2fv(loc.wakeS, S);
    }
    gl.uniform1f(loc.amp, s.seaAmp == null ? 0.02 : s.seaAmp);
    gl.uniform1f(loc.seaLit, s.seaLit == null ? 0 : s.seaLit);
    gl.uniform1f(loc.sss, s.seaSss == null ? 0 : s.seaSss);
    gl.uniform1f(loc.spread, s.seaSpread == null ? 0 : s.seaSpread);
    gl.uniform1f(loc.shelter, s.seaShelter == null ? 0 : s.seaShelter);
    gl.uniform1f(loc.shoal, s.seaShoal == null ? 0 : s.seaShoal);
    gl.uniform1f(loc.chopR, s.seaChopR == null ? 0 : s.seaChopR);
    // ⚠ A ZERO COUNT IS NOT ENOUGH ON ITS OWN — a uniform holds its last value, so a frame with
    // no trail must still SET the count or the shader goes on walking the buffer it was handed
    // minutes ago, drawing foam that is no longer anywhere near a boat. The array itself can be
    // left stale because the loop is bounded by the count.
    const fm = s.foam;
    gl.uniform1i(loc.foamN, fm ? fm.n : 0);
    if (fm) {
      gl.uniform4fv(loc.foamP, fm.pts);
      gl.uniform4f(loc.foamBox, fm.box[0], fm.box[1], fm.box[2], fm.box[3]);
      gl.uniform1f(loc.foamBeam, fm.beam);
      gl.uniform1f(loc.foamSpread, fm.spread);
    }

    // ⚠ THE SUN ARRIVES AS A BEARING AND AN ELEVATION SINE, so the 3-vector is exact and free —
    // `sun.elev` IS sin(elevation) and `sun.dir` a unit 2-D bearing. A plausible {x,y,z} passed in
    // here instead is the trap `vehicleRenderSmoke` was written for.
    const sd = s.sunDir || [0, 0], se = Math.max(s.sunElev || 0, 0), sc = Math.sqrt(Math.max(0, 1 - se * se));
    const md = s.moonDir || [0, 0], me = Math.max(s.moonElev || 0, 0), mc = Math.sqrt(Math.max(0, 1 - me * me));
    gl.uniform3f(loc.sunDir3, sd[0] * sc, sd[1] * sc, se);
    gl.uniform3f(loc.moonDir3, md[0] * mc, md[1] * mc, me);
    gl.uniform1f(loc.night, s.night || 0);
    gl.uniform1f(loc.nm, s.nm == null ? 1 : s.nm);
    const hor = s.hor || [0.3, 0.4, 0.5];
    gl.uniform3f(loc.hor, hor[0], hor[1], hor[2]);
    const body = s.seaBody || [0.133, 0.243, 0.345];
    gl.uniform3f(loc.body, body[0], body[1], body[2]);
    gl.uniform3f(loc.eye, s.ax || 0, s.ay || 0, s.EH == null ? 0.12 : s.EH);
    gl.uniform1f(loc.hz, s.hz || 0);
    gl.uniform1f(loc.hazeMax, s.hazeMax == null ? 1 : s.hazeMax);
    gl.uniform1f(loc.depth, s.depth || 200);
    gl.uniform1f(loc.r, s.R || 0);
    gl.uniform1i(loc.mh, lut.mh | 0);

    // ⚠ UNIT 2. The floor holds 0 and 1 for its two LUTs and `mirror.js` already clears 1 before
    // its prepass because ground.js leaves a sampler there — a collision here is a failed draw,
    // and a failed draw draws NOTHING and says nothing.
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lut.tex);
    gl.uniform1i(loc.lut0, 2);
    // ⚠ UNIT 5. 0 and 1 are the floor's own two planes, 2 is the one this layer borrows, 3 and 4 are
    // the reflection and its sky — and an unbound sampler reads WHITE on some drivers, which here is
    // a sea that is open everywhere and a feature that looks switched off.
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, lut.tex1 || lut.tex);
    gl.uniform1i(loc.lut1, 5);

    // ⚠ BIND SOMETHING EVEN WHEN IT IS OFF. An unbound sampler reads white on some drivers, which
    // is a sea reflecting a blank page rather than a sea reflecting nothing — ground.js records the
    // same trap. So the units are always filled and uReflOn is what decides.
    const R = refl || {};
    const on = R.tex && (s.seaRefl || 0) > 0 ? 1 : 0;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, R.tex || lut.tex);
    gl.uniform1i(loc.refl, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, R.sky || lut.tex);
    gl.uniform1i(loc.sky, 4);
    gl.uniform1f(loc.reflOn, on);
    gl.uniform1f(loc.skyOn, R.sky ? 1 : 0);
    gl.uniform1f(loc.reflGain, s.seaRefl || 0);
    gl.uniform1f(loc.reflBend, s.seaReflBend == null ? 26 : s.seaReflBend);
    gl.uniform2f(loc.reflVP, R.w || 1, R.h || 1);
    const st = s.skyTop || [0.35, 0.5, 0.7], sh = s.skyHorCol || s.hor || [0.6, 0.7, 0.8];
    gl.uniform3f(loc.skyTop, st[0], st[1], st[2]);
    gl.uniform3f(loc.skyHor, sh[0], sh[1], sh[2]);

    // ── THE LIGHTS THAT LIE ON THE WATER ──────────────────────────────────────────────────────
    //
    // ⚠ THE SAME LIST THE WALL WASH AND THE WET ROAD TAKE, arriving on the floor opts this pass is
    // already handed — nothing is collected for the sea and nothing is authored. world.js nulls
    // 'wetLights' for the floor on purpose (GROUND_FULL repaints over everything that term is
    // gated to), so the sea gets its own field rather than reviving that one.
    const nl = (s.seaNeon > 0 ? s.seaLights : null) || EMPTY_NEON;
    const nn = Math.min(NEON_MAX, nl.length);
    for (let i = 0; i < nn; i++) {
      // The record shape pickLights produces: p = ground point and height, r = reach.
      const L = nl[i];
      NEON_P[i * 4] = L.p[0]; NEON_P[i * 4 + 1] = L.p[1]; NEON_P[i * 4 + 2] = L.p[2]; NEON_P[i * 4 + 3] = L.r;
      // ⚠ 'rgbRaw', NEVER 'rgb' — the third reader to need this sentence, after the wet road and the
      // wet specular. 'rgb' is the colour AS A WALL WASH: scaled by that term's own gain and by the
      // night, so it is zero whenever the wash is off and small whenever it is turned down. A
      // reflection is not a wash and must not inherit its strength. Measured: with 'rgb' the streak
      // moved 0.000% of the frame at every gain, on a scene whose sixteen chosen lights all carried
      // a real 'rgbRaw' and a flat [0,0,0] 'rgb' — which reads exactly like a feature that is not
      // wired up, and is the same shape of failure install.js lists five times over.
      const c = L.rgbRaw || L.rgb;
      NEON_C[i * 3] = c[0]; NEON_C[i * 3 + 1] = c[1]; NEON_C[i * 3 + 2] = c[2];
    }
    gl.uniform1i(loc.neonN, nn);
    if (nn > 0) { gl.uniform4fv(loc.neonP, NEON_P); gl.uniform3fv(loc.neonC, NEON_C); }
    gl.uniform1f(loc.neonGain, nn > 0 ? (s.seaNeon || 0) : 0);
    // ⚠ THE VARIANCE IS DERIVED FROM THE LIVE WIND AND NOT FROM THE SEA STATE SCALAR. 'seaState' is
    // a reservoir with minutes of lag in it, which is right for wave HEIGHT — a sea takes time to
    // get up — and wrong for the slope of the ripples, which answer a gust immediately.
    const sv = seaSlopeVariance(s.seaKt || 0);
    gl.uniform2f(loc.sig2, sv.u, sv.c);
    // ⚠ COMPUTED ONCE PER FRAME IN windshield.js AND HANDED OVER, never re-derived here: the test is
    // 'seaHeight' at the camera against the camera's own z, and a second expression of it would be a
    // boundary that disagrees with the surface it is testing against.
    gl.uniform1f(loc.under, s.seaUnder || 0);
    gl.uniform1f(loc.underD, Math.max(0, s.seaUnderD || 0));
    gl.uniform1f(loc.underExt, s.seaUnderExt == null ? 1 : s.seaUnderExt);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);            // the sea is a solid surface: it hides what is under it
    gl.disable(gl.CULL_FACE);      // a trough seen from a crest shows the far side of the wave
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied, for the rim hand-off
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    return count / 3;
  }

  return { draw, get tris() { return count / 3; } };
}
