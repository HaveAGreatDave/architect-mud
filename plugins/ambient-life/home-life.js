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
import { world, getZonePlayers, getZone, getZoneFurniture } from '../../server/engine/world.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { sendToZone, getBroadcast } from '../../server/engine/messaging.js';
import { isNpcScheduledNow } from '../../server/engine/broadcast-bridge.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { npcWashAtHome } from '../../server/engine/hygiene.js';
import { query } from '../../server/models/db.js';
import { DISHES } from '../cooking/dishes.js';
import { DRINKS } from '../drinks/recipes.js';
import { isToilet, isShower } from '../bodily/index.js';

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

// ── The bathroom ─────────────────────────────────────────────────────────────
// The one domestic routine that is NOT pure narration, because it can't be: an
// ensuite is a real adjacent zone with a real door, so the NPC actually walks
// through it and comes back. That makes it the only routine a player can follow,
// walk in on, or find an empty room because of — which is the whole reason it's
// worth the extra machinery.
//
// It ends in npcWashAtHome(), the engine's existing abstract "someone who lives
// here keeps clean" reset. That call already happened invisibly every tick an
// NPC stood in their own home; this gives it somewhere to have happened.

const BATHROOM_MS   = [25_000, 60_000];   // how long they're gone
const BATHROOM_GOING = [
  `{npc} gets up without a word and heads for the bathroom.`,
  `{npc} says "give me a minute" to nobody in particular and goes through.`,
  `{npc} pauses mid-thought, makes a face, and goes to the bathroom.`,
  `{npc} disappears into the bathroom. The door does not quite latch.`,
];
const BATHROOM_BACK = [
  `{npc} comes back drying their hands on their trousers.`,
  `A cistern refills somewhere behind the wall. {npc} reappears, unbothered.`,
  `{npc} returns, hair damp at the temples, looking marginally more like a person.`,
  `{npc} comes back in, wiping their face, and picks up exactly where they left off.`,
];

// zoneId → { id: bathroomZoneId | null, at: ts }. A dwelling's ensuite doesn't
// move, so the positive answer is cached forever; a NEGATIVE is re-checked
// occasionally, because a builder can plumb a bathroom in at runtime and the
// alternative is that flat never having one until the next restart.
const bathroomOf = new Map();
const NEGATIVE_TTL_MS = 10 * 60_000;

function bathroomFor(zoneId) {
  const hit = bathroomOf.get(zoneId);
  if (hit && (hit.id || Date.now() - hit.at < NEGATIVE_TTL_MS)) return hit.id;

  // A bathroom is a SUB-zone of this dwelling with a fixture in it. There is no
  // bathroom flag in the world data and inventing one would mean backfilling
  // twenty-odd rooms, so this asks the question the fixtures already answer.
  let found = null;
  for (const dest of Object.values(getZone(zoneId)?.exits || {})) {
    if (getZone(dest)?.parent_zone !== zoneId) continue;
    if (getZoneFurniture(dest).some(f => isToilet(f) || isShower(f))) { found = dest; break; }
  }
  bathroomOf.set(zoneId, { id: found, at: Date.now() });
  return found;
}

// Bespoke rather than play(): the generic beat-runner aborts the moment the NPC
// isn't in the room any more, and being out of the room is the point of this one.
function playBathroom(zoneId, npc, bathId) {
  activeHome.add(zoneId);
  const done = () => { activeHome.delete(zoneId); startCooldown(zoneId); };
  const say = (pool) => sendToZone(zoneId, {
    type: 'ambient',
    message: `<span class="msg-ambient">${rand(pool).replace(/\{npc\}/g, npc.name)}</span>`,
    flavour: true,   // scenery — dropped at the Display Mode `log` rung
  });

  say(BATHROOM_GOING);
  setTimeout(() => {
    const live = world.npcs.get(npc.id);
    if (!live || live._dead || live.zone_id !== zoneId || live._combatTargetId
        || isBusyBeingUnconscious(live)) return done();
    if (!moveEntity(live, bathId, getBroadcast(), query)) return done();

    // Hold the behaviour graph off while they're in there, so the AI doesn't
    // decide mid-visit that this NPC is inexplicably away from home and path
    // them back out. Same lever sleep uses.
    const away = randInt(BATHROOM_MS[0], BATHROOM_MS[1]);
    if (live._ai) live._ai.waitUntil = Date.now() + away;

    setTimeout(() => {
      const back = world.npcs.get(npc.id);
      if (!back || back._dead) return done();
      if (back._ai) back._ai.waitUntil = null;
      // The point of the trip. Rate-limited inside, so a short interval between
      // visits just means this one was only a toilet visit.
      npcWashAtHome(back);
      if (back.zone_id === bathId && !moveEntity(back, zoneId, getBroadcast(), query)) return done();
      if (back.zone_id === zoneId && getZonePlayers(zoneId).length) say(BATHROOM_BACK);
      done();
    }, away);
  }, randInt(BEAT_GAP_MS[0], BEAT_GAP_MS[1]));
}

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

// Asleep, out cold, or otherwise horizontal. A sleeping NPC narrated frying eggs
// is the one thing that breaks the illusion outright, and the engine already
// tracks all three states — this reads them rather than inventing a fourth.
const isBusyBeingUnconscious = (npc) =>
  !!(npc._ai?.homeSleeping || npc._ai?.dosedOut || npc.posture === 'lying');

// Home, off-shift, alive, awake, and not in the middle of something else.
function homebodiesIn(zoneId) {
  const zone = world.zones.get(zoneId);
  if (!zone) return [];
  // A KITCHEN, not a counter. Most of the cast has their own workplace registered
  // as home_zone, and cooking a meal on the shop floor is worse than saying
  // nothing — this is the same dwelling test the engine's passive ticker uses.
  if (!isDwellingZone(getZone(zoneId) || zone)) return [];
  const out = [];
  for (const id of zone.npcs) {
    const npc = world.npcs.get(id);
    if (!npc || npc._dead) continue;
    if (npc.home_zone !== zoneId) continue;        // this is their place, not a shift
    if (npc._combatTargetId) continue;
    if (npc.flags?.no_home_life) continue;         // the opt-out, for anyone it reads wrong on
    if (isBusyBeingUnconscious(npc)) continue;     // asleep in the next room, not making dinner
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
    // ...and re-checks unconsciousness with it: someone who lies down mid-routine
    // (or gets put down) stops cooking there and then rather than narrating the
    // rest of the meal from the floor.
    if (i >= beats.length || !getZonePlayers(zoneId).length
        || !live || live._dead || live.zone_id !== zoneId || live._combatTargetId
        || isBusyBeingUnconscious(live)) {
      activeHome.delete(zoneId);
      startCooldown(zoneId);
      return;
    }
    sendToZone(zoneId, { type: 'ambient', message: `<span class="msg-ambient">${beats[i++]}</span>`, flavour: true });
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

    // Checked first and deliberately rare: a flat with a bathroom gets the one
    // routine that leaves the room. Most homes have no ensuite and fall straight
    // through to the narrated half, exactly as before.
    if (roll < 0.12) {
      const bath = bathroomFor(zoneId);
      if (bath) { playBathroom(zoneId, npc, bath); continue; }
    }

    let beats;
    if (mealtime && roll < 0.45) beats = rand(MEAL).map(l => l.replace('{thing}', pickMeal()));
    else if (roll < 0.8) beats = rand(DRINK).map(l => l.replace('{thing}', pickDrink(timePhase)));
    else beats = rand(TIDY);

    play(zoneId, npc, beats.map(l => l.replace(/\{npc\}/g, npc.name)));
  }
}

// Test seam — regress asserts the catalogues actually yield nouns.
export const _internals = {
  pickMeal, pickDrink, MEAL, DRINK, TIDY, isBusyBeingUnconscious,
  bathroomFor, bathroomOf, BATHROOM_GOING, BATHROOM_BACK,
};
