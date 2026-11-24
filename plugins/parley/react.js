// parley: choose what the NPC says back, and what it does to them.
//
// Everything is RAM and sync: the relation off the live player, the mood off the
// cached NPC, the lines off `flags.parley`. A conversation's memory (which lines
// were used, how many insults) lives in `talks` and is gone after PARLEY_MS quiet.

import { getRelation, relationTier, adjustRelation, relationAtLeast } from '../../server/engine/relations.js';
import { setNpcMood } from '../../server/engine/npc-mood.js';
import { setFlag } from '../../server/engine/flags.js';
import { genericLines } from './generic.js';
import { getZoneNpcs } from '../../server/engine/world.js';
import { sportsMention, sportsLine } from './sports.js';
import { namedPerson, aboutPerson } from './people.js';
import { politicsMention, politicsLine } from './politics.js';
import { hintFor, withHint, HINT_CHANCE, HINTS_PER_TALK } from './hints.js';

export const PARLEY_MS = 90_000;
const talks = new Map();   // `${playerId}|${npcId}` → { used: Set, insults, at }

// ── Beats ────────────────────────────────────────────────────────────────────
//
// A beat is a short story an NPC tells in steps, the way Façade's characters let
// things out a piece at a time: `{ id, topic?, act?, tier?, steps: [line, …], warmth? }`.
// It opens when a line touches its topic (or is its act) and the player stands at
// `tier` or better with them; each touch after that tells the next step. Telling the
// last step gives `warmth`. Progress is the player flag `parley_beat:<npc>:<beat>`,
// read sync off the hydrated `player._flags` and written once per step, so a story
// carries on across visits. A player with no flag cache (tests) keeps it in RAM.
const beatRam = new Map();
const beatKey = (npc, beat) => `parley_beat:${npc.id}:${beat.id}`;

export function beatStep(player, npc, beat) {
  const k = beatKey(npc, beat);
  const v = player?._flags instanceof Map ? player._flags.get(k) : beatRam.get(`${player?.id}|${k}`);
  return Math.max(0, parseInt(v, 10) || 0);
}

function setBeatStep(player, npc, beat, n) {
  const k = beatKey(npc, beat);
  if (player?._flags instanceof Map) setFlag('player', k, String(n), player).catch((e) => console.error('[parley] beat:', e.message));
  else beatRam.set(`${player?.id}|${k}`, String(n));
}

function beatFor(npc, player, rel, parsed, talk) {
  for (const b of npc.flags?.parley?.beats || []) {
    if (!b?.id || !b.steps?.length) continue;
    // "and then?" carries on the story this conversation is in the middle of.
    const hit = (b.topic && parsed.topic === b.topic) || (b.act && parsed.act === b.act)
      || (parsed.act === 'continue' && talk?.beat === b.id);
    if (!hit || (b.tier && !relationAtLeast(rel, b.tier))) continue;
    const step = beatStep(player, npc, b);
    if (step < b.steps.length) return { beat: b, step };
  }
  return null;
}

// What each act does to the NPC unless their `flags.parley.effects` says otherwise.
const EFFECTS = {
  greet:      { familiarity: 1 },
  praise:     { warmth: 2, mood: 'happy', i: 0.5 },
  thank:      { warmth: 1, mood: 'happy', i: 0.4 },
  insult:     { warmth: -6, mood: 'angry', i: 0.7 },
  flirt:      { mood: 'amused', i: 0.5 },
  apologise:  { warmth: 3, onlyIfCold: true },
  joke:       { mood: 'amused', i: 0.5 },
  complain:   { warmth: -1, mood: 'annoyed', i: 0.5 },
  ask_about:  { familiarity: 1 },
  ask_feeling:{ warmth: 1 },
};

// The tier you get, falling toward neutral: never a friend's line for an enemy.
const FALLBACK = {
  close: ['close', 'familiar', 'known', 'stranger'], familiar: ['familiar', 'known', 'stranger'],
  known: ['known', 'stranger'], stranger: ['stranger'], wary: ['wary', 'stranger'], hostile: ['hostile', 'wary', 'stranger'],
};

function poolFor(entry, tier) {
  if (!entry) return null;
  if (Array.isArray(entry) || typeof entry === 'string') return [].concat(entry);
  for (const t of FALLBACK[tier] || ['stranger']) if (entry[t]?.length) return [].concat(entry[t]);
  return entry.any ? [].concat(entry.any) : null;
}

// True when the next line starts a new conversation (nothing said in the last PARLEY_MS).
export function talkFresh(playerId, npcId) {
  const t = talks.get(`${playerId}|${npcId}`);
  return !t || Date.now() - t.at > PARLEY_MS;
}

function talkOf(playerId, npcId) {
  const k = `${playerId}|${npcId}`, now = Date.now();
  let t = talks.get(k);
  if (!t || now - t.at > PARLEY_MS) { t = { used: new Set(), insults: 0, at: now }; talks.set(k, t); }
  t.at = now;
  return t;
}
export function endTalk(playerId, npcId) { talks.delete(`${playerId}|${npcId}`); }
export function _resetTalks() { talks.clear(); }

// A line is "*what they do* what they say"; either half may be missing.
export function splitLine(line) {
  const m = /^\s*\*([^*]+)\*\s*(.*)$/.exec(String(line || ''));
  return m ? { act: m[1].trim(), say: m[2].trim() } : { act: '', say: String(line || '').trim() };
}

function pickFresh(pool, used) {
  const fresh = pool.filter((l) => !used.has(l));
  const from = fresh.length ? fresh : pool;
  const line = from[Math.floor(Math.random() * from.length)];
  used.add(line);
  return line;
}

// → { line: { act, say }, key, tier, ended, generic }. Anybody can answer: an NPC's own
// `flags.parley` lines come first, then the generic ones for their personality.
export function react(npc, player, parsed, { room = null, rand = Math.random } = {}) {
  if (!npc) return null;
  const data = npc.flags?.parley || {};
  const talk = talkOf(player.id, npc.id);
  const rel = getRelation(player, npc.id);
  const tier = relationTier(rel);
  const R = data.react || {};
  const { act, topic } = parsed;

  if (act === 'insult') talk.insults++;

  // A story they've been telling you comes before anything else they'd say about it.
  const beat = act === 'insult' || act === 'farewell' ? null : beatFor(npc, player, rel, parsed, talk);
  if (beat) {
    const { beat: b, step } = beat;
    setBeatStep(player, npc, b, step + 1);
    const last = step + 1 >= b.steps.length;
    talk.beat = last ? null : b.id;
    adjustRelation(player, npc.id, { familiarity: 1, warmth: last ? (b.warmth ?? 5) : 1, reason: `parley:beat:${b.id}` });
    if (b.mood) setNpcMood(npc, b.mood, { i: 0.5, secs: 90 });
    const first = String(npc.name || '').split(/\s+/)[0] || 'Nobody';
    const raw = String(b.steps[step]).replace(/\{name\}/g, player.handle || 'friend').replace(/\{first\}/g, first);
    talk.used.add(raw);
    return { line: splitLine(raw), key: `beat:${b.id}:${step + 1}`, tier, ended: false, generic: false, beat: { id: b.id, step: step + 1, of: b.steps.length } };
  }

  // Somebody else, politics, sport: what the line is about, when it isn't one of their
  // own topics and isn't something clearer (an insult, a goodbye).
  const topical = !topic && !['insult', 'farewell', 'flirt', 'apologise', 'thank', 'order_drink', 'gibberish', 'continue'].includes(act)
    ? topicalReply(npc, player, parsed, rel, talk, room, rand) : null;
  if (topical) return finish(npc, player, rel, talk, topical, tier, rand);

  const keys = [];
  if (act === 'insult' && talk.insults >= 3) keys.push('insult_last');
  if (topic) keys.push(`${act}:${topic}`, `ask_about:${topic}`);
  keys.push(act);
  if (act === 'gibberish') keys.push('unknown');
  let key = null, pool = null, generic = false;
  for (const k of keys) { pool = poolFor(R[k], tier); if (pool?.length) { key = k; break; } }
  if (!pool?.length) {
    const proper = /^\p{Lu}/u.test(String(npc.name || ''));
    for (const k of keys) {
      pool = genericLines(npc, k === 'ask_name' && !proper ? 'ask_name_unnamed' : k);
      if (pool?.length) { key = k; generic = true; break; }
    }
  }
  if (!pool?.length) {
    key = 'deflect';
    pool = poolFor(data.deflect, tier);
    if (!pool?.length) { pool = genericLines(npc, 'deflect'); generic = true; }
  }

  const first = String(npc.name || '').split(/\s+/)[0] || 'Nobody';
  const raw = pickFresh(pool, talk.used).replace(/\{name\}/g, player.handle || 'friend').replace(/\{first\}/g, first);

  // Effects: the authored override, then the default. A deflect does nothing to them.
  const fx = key === 'deflect' ? null : { ...(EFFECTS[act] || {}), ...(data.effects?.[act] || {}) };
  if (fx) {
    const warm = fx.onlyIfCold && (rel?.warmth ?? 0) >= 0 ? 0 : (fx.warmth || 0);
    if (warm || fx.familiarity) adjustRelation(player, npc.id, { warmth: warm, familiarity: fx.familiarity || 0, reason: `parley:${act}` });
    if (fx.mood) setNpcMood(npc, act === 'insult' && talk.insults >= 3 ? 'angry' : fx.mood, { i: act === 'insult' ? Math.min(1, (fx.i || 0.7) + 0.1 * talk.insults) : fx.i, secs: 90 });
  }
  const ended = act === 'farewell' || key === 'insult_last';
  if (ended) { endTalk(player.id, npc.id); return { line: splitLine(raw), key, tier, ended, generic }; }
  return finish(npc, player, rel, talk, { line: splitLine(raw), key, generic, quiet: act === 'insult' || talk.insults > 0 }, tier, rand);
}

// What's said about another person, politics or sport, with its effect. null when the
// line touches none of them.
function topicalReply(npc, player, parsed, rel, talk, room, rand) {
  const R = npc.flags?.parley?.react || {};
  const here = room || getZoneNpcs(player.current_zone) || [];
  const first = String(npc.name || '').split(/s+/)[0] || 'Nobody';
  const own = (k) => { const pool = poolFor(R[k], relationTier(rel)); return pool?.length ? pickFresh(pool, talk.used).replace(/{name}/g, player.handle || 'friend').replace(/{first}/g, first) : null; };

  const other = namedPerson(parsed, npc);
  if (other) {
    const authored = own(`person:${other.id}`);
    const said = authored ? { line: authored, kind: 'authored' } : aboutPerson(npc, other, { rel, here: here.some((n) => n.id === other.id), used: talk.used, rand });
    if (said) {
      adjustRelation(player, npc.id, { familiarity: 1, reason: 'parley:person' });
      if (said.kind === 'lover' && relationAtLeast(rel, 'familiar')) setNpcMood(npc, 'happy', { i: 0.4, secs: 60 });
      if (said.kind === 'ex' || said.kind === 'rival') setNpcMood(npc, 'annoyed', { i: 0.4, secs: 60 });
      return { line: splitLine(said.line), key: `person:${said.kind}`, person: { id: other.id, kind: said.kind } };
    }
  }

  const pt = politicsMention(parsed.text);
  if (pt) {
    const authored = own(`politics:${pt}`) || own('politics');
    const said = authored ? { line: authored, sit: 'authored' } : politicsLine(npc, pt, { rel, room: here, rand });
    if (said) {
      if (said.revealed) adjustRelation(player, npc.id, { familiarity: 1, warmth: said.side?.side === 'lw' ? 2 : 1, reason: 'parley:politics' });
      if (/hush|not_here|cover/.test(said.sit)) setNpcMood(npc, 'afraid', { i: 0.3, secs: 45 });
      return { line: splitLine(said.line), key: `politics:${said.sit}`, politics: { topic: pt, sit: said.sit } };
    }
  }

  const sm = sportsMention(parsed.text);
  if (sm) {
    const authored = own('sports');
    const said = authored ? { text: authored, s: null } : sportsLine(npc, sm, rand);
    if (said) {
      const s = said.s;
      if (s && s.level === 2 && ['own', 'watch', 'league', 'cup_own', 'cup'].includes(s.sit)) {
        adjustRelation(player, npc.id, { familiarity: 1, warmth: 1, reason: 'parley:sports' });
        setNpcMood(npc, 'happy', { i: s.sit === 'cup_own' ? 0.8 : 0.5, secs: 90 });
      } else if (s && s.level === 2 && (s.sit === 'rival' || s.sit === 'cup_rival')) setNpcMood(npc, 'annoyed', { i: 0.4, secs: 60 });
      if (s?.sit === 'bored') setNpcMood(npc, 'bored', { i: 0.4, secs: 45 });
      return { line: splitLine(said.text), key: `sports:${s?.sit || 'authored'}`, sports: s };
    }
  }
  return null;
}

// Every answer that doesn't end the talk may carry a hint at something else they'd talk about.
function finish(npc, player, rel, talk, out, tier, rand) {
  let line = out.line;
  talk.hints = talk.hints || 0;
  if (!out.quiet && talk.hints < HINTS_PER_TALK && rand() < HINT_CHANCE) {
    const h = hintFor(npc, player, rel, rand);
    if (h) {
      const merged = withHint(line, String(h).replace(/{name}/g, player.handle || 'friend'), splitLine);
      if (merged !== line) { line = merged; talk.hints++; out = { ...out, hinted: h }; }
    }
  }
  const { quiet, ...rest } = out;
  return { ...rest, line, tier, ended: false, generic: !!out.generic };
}
