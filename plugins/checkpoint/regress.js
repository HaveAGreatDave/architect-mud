/**
 * checkpoint regress — the law is a pure move-gate driven by tile config, so the
 * manifest sweep + boot prove it registered. Here we unit-test the two data-driven
 * pieces that have real branching (the entry predicate and a clean-player pass) with
 * fake zones, and confirm ordinary dispatch still works. The wanted/contraband bust
 * paths need a wanted/dirty player + the arrest engine, covered by live play.
 */
import { _test } from './index.js';

export default async ({ run, check, getPlayer }) => {
  const { triggers, CHECKS } = _test;

  // Entry predicate — the directional heart of the South Gate recipe.
  check('fromDistrict: wilds-side origin trips it',
    triggers({ fromDistrict: 'wilds' }, { flags: { district: 'wilds' } }) === true);
  check('fromDistrict: city-side origin is free (leaving/around)',
    triggers({ fromDistrict: 'wilds' }, { flags: { district: 'wasteland' } }) === false);
  check('insideFlag: arriving from inside the enclave is free',
    triggers({ insideFlag: 'gov_enclave' }, { flags: { gov_enclave: true } }) === false);
  check('insideFlag: arriving from outside is checked',
    triggers({ insideFlag: 'gov_enclave' }, { flags: {} }) === true);
  check('no predicate → every entry checked',
    triggers({ checks: ['wanted'] }, { flags: {} }) === true);

  // A clean player clears the wanted check (returns undefined = pass).
  const player = getPlayer();
  const r = await CHECKS.wanted(player, { wantedMode: 'bluff' }, 'the gate guards', 'k');
  check('clean player passes the wanted check', r === undefined, JSON.stringify(r));

  const look = await run('look');
  check('look still works with checkpoint loaded', look && look.type !== 'error', JSON.stringify(look)?.slice(0, 80));
};
