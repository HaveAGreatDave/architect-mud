# pay

**Purpose** — handing credits to another player, safely. `pay` offers; the recipient accepts or declines. Same room, atomic, and the offer expires after 60 seconds.

This is the **agreed-upon** way to move money. For goods-and-money together, use **trade**; for a priced drug hand-off with a fair-value clamp, use **dealing**.

## Commands
- `pay <player> <amount>` — offer.
- `acceptpay` / `declinepay` — the recipient's call.
- `cancelpay` — the sender's.
