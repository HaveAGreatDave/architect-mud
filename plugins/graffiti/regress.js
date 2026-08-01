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
import { _test, TAG_MAX_LEN, TAG_LIFE_DAYS, tagAt, removeTag } from './index.js';
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

  await removeTag(street.id);
  check('removeTag clears the wall', tagAt(street.id) === null);

  world.zones.delete(street.id);
  world.zones.delete(shop.id);
  world.zones.delete(field.id);
  tags.delete(street.id);
}
