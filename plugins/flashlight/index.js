/**
 * Flashlight plugin — a battery-powered handheld light the player carries.
 *
 * Verbs (tag-gated on the `flashlight` class tag, resolved from inventory):
 *   turn on/off flashlight — also `switch`, and `turn flashlight on` (input matcher)
 *   flashlight [on|off]    — bare `flashlight` toggles
 *   reload  — consume a `battery` item to refill the cell
 *
 * Instance state lives in player_inventory.custom_data:
 *   { lit: bool, battery: int, drainacc: number }   — battery drains while lit
 * (see the '1m' drain tick). Normal lights burn one unit per minute; a frugal
 * light drains slower via flags.flashlight_drain (a multiplier < 1), with the
 * fractional remainder carried in drainacc so `battery` stays an integer. A
 * flashlight item is `unique` so each carried unit keeps its own state.
 *
 * A lit flashlight with charge doesn't touch zone lighting — it raises how
 * brightly the *holder* perceives the room, via the `visibility.perceive` hook
 * fired in describe.js. It floors perceived light at `bright` (good visibility),
 * so it only helps when the room is dimmer than that.
 */
import { query } from '../../server/models/db.js';
import { registerInputMatcher } from '../../server/engine/plugins.js';
import { schedule } from '../../server/engine/scheduler.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { world, getZone, getMinimapData } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { LIGHT_LADDER, floorVisibility } from '../../server/engine/environment.js';
import { resolveInventoryItem, resolveInventoryForPlayers, patchInventoryCustomData } from '../../server/engine/inventory.js';

const BATTERY_MAX = 120;     // units of charge = minutes of light on a fresh cell
const LIT_FLOOR = 'bright';  // perceived light level a lit flashlight guarantees

// Charge spent per lit-minute. A stock flashlight burns 1 unit/min (a 120-min
// cell); a better-made light sips slower via flags.flashlight_drain (a positive
// multiplier — 0.5 = half the drain, so a cell lasts twice as long). Anything
// missing/invalid falls back to the normal 1.0.
export function flashlightDrainRate(flags) {
  const r = Number(flags?.flashlight_drain);
  return Number.isFinite(r) && r > 0 ? r : 1;
}

// ── Who might be holding a lit flashlight ────────────────────────────────────
// The drain tick reads only these players, and does nothing at all when the set
// is empty, which is nearly always. Before this it read every online player's
// flashlights every minute to find out nobody had one on, and that read alone
// kept the database awake for as long as anyone was logged in.
//
// The rule is that a lit light must never be missing from the set; a player in
// it with nothing lit only costs one read, after which the tick drops them. So
// every way a lit light can reach a player adds them: `light`, login (a lit
// light kept from the last session), picking one up or being handed one, getting
// one any other way (`item.received`: a trade, a shop purchase, a container, the
// Drake's locker), and the perceive hook finding one (the catch-all for a move
// that still fires no event). Entries leave at `turn off`, when the battery
// dies, and when the tick finds nothing lit.
//
// The value is a sequence number, so a tick whose read started before a player
// lit a light can't drop the entry that `light` just added.
const litHolders = new Map();   // playerId → seq of the last add
let litSeq = 0;
function markLit(playerId) { if (playerId) litHolders.set(playerId, ++litSeq); }

const cdOf = (row) => {
  const cd = row?.custom_data;
  if (typeof cd !== 'string') return cd || {};
  try { return JSON.parse(cd); } catch { return {}; }
};
const isLitRow = (row) => { const l = cdOf(row).lit; return l === true || String(l) === 'true'; };

// Resolve a flashlight in the player's top-level inventory. With a name, match
// it; otherwise take the first, preferring one that's already lit.
async function resolveFlashlight(player, name) {
  return resolveInventoryItem(player, {
    tag: 'flashlight',
    name: name || undefined,
    orderBy: `COALESCE((pi.custom_data->>'lit')::boolean, false) DESC`,
  });
}

// The beam only changes how the *holder* perceives the room, so re-describe it
// for them alone: the echo of what they did rides in `notify`, and `message`
// carries the freshly-lit (or darkened) room description.
async function lookAfterToggle(player, notify) {
  const zone = getZone(player.current_zone);
  return {
    type: 'look',
    message: await describeZone(zone, player),
    notify,
    zone: player.current_zone,
    minimap: getMinimapData(player.current_zone, 8, player),
  };
}

async function light(args, raw, player) {
  const f = await resolveFlashlight(player, args.join(' ').trim());
  if (!f) return undefined; // fall through — no flashlight to light
  if (f.custom_data?.lit) return { type: 'error', message: `The ${f.name} is already on.` };
  const battery = f.custom_data?.battery ?? BATTERY_MAX;
  if (battery <= 0)
    return { type: 'error', message: `The ${f.name}'s battery is dead. Reload it with a fresh battery.` };
  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ lit: true, battery }), f.inv_id]);
  markLit(player.id);
  return lookAfterToggle(player, `You switch on the ${f.name}. A hard white cone of light cuts through the gloom.`);
}

async function unlight(args, raw, player) {
  const f = await resolveFlashlight(player, args.join(' ').trim());
  if (!f) return undefined;
  if (!f.custom_data?.lit) return { type: 'error', message: `The ${f.name} is already off.` };
  // The same statement says whether any OTHER flashlight this player holds is
  // still on, so the drain tick can forget them without a second round trip.
  // The subquery sees the rows as they were before this update, which is why it
  // leaves this row out by id.
  const { rows } = await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || '{"lit":false}'::jsonb WHERE id=$1
     RETURNING EXISTS (
       SELECT 1 FROM player_inventory o JOIN items i ON i.id = o.item_id
        WHERE o.player_id=$2 AND o.id<>$1 AND jsonb_exists(i.tags,'flashlight')
          AND COALESCE((o.custom_data->>'lit')::boolean, false) = true) AS other_lit`,
    [f.inv_id, player.id]);
  if (rows.length && !rows[0].other_lit) litHolders.delete(player.id);
  return lookAfterToggle(player, `You switch off the ${f.name}.`);
}

async function reload(args, raw, player) {
  const name = args.join(' ').replace(/\s+with\s+.*$/i, '').trim();
  const f = await resolveFlashlight(player, name);
  if (!f) return undefined;
  if ((f.custom_data?.battery ?? BATTERY_MAX) >= BATTERY_MAX)
    return { type: 'error', message: `The ${f.name} already has a full charge.` };
  const b = await resolveInventoryItem(player, { tag: 'battery' });
  if (!b) return { type: 'error', message: `You have no batteries.` };
  if (b.quantity > 1) await query(`UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1`, [b.inv_id]);
  else await query(`DELETE FROM player_inventory WHERE id=$1`, [b.inv_id]);
  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
    [JSON.stringify({ battery: BATTERY_MAX }), f.inv_id]);
  return { type: 'use', message: `You snap a fresh battery into the ${f.name}. Full charge.` };
}

// Switch a flashlight to `want` ('on' | 'off' | null = toggle). A name that
// matches nothing falls back to whichever flashlight is carried, so
// "turn on the torch" works on an item called "Flashlight".
async function setBeam(want, name, raw, player) {
  let f = name ? await resolveFlashlight(player, name) : null;
  if (!f) { name = ''; f = await resolveFlashlight(player, ''); }
  if (!f) return { type: 'error', message: `You don't have a flashlight.` };
  const on = want ? want === 'on' : !f.custom_data?.lit;
  return (on ? light : unlight)(name ? [name] : [], raw, player);
}

// `flashlight` toggles; `flashlight on` / `flashlight off` are explicit.
async function flashlightVerb(args, raw, player) {
  const want = args.find(w => /^(on|off)$/i.test(w))?.toLowerCase() ?? null;
  const name = args.filter(w => !/^(on|off)$/i.test(w)).join(' ').trim();
  return setBeam(want, name, raw, player);
}

export const specializedActions = [
  { verb: 'flashlight', requiredTag: 'flashlight', handler: flashlightVerb },
  { verb: 'reload', requiredTag: 'flashlight', handler: reload },
];

// "turn on flashlight", "turn the flashlight off", "switch off my torch". A
// matcher rather than a verb, because `turn`/`switch` belong to furniture and
// the flight plugin; it only claims input that names a flashlight or torch.
const TURN_RE = /^\s*(?:turn|switch)\s+(?:(on|off)\s+(?:the\s+|my\s+)?(.*\b(?:flashlight|torch)\b.*?)|(?:the\s+|my\s+)?(.*\b(?:flashlight|torch)\b.*?)\s+(on|off))\s*$/i;
registerInputMatcher(TURN_RE, (args, raw, player) => {
  const m = raw.match(TURN_RE);
  return setBeam((m[1] || m[4]).toLowerCase(), (m[2] || m[3]).trim(), raw, player);
}, 'flashlight');

// A lit, charged flashlight in the holder's inventory raises their perceived
// light to at least LIT_FLOOR. Only queries when the room is dimmer than that.
export const hooks = {
  'visibility.perceive': async (player, vis) => {
    if (LIGHT_LADDER.indexOf(vis.category) >= LIGHT_LADDER.indexOf(LIT_FLOOR)) return undefined;
    const { rows } = await query(
      `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
        WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'flashlight')
          AND COALESCE((pi.custom_data->>'lit')::boolean, false) = true
          AND COALESCE((pi.custom_data->>'battery')::int, 0) > 0
        LIMIT 1`,
      [player.id]);
    if (!rows.length) return undefined;
    // A lit light that reached this player by a move with no event (a corp store
    // withdrawal, a wardrobe) is found here the first time it matters, and from then on
    // the drain tick counts it down.
    if (!litHolders.has(player.id)) markLit(player.id);
    const boosted = floorVisibility(vis, LIT_FLOOR);
    return boosted === vis ? undefined : boosted;
  },
};

// A lit light kept from the last session. One read per login, and only for the
// player logging in.
on('player.login', ({ id }) => {
  if (!id) return;
  query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'flashlight')
        AND COALESCE((pi.custom_data->>'lit')::boolean, false) = true
      LIMIT 1`,
    [id])
    .then(({ rows }) => { if (rows.length) markLit(id); })
    .catch(() => {});
});

// A lit light picked up (off the ground or a corpse) or handed over. The row in
// the event carries its custom_data, and only this plugin ever writes `lit`, so
// no read is needed to tell.
on('item.taken', ({ actor, item }) => { if (isLitRow(item)) markLit(actor?.id); });
on('item.given', ({ recipient, item }) => { if (isLitRow(item)) markLit(recipient?.id); });
// The moves that aren't a take or a give: a trade, a shop purchase, a pull out of
// a container, the Drake's locker. Same row, same test.
on('item.received', ({ actor, item }) => { if (isLitRow(item)) markLit(actor?.id); });

// For the regress suite: is this player in the drain set?
export const _test = { isLitHolder: (id) => litHolders.has(id), forgetLitHolder: (id) => litHolders.delete(id) };

// Drain lit flashlights a unit per minute for online players; kill the beam and
// warn the holder when the cell runs out.
schedule('1m', async () => {
  if (!litHolders.size) return;
  // Only the online players who might have a light on. Anyone offline drops out
  // here and comes back through the login read.
  const players = [];
  for (const id of [...litHolders.keys()]) {
    const p = world.players.get(id);
    if (p) players.push(p); else litHolders.delete(id);
  }
  if (!players.length) return;
  const startSeq = litSeq;
  const byPlayer = await resolveInventoryForPlayers(players.map(p => p.id), { tag: 'flashlight' });
  // [invId, patch] pairs — one write at the end instead of one per lit light.
  const patches = [];

  for (const player of players) {
    const rows = (byPlayer.get(player.id) || []).filter(isLitRow);
    let stillLit = 0;
    for (const f of rows) {
      // Accumulate fractional drain so a frugal light (rate < 1) only spends a
      // whole battery unit every few minutes; `battery` itself stays an integer.
      const acc = (Number(f.custom_data?.drainacc) || 0) + flashlightDrainRate(f.flags);
      const spent = Math.floor(acc);
      const drainacc = acc - spent;
      const battery = (f.custom_data?.battery ?? 0) - spent;
      if (battery <= 0) {
        patches.push([f.inv_id, { lit: false, battery: 0, drainacc: 0 }]);
        sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">Your ${f.name} flickers, browns out, and dies. Darkness closes back in.</span>` });
      } else {
        patches.push([f.inv_id, { battery, drainacc }]);
        stillLit++;
      }
    }
    // Nothing on any more. Keep the entry if `light` added it after this read began.
    if (!stillLit && (litHolders.get(player.id) ?? 0) <= startSeq) litHolders.delete(player.id);
  }

  if (patches.length) await patchInventoryCustomData(patches);
});
