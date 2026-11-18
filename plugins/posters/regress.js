// Posters plugin regression suite — run by tests/regress.js (never loaded in
// production). Exercises verb gating, a takedown->putup round trip, and the
// Kiyo/Cyd seam reveal. All DB rows it creates use throwaway ids/keys and are
// cleaned up in a finally, so it never touches the six real posters.
import { query } from '../../server/models/db.js';
import { world, setApartmentCache, insertFurniture, deleteFurnitureWhere, getZoneFurniture } from '../../server/engine/world.js';
import { spotOf } from './sheets.js';
import { getFlag, clearFlag } from '../../server/engine/flags.js';
import { hooks, _test, reconcileTakenPosters } from './index.js';

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
    await insertFurniture({
      id: 'furn_regress_poster', zone_id: zone, name: 'hero poster: REGRESS DUMMY',
      description: 'A test poster.', object_type: 'decoration',
      flags: JSON.stringify({ hero_poster: true, poster_key: 'regress' }),
    });

    r = await run('takedown regress');
    check('takedown removes the wall poster', /roll it into a tube/i.test(r?.message || ''), r?.message);
    let f = await query(`SELECT 1 FROM furniture WHERE id='furn_regress_poster'`);
    check('furniture row is gone after takedown', f.rows.length === 0);
    let inv = await query(`SELECT custom_data FROM player_inventory WHERE player_id=$1 AND item_id='item_poster_regress'`, [p.id]);
    check('rolled poster is in inventory with snapshot', inv.rows.length === 1 && inv.rows[0].custom_data?.name === 'hero poster: REGRESS DUMMY', JSON.stringify(inv.rows[0]?.custom_data));

    const taken = await getFlag('world', 'poster_taken:regress');
    check('takedown of an authored poster records it as taken', taken === 'true', String(taken));

    r = await run('putup regress');
    check('putup hangs it back on the wall', /smooth it onto the wall/i.test(r?.message || ''), r?.message);
    const hung = () => query(`SELECT id, zone_id, origin, owner_id FROM furniture WHERE flags->>'poster_key'='regress'`);
    f = await hung();
    check('re-hung poster is a fresh player row, not the authored id',
      f.rows.length === 1 && /^furn_[0-9a-f]{8}$/.test(f.rows[0].id) && f.rows[0].origin === 'player' && f.rows[0].owner_id === p.id,
      JSON.stringify(f.rows));

    // ── Simulated re-import: the upsert puts the authored row back on its wall ─
    await insertFurniture({
      id: 'furn_regress_poster', zone_id: savedZone, name: 'hero poster: REGRESS DUMMY',
      description: 'A test poster.', object_type: 'decoration',
      flags: JSON.stringify({ hero_poster: true, poster_key: 'regress' }),
    });
    await reconcileTakenPosters();
    f = await hung();
    check('takedown survives a re-import: authored row removed again',
      !f.rows.some(x => x.id === 'furn_regress_poster'), JSON.stringify(f.rows));
    check('re-import leaves the player copy where it hangs',
      f.rows.length === 1 && f.rows[0].zone_id === zone && f.rows[0].origin === 'player', JSON.stringify(f.rows));

    // ── `take <poster>` — the natural verb peels it too, and falls through otherwise ─
    r = await run('take regress');
    check('take peels a hanging poster', /roll it into a tube/i.test(r?.message || ''), r?.message);
    f = await hung();
    check('take removed the wall poster', f.rows.length === 0);
    // Not a poster → plugin returns undefined so the engine take runs (no ground items here).
    r = await run('take nonexistent-thing');
    check('take of a non-poster falls through to engine', /Nothing here to take|Can't find/i.test(r?.message || ''), r?.message);

    // Re-hang so the seam-reveal section below has the poster back on the wall.
    await run('putup regress');
    f = await query(`SELECT zone_id FROM furniture WHERE flags->>'poster_key'='regress'`);
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

    await insertFurniture({
      id: 'furn_regress_cyd', zone_id: zone, name: 'hero poster: CYD, THE CLOSER',
      description: 'A test poster.', object_type: 'decoration',
      flags: JSON.stringify({ hero_poster: true, poster_key: 'cyd' }),
    });
    extra = await hooks['furniture.describe'](kiyo);
    check('GRU reveal fires when partner hangs in the same room', /G R U/.test(extra || ''), extra);
    check('non-poster furniture is ignored by the hook',
      (await hooks['furniture.describe']({ zone_id: zone, name: 'a chair', flags: {} })) === undefined);

    // ── Mural: one sheet per letter, Djerk leftmost, full set spells HELLMOO ──
    check('mural has one sheet per letter', _test.MURAL.length === _test.MURAL_WORD.length);
    check('djerk holds the leftmost slot', _test.MURAL[0] === 'djerk');
    check('kiyo and cyd stay adjacent in the run',
      Math.abs(_test.MURAL.indexOf('kiyo') - _test.MURAL.indexOf('cyd')) === 1);

    // Leftmost sheet, nothing beside it: clean-margin seat, no edges answered.
    let line = _test.placementLine('djerk', new Set(['djerk']));
    check('placement seats the leftmost sheet by its clean margin', /factory margin/i.test(line), line);
    check('placement reports nothing answering yet', /Nothing beside it answers/i.test(line), line);
    check('placement counts the run', /<b>1 of 7<\/b>/.test(line), line);
    // Its right-hand neighbour present: the tearing lines up.
    line = _test.placementLine('djerk', new Set(['djerk', 'alphagunman']));
    check('placement names the neighbour and loses the seam',
      /against the Alphagunman sheet/.test(line) && /never been apart/.test(line), line);
    // The secret pair keep the understated wink instead of the seam prose —
    // saying "the seam vanished" here would pre-empt the GRU reveal on examine.
    const pair = _test.placementLine('kiyo', new Set(['kiyo', 'cyd']));
    check('the pair keep their own wink', /almost seem to line up/.test(pair) && !/never been apart/.test(pair), pair);

    // Hang the whole run in one room — the full reveal supersedes the GRU hint.
    for (const k of _test.MURAL) {
      await insertFurniture({
        id: `furn_regress_mural_${k}`, zone_id: zone, name: `hero poster: ${k.toUpperCase()}`,
        description: 'A test poster.', object_type: 'decoration',
        flags: JSON.stringify({ hero_poster: true, poster_key: k }),
      });
    }
    const full = await hooks['furniture.describe']({
      zone_id: zone, name: 'hero poster: DJERK', flags: { hero_poster: true, poster_key: 'djerk' } });
    check('full set spells the word across the seams', /H E L L M O O/.test(full || ''), full);
    check('full reveal supersedes the GRU pair hint', !/three deliberate letters/i.test(full || ''), full);
    check('full reveal still offers the take link', /data-action="take"/.test(full || ''), full);

    // ── ROOM: the sheets on the wall (`room.sheets`), one per slot, whose glyphs spell the word ──
    const sheets = hooks['room.sheets'](zone) || [];
    check('room.sheets gives one sheet per slot in order',
      sheets.length === _test.MURAL.length && sheets.every((s, i) => s.slot === i && s.of === _test.MURAL.length && s.set === 'hellmoo'), JSON.stringify(sheets.map((s) => s.slot)));
    check('the sheets\' glyphs spell the word', sheets.map((s) => s.glyph).join('') === _test.MURAL_WORD, sheets.map((s) => s.glyph).join(''));
    check('a sheet carries its title and print', sheets.every((s) => s.title && /^#[0-9a-f]{6}$/i.test(s.ground) && s.pose), JSON.stringify(sheets[0]));
    check('every sheet is cut from one print, a panel a slot',
      sheets.every((s) => s.art?.src === sheets[0].art?.src && s.art.cols.length === s.of + 1 && s.art.cols.every((c, i) => !i || c > s.art.cols[i - 1])), JSON.stringify(sheets[0]?.art));
    check('room.sheets answers nothing for a bare room', hooks['room.sheets']('__no_such_room__') === undefined);

    // ── a wall for the run: putup <name> on <wall>, the arrange mode's stock and hang ──
    check('a sheet spot reads a wall and its along', JSON.stringify(spotOf({ wall: 'left', along: 1.234 })) === '{"wall":"left","along":1.23}' && spotOf({ wall: 'ceiling' }) === null && JSON.stringify(spotOf('{"wall":"back"}')) === '{"wall":"back"}');
    // the mural above is still up, and a hung sheet takes the whole run in the room with it (moveRun): take it down first
    await deleteFurnitureWhere(`DELETE FROM furniture WHERE zone_id=$1 AND id LIKE 'furn_regress_mural_%'`, [zone]);
    await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id LIKE 'item_poster_%'`, [p.id]);
    await query(`INSERT INTO player_inventory (id, player_id, item_id, quantity, custom_data) VALUES (gen_random_uuid(),$1,'item_poster_kiyo',1,$2), (gen_random_uuid(),$1,'item_poster_djerk',1,$3)`,
      [p.id, JSON.stringify({ poster_key: 'kiyo', name: 'hero poster: KIYO, TEST' }), JSON.stringify({ poster_key: 'djerk', name: 'hero poster: DJERK, TEST' })]);
    try {
      r = await run('putup kiyo on the left wall');
      const kiyoRow = getZoneFurniture(zone).find((f) => f.flags?.poster_key === 'kiyo');
      check('putup <name> on the left wall hangs it there', /left wall/i.test(r?.message || '') && kiyoRow?.flags?.sheet_spot?.wall === 'left', r?.message);
      const stock = await hooks['room.sheetStock'](p);
      check('room.sheetStock lists the carried roll as a sheet', stock?.length === 1 && stock[0].slot === _test.MURAL.indexOf('djerk') && stock[0].inv, JSON.stringify(stock));
      const hung = await hooks['room.sheetHang']({ player: p, zoneId: zone, inv: stock[0].inv, spot: { wall: 'right', along: 2 } });
      const run2 = getZoneFurniture(zone).filter((f) => ['kiyo', 'djerk'].includes(f.flags?.poster_key));
      check('room.sheetHang hangs it and moves the run with it', hung === true && run2.length === 2 && run2.every((f) => f.flags?.sheet_spot?.wall === 'right' && f.flags.sheet_spot.along === 2), JSON.stringify(run2.map((f) => f.flags)));
      check('room.sheets carries the spot', hooks['room.sheets'](zone).every((s) => s.spot?.wall === 'right'));
      check('room.sheetHang refuses a roll the player lacks', (await hooks['room.sheetHang']({ player: p, zoneId: zone, inv: stock[0].inv, spot: { wall: 'left' } })) === false);
    } finally {
      await deleteFurnitureWhere(`DELETE FROM furniture WHERE zone_id=$1 AND flags->>'poster_key' IN ('kiyo','djerk')`, [zone]);
      await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id LIKE 'item_poster_%'`, [p.id]);
    }

    // ── posterkit: staff get one rolled copy of each sheet; anyone else is told it isn't a verb ──
    const savedRole = p.role;
    try {
      p.role = 'player';
      r = await run('posterkit');
      check('posterkit refuses a non-staff player', /unknown command/i.test(r?.message || ''), r?.message);
      p.role = 'dev';
      await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id LIKE 'item_poster_%'`, [p.id]);
      r = await run('posterkit');
      const { rows: kit } = await query(`SELECT item_id, custom_data FROM player_inventory WHERE player_id=$1 AND item_id LIKE 'item_poster_%'`, [p.id]);
      check('posterkit gives one of every sheet', _test.MURAL.every((k) => kit.some((x) => x.item_id === `item_poster_${k}` && x.custom_data?.poster_key === k)) && kit.length === _test.MURAL.length, `${kit.length}: ${r?.message}`);
    } finally {
      p.role = savedRole;
      await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id LIKE 'item_poster_%'`, [p.id]);
    }
  } finally {
    await deleteFurnitureWhere(`DELETE FROM furniture WHERE id IN ('furn_regress_poster','furn_regress_cyd') OR id LIKE 'furn_regress_mural_%' OR flags->>'poster_key'='regress'`);
    await clearFlag('world', 'poster_taken:regress');
    await query(`DELETE FROM player_inventory WHERE player_id=$1 AND item_id='item_poster_regress'`, [p.id]);
    p.current_zone = savedZone;
    world.apartments.delete(aptId);
    if (hadApt) world.zones.set(aptId, hadApt); else world.zones.delete(aptId);
  }
}
