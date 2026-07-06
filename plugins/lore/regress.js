// Lore plugin regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';

export default async function regress({ check, getPlayer }) {
  const player = getPlayer();
  const zone = { id: 'zone_lore_test', flags: { intro_lore: 'The place has a history. None of it kind.' } };
  const bare = { id: 'zone_lore_bare', flags: {} };

  // Clean slate — this account may carry flags from a prior run.
  await clearFlag('player', _test.ELIGIBLE_FLAG, player);
  await clearFlag('player', _test.seenKey(zone.id), player);

  // Ineligible account (no lore_intro flag): authored lore stays hidden.
  let out = await _test.introLore(zone, player);
  check('lore withheld from ineligible account', !out, String(out));

  // Make the account eligible, as character creation would.
  await _test.onPlayerCreate(player);

  // First render of the visit: the shimmering block is returned with the prose.
  out = await _test.introLore(zone, player);
  check('lore shown on first render', /class="intro-lore"/.test(out || '') && /None of it kind/.test(out || ''), String(out));

  // Re-render during the SAME visit (a silent re-look): the block must persist,
  // not vanish — seen is not committed at render time.
  out = await _test.introLore(zone, player);
  check('lore persists across re-renders in the same visit', /class="intro-lore"/.test(out || ''), String(out));

  // A zone with no authored intro_lore never produces a block, even for eligibles.
  out = await _test.introLore(bare, player);
  check('no lore for a zone without intro_lore', !out, String(out));

  // Departure commits "seen": entering somewhere else stamps the zone left behind.
  _test.onZoneEntered({ actor: player, from: bare.id }); // leaving a lore-less zone: no-op
  // (bare has no lore, so nothing should be stamped — the test zone is unaffected)
  out = await _test.introLore(zone, player);
  check('leaving a lore-less zone does not suppress others', /class="intro-lore"/.test(out || ''), String(out));

  // Now simulate a live zone that carries lore and leave it. onZoneEntered reads
  // the zone from the world by id, so register it in the flag store path via a
  // direct seen-stamp to model the departure commit deterministically.
  await setFlag('player', _test.seenKey(zone.id), 'true', player);
  out = await _test.introLore(zone, player);
  check('lore not repeated after the visit ends', !out, String(out));

  // Tidy up so re-runs start clean.
  await clearFlag('player', _test.ELIGIBLE_FLAG, player);
  await clearFlag('player', _test.seenKey(zone.id), player);
}
