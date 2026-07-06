// vale-apology regression suite — run by tests/regress.js (never loaded in
// production). The full scene needs a live zone.entered from the real Akerson
// account and is covered by manual QA; here we lock down the Akerson matcher and
// the one-time latch's constants so the trigger can't silently mis-fire.
import { _test } from './index.js';

export default async function regress({ check }) {
  // ── Akerson matcher — handle/username fallback (no world state needed) ─────────
  check('matches by handle', _test.isAkerson({ id: 'x', handle: 'akerson' }) === true, 'handle akerson');
  check('matches by handle (case-insensitive)', _test.isAkerson({ id: 'x', handle: 'Akerson' }) === true, 'handle Akerson');
  check('matches by username', _test.isAkerson({ id: 'x', username: 'akerson' }) === true, 'username akerson');
  check('rejects a stranger', _test.isAkerson({ id: 'y', handle: 'dave' }) === false, 'handle dave');
  check('rejects null actor', _test.isAkerson(null) === false, 'null');

  // ── Constants wired to the intended entities ──────────────────────────────────
  check('targets Sergeant Vale', _test.VALE_ID === 'npc_pd_officer', _test.VALE_ID);
  check('moves her to her own home (Unit 2B)', _test.HOME === 'zone_apt_6', _test.HOME);
  check('gift is ₵200', _test.GIFT === 200, String(_test.GIFT));
  check('one-time via a world flag', typeof _test.FLAG === 'string' && _test.FLAG.length > 0, _test.FLAG);
}
