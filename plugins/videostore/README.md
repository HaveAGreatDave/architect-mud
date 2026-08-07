# videostore

**Purpose** — renting a tape off a wall, and being chased for it. The tapes themselves
already worked: a `media_cassette` item carrying a `broadcast_id` has loaded into any
media deck since the broadcast system shipped, and two of them (SISTER STEEL, THE METER
READER) existed as ordinary loot. What did not exist was any reason for a tape to come
**back**, which is the entire difference between a video shop and a vendor with a theme.
This plugin owns that loop and nothing else.

## The rule that shapes it

**A rental is not a sale with extra steps.** If tapes were sold, a wall would empty once
and the shop would be over. So a wall's stock is **finite and shared** — every copy that
is out is a copy nobody else can have — and that is the only scarcity the system has. It
needs no other, and adding one (a cooldown, a reputation gate, a stock timer) would be
inventing scarcity on top of scarcity.

## Three decisions worth keeping

- **Nothing ticks and nothing accrues.** The late fee is derived on read from
  `today - due_day`, both of them **game-day indices** (`gameDayIndex`, the same helper
  owned-room filth uses), exactly the way corp rackets derive `fearNow`. A server that
  was off for a week owes nobody a catch-up pass, there is no midnight job walking every
  open rental, and `feeFor()` is the whole clock. It is a pure function over two integers
  and the regress suite drives it at every boundary — including the two that happen once
  per rental, the due day itself and the write-off cliff — because if it is wrong, a debt
  is wrong forever and nothing will ever correct it.

- **The debt closes the wall, not the door.** Owing money does not lock you out of the
  shop, stop you buying comics, or make the shopkeeper hostile. It stops the one
  transaction it is about. A system that punished you everywhere for a late tape would be
  a wanted level, and the game already has one of those.

- **A borrowed tape is an ordinary item.** It carries no rental marker, so it drops,
  trades, gets stolen and gets looted like anything else — and the rental row survives all
  of that, because what the shop lent out was not this inventory row, it was this **title,
  to you**. Losing the tape does not cancel the debt; that is what the replacement charge
  is for, and past `WRITE_OFF_DAYS` the accrual **stops** and the print is billed instead,
  so a tape that never comes back has a finite, knowable price rather than an unbounded
  one.

## Commands

| verb | what it does |
|---|---|
| `rentals` | reads the wall — what's in, what's out, what's yours and when it's due |
| `borrow <title>` | takes one out for `LOAN_DAYS`, charges `RENTAL_FEE` |
| `returntape [title]` | puts it back and charges what it derives; no argument needed with one out |
| `settle` | pays off every debt row at once — the only thing that reopens the wall |

`returntape` is deliberately not `return`: a bare `return` is a control-flow-shaped word
and too good a candidate for a future verb to spend on this.

All four are furniture-gated on `flags.tape_rental` and declared in
`objectGatedCommands`, closed with declaration-only specialized actions so examining a
wall advertises them.

## Authoring a rental wall

Two flags on one piece of furniture:

```jsonc
"flags": {
  "tape_rental": true,                  // this is a wall; gates every verb
  "tape_shelf": ["item_betatape_..."],  // its stock, by item id
  "click_cmd": "rentals"
}
```

`tape_shelf` is **authored, never inferred**. "Every `beta_cassette` in the game" was the
obvious shortcut and is the wrong one: it would put one shop's private stock on every wall
the day somebody adds a tape somewhere else entirely.

Ships with exactly one wall — Mint Condition's back room (`zone_mintcond_back`), stocked
with five titles. The regress suite asserts that wall still exists, is still flagged, is
still stocked, and that every title on it is a real item carrying a `broadcast_id`; a
shelved title that no deck can play is the failure mode nothing else would catch.

## Registered actions

Declaration-only (`handler: null`) under `requiredFlag: tape_rental` — `rentals`,
`borrow`, `returntape`, `settle`. They register nothing at dispatch; they exist so
`availableActions()` surfaces the verbs on the wall.

## Events emitted / consumed

None. Zone-scoped flavour on `borrow` goes out through `sendToZone` directly.

## Tick usage

**None, by design.** See the first decision above.

## Dependencies

Engine only — `world` (furniture), `items-cache`, `environment` (the game date),
`zone-filth` (`gameDayIndex`), `messaging`.

## Config

Tunables are exported constants in `index.js`, not a config surface:
`LOAN_DAYS` 7 · `RENTAL_FEE` ₵20 · `LATE_FEE_PER_DAY` ₵15 · `REPLACEMENT_FEE` ₵120 ·
`WRITE_OFF_DAYS` 21. Regress welds down the one balance property that matters: a few days
late must cost more than the loan did, or the due date is decoration.

## Data

`tape_rentals` — one row per tape taken off a wall. Per-player runtime state, so it is
deliberately **not** in the content registry and never exports. Written only on borrow,
return and settle; no tick, no boot load, no hot-path read.
