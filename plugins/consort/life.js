// plugins/consort/life.js
//
// A consort's life at home, after the pets plugin's cat: a day of their own, needs
// that their keeper keeps up, a greeting at the door, and touch by spot.
//
//   • The day is client/shared/consort-life.js (consortDay), from their id and the
//     game clock. This file says it in the room as it changes, while somebody's
//     there to hear it, and only in their own billet.
//   • Hunger and loneliness are consortNeeds, worked out from two stamps when read:
//     when they last ate (`takeout`, a meal sent up, paid by the keeper) and when
//     their keeper last spent time with them (in the room, or a `caress`). Both
//     stamps live on the live NPC; ledger consorts also keep them on their
//     player_consorts row, flushed in one batched UPDATE every ten minutes.
//   • Hungry, they say so at the door and go through the cupboards. Starving, the
//     seduction stops (consortTick asks `lifeBlocksArousal`). Lonely, the greeting
//     is cooler and the first touch is met with "about time".
//   • `caress <name> [on the <spot>]`: hair, cheek, neck, shoulder, back, hand,
//     waist, thigh. Every touch adds its spot's weight to points that fade; past
//     ENOUGH_AT they hold your hand still, past AWAY_AT they move it off and want a
//     minute. The warm spots raise arousal for the existing tick. Only their keeper
//     gets anything but a refusal. Asleep, a touch wakes them for an hour and a half.
//
// All beats are RAM. Nothing here is MIS-explicit: the explicit path stays index.js's.

import { world, getZone, getZonePlayers, getZoneNpcs, getAllLivePlayers } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { on, emit } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { query } from '../../server/models/db.js';
import { gameMinutes } from '../../server/engine/clock.js';
import { renderLine } from './archetypes.js';
import { consortDay, consortNeeds } from '../../client/shared/consort-life.js';

const isConsort = (npc) => !!npc?.flags?.consort && !npc._dead;
let AROUSAL = new Map();
// index.js owns arousal; it hands the map over at load so this file can warm it.
export function bindLife({ arousal }) { if (arousal) AROUSAL = arousal; }

const R = (line, npc) => renderLine(line, npc);
const pickBy = (arr, seed) => arr[Math.abs(hashStr(seed)) % arr.length];
function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
const gameDay = () => Math.floor(Date.now() / 86_400_000);
const atHome = (npc) => npc.zone_id && npc.zone_id === npc.home_zone;
const isKeeper = (player, npc) => !!player?.handle && player.handle === npc.flags?.devoted_to;

// ── stamps ──────────────────────────────────────────────────────────────────────
// Boot leaves an authored consort (no ledger row) fed and seen, rather than starving.
export function fedAt(npc) { return npc._fedAt ?? (npc._fedAt = Date.now()); }
export function seenAt(npc) {
  return Math.max(npc._seenAt ?? (npc._seenAt = Date.now()), npc._lastSeenKeeper || 0, npc._caredAt || 0);
}
export const needsOf = (npc, now = Date.now()) => consortNeeds(fedAt(npc), seenAt(npc), now);

// Woken by a touch, they stay up a while whatever the clock says.
const WOKEN_MS = 90 * 60_000;
export function dayOf(npc, now = Date.now()) {
  const d = consortDay(npc.id, gameMinutes(), gameDay());
  if (d.asleep && now - (npc._wokenAt || 0) < WOKEN_MS) return { act: 'screen', spot: 'sofa', asleep: false, woken: true };
  return d;
}
export const consortAsleep = (npc) => dayOf(npc).asleep;
// The existing tick asks this before it warms anybody up.
export function lifeBlocksArousal(npc) { return consortAsleep(npc) || needsOf(npc).starving; }

// ── the day, said ───────────────────────────────────────────────────────────────
const ACT_LINE = {
  sleep:    ['§ is asleep, curled on {their} side with the covers pulled up.', '§ has gone to bed. {They} {breathe} slow and even.'],
  wake:     ['§ is up, in yesterday\'s shirt, waiting on the kettle.', '§ wanders into the kitchen half awake and makes coffee.'],
  wash:     ['§ goes to wash. The water runs for a while.', '§ is in the bathroom, getting ready for the day.'],
  tidy:     ['§ picks things up off the floor and puts them where they go.', '§ straightens the cushions and wipes down the side.'],
  read:     ['§ settles into a chair with a book.', '§ is reading, feet tucked under {them}.'],
  exercise: ['§ clears some floor and does push-ups, counting under {their} breath.', '§ stretches out on the floor, slow and careful.'],
  nap:      ['§ lies down for a nap in the middle of the afternoon.', '§ dozes off on top of the covers.'],
  window:   ['§ stands at the window, watching the street.', '§ leans on the sill and looks out at the weather.'],
  lunch:    ['§ makes a sandwich and eats it standing up.', '§ has lunch at the counter.'],
  cook:     ['§ starts on dinner. Something with onions.', '§ is cooking, a tea towel over {their} shoulder.'],
  eat:      ['§ sits down to eat.', '§ eats dinner and pushes the plate away when {they}\'re done.'],
  screen:   ['§ puts the screen on and curls up on the sofa.', '§ is on the sofa, half watching something.'],
  bath:     ['§ runs a bath.', '§ is in the bath with the door open.'],
};
// Hungry, what would have been a meal or a free hour is a search of the cupboards.
const HUNGRY_LINE = ['§ goes through the cupboards and finds nothing worth eating.', '§ opens the fridge, looks for a long time and shuts it again.'];
const STARVING_LINE = ['§ sits on the kitchen floor with {their} back to the cupboard. It has been a long time since {they} ate.'];
const SAID = new Map();   // npc id → last act said

function narrate() {
  const now = Date.now();
  for (const npc of world.npcs.values()) {
    if (!isConsort(npc) || !atHome(npc)) continue;
    const zone = world.zones.get(npc.zone_id);
    if (!zone?.players?.size) continue;
    if (npc._combatTargetId || npc.posture === 'lying') continue;
    // the keeper in the room counts as company
    if (getZonePlayers(npc.zone_id).some(p => isKeeper(p, npc))) npc._lastSeenKeeper = now;
    const d = dayOf(npc, now), n = needsOf(npc, now);
    const key = n.starving ? 'starving' : (n.hungry && !d.asleep && /lunch|eat|cook|read|window|wake/.test(d.act)) ? 'hungry' : d.act;
    if (SAID.get(npc.id) === key) continue;
    const first = !SAID.has(npc.id);
    SAID.set(npc.id, key);
    if (first) continue;   // walking in on them is the room description's, not a change
    const pool = key === 'starving' ? STARVING_LINE : key === 'hungry' ? HUNGRY_LINE : ACT_LINE[key];
    if (pool) sendToZone(npc.zone_id, { type: 'zone_event', message: `<span class="text-dim">${R(pickBy(pool, npc.id + key + gameDay()), npc)}</span>` });
  }
}

// ── the door ────────────────────────────────────────────────────────────────────
const GREET = ['§ hears you at the door and comes to meet you.', '§ looks up as you come in, then gets up and comes over.', '§ is there before you have the door shut, and takes your coat.'];
const GREET_LONELY = ['§ looks up when you come in and doesn\'t get up straight away. "Oh. You\'re back."', '§ comes to the door slowly. "I wondered if you still lived here."'];
const GREET_HUNGRY = ['§ meets you at the door. "There\'s nothing to eat in this place. Nothing."', '§ is at the door before you are. "Please tell me you brought food."'];
const ASLEEP_AT_DOOR = ['§ is asleep and doesn\'t stir as you come in.', 'You can hear § breathing in the dark. {They}\'re asleep.'];
const GREET_THEM = '§ gets up to meet $who at the door.';

function onEntered({ actor, zone }) {
  if (!actor?.handle || !zone) return;
  const now = Date.now();
  for (const npc of getZoneNpcs(zone)) {
    if (!isConsort(npc) || !atHome(npc) || !isKeeper(actor, npc)) continue;
    if (now - (npc._greetedAt || 0) < 5 * 60_000) continue;    // back and forth through the door isn't a reunion
    npc._greetedAt = now;
    const d = dayOf(npc, now), n = needsOf(npc, now), seed = npc.id + ':' + Math.floor(now / 60000);
    const pool = d.asleep ? ASLEEP_AT_DOOR : n.hungry ? GREET_HUNGRY : n.isLonely ? GREET_LONELY : GREET;
    setTimeout(() => {
      if (actor.current_zone !== zone) return;
      sendToPlayer(actor.id, { type: 'zone_event', message: R(pickBy(pool, seed), npc) });
      if (!d.asleep) sendToZone(zone, { type: 'zone_event', message: R(GREET_THEM, npc).replace('$who', actor.handle) }, actor.id);
    }, 900).unref?.();
    npc._lastSeenKeeper = now;
  }
}

// ── takeout ─────────────────────────────────────────────────────────────────────
export const MEAL_COST = 15;
const ATE = ['A courier brings a bag up. § eats like {they} hadn\'t realised how hungry {they} {was}.', 'The food comes up warm. § eats it at the counter and says thank you with {their} mouth full.'];
const NOT_HUNGRY = '§ isn\'t hungry. {They} ate not long ago.';

export async function cmdTakeout(args, raw, player) {
  if (!player) return { type: 'noop' };
  const here = getZoneNpcs(player.current_zone).filter(n => isConsort(n) && isKeeper(player, n));
  if (!here.length) return { type: 'error', message: 'There\'s nobody of yours here to order for.' };
  const want = (args || []).filter(a => !/^(for|to)$/i.test(a)).join(' ').toLowerCase();
  const pickd = want ? here.filter(n => n.name.toLowerCase().startsWith(want) || n.name.toLowerCase().includes(want)) : here;
  if (!pickd.length) return { type: 'error', message: `None of yours here goes by "${want}".` };
  const now = Date.now();
  const hungry = pickd.filter(n => needsOf(n, now).hunger > 0.05);
  if (!hungry.length) return { type: 'output', message: pickd.map(n => R(NOT_HUNGRY, n)).join(' ') };
  const cost = MEAL_COST * hungry.length;
  const res = await query(
    `UPDATE players SET bank_credits = bank_credits - LEAST(bank_credits, $1),
            credits = credits - GREATEST(0, $1 - LEAST(bank_credits, $1))
      WHERE id = $2 AND bank_credits + credits >= $1 RETURNING credits, bank_credits`, [cost, player.id]);
  if (!res.rowCount) return { type: 'error', message: `A meal sent up is ${MEAL_COST}₵ each, ${cost}₵ in all, and you can't cover it.` };
  player.credits = res.rows[0].credits; player.bank_credits = res.rows[0].bank_credits;
  for (const n of hungry) n._fedAt = now;
  const ledger = hungry.filter(n => n.flags?.consort_ledger).map(n => n.id);
  if (ledger.length) query('UPDATE player_consorts SET last_fed_at=$1 WHERE id = ANY($2)', [now, ledger]).catch(e => console.error('[consort] fed write:', e.message));
  const lines = hungry.map(n => R(pickBy(ATE, n.id + now), n)).join(' ');
  sendToZone(player.current_zone, { type: 'zone_event', message: `${player.handle} has food sent up.` }, player.id);
  return { type: 'output', message: `You order food in: ${cost}₵.<br>${lines}` };
}

// ── caress ──────────────────────────────────────────────────────────────────────
const SPOTS = { hair: 0.3, cheek: 0.3, hand: 0.2, shoulder: 0.35, back: 0.45, neck: 0.7, waist: 0.6, thigh: 0.9 };
const SPOT_OF = { face: 'cheek', cheeks: 'cheek', head: 'hair', hands: 'hand', fingers: 'hand', shoulders: 'shoulder', arm: 'shoulder', spine: 'back', throat: 'neck', hip: 'waist', hips: 'waist', side: 'waist', leg: 'thigh', knee: 'thigh', thighs: 'thigh' };
const WARMTH = { neck: 5, waist: 4, thigh: 7, back: 2, cheek: 1, hair: 1, shoulder: 1, hand: 1 };
const FADE_MS = 45_000, ENOUGH_AT = 3.2, AWAY_AT = 4.6, AWAY_MS = 60_000;
const TOUCHES = new Map();   // npc id → { pts, at }
const CARESS_SAID = new Map();   // npc id → { key, at }: what was last said, so steady touching isn't a line a second

const CARESS = {
  hair:     ['You run your fingers through §\'s hair. {They} {lean} into it with {their} eyes shut.', '§ tips {their} head into your hand while you stroke {their} hair.'],
  cheek:    ['You touch §\'s cheek. {They} {turn} and {kiss} your palm.', '§ leans {their} face into your hand and smiles.'],
  hand:     ['You take §\'s hand. {They} {hold} on.', '§ laces {their} fingers through yours.'],
  shoulder: ['You rest a hand on §\'s shoulder. {They} {settle} back against you.', 'You rub §\'s shoulders. {They} {let} out a long breath.'],
  back:     ['You run a hand down §\'s back. {They} {move} closer.', 'You rub slow circles on §\'s back. {They} {lean} into you.'],
  neck:     ['You touch the side of §\'s neck. {Their} breath catches.', 'You trace the back of §\'s neck. {They} {shiver} and {look} at you.'],
  waist:    ['You put your hands on §\'s waist. {They} {step} in close.', 'You pull § in by the waist. {They} {look} up at you and {wait}.'],
  thigh:    ['You rest a hand on §\'s thigh. {They} {go} quiet and {look} at you.', 'You run a hand up §\'s thigh. {They} {breathe} out slowly.'],
};
const CARESS_THEM = '$who touches §.';
const ENOUGH = ['§ catches your hand and holds it still. "Gently."', '§ puts {their} hand over yours to keep it where it is.'];
const AWAY = '§ moves your hand off and sits back. "Give me a minute."';
const STILL_AWAY = '§ isn\'t in the mood just now.';
const NOT_YOURS = '§ steps back out of reach. "I\'m not yours to touch."';
const WAKE = '§ stirs, opens {their} eyes and smiles at you sleepily.';
const ABOUT_TIME = '§ takes your hand and doesn\'t let go of it. "About time."';
const VERB_FIX = { shiver: 'shivers', step: 'steps' };   // agreement the shared VERBS table doesn't carry

const SPOT_RE = /^(.*?)(?:'s)?\s+(?:(?:on|along|by|at|down)\s+)?(?:(?:the|his|her|their|its)\s+)?(hair|head|cheeks?|face|hands?|fingers|shoulders?|arm|back|spine|neck|throat|waist|hips?|side|thighs?|leg|knee)$/i;

export function cmdCaress(args, raw, player) {
  if (!player) return { type: 'noop' };
  let target = (args || []).join(' ').trim(), spot = null;
  if (!target) return { type: 'error', message: 'Caress whom?' };
  const m = target.match(SPOT_RE);
  if (m && m[1]) { target = m[1].replace(/'s$/i, '').trim(); const s = m[2].toLowerCase(); spot = SPOTS[s] ? s : SPOT_OF[s]; }
  const want = target.toLowerCase();
  const npc = getZoneNpcs(player.current_zone).find(n => isConsort(n)
    && (n.name.toLowerCase() === want || n.name.toLowerCase().split(/\s+/).some(w => w.startsWith(want))));
  if (!npc) return { type: 'error', message: `There's no "${target}" here.` };
  return caress(player, npc, spot || 'hand');
}

export function caress(player, npc, spot, now = Date.now()) {
  const fix = (s) => R(s, npc).replace(/\{(\w+)\}/g, (x, t) => VERB_FIX[t] || x);
  const zone = player.current_zone;
  if (!isKeeper(player, npc)) {
    sendToZone(zone, { type: 'zone_event', message: `${player.handle} reaches for ${npc.name}, who steps away.` }, player.id);
    return { type: 'output', message: fix(NOT_YOURS) };
  }
  if (now - (npc._awayAt || 0) < AWAY_MS) return { type: 'output', message: fix(STILL_AWAY) };
  const wasLonely = needsOf(npc, now).isLonely;
  npc._caredAt = now; npc._lastSeenKeeper = now;
  if (consortAsleep(npc)) { npc._wokenAt = now; return { type: 'output', message: fix(WAKE) }; }
  const t = TOUCHES.get(npc.id);
  const pts = (t ? t.pts * Math.pow(0.5, (now - t.at) / FADE_MS) : 0) + SPOTS[spot];
  TOUCHES.set(npc.id, { pts, at: now });
  if (TOUCHES.size > 500) TOUCHES.clear();
  if (pts >= AWAY_AT) {
    TOUCHES.delete(npc.id); npc._awayAt = now;
    return { type: 'output', message: fix(AWAY) };
  }
  AROUSAL.set(npc.id, Math.min(100, (AROUSAL.get(npc.id) || 0) + (WARMTH[spot] || 1)));
  tickledNow(npc, now);
  sendToZone(zone, { type: 'zone_event', message: fix(CARESS_THEM).replace('$who', player.handle) }, player.id);
  if (wasLonely) return { type: 'output', message: fix(ABOUT_TIME) };
  // the same again, soon (the mouse in ROOM sends about once a second): the picture says it
  const step = pts >= ENOUGH_AT ? 'enough' : spot, said = CARESS_SAID.get(npc.id);
  if (said && said.key === step && now - said.at < 9000) return { type: 'noop' };
  CARESS_SAID.set(npc.id, { key: step, at: now });
  if (CARESS_SAID.size > 500) CARESS_SAID.clear();
  if (pts >= ENOUGH_AT) return { type: 'output', message: fix(pickBy(ENOUGH, npc.id + Math.floor(now / 5000))) };
  return { type: 'output', message: fix(pickBy(CARESS[spot], npc.id + spot + Math.floor(now / 4000))) };
}

// ── in ROOM ─────────────────────────────────────────────────────────────────────
// The Room Stage asks of every NPC it draws (`room.npcTouch`, sync): a consort answers with their keeper's player id,
// which is who the mouse may tickle them for, and `tickled` while a touch is fresh, so the whole room sees them laugh.
// The room's people go out again when a tickle starts, at most every two seconds while it lasts, and once after.
const TICKLED_MS = 2500;
function tickledNow(npc, now) {
  const fresh = now - (npc._tickledAt || 0) > TICKLED_MS;
  npc._tickledAt = now;
  if (fresh || now - (npc._tickleSent || 0) > 2000) {
    npc._tickleSent = now;
    emit('room.peopleChanged', { zoneId: npc.zone_id });
    setTimeout(() => { if (Date.now() - npc._tickledAt >= TICKLED_MS) emit('room.peopleChanged', { zoneId: npc.zone_id }); }, TICKLED_MS + 100).unref?.();
  }
}
export function npcTouch(npc) {
  if (!isConsort(npc)) return undefined;
  const keeper = getAllLivePlayers().find(p => p.handle === npc.flags?.devoted_to);
  if (!keeper) return undefined;
  return { keeper: keeper.id, ...(Date.now() - (npc._tickledAt || 0) < TICKLED_MS ? { tickled: true } : {}) };
}

// ── persistence ─────────────────────────────────────────────────────────────────
// Ledger consorts keep when they were last with their keeper across a restart.
// One UPDATE for all of them, every ten minutes, only for the ones that moved.
const FLUSHED = new Map();
async function flushSeen() {
  const ids = [], at = [];
  for (const npc of world.npcs.values()) {
    if (!isConsort(npc) || !npc.flags?.consort_ledger) continue;
    const s = seenAt(npc);
    if (FLUSHED.get(npc.id) === s) continue;
    ids.push(npc.id); at.push(s); FLUSHED.set(npc.id, s);
  }
  if (!ids.length) return;
  await query(`UPDATE player_consorts c SET last_seen_at = v.at
                 FROM unnest($1::text[], $2::bigint[]) AS v(id, at) WHERE c.id = v.id`, [ids, at]);
}

on('zone.entered', (e) => { try { onEntered(e); } catch (err) { console.error(`[consort] door: ${err.message}`); } });
schedule('1m', () => { try { narrate(); } catch (e) { console.error(`[consort] life: ${e.message}`); } });
schedule('10m', () => flushSeen().catch(e => console.error(`[consort] seen flush: ${e.message}`)));

export const _test = { CARESS_SAID, narrate, onEntered, SAID, TOUCHES, SPOTS, ENOUGH_AT, AWAY_AT, flushSeen, ACT_LINE };
