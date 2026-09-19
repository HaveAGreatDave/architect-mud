# commerce

**Purpose** — shopping. The vendor verbs, the balance display, and — more interestingly — the two rules that make a shop behave like a *place* rather than a menu.

**Vendor services stay in the engine** (stock, pricing, trust, restock). This plugin owns the verbs and the room rules.

## Commands
- `shop` / `browse` — see what they have.
- `buy` / `sell` — the transaction.
- `checkout` — settle unpaid goods.
- `balance` — what you are carrying.

## Shop HOURS are a room rule
A `commerce:shop-hours` **move gate** locks an interior shop while **every** vendor who works it is off the clock, and a **30s closing sweep** puts anyone still inside back out on the street. A shop is shut because nobody is working, not because a flag says so.

The gate refuses the step; a `commerce:shop-hours` **shut provider** (`registerShutProvider`, [movement-gates.js](../../server/engine/movement-gates.js)) says the same thing *before* it, to every surface that draws a way in — the room description tags the exit `(closed)`, the dpad arrow turns red, the minimap paints the building red instead of accent. Until 2026-09-02 the gate was the whole implementation, and because most shop fronts have no `doors` row for a lock state to live on, a closed shop looked exactly like an open one until you walked into it. Both halves read the same predicate pair, so a surface can never disagree with the door; the gate keeps the reason, since a door tag has no room for a sentence.

## The shop DOOR

[`shopdoor.js`](shopdoor.js), and the thing the gate above was standing in for. Measured before it
was built: of the 84 zones a scheduled vendor keeps shop in, **49 had no `doors` row on their
entrance at all** and **32 more had a door carrying no lock** — which is the same defect twice,
because `npcAutoLockable` needs a lock tag, so even the shopkeeper's own lock-up-on-the-way-home
step in [ai-behaviour.js](../../server/engine/ai-behaviour.js) never fired for any of them. "The
door won't give" was a wall wearing a door's words: nothing to unlock, nothing to hack, nothing to
break down.

The lock is an ordinary registered type (`lock:shoplock`), so lock/unlock/hack/bash/burglary/knock
all reach a shopfront through machinery that already exists and none of it is re-implemented here.
Four rules.

⚠ **The door outranks the hours.** The gate abstains the moment the entrance lock is not locked,
because a lock a player beat has to buy them something. Leave the refusal absolute and the hack and
the crowbar are theatre: you get through the door and the room still turns you away.

⚠ **Nothing invents a "forced" flag.** A shop door is locked while the shop is shut, so an entrance
standing unlocked during closed hours is one somebody opened. That is the whole test — and it is why
the sync acts only on a **change** of trading state. Re-asserting "closed means locked" every 30
seconds would re-lock the door a player hacked half a minute after they beat it. A forced door stays
forced until the shop next opens and closes again, which is the truth of it: nobody has been back to
secure it.

⚠ **A door with no lock is not a door this system has an opinion about.** `shopEntranceLock` returns
null for one, so `lock_state` on the 32 bare doors is never read and they behave exactly as they did.

⚠ **Auth is the building, not the shop.** A customer never holds a shop key, so the lock opens for
exactly one person: somebody who lives in the building the shop sits in. That is the same exemption
the hours gate has always carried, moved onto the lock so the two cannot disagree about it.

**The hours are a card in the door**, derived from `vendor_schedule` — the timetable the vendor
already commutes on — so a shop's posted hours cannot drift from the hours it keeps and nothing is
authored. It reaches `examine door <dir>` through the engine's new `door.describe` gather hook, and
the one-line form is quoted in the refusal, because "about six hours" is only half of what somebody
standing at a locked shopfront wants to know.

Fitted by [`scripts/content/fit-shop-locks.mjs`](../../scripts/content/fit-shop-locks.mjs), which
reads `connections.lockable` — a column the schema has carried since the map pipeline was written
("a lock MAY be installed here") **with no reader anywhere in the server**. It can only ever fit a
lock where a human already said one could go, which is why 20 shops are listed and skipped rather
than forced: 12 whose entrance is an interior link with no `world_exit_zone`, and 8 whose entrance
connection is not marked lockable (an open yard, a lobby, a studio floor).

## Self-service
Goods pulled from a `vendor_stock` display cooler carry an **unpaid mark** (the engine stamps it). `checkout` settles it at a `checkout`-flagged counter. Carrying it out of the shop building emits `shoplifting.caught` for **surveillance** to charge. So a corner shop works exactly the way one does: you can pick things up, and you can also walk out with them.

## `buy` with no vendor present
Hands off to the `storefront.buy_by_name` Action — player-owned shop displays — **before** refusing. That fallback is what lets player storefronts reuse the verb.

## Discovery gaps (known)
`shop` / `browse` / `buy` / `sell` all target an on-scene vendor NPC, and NPC examine prints only talk and attack. They are discovered through the click-a-vendor shop panel and dialogue. `checkout` is the exception and **is** exposed — gated on a counter flagged `checkout: <npcId>`, and taught by the unpaid-goods line printed when you pull from a cooler.

## See also
[docs/systems-economy.md](../../docs/systems-economy.md)
