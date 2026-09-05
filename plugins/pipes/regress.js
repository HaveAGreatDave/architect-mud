// Pipes plugin regression — drives the real `hookah`/`pack`/`puff` verbs against
// a throwaway hookah, with no socket and no client.
//
// What this is actually guarding:
//  - hose capacity is real, and is counted off the map rather than a stored
//    number that could drift from who is holding one
//  - a hose does not outlive the room or the sitting (the leak that would leave
//    somebody puffing on furniture two zones away)
//  - the bowl is SHARED: a second person on a hose draws down the same charges,
//    which is the entire reason the furniture exists
//  - packing refuses rather than overwrites a live bowl
//  - only smokeable drugs go in a bowl, and the DRUG ROW decides that, not a
//    list in the plugin
import { insertFurniture, deleteFurniture, world } from '../../server/engine/world.js';
import { getDrugCache } from '../../server/engine/drugs.js';
import { commands, _internals } from './index.js';

export default async function regress({ check }) {
  const Z = 'zone_pipes_regress';
  const EMPTY = 'zone_pipes_regress_empty';
  const FURN = 'furn_pipes_regress';
  const PID = `pipes_regress_${process.pid}`;
  const PID2 = `pipes_regress_b_${process.pid}`;
  const noop = () => {};
  const { hoses, bowls, hoseCount, holdersOf, smokeableDrugFor, HOOKAH_CHARGES } = _internals;

  const run = (fn, input, p) => fn(input.split(/\s+/).filter(Boolean).slice(1), input, p, noop);

  const player = { id: PID, handle: 'Smoker', current_zone: EMPTY, posture: 'standing' };
  const other  = { id: PID2, handle: 'Guest',  current_zone: Z,     posture: 'standing' };
  world.players.set(PID, player);
  world.players.set(PID2, other);

  try {
    await insertFurniture({
      id: FURN, name: 'brass hookah', description: 'a test hookah', object_type: 'furniture',
      zone_id: Z, flags: JSON.stringify({ hookah: 2, interactions: ['examine'] }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    // Nothing to take hold of in an empty room.
    let r = await run(commands.hookah, 'hookah', player);
    check('hookah with none present errors cleanly', r?.type === 'error', JSON.stringify(r));
    check('...and hands out no hose', !hoses.has(PID));

    // Take a hose.
    player.current_zone = Z;
    r = await run(commands.hookah, 'hookah', player);
    check('hookah hands out a hose', r?.type === 'output' && hoses.has(PID), JSON.stringify(r));
    check('...and seats the player on it', player.posture === 'sitting' && player.sittingOn === FURN,
      `${player.posture}/${player.sittingOn}`);

    // Capacity is the authored hose count, and it is counted off the live map.
    check('hose count reads the authored flag', hoseCount({ flags: { hookah: 2 } }) === 2);
    check('...and defaults rather than throwing on junk', hoseCount({ flags: { hookah: 'lots' } }) === 4);
    check('holders are counted off the map', holdersOf(FURN) === 1, String(holdersOf(FURN)));

    await run(commands.hookah, 'hookah', other);
    check('a second hose is available on a 2-hose pipe', hoses.has(PID2));
    // Third person, no hose left.
    const third = { id: `${PID}_c`, handle: 'Latecomer', current_zone: Z, posture: 'standing' };
    world.players.set(third.id, third);
    r = await run(commands.hookah, 'hookah', third);
    check('a full hookah refuses a third hose', r?.type === 'error', JSON.stringify(r));
    check("...and doesn't seat them", !hoses.has(third.id));
    world.players.delete(third.id);

    // Puffing an empty bowl is refused, not silently free.
    r = await run(commands.puff, 'puff', player);
    check('puffing an empty bowl errors', r?.type === 'error', JSON.stringify(r));

    // The SHARED bowl. Packing goes through inventory, which the fake player has
    // none of, so the sharing itself is asserted against the bowl directly —
    // this is the property that matters and it is the one the map holds.
    bowls.set(FURN, { drugId: 'drug_opium', drugName: 'opium', charges: HOOKAH_CHARGES, packedBy: PID });
    const before = bowls.get(FURN).charges;
    await run(commands.puff, 'puff', player).catch(() => {});
    const afterFirst = bowls.get(FURN)?.charges;
    check('a pull spends a charge', afterFirst === before - 1, `${before} -> ${afterFirst}`);
    await run(commands.puff, 'puff', other).catch(() => {});
    const afterSecond = bowls.get(FURN)?.charges;
    check('a SECOND smoker draws down the SAME bowl', afterSecond === before - 2, `${before} -> ${afterSecond}`);

    // Packing a bowl that is still going is refused rather than tipped out.
    r = await run(commands.pack, 'pack opium', player);
    check('packing a live bowl is refused', r?.type === 'error', JSON.stringify(r));

    // Only smokeables burn in a bowl, and the drug row is what says so.
    const cache = getDrugCache();
    const smokeable = Object.values(cache).find(d => d.flags?.smokeable && d.item_id);
    if (smokeable) {
      check('a smokeable drug row is packable', !!smokeableDrugFor({ item_id: smokeable.item_id }), smokeable.id);
    }
    const injectOnly = Object.values(cache).find(d => d.item_id && !d.flags?.smokeable && !d.flags?.cannabis);
    if (injectOnly) {
      check("a non-smokeable drug row isn't packable",
        smokeableDrugFor({ item_id: injectOnly.item_id }) === null, injectOnly.id);
    }
    check("a non-drug row isn't packable", smokeableDrugFor({ item_id: 'item_rusty_pipe' }) === null);

    // Opium itself must be authored so the smoke route actually applies. The
    // route requires the flag, so an opium row without it degrades to neutral
    // silently — which would look exactly like it working.
    const opium = cache.drug_opium;
    check('drug_opium exists', !!opium);
    if (opium) {
      check('...and is smokeable, or the smoke route silently degrades', !!opium.flags?.smokeable);
      check('...and is a depressant, so it shares the polydrug ceiling with booze',
        opium.flags?.drug_class === 'depressant', String(opium.flags?.drug_class));
      check('...and overdoses less readily than blacktar',
        Number(opium.overdose_threshold) > Number(cache.drug_blacktar?.overdose_threshold ?? 2),
        `${opium.overdose_threshold} vs ${cache.drug_blacktar?.overdose_threshold}`);
      check('...while still being properly addictive',
        Number(opium.addiction_chance) >= 0.5, String(opium.addiction_chance));
    }

    // Walking out lets go of the hose. This is the leak that would otherwise
    // leave somebody drawing on furniture in another zone.
    player.current_zone = EMPTY;
    const { emit } = await import('../../server/engine/events.js');
    emit('zone.entered', { player });
    check('leaving the room lets the hose go', !hoses.has(PID));

    // ...and so does standing up by any other route, since posture is a
    // substrate plenty of things force.
    emit('posture.changed', { player: other, to: 'standing' });
    check('being stood up lets the hose go', !hoses.has(PID2));
  } finally {
    hoses.delete(PID);
    hoses.delete(PID2);
    bowls.delete(FURN);
    world.players.delete(PID);
    world.players.delete(PID2);
    await deleteFurniture(FURN).catch(() => {});
  }
}
