// A WebGL2 world pass for GLASS — the spike, not the renderer.
//
// It draws ONE thing: mass, as triangles, through GLASS's own camera (see camera.js), shaded the
// way GLASS shades it. No textures, no adornments, no ground, no weather. That is enough to answer
// the question the spike exists for — can the same city be drawn with a depth buffer, from the same
// seat, at a cost worth the rewrite — and stopping there is deliberate: a spike that grows features
// stops being measurable against the thing it is meant to replace.
//
// ⚠ IT OWNS NO GEOMETRY AND NO PALETTE. The vertices come from `captureModelMesh`, which records the
// real primitives; the colours come from the caller, which reads `WALL_COL`. This file knows how to
// put triangles on a screen and nothing whatever about buildings — the same rule the Modelshop's
// server follows, for the same reason: two definitions of what a building looks like is the failure
// this whole effort is trying not to introduce.
//
// ⚠ AND IT IS NOT WIRED INTO THE GAME. `paintWindshield` does not know it exists. The only caller is
// the Modelshop's GL preview, where a wrong answer is a picture somebody is looking at rather than a
// city nobody can see.
import { viewProjMatrix } from './camera.js';

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
out float vDepth;
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  gl_Position = clip;
  vNormal = aNormal;
  vColor = aColor;
  vDepth = clip.w;              // the camera-forward distance, in tiles — the same f GLASS sorts on
}`;

// The shading GLASS already does, per fragment instead of per face: a key-light dot that warms the
// lit side and cools the shadow side, and a distance fade into the sky. `uKey`/`uSky`/`uShadow` are
// RENDER_TUNE's own vertex-light palette, handed in rather than restated.
const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in float vDepth;
uniform vec3 uKeyDir;
uniform vec3 uKey;
uniform vec3 uShadow;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uVLight;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float lit = clamp(0.5 + dot(n, normalize(uKeyDir)) * 0.5, 0.0, 1.0);
  vec3 tint = mix(uShadow, uKey, lit);
  vec3 base = mix(vColor, vColor * 2.0 * tint, clamp(uVLight, 0.0, 1.0));
  float fog = clamp((vDepth - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  outColor = vec4(mix(base, uFog, fog), 1.0);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' shader: ' + log);
  }
  return sh;
}

export function createGLView(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, depth: true });
  if (!gl) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    normal: gl.getAttribLocation(prog, 'aNormal'),
    color: gl.getAttribLocation(prog, 'aColor'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    keyDir: gl.getUniformLocation(prog, 'uKeyDir'),
    key: gl.getUniformLocation(prog, 'uKey'),
    shadow: gl.getUniformLocation(prog, 'uShadow'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    vlight: gl.getUniformLocation(prog, 'uVLight'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let count = 0;

  // ⚠ QUADS ARE FANNED, NOT ASSUMED TO BE FOUR-SIDED. A drum cap is an N-gon and a clipped roof is a
  // 3-to-5-gon, so anything that indexed 0,1,2 / 0,2,3 would quietly drop the rest of a cylinder's
  // lid. Every face here is convex, which is what makes a fan correct rather than merely convenient.
  function upload(faces) {
    const data = [];
    for (const f of faces) {
      const [r, g, b] = f.rgb || [128, 128, 128];
      const n = f.n || [0, 0, 1];
      for (let i = 1; i + 1 < f.p.length; i++) {
        for (const p of [f.p[0], f.p[i], f.p[i + 1]]) {
          data.push(p[0], p[1], p[2], n[0], n[1], n[2], r / 255, g / 255, b / 255);
        }
      }
    }
    // ⚠ NO AXIS SWAP, AND THE FIRST CUT HAD ONE. It looked like the obvious hospitality to a GL
    // convention — trade y and z on the way into the buffer — but the matrix in camera.js is
    // written to take GLASS's own world coordinates (x east, y north, z up) and do the swap itself,
    // in the same expression `proj` uses. Swapping here fed it y where it wanted wz, which projects
    // every vertex somewhere off screen: a full buffer, a clean draw call, and an empty frame.
    count = data.length / 9;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const S = 9 * 4;
    gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(loc.normal); gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(loc.color); gl.vertexAttribPointer(loc.color, 3, gl.FLOAT, false, S, 24);
    gl.bindVertexArray(null);
    return count;
  }

  function draw(cam, opts = {}) {
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // ⚠ NO BACKFACE CULL. The mesh carries every face of every solid, and a building here is not
    // guaranteed to be closed — a wall with no back, a soffit, a canopy underside. Culling would
    // delete exactly the surfaces a cab looks up at.
    gl.disable(gl.CULL_FACE);
    const sky = opts.sky || [0.09, 0.11, 0.14];
    gl.clearColor(sky[0], sky[1], sky[2], opts.clearAlpha == null ? 1 : opts.clearAlpha);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!count) return 0;

    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, H)));
    const k = opts.keyDir || [-0.7, 0.35, -0.7];
    gl.uniform3f(loc.keyDir, k[0], k[1], k[2]);
    const key = opts.key || [0.78, 0.59, 0.33], sh = opts.shadow || [0.13, 0.16, 0.21];
    gl.uniform3f(loc.key, key[0], key[1], key[2]);
    gl.uniform3f(loc.shadow, sh[0], sh[1], sh[2]);
    gl.uniform3f(loc.fog, sky[0], sky[1], sky[2]);
    gl.uniform1f(loc.fogNear, opts.fogNear == null ? 18 : opts.fogNear);
    gl.uniform1f(loc.fogFar, opts.fogFar == null ? 40 : opts.fogFar);
    gl.uniform1f(loc.vlight, opts.vlight == null ? 1 : opts.vlight);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    return count;
  }

  return { gl, upload, draw, get triangles() { return count / 3; } };
}
