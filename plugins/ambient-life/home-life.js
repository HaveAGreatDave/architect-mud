// Home life — what an NPC does in their own kitchen when nobody needs them.
//
// The street-life half of this plugin gives PUBLIC space a rhythm. This is the
// private half: an NPC who is home and off-shift makes something, eats or
// drinks it, and clears up. It is the difference between an apartment that
// contains a person and an apartment where somebody lives.
//
// IT IS NOT A SIMULATION, and that is the entire design. The NPC does not hold
// a vessel, does not run the cook clock, does not resolve a recipe and does not
// own a single database row for any of this. It picks a plausible OUTCOME up
// front — a dish from cooking's catalogue, a drink from the drinks one — and
// then narrates three or four beats toward it. Nobody watching can tell the
// difference, and the whole feature costs one timer and no writes.
//
// The nouns come from the real catalogues, so a recipe added for players turns
// up in NPC life the same day, with no edit here.
//
// Rules, all of which exist because their absence looked wrong:
//   • Home only. An NPC cooking in a bar is a bartender working, not a person.
//   • Off-shift only — the same isNpcScheduledNow gate banter uses.
//   • One household routine per zone, so a shared flat doesn't have three
//     people all frying eggs in silence.
//   • A witness must be present, and is re-checked before every beat: this is
//     scenery for whoever is in the room, not a simulation running in the dark.
import { world, getZonePlayers } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { isNpcScheduledNow } from '../../server/engine/broadcast-bridge.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { DISHES } from '../cooking/dishes.js';
import { DRINKS } from '../drinks/recipes.js';

const START_CHANCE = 0.35;                 // per eligible zone, per tick
const COOLDOWN_MS = [8 * 60_000, 20 * 60_000];
const BEAT_GAP_MS = [12_000, 24_000];      // domestic time is slow time

const rand = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const zoneCooldown = new Map();   // zoneId → ts
const activeHome = new Set();     // zoneId mid-routine

// ── The scenes ───────────────────────────────────────────────────────────────
// {npc} and {thing} are filled per run. Each scene is a whole small story: the
// last beat matters as much as the first, because a person who cooks and never
// washes up reads as a machine that cooks.

const MEAL = [
  [`{npc} starts pulling things out of the cupboard with the air of someone who has already decided.`,
   `Something is frying. {npc} is not watching it as closely as they should be.`,
   `{npc} sits down to {thing} and eats the first three mouthfuls far too fast.`,
   `{npc} washes up, badly, and leaves one pan to soak.`],
  [`{npc} reads the back of a packet for a while, then puts it down and does it their own way.`,
   `{npc} gets {thing} going, and the smell of it fills the room — better than it has any right to be.`,
   `{npc} eats standing up, out of the pan, which they would deny if asked.`],
  [`{npc} chops something with more force than the task requires.`,
   `{npc} tastes it, makes a face, and adds something else.`,
   `{npc} tastes it again and nods, grudgingly satisfied.`,
   `{npc} eats {thing} slowly, and for a few minutes looks like nothing much is wrong.`],
];

const DRINK = [
  [`{npc} puts something on to boil and stands there waiting for it, doing nothing else at all.`,
   `{npc} settles down with {thing} and wraps both hands around it.`],
  [`{npc} makes {thing} with the unthinking economy of someone who has made a thousand of them.`,
   `{npc} drinks it too hot, winces, and drinks it too hot again.`],
  [`{npc} pours {thing}, considers it, and tops it up.`,
   `{npc} drinks without hurrying. Whatever the day was, it is over now.`],
];

const TIDY = [
  [`{npc} moves around the room putting things back where they go.`,
   `{npc} stops halfway through, loses interest, and sits down.`],
];

// A plausible thing to have made. Straight off the live catalogues, so anything
// authored for players shows up here for free — and both are filtered to what a
// person would plausibly knock together at home rather than the whole list.
function pickMeal() {
  const keys = Object.keys(DISHES).filter(k => (DISHES[k].difficulty || 9) <= 6);
  return DISHES[rand(keys.length ? keys : Object.keys(DISHES))].noun;
}

function pickDrink(phase) {
  // Morning wants coffee; late evening does not.
  const morning = phase === 'dawn' || phase === 'morning';
  const keys = Object.keys(DRINKS).filter(k => {
    const t = DRINKS[k];
    if ((t.difficulty || 9) > 6) return false;
    if (morning) return t.hot;
    return true;
  });
  return DRINKS[rand(keys.length ? keys : Object.keys(DRINKS))].noun;
}

// Home, off-shift, alive, and not in the middle of something else.
function homebodiesIn(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  const out = [];
  for (const id of zone.npcs) {
    const npc = world.npcs.get(id);
    if (!npc || npc._dead) continue;
    if (npc.home_zone !== zoneId) continue;        // this is their place, not a shift
    if (npc._combatTargetId) continue;
    if (npc.flags?.no_home_life) continue;         // the opt-out, for anyone it reads wrong on
    if (isNpcScheduledNow(npc.id)) continue;       // on shift — same gate banter uses
    out.push(npc);
  }
  return out;
}

function startCooldown(zoneId) {
  zoneCooldown.set(zoneId, Date.now() + randInt(COOLDOWN_MS[0], COOLDOWN_MS[1]));
}

function play(zoneId, npc, beats) {
  activeHome.add(zoneId);
  let i = 0;
  const step = () => {
    // Re-checked every beat: a routine performing to an empty room is a timer
    // burning for nobody, and an NPC who wandered off should stop cooking.
    const live = world.npcs.get(npc.id);
    if (i >= beats.length || !getZonePlayers(zoneId).length
        || !live || live._dead || live.zone_id !== zoneId || live._combatTargetId) {
      activeHome.delete(zoneId);
      startCooldown(zoneId);
      return;
    }
    sendToZone(zoneId, { type: 'ambient', message: `<span class="msg-ambient">${beats[i++]}</span>` });
    if (i >= beats.length) { activeHome.delete(zoneId); startCooldown(zoneId); return; }
    setTimeout(step, randInt(BEAT_GAP_MS[0], BEAT_GAP_MS[1]));
  };
  step();
}

/**
 * One pass. Called from the ambient-life tick, so it inherits that tick's
 * idle-gating — no players, no candidates, no work.
 */
export function homeLifeTick() {
  const now = Date.now();
  const { timePhase } = getEnvironmentState();

  const candidates = new Set();
  for (const player of world.players.values()) {
    if (player.current_zone) candidates.add(player.current_zone);
  }

  for (const zoneId of candidates) {
    if (activeHome.has(zoneId)) continue;
    if ((zoneCooldown.get(zoneId) ?? 0) > now) continue;
    if (!getZonePlayers(zoneId).length) continue;
    if (Math.random() > START_CHANCE) continue;

    const folk = homebodiesIn(zoneId);
    if (!folk.length) continue;
    const npc = rand(folk);

    // Which kind of evening this is. Meals cluster around meal times; a drink
    // is always plausible; tidying is the quiet filler that stops every routine
    // being about food.
    const mealtime = ['morning', 'midday', 'evening'].includes(timePhase);
    const roll = Math.random();
    let beats;
    if (mealtime && roll < 0.45) beats = rand(MEAL).map(l => l.replace('{thing}', pickMeal()));
    else if (roll < 0.8) beats = rand(DRINK).map(l => l.replace('{thing}', pickDrink(timePhase)));
    else beats = rand(TIDY);

    play(zoneId, npc, beats.map(l => l.replace(/\{npc\}/g, npc.name)));
  }
}

// Test seam — regress asserts the catalogues actually yield nouns.
export const _internals = { pickMeal, pickDrink, MEAL, DRINK, TIDY };
