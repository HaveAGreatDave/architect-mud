/**
 * Accolade sparkles on the GPU.
 *
 * A small WebGL2 point renderer for the accolade banner's corner canvas. The
 * simulation stays on the CPU in accolades-banner.js (a few dozen particles);
 * this draws them as 3-D points: each has a depth, is projected through a
 * pinhole camera so near sparks are bigger and drift faster across the screen,
 * and is shaded in the fragment shader as a hot core, a four-point star with
 * diagonal flares, a chromatic halo and a twinkle, all added together.
 *
 * Nothing is textured and nothing is blurred, so the cost is one draw call of at
 * most MAX points over a 420x560 box. If WebGL2 isn't there, create() returns
 * null and the banner shows without sparks.
 */
import { compileShader } from './programs.js';

const VS = `#version 300 es
in vec4 aPos;     // x, y in canvas px; z depth in px (negative = toward you); w size
in vec4 aCol;     // rgb, alpha
in vec2 aMisc;    // rotation, twinkle phase
uniform vec2 uView;   // canvas size in css px
uniform float uDpr;
uniform float uTime;
out vec4 vCol;
out float vRot;
out float vTw;
const float D = 700.0;
void main() {
  vec2 c = uView * 0.5;
  float s = D / max(D + aPos.z, 60.0);
  vec2 p = c + (aPos.xy - c) * s;
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  float tw = 0.78 + 0.22 * sin(uTime * 9.0 + aMisc.y);
  gl_PointSize = aPos.w * s * uDpr * tw;
  vCol = aCol;
  vRot = aMisc.x;
  vTw = tw;
}`;

const FS = `#version 300 es
precision mediump float;
in vec4 vCol;
in float vRot;
in float vTw;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float cs = cos(vRot), sn = sin(vRot);
  q = mat2(cs, -sn, sn, cs) * q;
  float r = length(q);
  if (r > 1.0) discard;
  vec2 a = abs(q);
  // four-point star: thin needles along the axes, tapering to the tips
  float star = max(exp(-a.y * 26.0) * (1.0 - a.x), exp(-a.x * 26.0) * (1.0 - a.y));
  // shorter diagonal flares
  vec2 d = abs(vec2(q.x + q.y, q.x - q.y)) * 0.7071;
  float diag = max(exp(-d.y * 30.0) * max(0.0, 1.0 - d.x * 1.8), exp(-d.x * 30.0) * max(0.0, 1.0 - d.y * 1.8));
  float core = exp(-r * r * 60.0);
  float halo = exp(-r * 4.5) * 0.55;
  // a faint spectral ring: the halo's edge picks up shifted hues
  vec3 ring = 0.5 + 0.5 * cos(6.2832 * (r * 1.6 + vec3(0.0, 0.33, 0.67)));
  float ringW = exp(-pow((r - 0.55) * 9.0, 2.0)) * 0.22;
  vec3 col = vCol.rgb * (halo + star * 0.9 + diag * 0.5)
           + vec3(1.0) * (core * 1.4 + star * 0.55 * vTw)
           + ring * ringW;
  float edge = smoothstep(1.0, 0.7, r);
  col *= vCol.a * edge;
  // Premultiplied light: alpha is the brightest channel, so empty texels add nothing.
  o = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}`;

const STRIDE = 10; // floats per point: pos4 col4 misc2

function compile(gl, type, src) {
  try { return compileShader(gl, type, src, 'accolade-fx'); } catch { return null; }
}

export function createAccoladeFx(canvas, MAX) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  const data = new Float32Array(MAX * STRIDE);
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  const attr = (name, n, off) => {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, STRIDE * 4, off * 4);
  };
  attr('aPos', 4, 0); attr('aCol', 4, 4); attr('aMisc', 2, 8);
  gl.bindVertexArray(null);
  const uView = gl.getUniformLocation(prog, 'uView');
  const uDpr = gl.getUniformLocation(prog, 'uDpr');
  const uTime = gl.getUniformLocation(prog, 'uTime');

  return {
    /** points: [{ x, y, z, size, r, g, b, a, rot, tw }] in canvas css px, colours 0..1. */
    draw(points, w, h, dpr, t) {
      const n = Math.min(points.length, MAX);
      for (let i = 0; i < n; i++) {
        const p = points[i], o = i * STRIDE;
        data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z; data[o + 3] = p.size;
        data[o + 4] = p.r; data[o + 5] = p.g; data[o + 6] = p.b; data[o + 7] = p.a;
        data[o + 8] = p.rot; data[o + 9] = p.tw;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!n) return;
      gl.useProgram(prog);
      gl.uniform2f(uView, w, h);
      gl.uniform1f(uDpr, dpr);
      gl.uniform1f(uTime, t);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // additive light
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * STRIDE);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.bindVertexArray(null);
    },
    clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
  };
}
