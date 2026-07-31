/**
 * Dreams — procedural, tethered, and different every night.
 *
 * The first version was a bag of ~24 written lines. That is fine for a week and
 * then it is wallpaper: once a player has seen them all, the one channel that
 * was supposed to feel like being unconscious becomes a loading message.
 *
 * So a dream is BUILT, not picked:
 *
 *     SETTING  ── where it seems to be happening
 *        +
 *     SUBJECT  ── the thing the dream is about
 *        +
 *     EVENT    ── what it does
 *        +
 *     WRONGNESS ─ the detail that makes it a dream
 *
 * Four slots, each with a couple of dozen options and each filtered by how
 * frayed the sleeper's mind is, produces tens of thousands of combinations. It
 * won't repeat.
 *
 * THE TETHER
 *
 * Pure noise is as boring as repetition — a random line about a random object
 * means nothing. So the SUBJECT is drawn, where possible, from the sleeper's
 * actual life: a zone they've been in, an NPC they know, the thing they're
 * carrying, the person they killed. That's what makes a dream land: it is
 * nonsense, but it is nonsense about YOUR week.
 *
 * The tether is provided by the caller, so this module stays pure and testable
 * and never queries anything.
 */
import { gatherHook } from './plugins.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const maybe = (p) => Math.random() < p;

// ── Slots ────────────────────────────────────────────────────────────────────
//
// `min`/`max` gate a fragment to a sanity range (0–100). Ordinary fragments are
// available at any sanity; the horrible ones only turn up once the mind is
// coming apart, which is what makes a bad night mean something.

const SETTINGS = [
  { t: 'a corridor that keeps arriving at itself' },
  { t: 'a room you are certain you grew up in, though you did not' },
  { t: 'the street outside, emptied of everything but signage' },
  { t: 'a stairwell going down considerably further than the building allows' },
  { t: 'somebody else’s kitchen, mid-meal, no one present' },
  { t: 'a waiting room with no door and a working clock' },
  { t: 'the inside of a vehicle that is not moving and never was' },
  { t: 'a market at an hour it has never been open' },
  { t: 'a rooftop, in weather that is not tonight’s weather' },
  { t: 'a flooded floor of a building you half know' },
  { t: 'a place with no floor, which does not seem to matter' },
  { t: 'a corridor of identical doors, all very slightly ajar', min: 0, max: 60 },
  { t: 'the inside of a machine large enough to stand up in', min: 0, max: 45 },
  { t: 'a room made of the sound of a room', min: 0, max: 25 },
];

const SUBJECTS = [
  { t: 'a man whose face you cannot afterwards describe' },
  { t: 'a dog that is patiently waiting for you to understand something' },
  { t: 'your own hands' },
  { t: 'a meal laid out for somebody who is not coming' },
  { t: 'a queue of people, all facing away' },
  { t: 'a child holding a piece of paper' },
  { t: 'an old woman counting something under her breath' },
  { t: 'a light left on in a window' },
  { t: 'a door you are not going to open' },
  { t: 'a telephone that has been ringing the whole time' },
  { t: 'something under a sheet, roughly your size', min: 0, max: 55 },
  { t: 'a version of yourself, doing your job, badly', min: 0, max: 55 },
  { t: 'a thing wearing a person the way you wear a coat', min: 0, max: 25 },
];

const EVENTS = [
  { t: 'explains something enormously important, very slowly' },
  { t: 'asks you a question you have already answered' },
  { t: 'is waiting for you, and has been for some time' },
  { t: 'apologises, repeatedly, for something you cannot place' },
  { t: 'goes about its business and does not acknowledge you at all' },
  { t: 'shows you the same thing three times, as though it changes' },
  { t: 'is trying to leave, and cannot work out how' },
  { t: 'says your name with enormous tenderness' },
  { t: 'begins to laugh, and does not stop when it should' },
  { t: 'turns to face you, which you had been dreading', min: 0, max: 55 },
  { t: 'stops what it is doing and looks directly at you, unsurprised', min: 0, max: 30 },
  { t: 'asks you to hold still', min: 0, max: 25 },
];

const WRONGNESS = [
  { t: 'You are not troubled by any of this at the time.' },
  { t: 'You know, throughout, that you are late for something.' },
  { t: 'The light is coming from the wrong direction the entire time.' },
  { t: 'You cannot make yourself speak above a whisper.' },
  { t: 'It is all happening slightly too slowly.' },
  { t: 'You are aware of being watched by the room itself.' },
  { t: 'Everyone else seems to have been told what this is about.' },
  { t: 'You keep almost remembering that you are asleep.' },
  { t: 'You are certain you have done all of this before, in this order.', min: 0, max: 60 },
  { t: 'You cannot find your own hands to check them.', min: 0, max: 40 },
  { t: 'Something in the dream is aware that you will wake up, and is pacing itself.', min: 0, max: 25 },
];

const usable = (list, sanityPct) =>
  list.filter(f => sanityPct >= (f.min ?? 0) && sanityPct <= (f.max ?? 100));

// ── The tether ───────────────────────────────────────────────────────────────
//
// Real things from the sleeper's life, phrased so they can stand in for a
// subject. Supplied by the caller (apartments.js knows the world; this doesn't).
function tetherSubject(tether = {}) {
  const options = [];
  if (tether.zone)   options.push(`${tether.zone}, rebuilt slightly wrong`);
  if (tether.npc)    options.push(`${tether.npc}, who should not be here`);
  if (tether.item)   options.push(`your ${tether.item}, much heavier than it is`);
  if (tether.killed) options.push(`${tether.killed}, who is not angry about it, which is worse`);
  return options.length ? pick(options) : null;
}

/**
 * Build one dream.
 *
 * @param sanityPct  0–100. Low pulls the horrible fragments into range.
 * @param tether     `{ zone, npc, item, killed }` — anything known, all optional.
 * @param extra      Contributed lines (plugins, body state) that may replace the
 *                   generated subject entirely.
 */
export function composeDream(sanityPct = 100, tether = {}, extra = []) {
  const s = Math.max(0, Math.min(100, sanityPct));

  // A contributed line wins outright sometimes — that's how a drug or a starving
  // body says something specific instead of being averaged away.
  if (extra.length && maybe(0.35)) return pick(extra);

  const setting = pick(usable(SETTINGS, s));
  const anchored = tetherSubject(tether);
  // The tether is the point, so it takes the subject slot when there is one.
  const subject = anchored && maybe(0.55) ? anchored : pick(usable(SUBJECTS, s)).t;
  const event = pick(usable(EVENTS, s));
  const wrong = pick(usable(WRONGNESS, s));

  const opener = pick([
    `You dream of ${setting.t}.`,
    `You are in ${setting.t}.`,
    `The dream is ${setting.t}.`,
  ]);
  // The wrongness line is the punchline, so it doesn't always fire — a dream
  // that always has one stops feeling like a dream and starts feeling like a
  // format.
  return `${opener} There is ${subject}. It ${event.t}.${maybe(0.7) ? ` ${wrong.t}` : ''}`;
}

// The body reaching into sleep — you dream about what you went to bed needing.
// These stay hand-written because they are SPECIFIC: their whole job is to be a
// recognisable second readout of your own state.
function bodyDreams(player) {
  const out = [];
  if ((player.hunger ?? 100) <= 25) out.push(`You dream of a meal laid out in front of you, and wake with your jaw aching.`);
  if ((player.thirst ?? 100) <= 25) out.push(`You dream of drinking, and drinking, and never once shifting the taste of dust.`);
  if ((player.body_temp_c ?? 37) < 35) out.push(`You dream of being buried in something cold and very heavy, and being too tired to dig.`);
  if ((player.body_temp_c ?? 37) > 39) out.push(`You dream of a white room with no shade in it, and nobody answering the door.`);
  if (player.covered_in_blood) out.push(`You dream of washing your hands, thoroughly, and of it making no difference at all.`);
  return out;
}

/**
 * Roll a dream for a sleeping player, or null on a dreamless stretch.
 *
 * Chance is per sleeping minute and deliberately low. You do NOT dream every
 * night: most of sleep is nothing, and a dream every minute would be noise. Two
 * or three across a full night is the target.
 */
export async function rollDream(player, { chance = 0.18, tether = {} } = {}) {
  if (Math.random() > chance) return null;
  const sanityPct = player?.sanity_max ? (player.sanity / player.sanity_max) * 100 : 100;
  const contributed = (await gatherHook('sleep.dream', player))
    .map(c => (typeof c === 'string' ? c : c?.text))
    .filter(Boolean);
  return composeDream(sanityPct, tether, [...contributed, ...bodyDreams(player)]);
}

export const _test = { SETTINGS, SUBJECTS, EVENTS, WRONGNESS, composeDream, tetherSubject };
