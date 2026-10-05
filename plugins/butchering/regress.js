// butchering regression suite, run by tests/regress.js. Covers the gates before a corpse is
// touched: posture, combat, and a room with nothing to butcher. Butchering a real corpse needs
// a kill and a tool and is covered by manual QA.
import { getZoneCorpses } from '../../server/engine/world.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const saved = { posture: p.posture, combatTargetId: p.combatTargetId };
  try {
    p.posture = 'sitting';
    let r = await run('butcher');
    check('butchering needs you on your feet', /on your feet to butcher/.test(r?.message || ''), r?.message);
    p.posture = 'standing';
    p.combatTargetId = 'enemy_regress_fake';
    r = await run('butcher');
    check('butchering is refused mid-fight', /too busy fighting/.test(r?.message || ''), r?.message);
    p.combatTargetId = null;
    if (!getZoneCorpses(p.current_zone).length) {
      r = await run('butcher');
      check('an empty room has no corpse to butcher', /No corpse to butcher/.test(r?.message || ''), r?.message);
    }
  } finally {
    p.posture = saved.posture;
    p.combatTargetId = saved.combatTargetId;
  }
}
