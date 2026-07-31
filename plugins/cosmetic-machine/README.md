# cosmetic-machine

**Purpose** — the MORPHEX 9000 BioSculpt terminal: the body-customization panel. Also the machine chargen walks you through in the prologue.

## Commands
- `morphex` / `makeover` / `biosculpt` — three names for one handler.

## Specialized actions
- `use` — the engine furniture router opens the panel via the `cosmetic.open` Action.

## Discovery
All three verbs are **panel-reached**: the tag-gated `use` action surfaces on examine and opens the panel. The furniture must carry `flags.cosmetic_machine` for the `use` hint to appear at all.
