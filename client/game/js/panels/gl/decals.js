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
out vec4 outColor;
void main() {
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
      let a = byKey.get(d.key); if (!a) byKey.set(d.key, a = { img: d.img, items: [] });
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
    for (const [key, a] of byKey) {
      for (const d of a.items) {
        const [TL, TR, BR, BL] = d.p, al = d.alpha == null ? 1 : d.alpha;
        put(TL, 0, 0, al); put(TR, 1, 0, al); put(BR, 1, 1, al);
        put(TL, 0, 0, al); put(BR, 1, 1, al); put(BL, 0, 1, al);
      }
      const n = a.items.length * 6;
      batches.push({ tex: textureFor(key, a.img), first, count: n });
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
