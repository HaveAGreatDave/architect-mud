// Steady Work — the COURIER archetype (the map-spanning half of the shift's
// stay-put job). Where a shift is "work for a while in one place," a courier run
// is "carry a thing across the map before a clock runs out."
//
// Design note (why there's no quest row and no player field): a courier run is a
// single real, keepable inventory item whose custom_data IS the run —
// { courier:true, class, dropoffZone, dropoffName, pickupName, deadlineAt,
//   payout, sealed, cracked }. That makes the run:
//   - persistent for free (it survives moves and reconnects, which a courier MUST
//     do — unlike a shift, which ends the moment you leave the venue);
//   - self-cleaning (deliver / crack / lose the item and the run is over);
//   - honestly interactive with the crime stack — a contraband-tagged parcel is
//     confiscated on a search, scanned at a gov checkpoint, and concealable with
//     `conceal`, all through the EXISTING jail/surveillance systems, zero new
//     wiring. See plugins/jail/index.js isContraband() (extended for 'contraband').
//
// Parcels are OPAQUE until you `crack` the seal — and cracking is the theft
// commit: a broken parcel can never be delivered (the client knows). Stealing is
// therefore a blind gamble on the contents beating the payout, and burning a HOT
// run brings the fence down on you (blacklist, and a bounty if you got greedy).
//
// Hot runs never sit on the board — a fence offers them in dialogue via the
// registered OFFER_COURIER_HOT action (see registerCourierAction below), the same
// "discovered, not menu-selected" shape the black-market branch uses.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getTunable } from '../../server/engine/tunables.js';
import { world, getZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { dispatchAction, registerAction } from '../../server/engine/actions.js';

// ── Parcel classes (content authoring — the three shapes of a run) ─────────────
// itemId: a real items row (content/items/item_parcel_*.json). payMult scales the
// distance-based payout. crackLoot: the small pool a cracked parcel yields (drawn
// from existing item ids — theft relocates goods, it doesn't mint a new faucet).
const CLASSES = {
  clean: {
    label: 'clean', badge: 'clean', itemId: 'item_parcel_clean',
    payMult: 1.0, contraband: false, bounty: false,
    board: 'a sealed parcel', flavour: 'Ordinary goods, above board. No questions, no trouble.',
    crackLoot: ['item_soylent', 'item_soylent'],
  },
  sketchy: {
    label: 'sketchy', badge: 'sketchy', itemId: 'item_parcel_sketchy',
    payMult: 1.7, contraband: true, bounty: false,
    board: "an unmarked parcel", flavour: "Don't ask what's inside. If you get searched it's gone, and so's the pay.",
    crackLoot: ['item_soylent', 'item_amyls'],
  },
  hot: {
    label: 'hot', badge: 'hot', itemId: 'item_parcel_hot',
    payMult: 2.6, contraband: true, bounty: true,
    board: 'a slim padded envelope', flavour: 'Knowingly illegal. Conceal it, move fast, get searched and you go down with it.',
    crackLoot: ['item_amyls', 'item_hack_deck'],
  },
};

// ── Tunables ──────────────────────────────────────────────────────────────────
const T = {
  basePay:   () => getTunable('work_courier_base_pay', 40),         // flat floor per run
  payPerTile:() => getTunable('work_courier_pay_per_tile', 14),     // distance component
  deadlineS: () => getTunable('work_courier_deadline_secs', 600),   // 10 min to cross the map
  boardTtlS: () => getTunable('work_courier_board_ttl_secs', 300),  // board regenerates every 5 min
  bountyMult:() => getTunable('work_fence_bounty_payout_mult', 2.0),// fenced value ≥ this × payout → bounty
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function now() { return Date.now(); }

// ── Candidate endpoints: real, placed, named city tiles (live world Maps, no
//    query — the read tier the hot-path rule wants). Excludes venues and unplaced
//    or unnamed rows so a run always reads as "somewhere → somewhere". ───────────
function candidateZones() {
  const out = [];
  for (const z of world.zones.values()) {
    if (z.grid_x == null || z.grid_y == null) continue;
    if (!z.name || z.flags?.work_venue) continue;
    out.push(z);
  }
  return out;
}

// ── The board (clean + sketchy only; regenerated lazily like flight's topUp) ────
let board = [];
let boardStamp = 0;

function generateBoard() {
  const zones = candidateZones();
  if (zones.length < 2) { board = []; boardStamp = now(); return; }
  const jobs = [];
  for (let i = 0; i < 5; i++) {
    const from = pick(zones);
    let to = pick(zones);
    for (let g = 0; g < 4 && to.id === from.id; g++) to = pick(zones);
    if (to.id === from.id) continue;
    const cls = Math.random() < 0.4 ? 'sketchy' : 'clean';
    const dist = cheb(from.grid_x, from.grid_y, to.grid_x, to.grid_y) || 1;
    const payout = T.basePay() + dist * T.payPerTile();
    jobs.push({
      id: `cr_${randomUUID().slice(0, 8)}`,
      class: cls, pickupName: from.name,
      dropoffZone: to.id, dropoffName: to.name,
      dist, payout: Math.round(payout * CLASSES[cls].payMult),
    });
  }
  board = jobs;
  boardStamp = now();
}

// The public board — lazily (re)generated when stale or empty.
export function courierBoard() {
  if (!board.length || now() - boardStamp > T.boardTtlS() * 1000) generateBoard();
  return board;
}

// ── The active run: the courier parcel carried in the player's own inventory ────
// custom_data IS the run. One run at a time — a second parcel would be ambiguous
// on `deliver`/`crack`, and multi-carry is a courier-fleet feature we don't want.
export async function activeRun(player) {
  const { rows } = await query(
    `SELECT id, item_id, custom_data FROM player_inventory
     WHERE player_id=$1 AND (custom_data->>'courier')='true' LIMIT 1`,
    [player.id]
  );
  if (!rows.length) return null;
  const cd = rows[0].custom_data || {};
  return { invId: rows[0].id, itemId: rows[0].item_id, run: cd };
}

// Spawn a parcel into the player's inventory — the whole run rides in custom_data.
async function spawnParcel(player, spec) {
  const cls = CLASSES[spec.class];
  const run = {
    courier: true, class: spec.class,
    dropoffZone: spec.dropoffZone, dropoffName: spec.dropoffName,
    pickupName: spec.pickupName || 'dispatch',
    payout: spec.payout, deadlineAt: now() + T.deadlineS() * 1000,
    sealed: true, cracked: false,
  };
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,1,1.0,$4)',
    [randomUUID(), player.id, cls.itemId, JSON.stringify(run)]
  );
  return run;
}

function minsLeft(run) { return Math.max(0, Math.round((run.deadlineAt - now()) / 1000)); }
function expired(run) { return now() > run.deadlineAt; }

// ── Take a clean/sketchy job off the board ──────────────────────────────────────
export async function takeJob(player, jobId) {
  if (await activeRun(player)) {
    return { ok: false, message: "You're already carrying a run. Deliver what you've got before you take another." };
  }
  const spec = courierBoard().find(j => j.id === jobId);
  if (!spec) return { ok: false, message: 'That run is gone — the board just turned over.' };
  board = board.filter(j => j.id !== spec.id);
  const cls = CLASSES[spec.class];
  await spawnParcel(player, spec);
  return {
    ok: true,
    message: `<span class="msg-system">You sign for ${cls.board} bound for ${spec.dropoffName}.</span>\n` +
      `<span class="text-dim">${cls.flavour} ${Math.round(T.deadlineS() / 60)} minutes on the clock, ${spec.payout}₵ on delivery. Get moving — type <b>deliver</b> when you're there.</span>`,
  };
}

// ── OFFER_COURIER_HOT — the fence's illicit run, dispatched from dialogue ───────
// A fence "you look like you can handle something delicate" option fires this. It
// spawns a hot run to a random distant tile. No board, no ideology gate — the
// fence's trust is the only gate (see docs/proposals/steady-work.md §3).
async function offerHot(player) {
  if (await activeRun(player)) {
    sendToPlayer(player.id, { type: 'output', message: '<span class="text-dim">"Finish what you\'re carrying first," the fence murmurs. "One at a time."</span>' });
    return { type: 'noop' };
  }
  const zones = candidateZones();
  if (zones.length < 2) return { type: 'noop' };
  const here = getZone(player.current_zone);
  const hx = here?.grid_x ?? 0, hy = here?.grid_y ?? 0;
  // Prefer a genuinely distant drop so a hot run is a real haul.
  let to = pick(zones);
  for (let g = 0; g < 6; g++) { const c = pick(zones); if (cheb(hx, hy, c.grid_x, c.grid_y) > cheb(hx, hy, to.grid_x, to.grid_y)) to = c; }
  const dist = cheb(hx, hy, to.grid_x, to.grid_y) || 1;
  const payout = Math.round((T.basePay() + dist * T.payPerTile()) * CLASSES.hot.payMult);
  await spawnParcel(player, { class: 'hot', pickupName: here?.name || 'here', dropoffZone: to.id, dropoffName: to.name, payout });
  sendToPlayer(player.id, {
    type: 'output',
    message: `<span class="msg-system">The fence slides ${CLASSES.hot.board} across to you.</span>\n` +
      `<span class="text-dim">"${to.name}. Before the clock's out. Keep it out of sight — if it lands on you, that's your problem, not mine. ${payout}₵ when it's done."</span>`,
  });
  return { type: 'noop' };
}

export function registerCourierAction() {
  registerAction({ type: 'OFFER_COURIER_HOT', handler: async ({ actor }) => offerHot(actor) });
}

// ── Deliver ─────────────────────────────────────────────────────────────────────
export async function deliver(player) {
  const held = await activeRun(player);
  if (!held) return { type: 'emote', message: "You're not carrying a run right now. Take one from your Work board (<b>courier</b>)." };
  const run = held.run;
  if (run.cracked) {
    return { type: 'output', message: '<span class="text-red">The seal\'s broken — no one will take a tampered parcel. It\'s just contraband now. Ditch it or <b>crack</b> what\'s left.</span>' };
  }
  if (player.current_zone !== run.dropoffZone) {
    const z = getZone(run.dropoffZone);
    return { type: 'output', message: `<span class="msg-system">This isn't the drop. ${CLASSES[run.class].board.replace(/^a /, 'The ')} goes to ${z?.name || run.dropoffName}.</span>` };
  }
  if (expired(run)) {
    // Deadline blown — the client won't take it. No heat, just a dead run in your
    // bag (keep the item so a hot parcel's contraband consequences still bite).
    return { type: 'output', message: '<span class="text-red">You\'re too late. The contact\'s gone and won\'t answer. The run\'s blown — no pay.</span>' };
  }
  await query('DELETE FROM player_inventory WHERE id=$1', [held.invId]);
  adjustCredits(player, run.payout, undefined, 'work:courier');
  return { type: 'output', message:
    `<span class="item-grant">Handoff clean. The contact takes the parcel, counts ${run.payout}₵ into your palm, and is gone before you've pocketed it.</span>` };
}

// ── Crack the seal — the irreversible theft commit ──────────────────────────────
export async function crack(player) {
  const held = await activeRun(player);
  if (!held) return { type: 'emote', message: "You've got nothing sealed to crack." };
  const run = held.run;
  if (run.cracked) return { type: 'emote', message: "You already cracked this one — it's just contraband now." };
  const cls = CLASSES[run.class];

  // Contents are a blind gamble drawn from existing item ids. Grant one, consume
  // the parcel — the run is burned (a cracked parcel can never be delivered).
  const lootId = pick(cls.crackLoot);
  await query('DELETE FROM player_inventory WHERE id=$1', [held.invId]);
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)',
    [randomUUID(), player.id, lootId]
  );
  const { rows: itemRows } = await query('SELECT name, value FROM items WHERE id=$1', [lootId]);
  const item = itemRows[0] || {};
  const itemName = item.name || 'something';
  const lines = [`<span class="text-yellow">You break the seal. It won't deliver now — that's the whole gamble. Inside: ${itemName}.</span>`];

  // Burning a HOT run brings the fence down: always a blacklist; a bounty too if
  // the take was greedy relative to what they offered you (payout multiple, not
  // absolute credits, so it self-scales with the economy).
  if (cls.bounty) {
    await setFlag('player', 'work_fence_blacklist', 'true', player);
    const fenced = Number(item?.value) || 0;
    if (fenced >= run.payout * T.bountyMult()) {
      const stars = clamp(Math.round(fenced / (run.payout || 1)), 1, 3);
      await dispatchAction({ type: 'WANTED_RAISE', actor: player, params: { amount: stars, reason: 'burned a fence' } });
      lines.push('<span class="text-red">You just robbed the fence blind. Word travels — they\'ve put people on you, and the badge that shows up won\'t be gentle either.</span>');
    } else {
      lines.push('<span class="text-red">The fence won\'t deal with you again. That door\'s shut.</span>');
    }
  }
  return { type: 'output', message: lines.join('\n') };
}

// ── The courier hub verb: list the board + show your active run ─────────────────
export async function cmdCourier(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  const held = await activeRun(player);
  if (held) {
    const run = held.run;
    const z = getZone(run.dropoffZone);
    if (run.cracked) return { type: 'output', message: '<span class="text-red">You\'re carrying a cracked parcel — dead weight. It won\'t deliver.</span>' };
    const late = expired(run);
    return { type: 'output', message:
      `<span class="msg-system">Active run — ${CLASSES[run.class].board} → ${z?.name || run.dropoffName}` +
      (late ? ' <span class="text-red">(OVERDUE — blown)</span>' : ` (${Math.round(minsLeft(run) / 60)}m ${minsLeft(run) % 60}s left)`) +
      `.</span>\n<span class="text-dim">${run.payout}₵ on delivery. Get there and <b>deliver</b>.</span>` };
  }
  const jobs = courierBoard();
  if (!jobs.length) return { type: 'output', message: '<span class="text-dim">Dispatch has nothing on the board right now. Check back shortly.</span>' };
  const lines = ['<span class="msg-system">Runs on the board:</span>'];
  jobs.forEach((j, i) => {
    lines.push(`  <span class="text-dim">${i + 1}. ${CLASSES[j.class].board} → ${j.dropoffName} · ${j.dist} tiles · ${j.payout}₵${j.class === 'sketchy' ? ' · <span class="text-yellow">sketchy</span>' : ''}</span>`);
  });
  lines.push('<span class="text-dim">Type</span> <span class="msg-system">courier &lt;n&gt;</span> <span class="text-dim">to sign for one (or open the Work app on your Tablet).</span>');
  return { type: 'output', message: lines.join('\n') };
}

// `courier <n>` takes board job n. Bare `courier` lists. Kept as one verb so we
// don't collide with flight's `accept`/`jobs` or pollute the global namespace.
export async function courierVerb(args, raw, player) {
  const n = parseInt(args?.[0], 10);
  if (!Number.isFinite(n)) return cmdCourier(args, raw, player);
  const jobs = courierBoard();
  const spec = jobs[n - 1];
  if (!spec) return { type: 'emote', message: 'No run at that number. Type <b>courier</b> to see the board.' };
  return takeJob(player, spec.id);
}

// Pure/handle helpers for the regress suite.
export const _courierTest = { CLASSES, generateBoard, courierBoard, cheb, candidateZones, activeRun, minsLeft, expired };
