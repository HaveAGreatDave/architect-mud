// Phase 6 of the legacy-world decommission: compute the delete closure for the
// legacy overworld, then repoint the surviving CROSS-REFERENCES off it.
// See docs/proposals/legacy-world-decommission.md.
//
//   node scripts/phase6-decommission.mjs            # dry-run: manifest + repoint plan
//   node scripts/phase6-decommission.mjs --write    # apply repoints; write delete list
//
// It does NOT git-rm — it writes the delete file-list to $SCRATCH for a reviewed rm.
//
// Two DISTINCT operations, never conflated:
//   • DELETE  — a row that LIVES on a doomed zone (its zone_id/id IS a deleted zone):
//               zones, maps, furniture, zone_spawns, doors, power_zones, generators,
//               security_devices. These die with the zone.
//   • REPOINT — a surviving row that merely REFERENCES a deleted zone as a target
//               (aa_sites position, ambient route, map entry, NPC patrol/charter,
//               a surviving zone's exit / world_exit_zone). These move to the district.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './content/lib.mjs';

const WRITE = process.argv.includes('--write');
const dir = (t) => join(CONTENT_DIR, t);
const load = (t) => existsSync(dir(t)) ? readdirSync(dir(t)).filter(f => f.endsWith('.json')).map(f => ({ file: join(dir(t), f), name: f, o: JSON.parse(readFileSync(join(dir(t), f), 'utf8')) })) : [];

const zones = load('zones');
const zById = new Map(zones.map(z => [z.o.id, z]));
const isDist = z => z.flags?.planner === 'bp_district' || z.created_by === 'zone-planner';
const legacy = new Set(zones.filter(z => z.o.map_id === 'map_world' && !isDist(z.o)).map(z => z.o.id));

// ── 1. Delete closure (stable — computed from the original legacy set) ────────
// legacy zones + the Blindspot (floating map_id=null) + every interior room on a
// map parented to a doomed zone.
const EXTRA_DELETE = ['zone_surveillance_market', 'zone_util_zone_surveillance_market'];
const maps = load('maps');
const delZones = new Set([...legacy, ...EXTRA_DELETE.filter(z => zById.has(z))]);
for (let grew = true; grew;) {
  grew = false;
  for (const m of maps) {
    if (!delZones.has(m.o.parent_zone_id)) continue;
    for (const z of zones) if (z.o.map_id === m.o.id && !delZones.has(z.o.id)) { delZones.add(z.o.id); grew = true; }
  }
}
const delMaps = maps.filter(m => delZones.has(m.o.parent_zone_id)).map(m => m.o.id);

const LIVES_HERE = ['zone_spawns', 'furniture', 'security_devices', 'doors', 'generators', 'power_zones', 'windows', 'scavenging_tables'];
const delFiles = [];
for (const z of zones) if (delZones.has(z.o.id)) delFiles.push(z.file);
for (const m of maps) if (delMaps.includes(m.o.id)) delFiles.push(m.file);
const inDelSet = new Set(delFiles);
const doorFields = o => [o.zone_id, o.from_zone, o.to_zone, o.target_zone, o.parent_zone];
const depCounts = {};
for (const t of LIVES_HERE) {
  for (const rec of load(t)) {
    const hit = doorFields(rec.o).some(v => delZones.has(v)) || delZones.has(rec.o.id) /* power_zones pk */;
    if (hit) { delFiles.push(rec.file); inDelSet.add(rec.file); depCounts[t] = (depCounts[t] || 0) + 1; }
  }
}

// ── 2. Repoint surviving cross-references ────────────────────────────────────
const REPOINT_MAP = {
  zone_red_killingfloor: 'zone_district_891_903', zone_slag_flarestack: 'zone_district_891_905', zone_waste_ashreach: 'zone_district_891_907',
  zone_threshold: 'zone_district_918_904', zone_thresholdeast: 'zone_district_907_908',
  zone_city_west: 'zone_district_912_909', zone_city_north: 'zone_district_894_904', zone_city_east: 'zone_district_912_912',
  zone_city_ne: 'zone_district_913_913', zone_city_se: 'zone_district_894_905', zone_city_south: 'zone_district_903_909',
  zone_outskirts: 'zone_district_925_903',
  zone_mq_marquee: 'zone_district_902_908', zone_mq_cathode: 'zone_district_913_912',
  zone_velk_exterior: 'zone_district_921_908', zone_drum_exterior: 'zone_district_901_908',
  zone_meridian: 'zone_district_918_908', zone_nc_halcyon: 'zone_district_895_906',
  zone_civ_commons: 'zone_district_907_908', zone_media_plaza: 'zone_district_909_911',
  zone_yard_depot: 'zone_district_908_908', zone_yard_container: 'zone_district_916_909',
  zone_yard_railhead: 'zone_district_908_913', zone_yard_loadout: 'zone_district_909_906',
  zone_yard_marshalling: 'zone_district_925_903', zone_dock_slip: 'zone_district_925_903',
};
const orderedSubs = Object.entries(REPOINT_MAP).sort((a, b) => b[0].length - a[0].length);
const repointText = (s) => { for (const [o, n] of orderedSubs) s = s.replace(new RegExp(o + '(?![a-z0-9_])', 'g'), n); return s; };
// Only tables that carry cross-references — NEVER the lives-here tables.
const XREF_TABLES = ['aa_sites', 'ambient_routines', 'maps', 'npcs', 'quests', 'zones'];

console.log('── Repoint surviving cross-references ──');
let changed = 0;
for (const t of XREF_TABLES) {
  for (const rec of load(t)) {
    if (inDelSet.has(rec.file)) continue;                 // being deleted — don't touch
    const before = JSON.stringify(rec.o);
    if (!Object.keys(REPOINT_MAP).some(z => before.includes(z))) continue;
    const after = repointText(before);
    if (after !== before) { if (WRITE) writeFileSync(rec.file, canonicalJson(JSON.parse(after))); changed++; console.log(`  ${t}/${rec.o.id || rec.name}`); }
  }
}
console.log(`  ${WRITE ? 'wrote' : 'would change'} ${changed} file(s)`);

// ── 3. Manifest ──────────────────────────────────────────────────────────────
console.log('\n── Delete closure ──');
console.log(`  legacy zones: ${legacy.size}  + seam/interior zones: ${delZones.size - legacy.size}  + child maps: ${delMaps.length}`);
console.log('  dependent rows:');
for (const [t, n] of Object.entries(depCounts).sort()) console.log(`      ${t}: ${n}`);
console.log(`  TOTAL files to delete: ${delFiles.length}`);
const listPath = join(process.env.SCRATCH || '.', 'phase6-delete-files.txt');
if (WRITE) { writeFileSync(listPath, delFiles.join('\n')); console.log(`\n  delete list → ${listPath}`); }
else console.log('\n  (dry-run — pass --write)');
