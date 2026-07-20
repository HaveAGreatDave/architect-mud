/**
 * gatewarn — the gate guards brief you, once, before you leave the city.
 *
 * Some perimeter tiles carry a hand-authored `flags.gate_warning`: a spoken
 * beat where the gate guards warn you what leaving the city costs and which
 * regions lie past the Architect's Curtain. The first time a player steps onto
 * such a tile, that block is delivered to them; a `gate_warned:<zone>` player-
 * flag then suppresses it forever after.
 *
 * Like the lore plugin, THE PLUGIN OWNS ONLY THE WHEN, NEVER THE PROSE — the
 * whole warning (guard framing, dangers, the region list) is zone content, so
 * it's edited in the dev panel like any other world text and stays in step with
 * whatever regions the void actually forks toward.
 *
 * Unlike first-visit lore, this fires on the real `zone.entered` (one per move,
 * not per re-render), so the seen-flag is stamped up front — no departure defer
 * needed. An in-memory latch guards against a double-fire before the async flag
 * write lands.
 */
import { on } from '../../server/engine/events.js';
import { getZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';

const seenKey = (zoneId) => `gate_warned:${zoneId}`;

const warningFor = (zone) => {
  const text = zone && zone.flags && zone.flags.gate_warning;
  return text && String(text).trim() ? String(text).trim() : null;
};

// player.id → set of gate zone ids already handled this process, so two rapid
// entries can't both slip past before the async getFlag/setFlag resolves.
const latch = new Map();
const latched = (playerId, zoneId) => {
  let s = latch.get(playerId);
  if (s && s.has(zoneId)) return true;
  if (!s) latch.set(playerId, (s = new Set()));
  s.add(zoneId);
  return false;
};

async function onZoneEntered({ actor, zone }) {
  if (!actor || !zone) return;
  const z = getZone(zone);
  const warning = warningFor(z);
  if (!warning) return;                       // cheap: only a briefing tile pays
  if (latched(actor.id, zone)) return;        // already firing this process
  if (await getFlag('player', seenKey(zone), actor)) return; // briefed before, ever
  await setFlag('player', seenKey(zone), 'true', actor).catch(() => {});
  sendToPlayer(actor.id, { type: 'output', message: `<span class="gate-warning">${warning}</span>` });
}

on('zone.entered', onZoneEntered);

export const commands = {};

// Exposed for the regress suite.
export const _test = { onZoneEntered, warningFor, seenKey };

console.log('[gatewarn] Plugin loaded.');
