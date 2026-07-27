// Laundry plugin regression suite — run by tests/regress.js (never in production).
// The harness player stands in an ordinary zone with no washing machine, which is
// the important case: the verb must fall THROUGH rather than claim the input.
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { hygieneOf, laundryFactor, markLaundered, checkImmaculate, checkFilthy,
  warmthMultiplier, npcWashAtHome, CLEAN_EFFECT, CLEAN_BAND, LAUNDRY_FLAG, WASH_FLAG }
  from '../../server/engine/hygiene.js';

export default async function regress({ run, check, getPlayer }) {
  // Discoverability: a machine has to advertise the verb, or it's invisible content.
  const reg = getRegisteredSpecializedActions().launder || [];
  check('launder is discoverable on washing_machine furniture',
    reg.some(e => e.requiredTag === 'washing_machine' && e.pluginName === 'laundry'),
    JSON.stringify(reg));

  // No machine here → the handler returns undefined and the dispatcher reports an
  // unknown command rather than the plugin inventing a refusal it can't justify.
  const r = await run('launder');
  check('launder with no machine falls through', r == null || r?.type === 'error', r?.message);

  // The two clocks are genuinely separate — this is the whole reason the building
  // exists, so it gets a test rather than a comment.
  {
    const now = Date.now();
    const p = { id: 'test', _flags: new Map([[WASH_FLAG, String(now)], [LAUNDRY_FLAG, String(now)]]) };
    check('freshly laundered reads zero', laundryFactor(p) === 0, String(laundryFactor(p)));

    // Two days in the same clothes registers; a shower would not have helped.
    p._flags.set(LAUNDRY_FLAG, String(now - 2 * 24 * 60 * 60 * 1000));
    check('two days unlaundered starts to tell', laundryFactor(p) > 0, String(laundryFactor(p)));
    check('dirty clothes drag the hygiene score down',
      hygieneOf(p).score < 100, String(hygieneOf(p).score));

    // A body wash does NOT reset the laundry clock.
    const before = laundryFactor(p);
    p._flags.set(WASH_FLAG, String(Date.now()));
    check('showering does not launder your clothes', laundryFactor(p) === before);
  }

  // The clean buff and its accolade hook: reaching immaculate has to be worth
  // something, or hygiene is a punishment with no opposite.
  {
    const now = Date.now();
    const p2 = { id: 'test2', statuses: [], _flags: new Map([[WASH_FLAG, String(now)], [LAUNDRY_FLAG, String(now)]]) };
    check('a spotless body reaches the clean band', hygieneOf(p2).score >= CLEAN_BAND, String(hygieneOf(p2).score));
    check('checkImmaculate applies the buff', checkImmaculate(p2) === true);
    check('the buff is the Cool one', (p2.statuses || []).some(s => s.name === CLEAN_EFFECT), JSON.stringify(p2.statuses));
    check('clean speeds up how fast people warm to you', warmthMultiplier(p2) > 1, String(warmthMultiplier(p2)));

    // Filth alone doesn't reach the bottom band — shit, vomit and blood together
    // only get you to ~27. The bottom is reserved for filth PLUS neglect: days
    // unwashed and longer unlaundered. That's deliberate, and it's why the
    // accolade means something.
    const filthy = { id: 'test3', clothing_contamination: { legs: 'feces', torso: 'vomit' }, covered_in_blood: 1,
      _flags: new Map([
        [WASH_FLAG, String(now - 3 * 24 * 60 * 60 * 1000)],
        [LAUNDRY_FLAG, String(now - 10 * 24 * 60 * 60 * 1000)],
      ]) };
    check('filth stops the buff', checkImmaculate(filthy) === false, String(hygieneOf(filthy).score));
    check('filth slows how fast people warm to you', warmthMultiplier(filthy) < 1, String(warmthMultiplier(filthy)));
    check('checkFilthy latches once', checkFilthy(filthy) === true && checkFilthy(filthy) === false);
  }

  // NPCs wash when they get home — without it every NPC eventually reeks, because
  // their grime clock starts when something first asks and never resets.
  {
    const npc = { id: 'n1', clothing_contamination: { torso: 'blood' }, covered_in_blood: 1, _sweat: 80 };
    check('an NPC washes on arriving home', npcWashAtHome(npc) === true);
    check('washing clears what was on them',
      !npc.covered_in_blood && !Object.keys(npc.clothing_contamination).length && !npc._sweat);
    check('and does not re-wash every tick', npcWashAtHome(npc) === false);
  }

  // Laundering with no id is a no-op rather than a throw (defensive: the flag
  // write is the only DB touch in the plugin).
  await markLaundered({});
  check('markLaundered tolerates a player with no id', true);
}
