// Lore plugin regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';

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

  // Tidy up so re-runs start clean.
  await clearFlag('player', _test.seenKey(zone.id), player);
}
