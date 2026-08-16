/**
 * Power — the leash on chrome, and the thing that makes the campus a place you
 * come back to.
 *
 * `augments.power_draw` has been authored on every augment since the table was
 * built and read by nothing at all. This is its reader.
 *
 * THE SHAPE. Every installed piece draws continuously, scaled by how far past
 * spec you are running it — overclocking is not just heat any more, it is fuel.
 * Charge lives on the cell in your chest, drains lazily against a timestamp, and
 * is topped up anywhere with mains power. Flat means your chrome is INERT, not
 * damaged: it stops contributing and waits, exactly the way a dead-condition
 * augment does. Nothing here can wreck hardware.
 *
 * ⚠ CHARGE IS PERSISTED. HEAT IS NOT. THAT ASYMMETRY IS DELIBERATE AND THE
 * REASON IS THE DIRECTION EACH ONE ERRS IN. Heat cools off on logout and that is
 * generous but harmless — you were going to walk it off in two minutes anyway.
 * If charge were memory-only, logging out and back in would be a free full
 * recharge, and the entire logistics problem this creates would be solved by
 * alt-F4. So it goes in player_augments.custom_data (checkpoint tier: written
 * when the RATE changes or on a top-up, never on a tick, never per minute) and
 * is decayed on READ from its own timestamp, the same way heatOf does it.
 * Whatever you do here, do not read the heat rule at the top of overclock.js and
 * apply it to this.
 */
import { world } from '../../server/engine/world.js';
import { getZonePowerStatus } from '../../server/engine/environment.js';
import { rosterOf, catalogSync, markDirty } from './state.js';

export const CELL_AUGMENT = 'aug_power_cell';

// Charge is a percentage of whatever cell you are carrying, so the numbers below
// are all in "percent of your own capacity".
export const CHARGE_MAX = 100;

// Nobody is bricked on deploy day. A body with no cell runs off a small reserve.
export const BASELINE_RESERVE = 25;

/**
 * What the body itself supplies, free and forever, in power_draw units.
 *
 * ⚠ THIS EXISTS SO THE FEATURE CAN SHIP WITHOUT BRICKING ANYBODY, AND THE
 * ARITHMETIC IS THE POINT. Every live character already has chrome and none of
 * them has a cell, because the cell did not exist until today. A flat 25-point
 * reserve against a typical three-piece rig is about an hour of play and then
 * permanent brownout for people who did nothing wrong — a migration that
 * silently switches off something a player already paid for.
 *
 * So the trickle covers a light rig INDEFINITELY (one or two modest pieces at
 * spec never drain at all) and only the excess above it draws down. The cell
 * then buys what it should buy: a big rig, and overclocking, and the wastes.
 * Tune this and the deploy-day question is the one to re-ask.
 */
export const METABOLIC_TRICKLE = 2.0;

/**
 * Percent-per-hour burned per unit of authored power_draw.
 *
 * Tuned so a typical three-piece rig at spec runs most of a long session on a
 * full cell, and the same rig held at overclock 1 runs about half of one. If you
 * change this, that is the feel to check it against — not the arithmetic.
 */
export const DRAIN_SCALE = 4;

/** What actually comes out of the cell: total draw less what the body supplies. */
export function netDrawOf(player) {
  return Math.max(0, drawOf(player) - METABOLIC_TRICKLE);
}

/** Total draw, in power_draw units, of everything currently installed. */
export function drawOf(player) {
  const cache = catalogSync();
  let total = 0;
  for (const rec of rosterOf(player).values()) {
    const aug = cache[rec.augment_id];
    if (!aug) continue;
    const d = Number(aug.power_draw) || 0;
    if (d <= 0) continue;
    // Doubling at overclock 1, tripling at 2 — pushing past spec costs fuel in
    // the same proportion it costs heat.
    total += d * (1 + (Number(rec.overclock_level) || 0));
  }
  return total;
}

/** The cell record, or null for a body running on the reserve. */
export function cellOf(player) {
  return rosterOf(player).get(CELL_AUGMENT) || null;
}

export function capacityOf(player) {
  const cell = cellOf(player);
  if (!cell) return BASELINE_RESERVE;
  // A wrecked cell holds less, in the same currency as everything else here.
  const cond = Math.max(0, Math.min(1, Number(cell.condition ?? 1)));
  return Math.round(CHARGE_MAX * cond);
}

/**
 * Current charge, decayed from the stamp on read. Sync by contract — this is
 * called from the same funnel getAugments is, which stats and soak run through.
 */
export function chargeOf(player) {
  const cap = capacityOf(player);
  const cell = cellOf(player);
  const store = cell ? (cell.custom_data ||= {}) : (player._reserveCharge ||= {});
  const at = Number(store.charge_at) || 0;
  const held = store.charge == null ? cap : Number(store.charge);
  if (!at) return Math.max(0, Math.min(cap, held));
  const hours = Math.max(0, (Date.now() - at) / 3_600_000);
  const burn = netDrawOf(player) * DRAIN_SCALE * hours;
  return Math.max(0, Math.min(cap, held - burn));
}

/**
 * Write the current charge down and restamp. Call whenever the DRAIN RATE
 * changes (install, remove, overclock) — otherwise the elapsed hours since the
 * last stamp get charged at the new rate, which either robs or gifts the player
 * depending on which way they just moved.
 */
export function restamp(player) {
  const now = chargeOf(player);
  const cell = cellOf(player);
  const store = cell ? (cell.custom_data ||= {}) : (player._reserveCharge ||= {});
  store.charge = Math.round(now);
  store.charge_at = Date.now();
  if (cell) markDirty(player, CELL_AUGMENT);
  return store.charge;
}

/** Top up to full. Used by `augment charge` and by a fresh print. */
export function setFull(player) {
  const cap = capacityOf(player);
  const cell = cellOf(player);
  const store = cell ? (cell.custom_data ||= {}) : (player._reserveCharge ||= {});
  store.charge = cap;
  store.charge_at = Date.now();
  if (cell) markDirty(player, CELL_AUGMENT);
  return cap;
}

/**
 * The predicate. True when there is nothing left to run on.
 *
 * Registered into the same single funnel as chromeDown and nullAugmentDown, so
 * stats, soak, strain and everything downstream inherit a flat cell without a
 * second implementation — that funnel is the reason this file has no idea what
 * a stat is.
 */
export function powerDown(player) {
  if (!player) return false;
  if (netDrawOf(player) <= 0) return false;   // the body carries this rig on its own
  return chargeOf(player) <= 0;
}

/** Where a top-up is possible: anywhere on mains, and the campus does it for you. */
export function zoneCanCharge(zoneId) {
  const z = world.zones.get(zoneId);
  if (!z) return false;
  if (z.flags?.ascendant_campus) return true;
  const status = getZonePowerStatus(zoneId);
  return status && status !== 'unpowered' && status !== 'offline';
}

/** `augment charge` */
export async function cmdCharge(args, raw, player) {
  const cap = capacityOf(player);
  if (drawOf(player) <= 0 && !cellOf(player)) {
    return { type: 'error', message: 'Nothing in you is drawing power. There is nothing to charge.' };
  }
  const now = Math.round(chargeOf(player));
  if (now >= cap) {
    return { type: 'output', message: `You are at ${now}% and holding. Nothing to take on.` };
  }
  if (!zoneCanCharge(player.current_zone)) {
    return { type: 'error', message: 'Nothing here is carrying current. You need mains power — or a generator somebody has bothered to fuel.' };
  }
  setFull(player);
  const campus = world.zones.get(player.current_zone)?.flags?.ascendant_campus;
  return { type: 'output', message: campus
    ? `You find the inductive plate without looking for it — the campus is full of them, unlabelled, the way a good house hides its sockets. ${now}% → <b>${cap}%</b>.`
    : `You find a live socket and stand there for a while like a man waiting for a kettle. ${now}% → <b>${cap}%</b>.` };
}

/** Passive top-up walking into an Ascendant campus zone. */
export function onEnterZone(player, zoneId) {
  if (!player || !world.zones.get(zoneId)?.flags?.ascendant_campus) return;
  if (chargeOf(player) >= capacityOf(player)) return;
  setFull(player);
}

/** The status line, for the augments screen. */
export function powerLine(player) {
  const draw = drawOf(player);
  if (draw <= 0 && !cellOf(player)) return '';
  const net = netDrawOf(player);
  const cap = capacityOf(player);
  const now = Math.round(chargeOf(player));
  const pct = cap > 0 ? Math.round((now / cap) * 100) : 0;
  const cls = pct <= 0 ? 'text-red' : pct < 20 ? 'outcast-warning' : '';
  const left = net > 0
    ? (() => {
        const hours = now / (net * DRAIN_SCALE);
        return `about ${hours < 1 ? `${Math.round(hours * 60)} minutes` : `${hours.toFixed(1)} hours`} at this draw`;
      })()
    : 'your own body carries this much';
  return `\n<span class="skills-header">POWER</span>\n`
    + `  <span class="${cls}">${now}/${cap}</span>`
    + `  ·  draw ${draw.toFixed(1)}${net < draw ? ` <span style="opacity:.7">(${net.toFixed(1)} off the cell)</span>` : ''}  ·  ${left}`
    + `${cellOf(player) ? '' : '  <span style="opacity:.7">(no cell — running on the reserve)</span>'}\n`
    + (pct <= 0 && net > 0 ? `  <span class="text-red">Flat. Your chrome is inert until you find current.</span>\n` : '');
}
