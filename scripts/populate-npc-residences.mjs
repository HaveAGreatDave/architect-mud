// Populate the npc_residences tracker + house NPCs in The Meridian.
//
// Does three things (idempotent, dry-run by default):
//   1. FLAG-FIX — the four Meridian units that already have NPC residents plus the
//      four we're about to fill are missing the is_apartment flag (a data bug that
//      currently hides them from the rent flow by accident). Set is_apartment=true
//      on those eight units so they're proper apartments, protected deliberately by
//      the tracker rather than by a missing flag.
//   2. HOUSE THE UNHOUSED — four NPCs are stranded on the generic zone_residential_lobby
//      home default. Give each a vacant Meridian unit as home_zone (skips any unit a
//      player owns). This is what "populate the Meridian with NPCs" means.
//   3. RECONCILE npc_residences — rebuild the tracker from every NPC whose home_zone
//      is an apartment unit that no player owns. Self-correcting: DELETE-all then
//      re-derive, so stale rows drop and every real NPC home is registered. Units an
//      NPC shares with a player owner (e.g. Embassy 1A) are reported and left alone.
//
// Rewrites EXISTING rows → the reserved data-transformation one-shot (not the
// additive deploy). Dry-run by default.
//
//   node scripts/populate-npc-residences.mjs            # local, dry run
//   node scripts/populate-npc-residences.mjs --apply    # local, write
//   node --env-file=.env.prod scripts/populate-npc-residences.mjs --apply   # prod
//
import 'dotenv/config';
import { query } from '../server/models/db.js';

const APPLY = process.argv.includes('--apply');

// The eight Meridian units that carry (or will carry) an NPC resident.
const MERIDIAN_UNITS = [
  'zone_meridian_unit_101', 'zone_meridian_unit_102', 'zone_meridian_unit_103', 'zone_meridian_unit_104',
  'zone_meridian_unit_201', 'zone_meridian_unit_202', 'zone_meridian_unit_203', 'zone_meridian_unit_204',
];

// Unhoused NPCs (stuck on the lobby default) → a vacant Meridian unit each.
const REHOME = [
  { id: 'npc_charter_soto',   name: 'Magpie Soto',   unit: 'zone_meridian_unit_101' },
  { id: 'npc_fs_dispatcher',  name: 'Marta Kell',    unit: 'zone_meridian_unit_102' },
  { id: 'npc_charter_kessler',name: 'Old Kessler',   unit: 'zone_meridian_unit_104' },
  { id: 'npc_charter_doyle',  name: 'Ratchet Doyle', unit: 'zone_meridian_unit_204' },
];

async function main() {
  console.log(`=== populate-npc-residences (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  // 1. FLAG-FIX ---------------------------------------------------------------
  console.log('1. Make the 8 occupied Meridian units proper apartments (is_apartment=true):');
  for (const u of MERIDIAN_UNITS) {
    const { rows } = await query(`SELECT flags->>'is_apartment' AS a FROM zones WHERE id=$1`, [u]);
    console.log(`   ${u}  is_apartment: ${rows[0]?.a ?? '(missing)'} → true`);
  }
  if (APPLY) {
    await query(
      `UPDATE zones SET flags = jsonb_set(COALESCE(flags,'{}'::jsonb), '{is_apartment}', 'true')
        WHERE id = ANY($1)`, [MERIDIAN_UNITS]);
  }

  // 2. HOUSE THE UNHOUSED -----------------------------------------------------
  console.log('\n2. House unhoused NPCs in The Meridian (skips any player-owned unit):');
  for (const r of REHOME) {
    const { rows: owned } = await query(
      `SELECT owner_handle FROM apartments WHERE zone_id=$1 AND owner_id IS NOT NULL`, [r.unit]);
    if (owned.length) { console.log(`   ✗ ${r.name}: ${r.unit} owned by ${owned[0].owner_handle} — SKIPPED`); continue; }
    const { rows: cur } = await query(`SELECT home_zone FROM npcs WHERE id=$1`, [r.id]);
    if (!cur.length) { console.log(`   ✗ ${r.name} (${r.id}) not found — SKIPPED`); continue; }
    console.log(`   ${r.name.padEnd(15)} home ${cur[0].home_zone} → ${r.unit}`);
    if (APPLY) await query(`UPDATE npcs SET home_zone=$1 WHERE id=$2`, [r.unit, r.id]);
  }

  // 3. RECONCILE npc_residences ----------------------------------------------
  // Report any apartment an NPC calls home that a PLAYER owns — a conflict we leave alone.
  const { rows: conflicts } = await query(`
    SELECT n.id, n.name, n.home_zone, a.owner_handle
    FROM npcs n JOIN zones z ON z.id=n.home_zone
    JOIN apartments a ON a.zone_id=n.home_zone AND a.owner_id IS NOT NULL
    WHERE COALESCE((z.flags->>'is_apartment')::boolean,false)=true`);
  if (conflicts.length) {
    console.log('\n⚠ NPCs whose home is a PLAYER-OWNED unit (left unregistered — you may want to re-home them):');
    for (const c of conflicts) console.log(`   ${c.name} → ${c.home_zone} (owned by ${c.owner_handle})`);
  }

  // Preview the reconciled set (what WILL be registered).
  const { rows: willReg } = await query(`
    SELECT DISTINCT ON (n.home_zone) n.home_zone AS zone_id, n.id AS npc_id, n.name
    FROM npcs n JOIN zones z ON z.id=n.home_zone
    LEFT JOIN apartments a ON a.zone_id=n.home_zone
    WHERE COALESCE((z.flags->>'is_apartment')::boolean,false)=true AND a.owner_id IS NULL
    ORDER BY n.home_zone, n.id`);
  console.log(`\n3. Reconcile npc_residences → ${willReg.length} units registered as NPC homes:`);
  for (const r of willReg) console.log(`   ${r.zone_id.padEnd(24)} ${r.name}`);

  if (APPLY) {
    await query('DELETE FROM npc_residences');
    await query(`
      INSERT INTO npc_residences (zone_id, npc_id)
      SELECT DISTINCT ON (n.home_zone) n.home_zone, n.id
      FROM npcs n JOIN zones z ON z.id=n.home_zone
      LEFT JOIN apartments a ON a.zone_id=n.home_zone
      WHERE COALESCE((z.flags->>'is_apartment')::boolean,false)=true AND a.owner_id IS NULL
      ORDER BY n.home_zone, n.id`);
    const { rows: n } = await query('SELECT count(*)::int AS c FROM npc_residences');
    console.log(`\n✓ APPLIED. npc_residences now has ${n[0].c} rows. Restart / reload to pick up homes + flags.`);
  } else {
    console.log('\nRe-run with --apply to write:\n  node scripts/populate-npc-residences.mjs --apply');
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
