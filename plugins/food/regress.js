// Food plugin regression — the consume-verb split.
//
// `consumable` is the tag the effect/payout path keys on, not a statement that a
// thing is edible: a bandage, a hand warmer and a credit chip all carry it for
// the same reason a ration does. This suite pins the derivation that decides
// which of eat/drink/use an item is actually taken by, and the refusal that
// stops the other two — the whole reason gauze stopped offering an Eat button.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { hasTag } from '../../server/engine/tags.js';
import { getItemCache } from '../../server/engine/items-cache.js';
import { consumeVerb, itemVerbs } from '../../server/engine/itemActions.js';

// Tags that mean the thing is put on a body or spent, never swallowed. Kept as a
// literal list rather than imported, so a change to APPLIED_TAGS has to be made
// twice on purpose instead of silently agreeing with itself.
const NEVER_EATEN = ['treat_injury', 'treat_frostbite', 'warming', 'currency'];

export default async ({ run, check, getPlayer }) => {
  const player = getPlayer();
  const items = [...getItemCache().values()];
  const consumables = items.filter(i => hasTag(i, 'consumable'));

  check('the world actually has consumables to classify', consumables.length > 50, `${consumables.length}`);

  // The invariant the whole change exists for. Not a spot-check on the bandage:
  // every dressing, splint, poultice and warmer in the catalogue, whatever else
  // it happens to restore.
  const eatenApplied = consumables.filter(i => NEVER_EATEN.some(t => hasTag(i, t)) && consumeVerb(i) !== 'use');
  check('nothing applied to a body is eaten or drunk', eatenApplied.length === 0,
    eatenApplied.map(i => `${i.id}→${consumeVerb(i)}`).join(', '));

  // …and the same claim from the display side, which is a separate code path:
  // the item menu, the smart bar and `examine` all read this list.
  const advertised = consumables.filter(i => NEVER_EATEN.some(t => hasTag(i, t)))
    .filter(i => { const v = itemVerbs(i); return v.includes('eat') || v.includes('drink'); });
  check('…and none of them advertises Eat or Drink', advertised.length === 0,
    advertised.map(i => i.id).join(', '));

  // Every consumable resolves to exactly one of the three verbs, and offers it.
  const stray = consumables.filter(i => !['eat', 'drink', 'use'].includes(consumeVerb(i)));
  check('every consumable lands on one of eat/drink/use', stray.length === 0, stray.map(i => i.id).join(', '));
  const unoffered = consumables.filter(i => !itemVerbs(i).includes(consumeVerb(i)));
  check('…and every one advertises the verb it is taken by', unoffered.length === 0,
    unoffered.map(i => i.id).join(', '));

  // Food is still food — the failure mode of over-tightening this would be a
  // ration you can no longer eat, which no other case here would catch.
  const named = (id) => getItemCache().get(id);
  const cases = [
    ['item_ration', 'eat'], ['item_beef_jerky', 'eat'], ['item_grey_loaf', 'eat'],
    ['item_water_bottle', 'drink'], ['item_energy_drink', 'drink'],
    ['item_bandage', 'use'], ['item_medkit', 'use'], ['item_hand_warmers', 'use'],
  ];
  for (const [id, want] of cases) {
    const it = named(id);
    if (!it) { check(`${id} exists to be classified`, false, 'missing from the item cache'); continue; }
    check(`${it.name} is taken by ${want}`, consumeVerb(it) === want, consumeVerb(it));
  }


  // The refusal, end to end — the half a derivation test cannot reach. `eat` gets
  // here down two separate paths (this plugin's specialized action and the engine
  // builtin behind it), so the gate lives in cmdUse where both of them land.
  const made = [];
  try {
    const bandId = randomUUID(), rationId = randomUUID();
    made.push(bandId, rationId);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [bandId, player.id, 'item_bandage']);
    await query(`INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,1,1.0)`, [rationId, player.id, 'item_ration']);

    let r = await run('eat bandage');
    check('eat refuses a bandage', r.type === 'error' && /Try/.test(r.message || ''), `${r.type}: ${r.message}`);
    check('…and says which verb to use instead', /use/.test(r.message || ''), r.message);

    // The bandage is still there — a refusal must not spend the item.
    const { rows } = await query(`SELECT id FROM player_inventory WHERE id=$1`, [bandId]);
    check('…and the refused bandage is not consumed', rows.length === 1, `${rows.length} row(s)`);

    // `use` is the generic route and is never refused.
    r = await run('use bandage');
    check('use is never refused by the verb gate', !/Try <span/.test(r.message || ''), `${r.type}: ${r.message}`);

    // The over-tightening failure: a ration you can no longer eat.
    r = await run('eat ration');
    check('eat still works on food', !/Try <span/.test(r.message || ''), `${r.type}: ${r.message}`);
  } finally {
    for (const id of made) await query(`DELETE FROM player_inventory WHERE id=$1`, [id]).catch(() => {});
  }
};
