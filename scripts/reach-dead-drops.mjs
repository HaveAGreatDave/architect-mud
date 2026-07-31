// scripts/reach-dead-drops.mjs — one-shot content authoring.
//
// The fence raw-drug air run used to spawn its pallets on the Buzzard Field apron
// and was unlocked by anyone who walked up to Amos and asked. It's now three DEAD
// DROPS out on the hardpan, gated on being vouched for at both ends of the ground
// trade (dealer_inner_circle AND bm_trust ≥ 10 — see plugins/flight/contracts.js
// hasCacheStanding).
//
// This script authors the content half of that:
//   • three cache tiles themed out of PLANNER STUB into named landmarks, each with
//     a bespoke description, its own ambient pool, and flags.fence_cache
//   • one fixture per tile — the cache itself, so `look` finds it once you're there
//   • Amos's dialogue reworked: the pitch is still open to anyone (it teaches that
//     the trade exists), but ACCEPTING is gated, and he gains a standing
//     dispatcher node — FENCE_CACHE_REPORT — that names which caches are holding
//     a pallet right now. The pool rotates, so that question is asked every run,
//     not once.
//
// The cache tile ids must stay in step with FENCE_CACHES in plugins/flight/contracts.js.
//
// Idempotent. Writes the DB and the content files (content:import is additive and
// can't rewrite the existing zone/npc rows, so both halves are needed).
//
// This is a CLAMP, not a converging script — it overwrites the three zone rows and
// Amos's tree with the text below, so re-running it a year from now would stamp on
// anything authored over the top. It does NOT belong in scripts/oneshots.bat (see
// that file's "one test"). Run it by hand, once per environment.
//
//   node scripts/reach-dead-drops.mjs                     # local dev DB
//   node --env-file=.env.prod scripts/reach-dead-drops.mjs # prod

import { writeFileSync } from 'node:fs';
import { query } from '../server/models/db.js';
import { contentEntries } from '../server/models/content-registry.js';
import { CONTENT_DIR, canonicalJson, fileNameForRow, rowToFileObject } from './content/lib.mjs';

const AMOS = 'npc_1784515608920';
const TRUST_GATE = 10;   // bm_trust — must match CACHE_TRUST_MIN in contracts.js

// ── The three caches ──────────────────────────────────────────────────────────
// Deliberately far from the four buildings and far from each other, so servicing
// one is a real flight rather than a taxi. All three are scrub/lawless already.
const CACHES = [
  {
    zone: 'zone_the_reach_865_1951',
    name: 'The Bonepile',
    marker: 'drop',
    description:
      'A cargo hauler died out here long enough ago that the scrub has grown up through its ribs. The cab is a '
      + 'gutted shell, doors gone, the windscreen a white crust of crazed glass; the trailer behind it has '
      + 'collapsed onto its axles in a long spill of rust. Wind has drifted sand halfway up the near side. '
      + 'Under the trailer bed, where the shadow never moves, the hardpan has been dug out and filled in again — '
      + 'the fill is a shade darker than the ground around it, and tyre-ruts come and go from the north and stop '
      + 'dead at the wreck.',
    ambient: [
      'Something inside the trailer shifts as the metal cools, one long groan, then nothing.',
      'Wind combs through the wreck and comes out the far side whistling on a note the scrub can\'t make.',
      'Sand hisses steadily up against the hauler\'s flank, filling in the last set of ruts.',
      'A buzzard lands on the cab roof, looks at you for a while, and decides you aren\'t dead enough.',
      'Grit ticks against the rusted panels like the start of a rain that never comes.',
      'Far off, an engine drones and fades. Nothing appears on the horizon.',
    ],
    fixture: {
      id: 'furn_reach_cache_bonepile',
      name: 'the fill under the trailer',
      description:
        'Someone dug a pit under the trailer bed and covered it back over, and someone has been opening it again '
        + 'ever since — the fill is loose, and the tarp edge shows at one corner where the last hand was in a '
        + 'hurry. A pallet comes up out of there sand-drifted and heavy as a body. Not a thing you carry: a thing '
        + 'you land next to.',
    },
  },
  {
    zone: 'zone_the_reach_879_1963',
    name: 'The Sump',
    marker: 'drop',
    description:
      'A concrete slab lies flat in the scrub, cracked across the middle, too deliberate to be wreckage and too '
      + 'plain to be a building. It caps a dry cistern from whatever was out here before the Reach was — the '
      + 'crack is wide enough to drop a hand into and the air that comes up out of it is ten degrees cooler than '
      + 'the day. Somebody has dragged the slab aside more than once: there\'s a pale arc scored into the concrete '
      + 'where it pivots, and the scrub around that arc has been ground into dust and never recovered.',
    ambient: [
      'Cool air breathes up out of the crack in the slab, smelling of wet stone and old rust.',
      'A pebble goes into the crack and takes a long, unhurried moment to land.',
      'The slab pops as the heat comes off it, a flat crack that carries much too far.',
      'Something down in the cistern moves in water you can\'t see.',
      'Wind pours across the flats without a single thing to break it for half a mile.',
      'The scoured arc in the concrete catches the low light and shows you exactly how often this gets opened.',
    ],
    fixture: {
      id: 'furn_reach_cache_sump',
      name: 'the capped cistern',
      description:
        'Under the slab the old cistern is dry, dark, and cool, and the frontier has been using it as a pantry: '
        + 'a shelf of stacked block, a bald tarp, rope scars worn into the lip where loads get hauled up. '
        + 'A pallet out of here comes up cold and stays cold most of the way home.',
    },
  },
  {
    zone: 'zone_the_reach_867_1965',
    name: 'The Sisters',
    marker: 'drop',
    description:
      'Two slabs of rock lean into each other out of the flat scrub, forty feet of them, weathered down to the '
      + 'colour of a bad tooth and close enough at the top to make a crooked doorway you could walk a truck '
      + 'through. Between them is the only real shade for miles, and the ground in that shade is packed hard and '
      + 'shiny from traffic. Old paint marks the base of the eastern sister — a number, mostly gone. The wind '
      + 'coming through the gap has a sound to it that carries a long way across the flats.',
    ambient: [
      'The gap between the rocks moans as the wind funnels through, rising and falling like breathing.',
      'A rockfall somewhere above lets go — a rattle, a pause, then a stone hitting the hardpan.',
      'In the shade between the sisters the temperature drops enough to raise the hair on your arms.',
      'Bootprints crowd the packed ground in the gap, all of them coming and going the same way.',
      'A bird you don\'t see calls once off the rock face, and the echo answers it twice.',
      'Grit spirals up the inside face of the eastern sister and pours over the top.',
    ],
    fixture: {
      id: 'furn_reach_cache_sisters',
      name: 'the cleft at the base of the sisters',
      description:
        'The rocks don\'t quite meet the ground on the eastern side, and the gap runs back further than the shade '
        + 'suggests. Sacking, a length of chain, a pallet jack with one wheel gone. Whatever gets left in there is '
        + 'out of the sun and out of the sky, which out here is the same as being invisible.',
    },
  },
];

// ── Amos ──────────────────────────────────────────────────────────────────────
// The pitch stays open to everyone: an unvouched pilot hears what the flats grow
// and is told, plainly, what would make Amos willing to say where. What's gated is
// the acceptance and the dispatcher.
const VOUCHED = [
  { flag: 'dealer_inner_circle', scope: 'player', op: 'set' },
  { flag: 'bm_trust', scope: 'player', op: 'gt', value: String(TRUST_GATE - 1) },
];

const NODES = {
  raws: {
    _vine: { x: 420, y: 380 },
    text: 'Amos studies you a long moment. "The hardpan out past the fence grows a crop the city pays stupid money '
      + 'for. Raw, uncut — no good to anyone till it\'s cooked down proper. We can\'t move it through a checkpoint, '
      + 'and we won\'t." He shrugs. "So it doesn\'t go through one. It sits out in the waste where it was cut, '
      + 'under a tarp, and it waits for a flyer with a hold and no manifest to come and sit down in the dirt '
      + 'beside it."',
    options: [
      { label: 'I\'m in. Tell me where.', next: 'raws_done', conditions: VOUCHED, actions: [{ action: 'UNLOCK_AIR_CARGO' }] },
      { label: 'And how would a man get himself trusted with that?', next: 'raws_unvouched' },
      { label: 'Not my line of work.', next: 'root' },
    ],
  },
  // The gate stated as a person, not as a requirement list. Also the action's own
  // fallback node (contracts.js UNLOCK_AIR_CARGO), so a stale option lands here too.
  raws_unvouched: {
    _vine: { x: 800, y: 200 },
    text: '"He wouldn\'t." Amos says it without heat, the way you\'d read out a weight. "Not from me, not on your '
      + 'face. There\'s a man in the city who doesn\'t exist and won\'t talk to you till you\'ve moved enough of '
      + 'his product to be worth the risk of existing to. When he vouches, that\'s a start." '
      + '<span class="text-dim">He turns a page.</span> "Then there\'s the fence who takes his overflow. Carry '
      + 'crates for him. Walk them through a gate and come out the other side clean, enough times that he stops '
      + 'counting." <span class="text-dim">He looks up.</span> "Do all that and come back. I\'ll know before you '
      + 'tell me."',
    options: [
      { label: 'Fair enough.', next: 'root' },
      { label: 'And then you\'d say where it is?', next: 'raws_then' },
    ],
  },
  raws_then: {
    _vine: { x: 1180, y: 200 },
    text: '"Then I\'d turn this ledger around and show you." <span class="text-dim">He taps the closed cover once.</span> '
      + '"Three places out there hold a load. Never all three at once, and never the same two twice — that\'s the '
      + 'whole trick of it. Which is why you\'d be asking me every single time you came through that door, and '
      + 'why I\'d still be here when you did."',
    options: [{ label: 'Understood.', next: 'root' }],
  },
  raws_done: {
    _vine: { x: 800, y: 380 },
    text: '"Then I\'ll say it once and you\'ll remember it." Amos turns the ledger around. Three lines of shorthand, '
      + 'no map. "<b>The Bonepile</b>, northwest, where the hauler died. <b>The Sump</b>, southeast on the flats, '
      + 'under the slab. <b>The Sisters</b>, southwest, the two rocks leaning together — you\'ll hear them before '
      + 'you see them." <span class="text-dim">He turns it back.</span> "Nothing sits out there on spec. You tell '
      + 'me what you want, I have it run out to one of the three, and I tell you which. Set down <i>on</i> the '
      + 'drop — a pallet that size doesn\'t walk to you, so bring something that can put down rough and has the '
      + 'hold for it. Then <b>loadcargo</b>, and fly it home."',
    options: [
      { label: 'What can I order?', next: 'raws_ladder' },
      { label: 'What have I got out there?', next: 'raws_where' },
      { label: 'Understood.', next: 'root' },
    ],
  },
  // The ladder explained as a business, not as a table. Everything here is true of
  // the built system: legal crop at the bottom, felony precursor above it, and the
  // rungs gated on the same bm_trust the deliveries pay.
  raws_ladder: {
    _vine: { x: 1180, y: 560 },
    text: '"Start with what won\'t get you shot." Amos counts it off on the ledger cover. "Tobacco leaf. Cannabis '
      + 'flower. Baled, legal, dull as ditchwater — a scanner looks straight through it and the money is thin but '
      + 'it is money, and every bale you move is a bale I know you moved." '
      + '<span class="text-dim">He turns his hand over.</span> "Above that it stops being farming. Precursor. '
      + 'The good stuff is a felony in your hold and the customs man is specifically looking for it, and I don\'t '
      + 'write that down for a man who\'s only ever hauled leaf. You\'ll see the ledger open up as it opens up."',
    options: [
      { label: 'Show me the ledger.', next: 'raws_list' },
      { label: 'Understood.', next: 'root' },
    ],
  },
  // Opens the ordinary GUI shop panel — the ledger IS his shelf. OPEN_SHOP is
  // terminal (server/index.js routes it as the node's own UI), so no options.
  raws_list: {
    _vine: { x: 1560, y: 560 },
    text: 'He turns the ledger around and slides it across the desk.',
    actions: [{ action: 'OPEN_SHOP' }],
    options: [],
  },
  // The standing reason to keep coming back to him. Live state, so the line the
  // player actually reads is emitted by the action, not authored here.
  raws_where: {
    _vine: { x: 1180, y: 380 },
    text: 'Amos doesn\'t look up. He just pulls the ledger a little closer and finds the page without searching for it.',
    actions: [{ action: 'FENCE_CACHE_REPORT' }],
    options: [
      { label: 'That\'ll do.', next: 'root' },
      { label: 'I want to order something.', next: 'raws_list' },
      { label: 'Remind me where they are.', next: 'raws_done' },
    ],
  },
};

// Root gains two options once the run is open — the order counter and the tracker.
// The existing "I hear the flats grow more than scrub." → raws stays as it was.
const UNLOCKED = [{ flag: 'air_cargo_unlocked', scope: 'player', op: 'set' }];
const ROOT_OPTIONS = [
  { label: 'I want to put in an order.', next: 'raws_ladder', conditions: UNLOCKED },
  { label: 'What have I got out there?', next: 'raws_where', conditions: UNLOCKED },
];

async function writeRow(table, id) {
  const entry = contentEntries().find(e => e.table === table);
  const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!rows.length) throw new Error(`${table}/${id} vanished mid-write`);
  writeFileSync(`${CONTENT_DIR}/${table}/${fileNameForRow(entry, rows[0])}`,
    canonicalJson(rowToFileObject(entry, rows[0])), 'utf8');
}

async function authorCaches() {
  for (const c of CACHES) {
    const { rows } = await query('SELECT id, flags FROM zones WHERE id = $1', [c.zone]);
    if (!rows.length) throw new Error(`${c.zone} not found — the Reach grid must be imported first`);
    const flags = { ...(rows[0].flags || {}), fence_cache: true };
    delete flags.planner;                        // it's authored content now, not a stub
    await query(
      `UPDATE zones SET name=$2, description=$3, marker=$4, ambient_events=$5::jsonb, flags=$6::jsonb WHERE id=$1`,
      [c.zone, c.name, c.description, c.marker, JSON.stringify(c.ambient), JSON.stringify(flags)]);
    await writeRow('zones', c.zone);

    await query(
      `INSERT INTO furniture (id, zone_id, name, description, object_type, price, flags)
       VALUES ($1,$2,$3,$4,'fixture',0,'{}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET zone_id=EXCLUDED.zone_id, name=EXCLUDED.name, description=EXCLUDED.description`,
      [c.fixture.id, c.zone, c.fixture.name, c.fixture.description]);
    await writeRow('furniture', c.fixture.id);
    console.log(`✓ ${c.name} (${c.zone}) + ${c.fixture.id}`);
  }
}

// ── Amos's shelf = the ladder, rendered by the ordinary shop panel ─────────────
// Making him a TRUST vendor (`flags.trust_flag`) switches getVendorStock from the
// random `vendor_stock` shelf to the whole `vendor_inventory` catalogue filtered per
// player by each entry's `min_trust` — so a sealed rung simply isn't on the shelf.
// That is the ladder with no client work at all.
//
// `trust_per_buy: 0` is load-bearing: standing is earned by FLYING pallets home
// (deliverFenceDrop), never by paying for them. Leave it at the engine default and a
// rich player buys their way up the ladder without ever running the customs risk.
//
// Keep these in step with plugins/flight/contracts.js — TIER_TRUST, PALLET_UNITS and
// ORDER_MARKUP are the authority; this table is their rendering.
const CACHE_TRUST_MIN = 10;
const TIER_TRUST = { 0: 0, 1: 4, 2: 10, 3: 18, 4: 28, 5: 40 };
const PALLET_UNITS = { 0: 60, 1: 40, 2: 30, 3: 20, 4: 12, 5: 8 };
const ORDER_MARKUP = 1.4;

async function authorAmosShelf() {
  const { rows: goods } = await query(
    `SELECT id, value, COALESCE((flags->>'cook_tier')::int, 1) AS tier
       FROM items
      WHERE (jsonb_exists(tags,'raw_drug') OR jsonb_exists(tags,'crop'))
        AND NOT jsonb_exists(tags,'mule_crate')`);
  if (!goods.length) throw new Error('no raw/crop items found — run content:import first');

  const { rows } = await query('SELECT vendor_inventory, flags FROM npcs WHERE id = $1', [AMOS]);
  // His existing back-room stock (guns, a taser, a hack deck) shares the shelf. As a
  // trust vendor every entry needs a min_trust, so they sit at the bottom where they
  // already were — the Reach deals those openly.
  const keep = (rows[0].vendor_inventory || [])
    .filter(e => !goods.some(g => g.id === e.item_id))
    .map(e => ({ ...e, min_trust: e.min_trust ?? 0 }));

  const pallets = goods.map(g => {
    const tier = Math.max(0, Math.min(5, g.tier));
    const units = PALLET_UNITS[tier] ?? 20;
    return {
      item_id: g.id,
      price: Math.max(1, Math.round(g.value * ORDER_MARKUP * units)),  // price is PER PALLET
      min_trust: CACHE_TRUST_MIN + (TIER_TRUST[tier] ?? 40),
    };
  }).sort((a, b) => a.min_trust - b.min_trust || a.price - b.price);

  const flags = {
    ...(rows[0].flags || {}),
    raws_counter: true,
    trust_flag: 'bm_trust',
    trust_per_buy: 0,          // standing is flown for, never bought — see above
    trust_max: 100,
    vendor_shop_name: rows[0].flags?.vendor_shop_name || "Dune's Back Room",
  };
  await query('UPDATE npcs SET vendor_inventory = $2::jsonb, flags = $3::jsonb WHERE id = $1',
    [AMOS, JSON.stringify([...keep, ...pallets]), JSON.stringify(flags)]);
  console.log(`✓ Amos's shelf: ${pallets.length} pallet lines (min_trust ${pallets[0].min_trust}–${pallets[pallets.length - 1].min_trust}) + ${keep.length} kept, trust_per_buy 0.`);
}

async function authorAmos() {
  const { rows } = await query('SELECT dialogue_tree FROM npcs WHERE id = $1', [AMOS]);
  if (!rows.length) throw new Error(`${AMOS} not found`);
  const tree = rows[0].dialogue_tree || {};
  if (!tree.root) throw new Error('Amos has no root node — refusing to guess at the tree shape');

  Object.assign(tree, NODES);
  tree.root.options = tree.root.options || [];
  for (const opt of [...ROOT_OPTIONS].reverse()) {
    if (tree.root.options.some(o => o.next === opt.next)) continue;
    const at = tree.root.options.findIndex(o => o.next === 'raws');
    tree.root.options.splice(at < 0 ? 0 : at + 1, 0, opt);
  }

  await query('UPDATE npcs SET dialogue_tree = $2 WHERE id = $1', [AMOS, JSON.stringify(tree)]);
  await authorAmosShelf();   // sets raws_counter + the trust shelf, then we write the file once
  await writeRow('npcs', AMOS);
  console.log(`✓ Amos: accept gated on dealer_inner_circle + bm_trust > ${TRUST_GATE - 1}; order counter + tracker wired.`);
  console.log(`  root options: ${tree.root.options.map(o => o.next).join(', ')}`);
}

// ── Sully, the other door into the caches ─────────────────────────────────────
// His `bm_air_offer` node ALSO fires UNLOCK_AIR_CARGO, so the caches can be opened
// in Coldwater without ever meeting Amos. Two things were wrong with that once the
// gate moved to bm_trust ≥ 10:
//   • his option gated on `bm_trust > 6`, so a pilot at 7–9 could take the offer,
//     have UNLOCK_AIR_CARGO refuse it, and be navigated to `raws_unvouched` — a node
//     that only exists in AMOS's tree. Broken navigation, not a refusal.
//   • his confirmation promised "he keeps a pallet waiting for you", which stopped
//     being true the moment nothing spawns unbidden.
// His per-raw × per-quantity node fan-out (~28 raws × 3 quantity nodes, generated by
// add-blackmarket-fence.js) existed only to collect "which raw" and "how many". That is
// an item list and a quantity stepper, so it becomes a SHELF: the same catalogue as
// `vendor_inventory` entries on the named `back_room` shelf, his old bm_trust tiers
// carried across as `min_trust`. His bar list is the unnamed front shelf and never
// shows contraband. Delivery is claimed by the `mule_counter` flag (plugins/smuggle).
const SULLY_MARKUP = 2;                                  // must match MARKUP in plugins/smuggle/index.js
const SULLY_TIER_TRUST = { 1: 0, 2: 2, 3: 4, 4: 7, 5: 10 };  // his original TIER_TRUST, unchanged
const BACK_ROOM = 'back_room';

async function authorSullyShelf(tree) {
  const SULLY = 'npc_barkeep';
  const { rows: raws } = await query(
    `SELECT id, value, COALESCE((flags->>'cook_tier')::int, 1) AS tier FROM items
      WHERE jsonb_exists(tags,'raw_drug') AND NOT jsonb_exists(tags,'mule_crate')`);
  const { rows } = await query('SELECT vendor_inventory, flags FROM npcs WHERE id = $1', [SULLY]);
  const front = (rows[0].vendor_inventory || [])
    .filter(e => !e.shelf && !raws.some(r => r.id === e.item_id))
    .map(e => ({ ...e, min_trust: e.min_trust ?? 0 }));   // trust vendor: every entry needs one
  const back = raws.map(r => {
    const tier = Math.max(1, Math.min(5, r.tier));
    return {
      item_id: r.id, shelf: BACK_ROOM,
      price: Math.max(1, Math.round((r.value || 1) * SULLY_MARKUP)),   // per crate, as PLACE_SMUGGLE_ORDER charged
      min_trust: SULLY_TIER_TRUST[tier] ?? 10,
    };
  }).sort((a, b) => a.min_trust - b.min_trust || a.price - b.price);

  const flags = {
    ...(rows[0].flags || {}),
    mule_counter: true,        // claims the purchase-delivery seam (plugins/smuggle)
    trust_flag: 'bm_trust',
    trust_per_buy: 0,          // standing is earned running crates through a gate, never bought
    trust_max: 100,
  };
  await query('UPDATE npcs SET vendor_inventory = $2::jsonb, flags = $3::jsonb WHERE id = $1',
    [SULLY, JSON.stringify([...front, ...back]), JSON.stringify(flags)]);

  // Collapse the fan-out. bm_menu keeps being the hub — it still has to carry the
  // air-cargo offer — but its per-raw options become one door to the shelf.
  const removed = Object.keys(tree).filter(k => /^bm_q_/.test(k));
  for (const k of removed) delete tree[k];
  delete tree.bm_ordered;      // the shop panel's own receipt replaces it
  delete tree.bm_broke;        // …and the vendor's own "you can't afford that"

  tree.bm_shop = {
    _vine: { x: 1040, y: 60 },
    text: 'Sully reaches under the bar and comes up with a battered slate, already scrolling.',
    actions: [{ action: 'OPEN_SHOP', params: { shelf: BACK_ROOM } }],
    options: [],
  };
  tree.bm_menu = {
    ...(tree.bm_menu || {}),
    text: 'Sully sets down the glass he\'s been not-cleaning and leans in. "Back-room list. I don\'t touch the stuff '
      + '— I just know a drone pilot who owes me. You point, it lands out at the Scald, and getting it home past the '
      + 'checkpoint is *your* lookout."',
    options: [
      { label: 'Show me what you\'ve got.', next: 'bm_shop' },
      { label: 'You ever move anything... bigger?', next: 'bm_air_offer',
        conditions: [{ flag: 'bm_trust', scope: 'player', op: 'gt', value: String(TRUST_GATE - 1) }] },
      { label: 'Not tonight.', next: 'root' },
    ],
  };
  console.log(`✓ Sully's shelf: ${back.length} back-room lines (min_trust ${back[0]?.min_trust}–${back[back.length - 1]?.min_trust}) + ${front.length} bar lines kept.`);
  console.log(`  collapsed ${removed.length} bm_q_* node(s) + bm_ordered/bm_broke into one OPEN_SHOP door.`);
}

async function authorSully() {
  const SULLY = 'npc_barkeep';
  const { rows } = await query('SELECT dialogue_tree FROM npcs WHERE id = $1', [SULLY]);
  if (!rows.length) { console.log('· npc_barkeep not found — skipping the Sully half'); return; }
  const tree = rows[0].dialogue_tree || {};
  if (!tree.bm_air_offer) { console.log('· Sully has no bm_air_offer branch — skipping'); return; }
  await authorSullyShelf(tree);

  let regated = 0;
  for (const node of Object.values(tree)) {
    for (const opt of node.options || []) {
      if (opt.next !== 'bm_air_offer') continue;
      opt.conditions = [{ flag: 'bm_trust', scope: 'player', op: 'gt', value: String(TRUST_GATE - 1) }];
      regated++;
    }
  }
  tree.bm_air_confirmed = {
    ...(tree.bm_air_confirmed || {}),
    text: 'Sully writes nothing down, which is how you know it counted. "Amos Dune, front desk of the Layover, '
      + 'out at the Reach. He doesn\'t keep stock sitting in the dirt for anyone — you tell him what you want, he '
      + 'has it run out to one of his holes in the ground, and he tells you which one." '
      + '<span class="text-dim">He picks the glass back up.</span> "Start with the leaf. It\'s legal, it\'s dull, '
      + 'and it\'s how he learns your face."',
    options: (tree.bm_air_confirmed?.options?.length ? tree.bm_air_confirmed.options : [{ label: 'Good to know.', next: 'bm_menu' }]),
  };

  await query('UPDATE npcs SET dialogue_tree = $2 WHERE id = $1', [SULLY, JSON.stringify(tree)]);
  await writeRow('npcs', SULLY);
  console.log(`✓ Sully: air-offer re-gated to bm_trust > ${TRUST_GATE - 1} (${regated} option(s)); confirmation prose corrected.`);
}

async function main() {
  await authorCaches();
  await authorAmos();
  await authorSully();
  console.log('\nRestart or /world/reload to pick up the zone/NPC changes.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
