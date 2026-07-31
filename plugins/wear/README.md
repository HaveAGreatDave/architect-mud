# wear

Repair — the other half of durability. The engine substrate
([server/engine/durability.js](../../server/engine/durability.js)) knows what
condition *means*; this knows what a person does about it.

Full design: [docs/systems-durability.md](../../docs/systems-durability.md).

## Why a specialized action, not a command

`repair` is shared, not owned. Flight's `repair` is a plugin *command* — it runs
first, self-gates on "am I at a hangar with a craft", and returns `undefined` in
a bar. The engine builtin targets infrastructure. This one answers for carried
gear, from a different registry entirely, so there is no collision to declare and
no `after:` to get wrong. SIFT resolves which of your battered things you meant.

An ambiguous pick replays through the **`wear.repair_item` Action** — the builtin
SIFT replay path can't reach a plugin verb (the replay trap; same shape as
thievery).

There is **no `requiredTag`**: what's repairable is derived from the item
(weapon / armour / body-slot apparel / tool), never authored.

## Two paths

| | Where | Ceiling | Roll |
|---|---|---|---|
| **Field** | anywhere, needs an item tagged `repair_kit` | **Battered (0.65)** | your Fabrication vs difficulty |
| **Bench** | a zone holding an NPC flagged `repairman` | full restoration | the NPC's competence |

You can never make a thing right in the mud — a field patch gets you home.
Difficulty scales with the item's value, so better gear is harder to put right,
which is the pressure that makes knowing a good repairman worth something.

**Price** (bench only): `max(8, value × 0.4 × missing)`, discounted by
`relationHelp` — your repairman charges you less
([systems-relationships.md](../../docs/systems-relationships.md)).

**Outcomes** are margin-driven — `rough` / `sound` / `masterful`. A failed repair
costs 5% progress, never the item. The **only** way wear ever loses you an item
is botching a *field* repair on something already **broken**, with the risk
stated up front.

Every repair increments `custom_data.repairs`, which surfaces on examine —
*"battered, twice-mended."*

## Content hooks

| Tag / flag | On | Effect |
|---|---|---|
| `repair_kit` | item | carrier can field-repair |
| `no_repair` | item | opt out of repair entirely (rare) |
| `wear_rate` | item | override derived durability (rare) |
| `flags.repairman` | NPC | this zone offers bench repair |

## Known gaps

Repair is not yet a **job** — no bench shift, no job-board commission. Player-to-player
service works today only through the existing trade window (hand it over, they fix
it, hand it back, pay via the pay plugin), with no in-game way to advertise.
