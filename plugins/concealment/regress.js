// concealment plugin regression suite (harness-only, never loaded in production).
//
// Drives the real furniture rows: the drum-basement chem lab starts sealed behind
// the Cachet Vantage 900, so the checks below double as a guard on that content
// staying authored the way the feature needs (the cabinet naming the lab, the lab
// carrying `concealed`).
import { _test } from './index.js';
import { getFurnitureById, getZoneFurniture } from '../../server/engine/world.js';

const CABINET = 'furn_cachet_v900';
const LAB = 'furn_chem_lab';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedZone = p.current_zone;

  // Away from any keypad, `keypad` must fall through (undefined) rather than claim
  // the verb — some other plugin may want it later.
  p.current_zone = 'zone_regress_no_keypad_here';
  const away = await _test.resolveDisguise(p, '');
  check('no keypad in an ordinary room', !!away.error, JSON.stringify(away));

  const cabinet = getFurnitureById(CABINET);
  const lab = getFurnitureById(LAB);
  check('the Cachet cabinet exists', !!cabinet, 'furn_cachet_v900 missing');
  check('the chem lab exists', !!lab, 'furn_chem_lab missing');

  if (cabinet && lab) {
    check('cabinet names the lab it hides', cabinet.flags?.conceal_hides === LAB, JSON.stringify(cabinet.flags));
    check('cabinet and lab share a zone', cabinet.zone_id === lab.zone_id, `${cabinet.zone_id} vs ${lab.zone_id}`);
    check('factory code is set', /^\d{4,8}$/.test(_test.codeOf(cabinet)), _test.codeOf(cabinet));

    p.current_zone = cabinet.zone_id;

    // A wrong code changes nothing and says nothing useful.
    const wasOpen = _test.isOpen(cabinet);
    const bad = await run('keypad cachet 9999');
    check('wrong code is refused', bad?.type === 'error', bad?.message);
    check('wrong code leaks nothing about the lab', !/chem|lab/i.test(bad?.message || ''), bad?.message);
    check('wrong code does not move the wall', _test.isOpen(cabinet) === wasOpen, 'state changed on a bad code');

    // The real code toggles it. Run it twice so the suite leaves the world exactly
    // as it found it — a regress that leaves a dealer's lab hanging open is a bug
    // in the test, not a passing feature.
    const code = _test.codeOf(cabinet);
    const first = await run(`keypad cachet ${code}`);
    check('right code is accepted', first?.type === 'output', first?.message);
    check('the wall pivots', _test.isOpen(cabinet) !== wasOpen, 'nothing moved on a good code');

    const revealed = _test.isOpen(cabinet);
    const listed = getZoneFurniture(cabinet.zone_id).some((f) => f.id === LAB && !f.flags?.concealed);
    check('open ⇒ the lab is visible furniture', listed === revealed, `open=${revealed} listed=${listed}`);

    await run(`keypad cachet ${code}`);
    check('toggles back to how it started', _test.isOpen(cabinet) === wasOpen, 'left the cabinet in the wrong state');

    // While sealed, examine advertises the pad and nothing else.
    const desc = await run('examine cachet vantage 900 cabinet');
    check('examine shows a keypad, not a lab', /keypad/i.test(desc?.message || '') && !/chem lab/i.test(desc?.message || ''), desc?.message);
  }

  p.current_zone = savedZone;
}
