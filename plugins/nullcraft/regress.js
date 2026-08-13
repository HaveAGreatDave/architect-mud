/**
 * Nullcraft regression suite.
 *
 * The single most important case in this file is `no second implementation`:
 * a camera suppressed by a Null operation must be invisible to the wanted system
 * BY THE SAME PATH a planted jammer uses. If that ever goes red, somebody has
 * given Nullcraft its own opinion about whether a camera is jammed, and the two
 * opinions will disagree in production.
 */
import {
  addTrace, traceOf, clearTrace, forgetPlayer,
  suppressSubsystem, subsystemDown, releaseSubsystem,
  operationDifficulty, operationRefusal, matchTarget,
  setVeil, veilFactor, clearVeil, VEIL_CAP,
  setCarriedJammer, stopCarriedJammer, carriedJamAt,
  TRACE_HALFLIFE_MS,
} from '../../server/engine/nullcraft.js';
import { nullIntrusion, nullStealth, nullJam } from '../../server/engine/hack-gear.js';
import {
  getNullOperation, getNullOperations, getSubsystemKinds,
  operationsFor, operationApplies,
  unknownOperationKeys, unreachableSubsystemKinds,
} from '../../server/engine/nullcraft-ops.js';
import { nullAugmentDown, augmentKey, VITAL } from '../augments/state.js';
import { nullSuppressed, deviceKey } from '../surveillance/nulltarget.js';
import { _test, commands } from './index.js';

export default async function regress({ check }) {
  const P = 'regress-null-player';

  // ── The registry contract (the mutation-effects build-failure pattern) ─────

  check('every operation targets a registered subsystem kind',
    unknownOperationKeys().length === 0,
    unknownOperationKeys().join(', '));

  check('every subsystem kind is reachable by some operation',
    unreachableSubsystemKinds().length === 0,
    unreachableSubsystemKinds().join(', '));

  check('all seven operations are registered',
    getNullOperations().length === 7,
    `got ${getNullOperations().length}`);

  check('subsystem vocabulary is populated',
    getSubsystemKinds().length === 8,
    `got ${getSubsystemKinds().length}`);

  // The applicability rules are the reason ops and subsystems are separate
  // tables. If these collapse, six operations have become one with six skins.
  check('you cannot jam a hydraulic ram', !operationApplies('jam', 'actuation'));
  check('you cannot lock a telemetry stream', !operationApplies('lock', 'telemetry'));
  check('you can jam a sensor', operationApplies('jam', 'sensor'));
  check('sabotage reaches power', operationApplies('sabotage', 'power'));

  check('operations escalate in difficulty',
    getNullOperation('jam').baseDifficulty < getNullOperation('sabotage').baseDifficulty);
  check('the two durable operations are the two that cost the victim money',
    getNullOperations().filter(o => o.kind === 'durable').map(o => o.id).sort().join() === 'powerspike,sabotage');

  // ── Trace: decays at read, no tick anywhere ───────────────────────────────

  clearTrace(P);
  check('a clean player has no trace', traceOf(P) === 0);

  addTrace(P, 50, 10);
  check('trace accrues', Math.round(traceOf(P)) === 50, `got ${traceOf(P)}`);

  // Reach into the clock rather than sleeping: decay is a pure function of
  // elapsed time, so proving it needs no wall time at all.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + TRACE_HALFLIFE_MS;
    const halved = traceOf(P);
    check('trace halves over its half-life',
      halved > 24 && halved < 26, `got ${halved}`);

    Date.now = () => realNow() + TRACE_HALFLIFE_MS * 10;
    check('trace decays to effectively nothing without any tick',
      traceOf(P) < 0.1, `got ${traceOf(P)}`);
  } finally {
    Date.now = realNow;
  }

  // Time away must not be cancelled by one more action — the adjustReputation
  // ordering bug, which only ever shows up in players who took a break.
  clearTrace(P);
  addTrace(P, 40, 0);
  try {
    Date.now = () => realNow() + TRACE_HALFLIFE_MS;
    addTrace(P, 10, 0);
    check('a fresh delta does not resurrect decayed trace',
      traceOf(P) < 31, `got ${traceOf(P)}`);
  } finally {
    Date.now = realNow;
  }
  clearTrace(P);

  // ── Suppression: timestamps, and the refresh rule ─────────────────────────

  const K = 'test:target:1';
  releaseSubsystem(K, 'optics');
  check('nothing is suppressed to begin with', subsystemDown(K, 'optics') === null);

  suppressSubsystem(K, 'optics', 'jam', 5000);
  check('suppression reports WHICH operation, not a boolean',
    subsystemDown(K, 'optics') === 'jam');

  // Refresh must take the LATER expiry — the applyEffect Math.max rule. A second
  // jam landing on a running one must never cut it short.
  suppressSubsystem(K, 'optics', 'jam', 1);
  check('a shorter refresh does not shorten a running suppression',
    subsystemDown(K, 'optics') === 'jam');

  try {
    Date.now = () => realNow() + 10_000;
    check('suppression expires on its own clock, with no sweep',
      subsystemDown(K, 'optics') === null);
  } finally {
    Date.now = realNow;
  }

  // ── THE ONE THAT MATTERS: no second implementation ────────────────────────
  //
  // A Null-suppressed camera must resolve to the same two strings the planted
  // jammer path produces, so every downstream reader (cameraLiveInZone,
  // isWitnessed, feedSnapshot, the hub) inherits it without knowing Nullcraft
  // exists. If this goes red, the wanted system and the feed will disagree.

  const DEV = 'regress-null-cam';
  check('an untouched camera is not suppressed', nullSuppressed(DEV) === null);

  suppressSubsystem(deviceKey(DEV), 'optics', 'jam', 5000);
  check('a Null-jammed camera reads exactly "jammed"',
    nullSuppressed(DEV) === 'jammed', `got ${nullSuppressed(DEV)}`);
  releaseSubsystem(deviceKey(DEV), 'optics');

  suppressSubsystem(deviceKey(DEV), 'optics', 'spoof', 5000);
  check('a Null-spoofed camera reads exactly "spoofed"',
    nullSuppressed(DEV) === 'spoofed', `got ${nullSuppressed(DEV)}`);
  releaseSubsystem(deviceKey(DEV), 'optics');

  check('releasing restores the camera', nullSuppressed(DEV) === null);

  // ── Augments: the same funnel, via getAugments ────────────────────────────

  const AUG = 'aug_test_arm';
  check('untouched chrome is not down', nullAugmentDown(P, AUG) === false);

  suppressSubsystem(augmentKey(P, AUG), 'actuation', 'lock', 5000);
  check('a locked actuator takes the augment offline', nullAugmentDown(P, AUG) === true);
  releaseSubsystem(augmentKey(P, AUG), 'actuation');

  // Telemetry is deliberately not vital: it blinds the OWNER, it does not stop
  // the limb. Collapsing this makes every operation the same operation.
  suppressSubsystem(augmentKey(P, AUG), 'telemetry', 'spoof', 5000);
  check('a spoofed telemetry stream does NOT disable the augment',
    nullAugmentDown(P, AUG) === false);
  releaseSubsystem(augmentKey(P, AUG), 'telemetry');
  check('telemetry is not in the vital set', !VITAL.has('telemetry'));

  // ── Difficulty composition ────────────────────────────────────────────────

  const soft = { security: { rating: 10 } };
  const hard = { security: { rating: 90 } };
  const sub = { id: 'optics', kind: 'sensor', exposure: 40 };
  check('better security is harder',
    operationDifficulty(hard, sub, 'jam') > operationDifficulty(soft, sub, 'jam'));
  check('a more exposed subsystem is easier',
    operationDifficulty(soft, { ...sub, exposure: 90 }, 'jam')
      < operationDifficulty(soft, { ...sub, exposure: 5 }, 'jam'));
  check('difficulty never goes below 1',
    operationDifficulty(soft, { ...sub, exposure: 100000 }, 'jam') >= 1);

  // ── Refusals ──────────────────────────────────────────────────────────────

  const target = { name: 'Test Arm', security: { rating: 20, wireless: true } };
  check('an inapplicable operation is refused',
    !!operationRefusal(null, target, { id: 'ram', kind: 'actuation' }, 'jam'));
  check('an applicable operation is allowed',
    operationRefusal(null, target, { id: 'eye', kind: 'sensor' }, 'jam') === null);

  // The manual-override counterplay — what stops Nullcraft invalidating gear.
  const hardened = { name: 'Hardened Arm', security: { rating: 20, wireless: false } };
  check('a disconnected radio refuses network operations',
    !!operationRefusal(null, hardened, { id: 'net', kind: 'network' }, 'jam'));
  check('a disconnected radio still has physical surfaces',
    operationRefusal(null, hardened, { id: 'eye', kind: 'sensor' }, 'jam') === null);

  // ── Veil: capped, so a player can never become unarrestable ───────────────

  clearVeil(P);
  check('no veil by default', veilFactor(P) === 0);
  setVeil(P, 5.0, 5000);
  check('veil is capped below total invisibility',
    veilFactor(P) === VEIL_CAP && VEIL_CAP < 1, `got ${veilFactor(P)}`);
  clearVeil(P);

  // ── Target matching ───────────────────────────────────────────────────────

  const targets = [
    { key: 'device:1', name: 'Sticky Cam' },
    { key: 'augment:x:y', name: 'Ascendant Servo Arm' },
  ];
  check('matches on an exact name', matchTarget(targets, 'sticky cam')?.key === 'device:1');
  check('matches on a fragment', matchTarget(targets, 'servo')?.key === 'augment:x:y');
  check('an unknown fragment matches nothing', matchTarget(targets, 'zzz') === null);
  check('an empty fragment matches nothing', matchTarget(targets, '') === null);

  // ── Hold duration ─────────────────────────────────────────────────────────

  check('a squeaked win still lasts long enough to notice', _test.holdFor(0) >= 8000);
  check('a better win holds longer', _test.holdFor(10) > _test.holdFor(1));
  check('hold is capped', _test.holdFor(10_000) <= 90_000);

  // ── Bands ─────────────────────────────────────────────────────────────────

  check('security bands ascend', _test.securityBand(5).label === 'OPEN'
    && _test.securityBand(95).label === 'ARCHITECT-GRADE');
  check('exposure bands descend', _test.exposureBand(90).label === 'wide open'
    && _test.exposureBand(0).label === 'sealed');

  // ── The armed-operation handshake ─────────────────────────────────────────
  //
  // A resolve that does not match the armed nonce must do NOTHING. This is the
  // forged-client guard: without it, `nullresolve <anything> 1` would apply an
  // operation the player never played.
  {
    _test.pending.clear();
    const fake = { id: P, handle: 'Regress' };
    const r1 = await _test.cmdNullResolve(['no-such-nonce', '1'], '', fake, () => {});
    check('a resolve with nothing armed is a no-op', r1?.type === 'noop', JSON.stringify(r1));

    _test.pending.set(P, {
      nonce: 'good', targetKey: 'test:t', opId: 'jam', subsystemId: 'optics',
      difficulty: 5, at: Date.now(),
      target: { key: 'test:t', name: 'T', apply: async () => ({ message: 'ok' }) },
      subsystem: { id: 'optics', kind: 'sensor' },
    });
    const r2 = await _test.cmdNullResolve(['wrong', '1'], '', fake, () => {});
    check('a resolve with the WRONG nonce is a no-op', r2?.type === 'noop', JSON.stringify(r2));
    check('...and does not consume the armed operation', _test.pending.has(P));

    // An expired arm is dropped rather than honoured — a board left open for an
    // hour is not a licence to cash it in later.
    _test.pending.get(P).at = Date.now() - 10 * 60 * 1000;
    const r3 = await _test.cmdNullResolve(['good', '1'], '', fake, () => {});
    check('an expired arm is refused', r3?.type === 'noop', JSON.stringify(r3));
    check('...and is cleared', !_test.pending.has(P));
    _test.pending.clear();
    clearTrace(P);
  }

  // ── Hardware: the tag readers ─────────────────────────────────────────────

  check('an untagged item cancels no security', nullIntrusion({ tags: {} }) === 0);
  check('intrusion strength is read off the tag', nullIntrusion({ tags: { null_intrusion: 6 } }) === 6);
  check('a junk tag cannot hand out free wins', nullIntrusion({ tags: { null_intrusion: -5 } }) === 0);

  check('stealth is a fraction, not a percentage', nullStealth({ tags: { null_stealth: 50 } }) === 0.5);
  // Gear may buy TIME inside a system, never unlimited time.
  check('stealth is capped below total suppression',
    nullStealth({ tags: { null_stealth: 999 } }) === 0.75);

  const blunt = nullJam({ tags: { null_jam_strength: 60 } });
  check('a blunt jammer reports its strength', blunt.strength === 60 && blunt.selective === false);
  const box = nullJam({ tags: { null_jam_strength: 85, null_selective: true } });
  check('selective gear is flagged as such', box.selective === true);

  // ── Carried jamming ───────────────────────────────────────────────────────

  const Z = 'regress-null-zone';
  stopCarriedJammer(P);
  check('a quiet room has no carried field', carriedJamAt(Z) === 0);

  setCarriedJammer(P, { zoneId: Z, strength: 60, durationMs: 5000 });
  check('a running jammer floods its own room', carriedJamAt(Z) === 60);
  check('...and only its own room', carriedJamAt('somewhere-else') === 0);

  // THE SELECTIVE RULE: elite gear takes one signal off the air and leaves the
  // room working. If this ever contributes to the zone field, the expensive
  // option has silently become the blunt one.
  setCarriedJammer(P, { zoneId: Z, strength: 90, selective: true, durationMs: 5000 });
  check('selective jamming contributes NOTHING to the room field',
    carriedJamAt(Z) === 0, `got ${carriedJamAt(Z)}`);

  setCarriedJammer(P, { zoneId: Z, strength: 60, durationMs: 5000 });
  try {
    Date.now = () => realNow() + 30_000;
    check('a jam field dies with its cell, on its own clock', carriedJamAt(Z) === 0);
  } finally {
    Date.now = realNow;
  }
  stopCarriedJammer(P);

  // ── The overclock exploit ─────────────────────────────────────────────────
  //
  // The point of the whole mechanic is that a power spike is nearly useless
  // against hardware running at spec: there is no stress to amplify. If this
  // ever becomes a general-purpose attack, the Ascendant's decision to back off
  // their overclock has stopped meaning anything.

  check('powerspike is registered', !!getNullOperation('powerspike'));
  check('powerspike reaches power and nothing else',
    operationApplies('powerspike', 'power')
      && !operationApplies('powerspike', 'sensor')
      && !operationApplies('powerspike', 'telemetry'));
  check('powerspike is durable — you cannot wait it out',
    getNullOperation('powerspike').kind === 'durable');
  check('powerspike costs real skill to reach',
    getNullOperation('powerspike').minSkill >= 5);

  // ── Cleanup: a logout drops everything (state is per-session by design) ────

  addTrace(P, 30, 30);
  forgetPlayer(P);
  check('logout drops all runtime state', traceOf(P) === 0 && veilFactor(P) === 0);

  // ── The door: nullcraft is the Null's, not a skill anyone can pick up ──────
  //
  // The wrapper is what makes this true for a verb added LATER, so the case
  // that matters is the coverage one: every registered command goes through it.
  // A verb wired straight to its handler would be an open door nobody noticed.

  const gatedCalls = [];
  const fakeRep = { reputation: 0 };
  const wrapped = _test.initiatesOnly(async () => { gatedCalls.push(1); return { type: 'output', message: 'ran' }; });

  const outsider = { id: '00000000-0000-0000-0000-0000000000ff' };
  const refused = await wrapped([], '', outsider);
  check('an outsider is refused, and is not told the surface exists',
    refused?.message === 'Unknown command.' && gatedCalls.length === 0, refused?.message);

  check('the refusal reveals nothing about the Null, the skill or the standing',
    !/null|rep|standing|skill|trace/i.test(String(refused?.message)), refused?.message);

  check('the initiate threshold is a real tier, not an open door',
    _test.INITIATE_REP >= 200 && _test.NULL_ORDER === 'ideology_null');

  check('EVERY registered command goes through the door, not just the loud ones', (() => {
    // Compare against the manifest so a verb added to plugin.json without the
    // wrapper fails here rather than in production.
    const declared = ['nullscan', 'analyze', 'null', 'nullresolve', 'jammer', 'veil', 'emp'];
    for (const v of declared) {
      const fn = commands[v];
      if (typeof fn !== 'function') return false;
      // A wrapped handler is the arrow above, never the raw cmd* function.
      if (fn === _test.cmdNullscan || fn === _test.cmdAnalyze
        || fn === _test.cmdNull || fn === _test.cmdNullResolve) return false;
    }
    return Object.keys(commands).length === declared.length;
  })());
  void fakeRep;
}
