// Mutations plugin regression suite — run by tests/regress.js (never in production).
//
// The load-bearing case in here is the FIRST one. Every other check is ordinary
// coverage; case 1 is the one that makes the failure this whole rework exists to
// fix structurally impossible to reintroduce. If an author writes an effect key
// nothing reads, the build goes red rather than the effect going quiet.
import {
  getMutationCache, loadMutations, unknownEffectKeys,
  getMutations, hasMutation, getMutationExpression, getVisibleMutations,
  detectMutations, canConcealMutation, getClothingConflicts,
  visibilityOf, visibilityOfMutation, VISIBILITY,
  rollExpression, expressionBandOf, EXPRESSION_BANDS,
  mutationStatBonus, mutationAcuity, mutationResist, mutationNumber, mutationFlag,
  addRadiationMutation, treatMutation, removeMutation, burnAllMutations,
  checkMutationTrigger, canUseMutagen, applyMutagenMutation, consumeMutagen,
  getCustodianOutcastResponse, naturalWeaponStats, mutationSeesInDark,
  mutationSoak, diagnoseMutation, undiagnosedMutations, suppressMutation,
  survivesCloning, applyCloneInheritance, isSuppressed,
} from '../../server/engine/mutations.js';
import { getRegisteredStatusEffects, effectStatBonus, tickEffects, clearEffect } from '../../server/engine/effects.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { query } from '../../server/models/db.js';
import { _test as thornDoor } from './door.js';
import { getRegisteredMutationEffects, scaleByExpression, getUnconsumedMutationEffects } from '../../server/engine/mutation-effects.js';
import { BASE_PARTS, ALL_PARTS, PART_TO_SLOT, partsForPlayer, hitWeightsForPlayer, DEFAULT_BODY_PART_WEIGHTS } from '../../server/engine/body-parts.js';
import { getRegisteredEquipGates } from '../../server/engine/equip-gates.js';
import { bodyReport } from '../injury/index.js';
import { world } from '../../server/engine/world.js';
import { organCommands } from './organs.js';
import { reactionLines } from './reactions.js';
import { beginTurning, isTurning } from './onset.js';

// A fake carrier: just enough player for the sync accessors, which is the point
// of them being sync — none of this needs a database.
function carrier(entries) {
  return {
    id: 'mut-regress-player',
    stat_brawn: 5, stat_endurance: 5, stat_reflexes: 5,
    _mutations: new Map(entries),
    _mutationsDirty: new Set(),
    _wornRows: new Map(),
  };
}

export default async function regress({ run, check, getPlayer }) {
  await loadMutations();
  const cache = getMutationCache();
  const ids = Object.keys(cache);

  // ── 1. No authored effect key is inert ─────────────────────────────────────
  const unknown = unknownEffectKeys();
  check('every authored effect key has a registered spec', unknown.length === 0,
    `inert keys: ${unknown.join(', ')}`);
  check('the effect vocabulary is non-empty', getRegisteredMutationEffects().length > 10,
    `${getRegisteredMutationEffects().length} keys`);
  // EVERY registered key now has a reader. Raise this number ONLY alongside a
  // comment in mutation-effects.js saying why the new key cannot have one — that
  // friction is the whole discipline keeping this system out of the inert-JSONB
  // state it started in.
  const unconsumed = getUnconsumedMutationEffects();
  check('no effect key is left unconsumed', unconsumed.length === 0,
    `unconsumed: ${unconsumed.join(', ')}`);

  // ── 2. Content sanity ──────────────────────────────────────────────────────
  check('the radiation pool is authored', ids.length >= 24, `${ids.length} mutations`);
  const badVis = ids.filter(i => !VISIBILITY.includes(cache[i].visibility_class));
  check('every visibility_class is a real rung', badVis.length === 0, badVis.join(','));
  const badPart = ids.filter(i => cache[i].grants_part && !ALL_PARTS.includes(cache[i].grants_part));
  check('every grants_part is a real body part', badPart.length === 0, badPart.join(','));

  // ── 3. Expression scaling is monotonic, and 100 is the identity ────────────
  //
  // The identity at 100 is the migration's correctness invariant: the unbake
  // script sets every legacy row to 100 precisely so the move off baked stat
  // columns is net-zero on characters who already exist. Break this and the
  // whole server gets silently re-statted.
  const probe = { id: 'probe', name: 'Probe', visibility_class: 'obvious',
    stat_modifiers: { stat_brawn: 4 }, effects: { acuity_sight: 4, rad_resistance: 0.8 } };
  cache.__probe = probe;
  const at = e => carrier([['__probe', { expression: e, source: 'radiation' }]]);

  check('stat contribution is monotonic in expression',
    mutationStatBonus(at(25), 'stat_brawn') < mutationStatBonus(at(75), 'stat_brawn'),
    `${mutationStatBonus(at(25), 'stat_brawn')} vs ${mutationStatBonus(at(75), 'stat_brawn')}`);
  check('expression 100 reproduces the authored stat exactly',
    mutationStatBonus(at(100), 'stat_brawn') === 4, `${mutationStatBonus(at(100), 'stat_brawn')}`);
  check('expression 100 reproduces the authored acuity exactly',
    mutationAcuity(at(100), 'sight') === 4, `${mutationAcuity(at(100), 'sight')}`);
  check('expression 100 reproduces the authored fraction exactly',
    Math.abs(mutationResist(at(100), 'rad_resistance') - 0.8) < 1e-9,
    `${mutationResist(at(100), 'rad_resistance')}`);
  check('a body with no mutations contributes nothing',
    mutationStatBonus(carrier([]), 'stat_brawn') === 0 && mutationAcuity(carrier([]), 'sight') === 0, '');

  // Stacked resistance approaches immunity without ever reaching it.
  cache.__r1 = { id: '__r1', visibility_class: 'hidden', effects: { cold_resistance: 0.6 } };
  cache.__r2 = { id: '__r2', visibility_class: 'hidden', effects: { cold_resistance: 0.6 } };
  const stacked = carrier([['__r1', { expression: 100 }], ['__r2', { expression: 100 }]]);
  const r = mutationResist(stacked, 'cold_resistance');
  check('stacked resistance never reaches immunity', r > 0.6 && r < 1, `${r.toFixed(3)}`);

  // ── 4. The expression ladder ───────────────────────────────────────────────
  const rolls = Array.from({ length: 10000 }, () => rollExpression('radiation'));
  check('radiation rolls stay in range', rolls.every(v => v >= 10 && v <= 100), '');
  check('radiation never reaches the severe band', rolls.every(v => v < 85),
    `max ${Math.max(...rolls)}`);
  const mrolls = Array.from({ length: 20000 }, () => rollExpression('mutagen'));
  check('mutagen can reach 100', mrolls.some(v => v === 100), '');
  check('mutagen 100 is rare', mrolls.filter(v => v === 100).length / mrolls.length < 0.02,
    `${(mrolls.filter(v => v === 100).length / 200).toFixed(2)}%`);
  check('mutagen never rolls below the floor', mrolls.every(v => v >= 10), `min ${Math.min(...mrolls)}`);
  check('band weights are a real distribution',
    EXPRESSION_BANDS.every(b => b.radiation >= 0 && b.mutagen >= 0), '');
  check('expressionBandOf names every rung',
    [5, 15, 45, 70, 90, 97, 100].every(e => typeof expressionBandOf(e) === 'string'), '');

  // ── 5. Visibility ──────────────────────────────────────────────────────────
  const mk = cls => ({ id: 'v', visibility_class: cls, effects: {} });
  check('a hidden mutation is never visible, even at 100',
    visibilityOfMutation(mk('hidden'), 100) === 'hidden', visibilityOfMutation(mk('hidden'), 100));
  check('an extreme mutation shows at low expression',
    visibilityOfMutation(mk('extreme'), 20) !== 'hidden', visibilityOfMutation(mk('extreme'), 20));
  check('expression walks a class down',
    visibilityOfMutation(mk('obvious'), 20) === 'concealable', visibilityOfMutation(mk('obvious'), 20));
  check('expression walks a class up',
    visibilityOfMutation(mk('obvious'), 90) === 'extreme', visibilityOfMutation(mk('obvious'), 90));
  check('below 10 nothing shows',
    visibilityOfMutation(mk('extreme'), 5) === 'hidden', visibilityOfMutation(mk('extreme'), 5));

  cache.__hid = mk('hidden'); cache.__ext = mk('extreme');
  check('visibilityOf reports the loudest thing on the body',
    visibilityOf(carrier([['__hid', { expression: 100 }], ['__ext', { expression: 60 }]])) === 'extreme', '');
  check('an unmutated body is hidden', visibilityOf(carrier([])) === 'hidden', '');

  // ── 6. Concealment is generic ──────────────────────────────────────────────
  const torsoMut = { id: 't', visibility_class: 'concealable', conceal_slots: ['torso'] };
  const coat = { name: 'coat', tags: { slot: 'torso' } };
  const jumpsuit = { name: 'jumpsuit', tags: { slot: 'torso', covers: ['legs', 'hands'] } };
  const boots = { name: 'boots', tags: { slot: 'feet' } };
  check('a coat conceals a torso mutation with no per-item data',
    canConcealMutation(coat, torsoMut) === true, '');
  check('boots do not conceal a torso mutation',
    canConcealMutation(boots, torsoMut) === false, '');
  check('a covers-garment conceals every slot it fills',
    canConcealMutation(jumpsuit, { visibility_class: 'concealable', conceal_slots: ['torso', 'legs'] }) === true, '');
  check('an extreme mutation is never concealable',
    canConcealMutation(jumpsuit, { visibility_class: 'extreme', conceal_slots: ['torso'] }) === false, '');
  check('a mutation with no conceal_slots cannot be hidden',
    canConcealMutation(coat, { visibility_class: 'concealable', conceal_slots: [] }) === false, '');

  // Clothing conflicts are read-only in Phase 1, and expression-gated.
  cache.__spur = { id: '__spur', name: 'Spur', visibility_class: 'concealable', blocks_slots: ['hands'] };
  const glove = { tags: { slot: 'hands' } };
  check('a low-expression blocker does not conflict',
    getClothingConflicts(carrier([['__spur', { expression: 20 }]]), glove).length === 0, '');
  check('a high-expression blocker conflicts',
    getClothingConflicts(carrier([['__spur', { expression: 80 }]]), glove).length === 1, '');
  check('a blocker does not conflict with an unrelated slot',
    getClothingConflicts(carrier([['__spur', { expression: 80 }]]), boots).length === 0, '');
  // (The Phase 1 assertion here was that NOTHING registered an equip gate. Phase 2
  // registers one deliberately; the live assertion moved to case 18.)

  // ── 7. Detection is per observer ───────────────────────────────────────────
  cache.__obv = { id: '__obv', visibility_class: 'obvious', conceal_slots: ['torso'], appearance: {} };
  const target = carrier([['__obv', { expression: 60 }]]);
  const sharp = { id: 'sharp', stat_reflexes: 9, _mutations: new Map(), statuses: [], _senseDamp: { sight: 2 } };
  const dull = { id: 'dull', _mutations: new Map(), statuses: [], _senseDamp: { sight: -3 } };

  check('an obvious mutation is seen in good light',
    detectMutations(sharp, target).length === 1, '');
  check('a blunted observer misses an obvious mutation',
    detectMutations(dull, target).length === 0, '');
  check('darkness hides an obvious mutation from an ordinary eye',
    detectMutations({ id: 'o', _mutations: new Map(), statuses: [] }, target, { dark: true }).length === 0, '');

  cache.__ext2 = { id: '__ext2', visibility_class: 'extreme', appearance: {} };
  const extremeTarget = carrier([['__ext2', { expression: 60 }]]);
  check('an extreme mutation is seen in the dark by a blunted observer',
    detectMutations(dull, extremeTarget, { dark: true }).length === 1, '');

  // Concealment vs acuity.
  const covered = carrier([['__obv', { expression: 30 }]]);   // 30 => concealable
  covered._wornRows = new Map([['torso', { inv_id: 'x' }]]);
  check('clothing hides a concealable mutation from an ordinary eye',
    detectMutations({ id: 'o', _mutations: new Map(), statuses: [] }, covered).length === 0, '');
  const seen = detectMutations(sharp, covered);
  check('a sharp eye catches it anyway', seen.length === 1, '');
  check('…but is not certain about it', seen[0]?.certain === false, `certain=${seen[0]?.certain}`);
  check('you always know your own body',
    detectMutations(covered, covered).length === 1, '');

  // ── 8. Body parts ──────────────────────────────────────────────────────────
  check('PARTS is still the humanoid seven', BASE_PARTS.length === 7, `${BASE_PARTS.length}`);
  check('ALL_PARTS is wider than PARTS', ALL_PARTS.length > BASE_PARTS.length, `${ALL_PARTS.length}`);
  check('every part maps to a real slot or an explicit null',
    ALL_PARTS.every(p => p in PART_TO_SLOT), '');
  check('an unmutated body has exactly seven parts',
    partsForPlayer(carrier([])).length === 7, `${partsForPlayer(carrier([])).length}`);
  check('an unmutated body has the default hit weights',
    JSON.stringify(hitWeightsForPlayer(carrier([]))) === JSON.stringify(DEFAULT_BODY_PART_WEIGHTS), '');
  check('mutation parts carry no base hit weight',
    Object.keys(DEFAULT_BODY_PART_WEIGHTS).length === 7, '');
  check('the paper doll shows seven parts for an unmutated player',
    bodyReport({ id: 'doll', _flags: new Map() }).length === 7,
    `${bodyReport({ id: 'doll2', _flags: new Map() }).length}`);

  // A part-granting mutation grows the body, and it survives the doll.
  const tailId = ids.find(i => cache[i].grants_part);
  if (tailId) {
    const grown = carrier([[tailId, { expression: 60 }]]);
    grown._grownParts = [cache[tailId].grants_part];
    check('a part-granting mutation grows the body',
      partsForPlayer(grown).length === 8, `${partsForPlayer(grown).length}`);
    check('…and the grown part is still weightless',
      hitWeightsForPlayer(grown)[cache[tailId].grants_part] === undefined, '');
  }

  // ── 9. The chrome interlock ────────────────────────────────────────────────
  const chromed = carrier([]);
  chromed.chromed = true;
  chromed.radiation = 100;
  check('a chromed body never mutates', await checkMutationTrigger(chromed) === null, '');
  check('…and cannot be granted one directly',
    await addRadiationMutation(chromed, ids[0]) === null, '');

  // ── 10. The mutagen gate refuses at every rung ─────────────────────────────
  const g1 = await canUseMutagen(chromed);
  check('the mutagen gate refuses the chromed', g1.allowed === false && g1.reason === 'chromed', g1.reason);

  const noRep = carrier([]);
  noRep.id = 'mut-regress-norep';
  const g2 = await canUseMutagen(noRep);
  check('the mutagen gate refuses without Inner Circle rep',
    g2.allowed === false && g2.reason === 'no_rep', g2.reason);

  // Enforcement is at the application layer, not the UI: calling the applier
  // directly must be refused too.
  const direct = await applyMutagenMutation(noRep, ids[0]);
  check('applyMutagenMutation refuses when called directly',
    direct.ok === false, JSON.stringify(direct));
  const consumed = await consumeMutagen(noRep);
  check('consumeMutagen refuses when called directly',
    consumed.ok === false, JSON.stringify(consumed));

  // ── 11. The sync contract ──────────────────────────────────────────────────
  const p = carrier([]);
  for (const [name, fn] of [
    ['getMutations', () => getMutations(p)],
    ['hasMutation', () => hasMutation(p, 'x')],
    ['getMutationExpression', () => getMutationExpression(p, 'x')],
    ['visibilityOf', () => visibilityOf(p)],
    ['detectMutations', () => detectMutations(p, p)],
    ['canConcealMutation', () => canConcealMutation(coat, torsoMut)],
    ['getClothingConflicts', () => getClothingConflicts(p, coat)],
    ['getVisibleMutations', () => getVisibleMutations(p)],
    ['mutationStatBonus', () => mutationStatBonus(p, 'stat_brawn')],
    ['mutationAcuity', () => mutationAcuity(p, 'sight')],
    ['mutationResist', () => mutationResist(p, 'rad_resistance')],
    ['mutationNumber', () => mutationNumber(p, 'heal_rate')],
    ['mutationFlag', () => mutationFlag(p, 'swim')],
  ]) {
    check(`${name} is sync by contract`, !(fn() instanceof Promise), 'returned a Promise');
  }

  // ── 12. The city's reaction escalates rather than switching ────────────────
  const zone = { flags: { custodian_controlled: true } };
  check('an unmutated body draws no reaction',
    getCustodianOutcastResponse(zone, carrier([])) === null, '');
  check('a concealable body draws no reaction',
    getCustodianOutcastResponse(zone, carrier([['__obv', { expression: 30 }]])) === null, '');
  const obvRes = getCustodianOutcastResponse(zone, carrier([['__obv', { expression: 60 }]]));
  check('an obvious body is made unwelcome but not shot',
    obvRes && obvRes.hostile === false, JSON.stringify(obvRes)?.slice(0, 80));
  const extRes = getCustodianOutcastResponse(zone, carrier([['__ext2', { expression: 60 }]]));
  check('an extreme body gets the turret line even in an unarmed zone',
    extRes && /TURRET/.test(extRes.message), JSON.stringify(extRes)?.slice(0, 80));
  check('nothing happens outside Custodian country',
    getCustodianOutcastResponse({ flags: {} }, carrier([['__ext2', { expression: 90 }]])) === null, '');

  // ── 13. The verb ───────────────────────────────────────────────────────────
  const r1 = await run('mutations');
  check('the mutations verb dispatches', r1 && r1.type !== 'error', JSON.stringify(r1)?.slice(0, 120));
  check('…and says something to an unmutated player',
    typeof r1?.message === 'string' && r1.message.length > 10, '');

  // ── 14. Grant / treat / remove on a real player ────────────────────────────
  const live = getPlayer();
  if (live) {
    live._mutations = live._mutations || new Map();
    live._mutationsDirty = live._mutationsDirty || new Set();
    const before = { ...live };
    const treatable = ids.find(i => cache[i].treatable !== false && cache[i].stat_modifiers
      && Object.keys(cache[i].stat_modifiers).length);

    if (treatable) {
      const granted = await addRadiationMutation(live, treatable, { expression: 80 });
      check('a mutation can be granted', !!granted, '');
      check('…and is carried', hasMutation(live, treatable), '');
      check('…at the expression it was given', getMutationExpression(live, treatable) === 80, '');
      check('…and is marked dirty for the flush', live._mutationsDirty.has(treatable), '');

      // THE point of the rework: the stored column never moved.
      const stat = Object.keys(cache[treatable].stat_modifiers)[0];
      check('granting NEVER writes the stored stat column',
        live[stat] === before[stat], `${before[stat]} -> ${live[stat]}`);

      const t = await treatMutation(live, treatable, { reduce: 25 });
      check('treatment reduces expression', t.ok && t.expression === 55, JSON.stringify(t));
      const t2 = await treatMutation(live, treatable, { reduce: 90 });
      check('treatment below the floor removes it outright', t2.ok && t2.removed === true, JSON.stringify(t2));
      check('…and it is gone', !hasMutation(live, treatable), '');
      check('…and the stored stat column STILL never moved',
        live[stat] === before[stat], `${before[stat]} -> ${live[stat]}`);

      // Burn clears everything and leaves stats alone.
      await addRadiationMutation(live, treatable, { expression: 50 });
      const burned = await burnAllMutations(live);
      check('burnAllMutations clears the carried set', burned >= 1 && live._mutations.size === 0, `${burned}`);
      check('…and leaves the stored stats untouched',
        live[stat] === before[stat], `${before[stat]} -> ${live[stat]}`);
    }

    const untreatable = ids.find(i => cache[i].treatable === false);
    if (untreatable) {
      await addRadiationMutation(live, untreatable, { expression: 50 });
      const bad = await treatMutation(live, untreatable);
      check('an untreatable mutation is refused', bad.ok === false && bad.reason === 'untreatable', JSON.stringify(bad));
      await removeMutation(live, untreatable);
    }

    check('a mutation cannot be granted twice', await (async () => {
      const id = ids[0];
      await addRadiationMutation(live, id, { expression: 30 });
      const second = await addRadiationMutation(live, id, { expression: 90 });
      const ok = second === null && getMutationExpression(live, id) === 30;
      await removeMutation(live, id);
      return ok;
    })(), '');
  }

  // ── 15. The mutagen pool is a different animal from the radiation pool ─────
  const mutagen = ids.filter(i => (cache[i].source || 'radiation') === 'mutagen');
  check('the mutagen pool is authored', mutagen.length >= 24, `${mutagen.length}`);
  check('no mutagen mutation is treatable by a city clinic',
    mutagen.every(i => cache[i].treatable === false),
    mutagen.filter(i => cache[i].treatable !== false).join(','));
  check('no mutagen mutation is reachable by radiation',
    mutagen.every(i => (cache[i].radiation_threshold ?? 40) > 100),
    mutagen.filter(i => (cache[i].radiation_threshold ?? 40) <= 100).join(','));
  check('every mutagen mutation rolls on the mutagen ladder',
    mutagen.every(i => cache[i].expression_band === 'mutagen'), '');
  // The rad roller must never be able to hand out a mutagen mutation even if a
  // threshold were mis-authored, because the source filter is the real lock.
  const radPool = ids.filter(i => (cache[i].source || 'radiation') === 'radiation');
  check('the radiation roller draws only from the radiation pool',
    radPool.every(i => (cache[i].source || 'radiation') === 'radiation'), '');

  // ── 16. Natural weapons ARE weaponStats, not a parallel system ─────────────
  check('an ordinary body has no natural weapon',
    naturalWeaponStats(carrier([])) === null, '');

  cache.__claw = { id: '__claw', visibility_class: 'concealable',
    effects: { unarmed_damage_bonus: 6, unarmed_edged: true, unarmed_bleed_chance: 0.4 } };
  const clawed = naturalWeaponStats(carrier([['__claw', { expression: 100 }]]));
  check('a clawed body produces a weaponStats object', !!clawed && clawed.damage_max > 4, JSON.stringify(clawed));
  check('…that raises the FLOOR as well as the ceiling', clawed.damage_min > 2, `${clawed.damage_min}`);
  check('…retypes the damage to edged', clawed.damage_type === 'edged', clawed.damage_type);
  check('…still trains the unarmed skill', clawed.weapon_skill === 'fists', clawed.weapon_skill);
  check('…and carries its status through the ordinary status_chance field',
    !!clawed.status_chance?.bleeding, JSON.stringify(clawed.status_chance));

  cache.__venom = { id: '__venom', visibility_class: 'concealable', effects: { venom_potency: 0.7 } };
  const venomous = naturalWeaponStats(carrier([['__venom', { expression: 100 }]]));
  check('venom rides status_chance, not a bespoke path',
    !!venomous?.status_chance?.envenomed, JSON.stringify(venomous?.status_chance));
  check('the envenomed status is registered',
    getRegisteredStatusEffects().includes('envenomed'),
    getRegisteredStatusEffects().join(','));
  check('a low-expression claw contributes less than a high one',
    naturalWeaponStats(carrier([['__claw', { expression: 30 }]])).damage_max
      < naturalWeaponStats(carrier([['__claw', { expression: 100 }]])).damage_max, '');

  // ── 17. Grown parts come from body_parts, and are expression-gated ─────────
  cache.__wings = { id: '__wings', visibility_class: 'extreme',
    body_parts: ['wing_left', 'wing_right'], blocks_slots: ['torso'], effects: {} };
  const winged = carrier([['__wings', { expression: 70 }]]);
  // cacheGrownParts runs on the write paths; emulate it for the sync read here.
  winged._grownParts = ['wing_left', 'wing_right'];
  check('one mutation can grow TWO parts',
    partsForPlayer(winged).length === 9, `${partsForPlayer(winged).length}`);
  const budding = carrier([['__wings', { expression: 15 }]]);
  check('a barely-expressed mutation has not grown the part yet',
    partsForPlayer(budding).length === 7, `${partsForPlayer(budding).length}`);

  // ── 18. Clothing conflicts are now ENFORCED ────────────────────────────────
  check('phase 2 registers a blocking equip gate',
    getRegisteredEquipGates().includes('mutations'),
    `gates: ${getRegisteredEquipGates().join(',')}`);

  const gate = (await import('../../server/engine/equip-gates.js')).runEquipGates;
  const coatItem = { name: 'coat', tags: { slot: 'torso' } };
  const harness = { name: 'harness', tags: { slot: 'torso', accommodates: ['WINGS'] } };

  const plain = await gate({ player: winged, item: coatItem, slot: 'torso', action: 'equip' });
  check('an ordinary coat is REFUSED on a winged body', plain?.block === true, JSON.stringify(plain));
  check('…and the refusal blames the body, not the garment',
    /different shape/.test(plain?.message || ''), plain?.message?.slice(0, 90));

  const tailored = await gate({ player: winged, item: harness, slot: 'torso', action: 'equip' });
  check('a tailored garment FITS the same body', !tailored, JSON.stringify(tailored));

  const ordinaryBody = await gate({ player: carrier([]), item: coatItem, slot: 'torso', action: 'equip' });
  check('an unmutated body is never refused anything', !ordinaryBody, JSON.stringify(ordinaryBody));

  const lightlyWinged = carrier([['__wings', { expression: 20 }]]);
  const lightPass = await gate({ player: lightlyWinged, item: coatItem, slot: 'torso', action: 'equip' });
  check('a lightly expressed mutation does not cost you the slot', !lightPass, JSON.stringify(lightPass));

  // ── 19. The mutagen item cannot be drunk past the gate ─────────────────────
  const noRepBody = carrier([]);
  noRepBody.id = 'mut-regress-mutagen';
  const flask = { id: 'row1', name: 'flask of mutagen', tags: { consumable: true, mutagen: true } };
  const drunk = await dispatchAction({
    type: 'MUTAGEN_CONSUME', actor: noRepBody, params: { item: flask }, context: {},
  });
  check('drinking mutagen without the gate is refused', drunk?.type === 'error', JSON.stringify(drunk)?.slice(0, 100));
  check('…and the item is NOT consumed', !drunk?.consumed, '');
  check('…and the refusal never names the mechanism',
    !/rep|reputation|inner circle|flag/i.test(drunk?.message || ''), drunk?.message?.slice(0, 90));
  check('a non-mutagen item passes straight through',
    (await dispatchAction({ type: 'MUTAGEN_CONSUME', actor: noRepBody, params: { item: { tags: {} } }, context: {} }))?.passthrough === true, '');

  // ── 20. The Quickening arc exists and ends where the gate begins ───────────
  const { rows: arc } = await query(
    `SELECT id, rewards FROM quests WHERE id IN ('quest_wild_seen','quest_wild_proving','quest_wild_quickening')`
  );
  check('the recruitment arc is authored', arc.length === 3, `${arc.length}/3 quests`);
  const final = arc.find(q => q.id === 'quest_wild_quickening');
  const setsFlag = (final?.rewards?.flags || []).some(f => f.flag === 'wildblood_quickened');
  check('the final step sets the gate flag', setsFlag, JSON.stringify(final?.rewards?.flags));

  // Rep earned across the arc must actually clear Inner Circle, or the arc is a
  // staircase that stops one step short of the door.
  const { rows: dlg } = await query(
    `SELECT dialogue_tree FROM npcs WHERE id IN ('npc_thorn_chorus','npc_thorn_bracken')`
  );
  let repTotal = 0;
  for (const row of dlg) {
    for (const node of Object.values(row.dialogue_tree || {})) {
      for (const opt of node.options || []) {
        for (const a of opt.actions || []) {
          if (a.type === 'ADJUST_REPUTATION' && a.ideology_id === 'ideology_wildblood') repTotal += Number(a.delta) || 0;
        }
      }
    }
  }
  check('the arc pays enough rep to reach Inner Circle', repTotal >= 900, `${repTotal} rep across the arc`);

  // ── 21. The organ verbs are gated on expression, not merely on carrying ────
  cache.__zap = { id: '__zap', visibility_class: 'concealable', effects: { shock_attack: 14 } };
  const weakZap = carrier([['__zap', { expression: 15 }]]);
  const strongZap = carrier([['__zap', { expression: 90 }]]);
  check('a barely-expressed organ contributes almost nothing',
    mutationNumber(weakZap, 'shock_attack') < mutationNumber(strongZap, 'shock_attack'),
    `${mutationNumber(weakZap, 'shock_attack')} vs ${mutationNumber(strongZap, 'shock_attack')}`);

  // ── 22. Dark vision is separate from sharp eyes ────────────────────────────
  cache.__therm = { id: '__therm', visibility_class: 'obvious', effects: { thermal_vision: true } };
  cache.__keen = { id: '__keen', visibility_class: 'hidden', effects: { acuity_sight: 4 } };
  check('a thermal body sees in the dark',
    mutationSeesInDark(carrier([['__therm', { expression: 60 }]])) === true, '');
  check('merely sharp eyes do NOT see in the dark',
    mutationSeesInDark(carrier([['__keen', { expression: 100 }]])) === false, '');
  check('an ordinary body does not see in the dark',
    mutationSeesInDark(carrier([])) === false, '');

  // ── 23. GRANT_MUTATION, the authoring seam ────────────────────────────────
  const grantBody = carrier([]);
  grantBody.id = 'mut-regress-grant';

  const badGrant = await dispatchAction({
    type: 'GRANT_MUTATION', actor: grantBody, params: { mutation_id: 'mut_does_not_exist' }, context: {},
  });
  check('GRANT_MUTATION rejects an unknown mutation', badGrant?.type === 'error', JSON.stringify(badGrant)?.slice(0, 80));

  // A mutagen-source mutation granted by authored content STILL passes the gate.
  // This is the case the whole action exists to get right: an authored door is
  // still a door.
  const gatedGrant = await dispatchAction({
    type: 'GRANT_MUTATION', actor: grantBody, params: { mutation_id: 'mut_thornhide' }, context: {},
  });
  check('GRANT_MUTATION respects the mutagen gate',
    !hasMutation(grantBody, 'mut_thornhide'), 'thornhide was granted without the Quickening');
  check('…and refuses in fiction rather than erroring',
    gatedGrant?.type === 'dialogue_line', JSON.stringify(gatedGrant)?.slice(0, 80));

  // A radiation-source mutation is ungated: the world did that TO you.
  const radId = radPool.find(i => cache[i].treatable !== false);
  if (radId) {
    const ok = await dispatchAction({
      type: 'GRANT_MUTATION', actor: grantBody, params: { mutation_id: radId, expression: 42 }, context: {},
    });
    check('GRANT_MUTATION grants a radiation mutation without a gate',
      hasMutation(grantBody, radId), JSON.stringify(ok)?.slice(0, 80));
    check('…at the authored expression',
      getMutationExpression(grantBody, radId) === 42, `${getMutationExpression(grantBody, radId)}`);
    await removeMutation(grantBody, radId);
  }

  // ── 24. Thornhide is the floor of the Wildblood ladder, not a prize ────────
  const thorn = cache.mut_thornhide;
  check('mut_thornhide is authored', !!thorn, '');
  check('…as a mutagen mutation', thorn?.source === 'mutagen', thorn?.source);
  check('…and is visible, because the social mechanic needs the first one to show',
    thorn?.visibility_class === 'obvious', thorn?.visibility_class);

  // ── 25. Mutagen supply is gated by a flag only the arc raises ─────────────
  const { rows: rin } = await query(`SELECT flags, vendor_inventory FROM npcs WHERE id='npc_thorn_rindle'`);
  const trustFlag = rin[0]?.flags?.trust_flag;
  check('the Wildblood trader runs a trust shelf', !!trustFlag, JSON.stringify(rin[0]?.flags));
  const shelfFlask = (rin[0]?.vendor_inventory || []).find(e => e.item_id === 'item_wb_mutagen');
  check('the flask is on that shelf', !!shelfFlask, '');
  check('…behind the highest trust rung', (shelfFlask?.min_trust || 0) >= 3, `min_trust ${shelfFlask?.min_trust}`);
  check('…and is not cheap', (shelfFlask?.price || 0) >= 2000, `${shelfFlask?.price}`);
  // Everything Rindle sold before the arc must still be visible to a stranger,
  // or turning on the trust shelf has quietly hidden the medicine.
  const openStock = (rin[0]?.vendor_inventory || []).filter(e => !(e.min_trust > 0));
  check('his ordinary stock is still open to strangers', openStock.length >= 8, `${openStock.length} open entries`);

  // Only the arc raises the flag it is gated on.
  const { rows: qrows } = await query(
    `SELECT id, rewards FROM quests WHERE id IN ('quest_wild_seen','quest_wild_proving','quest_wild_quickening')`
  );
  const raises = qrows.filter(q => (q.rewards?.flags || []).some(f => f.flag === trustFlag));
  check('every step of the arc raises trust', raises.length === 3, `${raises.length}/3`);

  // ── 26. The last unconsumed keys now have readers ──────────────────────────
  cache.__glow = { id: '__glow', visibility_class: 'obvious', effects: { stealth_penalty: 4 } };
  cache.__fins = { id: '__fins', visibility_class: 'concealable', effects: { swim: true } };
  check('stealth_penalty is summed for the concealment roll',
    mutationNumber(carrier([['__glow', { expression: 100 }]]), 'stealth_penalty') === 4, '');
  check('swim reads as a flag at sufficient expression',
    mutationFlag(carrier([['__fins', { expression: 80 }]]), 'swim') === true, '');
  check('…and not below its floor',
    mutationFlag(carrier([['__fins', { expression: 10 }]]), 'swim') === false, '');

  // ── 27. Flight is mobility, and it reaches four real seams ────────────────
  cache.__fly = { id: '__fly', visibility_class: 'extreme', effects: { flight: true } };
  const flier = carrier([['__fly', { expression: 80 }]]);
  const grounded = carrier([]);

  check('a winged body reads as flying', mutationFlag(flier, 'flight') === true, '');
  check('…and a low-expression one does not',
    mutationFlag(carrier([['__fly', { expression: 30 }]]), 'flight') === false, '');
  check('an ordinary body never reads as flying', mutationFlag(grounded, 'flight') === false, '');

  // The cliff exemption, through the REAL gate chain rather than a reimplementation.
  const { runMoveGates } = await import('../../server/engine/movement-gates.js');
  const { propsOf } = await import('../../server/engine/world.js');
  const cliff = [...world.zones.values()].find(z => propsOf(z.id).passable === false);
  if (cliff) {
    const walled = await runMoveGates({ player: grounded, from: null, to: cliff, direction: 'north', opts: {} });
    check('a cliff still stops an ordinary body', walled?.block === true, JSON.stringify(walled)?.slice(0, 70));
    const flown = await runMoveGates({ player: flier, from: null, to: cliff, direction: 'north', opts: {} });
    const blockedByTerrain = flown?.block && /sheer/.test(flown.message || '');
    check('…and does not stop a flying one', !blockedByTerrain, JSON.stringify(flown)?.slice(0, 70));
  }

  // Fleeing. Asserted as a CONTEST margin rather than by reading the constant, so
  // the case fails if the bonus is ever moved to the wrong roll.
  const { playerFleeRoll } = await import('../../server/engine/combat.js');
  let flewAway = 0, ranAway = 0;
  for (let i = 0; i < 400; i++) {
    if (await playerFleeRoll({ ...flier, id: 'flee-w' }, 12)) flewAway++;
    if (await playerFleeRoll({ ...grounded, id: 'flee-g' }, 12)) ranAway++;
  }
  check('wings make you better at LEAVING a fight', flewAway > ranAway, `${flewAway} vs ${ranAway} of 400`);

  // …but not at surviving one you stay in. The in-fight dodge must be untouched,
  // or flight has quietly become a combat mutation.
  const { defenseBonus } = await import('../../server/engine/stance.js');
  check('…but no better at being hit while you stay',
    defenseBonus(flier) === defenseBonus(grounded),
    `${defenseBonus(flier)} vs ${defenseBonus(grounded)}`);

  // The power move is gated on the mutation, not merely offered.
  const noWings = await organCommands.swoop([], 'swoop', grounded, () => {});
  check('swoop is not a verb for a body without wings',
    noWings?.type === 'error' && /Unknown command/.test(noWings.message), JSON.stringify(noWings)?.slice(0, 60));
  const noTarget = await organCommands.swoop([], 'swoop', { ...flier, current_zone: 'zone_start', stamina: 100 }, () => {});
  check('…and refuses in fiction when there is nothing to drop on',
    noTarget?.type === 'error' && !/Unknown command/.test(noTarget.message), JSON.stringify(noTarget)?.slice(0, 70));
  const winded = await organCommands.swoop([], 'swoop', { ...flier, current_zone: 'zone_start', stamina: 2 }, () => {});
  check('…and refuses when you have no wind left',
    winded?.type === 'error', JSON.stringify(winded)?.slice(0, 60));

  // ── 28. Suppression reaches EVERY derived contribution ────────────────────
  //
  // The whole design of `effectiveExpression` is that nothing in mutations.js
  // reads `rec.expression` in a calculation. These cases are what enforces it:
  // if a future accessor is added that reads the raw value, one of them goes red.
  cache.__sup = { id: '__sup', name: 'Sup', visibility_class: 'obvious',
    stat_modifiers: { stat_brawn: 8 },
    effects: { acuity_sight: 4, soak_kinetic: 8, cold_resistance: 0.8, unarmed_damage_bonus: 8 } };

  const open = carrier([['__sup', { expression: 100 }]]);
  const held = carrier([['__sup', { expression: 100, suppressed_until: Date.now() + 3600_000 }]]);
  const lapsed = carrier([['__sup', { expression: 100, suppressed_until: Date.now() - 1000 }]]);

  check('suppression damps the stat contribution',
    mutationStatBonus(held, 'stat_brawn') < mutationStatBonus(open, 'stat_brawn'),
    `${mutationStatBonus(held, 'stat_brawn')} vs ${mutationStatBonus(open, 'stat_brawn')}`);
  check('…the acuity contribution',
    mutationAcuity(held, 'sight') < mutationAcuity(open, 'sight'), '');
  check('…the resistance',
    mutationResist(held, 'cold_resistance') < mutationResist(open, 'cold_resistance'), '');
  check('…the soak',
    (mutationSoak(held).kinetic || 0) < (mutationSoak(open).kinetic || 0),
    `${mutationSoak(held).kinetic} vs ${mutationSoak(open).kinetic}`);
  check('…and the natural weapon',
    naturalWeaponStats(held).damage_max < naturalWeaponStats(open).damage_max, '');
  check('suppression damps VISIBILITY, which is what it is bought for',
    VISIBILITY.indexOf(getMutations(held)[0].visibility) < VISIBILITY.indexOf(getMutations(open)[0].visibility),
    `${getMutations(held)[0].visibility} vs ${getMutations(open)[0].visibility}`);
  check('a lapsed course does nothing at all',
    mutationStatBonus(lapsed, 'stat_brawn') === mutationStatBonus(open, 'stat_brawn'), '');
  check('suppression does not CURE — the raw expression is untouched',
    getMutations(held)[0].expression === 100, `${getMutations(held)[0].expression}`);
  check('…and the player is told it is being held, not that it shrank',
    getMutations(held)[0].suppressed === true && getMutations(held)[0].effective < 100, '');

  // ── 29. Diagnosis names a thing and changes nothing else ──────────────────
  cache.__inner = { id: '__inner', name: 'Inner', visibility_class: 'hidden',
    stat_modifiers: { stat_cool: 2 }, effects: {} };
  cache.__outer = { id: '__outer', name: 'Outer', visibility_class: 'obvious', effects: {} };

  const dxBody = carrier([]);
  dxBody.id = 'mut-regress-dx';
  await addRadiationMutation(dxBody, '__inner', { expression: 60 });
  await addRadiationMutation(dxBody, '__outer', { expression: 60 });

  check('a mutation you cannot see arrives UNdiagnosed',
    getMutations(dxBody).find(e => e.id === '__inner')?.diagnosed === false, '');
  check('a mutation you CAN see arrives already understood',
    getMutations(dxBody).find(e => e.id === '__outer')?.diagnosed === true, '');
  check('undiagnosedMutations lists exactly the unknown one',
    undiagnosedMutations(dxBody).map(e => e.id).join(',') === '__inner',
    undiagnosedMutations(dxBody).map(e => e.id).join(','));

  const beforeDx = mutationStatBonus(dxBody, 'stat_cool');
  const learned = await diagnoseMutation(dxBody, '__inner');
  check('diagnosis names it', learned?.mutation?.id === '__inner', JSON.stringify(learned)?.slice(0, 60));
  check('…and is mechanically INERT',
    mutationStatBonus(dxBody, 'stat_cool') === beforeDx, `${beforeDx} -> ${mutationStatBonus(dxBody, 'stat_cool')}`);
  check('…and is not billable twice',
    await diagnoseMutation(dxBody, '__inner') === null, '');
  await removeMutation(dxBody, '__inner');
  await removeMutation(dxBody, '__outer');

  // ── 30. Clone inheritance defaults to the biology that already shipped ─────
  check('an unmarked mutation survives the vats',
    survivesCloning({ clone_inheritance: 'all' }, 'radiation') === true, '');
  check('…as does one with no policy authored at all',
    survivesCloning({}, 'mutagen') === true, '');
  check('none survives nothing', survivesCloning({ clone_inheritance: 'none' }, 'radiation') === false, '');
  check('radiation_only keeps the rads',
    survivesCloning({ clone_inheritance: 'radiation_only' }, 'radiation') === true
    && survivesCloning({ clone_inheritance: 'radiation_only' }, 'mutagen') === false, '');
  check('mutagen_only keeps the mutagen',
    survivesCloning({ clone_inheritance: 'mutagen_only' }, 'mutagen') === true
    && survivesCloning({ clone_inheritance: 'mutagen_only' }, 'radiation') === false, '');
  check('an unrecognised policy fails toward KEEPING the body you had',
    survivesCloning({ clone_inheritance: 'nonsense' }, 'radiation') === true, '');
  check('every authored mutation has a valid policy',
    ids.every(i => ['all', 'none', 'radiation_only', 'mutagen_only'].includes(cache[i].clone_inheritance || 'all')),
    ids.filter(i => !['all', 'none', 'radiation_only', 'mutagen_only'].includes(cache[i].clone_inheritance || 'all')).join(','));

  // The prune itself, end to end.
  cache.__mortal = { id: '__mortal', name: 'Mortal', visibility_class: 'hidden',
    clone_inheritance: 'none', effects: {} };
  const dies = carrier([]);
  dies.id = 'mut-regress-clone';
  await addRadiationMutation(dies, '__mortal', { expression: 50 });
  await addRadiationMutation(dies, '__outer', { expression: 50 });
  const lost = await applyCloneInheritance(dies);
  check('respawn prunes what does not survive', lost.length === 1 && lost[0].id === '__mortal',
    lost.map(m => m.id).join(','));
  check('…and keeps what does', hasMutation(dies, '__outer'), '');
  await removeMutation(dies, '__outer');

  // ── 31. The social ladder, and the region that is exempt from it ──────────
  const crowd = [{ name: 'Aldous' }, { name: 'Beck' }, { name: 'Cray' }, { name: 'Dain' }];
  check('a concealable body draws no ambient reaction',
    reactionLines('concealable', crowd).lines.length === 0, '');
  check('a hidden body draws none either',
    reactionLines('hidden', crowd).lines.length === 0, '');
  check('an obvious body is noticed', reactionLines('obvious', crowd).lines.length >= 1, '');
  check('an extreme body is noticed harder',
    reactionLines('extreme', crowd).lines.length > reactionLines('obvious', crowd).lines.length, '');
  check('an empty room reacts not at all', reactionLines('extreme', []).lines.length === 0, '');
  // A crowd is a different thing from two people, and needs three to become one.
  const pair = [{ name: 'Aldous' }, { name: 'Beck' }];
  const gathered = Array.from({ length: 60 }, () => reactionLines('extreme', pair))
    .some(r => r.lines.some(l => /Conversation stops|drifted together|rearranged itself/.test(l)));
  check('two people are not a crowd', !gathered, 'a pair produced a gathering line');
  // Nothing in here may ever be an attack. This is the rule the whole file exists
  // to hold, so it is asserted rather than trusted.
  const everyLine = Array.from({ length: 200 }, () => reactionLines('extreme', crowd)).flatMap(r => r.lines);
  check('no rung of the social ladder is violence',
    !everyLine.some(l => /attack|hits you|swings|draws a|shoots/i.test(l)), '');

  // ── 31b. The report rung is a FACT, not a string ──────────────────────────
  //
  // Whether the police are called must never be re-derived by reading the prose.
  // The first version of this regex-matched the generated lines for "telephone",
  // which made every one of those strings load-bearing law.
  const runs = Array.from({ length: 400 }, () => reactionLines('extreme', crowd));
  check('the report rung is reported structurally',
    runs.every(r => typeof r.reported === 'boolean'), '');
  check('…and it does fire sometimes', runs.some(r => r.reported), '');
  check('…and is not a certainty', runs.some(r => !r.reported), '');
  check('a reported run always carries the line that says so',
    runs.filter(r => r.reported).every(r => r.lines.length >= 2), '');
  // Only the loudest rung reaches the law at all.
  check('an obvious body is never reported',
    Array.from({ length: 200 }, () => reactionLines('obvious', crowd)).every(r => !r.reported), '');
  check('one bystander is nobody to tell',
    Array.from({ length: 200 }, () => reactionLines('extreme', [{ name: 'Solo' }])).every(r => !r.reported), '');

  // ── 31c. …and the law is charged as an ordinary crime ─────────────────────
  //
  // The police response is NOT a bespoke path in the mutation plugin. It is a
  // `crimes` row charged through surveillance's own `raiseCrime`, so the lawless
  // rule, the debounce, the heat, the priors and the dispatch all come free and
  // none of them can drift away from every other offence in the game.
  const { rows: crimeRow } = await query(`SELECT id, stars, enabled FROM crimes WHERE id='mutant_sighting'`);
  check('the sighting is an authored crime', crimeRow.length === 1, JSON.stringify(crimeRow));
  check('…charged at one star, under the take-you-alive line',
    Number(crimeRow[0]?.stars) === 1, `${crimeRow[0]?.stars}`);
  check('…and is enabled', crimeRow[0]?.enabled === true, `${crimeRow[0]?.enabled}`);

  // ── 32. Mutating is an INJURY, not a notification ─────────────────────────
  //
  // The rule this enforces: becoming something else has to cost a body, and the
  // cost has to be the ordinary kind that ordinary medicine fixes. If any of
  // these go green-to-red, a mutation has quietly become a free upgrade again.
  const turned = {
    id: 'mut-regress-turn', hp: 40, hp_max: 40, stamina: 100, stamina_max: 100,
    statuses: [], _mutations: new Map(), _mutationsDirty: new Set(),
  };
  const before = { hp: turned.hp, stamina: turned.stamina };
  const onset = beginTurning(turned, { expression: 60, source: 'radiation' });

  check('the turn costs HP immediately', turned.hp < before.hp, `${before.hp} -> ${turned.hp}`);
  check('…and most of your wind', turned.stamina < before.stamina * 0.6,
    `${before.stamina} -> ${turned.stamina}`);
  check('…and leaves you visibly Turning', isTurning(turned), '');
  check('…for a while', onset.ticks > 30, `${onset.ticks} ticks`);

  // Weakness is the half the player feels in play.
  check('turning makes you weaker at everything',
    effectStatBonus(turned, 'stat_brawn') < 0 && effectStatBonus(turned, 'stat_reflexes') < 0,
    `${effectStatBonus(turned, 'stat_brawn')}`);

  // Mutagen is worse on every axis. That gap is the price of the better ladder.
  const deep = { id: 'mut-regress-deep', hp: 40, hp_max: 40, stamina: 100, statuses: [], _mutations: new Map() };
  const deepOnset = beginTurning(deep, { expression: 60, source: 'mutagen' });
  check('a mutagen turn is longer than a radiation one', deepOnset.ticks > onset.ticks,
    `${deepOnset.ticks} vs ${onset.ticks}`);
  check('…and hits harder up front', deep.hp < turned.hp, `${deep.hp} vs ${turned.hp}`);
  check('…and is a different, heavier status',
    deep.statuses.some(s => s.name === 'turning_deep'), deep.statuses.map(s => s.name).join(','));
  check('the two rungs never run together',
    !deep.statuses.some(s => s.name === 'turning'), deep.statuses.map(s => s.name).join(','));

  // A worse mutation is a worse turn.
  const mild = { id: 'm1', hp: 40, hp_max: 40, stamina: 100, statuses: [], _mutations: new Map() };
  const wild = { id: 'm2', hp: 40, hp_max: 40, stamina: 100, statuses: [], _mutations: new Map() };
  const mildOn = beginTurning(mild, { expression: 15, source: 'mutagen' });
  const wildOn = beginTurning(wild, { expression: 100, source: 'mutagen' });
  check('a bigger mutation is a longer turn', wildOn.ticks > mildOn.ticks,
    `${wildOn.ticks} vs ${mildOn.ticks}`);

  // THE HARD LIMIT. Dying to your own biology mid-turn would be unreadable, and
  // would teach players not to touch the content they went and found.
  const frail = { id: 'frail', hp: 1, hp_max: 40, stamina: 3, statuses: [], _mutations: new Map() };
  beginTurning(frail, { expression: 100, source: 'mutagen' });
  check('the turn can never kill you outright', frail.hp >= 1, `${frail.hp}`);
  const spec = getRegisteredStatusEffects();
  check('both turning rungs are registered',
    spec.includes('turning') && spec.includes('turning_deep'), spec.join(','));

  // Ticking it down never crosses the floor either.
  const ground = { id: 'grind', hp: 2, hp_max: 40, stamina: 10, statuses: [], _mutations: new Map() };
  beginTurning(ground, { expression: 100, source: 'mutagen' });
  for (let i = 0; i < 400; i++) tickEffects(ground);
  check('…nor does grinding all the way through it', ground.hp >= 1, `${ground.hp}`);

  // And you cannot use the thing that is still being built.
  const midTurn = { ...turned, current_zone: 'zone_start',
    _mutations: new Map([['__zap2', { expression: 90 }]]) };
  cache.__zap2 = { id: '__zap2', visibility_class: 'concealable', effects: { shock_attack: 14 } };
  const refused = await organCommands.shock([], 'shock', midTurn, () => {});
  check('an organ cannot be fired mid-turn',
    refused?.type === 'error' && /not finished|like this/.test(refused.message),
    JSON.stringify(refused)?.slice(0, 80));
  delete cache.__zap2;

  // ── Cleanup ────────────────────────────────────────────────────────────────
  //
  // Leave the shared player as found. This matters more than it looks: granting a
  // mutation now emits `mutation.gained`, which puts a body through a real turn —
  // HP gone, stamina gone, weak for a minute. That is correct in play and poison
  // in a test run, because the fake player is SHARED, and the sneak and
  // weightbench suites that run after this one both refuse a winded body. Their
  // reds were mine, and this is the fix.
  if (live) {
    for (const s of ['turning', 'turning_deep']) clearEffect(live, s);
    delete live._turning;
    live.hp = live.hp_max ?? 40;
    live.stamina = live.stamina_max ?? 100;
  }

  // ── The thorn gates: admitted, and not already somebody else's ─────────────
  //
  // The authFn writes flags and messages a live player, so what is tested here is the RULE it is
  // made of. Every case below is a whole character's worth of decisions expressed as four numbers,
  // which is the point of reading the ordinary ideology path flags rather than minting a Wildblood
  // membership flag of our own.
  const gateOk = (flags) => {
    const p = { _flags: new Map(Object.entries(flags)) };
    if (!p._flags.get(thornDoor.ADMITTED)) return false;
    const flesh = thornDoor.pathFlag(p, 'flesh');
    const other = Math.max(thornDoor.pathFlag(p, 'machine'), thornDoor.pathFlag(p, 'mind'),
                           thornDoor.pathFlag(p, 'human'));
    return !(other > 0 && other >= flesh);
  };
  check('the thorn never opens for somebody nobody admitted', !gateOk({ path_flesh: '90' }));
  check('admitted and undeclared gets in', gateOk({ [thornDoor.ADMITTED]: 'yes' }));
  check('admitted and leaning flesh gets in',
    gateOk({ [thornDoor.ADMITTED]: 'yes', path_flesh: '45', path_mind: '10' }));
  check('a player signed up to the machine is refused',
    !gateOk({ [thornDoor.ADMITTED]: 'yes', path_flesh: '45', path_machine: '60' }));
  check('a player signed up to the mind is refused',
    !gateOk({ [thornDoor.ADMITTED]: 'yes', path_mind: '30' }));
  // A dead heat refuses. Somebody equally committed to two paths has not chosen, and choosing is
  // the entire toll at this gate.
  check('a tie refuses rather than admitting',
    !gateOk({ [thornDoor.ADMITTED]: 'yes', path_flesh: '40', path_human: '40' }));
  check('the warden names what the player did, never the creed',
    !/wildblood|creed|order|evolution|adapt/i.test(thornDoor.WARDEN_LINE), thornDoor.WARDEN_LINE);

  // ── The gate guards stand still ────────────────────────────────────────────
  //
  // THE ONLY NON-AGGRO ENEMIES IN THE GAME, and the whole approach to the Thornwarren depends on
  // them staying that way: `canAggro` in gameLoop.js is exactly `behavior === 'aggressive' ||
  // behavior === 'territorial' || behaviour_graph._start`, so flipping any one of those three turns
  // the road up to the gate into a road nobody can walk. They are intimidating and they are lethal
  // if you start something, and they never start it.
  {
    const { rows: guards } = await query(
      "SELECT id, behavior, behaviour_graph FROM enemies WHERE id LIKE 'enemy_thorn_%' ORDER BY id");
    check('the three thorn guards are loaded', guards.length === 3, `${guards.length} found`);
    for (const row of guards) {
      const graph = typeof row.behaviour_graph === 'string'
        ? JSON.parse(row.behaviour_graph || '{}') : (row.behaviour_graph || {});
      check(`${row.id} never aggros on its own`,
        row.behavior !== 'aggressive' && row.behavior !== 'territorial' && !graph?._start,
        `behavior=${row.behavior}`);
    }
  }

  // Leave the shared cache exactly as found — later suites read it.
  for (const k of ['__probe', '__r1', '__r2', '__hid', '__ext', '__ext2', '__obv', '__spur',
                   '__claw', '__venom', '__wings', '__zap', '__therm', '__keen',
                   '__glow', '__fins', '__fly']) delete cache[k];
}
