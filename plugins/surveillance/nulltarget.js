/**
 * Surveillance's contribution to Nullcraft — planted devices as attackable things.
 *
 * ── Why this file is the important one ───────────────────────────────────────
 *
 * `security_devices.status_flags` has held { jammed, spoofed, hijacked_by,
 * looping, blinded } since long before Nullcraft was designed, and
 * `getInterferenceZones()` already computed zone-level jamming with a cache, a
 * precedence rule and a relay counter-measure. The single biggest risk to this
 * whole system was that Nullcraft would grow a SECOND opinion about whether a
 * camera is jammed — one the wanted system, the feed renderer and the hub would
 * each disagree with.
 *
 * So nothing here invents a state. The split is by operation kind:
 *
 *   transient (jam/spoof/lock/crash)  the substrate's RAM timer is the truth, and
 *                                     `deviceStatus()` in index.js reads it. That
 *                                     is the ONE integration point, and because
 *                                     everything downstream — cameraLiveInZone,
 *                                     isWitnessed, feedSnapshot, the hub — already
 *                                     asks deviceStatus, they all inherit Null
 *                                     jamming without knowing it exists.
 *   persistent (hijack)               writes status_flags.hijacked_by, the exact
 *                                     column and key the existing camera-hijack
 *                                     breach already writes.
 *   durable (sabotage)                sets is_damaged, which every reader already
 *                                     understands as 'damaged'.
 *
 * ⚠ Do not add a jam column, a jam Set or a jam Map here. If you find yourself
 * wanting one, the thing you actually want is for `deviceStatus` to ask the
 * substrate, and it already does.
 *
 * ── Read tier ────────────────────────────────────────────────────────────────
 * One query per `nullscan` / `analyze` / `null`, all deliberate player actions.
 * Nothing here runs per-tick.
 */
import { query } from '../../server/models/db.js';
import { subsystemDown, carriedJamAt, veilFactor } from '../../server/engine/nullcraft.js';
// Re-exported so index.js has ONE import line for everything Nullcraft, and so
// the two files that read the substrate are obvious from the top of this one.
export { carriedJamAt, veilFactor };

// The Null target key namespace. Stable across a device's life, and distinct from
// every other contributor's — the substrate's Maps are keyed on this.
export const deviceKey = (id) => `device:${id}`;

// What each kind of planted hardware is made of. A camera has optics and a radio;
// a jammer has no sensors worth attacking. Exposure is the authored-ish part: a
// device's telemetry is always the softest thing on it, which is true of real
// hardware and is what makes the "attack the cooling, not the arm" decision of
// spec §8 exist at all.
const SUBSYSTEMS = {
  sticky_cam: [
    { id: 'optics',    kind: 'sensor',     exposure: 45 },
    { id: 'recording', kind: 'processing', exposure: 25 },
    { id: 'telemetry', kind: 'telemetry',  exposure: 65 },
    { id: 'network',   kind: 'network',    exposure: 50 },
    { id: 'power',     kind: 'power',      exposure: 30 },
  ],
  drone: [
    { id: 'optics',     kind: 'sensor',     exposure: 40 },
    { id: 'propulsion', kind: 'actuation',  exposure: 30 },
    { id: 'control',    kind: 'control',    exposure: 35 },
    { id: 'telemetry',  kind: 'telemetry',  exposure: 60 },
    { id: 'network',    kind: 'network',    exposure: 55 },
    { id: 'power',      kind: 'power',      exposure: 25 },
  ],
  motion_sensor: [
    { id: 'sensor',    kind: 'sensor',    exposure: 55 },
    { id: 'telemetry', kind: 'telemetry', exposure: 70 },
    { id: 'power',     kind: 'power',     exposure: 40 },
  ],
  audio_sensor: [
    { id: 'sensor',    kind: 'sensor',    exposure: 55 },
    { id: 'telemetry', kind: 'telemetry', exposure: 70 },
    { id: 'power',     kind: 'power',     exposure: 40 },
  ],
  relay: [
    { id: 'network',   kind: 'network',   exposure: 60 },
    { id: 'power',     kind: 'power',     exposure: 35 },
  ],
  jammer: [
    { id: 'emitter',   kind: 'actuation', exposure: 30 },
    { id: 'power',     kind: 'power',     exposure: 35 },
  ],
  spoofer: [
    { id: 'emitter',   kind: 'actuation', exposure: 30 },
    { id: 'network',   kind: 'network',   exposure: 50 },
    { id: 'power',     kind: 'power',     exposure: 35 },
  ],
};

// Security derives from tier and the device's own authored hack_difficulty. It is
// NOT a new authored column: the two numbers that already say "how good is this
// camera" are the two numbers used, so a dev-panel edit to tier moves both the
// breach and the Nullcraft difficulty together and they cannot drift.
function securityOf(dev) {
  const tier = Number(dev.tier) || 1;
  const hd = Number(dev.hack_difficulty) || 5;
  return {
    rating: Math.min(100, tier * 15 + hd * 4),
    // Planted surveillance is wireless by definition — a camera nobody can reach
    // is a camera reporting to nobody. The manual-override counterplay of spec
    // §21 belongs to bionics, whose owner is standing right there to pull a plug.
    wireless: true,
    auth: tier >= 4 ? 'military' : tier >= 2 ? 'encrypted' : 'basic',
  };
}

/**
 * The `tech.targets` contribution: every planted device in the player's room.
 *
 * Concealed devices are deliberately INCLUDED — finding hidden hardware by its
 * emissions rather than by looking for it is precisely what a signals discipline
 * is for, and it is the one thing Nullcraft should do that `search` cannot.
 */
export async function cameraTargets(player, ctx = {}) {
  const zoneId = ctx.zoneId || player.current_zone;
  if (!zoneId) return [];

  const { rows } = await query(
    `SELECT d.*, f.name AS fname
       FROM security_devices d
       JOIN furniture f ON f.id = d.id
      WHERE d.zone_id = $1`,
    [zoneId]
  ).catch(() => ({ rows: [] }));

  return rows.map(dev => {
    const key = deviceKey(dev.id);
    const notes = [];
    if (dev.is_damaged) notes.push('Already broken. Somebody got here first.');
    if (dev.status_flags?.hijacked_by) notes.push("Answering to somebody who doesn't own it.");

    return {
      key,
      ownerId: dev.owner_id || null,
      ownerName: null,          // a planted camera does not announce its owner
      zoneId: dev.zone_id,
      name: dev.fname || dev.device_kind,
      kind: dev.device_kind === 'drone' ? 'drone' : 'camera',
      subsystems: SUBSYSTEMS[dev.device_kind] || SUBSYSTEMS.relay,
      security: securityOf(dev),
      notes,

      async apply(opId, subsystem, { player: actor }) {
        // TRANSIENT: the substrate already recorded it, and deviceStatus reads
        // the substrate. Writing anything here would be the second copy.
        if (opId === 'jam' || opId === 'spoof' || opId === 'lock' || opId === 'crash') {
          return {
            message: `<span class="msg-system">The ${dev.fname} goes quiet — its ${subsystem.id} stops answering.</span>`,
            ownerMessage: `<span class="text-amber">⚠ SPECTER</span> ${dev.fname} lost its ${subsystem.id}.`,
          };
        }

        // PERSISTENT: the existing column, the existing key.
        if (opId === 'hijack') {
          await query(
            `UPDATE security_devices
                SET owner_id = $1, network_id = NULL,
                    status_flags = jsonb_set(COALESCE(status_flags, '{}'::jsonb), '{hijacked_by}', to_jsonb($1::text))
              WHERE id = $2`,
            [actor.id, dev.id]
          );
          return {
            message: `<span class="ip-gain">The ${dev.fname} answers to you now.</span>`,
            ownerMessage: `<span class="text-red">⚠ SPECTER</span> ${dev.fname} was HIJACKED — you no longer control it.`,
          };
        }

        // DURABLE: is_damaged is what every existing reader already calls broken.
        if (opId === 'sabotage') {
          await query(`UPDATE security_devices SET is_damaged = 1 WHERE id = $1`, [dev.id]);
          return {
            message: `<span class="text-red">Something inside the ${dev.fname} lets go. It isn't coming back on.</span>`,
            ownerMessage: `<span class="text-red">⚠ SPECTER</span> ${dev.fname} has failed.`,
          };
        }
        return null;
      },
    };
  });
}

/**
 * Is this device currently suppressed by a Null operation?
 *
 * Called from `deviceStatus()` in index.js — THE integration point. Kept here
 * rather than there so the mapping from subsystem to "the camera is effectively
 * jammed" lives beside the subsystem table it depends on.
 *
 * SYNC BY CONTRACT: deviceStatus is on the witness path.
 */
export function nullSuppressed(deviceId) {
  const key = deviceKey(deviceId);
  // Killing the power, the optics or the processing blinds a camera outright.
  // Killing its radio or telemetry means it still sees but nobody hears it —
  // which for every consumer of this function is the same outcome.
  for (const sub of ['power', 'optics', 'recording', 'sensor', 'network', 'telemetry', 'control']) {
    const op = subsystemDown(key, sub);
    if (op) return op === 'spoof' ? 'spoofed' : 'jammed';
  }
  return null;
}
