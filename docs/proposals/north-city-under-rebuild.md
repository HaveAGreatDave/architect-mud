# Rebuild: North City (Government Sector) + The Under

> **Status: the Under is BUILT; North City is not** (restamped 2026-08-30 against the
> world). The two halves of this doc had opposite fates and one status line was
> hiding that.
>
> **The Under shipped** — **337** zones sit at `grid_z < 0`. It was reframed on
> 2026-07-12 as a municipal sewer layer rather than the retired `z-1` level this
> doc specifies, so read [the-under.md](the-under.md) for what actually exists;
> the spec below describes a thing that was built differently.
>
> **North City is SUPERSEDED, not outstanding** (corrected 2026-08-31 — the restamp
> a day earlier filed it as live work, which was wrong). The city runs **west–east**,
> not north–south, and the quarter this doc calls North City — the government zone —
> is now the **western edge**: the Spire, the Ascension Gate, the Architect Shrine,
> the Chrome Clinic, the Vats and Halcyon Boulevard. It exists. It is not missing.
> Nobody should build it again.
>
> ⚠ **What IS owed there is development, not construction.** The western edge is
> thin — it is the Ascendants' and Halcyon's end of the basin and wants more in it —
> but that is authoring on top of ground that already exists, and it is a different
> job from the rebuild specified below.
>
> ⚠ **The `northcity` district row is a naming problem, not a dead one.** Its
> authored fiction — *"money lives up here, behind glass and clean air"*, the
> filtered air, the fountain nobody may drink, the climate curtain breathing
> scentless money — is a better description of that western edge than `government`'s
> toner and old marble, which describes a civil-service quarter the city no longer
> has. The tiles took `government` in the 2026-08-30 repair; the prose that fits them
> is sitting unused on `northcity` under a name that is now geographically false.
> ⚠ It also carries the prefix `up`, so a future `zone_upper_*` would silently
> classify as North City — the same shape as the `util` → Media District bug.
>
> Original framing: design blueprint for recreating, inside the
> generated `bp_district`, the North City government quarter and the `z-1` Under
> that were retired with the legacy overworld (see
> [legacy-world-decommission.md](legacy-world-decommission.md)). This is the
> concrete spec for the standing task "Gov/North-City/Under district rebuild."
>
> **Why this exists:** the "salvage + abandon" decommission strips the old
> `map_world` overworld. North City + the gov enclave + The Under live *only*
> there and have no district equivalent, so they're being **abandoned now** and
> rebuilt **later** from this doc — rather than blocking the deletion on a
> district-sized content build.

---

## What it is (design intent — hold this on rebuild)

The **NW elite/government quarter**: glossy high-rises (North City), the ministries
and courts (the government enclave), and the spire approach (Uptown), all sitting
above the docks and turning their backs on them. The fantasy is *a walled-off seat
of power you're not welcome in* — sealed to exactly **two ways in**:

1. **The Steps** — the front stair, a security checkpoint (govgate). Wanted players
   are turned away; a contraband scanner (Deception check) busts smugglers.
2. **The Under** — a `z-1` tunnel network, deliberately **unguarded**: the
   smuggler's covert bypass around the checkpoint. This asymmetry (front door
   policed, back door open-but-hidden) is the whole point — don't rebuild one
   without the other.

The quarter is currently **unpopulated atmospheric shells** — zero NPCs home or
work there (confirmed at decommission). So the rebuild is *geometry + flags +
govgate*, not an NPC roster port.

---

## Zone inventory to recreate (36 zones)

The authored descriptions/ambience for every zone below are **preserved in git
history** — until Phase 6 deletes the files, and after that via
`git show <pre-deletion-commit>:content/zones/<id>.json`. Pull the prose from there
rather than re-writing it.

**Government enclave (8)** — `gov_enclave` flag; ministries/courts:
`zone_gov_assembly` (The Assembly, artery), `zone_gov_ministry` (Ministry Row, artery),
`zone_gov_prefect` (Prefect Plaza, artery), `zone_gov_registry` (Registry Hall),
`zone_gov_cobalt` (Cobalt Court), `zone_gov_onyx` (Onyx Row),
`zone_gov_vantage` (Vantage Row), `zone_gov_mezzanine` (The Mezzanine — **Under access**).

**North City (17)** — the high-rise district (most are arteries):
`zone_nc_datum` (Datum Court, enclave), `zone_nc_halcyon` (Halcyon Heights, enclave),
`zone_nc_sable` (Sable Court, enclave), `zone_nc_skyline` (Skyline Walk, enclave),
`zone_nc_spindle` (The Spindle, enclave), `zone_nc_beacon`, `zone_nc_bourse`,
`zone_nc_chancery`, `zone_nc_concordat`, `zone_nc_consulate`, `zone_nc_glass`,
`zone_nc_highwater`, `zone_nc_ivory`, `zone_nc_manifold`, `zone_nc_meridianheights`,
`zone_nc_palisade`, `zone_nc_tessellate`.

**Uptown (6)** — the spire approach:
`zone_up_vellum` (Vellum Court — **The Steps checkpoint**, enclave),
`zone_up_gate` (Uptown Gate), `zone_up_approach` (Spire Approach),
`zone_up_skyway` (Skyway Landing, artery), `zone_up_chrome` (Chrome Heights),
`zone_up_aid` (Aid Station).

**The Under — `z-1` (5):**
- `zone_tunnels` (The Under) — `up` → the Sprawl (`zone_slums` today)
- `zone_under_landing` (North Landing) — `up` → `zone_gov_mezzanine` (the covert gov bypass), `south` → deep
- `zone_under_deep` (Deep Passage) — spine between landing and commons
- `zone_under_commons` (Commons Stair) — `up` → Civic Commons (`zone_civ_commons`)
- `zone_surveillance_market` (The Blindspot) — a `z-1` market under `zone_media_plaza`; SPECTER surveillance gear fence

**The Under has three surface mouths** (Sprawl / gov Mezzanine / Civic Commons) plus
the Blindspot under the plaza. On rebuild, wire the equivalent district surface
tiles to a fresh `z-1` map the same way.

---

## The govgate contract (how it wakes back up)

`plugins/govgate/index.js` is **kept intact but dormant** — it's a `registerMoveGate`
law with no verbs, keyed purely off zone flags, so it needs **no code change** to
revive. To reactivate on the rebuilt quarter:

1. Flag the enclave tiles with **`gov_enclave: true`** (every gov/enclave zone above).
2. Flag the single **checkpoint** tile (the rebuilt Vellum Court / The Steps) with
   **`gov_checkpoint: true`**.
3. Leave The Under tiles **unflagged** — that's the intentional unguarded bypass.

govgate then fires on entering the `gov_checkpoint` tile from outside the enclave:
wanted → hard turn-away; contraband → Deception check (`SCAN_DIFF = 7`) → pass, or
`contraband_possession` charge + APPREHEND. (`scripts/add-gov-checkpoint.js` was the
original flag-stamping one-shot; a new equivalent or a dev-panel edit does the job.)

**At decommission the `gov_checkpoint` flag was removed from `zone_up_vellum`**, which
is what put govgate to sleep — re-adding it (on the rebuilt tile) is all it takes.

---

## Rebuild guidance

- **Placement:** the NW of the district, mirroring the original NW enclave, above the
  waterfront — so it still reads as *the quarter looking down on the docks*.
- **Scope:** ~31 surface tiles + a ~5-tile `z-1` Under child map. A single content
  wave (comparable to the Marquee or Coldwater Expansion passes).
- **Order:** surface enclave + North City first (playable), then the `z-1` Under +
  Blindspot, then re-flag govgate, then (optionally) populate with NPCs — it shipped
  unpopulated before, so NPCs are a genuine addition, not a port.
- **Source of truth for prose:** git history of `content/zones/zone_{nc,gov,up,under}_*`
  and `zone_tunnels`/`zone_surveillance_market`.

## Cross-references
- [legacy-world-decommission.md](legacy-world-decommission.md) — the decommission this defers out of.
- [roadmap-world-expansion.md](../roadmap-world-expansion.md) — §5 lists the Undercity + data-center as landmark goals this feeds.
