# graffiti

**Purpose** — spraying a tag on the front of a building. The `graffiti` crime has sat in the registry (`server/engine/crimes.js`) at 0.3★ since the crime system was built, charging nobody, because there was no verb. This is the verb.

## Commands
- `tag <direction|building> <text>` — spray up to 48 characters on a facade next door. `tag` alone lists the walls to hand.
- `spraycan [wall]` — the same act with the lid off: the in-browser can (per-letter colour, weight, saved designs). `tag <dir>` with no words and a can in hand opens it too, which is how anybody finds it.

The verb is **`spraycan`, not `spray`** — the flight plugin already owns `spray` (the Locust's crop-duster boom), and plugins beat engine builtins but never each other; the later loader would simply have eaten one of them.

Removal is **not** here — it's `clean` in the [cleaning](../cleaning/README.md) plugin. One verb for "make this room right" beats two.

## The three rules

**1. You spray a BUILDING, not a tile.** `tag` resolves a facade on an adjacent exit (`flags.is_building`) and refuses on open ground. That's the difference between graffiti and a text field: it lands on a thing that exists in the world, and the room line says which thing — *"Somebody's tagged the front of Bodega Vu: …"*. The check is `wallsNear()`, and if it ever returns a non-building the premise is gone, which is why regress guards it.

Since 2026-08-01 the room line sits **with the room's prose** rather than up among the `[SAFE]`/district/light chips — a tag describes a thing that is in the room. That placement is `describe.js`'s, and it moved every `zone.describeRoom` contributor with it (elevator readouts, shop shutters, airfield notes), which is the right home for all of them.

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

## The can

`spraycan` opens a dialog in the browser. You write the words, select letters (click one, drag a run, shift-click to extend, or leave it alone to mean the whole tag), and paint them: a colour off the **shared** wheel, plus bold, italic, underline and strike, plus a rainbow fade because it's the one effect nobody wants to do letter by letter. The preview is the honest one — it renders through the same code the room line will use, on a strip of wall.

The wheel is `client/game/js/panels/color-picker.js`, lifted whole out of the hangar paint bench so there is exactly one of them. It takes its LOOK from whoever opened it (`themeFrom` copies the host's `--hb-*` tokens onto the popover, which lives on `<body>`), which is why the bench's is brass and the can's is fluorescent green with one stylesheet.

**Style is data, never markup.** This is the rule that lets per-letter colour exist at all next to the escaping rule below. The dialog sends `{t: text, r: runs}`, never a string of tags; a run is `{n, c, f}` and nothing else, `c` has to match `/^#[0-9a-f]{6}$/` or it is dropped, and `f` is masked to four bits. So the text still arrives and is stored escaped exactly as it always was, and a room description still contains no markup anybody typed. `paint.js` is the only thing that turns a run into HTML.

The trap that shapes `paint.js`: **`esc` changes the LENGTH of the string** (`<` becomes `&lt;`) but a run counts characters the PLAYER TYPED. So the renderer never indexes the escaped text — it splits it back into one unit per original character, the same trick the chat rainbow uses. Index it naively and you slice an entity in half and put a live `<` back on the wall.

**The client decides nothing.** `sprayapply` re-asks whether there's a wall there and a can in your hand, re-validates every colour, and re-measures the length. The panel is a nicer way to say a sentence the server was always going to check.

## The shelf

Designs save to `player_sprays` (cap **12**, per player) and load back onto the can. The oldest is never silently dropped — you're told the shelf is full and you pick what goes, because auto-eviction eats the one somebody meant to keep. Save and bin both answer with the **whole fresh shelf** rather than a delta, so an open panel can't drift from the table.

A saved spray stores what you typed, unescaped, because it goes back into a text field; the wall stores it escaped. Nothing off the shelf reaches a room description without going through the same `esc` on the way in.

## Player text is HTML

The text is player-authored and lands in a stranger's room description, which the client renders as HTML. It is escaped **on the way in** and stored escaped — one place to get it wrong, and no way to double-handle it. The regress suite treats `esc` as a security boundary, not a formatting detail.

## Paint

A `spray_paint`-tagged item, one tag per can, sold at hardware shops (*Nuts to That*, ₵12 — the same counter that sells the mop and the acetone that undo it).

## Extension points
- `items.tags.spray_paint`
- `events.graffiti.tagged`

## Files
- `index.js` — the verbs, the RAM authority, the one write path (`applyTag`)
- `paint.js` — the per-letter style model and the only thing that renders it
- `client/game/js/panels/spraycan.js` — the dialog
- `client/game/js/panels/color-picker.js` — the shared wheel (also the hangar bench's)

## See also
[docs/systems-surveillance.md](../../docs/systems-surveillance.md) · [docs/systems-cleaning.md](../../docs/systems-cleaning.md)
