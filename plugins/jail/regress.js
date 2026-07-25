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

  // ── The cell door actually locks ──────────────────────────────────────────
  // The bug this guards: the door shipped `lock_state:"unlocked"`, so a prisoner
  // walked `up` and the only consequence was a jailbreak log. Booking engages the
  // lock, release disengages it, and the next booking engages it again.
  const cellDoor = getDoorById(_test.CELL_DOOR);
  check('the cell door exists', !!cellDoor, _test.CELL_DOOR);
  if (cellDoor) {
    const lockTag = getLockTagPublic(cellDoor);
    check('the cell door carries a lock', !!lockTag, JSON.stringify(cellDoor.tags)?.slice(0, 80));
    check('the cell lock is unhackable (police-only)', lockTag?.canHack === false, lockTag?.canHack);
    await _test.secureCellDoor();
    check('booking engages the hololock', cellDoor.lock_state === 'locked' && !cellDoor.is_open, `${cellDoor.lock_state}/${cellDoor.is_open}`);
    await _test.releaseCellDoor();
    check('release disengages the hololock', cellDoor.lock_state === 'unlocked', cellDoor.lock_state);
    await _test.secureCellDoor();
    check('the next booking re-engages it', cellDoor.lock_state === 'locked', cellDoor.lock_state);
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
