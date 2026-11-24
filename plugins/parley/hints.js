// parley: now and then somebody lets slip a thing they could talk about, without telling
// you what to say. A scarf half out of a pocket, a name dropped, a glance at a camera.
//
// Sources, any of which may be empty: the NPC's own `flags.parley.hints` (lines), the
// `hint` on a story (beat) they haven't finished and you're close enough to hear, and the
// generic tells for sport, the people they're close to and their politics.
//
// At most HINTS_PER_TALK per conversation, at HINT_CHANCE per answer, never after an
// insult and never on a line that ends the conversation. Sync, RAM only.

import { relationAtLeast } from '../../server/engine/relations.js';
import { sportsHint } from './sports.js';
import { peopleHint } from './people.js';
import { politicsHint } from './politics.js';
import { beatStep } from './react.js';

export let HINT_CHANCE = 0.18;
export function _setHintChance(c) { HINT_CHANCE = c; }
export const HINTS_PER_TALK = 2;

export function hintFor(npc, player, rel, rand = Math.random) {
  const own = [].concat(npc.flags?.parley?.hints || []);
  for (const b of npc.flags?.parley?.beats || []) {
    if (!b?.hint || (b.tier && !relationAtLeast(rel, b.tier))) continue;
    if (beatStep(player, npc, b) < (b.steps?.length || 0)) own.push(...[].concat(b.hint));
  }
  // Authored ones are the point; the generic tells fill in for people with none.
  if (own.length && rand() < 0.7) return own[Math.floor(rand() * own.length)];
  const gens = [() => sportsHint(npc, rand), () => peopleHint(npc, rand), () => politicsHint(npc, rel, rand)]
    .sort(() => rand() - 0.5);
  for (const g of gens) { const h = g(); if (h) return h; }
  return own.length ? own[Math.floor(rand() * own.length)] : null;
}

// Tack a hint onto an answer `{ act, say }`. A hint that is all action goes in front of
// the words when the answer has no action of its own; otherwise it's said after.
export function withHint(line, hint, splitLine) {
  const h = splitLine(hint);
  if (h.act && !h.say) {
    if (!line.act) return { act: h.act, say: line.say };
    return line;   // two actions read badly; skip it
  }
  if (h.act) return line.act ? line : { act: h.act, say: [line.say, h.say].filter(Boolean).join(' ') };
  return { act: line.act, say: [line.say, h.say].filter(Boolean).join(' ') };
}
