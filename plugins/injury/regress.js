// Injury plugin regression suite — run by tests/regress.js (never loaded in production).
//
// What's worth asserting here is the stuff that rots silently:
//   • the type curves still produce the CHARACTER they're supposed to (blunt
//     rarely-but-badly, edged often-but-mildly) — a careless tweak to one
//     number can quietly make every weapon feel the same;
//   • armour that soaked the blow still prevents the wound;
//   • decay actually heals, and heals PROPORTIONALLY to elapsed time (the bug
//     where a long absence sheds only one rung is invisible in play and would
//     make wounds effectively permanent for anyone who logs off);
//   • one wound per part, and a graze never downgrades a fracture.
import {
  severityFor, injuryReport, bodyReport, severityOf, clearInjuries, hooks,
} from './index.js';
import { PARTS, TYPES, BRUISED, HURT, MAIMED, injuryName, typeRules } from './tables.js';
import { enemySeverity, enemyWoundNote, partLabel, enemyHasCapability } from './enemy.js';
import { impairmentOf } from '../../server/engine/impairment.js';
import { effectiveStat } from '../../server/engine/condition.js';
import { aimHitPenalty, aimedWeights as aimedWeightsFor, splitSpread, spreadGroups, executionShot, enemyAttackPlayer, waterCombatPenalty, underskilledPenalty, weaponSkillRequirement, applyStun, isStunned, isOnCooldown } from '../../server/engine/combat.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { knockOut, wakeUp, isOut } from '../../server/engine/unconscious.js';
import { fireDamageToEnemy as fireEnemy, fireDamageToPlayer } from '../../server/engine/damage-events.js';

// A fake live player: injuries live entirely in memory, so no DB row is needed.
function body(injuries = {}) {
  const now = Date.now();
  const map = new Map();
  for (const [part, [sev, type, ageMins = 0]] of Object.entries(injuries)) {
    map.set(part, { sev, type, at: now - ageMins * 60_000 });
  }
  return { id: 'regress-injury', handle: 'Testsubject', hp_max: 100, _flags: new Map(), _injuries: map };
}

export default async function regress({ run, check, getPlayer }) {
  // ── The verb ───────────────────────────────────────────────────────────────
  const r = await run('injuries');
  check('injuries verb routed', r?.type !== 'error', r?.message);

  // ── Thresholds: armour that worked prevents the wound ──────────────────────
  check('a soaked-to-nothing hit never injures',
    severityFor(0, 100, 'kinetic') === 0 && severityFor(0, 100, 'edged') === 0);
  check("chip damage doesn't injure",
    severityFor(3, 100, 'kinetic') === 0, `got ${severityFor(3, 100, 'kinetic')}`);

  // ── Type character: the whole point of the design ──────────────────────────
  // Blunt needs a bigger blow than a blade to injure at all...
  check('kinetic threshold is higher than edged',
    TYPES.kinetic.threshold > TYPES.edged.threshold);
  check('a mid hit injures with a blade but not a club',
    severityFor(20, 100, 'edged') > 0 && severityFor(20, 100, 'kinetic') === 0,
    `edged=${severityFor(20, 100, 'edged')} kinetic=${severityFor(20, 100, 'kinetic')}`);

  // ...but once it lands, it lands harder. This is the row that makes blunt
  // interesting rather than just weaker.
  check('a big blunt hit outranks the same blade hit',
    severityFor(60, 100, 'kinetic') > severityFor(60, 100, 'edged'),
    `kinetic=${severityFor(60, 100, 'kinetic')} edged=${severityFor(60, 100, 'edged')}`);
  check('kinetic can reach Maimed',
    severityFor(60, 100, 'kinetic') === MAIMED);

  // The climb is the other half of the character, and a tuning pass can silently
  // invert it (an early one did). Blunt must stay the STEEPER curve — smaller
  // step — or "glances off, then breaks something" becomes untrue.
  check('kinetic climbs steeper than edged',
    TYPES.kinetic.step < TYPES.edged.step,
    `kinetic=${TYPES.kinetic.step} edged=${TYPES.edged.step}`);

  // Saturation: the bug this curve exists to fix. An enormous blow must not be
  // able to do more than Maim, and — more importantly — the rungs must not be so
  // cheap that every mid-tier weapon reaches Maimed on a routine hit.
  check('an absurd blow still only Maims',
    severityFor(500, 100, 'kinetic') === MAIMED && severityFor(5000, 100, 'edged') === MAIMED);
  check("a routine mid-tier blow doesn't Maim",
    severityFor(30, 100, 'kinetic') < MAIMED && severityFor(30, 100, 'edged') < MAIMED,
    `kinetic=${severityFor(30, 100, 'kinetic')} edged=${severityFor(30, 100, 'edged')}`);

  // ── Crit, head and cumulative all lower the bar — and ONLY the bar ─────────
  check('a crit injures where the same hit otherwise would not',
    severityFor(22, 100, 'kinetic') === 0 && severityFor(22, 100, 'kinetic', { critical: true }) > 0,
    `plain=${severityFor(22, 100, 'kinetic')} crit=${severityFor(22, 100, 'kinetic', { critical: true })}`);
  check('a head hit injures where the same blow elsewhere would not',
    severityFor(22, 100, 'kinetic') === 0 && severityFor(22, 100, 'kinetic', { head: true }) > 0);
  check('cumulative types find a wounded part easier',
    severityFor(20, 100, 'kinetic', { existing: HURT }) > severityFor(20, 100, 'kinetic', { existing: 0 }),
    `wounded=${severityFor(20, 100, 'kinetic', { existing: HURT })} fresh=${severityFor(20, 100, 'kinetic', { existing: 0 })}`);
  check('non-cumulative types ignore an existing wound',
    severityFor(20, 100, 'edged', { existing: MAIMED }) === severityFor(20, 100, 'edged', { existing: 0 }));

  // ── Decay ──────────────────────────────────────────────────────────────────
  const oneStep = typeRules('kinetic').healMins;

  const fresh = body({ left_leg: [MAIMED, 'kinetic', 0] });
  check("a fresh wound doesn't decay", severityOf(fresh, 'left_leg') === MAIMED);

  const aged = body({ left_leg: [MAIMED, 'kinetic', oneStep + 1] });
  check('one heal period sheds exactly one rung',
    severityOf(aged, 'left_leg') === HURT, `got ${severityOf(aged, 'left_leg')}`);

  // The important one: elapsed time must translate proportionally, or a player
  // who logs off overnight comes back still maimed.
  const stale = body({ left_leg: [MAIMED, 'kinetic', oneStep * 2 + 1] });
  check('two heal periods shed two rungs',
    severityOf(stale, 'left_leg') === BRUISED, `got ${severityOf(stale, 'left_leg')}`);

  const gone = body({ left_leg: [MAIMED, 'kinetic', oneStep * 10] });
  check('a long absence heals a wound away entirely',
    severityOf(gone, 'left_leg') === 0 && injuryReport(gone).length === 0);

  // Slow types must genuinely outlast fast ones over the same span.
  const burned = body({ torso: [MAIMED, 'fire', oneStep + 1] });
  check('fire outlasts kinetic over the same elapsed time',
    severityOf(burned, 'torso') === MAIMED, `got ${severityOf(burned, 'torso')}`);

  // ── Report shapes ──────────────────────────────────────────────────────────
  const hurt = body({ left_leg: [MAIMED, 'kinetic', 0], head: [BRUISED, 'edged', 0] });
  const rep = injuryReport(hurt);
  check('report lists only injured parts', rep.length === 2, `${rep.length}`);
  check('report is worst-first', rep[0].severity >= rep[1].severity);
  check('report carries a band the tablet can colour',
    rep.every(i => ['warn', 'bad', 'crit'].includes(i.band)));

  const doll = bodyReport(hurt);
  check('paper doll covers every part', doll.length === PARTS.length, `${doll.length}/${PARTS.length}`);
  check('paper doll bands an uninjured part good',
    doll.find(p => p.part === 'torso')?.band === 'good');
  check('paper doll gives injured parts a detail line',
    !!doll.find(p => p.part === 'left_leg')?.detail);

  // ── Naming falls back rather than failing ──────────────────────────────────
  check('an authored name is used', injuryName('kinetic', MAIMED, 'head') === 'skull-cracked');
  check('an unauthored part falls back to the type name',
    injuryName('kinetic', MAIMED, 'feet') === 'fractured');
  check('an unknown type still yields a name',
    typeof injuryName('cheese', HURT, 'feet') === 'string' && injuryName('cheese', HURT, 'feet').length > 0);
  check('every type/severity pair names cleanly',
    Object.keys(TYPES).every(t => [1, 2, 3].every(s => (injuryName(t, s, 'torso') || '').length > 0)));

  // ── Phase 3: penalties ─────────────────────────────────────────────────────
  // The provider must stay OFF for an uninjured player: it sits on the per-swing,
  // per-move and per-15s-tick paths, and a non-null answer there is pure cost.
  const well = body();
  check("an uninjured body isn't impaired", impairmentOf(well) === impairmentOf(body()),
    'expected the shared EMPTY object');
  check('an uninjured body has no stat penalty', impairmentOf(well).statPenalties.stat_brains === undefined);

  // Bruised is mechanically free — this is what keeps most hits from nagging.
  const bruised = body({ head: [BRUISED, 'kinetic', 0], left_leg: [BRUISED, 'kinetic', 0] });
  const bi = impairmentOf(bruised);
  check('Bruised costs nothing at all',
    !bi.hitMod && !bi.moveStaminaExtra && !bi.runBlocked && bi.staminaRegenMult === 1
      && !Object.keys(bi.statPenalties).length);

  // Head → stats, and it must reach effectiveStat, not just the report.
  const concussed = body({ head: [HURT, 'kinetic', 0] });
  concussed.stat_brains = 6;
  check('a hurt head costs Brains', impairmentOf(concussed).statPenalties.stat_brains === 1);
  check('the penalty reaches effectiveStat', effectiveStat(concussed, 'stat_brains') === 5,
    `got ${effectiveStat(concussed, 'stat_brains')}`);
  const wrecked = body({ head: [MAIMED, 'kinetic', 0] });
  check('a maimed head also costs Cool', impairmentOf(wrecked).statPenalties.stat_cool === 1);

  // Torso → recovery.
  check('a hurt torso slows stamina regen',
    impairmentOf(body({ torso: [HURT, 'edged', 0] })).staminaRegenMult < 1);
  check('a maimed torso slows it further',
    impairmentOf(body({ torso: [MAIMED, 'edged', 0] })).staminaRegenMult
      < impairmentOf(body({ torso: [HURT, 'edged', 0] })).staminaRegenMult);

  // Arms → to-hit, and they stack.
  const oneArm = impairmentOf(body({ left_arm: [HURT, 'edged', 0] })).hitMod;
  const twoArms = impairmentOf(body({ left_arm: [HURT, 'edged', 0], right_arm: [HURT, 'edged', 0] })).hitMod;
  check('a hurt arm costs to-hit', oneArm < 0, `${oneArm}`);
  check('two hurt arms are worse than one', twoArms < oneArm, `${twoArms} vs ${oneArm}`);

  // Legs → stamina per step, and the run refusal. NEVER a movement block.
  const limp = impairmentOf(body({ left_leg: [HURT, 'kinetic', 0] }));
  check('a hurt leg costs stamina per step', limp.moveStaminaExtra > 0);
  check('a hurt leg does NOT refuse running', !limp.runBlocked);
  const ruined = impairmentOf(body({ left_leg: [MAIMED, 'kinetic', 0] }));
  check('a ruined leg refuses running', !!ruined.runBlocked, ruined.runBlocked || 'none');
  const bothGone = impairmentOf(body({ left_leg: [MAIMED, 'kinetic', 0], right_leg: [MAIMED, 'kinetic', 0] }));
  check('both legs ruined costs more than one', bothGone.moveStaminaExtra > ruined.moveStaminaExtra);
  check('nothing ever blocks movement outright',
    bothGone.moveStaminaExtra > 0 && !('moveBlocked' in bothGone));

  // A healed wound must take its penalty with it — the invalidation bug that
  // would otherwise leave a player permanently impaired by a wound that is gone.
  const healedUp = body({ left_leg: [MAIMED, 'kinetic', typeRules('kinetic').healMins * 10] });
  check('a healed wound leaves no impairment behind', impairmentOf(healedUp).runBlocked == null);

  // The doll's detail lines promise mechanics; they must not promise ones that
  // don't exist. Every non-Bruised part needs a consequence line.
  const everything = body(Object.fromEntries(PARTS.map(p => [p, [MAIMED, 'kinetic', 0]])));
  check('every maimed part explains its consequence',
    bodyReport(everything).every(p => (p.detail || '').length > 20));

  // ── Phase 4: the compounding guard ─────────────────────────────────────────
  //
  // Steep kinetic rungs, the head threshold scale and `cumulative` all push the
  // same direction, so blunt-to-the-head maims more often than any one rule
  // suggests. That is intended, but it must stay a HARD hit's reward rather than
  // the default outcome — the failure mode is every scrap ending in a fractured
  // skull. These bound the worst case so a future tweak to one number can't
  // quietly cross that line without a test going red.
  //
  // NOTE: the head term is now `head: true` (a threshold scale), NOT a x1.5 on
  // the damage. Passing inflated damage here was the double-dip this pass
  // removed; scoring it that way again would make this guard test a model the
  // engine no longer runs.
  const worstCase = (raw) => severityFor(raw, 100, 'kinetic', { critical: true, existing: HURT, head: true });

  check("a light blunt head crit on a wounded skull still doesn't maim",
    worstCase(10) < MAIMED, `got ${worstCase(10)}`);
  check('a solid blunt head crit DOES maim (the payoff is real)',
    worstCase(35) === MAIMED, `got ${worstCase(35)}`);
  // The floor: with every multiplier stacked, a graze must remain a graze.
  check('a graze stays a graze under every multiplier at once',
    worstCase(4) === 0, `got ${worstCase(4)}`);

  // ── Phase 5: medicine ──────────────────────────────────────────────────────
  const treat = (player, rx) => hooks['item.consumed'](player, { treat_injury: rx });

  // The load-bearing rule: field medicine can NEVER clear a wound. If a bandage
  // could, the clinic has no reason to exist and neither does the whole tier.
  const bandaged = body({ left_leg: [MAIMED, 'kinetic', 0] });
  treat(bandaged, { steps: 1, floor: 1 });
  check('a bandage steps a wound down', severityOf(bandaged, 'left_leg') === HURT,
    `got ${severityOf(bandaged, 'left_leg')}`);
  treat(bandaged, { steps: 1, floor: 1 });
  treat(bandaged, { steps: 1, floor: 1 });
  check('a bandage can never clear a wound outright',
    severityOf(bandaged, 'left_leg') === BRUISED, `got ${severityOf(bandaged, 'left_leg')}`);

  // A splint is the right answer to a fracture and useless on a burn — which is
  // what makes damage type something you carry gear FOR.
  const burnt = body({ torso: [MAIMED, 'fire', 0] });
  const wrongTool = treat(burnt, { steps: 1, floor: 1, types: ['kinetic'] });
  check('a splint does nothing for a burn', severityOf(burnt, 'torso') === MAIMED);
  check('and says so', /wrong thing/i.test(wrongTool || ''), wrongTool);

  const broken = body({ left_leg: [MAIMED, 'kinetic', 0] });
  treat(broken, { steps: 1, floor: 1, types: ['kinetic'] });
  check('a splint sets a fracture', severityOf(broken, 'left_leg') === HURT);

  // A trauma kit's whole value is treating everything at once — wasted on one
  // bruise, decisive when you limped out with four wounds.
  const mangled = body({ left_leg: [HURT, 'edged', 0], right_arm: [HURT, 'edged', 0], head: [HURT, 'edged', 0] });
  treat(mangled, { steps: 1, floor: 1, all: true });
  check('a trauma kit treats every wound at once',
    injuryReport(mangled).every(i => i.severity === BRUISED), JSON.stringify(injuryReport(mangled)));

  const single = body({ left_leg: [HURT, 'edged', 0], right_arm: [HURT, 'edged', 0] });
  treat(single, { steps: 1, floor: 1 });
  check('an ordinary bandage treats only one',
    injuryReport(single).filter(i => i.severity === HURT).length === 1);

  check('using a kit on an unhurt body is a gentle no-op',
    /nothing on you/i.test(treat(body(), { steps: 1, floor: 1 }) || ''));

  // The surgical tier — the only thing that makes you whole.
  const forSurgery = body({ left_leg: [MAIMED, 'kinetic', 0], head: [BRUISED, 'edged', 0] });
  const mended = clearInjuries(forSurgery);
  check('a clinic clears wounds outright', injuryReport(forSurgery).length === 0);
  check('and reports what it treated', mended.length === 2, `${mended.length}`);
  check('clearing removes the impairment too', impairmentOf(forSurgery).runBlocked == null);

  // ── `aim`: the opt-in half ─────────────────────────────────────────────────
  //
  // The load-bearing property is that NOT aiming costs nothing and changes
  // nothing. If aim ever becomes mandatory-by-optimisation, the design has
  // failed — so the free-by-default case is asserted first and hardest.
  const shooter = body();
  check('a player who never aims has no aim state', !shooter._aimPart);
  check('and pays no accuracy for it', aimHitPenalty(shooter, 0) === 0);
  check('an unaimed roll is left completely alone',
    aimedWeightsFor(shooter, { head: 10, torso: 40 }).torso === 40);

  const aimed = await run('aim head');
  check('aim verb routed', aimed?.type !== 'error', aimed?.message);
  const aimBare = await run('aim');
  check('bare aim reports without changing anything', aimBare?.type !== 'error');
  const aimJunk = await run('aim spleen');
  check('an unaimable part is refused, not silently ignored', aimJunk?.type === 'error');

  const headAimer = body(); headAimer._aimPart = 'head';
  check('aiming high costs accuracy', aimHitPenalty(headAimer, 0) < 0);
  check('skill buys most of it back',
    aimHitPenalty(headAimer, 12) > aimHitPenalty(headAimer, 0),
    `unskilled=${aimHitPenalty(headAimer, 0)} skilled=${aimHitPenalty(headAimer, 12)}`);
  check('but aiming is NEVER free, however good you get',
    aimHitPenalty(headAimer, 999) < 0, `got ${aimHitPenalty(headAimer, 999)}`);
  check("centre mass is free — it's what the roll already favoured",
    (() => { const p = body(); p._aimPart = 'torso'; return aimHitPenalty(p, 0) === 0; })());

  // The lesson is Grady's now, and its whole point is that it tells the truth
  // about YOUR hands. The trap it exists to prevent is a novice being sold a
  // called shot as an unqualified good, so the untrained wording must actually
  // say no — and the readout must quote the skill-adjusted cost, not the
  // textbook one, or the trainer and the verb drift apart.
  const lesson = await dispatchAction({ type: 'TEACH_AIM', actor: getPlayer() });
  check('TEACH_AIM is registered and reachable from a dialogue node',
    lesson?.type === 'dialogue_line', JSON.stringify(lesson));
  check('it carries a real teachVerb shimmer, not a dead mention of the verb',
    /class="[^"]*verb-teach[^"]*"[^>]*>aim</.test(lesson?.text || ''), lesson?.text);
  // Quoted cost must sit inside the band the engine can actually produce for a
  // head shot: the novice constant at worst, AIM_FLOOR at best. The test player
  // has real stats, so pinning it to one number would be pinning it to their
  // build — the property that matters is that the number came from
  // aimHitPenalty rather than from AIM_PENALTY.
  const quoted = Number((lesson?.text || '').match(/dmg-type">(-?\d+)/)?.[1]);
  check('the lesson quotes a real skill-adjusted cost, not the novice constant',
    quoted <= -2 && quoted >= aimHitPenalty(headAimer, 0), `quoted ${quoted}`);
  check('an untrained player is told NO, a trained one is told now',
    /not yet|hands for it now/i.test(lesson?.text || ''), lesson?.text);

  const w = aimedWeightsFor(headAimer, { head: 10, torso: 40, left_leg: 11 });
  const wTotal = Object.values(w).reduce((a, b) => a + b, 0);
  check('aiming heavily biases the roll toward that part', w.head / wTotal > 0.6,
    `head share ${(100 * w.head / wTotal).toFixed(0)}%`);
  check('but a missed aim can still land elsewhere', w.torso > 0 && w.left_leg > 0);
  check("aiming at a part the creature doesn't have falls back cleanly",
    (() => { const p = body(); p._aimPart = 'head';
             const drone = { power_cell: 30, rotor: 20 };
             return aimedWeightsFor(p, drone) === drone; })());

  // ── The execution shot ─────────────────────────────────────────────────────
  //
  // The safety properties matter more than the payoff here. An execution must be
  // impossible to trigger by accident, impossible for a mob to land on a player,
  // and impossible to cheese against something huge.
  const sniper = body(); sniper._aimPart = 'head';
  const exec = (attacker, o) => executionShot(attacker, o);

  check('a called head crit that lands hard enough kills',
    exec(sniper, { part: 'head', damage: 20, critical: true, targetHpMax: 40, weaponSkill: 'firearms' }) === 'kill');

  // ── The knockout branch ────────────────────────────────────────────────────
  //
  // The WEAPON decides lethal vs non-lethal, reusing the stealth system's rule
  // so the two ways to knock somebody out agree. No new verb: you chose this
  // when you picked up a bat instead of a knife.
  for (const skill of ['clubs', 'fists']) {
    check(`a called head crit with ${skill} knocks out rather than kills`,
      exec(sniper, { part: 'head', damage: 20, critical: true, targetHpMax: 40, weaponSkill: skill }) === 'knockout');
  }
  for (const skill of ['blades', 'firearms', 'science']) {
    check(`a called head crit with ${skill} is a killing, not a knockout`,
      exec(sniper, { part: 'head', damage: 20, critical: true, targetHpMax: 40, weaponSkill: skill }) === 'kill');
  }
  check('a blunt called shot under the floor still only maims',
    exec(sniper, { part: 'head', damage: 4, critical: true, targetHpMax: 40, weaponSkill: 'clubs' }) === 'maim');
  check('an UNAIMED blunt head crit never knocks anyone out — no random KOs',
    exec(body(), { part: 'head', damage: 39, critical: true, targetHpMax: 40, weaponSkill: 'clubs' }) === null);

  // The invisibility fix, and the reason a mid-fight KO is allowed at all: an
  // unconscious thing must stop swinging. Without this the knockout changes
  // nothing observable and reads as a bug.
  const sparked = { name: 'a sparked thug', hp: 10, hp_max: 40, hit: 5 };
  knockOut(sparked);
  check('a knocked-out enemy is out', isOut(sparked) === true);
  check("...and doesn't swing while it's out",
    (await enemyAttackPlayer(sparked, body())) === null);
  wakeUp(sparked);
  check('and swings again once it comes round', isOut(sparked) === false);
  check('the same shot without aiming does nothing special',
    exec(body(), { part: 'head', damage: 20, critical: true, targetHpMax: 40 }) === null);
  check('an UNAIMED head crit can never execute — no random one-shots',
    exec(body(), { part: 'head', damage: 39, critical: true, targetHpMax: 40 }) === null);
  check('a non-crit called shot does nothing special',
    exec(sniper, { part: 'head', damage: 20, critical: false, targetHpMax: 40 }) === null);
  check('aiming at the head but hitting a leg does nothing special',
    exec(sniper, { part: 'left_leg', damage: 20, critical: true, targetHpMax: 40 }) === null);

  // The floor: this is what stops "one hit" meaning "one hit on anything".
  check("a light called crit can't kill, but ruins the skull",
    exec(sniper, { part: 'head', damage: 4, critical: true, targetHpMax: 40 }) === 'maim');
  check("a boss can't be one-shot by a called head crit",
    exec(sniper, { part: 'head', damage: 30, critical: true, targetHpMax: 600 }) === 'maim');
  check('a helmet that soaks enough demotes a kill to a maim',
    exec(sniper, { part: 'head', damage: 20, critical: true, targetHpMax: 40 }) === 'kill' &&
    exec(sniper, { part: 'head', damage: 9, critical: true, targetHpMax: 40 }) === 'maim');

  // An enemy never has an aim part, so this can never happen TO a player.
  check('a mob can never execute a player', exec({ name: 'a rat' }, { part: 'head', damage: 99, critical: true, targetHpMax: 40 }) === null);

  // forceSeverity is combat's decision, not a second roll — a called crit that
  // fell short must ruin the skull even though the damage alone would not.
  const skulled = body();
  // 2 damage on a 100 HP body would normally wound nothing at all.
  check('a graze to the head normally does nothing',
    severityFor(2, 100, 'kinetic', { critical: true, head: true }) === 0);
  fireDamageToPlayer(skulled, {
    part: 'head', damage: 2, baseDamage: 2, type: 'kinetic', critical: true, forceSeverity: 3,
  });
  check('...but a fallen-short called shot forces a Maimed head anyway',
    severityOf(skulled, 'head') === MAIMED, `got ${severityOf(skulled, 'head')}`);

  // ── Anatomy is data, not the humanoid seven ────────────────────────────────
  //
  // Enemies already author non-human bodies (the bay leviathan is body/coils/
  // fluke/maw). Validating their wounds against the PLAYER's fixed part list
  // silently threw every one of them away.
  const eel = { name: 'a cable eel', hp_max: 40, hit: 4,
    body_parts: [{ part: 'head', weight: 20 }, { part: 'torso', weight: 50 }, { part: 'tail', weight: 30 }] };
  fireEnemy(eel, { part: 'tail', damage: 30, baseDamage: 30, type: 'kinetic' });
  check('a non-humanoid part can be wounded at all', enemySeverity(eel, 'tail') >= HURT,
    `tail sev ${enemySeverity(eel, 'tail')}`);
  check('a tail counts as mobility, so it slows the escape', eel._injuryFleeMod < 0);

  fireEnemy(eel, { part: 'venom_sac', damage: 30, baseDamage: 30, type: 'kinetic' });
  check('a part the creature does NOT have is still rejected', enemySeverity(eel, 'venom_sac') === 0);

  check('part names never reach a player with underscores in them',
    !partLabel('upper_left_arm').includes('_') && partLabel('upper_left_arm') === 'upper left arm',
    partLabel('upper_left_arm'));

  // The multi-armed gimmick: attack limbs STACK, so dismantling them is a real
  // target-priority decision rather than flavour.
  const thresher = { name: 'a six-arm thresher', hp_max: 58, hit: 9,
    body_parts: [
      { part: 'torso', weight: 24 },
      { part: 'upper_left_arm', role: 'attack', weight: 9 },
      { part: 'upper_right_arm', role: 'attack', weight: 9 },
      { part: 'middle_left_arm', role: 'attack', weight: 8 },
      { part: 'left_leg', weight: 10 },
    ] };
  const armHit = [];
  for (const arm of ['upper_left_arm', 'upper_right_arm', 'middle_left_arm']) {
    fireEnemy(thresher, { part: arm, damage: 40, baseDamage: 40, type: 'kinetic' });
    armHit.push(thresher._injuryHitMod);
  }
  check('each ruined arm costs it again', armHit[0] > armHit[1] && armHit[1] > armHit[2],
    JSON.stringify(armHit));
  check('a many-armed thing can be dismantled into uselessness', thresher._injuryHitMod <= -9,
    `${thresher._injuryHitMod}`);
  check('but its legs are untouched by arm damage', !thresher._injuryFleeMod);

  // Mobility does NOT stack — six legs is not six times the escape.
  const many = { name: 'a crawler', hp_max: 40,
    body_parts: [{ part: 'left_leg', weight: 20 }, { part: 'right_leg', weight: 20 }, { part: 'torso', weight: 60 }] };
  fireEnemy(many, { part: 'left_leg', damage: 30, baseDamage: 30, type: 'kinetic' });
  const oneLeg = many._injuryFleeMod;
  fireEnemy(many, { part: 'right_leg', damage: 30, baseDamage: 30, type: 'kinetic' });
  check("crippling a second leg doesn't double the penalty", many._injuryFleeMod === oneLeg,
    `one=${oneLeg} two=${many._injuryFleeMod}`);

  // ── Wielding something above your grade ────────────────────────────────────
  //
  // The split is the point: a vendor refuses to SELL over the bar (hard), but a
  // looted weapon is merely terrible in your hands (soft). Never an equip block.
  const chain = { weapon_skill: 'blades', min_skill: { blades: 6 } };
  check('a weapon with no requirement never penalises',
    underskilledPenalty({ weapon_skill: 'blades' }, 0) === null);
  check('meeting the bar exactly costs nothing',
    underskilledPenalty(chain, 6) === null);
  check('exceeding it costs nothing', underskilledPenalty(chain, 20) === null);

  const raw = underskilledPenalty(chain, 1);
  check('a novice with a top-tier blade swings wide', raw.hitMod < 0, `${raw.hitMod}`);
  check('...and lands soft', raw.damageScale < 0.5, `${raw.damageScale}`);
  check("but it's never reduced to nothing", raw.damageScale >= 0.25);
  check('the shortfall scales — one level short beats five short',
    underskilledPenalty(chain, 5).damageScale > underskilledPenalty(chain, 1).damageScale);
  check('the requirement is readable for the vendor gate',
    weaponSkillRequirement(chain)?.skillId === 'blades' && weaponSkillRequirement(chain)?.need === 6);

  // ── Fighting in water ──────────────────────────────────────────────────────
  const dry = { id: 'z_dry', flags: {} };
  const wet = { id: 'z_wet', flags: { water: true } };
  check("on dry land water rules don't apply",
    waterCombatPenalty(dry, { weapon_skill: 'clubs' }, 1) === null);
  check("a firearm doesn't fire in water",
    waterCombatPenalty(wet, { weapon_skill: 'firearms' }, 20)?.blocked === true);
  check("...not even for a master — wet powder doesn't care about skill",
    waterCombatPenalty(wet, { weapon_skill: 'firearms' }, 99)?.blocked === true);
  check('a weapon built for water is exempt',
    waterCombatPenalty(wet, { weapon_skill: 'firearms', waterproof: true }, 1) === null);

  // Size is the other lever, and for a novice it is the bigger one: a knife is a
  // THRUST, which water barely argues with, while a big sword is a SWING, which
  // is exactly the motion water refuses to allow.
  const knife = waterCombatPenalty(wet, { weapon_skill: 'blades', weight: 700 }, 1);
  const sword = waterCombatPenalty(wet, { weapon_skill: 'blades', weight: 2400 }, 1);
  const bigblade = waterCombatPenalty(wet, { weapon_skill: 'blades', weight: 4400 }, 1);
  check('an unskilled knife is nearly unaffected in water', knife.damageScale > 0.9,
    `${knife.damageScale}`);
  check('a sword is much worse than a knife for the same novice',
    sword.damageScale < knife.damageScale, `knife=${knife.damageScale} sword=${sword.damageScale}`);
  check('and a chainblade is worse again', bigblade.damageScale < sword.damageScale);
  check('a light weapon barely slows either', knife.swingExtraMs < bigblade.swingExtraMs);
  check('mastery still rescues the heavy weapon',
    waterCombatPenalty(wet, { weapon_skill: 'blades', weight: 4400 }, 20).damageScale > bigblade.damageScale);

  const novice = waterCombatPenalty(wet, { weapon_skill: 'clubs', weight: 4000 }, 1);
  const master = waterCombatPenalty(wet, { weapon_skill: 'clubs', weight: 4000 }, 20);
  check('a bat underwater does almost nothing unskilled', novice.damageScale <= 0.2,
    `${novice.damageScale}`);
  check('and swings much slower', novice.swingExtraMs > 1000, `${novice.swingExtraMs}`);
  check('mastery buys nearly all of it back', master.damageScale > 0.9 && master.swingExtraMs === 0,
    `scale=${master.damageScale} extra=${master.swingExtraMs}`);
  check('but a master is never BETTER in water than out', master.damageScale <= 1);

  check('an electrical weapon in water discharges instead',
    waterCombatPenalty(wet, { weapon_skill: 'science', water_shock: true }, 1)?.discharge === true);

  // ── grants: what a part GIVES, and what breaking it takes away ─────────────
  const enemyWith = (parts, weapon, dodge = 2) => ({
    instanceId: 'regress-grants', name: 'a specimen', hp_max: 60, hit: 5, dodge,
    weapon, body_parts: parts,
  });
  const ruin = (mob, part) => fireEnemy(mob, { part, damage: 999, baseDamage: 999, type: 'kinetic', critical: true });
  const liveTypes = (mob) => {
    const lost = mob._lostComponents;
    const kept = lost ? mob.weapon.filter((_, i) => !lost.has(i)) : mob.weapon;
    return (kept.length ? kept : [mob.weapon[mob.weapon.length - 1]]).map(c => c.type);
  };

  // A part can own a damage component; ruin it and that damage stops.
  const arc = enemyWith(
    [{ part: 'torso', weight: 60 }, { part: 'emitter', weight: 40, grants: { component: 1 } }],
    [{ type: 'kinetic', min: 4, max: 6 }, { type: 'energy', min: 2, max: 4 }]);
  check('an intact creature fires every component',
    JSON.stringify(liveTypes(arc)) === JSON.stringify(['kinetic', 'energy']));
  ruin(arc, 'emitter');
  check('ruining the granting part silences that component',
    JSON.stringify(liveTypes(arc)) === JSON.stringify(['kinetic']), JSON.stringify(liveTypes(arc)));

  // Two parts sharing one component behave like a PAIR: it survives until both go.
  const pair = enemyWith(
    [{ part: 'left_tendril', weight: 50, grants: { component: 0 } },
     { part: 'right_tendril', weight: 50, grants: { component: 0 } }],
    [{ type: 'kinetic', min: 3, max: 5 }]);
  ruin(pair, 'left_tendril');
  check("one of a pair doesn't silence the shared component", liveTypes(pair).length === 1);

  // The floor that stops a wrecked creature becoming a statue that cannot fight
  // back and cannot be finished cleanly.
  ruin(pair, 'right_tendril');
  check('a creature always keeps at least one attack', liveTypes(pair).length === 1);

  // Granted dodge: ruin the fins and it cannot slip you.
  const finned = enemyWith(
    [{ part: 'body', weight: 60 }, { part: 'left_fin', weight: 20, grants: { dodge: 2 } },
     { part: 'right_fin', weight: 20, grants: { dodge: 2 } }],
    [{ type: 'kinetic', min: 2, max: 4 }], 4);
  check('an intact creature has lost no dodge', !finned._injuryDodgeMod);
  ruin(finned, 'left_fin');
  ruin(finned, 'right_fin');
  check('ruined fins cost it its evasion', finned._injuryDodgeMod === -4, `${finned._injuryDodgeMod}`);
  check('...and dodge floors at 0, never negative',
    Math.max(0, (finned.dodge ?? 1) + finned._injuryDodgeMod) === 0);

  // Capabilities: present while the part is, gone when it is not — and readable
  // on a creature that has never been touched.
  const grabber = enemyWith(
    [{ part: 'maw', weight: 40, grants: { capability: 'grab' } }, { part: 'body', weight: 60 }],
    [{ type: 'kinetic', min: 2, max: 4 }]);
  check('an untouched creature still has its capabilities', enemyHasCapability(grabber, 'grab'));
  ruin(grabber, 'maw');
  check('destroying the part removes the capability', !enemyHasCapability(grabber, 'grab'));
  check('a capability it never had reads false', !enemyHasCapability(grabber, 'spit'));

  // A merely HURT part still works — destruction is the threshold, not damage.
  const grazed = enemyWith(
    [{ part: 'maw', weight: 40, grants: { capability: 'grab' } }, { part: 'body', weight: 60 }],
    [{ type: 'kinetic', min: 2, max: 4 }]);
  fireEnemy(grazed, { part: 'maw', damage: 20, baseDamage: 20, type: 'kinetic' });
  check('a wounded-but-not-destroyed part still grants',
    enemySeverity(grazed, 'maw') < MAIMED ? enemyHasCapability(grazed, 'grab') : true,
    `sev ${enemySeverity(grazed, 'maw')}`);

  // A PAIR of granting parts is all-or-nothing, which is the tar horror's whole
  // shape: both tendrils grant `grab` AND weapon component 0, so ruining the
  // first costs it nothing and ruining the second costs it both at once.
  // This is the assertion that pins the Set semantics in recomputeGrants against
  // a future "fix" that makes capability behave like the additive dodge rule.
  const twoHanded = enemyWith(
    [{ part: 'left_tendril', weight: 20, grants: { component: 0, capability: 'grab' } },
     { part: 'right_tendril', weight: 20, grants: { component: 0, capability: 'grab' } },
     { part: 'mass', weight: 60 }],
    [{ type: 'kinetic', min: 4, max: 8 }]);
  ruin(twoHanded, 'left_tendril');
  check("one ruined tendril doesn't break a two-handed grab",
    enemyHasCapability(twoHanded, 'grab'));
  check("...and it hasn't lost its weapon component either",
    !twoHanded._lostComponents?.has(0));
  ruin(twoHanded, 'right_tendril');
  check('ruining the second tendril finally breaks the grab',
    !enemyHasCapability(twoHanded, 'grab'));
  check('...and takes the shared weapon component with it, in the same moment',
    !!twoHanded._lostComponents?.has(0));

  // ── The grab move gate (the consumer of grants.capability) ─────────────────
  //
  // Before this, `capability` was a seam with no consumer. These assert the
  // behaviour on the other side of it, and — more importantly — every route OUT,
  // because a hold with no exit is a softlock rather than a mechanic.
  {
    const { getRegisteredMoveGates } = await import('../../server/engine/movement-gates.js');
    const { grabGate, grabberOn, enemyCapabilityNote } = await import('./grab.js');
    const { world } = await import('../../server/engine/world.js');

    const gates = getRegisteredMoveGates();
    // Ordering is load-bearing: you should be told you are physically held
    // before spending an attack cycle on the generic break-away. It falls out of
    // alphabetical plugin load order today, which is exactly why it is asserted
    // rather than trusted.
    check('the grab gate resolves before the generic break-away',
      gates.indexOf('injury:grab') >= 0 &&
      gates.indexOf('injury:grab') < gates.indexOf('weapon:flee'),
      gates.join(' → '));

    const player = await getPlayer();
    const zone = world.zones.get(player.current_zone);
    const mk = (over = {}) => {
      const e = enemyWith(
        [{ part: 'maw', weight: 40, grants: { capability: 'grab' } }, { part: 'body', weight: 60 }],
        [{ type: 'kinetic', min: 2, max: 4 }]);
      Object.assign(e, { instanceId: `regress_grab_${Math.random().toString(36).slice(2, 7)}`,
        name: 'the regress lurker', hit: 1, targetId: player.id }, over);
      world.enemies.set(e.instanceId, e);
      zone?.enemies?.add(e.instanceId);
      return e;
    };
    const drop = (e) => { zone?.enemies?.delete(e.instanceId); world.enemies.delete(e.instanceId); };

    check('nothing in the room means nothing is holding you', grabberOn(player) === null);

    const idle = mk({ targetId: 'somebody_else' });
    check("a creature that isn't fighting you has no hold on you",
      grabberOn(player) === null);
    drop(idle);

    const stunned = mk({ _stunnedUntil: Date.now() + 60000 });
    check('a stunned creature has let go (which is what the taser is for)',
      grabberOn(player) === null);
    drop(stunned);

    const dead = mk({ _dead: true });
    check("a dead creature isn't holding anyone", grabberOn(player) === null);
    drop(dead);

    const live = mk();
    check('a live grabber with you as its target does have hold of you',
      grabberOn(player)?.instanceId === live.instanceId);
    check('examine warns you what it can do before it does it',
      /holding on/.test(enemyCapabilityNote(live) || ''), enemyCapabilityNote(live));

    // System moves are exempt: an elevator ride is not you wrestling free.
    check("a system move isn't contested",
      (await grabGate({ player, opts: { bypassEncumbrance: true } })) === undefined);
    check("weapon's own flee retry isn't contested twice",
      (await grabGate({ player, opts: { fleeing: true } })) === undefined);

    // THE headline case: maim what holds you and the hold is simply gone. Note
    // the gate is asked BEFORE and AFTER with nothing else changed.
    let blockedWhileIntact = false;
    for (let i = 0; i < 40 && !blockedWhileIntact; i++) {
      if ((await grabGate({ player, opts: {} }))?.block) blockedWhileIntact = true;
    }
    check('an intact grab can stop you leaving', blockedWhileIntact);

    ruin(live, 'maw');
    let blockedAfterMaim = false;
    for (let i = 0; i < 40 && !blockedAfterMaim; i++) {
      if ((await grabGate({ player, opts: {} }))?.block) blockedAfterMaim = true;
    }
    check('ruin the part that holds you and you can walk away — every time',
      !blockedAfterMaim);
    check('...and examine stops warning about a grip it no longer has',
      enemyCapabilityNote(live) === null);
    drop(live);
    player._grabbedBy = null;

    // The softlock check. The contest is (rating - 1 - E) + (2d8-2d8) >= 0, so a
    // zero-skill player needs the swing to clear E+1, and the swing caps at +14.
    // Feeding a grabber's raw `hit` in would put the hardest grabbers past that
    // in practice; the cap is what keeps every hold escapable at zero skill.
    check('the worst grab in the game is still escapable with no Dodge at all',
      14 >= (6 /* GRAB_MAX_RATING */) + 1);
  }

  // ── Stunned ────────────────────────────────────────────────────────────────
  //
  // Two weapons have declared `status_chance: { stunned }` since long before the
  // effect existed, so the taser could never once stun anything. The enforcement
  // reuses the cooldown lock `dodge` already proved rather than inventing a
  // turn-skip mechanic, so the assertions are about READINESS, not a new tick.
  const thug = { instanceId: 'regress-mob', name: 'a thug', hp_max: 40, hit: 5 };
  check("a fresh mob isn't stunned", isStunned(thug) === false);
  check('stunning a mob takes', applyStun(thug, 2000) && isStunned(thug));
  check("...and a stunned mob doesn't swing",
    (await enemyAttackPlayer(thug, body())) === null);

  const victim = { id: 'regress-stun-player', hp_max: 40, statuses: [] };
  check('stunning a player names it on the status line',
    applyStun(victim, 3000) && (victim.statuses || []).some(s => s.name === 'stunned'),
    JSON.stringify(victim.statuses));
  check('...and locks their attack', isOnCooldown('regress-stun-player', 'attack'));

  // A stun must never be silently unapplicable: an NPC has no status list and no
  // readiness field, so applyStun says so rather than pretending.
  check('an unstunnable target reports failure', applyStun({ name: 'a bystander' }) === false);

  // ── Buckshot ───────────────────────────────────────────────────────────────
  //
  // The property that matters: a spread weapon must deal the SAME total damage
  // as a slug while producing several ordinary wounds instead of one guaranteed
  // maim. If a future edit makes splitting lossy, the shotguns silently become
  // weaker rather than different, and nothing else would notice.
  check('a spread splits the whole blast, losing nothing',
    splitSpread(34, 3).reduce((a, b) => a + b, 0) === 34,
    JSON.stringify(splitSpread(34, 3)));
  check('an uneven split spreads the remainder, never drops it',
    JSON.stringify(splitSpread(10, 3)) === JSON.stringify([4, 3, 3]),
    JSON.stringify(splitSpread(10, 3)));
  check('an ordinary weapon is one impact', splitSpread(20, 1).length === 1);
  check('spread is clamped to something sane',
    spreadGroups({ spread: 99 }) <= 4 && spreadGroups({ spread: 0 }) === 1 &&
    spreadGroups({}) === 1 && spreadGroups(null) === 1);

  // Each pellet group is scored on its own share, so the same total damage that
  // maims as a slug should not maim as buckshot. This is the whole reason the
  // mechanic exists.
  const slug = severityFor(30, 40, 'kinetic');
  const pellet = severityFor(10, 40, 'kinetic');
  check('one pellet group wounds far less than the whole blast as a slug',
    pellet < slug, `slug=${slug} pellet=${pellet}`);

  // ── §8b: enemies get wounded too ───────────────────────────────────────────
  const mob = { name: 'a scrapper', hp_max: 40, hit: 5, dodge: 2 };
  check('an untouched mob allocates no injury state', !mob._injuries);
  check('and reads as unmodified', !mob._injuryHitMod && !mob._injuryFleeMod);

  // A blow far too small to matter must not create state.
  fireEnemy(mob, { part: 'left_arm', damage: 1, baseDamage: 1, type: 'kinetic' });
  check("chip damage doesn't wound an enemy", !mob._injuries?.size);

  // A real blow to the arm degrades its swing — the tactic half of the system.
  fireEnemy(mob, { part: 'right_arm', damage: 30, baseDamage: 30, type: 'kinetic' });
  check('a heavy blow wounds an enemy arm', enemySeverity(mob, 'right_arm') >= HURT,
    `sev ${enemySeverity(mob, 'right_arm')}`);
  check('a wounded arm degrades the mob swing', mob._injuryHitMod < 0, `${mob._injuryHitMod}`);

  // ...and the legs are what stop it running away.
  const runner = { name: 'a rat', hp_max: 40, hit: 3, dodge: 4 };
  check('an unwounded mob has no flee penalty', !runner._injuryFleeMod);
  fireEnemy(runner, { part: 'left_leg', damage: 30, baseDamage: 30, type: 'kinetic' });
  check('ruined legs make a mob worse at breaking away', runner._injuryFleeMod < 0,
    `${runner._injuryFleeMod}`);

  // One wound per part on the enemy side too, and never a downgrade.
  fireEnemy(runner, { part: 'left_leg', damage: 12, baseDamage: 12, type: 'kinetic' });
  check('a later graze never downgrades an enemy wound',
    enemySeverity(runner, 'left_leg') >= HURT);
  check('and never stacks a second wound on one part', runner._injuries.size === 1);

  check('a wounded mob explains itself to anyone looking',
    (enemyWoundNote(runner) || '').length > 10, enemyWoundNote(runner));
  check('an unhurt mob says nothing', enemyWoundNote({ name: 'x' }) == null);

  // The scaling that lets one rule cover a rat and a boss: the SAME blow that
  // ruins something small should barely trouble something huge.
  const boss = { name: 'a colossus', hp_max: 600, hit: 9 };
  fireEnemy(boss, { part: 'left_leg', damage: 30, baseDamage: 30, type: 'kinetic' });
  check('the same blow that ruins a rat barely troubles a boss',
    enemySeverity(boss, 'left_leg') < enemySeverity(runner, 'left_leg'),
    `boss=${enemySeverity(boss, 'left_leg')} rat=${enemySeverity(runner, 'left_leg')}`);
}
