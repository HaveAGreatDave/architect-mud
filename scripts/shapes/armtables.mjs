// armtables: the building-model arms under client/game/js/panels/glass/models/ are all wired in.
//
//   node scripts/shapes/armtables.mjs
//
// drawTypeModelArm (windshield.js) picks a building's arm out of one table merged from every region
// file that glass/models/index.js re-exports. Three ways that goes wrong, all silent:
//
//   · a region file that index.js doesn't list. Its arms never draw, and every building of those
//     types falls back to the generic storefront. Nothing throws.
//   · the same type in two region files, or twice in one. The merge (or the object literal) keeps
//     the last one, so the other is dead code that still looks like the model.
//   · an arm whose parameter list drifts from the call. The arguments are positional, so a missing
//     or swapped one shifts every name after it, and the arm draws with the wrong values.
//
// It reads the arms' source for the parameter lists and the loaded tables for the keys, so a key
// the text scan missed shows up as a disagreement between the two.
import { readFileSync, readdirSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';

const DIR = 'client/game/js/panels/glass/models/';
const fails = [];
const fail = (s) => fails.push(s);

// The call site is the authority on the parameter list.
const WS = readFileSync('client/game/js/panels/windshield.js', 'utf8');
const call = /\n  if \(arm\) arm\(([^)]*)\);/.exec(WS);
if (!call) fail('cannot find `if (arm) arm(...)` in drawTypeModelArm; this check has gone stale');
const PARAMS = call ? call[1] : '';

const index = readFileSync(DIR + 'index.js', 'utf8');
const listed = [...index.matchAll(/^export \{ ([A-Z_]+) \} from '\.\/([a-z0-9-]+\.js)';/gm)].map((m) => ({ name: m[1], file: m[2] }));
const files = readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js').sort();
for (const f of files) if (!listed.some((l) => l.file === f)) fail(`${f} is not re-exported by glass/models/index.js, so none of its arms ever draws`);

const owner = new Map();
let arms = 0;
for (const { name, file } of listed) {
  const src = readFileSync(DIR + file, 'utf8').replace(/\r\n/g, '\n');
  if (!new RegExp(`^export const ${name} = \\{$`, 'm').test(src)) fail(`${file}: index.js expects \`export const ${name} = {\``);
  for (const m of src.matchAll(/^  ([A-Za-z_$][\w$]*)\(([^)]*)\) \{/gm)) {
    arms++;
    const [, key, params] = m;
    if (params !== PARAMS) fail(`${file}: ${key} takes (${params}), but drawTypeModelArm calls arm(${PARAMS})`);
    if (owner.has(key)) fail(`${key} is an arm in both ${owner.get(key)} and ${file}; the merge keeps one and the other never draws`);
    else owner.set(key, file);
  }
}

// The loaded tables must hold exactly what the text scan found.
await loadWindshield();
const tables = await import('../../' + DIR + 'index.js');
const live = new Map();
for (const [name, table] of Object.entries(tables)) {
  for (const key of Object.keys(table)) {
    if (typeof table[key] !== 'function') fail(`${name}.${key} is not a function`);
    live.set(key, name);
  }
}
for (const key of owner.keys()) if (!live.has(key)) fail(`${key} looks like an arm in ${owner.get(key)} but isn't in any loaded table`);
for (const [key, name] of live) if (!owner.has(key)) fail(`${name}.${key} is in a loaded table but the source scan missed it; keep each arm's head on one line, two spaces in`);

if (fails.length) {
  console.error(`✗ armtables: ${fails.length} failure(s)`);
  for (const f of fails) console.error('   · ' + f);
  process.exit(1);
}
console.log(`✓ armtables: ${arms} arms in ${listed.length} region files, every file wired in, no type twice, every arm takes drawTypeModelArm's arguments.`);
