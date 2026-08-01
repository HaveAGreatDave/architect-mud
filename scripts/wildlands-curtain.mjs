// One-shot: flag the city's land-edge tiles with the Curtain (perimeter wall).
// Land edges (water is the north bay): south row y919, west col x891 (land y902-919),
// east col x927 (land y909-919). Excludes the South Gate (918_919) and any missing tiles.
// Adds flags.curtain=true to every edge tile; appends a curtain line only to generic
// "Grasslands" tiles so bespoke rooms (SAM nests, piers) keep their prose.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './content/lib.mjs';

const CURTAIN_LINE = " The Architect's Curtain seals the edge here — a floor-to-sky sheet of humming hard light. There is no way through but the South Gate.";

const coords = new Set();
for (let x = 891; x <= 927; x++) coords.add(`${x}_919`);        // south row
for (let y = 902; y <= 919; y++) coords.add(`891_${y}`);        // west column (land)
for (let y = 909; y <= 919; y++) coords.add(`927_${y}`);        // east column (land)
coords.delete('918_919');                                       // the gate is the one break

let flagged = 0, prosed = 0, missing = 0, water = 0;
for (const key of coords) {
  const path = join(CONTENT_DIR, 'zones', `zone_district_${key}.json`);
  if (!existsSync(path)) { missing++; continue; }
  const zone = JSON.parse(readFileSync(path, 'utf8'));
  zone.flags = zone.flags || {};
  if (zone.flags.terrain === 'water') { water++; continue; }    // never wall a water tile
  zone.flags.curtain = true;
  flagged++;
  if (zone.name === 'Grasslands' && !/Curtain/.test(zone.description || '')) {
    zone.description = (zone.description || '').trimEnd() + CURTAIN_LINE;
    prosed++;
  }
  writeFileSync(path, canonicalJson(zone));
}
console.log(`Curtain: flagged ${flagged} tiles (${prosed} got prose), skipped ${water} water, ${missing} missing.`);
