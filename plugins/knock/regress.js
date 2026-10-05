// knock regression suite, run by tests/regress.js. Covers the grammar and the exit check, which
// need no door fixture. Knocking through to the far side is covered by manual QA.
import { getZone } from '../../server/engine/world.js';
import { exitTargets } from '../../server/engine/exits.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  let r = await run('knock');
  check('knock with no direction asks which way', r?.type === 'error' && /Knock which way/.test(r.message), r?.message);
  r = await run('knock on the door');
  check('filler words alone still ask which way', r?.type === 'error' && /Knock which way/.test(r.message), r?.message);
  const zone = getZone(p.current_zone);
  const closed = ['north', 'south', 'east', 'west'].find((d) => !exitTargets(zone, d)[0]);
  if (closed) {
    r = await run(`knock on door to the ${closed}`);
    check('a direction with no exit says there is no door', r?.type === 'error' && new RegExp(`no door to the ${closed}`).test(r.message), r?.message);
  }
}
