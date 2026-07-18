# augments

**Purpose** — installable cybernetics: the machine-path (Ascendant) mirror of the
flesh-path (Wildblood) mutation system. Where mutations are radiation-random,
permanent, and free, augments are **chosen, paid, slot-limited, and removable**.
Installing chrome applies its `stat_modifiers` (the same additive path as
`grantMutation`), nudges the player down the **Machine** path, and costs standing
with the two human-path orders (the Long Watch, the Wildblood) — the deliberate
teeth that make flesh-vs-machine a real choice. Install/remove is **clinic work**,
gated to a zone flagged `flags.augment_clinic`; listing your own chrome works
anywhere.

This is **step 1** of the Ascendant Stronghold proposal
([docs/proposals/ascendant-stronghold.md](../../docs/proposals/ascendant-stronghold.md)):
the mechanic, catalog, and verbs. The combat/death engine seams — subdermal `soak`
via `recomputeArmor`, the "chrome can't mutate" guard in `checkMutationTrigger`,
and the cortical-backup respawn on `player.respawnZone` — are **step 2** (an
`engine-change`). Catalog rows whose only effect is `soak`/`special` are authored
but inert until then, and install says so.

## Commands

- `augment` / `augments` — list installed chrome + per-slot usage (anywhere).
- `augment install <name>` — install (at a clinic; checks slot cap, rep gate, cost).
- `augment remove <name>` — uninstall (at a clinic; reverses stat + path effects).

## Registered actions

None. Install/remove **dispatch** the ideology-owned Actions `ADJUST_PATH` and
`ADJUST_REPUTATION` (never touching ideology state directly — the interaction rule).

## Events emitted

None.

## Events consumed

None.

## Tick usage

None.

## Dependencies

`ideologies` — provides `getPlayerIdeologyRep` / `REP_TIERS` (rep gate) and the
`ADJUST_PATH` / `ADJUST_REPUTATION` Actions dispatched on install.

## Config

None.

## Data schema

- **`augments`** (content, boot-cached) — the catalog: `id, name, description,
  slot, tier, cost, rep_gate, stat_modifiers, soak, visible, special`.
- **`player_augments`** (per-player) — installed chrome:
  `player_id, augment_id, slot, installed_at`.

Slot capacity per region is enforced in code (`SLOT_CAPS`):
neural 2 · eyes 1 · torso 2 · arms 1 · legs 1.

## Extension points

None yet. Step 2 wires `soak`/`special` into the combat and death seams.
