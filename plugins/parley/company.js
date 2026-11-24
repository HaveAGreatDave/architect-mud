// parley: talking with more than one person in the room, the way Façade's couple both
// reacted to you. Three things on top of a single exchange:
//
// - Overhearing: name somebody else in the room while you talk and they chip in
//   (`react.overheard_<act>`, then `react.overheard`, then a generic line). Once a
//   minute per person at most, and only one of them per line.
// - Handing off: a topic the person you're talking to leaves to somebody else
//   (`flags.parley.defer: { topic: npcId | [npcId, …] }`) gets "ask them", and the
//   other answers. Your next unnamed line goes to them.
// - Gossip: be rude to somebody, or hear their whole story, and the people in their
//   circle (`flags.parley.circle: [npcId, …]`) bring it up the next time you talk to
//   them (`react.gossip_rude`, `react.gossip_story`, with {other}). RAM only, a day
//   at most, and each listener says it once; a restart forgets it.
//
// All sync and query-free, like the rest of parley.

import { adjustRelation } from '../../server/engine/relations.js';
import { setNpcMood } from '../../server/engine/npc-mood.js';
import { parse } from './parse.js';
import { react, splitLine, talkFresh } from './react.js';
import { genericLines } from './generic.js';
import { exchangeFor } from './sports.js';

const first = (npc) => String(npc?.name || '').split(/\s+/)[0] || 'them';
const nameParts = (npc) => String(npc.name || '').split(/\s+/).filter((p) => p.length >= 2);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const named = (text, npc) => nameParts(npc).some((p) => new RegExp(`\\b${esc(p.toLowerCase())}\\b`).test(String(text).toLowerCase()));

const pickOne = (pool) => pool[Math.floor(Math.random() * pool.length)];
function linesFor(npc, keys) {
  const R = npc.flags?.parley?.react || {};
  for (const k of keys) {
    const v = R[k];
    const pool = Array.isArray(v) ? v : typeof v === 'string' ? [v] : v?.stranger || v?.any || null;
    if (pool?.length) return pool;
  }
  for (const k of keys) { const g = genericLines(npc, k); if (g?.length) return g; }
  return null;
}
const fill = (line, { other, player }) => String(line)
  .replace(/\{other\}/g, first(other)).replace(/\{name\}/g, player?.handle || 'friend');

// ── Gossip ───────────────────────────────────────────────────────────────────
const GOSSIP_MS = 24 * 3600_000;
const gossip = new Map();   // playerId → [{ from, kind, at, told: Set }]

export function noteGossip(player, npc, kind) {
  const list = (gossip.get(player.id) || []).filter((g) => Date.now() - g.at < GOSSIP_MS && !(g.from === npc.id && g.kind === kind));
  list.push({ from: npc.id, fromName: npc.name, kind, at: Date.now(), told: new Set() });
  gossip.set(player.id, list.slice(-12));
}

// What this listener has heard about the player from their circle, said once.
function gossipFor(listener, player, room) {
  const circle = new Set(listener.flags?.parley?.circle || []);
  if (!circle.size) return null;
  for (const g of gossip.get(player.id) || []) {
    if (!circle.has(g.from) || g.told.has(listener.id) || Date.now() - g.at > GOSSIP_MS) continue;
    const pool = linesFor(listener, [`gossip_${g.kind}`]);
    if (!pool) continue;
    g.told.add(listener.id);
    const other = room.find((n) => n.id === g.from) || { name: g.fromName || 'Somebody' };
    adjustRelation(player, listener.id, { warmth: g.kind === 'rude' ? -3 : 3, reason: `parley:gossip:${g.kind}` });
    if (g.kind === 'rude') setNpcMood(listener, 'annoyed', { i: 0.5, secs: 90 });
    return splitLine(fill(pickOne(pool), { other, player }));
  }
  return null;
}
export function _resetGossip() { gossip.clear(); }

// ── Overhearing ──────────────────────────────────────────────────────────────
const overheardAt = new Map();   // `${playerId}|${npcId}` → ms
const OVERHEAR_MS = 60_000;

function overhear(npc, player, act) {
  const k = `${player.id}|${npc.id}`;
  if (Date.now() - (overheardAt.get(k) || 0) < OVERHEAR_MS) return null;
  const pool = linesFor(npc, [`overheard_${act}`, 'overheard']);
  if (!pool) return null;
  overheardAt.set(k, Date.now());
  if (act === 'insult') { adjustRelation(player, npc.id, { warmth: -3, reason: 'parley:overheard' }); setNpcMood(npc, 'annoyed', { i: 0.6, secs: 90 }); }
  if (act === 'praise') adjustRelation(player, npc.id, { warmth: 2, reason: 'parley:overheard' });
  return splitLine(fill(pickOne(pool), { player }));
}
export function _resetOverheard() { overheardAt.clear(); }

// ── One line, to one person, in company ─────────────────────────────────────
//
// → { npc, out, extra: [{ npc, line }], partner, handled: Set<npcId> } or null when
// the addressee would rather not answer. `out` is what the addressee says (the
// ordinary react() result, or the hand-off); `extra` are the others, in order.
export function converse({ player, npc, text, room = [], direct = false, canTalk = () => true, authored = () => true }) {
  const handled = new Set([npc.id]);
  const parsed = parse(text, { topics: npc.flags?.parley?.topics, names: nameParts(npc) });
  if (!direct && !authored(npc) && !parsed.confidence) return null;
  const extra = [];
  const others = room.filter((n) => n.id !== npc.id && canTalk(n));
  let partner = npc;

  // Gossip comes first, at the start of a conversation, in place of their hello.
  let out = null;
  if (talkFresh(player.id, npc.id)) {
    const g = gossipFor(npc, player, room);
    if (g) out = { line: g, key: 'gossip', ended: false, parsed };
  }

  // A topic they leave to somebody who's here.
  const deferTo = [].concat(npc.flags?.parley?.defer?.[parsed.topic] || []);
  const asking = parsed.act === 'ask_about' || parsed.act === 'order_drink' || parsed.question;
  const target = !out && asking && parsed.topic && others.find((n) => deferTo.includes(n.id));
  if (target) {
    const pool = linesFor(npc, [`defer:${parsed.topic}`, 'defer']) || ['Ask {other}.'];
    out = { line: splitLine(fill(pickOne(pool), { other: target, player })), key: 'defer', ended: false, parsed };
    const theirs = parse(text, { topics: target.flags?.parley?.topics, names: nameParts(target) });
    const ans = react(target, player, theirs, { room });
    if (ans) { extra.push({ npc: target, line: ans.line, key: ans.key }); partner = target; handled.add(target.id); }
  }

  if (!out) out = { ...react(npc, player, parsed, { room }), parsed };
  if (out.ended) partner = null;

  // What it did that the others will hear about.
  if (parsed.act === 'insult') noteGossip(player, npc, 'rude');
  if (out.beat && out.beat.step === out.beat.of) noteGossip(player, npc, 'story');

  // Somebody else named while you talk: one of them chips in.
  let chipped = false;
  for (const n of others) {
    if (handled.has(n.id) || !named(text, n)) continue;
    handled.add(n.id);
    if (chipped) continue;
    const line = overhear(n, player, parsed.act);
    if (line) { extra.push({ npc: n, line, key: 'overheard' }); chipped = true; }
  }
  // Sport raised in front of another fan: they can't keep out of it. The rival's fan
  // most of all, and longest when both clubs are in the Cup.
  if (out.sports && !out.ended) {
    const ex = exchangeFor(npc, out.sports, others.filter((n) => extra.every((x) => x.npc.id !== n.id)), player.current_zone);
    if (ex) {
      handled.add(ex.other.id);
      ex.turns.forEach((t, i) => extra.push({ npc: i % 2 === 0 ? ex.other : npc, line: splitLine(t), key: `sports:${ex.type}` }));
    }
  }
  return { npc, out, extra, partner, handled };
}
