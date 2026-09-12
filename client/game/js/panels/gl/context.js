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
import { viewProjMatrix } from './camera.js';
import { createSpriteLayer } from './sprites.js';
import { createCurtainLayer } from './curtain.js';
import { createDecalLayer } from './decals.js';
import { createStrokeLayer } from './strokes.js';
import { createBillboardLayer } from './billboards.js';
import { createGroundLayer } from './ground.js';
import { createFloorLayer } from './floor.js';
import { createCloudLayer } from './clouds.js';
import { createShadowLayer, SHADOW_BIAS_TILES } from './shadow.js';

// Floats per vertex: position 3, normal 3, colour 3, atlas uv 2, wall ramp 1, alpha 1, flat 1,
// haze jitter 1, baked occlusion 1, material family 1.
const STRIDE = 17;

// The material table's uniform budget, and the loop-free bound the shader's arrays are stamped
// with. Nineteen families exist today (windshield.js's MAT_ORDER); the headroom is so that adding
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
  vWorld = aPos;                // the city own lights need a position to fall off FROM
  vDepth = clip.w;              // the camera-forward distance, in tiles — the same f GLASS sorts on
}`;

// The shading GLASS already does, per fragment instead of per face: a key-light dot that warms the
// lit side and cools the shadow side, and a distance fade into the sky. `uKey`/`uSky`/`uShadow` are
// RENDER_TUNE's own vertex-light palette, handed in rather than restated.
export const MAX_LIGHTS = 12;   // uniform slots, and the per-fragment loop bound

const FRAG = `#version 300 es
precision highp float;
// How dark a fully shadowed surface goes, before the strength knob. See the ⚠ beside its use: the
// strength itself is already folded into shK, so this is the shape and RENDER_TUNE.glShadow is the
// dial. 0.45 is what the flat-face term used before this covered both halves.
const float SHADOW_DARK = 0.45;
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
uniform sampler2D uAtlas;
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
uniform float uLightR[GLASS_MAX_LIGHTS];
uniform float uLightWrap;
uniform float uAo;        // contact-occlusion strength; 0 makes the term exactly 1.0
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
uniform float uMatStr;
uniform float uBumpStr;
uniform vec4 uMat[GLASS_MAX_MAT];
uniform float uSheen[GLASS_MAX_MAT];
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

void main() {
  // ⚠ TWO NORMALS, AND THE DIFFERENCE IS LOAD-BEARING. 'n0' is the geometric one the face was built
  // with; 'n' is that with the relief below folded into it. Everything that shades takes 'n'. The
  // shadow bias takes 'n0', because a slope-scaled bias is a statement about the real surface's
  // angle to the light and a bumped normal would jitter it into acne.
  vec3 n0 = normalize(vNormal);
  vec3 n = n0;
  // 1 for a wall, 0 for the flat adornment layer — hoisted, because the relief needs it too.
  float solid = 1.0 - clamp(vFlat, 0.0, 1.0);
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
  if (uMatStr > 0.0 && uBumpStr > 0.0) {
    float k = uMat[int(vMat + 0.5)].w * uBumpStr * clamp(uTextured, 0.0, 1.0) * solid;
    vec3 up = vec3(0.0, 0.0, 1.0);
    vec3 T = cross(up, n0);
    float tl = length(T);
    // A horizontal face — a roof, a canopy — has no horizon to take a tangent from, so it takes a
    // fixed one. Which axis hardly matters; what it must not be is the zero vector.
    T = tl > 0.001 ? T / tl : vec3(1.0, 0.0, 0.0);
    vec3 B = cross(n0, T);
    float l0 = lum(textureLod(uAtlas, vUV, 0.0).rgb);
    float lu = lum(textureLod(uAtlas, vUV + vec2(uAtlasTexel.x, 0.0), 0.0).rgb);
    float lv = lum(textureLod(uAtlas, vUV + vec2(0.0, uAtlasTexel.y), 0.0).rgb);
    // Bright is proud, so the normal tilts AWAY from the brighter neighbour. v runs down the face in
    // this atlas, which is why the B term is subtracted rather than added.
    n = normalize(n0 - (T * (lu - l0) - B * (lv - l0)) * (k * 6.0));
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
  vec3 surf = mix(vColor, texture(uAtlas, vUV).rgb, clamp(uTextured, 0.0, 1.0) * solid);
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
    float mk = uMatStr * solid;
    vec3 V = normalize(uEye - vWorld);

    // ── THE ENVIRONMENT ───────────────────────────────────────────────────────
    //
    // ⚠ OFF THE REFLECTED RAY, NEVER OFF THE NORMAL. Every facade in this city is vertical, so every
    // wall normal has the same elevation — zero — and a sky/ground blend taken off n is one flat
    // colour on every building, which reads as a tint somebody added. The reflection swings: stand
    // under a glass tower and its lower floors hand you the sky while its upper floors hand you the
    // ground, and the line between them moves as you drive. That gradient IS what glass looks like.
    vec3 R = reflect(-V, n);
    vec3 env = mix(uEnvDn, uEnvUp, smoothstep(-0.35, 0.55, R.z));
    float ndv = clamp(dot(n, V), 0.0, 1.0);
    // Schlick. Near zero face-on, one at grazing, and the fifth power is what makes it hug the
    // silhouette instead of washing the whole wall.
    float fres = pow(1.0 - ndv, 5.0);
    // ⚠ A CONDUCTOR REFLECTS ITS OWN COLOUR AND A DIELECTRIC REFLECTS THE LIGHT'S. This single line
    // is most of what separates sheet copper from plaster painted the same brown: verdigris hands
    // back a green sky, render hands back a white one.
    vec3 spc = mix(vec3(1.0), surf * 1.6 + 0.12, M.y);
    float envAmt = clamp(M.z * (0.045 + 0.955 * fres) * mk, 0.0, 1.0);
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
    base += uKey * (sp * M.z * (0.15 + 0.30 * M.y) * mk * (1.0 - shK) * occ);
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
    base += uLightC[i] * (att * att * diff);
  }
  // GLASS's own fog curve, squared, scaled by the same amount its slider sets — see fogWeight.
  float ff = clamp((vDepth - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  float fog = ff * ff * uFogAmt;
  // ⚠ AND THE FAR EDGE DISSOLVES RATHER THAN ENDING. The 2-D pass fades a building out over the
  // last few tiles of its draw distance, so distant blocks ghost up out of the horizon instead of
  // popping in — and this buffer is composited onto that same frame, so a mass that stayed opaque
  // to its last tile would paint a hard edge over the haze the rest of the picture dissolves into.
  // Premultiplied, because the canvas is.
  // ⚠ EACH TILE DISSOLVES AT ITS OWN MOMENT, which is what the 2-D pass does and what stops a row
  // of buildings giving up its opacity in unison — a wall of haze moving toward you rather than
  // distance. The number is the tile's own, handed over rather than recomputed.
  float a = (1.0 - smoothstep(uHazeNear - vJit, uHazeFar - vJit, vDepth)) * clamp(vAlpha, 0.0, 1.0) * uWorldBlend;
  outColor = vec4(mix(base, uFog, fog) * a, a);
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
    lightR: gl.getUniformLocation(prog, 'uLightR'),
    lightWrap: gl.getUniformLocation(prog, 'uLightWrap'),
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
    bumpStr: gl.getUniformLocation(prog, 'uBumpStr'),
    // Same spelling rule as the light arrays above: asked for WITHOUT the subscript, so the name is
    // one a shader in this file actually declares and gl:glsl has something to check it against.
    matTab: gl.getUniformLocation(prog, 'uMat'),
    sheenTab: gl.getUniformLocation(prog, 'uSheen'),
    envUp: gl.getUniformLocation(prog, 'uEnvUp'),
    envDn: gl.getUniformLocation(prog, 'uEnvDn'),
    atlasTexel: gl.getUniformLocation(prog, 'uAtlasTexel'),
  };

  // Scratch, filled per frame and never reallocated: the arrays are the same size every frame and
  // a fresh Float32Array per light per frame is garbage on the hot path.
  const lightP = new Float32Array(MAX_LIGHTS * 3), lightC = new Float32Array(MAX_LIGHTS * 3);
  const lightR = new Float32Array(MAX_LIGHTS);
  // The material table, flattened once and re-flattened only when the caller hands over a different
  // one. It is a constant of the build in practice — 19 rows that come from windshield.js — so
  // rebuilding it per frame would be pure garbage on the hot path, and uploading it per frame is two
  // calls that cost nothing next to the 12-light arrays already going up beside it.
  const matTab = new Float32Array(MAX_MATERIALS * 4), sheenTab = new Float32Array(MAX_MATERIALS);
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
      for (const f of grp.faces) {
        // ⚠ A face with no `rgbN` keeps its one colour at every hour, which is right: a textured
        // wall's day/night lives in the atlas, and a piece of unpainted metalwork genuinely does not
        // change colour after dark — only the things that are LIT do.
        const cD = f.rgb || [128, 128, 128], cN = f.rgbN;
        const r = cN ? cD[0] + (cN[0] - cD[0]) * NB : cD[0];
        const g = cN ? cD[1] + (cN[1] - cD[1]) * NB : cD[1];
        const b = cN ? cD[2] + (cN[2] - cD[2]) * NB : cD[2];
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
        const uv = f.uv || null, rc = (rectOf ? rectOf(f) : f.rect) || [0, 0, 0, 0];
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

  function draw(cam, opts = {}) {
    const sun = sunPass(opts);
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
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
    gl.clearColor(sky[0] * ca, sky[1] * ca, sky[2] * ca, ca);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!count) return 0;

    gl.useProgram(prog);
    // The camera's own frame height (CSS px), never the canvas's (device px) — see the ⚠ in
    // world.js. Falls back to H so a caller that already works in one unit is unchanged.
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, opts.cssH || H)));
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
    const nL = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < nL; i++) {
      const L = lights[i];
      lightP[i * 3] = L.p[0]; lightP[i * 3 + 1] = L.p[1]; lightP[i * 3 + 2] = L.p[2];
      lightC[i * 3] = L.rgb[0]; lightC[i * 3 + 1] = L.rgb[1]; lightC[i * 3 + 2] = L.rgb[2];
      lightR[i] = L.r;
    }
    gl.uniform1i(loc.nLight, nL);
    if (nL) {
      gl.uniform3fv(loc.lightP, lightP); gl.uniform3fv(loc.lightC, lightC); gl.uniform1fv(loc.lightR, lightR);
      gl.uniform1f(loc.lightWrap, opts.lightWrap == null ? 0 : opts.lightWrap);
    }
    // ── THE MATERIAL RESPONSE ───────────────────────────────────────────────────
    //
    // ⚠ THE STRENGTH IS WRITTEN ON EVERY FRAME, INCLUDING THE FRAMES WITH NO TABLE, for the same
    // reason the shadow strength is: a uniform holds its last value, so a pass that only wrote this
    // when it had something to say would leave the previous caller's strength standing — and this
    // view object is shared by the game, the Modelshop preview and the bench.
    const matStr = opts.mat && opts.mat.length ? (opts.matStr == null ? 1 : opts.matStr) : 0;
    gl.uniform1f(loc.matStr, matStr);
    if (matStr > 0) {
      gl.uniform1f(loc.bumpStr, opts.bumpStr == null ? 1 : opts.bumpStr);
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
        }
      }
      gl.uniform4fv(loc.matTab, matTab);
      gl.uniform1fv(loc.sheenTab, sheenTab);
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
    const textured = hasAtlas && opts.textured !== false;
    gl.uniform1f(loc.textured, textured ? 1 : 0);
    if (textured) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(loc.atlas, 0); }
    // ⚠ THE STRENGTH IS WRITTEN ON EVERY FRAME, INCLUDING THE FRAMES WITH NO SUN. A uniform holds
    // its last value, so a pass that only set this when it had a shadow would leave the previous
    // frame's strength standing after sunset, against a depth texture belonging to an hour ago —
    // the city wearing yesterday afternoon's shadows all night.
    gl.uniform1f(loc.shadowStr, sun ? opts.sunShadow.str : 0);
    if (sun) {
      gl.uniformMatrix4fv(loc.lightVP, false, new Float32Array(opts.sunShadow.lightVP));
      gl.uniform1f(loc.shadowTexel, sun.texel);
      gl.uniform1f(loc.shadowBias, opts.sunShadow.bias);
      const d = opts.sunShadow.sunDir;
      gl.uniform3f(loc.sunDir, d[0], d[1], d[2]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sun.tex);
      gl.uniform1i(loc.shadowMap, 1);
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
  function drawSprites(cam, list, cssH) {
    if (!list || !list.length) return 0;
    const L = spriteLayer();
    L.upload(list);
    return L.draw(cam, canvas.width, canvas.height, cssH);
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
  function drawDecals(cam, list, cssH) {
    if (!list || !list.length) return 0;
    const L = decalLayer();
    L.upload(list);
    return L.draw(cam, cssH || canvas.height);
  }

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
  function drawBillboards(cam, list, cssH, fog) {
    if (!list || !list.length) return 0;
    const L = bbLayer();
    L.upload(list);
    return L.draw(cam, canvas.width, canvas.height, cssH, fog);
  }

  // The road surface. Lazy like the others; a view over open water never compiles it.
  let grd = null;
  const groundLayer = () => (grd || (grd = createGroundLayer(gl)));
  function drawGround(cam, quads, cssH, opts) {
    if (!quads || !quads.length) return 0;
    const L = groundLayer();
    L.upload(quads);
    return L.draw(cam, cssH || canvas.height, opts);
  }

  // The ground itself. Lazy, and only ever built when RENDER_TUNE.glFloor asks for it.
  let flr = null;
  const floorLayer = () => (flr || (flr = createFloorLayer(gl)));
  function drawFloor(state) { return state ? floorLayer().draw(state) : 0; }

  return { gl, upload, uploadGroups, draw, drawSprites, drawCurtain, drawDecals, drawStrokes, drawBillboards, billboardTextures, drawGround, drawFloor, drawCloudDeck, setAtlas, lost: () => gl.isContextLost(),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), get triangles() { return count / 3; },
    // The mesh's own box, for the caller that has to fit a light projection to it — and the shadow
    // map's size, which is 0 when the driver refused it. A zero there next to a sun that is up is
    // the silent failure this whole layer is written around.
    get bounds() { return bounds; }, get shadowSize() { return shadow ? shadow.size : 0; } };
}
