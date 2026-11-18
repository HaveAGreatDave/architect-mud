// WHAT A PLAYER IS DOING WITH THEIR HANDS, for everyone else with the room open, and what they have on them to do
// it with.
//
// A player eating, drinking or taking something in a room is seen doing it: the client plays the clip for the act
// (client gl/figure-reach.js puts the thing in their hand and takes it to the mouth or the arm). The act comes two
// ways. Their own client says so as its first-person ritual goes (`room_act`, client stands-hands.js `onAct`), each
// bite, sip, drag or press a new beat so the clip starts again from the top. And a dose taken any other way, typed
// in the log, lands as `player.drugUsed`, which plays the act for the drug's route once.
//
// ⚠ IT'S THE PICTURE'S, AND RAM ONLY. Nothing here doses, feeds or charges anybody: the verbs the ritual ends in do
// that, as they would typed. An act is forgotten after ACT_MS without a beat, and on logout.
//
// `ritualOf` and `sprayOf` say how ROOM takes a carried thing in first person; the Pack (pack.js) stamps each row with
// it, the ritual and the verb that ritual ends in.

import { drugForItem } from '../../server/engine/drugs.js';

// What each act may have in the hand (client gl/figure-reach.js HELD); the first is what a dose typed in the log shows.
export const ACTS = Object.freeze({
  eat: ['food', 'hotdog', 'burger'], drink: ['bottle', 'can', 'glass'], smoke: ['cigarette', 'joint', 'pipe'],
  swallow: ['pill'], inject: ['syringe'], snort: [''], huff: ['rag', 'can'],
});
const ACT_MS = 12_000, BEAT_MS = 250, DOSE_MS = 8_000;

// How a thing is taken in first person, and the verb its ritual ends in.
export const RITUAL_VERB = Object.freeze({ eat: 'eat', drink: 'drink', smoke: 'smoke', inject: 'inject', swallow: 'use', snort: 'use', huff: 'use' });
// A drug's route as an act: drink for anything alcoholic, smoke for anything burnt, else its flags.taken.
export function actOfDrug(drug) {
  const f = drug?.flags || {};
  if (f.alcoholic) return 'drink';
  if (f.smokeable || f.cannabis) return 'smoke';
  return ACTS[f.taken] ? f.taken : 'swallow';
}
// What a food is in the hand: a frank in a bun, a burger, or anything else eaten from the hand (a roll). The stands'
// first-person hands tell them apart the same way (client stands-hands.js foodOf).
export function foodHoldOf(name) {
  const n = String(name || '').toLowerCase();
  if (/frank|hot ?dog|sausage|brat|widowmaker/.test(n)) return 'hotdog';
  if (/burger|slider|patty/.test(n)) return 'burger';
  return 'food';
}
// An item as something ROOM takes in first person, or null: { act, hold }.
export function ritualOf(it, itemId) {
  const t = it?.tags || {};
  if (t.drinkware) return null;
  const drug = drugForItem(itemId);
  if (drug || t.drug) {
    const act = actOfDrug(drug);
    const name = String(it.name || '');
    const hold = act === 'smoke' ? (drug?.flags?.cannabis || /joint|spliff/i.test(name) ? 'joint' : /pipe|rock|crystal/i.test(name) ? 'pipe' : 'cigarette') : act === 'drink' ? (/can\b/i.test(name) ? 'can' : 'bottle') : ACTS[act][0];
    return { act, hold };
  }
  if (t.food_profile === 'liquid' || t.hydrating || t.drink_profile) return { act: 'drink', hold: /can\b/i.test(it.name || '') ? 'can' : 'bottle' };
  if (t.restore_hunger || t.consumable) return { act: 'eat', hold: foodHoldOf(it.name) };
  return null;
}

// `changed(playerId)` resends the people of whatever room has that player in it.
export function createActs({ changed }) {
  const acts = new Map(), lastBeat = new Map();
  function set(playerId, act, hold, ms) {
    const was = acts.get(playerId);
    acts.set(playerId, { act, hold, beat: (was?.beat || 0) + 1, until: Date.now() + ms });
    changed(playerId);
  }
  return {
    // what a player is doing, as room_people carries it, or null
    of(playerId) {
      const a = acts.get(playerId);
      if (!a) return null;
      if (Date.now() > a.until) { acts.delete(playerId); return null; }
      return a;
    },
    // their client's ritual: `act` null when it's put down
    fromClient({ playerId, act, hold }) {
      const now = Date.now();
      if (now - (lastBeat.get(playerId) || 0) < BEAT_MS) return;
      lastBeat.set(playerId, now);
      if (act == null) { if (acts.delete(playerId)) changed(playerId); return; }
      if (!ACTS[act]) return;
      set(playerId, act, ACTS[act].includes(hold) ? hold : ACTS[act][0], ACT_MS);
    },
    // a dose taken some other way: the route's act, once, unless their ritual already shows it
    fromDose({ player, drug }) {
      if (!player?.id || acts.get(player.id)?.until > Date.now()) return;
      const act = actOfDrug(drug);
      set(player.id, act, ACTS[act][0], DOSE_MS);
    },
    forget(playerId) { acts.delete(playerId); lastBeat.delete(playerId); },
    // an act a plugin gives them for a moment (plugins/strippers: a note held out to a dancer)
    play(playerId, act, hold, ms) { set(playerId, act, hold, ms); },
  };
}

// A can of spray paint isn't taken, it's used on a wall: the Pack offers it (pack.js), and picking it opens the can
// (plugins/graffiti `spraycan`) on the wall you're facing. No ritual, so nothing is sent as a `room.act`.
export const sprayOf = (it) => ((Array.isArray(it?.tags) ? it.tags.includes('spray_paint') : !!it?.tags?.spray_paint) ? { act: 'spray', hold: 'can', verb: 'spraycan' } : null);
