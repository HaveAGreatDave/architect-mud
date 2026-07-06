/**
 * First-visit lore plugin.
 *
 * Some zones carry a hand-authored `flags.intro_lore` — an extended, tone-setting
 * paragraph about the place: its history, who runs it now, what to watch for, and
 * the plain fact that it's dog-eat-dog out here. The first time a player visits
 * such a zone, that block is woven into the room description and shimmers in
 * (client `.intro-lore` styling) before settling to normal prose.
 *
 * THE ONLY GATE IS THE SEEN MARKER. Any player who hasn't yet been shown a given
 * zone's lore gets it on their next visit; a `lore_seen:<zone>` player-flag then
 * suppresses it forever after. There is no eligibility / new-account gate.
 *
 * IMPORTANT — why "seen" is committed on *departure*, not at render time: a room
 * re-renders many times during a single visit (the arrival move, plus the silent
 * re-looks the client re-issues after loot/take/drop/combat — see server/index.js
 * GHOST_RELOOK_TYPES and dispatch.js). If we marked the zone seen the first time
 * describeZone ran, the very next re-render would find seen=true and drop the
 * block — so it would flash and vanish. Instead the block shows on *every* render
 * while the player is in the zone, and we stamp `lore_seen` only when they leave
 * (the `zone.entered` event, keyed on the zone they came `from`). So it persists
 * for the whole first visit and never re-appears afterward.
 *
 * Content lives entirely in zone content (`zones.flags.intro_lore`), authored like
 * any other world content — the plugin owns only the when, never the prose.
 */
import { on } from '../../server/engine/events.js';
import { getZone } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';

const seenKey = (zoneId) => `lore_seen:${zoneId}`;
const STAFF = new Set(['admin', 'dev', 'builder', 'designer']);

const loreFor = (zone) => {
  const text = zone && zone.flags && zone.flags.intro_lore;
  return text && String(text).trim() ? String(text).trim() : null;
};

// Fired from describeZone with the zone and the looking player. Return the
// shimmering block on every render of a not-yet-seen lore zone, else nothing.
// Does NOT mark seen (see the header note).
async function introLore(zone, player) {
  if (!player || !zone) return;
  const lore = loreFor(zone);
  if (!lore) return;
  if (await getFlag('player', seenKey(zone.id), player)) return; // already visited once
  return `<span class="intro-lore">${lore}</span>`;
}

// On entering a new zone, the zone the player just LEFT (`from`) has had its one
// first visit — stamp it seen so a later return doesn't re-introduce it. Only
// touch zones that actually carry lore, so player_flags stays small (no row per
// ordinary zone traversed).
function onZoneEntered({ actor, from }) {
  if (!actor || !from) return;
  const left = getZone(from);
  if (!loreFor(left)) return;
  setFlag('player', seenKey(from), 'true', actor).catch(() => {});
}

on('zone.entered', onZoneEntered);

// `lorereset [handle]` (staff only) — clear a player's `lore_seen:*` markers so the
// shimmering intros play again. Self, or another player by handle (online or not).
// The testing/QA lever. Since seen-markers are the only gate, this fully re-arms.
async function cmdLoreReset(argStr, player) {
  if (!STAFF.has(player.role)) {
    return { type: 'error', message: `Unknown command: "lorereset". Type HELP for commands.` };
  }
  const handle = (argStr || '').trim();
  let targetId = player.id;
  let label = 'you';
  if (handle) {
    const { rows } = await query('SELECT id, handle FROM players WHERE lower(handle)=lower($1)', [handle]);
    if (!rows.length) return { type: 'error', message: `No player named "${handle}".` };
    targetId = rows[0].id;
    label = rows[0].handle;
  }
  const { rowCount } = await query(
    "DELETE FROM player_flags WHERE player_id=$1 AND flag_key LIKE 'lore_seen:%'",
    [targetId]
  );
  const tail = label === 'you' ? ' Re-look or re-enter a lore zone to see it again.' : '';
  return {
    type: 'system',
    message: `<span class="msg-system">Lore reset for ${label}: cleared ${rowCount} seen-marker(s); first-visit lore will play again.${tail}</span>`,
  };
}

export const hooks = {
  'zone.introLore': introLore,
};

export const commands = {
  lorereset: (args, _raw, player) => cmdLoreReset(args.join(' '), player),
  resetlore: (args, _raw, player) => cmdLoreReset(args.join(' '), player),
};

export const _test = { introLore, onZoneEntered, cmdLoreReset, loreFor, seenKey };

console.log('[lore] Plugin loaded.');
