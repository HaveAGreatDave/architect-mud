// WHAT STANDS ON THE GROUND, ON THE DEPTH BUFFER.
//
// Trees, bushes, cacti, hoodoos, rocks, bones. Every one of them is a BILLBOARD already — the 2-D
// renderer projects the tile's ground point and paints a shape upward from it at a screen size of
// `propS(k, f, …)`, which is `k/f` clamped. It never had a third dimension to lose.
//
// ⚠ SO WHY MOVE THEM AT ALL. Because a painter's queue hides things by painting over them, and with
// the city's mass on the GPU it is composited BEFORE the 2-D pass — nothing can paint over a bush
// afterwards. The probe that stood in for that (`groundHidden` → `decoHidden`) asks whether the box
// around the tree's GROUND POINT is covered, and a tree whose base is clear of a tower while its
// canopy leans across it is both the common case and the one the probe answers "draw" to. Measured
// on four different towers: 0.8–1.1% of the silhouette, every time, model-independent. There is no
// threshold that separates those two cases, because the question is per pixel.
//
// ⚠ AND THE ARTWORK IS STILL THE 2-D CODE'S. Nothing here knows what a cactus looks like. The
// caller paints one into a canvas through the SAME function that paints it on the windscreen, at a
// stub depth, and hands the canvas over. `propS` is `k/f`, so a shape baked at depth 1 is that same
// shape at depth f scaled by 1/f — one texture serves every distance, and the two renderers cannot
// disagree about what a species looks like because there is only one drawing of it.
//
// ⚠ DEPTH-TESTED, DEPTH-WRITE OFF. A bush must not punch its own alpha-shaped hole in the depth
// buffer: the quad is mostly empty, and writing depth from it would let the empty half occlude
// whatever is behind. Testing is the whole point; writing would be a second bug.
//
// ⚠ EXCEPT FOR WHAT FLIES, WHICH IS AN OPT-IN AND HAD TO BE. A billboard writes no depth, so it
// leaves nothing behind for a LATER pass to sort against — and there is exactly one later pass:
// the cloud deck, which clears colour only and tests against the depth the world left. A goose and
// an air contact are the two billboards that habitually share sky with a cloud, and both were
// painted over by the deck whatever their altitude: the deck is drawn after the world and the
// depth buffer, at the birds' own pixels, still held the ground four hundred tiles away. Nothing
// on the ground has this problem, because a cloud is never in front of a tree.
//
// ⚠ AND IT IS A DEPTH-ONLY PREPASS, NEVER A RAISED CUTOFF ON THE ONE DRAW. The obvious version
// discards below ~0.5 and writes depth in the same pass, which also deletes every texel between
// 0.004 and 0.5 from the PICTURE — a goose's antialiased rim, and on a contact the canopy glass,
// the nav-lamp glow and the exhaust, none of which are fringe. So the colour pass is byte-for-byte
// the one that always shipped, and a second draw with `colorMask` off lays the silhouette into the
// depth buffer ahead of it. ⚠ With no batch asking for it the prepass is not merely cheap, it is
// the absence of a code path — which is what makes the flag's `0` provably the old renderer.
import { viewProjMatrix, mat4f } from './camera.js';
import { makeVertexStream } from './stream.js';

// What alpha counts as the SHAPE rather than as its edge, in the depth-only prepass. A billboard is
// baked from flat fills, so its interior is 1 and only the rim is between; half is the middle of
// the rim and moves the silhouette by well under a pixel.
const DEPTH_CUT = 0.5;
const COLOUR_CUT = 0.004;

// How far up a sprite to look for open sky, as a FRACTION OF THE TEXTURE'S HEIGHT rather than in
// texels — every scatter bake is 192 tall and the landmark bakes are not, and a cap should be a
// share of the thing it sits on at any size. At a full fall that is about a tenth of a tree.
const SNOW_REACH = 0.055;
// What a fully exposed texel comes out at. Above 1 so the top of the band saturates and the cap
// has a solid core with a soft lower edge, rather than being a uniform half-wash.
const SNOW_GAIN = 1.3;
// The floor's own snow colour, for a frame that hands none over. Only a caller that has not been
// wired up gets this, and it is the un-dimmed daylight value on purpose: a wrong white at noon is
// visible, where a wrong white at midnight looks like the feature working.
const SNOW_FALLBACK = [0.93, 0.95, 0.99];

// pos3, pixel offset2, uv2, alpha1
const STRIDE = 8;

const VERT = `#version 300 es
in vec3 aPos;
in vec2 aOff;
in vec2 aUV;
in float aAlpha;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec2 vUV;
out float vAlpha;
out float vFog;
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  // The corner offset is in PIXELS, applied after the perspective divide — the same trick the
  // lights use, and what makes the billboard exactly the size the 2-D painter draws.
  clip.xy += aOff * (2.0 / uViewport) * clip.w;
  gl_Position = clip;
  vUV = aUV;
  vAlpha = aAlpha;
  // GLASS's own fog curve, on the ANCHOR's depth rather than per pixel: the 2-D drawers tint the
  // whole shape by fogTint(col, p.f) at the ground point, so tinting per pixel would be a
  // difference rather than a fix.
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
in float vFog;
uniform sampler2D uTex;
uniform vec3 uFog;
uniform float uCut;
uniform float uCutFade;
// ── SNOW ON WHAT STANDS ON THE GROUND ───────────────────────────────────────
// How deep it lies this frame (0-1, integrated in windshield.js — see SNOW_NOW), how much of that
// THIS species keeps (a boulder crown takes as much as the ground beside it, a tumbleweed takes
// almost none), and what colour it comes out. The colour is the FLOOR's own snow colour, handed
// down rather than restated, so a capped bush and the field it is standing in are the same white
// at the same hour — two constants here would be two snows that drift apart at dusk.
uniform float uSnow;
uniform float uSnowHold;
uniform vec3 uSnowCol;
// ⚠ INTERPOLATED, BECAUSE A JS CONST IS NOT A GLSL ONE. Both of these are tuning numbers the
// prose above owns, and spelled bare into the shader source they are undeclared identifiers —
// which does not draw a wrong billboard, it fails the COMPILE, and a throw in here takes the
// whole GL world pass down with it: the city falls back to 2-D mid-frame, so the ground comes
// out the wrong biome and a massif keeps its hairlines and loses its faces.
const float SNOW_REACH = ${SNOW_REACH.toFixed(4)};
const float SNOW_GAIN = ${SNOW_GAIN.toFixed(4)};
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUV);        // premultiplied on upload
  // ⚠ THE QUAD'S OWN ALPHA COUNTS IN THE DEPTH PREPASS AND NOWHERE ELSE. A goose dissolving into
  // the far haze and a bogey faded by distance are both drawn at a fraction of themselves, and a
  // shape that is 40% there must not take 100% of the cloud behind it — that is a bird-shaped HOLE
  // in the deck, which is a worse artefact than the one this fixes and it sits exactly at the fade
  // where every flock spends most of its time. 'uCutFade' is 0 in the colour pass, so 'cover' is
  // 't.a' and that test is the one that always shipped, to the bit.
  float cover = t.a * mix(1.0, vAlpha, uCutFade);
  if (cover < uCut) discard;
  // Un-premultiply to mix the colour, then re-premultiply — mixing a premultiplied colour toward
  // an opaque fog washes the edges out instead of tinting them.
  vec3 c = t.rgb / max(t.a, 1e-4);
  // ── ⚠ A BILLBOARD HAS NO NORMAL, SO THE SPRITE'S OWN ALPHA IS ASKED INSTEAD ─────────────────
  //
  // Every other pass that takes snow has a surface to test: the mass reads n0.z, the ground and
  // the floor are the ground. A billboard is a flat card that always faces you and there is no
  // third dimension in it to have lost — so the question has to be asked the other way round.
  // Snow lies on what has SKY ABOVE IT, and for a sprite that is a thing the texture already
  // knows: walk a short way up in UV and count how much of what you pass is empty. A texel at the
  // top of a canopy has nothing over it and takes the lot; one under a cactus arm or buried in the
  // middle of a boulder has its own species over it and takes none, which is the sheltering an
  // overhang does for free. Same family as the relief the mass pass recovers from the albedo's own
  // luminance gradient: a texture read as a height field it never had.
  //
  // ⚠ AND IT IS THE ALPHA, NEVER THE LUMINANCE. The bright parts of these bakes are bright for
  // reasons that have nothing to do with facing the sky — a lit cactus rib, the white of a bone,
  // the sun side of a mesa — so a luminance read whitens whatever is already pale and calls it
  // weather. Coverage is geometric and cannot be wrong about that.
  //
  // ⚠ THE CAP DEEPENS WITH THE FALL, which is the same expression the mass pass is written around
  // and most of what makes this read as weather rather than as paint: a dusting is a line along
  // the top edge, and it takes a real fall before a shape carries a visible crown. Written as a
  // fixed reach instead, the first flake and the last put the same white hat on every tree.
  //
  // ⚠ AND THERE IS DELIBERATELY NO PER-TREE BREAK. The obvious next thought is to hash the anchor
  // so one tree carries more than the next, and the anchor is CAMERA-RELATIVE — the map window
  // recentres as you drive, so that hash changes every frame for a tree that has not moved, and
  // the cap would crawl. It is the dx/dy-in-a-cache-key trap wearing a different hat. What does
  // vary already is the silhouette: twelve baked variants per species, each with its own top edge.
  float sw = uSnow * uSnowHold;
  if (sw > 0.001) {
    float reach = SNOW_REACH * (0.30 + 0.70 * sw);
    // Four taps straight up. CLAMP_TO_EDGE means a tap off the top of the canvas reads the top
    // row, which on every one of these bakes is empty — and on one that was not, it would read as
    // a sprite taking no snow rather than as a wrong answer, which is the safe direction.
    float open = 4.0
      - texture(uTex, vUV + vec2(0.0, -reach * 0.25)).a
      - texture(uTex, vUV + vec2(0.0, -reach * 0.50)).a
      - texture(uTex, vUV + vec2(0.0, -reach * 0.75)).a
      - texture(uTex, vUV + vec2(0.0, -reach       )).a;
    c = mix(c, uSnowCol, clamp(open * 0.25 * sw * SNOW_GAIN, 0.0, 1.0));
  }
  c = mix(c, uFog, vFog);
  float a = t.a * vAlpha;
  outColor = vec4(c * a, a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' billboard shader: ' + log);
  }
  return sh;
}

const MAX_TEX = 256;

// One billboard is `{ key, img, x, y, z, w, h, ax, ay, alpha }` — the cache key and canvas for the
// species, the world anchor, the quad's size in SCREEN PIXELS, and where inside that quad the
// anchor sits (ax across from the left, ay down from the top, both in pixels).
export function createBillboardLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('billboard link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    off: gl.getAttribLocation(prog, 'aOff'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    viewport: gl.getUniformLocation(prog, 'uViewport'),
    tex: gl.getUniformLocation(prog, 'uTex'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    cut: gl.getUniformLocation(prog, 'uCut'),
    cutFade: gl.getUniformLocation(prog, 'uCutFade'),
    snow: gl.getUniformLocation(prog, 'uSnow'),
    snowHold: gl.getUniformLocation(prog, 'uSnowHold'),
    snowCol: gl.getUniformLocation(prog, 'uSnowCol'),
  };

  const vao = gl.createVertexArray();
  // One stream, set up once: the attribute pointers are recorded into the VAO here and never
  // touched again, and the storage grows by doubling instead of being reallocated every frame.
  // See gl/stream.js.
  const stream = makeVertexStream(gl, vao, STRIDE, [[loc.pos, 3, 0], [loc.off, 2, 12], [loc.uv, 2, 20], [loc.alpha, 1, 28]], 2048);
  let data = new Float32Array(0);
  const texes = new Map();
  let batches = [];

  // ⚠ `fresh` IS FOR A BAKE THAT IS NOT THE SAME PICTURE TWICE. Scatter is keyed on what a species
  // LOOKS like, so one cactus texture serves every cactus for the life of the page and the cache is
  // the whole point. A landmark baked at the real camera changes with every frame — it is drawn
  // through the live projection so that its pixels land where the 2-D pass would have put them —
  // and a key-cached texture would freeze the first frame it was ever seen from and hold it. Same
  // texture object, re-uploaded; the key still batches, so nothing else about the layer changes.
  function textureFor(key, img, fresh, flipY) {
    let t = texes.get(key);
    if (t) {
      if (fresh) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        if (flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        if (flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      }
      return t;
    }
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (flipY) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // Scatter is nearly always MINIFIED — a bush baked at 34px drawn at six — so linear is the
    // right filter here, unlike the wall textures, which are magnified and go blurry on it.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    texes.set(key, t);
    return t;
  }

  // ⚠ EVICTION HAPPENS HERE, BEFORE ANYTHING IS ALLOCATED, AND NEVER TOUCHES A KEY THIS FRAME
  // USES. It used to sit inside textureFor, taking the oldest-inserted entry — which is exactly
  // the wrong one: the oldest entries are the STABLE keys (a bush, a cactus, the gate on its own
  // tile), and by the time a later key needs room those textures are already sitting in `batches`
  // waiting to be drawn. `gl.deleteTexture` on one of them leaves the batch pointing at a dead
  // texture, and a dead texture samples as whatever the driver hands back.
  //
  // ⚠ AND IT IS NOT A THEORETICAL CAP. Three callers keyed their bakes on CAMERA-RELATIVE dx/dy
  // (see markBillboard in windshield.js), so every mast, lattice tower and neon blade in view
  // minted a brand-new key every frame — two hundred and fifty-six of them go by in a couple of
  // seconds from an external camera over a city. Reported as the scatter turning bright pink, and
  // as a gate drawn as a hovering bush.
  function evict(live) {
    let need = 0;
    for (const k of live.keys()) if (!texes.has(k)) need++;
    if (texes.size + need <= MAX_TEX) return;
    for (const [k, t] of [...texes]) {
      if (texes.size + need <= MAX_TEX) break;
      if (live.has(k)) continue;                 // drawn this frame — deleting it is the bug
      gl.deleteTexture(t); texes.delete(k);
    }
  }

  function upload(list) {
    const byKey = new Map();
    for (const b of list) {
      if (!b || !b.img || !(b.w > 0) || !(b.h > 0)) continue;
      // ⚠ THE SNOW HOLD IS NOT A PER-VERTEX ATTRIBUTE, AND THAT IS NOT A SHORTCUT. It is a
      // property of the SPECIES — how much snow a boulder keeps against how much a tumbleweed
      // does — and the batch key IS the species, because the texture is what a species looks
      // like. So every quad under one key agrees about it by construction, it costs one uniform
      // per batch instead of a float per vertex, and the vertex buffer every billboard in the
      // frame shares is byte-for-byte the one that always shipped. Unlike `depth`, it therefore
      // cannot force a batch split: two quads sharing a texture cannot disagree.
      let a = byKey.get(b.key); if (!a) byKey.set(b.key, a = { img: b.img, fresh: !!b.fresh, flipY: !!b.flipY, snow: b.snow || 0, items: [], deep: [] });
      (b.depth ? a.deep : a.items).push(b);
    }
    evict(byKey);
    let quads = 0;
    for (const a of byKey.values()) quads += a.items.length + a.deep.length;
    const verts = quads * 6;
    if (data.length < verts * STRIDE) data = new Float32Array(Math.max(verts * STRIDE, 2048));
    batches = [];
    let o = 0, first = 0;
    const put = (b, ox, oy, u, v) => {
      data[o] = b.x; data[o + 1] = b.y; data[o + 2] = b.z;
      data[o + 3] = ox; data[o + 4] = oy;
      data[o + 5] = u; data[o + 6] = v;
      data[o + 7] = b.alpha == null ? 1 : b.alpha;
      o += STRIDE;
    };
    const quad = (b) => {
      // The anchor is the tile's ground point. `ax`/`ay` say where that point sits inside the
      // baked canvas, so the quad hangs off it exactly as the 2-D drawing did around it.
      const L = -b.ax, R = b.w - b.ax, T = -b.ay, B = b.h - b.ay;
      // ⚠ `rot` TURNS THE CORNERS, NEVER THE TEXTURE, and it is what lets a bird bank without a
      // texture per bank angle: one baked pose, rotated about its own anchor. The offsets are in
      // SCREEN pixels with y DOWN (see the T/B assignment above, which puts the canvas's top row at
      // a negative offset), so this is the same clockwise sense `ctx.rotate` gives the 2-D path —
      // which is what keeps the two renderers drawing one bird.
      // ⚠ AND THE ZERO CASE IS NOT A CODE PATH. Every billboard but the geese omits `rot`, so the
      // corners are the ones that always shipped, to the bit.
      if (b.rot) {
        const c = Math.cos(b.rot), s = Math.sin(b.rot);
        const rx = (x, y) => x * c - y * s, ry = (x, y) => x * s + y * c;
        const q0 = b.flip ? 1 : 0, q1 = b.flip ? 0 : 1;
        put(b, rx(L, T), ry(L, T), q0, 0); put(b, rx(R, T), ry(R, T), q1, 0); put(b, rx(R, B), ry(R, B), q1, 1);
        put(b, rx(L, T), ry(L, T), q0, 0); put(b, rx(R, B), ry(R, B), q1, 1); put(b, rx(L, B), ry(L, B), q0, 1);
        return;
      }
      // ⚠ A MIRROR IS A FREE SILHOUETTE. It swaps the texture's u, so a mirrored card is the
      // SAME texture drawn the other way round — no second bake, no second cache entry, and
      // therefore nothing taken from a budget whose overflow is this layer's worst failure. The
      // scatter uses it to get two silhouettes out of every card it already had.
      // ⚠ AND THE ZERO CASE IS NOT A CODE PATH, the rule `rot` above already follows: with no
      // flip the constants are the ones that always shipped, to the bit.
      const u0 = b.flip ? 1 : 0, u1 = b.flip ? 0 : 1;
      put(b, L, T, u0, 0); put(b, R, T, u1, 0); put(b, R, B, u1, 1);
      put(b, L, T, u0, 0); put(b, R, B, u1, 1); put(b, L, B, u0, 1);
    };
    for (const [key, a] of byKey) {
      // ⚠ ONE TEXTURE, UP TO TWO BATCHES. `depth` is GL STATE set once per draw call, so it belongs
      // in the batch grouping and not merely on the item — the same rule `cull` follows in the
      // decal layer, and for the same reason: two quads sharing a texture and disagreeing about it
      // would be one draw, and one of them would silently get the other's answer. It stays OUT of
      // the texture cache key, which is what `evict` reads: keying the cache on it would upload the
      // same species twice and halve a cache whose overflow is already the layer's worst failure.
      const tex = textureFor(key, a.img, a.fresh, a.flipY);
      for (const b of a.items) quad(b);
      if (a.items.length) { const n = a.items.length * 6; batches.push({ tex, first, count: n, depth: false, snow: a.snow }); first += n; }
      for (const b of a.deep) quad(b);
      if (a.deep.length) { const n = a.deep.length * 6; batches.push({ tex, first, count: n, depth: true, snow: a.snow }); first += n; }
    }
    stream.write(data, verts * STRIDE);
    return quads;
  }

  function draw(cam, W, H, cssH, fog, snow) {
    if (!batches.length) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, mat4f(viewProjMatrix(cam, cssH || H)));
    gl.uniform2f(loc.viewport, W, H);
    const f = fog || {};
    const c = f.col || [0.5, 0.5, 0.55];
    gl.uniform3f(loc.fog, c[0], c[1], c[2]);
    gl.uniform1f(loc.fogNear, f.near == null ? 6 : f.near);
    gl.uniform1f(loc.fogFar, f.far == null ? 34 : f.far);
    gl.uniform1f(loc.fogAmt, f.amt || 0);
    // ⚠ WRITTEN EVERY FRAME INCLUDING THE BARE ONES. A uniform holds its last value, so a layer
    // that set this only when it had snow would leave every bush in the world wearing a cap for
    // the rest of the session after one blizzard thawed. Same trap the floor and the ground pass
    // are written around, and `gl:snow` asserts it for all three.
    const sn = snow || {};
    const sd = sn.depth > 0 ? sn.depth : 0;
    gl.uniform1f(loc.snow, sd);
    const sc = sn.col || SNOW_FALLBACK;
    gl.uniform3f(loc.snowCol, sc[0], sc[1], sc[2]);
    gl.uniform1i(loc.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    // ⚠ STATED HERE RATHER THAN INHERITED, because the prepass below makes it load-bearing: it
    // lays the quad's own depth down first, so under the GL default of LESS the colour pass would
    // then fail its own test at every pixel and the bird would simply not be drawn. Every pass in
    // this renderer already sets LEQUAL; what changed is that this one now depends on it.
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);       // see the ⚠ at the top: a mostly-empty quad must not write depth
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    // The silhouette of what flies, into the depth buffer only — see the ⚠ at the top. Nothing is
    // written to the colour buffer here, so the pass below is unchanged for every billboard
    // including these; all this leaves behind is a depth the CLOUD deck can sort against.
    let deep = 0;
    for (const b of batches) if (b.depth) deep++;
    if (deep) {
      gl.uniform1f(loc.cut, DEPTH_CUT);
      gl.uniform1f(loc.cutFade, 1);
      gl.colorMask(false, false, false, false);
      gl.depthMask(true);
      for (const b of batches) {
        if (!b.depth) continue;
        gl.bindTexture(gl.TEXTURE_2D, b.tex);
        gl.drawArrays(gl.TRIANGLES, b.first, b.count);
      }
      gl.depthMask(false);
      gl.colorMask(true, true, true, true);
    }
    gl.uniform1f(loc.cut, COLOUR_CUT);
    gl.uniform1f(loc.cutFade, 0);
    let n = 0;
    // ⚠ AND WITH NO SNOW IN THE FRAME THE PER-BATCH WRITE IS NOT A CODE PATH. One uniform at zero
    // guards the shader branch for every species at once, which is what makes `glSnowBB: 0`
    // provably the layer that shipped rather than the layer running at a small number.
    if (!sd) gl.uniform1f(loc.snowHold, 0);
    for (const b of batches) {
      // ⚠ PER BATCH, AND NOT ONLY FOR THE SNOWY ONES: a species that skipped the write would take
      // the hold of whichever one happened to draw before it.
      if (sd) gl.uniform1f(loc.snowHold, b.snow || 0);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.drawArrays(gl.TRIANGLES, b.first, b.count);
      n += b.count / 6;
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    return n;
  }

  return { upload, draw, get textures() { return texes.size; } };
}
