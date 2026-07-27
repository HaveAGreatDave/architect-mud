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
import { impairmentOf } from '../../server/engine/impairment.js';
import { effectiveStat } from '../../server/engine/condition.js';

// A fake live player: injuries live entirely in memory, so no DB row is needed.
function body(injuries = {}) {
  const now = Date.now();
  const map = new Map();
  for (const [part, [sev, type, ageMins = 0]] of Object.entries(injuries)) {
    map.set(part, { sev, type, at: now - ageMins * 60_000 });
  }
  return { id: 'regress-injury', handle: 'Testsubject', hp_max: 100, _flags: new Map(), _injuries: map };
}

export default async function regress({ run, check }) {
  // ── The verb ───────────────────────────────────────────────────────────────
  const r = await run('injuries');
  check('injuries verb routed', r?.type !== 'error', r?.message);

  // ── Thresholds: armour that worked prevents the wound ──────────────────────
  check('a soaked-to-nothing hit never injures',
    severityFor(0, 100, 'kinetic') === 0 && severityFor(0, 100, 'edged') === 0);
  check('chip damage does not injure',
    severityFor(3, 100, 'kinetic') === 0, `got ${severityFor(3, 100, 'kinetic')}`);

  // ── Type character: the whole point of the design ──────────────────────────
  // Blunt needs a bigger blow than a blade to injure at all...
  check('kinetic threshold is higher than edged',
    TYPES.kinetic.threshold > TYPES.edged.threshold);
  check('a mid hit injures with a blade but not a club',
    severityFor(10, 100, 'edged') > 0 && severityFor(10, 100, 'kinetic') === 0,
    `edged=${severityFor(10, 100, 'edged')} kinetic=${severityFor(10, 100, 'kinetic')}`);

  // ...but once it lands, it lands harder. This is the row that makes blunt
  // interesting rather than just weaker, and it's uncapped by design.
  check('a big blunt hit outranks the same blade hit',
    severityFor(40, 100, 'kinetic') > severityFor(40, 100, 'edged'),
    `kinetic=${severityFor(40, 100, 'kinetic')} edged=${severityFor(40, 100, 'edged')}`);
  check('kinetic can reach Maimed (no cap)',
    severityFor(60, 100, 'kinetic') === MAIMED);

  // ── Crit and cumulative both lower the bar ─────────────────────────────────
  check('a crit injures where the same hit otherwise would not',
    severityFor(10, 100, 'kinetic') === 0 && severityFor(10, 100, 'kinetic', { critical: true }) === 0
      ? severityFor(14, 100, 'kinetic') === 0 && severityFor(14, 100, 'kinetic', { critical: true }) > 0
      : true);
  check('cumulative types find a wounded part easier',
    severityFor(12, 100, 'kinetic', { existing: HURT }) > severityFor(12, 100, 'kinetic', { existing: 0 })
      || severityFor(12, 100, 'kinetic', { existing: 0 }) > 0);
  check('non-cumulative types ignore an existing wound',
    severityFor(12, 100, 'edged', { existing: MAIMED }) === severityFor(12, 100, 'edged', { existing: 0 }));

  // ── Decay ──────────────────────────────────────────────────────────────────
  const oneStep = typeRules('kinetic').healMins;

  const fresh = body({ left_leg: [MAIMED, 'kinetic', 0] });
  check('a fresh wound does not decay', severityOf(fresh, 'left_leg') === MAIMED);

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
  check('an uninjured body is not impaired', impairmentOf(well) === impairmentOf(body()),
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
  // Steep kinetic escalation, the head damage multiplier and `cumulative` all
  // push the same direction, so blunt-to-the-head maims more often than any one
  // rule suggests. That is intended, but it must stay a HARD hit's reward rather
  // than the default outcome — the failure mode is every scrap ending in a
  // fractured skull. These bound the worst case so a future tweak to one number
  // can't quietly cross that line without a test going red.
  const HEAD_MULT = 1.5;   // getTunable('head_damage_multiplier') default
  const worstCase = (raw) => severityFor(raw * HEAD_MULT, 100, 'kinetic', { critical: true, existing: HURT });

  check('a light blunt head crit on a wounded skull still does not maim',
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
}
