/**
 * The once-over: every drug row that was missing a shape, a habit or a crash.
 *
 * `drug-audit.mjs` is the measurement; this is the pass that answers it. It
 * started at mean 3.00/4 with 15 of 36 rows complete and three hard faults.
 *
 * ── THE BIGGEST FINDING, WHICH WAS NOT COFFEE ───────────────────────────────
 *
 * Nine of the ten rows with no `phases` block are hallucinogens, and they were
 * mechanically INERT. A k-hole, a salvia break, a lungful of ether: each one
 * fires a rich timed `hallucination` script, takes some sanity, and leaves every
 * stat you own exactly where it was. You could be unplugged from your own body
 * and still shoot straight, drive, and win a fight. The trip system made them
 * look like the most incapacitating drugs in the game and the stat layer had
 * never heard of any of them.
 *
 * ⚠ THEY GET NO `peak_message`. Each already defers its instant block with
 * `onset_seconds` and announces arrival with `onset_message` — "Your body
 * finishes its sentence without you." Authoring a peak line as well would fire a
 * second arrival announcement one or two seconds after the first. So the come-up
 * is set to the drug's OWN `onset_seconds`, the existing line is the peak line,
 * and only the comedown and the end are new. That is also why `comeup_scale` is
 * low across the board here: the mechanical hit should land WITH the trip, not
 * before it.
 *
 * ── WHAT A COMEDOWN BLOCK IS FOR ────────────────────────────────────────────
 *
 * `comedown_mods` (added with the alcohol pass) is for a comedown that leaves
 * you WORSE than baseline, not merely less high — the stimulant crash, the
 * solvent headache, the dissociative re-entry. Most drugs really do just wear
 * off, and those keep a scaled peak and are none the worse for it.
 *
 * ⚠ DMT, THRESHOLD AND NITROUS DELIBERATELY GET NONE. Coming back clean is the
 * whole character of all three — "forty seconds, and then you're just a person
 * in a room again" is the nitrous row's own description. A crash bolted onto
 * them would be a worse drug, not a more finished one.
 *
 * ── SKIN ───────────────────────────────────────────────────────────────────
 *
 * ⚠ FOURTEEN LIQUID DRUG VIALS DELIVERED NOTHING. They ship
 * `prefill.fluid_type: 'drug'` and `drug` was not a key in TOPICAL_FLUIDS, so
 * every one of them resolved through the fallback at `absorb: 0` — a vial of
 * blacktar emptied over somebody wet them and did nothing else. And `absorb`
 * describes only the LIQUID, so any two drugs in one carrier were delivered
 * identically. Both halves are fixed: `drug` is a real carrier now, and
 * `skinPermeability()` in drugs.js gives the molecule its own say, derived from
 * `drug_family` with the seven overrides below.
 *
 * ── THE THREE HARD FAULTS ───────────────────────────────────────────────────
 *
 * ⚠ `drug_toluene` carried `stat_smarts` in TWO blocks and the stat does not
 * exist — the six are brawn/reflexes/endurance/brains/cool/senses. `applyMods`
 * does `player[key] = (player[key] || 0) + n` for whatever it is handed, so it
 * neither threw nor warned: it invented a field on the live player object that
 * no reader has ever looked at. That debuff had never once landed. It is
 * `stat_brains` now, which is what it plainly meant.
 *
 * ⚠ `drug_grey_ampoule` ran a full 60/600/240 arc with NO `peak_mods` — three
 * authored messages firing over fifteen minutes with nothing behind them. Its
 * own withdrawal takes `stat_brawn` and `stamina_max`, which the drug had never
 * given, so coming off it removed something you never had. It gives them now,
 * and the withdrawal finally reads as the thing stopping.
 *
 * The third fault was coffee scoring 0/4, below.
 *
 * ── COFFEE ─────────────────────────────────────────────────────────────────
 *
 * The single most-consumed drug in the game after alcohol, and the one players
 * take deliberately, because it is the sobering agent. It had nothing: no arc,
 * no tolerance, no dependency, no withdrawal. Caffeine withdrawal is the most
 * widely experienced withdrawal there is and it was not in the game.
 *
 * ⚠ ITS OVERDOSE WINDOW HAD TO BE LOOSENED, NOT TIGHTENED. `duration_seconds`
 * gates dose clearance, so at 180s/threshold 6 it was already six cups inside
 * three minutes — and coffee is the thing a player chains when they are trying
 * to sober up. 900s/threshold 10 is ten cups in fifteen minutes: clearly a
 * binge, and a far gentler rate than what it replaced.
 *
 * ⚠ COFFEE STAYS UNCLASSED, and so does everything here. Only `depressant` and
 * `stimulant` carry a `drug_class`, because only those kill by additive load;
 * a regress case in plugins/npc-drugs fails the build otherwise. Nothing in this
 * pass adds, removes or changes a single `drug_class`. See
 * docs/systems-survival.md — family describes, class kills.
 *
 *   node scripts/content/drug-arcs.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const DRUGS = path.join(process.cwd(), 'content', 'drugs');
const CHECK = process.argv.includes('--check');

const STATS = ['stat_brawn', 'stat_reflexes', 'stat_endurance', 'stat_brains', 'stat_cool', 'stat_senses'];
const CAPS = ['hp_max', 'sanity_max', 'stamina_max'];
const DRIP_BASES = ['hp', 'sanity', 'stamina', 'radiation'];
const readableMod = (k) => STATS.includes(k) || CAPS.includes(k)
  || (/_regen_per_sec$/.test(k) && DRIP_BASES.includes(k.replace(/_regen_per_sec$/, '')));

const sys = (s) => `<span class="msg-system">${s}</span>`;

// Rows this pass edits. Anything absent is already complete or deliberately bare.
// `phases` and `tolerance` are merged into `effects`; the three scalars are set
// on the row; `flags` is merged (only `skin_permeability` uses it, below).
const ARCS = {

  // ═══ COFFEE ══════════════════════════════════════════════════════════════
  drug_coffee: {
    duration_seconds: 900,
    overdose_threshold: 10,
    addiction_chance: 0.08,
    phases: {
      comeup_seconds: 120, peak_seconds: 600, comedown_seconds: 420,
      comeup_scale: 0.4, comedown_scale: 1,
      comeup_message: sys('The first mouthful is just heat. The rest of it is on the way.'),
      peak_message: sys('Everything sharpens up a notch. You could get the whole list done.'),
      comedown_message: sys('The edge comes off, and takes a little more with it than it brought.'),
      end_message: sys("Whatever that was, it's finished, and you're further behind than when you started."),
      peak_mods: { stat_brains: 1, stat_reflexes: 1, stamina_regen_per_sec: 0.3 },
      comedown_mods: { stat_brains: -1, stat_cool: -1 },
    },
    // Caffeine tolerance is fast, deep, and shed in a few days off it.
    tolerance: { gain_per_dose: 0.05, max_reduction: 0.6, recovery_per_sec: 0.000009, lethal_gain_ratio: 0.2 },
  },

  // ═══ THE HARD FAULTS ═════════════════════════════════════════════════════
  drug_grey_ampoule: {
    // Mirrors its own withdrawal exactly, so coming off it reads as the thing
    // stopping rather than as a penalty arriving from nowhere.
    phases: { peak_mods: { stat_brawn: 1, stamina_max: 5 } },
    tolerance: { gain_per_dose: 0.1, max_reduction: 0.5, recovery_per_sec: 0.000006 },
  },
  drug_toluene: {
    phases: {
      // was stat_smarts, which is not a stat
      peak_mods: { stat_cool: -2, stat_reflexes: -2, stat_brains: -3 },
      comedown_mods: { stat_brains: -2, stat_endurance: -2 },
      comedown_scale: 1,
    },
    tolerance: { gain_per_dose: 0.15, max_reduction: 0.6, recovery_per_sec: 0.000009 },
    withdrawalMods: { stat_cool: -2, stat_brains: -2 },
  },

  // ═══ THE INERT HALLUCINOGENS ═════════════════════════════════════════════
  // Come-up equals each drug's own `onset_seconds`; no peak_message, because
  // `onset_message` already is one. See the header.
  drug_deadair: {
    phases: {
      comeup_seconds: 8, peak_seconds: 200, comedown_seconds: 90,
      comeup_scale: 0.3, comedown_scale: 1,
      comedown_message: sys('The signal comes back up, and it is louder than you remember asking for.'),
      end_message: sys('You are back on the channel with everyone else. It took longer than it should have.'),
      peak_mods: { stat_reflexes: -4, stat_brains: -3, stat_cool: 2 },
      comedown_mods: { stat_brains: -2, stat_cool: -1 },
    },
  },
  drug_dmt: {
    phases: {
      comeup_seconds: 3, peak_seconds: 115, comedown_seconds: 30,
      comeup_scale: 0.5, comedown_scale: 0.4,
      end_message: sys('You are in a room, on the floor, and you have been gone about fifteen minutes, and you are entirely fine.'),
      peak_mods: { stat_reflexes: -5, stat_brains: -4, stat_cool: -3 },
      // No comedown_mods. Coming back clean is the whole point of it.
    },
  },
  drug_dxm: {
    phases: {
      comeup_seconds: 45, peak_seconds: 620, comedown_seconds: 235,
      comeup_scale: 0.3, comedown_scale: 1,
      comedown_message: sys('Your legs start answering closer to when you ask them.'),
      end_message: sys('Everything is the right distance away again. Your jaw aches and the sweetness is still in your teeth.'),
      peak_mods: { stat_reflexes: -4, stat_brains: -3, stat_endurance: -2 },
      comedown_mods: { stat_brains: -2, stat_endurance: -1 },
    },
    tolerance: { gain_per_dose: 0.25, max_reduction: 0.7, recovery_per_sec: 0.000005 },
  },
  drug_ether: {
    phases: {
      comeup_seconds: 2, peak_seconds: 100, comedown_seconds: 40,
      comeup_scale: 0.5, comedown_scale: 1,
      comedown_message: sys('The room finishes tilting back. The smell has not gone anywhere.'),
      end_message: sys('You are upright and the floor is flat, and there is a headache arriving from a long way off.'),
      peak_mods: { stat_reflexes: -4, stat_brains: -4, stat_cool: -2 },
      comedown_mods: { stat_brains: -2, stat_endurance: -2 },
    },
    tolerance: { gain_per_dose: 0.12, max_reduction: 0.5, recovery_per_sec: 0.000008 },
  },
  drug_ibogaine: {
    phases: {
      comeup_seconds: 90, peak_seconds: 1700, comedown_seconds: 610,
      comeup_scale: 0.3, comedown_scale: 1,
      comedown_message: sys('The playback stops somewhere in the middle of a scene and does not resume.'),
      end_message: sys('A day and a night of it, and you are still sitting in the same place, and your chest aches.'),
      // "a heart that may not agree to it" — the row's own description. The
      // cardiac load is a lowered ceiling, never an hp drip: a drip is floored
      // at zero rather than routed through any death path, so it can leave a
      // player sitting at 0 hp and alive.
      peak_mods: { stat_reflexes: -4, stat_endurance: -3, hp_max: -12 },
      comedown_mods: { stat_endurance: -3, stat_brawn: -1 },
    },
  },
  drug_khole: {
    phases: {
      comeup_seconds: 8, peak_seconds: 190, comedown_seconds: 60,
      comeup_scale: 0.3, comedown_scale: 1,
      comedown_message: sys('You are handed your body back a piece at a time, in no particular order.'),
      end_message: sys('All of you is in the same place again. You stay where you are for a bit anyway.'),
      peak_mods: { stat_reflexes: -5, stat_brawn: -3, stat_brains: -3 },
      comedown_mods: { stat_reflexes: -2, stat_brains: -2 },
    },
  },
  drug_nitrous: {
    phases: {
      comeup_seconds: 2, peak_seconds: 38, comedown_seconds: 25,
      comeup_scale: 0.5, comedown_scale: 0.4,
      end_message: sys('The beat lets go of the room. You are just a person holding an empty balloon.'),
      peak_mods: { stat_reflexes: -3, stat_brains: -3 },
      // No comedown_mods — forty seconds, and then you are fine, which is the
      // row's own description of itself.
    },
  },
  drug_salvia: {
    phases: {
      comeup_seconds: 4, peak_seconds: 70, comedown_seconds: 30,
      comeup_scale: 0.5, comedown_scale: 1,
      comedown_message: sys('You are put back roughly where you were found, facing about the right way.'),
      end_message: sys('A minute. It was a minute. You check twice and it was still a minute.'),
      peak_mods: { stat_reflexes: -5, stat_brains: -5, stat_cool: -4 },
      comedown_mods: { stat_cool: -2 },
    },
  },
  drug_threshold: {
    phases: {
      comeup_seconds: 4, peak_seconds: 180, comedown_seconds: 40,
      comeup_scale: 0.5, comedown_scale: 0.4,
      end_message: sys('Four hundred seconds, by the clock. You will be arguing with that clock for a while.'),
      peak_mods: { stat_reflexes: -5, stat_brains: -4, stat_cool: -4 },
      // No comedown_mods — it returns you whole, like DMT. The argument is with
      // what you were shown, not with your body.
    },
  },

  // ═══ CRASHES: comedowns that leave you worse than baseline ═══════════════
  drug_redline: {
    phases: { comedown_mods: { stat_reflexes: -3, stat_cool: -3, stat_endurance: -2 }, comedown_scale: 1 },
  },
  drug_coldfire: {
    // "Every wound you ignored is suddenly very loud" — its own end line. The
    // peak lends 30 hp_max and heals through it; the crash takes the loan back.
    // Come-up raised to its own onset (was 10 against an onset of 12) — see the
    // out-of-order section below; the peak is shortened to match, so 240 holds.
    phases: {
      comeup_seconds: 12, peak_seconds: 138,
      comedown_mods: { hp_max: -10, stat_endurance: -3, stat_brawn: -2 }, comedown_scale: 1,
    },
  },
  drug_overclock: {
    // "Your skull throbs where the heat pooled."
    //
    // ⚠ THE PEAK DRIP IS A FIX, NOT A TUNE. It was `sanity_regen_per_sec: -1`
    // against a 150-second peak: −150 points of a 100-point bar, so ONE dose
    // emptied a full sanity bar in a hundred seconds, on top of its instant −6.
    // It is the only NEGATIVE peak drip in the corpus and it was authored at the
    // same magnitude as the four positive ones (lull, memhack, slow, static all
    // sit at +1) — which are harmless precisely because the engine caps a regen
    // at `<stat>_max` on the way up and floors it only at zero on the way down.
    // The number was mirrored without the asymmetry. −0.12 costs about 18 points
    // across a peak: a real price that stacks if you chain doses, rather than
    // instant madness on a first dose.
    phases: {
      peak_mods: { hp_max: 10, stat_brains: 5, stat_reflexes: 4, sanity_regen_per_sec: -0.12 },
      comedown_mods: { stat_brains: -4, stat_cool: -2, sanity_regen_per_sec: -0.01 },
      comedown_scale: 1,
    },
  },
  drug_buzz: {
    phases: { comedown_mods: { stat_reflexes: -1, stat_cool: -1 }, comedown_scale: 1 },
  },
  drug_amyls: {
    // Seconds long, and the drop is the whole experience of it ending.
    phases: { comedown_mods: { stat_brawn: -1, stat_cool: -2 }, comedown_scale: 1 },
  },
  drug_cigarettes: {
    phases: { comedown_mods: { stat_cool: -1 }, comedown_scale: 1 },
  },
  drug_glasshollow: {
    // A deliriant's corners do not go back where they were.
    phases: { comedown_mods: { stat_cool: -3, stat_senses: -2 }, comedown_scale: 1 },
  },

  // ═══ PROSE FIRING OUT OF ORDER ═══════════════════════════════════════════
  // Both of these had a come-up SHORTER than their own `onset_seconds`, so the
  // peak line ("you settle into it") printed while the drug was still officially
  // arriving, and the arrival line landed after it. Found by the invariant at
  // the bottom of this file while adding an unrelated comedown to coldfire.
  // The peak is shortened by the same amount, so neither total moves.
  drug_blacktar: {
    phases: { comeup_seconds: 30, peak_seconds: 290 },   // was 20/300, onset is 30
  },

  // ═══ SKIN: where a row's own chemistry disagrees with its family ═════════
  //
  // `skinPermeability()` in drugs.js derives this from `drug_family`, which is
  // right for most of the corpus and wrong for these seven. An override is only
  // ever worth authoring when the MOLECULE parts company with its family — which
  // is the whole reason the axis exists, since without it any two drugs in one
  // carrier are delivered identically.
  drug_alcohol: {
    // Ethanol crosses a little and evaporates faster than it crosses, so a
    // systemic dose off the skin is not a thing that happens. Belt and braces
    // with the `booze` carrier's own 0.02: a drink thrown over somebody should
    // be inert whether it is named as a drink or decanted into a vial.
    flags: { skin_permeability: 0.02 },
  },
  drug_coffee: { flags: { skin_permeability: 0.05 } },   // caffeine barely bothers
  // Nicotine is THE transdermal drug. Both rows, because the loose leaf is the
  // same molecule as the cigarette rolled from it.
  drug_cigarettes: { flags: { skin_permeability: 0.85 } },
  drug_loose_tobacco: { flags: { skin_permeability: 0.85 } },
  // These two ARE solvents. Whatever else they do, getting through skin is the
  // thing they are chemically best at, and the family table cannot know it —
  // toluene has no family at all and ether is filed as a dissociative.
  drug_ether: { flags: { skin_permeability: 0.90 } },
  drug_toluene: { flags: { skin_permeability: 0.90 } },
  drug_blacktar: { flags: { skin_permeability: null } },
  // ⚠ NO drug_blacktar OVERRIDE, and the first draft had one. Filing it at the
  // morphine end (0.15) reads well and is self-defeating: `item_blacktar` is one
  // of the fourteen liquid vials this pass exists to un-break, and 0.5 × 0.15 is
  // 0.075 — under MIN_SYSTEMIC_DOSE, so the vial went straight back to wetting
  // people and doing nothing. The opioid family's 0.35 is the average of a family
  // that splits hard, which is the right answer for a crude tar cut with whatever
  // was nearby. An override has to be checked against the CARRIERS it will meet,
  // not just against the pharmacology.

  // ═══ HABITS: rows where repeat use meant nothing ═════════════════════════
  drug_joint: {
    tolerance: { gain_per_dose: 0.08, max_reduction: 0.5, recovery_per_sec: 0.000006 },
  },
  drug_pseudoephedrine: {
    tolerance: { gain_per_dose: 0.1, max_reduction: 0.5, recovery_per_sec: 0.00001 },
  },
};

// ─── apply ───────────────────────────────────────────────────────────────────
const problems = [];
let touched = 0;

for (const [id, arc] of Object.entries(ARCS)) {
  const file = path.join(DRUGS, `${id}.json`);
  if (!fs.existsSync(file)) { problems.push(`${id}: no such drug file`); continue; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.effects = d.effects || {};

  if (arc.duration_seconds != null) d.duration_seconds = arc.duration_seconds;
  if (arc.overdose_threshold != null) d.overdose_threshold = arc.overdose_threshold;
  if (arc.addiction_chance != null) d.addiction_chance = arc.addiction_chance;
  // Merged, never replaced: most rows here are having ONE key added to an arc
  // somebody else wrote, and a replace would silently drop their prose.
  if (arc.phases) d.effects.phases = { ...(d.effects.phases || {}), ...arc.phases };
  if (arc.tolerance) d.effects.tolerance = { ...(d.effects.tolerance || {}), ...arc.tolerance };
  // ⚠ `null` DELETES. The merge is additive, so dropping an entry from the table
  // above does NOT remove a flag a previous run already wrote — the file keeps it
  // and the script reports success. "This row has no override" has to be stated,
  // or it is not re-runnable.
  if (arc.flags) {
    d.flags = { ...(d.flags || {}), ...arc.flags };
    for (const [k, v] of Object.entries(arc.flags)) if (v === null) delete d.flags[k];
  }
  if (arc.withdrawalMods && d.effects.withdrawal) d.effects.withdrawal.mods = arc.withdrawalMods;

  // ── invariants ────────────────────────────────────────────────────────────
  const ph = d.effects.phases || {};
  for (const [block, mods] of [['peak_mods', ph.peak_mods], ['comedown_mods', ph.comedown_mods], ['withdrawal.mods', d.effects.withdrawal?.mods]]) {
    for (const [k, v] of Object.entries(mods || {})) {
      if (!readableMod(k)) problems.push(`${id}: ${block}.${k} is not a field anything reads`);
      // ⚠ A DRIP'S TWO DIRECTIONS ARE NOT SYMMETRIC, and that is the whole rule.
      // The engine clamps a regen at `<stat>_max` going UP, so a large positive
      // rate just refills a bar quickly and stops — +3 hp/sec is fine, and four
      // rows ship +1 sanity/sec harmlessly. Going DOWN it is floored only at
      // ZERO, so the same magnitude has the entire bar to eat through: −1
      // sanity/sec empties a 100-point bar in a hundred seconds. Judge the two
      // directions on different scales or the safe values look like the unsafe
      // one. Per second against a 1 Hz tick, so a rate is worth 60x itself a
      // minute.
      if (/_regen_per_sec$/.test(k)) {
        const limit = v < 0 ? 0.2 : 5;
        if (Math.abs(v) > limit) {
          problems.push(`${id}: ${block}.${k} = ${v}/sec is ${(v * 60).toFixed(1)}/min`
            + (v < 0 ? ' — a negative drip is floored only at zero, so it has the whole bar to eat' : ''));
        }
      }
    }
  }
  // Only a row that HAS an arc can have a silent one. A row with no phases at
  // all is a different question (the audit's ARC column), and some rows here are
  // touched only to author a flag — the two loose-leaf rows are raw material and
  // are never meant to grow an arc.
  if (d.effects.phases && !Object.keys(ph.peak_mods || {}).length) problems.push(`${id}: has a phases block with no peak_mods, so its arc does nothing`);
  const sp = d.flags?.skin_permeability;
  if (sp !== undefined && !(Number.isFinite(sp) && sp >= 0 && sp <= 1)) {
    problems.push(`${id}: skin_permeability ${sp} is not a fraction between 0 and 1`);
  }
  if (ph.comedown_mods && (ph.comedown_scale ?? 1) < 0) {
    problems.push(`${id}: negative comedown_scale would invert comedown_mods as well — author them at a positive scale`);
  }
  // The come-up must not finish before the deferred instant hit lands, or the
  // peak line and the arrival line cross over.
  const onset = d.effects.onset_seconds || 0;
  if (ph.comeup_seconds != null && onset > 0 && ph.comeup_seconds < onset) {
    problems.push(`${id}: come-up (${ph.comeup_seconds}s) finishes before onset_seconds (${onset}s), so the peak lands before the drug does`);
  }
  // A drug that can hook you must have mods, or the withdrawal tick never runs.
  if ((d.addiction_chance || 0) > 0 && !d.effects.withdrawal?.mods) {
    problems.push(`${id}: addiction_chance ${d.addiction_chance} with no withdrawal.mods — it can hook you and then do nothing`);
  }

  if (!CHECK) fs.writeFileSync(file, canonicalJson(d), 'utf8');
  touched++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Drug arcs: ${touched} row(s) authored.`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
