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
import { _test, TAG_MAX_LEN, TAG_LIFE_DAYS, tagAt, removeTag } from './index.js';
import { normalizeRuns, coalesceRuns, renderStyled, decodePayload, safeColor, escapedChars } from './paint.js';
import { world } from '../../server/engine/world.js';
import { gameDayIndex } from '../../server/engine/zone-filth.js';

export default async function regress({ run, check }) {
  const { wallsNear, pickWall, expired, esc, tags } = _test;

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

  // --- tagAt reads through expiry, and never queries -------------------------
  // The date is passed explicitly rather than left to the live game clock: the
  // harness boots the world without the environment, so gameToday() is null there
  // — which is exactly the fail-safe (an unknown clock expires nothing), and would
  // make an implicit-clock assertion here test nothing at all.
  const nowIdx = idx;
  tags.set(street.id, { text: 'TEST', targetName: 'Bodega Vu', authorId: 'p1', authorHandle: 'ZERO', dayIndex: nowIdx });
  check('tagAt returns a live tag', tagAt(street.id, today)?.text === 'TEST');
  tags.set(street.id, { text: 'OLD', targetName: 'Bodega Vu', dayIndex: nowIdx - 99 });
  check('tagAt hides an expired tag without deleting it', tagAt(street.id, today) === null && tags.has(street.id));
  check('tagAt with no clock keeps the tag up rather than erasing it', tagAt(street.id, null)?.text === 'OLD');
  check('tagAt on an untagged tile is null', tagAt('__rg_field__') === null);
  check('tagAt on an unknown zone is null', tagAt('__no_such_zone__') === null);

  // --- The room line --------------------------------------------------------
  tags.set(street.id, { text: 'NO GODS NO LANDLORDS', targetName: 'Bodega Vu', dayIndex: nowIdx });
  const line = await (await import('./index.js')).hooks['zone.describeRoom'](street);
  check('the room line names the building it is sprayed on', /Bodega Vu/.test(line || ''), line);
  check('the room line carries the tag text', /NO GODS NO LANDLORDS/.test(line || ''), line);
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

  // --- The room line, painted ------------------------------------------------
  tags.set(street.id, {
    text: esc('NO GODS'), style: [{ n: 2, c: '#ff2d55', f: 1 }, { n: 5, c: null, f: 0 }],
    targetName: 'Bodega Vu', dayIndex: nowIdx,
  });
  const painted = await (await import('./index.js')).hooks['zone.describeRoom'](street);
  check('a painted tag carries its colour into the room line', painted.includes('#ff2d55'), painted);
  check('a painted tag still names the building', /Bodega Vu/.test(painted));
  check('a painted tag drops the blanket bold — the paint decides the weight now',
    !/: <b>/.test(painted), painted);

  // --- The verbs the dialog talks to ----------------------------------------
  for (const verb of ['spraycan', 'sprayapply', 'spraysave', 'spraydel']) {
    const res = await run(verb);
    check(`${verb} is routed`, res?.type !== undefined, `${verb}: ${JSON.stringify(res)}`);
  }

  await removeTag(street.id);
  check('removeTag clears the wall', tagAt(street.id) === null);

  world.zones.delete(street.id);
  world.zones.delete(shop.id);
  world.zones.delete(field.id);
  tags.delete(street.id);
}
