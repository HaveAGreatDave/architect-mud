// One-shot: salvage the load-bearing content off the 224 legacy map_world exterior
// tiles before they're deleted (see docs/proposals/legacy-world-decommission.md).
//
// The zone-planner relocated the 18 building INTERIORS into district facades, but the
// old exterior overworld (The Threshold, Marquee, Wastes, Redline, Bay, Slagworks…)
// still holds a safe hub, 17 job-board quests, unique apex spawns, 6 hangar seams and
// some functional furniture. This script (Salvage + Abandon strategy) rescues only the
// load-bearing pieces into the district, so the legacy tiles can then be git-deleted.
//
//   node scripts/salvage-legacy-world.mjs --phase=1          # dry-run one phase
//   node scripts/salvage-legacy-world.mjs --phase=1 --write  # apply one phase
//   node scripts/salvage-legacy-world.mjs --write            # apply phases 1-5
//
// Edits content/<table>/*.json directly (git = source of truth) via the pipeline's
// canonicalJson(); idempotent (re-running produces the same bytes). NON-DESTRUCTIVE —
// deletion of the legacy tiles is a separate, user-gated step (Phase 6).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, CONTENT_DIR } from './content/lib.mjs';

const WRITE = process.argv.includes('--write');
const PHASE = (process.argv.find(a => a.startsWith('--phase=')) || '').split('=')[1] || 'all';
const runPhase = (n) => PHASE === 'all' || PHASE === String(n);

const dir = (t) => join(CONTENT_DIR, t);
const loadAll = (t) => readdirSync(dir(t)).filter(f => f.endsWith('.json'))
  .map(f => ({ file: join(dir(t), f), name: f, o: JSON.parse(readFileSync(join(dir(t), f), 'utf8')) }));
const save = (rec) => { if (WRITE) writeFileSync(rec.file, canonicalJson(rec.o)); };

const zones = loadAll('zones');
const byId = new Map(zones.map(z => [z.o.id, z]));
const isDistrict = z => z.created_by === 'zone-planner' || z.flags?.planner === 'bp_district';
const legacyIds = new Set(zones.filter(z => z.o.map_id === 'map_world' && !isDistrict(z.o)).map(z => z.o.id));

let changed = 0;
const log = (...a) => console.log(...a);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Safe hub at the spawn landing (zone_district_918_904, Ironside Street)
// The clone-facility facade's world_exit lands players here. Mirror the old
// Threshold's neutral-ground treatment: no_spawn + intro_lore (it already carries
// scavenging_table_id=scav_roadside_junk). No hostile spawn sits on this tile.
// ─────────────────────────────────────────────────────────────────────────────
function phase1() {
  log('\n── Phase 1: safe hub ──');
  const HUB = 'zone_district_918_904';
  const hub = byId.get(HUB);
  if (!hub) { log(`  ! ${HUB} not found`); return; }
  const fl = hub.o.flags || (hub.o.flags = {});
  const before = JSON.stringify(fl);
  fl.no_spawn = true;
  fl.intro_lore = "Ironside Street is as close to neutral ground as the district keeps — a sagging stretch of broken kerb where every route in and out of the wastes has to pass, and nobody's yet managed to hold it. You'll cross it a hundred times; the trick is making it a hundred and one.";
  if (JSON.stringify(fl) !== before) {
    log(`  + ${HUB} (${hub.o.name}): +no_spawn +intro_lore  ${WRITE ? '[written]' : '[dry-run]'}`);
    save(hub); changed++;
  } else log(`  = ${HUB} already a hub`);
}

if (runPhase(1)) phase1();

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Repoint the 17 quest_fs_* job-board gigs off deleted exterior tiles.
// Each broken legacy ref → a unique district tile (distinct within every quest).
// Objective `desc` is reset to the target tile's name; place-names in prose/emotes
// are substituted old→new (longest-first) so the flavour stays coherent. Interior
// refs (mq_grocery / mq_pigeon_bar / mq_sump_bar) already relocated — left alone.
// ─────────────────────────────────────────────────────────────────────────────
// Each broken ref → a unique district tile, assigned so that no two refs that
// co-occur in the same quest share a street NAME (graph-coloured by hand; verified
// distinct across all 17 gigs). Comment = the tile's street name.
const QUEST_REPOINT = {
  zone_threshold:      'zone_district_918_904', // Ironside Street (the new hub)
  zone_thresholdeast:  'zone_district_907_908', // Meltwater Row
  zone_city_east:      'zone_district_912_912', // Foundry Way
  zone_city_north:     'zone_district_894_904', // Halcyon Boulevard
  zone_city_west:      'zone_district_912_909', // Marrow Street
  zone_city_south:     'zone_district_903_909', // Voss Avenue
  zone_city_sw:        'zone_district_902_907', // Cinder Lane
  zone_city_ne:        'zone_district_913_913', // Foundry Way
  zone_city_se:        'zone_district_894_905', // Halcyon Boulevard
  zone_outskirts:      'zone_district_921_913', // Residential Area
  zone_slums:          'zone_district_913_909', // Marrow Street
  zone_velk_exterior:  'zone_district_904_909', // Voss Avenue
  zone_mq_marquee:     'zone_district_902_908', // Cinder Lane
  zone_mq_cathode:     'zone_district_913_912', // Foundry Way
  zone_mq_battery:     'zone_district_894_906', // Halcyon Boulevard
  zone_mq_overpass:    'zone_district_914_909', // Marrow Street
  zone_dock_fishmarket:'zone_district_909_902', // Pier
  zone_dock_quays:     'zone_district_909_911', // Fisherman Statue
  zone_dock_wharf:     'zone_district_907_911', // Meltwater Row
  zone_yard_reefer:    'zone_district_907_910', // Meltwater Row
  zone_yard_container: 'zone_district_916_909', // Marrow Street
  zone_yard_sidings:   'zone_district_914_913', // Foundry Way
  zone_meat_carrion:   'zone_district_902_911', // Cinder Lane
  zone_meat_offal:     'zone_district_915_909', // Marrow Street
  zone_civ_ledger:     'zone_district_894_907', // Halcyon Boulevard
  zone_gov_registry:   'zone_district_905_909', // Voss Avenue
};

function phase2() {
  log('\n── Phase 2: repoint job-board quests ──');
  // old display-name → new display-name. Quest prose uses bare, article, and
  // "the"-lowercased forms ("The Threshold", "the Threshold", "Threshold"), so
  // generate every variant and apply globally longest-first (so "Threshold East"
  // is consumed before bare "Threshold", and "Threshold Plaza North" before both).
  const subs = [];
  for (const [oldId, newId] of Object.entries(QUEST_REPOINT)) {
    const oldN = byId.get(oldId)?.o.name, newN = byId.get(newId)?.o.name;
    if (!oldN || !newN || oldN === newN) continue;
    const bare = oldN.replace(/^The /, '');
    for (const v of new Set([oldN, oldN.replace(/^The /, 'the '), bare, 'the ' + bare])) subs.push([v, newN]);
  }
  subs.sort((a, b) => b[0].length - a[0].length);
  const substitute = (s) => {
    if (typeof s !== 'string') return s;
    for (const [oldN, newN] of subs) s = s.split(oldN).join(newN);
    return s;
  };
  for (const q of loadAll('quests')) {
    if (!q.o.id.startsWith('quest_fs_')) continue;
    const before = canonicalJson(q.o);
    q.o.name = substitute(q.o.name);
    q.o.description = substitute(q.o.description);
    for (const obj of q.o.objectives || []) {
      const tgt = QUEST_REPOINT[obj.zone];
      if (tgt) { obj.zone = tgt; obj.desc = byId.get(tgt).o.name; }
      else if (obj.desc) obj.desc = substitute(obj.desc);
      if (Array.isArray(obj.emotes)) obj.emotes = obj.emotes.map(substitute);
    }
    if (canonicalJson(q.o) !== before) {
      log(`  + ${q.o.id} (${q.o.name})  ${WRITE ? '[written]' : '[dry-run]'}`);
      save(q); changed++;
    }
  }
}

if (runPhase(2)) phase2();

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Rehome the distinctive / apex enemies that spawn ONLY in legacy tiles.
// The district's own wave is 6 tame types; these add back the frontier apexes and
// some industrial variety. Trash-tier duplicates (slag_rat/scav/scrap_picker/
// squatter/slag_wretch) are deliberately dropped. Original tuning is preserved.
// Apex → deep-west frontier grass + deep water (thematically ideal, clear of the
// no_spawn hub and the quest tiles).
// ─────────────────────────────────────────────────────────────────────────────
const SPAWN_TUNING = {
  enemy_bay_leviathan:  { max_count: 1, respawn_seconds: 420, spawn_weight: 35 },
  enemy_redline_horror: { max_count: 1, respawn_seconds: 900, spawn_weight: 100 },
  enemy_tar_horror:     { max_count: 1, respawn_seconds: 320, spawn_weight: 45 },
  enemy_architect_drone:{ max_count: 1, respawn_seconds: 600, spawn_weight: 20 },
  enemy_slag_wight:     { max_count: 1, respawn_seconds: 280, spawn_weight: 45 },
  enemy_wire_jackal:    { max_count: 2, respawn_seconds: 180, spawn_weight: 55 },
  enemy_rusted_sweeper: { max_count: 1, respawn_seconds: 240, spawn_weight: 20 },
  enemy_sprawl_ganger:  { max_count: 1, respawn_seconds: 260, spawn_weight: 45 },
};
const SPAWN_REHOME = {
  enemy_bay_leviathan:  ['zone_district_892_897', 'zone_district_892_898'], // deep water
  enemy_redline_horror: ['zone_district_891_903'],                           // frontier
  enemy_tar_horror:     ['zone_district_891_904', 'zone_district_891_905'],
  enemy_architect_drone:['zone_district_891_906', 'zone_district_891_907'],
  enemy_rusted_sweeper: ['zone_district_891_908'],
  enemy_slag_wight:     ['zone_district_902_909', 'zone_district_902_910', 'zone_district_906_909'],
  enemy_wire_jackal:    ['zone_district_907_909', 'zone_district_907_912', 'zone_district_907_913'],
  enemy_sprawl_ganger:  ['zone_district_921_916', 'zone_district_922_912'], // residential
};

function phase3() {
  log('\n── Phase 3: rehome apex/unique spawns ──');
  const sdir = dir('zone_spawns');
  for (const [enemy, tiles] of Object.entries(SPAWN_REHOME)) {
    for (const zone of tiles) {
      if (!byId.get(zone)) { log(`  ! target ${zone} missing — skip`); continue; }
      const id = `zs_district_${zone.replace('zone_', '')}_${enemy.replace('enemy_', '')}`;
      const row = { enemy_id: enemy, id, zone_id: zone, ...SPAWN_TUNING[enemy] };
      const file = join(sdir, `${id}.json`);
      const json = canonicalJson(row);
      if (existsSync(file) && readFileSync(file, 'utf8') === json) { log(`  = ${id}`); continue; }
      log(`  + ${id} (${byId.get(zone).o.name})  ${WRITE ? '[written]' : '[dry-run]'}`);
      if (WRITE) writeFileSync(file, json);
      changed++;
    }
  }
}

if (runPhase(3)) phase3();

log(`\n${WRITE ? 'WROTE' : 'DRY-RUN'} — ${changed} file(s) ${WRITE ? 'changed' : 'would change'}.`);
