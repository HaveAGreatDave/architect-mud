// One-shot content script: give The Quartermaster's Surplus the same storefront
// treatment every other indoor vendor shop already has — a hololocked entrance
// door and an overhead light. It was the only indoor shop missing both.
//
// Mirrors the drum shop exactly:
//   - door_entrance_zone_drum_exterior  (hololock on the exterior, dir 'in')
//   - furn_light_drum_shop              (overhead light in the interior)
// The exterior "Rebar Cut" (zone_weapons_exterior) already has an "in" exit to
// the shop, so the door binds by (zone_id, exit_dir) with no exits edit needed.
// The vendor (The Quartermaster) has work_zone_id=zone_weapons_shop, so the
// ai-behaviour shop-lock mechanic will lock/unlock this door on their schedule.
//
// Idempotent: skips rows that already exist.
// Run once:  node scripts/add-weapons-shop-door-light.mjs
import { query } from '../server/models/db.js';

const HOLOLOCK_TAG = {
  canHack: true,
  difficulty: 5,
  messages: {
    lock:        'The hololock hums as it engages.',
    unlock:      'The hololock disengages with a soft click.',
    denied:      'The hololock does not recognize your credentials.',
    hackFail:    'The hololock resists your intrusion.',
    hackSuccess: "You bypass the hololock's security matrix.",
  },
};

const DOOR_ID = 'door_entrance_zone_weapons_exterior';
const LIGHT_ID = 'furn_light_zone_weapons_shop';

// --- Entrance door (on the exterior, going 'in') ---
const { rows: haveDoor } = await query('SELECT 1 FROM doors WHERE id=$1', [DOOR_ID]);
if (haveDoor.length) {
  console.log(`SKIP  door ${DOOR_ID} (already exists)`);
} else {
  await query(
    `INSERT INTO doors (id, zone_id, exit_dir, door_type, is_open, is_locked, hp, hp_max,
                        hololock_difficulty, flags, tags, lock_state, name, forcefield_locked, target_zone)
     VALUES ($1,$2,'in','basic',1,0,1000,1000,5,'{}'::jsonb,$3::jsonb,NULL,$4,0,NULL)`,
    [DOOR_ID, 'zone_weapons_exterior', JSON.stringify({ 'lock:hololock': HOLOLOCK_TAG }), "The Quartermaster's Shutter"]
  );
  console.log(`ADD   door ${DOOR_ID}  "The Quartermaster's Shutter"  (hololock, zone_weapons_exterior 'in')`);
}

// --- Overhead light (in the interior) ---
const { rows: haveLight } = await query('SELECT 1 FROM furniture WHERE id=$1', [LIGHT_ID]);
if (haveLight.length) {
  console.log(`SKIP  light ${LIGHT_ID} (already exists)`);
} else {
  const desc = 'Caged sodium fixtures bolted to the ceiling joists, throwing a hard amber '
    + 'wash over the racks of surplus hardware. One flickers on a bad ballast.';
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, flags, light_on, light_type,
                            power_draw_kw, light_on_intended, object_type, lumen_output, price, hp, hp_max)
     VALUES ($1,$2,'overhead light',$3,$4::jsonb,1,'overhead',NULL,NULL,'light',1200,40,NULL,NULL)`,
    [LIGHT_ID, 'zone_weapons_shop', desc, JSON.stringify({ is_light: true, light_type: 'overhead' })]
  );
  console.log(`ADD   light ${LIGHT_ID}  overhead (1200lm) in zone_weapons_shop`);
}

console.log('\nDone. Reload the world (/world/reload) or restart the server so the door + light caches pick these up.');
process.exit(0);
