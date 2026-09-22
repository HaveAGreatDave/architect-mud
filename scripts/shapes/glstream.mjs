// glstream — every per-frame GLASS 2 vertex layer streams through gl/stream.js, and streaming
// means what it says.
//
//   node scripts/shapes/glstream.mjs            # gate
//   node scripts/shapes/glstream.mjs --report   # and print what each layer asks for
//
// ⚠ NO HARNESS IN THIS REPO REACHES A GL DRAW CALL. Every one of them installs a hook that answers
// null — the no-WebGL2 path — so a buffer-management bug is invisible to all of them at once, and
// the only instrument left is the Modelshop and a pair of eyes. That is fine for a picture and
// useless for a cost: an upload that silently went back to reallocating every frame looks exactly
// like one that does not. So this drives the stream against a RECORDING context instead, where the
// question is not what was drawn but what the driver was asked for.
//
// Three claims, each of which was true of the code this replaced and is the thing that would
// quietly come back:
//
//   1. THE ATTRIBUTE POINTERS ARE SET ONCE. They are recorded into the VAO at construction, against
//      the buffer bound at the time, and a `bufferData` on that same buffer does not disturb them.
//      Every layer used to re-run its whole bind block after each upload.
//   2. STORAGE IS ASKED FOR ON GROWTH ONLY, BY DOUBLING. The vertex count moves every frame, so a
//      size-carrying `bufferData` per frame is a reallocation request per frame; doubling settles
//      within a few frames of a layer reaching its working size and then never asks again.
//   3. NOTHING IS ALLOCATED IN THE FRAME. `bufferSubData` takes the source array and a length, so
//      the `data.subarray(0, n)` view every layer used to mint is not needed — and the gate checks
//      OBJECT IDENTITY, because "a Float32Array arrived" is also true of a fresh view.
//
// …plus the one that keeps it true: every layer that fills a Float32Array per frame goes through
// this helper. A new layer written the old way is the regression this file exists to catch, so the
// sweep is over the DIRECTORY rather than over a list of names.
import { readFileSync, readdirSync } from 'node:fs';

const REPORT = process.argv.includes('--report');
const GLDIR = new URL('../../client/game/js/panels/gl/', import.meta.url);
const fail = [];

// ── a recording WebGL2 context ───────────────────────────────────────────────
function recorder() {
  const log = [];
  const rec = (name) => (...args) => { log.push({ name, args }); };
  return {
    log,
    ARRAY_BUFFER: 0x8892, FLOAT: 0x1406, DYNAMIC_DRAW: 0x88E8,
    createBuffer: () => ({ id: 'buf' }),
    bindBuffer: rec('bindBuffer'),
    bindVertexArray: rec('bindVertexArray'),
    enableVertexAttribArray: rec('enableVertexAttribArray'),
    vertexAttribPointer: rec('vertexAttribPointer'),
    bufferData: rec('bufferData'),
    bufferSubData: rec('bufferSubData'),
  };
}

const { makeVertexStream } = await import(new URL('stream.js', GLDIR));

const gl = recorder();
const vao = { id: 'vao' };
const STRIDE = 6;
// A location of -1 is what the linker hands back for an attribute it dropped; it must be skipped
// rather than passed on, or the driver raises INVALID_VALUE on a frame that otherwise works.
const st = makeVertexStream(gl, vao, STRIDE, [[0, 3, 0], [1, 2, 12], [-1, 1, 20]], 64);

// 1 — the pointers, once.
const ptrs = gl.log.filter(e => e.name === 'vertexAttribPointer');
const enables = gl.log.filter(e => e.name === 'enableVertexAttribArray');
if (ptrs.length !== 2) fail.push(`the pointers were set ${ptrs.length} times at construction, expected 2 (the -1 attribute must be skipped)`);
if (enables.length !== 2) fail.push(`${enables.length} attributes enabled, expected 2`);
if (ptrs.some(p => p.args[4] !== STRIDE * 4)) fail.push('the stride handed to vertexAttribPointer is not the stride in BYTES');
if (!gl.log.some(e => e.name === 'bindVertexArray' && e.args[0] === vao)) fail.push('the pointers were not recorded into the layer VAO');

const data = new Float32Array(4096);
const sinceSetup = () => gl.log.slice(setupLen);
const setupLen = gl.log.length;

// 2 — growth by doubling, and only on growth.
const allocs = () => sinceSetup().filter(e => e.name === 'bufferData').map(e => e.args[1]);
st.write(data, 30);                       // under the floor
st.write(data, 60);                       // still under
st.write(data, 64);                       // exactly the floor
const after3 = allocs();
if (after3.length !== 1) fail.push(`three writes inside the floor asked for storage ${after3.length} times — expected 1`);
if (after3[0] !== 64 * 4) fail.push(`the first allocation was ${after3[0]} bytes, expected the floor (${64 * 4})`);

st.write(data, 65);                       // one float over → double
st.write(data, 128);                      // exactly the new capacity, no ask
const after5 = allocs();
if (after5.length !== 2) fail.push(`crossing the capacity asked for storage ${after5.length} times in total — expected 2`);
if (after5[1] !== 128 * 4) fail.push(`the grow gave ${after5[1] / 4} floats, expected a doubling to 128`);

st.write(data, 10);                       // a big drop must not shrink and must not reallocate
if (allocs().length !== 2) fail.push('a shrinking frame reallocated — capacity must be a high-water mark');
if (st.capacity !== 128) fail.push(`capacity fell to ${st.capacity} on a small frame`);

st.write(data, 4000);                     // a jump far past double takes exactly what it needs
if (st.capacity !== 4000) fail.push(`a jump past 2x gave ${st.capacity}, expected the requested 4000`);

// 3 — nothing allocated in the frame.
const subs = sinceSetup().filter(e => e.name === 'bufferSubData');
if (subs.length !== 7) fail.push(`${subs.length} bufferSubData calls for 7 writes`);
if (subs.some(s => s.args[2] !== data)) fail.push('bufferSubData was handed a COPY or a VIEW — the source array must be passed by identity, with a length');
if (subs.some(s => s.args[1] !== 0 || s.args[3] !== 0)) fail.push('bufferSubData wrote at a non-zero offset');
if (subs[0].args[4] !== 30) fail.push('bufferSubData was not given the float LENGTH');

// …and not one pointer touched since setup.
if (sinceSetup().some(e => e.name === 'vertexAttribPointer' || e.name === 'enableVertexAttribArray')) {
  fail.push('an attribute pointer was set during a frame — that is what the VAO is for');
}

// An empty frame must not issue a write at all.
const before = gl.log.length;
st.write(data, 0);
if (gl.log.slice(before).some(e => e.name === 'bufferSubData')) fail.push('an empty frame still wrote to the buffer');

// ── every per-frame layer goes through it ────────────────────────────────────
// ⚠ THE SWEEP IS OVER THE DIRECTORY, NOT OVER A LIST. A list is a thing a new layer is not on.
const files = readdirSync(GLDIR).filter(n => n.endsWith('.js') && n !== 'stream.js');
const layers = [];
for (const n of files) {
  const src = readFileSync(new URL(n, GLDIR), 'utf8');
  // A layer is a file that fills a growing Float32Array of vertices and hands it over. The tell is
  // the grow line every one of them carries; a file with no vertex array of its own (the camera,
  // the atlas, a post pass sampling a texture) is not one and is not swept.
  if (!/data\.length < .*\* STRIDE/.test(src)) continue;
  layers.push(n);
  if (/gl\.bufferData\(gl\.ARRAY_BUFFER, data\.subarray/.test(src)) {
    fail.push(`${n} still uploads with bufferData + subarray — it must stream through gl/stream.js`);
  }
  if (!/makeVertexStream\(/.test(src)) {
    fail.push(`${n} fills a per-frame vertex array but does not build a stream`);
  }
  if (/const bind = \(l, n, off\)/.test(src)) {
    fail.push(`${n} still sets its attribute pointers itself — the stream records them into the VAO once`);
  }
}
if (layers.length < 8) fail.push(`only ${layers.length} per-frame vertex layers found — the sweep has stopped seeing them`);

if (REPORT) {
  console.log(`\n  ${layers.length} per-frame vertex layers, all streaming:`);
  for (const n of layers) {
    const src = readFileSync(new URL(n, GLDIR), 'utf8');
    const m = /makeVertexStream\(gl, vao, STRIDE, \[(.*?)\], (\d+)\)/s.exec(src);
    const attrs = m ? m[1].split('],').length : '?';
    console.log(`    ${n.padEnd(16)} ${String(attrs).padStart(2)} attrs · floor ${m ? m[2] : '?'} floats`);
  }
  console.log('');
}

if (fail.length) {
  console.error('\n✗ glstream — ' + fail.length + ' problem(s):');
  for (const f of fail) console.error('  ' + f);
  console.error('');
  process.exit(1);
}
console.log(`✓ glstream: ${layers.length} per-frame vertex layers stream through one helper — pointers set once, storage grown by doubling, nothing allocated in the frame.`);
