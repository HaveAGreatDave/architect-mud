// One-shot: recolor every zone's stored map colour to the land-use palette
// keyed by its category (mirrors client FUNC_LEGEND + the coldwater-style SVG).
// Water is the ONLY blue (vivid) so Coldwater Bay pops; its former blue-ish
// neighbours (corporate, mixed-core) are re-hued to slate/sand, and the palette
// is spread across the wheel so every district is distinct. Overwrites bg_color
// for all zones and clears the foreground `color` so tiles auto-derive text.
import { query } from '../server/models/db.js';

// Verbatim copy of server/engine/commands/movement.js mapFunc().
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

const COLORS = {
  corporate:   '#8a857c', // warm concrete gray (no blue at all) — was slate
  civic:       '#46b06a', // green
  residential: '#c4a98a', // warm sand (was steel-blue)
  commercial:  '#26a5a0', // teal — waterfront/trade, clearly green of water's blue
  nightlife:   '#cf5bb8', // pink-magenta
  media:       '#8e6fd0', // violet
  industrial:  '#9a8a4f', // olive
  wasteland:   '#7c6a4a', // brown
  slum:        '#d9863a', // orange
  water:       '#2f86cc', // the ONE blue — Coldwater Bay
  hazard:      '#e05555', // red
  other:       '#9aa0a8', // light neutral gray
};

const { rows } = await query(`SELECT id, danger_rating FROM zones`);
const tally = {};
let n = 0;
for (const z of rows) {
  const func = mapFunc(z);
  await query(`UPDATE zones SET bg_color = $1, color = NULL WHERE id = $2`, [COLORS[func], z.id]);
  tally[func] = (tally[func] || 0) + 1;
  n++;
}
console.log(`Recoloured ${n} zones:`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${COLORS[k]}  ×${v}`);
}
process.exit(0);
