// One-shot: build HALCYON ASSURANCE — the arcology owners' own insurer — as a
// mixed-use interior tower hanging off the existing Halcyon Heights roof-plaza
// (zone_nc_halcyon). The north surface is a locked, fully-built rectangle (gov
// quarter to the west, bay to the east), so the "shops + apartments + offices"
// live as FLOORS of the tower rather than new street tiles — fitting for a rooftop
// arcology. The government building the brief wanted is already next door (Prefect
// Plaza does permits/papers). Wires the `insurance_desk` flag the plugin gates on.
//
// Idempotent: map/zones/npcs/furniture/apartments are skip-if-exists; the roof-plaza's
// `in` exit is re-asserted. Run after `npm run db:schema`, then reload/restart:
//   node scripts/build-halcyon-assurance.js   →   POST /api/world/reload (or restart)
import { query } from '../server/models/db.js';

const ANCHOR = 'zone_nc_halcyon';          // the existing roof-plaza
const MAP = 'map_int_halcyon';

async function zone(id, name, description, flags, exits, gx, gy, marker) {
  const exists = await query('SELECT id FROM zones WHERE id=$1', [id]);
  if (exists.rows.length) { console.log(`SKIP zone ${id}`); return; }
  await query(
    `INSERT INTO zones (id, name, description, danger_rating, pvp_enabled, is_safe_zone, exits, flags, map_id, grid_x, grid_y, grid_z, marker, color, bg_color, ambient_theme)
     VALUES ($1,$2,$3,'safe',0,1,$4,$5,$6,$7,$8,0,$9,'#eae6f0','#2c2340','indoors')`,
    [id, name, description, JSON.stringify(exits), JSON.stringify(flags), MAP, gx, gy, marker]);
  console.log(`CREATED zone ${id} (${name})`);
}

async function npc(id, name, description, zoneId, opts = {}) {
  const exists = await query('SELECT id FROM npcs WHERE id=$1', [id]);
  if (exists.rows.length) { console.log(`SKIP npc ${id}`); return; }
  await query(
    `INSERT INTO npcs (id, name, description, zone_id, home_zone, work_zone_id, dialogue_tree, vendor_inventory, vendor_stock, vendor_stock_size, vendor_restock_rate, npc_type, wanders, flags, chitchat, hp, hp_max, sex)
     VALUES ($1,$2,$3,$4,$4,$4,$5,$6,$7,$8,1,$9,0,$10,$11,20,20,$12)`,
    [id, name, description, zoneId,
     JSON.stringify(opts.dialogue || {}), JSON.stringify(opts.vendor || []), JSON.stringify((opts.vendor || []).map(v => ({ item_id: v.item_id }))),
     opts.vendor ? opts.vendor.length : 0, opts.npc_type || (opts.vendor ? 'vendor' : 'civilian'),
     JSON.stringify({ personality: opts.vendor ? 'vendor' : 'professional', clothing_layers: opts.clothing || [] }),
     JSON.stringify(opts.chitchat || []), opts.sex || 'nonbinary']);
  console.log(`CREATED npc ${id} (${name})`);
}

async function furn(id, zoneId, name, description, flags) {
  const exists = await query('SELECT id FROM furniture WHERE id=$1', [id]);
  if (exists.rows.length) { console.log(`SKIP furn ${id}`); return; }
  await query(
    `INSERT INTO furniture (id, zone_id, name, description, object_type, flags) VALUES ($1,$2,$3,$4,'fixture',$5)`,
    [id, zoneId, name, description, JSON.stringify(flags || {})]);
  console.log(`CREATED furn ${id}`);
}

async function apartment(zoneId, rent) {
  const exists = await query('SELECT zone_id FROM apartments WHERE zone_id=$1', [zoneId]);
  if (exists.rows.length) { console.log(`SKIP apartment ${zoneId}`); return; }
  await query('INSERT INTO apartments (zone_id, owner_id, is_locked, lock_difficulty, rent_cost) VALUES ($1,NULL,0,1,$2)', [zoneId, rent]);
  console.log(`CREATED apartment ${zoneId} (rent ${rent})`);
}

// ── The interior map ──────────────────────────────────────────────────────────
const anchor = await query('SELECT id, exits FROM zones WHERE id=$1', [ANCHOR]);
if (!anchor.rows.length) { console.error(`Anchor ${ANCHOR} (Halcyon Heights) missing — run the world seed first.`); process.exit(1); }
await query(`INSERT INTO maps (id, name, parent_zone_id, entry_zone_id) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
  [MAP, 'Halcyon Assurance', ANCHOR, 'zone_halcyon_lobby']);

// ── Floors ────────────────────────────────────────────────────────────────────
await zone('zone_halcyon_lobby', 'Halcyon Assurance — Grand Lobby',
  'A cathedral of pale stone and cold light. The Halcyon Assurance seal — a calm eye over a city skyline — is inlaid ten metres wide in the floor, and a wall of frosted glass reads ASSURANCE FOR THE ASSURED in letters that cost more than you do. The air is filtered, climate-perfect, and billed. Directories point up to residences, down to the executive floor, and across to underwriting and claims.',
  { building_name: 'Halcyon Assurance', building_type: 'corporate_office' },
  { out: ANCHOR, north: 'zone_halcyon_underwriting', east: 'zone_halcyon_claims', west: 'zone_halcyon_concourse', up: 'zone_halcyon_residences', down: 'zone_halcyon_exec' }, 0, 0, 'HA');

await zone('zone_halcyon_underwriting', 'Halcyon Assurance — Underwriting',
  'A long marble counter under recessed light, staffed by people trained to say no beautifully. Screens behind the desk cycle agreed values, premiums, and the small print no one reads until it is far too late. This is where you <b>insure</b> an aircraft.',
  { insurance_desk: true, building_name: 'Halcyon Assurance' },
  { south: 'zone_halcyon_lobby' }, 0, -1, 'UW');

await zone('zone_halcyon_claims', 'Halcyon Assurance — Claims',
  'A quieter, colder room. The chairs are comfortable in the way a dentist\'s are, and a single adjuster works a terminal with the patience of someone who has already decided your excess. This is where you <b>claim</b> against a covered loss.',
  { insurance_desk: true, building_name: 'Halcyon Assurance' },
  { west: 'zone_halcyon_lobby' }, 1, 0, 'CL');

await zone('zone_halcyon_concourse', 'Halcyon Arcade',
  'A retail concourse ringed with frosted-glass storefronts — a jeweller, a tailor, a coffee bar, a newsstand, all catering to people who own the floors above. A kiosk near the fountain sells the essentials to everyone else at a markup that is itself a kind of insurance.',
  { building_name: 'Halcyon Assurance', building_type: 'shop' },
  { east: 'zone_halcyon_lobby' }, -1, 0, 'AR');

await zone('zone_halcyon_residences', 'Halcyon Residences — Sky Hall',
  'A hushed residential floor above the offices: a curved hall of numbered doors, a concierge desk long automated, and windows framing the grey bay far below. The rent up here is quiet, and enormous.',
  { building_name: 'Halcyon Assurance', building_type: 'residential' },
  { down: 'zone_halcyon_lobby', north: 'zone_halcyon_apt_a', east: 'zone_halcyon_apt_b' }, 0, 1, 'RS');

await zone('zone_halcyon_apt_a', 'Halcyon Residence 41-A',
  'A compact sky-apartment: engineered calm, a fold-away bed, and a floor-to-ceiling window that turns the whole cold city into a view you are paying for. Sparsely fitted, waiting for a tenant.',
  { is_apartment: true, is_interior: true, building_type: 'residential' },
  { south: 'zone_halcyon_residences' }, 0, 2, '41');

await zone('zone_halcyon_apt_b', 'Halcyon Residence 41-B',
  'The twin of 41-A across the hall — the same engineered calm, the same billed air, the same long drop past the glass. Empty, and expensive.',
  { is_apartment: true, is_interior: true, building_type: 'residential' },
  { west: 'zone_halcyon_residences' }, 1, 1, '41');

await zone('zone_halcyon_exec', 'Halcyon Assurance — Executive Floor',
  'Below the lobby, behind a door that reads you before you reach it: the executive floor. Deep carpet, a bar no one is invited to, and a corner office with a view arranged so its occupant looks down on the whole arcology — which, one is reminded, they insure, and therefore in a sense own.',
  { building_name: 'Halcyon Assurance', building_type: 'corporate_office' },
  { up: 'zone_halcyon_lobby' }, -1, -1, 'EX');

// ── The people ────────────────────────────────────────────────────────────────
await npc('npc_halcyon_reception', 'Priya Anand',
  'The receptionist at Halcyon Assurance, immaculate and unhurried, with a smile calibrated to the exact wattage your account balance deserves. She has directed the desperate and the diamond-plated with the same serene efficiency.',
  'zone_halcyon_lobby', {
    sex: 'female', clothing: ['a sharp charcoal blazer', 'a silk company scarf', 'a discreet earpiece'],
    dialogue: { root: { text: '"Welcome to Halcyon Assurance. Underwriting is to the north, claims to the east. However fortune finds you, we have a product for it."', options: [{ label: 'Thanks.', next: 'bye' }] }, bye: { text: '"Fly carefully. Or don\'t — either way, we\'ll be here."', options: [] } },
    chitchat: ['Priya realigns a stack of policy folders that were already aligned.', '"The wind up here is clean, cold, and, yes, billed to your account."'],
  });

await npc('npc_halcyon_underwriter', 'Marcus Kell',
  'A senior underwriter with the warm handshake of a man pricing your funeral. He can quote the loss rate on any airframe from memory and enjoys, quietly, the moment a pilot realises what "agreed value" actually means.',
  'zone_halcyon_underwriting', {
    sex: 'male', npc_type: 'civilian', clothing: ['a bespoke slate three-piece', 'a Halcyon lapel eye', 'cufflinks worth a wing'],
    dialogue: { root: { text: '"You fly, therefore you fall — statistically. We simply price the interval. Say <b>insure</b> and I\'ll pull your fleet and quote you." He steeples his fingers. "We keep the wreck, of course."', options: [{ label: 'What does it pay?', next: 'terms' }, { label: 'Maybe later.', next: 'bye' }] }, terms: { text: '"A covered total loss pays a fraction of agreed value, less the excess — enough to get you flying again, never enough to make you careless. That distinction is the whole business."', options: [{ label: 'Understood.', next: 'bye' }] }, bye: { text: '"The desk is always open. Losses rarely keep office hours."', options: [] } },
    chitchat: ['Marcus annotates a loss table with something close to affection.', '"Kamikaze pilots are wonderful for us. They pay premiums and never collect twice."'],
  });

await npc('npc_halcyon_adjuster', 'Delphine Roux',
  'The claims adjuster: sympathetic eyes, an unmovable spreadsheet, and a way of saying "unfortunately" that has ended marriages. She has read every black box in the north and believes none of them.',
  'zone_halcyon_claims', {
    sex: 'female', npc_type: 'civilian', clothing: ['a severe navy suit', 'reading glasses on a chain', 'a Halcyon claims badge'],
    dialogue: { root: { text: '"Sit. Breathe. If Halcyon has logged a loss for you, say <b>claim</b> and I\'ll settle it — the payout, less your excess, which I\'m afraid is yours to carry." A beat. "Condolences on the aircraft."', options: [{ label: 'Why so little?', next: 'why' }, { label: 'Thank you.', next: 'bye' }] }, why: { text: '"Because a policy that made you whole would make you reckless, and reckless clients are how insurers die. We soften the fall. We don\'t abolish gravity."', options: [{ label: 'Fair.', next: 'bye' }] }, bye: { text: '"Do try to bring the next one back in one piece. For both our sakes."', options: [] } },
    chitchat: ['Delphine stamps a form DENIED, then reconsiders, then stamps it DENIED again.', '"Everyone flies like they\'re insured. That\'s rather the problem."'],
  });

await npc('npc_halcyon_vp', 'Auberon Vale',
  'The Vice-President of Everything Regrettable, tanned to a shade found in no weather this city has. He owns three floors, insures the other ninety, and treats every conversation as a negotiation he has already won.',
  'zone_halcyon_exec', {
    sex: 'male', npc_type: 'civilian', clothing: ['an obscenely soft camel coat', 'a watch you could retire on', 'a smile with no warranty'],
    dialogue: { root: { text: '"You\'re on the executive floor, which means either you\'re very rich or very lost. Halcyon protects everything the owners own — which, they\'ll tell you, is everything. Was there something?"', options: [{ label: 'Just looking.', next: 'bye' }] }, bye: { text: '"Mm. Do look on your way out. There\'s a lot to look at, and none of it\'s yours."', options: [] } },
    chitchat: ['Auberon swirls a drink he will not offer you.', '"Risk is other people\'s. Reward is ours. It\'s all in the fine print, which we also wrote."'],
  });

await npc('npc_halcyon_kiosk', 'Sef',
  'A tired kiosk vendor working the arcade concourse, selling water and sundries to the staff and the strays at exactly the price the location commands. Sef has seen the executive floor exactly once, to fix its vending machine.',
  'zone_halcyon_concourse', {
    sex: 'nonbinary', vendor: [{ item_id: 'item_water_bottle', price: 6 }], clothing: ['a branded kiosk polo', 'a fraying lanyard'],
    dialogue: { root: { text: '"Arcade kiosk. Water\'s cold, prices aren\'t. Browse if you like." Sef gestures at the shelf.', options: [{ label: 'Show me.', next: '__shop__' }, { label: 'Later.', next: 'bye' }] }, bye: { text: '"Suit yourself. The coffee bar\'s a robbery, just so you know."', options: [] } },
    chitchat: ['Sef restocks a shelf that empties itself of everything but the overpriced water.'],
  });

// ── Fixtures ──────────────────────────────────────────────────────────────────
await furn('furn_halcyon_safe', 'zone_halcyon_exec', 'the Halcyon executive safe',
  'A matte-black wall safe behind the VP\'s desk, its door a slab of engineered smugness. Whatever Halcyon considers worth insuring against theft, it keeps in here.',
  { vendor_safe: true, vendor_npc_id: 'npc_halcyon_vp', hack_difficulty: 5 });
await furn('furn_halcyon_seal', 'zone_halcyon_lobby', 'the Halcyon seal', 'The calm-eye-over-a-skyline seal inlaid in the lobby floor, worn faintly bright down the middle where a decade of anxious claimants have crossed it.', {});

// ── Apartments (rentable sky-units) ───────────────────────────────────────────
await apartment('zone_halcyon_apt_a', 900);
await apartment('zone_halcyon_apt_b', 900);

// ── Wire the roof-plaza → tower (re-assert; never clobber the plaza's exits) ────
const ex = anchor.rows[0].exits || {};
ex.in = 'zone_halcyon_lobby';
await query('UPDATE zones SET exits=$1 WHERE id=$2', [JSON.stringify(ex), ANCHOR]);
console.log(`Wired ${ANCHOR} in → zone_halcyon_lobby`);

console.log('\nHalcyon Assurance built. Reload the world (POST /api/world/reload) or restart, then `in` from Halcyon Heights.');
process.exit(0);
