// ── Favours: the repeatable work that lets an order be lived in ──────────────
//
// `docs/systems-ideologies.md` documents a gap this closes. Ideology rep decays on
// a 30-day half-life and NOTHING repeatable pays it, so standing is something you
// climb once through the forty-slot arc and then watch drain. Incident response is
// the missing work, and `docs/systems-faction-arcs.md` already carves favours out
// as the parallel track: **a job you can do again for standing, not a rung.**
//
// ⚠ THE FOUR RULES, AND THREE OF THEM ARE ABOUT WHAT THIS MUST NOT DO.
//
// 1. **The sim never moves ideology standing implicitly.** `plugins/drugwar` records
//    this decision being made once already, when "the invisible alignment ledger was
//    removed". Rep moves only through an explicit turn-in via `ADJUST_REPUTATION`,
//    which means this file contains NO reputation call at all — it gates an offer,
//    and the quest's own authored reward pays. Regress asserts the plugin has no
//    incidental `adjustReputation` caller.
//
// 2. **A favour is never a slot.** The forty arc slots are non-repeatable, always,
//    because turning one in twice writes an older arc number over a newer one and
//    walks the player backwards. So a favour must never write `<order>_arc`, and
//    regress reads the authored quests to prove none does.
//
// 3. **A favour cannot be turned in for an incident that is over.** This is why the
//    gate is a live-incident lookup rather than a flag set at staging time: an
//    incident's `instanceId` does not survive a restart (rule 6 persists the ledger
//    and never the incidents), so anything remembered about a specific staging is a
//    thing that can outlive it. Asking "is one live HERE, now" cannot.
//
// 4. **No new machinery.** A favour is an ordinary repeatable quest with an
//    authored `ADJUST_REPUTATION` reward. All this file adds is one condition shape
//    so dialogue can ask whether there is anything to respond to — which is the
//    same seam `ideology_rep`, `mastery` and `relation` already use.

import { registerConditionShape } from '../../server/engine/flags.js';
import { blockOf, neighboursOf } from './blocks.js';
import { liveIncidents } from './incidents.js';

// Where a player counts as "at" an incident. `here` is the cell they stand in;
// `nearby` includes its neighbours, because a cell is a 12x12 block and an order
// asking you to deal with something one block over is still asking about here.
const SCOPES = new Set(['here', 'nearby', 'anywhere']);

export function incidentsFor(player, { scope = 'here', writes = null, incident = null } = {}) {
  const all = liveIncidents();
  if (!all.length) return [];
  const cell = player?.current_zone ? blockOf(player.current_zone) : null;
  const within = scope === 'anywhere' || !cell
    ? null
    : new Set(scope === 'nearby' ? [cell, ...neighboursOf(cell)] : [cell]);
  return all.filter((inc) => {
    if (within && !within.has(inc.key)) return false;
    // `writes` is the order that STAGED it. An order offering a favour is asking
    // you to answer somebody else's work, so content names the writer it cares
    // about rather than this file guessing at rivalries.
    if (writes && inc.writes !== writes) return false;
    if (incident && inc.defId !== incident) return false;
    return true;
  });
}

/**
 * `{ unrest_incident: 'here'|'nearby'|'anywhere', writes?: <orgId>, incident?: <defId> }`
 *
 * True while something is live to respond to. Authored on BOTH the offer node and
 * the turn-in node of a favour — on the offer so the job only exists while there is
 * a job, and on the turn-in because rule 3 above is the whole difference between a
 * favour and a farm.
 *
 * Sync and query-free: `liveIncidents()` is a RAM Map and `blockOf` is an index
 * lookup, so this is safe on the dialogue path, which gates every option of every
 * node an NPC renders.
 */
registerConditionShape('unrest_incident', (cond, player) => {
  if (!player) return false;
  const scope = String(cond.unrest_incident || 'here');
  // A typo fails CLOSED, the same direction every other shape fails — an unknown
  // scope must hide the favour, never offer it everywhere.
  if (!SCOPES.has(scope)) return false;
  return incidentsFor(player, { scope, writes: cond.writes || null, incident: cond.incident || null }).length > 0;
});

export const _test = { incidentsFor, SCOPES };
