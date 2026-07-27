/**
 * Senses — perception acuity, and the band it opens.
 *
 * A sense verb gathers contributions as `{ text, strength }` and shows the
 * strongest few. ACUITY is the one number that changes what "few" and
 * "strongest" mean: it lowers the floor below which you notice nothing, and
 * raises the cap on how much you can hold in your head at once.
 *
 * That's the whole design, and it's deliberately not a new content system. Every
 * contributor already emits faint things that a normal nose throws away — a cook
 * that has only just started (3), a single quiet person standing in the room
 * (3). A sharpened sense doesn't need new lines written for it; it starts
 * perceiving what was always being generated and discarded. Adding acuity makes
 * every existing contributor deeper for free, and any new contributor gets the
 * same benefit the day it's written.
 *
 * That sub-threshold band is also where the tactical value lives: ONE person
 * standing still is below a normal nose and above a sharp one. Smell doesn't
 * care about light or line of sight, so a sharpened sense answers the question
 * `look` cannot — who is in here that I can't see.
 *
 * Where acuity comes from is deliberately NOT decided here. The engine owns the
 * band; mutations, drugs, implants and cyberware own the reasons, and reach it
 * two ways:
 *
 *   1. a status effect declaring `acuity: { smell: 2 }` — the cheap path, so a
 *      drug or a mutation needs no plumbing beyond its own registration;
 *   2. the `sense.acuity` gather hook, for anything conditional enough to need
 *      real code (a species trait, a worn respirator scoring NEGATIVE, weather).
 *
 * Negative acuity is fully supported and is half the point: a broken nose, a
 * gas mask, a heavy cold, or standing in a room that already reeks should all
 * blunt what else you can pick out.
 */
import { gatherHook } from './plugins.js';
import { effectAcuity } from './effects.js';

// The senses the game knows about. A verb is free to exist before anything
// contributes acuity to it — an unlisted sense simply always runs at baseline.
export const SENSES = ['smell', 'hearing', 'sight'];

// Baseline perception. A normal person notices the obvious and can hold about
// three things at once; these are the numbers every existing contributor was
// balanced against, so they must not move without re-reading the strengths in
// world.js, cooking, bodily and district-ambience.
export const BASE_FLOOR = 5;   // below this strength, you don't notice at all
export const BASE_LIMIT = 3;   // how many things you can pick apart at once

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── The stat path ────────────────────────────────────────────────────────────
//
// `stat_senses` alone makes you super. No hardware, no unlock, no gate: raise the
// stat and you genuinely perceive more than other people, paid for the same way
// everything is paid for — the points did not go into brawn.
//
// What the stat does NOT do is make you good at everything at once. You have a
// DOMINANT sense and a SECOND, and the rest stay human. That's the whole shape of
// it: the stat sets how deep your one sense goes, and only the deep end of the
// stat spills over into a second at all.
//
// Augments are the other axis entirely — they contribute through `sense.acuity`
// like anything else, but their real job is ABILITIES a normal nose can't do at
// any acuity (tracking a scent to the exit it left by, hearing through a wall).
// Depth is bought with the stat; capability is bought with chrome.
const DOMINANT_BY_STAT = [
  // [minStat, dominant, second]
  [12, 4, 2],
  [9,  3, 1],
  [6,  2, 1],
  [3,  1, 0],
];

export const DOMINANT_FLAG = 'sense_dominant';
export const SECOND_FLAG   = 'sense_second';

// The two flag reads are cached on the live player object because `smell` is a
// player-typed verb that can be spammed, and a DB round trip per sniff would be
// exactly the kind of hot-path query docs/architecture.md warns about.
export function statAcuity(player, sense) {
  const stat = Number(player?.stat_senses) || 0;
  const row = DOMINANT_BY_STAT.find(([min]) => stat >= min);
  if (!row) return 0;
  const [, dom, second] = row;
  if (player._senseDominant === sense) return dom;
  if (player._senseSecond === sense) return second;
  return 0;
}

/**
 * How sharp this player's `sense` is right now. 0 is a normal human; positive is
 * enhanced, negative is impaired.
 */
// Worn gear that deliberately dulls a sense — a respirator, ear defenders,
// tinted lenses. Cached on the live player by `recomputeSenseDamp` on every
// equip change, so reading it here costs nothing.
export function gearDamp(player, sense) {
  return Number(player?._senseDamp?.[sense]) || 0;
}

/**
 * Acuity WITHOUT the plugin hook — stat, statuses and worn gear only.
 *
 * `describeZone` runs on every move and every look, which makes it the hottest
 * path in the game, and sight acuity has to be read there. `gatherHook` is cheap
 * today but it is an await into arbitrary plugin code, and one plugin doing a
 * query inside `sense.acuity` would put a DB round trip on every step a player
 * takes. So the passive senses read this synchronous version, and the explicit
 * sense VERBS — typed once, deliberately — pay for the full async one.
 *
 * The practical difference: a plugin can sharpen your nose when you `smell`, but
 * cannot change how well you see as you walk. Stat, drugs and gear do both.
 */
export function acuitySync(player, sense) {
  if (!player) return 0;
  return clamp(statAcuity(player, sense) + effectAcuity(player, sense) + gearDamp(player, sense), -3, 5);
}

export async function acuityFor(player, sense) {
  if (!player) return 0;
  let total = statAcuity(player, sense) + effectAcuity(player, sense) + gearDamp(player, sense);
  for (const c of await gatherHook('sense.acuity', player, sense)) {
    total += Number(c?.bonus ?? c) || 0;
  }
  // Bounded hard. Past about 4 the floor is already at zero and there is
  // genuinely nothing left to reveal, so more would only be a bigger number.
  return clamp(total, -3, 5);
}

/**
 * The perception band an acuity opens: what you can notice, and how much of it.
 *
 * Each point of acuity buys 1.5 of floor and one more line. The asymmetry is on
 * purpose — dropping the floor is what reveals things that were previously
 * invisible, while the line cap only decides how much of the newly-visible stuff
 * survives to the screen. Impairment works the same way in reverse, and the
 * floor is capped at 8 rather than infinity so even a blunted sense still gets
 * the thing that's actually on fire.
 */
export function perceptionBand(acuity = 0) {
  return {
    floor: clamp(BASE_FLOOR - acuity * 1.5, 0, 8),
    limit: clamp(BASE_LIMIT + Math.round(acuity), 1, 8),
  };
}

/**
 * Apply a band to a gathered contribution set. Sorting and slicing live here so
 * every sense verb behaves identically — a sense that filters its own results by
 * hand is a sense that will drift away from the others.
 */
export function perceive(found, band) {
  return found
    .filter(f => (Number(f?.strength) || 0) >= band.floor)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, band.limit);
}

// ── Overload: what a sharpened sense costs ───────────────────────────────────
//
// The house rule the whole cooking system runs on is that a technique buys you
// something and costs you something else. A sense that only ever helped would be
// the one free upgrade in the game, so it isn't one.
//
// A sharp sense in a strong stimulus is WORSE than a normal one, because it
// can't look away. Walk a keen nose into a room full of shit, or set off a
// flashbang next to keen ears, and the sense saturates: you get a status effect
// carrying NEGATIVE acuity, so for the next while you perceive less than an
// ordinary person would have. That's olfactory fatigue and it's also the counter
// — an enemy who knows what you are can blind you with your own advantage.
//
// The threshold scales with acuity on purpose. A +1 nose needs something genuinely
// foul to be overwhelmed; a +4 nose is overwhelmed by things other people barely
// register, which is exactly the deal you took.
// NOBODY is immune. A sharpened sense is overwhelmed by things other people
// merely find unpleasant, but a bad enough event takes anyone — a room of
// corpses, a flashbang, a chemical fire. There is no acuity gate on this: a
// normal nervous system simply needs a stimulus at the top of the scale, and a
// sharpened one does not.
//
// The scale, so contributors can aim at it:
//   3–5   background — a lone person, a cook just started
//   6–8   obvious — a crowd, an unflushed toilet, blood
//   9–11  foul — shit on the floor, food burnt to carbon
//   12+   EXTREME — overwhelms an ordinary person with no augment and no stat
//   14+   the worst things in the world — a room of corpses, a flashbang
export const OVERLOAD_STATUS = 'sense_overload';
export const EXTREME = 12;

// The upper clamp is 16, not EXTREME. That gap is deliberate and it's the whole
// reason to own a respirator: damping has to be able to push the threshold ABOVE
// the worst thing in the game, or gear could never save anyone from the events
// it exists for. A single pair of plugs won't get you there — you need a real
// seal, and then you walk through a charnel house perceiving nothing at all,
// which is exactly the trade.
export function overloadThreshold(acuity) {
  return clamp(EXTREME - acuity * 1.5, 6, 16);
}

export function wouldOverload(acuity, topStrength) {
  return (Number(topStrength) || 0) >= overloadThreshold(acuity);
}

// What it reads as — keyed on the SENSE and on what actually overwhelmed it.
//
// A generic line per sense was the first version and it was wrong: being blown
// out by a corpse, by burning fat and by an overflowing toilet are three
// different experiences, and a keen nose is precisely the character who would
// know the difference. The whole point of the build is that this player's
// perception is more specific than everyone else's, so the moment it fails is
// the worst possible moment to go vague.
//
// Contributions carry an optional `source` for this. A contributor that doesn't
// bother still works — it falls through to the per-sense default — so the field
// is a refinement, never a requirement.
const OVERLOAD_BY_SOURCE = {
  smell: {
    feces:    `It is a physical thing. Your throat shuts, your eyes stream, and you are breathing through your sleeve before you have decided to — and now you will smell nothing at all for a while.`,
    urine:    `The ammonia goes up your nose like a wire and keeps going. Your eyes water helplessly. Everything after this is going to be very faint.`,
    vomit:    `The sourness gets into the back of your throat and sets your own stomach going. You back off fast, and your nose closes down for the duration.`,
    blood:    `The iron of it coats everything, thick and close and far too warm. It is all you can smell, and shortly it is all you will not be able to smell.`,
    burning:  `Scorched fat and carbon, straight to the back of the sinus. It scours the inside of your head out, and takes your sense of smell with it.`,
    chemical: `Something solvent and wrong bites into the lining of your nose. You reel back with your eyes streaming, shut down for the duration.`,
    bodies:   `Too many people, too close, all of them unwashed — it stops being a smell and becomes a pressure. Your nose gives up rather than sort it.`,
    corpses:  `Sweet, thick and unmistakable, and there is far too much of it. It gets into your clothes and the back of your throat and it does not wash out. You are not going to smell anything else for a long while, and you are grateful.`,
  },
  hearing: {
    blast:    `The pressure of it arrives before the noise does. Your ears sing one long flat note and everything else goes distant and wrapped in cloth.`,
    gunfire:  `Every shot lands inside your skull. By the third one you are hearing through a wall you cannot get away from.`,
  },
  sight: {
    flash:    `Everything whites out at once and stays white. You blink into a floating green ghost of the room that will not go away.`,
    glare:    `It burns straight through, and your eyes shut on reflex. What comes back is washed out and swimming.`,
  },
  touch: {},
};

const OVERLOAD_DEFAULT = {
  smell:   `It is far too much. Your eyes water and your throat closes — and for a while after, you will smell nothing at all.`,
  hearing: `It goes through your head like a spike. Everything after it arrives muffled and far away.`,
  sight:   `The glare is unbearable. You blink into a swimming afterimage that will not clear.`,
  touch:   `It floods you, and your hands stop reporting anything useful at all.`,
};

export function overloadText(sense, source = null) {
  return (source && OVERLOAD_BY_SOURCE[sense]?.[source]) || OVERLOAD_DEFAULT[sense] || OVERLOAD_DEFAULT.smell;
}

// A one-line note when a sense is running off-baseline, so a player can tell the
// difference between "the room is clean" and "I currently cannot smell anything".
export function acuityNote(acuity, sense = 'smell') {
  if (acuity >= 2) return `Everything is louder than it should be; your ${sense} is doing more than it was built for.`;
  if (acuity >= 1) return `It all comes through a little sharper than usual.`;
  if (acuity <= -2) return `You are getting almost nothing. Whatever is wrong with your ${sense}, it is bad.`;
  if (acuity <= -1) return `It comes through dulled, like it is happening to somebody else.`;
  return null;
}
