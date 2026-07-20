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
  check('classify: hallucinogen → paranoid', classify({ hallucination: {} }) === 'paranoid');
  check('classify: reflexes-up → wired', classify({ phases: { peak_mods: { stat_reflexes: 2 } } }) === 'wired');
  check('classify: stamina-up → wired', classify({ instant: { stamina: 10 } }) === 'wired');
  check('classify: downer → sedated', classify({ instant: { sanity: 16 }, phases: { peak_mods: { stat_reflexes: -2 } } }) === 'sedated');
  check('classify: empty → sedated', classify({}) === 'sedated');

  const p1 = parseTargetWith(['voss', 'with', 'black', 'tar']);
  check('parse: with-clause splits', p1.who === 'voss' && p1.drug === 'black tar', JSON.stringify(p1));
  const p2 = parseTargetWith(['voss']);
  check('parse: no with → drug null', p2.who === 'voss' && p2.drug === null, JSON.stringify(p2));
}
