# cosmetic-machine

**Purpose** — the MORPHEX 9000 BioSculpt terminal: the body-customization panel. Also the machine chargen walks you through in the prologue.

## Commands
- `morphex` / `makeover` / `biosculpt` — three names for one handler.
- `morphex face <part> <value>`, `morphex tattoo <place> <design|none>` and `morphex ink <colour>` change the face, the tattoos and their ink, kept in `appearance_data` (`face`, `tattoos`, `ink`). The values, and the hair styles, are `client/shared/morphex-catalog.js`, which the pod and the figure read too.
- `morphex closed`: the client's silent report that a chargen panel was dismissed by its ✕ or backdrop. Returns nothing.

## Events
- Emits `cosmetic.opened` on every open, `cosmetic.closed` on that report, and `appearance.changed` on every change. The prologue opens its first door on `cosmetic.opened`, so a new player never has to change anything to leave The Inbetween.

## Specialized actions
- `use` — the engine furniture router opens the panel via the `cosmetic.open` Action.

## Discovery
All three verbs are **panel-reached**: the tag-gated `use` action surfaces on examine and opens the panel. The furniture must carry `flags.cosmetic_machine` for the `use` hint to appear at all.

## The pod
The ground floor of the clone facility has the MORPHEX as a pod you step into on the Room Stage (`look.pod` on its row, `client/game/js/panels/room-morphex.js`). Its menu sends the same verbs. `client/shared/player-figure.js` turns a player's appearance into the close-up figure's keys, so what you buy shows on your body to everyone in the room.
