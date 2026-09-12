/**
 * THE EXPERIENCE PASS — what every substance in the game DOES TO YOU, and what
 * happens when you take too much of it.
 *
 *   node scripts/content/drug-experience-pass.mjs [--check]
 *
 * Four jobs, all of them content. The mechanisms they lean on are code and live
 * elsewhere: the FX vocabulary and its family-derived default in
 * client/shared/drug-fx.js, the phase-driven push in engine/drugs.js, the
 * derived body prose in engine/drug-feel.js.
 *
 * ── 1. NINE DRUGS HAD NO OVERDOSE AT ALL ────────────────────────────────────
 *
 * blotter, buzz, dreamsmoke, laughers, mescaline, psilocybin, screamers,
 * threshold and wraithdust: pass the ceiling on any of them and `useDrug` fell
 * through to the legacy branch, applied an empty `{}` and printed the generic
 * "your body revolts" line. Three more (dmt, grey_ampoule, salvia) authored a
 * message and NO `mods`, which is a sentence with nothing behind it.
 *
 * ⚠ NONE OF THE PSYCHEDELICS BECOME LETHAL, and that is a decision rather than
 * an oversight. You cannot take a fatal dose of any of them, the thresholds are
 * already high (blotter is 8), and a lethal acid tab would make the family read
 * as just another way to die when the interesting thing about it is that it is
 * not. What they get instead is the bad trip: sanity gone, nerve gone, and a
 * comedown you have to sit through. `tolerance.lethal_gain_ratio: 0` goes on
 * with it, which is the row saying it has no meaningful lethal tolerance either.
 *
 * ── 2. K-HOLE IS CALLED KETAMINE ────────────────────────────────────────────
 *
 * ⚠ THE DISPLAY NAMES ONLY. `drug_khole` / `item_khole` / `dt_khole_*` stay
 * exactly as they are: those ids are foreign keys from dream_templates, vendor
 * inventories, a furniture cabinet and — the ones that matter — live
 * `player_drug_state` and `player_inventory` rows, which the CODEX deploy has no
 * way to remap. Renaming an id would silently orphan every addiction, tolerance
 * and stashed bag in production. Nothing a player ever sees says "k-hole".
 *
 * ── 3. THE SAME FIVE SENTENCES, FOREVER ─────────────────────────────────────
 *
 * Every phase message was one string, and phases fire on a schedule: a regular
 * user sees the same peak line several times a day, and prose read for the
 * fortieth time stops being read. `pickLine()` in engine/drugs.js now takes a
 * string OR a list at every authored-message site, so this pass turns the lines
 * on the drugs you take most often into lists. Nothing that stayed a string
 * changed behaviour.
 *
 * ── 4. WHERE THE DERIVED LOOK IS WRONG ──────────────────────────────────────
 *
 * The FX default comes off `drug_family`, which is right for 33 rows and wrong
 * for the mundane ones: a cigarette is family `stimulant` and would have made
 * the whole client jitter. `VISIBLE_BY_CLASS` in drugs.js already drew that line
 * for what a BYSTANDER sees ("nobody can see your caffeine") and this is the
 * same line drawn from the inside. `fx.none` switches it off outright.
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const CHECK = process.argv.includes('--check');
const DRUGS = 'content/drugs';
const ITEMS = 'content/items';

// ── 1. Overdose ─────────────────────────────────────────────────────────────
//
// A psychedelic overdose is a PSYCHIATRIC event, so the block is sanity and
// nerve rather than HP. The opposite for the deliriants, which genuinely poison
// you: an anticholinergic overdose is a racing heart and a body that cannot cool
// itself, and wraithdust's own family is the one that kills people in reality.
const OVERDOSE = {
  drug_blotter: {
    lethal: false,
    message: 'Far, far too much. The part of you that was enjoying this is not answering.',
    mods: { sanity: -45, stat_cool: -6, stat_brains: -4 },
  },
  drug_mescaline: {
    lethal: false,
    message: 'Your stomach turns itself inside out and the desert keeps going anyway.',
    mods: { sanity: -35, hp: -8, stat_cool: -5, stat_endurance: -3 },
  },
  drug_psilocybin: {
    lethal: false,
    message: 'You have gone through the bottom of it. There is no floor and nobody built one.',
    mods: { sanity: -38, stat_cool: -5, stat_brains: -3 },
  },
  drug_threshold: {
    lethal: false,
    message: "You are shown the whole of it at once, and you weren't built to hold the whole of it.",
    mods: { sanity: -42, stat_cool: -6, stat_brains: -5 },
  },
  drug_dreamsmoke: {
    lethal: false,
    message: "The smoke keeps coming and you can't find the part of the night where you stop.",
    mods: { sanity: -30, stat_reflexes: -4, stat_cool: -3 },
  },
  drug_laughers: {
    lethal: false,
    message: "You can't stop. Your ribs hurt and your face hurts and none of it is funny any more.",
    mods: { sanity: -28, hp: -6, stat_endurance: -4, stat_cool: -4 },
  },
  // The deliriants. These really do poison you, and the tell is physical.
  drug_screamers: {
    lethal: true,
    message: 'Your heart goes past what a heart does and the screaming turns out to have been yours.',
  },
  drug_wraithdust: {
    lethal: true,
    message: "Your skin is burning dry and nothing in the room is where it was. You don't find the door.",
  },
  // A stimulant. Buzz is the cheap over-the-counter one, which is exactly why it
  // needs a ceiling: the price is what makes it the easiest to take too much of.
  drug_buzz: {
    lethal: true,
    message: 'Your chest clamps shut around a heart going far too fast to be doing any good.',
  },
  // The three that authored a message and nothing behind it.
  drug_dmt: { mods: { sanity: -25, stat_cool: -5 } },
  drug_salvia: { mods: { sanity: -30, stat_cool: -6, stat_reflexes: -4 } },
  drug_grey_ampoule: { mods: { sanity: -20, stat_brains: -5, stat_brawn: -4, hp: -10 } },
  // Mods without a message: the generic line fires and says nothing about what
  // a lungful of hot tobacco actually did.
  drug_cigarettes: { message: 'Your head goes light and grey at the edges and your mouth tastes of pennies.' },
};

// Psychedelics have no meaningful tolerance to the thing that would kill you,
// because there is no such thing. Saying so on the row keeps the relapse law —
// which raises the ceiling as lethal tolerance builds — from quietly handing
// them a headroom bonus they should never have.
const NO_LETHAL_TOLERANCE = ['drug_blotter', 'drug_mescaline', 'drug_psilocybin',
                             'drug_threshold', 'drug_dmt', 'drug_salvia', 'drug_dreamsmoke', 'drug_laughers'];

// ── 2. Ketamine ─────────────────────────────────────────────────────────────
const RENAMES = [
  [path.join(DRUGS, 'drug_khole.json'), { name: 'ketamine' }],
  [path.join(ITEMS, 'item_khole.json'), { name: 'ketamine' }],
  [path.join(ITEMS, 'item_raw_khole.json'), { name: 'crude ketamine' }],
];
// Prose that spells the old name out. Substring replacements, applied to every
// string field of the three files above plus anything listed here.
const NAME_PROSE = [
  [/\bcrude K-Hole\b/g, 'crude ketamine'],
  [/\bK-Hole\b/g, 'ketamine'],
  [/\bk-hole\b/g, 'ketamine'],
];

// ── 3. Varying lines ────────────────────────────────────────────────────────
//
// Only the drugs somebody takes repeatedly, and only the beats that fire every
// time. A 40-minute ibogaine ceremony does not need three ways to open.
const VARIANTS = {
  drug_coffee: {
    'phases.peak_message': [
      '<span class="msg-system">The caffeine lands. The day sharpens up a notch.</span>',
      '<span class="msg-system">Somewhere behind your eyes a light comes on.</span>',
      '<span class="msg-system">The fog lifts off the front of your head and stays off.</span>',
    ],
    'phases.comedown_message': [
      '<span class="msg-system">The lift goes out of it. You could do with another.</span>',
      '<span class="msg-system">The edge comes off, and the tiredness it was covering is still there.</span>',
      '<span class="msg-system">Whatever that bought you, you have spent it.</span>',
    ],
  },
  drug_cigarettes: {
    'phases.peak_message': [
      '<span class="msg-system">The nicotine gets where it was going. Your shoulders come down an inch.</span>',
      '<span class="msg-system">First drag lands. The wanting stops, which is most of the point.</span>',
      '<span class="msg-system">Your hands have something to do and your head goes quiet about it.</span>',
    ],
    'phases.end_message': [
      '<span class="msg-system">Down to the filter. You think about the next one.</span>',
      '<span class="msg-system">Nothing left but the taste, and the taste is not why you did it.</span>',
      '<span class="msg-system">Gone. You already know how long it is until the next one.</span>',
    ],
  },
  drug_alcohol: {
    'phases.peak_message': [
      '<span class="msg-system">The warmth gets all the way out to your hands.</span>',
      '<span class="msg-system">Everything in the room becomes easier to be in.</span>',
      '<span class="msg-system">The drink arrives properly. You are, briefly, excellent company.</span>',
    ],
    'phases.comedown_message': [
      '<span class="msg-system">The warmth pulls back in and leaves your head heavy.</span>',
      '<span class="msg-system">You come down the far side of it, and the far side is dry and loud.</span>',
      '<span class="msg-system">The good half is over. The rest of it is still in you.</span>',
    ],
  },
  drug_joint: {
    'phases.peak_message': [
      '<span class="msg-system">Everything slows down and stops needing a reason.</span>',
      '<span class="msg-system">You settle into the room like it has always been the plan.</span>',
      '<span class="msg-system">Time gets wide. Nothing in it is urgent.</span>',
    ],
    'phases.end_message': [
      '<span class="msg-system">You come back down, hungry and pleasantly stupid.</span>',
      '<span class="msg-system">It lets go. You are exactly where you were and fine about it.</span>',
      '<span class="msg-system">The last of it goes. Your mouth is dry and you would eat anything.</span>',
    ],
  },
  drug_buzz: {
    'phases.peak_message': [
      '<span class="msg-system">The jitter arrives all at once and you go with it.</span>',
      '<span class="msg-system">Everything speeds up to meet you.</span>',
      '<span class="msg-system">Cheap and fast, exactly as advertised.</span>',
    ],
    'phases.comedown_message': [
      '<span class="msg-system">It drops you. The cheap ones always drop you.</span>',
      '<span class="msg-system">The bottom goes out of it and takes the afternoon with it.</span>',
      '<span class="msg-system">You get the bill for the last twenty minutes.</span>',
    ],
  },
  drug_redline: {
    'phases.peak_message': [
      '<span class="msg-system">You are at the top of it and there is nothing you could not do.</span>',
      '<span class="msg-system">The whole world drops into gear and you are already moving.</span>',
      '<span class="msg-system">Everything is loud and fast and yours.</span>',
    ],
  },
  drug_slow: {
    'phases.peak_message': [
      '<span class="msg-system">The room gets further away and stops mattering.</span>',
      '<span class="msg-system">You sink a long way into whatever you are sitting on.</span>',
      '<span class="msg-system">Everything soft-edges. Nothing needs deciding.</span>',
    ],
  },
  drug_grey: {
    'phases.peak_message': [
      '<span class="msg-system">The ache stops. All of it, everywhere, at once.</span>',
      '<span class="msg-system">Warmth comes up through you and takes the pain out on the way.</span>',
      '<span class="msg-system">There is nothing wrong with you. There never was.</span>',
    ],
  },
};

// ── 4. FX overrides ─────────────────────────────────────────────────────────
//
// The family-derived default (client/shared/drug-fx.js) is the law and is right
// for most rows. These are the exceptions, and each one is a claim about the
// substance rather than a taste in visual effects.
const FX = {
  // Legal, mundane, and invisible from the outside — `VISIBLE_BY_CLASS` already
  // says so. A cigarette that made the whole client jitter would be the loudest
  // drug in the game.
  drug_cigarettes: { none: true },
  drug_loose_tobacco: { none: true },
  // Coffee gets something, because a good cup genuinely does sharpen the room —
  // but only the halo, only faintly, and no motion at all.
  drug_coffee: { intensity: 0.2, phases: { comeup: { screen: [] }, peak: { field: 'glitter', screen: ['halo'] }, comedown: { field: null, screen: [] } } },
  // ⚠ Alcohol's LOOK belongs to the meter, not to the phase arc. A pint's phases
  // run for half an hour whatever else you have had; plugins/intoxication knows
  // you are eight drinks in, and eight drinks is the thing you can see. So the
  // drug row stays faint and the meter does the work — without this, one beer
  // looked exactly like six.
  drug_alcohol: { intensity: 0.22 },
  // Not a family and not a class the table knows, so it derived nothing at all.
  // It is a military nootropic that takes your body apart to pay for your head:
  // the look is the grain and the closing edges, never the colour.
  drug_grey_ampoule: {
    palette: 'cyan', window: 'stimulant',
    phases: {
      comeup: { field: 'static', screen: [] },
      peak: { field: 'static', screen: ['halo', 'desat'] },
      comedown: { field: 'veins', screen: ['narrow', 'desat'] },
    },
  },
  // Nitrous is forty seconds long and the whole character of it is the descent
  // and the snap back. Straight to the tunnel, no gentle opening.
  drug_nitrous: { intensity: 0.85, phases: { comeup: { field: 'tunnel', screen: ['narrow'] } } },
  // DMT is not a gentler blotter and should not look like one. Hardest peak in
  // the game, and the geometry starts immediately.
  drug_dmt: { intensity: 1, phases: { comeup: { field: 'fractal', screen: ['breathe', 'oversat'] } } },
  // Salvia does not breathe, it SHEARS. The room slides sideways and takes you
  // with it, which is the one thing `swim` says and `fractal` does not.
  drug_salvia: {
    intensity: 0.95,
    phases: {
      comeup: { field: 'swim', screen: ['melt'] },
      peak: { field: 'swim', screen: ['melt', 'oversat', 'breathe'] },
      comedown: { field: 'shimmer', screen: ['blur'] },
    },
  },
  // Ether is a solvent, not a psychedelic: the complaint is that the room is
  // greasy and far away and your own voice is arriving late.
  drug_ether: { intensity: 0.75, phases: { peak: { field: 'smear', screen: ['blur', 'desat', 'double'] } } },
  // Toluene is a solvent too, and a worse one. It reads as drunk because that is
  // what huffing is, with a headache bolted to the end of it.
  drug_toluene: { intensity: 0.8, phases: { comedown: { field: 'static', screen: ['desat', 'jitter'] } } },
  // Ibogaine runs for forty minutes and is a reckoning rather than a light show.
  // The peak is slow and enormous; the comedown is the part where you have to
  // live with what you were shown.
  drug_ibogaine: {
    intensity: 0.9,
    phases: {
      comeup: { field: 'veins', screen: ['blur'] },
      peak: { field: 'fractal', screen: ['breathe', 'melt', 'narrow'] },
      comedown: { field: 'crawl', screen: ['desat', 'blur'] },
    },
  },
  // A near-lethal amphetamine. Everything the family does, at the top of it.
  drug_coldfire: { intensity: 0.9 },
  drug_overclock: { intensity: 0.85 },
  // Amyls last sixty seconds and are one enormous flush and nothing else.
  drug_amyls: { intensity: 0.9, phases: { peak: { field: 'pulse', screen: ['oversat', 'halo', 'jitter'] }, comedown: { field: null, screen: ['desat'] } } },
  // The dream one. Soft, warm and going somewhere else, rather than sharp.
  drug_dreamsmoke: {
    intensity: 0.7,
    phases: {
      comeup: { field: 'embers', screen: ['breathe'] },
      peak: { field: 'bloom', screen: ['breathe', 'melt'] },
      comedown: { field: 'embers', screen: ['blur'] },
    },
  },
  // Laughers do one thing and the one thing is not visual — the field stays
  // bright and busy and the screen never goes dark.
  drug_laughers: {
    intensity: 0.7,
    phases: {
      comeup: { field: 'glitter', screen: ['oversat'] },
      peak: { field: 'tracers', screen: ['oversat', 'jitter', 'breathe'] },
      comedown: { field: 'bloom', screen: ['desat'] },
    },
  },
};

// ── apply ───────────────────────────────────────────────────────────────────

const problems = [];
let touched = 0;

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = (o[p] ??= {});
  o[parts.at(-1)] = value;
}

function walkStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map(x => walkStrings(x, fn));
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = walkStrings(v[k], fn);
    return v;
  }
  return v;
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, d) => { if (!CHECK) fs.writeFileSync(f, canonicalJson(d), 'utf8'); touched++; };

// 1 + 3 + 4 — the drug rows.
for (const file of fs.readdirSync(DRUGS).sort()) {
  const full = path.join(DRUGS, file);
  const d = read(full);
  const id = d.id;
  let dirty = false;

  const od = OVERDOSE[id];
  if (od) {
    d.effects ??= {};
    d.effects.overdose = { ...(d.effects.overdose || {}), ...od };
    dirty = true;
  }
  if (NO_LETHAL_TOLERANCE.includes(id)) {
    d.effects ??= {};
    d.effects.tolerance ??= {};
    d.effects.tolerance.lethal_gain_ratio = 0;
    dirty = true;
  }
  for (const [dotted, lines] of Object.entries(VARIANTS[id] || {})) { setPath(d, `effects.${dotted}`, lines); dirty = true; }
  if (FX[id]) { d.effects ??= {}; d.effects.fx = FX[id]; dirty = true; }

  if (dirty) write(full, d);
}

// 2 — the display names.
for (const [file, patch] of RENAMES) {
  if (!fs.existsSync(file)) { problems.push(`${file} does not exist`); continue; }
  const d = read(file);
  Object.assign(d, patch);
  walkStrings(d, (s) => NAME_PROSE.reduce((acc, [re, to]) => acc.replace(re, to), s));
  write(file, d);
}

// ── the checks this pass has to survive ─────────────────────────────────────

for (const file of fs.readdirSync(DRUGS).sort()) {
  const d = read(path.join(DRUGS, file));
  const eff = d.effects || {};
  const od = eff.overdose;
  // A drug you can hold more than one dose of must say what too many does. The
  // three with no phases at all are raw material and a splice carrier, and none
  // of them is a thing you take.
  const consumable = !!eff.phases;
  if (consumable && !od) problems.push(`${d.id}: no overdose block — the ceiling exists and nothing is behind it`);
  if (od && !od.lethal && !Object.keys(od.mods || {}).length) {
    problems.push(`${d.id}: a survivable overdose with no mods is a sentence with nothing behind it`);
  }
  if (od && !od.message) problems.push(`${d.id}: overdose with no authored message falls back to the generic line`);
  // ⚠ A survivable overdose runs through applyEffects, which caps but never
  // floors HP above zero, so a big enough `hp` here kills on a block that said
  // it was not lethal.
  if (od && !od.lethal && (od.mods?.hp ?? 0) <= -60) {
    problems.push(`${d.id}: non-lethal overdose takes ${od.mods.hp} hp, which will kill most bodies`);
  }
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Drug experience pass: ${touched} file(s) written.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
