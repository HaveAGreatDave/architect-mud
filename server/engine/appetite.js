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
    'There is nothing left in you to burn and something in you is burning anyway.',
  ] },
  { at: 12, every: 8, lines: [
    'You are starving. Not hungry — starving. There is a difference and you have found it.',
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
    'A meal would not go amiss.',
  ] },
];

const THIRST_BANDS = [
  { at: 5, every: 3, lines: [
    'Your tongue is stuck to the roof of your mouth. Swallowing has become a project.',
    'You are dying of thirst, and rather faster than you would die of anything else.',
  ] },
  { at: 15, every: 6, lines: [
    'Your head is pounding and your mouth tastes of coins.',
    'You are badly dehydrated. Everything has gone slightly too bright.',
    'You have stopped sweating properly. That is not an improvement.',
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
const THIRST_RELIEF = 'Your mouth stops feeling like a drain. That is most of it.';
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
export function satiationLine(player) {
  const hunger = Number(player?.hunger ?? 0);
  const load = Number(player?.digestive_load ?? 0);
  if (load >= 95) return "You could not manage another bite, and you should probably stop trying.";
  if (load >= 70) return 'You are full — properly, heavily full. It was worth it.';
  if (hunger >= 85) return 'You sit back. For the first time today, nothing in you is asking for anything.';
  if (hunger >= 60) return 'That takes the edge off.';
  if (hunger >= 30) return "It helps. It does not fix it.";
  return 'It barely registers. You are going to need considerably more than that.';
}

// The drinking half. Thirst has no `digestive_load` equivalent that matters here — hydration
// load exists but tops out at "you need the toilet", which is a different sentence — so this
// reads off thirst alone.
export function slakeLine(player) {
  const thirst = Number(player?.thirst ?? 0);
  if (thirst >= 95) return 'You drink until you have to stop for breath. That is that dealt with.';
  if (thirst >= 75) return 'That is better. Considerably better.';
  if (thirst >= 45) return 'It helps. Your mouth stops sticking to itself.';
  if (thirst >= 20) return 'A start. Not enough of one.';
  return 'It disappears into you and barely touches the sides.';
}

/**
 * The amount actually taken on, as a quiet clause after the prose.
 *
 * `gained` is what the body ABSORBED; `offered` is what the item was worth. When
 * they differ you were already close to full, and saying so is the entire point —
 * it is the only way a player ever learns that finishing a banquet on a full
 * stomach throws most of it away. When they match, the waste clause is omitted
 * rather than reading "(+20, none wasted)" on every single meal.
 *
 * Returns '' when nothing landed, so a drink taken at full hydration reads as the
 * prose alone rather than "(+0)".
 */
export function appetiteGain(kind, gained, offered) {
  const got = Math.round(Number(gained) || 0);
  if (got <= 0) return '';
  const had = Math.round(Number(offered) || 0);
  const wasted = had - got;
  const tail = wasted > 0 ? `, ${wasted} wasted` : '';
  return ` <span class="text-dim">(+${got} ${kind}${tail})</span>`;
}

export const _test = { HUNGER_BANDS, THIRST_BANDS, bandFor, step, HUNGER_RELIEF, THIRST_RELIEF, RELIEF_FROM_INDEX };
