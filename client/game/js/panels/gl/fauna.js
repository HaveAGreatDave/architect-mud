// BIRDS AS INSTANCED MESHES, THEIR WINGBEAT BAKED INTO A TEXTURE.
//
// The solids layer draws a bird the way it draws the rig: every vertex transformed on the CPU,
// fan-expanded, uploaded, every frame. At a 1,651-bird murmuration that was measured as three
// quarters of the whole bird cost — 4.1-4.5 ms in the per-bird loop building faces and ~3.5 ms of
// GL upload and draw, against 2.4 ms for the flock simulation itself. This layer moves the
// transform onto the GPU and hands over nine floats a bird instead of about a thousand.
//
// ⚠ THE POSES ARE NOT A SECOND MODEL. `faunaPoseBake` in fauna3d.js walks the same `faunaPose`
// cache the CPU path reads, fan-expanded exactly as solids.js expands it, so the instanced bird and
// the solids bird are the same triangles in the same colours. It was checked for every one of the
// 152 pose groups before this file was written: 0 vertices differ.
//
// ⚠ ONE MESH PER POSE GROUP — kind, id, state, flare, gear, tier — and the wingbeat is a TEXTURE ROW.
// Within a group only positions move; the topology is identical across all sixteen beat steps. The
// feet are the one part that adds faces, which is why gear is a group and not a row.
//
// ⚠ THE TRANSFORM IS faunaWorldFaces's, TERM FOR TERM. Heading, pitch and roll build the same
// F/S/U basis in the same order, so a bird cannot come out mirrored or banked the other way on the
// GPU. Read the note on that function before changing either.
//
// ⚠ AND THE SHADING IS solids.js's: flat colour, the same fog, premultiplied alpha, depth written,
// no culling. A bird drawn here and a bird drawn there must be indistinguishable in a still.
import { viewProjMatrix } from './camera.js';
import { makeVertexStream } from './stream.js';
import { faunaPoseSlot, faunaPoseBake, FAUNA_BEAT_STEPS, FAUNA_GLIDE_ROW, FAUNA_PECK_ROW } from '../fauna3d.js';
import { zRow, NEAR } from './camera.js';
import { LIGHT_PULL } from './sprites.js';
import { PULSE_MAX } from '../murmur.js';
import { declareProgram, takeWarm } from './programs.js';

// Per instance: x, y, z, scale | heading, pitch, roll, row | alpha
const STRIDE = 9;
// A unit no other layer binds (0-5 are taken), so a pose texture can never be left where another
// layer expects its own — and never be read by a program whose target it is.
const UNIT = 7;
// The murmuration's state textures when drawing, 12-14: clear of the simulation's own 8-11 in
// gl/murmur-gpu.js, so neither pass can find a texture of the other's still bound where it samples.
const CLOUD_UNIT = 12;
const NO_SAG = new Float32Array(8);

const VERT = `#version 300 es
in vec3 aColor;
in vec4 iPos;
in vec4 iAng;
in float iAlpha;
uniform highp sampler2D uPose;
uniform mat4 uViewProj;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vColor;
out float vFog;
out float vAlpha;
void main() {
  vec3 m = texelFetch(uPose, ivec2(gl_VertexID, int(iAng.w + 0.5)), 0).xyz * iPos.w;
  float ch = cos(iAng.x), sh = sin(iAng.x);
  float cp = cos(iAng.y), sp = sin(iAng.y);
  float cr = cos(iAng.z), sr = sin(iAng.z);
  vec3 F = vec3(ch * cp, sh * cp, sp);
  vec3 S0 = vec3(-sh, ch, 0.0);
  vec3 U0 = vec3(-ch * sp, -sh * sp, cp);
  vec3 S = S0 * cr + U0 * sr;
  vec3 U = U0 * cr - S0 * sr;
  vec3 w = iPos.xyz + F * m.x + S * m.y + U * m.z;
  vec4 clip = uViewProj * vec4(w, 1.0);
  gl_Position = clip;
  vColor = aColor;
  vAlpha = iAlpha;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFog;
in float vAlpha;
uniform vec3 uFog;
out vec4 outColor;
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 c = mix(vColor, uFog, vFog);
  outColor = vec4(c * vAlpha, vAlpha);
}`;

// ── A MURMURATION, DRAWN STRAIGHT OUT OF THE GPU FLOCK'S TEXTURES ─────────────
//
// gl/murmur-gpu.js keeps every starling's position (with its roll) and velocity (with its visibility)
// in float textures. These two programs draw the flock from them with nothing read back to the CPU:
// one instanced draw per detail level, over EVERY bird, each vertex shader working out for its own
// bird what windshield.js's per-bird loop and pushFauna used to work out on the CPU — the camera-forward
// cull and the fade toward the draw limit, the bird's wingspan in pixels, which detail level that
// buys, the wingbeat row, the bank (its own roll plus the hawk's wave) — and collapsing to nothing if
// the bird belongs to another level. The numbers arrive in the record windshield.js pushes, so this
// file imports nothing from it.
//
// ⚠ THE DETAIL LADDER IS pushFauna's, WITHOUT ITS BUDGETS. On the CPU a bird that lost the mesh budget
// was demoted to a glyph or a dot; here a mesh costs a vertex shader and nothing is rationed, so every
// bird is drawn at the level its own size earns.
// Landing and take-off poses (see uPoseSel): a bird counts as in the air above ALOFT_H tiles (the walking
// bob stays well under it), climbs faster than CLIMB_VZ tiles/s on the way up, and brakes below BRAKE_H.
const ALOFT_H = '0.015', CLIMB_VZ = '0.02', BRAKE_H = '0.12';
// ⚠ WHEN A WING BLURS: past WING_BLUR_FROM of a beat per rendered frame it starts to, and it is fully blurred
// WING_BLUR_SPAN later; a starling at 13 Hz and 60 fps is 0.22 of a beat a frame, a slow flap near zero. A
// blurred wing fades by up to WING_BLUR_FADE at its tip.
const WING_BLUR_FROM = '0.12', WING_BLUR_SPAN = '0.2', WING_BLUR_FADE = '0.45';
const CLOUD_HEAD = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPosT;
uniform highp sampler2D uVelT;
// the state one step earlier and how far between the two to draw: a cloud stepped every other frame
// or third (STEP_BUDGET_MS in murmur-gpu.js) is drawn between its last two steps, 1.0 for one stepped every frame
uniform highp sampler2D uPosP;
uniform highp sampler2D uVelP;
uniform float uLerp;
uniform highp sampler2D uStat0;
uniform mat4 uViewProj;
uniform vec2 uOrigin;
uniform vec4 uCull;        // cam ox, oy, sinh, cosh
uniform vec4 uCull2;       // fwdOff, near, far, alpha multiplier
uniform float uFL;
uniform float uSpan;
uniform vec4 uTierPx;      // glyph from, mesh from, glyph below, coarse below
uniform float uFarHi;
uniform vec4 uAgit[${PULSE_MAX}]; // the hawk's pulse train: x, y, front, amplitude, one a pulse
uniform int uAgitN;
uniform float uWaveW;
uniform vec2 uBank;        // bank per stored unit, bank max
uniform ivec2 uTierClamp;  // the finest and coarsest level drawn for this cloud (see tierSpan)
uniform highp sampler2D uStat2; // the ground mill's phase, for the bob
uniform vec3 uGround;      // 1 when the flock is down; the bob's phase; the bob's height in tiles
uniform highp sampler2D uStat4; // a flock on ledges or wires: each bird's spot, the height of what it is on, its place along a wire
uniform highp sampler2D uStat5; // ...its heading there, which ledge, its shuffle's phase (bakePerch in murmur-gpu.js)
uniform vec2 uPerchD;      // 1 when the flock is down on ledges or wires; the shuffle's phase
uniform float uSag[8];     // how far each of those ledges hangs at the middle now (a loaded wire), tiles
uniform vec4 uSil;         // the eye (the birds' frame) and how far a bird against the sky goes to silhouette
// ⚠ A BIRD ABOVE YOU IS SEEN AGAINST THE SKY, AND THE SKY IS BRIGHTER THAN ANY LIT FEATHER. The vertex
// colours are the bird lit from outside, which is right from above (against the ground) and wrong from
// below, where a starling is a black cut-out: measured, the darkest bird in a dusk frame was luminance 42
// against a sky of 100-160. The share is the line of sight's climb, so the change is continuous at the
// eye's own height and a pilot looking down on a flock still sees it lit.
//
// ⚠ BUT ONLY WHEN THE SUN IS BEHIND IT. A flock with the sun at your back is lit, not cut out: every
// bird turns a sunlit face to you and the whole cloud reads warm brown against the sky. So the silhouette
// is scaled by how BACKLIT the bird is, and a front-lit bird gains the sun's light instead.
// uSun is the bearing toward the sun, sin(elevation) and a strength (0 is the flock as it shipped);
// uSunCol is the light's tint and gain.
uniform vec4 uSun;
uniform vec3 uSunCol;
// ⚠ THE RAMP IS THE HORIZON, NOT SIX DEGREES ABOVE IT. It ran to 0.10 (about 6°), so a distant flock —
// which sits a few degrees up — was half lit, in the warm sun-lifted colour, and read as pale olive birds
// dimmed by the cloud behind them; and because the ramp is one elevation, it drew a straight line across
// a flock where dark birds turned pale. Against the sky a bird is a silhouette; only below the horizon,
// against the ground, does it show its lit colour.
float silhouetteK(vec3 w) { vec3 d = w - uSil.xyz; float up = d.z / max(1e-4, length(d)); return uSil.w * smoothstep(-0.03, 0.015, up); }
float sunFront(vec3 w) {
  if (uSun.w <= 0.0) return 0.0;
  vec3 v = normalize(w - uSil.xyz);
  float ce = sqrt(max(0.0, 1.0 - uSun.z * uSun.z));
  vec3 L = vec3(uSun.xy * ce, uSun.z);
  return clamp(-dot(v, L) * 1.4 + 0.2, 0.0, 1.0) * smoothstep(-0.05, 0.08, uSun.z);
}
// the sun's light on the bird, with no silhouette: what an edge-on bird is lifted toward.
// k is how much of the sky's light the bird takes (Bird.sky): 1 in the air, 0 standing on the ground.
vec3 sunLit(vec3 w, float k) { return vec3(1.0) + uSunCol * (uSun.w * k * sunFront(w)); }
vec3 silhouette(vec3 w, float k) {
  float f = sunFront(w);
  return sunLit(w, k) * (1.0 - k * silhouetteK(w) * (1.0 - uSun.w * f * 0.85));
}
const int TW = 64;
ivec2 at(int i) { return ivec2(i % TW, i / TW); }
float sstep(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
int tierOf(float px) {
  if (px < uTierPx.x) return 4;
  if (px < uTierPx.y) return 3;
  int t = 0;
  if (uFarHi > 0.0 && px < uFarHi) t = 1;
  if (px < uTierPx.w) t = 2;
  if (px < uTierPx.z) t = 3;
  return t;
}
// Everything both programs need about one bird. ok = false collapses it.
struct Bird { bool ok; vec3 w; float a; float px; float heading; float roll; float beat; float h; float vz; float hv; float sky; };
Bird bird(int id, int wantTier) {
  Bird b; b.ok = false;
  ivec2 t = at(id);
  vec4 P = texelFetch(uPosT, t, 0), V = texelFetch(uVelT, t, 0);
  if (uLerp < 1.0) { P = mix(texelFetch(uPosP, t, 0), P, uLerp); V = mix(texelFetch(uVelP, t, 0), V, uLerp); }
  if (V.w <= 0.0) return b;
  vec3 w = vec3(P.xy - uOrigin, P.z);
  float f = (w.x - uCull.x) * uCull.z - (w.y - uCull.y) * uCull.w;
  // ⚠ THE NEAR TEST IS THE TRUE DISTANCE TO THE EYE, NOT THE LEVEL FORWARD DISTANCE. 'f' is measured along
  // the heading in the ground plane, so with the camera tipped up a bird straight overhead has an 'f' of
  // almost nothing and was culled — a straight line across the flock where starlings simply stopped,
  // worst looking straight up. The clip planes do the real near clipping; this only rejects a bird
  // actually at the lens. The far test stays on 'f', which is what the rest of the world is culled on.
  float fd = length(w - uSil.xyz);
  if (fd <= uCull2.y || f > uCull2.z) return b;
  float a = sstep((uCull2.z - f) / 5.0) * uCull2.w * V.w;
  if (a <= 0.03) return b;
  // ⚠ THE DEPTH cam.proj DIVIDES BY, NOT THE CLIP w. pushFauna sizes a bird as FL x span / pr.f, and
  // pr.f is the craft-forward distance plus the camera's own offset. The clip-space w of the GL matrix
  // is not that number, and using it sized birds differently from the CPU: measured, the GPU sent
  // birds at five tiles to mesh tiers the CPU drew as dots.
  // A bird off the axis (overhead, to the side under a tilted camera) is sized by its real distance, not
  // by a forward distance that goes to zero under it. Within an ordinary field of view f > 0.7 fd, so a
  // level view is sized exactly as before.
  float fe = max(f + uCull2.x, 0.7 * fd);
  float px = fe > 0.07 ? uFL * uSpan / fe : 0.0;
  int tier = clamp(fe > 0.07 ? tierOf(px) : 0, uTierClamp.x, uTierClamp.y);
  if (tier != wantTier) return b;
  float ag = 0.0;
  for (int k = 0; k < ${PULSE_MAX}; k++) {
    if (k >= uAgitN) break;
    float u = (distance(P.xy, uAgit[k].xy) - uAgit[k].z) / uWaveW;
    if (u >= -3.0 && u <= 3.0) ag += uAgit[k].w * exp(-u * u);
  }
  b.ok = true; b.w = w; b.a = a; b.px = px;
  b.h = P.z; b.vz = V.z; b.hv = length(V.xy);   // height off the ground and climb rate, before the walking bob: they pick the landing pose
  // ⚠ THE SKY'S LIGHT IS EACH BIRD'S, NOT THE FLOCK'S. A flock coming down or going up in waves is in ground
  // mode the whole time, and the silhouette and the sun were switched off for every bird in it, so the
  // hundreds still wheeling overhead went from a dark cloud to their pale lit colour for about 27 s at
  // each end of a flight. Only a bird near the ground gives them up.
  b.sky = uGround.x > 0.5 ? smoothstep(${ALOFT_H}, ${BRAKE_H}, P.z) : 1.0;
  b.heading = atan(V.y, V.x);
  b.roll = clamp((P.w + ag) * uBank.x, -uBank.y, uBank.y);
  b.beat = texelFetch(uStat0, t, 0).w;
  // ⚠ A LANDED BIRD STANDS LEVEL AND BOBS, the way pushFauna draws one: no bank, and a hop off the
  // ground that the flock's own settle scales down while it is still arriving (drawGooseGround).
  if (uGround.x > 0.5) {
    b.roll = 0.0;
    if (uPerchD.x > 0.5) {
      // ⚠ ON A LEDGE OR A WIRE A BIRD'S HEIGHT IS MEASURED FROM WHAT IT STANDS ON, NOT FROM THE GROUND. The
      // pose is chosen off that height (flying above ALOFT_H, braking below BRAKE_H), so measured from the
      // street every starling on a wire was drawn in flight. And a perched bird faces the way its perch
      // faces (across a wire, out from a parapet), turning a little, rather than the way it last moved:
      // standing still, its velocity points nowhere in particular.
      vec4 Q = texelFetch(uStat4, t, 0), Q2 = texelFetch(uStat5, t, 0);
      b.h = P.z - (Q.z - uSag[clamp(int(Q2.y + 0.5), 0, 7)] * (1.0 - Q.w * Q.w));
      float ph = Q2.x + sin(uPerchD.y + Q2.z * 6.2831853) * 0.22;
      float k = (1.0 - smoothstep(0.004, 0.03, b.hv)) * (1.0 - smoothstep(${ALOFT_H}, ${BRAKE_H}, b.h));
      vec2 hd = mix(vec2(cos(b.heading), sin(b.heading)), vec2(cos(ph), sin(ph)), k);
      b.heading = atan(hd.y, hd.x + 1e-6);
    } else b.w.z += abs(sin(uGround.y + texelFetch(uStat2, t, 0).w * 6.28)) * uGround.z;   // 6.28, as drawGooseGround has it
  }
  return b;
}
`;

const VERT_CLOUD = CLOUD_HEAD + `
layout(location = 0) in vec3 aColor;
uniform highp sampler2D uPose;
// a beat phase 0..1 to a pose: the two baked steps either side of it, blended
vec3 poseAt(float p) {
  float r = fract(p) * ${FAUNA_BEAT_STEPS}.0;
  int r0 = int(floor(r)), r1 = (r0 + 1) % ${FAUNA_BEAT_STEPS};
  return mix(texelFetch(uPose, ivec2(gl_VertexID, r0), 0).xyz, texelFetch(uPose, ivec2(gl_VertexID, r1), 0).xyz, fract(r));
}
uniform int uTier;
uniform int uPoseSel;      // 0 every bird; 1 only birds still in the air; 2 only birds on the ground
uniform vec3 uPitchK;      // the share of each bird's pitch that is its own; goosePitch's gain; its limit
uniform float uBeatBase;
uniform float uBeatAdv;    // how much of a wingbeat passes in one rendered frame (flapHz x frame time)
uniform vec2 uGlide;       // the burst-and-glide cycle's phase, and the share of it spent gliding
uniform int uWalkPose;     // 1: this group's ground bake is a walk cycle (16 stride rows + the peck)
uniform float uPitch;
uniform float uScale;
uniform vec2 uMinPx;       // faunaMinPx, faunaMinFade
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vColor; out float vFog; out float vAlpha;
void main() {
  Bird b = bird(gl_InstanceID, uTier);
  if (!b.ok) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); vFog = 0.0; return; }
  float scale = uScale, a = b.a;
  if (uMinPx.x > 0.0 && b.px > 0.0 && b.px < uMinPx.x) {
    float mag = uMinPx.x / b.px;
    scale *= mag; a *= 1.0 - uMinPx.y + uMinPx.y / mag;
  }
  // a walking pose has one row; only a wing beats
  // ⚠ A LANDING OR A TAKE-OFF IS TWO POSES AT ONCE. The flock comes down continuously from the cloud, so at
  // any moment some birds are standing and some are still dropping in, and the draw is split: pass 1 is the
  // flying mesh (flare and feet down) for the birds still in the air, pass 2 the walking mesh for the rest.
  // Each bird answers for itself off its own height, so there is no moment the whole flock swaps pose.
  bool aloft = b.h > ${ALOFT_H};
  if ((uPoseSel == 1 && !aloft) || (uPoseSel == 2 && aloft)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; vColor = vec3(0.0); vFog = 0.0; return; }
  bool landing = uGround.x > 0.5 && uPoseSel == 1;
  // ⚠ THE BEAT IS A PHASE, NOT A ROW: the wing is blended between the two baked steps either side of it, so
  // a slow flap (a landing, a bird near the eye) moves smoothly rather than in sixteen jumps. row < 0 beats.
  int row = uGround.x > 0.5 && !landing ? 0 : -1;
  float ph = fract(uBeatBase + b.beat), rate = 1.0, gw = 0.0;
  if (landing) {
    // climbing away: hard, quick beats. The last stretch before touchdown: braking beats. The descent
    // itself: wings held out (the glide row), with the odd flap, which is what a starling dropping into
    // a roost does. The climb rate is what the bird really moved, so each one chooses on its own.
    if (b.vz > ${CLIMB_VZ}) { ph = fract(uBeatBase * 1.5 + b.beat); rate = 1.5; }
    else if (b.h < ${BRAKE_H}) { ph = fract(uBeatBase * 1.3 + b.beat); rate = 1.3; }
    else { float w = fract(uGlide.x * 0.6 + b.beat * 3.7); gw = smoothstep(0.2, 0.3, w) * (1.0 - smoothstep(0.93, 1.0, w)); }
  }
  // ⚠ A GLIDE HOLDS THE WINGS OUT AT BEAT STEP 2, a slight dihedral above level, where beatDihedral puts a
  // wing a sixth of the way into the downstroke. Each bird's cycle is offset by its own beat offset, so
  // the flock never glides in unison.
  // ⚠ AND IT IS EASED, NEVER SNAPPED. Held as a switch, every bird jumped from wherever its wing was
  // mid-beat straight to the held pose and back — 1.4 times a second per bird, which across a flock
  // reads as a constant crackle. The weight ramps in over about a wingbeat as the bird sets its wings
  // and out as it starts beating again; the glide itself is the baked FAUNA_GLIDE_ROW, a shape of its
  // own (flat, hand swept back) rather than a flap frame frozen mid-stroke.
  if (uGround.x < 0.5 && uGlide.y > 0.0) {
    float g = fract(uGlide.x + b.beat * 3.7), e = 1.0 - uGlide.y;
    gw = smoothstep(e, e + 0.08, g) * (1.0 - smoothstep(0.94, 1.0, g));
  }
  // ⚠ A STANDING STARLING WALKS, IT DOES NOT SLIDE. With a walk bake the ground row is no longer one
  // frozen pose: the stride plays in proportion to how fast this bird is actually moving (a bird
  // standing still is the planted stance, row 0, and a wandering one strides), and a bird that has
  // stopped probes the ground on its own rhythm. Both phases are integer multiples of the bob's own
  // wrapped phase, so neither jumps when it wraps. Stateless, like everything else here: the stride
  // is timed rather than integrated from distance, so fast birds shuffle a little, which reads fine.
  bool walking = row == 0 && uWalkPose == 1;
  vec3 m;
  if (walking) {
    float mv = smoothstep(0.008, 0.035, b.hv);
    m = mix(texelFetch(uPose, ivec2(gl_VertexID, 0), 0).xyz, poseAt(fract(uGround.y / 6.2831853 * 3.0 + b.beat * 3.7)), mv);
    float pk = smoothstep(0.55, 0.95, sin(uGround.y * 2.0 + b.beat * 23.0)) * (1.0 - mv) * (1.0 - uPerchD.x);   // nothing to peck at on a wire
    if (pk > 0.0) m = mix(m, texelFetch(uPose, ivec2(gl_VertexID, ${FAUNA_PECK_ROW}), 0).xyz, pk);
  } else if (row >= 0) m = texelFetch(uPose, ivec2(gl_VertexID, row), 0).xyz;
  else {
    m = poseAt(ph);
    // ⚠ A FAST WING IS A BLUR, NOT A SHARP WING AT A RANDOM POINT OF ITS BEAT. A starling beats 13 times a
    // second, so a 60 fps frame samples under five points of each beat and the flock flickers. When much of
    // a beat passes in one frame the wing is averaged over the frame's exposure, and the vertices that
    // travel furthest over a beat (the wings, never the body) fade a little, which reads as a soft shimmer.
    float adv = uBeatAdv * rate;
    float blur = clamp((adv - ${WING_BLUR_FROM}) / ${WING_BLUR_SPAN}, 0.0, 1.0);
    if (blur > 0.0) {
      vec3 avg = (m + poseAt(ph - adv * 0.5) + poseAt(ph - adv)) / 3.0;
      m = mix(m, avg, blur);
      float travel = length(poseAt(0.25) - poseAt(0.75));
      a *= 1.0 - (1.0 - gw) * blur * ${WING_BLUR_FADE} * smoothstep(0.01, 0.06, travel);
    }
    if (gw > 0.0) m = mix(m, texelFetch(uPose, ivec2(gl_VertexID, ${FAUNA_GLIDE_ROW}), 0).xyz, gw);
  }
  m *= scale;
  // ⚠ EACH BIRD PITCHES ALONG ITS OWN PATH, by goosePitch's arithmetic on its own climb rate, rather than
  // the whole flock sharing the centre's. A bird dropping into the roost points down its descent and
  // noses up to brake in the last stretch; one lifting off points up. A standing bird is level.
  float pitch = uPitch;
  if (uPitchK.x > 0.0 && !(uGround.x > 0.5 && !landing)) {
    float own = clamp(atan(b.vz, max(b.hv, 1e-3)) * uPitchK.y, -uPitchK.z, uPitchK.z);
    if (landing && b.vz <= ${CLIMB_VZ} && b.h < ${BRAKE_H}) own = min(uPitchK.z * 1.6, own + 0.45);
    pitch = mix(uPitch, own, uPitchK.x);
  }
  float ch = cos(b.heading), sh = sin(b.heading), cp = cos(pitch), sp = sin(pitch), cr = cos(b.roll), sr = sin(b.roll);
  vec3 F = vec3(ch * cp, sh * cp, sp), S0 = vec3(-sh, ch, 0.0), U0 = vec3(-ch * sp, -sh * sp, cp);
  vec3 S = S0 * cr + U0 * sr, U = U0 * cr - S0 * sr;
  vec4 clip = uViewProj * vec4(b.w + F * m.x + S * m.y + U * m.z, 1.0);
  gl_Position = clip;
  vColor = aColor * silhouette(b.w, b.sky); vAlpha = a;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const VERT_DOT = CLOUD_HEAD + `
uniform vec2 uViewport;
uniform vec2 uAB;
uniform float uPull;
uniform float uDpr;
uniform float uFlash;
uniform vec3 uFlashK;      // floor, how much of the flash is the wing's angle to you, area share
uniform vec3 uFlashX;      // sharpness of the wing-to-eye response; colour lift of an edge-on bird; display bank gain
uniform vec2 uInk;         // smallest radius in device px, soft/hard ink gain
uniform vec3 uEye;         // the eye, in the same frame as the birds
out vec2 vCorner; out float vAlpha; out vec3 vSil; out float vDepthA;
const vec2 CORNERS[6] = vec2[6](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
void main() {
  Bird b = bird(gl_InstanceID, 4);
  vCorner = CORNERS[gl_VertexID];
  vSil = vec3(1.0);
  if (!b.ok) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  vSil = silhouette(b.w, b.sky);
  // ⚠ THE FLASH IS HOW MUCH WING THE BIRD SHOWS YOU: the wing plane's normal against the line of sight,
  // so a bird banked toward the eye shows its whole planform and one banked away shows its edge. That is
  // what a dark band is (Hemelrijk 2015), and seen from below a flock rolling through a sharp turn goes
  // LIGHTER, not darker (Costanzo 2021). A beating wing is never quite edge-on, which is the rest of it.
  float ch = cos(b.heading), sh = sin(b.heading);
  // ⚠ THE BANK IS EXAGGERATED FOR SHADING ONLY (uFlashX.z, 1 is the bird's real bank): a milling turn banks a
  // starling a few degrees, which moves how much wing it shows you by a few per cent and no band can be seen.
  // The flight is untouched; only the flash reads the larger angle.
  float sr0 = clamp(b.roll * max(1.0, uFlashX.z), -1.45, 1.45);
  vec3 N = vec3(0.0, 0.0, cos(sr0)) - vec3(-sh, ch, 0.0) * sin(sr0);
  vec3 los = b.w - uEye;
  float ll = length(los);
  float face = ll > 1e-5 ? abs(dot(N, los / ll)) : 1.0;
  // ⚠ SHARPENED ABOUT ITS MIDDLE (uFlashX.x, 0 is linear): a turn front read as a soft gradient across
  // the cloud; steepened, each bird is mostly wing or mostly edge and the front gets an edge of its own.
  face = clamp(0.5 + (face - 0.5) * (1.0 + uFlashX.x), 0.0, 1.0);
  float shown = (1.0 - uFlashK.y) * 0.35 + uFlashK.y * face;
  // ⚠ ALPHA ALONE CANNOT DIM A DENSE CORE: ten dots stacked on a pixel composite to near-opaque however
  // faint each one is, so the band vanished exactly where the flock is thickest. A saturated pixel IS the
  // bird's colour, so an edge-on bird's COLOUR is lifted toward its lit value too (uFlashX.y, 0 is off),
  // which survives stacking. Against the sky that is a lighter band, what a flock turning edge-on
  // overhead does (Costanzo 2021).
  if (uFlash > 0.0) vSil = mix(vSil, sunLit(b.w, b.sky), clamp(uFlash * uFlashX.y * smoothstep(0.45, 0.85, 1.0 - face), 0.0, 1.0));
  float dim = uFlash > 0.0 ? (1.0 - uFlash) + uFlash * (uFlashK.x + (1.0 - uFlashK.x) * shown) : 1.0;
  float area = uFlash > 0.0 ? 1.0 - uFlash * uFlashK.z + uFlash * uFlashK.z * (0.55 + 0.9 * shown) : 1.0;
  // ink conserved: drawn wide enough to reach a pixel centre, faint by the area it was given
  float rTrue = b.px * 0.30 * area;
  float R = max(rTrue, uInk.x / uDpr);
  vAlpha = b.a * dim * min(1.0, (rTrue * rTrue) / (R * R) * uInk.y);
  // ⚠ WHETHER A DOT HIDES THE CLOUD BEHIND IT IS DECIDED ON DISTANCE ALONE. vAlpha carries how much wing
  // the bird shows the eye and the flash, both of which change as the camera turns, so a prepass gated on
  // it wrote depth at one angle and not at the next — and the cloud deck popped in front of the flock and
  // back as you panned. This is the same ink with the angle terms left out.
  float r0 = b.px * 0.30, R0 = max(r0, uInk.x / uDpr);
  vDepthA = b.a * min(1.0, (r0 * r0) / (R0 * R0) * uInk.y);
  vec4 clip = uViewProj * vec4(b.w, 1.0);
  clip.xy += vCorner * (2.0 * R * uDpr / uViewport) * clip.w;
  float fp = max(0.02, clip.w - uPull);
  clip.z = (uAB.x + uAB.y / fp) * clip.w;
  gl_Position = clip;
}`;

const FRAG_DOT = `#version 300 es
precision highp float;
in vec2 vCorner; in float vAlpha; in vec3 vSil; in float vDepthA;
uniform vec3 uColor;
uniform int uDepthOnly;    // 1: the depth prepass — lay down the dot's core and draw nothing
out vec4 outColor;
void main() {
  float d = length(vCorner);
  if (d > 1.0 || vAlpha <= 0.002) discard;
  float a = vAlpha * pow(max(0.0, 1.0 - d), 1.8);   // sprites.js's soft profile
  // ⚠ ONLY WHAT IS MOSTLY THERE WRITES DEPTH. The soft rim and a faded dot stay out of the buffer,
  // or a bird that is a third there takes all of the cloud behind it and leaves a hole in the deck.
  if (uDepthOnly == 1 && vDepthA * pow(max(0.0, 1.0 - d), 1.8) < 0.2) discard;
  outColor = vec4(uColor * vSil * a, a);
}`;

// The shader's tierOf, in JavaScript, for tierSpan below. Keep the two in step.
function tierOfJS(px, T) {
  if (px < T.glyphPx) return 4;
  if (px < T.thr) return 3;
  let t = 0;
  if (T.farHi > 0 && px < T.farHi) t = 1;
  if (px < T.coarseHi) t = 2;
  if (px < T.glyphHi) t = 3;
  return t;
}

// ⚠ WHICH DETAIL LEVELS A CLOUD CAN REACH AT ALL, so the passes nobody can earn are not drawn. Each
// level is one instanced draw over EVERY bird in the cloud, and a bird not at that level is collapsed
// in the vertex shader — so at 20,000 birds a full-mesh pass is six million vertex invocations for a
// cloud that is a grey smudge three hundred metres off. The sphere murmur-gpu.js keeps round the flock
// bounds how near and how far any bird can be, and so the largest and smallest it can be on screen.
// Returns null when the whole sphere is behind the camera or past the far plane.
// ⚠ A BIRD OUTSIDE THE SPHERE IS CLAMPED, NEVER LOST: the shader clamps every bird's level into the
// range drawn here, so a straggler nearer than the bound is drawn one level coarser than it earned.
export function tierSpan(r, bound) {
  const all = { lo: 0, hi: 4, set: new Set([0, 1, 2, 3, 4]) };
  if (!bound || !r.tiers) return all;
  const wx = bound.x - r.origin[0] - r.camO[0], wy = bound.y - r.origin[1] - r.camO[1];
  const fe = wx * r.sc[0] - wy * r.sc[1] + r.fwdOff;
  const feMin = fe - bound.r, feMax = fe + bound.r;
  if (feMax <= r.nearF || feMin - r.fwdOff > r.farF) return null;
  const pxAt = (d) => (d > 0.07 ? r.FL * r.span / d : Infinity);
  const pxHi = pxAt(feMin), pxLo = pxAt(feMax);
  const T = r.tiers, set = new Set([tierOfJS(pxHi, T), tierOfJS(pxLo, T)]);
  for (const bp of [T.glyphPx, T.thr, T.farHi, T.coarseHi, T.glyphHi]) {
    if (!(bp > pxLo && bp <= pxHi)) continue;
    set.add(tierOfJS(bp, T));
    set.add(tierOfJS(bp * (1 - 1e-6), T));
  }
  return { lo: Math.min(...set), hi: Math.max(...set), set };
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' fauna shader: ' + log);
  }
  return sh;
}

export function createFaunaLayer(gl) {

  // ⚠ A UNIFORM IS SENT ONLY WHEN IT CHANGES. Every cloud in a frame shares the camera, the species' ladder, the scare and the ink, and they were being sent again for each cloud and each program. A program keeps its uniforms between draws, so
  // the last value sent to each location is remembered here and an identical one is not sent again.
  // Per location, and so per program, and this whole object is per context, so a lost context
  // starts with an empty memory.
  const sent = new Map();
  const fresh = (l, a, b, c, d) => {
    let v = sent.get(l);
    if (!v) { v = new Float64Array(4).fill(NaN); sent.set(l, v); }
    if (v[0] === a && v[1] === b && v[2] === c && v[3] === d) return false;
    v[0] = a; v[1] = b; v[2] = c; v[3] = d; return true;
  };
  const u1f = (l, a) => { if (l && fresh(l, a, 0, 0, 0)) gl.uniform1f(l, a); };
  const u1i = (l, a) => { if (l && fresh(l, a, 0, 0, 0)) gl.uniform1i(l, a); };
  const u2f = (l, a, b) => { if (l && fresh(l, a, b, 0, 0)) gl.uniform2f(l, a, b); };
  const u2i = (l, a, b) => { if (l && fresh(l, a, b, 0, 0)) gl.uniform2i(l, a, b); };
  const u3f = (l, a, b, c) => { if (l && fresh(l, a, b, c, 0)) gl.uniform3f(l, a, b, c); };
  const u4f = (l, a, b, c, d) => { if (l && fresh(l, a, b, c, d)) gl.uniform4f(l, a, b, c, d); };
  // Prewarmed with the context when it can be (programs.js); built here otherwise.
  let prog = takeWarm(gl, VERT, FRAG);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('fauna link: ' + gl.getProgramInfoLog(prog));
  const loc = {
    color: gl.getAttribLocation(prog, 'aColor'),
    pos: gl.getAttribLocation(prog, 'iPos'),
    ang: gl.getAttribLocation(prog, 'iAng'),
    alpha: gl.getAttribLocation(prog, 'iAlpha'),
    pose: gl.getUniformLocation(prog, 'uPose'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
  };
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;

  // group key -> { vao, stream, tex, verts, rows, n } ; null for a group that would not bake.
  // Bounded by the pose table (152 groups today), so it is never evicted.
  const groups = new Map();
  let data = new Float32Array(1 << 10);
  let live = [];          // the groups with instances this frame, in the order they are drawn
  let instances = 0, skipped = 0;

  function groupFor(kind, id, state, flare, gear, far, key) {
    if (groups.has(key)) return groups.get(key);
    const bake = faunaPoseBake(kind, id, state, flare, gear, far);
    if (!bake || bake.verts > maxTex) { groups.set(key, null); return null; }
    const vao = gl.createVertexArray();
    // The colours are per VERTEX and constant for the group, so they are uploaded once, here.
    const col = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, col);
    gl.bufferData(gl.ARRAY_BUFFER, bake.rgb, gl.STATIC_DRAW);
    if (loc.color >= 0) { gl.enableVertexAttribArray(loc.color); gl.vertexAttribPointer(loc.color, 3, gl.FLOAT, false, 12, 0); }
    gl.bindVertexArray(null);
    const stream = makeVertexStream(gl, vao, STRIDE, [[loc.pos, 4, 0], [loc.ang, 4, 16], [loc.alpha, 1, 32]], 576);   // 64 birds
    // ⚠ ONE ADVANCE PER INSTANCE, NOT PER VERTEX. The stream records the pointers into the VAO; the
    // divisor is VAO state too, so it is set once, here, with the VAO bound.
    gl.bindVertexArray(vao);
    for (const l of [loc.pos, loc.ang, loc.alpha]) if (l >= 0) gl.vertexAttribDivisor(l, 1);
    gl.bindVertexArray(null);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, bake.verts, bake.rows, 0, gl.RGBA, gl.FLOAT, bake.pos);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const g = { vao, stream, tex, col, verts: bake.verts, rows: bake.rows, n: 0, list: [], cloudVao: null };
    groups.set(key, g);
    return g;
  }

  /**
   * Take this frame's instance records. Each is { kind, sp, state, beat, flare, gear, far, x, y, z,
   * heading, pitch, roll, scale, a } — the arguments faunaWorldFaces would have been given.
   */
  function upload(recs) {
    for (const g of live) { g.n = 0; g.list.length = 0; }
    live = [];
    instances = 0; skipped = 0;
    if (!recs || !recs.length) return 0;
    for (const r of recs) {
      const slot = faunaPoseSlot(r.kind || 'bird', r.sp, r.state, r.beat, r.flare, r.gear, r.far);
      const g = groupFor(r.kind || 'bird', r.sp, r.state, r.flare, r.gear, r.far, slot.group);
      if (!g) { skipped++; continue; }
      if (!g.n) live.push(g);
      g.n++;
      g.list.push(r, slot.row);
    }
    for (const g of live) {
      const floats = g.n * STRIDE;
      if (data.length < g.n * STRIDE) data = new Float32Array(Math.max(floats, data.length * 2));
      let o = 0;
      for (let i = 0; i < g.list.length; i += 2) {
        const r = g.list[i], row = g.list[i + 1];
        data[o] = r.x; data[o + 1] = r.y; data[o + 2] = r.z; data[o + 3] = r.scale;
        data[o + 4] = r.heading || 0; data[o + 5] = r.pitch || 0; data[o + 6] = r.roll || 0; data[o + 7] = row;
        data[o + 8] = r.a == null ? 1 : r.a;
        o += STRIDE;
      }
      g.stream.write(data, floats);
      instances += g.n;
    }
    return instances;
  }

  function draw(cam, cssH, opts = {}) {
    if (!instances) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, viewProjMatrix(cam, cssH, opts.near, opts.far));
    const f = opts.fog;
    gl.uniform3f(loc.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(loc.fogNear, f ? f.near : 1e9);
    gl.uniform1f(loc.fogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(loc.fogAmt, f ? f.amt : 0);
    gl.uniform1i(loc.pose, UNIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let tris = 0;
    gl.activeTexture(gl.TEXTURE0 + UNIT);
    for (const g of live) {
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.bindVertexArray(g.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, g.verts, g.n);
      tris += (g.verts / 3) * g.n;
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return tris;
  }

  // ── the cloud programs, built on first use ──
  let cp = null;
  function cloudProgs() {
    if (cp) return cp;
    const link = (v, fr, label) => {
      let pr = takeWarm(gl, v, fr);
      if (!pr) {
        pr = gl.createProgram();
        gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, v, label + ' vertex'));
        gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, fr, label + ' fragment'));
        gl.linkProgram(pr);
      }
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(label + ' link: ' + gl.getProgramInfoLog(pr));
      const u = {};
      const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(pr, i).name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(pr, nm); }
      return { pr, u };
    };
    cp = { mesh: link(VERT_CLOUD, FRAG, 'cloud mesh'), dot: link(VERT_DOT, FRAG_DOT, 'cloud dot'), dotVao: gl.createVertexArray() };
    // ⚠ EACH SAMPLER'S UNIT IS SET ONCE, HERE. Sending it with every bind was four uniform calls per
    // cloud per program per frame, for a number that never changes.
    for (const P of [cp.mesh, cp.dot]) {
      gl.useProgram(P.pr);
      const set = (n, k) => { if (P.u[n] != null) gl.uniform1i(P.u[n], k); };
      set('uPosT', CLOUD_UNIT); set('uVelT', CLOUD_UNIT + 1); set('uStat0', CLOUD_UNIT + 2); set('uStat2', CLOUD_UNIT + 3); set('uPosP', CLOUD_UNIT + 4); set('uVelP', CLOUD_UNIT + 5); set('uPose', UNIT);
      set('uStat4', CLOUD_UNIT + 6); set('uStat5', CLOUD_UNIT + 7);
    }
    gl.useProgram(null);
    return cp;
  }
  function cloudVaoOf(g) {
    if (g.cloudVao) return g.cloudVao;
    g.cloudVao = gl.createVertexArray();
    gl.bindVertexArray(g.cloudVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.col);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    return g.cloudVao;
  }
  const agitBuf = new Float32Array(PULSE_MAX * 4);
  // the uniforms both cloud programs share, set per cloud
  function cloudCommon(u, r, st, vp, span) {
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    u2f(u.uOrigin, r.origin[0], r.origin[1]);
    u4f(u.uCull, r.camO[0], r.camO[1], r.sc[0], r.sc[1]);
    u4f(u.uCull2, r.fwdOff, r.nearF, r.farF, r.alphaMul);
    u1f(u.uFL, r.FL);
    u1f(u.uSpan, r.span);
    u4f(u.uTierPx, r.tiers.glyphPx, r.tiers.thr, r.tiers.glyphHi, r.tiers.coarseHi);
    u1f(u.uFarHi, r.tiers.farHi);
    const ag = r.agit || [];
    // the wave rides with the flock's measured offset from its shared centre, as the scare does (murmur-gpu.js)
    const ox = st.cent ? st.cent.x - r.cx : 0, oy = st.cent ? st.cent.y - r.cy : 0;
    for (let k = 0; k < PULSE_MAX; k++) agitBuf.set(k < ag.length ? [ag[k].x + ox, ag[k].y + oy, ag[k].front, ag[k].amp] : [0, 0, 0, 0], k * 4);
    gl.uniform4fv(u.uAgit, agitBuf);
    u1i(u.uAgitN, Math.min(PULSE_MAX, ag.length));
    u1f(u.uWaveW, r.waveW);
    u2f(u.uBank, r.bank[0], r.bank[1]);
    u2i(u.uTierClamp, span ? span.lo : 0, span ? span.hi : 4);
    const tex = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
    tex(CLOUD_UNIT, st.pos);
    tex(CLOUD_UNIT + 1, st.vel);
    tex(CLOUD_UNIT + 2, st.stat0);
    tex(CLOUD_UNIT + 3, st.stat2 || st.stat0);
    tex(CLOUD_UNIT + 4, st.prevPos || st.pos);
    tex(CLOUD_UNIT + 5, st.prevVel || st.vel);
    u1f(u.uLerp, st.lerp ?? 1);
    const G = r.ground || r.hold;
    u3f(u.uGround, G ? 1 : 0, G ? G.bob[0] : 0, G ? G.bob[1] : 0);
    // a flock on ledges or wires (bakePerch in murmur-gpu.js): its spots, and how far each wire hangs now
    const Pp = G && G.perch;
    tex(CLOUD_UNIT + 6, (Pp && st.stat4) || st.stat0);
    tex(CLOUD_UNIT + 7, (Pp && st.stat5) || st.stat0);
    u2f(u.uPerchD, Pp ? 1 : 0, Pp ? Pp.wob : 0);
    if (u.uSag) gl.uniform1fv(u.uSag, Pp ? Pp.sag : NO_SAG);
    // the silhouette and the sun go to every cloud; a bird standing on the ground drops them itself (Bird.sky)
    u4f(u.uSil, r.eye[0], r.eye[1], r.eye[2], r.sil || 0);
    u4f(u.uSun, (r.sun && r.sun[0]) || 0, (r.sun && r.sun[1]) || 0, (r.sun && r.sun[2]) || 0, (r.sun && r.sun[3]) || 0);
    u3f(u.uSunCol, (r.sunCol && r.sunCol[0]) || 0, (r.sunCol && r.sunCol[1]) || 0, (r.sunCol && r.sunCol[2]) || 0);
  }

  /**
   * Draw this frame's murmurations. `list` is [{ rec, st }] — the record windshield.js pushed and the
   * GPU flock's textures for it. Meshes first (they write depth, like solids), then the dots (tested,
   * writing none, like sprites).
   */
  function drawClouds(cam, cssH, W, H, opts, list) {
    if (!list || !list.length) return 0;
    const P = cloudProgs();
    const vp = viewProjMatrix(cam, cssH, opts.near, opts.far);
    const f = opts.fog;
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let drawn = 0;
    // which levels each cloud can reach, worked out once for both programs
    const spans = list.map(({ rec, st }) => tierSpan(rec, st.bound));
    // meshes
    gl.useProgram(P.mesh.pr);
    gl.depthMask(true);
    const um = P.mesh.u;
    u3f(um.uFog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    u1f(um.uFogNear, f ? f.near : 1e9);
    u1f(um.uFogFar, f ? f.far : 1e9 + 1);
    // ⚠ NO FOG ON A MURMURATION. Faded toward the fog colour by distance, a flock in front of cloud went the
    // grey of the cloud behind it and disappeared into it; a starling cloud reads as dark against the sky at
    // any range it is drawn at, so it keeps its own colour.
    u1f(um.uFogAmt, 0);
    for (let ci = 0; ci < list.length; ci++) {
      const { rec: r, st } = list[ci], span = spans[ci];
      if (!span) continue;
      cloudCommon(um, r, st, vp, span);
      u1f(um.uBeatBase, r.beatBase);
      u1f(um.uBeatAdv, r.beatAdv ?? 0);
      u2f(um.uGlide, r.glide ? r.glide[0] : 0, r.glide ? r.glide[1] : 0);
      u1f(um.uPitch, r.pitch);
      u3f(um.uPitchK, r.pitchK ? r.pitchK[0] : 0, r.pitchK ? r.pitchK[1] : 0, r.pitchK ? r.pitchK[2] : 0);
      u1f(um.uScale, r.scale);
      u2f(um.uMinPx, r.minPx[0], r.minPx[1]);
      for (const tier of [0, 1, 2, 3]) {
        if (!span.set.has(tier)) continue;
        if (tier === 1 && !(r.tiers.farHi > 0)) continue;
        // In the air, one pass. On the ground, two when the landing pose is on: the flying mesh (flare and
        // feet down) for birds still dropping in or lifting off, the walking mesh for the ones standing.
        // With it off, a landed flock walks throughout, as it did.
        // (and a flock lifting off in waves, r.hold, is half on the ground too, so it takes both passes)
        const Gp = r.ground || r.hold;
        const passes = !Gp ? [['air', r.flare, r.gear, 0]]
          : r.landPose ? [['air', 1, 1, 1], [Gp.state, 0, 0, 2]] : [[Gp.state, 0, 0, 0]];
        u1i(um.uTier, tier);
        for (const [pose, fl, ge, sel] of passes) {
          const slot = faunaPoseSlot('bird', r.sp, pose, 0, fl, ge, tier);
          const g = groupFor('bird', r.sp, pose, fl, ge, tier, slot.group);
          if (!g) continue;
          u1i(um.uPoseSel, sel);
          u1i(um.uWalkPose, pose === 'walk' && g.rows > 1 ? 1 : 0);
          gl.activeTexture(gl.TEXTURE0 + UNIT);
          gl.bindTexture(gl.TEXTURE_2D, g.tex);
          gl.bindVertexArray(cloudVaoOf(g));
          gl.drawArraysInstanced(gl.TRIANGLES, 0, g.verts, st.n);
          drawn++;
        }
      }
    }
    // dots
    // ⚠ A DOT WROTE NO DEPTH, AND THE CLOUD DECK DRAWS AFTER THIS PASS AND TESTS AGAINST DEPTH — so
    // every distant starling was painted over by any cloud card in the same part of the frame,
    // whether the cloud was in front of it or behind. The meshes already write depth; the dots now
    // get a depth-only prepass (the same fix billboards.js got for the geese, under the same flag),
    // and the colour pass is the one that always shipped. LEQUAL, or the colour pass fails its own
    // prepass and the dot is not drawn at all.
    gl.useProgram(P.dot.pr);
    gl.depthFunc(gl.LEQUAL);
    const ud = P.dot.u;
    const zr = zRow((cam && cam.near) || NEAR);
    u2f(ud.uViewport, W, H);
    u2f(ud.uAB, zr[0], zr[1]);
    u1f(ud.uPull, LIGHT_PULL);
    gl.bindVertexArray(P.dotVao);
    for (let ci = 0; ci < list.length; ci++) {
      const { rec: r, st } = list[ci], span = spans[ci];
      if (!span || !span.set.has(4)) continue;
      cloudCommon(ud, r, st, vp, span);
      u1f(ud.uDpr, r.dpr);
      u1f(ud.uFlash, r.flash);
      u3f(ud.uFlashK, r.flashK[0], r.flashK[1], r.flashK[2]);
      u3f(ud.uFlashX, (r.flashX && r.flashX[0]) || 0, (r.flashX && r.flashX[1]) || 0, (r.flashX && r.flashX[2]) || 1);
      u3f(ud.uEye, r.eye[0], r.eye[1], r.eye[2]);
      u2f(ud.uInk, r.ink[0], r.ink[1]);
      u3f(ud.uColor, r.dot[0] / 255, r.dot[1] / 255, r.dot[2] / 255);
      if (r.airDepth) {
        u1i(ud.uDepthOnly, 1);
        gl.colorMask(false, false, false, false); gl.depthMask(true);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, st.n);
        gl.colorMask(true, true, true, true);
      }
      u1i(ud.uDepthOnly, 0);
      gl.depthMask(false);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, st.n);
      drawn++;
    }
    gl.depthMask(true);
    gl.bindVertexArray(null);
    for (const k of [UNIT, CLOUD_UNIT, CLOUD_UNIT + 1, CLOUD_UNIT + 2, CLOUD_UNIT + 3, CLOUD_UNIT + 6, CLOUD_UNIT + 7]) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.activeTexture(gl.TEXTURE0);
    return drawn;
  }

  return {
    upload, draw, drawClouds,
    get instances() { return instances; },
    get skipped() { return skipped; },
    get groups() { return groups.size; },
  };
}

declareProgram(VERT, FRAG);
declareProgram(VERT_CLOUD, FRAG);
declareProgram(VERT_DOT, FRAG_DOT);
