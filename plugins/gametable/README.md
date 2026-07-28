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

## View switching
Visual vs. text table is **per player**. A table's `config.textTable` is only the *opening default* — it is not an override, and must not be treated as one.
