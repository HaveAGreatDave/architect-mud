# cosmetic-machine

**Purpose** — the MORPHEX 9000 BioSculpt terminal: the body-customization panel. Also the machine chargen walks you through in the prologue.

## Commands
- `morphex` / `makeover` / `biosculpt` — three names for one handler.
- `morphex closed`: the client's silent report that a chargen panel was dismissed by its ✕ or backdrop. Returns nothing.

## Events
- Emits `cosmetic.opened` on every open, `cosmetic.closed` on that report, and `appearance.changed` on every change. The prologue opens its first door on `cosmetic.opened`, so a new player never has to change anything to leave The Inbetween.

## Specialized actions
- `use` — the engine furniture router opens the panel via the `cosmetic.open` Action.

## Discovery
All three verbs are **panel-reached**: the tag-gated `use` action surfaces on examine and opens the panel. The furniture must carry `flags.cosmetic_machine` for the `use` hint to appear at all.
