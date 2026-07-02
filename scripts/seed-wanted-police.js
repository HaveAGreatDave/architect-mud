// One-shot script: seed the SPECTER Wanted System's police response (Phase 6).
// Run once:                       node scripts/seed-wanted-police.js
// Place PD cams in named zones:   node scripts/seed-wanted-police.js <zoneId> [zoneId...]
// Blanket every SAFE zone:        node scripts/seed-wanted-police.js safe
//   (the 'safe' keyword expands to all zones with danger_rating='safe' — the
//    policed districts where the law should witness crime.)
//
// Creates: the enemy templates for wanted tiers 1–4 (★5 reuses the existing
// Arbiter), the is_police security_network, and — if zone ids are passed — a
// visible PD street camera in each (so crimes there are witnessed), plus a
// police terminal (for `scrub`) and a cop NPC (for `bribe`/`submit`) in the first.
// Restart the server after seeding (enemy templates are read live on spawn).

import { query } from '../server/models/db.js';

// Standard humanoid/robot hitbox with typed soak (see docs/combat.md).
const parts = (soak) => ([
  { part: 'head',  weight: 1, soak },
  { part: 'torso', weight: 3, soak },
  { part: 'legs',  weight: 2, soak },
]);

const UNITS = [
  {
    id: 'enemy_wanted_patrol_officer', name: 'SPECTER-PD Patrol Officer',
    description: 'A street cop in scuffed riot-lite armor, sidearm already drawn. Not tough, but they radio everything they see.',
    hp: 42, hit: 4, dodge: 3, weapon: [{ type: 'kinetic', min: 2, max: 5 }], soak: { kinetic: 1 },
    death: 'The officer crumples, radio still squawking.',
  },
  {
    id: 'enemy_wanted_patrol_drone', name: 'SPECTER-PD Patrol Drone',
    description: 'A knee-high quadruped drone with a strobing blue eye and a stun-lance. Fast and hard to swat.',
    hp: 30, hit: 4, dodge: 6, weapon: [{ type: 'energy', min: 2, max: 4 }], soak: { kinetic: 1, energy: 2 },
    death: 'The drone sparks, folds its legs, and goes dark.',
  },
  {
    id: 'enemy_wanted_enforcement_trooper', name: 'SPECTER-PD Enforcement Trooper',
    description: 'Full plate, carbine, visor down. These ones don\'t negotiate — they contain.',
    hp: 78, hit: 6, dodge: 4, weapon: [{ type: 'kinetic', min: 4, max: 8 }], soak: { kinetic: 5, energy: 2 },
    death: 'The trooper drops hard, armor scraping the floor.',
  },
  {
    id: 'enemy_wanted_heavy_enforcer', name: 'SPECTER-PD Heavy Enforcer',
    description: 'A slab of ambulatory armor with a chaingun arm and a servo whine you feel in your teeth.',
    hp: 150, hit: 7, dodge: 2, weapon: [{ type: 'kinetic', min: 6, max: 10 }, { type: 'energy', min: 2, max: 4 }], soak: { kinetic: 8, energy: 5 },
    death: 'The enforcer topples like a felled statue, hydraulics venting.',
  },
];

let created = 0, skipped = 0;

for (const u of UNITS) {
  await query(
    `INSERT INTO enemies (id, name, description, hp_max, loot_table, behavior, faction, death_message, flags, hit, dodge, weapon, body_parts)
     VALUES ($1,$2,$3,$4,'[]','aggressive','police',$5,'{}',$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, description=EXCLUDED.description, hp_max=EXCLUDED.hp_max,
       death_message=EXCLUDED.death_message, hit=EXCLUDED.hit, dodge=EXCLUDED.dodge,
       weapon=EXCLUDED.weapon, body_parts=EXCLUDED.body_parts`,
    [u.id, u.name, u.description, u.hp, u.death, u.hit, u.dodge,
     JSON.stringify(u.weapon), JSON.stringify(parts(u.soak))]
  );
  console.log(`UPSERT enemy ${u.id}`);
}

// Police security network.
await query(
  `INSERT INTO security_networks (id, owner_id, name, color, is_police, encryption)
   VALUES ('net_police','faction_police','SPECTER-PD',$1,1,8)
   ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, is_police=1`,
  ['#4aa3ff']
);
console.log('UPSERT network net_police');

let zones = process.argv.slice(2);
if (zones.includes('safe')) {
  // Blanket every safe zone — but skip bathrooms (no cameras where people relieve themselves).
  const { rows } = await query(
    `SELECT id FROM zones z
      WHERE danger_rating='safe'
        AND z.name NOT ILIKE '%bathroom%' AND z.name NOT ILIKE '%restroom%'
        AND z.name NOT ILIKE '%washroom%' AND z.name NOT ILIKE '%lavatory%'
        AND z.name NOT ILIKE '%latrine%'
        AND NOT EXISTS (SELECT 1 FROM furniture t WHERE t.zone_id=z.id AND t.object_type='toilet')
      ORDER BY id`
  );
  zones = rows.map(r => r.id);
  console.log(`Expanding 'safe' → ${zones.length} safe zone(s) (bathrooms excluded).`);
}
for (const zone of zones) {
  const { rows: zrows } = await query('SELECT id FROM zones WHERE id=$1', [zone]);
  if (!zrows.length) { console.error(`SKIP  zone "${zone}" not found`); skipped++; continue; }

  const camId = `secdev_pd_${zone}`;
  await query(
    `INSERT INTO security_devices (id, network_id, owner_id, device_kind, zone_id, direction, tier,
       concealment, battery, battery_max, wired, is_powered, is_damaged, hack_difficulty, placed_at)
     VALUES ($1,'net_police','faction_police','sticky_cam',$2,'north',2,3,1,1,1,1,0,6,$3)
     ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, network_id='net_police', is_damaged=0, is_powered=1`,
    [camId, zone, Math.floor(Date.now() / 1000)]
  );
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
     VALUES ($1,$2,'PD Street Camera',$3,'security_device',$4)
     ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id`,
    [camId, zone,
     'A hardened municipal camera on a tall pole, blue status light steady. A decal reads SPECTER-PD — SMILE.',
     JSON.stringify({ security_device: true, device_id: camId, concealed: false })]
  );
  console.log(`UPSERT PD cam in ${zone}`);
  created++;
}

// Terminal + cop go in the first supplied zone (if any).
const hub = zones[0];
if (hub) {
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
     VALUES ('furn_pd_terminal',$1,'Police Records Terminal',$2,'fixture',$3)
     ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id`,
    [hub, 'A grimy public-access PD kiosk. In theory it files reports. In practice, a good hacker can un-file them.',
     JSON.stringify({ police_terminal: true })]
  );
  console.log(`UPSERT PD terminal in ${hub}`);

  const { rows: cop } = await query(`SELECT id FROM npcs WHERE id='npc_pd_officer'`);
  if (!cop.length) {
    await query(
      `INSERT INTO npcs (id,name,description,zone_id,home_zone,dialogue_tree,vendor_inventory,
         vendor_stock_size,vendor_restock_rate,wanders,flags,chitchat,hp,hp_max,sex)
       VALUES ('npc_pd_officer',$1,$2,$3,$3,$4,'[]',0,0,0,$5,$6,30,30,'other')`,
      ['Sergeant Vale',
       "Sergeant Vale leans against the kiosk, coffee in one hand, the other never far from the sidearm. Their eyes do the arithmetic on everyone who walks past.",
       hub,
       JSON.stringify({
         root: { text: "'SPECTER-PD. You got something for me, or you just loitering?'",
                 options: [{ label: 'I have footage to submit.', next: 'sub' }, { label: 'How much to lose a charge?', next: 'bribe' }, { label: 'Nothing.', next: 'end' }] },
         sub: { text: "'Hand me the chip. If it's chargeable, there's a bounty in it for you.' (use: submit <datachip>)", options: [{ label: 'Right.', next: 'end' }] },
         bribe: { text: "'...Petty heat only. And it'll cost you. Don't make it weird.' (use: bribe)", options: [{ label: 'Understood.', next: 'end' }] },
         end: { text: "'Move along.'", options: [] },
       }),
       JSON.stringify({ police: true }),
       JSON.stringify(["Vale sips coffee and watches the street.", "'Stay clean and we stay friendly.'"])]
    );
    console.log('CREATE npc npc_pd_officer'); created++;
  } else { console.log('SKIP  npc npc_pd_officer'); skipped++; }
}

console.log(`Done. Created/updated ${created}, skipped ${skipped}. Restart the server. ${zones.length ? '' : '(Pass zone ids to place PD cams + terminal + officer.)'}`);
process.exit(0);
