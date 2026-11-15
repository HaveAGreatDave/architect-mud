// PETS (docs/proposals/pets.md): an animal that lives in somebody's home.
//
// A pet is two rows. Its NPC (npcs, flags.pet naming the pet's row) is the animal in the text world: its name, its
// description, its home, and everything the engine already does for an NPC: it's listed in the room, `look` and
// `pet` work on it, and boot puts it home. Its row in `pets` is the body and nature: the cat kit's numbers
// (client/game/js/panels/gl/cat-kit.js) and its personality. The Room Stage asks this plugin, per NPC, whether the
// NPC is an animal (`roomstage.npcBeast`); a pet answers with its body, so the stage draws a cat where it would have
// drawn a person.
//
// What a cat does on its own is worked out from its id and the clock (client/shared/cat-life.js), the same here and
// on every client, so it costs no messages. What it does about people is a BEAT, kept here in RAM and sent with the
// beast: { act, since, who, door }.
//
//   greet   somebody comes in: unless it's asleep (and mostly even then), it gets up, trots to the door they came
//           through, winds round their legs and sits looking up at them, waiting to be stroked. It gives up after a
//           minute.
//   petted  somebody strokes it: it pushes into the hand and purrs.
//   cross   somebody kept going after it said enough: the petting ladder (below), run in seconds.
//
// Petting is the same refusal ladder Cathode has (plugins/strays), in seconds instead of visits: a stroke or two is
// welcome; keep going and the tail tip starts to twitch, then the ears go sideways and it gives you a look, then it
// growls, swats your hand and walks off.
//
// HIS DAY IN WORDS. What he's doing on his own is said in the room as it changes (`narrate`, every 5 s while somebody's
// there to hear it), from the same catLife the picture plays, with the piece he's up on (catPerchOf) and his goes at
// his bowls (catAtBowls), so the text and the 3D cat never disagree about what he's doing or where.
//
// HIS BOWLS. A feeding station is a piece of furniture with flags.pet_bowls naming the pet: a food dish that holds two
// meals and a water bowl that holds a day's water. When each was last filled is the `pet_bowls` row; how full it is
// now is worked out from that and his meal times (client/shared/cat-life.js), so nothing is written while he eats.
// `refill` fills both (or one) at a small price for what's gone, taken there and then.
//
// Nothing here knows any particular cat or owner. Scrappy is the first row and nothing more.
import { query } from '../../server/models/db.js';
import { on, emit } from '../../server/engine/events.js';
import { getZone, getZoneNpcs, getZonePlayers, world } from '../../server/engine/world.js';
import { allExits } from '../../server/engine/exits.js';
import { sendToZone, sendToPlayer } from '../../server/engine/messaging.js';
import { getBirdClock } from '../../server/engine/environment.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { schedule } from '../../server/engine/scheduler.js';
import { catLife, catPerchOf, catSettle, perchWord, catAtBowls, bowlLevel, missedSince, DAY_MS } from '../../client/shared/cat-life.js';
import { roomLayout } from '../../client/shared/room-layout.js';
import { specOf, roomPieces, mainOf } from '../roomstage/index.js';

// pet id → { id, npcId, species, look, personality }, and NPC id → the same
const PETS = new Map(), BY_NPC = new Map();

export async function loadPets() {
  const { rows } = await query('SELECT id, npc_id, species, look, personality FROM pets');
  PETS.clear(); BY_NPC.clear();
  for (const r of rows) {
    const p = { id: r.id, npcId: r.npc_id, species: r.species, look: r.look || {}, personality: r.personality || {} };
    PETS.set(p.id, p); BY_NPC.set(p.npcId, p);
  }
  return PETS.size;
}

/** The pet an NPC is, or null. Sync and RAM-only. */
export function petOfNpc(npc) {
  if (!npc) return null;
  return BY_NPC.get(npc.id) || (npc.flags?.pet ? PETS.get(npc.flags.pet) || null : null);
}

// ── beats ─────────────────────────────────────────────────────────────────────────────────────────
// NPC id → { act, since, who, door }. How long each lasts is the client's too (gl/room-beasts.js BEAT_MS).
const BEATS = new Map();
const BEAT_MS = { greet: 75000, petted: 22000, cross: 2800 };
const timers = new Map();   // NPC id → the timeout that ends its beat
function setBeat(npc, beat, zoneId) {
  clearTimeout(timers.get(npc.id));
  if (beat) BEATS.set(npc.id, beat); else BEATS.delete(npc.id);
  // tell anybody with the room open (plugins/roomstage sends the beasts again)
  emit('pet.beat', { npcId: npc.id, zoneId, beat: beat || null });
}
function beatOf(npcId, now = Date.now()) {
  const b = BEATS.get(npcId);
  if (b && now - b.since < (BEAT_MS[b.act] || 0)) return b;
  if (b) BEATS.delete(npcId);
  return null;
}
function later(npc, ms, fn) {
  clearTimeout(timers.get(npc.id));
  const t = setTimeout(() => { timers.delete(npc.id); fn(); }, ms);
  t.unref?.();
  timers.set(npc.id, t);
}

// a line for somebody just come in, after the room's own description rather than above it
const soon = (actor, zone, message) => { setTimeout(() => { if (actor.current_zone === zone) sendToPlayer(actor.id, { type: 'zone_event', message }); }, 900).unref?.(); };

// ── the words ─────────────────────────────────────────────────────────────────────────────────────
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
const pickOf = (list, seed) => list[hashOf(seed) % list.length];
function words(npc) {
  const f = npc.sex === 'female', m = npc.sex === 'male';
  return { name: npc.name, he: f ? 'she' : m ? 'he' : 'it', He: f ? 'She' : m ? 'He' : 'It', his: f ? 'her' : m ? 'his' : 'its', him: f ? 'her' : m ? 'him' : 'it' };
}
const fill = (s, w, extra = {}) => s.replace(/\$(\w+)/g, (_, k) => (k in extra ? extra[k] : w[k] ?? ''));

const GREET_YOU = [
  '$name gets up and trots over to the door, tail straight up, and winds round your legs.',
  '$name comes to meet you at the door, tail up, and rubs $his cheek along your shin.',
  '$name hears the door and is there before it shuts, purring and leaning on your ankles.',
  'A trill from across the room. $name trots over and walks a figure of eight round your feet.',
];
const GREET_THEM = [
  '$name gets up and trots over to meet $who at the door.',
  '$name goes to the door to say hello to $who, tail up.',
];
const WAIT_YOU = [
  '$name sits down in front of you and looks up, waiting.',
  '$name sits at your feet and meows up at you. $He wants a stroke.',
  '$name plants $himself on your feet and stares up at you.',
];
const ASLEEP = [
  '$name lifts $his head$from when you come in, looks at you, and goes back to sleep.',
  "$name opens one eye$from, sees it's you, and shuts it again.",
];
const NOT_BOTHERED = [
  '$name looks up at you$from, then carries on with what $he was doing.',
  '$name blinks at you slowly$from. That counts as hello.',
];
const GIVE_UP = ['$name gives up on you and wanders off.', '$name decides you\'re no fun and goes back to what $he was doing.'];
const PETTED_YOU = [
  'You stroke $name. $He pushes $his head up into your hand and starts purring.',
  'You scratch $name behind the ears. $He leans into it, eyes half shut, purring.',
  'You run a hand down $name\'s back. $He arches into it and purrs.',
  'You rub $name under the chin. $He tips $his head right back for more.',
];
const PETTED_THEM = ['$who strokes $name, who purrs loud enough to hear.', '$who scratches $name behind the ears.'];
// the ladder: each stroke past the second is a sign it's nearly enough
const LADDER = [
  'You stroke $name again. The tip of $his tail starts to twitch.',
  'You keep stroking $name. $His ears turn out sideways and $he gives you a look.',
];
const CROSS_YOU = '$name growls, swats your hand and stalks off.';
const CROSS_THEM = '$name growls at $who, swats at $his hand and stalks off.';

// ── somebody comes in ────────────────────────────────────────────────────────────────────────────
// Whether a pet gets up to greet whoever just came in, and which door they came through.
function onEntered({ actor, zone, from }) {
  if (!actor?.handle || !zone) return;
  const npcs = getZoneNpcs(zone);
  if (!npcs?.length) return;
  const now = Date.now(), hour = getBirdClock().hour;
  for (const npc of npcs) {
    const p = petOfNpc(npc);
    if (!p) continue;
    const b = beatOf(npc.id, now);
    // busy with somebody else, or being cross
    if (b && (b.act === 'cross' || (b.who !== actor.id && now - b.since < 20000))) continue;
    const w = words(npc), seed = npc.id + ':' + actor.id + ':' + Math.floor(now / 60000);
    const life = catLife(npc.id, now, hour, p.personality);
    const out = p.personality.outgoing ?? 0.5, r = (hashOf(seed) % 1000) / 1000;
    // where he is as you come in: up on something, or across the room
    const up = cachedLayout(zone) ? catPerchOf(cachedLayout(zone), life, p.look) : null;
    const where = { from: up ? ` from the ${perchWord(up)}` : ' from across the room' };
    // at his bowls he's busy, and says so
    if (catAtBowls(npc.id, now, bowlsOf(p))) continue;
    if (life.asleep && r > 0.4) { soon(actor, zone, fill(pickOf(ASLEEP, seed), w, where)); continue; }
    if (r > 0.2 + 0.75 * out) { soon(actor, zone, fill(pickOf(NOT_BOTHERED, seed), w, where)); continue; }
    const door = allExits(getZone(zone)).find((e) => e.target === from)?.dir || null;
    setBeat(npc, { act: 'greet', since: now, who: actor.id, door }, zone);
    // the line after the room's own description, not above it
    const since = now;
    setTimeout(() => {
      if (BEATS.get(npc.id)?.since !== since || actor.current_zone !== zone) return;
      sendToPlayer(actor.id, { type: 'zone_event', message: fill(pickOf(GREET_YOU, seed), w) });
      sendToZone(zone, { type: 'zone_event', message: fill(pickOf(GREET_THEM, seed), w, { who: actor.handle }) }, actor.id);
    }, 900).unref?.();
    // sat at their feet, then giving up on them
    setTimeout(() => {
      if (BEATS.get(npc.id)?.since !== since || actor.current_zone !== zone) return;
      sendToPlayer(actor.id, { type: 'zone_event', message: fill(pickOf(WAIT_YOU, seed + ':w'), w) });
    }, 7000).unref?.();
    later(npc, 60000, () => {
      if (BEATS.get(npc.id)?.since !== since) return;
      setBeat(npc, null, zone);
      sendToZone(zone, { type: 'zone_event', message: fill(pickOf(GIVE_UP, seed), w) });
    });
  }
}

// ── stroking it ──────────────────────────────────────────────────────────────────────────────────
// How much he's had, per person, as points that fade (a half-life of STROKE_FADE_MS): every stroke adds its spot's
// weight. A plain `pet` is a point; where you stroke him (`stroke`, or the mouse in ROOM) weighs what that spot is to a
// cat: the chin and cheeks hardly count, so he'll take a long scratch there; the back wears thin quicker; the tail
// and his paws annoy him; the belly is a trap. The ladder is the same whatever the spot: past LADDER_AT the tail tip
// twitches, past LOOK_AT the ears go out and he gives you a look, past CROSS_AT he swats and walks off.
// NPC id + player id → { pts, at }
const STROKES = new Map();
const STROKE_FADE_MS = 36000, LADDER_AT = 2.6, LOOK_AT = 3.6, CROSS_AT = 4.6;
const SPOT_WEIGHT = { chin: 0.22, cheek: 0.22, head: 0.3, ears: 0.35, back: 0.6, tail: 1.5, paws: 1.4, belly: 3 };
function strokeBy(npc, player, weight, now = Date.now()) {
  const k = npc.id + ':' + player.id, s = STROKES.get(k);
  const pts = (s ? s.pts * Math.pow(0.5, (now - s.at) / STROKE_FADE_MS) : 0) + weight;
  STROKES.set(k, { pts, at: now });
  if (STROKES.size > 500) STROKES.clear();
  return pts;
}
// too much: the swat, and off
function goCross(live, player, zoneId, now, w) {
  STROKES.delete(live.id + ':' + player.id);
  setBeat(live, { act: 'cross', since: now, who: player.id, door: null }, zoneId);
  later(live, BEAT_MS.cross, () => setBeat(live, null, zoneId));
  sendToZone(zoneId, { type: 'zone_event', message: fill(CROSS_THEM, w, { who: player.handle }) }, player.id);
  return { type: 'output', message: fill(CROSS_YOU, w) };
}
function onPetAttempt({ player, npc, zoneId, spot }) {
  const p = petOfNpc(npc);
  if (!p) return undefined;
  if (spot && SPOT_WEIGHT[spot]) return petSpot(player, world.npcs.get(npc.id) || npc, zoneId, spot);
  const live = world.npcs.get(npc.id) || npc, w = words(live), now = Date.now();
  const pts = strokeBy(live, player, 1, now), seed = live.id + ':' + player.id + ':' + Math.floor(now / 1000);
  if (pts >= CROSS_AT) return goCross(live, player, zoneId, now, w);
  setBeat(live, { act: 'petted', since: now, who: player.id, door: null }, zoneId);
  later(live, BEAT_MS.petted, () => setBeat(live, null, zoneId));
  emit('npc.petted', { actor: player, npc, zoneId });
  sendToZone(zoneId, { type: 'zone_event', message: fill(pickOf(PETTED_THEM, seed), w, { who: player.handle }) }, player.id);
  return { type: 'output', message: fill(pts >= LOOK_AT ? LADDER[1] : pts >= LADDER_AT ? LADDER[0] : pickOf(PETTED_YOU, seed), w) };
}

// `pet <cat> <where>`: the engine's `pet` peels the spot off and hands it over (chin, cheek, head, ears, back, tail,
// paws, belly). ROOM sends it as you stroke him with the mouse (panels/room-stage.js), about once a second while you
// keep going, so it says something only when what he does changes, or now and then; the rest is a `noop` and the
// picture carries it.
const STROKE_YOU = {
  chin: ['You scratch $name under the chin. $He tips $his head right back and purrs.', 'You rub under $name\'s chin. $His eyes close and the purr gets louder.'],
  cheek: ['You rub $name\'s cheek. $He leans $his whole face into your hand, purring.', '$name rubs $his cheek along your fingers, one way and then the other.'],
  head: ['You stroke the top of $name\'s head. $He pushes up into your hand.', '$name butts $his head up into your palm and purrs.'],
  ears: ['You rub the base of $name\'s ear. $He leans into it, eyes half shut.', 'You scratch behind $name\'s ear. A hind foot twitches in sympathy.'],
  back: ['You run your hand down $name\'s back. $He arches up into it and $his tail goes up.', 'You stroke $name from head to tail. $He leans into the stroke, purring.'],
  tail: ['You stroke $name\'s tail. It slips out of your hand and the tip starts to flick.', 'You touch $name\'s tail. $He looks round at your hand.'],
  paws: ['You touch $name\'s paw. $He pulls it back and looks at you.', 'You hold $name\'s paw. $He takes it back, toes spread.'],
  belly: ['You touch $name\'s belly. $He goes very still.'],
};
const STROKE_THEM = {
  chin: '$who scratches $name under the chin.', cheek: '$who rubs $name\'s cheek.', head: '$who strokes $name\'s head.', ears: '$who scratches behind $name\'s ear.',
  back: '$who strokes $name\'s back.', tail: '$who strokes $name\'s tail.', paws: '$who touches $name\'s paw.', belly: '$who goes for $name\'s belly.',
};
const BELLY_TRAP = '$name grabs your hand with all four paws and bites it, not hard, then lets go and stalks off.';
const BELLY_TRAP_THEM = '$name grabs $who\'s hand with all four paws, bites, and stalks off.';
// what was last said to whom, so steady stroking isn't a line a second: NPC id + player id → { key, at }
const STROKE_SAID = new Map();
const STROKE_QUIET_MS = 9000;
function petSpot(player, live, zone, spot) {
  const w = words(live), now = Date.now(), k = live.id + ':' + player.id;
  if (beatOf(live.id, now)?.act === 'cross') return { type: 'output', message: fill('$name is having none of it.', w) };
  // the belly: now and then he puts up with it once; mostly it's the trap
  if (spot === 'belly' && (hashOf(k + ':' + Math.floor(now / 60000)) % 10 >= 3 || (STROKES.get(k)?.pts || 0) > 0.5)) {
    STROKES.delete(k);
    setBeat(live, { act: 'cross', since: now, who: player.id, door: null, spot }, zone);
    later(live, BEAT_MS.cross, () => setBeat(live, null, zone));
    sendToZone(zone, { type: 'zone_event', message: fill(BELLY_TRAP_THEM, w, { who: player.handle }) }, player.id);
    return { type: 'output', message: fill(BELLY_TRAP, w) };
  }
  const pts = strokeBy(live, player, SPOT_WEIGHT[spot], now);
  if (pts >= CROSS_AT) { STROKE_SAID.delete(k); return goCross(live, player, zone, now, w); }
  setBeat(live, { act: 'petted', since: now, who: player.id, door: null, spot }, zone);
  later(live, BEAT_MS.petted, () => setBeat(live, null, zone));
  emit('npc.petted', { actor: player, npc: live, zoneId: zone, spot });
  const step = pts >= LOOK_AT ? 'look' : pts >= LADDER_AT ? 'twitch' : spot, said = STROKE_SAID.get(k);
  // the same thing again, soon: the picture says it
  if (said && said.key === step && now - said.at < STROKE_QUIET_MS) return { type: 'noop' };
  STROKE_SAID.set(k, { key: step, at: now });
  if (STROKE_SAID.size > 500) STROKE_SAID.clear();
  if (!said || said.key !== step) sendToZone(zone, { type: 'zone_event', message: fill(STROKE_THEM[spot], w, { who: player.handle }) }, player.id);
  const seed = k + ':' + Math.floor(now / 4000);
  return { type: 'output', message: fill(step === 'look' ? LADDER[1] : step === 'twitch' ? LADDER[0] : pickOf(STROKE_YOU[spot], seed), w) };
}

// The Room Stage's question: is this NPC an animal, and what's it drawn from? A cat answers with its numbers, its
// nature (which tilts its day) and whatever beat it's on; the client works out the rest from the clock and its id.
function npcBeast(npc) {
  const p = petOfNpc(npc);
  if (!p || p.species !== 'cat') return null;
  const beat = beatOf(npc.id), b = stationOf(p);
  // his bowls go with him: where they stand (the piece's id) and when each was filled, so the client works out how full
  // they are and when he goes to them from the same numbers this side does
  const bowls = b ? { id: b.id, food: { ...b.food }, water: { ...b.water } } : null;
  return { id: npc.id, name: npc.name, cat: p.look, pet: p.id, nature: p.personality, ...(beat ? { beat } : {}), ...(bowls ? { bowls } : {}) };
}

// ── the bowls ─────────────────────────────────────────────────────────────────────────────────────
// furniture id → { id, pet, zone, food: { at, due }, water: { at, due } }, ms. Loaded with the pets; a refill writes.
const BOWLS = new Map();
// what a full dish of biscuits and a full bowl of water cost, credits; a part-empty one costs its share, at least 1
const COST = { food: 6, water: 1 };
const ms = (t) => (t ? new Date(t).getTime() : null);
async function loadBowls() {
  const pieces = [...world.furniture.values()].filter((f) => typeof f.flags?.pet_bowls === 'string');
  BOWLS.clear();
  if (!pieces.length) return 0;
  const { rows } = await query('SELECT * FROM pet_bowls WHERE furniture_id = ANY($1)', [pieces.map((f) => f.id)]);
  const had = new Map(rows.map((r) => [r.furniture_id, r]));
  // a station seen for the first time starts full from the start of today, and that's written once, so a restart
  // doesn't fill it again
  const day = Math.floor(Date.now() / DAY_MS) * DAY_MS, fresh = [];
  for (const f of pieces) {
    const r = had.get(f.id);
    if (!r) fresh.push(f.id);
    BOWLS.set(f.id, { id: f.id, pet: f.flags.pet_bowls, zone: f.zone_id,
      food: { at: ms(r?.food_at) ?? day, due: ms(r?.food_due) }, water: { at: ms(r?.water_at) ?? day, due: ms(r?.water_due) } });
  }
  if (fresh.length) await query(`INSERT INTO pet_bowls (furniture_id, food_at, water_at) SELECT id, to_timestamp($2::float8 / 1000), to_timestamp($2::float8 / 1000) FROM unnest($1::text[]) AS id ON CONFLICT DO NOTHING`, [fresh, day]);
  return BOWLS.size;
}
/** A pet's feeding station, or null. */
function stationOf(p) {
  for (const b of BOWLS.values()) if (b.pet === p.id) return b;
  return null;
}
const bowlsOf = (p) => { const b = stationOf(p); return b ? { food: b.food, water: b.water } : null; };
const levelsOf = (b, now = Date.now()) => {
  const p = PETS.get(b.pet), id = p?.npcId || b.pet;
  return { food: bowlLevel(id, 'food', b.food, now), water: bowlLevel(id, 'water', b.water, now) };
};
// how full, in words
const howFull = (v) => (v >= 0.99 ? 'full' : v >= 0.7 ? 'nearly full' : v >= 0.45 ? 'about half full' : v > 0.01 ? 'nearly empty' : 'empty');

// what a station shows on the Stage: how full each bowl is (room.pieceState, sync)
function pieceState(zoneId) {
  let out;
  for (const b of BOWLS.values()) {
    if (b.zone !== zoneId) continue;
    const l = levelsOf(b);
    (out ||= {})[b.id] = { food: +l.food.toFixed(2), water: +l.water.toFixed(2) };
  }
  return out;
}
// examining it says how full they are
function describeBowls(f) {
  const b = BOWLS.get(f?.id);
  if (!b) return undefined;
  const l = levelsOf(b), p = PETS.get(b.pet), npc = p && world.npcs.get(p.npcId), name = npc?.name || 'the cat';
  const line = `The dish is ${howFull(l.food)} and the water bowl is ${howFull(l.water)}.`;
  return l.food < 0.45 || l.water < 0.45 ? `${line} <span class="text-dim">${name} won't fill them himself. <b>refill</b></span>`.replace('himself', npc?.sex === 'female' ? 'herself' : npc?.sex === 'male' ? 'himself' : 'itself') : line;
}

// `refill`, `refill bowls`, `refill water`, `refill food` (or the dish, the biscuits): fills what's gone from the
// station in this room, charged there and then for what it took
const WATER_WORDS = /\b(water|drink)\b/i, FOOD_WORDS = /\b(food|dish|biscuits?|kibble|feed)\b/i;
async function cmdRefill(args, raw, player) {
  const here = mainOf(player.current_zone) || player.current_zone;
  const b = [...BOWLS.values()].find((x) => x.zone === here || x.zone === player.current_zone);
  if (!b) return { type: 'error', message: "There's nothing here to refill." };
  const text = args.join(' '), onlyWater = WATER_WORDS.test(text) && !FOOD_WORDS.test(text), onlyFood = FOOD_WORDS.test(text) && !WATER_WORDS.test(text);
  const kinds = onlyWater ? ['water'] : onlyFood ? ['food'] : ['food', 'water'];
  const now = Date.now(), l = levelsOf(b, now), gone = Object.fromEntries(kinds.map((k) => [k, 1 - l[k]]));
  const want = kinds.filter((k) => gone[k] > 0.01);
  const p = PETS.get(b.pet), npc = p && world.npcs.get(p.npcId), w = npc ? words(npc) : { name: 'the cat', his: 'its', he: 'it', He: 'It' };
  if (!want.length) return { type: 'output', message: kinds.length > 1 ? `${w.name}'s dish and water bowl are both full.` : kinds[0] === 'food' ? `${w.name}'s dish is full.` : `${w.name}'s water bowl is full.` };
  const cost = Math.max(1, Math.ceil(want.reduce((s, k) => s + gone[k] * COST[k], 0)));
  if (!(await adjustCredits(player, -cost, query, 'pets:refill'))) return { type: 'error', message: `That's ₵${cost} for the biscuits and the water, and you haven't got it on you.` };
  // he'd been left waiting at an empty one: he makes up for it as soon as it's down
  const id = p?.npcId || b.pet;
  for (const k of want) {
    const missed = missedSince(id, k, b[k], now);
    b[k] = { at: now, due: missed ? now + 12000 : null };
  }
  await query(`INSERT INTO pet_bowls (furniture_id, food_at, food_due, water_at, water_due) VALUES ($1, to_timestamp($2::float8/1000), to_timestamp($3::float8/1000), to_timestamp($4::float8/1000), to_timestamp($5::float8/1000))
    ON CONFLICT (furniture_id) DO UPDATE SET food_at = EXCLUDED.food_at, food_due = EXCLUDED.food_due, water_at = EXCLUDED.water_at, water_due = EXCLUDED.water_due`,
  [b.id, b.food.at, b.food.due, b.water.at, b.water.due]);
  bowlsChanged(b);
  const what = want.length > 1 ? `tip biscuits into ${w.name}'s dish and fresh water into ${w.his} bowl` : want[0] === 'food' ? `tip biscuits into ${w.name}'s dish` : `fill ${w.name}'s water bowl`;
  const hungry = want.some((k) => b[k].due);
  sendToZone(b.zone, { type: 'zone_event', message: `${player.handle} ${what.replace(/^tip/, 'tips').replace(/^fill/, 'fills')}.${hungry ? ` ${w.name} is there before the rattle's stopped.` : ''}` }, player.id);
  return { type: 'output', message: `You ${what}. ₵${cost}.${hungry ? ` ${w.name} is there before the rattle's stopped.` : ''}` };
}
// a station's bowls moved: the Stage redraws the piece, and the cat's beast carries the new times
function bowlsChanged(b) {
  emit('furniture.changed', { zoneId: b.zone, id: b.id });
  const p = PETS.get(b.pet), npc = p && world.npcs.get(p.npcId);
  if (npc?.zone_id) emit('pet.beat', { npcId: npc.id, zoneId: npc.zone_id, beat: beatOf(npc.id) });
}

// ── his day in words ──────────────────────────────────────────────────────────────────────────────
// The room's layout, for which piece he's up on: the Stage's own (roomstage specOf + roomPieces, RAM), kept a minute.
const LAYOUTS = new Map();   // zone id → { L, at }
const cachedLayout = (zoneId) => LAYOUTS.get(zoneId)?.L || null;
async function layoutOf(zoneId) {
  const c = LAYOUTS.get(zoneId);
  if (c && Date.now() - c.at < 60000) return c.L;
  const spec = specOf(zoneId);
  const L = spec ? roomLayout(spec, await roomPieces(zoneId, spec)) : null;
  LAYOUTS.set(zoneId, { L, at: Date.now() });
  return L;
}
// what he's doing now, as the picture has it
function nowOf(p, npc, L, now, hour) {
  const life = catLife(npc.id, now, hour, p.personality), perch = L ? catPerchOf(L, life, p.look) : null;
  const st = L ? catSettle(L, life, perch) : { act: life.act, rug: null };
  return { life, perch, act: st.act, rug: !!st.rug, bowl: catAtBowls(npc.id, now, bowlsOf(p)) };
}
// how he settles, by the block's state; `on` is the piece he's on, or null for the floor
const SETTLE = {
  sleep: (on) => (on ? 'curls up to sleep' : 'curls up on the floor to sleep'),
  rest: () => 'settles down with $his paws tucked under',
  sit: () => 'sits down and has a look round',
  flop: () => 'flops over on $his side',
  about: () => 'gets up and wanders off',
};
// a turn's act, said now and then (the rest are just him carrying on)
const ACT_LINE = {
  groom: '$name licks a paw and washes $his face with it.',
  flank: '$name gives $his flank a long wash.',
  scratch: '$name scratches behind $his ear with a hind foot, fast.',
  yawn: '$name yawns, all teeth and tongue.',
  watch: '$name stares at something across the room, the tip of $his tail twitching.',
  situp: '$name sits up on $his bum like a person, front paws in the air.',
  knead: '$name kneads $where with $his front paws, purring.',
  claw: '$name has a good scratch at $floor.',
  stalk: '$name drops low, wiggles $his bum and pounces on nothing.',
  zoomies: '$name tears round the room flat out for no reason at all.',
  yowl: '$name lets out a long yowl at nothing.',
  sniff: '$name sniffs along the floor.',
  stretch: '$name has a long stretch, front end first, then each back leg.',
  wander: '$name wanders off across the room.',
};
const BOWL_LINE = {
  eat: '$name goes to $his dish and gets stuck into $his biscuits.',
  drink: '$name pads over to $his water bowl and laps at it for a while.',
  beg: { food: '$name goes to $his dish, finds it empty, and sits by it complaining.', water: '$name looks into $his empty water bowl, then round the room for whoever is responsible.' },
};
// an act line at most this often, and never the same act twice running: a room is told he's started kneading, not
// every twenty seconds that he's still at it
const ACT_GAP_MS = 75000;
/**
 * The line for going from `a` to `b` (nowOf), or null: what changed, said once. `mem` is { act, at }, what act was last
 * said and when, which this updates.
 */
function lineFor(a, b, npc, L, mem = {}, now = Date.now()) {
  const w = words(npc), say = (s, extra = {}) => fill(s, w, extra);
  // to his bowls
  if (b.bowl && b.bowl.since !== a.bowl?.since) {
    const s = b.bowl.act === 'beg' ? BOWL_LINE.beg[b.bowl.kind] : BOWL_LINE[b.bowl.act];
    const was = a.bowl ? null : a.perch;
    return was ? say(s.replace(/^\$name /, `$name jumps down off the ${perchWord(was)}, `).replace(', goes to', ', goes to').replace(', pads over to', ', pads over to')) : say(s);
  }
  if (b.bowl) return null;
  const st = b.life.state, from = a.bowl ? null : a.perch, to = b.perch;
  const tail = (SETTLE[st] || SETTLE.sit)(to);
  // up onto something, down off it, or from one to another
  if ((from?.id || null) !== (to?.id || null) || a.life.block !== b.life.block || a.bowl) {
    const moved = to && from && from.id !== to.id ? `$name jumps down off the ${perchWord(from)} and up onto the ${perchWord(to)}, where $he ${tail}.`
      : to && from?.id !== to.id ? `$name jumps up onto the ${perchWord(to)} and ${tail}.`
        : !to && from ? `$name jumps down off the ${perchWord(from)} and ${st === 'about' ? 'wanders off' : tail}.`
          : a.life.state !== st || a.bowl ? `$name ${tail}.` : null;
    if (moved) { mem.act = null; return say(moved); }
  }
  // the next thing he does in the block: a new act, now and then, and not too often
  if (a.life.turn !== b.life.turn || a.life.block !== b.life.block) {
    const s = ACT_LINE[b.act];
    if (!s || b.act === mem.act || now - (mem.at || 0) < ACT_GAP_MS) return null;
    // biscuits are always worth saying; the rest now and then
    if (b.act !== 'knead' && hashOf(npc.id + ':' + b.life.since) % 100 >= 60) return null;
    mem.act = b.act; mem.at = now;
    const rug = L?.spec?.decor?.rug ? 'the rug' : 'the floor';
    return say(s, { where: to ? `the ${perchWord(to)}` : b.rug ? 'the rug' : rug, floor: rug });
  }
  return null;
}
// pet id → what was last said of him; dropped when nobody's there to hear. MEM: pet id → the last act said and when
const SAID = new Map(), MEM = new Map();
let narrating = false;
async function narrate() {
  if (narrating) return;
  narrating = true;
  try {
    const now = Date.now(), hour = getBirdClock().hour;
    // a bowl that went down since last time is drawn again
    for (const b of BOWLS.values()) {
      const l = levelsOf(b, now), sig = l.food.toFixed(2) + '/' + l.water.toFixed(2);
      if (b.sig !== undefined && b.sig !== sig) emit('furniture.changed', { zoneId: b.zone, id: b.id });
      b.sig = sig;
    }
    for (const p of PETS.values()) {
      const npc = world.npcs.get(p.npcId), zone = npc?.zone_id;
      if (!npc || npc._dead || !zone || !getZonePlayers(zone).length) { SAID.delete(p.id); continue; }
      const L = await layoutOf(zone), st = nowOf(p, npc, L, now, hour), was = SAID.get(p.id);
      SAID.set(p.id, st);
      // a beat says its own lines; and somebody just in has had the greeting
      if (!was || beatOf(npc.id, now)) continue;
      if (!MEM.has(p.id)) MEM.set(p.id, {});
      const line = lineFor(was, st, npc, L, MEM.get(p.id), now);
      if (line) sendToZone(zone, { type: 'zone_event', message: line });
    }
  } finally { narrating = false; }
}

await loadPets().catch((e) => console.error(`[pets] failed to load: ${e.message}`));
await loadBowls().catch((e) => console.error(`[pets] bowls failed to load: ${e.message}`));

on('zone.entered', (e) => { try { onEntered(e); } catch (err) { console.error(`[pets] greet: ${err.message}`); } });
// keep the layout fresh when the furniture moves
on('furniture.changed', ({ zoneId }) => { if (zoneId) LAYOUTS.delete(mainOf(zoneId) || zoneId); });
schedule('5s', () => narrate().catch((e) => console.error(`[pets] narrate: ${e.message}`)));

export const hooks = {
  'roomstage.npcBeast': npcBeast,
  'npc.petAttempt': onPetAttempt,
  'room.pieceState': pieceState,
  'furniture.acts': (f) => (typeof f?.flags?.pet_bowls === 'string' ? [{ verb: 'refill' }] : undefined),
  'furniture.describe': describeBowls,
};
export const commands = { refill: cmdRefill };
// `refill` stays this plugin's verb; the row puts it on a feeding station's examine
export const specializedActions = [{ verb: 'refill', requiredFlag: 'pet_bowls', handler: null }];

export const _test = { PETS, BY_NPC, BEATS, STROKES, STROKE_SAID, BOWLS, petSpot, strokeBy, SAID, loadPets, loadBowls, petOfNpc, npcBeast, onEntered, onPetAttempt, beatOf, setBeat, cmdRefill, levelsOf, stationOf, pieceState, describeBowls, lineFor, nowOf, layoutOf, narrate };

console.log(`[pets] Plugin loaded (${PETS.size} pet${PETS.size === 1 ? '' : 's'}).`);
