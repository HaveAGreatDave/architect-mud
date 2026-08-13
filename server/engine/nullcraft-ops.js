/**
 * The Nullcraft VOCABULARY — what a Null operation is allowed to be, what kind of
 * subsystem it can be pointed at, and which contributor is expected to carry it out.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * This is the `mutation-effects.js` pattern, adopted deliberately and for the same
 * reason. Mutations shipped an authored `effects` JSONB that NOTHING READ for
 * months: authors wrote effects, players got stat stickers. The fix was not "read
 * the JSON", it was that a key must be DECLARED before it can be used, so the
 * failure mode inverts — an unrecognised key fails the build instead of being
 * silently ignored forever.
 *
 * Nullcraft is exposed to exactly that failure. A target contributor
 * (`tech.targets`) is a plain object supplied by some other plugin, and it names
 * its subsystems and the operations they accept as STRINGS. Without a registry,
 * `plugins/augments/nulltarget.js` could offer a subsystem kind of `actuator`
 * while the ops table says `actuation`, and the only symptom would be an operation
 * that quietly never appears in the menu. `unknownOperationKeys()` exists for
 * exactly that assertion, and plugins/nullcraft/regress.js fails on a non-empty
 * result.
 *
 * ── The two registries ───────────────────────────────────────────────────────
 *
 * A SUBSYSTEM KIND is the conceptual layer of a machine — power, control,
 * telemetry. It is what the spec calls an attack surface. A target lists which of
 * them it exposes.
 *
 * An OPERATION is what you do to one. Its `appliesTo` names the subsystem kinds it
 * makes sense against: you can `spoof` a sensor because a sensor reports things,
 * and you cannot spoof an actuator because an actuator does not report anything.
 * That constraint is the whole reason operations and subsystems are separate
 * tables rather than one flat list of verbs.
 *
 * ── The three operation kinds, and why the distinction is load-bearing ───────
 *
 * kind — 'transient'  wears off on its own clock. Nothing is persisted, ever:
 *                     the substrate holds an until-timestamp in RAM and
 *                     `isSubsystemDown` derives the answer at read time. A
 *                     server restart forgives it, which is correct — a jammed
 *                     radio is not damage.
 *        'persistent' holds until something clears it, and is written to whatever
 *                     state the CONTRIBUTOR already owns (a camera's
 *                     `status_flags`, which has held `jammed`/`spoofed`/
 *                     `hijacked_by` since long before this system existed).
 *                     Nullcraft adds no table for these.
 *        'durable'    real damage — condition lost, hardware ruined. This is the
 *                     only kind that may write a durable column, and the only
 *                     kind a player can never simply wait out.
 *
 * The reason to spell this out is spec §7: a player should frequently have a
 * reason to choose the SIMPLER operation. That only works if the simple ones are
 * genuinely cheap and genuinely temporary — a thirty-second servo lock that leaves
 * no trace is a different tactical object from a sabotage that costs the victim
 * money. Collapsing the three kinds into "it worked / it didn't" deletes that
 * decision, and the decision is the game.
 *
 * ── What this file does NOT do ───────────────────────────────────────────────
 *
 * It never applies anything. `apply` lives on the TARGET, supplied by the plugin
 * that owns the thing being attacked, so `nullcraft.js` imports neither augments
 * nor surveillance nor flight. This file only says what is nameable.
 */

// id -> { id, label, kind, appliesTo:Set, baseDifficulty, tier, minSkill, traceCost, describe }
const operations = new Map();
// id -> { id, label, describe }
const subsystemKinds = new Map();

export const OP_KINDS = ['transient', 'persistent', 'durable'];

export function registerSubsystemKind({ id, label, describe = '' }) {
  if (!id || !label) throw new Error('registerSubsystemKind: id and label required');
  subsystemKinds.set(id, { id, label, describe });
}

export function registerNullOperation({
  id, label, kind, appliesTo = [], baseDifficulty = 5,
  tier = 1, minSkill = 0, traceCost = 1, describe = '',
}) {
  if (!id || !label) throw new Error('registerNullOperation: id and label required');
  if (!OP_KINDS.includes(kind)) {
    throw new Error(`registerNullOperation(${id}): kind must be ${OP_KINDS.join('|')}`);
  }
  if (!Array.isArray(appliesTo) || appliesTo.length === 0) {
    throw new Error(`registerNullOperation(${id}): appliesTo must name at least one subsystem kind`);
  }
  operations.set(id, {
    id, label, kind, appliesTo: new Set(appliesTo),
    baseDifficulty, tier, minSkill, traceCost, describe,
  });
}

export function getNullOperation(id) { return operations.get(id) || null; }
export function getNullOperations() { return [...operations.values()]; }
export function getSubsystemKind(id) { return subsystemKinds.get(id) || null; }
export function getSubsystemKinds() { return [...subsystemKinds.values()]; }

/** Operations that make sense against a subsystem of this kind. */
export function operationsFor(subsystemKind) {
  return [...operations.values()].filter(op => op.appliesTo.has(subsystemKind));
}

export function operationApplies(opId, subsystemKind) {
  return !!operations.get(opId)?.appliesTo.has(subsystemKind);
}

/**
 * Every `appliesTo` entry that names a subsystem kind nobody registered.
 *
 * Asserted EMPTY by plugins/nullcraft/regress.js. A typo here is otherwise
 * invisible: the operation registers fine, and simply never offers itself.
 */
export function unknownOperationKeys() {
  const bad = [];
  for (const op of operations.values()) {
    for (const kindId of op.appliesTo) {
      if (!subsystemKinds.has(kindId)) bad.push(`${op.id} -> ${kindId}`);
    }
  }
  return bad;
}

/** Subsystem kinds no operation can be pointed at — an attack surface that isn't one. */
export function unreachableSubsystemKinds() {
  const reachable = new Set();
  for (const op of operations.values()) for (const k of op.appliesTo) reachable.add(k);
  return [...subsystemKinds.keys()].filter(k => !reachable.has(k));
}

// ── The vocabulary ───────────────────────────────────────────────────────────
//
// Eight subsystem kinds. They are conceptual layers, NOT a parts list: a servo arm
// and a security camera both have `power` and `network`, which is exactly what
// makes one skill work on both and is the point of the whole design. A target that
// wants a ninth layer almost certainly wants one of these eight under a different
// name — check before adding, because every new kind is a column in every
// operation's applicability table.

registerSubsystemKind({ id: 'power', label: 'Power',
  describe: 'What feeds it. Cut this and nothing else about the machine matters.' });
registerSubsystemKind({ id: 'control', label: 'Control',
  describe: 'The logic that decides what it does next.' });
registerSubsystemKind({ id: 'actuation', label: 'Actuation',
  describe: 'The part that moves. Servos, motors, hydraulics, rotors.' });
registerSubsystemKind({ id: 'sensor', label: 'Sensors',
  describe: 'How it learns about the world. Optics, thermal, motion, audio.' });
registerSubsystemKind({ id: 'telemetry', label: 'Telemetry',
  describe: 'What it reports about itself. Usually the least defended thing on a machine.' });
registerSubsystemKind({ id: 'network', label: 'Network',
  describe: 'Its link to everything else. Only exists on hardware left wireless.' });
registerSubsystemKind({ id: 'processing', label: 'Processing',
  describe: 'Where the thinking happens. Crashing this takes the whole device with it.' });
registerSubsystemKind({ id: 'security', label: 'Security',
  describe: 'The part built to stop you. Attack it directly only when you have to.' });

// The six operations, in the escalation order of spec §7. Difficulty and trace
// both climb: JAM is the everyday tool and SABOTAGE is a decision you answer for.
//
// Note that JAM and SPOOF cannot be pointed at `power` or `actuation`. You cannot
// jam a hydraulic ram — there is no signal in it to jam. Keeping that honest is
// what stops the six operations collapsing into one generic "break it" verb with
// six skins.

registerNullOperation({
  id: 'jam', label: 'Jam', kind: 'transient', tier: 1,
  appliesTo: ['sensor', 'telemetry', 'network'],
  baseDifficulty: 3, minSkill: 0, traceCost: 1,
  describe: 'Drown the signal. Nothing is damaged and nothing is learned — the link simply stops carrying.',
});

registerNullOperation({
  id: 'spoof', label: 'Spoof', kind: 'transient', tier: 2,
  appliesTo: ['sensor', 'telemetry', 'network'],
  baseDifficulty: 5, minSkill: 2, traceCost: 2,
  describe: 'Feed it something false. Strictly better than jamming when you want the machine trusted rather than silent.',
});

registerNullOperation({
  id: 'lock', label: 'Lock', kind: 'transient', tier: 2,
  appliesTo: ['actuation', 'control', 'power'],
  baseDifficulty: 6, minSkill: 3, traceCost: 2,
  describe: 'Refuse it permission to act. Brief, and often all you needed.',
});

registerNullOperation({
  id: 'crash', label: 'Crash', kind: 'transient', tier: 3,
  appliesTo: ['control', 'processing', 'security'],
  baseDifficulty: 8, minSkill: 4, traceCost: 3,
  describe: 'Force a restart. Loud, total while it lasts, and impossible for the owner to miss.',
});

registerNullOperation({
  id: 'hijack', label: 'Hijack', kind: 'persistent', tier: 4,
  appliesTo: ['control', 'actuation', 'network'],
  baseDifficulty: 11, minSkill: 6, traceCost: 5,
  describe: 'Take it. Not disruption — possession, for as long as you can hold the trace down.',
});

// ── The overclock exploit (spec §18–19) ──────────────────────────────────────
//
// The best-integrated idea in the whole design, and it cost almost nothing:
// `overclock_level` and the heat model already existed on every augment.
//
// The point is that THE NULL DOES NOT INVENT A WAY TO BREAK CHROME. A power
// spike pushes the augment down its OWN failure path — the `failure_messages`
// (strain/fault/burnout/dead) that the overclock system already REQUIRES every
// overclockable augment to author, and fails the regress suite for omitting.
// The Null presses the button the Ascendant installed.
//
// Which is also why it is nearly useless against hardware running at spec: there
// is no stress to amplify. That asymmetry is the mechanic. An Ascendant who
// backs off their overclock is genuinely harder to kill this way, and that is a
// decision they get to make rather than a nerf handed to them.
registerNullOperation({
  id: 'powerspike', label: 'Power Spike', kind: 'durable', tier: 4,
  appliesTo: ['power'],
  baseDifficulty: 9, minSkill: 5, traceCost: 4,
  describe: 'Surge the supply. Against a machine already running hot it is a killing blow; against one at spec it is a flicker.',
});

registerNullOperation({
  id: 'sabotage', label: 'Sabotage', kind: 'durable', tier: 5,
  appliesTo: ['power', 'actuation', 'control', 'processing'],
  baseDifficulty: 13, minSkill: 8, traceCost: 8,
  describe: 'Real damage, that the owner pays to undo. The only operation nobody can wait out.',
});
