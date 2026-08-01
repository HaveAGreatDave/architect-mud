# concealment

Furniture that hides other furniture behind a passcode — a turntable and a fake wall.

## The model

Two furniture rows in one zone:

| Row | Flags | What the room sees |
|---|---|---|
| the **disguise** | `conceal_hides` = hidden row's id, `conceal_code` = factory code, `conceal_brand` (optional) | an ordinary (expensive) cabinet — **while it's shut** |
| the **hidden** piece | `concealed: true`, `conceal_hidden_by` = disguise's id | nothing at all — **while it's shut** |

**Only ever one of them is in the room.** Sealed, you see the cabinet. Open, the cabinet has folded
into the wall cavity and the hidden piece is standing *in its slot* — same position in the
`Furniture:` line, so opening a wall swaps one entry for another instead of reshuffling the room.
That's `standIns` in `commands/describe.js`, keyed off `conceal_hides` pointing at a piece that is
currently visible; a room that listed a bar wall *and* the lab it folded into would be telling on
you. The keypad moves with it: `conceal_hidden_by` is what makes `keypad` advertise on the revealed
piece, and the pad is how you shut it again. That flag is **discoverability only** — resolution
derives the pair from the zone, and a hint naming the revealed piece resolves to its cabinet, so a
missing back-pointer costs a hint and never access.

The revealed piece is usually a crafting station whose own plugin writes a `furniture.describe` line
(synthesis' `Lab:`), and that hook is last-writer-wins — which is why the keypad reaches it through
the specialized-action registry (examine's Actions row, the smart bar) rather than the hook, where
it was silently eaten.

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

**The keypad itself is owner-only in an owned room.** In a zone somebody holds — a rented flat, a
shop deed — only the owner is told there's a panel: the describe hook stays silent, and `keypad`
drops off examine's Actions row and the smart bar for everyone else (`visibleFor` on the specialized
action, gated by `zoneOwnerId` in `server/engine/zone-filth.js`). In UNOWNED space it reads as it
always did, because there's no owner for it to be private from. This hides the advert, never the
verb — a guest who already knows the cabinet is there can still type `keypad` at it, and still
needs the code.

## Live content

`furn_cachet_v900` (Cachet Vantage 900 cabinet, 18 500c) in `zone_drum_basement` hides
`furn_chem_lab`, factory code `1234`. `furn_cachet_v900_solenne_b` (a mirrored **bar wall**, not
another wardrobe — the flat already has a Polaris Valet Wardrobe) hides `furn_chem_lab_solenne_b`
in `zone_solenne_apt_b`, where the owner-only rule actually bites. `plugins/synthesis` refuses to find a concealed lab, so a
sealed cabinet means no cooking — the disguise is mechanical, not cosmetic.

Not done: the cabinet isn't purchasable furniture yet (no furniture-shop stock, no
buy-and-place flow), so concealment is authored content for now.
