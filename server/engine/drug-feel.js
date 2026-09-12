// ── WHAT IT IS DOING TO YOU, SAID IN THE BODY'S OWN WORDS ────────────────────
//
// Every drug in the game moves your stats and, until this file, none of them
// ever SAID SO. You could ride a full peak of something that took five off your
// reflexes and the only evidence was that you started missing — which reads as
// bad luck, not as the pill you swallowed. The numbers were legible in exactly
// one place, `habits`, gated behind having ridden a peak, and expressed as a
// table. A table is a thing you read; this is a thing you notice about yourself.
//
// THE RULE: the line is DERIVED FROM THE ACTUAL MODS, never authored beside
// them. An author who wrote "your hands are ahead of you" next to a +3 reflexes
// would be maintaining the same fact twice, and the day somebody retuned the
// number the prose would keep the old promise. So `feelLines()` takes the block
// the engine is about to apply and describes that, which means:
//
//   • all 39 drugs got this at once, with nothing authored
//   • a drug whose peak is retuned re-describes itself with no edit
//   • a spliced compound — whose mods nobody could have written prose for,
//     because the player composed them a minute ago — describes itself too
//
// It is deliberately NOT a read-out. No numbers, no stat names in the client's
// vocabulary, no plus signs: the player is told what their body is doing and has
// to work out what that means, which is the same contract `DRUG_FACTS` is built
// on. Two drugs pulling the same stat in opposite directions each say their own
// piece, because that is how it would feel.

// Magnitude bands. A drug moves a stat by 1-2 (you might be imagining it), 3-5
// (you are not) or 6+ (it is the only thing you can think about). Three lines
// per direction per stat, so the same drug does not read identically every time
// and two drugs on the same stat do not sound like one.
const SLIGHT = 2, MARKED = 5;

function band(v) {
  const a = Math.abs(v);
  return a <= SLIGHT ? 0 : a <= MARKED ? 1 : 2;
}

// [stat][up|down][band] — each a sentence about the BODY, never about a number.
// Written to the house standard: the specific event, not the mood.
const FEEL = {
  stat_brawn: {
    up: [
      'Your arms feel like they have been waiting for something to do.',
      'There is more of you than there was. Doors feel lighter than they are.',
      'You could pick up the room. You are aware that this is not a thought you normally have.',
    ],
    down: [
      'Your grip is not quite closing on things the way you meant it to.',
      'Everything you pick up is heavier at the far end than it should be.',
      'Your arms have gone somewhere else and left the sleeves.',
    ],
  },
  stat_reflexes: {
    up: [
      'Your hands are getting to things a half-beat before you ask them to.',
      'You catch something before you notice it falling.',
      'The room has slowed down for your convenience, and you are the only fast thing in it.',
    ],
    down: [
      'Your hands arrive a little after you send them.',
      'You reach for something and watch your own arm take the long way round.',
      'There is a gap between deciding and moving, and you can feel the whole of it.',
    ],
  },
  stat_brains: {
    up: [
      'Your thoughts are queueing politely instead of shouting.',
      'Two things you had never connected line up and stay lined up.',
      'Everything makes sense, all at once, and you can hold all of it.',
    ],
    down: [
      'You lose the end of a thought and cannot find where you put it.',
      'Words are arriving out of order and you are letting them.',
      'You have a thought. It is gone. You have another one about having had it.',
    ],
  },
  stat_cool: {
    up: [
      'Nothing in the room is worth getting worked up about.',
      'Your pulse settles into something slow and unbothered.',
      'You could be told the worst news of your life right now and ask a follow-up question.',
    ],
    down: [
      'Your jaw is tight and you are not sure when that started.',
      'Something in your chest keeps checking the exits.',
      'Your nerve is gone, all of it, and you can hear your own heart doing it.',
    ],
  },
  stat_endurance: {
    up: [
      'Your lungs have more room in them than usual.',
      'You feel like you could keep going a good while past where you normally stop.',
      'Tiredness is a thing that happens to other people, for now.',
    ],
    down: [
      'You are breathing a little harder than standing still ought to cost.',
      'Something is draining out of you steadily and will not be topped up.',
      'You are tired in the bones, past the point where sitting down would help.',
    ],
  },
  stat_senses: {
    up: [
      'Edges are sharper than they were. You can hear the room working.',
      'You pick a single conversation out of a street.',
      'Everything is coming in at once, all of it, and none of it is filtered.',
    ],
    down: [
      'The far side of the room has gone slightly out of focus.',
      'Sound is arriving through something.',
      'You are down to one sense at a time, and it keeps being the wrong one.',
    ],
  },
  hp_max: {
    up: ['You feel harder to hurt than you were.', 'Your body has quietly raised its own ceiling.', 'You feel, wrongly, like nothing could put you down.'],
    down: ['You feel thinner than usual, easier to break.', 'Something has been taken out of your reserves.', 'You are running on what is left, and it is not much.'],
  },
  stamina_max: {
    up: ['There is more wind in you than there was.', 'Your second wind has arrived early and brought a third.', 'You have stopped being able to feel where your limit is.'],
    down: ['You run out sooner than you expect to.', 'Your reserves are short and you can feel the end of them.', 'There is almost nothing left in the tank and the gauge is stuck.'],
  },
};

// The drip keys are a rate, not a buff, so they are described as a PROCESS —
// something happening to you continuously rather than a state you are in.
const DRIP = {
  hp_regen_per_sec:      { up: 'Something is knitting, slowly, under the skin.', down: 'Something is going wrong under the skin and it is not stopping.' },
  stamina_regen_per_sec: { up: 'Your wind keeps coming back faster than you spend it.', down: 'You are leaking energy steadily and cannot find the hole.' },
  sanity_regen_per_sec:  { up: 'The noise at the back of your head has stopped for once.', down: 'Something at the back of your head has started up and is getting louder.' },
};

const REGEN_RE = /_regen_per_sec$/;

/**
 * Body-language lines for a block of stat mods, strongest first.
 *
 * `limit` caps how many are spoken. THREE is not arbitrary: a drug that moved
 * six stats printed six sentences in one beat, which reads as a status screen
 * rather than as a feeling, and the three biggest movers are the three you would
 * actually notice. The rest are still happening — they are just not what you
 * would say about yourself.
 *
 * ⚠ Deterministic, and that is the point rather than a shortcut: the line IS the
 * magnitude band, so the same dose always reads the same way and a player can
 * learn the difference between "a little after you send them" and "the whole of
 * it". A random pick would turn the prose into noise instead of information.
 */
export function feelLines(mods, { limit = 3 } = {}) {
  if (!mods) return [];
  const entries = [];
  for (const [k, raw] of Object.entries(mods)) {
    const v = Number(raw);
    if (!v) continue;
    if (REGEN_RE.test(k)) {
      const d = DRIP[k];
      if (d) entries.push({ weight: Math.abs(v) * 60, line: v > 0 ? d.up : d.down });
      continue;
    }
    const table = FEEL[k];
    if (!table) continue;
    const side = v > 0 ? table.up : table.down;
    entries.push({ weight: Math.abs(v), line: side[band(v)] });
  }
  // Strongest mover first — that is the one you would mention. Ties keep author
  // order, which is stable across runs because Object.entries is.
  entries.sort((a, b) => b.weight - a.weight);
  const out = [];
  for (const e of entries) {
    if (out.includes(e.line)) continue;   // two stats can land on one sentence; say it once
    out.push(e.line);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The same thing as one client-ready line, or '' when the block moves nothing.
 * Wrapped in its own class so a player can style or gag it separately from the
 * authored prose it follows — this is the body talking, not the narrator.
 */
export function feelText(mods, opts) {
  const lines = feelLines(mods, opts);
  if (!lines.length) return '';
  return `<span class="drug-feel">${lines.join(' ')}</span>`;
}

// Exported so the regress suite can assert the vocabulary is complete — every
// stat key any drug authors has to have a sentence, or the drug moves something
// in silence and we are back where we started.
export const _test = { FEEL, DRIP, band, SLIGHT, MARKED };
export const FEELABLE_KEYS = [...Object.keys(FEEL), ...Object.keys(DRIP)];
