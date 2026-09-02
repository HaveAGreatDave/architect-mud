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

## Self-service
Goods pulled from a `vendor_stock` display cooler carry an **unpaid mark** (the engine stamps it). `checkout` settles it at a `checkout`-flagged counter. Carrying it out of the shop building emits `shoplifting.caught` for **surveillance** to charge. So a corner shop works exactly the way one does: you can pick things up, and you can also walk out with them.

## `buy` with no vendor present
Hands off to the `storefront.buy_by_name` Action — player-owned shop displays — **before** refusing. That fallback is what lets player storefronts reuse the verb.

## Discovery gaps (known)
`shop` / `browse` / `buy` / `sell` all target an on-scene vendor NPC, and NPC examine prints only talk and attack. They are discovered through the click-a-vendor shop panel and dialogue. `checkout` is the exception and **is** exposed — gated on a counter flagged `checkout: <npcId>`, and taught by the unpaid-goods line printed when you pull from a cooler.

## See also
[docs/systems-economy.md](../../docs/systems-economy.md)
