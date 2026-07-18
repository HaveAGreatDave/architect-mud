# Casino — The Neon Vig (as built)

Added in commit `1946c559`. Two **independent** gambling systems that share one
grimy zone: a self-contained **slots** plugin and a poker table that reuses the
pre-existing [`gametable`](../plugins/gametable/index.js) plugin. No engine
changes were needed for either.

## Venue

- **Zone:** `zone_casino_interior` — "The Neon Vig"
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
  - `npc_neonvig_dealer` — **"Sennet 'Deadhand' Cole"** (poker dealer, below).

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

## Poker table

Owned entirely by the [`gametable`](../plugins/gametable/index.js) plugin — the
casino commit added **content + a seed only**, no code. See that plugin for the
Hold'em rules, betting verbs, and bot logic ([bot-player.js](../plugins/gametable/bot-player.js)).

- **Wiring:** furniture `furn_neonvig_poker_table` + four chairs
  `furn_neonvig_chair_1..4` carry `flags.game_table_id: "gametable_neonvig"`
  (chairs also `flags.seat_idx: 0..3`, interaction `sit`). The runtime
  `game_tables` row `gametable_neonvig` links the zone + dealer.
- **Dealer:** `npc_neonvig_dealer`, `flags.table_id: "gametable_neonvig"`,
  `personality: dealer`. Hands can't be dealt unless the dealer is present;
  `call dealer` / `calldealer` rushes him back if he wandered off.
- **Summoning an opponent:** `summon` / `deal in <name>` / `call <name>` (when
  not in a live hand) calls a `flags.poker_player` gambler NPC (Ledger) to an
  open seat; you must be seated first. A lone seated human auto-invites a gambler
  after ~45s.

### Required seed (one-shot per environment)

The `game_tables` row is runtime-classified and is **not** carried by
`content:import` (same pattern as `gametable_embassy`). After a fresh deploy:

```
node scripts/seed-neonvig-poker.mjs                    # local
node --env-file=.env.prod scripts/seed-neonvig-poker.mjs   # prod
```

Idempotent (insert-or-update). Inserts `game_tables` id `gametable_neonvig`,
zone `zone_casino_interior`, `game_type: 'holdem'`, `smallBlind 10` /
`bigBlind 20`, `buyIn 250` (`minBuyIn 100` / `maxBuyIn 2000`),
`turnTimerSecs 30`, `dealerNpcId: "npc_neonvig_dealer"`. Reload the world after.

## Back-room old-school (text) table

A second, self-contained poker table in a back room off the floor — the
**called-aloud** table, built around the [text-mode](#text-mode-screen-reader-accessibility)
accessibility layer so it plays fully by the log. Same Hold'em engine; no plugin
code beyond the `config.textTable` seam.

- **Room:** `zone_casino_backroom` — "The Neon Vig — Back Room", `east` from the
  floor / `west` back (shares the casino's interior `map_id`). A separate zone on
  purpose: the seat/furniture-panel/`take_seat` bridges assume **one table per
  zone**, so a second table in the main room would misroute seats.
- **Dealer:** `npc_neonvig_backroom_dealer` — **Marguerite "Margo" Sable**
  (female, `personality: dealer`, `flags.table_id: "gametable_neonvig_oldschool"`,
  homed to the back room). She deals by hand and "calls every card aloud, the old
  way" — her dialogue/chitchat sell the accessible framing.
- **Wiring:** `furn_backroom_poker_table` + `furn_backroom_chair_1..4`
  (`flags.game_table_id: "gametable_neonvig_oldschool"`, `seat_idx 0..3`).
- **The `textTable` flag** (on the `game_tables` config, not content): the
  `gametable` plugin (a) **force-enables text narration** for anyone who sits or
  spectates — no personal `pokertext` opt-in needed (`ensureTextPref`), and (b)
  unlocks Margo's **old-school dealer quips** (`OLD_SCHOOL_LINES` in
  [game-table.js](../plugins/gametable/game-table.js), blended into `_quip` at
  ~50% for a flagged table). Cheaper, slower table: `smallBlind 5`/`bigBlind 10`,
  `buyIn 100`, `turnTimerSecs 45` (more time to act by ear).
- **Seed (runtime row, same as above):**

  ```
  node scripts/seed-neonvig-oldschool-poker.mjs                    # local
  node --env-file=.env.prod scripts/seed-neonvig-oldschool-poker.mjs   # prod
  ```

  Inserts `game_tables` id `gametable_neonvig_oldschool`, zone
  `zone_casino_backroom`, `textTable: true`,
  `dealerNpcId: "npc_neonvig_backroom_dealer"`. Reload the world after.

## Verb ownership

| Verb(s) | Owner |
|---|---|
| `spin`, `slots` | `slots` |
| `join`, `seat`, `leave`, `spectate`, `check`, `call`, `deal`, `summon`, `evict`, `calldealer`, `bet`, `raise`, `fold`, `allin`, `table`, `board`, `pot`, `players`, `showhand`, `pokertext` (+ routed `say`/`look`/`help`/`watch`) | `gametable` |

## Text mode (screen-reader accessibility)

The visual table lives in the area pane (`poker_update` HTML) a screen reader
can't follow. **`pokertext [on|off]`** (bare = toggle) is a per-player opt-in that
narrates the pane-only moments to the scrolling log as ASCII, *on top of* the
normal visual table — it doesn't replace it, and it's invisible to everyone else.
Persisted in `player_flags.poker_text_mode`; the runtime check is an in-memory
`Set` ([text-mode.js](../plugins/gametable/text-mode.js)) loaded once when you
sit/spectate, so narration never touches the DB.

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
