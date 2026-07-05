// Jail plugin regression suite — run by tests/regress.js (never loaded in production).
import { query } from '../../server/models/db.js';
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

  // unseal with nothing sealed must fail cleanly.
  const us = await run('unseal');
  check('unseal with nothing sealed errors cleanly', us?.type === 'error', us?.type);
}
