// One-shot: recolor every zone's stored map colour to a pastel keyed by its
// land-use category (mirrors client FUNC_LEGEND + the coldwater-style SVG).
// Overwrites bg_color for all zones and clears the foreground `color` so the
// dev-panel Maps view (and per-zone minimap) auto-derive readable dark text.
import { query } from '../server/models/db.js';

// Verbatim copy of server/engine/commands/movement.js mapFunc() so this script
// categorises zones identically to the game.
function mapFunc(z) {
  const id = z.id || '';
  const d = z.danger_rating;
  if (/water|_bay|coldwater_bay/.test(id)) return 'water';
  if (id === 'zone_up_aid' || id.includes('precinct') || id === 'zone_city_se') return 'civic';
  if (id.startsWith('zone_up_') || id.startsWith('zone_spire') || id === 'zone_city_ne') return 'corporate';
  if (id.startsWith('zone_deep_') || id === 'zone_slums' || id === 'zone_tunnels' || id === 'zone_city_sw') return 'slum';
  if (/cherry|pigeon|_sump/.test(id)) return 'nightlife';
  if (id.startsWith('zone_slag_') || id === 'zone_powerplantnew' || id === 'zone_coldwater_turbine_hall' || id === 'zone_warehouse' || id === 'zone_city_east') return 'industrial';
  if (id.startsWith('zone_ashway_') || id.startsWith('zone_badland_') || id === 'zone_ruins' || id === 'zone_deep_waste' || id === 'zone_outskirts') return 'wasteland';
  if (/apt|residential|embassy|meridian_unit|meridian_floor|chrome_[123]0|chrome_f/.test(id)) return 'residential';
  if (/studio|_prod_|zone_ext_/.test(id)) return 'media';
  if (id.startsWith('zone_mq_') || id === 'zone_meridian' || id.startsWith('zone_velk') || id.startsWith('zone_drum') || id.startsWith('zone_weapons') || id.startsWith('zone_furniture') || id === 'zone_city_west' || id === 'zone_mq_marquee') return 'commercial';
  if (id.startsWith('zone_city_') || id.startsWith('zone_threshold') || id === 'zone_threshold') return 'civic';
  if (d === 'lethal') return 'hazard';
  return 'other';
}

const PASTEL = {
  corporate:   '#b0bde2',
  civic:       '#b3e2cf',
  residential: '#a9c9dc',
  commercial:  '#a9dcea',
  nightlife:   '#e2b8ea',
  media:       '#c6b6ec',
  industrial:  '#d8cfa0',
  wasteland:   '#c9b89a',
  slum:        '#eccaa0',
  water:       '#a8cbe2',
  hazard:      '#eeb0b0',
  other:       '#c2c8d0',
};

const { rows } = await query(`SELECT id, danger_rating FROM zones`);
const tally = {};
let n = 0;
for (const z of rows) {
  const func = mapFunc(z);
  const bg = PASTEL[func];
  await query(`UPDATE zones SET bg_color = $1, color = NULL WHERE id = $2`, [bg, z.id]);
  tally[func] = (tally[func] || 0) + 1;
  n++;
}
console.log(`Recoloured ${n} zones:`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${PASTEL[k]}  ×${v}`);
}
process.exit(0);
