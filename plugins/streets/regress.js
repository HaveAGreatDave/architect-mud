// streets regression suite, run by tests/regress.js. The rules have their own gate
// (scripts/shapes/street-systems.mjs); this checks that the switch keeps everything quiet.
import { getZone } from '../../server/engine/world.js';
import { _test, hooks } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  _test.setOn(false);
  const before = p.credits;
  let r = await run('belt north');
  check('belt is nothing with the switch off', r?.type === 'error' && /nothing like that/.test(r.message), r?.message);
  check('the switch off charges nobody', p.credits === before, p.credits);
  check('no room text with the switch off', hooks['zone.describeRoom'](getZone(p.current_zone)) === undefined);
  _test.setOn(true);
  r = await run('belt sideways');
  check('belt asks which way', r?.type === 'error' && /Which way/.test(r.message), r?.message);
  _test.setOn(false);
}
