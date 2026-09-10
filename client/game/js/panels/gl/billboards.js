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
import { viewProjMatrix } from './camera.js';

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
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUV);        // premultiplied on upload
  if (t.a < 0.004) discard;
  // Un-premultiply to mix the colour, then re-premultiply — mixing a premultiplied colour toward
  // an opaque fog washes the edges out instead of tinting them.
  vec3 c = t.rgb / max(t.a, 1e-4);
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
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
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
      let a = byKey.get(b.key); if (!a) byKey.set(b.key, a = { img: b.img, fresh: !!b.fresh, flipY: !!b.flipY, items: [] });
      a.items.push(b);
    }
    evict(byKey);
    let quads = 0;
    for (const a of byKey.values()) quads += a.items.length;
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
    for (const [key, a] of byKey) {
      for (const b of a.items) {
        // The anchor is the tile's ground point. `ax`/`ay` say where that point sits inside the
        // baked canvas, so the quad hangs off it exactly as the 2-D drawing did around it.
        const L = -b.ax, R = b.w - b.ax, T = -b.ay, B = b.h - b.ay;
        put(b, L, T, 0, 0); put(b, R, T, 1, 0); put(b, R, B, 1, 1);
        put(b, L, T, 0, 0); put(b, R, B, 1, 1); put(b, L, B, 0, 1);
      }
      const n = a.items.length * 6;
      batches.push({ tex: textureFor(key, a.img, a.fresh, a.flipY), first, count: n });
      first += n;
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, verts * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.pos, 3, 0); bind(loc.off, 2, 12); bind(loc.uv, 2, 20); bind(loc.alpha, 1, 28);
    gl.bindVertexArray(null);
    return quads;
  }

  function draw(cam, W, H, cssH, fog) {
    if (!batches.length) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, cssH || H)));
    gl.uniform2f(loc.viewport, W, H);
    const f = fog || {};
    const c = f.col || [0.5, 0.5, 0.55];
    gl.uniform3f(loc.fog, c[0], c[1], c[2]);
    gl.uniform1f(loc.fogNear, f.near == null ? 6 : f.near);
    gl.uniform1f(loc.fogFar, f.far == null ? 34 : f.far);
    gl.uniform1f(loc.fogAmt, f.amt || 0);
    gl.uniform1i(loc.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);       // see the ⚠ at the top: a mostly-empty quad must not write depth
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
