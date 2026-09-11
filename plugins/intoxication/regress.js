// Intoxication plugin regression suite — routing, gating, and the meter math.
// Never loaded in production; run by tests/regress.js.
import { emit } from '../../server/engine/events.js';
import { _test } from './index.js';
import { getDrugCache } from '../../server/engine/drugs.js';

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

  // --- band stat impairment (reversible ledger) ------------------------------
  player.intoxication = 0; player._intoxBand = 0;
  const baseRef = player.stat_reflexes || 0;
  _test.narrateBand(player, 50);   // crosses into the "drunk" band (≥45)
  check('drunk impairs reflexes', (player.stat_reflexes || 0) === baseRef + _test.BAND_MODS.drunk.stat_reflexes, `ref=${player.stat_reflexes} base=${baseRef}`);
  _test.narrateBand(player, 80);   // "wasted" — deeper penalty replaces the drunk one
  check('wasted deepens the penalty', (player.stat_reflexes || 0) === baseRef + _test.BAND_MODS.wasted.stat_reflexes, `ref=${player.stat_reflexes}`);
  _test.narrateBand(player, 0);    // sober — ledger reverses
  check('sobering restores reflexes exactly', (player.stat_reflexes || 0) === baseRef, `ref=${player.stat_reflexes} base=${baseRef}`);

  // --- absorption: the reason it is possible to drink too much --------------
  //
  // A dose used to land whole and instantly, so over-drinking was something you
  // could only do deliberately: the meter always told you the truth before you
  // ordered the next one. These pin the lag, the stacking, and the two ways it
  // could strand a dose in the pool for ever.
  player.intoxication = 0; player._intoxBand = 0; player._intoxPending = 0; player._intoxRate = 0;
  {
    const DRINK = { flags: { alcoholic: true, intox_per_dose: 22, absorb_seconds: 900 } };
    emit('player.drugUsed', { player, drug: DRINK, potency: 1 });
    check('a drink with an absorb window does not land on the meter at once',
      (player.intoxication || 0) === 0, `intox=${player.intoxication}`);
    check('...it goes into the pending pool instead',
      (player._intoxPending || 0) > 0, `pending=${player._intoxPending}`);

    // One 4s tick of a 900s absorption is a small fraction, not the whole dose.
    const landed = _test.absorbTick(player, _test.TICK_SECONDS);
    check('absorption arrives in slices, not all at once', landed > 0 && landed < 22, `landed=${landed}`);

    // A second drink while the first is still arriving stacks. This is the case
    // the whole mechanic is about, and a rate that REPLACED would lose it.
    const pendingBefore = player._intoxPending;
    emit('player.drugUsed', { player, drug: DRINK, potency: 1 });
    check('a second drink stacks onto what is still coming',
      player._intoxPending > pendingBefore, `pending=${player._intoxPending} before=${pendingBefore}`);

    // Run the window out: everything queued must arrive, and the pool must close.
    _test.absorbTick(player, 2000);
    check('the pool empties once the window has passed', (player._intoxPending || 0) === 0, `pending=${player._intoxPending}`);
    check('and stops claiming a rate', (player._intoxRate || 0) === 0, `rate=${player._intoxRate}`);
  }

  // Coffee takes the drink you have not finished absorbing, not just the part of
  // it that already arrived — otherwise sobering up is undone a minute later by a
  // drink you had before the coffee.
  player.intoxication = 0; player._intoxBand = 0; player._intoxPending = 0; player._intoxRate = 0;
  _test.queueAbsorption(player, 20, 900);
  {
    const took = _test.drainPending(player, 30);
    check('sobering drains what is still in the pool first', took === 20, `took=${took}`);
    check('and leaves nothing queued behind it', (player._intoxPending || 0) === 0, `pending=${player._intoxPending}`);
  }

  // No absorb window authored — every path that fed the meter before this still
  // lands whole, which is what makes the change provably a no-op for them.
  player.intoxication = 0; player._intoxBand = 0; player._intoxPending = 0; player._intoxRate = 0;
  emit('player.drugUsed', { player, drug: { flags: { alcoholic: true, intox_per_dose: 22 } }, potency: 1 });
  check('a drink with no absorb window still lands whole', (player.intoxication || 0) === 22, `intox=${player.intoxication}`);
  check('and queues nothing', (player._intoxPending || 0) === 0, `pending=${player._intoxPending}`);

  // --- the live drug row, against the live constants -------------------------
  //
  // THE ONE THAT NEARLY SHIPPED. The meter decays the whole time a dose is
  // arriving, so a dose that arrives more slowly than DECAY_PER_TICK is eaten on
  // the way in and the meter NEVER MOVES: you drink, and nothing happens, with no
  // error anywhere. The first draft of the alcohol arc authored the honest
  // real-world figure of fifteen minutes and did exactly that.
  //
  // scripts/content/alcohol-arc.mjs holds the same rule against the same numbers,
  // but it restates the decay rate because it is a content script. This is the
  // assertion that stops the two drifting apart.
  {
    const al = getDrugCache()['drug_alcohol'];
    const absorb = Number(al?.flags?.absorb_seconds) || 0;
    const per = Number(al?.flags?.intox_per_dose) || 0;
    const decayPerSec = _test.DECAY_PER_TICK / _test.TICK_SECONDS;
    check('alcohol authors an absorption window at all', absorb > 0, `absorb=${absorb}`);
    check('a dose arrives faster than the meter sheds it',
      per / absorb > decayPerSec, `arrive=${(per / absorb).toFixed(4)}/s decay=${decayPerSec}/s`);
    // The lag is what is new; how drunk one drink gets you must not have moved.
    const peak = per - decayPerSec * absorb;
    check('one drink still peaks around the 22 the bands were drawn around',
      peak >= 15 && peak <= 30, `peak=${peak.toFixed(1)}`);
    // Two clocks, one fact: the peak line must fire when the meter tops out.
    check('the come-up and the absorption window are the same number',
      al?.effects?.phases?.comeup_seconds === absorb,
      `comeup=${al?.effects?.phases?.comeup_seconds} absorb=${absorb}`);
  }

  // Leave the fake player sober for any later suites.
  player.intoxication = 0; player._intoxBand = 0;
  player._intoxPending = 0; player._intoxRate = 0;
}
