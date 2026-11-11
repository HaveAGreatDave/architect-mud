// What mood an NPC is in, for their face and the look line (docs/systems-expressions.md).
//
// Three layers, the first that holds winning:
//   1. transient  setNpcMood(): an event, a dialogue node (the SET_MOOD action), being woken or hit.
//                 Held in RAM on the NPC (`_mood`) with an expiry; never written to the database.
//   2. state      read off what the engine already knows: asleep or out cold shows nothing.
//   3. base       content: `flags.mood` ('sad', or { mood: 'sad', i: 0.5 }) for somebody always that way.
// npcMoodOf() is sync and query-free, so it is safe in a room payload or a look.

import { isMood } from '../../client/shared/expressions.js';
import { registerAction } from './actions.js';
import { on } from './events.js';
import { getZoneNpcs } from './world.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Who answers a blow with anger rather than fear, by flags.personality.
const FIGHTERS = new Set(['guard', 'police', 'mercenary', 'thug', 'bouncer', 'enforcer']);

// Somebody's mood is listened for here; the room view re-sends people when it changes (plugins/roomstage).
const listeners = new Set();
export function onNpcMoodChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Put an NPC in a mood for `secs` seconds (default 60), at intensity `i`. A weaker mood never cuts a
// stronger one short unless `force`. Passing 'neutral' or null clears the transient layer.
export function setNpcMood(npc, mood, { i = 0.8, secs = 60, force = false } = {}) {
  if (!npc) return false;
  if (!mood || mood === 'neutral') { const had = !!npc._mood; npc._mood = null; if (had) fire(npc); return had; }
  if (!isMood(mood)) return false;
  const now = Date.now(), cur = npc._mood && npc._mood.until > now ? npc._mood : null;
  if (cur && !force && cur.mood !== mood && cur.i > clamp01(+i)) return false;
  npc._mood = { mood, i: clamp01(+i), until: now + Math.max(1, +secs || 60) * 1000 };
  fire(npc);
  return true;
}

function fire(npc) { for (const fn of listeners) { try { fn(npc); } catch (e) { console.error('[npc-mood]', e.message); } } }

function baseOf(npc) {
  const b = npc?.flags?.mood;
  if (!b) return null;
  if (typeof b === 'string') return isMood(b) ? { m: b, i: 0.6 } : null;
  return isMood(b.mood) ? { m: b.mood, i: clamp01(b.i ?? 0.6) } : null;
}

// { m, i, s? } for an NPC, or null for nothing to show (neutral, asleep, out cold).
export function npcMoodOf(npc, now = Date.now()) {
  if (!npc) return null;
  const ai = npc._ai;
  if (ai?.homeSleeping || ai?.dosedOut) return null;
  const t = npc._mood;
  // `s`: seconds it has left, so a viewer can let it go without being told
  if (t && t.until > now) return { m: t.mood, i: t.i, s: Math.ceil((t.until - now) / 1000) };
  if (t) npc._mood = null;
  return baseOf(npc);
}

// SET_MOOD, for dialogue nodes and scripts: { action: 'SET_MOOD', mood, i?, secs?, npc? }. Flat
// params as the dialogue editor writes them. With no `npc` it sets the NPC being spoken to
// (context.npc) or, failing that, the one named in the actor's zone.
registerAction({
  type: 'SET_MOOD',
  handler: async ({ actor, params, context }) => {
    const p = params || {};
    let npc = context?.npc || null;
    if (p.npc || !npc) {
      const name = String(p.npc || '').toLowerCase(), zone = actor?.current_zone;
      npc = (zone && getZoneNpcs(zone).find((n) => n.id === p.npc || (name && n.name?.toLowerCase() === name))) || npc;
    }
    if (!npc) return { type: 'error', message: 'SET_MOOD: no NPC to set it on.' };
    if (!isMood(p.mood) && p.mood !== 'neutral') return { type: 'error', message: `SET_MOOD: no mood called ${p.mood}.` };
    setNpcMood(npc, p.mood, { i: p.i ?? 0.8, secs: p.secs ?? 120, force: true });
    return { type: 'mood', mood: p.mood };
  },
});

// Hit, they're frightened, or angry if fighting is their trade.
on('npc.attacked', ({ npc }) => {
  if (!npc) return;
  setNpcMood(npc, FIGHTERS.has(npc.flags?.personality) ? 'angry' : 'afraid', { i: 1, secs: 90, force: true });
});

export const _test = { baseOf, FIGHTERS };
