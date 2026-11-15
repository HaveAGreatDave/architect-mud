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
- `keypad [name] <code> <new code>`: the text path for setting a code, the current code and then the new one.
- `concealcode` / `concealsetcode` — client transport only; the overlay submits them with
  `sendCmdSilent` so **the digits never reach the message log**. `concealsetcode <id> <code>`
  checks the current code and answers with the overlay's `new` stage; `concealsetcode <id> <code> <new>` sets it.

## The code (as built)

The authored `flags.conceal_code` is only the **factory code** (1234 on both live cabinets). A content
deploy rewrites a furniture row's flags, so a code kept there went back to the factory's on every push;
the code somebody sets lives in the **`conceal_codes`** table (one row per cabinet, `class: 'player'`, never
exported). No row means the cabinet is still on its factory code. The plugin reads a cabinet's row once
and keeps it in RAM; every write goes through `saveCode`. If the row can't be read, the pad goes dark
rather than falling back to the factory code.

- **First use.** The first right entry of a factory code doesn't open the wall. It asks for a code of
  your own (the overlay's `setup` stage, taken twice so a slip doesn't lock you out; the typed path says
  `keypad <name> <code> <new code>`). Once it's set, the wall opens, and the factory code stops working.
  The factory code can't be the new code.
- **Reset.** The keypad's small bell key (last orders) asks for the current code; the server checks it and
  answers with the `new` stage, which takes the new code twice. A reset doesn't move the wall.
- **Who may set it.** In an owned room, only the owner (`canSetCode`, the same `zoneOwnerId` seam as the
  keypad's advert): a guest who knows the code still works the wall but can't change the code and lock the
  owner out of their own flat. For a guest, the factory code works the wall as it always did. In unowned
  space, whoever knows the current code may change it.
- **The server picks the stage.** The overlay opens at whatever `stage` the server's `conceal_keypad`
  names (`enter`, `setup`, `new`). It holds the code you just typed in memory for two minutes, because the
  server checks it again with the new one; nothing about whether a code is right is decided in the client.
  Factory status is never sent before a right code, so opening the pad doesn't tell anybody that 1234 works.

## The pad (as built)

The keypad is dressed as part of the bar it hides in: a small graphite box in a brass hairline, drawn in
CSS 3D. It hinges up out of the bar when it opens, leans a little toward the pointer, and every key is a
cap standing in a lit well that sinks into the plate while it's pressed (mouse, touch or keyboard). The
screen has eight amber lamps, one lit per digit, and blinks red on a slip.

Keys carry a symbol and nothing else; the code is where you press, as on any pad, and the keyboard's
digits still work. Where a symbol fits, it counts: a shot glass for 1, two glasses for 2, three olives on
a pick for 3, four cubes of ice, a shaker for 5, a six-pack, a martini for 7, a lime of eight segments, a
wine bottle for 9 and a bottle cap for 0. Back is a spilt glass, enter a bottle pouring, and reset a
last-orders bell. The digit lives only in each key's `aria-label`, such as "3 (three olives)". The sheet
is `keypad.css`, and its header says what keeps the 3D from flattening.

**Finding it in ROOM.** The pad used to be an invisible point in front of the bar's shelves. It's now
drawn (`drawCachetPad` in `gl/room-mesh.js`): smoked glass in a brass hairline with a dim amber grid of
keys, on the false wall's wing at switch height, or standing on the worktop's end where there's no wing.
`cachetPad` in `client/shared/room-layout.js` is the one place that says where, and the keypad's station
is put there, so the hover ("Use the keypad"), the click and the drawing agree. It's at the left end to
somebody facing the bar. Everyone sees the panel, because a control on a fancy bar gives nothing away;
only a viewer the room tells about the keypad (`msg.keypad`: the owner, or anyone in unowned space) also
gets a warm ring pulsing on it within a few steps (`padCue` in `room-stage.js`) and, the first time on
that device, a line saying where it is.

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
`furn_chem_lab`, factory code `1234` (the basement has no ROOM spec, so it's text only). `furn_cachet_v900_solenne_b` (a mirrored **bar wall**, not
another wardrobe — the flat already has a Polaris Valet Wardrobe) hides `furn_chem_lab_solenne_b`
in `zone_solenne_apt_b`, where the owner-only rule actually bites. `plugins/synthesis` refuses to find a concealed lab, so a
sealed cabinet means no cooking — the disguise is mechanical, not cosmetic.

Not done: the cabinet isn't purchasable furniture yet (no furniture-shop stock, no
buy-and-place flow), so concealment is authored content for now.
