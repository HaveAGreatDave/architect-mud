# fishing

**Purpose** — a posture-based, perpetual cast-and-wait action for water-adjacent zones. A bite arms the client tension-bar reel overlay; landing it pulls a catch from a loot table.

## Commands
- `fish` — cast and wait.
- `fishcast` / `fishresolve` — token-gated silent callbacks from the client overlay. Never typed.

## Schema reuse
The catch comes from a **reused scavenging loot table** — fishing did not invent a table format, it borrowed one.

## Gates and consequences
- **Rod required**, bait optional.
- The **Fishing** skill gates the landing.
- Rare **monster hooks spawn a live enemy** — the water bites back.
- A botched reel can **snap the rod**.

## Discovery gap (known)
`fish` is **dual-gated**: a zone flag (`fishing_table_id`, ambient and not examinable) *and* a carried item tagged `fishing_rod`. It is deliberately **not** exposed as a rod specialized action, because advertising `fish` on a rod in a dry zone would mislead. Discovery is the rod's item description and help.

## See also
[docs/systems-fishing.md](../../docs/systems-fishing.md)
