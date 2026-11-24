// The Shingle: the coast behind No Regerts made a beach, with a way down to it off Halcyon
// Boulevard (docs/proposals/shingle-beach.md). WRITES CONTENT FILES.
//
//   1. stores Negative Equity (895,904) and Chrome Court (895,905) as rooms only
//      (stored-buildings.md). Chrome Court's residents move to empty flats; The Crown on its roof
//      goes with it;
//   2. lays Shingle Lane on 895,904, east off Halcyon Boulevard onto the sand;
//   3. builds the Shingle Pad on 895,905: a small white bridge deck on pylons with one VTOL bay
//      (`vtol_bridge`, airfield af_shingle). People walk under it or over it to the beach;
//   4. turns the coast north of No Regerts, x 896..902 and y 901..904, into beach (`flags.beach`).
// Run once from the repo root: node scripts/content/shingle-beach.mjs. It refuses a second run.
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';

const P = (dir, id) => join(CONTENT_DIR, dir, `${id}.json`);
const read = (dir, id) => JSON.parse(readFileSync(P(dir, id), 'utf8'));
const write = (dir, obj, id = obj.id) => writeFileSync(P(dir, id), canonicalJson(obj));
const drop = (dir, id) => { if (existsSync(P(dir, id))) unlinkSync(P(dir, id)); };
const touched = [];
const put = (dir, obj, id = obj.id) => { write(dir, obj, id); touched.push(`${dir}/${id}.json`); };

if (existsSync(P('airfields', 'af_shingle'))) { console.error('Already run: af_shingle exists.'); process.exit(1); }

const Z = (gx, gy) => `zone_district_${gx}_${gy}`;
const LANE = Z(895, 904), PAD = Z(895, 905);
const setExit = (id, dir, to) => { const z = read('zones', id); z.exits = { ...(z.exits || {}) };
  if (to) z.exits[dir] = to; else delete z.exits[dir]; put('zones', z); };

// ── 1. Negative Equity and Chrome Court off the map ───────────────────────────────────────────
const unparent = (id) => { const z = read('zones', id); z.parent_zone = null; z.exits = { ...z.exits };
  for (const [d, to] of Object.entries(z.exits)) if (to === LANE || to === PAD) delete z.exits[d];
  if (z.flags) delete z.flags.world_exit_zone; put('zones', z); };
// every room of both buildings, from their two maps' own files
for (const f of readdirSync(join(CONTENT_DIR, 'zones'))) { const z = JSON.parse(readFileSync(join(CONTENT_DIR, 'zones', f), 'utf8'));
  if (z.parent_zone === LANE || z.parent_zone === PAD) unparent(z.id); }
for (const m of ['map_int_negeq', 'map_int_mq_chrome']) { const o = read('maps', m); o.parent_zone_id = null; put('maps', o); }
{ const n = read('npcs', 'npc_negeq_salis'); n.work_zone_id = null; put('npcs', n); }
for (const c of ['conn_district_895_904_east_hrdm', 'conn_district_895_905_east_15be', 'conn_district_895_904_west_1cdo']) drop('connections', c);
drop('doors', 'door_shop_negeq_shop'); drop('doors', 'door_shoddy_zone_district_895_905_in');
// Chrome Court's residents: the hockey pair to the Meridian, the Cherry's staff to 8 Kettle Lane.
const MOVE = { zone_mq_chrome_101: 'zone_meridian_unit_603', zone_mq_chrome_102: 'zone_hf_chainfree_u1', zone_mq_chrome_201: 'zone_hf_chainfree_u2' };
const RESIDENTS = { npc_cphl_grubb: 101, npc_cphl_bland: 101, npc_cherry_bartender: 102, npc_cherry_bouncer: 102, npc_juno_kael: 102, npc_cherry_dancer_lux: 201, npc_ts_etcheverry: 201 };
for (const [n, u] of Object.entries(RESIDENTS)) { const c = read('npcs', n); c.home_zone = MOVE[`zone_mq_chrome_${u}`]; put('npcs', c); }
for (const [from, to] of Object.entries(MOVE)) {
  const r = read('npc_residences', from); r.zone_id = to; drop('npc_residences', from); touched.push(`npc_residences/${from}.json`);
  put('npc_residences', r, to);
}

// ── 2. Shingle Lane ───────────────────────────────────────────────────────────────────────────
{ const z = read('zones', LANE);
  Object.assign(z, { name: 'Shingle Lane', ambient_theme: 'city', marker: undefined,
    description: 'A short lane off Halcyon Boulevard down to the beach, new tarmac between two kerbs and a painted sign that says THE SHINGLE with an arrow east. The white VTOL pad stands over the pavement on the south side. Sand blows up the lane and nobody sweeps it.',
    ambient_events: ['Somebody comes up from the beach with a towel round their neck and sand on their feet.',
      'A kid drags a cool box down the lane on its wheels, loudly.'] });
  delete z.marker; delete z.bg_color; delete z.color;
  z.flags = { district: 'filaments', region_id: 'region_coldwater', terrain: 'road', street_life: true };
  z.exits = { west: Z(894, 904), east: Z(896, 904), south: PAD };
  put('zones', z); }

// ── 3. The Shingle Pad ────────────────────────────────────────────────────────────────────────
put('airfields', { ...read('airfields', 'af_helipad'), id: 'af_shingle', name: 'Shingle Pad', charter: false, rental: false });
{ const z = read('zones', PAD);
  Object.assign(z, { name: 'Shingle Pad', ambient_theme: 'city', color: '#f2f2ee',
    description: 'A small white bridge on four white pylons, one parking bay wide, with a yellow ring and an H painted on its deck. Steps go up at both ends, and the path to the beach runs straight underneath it. Everything is painted white, including the railings, and the gulls have noticed.',
    ambient_events: ['A small VTOL settles onto the deck and its fans wind down.',
      'A gull lands on the white railing and leaves a mark on it.'] });
  delete z.marker; delete z.bg_color;
  z.flags = { airfield_id: 'af_shingle', building_name: 'Shingle Pad', building_type: 'vtol_bridge', district: 'filaments',
    entrance: 'west', floors: 1, icon: 'helipad', region_id: 'region_coldwater', street_life: true, terrain: 'concrete' };
  z.exits = { west: Z(894, 905), north: LANE, east: Z(896, 905) };
  put('zones', z); }
setExit(Z(896, 904), 'west', LANE);
setExit(Z(896, 905), 'west', PAD);

// ── 4. The beach ──────────────────────────────────────────────────────────────────────────────
const SAND = {
  '898,901': 'The far end of the beach, where the sand runs out against the jetty\'s concrete. The water is right there, flat and grey, and the Basin Jetty sticks out into it to the west.',
  '899,901': 'Wet sand at the waterline, packed hard enough to walk on. Little waves come in, give up and go out again.',
  '896,902': 'The west end of the beach, a slope of sand and broken shell down to the water. The jetty is just north, and somebody has left a deckchair folded against its wall.',
  '897,902': 'Open sand near the water, with a line of weed and plastic marking where the tide got to. A towel has been laid out and left.',
  '898,902': 'The middle of the beach and the best of it. The sand is clean here and the water is close enough to hear.',
  '899,902': 'Soft sand down to the water. Two kids have dug a hole and are filling it with the Basin a bucket at a time.',
  '900,902': 'The beach narrows here to a strip of sand between the water and the dunes. The Codfather\'s quay is off to the east.',
  '896,903': 'Coarse shingle at the top of the beach, the stones rounded and grey. They rattle when the waves pull back.',
  '897,903': 'Dunes with tough grass on them at the back of the beach. A path has been worn through the middle to the sand.',
  '898,903': 'Two upturned dinghies sit above the waterline, one with a hole you could put a boot through and one that is simply waiting. A chain runs from both to a ring set in concrete.',
  '899,903': 'Shingle and sand where Kettle Lane runs out onto the beach. Somebody has stacked flat stones into a little tower.',
  '900,903': 'Warm sand behind the dunes, out of the wind. People lie here when it is sunny and pretend the Basin is somewhere else.',
  '901,903': 'Sand right behind No Regerts. The back door of the tattoo shop opens onto the dune, and the bin out here is full of paper towels.',
  '902,903': 'The east end of the beach, where the sand meets the Codfather\'s quay wall. It smells of fish and diesel.',
  '896,904': 'The top of the beach off Shingle Lane, where the tarmac gives out to sand. A tap on a post is there for washing feet.',
  '897,904': 'Sand drifted up over what was rough grass, with a bench facing the water.',
  '898,904': 'The back of the beach, sand over the old turf. Kettle Lane is just east.',
  '900,904': 'Sand over the old allotments. One rhubarb plant has come through it and is still going.',
  '901,904': 'The sand behind No Regerts, with the tattoo shop\'s back wall on the south side. A sun lounger is chained to the drainpipe.',
  '902,904': 'Sand between the junkyard fence and the Codfather\'s quay, a quiet corner of the beach.',
};
for (const [k, desc] of Object.entries(SAND)) {
  const [gx, gy] = k.split(',').map(Number), z = read('zones', Z(gx, gy));
  if (z.flags?.is_building || z.flags?.terrain === 'water' || z.flags?.terrain === 'road') throw new Error(`${k} is not open ground`);
  Object.assign(z, { name: 'The Shingle', description: desc, ambient_theme: 'coast',
    ambient_events: ['A gull walks along the waterline looking for something.', 'A wave comes in a little further than the others.'] });
  delete z.color; delete z.marker;
  z.flags = { district: z.flags?.district || 'filaments', region_id: 'region_coldwater', terrain: 'sand', beach: true };
  put('zones', z);
}

console.log(`Wrote ${touched.length} files:\n  ${touched.join('\n  ')}`);
