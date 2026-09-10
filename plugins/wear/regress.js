// Wear/durability regression suite — run by tests/regress.js (never loaded in production).
import {
  wears, wearableCategory, isRepairable, durabilityOf, conditionBand, conditionPenalty,
  wear, effectiveCondition, WEAR_EVENTS, conditionLine, reinforcementOf, REINFORCE_MAX,
  fatigueOf, breakChanceOf,
} from '../../server/engine/durability.js';
import { _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();

  const weapon  = { tags: { weapon: true }, value: 100, name: 'pipe' };
  const jacket  = { tags: { slot: 'torso' }, value: 40, name: 'jacket' };
  const armour  = { tags: { armor_soak: { kinetic: 3 }, slot: 'torso' }, value: 200, name: 'vest' };
  const rod     = { tags: { fishing_rod: true }, value: 30, name: 'rod' };
  const beer    = { tags: { consumable: true }, value: 12, name: 'beer' };
  const cognac  = { tags: { consumable: true, drug: true }, value: 900, name: 'cognac' };

  // ── What wears is DERIVED, not authored ──
  check('a weapon wears', wearableCategory(weapon) === 'weapon');
  check('body-slot apparel wears', wearableCategory(jacket) === 'apparel');
  check('armour wears', wearableCategory(armour) === 'armor');
  check('a tool wears', wearableCategory(rod) === 'tool');
  check('a consumable never wears', !wears(beer));
  check('an expensive consumable still never wears', !wears(cognac), 'value must not make food durable');

  // ── Repairable by DEFAULT; no_repair is the opt-out ──
  check('anything that wears is repairable by default', isRepairable(weapon) && isRepairable(jacket));
  check('no_repair opts out', !isRepairable({ tags: { weapon: true, no_repair: true }, value: 100 }));
  check("something that never wears isn't repairable", !isRepairable(beer));

  // ── Capacity derives from value, sub-linearly ──
  const cheap = durabilityOf({ tags: { weapon: true }, value: 10 });
  const dear  = durabilityOf({ tags: { weapon: true }, value: 1000 });
  check('better gear lasts longer', dear > cheap, `${Math.round(cheap)} vs ${Math.round(dear)}`);
  check('but not absurdly longer (sub-linear)', dear < cheap * 10, `${Math.round(dear / cheap)}x`);
  check('a non-wearable has infinite durability', durabilityOf(beer) === Infinity);

  // ── Bands: two-thirds of the life is mechanically FREE ──
  check('pristine costs nothing', conditionBand(1).penalty === 1);
  check('worn costs nothing', conditionBand(0.8).penalty === 1, 'worn must be flavour only');
  check('battered costs a little', conditionBand(0.5).penalty < 1 && conditionBand(0.5).penalty > 0.5);
  check('failing costs a lot', conditionBand(0.2).penalty < 0.7);
  check('zero is the destruction band', conditionBand(0).id === 'broken');

  // ── Wear accrues in memory and announces ONCE per band change ──
  const row = { inv_id: 'regress_wear_row', condition: 1, tags: { weapon: true }, value: 10, name: 'pipe' };
  p._wearPending = new Map();
  const first = wear(p, row, WEAR_EVENTS.swing, 'test');
  check("a single swing doesn't change the band", first === null);
  check('wear accrues in memory, not the row', p._wearPending.size === 1 && row.condition === 1);
  check('effective condition reflects pending wear', effectiveCondition(row, p) < 1);

  // Swing until it dies. Asserted on the transitions and the death, not a count.
  let transitions = 0;
  let died = null;
  for (let i = 0; i < 400 && !died; i++) {
    const band = wear(p, row, WEAR_EVENTS.swing, 'test');
    if (!band) continue;
    transitions++;
    if (band.id === 'broken') died = band;
  }
  check('crossing bands reports a transition', transitions > 1, `${transitions} transitions`);
  check('wearing a thing to nothing destroys it', !!died, 'never reached the destruction band');
  check('the player is warned before it dies', transitions >= 3,
    'pristine->worn->battered->failing must all announce before the end');
  // destroyNow drops the pending delta — there is no row left to flush against.
  check('a destroyed row stops accruing pending wear', !p._wearPending.has(row.inv_id));

  // Non-wearables are inert.
  const inert = { inv_id: 'regress_inert', condition: 1, tags: { consumable: true }, value: 12 };
  const before = p._wearPending.size;
  wear(p, inert, WEAR_EVENTS.swing, 'test');
  check('wearing a consumable is a no-op', p._wearPending.size === before);
  p._wearPending.clear();

  // ── Examine stays SILENT for pristine, unmended gear ──
  check('a pristine unmended item says nothing',
    conditionLine({ condition: 1, tags: { weapon: true }, value: 100, custom_data: {} }) === null);
  check('a worn item speaks up',
    /worn/i.test(conditionLine({ condition: 0.8, tags: { weapon: true }, value: 100, custom_data: {} }) || ''));
  check('a mended item wears its history',
    /mended/i.test(conditionLine({ condition: 0.8, tags: { weapon: true }, value: 100, custom_data: { repairs: 2 } }) || ''));
  check('a non-wearable never gets a condition line',
    conditionLine({ condition: 0.2, tags: { consumable: true }, value: 5, custom_data: {} }) === null);

  // ── Pricing ──
  const full = _test.repairQuote({ value: 500 }, 0);
  const nearly = _test.repairQuote({ value: 500 }, 0.9);
  check('a worse item costs more to fix', full > nearly, `${full} vs ${nearly}`);
  check('knowing the repairman is cheaper',
    _test.repairQuote({ value: 500 }, 0, 0.15) < full,
    `${_test.repairQuote({ value: 500 }, 0, 0.15)} vs ${full}`);
  check('a repair is never free by discount alone', _test.repairQuote({ value: 500 }, 0, 0.15) > 0);

  // ── Reinforcement: the thing a counter cannot sell ──
  const plain = { tags: { weapon: true }, value: 100, custom_data: {} };
  const tough = { tags: { weapon: true }, value: 100, custom_data: { reinforced: 2 } };
  check("reinforcement raises capacity", durabilityOf(tough) > durabilityOf(plain),
    Math.round(durabilityOf(plain)) + " -> " + Math.round(durabilityOf(tough)));
  check("reinforcement is capped", reinforcementOf({ custom_data: { reinforced: 99 } }) === REINFORCE_MAX);
  check("an unreinforced item reads zero", reinforcementOf(plain) === 0);
  check("reinforcement shows on examine",
    /tougher/i.test(conditionLine({ condition: 0.8, tags: { weapon: true }, value: 100, custom_data: { reinforced: 1, repaired_by: "Dud" } }) || ""));

  // ── Skill lifts the hand-repair ceiling; a novice cannot match a bench ──
  check("a novice tops out at battered", _test.fieldCapFor(0) <= 0.7, String(_test.fieldCapFor(0)));
  check("a tradesman matches a bench", _test.fieldCapFor(_test.FIELD_CAP_AT_SKILL) >= 0.999,
    String(_test.fieldCapFor(_test.FIELD_CAP_AT_SKILL)));
  check("skill raises the ceiling monotonically", _test.fieldCapFor(4) > _test.fieldCapFor(1));
  check("the ceiling never exceeds perfect", _test.fieldCapFor(999) <= 1);

  // ── Watts is deliberately expensive ──
  const wrecked = _test.repairQuote({ value: 500 }, 0.1);
  check("a bench repair on good gear is a real cost", wrecked >= 200, String(wrecked));
  check("there's a floor for trivial jobs", _test.repairQuote({ value: 5 }, 0.95) >= 1);

  // ── Fatigue: each mend makes it likelier to simply GO ──
  const fresh = { condition: 0.5, tags: { weapon: true }, value: 100, custom_data: {} };
  const mended = { condition: 0.5, tags: { weapon: true }, value: 100, custom_data: { repairs: 4 } };
  check("a fresh item never breaks early", breakChanceOf(fresh) === 0);
  check("mends make it brittle", breakChanceOf(mended) > 0, String(breakChanceOf(mended)));
  check("more mends, more brittle",
    breakChanceOf({ ...mended, custom_data: { repairs: 8 } }) > breakChanceOf(mended));
  check("brittleness is capped", breakChanceOf({ ...mended, custom_data: { repairs: 999 } }) <= 0.12);

  // Rule 5 is what makes rule 4 fair: a fatigued item in GOOD shape is safe.
  check("a much-mended item in good condition can't break",
    breakChanceOf({ ...mended, condition: 0.95 }) === 0);
  check("...nor one merely worn", breakChanceOf({ ...mended, condition: 0.75 }) === 0);

  // ── Reinforcement RESOLVES fatigue ──
  const resolved = { condition: 0.5, tags: { weapon: true }, value: 100,
    custom_data: { repairs: 4, reinforced: 1, fatigue_base: 4 } };
  check("reinforcement forgives every mend to date", fatigueOf(resolved) === 0);
  check("a reinforced item is no likelier to break than a new one",
    breakChanceOf(resolved) === breakChanceOf(fresh));
  check("...and is also tougher", durabilityOf(resolved) > durabilityOf(fresh));
  check("mends AFTER a reinforcement start counting again",
    fatigueOf({ custom_data: { repairs: 6, fatigue_base: 4 } }) === 2);

  // The warning that makes destruction fair has to be readable.
  check("fatigue is visible on examine",
    /repairs|mends|trust it/i.test(conditionLine({ condition: 0.5, tags: { weapon: true }, value: 100, custom_data: { repairs: 4 } }) || ""));

  // ── Routing: `repair` must FALL THROUGH when nothing of ours is carried ──
  // The fake player owns no inventory, so the specialized action returns
  // undefined and the engine's infrastructure repair answers instead. This is
  // the assertion that proves the verb is shared, not owned.
  const r = await run('repair');
  check("repair with nothing to fix doesn't crash", r && typeof r === 'object', JSON.stringify(r)?.slice(0, 120));
}
