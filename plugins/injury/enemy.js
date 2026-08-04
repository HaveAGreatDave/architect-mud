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
import { sendToPlayer } from '../../server/engine/messaging.js';
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
const ATTACK_HINTS = ['arm', 'claw', 'pincer', 'maw', 'jaw', 'fang', 'talon', 'tentacle', 'tendril', 'stinger'];
const MOBILITY_HINTS = ['leg', 'foot', 'feet', 'coil', 'fluke', 'tail', 'wing', 'tread', 'rotor', 'fin', 'flipper'];

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
  recomputeGrants(enemy, entries, map);
}

// ── What a part GIVES the creature, and what breaking it takes away ──────────
//
// A body part may carry a `grants` block. While the part is intact the creature
// has that capability; MAIM it and the capability is gone. This is the half that
// turns anatomy from a damage-location table into a set of things worth aiming
// at for a reason other than "more damage".
//
//   grants.component  index into the creature's `weapon` array. That damage
//                     COMPONENT stops firing — the Heavy Enforcer's arc goes
//                     out, the gill mutant stops biting. Lost only when EVERY
//                     part granting it is maimed, so a pair of arms sharing a
//                     component behaves like a pair.
//   grants.dodge      evasion the part provides. Ruin a lurker's fins and it
//                     cannot slip you any more.
//   grants.capability a named string other systems can gate on (`grab`, `spit`).
//                     Consumed by plugins/injury/grab.js, which turns an intact
//                     `grab` part into a move gate: a creature holding you does
//                     not let you walk away. Other strings remain inert until
//                     something asks for them — the seam is here so a behaviour
//                     can check it without this file learning about that
//                     behaviour.
//
// The three do NOT lose their grant on the same curve, and that is a decision
// rather than an oversight:
//
//   component   ALL-OR-NOTHING. Lost only when every part granting it is maimed
//               (`parts.every(dead)` below), so a pair of arms sharing a weapon
//               behaves like a pair.
//   capability  ALL-OR-NOTHING, by the mirror-image rule: any SURVIVING granter
//               keeps adding it to the Set, so it holds until the last one is
//               gone. The tar horror is the case this was shaped around — both
//               tendrils grant `grab` AND component 0, so ruining the first
//               costs it nothing and ruining the second costs it the grab and
//               its only weapon at once. A cliff, deliberately.
//   dodge       ADDITIVE. Each ruined fin takes its own share, so evasion
//               degrades as a gradient rather than falling off a cliff.
//
// Deliberately NOT here: soak. Parts already carry their own typed `soak`, and a
// second creature-wide plating number in the same block would be two knobs that
// look like one.
function recomputeGrants(enemy, entries, map) {
  const dead = (part) => (map.get(part)?.sev || 0) >= MAIMED;

  // component -> [parts granting it]; lost when all of them are gone.
  const byComponent = new Map();
  let dodgeLost = 0;
  const capabilities = new Set();

  for (const [part, entry] of entries) {
    const g = entry?.grants;
    if (!g) continue;
    if (Number.isInteger(g.component)) {
      if (!byComponent.has(g.component)) byComponent.set(g.component, []);
      byComponent.get(g.component).push(part);
    }
    if (g.dodge > 0 && dead(part)) dodgeLost += Number(g.dodge) || 0;
    if (g.capability && !dead(part)) capabilities.add(String(g.capability));
  }

  const lost = new Set();
  for (const [idx, parts] of byComponent) if (parts.every(dead)) lost.add(idx);

  enemy._lostComponents = lost.size ? lost : null;
  enemy._injuryDodgeMod = dodgeLost ? -dodgeLost : 0;
  enemy._capabilities = capabilities;
}

/** Does this creature still have a named capability? Intact parts grant them. */
export function enemyHasCapability(enemy, name) {
  if (!enemy?._capabilities) {
    // Never wounded: everything it was authored with is still attached.
    return (enemy?.body_parts || []).some(p => p?.grants?.capability === name);
  }
  return enemy._capabilities.has(name);
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
  }
}

// `aim` is NOT taught from here, and deliberately.
//
// It used to be: the first durable wound you inflicted fired a one-shot hint.
// The trouble is that a called shot at skill 0 lands 5% of the time, and the
// first wound you ever inflict is by definition the moment your skill is
// lowest — so the hint arrived exactly when the verb was a trap, and the
// version of it that said "you are ready for this" was unreachable for anyone
// but a high-stat build. A lesson whose caveat is "not yet" should not be
// delivered mid-swing by nobody.
//
// Grady teaches it instead (TEACH_AIM, plugins/injury/index.js). He can say
// "not yet" and still be there to say "now" when you come back trained, which
// an ambient one-shot never could.

registerEnemyDamageObserver(onEnemyDamage, 'injury');
