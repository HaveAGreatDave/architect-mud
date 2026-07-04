# Whole-Map Interior Pass — Proposal & Phased Build Plan

**Status:** SCOPED 2026-07-03, not built. Build order: **after [The Under](the-under.md)**.

The coldwater expansion built a legible 220-tile surface but left the new districts as **facades** — only
3 of ~178 new tiles are enterable. A MUD lives in its rooms; this project turns the flat plane into a
place you go *into*. Broad coverage (2–4 enterable buildings per district), full multi-floor depth where
it fits, wired into the existing power/blackout, vendor, furniture, safe, and housing systems.

## Locked design decisions
| Decision | Choice |
|---|---|
| Coverage | **Broad pass** — 2–4 enterable buildings per district (~50+ interiors) |
| Depth | **Full multi-floor where it fits** (main floor + back rooms + upper floors + z-1 basement) |
| Vendors | **Vendor inside + a tout/barker on the street** — shop is inhabited, street stays alive |
| Power | **Yes** — z-1 utility rooms + junction boxes; interiors go dark in blackouts like the core |
| Apartments | **Yes** — ownable units in **North City + Docks** (dedicated housing phase) |
| Phasing | **By district** (each phase a coherent, shippable slice) |

## The model (how interiors already work — reuse it)
- An interior is a self-contained mini-map `map_int_<name>` with floors on its own grid_z; each floor
  is a zone with `flags.is_interior: true` and `parent_zone` → the facade.
- The facade (surface tile) gains an `in` exit → the interior ground floor; the interior's ground floor
  has `out` → the facade. Floors connect by `up`/`down`.
- **Power contract:** core buildings carry a z-1 **utility room holding a junction box**; the
  generator/blackout system depends on it. New multi-floor buildings replicate this (utility room +
  box) so outages reach them — consistent with the [portable-generators] + extreme-weather scar.
- **Vendor + tout:** the vendor NPC moves *into* the shop; a cheap `npc_type:'npc'` **tout/barker**
  stands on the facade tile pointing inward (keeps street life; reuses the ambient-NPC pattern).
- **Ownable units** reuse the housing system (furniture-shop delivery, apartment flags) — see the
  furniture-shop + housing memories.

> **Engine note:** this is **entirely content** — no new mechanics. It reuses interiors, vendors,
> furniture, safes, junction-box/power, and housing exactly as built. No plugin, no schema change.
> Risk is *volume + UTF-8 hygiene*, not architecture. Regress gate every phase anyway (new zones/exits).

## Phases (by district)
| # | Phase | District | ~Interiors | Anchors |
|---|---|---|---|---|
| 1 | **North City** | civic/diplomatic/financial | 3–4 | The Bourse trading floor (multi-floor), the Consulate, a civic hall, a Meridian-Heights lobby |
| 2 | **The Docks** | bay waterfront | 2–3 | A dockside dive bar, the Coldstore, the harbourmaster/customs house |
| 3 | **The Yards** | freight east | 2–3 | The Depot dispatch office, the Consignment House (Merrow moves inside), a boxcar squat |
| 4 | **The Undermarket** | deep sprawl south | 2–3 | A stall-warren, a ripperdoc, a black-market backroom |
| 5 | **Wastes & Redline fringe** | west | 2–3 | Slake's kiln interior (Broken Kiln), a scav camp, a shelter — lean, no luxury |
| 6 | **Housing** | N. City + Docks | 2–4 units | Ownable Meridian-Heights luxury flats + a dockside flophouse (housing-system wired) |
| 7 | **Core backfill** | original 42 | as needed | Any old-core facade still lacking an interior |

**Per-interior checklist:** facade `in`/`out` wired · floors on `map_int_*` · utility room + junction box
(if multi-floor) · vendor moved in + tout placed out front · furniture/loot/safe/lore as fits · UTF-8
glyphs intact · regress green.

## Open items to resolve at build time (not blockers)
- Which specific facades per district get the 2–4 slots (pick from the phase anchors + neighbours).
- How many floors each landmark warrants (Bourse/Consulate deep; a scav shelter is one room).
- Apartment count + prices (Phase 6) and whether the flophouse is cheap-tier housing.
- Whether any interior gets a hidden basement tie-in to **The Under** (a shop with a `down` to a metro
  utility level) — a nice cross-project seam if The Under ships first.

## Build method
Same coldwater pipeline: direct-DB upsert + minted token; each interior is its own `map_int_*` with
in/out + floor exits; `npm run test:regress` per phase; memory + this doc updated per phase. Content is
DB-only, live on `npm start`. **UTF-8-without-BOM discipline** matters here (interiors carry glyph-heavy
descriptions) — sanity-check glyphs after each write per CLAUDE.md.
