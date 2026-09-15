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

// pos3, uv2, alpha1
const STRIDE = 6;
// A cap on the texture cache. Signs are keyed by their own appearance (label, colour, night), so
// the working set is the signs you can see; the cap is a backstop against a key that varies
// continuously, which would otherwise leak a texture per frame.
const MAX_TEX = 192;

const VERT = `#version 300 es
in vec3 aPos;
in vec2 aUV;
in float aAlpha;
uniform mat4 uViewProj;
out vec2 vUV;
out float vAlpha;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vUV = aUV;
  vAlpha = aAlpha;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vAlpha;
uniform sampler2D uTex;
uniform float uCull;
uniform float uFlip;
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
  outColor = t;
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
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    tex: gl.getUniformLocation(prog, 'uTex'),
    cull: gl.getUniformLocation(prog, 'uCull'),
    flip: gl.getUniformLocation(prog, 'uFlip'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  const texes = new Map();          // key → WebGLTexture
  let batches = [];                 // { tex, first, count }

  function textureFor(key, img) {
    let t = texes.get(key);
    if (t) return t;
    if (texes.size >= MAX_TEX) { const [k0, t0] = texes.entries().next().value; gl.deleteTexture(t0); texes.delete(k0); }
    t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // ⚠ LINEAR ON MINIFY, NEAREST ON MAGNIFY — the same split the wall textures needed. GLASS
    // smooths a texture only when it is shrinking it; magnifying with LINEAR turns a near sign into
    // a grey wash, which is what made every close facade look unlit before this was corrected there.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
      let a = byKey.get(gk); if (!a) byKey.set(gk, a = { img: d.img, key: d.key, cull: !!d.cull, items: [] });
      a.items.push(d);
    }
    let quads = 0;
    for (const a of byKey.values()) quads += a.items.length;
    const verts = quads * 6;
    if (data.length < verts * STRIDE) data = new Float32Array(Math.max(verts * STRIDE, 1024));
    batches = [];
    let o = 0, first = 0;
    const put = (p, u, v, a) => {
      data[o] = p[0]; data[o + 1] = p[1]; data[o + 2] = p[2];
      data[o + 3] = u; data[o + 4] = v; data[o + 5] = a;
      o += STRIDE;
    };
    for (const a of byKey.values()) {
      for (const d of a.items) {
        const [TL, TR, BR, BL] = d.p, al = d.alpha == null ? 1 : d.alpha;
        put(TL, 0, 0, al); put(TR, 1, 0, al); put(BR, 1, 1, al);
        put(TL, 0, 0, al); put(BR, 1, 1, al); put(BL, 0, 1, al);
      }
      const n = a.items.length * 6;
      // The TEXTURE cache is keyed on the appearance alone — the same artwork culled and unculled
      // is one upload — so `a.key` and not the grouping key.
      batches.push({ tex: textureFor(a.key, a.img), first, count: n, cull: a.cull });
      first += n;
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, verts * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.pos, 3, 0); bind(loc.uv, 2, 12); bind(loc.alpha, 1, 20);
    gl.bindVertexArray(null);
    return quads;
  }

  function draw(cam, H) {
    if (!batches.length) return 0;
    gl.useProgram(prog);
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
