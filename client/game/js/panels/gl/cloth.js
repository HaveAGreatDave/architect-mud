// CLOTH AS INSTANCED MESHES, ITS FLUTTER BAKED INTO A TEXTURE.
//
// Windsocks, the pier flag and the Pitch's tents (cloth3d.js holds the meshes and the bake).
// windshield.js hands each one over as a record in the solids list with `cloth: 1`; context.js splits
// them out to here, and they are drawn by the same two calls the birds are (the mirror prepass and the
// main pass). One instanced draw per kind.
//
// It is gl/fauna.js's scheme: per-vertex frames in an RGBA16F texture, read by gl_VertexID, with a
// small record per instance. The instance picks the two wind bands either side of its wind strength
// and the two frames either side of its phase, and blends all four.
//
// The shading is the walls' (context.js's mass shader): a key-light term off the frame's own light,
// the sky colour on the lit top and the shadow colour pooling toward the foot, times the night dim,
// so a tent stands in the same light as the building beside it. On top of that a record carries its
// own `warm`: light from the lamps and braziers near it, worked out on the CPU because it is fixed
// per pitch. The weathering is `clothTex`'s, done in the fragment shader: grain, a bleached head,
// dirt rising from the foot. A record can carry a patch (a rectangle of its second colour on face 0)
// and a piece of paint out of the atlas windshield.js bakes (graffiti, or the flag's device).
import { viewProjMatrix } from './camera.js';
import { makeVertexStream } from './stream.js';
import { clothBake, CLOTH_KINDS, CLOTH_BANDS, CLOTH_FRAMES } from '../cloth3d.js';
import { declareProgram, takeWarm } from './programs.js';

// Per instance: x, y, z, heading | sx, sy, sz, wind | phase, seed, alpha, lum | colour A rgb |
// colour B rgb | warm rgb | patch u0 v0 u1 v1 | paint cell, u0, v0, size | weathering
const STRIDE = 30;
// Units no other layer binds: 0-5 the world pass, 7 fauna.js, 8-17 the murmuration, 20-21 actors.js.
const POS_UNIT = 24, TAG_UNIT = 25;

const VERT = `#version 300 es
precision highp float;
precision highp int;
in vec2 aUV;
in float aFace;
in float aMat;
in vec4 iPos;
in vec4 iDim;
in vec4 iAnim;
in vec3 iColA;
in vec3 iColB;
in vec3 iWarm;
in vec4 iPatch;
in vec4 iTag;
in float iWeather;
uniform highp sampler2D uPosT;
uniform int uW;
uniform float uBands;
uniform float uFrames;
uniform mat4 uViewProj;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vW;
out vec2 vUV;
out float vFace;
out float vMat;
out float vFog;
out float vAlpha;
out float vLum;
out float vSeed;
out vec3 vColA;
out vec3 vColB;
out vec3 vWarm;
out vec4 vPatch;
out vec4 vTag;
out float vWeather;
vec3 at(float band, float fr) {
  return texelFetch(uPosT, ivec2(gl_VertexID, int(band) * int(uFrames) + int(fr)), 0).xyz;
}
void main() {
  // Wind picks two bands, phase picks two frames; four texels, blended.
  float wb = clamp(iDim.w, 0.0, 1.0) * (uBands - 1.0);
  float b0 = min(floor(wb), uBands - 2.0);
  float tb = wb - b0;
  float fr = fract(iAnim.x) * uFrames;
  float f0 = floor(fr);
  float f1 = mod(f0 + 1.0, uFrames);
  float tf = fr - f0;
  vec3 p = mix(mix(at(b0, f0), at(b0, f1), tf), mix(at(b0 + 1.0, f0), at(b0 + 1.0, f1), tf), tb);
  // Model x is to the right of the heading, y along it, z up.
  vec2 F = vec2(cos(iPos.w), sin(iPos.w));
  vec2 R = vec2(F.y, -F.x);
  vec3 w = iPos.xyz + vec3(R * (p.x * iDim.x) + F * (p.y * iDim.y), p.z * iDim.z);
  vW = w;
  vUV = aUV;
  vFace = aFace;
  vMat = aMat;
  vSeed = iAnim.y;
  vAlpha = iAnim.z;
  vLum = iAnim.w;
  vColA = iColA;
  vColB = iColB;
  vWarm = iWarm;
  vPatch = iPatch;
  vTag = iTag;
  vWeather = iWeather;
  vec4 clip = uViewProj * vec4(w, 1.0);
  gl_Position = clip;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vW;
in vec2 vUV;
in float vFace;
in float vMat;
in float vFog;
in float vAlpha;
in float vLum;
in float vSeed;
in vec3 vColA;
in vec3 vColB;
in vec3 vWarm;
in vec4 vPatch;
in vec4 vTag;
in float vWeather;
uniform vec3 uFog;
uniform vec3 uEye;
uniform vec2 uKeyDir;
uniform vec3 uKey;
uniform vec3 uSky;
uniform vec3 uShadow;
uniform float uStr;
uniform sampler2D uTagT;
uniform vec2 uTagGrid;
// The city's lights (world.js pickLights), in the tile frame vW is in. 0 lights: nothing added.
uniform int uWLN;
uniform vec3 uWLP[12];
uniform vec3 uWLC[12];
uniform float uWLR[12];
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  if (vAlpha <= 0.002) discard;
  // Flat normal off the surface itself, turned toward the eye: a sheet is seen from both sides.
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(n, uEye - vW) < 0.0) n = -n;
  vec2 uv = vUV;
  vec3 base = vMat > 0.5 ? vColB : vColA;
  bool f0 = vFace < 0.5;
  if (f0 && vPatch.z > vPatch.x && uv.x > vPatch.x && uv.x < vPatch.z && uv.y > vPatch.y && uv.y < vPatch.w) base = vColB;
  // Weathering, clothTex's recipe: grain, a bleached head, dirt rising from the foot to a ragged line.
  if (vWeather > 0.0) {
    float m = 1.0 + (hash(floor(uv * vec2(28.0, 20.0)) + vSeed) - 0.5) * 0.16;
    m *= 1.0 + 0.07 * (1.0 - uv.y);
    float edge = 0.56 + 0.13 * sin(uv.x * 8.2 + vSeed) + 0.07 * sin(uv.x * 19.1 + vSeed * 1.7);
    float dirt = clamp((uv.y - edge) / (1.0 - edge), 0.0, 1.0);
    m *= 1.0 - 0.46 * dirt;
    base = mix(base, base * m * vec3(1.0 + 0.04 * dirt, 1.0, 1.0 - 0.12 * dirt), vWeather);
  }
  // Paint out of the atlas: a cell placed on face 0, or the whole face when size is negative.
  if (vTag.x >= 0.0 && (f0 || vTag.w < 0.0)) {
    vec2 q = vTag.w < 0.0 ? uv : (uv - vTag.yz) / vec2(vTag.w, vTag.w * 0.5);
    if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
      float cell = vTag.x;
      vec2 cxy = vec2(mod(cell, uTagGrid.x), floor(cell / uTagGrid.x));
      vec4 t = texture(uTagT, (cxy + q) / uTagGrid);
      // Paint soaks into cloth: it takes the weave's grain and never reads brighter than a dye.
      base = mix(base, t.rgb * (0.82 + 0.18 * hash(floor(uv * 40.0))), t.a * 0.92);
    }
  }
  // The walls' light: the key's lit side, the sky on top, the shadow pooling toward the foot.
  float up = max(n.z, 0.0);
  float litC = clamp(0.5 + dot(n.xy, uKeyDir) * 0.5, 0.0, 1.0);
  float lit = litC * (1.0 - up) + 0.86 * up;
  vec3 surf = base * (0.50 + 0.48 * lit);
  vec3 topCol = mix(uSky, uKey, lit);
  // Half the walls' top wash: a tarp is matt and dark, and the full wash lifted it past the old flat fill.
  float aTop = uStr * (0.03 + 0.07 * lit);
  float aBot = uStr * (0.30 + 0.22 * (1.0 - lit));
  vec3 shaded = mix(mix(surf, topCol, aTop), mix(surf, uShadow, aBot), clamp(uv.y, 0.0, 1.0));
  // Firelight is coloured by the cloth it lands on, the way a lamp's is.
  vec3 c = shaded * vLum + vWarm * (0.35 + 0.65 * base / max(0.2, max(base.r, max(base.g, base.b)))) * (0.5 + 0.5 * lit);
  // The city's lamps as well as the camp's fires: wrapped and two-sided, as decals.js lights a tarp,
  // because a lamp on the far side of a sheet still shows through it.
  vec3 dye = 0.35 + 0.65 * base / max(0.2, max(base.r, max(base.g, base.b)));
  for (int i = 0; i < 12; i++) {
    if (i >= uWLN) break;
    vec3 d = uWLP[i] - vW;
    float dist = length(d);
    float att = clamp(1.0 - dist / max(0.001, uWLR[i]), 0.0, 1.0);
    if (att <= 0.0) continue;
    float diff = (abs(dot(n, d / max(0.001, dist))) + 0.5) / 1.5;
    c += uWLC[i] * dye * (att * att * diff);
  }
  c = mix(c, uFog, vFog);
  outColor = vec4(c * vAlpha, vAlpha);
}`;

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('cloth ' + label + ': ' + gl.getShaderInfoLog(s));
  return s;
}

export function createClothLayer(gl) {
  // Prewarmed with the context when it can be (programs.js); built here otherwise.
  let prog = takeWarm(gl, VERT, FRAG);
  if (!prog) {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
    gl.linkProgram(prog);
  }
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('cloth link: ' + gl.getProgramInfoLog(prog));
  const A = (n) => gl.getAttribLocation(prog, n);
  const U = (n) => gl.getUniformLocation(prog, n);
  const loc = {
    uv: A('aUV'), face: A('aFace'), mat: A('aMat'),
    pos: A('iPos'), dim: A('iDim'), anim: A('iAnim'), colA: A('iColA'), colB: A('iColB'), warm: A('iWarm'),
    patch: A('iPatch'), tag: A('iTag'), weather: A('iWeather'),
    posT: U('uPosT'), w: U('uW'), bands: U('uBands'), frames: U('uFrames'), viewProj: U('uViewProj'),
    fog: U('uFog'), fogNear: U('uFogNear'), fogFar: U('uFogFar'), fogAmt: U('uFogAmt'),
    wlN: U('uWLN'), wlP: U('uWLP'), wlC: U('uWLC'), wlR: U('uWLR'),
    eye: U('uEye'), keyDir: U('uKeyDir'), key: U('uKey'), sky: U('uSky'), shadow: U('uShadow'), str: U('uStr'),
    tagT: U('uTagT'), tagGrid: U('uTagGrid'),
  };
  const INST = [loc.pos, loc.dim, loc.anim, loc.colA, loc.colB, loc.warm, loc.patch, loc.tag, loc.weather];

  // One mesh per kind, made the first time that kind is drawn.
  const meshes = {};
  function meshFor(kind) {
    if (meshes[kind]) return meshes[kind];
    const bk = clothBake(kind);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = (data, l, n) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, n * 4, 0); }
    };
    vb(bk.uv, loc.uv, 2); vb(bk.face, loc.face, 1); vb(bk.mat, loc.mat, 1);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bk.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const at = (l, n, off) => [l, n, off * 4];
    const stream = makeVertexStream(gl, vao, STRIDE, [
      at(loc.pos, 4, 0), at(loc.dim, 4, 4), at(loc.anim, 4, 8), at(loc.colA, 3, 12), at(loc.colB, 3, 15),
      at(loc.warm, 3, 18), at(loc.patch, 4, 21), at(loc.tag, 4, 25), at(loc.weather, 1, 29),
    ], STRIDE * 64);
    gl.bindVertexArray(vao);
    for (const l of INST) if (l >= 0) gl.vertexAttribDivisor(l, 1);
    gl.bindVertexArray(null);
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + POS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, bk.W, bk.H, 0, gl.RGBA, gl.HALF_FLOAT, bk.pos);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    meshes[kind] = { vao, stream, count: bk.idx.length, posT: t, bk, data: new Float32Array(STRIDE * 16), n: 0 };
    return meshes[kind];
  }

  // The paint atlas: a canvas windshield.js bakes once, re-uploaded only when its `ver` changes.
  let tagTex = null, tagVer = -1, tagGrid = [1, 1];
  function atlasFrom(a) {
    if (!a || !a.canvas || a.ver === tagVer) return;
    if (!tagTex) tagTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + TAG_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, tagTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    tagVer = a.ver; tagGrid = [a.cols, a.rows];
  }

  let n = 0;
  let light = null;

  /**
   * Take this frame's records. Each is { kind, x, y, z, hd, sx, sy, sz, wind, ph, seed, a, lum,
   * colA, colB (0..255 rgb), warm (0..1 rgb), patch [u0,v0,u1,v1] | null, tag { cell, u, v, size } |
   * null, weather, light, atlas }. `light` (the frame's key, sky and shadow) and `atlas` are read off
   * whichever record carries them.
   */
  function upload(recs) {
    n = 0;
    for (const k in meshes) meshes[k].n = 0;
    if (!recs || !recs.length) return 0;
    for (const r of recs) { if (CLOTH_KINDS.includes(r.kind)) meshFor(r.kind).n++; if (r.light) light = r.light; if (r.atlas) atlasFrom(r.atlas); }
    for (const k in meshes) {
      const M = meshes[k];
      if (M.data.length < M.n * STRIDE) M.data = new Float32Array(Math.max(M.n * STRIDE, M.data.length * 2));
      M.n = 0;
    }
    for (const r of recs) {
      const M = meshes[r.kind];
      if (!M) continue;
      const d = M.data, o = M.n * STRIDE;
      d[o] = r.x; d[o + 1] = r.y; d[o + 2] = r.z || 0; d[o + 3] = r.hd || 0;
      d[o + 4] = r.sx ?? 1; d[o + 5] = r.sy ?? 1; d[o + 6] = r.sz ?? 1; d[o + 7] = r.wind || 0;
      d[o + 8] = r.ph || 0; d[o + 9] = r.seed || 0; d[o + 10] = r.a == null ? 1 : r.a; d[o + 11] = r.lum == null ? 1 : r.lum;
      const A = r.colA || [128, 128, 128], Bc = r.colB || A, Wm = r.warm || [0, 0, 0];
      d[o + 12] = A[0] / 255; d[o + 13] = A[1] / 255; d[o + 14] = A[2] / 255;
      d[o + 15] = Bc[0] / 255; d[o + 16] = Bc[1] / 255; d[o + 17] = Bc[2] / 255;
      d[o + 18] = Wm[0]; d[o + 19] = Wm[1]; d[o + 20] = Wm[2];
      const P = r.patch || [0, 0, 0, 0];
      d[o + 21] = P[0]; d[o + 22] = P[1]; d[o + 23] = P[2]; d[o + 24] = P[3];
      const T = r.tag;
      d[o + 25] = T && tagTex ? T.cell : -1; d[o + 26] = T ? T.u || 0 : 0; d[o + 27] = T ? T.v || 0 : 0; d[o + 28] = T ? T.size : 0;
      d[o + 29] = r.weather || 0;
      M.n++; n++;
    }
    for (const k in meshes) { const M = meshes[k]; if (M.n) M.stream.write(M.data, M.n * STRIDE); }
    return n;
  }

  const wlP = new Float32Array(36), wlC = new Float32Array(36), wlR = new Float32Array(12);
  function draw(cam, cssH, opts = {}) {
    if (!n) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, viewProjMatrix(cam, cssH, opts.near, opts.far));
    const f = opts.fog;
    gl.uniform3f(loc.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(loc.fogNear, f ? f.near : 1e9);
    gl.uniform1f(loc.fogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(loc.fogAmt, f ? f.amt : 0);
    gl.uniform3f(loc.eye, (cam.ex || 0) + (cam.ox || 0), (cam.ey || 0) + (cam.oy || 0), cam.EH || 0);
    const L = light || { sx: -0.707, sy: -0.707, key: [255, 244, 224], sky: [180, 200, 230], shadow: [60, 64, 80], str: 1 };
    gl.uniform2f(loc.keyDir, L.sx, L.sy);
    gl.uniform3f(loc.key, L.key[0] / 255, L.key[1] / 255, L.key[2] / 255);
    gl.uniform3f(loc.sky, L.sky[0] / 255, L.sky[1] / 255, L.sky[2] / 255);
    gl.uniform3f(loc.shadow, L.shadow[0] / 255, L.shadow[1] / 255, L.shadow[2] / 255);
    gl.uniform1f(loc.str, L.str ?? 1);
    // Set on every draw: the mirror prepass draws cloth with no list.
    const WL = opts.lights || [], nW = Math.min(12, WL.length);
    for (let i = 0; i < nW; i++) { const Q = WL[i]; wlP.set(Q.p, i * 3); wlC.set(Q.rgb, i * 3); wlR[i] = Q.rw == null ? Q.r : Q.rw; }
    gl.uniform1i(loc.wlN, nW);
    if (nW) { gl.uniform3fv(loc.wlP, wlP); gl.uniform3fv(loc.wlC, wlC); gl.uniform1fv(loc.wlR, wlR); }
    gl.uniform1i(loc.posT, POS_UNIT);
    gl.uniform1i(loc.tagT, TAG_UNIT);
    gl.uniform2f(loc.tagGrid, tagGrid[0], tagGrid[1]);
    gl.uniform1f(loc.bands, CLOTH_BANDS.length);
    gl.uniform1f(loc.frames, CLOTH_FRAMES);
    gl.activeTexture(gl.TEXTURE0 + TAG_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, tagTex);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let tris = 0;
    for (const k in meshes) {
      const M = meshes[k];
      if (!M.n) continue;
      gl.uniform1i(loc.w, M.bk.W);
      gl.activeTexture(gl.TEXTURE0 + POS_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, M.posT);
      gl.bindVertexArray(M.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, M.count, gl.UNSIGNED_SHORT, 0, M.n);
      tris += (M.count / 3) * M.n;
    }
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0 + POS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + TAG_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return tris;
  }

  return { upload, draw, get instances() { return n; } };
}

declareProgram(VERT, FRAG);
