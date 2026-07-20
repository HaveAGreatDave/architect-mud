# Void Arrival Checkpoints — border re-entry from the void

**STATUS: PLAN, awaiting approval (2026-07-20).** Land foot-crossers at a region's *edge* and
make them walk inward through an inspected **checkpoint** to reach the city, instead of teleporting
them into the region mid-map. Extends [Overland Void Travel](../systems-overland-void-travel.md);
reuses the already-built `checkpoint` law almost wholesale.

Related: [[project_overland_void_travel]], [[project_the_reach]], [[project_wildlands_curtain]]
(the sealed city/wilds curtain), [[project_crime_police_overhaul]], [[project_jail_system]],
[docs/systems-jail.md](../systems-jail.md).

---

## The problem

`leaveCrossing` ([plugins/voidwalking/index.js:570](../../plugins/voidwalking/index.js)) drops you
**directly onto the destination tile** the instant the void's final `south` exit resolves to
`d.dest`. Today those dests are:

- **Reach** → `zone_the_reach_870_1958` — which is **Buzzard Field itself** (the airfield/hangar).
  A broke foot-crosser who *couldn't afford to fly* materialises standing on the runway. Wrong read.
- **Exodus** → `zone_exodus_waypoint` — not present in `content/` (route is still a stub).

There's no transition, no threshold, no "you made it back to civilization" beat — you blink from the
waste into the middle of a region.

## The goal

Every voidwalk arrival should:

1. Deposit you at the region's **void edge** — a perimeter tile that itself carries `flags.region_id`,
   so it's genuinely *voidwalkable* (you could strike back out from it — round trips work for free,
   since `VOIDS` is keyed by region and any region tile is porous to the void).
2. Force you to walk **inward** through a **checkpoint** before you reach the interior/city — a felt
   border crossing that matches the sealed city/wilds curtain you already established.

## The big reuse: the checkpoint already exists

The functional inspection is **already built** as a content-driven law — no new checkpoint code:

- **`checkpoint` plugin** ([plugins/checkpoint/index.js](../../plugins/checkpoint/index.js)) — one
  `registerMoveGate` driven entirely by a `flags.checkpoint_cfg` object on a gate tile. Walking onto
  the tile runs its configured checks; first block wins:
  - **`wanted`** — reads the `wanted` star flag. `hard` = flat turn-away; `bluff` = Deception check,
    difficulty climbing per star, fail → `APPREHEND`.
  - **`contraband`** — scans inventory for `raw_drug` / `contraband`-tagged items → Deception scan,
    fail → `contraband_possession` charge + `APPREHEND`.
  - **`smuggle`** — routes raw drug through the smuggle economy.
  - **Entry predicate** (`fromFlag` / `fromDistrict` / `insideFlag`) so the gate only fires on the
    *inbound* side — you're inspected walking **in**, free walking back out.
- **`APPREHEND` → the shared arrest engine → jail** already handles the "search & confiscate"
  outcome: a busted fugitive is booked into Precinct 9 Holding with gear confiscated to the evidence
  locker ([docs/systems-jail.md](../systems-jail.md)). So "functional inspection with consequences"
  needs **zero** new mechanics — just a configured tile.

This is exactly the recipe already shipped for the **South Gate** (`{ fromDistrict:"wilds",
checks:["wanted","smuggle"], wantedMode:"bluff" }`), which the design doc notes is *"a plain
checkpoint, not the void entry."* We're extending that same pattern to void arrivals.

## Design

### The two-tile inbound seam (per region)

For each destination region, author two tiles on the path from the void into the interior:

1. **Arrival edge** — a real perimeter tile, flagged `region_id: <region>` + a new `void_edge: true`
   marker. The void limb's final `south` deposits you here. Description sells the threshold:
   *"You stagger up out of the waste onto the region's ragged edge — the wall and its lights ahead."*
2. **Checkpoint** — the next tile inward, carrying `checkpoint_cfg` with `fromFlag: "void_edge"`
   (fires only when you arrive **from** the edge — inbound only). Guard cue in the description.

Movement engine change is essentially nil: `leaveCrossing` already exits onto `d.dest`; we just make
`d.dest` the **arrival-edge tile** and author the checkpoint one step further in.

> **Correctness note — this is *why* the checkpoint is a separate inward tile, not the arrival tile
> itself.** Arrival happens via an in-memory `addPlayerToZone` inside `leaveCrossing`, **not** a
> `cmdMove` — so `runMoveGates` never runs on the arrival step. A `checkpoint_cfg` placed *on* the
> arrival tile would be silently bypassed. Landing on the **edge** (no gate) and having the player
> **walk** one step into the checkpoint tile means the inbound step *is* a real `cmdMove`, so the
> move-gate fires exactly as intended. The predicate is `fromFlag: "void_edge"` (the edge tile's
> marker), so it triggers on the inbound step and stays free when you walk back out to re-cross.
> A failed check routes to `APPREHEND` → the arrest engine → jail (there is no "search-only, don't
> jail" seam today — a caught fugitive/contraband is booked, gear confiscated to the evidence locker,
> which is the intended consequence).

### The one real design tension — checkpoint law is per-region, not uniform

You picked **functional inspection** (wanted + contraband) for **every region**. That fits a *lawful*
region cleanly, but collides with the fiction of the two regions we actually have:

- **The Reach is a `lawless` contraband haven** — the whole point (per [[project_the_reach]] and the
  void-travel doc) is that it welcomes *"the wrong kind."* A police cordon that turns away fugitives
  or busts contraband on the way **in** would betray its identity — the void road exists *because*
  the Reach takes people the city won't.
- **Exodus is a renounce-faction** — their gate is about *ideology/allegiance*, not city law.

So a literal wanted+contraband bust really only makes sense **coming back into Coldwater** (the lawful
city). Recommended resolution — **keep the structure everywhere, vary the checks by the region's law:**

| Region | Checkpoint character | `checkpoint_cfg` |
|---|---|---|
| **Coldwater** (re-entry) | Real Precinct cordon — the poor smuggler's trail funnels through the law. **This is the functional inspection you want.** | `{ guards:"the border precinct", checks:["wanted","contraband"], wantedMode:"bluff", fromFlag:"void_edge" }` |
| **The Reach** | Cass Renner's people vetting *who* you are, not *what* you did — a lawless gatekeeper. Warrants/contraband are fine here. | No bust checks (flavor gate / future rep or toll), or an empty `checks:[]`. Arrival-edge + a "welcome to the Reach" beat. |
| **Exodus** | Renounce-faction vetting — ideology/rep, not law. | Themed gate; rep/ideology check later, no city-law bust. |

This honors **"every region arrival"** (the edge + checkpoint *structure* is universal) **and**
**"functional inspection"** (the real bust lives where the fiction supports it — Coldwater re-entry),
without turning the contraband haven into a police state. **This is the decision I most need you to
confirm or override.**

### "Return from voidwalk" ⇒ return routes may be net-new

Your phrasing — *"when players **return** from voidwalk … come into the city"* — points at the
**Coldwater re-entry** case as the priority. But `VOIDS` today only defines **outbound** edges
(Coldwater → Reach / Exodus). There is **no** Reach→Coldwater or Exodus→Coldwater void yet, so there's
currently no way to *walk back* at all. Making re-entry real means adding those **return void edges**
(small `VOIDS` config: `region_the_reach` / `region_exodus` each forking back to Coldwater). Worth
confirming this is in scope — it's the difference between "polish the arrival tiles" and "close the
round trip on foot."

## Build steps (once the two decisions above are settled)

1. **Content (CODEX pipeline):** author the arrival-edge + checkpoint tile pair per region. Edge gets
   `region_id` + `void_edge`; checkpoint gets `checkpoint_cfg` (per the table) + guard-cue description.
   Reach's edge replaces Buzzard Field as the foot-arrival point (Buzzard stays the *air* gate).
2. **Engine (tiny):** repoint `VOIDS[...].dests[].dest` to the new arrival-edge tiles; if return trips
   are in scope, add the return `VOIDS` entries for `region_the_reach` / `region_exodus`.
3. **Arrival prose:** tweak `leaveCrossing`'s "you stagger up onto solid ground" line to read as
   reaching the *edge*, with the city still ahead past the checkpoint.
4. **Verify:** the checkpoint's `fromFlag:"void_edge"` predicate fires inbound only (walking out to
   re-cross is free); wanted/contraband bust routes cleanly into the arrest/jail engine; lawless
   regions don't bust.
5. **Regress** (`npm run test:regress` — touches a plugin config + move seam) → **CODEX ship**. Add a
   `plugins/voidwalking/regress.js` case: arrival lands on the `void_edge` tile, and the inbound
   checkpoint predicate triggers.

## Cost / risk

- **Near-zero engine work** — the checkpoint law, arrest engine, jail confiscation, and region-edge
  porousness are all already built. This is ~90% world content + a few `VOIDS` config lines.
- **Prod content** — new tiles ship through the normal CODEX push; additive, regress-gated.
- **No hot-path cost** — the checkpoint gate only pays on a configured tile; the wanted/contraband
  reads happen once, on the single inbound step, not per move.

## Open decisions (need your call)

1. **Per-region checkpoint law** (recommended) vs. uniform wanted+contraband everywhere — the table
   above. *(This is the fiction-critical one.)*
2. **Return routes in scope?** — add Reach→Coldwater / Exodus→Coldwater void edges so re-entry on foot
   actually exists, or is this pass only about how *outbound* arrivals (into Reach/Exodus) land?
3. **Reach's gate** — pure flavor arrival-edge beat, or a real gate with a future rep/toll hook?
