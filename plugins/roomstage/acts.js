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
// `pocketsOf` is what the room's Pockets list shows: one query, on a click, of what a player carries that ROOM can
// take in first person, each with the ritual it's taken by and the verb that ritual ends in.

import { query } from '../../server/models/db.js';
import { getItem } from '../../server/engine/items-cache.js';
import { drugForItem } from '../../server/engine/drugs.js';

// What each act may have in the hand (client gl/figure-reach.js HELD); the first is what a dose typed in the log shows.
export const ACTS = Object.freeze({
  eat: ['food'], drink: ['bottle', 'can', 'glass'], smoke: ['cigarette', 'joint', 'pipe'],
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
  if (t.restore_hunger || t.consumable) return { act: 'eat', hold: 'food' };
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
  };
}

// A can of spray paint isn't taken, it's used on a wall: the Pockets list offers it, and picking it opens the can
// (plugins/graffiti `spraycan`) on the wall you're facing. No ritual, so nothing is sent as a `room.act`.
const sprayOf = (it) => ((Array.isArray(it?.tags) ? it.tags.includes('spray_paint') : !!it?.tags?.spray_paint) ? { act: 'spray', hold: 'can', verb: 'spraycan' } : null);

// What a player has on them that a room can take in first person: [{ id, item, name, qty, act, hold, verb }].
export async function pocketsOf(playerId) {
  const { rows } = await query(`SELECT id, item_id, quantity, custom_data FROM player_inventory WHERE player_id=$1 AND container_id IS NULL`, [playerId]);
  const out = [];
  for (const r of rows) {
    const it = getItem(r.item_id), how = it && (ritualOf(it, r.item_id) || sprayOf(it));
    if (!how) continue;
    let cd = r.custom_data;
    if (typeof cd === 'string') { try { cd = JSON.parse(cd); } catch { cd = null; } }
    if (cd?.packaged) continue;
    out.push({ id: r.id, item: r.item_id, name: cd?.name || it.name, qty: r.quantity || 1, ...how, verb: how.verb || RITUAL_VERB[how.act] });
  }
  return out.sort((a, b) => a.act.localeCompare(b.act) || a.name.localeCompare(b.name));
}
