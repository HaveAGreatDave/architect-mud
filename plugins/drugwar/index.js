/**
 * Drug-war plugin — the self-running street turf tick.
 *
 * Three seed factions each run a district's drug trade through a covert dealer
 * (plugins/dealer, seeded by scripts/seed-drugwar-dealers.mjs):
 *
 *   Franchise → the Core (Franchise Strip)      · dealer Dov Keller
 *   Breakers  → the Marquee (Pigeon / Cherry Pit) · dealer Gita Marsh
 *   Glitch    → the Yards (freight)              · dealer Wick Sorel
 *
 * This tick makes those factions genuinely fight over their corners with no
 * players present: it drifts `zone_control` influence toward each zone's natural
 * holder, occasionally lets a rival "make a play" (sets a challenger), and on a
 * seizure flips the zone and emits `drugwar.flip`. It reuses the SAME
 * `zone_control` table + cache as the corps territory system (DB is source of
 * truth) but is scoped tightly to the drug-war zones and the three factions — it
 * never touches corps and never wakes any full NPC-corp AI.
 *
 * A newbie watching corners change hands is unknowingly learning the exact loop
 * they'll later run at corp scale. Nobody says so.
 *
 * PLAYER SAFETY: the tick only ever acts on a drug-war zone currently held by
 * one of the three NPC factions. A zone claimed by a player corp (or unclaimed)
 * is left entirely alone — the NPC war routes around it. Real seizure of a
 * player's turf stays a player action (`corp contest`).
 *
 * Initial `zone_control` rows are seeded deliberately (scripts/seed-drugwar-turf.mjs),
 * never on boot. If a zone has no row, the tick skips it.
 */
import { schedule } from '../../server/engine/scheduler.js';
import { getZoneControl, setZoneControlCache, world } from '../../server/engine/world.js';
import { emit, on } from '../../server/engine/events.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { drainZonePower, recomputePower } from '../../server/engine/environment.js';
import { query } from '../../server/models/db.js';

const CADENCE = '10m';           // moves on its own, but not spammy

// Bounded drift per tick (mirrors the corps consolidate/erode shape, faster).
const CONSOLIDATE = 4;           // uncontested: grip creeps toward 100
const ERODE = 6;                 // contested: grip bleeds toward a flip
const START_INFLUENCE = 50;      // grip the winner inherits on a flip
const CHALLENGE_CHANCE = 0.15;   // an uncontested NPC zone drawing a rival's eye
const RECLAIM_CHANCE = 0.5;      // the home faction pushing to take its turf back

const FACTIONS = ['faction_franchise', 'faction_breakers', 'faction_glitch'];

// Each drug-war zone's natural holder. The tick pulls turf back toward these,
// so the map oscillates around them rather than drifting to one winner.
const NATURAL = {
  faction_franchise: ['zone_city_west', 'zone_thresholdeast', 'zone_city_north', 'zone_city_east'],
  faction_breakers:  ['zone_mq_pigeon_bar', 'zone_mq_cherry_floor', 'zone_mq_marquee', 'zone_mq_sump_bar'],
  faction_glitch:    ['zone_yard_depot', 'zone_yard_container', 'zone_yard_railhead', 'zone_yard_loadout', 'zone_yard_marshalling'],
};

// zoneId → natural faction, and the flat zone list.
export const ZONE_HOLDER = Object.fromEntries(
  Object.entries(NATURAL).flatMap(([faction, zones]) => zones.map(z => [z, faction]))
);
export const DRUGWAR_ZONES = Object.keys(ZONE_HOLDER);
const DRUGWAR_ZONE_SET = new Set(DRUGWAR_ZONES);

export function isDrugWarZone(zoneId) { return DRUGWAR_ZONE_SET.has(zoneId); }

/**
 * Pure turf-move decision — no DB, no side effects, so the regress suite can
 * drive every branch deterministically (pass a stubbed `rng`). Returns the next
 * intended state for the row, or `null` to leave the zone untouched.
 *
 *   { influence, challenger_org_id, flipTo }   flipTo set only on a seizure.
 */
export function computeTurfMove(row, natural, rng = Math.random) {
  const controller = row?.org_id;
  // Only ever act on a zone an NPC faction currently holds. Unclaimed or
  // player-corp-held drug-war zones are left entirely to player mechanics.
  if (!controller || !FACTIONS.includes(controller)) return null;

  const challenger = row.challenger_org_id;
  if (challenger && FACTIONS.includes(challenger)) {
    const influence = row.influence - ERODE;
    if (influence <= 0) return { influence: START_INFLUENCE, challenger_org_id: null, flipTo: challenger };
    return { influence, challenger_org_id: challenger, flipTo: null };
  }

  // Uncontested NPC hold: consolidate, and maybe draw a fresh challenger.
  const influence = Math.min(100, row.influence + CONSOLIDATE);
  let newChallenger = null;
  if (controller !== natural && rng() < RECLAIM_CHANCE) {
    newChallenger = natural;                        // home faction pushes to reclaim
  } else if (rng() < CHALLENGE_CHANCE) {
    const rivals = FACTIONS.filter(f => f !== controller);
    newChallenger = rivals[Math.floor(rng() * rivals.length)] || null;
  }
  return { influence, challenger_org_id: newChallenger, flipTo: null };
}

async function refreshCache(zoneId) {
  const { rows } = await query('SELECT * FROM zone_control WHERE zone_id=$1', [zoneId]);
  setZoneControlCache(zoneId, rows[0] || null);
}

export async function drugwarTurfTick() {
  for (const zoneId of DRUGWAR_ZONES) {
    const row = getZoneControl(zoneId);
    if (!row) continue;                              // not seeded → skip
    const move = computeTurfMove(row, ZONE_HOLDER[zoneId]);
    if (!move) continue;

    if (move.flipTo) {
      const now = Math.floor(Date.now() / 1000);
      await query(
        'UPDATE zone_control SET org_id=$1, influence=$2, challenger_org_id=NULL, captured_at=$3 WHERE zone_id=$4',
        [move.flipTo, move.influence, now, zoneId]
      );
      await refreshCache(zoneId);
      emit('drugwar.flip', { zoneId, fromOrg: row.org_id, toOrg: move.flipTo });
      continue;
    }

    // Only write when something actually changed this tick.
    if (move.influence !== row.influence || (move.challenger_org_id || null) !== (row.challenger_org_id || null)) {
      await query(
        'UPDATE zone_control SET influence=$1, challenger_org_id=$2 WHERE zone_id=$3',
        [Math.max(0, move.influence), move.challenger_org_id, zoneId]
      );
      await refreshCache(zoneId);
    }
  }
}

// Exported for tests/ops (regress + verify drive it without waiting 10m).
schedule(CADENCE, () => drugwarTurfTick().catch(e => console.error('[drugwar] turf tick error:', e.message)));

// ─── Living-world reactions ──────────────────────────────────────────────────
// Ambient, diegetic, never part of any tutorial. Three families, all off the
// event bus, all cheap and hard-gated so they read as texture, not spam.

const FACTION_LABEL = {
  faction_franchise: 'the Franchise',
  faction_breakers: 'the Breakers',
  faction_glitch: 'the Glitch',
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ambient = (msg) => ({ type: 'output', message: `<span class="msg-ambient">${msg}</span>` });

// (A) "The war is visible" — when the turf tick flips a corner, the paint on the
// wall changes in front of whoever's standing there. (Propagating rumours about
// the flip live in the gossip plugin, which also listens to drugwar.flip.)
on('drugwar.flip', ({ zoneId, fromOrg, toOrg }) => {
  const from = FACTION_LABEL[fromOrg] || 'the old crew';
  const to = FACTION_LABEL[toOrg] || 'someone new';
  sendToZone(zoneId, ambient(
    `Fresh paint over old: ${from}'s mark is slashed through, and ${to}'s tag is sprayed above it, still wet. The corner has changed hands.`));
});

// (B) "Police don't save you" (near spawn) and (C) "The machine is watching"
// (the Core). Both hang off zone entry, each with its own per-player in-memory
// cooldown (resets on restart — it's flavour) and a hard probability gate.
const POLICE_ZONES = new Set(['zone_start', 'zone_threshold']);
const WATCH_ZONES = new Set([...DRUGWAR_ZONES, 'zone_start', 'zone_threshold']);
const FAMILY_COOLDOWN_MS = 12 * 60_000;   // per player, per family
const BLACKOUT_COOLDOWN_MS = 45 * 60_000; // server-wide — a blackout is a rare world event
const policeSeen = new Map();             // playerId -> last ts
const watchSeen = new Map();
let lastBlackout = 0;

function offCooldown(map, id, ms) {
  const now = Date.now();
  if (now - (map.get(id) || 0) < ms) return false;
  map.set(id, now);
  return true;
}

// No cop is coming. Reuses no crime rules — just narrates the absence of law.
const POLICE_BEATS = [
  `A woman scrambles across the tile, wallet gone, shouting for a cop. None comes. A Precinct 9 camera swivels to track her, records it, and does nothing else.`,
  `Someone is getting worked over in the mouth of the alley. A patrol drone drifts past, scans the scene, decides it isn't a priority, and moves on. Neither are you — unless you make yourself one.`,
  `A man in a Precinct 9 jacket takes a folded envelope from a hard-looking stranger, pockets it without counting, and finds something fascinating to study in the other direction. That's the law, around here.`,
  `The emergency call-post on the wall has been ringing out for a long time. Nobody's answering. Someone has scratched WHY BOTHER into the casing.`,
];

// The Architect as infrastructure — never a voice, only the machine noticing.
const WATCH_BEATS = [
  `A camera on the corner rotates, slow and deliberate, and settles on you. The little red light holds, and holds.`,
  `The streetlights stutter — off, on, off — in a pattern too even to be a fault, then go steady, as if they'd never done it.`,
  `The departure board overhead cycles through stops that don't exist: THRESHOLD · REROUTED · YOU · —, then resets like you imagined it.`,
  `For half a second every screen on the block shows the same frame of grey static. Then they go back to whatever they were selling.`,
  `Something in the walls clicks and re-clicks, counting, and the hum of the grid shifts a half-tone — as if the whole block just got re-prioritised around you.`,
];

on('zone.entered', ({ actor, zone }) => {
  if (!actor?.id || !zone) return;

  if (POLICE_ZONES.has(zone) && Math.random() < 0.22 && offCooldown(policeSeen, actor.id, FAMILY_COOLDOWN_MS)) {
    sendToPlayer(actor.id, ambient(pick(POLICE_BEATS)));
    return;                                        // one beat per entry
  }

  if (WATCH_ZONES.has(zone) && Math.random() < 0.14 && offCooldown(watchSeen, actor.id, FAMILY_COOLDOWN_MS)) {
    if (Math.random() < 0.06 && Date.now() - lastBlackout > BLACKOUT_COOLDOWN_MS) {
      lastBlackout = Date.now();
      blackout(zone).catch(e => console.error('[drugwar] blackout:', e.message));
    } else {
      sendToPlayer(actor.id, ambient(pick(WATCH_BEATS)));
    }
  }
});

// A rare, genuine, sourceless blackout — the machine "running something." Drains
// the zone's power (silent), narrates it, and restores the grid a minute later.
async function blackout(zoneId) {
  const res = await drainZonePower(zoneId).catch(() => ({ ok: false }));
  if (!res?.ok) return;                            // zone has no power grid — no-op
  sendToZone(zoneId, ambient(
    `Every light on the block dies at once — not a flicker, a decision. The dark holds a moment too long to be an accident. Somewhere, something is running a calculation, and you are inside it.`));
  setTimeout(() => recomputePower().catch(e => console.error('[drugwar] power restore:', e.message)), 60_000);
}

// ─── Invisible Architect-alignment ledger ────────────────────────────────────
// The machine simply notes how you act. Faction-flavoured choices quietly move
// the hidden per-player `architect_axis` (the factions plugin's ADJUST_ARCHITECT
// action, clamped -100..100) — never surfaced to the player here. Each faction's
// stance toward the Architect sets the sign: the Glitch commune with it, the
// Custodians worship it, the Franchise operate under its license, the Breakers
// want to smash it. Helping a faction pushes you their way; killing their people
// pushes you the other.
const ARCHITECT_STANCE = {
  faction_glitch: 2,
  faction_custodians: 2,
  faction_franchise: 1,
  faction_breakers: -2,
};

// Pure, testable: the axis delta for an action toward a faction (0 = no signal).
export function architectDelta(factionId, affiliative) {
  const stance = ARCHITECT_STANCE[factionId] || 0;
  return affiliative ? stance : -stance;
}

function recordAlignment(player, factionId, affiliative) {
  const delta = architectDelta(factionId, affiliative);
  if (!player?.id || !delta) return;
  dispatchAction({ type: 'ADJUST_ARCHITECT', actor: player, params: { delta } })
    .catch(e => console.error('[drugwar] alignment:', e.message));
}

// Who you buy from (drug dealers carry a faction; ordinary vendors don't).
on('vendor.purchase', ({ player, npcId }) => {
  if (!player?.id || !npcId) return;
  const faction = world.npcs.get(npcId)?.faction;
  if (faction) recordAlignment(player, faction, true);
});

// Whose people you kill.
on('npc.killed', ({ actor, npc }) => {
  if (actor?.id && npc?.faction) recordAlignment(actor, npc.faction, false);
});

console.log('[drugwar] Plugin loaded.');
