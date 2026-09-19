/**
 * Halcyon Fields — re-apply the renderer half, idempotently.
 *
 * ⚠ THIS EXISTS BECAUSE `windshield.js` IS A CONTESTED FILE. It is thirty-odd thousand lines
 * that every renderer change in the repo has to go through, so two sessions working at once
 * will both have it open, and a whole-file write from either one silently reverts whatever
 * the other did between their read and their write. That happened twice while this quarter was
 * being built, both times PARTIALLY — the arms survived and the palette block they paint with
 * did not — which is the worst shape for it to take, because the file still parses, the smoke
 * suite still runs, and what you get is a building drawn in whatever colour the ambient palette
 * happens to be.
 *
 * So every edit this quarter makes to the renderer is expressed here as a check-then-apply, and
 * running it twice is a no-op. If it prints all-present, the file is in the state this quarter
 * expects. If it prints anything else, something reverted and it has just been put back.
 */
import fs from 'node:fs';

const WS = 'client/game/js/panels/windshield.js';
const DERIVE = 'scripts/content/derive.mjs';
const ARMS = process.argv[2];   // path to the six second-campaign arms, or omitted to skip
const done = [], fixed = [];

let s = fs.readFileSync(WS, 'utf8');

// ── 1. the palette block ────────────────────────────────────────────────────
// The first campaign's fifteen buildings were authored in limestone, stock brick and works
// green, and re-faced in chrome and glass. The whole block is replaced rather than patched
// key by key, because the COMMENTS carry the material argument and a half-reverted comment is
// worse than a reverted colour.
const PAL_START = "  // ── HALCYON FIELDS (docs/proposals/coldwater-infill.md's sibling quarter) ──────";
const PAL_END_OLD = '  ty_hwm: [124, 134, 138], ty_hwm_pad: [140, 140, 136],';
const PAL_END_NEW = '  ty_hwm: [180, 194, 204], ty_hwm_pad: [150, 164, 176],';
const PAL_BLOCK = fs.readFileSync('scripts/content/halcyon/palette-block.txt', 'utf8').replace(/\r\n/g, '\n');
if (s.includes(PAL_END_NEW)) done.push('palette');
else {
  const i = s.indexOf(PAL_START), j = s.indexOf(PAL_END_OLD);
  if (i < 0 || j < 0) throw new Error('palette block: neither the new end marker nor the old one is present — the file has moved further than this script can follow');
  s = s.slice(0, i) + PAL_BLOCK.trimEnd() + s.slice(j + PAL_END_OLD.length);
  fixed.push('palette');
}

// ── 2. the second campaign's three extra colours ────────────────────────────
if (s.includes('ty_hft_glass:')) done.push('campaign-2 palette');
else {
  s = s.replace(PAL_END_NEW, PAL_END_NEW + `
  // ── HALCYON FIELDS, THE SECOND CAMPAIGN ────────────────────────────────────
  // Six more types over fourteen more plots, and deliberately only three new colours: the
  // towers, the crescents and the halts are faced in the chrome and glass the first campaign
  // established, because that is what makes fourteen buildings read as one estate rather than
  // as fourteen decisions. The two that DO get their own colour are the two that are not
  // offices — a pavilion full of planting and a farm under grow lights — and each earns it by
  // being the only thing on a different hue for a street in either direction.
  ty_hft_glass: [34, 56, 80], ty_hfp_glass: [38, 72, 66],
  ty_hfv_glass: [58, 40, 72], ty_hfv_tray: [198, 120, 210],`);
  fixed.push('campaign-2 palette');
}

// ── 3. material families ────────────────────────────────────────────────────
// ⚠ THE FAMILY IS THE FEATURE AND NOT THE TRIPLE. A chrome colour left in STONE_WALL still
// courses like ashlar and still punches a tenement window grid, so a reverted family is a
// reverted re-facing even when every RGB in the file is right.
if (s.includes("'ty_hft_glass', 'ty_hfp_glass'")) done.push('glass family');
else {
  s = s.replace("const GLASS_WALL = new Set(['ty_sound_hall'",
                "const GLASS_WALL = new Set(['ty_hft_glass', 'ty_hfp_glass', 'ty_hfv_glass', 'ty_sound_hall'");
  fixed.push('glass family');
}
if (s.includes("'ty_hfv_tray',")) done.push('tray in PLAIN_WALL');
else { s = s.replace('const PLAIN_WALL = new Set([\n', "const PLAIN_WALL = new Set([\n  'ty_hfv_tray',\n"); fixed.push('tray in PLAIN_WALL'); }

// ── 4. the accents ──────────────────────────────────────────────────────────
// `neon` drives accentOf, which reaches the facade wash, the derived trim and the sign ink, so
// a warm accent on a chrome building undoes most of the re-facing from a distance.
const NEON = { concert_hall: '#bfe8ff', members_club: '#e6dcc2', auction_house: '#a8d8f0', institute: '#dff0ff',
  land_office: '#7fd8ff', hydro: '#9fe4ff', winter_garden: '#7fe6b4', pumping_station: '#5ac8ff',
  cooling_plant: '#8fd8ff', gasholder: '#6fbcff', substation: '#ffd24a', exchange: '#6fa8cc',
  fire_station: '#ff5a4a', incinerator: '#74a8ff', water_tower: '#8fd0ff' };
let nTouched = 0;
s = s.split('\n').map((ln) => {
  const m = ln.match(/^\s*([a-z_]+):\s+\{ type: '/);
  if (!m || !NEON[m[1]]) return ln;
  const want = `neon: '${NEON[m[1]]}'`;
  if (ln.includes(want) || !/neon: '#[0-9a-fA-F]{6}'/.test(ln)) return ln;
  nTouched++;
  return ln.replace(/neon: '#[0-9a-fA-F]{6}'/, want);
}).join('\n');
(nTouched ? fixed : done).push(`accents${nTouched ? ` (${nTouched})` : ''}`);

// ── 5. the second campaign's TYPE_MODEL rows ────────────────────────────────
// ⚠ REGISTERING IS NOT OPTIONAL: an arm that never lands here bakes no shape, gets no LOD,
// casts no shadow, collides with nothing and is invisible to shapes:smoke.
const TM_ANCHOR = "  water_tower:       { type: 'water_tower',       pal: 'ty_hwm',          neon: '#8fd0ff' },";
if (s.includes("chrome_tower:      { type:")) done.push('type models');
else {
  if (!s.includes(TM_ANCHOR)) throw new Error('TYPE_MODEL anchor missing — the accent pass above should have created it');
  s = s.replace(TM_ANCHOR, TM_ANCHOR + `
  chrome_tower:      { type: 'chrome_tower',      pal: 'ty_hft_glass',    neon: '#7fd8ff' },
  chrome_slab:       { type: 'chrome_slab',       pal: 'ty_hft_glass',    neon: '#9fe0ff' },
  pavilion:          { type: 'pavilion',          pal: 'ty_hfp_glass',    neon: '#7fe6b4' },
  sky_court:         { type: 'sky_court',         pal: 'ty_hft_glass',    neon: '#bfe8ff' },
  vertical_farm:     { type: 'vertical_farm',     pal: 'ty_hfv_glass',    neon: '#e07ad8' },
  transit_halt:      { type: 'transit_halt',      pal: 'ty_hf_chrome',    neon: '#5ac8ff' },`);
  fixed.push('type models');
}

// ── 6. the six arms ─────────────────────────────────────────────────────────
if (s.includes("    case 'chrome_tower': {")) done.push('campaign-2 arms');
else if (ARMS) {
  const at = s.indexOf("    case 'sentinel': {");
  if (at < 0) throw new Error('arm insertion point missing');
  s = s.slice(0, at) + fs.readFileSync(ARMS, 'utf8').replace(/\r\n/g, '\n') + s.slice(at);
  fixed.push('campaign-2 arms');
} else fixed.push('campaign-2 arms MISSING — re-run with the arms file as argv[2]');

fs.writeFileSync(WS, s);

// ── 7. the map-icon registry ────────────────────────────────────────────────
// Different file, same hazard, and a building_type with no icon row draws nothing on the map
// while rendering perfectly in the flight sim, which is the least findable half of the split.
let d = fs.readFileSync(DERIVE, 'utf8');
if (d.includes("chrome_tower: 'bldg_chrome_tower'")) done.push('map icons');
else {
  const a = "  incinerator: 'bldg_incinerator', water_tower: 'bldg_water_tower',";
  if (!d.includes(a)) throw new Error('icon anchor missing');
  d = d.replace(a, a + `
  chrome_tower: 'bldg_chrome_tower', chrome_slab: 'bldg_chrome_slab',
  pavilion: 'bldg_pavilion', sky_court: 'bldg_sky_court',
  vertical_farm: 'bldg_vertical_farm', transit_halt: 'bldg_transit_halt',`);
  fs.writeFileSync(DERIVE, d);
  fixed.push('map icons');
}

console.log(`already in place: ${done.join(', ') || 'nothing'}`);
console.log(fixed.length ? `RE-APPLIED:       ${fixed.join(', ')}` : 'RE-APPLIED:       nothing — the renderer is in the state this quarter expects');
