// Laundry plugin regression suite — run by tests/regress.js (never in production).
// The harness player stands in an ordinary zone with no washing machine, which is
// the important case: the verb must fall THROUGH rather than claim the input.
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { _test } from './index.js';
import { hygieneOf, laundryFactor, lastLaunderedAt, lastWashedAt, markLaundered,
  checkImmaculate, checkFilthy, warmthMultiplier, npcWashAtHome, CLEAN_EFFECT,
  CLEAN_BAND, LAUNDRY_FLAG, WASH_FLAG } from '../../server/engine/hygiene.js';

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

    // A body wash does NOT reset the laundry clock. Assert that on the CLOCK, not on
    // laundryFactor's return value: the factor ramps off Date.now(), so comparing two
    // calls with `===` fails the moment a millisecond passes between them — which is a
    // coin flip on CI and always won locally. The clock is the thing under test anyway.
    const before = lastLaunderedAt(p);
    p._flags.set(WASH_FLAG, String(Date.now()));
    check('showering does not launder your clothes', lastLaunderedAt(p) === before,
      `${lastLaunderedAt(p)} vs ${before}`);
    check('showering does still wash the body', lastWashedAt(p) > before);
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

  // ── A machine is a place, not a capability ─────────────────────────────────
  //
  // The claim map is module state shared with the live plugin, so EVERY case
  // below clears what it set. A leaked claim doesn't fail here — it fails in
  // whatever suite next looks at The Wash, which is the kind of red that costs
  // an afternoon.
  const { busy, pickMachine, onFurnitureOccupants, onFurnitureDescribe, DEFAULT_CYCLE_MS } = _test;

  check('a cycle is two minutes', DEFAULT_CYCLE_MS === 120000, String(DEFAULT_CYCLE_MS));

  // No machine here → 'none', which is what makes the verb fall through rather
  // than claim the input. Same fact as the `run('launder')` case above, one layer
  // down, where the reason is visible.
  const p = getPlayer();
  check('a room with no machine resolves to none',
    pickMachine(p.current_zone).kind === 'none', pickMachine(p.current_zone).kind);

  const machines = getZoneFurniture('zone_the_wash').filter(f => f.flags?.washing_machine);
  check('The Wash has four separate machines', machines.length === 4,
    `${machines.length}: ${machines.map(m => m.name).join(', ')}`);

  if (machines.length >= 2) {
    const [one, two] = machines;
    busy.clear();
    try {
      // Nothing running: any of them will do.
      check('an empty laundromat hands you a machine', pickMachine('zone_the_wash').kind === 'ok');

      busy.set(one.id, { playerId: 'someone-else', handle: 'Marla', zoneId: 'zone_the_wash', until: Date.now() + 60000 });

      // ⚠ The whole point of the match-count rule. Naming ONE machine means that
      // drum and earns a refusal; a word that fits them all means "a free one".
      const named = pickMachine('zone_the_wash', one.name);
      check('naming a running machine refuses it', named.kind === 'busy', named.kind);
      check('and says whose it is', named.claim?.handle === 'Marla', named.claim?.handle);
      const generic = pickMachine('zone_the_wash', 'washer');
      check('a word that fits them all skips the busy one',
        generic.kind === 'ok' && generic.machine.id !== one.id, `${generic.kind} ${generic.machine?.name}`);
      check('an unnamed pick skips the busy one too',
        pickMachine('zone_the_wash').machine?.id !== one.id);
      check('a name that is nothing here is refused, not silently substituted',
        pickMachine('zone_the_wash', 'tumble dryer').kind === 'unknown');
      // The machines are named with digits so the room pane sorts them 1-2-3-4,
      // but nobody types a machine that way.
      const spelled = pickMachine('zone_the_wash', 'three');
      check('a spelled-out number reaches the machine it names',
        spelled.machine?.name === machines.find(m => /\b3\b/.test(m.name))?.name,
        `${spelled.kind} ${spelled.machine?.name}`);

      // The room says it, and the plugin writes none of that prose itself.
      const occ = onFurnitureOccupants({ id: 'zone_the_wash' }, p);
      check('a running machine reports as occupied', occ?.[one.id] === 'Marla', JSON.stringify(occ));
      check('and only that one', Object.keys(occ || {}).length === 1, JSON.stringify(occ));
      const mine = onFurnitureOccupants({ id: 'zone_the_wash' }, { id: 'someone-else' });
      check('your own wash reads as yours', mine?.[one.id] === 'you', JSON.stringify(mine));

      // furniture.describe is a fireHook — an idle machine MUST stay quiet or it
      // eats the appliances plugin's unplugged note.
      check('an idle machine adds nothing on examine', onFurnitureDescribe(two, p) === undefined);
      check('a running one says how long is left', /left/.test(onFurnitureDescribe(one, p) || ''));

      // Every drum going round is a wait, not a fifth machine appearing.
      const now = Date.now();
      for (const m of machines) busy.set(m.id, { playerId: 'x', handle: 'X', zoneId: 'zone_the_wash', until: now + 60000 });
      check('a full laundromat is a wait', pickMachine('zone_the_wash').kind === 'all-busy');

      // A claim decays by its own timestamp, never by a tick — which is why the
      // plugin owns no scheduler and a restart forgetting everything is safe.
      for (const m of machines) busy.set(m.id, { playerId: 'x', handle: 'X', zoneId: 'zone_the_wash', until: now - 1 });
      check('an expired claim frees the machine', pickMachine('zone_the_wash').kind === 'ok');
      check('and is swept out of the map rather than left to accumulate', busy.size < machines.length,
        String(busy.size));
    } finally {
      busy.clear();
    }
  }
}
