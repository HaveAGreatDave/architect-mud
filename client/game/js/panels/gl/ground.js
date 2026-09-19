// THE ROAD SURFACE, AS GEOMETRY — AND EVERYTHING ELSE THAT IS A COLOURED POLYGON.
//
// It began as the road and it is no longer only the road: the headlight pool rides here as an
// additive range, building shadows as a translucent one, and a CLIFF MASSIF as ordinary depth-
// writing geometry. Nothing about this layer was ever specific to z = 0 — it takes a polygon, a
// colour and an alpha, which is what all four of those are. A massif could not go in the mesh
// (that is captured once and a cliff is coloured per frame off the sun, the night and a world
// noise) and could not go behind an occlusion probe (it spreads about 1.8 tiles either side of
// its own tile, so any box wide enough to hold it reaches into the gaps between buildings), so
// it comes here instead, where a stream is the honest shape and the depth buffer does the rest.
//
// Measured with scripts/shapes/armcost.mjs: once GLASS 2 owns the city's mass, 97% of the canvas
// calls a frame still makes are path construction, and the single biggest producer is the ground —
// 'stripeA', the helper behind every road surface, pavement, lane line and dash, at roughly 12,000
// calls a frame on a 33x33 window. Buildings, by then, account for almost none of it: the same
// window with every building deleted costs MORE, because you can see more road.
//
// So this is what is left of GLASS 1 in the world pass, and it is all flat quads at z=0 with a
// solid colour. There is nothing in it a GPU is not better at.
//
// ⚠ DEPTH-WRITE ON, unlike every other layer here. The lights, the Curtain, the signage and the
// scatter are all things you see THROUGH or things that sit ON a surface, so they test depth and
// write none. The road IS a surface — a building standing on it must be able to hide the road
// behind it, and the road must hide what is under it.
//
// ⚠ AND IT UPLOADS EVERY FRAME, DELIBERATELY. The mass buffer is cached on the map window and
// three separate bugs were needed to make that safe (an order-sensitive key, a camera-relative
// mesh position, and a set taken from camera-culled items). These quads are produced by a pass
// that culls per tile against the near plane and the far limit, so the set genuinely changes as
// you move inside a single tile — feeding that to a cached buffer would reintroduce all three
// failures at once. A stream is the honest shape for it; make it cacheable by moving the culls
// first, not by pretending they are not there.
import { viewProjMatrix } from './camera.js';
import { HEIGHT_FOG_GLSL, LIGHT_SHAFT_GLSL } from './fog.js';

// pos3, colour3
const STRIDE = 10;  // pos3, colour3, alpha1, road1, lat1, kerb1
// ⚠ THE SAME SIX AS THE SHADER'S OWN MAX_WET, AND THEY HAVE TO AGREE. The GLSL one is inside a
// template literal and cannot be read from here, so this is the second copy — the shader would
// accept a longer array and silently ignore the tail, which is a reflection that is there on one
// machine and missing on another. Kept adjacent so a change to one is a visible diff on both.
const MAX_WET = 6;
// ⚠ THE SAME FORTY AS THE SHADER'S OWN MAX_TRACK, AND THEY HAVE TO AGREE — the rule MAX_WET above
// states for the same reason. The GLSL one is inside a template literal and cannot be read from
// here, so this is the second copy, kept adjacent so a change to one is a visible diff on both.
const MAX_TRACK_PTS = 40;
const WET_P = new Float32Array(MAX_WET * 3);
const WET_C = new Float32Array(MAX_WET * 3);
const WET_R = new Float32Array(MAX_WET);
const EMPTY_WET = [];

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aColor;
in float aAlpha;
in float aRoad;          // 1 on the carriageway, 0 on an apron, a forecourt or a verge
// ── WHERE THIS POINT SITS ACROSS THE CARRIAGEWAY ──────────────────────────────────────────────
//
// A road is not a flat plane with water thrown at it. It is built with a CROWN and a crossfall of
// about two and a half per cent either side, precisely so that water does NOT stand on it: the
// camber delivers everything to the channel against the kerb, and the channel carries it to a
// gully. So where water is actually found on a road is not a random question. It is the gutter
// line, the wheel ruts traffic has worn into the travelled way, and whatever sags between one
// gully and the next.
//
// 'aLat' is tiles from the crown, signed. 'aKerb' is where the kerb is, in the same units. Both
// are LINEAR in position along a straight carriageway, so interpolating them across a quad is
// exact rather than an approximation.
//
// ⚠ 'aKerb' 0 MEANS THERE IS NO CROSS-SECTION HERE, and that is an answer rather than missing
// data: a junction is where two crossfalls meet and neither wins, which is exactly why
// intersections are the classic ponding location. An apron, a forecourt and a depot hardstand
// have no camber to speak of either. All of them fall back to the isotropic field, which is the
// right shape for a surface with no drainage direction.
in float aLat;
in float aKerb;
uniform mat4 uViewProj;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
uniform float uHazeNear;
uniform float uHazeFar;
out vec3 vColor;
out float vFog;
out float vAlpha;
out float vRoad;
out float vLat;
out float vKerb;
out vec3 vWorld;   // the quad's own map-window position, for the wet reflections in the fragment shader
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  gl_Position = clip;
  vColor = aColor;
  vWorld = aPos;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
  // The far dissolve is the WINDOW's, exactly as the mass uses it — a truck asks for 15 tiles and
  // an aeroplane for 34, and the road has to end where the buildings do or it draws a hard diagonal
  // across the haze that nothing else in the frame agrees with.
  // ⚠ THE FADE IS THE 2-D PASS’S OWN, HANDED OVER — not re-derived here. drawGroundSurfaces
  // fades every tile by clamp((FAR - f) / 6) on top of worldBlend, and a shader that invented its
  // own curve would disagree with the road the cab is actually driving on. The haze uniforms stay
  // for a caller that has no alpha to give.
  vRoad = aRoad;
  vLat = aLat;
  vKerb = aKerb;
  vAlpha = aAlpha * (uHazeFar > uHazeNear ? 1.0 - smoothstep(uHazeNear, uHazeFar, clip.w) : 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFog;
in float vAlpha;
in float vRoad;
in float vLat;
in float vKerb;
in vec3 vWorld;
uniform vec3 uFog;
// ── THE SKY THE WATER IS LOOKING AT, AT BOTH ENDS ──────────────────────────────────────────────
//
// The reflection buffer holds the CITY and nothing else, so a puddle with no building over it
// falls back to a sky colour — and for a long time that colour was 'uFog' alone, one flat value.
// It is the right answer at a GRAZING angle and the wrong one straight down, which is most of the
// road: look steeply into water at your feet and what is above it is the ZENITH, several times
// deeper in blue at noon than the haze on the skyline. Flat, it reads as a tint somebody added
// rather than as water — the same complaint, and the same cause, as the environment term in the
// mass shader being taken off the normal instead of off the reflected ray.
//
// ⚠ BOTH ENDS ARE PASSED, RATHER THAN THE TOP ALONE OVER 'uFog'. The horizon end and the fog band
// happen to be the same colour today ('FOG_STATE' is 'sky.hor' dimmed for night), but only while
// the fog slider is up: at 'RENDER_TUNE.fog' 0 there is no band at all and 'uFog' falls back to a
// neutral grey, which would leave the gradient running from grey to a real sky. A look that
// changes when somebody moves the fog slider is the coupling worth spending a uniform to avoid.
uniform vec3 uSkyHor;
uniform vec3 uSkyTop;
// ── …AND THE SKY ITSELF, WHEN THERE IS ONE ─────────────────────────────────────────────────────
//
// The two colours above are the ends of a gradient, and a gradient is not what a puddle shows.
// This is the frame's OWN painted sky band — gradient, sun or moon, stars, the dome cloud, the
// distant ridge, the skyline — downscaled to a strip by windshield.js before the world pass runs.
// Sampled at this pixel's own column and at the row for the elevation the reflected ray leaves at,
// which is the same 'cosI · 0.86' the two-stop mix was already using. See the ⚠ at the capture.
uniform sampler2D uSky;
uniform float uSkyOn;

// ── WET TARMAC ─────────────────────────────────────────────────────────────────────────────────
//
// The city's own lights, lying on the road after rain — the one element every reference board for
// this work has in common. THIS pass and not the floor shader, for a reason worth keeping:
// GROUND_FULL draws every road and pavement tile as an opaque quad ON TOP of the floor, so a
// reflection put in the floor is painted over by exactly the surface it belongs on. Measured while
// finding that out: the floor owns 55.6% of a frame over bare ground and 17.9% over a paved street.
//
// ⚠ AND THE FRAME IS FREE HERE. These quads are recorded at their MAP-WINDOW tile, which is the
// same frame pickLights already shifts its lights into for the wall wash, so the positions go in
// untouched. In the floor shader that would have been a third frame and a conversion nothing could
// verify by reading.
//
// ⚠ THERE IS NO PAVED TEST, AND NONE IS NEEDED. Only road and pavement tiles emit ground quads at
// all — a frame over bare grass has zero of them — so the surface this draws on is already the
// surface it belongs on.
const int MAX_WET = 6;
// The nominal width of a lane, in tiles — the same figure the marking pass lays its lane lines on.
// Used to round a carriageway's half-width to a whole number of lanes, so the wheel tracks land
// where the lanes are. Shared with nothing, because the marking pass is in another file and
// another language; if that pitch ever changes, this is the number to change with it.
const float LANE_W = 0.5;uniform int   uNWet;
uniform vec3  uWetP[MAX_WET];   // light ground point xy + its height
uniform vec3  uWetC[MAX_WET];   // colour, 0-1
uniform float uWetR[MAX_WET];   // reach in tiles
uniform float uWet;             // how wet the ground is, 0-1
// ── SNOW LYING ON THE STREET ───────────────────────────────────────────────────────────────────
//
// How deep it lies, 0-1 — see 'SNOW_NOW' in windshield.js. THIS pass and not the floor shader, for
// the reason stated at the top of the wet-tarmac block above and measured there: GROUND_FULL draws
// every road and pavement tile as an opaque quad ON TOP of the floor, so a city's snow painted into
// the floor is covered by exactly the surface it belongs on.
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
uniform float uPudScale;        // the puddle field's frequency — bigger is smaller and more of them
// ── ⚠ HOW MUCH WATER IS STANDING, WHICH IS NOT HOW WET THE ROAD IS ───────────────────────────
//
// 'uWet' is the FILM: tarmac is wet within a second of rain starting, and that is what darkens it
// and makes it mirror. Standing water is a different quantity on a different clock — it is the
// integral of what has fallen minus what has drained, so it builds over minutes of sustained rain
// and takes minutes to go after it stops. Driving the puddle LEVEL off 'uWet' meant a downpour
// arrived with its puddles already full, four seconds in, and they never grew again.
//
// Splitting them is what makes a storm have a shape: the road goes dark and reflective at once,
// then the gutters start to hold, then the ruts, then the hollows between them join up.
uniform float uPond;
// How much of the puddle field is the ROAD'S OWN CROSS-SECTION rather than isotropic noise.
// 0 is the field that shipped, exactly — see the mix below.
uniform float uPudRoad;
uniform vec2  uEye;             // the camera's ground point, in vWorld's frame
uniform float uEyeH;            // and how high it is — see the Fresnel gate on the reflections
// The air at street level — see gl/fog.js. Every fragment this shader draws is ON the ground, so
// this is the degenerate case of the same integral: the eye height and the distance decide it.
uniform float uFogH;
uniform float uFogHScale;
// See gl/fog.js. 0 in clear weather by arithmetic, so the loop at the end of main is not a code
// path on a bright afternoon.
uniform float uScatter;
uniform vec2  uWc;             // window centre in WORLD tiles, so a puddle stays on its bit of road
// ⚠ IS THIS FRAGMENT A SURFACE, OR LIGHT LYING ON ONE? The three ranges below share this shader
// and they are not the same kind of thing: the base is the road, the additive range is a
// HEADLIGHT POOL. Everything past the fog line describes what water does to a SURFACE, and
// running it over a pool of light is three separate wrongs at once — the beam is darkened for
// being wet, it is REPLACED by the reflected city inside a puddle (and under ONE/ONE that adds
// the reflection a SECOND time on top of the road own), and it collects a sodium streak of its
// own. Stacked on a warm additive quad that had never been visible in GL mode until the mesh
// push put it there, that is the flat yellow sheet the near road turned into, pulsing with the
// lamp flicker.
uniform float uSurface;         // 1 for the road itself, 0 for the light lying on it
// ── AND THE IMAGE IN THE STANDING WATER ────────────────────────────────────────────────────────
//
// The city, rendered a second time through a camera that reflects the world about this plane — see
// gl/mirror.js. Read back at the fragment's own screen position, which is exact for a flat mirror
// and needs no ray march: the mirrored camera puts a reflected point on the same pixel the
// reflection belongs on.
//
// ⚠ AND IT IS READ IN THE CANVAS'S PIXELS, NOT THE BUFFER'S. gl_FragCoord is in the pixels of the
// framebuffer being drawn into, the reflection is rendered at a fraction of that size, and dividing
// by the smaller one slides the whole reflected city up and to the right by the difference.
uniform sampler2D uRefl;
uniform float uReflOn;
uniform float uReflGain;
uniform vec2  uReflVP;
uniform float uTime;            // seconds, the frame's own clock — see the ripple below
uniform float uRipple;          // how far the water bends what it reflects, in PIXELS of the canvas
uniform float uGlint;           // how hard a light lands IN the water rather than on the tarmac beside it
// ── HOW MUCH DARKER STANDING WATER IS THAN THE ROAD IT LIES ON ─────────────────────────────────
//
// Reported as reflections that are there and *dim*, and it is a CONTRAST problem rather than a
// strength one. At 'glMirror' 32 the water already blends at exactly the Fresnel value, so there
// is nothing left to turn up: a cab looking a metre ahead reflects 24% because that is what water
// does at 75 degrees. What decides whether you can SEE that 24% is what the other 76% is.
//
// Measured on a wet city street, on the water pixels alone: dry road 58, wet road 42, and the
// image worth 4.6 of 255 on top of it. Real wet asphalt is about a twentieth as bright as the sky
// it reflects; this road was a fifth. So the image was correct and it was lying on a grey card.
//
// 0.45 is the road that shipped, which is what makes this the revert. It is a LOOK decision, so it
// is a slider rather than a constant — the same rule the puddle scale is under.
uniform float uWetDark;

out vec4 outColor;

// ── HOW A WATER SURFACE BREAKS A REFLECTION UP ─────────────────────────────────────────────────
//
// Standing water is never still — there is rain landing on it, wind across it, or a truck going
// past — so a light reflected in it arrives as a shifting scatter of highlights rather than as an
// even lift. This is that scatter, as a 0..1 field.
//
// ⚠ WORLD-PHASED, NOT SCREEN-PHASED — the same rule the ripple and the puddle field itself follow.
// Driven off the screen it swims across the road as the camera turns, which reads as a dirty lens;
// driven off the world, a pool twinkles in place while you drive past it.
//
// ⚠ AND IT IS CUBED, WHICH IS WHAT MAKES IT GLINTS RATHER THAN A WOBBLE. The sum of two wave
// products is a smooth field between -2 and 2; raising its positive half to a power keeps the
// crests and throws the rest away, so what survives is a sparse scatter of bright points instead
// of a rolling brightness.
//
// ⚠ ONE FIELD, TWO READERS. The headlight pool and the road surface underneath it are two ranges
// of this same shader, drawn in two draw calls, and they are looking at the SAME water. Written
// out twice they would drift, and a pool twinkling out of step with the surface it lies on reads
// as two effects rather than as one wet road.
float waterSparkle(vec2 w) {
  vec2 gq = w * 9.0;
  float gw = sin(gq.x * 2.3 + uTime * 1.9) * sin(gq.y * 2.9 - uTime * 1.4)
           + sin(gq.x * 5.1 - uTime * 2.6) * sin(gq.y * 4.3 + uTime * 2.2);
  float gp = max(0.0, gw) * 0.5;
  return gp * gp * gp;
}

${HEIGHT_FOG_GLSL}
${LIGHT_SHAFT_GLSL}
void main() {
  if (vAlpha <= 0.002) discard;
  // ⚠ FOLDED IN BEFORE THE MIX, never painted over the result. Everything below reads c as the road
  // surface — the wetness, the standing water, the reflections, the snow — so a fog laid on
  // afterwards would have the neon reflecting in a road that has already receded into the haze.
  // ⚠ AND COMBINED AS TRANSMITTANCE: two fogs are two things the light has to get through.
  float gfog = 1.0 - (1.0 - vFog) * (1.0 - heightFog(uEyeH, 0.0, length(vWorld.xy - uEye), uFogH, uFogHScale));
  vec3 c = mix(vColor, uFog, gfog);
  // ⚠ AFTER THE FOG, because the fog is already folded into c above: a road that has receded into
  // the horizon has nothing left to reflect in, and adding light to it would put a streak on top of
  // the haze. The term's own distance falloff does the rest.
  // ── WET TARMAC IS DARKER, WHATEVER TIME IT IS ────────────────────────────────────────────────
  //
  // ⚠ THE WETNESS AND THE REFLECTIONS ARE TWO TERMS, AND CONFLATING THEM MADE THE ROAD DRY EVERY
  // AFTERNOON. Reported from the game as "I can't see the wetness" in an extreme deluge — at 15:07.
  // The reflections are made of the city's lights and pickLights used to return null in daylight,
  // so there was no list, uNWet was 0, and the WETNESS was skipped along with the reflections by
  // two separate gates, one layer apart, both reading "no lights means no wetness".
  //
  // The wetness needs no lights at all: water fills the surface
  // pores, less light scatters back, and tarmac goes darker and a little cooler. That is most of
  // what reads as "it has been raining" in daylight, and at night it is what the neon streaks are
  // drawn ON — a dark road makes them brighter without adding a candela.
  // ── AND IT GATHERS IN PUDDLES ────────────────────────────────────────────────────────────────
  //
  // Uniform wetness reads as a tint over the whole road. What the reference boards actually show is
  // PATCHES — standing water in the hollows with drier tarmac between, and the neon caught in the
  // patches rather than smeared evenly down the street. It is also the cheapest possible upgrade,
  // because the world position is already here for the reflections.
  //
  // ⚠ THE FIELD IS ABSOLUTE WORLD, NOT SCREEN OR WINDOW. A puddle is a place, so it has to stay on
  // its bit of road as the window recentres and as the camera moves — the same rule the coast warp
  // in floor.js follows for the same reason. vWorld is map-window tiles and the window centre is
  // folded in below.
  //
  // ⚠ AND THEY ONLY DEEPEN AS IT RAINS. 'uWet' raises the water LEVEL rather than the opacity, so
  // early in a shower a few hollows darken, and in a sustained downpour the patches spread and join.
  // That is the behaviour the wetness curve was built for and it was going to waste on a flat tint.
  //
  // ⚠ AND THE LEVEL MUST NOT REACH THE KERBS, WHICH IS WHERE THE FIRST CUT PUT IT. Measured over a
  // 24x24-tile patch of road with the field labelled into connected components: at a full-wetness
  // level of -0.35 the puddles JOIN into one sheet covering 69% of the road — ONE patch over the
  // whole area, which is the flat tint this term exists to replace, arrived at by a longer route.
  // The level floor decides the picture and it was swept: 0.05 gives 31% cover in ~90 separate
  // patches, median 0.63 tiles across with the odd 3-tile one in a low spot, and 0.3% in a light
  // shower. That is a street with puddles in it rather than a flooded street.
  // ── SNOW, AND WHAT A CITY DOES TO IT ─────────────────────────────────────────────────────────
  //
  // ⚠ THE CARRIAGEWAY IS CLEARED AND THE FOOTWAY IS NOT, and that one fact is most of what makes a
  // snowed-on street read as a street rather than as a white rectangle. Traffic and ploughs keep the
  // travelled way black; the snow goes to the kerb in a bank and stays on the pavement for days.
  //
  // ⚠ AND IT IS THE DRAINAGE MODEL'S OWN CROSS-SECTION, READ THE OTHER WAY UP. The puddle field
  // below derives three terms from one variable — the distance across the carriageway — and asks
  // where water COLLECTS: the gutter, the wheel ruts, the sag between gullies. Snow answers the
  // opposite question over the identical geometry, because the thing that makes a rut hold water is
  // the thing that scours it clear of snow: it is where the wheels go. So the wheel tracks are the
  // BARE part and the kerb line is the DEEP part, and neither needed a new variable, a new
  // attribute or a new authored field — 'vLat' and 'vKerb' have carried both answers all along.
  //
  // ⚠ 'vKerb' 0 MEANS NO CROSS-SECTION, AND THAT IS NOT THE SAME QUESTION SNOW IS ASKING. For the
  // water it is one answer — a junction, an apron, a forecourt and a depot hardstand all have no
  // camber, so all four fall back to the isotropic field. For snow they split, and the axis is
  // 'vRoad' rather than 'vKerb': a junction is CARRIAGEWAY, and it is the most heavily trafficked
  // carriageway on the street, whereas a yard is not trafficked at all. Read off the kerb alone,
  // every crossroads in the city held a full cover while the streets feeding it were ploughed
  // black — which is what it looked like on Marrow Street: a white band lying across the road at
  // exactly the two tiles the snapshot calls nsw and nes, six and seven tiles ahead.
  //
  // So a junction takes the general clearing with none of the structure (there is no single gutter
  // line where four channels meet, and no one wheel path), and only a surface that is not
  // carriageway at all takes the even cover.
  float snowW = 0.0;
  if (uSnow > 0.001) {
    // Off the carriageway — pavement, verge, apron — snow simply lies, broken only by the drift
    // field so an edge is ragged rather than ruled.
    float keep = 1.0;
    // A junction: trafficked from every direction, so it is cleared, but there is no cross-section
    // to hang ruts or a gutter bank on.
    if (vRoad > 0.5 && vKerb <= 0.001) keep = 0.45;
    if (vRoad > 0.5 && vKerb > 0.001) {
      float a = abs(vLat) / vKerb;                        // 0 at the crown, 1 at the kerb
      float onRoad = 1.0 - smoothstep(0.98, 1.22, a);
      // The same lane derivation the ruts use, so the tracks land in the same place in a one-tile
      // street and a four-lane artery alike. ⚠ Shared by reading it the same way rather than by
      // being written out twice: tracks that did not line up with the puddles would read as two
      // different roads under one surface.
      float lanes = max(1.0, floor(vKerb / LANE_W + 0.5));
      float phase = fract(a * lanes);
      float rut = exp(-pow((phase - 0.30) * 6.0, 2.0)) + exp(-pow((phase - 0.70) * 6.0, 2.0));
      // ⚠ THE RUTS DO THE SCOURING AND A FLAT TERM MUST NOT HELP THEM. This was
      // 'clamp(rut * 0.85 + 0.30)', and the constant is what wrecked it: 'rut' is a pair of
      // Gaussians that only falls to ~0.04 at a lane EDGE and sits at ~0.47 half way between the
      // two tracks, so adding 0.30 under it left the whole travelled way between 0.00 and 0.30 of a
      // cover. Measured on the street at a depth of 0.55 that is a road with no snow on it at all,
      // which is not a ploughed road, it is a road in July.
      //
      // What a street in snow actually looks like is two dark wheel tracks with white between them
      // and white at the lane edges, and that is what the Gaussians already say on their own.
      keep = 1.0 - onRoad * clamp(rut * 0.95, 0.0, 1.0);
      // …and BANKED at the kerb, which is where all of it was pushed. This is the gutter term with
      // its sign reversed, and it is what puts two white ribbons down the edge of a cleared street.
      keep += smoothstep(0.80, 1.05, a) * 0.85;
    }
    // The drift field: the same two-octave shape the floor uses, phased on ABSOLUTE world tiles so a
    // bank stays on its own bit of kerb as the window recentres — the rule the puddle field states
    // one block down and the coast warp in floor.js states for the same reason.
    vec2 sw = vWorld.xy + uWc;
    float drift = sin(sw.x * 1.9 + sin(sw.y * 1.5) * 1.3) * sin(sw.y * 2.1 + sin(sw.x * 1.7) * 1.1) * 0.30
               + sin(sw.x * 5.7 - 1.4) * sin(sw.y * 6.3 + 0.7) * 0.12;
    // Level against depth, exactly as the puddles are: a dusting catches in the lee and a real fall
    // covers everything. Scaled by 'keep' BEFORE the threshold rather than after, so a cleared wheel
    // track is genuinely last to hold snow instead of holding a faded copy of it.
    float lvl = mix(1.15, -0.12, clamp(uSnow, 0.0, 1.0));
    // ⚠ CAPPED AS WELL AS FLOORED, WHICH THE PUDDLE FIELD BELOW DOES NOT NEED AND THIS DOES. The
    // floor is the puddle shader's own trick — a threshold on a world-space field crawls as the
    // camera moves, so the band is widened to about a pixel wherever it is. The CAP is because this
    // field covers the whole street rather than a few hollows in it: at the far end of a road one
    // pixel spans several tiles, 'fwidth' goes past the width of the field itself, and the
    // smoothstep stops being an edge and becomes a ramp across the entire road — which reads as fog
    // lying on the tarmac rather than as snow.
    float band = clamp(fwidth(drift) * 1.6, 0.05, 0.30);
    snowW = smoothstep(lvl, lvl + band, 0.5 + drift) * clamp(keep, 0.0, 1.0);
    // ⚠ AND THE WHEELS CUT IT BACK — before the clamp and before anything reads it, because snowW
    // also suppresses the standing water below, and a cleared track SHOULD be allowed to hold
    // slush again.
    //
    // ⚠ AND THE CUT IS TOTAL. It used to stop at 0.88, and an eighth of the cover left lying in the
    // rut is not a wheel track — it is a smear of the same grey the rest of the street is wearing.
    // What a tyre does is take the snow OFF, so the fragment falls all the way back through the mix
    // at the bottom of main() and hands back the road that is actually there: its own palette, its
    // wetness, the water standing in it and the light landing on it.
    if (uNTrack > 1) snowW *= 1.0 - trackCut(vWorld.xy, max(fwidth(vWorld.x), fwidth(vWorld.y)) * 0.5);
    snowW = clamp(snowW, 0.0, 1.0);
  }

  float pud = 0.0;
  // ⚠ PUDDLES ARE A CARRIAGEWAY THING, AND THEY USED TO BE EVERYWHERE THE GROUND PASS DREW.
  // The note that used to sit here said there was no paved test and none was needed, because only
  // road and pavement tiles emit ground quads at all — true, and it takes "paved" to mean "road".
  // An apron, a forecourt and a depot hardstand are all 'field' and they all emitted quads, so a
  // swept concrete yard grew standing water in it exactly as a gutter did. Water runs to the
  // camber and lies in the ruts; a yard that is drained and swept does not hold a pool the size of
  // a truck. The flag rides per vertex because the alternative is the LUT, which this pass does not
  // have and should not grow — the producer already knows which surface it is emitting.
  if (uWet > 0.001 && vRoad > 0.5) {
    // ⚠ THE SCALE IS THE ONLY THING THAT SETS HOW BIG A PUDDLE IS, and it is a SLIDER now rather
    // than a constant. Swept over a 28-tile patch with the field labelled into connected pools:
    // 0.9 gives 149 pools of median 0.76 tiles² with one of 3.7, 1.5 gives 357 of median 0.36 with
    // the largest 1.68, 1.9 gives 550 of median 0.19.
    //
    // ⚠ THE "PAST 1.5 IT READS AS SPECKLE" NOTE THAT USED TO BE HERE WAS A JUDGEMENT MADE AT A
    // DIFFERENT GAIN. It was written when the reflection was clipping (glMirror 32, since halved),
    // and a saturated pool reads as a blob whatever size it is — so "speckle" was partly the clip
    // talking. Asked for smaller and more numerous from a cab, the default moved to 1.9; 1.5 is the
    // old picture and the slider still reaches it.
    //
    // It is a knob because this is a look decision and this renderer's own rule is that those get
    // made by eye. Hard-coding it meant nobody could compare two settings without a rebuild.
    vec2 pw = (vWorld.xy + uWc) * max(0.2, uPudScale);
    // ⚠ AND A DOMAIN WARP DOES NOTHING HERE, WHICH IS A MEASURED RESULT AND NOT AN OMISSION. A
    // product of sines is separable, so the obvious complaint about this field is that its contours
    // are a plaid of lozenges on the world axes — and the obvious fix is to offset the sample point
    // by a second, slower wave. It was written, and then swept at amplitudes 0 to 2.0 across warp
    // frequencies from a quarter of the field's to its own: coverage, pool count, median size,
    // largest pool and perimeter-to-area were IDENTICAL to three figures at every setting. Warping
    // the domain of a stationary field gives another stationary field — it moves each pool and
    // leaves the statistics of the set exactly where they were. Two sines a fragment for a picture
    // nothing could tell apart. If the plaid ever needs breaking it needs a different FIELD, not a
    // distorted one.
    float nA = sin(pw.x * 1.7 + sin(pw.y * 1.3) * 1.9) * sin(pw.y * 1.5 + sin(pw.x * 1.1) * 1.7);
    float nB = sin(pw.x * 4.1 + 2.0) * sin(pw.y * 3.7 - 1.0);
    // A third octave, for the EDGE and not for the body: it is what stops a shoreline being a
    // smooth oval once the transition below is narrow enough to show one. Measured, it carries the
    // pools to about 1.8x a disc's perimeter for their area — ragged like water in a hollow rather
    // than stamped out with a cutter.
    float nC = sin(pw.x * 9.3 - 1.1) * sin(pw.y * 8.7 + 2.2);
    float hollow = nA * 0.62 + nB * 0.27 + nC * 0.11;   // -1..1, low ground is high here
    // ── ⚠ AND ON A CARRIAGEWAY THE GROUND IS NOT NOISE. IT IS A ROAD. ───────────────────────────
    //
    // The field above is isotropic, which means the water lands in blobs that have no relationship
    // to the kerb, the crown, the lane it is in or the direction of travel. That reads as spilt
    // paint rather than as rain, and it is the whole of the 'why do the puddles look haphazard'
    // report. What a road actually does with water is three things, and all three are functions of
    // ONE variable, the distance across the carriageway:
    //
    //   CAMBER  the crown is the high point and the surface falls away either side, so nothing
    //           stands in the middle of a lane that is not rutted. Quadratic, because a crown is.
    //   GUTTER  the channel against the kerb takes the whole crossfall and is where water is
    //           deepest, stands longest and dries last. This is the single strongest term, and it
    //           is why a wet street reads as two bright ribbons down its edges.
    //   RUTS    traffic wears two depressions per lane into the travelled way, and those hold
    //           water once they are deep enough to. It is the reason a wet road photographs as
    //           stripes ALONG it rather than as patches on it, and the reason aquaplaning is a
    //           wheel-path problem rather than an everywhere problem.
    //
    // ⚠ THE NOISE STAYS, AND IT HAS TO. The cross-section says where water COLLECTS; it does not
    // say where the road happens to sag, where a gully is blocked, where a trench was backfilled
    // or where a patch has settled. Without the noise this draws four perfect ribbons down every
    // street in the city, which is a different kind of wrong from the one being fixed.
    //
    // ⚠ AND THE LANE PITCH IS IN TILES, NOT NORMALISED. The marking pass lays a lane line every
    // half tile whatever the carriageway's width, so a rut phase taken in tiles lands in the same
    // place in every lane of a one-tile street and a four-tile artery alike. Normalise it and the
    // ruts stretch with the road, which puts them under the lane lines on a wide one.
    // ⚠ AND ALL THREE STOP AT THE KERB, WHICH IS NOT THE SAME AS BEING CLAMPED AT IT. The kerb is
    // the edge of the TRAFFICKED surface, and the pavement band beyond it comes through this same
    // shader as paint laid on the road. Clamping 'a' at 1 would hand the whole footway the gutter
    // term at full strength and a set of wheel ruts it has never had a wheel in — a pavement
    // standing in more water than the road it edges. Past the kerb every structural term falls
    // away and what is left is the isotropic field, which is the right answer for a footway: it
    // does hold water, in whatever happens to have sunk.
    if (uPudRoad > 0.0 && vKerb > 0.001) {
      float a = abs(vLat) / vKerb;                       // 0 at the crown, 1 at the kerb
      float onRoad = 1.0 - smoothstep(0.98, 1.22, a);
      float camber = min(a, 1.0) * min(a, 1.0);
      float gutter = smoothstep(0.72, 0.99, a) * (1.0 - smoothstep(1.00, 1.30, a));
      // ⚠ THE LANE COUNT IS DERIVED FROM THE CARRIAGEWAY, NOT A FIXED PITCH IN TILES. A first cut
      // took the rut phase straight off vLat with a half-tile period, which is the pitch the
      // marking pass lays lane lines at on a wide block and is NOT the pitch on a one-tile street
      // — that one is under two thirds of a lane wide in total, so the tracks landed off the
      // tarmac and the only rut left on the road was half of one. Rounding the half-width to whole
      // lanes puts a pair of tracks in every lane of a one-tile street and of a four-tile artery
      // alike, which is what traffic actually wears.
      float lanes = max(1.0, floor(vKerb / LANE_W + 0.5));
      float phase = fract(a * lanes);                    // 0..1 across one lane, from the crown out
      float rut = exp(-pow((phase - 0.30) * 6.0, 2.0)) + exp(-pow((phase - 0.70) * 6.0, 2.0));      // ⚠ THE THREE WEIGHTS ARE AN ORDER OF FILLING, NOT A LOOK. What they have to say is which
      // part of the road holds water FIRST as the level comes up, and the real answer is not in
      // doubt: the gutter takes the entire crossfall, so it is wet in a shower that leaves the
      // rest of the carriageway merely damp; the wheel ruts go next, once there is more falling
      // than the gullies are taking; and the middle of an unrutted lane is the last place on a
      // street to hold anything, because the camber is there to make sure of it.
      float road = camber * 0.25 * onRoad + gutter * 0.62 + rut * 0.45 * onRoad;
      // ⚠ AND THE NOISE HAS TO BE THE SMALLER HALF OR NONE OF THAT SURVIVES. At an even split the
      // field still chose where the water went and the cross-section only nudged it: measured, the
      // puddles landed in the same places with the structure on and off. It is a texture on top of
      // a drainage model, not a partner to it.
      hollow = mix(hollow, road * 0.95 + hollow * 0.30, uPudRoad);    }    // ⚠ AND THE FLOOR IS 0.30 BECAUSE THAT IS WHERE A DOWNPOUR STOPS, NOT WHERE IT STARTS. The
    // level is what the rain raises, so this number is only ever reached at uWet 1 and the whole
    // shower happens above it: 0.2 of a shower wets 0.3% of the road, 0.35 wets 1.1%, 0.6 wets
    // 5.4%, and a full downpour 25%. A few damp hollows, then real puddles, then a street with
    // water lying in it — and never a sheet, which is what the level floor is guarding.
    float level = mix(0.94, 0.24, uPond);
    // ── ⚠ A SHORELINE, NOT A GRADIENT ───────────────────────────────────────────────────────────
    //
    // The transition used to be 0.30 wide against a field that only spans −1..1, so a "puddle" was
    // most of a slow ramp and the road read as mottled damp rather than as water lying in shapes.
    // Water has an EDGE — it fills a hollow to a level and stops — and that edge is most of what
    // makes a puddle look like an object rather than a stain.
    //
    // ⚠ AND THE EDGE IS WIDENED BY THE SCREEN, NOT BY A CONSTANT. A hard threshold on a world-space
    // field is the classic shimmer: at the far end of a street one pixel spans several tiles of
    // 'hollow', the test lands on a different side of the line every frame the camera moves, and
    // the road crawls. 'fwidth' is how much this fragment's own neighbours differ, so the band is
    // always about a pixel wide wherever it is — crisp underfoot, anti-aliased at the horizon, and
    // never narrower than the 0.045 that keeps a near shoreline from looking cut with scissors.
    float band = max(0.045, fwidth(hollow) * 1.6);
    pud = smoothstep(level, level + band, hollow);
  }
  // ⚠ AND SNOW TAKES THE WATER WITH IT, WHICH IS NOT A TIDY-UP. Everything below this line
  // describes a surface you can see INTO — the darkening, the smear, the mirrored city, the glint.
  // A covered road is none of those: it is an opaque diffuse white, and a puddle reflecting neon
  // through four inches of snow is the single loudest way this could go wrong. One multiply here
  // reaches all five terms, because all five are derived from 'pud' or from 'uWet'.
  pud *= 1.0 - snowW;

  // ⚠ TWO NUMBERS OUT OF ONE FIELD, because a road in the rain is not dry between its puddles. The
  // whole surface is damp and darker; what the hollows add is STANDING water, which is a different
  // thing optically — damp tarmac scatters, a puddle mirrors. So the darkening is mostly there
  // everywhere and the REFLECTION is almost entirely in the hollows, which is what puts the neon in
  // the puddles rather than smeared evenly down the street.
  // ── A POOL OF LIGHT IS NOT A SURFACE, BUT IT LANDS ON ONE ──────────────────────────────────
  //
  // The additive range is the headlight pool. Everything below describes what water does to a
  // SURFACE and none of it applies to light lying on one — it must not be darkened for being wet,
  // and it must not be replaced by the reflection (which, under ONE/ONE, would add the reflection
  // a second time on top of the road's own).
  //
  // What DOES apply is the other direction: standing water is a mirror, and a mirror under a lamp
  // throws far more of it back at you than rough tarmac does. So the pool is brightened where the
  // pools are — which is the beam finding the puddles rather than lying over them, and it costs
  // one multiply on a term this pass has already computed.
  //
  // ⚠ THE FOG IS ABOVE THIS, deliberately: a beam a long way down the road still recedes into the
  // haze with everything else in the frame.
  if (uSurface < 0.5) {
    // ── …AND IT GLIMMERS ON IT ───────────────────────────────────────────────────────────────
    //
    // A flat multiply makes the pool brighter over the pools, which is true and reads as a stain
    // rather than as water. What a headlamp on standing water actually does is GLINT: the surface
    // is never still, so the bounce arrives as a shifting scatter of highlights rather than as an
    // even lift.
    //
    // See 'waterSparkle' above for the field and for why it is world-phased and cubed. ⚠ IT IS THE
    // SAME FUNCTION THE ROAD SURFACE READS, deliberately: these are two draw calls over one wet
    // road, and a pool twinkling out of step with the water it lies in reads as two effects.
    float glim = pud > 0.01 ? waterSparkle(vWorld.xy + uWc) : 0.0;
    outColor = vec4(c * (1.0 + (0.95 + 3.2 * glim) * pud * uWet) * vAlpha, vAlpha);
    return;
  }
  float damp   = uWet * mix(0.34, 1.00, pud);
  // ⚠ 0.02, NOT 0.08 — THE REFLECTION IS THE PUDDLE'S AND ALMOST NOTHING ELSE'S. Eight per cent
  // across the whole wet road is a sheen on every square foot of tarmac, which is the even smear
  // the hollows exist to replace: with a soft-edged field it read as the road reflecting and the
  // puddles being slightly more so. At two per cent the tarmac between them keeps just enough to
  // say it is wet, and what actually mirrors the city is the standing water.
  float mirror = uWet * mix(0.02, 1.00, pud);
  // ⚠ AND THE IMAGE IS CUT TO THE WATER, WHICH 'mirror' IS NOT. That 0.02 floor is a sheen kept on
  // the damp tarmac between the pools so it still reads as wet — the right call for a wash, and the
  // wrong one for an IMAGE. Once the rig went into the reflection buffer, that two per cent meant a
  // faint copy of the TRUCK lying across the whole wet road rather than only in the water: reported
  // as it showing under the truck in parts where the puddle is not.
  //
  // Rough damp tarmac scatters and does not image — that is what 'smear' below is for. So the
  // picture is weighted by the water alone, and the pools cut it out with their own shoreline,
  // which is already anti-aliased a pixel wide wherever it is (see the 'band' above).
  float imgW = uWet * pud;
  // ⚠ AND THE SCATTER IS THE OTHER HALF OF THE SAME SURFACE, WHICH IS WHY IT IS NOT 'mirror'.
  // The streak below is what ROUGH DAMP TARMAC does: it spreads a light out along the ground line
  // from the source to the eye. Standing water does not do that — it holds an image. Scaling the
  // streak by 'mirror' put it at FIFTY TIMES the strength inside a pool that it has between them,
  // which is the exact opposite of the model this pass is built on, and the note above it has said
  // so all along ("a surface cannot both mirror and scatter").
  //
  // The half-measure was to cede '(1 - mirK)' of it to the image. That helps and does not finish:
  // mirK tops out around 0.8 at a cab's grazing angle, so a fifth of a streak at gain 4.5 still
  // lands in the pool — and every light this city puts on a road is sodium, so a fifth of six of
  // them is a broad warm wash sitting in the water. Reported as puddles with a yellow tint.
  //
  // So the streak is weighted by the DRY part of the wet road, and the image has the water to
  // itself. On the tarmac between pools this is the identical number it has always been
  // (pud = 0 gives 0.02 * uWet), so the picture there does not move at all.
  float smear = uWet * 0.02 * (1.0 - pud);
  // ⚠ AND THE SMEAR IS NOT REWEIGHTED WHEN THE MIRROR IS ON, WHICH WAS TRIED AND MEASURED AND TAKEN
  // BACK OUT. The model says it should be: damp tarmac SCATTERS (that is the two-Gaussian smear
  // below) and standing water MIRRORS, they are one surface at two roughnesses, and running both at
  // full strength over the same pixel lights a puddle twice. So a first cut moved the smear onto the
  // tarmac between the puddles and handed the water to the image.
  //
  // Measured, that is a net LOSS. The reflection is real and it is SMALL — on a night street it
  // lands on about 1-2% of the frame, because it only reaches pixels that are road AND have
  // something standing over them to reflect. The smear reaches the whole wet road. Trading all of
  // the second for a sliver of the first took the road's mean luminance from 29.9 to 27.0 and put
  // nothing where the light had been: the street got darker and no reflection appeared.
  //
  // So the mirror is PURELY ADDITIVE, and 'glMirror 0' is the exact picture that shipped rather than
  // a variant of it. The split is still the right model and it becomes worth making the day the
  // image covers enough of the road to pay for the smear it would be replacing.
  if (damp > 0.001) {
    // ⚠ 0.45 AND mix(0.40, 1.00) TOGETHER ARE THE PUDDLE'S CONTRAST AGAINST THE ROAD AROUND IT,
    // and the first pair (0.38 over mix(0.55, 1.00)) was 21% — enough to measure and not enough to
    // look at, a soft mottle rather than standing water. This is 33%: tarmac between the puddles at
    // 0.82 of dry, the puddles themselves at 0.55.
    c *= 1.0 - uWetDark * damp;
    // Slightly cooler as well as darker: a wet surface reflects more sky and less of itself.
    c = mix(c, c * vec3(0.94, 0.98, 1.06), damp * 0.5);
  }
  // ⚠ A REFLECTION IS A GRAZING-ANGLE EFFECT, AND WITHOUT THAT TERM IT COVERS THE MAP FROM THE AIR.
  // The smear below is built for an eye at street level: it runs along the ground vector from the
  // light to the viewer and its length scales with how high the light is. Seen from a cockpit that
  // geometry is meaningless — the ground vector is short, the heights are large, and the result was
  // a single enormous green wash lying across half the city. Reported from the air, and obviously
  // wrong: "way too big and random".
  //
  // Fresnel is the honest fix and it is already the model this renderer uses for water (see the
  // Schlick term in floor.js): look steeply INTO a wet surface and you see the surface; look along
  // it and you see a mirror. A cab's eye is a fifth of a tile up and ten tiles down a street, so cosI is
  // ~0.02 and the term is ~1. A cockpit twenty tiles up looking twenty out gives cosI ~0.71 and the
  // term is ~0.02. The reflections are a thing you see from the road, which is where they belong.
  // ⚠ NO LONGER GATED ON THERE BEING LIGHTS IN THE SIX. The streak loop needs a 'uWetP' entry to
  // smear; the mirror needs only the buffer, and the two share this term. With 'uNWet' 0 the loop
  // below breaks on its first iteration and adds nothing, so the old picture is unchanged.
  float refl = 0.0;
  // ⚠ HOISTED, BECAUSE THE FALLBACK SKY NEEDS THE SAME ANGLE THE FRESNEL TERM DOES. 'cosI' is the
  // cosine of the incidence angle off the water's normal, which is also the SINE of the elevation
  // the reflected ray leaves at — so one number answers both "how much does this reflect" and
  // "what is it pointed at", and the two cannot drift apart into disagreeing about the geometry.
  float cosI = 0.0;
  if (mirror > 0.001) {
    float dEye = length(vWorld.xy - uEye);
    cosI = uEyeH / max(0.001, sqrt(dEye * dEye + uEyeH * uEyeH));
    refl = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  }
  // ── THE REFLECTED CITY ─────────────────────────────────────────────────────────────────────
  //
  // One texture fetch, through the same three modulations the smear already earned: the water
  // ('mirror', so it is in the puddles and barely on the tarmac), the Fresnel term (so it is a
  // thing you see from the road and not from a cockpit) and the headroom (so daylight washes it
  // out by arithmetic rather than by a threshold). Nothing here is a second tuning of those.
  // How strongly the water is acting as a mirror at this pixel. Hoisted out of the block below
  // because the STREAK term at the bottom needs it: a surface cannot both mirror and scatter.
  float mirK = 0.0;
  if (uReflOn > 0.5 && refl > 0.01) {
    // ── ⚠ IT REPLACES WHAT IS UNDER IT. IT USED TO ADD TO IT. ───────────────────────────────────
    //
    // This was 'c += img * (...) * max(0, 1 - c)', and an ADDITIVE reflection can only ever show
    // you things BRIGHTER than the road. A neon sign is brighter, so signs reflected. A building
    // facade at night is darker, so buildings did not — the mass was genuinely in the buffer and
    // adding near-black to tarmac is a no-op. Reported as "why are signs reflecting but not
    // buildings", and as puddles that are grey: what did come through was pushed up by a gain of 16
    // until it clipped toward white, which throws the hue away. Both are the same line.
    //
    // ⚠ AND THE NOTE THAT CHOSE ADDITIVE NAMED THE CONDITION FOR CHANGING IT. It is on 'mirror'
    // above: a mix was "tried and measured and taken back out" because the image only covered a
    // sliver of road, so trading the smear for it took the road's mean luminance 29.9 → 27.0 and
    // "put nothing where the light had been" — and it closes with "it becomes worth making the day
    // the image covers enough of the road to pay for the smear it would be replacing". Putting the
    // MASS in the reflection buffer is that day: the image went from 1.65% of the road to 5.73%,
    // and from a handful of signs to the city.
    //
    // ⚠ PREMULTIPLIED 'OVER', NOT A LERP. The buffer is premultiplied — 'im.rgb' is already scaled
    // by its own coverage — so an empty pixel has alpha 0 and leaves the road exactly as it was.
    // A naive mix toward 'im.rgb' would darken every wet pixel that has nothing above it to
    // reflect, which is the flat-tint failure this whole pass exists to avoid.
    //
    // ⚠ AND THE HEADROOM TERM IS GONE WITH IT. 'max(0, 1 - c)' was an additive guard against
    // blowing past white, and it was a DESATURATOR: it is per-channel, so on a road that is already
    // bright in one channel it clamped that channel hardest and pulled the reflection toward grey.
    // A composite cannot exceed its own inputs, so nothing here needs holding down.
    // ── AND THE WATER MOVES ─────────────────────────────────────────────────────────────────────
    //
    // A flat mirror in a hollow in a road is the one thing standing water never is: there is always
    // rain landing on it, wind across it, or a truck going past. The reflection is read at a screen
    // position, so bending it is a small offset on that lookup — the cheapest possible version of
    // the effect, and the only one this pass can afford.
    //
    // ⚠ THE WAVES ARE IN WORLD SPACE AND THE OFFSET IS IN SCREEN SPACE, and mixing those up is the
    // whole trap. Drive the phase from the SCREEN and the ripples swim across the road as the
    // camera turns, which reads as a dirty lens rather than as water; drive it from the world, as
    // the puddle field itself already is, and a pool ripples in place while you drive past it.
    //
    // ⚠ SCALED BY 'pud', SO ONLY THE WATER MOVES. The damp tarmac between the pools reflects
    // through the same term at 2% weight, and bending that as well would wobble the whole street.
    //
    // ⚠ AND IT IS DIVIDED BY THE VIEWPORT, so the amplitude is PIXELS rather than UV. A constant in
    // UV is a bend that doubles when somebody halves the resolution dial, which is a look that
    // changes with the performance settings. Both axes use the same divisor, or the ripple is
    // squashed on whichever axis the canvas is longer.
    vec2 ruv = gl_FragCoord.xy / uReflVP;
    if (uRipple > 0.0 && pud > 0.01) {
      vec2 q = (vWorld.xy + uWc) * 2.7;
      float w1 = sin(q.x * 1.9 + uTime * 1.7) * cos(q.y * 2.3 - uTime * 1.3);
      float w2 = sin(q.y * 3.1 - uTime * 2.1) * cos(q.x * 2.7 + uTime * 1.1);
      ruv += vec2(w1, w2) * (uRipple * pud / uReflVP.y);
    }
    vec4 im = texture(uRefl, ruv);
    // ── ⚠ AND WHERE THERE IS NO CITY OVERHEAD, THE WATER IS LOOKING AT THE SKY ──────────────────
    //
    // The reflection buffer holds the CITY and nothing else — it is cleared transparent, so a pixel
    // with no building or sign above it comes back with alpha 0. Composited straight, that left the
    // road exactly as it was: a puddle under open sky reflected NOTHING, and all you saw in it was
    // the warm streak from the lamps. Reported as puddles that are yellow, which they were, because
    // the only thing in them was sodium light.
    //
    // A mirror shows whatever is above it, and above most of a street is sky. So the buffer is
    // composited over the sky first and the result is what the water reflects.
    //
    // ⚠ AND IT IS A GRADIENT, NOT THE HAZE BAND. This read "'uFog' IS THE RIGHT SKY HERE, AND NOT AN
    // APPROXIMATION OF ONE", on the grounds that the Fresnel gate leaves only grazing reflections and
    // a grazing reflection shows the horizon. The first half is true and the conclusion does not
    // follow: Fresnel decides how STRONGLY each pixel reflects, not which pixels are drawn, so the
    // near road is still there and still reflecting — weakly, over the largest area of the frame,
    // and every one of those pixels was being handed the skyline's colour while pointing at the
    // zenith. Measured on a daylit street, the buffer's own content reaches only the far third of
    // the road (rows 190-279 of 400); the other two thirds were a flat wash.
    //
    // ⚠ THE 0.86 IS THE RENDERER'S OWN SKY DOME AND NOT A TASTE CONSTANT. 'drawSky' runs its
    // gradient from 'sky.top' at the top of the canvas to 'sky.hor' at the horizon, while elevation
    // maps to the screen as horizonY * (1 - sin(el) * 0.86) — so the ZENITH sits 86% of the way
    // along that gradient rather than at the end of it. Using 1.0 here would give the water a sky
    // slightly deeper than the one painted above it, which is the kind of disagreement nobody can
    // point at and everybody can see.
    // ⚠ THE STRIP WINS WHERE THERE IS ONE, AND THE GRADIENT IS STILL THE FALLBACK'S FALLBACK — a
    // frame with the horizon off the top of the screen has no band to capture, and a machine that
    // refused the upload has no texture. Both land here with uSkyOn at 0 and get the road that
    // shipped.
    vec3 sky = mix(uSkyHor, uSkyTop, cosI * 0.86);
    if (uSkyOn > 0.5) {
      // v = 1 at the horizon (a grazing ray looks along it) and 0.14 at the zenith, which is where
      // 'drawSky' puts the top of its own gradient — see the 0.86 note above.
      sky = texture(uSky, vec2(gl_FragCoord.x / max(1.0, uReflVP.x), 1.0 - cosI * 0.86)).rgb;
    }
    vec3 img = im.rgb + sky * (1.0 - im.a);
    // The water's own weight. 'uReflGain' is a 0…32 strength where 32 means standing water reflects
    // exactly as hard as the Fresnel term says it should, which at a cab's grazing angle is very
    // nearly a perfect mirror — what the reference boards actually show.
    mirK = clamp(imgW * refl * uReflGain * (1.0 / 32.0), 0.0, 1.0);
    c = c * (1.0 - mirK) + img * mirK;
  }
  if (refl > 0.01 && uNWet > 0) {
    vec3 add = vec3(0.0);
    vec3 glint = vec3(0.0);
    for (int i = 0; i < MAX_WET; i++) {
      if (i >= uNWet) break;
      vec2 gp = uWetP[i].xy;                 // the light's own ground point
      vec2 toLight = gp - uEye;
      float el = length(toLight);
      if (el < 0.001) continue;
      toLight /= el;
      // ⚠ A STREAK IS ANCHORED AT THE MIRROR POINT, NOT AT THE FOOT OF THE LIGHT, and putting it at
      // the foot is why the road never reflected anything. Angle of incidence equals angle of
      // reflection, so for an eye at height e and a light at height h the image of the light lands
      // on the ground at e/(e+h) of the way from the EYE to the light — which for a cab (e about a
      // fifth of a tile) and a sign three storeys up is barely a tile from the truck, nowhere near
      // the sign. The old model put a blob at the light's own foot instead, and every light in a
      // city is mounted on a BUILDING: measured, all six of the road's lights had their feet on
      // building tiles, where there is no ground quad at all, so the term drew literally nothing.
      // The bench read 0.00% coloured pixels on the road at every wetness and every hour, which is
      // what a correct shader fed the wrong geometry looks like.
      float k = uEyeH / max(0.05, uEyeH + uWetP[i].z);
      vec2 spec = uEye + toLight * (el * k);
      vec2 rel = vWorld.xy - spec;
      float along = dot(rel, toLight);                     // positive runs AWAY toward the light
      float lat = dot(rel, vec2(-toLight.y, toLight.x));
      // ⚠ AND THE SMEAR IS A ROUGHNESS, SO IT SCALES WITH THE DISTANCE TO THE LIGHT, not with the
      // light's height. This is the whole reason a photograph of a wet street shows a streak yards
      // long rather than a second copy of the sign: tarmac scatters over a wide angle, and a wide
      // angle at ten tiles is a long streak. A mirror-smooth surface would be 'len' near zero, and
      // it would be correct and would look nothing like the reference boards.
      // ⚠ CLAMPED at both ends: a floor so a light overhead still marks the road, and a ceiling
      // because from a cockpit 'el' is the width of the map. The Fresnel gate above is the real
      // defence there and the clamp is the belt.
      float len = clamp(el * 0.9, 0.8, 10.0);
      float a = along >= 0.0 ? along / len : along / (len * 0.45);
      // ⚠ AND IT IS WIDE ENOUGH TO COVER A LANE. At a tenth of the light's reach the streak was
      // about 0.44 tiles across, which is half a road — and because its axis runs from the eye to
      // a light mounted on a building beside the street, a narrow streak leaves the tarmac within a
      // couple of tiles and spends the rest of its length on ground that draws no quad at all.
      // Measured on the GL canvas directly rather than the composited frame (the cab's dash covers
      // the near road, so the 2-D frame hides exactly the part being measured): the puddle field
      // and the Fresnel term were both healthy — 51% of visible ground over pud 0.5 — and the
      // streaks were contributing a few tenths of a per cent.
      float t = lat / max(0.25, uWetR[i] * 0.25);
      add += uWetC[i] * (exp(-a * a) * exp(-t * t));
      // ── ⚠ AND THE SAME LIGHT AGAIN, AT THE WATER'S ROUGHNESS ────────────────────────────────
      //
      // This is not a second effect. It is the line above evaluated at the OTHER roughness, which
      // is the model this whole block already states: damp tarmac scatters and standing water
      // mirrors, one surface, two roughnesses. The note on 'len' says so in as many words — "a
      // mirror-smooth surface would be 'len' near zero" — and then only ever computes the rough
      // half, because the water was supposed to be served by the reflection buffer instead.
      //
      // ⚠ AND MEASURED, IT WAS NOT. A grazing reflection shows what is FAR away: for an eye a
      // fifth of a tile up, the reflected ray off a puddle ten tiles ahead rises about a degree
      // and a half, so it clears a three-storey frontage forty tiles further on and what the water
      // is actually looking at is the horizon. At night that is a dark sky, so the buffer replaced
      // dark tarmac with dark sky and the wet road at 23:00 came out as a pure subtraction:
      // '__glWet()' measured 52% of the frame darker and 0.00% of it brighter, at any wetness, with
      // the headlights off. A street with water lying in it does not get darker and nothing else.
      //
      // What the buffer cannot show is the lamp DIRECTLY OVERHEAD, because at a grazing angle its
      // image lands a tile from the truck rather than under it — which is exactly the geometry
      // 'spec' above already solves. So the water gets the same light, collapsed to a highlight
      // instead of drawn out into a streak, and the two halves are weighted by the two halves of
      // one field: the streak by 'smear' (the dry part) and this by 'imgW' (the water).
      // ⚠ SHORTER THAN THE STREAK, NOT A POINT, AND THE FIRST CUT WAS A POINT. At a thirteenth of
      // the scatter's length and a fifth of its width the highlight is smaller than a pixel over
      // most of the road, and it has to land inside a POOL to be weighted at all — two independent
      // placements, so it almost never did. Measured: 0.00% of the frame moved at every gain up to
      // 12, and a gain of 400 was needed to move 0.98% of it, which is a term evaluated at a
      // thousandth of its own peak. Water is rippled, not polished: the highlight is drawn out
      // along the line to the light and is long enough to cross a pool, which is what makes it a
      // reflection you can see rather than one that is technically present.
      float glen = len * 0.45;
      float ga = along >= 0.0 ? along / glen : along / (glen * 0.45);
      float gt = lat / max(0.10, uWetR[i] * 0.12);
      glint += uWetC[i] * (exp(-ga * ga) * exp(-gt * gt));
    }
    // ⚠ 4.5 WAS SWEPT, NOT CHOSEN. Measured on a lit street at full wetness, as the share of the
    // frame that moves against a dry road: 1.6 gives 0.96% (there, and invisible), 3.2 gives 3.8%,
    // 6.4 gives 16.7%, 12.8 gives 25% and 25.6 gives 31.5% — and the road is only ~33% of that
    // frame, so the top of that range is every road pixel saturated. 4.5 lands near 8-10%: a strong
    // streak under each sign with dark tarmac still between them, which is what the reference
    // boards actually show.
    // ⚠ A SCREEN-STYLE ADD, NOT A LINEAR ONE, AND THE DIFFERENCE IS WHETHER DAYLIGHT WORKS. A flat
    // plain additive term lifts a bright road exactly as much as a dark one, so once reflections stopped
    // being night-gated a wet road at noon came out BRIGHTER than a dry one — measured at +3.44
    // against a 30% darkening that should have dominated. That is backwards, and it is backwards
    // for a real reason: a light source only reads on a surface darker than itself. There is very
    // little room above bright tarmac for a neon sign to add anything to.
    //
    // The headroom term is that room. On a dark night road it adds nearly the whole term; at noon
    // it adds what is left, which is almost nothing — so the reflection is washed out by daylight
    // on its own, by arithmetic, rather than by a threshold deciding in advance that it should be.
    // ── ⚠ AND A SURFACE CANNOT BOTH MIRROR AND SCATTER ─────────────────────────────────────────
    //
    // Damp tarmac SCATTERS — that is this streak — and standing water MIRRORS. They are one
    // surface at two roughnesses, and running both at full strength over the same pixel lights a
    // puddle twice.
    //
    // This was scaled by 'mirror', which is 1.0 inside a pool and 0.02 between them: the streak
    // was FIFTY TIMES stronger in the water than on the tarmac, which is the model exactly
    // backwards. A cede of '(1 - mirK)' was added to claw it back and could not finish the job —
    // mirK tops out near 0.8 at a cab's grazing angle, so a fifth of six sodium lights at gain 4.5
    // still sat in the pool. Reported from the game as puddles with a yellow tint, which is what
    // a fifth of six sodium lights looks like.
    //
    // 'smear' is the dry half of the same field, so the streak is now where the scattering is and
    // the image has the water to itself. ⚠ THE TARMAC BETWEEN POOLS DOES NOT MOVE: at pud = 0 the
    // weight is 0.02 * uWet, the identical number it has always been.
    //
    // ⚠ AND IT NO LONGER READS 'mirK', so 'glMirror 0' is no longer an exact restoration of the
    // old streak — it takes the image away and leaves the pools with neither. That is the honest
    // shape of the trade now: the water reflects or it is dark, and the smear is the road's.
    c += add * (smear * 4.5 * refl) * max(vec3(0.0), 1.0 - c);
    // ── AND THE HIGHLIGHT IN THE WATER, WHICH TWINKLES ─────────────────────────────────────────
    //
    // Weighted by 'imgW' — the water and nothing else — so the tarmac between the pools is the
    // identical number it has always been and 'uGlint 0' is exactly the picture that shipped.
    //
    // ⚠ THE SPARKLE IS A MODULATION AND NOT THE WHOLE TERM. At '0.35 + 0.65 * spark' a puddle under
    // a lamp is always lit and the crests ride on top of it; driven by the sparkle alone the
    // highlight blinks out between crests, which reads as a strobing road rather than as water.
    //
    // ⚠ AND IT KEEPS THE HEADROOM TERM, for the same reason the streak does: a light source only
    // reads on a surface darker than itself, so a wet road at noon washes this out by arithmetic
    // rather than by a clock deciding in advance that it should.
    //
    // ── ⚠ AND A HIGHLIGHT MAY NOT PAINT WHITE, WHICH IS WHAT IT WAS DOING ───────────────────────
    //
    // The headroom term above was carrying the whole daylight argument and it cannot: it is
    // measured against 'c', and 'c' is the WET road, which this pass has just darkened by 45%. So
    // the brighter the day, the darker the surface the glint is allowed to fill — the wash-out was
    // reasoning about a dry road that is never the one under the water.
    //
    // What that left is 'c + k*(1-c)', which for k >= 1 is EXACTLY 1.0: pure white, per channel, so
    // the hue goes too. And k was routinely far past 1 — 'uGlint' was 50 (see the note on its
    // default, which came down to 8 with this) because 'rgbRaw' colours are small, and the six the
    // road picks reserve two slots for facade WASHES, which are broad and bright and cover a whole
    // carriageway rather than a lane. Measured on a daylit street in
    // front of the Sentinel, against the same street at glint 0: 6.7% of the near ground over
    // luminance 170, peak 255, and the standard deviation of the road 19 -> 56. Reported from the
    // game as puddles showing flat opaque colour with no reflection in them, which is what a
    // saturated additive term looks like — the pools were the brightest thing in the frame and
    // every one of them was the same white.
    //
    // ⚠ THE CAP IS ON THE BRIGHTNESS AND NOT PER CHANNEL. Clamping each channel at 1.0
    // independently is the same bug with an extra step: a sodium lamp is (0.45, 0.32, 0.16) and at
    // 50x all three are over 1, so all three clamp to 1 and the highlight is white again. Dividing
    // by the largest channel holds the RATIO, so what a pool fills with is the lamp's own colour at
    // its own strongest — an amber highlight, never a white hole.
    if (uGlint > 0.0 && imgW > 0.001) {
      float spark = waterSparkle(vWorld.xy + uWc);
      vec3 gcol = glint * (imgW * uGlint * refl * (0.35 + 0.65 * spark));
      float gmax = max(gcol.r, max(gcol.g, gcol.b));
      if (gmax > 1.0) gcol /= gmax;
      c += gcol * max(vec3(0.0), 1.0 - c);
    }
  }
  // ── AND THE SNOW GOES ON TOP OF ALL OF IT ────────────────────────────────────────────────────
  //
  // Last, because it is the surface the light is landing on rather than something happening to the
  // road: everything above describes tarmac, and where this is 1 there is no tarmac to describe.
  //
  // ⚠ IT TAKES THE SKY, NOT A WHITE. Snow is very nearly a perfect diffuse reflector of the whole
  // hemisphere, so what it hands back is what is above it — which this shader already has in
  // 'uSkyTop', the zenith colour the standing water was given for exactly the same reason. A
  // constant white would read as paint at every hour of the day and would be wrong twice over at
  // dusk, when both the sky and the snow under it go pink.
  //
  // ⚠ AND THE FOG IS ALREADY IN 'c' — it is applied on the first line of main — so mixing toward a
  // raw snow colour here would put a crisp white street at the end of a hazed one. The tint is
  // hazed by the same weight before it lands.
  if (snowW > 0.001) {
    vec3 snowCol = mix(mix(vec3(0.90, 0.93, 0.98), uSkyTop, 0.20), uFog, vFog);
    c = mix(c, snowCol, snowW);
  }
  // ── AND THE LIGHT IN THE AIR OVER THE ROAD ─────────────────────────────────
  //
  // The same integral the buildings take — see gl/fog.js — over the road's own six lights. ⚠ The
  // road and the wall beside it must scatter the same amount or a lamp's cone stops at the kerb,
  // which is why this is the shared function rather than a second one tuned here.
  //
  // ⚠ ADDED LAST, AFTER THE WATER AND THE SNOW. Everything above describes what the SURFACE is
  // doing; this is light that never reached the surface at all, and a shaft folded in earlier
  // would get reflected by the wet road as though it were a thing standing in the street.
  if (uScatter > 0.001 && uNWet > 0) {
    vec3 scat = vec3(0.0);
    for (int i = 0; i < MAX_WET; i++) {
      if (i >= uNWet) break;
  // ⚠ uScatter IS PASSED AS THE DENSITY, AND THE WEATHER IS NOT COUNTED TWICE. The obvious
    // wiring hands the integral the fog's own uFogH and then scales the result by the weather gate
    // as well — which is physically defensible and measures as a QUADRATIC response, because both
    // terms track the same haze. A rainy night came back at 0.14% of the frame against a foggy
    // one's 11.05%, so the weather this whole layer exists for got almost none of it. The gate
    // carries the weather once; the height profile inside still shapes it.
      scat += uWetC[i] * lightShaft(vec3(uEye, uEyeH), vWorld, uWetP[i], uWetR[i], uScatter, uFogHScale);
    }
    c += scat;
  }
  outColor = vec4(c * vAlpha, vAlpha);   // premultiplied, like every other layer on this canvas
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' ground shader: ' + log);
  }
  return sh;
}

// A quad is `{ p: [[x,y,z] x4], rgb: [0-255 x3] }` in the MAP WINDOW's frame — the same frame the
// mass mesh uses, so the caller hands both to the same shifted camera and they cannot disagree
// about where a kerb is.
export function createGroundLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('ground link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    color: gl.getAttribLocation(prog, 'aColor'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    road: gl.getAttribLocation(prog, 'aRoad'),
    lat: gl.getAttribLocation(prog, 'aLat'),
    kerb: gl.getAttribLocation(prog, 'aKerb'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    skyHor: gl.getUniformLocation(prog, 'uSkyHor'),
    skyTop: gl.getUniformLocation(prog, 'uSkyTop'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    nWet: gl.getUniformLocation(prog, 'uNWet'),
    wetP: gl.getUniformLocation(prog, 'uWetP'),
    wetC: gl.getUniformLocation(prog, 'uWetC'),
    wetR: gl.getUniformLocation(prog, 'uWetR'),
    wet: gl.getUniformLocation(prog, 'uWet'),
    pudScale: gl.getUniformLocation(prog, 'uPudScale'),
    pond: gl.getUniformLocation(prog, 'uPond'),
    snow: gl.getUniformLocation(prog, 'uSnow'),
    nTrack: gl.getUniformLocation(prog, 'uNTrack'),
    track: gl.getUniformLocation(prog, 'uTrack'),
    trackHalf: gl.getUniformLocation(prog, 'uTrackHalf'),
    trackW: gl.getUniformLocation(prog, 'uTrackW'),
    trackBox: gl.getUniformLocation(prog, 'uTrackBox'),
    pudRoad: gl.getUniformLocation(prog, 'uPudRoad'),
    eye: gl.getUniformLocation(prog, 'uEye'),
    eyeH: gl.getUniformLocation(prog, 'uEyeH'),
    fogH: gl.getUniformLocation(prog, 'uFogH'),
    fogHScale: gl.getUniformLocation(prog, 'uFogHScale'),
    scatter: gl.getUniformLocation(prog, 'uScatter'),
    wc: gl.getUniformLocation(prog, 'uWc'),
    surface: gl.getUniformLocation(prog, 'uSurface'),
    hazeNear: gl.getUniformLocation(prog, 'uHazeNear'),
    hazeFar: gl.getUniformLocation(prog, 'uHazeFar'),
    refl: gl.getUniformLocation(prog, 'uRefl'),
    reflOn: gl.getUniformLocation(prog, 'uReflOn'),
    reflGain: gl.getUniformLocation(prog, 'uReflGain'),
    reflVP: gl.getUniformLocation(prog, 'uReflVP'),
    sky: gl.getUniformLocation(prog, 'uSky'),
    skyOn: gl.getUniformLocation(prog, 'uSkyOn'),
    time: gl.getUniformLocation(prog, 'uTime'),
    ripple: gl.getUniformLocation(prog, 'uRipple'),
    glint: gl.getUniformLocation(prog, 'uGlint'),
    wetDark: gl.getUniformLocation(prog, 'uWetDark'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  let count = 0, splitA = 0, splitP = 0, splitB = 0;

  const tris = (list) => list.reduce((n, q) => n + (q.p.length - 2) * 3, 0);

  // ⚠ FILLED STRAIGHT INTO THE TYPED ARRAY. The mass rebuild cost 11.1 ms until it stopped building
  // plain arrays and converting them; at twelve thousand quads a frame this path cannot afford that
  // mistake a second time.
  // ⚠ FOUR RANGES, NOT ONE LIST, AND THE ORDER IS THE CANVAS'S. Everything here shares the ground
  // plane, so what separates them is not depth but what they DO to what is already there:
  //
  //   base  — the road SURFACE, which writes depth because it is a surface
  //   paint — a lane line, a kerb, a zebra bar: markings laid ON that surface
  //   add   — a headlight pool, which is light landing on it ('lighter' on the canvas)
  //   over  — a shadow, which is translucent dark laid on top of all three
  //
  // Surface, then paint, then light, then shadow, is exactly the sequence the 2-D pass paints in:
  // drawGroundSurfaces, drawHeadlightBeam, then the shadows the building loop casts. Get it
  // backwards and a building's shadow stops falling across the beam.
  // Only the base writes depth: a translucent quad that wrote it would let its own dark alpha
  // occlude whatever else shares its plane.
  //
  // ⚠ AND PAINT IS A RANGE OF ITS OWN BECAUSE PAINT GOES ON PAINT. The eps ladder orders the road
  // against the floor and the shadows against the road; it has nothing to say about a yellow centre
  // line and a zebra bar, which are both markings, both at ROAD_EPS and therefore exactly coplanar.
  // Coplanar with depth-write on is a per-pixel coin toss decided by the last bits of two different
  // triangles' interpolated depth — and it moves as the camera moves, which is what "flashing white
  // patches over the yellow lines" is. One junction tile in a bare test city produced 196 such
  // pairs: every kerb against the pavement band it edges, every lane dash against the crossing it
  // runs through, and the yellow centreline against the zebra. Lifting either one is not the fix —
  // a world lift is worth a fraction of a depth unit by forty tiles, so the fight comes back the
  // moment the camera pulls away. Paint TESTS depth (a building still hides the road behind it) and
  // writes none, so what is drawn later composites on top, which is the answer the canvas has
  // always given. The order within the range is the push order, which is the paint order.
  function upload(quads) {
    const base = [], paint = [], add = [], over = [];
    for (const q of quads) (q.add ? add : q.over ? over : q.paint ? paint : base).push(q);
    quads = base.concat(paint, add, over);
    splitA = tris(base);
    splitP = splitA + tris(paint);
    splitB = splitP + tris(add);
    count = tris(quads);
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 1 << 16));
    let o = 0;
    for (const q of quads) {
      const p = q.p, c = q.rgb, qa = q.a == null ? 1 : q.a;
      // ⚠ COLOUR IS PER VERTEX IN THE BUFFER AND USUALLY PER QUAD IN THE CALLER, and the two are
      // not in tension — a road has one colour and writes it four times. `rgbs` is for the caller
      // that needs the other: a cliff face is painted with a vertical GRADIENT, which is the one
      // thing a flat quad cannot say and the reason a massif could not follow the road onto this
      // layer. Interpolating between the top and bottom vertices is what a gradient IS.
      const cs = q.rgbs;
      // ⚠ AND ALPHA PER VERTEX FOR THE SAME REASON, which is the one thing a flat quad cannot say.
      // A headlight pool has no edge in the world — it fades out sideways and it fades out with
      // distance — and drawn as quads of one alpha each it is a fan of hard-edged strips with a
      // visible seam down every join. That is most of what "harsh" means about it.
      const as = q.as;
      const r = c ? c[0] / 255 : 0, g = c ? c[1] / 255 : 0, b = c ? c[2] / 255 : 0;
      const rdw = q.road ? 1 : 0;
      // ⚠ PER VERTEX BECAUSE IT VARIES ACROSS THE QUAD, and 'kerb' does not — but a vertex buffer
      // has no other place to put a per-quad number, and writing it four times costs nothing
      // measurable against the four positions already being written beside it.
      const lats = q.lat, kb = q.kerb == null ? 0 : q.kerb;
      const put = (v, i) => {
        const k = cs && cs[i];
        data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2];
        data[o + 3] = k ? k[0] / 255 : r; data[o + 4] = k ? k[1] / 255 : g; data[o + 5] = k ? k[2] / 255 : b;
        data[o + 6] = as ? as[i] : qa; data[o + 7] = rdw;
        data[o + 8] = lats ? lats[i] : 0; data[o + 9] = kb; o += STRIDE;
      };
      // A fan, because a shadow is the convex hull of a footprint and its offset copy and can
      // carry up to eight corners; a road quad is the four-point case of the same loop.
      for (let i = 1; i + 1 < p.length; i++) { put(p[0], 0); put(p[i], i); put(p[i + 1], i + 1); }
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.pos, 3, 0); bind(loc.color, 3, 12); bind(loc.alpha, 1, 24); bind(loc.road, 1, 28);
    bind(loc.lat, 1, 32); bind(loc.kerb, 1, 36);
    gl.bindVertexArray(null);
    return quads.length;
  }

  function draw(cam, H, opts = {}) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, H)));
    const f = opts.fog || {};
    const c = f.col || [0.5, 0.5, 0.55];
    gl.uniform3f(loc.fog, c[0], c[1], c[2]);
    // ⚠ BOTH DEFAULT TO THE FOG COLOUR, WHICH MAKES AN UNPLUMBED FRAME BIT-IDENTICAL TO THE ONE
    // THAT SHIPPED. `mix(c, c, t)` is `c` at every `t`, so a caller that hands over no sky band —
    // the Modelshop's own scenes, a bench, anything that reaches this layer directly — gets the
    // flat haze fallback exactly as before rather than a gradient built out of a stand-in.
    const sb = opts.skyBand || {};
    const sh = sb.hor || c, st = sb.top || c;
    gl.uniform3f(loc.skyHor, sh[0], sh[1], sh[2]);
    gl.uniform3f(loc.skyTop, st[0], st[1], st[2]);
    gl.uniform1f(loc.fogNear, f.near == null ? 6 : f.near);
    gl.uniform1f(loc.fogFar, f.far == null ? 34 : f.far);
    gl.uniform1f(loc.fogAmt, f.amt || 0);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE DRY ONES. A uniform holds its last value, so a pass that
    // only set these when it had reflections would leave the last wet frame's streaks lying on the
    // road long after it stopped raining — the same rule the sun strength in context.js follows.
    const wl = (opts.wet > 0 ? opts.wetLights : null) || EMPTY_WET;
    const nw = Math.min(MAX_WET, wl.length);
    // ⚠ NOT `nw ? wet : 0`, WHICH IS THE SAME MISTAKE AS THE CALLER'S AND WAS STILL HERE AFTER THAT
    // ONE WAS FIXED. Two gates, one layer apart, both saying "no lights means no wetness" — so
    // removing the outer one moved the daylight road from dry to dry. The wetness DARKENS the
    // surface and needs nothing to reflect; only the reflection loop needs a light, and it has its
    // own `uNWet > 0` test.
    gl.uniform1f(loc.wet, opts.wet || 0);
    gl.uniform1i(loc.nWet, nw);
    gl.uniform2f(loc.eye, opts.eyeX || 0, opts.eyeY || 0);
    gl.uniform1f(loc.eyeH, opts.eyeH == null ? 0.2 : opts.eyeH);
    gl.uniform1f(loc.fogH, opts.fogH || 0);
    gl.uniform1f(loc.fogHScale, opts.fogHScale > 0 ? opts.fogHScale : 0.5);
    gl.uniform1f(loc.scatter, opts.scatter || 0);
    // The window centre, so the puddle field is phased on ABSOLUTE world tiles. vWorld is
    // map-window, which slides a whole tile every time the window recentres; without this the
    // hollows would crawl along the road as you drive, which is the one thing a puddle must not do.
    gl.uniform2f(loc.wc, opts.wcX || 0, opts.wcY || 0);
    if (nw) {
      for (let i = 0; i < nw; i++) {
        const L = wl[i];
        WET_P[i * 3] = L.p[0]; WET_P[i * 3 + 1] = L.p[1]; WET_P[i * 3 + 2] = L.p[2];
        // ⚠ `rgbRaw`, NOT `rgb` — see pickLights. `rgb` carries the night weighting the WALL wash
        // wants and falls to zero at noon, which would make a wet road stop reflecting in daylight.
        // A reflection at four in the afternoon is faint because the ground around it is bright,
        // not because the light was scaled away.
        const lc = L.rgbRaw || L.rgb;
        WET_C[i * 3] = lc[0]; WET_C[i * 3 + 1] = lc[1]; WET_C[i * 3 + 2] = lc[2];
        WET_R[i] = L.r;
      }
      gl.uniform3fv(loc.wetP, WET_P.subarray(0, nw * 3));
      gl.uniform3fv(loc.wetC, WET_C.subarray(0, nw * 3));
      gl.uniform1fv(loc.wetR, WET_R.subarray(0, nw));
    }
    gl.uniform1f(loc.hazeNear, opts.hazeNear == null ? 1e9 : opts.hazeNear);
    gl.uniform1f(loc.hazeFar, opts.hazeFar == null ? 1e9 : opts.hazeFar);
    // ⚠ WRITTEN EVERY FRAME LIKE THE WETNESS ABOVE, AND FOR THE SAME REASON. A uniform holds its
    // last value, so a dry frame that simply skipped this would go on sampling the last wet frame's
    // reflection — a city lying in a road that stopped being wet ten minutes ago.
    // ⚠ AND THE TEXTURE UNIT IS BOUND WHATEVER HAPPENS. Sampling an incomplete unit is undefined
    // rather than black on some drivers, so the `off` branch has to leave `uReflOn` at 0 AND still
    // leave a valid binding: the shader's branch is what saves the fetch, not an unbound sampler.
    const rt = opts.wet > 0 ? opts.reflTex : null;
    const on = rt && opts.reflGain > 0;
    gl.uniform1f(loc.reflOn, on ? 1 : 0);
    gl.uniform1f(loc.reflGain, on ? opts.reflGain : 0);
    gl.uniform1f(loc.pudScale, opts.pudScale > 0 ? opts.pudScale : 1.9);
    // ⚠ FALLS BACK TO 'wet', WHICH IS WHAT MAKES A CALLER THAT HAS NOT BEEN TAUGHT ABOUT PONDING
    // BIT-IDENTICAL. Every bench, the Modelshop and any direct user of this layer hands over a
    // wetness and no pond; the level then reads exactly the number it always did.
    gl.uniform1f(loc.pond, opts.pond == null ? (opts.wet || 0) : opts.pond);
    // ⚠ NOT FALLING BACK TO ANYTHING, UNLIKE THE POND ABOVE IT. A caller that has not been taught
    // about snow means a bench, the Modelshop or a direct user of this layer, and the honest answer
    // for all three is BARE GROUND — so this defaults to 0 and every existing harness is unchanged
    // by construction rather than by anybody remembering to switch it off.
    gl.uniform1f(loc.snow, opts.snow || 0);
    // ⚠ WRITTEN EVERY FRAME, INCLUDING THE FRAMES WITH NO TRACKS. A uniform holds its last value,
    // so a pass that set these only when it had a path would leave the last one carved into the
    // snow for the rest of the session — the rule the road segments and the wet lights carry.
    {
      const tk = opts.tracks;
      const tn = tk && tk.pts ? Math.min(MAX_TRACK_PTS, tk.n | 0) : 0;
      gl.uniform1i(loc.nTrack, tn);
      if (tn > 1) {
        gl.uniform4fv(loc.track, tk.pts.subarray(0, tn * 4));
        gl.uniform1f(loc.trackHalf, tk.half); gl.uniform1f(loc.trackW, tk.w);
        gl.uniform4f(loc.trackBox, tk.box[0], tk.box[1], tk.box[2], tk.box[3]);
      }
    }
    gl.uniform1f(loc.pudRoad, opts.pudRoad == null ? 1 : opts.pudRoad);
    gl.uniform2f(loc.reflVP, opts.vpW || 1, opts.vpH || 1);
    gl.uniform1f(loc.time, opts.time || 0);
    gl.uniform1f(loc.ripple, on ? (opts.ripple > 0 ? opts.ripple : 0) : 0);
    // ⚠ NOT GATED ON `on`, UNLIKE THE RIPPLE ABOVE IT. The ripple bends a lookup into the
    // reflection buffer and means nothing without one; the glint is the light list reflected in
    // the water and needs no buffer at all, so it survives `glMirror 0` exactly as the streak does.
    gl.uniform1f(loc.glint, opts.glint > 0 ? opts.glint : 0);
    // ⚠ NOT `|| 0.45`, because 0 is a legal setting (a wet road exactly as bright as a dry one) and
    // `0 || 0.45` is 0.45. The caller always sends a number; this only covers an undefined.
    gl.uniform1f(loc.wetDark, opts.wetDark == null ? 0.45 : opts.wetDark);
    gl.uniform1i(loc.refl, 1);
    // ⚠ UNIT 2, AND BOUND WHATEVER HAPPENS, for the same reason the reflection above is: sampling an
    // incomplete unit is undefined rather than black on some drivers, so the shader's own branch is
    // what saves the fetch and `uSkyOn` is what decides.
    const skyT = on ? (opts.skyTex || null) : null;
    gl.uniform1i(loc.sky, 2);
    gl.uniform1f(loc.skyOn, skyT ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, skyT);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, on ? rt : null);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    // ── ⚠ THE EPS LADDER IS A WORLD LIFT AND THE DEPTH BUFFER IS NOT LINEAR ───
    //
    // Everything on this layer lies on the ground and is held off the floor shader by a lift in
    // WORLD z — SURF_EPS 0.0008, ROAD_EPS 0.002, BEAM_EPS 0.003, SHADOW_EPS 0.004. A depth buffer
    // does not store distance, it stores 1/distance, so what those lifts are worth collapses as
    // 1/f². Measured on a 24-bit buffer at near 0.06 / far 400, in depth-buffer units:
    //
    //     tiles      road 0.002   shadow 0.004   surface 0.0008
    //         4          126           251             50
    //        10           20            40              8
    //        20            5             10              2
    //        40            1.3            2.5            0.5
    //        80            0.3            0.6            0.1
    //
    // Under about one unit the test cannot tell the quad from the floor it lies on, so the road
    // and the shadows z-fight — which reads as the road blinking between light levels and shadows
    // coming and going. It never showed from a cab, where the road in front of you is five to
    // thirty tiles out; it shows the moment the external view zooms back, because that pushes the
    // whole scene further away and every lift in the ladder is worth less.
    //
    // A polygon offset is the fix rather than a bigger number: it biases in DEPTH-BUFFER units and
    // scales with the polygon's own slope, so it is worth the same at four tiles and at eighty, and
    // a ground plane seen nearly edge-on — the case that fails hardest — is exactly the case the
    // slope term is for. ⚠ The ladder stays: it still orders these surfaces AGAINST EACH OTHER,
    // where they are all at the same distance and the lift is still meaningful. This only settles
    // the whole layer against the floor underneath it.
    // ⚠ And it works because these quads let the rasteriser interpolate their depth. Polygon offset
    // is ignored for a shader that writes gl_FragDepth, which the floor does — so the floor keeps
    // its own exact depth and the layer above is biased toward the eye off it.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    // ⚠ UNITS ONLY, FACTOR ZERO, AND THE FACTOR IS THE DANGEROUS HALF. A polygon offset is
    // factor·slope + units·resolution, and the slope of a ground plane seen nearly EDGE ON — a cab
    // at kerb height, an apron running to the horizon — is enormous. A factor of −1 there is not a
    // hair of bias, it is a large one, and a large bias toward the eye can carry the paving in
    // front of the building standing on it.
    // The units term is what this actually needs: a constant number of DEPTH-BUFFER steps, which is
    // already resolution-independent and is the whole reason a polygon offset beats a world lift.
    // Four steps is comfortably more than the 0.3 the eps ladder is worth at eighty tiles, and
    // cannot grow with the angle.
    // ⚠ A KNOB, BECAUSE THE FOUR WAS A CALCULATION AND THE CAB DISAGREED WITH IT. The reasoning
    // above prices four depth-buffer steps against what the eps ladder is worth at eighty tiles,
    // and it is sound at altitude. Reported from a truck cab: the whole ground layer — tile fills,
    // kerbs AND lane markings — lost to the floor and the driver saw terrain green everywhere,
    // while the same city from an external camera was perfect. Both views report floor 1 and ~2500
    // ground quads, so the quads are built and drawn; they are simply not winning.
    //
    // ⚠ WHY A CAB IS THE HARD CASE. The floor recovers its depth from f = EH / p, and EH is the
    // EYE HEIGHT: a cab sits at 0.24 tiles, so the entire road compresses into a few screen rows
    // near the horizon and d gets very large very fast. A fixed number of steps that is generous
    // at an aeroplane s eye height is not obviously generous at a fifth of a tile.
    gl.polygonOffset(0, opts.groundBias != null ? opts.groundBias : -4);
    gl.depthMask(true);         // the road is a surface — see the ⚠ at the top
    gl.disable(gl.CULL_FACE);   // a road is looked at from above and from a cab at kerb height
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.uniform1f(loc.surface, 1);
    if (splitA) { gl.depthMask(true); gl.drawArrays(gl.TRIANGLES, 0, splitA); }
    gl.depthMask(false);
    // The markings, source-over on the surface they are painted on — still a surface as far as the
    // wetness and the reflections are concerned, so uSurface stays 1.
    if (splitP > splitA) gl.drawArrays(gl.TRIANGLES, splitA, splitP - splitA);
    if (splitB > splitP) {
      // ⚠ ADDITIVE, AND THE ALPHA RIDES ALONG. The fragment output is premultiplied, so under
      // ONE/ONE the colour adds and so does the coverage — which it has to, because this buffer is
      // BLITTED source-over onto the 2-D frame and a pool of light over open ground would
      // otherwise composite onto nothing and vanish. Same compromise the Curtain makes.
      gl.blendFunc(gl.ONE, gl.ONE);
      // The pool of light is not a surface — see the ⚠ on uSurface.
      gl.uniform1f(loc.surface, 0);
      gl.drawArrays(gl.TRIANGLES, splitP, splitB - splitP);
      gl.uniform1f(loc.surface, 1);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (count > splitB) gl.drawArrays(gl.TRIANGLES, splitB, count - splitB);
    gl.depthMask(true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    return count / 6;
  }

  return { upload, draw, get quads() { return count / 6; } };
}
