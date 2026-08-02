# graffiti

**Purpose** — spraying a tag on the front of a building. The `graffiti` crime has sat in the registry (`server/engine/crimes.js`) at 0.3★ since the crime system was built, charging nobody, because there was no verb. This is the verb.

## Commands
- `tag <direction|building> <text>` — spray up to 48 characters on a facade next door. `tag` alone lists the walls to hand.

Removal is **not** here — it's `clean` in the [cleaning](../cleaning/README.md) plugin. One verb for "make this room right" beats two.

## The three rules

**1. You spray a BUILDING, not a tile.** `tag` resolves a facade on an adjacent exit (`flags.is_building`) and refuses on open ground. That's the difference between graffiti and a text field: it lands on a thing that exists in the world, and the room line says which thing — *"Somebody's tagged the front of Bodega Vu: …"*. The check is `wallsNear()`, and if it ever returns a non-building the premise is gone, which is why regress guards it.

**2. One tag per street tile, and anyone may paint over anyone.** The cap isn't a limit, it's the design — the wall is a contested slot, so the question stops being "what shall I write" and becomes "whose tag is up". It's also what makes the cap a **PRIMARY KEY** rather than a rule somebody enforces: `zone_graffiti` can never hold more than one row per street tile in the world, and painting over is an UPSERT. The buried author isn't notified; you find out by walking past.

Keyed on the street tile you **stand in**, not the facade you paint, because that's the room it gets read from.

**3. It comes down on its own, eventually.** A tag ages out after `TAG_LIFE_DAYS` (3) **game** days, derived from the game DATE via `gameDayIndex` (the same trick as `zone-filth.js`) rather than a counter or a tick. Stateless: no column to reset, no sweep to schedule, and a restart can't repaint the city. Expiry is **lazy** — asked on read, and it fails toward *"the tag is still there"*, because a clock hiccup silently erasing every wall in the city is much worse than one stale tag.

At the default `timeScale: 1`, three game days is three real days.

## The teeth

`clean` removes a tag, but **only with a real `cleaning_tool`** — bare hands do floor filth, not brickwork. That asymmetry is deliberate and it is the whole point: floor filth yields to a determined scrub because requiring a tool would mean nobody ever cleans, but if defacing a shopfront cost the owner nothing to undo it wouldn't mean anything. A storefront owner goes and buys a solvent like everybody else.

## The crime

Spraying emits `graffiti.tagged`; the surveillance plugin charges `graffiti` through the ordinary witness gate. Nothing here decides whether you got away with it. Worth knowing what 0.3★ means after the severity scaling: it floors at `sevFactor` 0.25× and it's a **one-shot** roll, so at default camera effectiveness it's a single ~2.5% chance. You will nearly always walk. That's correct — the rare bust should be a funny slap, not a tax on the one expressive thing in the game.

## Cost model

**No tick, no skill, no stat.** RAM is authoritative: every tag hydrates once on first read and is mutated in memory thereafter, so the room-description path — which runs on every `look` in the game — never queries. This plugin is the **only writer** of `zone_graffiti`, which is what makes that cache safe (CLAUDE.md's write-funnel rule). The DB write happens on the spray or the scrub, once per act, on a cold path.

## Player text is HTML

The text is player-authored and lands in a stranger's room description, which the client renders as HTML. It is escaped **on the way in** and stored escaped — one place to get it wrong, and no way to double-handle it. The regress suite treats `esc` as a security boundary, not a formatting detail.

## Paint

A `spray_paint`-tagged item, one tag per can, sold at hardware shops (*Nuts to That*, ₵12 — the same counter that sells the mop and the acetone that undo it).

## Extension points
- `items.tags.spray_paint`
- `events.graffiti.tagged`

## See also
[docs/systems-surveillance.md](../../docs/systems-surveillance.md) · [docs/systems-cleaning.md](../../docs/systems-cleaning.md)
