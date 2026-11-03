// The sRGB curve in gl/colour.js, checked (RENDER_TUNE.glLinear).
//
// The curve is written twice, once in GLSL for the shaders and once in JS for the uniform colours a
// linear layer uploads, and the two must agree: a uniform decoded one way and a texture another
// puts every wall a few levels off its own palette. So this checks four things, with no GPU:
//
//   · the JS decode round-trips every byte value through an encode written here, within half a level;
//   · the decode is monotonic and keeps 0 at 0 and 1 at 1;
//   · the GLSL chunk still carries the same constants (12.92, 0.055, 1.055, 2.4, 0.04045, 0.0031308),
//     matched by text, the way gl:hdr checks the tone curve.
//   · every layer that shades in linear (glLinear 2) splices the one uLinIn and lf chunk, with the
//     2.2 exponent, and wires the flag the same way (see the block below).
import { readFileSync } from 'node:fs';
import { linOf, LINEAR_GLSL, LIN_IN_GLSL, linearOut } from '../../client/game/js/panels/gl/colour.js';

const problems = [];
const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
let worst = 0, prev = -1;
for (let b = 0; b <= 255; b++) {
  const v = b / 255, l = linOf(v);
  if (l < prev) problems.push(`decode is not monotonic at ${b}`);
  prev = l;
  const back = enc(l) * 255;
  worst = Math.max(worst, Math.abs(back - b));
}
if (worst > 0.5) problems.push(`a byte value comes back ${worst.toFixed(3)} levels off after decode and encode`);
if (linOf(0) !== 0) problems.push('decode(0) is not 0');
if (Math.abs(linOf(1) - 1) > 1e-9) problems.push(`decode(1) is ${linOf(1)}, not 1`);

for (const k of ['12.92', '0.055', '1.055', '2.4', '0.04045', '0.0031308']) {
  if (!LINEAR_GLSL.includes(k)) problems.push(`the GLSL curve no longer carries ${k}`);
}
const js = readFileSync(new URL('../../client/game/js/panels/gl/colour.js', import.meta.url), 'utf8');
if (!/v <= 0\.04045 \? v \/ 12\.92 : Math\.pow\(\(v \+ 0\.055\) \/ 1\.055, 2\.4\)/.test(js)) problems.push('the JS decode in colour.js has changed shape');

// ── THE LAYERS THAT SHADE IN LINEAR LIGHT (glLinear 2) ───────────────────────────────────────
// uLinIn and lf live once, in LIN_IN_GLSL, and every converted layer splices that chunk rather than
// a copy: a second lf with a different exponent puts one layer a few levels off the others at level
// 2 only, which nothing at levels 0 and 1 can show. So the chunk carries the exponent, and each layer
// splices it, declares no uLinIn or lf of its own, asks for the uLinIn location, gates it on LIN.out
// and level 2, and sends applyLinOut 0 when it's set (or its output is decoded twice).
if (!/uniform float uLinIn;/.test(LIN_IN_GLSL)) problems.push('LIN_IN_GLSL no longer declares uLinIn');
if (!/float lf\(float k\) \{ return uLinIn > 0\.5 \? pow\(max\(k, 0\.0\), 2\.2\) : k; \}/.test(LIN_IN_GLSL)) problems.push('LIN_IN_GLSL lf() has changed shape (it is k^2.2 at level 2 and k otherwise)');
const CONVERTED = ['context.js', 'floor.js', 'ground.js'];
const GL_DIR = new URL('../../client/game/js/panels/gl/', import.meta.url);
for (const f of CONVERTED) {
  const src = readFileSync(new URL(f, GL_DIR), 'utf8');
  if (!/import\s*\{[^}]*\bLIN_IN_GLSL\b[^}]*\}\s*from\s*'\.\/colour\.js'/.test(src)) problems.push(`${f} does not import LIN_IN_GLSL from colour.js`);
  if (!src.includes('${LIN_IN_GLSL}')) problems.push(`${f} does not splice LIN_IN_GLSL into its shader`);
  if (/uniform\s+float\s+uLinIn\s*;/.test(src)) problems.push(`${f} declares its own uLinIn; it comes from LIN_IN_GLSL`);
  if (/float\s+lf\s*\(/.test(src)) problems.push(`${f} defines its own lf(); it comes from LIN_IN_GLSL`);
  if (!/getUniformLocation\(prog, 'uLinIn'\)|\bU\('uLinIn'\)/.test(src)) problems.push(`${f} never asks for the uLinIn location, so the shader reads 0 for ever`);
  if (!/const linIn = LIN\.out > 0 && \w+\.linear >= 2;/.test(src)) problems.push(`${f} does not gate uLinIn on the float target and level 2`);
  if (!/applyLinOut\(gl, prog, linIn \? 0 : LIN\.out\)/.test(src)) problems.push(`${f} does not stop glassOut decoding a linear output`);
}
// The level has to reach the two ground layers: world.js builds their options by hand.
const world = readFileSync(new URL('world.js', GL_DIR), 'utf8');
if ((world.match(/linear: drawOpts\.linear/g) || []).length < 2) problems.push('world.js no longer hands the linear level to the floor and the ground');

// The wrap renames exactly one main and adds one that converts the named output.
const wrapped = linearOut('#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0); }\n', 'o');
if ((wrapped.match(/void main\(\)/g) || []).length !== 1) problems.push('linearOut does not leave exactly one main');
if (!wrapped.includes('void glassMain()') || !wrapped.includes('o = glassOut(o)')) problems.push('linearOut did not wrap main and convert the output');

if (problems.length) {
  console.error('✗ glcolour:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`✓ glcolour: the sRGB curve round-trips every byte within ${worst.toFixed(4)} levels, the GLSL carries the same constants, linearOut wraps main once, and ${CONVERTED.length} linear layers (${CONVERTED.join(', ')}) share one uLinIn and lf.`);
