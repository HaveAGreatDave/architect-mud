/**
 * Hack gear — what the deck in your hands is worth.
 *
 * Every breach path (ATM jack, vendor safe, shop vault, hololock door, camera
 * hijack, transmitter) built its own `hack_device` lookup and then ignored WHICH
 * device it found. The gate was the capability tag, so a 90₵ pawn-shop pry bar
 * and a 450₵ Nexus IX were mechanically identical. That made the obvious starter
 * purchase — a cheap deck you grind on and expect to lose — impossible to
 * express as content.
 *
 * This is the one funnel. Two authored numbers on the item, both optional, both
 * defaulting to today's behaviour so every existing deck is unchanged:
 *
 *   tags.hack_penalty     — added to the target's difficulty in the minigame.
 *                           Junk gear makes every target harder. Default 0.
 *   tags.hack_fail_damage — condition burned per failed breach (0..1 scale).
 *                           Default 0.2, i.e. the historical five-failures-and-
 *                           it's-slag. A cheap deck sets this high and dies in
 *                           two or three.
 *
 * Why `hack_fail_damage` is authored rather than derived from `value` like
 * ordinary durability: this path doesn't spend the item's wear pool at all, it
 * moves condition directly. Deriving it would silently make an expensive deck
 * near-immortal on the fourth-root curve, which erases the risk the failure is
 * there to create. Cheap-and-fragile is a design statement per item, not a
 * side effect of pricing.
 *
 * ── Read tier ────────────────────────────────────────────────────────────────
 * Arming a breach is a deliberate player action, not a hot path — one query per
 * `hack`, same as before. Nothing here runs per-tick or per-swing.
 */
import { resolveInventoryItem } from './inventory.js';
import { repairItem, conditionBand, destroyItem } from './durability.js';
import { effectiveSkill } from './skills.js';

export const DEFAULT_FAIL_DAMAGE = 0.2;

// The deck a breach will actually be run on. When a player carries more than
// one, the BEST one answers — lowest difficulty penalty first, then the pricier
// housing. Nobody expects the spare junk deck in their bag to be the one that
// gets used just because it sorted first.
export async function getHackDeck(playerId) {
  return resolveInventoryItem(playerId, {
    tag: 'hack_device',
    orderBy: `COALESCE((i.tags->>'hack_penalty')::numeric, 0) ASC, i.value DESC`,
  });
}

export async function hasHackDeck(playerId) {
  return !!(await getHackDeck(playerId));
}

// How much harder this deck makes every target. Clamped non-negative — a tag
// typo shouldn't hand out free wins.
export function deckPenalty(deck) {
  const p = Number(deck?.tags?.hack_penalty);
  return Number.isFinite(p) && p > 0 ? p : 0;
}

/**
 * Effective difficulty for a breach, given the target's rating and the deck the
 * player is holding. Call this instead of `flags.hack_difficulty ?? 5` when
 * building a `circuit_hack` / `vault_crack` payload.
 */
export async function hackDifficulty(playerId, baseDifficulty, fallback = 5) {
  const base = Number.isFinite(baseDifficulty) ? baseDifficulty : fallback;
  return base + deckPenalty(await getHackDeck(playerId));
}

// ── What a breach TEACHES you ────────────────────────────────────────────────
//
// `awardSkillUse`'s third argument is the skill-check MARGIN, not an amount:
// ip.js rolls `chance = base / (1 + |margin| × scale)` and awards 1 IP on a hit.
// You learn at the edge of your ability and nothing from a walkover.
//
// Every breach path used to hand it a literal `2`, because none of them roll a
// skill check — the client minigame decides the outcome, so there was no margin
// lying around to pass. The effect was that hacking paid a flat ~20% per success
// forever: a beginner scraping a difficulty-7 vault and a veteran walking a
// difficulty-2 lock learned at exactly the same rate, and no target ever stopped
// being worth grinding.
//
// The honest stand-in is the gap the player actually faced: how good they are
// versus how hard the thing was, deck penalty included. That restores the curve
// the rest of the game's skills already run on — hard targets keep teaching you,
// easy ones stop, and the way to keep levelling is to go find something meaner.
export const marginOf = (skill, difficulty) => Math.abs((skill ?? 0) - (difficulty ?? 0));

/**
 * The margin a completed breach should report to `awardSkillUse`.
 *
 * Call at RESOLVE time with the target's own rating — the deck penalty is added
 * here, so failing upward with junk hardware is worth more than cruising with a
 * good deck, which is correct: it was genuinely harder.
 */
export async function breachMargin(player, baseDifficulty, fallback = 5) {
  const difficulty = await hackDifficulty(player.id, baseDifficulty, fallback);
  return marginOf(await effectiveSkill(player, 'hacking'), difficulty);
}

// ── Null gear ────────────────────────────────────────────────────────────────
//
// Nullcraft hardware lives in THIS file rather than its own because the argument
// above applies unchanged: one funnel, so the "which of my several devices
// answers" rule is written once. A `null_device` is deliberately NOT a
// `hack_device` — a deck gets you into a thing, Null gear attacks what a thing
// depends on, and a player may sensibly carry both — but they resolve the same
// way, and a second copy of `resolveInventoryItem`-with-an-ordering would drift.
//
// The best rig answers: most intrusion strength first, then the pricier housing.

export async function getNullDevice(playerId) {
  return resolveInventoryItem(playerId, {
    tag: 'null_device',
    orderBy: `COALESCE((i.tags->>'null_intrusion')::numeric, 0) DESC, i.value DESC`,
  });
}

export async function hasNullDevice(playerId) {
  return !!(await getNullDevice(playerId));
}

const tagNum = (item, key) => {
  const n = Number(item?.tags?.[key]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Points of target security this rig cancels. Clamped non-negative. */
export function nullIntrusion(device) { return tagNum(device, 'null_intrusion'); }

/** 0..1 — the share of accrued trace this rig suppresses. Capped well below 1:
 *  gear may buy you time inside a system, never unlimited time. */
export function nullStealth(device) {
  return Math.min(0.75, tagNum(device, 'null_stealth') / 100);
}

export function nullJam(device) {
  return {
    strength: tagNum(device, 'null_jam_strength'),
    radius: tagNum(device, 'null_jam_radius'),
    selective: !!device?.tags?.null_selective,
  };
}

/**
 * Burn the deck on a failed breach. Returns a sentence to append to the failure
 * message ('' when the player has no deck to damage), or the slag line if this
 * failure finished it off.
 *
 * Routed through the durability substrate rather than hand-rolled arithmetic —
 * one funnel, so the band the player is told about is the same one repair and
 * examine read. At zero it disintegrates (durability rule 4).
 */
export async function damageHackDeck(playerId) {
  const deck = await getHackDeck(playerId);
  if (!deck) return '';
  const authored = Number(deck.tags?.hack_fail_damage);
  const dmg = Number.isFinite(authored) && authored > 0 ? Math.min(authored, 1) : DEFAULT_FAIL_DAMAGE;

  await repairItem(deck, -dmg);
  const band = conditionBand(deck.condition);
  if (band.id === 'broken') {
    await destroyItem(deck);
    return ` Your ${deck.name} browns out, sparks once, and crumbles to slag in your hands.`;
  }
  return ` Your ${deck.name} takes damage — it reads <span style="color:${band.colour}">${band.label.toLowerCase()}</span>.`;
}
