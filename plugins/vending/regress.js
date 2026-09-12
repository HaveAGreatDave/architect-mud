// Vending plugin regression — seeds a throwaway dispenser + item and drives the
// real `vend` verb end-to-end (routing, dispense, inventory write, cooldown).
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, updateFurniture, deleteFurniture } from '../../server/engine/world.js';
import { VEND_CHARGE, VEND_BANDS } from '../drinks/config.js';

export default async function regress({ run, check, getPlayer }) {
  const player = getPlayer();
  const saved = player.current_zone;
  const Z = 'zone_vend_regress';
  const ITEM = 'item_vend_regress';
  const FURN = 'furn_vend_regress';

  try {
    // No dispenser in the room → clean error, no throw.
    player.current_zone = 'zone_vend_regress_empty';
    let r = await run('vend');
    check('vend with no dispenser errors cleanly', r?.type === 'error', JSON.stringify(r));

    // Seed a machine (cooldown off) + a stackable item. `description` is NOT NULL
    // on both tables, so it must be supplied.
    await query(
      `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test slop','test slop','consumable',1,10,$2)
       ON CONFLICT (id) DO UPDATE SET tags=$2`,
      [ITEM, JSON.stringify({ consumable: true, stackable: true, restore_hunger: 5 })]
    );
    await reloadItem(ITEM);
    await insertFurniture({
      id: FURN, name: 'test dispenser', description: 'a test dispenser', object_type: 'fixture',
      zone_id: Z, flags: JSON.stringify({ vends: ITEM, vend_cooldown_s: 0 }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]);

    player.current_zone = Z;
    r = await run('vend');
    check('vend dispenses from the machine', r?.type === 'output', JSON.stringify(r)?.slice(0, 160));
    let inv = await query('SELECT quantity FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]);
    check('vend adds the item to inventory', Number(inv.rows[0]?.quantity) === 1, JSON.stringify(inv.rows));

    // Cooldown off → a second vend stacks it (merges, not a new row).
    r = await run('vend');
    inv = await query('SELECT COUNT(*)::int AS rows, COALESCE(SUM(quantity),0)::int AS qty FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]);
    check('a second vend stacks the item (one row, qty 2)', inv.rows[0]?.rows === 1 && inv.rows[0]?.qty === 2, JSON.stringify(inv.rows));

    // Cooldown honoured when set.
    await updateFurniture(FURN, { flags: JSON.stringify({ vends: ITEM, vend_cooldown_s: 999 }) });
    await run('vend'); // arms cooldown
    r = await run('vend');
    check('vend respects the cooldown', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));

    // A SECOND MACHINE IN THE ROOM. `vend` used to take whichever it found first,
    // so every dispenser after that one was unreachable with no error to say so —
    // which only became visible when a room got seven of them (Second Helpings).
    const FURN2 = 'furn_vend_regress_2';
    try {
      await insertFurniture({
        id: FURN2, name: 'other dispenser', description: 'a second test dispenser', object_type: 'fixture',
        zone_id: Z, flags: JSON.stringify({ vends: ITEM, vend_cooldown_s: 0 }),
      }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

      r = await run('vend');
      check('a bare vend in a room of several asks which, rather than picking',
        r?.type === 'output' && /other dispenser/.test(r.message || '') && /test dispenser/.test(r.message || ''),
        JSON.stringify(r)?.slice(0, 160));

      r = await run('vend other');
      check('vend <name> reaches the second machine', r?.type === 'output' && !/Several machines/.test(r.message || ''),
        JSON.stringify(r)?.slice(0, 160));

      r = await run('vend dispenser');
      check('an ambiguous name asks rather than guessing', r?.type === 'error' && /Which one/.test(r.message || ''),
        JSON.stringify(r)?.slice(0, 160));

      r = await run('vend nothinglikethis');
      check('an unmatched name errors cleanly', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
    } finally {
      await deleteFurniture(FURN2).catch(() => {});
    }

    // ── A DISPENSER THAT FILLS WHAT IT HANDS YOU ──────────────────────────────
    //
    // The espresso-rig case, end to end through the real verb: the machine makes
    // the cup, drinks puts a coffee in it, the player pays. Everything about the
    // drink is asserted from the ROW rather than from the printed line, because a
    // line that says "flat white" over an empty cup is exactly the failure this
    // is here to catch.
    const CUP = 'item_vend_regress_cup';
    const RIG = 'furn_vend_regress_rig';
    const RIG2 = 'furn_vend_regress_rig_2';
    const ZR = 'zone_vend_regress_rig';
    const CUP_VALUE = 4;
    const PRICE = CUP_VALUE + VEND_CHARGE.barista;
    try {
      await query(
        `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,'test cup','test cup','misc',$3,10,$2)
         ON CONFLICT (id) DO UPDATE SET tags=$2, value=$3`,
        [CUP, JSON.stringify({ drinkware: true, drinkware_kind: 'cup', fillable: 2, unique: true }), CUP_VALUE]);
      await reloadItem(CUP);
      for (const id of [RIG, RIG2]) {
        await insertFurniture({
          id, name: id === RIG ? 'test rig' : 'spare rig', description: 'a test espresso rig', object_type: 'fixture',
          zone_id: ZR, flags: JSON.stringify({ vends: CUP, brew_tier: 'barista', vend_drink: 'black_coffee' }),
        }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id, name=EXCLUDED.name');
      }
      // The shared fake player has no `players` row, and adjustCredits is a
      // guarded UPDATE — with no row it returns false and every purchase in here
      // would read as "broke" for the wrong reason.
      await query(
        `INSERT INTO players (id, username, password_hash, handle, credits) VALUES ($1,$2,'x',$3,500)
         ON CONFLICT (id) DO UPDATE SET credits=500`,
        [player.id, `vendtest_${player.id}`, player.handle || 'Regressor']);
      player.credits = 500;
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, CUP]);
      player.current_zone = ZR;

      r = await run('vend test rig');
      check('a filling dispenser serves rather than refusing', r?.type === 'output', JSON.stringify(r)?.slice(0, 200));

      let cup = await query(
        `SELECT custom_data FROM player_inventory WHERE player_id=$1 AND item_id=$2 ORDER BY id LIMIT 1`,
        [player.id, CUP]);
      const drink = cup.rows[0]?.custom_data?.drink;
      check('the rig puts a real drink in the cup it just made',
        drink?.key === 'black_coffee' && drink?.name === 'coffee', JSON.stringify(drink)?.slice(0, 200));
      check('...at the band its tier serves, never its ceiling',
        drink?.band === VEND_BANDS.barista, drink?.band);
      check('...hot, because a machine that pulls it pulls it hot',
        Number.isFinite(drink?.hot_at), String(drink?.hot_at));
      check('...full to the cup’s own capacity',
        drink?.servings === 2 && drink?.capacity === 2, `${drink?.servings}/${drink?.capacity}`);
      check('...and charged the cup plus the tier',
        player.credits === 500 - PRICE, `${player.credits} (wanted ${500 - PRICE})`);
      check('the served line names the drink and the price',
        /coffee/.test(r?.message || '') && new RegExp(`₵${PRICE}`).test(r?.message || ''),
        (r?.message || '').slice(0, 220));

      // ONE MINUTE, DERIVED. Nothing authored a cooldown on this rig — a machine
      // that has to MAKE the thing gets the longer default, and a coffee you can
      // buy every twenty seconds is a hot-drink faucet in a cold snap.
      r = await run('vend test rig');
      check('a rig that makes something holds you for the minute',
        r?.type === 'error' && /needs a moment/.test(r.message || ''), JSON.stringify(r)?.slice(0, 160));

      // BROKE. The dispense is undone, so you are not left holding an empty cup
      // you did not ask for — and the minute never starts, so a machine that
      // would not serve you has not locked you out of the one next to it.
      const rowsBefore = (await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, CUP])).rows[0].n;
      await query('UPDATE players SET credits=$1 WHERE id=$2', [PRICE - 1, player.id]);
      player.credits = PRICE - 1;
      r = await run('vend spare rig');
      check('a rig you cannot afford refuses', r?.type === 'error' && /₵/.test(r.message || ''), JSON.stringify(r)?.slice(0, 160));
      const rowsAfter = (await query('SELECT COUNT(*)::int AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, CUP])).rows[0].n;
      check('...and takes the cup back rather than leaving you an empty one', rowsAfter === rowsBefore, `${rowsBefore} -> ${rowsAfter}`);
      check('...without charging you', player.credits === PRICE - 1, String(player.credits));

      await query('UPDATE players SET credits=$1 WHERE id=$2', [500, player.id]);
      player.credits = 500;
      r = await run('vend spare rig');
      check('...and without arming the cooldown it never got to use', r?.type === 'output', JSON.stringify(r)?.slice(0, 160));
    } finally {
      await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, CUP]).catch(() => {});
      await deleteFurniture(RIG).catch(() => {});
      await deleteFurniture(RIG2).catch(() => {});
      await query('DELETE FROM items WHERE id=$1', [CUP]).catch(() => {});
      await query('DELETE FROM players WHERE id=$1', [player.id]).catch(() => {});
      player.credits = 0;
      deleteItemCache(CUP);
      player.current_zone = Z;
    }
  } finally {
    // Always restore state + clean up, even if an assertion above threw, so a
    // failure here can't strand the fake player in a nonexistent zone.
    await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM]).catch(() => {});
    await deleteFurniture(FURN).catch(() => {});
    await query('DELETE FROM items WHERE id=$1', [ITEM]).catch(() => {});
    deleteItemCache(ITEM);
    player.current_zone = saved;
  }
}
