// One-shot content seed for the jail system. Run once against the DB:
//   node scripts/create-jail.js
// Idempotent — skips anything already present. After running, restart the server
// (or hit POST /world/reload) so the door/NPC load into the world cache.
//
// Adds:
//   - an un-hackable hololock on the Holding → Lobby exit, so a jailed player is
//     locked in (the jail plugin respawns them in Holding). Only the police open
//     it — the guard release path teleports you out; there is no player bypass.
//   - a stationary desk guard in the Lobby for texture.
import { query } from '../server/models/db.js';

const CELL_ZONE = 'zone_mq_precinct_holding';
const LOBBY_ZONE = 'zone_mq_precinct_lobby';

// ── Cell door ────────────────────────────────────────────────────────────────
const DOOR_ID = 'door_precinct_cell';
const lockTag = {
  'lock:hololock': {
    difficulty: 10,          // "very high" — moot while canHack is false, kept for record
    canHack: false,          // police-only: no deck can bypass it; you leave when the guard walks you out
    messages: {
      lock:   'The cell hololock slams shut with a heavy magnetic clunk.',
      unlock: 'The cell hololock disengages.',
      denied: 'The cell hololock flatly refuses your credentials. You are not going anywhere.',
    },
  },
};

const door = await query('SELECT id FROM doors WHERE id=$1', [DOOR_ID]);
if (door.rows.length) {
  console.log(`SKIP  ${DOOR_ID} (already exists)`);
} else {
  await query(
    `INSERT INTO doors (id, zone_id, exit_dir, target_zone, door_type, is_open, hp, hp_max, lock_state, name, tags)
     VALUES ($1,$2,'up',$3,'reinforced',0,2000,2000,'locked',$4,$5)`,
    [DOOR_ID, CELL_ZONE, LOBBY_ZONE, 'reinforced cell door', JSON.stringify(lockTag)]
  );
  console.log(`CREATED ${DOOR_ID} (hololock difficulty 10, locked)`);
}

// ── Desk guard (flavor; the release is driven by the plugin, not this NPC) ────
const GUARD_ID = 'npc_precinct_guard';
const guard = await query('SELECT id FROM npcs WHERE id=$1', [GUARD_ID]);
if (guard.rows.length) {
  console.log(`SKIP  ${GUARD_ID} (already exists)`);
} else {
  await query(
    `INSERT INTO npcs (id, name, description, zone_id, home_zone, faction, wanders, hp, hp_max, sex, flags)
     VALUES ($1,$2,$3,$4,$4,$5,0,60,60,'male',$6)`,
    [
      GUARD_ID,
      'Detention Officer Kohl',
      'A block of a man in Precinct 9 body armor, thumbs hooked in his belt beside a baton and a zip-tie dispenser. He watches the holding block on a bank of monitors and processes the overnight guests one at a time, without hurry and without interest.',
      LOBBY_ZONE,
      'SPECTER-PD',
      JSON.stringify({ essential: true }),
    ]
  );
  console.log(`CREATED ${GUARD_ID}`);
}

process.exit(0);
