// GLASS 2's WebGL2 context: the mass pass, its shaders, and the layers drawn on its depth buffer.
//
// ⚠ It owns no geometry and no palette. Vertices come from `captureModelMesh` and colours from the
// caller (`WALL_COL`); two definitions of what a building looks like is the failure to avoid.
import { viewProjMatrix, mat4f } from './camera.js';
import { HEIGHT_FOG_GLSL, LIGHT_SHAFT_GLSL } from './fog.js';
import { createSpriteLayer } from './sprites.js';
import { createCurtainLayer } from './curtain.js';
import { createDecalLayer } from './decals.js';
import { createStrokeLayer } from './strokes.js';
import { createBillboardLayer } from './billboards.js';
import { createGroundLayer } from './ground.js';
import { createSolidsLayer } from './solids.js';
import { createFaunaLayer } from './fauna.js';
import { createActorLayer } from './actors.js';
import { createClothLayer } from './cloth.js';
import { createMurmurGPU } from './murmur-gpu.js';
// The interior's own clip range, in tiles (a cab is about 0.10 tile deep). See drawInterior.
const INTERIOR_NEAR = 0.004, INTERIOR_FAR = 1.0;
import { createFloorLayer } from './floor.js';
import { createWaterLayer } from './water.js';
import { createSeabedLayer } from './seabed.js';
import { createCloudLayer } from './clouds.js';
import { createCloudVolume } from './cloudvol.js';
import { createShadowLayer, SHADOW_BIAS_TILES } from './shadow.js';
import { createPropShadowLayer, PROP_SHADOW_GLSL, PROP_SHADOW_UNIFORMS, bindPropShadow } from './propshadow.js';
import { createSSAOLayer } from './ssao.js';
import { createHDRLayer } from './hdr.js';
import { createMirrorLayer } from './mirror.js';
import { createSkylineStrip } from './skyline.js';
// SSAO inverts depth back to tiles with the same clip constants the vertices went through.
import { NEAR, zRow } from './camera.js';
import { declareProgram, prewarmPrograms, layerProgram } from './programs.js';
import { linearOut, applyLinOut, LIN, linRgb } from './colour.js';
import { LIGHTGRID_GLSL, LIGHTGRID_UNIFORMS, createLightGridTextures, bindNoLightGrid, makeGroundGrid, buildGroundGrid } from './lightgrid.js';
import { createEnvCube, ENV_MAX_LOD } from './envcube.js';

// Floats per vertex: position 3, normal 3, colour 3, atlas uv 2, wall ramp 1, alpha 1, flat 1,
// haze jitter 1, baked occlusion 1, material family 1, edge distances 4.
const STRIDE = 21;

// The material table's size (windshield.js's MAT_ORDER, with headroom).
// ⚠ An index past this is undefined behaviour in GLSL ES, never a clamp: see `wallMaterialId`.
export const MAX_MATERIALS = 24;

// The cel look's ink (RENDER_TUNE.glInk): near black, a little blue, so it sits in the city's palette.
const INK_COL = [0.04, 0.04, 0.07];

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;
in vec2 aUV;
in float aRamp;
in float aAlpha;
in float aFlat;
// Which material family this surface belongs to, as an index into the tables below. Resolved once
// per model in world.js from the palette key the face already carries — see the ⚠ there on why a
// face with no palette takes 0 rather than -1.
in float aMat;
in float aJit;
in float aBakedAo;
// How far this vertex is from each of its own face's four edges, in tiles, ordered (-T, +T, -B, +B)
// against the tangent frame the fragment shader rebuilds from the normal. Linear in position, so
// barycentric interpolation reproduces the true distance field exactly — see faceEdges in world.js.
in vec4 aEdge;
uniform mat4 uViewProj;
// The kept mass's frame to the window's (RENDER_TUNE.massKeep, see uploadKept): 0 when the buffer
// was built in the window's own frame.
uniform vec2 uMassShift;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUV;
out float vRamp;
out float vDepth;
out float vAlpha;
out float vFlat;
out float vJit;
out float vBakedAo;
// ⚠ FLAT, BECAUSE A MATERIAL INDEX IS NOT A QUANTITY. Interpolating it would put fragments in the
// middle of a triangle at fractional indices, and every vertex of a face carries the same value
// anyway — so this is both cheaper and the only spelling that cannot round to the wrong family.
flat out float vMat;
out vec3 vWorld;
out vec4 vEdge;
void main() {
  vec3 P = aPos + vec3(uMassShift, 0.0);
  vec4 clip = uViewProj * vec4(P, 1.0);
  gl_Position = clip;
  vNormal = aNormal;
  vColor = aColor;
  vUV = aUV;
  vRamp = aRamp;
  vAlpha = aAlpha;
  vFlat = aFlat;
  vJit = aJit;
  vBakedAo = aBakedAo;
  vMat = aMat;
  vEdge = aEdge;
  vWorld = P;                   // the city own lights need a position to fall off FROM
  vDepth = clip.w;              // the camera-forward distance, in tiles — the same f GLASS sorts on
}`;

// ⚠ The compiled light ceiling, not the working count ('RENDER_TUNE.glLightSlots'); raising this alone
// changes nothing. Cost is lights filled. The limit is uniforms: 3·MAX_LIGHTS + 1 + 2·MAX_MATERIALS + 6
// vectors against WebGL2's guaranteed 224, so past 56 a floor-spec device gets no GL pass ('glCapabilities').
export const MAX_LIGHTS = 32;   // uniform slots, and the per-fragment loop CEILING

const FRAG = linearOut(`#version 300 es
precision highp float;
// How dark a fully shadowed surface goes, before the strength knob. See the ⚠ beside its use: the
// strength itself is already folded into shK, so this is the shape and RENDER_TUNE.glShadow is the
// dial. 0.45 is what the flat-face term used before this covered both halves.
const float SHADOW_DARK = 0.45;
// How hard the chamfer's own key-term delta lands on the surface, before the width knob. Same shape
// as SHADOW_DARK and for the same reason — see the ⚠ beside its use, where a term that only steered
// 'lit' came out monotonic, correct and invisible. Signed, so a chamfer turned toward the light
// brightens by the same amount one turned away darkens.
const float BEVEL_SHADE = 0.9;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUV;
in float vRamp;
in float vDepth;
in float vAlpha;
in float vFlat;
in float vJit;
in float vBakedAo;
flat in float vMat;
in vec3 vWorld;
in vec4 vEdge;
uniform sampler2D uAtlas;
uniform sampler2D uEnvStrip;   // one texel per bearing: rgb = the city there, a = how high it stands
uniform float uEnvCity;        // 0 = two flat colours, the environment as it shipped
uniform float uEnvDim;         // how far a reflected building is dimmed from its own palette
uniform float uTextured;
uniform vec3 uKeyDir;
uniform vec3 uKey;
uniform vec3 uShadow;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uVLight;
uniform float uNightDim;       // 1 - night * nightDark: the unlit city's share of the dark
uniform vec3 uSky;
uniform float uStr;
uniform float uFogAmt;
uniform float uHazeNear;
// The air at street level. See gl/fog.js — one function, three shaders, because the road and the
// wall standing on it must agree about how far you can see.
uniform float uFogH;
uniform float uFogHScale;
// How hard the air scatters a light back at you — see gl/fog.js. 0 is an exact off switch and it
// is 0 in clear weather by arithmetic, which is what makes the loop below free most of the time.
uniform float uScatter;
uniform float uHazeFar;
// Which part of the far dissolve this draw owns: 0 all of it (the mirror, a preview), 1 only what
// is fully opaque, 2 only what is dissolving. See drawFade.
uniform float uFadePass;
// The ground-to-air crossfade. The 2-D pass multiplies every world object by it and drops the
// object entirely below 0.02, which is how the Mode-7 city gives way to the flat airport scene
// as you settle onto the deck. The mass had no idea it existed and drew the real city at full
// opacity straight over the airport, on every landing.
uniform float uWorldBlend;
// ── THE CITY LIGHTS ITS OWN WALLS ───────────────────────────────────────────
//
// Every light in GLASS is already collected as a world point, a colour and an alpha — that is what
// the sprite layer draws. Up to now they were purely EMISSIVE: a neon sign was a bright shape in
// front of a wall that had no idea it was there, lit only by one key direction for the whole city.
// Feeding the same list in here costs no new authoring and no new content, and it is the difference
// between a sign hanging in front of a building and a sign bolted to one.
//
// ⚠ DIFFUSE ONLY, AND DELIBERATELY WEAK. This must read as a wash on the wall nearest the sign, not
// as a second sun: GLASS is a flat, chunky renderer and a specular highlight would look like a
// different game. The falloff is linear in distance rather than inverse-square for the same reason —
// inverse-square is physically right and blows out everything within a metre of a light.
// ⚠ AND IT NEVER DARKENS. The term is added after the key shading, so a scene with no lights is
// bit-identical to what shipped before — which is what makes this safe to leave on by default.
uniform int uNLight;
uniform vec3 uLightP[GLASS_MAX_LIGHTS];
uniform vec3 uLightC[GLASS_MAX_LIGHTS];
// The same lights with the wall wash own night weighting NOT folded in — see pickLights, where
// rgb carries it and rgbRaw does not. The wet specular has to read this one: with the wash reverted
// to gain 0 every entry of uLightC is literally [0,0,0], so a term multiplying it is multiplying by
// zero however correct it is. This is the wall reading the light the way the wet ROAD already does.
uniform vec3 uLightRaw[GLASS_MAX_LIGHTS];
uniform float uLightR[GLASS_MAX_LIGHTS];
uniform float uLightWrap;
// The lamp's share of the night: how far each light gives back what the night took away
// (uLightLR, its reach in tiles) and how strongly (uLampLift, 0 off). See the loop below.
uniform float uLightLR[GLASS_MAX_LIGHTS];
uniform float uLampLift;
// A sign's own light on its own wall (LIGHT_TUNE.sign; grid path only, see the grid loop below).
uniform float uSignLift;
// The falloff exponent over the reach. 2.0 is the broad wash this pass shipped with; above it the
// same energy moves in toward the source — a hot core, a fast edge, a faint tail. See LIGHT_TUNE.
uniform float uLightFocus;
uniform float uAo;      // contact-occlusion strength; 0 makes the term exactly 1.0
uniform float uAoFall;    // how fast it lets go with height, in inverse tiles
uniform float uBakedAo;   // strength of the PER-VERTEX bake; 0 makes that term exactly 1.0 too
// ── THE SUN'S OWN DEPTH BUFFER ──────────────────────────────────────────────
//
// See gl/shadow.js. 'uShadowStr' is the strength AND the off switch: at 0 the function below is
// never called, the key term is left exactly as it was, and the frame is the one that shipped.
// It defaults to 0 today — see the note on RENDER_TUNE.glShadow in windshield.js for what works
// and what does not.
uniform highp sampler2D uShadowMap;
uniform mat4 uLightVP;
uniform float uShadowStr;
uniform float uShadowTexel;
uniform float uShadowBias;
uniform vec3 uSunDir;
// What stands in the street, on its own near map (gl/propshadow.js, RENDER_TUNE.glPropShadow).
// uPropWall is its strength on a wall; uPropOn 0 skips the read and is the frame that shipped.
uniform highp sampler2D uPropMap;
uniform mat4 uPropVP;
uniform float uPropOn;
uniform float uPropTexel;
uniform float uPropBias;
uniform float uPropWall;
// ── WHAT THE SURFACE IS MADE OF ─────────────────────────────────────────────
//
// Until this existed every surface in the city answered the light identically: one half-lambert key
// and two overlay tints, for brick, sheet copper, curtain glass and weathered board alike. Which is
// why none of them has ever looked like the substance it is drawn as — a texture can say what a
// material LOOKS like and cannot say how it BEHAVES, and behaviour is most of what the eye reads
// "metal" from. Metal is view-dependence: a highlight that travels as you drive past, a reflection
// carrying the metal's own hue. Wood is the absence of it. Frost is it with the sharpness removed.
//
// 'uMat' is (gloss, metal, fres, bump) per family and 'uSheen' the fifth column, both authored in
// windshield.js beside the painters they belong to and handed over whole. 'uMatStr' is the master
// strength and the off switch: at 0 the entire block below is skipped on a UNIFORM branch, and the
// frame is bit-for-bit the one that shipped.
//
// ⚠ 'uEye' IS IN THE VERTEX FRAME, WHICH IS MAP-WINDOW TILES AND NOT WORLD TILES. world.js takes it
// off the SHIFTED camera for exactly that reason; see the ⚠ there.
uniform vec3 uEye;
// ── HOW DEEP THE SNOW LIES ─────────────────────────────────────────────────
//
// The third surface it reaches, after the terrain and the streets, and the one that puts it in
// the skyline rather than only underfoot. 0 makes every branch below unreachable on a uniform.
uniform float uSnow;
// How wet the city is: the same integrated 'WET_NOW' both ground layers read, times the feature's
// own strength, so 0 is provably the shader that shipped. See the wet block in main().
uniform float uWet;
// ⚠ TWO CONSTANTS RATHER THAN TWO UNIFORMS, because there is only ever one thing to turn: the
// STRENGTH rides on uWet itself (world.js multiplies it in, exactly as 'snow' does), and a second
// knob here would multiply into the first to make a number that means neither — the argument
// already recorded beside the bloom threshold.
// ⚠ AND THE DARKENING IS THE BIG ONE. A first cut at 0.15 darkening beside a large reflectivity
// gain read as a city dipped in varnish: what says WET from a cab is that the brick went a stop
// down, and the sheen is what says it afterwards, at a grazing angle, on the surfaces facing the
// light.
const float WET_DARKEN = 0.38;   // how far a saturated surface falls toward black
const float WET_REFL = 0.45;     // the reflectivity it gains on top of its own row
// How hard the city's own lights come back off a wet wall. See the note in the light loop: this is
// the night half of the feature, and the only one there is, because after dark the albedo is a
// small part of the pixel and the sky has nothing in it to reflect.
const float WET_NEON = 6.0;
// How tight that reflection is. 48 is polished glass and reads as a pinpoint on one building in
// the frame; most of this city is painted brick, render and plate, where standing water gives a
// broader sheen than a mirror does.
const float WET_LOBE = 28.0;
uniform float uMatStr;
uniform float uBumpStr;
uniform float uMetalRefl;
// How wide the shading bevel is, in tiles. 0 makes the whole term unreachable — the branch is on
// this uniform, so at 0 not one of the four comparisons below is evaluated.
uniform float uBevel;
// And how far the normal leans over across that width. Separate from the width because they say
// different things: the width is how big the chamfer is, this is how sharply it turns.
uniform float uBevelTilt;
// The screen-space occlusion resolved before this pass ran, and how hard it lands. 0 makes the
// lookup unreachable — the guard is on the strength, which is a uniform, so every fragment takes
// the same side of it and the term is provably absent rather than multiplying by a white texture.
uniform highp sampler2D uSsao;
uniform float uSsaoStr;
uniform vec2 uViewport;
// The cel look (RENDER_TUNE.glToon): the key light in uToonBands flat steps, the sun's shadow and
// the occlusion with hard edges, one tone per face. 0 skips every branch it guards.
uniform float uToon;
uniform float uToonBands;
// The cel look's ink lines (RENDER_TUNE.glInk), resolved in gl/ssao.js off the same depth prepass
// as the occlusion: r is detail, g is outline. 0 makes the lookup unreachable, as uSsaoStr does.
// uInkFade is where each fades, in tiles ahead: detail over x..y, outlines over z..w.
uniform highp sampler2D uInk;
uniform float uInkStr;
uniform vec4 uInkFade;
uniform vec3 uInkCol;
uniform vec4 uMat[GLASS_MAX_MAT];
uniform float uSheen[GLASS_MAX_MAT];
uniform float uSpec[GLASS_MAX_MAT];
uniform float uSpecStr;
// The two ends of the sky, for a reflection to land on. GLASS's sky IS a vertical gradient, so two
// colours and the reflected ray's elevation reproduce it without a cube map or a probe.
uniform vec3 uEnvUp;
uniform vec3 uEnvDn;
// One texel of the atlas page, for the relief taps. The page is repacked whenever the set of
// surfaces changes, so this is written from setAtlas rather than assumed.
uniform vec2 uAtlasTexel;
// The material page (RENDER_TUNE.glMatPage): the atlas's twin, same rects, so vUV reads both. r is
// glass coverage, g is lit coverage, b is 1 + the wall's family index, and b = 0 is "the page says
// nothing about this texel", where every term below falls back to what it did before the page.
uniform highp sampler2D uMatPage;
uniform float uMatPageOn;
uniform int uGlassMat;
// 1 when this layer shades in linear light (RENDER_TUNE.glLinear 2, stage 2 step 2): the albedo,
// the vertex colour, the snow and the skyline strip are decoded here, the uniform colours were
// decoded before upload, and the output is already linear so glassOut leaves it alone.
uniform float uLinIn;
// A factor tuned on display values, as linear light. A display factor k darkens what the eye sees by
// k, and in linear light that is about k^2.2; at level 2 every darkening multiplier below goes
// through this so B keeps A's contrast. 1.0 at level 0, where k is returned as it is.
float lf(float k) { return uLinIn > 0.5 ? pow(max(k, 0.0), 2.2) : k; }
// Stage 3 (docs/proposals/glass-materials.md). uEnvCube is the sky as a cube (gl/envcube.js), sampled
// along the reflected ray at a level picked by roughness; uGGX swaps the Phong highlight for a GGX
// lobe. Both 0 is the reflection and highlight as shipped.
// Stage 4: the surface page (height in r, a roughness scale in g, b = 255 where it speaks), and the
// gain from height to the relief's units.
uniform highp sampler2D uSurfPage;
uniform float uSurfPageOn;
uniform float uHeightGain;
uniform samplerCube uEnvCube;
uniform float uEnvCubeOn;
uniform float uEnvMaxLod;
uniform float uGGX;
out vec4 outColor;

// Perceptual-ish luminance. The relief term reads the albedo as a height field, and a green mortar
// joint and a red one are the same depth of joint.
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// ── CEL STEPS ───────────────────────────────────────────────────────────────
// x rounded to the nearest of n even steps, and a hard step at an edge. Each edge is about a pixel
// wide, from the value's own rate of change across the pixel, so a band on a curve is antialiased
// rather than stair-stepped. ⚠ The width has a floor: on a flat face the value doesn't change,
// fwidth is 0, and smoothstep with equal edges is undefined. ⚠ Only call these behind a uniform
// branch (uToon), for the derivative reason sunShadow gives.
float toonBands(float x, float n) {
  float y = x * n;
  float w = max(fwidth(y), 1e-4);
  float i = floor(y);
  return (i + smoothstep(0.5 - w, 0.5 + w, y - i)) / n;
}
float toonStep(float edge, float x) {
  float w = max(fwidth(x), 1e-4);
  return smoothstep(edge - w, edge + w, x);
}
// Where the occlusion turns into the cel look's one step of shade, and how dark that step is.
const float TOON_AO_CUT = 0.85;
const float TOON_AO_DARK = 0.72;
// How dark the cel look's shade side is, on a face turned fully from the key.
const float TOON_SHADE = 0.7;

// 1.0 where the sun cannot see this point, 0.0 where it can.
//
// ⚠ NO PER-FRAGMENT BRANCH AROUND THE SAMPLES, AND NO IMPLICIT LOD. This function was first written
// the obvious way — an early return for a point outside the light's box, then four plain texture()
// calls — and that is UNDEFINED BEHAVIOUR, not a style question. A plain texture() picks its mip
// from screen-space derivatives, which are computed across a quad of four fragments; put one behind
// a test that some of those four fail and the derivative is taken over fragments that never ran.
// On this driver it came back NaN, and a NaN here is not a missing shadow: it poisons the key term,
// then the whole colour, and the building is painted BLACK at full alpha with the right silhouette.
//
// ⚠ THAT BUG IS FIXED AND THE SYMPTOM OUTLIVED IT, WHICH IS WHY THE KNOB STILL DEFAULTS TO 0. The
// picture is bit-identical at strength 0.35 and at 1.0 while getUniform reads both values back out
// of the live program — a term that does not respond to its own strength is not a shading value,
// it is a mask, and a mask over 93% of the city is a black city. See the note on RENDER_TUNE
// .glShadow in windshield.js for the full list of what has been ruled out. The two cheap checks
// worth keeping from it: a result that ignores its strength is arithmetic, not tuning, and a
// symptom that survives skipping the pass that produces the input is not about that pass.
//
// So: the samples are unconditional, the LOD is stated (there is one level; there is nothing to
// choose), and being outside the box multiplies the ANSWER by zero instead of skipping the work.
float sunShadow(vec3 wp, vec3 n) {
  vec4 ls = uLightVP * vec4(wp, 1.0);
  vec3 p = ls.xyz * 0.5 + 0.5;              // ortho, so w is 1 and there is no divide
  // ⚠ OUTSIDE THE BOX IS LIT, NEVER SHADOWED. The ortho box is fitted to the mesh, so every CASTER
  // is inside it — but a fragment being SHADED can sit outside, and answering anything other than
  // lit there is a hard-edged rectangle of darkness around the city with nothing casting it.
  float inside = (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) ? 0.0 : 1.0;
  // Slope-scaled: a surface nearly edge-on to the light crosses many texels' worth of depth inside
  // one texel of the map, which is where acne comes from and where a flat bias cannot reach.
  float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
  float r = clamp(p.z - uShadowBias * (1.0 + 3.0 * (1.0 - ndl)), 0.0, 1.0);
  vec2 uv = clamp(p.xy, 0.0, 1.0);
  float t = uShadowTexel;
  // Four taps averaged by hand — percentage-closer filtering without the hardware compare sampler.
  // 'step(r, d)' is 1 where the stored depth is at or beyond this fragment, which is to say lit.
  float s = step(r, textureLod(uShadowMap, uv + vec2(-0.5, -0.5) * t, 0.0).r)
          + step(r, textureLod(uShadowMap, uv + vec2( 0.5, -0.5) * t, 0.0).r)
          + step(r, textureLod(uShadowMap, uv + vec2(-0.5,  0.5) * t, 0.0).r)
          + step(r, textureLod(uShadowMap, uv + vec2( 0.5,  0.5) * t, 0.0).r);
  return (1.0 - s * 0.25) * uShadowStr * inside;
}
${PROP_SHADOW_GLSL}
${HEIGHT_FOG_GLSL}
${LIGHT_SHAFT_GLSL}
// The light grid (gl/lightgrid.js, RENDER_TUNE.glCluster). Declared here rather than in the chunk,
// because glsl-smoke can't see into an imported snippet. Units 8 to 10.
uniform highp sampler2D  uLGLight;
uniform highp usampler2D uLGCell;
uniform highp usampler2D uLGIdx;
uniform int   uLGOn;
uniform vec2  uLGOrigin;
uniform float uLGInv;
uniform ivec2 uLGDim;
${LIGHTGRID_GLSL}
// ⚠ PROTOTYPES, because linearOut (gl/colour.js) splices the colour helpers in just before main(),
// which is after this function: without them the program doesn't compile and the city falls back
// to 2-D on every machine.
vec3 glassLin(vec3 c);
vec3 glassSrgb(vec3 c);
// One light on a wall: the lamp lift, the wash and the wet lobe. The body is the loop body this used
// to be, with uLightP[i], uLightRaw[i], uLightC[i], uLightR[i], uLightLR[i] as P, raw, C, R, LR.
// Its reach is the larger of R and LR, which is the disc gl/lightgrid.js bins it by (mass mode).
void massLight(vec3 P, vec3 raw, vec3 C, float R, float LR, vec3 n, vec3 Vw, float wetW, inout vec3 lamp, inout vec3 base) {
  vec3 d = P - vWorld;
  float dist = length(d);
  float la = clamp(1.0 - dist / max(0.001, LR), 0.0, 1.0);
  // The lift's weight was tuned on display colours, so it reads them back at level 2.
  // White lift: a neon sign colours its own glass, not the wall round it.
  lamp += vec3(dot(uLinIn > 0.5 ? glassSrgb(raw) : raw, vec3(0.299, 0.587, 0.114))) * (la * la * max(0.0, (dot(n, d / max(0.001, dist)) + 0.5) / 1.5));
  float att = clamp(1.0 - dist / max(0.001, R), 0.0, 1.0);
  if (att <= 0.0) return;
  // ⚠ WRAPPED, AND MEASURED INTO IT RATHER THAN CHOSEN. Straight lambert is the obvious term and
  // it lights almost nothing here: the commonest light in GLASS is a sign mounted FLUSH on the
  // wall behind it, so the direction from that wall to the light is nearly perpendicular to its
  // own normal and the cosine is ~0. Measured, a pure cosine moved 0.5% of the wall pixels in a
  // dense night frame — a feature that draws nothing and looks like restraint. 'uLightWrap' is
  // how far round the light reaches; 0 is exactly lambert, so the term the shader shipped with
  // is still expressible and still in the file.
  float diff = max(0.0, (dot(n, d / max(0.001, dist)) + uLightWrap) / (1.0 + uLightWrap));
  // ⚠ SHAPED, AND THE SHAPE IS MOST OF WHAT SEPARATES A BLOOM FROM A TINT. Linear-clamped and
  // squared is a broad soft field: half way out it still carries a quarter of the peak, which
  // over the reach this pass used to be given was a quarter of the light seven storeys up a
  // facade. At uLightFocus 2.0 this line is exactly the term that shipped.
  // ⚠ ONE FALLOFF, SPENT TWICE. 'pow(att, uLightFocus)' is the same number for this term and for
  // the wet lobe below, and it was evaluated once for each — a second pow per light per fragment,
  // over up to GLASS_MAX_LIGHTS lights, on every pixel of every wall in the city. The arithmetic
  // is unchanged; it is the same value read twice instead of computed twice.
  float fall = pow(att, uLightFocus);
  base += C * (fall * diff);
  // ── AND THE SAME LIGHT AGAIN, IN THE WATER ON THE WALL ────────────────────
  //
  // The albedo darkening above is most of what says WET by day and almost nothing at night, and
  // the measurement is blunt about it: 7.68% of a daylight frame moves and 0.09% of a night one.
  // The reason is not the wall wash being off (tested — turning it back on moves this number by
  // nothing). It is that after dark the wall's own albedo is a small part of the final pixel:
  // most of what you see is the neon ADDED on top, and darkening what is underneath an addition
  // does not change it. What a wet wall does at night is REFLECT that neon, and reflection is the
  // one thing water adds to a surface.
  //
  // ⚠ MULTIPLIED BY wetW, NEVER BRANCHED ON IT. wetW is per fragment, and a per-fragment branch
  // here is exactly the undefined behaviour the note at the top of the material block is written
  // around. Dry, this whole term is zero by arithmetic.
  //
  // ⚠ AND THE "A LOBE ON A FLAT BOX IS NOT A HIGHLIGHT" OBJECTION DOES NOT APPLY TO THESE LIGHTS,
  // which is the whole reason it is worth having. That objection is about the SUN: one direction
  // for the entire city, so a lobe evaluated across a planar face has one value and simply paints
  // the wall lighter. A sign is a metre from the bricks it is bolted to, so the direction to it
  // swings hard across the face and the lobe lands as a hot spot beside the sign — which is what
  // a wet wall under neon actually looks like.
  //
  // ⚠ IT IS NOT THE WALL WASH COMING BACK. That was reverted five times for flattening a facade,
  // and it flattened because it was DIFFUSE — a broad field over the whole wall. This is a tight
  // lobe gated on standing water, so it cannot reach a dry frame at all.
  // ⚠ A UNIFORM BRANCH, NOT A PER-FRAGMENT ONE — which is the distinction the note above is
  // drawing rather than a rule against branching here at all. What it forbids is branching on
  // 'wetW', which varies per fragment; 'uWet' is a uniform, so this is the same shape as the
  // 'uScatter' gate a few lines down and a dry frame simply does not run the lobe. Dry, the term
  // was already zero BY ARITHMETIC — it was paying a normalize, a dot and a pow per light per
  // fragment to arrive at that zero, on every pixel of every wall, which in a district of tall
  // towers is most of the frame. The wet frame is unchanged to the bit.
  if (uWet > 0.001) {
    vec3 Hl = normalize(d / max(0.001, dist) + Vw);
    base += raw * (pow(max(0.0, dot(n, Hl)), WET_LOBE) * WET_NEON * wetW * fall);
  }
}
void main() {
  // ⚠ THE FAR DISSOLVE IS SPLIT ACROSS TWO DRAWS, because the floor and the roads are drawn AFTER
  // this pass and test against its depth. A building at 20% opacity in the haze band still wrote
  // its whole silhouette into the depth buffer, so the ground behind it was rejected and what
  // showed through the other 80% was the bare canvas under the GL buffer: a dark green cut-out of
  // every block at the edge of the draw distance. Pass 1 leaves the band out of the buffer; pass 2
  // draws it after the ground, blended over what is really there. Same expression as 'a' below.
  if (uFadePass > 0.5) {
    float hz = 1.0 - smoothstep(uHazeNear - vJit, uHazeFar - vJit, vDepth);
    if (uFadePass < 1.5 ? hz < 0.999 : (hz >= 0.999 || hz < 0.004)) discard;
  }
  // ⚠ TWO NORMALS, AND THE DIFFERENCE IS LOAD-BEARING. 'n0' is the geometric one the face was built
  // with; 'n' is that with the relief below folded into it. Everything that shades takes 'n'. The
  // shadow bias takes 'n0', because a slope-scaled bias is a statement about the real surface's
  // angle to the light and a bumped normal would jitter it into acne.
  vec3 n0 = normalize(vNormal);
  vec3 n = n0;
  // 1 for a wall, 0 for the flat adornment layer — hoisted, because the relief needs it too.
  float solid = 1.0 - clamp(vFlat, 0.0, 1.0);
  // ── A THIRD ANSWER: ITS OWN COLOUR, LIT LIKE A WALL (aFlat 2) ─────────────────
  //
  // A flat face (1) is its own colour and nothing else; a solid one (0) is the atlas, lit. A drum
  // needs neither: its colour is the arm's (a hand-picked ramp carrying the tile's Halcyon cast)
  // and it has no texture a curve can wear, but it does want the sun, the shadow, the environment
  // reflection and its material row. So a face marked 2 is SOLID to every lighting term and takes
  // vColor as its albedo. 'texW' is the one thing that differs, and every read of the atlas takes it.
  float litOwn = step(1.5, vFlat);
  solid = max(solid, litOwn);
  float texW = clamp(uTextured, 0.0, 1.0) * solid * (1.0 - litOwn);
  // ── AND WHAT IS LYING ON IT ─────────────────────────────────────────────────
  //
  // ⚠ n0, NEVER n. Snow is placed by GRAVITY against the real surface, and n is that surface with
  // the albedo-recovered relief and the shading bevel folded into it — so taken off n, a brick
  // wall collects snow in its mortar joints and every chamfered corner in the city grows a white
  // line down it. This is the same distinction, for the same reason, that the shadow bias one
  // block up is written around.
  //
  // ⚠ AND THE PITCH IT WILL HOLD RISES WITH THE DEPTH, which is one expression and is most of
  // what makes this read as weather rather than as white paint: a dusting sits only on what is
  // dead flat, and it takes a real fall before a pitched roof, a canted parapet or a sloped canopy
  // holds any. Written as a fixed threshold instead, every roof in Coldwater turns white together
  // at the same moment, which is the one thing snow visibly does not do.
  // ── HOW WET THIS SURFACE IS ─────────────────────────────────────────────────
  //
  // ⚠ n0, NEVER n — the same rule snow is written around one block down, and for the same physical
  // reason: rain arrives by gravity against the REAL surface, and n carries the albedo-recovered
  // relief, so taken off it a brick wall would run wet in its mortar joints alone.
  //
  // ⚠ AND A SOFFIT STAYS DRY, which is the whole of what makes this read as rain rather than as a
  // filter over the city. Rain falls DOWN: a flat roof, a sill, a coping and a parapet hold water,
  // a wall takes a share of it, and the underside of a canopy, an awning, a balcony or an arch is
  // sheltered and stays the colour it was. That is one expression, and it is the cheapest
  // believable thing in the whole term — a dry soffit over a wet pavement is what a photograph of
  // a rained-on street actually looks like.
  //
  // ⚠ AND IT IS solid, so the flat adornment layer is left alone. Those quads are painted by the
  // 2-D renderer as one fill with no texture and no light ramp; wetting them would be improving on
  // GLASS rather than reproducing it, which is the rule the whole material block opens with.
  float wetW = uWet > 0.001 ? uWet * clamp(0.55 + 0.60 * n0.z, 0.0, 1.0) * solid : 0.0;
  // The eye, needed by the material block AND by the wet specular down in the light loop.
  vec3 Vw = normalize(uEye - vWorld);
  float snowW = 0.0;
  if (uSnow > 0.001) {
    float lo = mix(0.97, 0.18, uSnow), hi = mix(1.02, 0.46, uSnow);
    snowW = smoothstep(lo, hi, n0.z);
    // A coarse world-phased break so a long parapet is not one even ribbon. Deliberately weak:
    // wind scours a roof unevenly, it does not dapple it.
    float g = sin(vWorld.x * 3.1 + 1.7) * sin(vWorld.y * 2.7 - 0.9);
    snowW = clamp(snowW * (0.88 + 0.12 * g) , 0.0, 1.0);
  }
  // ── RELIEF, RECOVERED FROM THE ALBEDO'S OWN GRADIENT ────────────────────────
  //
  // The painters bake their own light: matPlate draws a dark line under every lap and a bright one
  // above it, matStone shadows each joint, matConcrete rules its board lines. All of that is correct
  // for ONE sun angle and frozen at it — the joints on a wall do not move as the day goes round, and
  // at dusk they are lit from a direction the sky no longer is.
  //
  // A height field would fix it properly and there is no height field. What there is, is a texture
  // whose bright parts are mostly the parts that stick out and whose dark parts are mostly the parts
  // that are recessed — so the luminance gradient is a usable normal map, for free, with no second
  // atlas page and no change to any painter.
  //
  // ⚠ IT IS A LIE ON ANY SURFACE WHOSE COLOUR IS NOT ITS SHAPE, which is why the strength is a
  // per-family column rather than a constant: soot on brick, rust bleeding from under a rivet lap,
  // the near-black openings of a lattice truss. The lattice row is 0.20 for exactly that reason.
  //
  // ⚠ AND IT HAS TO HAPPEN BEFORE THE KEY TERM, WHICH IS THE WHOLE POINT AND WAS GOT WRONG FIRST.
  // It was written inside the material block below, where it perturbed a normal 'lit' had already
  // been computed from — so it reached the reflection and the specular and NOT the diffuse shading,
  // which is the only place a mortar joint or a plate lap actually shows. It measured as 25.2% of
  // wall pixels moved without it and 24.1% with it: a term that is correct, tunable, wired at both
  // ends, and inside the noise. __glMaterials() sweeps it separately for that reason.
  //
  // ⚠ AND textureLod, NEVER texture. This is inside a branch, and a plain texture() picks its mip
  // from screen-space derivatives taken across a quad of fragments — put one behind a test that some
  // of that quad fails and the result is undefined. The atlas has exactly one level, so stating it
  // costs nothing and removes the whole class. See sunShadow for what a NaN here is worth.
  // ⚠ THE TANGENT FRAME IS HOISTED BECAUSE TWO TERMS NEED IT AND THEY MUST AGREE. The relief below
  // reads the atlas along T and B; the bevel under it leans the normal along T and B; and
  // 'faceEdges' in world.js measured the edge distances in this same frame. Three copies of one
  // convention, and the one that can go wrong silently is the bevel — a frame that disagreed with
  // the JS would put the near edge on one axis and the lean on the other, which does not read as a
  // broken bevel, it reads as walls lit from a direction the sun is not.
  vec3 up = vec3(0.0, 0.0, 1.0);
  vec3 T = cross(up, n0);
  float tl = length(T);
  // A horizontal face — a roof, a canopy — has no horizon to take a tangent from, so it takes a
  // fixed one. Which axis hardly matters; what it must not be is the zero vector.
  T = tl > 0.001 ? T / tl : vec3(1.0, 0.0, 0.0);
  vec3 B = cross(n0, T);
  // ── WHAT THE TEXEL IS MADE OF (RENDER_TUNE.glMatPage) ──────────────────────
  //
  // Read once, here, because three terms below want it: the relief, the material row and the night
  // dim. ⚠ textureLod in a uniform branch, for the relief taps' reason. With the page off, 'mpg' is
  // zero, so 'pageK' is zero, 'wallMat' is vMat and every term reduces to the line it replaced.
  vec4 mpg = vec4(0.0);
  if (uMatPageOn > 0.5) mpg = textureLod(uMatPage, vUV, 0.0);
  // A texel the page speaks for: b is 1 + the family, so anything under half a step is silence.
  // Times texW, because a flat face samples an atlas entry it doesn't use.
  float pageK = step(0.5, mpg.b * 255.0) * step(0.5, texW);
  // ⚠ CLAMPED, because an index past the table is undefined behaviour, not a clamp (see uMat).
  int wallMat = pageK > 0.5 ? clamp(int(mpg.b * 255.0 + 0.5) - 1, 0, GLASS_MAX_MAT - 1) : int(vMat + 0.5);
  float glassK = mpg.r * pageK;
  // The surface page, read once for the relief and the roughness. 0 where it says nothing.
  vec4 spg = vec4(0.0);
  if (uSurfPageOn > 0.5) spg = textureLod(uSurfPage, vUV, 0.0);
  float surfK = step(0.5, spg.b) * step(0.5, texW);
  if (uMatStr > 0.0 && uBumpStr > 0.0) {
    // ⚠ AND THE SNOW BURIES IT. The relief is recovered from the ALBEDO, and under snow the albedo
    // is snow — so leaving this standing embosses the brickwork of the wall underneath onto the
    // drift lying on the ledge. Same argument as the floor mixing its material toward the hillshade
    // rather than toward flat white: what goes is the texture, not the shape.
    // And the cel look has none: its faces are flat by definition.
    float k = uMat[wallMat].w * uBumpStr * texW * (1.0 - snowW) * (1.0 - uToon);
    // ⚠ NO RELIEF WHERE ANY OF THE THREE TAPS IS GLASS. A pane is the biggest step in value on a
    // facade, and the relief reads value as height, so a wall texel beside a lit window embossed a
    // ridge round it. That is why 'window grid' bump had to stay at 0.18; with the page on, the
    // wall takes its own family's bump and the panes take none.
    if (uMatPageOn > 0.5) {
      float gu = textureLod(uMatPage, vUV + vec2(uAtlasTexel.x, 0.0), 0.0).r;
      float gv = textureLod(uMatPage, vUV + vec2(0.0, uAtlasTexel.y), 0.0).r;
      k *= 1.0 - max(mpg.r, max(gu, gv)) * pageK;
    }
    float l0 = lum(textureLod(uAtlas, vUV, 0.0).rgb);
    float lu = lum(textureLod(uAtlas, vUV + vec2(uAtlasTexel.x, 0.0), 0.0).rgb);
    float lv = lum(textureLod(uAtlas, vUV + vec2(0.0, uAtlasTexel.y), 0.0).rgb);
    // ⚠ WHERE THE SURFACE PAGE SPEAKS, THE RELIEF READS HEIGHT, NOT BRIGHTNESS. Brightness is the
    // day-night blend of a painting, so the joints moved with the hour and a stain read as a bump;
    // height is the painter's own geometry and holds still. Same three taps, on the other page.
    if (uSurfPageOn > 0.5) {
      float hu = textureLod(uSurfPage, vUV + vec2(uAtlasTexel.x, 0.0), 0.0).r;
      float hv = textureLod(uSurfPage, vUV + vec2(0.0, uAtlasTexel.y), 0.0).r;
      l0 = mix(l0, spg.r * uHeightGain, surfK);
      lu = mix(lu, hu * uHeightGain, surfK);
      lv = mix(lv, hv * uHeightGain, surfK);
    }
    // Bright is proud, so the normal tilts AWAY from the brighter neighbour. v runs down the face in
    // this atlas, which is why the B term is subtracted rather than added.
    n = normalize(n0 - (T * (lu - l0) - B * (lv - l0)) * (k * 6.0));
  }
  // ── THE CHAMFER ON EVERY EDGE IN THE CITY ───────────────────────────────────
  //
  // Nothing here is built with an arris. Every box meets its neighbour at a hard 90°, so there is
  // no surface anywhere on a building turned part-way toward the light — which is why the specular
  // note above had to conclude that a highlight on a flat box is not a highlight. A real building
  // has a few centimetres of chamfer on every corner, and that chamfer is the bright line running
  // down the edge of every masonry corner ever photographed.
  //
  // ⚠ NORMALS ONLY. Not one vertex moves, so the mesh still agrees face-for-face with the shape the
  // building COLLIDES as ('gl:mesh'), the occluder hull is untouched, and the face budget does not
  // move at all. A real inset chamfer costs about five times the faces and breaks that agreement.
  //
  // ⚠ AND IT IS BRANCHLESS INSIDE THE UNIFORM GUARD. 't' is 0 for every fragment further from an
  // edge than the bevel is wide, so the added term is the zero vector and 'n' comes back untouched
  // — which is the same arithmetic off-switch the two occlusion terms use, rather than a per
  // fragment jump. At uBevel 0 the guard is a uniform and nothing inside is reached at all.
  float bevelK = 0.0;
  if (uBevel > 0.0) {
    float d = min(min(vEdge.x, vEdge.y), min(vEdge.z, vEdge.w));
    // Squared, so the lean eases in rather than creasing at the inner limit of the chamfer.
    float t = clamp(1.0 - d / uBevel, 0.0, 1.0);
    // Which edge is nearest decides which way the surface turns. ⚠ Selected by comparison rather
    // than by a chain of ifs, which also handles a CORNER correctly for free: where two distances
    // tie, both terms fire and the normal leans diagonally, which is what a real corner does.
    vec3 dir = (-T) * step(vEdge.x, d) + T * step(vEdge.y, d)
             + (-B) * step(vEdge.z, d) + B * step(vEdge.w, d);
    vec3 nb = normalize(n + dir * (t * t * uBevelTilt));
    // ⚠ AND THE CHAMFER HAS TO DARKEN AND BRIGHTEN THE SURFACE, NOT ONLY STEER THE KEY TERM. This
    // is the trap already written up on uShadowStr, one term along, and it caught this one too:
    // everything a normal does here reaches a wall through 'lit', whose only consumers are two
    // OVERLAY ALPHAS running 0.06-0.20 and 0.30-0.52. Measured end to end that way, a full 45°
    // chamfer moved 1.1% of a cab frame's wall pixels by a mean of 3 of 255 — correct, monotonic,
    // free, and very nearly invisible, which is word for word what the sun's shadow did.
    //
    // So the key-term DELTA the chamfer causes is applied to 'base' directly, the way the shadow
    // and both occlusion terms already are. ⚠ Signed, unlike those three: an edge turned toward the
    // light gets brighter and one turned away gets darker, and a chamfer that could only darken
    // would read as a dirty line down every corner rather than as a cut one.
    bevelK = (dot(nb, normalize(uKeyDir)) - dot(n, normalize(uKeyDir))) * 0.5;
    n = nb;
  }
  float lit = clamp(0.5 + dot(n, normalize(uKeyDir)) * 0.5, 0.0, 1.0);
  // ⚠ THE SHADOW LANDS ON the KEY TERM, AND THAT IS THE FAITHFUL PLACE FOR IT. lit is the half-lambert
  // of the key, and it is the only thing the warm top overlay, the cool base overlay and their two
  // alphas are built from — so a surface the sun cannot see is one whose key term is 0, which is
  // the deep shadow side of GLASS's own palette rather than a new colour invented here. It also
  // makes the off switch exact: at strength 0 this line is lit = mix(lit, 0.0, 0.0).
  // ⚠ THE GUARD IS ON A UNIFORM, WHICH IS THE ONE KIND OF BRANCH THAT IS SAFE HERE. Every fragment
  // in the quad takes the same side of it, so nothing inside is evaluated on a lane that did not
  // run. It is also what makes the off switch free rather than merely exact: at strength 0 the four
  // samples are not taken at all.
  float shKraw = uShadowStr > 0.0 ? sunShadow(vWorld, n0) : 0.0;
  // ⚠ AND THE ANSWER IS SANITISED WITH A COMPARISON, NOT WITH clamp. Every comparison against NaN
  // is false by definition, so '> 0.0' rejects one where clamp — which is min(max(x,0),1) — is
  // left to whatever the driver does with NaN, and on this one it leaks. A NaN reaching the key
  // term does not make a dark building, it makes a BLACK one at full alpha: the shadow value is
  // the single most dangerous number in this shader, and it is cheaper to make it impossible than
  // to prove the four things upstream of it can never produce one.
  float shK = shKraw > 0.0 ? min(shKraw, 1.0) : 0.0;
  // A post or a person between the sun and the wall: the darker of the two maps, never the sum, so
  // a post standing in a building's shadow adds nothing to it. propShadow sanitises as shK does.
  if (uPropOn > 0.0) shK = max(shK, propShadow(vWorld) * uPropWall);
  // ── THE CEL LOOK'S LIGHT (RENDER_TUNE.glToon) ───────────────────────────────
  // The key term in a few flat steps, and the sun's shadow with a hard edge at half coverage (the
  // map's four taps give five levels; see sunShadow). shK carries uShadowStr, so it's divided out
  // for the step and put back.
  if (uToon > 0.0) {
    lit = mix(lit, toonBands(lit, uToonBands), uToon);
    if (uShadowStr > 0.0) shK = mix(shK, toonStep(0.5, shK / uShadowStr) * uShadowStr, uToon);
  }
  lit = mix(lit, 0.0, shK);
  // The palette colour is what a flat-shaded face gets; the atlas is what a textured one gets.
  // Mixed rather than branched because a branch here is a branch per fragment, and the untextured
  // path exists only for the silhouette comparison.
  // ⚠ A FLAT FACE IS ITS OWN COLOUR AND NOTHING ELSE. The panels, bands, louvres and coping the
  // adornments are made of are painted by the 2-D renderer as ONE fill — no wall texture, no light
  // ramp — so a shader that helpfully textured and shaded them would not be reproducing GLASS, it
  // would be improving on it, which is the one thing a port must not do.
  // ── ⚠ AND A HOLE IN THE ATLAS IS A HOLE IN THE CITY ────────────────────────
  // Every other surface in the page is opaque, so this alpha is 1 everywhere except on a cut
  // lattice, where 'matLattice' leaves the openings unfilled. Discarding there is what makes a
  // truss see-through, and it is an ALPHA TEST rather than a blend on purpose: a discarded
  // fragment writes no depth, so the sun-shadow and SSAO prepasses — which run this same program,
  // the only one in this file — inherit the holes for free and no sorting changes.
  // ⚠ IT IS GATED ON 'solid' AND ON THE TEXTURE MIX, or a flat-shaded adornment sampling an atlas
  // entry it does not use would discard on somebody else's alpha.
  vec4 atl = texture(uAtlas, vUV);
  if (texW > 0.5 && atl.a < 0.5) discard;
  // Decoded before the mix, because the mix is the start of the lighting (see uLinIn).
  vec3 surf = uLinIn > 0.5 ? mix(glassLin(vColor), glassLin(atl.rgb), texW) : mix(vColor, atl.rgb, texW);
  // ⚠ HERE, AND NOT AFTER THE SHADING, WHICH IS THE WHOLE REASON THIS IS THREE LINES INSTEAD OF
  // THIRTY. Everything below composes a lit surface out of surf — the two overlays, the sun
  // shadow, the chamfer, both occlusion terms, the screen-space pass and then the point lights.
  // Substituting the albedo before any of that runs means snow is darker in shadow, darker down an
  // alley, darker under a canopy and lit by the neon bolted above it, with not one of those terms
  // knowing it exists. Mixed in at the end it would be a flat white decal over all of them.
  surf = mix(surf, uLinIn > 0.5 ? glassLin(vec3(0.90, 0.93, 0.98)) : vec3(0.90, 0.93, 0.98), snowW);
  // ── AND WHAT IS RUNNING DOWN IT ─────────────────────────────────────────────
  //
  // The city has had wet ground since the tarmac pass and nothing above the kerb has ever got wet:
  // it rains on Coldwater and the buildings stay the colour they are in July. WET_NOW is already
  // integrated, already classified and already handed to both ground layers — this is the same
  // scalar reaching the third one, which is exactly how uSnow got here.
  //
  // ⚠ DARKER IS THE EFFECT. Water fills a surface's own microstructure and traps the light that
  // scatters back out of it, so a wet brick wall is most of a stop down on a dry one. That is the
  // term you can see from a cab; the gloss below is the second-order one, and a first cut that led
  // with the gloss read as a city dipped in varnish.
  //
  // ⚠ AND IT IS SUBSTITUTED IN THE ALBEDO FOR THE REASON THE LINE ABOVE IS. Everything below
  // composes a lit surface out of surf, so a wet wall is darker in shadow, darker down an alley
  // and still lit by the sign bolted to it, with no term here knowing any of that exists.
  surf *= lf(mix(1.0, 1.0 - WET_DARKEN, wetW));
  // wallLit's own two overlays, per fragment instead of as a canvas gradient: a warm top tinted
  // between sky and key by the light dot, and a darker base, both at alphas that depend on that
  // same dot. A flat tint is what this looked like before, and a flat tint reads as a wall painted
  // a lighter colour rather than a wall standing in light.
  // ⚠ AT LEVEL 2 THE OVERLAYS RUN ON DISPLAY VALUES AND THE RESULT IS DECODED. A mix toward a
  // colour has no exact linear twin: the same alpha in linear light weighs a dark target less, and
  // every wall came out lighter and flatter. Encoding, mixing as A does and decoding gives exactly
  // A's base, and the light added after it (lamps, highlights, reflection) still adds as light.
  vec3 surfD = uLinIn > 0.5 ? glassSrgb(surf) : surf;
  vec3 skyD = uLinIn > 0.5 ? glassSrgb(uSky) : uSky;
  vec3 keyD = uLinIn > 0.5 ? glassSrgb(uKey) : uKey;
  vec3 shadowD = uLinIn > 0.5 ? glassSrgb(uShadow) : uShadow;
  vec3 topCol = mix(skyD, keyD, lit);
  float aTop = uStr * (0.06 + 0.14 * lit);
  float aBot = uStr * (0.30 + 0.22 * (1.0 - lit));
  // A cel face is one tone, so the ramp goes to its middle on a wall and to its top on a roof, where
  // a horizontal face's ramp already sits.
  float ramp = clamp(vRamp, 0.0, 1.0);
  if (uToon > 0.0) ramp = mix(ramp, 0.5 * (1.0 - abs(n0.z)), uToon);
  vec3 shaded = mix(mix(surfD, topCol, aTop), mix(surfD, shadowD, aBot), ramp);
  vec3 base = mix(surfD, shaded, clamp(uVLight, 0.0, 1.0) * solid);
  if (uLinIn > 0.5) base = glassLin(base);
  // ⚠ THE SHADOW HAS TO DARKEN THE SURFACE, NOT ONLY STEER THE KEY TERM — and for solid faces it
  // only did the latter, which made the whole feature nearly invisible once its wiring was fixed.
  //
  // Everything above reaches a wall through 'lit', and the only consumers of 'lit' are two OVERLAY
  // ALPHAS: 'aTop' runs 0.06 to 0.20 and 'aBot' 0.30 to 0.52. So a fully shadowed wall differed
  // from a fully lit one by a shift in how strongly a gradient is laid over it — measured end to
  // end, strength 0 against strength 1.0 moved a cab frame by a mean of 0.72 of 255. The picture
  // was correct, tunable, monotonic, free, and not visible.
  //
  // The line this replaces darkened only FLAT faces ('1.0 - solid'), which is backwards: trim is
  // the half that was already getting a real shadow and the walls were the half that was not. One
  // multiply now covers both, with the flat case keeping the same 0.45 it had.
  //
  // ⚠ 'shK' ALREADY CARRIES 'uShadowStr' — sunShadow multiplies by it before returning — so the
  // constant is the shape of the falloff and RENDER_TUNE.glShadow is the knob. Two knobs here would
  // multiply into a strength slider that does not mean what it says.
  base *= lf(1.0 - SHADOW_DARK * shK);
  // The chamfer's own contribution, on the surface rather than on an overlay alpha — see the ⚠ in
  // the bevel block. Exactly 1.0 when the width is 0, because bevelK is initialised to 0 and the
  // block that writes it is guarded by that same uniform.
  base *= lf(1.0 + BEVEL_SHADE * bevelK);
  // The cel look's shade side: a flat multiply off the banded key term, so a face turned from the
  // light is a whole step darker. The overlays above move a wall only a few percent between its lit
  // and its shaded side, and banding that still reads as one tone. Every face takes it, flat ones
  // too, as the sun's shadow above does, or a sill would stand out bright on a shaded wall.
  if (uToon > 0.0) base *= lf(mix(1.0, mix(TOON_SHADE, 1.0, lit), uToon));
  // ── CONTACT OCCLUSION ───────────────────────────────────────────────────────
  //
  // Ambient occlusion is a CONTACT effect — the ground robs a surface of sky the closer that
  // surface is to it — so the quantity it wants is height above the ground, which this shader
  // already has for free in vWorld.z. No second pass, no depth readback, no extra attribute: at
  // uAo 0 the multiply is by exactly 1.0 and the frame is what shipped.
  //
  // ⚠ IT IS NOT THE WALL RAMP AND MUST NOT REPLACE IT. vRamp is the Gouraud fake — a per-FACE
  // gradient that lands the warm sky catch at a wall's top edge — and it is most of what stops a
  // flat-shaded box reading as a flat-shaded box. This is a separate, absolute term underneath it,
  // which is why it multiplies rather than joining that lerp.
  //
  // ⚠ AND IT GOES BEFORE THE LIGHTS, DELIBERATELY. A neon sign in a dark corner should still light
  // that corner; occlusion is a statement about the SKY, not about every photon in the scene.
  // Putting it after would let a shaded plinth swallow the wash off a sign bolted to it.
  // ⚠ COLLECTED INTO A SCALAR RATHER THAN MULTIPLIED STRAIGHT IN, because the material terms below
  // need the same answer. A reflection is a statement about how much sky a surface can see, exactly
  // as these two are, so an environment term that ignored them would light the inside of a recessed
  // doorway with the open sky it cannot reach — which is how a shiny surface gets a bright corner
  // where the matte version of it has a dark one.
  float occ = 1.0 - uAo * exp(-max(0.0, vWorld.z) * uAoFall);
  base *= lf(occ);
  // ── AND THE CONCAVE HALF, WHICH IS THE ONE THE HEIGHT TERM ABOVE CANNOT SEE ────────────────
  // vBakedAo is 1 where the vertex sees open sky and falls toward 0 in a corner, sampled against
  // the building's own solid volume at mesh-capture time (gl/world.js). Interpolating it across the
  // face is the whole reason it is a vertex attribute rather than a uniform: the gradient IS the
  // effect, and a per-face value would just be a differently-lit flat quad.
  // ⚠ SAME PLACEMENT ARGUMENT AS THE TERM ABOVE — before the lights. Occlusion is a statement about
  // the SKY, and a neon sign in a recessed doorway must still light the doorway.
  occ *= 1.0 - uBakedAo * (1.0 - clamp(vBakedAo, 0.0, 1.0));
  base *= lf(1.0 - uBakedAo * (1.0 - clamp(vBakedAo, 0.0, 1.0)));
  // ── AND THE HALF NEITHER OF THOSE CAN SEE: THE BUILDING NEXT DOOR ──────────
  //
  // Both terms above are LOCAL by construction. 'uAo' is a height above the ground and 'vBakedAo'
  // is sampled against THE MODEL'S OWN solid at capture time, so a narrow gap between two different
  // buildings, a canopy over a neighbour's frontage and an alley are all invisible to them — and a
  // city is largely made of those. The baked pass could not answer it either: the neighbours change
  // with the camera, so it could not live in the per-model memo that makes it affordable.
  //
  // ⚠ SAME PLACEMENT ARGUMENT AS THE TWO ABOVE, AND IT MATTERS MORE HERE. Occlusion is a statement
  // about the SKY, so it goes before the lights: a neon sign in an alley must still light the alley.
  // It also multiplies 'occ', because the environment reflection is the same statement about how
  // much sky a surface can see — a shiny wall in a gap must not reflect the open sky it cannot see.
  if (uSsaoStr > 0.0) {
    float ss = texture(uSsao, gl_FragCoord.xy / uViewport).r;
    // ⚠ SANITISED WITH A COMPARISON, NOT A CLAMP — the rule established beside sunShadow. A NaN or
    // an unbound sampler reaching an occlusion multiply is not a missing shadow, it is a BLACK
    // CITY, and every comparison against NaN is false by definition so this rejects one.
    float k = ss >= 0.0 && ss <= 1.0 ? 1.0 - uSsaoStr * (1.0 - ss) : 1.0;
    occ *= k;
    base *= lf(k);
  }
  // The cel look's occlusion: one flat step of shade where the three terms above take more than
  // TOON_AO_CUT off, in place of their gradient. base already carries occ, so it's divided back
  // out; occ is at least 0.2 with all three at full strength, and the floor covers uAo past 1.
  if (uToon > 0.0) {
    float occM = mix(occ, mix(TOON_AO_DARK, 1.0, toonStep(TOON_AO_CUT, occ)), uToon);
    base *= lf(occM / max(occ, 1e-3));
    occ = occM;
  }
  // The occlusion also scales the light terms added below (reflection, highlight, sheen), which A
  // added as display values, so at level 2 it is a linear factor like the ones above.
  occ = lf(occ);
  // ── AND WHAT THE SURFACE IS MADE OF ─────────────────────────────────────────
  //
  // ⚠ THE BRANCH IS ON A UNIFORM AND NOTHING ELSE, which is the one kind that is safe here: every
  // fragment in a quad takes the same side, so the two texture taps inside are never evaluated on a
  // lane that did not run. A branch on 'solid' would be per fragment and is exactly the undefined
  // behaviour sunShadow is written around — so 'solid' MULTIPLIES instead, and the adornment layer
  // is left flat-shaded by arithmetic rather than by a jump.
  if (uMatStr > 0.0) {
    // ⚠ ROUNDED, NOT TRUNCATED. The attribute travels as a float and comes back through a flat
    // varying, so 6.0 can arrive as 5.999999 and int() would take it to 5 — a building silently
    // wearing the family next to its own. ('wallMat' does that rounding, or reads the page.)
    int mi = wallMat;
    // A pane is glass whatever the wall round it is made of. glassK is 0 off the page, and mix(a, b,
    // 0.0) is a, so without the page these are the three reads they always were.
    vec4 M = mix(uMat[mi], uMat[uGlassMat], glassK);
    float sheen = mix(uSheen[mi], uSheen[uGlassMat], glassK);
    // ⚠ SNOW IS MATTE, AND THE MATERIAL TABLE UNDERNEATH IT IS NOT. A copper roof, a glazed
    // atrium and a steel canopy are the surfaces most likely to be horizontal enough to hold snow,
    // and they are exactly the rows with the strongest environment and specular response — so
    // without this the drift on a verdigris roof reflects the sky like the metal it is covering.
    float mk = uMatStr * solid * (1.0 - snowW);
    // Hoisted out of this block, because the wet specular in the light loop needs it too.
    vec3 V = Vw;

    // ── THE ENVIRONMENT ───────────────────────────────────────────────────────
    //
    // ⚠ OFF THE REFLECTED RAY, NEVER OFF THE NORMAL. Every facade in this city is vertical, so every
    // wall normal has the same elevation — zero — and a sky/ground blend taken off n is one flat
    // colour on every building, which reads as a tint somebody added. The reflection swings: stand
    // under a glass tower and its lower floors hand you the sky while its upper floors hand you the
    // ground, and the line between them moves as you drive. That gradient IS what glass looks like.
    vec3 R = reflect(-V, n);
    vec3 env = mix(uEnvDn, uEnvUp, smoothstep(-0.35, 0.55, R.z));
    // The roughness the table's exponent stands for: Blinn-Phong n is about a GGX alpha of
    // sqrt(2 / (n + 2)), so curtain glass (90) is 0.15 and weathered render (8) is 0.45. Read by the
    // cube's level and the GGX lobe below, so the two agree about how blurred a surface is.
    // The surface page's roughness scale: 0.5 is the family's own, each step of 0.5 doubles or halves it.
    float alphaR = sqrt(2.0 / (max(1.0, M.x) + 2.0)) * mix(1.0, exp2((spg.g - 0.5) * 2.0), surfK);
    if (uEnvCubeOn > 0.5) {
      // ⚠ textureLod, in a uniform branch, for the relief taps' reason. The level is alpha times the
      // chain's depth: a mirror reads the 32-texel top, a matte wall the 4-texel level.
      vec3 ec = textureLod(uEnvCube, R, alphaR * uEnvMaxLod).rgb;
      env = uLinIn > 0.5 ? glassLin(ec) : ec;
    }
    // ── AND THE CITY IN IT ────────────────────────────────────────────────────
    //
    // Two flat colours make a tower reflect the WEATHER. What every photograph of a curtain wall is
    // mostly made of is other BUILDINGS — the skyline across the middle, the street below, sky only
    // at the top. 'uEnvStrip' is one texel per bearing: rgb is the mass in that direction and alpha
    // is how high it stands, as a bounded slope. See gl/skyline.js for why this is a probe rather
    // than a planar mirror or a screen-space trace (both fail on a vertical wall, differently).
    if (uEnvCity > 0.001) {
      // ⚠ THE AZIMUTH IS THE RAY'S, AND THE TEXTURE WRAPS. atan is (-π,π]; mapping it to 0..1 puts
      // the join at due west, and a CLAMPed strip would blend that bin into its opposite — a seam
      // in the glass at one fixed compass bearing that does not move when you do.
      float az = atan(R.y, R.x) * 0.1591549431 + 0.5;
      vec4 sl = texture(uEnvStrip, vec2(az, 0.5));
      float t = (sl.a - 0.5) * 2.0;
      float skySlope = t / max(1e-3, 1.0 - abs(t));
      // ⚠ SLOPE AGAINST SLOPE, NEVER HEIGHT AGAINST HEIGHT. A reflected ray has a direction and no
      // distance, so the only comparable quantity is angular — which is also why a near low shed
      // can stand higher in a reflection than a far tower.
      float raySlope = R.z / max(1e-3, length(R.xy));
      // Below the skyline is mass; below the ground horizon is ground, which 'env' already has.
      float city = (1.0 - smoothstep(skySlope - 0.09, skySlope + 0.09, raySlope))
                 * smoothstep(-0.03, 0.07, raySlope);
      env = mix(env, (uLinIn > 0.5 ? glassLin(sl.rgb) : sl.rgb) * uEnvDim, clamp(city * uEnvCity, 0.0, 1.0));
    }
    float ndv = clamp(dot(n, V), 0.0, 1.0);
    // Schlick. Near zero face-on, one at grazing, and the fifth power is what makes it hug the
    // silhouette instead of washing the whole wall.
    float fres = pow(1.0 - ndv, 5.0);
    // ⚠ A CONDUCTOR REFLECTS ITS OWN COLOUR AND A DIELECTRIC REFLECTS THE LIGHT'S. This single line
    // is most of what separates sheet copper from plaster painted the same brown: verdigris hands
    // back a green sky, render hands back a white one.
    vec3 spc = mix(vec3(1.0), surf * 1.6 + 0.12, M.y);
    // ⚠ WET RAISES THE REFLECTIVITY AND DELIBERATELY NOT THE SUN'S LOBE. Water lying on a surface
    // makes it a better mirror, and the term that carries that here is the Fresnel-weighted
    // environment — which hugs the grazing angles and the silhouette, so it varies across a wall as
    // the wall recedes. The lobe does not: the note under the highlight below says why, and every
    // face in this city is planar, so a sharper lobe would simply paint a whole wall lighter.
    float refl = mix(M.z, min(1.0, M.z + WET_REFL), wetW);
    // ⚠ A METAL REFLECTS FACE-ON AND A DIELECTRIC DOES NOT, and for a long time this line said
    // otherwise. Schlick is F = F0 + (1 - F0)·fres, where F0 is the surface's OWN reflectance at
    // normal incidence: about 0.045 for glass, brick or render, and 0.8-0.95 for polished metal.
    // Written as refl·(0.045 + 0.955·fres) every family got the dielectric's F0 and only reached
    // its own value at a grazing angle — so chrome, whose entire identity is that it hands you the
    // world, reflected 3.6% of it when you looked straight at it and was light grey paint with a
    // rim on it. That is exactly the 'chrome does not look reflective' report.
    //
    // ⚠ AND IT IS SCALED BY 'metal' RATHER THAN APPLIED TO EVERYTHING, which is what keeps it from
    // being a change to the whole city: at M.y = 0 the expression reduces to the old one TERM FOR
    // TERM, so every brick, stone, stucco, timber, concrete and glass wall in Coldwater is
    // bit-identical. Only the six metal rows move, and they move toward what they already claim to
    // be. 'uMetalRefl' 0 is the picture that shipped.
    float f0 = refl * mix(0.045, 1.0, M.y * uMetalRefl);
    float envAmt = clamp((f0 + (refl - f0) * fres) * mk, 0.0, 1.0);
    // ⚠ AND THE DIFFUSE GOES DOWN AS THE METAL GOES UP, before the mix and not after. A conductor
    // has almost no diffuse — what you see IS the reflection — and leaving the diffuse standing is
    // what makes every attempt at chrome come out as light grey paint with a highlight on it.
    vec3 diff = base * lf(1.0 - 0.55 * M.y * mk);
    base = mix(diff, env * spc * occ, envAmt);

    // ── THE SUN'S OWN HIGHLIGHT ───────────────────────────────────────────────
    //
    // ⚠ AGAINST uKeyDir AND NOT uSunDir. uSunDir is written only on the frames the shadow pass
    // actually runs, so a term reading it would hold whatever direction it was handed last — the
    // city carrying yesterday afternoon's highlight all night, which is the trap already recorded
    // beside uShadowStr. uKeyDir is written every frame, and it is the direction the rest of this
    // shader is already shading against, so the highlight lands where the lit side is.
    vec3 Hv = normalize(normalize(uKeyDir) + V);
    float sp = pow(max(0.0, dot(n, Hv)), max(1.0, M.x));
    if (uGGX > 0.5) {
      // ⚠ A GGX LOBE WITH ITS PEAK HELD AT 1, so the first frame compares with the Phong it replaces:
      // the same exponent gives the same peak, and what changes is the SHAPE (GGX's long tail, which
      // is what reads as polish) and the grazing behaviour (Smith shadowing and a Schlick term).
      // D / D(peak) for GGX is alpha^4 / (nh^2 (alpha^2 - 1) + 1)^2.
      float a2 = alphaR * alphaR;
      vec3 Lk = normalize(uKeyDir);
      float nh = max(0.0, dot(n, Hv)), nl = max(0.0, dot(n, Lk)), nv = max(1e-3, dot(n, V));
      float dd = nh * nh * (a2 - 1.0) + 1.0;
      float shape = a2 * a2 / max(1e-6, dd * dd);
      // Smith G1 for each of light and view: 1 for a smooth surface face-on, falling at grazing.
      float gL = 2.0 * nl / (nl + sqrt(a2 + (1.0 - a2) * nl * nl));
      float gV = 2.0 * nv / (nv + sqrt(a2 + (1.0 - a2) * nv * nv));
      // Schlick against the surface's own F0, as a gain on the face-on value and capped, so a grazing
      // sun brightens the rim without turning every dielectric edge white.
      float f0 = mix(0.04, 1.0, M.y);
      float fr = f0 + (1.0 - f0) * pow(1.0 - max(0.0, dot(V, Hv)), 5.0);
      sp = shape * gL * gV * nl * min(fr / f0, 4.0);
    }
    // ⚠ SCALED BY THE REFLECTIVITY COLUMN, or a matte surface gets a full-strength highlight that
    // merely happens to be wide: pow(x, 8.0) still peaks at exactly 1.0. Stucco's 0.10 is what
    // makes a rendered wall look damp rather than polished.
    // ⚠ AND KILLED IN SHADOW. shK already carries uShadowStr, so at glShadow 0 this is unchanged.
    // ⚠ AND IT IS DELIBERATELY SMALL, BECAUSE A HIGHLIGHT ON A FLAT BOX IS NOT A HIGHLIGHT. Every
    // face in this city is planar, so a lobe evaluated across one has a single normal and therefore
    // a single value: it does not read as a glint travelling over a surface, it reads as that whole
    // wall being painted a lighter colour. First measured at (0.35 + 0.65·metal) — The Forge came
    // back uniformly brighter, which is precisely what "the wall got lighter" looks like. What
    // actually carries a material here is the RELIEF, which varies per texel; this is the small
    // second term that tells you the relief is wet rather than dry.
    // ⚠ PER FAMILY NOW, AND 'uSpecStr' 0 IS EXACTLY THE EXPRESSION THAT SHIPPED. The note above
    // is a fact about FLAT faces and it still governs every masonry row, all of which carry
    // their old value in the table. What it was wrong about is the polished families: they live
    // on drums and curtain walls, where the surface really does curve away from the light and a
    // lobe really does travel across it.
    float specK = mix(0.15 + 0.30 * M.y, mix(uSpec[mi], uSpec[uGlassMat], glassK), uSpecStr);
    base += uKey * (sp * M.z * specK * mk * (1.0 - shK) * occ);
    // ── SHEEN ─────────────────────────────────────────────────────────────────
    //
    // A broad view-facing lift with no lobe at all. It is what a surface does when it is so rough
    // that the highlight stops being a highlight and the whole thing simply brightens as it turns
    // away from you: straw, render, cloth — and frosted glass, which is the entire trick behind the
    // frost row. There is nothing to see through and nothing to refract (every glazed surface in
    // this city is an opaque skin over a building), so what frost needs is a reflection that has
    // lost its lobe and gained an even glow, which is a wide exponent beside a big number here.
    base += mix(uEnvUp, vec3(1.0), 0.25) * (sheen * fres * mk * occ);
  }
  // The night outside its lights. Dimmed BEFORE the lights are added, so a lamp or a sign stands
  // out of a darker wall rather than dimming with it. A texel already bright here is a lit window
  // baked into the night atlas, which is a light source too, so it keeps its brightness.
  vec3 undimmed = base;
  // ⚠ WHERE THE PAGE SPEAKS, IT SAYS WHICH TEXELS ARE LIT, and the brightness guess stands down.
  // The guess runs on the LIT colour, so a bright reflection escaped the dim and a lit window in
  // shadow fell under it; the page's g is the pane loop's own answer. Elsewhere it's the guess.
  // The guess's thresholds are display values, so a linear base is encoded before it is asked.
  // ⚠ The guess starts at 0.55, not 0.28: a tan or whitewashed wall sits near 0.45 and was taken
  // for a lit window, so whole buildings kept most of their daylight tone at midnight.
  float litK = mix(smoothstep(0.55, 0.8, dot(uLinIn > 0.5 ? glassSrgb(base) : base, vec3(0.299, 0.587, 0.114))), mpg.g, pageK);
  // ⚠ SNOW IS NEVER A LIT WINDOW. Its 0.9 albedo sits well over the guess's 0.55, so every snowy
  // roof, sill and awning was taken for a light source and kept its daylight white at midnight.
  // snowW is 0 on anything that isn't facing up, so a wall's lit windows are untouched.
  litK *= 1.0 - snowW;
  // ⚠ THE DIM WAS TUNED AS A FACTOR ON DISPLAY VALUES. Halving linear light only takes about a
  // quarter off what the eye sees, so at level 2 the night came out washed grey. A display factor k
  // is roughly k^2.2 in linear light, which keeps the night as dark as it was tuned.
  float nightK = lf(uNightDim);
  base *= mix(nightK, 1.0, litK);
  // And greyer: the dark loses its colour with its light (scotopic). Keyed off the same dim, so a
  // day frame is untouched; a lit texel keeps its colour, and the lamp lift below mixes toward the
  // undimmed colour, so the colour comes back only where a light reaches.
  base = mix(base, vec3(dot(base, vec3(0.299, 0.587, 0.114))), clamp((1.0 - uNightDim) * 1.1, 0.0, 0.85) * (1.0 - litK));
  // The lamps give back what the night took, and no more. Each light lifts the dimmed wall toward
  // its own undimmed colour, tinted by the lamp, capped at 1 per channel, so a wall under a lamp is
  // never brighter than it is by day. The cap is what the additive wash below lacked (it drowned the
  // signage and was switched off); this term cannot.
  vec3 lamp = vec3(0.0);
  vec3 sign = vec3(0.0);
  // The city own lights, added on top of the key shading.
  if (uLGOn == 1) {
    // Every light whose reach covers this cell (gl/lightgrid.js, mass mode), in place of the slots.
    // The table holds display colours; the uniform path is handed them already linear at level 2.
    uvec2 hc = lgCell(vWorld.xy);
    for (uint k = 0u; k < hc.y; k++) {
      int li = lgAt(hc.x + k);
      vec4 P = lgP(li), X = lgX(li), Y = lgY(li);
      vec3 raw = lgC(li).rgb, C = X.rgb;
      if (uLinIn > 0.5) { raw = glassLin(raw); C = glassLin(C); }
      massLight(P.xyz, raw, C, X.w, Y.x, n, Vw, wetW, lamp, base);
      // ── A SIGN'S OWN LIGHT ON ITS OWN WALL (LIGHT_TUNE.sign, stage A2) ──────────────────────
      //
      // Not the wall wash: that was a broad field over the whole facade and was cut six times for
      // drowning the lettering. This reaches only the sign's own patch of wall (lgC.w is the
      // light's 'sr', a share of its reach, and 0 for an area wash), and is capped below at the
      // wall's undimmed colour, so a sign can tint the bricks it hangs on and never light them past
      // daylight. Grid path only: the slot path would need another uniform array, and the uniform
      // budget is what caps the slots at all (see MAX_LIGHTS).
      float SR = lgC(li).w;
      if (uSignLift > 0.0 && SR > 0.0) {
        vec3 sd = P.xyz - vWorld;
        float sdist = length(sd);
        float sa = clamp(1.0 - sdist / SR, 0.0, 1.0);
        sign += raw * (sa * sa * max(0.0, (dot(n, sd / max(0.001, sdist)) + 0.6) / 1.6));
      }
    }
  } else {
    for (int i = 0; i < GLASS_MAX_LIGHTS; i++) {
      if (i >= uNLight) break;
      massLight(uLightP[i], uLightRaw[i], uLightC[i], uLightR[i], uLightLR[i], n, Vw, wetW, lamp, base);
    }
  }
  // A lift toward the undimmed wall is a mix, so at level 2 it runs on display values (see the overlays).
  vec3 liftW = min(vec3(1.0), lamp * uLampLift);
  if (uLinIn > 0.5) { vec3 bD = glassSrgb(base); base = glassLin(bD + max(vec3(0.0), glassSrgb(undimmed) - bD) * liftW); }
  else base += max(vec3(0.0), undimmed - base) * liftW;
  base += min(sign * uSignLift, max(vec3(0.0), undimmed - base));
  // ⚠ AND THERE IS NO EMISSION TERM HERE, WHICH WAS MEASURED RATHER THAN ASSUMED. One sat on this
  // line and moved 0.0% of wall pixels at every seat: everything above IS light arriving at a wall,
  // and every emissive surface in the city is a FLAT face, which 'solid' has already excused from
  // all of it. The account is beside faceEdges in world.js.
  // ── THE INK LINES (RENDER_TUNE.glInk) ───────────────────────────────────────
  // After the lights, so a line under a lamp stays a line; before the fog, so the haze takes it with
  // the wall. Detail goes first with distance and the outline last (see gl/ssao.js for the split).
  // ⚠ SANITISED WITH A COMPARISON, for the SSAO lookup's reason above.
  if (uInkStr > 0.0) {
    vec2 e = textureLod(uInk, gl_FragCoord.xy / uViewport, 0.0).rg;
    e = (e.x >= 0.0 && e.x <= 1.0 && e.y >= 0.0 && e.y <= 1.0) ? e : vec2(0.0);
    float ink = max(e.x * (1.0 - smoothstep(uInkFade.x, uInkFade.y, vDepth)),
                    e.y * (1.0 - smoothstep(uInkFade.z, uInkFade.w, vDepth))) * uInkStr;
    base = mix(base, uInkCol, ink);
  }
  // GLASS's own fog curve, squared, scaled by the same amount its slider sets — see fogWeight.
  float ff = clamp((vDepth - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  float fog = ff * ff * uFogAmt;
  // ── AND THE AIR NEAR THE GROUND ─────────────────────────────────────────────
  //
  // The band above is a function of DISTANCE alone, so a tower recedes as one piece. This is the
  // axis it cannot express: the fragments low down have more air in front of them than the ones at
  // the parapet, so a block in mist stands out of it rather than fading evenly.
  //
  // ⚠ COMBINED AS TRANSMITTANCE, NEVER ADDED. Two fogs are two things the light has to get through,
  // so what multiplies is what gets THROUGH — added, a thick band plus a thick layer sums past 1
  // and the far field turns into a flat plate of fog colour.
  float hf = heightFog(uEye.z, vWorld.z, vDepth, uFogH, uFogHScale);
  fog = 1.0 - (1.0 - fog) * (1.0 - hf);
  // ⚠ AND THE FAR EDGE DISSOLVES RATHER THAN ENDING. The 2-D pass fades a building out over the
  // last few tiles of its draw distance, so distant blocks ghost up out of the horizon instead of
  // popping in — and this buffer is composited onto that same frame, so a mass that stayed opaque
  // to its last tile would paint a hard edge over the haze the rest of the picture dissolves into.
  // Premultiplied, because the canvas is.
  // ⚠ EACH TILE DISSOLVES AT ITS OWN MOMENT, which is what the 2-D pass does and what stops a row
  // of buildings giving up its opacity in unison — a wall of haze moving toward you rather than
  // distance. The number is the tile's own, handed over rather than recomputed.
  float a = (1.0 - smoothstep(uHazeNear - vJit, uHazeFar - vJit, vDepth)) * clamp(vAlpha, 0.0, 1.0) * uWorldBlend;
  // ── AND THE LIGHT IN THAT AIR ───────────────────────────────────────────────
  //
  // ⚠ A UNIFORM BRANCH, so in clear weather this loop is not a code path. uScatter is the tune
  // times how much the sky is hazing above a floor, and clear and cloudy are both under it — the
  // atans below are real work and a city has no business paying for them on a bright afternoon.
  //
  // ⚠ AND IT READS uLightRaw, NOT uLightC. The wall wash folds its own (currently zero) gain into
  // the colour, so a term multiplying uLightC multiplies by black — the bug that made the wet
  // specular measure nothing, two phases running. What scatters in the air is the light the lamp
  // actually puts out.
  vec3 scat = vec3(0.0);
  if (uScatter > 0.001) {
    for (int i = 0; i < GLASS_MAX_LIGHTS; i++) {
      if (i >= uNLight) break;
    // ⚠ uScatter IS PASSED AS THE DENSITY, AND THE WEATHER IS NOT COUNTED TWICE. The obvious
    // wiring hands the integral the fog's own uFogH and then scales the result by the weather gate
    // as well — which is physically defensible and measures as a QUADRATIC response, because both
    // terms track the same haze. A rainy night came back at 0.14% of the frame against a foggy
    // one's 11.05%, so the weather this whole layer exists for got almost none of it. The gate
    // carries the weather once; the height profile inside still shapes it.
      scat += uLightRaw[i] * lightShaft(uEye, vWorld, uLightP[i], uLightR[i], uScatter, uFogHScale);
    }
  }
  // ⚠ ADDED AFTER THE FOG AND BEFORE THE PREMULTIPLY. It is light arriving from the side rather
  // than part of the surface, so it is not something the fog should be mixing away — but it does
  // belong to this fragment's own coverage, or a shaft would draw at full strength across the
  // dissolving far edge of the city.
  // Fog is a mix toward a colour as well: display values at level 2, then decoded.
  vec3 fogged = uLinIn > 0.5 ? glassLin(mix(glassSrgb(base), glassSrgb(uFog), fog)) : mix(base, uFog, fog);
  outColor = vec4((fogged + scat) * a, a);
}`, 'outColor');

// One number stamps both the loop limit and the array sizes, so they can't drift apart.
const withLights = (src) => src.split("GLASS_MAX_LIGHTS").join(String(MAX_LIGHTS))
  .split("GLASS_MAX_MAT").join(String(MAX_MATERIALS));


// ⚠ MSAA (`opts.msaa`) is a creation attribute: changing it means a new view, as a resize does in
// `sceneGL`, so it's never a per-frame dial.
// Lights, wires and decals are drawn in the map window's frame (the layer adds ox, oy as it writes),
// so a record kept on the GPU doesn't depend on where the camera sits in its tile.
//
// Per-pass GPU time: see docs/reference/glass-notes.md#per-pass-gpu-time-__glpassms. Off (null)
// unless a bench turns it on. Timer queries can't nest, so an inner pass pauses the outer one.
let PASS_T = null;
export function glPassTimer(on) {
  const prev = PASS_T;
  PASS_T = on ? { list: [], stack: [] } : null;
  return prev;
}
// Reads a finished collector (the value `glPassTimer(false)` returns) into ms per name, or null if
// the GPU clock jumped or the extension is missing. Results arrive a few frames late.
export async function glPassTimes(t) {
  if (!t || !t.list.length) return null;
  const [, lastQ, gl] = t.list[t.list.length - 1];
  for (let k = 0; k < 200 && !gl.getQueryParameter(lastQ, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 10));
  const out = {};
  let disjoint = false;
  for (const [name, q, g, ext] of t.list) {
    disjoint = disjoint || !!g.getParameter(ext.GPU_DISJOINT_EXT);
    if (g.getQueryParameter(q, g.QUERY_RESULT_AVAILABLE)) out[name] = (out[name] || 0) + g.getQueryParameter(q, g.QUERY_RESULT) / 1e6;
    g.deleteQuery(q);
  }
  return disjoint ? null : out;
}
// Splits a sink's retained groups (`list.groups`) out of its records. A group whose records aren't
// where it says (a sink truncated after a throw) is dropped and its records go as usual.
function splitGroups(list, ox, oy) {
  const G = list && list.groups;
  if (!G || !G.length) return { rest: list, groups: null };
  const rest = [], groups = [];
  if (list.deep) rest.deep = list.deep;
  if (list.now != null) rest.now = list.now;
  if (list.atlas != null) rest.atlas = list.atlas;   // the decals' RENDER_TUNE.glDecalAtlas
  let gi = 0;
  for (let i = 0; i < list.length; i++) {
    while (gi < G.length && G[gi].at < i) gi++;
    if (gi < G.length && G[gi].at === i) {
      const g = G[gi++], recs = g.recs, n = recs.length;
      if (n && i + n <= list.length && list[i] === recs[0] && list[i + n - 1] === recs[n - 1]) {
        // `w` is the map window the group was sent in (armReplay): the layers re-send a group when it moves.
        groups.push({ recs, ox: g.ox == null ? ox : g.ox, oy: g.oy == null ? oy : g.oy, w: g.w });
        i += n - 1; continue;
      }
    }
    rest.push(list[i]);
  }
  return { rest, groups };
}
function windowFrame(cam) {
  const ox = (cam && cam.ox) || 0, oy = (cam && cam.oy) || 0;
  return { ox, oy, cam: ox || oy ? { ...cam, fx: (cam.fx || 0) + ox, fy: (cam.fy || 0) + oy } : cam };
}
export function createGLView(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', { antialias: opts.msaa !== 0, alpha: true, depth: true });
  if (!gl) return null;
  // ⚠ A lost context is silent, and without preventDefault it's permanent. The pass checks `lost()`
  // each frame; see docs/reference/glass-notes.md#a-pass-that-didnt-draw.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
  let passExt;   // see glPassTimer; looked up the first time a timed frame needs it
  function timed(name, fn) {
    const T = PASS_T;
    if (!T) return fn();
    if (passExt === undefined) passExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!passExt) return fn();
    const open = (n) => { const q = gl.createQuery(); gl.beginQuery(passExt.TIME_ELAPSED_EXT, q); T.list.push([n, q, gl, passExt]); };
    const top = T.stack[T.stack.length - 1], outer = top && top[1] === gl ? top[0] : null;
    if (outer) gl.endQuery(passExt.TIME_ELAPSED_EXT);
    T.stack.push([name, gl]); open(name);
    try { return fn(); } finally { gl.endQuery(passExt.TIME_ELAPSED_EXT); T.stack.pop(); if (outer) open(outer); }
  }
  // Every declared layer program starts compiling now, side by side, before anything asks for one.
  prewarmPrograms(gl);

  const prog = layerProgram(gl, withLights(VERT), withLights(FRAG), 'context');

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    normal: gl.getAttribLocation(prog, 'aNormal'),
    color: gl.getAttribLocation(prog, 'aColor'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    ramp: gl.getAttribLocation(prog, 'aRamp'),
    jit: gl.getAttribLocation(prog, 'aJit'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    flat: gl.getAttribLocation(prog, 'aFlat'),
    bao: gl.getAttribLocation(prog, 'aBakedAo'),
    mat: gl.getAttribLocation(prog, 'aMat'),
    edge: gl.getAttribLocation(prog, 'aEdge'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    massShift: gl.getUniformLocation(prog, 'uMassShift'),
    keyDir: gl.getUniformLocation(prog, 'uKeyDir'),
    key: gl.getUniformLocation(prog, 'uKey'),
    shadow: gl.getUniformLocation(prog, 'uShadow'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    worldBlend: gl.getUniformLocation(prog, 'uWorldBlend'),
    hazeNear: gl.getUniformLocation(prog, 'uHazeNear'),
    hazeFar: gl.getUniformLocation(prog, 'uHazeFar'),
    fadePass: gl.getUniformLocation(prog, 'uFadePass'),
    vlight: gl.getUniformLocation(prog, 'uVLight'),
    nightDim: gl.getUniformLocation(prog, 'uNightDim'),
    atlas: gl.getUniformLocation(prog, 'uAtlas'),
    textured: gl.getUniformLocation(prog, 'uTextured'),
    sky: gl.getUniformLocation(prog, 'uSky'),
    str: gl.getUniformLocation(prog, 'uStr'),
    // ⚠ Arrays are asked for without a subscript, so the name is one a shader declares (gl:glsl checks).
    nLight: gl.getUniformLocation(prog, 'uNLight'),
    lightP: gl.getUniformLocation(prog, 'uLightP'),
    lightC: gl.getUniformLocation(prog, 'uLightC'),
    lightRaw: gl.getUniformLocation(prog, 'uLightRaw'),
    lightR: gl.getUniformLocation(prog, 'uLightR'),
    lightLR: gl.getUniformLocation(prog, 'uLightLR'),
    lampLift: gl.getUniformLocation(prog, 'uLampLift'),
    signLift: gl.getUniformLocation(prog, 'uSignLift'),
    lightWrap: gl.getUniformLocation(prog, 'uLightWrap'),
    lightFocus: gl.getUniformLocation(prog, 'uLightFocus'),
    ao: gl.getUniformLocation(prog, 'uAo'),
    aoFall: gl.getUniformLocation(prog, 'uAoFall'),
    bakedAo: gl.getUniformLocation(prog, 'uBakedAo'),
    shadowMap: gl.getUniformLocation(prog, 'uShadowMap'),
    lightVP: gl.getUniformLocation(prog, 'uLightVP'),
    shadowStr: gl.getUniformLocation(prog, 'uShadowStr'),
    shadowTexel: gl.getUniformLocation(prog, 'uShadowTexel'),
    shadowBias: gl.getUniformLocation(prog, 'uShadowBias'),
    sunDir: gl.getUniformLocation(prog, 'uSunDir'),
    eye: gl.getUniformLocation(prog, 'uEye'),
    matStr: gl.getUniformLocation(prog, 'uMatStr'),
    snow: gl.getUniformLocation(prog, 'uSnow'),
    wet: gl.getUniformLocation(prog, 'uWet'),
    fogH: gl.getUniformLocation(prog, 'uFogH'),
    fogHScale: gl.getUniformLocation(prog, 'uFogHScale'),
    scatter: gl.getUniformLocation(prog, 'uScatter'),
    bumpStr: gl.getUniformLocation(prog, 'uBumpStr'),
    metalRefl: gl.getUniformLocation(prog, 'uMetalRefl'),
    bevel: gl.getUniformLocation(prog, 'uBevel'),
    bevelTilt: gl.getUniformLocation(prog, 'uBevelTilt'),
    ssao: gl.getUniformLocation(prog, 'uSsao'),
    ssaoStr: gl.getUniformLocation(prog, 'uSsaoStr'),
    viewport: gl.getUniformLocation(prog, 'uViewport'),
    toon: gl.getUniformLocation(prog, 'uToon'),
    toonBands: gl.getUniformLocation(prog, 'uToonBands'),
    ink: gl.getUniformLocation(prog, 'uInk'),
    inkStr: gl.getUniformLocation(prog, 'uInkStr'),
    inkFade: gl.getUniformLocation(prog, 'uInkFade'),
    inkCol: gl.getUniformLocation(prog, 'uInkCol'),
    // No subscript, as for the light arrays above.
    matTab: gl.getUniformLocation(prog, 'uMat'),
    sheenTab: gl.getUniformLocation(prog, 'uSheen'),
    specTab: gl.getUniformLocation(prog, 'uSpec'),
    specStr: gl.getUniformLocation(prog, 'uSpecStr'),
    envUp: gl.getUniformLocation(prog, 'uEnvUp'),
    envDn: gl.getUniformLocation(prog, 'uEnvDn'),
    envStrip: gl.getUniformLocation(prog, 'uEnvStrip'),
    envCity: gl.getUniformLocation(prog, 'uEnvCity'),
    envDim: gl.getUniformLocation(prog, 'uEnvDim'),
    atlasTexel: gl.getUniformLocation(prog, 'uAtlasTexel'),
    matPage: gl.getUniformLocation(prog, 'uMatPage'),
    matPageOn: gl.getUniformLocation(prog, 'uMatPageOn'),
    glassMat: gl.getUniformLocation(prog, 'uGlassMat'),
    linIn: gl.getUniformLocation(prog, 'uLinIn'),
    envCube: gl.getUniformLocation(prog, 'uEnvCube'),
    envCubeOn: gl.getUniformLocation(prog, 'uEnvCubeOn'),
    envMaxLod: gl.getUniformLocation(prog, 'uEnvMaxLod'),
    ggx: gl.getUniformLocation(prog, 'uGGX'),
    surfPage: gl.getUniformLocation(prog, 'uSurfPage'),
    surfPageOn: gl.getUniformLocation(prog, 'uSurfPageOn'),
    heightGain: gl.getUniformLocation(prog, 'uHeightGain'),
  };
  // The light grid for the wall (RENDER_TUNE.glCluster; gl/lightgrid.js in mass mode).
  for (const n of LIGHTGRID_UNIFORMS) loc[n] = gl.getUniformLocation(prog, n);
  for (const n of PROP_SHADOW_UNIFORMS) loc[n] = gl.getUniformLocation(prog, n);
  loc.propWall = gl.getUniformLocation(prog, 'uPropWall');
  const lgTex = createLightGridTextures(gl);
  const lgGrid = makeGroundGrid();
  let massGrid = null, wallGridNow = null;
  // Built once a frame by world.js after pickLights, so the mirror and main pass read the same grid.
  // The wall, people, solids and cloth bind it through `bindWallGrid` on units 8 to 10. null clears.
  function setLightGrid(list) {
    wallGridNow = null;
    if (lgTex && list && list.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const p = list[i].p;
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
      const wg = buildGroundGrid(lgGrid, list, [x0 - 4, y0 - 4, x1 + 4, y1 + 4], { x: 0, y: 0, h: 0 }, { mass: true });
      if (wg.n) { lgTex.upload(wg); wallGridNow = wg; }
    }
    massGrid = wallGridNow ? { lights: wallGridNow.n, binned: wallGridNow.binned, cells: wallGridNow.nx * wallGridNow.ny, size: wallGridNow.size, entries: wallGridNow.entries, maxCell: wallGridNow.maxCell, cut: wallGridNow.cut } : null;
  }
  function bindWallGrid(L, unit) {
    if (lgTex) lgTex.bind(L, unit, wallGridNow); else bindNoLightGrid(gl, L, unit);
  }

  // Scratch, filled per frame and never reallocated.
  const lightP = new Float32Array(MAX_LIGHTS * 3), lightC = new Float32Array(MAX_LIGHTS * 3);
const lightRaw = new Float32Array(MAX_LIGHTS * 3);
  const lightR = new Float32Array(MAX_LIGHTS);
  const lightLR = new Float32Array(MAX_LIGHTS);
  // The material table, re-flattened only when the caller hands over a different one.
  const matTab = new Float32Array(MAX_MATERIALS * 4), sheenTab = new Float32Array(MAX_MATERIALS);
  const specTab = new Float32Array(MAX_MATERIALS);
  let matSrc = null;
  // ⚠ An unfilled row must stay harmless: gloss 0 is pow(x, 0.0) = 1.0, a full mirror.
  for (let i = 0; i < MAX_MATERIALS; i++) matTab[i * 4] = 1;

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let count = 0;
  let atlasTex = null, hasAtlas = false;
  // The page's texel size, for the relief taps. ⚠ The page repacks when its surfaces change, so
  // never cache this anywhere else.
  let atlasW = 0, atlasH = 0;
  // The mesh's box, taken from the buffer itself so the shadow projection contains every caster.
  let bounds = null;
  // Each upload group's vertex range and box (in the buffer's frame) with its haze jitter, so the
  // fade pass can draw only the tiles that reach the band. See fadeRuns.
  let ranges = [];
  let meshBuild = 0;   // bumped by every uploadGroups, so a kept shadow map knows its mesh changed
  // ⚠ One fixed-size shadow map per view, never rebuilt; the projection tightens, not the texture.
  let shadow = null, shadowTried = false;
  let ssao = null, ssaoTried = false;
  let hdr = null, hdrTried = false;
  // Whether the last `beginTarget` bound the float buffer. ⚠ `opts.hdr` is only the ask; a driver
  // can refuse the format. See `hdrLive`.
  let targetLive = false;
  let warnedShadowShape = false;   // once per view — see the ⚠ on `opts.shadow` in draw()

  // One texture for the whole city (gl/atlas.js), so the skyline is one draw call.
  function setAtlas(canvas) {
    if (!canvas) { hasAtlas = false; atlasW = atlasH = 0; return; }
    atlasW = canvas.width; atlasH = canvas.height;
    if (!atlasTex) atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    // ⚠ No mipmaps (they blend across atlas tiles) and clamp to edge.
    // ⚠ Magnify with NEAREST, as the 2-D renderer does; LINEAR washes near facades to soft grey.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    hasAtlas = true;
  }

  // The material page: the atlas's twin, same rects. ⚠ NEAREST, or a pane edge blurs into the wall.
  let matPageTex = null, hasMatPage = false;
  function setMatPage(canvas) {
    if (!canvas) { hasMatPage = false; return; }
    if (!matPageTex) matPageTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, matPageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    hasMatPage = true;
  }
  // The table row a pane takes, found by name when the table arrives. 0 until then, never -1.
  let glassRow = 0;
  // The sky as a cube for reflections (RENDER_TUNE.glEnvCube; gl/envcube.js), built on first use.
  let envCube = null;
  // The surface page: height and roughness (RENDER_TUNE.glSurfPage), uploaded like the material page.
  // ⚠ LINEAR, unlike the other two pages: NEAREST turns every joint into a one-texel cliff.
  let surfPageTex = null, hasSurfPage = false;
  function setSurfPage(canvas) {
    if (!canvas) { hasSurfPage = false; return; }
    if (!surfPageTex) surfPageTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, surfPageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    hasSurfPage = true;
  }

  // ⚠ Faces are fanned (every face is convex; a drum cap is an N-gon). Group offsets are added on the
  // way in, straight into a typed array.
  // `nb` is the dusk blend: a face carries day and night colours (identical geometry, asserted in
  // gl:mesh) and they're blended here at upload. ⚠ Free only because 'texEpoch' quantises dusk into
  // 64 steps; put 'nb' in the rebuild key any other way and sunset rebuilds every frame.
  // One group's vertices into `data` from float `o`, its box left in GB; returns the next offset.
  // Shared by uploadGroups and uploadKept.
  const GB = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
  function packGroup(data, o, grp, rectOf, NB) {
    const ox = grp.ox || 0, oy = grp.oy || 0;
    let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
    // A group's own blend (a building whose power has failed stays day-coloured). Faces are shared
    // per model, so the blend is the only per-tile handle. ⚠ null isn't 0: `grp.nb || NB` breaks it.
    const GNB = grp.nb == null ? NB : (grp.nb > 0 ? (grp.nb < 1 ? grp.nb : 1) : 0);
    for (const f of grp.faces) {
      // A face with no `rgbN` keeps one colour (a textured wall's night lives in the atlas).
      const cD = f.rgb || [128, 128, 128], cN = f.rgbN;
      const r = cN ? cD[0] + (cN[0] - cD[0]) * GNB : cD[0];
      const g = cN ? cD[1] + (cN[1] - cD[1]) * GNB : cD[1];
      const b = cN ? cD[2] + (cN[2] - cD[2]) * GNB : cD[2];
      // ⚠ Degenerate faces carry a [0, 0, 0] normal (truthy), and normalize() of it is NaN, which
      // paints the surface black. Catch zero length, not just a missing normal.
      const nn = f.n;
      const n = (nn && (nn[0] || nn[1] || nn[2])) ? nn : [0, 0, 1];
      // The face's UV mapped into its atlas rect (untextured: one texel). ⚠ The rect is per tile, so
      // the group goes with it: a blacked-out block and a lit one share face objects.
      const uv = f.uv || null, rc = (rectOf ? rectOf(f, grp) : f.rect) || [0, 0, 0, 0];
      const u0 = rc[0], v0 = rc[1], du = rc[2] - rc[0], dv = rc[3] - rc[1];
      const cr = r / 255, cg = g / 255, cb = b / 255;
      const fa = f.alpha == null ? 1 : f.alpha;
      // ⚠ `flat` is a lighting answer, not a kind (a barrel roof is mass that shades itself).
      // `flat: 2` is its own colour lit as a wall (litOwn); checked first, since `!!2` is true.
      const flat = f.flat === 2 ? 2 : (f.flat != null ? !!f.flat : f.kind === 'flat') ? 1 : 0;
      // Resolved per model in world.js. None (a preview, the bench) is 0, the default facade.
      const mat = f.mat ? f.mat : 0;
      const jit = grp.jit || 0;
      // The ramp: the vertex's height within its own face, 0 at the top, for the 2-D renderer's
      // gradient down each wall.
      let z0 = Infinity, z1 = -Infinity;
      for (const p of f.p) { if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2]; }
      const dz = (z1 - z0) || 1;
      for (let i = 1; i + 1 < f.p.length; i++) {
        for (let e = 0; e < 3; e++) {
          const k = e === 0 ? 0 : i + e - 1;
          const p = f.p[k], t = uv ? uv[k] : null;
          const wx = p[0] + ox, wy = p[1] + oy, wz = p[2];
          if (wx < gx0) gx0 = wx; if (wx > gx1) gx1 = wx;
          if (wy < gy0) gy0 = wy; if (wy > gy1) gy1 = wy;
          if (wz < gz0) gz0 = wz; if (wz > gz1) gz1 = wz;
          data[o] = wx; data[o + 1] = wy; data[o + 2] = wz;
          data[o + 3] = n[0]; data[o + 4] = n[1]; data[o + 5] = n[2];
          data[o + 6] = cr; data[o + 7] = cg; data[o + 8] = cb;
          data[o + 9] = u0 + du * (t ? t[0] : 0); data[o + 10] = v0 + dv * (t ? t[1] : 0);
          data[o + 11] = (z1 - p[2]) / dz;
          data[o + 12] = fa;
          data[o + 13] = flat;
          data[o + 14] = jit;
          // ⚠ Baked occlusion: no bake is 1.0 (open sky), never 0, or unbaked faces go black.
          data[o + 15] = f.ao ? f.ao[k] : 1;
          data[o + 16] = mat;
          // ⚠ No edge field is a distance no bevel reaches; zero means "on the edge" everywhere.
          const ed = f.edge;
          data[o + 17] = ed ? ed[k * 4] : 1e6; data[o + 18] = ed ? ed[k * 4 + 1] : 1e6;
          data[o + 19] = ed ? ed[k * 4 + 2] : 1e6; data[o + 20] = ed ? ed[k * 4 + 3] : 1e6;
          o += STRIDE;
        }
      }
    }
    GB.x0 = gx0; GB.x1 = gx1; GB.y0 = gy0; GB.y1 = gy1; GB.z0 = gz0; GB.z1 = gz1;
    return o;
  }
  const vertsOf = (grp) => { let n = 0; for (const f of grp.faces) n += (f.p.length - 2) * 3; return n; };
  // The buffer, its layout and the attribute pointers, from `data`.
  function massLayout(data, usage) {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const S = STRIDE * 4;
    gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(loc.normal); gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(loc.color); gl.vertexAttribPointer(loc.color, 3, gl.FLOAT, false, S, 24);
    if (loc.uv >= 0) { gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, S, 36); }
    if (loc.ramp >= 0) { gl.enableVertexAttribArray(loc.ramp); gl.vertexAttribPointer(loc.ramp, 1, gl.FLOAT, false, S, 44); }
    if (loc.alpha >= 0) { gl.enableVertexAttribArray(loc.alpha); gl.vertexAttribPointer(loc.alpha, 1, gl.FLOAT, false, S, 48); }
    if (loc.flat >= 0) { gl.enableVertexAttribArray(loc.flat); gl.vertexAttribPointer(loc.flat, 1, gl.FLOAT, false, S, 52); }
    if (loc.jit >= 0) { gl.enableVertexAttribArray(loc.jit); gl.vertexAttribPointer(loc.jit, 1, gl.FLOAT, false, S, 56); }
    if (loc.bao >= 0) { gl.enableVertexAttribArray(loc.bao); gl.vertexAttribPointer(loc.bao, 1, gl.FLOAT, false, S, 60); }
    if (loc.mat >= 0) { gl.enableVertexAttribArray(loc.mat); gl.vertexAttribPointer(loc.mat, 1, gl.FLOAT, false, S, 64); }
    if (loc.edge >= 0) { gl.enableVertexAttribArray(loc.edge); gl.vertexAttribPointer(loc.edge, 4, gl.FLOAT, false, S, 68); }
    gl.bindVertexArray(null);
  }
  function uploadGroups(groups, rectOf, nb) {
    kept = null;
    const NB = nb > 0 ? (nb < 1 ? nb : 1) : 0;
    let verts = 0;
    for (const g of groups) verts += vertsOf(g);
    const data = new Float32Array(verts * STRIDE);
    let o = 0;
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    const rs = [];
    for (const grp of groups) {
      const at = o / STRIDE;
      o = packGroup(data, o, grp, rectOf, NB);
      if (GB.x0 < bx0) bx0 = GB.x0; if (GB.x1 > bx1) bx1 = GB.x1;
      if (GB.y0 < by0) by0 = GB.y0; if (GB.y1 > by1) by1 = GB.y1;
      if (GB.z0 < bz0) bz0 = GB.z0; if (GB.z1 > bz1) bz1 = GB.z1;
      if (o / STRIDE > at) rs.push({ at, n: o / STRIDE - at, x0: GB.x0, x1: GB.x1, y0: GB.y0, y1: GB.y1, z0: GB.z0, z1: GB.z1, jit: grp.jit || 0 });
    }
    ranges = rs;
    dbgData = globalThis.__massDebug ? data : null;   // massDebug's, only for a harness that asks
    // ⚠ No axis swap: camera.js's matrix takes GLASS's own coordinates (z up) and swaps itself.
    count = verts;
    meshBuild++;
    // ⚠ The box always reaches z = 0, or a shadow box fitted to raised plates misses the ground.
    bounds = verts ? { x0: bx0, x1: bx1, y0: by0, y1: by1, z0: Math.min(0, bz0), z1: bz1 } : null;
    massLayout(data, gl.STATIC_DRAW);
    return count;
  }

  // The mass kept tile by tile across a recentre (RENDER_TUNE.massKeep). Each group has a `key` and
  // positions in a frame fixed between full builds (world.js's anchor); the shader adds `massShift`.
  // A new window keeps shared groups in place, writes new ones into holes (zeroed: degenerate
  // triangles draw nothing) or on the end, and uploads only those ranges. `full`, an overflow, or
  // holes over FRAG_MAX repack from scratch.
  // ⚠ Draw order is slot order, not cell order; only coplanar faces and the faded band can tell.
  let kept = null;
  const FRAG_MAX = 0.35, KEPT_ROOM = 1.25;
  function uploadKept(groups, rectOf, nb, full) {
    const NB = nb > 0 ? (nb < 1 ? nb : 1) : 0;
    const K = kept;
    if (full || !K || K.nb !== NB) return keptFresh(groups, rectOf, NB);   // full when the atlas moved (world.js)
    const seen = new Set();
    for (const g of groups) seen.add(g.key);
    const dirty = [];
    for (const [key, sl] of K.slots) {
      if (seen.has(key)) continue;
      K.data.fill(0, sl.at * STRIDE, (sl.at + sl.n) * STRIDE);
      dirty.push(sl.at, sl.n);
      K.free.push([sl.at, sl.n]);
      K.slots.delete(key);
    }
    keptMerge(K);
    const capV = K.data.length / STRIDE;
    for (const g of groups) {
      if (K.slots.has(g.key)) continue;
      const n = vertsOf(g);
      let at = -1;
      for (let i = 0; i < K.free.length; i++) {
        const fb = K.free[i];
        if (fb[1] < n) continue;
        at = fb[0];
        if (fb[1] === n) K.free.splice(i, 1); else { fb[0] += n; fb[1] -= n; }
        break;
      }
      if (at < 0) {
        if (K.end + n > capV) return keptFresh(groups, rectOf, NB);
        at = K.end; K.end += n;
      }
      packGroup(K.data, at * STRIDE, g, rectOf, NB);
      K.slots.set(g.key, { at, n, x0: GB.x0, x1: GB.x1, y0: GB.y0, y1: GB.y1, z0: GB.z0, z1: GB.z1, jit: g.jit || 0 });
      dirty.push(at, n);
    }
    keptMerge(K);
    let holes = 0;
    for (const fb of K.free) holes += fb[1];
    if (holes > FRAG_MAX * K.end) return keptFresh(groups, rectOf, NB);
    if (!dirty.length) return count;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (let i = 0; i < dirty.length; i += 2) {
      if (dirty[i + 1] > 0) gl.bufferSubData(gl.ARRAY_BUFFER, dirty[i] * STRIDE * 4, K.data, dirty[i] * STRIDE, dirty[i + 1] * STRIDE);
    }
    keptFinish(K);
    return count;
  }
  // Free runs sorted and joined, and a run that ends at the end of the buffer given back to it.
  function keptMerge(K) {
    K.free.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const fb of K.free) {
      const last = out[out.length - 1];
      if (last && last[0] + last[1] === fb[0]) last[1] += fb[1]; else out.push(fb.slice());
    }
    while (out.length && out[out.length - 1][0] + out[out.length - 1][1] === K.end) K.end = out.pop()[0];
    K.free = out;
  }
  function keptFresh(groups, rectOf, NB) {
    let verts = 0;
    for (const g of groups) verts += vertsOf(g);
    const data = new Float32Array(Math.ceil(verts * KEPT_ROOM + 1024) * STRIDE);
    const K = { data, slots: new Map(), free: [], end: 0, nb: NB };
    let o = 0;
    for (const g of groups) {
      const at = o / STRIDE;
      o = packGroup(data, o, g, rectOf, NB);
      // A key seen twice in one window is one tile drawn twice; the second keeps its own slot.
      K.slots.set(K.slots.has(g.key) ? g.key + '#' + at : g.key, { at, n: o / STRIDE - at, x0: GB.x0, x1: GB.x1, y0: GB.y0, y1: GB.y1, z0: GB.z0, z1: GB.z1, jit: g.jit || 0 });
    }
    K.end = o / STRIDE;
    kept = K;
    massLayout(data, gl.DYNAMIC_DRAW);
    keptFinish(K);
    return count;
  }
  // ranges, bounds, count and meshBuild from the slots, as uploadGroups leaves them.
  function keptFinish(K) {
    const rs = [];
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const sl of K.slots.values()) {
      if (!sl.n) continue;
      rs.push({ at: sl.at, n: sl.n, x0: sl.x0, x1: sl.x1, y0: sl.y0, y1: sl.y1, z0: sl.z0, z1: sl.z1, jit: sl.jit });
      if (sl.x0 < bx0) bx0 = sl.x0; if (sl.x1 > bx1) bx1 = sl.x1;
      if (sl.y0 < by0) by0 = sl.y0; if (sl.y1 > by1) by1 = sl.y1;
      if (sl.z0 < bz0) bz0 = sl.z0; if (sl.z1 > bz1) bz1 = sl.z1;
    }
    rs.sort((a, b) => a.at - b.at);
    ranges = rs;
    count = K.end;
    meshBuild++;
    bounds = rs.length ? { x0: bx0, x1: bx1, y0: by0, y1: by1, z0: Math.min(0, bz0), z1: bz1 } : null;
  }
  // The kept buffer's frame to the window's, set by world.js every frame (0 for uploadGroups).
  let massShift = [0, 0];
  function setMassShift(x, y) { if (x !== massShift[0] || y !== massShift[1]) massShift = [x, y]; }
  // A column-major view-projection that takes the buffer's frame, from one that takes the window's.
  function shiftVP(m, sh) {
    const sx = sh[0], sy = sh[1];
    if (!sx && !sy) return m;
    const r = Array.from(m);
    for (let i = 0; i < 4; i++) r[12 + i] = m[12 + i] + sx * m[i] + sy * m[4 + i];
    return r;
  }
  let boundsW = null, boundsWOf = null, boundsWS = null;
  function boundsInWindow() {
    if (!bounds || (!massShift[0] && !massShift[1])) return bounds;
    if (boundsWOf !== bounds || boundsWS !== massShift) {
      const [sx, sy] = massShift;
      boundsW = { x0: bounds.x0 + sx, x1: bounds.x1 + sx, y0: bounds.y0 + sy, y1: bounds.y1 + sy, z0: bounds.z0, z1: bounds.z1 };
      boundsWOf = bounds; boundsWS = massShift;
    }
    return boundsW;
  }
  // What the buffer holds now, for scripts/perf/recentre-exact.mjs: the live ranges' floats and the shift.
  let dbgData = null;
  function massDebug() { const data = kept ? kept.data : dbgData; return data ? { data, ranges, shift: massShift.slice(), count, kept: !!kept } : null; }

  // One mesh at the origin, the way the model preview and the bench hand it over.
  function upload(faces) { return uploadGroups([{ faces }], null); }

  // The sun pass, run from inside `draw`. ⚠ It binds its own framebuffer, so it must run before the
  // clear and the canvas viewport and restore both. Returns the shader's uniforms, or null (off).
  function sunPass(opts) {
    const s = opts.sunShadow;
    if (!s || !(s.str > 0) || !s.lightVP || !count) return null;
    if (!shadow && !shadowTried) {
      shadowTried = true;                     // one attempt per view; a driver that refused once will refuse again
      try { shadow = createShadowLayer(gl, loc.pos); } catch { shadow = null; }
    }
    if (!shadow) return null;
    const vp = s.lightVP;
    // Drawn through the shifted matrix (massShift), and again when the shift moves.
    if (!(sunKept && sunKept.build === meshBuild && sunKept.count === count && vpClose(sunKept.vp, vp)
        && sunKept.sx === massShift[0] && sunKept.sy === massShift[1])) {
      timed('shadow', () => shadow.render(vao, count, shiftVP(vp, massShift)));
      sunKept = { build: meshBuild, count, vp: Array.from(vp), sx: massShift[0], sy: massShift[1] };
    }
    return shadow;
  }
  // The sun's map is redrawn only when the mesh or the light matrix changes ("same" is within 2e-4 of
  // its largest entry, about a third of a texel). ⚠ Lookups use the matrix it was drawn with (`sunVP`).
  let sunKept = null;
  function vpClose(a, b) {
    let m = 0, d = 0;
    for (let i = 0; i < 16; i++) { const x = Math.abs(a[i]), e = Math.abs(a[i] - b[i]); if (x > m) m = x; if (e > d) d = e; }
    return d <= m * 2e-4;
  }
  const sunVP = (opts) => (sunKept ? sunKept.vp : opts.sunShadow.lightVP);

  // ── AND WHAT STANDS IN THE STREET, ON A MAP OF ITS OWN ──────────────────────
  // gl/propshadow.js. Run beside sunPass for sunPass's reasons (its own framebuffer, so before the
  // clear), but EVERY frame it is asked for: what it holds moves. `propFrame` is this frame's answer,
  // kept for the ground, which draws later and reads the same map (drawGround). null is off.
  let propLayer = null, propTried = false, propFrame = null;
  function propPass(opts) {
    const P = opts.propShadow;
    propFrame = null;
    if (!P || !P.sun) return null;
    if (!propLayer && !propTried) {
      propTried = true;
      try { propLayer = createPropShadowLayer(gl); } catch { propLayer = null; }
    }
    if (!propLayer) return null;
    const r = timed('propshadow', () => propLayer.render(P.sun, P.eye, P.fwd, P.casters));
    propFrame = r ? { ...r, wall: P.wall, ground: P.ground } : null;
    return propFrame;
  }

  // Screen-space occlusion, before the clear for sunPass's reason.
  // ⚠ Takes the camera's frame height (CSS px), never the canvas's; the error is zero at dpr 1, so
  // headless tests can't see it. See docs/reference/glass-notes.md#projection-matrix-units.
  // The ink lines (RENDER_TUNE.glInk) come out of the same pass. Returns { ao, ink } or null.
  function ssaoPass(cam, opts, W, H) {
    const wantAo = opts.ssao > 0, wantInk = opts.ink > 0;
    if (!(wantAo || wantInk) || !count || !cam) return null;
    if (!ssao && !ssaoTried) {
      ssaoTried = true;                       // one attempt per view; a driver that refused once will refuse again
      try { ssao = createSSAOLayer(gl, loc.pos); } catch { ssao = null; }
    }
    if (!ssao) return null;
    const camH = opts.cssH || cam.H || H;
    const vp = viewProjMatrix({ ...cam, H: camH }, camH);
    // ⚠ The same z row the matrix was built from, or the occlusion radius means something else.
    const [A, B] = zRow((cam && cam.near) || NEAR);
    try {
      // At a fraction of the frame (`glSsaoRes`); contact shadow is low frequency.
      const rs = opts.ssaoRes > 0 && opts.ssaoRes < 1 ? opts.ssaoRes : 1;
      const aoWH = wantAo ? [Math.max(1, Math.round(W * rs)), Math.max(1, Math.round(H * rs))] : null;
      // The lines at the full backing store, never at the occlusion's fraction: a line is a pixel wide.
      const inkWH = wantInk ? [W, H] : null;
      return timed('ssao', () => ssao.pass(vao, count, new Float32Array(vp), { ...cam, H: camH }, aoWH, inkWH,
        { A, B, radius: opts.ssaoRadius > 0 ? opts.ssaoRadius : 0.5, bias: opts.ssaoBias > 0 ? opts.ssaoBias : 0.02,
          // The mass's depth through the kept buffer's frame (massShift); the tents' stays on `vp`.
          massVP: massShift[0] || massShift[1] ? new Float32Array(shiftVP(vp, massShift)) : null,
          inkStep: opts.inkStep, inkCrease: opts.inkCrease, inkSteep: opts.inkSteep,
          // The tents take the lines too: their depth goes in with the mass's (gl/cloth.js).
          extraDepth: wantInk && clothInst ? (vp) => clothLayer().drawDepth(vp, cam) : null }));
    } catch { return null; }
  }

  // The float target, or the canvas. ⚠ Bound here and nowhere earlier: the prepasses unbind to null.
  // Returns whether the float path is live (a composite is owed).
  function beginTarget(opts) {
    targetLive = false;
    LIN.out = 0;
    if (!(opts.hdr > 0)) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    if (!hdr && !hdrTried) {
      hdrTried = true;                        // one attempt per view; a driver that refused once will refuse again
      try { hdr = createHDRLayer(gl); } catch { hdr = null; }
    }
    if (!hdr || !hdr.bind(canvas.width, canvas.height)) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    targetLive = true;
    // Linear light only ever lives in the float target (RENDER_TUNE.glLinear; see colour.js).
    LIN.out = opts.linear > 0 ? 1 : 0;
    return true;
  }

  // Whether this frame draws into the float buffer; emissive gains read this, never `opts.hdr`.
  function hdrLive() { return targetLive; }

  // The TAA split (RENDER_TUNE.glTaa): see `split` in hdr.js. False, with the frame left as it was,
  // when the float target isn't live or the resolve can't run.
  function taaSplit(o) { return !!(hdr && targetLive && hdr.split && hdr.split(o)); }

  // A no-op when the float path isn't live, so callers can call it unconditionally.
  function composite(opts = {}) {
    // A linear target is encoded back to display values at the end of the composite.
    return hdr ? hdr.composite({ ...opts, linear: targetLive ? LIN.out : 0 }) : null;
  }

  // The peak in the float target, for a bench (null with no float path; see hdr.js).
  function hdrPeak() { return hdr && hdr.peak ? hdr.peak() : null; }

  // What this frame's main `draw` handed the fade pass: its env cube, sun map and SSAO, or null
  // when it did not split the band off.
  let fadeKept = null;
  function draw(cam, opts = {}) {
    // ⚠ The mirror pass re-enters here with `intoTarget` = [w, h]: a framebuffer already bound and
    // cleared. The target isn't rebound or cleared, and the sun and SSAO passes must not run (they'd
    // unbind it, and they describe the unreflected view).
    // ⚠ The fade pass (drawFade) re-enters too, reusing this frame's prepasses as they are.
    const fade = opts.fadePass === 2;
    if (fade && !fadeKept) return 0;
    // The reflection cube, refreshed when the sky changes; before the target is bound (it binds its own).
    let envTex = fade ? fadeKept.envTex : null;
    if (!fade && opts.envCube > 0 && opts.envSky) {
      if (!envCube) envCube = createEnvCube(gl);
      envTex = envCube.update(opts.envSky, opts.envDn || null);
    }
    const into = opts.intoTarget || null;
    const sun = fade ? fadeKept.sun : (into || opts.skipMass) ? null : sunPass(opts);
    // The city's sun map, kept for the cabin: a cockpit parked in a building's shadow is in it too.
    // ⚠ A COPY OF THE MATRIX, never mat4f's: that one is a shared scratch the next draw overwrites.
    if (!into && !fade) worldSun = sun ? { tex: sun.tex, vp: new Float32Array(sunVP(opts)), texel: sun.texel, bias: opts.sunShadow.bias } : null;
    // Not skipped with the mass: the road reads it too. The mirror draws without it.
    const prop = fade ? fadeKept.prop : into ? null : propPass(opts);
    const W = into ? into[0] : canvas.width, H = into ? into[1] : canvas.height;
    const occl = fade ? fadeKept.occl : into ? null : ssaoPass(cam, opts, W, H);
    const ssaoTex = occl ? occl.ao : null, inkTex = occl ? occl.ink : null;
    if (!fade && !into) inkFrame = null;   // set again below when this pass has lines; the cloth reads it
    if (!into && !fade) beginTarget(opts);
    if (!into) gl.viewport(0, 0, W, H);
    // Split only on the screen and only with a band (the mirror has no floor drawn after it).
    const split = !into && !fade && !!opts.fadeSplit && opts.hazeNear != null && !opts.skipMass && count > 0;
    if (!fade) fadeKept = split ? { envTex, sun, occl, prop } : null;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // ⚠ No backface cull: buildings aren't closed (soffits, canopy undersides).
    gl.disable(gl.CULL_FACE);
    const sky = opts.sky || [0.09, 0.11, 0.14];
    // ⚠ Premultiplied, as the canvas is: a transparent clear must carry no colour.
    const ca = opts.clearAlpha == null ? 1 : opts.clearAlpha;
    // ⚠ Never clear somebody else's target: the mirror clears itself transparent.
    if (!into && !fade) {
      gl.clearColor(sky[0] * ca, sky[1] * ca, sky[2] * ca, ca);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!count) return 0;

    // RENDER_TUNE.glLinear 2: output is already linear. Float target only (LIN.out; colour.js).
    const linIn = LIN.out > 0 && opts.linear >= 2;
    const cIn = linIn ? linRgb : (c) => c;
    gl.useProgram(prog); applyLinOut(gl, prog, linIn ? 0 : LIN.out);
    gl.uniform1f(loc.linIn, linIn ? 1 : 0);
    // The camera's frame height (CSS px), never the canvas's (device px). Falls back to H.
    const vpA = viewProjMatrix(cam, opts.cssH || H);
    gl.uniformMatrix4fv(loc.viewProj, false, mat4f(vpA));
    gl.uniform2f(loc.massShift, massShift[0], massShift[1]);
    const k = opts.keyDir || [-0.7, 0.35, -0.7];
    gl.uniform3f(loc.keyDir, k[0], k[1], k[2]);
    // ⚠ `shadow` is the vertex-light base colour and `sunShadow` is the sun. An object in `shadow`
    // makes `sh[0]` undefined, which uniform3f turns into NaN silently (a black city), so its shape
    // is checked.
    const key = opts.key || [0.78, 0.59, 0.33];
    let sh = opts.shadow;
    if (sh && !Array.isArray(sh)) { if (!warnedShadowShape) { warnedShadowShape = true; console.warn('GLASS 2: draw({shadow}) wants an [r,g,b]; got', sh, '— the sun descriptor belongs in sunShadow'); } sh = null; }
    sh = cIn(sh || [0.13, 0.16, 0.21]);
    const skyC = cIn(opts.skyTint || [0.59, 0.62, 0.59]);
    const keyC = cIn(key);
    gl.uniform3f(loc.key, keyC[0], keyC[1], keyC[2]);
    gl.uniform3f(loc.shadow, sh[0], sh[1], sh[2]);
    gl.uniform3f(loc.sky, skyC[0], skyC[1], skyC[2]);
    gl.uniform1f(loc.str, opts.str == null ? 1 : opts.str);
    gl.uniform1f(loc.worldBlend, opts.worldBlend == null ? 1 : opts.worldBlend);
    const fogC = cIn(opts.fog || sky);
    gl.uniform3f(loc.fog, fogC[0], fogC[1], fogC[2]);
    gl.uniform1f(loc.fogNear, opts.fogNear == null ? 6 : opts.fogNear);
    gl.uniform1f(loc.fogFar, opts.fogFar == null ? 34 : opts.fogFar);
    gl.uniform1f(loc.fogAmt, opts.fogAmt == null ? 0 : opts.fogAmt);
    // No haze band means none (the preview and the bench); a world pass always gives one.
    gl.uniform1f(loc.hazeNear, opts.hazeNear == null ? 1e6 : opts.hazeNear);
    gl.uniform1f(loc.hazeFar, opts.hazeFar == null ? 1e6 + 1 : opts.hazeFar);
    gl.uniform1f(loc.fadePass, fade ? 2 : split ? 1 : 0);
    gl.uniform1f(loc.vlight, opts.vlight == null ? 1 : opts.vlight);
    gl.uniform1f(loc.nightDim, opts.nightDim == null ? 1 : opts.nightDim);
    // Contact occlusion. Absent means OFF and the shader multiplies by exactly 1.0.
    gl.uniform1f(loc.ao, opts.ao == null ? 0 : opts.ao);
    gl.uniform1f(loc.bakedAo, opts.bakedAo == null ? 0 : opts.bakedAo);
    gl.uniform1f(loc.aoFall, opts.aoFall == null ? 1.6 : opts.aoFall);
    // `opts.lights`: { p, rgb, r } in the vertices' frame, already the strongest few (world.js).
    const lights = opts.lights || [];
    // ⚠ Capped here too: a longer list would write past the end of the uniform arrays.
    const nL = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < nL; i++) {
      const L = lights[i];
      lightP[i * 3] = L.p[0]; lightP[i * 3 + 1] = L.p[1]; lightP[i * 3 + 2] = L.p[2];
      // A light's colour arrives scaled by its strength, so at level 2 the product is decoded as one.
      const lc = linIn ? linRgb(L.rgb) : L.rgb;
      lightC[i * 3] = lc[0]; lightC[i * 3 + 1] = lc[1]; lightC[i * 3 + 2] = lc[2];
      // Falls back to the weighted colour, so the array never keeps a previous frame's numbers.
      const raw = linIn ? linRgb(L.rgbRaw || L.rgb) : (L.rgbRaw || L.rgb);
      lightRaw[i * 3] = raw[0]; lightRaw[i * 3 + 1] = raw[1]; lightRaw[i * 3 + 2] = raw[2];
      // ⚠ `rw` is the wall's reach; `r` is the wet road's.
      lightR[i] = L.rw == null ? L.r : L.rw;
      // The lamp's reach for the lift: the road's reach, or 0 for a caller that sets no lift.
      lightLR[i] = L.rl || 0;
    }
    gl.uniform1i(loc.nLight, nL);
    gl.uniform1f(loc.lampLift, opts.lampLift > 0 ? opts.lampLift : 0);
    gl.uniform1f(loc.signLift, opts.signLift > 0 ? opts.signLift : 0);
    // With the grid, the lift, wash and wet lobe walk the cell's lights instead of the slots; the
    // slots still go up for the light shaft. Walked only when one of those terms is live (`gridWall`).
    bindWallGrid(loc, 8);
    if (!(opts.gridWall && wallGridNow)) gl.uniform1i(loc.uLGOn, 0);
    if (nL) {
      gl.uniform3fv(loc.lightP, lightP); gl.uniform3fv(loc.lightC, lightC); gl.uniform3fv(loc.lightRaw, lightRaw); gl.uniform1fv(loc.lightR, lightR); gl.uniform1fv(loc.lightLR, lightLR);
      gl.uniform1f(loc.lightWrap, opts.lightWrap == null ? 0 : opts.lightWrap);
      // ⚠ Defaults to 2; 0 would be pow(att, 0.0) = 1.0, a light with no falloff.
      gl.uniform1f(loc.lightFocus, opts.lightFocus > 0 ? opts.lightFocus : 2);
    }
    // ⚠ Every strength and weather uniform below is written every frame, never conditionally: a
    // uniform keeps its last value. See docs/reference/glass-notes.md#uniforms-are-written-every-frame.
    const matStr = opts.mat && opts.mat.length ? (opts.matStr == null ? 1 : opts.matStr) : 0;
    gl.uniform1f(loc.matStr, matStr);
    // ⚠ Every frame, snow or not.
    gl.uniform1f(loc.snow, opts.snow || 0);
    // ⚠ Every frame, rain or not (the trap `gl:snow` catches).
    gl.uniform1f(loc.wet, opts.wet || 0);
    // Every frame, fog or not.
    gl.uniform1f(loc.fogH, opts.fogH || 0);
    gl.uniform1f(loc.fogHScale, opts.fogHScale > 0 ? opts.fogHScale : 0.5);
    gl.uniform1f(loc.scatter, opts.scatter || 0);
    // ⚠ Every frame, unconditionally.
    gl.uniform1f(loc.bevel, opts.bevel > 0 ? opts.bevel : 0);
    gl.uniform1f(loc.bevelTilt, opts.bevelTilt == null ? 1 : opts.bevelTilt);
    if (matStr > 0) {
      gl.uniform1f(loc.bumpStr, opts.bumpStr == null ? 1 : opts.bumpStr);
      gl.uniform1f(loc.metalRefl, opts.metalRefl == null ? 1 : opts.metalRefl);
      if (opts.mat !== matSrc) {
        matSrc = opts.mat;
        glassRow = Math.max(0, Math.min(MAX_MATERIALS - 1, opts.mat.findIndex((r) => r && r.name === 'glass')));
        for (let i = 0; i < MAX_MATERIALS; i++) {
          const r = opts.mat[i];
          // ⚠ A row past the table keeps the harmless default (gloss 0 is a mirror).
          matTab[i * 4] = r ? r.gloss : 1;
          matTab[i * 4 + 1] = r ? r.metal : 0;
          matTab[i * 4 + 2] = r ? r.fres : 0;
          matTab[i * 4 + 3] = r ? r.bump : 0;
          sheenTab[i] = r ? r.sheen : 0;
          // ⚠ A row past the end takes the old expression, never 0 (no sun at all).
          specTab[i] = r ? r.spec : 0.15;
        }
      }
      gl.uniform4fv(loc.matTab, matTab);
      gl.uniform1fv(loc.sheenTab, sheenTab);
      gl.uniform1fv(loc.specTab, specTab);
      gl.uniform1f(loc.specStr, opts.specStr == null ? 1 : opts.specStr);
      const eye = opts.eye || [0, 0, 0];
      gl.uniform3f(loc.eye, eye[0], eye[1], eye[2]);
      const eu = opts.envUp ? cIn(opts.envUp) : skyC, ed = opts.envDn ? cIn(opts.envDn) : sh;
      gl.uniform3f(loc.envUp, eu[0], eu[1], eu[2]);
      gl.uniform3f(loc.envDn, ed[0], ed[1], ed[2]);
      // Zero with no page, which makes the relief gradient exactly 0.
      gl.uniform2f(loc.atlasTexel, atlasW ? 1 / atlasW : 0, atlasH ? 1 / atlasH : 0);
    }
    // The skyline the reflection samples. ⚠ Outside the `opts.mat !== matSrc` guard, which runs once.
    // Unit 3 (0 atlas, 1 sun depth, 2 SSAO).
    const strip = skyline ? skyline.tex : null;
    gl.uniform1f(loc.envCity, strip ? (opts.envCity == null ? 1 : opts.envCity) : 0);
    gl.uniform1f(loc.envDim, opts.envDim == null ? 0.62 : opts.envDim);
    if (strip) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, strip); gl.uniform1i(loc.envStrip, 3); }
    const textured = hasAtlas && opts.textured !== false;
    gl.uniform1f(loc.textured, textured ? 1 : 0);
    if (textured) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(loc.atlas, 0); }
    // ⚠ Unit 4 is bound every draw, to the page or to nothing, or a stale render target there is a
    // feedback loop and the draw is dropped (docs/reference/glass-notes.md#a-pass-that-didnt-draw).
    const pageOn = textured && hasMatPage && opts.matPage > 0;
    gl.uniform1f(loc.matPageOn, pageOn ? 1 : 0);
    gl.uniform1i(loc.glassMat, glassRow);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, pageOn ? matPageTex : null); gl.uniform1i(loc.matPage, 4);
    // ⚠ Unit 5 is the cube, bound every draw for unit 4's reason; no 2-D sampler may use it.
    gl.uniform1f(loc.envCubeOn, envTex ? 1 : 0);
    gl.uniform1f(loc.envMaxLod, ENV_MAX_LOD);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_CUBE_MAP, envTex); gl.uniform1i(loc.envCube, 5);
    gl.uniform1f(loc.ggx, opts.ggx > 0 ? 1 : 0);
    // Unit 6: the surface page, bound on every draw to the page or to nothing, for unit 4's reason.
    const surfOn = textured && hasSurfPage && opts.surfPage > 0;
    gl.uniform1f(loc.surfPageOn, surfOn ? 1 : 0);
    gl.uniform1f(loc.heightGain, opts.heightGain > 0 ? opts.heightGain : 0.33);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, surfOn ? surfPageTex : null); gl.uniform1i(loc.surfPage, 6);
    // ⚠ Every frame, sun or not.
    gl.uniform1f(loc.shadowStr, sun ? opts.sunShadow.str : 0);
    if (sun) {
      gl.uniformMatrix4fv(loc.lightVP, false, mat4f(sunVP(opts)));
      gl.uniform1f(loc.shadowTexel, sun.texel);
      gl.uniform1f(loc.shadowBias, opts.sunShadow.bias);
      const d = opts.sunShadow.sunDir;
      gl.uniform3f(loc.sunDir, d[0], d[1], d[2]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sun.tex);
      gl.uniform1i(loc.shadowMap, 1);
    }
    // Unit 11, clear of the light grid's 8 to 10. Written every draw, on or off, for the reason the
    // strength above is; the mirror passes null and so reflects no prop shadow.
    bindPropShadow(gl, loc, 11, prop);
    gl.uniform1f(loc.propWall, prop ? prop.wall : 0);
    // ⚠ Every frame, including when the SSAO pass declined; zero is the exact off switch.
    gl.uniform1f(loc.ssaoStr, ssaoTex ? (opts.ssao > 1 ? 1 : opts.ssao) : 0);
    if (ssaoTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, ssaoTex);
      gl.uniform1i(loc.ssao, 2);
      // The backing-store size (device px), since it divides gl_FragCoord.
      gl.uniform2f(loc.viewport, W, H);
    }
    // The cel look (RENDER_TUNE.glToon, glInk), every frame. ⚠ Unit 7, bound every draw (unit 4's reason).
    gl.uniform1f(loc.toon, opts.toon > 0 ? Math.min(1, opts.toon) : 0);
    gl.uniform1f(loc.toonBands, opts.toonBands > 0 ? opts.toonBands : 3);
    gl.uniform1f(loc.inkStr, inkTex ? Math.min(1, opts.ink) : 0);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, inkTex); gl.uniform1i(loc.ink, 7);
    if (inkTex) {
      // Outlines hold to `far`; detail is gone by under half of it.
      const far = opts.inkFar > 0 ? opts.inkFar : 24;
      gl.uniform4f(loc.inkFade, far * 0.15, far * 0.45, far * 0.35, far);
      const ic = cIn(opts.inkCol || INK_COL);
      gl.uniform3f(loc.inkCol, ic[0], ic[1], ic[2]);
      gl.uniform2f(loc.viewport, W, H);
      if (!into) inkFrame = { tex: inkTex, str: Math.min(1, opts.ink), fade: [far * 0.15, far * 0.45, far * 0.35, far], col: ic, W, H };
    }
    gl.bindVertexArray(vao);
    // skipMass (plugins/submersible): the eye is under the sea. The clear still runs.
    if (fade) {
      // Depth first, or a dissolving block's back walls show through (no backface cull).
      const runs = fadeRuns(shiftVP(vpA, massShift), opts.hazeNear, opts.hazeFar);   // the ranges are in the buffer's frame
      gl.colorMask(false, false, false, false);
      for (let i = 0; i < runs.length; i += 2) gl.drawArrays(gl.TRIANGLES, runs[i], runs[i + 1]);
      gl.colorMask(true, true, true, true);
      gl.depthMask(false);
      for (let i = 0; i < runs.length; i += 2) gl.drawArrays(gl.TRIANGLES, runs[i], runs[i + 1]);
      gl.depthMask(true);
    } else if (!opts.skipMass) gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    return count;
  }

  // The buildings dissolving at the draw limit (uFadePass), drawn after the floor, sea and roads
  // with `draw`'s camera and options. See docs/reference/glass-notes.md#the-far-dissolve-over-the-ground-render_tuneglhazesplit.
  // fadeRuns: only tiles whose box reaches the band (clip.w is linear, so the corners are exact), as
  // flat [first, count] pairs, neighbours merged, in a reused array.
  const fadeBuf = [];
  function fadeRuns(m, near, far) {
    const out = fadeBuf;
    out.length = 0;
    const a = m[3], b = m[7], c = m[11], d = m[15];
    for (const R of ranges) {
      const ax0 = a * R.x0, ax1 = a * R.x1, by0 = b * R.y0, by1 = b * R.y1, cz0 = c * R.z0, cz1 = c * R.z1;
      const lo = d + (ax0 < ax1 ? ax0 : ax1) + (by0 < by1 ? by0 : by1) + (cz0 < cz1 ? cz0 : cz1);
      const hi = d + (ax0 > ax1 ? ax0 : ax1) + (by0 > by1 ? by0 : by1) + (cz0 > cz1 ? cz0 : cz1);
      if (hi < near - R.jit - 1e-3 || lo > far - R.jit + 1e-3) continue;
      const k = out.length;
      if (k && out[k - 2] + out[k - 1] === R.at) out[k - 1] += R.n;
      else out.push(R.at, R.n);
    }
    return out;
  }
  function drawFade(cam, opts = {}) { return draw(cam, { ...opts, fadePass: 2 }); }

  // The lights, on the same depth buffer. Lazy, like the layers below.
  let sprites = null;
  const spriteLayer = () => (sprites || (sprites = createSpriteLayer(gl)));
  // ⚠ Two heights: the matrix takes the camera's (CSS px), the viewport the canvas's (device px).
  function drawSprites(cam, list, cssH, intensity) {
    if ((!list || !list.length) && !sprites) return 0;
    const L = spriteLayer(), w = windowFrame(cam), sp = splitGroups(list || [], w.ox, w.oy);
    L.upload(sp.rest, w.ox, w.oy, sp.groups);
    return L.draw(w.cam, canvas.width, canvas.height, cssH, intensity);
  }

  // The cloud deck, a second pass over the same depth buffer (gl/clouds.js).
  let clouds = null;
  const cloudLayer = () => (clouds || (clouds = createCloudLayer(gl)));
  function drawCloudDeck(cam, cards, cssH, opts = {}) {
    if (!cards || !cards.length) return 0;
    const L = cloudLayer();
    if (opts.noise) L.setNoise(opts.noise);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // ⚠ Colour only: clearing depth puts every cloud in front of every tower.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    L.upload(cards);
    return L.draw(cam, canvas.width, canvas.height, cssH, opts);
  }

  // The deck as a raymarched volume (RENDER_TUNE.glCloudVol; gl/cloudvol.js), replacing the cards.
  let cloudVol = null;
  function drawCloudVolume(cam, vol, cssH, opts = {}) {
    if (!vol || !vol.cells || !vol.cells.length) return 0;
    if (!cloudVol) cloudVol = createCloudVolume(gl);
    return cloudVol.draw(cam, canvas.width, canvas.height, cssH, vol, { ...opts, fb: hdr ? hdr.drawFbo : null });
  }

  // The Curtain. Lazy.
  let curtain = null;
  const curtainLayer = () => (curtain || (curtain = createCurtainLayer(gl)));
  function drawCurtain(cam, list, cssH, now) {
    if (!list || !list.length) return 0;
    const L = curtainLayer();
    L.upload(list);
    return L.draw(cam, cssH || canvas.height, now);
  }

  // Signage, on the same depth buffer. Lazy like the others.
  let decals = null;
  const decalLayer = () => (decals || (decals = createDecalLayer(gl)));
  function drawDecals(cam, list, cssH, emitGain = 0, neon = null, lit = null) {
    if ((!list || !list.length) && !decals) return 0;
    const L = decalLayer(), w = windowFrame(cam), sp = splitGroups(list || [], w.ox, w.oy);
    L.upload(sp.rest, w.ox, w.oy, sp.groups);
    return L.draw(w.cam, cssH || canvas.height, emitGain, neon, lit);
  }
  // What that cost in BINDS, which is the figure that tracks the clock — see the ⚠ in decals.js.
  const decalCost = () => (decals ? { batches: decals.batches, textures: decals.textures, minted: decals.minted } : { batches: 0, textures: 0, minted: 0 });

  // The wires. Lazy.
  let strokes = null;
  const strokeLayer = () => (strokes || (strokes = createStrokeLayer(gl)));
  function drawStrokes(cam, list, cssH) {
    if ((!list || !list.length) && !strokes) return 0;
    const L = strokeLayer(), w = windowFrame(cam), sp = splitGroups(list || [], w.ox, w.oy);
    L.upload(sp.rest, w.ox, w.oy, sp.groups);
    return L.draw(w.cam, canvas.width, canvas.height, cssH);
  }

  // Ground scatter, on the same depth buffer. Lazy like the others.
  let bbs = null;
  const bbLayer = () => (bbs || (bbs = createBillboardLayer(gl)));
  // How many billboard textures the cache holds (an overfull cache looks like corrupted artwork).
  const billboardTextures = () => (bbs ? bbs.textures : 0);
  function drawBillboards(cam, list, cssH, fog, snow, lights) {
    if (!list || !list.length) return 0;
    const L = bbLayer();
    L.upload(list);
    return L.draw(cam, canvas.width, canvas.height, cssH, fog, snow, lights);
  }

  // The puddle reflection, a prepass: binds its own framebuffer and restores null, before `beginTarget`.
  // ⚠ It re-uploads the sprite and decal buffers on purpose, so the main pass never depends on it.
  let mirror = null;
  const mirrorLayer = () => (mirror || (mirror = createMirrorLayer(gl)));
  // The city in the glass. Lazy.
  let skyline = null;
  const skylineLayer = () => (skyline || (skyline = createSkylineStrip(gl)));
  // ⚠ THE MIRROR IS AN EIGHT-BIT BUFFER OF DISPLAY VALUES, whatever the frame's own target is, so
  // every layer drawn into it is told so (colour.js) and told back afterwards.
  function drawMirror(cam, opts = {}) {
    const was = LIN.out;
    LIN.out = 0;
    try { return drawMirrorInto(cam, opts); } finally { LIN.out = was; }
  }
  function drawMirrorInto(cam, opts = {}) {
    const sp = opts.sprites, dc = opts.decals, cl = opts.clouds;
    // ⚠ The rig and the cloud deck count as something to reflect, not only lights and signs.
    if (!(sp && sp.length) && !(dc && dc.length) && !(cl && cl.length) && !solidQuads) return null;
    let M;
    try { M = mirrorLayer(); } catch { return null; }
    if (!M.bind(canvas.width, canvas.height, opts.scale)) return null;
    // The water's plane: z = 0 in every frame.
    const mcam = { ...cam, mirrorZ: opts.plane || 0 };
    // ⚠ The mesh is in map-window tiles, so it needs its own mirrored camera (the shifted `camAt`);
    // the plain one slides the reflection by the window offset. Both land on the same pixels.
    const mMassCam = opts.massCam ? { ...opts.massCam, mirrorZ: opts.plane || 0 } : mcam;
    const cssH = opts.cssH || canvas.height;
    try {
      // ⚠ The mass goes first: it writes the depth signs and glows test against.
      // Optional (`glMirrorMass 0`), as the one costly part of this pass.
      const size = M.size;
      if (opts.mass !== 0 && count) {
        draw(mMassCam, { ...(opts.massOpts || {}), intoTarget: size, cssH,
          // ⚠ No shadows, SSAO or bloom in the water: all three describe the unreflected view.
          sunShadow: null, ssao: 0, hdr: 0 });
      }
      // The rig, solid, with the mass. ⚠ It takes the mass camera (map-window tiles, like the mesh).
      if (solidQuads || faunaInst || actorInst || clothInst || cloudList.length) drawSolids(mMassCam, cssH, { fog: opts.fog || null, actors: true, noInk: true });
      // The cloud deck, so the puddle shows sky. ⚠ Plain mirrored camera (the cards are in `cam`'s
      // frame), after the mass, and the canvas's viewport: sizes become NDC offsets, so the half-size
      // buffer's own viewport would double every cloud.
      if (cl && cl.length) {
        const L = cloudLayer(), cs = opts.cloudState || {};
        if (cs.noise) L.setNoise(cs.noise);
        L.upload(cl);
        L.draw(mcam, canvas.width, canvas.height, cssH, cs);
      }
      // Signage, then lights over it, as in the frame.
      if (dc && dc.length) { const L = decalLayer(); L.upload(dc); L.draw(mcam, cssH); }
      // ⚠ Intensity 1, not the emissive gain: this buffer is eight bits and the gain clips to white.
      // ⚠ The canvas's viewport, for the clouds' reason (2·R/viewport is an NDC offset).
      if (sp && sp.length) { const L = spriteLayer(); L.upload(sp); L.draw(mcam, canvas.width, canvas.height, cssH, 1); }
    } catch (e) {
      // ⚠ Warn once: a throw here looks exactly like a machine that can't do the pass.
      if (!drawMirror._warned) { drawMirror._warned = true; console.warn('[gl] the reflection pass threw — falling back to a road with no image in it', e); }
      M.release(); return null;
    }
    M.release();
    return M.texture;
  }

  // What the reflection buffer holds, for a bench (see peak() in mirror.js).
  const mirrorPeak = (step) => (mirror && mirror.peak ? mirror.peak(step) : null);

  // The road surface. Lazy like the others; a view over open water never compiles it.
  let grd = null;
  const groundLayer = () => (grd || (grd = createGroundLayer(gl)));
  // The frame's painted sky as a 256x128 texture (`captureSkyStrip`), re-uploaded every frame.
  // ⚠ Set flip off explicitly: UNPACK_FLIP_Y_WEBGL is context-global, and a flipped sky still looks
  // like a smooth gradient. ⚠ CLAMP_TO_EDGE: grazing pixels sample at v = 1.0 exactly.
  let skyStripTex = null;
  function uploadSkyStrip(src) {
    if (!src) return null;
    if (!skyStripTex) {
      skyStripTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, skyStripTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, skyStripTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch { return null; }   // a tainted or zero-sized source is a road with a gradient in it, not a dead frame
    return skyStripTex;
  }
  function drawGround(cam, quads, cssH, opts) {
    if (!quads || !quads.length) return 0;
    const L = groundLayer();
    L.upload(quads);
    if (opts) { opts.skyTex = uploadSkyStrip(opts.skyStrip); opts.prop = propFrame; }
    return L.draw(cam, cssH || canvas.height, opts);
  }

  // The vehicle you're in. ⚠ Uploaded once before the mirror prepass, drawn twice.
  let shp = null;
  const solidsLayer = () => (shp || (shp = createSolidsLayer(gl)));
  let solidQuads = 0;
  // Rig and shed share one buffer; the counts come back separately so a diagnostic can tell them apart.
  // Birds may arrive in the same list as instance records (`.inst`, gl/fauna.js), split out here.
  let fnl = null;
  const faunaLayer = () => (fnl || (fnl = createFaunaLayer(gl)));
  let faunaInst = 0;
  const instRecs = [];
  // People the same way (`.actor`, gl/actors.js).
  let acl = null;
  const actorLayer = () => (acl || (acl = createActorLayer(gl)));
  let actorInst = 0;
  const actorRecs = [];
  // Cloth the same way (`.cloth`, gl/cloth.js).
  let cll = null;
  const clothLayer = () => (cll || (cll = createClothLayer(gl)));
  let clothInst = 0;
  // The main pass's ink lines, for the cloth to draw on itself as the walls do (null: none).
  let inkFrame = null;
  const clothRecs = [];
  // ⚠ A murmuration is one record (`.cloud`), stepped here because this call precedes both passes.
  let mg = null;
  const murmurGPU = () => (mg || (mg = createMurmurGPU(gl)));
  const cloudList = [];
  function uploadSolids(lists) {
    const all = [];
    instRecs.length = 0;
    actorRecs.length = 0;
    clothRecs.length = 0;
    cloudList.length = 0;
    const clouds = [], groups = [];
    for (const l of lists) if (l && l.length) {
      // A retained group (bayGroup) goes over whole; see splitGroups.
      const G = l.groups;
      let gi = 0;
      for (let i = 0; i < l.length; i++) {
        while (G && gi < G.length && G[gi].at < i) gi++;
        if (G && gi < G.length && G[gi].at === i) {
          const recs = G[gi++].recs, n = recs.length;
          if (n && i + n <= l.length && l[i] === recs[0] && l[i + n - 1] === recs[n - 1]) { groups.push(recs); i += n - 1; continue; }
        }
        const q = l[i];
        if (q.cloud) clouds.push(q);
        else if (q.actor) actorRecs.push(q);
        else if (q.cloth) clothRecs.push(q);
        else (q.inst ? instRecs : all).push(q);
      }
    }
    // every cloud of the frame stepped under one save of the GL state, not one each
    if (clouds.length) {
      const done = murmurGPU().stepAll(clouds, { w: canvas.width, h: canvas.height });
      for (let i = 0; i < clouds.length; i++) {
        const st = done[i] && mg.state(clouds[i].key);
        if (st) cloudList.push({ rec: clouds[i], st });
      }
    }
    if (mg && clouds.length) mg.sweep(clouds[0].now);
    solidQuads = all.length || groups.length || shp ? solidsLayer().upload(all, null, null, null, null, groups) : 0;
    faunaInst = (instRecs.length || fnl) ? faunaLayer().upload(instRecs) : 0;
    actorInst = (actorRecs.length || acl) ? actorLayer().upload(actorRecs) : 0;
    clothInst = (clothRecs.length || cll) ? clothLayer().upload(clothRecs) : 0;
    return solidQuads;
  }
  // The own ship, in its own frame: local points (`mp`) plus one placement matrix, so only moved
  // faces re-upload. `ship` is the normal matrix and sun term (solids.js).
  let shpOwn = null, ownQuads = 0;
  const ownLayer = () => (shpOwn || (shpOwn = createSolidsLayer(gl)));
  function uploadShip(list, model, ship) {
    ownQuads = list && list.length && model ? ownLayer().upload(list, model, null, null, ship) : 0;
    return ownQuads;
  }
  function drawSolids(cam, cssH, opts) {
    let n = 0;
    opts = opts || {};
    opts.lightGrid = bindWallGrid;
    // The translucent range alone (`film` in solids.js); birds are drawn by the solid call.
    if (opts && opts.film) return (solidQuads ? solidsLayer().draw(cam, cssH || canvas.height, opts) : 0)
      + (ownQuads ? ownLayer().draw(cam, cssH || canvas.height, opts) : 0);
    if (solidQuads) n += solidsLayer().draw(cam, cssH || canvas.height, opts || {});
    if (ownQuads) n += ownLayer().draw(cam, cssH || canvas.height, opts || {});
    if (faunaInst) faunaLayer().draw(cam, cssH || canvas.height, opts || {});
    if (clothInst) clothLayer().draw(cam, cssH || canvas.height, { ...opts, ink: opts.noInk ? null : inkFrame });
    // People only for the mirror; the main pass draws them after the ground (drawActors).
    if (actorInst && opts && opts.actors) actorLayer().draw(cam, cssH || canvas.height, opts);
    if (cloudList.length) faunaLayer().drawClouds(cam, cssH || canvas.height, canvas.width, canvas.height, opts || {}, cloudList);
    return n;
  }

  function drawActors(cam, cssH, opts) {
    opts = opts || {};
    opts.lightGrid = bindWallGrid;
    return actorInst ? actorLayer().draw(cam, cssH || canvas.height, opts || {}) : 0;
  }

  // The interior, a viewmodel pass: the cab sits inside the world's near plane, so it gets its own
  // clip range and a cleared depth buffer (nothing in the world can be inside the cab). ⚠ It's a
  // second instance of the solids layer, never a copy. See
  // docs/reference/glass-notes.md#the-interior-as-a-viewmodel-pass.
  let intQuads = 0, intl = null, worldSun = null;
  const interiorLayer = () => (intl || (intl = createSolidsLayer(gl, { cabin: true })));
  // `model`, when the interior sends one, is its local-to-world matrix: the faces arrive in the cab's own
  // frame and only the parts that moved are re-sent (see the incremental mode in solids.js).
  // `light` is the frame's cabin light (pushInteriorShell): the room is shaded per pixel from it.
  function uploadInterior(list, model = null, light = null, att = null) {
    intQuads = list && list.length ? interiorLayer().upload(list, model && list.every((q) => q.mp) ? model : null, light, att) : 0;
    return intQuads;
  }
  // What the main pass draws into (float target or canvas), so a pass can restore it without a getParameter.
  const frameTarget = () => ({ fb: targetLive && hdr ? hdr.drawFbo : null, w: canvas.width, h: canvas.height });
  function drawInterior(cam, cssH, opts) {
    if (!intQuads) return 0;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const n = interiorLayer().draw(cam, cssH || canvas.height, { ...(opts || {}), near: INTERIOR_NEAR, far: INTERIOR_FAR, worldSun, target: frameTarget() });
    // THE GLASS, after the room: see-through, tested against the room and writing no depth (film).
    interiorLayer().draw(cam, cssH || canvas.height, { ...(opts || {}), near: INTERIOR_NEAR, far: INTERIOR_FAR, film: true });
    return n;
  }
  // The room drawn after the world is blitted under the bank rotation, so it isn't rotated with it.
  // ⚠ Cleared transparent, straight to the default framebuffer (multisampled).
  function drawInteriorAlone(cam, cssH, aloneUnder = 0, aloneUnderD = 0) {
    if (!intQuads) return 0;
    LIN.out = 0;   // straight onto the canvas, which holds display values (colour.js)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const n = interiorLayer().draw(cam, cssH || canvas.height, { near: INTERIOR_NEAR, far: INTERIOR_FAR, under: aloneUnder, underD: aloneUnderD, worldSun, target: { fb: null, w: canvas.width, h: canvas.height } });
    interiorLayer().draw(cam, cssH || canvas.height, { near: INTERIOR_NEAR, far: INTERIOR_FAR, film: true, under: aloneUnder, underD: aloneUnderD });
    return n;
  }

  // The ground itself. Lazy, and only ever built when RENDER_TUNE.glFloor asks for it.
  let flr = null;
  const floorLayer = () => (flr || (flr = createFloorLayer(gl)));
  function drawFloor(state, near) { if (state) state.prop = propFrame; return state ? floorLayer().draw(state, near) : 0; }

  // The displaced sea. Lazy. ⚠ It reads the floor's LUT (one answer for the coast), so it's drawn
  // after the floor.
  let wtr = null;
  const waterLayer = () => (wtr || (wtr = createWaterLayer(gl)));
  function drawWater(cam, state, cssH, refl) {
    if (!state || !(state.seaRoll > 0) || !(state.swell > 0)) return 0;
    const lut = flr && flr.lut;
    if (!lut) return 0;   // the floor has not uploaded yet; there is nothing to agree with
    // The sky arrives as a canvas (windshield.js may not import gl/); one cached texture serves sea and road.
    const r = refl ? { ...refl, sky: refl.sky ? uploadSkyStrip(refl.sky) : null } : null;
    return waterLayer().draw(cam, state, cssH, lut, r);
  }

  // The underwater half (plugins/submersible; gl/seabed.js). Lazy.
  let sbd = null;
  const seabedLayer = () => (sbd || (sbd = createSeabedLayer(gl)));
  const drawSeabed = (cam, s, cssH, dpr, eye, t) => (s ? seabedLayer().drawBottom(cam, s, cssH, dpr, eye, t) : 0);
  const drawSeabedPoints = (cam, s, cssH, dpr) => (s ? seabedLayer().drawPoints(cam, s, cssH, dpr) : 0);
  // The window's cells and the eye in the mesh frame (gl/skyline.js). Called before draw, which reads it.
  function setSkyline(cells, eye, facesOf) { try { skylineLayer().update(cells, eye, facesOf); } catch { /* no strip is the flat environment, which is the picture that shipped */ } }
  const api = { murmurGPU: () => mg, gl, setSkyline, upload, uploadGroups, uploadKept, setMassShift, massDebug, draw, drawFade, beginTarget, hdrLive, composite, hdrPeak, setMatPage, setSurfPage, drawSeabed, drawSeabedPoints, drawSprites, drawCurtain, drawDecals, decalCost, drawStrokes, drawBillboards, billboardTextures, drawGround, groundGrid: () => (grd ? grd.grid : null), wallGrid: () => massGrid, setLightGrid, taaSplit, drawFloor, drawWater, drawCloudDeck, drawCloudVolume, drawMirror, mirrorPeak, uploadSolids, uploadShip, drawSolids, drawActors, uploadInterior, drawInterior, drawInteriorAlone, setAtlas, lost: () => gl.isContextLost(),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), get triangles() { return count / 3; },
    // The mesh's box in the window's frame (for the light projection) and the shadow map size (0: refused).
    get bounds() { return boundsInWindow(); }, get shadowSize() { return shadow ? shadow.size : 0; },
    // This frame's prop map (gl/propshadow.js): size, triangles, and what went in. null when off.
    get propShadow() { return propFrame ? { size: propFrame.size, tris: propFrame.tris, ...(propLayer && propLayer.last) } : null; } };
  // Fixed arity rather than rest args, so an untimed frame allocates nothing here (no method takes more than six).
  for (const [k, name] of TIMED_PASSES) {
    const f = api[k];
    api[k] = (a, b, c, d, e, g) => (PASS_T ? timed(name, () => f(a, b, c, d, e, g)) : f(a, b, c, d, e, g));
  }
  return api;
}
// The view methods `glPassTimer` reports, by the name it reports them under. `draw` is the city's
// main pass less the shadow and SSAO passes it runs inside itself.
const TIMED_PASSES = [['draw', 'mass'], ['drawFade', 'fade'], ['drawMirror', 'mirror'], ['composite', 'hdr'],
  ['drawCloudVolume', 'cloudvol'], ['drawCloudDeck', 'clouds'], ['drawFloor', 'floor'], ['drawWater', 'water'],
  ['drawDecals', 'decals'], ['drawSprites', 'sprites'], ['drawStrokes', 'strokes'], ['drawBillboards', 'billboards'],
  ['drawGround', 'ground'], ['drawSolids', 'solids'], ['drawActors', 'actors'], ['drawInterior', 'interior'], ['drawCurtain', 'curtain']];

declareProgram(withLights(VERT), withLights(FRAG));
