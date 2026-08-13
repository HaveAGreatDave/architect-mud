/**
 * Mastery regress.
 *
 * The load-bearing case in here is the purity one: install chrome, watch the
 * CEILING drop, confirm the STORED rank did not move, take the chrome out and
 * get back exactly what you earned. That round trip is the whole reason the cap
 * is applied on read instead of written into the number, and it is the thing
 * that would be unrecoverable if anyone ever "simplified" it.
 */
import {
  DISCIPLINES, storedRank, setRank, raiseRank, adjustRead, getRead, MAX_READ_ROWS, _test,
} from './state.js';
import {
  purityCap, effectiveRank, chromeLoad, fleshLoad, capReason, stainOf, standingGreeting,
  standingWord, regardOf, REGARD, REGARD_ORDER, CAP_FLOOR, CHROME_COST, STAIN_HALF_LIFE_DAYS,
  carriesModification, cleanseDemand,
} from './purity.js';
import {
  archetypeOf, readTier, tierAtLeast, noteExchange, bankHeat, sweepStaleFights, heatOn,
} from './reads.js';
import { getMutationCache, loadMutations } from '../../server/engine/mutations.js';
import { matchExploits, EXPLOITS, EFFECT_KEYS } from './exploits.js';
import {
  getComposure, awardComposure, spendComposure, decayComposure, composureCap,
} from './composure.js';
import {
  TECHNIQUES, STANCES, stanceFor, knownStances, activeStance, stanceSoak, endStance, attemptRoll,
} from './techniques.js';
import {
  canArm, armWindow, resolveWindow, clearWindow, takeAnswer, OPTIONS, _test as _readTest,
} from './readgame.js';
import { isOnCooldown, setCooldown, clearCooldown } from '../../server/engine/combat.js';
import { bandOf, _internals } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const P = getPlayer();

  // ── the sheet and the verb ────────────────────────────────────────────────
  P._reads = new Map(); P._disciplines = new Map();
  P._readsDirty = new Set(); P._disciplinesDirty = new Set();

  const untaught = await run('mastery');
  check('mastery: an untrained body has nothing to show', untaught?.type === 'output');
  check('mastery: ...and does not leak the discipline list to someone who has never trained',
    !DISCIPLINES.some(d => (untaught?.message || '').includes(d)), untaught?.message);

  setRank(P, 'body', 30);
  const sheet = await run('mastery');
  check('mastery: a trained discipline appears', (sheet?.message || '').includes('body'));
  check('mastery: ...as a word, never a number',
    !/\d/.test(sheet?.message || ''), sheet?.message);

  check('bands climb with rank', bandOf(0) === 'untrained' && bandOf(30) === 'schooled' && bandOf(96) === 'masterful');

  // ── the purity cap: the invariant ─────────────────────────────────────────
  const clean = { _augments: new Map(), _mutations: new Map(), _disciplines: new Map([['body', 90]]) };
  check('an unmodified body can reach the top', purityCap(clean) === 100);
  check('...and its discipline is worth what it earned', effectiveRank(clean, 'body') === 90);

  // One augment, installed and working.
  clean._augments.set('aug_test', { condition: 1 });
  check('chrome lowers the ceiling', purityCap(clean) === 100 - CHROME_COST);
  check('...and the discipline is held to it', effectiveRank(clean, 'body') === 100 - CHROME_COST);
  check('...but the STORED rank is untouched — this is the unrecoverable one',
    storedRank(clean, 'body') === 90);

  // ── the stain: cleaning up does not clean the slate ───────────────────────
  // Without this, chrome is RENTABLE — install it for the fight, have it cut
  // out before you train, pay nothing. This is the case that stops that.
  clean._augments.delete('aug_test');
  const justPulled = purityCap(clean);
  check('pulling the chrome does NOT hand the ceiling straight back',
    justPulled < 100, `cap ${justPulled}`);
  check('...and the stored rank is still untouched', storedRank(clean, 'body') === 90);
  check('...and the stain is exactly what is missing',
    Math.abs(stainOf(clean) - (100 - justPulled)) < 0.01);

  // Wind the clock forward by rewriting when the stain was last set — the same
  // thing hydrate does from the DB's own timestamp.
  clean._purity.at = Date.now() - STAIN_HALF_LIFE_DAYS * 86400000;
  const halfFaded = purityCap(clean);
  check('a half-life later the stain has halved', halfFaded > justPulled && halfFaded < 100,
    `${justPulled} → ${halfFaded}`);

  clean._purity.at = Date.now() - STAIN_HALF_LIFE_DAYS * 10 * 86400000;
  check('and eventually it is gone entirely — a stain, not a scar',
    purityCap(clean) === 100 && stainOf(clean) === 0);
  check('...and only THEN is the earned rank worth what it was',
    effectiveRank(clean, 'body') === 90);
  check('the stain can never make you cleaner than you actually are', (() => {
    clean._augments.set('aug_new', { condition: 1 });
    return purityCap(clean) === 100 - CHROME_COST;
  })());
  clean._augments.clear();
  clean._purity = null;

  // A dead augment is not chrome you are carrying.
  clean._augments.set('aug_dead', { condition: 0 });
  check('a destroyed augment costs no ceiling', chromeLoad(clean) === 0 && purityCap(clean) === 100);
  clean._augments.clear();

  // Enough chrome to bottom out.
  for (let i = 0; i < 12; i++) clean._augments.set(`aug_${i}`, { condition: 1 });
  check('the ceiling floors at 10 and never at 0 — chrome makes mastery impossible, not discipline',
    purityCap(clean) === CAP_FLOOR);
  clean._augments.clear();

  // Reset the stain: the 12-augment case above left one, and a body that has
  // been modified is not the same as a body that never was — which is the
  // point of the whole mechanic and would make this next check a lie.
  clean._purity = null;
  check('an unmodified body is given no reason it cannot go further', capReason(clean) === null);
  clean._augments.set('aug_test', { condition: 1 });
  check('...and a modified one is told in prose, never a number',
    typeof capReason(clean) === 'string' && !/\d/.test(capReason(clean)), capReason(clean));
  clean._augments.clear();

  // ── the door: cleanse yourself first ─────────────────────────────────────
  // The Watch refuse to TEACH a body still carrying metal or mutation. Separate
  // mechanism from the ceiling, and the separation is the thing under test: the
  // door reads what you ARE carrying, the ceiling reads what you CARRIED.
  const door = (over = {}) => ({ _augments: new Map(), _mutations: new Map(), _disciplines: new Map(), ...over });

  check('an unmodified body is not asked to cleanse anything',
    !carriesModification(door()) && cleanseDemand(door(), 'Vance') === null);

  const chromed = door({ _augments: new Map([['a', { condition: 1 }]]) });
  check('working chrome closes the door', carriesModification(chromed));
  check('...and a DEAD augment does not — it is not something you are carrying',
    !carriesModification(door({ _augments: new Map([['a', { condition: 0 }]]) })));

  // A REAL catalog id, not an invented one: `getMutations` silently skips ids
  // it has no definition for, so a made-up key would give a fleshLoad of 0 and
  // these next three checks would pass while testing nothing at all.
  // The catalog is loaded on demand and this suite may run before the mutations
  // one does; without this the id is undefined, `getMutations` returns nothing,
  // and the three checks below pass while testing an unmutated body.
  await loadMutations();
  const mutId = Object.keys(getMutationCache())[0];
  const carrying = (expression) => door({ _mutations: new Map([[mutId, { expression }]]) });

  // The load quantises and the door must not. One mutation at expression 12
  // floors to zero steps and costs no ceiling at all; the Watch still see it.
  const faintly = carrying(12);
  check('a mutation too faint to move the CEILING still closes the DOOR',
    !!mutId && purityCap(faintly) === 100 && carriesModification(faintly), mutId);

  check('the refusal names what has to go and never a number', (() => {
    for (const p of [chromed, faintly, door({
      _augments: new Map([['a', { condition: 1 }]]),
      _mutations: new Map([[mutId, { expression: 40 }]]),
    })]) {
      const d = cleanseDemand(p, 'Vance');
      if (!d || !d.includes('Vance') || /\d/.test(d.replace(/class="[^"]*"/g, ''))) return false;
    }
    return true;
  })());

  // The load-bearing one. Cleaning up must OPEN the door — otherwise the stain
  // is unreachable and the whole ceiling mechanic is dead code.
  const retread = door();
  retread._purity = { load: 60, at: Date.now() };
  check('someone who CLEANED UP is let in, and met by the ceiling instead of the door',
    !carriesModification(retread) && cleanseDemand(retread) === null
    && stainOf(retread) > 0 && purityCap(retread) < 100);

  // The door must not be wired to the social ladder — it has rungs the Watch
  // admit, and refusing them here would be a silent second gate.
  check('an awakened mind is never asked to cleanse — psionics is not a BODY',
    !carriesModification(door({ _flags: new Map([['psi_rank', 'seer']]) })));

  // ── the ladder: pure > psionic > augmented > mutant ───────────────────────
  // Social texture ONLY. The load-bearing assertion is the last one: nothing in
  // here may ever be read to refuse anybody anything.
  const body = (over = {}) => ({ _augments: new Map(), _mutations: new Map(), _disciplines: new Map(), ...over });
  const pure = body();
  const psi = body({ _flags: new Map([['psi_rank', 'seer']]) });
  const aug = body({ _augments: new Map([['a', { condition: 1 }]]) });

  check('an unmodified body is pure', regardOf(pure) === REGARD.PURE);
  check('a psionic sits below pure', regardOf(psi) === REGARD.PSIONIC);
  check('chrome sits below that', regardOf(aug) === REGARD.AUGMENTED);
  check('the ladder is ordered the way the Watch sees it',
    REGARD_ORDER.join('>') === 'pure>psionic>augmented>mutant');

  check('an awakened mind is read off the real psionics substrate, not a placeholder',
    regardOf(body({ _flags: new Map([['psi_rank', 'seer']]) })) === REGARD.PSIONIC);
  check('...and costs no ceiling, because nothing was done to the BODY',
    purityCap(body({ _flags: new Map([['psi_rank', 'seer']]) })) === 100);

  check('every rung has something to say, and it is never a refusal', (() => {
    for (const p of [pure, psi, aug]) {
      const g = standingGreeting(p, 'Vance');
      if (!g || !g.includes('Vance')) return false;
    }
    return true;
  })());

  check('the Watch never concede psionics is real — no line grants the premise', (() => {
    // "shortcut", "assisted", "help", "gift", "power" all admit the thing works.
    // The grievance is that the Exodus LEFT, and that they believe it.
    const GRANTS_PREMISE = /shortcut|assisted|a gift|your power|it works|advantage/i;
    for (let i = 0; i < 300; i++) if (GRANTS_PREMISE.test(standingGreeting(psi, 'Vance'))) return false;
    return true;
  })());
  check('...and the slur is about desertion, not about ability',
    standingWord(psi) === 'walkaway');

  check('the greeting is mostly CODED — they do not usually say the quiet part', (() => {
    // The slur is the rare register. Sample enough to catch a flipped default.
    let plain = 0;
    for (let i = 0; i < 400; i++) if (/\bBought\b/.test(standingGreeting(aug, 'Vance'))) plain++;
    return plain > 0 && plain < 200;   // present, but the minority
  })());

  check('a pure body is given the honorific and never a slur',
    standingWord(pure) === 'first-body');

  // ── Read storage: one row per KIND, not per corpse ────────────────────────
  const R = { _reads: new Map(), _readsDirty: new Set() };
  for (let i = 0; i < 20; i++) adjustRead(R, 'enemy:enemy_scav_dog', { familiarity: 2 });
  check('twenty exchanges with the same kind of thing make ONE row, not twenty',
    R._reads.size === 1, `${R._reads.size} rows`);
  check('...and the familiarity accumulated', getRead(R, 'enemy:enemy_scav_dog').familiarity === 40);
  check('familiarity is capped at 100', (() => {
    for (let i = 0; i < 100; i++) adjustRead(R, 'enemy:enemy_scav_dog', { familiarity: 10 });
    return getRead(R, 'enemy:enemy_scav_dog').familiarity === 100;
  })());

  check('an unmet archetype reads as a shared zero rather than undefined',
    getRead(R, 'enemy:never_met').familiarity === 0 && Array.isArray(getRead(R, 'enemy:never_met').exploits));
  check('...and that zero is frozen, so a caller cannot poison it for everyone',
    Object.isFrozen(_test.ZERO_READ));

  adjustRead(R, 'enemy:enemy_scav_dog', { exploit: 'ex_left_knee' });
  adjustRead(R, 'enemy:enemy_scav_dog', { exploit: 'ex_left_knee' });
  check('an exploit is recorded once, however often it is noticed',
    getRead(R, 'enemy:enemy_scav_dog').exploits.length === 1);

  // ── decay: lazy, at hydrate, no tick ──────────────────────────────────────
  const nowSec = Date.now() / 1000;
  check('a read seen just now has not decayed',
    Math.abs(_test.decayed(100, nowSec, Date.now()) - 100) < 0.01);
  check('a fortnight halves it',
    Math.abs(_test.decayed(100, nowSec - 14 * 86400, Date.now()) - 50) < 0.5);
  check('...and it never goes negative',
    _test.decayed(100, nowSec - 3650 * 86400, Date.now()) >= 0);

  // ── the row cap ───────────────────────────────────────────────────────────
  const B = { _reads: new Map(), _readsDirty: new Set() };
  for (let i = 0; i < MAX_READ_ROWS + 20; i++) adjustRead(B, `enemy:t${i}`, { familiarity: i + 1 });
  _test.prune(B);
  check('the read set is bounded so a login query can never get expensive',
    B._reads.size === MAX_READ_ROWS, `${B._reads.size}`);
  check('...and it is the best-known archetypes that survive the prune',
    B._reads.has(`enemy:t${MAX_READ_ROWS + 19}`) && !B._reads.has('enemy:t0'));

  // ── Read: the archetype key, and the inversion ────────────────────────────
  const dog = { instanceId: 'ei_1', templateId: 'enemy_scav_dog', name: 'scav dog', hit: 2, dodge: 2, body_parts: [{ part: 'legs', weight: 3 }, { part: 'head', weight: 1 }] };
  const dog2 = { ...dog, instanceId: 'ei_2' };

  check('the key is the KIND, not the corpse',
    archetypeOf(dog) === 'enemy:enemy_scav_dog' && archetypeOf(dog) === archetypeOf(dog2));
  check('a player is one shared key, never a dossier per person',
    archetypeOf({ handle: 'Dud' }) === 'pvp' && archetypeOf({ handle: 'Vance' }) === 'pvp');

  const F = { _reads: new Map(), _readsDirty: new Set(), _readHeat: new Map(), _disciplines: new Map(), _augments: new Map(), _mutations: new Map() };
  check('an untrained fighter reads nothing at all — this must never be free',
    noteExchange(F, dog, { kind: 'incoming' }) === null);

  F._disciplines.set('combat', 60);
  const first = noteExchange(F, dog, { kind: 'incoming' });
  check('a trained one starts learning on the first exchange', first !== null);

  // THE INVERSION. Everything else in this game gets worse over a long fight.
  const early = heatOn(F, dog);
  for (let i = 0; i < 12; i++) noteExchange(F, dog, { kind: 'incoming' });
  check('the longer the fight runs, the more you know — the whole point of the system',
    heatOn(F, dog) > early);
  check('...and that is expressed as a tier, not a raw number',
    tierAtLeast(readTier(heatOn(F, dog)), 'pattern'));

  check('a second individual of the same kind is its OWN read',
    heatOn(F, dog2) < heatOn(F, dog));
  check('...but starts ahead of nothing, because you know the kind', (() => {
    // Nothing banked yet, so no head start yet either.
    return heatOn(F, dog2) === 0;
  })());

  // Banking: heat becomes durable familiarity at a discount when the fight ends.
  const heatBefore = heatOn(F, dog);
  const banked = bankHeat(F, 'ei_1');
  check('a finished fight banks what it taught', banked > 0);
  check('...at a discount, so a grind cannot max an archetype', banked < heatBefore);
  check('...and the heat is gone with the fight', F._readHeat.has('ei_1') === false);
  check('...leaving ONE archetype row', F._reads.size === 1);
  check('now the next one of its kind starts ahead', heatOn(F, dog2) > 0);

  // A fight that just stopped, rather than ending in a kill.
  noteExchange(F, dog2, { kind: 'outgoing' });
  F._readHeat.get('ei_2').lastAt = Date.now() - 120000;
  check('a fight nobody walked away from cleanly still banks on the sweep',
    sweepStaleFights(F) === 1 && F._readHeat.size === 0);

  // ── Exploits ──────────────────────────────────────────────────────────────
  check('an exploit only names a part the combat system will resolve against', (() => {
    for (const ex of EXPLOITS) {
      if (!ex.part) continue;
      const fake = { name: 'x', body_parts: [{ part: ex.part }], hit: 5, dodge: 1 };
      // If it matches something, the part it names must be on that thing.
      if (ex.requires(fake) && !fake.body_parts.some(p => p.part === ex.part)) return false;
    }
    return true;
  })());
  check('a legless thing is never told about its knee', (() => {
    const blob = { name: 'blob', body_parts: [{ part: 'torso' }], hit: 1, dodge: 1 };
    return !matchExploits(blob).some(e => e.id === 'ex_knee_compensating');
  })());
  check('a big committed swinger presents the overextension exploit',
    matchExploits({ name: 'brute', hit: 4, dodge: 1, body_parts: [] }).some(e => e.id === 'ex_overextends'));
  check('every exploit declares an effect the technique layer must net',
    EXPLOITS.every(e => EFFECT_KEYS.includes(e.effect)));
  check('every exploit says something a person could have noticed',
    EXPLOITS.every(e => typeof e.prose({ name: 'it' }) === 'string' && e.prose({ name: 'it' }).length > 20));

  // ── Composure ─────────────────────────────────────────────────────────────
  const C = { _disciplines: new Map([['will', 60]]), _augments: new Map(), _mutations: new Map() };
  check('composure starts at nothing', getComposure(C) === 0);
  check('Will buys headroom', composureCap(C) > composureCap({ _disciplines: new Map(), _augments: new Map(), _mutations: new Map() }));
  awardComposure(C, 99);
  check('...and it cannot be exceeded', getComposure(C) === composureCap(C));
  check('a spend it cannot afford takes NOTHING', (() => {
    const D = { _disciplines: new Map(), _augments: new Map(), _mutations: new Map(), _composure: 1 };
    return spendComposure(D, 3) === false && getComposure(D) === 1;
  })());
  check('it bleeds away out of a fight — never a stockpile you log in holding', (() => {
    const before = getComposure(C);
    decayComposure(C);
    return getComposure(C) < before;
  })());

  // ── the focus trap ────────────────────────────────────────────────────────
  // `playerDefence` already clears the ATTACK cooldown. If focus cleared that
  // too, composure would buy free swings — a damage passive wearing a
  // resource's clothes, which is the one thing this system may not contain.
  {
    const P2 = getPlayer();
    P2._disciplines = new Map([['will', 60]]);
    P2._composure = 9;
    setCooldown(P2.id, 'attack', 60000);
    setCooldown(P2.id, 'combat_move', 60000);
    const r = await run('focus');
    check('focus reopens the move window', !isOnCooldown(P2.id, 'combat_move'), r?.message);
    check('...and the ATTACK cooldown SURVIVES it — composure never buys a free swing',
      isOnCooldown(P2.id, 'attack'));
    check('...and it charged for the privilege', getComposure(P2) < 9);
    clearCooldown(P2.id, 'attack');
    P2._disciplines = new Map();
    P2._composure = 0;
  }

  // ── stances ───────────────────────────────────────────────────────────────
  const S = { id: 'st', hp_max: 100, _disciplines: new Map([['body', 60]]), _augments: new Map(), _mutations: new Map() };
  check('a stance you have not trained for is not offered',
    knownStances({ _disciplines: new Map(), _augments: new Map(), _mutations: new Map() }).length === 0);
  check('a trained body is offered some', knownStances(S).length > 0);

  S._stance = { name: 'iron_body', startedAt: Date.now(), expiresAt: Date.now() + 60000 };
  check('a held brace adds soak', stanceSoak(S) > 0);
  check('...that never touches player.soak, so there is no cache to invalidate',
    S.soak === undefined);

  // THE reason stances are not written into the armour cache.
  S._stance.expiresAt = Date.now() - 1;
  check('an expired stance contributes nothing even if no tick has been near it',
    stanceSoak(S) === 0 && activeStance(S) === null);

  S._stance = { name: 'rooted', startedAt: Date.now(), expiresAt: Date.now() + 60000 };
  check('rooted is immobile — the cost IS the stance', stanceFor('rooted').immobile === true);
  endStance(S, 'drop');
  check('dropping it releases you', activeStance(S) === null);

  // ── techniques ────────────────────────────────────────────────────────────
  check('every technique declares which direction of swing consumes it',
    Object.values(TECHNIQUES).every(t => t.kind === 'incoming' || t.kind === 'outgoing'));
  check('every technique costs composure — none is free',
    Object.values(TECHNIQUES).every(t => t.composure > 0));
  check('every technique has a line for FAILING, because it can',
    Object.values(TECHNIQUES).every(t => typeof t.fail === 'string' && t.fail.length > 10));

  check('a technique CAN fail — it is never a passive with extra steps', (() => {
    const weak = { _disciplines: new Map([['movement', 25]]), _augments: new Map(), _mutations: new Map() };
    const brute = { hit: 8, dodge: 8 };
    let failures = 0;
    for (let i = 0; i < 200; i++) if (!attemptRoll(weak, TECHNIQUES.slip, brute).success) failures++;
    return failures > 0;
  })());
  check('...and discipline makes it likelier to land', (() => {
    const weak = { _disciplines: new Map([['movement', 25]]), _augments: new Map(), _mutations: new Map() };
    const strong = { _disciplines: new Map([['movement', 95]]), _augments: new Map(), _mutations: new Map() };
    const e = { hit: 4, dodge: 4 };
    let w = 0, s = 0;
    for (let i = 0; i < 400; i++) {
      if (attemptRoll(weak, TECHNIQUES.slip, e).success) w++;
      if (attemptRoll(strong, TECHNIQUES.slip, e).success) s++;
    }
    return s > w;
  })());

  check('Slip states an OUTCOME rather than bending the to-hit roll', (() => {
    // As a big negative hitMod it would silently fail against a high-`hit`
    // enemy, which is the exact opposite of what the technique is for.
    const ctx = { enemy: { name: 'thing' }, player: {}, hitMod: 0, negate: false, lines: [] };
    TECHNIQUES.slip.apply(ctx, { success: true });
    return ctx.negate === true && ctx.hitMod === 0 && typeof ctx.negateLine === 'string';
  })());
  check('...and a negated swing prints the technique\'s own line, never a lucky miss', (() => {
    const ctx = { enemy: { name: 'thing' }, player: {}, hitMod: 0, negate: false, lines: [] };
    TECHNIQUES.slip.apply(ctx, { success: true });
    return ctx.negateLine.includes('thing');
  })());
  check('a failed technique changes nothing at all', (() => {
    const ctx = { enemy: { name: 'thing' }, player: {}, hitMod: 0, negate: false, lines: [] };
    return TECHNIQUES.slip.apply(ctx, { success: false }) === null && ctx.negate === false;
  })());

  check('Perfect Timing counters through the ENGINE\'s own swing path', (() => {
    // Never enemy.hp -= n from a plugin: that skips the part roll, typed soak,
    // damage observers and loot-on-death.
    const ctx = { enemy: { name: 'thing', hp: 50 }, player: {}, hitMod: 0, negate: false, lines: [] };
    TECHNIQUES.perfect_timing.apply(ctx, { success: true });
    return ctx.player._powQueued === true && ctx.enemy.hp === 50;
  })());

  // ── the read window ───────────────────────────────────────────────────────
  const W = {
    id: 'w1', _disciplines: new Map([['combat', 80]]), _augments: new Map(), _mutations: new Map(),
    _reads: new Map(), _readsDirty: new Set(), _readHeat: new Map(), _composure: 4,
  };
  const target = { instanceId: 'ei_w', templateId: 'enemy_t', name: 'thing', hp: 30, hit: 2, dodge: 2, lastAttack: Date.now() };

  check('a window will not arm before you can read the thing at all',
    canArm(W, target) === false);

  // Get the read up to 'pattern'.
  for (let i = 0; i < 10; i++) noteExchange(W, target, { kind: 'incoming' });
  check('...and will once you can', canArm(W, target) === true);

  check('a dead thing arms nothing', canArm(W, { ...target, hp: 0 }) === false);
  check('with no composure there is no window', canArm({ ...W, _composure: 0 }, target) === false);

  const win = armWindow(W, target);
  check('arming opens exactly one window', !!win && !!W._readWindow);
  check('...charged for it', getComposure(W) < 4);
  check('...and a second cannot open on top of it', canArm(W, target) === false);
  check('the answer is one of the four the client is shown',
    OPTIONS.includes(win.correct), win.correct);

  // The deadline comes from the ENGINE's schedule, not a wall clock.
  check('the deadline is derived from the enemy\'s own attack interval',
    win.expiresAt > target.lastAttack && win.expiresAt <= target.lastAttack + 4000);

  check('a forged or stale token resolves nothing',
    resolveWindow(W, 'rw_not_a_real_token', 'BLOCK') === null);
  check('...and the real window is still open after the forgery', !!W._readWindow);

  const wrong = OPTIONS.find(o => o !== win.correct);
  const rWrong = resolveWindow(W, win.token, wrong);
  check('a wrong read is wrong', rWrong?.correct === false);
  check('...and leaves no answer for the next swing to consume',
    takeAnswer(W, target) === false);

  // Right answer → the next incoming swing from THAT instance consumes it.
  const win2 = armWindow(W, target);
  resolveWindow(W, win2.token, win2.correct);
  check('a correct read leaves an answer waiting', !!W._readAnswer);
  check('...that another enemy\'s swing cannot eat',
    takeAnswer(W, { instanceId: 'ei_other' }) === false);
  check('...and the right enemy\'s swing does', takeAnswer(W, target) === true);
  check('...exactly once', takeAnswer(W, target) === false);

  // The lapse: doing nothing must cost nothing.
  const win3 = armWindow(W, target);
  W._readWindow.expiresAt = Date.now() - 1;
  const lapsed = resolveWindow(W, win3.token, win3.correct);
  check('a window that closed unanswered lapses rather than failing',
    lapsed?.lapsed === true && lapsed.correct === undefined);
  check('...and leaves nothing behind', !W._readWindow && !W._readAnswer);

  // The stale-token-vs-corpse bug.
  armWindow(W, target);
  clearWindow(W);
  check('clearing a window kills the token, so it can never resolve against a corpse',
    W._readWindow === null && resolveWindow(W, win3.token, 'BLOCK') === null);

  // The unwinnable-window guard.
  check('an interval too short to react to refuses to arm rather than shipping a reflex test',
    armWindow({ ...W, _composure: 4, _readWindow: null }, { ...target, lastAttack: Date.now() - 3900 }) === null);

  // The tells ARE the puzzle: every answer must have its own, or the board is a
  // coin flip with decoration and a player can never get better at it.
  check('every answer has tells of its own',
    OPTIONS.every(o => Array.isArray(_readTest.TELLS[o]) && _readTest.TELLS[o].length >= 2));
  check('...and no two answers share a tell', (() => {
    const seen = new Set();
    for (const o of OPTIONS) for (const t of _readTest.TELLS[o]) {
      if (seen.has(t)) return false;
      seen.add(t);
    }
    return true;
  })());

  // ── train falls through where nobody teaches ──────────────────────────────
  const t = await run('train');
  check('train in a room with no instructor falls through rather than eating the verb',
    t === undefined || t?.type === 'error', JSON.stringify(t));

  // Leave the harness player as we found it.
  P._disciplines = new Map(); P._disciplinesDirty = new Set();
}
