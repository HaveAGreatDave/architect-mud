# dealing

**Purpose** — player-to-player drug dealing, with a price band that stops it being an exploit. `peddle` opens a priced offer; the buyer accepts or declines; the seller can cancel.

## Commands
- `peddle <drug> to <player> [for <price>]` — open the offer.
- `acceptdeal` / `declinedeal` — the buyer's call.
- `canceldeal` — the seller's.

## The price clamp
Price is **hard-clamped to a potency-based fair value ±25%**. No gouging a new player, and no dumping stock at zero to launder it. The band is the economy's protection, not a suggestion.

## Atomicity
Payment and hand-off happen **together** at accept. Same room, one dose per deal, 60s TTL.

## Events emitted
- `item.given` (on the seller) — which is what lets **surveillance** witness-roll the `drug_dealing` charge. Dealing in public is exactly as risky as doing it in front of a cop, because that is literally the mechanism.

## Events consumed
- `player.logout` — kills a pending offer.

## Load order
`after: ["surveillance", "commerce"]`
