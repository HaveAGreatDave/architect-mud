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
  check("leaving a lore-less zone doesn't suppress others", /class="intro-lore"/.test(out || ''), String(out));

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

  // ── THE ONBOARDING NUDGE IS NOT OPTIONAL ───────────────────────────────────
  // A fresh clone spawns in `zone_start` and its only way out is one tile east; that
  // tile is where "where do I even go" gets answered, and the answer is Grady, two
  // doors along. The nudge is content (`flags.gps_suggest`), so nothing in code
  // fails if nobody authors it — which is exactly how mastery shipped a `train` verb,
  // a rep gate and a purity gate with no teacher anywhere in the world.
  //
  // ⚠ THIS USED TO BE AN `if`. The trigger tile was hardcoded to zone_district_919_903
  // and wrapped in "only when the seeded trigger tile is loaded", so when the flag
  // moved one tile west the entire block SKIPPED and reported nothing. A conditional
  // test that silently stops testing is worse than no test at all. The trigger is
  // DERIVED from the spawn zone's own exits now, so it follows the world rather than
  // naming a tile that can drift out from under it.
  const spawn = getZone('zone_start');
  const firstStep = Object.values(spawn?.exits || {})
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .map((id) => getZone(id))
    // ⚠ `grid_x != null` IS NOT "IS ON THE MAP". Interiors sit at 0,0 with the column
    // set, so that test picks the clone facility BASEMENT off the `down` exit — which
    // is where this first landed. A real map tile has no parent and is not at the
    // origin, and 0,0 is an unset column rather than a place anybody stands.
    .find((z) => z && !z.parent_zone && z.grid_x != null && !(z.grid_x === 0 && z.grid_y === 0));
  check('onboarding: the spawn has a way out onto the street', !!firstStep, String(firstStep?.id));
  const trigger = firstStep;
  check('onboarding: the first tile out of the vat points a new clone somewhere',
    !!trigger?.flags?.gps_suggest, String(trigger?.id));
  if (trigger?.flags?.gps_suggest) {
    check('onboarding: …at a zone that exists',
      !!getZone(trigger.flags.gps_suggest), String(trigger.flags.gps_suggest));
    // The label is the line the player actually reads. A missing one falls back to
    // "<name> — worth a look", which is the tell that somebody set a destination and
    // never wrote the sentence explaining why they should walk to it.
    check('onboarding: …with a label that says who is there',
      !!trigger.flags.gps_suggest_label, String(trigger.flags.gps_suggest_label));
    await clearFlag('player', _test.gpsSuggestKey(trigger.id), player);
    await _test.onGpsSuggest({ actor: player, zone: trigger.id });
    const stamped = await getFlag('player', _test.gpsSuggestKey(trigger.id), player);
    check('gps-suggest fires once and stamps a seen marker', !!stamped, String(stamped));
    // Second entry is gated — the marker suppresses a repeat (we just confirm no throw).
    threw = false;
    try { await _test.onGpsSuggest({ actor: player, zone: trigger.id }); } catch { threw = true; }
    check("gps-suggest doesn't re-fire once seen", !threw, 'threw on second entry');
    await clearFlag('player', _test.gpsSuggestKey(trigger.id), player);
  }

  // Tidy up so re-runs start clean.
  await clearFlag('player', _test.seenKey(zone.id), player);
}
