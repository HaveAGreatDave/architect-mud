# synthesis

**Purpose** — drug synthesis. Cook reagents into potency-scaled drugs through a **Chemistry** skill check plus a "stabilize the reaction" minigame.

## Commands
- `synthesize` — the unambiguous drug-cooking verb.
- `splice` / `splicepreview` / `splicebegin` / `spliceresolve` — master tier.
- `synthresolve` — the minigame callback.
- `unseal` · `reclaim` — vault access.
- `cooktest` / `splicetest` — dev aids.

## No portable kit
Raw → processed cooks require a **real chem lab**. Station quality adds a bonus. This is deliberate: the lab is the chokepoint the whole drug economy hangs off.

## The lab is also the vault
A successful lab cook or splice **deposits its product into the chem lab's shared storage vault** — the lab furniture doubles as a container. You do not walk out holding it.

## Hooks
- `furniture.describe` — the chem-lab hub, which is also where `splice` is surfaced as an action-link, **only once your Chemistry is high enough to splice**.

## `cook` vs `synthesize`
`cook` is owned by **plugins/cooking** and routes here via the `synthesis.cook` Action when the room or the argument points at a chem lab. `synthesize` is the escape hatch that always means drugs. The furniture hub surfaces `cook` only.
