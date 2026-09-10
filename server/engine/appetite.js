/**
 * Hunger and thirst, as something you FEEL rather than something you read.
 *
 * The old implementation was two lines:
 *
 *     if (hunger > 0 && hunger <= 20) messages.push('You are very hungry.');
 *     if (thirst > 0 && thirst <= 20) messages.push('You are very thirsty.');
 *
 * One band each, fired every single minute. That is not information, it is nagging — and it
 * trains a player to skim past the one line that actually matters, which is the classic
 * cry-wolf failure. It also meant the entire 20-point runway to starvation had a single
 * undifferentiated warning on it, so "peckish" and "about to take damage" read identically.
 *
 * Three rules shape what replaced it, and they are the whole design:
 *
 *   1. BANDS ARE UNEQUAL. Wide and silent at the top, narrow at the bottom. Danger is at
 *      zero, so that is where the resolution belongs.
 *   2. CADENCE IS THE SEVERITY SIGNAL. A line that repeats at the same rate whether you are
 *      peckish or dying is a line nobody reads. The interval shortens as the band worsens,
 *      so urgency is felt in the rhythm rather than only stated in the words.
 *   3. CROSSING IS AN EVENT. Falling into a band says so immediately; sitting in it repeats
 *      on the cadence; climbing back OUT is mostly silent, because relief that announces
 *      itself as loudly as danger flattens both.
 *
 * This is what makes the vitals safe to take off the HUD: temperature has always worked this
 * way (no bar, read from `conditionReport` and banded prose), and hunger and thirst were the
 * inconsistency. `condition` remains the precise diagnostic for anyone who wants a number.
 */

// Worst-first. `at` is the top of the band; `every` is game-minutes between repeats.
const HUNGER_BANDS = [
  { at: 4, every: 4, lines: [
    'Your body has started eating itself. You can feel it deciding what to spend first.',
    "There's nothing left in you to burn and something in you is burning anyway.",
  ] },
  { at: 12, every: 8, lines: [
    "You're starving. Not hungry — starving. There's a difference and you have found it.",
    'Your hands have a tremor in them that has nothing to do with the cold.',
    'Standing up takes a decision now.',
  ] },
  { at: 25, every: 14, lines: [
    "It's getting hard to think about anything that isn't food.",
    'Your stomach has stopped asking politely.',
    'You keep noticing what other people are eating. All of it. Every time.',
  ] },
  { at: 40, every: 22, lines: [
    "You're hungry.",
    'Your stomach turns over, unimpressed with the arrangement.',
    "You could put away something substantial, if the Basin had any.",
  ] },
  { at: 58, every: 35, lines: [
    'You could eat.',
    "A meal wouldn't go amiss.",
  ] },
];

const THIRST_BANDS = [
  { at: 5, every: 3, lines: [
    'Your tongue is stuck to the roof of your mouth. Swallowing has become a project.',
    "You're dying of thirst, and rather faster than you would die of anything else.",
  ] },
  { at: 15, every: 6, lines: [
    'Your head is pounding and your mouth tastes of coins.',
    "You're badly dehydrated. Everything has gone slightly too bright.",
    "You have stopped sweating properly. That isn't an improvement.",
  ] },
  { at: 30, every: 11, lines: [
    'Your throat is raw and your lips have started to split.',
    'You would drink something you had questions about.',
    'Thirst has moved from the background to the front.',
  ] },
  { at: 48, every: 18, lines: [
    "You're thirsty.",
    'Your mouth is dry.',
  ] },
  { at: 62, every: 28, lines: [
    'You could do with a drink.',
    'Your throat is dry enough to notice.',
  ] },
];

// Climbing back OUT of the two worst bands is worth one line; everything above that is
// silent, because relief that announces itself as loudly as danger flattens both.
const HUNGER_RELIEF = 'The gnawing lets up. You can think about other things again.';
const THIRST_RELIEF = "Your mouth stops feeling like a drain. That's most of it.";
const RELIEF_FROM_INDEX = 1;   // bands 0 and 1 are the ones worth marking a recovery from

// Indices run WORST-FIRST, so a lower index is a worse state — which means "fine" has to sort
// ABOVE every band, not below it. Returning -1 here made entering the mildest band read as a
// recovery (-1 -> 4 looks like climbing), and the first thing a hungry player was told was
// that the gnawing had let up. `bands.length` is the honest sentinel.
const FINE = (bands) => bands.length;
const bandFor = (bands, v) => {
  for (let i = 0; i < bands.length; i++) if (v <= bands[i].at) return i;
  return FINE(bands);
};

// One meter's worth. Mutates the two bits of state it owns and returns a line or null.
function step(player, key, bands, value, gm, relief) {
  const idxKey = `_${key}Band`, accKey = `_${key}Acc`, rotKey = `_${key}Rot`;
  const now = bandFor(bands, value);
  const was = player[idxKey];
  player[idxKey] = now;

  // CLIMBING OUT is checked first, and deliberately before the "you're fine now" exit — a
  // player who eats their way from starving all the way back to comfortable has jumped
  // straight past every band, and that is exactly the moment the relief line is FOR. Testing
  // "fine" first swallowed it, so the one message that confirms you fixed the problem only
  // appeared if you fixed it halfway.
  if (was !== undefined && now > was) {
    player[accKey] = 0;
    return was <= RELIEF_FROM_INDEX ? relief : null;
  }
  if (now >= bands.length) { player[accKey] = 0; return null; }
  // At ZERO the damage line already fires every single minute ("Starvation is taking its
  // toll. (-1 HP)"), and it says everything this would. Two systems narrating the same
  // moment is how the old implementation got to four lines a minute; the flavour stands
  // aside and lets the consequence speak.
  if (value <= 0) { player[accKey] = 0; return null; }

  // Crossing DOWN into a new band is an event and speaks at once. `was === undefined` is a
  // fresh login, which counts: you should be told where you stand the first time it ticks.
  if (was === undefined || now < was) {
    player[accKey] = 0;
    const band = bands[now];
    const rot = player[rotKey] = ((player[rotKey] ?? -1) + 1);
    return band.lines[rot % band.lines.length];
  }
  // Sitting in it: repeat on the band's own cadence.
  player[accKey] = (player[accKey] || 0) + gm;
  const band = bands[now];
  if (player[accKey] < band.every) return null;
  player[accKey] = 0;
  const rot = player[rotKey] = ((player[rotKey] ?? -1) + 1);
  return band.lines[rot % band.lines.length];
}

// Called once per resource tick. Returns 0–2 lines.
export function appetiteMessages(player, gm = 1) {
  const out = [];
  const h = step(player, 'hunger', HUNGER_BANDS, player.hunger ?? 100, gm, HUNGER_RELIEF);
  if (h) out.push(h);
  const t = step(player, 'thirst', THIRST_BANDS, player.thirst ?? 100, gm, THIRST_RELIEF);
  if (t) out.push(t);
  return out;
}

// ── Satiation ────────────────────────────────────────────────────────────────
//
// The half that was missing entirely. `digestive_load` has always existed — eating adds
// `restoreHunger × 0.7` to it (bodily.js foodLoad) — but the only feedback it ever produced was eventually needing
// the toilet, so a full stomach was a state the game could not express. That meant a player
// could not learn portion sizes, and the value of a given meal was invisible.
//
// Read AFTER the meal lands, so it describes where you have ended up rather than what you
// ate. A bar tells you how empty you are; this is the only thing that tells you how full.
// One line per band would be right if you ate once. You eat constantly, so the
// same sentence at the same fullness becomes wallpaper within an hour and stops
// being read at all. Several per band, picked at random, keeps the information
// arriving as language rather than as a status code you learn to skip.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const SATIATION = {
  stuffed: [
    "You couldn't manage another bite, and you should probably stop trying.",
    "Your stomach has opinions about that last mouthful, and they aren't kind ones.",
    'That was too much. You know it was too much. You ate it anyway.',
  ],
  full: [
    "You're full — properly, heavily full. It was worth it.",
    "That's enough. That's comfortably, unarguably enough.",
    'You sit back and let it settle. Nothing about you wants anything for a while.',
  ],
  sated: [
    'You sit back. For the first time today, nothing in you is asking for anything.',
    'The gnawing stops. You had almost stopped noticing it was there.',
    'Something in your middle unclenches. You had been carrying that all day.',
  ],
  eased: [
    'That takes the edge off.',
    'The worst of it goes quiet.',
    'Better. Not finished, but better.',
  ],
  partial: [
    "It helps. It doesn't fix it.",
    'A dent in it. No more than a dent.',
    'Your stomach acknowledges the gesture and goes back to complaining.',
  ],
  trivial: [
    "It barely registers. You're going to need considerably more than that.",
    'That disappears into you without touching the sides.',
    'You may as well have thought about food.',
  ],
};

export function satiationLine(player) {
  const hunger = Number(player?.hunger ?? 0);
  const load = Number(player?.digestive_load ?? 0);
  if (load >= 95) return pick(SATIATION.stuffed);
  if (load >= 70) return pick(SATIATION.full);
  if (hunger >= 85) return pick(SATIATION.sated);
  if (hunger >= 60) return pick(SATIATION.eased);
  if (hunger >= 30) return pick(SATIATION.partial);
  return pick(SATIATION.trivial);
}

// The drinking half. Thirst has no `digestive_load` equivalent that matters here — hydration
// load exists but tops out at "you need the toilet", which is a different sentence — so this
// reads off thirst alone.
const SLAKE = {
  done: [
    "You drink until you have to stop for breath. That's that dealt with.",
    'You keep going well past needing to, because you can.',
    "You drain it and stand there a moment, not thirsty. It's a strange feeling.",
  ],
  good: [
    "That's better. Considerably better.",
    'The dust goes out of your throat.',
    "Your head clears a little, which you hadn't expected.",
  ],
  helps: [
    'It helps. Your mouth stops sticking to itself.',
    'Enough to talk properly again, at least.',
    'The worst of the dryness lifts.',
  ],
  start: [
    'A start. Not enough of one.',
    "Your throat notices. It isn't impressed.",
    'That wets your mouth and very little else.',
  ],
  trivial: [
    'It disappears into you and barely touches the sides.',
    'You may as well have licked the lid.',
    'Gone before you register drinking it.',
  ],
};

export function slakeLine(player) {
  const thirst = Number(player?.thirst ?? 0);
  if (thirst >= 95) return pick(SLAKE.done);
  if (thirst >= 75) return pick(SLAKE.good);
  if (thirst >= 45) return pick(SLAKE.helps);
  if (thirst >= 20) return pick(SLAKE.start);
  return pick(SLAKE.trivial);
}

/**
 * Whether the portion was WASTED, said in words.
 *
 * `gained` is what the body absorbed; `offered` is what the item was worth. The
 * gap between them is the one thing the fullness line above cannot say — "you
 * are full" reads the same whether you finished a ration or threw away most of
 * a banquet, and the waste is precisely the lesson about portion sizes.
 *
 * DELIBERATELY NOT A NUMBER. Hunger and thirst have no bar any more; quoting
 * "+6, 14 wasted" would be a receipt against a scale the player cannot see, and
 * it turns a sentence about a body into a line of accounting. The information is
 * identical; only the register changes.
 *
 * Silent when little or nothing was lost, so an ordinary meal is just the meal.
 */
const WASTE = {
  most: {
    hunger: ['Most of it goes to waste — you were fuller than you thought.',
             'You get perhaps a third of the way through before your stomach refuses the rest.',
             "The rest of it's a gift to the floor. You had no room for it."],
    thirst: ['Most of it goes straight through you and does nothing at all.',
             'You manage a few swallows and give up. There was nowhere for it to go.',
             'The rest runs down your chin, unwanted.'],
  },
  some: {
    hunger: ['A fair bit of it goes uneaten.', 'You leave more of it than you meant to.'],
    thirst: ['You leave a good deal of it.', 'More of it than you would like goes unswallowed.'],
  },
};

export function portionLine(kind, gained, offered) {
  const got = Math.max(0, Number(gained) || 0);
  const had = Math.max(0, Number(offered) || 0);
  if (had <= 0) return '';
  const lost = (had - got) / had;
  const bank = kind === 'thirst' ? 'thirst' : 'hunger';
  if (lost >= 0.6) return ' ' + pick(WASTE.most[bank]);
  if (lost >= 0.3) return ' ' + pick(WASTE.some[bank]);
  return '';
}

// SATIATION/SLAKE are exported for the suite so it can assert the BAND a state
// maps to rather than a keyword in one particular phrasing. Keyword assertions
// silently become flaky the moment a band gains a variant that happens not to
// contain the magic word — which is exactly what happened when these grew from
// one line each to three.
export const _test = {
  HUNGER_BANDS, THIRST_BANDS, bandFor, step, HUNGER_RELIEF, THIRST_RELIEF, RELIEF_FROM_INDEX,
  SATIATION, SLAKE, WASTE,
};
