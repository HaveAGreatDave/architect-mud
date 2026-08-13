// Jail plugin regression suite — run by tests/regress.js (never loaded in production).
import { query } from '../../server/models/db.js';
import { getDoorById } from '../../server/engine/world.js';
import { getLockTagPublic } from '../../server/engine/commands/doors.js';
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  // ── Conceal verbs route + fail safe ───────────────────────────────────────
  const cn = await run('conceal');
  check('conceal with nothing illicit errors cleanly', cn?.type === 'error', cn?.type);
  const cr = await run('concealresolve deadbeef');
  check('concealresolve with a stale nonce no-ops', cr?.type === 'noop', cr?.type);

  // ── Contraband classification (pure) ──────────────────────────────────────
  check('weapon is contraband', _test.isContraband('item_x', { weapon: {} }) === true);
  check('drug is contraband', _test.isContraband('item_x', { drug: {} }) === true);
  check('hack deck is contraband', _test.isContraband('item_x', { hack_device: {} }) === true);
  check('plain clothing is not contraband', _test.isContraband('item_basic_shirt', {}) === false);

  // ── Clean death does not jail ─────────────────────────────────────────────
  // A player with no wanted flag must fall through to the normal clone-vat respawn
  // (the hook returns undefined), and must NOT get a jail_prisoners row.
  const p = getPlayer();
  await query('DELETE FROM jail_prisoners WHERE player_id=$1', [p.id]).catch(() => {});
  const clean = await _test.onRespawnZone({ id: p.id, handle: p.handle }, null);
  check('unwanted death does not divert respawn', clean === undefined, JSON.stringify(clean)?.slice(0, 80));
  const row = await query('SELECT 1 FROM jail_prisoners WHERE player_id=$1', [p.id]).catch(() => ({ rows: [] }));
  check('unwanted death creates no prisoner row', row.rows.length === 0);

  // ── Confiscate → restore round-trip ───────────────────────────────────────
  // Needs one real weapon item and one real non-contraband item to exist.
  const wpn = (await query(`SELECT id FROM items WHERE jsonb_exists(tags,'weapon') LIMIT 1`).catch(() => ({ rows: [] }))).rows[0]?.id;
  const misc = (await query(
    `SELECT id FROM items WHERE NOT jsonb_exists(tags,'weapon') AND NOT jsonb_exists(tags,'drug') AND NOT jsonb_exists(tags,'hack_device') LIMIT 1`
  ).catch(() => ({ rows: [] }))).rows[0]?.id;

  if (wpn && misc) {
    const tid = `jailtest_${p.id}`;
    await query('DELETE FROM player_inventory WHERE player_id=$1', [tid]).catch(() => {});
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,1)`, [`${tid}_w`, tid, wpn]);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity) VALUES ($1,$2,$3,1)`, [`${tid}_m`, tid, misc]);

    const held = await _test.confiscate(tid, 'JailTest');
    check('confiscate holds the legal item', held.some(h => h.item_id === misc), JSON.stringify(held)?.slice(0, 120));
    check('confiscate takes the weapon (not held)', !held.some(h => h.item_id === wpn));
    const emptied = await query('SELECT 1 FROM player_inventory WHERE player_id=$1', [tid]);
    check('confiscate empties the inventory', emptied.rows.length === 0);
    const ev = await query('SELECT 1 FROM police_evidence WHERE source_handle=$1 AND item_id=$2', ['JailTest', wpn]);
    check('weapon lands in the evidence locker', ev.rows.length > 0);

    await _test.restoreHeld(tid, held);
    const restored = await query('SELECT item_id FROM player_inventory WHERE player_id=$1', [tid]);
    check('restore returns the legal item', restored.rows.some(r => r.item_id === misc));
    check('restore does not return the weapon', !restored.rows.some(r => r.item_id === wpn));

    // The garb is a souvenir: released prisoners keep the jumpsuit, and it comes
    // off the torso on the way out so it can't fight the restored clothes for the slot.
    const garb = 'item_prison_jumpsuit';
    if ((await query('SELECT 1 FROM items WHERE id=$1', [garb])).rows.length) {
      const tid3 = `jailtest3_${p.id}`;
      await query('DELETE FROM player_inventory WHERE player_id=$1', [tid3]).catch(() => {});
      await query(
        `INSERT INTO player_inventory (id,player_id,item_id,quantity,is_equipped,slot,layer) VALUES ($1,$2,$3,1,1,'torso',2)`,
        [`${tid3}_g`, tid3, garb]
      );
      await _test.restoreHeld(tid3, [{ item_id: misc, quantity: 1 }]);
      const after = await query('SELECT item_id, is_equipped, slot FROM player_inventory WHERE player_id=$1', [tid3]);
      const kept = after.rows.find(r => r.item_id === garb);
      check('released prisoner keeps the jumpsuit', !!kept, JSON.stringify(after.rows)?.slice(0, 120));
      check('…unequipped, so it does not clash with restored clothes', !!kept && !kept.is_equipped && !kept.slot);
      check('…and their own things come back with it', after.rows.some(r => r.item_id === misc));
      await query('DELETE FROM player_inventory WHERE player_id=$1', [tid3]).catch(() => {});
    }

    // A sealed climate crate survives the search — packaged contraband is kept on
    // the player (not bagged, not deleted).
    const tid2 = `jailtest2_${p.id}`;
    await query('DELETE FROM player_inventory WHERE player_id=$1', [tid2]).catch(() => {});
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,custom_data) VALUES ($1,$2,$3,1,$4)`, [`${tid2}_p`, tid2, wpn, JSON.stringify({ packaged: true })]);
    const held2 = await _test.confiscate(tid2, 'JailTest');
    check('sealed crate is not bagged as evidence', !held2.some(h => h.item_id === wpn));
    const kept = await query('SELECT 1 FROM player_inventory WHERE player_id=$1', [tid2]);
    check('sealed crate survives confiscation', kept.rows.length === 1, kept.rows.length);
    await query('DELETE FROM player_inventory WHERE player_id=$1', [tid2]).catch(() => {});

    // cleanup
    await query('DELETE FROM player_inventory WHERE player_id=$1', [tid]).catch(() => {});
    await query(`DELETE FROM police_evidence WHERE source_handle='JailTest'`).catch(() => {});
  } else {
    check('confiscate round-trip (skipped — no sample items)', true);
  }

  // ── Cell block membership (what counts as a jailbreak) ────────────────────
  // A prisoner may walk to the wash block and the exercise room; anywhere else is
  // an escape. Membership is authored as zones.flags.cell_block, so this doubles
  // as proof that the two rooms actually carry the flag in content.
  check('the cell itself is in the block', _test.inCellBlock(_test.CELL_ZONE) === true);
  check('the wash block is in the block', _test.inCellBlock('zone_mq_precinct_showers') === true);
  check('the exercise room is in the block', _test.inCellBlock('zone_mq_precinct_gym') === true);
  check('the lobby is NOT in the block', _test.inCellBlock(_test.RELEASE_ZONE) === false);
  check('an unknown zone is NOT in the block', _test.inCellBlock('zone_nowhere') === false);

  // ── The cell door: a lock gated by your record, not a key ─────────────────
  // The door stays engaged permanently; what changes is whether it recognises
  // YOU. Clean (no stars, no open sentence) walks through; wanted or mid-stretch
  // does not. The bug the lock itself guards: it once shipped unlocked, so a
  // prisoner walked `up` and the only consequence was a jailbreak log.
  const cellDoor = getDoorById(_test.CELL_DOOR);
  check('the cell door exists', !!cellDoor, _test.CELL_DOOR);
  if (cellDoor) {
    const lockTag = getLockTagPublic(cellDoor);
    check('the cell door carries a lock', !!lockTag, JSON.stringify(cellDoor.tags)?.slice(0, 80));
    check('the cell lock is a detention lock', lockTag?.type === 'lock:detentionlock', lockTag?.type);
    check('the cell lock is unhackable (police-only)', lockTag?.canHack === false, lockTag?.canHack);
    await _test.secureCellDoor();
    check('booking engages the lock', cellDoor.lock_state === 'locked' && !cellDoor.is_open, `${cellDoor.lock_state}/${cellDoor.is_open}`);

    // Clean player passes; a wanted one and a serving prisoner do not.
    await query('DELETE FROM jail_prisoners WHERE player_id=$1', [p.id]).catch(() => {});
    check('a clean record opens the detention lock', (await _test.detentionAuth(lockTag, cellDoor, p)) === true);
    await query(
      `INSERT INTO jail_prisoners (player_id, cell_zone, release_zone, release_at, stars, held_items, held_credits, fine, charge)
       VALUES ($1,$2,$3, NOW() + interval '1 hour', 1, '[]'::jsonb, 0, 0, 'regress')
       ON CONFLICT (player_id) DO UPDATE SET release_at = NOW() + interval '1 hour'`,
      [p.id, _test.CELL_ZONE, _test.RELEASE_ZONE]
    ).catch(() => {});
    check('a serving sentence keeps the detention lock shut', (await _test.detentionAuth(lockTag, cellDoor, p)) === false);
    await query('DELETE FROM jail_prisoners WHERE player_id=$1', [p.id]).catch(() => {});
    check('the lock has no opinion about a null player', (await _test.detentionAuth(lockTag, cellDoor, null)) === false);
  }

  // ── Sentence readout ──────────────────────────────────────────────────────
  // A free player asking gets a clean answer, not a crash or an empty record.
  await query('DELETE FROM jail_prisoners WHERE player_id=$1', [p.id]).catch(() => {});
  const st = await run('sentence');
  check('sentence outside jail answers cleanly', st?.type === 'output' && /not doing time/i.test(st.message || ''), st?.type);

  // unseal with nothing sealed must fail cleanly.
  const us = await run('unseal');
  check('unseal with nothing sealed errors cleanly', us?.type === 'error', us?.type);
}
