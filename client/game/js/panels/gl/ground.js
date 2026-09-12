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
// `stripeA`, the helper behind every road surface, pavement, lane line and dash, at roughly 12,000
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

// pos3, colour3
const STRIDE = 7;   // pos3, colour3, alpha1
// ⚠ THE SAME SIX AS THE SHADER'S OWN MAX_WET, AND THEY HAVE TO AGREE. The GLSL one is inside a
// template literal and cannot be read from here, so this is the second copy — the shader would
// accept a longer array and silently ignore the tail, which is a reflection that is there on one
// machine and missing on another. Kept adjacent so a change to one is a visible diff on both.
const MAX_WET = 6;
const WET_P = new Float32Array(MAX_WET * 3);
const WET_C = new Float32Array(MAX_WET * 3);
const WET_R = new Float32Array(MAX_WET);
const EMPTY_WET = [];

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aColor;
in float aAlpha;
uniform mat4 uViewProj;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
uniform float uHazeNear;
uniform float uHazeFar;
out vec3 vColor;
out float vFog;
out float vAlpha;
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
  vAlpha = aAlpha * (uHazeFar > uHazeNear ? 1.0 - smoothstep(uHazeNear, uHazeFar, clip.w) : 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFog;
in float vAlpha;
in vec3 vWorld;
uniform vec3 uFog;

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
uniform int   uNWet;
uniform vec3  uWetP[MAX_WET];   // light ground point xy + its height
uniform vec3  uWetC[MAX_WET];   // colour, 0-1
uniform float uWetR[MAX_WET];   // reach in tiles
uniform float uWet;             // how wet the ground is, 0-1
uniform vec2  uEye;             // the camera's ground point, in vWorld's frame
uniform float uEyeH;            // and how high it is — see the Fresnel gate on the reflections
uniform vec2  uWc;              // window centre in WORLD tiles, so a puddle stays on its bit of road

out vec4 outColor;
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 c = mix(vColor, uFog, vFog);
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
  float pud = 0.0;
  if (uWet > 0.001) {
    vec2 pw = (vWorld.xy + uWc) * 0.9;
    // Two octaves of cheap value noise. Enough for a hollow to have a shape rather than be a disc,
    // and not enough to read as a texture.
    float nA = sin(pw.x * 1.7 + sin(pw.y * 1.3) * 1.9) * sin(pw.y * 1.5 + sin(pw.x * 1.1) * 1.7);
    float nB = sin(pw.x * 4.1 + 2.0) * sin(pw.y * 3.7 - 1.0);
    float hollow = nA * 0.68 + nB * 0.32;          // -1..1, low ground is high here
    float level = mix(0.92, 0.05, uWet);
    pud = smoothstep(level, level + 0.30, hollow);
  }
  // ⚠ TWO NUMBERS OUT OF ONE FIELD, because a road in the rain is not dry between its puddles. The
  // whole surface is damp and darker; what the hollows add is STANDING water, which is a different
  // thing optically — damp tarmac scatters, a puddle mirrors. So the darkening is mostly there
  // everywhere and the REFLECTION is almost entirely in the hollows, which is what puts the neon in
  // the puddles rather than smeared evenly down the street.
  float damp   = uWet * mix(0.40, 1.00, pud);
  float mirror = uWet * mix(0.08, 1.00, pud);
  if (damp > 0.001) {
    // ⚠ 0.45 AND mix(0.40, 1.00) TOGETHER ARE THE PUDDLE'S CONTRAST AGAINST THE ROAD AROUND IT,
    // and the first pair (0.38 over mix(0.55, 1.00)) was 21% — enough to measure and not enough to
    // look at, a soft mottle rather than standing water. This is 33%: tarmac between the puddles at
    // 0.82 of dry, the puddles themselves at 0.55.
    c *= 1.0 - 0.45 * damp;
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
  float refl = 0.0;
  if (mirror > 0.001 && uNWet > 0) {
    float dEye = length(vWorld.xy - uEye);
    float cosI = uEyeH / max(0.001, sqrt(dEye * dEye + uEyeH * uEyeH));
    refl = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
  }
  if (refl > 0.01) {
    vec3 add = vec3(0.0);
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
    // ⚠ 'mirror', NOT 'uWet' — a reflection belongs in the standing water. Scaled by the global
    // wetness it put neon on the damp tarmac between the puddles as strongly as in them, which is
    // the flat even smear the puddles exist to replace.
    c += add * (mirror * 4.5 * refl) * max(vec3(0.0), 1.0 - c);
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
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    nWet: gl.getUniformLocation(prog, 'uNWet'),
    wetP: gl.getUniformLocation(prog, 'uWetP'),
    wetC: gl.getUniformLocation(prog, 'uWetC'),
    wetR: gl.getUniformLocation(prog, 'uWetR'),
    wet: gl.getUniformLocation(prog, 'uWet'),
    eye: gl.getUniformLocation(prog, 'uEye'),
    eyeH: gl.getUniformLocation(prog, 'uEyeH'),
    wc: gl.getUniformLocation(prog, 'uWc'),
    hazeNear: gl.getUniformLocation(prog, 'uHazeNear'),
    hazeFar: gl.getUniformLocation(prog, 'uHazeFar'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  let count = 0, splitA = 0, splitB = 0;

  const tris = (list) => list.reduce((n, q) => n + (q.p.length - 2) * 3, 0);

  // ⚠ FILLED STRAIGHT INTO THE TYPED ARRAY. The mass rebuild cost 11.1 ms until it stopped building
  // plain arrays and converting them; at twelve thousand quads a frame this path cannot afford that
  // mistake a second time.
  // ⚠ THREE RANGES, NOT ONE LIST, AND THE ORDER IS THE CANVAS'S. Everything here shares the ground
  // plane, so what separates them is not depth but what they DO to what is already there:
  //
  //   base — the road SURFACE, which writes depth because it is a surface
  //   add  — a headlight pool, which is light landing on that surface ('lighter' on the canvas)
  //   over — a shadow, which is translucent dark laid on top of both
  //
  // Base first, then light, then shadow, is exactly the sequence the 2-D pass paints in:
  // drawGroundSurfaces, drawHeadlightBeam, then the shadows the building loop casts. Get it
  // backwards and a building's shadow stops falling across the beam.
  // Only the base writes depth: a translucent quad that wrote it would let its own dark alpha
  // occlude whatever else shares its plane.
  function upload(quads) {
    const base = [], add = [], over = [];
    for (const q of quads) (q.add ? add : q.over ? over : base).push(q);
    quads = base.concat(add, over);
    splitA = tris(base);
    splitB = splitA + tris(add);
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
      const r = c ? c[0] / 255 : 0, g = c ? c[1] / 255 : 0, b = c ? c[2] / 255 : 0;
      const put = (v, i) => {
        const k = cs && cs[i];
        data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2];
        data[o + 3] = k ? k[0] / 255 : r; data[o + 4] = k ? k[1] / 255 : g; data[o + 5] = k ? k[2] / 255 : b;
        data[o + 6] = qa; o += STRIDE;
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
    bind(loc.pos, 3, 0); bind(loc.color, 3, 12); bind(loc.alpha, 1, 24);
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
    gl.polygonOffset(0, -4);
    gl.depthMask(true);         // the road is a surface — see the ⚠ at the top
    gl.disable(gl.CULL_FACE);   // a road is looked at from above and from a cab at kerb height
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    if (splitA) { gl.depthMask(true); gl.drawArrays(gl.TRIANGLES, 0, splitA); }
    gl.depthMask(false);
    if (splitB > splitA) {
      // ⚠ ADDITIVE, AND THE ALPHA RIDES ALONG. The fragment output is premultiplied, so under
      // ONE/ONE the colour adds and so does the coverage — which it has to, because this buffer is
      // BLITTED source-over onto the 2-D frame and a pool of light over open ground would
      // otherwise composite onto nothing and vanish. Same compromise the Curtain makes.
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, splitA, splitB - splitA);
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
