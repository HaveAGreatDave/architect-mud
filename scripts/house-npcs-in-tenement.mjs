// house-npcs-in-tenement.mjs — move the existing apartment-homed NPCs into The Yards
// Tenement at 2 per unit, rarely 3 (the housing-density rule). File-authoring: rewrites
// each mover's home_zone, frees their old unit's npc_residences, and registers one
// primary resident per tenement unit used. Deterministic (ORDER BY id) → idempotent-ish.
// Run: node scripts/house-npcs-in-tenement.mjs   (then import + [deploy])

import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from '../server/models/db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortKeys = (x) => Array.isArray(x) ? x.map(sortKeys)
  : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sortKeys(x[k])])) : x;
const writeC = (rel, o) => writeFileSync(join(ROOT, rel), JSON.stringify(sortKeys(o), null, 2) + '\n');
const readC = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

// 1. the existing apartment-homed NPCs, deterministic order
const { rows } = await query(
  "SELECT n.id FROM npcs n JOIN zones z ON z.id=n.home_zone WHERE z.flags->>'is_apartment'='true' ORDER BY n.id");
const movers = rows.map(r => r.id);

// 2. tenement unit list + 2/unit (rarely 3) capacities
const units = [];
for (let f = 1; f <= 10; f++) for (let u = 1; u <= 6; u++) units.push(`zone_yards_tenement_u${f}_${u}`);
const cap = (i) => (i % 5 === 2 ? 3 : 2);

// 3. assign movers → units
const perUnit = {};                       // unitZone -> [npcId...]
let ui = 0;
for (const id of movers) {
  while ((perUnit[units[ui]] || []).length >= cap(ui)) ui++;
  (perUnit[units[ui]] ||= []).push(id);
}
const usedUnits = Object.keys(perUnit);
const threes = usedUnits.filter(z => perUnit[z].length === 3).length;

// 4. rewrite each mover's home_zone (content file)
const moverSet = new Set(movers);
for (const unit of usedUnits) for (const id of perUnit[unit]) {
  const rel = `content/npcs/${id}.json`;
  const n = readC(rel); n.home_zone = unit; writeC(rel, n);
}

// 5. free every OLD unit these movers were the registered resident of
let freed = 0;
for (const f of readdirSync(join(ROOT, 'content/npc_residences'))) {
  const r = readC(`content/npc_residences/${f}`);
  if (moverSet.has(r.npc_id) && !String(r.zone_id).startsWith('zone_yards_tenement_')) {
    unlinkSync(join(ROOT, 'content/npc_residences', f)); freed++;
  }
}

// 6. register one primary resident per tenement unit used
for (const unit of usedUnits) writeC(`content/npc_residences/${unit}.json`, { npc_id: perUnit[unit][0], zone_id: unit });

console.log(`✓ Housed existing NPCs in The Yards Tenement.`);
console.log(`  moved: ${movers.length} NPCs into ${usedUnits.length} units (${threes} units got 3, rest 2)`);
console.log(`  freed ${freed} old apartment residences (units open up for players)`);
console.log(`  registered ${usedUnits.length} primary residents in the tenement`);
process.exit(0);
