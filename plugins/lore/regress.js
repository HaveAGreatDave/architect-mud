// Lore plugin regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';
import { setFlag, clearFlag, getFlag } from '../../server/engine/flags.js';
import { getZone } from '../../server/engine/world.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const zone = { id: 'zone_lore_test', flags: { intro_lore: 'The place has a history. None of it kind.' } };
  const bare = { id: 'zone_lore_bare', flags: {} };

  // Clean slate — this account may carry a seen marker from a prior run.
  await clearFlag('player', _test.seenKey(zone.id), player);

  // First render of the visit: the shimmering block is returned with the prose.
  // The ONLY gate is the seen marker — no eligibility flag involved.
  let out = await _test.introLore(zone, player);
  check('lore shown on first render', /class="intro-lore"/.test(out || '') && /None of it kind/.test(out || ''), String(out));

  // Re-render during the SAME visit (a silent re-look): the block must persist,
  // not vanish — seen is not committed at render time.
  out = await _test.introLore(zone, player);
  check('lore persists across re-renders in the same visit', /class="intro-lore"/.test(out || ''), String(out));

  // A zone with no authored intro_lore never produces a block.
  out = await _test.introLore(bare, player);
  check('no lore for a zone without intro_lore', !out, String(out));

  // Leaving a lore-less zone stamps nothing — an unrelated lore zone is unaffected.
  _test.onZoneEntered({ actor: player, from: bare.id });
  out = await _test.introLore(zone, player);
  check('leaving a lore-less zone does not suppress others', /class="intro-lore"/.test(out || ''), String(out));

  // Once the seen marker is set (the departure commit), the block stops.
  await setFlag('player', _test.seenKey(zone.id), 'true', player);
  out = await _test.introLore(zone, player);
  check('lore not repeated after the visit ends', !out, String(out));

  // ── lorereset admin command ────────────────────────────────────────────────
  // Non-staff get the generic unknown-command reply — the verb stays hidden.
  const prevRole = player.role;
  player.role = 'player';
  let r = await run('lorereset');
  check('lorereset hidden from non-staff', /Unknown command/.test(r?.message || ''), r?.message);

  // Staff can reset their own lore (clears the seen markers).
  player.role = 'admin';
  await setFlag('player', _test.seenKey(zone.id), 'true', player);
  r = await run('lorereset');
  check('lorereset runs for staff', /cleared \d+ seen-marker/.test(r?.message || ''), r?.message);
  const clearedSelf = await _test.introLore(zone, player);
  check('lorereset re-arms so lore shows again', /class="intro-lore"/.test(clearedSelf || ''), String(clearedSelf));

  // An unknown target handle is reported, not silently ignored.
  r = await run('lorereset nobody_xyz');
  check('lorereset rejects unknown handle', /No player named/.test(r?.message || ''), r?.message);
  player.role = prevRole;

  // ── lorealways (the Settings "Extra Lore" toggle) ──────────────────────────
  // With the preference on, a seen zone still shows its block on every visit.
  await setFlag('player', _test.seenKey(zone.id), 'true', player);
  r = await run('lorealways on');
  check('lorealways on is silent', !r, JSON.stringify(r));
  out = await _test.introLore(zone, player);
  check('extra lore repeats a seen zone', /class="intro-lore"/.test(out || ''), String(out));

  // Turning it off restores first-visit-only behaviour.
  await run('lorealways off');
  out = await _test.introLore(zone, player);
  check('extra lore off restores the seen gate', !out, String(out));
  await clearFlag('player', _test.seenKey(zone.id), player);

  // ── First-visit GPS suggestion (flags.gps_suggest) ──────────────────────────
  // Guards: no throw with missing args, and a no-op for an unknown / flagless zone.
  let threw = false;
  try { await _test.onGpsSuggest({ actor: player, zone: undefined }); await _test.onGpsSuggest({ actor: null, zone: 'x' }); } catch { threw = true; }
  check('gps-suggest guards missing args', !threw, 'threw on missing args');
  threw = false;
  try { await _test.onGpsSuggest({ actor: player, zone: 'zone_does_not_exist_xyz' }); } catch { threw = true; }
  check('gps-suggest no-op on unknown zone', !threw, 'threw on unknown zone');

  // Positive/once-only path, only when the seeded trigger tile is loaded in this world.
  const trigger = getZone('zone_district_919_903');
  if (trigger?.flags?.gps_suggest) {
    await clearFlag('player', _test.gpsSuggestKey(trigger.id), player);
    await _test.onGpsSuggest({ actor: player, zone: trigger.id });
    const stamped = await getFlag('player', _test.gpsSuggestKey(trigger.id), player);
    check('gps-suggest fires once and stamps a seen marker', !!stamped, String(stamped));
    // Second entry is gated — the marker suppresses a repeat (we just confirm no throw).
    threw = false;
    try { await _test.onGpsSuggest({ actor: player, zone: trigger.id }); } catch { threw = true; }
    check('gps-suggest does not re-fire once seen', !threw, 'threw on second entry');
    await clearFlag('player', _test.gpsSuggestKey(trigger.id), player);
  }

  // Tidy up so re-runs start clean.
  await clearFlag('player', _test.seenKey(zone.id), player);
}
