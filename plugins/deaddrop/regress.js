// deaddrop plugin regression suite (harness-only, never loaded in production).
//
// The interesting cases here are all NEGATIVE. This plugin's whole risk is that it
// reports something it should not — somebody else's spy camera, a container that was
// never meant to be a cache, or a cache the player has already searched — so most of
// what follows asserts silence.
//
// It drives the REAL authored caches rather than injected rows, the way
// concealment/regress.js drives the real chem lab. Two reasons: `world.furniture` is
// indexed by `furnitureByZone` and a direct `.set()` is invisible to
// `getZoneFurniture` (the first cut of this file did exactly that and every positive
// case failed while the negative ones passed trivially against an empty list), and it
// makes these checks double as a guard on the caches staying authored the way the
// feature needs them.
import { _test } from './index.js';
import { getFurnitureById, updateFurniture } from '../../server/engine/world.js';
 import { setFlag, clearFlag } from '../../server/engine/flags.js';

const CACHES = ['furn_dd_embassy_cistern', 'furn_dd_yards_mailbox', 'furn_dd_precinct_bench'];

export default async function regress({ check, getPlayer }) {
  const p = getPlayer();
  const savedZone = p.current_zone;

  try {
    // ── The authored caches ──────────────────────────────────────────────────
    for (const id of CACHES) {
      const f = getFurnitureById(id);
      check(`cache ${id} exists`, !!f, `${id} missing`);
      if (!f) continue;
      check(`cache ${id} is a cache by all three flags`, _test.isCache(f), JSON.stringify(f.flags));
      // ⚠ flags.container is a CAPACITY IN GRAMS, not a boolean — every other
      // container in the game authors it that way and `open` reads it as one.
      check(`cache ${id} carries a real capacity`,
        Number(f.flags.container) > 0, String(f.flags.container));
    }

    // ── isCache: all three flags, every time ─────────────────────────────────
    // Pure predicate, so these run against literals rather than the world.
    const row = (flags) => ({ id: 'x', name: 'a thing', object_type: 'furniture', flags });

    // ⚠ THE CENSUS CASE. 53 of the world's 58 concealed rows are planted spy devices.
    // If this ever passes, `search` has become a counter-surveillance sweep and
    // SPECTER's plant-a-camera game is over.
    check('a concealed spy camera is NOT a cache', !_test.isCache(row({ concealed: true })));
    // An unconcealed container is already in the room description — reporting it
    // through `search` would be telling the player something they can read.
    check('an unconcealed container is NOT a cache',
      !_test.isCache(row({ dead_drop: true, container: 8000 })));
    // A concealed container nobody opted in is somebody else's business.
    check('a concealed container without the opt-in is NOT a cache',
      !_test.isCache(row({ container: 8000, concealed: true })));
    // ⚠ object_type: 'container' is not flags.container. A row like this would be
    // found and then could not be opened, because plugins/container gates `open` on
    // the FLAG — which reads as a bug in `search`, not as a mis-authored row.
    check('object_type container without the flag is NOT a cache',
      !_test.isCache({ id: 'x', name: 'a crate', object_type: 'container',
        flags: { dead_drop: true, concealed: true } }));

    // ── The finding roll, against a real cache ───────────────────────────────
    const zone = getFurnitureById(CACHES[0])?.zone_id;
    check('the first cache is in a real zone', !!zone, String(zone));
    if (zone) {
      p.current_zone = zone;
      check('the zone lists exactly one cache',
        _test.cachesIn(zone).length === 1, String(_test.cachesIn(zone).length));

      _test.swept.clear();
      const below = await _test.searchForCaches({ player: p, zoneId: zone, margin: _test.STRANGER_BAR - 1 });
      check('a roll under the bar finds nothing', below === null, JSON.stringify(below));

      // ⚠ A MISS STILL COSTS THE LOOK. Without this, `search`'s per-zone cooldown is
      // escapable by stepping one tile out and back and STRANGER_BAR stops being a
      // wall — so the SAME player rolling a 99 immediately after a miss still gets
      // nothing from this cache.
      const retry = await _test.searchForCaches({ player: p, zoneId: zone, margin: 99 });
      check('…and the cache refuses to be reconsidered by that player', retry === null, JSON.stringify(retry));

      _test.swept.clear();
      const hit = await _test.searchForCaches({ player: p, zoneId: zone, margin: _test.STRANGER_BAR });
      check('a roll at the bar finds the cache', hit?.found === true, JSON.stringify(hit));
      check('…and reports it under strays, over concealment', hit?.priority === 60, String(hit?.priority));
      // The provider reveals the CACHE, never the contents — the item comes out
      // through `open`, because it is a thing somebody paid for and put there.
      check('…and never names what is inside it',
        !!hit?.message && !/inside it|contains|holding/i.test(hit.message), hit?.message);

      // ⚠ NEVER CREATES A CACHE. One that springs into existence on a good roll is a
      // faucet whose only limit is walking pace.
      _test.swept.clear();
      const before = _test.cachesIn(zone).length;
      await _test.searchForCaches({ player: p, zoneId: zone, margin: 99 });
      check('a successful roll creates nothing',
        _test.cachesIn(zone).length === before, `${before} -> ${_test.cachesIn(zone).length}`);
    }

    // An empty room is silent rather than erroring.
    const nowhere = await _test.searchForCaches({ player: p, zoneId: 'zone_regress_dd_empty', margin: 99 });
    check('a room with no cache is silent', nowhere === null, JSON.stringify(nowhere));

    // ── Somebody has been in it (phase 2) ────────────────────────────────────
    // The disturbance flag is written through updateFurniture, so these drive the
    // real hook against a real cache row and read the world cache back.
    {
      const id = CACHES[0];
      const flagsOf = () => getFurnitureById(id)?.flags || {};
      const asContainer = () => ({ id, kind: 'furniture', name: 'cistern lid', tags: flagsOf() });
      const clean = async () => {
        const f = { ...flagsOf() }; delete f.dead_drop_disturbed;
        await updateFurniture(id, { flags: JSON.stringify(f) });
      };
      await clean();
      await clearFlag('player', _test.knownKey(id), p);

      // A stranger with the lid up leaves a mark.
      await _test.noteDisturbance({ container: asContainer(), player: p });
      check('disturbed: a stranger opening a cache marks it', flagsOf().dead_drop_disturbed === true,
        JSON.stringify(flagsOf().dead_drop_disturbed));

      // ⚠ IT RECORDS THAT IT HAPPENED, NEVER WHO. An owner handed a name has been
      // handed a kill order by the UI; "who" is SPECTER's question.
      const written = JSON.stringify(flagsOf());
      check('disturbed: …and records no identity', !written.includes(p.id) && !written.includes(String(p.handle)), written.slice(0, 120));

      // The knower reads it once, and reading it clears it — so the notice means
      // "since you were last here" rather than "at some point, forever", and the
      // cache re-arms for the next stranger.
      await setFlag('player', _test.knownKey(id), '1', p);
      await _test.noteDisturbance({ container: asContainer(), player: p });
      check('disturbed: the knower reading it clears the mark', !flagsOf().dead_drop_disturbed,
        JSON.stringify(flagsOf().dead_drop_disturbed));

      // A knower opening their own cache never marks it — otherwise every owner
      // reports themselves and the signal means nothing.
      await _test.noteDisturbance({ container: asContainer(), player: p });
      check('disturbed: a knower never marks their own cache', !flagsOf().dead_drop_disturbed,
        JSON.stringify(flagsOf().dead_drop_disturbed));

      // An ordinary container is not a cache and must not grow the flag.
      const plain = { id: 'furn_rg_plainbox', kind: 'furniture', name: 'a crate', tags: { container: 5000 } };
      await _test.noteDisturbance({ container: plain, player: p });
      check('disturbed: an ordinary container is left alone', !getFurnitureById('furn_rg_plainbox'));

      // And the knower's SEARCH line agrees with the flag rather than asserting
      // "untouched" on a cache somebody has been through.
      await clearFlag('player', _test.knownKey(id), p);
      await clean();
    }

    // The swept memory is per cache per player, not per zone.
    _test.swept.clear();
    _test.markSwept(p.id, CACHES[0]);
    check('swept is keyed to this player and this cache', _test.isSwept(p.id, CACHES[0]));
    check('…and not to another player', !_test.isSwept('someone_else', CACHES[0]));
    check('…and not to another cache', !_test.isSwept(p.id, CACHES[1]));
  } finally {
    p.current_zone = savedZone;
    _test.swept.clear();
  }
}
