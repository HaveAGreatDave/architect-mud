/**
 * Withdrawal gets a SEQUENCE instead of a single line.
 *
 * The mechanic already had a shape — `withdrawalSeverity()` ramps for half an
 * hour, holds at the worst of it for two, and tapers over six, bent by how deep
 * the habit got and by whether a same-class drug is holding some of it off. The
 * player was told about exactly one moment of that and then never heard from it
 * again, which made a six-hour arc read as a debuff that switched on.
 *
 * The fix is a `withdrawal.stages` block: one line per beat, fired when the beat
 * changes. Five beats, named by `withdrawalPhase()` in server/engine/drugs.js:
 *
 *   onset · rising · peak · easing · tail
 *
 * The prose rule comes from Confessions of an English Opium-Eater, which is the
 * best account of this in the language and disagrees with almost every line the
 * game had. De Quincey is emphatic that withdrawal is NOT low spirits — "the
 * mere animal spirits are uncommonly raised: the pulse is improved: the health
 * is better. It is not there that the suffering lies." It is specific, bodily
 * and undignified: sweating, sneezing for two hours at a stretch, ninety hours
 * of sleep he can hear himself having. His single best observation is medical
 * and is used below almost intact — that the suffering was caused by digestion
 * ITSELF, a process "which should naturally go on below the consciousness" and
 * had become distinctly perceptible. A body with the volume turned up on the
 * parts nobody is supposed to hear.
 *
 * So: no line here says you crave it, and no line here is about mood. That
 * phrasing was in nearly every message this replaced, and it is the one thing
 * the source text says is wrong.
 *
 * ⚠ `message` is NOT removed. It is what the drug-knowledge screen shows for
 * "what does coming off this cost" (drugs.js DRUG_FACTS.WITHDRAWAL), which is a
 * summary, not a beat. `stages.onset` supersedes it in play and it stays for the
 * card.
 *
 * TWO NEW WITHDRAWAL BLOCKS. `drug_ether` (0.15) and `drug_static` (0.18) could
 * addict a player and then do nothing at all, because the tick is gated on
 * `wd.mods` and they had no withdrawal block. They have one now.
 * ⚠ Thirteen further drugs were still in that position — see the report at the
 * end of this file. They were left alone here on the grounds that they are all
 * at 0.1 or below and mostly psychedelics. `withdrawal-tail-drugs.mjs` finished
 * the job: five of them are serotonergic psychedelics and went to
 * addiction_chance 0 rather than getting a symptom invented for them, and the
 * other eight got withdrawal blocks under this same prose law.
 *
 * ⚠ THIS TABLE IS THE SHIPPED PROSE, AND IT WENT STALE ONCE ALREADY. Every run
 * rewrites `stages` on all nineteen drugs from the literals below, so anything
 * that edits those lines in `content/` and not here is silently reverted the
 * next time somebody runs this. That is exactly what happened: the 2026-09-04
 * contractions rule swept `content/` via `contractions-pass.mjs`, this file was
 * not swept with it, and a later run put "will not stop" back over "won't stop"
 * across seventeen drugs in one go. The table has been resynced from shipped
 * content. **If you change a line here, it must be contracted** (the house rule
 * in docs/reference/plain-writing.md), and if you change one in `content/`,
 * change it here in the same commit or it will not survive.
 *
 *   node scripts/content/withdrawal-stages.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const DRUGS = path.join(process.cwd(), 'content', 'drugs');
const CHECK = process.argv.includes('--check');
const PHASES = ['onset', 'rising', 'peak', 'easing', 'tail'];

// Phrasing this pass exists to remove. De Quincey's whole first objection is
// that withdrawal is not a mood and not a wanting; it is a body doing its
// housekeeping out loud.
// ⚠ `\b` on the verb matters: without it this rejects "a word you wanted this
// morning", which is a memory failing rather than an appetite, and is exactly
// the sort of line the rule is meant to protect.
const BANNED = /\b(crav(e|ing)|you (want|need|miss)\b|you would kill|low spirits|depress)/i;

// ⚠ THE FIRST FOUR BEATS ALL HAPPEN INSIDE SIX HOURS, and the first draft of
// this file did not. Plotting `withdrawalPhase()` against the default curve
// gives onset at once, rising at 0.25h, peak at 0.5h, easing at 2.5h and tail
// at 6.1h — so seven authored lines were counting days, and two had the player
// sleeping fourteen hours forty-five minutes into it. Only `tail` persists
// indefinitely (it is where an addicted player actually lives), so only `tail`
// may talk in days. A duration word anywhere else needs an entry here saying
// why it is not a claim about elapsed withdrawal.
const LONG_UNITS = /\b(day|days|week|weeks|fortnight|month|months)\b/i;
const LONG_UNIT_ALLOWED = {
  'drug_ether/easing': 'idiom — "an ordinary bad day", not a count of days',
  'drug_lull/peak':    'refers to the night BEFORE, while still dosed, not to elapsed withdrawal',
};

const STAGES = {

  // ═══ OPIATES ═════════════════════════════════════════════════════════════
  // The two that get De Quincey's actual observations, because they are his.
  drug_blacktar: {
    onset:  "Your nose starts running and won't stop. It's such a small thing that it takes a while to understand it's the first one.",
    rising: "You sneeze eleven times in a row, and then again four minutes later, and your eyes won't stay dry.",
    peak:   "You can hear your own digestion. It has been going on your whole life underneath everything and now it's the loudest thing in the room, and there's nowhere to put your legs.",
    easing: "The sweating stops before the shaking does. You get an hour that feels like the end of it, and it's not.",
    tail:   "Six hours off the blacktar and still on your feet. Your legs won't let you sit down.",
  },
  drug_grey: {
    onset:  "A cold spot opens between your shoulder blades and stays there.",
    rising: "Every joint you own reports in. Nothing is injured. Everything is present.",
    peak:   "The pain grey was taking is all still there and has been the whole time, waiting, with interest on it.",
    easing: "It steps back far enough to be looked at, which isn't the same as going.",
    tail:   "You're functional and about a quarter of you is somewhere else, listening for it.",
  },

  // ═══ DEPRESSANTS ═════════════════════════════════════════════════════════
  // Alcohol is the one the medicine is actually frightened of. Opiate withdrawal
  // is agony and does not kill you; this one has a body count, and the reason is
  // in the beats below — it is the nervous system coming off a brake, so it goes
  // UP rather than down. The tremor first, then the sweats, then the part where
  // the room starts contributing. No line here says you are short of a drink,
  // under this file's law and because the line would be the least of it.
  drug_alcohol: {
    onset:  "Your hands are doing something small and constant, and looking at them doesn't stop it.",
    rising: "You're sweating through a shirt in a cold room, and your own pulse is audible, and neither of those has a reason.",
    peak:   "Everything in here has an extra edge on it, and one or two things have moved since you last looked. Your whole body is ringing like something struck it and nothing will make it stop.",
    easing: "It lets go of your hands before it lets go of the rest. You get an hour of thinking it's finished.",
    tail:   "You sleep in ninety-minute pieces and come out of each one already sitting up. Four days of that, and the nights are the last thing to come back.",
  },
  // ═══ THE LEGAL ONE NOBODY COUNTS ═════════════════════════════════════════
  // Caffeine withdrawal is the most widely experienced withdrawal there is and
  // the game did not have it. It is almost entirely one symptom, so these beats
  // track a single headache arriving, owning the place, and leaving, which is
  // honest: there is no second thing to describe and inventing one would make
  // it read like a harder drug than it is.
  drug_coffee: {
    onset:  "A dull pressure starts up behind one eye and settles in.",
    rising: "The headache has arrived properly now, and it has a pulse, and the pulse is yours.",
    peak:   "Light is too bright and sound is too close, and you've read the same line four times without any of it going in.",
    easing: "The head clears from the outside inward. There's a warm spot left in the middle of it.",
    tail:   "Functional. You surface about an hour later than you used to, and it takes the whole morning to be any use.",
  },
  drug_lull: {
    onset:  "The edges lull was filing come back on, all at once, at the same time.",
    rising: "Sounds arrive at full volume with nothing in front of them. A door two rooms away is an event.",
    peak:   "Your hands won't sit still on a table and your jaw aches from a night of doing something you weren't awake for.",
    easing: "You get twenty minutes of something adjacent to sleep and come out of it less rested than you went in.",
    tail:   "You can be in a room with people again. You're still counting the exits, and you weren't before.",
  },
  drug_slow: {
    onset:  "Everything has an edge on it again, and the edges are all facing you.",
    rising: "You keep turning round. There's nothing behind you and you keep turning round.",
    peak:   "The things slow was standing between you and are all in the room and none of them have aged.",
    easing: "It thins out into something you could carry if you had to.",
    tail:   "Quieter. Not quiet. You have started to be able to tell the difference.",
  },
  drug_toluene: {
    onset:  "The taste comes back first, at the back of the teeth, out of nowhere.",
    rising: "Your hands are unsteady enough to be a problem with small screws.",
    peak:   "Your head is packed tight and you have read the same line four times without any of it arriving.",
    easing: "The pressure lets off. Some of what it was pressing on doesn't come back.",
    tail:   "Steady hands. A word you wanted this morning has still not turned up.",
  },
  drug_ether: {
    onset:  "The smell arrives first, on your own hands, with no rag anywhere near them.",
    rising: "The room won't hold still at the corners, and shutting your eyes makes it worse rather than better.",
    peak:   "You're sick, and being sick doesn't help, and then you're sick again.",
    easing: "It settles into an ordinary bad day, which after the last one is almost hospitality.",
    tail:   "Level. The smell is still turning up in places it has no business being.",
  },

  // ═══ STIMULANTS ══════════════════════════════════════════════════════════
  drug_redline: {
    onset:  "Your teeth find each other and start working.",
    rising: "Everything is slow. The lift, the door, the person in front of you, all of it, and none of it actually is.",
    peak:   "Your heart has been going for no reason since you sat down, and sitting down was supposed to be the answer.",
    easing: "The world comes back up to its own speed, which turns out to have been the speed the whole time.",
    tail:   "Baseline. It reads as slow because you have spent a fortnight being wrong about what fast is.",
  },
  drug_coldfire: {
    onset:  "The fear you were converting into fuel arrives unconverted.",
    rising: "Your hands go before your head does. You notice them going and can't make them stop.",
    peak:   "Everything is a threat and you have no procedure for any of it, and this is what everybody else has been doing all along without help.",
    easing: "It burns down into ordinary nerves, and ordinary nerves are survivable.",
    tail:   "You're frightened of things at roughly the correct size again. It's an unfamiliar amount.",
  },
  drug_overclock: {
    onset:  "The lace goes quiet. Not off. Quiet, the way a fan you had stopped hearing stops.",
    rising: "You reach for a thing you know and it isn't there for about a second, and the second is very long.",
    peak:   "Every thought you had parked comes back at once and there are far too many to hold and none of them will wait their turn.",
    easing: "They start queuing again. Slowly, and in the wrong order.",
    tail:   "You think at the speed you were issued with. You keep catching yourself waiting for the other one.",
  },
  drug_static: {
    onset:  "The clarity goes off like a light, and you're left holding what you were doing.",
    rising: "You read a page and it doesn't stick, and you read it again and it doesn't stick.",
    peak:   "The clean straight line the mist put through your head is gone and the room is putting out about four hundred things a second, all of them equally important.",
    easing: "You can follow one thing at a time. One isn't many but it's a number.",
    tail:   "Ordinary attention, doing ordinary work. You're aware of how much of it there used to be.",
  },

  // ═══ DISSOCIATIVES ═══════════════════════════════════════════════════════
  drug_khole: {
    onset:  "You're very definitely inside your own body and can feel where all of it is.",
    rising: "Your own hands keep being yours. This has stopped being obvious and started being a fact you notice.",
    peak:   "There's no distance left between you and any of it, and the funnel was distance, and it's closed.",
    easing: "A little room opens back up, on its own, without being asked for.",
    tail:   "You're here. You keep checking the corner where the door used to not be.",
  },
  drug_deadair: {
    onset:  "The blue quiet goes off and the channel comes back in, loud.",
    rising: "Everything is broadcasting. All of it at once and all of it addressed to you.",
    peak:   "There's no space between the signals at all. The gap dead air lives in has closed and every surface in this room is saying something.",
    easing: "It thins to a hiss you can work through.",
    tail:   "Tuned in. Occasionally you catch yourself listening for the part between the stations.",
  },
  drug_dxm: {
    onset:  "The distance goes. Everything is at the end of your arms again.",
    rising: "Sounds arrive on time, at full size, in the room you're in.",
    peak:   "Nothing is happening at a remove any more. It's all happening at exactly the range it's happening at, which is here.",
    easing: "The plateau lets you down onto flat ground, and the flat ground holds.",
    tail:   "Near. Everything is near. You have got most of the way to used to it.",
  },

  // ═══ THE STRANGE ONES ════════════════════════════════════════════════════
  drug_glasshollow: {
    onset:  "The world thickens up. Everything is exactly as solid as it says it is.",
    rising: "You keep checking corners for a seam and finding a corner.",
    peak:   "It's all completely certain of itself and none of it'll admit anything, and the thing you saw through the thin patch is still in the room and has stopped being visible.",
    easing: "The certainty stops being aggressive about it.",
    tail:   "Solid, ordinary, and closed. The legions are drawing off and not all of them have gone.",
  },
  drug_memhack: {
    onset:  "Something comes back with its barbs on.",
    rising: "They arrive out of order, unfiled, at full resolution, and none of them knock.",
    peak:   "Everything memhack sanded down is back and it's back sharp, and you're finding out that filing a thing isn't the same as being rid of it.",
    easing: "They start letting you look away.",
    tail:   "Everything is where you left it, with the edges on. That was always going to be the deal.",
  },
  drug_ibogaine: {
    onset:  "The thread you were being shown goes slack.",
    rising: "You keep waiting for it to finish telling you the thing. It stopped a while ago.",
    peak:   "It laid your whole life out and then left the room, and you're the only one here who saw it, and you can't get it back to check.",
    easing: "You stop reaching for it every few minutes.",
    tail:   "Whatever it showed you is yours now, unverified, and it isn't coming back to confirm anything.",
  },
  drug_nitrous: {
    onset:  "Your hands and feet start buzzing, and there's no bulb, and the buzzing goes on anyway.",
    rising: "It's in your fingers and it's in your feet and it isn't the good buzzing.",
    peak:   "The buzzing hasn't stopped once, and it stopped being funny somewhere in the first hour, and it's still going.",
    easing: "It backs off to your fingertips and stays there.",
    tail:   "Mostly gone. Something in your feet hasn't entirely agreed to that.",
  },
  drug_cigarettes: {
    onset:  "Your hands go looking for something and come back with nothing.",
    rising: "They keep doing it. Pocket, mouth, pocket, and each time the whole way round before remembering.",
    peak:   "Your hands have gone to the pocket eleven times in the last hour and found it empty eleven times, and they're going again now.",
    easing: "They find other things to do. Badly, and with resentment.",
    tail:   "They have stopped asking. They still go to the pocket about once an afternoon.",
  },
};

// New withdrawal blocks for drugs that could hook a player and then do nothing,
// because the tick is gated on `wd.mods`.
const NEW_BLOCKS = {
  // Two hours dry, the longest onset here, because the tell is the NEXT
  // morning rather than the same afternoon.
  drug_coffee: {
    message: "Your head has a pulse in it, and the light is louder than it was.",
    mods: { stat_brains: -2, stat_cool: -1 },
    onset_seconds: 7200,
  },
  // Alcohol arrived here from the other direction: it could not hook anybody at
  // all, because `addiction_chance` was 0. `alcohol-arc.mjs` raises it to 0.12,
  // which is what makes this block reachable. Onset is 90 minutes dry, longer
  // than any other row here, because the first morning is the tell and the
  // afternoon of the same day is not.
  drug_alcohol: {
    message: "Your hands won't be still, and the room has started putting things in the corners of itself.",
    mods: { hp_max: -10, stat_brains: -2, stat_cool: -3, stat_reflexes: -3 },
    onset_seconds: 5400,
  },
  drug_ether: {
    message: 'The room will not hold still, and the smell is on you when it should not be.',
    mods: { stat_cool: -2, stat_reflexes: -1 },
    onset_seconds: 1200,
  },
  drug_static: {
    message: 'The clean line through your head is gone and the room is putting out four hundred things at once.',
    mods: { stat_brains: -2, stat_cool: -1 },
    onset_seconds: 900,
  },
};

// ─── apply ───────────────────────────────────────────────────────────────────
let staged = 0, created = 0, lines = 0;
const problems = [];

for (const [id, stages] of Object.entries(STAGES)) {
  const file = path.join(DRUGS, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such drug file`); continue; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));

  d.effects = d.effects || {};
  if (!d.effects.withdrawal) {
    const seed = NEW_BLOCKS[id];
    if (!seed) { problems.push(`${id}: no withdrawal block and no seed to create one from`); continue; }
    d.effects.withdrawal = { ...seed };
    created++;
  }
  const wd = d.effects.withdrawal;

  const keys = Object.keys(stages);
  if (keys.length !== PHASES.length || keys.some((k) => !PHASES.includes(k))) {
    problems.push(`${id}: stages must be exactly [${PHASES.join(', ')}], got [${keys.join(', ')}]`);
    continue;
  }
  for (const [phase, line] of Object.entries(stages)) {
    if (BANNED.test(line)) problems.push(`${id}/${phase}: uses the mood-and-wanting phrasing this pass exists to remove`);
    if (phase !== 'tail' && LONG_UNITS.test(line) && !LONG_UNIT_ALLOWED[`${id}/${phase}`]) {
      problems.push(`${id}/${phase}: counts days in a beat that fires inside six hours (only 'tail' persists) — fix it or allowlist it with a reason`);
    }
    if (line.length > 260) problems.push(`${id}/${phase}: ${line.length} chars, too long for a tick line`);
  }
  // Every drug keeps a summary for the knowledge card.
  if (!wd.message) problems.push(`${id}: withdrawal has no summary message for the drug-knowledge card`);
  // Withdrawal that is authored but has no mods never fires at all.
  if (!wd.mods || !Object.keys(wd.mods).length) problems.push(`${id}: withdrawal has no mods, so the tick will never run it`);

  wd.stages = stages;
  lines += PHASES.length;
  staged++;
  if (!CHECK) fs.writeFileSync(file, canonicalJson(d), 'utf8');
}

// ─── report the gap this pass deliberately does NOT close ────────────────────
const stillBare = [];
for (const f of fs.readdirSync(DRUGS)) {
  const d = JSON.parse(fs.readFileSync(path.join(DRUGS, f), 'utf8'));
  const wd = (d.effects || {}).withdrawal;
  // In --check nothing was written, so the two blocks this run creates would
  // still read as bare off disk. Exclude anything this pass handles.
  if (NEW_BLOCKS[d.id] || STAGES[d.id]) continue;
  if ((d.addiction_chance || 0) > 0 && (!wd || !wd.mods)) stillBare.push(`${d.id} (${d.addiction_chance})`);
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Withdrawal: ${staged} drug(s) staged, ${lines} beat(s), ${created} new withdrawal block(s).`);
if (stillBare.length) {
  console.log(`\n  Still addictive with no withdrawal that can fire (left alone on purpose, all <= 0.1):`);
  console.log('  ' + stillBare.join(', '));
}
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
