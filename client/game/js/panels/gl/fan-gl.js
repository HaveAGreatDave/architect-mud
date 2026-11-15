// GLASS · THE STANDS' FANS ON A CONTEXT: gl/fan-vat.js's bake uploaded, and a VAO over it for an
// instance buffer. The park (gl/ballpark.js) and the rink (gl/arena.js) both draw their crowds with
// these and gl/crowd.js's FAN_GLSL, each with its own instance buffers and its own program.
import { FAN_STATIC } from './fan-vat.js';
import { FAN_ATTRS, FAN_VAT_UNIT } from './crowd.js';

// One level's bake on the GPU: the RGBA32F texture of every clip, the static attributes and the
// triangles. { tex, stat, idx, n (indices), nv (the pivot's column) }.
export function uploadFan(gl, bake) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + FAN_VAT_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, bake.W, bake.H, 0, gl.RGBA, gl.FLOAT, bake.data);
  gl.activeTexture(gl.TEXTURE0);
  const stat = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, stat); gl.bufferData(gl.ARRAY_BUFFER, bake.stat, gl.STATIC_DRAW);
  const idx = gl.createBuffer();
  // (an element buffer binds into whatever VAO is bound, so none is)
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bake.idx, gl.STATIC_DRAW);
  return { tex, stat, idx, n: bake.idx.length, nv: bake.nv, tris: bake.idx.length / 3 };
}
export function dropFan(gl, f) {
  if (!f) return;
  gl.deleteTexture(f.tex); gl.deleteBuffer(f.stat); gl.deleteBuffer(f.idx);
}
// A VAO drawing level `f` once an instance in `inst`: the instance attributes at 3, 4 and 5 (vec4, vec4,
// vec3, `stride` bytes apart, from byte `base`), as both crowds lay them out.
export function fanVao(gl, f, inst, stride, base = 0) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, f.stat);
  for (const [loc, size, off] of FAN_ATTRS) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FAN_STATIC * 4, off); }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, f.idx);
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  for (const [loc, size, off] of [[3, 4, 0], [4, 4, 16], [5, 3, 32]]) {
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, base + off); gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  return vao;
}
// Bind a level's texture for a draw and tell the program where its pivot column is.
export function bindFan(gl, Prog, f, towel = 0) {
  gl.activeTexture(gl.TEXTURE0 + FAN_VAT_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, f.tex);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(Prog.u('uVat'), FAN_VAT_UNIT);
  gl.uniform1i(Prog.u('uVatW'), f.nv);
  gl.uniform1f(Prog.u('uTowel'), towel);
}
