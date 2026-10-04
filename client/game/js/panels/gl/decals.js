// SIGNAGE, ON THE DEPTH BUFFER.
//
// A marquee is not mass and it is not a light. It is ARTWORK on a rectangle: a backing board, a
// lit face, a frame, a row of bulbs and lettering — painted with a canvas, in 2-D, and then mapped
// onto the sign's real projected quad so it shears with the wall it is bolted to.
//
// ⚠ AND THAT IS WHY IT SHOWS THROUGH BUILDINGS NOW. The 2-D renderer buried a sign behind whatever
// stood in front of it by painting the building's faces afterwards, in the same queue. With the
// city's mass on the GPU it is composited BEFORE the 2-D pass runs, so nothing can paint over a
// sign any more. The probe that is supposed to catch this (`decoHidden`) answers a PER-SURFACE
// question — is this whole board behind something — and a sign half behind a tower is the case
// that matters and the case it deliberately answers "draw" to. Its own comment says so.
//
// So the artwork goes on a quad on the GPU, depth-TESTED against the mass and writing no depth of
// its own. The tower in front hides the half of the board behind it, per pixel, and the half that
// clears it still reads. No lift, no bias, no probe.
//
// ⚠ THE ARTWORK IS STILL PAINTED BY THE 2-D CODE. Nothing here knows what a marquee looks like:
// the caller bakes the sign into a canvas exactly as `bakeSignText` already bakes lettering, hands
// it over with four world corners, and this uploads it once and draws it. That is what keeps one
// renderer's idea of a sign and the other's from drifting — there is only one idea of a sign.
//
// ⚠ AND A FEW OF THESE QUADS ARE THE SURFACE RATHER THAN THE PAINT ON ONE — see `solid`, and
// RENDER_TUNE.glBoardDepth. "A sign is on a wall, not a wall" is true of every decal but the
// per-tile board: `emitFlat`'s `paint` path sends a hoarding's own slab, legs, frame and trim here
// because a board carrying `$name` has no single appearance to capture into a per-model mesh. That
// board is not on a wall — it stands on legs against the sky — so with this layer writing no depth
// there was nothing in the buffer where it stands, and the CLOUD deck, which clears colour only and
// tests against what the world left, drew straight through it. Reported exactly that way: the
// clouds appear through the billboards.
//
// ⚠ IT IS A DEPTH-ONLY PREPASS, THE ONE billboards.js ALREADY USES, AND FOR THE SAME REASON. The
// obvious version writes depth in the one draw, which changes the ORDER this layer composites in
// (a board would then hide the lettering of a sign batched before it) and deletes every
// antialiased edge texel between the two cuts from the picture. So the colour pass is byte-for-byte
// the one that always shipped, and a second draw with `colorMask` off lays the board's silhouette
// into the depth buffer ahead of it. With no batch asking, the prepass is the absence of a code path.
import { viewProjMatrix, mat4f, eyePos } from './camera.js';
import { makeVertexStream } from './stream.js';
import { createArena } from './retain.js';
import { declareProgram, takeWarm } from './programs.js';

// pos3, uv2, alpha1, emit1, seed1
const STRIDE = 12;
// What alpha counts as the BOARD rather than as its edge, in the depth-only prepass. A `solid` decal
// is one flat fill, so its interior is 1 and only the rim is between — but `vAlpha` carries the
// world's own distance fade, and a board fading out at the edge of the window must stop writing
// depth with it or a cloud is occluded by a building nobody can see. The colour cut is the literal
// this shader has always discarded at, so the colour pass is unchanged.
const DEPTH_CUT = 0.5;
const COLOUR_CUT = 0.002;
// ── ⚠ THE CAP HAS TO CLEAR THE WORKING SET OR IT IS NOT A CACHE ─────────────────────────────────
//
// It was 192, sized when a decal meant a SIGN — a few dozen baked name boards, each a real canvas.
// It does not mean that any more: `emitDecoFill` files every flat coloured quad in the city here,
// keyed on its own CSS string, and the derived kit put trim, plinths, crown courses, window bands,
// pilaster ranks and recessed bays on most of the registry. Measured from a cab in Halcyon Fields,
// one frame wanted **426 distinct textures** — and the tell that it was pathological rather than
// merely large is that `batches` and `textures` came back EQUAL, at every district over the cap:
// the cache held exactly this frame's set and nothing else, because `evict` had deleted everything
// the previous frame had left in it.
//
// That is the worst state a cache can be in. Every frame it deleted ~230 textures and immediately
// re-created them with a `texImage2D` apiece, for artwork that had not changed — the cost of a
// cache with none of the benefit, and it grows with how much trim the city gains.
//
// ⚠ AND IT COSTS ALMOST NOTHING TO FIX, WHICH IS WHY THE NUMBER IS THIS MUCH BIGGER RATHER THAN A
// LITTLE. The overwhelming majority of these are `solidTex` at **8×8** and `rampTex` at **4×32** —
// 256 and 512 bytes — so a thousand of them is well under a megabyte, against the 156 MB a single
// GL scene already holds. The cap is here to stop an unbounded key (a colour that slides with the
// clock, a camera term in a key) eating the machine, and it still does that job at 1024; what it
// must not do is throw away artwork the very next frame is going to ask for again.
let MAX_TEX = 1024;
// ── AND A WAY TO PROVE IT, BECAUSE THE STOPWATCH CANNOT ─────────────────────
//
// The cap is a module constant rather than a `RENDER_TUNE` knob, so there is nothing to A/B it
// with — and a frame time on this renderer swings further than the change is worth, which is how a
// real fix gets reverted for looking like noise. `minted` is the deterministic quantity: how many
// textures this layer had to CREATE this frame. At a cap under the working set it is hundreds
// every frame for ever; at a cap over it, it is hundreds on the first frame and **zero** after.
// That is the whole claim, and it is a count rather than a duration.
let MINTED = 0;
if (typeof window !== 'undefined') window.__decalCap = (n) => { if (n) MAX_TEX = n; return MAX_TEX; };
// A tally of decal keys by producer prefix, filled only while somebody is asking. See the census
// block in `upload`. `__decalCensus()` starts one and returns the last, so a console can read it
// without the layer carrying a per-frame allocation for everybody else.
let KEYCENSUS = null;
if (typeof window !== 'undefined') {
  window.__decalCensus = (on = true) => {
    const was = KEYCENSUS;
    KEYCENSUS = on ? {} : null;
    return was && Object.entries(was).sort((a, b) => b[1] - a[1]);
  };
}

// How many lights lit cloth takes. The strongest few of the frame's list, in its order.
const LIT_MAX = 12;
const VERT = `#version 300 es
in vec3 aPos;
in vec2 aUV;
in float aAlpha;
in float aEmit;
in float aSeed;
// The pull toward the eye, done here (Stage 3 phase 3 of glass-headroom): the whole quad scales about
// the eye by 1 - min(0.5, pull / depth of its centroid), which is unprojQuad's square pull (depth is
// affine, so the centroid's depth is the corners' mean). aPull 0 means aPos arrives already pulled.
in vec3 aCen;
in float aPull;
uniform vec3 uEye;
uniform mat4 uViewProj;
out vec2 vUV;
out float vAlpha;
out float vEmit;
out vec3 vWorld;
flat out float vSeed;
void main() {
  vSeed = aSeed;
  vec3 P = aPos;
  if (aPull > 0.0) {
    float fm = (uViewProj * vec4(aCen, 1.0)).w;
    P = uEye + (aPos - uEye) * (1.0 - min(0.5, aPull / fm));
  }
  vWorld = P;
  gl_Position = uViewProj * vec4(P, 1.0);
  vUV = aUV;
  vAlpha = aAlpha;
  vEmit = aEmit;
}`;

const FRAG = `#version 300 es
precision highp float;
#define LIT_MAX ${LIT_MAX}
in vec2 vUV;
in float vAlpha;
in float vEmit;
in vec3 vWorld;
flat in float vSeed;
uniform sampler2D uTex;
// Lit cloth (vEmit < 0) — see LIT_MAX and the ⚠ in main.
uniform int uLitN;
uniform float uLitGain;
uniform vec3 uLitP[LIT_MAX];
uniform vec3 uLitC[LIT_MAX];
uniform float uLitR[LIT_MAX];
uniform float uTube;
uniform float uFlick;
uniform float uTime;
uniform float uCull;
uniform float uFlip;
uniform float uEmitGain;
uniform float uCut;
out vec4 outColor;
// ── NEON TUBES ────────────────────────────────────────────────────────────────────────────────
//
// A lit sign's lettering arrives as an OPAQUE stroke inside a translucent coloured halo, and that
// stroke is the tube. The shader recovers the tube's cross-section from the stroke itself: a small
// blur of its coverage is a height, the height's gradient is a normal across the tube, and a glass
// cylinder lit from above is shaded off that normal. Nothing about the bake changes and nothing
// new is uploaded.
//
// What a real tube looks like, and what each term is for: the gas fills the bore, so the body is
// an even SATURATED colour; a camera overexposes the middle of it toward white; the glass curves
// away at the edges, so the rim is darker and more saturated; and the glass reflects the sky as one
// thin specular line along the top of the bend. That line is what makes it read as a tube rather
// than a stroke.
float nh(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float coreAt(vec2 uv) {
  // ⚠ COVERAGE, NOT WHITENESS. The bake's three passes describe a white core, and by the time the
  // canvas is uploaded it is not white: measured over the 39 lit signs in one Coldwater frame, the
  // opaque stroke is one flat colour (its whitest channel anywhere from 0.06 to 0.95) and only the
  // halo is translucent. A whiteness test found no tube on any of them. Alpha tells stroke from
  // halo on every sign whatever its colour.
  // ⚠ AND LEVEL 0, NEVER THE MIP CHAIN. At street distance a sign is minified several levels and
  // each level above 0 averages the stroke into its halo, so the edge the gradient needs is gone.
  // How far level 0 then aliases is what the fade in main is for.
  return smoothstep(0.70, 0.98, textureLod(uTex, uv, 0.0).a);
}
// ⚠ FLICKER IS PER SIGN AND PER SECTION, AND IT IS SLOW ON PURPOSE. A failing tube stutters: gas
// leaking or a worn electrode drops a section out for a moment and it strikes again. About a fifth
// of signs are "faulty"; of those some lose the whole sign (a tired transformer) and the rest lose
// one section (one letter's tube). A burst is under a second and at most five states a second,
// under the WCAG three-flash line, and it DIMS rather than blacking out, because this game holds
// to no strobe at any rate. Everything else gets a shimmer too small to name.
float neonFlicker(float seed, float seg, float t) {
  // A slow breath on every sign: gas under a ballast is never quite steady. A few per cent, under
  // one cycle a second, each sign on its own phase. No strobe.
  float f = 0.94 + 0.06 * sin(t * (2.2 + nh(seed * 4.3) * 1.6) + seed * 50.0);
  // Faults are PER LETTER, never the whole sign: about a quarter of signs carry one or two tired
  // sections, each stuttering on its own clock.
  if (nh(seed * 3.1) > 0.75) {
    float sa = floor(nh(seed * 7.7) * 12.0), sb = floor(nh(seed * 8.9) * 12.0);
    if (seg == sa || (nh(seed * 5.3) > 0.6 && seg == sb)) {
      float s2 = seed + seg * 0.37;
      float P = 5.0 + 11.0 * nh(s2 * 9.1);
      float tt = t + s2 * 37.0;
      float cyc = floor(tt / P);
      float ph = tt - cyc * P;
      float burst = 0.3 + 1.2 * nh(s2 * 2.9 + cyc);
      if (ph < burst) {
        float on = step(0.45, nh(floor(ph * 5.0) + s2 * 11.0 + cyc * 3.0));
        f *= mix(0.12, 1.0, on);
      }
    }
  }
  return mix(1.0, f, uFlick);
}
void main() {
  // ⚠ A SIGN HAS A FRONT. Lettering is PAINT ON A SURFACE, and paint does not read from behind the
  // thing it is painted on — but a textured quad drawn two-sided does, mirrored, and it glows
  // through its own board like printing on glass. Voltage's roof sign read "ƎƆATJOV" from the back
  // of its own building. What belongs there is whatever the paint is on, which is already drawn and
  // already opaque: the board is in the mesh, the wall is in the mesh, a per-tile board is a flat
  // decal of its own. So the lettering simply stops at the surface and the surface answers.
  //
  // ⚠ AND THE FRONT OF A SIGN IS gl_FrontFacing == FALSE. The quads arrive as TL,TR,BR,BL — a sign's
  // own reading order — which walks clockwise in NDC when the sign faces the camera, and clockwise
  // is the BACK face under the default CCW winding. Nothing is culled by the pipeline (these are
  // two-sided by default and CULL_FACE stays off), so this is the one place that polarity is
  // decided; it is stated here rather than inferred, because inverting it hides every sign in the
  // city and shows only the ones you are behind.
  //
  // ⚠ AND A MIRROR REVERSES THAT POLARITY, WHICH IS WHY IT IS A UNIFORM AND NOT A LITERAL. The
  // puddle pass renders the world reflected about the water's plane; the reflection matrix has
  // determinant −1, so every quad's winding flips and the test above selects the exact complement —
  // the reflection would hold only the signs facing AWAY from you, mirrored, which is the
  // "ƎƆATJOV" bug a second time and in a surface where nobody would think to read it.
  if (uCull > 0.5 && gl_FrontFacing != (uFlip > 0.5)) discard;
  // The texture is uploaded PREMULTIPLIED, so scaling by alpha is one multiply and the blend is
  // the canvas's own (ONE, ONE_MINUS_SRC_ALPHA).
  vec4 t = texture(uTex, vUV) * vAlpha;
  // A sign's canvas is mostly empty; do not pay to blend nothing. 'uCut' is COLOUR_CUT in the
  // ordinary pass — the literal this line has always held — and DEPTH_CUT in the depth-only prepass.
  if (t.a < uCut) discard;
  // ── ⚠ CLOTH CATCHES THE CITY'S LIGHTS ───────────────────────────────────────────────────────
  // A tarp is the surface, not paint on one, so it takes the same lamps the walls do. Its colour
  // already carries the sun and the night (slumTone), so the lamps ADD onto the albedo. A sheet is
  // thin and seen from both sides, so the cosine is two-sided and wrapped: light on the far face of
  // a tent still comes through it, which is what a lamp inside one looks like.
  if (vEmit < -0.5) {
    vec3 add = vec3(0.0);
    if (uLitN > 0) {
      vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
      for (int i = 0; i < LIT_MAX; i++) {
        if (i >= uLitN) break;
        vec3 d = uLitP[i] - vWorld;
        float dist = length(d);
        float att = clamp(1.0 - dist / max(0.001, uLitR[i]), 0.0, 1.0);
        if (att <= 0.0) continue;
        float diff = (abs(dot(n, d / max(0.001, dist))) + 0.4) / 1.4;
        add += uLitC[i] * (att * att * diff);
      }
    }
    outColor = vec4(t.rgb * (1.0 + add * uLitGain), t.a);
    return;
  }
  // ── ⚠ AND THIS IS THE CITY'S ONE REAL EMITTER ───────────────────────────────────────────────
  //
  // The bloom chain has been built, wired, gated and measured for months and has never found a
  // thing, because GLASS produces no light brighter than white: every shader in it was written
  // against an 8-bit target and saturates by construction, so 'peak()' on the float buffer reads
  // 1.016 on a night street and a bright-pass at 1.0 has nothing to select. The note on
  // RENDER_TUNE.glHdr says exactly what unparks it — "a sign authored as brighter than white
  // rather than scaled into it" — and this is that sign.
  //
  // ⚠ RGB ONLY, NEVER THE ALPHA. The texture is premultiplied and the blend is (ONE,
  // ONE_MINUS_SRC_ALPHA), so scaling the colour alone raises how much light the sign puts out and
  // leaves its COVERAGE exactly where it was: the glass tube is still the same shape and the dark
  // board around it still occludes the same pixels. Scale the alpha too and the sign grows.
  // ⚠ AND IT IS PER-VERTEX, NOT A UNIFORM ON THE WHOLE LAYER. A stencilled bay number, a price
  // board and a stone frieze go through here as well as a neon box, and painted lettering does not
  // emit — see EMISSIVE_GAIN in world.js for what happens when a bloom cannot tell the two apart.
  // ⚠ 'vEmit' IS 0..1 EMISSIVENESS AND 0 IS PAINT, so the multiplier is exactly 1 for every
  // producer that has never heard of this — which is all of them but one. Spelling it the other way
  // round (1 means paint, higher means brighter) was the first cut and it puts the no-op at a
  // non-zero default, where a dropped field reads as a sign that does not light up.
  vec3 rgb = t.rgb;
  if (vEmit > 0.001 && uTube + uFlick > 0.001) {
    vec2 ts = vec2(textureSize(uTex, 0));
    vec2 px = 1.0 / ts;
    float seg = floor((ts.y > ts.x ? vUV.y : vUV.x) * 12.0);   // about a letter a section
    float fl = neonFlicker(vSeed, seg, uTime);
    // How many level-0 texels one screen pixel covers. The taps step by at least that, so the
    // gradient is taken across the tube rather than inside one texel, and past about four the tube
    // is under two pixels across: its shading is invisible and level-0 taps only buy shimmer, so the
    // tube fades out there and the sign is drawn as it always was. Flicker is kept at every range.
    vec2 fw = fwidth(vUV * ts);
    float foot = max(max(fw.x, fw.y), 1.0);
    float near = 1.0 - smoothstep(4.0, 8.0, foot);
    // ⚠ A ROUND PROFILE NEEDS A BLUR WIDER THAN THE EDGE. Coverage is flat across the stroke, so a
    // narrow blur gives a plateau with a step at each side: a flat ribbon with bevelled edges, which
    // is not a tube. Two rings at about a quarter and a half of the stroke's width (the bake's
    // tube, halo pass included, is about nine texels across on the 72-texel cell) rise all the way to the middle, so the
    // height peaks on the centre line where the hot core and the specular belong. The gradient comes
    // off the same sixteen taps, so the normal costs nothing more.
    float Hc = coreAt(vUV);
    float H = Hc * 0.2; vec2 grad = vec2(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854;
      vec2 d = vec2(cos(a), sin(a));
      float c1 = coreAt(vUV + d * px * 1.4 * foot);
      float c2 = coreAt(vUV + d * px * 2.8 * foot);
      H += c1 * 0.06 + c2 * 0.04;
      grad += d * (c1 + c2 * 0.5);
    }
    // The sign is BAKED as tube now (bakeSignText bends it round each letter's outline), so the
    // opaque stroke IS the glass and this only has to shade it as a cylinder: the blurred coverage
    // peaks on the tube's axis, its gradient is the normal across it, and the hot line, the
    // coloured glass and the darker walls follow from that.
    H *= Hc;
    // ⚠ A TUBE IS THIN, AND COVERAGE ALONE CANNOT SAY SO. An opaque board (every marquee panel is
    // opaque, see marqueeBand) is alpha 1 edge to edge, so without this every texel of it read as the
    // axis of one enormous tube and the whole board went white-hot — Reel Estate's fascia at night.
    // A stroke is empty on BOTH sides of it along some direction; a board interior is full on both
    // and a board edge is empty on one side only, so neither passes.
    float thin = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 0.7854;
      vec2 d = vec2(cos(a), sin(a)) * px * 6.0 * foot;
      thin = max(thin, (1.0 - coreAt(vUV + d)) * (1.0 - coreAt(vUV - d)));
    }
    float body = smoothstep(0.05, 0.45, H) * smoothstep(0.25, 0.75, thin) * uTube * near;
    if (body > 0.0) {
      vec4 cs = textureLod(uTex, vUV, 0.0);
      vec3 hue = cs.a > 0.01 ? cs.rgb / cs.a : vec3(1.0);
      // The baked axis is white and carries no hue, so take the colour from beside it.
      vec4 side = textureLod(uTex, vUV + normalize(grad + 1e-5) * px * 3.0 * foot, 0.0);
      vec3 sh2 = side.a > 0.01 ? side.rgb / side.a : hue;
      float sat = max(sh2.r, max(sh2.g, sh2.b)) - min(sh2.r, min(sh2.g, sh2.b));
      hue = sat > 0.15 ? sh2 : hue;
      hue /= max(max(hue.r, max(hue.g, hue.b)), 1e-3);
      // uv v runs DOWN the sign, so the light (from above) is toward -v.
      vec3 n = normalize(vec3(-grad * 0.22, 0.55));
      vec3 L = normalize(vec3(0.15, -0.65, 0.75));
      float diff = clamp(dot(n, L), 0.0, 1.0);
      float spec = pow(clamp(reflect(-L, n).z, 0.0, 1.0), 28.0);
      float rim = 1.0 - n.z;
      // Lit glass: the gas colour through a cylinder — darker at the walls where the light crosses
      // more glass, a warm hot line on the axis, and a thin Fresnel glint at each edge.
      vec3 litT = mix(hue * (0.55 + 0.45 * diff), hue * 0.5 + 0.5, smoothstep(0.90, 1.0, H) * 0.40);
      litT = litT * (1.0 - 0.75 * rim) + vec3(0.9) * pow(rim, 3.0) * 0.25;
      // ⚠ AN OUT SECTION IS STILL A TUBE. Going near-black left a hole the shape of a letter; real
      // dead neon is pale tinted glass with the street reflected in it, so it keeps its edges.
      vec3 deadT = hue * 0.10 + vec3(0.07) + vec3(0.45) * pow(rim, 2.0) * 0.5;
      vec3 tube = mix(deadT, litT, fl);
      rgb = mix(rgb, tube * t.a, body) + vec3(spec * 0.6 * body) * t.a;
    } else {
      // The halo round a tube goes with it when it drops out.
      rgb *= fl * (1.0 - 0.3 * uTube * near);
    }
    // ── THE TUBES STAND OFF THE BOARD ─────────────────────────────────────────────────────────
    // A neon sign is glass bent on stand-offs a few centimetres proud of its backing, so the
    // lettering throws a shadow onto the board behind it, down and away from the light above. The
    // shadow is the tube's own coverage sampled back up toward the light, laid only where there
    // is no tube, and it DARKENS AND COVERS (alpha goes up), so it lands on the wall or board under
    // the halo rather than just dimming the halo. Past the fade the offset would be sub-pixel and
    // it goes with the tube shading.
    float sh = coreAt(vUV + vec2(-1.2, -3.2) * px * max(foot, 1.0) * 2.0);
    float shA = sh * (1.0 - smoothstep(0.02, 0.2, H)) * (1.0 - Hc) * 0.6 * uTube * near;
    vec3 lit = rgb * (1.0 - shA);
    outColor = vec4(lit * (1.0 + vEmit * uEmitGain * fl), t.a + shA * (1.0 - t.a));
    return;
  }
  outColor = vec4(rgb * (1.0 + vEmit * uEmitGain), t.a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' decal shader: ' + log);
  }
  return sh;
}

// A decal is `{ key, img, alpha, p: [TL, TR, BR, BL] }` — a cache key for the artwork, the canvas
// it was baked into, the fade the world pass computed, and four WORLD points in the same
// camera-relative tile frame the lights and the Curtain use. `solid` says this quad IS the surface
// rather than paint on one, and is the only thing here that writes depth.
const SEEDS = new Map();
function keySeed(key) {
  let v = SEEDS.get(key);
  if (v === undefined) {
    const k = String(key); let h = 2166136261;
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
    v = ((h >>> 0) % 100003) / 1000.03;
    if (SEEDS.size > 4096) SEEDS.clear();
    SEEDS.set(key, v);
  }
  return v;
}
export function createDecalLayer(gl) {
  // Prewarmed with the context when it can be (programs.js); built here otherwise.
  let prog = takeWarm(gl, VERT, FRAG);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('decal link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    emit: gl.getAttribLocation(prog, 'aEmit'),
    seed: gl.getAttribLocation(prog, 'aSeed'),
    cen: gl.getAttribLocation(prog, 'aCen'),
    pullA: gl.getAttribLocation(prog, 'aPull'),
    eye: gl.getUniformLocation(prog, 'uEye'),
    tube: gl.getUniformLocation(prog, 'uTube'),
    flick: gl.getUniformLocation(prog, 'uFlick'),
    time: gl.getUniformLocation(prog, 'uTime'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    tex: gl.getUniformLocation(prog, 'uTex'),
    cull: gl.getUniformLocation(prog, 'uCull'),
    flip: gl.getUniformLocation(prog, 'uFlip'),
    emitGain: gl.getUniformLocation(prog, 'uEmitGain'),
    cut: gl.getUniformLocation(prog, 'uCut'),
    litN: gl.getUniformLocation(prog, 'uLitN'),
    litGain: gl.getUniformLocation(prog, 'uLitGain'),
    litP: gl.getUniformLocation(prog, 'uLitP'),
    litC: gl.getUniformLocation(prog, 'uLitC'),
    litR: gl.getUniformLocation(prog, 'uLitR'),
  };
  const litP = new Float32Array(LIT_MAX * 3), litC = new Float32Array(LIT_MAX * 3), litR = new Float32Array(LIT_MAX);

  const vao = gl.createVertexArray();
  // One stream, set up once: the attribute pointers are recorded into the VAO here and never
  // touched again, and the storage grows by doubling instead of being reallocated every frame.
  // See gl/stream.js.
  const ATTRS = [[loc.pos, 3, 0], [loc.uv, 2, 12], [loc.alpha, 1, 20], [loc.emit, 1, 24], [loc.seed, 1, 28], [loc.cen, 3, 32], [loc.pullA, 1, 44]];
  let keptLive = [];
  const stream = makeVertexStream(gl, vao, STRIDE, ATTRS, 1024);
  let data = new Float32Array(0);
  const texes = new Map();          // key → WebGLTexture
  let batches = [];                 // { tex, first, count, cull, solid }

  // ⚠ EVICTION HAPPENS HERE, BEFORE ANYTHING IS ALLOCATED, AND NEVER TOUCHES A KEY THIS FRAME
  // USES — the same rule as billboards.js, ported 2026-09-17 because this layer still had the
  // version that file was written to replace. It used to sit inside `textureFor`, taking
  // `texes.entries().next().value` — the oldest-INSERTED entry, which is exactly the wrong one. The
  // oldest entries are the STABLE keys: the name board every branch of a chain shares, the lettering
  // repeated down a terrace. And `textureFor` is called from the batch loop below, so by the time a
  // later key needs room those textures are already sitting in `batches` waiting to be drawn.
  // Deleting one leaves its batch pointing at a dead texture, and a dead texture samples as whatever
  // the driver hands back — which is how the same mistake was reported in the billboard layer, as
  // the scatter turning bright pink and a gate drawn as a hovering bush.
  //
  // ⚠ THE LIVE SET IS KEYED ON THE TEXTURE, NOT ON THE GROUP, and copying billboards.js literally
  // gets this wrong. `byKey` is keyed on `(cull ? 'B:' : 'F:') + key` while the cache is keyed on
  // `key` alone, so testing a grouping key against `texes` finds NOTHING live and deletes the lot —
  // the original bug back again, wearing the fix's clothes. Two groups can also share one texture
  // (the same artwork culled and unculled), so the live set is the smaller of the two.
  //
  // ⚠ A frame carrying more than MAX_TEX distinct textures overshoots the cap rather than dropping
  // one it needs, exactly as the billboard layer does — the cache comes back down on the next frame
  // that draws fewer. That is the safe direction, an overshoot against a decal drawn with somebody
  // else's artwork, and the two layers agreeing is worth more than either being clever on its own.
  function evict(live) {
    let need = 0;
    for (const k of live) if (!texes.has(k)) need++;
    if (texes.size + need <= MAX_TEX) return;
    for (const [k, t] of [...texes]) {
      if (texes.size + need <= MAX_TEX) break;
      if (live.has(k)) continue;                 // drawn this frame — deleting it is the bug
      gl.deleteTexture(t); texes.delete(k);
    }
  }

  function textureFor(key, img, smooth) {
    let t = texes.get(key);
    if (t) return t;
    t = gl.createTexture(); MINTED++;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // ⚠ LINEAR ON MINIFY, NEAREST ON MAGNIFY — the same split the wall textures needed. GLASS
    // smooths a texture only when it is shrinking it; magnifying with LINEAR turns a near sign into
    // a grey wash, which is what made every close facade look unlit before this was corrected there.
    //
    // ⚠ EXCEPT FOR LETTERING, WHICH IS THE OPPOSITE CASE AND WAS GETTING THE WALL TEXTURE'S ANSWER.
    // That rule is about a TILING NOISE PATTERN, where smoothing a magnified texel grid averages the
    // grain away into flat grey. A glyph bake is the other kind of artwork entirely: it is drawn by
    // an antialiased rasteriser, the information is in the EDGE of a stroke, and magnifying that
    // with NEAREST is how you turn a clean letterform into a staircase. A truck parked at a
    // shopfront covers a name board with several hundred screen pixels of a texture whose cell is
    // 72, so magnification is the ordinary case for a sign rather than the exception.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texes.set(key, t);
    return t;
  }

  // ⚠ GROUPED BY TEXTURE, because a bind is the expensive part and two signs reading the same
  // baked canvas — every branch of the same chain, every "HOTEL" in the city — are one draw call.
  // `ox`/`oy`: see the sprite layer's upload.
  // One decal's two triangles into `D` at `o`; returns the next offset. `sd` is the artwork's flicker
  // seed; `ox`/`oy` see the sprite layer's upload.
  function putDecal(D, o, d, sd, ox, oy) {
    let cx = 0, cy = 0, cz = 0, pl = 0;
    // A quad with its pull still to do (d.pl, see emitDecoFill) sends its raw corners and centroid.
    const raw = d.pl > 0 && d.rp;
    const [TL, TR, BR, BL] = raw ? d.rp : d.p, al = d.alpha == null ? 1 : d.alpha;
    if (raw) { const R = d.rp, n = d.rn || 4; cx = ox; cy = oy; for (let i = 0; i < n; i++) { const c = d.rc ? d.rc[i] : R[i]; cx += c[0] / n; cy += c[1] / n; cz += c[2] / n; } pl = d.pl; }
    // 0 is "this is paint" and is the default, so a producer that has never heard of emission
    // draws exactly what it drew before at any gain — see the ⚠ in the fragment shader.
    // -1 is lit cloth, which is never also an emitter.
    const em = d.lit ? -1 : d.emit > 0 ? d.emit : 0;
    const put = (p, u, v) => {
      D[o] = p[0] + ox; D[o + 1] = p[1] + oy; D[o + 2] = p[2];
      D[o + 3] = u; D[o + 4] = v; D[o + 5] = al; D[o + 6] = em; D[o + 7] = sd;
      D[o + 8] = cx; D[o + 9] = cy; D[o + 10] = cz; D[o + 11] = pl;
      o += STRIDE;
    };
    put(TL, 0, 0); put(TR, 1, 0); put(BR, 1, 1);
    put(TL, 0, 0); put(BR, 1, 1); put(BL, 0, 1);
    return o;
  }
  // `groups` are retained ones (gl/retain.js): `{ recs, ox, oy }`. Each is split into one entry per
  // texture and kind (solid or not), as the frame's own list is batched, and each entry is drawn as its
  // own range with its own texture: `spans`, not `runs`.
  const arena = createArena(gl, STRIDE, ATTRS);
  const KEYS = new WeakMap();
  function upload(list, ox = 0, oy = 0, groups = null) {
    const gEntries = [], gLive = [];
    if (groups) for (const G of groups) {
      let k = KEYS.get(G.recs);
      if (!k || k.ox !== G.ox || k.oy !== G.oy) {
        // Split once per array: the records in it never change (bayGroup's promise).
        const by = new Map();
        for (const d of G.recs) {
          if (!d || !d.img || !d.p || d.p.length !== 4) continue;
          const gk = (d.cull ? 'B:' : 'F:') + d.key + (d.solid ? '|S' : '|C');
          let a = by.get(gk); if (!a) by.set(gk, a = { key: d.key, img: d.img, cull: !!d.cull, smooth: !!d.smooth, solid: !!d.solid, items: [] });
          a.items.push(d);
        }
        k = { ox: G.ox, oy: G.oy, parts: [...by.values()].map((a) => ({ ...a, id: {} })) };
        KEYS.set(G.recs, k);
      }
      for (const a of k.parts) {
        gLive.push(a);
        const sd = keySeed(a.key);
        gEntries.push({ key: a.id, part: a, floats: a.items.length * 6 * STRIDE, write: (D, o) => { for (const d of a.items) o = putDecal(D, o, d, sd, G.ox, G.oy); return o; } });
      }
    }
    arena.retain(gEntries);
    keptLive = gLive;
    MINTED = 0;
    const byKey = new Map();
    for (const d of list) {
      if (!d || !d.img || !d.p || d.p.length !== 4) continue;
      // ⚠ `cull` IS IN THE GROUPING KEY, NOT JUST CARRIED ON THE BATCH. It is a uniform, so it is
      // set once per draw call — two decals sharing a texture and disagreeing about it would be one
      // batch, and one of them would silently get the other’s answer.
      const gk = (d.cull ? 'B:' : 'F:') + d.key;
      // `smooth` is NOT in the grouping key, unlike `cull`, and the difference is real: `cull` is a
      // uniform set per draw call, while the filter is a property of the TEXTURE, which is cached on
      // `d.key` alone. Two decals sharing a key share their artwork and therefore their producer.
      // ⚠ `solid` IS GL STATE SET ONCE PER DRAW CALL, so it splits the group into two lists rather
      // than riding on the item — the same rule `cull` follows above, and the same one billboards.js
      // follows for `depth`. It stays OUT of the grouping key and out of the texture cache: the same
      // artwork drawn both ways is one upload.
      let a = byKey.get(gk); if (!a) byKey.set(gk, a = { img: d.img, key: d.key, cull: !!d.cull, smooth: !!d.smooth, items: [], deep: [] });
      (d.solid ? a.deep : a.items).push(d);
    }
    // Which TEXTURES this frame draws — `a.key`, never the grouping key. See the ⚠ on evict.
    const liveTex = new Set();
    for (const a of byKey.values()) liveTex.add(a.key);
    for (const a of keptLive) liveTex.add(a.key);
    // ── WHICH PRODUCER IS MINTING THEM, WHEN THE CACHE IS OVER ITS CAP ────────
    //
    // `textures` can sit at more than twice MAX_TEX with `batches` exactly equal to it, which says
    // two things at once: nothing is sharing artwork, and the whole set turned over since the last
    // frame — so every one of them is a `createTexture` plus a `texImage2D` this frame. A count
    // cannot say WHOSE, and a key is `producer|…`, so the prefix is the answer. Off by default and
    // it allocates nothing when off.
    if (KEYCENSUS) {
      const t = KEYCENSUS;
      for (const a of byKey.values()) {
        const k = String(a.key), i = k.indexOf('|');
        const pre = i > 0 ? k.slice(0, i) : k.slice(0, 12);
        t[pre] = (t[pre] | 0) + 1;
      }
    }
    evict(liveTex);
    let quads = 0;
    for (const a of byKey.values()) quads += a.items.length + a.deep.length;
    const verts = quads * 6;
    if (data.length < verts * STRIDE) data = new Float32Array(Math.max(verts * STRIDE, 1024));
    batches = [];
    let o = 0, first = 0;
    let sd = 0;
    const quad = (d) => { o = putDecal(data, o, d, sd, ox, oy); };
    for (const a of byKey.values()) {
      // The TEXTURE cache is keyed on the appearance alone — the same artwork culled and unculled
      // is one upload — so `a.key` and not the grouping key.
      const tex = textureFor(a.key, a.img, a.smooth);
      // The flicker seed is the ARTWORK's, so it is stable however the map window recentres. A
      // seed off the quad's position would re-roll every sign's fault the moment the window moved.
      sd = keySeed(a.key);
      // ⚠ THE COLOUR ORDER IS THE ONE THAT ALWAYS SHIPPED. The prepass reads `solid` batches out of
      // this same buffer, so the split costs no second copy and moves nothing: every quad is still
      // drawn, in group order, in the pass below.
      for (const d of a.items) quad(d);
      if (a.items.length) { const n = a.items.length * 6; batches.push({ tex, first, count: n, cull: a.cull, solid: false }); first += n; }
      for (const d of a.deep) quad(d);
      if (a.deep.length) { const n = a.deep.length * 6; batches.push({ tex, first, count: n, cull: a.cull, solid: true }); first += n; }
    }
    stream.write(data, verts * STRIDE);
    return quads;
  }

  // ⚠ `emitGain` IS 0 WITHOUT THE FLOAT TARGET AND THAT IS NOT A STYLE CHOICE. Against the 8-bit
  // buffer an over-range sign clamps on the way in, so the whole gradient of a lit tube saturates to
  // flat white — the same mistake EMISSIVE_GAIN shipped at 3 and had to be walked back from. The
  // headroom to hold it is the float target, so the caller only ever sends a gain when there is one.
  function draw(cam, H, emitGain = 0, neon = null, lit = null) {
    const kept = arena.spans;
    if (!batches.length && !kept.length) return 0;
    const keptRun = (solidOnly) => {
      if (!kept.length) return 0;
      gl.bindVertexArray(arena.vao);
      let n = 0;
      for (const sp of kept) {
        const a = sp.g.part;
        if (solidOnly && !a.solid) continue;
        gl.uniform1f(loc.cull, a.cull ? 1 : 0);
        gl.bindTexture(gl.TEXTURE_2D, textureFor(a.key, a.img, a.smooth));
        gl.drawArrays(gl.TRIANGLES, sp.at, sp.n);
        n += sp.n / 6;
      }
      gl.bindVertexArray(vao);
      return n;
    };
    gl.useProgram(prog);
    const ls = lit && lit.lights ? lit.lights : [];
    const nL = Math.min(ls.length, LIT_MAX);
    for (let i = 0; i < nL; i++) {
      const L = ls[i];
      litP[i * 3] = L.p[0]; litP[i * 3 + 1] = L.p[1]; litP[i * 3 + 2] = L.p[2];
      litC[i * 3] = L.rgb[0]; litC[i * 3 + 1] = L.rgb[1]; litC[i * 3 + 2] = L.rgb[2];
      litR[i] = L.r;
    }
    gl.uniform1i(loc.litN, nL);
    gl.uniform1f(loc.litGain, lit && lit.gain > 0 ? lit.gain : 0);
    if (nL) { gl.uniform3fv(loc.litP, litP); gl.uniform3fv(loc.litC, litC); gl.uniform1fv(loc.litR, litR); }
    gl.uniform1f(loc.tube, neon && neon.tube > 0 ? neon.tube : 0);
    gl.uniform1f(loc.flick, neon && neon.flicker > 0 ? neon.flicker : 0);
    // Wrapped to an hour: a float32 uniform holding milliseconds since the epoch has no fraction left.
    gl.uniform1f(loc.time, neon && neon.now ? (neon.now / 1000) % 3600 : 0);
    gl.uniform1f(loc.emitGain, emitGain > 0 ? emitGain : 0);
    gl.uniformMatrix4fv(loc.viewProj, false, mat4f(viewProjMatrix(cam, H)));
    { const e = eyePos(cam); gl.uniform3f(loc.eye, e[0], e[1], e[2]); }
    // Whether this camera reflects the world — see the ⚠ on `uFlip`. Read off the camera itself so
    // a caller cannot hand over a mirrored matrix and forget to say so.
    gl.uniform1f(loc.flip, cam.mirrorZ == null ? 0 : 1);
    gl.uniform1i(loc.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    // ⚠ STATED HERE RATHER THAN INHERITED, exactly as billboards.js states it: the prepass below
    // lays a board's own depth down first, so under the GL default of LESS the colour pass would
    // fail its own test at every one of that board's pixels and the sign would simply not be drawn.
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);        // a sign is on a wall, not a wall
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    // The silhouette of the boards that ARE a surface, into the depth buffer only — see the ⚠ at
    // the top. Nothing reaches the colour buffer here, so the pass below is unchanged for every
    // decal including these; all this leaves behind is a depth the CLOUD deck can sort against.
    let deep = 0;
    for (const b of batches) if (b.solid) deep++;
    for (const sp of kept) if (sp.g.part.solid) deep++;
    if (deep) {
      gl.uniform1f(loc.cut, DEPTH_CUT);
      gl.colorMask(false, false, false, false);
      gl.depthMask(true);
      keptRun(true);
      for (const b of batches) {
        if (!b.solid) continue;
        gl.uniform1f(loc.cull, b.cull ? 1 : 0);
        gl.bindTexture(gl.TEXTURE_2D, b.tex);
        gl.drawArrays(gl.TRIANGLES, b.first, b.count);
      }
      gl.depthMask(false);
      gl.colorMask(true, true, true, true);
    }
    gl.uniform1f(loc.cut, COLOUR_CUT);
    let n = keptRun(false);
    for (const b of batches) {
      gl.uniform1f(loc.cull, b.cull ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.drawArrays(gl.TRIANGLES, b.first, b.count);
      n += b.count / 6;
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return n;
  }

  // ⚠ A DECAL COUNT SAYS NOTHING ABOUT WHAT THIS LAYER COSTS, AND THAT COST A WRONG DIAGNOSIS.
  // Quads are grouped by texture, so a thousand decals sharing one baked canvas are ONE draw call
  // and a thousand carrying their own artwork are a thousand — two frames reporting the identical
  // 'decals' number and an order of magnitude apart in binds. 'batches' is the number that tracks
  // the clock, and until it was published the only figure a bench could read was the one that does
  // not. 'textures' beside it is how near the cache is to MAX_TEX, which is where it stops merely
  // filling and starts evicting something every frame.
  return { upload, draw, get textures() { return texes.size; }, get batches() { return batches.length; }, get minted() { return MINTED; } };
}

declareProgram(VERT, FRAG);
