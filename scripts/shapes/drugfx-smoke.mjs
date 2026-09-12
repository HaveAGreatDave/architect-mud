// ── DOES EVERY DRUG'S LOOK ACTUALLY EXIST? ───────────────────────────────────
//
// `weatherfx-smoke.mjs` proves the room pane's field symptoms put paint down.
// This proves the other two thirds: that every SCREEN symptom has a CSS rule,
// every WINDOW profile has a branch in the flight renderer, and that what the 39
// drug rows resolve to is inside all three vocabularies.
//
// ⚠ The failure being hunted is silence, in every direction. A screen symptom
// with no CSS is a class on <body> that styles nothing; a window profile the
// renderer has never heard of falls through to `psychedelic` and a dissociative
// flies like an acid trip; an `effects.fx` block naming a field that does not
// exist renders NOTHING and reads exactly like "no effect was wanted here". Not
// one of those throws, warns, or looks different from a decision somebody made.
//
// ⚠ And the same rule the mutations system ended up with: AN AUTHORED KEY THAT
// NOTHING READS IS A BUILD FAILURE. `effects` sat on every mutation and was read
// by literally nothing for months. A stat a drug moves with no sentence in
// drug-feel.js is the same hole — the drug changes you and never says so, which
// is the exact problem this whole pass exists to close.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const {
  FIELD_FX, SCREEN_FX, WINDOW_PROFILES, PALETTES, FX_BY_FAMILY, FX_BY_CLASS, ALL_FX,
  PHASE_SCALE, resolveDrugFx, unknownFxNames,
} = await import('../../client/shared/drug-fx.js');
const { FEELABLE_KEYS, feelLines } = await import('../../server/engine/drug-feel.js');

export function drugFxSmoke() {
  const out = [];
  const ok = (name, cond, detail) => out.push({ name, ok: !!cond, detail: detail == null ? '' : String(detail) });

  const css = read('client/game/styles.css');
  const flight = read('client/game/js/panels/flight-drugfx.js');
  const drugs = fs.readdirSync(path.join(ROOT, 'content/drugs')).sort()
    .map(f => JSON.parse(read(path.join('content/drugs', f))));

  // ── the three vocabularies have renderers ─────────────────────────────────
  //
  // ⚠ A screen symptom reaches the page by one of TWO routes and the first cut
  // of this check only knew about one, so it failed three symptoms that work.
  // Most become a `dfx-<name>` class the stylesheet selects on; `desat` and
  // `oversat` are resolved to a single `--dfx-sat` number by the composer
  // (because they can be asked for at once and a class each would take turns),
  // and `narrow` becomes an element. So the test is "does the composer handle
  // this name, AND does the stylesheet read what it writes" — which is the
  // actual question, and is why it is a pair rather than a grep.
  const composer = read('client/game/js/panels/drug-screen-fx.js');
  const SCREEN_HOOK = {
    breathe: '--dfx-breathe', sway: '--dfx-sway', blur: '--dfx-blur',
    double: '--dfx-double', melt: '--dfx-melt', jitter: '--dfx-jitter',
    halo: '--dfx-halo', desat: '--dfx-sat', oversat: '--dfx-sat',
    narrow: '#dfx-tunnel',
  };
  for (const s of SCREEN_FX) {
    ok(`screen '${s}': the composer handles it`, composer.includes(`'${s}'`),
      'drug-screen-fx.js never reads this name, so the symptom does nothing');
    const hook = SCREEN_HOOK[s];
    ok(`screen '${s}': the stylesheet reads what it writes`, !!hook && css.includes(hook),
      hook ? `${hook} appears nowhere in styles.css` : 'no hook declared in this suite');
  }
  ok('every screen symptom has a declared hook',
    SCREEN_FX.every(s => s in SCREEN_HOOK),
    SCREEN_FX.filter(s => !(s in SCREEN_HOOK)).join(', '));
  for (const p of WINDOW_PROFILES) {
    // 'psychedelic' is the else-branch and names itself only in prose, so it is
    // matched by the fallback rather than by a string — the others must appear
    // as a literal comparison.
    ok(`window '${p}': has a branch`,
      p === 'psychedelic' || flight.includes(`prof === '${p}'`),
      'flight-drugfx.js would fall through to psychedelic');
  }
  ok('every palette the law names has a hue',
    [...Object.values(FX_BY_FAMILY)].every(f => !f.palette || f.palette in PALETTES),
    Object.values(FX_BY_FAMILY).filter(f => f.palette && !(f.palette in PALETTES)).map(f => f.palette).join(', '));

  // ── the family law only names things that exist ───────────────────────────
  for (const [family, law] of Object.entries(FX_BY_FAMILY)) {
    for (const phase of Object.keys(PHASE_SCALE)) {
      const act = law[phase];
      ok(`${family}/${phase}: declared`, !!act, 'the arc has a hole in it');
      if (!act) continue;
      ok(`${family}/${phase}: field is real`, !act.field || FIELD_FX.includes(act.field), act.field);
      ok(`${family}/${phase}: screen names are real`,
        (act.screen || []).every(s => SCREEN_FX.includes(s)),
        (act.screen || []).filter(s => !SCREEN_FX.includes(s)).join(', '));
    }
    ok(`${family}: window profile is real`, !law.window || WINDOW_PROFILES.includes(law.window), law.window);
  }
  ok('every class fallback points at a real family law',
    Object.values(FX_BY_CLASS).every(v => Object.values(FX_BY_FAMILY).includes(v)));

  // ── every drug row ────────────────────────────────────────────────────────
  let withFx = 0, authored = 0;
  for (const d of drugs) {
    const bad = unknownFxNames(d.effects?.fx);
    ok(`${d.id}: authored fx names exist`, bad.length === 0, bad.join(', '));
    if (d.effects?.fx) authored++;

    let any = false;
    for (const phase of Object.keys(PHASE_SCALE)) {
      const fx = resolveDrugFx(d, phase, 1);
      if (!fx) continue;
      any = true;
      ok(`${d.id}/${phase}: field renders`, !fx.field || FIELD_FX.includes(fx.field), fx.field);
      ok(`${d.id}/${phase}: screen renders`, fx.screen.every(s => SCREEN_FX.includes(s)), fx.screen.join(', '));
      ok(`${d.id}/${phase}: profile renders`, !fx.profile || WINDOW_PROFILES.includes(fx.profile), fx.profile);
      ok(`${d.id}/${phase}: intensity is a fraction`, fx.intensity > 0 && fx.intensity <= 1, fx.intensity);
    }
    if (any) withFx++;
  }
  // Not every drug should have a look — loose leaf and the splice carrier
  // deliberately do not, and a phantom deliriant must not. But most should, and
  // a collapse to nothing is the silent failure this file is here for.
  ok('most drugs resolve to a look', withFx >= drugs.length - 6, `${withFx} of ${drugs.length}`);
  ok('the per-row exceptions are still authored', authored > 0, `${authored} rows carry an fx block`);

  // ⚠ A `phantom` hallucination must stay invisible. The whole illusion is that
  // there is no drug — fake people walk into the real room and behave — and a
  // screen that announces you are high deletes it. Asserted here rather than
  // trusted, because it is one `if` in a shared law and nothing else would notice.
  for (const d of drugs.filter(d => d.effects?.hallucination?.mode === 'phantom')) {
    ok(`${d.id}: a phantom trip shows nothing`,
      Object.keys(PHASE_SCALE).every(p => resolveDrugFx(d, p, 1) === null));
  }

  // ── a transformed sky names a field that exists ───────────────────────────
  //
  // `drug_transforms.fx` / `fx_intensity` sat authored and unread from the day
  // the transforms shipped: the weather stopped behaving in PROSE while the
  // particle field over the room pane went on rendering the real drizzle. It has
  // a reader now (plugins/trip), which is exactly why it needs a gate — an
  // unknown name renders nothing at all and reads as a deliberate blank.
  {
    const dir = path.join(ROOT, 'content/drug_transforms');
    const rows = fs.existsSync(dir)
      ? fs.readdirSync(dir).map(f => JSON.parse(read(path.join('content/drug_transforms', f))))
      : [];
    const withFx = rows.filter(r => r.fx);
    const badName = withFx.filter(r => !ALL_FX.includes(r.fx));
    ok('every transform fx names an effect the client renders', badName.length === 0,
      badName.map(r => `${r.id}=${r.fx}`).join(', '));
    const badInt = withFx.filter(r => r.fx_intensity != null && (r.fx_intensity < 0 || r.fx_intensity > 1));
    ok('...at an intensity inside 0..1', badInt.length === 0, badInt.map(r => r.id).join(', '));
    // ⚠ Only the WEATHER scope is read. An `fx` on a room or object row is an
    // authored key nothing looks at, which is the state this whole check exists
    // to stop the file drifting back into.
    const wrongScope = withFx.filter(r => (r.scope || 'object') !== 'weather');
    ok('...and sits on the weather scope, the only one that reads it',
      wrongScope.length === 0, wrongScope.map(r => `${r.id} scope=${r.scope}`).join(', '));
  }

  // ── every stat a drug moves has a sentence ────────────────────────────────
  const moved = new Set();
  for (const d of drugs) {
    const e = d.effects || {};
    for (const block of [e.phases?.peak_mods, e.phases?.comedown_mods, e.withdrawal?.mods, e.overdose?.mods]) {
      for (const [k, v] of Object.entries(block || {})) if (Number(v)) moved.add(k);
    }
  }
  // Resources the HUD already shows a bar for. A drug that takes HP does not
  // need a sentence saying so — the number moved on screen — and inventing one
  // would be narrating the interface.
  const SHOWN_ON_THE_HUD = ['hp', 'sanity', 'hunger', 'thirst', 'radiation', 'horniness_increase', 'stamina'];
  const silent = [...moved].filter(k => !FEELABLE_KEYS.includes(k) && !SHOWN_ON_THE_HUD.includes(k));
  ok('every stat a drug moves has a body line', silent.length === 0,
    `${silent.join(', ')} — authored by a drug and described by nothing`);

  // And the describer actually produces one for each.
  for (const k of FEELABLE_KEYS) {
    const up = feelLines({ [k]: 5 }), down = feelLines({ [k]: -5 });
    ok(`${k}: describes both directions`, up.length === 1 && down.length === 1 && up[0] !== down[0],
      `${up.length}/${down.length}`);
  }
  ok('an empty block says nothing', feelLines({}).length === 0);
  ok('a zero mod says nothing', feelLines({ stat_brawn: 0 }).length === 0);
  ok('no more than three lines at once',
    feelLines({ stat_brawn: 9, stat_reflexes: 8, stat_brains: 7, stat_cool: 6, stat_endurance: 5 }).length === 3);
  // The three biggest movers, in order — that is what makes it a report about
  // your body rather than a dump of the block.
  ok('the strongest mover leads',
    feelLines({ stat_cool: 1, stat_brawn: 9 })[0] === feelLines({ stat_brawn: 9 })[0]);

  return out;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('drugfx-smoke.mjs')) {
  const res = drugFxSmoke();
  let bad = 0;
  for (const r of res) {
    if (!r.ok) bad++;
    if (!r.ok || process.argv.includes('--verbose')) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `  ↳ ${r.detail}` : ''}`);
  }
  console.log(bad ? `\n${bad} failure(s) of ${res.length}.` : `\n✓ drug-fx smoke — ${res.length} checks passed`);
  process.exit(bad ? 1 : 0);
}
