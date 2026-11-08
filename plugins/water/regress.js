// Water plugin regression suite. Run by tests/regress.js, never in production.
//
// Mostly `drink water`, the verb that picks its own source. What matters is what
// it refuses as much as what it finds: a toilet, a fouled tap, a foul canteen.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { reloadItem, deleteItemCache } from '../../server/engine/items-cache.js';
import { insertFurniture, deleteFurniture, world } from '../../server/engine/world.js';
import { foulToilet, clearToiletFilth } from '../bodily/index.js';

const Z = 'zone_water_regress';
const FLASK = 'item_water_regress_flask';
const RATION = 'item_water_regress_ration';
const FIZZ = 'item_water_regress_fizz';
const SINK = 'furn_water_regress_sink';
const TOILET = 'furn_water_regress_toilet';

export default async function regress({ run, check, getPlayer }) {
  // ── The content this rests on ──────────────────────────────────────────────
  {
    const { rows } = await query(`SELECT id, tags FROM items WHERE jsonb_exists(tags, 'potable')`);
    check('water: the world has potable items', rows.length > 0);
    const undrinkable = rows.filter(r => !r.tags.consumable || !Number(r.tags.restore_thirst));
    check('water: every potable item can be drunk and slakes thirst',
      undrinkable.length === 0, undrinkable.map(r => r.id).join(', '));

    // drinks and fillable run first and match by name, so either would take the
    // word "water" for itself and this plugin would never hear it.
    const { rows: claimed } = await query(
      `SELECT id FROM items WHERE (jsonb_exists(tags, 'fillable') OR jsonb_exists(tags, 'drinkware')) AND name ILIKE '%water%'`);
    check('water: no container is named water, which would swallow `drink water`',
      claimed.length === 0, claimed.map(r => r.id).join(', '));
  }

  const player = getPlayer();
  const saved = { zone: player.current_zone, thirst: player.thirst };
  const made = [];

  const give = async (item, custom = {}, quantity = 1) => {
    const id = randomUUID();
    await query(
      `INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,$4,1.0,$5::jsonb)`,
      [id, player.id, item, quantity, JSON.stringify(custom)]);
    made.push(id);
    return id;
  };
  const row = async (id) => (await query('SELECT quantity, custom_data FROM player_inventory WHERE id=$1', [id])).rows[0];
  const take = async (id) => { await query('DELETE FROM player_inventory WHERE id=$1', [id]); };
  const fluid = async (id) => (await row(id))?.custom_data?.fluid_amount ?? 0;
  const thirsty = () => { player.thirst = 30; };
  const furnish = (id, name, object_type) => insertFurniture({
    id, name, description: 'a test fixture', object_type, zone_id: Z, flags: JSON.stringify({ water_source: true }),
  }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');
  const NONE = /can't find any clean water/;

  try {
    for (const [id, name, tags] of [
      [FLASK, 'test regress flask', { fillable: 100 }],
      [RATION, 'test regress ration', { consumable: true, potable: true, hydrating: true, restore_thirst: 40, stackable: true }],
      [FIZZ, 'test regress fizz', { consumable: true, hydrating: true, restore_thirst: 40, stackable: true }],
    ]) {
      await query(
        `INSERT INTO items (id,name,description,type,value,weight,tags) VALUES ($1,$2,$2,'misc',1,100,$3)
         ON CONFLICT (id) DO UPDATE SET tags=$3`, [id, name, JSON.stringify(tags)]);
      await reloadItem(id);
    }
    player.current_zone = Z;

    // ── Nothing to find ──────────────────────────────────────────────────────
    thirsty();
    let r = await run('drink water');
    check('water: no water anywhere is announced', r?.type === 'error' && NONE.test(r.message), JSON.stringify(r));

    const fizz = await give(FIZZ);
    r = await run('drink water');
    check('water: a mixer is not water', r?.type === 'error' && NONE.test(r.message), JSON.stringify(r));
    check('...and it stays in the pack', (await row(fizz))?.quantity === 1);
    await take(fizz);

    // ── Carried containers ───────────────────────────────────────────────────
    const foul = await give(FLASK, { fluid_amount: 50, fluid_type: 'water', contaminated: true });
    const fuel = await give(FLASK, { fluid_amount: 50, fluid_type: 'fuel' });
    const neat = await give(FLASK, { fluid_amount: 50, fluid_type: 'drug', drug_id: 'drug_coffee' });
    r = await run('drink water');
    check('water: foul water, fuel and neat product are all refused', r?.type === 'error' && NONE.test(r.message), JSON.stringify(r));
    check('...and none of them is touched', await fluid(foul) === 50 && await fluid(fuel) === 50 && await fluid(neat) === 50);
    check('...and the thirst is still there', player.thirst === 30, String(player.thirst));

    // The foul flask has the same name and an earlier row, so resolving by name
    // would drink it.
    const clean = await give(FLASK, { fluid_amount: 20, fluid_type: 'water' });
    r = await run('drink water');
    check('water: a clean flask is drunk', r?.type === 'use' && /test regress flask/.test(r.message), JSON.stringify(r));
    check('...the clean one, not the foul one that shares its name', await fluid(clean) === 0 && await fluid(foul) === 50);
    check('...and it slakes thirst', player.thirst === 50, String(player.thirst));
    check('...without making anybody sick', !(player.statuses || []).some(s => s.name === 'sick'));

    // Laced water looks exactly like water, so it counts, but it goes last.
    const dosed = await give(FLASK, { fluid_amount: 40, fluid_type: 'water', drug_id: 'drug_coffee' });
    const plain = await give(FLASK, { fluid_amount: 40, fluid_type: 'water' });
    thirsty();
    r = await run('drink water');
    check('water: a clean flask goes before a laced one', await fluid(plain) < 40 && await fluid(dosed) === 40, JSON.stringify(r));
    await take(plain);
    thirsty();
    r = await run('drink water');
    check('water: a laced flask still passes for water when it is all there is', await fluid(dosed) < 40, JSON.stringify(r));
    await take(dosed);
    player.activeDrugs = [];
    player.pendingOnsets = [];

    // ── Carried bottles ──────────────────────────────────────────────────────
    const ration = await give(RATION, {}, 2);
    const flask = await give(FLASK, { fluid_amount: 10, fluid_type: 'water' });
    thirsty();
    r = await run('drink water');
    check('water: a container goes before a bottle that drinking would spend',
      await fluid(flask) === 0 && (await row(ration))?.quantity === 2, JSON.stringify(r));

    thirsty();
    r = await run('drink some water');
    check('water: a potable item is drunk', r?.type === 'use' && /You drink test regress ration/.test(r.message), JSON.stringify(r));
    check('...one of the stack', (await row(ration))?.quantity === 1);
    check('...and it slakes thirst', player.thirst === 70, String(player.thirst));

    player.thirst = 100;
    r = await run('drink water');
    check('water: a full meter refuses instead of spending a bottle',
      r?.type === 'error' && /not thirsty/.test(r.message) && (await row(ration))?.quantity === 1, JSON.stringify(r));

    // ── Furniture ────────────────────────────────────────────────────────────
    await furnish(TOILET, 'test regress toilet', 'toilet');
    thirsty();
    r = await run('drink water');
    check('water: carried water goes before the room', r?.type === 'use' && /ration/.test(r.message), JSON.stringify(r));
    await take(ration);

    thirsty();
    r = await run('drink water');
    check('water: a toilet is refused, even a clean one', r?.type === 'error' && NONE.test(r.message), JSON.stringify(r));
    check('...and the thirst is still there', player.thirst === 30, String(player.thirst));
    r = await run('drink test regress toilet');
    check('water: naming the toilet still drinks it', r?.type === 'use' && player.thirst > 30, JSON.stringify(r));

    await furnish(SINK, 'the test regress sink', 'sink');
    thirsty();
    r = await run('drink the water');
    check('water: a sink is found past the toilet', r?.type === 'use' && player.thirst > 30, JSON.stringify(r));
    check('...and a name with its own article reads once',
      /You drink from the test regress sink\./.test(r?.message || ''), r?.message);
    thirsty();
    r = await run('drink from test regress sink');
    check('water: drinking from a named source still works', r?.type === 'use' && player.thirst > 30, JSON.stringify(r));

    foulToilet(SINK, 'pee');
    thirsty();
    r = await run('drink water');
    check('water: a fouled sink is refused', r?.type === 'error' && NONE.test(r.message), JSON.stringify(r));
    clearToiletFilth(SINK);
    await deleteFurniture(SINK);
    await deleteFurniture(TOILET);

    // ── A zone that is its own source ────────────────────────────────────────
    world.zones.set(Z, { id: Z, name: 'test regress spring', flags: { water_source: true } });
    thirsty();
    r = await run('drink water');
    check('water: a zone can be the source', r?.type === 'use' && /the water here/.test(r.message) && player.thirst > 30, JSON.stringify(r));
  } finally {
    world.zones.delete(Z);
    player.current_zone = saved.zone;
    player.thirst = saved.thirst;
    player.statuses = (player.statuses || []).filter(s => s.name !== 'sick');
    clearToiletFilth(SINK);
    if (made.length) await query('DELETE FROM player_inventory WHERE id = ANY($1)', [made]);
    await deleteFurniture(SINK).catch(() => {});
    await deleteFurniture(TOILET).catch(() => {});
    const items = [FLASK, RATION, FIZZ];
    await query('DELETE FROM items WHERE id = ANY($1)', [items]).catch(() => {});
    for (const id of items) deleteItemCache(id);
  }
}
