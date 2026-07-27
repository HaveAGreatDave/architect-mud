# Hygiene — as built

Filth **on a body**, as an engine substrate: [server/engine/hygiene.js](../server/engine/hygiene.js).

The zone half of this always existed — `zones.stains` plus the `STAIN_SMELLS`
table in [commands/world.js](../server/engine/commands/world.js) answer *what
happened on this floor*. Nothing answered the other half. You could be caked in
shit, blood and three days of sweat and the room smelled of nothing, because
contamination was a set of flags that nobody ever read back.

**This owns no verbs and no tick.** It reads state other systems already write and
turns it into one question anything can ask: *how bad do you smell, and of what?*

| Written by | State | Read here |
|---|---|---|
| bodily | `clothing_contamination`, `appearance_data.soiled_state` | every contaminant type |
| combat | `covered_in_blood` | the blood note |
| mis | `appearance_data.ejaculate_state` (with `at`) | fluid, until it dries |
| anything physical | `player._sweat` via `addSweat()` | sweat |
| — | `player_flags.hygiene_washed_at` | plain unwashedness |

## Read tier

**Every export is sync and query-free by contract.** `hygieneOf` is called from
the smell command, from NPC reaction paths and (eventually) from price
calculations, so it may never await. The single write — stamping a wash — goes
through `player_flags` and is rare by definition. Sweat is runtime-only
(`player._sweat`, no column, per the no-new-sparse-columns rule) and decays 20/min
on bodily's existing tick.

## The API

```js
hygieneOf(creature)   // { score 0–100, band, sources[], sweat, grime } — sync
creatureFilthSmells(creatures, viewer, acuity)  // contributions for cmdSmell
bodyOdourSelf(player) // second-person line: what YOU smell of
addSweat(player, n) / coolSweat(player)
markWashed(player)    // the one write — every cleaning path calls this
```

Bands, cleanest first: `immaculate` · `clean` · `lived-in` · `rank` · `filthy` ·
`biohazard`.

It takes players **and NPCs** — both carry the same contamination shape, which is
exactly why this is engine and not bodily.

## What the room reports

`cmdSmell`'s creature pass now asks the substrate, and the result is **deduped
across the room, loudest wins** — a crowd of filthy people is one report, not six
identical lines eating the whole perception band. Sweat and plain grime only
surface on a sharpened nose (`acuity >= 1`) unless they're bad enough to have
stopped being sweat. Your own body is deliberately excluded from the room pass
and appended last, regardless of acuity: you don't need a good nose to know.

## Washing

`markWashed` resets the clock and the sweat. Called by bodily's `shower` (the
most thorough wash in the game) and MIS's `wash`. Grime starts accruing ~6h after
the last wash and maxes at ~24h.

A player who has **never** washed doesn't start filthy — the clock starts the
first time anything asks, this session. That keeps the system from ambushing
existing characters with a debt they had no way to pay.

## MIS gating

`ejaculate` is an ordinary contaminant with one extra property: `misOnly: true`.
Both the body table and the zone `STAIN_SMELLS` entry are withheld from a viewer
who hasn't opted into MIS — the smell would otherwise be the tell that the whole
surface exists. MIS's job is to *create* the state; describing it belongs here.

## The two clocks

A shower cleans the body; it does nothing for the coat you put back on. So there
are two, deliberately:

| Flag | Reset by | Onset → full |
|---|---|---|
| hygiene_washed_at | shower, MIS wash, a swim in clean water | 6h → 24h |
| hygiene_laundered_at | the laundry plugin only | 24h → 5 days |

Cloth holds it longer than skin does, which is what stops the second one being a
duplicate shower timer — and it is the entire reason a laundromat is a building
rather than set dressing. Only 6 of the 107 priced rentable units have an ensuite
at all.

## What reacts

**Warmth gains are damped while you stink** — one seam, in `adjustRelation`:
below 45 hygiene warmth gains are ×0.6, below 20 they are ×0.25. Familiarity is
untouched (being memorable and being liked are different things, and turning up
filthy is certainly memorable), and only GAINS are damped, so this can never make
an NPC like you less — it just slows how fast they come round. Every system that
moves warmth inherits it without knowing hygiene exists.

## Where you wash

**The Wash** — a coin laundry on Ironside Street (`zone_the_wash`, facade
`zone_district_918_905`), three rooms from the clone vat, deliberately: a fresh
clone walks out of `zone_start` and the only warm lit room on the street is four
steps south. It is a `sanctuary` with `allow_sleep`, so you can sit, sleep and
wash without being charged for the floor — the card on the middle machine reads
*Broke? Wash anyway. Pay when you can.* Washers 8₵, dryers 4₵, and a kettle that
counts as a `water_source`.

## NPCs

NPC hygiene is entirely in memory — no flags row, no write, ever. They accrue
grime and contamination like anyone else, and they **wash when they get home**:
`npcWashAtHome` fires from the AI's home-life pass (rate-limited to once per 30
minutes) and resets both clocks, the sweat and anything on their clothes. Without
it an NPC's grime clock starts the first time something asks and climbs forever,
so given enough server uptime every NPC in the world would end up reeking.

Deliberately not a player path: a player has to go and find water.

## Rewards and punishments

| | Trigger | Effect |
|---|---|---|
| `fresh` status | score ≥ 85 after any wash/laundry | **+1 Cool**, 45 min |
| warmth multiplier | score ≥ 85 | NPCs warm to you **×1.15** faster |
| warmth multiplier | score < 45 / < 20 | **×0.6 / ×0.25** |
| *So Fresh and So Clean* | `hygiene.immaculate` | accolade |
| *Unfit for Indoor Use* | `hygiene.filthy` (score ≤ 12) | accolade |

The bottom band takes filth **plus neglect** — shit, vomit and blood together
only reach ~27. You have to have stopped washing as well.
`checkFilthy` latches per descent (cleared when you climb back out) and runs on
bodily's 1m tick, never on the smell path.

## Soap

`item_soap_block` (4₵, tag `soap`) is what turns a rinse into a wash: `wash`
without it clears the visible filth but leaves the grime clock running.

`soap <target>` (bodily) is the altruistic verb — the only one in the system
that spends your own resource on somebody else's state. Needs running water and a
carried block; strips their filth, resets their clock, and buys **+6 warmth** with
an NPC, which is one of the cheapest relationship moves in the game.

## Known gaps

- `vendor-reactions.js` still doesn't read it — a shopkeeper's *greeting* and
  *price* are the obvious next consumers after warmth.
- Bex has chitchat but no VINE dialogue tree, so the pay-when-you-can card is
  scenery rather than something you can ask her about.
- The laundry clock is **per player, not per garment** — a coat sitting unworn in
  your pack gets "dirty" at the same rate as the one on your back.
