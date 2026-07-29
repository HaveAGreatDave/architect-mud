// One-shot: lift the hardcoded district registry out of engine code and into
// content files — content/districts/<key>.json, one per district.
//
// WHY THIS EXISTS. `DISTRICTS` was a 240-line object literal in
// server/engine/districts.js: names, colours, mood blurbs and sensory pools, i.e.
// authored world content living in the engine, which CLAUDE.md forbids for the
// usual reason — it can only be changed by editing code and shipping a deploy.
// It also had the failure that always follows: the client kept a second copy
// (FUNC_LEGEND) that had to be updated by hand, and four districts — including
// the 3,471-tile Wilds — were never copied across, so the largest district in
// the game drew no colour, no legend row and no tooltip on the regional map.
//
// The prefix table travels with it. `DISTRICT_PREFIX` mapped a zone-id prefix to
// a district key; here each district simply carries the prefixes that resolve to
// it, because "which ids mean the Slaglands" is a fact about the Slaglands. The
// registry rebuilds the flat map at load.
//
// Idempotent: run it twice and the second run writes nothing. Kept rather than
// deleted so the migration is reviewable next to the files it produced.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './lib.mjs';
import { DISTRICTS, DISTRICT_PREFIX } from '../../server/engine/districts.js';

const dir = join(CONTENT_DIR, 'districts');
mkdirSync(dir, { recursive: true });

// key → the id prefixes that resolve to it, inverted from the flat table.
const prefixesOf = new Map();
for (const [prefix, key] of Object.entries(DISTRICT_PREFIX)) {
  if (!prefixesOf.has(key)) prefixesOf.set(key, []);
  prefixesOf.get(key).push(prefix);
}

// `sort` preserves the order the literal was written in — it is a curated order
// (money at the top, the wastes at the bottom), and alphabetising a list somebody
// arranged on purpose is the kind of thing a migration does by accident.
let sort = 0, wrote = 0, same = 0;
for (const [key, d] of Object.entries(DISTRICTS)) {
  const row = {
    blurb: d.blurb ?? null,
    color: d.color ?? null,
    created_by: 'districts-to-content',
    id: key,
    landmark: d.landmark ?? null,
    name: d.name,
    prefixes: (prefixesOf.get(key) || []).sort(),
    signature: d.signature || [],
    skyline: d.skyline ?? null,
    sort: (sort += 10),
    updated_at: String(Math.floor(Date.parse('2026-07-28T00:00:00Z') / 1000)),
  };
  const path = join(dir, `${key}.json`);
  const json = canonicalJson(row);
  if (existsSync(path) && readFileSync(path, 'utf8') === json) { same++; continue; }
  writeFileSync(path, json);
  wrote++;
}

const orphanPrefixes = [...prefixesOf.keys()].filter(k => !DISTRICTS[k]);
console.log(`districts → content/districts/: ${wrote} written, ${same} unchanged`);
if (orphanPrefixes.length) console.warn(`⚠ prefixes point at unknown districts: ${orphanPrefixes.join(', ')}`);
