# nullcraft

**Purpose** — the Null's answer to chrome. Where the Ascendants buy a better machine, the Null make
somebody else's machine stop working: detect what is powered in the room, read its attack surfaces,
then jam a sensor, lock an actuator or crash a controller. The full as-built account is
[docs/systems-nullcraft.md](../../docs/systems-nullcraft.md); this file is the signpost and the
seams. The substrate is [server/engine/nullcraft.js](../../server/engine/nullcraft.js) and this
plugin is the verbs.

## The rule that shapes all of it

**It never invents a second copy of state that already exists.** A surprising amount of this was
already shipping, camera-scoped and scattered: `security_devices.status_flags` has held
`{ jammed, spoofed, hijacked_by, looping, blinded }` since forever, `getInterferenceZones` already
jammed zones, `isWitnessed` already read it. So this is a **promotion** of that model onto bionics,
drones and locks, not a new one. Every operation writes state the target's OWNER already keeps.

## Three decisions that carry it

**Trace is RAM-authoritative and decays at read, never on a tick.** The engine file owns no table, a
logout drops everything, and only durable damage persists — through the contributor's own writer.

**Targets arrive by gather hook.** `tech.targets` (the `workspace.provider` seam) is fired by the
substrate, and `apply()` lives on the target. That is what keeps the substrate free of imports from
augments and surveillance: the integration is ONE line in `deviceStatus()` and ONE filter in
`getAugments()`, so every downstream reader inherits Null jamming without knowing it exists.

**Security is derived, never authored twice.** `overclock_max` does double duty — it is already the
whole mechanical statement of the licensed-vs-back-alley split, which makes licensed chrome the hard
target with nothing new authored.

## Traps

⚠ **Read the applicability table before adding an operation.** You cannot jam a hydraulic ram.
Collapsing that distinction turns six operations into one verb with six skins.

⚠ **Telemetry is not vital.** Breaking a thing's ability to *report* is not breaking the thing.

⚠ **`VEIL_CAP` is a hard ceiling** — ghosting must never make a player unarrestable. (Its sibling in
psionics is `PSI_CAP`.)

Architect's network ladder is **design only**.
