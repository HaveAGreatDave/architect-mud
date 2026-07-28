# cannabis

**Purpose** — the *behavioural* layer of being stoned, as distinct from the pharmacology. Being high is a global audio echo, the munchies, the giggles, and bloodshot red eyes other players can see when they examine you. The drug itself is content; this is what it does to you socially.

Driven entirely off the drug row's `flags.cannabis` — nothing here is hardcoded to a particular item.

## Hooks
- `player.appearanceNotes` — the red eyes on examine.

## Events consumed
- `player.drugUsed` — start or refresh the state.
- `player.death`, `player.logout` — clear it.

## Commands
None.
