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
import { viewProjMatrix } from './camera.js';

// pos3, uv2, alpha1, emit1
const STRIDE = 7;
// A cap on the texture cache. Signs are keyed by their own appearance (label, colour, night), so
// the working set is the signs you can see; the cap is a backstop against a key that varies
// continuously, which would otherwise leak a texture per frame.
const MAX_TEX = 192;

const VERT = `#version 300 es
in vec3 aPos;
in vec2 aUV;
in float aAlpha;
in float aEmit;
uniform mat4 uViewProj;
out vec2 vUV;
out float vAlpha;
out float vEmit;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUV = aUV;
  vAlpha = aAlpha;
  vEmit = aEmit;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
in float vEmit;
uniform sampler2D uTex;
uniform float uCull;
uniform float uFlip;
uniform float uEmitGain;
out vec4 outColor;
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
  if (t.a < 0.002) discard;   // a sign's canvas is mostly empty; do not pay to blend nothing
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
  outColor = vec4(t.rgb * (1.0 + vEmit * uEmitGain), t.a);
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
// camera-relative tile frame the lights and the Curtain use.
export function createDecalLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('decal link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    emit: gl.getAttribLocation(prog, 'aEmit'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    tex: gl.getUniformLocation(prog, 'uTex'),
    cull: gl.getUniformLocation(prog, 'uCull'),
    flip: gl.getUniformLocation(prog, 'uFlip'),
    emitGain: gl.getUniformLocation(prog, 'uEmitGain'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  const texes = new Map();          // key → WebGLTexture
  let batches = [];                 // { tex, first, count }

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
    t = gl.createTexture();
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
  function upload(list) {
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
      let a = byKey.get(gk); if (!a) byKey.set(gk, a = { img: d.img, key: d.key, cull: !!d.cull, smooth: !!d.smooth, items: [] });
      a.items.push(d);
    }
    // Which TEXTURES this frame draws — `a.key`, never the grouping key. See the ⚠ on evict.
    const liveTex = new Set();
    for (const a of byKey.values()) liveTex.add(a.key);
    evict(liveTex);
    let quads = 0;
    for (const a of byKey.values()) quads += a.items.length;
    const verts = quads * 6;
    if (data.length < verts * STRIDE) data = new Float32Array(Math.max(verts * STRIDE, 1024));
    batches = [];
    let o = 0, first = 0;
    const put = (p, u, v, a, e) => {
      data[o] = p[0]; data[o + 1] = p[1]; data[o + 2] = p[2];
      data[o + 3] = u; data[o + 4] = v; data[o + 5] = a; data[o + 6] = e;
      o += STRIDE;
    };
    for (const a of byKey.values()) {
      for (const d of a.items) {
        const [TL, TR, BR, BL] = d.p, al = d.alpha == null ? 1 : d.alpha;
        // 0 is "this is paint" and is the default, so a producer that has never heard of emission
        // draws exactly what it drew before at any gain — see the ⚠ in the fragment shader.
        const em = d.emit > 0 ? d.emit : 0;
        put(TL, 0, 0, al, em); put(TR, 1, 0, al, em); put(BR, 1, 1, al, em);
        put(TL, 0, 0, al, em); put(BR, 1, 1, al, em); put(BL, 0, 1, al, em);
      }
      const n = a.items.length * 6;
      // The TEXTURE cache is keyed on the appearance alone — the same artwork culled and unculled
      // is one upload — so `a.key` and not the grouping key.
      batches.push({ tex: textureFor(a.key, a.img, a.smooth), first, count: n, cull: a.cull });
      first += n;
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, verts * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.pos, 3, 0); bind(loc.uv, 2, 12); bind(loc.alpha, 1, 20); bind(loc.emit, 1, 24);
    gl.bindVertexArray(null);
    return quads;
  }

  // ⚠ `emitGain` IS 0 WITHOUT THE FLOAT TARGET AND THAT IS NOT A STYLE CHOICE. Against the 8-bit
  // buffer an over-range sign clamps on the way in, so the whole gradient of a lit tube saturates to
  // flat white — the same mistake EMISSIVE_GAIN shipped at 3 and had to be walked back from. The
  // headroom to hold it is the float target, so the caller only ever sends a gain when there is one.
  function draw(cam, H, emitGain = 0) {
    if (!batches.length) return 0;
    gl.useProgram(prog);
    gl.uniform1f(loc.emitGain, emitGain > 0 ? emitGain : 0);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, H)));
    // Whether this camera reflects the world — see the ⚠ on `uFlip`. Read off the camera itself so
    // a caller cannot hand over a mirrored matrix and forget to say so.
    gl.uniform1f(loc.flip, cam.mirrorZ == null ? 0 : 1);
    gl.uniform1i(loc.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);        // a sign is on a wall, not a wall
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    let n = 0;
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

  return { upload, draw, get textures() { return texes.size; } };
}
