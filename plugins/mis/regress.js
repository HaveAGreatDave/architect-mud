// MIS plugin regression suite — run by tests/regress.js (never loaded in production).
// The harness's fake player has mis_enabled=0, so these verify the consent gate
// and the multi-word input-matcher routing.
import { ejaculateDescription } from '../../server/engine/appearance.js';

export default async function regress({ run, check }) {
  // Fluid on the penis is a body site; clothing that fills the `legs` slot must hide
  // it. Covered legs → nothing shown; bare legs → shown. (Regression: "penis" never
  // matched the "legs" slot key, so it leaked through fully clothed legs.)
  {
    const p = { handle: 'Test', appearance_data: { ejaculate_state: { locations: ['penis'] } } };
    check('ejaculate on penis hidden when legs are clothed',
      ejaculateDescription(p, true, new Set(['legs'])) === null,
      ejaculateDescription(p, true, new Set(['legs'])));
    check('ejaculate on penis shown when legs are bare',
      /penis/.test(ejaculateDescription(p, true, new Set(['torso'])) || ''),
      ejaculateDescription(p, true, new Set(['torso'])));
  }

  let r = await run('touch self');
  check('verb gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run('jerk off on somebody');
  check('multi-word matcher routes + gates', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run('mis');
  check('mis toggle verb reachable', r != null && !/Unknown command/.test(r?.message || ''), r?.message);

  r = await run('finger somebody');
  check('finger verb gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  r = await run("cum in somebody's mouth");
  check('cum-in gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);

  // strip is a MIS verb: hidden from a player who hasn't opted in.
  r = await run('strip somebody');
  check('strip gated when opted out', r?.type === 'error' && /Unknown command/.test(r.message || ''), r?.message);
}
