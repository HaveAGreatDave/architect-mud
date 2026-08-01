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

// The district a zone belongs to. Precedence: an explicit flags.district, then the
// legacy id-prefix table, then a lethal-zone fallback to hazard, then the urban
// default. ALWAYS returns an entry — never null, never a throw.
export function districtFor(zone) {
  const pick = (k) => DISTRICTS[k] || null;
  const fallback = pick(FALLBACK_KEY) || UNLOADED;
  if (!zone) return fallback;
  const override = zone.flags?.district;
  if (override && DISTRICTS[override]) return DISTRICTS[override];
  const p = (zone.id || '').match(/^zone_([a-z0-9]+)/)?.[1] || '';
  const key = DISTRICT_PREFIX[p] || (zoneDanger(zone) === 'lethal' ? HAZARD_KEY : FALLBACK_KEY);
  return pick(key) || fallback;
}
