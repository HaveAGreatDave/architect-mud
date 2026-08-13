/**
 * Anatomy — the ONE table of what a humanoid body is made of.
 *
 * This file exists because the same seven strings were written out four times:
 * `combat.js` had PART_TO_SLOT + PART_LABELS, `plugins/injury/tables.js` had
 * PARTS + PART_LABELS, and each was authoritative for a different question. They
 * agreed only because nobody had yet had a reason to disagree with them. The
 * mutation system is that reason: a second head and a pair of wings are body
 * parts that exist for SOME bodies, and a list that lives in two files cannot
 * grow a conditional member without drifting.
 *
 * ── The split that matters ───────────────────────────────────────────────────
 *
 * BASE_PARTS is what every body has. MUTATION_PARTS is what a body can GROW —
 * present only when a mutation grants it, and absent from the default hit
 * weights entirely, so an unmutated player's combat maths is byte-identical to
 * what it was before this file existed. `rollBodyPart` iterates the KEYS of the
 * weight map; a part with no key is a part that cannot be hit. That is the whole
 * safety argument, and it is why mutation parts ship at weight 0.
 *
 * `PARTS` (the name the rest of the codebase already imports) still means the
 * humanoid seven, deliberately. Aiming, foe anatomy and the paper doll all ask
 * "what is a body shaped like?" and must keep answering the same way for anyone
 * who hasn't grown anything. Only the two questions that are genuinely about a
 * SPECIFIC body — what can be injured, and what does this player's doll show —
 * use ALL_PARTS / partsForPlayer.
 *
 * ── Not to be confused with ──────────────────────────────────────────────────
 *
 * `server/engine/bodily.js` has its own PART_TO_SLOT. That one is a LEXICON, not
 * an anatomy: it maps colloquial names a player might type or a script might
 * author — face, scalp, chest, belly, groin — onto the slot that covers them, so
 * staining "chest" soaks a shirt. It answers a naming question, this file
 * answers a structural one. Do not merge them.
 *
 * `client/devpanel/js/panels/enemies.js` mirrors the base list by hand. That is
 * intentional and must stay: there is no build step, so the dev panel cannot
 * import a server module. It carries a comment saying so.
 */

// Every body has these. The order is the authoring order and reaches the paper
// doll, so it is head-down rather than alphabetical.
export const BASE_PARTS = ['head', 'torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'feet'];

// Parts a body can GROW. Never present unless a mutation grants one, never in
// the default hit weights, and never assumed by anything that renders a body.
export const MUTATION_PARTS = ['head_2', 'wing_left', 'wing_right', 'aux_limb', 'tail'];

export const ALL_PARTS = [...BASE_PARTS, ...MUTATION_PARTS];

// `PARTS` is BASE_PARTS under the name the codebase already imports. Kept as a
// distinct export rather than an alias comment because the DISTINCTION is the
// point: code asking for `PARTS` is asking about a generic body.
export const PARTS = BASE_PARTS;

export const PART_LABELS = {
  head: 'head', torso: 'torso',
  left_arm: 'left arm', right_arm: 'right arm',
  left_leg: 'left leg', right_leg: 'right leg',
  feet: 'feet',
  head_2: 'second head',
  wing_left: 'left wing', wing_right: 'right wing',
  aux_limb: 'auxiliary limb',
  tail: 'tail',
};

/**
 * Which equip slot covers each struck part. Arms share the hands piece, legs
 * share the legs piece, feet has its own boots piece.
 *
 * `null` is a REAL answer, not a gap: a wing is covered by nothing a shop sells,
 * so it takes the full hit. `playerPartSoak` already returns 0 for a slot it
 * can't find an entry for, so null needs no special-casing at the call site —
 * but write it explicitly, because an ABSENT key and a null one mean different
 * things to a reader and only one of them is a decision.
 */
export const PART_TO_SLOT = {
  head: 'head', torso: 'torso',
  left_arm: 'hands', right_arm: 'hands',
  left_leg: 'legs', right_leg: 'legs',
  feet: 'feet',
  head_2: 'head',      // a helmet fits the second head, or neither
  aux_limb: 'hands',   // gloves, if any glove fits at all
  wing_left: null, wing_right: null, tail: null,
};

// Default hit weights for a body with nothing grown. Mutation parts are ABSENT,
// not zero — see the header. combat.js reads this through the `body_part_weights`
// tunable, which may override it wholesale.
export const DEFAULT_BODY_PART_WEIGHTS = {
  head: 10, torso: 40, left_arm: 12, right_arm: 12, left_leg: 11, right_leg: 11, feet: 4,
};

/**
 * Anatomy is data, so a part name can be anything a creature authors —
 * `upper_left_arm`, `venom_sac`, `fluke`. It must never reach a player with the
 * underscores still in it. The humanoid labels win where they exist; everything
 * else is humanised.
 */
export function partLabelOf(part) {
  return PART_LABELS[part] || String(part || '').replace(/_/g, ' ');
}

// ── Grown parts ──────────────────────────────────────────────────────────────
//
// A registered provider rather than a direct import, for the same reason
// `registerImpairmentProvider` and `registerArmorContributor` are: mutations.js
// needs this file's tables, so this file importing mutations.js would close a
// cycle. The provider is registered once at module load and is SYNC BY CONTRACT
// — it is read on the describe and combat paths and must never learn to await.

let grantedPartsProvider = null;
let providerOwner = null;

export function registerBodyPartProvider(fn, owner = 'unknown') {
  if (typeof fn !== 'function') return;
  grantedPartsProvider = fn;
  providerOwner = owner;
}

export function getBodyPartProviderOwner() { return providerOwner; }

/**
 * The parts THIS body actually has: the base seven plus anything grown.
 *
 * Used by the paper doll and by injury deserialization. Anything asking a
 * generic question about bodies wants `PARTS` instead — handing this to a
 * renderer that assumes seven entries is how you get phantom limbs on a player
 * who has never seen a rad tile.
 */
export function partsForPlayer(player) {
  if (!player || !grantedPartsProvider) return BASE_PARTS;
  let grown;
  try {
    grown = grantedPartsProvider(player);
  } catch {
    // A provider that throws yields an ordinary body. Degraded, never broken —
    // a mutation bug must not be able to make someone unrenderable.
    return BASE_PARTS;
  }
  if (!Array.isArray(grown) || !grown.length) return BASE_PARTS;
  const extra = grown.filter(p => MUTATION_PARTS.includes(p));
  return extra.length ? [...BASE_PARTS, ...extra] : BASE_PARTS;
}

/**
 * Hit weights for THIS body: the base map plus any grown part that declares a
 * weight of its own.
 *
 * Phase 1 grants every mutation part at weight 0, so this returns the base map
 * unchanged and combat is provably untouched. The signature exists so raising a
 * wing's weight later is a content edit rather than an engine one.
 */
export function hitWeightsForPlayer(player, base = DEFAULT_BODY_PART_WEIGHTS) {
  if (!player || !grantedPartsProvider) return base;
  const grown = partsForPlayer(player);
  if (grown.length === BASE_PARTS.length) return base;

  const out = { ...base };
  for (const part of grown) {
    if (out[part] !== undefined) continue;
    const w = Number(player._grownPartWeights?.[part]) || 0;
    // Zero-weight parts stay ABSENT from the map rather than present-as-zero.
    // `rollBodyPart` divides by the total and walks the keys; a zero entry is
    // harmless but it is also a lie about what can be hit, and `Object.keys`
    // of this map is read elsewhere as "what could this creature be struck on".
    if (w > 0) out[part] = w;
  }
  return out;
}
