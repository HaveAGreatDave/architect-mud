// Synthesis plugin regression suite — run by tests/regress.js (never in prod).
// Guards on the reverse-engineering verbs, the chem-lab hub (furniture.describe),
// and the chem-lab storage vault: a lab cook/splice deposits its finished product
// into the lab container, and withdrawing it must keep each distinct-potency batch
// as its own row (the instanced-merge guard on pull). The cook/splice minigames
// themselves are driven client-side and covered by their own client flow.
import { query } from '../../server/models/db.js';
import { hooks } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  // reclaim needs a chem lab — the fake player has none, so it must error cleanly.
  const r = await run('reclaim nonexistent');
  check('reclaim without a lab errors cleanly', r?.type === 'error', r?.type);

  const p = getPlayer();

  // ── the chem-lab hub (furniture.describe) ──────────────────────────────────
  const lab = { id: 'furn_regress_hub', name: 'chem lab', flags: { crafting_station: 'chem_lab' } };
  const hub = await hooks['furniture.describe'](lab, p);
  check('hub surfaces cook + vault on a chem lab',
    /data-raw-cmd="cook"/.test(hub || '') && /data-raw-cmd="open chem lab"/.test(hub || ''), hub);
  check('hub hides splice from a non-splicer', !/data-raw-cmd="splice"/.test(hub || ''), hub);
  check('hub ignores non-lab furniture',
    (await hooks['furniture.describe']({ id: 'x', name: 'a chair', flags: {} }, p)) === undefined);

  // ── deposit → shared vault, withdraw keeps distinct-potency batches apart ───
  const zone = p.current_zone;
  const anyItem = (await query('SELECT id FROM items LIMIT 1')).rows[0]?.id;
  check('an item exists to exercise the vault round-trip', !!anyItem, anyItem);
  if (anyItem) {
    await query(
      `INSERT INTO furniture (id,zone_id,name,description,flags,object_type)
       VALUES ('furn_regress_vault',$1,'chem vault','test vault','{}'::jsonb,'container')
       ON CONFLICT (id) DO UPDATE SET zone_id=$1, object_type='container'`,
      [zone]
    );
    const owner = '_vault_furn_regress_vault';
    try {
      await query(`DELETE FROM player_inventory WHERE container_id='furn_regress_vault' OR player_id=$1`, [owner]);
      await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2`, [p.id, anyItem]);
      // Two batches of the SAME item at different potency, deposited as the vault sentinel.
      await query(
        `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data,container_id)
         VALUES ('pi_rv1',$1,$2,1,1.0,'{"potency":1.6,"spliced":true}'::jsonb,'furn_regress_vault'),
                ('pi_rv2',$1,$2,1,1.0,'{"potency":0.7,"spliced":true}'::jsonb,'furn_regress_vault')`,
        [owner, anyItem]
      );
      // Withdraw both through the container pull-by-id path the vault UI uses.
      await run('pullid pi_rv1');
      await run('pullid pi_rv2');
      const { rows } = await query(
        `SELECT custom_data->>'potency' AS potency FROM player_inventory
          WHERE player_id=$1 AND item_id=$2 AND container_id IS NULL
          ORDER BY (custom_data->>'potency')::float`,
        [p.id, anyItem]
      );
      check('vault withdraw keeps both batches as distinct rows', rows.length === 2, rows.length);
      check('vault withdraw preserves distinct potencies',
        rows[0]?.potency === '0.7' && rows[1]?.potency === '1.6', rows.map(x => x.potency).join(','));
    } finally {
      await query(`DELETE FROM player_inventory WHERE id IN ('pi_rv1','pi_rv2')`);
      await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2`, [p.id, anyItem]);
      await query(`DELETE FROM player_inventory WHERE player_id=$1`, [owner]);
      await query(`DELETE FROM furniture WHERE id='furn_regress_vault'`);
    }
  }
}
