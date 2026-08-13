/**
 * The PSIONIC VOCABULARY — what an Exodus ability is allowed to be, what it can be
 * pointed at, and what you must already be before it exists for you.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * This is the `mutation-effects.js` / `nullcraft-ops.js` pattern, adopted for the
 * third time and for the same reason each time. Mutations shipped an authored
 * `effects` JSONB that NOTHING READ for months: authors wrote effects, players got
 * stat stickers. The fix was never "read the JSON", it was that a key must be
 * DECLARED before it can be used, so the failure mode inverts — an unrecognised
 * key fails the build instead of being silently ignored forever.
 *
 * Psionics is exposed to exactly that failure and then some, because it is the
 * largest vocabulary in the game: six disciplines and eventually fifty-odd
 * abilities, each naming its discipline, its target kinds and its gates as
 * STRINGS. Without a registry, an ability could declare `appliesTo: ['creature']`
 * while every target reports `kind: 'being'`, and the only symptom would be a verb
 * that quietly never fires. `unknownAbilityKeys()` exists for that assertion and
 * plugins/psionics/regress.js fails on a non-empty result.
 *
 * ── The two registries, and the third ────────────────────────────────────────
 *
 * A DISCIPLINE is one of the six ways a mind reaches out. An ABILITY belongs to
 * exactly one and names the TARGET KINDS it makes sense against: you can read the
 * surface thoughts of a person and you cannot read the surface thoughts of a door,
 * and keeping that honest is what stops fifty abilities collapsing into one verb
 * with fifty skins.
 *
 * The third registry is COMPULSIONS — see the header of that section. It is small
 * on purpose and it is a deny list, not an allow list, which is the opposite of
 * how the other two work and the reason it is written down separately.
 *
 * ── What this file does NOT do ───────────────────────────────────────────────
 *
 * It never resolves anything. No rolls, no costs charged, no state touched. It
 * only says what is NAMEABLE. Resonance and strain live in psionics.js; resisting
 * lives in psi-resist.js; the verbs live in plugins/psionics/. This file is
 * imported by all three and imports none of them.
 */

// id -> { id, label, describe, order }
const disciplines = new Map();
// id -> { id, discipline, label, kind, appliesTo:Set, rank, minSkill, unlockFlag, ... }
const abilities = new Map();

/**
 * The eight-rung ladder. Index is the comparison — RANKS.indexOf() is how every
 * gate in the system asks "is this player far enough along", so the ORDER is the
 * contract and inserting a rung in the middle regrades every existing character.
 */
export const RANKS = [
  'awakened',    // psychic perception, emotional sensing, basic psychometry
  'sensitive',   // deeper psychometry, surface thoughts, basic telekinesis
  'channeler',   // telekinetic combat, mental defenses — and you choose a FOCUS here
  'adept',       // memory probing, stronger telekinesis, precognition
  'seer',        // advanced precognition, psychic tracking, projection — SECONDARY focus
  'dreamwalker', // dream entry, dream manipulation, astral projection
  'master',      // advanced multi-discipline abilities, powerful psychic combat
  'exodus',      // reality-bending Resonance abilities
];

export function rankIndex(rank) {
  const i = RANKS.indexOf(rank);
  return i < 0 ? -1 : i;
}

/** Is `rank` at least `required`? An unranked player is below everything. */
export function rankAtLeast(rank, required) {
  const have = rankIndex(rank);
  const need = rankIndex(required);
  return have >= 0 && need >= 0 && have >= need;
}

/**
 * The rung at which a player picks a primary focus, and the rung at which a
 * secondary opens. Below CHOOSE_FOCUS_AT everything is treated as in-focus,
 * because a player who has not specialised yet should be able to feel out all six
 * before committing — the choice is only meaningful if you have tasted the options.
 */
export const CHOOSE_FOCUS_AT = 'channeler';
export const SECOND_FOCUS_AT = 'seer';

/**
 * What an ability can be pointed at. Deliberately coarse — these are the kinds a
 * TARGET reports about itself, not a type system. A fifth kind almost certainly
 * wants to be one of these four under a different name; check before adding,
 * because every new kind is a column in every ability's applicability table.
 */
export const TARGET_KINDS = ['person', 'object', 'place', 'self'];

export const ABILITY_KINDS = ['read', 'strike', 'effect', 'compel', 'utility'];

export function registerDiscipline({ id, label, describe = '', order = 0 }) {
  if (!id || !label) throw new Error('registerDiscipline: id and label required');
  disciplines.set(id, { id, label, describe, order });
}

/**
 * Declare an ability.
 *
 * The four gates (rank / focus / minSkill / unlockFlag) are DATA rather than
 * scattered `if`s in verb handlers, which is the only way the top of the ladder
 * stays genuinely rare. A handler that re-derives its own gate is a handler that
 * will disagree with the menu eventually.
 *
 * `focusOnly: true` means the ability is unreachable outside your primary focus at
 * ANY cost — not merely expensive. Every top-tier ability sets it, and that is
 * what makes the archetypes real: there is no build that both takes bodies and
 * walks dreams.
 */
export function registerPsiAbility({
  id, discipline, label, kind,
  appliesTo = [],
  rank = 'awakened',
  resonance = 1,
  strain = 0,
  difficulty = 5,
  minSkill = 0,
  unlockFlag = null,
  focusOnly = false,
  describe = '',
}) {
  if (!id || !label) throw new Error('registerPsiAbility: id and label required');
  if (!discipline) throw new Error(`registerPsiAbility(${id}): discipline required`);
  if (!ABILITY_KINDS.includes(kind)) {
    throw new Error(`registerPsiAbility(${id}): kind must be ${ABILITY_KINDS.join('|')}`);
  }
  if (!Array.isArray(appliesTo) || appliesTo.length === 0) {
    throw new Error(`registerPsiAbility(${id}): appliesTo must name at least one target kind`);
  }
  if (rankIndex(rank) < 0) {
    throw new Error(`registerPsiAbility(${id}): unknown rank '${rank}'`);
  }
  abilities.set(id, {
    id, discipline, label, kind, appliesTo: new Set(appliesTo),
    rank, resonance, strain, difficulty, minSkill, unlockFlag, focusOnly, describe,
  });
}

export function getDiscipline(id) { return disciplines.get(id) || null; }
export function getDisciplines() {
  return [...disciplines.values()].sort((a, b) => a.order - b.order);
}
export function getPsiAbility(id) { return abilities.get(id) || null; }
export function getPsiAbilities() { return [...abilities.values()]; }
export function abilitiesFor(discipline) {
  return [...abilities.values()].filter(a => a.discipline === discipline);
}
export function abilityApplies(id, targetKind) {
  return !!abilities.get(id)?.appliesTo.has(targetKind);
}

// ── Build-failure contracts (all three asserted EMPTY by regress) ────────────

/** Abilities naming a discipline or target kind nobody registered. */
export function unknownAbilityKeys() {
  const bad = [];
  for (const a of abilities.values()) {
    if (!disciplines.has(a.discipline)) bad.push(`${a.id} -> discipline:${a.discipline}`);
    for (const k of a.appliesTo) {
      if (!TARGET_KINDS.includes(k)) bad.push(`${a.id} -> target:${k}`);
    }
  }
  return bad;
}

/** Disciplines with no abilities in them — a path that isn't one. */
export function unreachableDisciplines() {
  const reached = new Set([...abilities.values()].map(a => a.discipline));
  return [...disciplines.keys()].filter(d => !reached.has(d));
}

// ── Compulsion: the deny list ────────────────────────────────────────────────
//
// Compulsion is the only thing in Architect where the server performs an action AS
// another character. The limit on it is DURATION, not vocabulary — a control window
// is seconds long, contested every second against the full derived resistance
// stack, and costs more than anything else in the game. Any verb the target could
// have typed, they can be made to type.
//
// With one exception, and it is not a consent exception. These verbs move VALUE:
//
//   A mind-controlled `give` is a theft primitive that skips every system theft is
//   supposed to go through — thievery's rolls, trade's escrow, the witnessed-crime
//   ladder — and it would be, by a wide margin, the best way to rob anyone in the
//   game. A psion can make you walk off a roof. They cannot make you sign a cheque.
//
// The list is enforced in ONE place (`compelRefusal`) and regress asserts it is
// non-empty and that each entry is actually refused. It is a deny list rather than
// an allow list on purpose: an allow list would quietly shrink the fantasy every
// time somebody added a verb and forgot to include it, and the failure mode of
// this list is that a new value-moving verb needs adding to it — which is a review
// question, not a silent loss.
const deniedCompelVerbs = new Set([
  'give', 'pay', 'trade', 'sell', 'buy', 'bank', 'deposit', 'withdraw',
  'transfer', 'tip', 'donate', 'wire', 'bet', 'wager',
  // Not value, but the same category of "no": a puppet must never make a puppet.
  'compel',
]);

export function deniedCompelVerbList() { return [...deniedCompelVerbs]; }
export function isCompelDenied(verb) {
  if (!verb) return true;
  return deniedCompelVerbs.has(String(verb).trim().toLowerCase().split(/\s+/)[0]);
}

// ── The vocabulary ───────────────────────────────────────────────────────────
//
// Six disciplines. Each answers one of the questions from the design brief that
// ordinary Architect play cannot: perceive what the senses cannot, act without
// touching, reach a mind, read a probability, change a body, leave your own.

registerDiscipline({ id: 'psychometry', label: 'Psychometry', order: 1,
  describe: 'Reading what people, events and objects left behind them.' });
registerDiscipline({ id: 'telekinesis', label: 'Telekinesis', order: 2,
  describe: 'Moving the world without touching it.' });
// Ergokinesis and Aegis are deliberately NOT filed under telekinesis, though the
// obvious reading is that all three are "force". If they were, a telekinetic major
// would own the frontline kit AND the artillery AND the shield, and would be
// strictly the best major in the game — which is the exact failure the whole
// major/minor model exists to prevent. Split, they are three different soldiers:
// the one who moves things, the one who burns them, and the one who stops them.
registerDiscipline({ id: 'ergokinesis', label: 'Ergokinesis', order: 3,
  describe: 'Pushing raw energy out of a body that has no organ for it. The loudest thing an Exodus can do.' });
registerDiscipline({ id: 'aegis', label: 'Aegis', order: 4,
  describe: 'Holding a shape in the air and refusing to let it move. The only defensive discipline.' });
// The remaining four disciplines — TELEPATHY (5), PRECOGNITION (6), BIOKINESIS (7)
// and PROJECTION (8), the last of which carries dreamwalking — are deliberately
// NOT registered yet. `unreachableDisciplines()` is asserted empty by regress, so
// a discipline with no abilities in it is a build failure, and that is the
// contract doing its job: a major a player could choose and then find empty is
// worse than one that has not arrived. Each registers alongside its own verbs in
// its own phase. Their order numbers are reserved above so the catalogue does not
// reshuffle when they land.

// ── Phase 1: Psychometry ─────────────────────────────────────────────────────
//
// Reads RESIDUE THE WORLD ALREADY RECORDED (see residue.js) rather than inventing
// fiction. That is the whole reason this discipline shipped first: an impression
// generator is a random-text box with a cooldown, and a reader of real history is
// an investigation loop no other order can buy, mutate or hack its way into.

registerPsiAbility({
  id: 'impression', discipline: 'psychometry', label: 'Psychic Impression', kind: 'read',
  appliesTo: ['object'], rank: 'awakened', resonance: 2, strain: 1, difficulty: 4,
  describe: 'Fragments of what an object has been part of. Never a replay, and never a name.',
});

registerPsiAbility({
  id: 'residue', discipline: 'psychometry', label: 'Emotional Residue', kind: 'read',
  appliesTo: ['place'], rank: 'awakened', resonance: 2, strain: 1, difficulty: 4,
  describe: 'What happened in a room, in the order the room remembers it rather than the order it happened.',
});

registerPsiAbility({
  id: 'stillness', discipline: 'psychometry', label: 'Stillness', kind: 'utility',
  appliesTo: ['self'], rank: 'awakened', resonance: 1, strain: 1, difficulty: 3,
  describe: 'Hold yourself open. Slower than reaching, and it surfaces what reaching would miss.',
});

// ── Phase 1: Telekinesis ─────────────────────────────────────────────────────
//
// Two utility verbs and one strike, against a brief that asked for thirteen. The
// brief's own rule did the cutting: nudge/push/lift/throw/catch/hold are one verb
// with an adverb, and shove/trip/restrain/crush/disarm are one strike with a body
// part. What survives is what ordinary play genuinely cannot do.

registerPsiAbility({
  id: 'draw', discipline: 'telekinesis', label: 'Draw', kind: 'utility',
  appliesTo: ['object'], rank: 'sensitive', resonance: 3, strain: 1, difficulty: 5,
  describe: 'Take a thing you could not reach. Across a room, behind glass, through a gap.',
});

registerPsiAbility({
  id: 'reach', discipline: 'telekinesis', label: 'Reach', kind: 'utility',
  appliesTo: ['object', 'place'], rank: 'sensitive', resonance: 3, strain: 1, difficulty: 5,
  describe: 'Work a mechanism from where you are standing. A handle, a lever, a switch, a door.',
});

registerPsiAbility({
  id: 'press', discipline: 'telekinesis', label: 'Press', kind: 'strike',
  appliesTo: ['person'], rank: 'channeler', resonance: 5, strain: 3, difficulty: 6,
  describe: 'Force, concentrated somewhere specific on a body. It hits like being hit.',
});

// ── Ergokinesis — the blast major ────────────────────────────────────────────
//
// `damageType: 'energy'` is already a first-class type in the typed-soak table and
// plugins/mutations/organs.js already fires energy through applyStrikeToEnemy for
// the shock organ. So a discharge is that same call with a bigger range, a chosen
// body part and a real price — it inherits part rolls, typed soak, damage
// observers, injury and loot-on-death for free, and there is no second combat path.
//
// This is the discipline that ends deniability. It leaves the loudest signature in
// the game and it cannot be mistaken for anything but what it is.

registerPsiAbility({
  id: 'spark', discipline: 'ergokinesis', label: 'Spark', kind: 'strike',
  appliesTo: ['person'], rank: 'channeler', resonance: 4, strain: 3, difficulty: 6,
  describe: 'A short discharge, close range. Looks like a fault in the wiring if nobody was watching your hands.',
});

registerPsiAbility({
  id: 'burn', discipline: 'ergokinesis', label: 'Burn', kind: 'strike',
  appliesTo: ['person'], rank: 'seer', resonance: 9, strain: 8, difficulty: 9,
  minSkill: 5,
  describe: 'Everything you have, through one point on one body. Nobody in the room will be able to explain it away.',
});

registerPsiAbility({
  id: 'cascade', discipline: 'ergokinesis', label: 'Cascade', kind: 'strike',
  appliesTo: ['place'], rank: 'master', resonance: 18, strain: 20, difficulty: 13,
  minSkill: 8, focusOnly: true, unlockFlag: 'psi_stillhouse_rite',
  describe: 'The room, all of it, at once. Afterwards you will be on the floor, and you will have earned it.',
});

// ── Aegis — the shield major ─────────────────────────────────────────────────
//
// Implemented as a STATUS EFFECT CONTRIBUTING TYPED SOAK, never as a
// damage-reduction special case. registerStatusEffect already carries `stats` and
// `acuity` contributions and playerPartSoak already nets contributed soak beside
// armor and mutations, so a field stacks with a coat by the same arithmetic as
// everything else rather than becoming a parallel defence model nobody can reason
// about.
//
// Because soak is TYPED, a field can be strong against kinetic and useless against
// edged, which is a real tactical choice rather than a flat number. And it obeys
// PSI_CAP — a field is never total immunity, for the same reason VEIL_CAP exists.

registerPsiAbility({
  id: 'ward', discipline: 'aegis', label: 'Ward', kind: 'effect',
  appliesTo: ['self'], rank: 'channeler', resonance: 4, strain: 2, difficulty: 5,
  describe: 'A held shape in the air a handspan off your skin. Holding it is work, and the work does not stop.',
});

registerPsiAbility({
  id: 'bulwark', discipline: 'aegis', label: 'Bulwark', kind: 'effect',
  appliesTo: ['person'], rank: 'seer', resonance: 8, strain: 6, difficulty: 8,
  minSkill: 5,
  describe: 'The same shape, around somebody else. The reason an Exodus crew survives a doorway.',
});

registerPsiAbility({
  id: 'redoubt', discipline: 'aegis', label: 'Redoubt', kind: 'effect',
  appliesTo: ['place'], rank: 'master', resonance: 16, strain: 16, difficulty: 12,
  minSkill: 8, focusOnly: true, unlockFlag: 'psi_stillhouse_rite',
  describe: 'A shape across a whole room, over everyone in it. You will not be doing anything else while it stands.',
});
