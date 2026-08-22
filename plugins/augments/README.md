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
- `augment overclock <name> [level]` — past spec, at your own risk. At
  `overclock_max` a fault can genuinely kill you; below it, it cannot.
- `augment charge` — top the cell up anywhere on mains power.
- `calibrate <name>` — the tuning board. Consumes a `calibration_rig`, or uses a clinic bench.
- `calibrateresolve` — the board reporting in (client-issued, never typed).
- `backup` — **re-scan your pattern** at the Vats Registry, ₵900. Registers the
  pattern and buys back `copy_fidelity`. Touches no inventory, deliberately.
- `assurance [buy n]` — prepaid restores at the Halcyon front.

## Registered actions

None. Install/remove **dispatch** the ideology-owned Actions `ADJUST_PATH` and
`ADJUST_REPUTATION` rather than touching ideology state directly.

## Events

Consumes `player.login` (hydrate the roster, `chromed_ever` and `copy_fidelity`),
`zone.entered` (the campus tops your cell up) and `player.death` — ONE subscriber
owning `capture → corrupt → re-print` in that order, because `emit` is
fire-and-forget and will not order three of them. Corruption is skipped only on
`custody` (jail), **not** on `claimed`: a cortical restore wants its old chrome
destroyed, so the vats can print new hardware honestly.

Emits **`augment.installed`** `{actor, augment_id, slot, quality, condition, calibration}` on a
successful fitting, after the `player_augments` row, the roster, the machine-path nudge and the
opposed-order rep hit have all landed — so a subscriber sees a body that is already fitted rather
than one mid-cut. Nothing in this plugin consumes it. It exists because a fitting was the one thing
chrome could do that the world never heard about: this plugin emitted **nothing at all**, so no
quest could ask a player to get chromed and no observer could react to it. `plugins/quests` is the
first reader (the `install` objective type, which is the Ascendant bridge).

## Hooks

`player.respawnZone` — the cortical restore CLAIM. It yields whenever the player
is wanted (jail takes the death first) and, ⚠ deliberately, **spends and writes
nothing** — the decrement lives in `reprint.js`, after the engine has picked a
winning override. `player.appearanceNotes` — print artifacts.
`tech.targets` — Null targeting.

## Tick usage

One `1m` **flush**, not a tick — no simulation runs in it. It writes the condition
that heat burned on the combat path, for the players who actually burned any.
Deliberate acts write through immediately and never wait for it.

## Five things not to "fix"

1. **Heat is never persisted. CHARGE IS.** Heat is memory-only, decayed lazily
   off a timestamp, and cooling off on logout is correct for a minutes-scale
   phenomenon; its durable residue is `condition`, so do not add a column for it.
   ⚠ Do not carry that rule across to power. They err in opposite directions —
   logout cooling your heat is harmless, logout *recharging* you would solve the
   whole logistics problem with alt-F4. Charge lives in
   `player_augments.custom_data`, decayed the same lazy way but written down.
2. **Zero condition does not destroy an installed augment.** It goes *dead* and
   waits for a surgeon. `durability.js` rule 4 destroys an item at zero; a thing
   disintegrating inside a torso is neither narratable nor actionable.
3. **Calibration 100 reproduces the authored value exactly**, and so does
   `augScale(rec, 100)`. That is the migration invariant that made the move off
   baked `players.stat_*` net-zero for every live character. Regress asserts it
   four ways.
4. **The re-print captures the roster at DEATH, not at `backup`.** That is the
   whole reason it cannot mint. Snapshot it at scan time and you re-open the hole
   the inventory rollback was deleted for — printing an augment the player
   already removed to an item and sold. See §8a of the doc.
5. **Fidelity caps calibration on READ and is never written to the row.** A
   re-scan must instantly restore tuning the player already paid for. Bake it and
   the re-scan stops being a product and becomes a repair bill.

And one that will look like a bug the first time somebody plays it: **subdermal
soak now scales with condition and calibration.** A battered uncalibrated weave
genuinely stops less than a fresh tuned one. That is the system working.

## Data schema

- **`augments`** (content, boot-cached) — the catalog. Authored columns only.
- **`player_augments`** (per-player, RAM-authoritative after login) — runtime columns only.
- **`player_backups`** (per-player, runtime) — the pattern on file. `pattern_at`
  is the restore gate (a policy bought with no scan taken restores nothing) and
  `copy_fidelity` is how good a copy you still are. `snapshot` survives holding
  scan metadata for flavour; it no longer carries inventory or credits.

The split is the design: no `excludeColumns` needed on either, and `content:lint`
has nothing to trip on. See [docs/systems-augments.md §3](../../docs/systems-augments.md).

`SLOT_CAPS` (in `state.js`): neural 2 · eyes 1 · torso 2 · arms 1 · legs 1.

## Extension points

- `registerStatContributor(fn, owner)` — `server/engine/condition.js`. Derived
  stat contribution; the seam that replaced baked `UPDATE players SET stat_x`.
- `registerStrainContributor(fn, owner)` — `server/engine/strain.js`. Anything
  that wants to notice a body being worked, synchronously, on the combat path.
- `registerArmorContributor(fn)` — `server/engine/commands/inventory.js`.
