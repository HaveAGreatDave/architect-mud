// Doors plugin regression suite — run by tests/regress.js (never loaded in
// production). Covers the hololock-hack seam: verb routing (vendor-safe falls
// through to us), the device gate, the anti-spoof resolve guard, and clean
// self-gating when there's nothing to hack. The full launch→win→burglary path
// needs a real hacking device + witnessed crime and is covered by manual QA.
import { setDoorCache, deleteDoorCache, getZone, getApartment, setApartmentCache } from '../../server/engine/world.js';
import { on, off, emit } from '../../server/engine/events.js';
import { lockTypePassesWhileLocked, resolveLockAuth, getLockType } from '../../server/engine/locks.js';
import { query } from '../../server/models/db.js';

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

  // SIFT resolution: filler words, word order, and direction abbreviations all
  // resolve to the same door — every phrasing reaches the device gate.
  const ABBR = { north:'n', south:'s', east:'e', west:'w', up:'u', down:'d' };
  const ab = ABBR[dir];
  const phrasings = [`hack door ${dir}`, `hack ${dir} door`, `hack door to ${dir}`];
  if (ab) phrasings.push(`hack ${ab}`, `hack ${ab} door`, `hack door ${ab}`, `hack door to ${ab}`);
  for (const cmd of phrasings) {
    r = await run(cmd);
    check(`"${cmd}" resolves the same door`, /hacking device/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 100));
  }

  // Abbreviation path, decoupled from the zone's real exits: a local door tagged
  // exit_dir='west' is reachable by every "w"/"west" phrasing. (A local door
  // needs no matching zone.exits entry — getZoneDoors returns it by zone.)
  // target_zone is an explicit dummy, NOT null: with null, the far side resolves
  // through the test zone's real 'west' exit — and if the harness lands the player
  // next to an apartment (doorGuardsOnlyUnownedApartment sees the unowned unit as
  // "open"), the hack spuriously reports the lock disengaged. A fixed non-apartment
  // far side keeps this test about SIFT phrasing, not the borrowed zone's geography.
  setDoorCache(doorId, {
    id: doorId, zone_id: p.current_zone, exit_dir: 'west', target_zone: '__regress_far_' + p.id,
    is_open: 0, hp: 100, hp_max: 100, lock_state: 'locked',
    tags: { 'lock:hololock': { canHack: true, difficulty: 5, messages: { unlock: 'click' } } },
  });
  for (const cmd of ['hack w', 'hack w door', 'hack door w', 'hack door to w', 'hack west door']) {
    r = await run(cmd);
    check(`"${cmd}" resolves the west door`, /hacking device/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 100));
  }
  setDoorCache(doorId, {
    id: doorId, zone_id: p.current_zone, exit_dir: dir, target_zone: null,
    is_open: 0, hp: 100, hp_max: 100, lock_state: 'locked',
    tags: { 'lock:hololock': { canHack: true, difficulty: 5, messages: { unlock: 'click' } } },
  });

  // A door protecting a sleep-forcefielded unit refuses the hack outright (before
  // the device gate) — you can't breach a HoloLock while the owner's shield is up.
  const ffFar = '__regress_ff_far_' + p.id;
  const ffPrior = getApartment(ffFar);
  setApartmentCache(ffFar, { zone_id: ffFar, owner_id: 'ff_owner', forcefield_active: 1 });
  setDoorCache(doorId, {
    id: doorId, zone_id: p.current_zone, exit_dir: dir, target_zone: ffFar,
    is_open: 0, hp: 100, hp_max: 100, lock_state: 'locked',
    tags: { 'lock:hololock': { canHack: true, difficulty: 5, messages: { unlock: 'click' } } },
  });
  r = await run(`hack ${dir}`);
  check('forcefield blocks the hack', /forcefield/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));
  r = await run(`attack door ${dir}`);
  check('forcefield blocks the bash', /forcefield/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));
  setApartmentCache(ffFar, ffPrior || { zone_id: ffFar, forcefield_active: 0 });

  deleteDoorCache(doorId);

  // With nothing hackable in the zone, the verb self-gates all the way through
  // (vendor-safe → doors → the `hack` catch-all builtin) to a graceful message.
  r = await run('hack');
  check('hack self-gates cleanly when nothing to hack', r?.type === 'error' && /nothing worth hacking/.test(r?.message || ''), JSON.stringify(r)?.slice(0, 120));

  // Privacy lock — side-gated. Anyone on the door's privacySide can lock/unlock;
  // the far side is shut out. (Force role to a plain player so the admin/dev
  // bypass doesn't mask the auth check.)
  const savedRole = p.role;
  p.role = 'player';
  const privDoorId = 'door_regress_privacy_' + p.id;
  const mkPrivacy = (side, state) => setDoorCache(privDoorId, {
    id: privDoorId, zone_id: p.current_zone, exit_dir: dir, target_zone: null,
    is_open: 0, hp: 100, hp_max: 100, lock_state: state,
    tags: { 'lock:privacylock': { privacySide: side, messages: { lock: 'bolt shut', unlock: 'bolt open', denied: 'other side only' } } },
  });

  mkPrivacy(p.current_zone, 'locked');
  r = await run(`unlock ${dir}`);
  check('privacy lock: unlocks from the correct side', /bolt open|disengage/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 90));

  mkPrivacy('__regress_other_side_' + p.id, 'unlocked');
  r = await run(`lock ${dir}`);
  check('privacy lock: denied from the wrong side', /other side/i.test(r?.message || ''), JSON.stringify(r)?.slice(0, 90));

  // A privacy bolt is manual: the door won't open while it's shut, so nobody
  // (not even the person on privacySide) walks through it locked — that's what
  // stops it being re-bolted from the far side. Credentialled locks still pass.
  check('privacy lock: not passable while locked', lockTypePassesWhileLocked('lock:privacylock') === false);
  check('privacy lock: credentialled locks stay passable', lockTypePassesWhileLocked('lock:hololock') === true);

  deleteDoorCache(privDoorId);

  // Hololock auth: a plain player who owns no unit on either side of the door
  // must NOT be able to unlock (or lock) it — only the owner's credentials work.
  const holoDoorId = 'door_regress_holo_auth_' + p.id;
  setDoorCache(holoDoorId, {
    id: holoDoorId, zone_id: p.current_zone, exit_dir: dir, target_zone: null,
    is_open: 0, hp: 100, hp_max: 100, lock_state: 'locked',
    tags: { 'lock:hololock': { canHack: true, difficulty: 5, messages: { denied: 'not recognized', unlock: 'click' } } },
  });
  r = await run(`unlock ${dir}`);
  check('hololock: non-owner cannot unlock', /not recognized/.test(r?.message || '') && r?.type === 'error', JSON.stringify(r)?.slice(0, 100));
  deleteDoorCache(holoDoorId);

  // Long Watch lock: the bunker blast door is gated on LIVE Long Watch standing,
  // not a one-way flag. authFn reads player_ideology_rep and opens only at the
  // 'trusted' floor (>=500) — below that (unknown, or merely 'known') it stays
  // shut, and a rep that later falls back under the line shuts it again.
  check('longwatch lock type registered', !!getLockType('longwatch'), JSON.stringify(getLockType('longwatch'))?.slice(0, 60));
  const lwTag = { type: 'lock:longwatch' };
  const lwDoor = { zone_id: p.current_zone, exit_dir: dir };
  await query("DELETE FROM player_ideology_rep WHERE player_id=$1 AND ideology_id='ideology_long_watch'", [p.id]);
  check('longwatch: no standing → door stays shut', (await resolveLockAuth(lwTag, lwDoor, p)) === false);
  await query("INSERT INTO player_ideology_rep (player_id, ideology_id, reputation) VALUES ($1,'ideology_long_watch',150) ON CONFLICT (player_id, ideology_id) DO UPDATE SET reputation=150", [p.id]);
  check('longwatch: known but below trusted → still shut', (await resolveLockAuth(lwTag, lwDoor, p)) === false);
  await query("UPDATE player_ideology_rep SET reputation=525 WHERE player_id=$1 AND ideology_id='ideology_long_watch'", [p.id]);
  check('longwatch: trusted standing → door opens', (await resolveLockAuth(lwTag, lwDoor, p)) === true);
  await query("UPDATE player_ideology_rep SET reputation=-300 WHERE player_id=$1 AND ideology_id='ideology_long_watch'", [p.id]);
  check('longwatch: standing lost (hostile) → shut again', (await resolveLockAuth(lwTag, lwDoor, p)) === false);

  // Compartmentalization: the bunker's INNER doors carry a requireFlag on top of
  // standing, so "trusted enough to sit by the stove" and "trusted enough to see
  // the press, the archive and the plot room" are two different answers. Trusted
  // standing alone is not enough for those — and a tag with no requireFlag (the
  // outer blast door) must keep behaving exactly as it did above.
  {
    const innerTag = { type: 'lock:longwatch', requireFlag: 'lw_member' };
    await query("UPDATE player_ideology_rep SET reputation=525 WHERE player_id=$1 AND ideology_id='ideology_long_watch'", [p.id]);
    await query("DELETE FROM player_flags WHERE player_id=$1 AND flag_key='lw_member'", [p.id]);
    check('longwatch inner: trusted but not a member → shut', (await resolveLockAuth(innerTag, lwDoor, p)) === false);
    await query("INSERT INTO player_flags (player_id, flag_key, flag_value) VALUES ($1,'lw_member','true') ON CONFLICT (player_id, flag_key) DO UPDATE SET flag_value='true'", [p.id]);
    check('longwatch inner: trusted member → opens', (await resolveLockAuth(innerTag, lwDoor, p)) === true);
    await query("UPDATE player_ideology_rep SET reputation=150 WHERE player_id=$1 AND ideology_id='ideology_long_watch'", [p.id]);
    check('longwatch inner: member who lost standing → shut', (await resolveLockAuth(innerTag, lwDoor, p)) === false);
    check('longwatch outer: unchanged by the flag (rep alone still refuses)', (await resolveLockAuth(lwTag, lwDoor, p)) === false);
    await query("DELETE FROM player_flags WHERE player_id=$1 AND flag_key='lw_member'", [p.id]);
  }
  await query("DELETE FROM player_ideology_rep WHERE player_id=$1 AND ideology_id='ideology_long_watch'", [p.id]);

  // ── A resident is never locked out of their own home ────────────────────────
  // The law lives ABOVE the per-lock-type registry, in checkLockAuth
  // (server/engine/commands/doors.js), because the registry is where the lockouts
  // were hiding: `keycardlock` authorised on inventory alone (lose the one minted
  // card and the deed holder is out forever), `privacylock` on standing-on-the-
  // inside (any visitor could bolt the owner out from the street), and an NPC
  // arriving home locks whatever door it just used. Only the hololock knew what an
  // apartment was.
  //
  // So this asserts the difference between the two layers directly: the raw
  // registry still refuses (each lock type's own rule is unchanged), and
  // checkLockAuth — the single funnel the move gate, open/close/lock/unlock,
  // hackDoor and the describe pane all use — grants it anyway because the door
  // touches a unit this player controls.
  {
    const { checkLockAuth } = await import('../../server/engine/commands/doors.js');
    const aptZone = p.current_zone;
    const saved = getApartment(aptZone);
    const keyTag = { type: 'lock:keycardlock', keyItemId: 'keycard_nonexistent_' + p.id };
    const keyDoor = { id: 'rd_res_' + p.id, zone_id: aptZone, exit_dir: dir };

    // Not your unit: the keycard rule stands, and you carry no card.
    setApartmentCache(aptZone, { zone_id: aptZone, owner_id: 'someone_else_' + p.id, rent_due: 0 });
    check('keycard lock refuses someone with no card', (await checkLockAuth(keyTag, keyDoor, p)) === false);

    // Your unit, still no card — the registry says no, the housing law says yes.
    setApartmentCache(aptZone, { zone_id: aptZone, owner_id: p.id, rent_due: 0 });
    check('the raw lock registry still refuses (per-type rule unchanged)',
      (await resolveLockAuth(keyTag, keyDoor, p)) === false);
    check('but a resident is authorised on their own door without the card',
      (await checkLockAuth(keyTag, keyDoor, p)) === true);

    // Same for a privacy bolt thrown by a visitor while the owner is outside. Auth
    // is granted (so they can UNLOCK it and get in); passage while still bolted is a
    // separate question and deliberately stays false, which is what keeps a latch
    // meaningful.
    const privTag = { type: 'lock:privacylock', privacySide: aptZone };
    check('a resident is authorised on a privacy bolt someone else threw',
      (await checkLockAuth(privTag, { ...keyDoor }, { ...p, current_zone: 'zone_somewhere_outside' })) === true);
    check('...but a manual bolt still has to be undone, not walked through',
      lockTypePassesWhileLocked('lock:privacylock') === false);

    if (saved) setApartmentCache(aptZone, saved); else setApartmentCache(aptZone, null);
  }

  p.role = savedRole;

  // The forced-charge path moved. Breaching a lock no longer auto-charges
  // burglary — a resident NPC hearing you is now gated by the burglary plugin.
  // So hololock.breached only charges if a camera/cop/bystander witnesses it
  // (quiet in a witness-free zone), while the burglary plugin's
  // `burglary.reported` is the guaranteed (forced-witness) path.
  const burglaries = [];
  const cw = (e) => { if (e?.key === 'burglary') burglaries.push(e); };
  on('crime.witnessed', cw);
  // raiseCrime awaits a couple of camera DB lookups before emitting — poll rather
  // than sleep a fixed time (this shares the remote Supabase pool).
  const settle = async (ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (burglaries.length) return; await new Promise(res => setTimeout(res, 25)); } };
  const noWitnessZone = 'zone_regress_nowitness_' + p.id;
  const thief = { id: 'rt_burglar_' + p.id, handle: 'Regress Burglar', current_zone: noWitnessZone };

  emit('hololock.breached', { player: thief, zoneId: noWitnessZone });
  await new Promise(res => setTimeout(res, 200));
  check('unwitnessed breach raises no burglary', burglaries.length === 0, `count=${burglaries.length}`);

  emit('burglary.reported', { player: thief, zoneId: noWitnessZone });
  await settle();
  check('burglary.reported forces burglary', burglaries.length === 1, `count=${burglaries.length}`);
  off('crime.witnessed', cw);
}
