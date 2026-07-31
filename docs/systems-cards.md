# Procedural Trading Cards — the PORTRAIT renderer (still unwired)

> **⚠ ADOPTION DECIDED 2026-07-30 — but not this way.** Trading cards **shipped**, as
> [`plugins/cards/`](../plugins/cards/README.md); the design and rationale are in
> [proposals/trading-cards.md](proposals/trading-cards.md), which is now the authoritative doc for
> the card system. What shipped is the **text face**: prose, budgets, spoken condition. This file
> describes the **portrait face**, which is still exactly what it was — a complete, self-contained
> canvas renderer that **nothing loads**. It was not dropped and it was not adopted; it is a second
> face the card view could grow, and an enemy card can never use it (there is no silhouette for a
> rot-hound). Everything below remains accurate about the renderer itself. The "Integration
> roadmap" section at the bottom is **superseded** — read the proposal instead.
>
> **Original status header, kept for context — PROTOTYPE, not a committed feature (2026-07-27).**
> The renderer exists and works;
> **whether the game ships trading cards at all is an open question that has not been decided.**
> Nothing downstream should assume this is coming. Do not file the missing mint verb, storage or UI
> as debt, plan work that depends on cards existing, or count this toward the roadmap — it is a spike
> that earned its keep by proving the approach is cheap, and it is parked at exactly that.
>
> **What exists** (built 2026-07-13): [client/game/js/card-render.js](../client/game/js/card-render.js),
> a complete, self-contained portrait renderer with a ~30-archetype drawer library covering all
> equippable slots on **both** Vitruvian silhouettes. It is **not wired into the client** (nothing loads
> it), and there is **no mint verb, storage, or card UI** — by choice, pending the adopt/drop call.
>
> **If adopted**, the rest of this doc is the authoritative spec and the agreed integration plan.
> **If dropped**, the renderer is one self-contained file to delete and nothing else unwinds — which
> was the point of building it this way.

A trading card is a **snapshot of a character** — their body type plus the gear they had equipped at mint
time — rendered as per-piece vector art on a body silhouette, framed with a tier/rarity treatment and a
stat block. The whole point of the approach: a card is **deterministic**, so it is stored as a tiny spec
(`{body, item ids, seed}`) and **re-rendered identically on any client** — never a stored image blob. That
keeps it asset-light and fits the no-build/content-in-git ethos.

## The one idea

**Each equipped item draws its own shape.** There is no per-item art. An item's `slot` + name classify it
into one of ~30 **archetypes** (`helmetDome`, `plateCarrier`, `longGun`, `boot`, …); each archetype is a
canvas drawing function that renders that shape anchored to the figure and tinted by the item's **tier**
(derived from value + armor). So "SEKURITY tee", "flannel work shirt", and "grim reaper tee" all resolve
to the `tee` drawer with different tints — **cost scales with distinct shapes (~30), not item count (109)**.

## Files

| File | Role |
|---|---|
| [client/game/js/card-render.js](../client/game/js/card-render.js) | The whole renderer: mask loading, anchors, classifier, tier/palette, the ~30 archetype drawers, `renderPortrait`. Exposes `window.CardRender`. |
| `client/game/assets/paperdoll-mask.png` | **Male** silhouette, 242×540, shape in the **alpha** channel (white-on-transparent). Already used by the Kit app paperdoll. |
| `client/game/assets/femsil.png` | **Female** silhouette, 500×708, Vitruvian, shape in the **alpha** channel (this is the file formerly named `femsil2.png`). The module's default path is `/assets/femsil.png`. |
| `data/femsil.png` | Rejected first female silhouette (arms-down pose, black-on-white). Kept for reference; **not used**. Note the name collision — the *used* female mask is the one under `client/game/assets/`. |

## The silhouette / mask model

Both bodies are **Vitruvian** (arms spread, hands out) so drawers share one layout. The shape lives in the
PNG's **alpha** channel. `loadMasks()` normalizes each source into a white-on-transparent mask canvas
(`buildMask`): for `mode:'alpha'` it keeps the alpha; for `mode:'luma'` (a black-on-white raster like the
rejected `data/femsil.png`) it derives alpha from darkness. The mask is cached per body.

The figure is painted by masking, not by drawing an outline:

1. `drawImage(mask)` lays down the silhouette's alpha.
2. `source-in` fills it with the **chrome-body** gradient.
3. `source-atop` adds the **dual neon rim-light** (cyan from the left, teal from the right) and scanlines.
4. `source-over` draws each equipped **piece** on top, back-to-front by z-order (weapon last).

Everything up to step 4 is the "body"; step 4 is the loadout.

### Anchors — the per-body geometry

Drawers never hardcode pixels. They read `ANCHORS[body]` — head/neck/shoulders/chest/waist/hands/hip/legs/feet
points plus `weaponHand` and `torsoTop/Bot`, in that mask's own pixel space — and `metrics(A)` derives
`unit` (scales line-weights and small detail), `shoulderSpan`, `hipW`, `torsoH`, `legLen`. Because sizes are
expressed relative to these (a helmet is `headR * 2.1` wide, not `54px`), **one drawer fits both figures**
despite 242×540 vs 500×708.

Anchors were **decoded from the masks**, not guessed — a Node script inflates the PNG's IDAT, unfilters the
scanlines, and prints the per-row alpha bounds (`x lo..hi`, width, center) every N rows. From that trace you
read off head top/width, shoulder span, where the arms spread (widest row = hands), where legs begin, and the
foot splay. The male table is well-tuned (it matches the shipped Gear paperdoll); **the female table is a
first pass from the outline and is the most likely thing to need nudging** once rendered — see Refinement.

> To re-derive anchors for a new/updated silhouette, reuse the decode approach in the session that built
> this (inflate IDAT → unfilter → per-row alpha bounds). Keep drawers in the mask's native pixel space.

## Archetypes & the classifier

`classify(item)` returns `{ archetype, z, palette }`:

- **slot → rule list.** Each slot (`head`/`torso`/`legs`/`feet`/`hands`/`weapon_hand`/`accessory`) has an
  ordered `[regex, archetype]` table matched against the item name; first hit wins, else a slot default.
  E.g. torso `/kevlar|vest|plate|carrier|riot/` → `plateCarrier`, `/coat|jacket|shellcoat|hoodie/` →
  `jacket`, default `tee`.
- **z-order** = `SLOT_Z[slot]` + a layer nudge (`under` −2, `armor` +2) so an armor coat sits over an
  undershirt and the weapon (z 40) is always on top.
- **palette** from `paletteFor` (below).

The ~30 archetypes, by slot:

| Slot | Archetypes (hero pieces **bold**) |
|---|---|
| Head | **helmetDome**, **hood**, cap, brimHat, hair |
| Torso | **plateCarrier**, **jacket**, tee, undershirt, minimalTop, jumpsuit |
| Legs | trouser, shorts, briefs |
| Feet | **boot**, sneaker, sandal |
| Hands | **gauntlet**, glove, rings |
| Weapon | **longGun**, **pistol**, **blade**, **blunt**, baton |
| Accessory | **faceMask**, neck, wrist, pack, tattoo |

`tattoo` intentionally draws nothing (skin-level). `jumpsuit` composes `tee` + `trouser` with a seam so a
one-piece reads as one garment. Weapon drawers are **pose-aware** via `weaponFrame` (pivot at `weaponHand`);
today both bodies are `spread`, so a long gun is held across the body.

### Tiers & palettes

`tierIndex(value, armor)` → 0–4 (`common`/`uncommon`/`rare`/`epic`/`legendary`) from item **value**, bumped
up for real **armor** (armor ≥3 is at least rare). `TIERS` holds each tier's edge/glow color. `paletteFor`
picks a **material** base — gunmetal for weapons/armor (name/archetype matches a metal regex), otherwise a
cloth color hashed from the item id (so different shirts differ) — and layers the tier's edge color as the
accent/rim. `deriveCard(items)` rolls the loadout up into `{ tier, tierName, color, power }` for the card
header (rarity chip, frame color, Power number).

## Public API (`window.CardRender`)

```js
await CardRender.loadMasks();                 // once; defaults to /assets/*.png. Override src per body.
const k   = CardRender.classify(item);        // { archetype, z, palette } | null (unslotted)
const roll= CardRender.deriveCard(items);     // { tier, tierName, color, power }
CardRender.renderPortrait(canvas, {           // draws the figure into a sized <canvas>
  body:  'male' | 'female',
  items: [ {id,name,value,tags:{slot,armor,layer}}, ... ],  // equipped only
  seed:  '3C1E·9AF7',                          // reserved for future generative variation
});
// also: ARCHETYPES (name→drawer), ANCHORS, MASKS, metrics()
```

`renderPortrait` sizes to the canvas's CSS box × DPR, fits the figure by height with a small bottom bias,
paints a ground shadow, builds the figure on an offscreen, and composites. The **card chrome** (frame,
header, stat block, rarity chip, rain/haze) is **HTML/CSS around the canvas**, not the renderer's job — this
matches how the client already builds DOM panels with a canvas centerpiece (see the Kit app).

The item shape the renderer needs is the **equipped-item shape the game already has**: `id`, `name`, `value`,
`tags.slot`, `tags.armor`, `tags.layer`. See [docs/items.md](items.md).

## Extending — the refine loop

**Add an item:** usually nothing to do. If its name doesn't match an existing rule it falls to the slot
default (e.g. any unrecognized torso → `tee`) and still renders. To give it a better shape, add one `[regex,
archetype]` entry to that slot's rule list.

**Add an archetype:** write `ARCHETYPES.myShape = (c, A, M, P, item) => { … }` in mask space (use `A` anchors,
size off `M` metrics, stroke with `edge(c,P,u)`), then add a rule that points at it. It renders on both
bodies automatically. Add it to the demo's catalogue to eyeball both silhouettes.

**Tune the female figure (most likely first task):** all female geometry is the constants in
`ANCHORS.female`. If a piece sits high/low/off-center, nudge that anchor — e.g. the weapon pivot is
`weaponHand`, foot spread is `footL/footR.cx`, torso box is `torsoTop/torsoBot`. No drawer changes needed.

**Hero detail vs. long tail:** hero drawers (weapons, coats, helmets, boots, masks) carry seams/shading/glints;
common clothing stays flat. That split is deliberate — spend polish where players look.

## Integration roadmap (NOT built)

The renderer is the hard, self-contained part. Wiring it into Architect is a separate step with real product
decisions still open:

1. **Mint.** A verb (e.g. `mint` / `card`) that snapshots the player's `body` + equipped item ids into a card
   record. Decide: snapshot-frozen (collectible "who you were") vs. live-tracking. **Frozen is simpler and more
   collectible** — recommended.
2. **Storage.** Persist the **spec, not an image**: `{ owner, body, item_ids[], seed, minted_at, tier, power }`
   in its own feature table (never new `players` columns — see [architecture.md](architecture.md) persistence
   tiers). Re-render on demand.
3. **Card UI.** A client view that lays out the HTML/CSS chrome around `renderPortrait` (the demo is a working
   reference for the chrome). Likely a tablet app or a `look`-at-card overlay.
4. **Economy hooks (optional).** Mint fee; trade cards via the existing [trade](systems-economy.md) plugin;
   gossip/among-players rarity. Because rarity is **gear-derived**, chasing an impressive loadout to mint a
   better card is a natural flex loop — the thing a pure-text card can't buy.
5. **Body source.** Which silhouette a card uses comes from the character's sex/body flag (see
   [npc-clothing.md](npc-clothing.md), `npc-sex.js`); confirm the player-side field before minting.

Follow the [plugin-builder](../.claude/skills) path when you build this — the card system is a **plugin**
(new verb + storage + UI), not engine, and content (the items) already lives in git.

## Why deterministic (the load-bearing decision)

Storing the recipe instead of the picture is what makes this cheap and on-brand: no blob storage/CDN, no
per-mint cost, cards survive re-render after any art upgrade, and a card is a normal git-friendly data row.
The tradeoff is an honest ceiling — procedural vector shapes read as a **clean, consistent kit**, not painted
illustration. If you ever want painterly art you'd trade determinism for generated images; the whole design
above assumes you don't.
