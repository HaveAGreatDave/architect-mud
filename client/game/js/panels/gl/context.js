// A WebGL2 world pass for GLASS — the spike, not the renderer.
//
// It draws ONE thing: mass, as triangles, through GLASS's own camera (see camera.js), shaded the
// way GLASS shades it. No textures, no adornments, no ground, no weather. That is enough to answer
// the question the spike exists for — can the same city be drawn with a depth buffer, from the same
// seat, at a cost worth the rewrite — and stopping there is deliberate: a spike that grows features
// stops being measurable against the thing it is meant to replace.
//
// ⚠ IT OWNS NO GEOMETRY AND NO PALETTE. The vertices come from `captureModelMesh`, which records the
// real primitives; the colours come from the caller, which reads `WALL_COL`. This file knows how to
// put triangles on a screen and nothing whatever about buildings — the same rule the Modelshop's
// server follows, for the same reason: two definitions of what a building looks like is the failure
// this whole effort is trying not to introduce.
//
// ⚠ THIS HEADER IS OLDER THAN THE FILE. It said the pass was not wired into the game and that the
// Modelshop preview was its only caller; GLASS 2 has been the default renderer since 2026-09-09 and
// `paintWindshield` composites this buffer every frame. The spike framing above is kept because the
// discipline it describes still holds — this file knows how to put triangles on a screen and
// nothing whatever about buildings — but the scope has not been "mass only" for a long time.
import { viewProjMatrix, mat4f } from './camera.js';
import { HEIGHT_FOG_GLSL, LIGHT_SHAFT_GLSL } from './fog.js';
import { createSpriteLayer } from './sprites.js';
import { createCurtainLayer } from './curtain.js';
import { createDecalLayer } from './decals.js';
import { createStrokeLayer } from './strokes.js';
import { createBillboardLayer } from './billboards.js';
import { createGroundLayer } from './ground.js';
import { createSolidsLayer } from './solids.js';
// The interior's own clip range, in tiles. A cab is about 0.10 of a tile end to end at a driver's
// eye height, so this brackets it with room to spare — and because the pass clears depth first,
// neither number has anything to do with the world's. See drawInterior.
const INTERIOR_NEAR = 0.004, INTERIOR_FAR = 1.0;
import { createFloorLayer } from './floor.js';
import { createWaterLayer } from './water.js';
import { createCloudLayer } from './clouds.js';
import { createShadowLayer, SHADOW_BIAS_TILES } from './shadow.js';
import { createSSAOLayer } from './ssao.js';
import { createHDRLayer } from './hdr.js';
import { createMirrorLayer } from './mirror.js';
import { createSkylineStrip } from './skyline.js';
// The clip range the matrix is built with. The SSAO pass inverts the depth buffer back to tiles and
// has to use the same two constants the vertices went through.
import { NEAR, zRow } from './camera.js';

// Floats per vertex: position 3, normal 3, colour 3, atlas uv 2, wall ramp 1, alpha 1, flat 1,
// haze jitter 1, baked occlusion 1, material family 1, edge distances 4.
const STRIDE = 21;

// The material table's uniform budget, and the loop-free bound the shader's arrays are stamped
// with. Twenty families exist today (windshield.js's MAT_ORDER); the headroom is so that adding
// one is a one-line change there rather than a shader edit here.
// ⚠ AN INDEX PAST THIS IS UNDEFINED BEHAVIOUR IN GLSL ES, not a clamp — see the ⚠ on `wallMaterialId`.
export const MAX_MATERIALS = 24;

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
  vec4 clip = uViewProj * vec4(aPos, 1.0);
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
  vWorld = aPos;                // the city own lights need a position to fall off FROM
  vDepth = clip.w;              // the camera-forward distance, in tiles — the same f GLASS sorts on
}`;

// The shading GLASS already does, per fragment instead of per face: a key-light dot that warms the
// lit side and cools the shadow side, and a distance fade into the sky. `uKey`/`uSky`/`uShadow` are
// RENDER_TUNE's own vertex-light palette, handed in rather than restated.
// ⚠ THIS IS THE COMPILED CEILING, NOT THE WORKING COUNT. The loop breaks on 'uNLight', so what a
// frame actually costs is the number of lights it HAS, not this — raising the ceiling costs a frame
// with twelve lights in it exactly nothing, and the uniform budget it asks for (3 arrays of this,
// ~151 vectors all told) is still a third of the WebGL2 guarantee of 224.
//
// The working count is 'RENDER_TUNE.glLightSlots', and it is separate for a reason worth knowing:
// this number is stamped into the shader source, so sweeping it would mean recompiling the program
// and there would be no way to measure the choice. A runtime cap can be swept, which is how its
// default was picked — see the note on that knob in windshield.js.
// ── THE LIGHT CEILING, AND WHY IT IS NOT THE THING IN THE WAY ───────────────
//
// ⚠ THIS IS NOT THE BINDING CONSTRAINT AND HAS NOT BEEN FOR A WHILE. `RENDER_TUNE.glLightSlots`
// ships at 16 and `SLOTS` clamps to the smaller of the two, so the city runs at SIXTEEN contested
// slots and this number is already double what anything asks for. Raising it on its own changes
// nothing whatsoever — the tune key exists, the uniform is declared, and the bench reads 0.0%,
// which is this file's own favourite shape of mistake. Raise the TUNE, and read its ⚠ first: the
// wall-wash gain is calibrated against how many lights land on one facade, so slots and gain are
// arithmetically the same knob and have to move together.
//
// ⚠ THE CEILING ITSELF IS ALMOST FREE, WHICH THE NAME HIDES. The fragment loop opens
// `if (i >= uNLight) break;`, so a frame with nine lights costs nine iterations whether this says
// 32 or 64. What costs is FILLING slots, and that is the tune's business.
//
// ⚠ AND WHEN SOMEBODY DOES RAISE THE TUNE, THE WALL IS THE UNIFORM BUDGET, NOT THE FRAME. The
// fragment shader wants 3·MAX_LIGHTS + 1 + 2·MAX_MATERIALS + 6 vectors against a WebGL2 floor-spec
// guarantee of 224 — 32 wants 151, 48 wants 199, 56 wants 223, 64 wants 247. Past 56 a floor-spec
// device does not get a slower city, it gets no GL pass at all. `glCapabilities` compares that
// number against the device now; it used to compute it and compare it against nothing.
export const MAX_LIGHTS = 32;   // uniform slots, and the per-fragment loop CEILING

const FRAG = `#version 300 es
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
out vec4 outColor;

// Perceptual-ish luminance. The relief term reads the albedo as a height field, and a green mortar
// joint and a red one are the same depth of joint.
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

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

${HEIGHT_FOG_GLSL}
${LIGHT_SHAFT_GLSL}
void main() {
  // ⚠ TWO NORMALS, AND THE DIFFERENCE IS LOAD-BEARING. 'n0' is the geometric one the face was built
  // with; 'n' is that with the relief below folded into it. Everything that shades takes 'n'. The
  // shadow bias takes 'n0', because a slope-scaled bias is a statement about the real surface's
  // angle to the light and a bumped normal would jitter it into acne.
  vec3 n0 = normalize(vNormal);
  vec3 n = n0;
  // 1 for a wall, 0 for the flat adornment layer — hoisted, because the relief needs it too.
  float solid = 1.0 - clamp(vFlat, 0.0, 1.0);
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
  if (uMatStr > 0.0 && uBumpStr > 0.0) {
    // ⚠ AND THE SNOW BURIES IT. The relief is recovered from the ALBEDO, and under snow the albedo
    // is snow — so leaving this standing embosses the brickwork of the wall underneath onto the
    // drift lying on the ledge. Same argument as the floor mixing its material toward the hillshade
    // rather than toward flat white: what goes is the texture, not the shape.
    float k = uMat[int(vMat + 0.5)].w * uBumpStr * clamp(uTextured, 0.0, 1.0) * solid * (1.0 - snowW);
    float l0 = lum(textureLod(uAtlas, vUV, 0.0).rgb);
    float lu = lum(textureLod(uAtlas, vUV + vec2(uAtlasTexel.x, 0.0), 0.0).rgb);
    float lv = lum(textureLod(uAtlas, vUV + vec2(0.0, uAtlasTexel.y), 0.0).rgb);
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
  if (clamp(uTextured, 0.0, 1.0) * solid > 0.5 && atl.a < 0.5) discard;
  vec3 surf = mix(vColor, atl.rgb, clamp(uTextured, 0.0, 1.0) * solid);
  // ⚠ HERE, AND NOT AFTER THE SHADING, WHICH IS THE WHOLE REASON THIS IS THREE LINES INSTEAD OF
  // THIRTY. Everything below composes a lit surface out of surf — the two overlays, the sun
  // shadow, the chamfer, both occlusion terms, the screen-space pass and then the point lights.
  // Substituting the albedo before any of that runs means snow is darker in shadow, darker down an
  // alley, darker under a canopy and lit by the neon bolted above it, with not one of those terms
  // knowing it exists. Mixed in at the end it would be a flat white decal over all of them.
  surf = mix(surf, vec3(0.90, 0.93, 0.98), snowW);
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
  surf *= mix(1.0, 1.0 - WET_DARKEN, wetW);
  // wallLit's own two overlays, per fragment instead of as a canvas gradient: a warm top tinted
  // between sky and key by the light dot, and a darker base, both at alphas that depend on that
  // same dot. A flat tint is what this looked like before, and a flat tint reads as a wall painted
  // a lighter colour rather than a wall standing in light.
  vec3 topCol = mix(uSky, uKey, lit);
  float aTop = uStr * (0.06 + 0.14 * lit);
  float aBot = uStr * (0.30 + 0.22 * (1.0 - lit));
  vec3 shaded = mix(mix(surf, topCol, aTop), mix(surf, uShadow, aBot), clamp(vRamp, 0.0, 1.0));
  vec3 base = mix(surf, shaded, clamp(uVLight, 0.0, 1.0) * solid);
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
  base *= 1.0 - SHADOW_DARK * shK;
  // The chamfer's own contribution, on the surface rather than on an overlay alpha — see the ⚠ in
  // the bevel block. Exactly 1.0 when the width is 0, because bevelK is initialised to 0 and the
  // block that writes it is guarded by that same uniform.
  base *= 1.0 + BEVEL_SHADE * bevelK;
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
  base *= occ;
  // ── AND THE CONCAVE HALF, WHICH IS THE ONE THE HEIGHT TERM ABOVE CANNOT SEE ────────────────
  // vBakedAo is 1 where the vertex sees open sky and falls toward 0 in a corner, sampled against
  // the building's own solid volume at mesh-capture time (gl/world.js). Interpolating it across the
  // face is the whole reason it is a vertex attribute rather than a uniform: the gradient IS the
  // effect, and a per-face value would just be a differently-lit flat quad.
  // ⚠ SAME PLACEMENT ARGUMENT AS THE TERM ABOVE — before the lights. Occlusion is a statement about
  // the SKY, and a neon sign in a recessed doorway must still light the doorway.
  occ *= 1.0 - uBakedAo * (1.0 - clamp(vBakedAo, 0.0, 1.0));
  base *= 1.0 - uBakedAo * (1.0 - clamp(vBakedAo, 0.0, 1.0));
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
    base *= k;
  }
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
    // wearing the family next to its own.
    int mi = int(vMat + 0.5);
    vec4 M = uMat[mi];
    float sheen = uSheen[mi];
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
      env = mix(env, sl.rgb * uEnvDim, clamp(city * uEnvCity, 0.0, 1.0));
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
    vec3 diff = base * (1.0 - 0.55 * M.y * mk);
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
    float specK = mix(0.15 + 0.30 * M.y, uSpec[mi], uSpecStr);
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
  // The city own lights, added on top of the key shading.
  for (int i = 0; i < GLASS_MAX_LIGHTS; i++) {
    if (i >= uNLight) break;
    vec3 d = uLightP[i] - vWorld;
    float dist = length(d);
    float att = clamp(1.0 - dist / max(0.001, uLightR[i]), 0.0, 1.0);
    if (att <= 0.0) continue;
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
    base += uLightC[i] * (fall * diff);
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
      base += uLightRaw[i] * (pow(max(0.0, dot(n, Hl)), WET_LOBE) * WET_NEON * wetW * fall);
    }
  }
  // ⚠ AND THERE IS NO EMISSION TERM HERE, WHICH WAS MEASURED RATHER THAN ASSUMED. One sat on this
  // line and moved 0.0% of wall pixels at every seat: everything above IS light arriving at a wall,
  // and every emissive surface in the city is a FLAT face, which 'solid' has already excused from
  // all of it. The account is beside faceEdges in world.js.
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
  outColor = vec4((mix(base, uFog, fog) + scat) * a, a);
}`;

// The shader source carries a symbolic bound so the loop limit and the array sizes cannot drift
// apart; there is one number and the GLSL is stamped from it.
const withLights = (src) => src.split("GLASS_MAX_LIGHTS").join(String(MAX_LIGHTS))
  .split("GLASS_MAX_MAT").join(String(MAX_MATERIALS));

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' shader: ' + log);
  }
  return sh;
}

// ⚠ MSAA IS A KNOB, AND THE DEFAULT WAS NEVER MEASURED. `antialias: true` was written once and
// never swept: the 2-D canvas it composites onto has no multisampling at all, so GLASS 2 is buying
// smoother building edges nobody asked for, at a cost that is paid over the WHOLE frame and scales
// with the backing store rather than with how much city is in it. That is free on a discrete card
// and is exactly the shape of thing that is not free on an integrated one — which is every machine
// this renderer has never been measured on.
//
// ⚠ AND IT CANNOT BE CHANGED ON A LIVE CONTEXT. It is a creation attribute, so the caller has to
// drop the view and make a new one; `sceneGL` treats it the way it already treats a resize. Which
// is also why it is not a per-frame decision — a dial that flipped it under load would rebuild the
// context, the atlas and the whole vertex buffer twice a second.
export function createGLView(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', { antialias: opts.msaa !== 0, alpha: true, depth: true });
  if (!gl) return null;
  // ⚠ A LOST CONTEXT IS SILENT. Every call keeps returning, nothing throws, and the canvas simply
  // stops changing — which with MASS_OFF set is a city of floating lights and no buildings. The
  // default listener also makes the loss PERMANENT, so preventDefault is what leaves a restore
  // possible at all; the pass asks `lost()` each frame and hands the world back to the 2-D
  // renderer the moment the answer is yes.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, withLights(VERT), 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, withLights(FRAG), 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));

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
    vlight: gl.getUniformLocation(prog, 'uVLight'),
    atlas: gl.getUniformLocation(prog, 'uAtlas'),
    textured: gl.getUniformLocation(prog, 'uTextured'),
    sky: gl.getUniformLocation(prog, 'uSky'),
    str: gl.getUniformLocation(prog, 'uStr'),
    // ⚠ AN ARRAY IS ASKED FOR WITHOUT ITS SUBSCRIPT, which GL answers with element 0's location
    // and `uniform3fv` then fills from. 'uLightP[0]' would work too and would be a name no
    // shader in the file declares, which is the thing gl:glsl exists to refuse.
    nLight: gl.getUniformLocation(prog, 'uNLight'),
    lightP: gl.getUniformLocation(prog, 'uLightP'),
    lightC: gl.getUniformLocation(prog, 'uLightC'),
    lightRaw: gl.getUniformLocation(prog, 'uLightRaw'),
    lightR: gl.getUniformLocation(prog, 'uLightR'),
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
    // Same spelling rule as the light arrays above: asked for WITHOUT the subscript, so the name is
    // one a shader in this file actually declares and gl:glsl has something to check it against.
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
  };

  // Scratch, filled per frame and never reallocated: the arrays are the same size every frame and
  // a fresh Float32Array per light per frame is garbage on the hot path.
  const lightP = new Float32Array(MAX_LIGHTS * 3), lightC = new Float32Array(MAX_LIGHTS * 3);
const lightRaw = new Float32Array(MAX_LIGHTS * 3);
  const lightR = new Float32Array(MAX_LIGHTS);
  // The material table, flattened once and re-flattened only when the caller hands over a different
  // one. It is a constant of the build in practice — 19 rows that come from windshield.js — so
  // rebuilding it per frame would be pure garbage on the hot path, and uploading it per frame is two
  // calls that cost nothing next to the 12-light arrays already going up beside it.
  const matTab = new Float32Array(MAX_MATERIALS * 4), sheenTab = new Float32Array(MAX_MATERIALS);
  const specTab = new Float32Array(MAX_MATERIALS);
  let matSrc = null;
  // ⚠ A ROW NOBODY FILLED MUST STILL BE HARMLESS. The table is sized for headroom, so the tail is
  // zeros — and gloss 0 is pow(x, 0.0) = 1.0, a full mirror everywhere. `max(1.0, M.x)` in the
  // shader is what makes that safe, and this default is the belt to its braces.
  for (let i = 0; i < MAX_MATERIALS; i++) matTab[i * 4] = 1;

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let count = 0;
  let atlasTex = null, hasAtlas = false;
  // The page's own size, for the relief taps. ⚠ It is repacked whenever the SET of surfaces in the
  // window changes (see the banded packer in atlas.js), so a texel size cached anywhere but here
  // would go stale the first time you drove past a building made of something new — and the failure
  // is a relief term that quietly samples the wrong distance away, not an error.
  let atlasW = 0, atlasH = 0;
  // The mesh's own axis-aligned box, in the frame the vertices are in. Accumulated on the way into
  // the vertex data rather than derived from the window, because the shadow projection has to
  // contain every CASTER and the only list that is certainly every caster is the buffer itself.
  let bounds = null;
  // ⚠ ONE DEPTH TEXTURE PER VIEW, BUILT ON FIRST USE AND NEVER REBUILT. A shadow map that resized
  // with the window would reallocate on every seat change; a fixed square costs the same at every
  // seat and the projection is what tightens onto the geometry.
  let shadow = null, shadowTried = false;
  let ssao = null, ssaoTried = false;
  let hdr = null, hdrTried = false;
  let warnedShadowShape = false;   // once per view — see the ⚠ on `opts.shadow` in draw()

  // One texture for the whole city. See gl/atlas.js for why this is an atlas rather than a bind
  // per face: a draw call can hold one texture, and per-face binds would make a skyline several
  // hundred draw calls — which is the cost GL is being asked to avoid.
  function setAtlas(canvas) {
    if (!canvas) { hasAtlas = false; atlasW = atlasH = 0; return; }
    atlasW = canvas.width; atlasH = canvas.height;
    if (!atlasTex) atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    // ⚠ NO MIPMAPS AND CLAMP TO EDGE. A mipmap chain blends across tile boundaries at the coarse
    // levels, which is the atlas seam the padding exists to prevent, arriving by another door.
    //
    // ⚠ AND MAGNIFY WITH NEAREST, WHICH IS WHAT GLASS DOES. A wall texture is 16×32 stretched over
    // a whole facade, and the 2-D renderer draws it with smoothing ON only when the wall is being
    // MINIFIED (`drawTexQuadP(..., minify)`) — so close up the window rows are crisp blocks of
    // texel. LINEAR magnification turned every near facade into a soft grey wash with the windows
    // barely readable, which looked like the GL lighting being wrong and was the sampler.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    hasAtlas = true;
  }

  // ⚠ QUADS ARE FANNED, NOT ASSUMED TO BE FOUR-SIDED. A drum cap is an N-gon and a clipped roof is a
  // 3-to-5-gon, so anything that indexed 0,1,2 / 0,2,3 would quietly drop the rest of a cylinder's
  // lid. Every face here is convex, which is what makes a fan correct rather than merely convenient.
  // ⚠ THE MESH ARRIVES AS GROUPS, EACH WITH AN OFFSET, AND IS NEVER COPIED TO MOVE IT. A city is one
  // building geometry repeated at many tiles: placing it by rewriting every vertex allocates an
  // array per face and a point per vertex, and it is a rebuild of the whole buffer that pays for it.
  // The offset is added here, on the way into the vertex data, where the number was going to be
  // written anyway.
  //
  // ⚠ AND IT FILLS A TYPED ARRAY DIRECTLY. A plain array of a hundred and forty thousand numbers,
  // grown by `push` and then converted, was most of an eleven-millisecond rebuild on an aircraft
  // window — which is a dropped frame every time the map recentres, and invisible in a steady shot.
  // ── `nb` IS THE DUSK BLEND, AND THE COLOUR IS RESOLVED HERE RATHER THAN IN THE SHADER ────────
  //
  // A flat face carries its own colour and no texture (`solid = 1 - flat`), so for the whole trim
  // layer — 20,494 of the city's 28,717 faces — `aColor` IS the picture. `captureModelMesh` is
  // memoised on geometry alone and was only ever run at `night: 0`, so every one of those faces was
  // wearing its DAYTIME colour at midnight: a lit window bay, a canopy strip light, a blade panel,
  // a lit shopfront. 4,973 faces over 163 of the 173 models, measured.
  //
  // The fix is a second colour, not a second mesh and not a shader channel, and the reason is that
  // the two captures are geometrically IDENTICAL face-for-face (asserted in `gl:mesh`): only the
  // colours differ. So the day and night colours ride along on the face and the blend happens once
  // per vertex at upload. No stride growth, no new attribute, no varying, and nothing for
  // `glCapabilities` to recount.
  //
  // ⚠ THIS IS FREE ONLY BECAUSE THE BUFFER IS ALREADY REBUILT AT EVERY DUSK STEP. `texEpoch`
  // quantises the blend into 64 steps and world.js forces `uploadGroups` when the epoch moves, so
  // the wall textures and the trim colours cross dusk together, on a cadence that already existed.
  // Put `nb` in the rebuild key some other way and the city gets a rebuild per frame at sunset.
  function uploadGroups(groups, rectOf, nb) {
    const NB = nb > 0 ? (nb < 1 ? nb : 1) : 0;
    let verts = 0;
    for (const g of groups) for (const f of g.faces) verts += (f.p.length - 2) * 3;
    const data = new Float32Array(verts * STRIDE);
    let o = 0;
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const grp of groups) {
      const ox = grp.ox || 0, oy = grp.oy || 0;
      // ── AND A GROUP MAY DISAGREE WITH THE FRAME ABOUT WHAT TIME IT IS ──────────────────────
      //
      // A face carries a day colour and a night one and the blend picks between them, so every
      // surface that PAINTS ITSELF DIFFERENTLY AFTER DARK — a lit window bay, a canopy's strip
      // light, a blade panel, a lit shopfront — is decided here. A building whose feed has failed
      // has none of those lit, and asking the frame gives it all of them.
      //
      // ⚠ IT IS THE ONLY WAY TO REACH THEM. Those colours are baked into the captured mesh, which
      // is memoised per MODEL and shared by every tile that draws it, so a dark building cannot be
      // given its own faces — only its own blend.
      // ⚠ AND `null` IS NOT 0. A group that has no opinion takes the frame's, and a group that
      // wants day says so; writing `grp.nb || NB` turns the second into the first and the feature
      // does nothing, quietly, on every building it is meant to reach.
      const GNB = grp.nb == null ? NB : (grp.nb > 0 ? (grp.nb < 1 ? grp.nb : 1) : 0);
      for (const f of grp.faces) {
        // ⚠ A face with no `rgbN` keeps its one colour at every hour, which is right: a textured
        // wall's day/night lives in the atlas, and a piece of unpainted metalwork genuinely does not
        // change colour after dark — only the things that are LIT do.
        const cD = f.rgb || [128, 128, 128], cN = f.rgbN;
        const r = cN ? cD[0] + (cN[0] - cD[0]) * GNB : cD[0];
        const g = cN ? cD[1] + (cN[1] - cD[1]) * GNB : cD[1];
        const b = cN ? cD[2] + (cN[2] - cD[2]) * GNB : cD[2];
        // ⚠ A ZERO-LENGTH NORMAL IS A NaN FACTORY, AND SOME CAPTURED FACES CARRY ONE. `f.n || …`
        // only catches a MISSING normal; `[0, 0, 0]` is a perfectly truthy array, and it comes out
        // of a degenerate face in the capture. `normalize(vec3(0.0))` is 0/0, and the NaN spreads
        // through every term downstream of the light dot. It had been in the buffer harmlessly for
        // as long as GL has been shading — `clamp` happens to absorb it in the key term on this
        // driver — and it surfaced the moment the sun pass fed the same normal to a slope bias,
        // where it painted 10% of the city solid black. Measured in the Modelshop at 15,021
        // fragments of 134,445 on one cab frame.
        const nn = f.n;
        const n = (nn && (nn[0] || nn[1] || nn[2])) ? nn : [0, 0, 1];
        // The UV a face was given, mapped into its rect in the atlas. A face with neither keeps a
        // degenerate rect and samples one texel, which is what an untextured face wants.
        // ⚠ THE GROUP GOES WITH IT. Which atlas entry a wall samples is a property of the TILE — a
        // blacked-out block and a lit one share the same face objects and must not share an entry.
        const uv = f.uv || null, rc = (rectOf ? rectOf(f, grp) : f.rect) || [0, 0, 0, 0];
        const u0 = rc[0], v0 = rc[1], du = rc[2] - rc[0], dv = rc[3] - rc[1];
        const cr = r / 255, cg = g / 255, cb = b / 255;
        const fa = f.alpha == null ? 1 : f.alpha;
        // ⚠ `flat` IS A LIGHTING ANSWER, NOT A KIND. Most flat-shaded faces are the adornment
        // surfaces and carry kind 'flat'; a barrel roof is MASS that happens to do its own shading,
        // and it has to stay mass so the mesh gate goes on comparing it against the captured shape.
        const flat = (f.flat != null ? !!f.flat : f.kind === 'flat') ? 1 : 0;
        // Resolved per model in world.js and carried on the face, exactly as texKey is. A face that
        // never went through that path — the Modelshop preview, the bench — has none, and 0 is the
        // default facade rather than a missing value: see the out-of-range note on wallMaterialId.
        const mat = f.mat ? f.mat : 0;
        const jit = grp.jit || 0;
        // The ramp is the vertex's height within its OWN face, 0 at the top: the 2-D renderer paints
        // its light as a gradient down each wall, so a shader that wants the same picture needs to
        // know where in the wall it is. A horizontal face has no extent and takes the top end.
        let z0 = Infinity, z1 = -Infinity;
        for (const p of f.p) { if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2]; }
        const dz = (z1 - z0) || 1;
        for (let i = 1; i + 1 < f.p.length; i++) {
          for (let e = 0; e < 3; e++) {
            const k = e === 0 ? 0 : i + e - 1;
            const p = f.p[k], t = uv ? uv[k] : null;
            const wx = p[0] + ox, wy = p[1] + oy, wz = p[2];
            if (wx < bx0) bx0 = wx; if (wx > bx1) bx1 = wx;
            if (wy < by0) by0 = wy; if (wy > by1) by1 = wy;
            if (wz < bz0) bz0 = wz; if (wz > bz1) bz1 = wz;
            data[o] = wx; data[o + 1] = wy; data[o + 2] = wz;
            data[o + 3] = n[0]; data[o + 4] = n[1]; data[o + 5] = n[2];
            data[o + 6] = cr; data[o + 7] = cg; data[o + 8] = cb;
            data[o + 9] = u0 + du * (t ? t[0] : 0); data[o + 10] = v0 + dv * (t ? t[1] : 0);
            data[o + 11] = (z1 - p[2]) / dz;
            data[o + 12] = fa;
            data[o + 13] = flat;
            data[o + 14] = jit;
            // Baked occlusion, 1 where the surface sees open sky. ⚠ A face with no bake takes 1.0
            // rather than 0 — an absent term must be "not occluded", or every surface the bake
            // could not reach goes black instead of simply staying as it was.
            data[o + 15] = f.ao ? f.ao[k] : 1;
            data[o + 16] = mat;
            // ⚠ A FACE WITH NO EDGE FIELD GETS A DISTANCE NO BEVEL CAN REACH, NOT A ZERO. Zero is
            // "on the edge", so a drum cap, a roof polygon or a degenerate quad — every face
            // `faceEdges` declines — would come back fully chamfered over its whole area, which
            // reads as the model having gone soft rather than as a term being missing.
            const ed = f.edge;
            data[o + 17] = ed ? ed[k * 4] : 1e6; data[o + 18] = ed ? ed[k * 4 + 1] : 1e6;
            data[o + 19] = ed ? ed[k * 4 + 2] : 1e6; data[o + 20] = ed ? ed[k * 4 + 3] : 1e6;
            o += STRIDE;
          }
        }
      }
    }
    // ⚠ NO AXIS SWAP, AND THE FIRST CUT HAD ONE. It looked like the obvious hospitality to a GL
    // convention — trade y and z on the way into the buffer — but the matrix in camera.js is
    // written to take GLASS's own world coordinates (x east, y north, z up) and do the swap itself,
    // in the same expression `proj` uses. Swapping here fed it y where it wanted wz, which projects
    // every vertex somewhere off screen: a full buffer, a clean draw call, and an empty frame.
    count = verts;
    // ⚠ THE GROUND PLANE IS FORCED INTO THE BOX. A city of flat plates — a container yard, a run of
    // sheds — can have every vertex above z = 0, and a shadow projection fitted to that box has its
    // near plane above the ground the shadows are meant to land on. Reaching down to 0 costs a
    // fraction of the depth range and removes the case entirely.
    bounds = verts ? { x0: bx0, x1: bx1, y0: by0, y1: by1, z0: Math.min(0, bz0), z1: bz1 } : null;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
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
    return count;
  }
  // One mesh at the origin, the way the model preview and the bench hand it over.
  function upload(faces) { return uploadGroups([{ faces }], null); }

  // ── THE SUN PASS, RUN FROM INSIDE `draw` AND NOT FROM THE CALLER ────────────
  //
  // It has to happen before the frame is cleared and before the viewport is set for the canvas, and
  // it has to put both back. Every one of those is an ordering a call site could get wrong once and
  // then never think about again, and each failure is silent in a different way: a shadow pass
  // after the clear wipes the frame, one that leaves the framebuffer bound draws the whole city
  // into a 2048-square depth texture nobody looks at. So the pass lives at the top of the function
  // that has to follow it, and the caller hands over data.
  //
  // Returns the uniform values the fragment shader needs, or null — and null is a full answer: the
  // strength goes to 0, the comparison is skipped, and the frame is the one that shipped.
  function sunPass(opts) {
    const s = opts.sunShadow;
    if (!s || !(s.str > 0) || !s.lightVP || !count) return null;
    if (!shadow && !shadowTried) {
      shadowTried = true;                     // one attempt per view; a driver that refused once will refuse again
      try { shadow = createShadowLayer(gl, loc.pos); } catch { shadow = null; }
    }
    if (!shadow) return null;
    shadow.render(vao, count, s.lightVP);
    return shadow;
  }

  // ── AND THE SCREEN-SPACE OCCLUSION, ON THE SAME TERMS ──────────────────────
  //
  // ⚠ IT LIVES HERE FOR THE REASON WRITTEN ABOVE sunPass: both passes bind their own framebuffer
  // and both must therefore run BEFORE the clear at the top of draw(), or they are drawn and then
  // wiped. A pass that leaves a framebuffer bound is worse — it draws the whole city into a texture
  // nobody looks at and the canvas stays empty.
  //
  // ⚠ AND IT TAKES THE CAMERA'S OWN FRAME HEIGHT, NOT THE CANVAS'S. The projection constants it
  // inverts are built from `cam.W`, `cam.depth` and `cam.horizonY`, which `makeCam` works out in
  // CSS pixels; handing it the device-pixel height puts the whole vertical axis out by 1/dpr, which
  // is the bug that once lifted the city 38 px off the ground and is exactly zero at dpr 1 — that
  // is to say, invisible in every synthetic scene and every headless test.
  function ssaoPass(cam, opts, W, H) {
    if (!(opts.ssao > 0) || !count || !cam) return null;
    if (!ssao && !ssaoTried) {
      ssaoTried = true;                       // one attempt per view; a driver that refused once will refuse again
      try { ssao = createSSAOLayer(gl, loc.pos); } catch { ssao = null; }
    }
    if (!ssao) return null;
    const camH = opts.cssH || cam.H || H;
    const vp = viewProjMatrix({ ...cam, H: camH }, camH);
    // The SAME z row the matrix two lines up was built from. It unprojects a depth sample back
    // to a view-space distance, so a near plane it does not share is an occlusion radius that
    // quietly means something else on the seats that fit their own.
    const [A, B] = zRow((cam && cam.near) || NEAR);
    try {
      return ssao.render(vao, count, new Float32Array(vp), { ...cam, H: camH }, W, H,
        { A, B, radius: opts.ssaoRadius > 0 ? opts.ssaoRadius : 0.5, bias: opts.ssaoBias > 0 ? opts.ssaoBias : 0.02 });
    } catch { return null; }
  }

  // ── THE FLOAT TARGET, OR THE CANVAS ────────────────────────────────────────
  //
  // ⚠ IT IS BOUND HERE AND NOWHERE EARLIER, BECAUSE THE TWO PREPASSES UNBIND. Both the sun's depth
  // pass and the occlusion pass bind their own framebuffer and restore to null when they are done,
  // so anything bound before them is gone by the time the city is drawn. Everything after this line
  // — the floor, the ground, the sprites, the curtain, the decals, the strokes, the billboards and
  // later the cloud deck — renders into whatever this leaves bound, which is the whole point.
  //
  // Returns whether the float path is live, so the caller knows whether a composite is owed.
  function beginTarget(opts) {
    if (!(opts.hdr > 0)) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    if (!hdr && !hdrTried) {
      hdrTried = true;                        // one attempt per view; a driver that refused once will refuse again
      try { hdr = createHDRLayer(gl); } catch { hdr = null; }
    }
    if (!hdr || !hdr.bind(canvas.width, canvas.height)) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    return true;
  }

  // And the other end of it. A no-op when the float path is not live, which is what makes the
  // caller free to call it unconditionally.
  function composite(opts = {}) {
    return hdr ? hdr.composite(opts) : null;
  }

  // The peak in the float target, for a bench asking why a bright-pass found nothing. Null when
  // there is no float path — see hdr.js.
  function hdrPeak() { return hdr && hdr.peak ? hdr.peak() : null; }

  function draw(cam, opts = {}) {
    // ── ⚠ AND THE MIRROR PASS RE-ENTERS THIS WHOLE FUNCTION ─────────────────────────────────────
    //
    // `intoTarget` is `[w, h]` when somebody else has already bound a framebuffer and cleared it —
    // today only `drawMirror`, drawing the city's mass into the reflection buffer. It changes three
    // things and nothing else: the size the pass works in, that the target is NOT rebound or
    // cleared (doing so would wipe the caller's buffer and hand the frame back to the canvas), and
    // that the two SCREEN-SPACE prepasses are skipped.
    //
    // ⚠ THE SUN AND SSAO PASSES MUST NOT RUN HERE, AND SKIPPING THEM IS NOT AN OPTIMISATION. Both
    // bind framebuffers of their own, which would unbind the caller's; and both are screen-space
    // against the REAL camera, so their buffers describe a city that is the right way up. Handing
    // the mirror a shadow map built for the unreflected view would put every shadow in the water in
    // a place no light could have put it. Both are null-guarded downstream already.
    //
    // Everything else — the materials, the atlas, the lights, the fog, the bevel, the dusk blend —
    // is reused verbatim, which is the only way the city in the puddle cannot disagree with the
    // city above it about what it is made of.
    const into = opts.intoTarget || null;
    const sun = into ? null : sunPass(opts);
    const W = into ? into[0] : canvas.width, H = into ? into[1] : canvas.height;
    const ssaoTex = into ? null : ssaoPass(cam, opts, W, H);
    if (!into) { beginTarget(opts); gl.viewport(0, 0, W, H); }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // ⚠ NO BACKFACE CULL. The mesh carries every face of every solid, and a building here is not
    // guaranteed to be closed — a wall with no back, a soffit, a canopy underside. Culling would
    // delete exactly the surfaces a cab looks up at.
    gl.disable(gl.CULL_FACE);
    const sky = opts.sky || [0.09, 0.11, 0.14];
    // ⚠ PREMULTIPLIED, WHICH IS WHAT THE CANVAS IS. A transparent clear carrying a colour is not a
    // valid premultiplied pixel and fringes; a fully faded fragment must contribute nothing at all.
    const ca = opts.clearAlpha == null ? 1 : opts.clearAlpha;
    // ⚠ NOT WHEN DRAWING INTO SOMEBODY ELSE'S TARGET. The mirror buffer is cleared transparent by
    // its own `bind()` — a sky-coloured clear here would fill the water with a rectangle of sky and
    // the ground shader would add it to every wet pixel in the frame.
    if (!into) {
      gl.clearColor(sky[0] * ca, sky[1] * ca, sky[2] * ca, ca);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!count) return 0;

    gl.useProgram(prog);
    // The camera's own frame height (CSS px), never the canvas's (device px) — see the ⚠ in
    // world.js. Falls back to H so a caller that already works in one unit is unchanged.
    gl.uniformMatrix4fv(loc.viewProj, false, mat4f(viewProjMatrix(cam, opts.cssH || H)));
    const k = opts.keyDir || [-0.7, 0.35, -0.7];
    gl.uniform3f(loc.keyDir, k[0], k[1], k[2]);
    // ⚠ `shadow` IS THE VERTEX-LIGHT BASE COLOUR AND `sunShadow` IS THE SUN. They were both called
    // `shadow`, and world.js built its options as `{ ...opts.draw, shadow: sunShadowFor(…) }` — the
    // spread first, the sun second — so the sun descriptor OVERWROTE the colour on every frame, in
    // two different ways depending on a flag:
    //
    //   glShadow 0 (what shipped) — `sunShadowFor` returns null, `sh` falls back to the literal
    //     below, and that literal is `#222836`: `RENDER_TUNE.vlShadowDay`. So `vlShadowNight`
    //     (`#0a0c1a`, indigo-black) had NEVER reached GLASS 2, and since `aBot` is a 0.30-0.52
    //     overlay, every wall in the night city was being shaded with the DAYTIME base shadow —
    //     about three times too light, and the wrong hue.
    //   glShadow > 0 with the sun up — `sh` is the descriptor OBJECT, `sh[0]` is `undefined`, and
    //     `uniform3f` converts that to NaN without throwing. `mix(surf, vec3(NaN), aBot)` is NaN,
    //     so every solid fragment came out black at full alpha with a correct silhouette.
    //
    // That second one is the whole of the bug report above `RENDER_TUNE.glShadow` — bit-identical
    // at 0.35 and 1.0 (NaN does not vary), `getUniform` reading the strength back correctly (the
    // strength was never the broken uniform), skipping the depth pass changing nothing (the bug is
    // not on the sun path), and a black city. The ground was untouched because `floor.js` is a
    // separate program that never reads `uShadow`.
    //
    // The guard below is the cheap insurance: this class of collision is silent in both directions,
    // and a shape check is the only thing that would have caught it.
    const key = opts.key || [0.78, 0.59, 0.33];
    let sh = opts.shadow;
    if (sh && !Array.isArray(sh)) { if (!warnedShadowShape) { warnedShadowShape = true; console.warn('GLASS 2: draw({shadow}) wants an [r,g,b]; got', sh, '— the sun descriptor belongs in sunShadow'); } sh = null; }
    sh = sh || [0.13, 0.16, 0.21];
    const skyC = opts.skyTint || [0.59, 0.62, 0.59];
    gl.uniform3f(loc.key, key[0], key[1], key[2]);
    gl.uniform3f(loc.shadow, sh[0], sh[1], sh[2]);
    gl.uniform3f(loc.sky, skyC[0], skyC[1], skyC[2]);
    gl.uniform1f(loc.str, opts.str == null ? 1 : opts.str);
    gl.uniform1f(loc.worldBlend, opts.worldBlend == null ? 1 : opts.worldBlend);
    const fogC = opts.fog || sky;
    gl.uniform3f(loc.fog, fogC[0], fogC[1], fogC[2]);
    gl.uniform1f(loc.fogNear, opts.fogNear == null ? 6 : opts.fogNear);
    gl.uniform1f(loc.fogFar, opts.fogFar == null ? 34 : opts.fogFar);
    gl.uniform1f(loc.fogAmt, opts.fogAmt == null ? 0 : opts.fogAmt);
    // No haze band given means none: the far edge stays solid, which is what the model preview and
    // the bench want. A world pass always gives one.
    gl.uniform1f(loc.hazeNear, opts.hazeNear == null ? 1e6 : opts.hazeNear);
    gl.uniform1f(loc.hazeFar, opts.hazeFar == null ? 1e6 + 1 : opts.hazeFar);
    gl.uniform1f(loc.vlight, opts.vlight == null ? 1 : opts.vlight);
    // Contact occlusion. Absent means OFF and the shader multiplies by exactly 1.0.
    gl.uniform1f(loc.ao, opts.ao == null ? 0 : opts.ao);
    gl.uniform1f(loc.bakedAo, opts.bakedAo == null ? 0 : opts.bakedAo);
    gl.uniform1f(loc.aoFall, opts.aoFall == null ? 1.6 : opts.aoFall);
    // The city's own lights. `opts.lights` is a list of { p: [x, y, z], rgb: [r, g, b], r }, already
    // in the same camera-relative tile frame the vertices are, and already the strongest few — see
    // world.js for why the selection lives there and not here.
    const lights = opts.lights || [];
    // ⚠ CAPPED BY THE CALLER AS WELL AS BY THE CEILING. world.js has already trimmed the list to
    // the working count, so this is belt and braces — but it is also the only thing standing between
    // a caller that hands over a longer list and a write past the end of the uniform arrays.
    const nL = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < nL; i++) {
      const L = lights[i];
      lightP[i * 3] = L.p[0]; lightP[i * 3 + 1] = L.p[1]; lightP[i * 3 + 2] = L.p[2];
      lightC[i * 3] = L.rgb[0]; lightC[i * 3 + 1] = L.rgb[1]; lightC[i * 3 + 2] = L.rgb[2];
      // Falls back to the weighted colour for a caller that has never heard of the split (a bench,
      // a preview), so the array is never handed stale numbers from a previous frame.
      const raw = L.rgbRaw || L.rgb;
      lightRaw[i * 3] = raw[0]; lightRaw[i * 3 + 1] = raw[1]; lightRaw[i * 3 + 2] = raw[2];
      // ⚠ `rw`, THE WALL'S REACH, NOT `r`. They are the same number until pickLights splits them,
      // and `r` is the WET ROAD'S — a streak on tarmac is as long as it was swept at. A caller that
      // sets neither (a bench, a preview) gets exactly what it always did.
      lightR[i] = L.rw == null ? L.r : L.rw;
    }
    gl.uniform1i(loc.nLight, nL);
    if (nL) {
      gl.uniform3fv(loc.lightP, lightP); gl.uniform3fv(loc.lightC, lightC); gl.uniform3fv(loc.lightRaw, lightRaw); gl.uniform1fv(loc.lightR, lightR);
      gl.uniform1f(loc.lightWrap, opts.lightWrap == null ? 0 : opts.lightWrap);
      // ⚠ DEFAULTS TO 2, THE TERM THIS PASS SHIPPED WITH, so a caller that has never heard of the
      // focus knob renders what it always rendered rather than pow(att, 0.0) — which is 1.0 at
      // every distance, a light with no falloff at all and the whole city lit flat.
      gl.uniform1f(loc.lightFocus, opts.lightFocus > 0 ? opts.lightFocus : 2);
    }
    // ── THE MATERIAL RESPONSE ───────────────────────────────────────────────────
    //
    // ⚠ THE STRENGTH IS WRITTEN ON EVERY FRAME, INCLUDING THE FRAMES WITH NO TABLE, for the same
    // reason the shadow strength is: a uniform holds its last value, so a pass that only wrote this
    // when it had something to say would leave the previous caller's strength standing — and this
    // view object is shared by the game, the Modelshop preview and the bench.
    const matStr = opts.mat && opts.mat.length ? (opts.matStr == null ? 1 : opts.matStr) : 0;
    gl.uniform1f(loc.matStr, matStr);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES WITH NO SNOW. A uniform holds its last value, so
    // a pass that set this only when it had snow would leave the whole skyline white for the rest
    // of the session after one blizzard thawed — the rule the road segments in floor.js carry.
    gl.uniform1f(loc.snow, opts.snow || 0);
    // ⚠ WRITTEN EVERY FRAME, NEVER ONLY WHEN IT IS RAINING. A uniform holds its last value, so a
    // pass that set this only when it had weather would leave the whole city wet for the rest of
    // the session after one shower — the trap `gl:snow` exists to catch, one layer along.
    gl.uniform1f(loc.wet, opts.wet || 0);
    // Written every frame for the reason the line above is: a uniform holds its last value, so a
    // pass that set this only in fog would leave the city in mist for the rest of the session.
    gl.uniform1f(loc.fogH, opts.fogH || 0);
    gl.uniform1f(loc.fogHScale, opts.fogHScale > 0 ? opts.fogHScale : 0.5);
    gl.uniform1f(loc.scatter, opts.scatter || 0);
    // ⚠ WRITTEN EVERY FRAME AND NEVER CONDITIONALLY, for the reason two comments up: a uniform holds
    // its last value and this view is shared by the game, the Modelshop preview and the bench, so a
    // pass that wrote these only when it had something to say would hand the next caller whatever
    // the last one set. That is the trap already recorded beside uShadowStr and uSunDir.
    gl.uniform1f(loc.bevel, opts.bevel > 0 ? opts.bevel : 0);
    gl.uniform1f(loc.bevelTilt, opts.bevelTilt == null ? 1 : opts.bevelTilt);
    if (matStr > 0) {
      gl.uniform1f(loc.bumpStr, opts.bumpStr == null ? 1 : opts.bumpStr);
      gl.uniform1f(loc.metalRefl, opts.metalRefl == null ? 1 : opts.metalRefl);
      if (opts.mat !== matSrc) {
        matSrc = opts.mat;
        for (let i = 0; i < MAX_MATERIALS; i++) {
          const r = opts.mat[i];
          // ⚠ A ROW PAST THE END OF THE TABLE KEEPS THE HARMLESS DEFAULT rather than going to zero
          // — gloss 0 is a mirror, not a matte. See the fill above.
          matTab[i * 4] = r ? r.gloss : 1;
          matTab[i * 4 + 1] = r ? r.metal : 0;
          matTab[i * 4 + 2] = r ? r.fres : 0;
          matTab[i * 4 + 3] = r ? r.bump : 0;
          sheenTab[i] = r ? r.sheen : 0;
          // ⚠ A ROW PAST THE END TAKES THE OLD EXPRESSION, never 0 — an unclassified surface must
          // look ORDINARY, and 0 here is a material with no sun on it at all.
          specTab[i] = r ? r.spec : 0.15;
        }
      }
      gl.uniform4fv(loc.matTab, matTab);
      gl.uniform1fv(loc.sheenTab, sheenTab);
      gl.uniform1fv(loc.specTab, specTab);
      gl.uniform1f(loc.specStr, opts.specStr == null ? 1 : opts.specStr);
      const eye = opts.eye || [0, 0, 0];
      gl.uniform3f(loc.eye, eye[0], eye[1], eye[2]);
      const eu = opts.envUp || skyC, ed = opts.envDn || sh;
      gl.uniform3f(loc.envUp, eu[0], eu[1], eu[2]);
      gl.uniform3f(loc.envDn, ed[0], ed[1], ed[2]);
      // ⚠ ZERO WHEN THERE IS NO PAGE, which makes the relief taps land on the same texel they
      // started from and the gradient exactly 0 — the right answer for a frame drawing flat palette
      // colours, and one that needs no second branch in the shader to say so.
      gl.uniform2f(loc.atlasTexel, atlasW ? 1 / atlasW : 0, atlasH ? 1 / atlasH : 0);
    }
    // ── THE SKYLINE THE REFLECTION SAMPLES ──────────────────────────────────────────────────
    //
    // ⚠ OUTSIDE THE MATERIAL-TABLE GUARD, AND IT WAS INSIDE IT FIRST. That block is wrapped in
    // `if (opts.mat !== matSrc)` — a cache so the table only re-uploads when it CHANGES — so a
    // uniform written there is written on one frame and never again, and a texture bound there is
    // bound once while every other pass goes on rebinding unit 3 underneath it. Measured: the
    // reflection moved 0.00% of the frame with every part of it correctly wired. It is the same
    // trap the shadow strength and the wet term below are each written around.
    // ⚠ UNIT 3 IS FREE — 0 is the atlas, 1 the sun's depth, 2 the SSAO.
    const strip = skyline ? skyline.tex : null;
    gl.uniform1f(loc.envCity, strip ? (opts.envCity == null ? 1 : opts.envCity) : 0);
    gl.uniform1f(loc.envDim, opts.envDim == null ? 0.62 : opts.envDim);
    if (strip) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, strip); gl.uniform1i(loc.envStrip, 3); }
    const textured = hasAtlas && opts.textured !== false;
    gl.uniform1f(loc.textured, textured ? 1 : 0);
    if (textured) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(loc.atlas, 0); }
    // ⚠ THE STRENGTH IS WRITTEN ON EVERY FRAME, INCLUDING THE FRAMES WITH NO SUN. A uniform holds
    // its last value, so a pass that only set this when it had a shadow would leave the previous
    // frame's strength standing after sunset, against a depth texture belonging to an hour ago —
    // the city wearing yesterday afternoon's shadows all night.
    gl.uniform1f(loc.shadowStr, sun ? opts.sunShadow.str : 0);
    if (sun) {
      gl.uniformMatrix4fv(loc.lightVP, false, mat4f(opts.sunShadow.lightVP));
      gl.uniform1f(loc.shadowTexel, sun.texel);
      gl.uniform1f(loc.shadowBias, opts.sunShadow.bias);
      const d = opts.sunShadow.sunDir;
      gl.uniform3f(loc.sunDir, d[0], d[1], d[2]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sun.tex);
      gl.uniform1i(loc.shadowMap, 1);
    }
    // ⚠ WRITTEN EVERY FRAME FOR THE SAME REASON THE SHADOW STRENGTH IS — a uniform holds its last
    // value, and a frame whose SSAO pass declined (a driver that would not complete the framebuffer,
    // a resize that failed) must not go on multiplying by a texture belonging to a camera that has
    // since moved. Zero here is the exact off switch: the guard in the shader is on this uniform.
    gl.uniform1f(loc.ssaoStr, ssaoTex ? (opts.ssao > 1 ? 1 : opts.ssao) : 0);
    if (ssaoTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, ssaoTex);
      gl.uniform1i(loc.ssao, 2);
      // The BACKING-STORE size, not the camera's — this is divided into gl_FragCoord, which is in
      // device pixels, and the occlusion texture was rendered at that same size.
      gl.uniform2f(loc.viewport, W, H);
    }
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    return count;
  }

  // The lights, on the same context and the same depth buffer. Built lazily: a view that never
  // has a light never compiles the program.
  let sprites = null;
  const spriteLayer = () => (sprites || (sprites = createSpriteLayer(gl)));
  // ⚠ TWO HEIGHTS, AND THEY ARE NOT THE SAME NUMBER. The matrix wants the CAMERA's frame height
  // (CSS px, what `horizonY` and `depth` are measured in — see the ⚠ in world.js); the viewport
  // wants the CANVAS's (device px), because a sprite's radius arrives already scaled by the
  // frame's dpr. Passing one for the other lifts every light off the building it sits on.
  function drawSprites(cam, list, cssH, intensity) {
    if (!list || !list.length) return 0;
    const L = spriteLayer();
    L.upload(list);
    return L.draw(cam, canvas.width, canvas.height, cssH, intensity);
  }

  // The fly-through cloud deck, drawn in a SECOND pass over the same buffer. See gl/clouds.js:
  // the colour is cleared and the DEPTH IS NOT, so the cards test against the city the world
  // pass wrote a moment ago without the mass being uploaded twice or the frame reordered.
  let clouds = null;
  const cloudLayer = () => (clouds || (clouds = createCloudLayer(gl)));
  function drawCloudDeck(cam, cards, cssH, opts = {}) {
    if (!cards || !cards.length) return 0;
    const L = cloudLayer();
    if (opts.noise) L.setNoise(opts.noise);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // ⚠ COLOUR ONLY. Clearing DEPTH here puts every cloud back in front of every tower, which is
    // exactly what the 2-D deck did and exactly what this pass exists to stop — and it would look
    // like the port having no effect rather than like a missing bit.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    L.upload(cards);
    return L.draw(cam, canvas.width, canvas.height, cssH, opts);
  }

  // The Curtain, on the same depth buffer as the mass. Built lazily like the lights: a view that
  // never sees the wall never compiles the program.
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
  function drawDecals(cam, list, cssH, emitGain = 0) {
    if (!list || !list.length) return 0;
    const L = decalLayer();
    L.upload(list);
    return L.draw(cam, cssH || canvas.height, emitGain);
  }
  // What that cost in BINDS, which is the figure that tracks the clock — see the ⚠ in decals.js.
  const decalCost = () => (decals ? { batches: decals.batches, textures: decals.textures, minted: decals.minted } : { batches: 0, textures: 0, minted: 0 });

  // The wires, on the same depth buffer. Lazy like the others: a view with no mast, no rail and
  // no light-runner in it never compiles the program.
  let strokes = null;
  const strokeLayer = () => (strokes || (strokes = createStrokeLayer(gl)));
  function drawStrokes(cam, list, cssH) {
    if (!list || !list.length) return 0;
    const L = strokeLayer();
    L.upload(list);
    return L.draw(cam, canvas.width, canvas.height, cssH);
  }

  // Ground scatter, on the same depth buffer. Lazy like the others.
  let bbs = null;
  const bbLayer = () => (bbs || (bbs = createBillboardLayer(gl)));
  // How many billboard textures the cache is holding. Exposed because an unbounded one is not
  // visible in the picture until it starts evicting live entries, at which point it looks like
  // corrupted artwork rather than like a cache.
  const billboardTextures = () => (bbs ? bbs.textures : 0);
  function drawBillboards(cam, list, cssH, fog, snow) {
    if (!list || !list.length) return 0;
    const L = bbLayer();
    L.upload(list);
    return L.draw(cam, canvas.width, canvas.height, cssH, fog, snow);
  }

  // ── THE PUDDLE REFLECTION, AS A PREPASS ────────────────────────────────────
  //
  // The third of them, and it plays by the same rule the other two do: it binds its own
  // framebuffer and restores to null, so `beginTarget` a moment later is unaffected. See the ⚠ on
  // `beginTarget` — anything bound before these prepasses is gone by the time the city is drawn,
  // which is exactly why the reflection has to be taken BEFORE rather than squeezed in after.
  //
  // ⚠ IT RE-UPLOADS, AND THE ALTERNATIVE IS WORSE. The sprite and decal buffers are filled again by
  // the ordinary passes further down, so this frame fills each one twice. Skipping the second fill
  // would mean this prepass silently owning the buffer state the main pass depends on — a coupling
  // that breaks the moment somebody reorders a layer or turns the reflection off. Measured, the two
  // uploads are a few hundred microseconds against a fill cost that is the real expense here.
  let mirror = null;
  const mirrorLayer = () => (mirror || (mirror = createMirrorLayer(gl)));
  // The city in the glass. Lazy for the mirror's reason: a seat that never draws a reflective
  // surface never allocates it, and a machine that refused the context never gets here at all.
  let skyline = null;
  const skylineLayer = () => (skyline || (skyline = createSkylineStrip(gl)));
  function drawMirror(cam, opts = {}) {
    const sp = opts.sprites, dc = opts.decals, cl = opts.clouds;
    // ⚠ THE RIG COUNTS AS SOMETHING TO REFLECT. This used to ask only whether there were lights or
    // signs, which was the whole of what the buffer held — so on an unlit stretch of wet road the
    // prepass never ran and the truck standing in it had nothing to appear in.
    // ⚠ AND THE DECK COUNTS TOO. This asked only whether the city had anything emissive in it, which
    // was the whole of what the buffer held — so on an unlit road under a heavy sky the prepass never
    // ran and the water had nothing to show but the flat fallback, which is the commonest case there
    // is rather than an edge one.
    if (!(sp && sp.length) && !(dc && dc.length) && !(cl && cl.length) && !solidQuads) return null;
    let M;
    try { M = mirrorLayer(); } catch { return null; }
    if (!M.bind(canvas.width, canvas.height, opts.scale)) return null;
    // The water's plane, in the frame each layer's own vertices are in. Both are at ground level,
    // which is z = 0 in every frame this renderer has — see the eps ladder: the road sits
    // thousandths of a tile above it, which is nothing to a reflection.
    const mcam = { ...cam, mirrorZ: opts.plane || 0 };
    // ⚠ THE MASS IS IN A DIFFERENT FRAME AND NEEDS ITS OWN MIRRORED CAMERA. The lights and the
    // signage are collected in the camera's own frame; the MESH is built at map-window tiles so it
    // can be cached, which is why world.js hands `draw` the shifted `camAt`. Reflecting the plain
    // camera and drawing the mesh through it slides every building in the water by the window
    // offset — and it would not read as a bug, it would read as the reflection being of somewhere
    // else. The two frames disagree about the origin and agree exactly about the SCREEN and the
    // view distance, so a reflection built from each lands on the same pixels at the same depth,
    // which is what lets them share one buffer and one depth test.
    const mMassCam = opts.massCam ? { ...opts.massCam, mirrorZ: opts.plane || 0 } : mcam;
    const cssH = opts.cssH || canvas.height;
    try {
      // ── THE BUILDINGS, FIRST, BECAUSE THEY ARE WHAT THE OTHER TWO STAND ON ────────────────────
      //
      // ⚠ THE MASS GOES DOWN BEFORE THE EMISSIVE LAYERS AND IT IS THE ONLY ORDER THAT WORKS. It
      // writes the depth the sign and the glow are then tested against, which is the whole reason
      // the buffer grew a depth attachment: draw it after and it paints over the very signage it
      // is supposed to be standing behind.
      //
      // ⚠ AND IT IS OPTIONAL, because it is the one part of this pass with a real cost. A puddle
      // reflecting only light is what shipped; `glMirrorMass 0` is exactly that picture, and on a
      // machine where the second draw is too dear it is the knob to reach for before `glMirrorRes`.
      const size = M.size;
      if (opts.mass !== 0 && count) {
        draw(mMassCam, { ...(opts.massOpts || {}), intoTarget: size, cssH,
          // ⚠ NO SHADOWS, NO SSAO AND NO BLOOM IN THE WATER. All three are screen-space against the
          // real camera, so their buffers describe a city the right way up; `draw` skips the two
          // prepasses under `intoTarget` and these make the strengths agree with that.
          sunShadow: null, ssao: 0, hdr: 0 });
      }
      // ── AND THE RIG, WHICH IS WHY ANY OF THIS REACHES A PUDDLE ────────────────────────────────
      //
      // Solid, so it goes down with the mass rather than with the light: the signage and the glows
      // below are depth-TESTED and a reflection of a sign behind the truck must not paint over it.
      //
      // ⚠ IT TAKES THE MASS CAMERA. The rig is collected in MAP-WINDOW tiles for exactly the reason
      // the mesh is — see the ⚠ above on mMassCam — so it reflects through the same shifted camera
      // and lands on the same pixels at the same depth.
      if (solidQuads) drawSolids(mMassCam, cssH, { fog: opts.fog || null });
      // ── AND THE SKY OVER ALL OF IT ────────────────────────────────────────────────────────────
      //
      // A puddle shows what is ABOVE it, and above most of a street is sky. The buffer held the city
      // and the ground shader filled every empty pixel with a two-stop gradient that collapses to ONE
      // COLOUR at exactly the grazing angles where Fresnel makes the reflection strongest — so the
      // water was a flat sheet of paint over four fifths of its own area.
      //
      // ⚠ IT TAKES THE PLAIN MIRRORED CAMERA, NOT THE MASS ONE. The cards are collected as offsets
      // from the ship in `cam`'s own frame, exactly as the lights and the signage are; the mesh is
      // the odd one out because it is cached at map-window tiles.
      //
      // ⚠ AFTER THE MASS, SO A CLOUD BEHIND A TOWER IS BEHIND IT IN THE WATER. A card writes no
      // depth (it is translucent all the way through) and tests LEQUAL, so it cannot hide the signage
      // and lights that follow — those are nearer, and they win on their own depth.
      //
      // ⚠ AND THE VIEWPORT IS THE CANVAS'S, like the lights below and for the same reason: `aSize`
      // is in device pixels and the shader turns it into an NDC offset, which does not care what
      // resolution it is rasterised at. Hand it this buffer's own half size and every cloud in the
      // water comes out twice as wide.
      if (cl && cl.length) {
        const L = cloudLayer(), cs = opts.cloudState || {};
        if (cs.noise) L.setNoise(cs.noise);
        L.upload(cl);
        L.draw(mcam, canvas.width, canvas.height, cssH, cs);
      }
      // Signage next and lights over it, which is the order the frame itself uses — a sign is
      // artwork and a glow is the light coming off it.
      if (dc && dc.length) { const L = decalLayer(); L.upload(dc); L.draw(mcam, cssH); }
      // ⚠ INTENSITY 1, NOT THE EMISSIVE GAIN. The gain exists to push an emitter above 1.0 so the
      // bright-pass can find it in the float buffer; this buffer is eight bits and is read back as
      // a reflection, so the gain would only clip the brightest signs to flat white — which is
      // precisely the legibility this pass exists to gain.
      // ⚠ AND THE VIEWPORT STAYS THE CANVAS'S, THOUGH THIS BUFFER IS HALF ITS SIZE. `aRadius` is in
      // device pixels but what the vertex shader computes from it is an NDC offset — 2·R/viewport —
      // and NDC is the one frame that does not care what resolution it is rasterised at. Handing it
      // the half-size buffer makes 2·R/(W/2), so every light in the water comes out at twice its
      // width: a reflection blurrier than the surface, which reads as the effect being too strong
      // rather than as a wrong divisor.
      if (sp && sp.length) { const L = spriteLayer(); L.upload(sp); L.draw(mcam, canvas.width, canvas.height, cssH, 1); }
    } catch (e) {
      // ⚠ ONCE, AND THEN NEVER AGAIN. A throw in here is indistinguishable from a machine that
      // cannot do the pass — both end as a road with nothing in it — so the fallback is right and
      // the silence is not. It cost an afternoon the first time: the reflection worked in the cab,
      // vanished in the chase camera, and the only difference was a shape mismatch in an argument.
      if (!drawMirror._warned) { drawMirror._warned = true; console.warn('[gl] the reflection pass threw — falling back to a road with no image in it', e); }
      M.release(); return null;
    }
    M.release();
    return M.texture;
  }

  // What the reflection buffer actually holds — a bench probe, not a frame report. See the ⚠ on
  // peak() in mirror.js: an empty buffer and a dead read-back are the same picture from the road.
  const mirrorPeak = (step) => (mirror && mirror.peak ? mirror.peak(step) : null);

  // The road surface. Lazy like the others; a view over open water never compiles it.
  let grd = null;
  const groundLayer = () => (grd || (grd = createGroundLayer(gl)));
  // ── THE FRAME'S OWN PAINTED SKY, AS A TEXTURE ───────────────────────────────────────────────
  //
  // windshield.js hands over a downscaled strip of the canvas above the horizon — see the ⚠ at
  // `captureSkyStrip`. It is re-uploaded every frame because the sky changes every frame (the sun
  // moves, the dome drifts, the weather grades), and it is 256x128, which is the whole reason that
  // is affordable.
  //
  // ⚠ FLIP OFF, EXPLICITLY. `UNPACK_FLIP_Y_WEBGL` is global state on the context and this file is
  // not the only thing uploading images into it. With it left on, the strip arrives upside down and
  // every puddle reflects the ZENITH along the horizon — which reads as a wrong colour rather than
  // as a flipped image, because a sky gradient inverted is still a smooth gradient.
  //
  // ⚠ CLAMP_TO_EDGE, because the grazing pixels — which is most of a road — sample at v = 1.0
  // exactly, and those are the ones the whole feature is for.
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
    if (opts) opts.skyTex = uploadSkyStrip(opts.skyStrip);
    return L.draw(cam, cssH || canvas.height, opts);
  }

  // ── THE VEHICLE YOU ARE IN ─────────────────────────────────────────────────────────────────
  // ⚠ UPLOADED ONCE, DRAWN TWICE, AND THE UPLOAD HAS TO HAPPEN FIRST. The reflection is a PREPASS
  // (see world.js), so by the time the main pass draws the rig the mirror has already needed it.
  // Keeping the fill separate from the draw is the whole of what makes one buffer serve both.
  let shp = null;
  const solidsLayer = () => (shp || (shp = createSolidsLayer(gl)));
  let solidQuads = 0;
  // ⚠ ONE BUFFER FOR BOTH LISTS, AND THE CONCATENATION HAPPENS HERE RATHER THAN AT THE CALL SITE.
  // The rig and the shed are the same kind of thing to this layer — flat-shaded solids that write
  // depth — and they are uploaded once and drawn twice (the mirror, then the main pass), so two
  // buffers would be two uploads and two draw calls for no difference in the picture. What the
  // caller gets back is the two counts SEPARATELY, because a diagnostic that adds them together
  // cannot tell a shed that arrived from a rig that did.
  function uploadSolids(lists) {
    const all = [];
    for (const l of lists) if (l && l.length) for (const q of l) all.push(q);
    solidQuads = all.length ? solidsLayer().upload(all) : 0;
    return solidQuads;
  }
  function drawSolids(cam, cssH, opts) {
    if (!solidQuads) return 0;
    return solidsLayer().draw(cam, cssH || canvas.height, opts || {});
  }

  // ── THE INTERIOR: A VIEWMODEL PASS, AND IT HAS TO BE ONE ──────────────
  //
  // The room you are sitting in is the one solid object in this renderer that is INSIDE the near
  // clip plane. NEAR is 0.06 tiles; a truck cab is 2.3 m across, which at the seat's own eye
  // height is about 0.10 of a tile end to end — so the dash, the pillars, the roof and the floor
  // are ALL nearer than the nearest thing the world camera is able to draw. Collected into the
  // ordinary solids buffer it arrives, uploads, draws, and clips away to nothing: 72 faces on the
  // GPU and not one pixel, which is the exact picture of the feature not existing.
  //
  // ⚠ THE NEAR PLANE CANNOT SIMPLY COME IN FOR EVERYBODY. `nearFor` already fits it to the seat
  // and its own note is explicit that it ONLY EVER COMES IN, at a cost: the cockpit and the cab
  // keep 0.06 and the depth budget that came with it, and the two seats that do move pay 1.3–1.6x
  // coarser depth for it. A plane at 0.004 is fifteen times coarser again across a 400-tile city,
  // which buys a cab by z-fighting the skyline.
  //
  // ⚠ SO IT GETS ITS OWN RANGE, AND THE DEPTH BUFFER IS CLEARED FOR IT. That is not a trick to
  // get round the clip plane — it is the physical claim, stated: NOTHING IN THE WORLD CAN BE
  // BETWEEN YOU AND YOUR OWN DASHBOARD. No building, truck, goose or weather can come inside the
  // cab, so the interior never needs to sort against any of them, and a range of its own (0.004
  // to 1 tile, for an object 0.1 of a tile deep) gives it far BETTER precision than the world pass
  // has rather than worse. It still sorts against ITSELF — the dash in front of the seat behind
  // it — which is the only ordering the object actually has.
  //
  // ⚠ AND IT IS A SECOND INSTANCE OF THE SAME LAYER, NOT A SECOND LAYER. One shader, one upload
  // path, one set of state; what differs is the buffer and the clip range. A copy would be a
  // second place for the flat-shaded triangle soup to be defined, and the first edit would land
  // in one of them.
  let intQuads = 0, intl = null;
  const interiorLayer = () => (intl || (intl = createSolidsLayer(gl)));
  function uploadInterior(list) {
    intQuads = list && list.length ? interiorLayer().upload(list) : 0;
    return intQuads;
  }
  function drawInterior(cam, cssH, opts) {
    if (!intQuads) return 0;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    return interiorLayer().draw(cam, cssH || canvas.height, { ...(opts || {}), near: INTERIOR_NEAR, far: INTERIOR_FAR });
  }

  // The ground itself. Lazy, and only ever built when RENDER_TUNE.glFloor asks for it.
  let flr = null;
  const floorLayer = () => (flr || (flr = createFloorLayer(gl)));
  function drawFloor(state, near) { return state ? floorLayer().draw(state, near) : 0; }

  // ── THE DISPLACED SEA ───────────────────────────────────────────────────────────────────────
  //
  // Lazy like the rest, so a view that never sees water never compiles it — and it reads the
  // FLOOR's LUT rather than being handed its own, because 'where is the coast' must have one
  // answer. It therefore has to be drawn after the floor, which is also where it belongs: the
  // mesh stands ON the flat sea the floor has just painted and hands back to it at the rim.
  let wtr = null;
  const waterLayer = () => (wtr || (wtr = createWaterLayer(gl)));
  function drawWater(cam, state, cssH, refl) {
    if (!state || !(state.seaRoll > 0) || !(state.swell > 0)) return 0;
    const lut = flr && flr.lut;
    if (!lut) return 0;   // the floor has not uploaded yet; there is nothing to agree with
    // ⚠ THE SKY ARRIVES AS A CANVAS AND HAS TO BECOME A TEXTURE HERE. windshield.js may not import
    // gl/, so it hands over the raw strip; this file owns the upload and the one cached texture
    // that both the sea and the road read. The road uploads the same strip again a moment later —
    // same 256x128 source into the same texture object, so it is a redundant call rather than a
    // second texture, and only on frames where the sea is actually reflecting.
    const r = refl ? { ...refl, sky: refl.sky ? uploadSkyStrip(refl.sky) : null } : null;
    return waterLayer().draw(cam, state, cssH, lut, r);
  }

  // Handed the window's cells and the eye in the MESH frame; see gl/skyline.js and the ⚠ on 
  // in world.js. Called before , because the strip is a uniform that draw reads.
  function setSkyline(cells, eye, facesOf) { try { skylineLayer().update(cells, eye, facesOf); } catch { /* no strip is the flat environment, which is the picture that shipped */ } }
  return { gl, setSkyline, upload, uploadGroups, draw, beginTarget, composite, hdrPeak, drawSprites, drawCurtain, drawDecals, decalCost, drawStrokes, drawBillboards, billboardTextures, drawGround, drawFloor, drawWater, drawCloudDeck, drawMirror, mirrorPeak, uploadSolids, drawSolids, uploadInterior, drawInterior, setAtlas, lost: () => gl.isContextLost(),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), get triangles() { return count / 3; },
    // The mesh's own box, for the caller that has to fit a light projection to it — and the shadow
    // map's size, which is 0 when the driver refused it. A zero there next to a sun that is up is
    // the silent failure this whole layer is written around.
    get bounds() { return bounds; }, get shadowSize() { return shadow ? shadow.size : 0; } };
}
