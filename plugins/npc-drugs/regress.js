// npc-drugs regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

export default async function regress({ run, check }) {
  // ── Routing / gating (verbs are wired and guard their input) ──────────────────
  let r = await run('spike');
  check('spike usage', /Usage: spike/.test(r?.message || ''), r?.message);

  r = await run('jab');
  check('jab usage', /Usage: jab/.test(r?.message || ''), r?.message);

  r = await run('slip');
  check('slip usage', /Usage: slip/.test(r?.message || ''), r?.message);

  r = await run('slip lull nobodyxyz');   // no "to" → usage
  check('slip needs "to"', /Usage: slip/.test(r?.message || ''), r?.message);

  r = await run('spike nobodyxyz');       // empty room → no such NPC
  check('spike target resolution', /no "nobodyxyz"|no "one"/.test(r?.message || ''), r?.message);

  r = await run('jab nobodyxyz with lull');
  check('jab target resolution', /no "nobodyxyz"/.test(r?.message || ''), r?.message);

  // ── Pure helpers ──────────────────────────────────────────────────────────────
  const { classify, parseTargetWith } = _test;
  // Unclassed drugs keep the old derivation — the fallback must not regress.
  check('classify: hallucinogen → paranoid', classify({ hallucination: {} }) === 'paranoid');
  check('classify: reflexes-up → wired', classify({ phases: { peak_mods: { stat_reflexes: 2 } } }) === 'wired');
  check('classify: stamina-up → wired', classify({ instant: { stamina: 10 } }) === 'wired');
  check('classify: downer → sedated', classify({ instant: { sanity: 16 }, phases: { peak_mods: { stat_reflexes: -2 } } }) === 'sedated');
  check('classify: empty → sedated', classify({}) === 'sedated');

  // ── drug_class drives the reaction ────────────────────────────────────────────
  // The point of the whole taxonomy: a dissociative, a psychedelic and a deliriant
  // are three different nights out, and used to be one bucket called `paranoid`.
  const byClass = {
    stimulant: 'wired', nootropic: 'lucid', depressant: 'sedated', opioid: 'sedated',
    cannabis: 'mellow', psychedelic: 'tripping', dissociative: 'dissociated', deliriant: 'paranoid',
  };
  for (const [fam, kind] of Object.entries(byClass)) {
    check(`classify: ${fam} → ${kind}`, classify({}, { drug_family: fam }) === kind, classify({}, { drug_family: fam }));
  }
  check('classify: family BEATS the stat derivation',
    classify({ hallucination: {} }, { drug_family: 'dissociative' }) === 'dissociated');
  check('classify: an unknown family falls back to the derivation',
    classify({ hallucination: {} }, { drug_family: 'not_a_real_family' }) === 'paranoid');
  check('classify: no flags at all still works', classify({ hallucination: {} }, undefined) === 'paranoid');
  // drug_class is a fallback only — a depressant shouldn't need both authored.
  check('classify: drug_class still answers when there is no family',
    classify({}, { drug_class: 'depressant' }) === 'sedated');
  check('classify: family WINS over class when both are present',
    classify({}, { drug_class: 'depressant', drug_family: 'dissociative' }) === 'dissociated');

  // The load-bearing separation: family must never be mistaken for the polydrug
  // overdose field. Only depressant/stimulant may carry drug_class — a psychedelic
  // that acquires one gets a shared overdose ceiling nobody designed.
  const { getDrugCache } = await import('../../server/engine/drugs.js');
  const strayClass = Object.values(getDrugCache())
    .filter(d => d.flags?.drug_class && !['depressant', 'stimulant', 'unknown'].includes(d.flags.drug_class))
    .map(d => `${d.name}=${d.flags.drug_class}`);
  check('no drug carries a drug_class outside the additive-load set', strayClass.length === 0, strayClass.join(', '));

  // Every kind the classifier can emit must be a state the rest of the plugin can
  // actually render — a missing LINE throws inside doseNpc, mid-dose.
  const { LINE, SOBER } = _test;
  const kinds = [...new Set(Object.values(byClass))];
  check('every classified kind has an onset line',
    kinds.every(k => k === 'sedated' || typeof LINE[k] === 'function'),
    kinds.filter(k => k !== 'sedated' && !LINE[k]).join(','));
  check('every classified kind has a coming-down line',
    kinds.every(k => typeof SOBER[k] === 'function'), kinds.filter(k => !SOBER[k]).join(','));

  const p1 = parseTargetWith(['voss', 'with', 'black', 'tar']);
  check('parse: with-clause splits', p1.who === 'voss' && p1.drug === 'black tar', JSON.stringify(p1));
  const p2 = parseTargetWith(['voss']);
  check('parse: no with → drug null', p2.who === 'voss' && p2.drug === null, JSON.stringify(p2));

  // ── What talking to someone on something looks like ───────────────────────────
  // Every state the tell can name must HAVE a line — a missing one throws inside
  // the npc.talk hook, which would break the conversation for an ordinary NPC.
  const { doseState, TALK_TELL } = _test;
  check('doseState: nothing on board → null', doseState({}) === null && doseState(null) === null);
  check('doseState: out beats everything', doseState({ dose: { out: true, loose: true } }) === 'out');
  check('doseState: belligerent beats loose', doseState({ dose: { loose: true, belligerent: true } }) === 'belligerent');
  check('doseState: paranoid flee', doseState({ dose: { flee: true } }) === 'flee');
  check('doseState: wired', doseState({ dose: { wired: true } }) === 'wired');
  check('doseState: mellow', doseState({ dose: { mellow: true } }) === 'mellow');
  check('doseState: tripping', doseState({ dose: { tripping: true } }) === 'tripping');
  check('doseState: dissociated', doseState({ dose: { dissociated: true } }) === 'dissociated');
  check('doseState: lucid', doseState({ dose: { lucid: true } }) === 'lucid');
  check('doseState: dissociated outranks belligerent', doseState({ dose: { dissociated: true, belligerent: true } }) === 'dissociated');
  check('doseState: a dose with no sub-flags names nothing', doseState({ dose: { doses: 1 } }) === null);
  check('doseState: the aftermath is its own state',
    doseState({ comedown: { kind: 'wired', until: 2000 } }, 1000) === 'comedown');
  check('doseState: an expired comedown is over',
    doseState({ comedown: { kind: 'wired', until: 500 } }, 1000) === null);
  const states = ['out', 'flee', 'belligerent', 'wired', 'loose', 'comedown',
    'mellow', 'tripping', 'dissociated', 'lucid'];
  check('every dose state has a talk tell',
    states.every(s => typeof TALK_TELL[s] === 'function' && TALK_TELL[s]('X').includes('X')),
    states.filter(s => !TALK_TELL[s]).join(','));

  // ── Habit rituals: a drink is a drink ─────────────────────────────────────────
  // The drink flags exist because a drink's name is authored flavour ("embassy
  // reserve") and will never be in the drugs catalogue — so the DRUG path's
  // unrecognised default would hand an anchor a stimulant jag off a glass of
  // whisky, narrated as a line off a hand mirror. These assert the split holds.
  const { kindForNamed, PRESHOW_RITUALS, PRESHOW_DRINK_RITUALS, BOOZE_RITUALS, DRUG_RITUALS } = _test;
  check('an unrecognised drug name still reads as an upper', kindForNamed('embassy reserve') === 'wired');
  const pools = { PRESHOW_RITUALS, PRESHOW_DRINK_RITUALS, BOOZE_RITUALS, DRUG_RITUALS };
  for (const [name, pool] of Object.entries(pools)) {
    check(`${name}: every ritual is a multi-beat act`, pool.length > 0 && pool.every(r => r.length >= 2), `${pool.length} rituals`);
    check(`${name}: every ritual names the substance exactly once`,
      pool.every(r => r.filter(b => b.includes('{drug}')).length === 1),
      pool.map(r => r.filter(b => b.includes('{drug}')).length).join(','));
    // A pool reused by any NPC carrying the flag cannot assume a gender.
    check(`${name}: no gendered pronouns`,
      pool.every(r => r.every(b => !/\b(he|his|him|she|her|hers)\b/i.test(b))),
      pool.flat().find(b => /\b(he|his|him|she|her|hers)\b/i.test(b)) || '');
  }
  const drinkWords = /\b(pours?|drinks?|drank|glass|bottle|shot|measure|knocks back)\b/i;
  check('the drink rituals are about drinking, not about powder',
    [...PRESHOW_DRINK_RITUALS, ...BOOZE_RITUALS].every(r => r.some(b => drinkWords.test(b)))
      && ![...PRESHOW_DRINK_RITUALS, ...BOOZE_RITUALS].flat().some(b => /\b(line|bump|gums|snort)\b/i.test(b)));

  // ── A night has a size ──────────────────────────────────────────────────────
  // The habit used to be one pour, so every night was identically bad and the worst
  // evening of a man's life was indistinguishable from a Tuesday. The extra pours
  // are what make it watchable: a visible beat in the room, not a bigger number.
  {
    const w = _test.POUR_WEIGHTS;
    check('pours: most nights are ordinary', w.filter((n) => n === 0).length > w.length / 2,
      JSON.stringify(w));
    check('pours: a bad night is reachable', Math.max(...w) >= 2, JSON.stringify(w));
    check('pours: and it can never reach the blackout ladder on its own',
      1 + Math.max(...w) < 5, String(1 + Math.max(...w)));
    check('pours: every extra pour is something you can SEE',
      _test.POUR_AGAIN.length >= 3 && _test.POUR_AGAIN.every((l) => typeof l === 'string' && l.trim()),
      String(_test.POUR_AGAIN.length));
    // ⚠ Real seconds apart, never a burst: five lines in one tick is a number going
    // up, and the entire point is that somebody standing there watches him go back.
    check('pours: they are spaced far enough apart to be watched',
      _test.POUR_GAP_MS[0] >= 15000 && _test.POUR_GAP_MS[1] > _test.POUR_GAP_MS[0],
      JSON.stringify(_test.POUR_GAP_MS));
  }
}
