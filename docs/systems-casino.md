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

## Verb ownership

| Verb(s) | Owner |
|---|---|
| `spin`, `slots` | `slots` |
| `join`, `seat`, `leave`, `spectate`, `check`, `call`, `deal`, `summon`, `evict`, `calldealer`, `bet`, `raise`, `fold`, `allin`, `table`, `board`, `pot`, `players`, `showhand` (+ routed `say`/`look`/`help`/`watch`) | `gametable` |
