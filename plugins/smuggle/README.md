# smuggle — raw-drug supply loop (Phase 2)

The city's chem labs cook drugs from **raw material + a reagent** (see
`scripts/add-raw-supply.js`, Phase 1). Raw isn't sold over any counter — you
have to source it off the black market, through a **fence**, and sneak it in.

## The loop

1. **Earn the intro.** Deal with the covert **Fixer** (`npc_the_fixer`) until you
   reach his **inner circle** (max trust). He names the fence and sets the
   `dealer_inner_circle` flag — the vouch that opens the back room. *(Street
   dealing is the on-ramp to manufacturing.)*
2. **Order through dialogue.** `talk` to **Sully** (`npc_barkeep`, the Pigeon Bar).
   Once vouched, a quiet option opens his **back-room list**: pick a raw, then how
   many crates. The list is **trust-gated** — hard, high-`cook_tier` precursors
   only appear once your standing with him (`bm_trust`) is high enough. Placing an
   order fires the `PLACE_SMUGGLE_ORDER` action (debits credits; if you're short,
   the conversation drops to a "come back with cash" node and nothing is charged).
3. **Retrieve.** After ~3 minutes a **MULE drone** drops a **cipher-locked crate**
   (`item_mule_crate`) at **the Scald** (`zone_waste_scald`, a lawless Redline
   airstrip). Travel out, `get` it, and **`unpack`** it. Only the buyer can open it.
   Unpacking transfers the raw and **bumps your standing** (`bm_trust +1`) — the
   "order **and** pickup" that widens the menu next time.
4. **Smuggle in.** Carry the raw back past a **checkpoint** (any `flags.checkpoint`
   zone, e.g. the Civic Steps). A scanner runs a **Deception** check at difficulty
   `3 + cook_tier`:
   - **Pass** → through clean.
   - **Fail** → **WANTED_RAISE** for *Manufacturing*, bounced back, ~45s guard-heat
     (no instant re-try). You keep the raw — seizure only happens the normal way if
     the heat lands you in a cell (jail plugin).

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
2. `node scripts/add-raw-supply.js` — raw items + reagents + cook recipes (Phase 1).
3. `node scripts/add-smuggle-checkpoints.js` — flag the checkpoint zone(s).
4. `node scripts/add-blackmarket-fence.js` — crate item, Fixer tip, Sully's branch
   *(run after step 2 so the raw items exist)*.
5. Restart the server.
