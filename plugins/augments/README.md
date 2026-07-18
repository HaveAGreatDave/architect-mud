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

This is the full Ascendant Stronghold augment system
([docs/proposals/ascendant-stronghold.md](../../docs/proposals/ascendant-stronghold.md)).
All three combat/death engine seams are now wired:
- **Soak** — a `registerArmorContributor` (in `recomputeArmor`) layers each
  installed augment's per-slot `soak` into `player.soak` (subdermal weave = armor
  under the skin), and sets `player.chromed`.
- **Chrome can't mutate** — `checkMutationTrigger` bails on `player.chromed`; the
  FIRST install calls the engine's `burnAllMutations()` (the flesh→machine
  conversion). `player.chromed` is derived (armor contributor + a `player.login`
  handler), never a stored column.
- **Cortical-backup death loop** — a `player.respawnZone` hook rolls a non-jailed
  death back to the last Vats snapshot (jail wins when wanted).

## Commands

- `augment` / `augments` — list installed chrome + per-slot usage (anywhere).
- `augment install <name>` — install (at a clinic; checks slot cap, rep gate, cost;
  first install burns off any mutations).
- `augment remove <name>` — uninstall (at a clinic; reverses stat + path effects).
- `backup` — snapshot inventory+credits at the Vats Registry (`ascendant_registry`);
  requires the Cortical Backup augment.
- `assurance [buy <n>]` — buy prepaid restores at a `assurance_policy` desk (the
  secret Halcyon front); eligibility-gated on owning Cortical Backup. (Named
  `assurance`, not `policy` — the insurance plugin owns `policy` for aircraft.)

## Registered actions

None. Install/remove **dispatch** the ideology-owned Actions `ADJUST_PATH` and
`ADJUST_REPUTATION` (never touching ideology state directly — the interaction rule).

## Events emitted

None.

## Events consumed

`player.login` — derives `player.chromed` at connect (belt-and-braces alongside
the armor contributor) for the mutation-block guard.

## Hooks

`player.respawnZone` — the cortical-backup respawn. Yields (returns `undefined`)
whenever the player is wanted, so jail's own hook claims the death first.

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
- **`player_backups`** (per-player, runtime) — the cortical-backup loop:
  `player_id, snapshot (jsonb: credits+inventory), restores_remaining, saved_at`.

Slot capacity per region is enforced in code (`SLOT_CAPS`):
neural 2 · eyes 1 · torso 2 · arms 1 · legs 1. (The neural cap of 2 forces a real
choice at the top: the Dermal Jack plus **one** of Neural Co-processor / Cortical
Backup.)

## Extension points

`registerArmorContributor(fn)` (from `server/engine/commands/inventory.js`) — any
system can layer non-armor soak into `player.soak` the same way augments do.
