// liveries: the gate for content/liveries/ and its bake.
//
//   node scripts/shapes/liveries.mjs
//
// 1. Every file bakes: valid shape, known paint values, one default per model, a default for
//    every aircraft class (see bake-liveries.mjs).
// 2. client/shared/liveries.js is what the files bake to today. A stale module is a livery the
//    game offers that the content no longer says, or the reverse.
// 3. Every class default resolves through livery-sets.js, which is the read the server makes for
//    an unpainted aircraft.
import { readFileSync } from 'node:fs';
import { bakeToString, OUT } from './bake-liveries.mjs';
import { LIVERY_MODELS } from '../../client/shared/livery-schema.js';
import { defaultLivery } from '../../client/shared/livery-sets.js';

const problems = [];
const { errors, text } = bakeToString();
problems.push(...errors);
if (text) {
  const onDisk = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
  if (onDisk !== text.replace(/\r\n/g, '\n')) problems.push('stale livery bake: client/shared/liveries.js differs from content/liveries/. Run: npm run liveries:bake');
}
for (const model of LIVERY_MODELS.aircraft) {
  if (!defaultLivery('aircraft', model)) problems.push('defaultLivery(aircraft, ' + model + ') is null');
}

if (problems.length) {
  console.error('  ✗ liveries: ' + problems.length + ' problem(s)');
  for (const p of problems) console.error('    ' + p);
  process.exit(1);
}
console.log('  ✓ liveries: content/liveries bakes clean and every aircraft class has a default');
