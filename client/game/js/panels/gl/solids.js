// THE SOLIDS THE FRAME DRAWS ITSELF: THE VEHICLE YOU ARE IN, AND THE DEPOT SHED.
//
// ⚠ TWO CLIENTS, ONE LAYER, AND THE SECOND ONE IS WHY IT IS NOT CALLED `ownship` ANY MORE. What
// this draws is a flat-shaded triangle soup that writes depth and is not culled, and the rig was
// simply the first thing in GLASS that needed one. The depot shed is the second: it is the one
// building drawn at a fixed size by its own function rather than extruded from a storey stack, so
// it is in MASS_EXCEPT, it never reaches the GL mass, and it was painted on the canvas AFTER the
// city was composited — the 'depot shows thru buildings' report, and the same shape as every
// see-through bug before it.
//
// ⚠ THE SHED COULD NOT GO IN THE MASS AND THAT IS A PROPERTY OF THE SHED, NOT A SHORTCUT. The mass
// buffer is cached per map window; the shed's roller door OPENS as a truck comes up the apron, and
// its palette flips between an interior and an exterior read depending on which side of the walls
// the eye is. Both are per-frame, per-tile answers, and a cached buffer cannot carry either — so it
// would rebuild the whole window's vertex data every frame, which is the one thing the mass buffer
// exists not to do. Here it is a few hundred triangles uploaded per frame, which is what this layer
// already does for the rig.
//
//
// The own ship was the last solid object in the frame with no presence in GL at all. It is drawn by
// `model-raster.js` — a software rasteriser with its own depth buffer — straight onto the 2-D
// canvas, AFTER the GL canvas has been blitted. That is exactly correct for a renderer where the
// painter's order is the depth order, and it has two consequences once the city is on a depth
// buffer and everything else in the world has followed it there:
//
//   · the rig draws THROUGH buildings, because nothing composited later can be hidden by something
//     composited earlier — the 'truck shows thru buildings' report, and the same shape as the
//     lights, the Curtain, the signage and the wires before it;
//   · and it cannot appear in a PUDDLE, because the reflection pass renders the mass, the sprites
//     and the decals into its buffer and the rig is in none of them. A mirror can only show what
//     was drawn into it.
//
// Both are the one missing capability, so this is the one fix.
//
// ⚠ IT PORTS NO GEOMETRY AND NO SHADING, WHICH IS WHY IT IS SMALL. Every face the model draws
// already carries `wv` — its vertices in world 3-space — and `rv`, the same three numbers the
// software rasteriser writes into a pixel, shaded by the baked `sh`, the livery finish and the sun.
// Both exist because the self-shadowing pass and the rasteriser already needed them, and the note
// over `rv` in windshield.js is explicit that they are kept as numbers so nobody re-derives them.
// So this layer is handed finished polygons and does nothing to them but project.
//
// ⚠ AND THE SHADING STAYS ON THE CPU DELIBERATELY. A lit-here shader would be a second lighting
// model for one object, agreeing with the canvas one until somebody edited either — the failure
// the ⚠ over `rv` names. The truck is a few hundred faces once; there is nothing to win.
//
// ⚠ NO FACE CULLING. A face with no `cen` is a free polygon in that mesh — a raked screen, a fin
// blade, a sheet with nothing behind it — and a sheet is visible from both sides. The mirrored pass
// needs the other reason too: reflecting the world about z flips the winding, so a fixed cull would
// show the reflection inside out.
//
// ⚠ AND IT UPLOADS ONCE AND DRAWS TWICE. The rig moves every frame, so there is nothing to cache;
// what matters is that the REFLECTION pass runs before the main one (see the prepass note in
// world.js), so the buffer has to be filled before either. Upload and draw are separate calls for
// that reason alone.
import { viewProjMatrix, eyePos } from './camera.js';
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
import { makeVertexStream } from './stream.js';
import { declareProgram, takeWarm } from './programs.js';

const STRIDE = 15;   // pos3, colour3, alpha1, normal3, metal1, local3, tex1
// ── THE CABIN VARIANT ────────────────────────────────────────────────────────
// The interior layer is this layer with CABIN defined: 24 more floats a vertex, and the cockpit's
// light model run per pixel in the cab's own frame (vLocal, metres about the eye, y forward, z up).
// The per-face record is `q.cab`, built by pushInteriorShell (windshield.js cabGpuParams):
//   0-2  normal (cab frame)        3-6  k, emis, mat spec, mat pow
//   7-10 kind, spec, pow, coat     kind: -1 passthrough (glass, panes), 0 surface, 1 metal ramp, 2 lacquer
//   11-14 envK (-1 = no env), glint, hash, sun shine on    15-17 ramp dark  18-20 ramp bright  21-23 metal albedo
// The frame's light arrives as uniforms (`light` on upload), including a sun shadow map of the room.
const CAB = 24;
const CAB_NONE = new Float32Array(CAB); CAB_NONE[7] = -1;
// ⚠ `local` IS THE COCKPIT'S OWN FRAME, IN METRES, and it is what the surface textures are drawn
// in. `aPos` is where the face is in the WORLD, which moves with the aircraft, so grain sampled
// off it would crawl across the dash every frame the aircraft moved. Only interior faces carry it;
// everything else passes 0 for `tex` and the texture block is skipped.

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aColor;
in float aAlpha;
in vec3 aNormal;
in float aMetal;
in vec3 aLocal;
in float aTex;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uNScale;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
uniform float uWaterZ;
uniform float uWaterT;
// ⚠ CENTROID, BECAUSE OF MSAA. With multisampling a pixel a triangle only partly covers is shaded
// ONCE, at the pixel centre, even when that centre lies outside the triangle, and every varying is
// EXTRAPOLATED to it. On a thin part at a low resolution-dial step (the Drake's minigun at 54%)
// the extrapolated normal and position went wild, and the metal reflection turned the gun into a
// square patch of sky. Centroid samples inside the covered part of the pixel instead.
centroid out vec3 vColor;
out float vFog;
centroid out float vAlpha;
centroid out vec3 vPos;
centroid out vec3 vN;
centroid out float vMetal;
centroid out vec3 vLocal;
flat out int vTex;
#ifdef CABIN
in vec3 aCN; in vec4 aCA; in vec4 aCB; in vec4 aCC; in vec3 aR0; in vec3 aR1; in vec3 aMA;
centroid out vec3 vCN; flat out vec4 vCA; flat out vec4 vCB; flat out vec4 vCC; flat out vec3 vR0; flat out vec3 vR1; flat out vec3 vMA;
// The seat's attitude (seatAttitude in windshield.js), applied to the cab-local point before the
// model matrix: look yaw, the anisotropic roll and the screen shear on points ahead of the eye.
// x,y = cos/sin look yaw, z,w = cos/sin roll; B = D/FL, FL/D, shear r/f, shear u/f. Off = identity.
uniform vec4 uAttA; uniform vec4 uAttB; uniform float uAttOn;
vec3 seatAtt(vec3 q) {
  if (uAttOn < 0.5) return q;
  float cy = uAttA.x, sy = uAttA.y, cb = uAttA.z, sb = uAttA.w;
  float f = q.y * cy + q.x * sy, r = q.x * cy - q.y * sy, u = q.z;
  float r2 = r * cb + uAttB.x * u * sb, u2 = u * cb - uAttB.y * r * sb;
  if (f > 0.0) { r2 += uAttB.z * f; u2 -= uAttB.w * f; }
  return vec3(r2 * cy + f * sy, f * cy - r2 * sy, u2);
}
#else
vec3 seatAtt(vec3 q) { return q; }
#endif
void main() {
  // uModel is the identity for every layer but the cab interior (see upload), and multiplying by an
  // exact identity is exact, so the other layers compute what they always did.
  vec4 wp = uModel * vec4(seatAtt(aPos), 1.0);
  // Under the surface the outline wavers, as anything seen through moving water does. Only below
  // uWaterZ, which is far under the world unless a hull is afloat, so every other solid is untouched.
  float wdz = uWaterZ - wp.z;
  if (wdz > 0.0) {
    float k = min(1.0, wdz / 0.008) * 0.0016;
    wp.xy += k * vec2(sin(wp.z * 520.0 + wp.y * 90.0 + uWaterT * 2.4), cos(wp.z * 470.0 + wp.x * 80.0 + uWaterT * 2.0));
  }
  vec4 clip = uViewProj * wp;
  gl_Position = clip;
  vColor = aColor;
  vAlpha = aAlpha;
  vPos = wp.xyz; vN = mat3(uModel) * aNormal * uNScale; vMetal = aMetal;
  vLocal = aLocal; vTex = int(aTex + 0.5);
#ifdef CABIN
  vCN = aCN; vCA = aCA; vCB = aCB; vCC = aCC; vR0 = aR0; vR1 = aR1; vMA = aMA;
#endif
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

// The fog is the only thing done here, and it is done because the rest of the frame does it: a rig
// seen from a long way off in a chase camera has to recede into the same haze wall the city does.
// At the distance an own ship is actually drawn from it is worth nothing, and it costs nothing.
const FRAG = `#version 300 es
precision highp float;
centroid in vec3 vColor;
in float vFog;
centroid in float vAlpha;
centroid in vec3 vPos;
centroid in vec3 vN;
centroid in float vMetal;
centroid in vec3 vLocal;
flat in int vTex;
uniform vec3 uFog;
uniform vec3 uEye;
uniform vec3 uSkyHor;
uniform vec3 uSkyTop;
uniform float uNight;
uniform vec3 uSun;
uniform float uSunK;
uniform float uWaterZ;
uniform float uWaterT;
uniform float uUnder;   // 0..1, how far under the eye is: the cockpit seen from inside the sea
uniform float uUnderD;  // metres of water over the eye: caustics fade and blur with it
out vec4 outColor;
// ── THE CAUSTIC NET, AS REAL ONES BEHAVE ──────────────────────────────────────────────────────
// Bright lines where drifting ripples cross zero, anchored in the WORLD so on a moving hull they slide
// over her. Three things keep it from strobing, each from how real caustics and real renderers behave:
//   · SLOW: the surface that focuses them moves at a walking pace, so the net drifts, it does not race.
//   · TWO SCALES, WARPED: a big soft net under a finer one, the domain bent by a slow wave, so it never
//     reads as one repeating tile.
//   · SOFTENED BY DEPTH AND BY THE PIXEL: the line width grows with depth (they are only sharp just
//     under the surface), and with fwidth, so a cell near one pixel fades out instead of flickering.
float causNet(vec2 p, float t, float soft) {
  p += 0.35 * vec2(sin(p.y * 0.7 + t * 0.1), sin(p.x * 0.6 - t * 0.08));
  float n = abs(sin(p.x * 1.7 + t * 0.18) + sin(p.y * 1.9 - t * 0.15) + sin((p.x + p.y) * 1.3 + t * 0.11));
  float px = fwidth(p.x) + fwidth(p.y);
  float w = 0.4 + soft * 0.9 + px * 1.6;
  return smoothstep(w, 0.0, n) * clamp(1.6 - px * 1.2, 0.0, 1.0) * (0.45 / w);
}
float causAt(vec3 p, vec3 n, float t, float soft) {
  vec3 w = abs(n); w /= max(1e-4, w.x + w.y + w.z);
  float a = causNet(p.xy, t, soft) * w.z + causNet(p.xz * 1.1, t, soft) * w.y + causNet(p.yz * 1.1, t, soft) * w.x;
  vec3 q = p * 0.47 + 11.0;
  float b = causNet(q.xy, t * 0.7, soft) * w.z + causNet(q.xz, t * 0.7, soft) * w.y + causNet(q.yz, t * 0.7, soft) * w.x;
  return a * 0.55 + b * 0.6;
}
// ⚠ CARRIED WITH HER, MOSTLY. Pinned to the world, a sub at cruise sweeps a dozen cells a second through
// the cabin and it reads as strobing; pinned to the cabin it never moves at all. Sampled about the eye
// with 8% of her travel left in, it slides slowly past as she goes, which is what it looks like to ride
// in her. CAUS_CARRY is that share.
vec3 causP(vec3 p) { return (p - uEye * 0.92) * 45.0; }
// How strong the net is at this depth: sharp and bright in the first few metres, gone past ~25 m.
float causDepth() { return exp(-uUnderD / 7.0); }
float causSoft() { return clamp(uUnderD / 14.0, 0.0, 1.0); }
// THE WORLD A METAL MIRRORS: the frame's own sky above a hard bright horizon line, the ground below
// it. The same expression as envAt in windshield.js, which is the per-face answer for the 2-D path.
vec3 envAt(float rz) {
  vec3 sky = mix(uSkyHor, uSkyTop, clamp(rz * 1.8, 0.0, 1.0));
  vec3 gnd = mix(uSkyHor * vec3(0.5, 0.5, 0.48), vec3(40.0, 44.0, 36.0) / 255.0 * (1.0 - uNight * 0.8), clamp(-rz * 3.0, 0.0, 1.0));
  vec3 env = mix(gnd, sky, clamp(rz * 30.0 + 0.5, 0.0, 1.0));
  return mix(env, mix(uSkyHor, vec3(1.0, 0.98, 0.925), 1.0 - uNight), exp(-(rz * rz) / 0.0012) * 0.55);
}
// The same world with the horizon line blurred out, for a flat plate (see the metal block below).
vec3 envSoft(float rz) {
  vec3 sky = mix(uSkyHor, uSkyTop, clamp(rz * 1.2, 0.0, 1.0));
  vec3 gnd = mix(uSkyHor * vec3(0.5, 0.5, 0.48), vec3(40.0, 44.0, 36.0) / 255.0 * (1.0 - uNight * 0.8), clamp(-rz * 1.5, 0.0, 1.0));
  return mix(gnd, sky, smoothstep(-0.35, 0.35, rz));
}
// ── SURFACE TEXTURE, PER PIXEL, IN THE COCKPIT'S OWN FRAME ───────────────────
// The kinds are interior-kit.js TEX_KINDS, by index: 1 plastic, 2 fabric, 3 leather, 4 rubber,
// 5 brushed, 6 cast, 7 paint, 8 wood, 9 carpet. Each returns a brightness multiplier around 1 — a
// texture here is the VALUE of the surface varying, never a new colour, so a retrim still reaches
// it and a lamp is never tinted. ⚠ EVERY TERM FADES OUT WHERE ITS FEATURE IS SMALLER THAN A PIXEL
// (fade), because a procedural pattern sampled below its own frequency is not a finer texture, it
// is shimmer, and shimmer on a dashboard is the one thing worse than a flat one.
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
// What a mirror sees. Chrome reads as chrome only by the contrast in what it reflects, and envAt's
// two gradients have none, so metal reflecting them read as grey paint. This adds a skyline of
// distant land along the horizon that rises and falls with bearing, and soft cloud banks above it.
// Bearing is taken from the unit vector, not atan, so there is no seam behind the eye. 'w' is the
// horizon's half-width: wide for a flat plate (see the metal block), a pixel's spread for a curve.
vec3 envRich(vec3 R, float w) {
  float rz = R.z;
  vec2 az = normalize(R.xy + vec2(1e-5));
  vec3 hot = mix(uSkyHor, vec3(1.0, 0.98, 0.925), 1.0 - uNight);
  vec3 sky = mix(uSkyHor, uSkyTop, clamp(rz * 1.8, 0.0, 1.0));
  float cl = smoothstep(0.45, 0.8, vnoise(az * 3.0 + vec2(rz * 7.0, 11.0))) * smoothstep(0.03, 0.15, rz) * (1.0 - smoothstep(0.45, 0.85, rz));
  sky = mix(sky, hot, cl * 0.45);
  vec3 gnd = mix(uSkyHor * vec3(0.5, 0.5, 0.48), vec3(40.0, 44.0, 36.0) / 255.0 * (1.0 - uNight * 0.8), clamp(-rz * 3.0, 0.0, 1.0));
  float ridge = 0.012 + 0.055 * vnoise(az * 2.5 + vec2(3.1, 7.7)) + 0.018 * vnoise(az * 9.0 + vec2(1.3));
  vec3 env = mix(gnd, sky, smoothstep(-w, w, rz));
  env = mix(env, hot, exp(-pow(rz - ridge, 2.0) / 0.0012) * 0.45);
  vec3 land = mix(gnd, uSkyHor, 0.3) * 0.62;
  return mix(env, land, smoothstep(w, -w, rz - ridge) * smoothstep(-w, w, rz));
}
// How much of a feature of freq cycles per metre survives at this pixel's footprint.
float fade(float freq, float px) { return clamp(1.6 - px * freq * 2.2, 0.0, 1.0); }
// A height field per material, 0..1, at uv (metres in the face's own plane). The value of the
// surface follows the height, and the RELIEF comes from the height's slope toward the light: the
// cockpit's light comes in through the glass, forward and above, so a pit is dark on its near
// side and a ridge bright on its far one. That slope is what reads as texture; brightness alone
// read as a faint tint and measured under two levels out of 255 on a dark panel.
float texHeight(int kind, vec2 uv, float px) {
  if (kind == 1) {        // moulded plastic: a fine stipple over a slow mottle
    return 0.5 + (vnoise(uv * 420.0) - 0.5) * fade(420.0, px) + (vnoise(uv * 90.0) - 0.5) * 0.25 * fade(90.0, px);
  } else if (kind == 2) { // fabric: warp and weft, and the pile between them
    float w = 0.5 + 0.5 * sin(uv.x * 1400.0) * sin(uv.y * 1400.0);
    return mix(0.5, w, fade(700.0, px)) + (vnoise(uv * 160.0) - 0.5) * 0.7 * fade(160.0, px);
  } else if (kind == 3) { // leather: pebbled grain
    float g = vnoise(uv * 180.0); g = 1.0 - abs(g * 2.0 - 1.0);
    return 0.5 + (g - 0.5) * fade(180.0, px) + (vnoise(uv * 40.0) - 0.5) * 0.5 * fade(40.0, px);
  } else if (kind == 4) { // rubber: a fine grit
    return 0.5 + (vnoise(uv * 600.0) - 0.5) * fade(600.0, px) + (vnoise(uv * 120.0) - 0.5) * 0.4 * fade(120.0, px);
  } else if (kind == 5) { // brushed metal: streaks, long one way and fine the other
    return 0.5 + (vnoise(vec2(uv.x * 6.0, uv.y * 900.0)) - 0.5) * fade(900.0, px) + (vnoise(vec2(uv.x * 3.0, uv.y * 140.0)) - 0.5) * 0.7 * fade(140.0, px);
  } else if (kind == 6) { // cast / bare metal: sand-cast pits and a blotchy oxide
    float pit = smoothstep(0.78, 0.9, vnoise(uv * 380.0));
    return 0.6 - pit * 0.6 * fade(380.0, px) + (vnoise(uv * 70.0) - 0.5) * 0.35 * fade(70.0, px);
  } else if (kind == 7) { // painted metal: orange peel and brush marks under the coat
    return 0.5 + (vnoise(uv * 230.0) - 0.5) * 0.7 * fade(230.0, px) + (vnoise(vec2(uv.x * 20.0, uv.y * 120.0)) - 0.5) * 0.15 * fade(120.0, px);
  } else if (kind == 8) { // wood: a PAINTED grain, like printed veneer — every feature runs ONE way
    // The old version crossed full-strength sine rings with noise stretched the other way and then
    // embossed both, which read as a woven tartan. Grain is long lines along uv.x that wander gently
    // across it: thin dark lines, broad lighter and darker bands, and pore streaks, all bent by one
    // warp so they stay parallel. No relief (texAmount), because paint is flat.
    float wy = uv.y + (vnoise(vec2(uv.x * 1.1, uv.y * 5.0)) - 0.5) * 0.045 + sin(uv.x * 2.3 + uv.y * 7.0) * 0.005;
    float ln = abs(fract(wy * 48.0 + vnoise(vec2(uv.x * 0.8, wy * 3.0)) * 2.0) - 0.5) * 2.0;
    float line = smoothstep(0.0, 0.28, ln);                 // 0 on a grain line, 1 between
    float band = vnoise(vec2(uv.x * 1.5, wy * 16.0));        // broad light/dark stripes along the grain
    float pore = vnoise(vec2(uv.x * 30.0, wy * 700.0));      // short dark streaks, long the grain way
    return 0.5 + (line - 0.5) * 0.55 * fade(48.0, px) + (band - 0.5) * 0.9 * fade(16.0, px) + (pore - 0.5) * 0.35 * fade(700.0, px);
  } else if (kind == 11) { // gelcoat hull: orange peel, fairing ripples and faint laid-up panel seams
    float seam = smoothstep(0.02, 0.0, abs(fract(uv.x * 0.8) - 0.5) - 0.48);
    return 0.5 + (vnoise(uv * 160.0) - 0.5) * 0.5 * fade(160.0, px) + (vnoise(uv * 3.0) - 0.5) * 0.9 * fade(3.0, px)
         - seam * 0.5 * fade(40.0, px);
  } else if (kind == 9) { // carpet: a dense loop pile
    return 0.5 + (vnoise(uv * 700.0) - 0.5) * fade(700.0, px) + (vnoise(uv * 90.0) - 0.5) * 0.5 * fade(90.0, px);
  }
  return 0.5;
}
// How far each material's value follows its height, and how deep its relief reads.
vec2 texAmount(int kind) {
  if (kind == 1) return vec2(0.08, 0.35);   // plastic
  if (kind == 2) return vec2(0.14, 0.50);   // fabric
  if (kind == 3) return vec2(0.10, 0.45);   // leather
  if (kind == 4) return vec2(0.08, 0.30);   // rubber
  if (kind == 5) return vec2(0.18, 0.20);   // brushed
  if (kind == 6) return vec2(0.14, 0.45);   // cast
  if (kind == 7) return vec2(0.04, 0.18);   // paint
  if (kind == 8) return vec2(0.34, 0.0);    // wood: painted grain, value only, no relief
  if (kind == 9) return vec2(0.16, 0.45);   // carpet
  if (kind == 11) return vec2(0.24, 0.35);  // gelcoat
  return vec2(0.0);
}
// Returns a multiplier and an additive lift. ⚠ THE LIFT IS WHY A DARK SURFACE SHOWS ANYTHING: a
// multiplier on a near-black panel moves it by a level or two, so part of the relief is added
// rather than scaled — a textured black plastic is visibly textured in a real cockpit.
vec2 surfaceTex(int kind, vec3 L) {
  vec3 n = normalize(cross(dFdx(L), dFdy(L)));
  vec3 t = normalize(cross(n, abs(n.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0)));
  vec3 b = cross(n, t);
  vec2 uv = vec2(dot(L, t), dot(L, b));
  float px = max(length(fwidth(L)), 1e-5);
  // The light direction projected into the face: forward and up, the glass.
  vec3 Ld = normalize(vec3(0.1, 0.62, 0.78));
  vec2 ld = vec2(dot(Ld, t), dot(Ld, b));
  float ll = length(ld); ld = ll > 1e-3 ? ld / ll : vec2(0.0, 1.0);
  float e = max(px * 1.5, 0.0006);
  float h = texHeight(kind, uv, px);
  float slope = (texHeight(kind, uv + ld * e, px) - texHeight(kind, uv - ld * e, px));
  vec2 a = texAmount(kind);
  float v = (h - 0.5) * a.x + slope * a.y;
  return vec2(1.0 + v, v * 0.05);
}
#ifdef CABIN
centroid in vec3 vCN; flat in vec4 vCA; flat in vec4 vCB; flat in vec4 vCC; flat in vec3 vR0; flat in vec3 vR1; flat in vec3 vMA;
uniform vec3 uKey;        // what comes in through the glass, 0..1
uniform vec3 uUp;         // the sky's direction in the cab frame
uniform float uOutK;      // how much of the outside reaches the room
uniform float uAmb;       // the room's overall light
uniform vec4 uBox;        // back, front, floor, roof (metres)
uniform float uNormalLit; // the profile lights by face direction
uniform vec3 uFloodRgb; uniform float uFloodK; uniform vec4 uFloods[8]; uniform int uFloodN;
uniform vec3 uSunC;       // the sun in the cab frame
uniform float uSunCOn;    // the sun is up and not roofed over
uniform float uSunCK;     // how strong the direct sun is
uniform vec3 uCabBack; uniform vec3 uCabLow; uniform vec3 uCabHigh; uniform float uCabEnvOn;
uniform highp sampler2D uShadow; uniform mat4 uLightMat; uniform float uShadowOn; uniform float uShadowTexel;
uniform highp sampler2D uWSun; uniform mat4 uWVP; uniform float uWOn; uniform float uWTexel; uniform float uWBias;
// ⚠ THE SAME MODEL pushInteriorShell RAN PER FACE, now per pixel, plus the one thing it couldn't do:
// the direct sun, occluded by the room itself (a shadow map from the sun, drawn by this layer).
float cabShadow(vec3 P, vec3 n, float nd) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 q = uLightMat * vec4(P + n * 0.012, 1.0);
  vec3 sc = q.xyz * 0.5 + 0.5;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  float bias = 0.0008 + 0.0025 * (1.0 - nd);
  float v = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    v += step(sc.z - bias, textureLod(uShadow, sc.xy + vec2(float(i), float(j)) * uShadowTexel * 1.25, 0.0).r);
  return v / 9.0;
}
// The city's own sun map at this pixel's world position: a building's shadow falls into the cab.
float worldSunVis(vec3 wp, vec3 n) {
  if (uWOn < 0.5) return 1.0;
  vec3 p = (uWVP * vec4(wp, 1.0)).xyz * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float r = clamp(p.z - uWBias * 2.0, 0.0, 1.0), t = uWTexel;
  float s = step(r, textureLod(uWSun, p.xy + vec2(-0.5, -0.5) * t, 0.0).r) + step(r, textureLod(uWSun, p.xy + vec2(0.5, -0.5) * t, 0.0).r)
          + step(r, textureLod(uWSun, p.xy + vec2(-0.5, 0.5) * t, 0.0).r) + step(r, textureLod(uWSun, p.xy + vec2(0.5, 0.5) * t, 0.0).r);
  return s * 0.25;
}
vec3 cabinShade(vec3 base) {
  vec3 P = vLocal;
  vec3 n = vCN; bool hasN = dot(n, n) > 0.01;
  n = hasN ? normalize(n) : vec3(0.0, -1.0, 0.0);
  vec3 vv = normalize(-P);
  if (hasN && dot(n, vv) < 0.0 && vCB.x > 0.5) n = -n;
  float k = vCA.x, day = clamp(uOutK, 0.0, 1.0);
  vec3 shaded;
  if (uNormalLit > 0.5 && hasN) {
    float lam = max(0.0, n.x * 0.10 + n.y * -0.62 + 0.78 * dot(n, uUp));
    float back = max(0.0, n.y * 0.9 + n.z * 0.3);
    float side = 0.5 * abs(n.x);
    float yf = clamp((P.y - uBox.x) / (uBox.y - uBox.x), 0.0, 1.0), zf0 = clamp((P.z - uBox.z) / (uBox.w - uBox.z), 0.0, 1.0);
    float zf = uUp.z >= 0.0 ? zf0 : zf0 + (1.0 - 2.0 * zf0) * -uUp.z;
    float fac = (0.70 + 0.85 * lam + 0.45 * back + 0.30 * side) * (0.74 + 0.26 * yf) * (0.76 + 0.24 * zf) * (1.0 + 0.18 * k);
    fac *= 0.55 + 0.45 * uOutK;
    shaded = fac <= 1.0 ? base * fac : mix(min(base * fac, vec3(1.0)), uKey, clamp((fac - 1.2) * 0.4, 0.0, 0.35));
    if (vCA.z > 0.0) {
      vec3 hv = normalize(vv + vec3(0.10, 0.62, 0.78));
      float sp = vCA.z * pow(max(0.0, dot(n, hv)), max(vCA.w, 1.0)) * uOutK;
      shaded = mix(shaded, uKey, clamp(sp, 0.0, 0.8));
    }
  } else shaded = k >= 0.0 ? mix(base, uKey, k * uOutK * 0.62) : mix(base, vec3(0.012, 0.016, 0.024), -k * 0.55);
  vec3 lit = shaded * uAmb;
  float emis = clamp(vCA.y, 0.0, 1.0);
  if (emis > 0.0) lit = mix(lit, base, emis);
  // Panel floods, per pixel: pools that fall off across the board instead of one value a face.
  if (uFloodK > 0.0 && hasN && emis <= 0.0) {
    float e = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uFloodN) break;
      vec3 d = uFloods[i].xyz - P; float dl = max(length(d), 1e-4), r = dl / uFloods[i].w;
      float ci = dot(n, d) / dl;
      if (ci > 0.0) e += ci / (1.0 + r * r * 4.0);
    }
    if (e > 0.002) lit = min(lit + base * uFloodRgb * clamp(e * uFloodK, 0.0, 1.2), vec3(1.0));
  }
  // THE DIRECT SUN, through the glass and stopped by the room: sun patches on the panel and the
  // seats, the pillars' and the frame's shadows across them, turning as the airframe banks.
  float sunVis = 0.0;
  if (uSunCOn > 0.5 && hasN) {
    float nd = dot(n, uSunC);
    sunVis = cabShadow(P, n, max(nd, 0.0)) * worldSunVis(vPos, n);
    if (nd > 0.0 && emis < 1.0) lit += base * vec3(1.0, 0.93, 0.80) * nd * uSunCK * sunVis * (1.0 - emis);
  }
  float kind = vCB.x;
  if (kind > 0.5 && kind < 1.5 && hasN) {
    // A polished metal: a ramp by where it faces, then what it reflects, then the glint.
    vec3 hv = normalize(vv + vec3(0.10, 0.62, 0.78));
    float nd = max(0.0, dot(n, hv));
    vec3 g = mix(vR0, vR1, pow(nd, 1.4));
    float dn = dot(vv, n);
    if (vCC.x >= 0.0) {
      vec3 rr = normalize(2.0 * dn * n - vv);
      vec3 env;
      if (rr.y > -0.15) {
        float hz = rr.z;
        vec3 sky = mix(vec3(0.894, 0.910, 0.925), vec3(0.463, 0.620, 0.839), clamp(hz * 1.6, 0.0, 1.0));
        vec3 gnd = mix(vec3(0.588, 0.549, 0.463), vec3(0.227, 0.251, 0.196), clamp(-hz * 3.0, 0.0, 1.0));
        env = mix(gnd, sky, clamp(hz * 30.0 + 0.5, 0.0, 1.0));
        // A skyline out the glass, so cabin chrome has an edge to reflect (envRich).
        float ridge = 0.015 + 0.05 * vnoise(normalize(rr.xy + vec2(1e-5)) * 2.5 + vec2(3.1, 7.7));
        env = mix(env, vec3(1.0, 0.988, 0.941), exp(-pow(hz - ridge, 2.0) / 0.0009) * 0.6);
        env = mix(env, mix(gnd, sky, 0.3) * 0.62, smoothstep(0.012, -0.012, hz - ridge) * clamp(hz * 60.0, 0.0, 1.0));
        env = mix(env * 0.06, env, day);
        env = mix(uCabEnvOn > 0.5 ? uCabBack : vec3(0.180, 0.110, 0.063), env, clamp((rr.y + 0.15) * 4.0, 0.0, 1.0));
      } else {
        float up = clamp(rr.z * 0.6 + 0.5, 0.0, 1.0);
        env = uCabEnvOn > 0.5 ? mix(uCabLow, uCabHigh, up * up) : mix(vec3(0.275, 0.173, 0.094), vec3(0.839, 0.769, 0.659), up * up);
        env = mix(env, vec3(0.973, 0.957, 0.910), exp(-pow(rr.z - 0.55, 2.0) / 0.01) * 0.45);
        env = mix(env * 0.4, env, day);
      }
      float fres = pow(1.0 - clamp(abs(dn), 0.0, 1.0), 5.0);
      g = mix(g, mix(env * vMA, env, fres * 0.6), vCC.x);
    }
    g = mix(g * uAmb, g, 0.35);
    float h = vCC.z;
    vec3 nj = normalize(n + (vec3(h, fract(h * 97.13), fract(h * 311.7)) - 0.5) * 0.5);
    vec3 Lg = uSunCOn > 0.5 ? uSunC : vec3(0.10, 0.62, 0.78);
    float tw = pow(max(0.0, dot(nj, normalize(vv + Lg))), 90.0) * vCC.y * (uSunCOn > 0.5 ? 1.6 * sunVis : 0.8);
    lit = mix(g, vec3(1.0, 0.980, 0.894), clamp(pow(nd, vCB.z) * 0.7 + tw, 0.0, 0.85));
  }
  if (kind > 1.5 && hasN && uNormalLit > 0.5) {
    // A lacquer: its own colour under a thin clear coat that reflects the glass and the cabin.
    vec3 hv = normalize(vv + vec3(0.10, 0.62, 0.78));
    float nd = max(0.0, dot(n, hv));
    float sheen = vCB.y * pow(nd, max(6.0, vCB.z * 0.6)) * (0.35 + 0.65 * day);
    float dn = dot(vv, n);
    vec3 rr = 2.0 * dn * n - vv;
    vec3 env = rr.y > -0.1 ? mix(vec3(0.157, 0.173, 0.204), vec3(0.886, 0.910, 0.941), day) : mix(vec3(0.118, 0.078, 0.047), vec3(0.588, 0.471, 0.353), day);
    float fres = 0.04 + 0.96 * pow(1.0 - clamp(abs(dn), 0.0, 1.0), 5.0);
    lit = mix(lit, env, clamp(vCB.w * fres, 0.0, 0.45));
    if (sheen > 0.004) lit = mix(lit, vec3(1.0, 0.965, 0.894), clamp(sheen, 0.0, 0.7));
  }
  if (uSunCOn > 0.5 && vCC.w > 0.5 && hasN) {
    float sp = vCB.y * pow(max(0.0, dot(n, normalize(vv + uSunC))), vCB.z) * uOutK * sunVis;
    if (sp > 0.004) lit = mix(lit, vec3(1.0, 0.973, 0.886), clamp(sp, 0.0, 1.0));
  }
  return lit;
}
#endif
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 c = vColor;
  float alpha = vAlpha;
  if (vTex == 10) {
    // ── COCKPIT GLASS ─────────────────────────────────────────────────────────
    // Glass you look through, so it is nearly nothing straight on: what makes a pane apparent is
    // what it REFLECTS, which grows toward grazing (Fresnel), plus the handling marks on it. The
    // eye is the origin of the cockpit's own frame, so the view ray is just the position. Drawn as
    // film (no depth write) after the room, over a world that is already on screen, so the pane can
    // tint the view but never hide it.
    vec3 n = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
    vec3 d = normalize(vLocal);
    float dn = dot(n, d);
    if (dn > 0.0) { n = -n; dn = -dn; }
    vec3 R = d - 2.0 * dn * n;
    float fres = pow(1.0 - clamp(-dn, 0.0, 1.0), 4.0);
    vec3 tt = normalize(cross(n, abs(n.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0)));
    vec2 uv = vec2(dot(vLocal, tt), dot(vLocal, cross(n, tt)));
    // Smudges and a wiped arc: slow blotches, and faint streaks along one diagonal.
    float smudge = smoothstep(0.55, 0.85, vnoise(uv * 7.0)) * 0.6 + smoothstep(0.7, 0.95, vnoise(uv * 23.0)) * 0.4;
    float streak = smoothstep(0.6, 1.0, vnoise(vec2((uv.x + uv.y) * 40.0, (uv.x - uv.y) * 2.0)));
    vec3 env = envAt(R.z);
    float glint = pow(max(0.0, dot(R, uSun)), 60.0) * uSunK;
    float a = clamp(0.065 + fres * 0.45 + smudge * 0.11 + streak * 0.05 + glint * 0.6, 0.0, 0.75);
    c = mix(vColor, env, 0.7) + glint * vec3(1.0, 0.97, 0.9);
    c = mix(c, vec3(0.86, 0.88, 0.9), smudge * 0.3);
    if (uUnder > 0.001) {
      float cg = causAt(causP(vPos), n, uWaterT, causSoft()) * causDepth();
      c = mix(c, vec3(0.62, 0.9, 0.86), cg * 0.35 * uUnder);
      a = clamp(a + cg * 0.1 * uUnder, 0.0, 0.8);
    }
    alpha = a * vAlpha;
  } else if (vTex == 11) {
    // ── A HULL THAT HAS BEEN IN THE SEA ──────────────────────────────────────
    // The gelcoat texture, then what the water does to it: a dark scum band and weed tint along the
    // waterline, runs of salt streaking down the topsides from the deck edge, and a wet sheen that
    // fades up the side from wherever the last wave reached.
    vec2 tx = surfaceTex(11, vLocal); c = max(c * tx.x + tx.y, 0.0);
    float hz = vLocal.z;                                   // metres up her own side
    // ⚠ FEATURES THAT READ FROM THE CHASE CAMERA. The gelcoat's own detail is sized for a surface a
    // foot from the eye and fades out long before a hull fills a quarter of the screen, which left
    // every face one flat value. These are metre-scale and fade only when genuinely sub-pixel.
    {
      vec3 hn = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
      float hpx = max(length(fwidth(vLocal)), 1e-5);
      if (abs(hn.z) > 0.72) {
        // Deck: a moulded non-skid diamond field, with smooth margins where a gutter runs.
        vec2 g = abs(fract(vec2(vLocal.x + vLocal.y, vLocal.x - vLocal.y) * 9.0) - 0.5);
        float dia = smoothstep(0.30, 0.22, max(g.x, g.y));
        c *= 1.0 - dia * 0.10 * fade(9.0, hpx) - 0.05;
        c *= 0.93 + 0.07 * vnoise(vLocal.xy * 1.7);        // sun-faded patches
      } else {
        // Topsides: lighter up at the sheer, darker toward the chine, and the laid-up panel seams
        // along her length as fine dark lines.
        c *= mix(0.80, 1.08, clamp(hz / 1.1, 0.0, 1.0));
        float along = abs(hn.x) > abs(hn.y) ? vLocal.y : vLocal.x;
        float seam = 1.0 - smoothstep(0.0, 0.012, abs(fract(along / 1.35) - 0.5) - 0.488);
        c *= 1.0 - seam * 0.22 * fade(1.0 / 0.024, hpx);
        c *= 0.94 + 0.10 * vnoise(vec2(along * 0.9, hz * 3.0));
      }
    }
    float wl = uWaterZ > -1e8 ? (uWaterZ - vPos.z) : -1.0; // + below the line
    float scum = smoothstep(-0.03, 0.0, wl) * (1.0 - smoothstep(0.0, 0.02, wl));
    c = mix(c, c * vec3(0.55, 0.62, 0.5), scum * 0.8);
    float runs = smoothstep(0.62, 0.95, vnoise(vec2(vLocal.x * 9.0 + vLocal.y * 9.0, hz * 0.6)));
    float up = clamp(hz / 1.4, 0.0, 1.0);
    c = mix(c, c * 0.78 + vec3(0.05, 0.05, 0.045), runs * up * 0.35);
    float wet = uWaterZ > -1e8 ? (1.0 - smoothstep(0.0, 0.03, vPos.z - uWaterZ)) : 0.0;
    c *= 1.0 - wet * 0.18;
  } else if (vTex > 0) { vec2 tx = surfaceTex(vTex, vLocal); c = max(c * tx.x + tx.y, 0.0); }
#ifdef CABIN
  if (vCB.x > -0.5 && vTex != 10) c = cabinShade(c);
#endif
  // PER PIXEL: the view ray changes across every face and the normal is smoothed across the
  // facets (upload), so a hub or a barrel carries one continuous reflection rather than a band per
  // face. A metal (vMetal > 0) takes the reflection tinted by its own colour; a clear coat
  // (vMetal < 0) only a sheen toward grazing. The sun glints where the reflected ray finds it.
  // ── THE WORLD AROUND THE PAINT ───────────────────────────────────────────
  // A painted face's colour is baked on the CPU against one sun and nothing else, so an aircraft
  // standing in a neon city at night looked exactly as it did at noon on a field. Every face that
  // carries a normal takes the tint of the half of the world it faces — sky above, ground below —
  // and a belly facing the ground goes a shade darker. Hue from the environment, not brightness,
  // or the night sky would just black the model out.
  if (dot(vN, vN) > 0.01 && vMetal <= 0.0) {
    vec3 na = normalize(vN);
    vec3 a = envAt(na.z * 0.5);
    float al = max(dot(a, vec3(0.3333)), 0.04);
    vec3 tint = mix(vec3(1.0), a / al, 0.45);
    c *= tint * (0.82 + 0.26 * clamp(na.z * 0.5 + 0.5, 0.0, 1.0));
  }
  bool flatPlate = abs(vMetal) >= 1.5;          // FLAT_TAG in smooth(): a flat plate or pane, no glint
  float mtl = flatPlate ? vMetal - sign(vMetal) * 2.0 : vMetal;
  if (abs(mtl) > 0.001) {
    vec3 n = normalize(vN);
    vec3 d = normalize(vPos - uEye);
    if (dot(n, d) > 0.0) n = -n;
    float dn = dot(d, n);
    vec3 R = d - 2.0 * dn * n;
    // ⚠ A FLAT PLATE SEES A BLURRED WORLD. Its reflected ray barely changes across the face, so the
    // sharp horizon in envAt turns the whole plate into one colour at once (the square of sky beside
    // the minigun). envSoft has no horizon line, only a slow gradient, so the small change in R.z
    // across a plate reads as a sheen running over it rather than a switch.
    // envRich at a wide horizon keeps the plate from switching all at once and still gives it a
    // skyline to carry; a curve gets the horizon as sharp as its pixels allow, no sharper (shimmer).
    vec3 env = flatPlate ? envRich(R, 0.2) : envRich(R, max(0.012, fwidth(R.z) * 1.5));
    float fres = pow(1.0 - clamp(abs(dn), 0.0, 1.0), 5.0);
    if (mtl > 0.0) {
      // Tinted by the metal, but never below a floor: dark gun metal still reflects a good share of
      // the world, it only darkens it. Multiplied straight by a near-black it reflected nothing.
      // The untinted share (0.25 + Fresnel) is what reads as polish: a mirror shows the world in
      // its own colours, most of all at a grazing angle.
      vec3 t = env * clamp(c * 1.275 + 0.35, 0.0, 1.0);
      c = mix(c, mix(t, env, 0.25 + fres * 0.5), clamp(mtl * 1.1 + fres * 0.25, 0.0, 0.97));
    } else {
      c = mix(c, env, clamp(-mtl * (0.25 + 0.75 * fres), 0.0, 0.6));
    }
    // The sun in it: a tight hot core and a broad soft lobe around it, which is what makes polished
    // metal look wet. A flat plate gets the soft lobe only — the core on a plane lights the whole
    // face at once, the same way the horizon did.
    float sd = max(0.0, dot(R, uSun));
    float core = flatPlate ? 0.0 : pow(sd, 140.0);
    float lobe = pow(sd, 14.0) * 0.28;
    c = mix(c, vec3(1.0, 0.98, 0.93), clamp((core + lobe) * uSunK * max(0.3, abs(mtl)), 0.0, 0.95));
  }
  if (uUnder > 0.001 && vTex != 10) {
    vec3 nn = dot(vN, vN) > 0.01 ? normalize(vN) : vec3(0.0, 0.0, 1.0);
    float up = clamp(nn.z * 0.75 + 0.25, 0.0, 1.0);          // lit from the surface overhead
    float cn = causAt(causP(vPos), nn, uWaterT, causSoft()) * causDepth();
    float lum = dot(c, vec3(0.3333));
    c *= mix(vec3(1.0), vec3(0.42, 0.76, 0.86), uUnder);
    c += vec3(0.5, 0.82, 0.78) * cn * up * uUnder * (0.18 + 0.5 * lum);
  }
  // ── THE WATERLINE ─────────────────────────────────────────────────────────
  // A hull sitting in the sea: what is under the surface is seen through water, which takes red first
  // and blue last, so it goes green-blue and dark with depth; and a bright wet band marks where the
  // surface crosses her, which is what says where the water is from the side. uWaterZ is far below
  // the world whenever nothing is afloat.
  {
    float dz = uWaterZ - vPos.z;
    if (dz > 0.0) {
      vec3 ext = exp(-dz * vec3(70.0, 28.0, 18.0));
      // Seen through a moving surface: the light on her ripples in bands (caustics) that slide with
      // the water, and the colour wavers with them. Fades in over the first few centimetres of depth.
      float wob = sin(vPos.x * 420.0 + sin(vPos.y * 310.0 + uWaterT * 2.1) * 2.0 + uWaterT * 1.6)
                * sin(vPos.y * 380.0 - uWaterT * 1.3 + sin(vPos.z * 500.0 + uWaterT) * 1.5);
      float fin = smoothstep(0.0, 0.006, dz);
      c *= 1.0 + wob * 0.28 * fin;
      c = c * ext + vec3(0.04, 0.2, 0.24) * (1.0 - ext);
    }
    float band = 1.0 - smoothstep(0.0, 0.004, abs(dz));
    c = mix(c, vec3(0.9, 0.96, 1.0), band * 0.75);
  }
  c = mix(c, uFog, vFog);
  outColor = vec4(c * alpha, alpha);   // premultiplied, like every other layer on this canvas
}`;

const withCabin = (src) => src.replace('#version 300 es\n', '#version 300 es\n#define CABIN\n');
const VERT_C = withCabin(VERT), FRAG_C = withCabin(FRAG);
// The room's depth from the sun. A kind of -1 (a pane) is thrown out of the clip volume: glass lets
// the sun through.
const SH_VERT = `#version 300 es
in vec3 aLocal;
in vec4 aCB;
uniform mat4 uLightMat;
void main() { gl_Position = aCB.x < -0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : uLightMat * vec4(aLocal, 1.0); }`;
const SH_FRAG = `#version 300 es
precision mediump float;
void main() {}`;
const SHADOW_SIZE = 1024;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' solids shader: ' + log);
  }
  return sh;
}

export function createSolidsLayer(gl, opt = {}) {
  const cabin = !!opt.cabin;
  const VS = cabin ? VERT_C : VERT, FS = cabin ? FRAG_C : FRAG, ST = cabin ? STRIDE + CAB : STRIDE;
  // Prewarmed with the context when it can be (programs.js); built here otherwise.
  let prog = takeWarm(gl, VS, FS);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS, 'fragment'));
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('solids link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    color: gl.getAttribLocation(prog, 'aColor'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    model: gl.getUniformLocation(prog, 'uModel'),
    attA: gl.getUniformLocation(prog, 'uAttA'), attB: gl.getUniformLocation(prog, 'uAttB'), attOn: gl.getUniformLocation(prog, 'uAttOn'),
    nScale: gl.getUniformLocation(prog, 'uNScale'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    normal: gl.getAttribLocation(prog, 'aNormal'),
    metal: gl.getAttribLocation(prog, 'aMetal'),
    local: gl.getAttribLocation(prog, 'aLocal'),
    tex: gl.getAttribLocation(prog, 'aTex'),
    eye: gl.getUniformLocation(prog, 'uEye'),
    skyHor: gl.getUniformLocation(prog, 'uSkyHor'),
    skyTop: gl.getUniformLocation(prog, 'uSkyTop'),
    night: gl.getUniformLocation(prog, 'uNight'),
    sun: gl.getUniformLocation(prog, 'uSun'),
    sunK: gl.getUniformLocation(prog, 'uSunK'),
    waterZ: gl.getUniformLocation(prog, 'uWaterZ'),
    waterT: gl.getUniformLocation(prog, 'uWaterT'),
    under: gl.getUniformLocation(prog, 'uUnder'),
    underD: gl.getUniformLocation(prog, 'uUnderD'),
  };

  const vao = gl.createVertexArray();
  // One stream, set up once: the attribute pointers are recorded into the VAO here and never
  // touched again, and the storage grows by doubling instead of being reallocated every frame.
  // See gl/stream.js.
  const attrs = [[loc.pos, 3, 0], [loc.color, 3, 12], [loc.alpha, 1, 24], [loc.normal, 3, 28], [loc.metal, 1, 40], [loc.local, 3, 44], [loc.tex, 1, 56]];
  const cl = {};
  if (cabin) {
    for (const [name, n, off] of [['aCN', 3, 0], ['aCA', 4, 3], ['aCB', 4, 7], ['aCC', 4, 11], ['aR0', 3, 15], ['aR1', 3, 18], ['aMA', 3, 21]])
      attrs.push([gl.getAttribLocation(prog, name), n, (STRIDE + off) * 4]);
    for (const u of ['uKey', 'uUp', 'uOutK', 'uAmb', 'uBox', 'uNormalLit', 'uFloodRgb', 'uFloodK', 'uFloods', 'uFloodN', 'uSunC', 'uSunCOn', 'uSunCK',
      'uCabBack', 'uCabLow', 'uCabHigh', 'uCabEnvOn', 'uShadow', 'uLightMat', 'uShadowOn', 'uShadowTexel', 'uWSun', 'uWVP', 'uWOn', 'uWTexel', 'uWBias']) cl[u] = gl.getUniformLocation(prog, u);
  }
  const stream = makeVertexStream(gl, vao, ST, attrs, 8192);
  let data = new Float32Array(1 << 13);
  let count = 0;

  // A fan, so a triangle, a quad and the occasional ring out of the mesh builders all go through
  // one loop — the same shape ground.js fills for the same reason.
  const tris = (list) => list.reduce((n, q) => n + Math.max(0, q.p.length - 2) * 3, 0);

  // ── FILM: THE TRANSLUCENT THINGS A SOLID CARRIES ─────────────────────────────
  // A quad marked `film` (a rotor blade, its blur disc) is tested against depth and writes none, and
  // it goes at the END of the buffer so the caller can draw it as a second range after the opaque
  // world. Written into depth like a solid it would punch its own shape out of the floor and the
  // ground, which are drawn after this layer. `filmAt` is where that range starts, in vertices.
  let filmAt = 0;
  // ── SMOOTHED NORMALS FOR THE METALS ──────────────────────────────────────────
  // A metal face carries its own flat normal (`n`). A corner shared with a neighbouring metal face
  // that meets it at under 60° takes the average of the two, so a round part reflects as one curve;
  // a sharper corner keeps its edge. Keyed on the vertex position, which the faces of one mesh share.
  let env = null;
  const FLAT_METAL = 0.55;   // share of its reflection a flat plate keeps; it reflects a BLURRED world (envSoft), never the sharp one (see smooth)
  const FLAT_TAG = 2.0;      // decoded in the fragment shader: vMetal >= 1.5 is a flat plate of strength vMetal - 2
  // ⚠ THE SAME GROUPING AS A STRING KEY, WITHOUT BUILDING ONE PER VERTEX. Corners are shared when
  // their positions quantise to the same 1/4096-tile cell — that rule is unchanged. What changed is
  // the lookup: the three cell numbers hash to an integer bucket and each bucket is checked for an
  // EXACT triple match, so two corners that collide in the hash are still kept apart. The string
  // version allocated three concatenations per vertex, twice, every frame, for every solid.
  const cellHash = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) | 0;
  function smoothCell(at, v, create) {
    const x = (v[0] * 4096) | 0, y = (v[1] * 4096) | 0, z = (v[2] * 4096) | 0, h = cellHash(x, y, z);
    let b = at.get(h);
    if (b) for (let i = 0; i < b.length; i++) { const e = b[i]; if (e.x === x && e.y === y && e.z === z) return e.l; }
    if (!create) return null;
    const e = { x, y, z, l: [] };
    if (!b) at.set(h, (b = []));
    b.push(e);
    return e.l;
  }
  function smooth(quads) {
    const at = new Map();
    for (const q of quads) if (q.m && q.n) for (const v of q.p) smoothCell(at, v, true).push(q.n);
    for (const q of quads) {
      if (!(q.m && q.n)) continue;
      if (q.env) env = q.env;
      let curved = false;
      q.vn = q.p.map((v) => {
        let x = 0, y = 0, z = 0;
        for (const m of smoothCell(at, v, false) || []) {
          const d = m[0] * q.n[0] + m[1] * q.n[1] + m[2] * q.n[2];
          if (d > 0.5) { x += m[0]; y += m[1]; z += m[2]; }
          // Curved = any neighbour turning away by less than a right angle: a five-sided gun barrel
          // (72° between facets) is a tube, not five plates, so it keeps its chrome.
          if (d > 0.05 && d < 0.999) curved = true;
        }
        const l = Math.hypot(x, y, z) || 1;
        return [x / l, y / l, z / l];
      });
      // ⚠ A FLAT METAL PLATE IS NOT A MIRROR. With no curved neighbour every pixel of the face
      // reflects along nearly the same ray, so the whole plate takes ONE colour off `envAt` — and
      // that function has a hard horizon line in it, so the plate flips from ground-dark to
      // sky-bright all at once as the view turns. On the Drake that was the minigun's yoke cheeks
      // and clamp caps turning into a bright square over the gun. A curved part keeps its full
      // reflection, because there the band walks across it; a plate keeps a sheen.
      // ⚠ AND THE SUN GLINT IS WORSE: `pow(dot(R, uSun), 90)` on one constant ray lights the WHOLE
      // plate or none of it, so at one exact angle the plate flashed white. A flat plate is sent as
      // FLAT_TAG + strength and the shader gives it the reflection without the glint floor.
      // A flat pane of CLEAR COAT (glass, negative) is the same story at grazing angles: Fresnel takes
      // the whole pane to one pale sky colour at once, which is the square that sat beside the gun.
      if (!curved && q.m > 0) q.m = FLAT_TAG + q.m * FLAT_METAL;
      else if (!curved && q.m < 0) q.m = -FLAT_TAG + q.m * FLAT_METAL;
    }
  }
  // ── ⚠ INCREMENTAL MODE: ONLY WHAT CHANGED GOES TO THE GPU ──────────────────────────────────
  // `upload(quads, model)` with a model matrix takes each face's LOCAL points (`q.mp`) and draws them
  // through that matrix. The cab interior is the one caller: it is rebuilt every frame in the same
  // order, and in its own frame almost none of it moves — only the needles, the wheel and a lamp or
  // two. So a quad unchanged since last frame is skipped, every other one is written and compared
  // with what was there last frame, and only the spans that differ are sent. Measured at ~1.9 ms of a cab frame to send the whole
  // buffer every frame for a room that had barely changed. Anything that changes the LAYOUT (a
  // different vertex count, a regrown buffer) sends everything, exactly as before.
  let model = null, prevCount = -1, dirty = [];
  let light = null, shadowDirty = false;
  // Last frame's buffer, as sent, and both buffers' bits: a bitwise compare is exact and needs no
  // Math.fround. A quad that wrote anything is compared over its own range only.
  let prev = null, prevBits = null, dataBits = null;
  // ⚠ AND A QUAD THAT IS THE SAME OBJECT, IN THE SAME SLOT, AT THE SAME OFFSET, IS NOT WRITTEN AT ALL.
  // The cab hands back last frame's record for every face the part memo returned unchanged (see
  // cabFace in windshield.js), and in this mode a record's floats are all local or per-face, so they
  // are the floats already in `data`. That holds only while the caller never edits a record it
  // re-sends: one that does must send a new object. The offset check catches a quad ahead of it
  // changing its vertex count, which moves everything after it.
  const slotQ = [], slotO = [];
  function ensurePrev() {
    if (!prev || prev.length !== data.length) { prev = new Float32Array(data.length); prevBits = new Int32Array(prev.buffer); }
    if (!dataBits || dataBits.buffer !== data.buffer) dataBits = new Int32Array(data.buffer);
  }
  function markDirty(a, b) {
    let i = a;
    while (i < b && dataBits[i] === prevBits[i]) i++;
    if (i === b) return;
    prev.set(data.subarray(a, b), a);
    const last = dirty.length ? dirty[dirty.length - 1] : null;
    if (last && a - last[1] <= 3 * ST) last[1] = b; else dirty.push([a, b]);
  }
  // `att` is the seat's attitude for the cab (see seatAtt in the vertex shader), so a banked or
  // pitched seat still sends local points and stays incremental.
  let attP = null;
  function upload(quads, mdl = null, lt = null, att = null) {
    attP = att;
    light = lt; shadowDirty = !!(lt && lt.lightMat);
    count = quads && quads.length ? tris(quads) : 0;
    filmAt = count;
    env = null;
    const incr = !!mdl;
    model = mdl;
    if (!count) { prevCount = -1; return 0; }
    smooth(quads);
    let fresh = false;
    if (data.length < count * ST) { data = new Float32Array(Math.max(count * ST, 1 << 13)); fresh = true; }
    const full = !incr || fresh || count !== prevCount;
    prevCount = incr ? count : -1;
    dirty.length = 0;
    if (incr) ensurePrev();
    let o = 0, qi = 0;
    // One vertex into the buffer. Incremental mode writes the same way and finds what changed
    // afterwards, in one pass over two typed arrays (see `diffSpans`). Comparing as it wrote, one
    // closure call and one Math.fround per float, cost ~7 ms a cab frame for a room where nothing
    // had changed and nothing was sent.
    const put = (q, r, g, b, qa, mk, tx, j) => {
      const v = incr ? q.mp[j] : q.p[j];
      data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2];
      data[o + 3] = r; data[o + 4] = g; data[o + 5] = b;
      data[o + 6] = qa;
      // A quad with no normal writes (0,0,0), which the shader reads as "not lit by the world" — the
      // cab, the shed and every caller that never asked. `amb` (an aircraft's painted faces) asks.
      const nn = q.vn ? q.vn[j] : q.amb ? q.n : null;
      data[o + 7] = nn ? nn[0] : 0; data[o + 8] = nn ? nn[1] : 0; data[o + 9] = nn ? nn[2] : 0;
      data[o + 10] = mk;
      const L = q.lp ? q.lp[j] : null;
      data[o + 11] = L ? L[0] : 0; data[o + 12] = L ? L[1] : 0; data[o + 13] = L ? L[2] : 0;
      data[o + 14] = L ? tx : 0;
      if (cabin) { const C = q.cab || CAB_NONE; for (let i = 0; i < CAB; i++) data[o + STRIDE + i] = C[i]; }
      o += ST;
    };
    const put1 = (q) => {
      const c = q.rgb, qa = q.a == null ? 1 : q.a;
      const r = c ? c[0] / 255 : 0, g = c ? c[1] / 255 : 0, b = c ? c[2] / 255 : 0;
      const mk = q.m || 0, tx = q.tex || 0, len = q.p.length;
      const slot = qi++, a0 = o;
      if (incr && !full && slotQ[slot] === q && slotO[slot] === a0) { o += Math.max(0, len - 2) * 3 * ST; return; }
      for (let i = 1; i + 1 < len; i++) { put(q, r, g, b, qa, mk, tx, 0); put(q, r, g, b, qa, mk, tx, i); put(q, r, g, b, qa, mk, tx, i + 1); }
      if (incr) { slotQ[slot] = q; slotO[slot] = a0; if (!full) markDirty(a0, o); }
    };
    let film = 0;
    for (const q of quads) { if (q.film) film++; else put1(q); }
    filmAt = o / ST;
    if (film) for (const q of quads) if (q.film) put1(q);
    if (incr) { slotQ.length = qi; slotO.length = qi; if (full) prev.set(data.subarray(0, count * ST)); }
    else { slotQ.length = 0; slotO.length = 0; }
    // A handful of scattered spans is cheaper as spans; past that the driver is better off with one.
    if (full || dirty.length > 48) stream.write(data, count * ST);
    else for (const [a, b] of dirty) stream.writeRange(data, a, b - a);
    return quads.length;
  }

  // `opts.film` draws the film range instead of the solid one; see above.
  // ── THE SUN'S VIEW OF THE ROOM ─────────────────────────────────────────────
  // Depth only, from the sun, over the room's own box (light.lightMat, built in cab metres), once a
  // frame before the room's first draw. Faces are drawn by their LOCAL points (aLocal), so the same
  // map serves the level and the banked cockpit alike: the sun is turned into the cab frame instead.
  let sh = null;
  function shadowPass() {
    if (!sh) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, SH_VERT, 'shadow vertex'));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, SH_FRAG, 'shadow fragment'));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('cabin shadow link: ' + gl.getProgramInfoLog(p));
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // ⚠ A PLAIN DEPTH READ, NOT THE COMPARE SAMPLER: through ANGLE on D3D11 the compare came back
      // saturated for the city's map (see gl/shadow.js), so both maps compare by hand.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      const svao = gl.createVertexArray();
      gl.bindVertexArray(svao);
      gl.bindBuffer(gl.ARRAY_BUFFER, stream.buf);
      const lL = gl.getAttribLocation(p, 'aLocal'), lB = gl.getAttribLocation(p, 'aCB');
      if (lL >= 0) { gl.enableVertexAttribArray(lL); gl.vertexAttribPointer(lL, 3, gl.FLOAT, false, ST * 4, 44); }
      if (lB >= 0) { gl.enableVertexAttribArray(lB); gl.vertexAttribPointer(lB, 4, gl.FLOAT, false, ST * 4, (STRIDE + 7) * 4); }
      gl.bindVertexArray(null);
      sh = { p, tex, fbo, svao, ok, mat: gl.getUniformLocation(p, 'uLightMat') };
    }
    if (!sh.ok) return false;
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT);
    const scis = gl.isEnabled(gl.SCISSOR_TEST), blend = gl.isEnabled(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sh.fbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(sh.p);
    gl.uniformMatrix4fv(sh.mat, false, light.lightMat);
    gl.bindVertexArray(sh.svao);
    gl.drawArrays(gl.TRIANGLES, 0, filmAt);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (scis) gl.enable(gl.SCISSOR_TEST);
    if (blend) gl.enable(gl.BLEND);
    return true;
  }
  function cabinUniforms(ws) {
    const L = light || {};
    const v3 = (u, a, d) => { const x = a || d; gl.uniform3f(cl[u], x[0], x[1], x[2]); };
    v3('uKey', L.key, [0.5, 0.5, 0.5]); v3('uUp', L.up, [0, 0, 1]);
    gl.uniform1f(cl.uOutK, L.outK ?? 1); gl.uniform1f(cl.uAmb, L.amb ?? 1);
    const B = L.box || [-1, 1, -1, 1]; gl.uniform4f(cl.uBox, B[0], B[1], B[2], B[3]);
    gl.uniform1f(cl.uNormalLit, L.normalLit ? 1 : 0);
    v3('uFloodRgb', L.floodRgb, [0, 0, 0]); gl.uniform1f(cl.uFloodK, L.floodRgb ? (L.floodK || 0) : 0);
    const fl = L.floods || [];
    if (fl.length) gl.uniform4fv(cl.uFloods, fl);
    gl.uniform1i(cl.uFloodN, Math.min(8, fl.length / 4));
    v3('uSunC', L.sunC, [0, 0, 1]); gl.uniform1f(cl.uSunCOn, L.sunC ? 1 : 0); gl.uniform1f(cl.uSunCK, L.sunK || 0);
    const E = L.cabEnv; gl.uniform1f(cl.uCabEnvOn, E ? 1 : 0);
    v3('uCabBack', E && E.back, [0, 0, 0]); v3('uCabLow', E && E.low, [0, 0, 0]); v3('uCabHigh', E && E.high, [0, 0, 0]);
    const shOn = !!(L.lightMat && sh && sh.ok);
    gl.uniform1f(cl.uShadowOn, shOn ? 1 : 0);
    gl.uniform1f(cl.uShadowTexel, 1 / SHADOW_SIZE);
    if (L.lightMat) gl.uniformMatrix4fv(cl.uLightMat, false, L.lightMat);
    // ⚠ A SHADOW SAMPLER MUST ALWAYS HAVE A DEPTH TEXTURE BOUND, even when it isn't read, or the
    // draw is invalid on some drivers. Unit 7, clear of the atlas on 0.
    if (sh) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, sh.tex); gl.uniform1i(cl.uShadow, 7); }
    // The city's map on unit 6; with none, the room's own map stands in so the sampler is never empty.
    const wOn = !!(ws && ws.tex && ws.vp && L.sunC && L.worldSun !== false);
    gl.uniform1f(cl.uWOn, wOn ? 1 : 0);
    if (wOn) { gl.uniformMatrix4fv(cl.uWVP, false, ws.vp); gl.uniform1f(cl.uWTexel, ws.texel || 0); gl.uniform1f(cl.uWBias, ws.bias || 0); }
    const wt = wOn ? ws.tex : (sh && sh.tex);
    if (wt) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, wt); gl.uniform1i(cl.uWSun, 6); }
    gl.activeTexture(gl.TEXTURE0);
  }
  function draw(cam, cssH, opts = {}) {
    const first = opts.film ? filmAt : 0, n = opts.film ? count - filmAt : filmAt;
    if (!n) return 0;
    if (cabin && !opts.film && shadowDirty && light && filmAt > 0) { shadowPass(); shadowDirty = false; }
    if (cabin && !sh) {
      // Build the map once even on a frame with no sun, so the sampler always has its texture.
      const keep = light; light = { lightMat: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
      try { shadowPass(); } finally { light = keep; }
    }
    gl.useProgram(prog);
    if (cabin) cabinUniforms(opts.worldSun);
    // ⚠ THE CLIP RANGE IS THE CALLER'S WHEN IT STATES ONE. Every world client leaves it out and
    // gets exactly the matrix it always got — `viewProjMatrix` defaults to NEAR/FAR — which is what
    // makes this safe under the rig, the shed and the fauna at once. The interior states one
    // because it is INSIDE the ordinary near plane: a cab is about a twentieth of a tile deep and
    // NEAR is 0.06, so every surface of it is nearer than the nearest thing the world camera can
    // draw, and the whole room clips away to nothing. See drawInterior.
    gl.uniformMatrix4fv(loc.viewProj, false, viewProjMatrix(cam, cssH, opts.near, opts.far));
    gl.uniformMatrix4fv(loc.model, false, model || IDENT);
    if (cabin) {
      const A = model ? attP : null;
      gl.uniform1f(loc.attOn, A ? 1 : 0);
      if (A) { gl.uniform4f(loc.attA, A.cy, A.sy, A.cb, A.sb); gl.uniform4f(loc.attB, A.kr, A.ku, A.hr, A.hu); }
    }
    gl.uniform1f(loc.nScale, model ? 1 / Math.hypot(model[0], model[1], model[2]) : 1);
    const f = opts.fog;
    gl.uniform3f(loc.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(loc.fogNear, f ? f.near : 1e9);
    gl.uniform1f(loc.fogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(loc.fogAmt, f ? f.amt : 0);
    // What the metals reflect (the sky the frame drew, handed over on the quads) and the eye they are
    // seen from. A buffer with no metal in it leaves these at harmless values the shader never reads.
    const e = eyePos(cam), E = env || {};
    gl.uniform3f(loc.eye, e[0], e[1], e[2]);
    const hor = E.hor || [214, 222, 230], top = E.top || [92, 136, 196], sn = E.sun;
    gl.uniform3f(loc.skyHor, hor[0] / 255, hor[1] / 255, hor[2] / 255);
    gl.uniform3f(loc.skyTop, top[0] / 255, top[1] / 255, top[2] / 255);
    gl.uniform1f(loc.night, E.night || 0);
    gl.uniform3f(loc.sun, sn ? sn[0] : 0, sn ? sn[1] : 0, sn ? sn[2] : 1);
    gl.uniform1f(loc.sunK, sn ? (E.sunK || 0) : 0);
    gl.uniform1f(loc.waterZ, opts.water != null ? opts.water : -1e9);
    gl.uniform1f(loc.waterT, (performance.now() / 1000) % 1000);
    gl.uniform1f(loc.under, opts.under || 0);
    gl.uniform1f(loc.underD, opts.underD || 0);
    // ⚠ DEPTH-WRITE ON. This is a solid object: it has to hide what is behind it and be hidden by
    // what is in front, which is the whole point of moving it here. Off for film, and put back.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(!opts.film);
    gl.disable(gl.CULL_FACE);   // see the ⚠ at the top — sheets, and a mirrored winding
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, first, n);
    gl.bindVertexArray(null);
    if (opts.film) gl.depthMask(true);
    return n / 3;
  }

  return { upload, draw, get faces() { return count / 3; } };
}

declareProgram(VERT, FRAG);
declareProgram(VERT_C, FRAG_C);
