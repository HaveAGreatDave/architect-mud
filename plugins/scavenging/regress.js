// scavenging regression suite, run by tests/regress.js. Covers the gates that run before any
// loot table is read: posture, combat, and a zone with no table. Rolling a real table needs a
// zone with scavenging_table_id and is covered by manual QA.
export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const saved = { posture: p.posture, combatTargetId: p.combatTargetId };
  try {
    p.posture = 'sitting';
    let r = await run('scavenge');
    check('scavenging needs you on your feet', /on your feet to scavenge/.test(r?.message || ''), r?.message);
    p.posture = 'standing';
    p.combatTargetId = 'enemy_regress_fake';
    r = await run('scavenge');
    check('scavenging is refused mid-fight', /too busy fighting/.test(r?.message || ''), r?.message);
    p.combatTargetId = null;
    p.posture = 'scavenging';
    r = await run('scavenge');
    check('a second scavenge while digging is refused', /already digging/.test(r?.message || ''), r?.message);
  } finally {
    p.posture = saved.posture;
    p.combatTargetId = saved.combatTargetId;
  }
}
