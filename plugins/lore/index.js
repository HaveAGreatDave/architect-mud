/**
 * First-visit lore plugin.
 *
 * Some zones carry a hand-authored `flags.intro_lore` — an extended, tone-setting
 * paragraph about the place: its history, who runs it now, what to watch for, and
 * the plain fact that it's dog-eat-dog out here. The first time an *eligible*
 * player visits such a zone, that block is woven into the room description and
 * shimmers in (client `.intro-lore` styling) before settling to normal prose.
 *
 * Two gates keep it from spamming veterans or repeating:
 *   1. Eligibility — only accounts created after this ships get the treatment.
 *      A `lore_intro` player-flag is stamped at character creation; existing
 *      accounts never have it, so they're silently opted out (they've already
 *      "seen the world").
 *   2. Once-per-zone — a `lore_seen:<zone>` player-flag suppresses the block on a
 *      later return.
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
 * any other world content — the plugin owns only the when/who, never the prose.
 */
import { on } from '../../server/engine/events.js';
import { getZone } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { query } from '../../server/models/db.js';

const ELIGIBLE_FLAG = 'lore_intro';
const seenKey = (zoneId) => `lore_seen:${zoneId}`;
const STAFF = new Set(['admin', 'dev', 'builder', 'designer']);

const loreFor = (zone) => {
  const text = zone && zone.flags && zone.flags.intro_lore;
  return text && String(text).trim() ? String(text).trim() : null;
};

// Character creation fires `player.create` with the new player's id. Stamp the
// eligibility flag so this — and only this generation of accounts onward — gets
// introduced to the world. Returns nothing so it composes with other hooks.
async function onPlayerCreate(player) {
  if (player && player.id) await setFlag('player', ELIGIBLE_FLAG, 'true', player);
}

// Fired from describeZone with the zone and the looking player. Return the
// shimmering block on every render of a first-visit lore zone for an eligible
// account, else nothing. Does NOT mark seen (see the header note).
async function introLore(zone, player) {
  if (!player || !zone) return;
  const lore = loreFor(zone);
  if (!lore) return;
  if (!(await getFlag('player', ELIGIBLE_FLAG, player))) return; // pre-launch account
  if (await getFlag('player', seenKey(zone.id), player)) return; // already visited once
  return `<span class="intro-lore">${lore}</span>`;
}

// On entering a new zone, the zone the player just LEFT (`from`) has had its one
// first visit — stamp it seen so a later return doesn't re-introduce it. Only
// touch zones that actually carry lore, and only for eligible accounts, so the
// player_flags table stays small (no row per ordinary zone traversed).
function onZoneEntered({ actor, from }) {
  if (!actor || !from) return;
  const left = getZone(from);
  if (!loreFor(left)) return;
  (async () => {
    if (!(await getFlag('player', ELIGIBLE_FLAG, actor))) return;
    await setFlag('player', seenKey(from), 'true', actor);
  })().catch(() => {});
}

on('zone.entered', onZoneEntered);

// `lorereset [handle]` (staff only) — re-arm first-visit lore for yourself, or for
// another player by handle (online or not). Clears their `lore_seen:*` markers and
// (re)sets eligibility so the shimmering intros play again — the testing/QA lever.
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
  await setFlag('player', ELIGIBLE_FLAG, 'true', { id: targetId });
  const tail = label === 'you' ? ' Re-look or re-enter a lore zone to see it again.' : '';
  return {
    type: 'system',
    message: `<span class="msg-system">Lore reset for ${label}: cleared ${rowCount} seen-marker(s) and re-armed first-visit lore.${tail}</span>`,
  };
}

export const hooks = {
  'player.create': onPlayerCreate,
  'zone.introLore': introLore,
};

export const commands = {
  lorereset: (args, _raw, player) => cmdLoreReset(args.join(' '), player),
  resetlore: (args, _raw, player) => cmdLoreReset(args.join(' '), player),
};

export const _test = { introLore, onPlayerCreate, onZoneEntered, cmdLoreReset, loreFor, ELIGIBLE_FLAG, seenKey };

console.log('[lore] Plugin loaded.');
