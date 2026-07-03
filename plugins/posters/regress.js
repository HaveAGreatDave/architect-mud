// Posters plugin regression suite — run by tests/regress.js (never loaded in
// production). Exercises verb gating, a takedown->putup round trip, and the
// Kiyo/Cyd seam reveal. All DB rows it creates use throwaway ids/keys and are
// cleaned up in a finally, so it never touches the six real posters.
import { query } from '../../server/models/db.js';
import { world, setApartmentCache } from '../../server/engine/world.js';
import { hooks, _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  // A throwaway owned apartment so putup's home gate can pass deterministically.
  const aptId = '__posters_test_apt__';
  const savedZone = p.current_zone;
  const hadApt = world.zones.get(aptId);
  world.zones.set(aptId, { id: aptId, name: 'Test Flat', flags: { is_apartment: true }, exits: {}, players: new Set(), npcs: new Set(), enemies: new Set() });
  setApartmentCache(aptId, { owner_id: p.id });
  const zone = aptId; // the round-trip runs inside the owned home

  // ── Pure helpers ───────────────────────────────────────────────────────────
  check('kiyo/cyd are secret partners', _test.SECRET_PAIR.kiyo === 'cyd' && _test.SECRET_PAIR.cyd === 'kiyo');
  check('shortName strips boilerplate', _test.shortName('hero poster: KIYO, THE GRID-BREAKER') === 'KIYO, THE GRID-BREAKER');

  // ── Gating with nothing to act on (no DB mutation) ─────────────────────────
  p.current_zone = savedZone; // stand somewhere the player does NOT own
  let r = await run('takedown');
  check('takedown with no poster reports it', /no poster here/i.test(r?.message || ''), r?.message);
  r = await run('putup');
  check('putup outside an owned home is refused', /home you own/i.test(r?.message || ''), r?.message);

  p.current_zone = aptId; // move into the owned home for the round trip
  try {
    // ── Round trip: takedown -> item, putup -> furniture back ────────────────
    await query(
      `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
       VALUES ('furn_regress_poster', $1, 'hero poster: REGRESS DUMMY', 'A test poster.', 'decoration', $2)`,
      [zone, JSON.stringify({ hero_poster: true, poster_key: 'regress' })]
    );

    r = await run('takedown regress');
    check('takedown removes the wall poster', /roll it into a tube/i.test(r?.message || ''), r?.message);
    let f = await query(`SELECT 1 FROM furniture WHERE id='furn_regress_poster'`);
    check('furniture row is gone after takedown', f.rows.length === 0);
    let inv = await query(`SELECT custom_data FROM player_inventory WHERE player_id=$1 AND item_id='item_poster_regress'`, [p.id]);
    check('rolled poster is in inventory with snapshot', inv.rows.length === 1 && inv.rows[0].custom_data?.name === 'hero poster: REGRESS DUMMY', JSON.stringify(inv.rows[0]?.custom_data));

    r = await run('putup regress');
    check('putup hangs it back on the wall', /smooth it onto the wall/i.test(r?.message || ''), r?.message);

    // ── `take <poster>` — the natural verb peels it too, and falls through otherwise ─
    r = await run('take regress');
    check('take peels a hanging poster', /roll it into a tube/i.test(r?.message || ''), r?.message);
    f = await query(`SELECT 1 FROM furniture WHERE id='furn_hero_poster_regress'`);
    check('take removed the wall poster', f.rows.length === 0);
    // Not a poster → plugin returns undefined so the engine take runs (no ground items here).
    r = await run('take nonexistent-thing');
    check('take of a non-poster falls through to engine', /Nothing here to take|Can't find/i.test(r?.message || ''), r?.message);

    // Re-hang so the seam-reveal section below has the poster back on the wall.
    await run('putup regress');
    f = await query(`SELECT zone_id FROM furniture WHERE id='furn_hero_poster_regress'`);
    check('furniture recreated in current zone', f.rows.length === 1 && f.rows[0].zone_id === zone, JSON.stringify(f.rows));
    inv = await query(`SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id='item_poster_regress'`, [p.id]);
    check('rolled poster consumed on putup', inv.rows.length === 0);

    r = await run('putup');
    check('putup at home with nothing carried reports it', /no posters to put up/i.test(r?.message || ''), r?.message);

    // ── Examine telegraph: every hero poster advertises a clickable `take` ─────
    const kiyo = { zone_id: zone, name: 'hero poster: KIYO, THE GRID-BREAKER', flags: { hero_poster: true, poster_key: 'kiyo' } };
    let extra = await hooks['furniture.describe'](kiyo);
    check('examine telegraphs a clickable take link', /data-action="take"/.test(extra || '') && /peel it down/i.test(extra || ''), extra);

    // ── Seam reveal: hint only alone, GRU appended when the partner is present ─
    check('no GRU reveal without the partner', !/G R U/.test(extra || ''), String(extra));

    await query(
      `INSERT INTO furniture (id, zone_id, name, description, object_type, flags)
       VALUES ('furn_regress_cyd', $1, 'hero poster: CYD, THE CLOSER', 'A test poster.', 'decoration', $2)`,
      [zone, JSON.stringify({ hero_poster: true, poster_key: 'cyd' })]
    );
    extra = await hooks['furniture.describe'](kiyo);
    check('GRU reveal fires when partner hangs in the same room', /G R U/.test(extra || ''), extra);
    check('non-poster furniture is ignored by the hook',
      (await hooks['furniture.describe']({ zone_id: zone, name: 'a chair', flags: {} })) === undefined);
  } finally {
    await query(`DELETE FROM furniture WHERE id IN ('furn_regress_poster','furn_hero_poster_regress','furn_regress_cyd')`);
    await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id='item_poster_regress'`, [p.id]);
    p.current_zone = savedZone;
    world.apartments.delete(aptId);
    if (hadApt) world.zones.set(aptId, hadApt); else world.zones.delete(aptId);
  }
}
