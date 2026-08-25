/**
 * The thirteen `withdrawal-stages.mjs` deliberately left alone.
 *
 * Every one of them could latch `is_addicted` and then do nothing whatever,
 * because the withdrawal tick is gated on `wd.mods` (server/engine/drugs.js) and
 * they had no withdrawal block at all. The earlier pass named them and stopped,
 * on the grounds that they were all at 0.1 or below and mostly psychedelics.
 * That was right about the psychedelics and wrong about the other eight.
 *
 * So this pass splits them, and the split is the whole decision:
 *
 * ZEROED. Serotonergic psychedelics do not produce dependence. There is no
 * withdrawal to write for them, and writing one would be inventing a symptom to
 * justify a number. The real brake is tolerance, which they already have (it is
 * why the second tab in two days does very little), so the only change needed is
 * the addiction chance going to 0. blotter, dmt, psilocybin, mescaline,
 * threshold.
 *
 * AUTHORED. The other eight are a nitrite, two stimulants, a cannabis analogue,
 * a euphoriant, two deliriants and whatever the grey syringe is. Each has a real
 * symptom set, and no two of them are the same set:
 *
 *   amyls           the headache the rush was sitting on top of
 *   buzz            a short stimulant, so a short flat rebound
 *   pseudoephedrine rebound congestion, which is the textbook effect and the
 *                   reason the box tells you to stop after a week
 *   dreamsmoke      cannabis: sleep goes first, appetite second, dreams loudest
 *   laughers        the jaw, and then a world running at its own size
 *   screamers       deliriant: the checking outlives the thing checked for
 *   wraithdust      it introduces you to people, and they do not leave with it
 *   grey_ampoule    an endocrine hole where the injection used to be
 *
 * Prose law is inherited from withdrawal-stages.mjs and enforced below with the
 * same two regexes: nothing here says you want it, and nothing here is about
 * mood. De Quincey's objection is that withdrawal is not low spirits, it is a
 * body audible in the parts that are supposed to be silent. The beats also all
 * fire inside six hours except `tail`, so only `tail` may count days.
 *
 *   node scripts/content/withdrawal-tail-drugs.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const DRUGS = path.join(process.cwd(), 'content', 'drugs');
const CHECK = process.argv.includes('--check');
const PHASES = ['onset', 'rising', 'peak', 'easing', 'tail'];

const BANNED = /\b(crav(e|ing)|you (want|need|miss)\b|you would kill|low spirits|depress)/i;
const LONG_UNITS = /\b(day|days|week|weeks|fortnight|month|months)\b/i;
const LONG_UNIT_ALLOWED = {
  'drug_pseudoephedrine/onset': 'the instruction on the box, not a count of elapsed withdrawal',
};

// Psychedelics with no dependence liability. The number goes to 0 rather than a
// withdrawal being invented to justify it.
const ZERO = {
  drug_blotter:    'no dependence liability; rapid tolerance is the real brake and it is already authored',
  drug_dmt:        'no dependence liability, and no tolerance to speak of either',
  drug_psilocybin: 'no dependence liability; cross-tolerance with blotter is the real brake',
  drug_mescaline:  'no dependence liability',
  drug_threshold:  'DMT analogue, same reason as drug_dmt',
};

const BLOCKS = {
  // NITRITE. Sixty seconds of rush leaves nothing to withdraw from except the
  // vessel dilation, which is the headache it was always going to cost.
  drug_amyls: {
    onset_seconds: 600,
    message: 'Your head has the shape of the rush left in it and none of the rush.',
    mods: { stat_brawn: -1, stat_reflexes: -1 },
    stages: {
      onset:  'A band tightens across the front of your skull, in exactly the place the rush used to sit.',
      rising: 'Your face is hot and your hands are cold and neither of them will trade.',
      peak:   'The headache is behind both eyes and moves when you move, and standing up has become something you plan first.',
      easing: 'It comes down to the size of an ordinary bad head.',
      tail:   'Mostly gone. The band still arrives across the front of your skull for an hour most evenings.',
    },
  },

  // STIMULANTS.
  drug_buzz: {
    onset_seconds: 900,
    message: 'Everything you had been doing at speed is still there, and is being done at the other one.',
    mods: { stat_reflexes: -1, stamina_max: -5 },
    stages: {
      onset:  'The jitter goes, and takes your footing with it.',
      rising: 'Your eyes are gritty and you have read the same sign three times on the way past it.',
      peak:   'You are heavy in a way sleep does not fix, and you have tried, twice, for eleven minutes each.',
      easing: 'Your head clears enough to hold one job in it at a time.',
      tail:   'Working order, at the speed you were always working at before you were wrong about it.',
    },
  },
  drug_pseudoephedrine: {
    onset_seconds: 1800,
    message: 'Your sinuses shut harder than they were before you opened them.',
    mods: { stat_cool: -1, stamina_max: -5 },
    stages: {
      onset:  'Your nose blocks, on the side that was fine, the way the box said it would after a week.',
      rising: 'Both sides now. Breathing through your mouth is drying your throat out and you can hear yourself doing it.',
      peak:   'Solid from the eyebrows down, and your own pulse is the loudest thing in your face.',
      easing: 'One side opens and gives you six hours of half a nose, which you spend grateful.',
      tail:   'Clear enough to work. It shuts again every time you lie down.',
    },
  },

  // CANNABINOID. Sleep first, appetite second, and the dreams are the part
  // everybody who has actually done it reports.
  drug_dreamsmoke: {
    onset_seconds: 3600,
    message: 'You cannot get to sleep, and the sleep you do get is loud and detailed and full of people.',
    mods: { stat_cool: -2, stamina_max: -5 },
    stages: {
      onset:  'The plush comes off the room. Every surface is exactly as hard as it actually is.',
      rising: 'You are not hungry at a time you are normally extremely hungry, and food smells like a job.',
      peak:   'Three in the morning, awake, sweating through a shirt, and the ninety minutes you got were in colour and full of people you owe things to.',
      easing: 'Four hours in one piece. You come out of it sour, and rested enough to notice you are sour.',
      tail:   'Sleeping through. Eating properly. The dreams are still busier than they were before you started.',
    },
  },

  // EUPHORIANT.
  drug_laughers: {
    onset_seconds: 1200,
    message: 'Your jaw aches and the world has gone back to running at its own size.',
    mods: { stat_cool: -2, sanity_regen_per_sec: -0.04 },
    stages: {
      onset:  'Your face aches along the jaw and up under the cheekbones, and it has nothing to do now.',
      rising: 'Somebody says the line that had you on the floor the last time you took a tab. You hear all of it. None of it lands.',
      peak:   'The apocalypse is back to being the apocalypse, going on at its ordinary size, hour after hour, with nothing funny in it anywhere.',
      easing: 'Something small gets a laugh out of you, and it is the first one in a while.',
      tail:   'Ordinary funny, for ordinary reasons. The jaw still goes when the cold comes in.',
    },
  },

  // DELIRIANTS. The rule for both: the hallucination stops and the BEHAVIOUR
  // does not.
  drug_screamers: {
    onset_seconds: 1800,
    message: 'The parts of it that were not real have not agreed to stop being in the room.',
    mods: { stat_cool: -3, stat_reflexes: -1 },
    stages: {
      onset:  'You check the corner of the room. There is nothing in the corner of the room.',
      rising: 'You check it again about every four minutes, and you have started doing it without deciding to.',
      peak:   'Something is standing at the edge of your vision with the patience of furniture, and turning your head only puts it in the other eye.',
      easing: 'It thins out to an ordinary room and one wrong shape, and the wrong shape can be argued with.',
      tail:   'Walls are walls. You have got it down to checking the once, on the way past.',
    },
  },
  drug_wraithdust: {
    onset_seconds: 1800,
    message: 'The people it introduced you to did not leave when it did.',
    mods: { stat_cool: -2, stat_brains: -1 },
    stages: {
      onset:  'The hot metal smell is in the room. There is no hot metal in the room.',
      rising: 'You hear your own name in a conversation nobody is having.',
      peak:   'They are waiting in the doorway, being polite about it, and the doorway is empty and you know the doorway is empty.',
      easing: 'They go back to only turning up when the light is bad.',
      tail:   'Nobody in the doorway. You still say hello to it once a day, quietly, in case.',
    },
  },

  // WHATEVER THE GREY SYRINGE IS. Nobody sells it under a name, so nobody
  // warned anybody what stopping does. Endocrine, slow to arrive, and the
  // drug's own prose refuses to explain it, so this does not explain it either.
  drug_grey_ampoule: {
    onset_seconds: 3600,
    message: 'Everything the syringe was running has gone quiet, and quiet is not the same as rested.',
    mods: { stat_brawn: -1, stamina_max: -5 },
    stages: {
      onset:  'The heaviness low in your gut lifts, and what is left there is not empty so much as switched off.',
      rising: 'Your back aches across the kidneys, and the temperature of the room keeps being wrong in both directions.',
      peak:   'Hot, then cold, then hot, and your whole middle aches on the inside, where there is nothing in there to have hurt.',
      easing: 'The temperature settles. The ache stays and stops being interesting.',
      tail:   'Back to yourself. Slightly less of yourself than was advertised, and nothing was ever advertised.',
    },
  },
};

// --- apply -------------------------------------------------------------------
const problems = [];
let zeroed = 0, authored = 0;

for (const [id, why] of Object.entries(ZERO)) {
  const file = path.join(DRUGS, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such drug file`); continue; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!d.addiction_chance) continue;
  if ((d.effects || {}).withdrawal) {
    problems.push(`${id}: has an authored withdrawal, so zeroing its addiction would orphan it (${why})`);
    continue;
  }
  d.addiction_chance = 0;
  zeroed++;
  if (!CHECK) fs.writeFileSync(file, canonicalJson(d), 'utf8');
}

for (const [id, block] of Object.entries(BLOCKS)) {
  const file = path.join(DRUGS, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such drug file`); continue; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!(d.addiction_chance > 0)) problems.push(`${id}: authoring withdrawal for a drug that cannot addict anyone`);
  if ((d.effects || {}).withdrawal) { problems.push(`${id}: already has a withdrawal block; this pass is only for the bare ones`); continue; }

  const keys = Object.keys(block.stages);
  if (keys.length !== PHASES.length || keys.some((k) => !PHASES.includes(k))) {
    problems.push(`${id}: stages must be exactly [${PHASES.join(', ')}], got [${keys.join(', ')}]`);
    continue;
  }
  for (const [phase, line] of Object.entries(block.stages)) {
    if (BANNED.test(line)) problems.push(`${id}/${phase}: uses the mood-and-wanting phrasing the prose law removes`);
    if (phase !== 'tail' && LONG_UNITS.test(line) && !LONG_UNIT_ALLOWED[`${id}/${phase}`]) {
      problems.push(`${id}/${phase}: counts days in a beat that fires inside six hours`);
    }
    if (line.length > 260) problems.push(`${id}/${phase}: ${line.length} chars, too long for a tick line`);
    if (line.includes('—')) problems.push(`${id}/${phase}: em dash, which is an Ascendant voice tell rather than narration`);
  }
  if (!block.message) problems.push(`${id}: no summary message for the drug-knowledge card`);
  if (!Object.keys(block.mods || {}).length) problems.push(`${id}: no mods, so the tick would never run it`);

  d.effects = d.effects || {};
  d.effects.withdrawal = block;
  authored++;
  if (!CHECK) fs.writeFileSync(file, canonicalJson(d), 'utf8');
}

// --- the gap this pass closes ------------------------------------------------
const stillBare = [];
for (const f of fs.readdirSync(DRUGS)) {
  const d = JSON.parse(fs.readFileSync(path.join(DRUGS, f), 'utf8'));
  if (ZERO[d.id] || BLOCKS[d.id]) continue;
  const wd = (d.effects || {}).withdrawal;
  if ((d.addiction_chance || 0) > 0 && (!wd || !wd.mods)) stillBare.push(`${d.id} (${d.addiction_chance})`);
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}${zeroed} drug(s) zeroed, ${authored} withdrawal block(s) authored.`);
console.log(stillBare.length
  ? `  Still addictive with no withdrawal that can fire: ${stillBare.join(', ')}`
  : '  No drug is left able to addict a player without a withdrawal that fires.');
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
