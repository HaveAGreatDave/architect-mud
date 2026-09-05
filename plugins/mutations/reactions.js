/**
 * What a room full of people does about your face.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * THE CITY IS SOCIALLY HOSTILE LONG BEFORE IT IS PHYSICALLY HOSTILE. There is no
 * "mutant = attack" rule anywhere in this file and there must never be one. What
 * there is instead is a ladder of things ordinary people do when something walks
 * in that they have been taught to be frightened of: they look, then they stop
 * looking, then they move, then they say something, then they gather, and then
 * one of them goes to find somebody official. Every rung is survivable. The
 * accumulation is the punishment.
 *
 * The Custodian turret response (engine/mutations.js) is the far end of this
 * same ladder and stays where it is, because it fires on a ROOM's flags rather
 * than on a crowd's mood.
 *
 * ── The exemption that makes the setting work ────────────────────────────────
 *
 * NONE OF THIS FIRES IN THE SCARLETWASTES. In the Thornwarren a changed body is
 * the normal kind, and a town that recoiled from its own people would break the
 * one thing the region is for. This is a hard region check, not a tuning value:
 * see docs/proposals/scarletwastes.md, whose whole design rests on the inside
 * being domestic.
 *
 * ── Why it is cheap ──────────────────────────────────────────────────────────
 *
 * Fires on `zone.entered`, reads the visibility the substrate already derived,
 * and holds a per-player-per-zone cooldown in memory. No tick, no query, and an
 * unmutated player costs one `visibilityOf` call that returns on an empty Map.
 */
import { on, emit } from '../../server/engine/events.js';
import { visibilityOf } from '../../server/engine/mutations.js';
import { getZone, getZoneNpcs, regionForZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

// Where a changed body is unremarkable. Region ids, because this is about a
// culture rather than about a room.
const TOLERANT_REGIONS = new Set(['region_scarletwastes']);

// Long enough that walking a street is not a wall of text, short enough that the
// city keeps feeling like it has noticed you.
const COOLDOWN_MS = 90_000;
const seen = new Map();   // `${playerId}:${zoneId}` -> ms

// ── The ladder ───────────────────────────────────────────────────────────────
//
// Indexed by how loud the body is and how many people are present to have an
// opinion. Rungs 1-6; the refusal of service is the vendor's own (mutationRefusal)
// and the authorities are the Custodian response, so this file owns the middle.

const STARE = [
  (n) => `${n} looks at you a moment too long, then finds something else to look at.`,
  (n) => `${n}'s eyes go to you and stay there.`,
  (n) => `You catch ${n} looking. They don't stop when you catch them.`,
];

const UNCOMFORTABLE = [
  (n) => `${n} shifts their weight and doesn't look at you, which takes effort.`,
  (n) => `${n} has stopped whatever they were saying.`,
  (n) => `${n} folds their arms and looks hard at the middle distance.`,
];

const BACK_AWAY = [
  (n) => `${n} takes a step back and makes it look like they meant to.`,
  (n) => `${n} moves so that there's furniture between you.`,
  (n) => `${n} crosses to the far side of the room without hurrying, which is worse than hurrying.`,
];

const COMMENT = [
  (n) => `${n} says, to nobody: "That shouldn't be walking around."`,
  (n) => `"Christ," says ${n}, not quietly enough.`,
  (n) => `${n} mutters something to the person next to them, and the person next to them looks.`,
  (n) => `"You can't bring that in here," ${n} says, to somebody who doesn't work here either.`,
];

const GATHER = [
  `Conversation stops. Everyone in the room has arrived at the same opinion at the same time, and none of them are moving yet.`,
  `Two of them have drifted together near the door, and they're talking about you without looking at you.`,
  `The room has quietly rearranged itself so that you're on one side of it and everybody else is on the other.`,
];

const REPORT = [
  (n) => `${n} steps outside with a handset already at their ear.`,
  (n) => `${n} leaves. Not quickly, and not away from you so much as toward a telephone.`,
  (n) => `Somebody has gone for somebody. You didn't see who, and that's worse.`,
];

const pick = (pool) => pool[Math.floor(Math.random() * pool.length)];

/**
 * Which rungs a given visibility gets to use, and how many lines fire.
 *
 * `concealable` is absent deliberately. If it is hidden under a coat there is
 * nothing to react to, and if it is not, `visibilityOf` has already called it
 * obvious. A room reacting to something nobody can see would teach the player
 * that concealment does not work.
 */
const LADDER = {
  obvious: { pools: [STARE, UNCOMFORTABLE, BACK_AWAY], lines: 1, gather: false, report: 0 },
  extreme: { pools: [BACK_AWAY, COMMENT, STARE], lines: 2, gather: true, report: 0.25 },
};

/**
 * Returns `{ lines, reported }`.
 *
 * `reported` is a STRUCTURED FACT, not something a caller re-derives by reading
 * the prose. The first version of this decided whether to call the police by
 * regex-matching the generated lines for the word "telephone", which meant every
 * one of these strings was load-bearing law: editing a line to read better would
 * silently stop the police being called, and adding a line that mentioned a
 * handset would silently start it. Prose is prose. The rung is the fact.
 */
export function reactionLines(visibility, npcs) {
  const rung = LADDER[visibility];
  if (!rung || !npcs.length) return { lines: [], reported: false };

  const lines = [];
  const pool = [...npcs];
  for (let i = 0; i < Math.min(rung.lines, pool.length); i++) {
    const npc = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    lines.push(pick(rung.pools[i % rung.pools.length])(npc.name));
  }

  // A crowd is a different thing from several individuals, and it needs three of
  // them to be one. Below that the room is just people, and people are covered
  // by the lines above.
  if (rung.gather && npcs.length >= 3) lines.push(pick(GATHER));

  // Somebody goes to find an official. This is the rung that connects the social
  // ladder to the legal one, and it is deliberately a chance rather than a
  // certainty: being reported has to feel like bad luck compounding, not a timer.
  const reported = !!rung.report && npcs.length >= 2 && Math.random() < rung.report;
  if (reported) lines.push(pick(REPORT)(npcs[Math.floor(Math.random() * npcs.length)].name));

  return { lines, reported };
}

on('zone.entered', ({ actor: player, zone: zoneId }) => {
  if (!player?.id || !zoneId) return;

  const visibility = visibilityOf(player);
  if (visibility !== 'obvious' && visibility !== 'extreme') return;

  const zone = getZone(zoneId);
  if (!zone) return;
  if (TOLERANT_REGIONS.has(regionForZone(zone)?.id || zone.flags?.region_id)) return;

  const key = `${player.id}:${zoneId}`;
  const now = Date.now();
  if (now - (seen.get(key) || 0) < COOLDOWN_MS) return;

  // Anyone conscious enough to have an opinion. An NPC asleep or out cold
  // notices nothing, the same rule the stealth notice sweep uses.
  const npcs = (getZoneNpcs(zoneId) || []).filter(n => n && !n._asleep && !n._out && n.hp > 0);
  if (!npcs.length) return;

  const { lines, reported } = reactionLines(visibility, npcs);
  if (!lines.length) return;

  seen.set(key, now);
  // Bounded: this is a memory Map keyed by player AND zone, so a well-travelled
  // player would otherwise accumulate one entry per room they have ever entered.
  if (seen.size > 4000) for (const [k, t] of seen) if (now - t > COOLDOWN_MS * 4) seen.delete(k);

  sendToPlayer(player.id, {
    type: 'zone_event',
    message: `\n${lines.map(l => `<span class="outcast-warning">${l}</span>`).join('\n')}`,
  });

  // The seam the wanted system hangs off. Emitted rather than acted on, because
  // who gets called and what they do about it is police business and not this
  // file's: plugins/surveillance charges `mutant_sighting` off this, applying its
  // own lawless-zone rule, its own debounce and its own dispatch, and nothing
  // here knows what a star is.
  if (reported) emit('mutation.reported', { player, zoneId, visibility });
});

export function _resetReactionCooldowns() { seen.clear(); }
