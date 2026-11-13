# gametable

**Purpose** — multiplayer card tables. Texas Hold'em is the first game; the framework is built to take more.

## Commands
**Table:** `join` · `seat` · `leave` · `spectate` · `watch` · `table` · `board` · `pot` · `players`
**Play:** `deal` · `check` · `call` · `bet` · `raise` · `fold` · `allin` · `showhand`
**Staff:** `summon` · `evict` · `calldealer`
**Room:** `say` · `look` · `help`
**View:** `pokertext` · `text` · `visual`

## Hooks
- `zone.furniturePanel`

## REST
- `/gametable`

## Load order
`after: ["broadcast", "interactions"]` — several verbs here (`say`, `look`, `watch`, `help`) collide with engine and plugin builtins and are routed by table context.

## Table config (Hold'em)
A `game_tables.config` may also carry:
- `seats`: how many seats the felt has, 2 to 6 (default 4). The flat pane places them round the clock from the viewer (`render-pane.js` SPOTS) and the chairs' `seat_idx` run 0 to seats - 1.
- `selfDeal`: no dealer NPC; the players deal it themselves. A table with no dealer on its books (no `dealerNpcId`, no NPC whose `flags.table_id` names it) is dealt the same way without the flag: the button goes round, and whoever has it shuffles, deals and turns the board. A table whose dealer is on the books (an establishment's) still waits for them. A summoned AI player walks over from wherever they are like anywhere else (from too far to walk, they turn up outside the door). A locked door stops them: they knock every 7 seconds (`door.knock`: a knock sound on both sides from plugins/audio, the knocking clip on their figure in ROOM from plugins/roomstage) and go home after two and a half minutes if nobody opens it.
- `view3d`: the pane carries the table's state as `data-p3d` JSON, and the client draws it in 3D (`client/game/js/panels/poker3d.js`). Hidden cards go as null; the command bar is still the only way to act.

Solenne 30-B's card table (`scripts/seed-solenne-30b-poker.mjs`) uses all three.

## In ROOM
A poker felt is played in the Room Stage itself, not over it. `room.boards` hands ROOM the table's public state (`GameTable.roomState`: board, pot, each seat's chips, bet, cards held, the button, who's acting), and `client/game/js/panels/gl/room-poker.js` draws it on the table every frame: cards flying off the deck at each deal, the board turning over street by street, chips, the button, a gold ring on the seat to act. A seated player's own hole cards come out of their pane's `data-p3d`, so nobody else's are ever sent. `room.tablePeople` puts each seat on its own chair (somebody who just came in, `entered`, is walked from the door to their chair first) and the dealer at the deck end. The betting panel is docked at the right edge of the picture, out of the middle; a peek curls the near end of each hole card up off the felt so you read its corner. Every button sends the typed verb.

What hands do is said to the room as a plain line (`GameTable._gesture`: "raps the felt twice", "mucks", "pushes a stack of chips out", "deals them round"), and `client/shared/npc-acts.js` turns it into the clip on whoever's name starts it (`sitRap`, `sitMuck`, `sitChips`, `deal` in actor3d.js). The dealer's and gamblers' speech is ordinary `says` output, so the Stage voices it and puts it over their heads.

**A hired dealer.** At a `selfDeal` table with no dealer of its own, `calldealer` sends for one (`config.dealerName`, default Mags Ruddock): she arrives at the door about 15 seconds later, knocks while it's locked, walks in to the deck end and deals and calls the hands. `calldealer` again calls her off or sends her home. She lives on the table (`hiredDealer`), RAM only.

## View switching
Visual vs. text table is **per player**. A table's `config.textTable` is only the *opening default* — it is not an override, and must not be treated as one.

The stored preference is **game-wide**, not poker's: `text`/`visual`/`pokertext` write the same Display Mode (`server/engine/presentation.js`) the flight display reads, and the tablet's Settings → Display Mode switch writes it back the other way (syncing this plugin's runtime `textModePlayers` Set through the exported `syncDisplayMode`). Its **tri-state** — text / visual / never chosen — is load-bearing: `textTable` can only be an opening default because "never chosen" is distinguishable from "visual".
