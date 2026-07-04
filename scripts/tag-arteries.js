// One-shot: tag the tiles that make up downtown's two main through-routes with
// flags.artery so the full map (openMapPopup in minimap.js) colours them as a
// major road, distinct from ordinary streets. Purely additive metadata — does
// not touch exits/connectivity. Idempotent (safe to re-run).
//   node scripts/tag-arteries.js
// then POST /api/world/reload (or restart) so the running world picks up the flag.
import { query } from '../server/models/db.js';

// flags.artery is an array of street names — a tile can sit on more than one
// (e.g. an intersection), so this accumulates rather than overwrites.
const ARTERIES = {
  'Grand Avenue': [ // N-S spine through downtown, x=0
    'zone_waste_rebar', 'zone_media_plaza', 'zone_ext_1782953094650',
    'zone_city_north', 'zone_threshold', 'zone_city_south',
  ],
  'Quay Road': [ // E-W spine along the docks row, y=-3, from the North City gate to the Slip
    'zone_civ_steps', 'zone_media_plaza', 'zone_dock_wharf',
    'zone_dock_quays', 'zone_dock_fishmarket', 'zone_dock_slip',
  ],
  'The Haul Road': [ // E-W spine through the Wastes/Ashway, y=0, Slagworks to downtown
    'zone_slag_gate', 'zone_ashway_wash', 'zone_ashway_ashfall', 'zone_ashway_road',
    'zone_ruins', 'zone_badland_w_gate', 'zone_outskirts', 'zone_city_west',
  ],
  'North Head': [ // Yards E-W haul road, y=-1
    'zone_yard_depot', 'zone_yard_boxcar', 'zone_yard_marshalling', 'zone_yard_reefer',
  ],
  'Main Haul': [ // Yards E-W haul road, y=0
    'zone_mq_precinct', 'zone_yard_loadout', 'zone_yard_dray', 'zone_yard_weighbridge',
  ],
  'The Axis': [ // North City ceremonial N-S spine, x=-1, up from the Steps gate
    'zone_civ_steps', 'zone_up_vellum', 'zone_nc_datum', 'zone_nc_skyline', 'zone_nc_halcyon',
  ],
  'The Mall': [ // North City E-W ministry frontage, y=-7
    'zone_gov_ministry', 'zone_gov_assembly', 'zone_gov_prefect', 'zone_nc_halcyon', 'zone_nc_sable',
  ],
  'The Strip': [ // Marquee nightlife district main street, y=0, ties into the Yards' Main Haul
    'zone_mq_marquee', 'zone_mq_battery', 'zone_mq_precinct',
  ],
};

async function tagZone(id, street) {
  const { rows } = await query('SELECT flags FROM zones WHERE id=$1', [id]);
  if (!rows.length) return false;
  const flags = rows[0].flags || {};
  const artery = Array.isArray(flags.artery) ? flags.artery : (flags.artery ? [flags.artery] : []);
  if (!artery.includes(street)) artery.push(street);
  flags.artery = artery;
  await query('UPDATE zones SET flags=$1 WHERE id=$2', [JSON.stringify(flags), id]);
  return true;
}

async function main() {
  for (const [street, ids] of Object.entries(ARTERIES)) {
    let n = 0;
    for (const id of ids) if (await tagZone(id, street)) n++;
    console.log(`${street}: tagged ${n}/${ids.length} tiles`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
