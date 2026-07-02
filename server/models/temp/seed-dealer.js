// One-shot seed for the covert shadow drug-dealer ("the Fixer").
//
//   node server/models/temp/seed-dealer.js          # seed if absent
//   node server/models/temp/seed-dealer.js --force    # delete + reseed
//
// Deliberate, run-once. Depends on seed-drugs.js having run (the vendor
// inventory references item_<key> rows). Requires the dealer plugin loaded and
// a server restart to pick the NPC up into the live world. After seeding, tune
// his haunt (wander_zones / behaviour_graph waypoints), passphrases, and stock
// tiers in the dev panel.
//
// Design (see docs/plugins.md → dealer): he wanders dark zones at night, shows
// as "a shadowy presence", never advertises a shop. Saying a passphrase in his
// zone at night opens his trust-gated stock (vendor.js). Buying earns trust,
// unlocking heavier product; maxing it sets `dealer_inner_circle`.

import 'dotenv/config';
import { query, getClient } from '../db.js';

const DEALER_ID = 'npc_the_fixer';

// Trust-tiered catalogue. item_<key> rows come from seed-drugs.js.
// min_trust gates visibility per player; price is the street markup.
const CATALOGUE = [
  // Tier 0 — anyone who knows the words (cheap, low-risk)
  { item_id: 'item_dreamsmoke', price: 70,  min_trust: 0 },
  { item_id: 'item_buzz',       price: 60,  min_trust: 0 },
  { item_id: 'item_lull',       price: 100, min_trust: 0 },
  { item_id: 'item_ether',      price: 45,  min_trust: 0 },
  // Tier 25 — a familiar face
  { item_id: 'item_static',     price: 140, min_trust: 25 },
  { item_id: 'item_laughers',   price: 120, min_trust: 25 },
  { item_id: 'item_psilocybin', price: 90,  min_trust: 25 },
  { item_id: 'item_amyls',      price: 40,  min_trust: 25 },
  // Tier 45 — a regular
  { item_id: 'item_redline',    price: 175, min_trust: 45 },
  { item_id: 'item_grey',       price: 210, min_trust: 45 },
  { item_id: 'item_mescaline',  price: 150, min_trust: 45 },
  { item_id: 'item_blotter',    price: 185, min_trust: 45 },
  { item_id: 'item_screamers',  price: 145, min_trust: 45 },
  // Tier 70 — trusted
  { item_id: 'item_coldfire',   price: 360, min_trust: 70 },
  { item_id: 'item_blacktar',   price: 300, min_trust: 70 },
  { item_id: 'item_khole',      price: 250, min_trust: 70 },
  { item_id: 'item_memhack',    price: 300, min_trust: 70 },
  // Tier 90 — inner circle (the high-trust payoff: the heavy dreamzone + designer stock)
  { item_id: 'item_threshold',  price: 550, min_trust: 90 },
  { item_id: 'item_voidwalk',   price: 480, min_trust: 90 },
  { item_id: 'item_overclock',  price: 500, min_trust: 90 },
];

const CHITCHAT = [
  "doesn't look up.",
  'keeps to the shadows, watching the exits.',
  '"Wrong guy. Keep moving."',
  'says nothing, but you feel watched.',
  'melts a little further into the dark.',
];

const PASSPHRASES = [
  "the static's bad tonight",
  "you holding",
  "ask the shadows",
];

const FLAGS = {
  covert: true,
  trust_flag: 'dealer_trust',
  trust_per_buy: 8,
  trust_max: 100,
  inner_circle_flag: 'dealer_inner_circle',
  deal_from: 21,
  deal_to: 5,
  passphrases: PASSPHRASES,
};

// Generic breadcrumb — points you to his haunt after dark. The *exact* current
// phrase is carried by the rotating graffiti the dealer plugin injects on entry
// (it changes every 2 in-game days), so this static line stays deliberately vague.
const HINT_LINE = 'Scratched into the wall, half-legible: "the words change. come after dark and read the wall."';

const force = process.argv.includes('--force');
const client = await getClient();

try {
  // Pick a handful of shadowy overworld zones for his beat.
  let { rows: shadow } = await client.query(
    `SELECT id, name FROM zones
     WHERE (map_id IS NULL OR map_id = 'map_world')
       AND (name ILIKE ANY('{%alley%,%back%,%tunnel%,%sewer%,%under%,%market%,%dock%,%lot%,%dark%,%shadow%}')
            OR description ILIKE '%dark%' OR description ILIKE '%shadow%' OR description ILIKE '%alley%')
     ORDER BY random() LIMIT 6`
  );
  if (shadow.length < 2) {
    const fb = await client.query(
      `SELECT id, name FROM zones WHERE (map_id IS NULL OR map_id = 'map_world') ORDER BY random() LIMIT 5`
    );
    shadow = fb.rows;
  }
  if (!shadow.length) {
    console.error('✗ No zones found to place the dealer. Seed the world first.');
    process.exit(1);
  }
  const waypoints = shadow.map(z => z.id);
  const homeZone = waypoints[0];

  const behaviourGraph = {
    _start: 'night_check',
    nodes: {
      night_check: { type: 'condition', condition_type: 'HOUR_RANGE', params: { from: FLAGS.deal_from, to: FLAGS.deal_to }, ifTrue: 'prowl', ifFalse: 'vanish' },
      prowl: { type: 'action', action_type: 'PATROL', params: { waypoints, loop: true, mode: 'walk' }, next: 'night_check' },
      vanish: { type: 'action', action_type: 'GO_HOME', next: 'night_check' },
    },
  };

  await client.query('BEGIN');

  if (force) await client.query('DELETE FROM npcs WHERE id=$1', [DEALER_ID]);

  await client.query(
    `INSERT INTO npcs (id, name, description, zone_id, npc_type, faction,
        dialogue_tree, vendor_inventory, vendor_stock, vendor_stock_size,
        wanders, wander_zones, flags, behaviour_graph, home_zone, chitchat,
        hp, hp_max, sex)
     VALUES ($1,$2,$3,$4,'dealer',NULL,
        '{}'::jsonb,$5::jsonb,'[]'::jsonb,0,
        0,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,
        40,40,'male')
     ON CONFLICT (id) DO NOTHING`,
    [
      DEALER_ID,
      'a hooded figure',
      'A lean figure in a hood who keeps to the edges of the light, hands in pockets, eyes everywhere. Nothing about them invites conversation. They could be gone the moment you look away.',
      homeZone,
      JSON.stringify(CATALOGUE),
      JSON.stringify(waypoints),
      JSON.stringify(FLAGS),
      JSON.stringify(behaviourGraph),
      homeZone,
      JSON.stringify(CHITCHAT),
    ]
  );

  // Plant the discoverable passphrase hint as an ambient line in his home haunt.
  const { rows: hz } = await client.query('SELECT ambient_events FROM zones WHERE id=$1', [homeZone]);
  const existing = Array.isArray(hz[0]?.ambient_events) ? hz[0].ambient_events : [];
  if (!existing.includes(HINT_LINE)) {
    await client.query('UPDATE zones SET ambient_events=$1 WHERE id=$2', [JSON.stringify([...existing, HINT_LINE]), homeZone]);
  }

  await client.query('COMMIT');
  console.log(`✓ Seeded ${DEALER_ID} — beat: ${waypoints.join(', ')}`);
  console.log(`  Home/hint zone: ${homeZone}`);
  console.log(`  Passphrases: ${PASSPHRASES.join(' | ')}`);
  console.log('  Restart the server to load him into the live world.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('✗ seed failed:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  process.exit();
}
