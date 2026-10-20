// SIGNAGE, ON THE DEPTH BUFFER.
// A marquee is artwork on a rectangle (board, lit face, frame, bulbs, lettering) painted in 2-D and
// mapped onto the sign's projected quad so it shears with its wall.
// ⚠ WHY IT'S HERE: the GPU mass is composited before the 2-D pass, so nothing paints over a sign,
// and 'decoHidden' asks per surface, answering "draw" for a sign half behind a tower. On the GPU
// it's depth-TESTED and writes none: the tower hides its half per pixel. No lift, bias or probe.
// ⚠ THE ARTWORK IS STILL PAINTED BY THE 2-D CODE: the caller bakes it as 'bakeSignText' bakes
// lettering and hands over four world corners, so there's only one idea of a sign.
// ⚠ SOME QUADS ARE THE SURFACE, NOT PAINT ON ONE: see 'solid' and RENDER_TUNE.glBoardDepth.
// 'emitFlat''s 'paint' path sends a per-tile hoarding (slab, legs, frame, trim; '$name' means no
// single mesh) here. It stands against the sky, so with no depth the cloud deck drew through it.
// ⚠ IT'S A DEPTH-ONLY PREPASS, as in billboards.js: writing depth in the one draw would change the
// composite order (a board hiding an earlier sign's lettering) and drop antialiased edge texels.
// The colour pass is unchanged; a 'colorMask'-off draw lays the silhouette first. With no batch
// asking, the prepass doesn't run.
import { viewProjMatrix, mat4f, eyePos } from './camera.js';
import { makeVertexStream } from './stream.js';
import { createArena } from './retain.js';
import { declareProgram, layerProgram } from './programs.js';
import { linearOut, applyLinOut } from './colour.js';

// pos3, uv2, alpha1, emit1, seed1, cen3, pull1, tint (4 bytes in one slot), flags1 (cull, nearest),
// cell (4 uint16 in two slots)
const STRIDE = 16;
// ── ⚠ ARTWORK SHARES PAGES (RENDER_TUNE.glDecalAtlas) ────────────────────────────────────────────
//
// What the tint batch left was about 80 textures a frame, each its own draw and bind (twice for the
// boards in the depth prepass), because each sign, flag and banner is its own baked canvas. With the
// switch on, artwork that fits is copied onto a shared page and drawn off it, so records on the
// same page share draws exactly as the fills do. Draw order doesn't change: records are still grouped
// by artwork in the order they arrived, and neighbouring groups on one page just stop being separate
// calls.
//
// ⚠ EVERY TAP STAYS IN ITS CELL. `vUV` is still 0..1 across the record's own artwork and `aCell` says
// where that artwork sits in its texture (texels: x, y, w, h). `cellUV` clamps half a texel inside the
// cell, which is what CLAMP_TO_EDGE did on a texture of its own, so a tap past the edge (the neon
// shader's neighbours, the shadow offset) reads the edge texel and never the next sign's lettering.
// A texture of its own is the cell (0, 0, w, h), and the tint group's white texel is (0, 0, 1, 1).
// ⚠ AND THE NEON MATHS IS IN CELL TEXELS. `textureSize` is the page's; the tube's taps, its footprint
// and its sections are sized off `vCell.zw`, which is what `textureSize` was when each sign had one.
// ⚠ A PAGE HAS ONE FILTER, AND ARTWORK WANTS TWO. A page is LINEAR both ways (no mips, as before:
// see coreAt). Artwork that isn't `smooth` was NEAREST on magnify, so its records carry flag bit 2 and
// the shader snaps the tap to its texel's centre when one texel covers more than a pixel, which is
// where GL would have switched to the magnify filter.
// ⚠ A RETAINED PART HOLDS ITS CELL. Its vertices are written once, so a cell that moves (its page was
// reset) gives the part a new arena id and it's written again; see `prepare` and `upload`.
// ⚠ ONE PAGE SHOULD HOLD THE FRAME. Records keep their order, so artwork split across two pages
// alternates between them and every switch is a draw: at 2048 square the Halcyon cockpit's set
// (3.5 M texels) needed two and drew 68 binds where one page draws a handful. So a page is 4096 wide
// where the device allows it (nearly all do; WebGL2 promises 2048) and 2048 tall: 32 MB.
const PAGE_H = 2048;
const PAGES = 2;
const PAD = 1;              // texels between cells, zero when the page is fresh
// ── ⚠ A FLAT FILL IS A COLOUR, NOT A TEXTURE (RENDER_TUNE.glDecalTint) ───────────────────────────
//
// A record carrying `tint` has no artwork but one colour (or two, a ramp's: `tint` on its top edge and
// `tint2` on its bottom), packed as the premultiplied RGBA8 its 8x8 page would have held. Every such
// record is drawn off one shared white texel in one group, in the order it arrived, where a texture
// apiece had been one draw, one bind and one cull uniform apiece: about 765 of each in a Halcyon
// cockpit frame, most of them flat fills. `cull` rides on the vertex (`aCull`) for the same reason,
// and the depth prepass draws the group's solid quads as sub-ranges of it, all in one call.
// A record without `tint` takes the textured path exactly as before, grouped by texture, cull and
// solid, so with the switch at 0 no record has one and nothing here changes what is drawn.
const TINT_KEY = 'decal|tint';   // the tint group's key, which no producer's artwork key can be
const WHITE = 0xffffffff;
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
// The fill's colour, premultiplied (white for artwork); whether the quad has a front (1) and whether
// its artwork is nearest-filtered on magnify (2); and its cell in the texture, in texels.
in vec4 aTint;
in float aCull;
in vec4 aCell;
uniform vec3 uEye;
uniform mat4 uViewProj;
out vec2 vUV;
out float vAlpha;
out float vEmit;
out vec3 vWorld;
out vec4 vTint;
flat out float vSeed;
flat out float vCull;
flat out float vNear;
flat out vec4 vCell;
void main() {
  vSeed = aSeed;
  vTint = aTint;
  vCull = mod(aCull, 2.0);
  vNear = step(1.5, aCull);
  vCell = aCell;
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

const FRAG = linearOut(`#version 300 es
precision highp float;
#define LIT_MAX ${LIT_MAX}
in vec2 vUV;
in float vAlpha;
in float vEmit;
in vec3 vWorld;
in vec4 vTint;
flat in float vSeed;
flat in float vCull;
flat in float vNear;
flat in vec4 vCell;
uniform sampler2D uTex;
// One over the bound texture's size, set at the top of main.
vec2 gInv;
// Lit cloth (vEmit < 0) — see LIT_MAX and the ⚠ in main.
uniform int uLitN;
uniform float uLitGain;
uniform vec3 uLitP[LIT_MAX];
uniform vec3 uLitC[LIT_MAX];
uniform float uLitR[LIT_MAX];
uniform float uTube;
uniform float uFlick;
uniform float uTime;
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
// A point on the record's own artwork (0..1 across it) to the texture, held half a texel inside its
// cell. See the ⚠ on glDecalAtlas at the top.
vec2 cellUV(vec2 uv) { return (vCell.xy + clamp(uv * vCell.zw, vec2(0.5), vCell.zw - 0.5)) * gInv; }
float coreAt(vec2 uv) {
  // ⚠ COVERAGE, NOT WHITENESS. The bake's three passes describe a white core, and by the time the
  // canvas is uploaded it is not white: measured over the 39 lit signs in one Coldwater frame, the
  // opaque stroke is one flat colour (its whitest channel anywhere from 0.06 to 0.95) and only the
  // halo is translucent. A whiteness test found no tube on any of them. Alpha tells stroke from
  // halo on every sign whatever its colour.
  // ⚠ AND LEVEL 0, NEVER THE MIP CHAIN. At street distance a sign is minified several levels and
  // each level above 0 averages the stroke into its halo, so the edge the gradient needs is gone.
  // How far level 0 then aliases is what the fade in main is for.
  return smoothstep(0.70, 0.98, textureLod(uTex, cellUV(uv), 0.0).a);
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
  gInv = 1.0 / vec2(textureSize(uTex, 0));
  // The tap in cell texels, and its footprint, taken before anything can discard.
  vec2 tc = vUV * vCell.zw;
  float rho = max(length(dFdx(tc)), length(dFdy(tc)));
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
  // 'vCull' is per vertex (aCull), so quads that disagree about it share a draw.
  // ⚠ AND A MIRROR REVERSES THAT POLARITY, WHICH IS WHY IT IS A UNIFORM AND NOT A LITERAL. The
  // puddle pass renders the world reflected about the water's plane; the reflection matrix has
  // determinant −1, so every quad's winding flips and the test above selects the exact complement —
  // the reflection would hold only the signs facing AWAY from you, mirrored, which is the
  // "ƎƆATJOV" bug a second time and in a surface where nobody would think to read it.
  if (vCull > 0.5 && gl_FrontFacing != (uFlip > 0.5)) discard;
  // The texture is uploaded PREMULTIPLIED, so scaling by alpha is one multiply and the blend is
  // the canvas's own (ONE, ONE_MINUS_SRC_ALPHA). A flat fill's colour is premultiplied too, on the
  // white texel; artwork's tint is white, an exact 1.
  // Nearest-filtered artwork on a LINEAR page, magnified (one texel over more than a pixel): the
  // texel's centre, where LINEAR reads the texel alone. See the ⚠ on glDecalAtlas at the top.
  vec4 t = (vNear > 0.5 && rho <= 1.0
    ? textureLod(uTex, (vCell.xy + clamp(floor(tc) + 0.5, vec2(0.5), vCell.zw - 0.5)) * gInv, 0.0)
    : texture(uTex, cellUV(vUV))) * vTint * vAlpha;
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
    // The artwork's own size, not the page's: see the ⚠ on glDecalAtlas at the top.
    vec2 ts = vCell.zw;
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
    // axis of one enormous tube and the whole board went white-hot — Midway Parks's name board at night.
    // A stroke is empty on BOTH sides of it along some direction; a board interior is full on both
    // and a board edge is empty on one side only, so neither passes.
    float thin = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = float(i) * 0.7854;
      vec2 d = vec2(cos(a), sin(a)) * px * 6.0 * foot;
      thin = max(thin, (1.0 - coreAt(vUV + d)) * (1.0 - coreAt(vUV - d)));
    }
    float body = smoothstep(0.05, 0.45, H) * smoothstep(0.25, 0.75, thin) * uTube * near;
    // ⚠ HOW FAR PAST WHITE, ACROSS THE TUBE. The emission gain multiplies every channel and the
    // composite clamps each one, so a pink pushed 1.9x comes out with its red and blue both at 1:
    // pale, nearly white, and the whole tube went that way. The axis is where a camera blows out,
    // so it takes the full gain (and still clears the bloom's threshold); the walls take a third
    // and keep their colour.
    float emW = mix(1.0, mix(0.35, 1.0, smoothstep(0.75, 1.0, H)), body);
    if (body > 0.0) {
      vec4 cs = textureLod(uTex, cellUV(vUV), 0.0);
      vec3 hue = cs.a > 0.01 ? cs.rgb / cs.a : vec3(1.0);
      // The baked axis is white and carries no hue, so take the colour from beside it.
      vec4 side = textureLod(uTex, cellUV(vUV + normalize(grad + 1e-5) * px * 3.0 * foot), 0.0);
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
      // ⚠ LIT GLASS IS THE LIGHT, SO ITS WALLS ARE NOT DARK. The gas fills the bore and glows
      // through the whole section: full saturation at the walls, overexposed toward white along
      // the axis. Darkening the rim (by three quarters, as this did) shaded the tube as a solid rod
      // lit from outside, which read as chrome lettering with a pink outline. The light from above
      // is a small modulation and the rim keeps only a trace of Fresnel.
      vec3 litT = mix(hue, hue * 0.4 + 0.6, smoothstep(0.8, 1.0, H) * 0.8) * (0.88 + 0.12 * diff);
      litT = litT * (1.0 - 0.15 * rim) + vec3(0.9) * pow(rim, 3.0) * 0.06;
      // ⚠ AN OUT SECTION IS STILL A TUBE. Going near-black left a hole the shape of a letter; real
      // dead neon is pale tinted glass with the street reflected in it, so it keeps its edges.
      vec3 deadT = hue * 0.10 + vec3(0.07) + vec3(0.45) * pow(rim, 2.0) * 0.5;
      vec3 tube = mix(deadT, litT, fl);
      // The specular is the sky in the glass; against lit gas it's faint, against a dead tube it's
      // most of what you see.
      rgb = mix(rgb, tube * t.a, body) + vec3(spec * mix(0.6, 0.2, fl) * body) * t.a;
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
    // ⚠ ONLY A DARK TUBE CASTS ONE. A lit tube is the brightest thing on its board; the light from
    // above that would throw this shadow is nothing beside it, and a dark offset under glowing
    // letters read as a drop shadow under plastic ones. So the shadow comes in as a section fails.
    float sh = coreAt(vUV + vec2(-1.2, -3.2) * px * max(foot, 1.0) * 2.0);
    float shA = sh * (1.0 - smoothstep(0.02, 0.2, H)) * (1.0 - Hc) * 0.6 * uTube * near * (1.0 - 0.9 * fl);
    vec3 lit = rgb * (1.0 - shA);
    // ── THE WASH STOPS SHORT OF THE QUAD ──────────────────────────────────────────────────────
    // The bake's broad wash (RENDER_TUNE.neonWash) runs into the canvas edge, a pad past the ink,
    // and a glow cut off square there draws the quad's outline in light. So everything that isn't
    // tube fades to nothing toward the edges. The tube itself never reaches them.
    vec2 eu = min(vUV, 1.0 - vUV);
    float win = smoothstep(0.0, 0.07, eu.x) * smoothstep(0.0, 0.16, eu.y);
    float keep = mix(win, 1.0, smoothstep(0.3, 0.7, Hc));
    outColor = vec4(lit * (1.0 + vEmit * uEmitGain * fl * emW), t.a + shA * (1.0 - t.a)) * keep;
    return;
  }
  outColor = vec4(rgb * (1.0 + vEmit * uEmitGain), t.a);
}`, 'outColor');


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
  const prog = layerProgram(gl, VERT, FRAG, 'decal');

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
    tint: gl.getAttribLocation(prog, 'aTint'),
    cullA: gl.getAttribLocation(prog, 'aCull'),
    cell: gl.getAttribLocation(prog, 'aCell'),
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
  const ATTRS = [[loc.pos, 3, 0], [loc.uv, 2, 12], [loc.alpha, 1, 20], [loc.emit, 1, 24], [loc.seed, 1, 28], [loc.cen, 3, 32], [loc.pullA, 1, 44],
    [loc.tint, 4, 48, gl.UNSIGNED_BYTE, true], [loc.cullA, 1, 52], [loc.cell, 4, 56, gl.UNSIGNED_SHORT, false]];
  const stream = makeVertexStream(gl, vao, STRIDE, ATTRS, 1024);
  let data = new Float32Array(0);
  // Where each artwork is: key → `{ tex, x, y, w, h, near, page }`, its cell in texels. `own` holds
  // the ones with a texture apiece (the switch at 0, artwork too big for a page, or no room left on
  // one: `spill`), `onPage` the ones on a page. See the ⚠ on glDecalAtlas at the top.
  const own = new Map(), onPage = new Map();
  const cellOf = (key) => onPage.get(key) || own.get(key);
  const pages = [];                 // { tex, shelves, top, stamp, keys }
  // The page's width: see the ⚠ on ONE PAGE at the top. A fake context answers 0, and gets 4096.
  const PAGE_W = Math.max(2048, Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096));
  const fitsPage = (w, h) => w > 0 && h > 0 && w + PAD <= PAGE_W && h <= PAGE_H / 4;
  let frame = 0;
  let batches = [];                 // { tex, first, count, solid }
  let binds = 0;                    // the last draw's
  // The tint group's texture: one white texel, outside the cache so nothing evicts it.
  let white = null;
  function whiteOf() {
    if (white) return white;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    white = { tex: t, x: 0, y: 0, w: 1, h: 1, near: false, page: null };
    return white;
  }
  const cellFor = (a) => (a.tint ? whiteOf() : cellOf(a.key));
  // Many draws with the same state in one call, where the browser has it (Chrome does); see keptRun.
  const md = gl.getExtension('WEBGL_multi_draw');
  let mdF = new Int32Array(64), mdC = new Int32Array(64), mdK = 0;
  // A range for the next `multi()`, joined to the last one when it starts where that one ended.
  function range(at, n) {
    if (mdK && mdF[mdK - 1] + mdC[mdK - 1] === at) { mdC[mdK - 1] += n; return; }
    if (mdK === mdF.length) { const F = new Int32Array(mdK * 2), C = new Int32Array(mdK * 2); F.set(mdF); C.set(mdC); mdF = F; mdC = C; }
    mdF[mdK] = at; mdC[mdK] = n; mdK++;
  }
  // Draw what `range` collected off `tex`, on the VAO already bound. A texture already bound isn't
  // bound again.
  let bound = null;
  function multi(tex) {
    if (!mdK) return;
    if (tex !== bound) { gl.bindTexture(gl.TEXTURE_2D, tex); bound = tex; binds++; }
    if (md && mdK > 1) md.multiDrawArraysWEBGL(gl.TRIANGLES, mdF, 0, mdC, 0, mdK);
    else for (let i = 0; i < mdK; i++) gl.drawArrays(gl.TRIANGLES, mdF[i], mdC[i]);
    mdK = 0;
  }
  // The solid quads of a tint group, as `[first, count]` vertex ranges from the group's start.
  function solidRuns(items) {
    const r = [];
    for (let j = 0; j < items.length; j++) {
      if (!items[j].solid) continue;
      if (r.length && r[r.length - 1][0] + r[r.length - 1][1] === j * 6) r[r.length - 1][1] += 6;
      else r.push([j * 6, 6]);
    }
    return r;
  }
  let tintRuns = [];               // this frame's, from the start of the stream

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
  // `key` alone, so testing a grouping key against the cache finds NOTHING live and deletes the lot:
  // the original bug back again, wearing the fix's clothes. Two groups can also share one texture
  // (the same artwork culled and unculled), so the live set is the smaller of the two.
  //
  // ⚠ A frame carrying more than MAX_TEX distinct textures overshoots the cap rather than dropping
  // one it needs, exactly as the billboard layer does — the cache comes back down on the next frame
  // that draws fewer. That is the safe direction, an overshoot against a decal drawn with somebody
  // else's artwork, and the two layers agreeing is worth more than either being clever on its own.
  // Only textures of their own count: a page holds its cells until it's reset (`prepare`).
  function evict(live) {
    let need = 0;
    for (const k of live.keys()) if (!cellOf(k)) need++;
    if (own.size + need <= MAX_TEX) return;
    for (const [k, c] of [...own]) {
      if (own.size + need <= MAX_TEX) break;
      if (live.has(k)) continue;                 // drawn this frame — deleting it is the bug
      gl.deleteTexture(c.tex); own.delete(k);
    }
  }

  function ownCell(key, img, smooth, spill) {
    const t = gl.createTexture(); MINTED++;
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
    // (On a page the same split is the shader's: see the ⚠ on glDecalAtlas at the top.)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const c = { tex: t, x: 0, y: 0, w: img.width || 1, h: img.height || 1, near: false, page: null, spill };
    own.set(key, c);
    return c;
  }

  // ── THE PAGES ───────────────────────────────────────────────────────────────────────────────
  function newPage() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, PAGE_W, PAGE_H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const pg = { tex, shelves: [], top: 0, stamp: 0, keys: [] };
    pages.push(pg);
    return pg;
  }
  // Cells are never freed one at a time; a page is emptied whole once nothing on it is drawn.
  function resetPage(pg) {
    for (const k of pg.keys) onPage.delete(k);
    pg.keys = []; pg.shelves = []; pg.top = 0;
  }
  // Shelves: a cell goes on the first shelf tall enough and not much taller, else on a new shelf.
  function place(pg, w, h) {
    const W = w + PAD, H = h + PAD;
    for (const s of pg.shelves) if (H <= s.h && s.h <= H + (H >> 1) + 8 && s.x + W <= PAGE_W) { s.x += W; return [s.x - W, s.y]; }
    if (pg.top + H > PAGE_H) return null;
    pg.shelves.push({ y: pg.top, h: H, x: W }); pg.top += H;
    return [0, pg.top - H];
  }
  function putOnPage(pg, key, img, smooth) {
    const at = place(pg, img.width, img.height);
    if (!at) return null;
    gl.bindTexture(gl.TEXTURE_2D, pg.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, at[0], at[1], gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    MINTED++;
    const c = { tex: pg.tex, x: at[0], y: at[1], w: img.width, h: img.height, near: !smooth, page: pg };
    pg.keys.push(key); pg.stamp = frame; onPage.set(key, c);
    return c;
  }
  // Give every artwork this frame draws (`need`: key → anything with `img` and `smooth`) a cell.
  // Everything it moves or mints happens here, before a vertex is written.
  // ⚠ WHEN THE PAGES ARE FULL, A PAGE NOTHING THIS FRAME DRAWS IS EMPTIED, else a new one is made up to
  // PAGES, else the artwork gets a texture of its own (`spill`), which is today's path. A page that's
  // drawn from is never touched. Spilled artwork goes back onto a page the next time one is emptied.
  // ⚠ TALLEST FIRST, THEN BY KEY, so two layers given the same artwork pack it the same way, whatever
  // order it arrived in: perf:retain compares a retained layer with a plain one byte for byte.
  function prepare(need, on) {
    frame++;
    const miss = [];
    for (const [k, d] of need) {
      const c = cellOf(k), want = on && fitsPage(d.img.width, d.img.height);
      if (c && (c.page ? want : !want || c.spill)) { if (c.page) c.page.stamp = frame; continue; }
      if (c) { if (c.page) onPage.delete(k); else { gl.deleteTexture(c.tex); own.delete(k); } }
      miss.push([k, d, want]);
    }
    if (!miss.length) return;
    const order = (a, b) => b[1].img.height - a[1].img.height || b[1].img.width - a[1].img.width || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    miss.sort(order);
    let freed = false;
    const onto = (k, d) => {
      let c = null;
      for (const pg of pages) if ((c = putOnPage(pg, k, d.img, d.smooth))) return c;
      let pg = null;
      for (const p of pages) if (frame - p.stamp > 8 && (!pg || p.stamp < pg.stamp)) pg = p;
      if (pg) { resetPage(pg); freed = true; }
      else if (pages.length < PAGES) pg = newPage();
      return pg ? putOnPage(pg, k, d.img, d.smooth) : null;
    };
    for (const [k, d, want] of miss) if (!(want && onto(k, d))) ownCell(k, d.img, d.smooth, want);
    if (!freed) return;
    const back = [];
    for (const [k, d] of need) { const c = own.get(k); if (c && c.spill) back.push([k, d]); }
    back.sort(order);
    for (const [k, d] of back) {
      let c = null;
      for (const pg of pages) if ((c = putOnPage(pg, k, d.img, d.smooth))) break;
      if (!c) break;
      gl.deleteTexture(own.get(k).tex); own.delete(k);
    }
  }

  // ⚠ GROUPED BY TEXTURE, because a bind is the expensive part and two signs reading the same
  // baked canvas — every branch of the same chain, every "HOTEL" in the city — are one draw call.
  // One decal's two triangles into `D` at `o`; returns the next offset. `sd` is the artwork's flicker
  // seed; `c` its cell; `ox`/`oy` see the sprite layer's upload.
  function putDecal(D, o, d, sd, ox, oy, c) {
    let cx = 0, cy = 0, cz = 0, pl = 0;
    // A quad with its pull still to do (d.pl, see emitDecoFill) sends its raw corners and centroid.
    const raw = d.pl > 0 && d.rp;
    const [TL, TR, BR, BL] = raw ? d.rp : d.p, al = d.alpha == null ? 1 : d.alpha;
    if (raw) { const R = d.rp, n = d.rn || 4; cx = ox; cy = oy; for (let i = 0; i < n; i++) { const q = d.rc ? d.rc[i] : R[i]; cx += q[0] / n; cy += q[1] / n; cz += q[2] / n; } pl = d.pl; }
    // 0 is "this is paint" and is the default, so a producer that has never heard of emission
    // draws exactly what it drew before at any gain — see the ⚠ in the fragment shader.
    // -1 is lit cloth, which is never also an emitter.
    const em = d.lit ? -1 : d.emit > 0 ? d.emit : 0;
    // The tint is four bytes and the cell four uint16s, written through views of the same storage.
    if (D !== uD) { uD = D; U = new Uint32Array(D.buffer, D.byteOffset, D.length); S = new Uint16Array(D.buffer, D.byteOffset, D.length * 2); }
    const t0 = d.tint != null ? d.tint : WHITE, t1 = d.tint2 != null ? d.tint2 : t0;
    const fl = (d.cull ? 1 : 0) + (c.near ? 2 : 0);
    const put = (p, u, v) => {
      D[o] = p[0] + ox; D[o + 1] = p[1] + oy; D[o + 2] = p[2];
      D[o + 3] = u; D[o + 4] = v; D[o + 5] = al; D[o + 6] = em; D[o + 7] = sd;
      D[o + 8] = cx; D[o + 9] = cy; D[o + 10] = cz; D[o + 11] = pl;
      U[o + 12] = v ? t1 : t0; D[o + 13] = fl;
      const s = (o + 14) * 2;
      S[s] = c.x; S[s + 1] = c.y; S[s + 2] = c.w; S[s + 3] = c.h;
      o += STRIDE;
    };
    put(TL, 0, 0); put(TR, 1, 0); put(BR, 1, 1);
    put(TL, 0, 0); put(BR, 1, 1); put(BL, 0, 1);
    return o;
  }
  let uD = null, U = null, S = null;
  // `groups` are retained ones (gl/retain.js): `{ recs, ox, oy }`. Each is split into one entry per
  // texture and kind (solid or not), as the frame's own list is batched, and each entry is drawn as its
  // own range with its own texture: `spans`, not `runs`. A group's tinted records are one entry.
  const arena = createArena(gl, STRIDE, ATTRS);
  const KEYS = new WeakMap();
  function upload(list, ox = 0, oy = 0, groups = null) {
    // The switch rides on the list (DECAL_SINK.atlas, RENDER_TUNE.glDecalAtlas); a list without it is on.
    const on = !list || list.atlas !== 0;
    const kept = [];
    if (groups) for (const G of groups) {
      let k = KEYS.get(G.recs);
      // Keyed on the array and its window, not its offset: see the ⚠ in gl/sprites.js `upload`.
      if (!k || k.w !== G.w) {
        // Split once per array: the records in it never change (bayGroup's promise).
        const by = new Map([[TINT_KEY, null]]);   // holds the tint part's place at the front
        for (const d of G.recs) {
          if (!d || !d.img || !d.p || d.p.length !== 4) continue;
          if (d.tint != null) {
            let a = by.get(TINT_KEY); if (!a) by.set(TINT_KEY, a = { key: TINT_KEY, img: null, tint: true, cull: false, smooth: false, solid: false, items: [] });
            a.items.push(d); if (d.solid) a.solid = true;
            continue;
          }
          const gk = (d.cull ? 'B:' : 'F:') + d.key + (d.solid ? '|S' : '|C');
          let a = by.get(gk); if (!a) by.set(gk, a = { key: d.key, img: d.img, cull: !!d.cull, smooth: !!d.smooth, solid: !!d.solid, items: [] });
          a.items.push(d);
        }
        k = { ox: G.ox, oy: G.oy, w: G.w, parts: [...by.values()].filter(Boolean).map((a) => ({ ...a, id: {}, cell: null, runs: a.tint ? solidRuns(a.items) : null })) };
        KEYS.set(G.recs, k);
      }
      k.ox = G.ox; k.oy = G.oy;
      kept.push(k);
    }
    MINTED = 0;
    // The tint group goes in first, so the fills draw under the artwork, as the kept spans do.
    const byKey = new Map(), tintA = { img: null, key: TINT_KEY, tint: true, cull: false, smooth: false, items: [], deep: [], solid: false };
    byKey.set(TINT_KEY, tintA);
    for (const d of list) {
      if (!d || !d.img || !d.p || d.p.length !== 4) continue;
      // A tinted record joins the one tint group in arrival order, whatever its cull and solid.
      if (d.tint != null) { tintA.items.push(d); if (d.solid) tintA.solid = true; continue; }
      // `cull` rides on the vertex now (aCull), but artwork still groups on it and on `solid`, so a
      // textured decal draws in the order it always did: by texture and cull, each group's plain
      // quads before its solid ones. `smooth` isn't in the key: the filter belongs to the TEXTURE,
      // cached on `d.key` alone, and two decals sharing a key share their artwork.
      const gk = (d.cull ? 'B:' : 'F:') + d.key;
      let a = byKey.get(gk); if (!a) byKey.set(gk, a = { img: d.img, key: d.key, cull: !!d.cull, smooth: !!d.smooth, items: [], deep: [] });
      (d.solid ? a.deep : a.items).push(d);
    }
    if (!tintA.items.length) byKey.delete(TINT_KEY);
    // Which artwork this frame draws: `a.key`, never the grouping key. See the ⚠ on evict.
    const need = new Map();
    for (const k of kept) for (const a of k.parts) if (!a.tint && !need.has(a.key)) need.set(a.key, a);
    for (const a of byKey.values()) if (!a.tint && !need.has(a.key)) need.set(a.key, a);
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
        if (a.tint) continue;
        const k = String(a.key), i = k.indexOf('|');
        const pre = i > 0 ? k.slice(0, i) : k.slice(0, 12);
        t[pre] = (t[pre] | 0) + 1;
      }
    }
    evict(need);
    prepare(need, on);
    // A kept part whose artwork moved since its vertices were written gets a new id, so the arena
    // writes it again. See the ⚠ on glDecalAtlas at the top.
    const gEntries = [];
    for (const k of kept) for (const a of k.parts) {
      const c = cellFor(a);
      if (a.cell !== c) { a.cell = c; a.id = {}; }
      const sd = keySeed(a.key);
      gEntries.push({ key: a.id, part: a, floats: a.items.length * 6 * STRIDE, write: (D, o) => { for (const d of a.items) o = putDecal(D, o, d, sd, k.ox, k.oy, a.cell); return o; } });
    }
    arena.retain(gEntries);
    let quads = 0;
    for (const a of byKey.values()) quads += a.items.length + a.deep.length;
    const verts = quads * 6;
    if (data.length < verts * STRIDE) data = new Float32Array(Math.max(verts * STRIDE, 1024));
    batches = []; tintRuns = [];
    let o = 0, first = 0;
    for (const a of byKey.values()) {
      // The TEXTURE cache is keyed on the appearance alone — the same artwork culled and unculled
      // is one upload — so `a.key` and not the grouping key.
      const c = cellFor(a), tex = c.tex;
      // The flicker seed is the ARTWORK's, so it is stable however the map window recentres. A
      // seed off the quad's position would re-roll every sign's fault the moment the window moved.
      const sd = keySeed(a.key);
      // ⚠ THE COLOUR ORDER IS THE ONE THAT ALWAYS SHIPPED. The prepass reads `solid` batches out of
      // this same buffer, so the split costs no second copy and moves nothing: every quad is still
      // drawn, in group order, in the pass below.
      // The tint group is one batch in arrival order, and its solid quads are ranges inside it.
      if (a.tint) tintRuns = solidRuns(a.items).map(([f, n]) => [first + f, n]);
      for (const d of a.items) o = putDecal(data, o, d, sd, ox, oy, c);
      if (a.items.length) { const n = a.items.length * 6; batches.push({ tex, first, count: n, solid: false }); first += n; }
      for (const d of a.deep) o = putDecal(data, o, d, sd, ox, oy, c);
      if (a.deep.length) { const n = a.deep.length * 6; batches.push({ tex, first, count: n, solid: true }); first += n; }
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
    binds = 0;
    if (!batches.length && !kept.length) return 0;
    // Somebody else has bound textures since the last draw.
    bound = null;
    const keptRun = (solidOnly) => {
      if (!kept.length) return 0;
      gl.bindVertexArray(arena.vao);
      // ⚠ THE TINT SPANS FIRST, ALL OF THEM IN ONE CALL. Each kept group's fills are one span, but the
      // spans aren't neighbours in the arena (artwork and groups kept from earlier frames lie between),
      // so merging neighbours left a draw per group per pass. They share every piece of state, so
      // WEBGL_multi_draw takes the lot in one call; without it, it's a loop of the same draws. Fills
      // under artwork is the order a group's own split already gives (its tint part is first).
      // In the prepass only a span's solid quads go (`runs`).
      let n = 0;
      for (const sp of kept) {
        const a = sp.g.part;
        if (!a.tint) continue;
        if (solidOnly) { for (const [f, c] of a.runs) range(sp.at + f, c); continue; }
        range(sp.at, sp.n);
        n += sp.n / 6;
      }
      multi(whiteOf().tex);
      // Then the artwork in the arena's own order (they blend). Spans in a row on one texture (a page,
      // usually) are one call, whatever lies between them in the arena. Cull rides on the vertex, so it
      // no longer splits a run.
      let tex0 = null;
      for (const sp of kept) {
        const a = sp.g.part;
        if (a.tint || (solidOnly && !a.solid)) continue;
        if (a.cell.tex !== tex0) { multi(tex0); tex0 = a.cell.tex; }
        range(sp.at, sp.n);
        n += sp.n / 6;
      }
      multi(tex0);
      gl.bindVertexArray(vao);
      return n;
    };
    gl.useProgram(prog); applyLinOut(gl, prog);
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
    let deep = tintRuns.length;
    for (const b of batches) if (b.solid) deep++;
    for (const sp of kept) if (sp.g.part.solid) deep++;
    if (deep) {
      gl.uniform1f(loc.cut, DEPTH_CUT);
      gl.colorMask(false, false, false, false);
      gl.depthMask(true);
      keptRun(true);
      for (const [f, c] of tintRuns) range(f, c);
      multi(whiteOf().tex);
      // The solid batches on one texture in a row are one call, the plain ones between skipped.
      let tex0 = null;
      for (const b of batches) {
        if (!b.solid) continue;
        if (b.tex !== tex0) { multi(tex0); tex0 = b.tex; }
        range(b.first, b.count);
      }
      multi(tex0);
      gl.depthMask(false);
      gl.colorMask(true, true, true, true);
    }
    gl.uniform1f(loc.cut, COLOUR_CUT);
    // Batches lie end to end in the buffer, so a row of them on one texture is one range.
    let n = keptRun(false), tex0 = null;
    for (const b of batches) {
      if (b.tex !== tex0) { multi(tex0); tex0 = b.tex; }
      range(b.first, b.count);
      n += b.count / 6;
    }
    multi(tex0);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return n;
  }

  // ⚠ A DECAL COUNT SAYS NOTHING ABOUT WHAT THIS LAYER COSTS, AND THAT COST A WRONG DIAGNOSIS.
  // Quads are grouped by texture, so a thousand decals sharing one baked canvas are ONE draw call
  // and a thousand carrying their own artwork are a thousand — two frames reporting the identical
  // 'decals' number and an order of magnitude apart in binds. 'batches' is the number that tracks
  // the clock (the last draw's texture binds, both passes), and until it was published the only
  // figure a bench could read was the one that does not. 'textures' beside it is how much artwork
  // is resident, on pages or not; 'own' is how near the textures of their own are to MAX_TEX, which
  // is where it stops merely filling and starts evicting something every frame.
  return {
    upload, draw,
    get textures() { return own.size + onPage.size; }, get own() { return own.size; }, get pages() { return pages.length; },
    get batches() { return binds; }, get minted() { return MINTED; },
  };
}

declareProgram(VERT, FRAG);
