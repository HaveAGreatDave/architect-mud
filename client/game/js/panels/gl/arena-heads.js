// GLASS 2 · THE ARENA'S HEADS, FROM THE STREET FIGURES' GENERATOR.
//
// A rink body's head is actor-head.js's skull, ears and hair, in its three levels, with a face
// from the baked atlas in actor-faces.js tinted by the player's own skin, hair and eyes
// (docs/proposals/street-figure-heads.md is the generator's plan; rink/faces.js picks a player's
// face). arena-mesh.js hands over one record a head: the matrix that takes the generator's bind
// space (metres, Y up, facing +Z) into the rink (feet, Z up), the level, the face and the blood.
// The meshes are static and built once a level and a hair style, so a head costs two small
// indexed draws and no CPU work a vertex. The helmet, the cage and the visor are still built by
// arena-mesh.js, round the head.
//
// ⚠ THE LIGHT IS THE ARENA'S, NOT THE LAB'S. The colours come from the lab's head shader (the
// face, the scalp under the hairline, the ears, the hair's strands) and the lighting is LIT_FS's
// line for line (the key from the banks, the hemisphere, the bounce off the sheet), so a head
// doesn't look pasted onto a body lit another way.
// ⚠ THE NECK IS LEFT OUT. The rink body has its own, under the strap; the generator's would swing
// with the head and stand out of the collar.
// ⚠ UPLOADED WITH FLIP_Y ON, PREMULTIPLYING OFF AND NO COLOUR CONVERSION, as actor-faces.js asks:
// the four channels are four masks, not a picture. Until it has loaded, the faces are plain skin.
import { headMesh, hairMesh, HEAD_FEAT, HAIRLINE_GLSL } from '../actor-head.js';
import { FACE_GLSL } from '../actor-faces.js';

export const HEAD_VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in vec2 aUV;
layout(location = 3) in float aF;
layout(location = 4) in float aX;
uniform mat4 uVP;
uniform vec2 uShake;
uniform mat4 uM;
out vec3 vW; out vec3 vN; out vec3 vR; out vec2 vUV; out float vAux; out float vFront;
flat out int vF;
void main() {
  vec4 w = uM * vec4(aP, 1.0);
  vW = w.xyz; vN = mat3(uM) * aN; vR = aP; vUV = aUV; vAux = aX; vFront = aN.z; vF = int(aF + 0.5);
  vec4 p = uVP * w;
  p.xy += uShake * p.w;
  gl_Position = p;
}`;

export const HEAD_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vW; in vec3 vN; in vec3 vR; in vec2 vUV; in float vAux; in float vFront;
flat in int vF;
uniform sampler2D uFace;
uniform vec4 uCell;
uniform vec3 uSkin;
uniform vec3 uHair;
uniform vec3 uLip;
uniform vec3 uIris;
uniform float uSeed;
uniform int uStyle;
uniform float uBlood;
uniform vec3 uEye;
uniform float uMourn;
uniform float uClipZ;
out vec4 outColor;
const vec3 L = vec3(0.2453, -0.4416, 0.8635);
float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1, 0, 0)), f.x), mix(h1(i + vec3(0, 1, 0)), h1(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h1(i + vec3(0, 0, 1)), h1(i + vec3(1, 0, 1)), f.x), mix(h1(i + vec3(0, 1, 1)), h1(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
${FACE_GLSL}
${HAIRLINE_GLSL}
// The hair's colour at a point, for the shell and the scalp under its edge alike (the lab's).
vec3 hairAt(vec3 r, float psi) {
  float strand = uStyle == 4
    ? vnoise(vec3(r.x * 320.0, r.y * 60.0 - r.z * 20.0, uSeed))
    : vnoise(vec3(psi * 40.0, r.y * 14.0, uSeed)) * 0.6 + vnoise(vec3(psi * 110.0, r.y * 30.0, uSeed + 7.0)) * 0.4;
  if (uStyle == 3 && r.y < 1.62) strand = vnoise(vec3(atan(r.x, -r.z) * 60.0, r.y * 6.0, uSeed));
  return uHair * (0.68 + 0.6 * strand);
}
void main() {
  if (vW.z < uClipZ) discard;
  vec3 r = vR;
  float psi = atan(abs(r.x), r.z + 0.006);
  vec3 col;
  float ao = 1.0, wet = 0.0;
  if (vF == ${HEAD_FEAT.hair}) {
    float hl = hairlineAt(r);
    col = hairAt(r, psi);
    if (uStyle == 1) col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.0012, abs(r.x - 0.024))) * smoothstep(1.7, 1.72, r.y) * smoothstep(-0.03, 0.02, r.z);
    ao = mix(0.85, 1.0, smoothstep(hl + 0.004, hl + 0.016, r.y));
    if (uStyle == 4) {
      float cut = smoothstep(0.04, 0.05, abs(r.x)) * (1.0 - smoothstep(1.708, 1.722, r.y));
      col = mix(col, mix(uSkin, uHair * 0.5, 0.5 + 0.3 * vnoise(r * 900.0)), cut);
    }
  } else if (vF == ${HEAD_FEAT.ear}) {
    col = uSkin * vec3(1.03, 0.94, 0.92) * (1.0 - 0.3 * vAux);
    ao = 1.0 - 0.3 * vAux;
  } else {
    // the face where the skull faces forward, the scalp under the hairline, the shadow under the jaw
    float wt = smoothstep(0.1, 0.4, vFront);
    vec3 fc = faceColour(texture(uFace, uCell.xy + clamp(vUV, 0.0, 1.0) * uCell.zw), r, uSkin, uHair, uLip, uLip, 0.0, uIris, wet);
    col = mix(uSkin, fc, wt);
    wet *= wt;
    float hl = hairlineAt(r);
    float jit = 0.0026 * (vnoise(vec3(psi * 70.0, r.y * 400.0, uSeed)) - 0.5);
    float sc = smoothstep(hl - 0.0025, hl + 0.0025, r.y + jit);
    col = mix(col, hairAt(r, psi) * 0.95, sc);
    ao = mix(ao, 0.88, sc);
    col *= 1.0 - 0.18 * smoothstep(1.534, 1.522, r.y);
    // a bloody nose, run down over the lip and the chin
    if (uBlood > 0.0) {
      float run = (1.0 - smoothstep(0.004, 0.016, abs(r.x + 0.002 * sin(r.y * 900.0)))) * smoothstep(1.596, 1.586, r.y) * smoothstep(1.522, 1.56, r.y);
      float bl = uBlood * max(run, 0.6 * (1.0 - smoothstep(0.002, 0.007, abs(r.y - 1.5652))) * (1.0 - smoothstep(0.012, 0.024, abs(r.x))));
      col = mix(col, vec3(0.38, 0.015, 0.03), 0.9 * bl);
      wet = max(wet, 0.6 * bl);
    }
  }
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  float diff = max(dot(n, L), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  float bounce = max(-n.z, 0.0) * 0.3;
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 32.0) * (0.08 + 0.4 * wet);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.1;
  vec3 rgb = col * ao * (0.3 + 0.24 * hemi + 0.6 * diff + bounce) + vec3(spec + rim);
  float g = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(rgb, vec3(g), uMourn * 0.75) * (1.0 - 0.22 * uMourn);
  outColor = vec4(rgb, 1.0);
}`;

// The half-size atlas: a head on the rink is never bigger than a face on the street's close-up,
// and a cell of 128 x 160 is more than the camera ever shows. Its cells sit on 32-texel lines, so
// mips 0 to 5 never mix two faces.
const ATLAS_URL = new URL('../../../assets/actor-faces-half.png', import.meta.url).href;
const ATLAS_MAX_LEVEL = 5;

// `prog` is the arena's program helper; `doc` its document, for the Image constructor.
export function createRinkHeads(gl, prog, doc) {
  const P = prog(HEAD_VS, HEAD_FS);
  const T2 = gl.TEXTURE_2D;
  // Plain skin until the atlas arrives: shade 1 (R x 1.5), no hair, no lips, no eye opening.
  const tex = gl.createTexture();
  gl.bindTexture(T2, tex);
  gl.texImage2D(T2, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([170, 0, 0, 255]));
  gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(T2, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(T2, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(T2, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const api = {};
  const Img = (doc && doc.defaultView && doc.defaultView.Image) || globalThis.Image;
  if (Img) {
    const img = new Img();
    img.onload = () => {
      if (gl.isContextLost && gl.isContextLost()) return;
      gl.bindTexture(T2, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(T2, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      gl.texParameteri(T2, gl.TEXTURE_MAX_LEVEL, ATLAS_MAX_LEVEL);
      gl.texParameteri(T2, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(T2);
    };
    img.onerror = () => {};
    img.src = ATLAS_URL;
  }

  // One VAO a mesh, built the first time it's drawn: the head (no neck) by level, the hair by level
  // and style.
  const meshes = new Map();
  function mesh(kind, lv, style = 0) {
    const key = `${kind}:${lv}:${style}`;
    let m = meshes.get(key);
    if (m) return m;
    const src = kind === 'head' ? headMesh(lv) : hairMesh(style, lv);
    let I = src.I;
    if (kind === 'head') {
      const keep = [];
      for (let t = 0; t < I.length; t += 3) {
        if (src.F[I[t]] === HEAD_FEAT.neck || src.F[I[t + 1]] === HEAD_FEAT.neck || src.F[I[t + 2]] === HEAD_FEAT.neck) continue;
        keep.push(I[t], I[t + 1], I[t + 2]);
      }
      I = new Uint16Array(keep);
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    for (const [loc, data, size] of [[0, src.P, 3], [1, src.N, 3], [2, src.UV, 2], [3, src.F, 1], [4, src.X, 1]]) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    m = { vao, n: I.length };
    meshes.set(key, m);
    return m;
  }

  // Every head in `list` (records from arena-mesh.js), through `vp` from `eye`. Leaves its own
  // program bound: the caller re-binds what it draws next.
  api.draw = (list, vp, eye, shake, clipZ, mourn, st) => {
    if (!list.length) return;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u('uVP'), false, vp);
    gl.uniform2fv(P.u('uShake'), shake);
    gl.uniform3fv(P.u('uEye'), eye);
    gl.uniform1f(P.u('uMourn'), mourn || 0);
    gl.uniform1f(P.u('uClipZ'), clipZ);
    gl.uniform1i(P.u('uFace'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(T2, tex);
    for (const h of list) {
      const f = h.face, lv = h.lv;
      gl.uniformMatrix4fv(P.u('uM'), false, h.M);
      gl.uniform4fv(P.u('uCell'), f.cell);
      gl.uniform3fv(P.u('uSkin'), f.skin);
      gl.uniform3fv(P.u('uHair'), f.hair);
      gl.uniform3fv(P.u('uLip'), f.lip);
      gl.uniform3fv(P.u('uIris'), f.iris);
      gl.uniform1f(P.u('uSeed'), f.seed);
      gl.uniform1i(P.u('uStyle'), f.style);
      gl.uniform1f(P.u('uBlood'), h.blood || 0);
      for (const m of [mesh('head', lv), mesh('hair', lv, h.hs ?? f.style)]) {
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
        if (st) { st.draws++; st.tris += m.n / 3; }
      }
    }
    gl.bindVertexArray(null);
  };
  return api;
}
