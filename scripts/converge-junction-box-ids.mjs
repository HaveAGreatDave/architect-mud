#!/usr/bin/env node
// Converge auto-built junction-box generators from the legacy timestamped id
// (`gen_<zone>_<ms>`) to the deterministic id the engine now mints
// (`gen_<zone>`, see installGenerator in server/engine/environment.js), rewriting
// the generator content file AND every reference to it (power_zones.generator_id,
// furniture.flags.generator_id).
//
// This is the SCOPED companion to that engine fix: run it on ONE project's
// building cluster at the moment you ship that project, so its content files carry
// deterministic ids and stop churning. It edits content/*.json only — never the DB,
// never prod. After running, `content:import` reconciles your local DB.
//
// SAFE BY DESIGN: you must pass zone filters; there is no default "all" sweep.
// `--all` exists but is discouraged (see the deterministic-id discussion — the 16
// already-deployed timestamped boxes are stable and converging them is cosmetic).
// Dry-run unless you pass --apply.
//
// Usage:
//   node scripts/converge-junction-box-ids.mjs zone_yard_ zone_dray_        # dry-run, buildings whose util zone matches
//   node scripts/converge-junction-box-ids.mjs --apply zone_yard_           # write the files
//   node scripts/converge-junction-box-ids.mjs --apply --all                # every timestamped JB (discouraged)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'content');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const all = args.includes('--all');
const filters = args.filter(a => !a.startsWith('--'));
if (!all && !filters.length) {
  console.error('Refusing to run with no zone filter. Pass zone substrings (e.g. zone_yard_) or --all.');
  process.exit(1);
}

const TIMESTAMPED = /_\d{10,}$/;               // legacy id suffix: _<epoch-ms>
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const listJson = (dir) => {
  const d = path.join(ROOT, dir);
  return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => path.join(d, f)) : [];
};
// Canonical serialization matching the content pipeline (recursively sorted keys,
// 2-space indent, trailing newline) so rewrites don't introduce format churn.
const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])])) : v;
const writeJson = (f, obj) => fs.writeFileSync(f, JSON.stringify(sortDeep(obj), null, 2) + '\n');

// 1. Build the rename map from junction-box generator files in scope.
const rename = new Map();  // old id -> new id
const genFiles = new Map(); // old id -> file path
for (const f of listJson('generators')) {
  const g = readJson(f);
  if (g.generator_type !== 'junction_box') continue;
  if (!TIMESTAMPED.test(g.id)) continue;                         // already deterministic
  const zone = g.zone_id;
  if (!zone) continue;
  if (!all && !filters.some(sub => zone.includes(sub) || g.id.includes(sub))) continue;
  const newId = `gen_${zone}`;
  if (newId === g.id) continue;
  rename.set(g.id, newId);
  genFiles.set(g.id, f);
}

if (!rename.size) { console.log('No timestamped junction-box generators match the filter. Nothing to do.'); process.exit(0); }

console.log(`${apply ? 'APPLYING' : 'DRY-RUN'} — ${rename.size} generator(s) to converge:\n`);
for (const [oldId, newId] of rename) console.log(`  ${oldId}\n    -> ${newId}`);

// 2. Rewrite references in power_zones (top-level generator_id) and furniture (flags.generator_id).
let refPz = 0, refFurn = 0;
const touch = [];
for (const f of listJson('power_zones')) {
  const z = readJson(f);
  if (z.generator_id && rename.has(z.generator_id)) { z.generator_id = rename.get(z.generator_id); refPz++; touch.push([f, z]); }
}
for (const f of listJson('furniture')) {
  const fu = readJson(f);
  const gid = fu.flags?.generator_id;
  if (gid && rename.has(gid)) { fu.flags.generator_id = rename.get(gid); refFurn++; touch.push([f, fu]); }
}
console.log(`\nreferences: ${refPz} power_zones, ${refFurn} furniture`);

if (!apply) { console.log('\n(dry-run — pass --apply to write. Then: npm run content:lint && npm run content:import)'); process.exit(0); }

// 3a. Rewrite each generator file under its new id (delete old file, write new).
for (const [oldId, newId] of rename) {
  const oldPath = genFiles.get(oldId);
  const g = readJson(oldPath); g.id = newId;
  const newPath = path.join(ROOT, 'generators', `${newId}.json`);
  if (fs.existsSync(newPath) && newPath !== oldPath) {
    console.warn(`  ! ${newId}.json already exists — repointing refs to it and dropping the timestamped duplicate.`);
  } else {
    writeJson(newPath, g);
  }
  if (newPath !== oldPath) fs.rmSync(oldPath);
}
// 3b. Rewrite the reference files.
for (const [f, obj] of touch) writeJson(f, obj);

console.log(`\nDone. Rewrote ${rename.size} generator file(s), ${refPz + refFurn} reference(s).`);
console.log('Next: npm run content:lint  &&  npm run content:import  (reconcile local DB), then review + commit.');
