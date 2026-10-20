// stream: the one way a GLASS 2 layer gets its per-frame vertices onto the GPU. Eight layers (mass
// solids, ground, strokes, sprites, decals, billboards, clouds, the Curtain) used to each do:
//
//   gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * STRIDE), gl.DYNAMIC_DRAW);
//
// ⚠ 'subarray' MINTS A VIEW OBJECT every frame, garbage at the worst point for a GC pause.
// 'bufferSubData' takes an offset and length directly.
// ⚠ 'bufferData' WITH A SIZE IS A REALLOCATION, and the count moves every frame. Capacity is
// tracked here and grown by DOUBLING, so a layer settles on one allocation.
// ⚠ ATTRIBUTE POINTERS ARE SET ONCE, recorded into the VAO; stride and buffer never change.
// ⚠ THE BUFFER OBJECT MUST OUTLIVE ITS STORAGE: bufferData/bufferSubData replace contents, not the
// name, so the VAO survives a grow. Recreate the buffer and every VAO on it silently draws nothing.
// ⚠ NO ORPHANING, DELIBERATELY: it's the per-frame reallocation this removes, the buffers see a
// full flush per frame, and WebGL2 renames storage itself. If a stall is ever MEASURED on real
// hardware, add orphaning here, once.

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLVertexArrayObject} vao   the layer's VAO; the pointers are recorded into it here
 * @param {number} stride                vertex stride in FLOATS (not bytes)
 * @param {Array<Array>} attrs           [location, components, byteOffset, type?, normalized?] per
 *                                       attribute (type defaults to FLOAT); a location of -1 (the
 *                                       linker dropped it) is skipped
 * @param {number} [floor]               initial capacity in floats, to skip the first few grows
 */
export function makeVertexStream(gl, vao, stride, attrs, floor = 4096) {
  const buf = gl.createBuffer();
  const S = stride * 4;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const [l, n, off, type, norm] of attrs) {
    if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, type || gl.FLOAT, !!norm, S, off); }
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
    /** Upload `floats` entries of `data` starting at float offset `at`, into the same place on the GPU.
     *  Only valid inside what the last write() allocated: a caller that changes the layout calls write(). */
    writeRange(data, at, floats) {
      if (!(floats > 0) || at + floats > cap) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, at * 4, data, at, floats);
    },
    /** Diagnostics: how many times this layer has actually asked the driver for storage. */
    get grows() { return grows; },
    get capacity() { return cap; },
  };
}
