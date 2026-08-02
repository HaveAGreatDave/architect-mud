# Item Facets — how a list sections itself (As Built)

*Built: 2026-08-01.* Substrate: [`server/engine/classify.js`](../../server/engine/classify.js).

A shop's shelf sections and a container's compartments are the same question — *what are
the natural groups in this pile of items?* — so they get the same answer, from one file,
with no per-shop and no per-container authoring.

Ration Nine sections into Dry Goods / Refrigerated / Frozen. A gunsmith sections into
Weapons / Armor / Materials. **Neither was configured.** That is the whole design.

---

## The three rules

### 1. Categories are derived, never authored per shop

Nothing goes into `npcs.vendor_inventory` entries, and no vendor form asks an author to
type section names. Authored sections are content you would have to maintain in forty
places, and they go stale the instant an item's tags change — the shop would still promise
a "Frozen" shelf after the last frozen thing left it.

### 2. One item has several answers, so a single category cannot work

A coat is `Apparel` on one axis, `Torso` on another, and *nothing at all* on a third. Which
answer is the right one depends entirely on what it is sitting next to. This is why the
axis is chosen **per list**, never per item and never per shop.

| axis | derived from | a grocer | a gunsmith | an outfitter | a fridge |
|---|---|---|---|---|---|
| `class` | tags + type | *all Consumables — useless* | Weapons / Armor / Materials | Apparel / Accessories | — |
| `storage` | `storage_tier`, `perishable`, `spoil_rate` | **Frozen / Refrigerated / Fresh / Preserved / Dry Goods** | *no answer* | *no answer* | Frozen / Refrigerated / Dry Goods |
| `profile` | `food_profile` / `drink_profile` | Meat / Starches / Aromatics | *no answer* | *no answer* | Meat / Dairy / Produce |
| `slot` | equip slot | *no answer* | Torso | **Head / Torso / Hands / Legs / Feet** | — |

### 3. The stock picks the axis, not the author

Every axis is scored against the actual list; the best partition wins. A grocer's stock is
uniformly `Consumables` on the class axis, so that axis scores **0** and loses, and
`storage` splits it cleanly and wins. A gunsmith is the exact reverse. A shop that changes
what it sells re-sections itself for free.

---

## Scoring

`scoreAxis(items, axis)` = `(1 − largest bucket's share) × coverage`, after four rejections.
Each rejection exists because the axis would otherwise make the list **worse than flat**:

| rejection | constant | the failure it prevents |
|---|---|---|
| answers for < 60% of the list | `MIN_COVERAGE` | most items dumped in `Other` |
| < 2 or > 6 buckets | `MAX_BUCKETS` | no split, or a wall of headers |
| one bucket holds > 85% | `MAX_DOMINANCE` | the Ration Nine "everything is Consumables" case |
| average bucket thinner than 1.5 | — | a header per item |

Plus two floors: a list shorter than `MIN_ITEMS_TO_GROUP` (6) is **never** sectioned, and
the winner must beat `MIN_SCORE`. **A list that doesn't partition usefully stays flat** —
that is a success, not a fallback.

### The override

`flags.shop_axis` on a vendor NPC forces an axis. It is honoured whenever the axis **splits
at all** (`canSplit`) — a deliberately looser bar than auto-selection, because the quality
heuristics exist to stop the *automatic* choice going wrong, and an author naming an axis
has already made that judgement. An axis that splits nothing is still refused: one section
named after the whole shelf is never what anybody meant.

It is the escape hatch for when the scorer picks something daft. **It is not the intended
route**, and reaching for it on every shop means the scoring needs fixing instead.

---

## `storage_tier` — the one authored tag

Everything on the storage axis is derived from `perishable` + `spoil_rate`, except one
thing: **nothing in an item's tags can tell you a fish fillet is sold frozen rather than
fresh.** So `storage_tier` (`dry` | `refrigerated` | `frozen`) is a class tag that
overrides the derivation, and **Frozen can only ever come from it**.

It is purely presentational. It decides nothing about spoilage — that remains
`perishable` + `spoil_rate`'s job, and the two are independent on purpose.

Derivation when unset:

| tags | facet |
|---|---|
| `perishable` + `spoil_rate: fast` | Refrigerated |
| `perishable` + `spoil_rate: normal`/unset | Fresh |
| `perishable` + `spoil_rate: slow` | Preserved |
| `food_profile` or `consumable`, not perishable | Dry Goods |
| anything else | **null** — off this axis entirely |

That last row matters: a hardware store's stock gets *no* storage answer rather than being
filed wholesale under "Dry Goods", which is what keeps the axis from winning where it
shouldn't.

---

## The wire contract

**The server decides everything and sends the list already in section order.** Each entry
carries a `group` string; the client starts a new section wherever `group` changes. The
client is told nothing about axes — it couldn't work one out anyway, since it doesn't have
the tags.

Two consequences worth holding on to:

- **A flat list leaves `group` unset on every entry**, so every ungrouped surface renders
  byte-identically to how it did before this existed.
- **Client-side sorting must stay inside a section.** Sorting across sections dissolves
  them, and is the obvious way to break this. See `sectionItems` in
  [`dialogue.js`](../../client/game/js/panels/dialogue.js).

The stock is an **array**, which is why the axis isn't attached to it — a property on an
array is silently dropped by `JSON.stringify`. Section order comes from the sequence itself.

---

## Where it's wired

| surface | call site |
|---|---|
| NPC shop — Buy | `getVendorStock` ([vendor.js](../../server/engine/vendor.js)) |
| NPC shop — Sell | `getSellableInventory` (same file; axis chosen from what you're *carrying*, so it needn't agree with the shelf) |
| Player storefront board | `waresBoard` ([storefront/index.js](../../plugins/storefront/index.js)) |
| `look in <container>` (text) | `describeContainer` ([commands/inventory.js](../../server/engine/commands/inventory.js)) |
| Container panel | `loadBoxContents` (same file) |
| `put/stow/pull/drop all <category>` | `matchAllFilter` (same file) — the facet labels double as the **typed vocabulary** |

A player who has just read **Frozen** over a row of items can type `put all frozen in the
freezer`. That is the point of listing this here: the section headings are not decoration,
they are the words the bulk commands accept, so a new profile or a new axis becomes
typeable the day it is authored and no category list is maintained anywhere. `matchAllFilter`
tries a **tag or type name** first (`utensils`, `perishables` — tags that exist precisely to
be swept), then these **facet labels**, then a short alias table for the words English has
and the data doesn't (`non-perishable`, `cookware`, `food`, `drinks`). Everything is compared
through one normaliser, so plurals and capitals never have to be guessed.

Section headers use the axis's **declared** order where it has one — a fridge reads cold →
ambient, not alphabetically — then anything unlisted alphabetically, then `Other` **always
last**, because it is the bucket for things that didn't fit and nothing that didn't fit
belongs at the top.

---

## The room's furniture line (same doctrine, different pile)

A `furniture` row has no `tags`, so none of the axis machinery above applies to it — but the
question is identical, so the answer lives in the same file: `furnitureFacet` /
`sectionFurniture` in [classify.js](../../server/engine/classify.js), called once from
`describeZone` ([commands/describe.js](../../server/engine/commands/describe.js)).

**Derived, never authored, is the whole of it.** There is no `area` field on furniture and
there must not be one: *Kitchen* is a place, and the same stove-and-cold-box cluster turns up
in a bar galley, a diner and a squat. The row's `object_type` plus the flags the owning
systems already stamp on it (`stove_tier`, `preserves`, `brew_tier`, `broadcast_receiver`,
`container`, `water_source`, `atm`…) are enough, and they stay true when a piece is moved.

Seven buckets, in this fixed print order: **Appliances, Storage, Media, Terminals, Plumbing,
Lighting, Furnishings**. **Lighting is the rare one and is expected to stay empty**:
`isSceneryPiece` sends every light to the room *prose* ("the ceiling wash is lit"), so a light
only reaches this list when it is flagged `notable`, or in the dark — and a dark room's list
is lights and nothing else, which the dominance rejection below keeps flat. The bucket exists
so that the one room with two notable fixtures doesn't file them under Furnishings. Precedence is the order the tests are written in, and the first two
lines are the ones that matter — a fridge is a container that is *also* an appliance, a
television is furniture that is *also* a set, and whichever bucket a player would name first
wins. `Furnishings` is the trailing bucket, named for what's actually in it (beds, seating,
tables) rather than `Other`, because here the remainder is a real category.

**Four rejections, and a flat line is the common — successful — answer.** Most rooms hold
four things:

| rejection | why |
|---|---|
| fewer than `MIN_FURNITURE_TO_SECTION` (8) standing pieces | a room that wasn't hard to read gains only labels |
| fewer than two sections with ≥2 members | a flat list wearing a hat |
| one section holds everything | the flat list, plus a line |
| the `Furnishings` remainder is more than half | the axis didn't answer for this room |

The sections **replace** the single `Furniture:` label rather than joining it — labelling the
remainder "Furniture" underneath a heading that already said Furniture is exactly the mush
this exists to fix. Rendering is a two-column CSS grid (`.room-furn-secs`, `13ch 1fr`) rather
than padded spaces, because the label column has to hold when a long section **wraps**; `ch`
is exact because the pane is monospace. Grid children are emitted with **no whitespace
between them** — `#area-content` is `white-space: pre-wrap`, so a newline between two grid
items is a text node that becomes a third grid item and shunts the row a column right.

Nothing about a link changes between the two shapes: `data-target`, tints, the smart-bar
verb list and the morph attribute are identical, so **targeting is untouched** — this decides
only which line a piece prints on.

---

## Contracts

- **Sync and query-free.** Everything here reads an already-hydrated item's `tags`/`type`
  and nothing else. It is called from the shop stock builder and from container rendering;
  it must never become a reason to touch the DB.
- **Nothing is ever lost.** Items an axis can't answer for go to one trailing `Other`
  bucket — never dropped, never scattered. A section list that quietly loses items is worse
  than no sections, and it is the hardest bug here to notice by eye. Regress asserts it.
- **`vendorCategory()` is not gone.** The examine pane still wants a singular label
  ("Weapon", not "Weapons"), so it depluralises `classFacet` rather than keeping a second
  copy of the rules that would drift.

## Deliberately separate

- **`shelf`** (`back_room`, `min_trust` on a catalogue entry) is **access gating**, not
  display grouping. A section header and a locked shelf are different questions and must
  not be conflated.
- **`wanted`** (the cooking shopping-list mark, set through the `shop.stock` hook) is a
  per-player overlay. A wanted item is marked **wherever it lands** and is never collected
  into a "Wanted" section of its own — sectioning runs *after* the hook so a handler that
  adds entries is sectioned with the rest.
