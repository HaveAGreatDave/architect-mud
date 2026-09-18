// Behavioural verification of the four infill buildings, against the live dev DB.
// Run from the repo root:  node scripts/content/verify-infill.mjs
import { initWorld, world, getZone, buildingEntranceDir, isEnterableFacade, getMapByParentZone, buildingIconSvg } from '../../server/engine/world.js';
import { initEnvironment, getZoneVisibility } from '../../server/engine/environment.js';
import { query } from '../../server/models/db.js';

const BUILDINGS = [
  { name: 'Reel Estate',  facade: 'zone_district_912_914', street: 'zone_district_911_914', entry: 'zone_reel_foyer',      npc: 'npc_reel_nissen',           rooms: ['zone_reel_foyer', 'zone_reel_house', 'zone_reel_box', 'zone_util_zone_reel_foyer'] },
  { name: 'Photo Finish', facade: 'zone_district_914_914', street: 'zone_district_915_914', entry: 'zone_pfin_shop',       npc: 'npc_pfin_glennie',          rooms: ['zone_pfin_shop', 'zone_pfin_settle', 'zone_util_zone_pfin_shop'] },
  { name: 'Stuff It',     facade: 'zone_district_917_914', street: 'zone_district_918_914', entry: 'zone_stuffit_shop',    npc: 'npc_stuffit_vandersloot',   rooms: ['zone_stuffit_shop', 'zone_stuffit_work', 'zone_util_zone_stuffit_shop'] },
  { name: 'Fine Print',   facade: 'zone_district_903_908', street: 'zone_district_903_907', entry: 'zone_fineprint_room',  npc: 'npc_fprint_ashgrove',       rooms: ['zone_fineprint_room', 'zone_fineprint_stack', 'zone_util_zone_fineprint_room'] },
  { name: 'Pocket Money',   facade: 'zone_district_912_915', street: 'zone_district_911_915', entry: 'zone_pocket_hall',     npc: 'npc_pocket_moye',      rooms: ['zone_pocket_hall', 'zone_pocket_back', 'zone_util_zone_pocket_hall'] },
  { name: 'The Penny Drops', facade: 'zone_district_910_915', street: 'zone_district_911_915', entry: 'zone_penny_floor',    npc: 'npc_penny_alabaster',  rooms: ['zone_penny_floor', 'zone_penny_donors', 'zone_util_zone_penny_floor'] },
  { name: 'The Codfather',  facade: 'zone_district_903_905', street: 'zone_district_903_906', entry: 'zone_codfather_slab',  npc: 'npc_cod_fawle',        rooms: ['zone_codfather_slab', 'zone_codfather_ice', 'zone_util_zone_codfather_slab'] },
  { name: 'Sole Survivor',  facade: 'zone_district_900_907', street: 'zone_district_900_906', entry: 'zone_sole_shop',       npc: 'npc_sole_trapnell',    rooms: ['zone_sole_shop', 'zone_util_zone_sole_shop'] },
  { name: 'Negative Equity', facade: 'zone_district_895_904', street: 'zone_district_894_904', entry: 'zone_negeq_shop',     npc: 'npc_negeq_salis',        rooms: ['zone_negeq_shop', 'zone_negeq_studio', 'zone_util_zone_negeq_shop'] },
  { name: 'Skeleton Crew',   facade: 'zone_district_898_905', street: 'zone_district_898_906', entry: 'zone_skelcrew_shop',  npc: 'npc_skel_bandy',         rooms: ['zone_skelcrew_shop', 'zone_skelcrew_back', 'zone_util_zone_skelcrew_shop'] },
  { name: 'No Regerts',      facade: 'zone_district_901_905', street: 'zone_district_901_906', entry: 'zone_regerts_stair',  npc: 'npc_regerts_prudhoe',    rooms: ['zone_regerts_stair', 'zone_regerts_room', 'zone_util_zone_regerts_stair'] },
  { name: 'Paws for Thought', facade: 'zone_district_926_912', street: 'zone_district_926_913', entry: 'zone_paws_wait',     npc: 'npc_paws_tiplady',       rooms: ['zone_paws_wait', 'zone_paws_surgery', 'zone_util_zone_paws_wait'] },
  { name: 'Spirit Level',    facade: 'zone_district_919_914', street: 'zone_district_918_914', entry: 'zone_spirit_shop',    npc: 'npc_spirit_cassavetes',  rooms: ['zone_spirit_shop', 'zone_spirit_store', 'zone_util_zone_spirit_shop'] },
  { name: 'Past Perfect',    facade: 'zone_district_916_914', street: 'zone_district_915_914', entry: 'zone_pastperf_hall',  npc: 'npc_past_mullan',        rooms: ['zone_pastperf_hall', 'zone_pastperf_office', 'zone_util_zone_pastperf_hall'] },
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('   ✗ ' + m); } };

await initWorld();
await initEnvironment({ query, emitHook: async () => {}, broadcast: () => {}, getOccupiedZones: () => [] });

for (const b of BUILDINGS) {
  console.log(`\n── ${b.name} ───────────────────────────────`);
  const f = getZone(b.facade);
  ok(!!f, `facade ${b.facade} is not in the world`);
  if (!f) continue;

  // 1. It is a real enterable facade, which is what both icon lookups are gated on.
  ok(isEnterableFacade(f), 'not an enterable facade (facade tag + interior map + entry zone)');
  ok(!!buildingIconSvg(f), 'buildingIconSvg returned nothing — the icon is not registered');
  console.log(`   icon: ${buildingIconSvg(f)}   marker: ${f.marker}   type: ${f.flags.building_type}`);

  // 2. The entrance arrow, the facade's street exit and the interior's way out all agree.
  const dir = buildingEntranceDir(f);
  ok(!!dir, 'no entrance direction');
  ok(f.exits?.[dir] === b.street, `facade's ${dir} exit is ${f.exits?.[dir]}, expected the street ${b.street}`);
  const street = getZone(b.street);
  const back = Object.entries(street.exits || {}).find(([, t]) => t === b.facade);
  ok(!!back, 'the street tile does not point back at the facade — you cannot walk in');
  const map = getMapByParentZone(b.facade);
  ok(map?.entry_zone_id === b.entry, `interior map entry is ${map?.entry_zone_id}, expected ${b.entry}`);
  const entry = getZone(b.entry);
  ok(entry?.exits?.[dir] === b.facade, `the interior leaves ${Object.keys(entry?.exits || {}).filter((d) => entry.exits[d] === b.facade)} but the entrance arrow is ${dir}`);
  console.log(`   entrance: ${dir}   street->facade: ${back?.[0]}   interior out: ${dir}`);

  // 3. Every room is POWERED and LIT. A room with no power_zones row is not dark, it is
  //    scored as open air — lit by the sun and pitch black at night.
  for (const r of b.rooms) {
    const vis = getZoneVisibility(r);
    const lit = ['bright', 'blazing', 'clear'].includes(vis?.category);
    ok(lit, `${r} reads "${vis?.category}" — expected bright/clear (check its power_zones row and lumen_output)`);
    console.log(`   ${r.padEnd(34)} ${vis?.category}`);
  }

  // 4. The shopkeeper is where they work, and their stock resolves to real items.
  const npc = [...world.npcs.values()].find((n) => n.id === b.npc);
  ok(!!npc, `${b.npc} is not in the world`);
  if (npc) {
    const inv = npc.vendor_inventory || [];
    ok(inv.length > 0, `${b.npc} has no vendor_inventory`);
    const { rows } = await query('SELECT id FROM items WHERE id = ANY($1)', [inv.map((i) => i.item_id)]);
    const have = new Set(rows.map((r) => r.id));
    for (const i of inv) ok(have.has(i.item_id), `${b.npc} sells ${i.item_id}, which is not an item`);
    console.log(`   vendor: ${npc.name} in ${npc.work_zone_id}, ${inv.length} line(s), all resolve`);
  }
}

// 5. Nothing else in the world lost a way in or out. A facade is non-standable, so the four
//    tiles left the walk graph, and this is the check that nothing was stranded by that.
console.log('\n── connectivity ──────────────────────────────');
{
  const walk = [...world.zones.values()].filter((z) => z.map_id === 'map_world' && !z.flags?.facade && (z.grid_z || 0) === 0);
  const byId = new Map(walk.map((z) => [z.id, z]));
  const seed = byId.get('zone_district_912_909') || walk[0];
  const seen = new Set([seed.id]); const stack = [seed];
  while (stack.length) {
    const cur = stack.pop();
    for (const t of Object.values(cur.exits || {})) { const n = byId.get(t); if (n && !seen.has(n.id)) { seen.add(n.id); stack.push(n); } }
  }
  const coldwater = walk.filter((z) => z.flags?.region_id === 'region_coldwater');
  // ⚠ zone_echelon_exterior is EXEMPT and always has been: the yacht is reached by a dynamic `in`
  // exit, not by a grid link, so it is not in the walk graph by design. Leave it in and this check
  // reports a permanent false positive that trains you to ignore it.
  const stranded = coldwater.filter((z) => !seen.has(z.id) && z.id !== 'zone_echelon_exterior');
  ok(stranded.length === 0, `${stranded.length} Coldwater tile(s) unreachable: ${stranded.slice(0, 6).map((z) => `${z.grid_x},${z.grid_y}`).join(' ')}`);
  console.log(`   reachable from the middle of Marrow Street: ${seen.size} tiles, ${stranded.length} stranded`);
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
