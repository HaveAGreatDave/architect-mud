// stream — the one way a GLASS 2 layer gets its per-frame vertices onto the GPU.
//
// Eight layers (mass solids, ground, strokes, sprites, decals, billboards, clouds, the Curtain)
// each fill a growing Float32Array and hand it over once a frame. They all did it the same way and
// all did two avoidable things in the frame:
//
//   gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW);
//
// ⚠ `subarray` MINTS A TYPED-ARRAY VIEW OBJECT, every frame, in every layer. It is small and it is
// garbage, and it is garbage created at the one point in the frame where a collection pause is most
// visible. WebGL2's `bufferSubData` takes a source offset and a length directly, so the view has no
// reason to exist at all.
//
// ⚠ AND `bufferData` WITH A SIZE IS A REALLOCATION REQUEST. The vertex count moves every frame — a
// building comes into range, a light fades in — so the size handed over is almost never the size
// from last frame, and the driver is asked for fresh storage each time. Capacity is tracked here
// instead and grown by DOUBLING, so a layer settles on one allocation within a few frames of
// reaching its working size and then never asks again.
//
// ⚠ AND THE ATTRIBUTE POINTERS ARE SET ONCE, NOT PER FRAME. Every layer re-ran its whole
// `enableVertexAttribArray` + `vertexAttribPointer` block after each upload, which is what a VAO
// exists to make unnecessary: the pointers are recorded INTO the VAO, against the buffer bound at
// the time, and neither the stride nor the buffer object changes for the life of the scene.
// Re-binding after a `bufferData` is a habit from the days before vertex array objects.
//
// ⚠ THE BUFFER OBJECT MUST OUTLIVE ITS STORAGE, which is what makes that safe: `bufferData` and
// `bufferSubData` replace what is INSIDE the buffer and never the buffer's name, so a VAO pointing
// at it stays valid across a grow. Delete and recreate the buffer and every VAO recorded against it
// silently draws nothing.
//
// ⚠ AND THERE IS DELIBERATELY NO ORPHANING HERE. The idiomatic `bufferData(size)` before every
// `bufferSubData` exists to dodge a write-after-read stall, and it is exactly the per-frame
// reallocation this file is written to remove. These buffers are written once and drawn once per
// frame with a full pipeline flush between (the composite blits the canvas), and WebGL2 renames
// storage itself when it has to. If a stall is ever MEASURED on real hardware, orphaning goes back
// in here, once, rather than in eight places.

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLVertexArrayObject} vao   the layer's VAO; the pointers are recorded into it here
 * @param {number} stride                vertex stride in FLOATS (not bytes)
 * @param {Array<[number, number, number]>} attrs  [location, components, byteOffset] per attribute;
 *                                       a location of -1 (the linker dropped it) is skipped
 * @param {number} [floor]               initial capacity in floats, to skip the first few grows
 */
export function makeVertexStream(gl, vao, stride, attrs, floor = 4096) {
  const buf = gl.createBuffer();
  const S = stride * 4;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const [l, n, off] of attrs) {
    if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); }
  }
  gl.bindVertexArray(null);

  let cap = 0;   // floats currently allocated on the GPU
  let grows = 0;

  return {
    buf,
    /** Upload the first `floats` entries of `data`. */
    write(data, floats) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (floats > cap) {
        cap = Math.max(floats, cap * 2, floor);
        gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
        grows++;
      }
      if (floats > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, floats);
    },
    /** Diagnostics: how many times this layer has actually asked the driver for storage. */
    get grows() { return grows; },
    get capacity() { return cap; },
  };
}
