# Casino — The Lucky Bastard (as built)

Added in commit `1946c559`. Two **independent** gambling systems that share one
grimy zone: a self-contained **slots** plugin and a poker table that reuses the
pre-existing [`gametable`](../plugins/gametable/index.js) plugin. No engine
changes were needed for either.

## Venue

- **Zone:** `zone_casino_interior` — "The Lucky Bastard"
  ([content/zones/zone_casino_interior.json](../content/zones/zone_casino_interior.json)).
  Interior building (`flags.is_interior: true`, `claimable_asset: "casino"`,
  marker `CA`), exit north → `zone_district_921_910`. Seedy-floor description
  (dying neon, blood-hiding paisley carpet, bolted-down cashier cage), 14
  vice-laden `ambient_events`, `ambient_theme: "indoors"`.
- **Ambience NPCs** (all homed to the casino):
  - `npc_neonvig_gambler` — **"Ledger"**, `npc_type: gambler`. The summonable
    poker bot: `flags.poker_player: true`, `poker_bankroll: 2400`, and a full
    `poker_persona` (aggression 0.55, bluffFreq 0.22, tightness 0.45, buyIn 200,
    tiltProne 0.5). Behaviour graph runs `HAVE_LIFE`.
  - `npc_neonvig_enforcer` — **"the Collector"**, `personality: thug`, hp 90.
    Pure loan-shark menace at the cage; no mechanics.
  - `npc_neonvig_backroom_dealer` — **"Marguerite 'Margo' Sable"** (the poker
    dealer, below). Runs the one felt in the main room, called-aloud.

## Slots ([plugins/slots/](../plugins/slots/index.js))

- **Verbs:** `spin`, `slots` (both → `cmdSpin`). Declared in
  [plugin.json](../plugins/slots/plugin.json); no hooks.
- **`spin [bet]`** — targets the **first** furniture in the room with
  `flags.slot_machine` (no per-machine targeting). Bet = first numeric token in
  args; bare `spin` uses the machine's `slot_default`. Reads `slot_min` (def 5),
  `slot_max` (def 100), `slot_default` (def = `slot_min`) off the furniture.
- **Money:** debits the bet first via `adjustCredits(player, -bet, …, 'slots:bet')`
  (the guarded debit doubles as the affordability check); pays out via `'slots:win'`.
- **Reels:** three independent weighted reels (no paylines). Symbol weights —
  `7`=1, `$`=3, `★`=4, `♦`=6, `♣`=8, `♠`=8 (total 30). Payout multipliers of bet:
  three-of-a-kind `{7:75, $:40, ★:20, ♦:12, ♣:8, ♠:8}`; pairs pay only on the
  three high symbols `{7:6, $:4, ★:3}`; anything else = 0. Long-run RTP ≈ 0.75
  (house-favoured). Renders an ASCII cabinet + broadcasts a `zone_event` on a
  triple-seven jackpot (floor-wide) or any `mult >= 12` (a smaller "coins clatter").
- **Machines:** `furn_neonvig_slots_1..3` ("Lucky Seven", "Double or Nothing",
  "Widow Maker") — identical config (`slot_min 5`, `slot_max 100`,
  `slot_default 10`), interaction `spin`.

## Poker table (the old-school called-aloud felt)

One poker table, in the main casino room, run entirely by the
[`gametable`](../plugins/gametable/index.js) plugin — content + a seed, no
bespoke code. It's the **called-aloud** table: it *opens* in the
[text-mode](#text-mode-screen-reader-accessibility) view, so by default it plays
by the text log — though any player can flip to the visual felt with `visual`.
Same Hold'em engine (rules/betting/bots in
[bot-player.js](../plugins/gametable/bot-player.js)); the only plugin seam is
`config.textTable`.

> **History:** originally two tables — a visual high-stakes table
> (`gametable_neonvig`, dealer "Deadhand" Cole) on the floor and Margo's
> old-school table in a back room (`zone_casino_backroom`), separate because the
> seat/furniture-panel/`take_seat` bridges assume **one table per zone**. Both
> the visual table (+ dealer, + furniture) and the back room were later retired;
> Margo's felt moved into the main room as the casino's only poker.

- **Dealer:** `npc_neonvig_backroom_dealer` — **Marguerite "Margo" Sable**
  (female, `personality: dealer`, `flags.table_id: "gametable_neonvig_oldschool"`,
  homed to `zone_casino_interior`). She deals by hand and "calls every card aloud,
  the old way" — her dialogue/chitchat carry the accessible framing.
- **Wiring:** furniture `furn_backroom_poker_table` + `furn_backroom_chair_1..4`
  (`flags.game_table_id: "gametable_neonvig_oldschool"`, chairs `seat_idx 0..3`,
  interaction `sit`), all in `zone_casino_interior`. The runtime `game_tables`
  row `gametable_neonvig_oldschool` links the zone + dealer.
- **Opponents:** `summon` / `deal in <name>` / `call <name>` (when not in a live
  hand) calls a `flags.poker_player` gambler NPC (Ledger) to an open seat; sit
  first. A lone seated human auto-invites a gambler after ~45s. `call dealer` /
  `calldealer` rushes Margo back if she wandered off.
- **The `textTable` flag** (on the `game_tables` config, not content) does exactly
  two things: (a) it is the **opening default view** for a player who sits or
  spectates with **no stored Display Mode** at all — they start in the
  called-aloud log game (`ensureTextPref`); and (b) it unlocks Margo's
  **old-school dealer quips** (`OLD_SCHOOL_LINES` in
  [game-table.js](../plugins/gametable/game-table.js), blended into `_quip` at
  ~50% for a flagged table).

  **It is a default, never an override.** The player's own `text`/`visual` choice
  always wins, at every table, and is persisted per player. This is why Display
  Mode is **tri-state** (`text` / `visual` / never chosen): "never chosen" is not
  the same as "visual", and only the distinction keeps this default alive. Whether the visual
  pane is drawn is decided **per player** in `pushPaneAll` (`isTextMode(pid)`),
  and `join`/`seat`/`spectate`/`look` return the room look only for players who
  are personally in text view (`paneOrLook`). *(Until 2026-07-20 `textTable` was a
  hard table-level lock that suppressed the pane for everyone and made `visual`
  refuse outright — that override is gone.)* Friendly stakes: `smallBlind 5`/`bigBlind 10`,
  `buyIn 100`, `turnTimerSecs 45` (more time to act by ear).

### Table state persistence (2026-07-27)

`maybePersist()` fires every 10s per table for as long as the server is up. It used to write
unconditionally — and an **empty table's serialized state is byte-identical forever**, so three
idle tables were ~18 pointless `UPDATE game_tables` a minute in a world where nobody was playing
cards, each one keeping Neon's compute from suspending.

`_persist()` now compares against what it last wrote (`_persistedJson` / `_persistedPhase`) and
skips the round trip when nothing changed. This is safe by inspection: the row already holds
exactly what the write would have set, so a restart reloads identical state. Measured 24 → 3 writes
per 75s, the 3 being each table's first real persist after boot.

### Required seed (runtime rows, one-shot per environment)

`game_tables` rows are runtime-classified and **not** carried by `content:import`.
On a fresh environment, register the table:

```
node scripts/seed-neonvig-oldschool-poker.mjs                        # local
node --env-file=.env.prod scripts/seed-neonvig-oldschool-poker.mjs   # prod
```

Inserts `gametable_neonvig_oldschool`, zone `zone_casino_interior`,
`textTable: true`, `dealerNpcId: "npc_neonvig_backroom_dealer"`. Reload after.

The one-time **consolidation** (drop the retired visual table row, move the
old-school row into the main room on an environment that already had both) runs
via `scripts/consolidate-neonvig-poker.mjs` (idempotent; local, then prod after
the deploy).

## The Coyote's Rest table (The Reach)

A second poker table, same content+seed pattern (no code), in the saloon at
The Reach — `zone_bld_899_1171_lobby` ("The Saloon Floor"). Themed as a frontier smuggler's
game; **stakes a notch above the Lucky Bastard**: `smallBlind 10`/`bigBlind 20`, `buyIn 200`
(`minBuyIn 100`/`maxBuyIn 2000`), `turnTimerSecs 45`.

**Visual felt** — it opened as a called-aloud table until 2026-07-20; `textTable`
was dropped from its config so it now draws the poker pane like the Embassy table.
Re-run `scripts/seed-coyote-poker.mjs` per environment to apply (the row is
runtime-classified). Players who prefer the log game can still type `text`.

- **Table id** `gametable_coyote`; furniture `furn_reach_poker_table` + `furn_reach_chair_1..4`
  (`flags.game_table_id: "gametable_coyote"`, chairs `seat_idx 0..3`, `sit`). The stakes are
  scratched into the table's rail description (`10/20 · $200 TO SIT · NO MARKERS`).
- **Dealer** `npc_reach_dealer` — **Ambrose "Doc" Teller** (`personality: dealer`,
  `flags.table_id: "gametable_coyote"`, homed to the saloon; Margo-style behaviour graph).
- **Gambler** `npc_reach_gambler` — **Delphine "Del" Roan** (`flags.poker_player: true`,
  `poker_bankroll 2200`, aggressive/tilty `poker_persona`, `npc_type gambler`, `HAVE_LIFE`
  graph). Summonable to the felt like Ledger (the bot is matched purely on `poker_player`).
- **Seed:** `node scripts/seed-coyote-poker.mjs` (local) / `--env-file=.env.prod` (prod) —
  the `game_tables` row is runtime-classified, same as the Lucky Bastard table.

## Verb ownership

| Verb(s) | Owner |
|---|---|
| `spin`, `slots` | `slots` |
| `join`, `seat`, `leave`, `spectate`, `check`, `call`, `deal`, `summon`, `evict`, `calldealer`, `bet`, `raise`, `fold`, `allin`, `table`, `board`, `pot`, `players`, `showhand`, `pokertext`, `text`, `visual` (+ routed `say`/`look`/`help`/`watch`) | `gametable` |

## Visual ⇄ text switch (per player, any table)

The visual table lives in the area pane (`poker_update` HTML) a screen reader
can't follow. A player can switch their own view at any table between the
**visual** table and the **text** version:

- **`visual`** — the poker table in the top area pane (the default).
- **`text`** (alias **`pokertext [on|off]`**, bare = toggle) — the table *leaves*
  the top pane, which reverts to the **room look**, and the game is called out to
  the scrolling log as ASCII. The visual pane also carries a **`text` button** in
  its command bar for a one-click flip; `visual` (or the `pokertext off` alias)
  brings the table back.

`applyPokerView` in [index.js](../plugins/gametable/index.js) is the one switch
behind all three verbs and the button: it toggles the in-memory
`textModePlayers` `Set` ([text-mode.js](../plugins/gametable/text-mode.js)),
persists the game-wide **Display Mode** (`player_flags.display_mode`, see
[server/engine/presentation.js](../server/engine/presentation.js)) — the same
preference the flight display reads, so `text` at the felt also stops the 3D
cockpit opening later; that is deliberate, there is one switch and these verbs
are handles on it. It writes the **middle** rung (`textgames`), never the bottom
one: how you chose to play cards must not take away your map and hangar bay as a
side effect. A player already on `log` stays there, since dropping them a rung
would hand back panels they had turned off — and — if you're at a table — flips the
top pane immediately (returns the room `look` for text, the `poker_update` pane
for visual). `pushPaneAll` skips text-mode players so their room view isn't
re-covered on every action, and the `Set` is the hot-path check so narration
never touches the DB. The switch is invisible to everyone else at the table.

**It works at every table.** A table's `config.textTable` only seeds the *starting*
view for a player with no stored preference (`ensureTextPref`); it can't stop you
flipping. Two players at the same felt can be in different views at the same time.

Three additions (everything else — opponent actions, dealer quips, winners —
already reaches the log via `_dealerSay`):

- **Your hole cards** at the deal, plus your blind/button role.
- **The community board** (ASCII) on the flop, turn, river, and final showdown.
- **A compact "▶ Your turn" line** with the pot, your stack, and to-call amount +
  the legal commands — the signal a screen reader otherwise never gets (today
  "your turn" is only a sound cue).

`GameTable` calls the `text-mode.js` builders at those transition points
(`startHand`, `_onPhaseResult`, `_startTurnTimer`); `board`/`showhand` still
re-show the cards on demand.
