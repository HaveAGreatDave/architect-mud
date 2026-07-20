/**
 * Flashlight plugin — a battery-powered handheld light the player carries.
 *
 * Verbs (tag-gated on the `flashlight` class tag, resolved from inventory):
 *   light   — switch it on (needs charge)
 *   unlight — switch it off
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
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getAllLivePlayers, getZone, getMinimapData } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';
import { LIGHT_LADDER, floorVisibility } from '../../server/engine/environment.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';

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
  return lookAfterToggle(player, `You switch on the ${f.name}. A hard white cone of light cuts through the gloom.`);
}

async function unlight(args, raw, player) {
  const f = await resolveFlashlight(player, args.join(' ').trim());
  if (!f) return undefined;
  if (!f.custom_data?.lit) return { type: 'error', message: `The ${f.name} is already off.` };
  await query(
    `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || '{"lit":false}'::jsonb WHERE id=$1`,
    [f.inv_id]);
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

export const specializedActions = [
  { verb: 'light', requiredTag: 'flashlight', handler: light },
  { verb: 'unlight', requiredTag: 'flashlight', handler: unlight },
  { verb: 'reload', requiredTag: 'flashlight', handler: reload },
];

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
    const boosted = floorVisibility(vis, LIT_FLOOR);
    return boosted === vis ? undefined : boosted;
  },
};

// Drain lit flashlights a unit per minute for online players; kill the beam and
// warn the holder when the cell runs out.
schedule('1m', async () => {
  for (const player of getAllLivePlayers()) {
    const { rows } = await query(
      `SELECT pi.id, pi.custom_data, i.name, i.flags
         FROM player_inventory pi JOIN items i ON i.id = pi.item_id
        WHERE pi.player_id=$1 AND jsonb_exists(i.tags,'flashlight')
          AND COALESCE((pi.custom_data->>'lit')::boolean, false) = true`,
      [player.id]);
    for (const f of rows) {
      // Accumulate fractional drain so a frugal light (rate < 1) only spends a
      // whole battery unit every few minutes; `battery` itself stays an integer.
      const acc = (Number(f.custom_data?.drainacc) || 0) + flashlightDrainRate(f.flags);
      const spent = Math.floor(acc);
      const drainacc = acc - spent;
      const battery = (f.custom_data?.battery ?? 0) - spent;
      if (battery <= 0) {
        await query(
          `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || '{"lit":false,"battery":0,"drainacc":0}'::jsonb WHERE id=$1`,
          [f.id]);
        sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">Your ${f.name} flickers, browns out, and dies. Darkness closes back in.</span>` });
      } else {
        await query(
          `UPDATE player_inventory SET custom_data = COALESCE(custom_data,'{}'::jsonb) || $1::jsonb WHERE id=$2`,
          [JSON.stringify({ battery, drainacc }), f.id]);
      }
    }
  }
});
