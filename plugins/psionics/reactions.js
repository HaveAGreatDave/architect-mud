/**
 * THE ARMOUR TABOO — what the Exodus do about the coat you walked in wearing.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * THIS IS PURELY SOCIAL. ARMOUR IS NEVER BLOCKED AND NEVER PENALISED.
 *
 * No stat hit, no refusal to equip, no psionic malus, no gate on any door. The
 * game does not enforce the creed; PEOPLE do. This is the same shape as
 * plugins/mutations/reactions.js, which is hostile socially and never violently,
 * and it is the reason that system is liked rather than resented.
 *
 * What it costs you is STANDING, which is a real cost and a real choice: warmth
 * with the people in the room, and drift on your Exodus reputation while you keep
 * doing it. Wear the coat into the Thornwarren and nobody cares. Wear it into an
 * Exodus space and you are a tourist who does not believe.
 *
 * ── Two reasons, and only one is ever said aloud ─────────────────────────────
 *
 * STATED, freely and often: it is a matter of respect. For the methods, for the
 * discipline, for the people who came before you. And it is a rejection of the
 * outside world, which is exactly their canon `stance: renounce` and their
 * authored values (Renewal, Self-Reliance, Simplicity) spoken by people who mean
 * it. This is what an NPC will tell you if you ask, and it makes the taboo legible
 * to a new player in one line.
 *
 * UNSTATED, ever: Aegis exists. A psion in a flak jacket is publicly conceding
 * that the discipline does not work, which is why the mockery has a sting the
 * stated reason alone would not explain, and why an Aegis major is the most
 * respected thing in the camp.
 *
 * ⚠ NO LINE IN THIS FILE MAY MAKE THAT SECOND ARGUMENT, and no quest may ever
 * reward a player for working it out. It is the Terminus rule and the same trick
 * as the Thornwarren's maintained trophy road: a player who notices has found
 * something real, and a player who never does has still had a coherent faction
 * explained to them.
 *
 * ── Why it is cheap ──────────────────────────────────────────────────────────
 *
 * Fires on `zone.entered`, reads equipment the live player already caches, and
 * holds a per-player-per-zone cooldown in memory. No tick, no query, and someone
 * in ordinary clothes costs one Map lookup.
 */
import { on } from '../../server/engine/events.js';
import { getZone, getZoneNpcs, regionForZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { adjustRelation } from '../../server/engine/relations.js';
import { isAwakened, psiRank } from '../../server/engine/psionics.js';
import { rankAtLeast } from '../../server/engine/psionics-abilities.js';

const COOLDOWN_MS = 120_000;
const seen = new Map();   // `${playerId}:${zoneId}` -> ms

/**
 * Where the taboo applies.
 *
 * A zone opts in with `flags.exodus_space`, rather than this file holding a list
 * of room ids. Content decides where the Exodus are, and the Stillhouse, the
 * Waking Hall and anywhere else they later build all inherit this for free.
 */
function isExodusSpace(zone) {
  return !!zone?.flags?.exodus_space;
}

/**
 * Are you wearing armour?
 *
 * Reads `player.soak`, which `recomputeEquipped` already maintains — so this is
 * sync, query-free, and asks the ONE question that matters: is there hard shell
 * between you and the world. Note it deliberately does not care WHICH garment or
 * how good it is. A flak vest and a riot plate are the same statement.
 *
 * ⚠ A psionic ward also lands in `player.soak` (see aegis.js). It must not read
 * as armour, or an Aegis major doing the exact thing the camp respects would be
 * scolded for it. Warded soak is excluded by checking the worn rows instead of
 * the totals wherever they disagree.
 */
function wearsArmour(player) {
  const worn = player?._wornRows;
  if (!worn || !worn.size) return false;
  for (const row of worn.values()) {
    const soak = row?.soak ?? row?.armor ?? null;
    if (!soak) continue;
    if (typeof soak === 'number' ? soak > 0 : Object.values(soak).some(v => Number(v) > 0)) return true;
  }
  return false;
}

/**
 * The ladder. Nobody escalates past contempt, because there is nowhere to go —
 * the Exodus do not throw people out over a coat, they simply think less of you,
 * and keep thinking less of you.
 */
const LINES = [
  "Somebody glances at your coat, then away, and doesn't look back.",
  'Two of them stop talking as you pass. One of them says something. The other laughs.',
  'A woman in a plain grey gi looks you up and down. "Expecting trouble?" She doesn\'t wait for an answer.',
  "Nobody offers you a seat. It isn't an accident and nobody pretends it is.",
  'An old man taps his own chest, then yours, where the plate is. "That isn\'t for here." He walks off before you can reply.',
];

/**
 * The one place the stated reason is spoken in full.
 *
 * Fires on the FIRST offence only. After that it is glances and silences, because
 * a faction that explains its own etiquette every time you walk in is a faction
 * that does not really believe it.
 */
const EXPLAINED =
  'Someone falls into step beside you, friendly enough. "You can wear it. Nobody will stop you." ' +
  'A pause. "It\'s a question of respect. For the work, and for the people who did it before you were here. ' +
  'And we left all that out there on purpose." A shrug. "Your call."';

const TAUGHT_FLAG = 'psi_taboo_explained';

export function wireExodusReactions() {
  // `{ actor, zone, from, opts }` — movement.js:529 and graph.js:453. Note the
  // field is `zone` (an id) and the mover is `actor`, not `player`.
  on('zone.entered', ({ actor, zone }) => {
    try { react(actor, zone); }
    catch { /* a missed sneer is never worth taking a movement path down */ }
  });
}

function react(player, zoneId) {
  if (!player || !zoneId) return;
  // The taboo binds people who have COMMITTED. An outsider being shown around is
  // not held to a creed they have not taken, and scolding a guest would make the
  // faction petty rather than principled.
  if (!isAwakened(player)) return;
  if (!wearsArmour(player)) return;

  const zone = getZone(zoneId);
  if (!isExodusSpace(zone)) return;

  const key = `${player.id}:${zoneId}`;
  const last = seen.get(key) || 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  seen.set(key, Date.now());

  if (!player._flags?.get(TAUGHT_FLAG)) {
    player._flags?.set(TAUGHT_FLAG, '1');
    sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">${EXPLAINED}</span>` });
    return;
  }

  const line = LINES[Math.floor(Math.random() * LINES.length)];
  sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">${line}</span>` });

  // Warmth, not reputation. This is people liking you less, which is what the
  // relationship substrate is FOR, and it recovers on its own the way every
  // other relation does — a bad week in the camp is not a life sentence.
  //
  // Deliberately small. The punishment is the accumulation, exactly as it is in
  // the mutation ladder, and a single visit in the wrong coat should sting rather
  // than cost you the faction.
  for (const npc of (getZoneNpcs(zoneId) || [])) {
    if (npc?.faction !== 'ideology_exodus') continue;
    // adjustRelation takes an npc ID, not the row.
    try { adjustRelation(player, npc.id, { warmth: -1, reason: 'armour in an Exodus space' }); }
    catch { /* optional */ }
  }
}

/** Regress seam. */
export const _test = { wearsArmour, isExodusSpace, LINES, EXPLAINED, TAUGHT_FLAG, seen };
