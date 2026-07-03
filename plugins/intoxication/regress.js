// Intoxication plugin regression suite — routing, gating, and the meter math.
// Never loaded in production; run by tests/regress.js.
import { emit } from '../../server/engine/events.js';
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();

  // --- slur transform ---------------------------------------------------------
  check('slur is a no-op when sober', _test.slur('the quick brown fox', 0) === 'the quick brown fox');
  const slurred = _test.slur('sisters speak softly', 100);
  check('slur mangles speech when wasted', slurred !== 'sisters speak softly', slurred);

  // --- meter ingestion via the real event path -------------------------------
  player.intoxication = 0; player._intoxBand = 0;
  emit('player.drugUsed', { player, drug: { flags: { alcoholic: true, intox_per_dose: 22 } }, potency: 1 });
  check('alcoholic drink raises the meter', (player.intoxication || 0) > 0, `intox=${player.intoxication}`);

  const drunkLevel = player.intoxication;
  emit('player.drugUsed', { player, drug: { flags: { sobering: true, sober_amount: 30 } }, potency: 1 });
  check('coffee lowers the meter', player.intoxication < drunkLevel, `intox=${player.intoxication}`);

  // --- clamping ---------------------------------------------------------------
  _test.addIntoxication(player, 500);
  check('meter clamps at 100', player.intoxication === 100);
  _test.addIntoxication(player, -500);
  check('meter floors at 0', player.intoxication === 0);

  // --- blackout gate ----------------------------------------------------------
  player.blackedOutUntil = Date.now() + 8000;
  const blocked = await run('look');
  check('blackout gate blocks commands', blocked?.type === 'error' && /black/i.test(blocked?.message || ''), blocked?.message);
  player.blackedOutUntil = 0;
  const after = await run('look');
  check('commands work once blackout lifts', after?.type !== 'error' || !/black/i.test(after?.message || ''), after?.message);

  // Leave the fake player sober for any later suites.
  player.intoxication = 0; player._intoxBand = 0;
}
