// District registry — the "sense of place" substrate.
//
// A district is the coarse land-use neighbourhood a zone belongs to: North City,
// the Redline, the Wilds. A tile says which one it is in with flags.district.
//
// THE DEFINITIONS ARE CONTENT, NOT CODE. They used to be a 240-line object literal
// right here — names, colours, mood blurbs and pools of sensory prose, editable
// only by changing engine source and shipping a deploy. They now live one file per
// district in content/districts/ and load into this module at boot, so a district
// ships through the ordinary content pipeline like a zone or an item does.
//
// That move also killed the copy. The client kept a hand-maintained mirror of the
// colours (FUNC_LEGEND) which had to be updated by hand whenever a district was
// added — and four never were, including the Wilds, so the biggest district in the
// game drew no colour, no legend row and no tooltip on the regional map. The legend
// is now served from these rows.
//
// districtFor() is SYNC AND QUERY-FREE BY CONTRACT — it runs per move, per look and
// per ambience beat. It reads the in-memory registry and never touches the DB.
//
// Each district row carries:
//   id        — the stable key (also the map/legend key and flags.district value)
//   name      — player-facing neighbourhood name (header tag, boundary beat)
//   color     — CSS colour: regional-map tint, legend swatch, street blend
//   blurb     — one-line mood, shown on a player's first-ever entry
//   landmark  — zone id of the orienting skyline feature (or null)
//   skyline   — short phrase describing that landmark from afar (or null)
//   signature — sensory leitmotif pool (smell/sound/air), surfaced OUTDOORS only
//               by the district-ambience plugin. Empty = no sensory layer.
//   prefixes  — LEGACY id-prefix classification (see below)
//   sort      — display order for authoring tools; not player-facing

import { zoneDanger } from './danger.js';

// POLICY, not content — which is why these two stay in code. Every zone must resolve
// to some district, so an unclassified tile falls back: lethal ground reads as hazard,
// everything else as the urban default. Changing either is a rules decision.
const FALLBACK_KEY = 'residential';
const HAZARD_KEY = 'hazard';

// The registry, filled by loadDistricts() at boot. Exported as live objects because
// consumers import the binding once and read it for the process's lifetime — they are
// mutated in place, never reassigned.
export const DISTRICTS = {};

// Zone id prefix → district key, rebuilt from each district's own `prefixes`. LEGACY:
// zone ids of the form zone_<prefix>_… classified themselves, and 154 zones still
// rely on it. Every tile on the modern grid is zone_district_<x>_<y>, which matches
// nothing here — for those, flags.district is the only thing that assigns identity.
export const DISTRICT_PREFIX = {};

// Until the rows are in, districtFor() would have nothing to return. It must never
// return null (every caller reads .key straight off it), so an unloaded registry
// answers with this rather than throwing halfway through a look. It carries no prose:
// a placeholder that invented a neighbourhood name would put words in the game that
// no author wrote, which is the whole failure this migration is undoing.
const UNLOADED = Object.freeze({
  id: FALLBACK_KEY, key: FALLBACK_KEY, name: '', color: null,
  blurb: null, landmark: null, skyline: null, signature: Object.freeze([]),
});

/**
 * Fill the registry from `districts` rows (world boot; re-run on a dev reload).
 * Replaces contents in place — the exported objects keep their identity.
 */
export function loadDistricts(rows = []) {
  for (const k of Object.keys(DISTRICTS)) delete DISTRICTS[k];
  for (const k of Object.keys(DISTRICT_PREFIX)) delete DISTRICT_PREFIX[k];
  for (const row of rows) {
    if (!row?.id) continue;
    DISTRICTS[row.id] = {
      // `key` is the historical name for the id and half the codebase reads it —
      // kept as an alias of the primary key rather than a second column that could
      // ever disagree with it.
      ...row, key: row.id,
      signature: Array.isArray(row.signature) ? row.signature : [],
    };
    for (const p of Array.isArray(row.prefixes) ? row.prefixes : []) DISTRICT_PREFIX[p] = row.id;
  }
  return Object.keys(DISTRICTS).length;
}

export function districtsLoaded() { return Object.keys(DISTRICTS).length > 0; }

// The zone lookup, INJECTED rather than imported. world.js imports this file, so
// importing it back would close a cycle — the same one `broadcast-bridge.js` exists
// to avoid elsewhere in the engine. Registered once at world init.
let _getZone = null;
export function registerZoneLookup(fn) { _getZone = typeof fn === 'function' ? fn : null; }

// The district a zone belongs to. Precedence: an explicit flags.district, then the
// building an interior stands inside, then the legacy id-prefix table, then a
// lethal-zone fallback to hazard, then the urban default. ALWAYS returns an entry —
// never null, never a throw.
export function districtFor(zone) {
  const pick = (k) => DISTRICTS[k] || null;
  const fallback = pick(FALLBACK_KEY) || UNLOADED;
  if (!zone) return fallback;
  const override = zone.flags?.district;
  if (override && DISTRICTS[override]) return DISTRICTS[override];

  // ── AN INTERIOR BELONGS TO THE BUILDING IT STANDS IN ────────────────────────
  // Interiors carry no district of their own, so before this they fell through to
  // the id-prefix table — and a prefix is a NAMING convention, not a place. It went
  // wrong in both directions and both were live: every `zone_util_*` plant room
  // filed as the Media District (fixed 2026-08-30 by dropping that prefix), and
  // every `zone_mq_*` room filed as the Marquee, which put Precinct 9's lobby, a
  // sump and a ration counter in the nightlife district — the police station played
  // "bass thuds through a wall, felt in the teeth before the ears".
  //
  // The building overhead is the honest answer and it is already authored, so this
  // asks it. Dropping a stale prefix fixes one prefix; this fixes the class.
  //
  // ⚠ It could only be done AFTER the surface was repaired. On 2026-08-30, 160 of
  // Coldwater's urban tiles were filed `wasteland`, so inheriting from the parent
  // would have handed 46 utility rooms a wilderness district and looked like a
  // regression. Order mattered: fix the ground, then let the insides ask it.
  //
  // Sync and query-free, as this function is by contract — `_getZone` is a Map read.
  // Bounded and cycle-guarded because a mis-authored `parent_zone` must degrade to
  // the old behaviour, never hang the move/describe/ambient path it sits on.
  if (zone.parent_zone && _getZone) {
    const seen = new Set([zone.id]);
    let cur = zone;
    for (let hop = 0; hop < 8 && cur?.parent_zone; hop++) {
      if (seen.has(cur.parent_zone)) break;
      seen.add(cur.parent_zone);
      cur = _getZone(cur.parent_zone);
      if (!cur) break;
      const inherited = cur.flags?.district;
      if (inherited && DISTRICTS[inherited]) return DISTRICTS[inherited];
    }
  }

  const p = (zone.id || '').match(/^zone_([a-z0-9]+)/)?.[1] || '';
  const key = DISTRICT_PREFIX[p] || (zoneDanger(zone) === 'lethal' ? HAZARD_KEY : FALLBACK_KEY);
  return pick(key) || fallback;
}
