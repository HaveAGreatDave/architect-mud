// Doors plugin regression suite — run by tests/regress.js (never loaded in
// production). Covers the hololock-hack seam: verb routing (vendor-safe falls
// through to us), the device gate, the anti-spoof resolve guard, and clean
// self-gating when there's nothing to hack. The full launch→win→burglary path
// needs a real hacking device + witnessed crime and is covered by manual QA.
import { setDoorCache, deleteDoorCache, getZone } from '../../server/engine/world.js';
import { on, off, emit } from '../../server/engine/events.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // hackresolve guards: no args and an unarmed/ghost door both no-op silently,
  // and crucially do NOT report a burglary (anti-spoof — you can't resolve a
  // breach you never armed).
  let breached = 0;
  const spy = () => { breached++; };
  on('hololock.breached', spy);

  let r = await run('hackresolve');
  check('hackresolve with no args no-ops', r?.type === 'noop', JSON.stringify(r)?.slice(0, 80));

  r = await run('hackresolve ghost_door_xyz 1');
  check('hackresolve without a pending arm no-ops', r?.type === 'noop', JSON.stringify(r)?.slice(0, 80));
  await Promise.resolve();
  check('spoofed hackresolve fires no burglary', breached === 0, `breached=${breached}`);
  off('hololock.breached', spy);

  // Synthetic locked hololock door on a real exit of the test zone.
  const zone = getZone(p.current_zone);
  const dir = zone?.exits ? Object.keys(zone.exits)[0] : null;
  if (!dir) { check('hololock door fixture (needs an exit)', true, 'skipped — no exit in test zone'); return; }
  const doorId = 'door_regress_holo_' + p.id;
  setDoorCache(doorId, {
    id: doorId, zone_id: p.current_zone, exit_dir: dir, target_zone: null,
    is_open: 0, hp: 100, hp_max: 100, lock_state: 'locked',
    tags: { 'lock:hololock': { canHack: true, difficulty: 5, messages: { unlock: 'click' } } },
  });

  // hack <dir> routes past vendor-safe (no safe here) into our handler, resolves
  // the hololock, clears auth/forcefield, and stops at the device gate — the
  // fake player carries no hacking deck. Reaching this message proves the whole
  // routing chain is wired.
  r = await run(`hack ${dir}`);
  check('hack routes to hololock and hits the device gate', /hacking device/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));

  deleteDoorCache(doorId);

  // With nothing hackable in the zone, the verb self-gates all the way through
  // (vendor-safe → doors → the `hack` catch-all builtin) to a graceful message.
  r = await run('hack');
  check('hack self-gates cleanly when nothing to hack', r?.type === 'error' && /nothing worth hacking/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));

  // Owner-witness path: a hololock.breached with ownerWitness=true forces the
  // burglary crime through surveillance even in a zone with no camera / cop /
  // bystander; without a witness (and no owner) it stays quiet.
  const burglaries = [];
  const cw = (e) => { if (e?.key === 'burglary') burglaries.push(e); };
  on('crime.witnessed', cw);
  // raiseCrime awaits a couple of camera DB lookups before emitting — poll rather
  // than sleep a fixed time (this shares the remote Supabase pool).
  const settle = async (ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (burglaries.length) return; await new Promise(res => setTimeout(res, 25)); } };
  const noWitnessZone = 'zone_regress_nowitness_' + p.id;
  const thief = { id: 'rt_burglar_' + p.id, handle: 'Regress Burglar', current_zone: noWitnessZone };

  emit('hololock.breached', { player: thief, zoneId: noWitnessZone, ownerWitness: false });
  await new Promise(res => setTimeout(res, 200));
  check('unwitnessed breach raises no burglary', burglaries.length === 0, `count=${burglaries.length}`);

  emit('hololock.breached', { player: thief, zoneId: noWitnessZone, ownerWitness: true });
  await settle();
  check('owner-witnessed breach forces burglary', burglaries.length === 1, `count=${burglaries.length}`);
  off('crime.witnessed', cw);
}
