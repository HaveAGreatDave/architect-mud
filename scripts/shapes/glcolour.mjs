// The sRGB curve in gl/colour.js, checked (RENDER_TUNE.glLinear).
//
// The curve is written twice, once in GLSL for the shaders and once in JS for the uniform colours a
// linear layer uploads, and the two must agree: a uniform decoded one way and a texture another
// puts every wall a few levels off its own palette. So this checks three things, with no GPU:
//
//   · the JS decode round-trips every byte value through an encode written here, within half a level;
//   · the decode is monotonic and keeps 0 at 0 and 1 at 1;
//   · the GLSL chunk still carries the same constants (12.92, 0.055, 1.055, 2.4, 0.04045, 0.0031308),
//     matched by text, the way gl:hdr checks the tone curve.
import { readFileSync } from 'node:fs';
import { linOf, LINEAR_GLSL, linearOut } from '../../client/game/js/panels/gl/colour.js';

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

// The wrap renames exactly one main and adds one that converts the named output.
const wrapped = linearOut('#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0); }\n', 'o');
if ((wrapped.match(/void main\(\)/g) || []).length !== 1) problems.push('linearOut does not leave exactly one main');
if (!wrapped.includes('void glassMain()') || !wrapped.includes('o = glassOut(o)')) problems.push('linearOut did not wrap main and convert the output');

if (problems.length) {
  console.error('✗ glcolour:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`✓ glcolour: the sRGB curve round-trips every byte within ${worst.toFixed(4)} levels, the GLSL carries the same constants, and linearOut wraps main once.`);
