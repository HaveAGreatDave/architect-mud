// Elevator plugin regression suite (harness-only, never loaded in production).
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  // Verb routes and self-gates: pin the player to a definitely-non-elevator zone
  // (a bogus id → getZone() is undefined → not an elevator) so `floor` reaches the
  // plugin and refuses cleanly regardless of which zone the harness happened to
  // spawn into — otherwise a real elevator car in the world makes `floor 50` ride.
  const p = getPlayer();
  const savedZone = p.current_zone;
  p.current_zone = 'zone_regress_not_an_elevator';
  const r = await run('floor 50');
  p.current_zone = savedZone;
  check('floor routes to plugin', r?.type === 'error', r?.message);
  check('floor gates on being in a car', /elevator/i.test(r?.message || ''), r?.message);

  // Directory builder: display numbers survive, sorted high→low, buttons carry the raw cmd.
  const floors = _test.floorsOf({ flags: { elevator_floors: [
    { n: 50, zone: 'z_a', label: 'Arcade' },
    { n: 54, zone: 'z_b', label: 'Executive' },
    { n: 'x', zone: 'z_bad' },        // garbled — dropped
    { n: 52, zone: 'z_c', label: 'Claims' },
  ] } });
  check('floors parsed + garbage dropped', floors.length === 3, `got ${floors.length}`);
  check('floors sorted top-first', floors[0].n === 54 && floors[2].n === 50, floors.map(f => f.n).join(','));

  const panel = _test.buildPanel(floors);
  check('panel lists floor 50+', panel.includes('floor 54') && panel.includes('floor 50'), panel);
  check('panel buttons are clickable', panel.includes('data-raw-cmd="floor 54"'), panel);

  // Non-elevator zone gets no panel.
  check('non-elevator has no panel', !_test.describeRoom({ flags: {} }), 'panel leaked into a normal room');
}
