// Cannabis plugin regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

export default async function regress({ check, getPlayer }) {
  // Red-eyes appearance hook: silent when not high, bloodshot line when high.
  const sober = { _cannabisHighUntil: 0 };
  check('no red-eyes note when sober', _test.redEyes(sober, false) === undefined, String(_test.redEyes(sober, false)));

  const stoned = { _cannabisHighUntil: Date.now() + 60_000 };
  check('red-eyes note when stoned (other)', /red and glassy/.test(_test.redEyes(stoned, false) || ''), _test.redEyes(stoned, false));
  check('red-eyes note when stoned (self)', /bloodshot/.test(_test.redEyes(stoned, true) || ''), _test.redEyes(stoned, true));

  // Expired high reads as sober.
  const expired = { _cannabisHighUntil: Date.now() - 1000 };
  check('expired high reads sober', _test.redEyes(expired, false) === undefined, String(_test.redEyes(expired, false)));

  // The munchies drain hunger in RAM and leave the write to the engine's
  // batched resourceTick: the tick marks the drain unsaved and sends nothing to
  // the database itself.
  const p = getPlayer();
  if (p) {
    const saved = { hunger: p.hunger, high: p._cannabisHighUntil, unsaved: p._munchiesUnsaved, sleeping: p.offline_sleeping };
    p.hunger = 50; p._cannabisHighUntil = Date.now() + 60_000; p._munchiesUnsaved = false; p.offline_sleeping = false;
    _test.highTick();
    check('the munchies drain hunger in RAM', p.hunger === 50 - _test.MUNCH_DRAIN, p.hunger);
    check('…and mark it for the batched write', p._munchiesUnsaved === true);
    p.hunger = saved.hunger; p._cannabisHighUntil = saved.high; p._munchiesUnsaved = saved.unsaved; p.offline_sleeping = saved.sleeping;
  }
}
