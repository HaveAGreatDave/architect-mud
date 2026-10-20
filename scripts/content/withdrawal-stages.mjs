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
    onset:  "Your nose starts running and won't stop. It's a while before you realise it's the first sign.",
    rising: "You sneeze eleven times in a row, then again a few minutes later. Your eyes keep watering.",
    peak:   "You can feel your stomach working, every churn of it. Your legs ache and you can't keep them still.",
    easing: "The sweating stops before the shaking does. For an hour it feels like it's over. It isn't.",
    tail:   "You're back on your feet, but your legs still won't let you sit down for long.",
  },
  drug_grey: {
    onset:  "A cold patch settles between your shoulder blades and stays.",
    rising: "Every joint aches. Nothing's injured. It all just hurts.",
    peak:   "All the pain the grey was blocking is back at once, and worse than before.",
    easing: "The pain backs off a little. It's still there.",
    tail:   "You can get through the day, but part of you is always waiting for the pain to come back.",
  },

  // ═══ DEPRESSANTS ═════════════════════════════════════════════════════════
  // Alcohol is the one the medicine is actually frightened of. Opiate withdrawal
  // is agony and does not kill you; this one has a body count, and the reason is
  // in the beats below — it is the nervous system coming off a brake, so it goes
  // UP rather than down. The tremor first, then the sweats, then the
  // hallucinations. No line here says you are short of a drink, under this
  // file's law and because the line would be the least of it.
  drug_alcohol: {
    onset:  "Your hands have a small shake, and you can't stop it.",
    rising: "You're sweating in a cold room and your heart is pounding, and you haven't done anything.",
    peak:   "Your whole body is shaking. Things move at the edge of your vision, and when you look, nothing's there.",
    easing: "Your hands steady first. For an hour you think it's over.",
    tail:   "You can't sleep more than an hour or two at a time, and you wake up with a jolt every time. It'll be days before you sleep through the night again.",
  },
  // ═══ THE LEGAL ONE NOBODY COUNTS ═════════════════════════════════════════
  // Caffeine withdrawal is the most widely experienced withdrawal there is and
  // the game did not have it. It is almost entirely one symptom, so these beats
  // track a single headache arriving, owning the place, and leaving, which is
  // honest: there is no second thing to describe and inventing one would make
  // it read like a harder drug than it is.
  drug_coffee: {
    onset:  "A dull pressure starts behind one eye.",
    rising: "It's a proper headache now, throbbing in time with your pulse.",
    peak:   "Light hurts, noise hurts, and you've read the same line four times without taking it in.",
    easing: "The headache fades, leaving a dull spot in the middle.",
    tail:   "You're fine, but you wake up later than you used to and you're useless until lunch.",
  },
  drug_lull: {
    onset:  "Everything the lull was muffling comes back at once.",
    rising: "Every sound is too loud. A door shutting two rooms away makes you jump.",
    peak:   "Your hands won't stay still and your jaw aches from clenching it in your sleep.",
    easing: "You doze for twenty minutes and wake up more tired than before.",
    tail:   "You can be around people again, but you still check where the exits are.",
  },
  drug_slow: {
    onset:  "Everything feels sharp again, and all of it seems aimed at you.",
    rising: "You keep looking over your shoulder. Nothing's there.",
    peak:   "Everything the slow kept away is back, and it hasn't got any easier to face.",
    easing: "It drops to something you can live with.",
    tail:   "It's quieter now. Not quiet, but you can tell the difference.",
  },
  drug_toluene: {
    onset:  "You can suddenly taste it again, at the back of your teeth.",
    rising: "Your hands shake too much for fiddly work.",
    peak:   "Your head feels packed tight, and you've read the same line four times without taking it in.",
    easing: "The pressure eases off. Some of what it pressed on doesn't come back.",
    tail:   "Your hands are steady. You still keep losing words.",
  },
  drug_ether: {
    onset:  "You can smell it on your hands, though there's no rag anywhere near you.",
    rising: "The room won't stay still, and closing your eyes makes it worse.",
    peak:   "You throw up, and it doesn't help, and then you throw up again.",
    easing: "It settles into an ordinary bad day, which is a relief.",
    tail:   "You're steady, but you still catch the smell in places it shouldn't be.",
  },

  // ═══ STIMULANTS ══════════════════════════════════════════════════════════
  drug_redline: {
    onset:  "You start grinding your teeth.",
    rising: "Everything seems slow: the lift, the door, the person in front of you. It isn't, really.",
    peak:   "Your heart's racing and you've only been sitting down, which was meant to help.",
    easing: "The world feels like it's speeding back up. It was never slow.",
    tail:   "Normal speed. It still feels slow, because you'd forgotten what normal was.",
  },
  drug_coldfire: {
    onset:  "The fear you used to turn into energy is just fear again.",
    rising: "Your hands start shaking before your nerve goes, and you can't stop them.",
    peak:   "Everything feels dangerous and you don't know how to handle any of it. This is how most people live, without the help.",
    easing: "It fades to ordinary nerves, and ordinary nerves you can handle.",
    tail:   "You're scared of the right things again, about the right amount. It feels strange.",
  },
  drug_overclock: {
    onset:  "The lace goes quiet, like a fan you'd stopped noticing switching off.",
    rising: "You reach for something you know and for a second it isn't there.",
    peak:   "Every thought you'd put aside comes back at once, far too many to keep track of.",
    easing: "Your thoughts start lining up again, slowly and out of order.",
    tail:   "You think at your normal speed now. You still catch yourself waiting for the faster one.",
  },
  drug_static: {
    onset:  "The clear head is gone in an instant, and you lose track of what you were doing.",
    rising: "You read a page and none of it sticks. You read it again. Still nothing.",
    peak:   "Your focus is gone, and everything in the room is fighting for your attention at once.",
    easing: "You can follow one thing at a time. It's a start.",
    tail:   "Your focus is back to normal. You notice how much sharper it used to be.",
  },

  // ═══ DISSOCIATIVES ═══════════════════════════════════════════════════════
  drug_khole: {
    onset:  "You're back in your body and you can feel every part of it.",
    rising: "You keep noticing your hands are yours, which you never used to think about.",
    peak:   "There's no distance between you and anything any more. The drug gave you that distance, and it's gone.",
    easing: "A bit of breathing room comes back by itself.",
    tail:   "You're here. You still look for the way out the drug used to give you.",
  },
  drug_deadair: {
    onset:  "The calm blue quiet switches off and the noise comes back, loud.",
    rising: "Everything feels like it's talking, and all of it's aimed at you.",
    peak:   "There's no quiet left anywhere. Every surface in the room seems to be saying something.",
    easing: "It fades to a hiss you can work through.",
    tail:   "You're back to normal. Now and then you listen for the quiet that isn't there.",
  },
  drug_dxm: {
    onset:  "The distance goes. Everything's within arm's reach again.",
    rising: "Sounds are loud and clear and right here.",
    peak:   "Nothing feels far away any more. It's all happening right in front of you.",
    easing: "You come down slowly and land on your feet.",
    tail:   "Everything feels close. You're mostly used to it.",
  },

  // ═══ THE STRANGE ONES ════════════════════════════════════════════════════
  drug_glasshollow: {
    onset:  "The world goes solid again. Everything looks exactly like what it is.",
    rising: "You keep checking corners for a gap, and they're just corners.",
    peak:   "Everything's solid and certain, but what you saw through the gaps is still there. You just can't see it now.",
    easing: "The world stops pressing in so hard.",
    tail:   "Everything's solid and ordinary again. Not everything you saw has gone away.",
  },
  drug_memhack: {
    onset:  "A memory comes back, and it still hurts.",
    rising: "More come back, out of order and perfectly clear, without warning.",
    peak:   "Everything memhack dulled is back as sharp as ever. Putting a memory away didn't get rid of it.",
    easing: "You can start looking away from them.",
    tail:   "Your memories are all back, sharp edges and all. That was always the price.",
  },
  drug_ibogaine: {
    onset:  "Whatever it was showing you starts to slip away.",
    rising: "You keep waiting for it to finish. It already has.",
    peak:   "It showed you your whole life and then stopped, and you can't go back to check what you saw.",
    easing: "You stop trying to get it back.",
    tail:   "You'll never know if what it showed you was true.",
  },
  drug_nitrous: {
    onset:  "Your hands and feet start tingling, with no balloon in sight.",
    rising: "The tingling spreads through your fingers and feet, and it isn't pleasant.",
    peak:   "The tingling hasn't stopped for an hour, and it's starting to worry you.",
    easing: "It fades back to your fingertips and stays there.",
    tail:   "It's mostly gone. Your feet still tingle now and then.",
  },
  drug_cigarettes: {
    onset:  "Your hand reaches for a cigarette that isn't there.",
    rising: "It keeps happening: pocket, mouth, pocket, before you remember.",
    peak:   "You've reached for the empty pocket eleven times in the last hour, and you're doing it again.",
    easing: "Your hands find other things to do, badly.",
    tail:   "You've mostly stopped reaching. Once an afternoon, your hand still goes to your pocket.",
  },
};

// New withdrawal blocks for drugs that could hook a player and then do nothing,
// because the tick is gated on `wd.mods`.
const NEW_BLOCKS = {
  // Two hours dry, the longest onset here, because the tell is the NEXT
  // morning rather than the same afternoon.
  drug_coffee: {
    message: "You've got a throbbing headache, and the light hurts your eyes.",
    mods: { stat_brains: -2, stat_cool: -1 },
    onset_seconds: 7200,
  },
  // Alcohol arrived here from the other direction: it could not hook anybody at
  // all, because `addiction_chance` was 0. `alcohol-arc.mjs` raises it to 0.12,
  // which is what makes this block reachable. Onset is 90 minutes dry, longer
  // than any other row here, because the first morning is the tell and the
  // afternoon of the same day is not.
  drug_alcohol: {
    message: "Your hands shake, and you keep seeing things in the corners that aren't there.",
    mods: { hp_max: -10, stat_brains: -2, stat_cool: -3, stat_reflexes: -3 },
    onset_seconds: 5400,
  },
  drug_ether: {
    message: "You're dizzy, and you keep smelling it when it isn't there.",
    mods: { stat_cool: -2, stat_reflexes: -1 },
    onset_seconds: 1200,
  },
  drug_static: {
    message: "You can't focus. Everything around you demands your attention at once.",
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
