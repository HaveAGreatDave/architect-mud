// MIS plugin regression suite — run by tests/regress.js (never loaded in production).
// The harness's fake player has mis_enabled=0, so these verify the consent gate
// and the multi-word input-matcher routing.
import { ejaculateDescription } from '../../server/engine/appearance.js';
import { THREESOME_JOIN_MSGS, THREESOME_CLIMAX_MSGS } from './mis-system.js';

export default async function regress({ run, check }) {
  // Threesome pools are well-formed: join lines name the third party, both pools
  // non-empty strings. (The {name}/{target} tokens are optional per line; {third}
  // must appear on every join line so the joiner is always named.)
  check('threesome: join pool non-empty and always names the third',
    Array.isArray(THREESOME_JOIN_MSGS) && THREESOME_JOIN_MSGS.length > 0
    && THREESOME_JOIN_MSGS.every(l => typeof l === 'string' && l.includes('{third}')),
    `${THREESOME_JOIN_MSGS?.length}`);
  check('threesome: climax pool non-empty and names the third',
    Array.isArray(THREESOME_CLIMAX_MSGS) && THREESOME_CLIMAX_MSGS.length > 0
    && THREESOME_CLIMAX_MSGS.every(l => typeof l === 'string' && l.includes('{third}')),
    `${THREESOME_CLIMAX_MSGS?.length}`);

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
