/**
 * Voices — the first symptom, and the only one that lies to the interface.
 *
 * Every other hallucination in the game announces its channel. A whisper arrives as
 * `.msg-dread` (dim red, italic, glowing); a phantom is a person who turns out not to be
 * there. Both are *legible as unreal* the moment you know the game. That is fine for dread
 * and wrong for madness, because the entire subjective fact about losing your mind is that
 * it does not feel like losing your mind — it feels like the room said something.
 *
 * So these lines are emitted through the EXACT wire format real speech uses:
 *
 *   real NPC   ai-behaviour.js formatChitchat →
 *     { type:'output',  message: '<span class="speech-line">NAME says, "TEXT"</span>' }
 *   real player commands/social.js cmdSay →
 *     { type:'say',     message: 'HANDLE says, "TEXT"' }
 *
 * byte for byte — inline style attribute rather than a class, quotes inside the span, no
 * speaker id, no data attribute, nothing added. `sendToPlayer` is a pure unicast that reuses
 * the same `broadcast()` as a room message and carries no zone, so the payload a victim
 * receives is indistinguishable from one the whole room got. On the client, player speech
 * renders through `appendMsg` (textContent — no markup can leak a tell) and NPC speech
 * through `appendHtml` into the same `msg-help` wrapper a real line lands in.
 *
 * THE ONLY HONEST TELL IS OUT OF BAND, and that is deliberate: the named speaker may not be
 * in the room pane, and `who` will disagree with you. A player who suspects can check. A
 * player who doesn't gets to find out the hard way. That asymmetry is the mechanic.
 *
 * Two rules keep it fair rather than merely confusing:
 *   - MISATTRIBUTION COMES FIRST and uses somebody who is genuinely standing there. The
 *     person is real, the sentence isn't. That is both the most unsettling version and the
 *     most checkable one.
 *   - DISEMBODIED VOICES — a name with nobody attached — arrive much later, because they are
 *     the version you cannot verify in the moment.
 */
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getZoneNpcs, getZonePlayers, world } from '../../server/engine/world.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ── What the voices say ──────────────────────────────────────────────────────
// Ordered by how far gone you have to be to hear them. The early ones are MUNDANE on
// purpose — a line you would not question if a stranger said it, which is what makes the
// later ones land. `{you}` is filled with the listener's own handle, and is held back until
// the bottom tiers: being addressed by name is the moment it stops being ambient.

// Tier 1 — plausible, boring, and aimed at nobody. You will not notice these for a while.
const MUNDANE = [
  "Don't.",
  'You should go.',
  "That's not what I heard.",
  'It was you, though.',
  "I wouldn't stand there.",
  'Again?',
  "You're bleeding.",
  'It already happened.',
  'Ask them what happened to the last one.',
  "Keep your voice down, they're listening.",
];

// Tier 2 — it has noticed you specifically.
const PERSONAL = [
  "You know you're not well, {you}.",
  "How long have you been awake, {you}?",
  "They've been talking about you.",
  "You did that. I watched you do that.",
  "Nobody's coming, {you}.",
  "Say something. Go on. See if anyone answers.",
  "You can't tell which of us is real, can you.",
  "I'm the only one in here actually talking to you.",
  "Count the people in this room. Go on. Count them twice.",
];

// Tier 3 — it has stopped pretending to be a person in a room.
const WRONG = [
  "You're going to do it anyway. We've read ahead.",
  "{you}. {you}. {you}.",
  "This isn't the first time we've had this conversation.",
  "There's somebody standing behind you and it's also me.",
  "You're the only thing in this room that thinks it's real.",
  "We can stop. You only have to ask us to stop. You won't.",
  "Put it down.",
];

function poolFor(tier) {
  if (tier >= 3) return WRONG;
  if (tier >= 2) return PERSONAL;
  return MUNDANE;
}

const fill = (line, player) => line.replace(/\{you\}/g, player.handle || 'you');

// ── The two real formats, reproduced exactly ─────────────────────────────────
// Kept as one-liners next to each other precisely so a future edit to either one is
// obviously a pair. If `formatChitchat` or `cmdSay` ever changes shape, these must follow it
// in the same commit or the illusion breaks and nobody will know why.
const asNpcLine = (name, text) =>
  ({ type: 'output', message: `<span class="speech-line">${name} says, "${text}"</span>` });
const asPlayerLine = (handle, text) =>
  ({ type: 'say', message: `${handle} says, "${text}"` });

// Somebody genuinely in the room with you, preferring a real player over an NPC — a player
// is the more disturbing attribution because they can be asked about it, and being told "I
// never said that" by a person who is actually there is the whole point.
function speakerHere(player) {
  const zoneId = player.current_zone;
  // getZonePlayers returns PLAYER OBJECTS, not ids — filtering by id here and re-looking
  // them up silently produced an empty list, so misattribution only ever used NPCs and the
  // most unsettling case (a real person, who can be asked, denying they said it) never fired.
  const others = (getZonePlayers(zoneId) || []).filter(o => o && o.id !== player.id && o.handle);
  if (others.length && Math.random() < 0.5) {
    return { kind: 'player', name: pick(others).handle };
  }
  const npcs = (getZoneNpcs(zoneId) || []).filter(n => n?.name);
  if (npcs.length) return { kind: 'npc', name: pick(npcs).name };
  if (others.length) return { kind: 'player', name: pick(others).handle };
  return null;
}

// A real name from somewhere else in the world — someone who exists and is provably NOT
// here. Fabricating a name would be the one thing that could never be checked, and a
// hallucination you cannot investigate is just noise.
function speakerElsewhere(player) {
  const here = new Set((getZoneNpcs(player.current_zone) || []).map(n => n.id));
  const pool = [];
  for (const npc of world.npcs.values()) {
    if (npc?.name && !here.has(npc.id)) pool.push(npc.name);
    if (pool.length > 400) break;
  }
  return pool.length ? { kind: 'npc', name: pick(pool) } : null;
}

/**
 * Emit one voice. `tier` picks the pool; `disembodied` allows a speaker who isn't present.
 * Returns the name used, or null if there was nobody to put words into — a silent failure
 * on purpose, since inventing a speaker is exactly what this must never do.
 */
export function speakVoice(player, tier = 1, { disembodied = false } = {}) {
  const who = (disembodied && Math.random() < 0.55 ? speakerElsewhere(player) : null)
    || speakerHere(player)
    || (disembodied ? speakerElsewhere(player) : null);
  if (!who) return null;
  const text = fill(pick(poolFor(tier)), player);
  sendToPlayer(player.id, who.kind === 'player' ? asPlayerLine(who.name, text) : asNpcLine(who.name, text));
  return who.name;
}

export const _test = { MUNDANE, PERSONAL, WRONG, poolFor, asNpcLine, asPlayerLine, fill, speakerHere, speakerElsewhere };
