/**
 * MUTATIONS — the substrate.
 *
 * A mutation is a persistent biological change carried by a body. It is not a
 * status effect (it has no duration), not an item (it cannot be taken off), and
 * not a stat sticker (which is what it used to be).
 *
 * ── The three rules that shape this file ─────────────────────────────────────
 *
 * 1. EXPRESSION, NOT A BOOLEAN. Every mutation a player carries has an
 *    expression from 1-100 saying how strongly this body carries it. Everything
 *    downstream — how much it soaks, how sharp it makes you, whether a stranger
 *    can see it — is derived from that one number. A mutation is therefore a
 *    range of outcomes rather than a thing you do or don't have, which is the
 *    only way "he's got the full carapace" is ever a sentence anyone says.
 *
 *    Expression is rolled ONCE at grant and thereafter only ever goes DOWN, via
 *    treatment. Mutations do not creep: the moment you got it is the memorable
 *    one, and a concealable mutation cannot quietly become an obvious one while
 *    you are out of town.
 *
 * 2. NOTHING IS BAKED. This file never writes players.stat_brawn. Contributions
 *    are DERIVED at read time from the carried set, scaled by expression, and
 *    netted by the same readers that already net status effects and gear
 *    (condition.js, senses.js, the armour contributor chain).
 *
 *    The old code added stat_modifiers straight into the players columns and
 *    un-added them by reversing the arithmetic. That worked exactly as long as
 *    mutations were permanent and all-or-nothing. The moment one can be treated
 *    at 40% and re-treated at 15%, reversal drifts, and drift in a stat column
 *    is unrecoverable — there is no record of what the true base was. Derived
 *    contributions cannot drift because there is nothing to reverse.
 *
 * 3. SYNC BY CONTRACT, ONE QUERY AT LOGIN. The read accessors sit on the
 *    combat, describe and senses paths. They read `player._mutations` and never
 *    await. The pattern is relations.js's exactly: hydrate once at login, mutate
 *    memory + a dirty set, flush coalesced on a 1m cadence and at logout.
 *
 *    THIS FILE IS THE ONLY WRITER OF `player_mutations`. Keep it that way — the
 *    memory cache is only as safe as its write funnel.
 *
 * ── The chrome interlock (unchanged, deliberately) ───────────────────────────
 *
 * Flesh and machine are the two divergent paths, and installing an augment
 * closes the flesh one: the first install burns every mutation off, and
 * `player.chromed` blocks mutation forever after. That is a design statement,
 * not an accident, and clinic treatment (added 2026-08) does not soften it —
 * the clinic is the expensive per-mutation route, chrome is the total,
 * irreversible, free one. Two routes at genuinely different prices.
 */
import { query } from '../models/db.js';
import { maxHpForEndurance } from './ip.js';
import { world } from './world.js';
import { emit } from './events.js';
import { getReputation } from './ideologies.js';
import { registerBodyPartProvider, MUTATION_PARTS } from './body-parts.js';
import { registerAcuityContributor, acuitySync } from './senses.js';
import { registerArmorContributor, addSoakToSlot, recomputeArmor } from './commands/inventory.js';
import {
  getMutationEffectSpec, scaleByExpression, mutationEffectsForSeam,
  getRegisteredMutationEffects,
} from './mutation-effects.js';

let MUTATION_CACHE = {};

export async function loadMutations() {
  const { rows } = await query('SELECT * FROM mutations');
  const cache = {};
  for (const m of rows) cache[m.id] = m;
  MUTATION_CACHE = cache;
  warnUnknownEffectKeys(cache);
  return cache;
}

export function getMutationCache() { return MUTATION_CACHE; }
export function getMutationDef(id) { return MUTATION_CACHE[id] || null; }

/**
 * The check that stops this system failing the way it failed the first time.
 *
 * Before 2026-08 the `effects` JSONB was authored on every mutation and read by
 * nothing at all. An author wrote `rad_resistance: 0.3` and got silence. Now an
 * unrecognised key is LOUD at boot, and plugins/mutations/regress.js fails the
 * build on it — so the only way to author a dead effect is to ignore a red test.
 */
function warnUnknownEffectKeys(cache) {
  const unknown = new Set();
  for (const m of Object.values(cache)) {
    for (const key of Object.keys(m.effects || {})) {
      if (!getMutationEffectSpec(key)) unknown.add(`${m.id}.${key}`);
    }
  }
  if (unknown.size) {
    console.warn(
      `[mutations] ${unknown.size} authored effect key(s) have no registered spec and will do NOTHING: ` +
      `${[...unknown].join(', ')}. Register them in server/engine/mutation-effects.js or remove them.`
    );
  }
  return [...unknown];
}

export function unknownEffectKeys() { return warnUnknownEffectKeys(MUTATION_CACHE); }

// ── Expression ───────────────────────────────────────────────────────────────

/**
 * The weighted ladder. Ordinary results are common and extreme ones are rare
 * enough that a player remembers getting one.
 *
 * Two profiles, because the two mutation classes mean different things. Rads
 * are an accident and mostly produce a body that is slightly wrong; mutagen is
 * a deliberate Wildblood transformation and reaches the top of the ladder. The
 * radiation profile cannot roll above 84 AT ALL — a legendary rad mutation
 * would undercut the whole reason to go and find the Wildblood.
 */
export const EXPRESSION_BANDS = [
  { name: 'common',    min: 10,  max: 29,  radiation: 55, mutagen: 34 },
  { name: 'marked',    min: 30,  max: 59,  radiation: 32, mutagen: 33 },
  { name: 'strong',    min: 60,  max: 84,  radiation: 13, mutagen: 21 },
  { name: 'severe',    min: 85,  max: 94,  radiation: 0,  mutagen: 9  },
  { name: 'profound',  min: 95,  max: 99,  radiation: 0,  mutagen: 2.5 },
  { name: 'legendary', min: 100, max: 100, radiation: 0,  mutagen: 0.5 },
];

export function rollExpression(profile = 'radiation') {
  const key = profile === 'mutagen' ? 'mutagen' : 'radiation';
  const total = EXPRESSION_BANDS.reduce((s, b) => s + b[key], 0);
  let roll = Math.random() * total;
  for (const b of EXPRESSION_BANDS) {
    roll -= b[key];
    if (roll < 0) return b.min + Math.floor(Math.random() * (b.max - b.min + 1));
  }
  return 25;
}

export function expressionBandOf(expression) {
  const e = Number(expression) || 0;
  for (const b of EXPRESSION_BANDS) if (e >= b.min && e <= b.max) return b.name;
  return e < 10 ? 'latent' : 'legendary';
}

// ── Visibility ───────────────────────────────────────────────────────────────

export const VISIBILITY = ['hidden', 'concealable', 'obvious', 'extreme'];

/**
 * What this mutation looks like on THIS body.
 *
 * `visibility_class` is the CEILING — what it looks like fully expressed —
 * and expression walks it down. A mutation authored `obvious` is merely
 * concealable at 20% and unmistakable at 90%. This is what lets one authored
 * mutation cover "you'd notice if you were looking" and "everyone in the bar
 * has stopped talking" without being written twice.
 *
 * A `hidden`-class mutation is never visible at any expression. That is a real
 * authoring choice, not a degenerate case: some things are wrong on the inside.
 */
export function visibilityOfMutation(mutation, expression) {
  const cls = String(mutation?.visibility_class || 'concealable');
  const ceil = VISIBILITY.indexOf(cls);
  if (ceil <= 0) return 'hidden';

  const e = Number(expression) || 0;
  let rung;
  if (e < 10) rung = 0;
  else if (e < 40) rung = ceil - 1;
  else if (e < 80) rung = ceil;
  else rung = ceil + 1;

  return VISIBILITY[Math.max(0, Math.min(VISIBILITY.length - 1, rung))];
}

/** The loudest thing about this body. 'hidden' when there is nothing to see. */
export function visibilityOf(player) {
  let worst = 0;
  for (const { mutation, expression } of getMutations(player)) {
    worst = Math.max(worst, VISIBILITY.indexOf(visibilityOfMutation(mutation, expression)));
  }
  return VISIBILITY[worst];
}

// ── Hydrate / flush (the relations.js pattern) ───────────────────────────────

export async function hydrateMutations(player) {
  if (!player?.id) return;
  player._mutations = new Map();
  player._mutationsDirty = new Set();

  let rows = [];
  try {
    ({ rows } = await query(
      `SELECT mutation_id, expression, source, acquired_at, acquired_expression,
              diagnosed, suppressed_until
         FROM player_mutations WHERE player_id = $1`,
      [player.id]
    ));
  } catch (err) {
    // A body whose mutations won't load is an ordinary body. Degraded, never
    // broken — never block a login on this.
    console.error(`[mutations] hydrate failed for ${player.id}: ${err.message}`);
    return;
  }

  for (const row of rows) {
    if (!MUTATION_CACHE[row.mutation_id]) continue;   // content removed under a live character
    player._mutations.set(row.mutation_id, {
      expression: clampExpression(row.expression),
      source: row.source || 'radiation',
      acquired_at: Number(row.acquired_at) || 0,
      acquired_expression: row.acquired_expression == null ? null : clampExpression(row.acquired_expression),
      diagnosed: row.diagnosed !== false,
      suppressed_until: row.suppressed_until == null ? null : Number(row.suppressed_until),
    });
  }

  cacheGrownParts(player);
  await recomputeMaxHp(player);
  await recomputeVisibleFlag(player);
}

export async function flushMutations(player) {
  const dirty = player?._mutationsDirty;
  if (!dirty?.size) return;

  const rows = [];
  const params = [];
  for (const id of dirty) {
    const rec = player._mutations.get(id);
    if (!rec) continue;   // removals are written eagerly, never through the dirty set
    const b = params.length;
    rows.push(`($${b + 1}::text, $${b + 2}::text, $${b + 3}::smallint, $${b + 4}::text, $${b + 5}::bigint, $${b + 6}::smallint, $${b + 7}::boolean, $${b + 8}::bigint)`);
    params.push(player.id, id, rec.expression, rec.source, rec.acquired_at, rec.acquired_expression,
      rec.diagnosed !== false, rec.suppressed_until ?? null);
  }
  if (!rows.length) { dirty.clear(); return; }

  try {
    await query(
      `INSERT INTO player_mutations (player_id, mutation_id, expression, source, acquired_at, acquired_expression, diagnosed, suppressed_until)
       VALUES ${rows.join(', ')}
       ON CONFLICT (player_id, mutation_id) DO UPDATE
         SET expression = EXCLUDED.expression,
             source = EXCLUDED.source,
             diagnosed = EXCLUDED.diagnosed,
             suppressed_until = EXCLUDED.suppressed_until,
             acquired_expression = COALESCE(player_mutations.acquired_expression, EXCLUDED.acquired_expression)`,
      params
    );
    dirty.clear();
  } catch (err) {
    // Leave it dirty; the next flush retries. A thrown error inside a scheduled
    // tick is worse than a late write.
    console.error(`[mutations] flush failed for ${player.id}: ${err.message}`);
  }
}

export async function flushAllMutations() {
  const dirty = [];
  for (const p of world.players.values()) if (p._mutationsDirty?.size) dirty.push(p);
  await Promise.all(dirty.map(p => flushMutations(p)));
}

const clampExpression = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

/**
 * How strongly a mutation is expressing RIGHT NOW.
 *
 * The single chokepoint every derived contribution reads, which is the whole
 * point: suppression has to reach stats, acuity, soak, resistances, visibility,
 * concealment, natural weapons and the grown-parts cache, and the only way to
 * guarantee it reaches all of them is for none of them to read `rec.expression`
 * directly. Grep for `.expression` in this file: it appears in the read API and
 * here, and nowhere in a calculation.
 *
 * Suppression does not cure and does not stack. It holds the mutation down to a
 * fraction of itself for as long as it lasts, and it lapses on its own with no
 * tick — the stamp is compared lazily, the same way relationship decay is.
 */
const SUPPRESS_FACTOR = 0.25;

export function isSuppressed(rec, now = Date.now()) {
  return !!(rec?.suppressed_until && now < Number(rec.suppressed_until));
}

function effectiveExpression(rec, now = Date.now()) {
  const raw = clampExpression(rec?.expression);
  return isSuppressed(rec, now) ? Math.floor(raw * SUPPRESS_FACTOR) : raw;
}

// ── Read API (SYNC BY CONTRACT — no awaits, no queries) ─────────────────────

/** Everything this body carries, as [{ mutation, expression, band, source, ... }]. */
export function getMutations(player) {
  const out = [];
  for (const [id, rec] of player?._mutations || []) {
    const mutation = MUTATION_CACHE[id];
    if (!mutation) continue;
    out.push({
      mutation, id,
      // The RAW expression is reported, and the suppressed one is flagged
      // separately. A player being medicated should see that their 70% carapace
      // is being held at 17%, not be told they have a 17% carapace — the second
      // reads as the drug having cured something.
      expression: rec.expression,
      effective: effectiveExpression(rec),
      suppressed: isSuppressed(rec),
      diagnosed: rec.diagnosed !== false,
      band: expressionBandOf(rec.expression),
      visibility: visibilityOfMutation(mutation, effectiveExpression(rec)),
      source: rec.source,
      acquired_at: rec.acquired_at,
      acquired_expression: rec.acquired_expression,
    });
  }
  return out;
}

export function hasMutation(player, mutationId) {
  return !!player?._mutations?.has(mutationId);
}

/** 0 when absent, so a caller never has to check twice. */
export function getMutationExpression(player, mutationId) {
  return player?._mutations?.get(mutationId)?.expression || 0;
}

// ── Derived contributions ────────────────────────────────────────────────────
//
// Each accessor filters the effect registry by SEAM, so a key declared under
// 'acuity' can never leak into a stat total even if someone authors it in the
// wrong place.

function sumSeam(player, seam, key) {
  let total = 0;
  for (const [id, rec] of player?._mutations || []) {
    const m = MUTATION_CACHE[id];
    const raw = m?.effects?.[key];
    if (raw == null) continue;
    const spec = getMutationEffectSpec(key);
    if (!spec || spec.seam !== seam) continue;
    total += scaleByExpression(key, raw, effectiveExpression(rec));
  }
  return total;
}

/**
 * Stat contribution. Reads `stat_modifiers`, not `effects` — stat mods keep
 * their own authored column because they predate this system and because they
 * are the one contribution that is not keyed by vocabulary.
 *
 * Expression 100 must reproduce the authored value EXACTLY. See the unbake
 * script: every legacy row is set to 100 so the move off baked columns is
 * arithmetically net-zero on characters who already exist.
 */
export function mutationStatBonus(player, stat) {
  let total = 0;
  for (const [id, rec] of player?._mutations || []) {
    const delta = MUTATION_CACHE[id]?.stat_modifiers?.[stat];
    if (!delta) continue;
    total += Math.trunc(Number(delta) * (effectiveExpression(rec) / 100));
  }
  return total;
}

export function mutationAcuity(player, sense) {
  const gained = sumSeam(player, 'acuity', `acuity_${sense}`);
  // The cost side of a light-sensitive eye. Only sight has one, but read it
  // generically so a sonic organ's counterpart needs no new code here.
  const penalty = sense === 'sight' ? sumSeam(player, 'acuity', 'brightlight_penalty') : 0;
  return gained - penalty;
}

/**
 * Combined resistance, 0..1. Multiplicative, so several sources of the same
 * resistance approach immunity without ever reaching it — three 0.4s give 0.78,
 * not 1.2. A player can never be made immune to a damage channel by stacking.
 */
export function mutationResist(player, kind) {
  let remaining = 1;
  for (const [id, rec] of player?._mutations || []) {
    const raw = MUTATION_CACHE[id]?.effects?.[kind];
    if (raw == null) continue;
    const spec = getMutationEffectSpec(kind);
    if (!spec || spec.seam !== 'resist') continue;
    remaining *= (1 - Math.max(0, Math.min(1, scaleByExpression(kind, raw, effectiveExpression(rec)))));
  }
  return 1 - remaining;
}

/** Any summed numeric/fractional effect, whatever its seam. */
export function mutationNumber(player, key, dflt = 0) {
  const spec = getMutationEffectSpec(key);
  if (!spec) return dflt;
  let total = 0;
  let found = false;
  for (const [id, rec] of player?._mutations || []) {
    const raw = MUTATION_CACHE[id]?.effects?.[key];
    if (raw == null) continue;
    found = true;
    total += scaleByExpression(key, raw, effectiveExpression(rec));
  }
  return found ? total : dflt;
}

/** True if ANY carried mutation asserts this flag at sufficient expression. */
export function mutationFlag(player, key) {
  for (const [id, rec] of player?._mutations || []) {
    const raw = MUTATION_CACHE[id]?.effects?.[key];
    if (raw == null || raw === false) continue;
    if (scaleByExpression(key, raw === true ? 1 : raw, effectiveExpression(rec))) return true;
  }
  return false;
}

/**
 * Can this body see in a room with no light?
 *
 * Three organs answer the same question by different routes, so they get one
 * reader rather than three checks scattered through the describe path. A body
 * that sees in the dark by heat is not using its eyes at all, which is why this
 * is separate from `acuity_sight` — sharper eyes do not help in a pitch-black
 * room and a thermal pit does not care how bright it is.
 */
export function mutationSeesInDark(player) {
  return mutationFlag(player, 'thermal_vision')
      || mutationFlag(player, 'echolocation')
      || mutationFlag(player, 'lowlight_vision');
}

/** Typed soak from mutations, in the same currency as worn armour. */
export function mutationSoak(player) {
  const out = {};
  for (const key of mutationEffectsForSeam('soak')) {
    const v = sumSeam(player, 'soak', key);
    if (v > 0) out[key.replace(/^soak_/, '')] = v;
  }
  return out;
}

// ── Natural weapons ──────────────────────────────────────────────────────────

/**
 * What this body's bare hands are, as a weaponStats object.
 *
 * The whole design rule for mutation combat is in the return type. This is the
 * SAME plain object an equipped pipe produces, handed to the same
 * `playerAttackEnemy`, so soak, crits, body-part rolls, injury, spread and skill
 * all treat a clawed hand exactly as they treat a weapon. There is no parallel
 * combat path, no special-case branch downstream, and nothing to keep in sync.
 *
 * Returns null when the body has grown nothing that changes a punch, so the
 * caller keeps its existing literal and an ordinary player's fists are provably
 * untouched.
 *
 * NOTE ON PRECEDENCE: this is consulted only on the UNARMED branch. Picking up a
 * pipe uses the pipe. A player with bone blades who wants to use them simply
 * puts the pipe down, which is a decision they can make rather than a rule they
 * have to learn.
 */
export function naturalWeaponStats(player) {
  const bonus = mutationNumber(player, 'unarmed_damage_bonus');
  const edged = mutationFlag(player, 'unarmed_edged');
  const bleed = mutationNumber(player, 'unarmed_bleed_chance');
  const venom = mutationNumber(player, 'venom_potency');
  const bite = mutationFlag(player, 'bite_attack');
  if (!bonus && !edged && !bleed && !venom && !bite) return null;

  const status = {};
  if (bleed > 0) status.bleeding = Math.min(0.9, bleed);
  if (venom > 0) status.envenomed = Math.min(0.9, venom);

  return {
    // The base punch, plus what grew on it. Applied to BOTH ends of the range so
    // a natural weapon raises the floor as well as the ceiling: claws do not
    // occasionally do nothing.
    damage_min: 2 + bonus,
    damage_max: 4 + bonus + (bite ? 2 : 0),
    // Still `fists`. A grown blade trains and reads off the unarmed skill,
    // because the alternative is a mutation that silently makes you unskilled
    // with your own body.
    weapon_skill: 'fists',
    damage_type: edged ? 'edged' : 'kinetic',
    status_chance: Object.keys(status).length ? status : undefined,
    natural: true,
  };
}

/** A short name for what you actually hit them with, for the combat line. */
export function naturalWeaponName(player) {
  if (mutationFlag(player, 'unarmed_edged')) return 'bone blades';
  if (mutationFlag(player, 'bite_attack')) return 'teeth';
  if (mutationNumber(player, 'venom_potency') > 0) return 'envenomed claws';
  if (mutationNumber(player, 'unarmed_damage_bonus') > 0) return 'claws';
  return null;
}

// ── Concealment ──────────────────────────────────────────────────────────────

/**
 * Can this garment hide this mutation?
 *
 * Generic on purpose. It reads the slot the item occupies and the slots it
 * `covers`, and asks whether that intersects the slots the MUTATION says would
 * hide it. No clothing item anywhere carries mutation data, and none ever
 * should: a coat conceals a torso mutation because a coat covers a torso.
 *
 * An `extreme` mutation is never concealable whatever is worn over it. A second
 * head is not a tailoring problem.
 */
export function canConcealMutation(item, mutation, bodyPart = null) {
  if (!item || !mutation) return false;
  if (String(mutation.visibility_class) === 'extreme') return false;

  const wants = asList(mutation.conceal_slots);
  if (!wants.length) return false;

  const tags = item.tags || item;
  const covered = new Set();
  const slot = tags.slot ?? item.slot;
  if (slot) covered.add(String(slot));
  for (const s of asList(tags.covers ?? item.covers)) covered.add(String(s));

  if (bodyPart) {
    // Asking about one specific part: only that part's slot counts.
    const needed = wants.filter(s => s === bodyPart || s === slotForPart(bodyPart));
    return needed.some(s => covered.has(s));
  }
  return wants.every(s => covered.has(s));
}

/**
 * Which slots this body cannot currently use, and why.
 *
 * Read-only in Phase 1 — the equip gate exists (server/engine/equip-gates.js)
 * but nothing registers a blocking one yet, so this surfaces as a warning on
 * examine and gear rather than a refusal. Wiring the refusal later is one
 * registerEquipGate call and no change here.
 */
export function getClothingConflicts(player, item) {
  const out = [];
  const tags = item?.tags || item || {};
  const slot = String(tags.slot ?? item?.slot ?? '');
  if (!slot) return out;

  for (const { mutation, expression } of getMutations(player)) {
    const blocked = asList(mutation.blocks_slots);
    if (!blocked.includes(slot)) continue;
    // Blocking is an expression question: a light spur is an irritation, a
    // heavy one genuinely won't go through a sleeve.
    if (expression < 40) continue;
    out.push({ mutation, slot, expression, reason: mutation.name });
  }
  return out;
}

const PART_SLOTS = {
  head: 'head', head_2: 'head', torso: 'torso',
  left_arm: 'hands', right_arm: 'hands', aux_limb: 'hands',
  left_leg: 'legs', right_leg: 'legs', feet: 'feet',
};
const slotForPart = p => PART_SLOTS[p] || null;
const asList = v => (Array.isArray(v) ? v.map(String) : []);

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * What `observer` can actually tell about `target`.
 *
 * The point of routing this through senses rather than a flag is that detection
 * is PER OBSERVER: a Wildblood with sharpened eyes notices the thing under the
 * coat that the barman doesn't. It is the same shape stealth uses, for the same
 * reason.
 *
 * `certain: false` means it was caught only on acuity — the prose is expected to
 * hedge ("something shifts under their coat") rather than name the mutation.
 */
export function detectMutations(observer, target, { dark = false } = {}) {
  const out = [];
  const sight = observer ? acuitySync(observer, 'sight') : 0;
  const isSelf = observer && target && observer.id === target.id;

  for (const entry of getMutations(target)) {
    const vis = entry.visibility;
    if (vis === 'hidden') { if (isSelf) out.push({ ...entry, certain: true }); continue; }

    // You always know your own body, whatever the light.
    if (isSelf) { out.push({ ...entry, certain: true }); continue; }

    if (vis === 'extreme') { out.push({ ...entry, certain: true }); continue; }

    if (vis === 'obvious') {
      if (dark && sight < 1) continue;
      if (sight < 0) continue;
      out.push({ ...entry, certain: true });
      continue;
    }

    // Concealable: covered by what they're wearing, unless the observer is
    // sharp enough to catch it anyway.
    const covered = isCovered(target, entry.mutation);
    if (!covered) { out.push({ ...entry, certain: !dark }); continue; }
    if (sight >= 1) out.push({ ...entry, certain: false });
  }
  return out;
}

/** Is every slot that would hide this mutation currently filled? */
function isCovered(target, mutation) {
  const wants = asList(mutation.conceal_slots);
  if (!wants.length) return false;
  const worn = target?._wornRows;
  if (!worn) return false;
  return wants.every(slot => worn.has(slot));
}

export function getVisibleMutations(player, { observer = null, dark = false } = {}) {
  if (observer) return detectMutations(observer, player, { dark });
  return getMutations(player).filter(e => e.visibility !== 'hidden');
}

// ── Derived caches on the player row ─────────────────────────────────────────

/**
 * `players.visibly_mutated` is now a WRITE-THROUGH DERIVED CACHE, not a state.
 *
 * It exists because four readers already depend on it — the appearance line,
 * the Custodian outcast response, and two client login barbs — and rewriting
 * all of them to call visibilityOf() would be churn for nothing. So the column
 * keeps its meaning ("would a stranger notice?") and this recomputes it.
 *
 * It is NO LONGER A ONE-WAY LATCH. The old comment said "once visible, always
 * visible — you don't un-notice someone's extra eye", and that was right when
 * nothing could remove a mutation. Now the clinic can, and a treated player gets
 * their Custodian-zone access back. That restoration is most of what the
 * treatment fee is buying.
 */
export async function recomputeVisibleFlag(player) {
  const vis = visibilityOf(player);
  const next = (vis === 'obvious' || vis === 'extreme') ? 1 : 0;
  if (Number(player.visibly_mutated || 0) === next) return next;
  player.visibly_mutated = next;
  try {
    await query('UPDATE players SET visibly_mutated=$1 WHERE id=$2', [next, player.id]);
  } catch (err) {
    console.error(`[mutations] visible-flag write failed for ${player.id}: ${err.message}`);
  }
  return next;
}

/**
 * hp_max is a persisted column read by dozens of sites, so it cannot be derived
 * at read time the way stats are. Recompute it whenever the carried set or an
 * expression changes — every mutating path in this file calls this.
 */
export async function recomputeMaxHp(player) {
  const end = (Number(player.stat_endurance) || 0) + mutationStatBonus(player, 'stat_endurance');
  const next = maxHpForEndurance(end);
  if (Number(player.hp_max) === next) return next;
  try {
    const { rows } = await query(
      `UPDATE players SET hp_max=$1, hp=GREATEST(1, LEAST(hp, $1)) WHERE id=$2 RETURNING hp, hp_max`,
      [next, player.id]
    );
    if (rows[0]) { player.hp = rows[0].hp; player.hp_max = rows[0].hp_max; }
  } catch (err) {
    console.error(`[mutations] hp_max write failed for ${player.id}: ${err.message}`);
  }
  return next;
}

/**
 * Grown body parts, cached on the live player for the sync part provider.
 *
 * Derived from `body_parts` rather than from `grants_part`, because a mutation
 * can grow MORE THAN ONE: wings are two parts and there is no honest way to put
 * two in a single TEXT column. `body_parts` already lists everything a mutation
 * touches, so intersecting it with MUTATION_PARTS asks the right question and
 * makes the separate field redundant. `grants_part` is still honoured for any
 * content authored against the older shape.
 *
 * A part is only GROWN once the mutation is expressed enough to have grown it.
 * Below 25% you have the beginnings of a thing, not a limb, and a wing stub that
 * can be aimed at and maimed would be a worse mechanic than no wing at all.
 */
const PART_GROWTH_FLOOR = 25;

function cacheGrownParts(player) {
  const parts = [];
  const weights = {};
  for (const { mutation, expression } of getMutations(player)) {
    if (expression < PART_GROWTH_FLOOR) continue;
    const declared = [
      ...(Array.isArray(mutation.body_parts) ? mutation.body_parts : []),
      ...(mutation.grants_part ? [mutation.grants_part] : []),
    ];
    for (const part of declared) {
      if (!MUTATION_PARTS.includes(part) || parts.includes(part)) continue;
      parts.push(part);
      weights[part] = Number(mutation.effects?.part_hit_weight) || 0;
    }
  }
  player._grownParts = parts;
  player._grownPartWeights = weights;
  return parts;
}

// ── Write paths (cold — grant, treat, remove) ────────────────────────────────

/**
 * Give this body a mutation. `mutationId` null picks a random eligible one.
 *
 * Returns the granted entry, or null if nothing was eligible or the body is
 * chromed.
 */
export async function addRadiationMutation(player, mutationId = null, { expression = null, source = 'radiation' } = {}) {
  if (!player?._mutations) return null;
  if (player.chromed) return null;

  let mutation = mutationId ? MUTATION_CACHE[mutationId] : null;
  if (!mutation && !mutationId) {
    const eligible = Object.values(MUTATION_CACHE).filter(m =>
      (m.source || 'radiation') === 'radiation' &&
      (player.radiation || 0) >= (m.radiation_threshold ?? 40) &&
      !player._mutations.has(m.id)
    );
    if (!eligible.length) return null;
    mutation = eligible[Math.floor(Math.random() * eligible.length)];
  }
  if (!mutation || player._mutations.has(mutation.id)) return null;

  const expr = clampExpression(expression ?? rollExpression(mutation.expression_band || 'radiation'));
  player._mutations.set(mutation.id, {
    expression: expr,
    source,
    acquired_at: Math.floor(Date.now() / 1000),
    acquired_expression: expr,
    // You know what you can SEE. A mutation that grew on the outside arrives
    // already understood; one that changed something internal does not, and
    // until somebody names it you are carrying a wrongness rather than a
    // condition. That gap is what diagnosis is for.
    diagnosed: visibilityOfMutation(mutation, expr) !== 'hidden',
    suppressed_until: null,
  });
  player._mutationsDirty.add(mutation.id);

  await afterMutationChange(player);
  const granted = { mutation, id: mutation.id, expression: expr, band: expressionBandOf(expr),
                    visibility: visibilityOfMutation(mutation, expr), source };

  // ONE event for every grant path — the radiation roll, the flask, and any
  // authored GRANT_MUTATION. The onset (plugins/mutations/onset.js) hangs off
  // this rather than off each caller, so a future path cannot accidentally hand
  // somebody a new body without the body objecting.
  emit('mutation.gained', { player, ...granted });
  return granted;
}

/**
 * Walk a mutation back. Below the visibility floor it is removed outright —
 * a mutation expressed at 6% is not a mutation, it is a scar.
 */
export async function treatMutation(player, mutationId, { reduce = 25 } = {}) {
  const rec = player?._mutations?.get(mutationId);
  const mutation = MUTATION_CACHE[mutationId];
  if (!rec || !mutation) return { ok: false, reason: 'absent' };
  if (mutation.treatable === false) return { ok: false, reason: 'untreatable' };

  const next = clampExpression(rec.expression - Math.max(1, reduce));
  if (next < 10) {
    await removeMutation(player, mutationId);
    return { ok: true, removed: true, expression: 0, mutation };
  }
  rec.expression = next;
  player._mutationsDirty.add(mutationId);
  await afterMutationChange(player);
  return { ok: true, removed: false, expression: next, band: expressionBandOf(next), mutation };
}

/**
 * Name the thing. Returns what was learned, or null if there was nothing to
 * learn — an already-diagnosed mutation is not billable twice.
 *
 * Diagnosis changes NOTHING mechanical. The mutation was always doing what it
 * does; you simply did not know what it was. That is deliberate: a diagnostic
 * that also improved the outcome would make not-knowing a mechanical penalty
 * rather than an information state, and information is the whole point.
 */
export async function diagnoseMutation(player, mutationId) {
  const rec = player?._mutations?.get(mutationId);
  const mutation = MUTATION_CACHE[mutationId];
  if (!rec || !mutation || rec.diagnosed !== false) return null;
  rec.diagnosed = true;
  player._mutationsDirty.add(mutationId);
  return { mutation, expression: rec.expression, band: expressionBandOf(rec.expression) };
}

/** Everything on this body that nobody has put a name to yet. */
export function undiagnosedMutations(player) {
  return getMutations(player).filter(e => !e.diagnosed);
}

/**
 * Hold a mutation down for a while. The cheap tier: it does not cure, it does
 * not stack, and it lapses on its own.
 *
 * Suppression reaches every derived contribution because nothing in this file
 * reads `rec.expression` in a calculation — see effectiveExpression. So a
 * suppressed carapace soaks less, a suppressed glow is less visible, a suppressed
 * claw hits softer and a suppressed tail may stop blocking your trousers, all
 * from one stamp.
 */
export async function suppressMutation(player, mutationId, { hours = 6 } = {}) {
  const rec = player?._mutations?.get(mutationId);
  const mutation = MUTATION_CACHE[mutationId];
  if (!rec || !mutation) return { ok: false, reason: 'absent' };
  if (mutation.treatable === false) return { ok: false, reason: 'untreatable' };

  const until = Date.now() + Math.max(1, Number(hours) || 6) * 3600_000;
  // Never SHORTEN an existing course by re-dosing.
  rec.suppressed_until = Math.max(Number(rec.suppressed_until) || 0, until);
  player._mutationsDirty.add(mutationId);
  await afterMutationChange(player);
  return { ok: true, mutation, until: rec.suppressed_until, effective: effectiveExpression(rec) };
}

export async function removeMutation(player, mutationId) {
  if (!player?._mutations?.has(mutationId)) return false;
  player._mutations.delete(mutationId);
  player._mutationsDirty.delete(mutationId);
  try {
    await query('DELETE FROM player_mutations WHERE player_id=$1 AND mutation_id=$2', [player.id, mutationId]);
  } catch (err) {
    console.error(`[mutations] remove failed for ${player.id}: ${err.message}`);
  }
  await afterMutationChange(player);
  return true;
}

/**
 * Burn every mutation off. The chrome-doctor's total conversion, called by
 * plugins/augments on the first install — never by a random rad-mugging.
 *
 * Note how much shorter this is than it used to be. It previously had to sum
 * and reverse every stat_modifier the player had ever been granted; now that
 * nothing is baked, deleting the rows IS the reversal. That simplification is
 * the clearest argument for the derived model.
 */
export async function burnAllMutations(player) {
  const count = player?._mutations?.size || 0;
  if (!count) return 0;
  player._mutations.clear();
  player._mutationsDirty.clear();
  try {
    await query('DELETE FROM player_mutations WHERE player_id=$1', [player.id]);
  } catch (err) {
    console.error(`[mutations] burn failed for ${player.id}: ${err.message}`);
  }
  await afterMutationChange(player);
  return count;
}

/** Everything that has to be true again after the carried set moves. */
async function afterMutationChange(player) {
  cacheGrownParts(player);
  await recomputeMaxHp(player);
  await recomputeVisibleFlag(player);
  // Mutation plate lands in the same per-slot map worn armour does, so the set
  // changing means the map is stale. Best-effort: the next equip rebuilds it
  // anyway, and a failed rebuild must not abort a grant.
  try { await recomputeArmor(player); }
  catch (err) { console.error(`[mutations] armour recompute failed: ${err.message}`); }
}

// ── Coming back from the vats ────────────────────────────────────────────────

/**
 * Which mutations survive a death.
 *
 * The default is `all`, which is EXACTLY what already shipped: mutations persist
 * through the vats and radiation does not. That asymmetry is the existing rule
 * and this does not overturn it — the column exists so a SPECIFIC mutation can
 * opt out, without anybody inventing a second biology that contradicts the first.
 *
 * `radiation_only` / `mutagen_only` name what SURVIVES, not what is lost, which
 * is the reading that made sense to everyone who was asked.
 *
 * Applied on `player.respawn`. Nothing calls this on an ordinary logout, so a
 * mutation cannot be lost by disconnecting.
 */
export function survivesCloning(mutation, source) {
  const policy = String(mutation?.clone_inheritance || 'all');
  const kind = (source || mutation?.source || 'radiation') === 'mutagen' ? 'mutagen' : 'radiation';
  if (policy === 'none') return false;
  if (policy === 'radiation_only') return kind === 'radiation';
  if (policy === 'mutagen_only') return kind === 'mutagen';
  return true;   // 'all', and anything unrecognised — fail toward keeping the body you had
}

export async function applyCloneInheritance(player) {
  if (!player?._mutations?.size) return [];
  const lost = [];
  for (const [id, rec] of [...player._mutations]) {
    const mutation = MUTATION_CACHE[id];
    if (!mutation || survivesCloning(mutation, rec.source)) continue;
    lost.push(mutation);
    player._mutations.delete(id);
    player._mutationsDirty.delete(id);
  }
  if (!lost.length) return [];

  try {
    await query(
      `DELETE FROM player_mutations WHERE player_id=$1 AND mutation_id = ANY($2)`,
      [player.id, lost.map(m => m.id)]
    );
  } catch (err) {
    console.error(`[mutations] clone-inheritance prune failed for ${player.id}: ${err.message}`);
  }
  await afterMutationChange(player);
  return lost;
}

// ── The radiation trigger ────────────────────────────────────────────────────

export async function checkMutationTrigger(player) {
  // Chrome can't mutate — see the interlock note in the file header.
  if (player.chromed) return null;
  if ((player.radiation || 0) < 40) return null;

  // Roll BEFORE anything else. This is a 5% event checked once a minute for
  // every irradiated player; doing the work first meant 19 out of 20 passes
  // existed purely to be discarded. Now the read is free (memory) but the roll
  // still comes first, because the outcomes are identical and the cheap branch
  // should be the common one.
  if (Math.random() > 0.05) return null;
  if (!player._mutations) return null;

  return addRadiationMutation(player, null, { source: 'radiation' });
}

// ── The mutagen gate ─────────────────────────────────────────────────────────

/**
 * Mutagen is Wildblood-only, and this is where that is ENFORCED — at the
 * application layer, not in a UI check. There is deliberately no path that
 * reaches applyMutagenMutation without coming through here.
 *
 * Two conditions, both required:
 *   - Inner Circle reputation with ideology_wildblood (>= 900). Rep is earned
 *     and decays, so this is a standing you keep rather than a box you ticked.
 *   - The Quickening ritual flag. You went to the Pool and they held you under.
 *
 * The rep alone is not enough because rep is a measure of how much they like
 * you, and the ritual is a thing that happened to your body. Both, or neither.
 *
 * PHASE 1: the gate and its enforcement ship; the mutagen mutations, the item
 * and the recruitment arc that sets the ritual flag do not. So this correctly
 * refuses everybody today. That is the contract later phases build against.
 */
export const WILDBLOOD_IDEOLOGY = 'ideology_wildblood';
export const QUICKENING_FLAG = 'wildblood_quickened';
const INNER_CIRCLE_REP = 900;

export async function canUseMutagen(player) {
  if (!player?.id) return { allowed: false, reason: 'no_player' };
  if (player.chromed) return { allowed: false, reason: 'chromed' };

  let rep = 0;
  try {
    rep = await getReputation(player.id, WILDBLOOD_IDEOLOGY);
  } catch {
    return { allowed: false, reason: 'no_rep' };
  }
  if ((Number(rep) || 0) < INNER_CIRCLE_REP) return { allowed: false, reason: 'no_rep', rep };

  const quickened = player._flags?.get(QUICKENING_FLAG);
  if (!quickened) return { allowed: false, reason: 'no_ritual', rep };

  return { allowed: true, rep };
}

/**
 * Apply a mutagen mutation. Re-checks the gate itself rather than trusting its
 * caller — a verb, a script node and a dialogue action are three different
 * doors into this and only one check can be the real one.
 */
export async function applyMutagenMutation(player, mutationId, { expression = null } = {}) {
  const gate = await canUseMutagen(player);
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  const mutation = MUTATION_CACHE[mutationId];
  if (!mutation) return { ok: false, reason: 'unknown_mutation' };
  if ((mutation.source || 'radiation') !== 'mutagen') return { ok: false, reason: 'not_mutagen' };
  if (player._mutations?.has(mutationId)) return { ok: false, reason: 'already_carried' };

  // Mutagen never wastes itself. The floor is the bottom of the ladder, so the
  // worst possible outcome is still a mutation you have visibly acquired —
  // there is no result where it is consumed and nothing happens.
  const expr = clampExpression(expression ?? rollExpression('mutagen'));
  const granted = await addRadiationMutation(player, mutationId, { expression: expr, source: 'mutagen' });
  return granted ? { ok: true, ...granted } : { ok: false, reason: 'grant_failed' };
}

export async function consumeMutagen(player, mutagenId = null) {
  const gate = await canUseMutagen(player);
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  const pool = Object.values(MUTATION_CACHE).filter(m =>
    (m.source || 'radiation') === 'mutagen' && !player._mutations?.has(m.id)
  );
  if (!pool.length) return { ok: false, reason: 'nothing_left' };
  const pick = mutagenId && MUTATION_CACHE[mutagenId]
    ? MUTATION_CACHE[mutagenId]
    : pool[Math.floor(Math.random() * pool.length)];
  return applyMutagenMutation(player, pick.id);
}

// ── The city's reaction ──────────────────────────────────────────────────────

/**
 * Custodian-aligned zones treat a visibly mutated body as an outcast. Escalating
 * rather than binary: staff notice and make sure you know it, and only the loudest
 * expression brings the turrets round on its own.
 *
 * Kept in the engine because describe.js calls it on every room render.
 */
export function getCustodianOutcastResponse(zone, player) {
  const vis = visibilityOf(player);
  if (vis !== 'obvious' && vis !== 'extreme') return null;
  const flags = zone?.flags || {};
  if (!flags.custodian_controlled) return null;

  // An extreme body doesn't need the zone to be armed. Somebody calls it in.
  if (flags.has_turrets || vis === 'extreme') {
    return {
      hostile: !!flags.has_turrets,
      message: `\n<span class="turret-warning">⚠ AUTOMATED TURRET: "MUTATION SIGNATURE DETECTED. DEVIATION FROM BASELINE. NON-COMPLIANT."</span>`,
    };
  }
  return {
    hostile: false,
    message: `\n<span class="outcast-warning">Custodian staff eye you and step back. One mutters into a radio. You are not welcome here, and everyone has made sure you know it.</span>`,
  };
}

// ── Registrations ────────────────────────────────────────────────────────────
//
// Registered rather than imported by the consumers, so nothing downstream has to
// know this module exists and no import cycle closes.

registerBodyPartProvider(player => player?._grownParts || [], 'mutations');

registerAcuityContributor((player, sense) => mutationAcuity(player, sense), 'mutations');

registerArmorContributor((player, bySlot) => {
  const soak = mutationSoak(player);
  if (!Object.keys(soak).length) return;
  // Mutation armour is ON the body, so it lands on every body slot rather than
  // on the one a garment would occupy — a carapace does not have a sleeve.
  for (const slot of ['head', 'torso', 'hands', 'legs', 'feet']) addSoakToSlot(bySlot, slot, soak);
});

// Kept for the regress suite and the boot-time key audit.
export { getRegisteredMutationEffects };
