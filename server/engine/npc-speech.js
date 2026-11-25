// One funnel for everything an NPC says (docs/proposals/npc-speech.md).
//
//   npcSay(npc, line, { kind, to, verb })  ->  the message to send
//
// It reads a line's mood tag and strips it, decides the mood the line is said in, sets it on
// the NPC so the face goes with the voice, and formats the line in one shape:
//
//   <span class="speech-line" data-kind="banter" data-mood="sad:0.5" data-effort="0">Name says, "..."</span>
//
// The caller still sends the message (broadcast, sendToZone, sendToPlayer); who hears it is theirs.
//
// TAGS, at the start of a line in any content:
//   "@sad \"...\""        the line only makes sense sad
//   "@annoyed|tired ..."  any of these fits; one is picked
//   "@!happy ..."         a lever: this line changes their mood, whatever it was
//   no tag                most lines: relaxed and plain
//
// THE MOOD, consistency first:
//   1. a lever tag sets its mood, forced
//   2. the NPC already has a mood (npcMoodOf): the line is said in it, whatever its tag says
//   3. none, and the line has a tag: the tag sets a mild mood that lasts a few minutes, so their
//      next lines carry on in it; several options are picked from the NPC's id and the hour
//   4. neither: plain
// Sync and query-free: it runs on every line of chitchat.

import { isMood } from '../../client/shared/expressions.js';
import { npcMoodOf, setNpcMood } from './npc-mood.js';
import { world } from './world.js';

export const KINDS = Object.freeze({
  chitchat: { effort: 0 }, routine: { effort: 0 }, home: { effort: 0 }, banter: { effort: 0 },
  remark: { effort: 0 }, greeting: { effort: 0 }, parley: { effort: 0 }, dialogue: { effort: 0 },
  vendor: { effort: 0 }, wake: { effort: 0 }, battle: { effort: 1 }, alarm: { effort: 2 }, panic: { effort: 2 },
});
// a mood a line sets lasts this long, this strong: a passing feeling, not the day
export const LINE_MOOD = { i: 0.5, secs: 240 };
const VERB_EFFORT = { yells: 2, shouts: 2, screams: 2, bellows: 2, roars: 2, whispers: -1, mutters: -0.5, murmurs: -0.5 };

const TAG = /^\s*@(!?)([a-z]+(?:\|[a-z]+)*)\s+/;

// { text, moods, lever }: the line without its tag, the moods it lists (valid ones only), and
// whether it's a lever. A line with no tag has moods [].
export function readTag(line) {
  const s = String(line ?? '');
  const m = TAG.exec(s);
  if (!m) return { text: s, moods: [], lever: false };
  return { text: s.slice(m[0].length), moods: m[2].split('|').filter(isMood), lever: m[1] === '!' };
}

// The same NPC picks alike for an hour, and two people in a scene don't all pick the same.
function pick(npc, moods, now) {
  if (moods.length === 1) return moods[0];
  let h = 0x811c9dc5;
  for (const ch of `${npc?.id ?? ''}:${Math.floor(now / 3600000)}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;   // murmur3's fmix
  return moods[(h >>> 0) % moods.length];
}

// The mood a line is said in, as { m, i } or null for plain; sets it on the NPC when the line starts one.
export function moodForLine(npc, tag, now = Date.now()) {
  if (tag.lever && tag.moods.length && npc) {
    const m = pick(npc, tag.moods, now);
    setNpcMood(npc, m, { i: Math.max(LINE_MOOD.i, 0.7), secs: LINE_MOOD.secs, force: true });
    return { m, i: Math.max(LINE_MOOD.i, 0.7) };
  }
  const cur = npc ? npcMoodOf(npc, now) : null;
  if (cur) return { m: cur.m, i: cur.i };
  if (!tag.moods.length) return null;
  const m = pick(npc, tag.moods, now);
  if (npc) setNpcMood(npc, m, LINE_MOOD);
  return { m, i: LINE_MOOD.i };
}

// Names are unique across NPCs (content:lint holds it), so a caller with only a name still finds them.
function npcNamed(name) {
  for (const n of world.npcs.values()) if (n.name === name) return n;
  return null;
}

// The message for one line. `npc` is the NPC or, for an older caller, their name.
// `to` is a display name the line is said to ("says to Mara"); `verb` overrides "says".
export function npcSay(npc, line, { kind = 'chitchat', to = null, verb = null, now = Date.now() } = {}) {
  const who = typeof npc === 'string' ? npcNamed(npc) : npc;
  const name = typeof npc === 'string' ? npc : npc?.name;
  const tag = readTag(line);
  const t = tag.text.trim();
  const mood = moodForLine(who, tag, now);
  // A line that's one quoted span end to end is a say bubble; anything else (including
  // `mutters: "..."`) is an emote.
  const wrapped = t.length >= 2 && t.startsWith('"') && t.endsWith('"');
  if (wrapped && !t.slice(1, -1).includes('"')) {
    const v = verb || 'says';
    const effort = VERB_EFFORT[v] ?? KINDS[kind]?.effort ?? 0;
    const data = ` data-kind="${KINDS[kind] ? kind : 'chitchat'}"${mood ? ` data-mood="${mood.m}:${mood.i}"` : ''}${effort ? ` data-effort="${effort}"` : ''}`;
    return { type: 'output', message: `<span class="speech-line"${data}>${name} ${v}${to ? ` to ${to}` : ''}, ${t}</span>` };
  }
  // Emote: prepend the name VERBATIM. Never strip an outer quote pair: a mixed speech/action/speech
  // line would lose its opening quote and invert the client's quote colouring.
  return { type: 'zone_event', message: `${name} ${t}` };
}
