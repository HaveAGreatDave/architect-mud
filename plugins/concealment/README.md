# concealment

Furniture that hides other furniture behind a passcode — a turntable and a fake wall.

## The model

Two furniture rows in one zone:

| Row | Flags | What the room sees |
|---|---|---|
| the **disguise** | `conceal_hides` = hidden row's id, `conceal_code` = factory code, `conceal_brand` (optional) | an ordinary (expensive) cabinet |
| the **hidden** piece | `concealed: true` | nothing at all |

`flags.concealed` is not new — it's the engine's own room-description filter in
`server/engine/commands/describe.js`, the same one a planted spy camera uses. So the hidden piece
drops out of the room prose, out of the `Furniture:` links and out of the mobile smart bar with no
new seam, and the plugin's whole job is flipping that one flag.

State is written through `world.js`'s `updateFurniture` funnel, so the cache and the DB agree and a
lab you left open is still open after a restart. It is **not** open after a content deploy: git is
the source of truth for `content/furniture/*.json`, and the import upserts, so a push re-asserts the
authored `concealed: true`. A cabinet resealing itself on deploy day is the correct trade — the
alternative is runtime state in the content tree.

## Verbs

- `keypad [name]` — opens the private client keypad overlay (`client/game/js/panels/keypad.js`).
- `keypad [name] <code>` — the text path, for a player without the overlay. Right code toggles.
- `concealcode` / `concealsetcode` — client transport only; the overlay submits them with
  `sendCmdSilent` so **the digits never reach the message log**.

## What's private and what isn't

The code is the secret. **The reveal is public** — everyone in the room watches the cabinet pivot
and the hidden piece roll out, by design. A witness learns what you are; they still can't open it.
A wrong code is deliberately mute: it doesn't tell the room, and it doesn't hint that the cabinet is
worth guessing at.

## Live content

`furn_cachet_v900` (Cachet Vantage 900 cabinet, 18 500c) in `zone_drum_basement` hides
`furn_chem_lab`, factory code `1234`. `plugins/synthesis` refuses to find a concealed lab, so a
sealed cabinet means no cooking — the disguise is mechanical, not cosmetic.

Not done: the cabinet isn't purchasable furniture yet (no furniture-shop stock, no
buy-and-place flow), so concealment is authored content for now.
