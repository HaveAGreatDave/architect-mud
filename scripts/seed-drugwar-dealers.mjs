// One-shot content seed: the three covert street dealers of the drug war.
//
//   node scripts/seed-drugwar-dealers.mjs
//
// Each dealer is the visible street agent of a seed faction, anchored to one
// district. They use the existing covert-dealer contract (plugins/dealer): a
// spoken passphrase opens a trust-gated shop during their dealing hours; buying
// earns trust, unlocking heavier product. Nothing about them advertises a shop,
// and their NAMES never say "dealer" — only a careful `examine` leaks the tells.
//
//   Dov Keller  — Franchise, the Core (near Franchise Strip), 2am–6am (tightest)
//   Gita Marsh  — Breakers, the Marquee (Dirty Pigeon / Cherry Pit), bar hours
//   Wick Sorel  — Glitch,   the Yards (fronts as a night-dispatch operator)
//
// Idempotent: ON CONFLICT (id) DO UPDATE re-points each dealer, so re-running
// cleanly repaints Keller (formerly `npc_the_fixer`, "a hooded figure") and
// keeps Marsh/Sorel in sync. Depends on the drug items existing (content/items);
// the catalogue is filtered against the live `items` table so a missing id is
// dropped with a warning rather than sold as a phantom. A server restart (or
// /world reload) loads the NPCs into world.npcs.
import { query } from '../server/models/db.js';

// Faction-flavoured, trust-tiered catalogues. Every item_id below is confirmed
// present in content/items. min_trust gates visibility per player (vendor.js).
const DEALERS = [
  {
    id: 'npc_the_fixer',            // keep the existing id; just becomes Keller
    name: 'Dov Keller',
    sex: 'male',
    faction: 'faction_franchise',
    description:
      "A neat, unremarkable man in a good coat gone shabby, always half-turned toward the nearest exit. His fingers are stained blue-black with something like ink, and they never stop moving — counting, always counting, though there's nothing in his hands to count. He meets your eyes for exactly as long as it takes to price you, then finds the door again.",
    home_zone: 'zone_city_west',
    wander_zones: ['zone_city_west', 'zone_start', 'zone_threshold', 'zone_thresholdeast'],
    deal_from: 2, deal_to: 6,       // 2am–6am, the tightest window
    trust_flag: 'keller_trust',
    inner_circle_flag: 'keller_inner_circle',
    passphrases: ["clearance rack's open", "you on the list", "cash only after two"],
    hint: 'Scratched low on the wall, half-legible: "after two, ask the man who counts. read the wall for the words."',
    chitchat: [
      "doesn't look up.",
      'murmurs a number under his breath, then loses it.',
      '"Wrong man. Keep moving."',
      'watches the exit like it owes him money.',
    ],
    catalogue: [
      // Tier 0 — the strip's everyday product
      { item_id: 'item_drug_buzz',  price: 60,  min_trust: 0 },
      { item_id: 'item_dreamsmoke', price: 70,  min_trust: 0 },
      { item_id: 'item_lull',       price: 100, min_trust: 0 },
      // Tier 25 — a familiar face
      { item_id: 'item_static',     price: 140, min_trust: 25 },
      { item_id: 'item_laughers',   price: 120, min_trust: 25 },
      // Tier 45 — a regular
      { item_id: 'item_mescaline',  price: 150, min_trust: 45 },
      { item_id: 'item_redline',    price: 175, min_trust: 45 },
      // Tier 70 — trusted
      { item_id: 'item_coldfire',   price: 360, min_trust: 70 },
      // Tier 90 — inner circle (the Core's namesake breath)
      { item_id: 'item_threshold',  price: 550, min_trust: 90 },
    ],
  },
  {
    id: 'npc_dealer_marsh',
    name: 'Gita Marsh',
    sex: 'female',
    faction: 'faction_breakers',
    description:
      "Gita Marsh holds down the end of the bar like she paid for it — forearms scarred, knuckles worse, a grin that's mostly threat. She watches the door more than the room and greets trouble by name. Whatever she's moving, she isn't shy about who she is; only about what.",
    home_zone: 'zone_mq_pigeon_bar',
    wander_zones: ['zone_mq_pigeon_bar', 'zone_mq_cherry_floor', 'zone_mq_marquee', 'zone_mq_sump_bar'],
    deal_from: 18, deal_to: 3,       // bar hours, brazen
    trust_flag: 'marsh_trust',
    inner_circle_flag: 'marsh_inner_circle',
    passphrases: ["who's asking", "back room's warm", "buy me a round first"],
    hint: 'Gouged into the bar-top with a knife: "ask Marsh what\'s warm in back. words change — listen at the bar."',
    chitchat: [
      'snorts. "Do I know you?"',
      'cracks a knuckle, unhurried.',
      '"Buy something or hold up a wall somewhere else."',
      'sizes you up like a fight she hasn\'t started yet.',
    ],
    catalogue: [
      // Tier 0 — quick and roaring
      { item_id: 'item_amyls',     price: 40,  min_trust: 0 },
      { item_id: 'item_ether',     price: 45,  min_trust: 0 },
      // Tier 25 — the bar's back-room fare
      { item_id: 'item_laughers',  price: 120, min_trust: 25 },
      { item_id: 'item_screamers', price: 145, min_trust: 25 },
      // Tier 45 — for the regulars who bleed here
      { item_id: 'item_redline',   price: 175, min_trust: 45 },
      { item_id: 'item_blotter',   price: 185, min_trust: 45 },
      { item_id: 'item_grey',      price: 210, min_trust: 45 },
      // Tier 70 — the heavy nod
      { item_id: 'item_blacktar',  price: 300, min_trust: 70 },
      { item_id: 'item_coldfire',  price: 360, min_trust: 70 },
      // Tier 90 — past the red line
      { item_id: 'item_overclock', price: 500, min_trust: 90 },
    ],
  },
  {
    id: 'npc_dealer_sorel',
    name: 'Wick Sorel',
    sex: 'male',
    faction: 'faction_glitch',
    description:
      "Wick Sorel wears a hi-vis vest bleached grey with age and carries a clipboard no one has asked to see in years. He talks pallets and pickup windows into an intercom that stopped answering long before you got here, and he'll quote you a delivery schedule for anything — anything at all — if you know how to ask for it.",
    home_zone: 'zone_yard_depot',
    wander_zones: ['zone_yard_depot', 'zone_yard_container', 'zone_yard_railhead', 'zone_yard_loadout', 'zone_yard_marshalling'],
    deal_from: 8, deal_to: 22,       // daylight-capable; fronts as legit
    trust_flag: 'sorel_trust',
    inner_circle_flag: 'sorel_inner_circle',
    passphrases: ["got a delivery for me", "the intercom's dead", "signing for a package"],
    hint: 'Stencilled on a container, then keyed over: "off-manifest pickups — say the right consignment. it changes. check the crate."',
    chitchat: [
      'taps his clipboard. "You on the manifest?"',
      'mutters a consignment number into the dead intercom.',
      '"Nothing moves off this dock without paper."',
      'checks a schedule that hasn\'t updated in years.',
    ],
    catalogue: [
      // Tier 0 — off the back of a truck
      { item_id: 'item_ether',     price: 45,  min_trust: 0 },
      { item_id: 'item_lull',      price: 100, min_trust: 0 },
      // Tier 25 — the clean stuff
      { item_id: 'item_static',    price: 140, min_trust: 25 },
      { item_id: 'item_mescaline', price: 150, min_trust: 25 },
      // Tier 45 — special order
      { item_id: 'item_blotter',   price: 185, min_trust: 45 },
      { item_id: 'item_grey',      price: 210, min_trust: 45 },
      // Tier 70 — the dissociative crates
      { item_id: 'item_khole',     price: 250, min_trust: 70 },
      { item_id: 'item_memhack',   price: 300, min_trust: 70 },
      // Tier 90 — the static between channels
      { item_id: 'item_deadair',  price: 480, min_trust: 90 },
      { item_id: 'item_overclock', price: 500, min_trust: 90 },
    ],
  },
];

function behaviourGraph(d) {
  return {
    _start: 'hours_check',
    nodes: {
      hours_check: { type: 'condition', condition_type: 'HOUR_RANGE', params: { from: d.deal_from, to: d.deal_to }, ifTrue: 'prowl', ifFalse: 'vanish' },
      prowl: { type: 'action', action_type: 'PATROL', params: { waypoints: d.wander_zones, loop: true, mode: 'walk' }, next: 'hours_check' },
      vanish: { type: 'action', action_type: 'GO_HOME', next: 'hours_check' },
    },
  };
}

async function seed() {
  // Confirm which catalogue items actually exist so we never list a phantom.
  const wanted = [...new Set(DEALERS.flatMap(d => d.catalogue.map(c => c.item_id)))];
  const { rows: have } = await query('SELECT id FROM items WHERE id = ANY($1)', [wanted]);
  const present = new Set(have.map(r => r.id));
  const missing = wanted.filter(i => !present.has(i));
  if (missing.length) console.warn(`⚠ dropping ${missing.length} unknown item(s): ${missing.join(', ')}`);

  let n = 0;
  for (const d of DEALERS) {
    const flags = {
      covert: true,
      trust_flag: d.trust_flag,
      trust_per_buy: 8,
      trust_max: 100,
      inner_circle_flag: d.inner_circle_flag,
      deal_from: d.deal_from,
      deal_to: d.deal_to,
      passphrases: d.passphrases,
    };
    const catalogue = d.catalogue.filter(c => present.has(c.item_id));

    await query(
      `INSERT INTO npcs (id, name, description, zone_id, home_zone, npc_type, faction,
          dialogue_tree, vendor_inventory, vendor_stock, vendor_stock_size,
          wanders, wander_zones, flags, behaviour_graph, chitchat, hp, hp_max, sex)
       VALUES ($1,$2,$3,$4,$4,'dealer',$5,
          '{}'::jsonb,$6::jsonb,'[]'::jsonb,0,
          0,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,40,40,$11)
       ON CONFLICT (id) DO UPDATE SET
          name=$2, description=$3, zone_id=$4, home_zone=$4, npc_type='dealer', faction=$5,
          vendor_inventory=$6::jsonb, wander_zones=$7::jsonb, flags=$8::jsonb,
          behaviour_graph=$9::jsonb, chitchat=$10::jsonb, sex=$11`,
      [
        d.id, d.name, d.description, d.home_zone, d.faction,
        JSON.stringify(catalogue), JSON.stringify(d.wander_zones),
        JSON.stringify(flags), JSON.stringify(behaviourGraph(d)),
        JSON.stringify(d.chitchat), d.sex,
      ]
    );

    // Plant a deliberately-vague discovery hint in the home zone. The *live*
    // rotating phrase still comes from the dealer plugin's graffiti-on-entry.
    const { rows: z } = await query('SELECT ambient_events FROM zones WHERE id=$1', [d.home_zone]);
    const events = Array.isArray(z[0]?.ambient_events) ? z[0].ambient_events : [];
    if (!events.includes(d.hint)) {
      await query('UPDATE zones SET ambient_events=$1 WHERE id=$2', [JSON.stringify([...events, d.hint]), d.home_zone]);
    }

    n++;
    console.log(`✓ ${d.name} (${d.faction}) @ ${d.home_zone} — ${catalogue.length} item(s), ${d.deal_from}:00–${d.deal_to}:00`);
  }
  console.log(`\n✓ Seeded ${n}/${DEALERS.length} dealer(s). Restart the server (or /world reload) to load them.`);
}

seed().then(() => process.exit(0)).catch(e => { console.error('✗ seed failed:', e); process.exit(1); });
