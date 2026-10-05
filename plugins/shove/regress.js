// shove/drag regression suite, run by tests/regress.js. Covers what can be checked with one
// body in the room: both verbs reach this plugin, the argument grammar, and the exit check that
// must run BEFORE any contested roll. The roll itself, the protected-zone refusal and moving a
// corpse need a second body and are covered by manual QA.
import { getZone } from '../../server/engine/world.js';
import { exitTargets } from '../../server/engine/exits.js';

const DIRS = ['north', 'south', 'east', 'west', 'up', 'down'];

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  let r = await run('shove');
  check('shove with no args asks whom and which way', r?.type === 'error' && /whom, and which way/.test(r.message), r?.message);
  r = await run('drag');
  check('drag reaches the same handler and names itself', r?.type === 'error' && /^Drag whom, and which way/.test(r.message), r?.message);
  r = await run('shove somebody sideways');
  check('a word that is not a direction is refused', r?.type === 'error' && /isn't a direction/.test(r.message), r?.message);
  r = await run('drag to north');
  check('"drag to north" asks whom rather than dragging nothing', r?.type === 'error' && /Drag whom\?/.test(r.message), r?.message);

  const zone = getZone(p.current_zone);
  const closed = DIRS.find((d) => !exitTargets(zone, d)[0]);
  if (closed) {
    r = await run(`shove nobody ${closed}`);
    check('a direction with no exit is refused before any roll', r?.type === 'error' && /No exit/.test(r.message), r?.message);
  }
  const open = DIRS.find((d) => { const t = exitTargets(zone, d)[0]; return t && getZone(t); });
  if (open) {
    r = await run(`shove zzqnobodyhere ${open}`);
    check('an absent target is reported, not rolled against', r?.type === 'error' && /Can't find/.test(r.message), r?.message);
  }
}
