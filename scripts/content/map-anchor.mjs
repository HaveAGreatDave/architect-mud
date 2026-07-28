// THE MAP ANCHOR — one invariant, its checker and its fixer.
//
// A map hangs off exactly one world tile. `maps.parent_zone_id` says which, and
// that is the ONLY place it is decided. Every tile on the map carries a copy in
// `zones.parent_zone` (and, where present, `flags.world_exit_zone`) because the
// engine reads it off the tile it is standing on — but a copy is not a second
// opinion. This module is what keeps the copies honest: `content:lint` calls
// anchorViolations(), the Studio calls applyAnchor() whenever a map is saved,
// and scripts/content/sync-map-anchors.mjs calls both to repair the tree.
//
// PURE. No fs, no DB, no clock — same contract as derive.mjs, for the same
// reason: lint, the Studio and the fixer must be answering the same question.
//
// WHY THIS EXISTS
// ───────────────
// `zones.parent_zone` was carrying two incompatible meanings at once, roughly
// half the world each (measured 2026-07-27 over 331 interior tiles):
//
//   140 tiles  the map's world anchor — the facade the building sits on
//   154 tiles  the containing ROOM inside the interior (Halcyon's Elevator
//              pointed at its Grand Lobby, the Cherry Pit's Utility Room at its
//              Back Office), written by the older hand-built generators
//
// Every runtime reader assumes the first: flight/acquisition.js, and three sites
// in engine/environment.js, all resolve `flags.world_exit_zone || parent_zone`
// expecting a WORLD tile. Under the second reading they get a room, and the
// fallback quietly lands somewhere indoors.
//
// The drift had already shipped three live bugs — utility rooms under Jitter,
// the Meltwater Diner and Ward Nine Permits still naming the world tile their
// building sat on BEFORE it was moved. Those ids all resolve, so nothing ever
// errored; a player leaving through one would just surface two blocks away.
//
// THE SPLIT THAT MAKES BOTH READINGS LEGAL
// ────────────────────────────────────────
// A tile ON a map takes its anchor from the map. A tile on NO map (11 of them —
// interior rooms reached only by an exit, never drawn on a grid) keeps
// `parent_zone` as the hand-authored grouping the dev panel's room tree reads.
// Nothing is lost and the ambiguity is gone: "is it on a map" decides which
// meaning applies, and that is a fact about the tile, not a convention to
// remember.

/**
 * What the map says every tile on it must carry. Null for a map with no parent
 * (map_world, Dreamzones, the Leviathan cabin) — where the answer is "nothing",
 * and that is enforced too, not merely skipped.
 */
export function expectedAnchor(map) {
  return map?.parent_zone_id ?? null;
}

/**
 * `flags.world_exit_zone` means two different things depending on where it sits,
 * and only one of them is the map's business:
 *
 *   on a FACADE (a world-map building footprint) — the STREET tile a player is
 *     spat onto when they leave the building. All 62 facades carry one and not
 *     one of them names itself. Geometry decides it, not the map. Hands off.
 *   on an INTERIOR tile — the facade, i.e. the map anchor, duplicated.
 *
 * Facades only ever live on map_world, whose parent is null, so scoping the rule
 * to maps that HAVE a parent already excludes them; the explicit flag check is
 * belt and braces for the day somebody puts a building inside a building.
 */
const ownsWorldExit = (zone) => !zone?.flags?.facade;

/**
 * Every place the tree disagrees with itself.
 *
 * Deliberately reports `world_exit_zone` only where a tile ALREADY carries one.
 * 199 interior tiles have none and inherit through `parent_zone` instead; minting
 * a value onto them would be a behaviour change dressed as a consistency fix —
 * engine/ai-behaviour.js branches on the flag's presence in four places.
 *
 * @param {object} input
 * @param {Array} input.maps   every maps row / content file
 * @param {Array} input.zones  every zones row / content file
 * @returns {Array<{zone_id, map_id, field, is, want}>} sorted, stable
 */
export function anchorViolations({ maps = [], zones = [] } = {}) {
  const mapById = new Map(maps.map(m => [m.id, m]));
  const out = [];
  for (const z of zones) {
    // No map ⇒ no anchor to inherit; parent_zone is this tile's own business.
    if (!z?.map_id) continue;
    const map = mapById.get(z.map_id);
    if (!map) continue;                      // dangling map_id — the FK rule's job
    const want = expectedAnchor(map);
    const is = z.parent_zone ?? null;
    if (is !== want) out.push({ zone_id: z.id, map_id: z.map_id, field: 'parent_zone', is, want });

    if (want == null || !ownsWorldExit(z)) continue;
    const wez = z.flags?.world_exit_zone ?? null;
    if (wez != null && wez !== want) {
      out.push({ zone_id: z.id, map_id: z.map_id, field: 'flags.world_exit_zone', is: wez, want });
    }
  }
  return out.sort((a, b) => (a.zone_id < b.zone_id ? -1 : a.zone_id > b.zone_id ? 1 : 0));
}

/**
 * The map's anchor, pushed onto one tile. Returns a NEW row; returns the row it
 * was given, by identity, when nothing needed changing — so a caller can skip
 * the write and a no-op save stays a no-op diff.
 */
export function applyAnchor(zone, map) {
  const want = expectedAnchor(map);
  const is = zone?.parent_zone ?? null;
  const touchesWez = want != null && ownsWorldExit(zone)
    && zone?.flags?.world_exit_zone != null && zone.flags.world_exit_zone !== want;
  if (is === want && !touchesWez) return zone;

  const next = { ...zone };
  // null, not absent: `parent_zone` is a plain nullable column, not one of the
  // registry's omitWhenNull overrides, so the tree writes it either way.
  next.parent_zone = want;
  if (touchesWez) next.flags = { ...(zone.flags || {}), world_exit_zone: want };
  return next;
}
