// One-shot: recolor every zone's stored map colour by land-use category, keyed
// off the real zone-id prefix scheme (zone_<cat>_<name>). Water is the only
// blue (Coldwater Bay); docks + North City get their own distinct colours; and
// EVERY prefix maps to a real colour so no tile is left grey. Overwrites
// bg_color for all zones and clears foreground `color` so tiles auto-derive text.
import { query } from '../server/models/db.js';

// zone-id prefix -> land-use category.
const PREFIX_CAT = {
  bay: 'water',
  dock: 'docks',
  nc: 'northcity', up: 'northcity',
  gov: 'government',
  civ: 'civic', city: 'civic', clone: 'civic', start: 'civic',
  threshold: 'civic', thresholdeast: 'civic',
  apt: 'residential', meridian: 'residential', embassy: 'residential',
  residential: 'residential',
  drum: 'commercial', velk: 'commercial', weapons: 'commercial', furniture: 'commercial',
  mq: 'nightlife',
  media: 'media', prod: 'media', studio: 'media', util: 'media', ext: 'media',
  coldwater: 'industrial', powerplantnew: 'industrial', warehouse: 'industrial',
  slag: 'slaglands',
  waste: 'wasteland', badland: 'wasteland', outskirts: 'wasteland', ruins: 'wasteland',
  ashway: 'ashway',
  deep: 'slum', slums: 'slum', tunnels: 'slum',
};

const COLORS = {
  water:       '#2f86cc', // blue — the ONLY blue (Coldwater Bay)
  docks:       '#1fb5aa', // teal — waterfront, clearly not the water blue
  northcity:   '#d9a83a', // gold — affluent North City / Uptown
  government:  '#b56fbf', // orchid purple
  civic:       '#4bb36a', // green
  residential: '#c9a884', // sand
  commercial:  '#e08a4a', // pumpkin
  nightlife:   '#e85aa0', // hot pink — Marquee
  media:       '#8e6fd0', // violet — studios
  industrial:  '#9a8a4f', // olive
  slaglands:   '#e5822a', // orange — the Slagworks (molten/slag)
  wasteland:   '#7c6a4a', // brown
  ashway:      '#8b9097', // grey — the Ashway (ash flats)
  slum:        '#cf6a2e', // burnt orange — Undermarket
  hazard:      '#e05555', // red — lethal
};

function categorise(z) {
  const p = (z.id || '').match(/^zone_([a-z0-9]+)/)?.[1] || '';
  if (PREFIX_CAT[p]) return PREFIX_CAT[p];
  if (z.danger_rating === 'lethal') return 'hazard';
  return 'residential'; // non-grey urban default for any unknown prefix
}

const { rows } = await query(`SELECT id, danger_rating FROM zones`);
const tally = {};
for (const z of rows) {
  const cat = categorise(z);
  await query(`UPDATE zones SET bg_color = $1, color = NULL WHERE id = $2`, [COLORS[cat], z.id]);
  tally[cat] = (tally[cat] || 0) + 1;
}
console.log(`Recoloured ${rows.length} zones:`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${COLORS[k]}  ×${v}`);
}
process.exit(0);
