// Graffiti plugin regression suite — run by tests/regress.js (never loaded in production).
//
// Three things here are load-bearing and none of them is the verb:
//   • wallsNear — the "you cannot tag open ground" rule. If this ever returns a
//     non-building tile, the whole premise of the feature is gone.
//   • esc — the text is player-authored and lands in a stranger's room description,
//     which is rendered as HTML. This is the only thing standing between a typed
//     `<script>` and everyone who walks down that street.
//   • expired — lazy, date-derived expiry with no tick. It has to fail toward "the
//     tag is still there", because the alternative is a clock hiccup silently
//     erasing every wall in the city.
//
// The spray can adds a fourth: STYLE IS DATA, NEVER MARKUP. paint.js is the only
// thing that turns a run into HTML, and the only thing that decides a run is a run.
// A colour that isn't a colour has to be dropped rather than emitted, and the run
// indices have to survive escaping — `esc` changes the LENGTH of the string, and a
// renderer that indexed the escaped text would slice an entity in half and put a
// live `<` back on the wall.
import { _test, TAG_MAX_LEN, TAG_LIFE_DAYS, CAN_CAPACITY, tagOn, tagsAt, removeTag, removeTagsAt, tagFromWorld } from './index.js';
import { normalizeRuns, coalesceRuns, renderStyled, decodePayload, safeColor, safeFace, escapedChars } from './paint.js';
import { TAG_FACES } from '../../client/shared/tag-strokes.js';
import { world, clearTileIndex } from '../../server/engine/world.js';
import { gameDayIndex } from '../../server/engine/zone-filth.js';

export default async function regress({ run, check }) {
  const { wallsNear, pickWall, expired, esc, tags, putTag, wallTags, unesc, wallLabel } = _test;

  let r = await run('tag');
  check('tag verb routed', r?.type !== undefined, JSON.stringify(r));

  // --- You spray a building, not a tile ------------------------------------
  const street = { id: '__rg_street__', name: 'Test Street', exits: { north: '__rg_shop__', east: '__rg_field__' } };
  const shop = { id: '__rg_shop__', name: 'shopfront', flags: { is_building: true, building_name: 'Bodega Vu' } };
  const field = { id: '__rg_field__', name: 'Open Ground', flags: {} };
  world.zones.set(street.id, street);
  world.zones.set(shop.id, shop);
  world.zones.set(field.id, field);

  const walls = wallsNear(street);
  check('wallsNear finds the building on an exit', walls.length === 1 && walls[0].id === '__rg_shop__', JSON.stringify(walls));
  check('wallsNear prefers the building_name over the tile name', walls[0].name === 'Bodega Vu', walls[0].name);
  check('wallsNear ignores open ground', !walls.some(w => w.id === '__rg_field__'));
  check('a tile with no building has no walls', wallsNear({ id: 'x', exits: { north: '__rg_field__' } }).length === 0);
  check('a tile with no exits at all has no walls', wallsNear({ id: 'x' }).length === 0);

  // --- Indoors, the room's own wall is the surface --------------------------
  // ⚠ A FAKE ZONE PUT INTO `world.zones` IS A REAL ZONE TO EVERYTHING ELSE, and it
  // must carry the Sets a hydrated one has: `getAllZones()` maps `z.players.size`
  // and `z.enemies.size` over every zone in the world, so one without them throws
  // there — and the throw lands in whichever suite happens to call it NEXT, which
  // is nowhere near this file. Leaving this one behind cost 18 reds across
  // prologue, swimming, tablet, trucking, voidwalking and yacht (every suite that
  // sorts after "graffiti"), none of which mentions graffiti anywhere.
  const backroom = { id: '__rg_room__', name: 'Back Room', flags: { is_interior: true }, exits: { south: street.id },
    players: new Set(), enemies: new Set(), npcs: new Set() };
  world.zones.set(backroom.id, backroom);
  const inner = wallsNear(backroom);
  check('an interior offers its own wall', inner.length === 1 && inner[0].id === backroom.id, JSON.stringify(inner));
  check('the interior wall is pickable with no word', pickWall(inner, '')?.wall?.id === backroom.id);
  check("an interior doesn't also offer the street outside", !inner.some(w => w.id === street.id));

  // --- Picking which wall ---------------------------------------------------
  check('pickWall matches a direction', pickWall(walls, 'north')?.wall?.id === '__rg_shop__');
  check('pickWall matches an initial', pickWall(walls, 'n')?.wall?.id === '__rg_shop__');
  check('pickWall matches part of the name, case-insensitively', pickWall(walls, 'bodega')?.wall?.id === '__rg_shop__');
  check('pickWall with one wall and no word picks it', pickWall(walls, '')?.wall?.id === '__rg_shop__');
  check('pickWall refuses a word that matches nothing', !pickWall(walls, 'zzz').wall);
  const two = [{ dir: 'north', id: 'a', name: 'Alpha' }, { dir: 'north', id: 'b', name: 'Beta' }];
  check('pickWall reports ambiguity rather than guessing', Array.isArray(pickWall(two, 'north').ambiguous));
  check('pickWall with several walls and no word asks', !pickWall(two, '').wall);

  // --- The escape, which is the security boundary ---------------------------
  check('esc neutralises a tag open', !esc('<script>alert(1)</script>').includes('<'));
  check('esc neutralises a tag close', !esc('<b>x</b>').includes('>'));
  check('esc escapes the ampersand FIRST (no double-encoding)', esc('&lt;') === '&amp;lt;', esc('&lt;'));
  check('esc leaves ordinary slogans alone', esc('NO GODS NO LANDLORDS') === 'NO GODS NO LANDLORDS');
  check('the length cap is measured on what was typed', TAG_MAX_LEN === 48, String(TAG_MAX_LEN));

  // --- Lazy expiry ----------------------------------------------------------
  const today = '2026-08-01';
  const idx = gameDayIndex(today);
  check('a tag put up today is live', expired({ dayIndex: idx }, today) === false);
  check('a tag one day short of the limit is live', expired({ dayIndex: idx - (TAG_LIFE_DAYS - 1) }, today) === false);
  check('a tag at the limit is gone', expired({ dayIndex: idx - TAG_LIFE_DAYS }, today) === true);
  check('a tag well past the limit is gone', expired({ dayIndex: idx - 99 }, today) === true);
  // Fail toward "still there" — never let a clock problem erase the city.
  check('a tag with no day survives an unknown clock', expired({ dayIndex: null }, today) === false);
  check('an unparseable game date expires nothing', expired({ dayIndex: idx - 99 }, 'not-a-date') === false);

  // --- tagOn reads through expiry, and never queries -------------------------
  // The date is passed explicitly rather than left to the live game clock: the
  // harness boots the world without the environment, so gameToday() is null there
  // — which is exactly the fail-safe (an unknown clock expires nothing), and would
  // make an implicit-clock assertion here test nothing at all.
  const nowIdx = idx;
  putTag(street.id, { text: 'TEST', targetZoneId: shop.id, targetName: 'Bodega Vu', authorId: 'p1', authorHandle: 'ZERO', dayIndex: nowIdx });
  check('tagOn returns a live tag', tagOn(street.id, shop.id, today)?.text === 'TEST');
  putTag(street.id, { text: 'OLD', targetZoneId: shop.id, targetName: 'Bodega Vu', dayIndex: nowIdx - 99 });
  check('tagOn hides an expired tag without deleting it', tagOn(street.id, shop.id, today) === null && tags.get(street.id)?.has(shop.id));
  check('tagOn with no clock keeps the tag up rather than erasing it', tagOn(street.id, shop.id, null)?.text === 'OLD');
  check('tagsAt leaves an expired tag out', tagsAt(street.id, today).length === 0);
  check('tagOn on an untagged tile is null', tagOn('__rg_field__', shop.id) === null);
  check('tagOn on an unknown zone is null', tagOn('__no_such_zone__', shop.id) === null);
  check('tagsAt on an untagged tile is empty', tagsAt('__rg_field__').length === 0);

  // --- The room line --------------------------------------------------------
  putTag(street.id, { text: 'NO GODS NO LANDLORDS', targetZoneId: shop.id, targetName: 'Bodega Vu', dayIndex: nowIdx });
  const line = await (await import('./index.js')).hooks['zone.describeRoom'](street);
  check("the room line names the building it's sprayed on", /Bodega Vu/.test(line || ''), line);
  check('the room line carries the tag text', /NO GODS NO LANDLORDS/.test(line || ''), line);
  // Inside vs. outside is derived from the wall being the tile itself.
  putTag(backroom.id, { text: 'HI', targetZoneId: backroom.id, targetName: backroom.name, dayIndex: nowIdx });
  const inLine = await (await import('./index.js')).hooks['zone.describeRoom'](backroom);
  check('an interior tag reads as the wall in here', /wall in here/.test(inLine || ''), inLine);
  check("an interior tag doesn't claim a shopfront", !/front of/.test(inLine || ''), inLine);
  tags.delete(backroom.id);
  const clean = await (await import('./index.js')).hooks['zone.describeRoom'](field);
  check('an untagged room contributes nothing to the description', clean === undefined, String(clean));

  // --- Style is data, never markup -----------------------------------------
  check('safeColor accepts a six-digit hex', safeColor('#FF0044') === '#ff0044');
  check('safeColor refuses a colour name', safeColor('red') === null);
  check('safeColor refuses a style injection', safeColor('#fff;background:url(x)') === null);
  check('safeColor refuses javascript:', safeColor('javascript:alert(1)') === null);
  check('safeColor refuses a short hex (the renderer only ever emits six)', safeColor('#fff') === null);

  const norm = normalizeRuns([{ n: 2, c: '#ff0000', f: 1 }], 5);
  check('normalizeRuns pads the tail so runs always cover the text', norm.reduce((a, r) => a + r.n, 0) === 5, JSON.stringify(norm));
  check('normalizeRuns clips a run that overruns the text',
    normalizeRuns([{ n: 99, c: '#ff0000', f: 0 }], 3).reduce((a, r) => a + r.n, 0) === 3);
  check('normalizeRuns drops a bad colour rather than passing it through',
    normalizeRuns([{ n: 2, c: 'red; x', f: 0 }], 2)[0]?.c === null || normalizeRuns([{ n: 2, c: 'red; x', f: 0 }], 2).length === 0);
  check('normalizeRuns masks the flags to the four that exist',
    normalizeRuns([{ n: 1, c: null, f: 255 }], 1)[0]?.f === 15);
  check('an entirely unstyled run list is no style at all', normalizeRuns([{ n: 3, c: null, f: 0 }], 3).length === 0);
  check('normalizeRuns survives junk in place of an array', normalizeRuns('nope', 3).length === 0);
  check('coalesceRuns merges neighbours that look the same',
    coalesceRuns([{ n: 1, c: '#ff0000', f: 0 }, { n: 2, c: '#ff0000', f: 0 }]).length === 1);

  // The index trap: `esc` lengthens the string, a run counts typed characters.
  check('escapedChars counts an entity as the one character it was',
    escapedChars(esc('a<b')).length === 3, JSON.stringify(escapedChars(esc('a<b'))));
  const styledEsc = renderStyled(esc('a<b'), normalizeRuns([{ n: 1, c: null, f: 0 }, { n: 1, c: '#00ff00', f: 0 }], 3));
  check('a styled tag never re-opens an escaped character', !/<b>|<script/.test(styledEsc.replace(/<\/?(span|b|i|u|s)\b[^>]*>/g, '')), styledEsc);
  check('the escaped entity survives styling intact', styledEsc.includes('&lt;'), styledEsc);
  check('renderStyled with no runs is exactly the escaped text', renderStyled('PLAIN', []) === 'PLAIN');
  check('renderStyled emits a colour only from a validated run',
    renderStyled('AB', [{ n: 2, c: '#ff0000', f: 0 }]) === '<span style="color:#ff0000">AB</span>');
  check('renderStyled applies the weight flags', /<b>|<i>/.test(renderStyled('AB', [{ n: 2, c: null, f: 3 }])));

  // --- The wire format ------------------------------------------------------
  const b64 = Buffer.from(JSON.stringify({ t: 'NO GODS', r: [{ n: 2, c: '#ff0000', f: 1 }] })).toString('base64');
  const decoded = decodePayload(b64);
  check('decodePayload reads a well-formed payload', decoded?.text === 'NO GODS' && decoded.runs.length === 1, JSON.stringify(decoded));
  check('decodePayload refuses rubbish rather than half-applying it', decodePayload('not base64 at all!!') === null);
  check('decodePayload refuses an empty tag', decodePayload(Buffer.from(JSON.stringify({ t: '   ' })).toString('base64')) === null);
  check('decodePayload refuses nothing at all', decodePayload('') === null && decodePayload(undefined) === null);
  const nl = decodePayload(Buffer.from(JSON.stringify({ t: 'ONE\nTWO' })).toString('base64'));
  check('decodePayload flattens a newline — a tag is one line on a wall', nl?.text === 'ONE TWO', JSON.stringify(nl));

  // --- The letterform ---------------------------------------------------------
  // The can offers the renderer's own list, and the server stores only a name off
  // that list: anything else is no choice at all, and the wall rolls one.
  check('safeFace accepts every letterform the renderer draws', TAG_FACES.length >= 4 && TAG_FACES.every(f => safeFace(f) === f), JSON.stringify(TAG_FACES));
  check('safeFace ignores case and padding', safeFace(' SHARP ') === 'sharp');
  check('safeFace refuses a face that is not one', safeFace('comic sans') === null && safeFace('<b>') === null);
  check('safeFace treats nothing as no choice', safeFace(undefined) === null && safeFace('') === null);
  const faced = decodePayload(Buffer.from(JSON.stringify({ t: 'OSKA', f: 'block' })).toString('base64'));
  check('decodePayload carries the letterform', faced?.face === 'block', JSON.stringify(faced));
  const unfaced = decodePayload(Buffer.from(JSON.stringify({ t: 'OSKA', f: 'wingdings' })).toString('base64'));
  check('decodePayload drops a bad letterform and keeps the tag', unfaced?.text === 'OSKA' && unfaced.face === null, JSON.stringify(unfaced));
  check('a payload with no letterform leaves it to the wall', decoded?.face === null, JSON.stringify(decoded));

  // --- The room line, painted ------------------------------------------------
  putTag(street.id, {
    text: esc('NO GODS'), style: [{ n: 2, c: '#ff2d55', f: 1 }, { n: 5, c: null, f: 0 }],
    targetZoneId: shop.id, targetName: 'Bodega Vu', dayIndex: nowIdx,
  });
  const painted = await (await import('./index.js')).hooks['zone.describeRoom'](street);
  check('a painted tag carries its colour into the room line', painted.includes('#ff2d55'), painted);
  check('a painted tag still names the building', /Bodega Vu/.test(painted));
  check('a painted tag drops the blanket bold — the paint decides the weight now',
    !/: <b>/.test(painted), painted);

  // --- Paint budget ----------------------------------------------------------
  // A can has to afford at least one full-length tag, or the tag limit is a lie
  // the editor tells you before the can refuses.
  check('a full can affords a full-length tag', CAN_CAPACITY >= TAG_MAX_LEN, `${CAN_CAPACITY} < ${TAG_MAX_LEN}`);

  // --- The verbs the dialog talks to ----------------------------------------
  for (const verb of ['spraycan', 'sprayapply', 'spraysave', 'spraydel']) {
    const res = await run(verb);
    check(`${verb} is routed`, res?.type !== undefined, `${verb}: ${JSON.stringify(res)}`);
  }

  // --- What the windshield is told -----------------------------------------
  //
  // `wall.tags` is the seam between a tag in the table and paint on a building in the flight
  // window. Everything it can get wrong is invisible from inside the game: the words reach the
  // renderer escaped and it paints "&amp;" onto a wall, or the normal comes out wrong and every
  // tag in the city lands on the entrance face, or it answers for a wall nobody sprayed.
  {
    // The pavement is SOUTH of the shop (the shop is on the street's `north` exit), so the wall
    // that was sprayed faces south — and south is +y, per faceVec in the renderer.
    street.grid_x = 10; street.grid_y = 20;
    shop.grid_x = 10; shop.grid_y = 19;
    // ⚠ `tagFromWorld` RATHER THAN `applyTag`, and not only because it needs no can: this is the
    // entry point the unrest sim stages a `graffiti` incident through, so a world-authored tag
    // and a player-sprayed one are proved to reach the renderer by the same road. It also picks
    // the wall itself, which is what makes the normal below a real derivation rather than an echo.
    await tagFromWorld(street.id, 'ACAB & CO', 'nobody');

    const got = wallTags(shop, shop.grid_x, shop.grid_y) || [];
    check('wall.tags answers for the building that was sprayed', got.length === 1, JSON.stringify(got));
    check('…with the wall facing the pavement, not the entrance',
      got[0] && got[0].n[0] === 0 && got[0].n[1] === 1, JSON.stringify(got[0] && got[0].n));
    // ⚠ THE RENDERER PAINTS ONTO A CANVAS, NOT INTO HTML. The table stores the text escaped
    // because a room description is HTML; hand that straight to `fillText` and the wall reads
    // "ACAB &amp; CO". Escaping is still the room's rule — this is the one consumer that undoes it.
    check('the words arrive as the player typed them', got[0] && got[0].t === 'ACAB & CO', got[0] && got[0].t);
    check('a tag nobody picked letters for sends none', got[0] && got[0].f === undefined, JSON.stringify(got[0]));
    // The letterform picked in the can rides to the renderer alongside the words.
    tags.get(street.id).get(shop.id).face = 'sharp';
    const sharp = wallTags(shop, shop.grid_x, shop.grid_y) || [];
    check('a picked letterform reaches the renderer', sharp[0] && sharp[0].f === 'sharp', JSON.stringify(sharp[0]));
    tags.get(street.id).get(shop.id).face = null;
    check('and the stored text is still escaped', (tagOn(street.id, shop.id) || {}).text === 'ACAB &amp; CO', (tagOn(street.id, shop.id) || {}).text);

    // A building nobody sprayed answers nothing — the index is a hint, and a hint that fires on
    // the wrong wall would paint graffiti across buildings at random.
    check('an untagged building answers nothing', wallTags(field, 11, 20) === undefined);

    // ⚠ AND A SCRUBBED WALL STOPS ANSWERING WITHOUT THE INDEX BEING PRUNED. `byBuilding` keeps
    // its entry on purpose (see removeTag); what makes that safe is that every id it yields is
    // re-checked through `tagOn`. If that check is ever dropped, this is the case that catches it.
    await removeTag(street.id, shop.id);
    check('a scrubbed wall stops being painted', wallTags(shop, shop.grid_x, shop.grid_y) === undefined);
    check('…while the index deliberately still holds it', _test.byBuilding.get(shop.id)?.size === 1);

    check('unesc is the inverse of esc', unesc(esc('a & b < c > d')) === 'a & b < c > d', unesc(esc('a & b < c > d')));
    // ⚠ `&amp;` LAST. "&lt;" typed by a player is stored as "&amp;lt;" and must decode back to the
    // four characters they typed, not to a "<" that was never sprayed.
    check('unesc does not double-decode', unesc(esc('&lt;')) === '&lt;', unesc(esc('&lt;')));
  }
  await removeTag(street.id, shop.id);
  check('removeTag clears the wall', tagOn(street.id, shop.id) === null);

  // --- Any face of a building, found on the grid ------------------------------
  //
  // ⚠ THE WHOLE FEATURE IS THAT NONE OF THESE HAS AN EXIT. A building tile has one exit, on its
  // entrance side, so a street running past its flank can only find it on the grid. If wallsNear
  // ever goes back to reading exits alone, the alley below comes back with no walls at all.
  //
  // An alley at (11,41) on the world map, far off the real grid (which starts at x 726):
  //   north (11,40): North Block, entrance south, so the alley sees its FRONT
  //   east  (12,41): East Block, entrance east, so the alley sees its BACK
  //   west  (10,41): West Block, entrance north, so the alley sees its SIDE
  //   south (11,42): open ground, no wall
  //   (9,41): Far Block, sharing a party wall with West Block
  {
    const sets = () => ({ players: new Set(), enemies: new Set(), npcs: new Set() });
    const at = (id, name, x, y, flags = {}) => ({ id, name, map_id: 'map_world', grid_x: x, grid_y: y, grid_z: 0, flags, ...sets() });
    const alley = at('__rg_alley__', 'Alley', 11, 41);
    const north = at('__rg_bn__', 'n tile', 11, 40, { is_building: true, building_name: 'North Block', entrance: 'south' });
    const east = at('__rg_be__', 'e tile', 12, 41, { is_building: true, building_name: 'East Block', entrance: 'east' });
    const west = at('__rg_bw__', 'w tile', 10, 41, { is_building: true, building_name: 'West Block', entrance: 'north' });
    const ground = at('__rg_ground__', 'Waste', 11, 42);
    const far = at('__rg_bf__', 'f tile', 9, 41, { is_building: true, building_name: 'Far Block', entrance: 'south' });
    // The same layout on a map that is not the world: a local frame, where a grid neighbour is not a wall.
    const local = { ...at('__rg_local__', 'Flat', 11, 41), map_id: '__rg_map__' };
    const localBld = { ...at('__rg_localb__', 'l tile', 12, 41, { is_building: true, building_name: 'Local Block' }), map_id: '__rg_map__' };
    const fakes = [alley, north, east, west, ground, far, local, localBld];
    for (const z of fakes) world.zones.set(z.id, z);
    clearTileIndex();   // the tile index is built once and lazily, so it has to be told about the fakes
    try {
      const ws = wallsNear(alley);
      const byId = (id) => ws.find(w => w.id === id);
      check('an alley with no exits finds the buildings on either side of it', ws.length === 3, JSON.stringify(ws));
      check('the wall facing the entrance is the front', byId(north.id)?.side === 'front', JSON.stringify(byId(north.id)));
      check('the wall opposite the entrance is the back', byId(east.id)?.side === 'back', JSON.stringify(byId(east.id)));
      check('any other wall is a side', byId(west.id)?.side === 'side', JSON.stringify(byId(west.id)));
      check('each wall carries the direction you face to see it',
        byId(north.id)?.dir === 'north' && byId(east.id)?.dir === 'east' && byId(west.id)?.dir === 'west', JSON.stringify(ws));
      check('open ground on the grid is not a wall', !byId(ground.id));
      check('a side wall is named as one', wallLabel(byId(west.id)) === 'the side of West Block', wallLabel(byId(west.id)));
      check('a front is named as the building, as it always was', wallLabel(byId(north.id)) === 'North Block');
      check('pickWall takes "side"', pickWall(ws, 'side')?.wall?.id === west.id);
      check('pickWall takes "back"', pickWall(ws, 'back')?.wall?.id === east.id);
      check('standing on a building, the one next door is a party wall and not sprayable', !wallsNear(west).some(w => w.id === far.id));
      check('a grid neighbour off the world map is not a wall', wallsNear(local).length === 0, JSON.stringify(wallsNear(local)));

      // One tag per WALL: two walls of one alley hold two tags, and the world's hand takes a bare
      // wall before it paints over somebody's.
      const one = await tagFromWorld(alley.id, 'ONE', 'nobody');
      const two = await tagFromWorld(alley.id, 'TWO', 'nobody');
      check('the world tags a bare wall rather than painting over one', one && two && one.targetZoneId !== two.targetZoneId,
        JSON.stringify([one?.targetZoneId, two?.targetZoneId]));
      check('two walls from one tile carry two tags', tagsAt(alley.id).length === 2, JSON.stringify(tagsAt(alley.id).map(t => t.text)));
      check('the first tag is still up after the second', tagOn(alley.id, one.targetZoneId)?.text === 'ONE');

      const three = await tagFromWorld(alley.id, 'THREE', 'nobody');
      check('a third tag takes the last bare wall', new Set([one, two, three].map(t => t?.targetZoneId)).size === 3);

      // The renderer gets the side wall's own normal: from the building out to the alley, +x.
      const westPaint = wallTags(west, west.grid_x, west.grid_y) || [];
      check('a side wall reaches the renderer facing the alley', westPaint.length === 1 && westPaint[0].n[0] === 1 && westPaint[0].n[1] === 0,
        JSON.stringify(westPaint));

      const room = await (await import('./index.js')).hooks['zone.describeRoom'](alley);
      check('the room line gives every wall its own line', (room || '').split('\n').length === 3, room);
      check('the room line says which wall of a building it is',
        /the side of West Block/.test(room || '') && /the back of East Block/.test(room || '') && /the front of North Block/.test(room || ''), room);

      await removeTag(alley.id, west.id);
      check('removeTag takes one wall and leaves the others', tagsAt(alley.id).length === 2 && !tagOn(alley.id, west.id));
      const gone = await removeTagsAt(alley.id);
      check('removeTagsAt takes every wall in reach', gone.length === 2 && tagsAt(alley.id).length === 0);
    } finally {
      await removeTagsAt(alley.id);
      for (const z of fakes) world.zones.delete(z.id);
      clearTileIndex();
    }
  }

  world.zones.delete(street.id);
  world.zones.delete(shop.id);
  world.zones.delete(field.id);
  world.zones.delete('__rg_room__');   // ⚠ and the interior — a leaked fake zone poisons every later suite
  tags.delete(street.id);
}
