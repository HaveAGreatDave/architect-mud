/**
 * What every drug row actually has, scored against what the engine can read.
 *
 * A report, not a gate — the `models:quality` precedent. A gate would fail the
 * moment somebody added a drug and keep failing until they finished it, and the
 * point of this is to make the shape of the corpus visible, not to block work.
 * `--fail-under N` exists for the day the pass is done.
 *
 * It exists because the alcohol gap was invisible. `drug_alcohol` had nothing
 * authored in any column — no phases, no tolerance, no withdrawal — and was the
 * single most-consumed substance in the game, and nothing anywhere said so. You
 * had to open 39 files and hold them in your head to notice. The fix is one
 * table you can re-read in a second.
 *
 * ── WHAT IS SCORED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
 *
 * ⚠ A MISSING `drug_class` IS NOT A FINDING. 25 of 39 rows carry none, and that
 * is the documented design: only `depressant` and `stimulant` are tagged,
 * because only those kill by additive load. Psychedelics, dissociatives,
 * deliriants, cannabis and the nootropics are deliberately outside the polydrug
 * ceiling, and so are coffee and cigarettes, which a new player consumes
 * constantly without meaning to take a risk. **Family describes; class kills.**
 * A regress case already fails the build if a row picks up a class outside that
 * set, so this script must never report the absence as a gap — see
 * docs/systems-survival.md.
 *
 * The four checks are things the engine READS and would silently ignore:
 *
 *   ARC        a `phases` block, so the drug has a shape over time rather than
 *              snapping on and off
 *   BITE       `phases.peak_mods` with something in it, so the arc is mechanical
 *              and not only prose
 *   HABIT      a `tolerance` block, so repeat use means anything
 *   COMEDOWN   `phases.comedown_mods`, for the drugs whose comedown is its own
 *              event rather than less of the peak
 *
 * Plus two hard faults, which ARE errors rather than score:
 *
 *   ⚠ CAN HOOK YOU AND DO NOTHING — `addiction_chance > 0` with no
 *     `withdrawal.mods`. The withdrawal tick is gated on those mods, so the row
 *     latches `is_addicted` for ever and never debuffs, never speaks, and never
 *     clears. An invisible, unclearable flag.
 *   ⚠ SILENT ARC — a `phases` block with no `peak_mods` at all. The entry is
 *     created, the messages fire, and nothing happens to the player.
 *   ⚠ A MOD KEY NOTHING READS. `applyMods` does `player[key] = (player[key]||0)
 *     + n` for whatever it is handed, so a misspelt stat neither throws nor
 *     warns — it invents a field on the live player object that no reader has
 *     ever heard of. `drug_toluene` carried `stat_smarts: -3` in two blocks;
 *     the six real stats are brawn/reflexes/endurance/brains/cool/senses, and
 *     that debuff had never once landed.
 *
 *   node scripts/content/drug-audit.mjs [--fail-under N] [--quiet]
 */
import fs from 'fs';
import path from 'path';

const DRUGS = path.join(process.cwd(), 'content', 'drugs');
const QUIET = process.argv.includes('--quiet');
const failUnder = (() => {
  const i = process.argv.indexOf('--fail-under');
  return i > 0 ? Number(process.argv[i + 1]) : null;
})();

// Rows that are SUPPOSED to be bare, with the reason. Anything here is excluded
// from the score rather than scoring zero, because a zero it can never fix is
// noise that trains you to ignore the report.
const EXEMPT = {
  drug_compound: 'the splice carrier — a spliced compound carries its whole composed effects blob on the inventory item, so this row must stay empty',
  drug_loose_tobacco: 'raw material, not a dose — the cigarette rolled from it is the drug',
  drug_loose_cannabis: 'raw material, not a dose — the joint rolled from it is the drug',
};

// A comedown that is its own event is a judgement, not a gap: most drugs really
// do just wear off. Scored only for the ones whose own authored comedown line
// describes a NEW state rather than a fading one — a crash, a re-entry, a
// morning. Anything not here neither earns nor loses the point.
const WANTS_COMEDOWN = new Set([
  'drug_alcohol', 'drug_redline', 'drug_coldfire', 'drug_overclock', 'drug_buzz',
  'drug_coffee', 'drug_cigarettes', 'drug_amyls', 'drug_toluene', 'drug_glasshollow',
]);

// Every key a mod block may carry, and nothing else. The stats are the six
// `players.stat_*` columns in schema.js; the caps are statmods.js's own
// CAP_TO_CURRENT set; the drips are the bases tickDrugs will accept
// (`<base>` plus an optional `<base>_max` cap, with radiation special-cased).
const STATS = ['stat_brawn', 'stat_reflexes', 'stat_endurance', 'stat_brains', 'stat_cool', 'stat_senses'];
const CAPS = ['hp_max', 'sanity_max', 'stamina_max'];
const DRIP_BASES = ['hp', 'sanity', 'stamina', 'radiation'];
const readableMod = (k) => STATS.includes(k) || CAPS.includes(k)
  || (/_regen_per_sec$/.test(k) && DRIP_BASES.includes(k.replace(/_regen_per_sec$/, '')));

const rows = fs.readdirSync(DRUGS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DRUGS, f), 'utf8')))
  .sort((a, b) => a.id.localeCompare(b.id));

const faults = [];
const scored = [];

for (const d of rows) {
  const eff = d.effects || {};
  const ph = eff.phases || null;
  const wd = eff.withdrawal || null;
  const peakKeys = Object.keys(ph?.peak_mods || {}).length;

  // ── hard faults ───────────────────────────────────────────────────────────
  if ((d.addiction_chance || 0) > 0 && !wd?.mods) {
    faults.push(`${d.id}: addiction_chance ${d.addiction_chance} but no withdrawal.mods — it can hook you and then do nothing, for ever`);
  }
  if (ph && peakKeys === 0) {
    faults.push(`${d.id}: has a phases block with no peak_mods — the arc runs, the messages fire, and nothing happens to the player`);
  }
  for (const [block, mods] of [['phases.peak_mods', ph?.peak_mods], ['phases.comedown_mods', ph?.comedown_mods], ['withdrawal.mods', wd?.mods]]) {
    for (const k of Object.keys(mods || {})) {
      if (!readableMod(k)) faults.push(`${d.id}: ${block}.${k} is not a field anything reads — it lands on the player object and is never looked at again`);
    }
  }

  if (EXEMPT[d.id]) continue;

  // ── score ─────────────────────────────────────────────────────────────────
  const marks = {
    ARC: !!ph,
    BITE: peakKeys > 0,
    HABIT: !!eff.tolerance,
    COMEDOWN: !WANTS_COMEDOWN.has(d.id) || !!ph?.comedown_mods,
  };
  const score = Object.values(marks).filter(Boolean).length;
  scored.push({ id: d.id, name: d.name, marks, score, ph, wd, peakKeys, d });
}

if (!QUIET) {
  const cell = (ok) => (ok ? '  ✓ ' : '  · ');
  console.log('');
  console.log('  drug'.padEnd(26) + 'ARC  BITE HABIT COMEDOWN   phases(up/peak/down)  wd  score');
  console.log('  ' + '─'.repeat(84));
  for (const r of [...scored].sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))) {
    const p = r.ph ? `${r.ph.comeup_seconds || 0}/${r.ph.peak_seconds || 0}/${r.ph.comedown_seconds || 0}` : '—';
    const wdMark = r.wd?.mods ? (Object.keys(r.wd.stages || {}).length === 5 ? 'full' : 'part') : '—';
    console.log('  ' + r.id.padEnd(24)
      + cell(r.marks.ARC) + cell(r.marks.BITE) + ' ' + cell(r.marks.HABIT) + '  ' + cell(r.marks.COMEDOWN)
      + '   ' + p.padStart(18) + '  ' + wdMark.padStart(4) + '  ' + `${r.score}/4`.padStart(5));
  }
  console.log('');
  for (const [id, why] of Object.entries(EXEMPT)) console.log(`  exempt  ${id.padEnd(22)} ${why}`);
}

const perfect = scored.filter((r) => r.score === 4).length;
const total = scored.length;
const avg = scored.reduce((a, r) => a + r.score, 0) / Math.max(1, total);
console.log('');
console.log(`  ${perfect}/${total} drugs score 4/4, mean ${avg.toFixed(2)}/4 (${Object.keys(EXEMPT).length} exempt).`);
const noArc = scored.filter((r) => !r.marks.ARC);
if (noArc.length) console.log(`  No phase arc (${noArc.length}): ${noArc.map((r) => r.id.replace(/^drug_/, '')).join(', ')}`);
const noTol = scored.filter((r) => !r.marks.HABIT);
if (noTol.length) console.log(`  No tolerance (${noTol.length}): ${noTol.map((r) => r.id.replace(/^drug_/, '')).join(', ')}`);
const noCd = scored.filter((r) => !r.marks.COMEDOWN);
if (noCd.length) console.log(`  Wants comedown_mods (${noCd.length}): ${noCd.map((r) => r.id.replace(/^drug_/, '')).join(', ')}`);

if (faults.length) {
  console.error('');
  for (const f of faults) console.error('  ! ' + f);
  console.error(`  ${faults.length} hard fault(s) — these are bugs, not missing polish.`);
}

// Faults always fail; the score only fails when a floor is asked for.
if (faults.length) process.exit(1);
if (failUnder != null && avg < failUnder) {
  console.error(`  mean ${avg.toFixed(2)} is under the requested floor of ${failUnder}.`);
  process.exit(1);
}
