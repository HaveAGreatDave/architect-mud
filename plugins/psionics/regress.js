/**
 * The single most important case in this file: an unranked player gets
 * `Unknown command.` from every psionic verb, and a ranked one does not.
 *
 * That is not politeness about error messages. The whole deniability design rests
 * on the ladder being DISCOVERED rather than advertised — below the floor an
 * ability must not exist for you, the `ORGAN_FLOOR` convention from
 * plugins/mutations/organs.js. A refusal that explains itself is a locked list,
 * and a locked list tells every player in the game exactly what the Exodus can do.
 */
import {
  psiState, spend, recover, relieveStrain, strainBand, strainBandOf,
  abilityRefusal, abilityCost, focusMultiplier, maxResonance,
  psiRank, hasChosenFocus, addSignature, signatureAt, forgetPlayer,
  UNKNOWN, PSI_CAP, _liveStateCount,
} from '../../server/engine/psionics.js';
import {
  RANKS, rankAtLeast, rankIndex, getDisciplines, getPsiAbilities,
  unknownAbilityKeys, unreachableDisciplines, abilityApplies,
  isCompelDenied, deniedCompelVerbList, getPsiAbility,
} from '../../server/engine/psionics-abilities.js';
import { psiResistance, psiResistFraction, registerPsiResistor, clearPsiResistor, CONTRIBUTOR_CAP } from '../../server/engine/psi-resist.js';
import { addResidue, residueAt, clearResidue, _residueZoneCount } from './residue.js';
import { violatesLowRank, voice, speaksPlainly, CAUSAL_WORDS } from './prose.js';
import { WARD_SOAK } from './aegis.js';
import { _test as taboo } from './reactions.js';
import { _test as door } from './door.js';
import { _test as purifier } from './purifier.js';
import { SKILLS } from '../../server/engine/skills.js';
import { dispatchAction } from '../../server/engine/actions.js';

export default async function regress({ check, getPlayer }) {
  const ZONE = 'zone_regress_psi';

  // ── The vocabulary contracts (the mutation-effects build-failure pattern) ──
  check('every ability names a registered discipline and target kind',
    unknownAbilityKeys().length === 0, unknownAbilityKeys().join(', '));
  check('every registered discipline has at least one ability in it',
    unreachableDisciplines().length === 0, unreachableDisciplines().join(', '));
  check('the psionics skill exists in the arcane category',
    SKILLS.psionics?.category === 'arcane', `got ${SKILLS.psionics?.category}`);
  check('there is deliberately no second psi_resistance skill',
    !SKILLS.psi_resistance, 'resistance must be derived, never a second IP track');

  // Applicability is the whole reason abilities and target kinds are separate
  // tables. You cannot read the surface thoughts of a door.
  check('you cannot press a place', !abilityApplies('press', 'place'));
  check('you can press a person', abilityApplies('press', 'person'));
  check('you cannot pull a person', !abilityApplies('pull', 'person'));
  check('residue reads a place', abilityApplies('residue', 'place'));

  // ── The compulsion deny list ───────────────────────────────────────────────
  //
  // The limit on compulsion is DURATION, not vocabulary — any verb the target
  // could have typed, they can be made to type. Except the ones that move value:
  // a mind-controlled `give` skips thievery, trade escrow and the wanted system
  // and would be the best robbery in the game.
  check('the compel deny list is not empty', deniedCompelVerbList().length > 0);
  for (const verb of ['give', 'pay', 'trade', 'sell', 'bank', 'transfer']) {
    check(`compulsion refuses '${verb}' (value transfer)`, isCompelDenied(verb));
  }
  check('a puppet can never make a puppet', isCompelDenied('compel'));
  check('compulsion allows an ordinary verb', !isCompelDenied('north'));
  check('compulsion allows dropping a weapon', !isCompelDenied('drop'));
  check('an empty verb is refused rather than allowed', isCompelDenied(''));

  // ── The rank ladder ────────────────────────────────────────────────────────
  check('the ladder has eight rungs', RANKS.length === 8, `got ${RANKS.length}`);
  check('an unranked player is below everything', !rankAtLeast(null, 'awakened'));
  check('master outranks channeler', rankAtLeast('master', 'channeler'));
  check('channeler does not outrank master', !rankAtLeast('channeler', 'master'));
  check('an unknown rank never satisfies a gate', !rankAtLeast('wizard', 'awakened'));

  // ── The gate: unranked players get Unknown command, never an explanation ───
  const p = getPlayer();
  const savedFlags = p._flags;
  const savedZone = p.current_zone;
  const savedHp = p.hp;

  p._flags = new Map();
  p.current_zone = ZONE;

  check('an unawakened player cannot dwell', abilityRefusal(p, 'residue', 'place') === UNKNOWN);
  check('an unawakened player cannot press', abilityRefusal(p, 'press', 'person') === UNKNOWN);
  check('an unknown ability id is UNKNOWN, never a crash',
    abilityRefusal(p, 'no_such_ability', 'person') === UNKNOWN);

  // Awakened: the entry abilities open, the later ones stay invisible.
  p._flags.set('psi_rank', 'awakened');
  check('an awakened player has a resonance pool', maxResonance(p) > 0);
  check('awakened opens psychometry', abilityRefusal(p, 'residue', 'place') === null);
  check('awakened does NOT open telekinesis', abilityRefusal(p, 'pull', 'object') === UNKNOWN);
  check('awakened does NOT open a strike', abilityRefusal(p, 'press', 'person') === UNKNOWN);

  // Gate 4: a narrative flag nothing raises except authored content. This is what
  // keeps the top of the ladder genuinely rare rather than merely expensive.
  p._flags.set('psi_rank', 'master');
  p._flags.set('psi_focus', 'ergokinesis');
  check('a top ability is invisible without its unlock flag',
    abilityRefusal(p, 'cascade', 'place') === UNKNOWN);
  p._flags.set('psi_stillhouse_rite', '1');
  check('the unlock flag opens it', abilityRefusal(p, 'cascade', 'place') === null);

  // Gate 2: focusOnly is unreachable off-focus at ANY cost.
  p._flags.set('psi_focus', 'aegis');
  check('a focusOnly ability is unreachable outside your major',
    abilityRefusal(p, 'cascade', 'place') === UNKNOWN,
    'there must be no build that both takes bodies and walks dreams');
  check('the same ability is reachable inside your major',
    (p._flags.set('psi_focus', 'ergokinesis'), abilityRefusal(p, 'cascade', 'place')) === null);

  // ── Major / minor pricing ──────────────────────────────────────────────────
  p._flags.set('psi_rank', 'seer');
  p._flags.set('psi_focus', 'telekinesis');
  p._flags.set('psi_focus_second', 'psychometry');
  check('you have committed to a major', hasChosenFocus(p));
  const major = focusMultiplier(p, 'telekinesis');
  const minor = focusMultiplier(p, 'psychometry');
  const foreign = focusMultiplier(p, 'aegis');
  check('your major costs base', major.resonance === 1 && major.tier === 'primary');
  check('your minor costs more than your major', minor.resonance > major.resonance);
  check('a foreign discipline costs more than your minor', foreign.resonance > minor.resonance);
  check('the cost ladder is major < minor < foreign',
    major.resonance < minor.resonance && minor.resonance < foreign.resonance);
  check('abilityCost applies the multiplier',
    abilityCost(p, 'impression').resonance > getPsiAbility('impression').resonance,
    'psychometry is the MINOR here, so it must cost above base');

  // Below the commit rung everything is open, so a player can taste all six.
  p._flags.set('psi_rank', 'sensitive');
  check('before committing, nothing is priced as foreign',
    focusMultiplier(p, 'aegis').tier === 'open');

  // ── Resonance and strain ───────────────────────────────────────────────────
  p._flags.set('psi_rank', 'adept');
  forgetPlayer(p.id);
  const fresh = psiState(p);
  check('an unknown player starts rested', fresh.resonance === fresh.max && fresh.strain === 0);

  spend(p, 5, 30);
  const after = psiState(p);
  check('spending costs resonance', after.resonance < fresh.max);
  check('spending accrues strain', after.strain >= 29);
  check('moderate strain is a nosebleed band', strainBand(30) === 'moderate');
  check('the ladder climbs', strainBand(0) === 'low' && strainBand(60) === 'high'
    && strainBand(80) === 'critical' && strainBand(110) === 'overload');

  // Critical strain refuses further work — a seizure must be the price of a
  // CHOICE to keep going, not something that happens because a player did not
  // know the number.
  spend(p, 0, 50);
  check('a shaking psion is refused rather than allowed to seize blindly',
    typeof abilityRefusal(p, 'residue', 'place') === 'string',
    `band was ${strainBandOf(p)}`);

  relieveStrain(p, 200);
  check('strain can be relieved', strainOfSafe(p) === 0);

  // Resonance exhaustion refuses, and says so.
  spend(p, 9999, 0);
  const refusal = abilityRefusal(p, 'residue', 'place');
  check('an empty psion is refused with an explanation, not UNKNOWN',
    typeof refusal === 'string' && refusal !== UNKNOWN);
  recover(p, 9999);
  check('rest gives it back', psiState(p).resonance === psiState(p).max);

  // ── Resistance is derived, and capped ──────────────────────────────────────
  const baseline = psiResistance(p);
  check('everyone has some baseline resistance', baseline > 0,
    'a resistance you have to go and buy is one most players will not have');
  check('a null target does not throw', psiResistance(null) === 0);

  registerPsiResistor(() => 9999, 'regress-greedy');
  const capped = psiResistance(p);
  check('one contributor cannot become the whole answer',
    capped <= baseline + CONTRIBUTOR_CAP + 0.001, `got ${capped} from ${baseline}`);
  registerPsiResistor(() => { throw new Error('boom'); }, 'regress-broken');
  check('a broken resistor does not make a mind unreadable',
    psiResistance(p) > 0);
  clearPsiResistor('regress-greedy');
  clearPsiResistor('regress-broken');

  check('nothing psionic ever reaches certainty (PSI_CAP)',
    psiResistFraction({ stat_cool: 99, stat_brains: 99 }) <= PSI_CAP,
    'a mind that literally cannot be touched has left the consequence loop');
  check('PSI_CAP is below 1', PSI_CAP < 1);

  // ── Residue: the world's own exhaust ───────────────────────────────────────
  clearResidue(ZONE);
  check('a quiet room remembers nothing', residueAt(ZONE).length === 0);
  addResidue(ZONE, 'death', 3, 'someone');
  addResidue(ZONE, 'fear', 1, 'someone');
  const found = residueAt(ZONE);
  check('a room remembers what happened in it', found.length === 2);
  check('the strongest mark reads first', found[0].kind === 'death');
  check('an impression never carries a handle',
    found.every(f => !('handle' in f) && !('name' in f)),
    'cameras answer WHO; psychometry must not');

  // The ring buffer is bounded — a room where a lot happens must not grow an
  // array nothing trims.
  for (let i = 0; i < 40; i++) addResidue(ZONE, 'violence', 1, 'someone');
  check('the residue buffer is bounded', residueAt(ZONE).length <= 12,
    `got ${residueAt(ZONE).length}`);
  clearResidue(ZONE);

  // ── The deniability law ────────────────────────────────────────────────────
  //
  // This is the one that protects the setting. Codex XIV refuses to confirm any
  // of this is real, and a single "you sense their fear" in a low-rank line turns
  // an unnerving moment into a stat readout.
  check('the low-rank law catches a causal claim',
    violatesLowRank('You sense their fear.') !== null);
  check('the low-rank law catches the jargon',
    violatesLowRank('Your psionic power surges.') !== null);
  check('the low-rank law catches an em dash',
    violatesLowRank('The door opens — nobody touched it.') !== null,
    'the em dash belongs to the Architect and the Ascendants');
  check('an observational line passes',
    violatesLowRank('The set of their shoulders is wrong for what they are saying.') === null);

  p._flags = new Map([['psi_rank', 'awakened']]);
  check('a low-rank player does not speak plainly', !speaksPlainly(p));
  const scrubbed = voice(p, { low: 'A door opens — quietly.', high: 'x' });
  check('voice() strips the em dash from output', !scrubbed.includes('—'), scrubbed);
  p._flags.set('psi_rank', 'seer');
  check('a seer speaks plainly', speaksPlainly(p));
  check('every causal word is a non-empty string', CAUSAL_WORDS.every(w => typeof w === 'string' && w.length));

  // ── Signatures ─────────────────────────────────────────────────────────────
  addSignature(p.id, ZONE, 'telekinesis', 2);
  check('working leaves a mark on the room', signatureAt(ZONE).length === 1);
  check('the mark knows which discipline it was',
    signatureAt(ZONE)[0].discipline === 'telekinesis');

  // ── Aegis: a ward is typed soak, never a special case ──────────────────────
  check('a ward is strong against kinetic', WARD_SOAK.kinetic > WARD_SOAK.edged);
  check('a ward is weak against energy', WARD_SOAK.energy < WARD_SOAK.kinetic,
    'a flat number across all types would make this an armour upgrade with a bill');
  check('no ward soak is total', Object.values(WARD_SOAK).every(v => v < 20));

  // ── The armour taboo is SOCIAL and never mechanical ────────────────────────
  //
  // The load-bearing case in this section: nothing anywhere refuses, blocks or
  // penalises armour. If a future edit makes the taboo mechanical, the faction
  // stops being principled and starts being petty.
  check('an unarmoured player trips nothing', !taboo.wearsArmour({ _wornRows: new Map() }));
  check('a bare player object trips nothing', !taboo.wearsArmour({}));
  check('armour is detected from the worn rows the engine already caches',
    taboo.wearsArmour({ _wornRows: new Map([['torso', { soak: { kinetic: 4 } }]]) }));
  check('a garment with no soak is not armour',
    !taboo.wearsArmour({ _wornRows: new Map([['torso', { soak: {} }]]) }));
  check('the taboo only applies in an authored Exodus space',
    !taboo.isExodusSpace({ flags: {} }) && taboo.isExodusSpace({ flags: { exodus_space: true } }));
  check('the stated reason is respect and renunciation, never Aegis',
    /respect/i.test(taboo.EXPLAINED) && !/aegis|ward|shield/i.test(taboo.EXPLAINED),
    'no line may make the unstated argument — see reactions.js');
  for (const line of taboo.LINES) {
    check('a taboo line never names the real reason',
      !/aegis|ward|shield|psionic/i.test(line), line);
  }

  // ── The door: the induction beat fires once ────────────────────────────────
  check('the guide never names the discipline, even while teaching it',
    !/psionic|telekine|power/i.test(door.GUIDE_LINE), door.GUIDE_LINE);
  check('the guide line has no em dash', !door.GUIDE_LINE.includes('—'));

  // ── The Purifier warns before it takes anything ────────────────────────────
  const victim = { id: 'regress-purify', _mutations: new Map([['a', {}], ['b', {}]]), _augments: new Map([['c', {}]]) };
  const bill = purifier.billFor(victim);
  check('the Purifier counts what it is about to take', bill.mutations === 2 && bill.augments === 1);
  const warn = purifier.warning(bill);
  check('the warning names the exact numbers', /2 mutations/.test(warn) && /1 installed augment/.test(warn));
  check('the warning says it is permanent', /[Pp]ermanent/.test(warn));
  check('the warning offers no reassurance',
    !/don't worry|safe|reversible|undo it later/i.test(warn));
  check('an empty body still gets an honest bill',
    purifier.billFor({}).mutations === 0 && purifier.billFor({}).augments === 0);

  // ── Cleanup: a logout drops everything ─────────────────────────────────────
  //
  // The substrate owns no table by design. If any of this survived a relog it
  // would be state pretending to matter.
  spend(p, 5, 20);
  forgetPlayer(p.id);
  check('logout drops resonance and strain',
    psiState(p).strain === 0 && psiState(p).resonance === psiState(p).max);
  check('logout drops the player\'s signatures', signatureAt(ZONE).length === 0);
  clearResidue(ZONE);

  // ⚠ Restore the SHARED fake player. A suite that leaves rank, flags, hp or a
  // zone behind sends sneak, weightbench and half a dozen others red for reasons
  // that look nothing like psionics.
  p._flags = savedFlags;
  p.current_zone = savedZone;
  p.hp = savedHp;
  delete p.psiAttuned;
  forgetPlayer(p.id);
  check('the shared player is left as we found it',
    p._flags === savedFlags && p.current_zone === savedZone && !p.psiAttuned);
  check('no psionic player state leaked', _liveStateCount() === 0,
    `${_liveStateCount()} players still held`);
  // Deliberately scoped to OUR zone rather than asserting the global count is
  // zero. Other suites kill things, and every death legitimately leaves residue
  // in the room it happened in — that is the whole feature working. A global
  // assertion here would make this suite fail because combat ran, which is the
  // most confusing possible red.
  check('our test zone is left clean', residueAt(ZONE).length === 0,
    `${_residueZoneCount()} zones hold residue, ${residueAt(ZONE).length} in ours`);

  // ── PSI_AWAKEN: the authored door is still a door ─────────────────────────
  //
  // ⚠ ONLY THE REFUSAL PATHS ARE EXERCISED HERE, and that is deliberate rather
  // than lazy. The success path WRITES `psi_rank`, and doing that to the shared
  // fake player would awaken it for every suite that runs after this one —
  // mastery's ladder reads `isAwakened` and would start classifying it as
  // PSIONIC, which is exactly the cross-suite leak the mutations suite already
  // paid for once. The refusals write nothing, so they are safe to assert, and
  // they are the two failures that are otherwise SILENT.
  //
  // The success and no-demote paths are covered by a scratch-player behavioural
  // check run at authoring time (see docs/systems-psionics.md).
  const ghost = { id: '00000000-0000-4000-8000-00000000dead', _flags: new Map() };

  const noStanding = await dispatchAction({
    type: 'PSI_AWAKEN', actor: ghost, params: { rank: 'awakened' },
  });
  check('PSI_AWAKEN refuses somebody the Exodus have not taken in',
    noStanding?.awakened === false && noStanding.reason === 'standing', JSON.stringify(noStanding));
  check('...and writes no flag doing it', !ghost._flags.get('psi_rank'));

  const offLadder = await dispatchAction({
    type: 'PSI_AWAKEN', actor: ghost, params: { rank: 'archmage' },
  });
  // The failure this guards: `psiRank` runs the stored value through rankIndex
  // and returns null for anything unrecognised, so a typo would not throw — it
  // would leave a player unawakened holding a flag that LOOKS set.
  check('PSI_AWAKEN rejects a rank that is not on the ladder, loudly',
    offLadder?.type === 'error', JSON.stringify(offLadder));

  check('every rung the action accepts is a real rung',
    RANKS.length === 8 && RANKS[0] === 'awakened');
}

/** psiState is the only reader; this keeps the strain assertion readable. */
function strainOfSafe(player) {
  return Math.round(psiState(player).strain);
}
