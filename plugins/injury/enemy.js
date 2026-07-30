/**
 * Injuries on enemies — §8b of docs/proposals/injury-system.md.
 *
 * The player half of this system delivers CONSEQUENCE: fights leave marks, sleep
 * and medicine matter, armour is retroactively more important. This half
 * delivers TACTICS. It is the only part of the design that changes what you
 * actually do during a fight:
 *
 *   - ruin its legs and it cannot break away
 *   - ruin its arms and it stops landing hits
 *
 * ── Why this is so much cheaper than the player half ────────────────────────
 * An enemy instance is a disposable in-memory object. It has no flag row, no
 * login, no decay clock and no tablet screen. So there is NO storage, NO
 * persistence, NO lazy-decay maths and NO naming table here: wounds live on the
 * instance and die with it. A mob that flees and respawns is whole again, which
 * is correct — it is a different mob.
 *
 * That also means this file must never grow a `query()`. It runs on the combat
 * hot path, once per landed player swing, and is SYNC BY CONTRACT.
 *
 * The engine reads two plain fields we maintain here — `_injuryHitMod` and
 * `_injuryFleeMod` — rather than importing this plugin, the same one-way shape
 * `_powQueued` and `_aimPart` already use. With this plugin absent both are
 * undefined and combat is byte-identical.
 */
import { registerEnemyDamageObserver } from '../../server/engine/damage-events.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { setFlag } from '../../server/engine/flags.js';
import { severityFor } from './index.js';
import { PARTS, PART_LABELS, HURT, MAIMED, injuryName } from './tables.js';

// Mirrors penalties.js, deliberately. An enemy is not a player — it has no
// stamina bar, no stat block worth degrading and nowhere to display a paper doll
// — so only the two penalties that are VISIBLE IN A FIGHT are modelled. A mob's
// wounded torso would be a number nobody could ever perceive.
const ARM_HIT = { [HURT]: -2, [MAIMED]: -5 };
const LEG_FLEE = { [HURT]: -2, [MAIMED]: -6 };

// ── Anatomy is DATA, not the humanoid seven ─────────────────────────────────
//
// Enemies already author their own `body_parts`, and some are not remotely
// human: the bay leviathan is body/coils/fluke/maw, the cable eel has a tail.
// Validating a wound against the player's fixed part list meant those creatures
// could never be injured at all — the tail and the maw were silently discarded,
// and any new anatomy (a third arm, a venom sac) would have been too.
//
// So the enemy side accepts whatever the creature declares, and works out what a
// part DOES by role. A part entry may state `role` explicitly; otherwise it is
// inferred from the name, which covers every existing enemy without touching a
// single content file.
//
//   'attack'   — a limb it hits with. Wounding it degrades the swing.
//   'mobility' — a limb it moves on. Wounding it degrades the flee roll.
//   null       — everything else: real, nameable, wounded, but mechanically inert
//                (a wounded torso on a mob is a number nobody can perceive).
const ATTACK_HINTS = ['arm', 'claw', 'pincer', 'maw', 'jaw', 'fang', 'talon', 'tentacle'];
const MOBILITY_HINTS = ['leg', 'foot', 'feet', 'coil', 'fluke', 'tail', 'wing', 'tread', 'rotor'];

// Any authored part name reads as prose: `venom_sac` -> "venom sac". The
// humanoid labels still win where they exist.
export function partLabel(part) {
  return PART_LABELS[part] || String(part || '').replace(/_/g, ' ');
}

export function partRole(entry, part) {
  const declared = entry?.role;
  if (declared === 'attack' || declared === 'mobility' || declared === 'none') {
    return declared === 'none' ? null : declared;
  }
  const p = String(part || '').toLowerCase();
  if (ATTACK_HINTS.some(h => p.includes(h))) return 'attack';
  if (MOBILITY_HINTS.some(h => p.includes(h))) return 'mobility';
  return null;
}

// The parts this creature actually has, as a Map<part, entry>. A creature with
// no authored list is not an error — combat falls back to the global humanoid
// spread for it, so this does too.
function partEntries(enemy) {
  const out = new Map();
  const list = Array.isArray(enemy?.body_parts) ? enemy.body_parts : [];
  for (const e of list) if (e?.part) out.set(e.part, e);
  return out;
}

/** Wounds on an enemy instance, created lazily so untouched mobs allocate nothing. */
export function enemyInjuries(enemy) {
  if (!enemy) return null;
  return enemy._injuries || null;
}

export function enemySeverity(enemy, part) {
  return enemy?._injuries?.get(part)?.sev || 0;
}

/**
 * Recompute the two fields combat reads. Called only when a wound actually
 * changed, never per swing — the engine reads the cached numbers.
 */
function recompute(enemy) {
  const map = enemy._injuries;
  const entries = partEntries(enemy);
  let hitMod = 0;
  let worstMobility = 0;

  for (const [part, rec] of map) {
    if (rec.sev < HURT) continue;
    const role = partRole(entries.get(part), part);
    // Attack limbs STACK: each ruined arm costs again, which is what makes a
    // many-armed creature a genuine target-priority puzzle rather than a lump of
    // HP. Mobility takes the WORST rather than stacking — a thing with six legs
    // is not six times more mobile, and crippling one is not six times as good.
    if (role === 'attack') hitMod += ARM_HIT[Math.min(rec.sev, MAIMED)] || 0;
    else if (role === 'mobility') worstMobility = Math.max(worstMobility, rec.sev);
  }

  enemy._injuryHitMod = hitMod;
  enemy._injuryFleeMod = worstMobility >= HURT ? (LEG_FLEE[Math.min(worstMobility, MAIMED)] || 0) : 0;
}

/**
 * A short clause describing the worst thing wrong with this creature, or null.
 * Used by `look`/`examine` so a player can SEE that the leg they have been
 * working on is finally ruined — without that feedback, aiming at a limb is an
 * act of faith.
 */
export function enemyWoundNote(enemy) {
  const map = enemy?._injuries;
  if (!map?.size) return null;
  let worst = null;
  for (const [part, rec] of map) {
    if (!worst || rec.sev > worst.rec.sev) worst = { part, rec };
  }
  if (!worst || worst.rec.sev < HURT) return null;
  const label = partLabel(worst.part);
  const name = injuryName(worst.rec.type, worst.rec.sev, worst.part);
  return worst.rec.sev >= MAIMED
    ? `Its ${label} is ${name} — it is barely using that side.`
    : `Its ${label} is ${name}.`;
}

// The observer. SYNC, query-free, and cheap for the overwhelmingly common case
// of a hit that wounds nothing.
function onEnemyDamage(enemy, { part, damage, baseDamage, type, critical, forceSeverity, attacker }) {
  // Any part the creature actually has — NOT the player's humanoid seven. A
  // creature with no authored list falls back to the global spread in combat, so
  // accept those names too rather than dropping its wounds on the floor.
  if (!enemy || !part || !(damage > 0)) return;
  const entries = partEntries(enemy);
  if (entries.size ? !entries.has(part) : !PARTS.includes(part)) return;

  // Enemies vary enormously in hp_max (a rat and a boss are not on one scale),
  // and the threshold is a FRACTION of that — so this reads as "a wound relative
  // to what this creature can take", which is what makes the same rules work for
  // both without a per-enemy authoring surface.
  const hpMax = enemy.hp_max || enemy.hp || 20;
  const existing = enemy._injuries?.get(part)?.sev || 0;
  const scored = baseDamage > 0 ? baseDamage : damage;
  // See the player-side note: a called head shot that fell short of the kill
  // floor still ruins the skull. Combat decided it, not this roll.
  const sev = forceSeverity > 0
    ? Math.min(MAIMED, forceSeverity)
    : severityFor(scored, hpMax, type, { critical, existing, head: part === 'head' });
  if (sev <= 0) return;

  const next = Math.max(sev, existing);
  if (next === existing) return;         // never downgrade, never churn

  if (!enemy._injuries) enemy._injuries = new Map();
  enemy._injuries.set(part, { sev: next, type: type || 'kinetic' });
  recompute(enemy);

  // Tell the attacker they just did something durable. Without this the tactical
  // half of the system is invisible: you can cripple a mob's leg and nothing
  // anywhere says so until you examine it, so nobody would ever learn that
  // working a limb is a thing that works.
  if (next >= HURT && attacker?.id) {
    const label = partLabel(part);
    const name = injuryName(type || 'kinetic', next, part);
    sendToPlayer(attacker.id, {
      type: 'output',
      message: `<span class="ambient">Its ${label} is ${name}.</span>`,
    });
    maybeTeachAim(attacker);
  }
}

// The discovery path for the whole opt-in half. Seeing a wound land on something
// you are fighting is the moment "you could have chosen where that went" is
// worth hearing — earlier is noise, later is too late to matter.
const TAUGHT_AIM_FLAG = 'taught_aim';

function maybeTeachAim(player) {
  if (player._flags?.get(TAUGHT_AIM_FLAG)) return;
  setFlag('player', TAUGHT_AIM_FLAG, '1', player).catch(() => {});
  sendToPlayer(player.id, {
    type: 'output',
    message: `<span class="ambient">You could have put that somewhere you chose — ${teachVerb('aim')} a body part to call your shots. Harder to land, and worth it.</span>`,
  });
}

registerEnemyDamageObserver(onEnemyDamage, 'injury');
