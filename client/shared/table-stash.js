// A SESSION AT THE TABLE. A resident with a habit (flags.drug_habit, preshow_habit or booze_habit) sits
// down at a table in their own room and works through what they've laid out on it: lines cut on a
// mirror, a dish of pills, a pipe and a bag of rocks, a spoon and a few rigs, a row of cans, a bottle.
// plugins/roomstage/npc-life.js picks the seat and sends `stash` on the person; gl/room-stash.js draws
// the kit and room-stage.js plays the clips. Both read the clock from here, so everyone with the room
// open sees the same line go at the same moment, with nothing sent per beat.
//
// ⚠ IT'S THE PICTURE'S, LIKE A MEAL. Nothing here doses anybody: npc-drugs owns that, and its ritual,
// when it lands on somebody sat at the table, plays its beats in the chair (SIT_TAKE).
//
// `stash` on the wire: { k, of, beat, gone, at: [u, v, y] } — the kind, how many it started with, the ms
// one takes, how long the session has run when it was sent, and the spot on the table top in front of
// the seat. `at` is in the room's u and v and metres up.

// How each is done at a table: how many are laid out, how long one takes (ms), the clip that sets the
// next one up and the clip that takes it. The first PREP of each beat is the set-up, the rest the take.
export const KITS = Object.freeze({
  snort: { of: [3, 6], beat: 16_000, prep: 'sitCut', take: 'sitLine', PREP: 0.5 },
  swallow: { of: [4, 8], beat: 11_000, prep: 'sitSort', take: 'sitPill', PREP: 0.4 },
  smoke: { of: [3, 5], beat: 18_000, prep: 'sitPack', take: 'sitPipe', PREP: 0.35 },
  inject: { of: [2, 3], beat: 26_000, prep: 'sitCook', take: 'sitTie', PREP: 0.55 },
  huff: { of: [3, 5], beat: 14_000, prep: 'sitShake', take: 'sitHuff', PREP: 0.3 },
  drink: { of: [4, 7], beat: 15_000, prep: 'sitPour', take: 'sitDrink', PREP: 0.3 },
});
// After the last one, they sit back a while before they get up.
export const AFTER_MS = 25_000;
// What an npc-drugs ritual beat looks like in a chair at the table.
export const SIT_TAKE = Object.freeze({ prep: 'sitCut', snort: 'sitLine', swallow: 'sitPill', smoke: 'sitPipe', inject: 'sitTie', huff: 'sitHuff', drink: 'sitDrink' });

export const kitOf = (k) => KITS[k] || KITS.swallow;
// How long a whole session runs, to the end of the sitting back.
export const sessionMs = (s) => s.of * kitOf(s.k).beat + AFTER_MS;

// Where a session is `ms` in: which one they're on, how many are still on the table, what the body is
// doing and how far through it (0..1), and whether the set-up of this one is done.
export function stashAt(s, ms) {
  const kit = kitOf(s.k), beat = Math.max(1000, s.beat || kit.beat), of = Math.max(1, s.of | 0);
  const i = Math.floor(Math.max(0, ms) / beat);
  if (i >= of) return { i: of, left: 0, clip: 'sitBack', phase: ((ms - of * beat) / 10_000) % 1, set: false, done: true };
  const f = (ms % beat) / beat, prep = f < kit.PREP;
  // the one being taken is off the table once the take is half done
  const gone = !prep && (f - kit.PREP) / (1 - kit.PREP) > 0.5;
  return { i, left: of - i - (gone ? 1 : 0), clip: prep ? kit.prep : kit.take, phase: prep ? f / kit.PREP : (f - kit.PREP) / (1 - kit.PREP), set: !prep, done: false };
}

// What they say, to anyone with the room open, as they sit down and as they finish. {table} is the piece.
export const SIT_LINES = Object.freeze({
  snort: ['sits down at the {table}, sets a mirror on it and taps out a little pile.', 'clears a space on the {table} and lays out a mirror, a card and a rolled note.'],
  swallow: ['sits at the {table} and tips a dish of pills out in front of them.', 'sits down at the {table} with a dish of pills and a glass of water.'],
  smoke: ['sits at the {table} with a glass pipe, a lighter and a small bag.', 'sits down at the {table} and lays out a pipe and a bag of rocks.'],
  inject: ['sits at the {table} and lays out a spoon, a lighter, a tie and a few rigs.', 'sits down at the {table}, rolls up a sleeve and lays out a spoon.'],
  huff: ['sits at the {table} with a row of cans and a rag.', 'sits down at the {table} and lines up the cans.'],
  drink: ['sits at the {table} with a bottle and a glass.', 'sits down at the {table} and pours the first one.'],
});
export const DONE_LINES = Object.freeze({
  snort: ['wipes the mirror with a finger and rubs it on their gums.', 'sits back and pinches their nose, eyes watering.'],
  swallow: ['pushes the empty dish away.', 'drains the water and sits back.'],
  smoke: ['sets the pipe down and lets the smoke out slowly.', 'sits back with their eyes shut.'],
  inject: ['loosens the tie and sits back very still.', 'caps the last rig and lets their head go back.'],
  huff: ['drops the rag and sits blinking at the wall.', 'pushes the cans away and sways in the chair.'],
  drink: ['tips the bottle over the glass and gets nothing.', 'sits back with the empty glass.'],
});
