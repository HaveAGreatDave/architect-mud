// Elevator plugin regression suite (harness-only, never loaded in production).
import { _test } from './index.js';

export default async function regress({ run, check }) {
  // Verb routes and self-gates: the fake player is not in an elevator, so `floor`
  // should reach the plugin and refuse cleanly (not fall through to "unknown command").
  const r = await run('floor 50');
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
