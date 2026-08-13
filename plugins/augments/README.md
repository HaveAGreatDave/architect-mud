# augments

**Purpose** — chrome as a machine you own, not a stat you bought. The machine-path
(Ascendant) mirror of the flesh-path (Wildblood) mutation system: where mutations
are radiation-random, permanent and free, augments are **chosen, paid,
slot-limited, removable — and maintained**. They have a condition, a calibration,
a temperature and a limit you can decide to exceed.

Full as-built: **[docs/systems-augments.md](../../docs/systems-augments.md)**.
Origin: [docs/proposals/ascendant-stronghold.md](../../docs/proposals/ascendant-stronghold.md).

## Files

| File | Holds |
|---|---|
| `index.js` | routing + the four seam registrations + the 1m flush. Nothing else. |
| `state.js` | catalog, hydrated roster, every derived number. **THE ONLY WRITER OF `player_augments`.** |
| `install.js` | item → body and back: surgery, risk bands, repair, salvage. |
| `surgeon.js` | who holds the scalpel, what they charge, how likely they are to botch it. |
| `tuning.js` | calibration and the board that sets it. |
| `overclock.js` | heat, strain, running past spec, and coming apart. |
| `death.js` | why nobody farms chrome off corpses. |
| `backup.js` | the Ascendant cortical-backup loop. |
| `nulltarget.js` | Null-operation targeting of installed chrome. |

## Commands

- `augment` / `augments` — your chrome: condition, calibration, heat, slot usage.
- `augment quote <name>` — every surgeon in the room, their stars, complication rate and fee, **before** you commit.
- `augment install <name> [with <surgeon>]` — surgery. Consumes the hardware item; charged before the roll.
- `augment remove <name>` — pulled at a clinic; rolls too, so remove→reinstall is not a free re-roll.
- `augment repair <name>` — restores **condition only**. Calibration is untouched by design.
- `augment overclock <name> [level]` — past spec, at your own risk.
- `calibrate <name>` — the tuning board. Consumes a `calibration_rig`, or uses a clinic bench.
- `calibrateresolve` — the board reporting in (client-issued, never typed).
- `backup` — snapshot at the Vats Registry. Now includes the augment roster.
- `assurance [buy n]` — prepaid restores at the Halcyon front.

## Registered actions

None. Install/remove **dispatch** the ideology-owned Actions `ADJUST_PATH` and
`ADJUST_REPUTATION` rather than touching ideology state directly.

## Events

Consumes `player.login` (hydrate the roster + the `chromed_ever` flag) and
`player.death` (corruption — skipped when the death was `claimed`).

## Hooks

`player.respawnZone` — the cortical-backup restore. Yields whenever the player is
wanted, so jail claims the death first. `tech.targets` — Null targeting.

## Tick usage

One `1m` **flush**, not a tick — no simulation runs in it. It writes the condition
that heat burned on the combat path, for the players who actually burned any.
Deliberate acts write through immediately and never wait for it.

## Three things not to "fix"

1. **Heat is never persisted.** It is memory-only, decayed lazily off a
   timestamp, and cooling off on logout is correct for a minutes-scale
   phenomenon. Its durable residue is `condition`. Do not add a column.
2. **Zero condition does not destroy an installed augment.** It goes *dead* and
   waits for a surgeon. `durability.js` rule 4 destroys an item at zero; a thing
   disintegrating inside a torso is neither narratable nor actionable.
3. **Calibration 100 reproduces the authored value exactly.** That is the
   migration invariant that made the move off baked `players.stat_*` net-zero for
   every live character. Regress asserts it three ways.

And one that will look like a bug the first time somebody plays it: **subdermal
soak now scales with condition and calibration.** A battered uncalibrated weave
genuinely stops less than a fresh tuned one. That is the system working.

## Data schema

- **`augments`** (content, boot-cached) — the catalog. Authored columns only.
- **`player_augments`** (per-player, RAM-authoritative after login) — runtime columns only.
- **`player_backups`** (per-player, runtime) — cortical snapshots + prepaid restores.

The split is the design: no `excludeColumns` needed on either, and `content:lint`
has nothing to trip on. See [docs/systems-augments.md §3](../../docs/systems-augments.md).

`SLOT_CAPS` (in `state.js`): neural 2 · eyes 1 · torso 2 · arms 1 · legs 1.

## Extension points

- `registerStatContributor(fn, owner)` — `server/engine/condition.js`. Derived
  stat contribution; the seam that replaced baked `UPDATE players SET stat_x`.
- `registerStrainContributor(fn, owner)` — `server/engine/strain.js`. Anything
  that wants to notice a body being worked, synchronously, on the combat path.
- `registerArmorContributor(fn)` — `server/engine/commands/inventory.js`.
