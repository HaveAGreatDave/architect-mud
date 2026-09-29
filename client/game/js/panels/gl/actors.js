// PAVEMENT PEOPLE AS INSTANCED MESHES, THEIR CLIPS BAKED INTO A TEXTURE.
//
// The close-up half of the street-actor layer. windshield.js decides who is drawn this way (anybody
// big enough on screen, on GLASS 2, once the bake has finished) and hands each of them over as a
// record in the solids list with `actor: 1`; context.js splits those out to here. A record with
// `lod: 1` is somebody a few pixels tall and draws the far body (actor3d.js bk.far), a second mesh on
// the same clips; smaller than RENDER_TUNE.actorFarPx is still the billboard drawActorFigure bakes.
//
// It is gl/fauna.js's scheme with two changes. The mesh is one skinned body from actor3d.js, and its
// clips live in two RGBA16F textures (positions and normals), a column per vertex and a band of rows
// per frame. And an instance can blend two clips, so somebody who stops walking settles into standing
// over a few hundred milliseconds instead of snapping to it.
//
// The shading is the camp shelters' rule from windshield.js: a key-light dot against the frame's own
// light direction, brighter faces toward the sky, and the blob's night dimming, all times the outfit
// colour. Fog, blending and depth are fauna.js's, so a person and a goose on the same pavement fade
// into the haze the same way.
import { viewProjMatrix, viewMatrix } from './camera.js';
import { makeVertexStream } from './stream.js';
import { actorBakeReady } from '../actor3d.js';

// Per instance: x, y, z, tiles per metre | clip A row0, frames, phase, heading | clip B row0, frames,
// phase, share of B | coat rgb | trousers rgb | skin rgb | hair rgb | shoes rgb | brightness, alpha
const STRIDE = 29;
// Units no other layer binds: 0-5 are the world pass's, 7 is fauna.js's pose, 8-17 are the
// murmuration's simulation and its drawing.
const POS_UNIT = 20, NRM_UNIT = 21;
// The look: 1 is seams, grime and the fuller light (see FRAG), 0 the flat shading as first shipped.
// Flip it from the console to compare.
export const ACTOR_LOOK = { on: 1 };

const VERT = `#version 300 es
precision highp float;
precision highp int;
in float aMat;
in vec3 aRest;
in vec4 iPos;
in vec4 iClipA;
in vec4 iClipB;
in vec3 iCoat;
in vec3 iLegs;
in vec3 iSkin;
in vec3 iHair;
in vec3 iShoe;
in vec2 iLit;
uniform highp sampler2D uPosT;
uniform highp sampler2D uNrmT;
uniform int uW;
uniform int uRows;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vColor;
out vec3 vN;
out vec3 vNv;
out vec3 vRest;
flat out int vMat;
out float vFog;
out float vAlpha;
out float vLum;
ivec2 texel(int f) { return ivec2(gl_VertexID % uW, f * uRows + gl_VertexID / uW); }
// One clip at one phase: the two baked frames either side of it, blended.
void clipAt(vec4 c, out vec3 p, out vec3 n) {
  float fr = fract(c.z) * c.y;
  int f0 = int(fr);
  int f1 = f0 + 1;
  if (float(f1) >= c.y) f1 = 0;
  float t = fr - float(f0);
  int b = int(c.x + 0.5);
  p = mix(texelFetch(uPosT, texel(b + f0), 0).xyz, texelFetch(uPosT, texel(b + f1), 0).xyz, t);
  n = mix(texelFetch(uNrmT, texel(b + f0), 0).xyz, texelFetch(uNrmT, texel(b + f1), 0).xyz, t);
}
void main() {
  vec3 p;
  vec3 n;
  clipAt(iClipA, p, n);
  if (iClipB.w > 0.0) {
    vec3 pb;
    vec3 nb;
    clipAt(iClipB, pb, nb);
    p = mix(p, pb, iClipB.w);
    n = mix(n, nb, iClipB.w);
  }
  // The mesh faces +Z with its left hand on +X and Y up. Here forward is the heading on the ground
  // plane, up is world z, and left is forward turned the way the camera's own left is (see makeCam:
  // screen right for a forward of (sin h, -cos h) is (cos h, sin h)).
  vec3 F = vec3(cos(iClipA.w), sin(iClipA.w), 0.0);
  vec3 L = vec3(F.y, -F.x, 0.0);
  vec3 w = iPos.xyz + (F * p.z + L * p.x + vec3(0.0, 0.0, p.y)) * iPos.w;
  vN = F * n.z + L * n.x + vec3(0.0, 0.0, n.y);
  // The normal in camera space, whose z is straight ahead, for the rim light.
  vNv = mat3(uView) * vN;
  vRest = aRest;
  int m = int(aMat + 0.5);
  vMat = m;
  vColor = m == 0 ? iSkin : m == 1 ? iCoat : m == 2 ? iLegs : m == 3 ? iShoe
         : m == 4 ? iHair : m == 5 ? vec3(0.035) : iSkin * vec3(0.78, 0.55, 0.55);
  vLum = iLit.x;
  vAlpha = iLit.y;
  vec4 clip = uViewProj * vec4(w, 1.0);
  gl_Position = clip;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vN;
in vec3 vNv;
in vec3 vRest;
flat in int vMat;
in float vFog;
in float vAlpha;
in float vLum;
uniform vec3 uFog;
uniform vec3 uKeyDir;
uniform float uLook;
uniform float uTop;
out vec4 outColor;
float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1, 0, 0)), f.x), mix(h1(i + vec3(0, 1, 0)), h1(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3(0, 0, 1)), h1(i + vec3(1, 0, 1)), f.x), mix(h1(i + vec3(0, 1, 1)), h1(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float line(float x, float w) { return 1.0 - smoothstep(0.0, w, abs(x)); }
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 n = normalize(vN);
  vec3 col = vColor;
  float lit = clamp(0.5 + dot(n, uKeyDir) * 0.5, 0.0, 1.0);
  float up = max(n.z, 0.0);
  float k = 0.52 + 0.48 * (lit * (1.0 - up) + 0.86 * up);
  vec3 c = col * k;
  if (uLook > 0.5) {
    // Detail hung on the rest shape (mesh space, y up), so it rides the cloth. The seed is the
    // outfit colour itself: the same person keeps the same pattern, and it says nothing new.
    vec3 r = vRest;
    int m = vMat;
    float seed = dot(vColor, vec3(91.7, 37.3, 13.1));
    float grime = vnoise(r * 18.0 + seed) * 0.6 + vnoise(r * 55.0 + seed) * 0.4;
    bool skinLike = m == 0 || m == 6;
    if (m == 1) {
      float front = step(0.0, r.z);
      col *= 1.0 - 0.45 * line(r.x, 0.006) * front;
      col *= 1.0 - 0.35 * line(r.y - 0.88, 0.004) * step(0.05, abs(r.x)) * step(abs(r.x), 0.15) * front;
      float btn = line(r.x - 0.02, 0.01) * line(fract(r.y * 9.0) - 0.5, 0.08) * front * step(0.9, r.y) * step(r.y, 1.35);
      col = mix(col, vec3(0.08), btn * 0.8);
      if (fract(seed * 3.1) > 0.82) col *= 0.9 + 0.1 * step(0.5, fract(r.y * 14.0)) + 0.06 * step(0.5, fract(r.x * 14.0));
      col = mix(col, col * vec3(0.62, 0.55, 0.45), (1.0 - smoothstep(0.55, 1.0, r.y)) * grime * 0.8);
    } else if (m == 2) {
      if (fract(seed * 7.3) > 0.8) col *= 0.88 + 0.12 * step(0.5, fract(r.y * 40.0));
      col = mix(col, col * 1.25 + 0.03, line(r.y - 0.5, 0.06) * step(0.0, r.z) * grime * 0.6);
      col = mix(col, vec3(0.2, 0.17, 0.13), (1.0 - smoothstep(0.03, 0.18, r.y)) * grime * 0.6);
    } else if (m == 3) {
      col = mix(col, vec3(0.1, 0.09, 0.08), 1.0 - smoothstep(0.018, 0.028, r.y));
    } else if (skinLike) {
      col *= 0.94 + 0.08 * vnoise(r * 90.0);
    }
    // Wrap key, sky over warm ground, fake occlusion, a rim off the camera and a little sheen on
    // skin. How dark the night is comes from the figure's own dimming, so the billboard still matches.
    float night = clamp(1.0 - vLum, 0.0, 1.0);
    float wrap = max(0.0, (dot(n, uKeyDir) + 0.35) / 1.35);
    vec3 amb = mix(vec3(0.34, 0.29, 0.24), vec3(0.46, 0.5, 0.58), n.z * 0.5 + 0.5);
    vec3 keyC = mix(vec3(0.62, 0.58, 0.52), vec3(0.6, 0.48, 0.34), night);
    float ao = mix(0.6, 1.0, smoothstep(0.0, 0.3, r.y));
    ao *= 1.0 - 0.3 * line(r.y - 0.93, 0.08) * (1.0 - smoothstep(0.03, 0.09, abs(r.x)));
    ao *= 1.0 - 0.25 * step(abs(r.x), 0.24) * step(0.18, abs(r.x)) * line(r.y - uTop * 0.75, 0.1);
    float rim = pow(1.0 - abs(normalize(vNv).z), 3.0);
    c = col * (amb * ao + keyC * wrap) + rim * mix(vec3(0.12, 0.13, 0.15), vec3(0.2, 0.3, 0.45), night);
    if (skinLike) c += keyC * pow(max(dot(n, normalize(uKeyDir + vec3(0.0, 0.0, 1.0))), 0.0), 24.0) * 0.1;
  }
  c = mix(c * vLum, uFog, vFog);
  outColor = vec4(c * vAlpha, vAlpha);
}`;

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('actors ' + label + ': ' + gl.getShaderInfoLog(s));
  return s;
}

export function createActorLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('actors link: ' + gl.getProgramInfoLog(prog));
  const A = (n) => gl.getAttribLocation(prog, n);
  const loc = {
    mat: A('aMat'), pos: A('iPos'), clipA: A('iClipA'), clipB: A('iClipB'),
    coat: A('iCoat'), legs: A('iLegs'), skin: A('iSkin'), hair: A('iHair'), shoe: A('iShoe'), lit: A('iLit'),
    posT: gl.getUniformLocation(prog, 'uPosT'),
    nrmT: gl.getUniformLocation(prog, 'uNrmT'),
    w: gl.getUniformLocation(prog, 'uW'),
    rows: gl.getUniformLocation(prog, 'uRows'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    keyDir: gl.getUniformLocation(prog, 'uKeyDir'),
    view: gl.getUniformLocation(prog, 'uView'),
    look: gl.getUniformLocation(prog, 'uLook'),
    top: gl.getUniformLocation(prog, 'uTop'),
    rest: A('aRest'),
  };

  // Each body's mesh and textures go up once, the first time anybody is drawn with it. Index 0 is the
  // close-up body and 1 the far one (actor3d.js bk.far); both play through the one program, and both
  // use units 20 and 21, bound in turn at draw time.
  const meshes = [null, null];
  function meshFor(bk, lod) {
    if (meshes[lod]) return meshes[lod];
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const mb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mb);
    gl.bufferData(gl.ARRAY_BUFFER, bk.mat, gl.STATIC_DRAW);
    if (loc.mat >= 0) { gl.enableVertexAttribArray(loc.mat); gl.vertexAttribPointer(loc.mat, 1, gl.FLOAT, false, 4, 0); }
    // The rest shape: the idle clip's first frame, a static coordinate the fragment shader hangs
    // seams and grime on. A body without a preview gets a constant, which leaves the detail inert.
    if (loc.rest >= 0) {
      const i0 = bk.clips.idle.row0 * bk.nv * 3;
      if (bk.preview && bk.preview.length >= i0 + bk.nv * 3) {
        const rb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, rb);
        gl.bufferData(gl.ARRAY_BUFFER, bk.preview.slice(i0, i0 + bk.nv * 3), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc.rest);
        gl.vertexAttribPointer(loc.rest, 3, gl.FLOAT, false, 12, 0);
      } else {
        gl.disableVertexAttribArray(loc.rest);
        gl.vertexAttrib3f(loc.rest, 0, 1, 0);
      }
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bk.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const at = (l, n, off) => [l, n, off * 4];
    const stream = makeVertexStream(gl, vao, STRIDE, [
      at(loc.pos, 4, 0), at(loc.clipA, 4, 4), at(loc.clipB, 4, 8), at(loc.coat, 3, 12), at(loc.legs, 3, 15),
      at(loc.skin, 3, 18), at(loc.hair, 3, 21), at(loc.shoe, 3, 24), at(loc.lit, 2, 27),
    ], STRIDE * 64);
    // One advance per instance, not per vertex. The divisor is VAO state, so it is set once, here.
    gl.bindVertexArray(vao);
    for (const l of [loc.pos, loc.clipA, loc.clipB, loc.coat, loc.legs, loc.skin, loc.hair, loc.shoe, loc.lit]) if (l >= 0) gl.vertexAttribDivisor(l, 1);
    gl.bindVertexArray(null);
    const tex = (unit, data) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, bk.W, bk.H, 0, gl.RGBA, gl.HALF_FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      return t;
    };
    meshes[lod] = { vao, stream, count: bk.idx.length, posT: tex(POS_UNIT, bk.pos), nrmT: tex(NRM_UNIT, bk.nrm), bk,
      data: new Float32Array(STRIDE * 64), n: 0 };
    return meshes[lod];
  }

  let n = 0;
  let key = [-0.7, -0.7, 0.35];

  /**
   * Take this frame's records. Each is { x, y, z, s, hd, clip, ph, clip2, ph2, mix, o, lum, a, lx, ly }:
   * map-window tiles, tiles per metre, heading in radians on the ground plane, the clip and its phase
   * (and optionally a second clip being blended from), the outfit, brightness, alpha, and the frame's
   * key-light direction on the ground plane. `lod: 1` draws the far body.
   */
  function upload(recs) {
    n = 0;
    for (const M of meshes) if (M) M.n = 0;
    const bake = actorBakeReady();
    if (!bake || !recs || !recs.length) return 0;
    for (const r of recs) if (r.lod && bake.far) meshFor(bake.far, 1).n++; else meshFor(bake, 0).n++;
    for (const M of meshes) {
      if (!M || !M.n) continue;
      if (M.data.length < M.n * STRIDE) M.data = new Float32Array(Math.max(M.n * STRIDE, M.data.length * 2));
      M.n = 0;
    }
    for (const r of recs) {
      const M = r.lod && bake.far ? meshes[1] : meshes[0], bk = M.bk, data = M.data;
      const c = (o, rgb) => { data[o] = rgb[0] / 255; data[o + 1] = rgb[1] / 255; data[o + 2] = rgb[2] / 255; };
      const A = bk.clips[r.clip] || bk.clips.idle, Bc = r.clip2 ? bk.clips[r.clip2] : null;
      const o = M.n * STRIDE;
      data[o] = r.x; data[o + 1] = r.y; data[o + 2] = r.z || 0; data[o + 3] = r.s;
      data[o + 4] = A.row0; data[o + 5] = A.len; data[o + 6] = r.ph || 0; data[o + 7] = r.hd || 0;
      data[o + 8] = Bc ? Bc.row0 : 0; data[o + 9] = Bc ? Bc.len : 1; data[o + 10] = r.ph2 || 0; data[o + 11] = Bc ? (r.mix || 0) : 0;
      c(o + 12, r.o.coat); c(o + 15, r.o.legs); c(o + 18, r.o.skin); c(o + 21, r.o.hair); c(o + 24, r.o.shoes);
      data[o + 27] = r.lum == null ? 1 : r.lum; data[o + 28] = r.a == null ? 1 : r.a;
      M.n++; n++;
    }
    const r0 = recs[0];
    const kl = Math.hypot(r0.lx || 0, r0.ly || 0, 0.35) || 1;
    key = [(r0.lx || 0) / kl, (r0.ly || 0) / kl, 0.35 / kl];
    for (const M of meshes) if (M && M.n) M.stream.write(M.data, M.n * STRIDE);
    return n;
  }

  function draw(cam, cssH, opts = {}) {
    if (!n) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, viewProjMatrix(cam, cssH, opts.near, opts.far));
    const f = opts.fog;
    gl.uniform3f(loc.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(loc.fogNear, f ? f.near : 1e9);
    gl.uniform1f(loc.fogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(loc.fogAmt, f ? f.amt : 0);
    gl.uniform3f(loc.keyDir, key[0], key[1], key[2]);
    gl.uniformMatrix4fv(loc.view, false, viewMatrix(cam));
    gl.uniform1f(loc.look, ACTOR_LOOK.on ? 1 : 0);
    gl.uniform1i(loc.posT, POS_UNIT);
    gl.uniform1i(loc.nrmT, NRM_UNIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let tris = 0;
    for (const mesh of meshes) {
      if (!mesh || !mesh.n) continue;
      gl.uniform1i(loc.w, mesh.bk.W);
      gl.uniform1i(loc.rows, mesh.bk.rows);
      gl.uniform1f(loc.top, mesh.bk.top || 1.7);
      gl.activeTexture(gl.TEXTURE0 + POS_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, mesh.posT);
      gl.activeTexture(gl.TEXTURE0 + NRM_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, mesh.nrmT);
      gl.bindVertexArray(mesh.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, mesh.n);
      tris += (mesh.count / 3) * mesh.n;
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + POS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return tris;
  }

  return {
    upload, draw,
    get instances() { return n; },
  };
}
