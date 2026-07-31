# smuggle — raw-drug supply loop (Phase 2)

The city's chem labs cook drugs from **raw material + a reagent** (see
`scripts/add-raw-supply.js`, Phase 1). Raw isn't sold over any counter — you
have to source it off the black market, through a **fence**, and sneak it in.

## The loop

1. **Earn the intro.** Deal with the covert **Fixer** (`npc_the_fixer`) until you
   reach his **inner circle** (max trust). He names the fence and sets the
   `dealer_inner_circle` flag — the vouch that opens the back room. *(Street
   dealing is the on-ramp to manufacturing.)*
2. **Order off the back-room shelf.** `talk` to **Sully** (`npc_barkeep`, the Pigeon
   Bar). Once vouched, a quiet option opens his **back room** — the ordinary GUI shop
   panel, pointed at a **named shelf**. Pick a raw, set the crate count on the
   stepper. The list is **trust-gated**: he carries `trust_flag: 'bm_trust'` and a
   `min_trust` per entry, so hard, high-`cook_tier` precursors simply aren't on the
   shelf until your standing is high enough (his old tiers, unchanged —
   `{1:0, 2:2, 3:4, 4:7, 5:10}`).
   - His **bar list is the front counter** (entries with no `shelf`) and never shows
     contraband; the back room is reachable only through the `OPEN_SHOP` that names
     it, and `buyFromVendor` re-checks the shelf, so a bar patron can't buy precursor
     by item id.
   - **`trust_per_buy` is 0.** Standing is earned running crates through a gate
     (step 4), never by paying.
   - This **replaced a generated dialogue fan-out** — one node per raw plus three
     quantity nodes under each (~22 nodes), authored by `add-blackmarket-fence.js`,
     which existed only to collect "which raw" and "how many". A shop panel already
     is an item list and a quantity stepper.
   - `PLACE_SMUGGLE_ORDER` still exists for any tree authored the old way, but the
     shelf is the live path.
   Delivery is claimed by the engine's **purchase-delivery seam**
   (`registerPurchaseDelivery('mule_counter', …)`): the vendor takes the money, and
   the handler books the `smuggle_orders` row **inside the same transaction** instead
   of putting anything in your pockets. A crate is not handed across a bar.
3. **Retrieve.** After ~3 minutes a **MULE drone** drops a **cipher-locked crate**
   (`item_mule_crate`) at **the Scald** (`zone_waste_scald`, a lawless Redline
   airstrip). Travel out, `get` it (only the buyer can — it's owner-locked), and
   **`unpack`** it to transfer the raw. Standing is **not** earned here — the safe
   pickup doesn't count.
4. **Smuggle in.** The wilderness funnels into the city through **one** scanned
   gate: **Old Coldwater** (`zone_ruins`, `flags.checkpoint` — the two bypass
   crossings are severed by `build-smuggle-funnel.js`). Carrying raw in runs a
   **Deception** check at difficulty `3 + cook_tier`:
   - **Pass** → through clean, and *this* is where you earn standing: `bm_trust`
     rises by the raw's **tier** (tier-1 → +1 … tier-5 → +5), once per ~2-min
     cooldown so back-and-forth can't farm it. Higher-tier runs build faster.
   - **Fail** → **WANTED_RAISE** for *Manufacturing*, bounced back, ~45s guard-heat.
     You keep the raw — seizure only happens the normal way if the heat lands you in
     a cell (jail plugin).
5. **Cook + sell.** Cook the raw (+ a reagent) at a lab. Sell finished product to a
   **`drug_buyer`** (the Fixer or Sully) for `0.7 × value × potency` — an underworld
   premium that scales with your Chemistry: a strong batch profits, a botch doesn't.

## Smuggler's notes

- **Bags beat glances, not scanners.** A street camera / cop (surveillance
  `rawAmong`) can't see raw stashed in a container — only raw in your hands. The
  checkpoint scanner sees bagged raw too.
- **Don't haul a sealed crate through the border.** The crate is tagged `raw_drug`
  at `cook_tier 5`, so smuggling it whole is the *hardest* possible sneak. Unpack
  at the Scald and carry the (usually lower-tier) loose raw instead.

## Data / wiring

- **`smuggle_orders`** table (`server/models/schema.js`) — persists orders
  (`deliver_at`, `status`, `vendor_id`); restart just delays a drop by ≤ one tick.
- **1-minute delivery tick** lands due drops (spawns the crate) and pings the buyer.
- **`PLACE_SMUGGLE_ORDER`** action (`registerAction`) — the dialogue order seam.
- **`unpack`** specialized action (tag `mule_crate`) — pickup + trust.
- **Checkpoint move gate** (`smuggle:checkpoint`) — fires only on `flags.checkpoint`
  zones. Content: `scripts/add-smuggle-checkpoints.js`.
- **Fence + tip:** `scripts/add-blackmarket-fence.js` creates the crate item, wires
  the Fixer's inner-circle tip (`flags.inner_circle_line`, read by engine
  `vendor.js`), and generates Sully's trust-gated dialogue branch from the live raw
  items. Re-run it whenever the drug roster changes.

## Activate

1. `npm run db:schema` — `smuggle_orders` (+ `vendor_id`).
2. `node scripts/add-raw-supply.js` — raw items + dual-use reagents + cook recipes.
3. `node scripts/add-reagent-supply.js` — stock the reagents at open vendors *(after 2)*.
4. `node scripts/add-blackmarket-fence.js` — crate item, Fixer tip + `drug_buyer`,
   Sully's branch + `drug_buyer` *(after 2; hard-fails if raw items are missing)*.
5. `node scripts/build-smuggle-funnel.js` — sever the two bypass crossings + flag
   Old Coldwater as the checkpoint *(`--dry` to preview; refuses to strand zones)*.
6. Restart / world-reload the server.

*(The old `add-smuggle-checkpoints.js` is gone — it flagged the wrong zone. Use
`build-smuggle-funnel.js`.)*
