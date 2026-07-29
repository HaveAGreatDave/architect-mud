// Wardrobe plugin regression suite — run by tests/regress.js (never loaded in production).
//
// The fake player stands in no wardrobe and has no `players` row, so nothing can
// actually be saved here. What's worth guarding is the stuff that rots silently:
// that the verbs route at all, that `outfit` degrades to a clear message instead
// of a stack trace when there's no wardrobe in the room, that the panel's by-id
// verbs refuse a furniture id that isn't a wardrobe in reach (they take
// client-supplied ids), and that the container.view hook leaves an ordinary box
// completely untouched — a bug there would retype every fridge in the game.
import { _test } from './index.js';

export default async function regress({ run, check }) {
  let r = await run('outfit');
  check('outfit verb routed', r?.type !== undefined, JSON.stringify(r));
  check('outfit with no wardrobe says so', /no wardrobe here/i.test(r?.message || ''), r?.message);

  r = await run('outfit save work');
  check('outfit save with no wardrobe is refused', r?.type === 'error', r?.message);

  // The three panel verbs take a furniture id straight off the wire. An id that
  // isn't a wardrobe in this room must not resolve — otherwise the panel could
  // be pointed at someone else's closet.
  for (const verb of ['outfitsetid', 'outfitwearid', 'outfitwearnowid', 'outfitdelid', 'undressid', 'hangwornid', 'takeoffid']) {
    const res = await run(`${verb} furn_not_a_wardrobe thing`);
    check(`${verb} rejects a non-wardrobe id`,
      res?.type === 'container_error', JSON.stringify(res));
  }

  // `hangwornid` takes a client-supplied inventory row and unequips it, so the
  // wardrobe gate has to come FIRST — before the row is touched at all. With a
  // bogus furniture id it must fail on the wardrobe, whether or not a row follows.
  check('hangwornid gates on the wardrobe before the row',
    (await run('hangwornid furn_not_a_wardrobe'))?.type === 'container_error');

  // Outfits capture clothing + accessories but never the wielded weapon —
  // changing clothes must not disarm you.
  check('outfit slots exclude the weapon hand', !_test.OUTFIT_SLOTS.includes('weapon_hand'),
    _test.OUTFIT_SLOTS.join(','));
  check('outfit slots include accessories', _test.OUTFIT_SLOTS.includes('accessory'));

  // The hook is fired for EVERY container view. A plain box must come back
  // byte-identical, or fridges start opening the wardrobe panel.
  const plain = { type: 'container_view', containerItems: [], invItems: [] };
  await _test.decorateView({
    view: plain,
    container: { id: 'furn_fridge', kind: 'furniture', tags: { container: 70000, preserves: 'refrigerated' } },
    player: { id: 'nobody' },
  });
  check('container.view leaves a non-wardrobe box alone',
    plain.type === 'container_view' && plain.outfits === undefined, JSON.stringify(plain));

  // An item container can never be a wardrobe (the flag is furniture-scoped).
  const carried = { type: 'container_view', containerItems: [], invItems: [] };
  await _test.decorateView({
    view: carried,
    container: { id: 'row1', kind: 'item', tags: { container: 5000, wardrobe: true } },
    player: { id: 'nobody' },
  });
  check('a carried bag is never retyped as a wardrobe', carried.type === 'container_view');

  // The verb lesson fires once per character, from whichever of examine/open
  // comes first. Non-wardrobe furniture must never trigger it — `furniture.describe`
  // fires for every examined object in the game.
  check('examining a non-wardrobe teaches nothing',
    (await _test.onFurnitureDescribe({ name: 'fridge', flags: { container: 70000 } }, { id: 'nobody' })) === undefined);
  // Pre-seed the already-taught set so this asserts the guard without a DB write
  // against the fake player.
  _test.taught.add('already_dressed');
  check('a player who has had the lesson never gets it twice',
    (await _test.onFurnitureDescribe({ name: 'wardrobe', flags: { wardrobe: true } }, { id: 'already_dressed' })) === undefined);

  // Availability marking is what tells the player an outfit won't assemble.
  const described = _test.describeOutfit(
    { name: 'work', item_ids: ['item_missing_thing'] }, new Set()
  );
  check('an unreachable piece is marked unavailable', described.items[0].available === false);
  check('an outfit with an unreachable piece is not wearable', described.wearable === false);

  // A piece you're WEARING is reachable — the bug this fixes had a just-saved
  // outfit render every item missing while the player had the clothes on.
  const onBody = _test.describeOutfit(
    { name: 'work', item_ids: ['item_worn_jacket'] }, new Set(['item_worn_jacket'])
  );
  check('a piece already on your body counts as available', onBody.items[0].available === true);
  check('an outfit made of what you are wearing is wearable', onBody.wearable === true);

  // `dress` / `undress <wardrobe>` route and degrade politely with no wardrobe in
  // the room. `undress` is the load-bearing one: the plugin OVERRIDES the engine
  // builtin, so a regression here silently breaks the plain verb for every player.
  r = await run('dress');
  check('dress verb routed', r?.type !== undefined, JSON.stringify(r));
  check('dress with no wardrobe says so', /no wardrobe here/i.test(r?.message || ''), r?.message);

  r = await run('dress something');
  check('dress <name> with no wardrobe is refused', r?.type === 'error', r?.message);

  // Untargeted undress must still reach the ENGINE's bulk strip, not the plugin's
  // wardrobe path — this asserts the delegation, which is the whole risk of the
  // override. The fake player wears nothing, so the engine's own empty-case answers.
  r = await run('undress');
  check('bare undress still delegates to the engine strip',
    /not wearing anything/i.test(r?.message || ''), JSON.stringify(r));

  // A garbage target is not an error — it falls back to the plain strip rather
  // than punishing someone who typed `undress quickly`.
  r = await run('undress nonsensewordhere');
  check('undress with an unmatched target falls back to the plain strip',
    /not wearing anything/i.test(r?.message || ''), JSON.stringify(r));

  r = await run('undressid furn_not_a_wardrobe');
  check('undressid rejects a non-wardrobe id', r?.type === 'container_error', JSON.stringify(r));

  // undressInto is the inverse of an outfit, so it must cover exactly what an
  // outfit covers — body AND accessories, never the weapon hand.
  check('undress-into-wardrobe covers accessories like an outfit',
    _test.OUTFIT_SLOTS.includes('accessory') && !_test.OUTFIT_SLOTS.includes('weapon_hand'));
}
