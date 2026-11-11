// smalltalk: ask anybody what they're up to.
//
// The answer is what they're really doing (server/engine/npc-doing.js reads it off the
// behaviour graph's own state), told at one of three levels: they won't say, the short
// answer, or the whole of it. Which level depends on who they are and how well they know
// you. Two ways in, one answer: the "What are you up to?" option every dialogue root gets
// (a dialogue topic), and the typed `whatsup <npc>` for people with no dialogue tree.
//
// No state, no queries, no ticks.

import { registerDialogueTopic } from '../../server/engine/dialogue.js';
import { npcDoingNow } from '../../server/engine/npc-doing.js';
import { getRelation, relationTier, touchRelation } from '../../server/engine/relations.js';
import { npcMoodOf } from '../../server/engine/npc-mood.js';
import { getZoneNpcs } from '../../server/engine/world.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import { isAnimal } from '../../server/engine/commands/social.js';
import { escapeHtml } from '../../server/engine/html.js';
import { REFUSE, BRIEF, FULL, BACK } from './lines.js';

// ── How readily somebody talks about themselves ──────────────────────────────
//
// A number per archetype (flags.personality): 0 is an ordinary person, who gives a
// stranger the short answer. `flags.smalltalk` on the NPC beats it.
const RESERVE_WORDS = { open: 1, normal: 0, guarded: -1, closed: -2 };
const BY_PERSONALITY = {
  chatty: 2,
  vendor: 1, travelling_vendor: 1, bartender: 1, charity: 1, preacher: 1, politician: 1,
  tv_host: 1, charter_pilot: 1, clerk: 1,
  quiet: -1, gruff: -1, stoic: -1, guard: -1, police: -1, mercenary: -1, official: -1, corporate: -1,
  dealer: -2, thug: -2, lowlife: -2, cult_member: -2,
};
const BY_TIER = { wary: -2, stranger: 0, known: 1, familiar: 2, close: 3 };
const SOUR_MOODS = new Set(['angry', 'annoyed', 'afraid', 'disgusted']);

function reserveOf(npc) {
  const authored = npc?.flags?.smalltalk;
  if (typeof authored === 'string' && authored in RESERVE_WORDS) return RESERVE_WORDS[authored];
  return BY_PERSONALITY[npc?.flags?.personality] ?? 0;
}

// → { level: 'refuse' | 'brief' | 'full', why } where `why` picks the refusal pool.
// The same person gives the same player the same level until something between them
// changes: there's no roll here, only in which line of the pool gets said.
export function shareLevel(npc, player) {
  const tier = relationTier(getRelation(player, npc.id));
  if (tier === 'hostile') return { level: 'refuse', why: 'disliked', tier };
  if (npc.flags?.smalltalk === 'never') return { level: 'refuse', why: 'closed', tier };
  const reserve = reserveOf(npc);
  const sour = SOUR_MOODS.has(npcMoodOf(npc)?.m);
  const score = reserve + (BY_TIER[tier] ?? 0) - (sour ? 1 : 0);
  if (score >= 1) return { level: 'full', tier };
  if (score === 0) return { level: 'brief', tier };
  const why = tier === 'wary' ? 'disliked' : reserve <= -2 ? 'closed' : reserve === -1 ? 'guarded' : 'notnow';
  return { level: 'refuse', why, tier };
}

// ── The line ─────────────────────────────────────────────────────────────────

const pick = (pool) => pool[Math.floor(Math.random() * pool.length)];
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Fill {work} {place} {when}. Lines whose tokens have no value are dropped first, so
// nobody says "I'm at  today".
function say(pool, doing) {
  const vals = { work: doing.work, place: doing.place, when: doing.nextShift };
  const usable = list(pool).filter((l) => typeof l === 'string'
    && [...l.matchAll(/\{(\w+)\}/g)].every((m) => vals[m[1]]));
  if (!usable.length) return null;
  return pick(usable).replace(/\{(\w+)\}/g, (_, k) => escapeHtml(String(vals[k])));
}

// `flags.up_to`: a line, a list of lines, or lines by what they're doing
// ({ working, to_work, heading_home, at_home, out, idle, banking, any, refuse }).
function authored(npc, key) {
  const a = npc?.flags?.up_to;
  if (!a) return null;
  if (typeof a === 'string' || Array.isArray(a)) return key === 'refuse' ? null : a;
  return a[key] ?? (key === 'refuse' ? null : a.any) ?? null;
}

// → { level, kind, text, back } — what this NPC tells this player right now.
export function whatsUp(npc, player) {
  const doing = npcDoingNow(npc);
  const share = shareLevel(npc, player);
  let { level } = share;
  let text = null;

  if (level === 'refuse') {
    text = say(authored(npc, 'refuse'), doing) || pick(REFUSE[share.why] || REFUSE.notnow);
  } else {
    // Money on them: only somebody close hears where it's going.
    const secret = doing.kind === 'banking' && share.tier !== 'close';
    if (secret) level = 'brief';
    text = (!secret && say(authored(npc, doing.kind), doing))
      || (level === 'full' && doing.kind === 'out' && doing.haunt && say(FULL.haunt, doing))
      || (level === 'full' && say(FULL[doing.kind], doing))
      || say(BRIEF[doing.kind] || BRIEF.idle, doing);
  }
  return { level, kind: doing.kind, text, back: pick(BACK[level]) };
}

// Who can be asked at all. `flags.smalltalk: false` takes the question off somebody
// (a machine, a mute); an animal never had it.
function askable(npc) {
  return !!npc && npc.flags?.smalltalk !== false && !isAnimal(npc) && !npc._ai?.homeSleeping;
}

registerDialogueTopic({
  id: 'whatsup',
  label: 'What are you up to?',
  when: (npc) => askable(npc),
  render: ({ npc, player }) => {
    const a = whatsUp(npc, player);
    return { text: a.text, back: a.back };
  },
});

// ── whatsup <npc> ────────────────────────────────────────────────────────────
// The same question, typed. It's the only way to ask somebody with no dialogue tree.
async function cmdWhatsup(args, _raw, player, broadcast) {
  const targetStr = (args || []).join(' ').trim();
  if (!targetStr) return { type: 'error', message: 'Ask whom? (whatsup <name>)' };
  const r = siftResolve(targetStr, getZoneNpcs(player.current_zone));
  if (r.type === 'none') return { type: 'error', message: `Can't find "${targetStr}" here.` };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb: 'whatsup' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  const npc = r.candidate;
  if (npc._ai?.homeSleeping) return { type: 'output', message: `${npc.name} is asleep.` };
  if (!askable(npc)) return { type: 'output', message: `${npc.name} doesn't answer.` };

  const a = whatsUp(npc, player);
  // Asking is talking: it counts toward knowing them, on the same rate limit `talk` uses.
  touchRelation(player, npc.id, { reason: 'dialogue' });
  const reply = `<span class="speech-line">${escapeHtml(npc.name)} says, "${a.text}"</span>`;
  if (broadcast) {
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} asks ${npc.name} what they're up to.` }, player.id);
    broadcast(player.current_zone, { type: 'output', message: reply }, player.id);
  }
  return { type: 'output', message: `You ask ${escapeHtml(npc.name)} what they're up to.\n${reply}` };
}

export const commands = { whatsup: cmdWhatsup };
export const _test = { reserveOf, BY_PERSONALITY };
