/**
 * Augments' contribution to Nullcraft — somebody else's chrome as a target.
 *
 * This is the confrontation the whole faction axis was built for. The Ascendants
 * buy the best machine in the room; the Null looks at it and sees a power source,
 * a controller, an actuator, a radio and a telemetry stream, and picks one.
 *
 * ── What this file may and may not write ────────────────────────────────────
 *
 * TRANSIENT operations write NOTHING. `nullAugmentDown` is read by
 * `getAugments()` in state.js — the single funnel every derived augment number
 * already passes through — so a locked arm stops contributing to stats and soak
 * by the same route an EMP already uses (`chromeDown`). There is no "disabled"
 * column and there must never be one.
 *
 * DURABLE sabotage moves `player_augments.condition`, through state.js's own
 * writer, because state.js is the ONLY writer of that table and that rule is
 * older and more important than this feature.
 *
 * ── The overclock vulnerability (spec §18–19) ───────────────────────────────
 *
 * This is the best-integrated idea in the design and it cost almost nothing,
 * because `overclock_level` and the heat model already existed. Overclocking
 * raises output, heat and — now — EXPOSURE, and the reason that is fair is that
 * the augment's owner chose it and can un-choose it. A Null who analyses a
 * running-hot arm is reading a decision somebody made, not a dice roll.
 *
 * Crucially the Null does not invent a way to break chrome. Sabotage pushes the
 * augment's OWN failure path — the same `failure_messages` the overclock system
 * already requires every overclockable augment to author. The Null presses the
 * button the Ascendant installed.
 */
import { query } from '../../server/models/db.js';
import { getZonePlayers } from '../../server/engine/world.js';
// augmentKey / VITAL / nullAugmentDown live in state.js, NOT here, so the
// dependency runs one way: state.js never imports this file. They belong beside
// getAugments anyway — that is the funnel that reads them.
import { rosterOf, catalogSync, VITAL } from './state.js';

// Attack surfaces by slot. A neural implant has no actuator and an arm has no
// memory worth reading — keeping that honest is what makes `analyze` worth typing
// instead of a menu that is the same every time.
const SLOT_SUBSYSTEMS = {
  neural: [
    { id: 'input',      kind: 'sensor',     exposure: 25 },
    { id: 'processing', kind: 'processing', exposure: 20 },
    { id: 'memory',     kind: 'processing', exposure: 15 },
    { id: 'telemetry',  kind: 'telemetry',  exposure: 55 },
    { id: 'network',    kind: 'network',    exposure: 40 },
  ],
  eyes: [
    { id: 'optics',    kind: 'sensor',     exposure: 35 },
    { id: 'targeting', kind: 'processing', exposure: 25 },
    { id: 'telemetry', kind: 'telemetry',  exposure: 60 },
    { id: 'network',   kind: 'network',    exposure: 45 },
  ],
  arms: [
    { id: 'actuation', kind: 'actuation', exposure: 30 },
    { id: 'control',   kind: 'control',   exposure: 30 },
    { id: 'power',     kind: 'power',     exposure: 25 },
    { id: 'telemetry', kind: 'telemetry', exposure: 65 },
  ],
  legs: [
    { id: 'actuation', kind: 'actuation', exposure: 30 },
    { id: 'control',   kind: 'control',   exposure: 30 },
    { id: 'power',     kind: 'power',     exposure: 25 },
    { id: 'telemetry', kind: 'telemetry', exposure: 65 },
  ],
  torso: [
    { id: 'power',     kind: 'power',     exposure: 20 },
    { id: 'control',   kind: 'control',   exposure: 25 },
    { id: 'telemetry', kind: 'telemetry', exposure: 60 },
    { id: 'network',   kind: 'network',   exposure: 40 },
  ],
};

/**
 * Security for a piece of chrome. Derived, never a second authored column.
 *
 * `tier` is how good it is, `calibration` is how well it was tuned, `condition`
 * is how beaten up it is — the three numbers that already answer "how good is
 * this chrome" — plus `overclock_max`, which is the ENTIRE mechanical statement
 * of the faction split: licensed Ascendant chrome authors 0–1, back-alley chrome
 * authors 3. Reading it here means the licensed piece is also the hard target,
 * with nothing new authored anywhere.
 */
function securityOf(aug, rec) {
  const tier = Number(aug.tier) || 1;
  const cal = Number(rec.calibration ?? 100);
  const cond = Number(rec.condition ?? 1);
  const licensed = (Number(aug.overclock_max) || 0) <= 1;

  let rating = tier * 14 + (cal / 100) * 20 + (licensed ? 15 : 0);
  rating *= Math.max(0.4, cond);          // wrecked chrome defends itself badly

  // The manual override of spec §21 — an owner who has pulled the radio. Stored
  // on the record's own custom_data, so it costs no column.
  const wireless = rec.custom_data?.radio_off !== true;

  return {
    rating: Math.round(Math.min(100, rating)),
    wireless,
    auth: licensed && tier >= 3 ? 'military' : tier >= 2 ? 'encrypted' : 'basic',
  };
}

/** The `tech.targets` contribution: chrome installed in anybody standing here. */
export async function augmentTargets(player, ctx = {}) {
  const zoneId = ctx.zoneId || player.current_zone;
  if (!zoneId) return [];
  const cache = catalogSync();
  const out = [];

  for (const other of (getZonePlayers(zoneId) || [])) {
    // Your own chrome is a legitimate target — reading your own attack surfaces
    // is how an Ascendant learns what to harden, and refusing it would make the
    // verb useless to exactly the player most motivated to type it.
    for (const rec of rosterOf(other).values()) {
      const aug = cache[rec.augment_id];
      if (!aug) continue;

      const oc = Number(rec.overclock_level) || 0;
      const subs = (SLOT_SUBSYSTEMS[aug.slot] || SLOT_SUBSYSTEMS.torso).map(s => ({
        ...s,
        // §18: running hot is running loud. An overclocked machine radiates, and
        // every surface on it gets easier to reach.
        exposure: Math.min(95, s.exposure + oc * 12),
      }));

      const notes = [];
      if (oc > 0) notes.push(`Running at ${100 + oc * 25}% — thermal signature is wide open.`);
      if (Number(rec.condition ?? 1) < 0.5) notes.push('Badly worn. Whatever is holding it together is not much.');
      if (rec.custom_data?.radio_off === true) notes.push('Radio physically disconnected. Somebody has done this before.');

      out.push({
        key: augmentKey(other.id, rec.augment_id),
        ownerId: other.id,
        ownerName: other.handle,
        zoneId,
        name: aug.name,
        kind: 'augment',
        subsystems: subs,
        security: securityOf(aug, rec),
        notes,

        async apply(opId, subsystem, { player: actor }) {
          const whose = other.id === actor.id ? 'your' : `${other.handle}'s`;

          // TRANSIENT — the substrate is the truth; getAugments reads it.
          if (opId === 'jam' || opId === 'spoof' || opId === 'lock' || opId === 'crash') {
            const vital = VITAL.has(subsystem.kind);
            return {
              message: `<span class="msg-system">${aug.name} — ${subsystem.id} ${vital ? 'stops responding' : 'starts lying'}.</span>`,
              ownerMessage: vital
                ? `<span class="text-red">Your ${aug.name} goes dead weight. The ${subsystem.id} is not answering.</span>`
                : `<span class="text-amber">Your ${aug.name} is reporting something that cannot be true.</span>`,
            };
          }

          if (opId === 'hijack') {
            return {
              message: `<span class="ip-gain">${whose} ${aug.name} moves when you tell it to.</span>`,
              ownerMessage: `<span class="text-red">Your ${aug.name} moves, and you did not move it.</span>`,
            };
          }

          // ── The overclock exploit ────────────────────────────────────────
          // Damage scales with how far past spec the owner chose to run. At
          // spec it is a flicker; at overclock 3 it is most of the augment.
          // Nothing here invents a failure mode — it spends condition, which is
          // the same currency wear, heat and a botched repair already spend,
          // and speaks the augment's OWN authored failure line.
          if (opId === 'powerspike') {
            if (oc <= 0) {
              return {
                message: `<span class="text-dim">The supply sags and recovers. ${whose} ${aug.name} is running at spec — there was nothing to push it into.</span>`,
                ownerMessage: `<span class="text-dim">Your ${aug.name} flickers, and steadies.</span>`,
              };
            }
            await applyDurableDamage(other, rec.augment_id, 0.12 + oc * 0.13);
            const line = aug.failure_messages?.burnout || aug.failure_messages?.fault;
            return {
              message: `<span class="text-red">You put the surge through it while it was already screaming. ${whose} ${aug.name} lets go.</span>`,
              ownerMessage: `<span class="text-red">${line || `Your ${aug.name} spikes, sears, and dies mid-motion.`}</span>`,
            };
          }

          // DURABLE — real condition, through state.js's own writer.
          if (opId === 'sabotage') {
            await applyDurableDamage(other, rec.augment_id, 0.2);
            return {
              message: `<span class="text-red">Something inside ${whose} ${aug.name} gives.</span>`,
              ownerMessage: `<span class="text-red">${aug.failure_messages?.fault
                || `Your ${aug.name} lurches, and something in it tears.`}</span>`,
            };
          }
          return null;
        },
      });
    }
  }
  return out;
}

/**
 * Burn condition off an installed augment.
 *
 * Writes through `player_augments` and updates the in-memory record so the two
 * cannot disagree. This is the one place in this file that touches the table,
 * and it does the roster update in the same breath deliberately — state.js's
 * rule is that the row and the RAM copy never drift.
 */
async function applyDurableDamage(owner, augmentId, amount) {
  const rec = rosterOf(owner).get(augmentId);
  if (!rec) return;
  const next = Math.max(0, Math.min(1, Number(rec.condition ?? 1) - amount));
  rec.condition = next;
  await query(
    `UPDATE player_augments SET condition = $1 WHERE player_id = $2 AND augment_id = $3`,
    [next, owner.id, augmentId]
  ).catch(() => {});
}
