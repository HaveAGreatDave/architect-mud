# Payloads and firmware

> **Status: design only.** Nothing here is built. Firmware (§5) is Ascendant work
> and fits the current priority. Payloads (§4) are Null work and wait for the Null's
> turn in [goals.md](../goals.md). Machine enemies as targets (§3) can go in at any
> time.

Planned 2026-10-04.

## Where this came from

Another project's pitch: spells are JSON instructions, sent as mana packets to
wherever the effect lands, written in one spell language the engine runs.
Architect has no magic. The Basin does run on the Architect's infrastructure,
though, and the Null's reading of Coldwater
([story.md](../story.md#the-nulls-answer)) is that it's a screen. Instructions
addressed to a machine, which the machine then executes, fit that with no magic
involved.

Most of it already exists. [Nullcraft](../systems-nullcraft.md) is a small
instruction language: seven operations, eight subsystem kinds, and one target
interface (`tech.targets`, where the owning plugin's `apply()` does the
mutation). An undeclared key fails the build. `null lock drone actuation` is a
one-instruction program. This plan adds two things on top of it:

- **Payloads.** Several Nullcraft operations written ahead of time onto a chip
  and sent at a machine in one action.
- **Firmware.** A short routine an Ascendant writes for their own chrome, which
  the server runs during a fight.

Both use the same vocabulary. The Null write into your machine, the Ascendant
writes into their own, and the Null can attack what the Ascendant wrote.

## 1. Rules

### Fixed vocabulary, open combinations

Players combine existing operations and conditions. They never define new ones.
The applicability table in [Nullcraft §3](../systems-nullcraft.md#3-the-vocabulary)
stays the authority on what can be done to what: a payload that asks to jam an
actuator is refused when it's written, the same as `null jam` refuses it now.

In a full-loot PvP game, fully open combination ends with everyone carrying the
one best combo a week after launch. Size is the brake. Every step adds trace,
write time and travel time, so a longer payload does more and is easier to catch.

### Written outside a fight, sent during one

Nobody writes JSON in a real-time fight. Writing happens at a Null device, out of
combat, and is refused in combat. During a fight the player types one verb.
Writing is a typeable verb as well. If a client editor is ever built, it's a skin
over those verbs, as the [prep workspace](preparation-workspace.md) is over
cooking.

### Machines only

A payload needs something to receive it: chrome, cameras, surveillance drones,
aircraft, and machine enemies once §3 makes them targets. An unaugmented body has
nothing for it to land on. That's the Null's discipline as written ("make the
machine go silent"), and it stops payloads turning into general-purpose damage.

### No second copy of state

Nullcraft's first rule holds. A payload resolves each step through the existing
`operationCheck` and the target's own `apply()`. Transient effects stay in the
substrate's RAM Maps, and durable ones go through the contributor's own writer.
Neither half owns a table. A payload lives on an item's `custom_data` (the
drinks pattern, [systems-drinks.md](../systems-drinks.md)), and firmware lives on
`player_augments.custom_data`, where `radio_off` already sits.

### The server runs it

The client sends a payload as text when it's written. The server parses it,
checks every key against the registries, applies the limits in §2 and stores the
result. Sending names a chip the player carries; the client never sends a program
to execute. Anything that runs inside the combat tick follows the swing-seam
contract in
[combat.md](../combat.md#the-swing-seam--registerswingcontributor): sync, no
await, no query, no send.

### Words

Players never see "spell", "mana" or "packet" used as magic. It's a payload, a
routine, firmware or a chip. Architect-built machines answer formally and without
contractions, as the house voice already has them: "Instruction accepted. Thank
you for your contribution."

## 2. The payload format

Written with `null write` and stored on a payload chip's `custom_data.payload`:

```json
{
  "v": 1,
  "name": "quiet hands",
  "steps": [
    { "op": "jam",  "sub": "sensor" },
    { "op": "lock", "sub": "actuation", "if": { "down": "sensor" } }
  ]
}
```

| Field | Rule |
|---|---|
| `steps` | 1 to `1 + floor(nullcraft / 3)`, capped at 4. Run in order, once each. No loops and no jumps. |
| `op` | A registered Nullcraft operation the writer meets the `minSkill` for. |
| `sub` | A registered subsystem kind that `op` applies to. At send time the step picks the target's most exposed subsystem of that kind. |
| `if` | Optional, from a closed list: `down` (an earlier step suppressed that kind on this target), `kind` (target kind: `augment`, `camera`, `drone`, `machine`) and `overclocked` (the target runs past spec). |

A payload's size is the sum of its steps' `traceCost`. Size sets write time,
travel time and the trace the sender takes.

When it lands, each step makes one `operationCheck`, in order. The first failed
check stops the payload and fires the failure reaction Nullcraft already has: a
trace jump, the owner told, and a burned deck on a hard failure against defended
hardware. A step whose `if` doesn't hold is skipped without a roll.

## 3. Machine enemies as targets

`tech.targets` has contributors for chrome installed in players (augments) and
for cameras and surveillance drones (surveillance). Machine enemies have none.
The maintenance drone, the Rusted Sweeper, the Architect Scout Drone and the
SPECTER-PD Patrol Drone fight with ordinary body parts, and nothing marks them as
machines, so `null` can't touch them.

- **`flags.machine`** on enemy content, opted into the way `flags.vermin` is
  ([combat.md](../combat.md#type-effectiveness--what-the-target-is-not-what-it-is-wearing)).
  The value is a subsystem list, or `true` for a default set (power, control,
  actuation, sensor, network). It needs a row in
  [flags-keys.md](../flags-keys.md).
- **A contributor** that lists machine enemies in the zone. No plugin owns
  enemies, so it lives in `plugins/nullcraft/`; the substrate still learns
  nothing about them. Transient operations need no writer because the substrate
  already holds them. Durable ones spend enemy HP through the existing damage
  path.
- **A swing contributor** that reads `subsystemDown()` (RAM, sync) during the
  fight. A suppressed `sensor` is a large to-hit penalty on the enemy's swings.
  A locked `actuation` negates its swing, with a `negateLine`. A crashed
  `control` skips its next attack in the tick.

This works without payloads: the existing `null` verb starts doing something in
combat against drones. `hijack` against an enemy, so it fights on your side,
waits for a separate decision.

## 4. Payloads (the Null's turn)

### Verbs

All four are subcommands of `null`, so they inherit the `initiatesOnly` wrapper
and add no top-level verb (`run` belongs to gps). The operation registry must
refuse an op id that matches a subcommand name.

| Verb | Does |
|---|---|
| `null write <chip> <steps>` | Writes a payload onto a blank chip. Needs a carried `null_device`, is refused in combat, and takes time by size. |
| `null read <chip>` | Shows what's on a chip. Works on anyone's chip, so a looted payload can be read before it's used. |
| `null send <chip> <target>` | Sends it by radio. |
| `null plug <chip> <target>` | Delivers it by contact (Phase 4). |

Steps use the grammar players already know:
`null write chip jam sensor, lock actuation if sensor down`. The JSON is how it's
stored. Players never type braces.

### The chip is an item

A payload chip is content, an item row, with the payload in its `custom_data`. It
gets what every item already has: it drops on death and can be looted, sold,
traded and stolen. Whoever kills a Null can read their chips and use them. A chip
isn't used up when it's sent.

### Delivery

- **Radio.** The sender and target share a zone. Travel time is a second or two
  per step of size. A jam field in the zone (planted or carried, from
  `getInterferenceZones()`) stops it, including the sender's own jammer unless
  that jammer is selective. A target with no `network` route, such as an augment
  with `radio_off`, can't receive it by radio.
- **Contact.** Costs the sender's next swing and needs the target in melee with
  them, or downed. It gets past jamming and `radio_off`, so it's how a Null
  reaches chrome that's been hardened, at knife range.

The owner is told at 60% trace, as now. With firmware (§5), the owner's chrome
can also react during the travel time.

## 5. Firmware (the Ascendants' turn)

An Ascendant writes a short routine for one installed augment, and the server runs
it in combat at tick speed. It's stored on `player_augments.custom_data.firmware`:

```json
{
  "v": 1,
  "rules": [
    { "when": { "hp_below": 30 }, "do": "overclock", "level": 0 },
    { "when": { "handshake": true }, "do": "radio_off", "for_s": 30 }
  ]
}
```

| Field | Rule |
|---|---|
| `rules` | A small cap set by skill (see open questions). Each rule fires at most once per fight. |
| `when` | Closed list: `hp_below`, `heat_above` (a strain band), `part_wounded`, `handshake` (a Nullcraft operation or payload touched this augment) and `target_kind`. |
| `do` | Closed list. Each entry is the effect of something the player can already type: `overclock` (set a level within `overclock_max`) and `radio_off` (for a number of seconds). The list grows only when a matching manual verb exists. |

- **Firmware only makes the player faster at something they could already do.**
  That's what keeps it from becoming a second set of powers.
- **It runs sync, in RAM.** It hooks the swing seam's `post` phase and the strain
  contributor in [server/engine/strain.js](../../server/engine/strain.js). A
  change to `overclock_level` is normally written by a deliberate act
  ([systems-augments.md §4](../systems-augments.md#4-persistence--two-paths-on-purpose));
  firmware sets the RAM copy and marks it for the coalesced flush, and never
  awaits a write in the tick.
- **It costs heat.** Each firing adds strain.
- **It can be attacked.** Firmware runs on the augment's `processing` subsystem
  where it has one (neural, eyes) and on `control` where it doesn't (arms, legs,
  torso). `crash` reaches both and stops the firmware while it lasts. `spoof` on
  `sensor` or `telemetry` feeds it false readings, so an `hp_below 30` rule fires
  at full health. Both verbs exist today, so firmware is playable before
  payloads are built.

Client automation already has `on` triggers that react to vitals
([systems-automation.md](../systems-automation.md)). Firmware differs in three
ways: it runs on the server with no round trip, it costs heat, and it can be
attacked. If playtesting shows it's the same thing with less latency, cut it.

### A gap this plan found

[Nullcraft §7](../systems-nullcraft.md#7-counterplay-built) lists `radio_off` as
built counterplay, but no verb sets it. Only `plugins/augments/nulltarget.js`
reads it. Phase 1 adds `augment radio <name> off|on` as the manual verb, which
the `radio_off` firmware action then copies.

## 6. Phases

| Phase | What | When |
|---|---|---|
| 1 | `augment radio`, then firmware (§5). | Ascendant work, so it fits the current priority. |
| 2 | Machine enemies as targets (§3). | Small. Any time. |
| 3 | The payload format, the chip item, and `null write`, `null read` and `null send` (§2, §4). | The Null's turn. |
| 4 | Contact delivery (`null plug`) and firmware `handshake` rules reacting to payloads. | After phase 3. |
| Later | Payloads against the Architect ladder in [Nullcraft §11](../systems-nullcraft.md#11-architect-infrastructure--design-only). | Out of scope until a separate decision. |

## 7. Regress, per phase

Each phase adds its cases to the owning plugin's `regress.js`.

- **Phase 1.** An unknown `when` or `do` key is refused at write. An `overclock`
  action can't go past `overclock_max`. A firing in the tick awaits nothing. A
  crashed `processing` or `control` subsystem stops the firmware. Spoofed
  telemetry fires an `hp_below` rule. `augment radio <name> off` makes the augment
  unreachable through `network`.
- **Phase 2.** An enemy with `flags.machine` appears in `gatherTechTargets()`, and
  one without it doesn't. Locked actuation negates the enemy's swing and prints
  its `negateLine`. `unknownOperationKeys()` stays empty.
- **Phase 3.** A step whose op doesn't apply to its sub is refused at write. The
  step cap follows skill. A payload stops at its first failed check. A jam field
  in the zone stops radio delivery, and `radio_off` blocks it. A non-initiate gets
  `Unknown command.` for every subcommand. An op id can't be registered under a
  subcommand's name. A looted chip works for its new holder.

## 8. Open questions

- **Does a target learn a payload?** A signature that gets harder to land after a
  target survives it once would stop one chip being sent forever. It would be
  state somewhere; RAM that decays at read is the Nullcraft habit.
- **Can an Ascendant capture a failed payload onto their own chip?** It's
  counterplay and loot at once, and a second way chips enter the world.
- **Who sells blank chips?** And whether only Null vendors stock them.
- **Which skill caps firmware rules?** No skill covers writing for chrome.
  `electronics` is the nearest.
- **Is a firmware overclock change a deliberate act?** If it is, the persistence
  rule in augments §4 says it writes at once, which the tick can't do.

## 9. Files (planned)

| Piece | Where |
|---|---|
| Payload parsing, limits and resolution | `plugins/nullcraft/payload.js` |
| `null write`, `null read`, `null send`, `null plug` | [plugins/nullcraft/index.js](../../plugins/nullcraft/index.js) |
| Machine enemy contributor and its swing contributor | `plugins/nullcraft/enemytarget.js` |
| Firmware parsing, rules and the tick runner | `plugins/augments/firmware.js` |
| `augment radio` | [plugins/augments/index.js](../../plugins/augments/index.js) |
| The payload chip | `content/items/` |
| `flags.machine` on the four machine enemies | `content/enemies/` |
