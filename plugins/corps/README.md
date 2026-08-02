# corps

**Purpose** — player-run corporations. Found or join a corp, define your own rank ladder, share an **atomic** treasury, talk on a private corp channel, and claim an HQ. NPC factions are not a separate concept — they share the unified `orgs` table, so a player corp and a world faction are the same kind of thing.

## Commands
- `corp` / `org` — the hub verb (found, join, ranks, treasury, territory, HQ, ventures, rackets).
- `shakedown <shopkeeper>` — put a shop on the books, or remind one that it's already on them.

## Protection rackets (read this before tuning anything)

A corp that **controls** a zone can shake down the NPC shops in it for a cut of every sale. Three
things about it are load-bearing:

**Fear decays, and nothing tops it up for you.** Each shop's `fear` lives in `org_rackets`, stored
*as of* `last_leaned_at` and **never decayed by a write** — `fearNow()` computes the present value
from elapsed time on read, the same trick `player_npc_relations` uses. There is no decay tick, it
survives a restart, and a corp that logged off for a month comes back to exactly the decay it
earned. That's the mechanic: territory income asks nothing of you once the zone is yours, and this
asks constantly, which is why it pays better. Half-life is 10 real days — deliberately *faster*
than the 7-game-day rent clock, so a racket never settles into feeling like a bill.

**The take comes out of the till, not out of thin air.** `handleVenturePurchase` mints its cut into
the treasury; that's right for a business you own and pay upkeep on, and wrong for money you're
taking at knifepoint. The skim debits `npcs.vendor_credits`, so a racket is a *transfer*. Three
consequences you get for free: an over-milked shop with an empty till pays nothing (greed caps
itself, no tuning knob), every credit skimmed is one a rival can't crack out of that shop's safe,
and it can't inflate the economy.

**One racket per shop** (`UNIQUE(npc_id)`) — a rival can't move in while the shop is still afraid
of somebody else. And the cache is keyed by **npc_id, not zone**, because the lookup that matters
runs on the vendor buy hot path and has to be O(1).

The verb is `shakedown`, **not `lean`** — `lean` already belongs to the interactions plugin
(leaning on furniture), and taking it would have broken an existing emote.

## Hooks
- `furniture.describe` — corp terminals report their state.

## Specialized actions
- `use` on anything tagged `corp_terminal`.

## See also
[docs/systems-corps.md](../../docs/systems-corps.md) — influence tug-of-war and the five power levers. Phases 0–3 and protection rackets are built; espionage and NPC corp AI are still design.
