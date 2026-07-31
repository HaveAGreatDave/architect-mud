# appliances

**Purpose** — the generic "is it actually plugged in?" gate for powered furniture. Anything carrying `power_draw_kw` can be unplugged, and an unplugged appliance describes itself as **broken** rather than as unplugged — which is the joke: the vending machine is not dead, someone pulled the cord.

## Commands
- `unplug <name>` — pull the plug on a powered piece of furniture in the room.

The inverse verb, `plug`, is **not owned here**. It arrives through the generator plugin's fallback to `togglePluggedByName()`, because that plugin already owns `plug`/`connect` for running a generator into a junction box.

## Hooks
- `furniture.describe` — the shared "looks broken" line on anything currently unplugged.

## The absent-flag default
No `flags.plugged_in` at all means **plugged in**. Every appliance authored before this plugin existed keeps working untouched; only an explicit unplug writes the flag.

## Consumed by
**vending** and **preservation** — both check this gate before doing their work.
