// liveries: the gate for content/liveries/ and its bake.
//
//   node scripts/shapes/liveries.mjs
//
// 1. Every file bakes: valid shape, known paint values, one default per model, a default for
//    every aircraft class and every truck (see bake-liveries.mjs).
// 2. client/shared/liveries.js is what the files bake to today. A stale module is a livery the
//    game offers that the content no longer says, or the reverse.
// 3. Every class default resolves through livery-sets.js, which is the read the server makes for
//    an unpainted aircraft.
// 4. PAINT PARITY. Every aircraft mesh but the wreck has paint slots, and its default set is the
//    `factory` pattern that shows them. A mesh with no slots can only be painted by role, which is
//    a flat two-tone; the Dragonfly, Viper, Grasshopper and Mayfly were that until 2026-10-08.
import { readFileSync } from 'node:fs';
import { bakeToString, OUT } from './bake-liveries.mjs';
import { LIVERY_MODELS } from '../../client/shared/livery-schema.js';
import { defaultLivery } from '../../client/shared/livery-sets.js';
import { MESH_ROWS } from '../../client/shared/vehicle-meshes.js';

const problems = [];
const { errors, text } = bakeToString();
problems.push(...errors);
if (text) {
  const onDisk = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
  if (onDisk !== text.replace(/\r\n/g, '\n')) problems.push('stale livery bake: client/shared/liveries.js differs from content/liveries/. Run: npm run liveries:bake');
}
for (const kind of ['aircraft', 'truck']) for (const model of LIVERY_MODELS[kind]) {
  if (!defaultLivery(kind, model)) problems.push('defaultLivery(' + kind + ', ' + model + ') is null');
}
// The armed heli is its own mesh and its own livery model; the wreck is nobody's paint job.
const MESH_MODEL = { heli_armed: 'viper', wreck: null };
const MIN_SLOTS = 4;
for (const [id, params] of Object.entries(MESH_ROWS)) {
  const model = id in MESH_MODEL ? MESH_MODEL[id] : id;
  if (!model) continue;
  const slots = Object.keys(params.paints || {}).length;
  if (slots < MIN_SLOTS) problems.push('mesh_' + id + ' has ' + slots + ' paint slot(s); every aircraft gets at least ' + MIN_SLOTS + ' so its factory scheme lands on chosen parts');
  const d = defaultLivery('aircraft', model);
  if (d && d.exterior.pattern !== 'factory') problems.push('aircraft/' + model + ' default is pattern "' + d.exterior.pattern + '"; it must be "factory" or its mesh\'s slots never show');
}

if (problems.length) {
  console.error('  ✗ liveries: ' + problems.length + ' problem(s)');
  for (const p of problems) console.error('    ' + p);
  process.exit(1);
}
console.log('  ✓ liveries: content/liveries bakes clean, every aircraft class and truck has a default, and every aircraft mesh is painted');
