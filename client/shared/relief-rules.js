// RELIEF RULES: what one tile of the carved country is, read from the relief planes.
//
// The relief is baked offline (scripts/content/relief-core.mjs) into 2-tile cells. Two things read
// it per tile and must agree: the game, through `reliefAt` in wildlands.js over the shipped
// planes, and the preview page (tools/worldmap/relief.html) over a bake it has just run. Both come
// through `reliefTileAt` here, so a rule tuned in the preview is the rule the game runs.
//
// A view `V` is the planes as functions of a world tile:
//   h(x, y)        height, tier units          layered(x, y)  0..1, how layered the rock is
//   flow(x, y)     drainage area               wet(x, y)      0..1 moisture
//   lake(x, y)     depth of pit fill (a dry lakebed)
//   caps           the caprock tops, bottom up  dip            the bed dip amplitude
//   rules          the thresholds from wildlands.json `relief.rules`
//
// See docs/proposals/wildlands-relief.md. Nothing here names a region or a place.
import { hnoise2, fbm2 } from './landform.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Bilinear read of a cell plane at a world tile. Past the edge it clamps.
export function cellSampler(plane, x0, y0, cell, cw, ch) {
  return (x, y) => {
    const fx = clamp((x - x0) / cell, 0, cw - 1.001), fy = clamp((y - y0) / cell, 0, ch - 1.001);
    const xi = fx | 0, yi = fy | 0, u = fx - xi, v = fy - yi, i = yi * cw + xi;
    const p = plane[i], q = plane[i + 1], r = plane[i + cw], s = plane[i + cw + 1];
    return p + (q - p) * u + (r - p) * v + (p - q - r + s) * u * v;
  };
}

// The beds dip a little, so a cliff line wanders across the contours instead of following one.
// A pure function of the tile, so the bake and the reader need no plane for it.
export const dipAt = (amp, x, y) => fbm2(x * 0.008 + 9.1, y * 0.008 + 3.3, 2, 0.5) * amp;

// The tier a bed height sits in: how many cliff bands it is above. Only layered rock has tiers;
// soft country rolls.
// ⚠ THE LINE IS HALFWAY UP THE FACE, NOT AT THE CAP'S TOP. The terrace riser eases flat at both
// ends, so a line at the top sat where the ground is level again and no rim tile was ever steep.
export function tierOfH(caps, hb, layered) {
  if (layered < 0.45) return 0;
  let t = 0, prev = 0;
  for (const top of caps) { if (hb >= (prev + top) / 2) t++; prev = top; }
  return t;
}

// The surface height at a tile. The sample point is nudged by a slow warp so a rim does not
// follow the 2-tile cell edges; the warp is smooth, so the surface stays continuous.
export function surfaceH(V, x, y) {
  const jx = (hnoise2(x * 0.31 + 2.2, y * 0.31) - 0.5) * 1.2, jy = (hnoise2(x * 0.31, y * 0.31 - 7.1) - 0.5) * 1.2;
  return V.h(x + jx, y + jy);
}
export const tierAt = (V, x, y, h = surfaceH(V, x, y)) => tierOfH(V.caps, h + dipAt(V.dip, x, y), V.layered(x, y));

// The reading of a tile. Biomes are the preview's vocabulary (two of them, `wash` and `prairie`,
// are not ground-palette keys until phase 6); `terrain` is always a real content terrain.
export const RELIEF_BIOMES = ['', 'water', 'cliff', 'scree', 'ramp', 'plateau', 'wash', 'hardpan', 'alkali', 'prairie', 'redrock', 'scrub', 'badlands', 'ash', 'basalt', 'lava'];
const BIOME_TO_TERRAIN = { water: 'water', cliff: 'cliff', scree: 'scree', ramp: 'ramp', plateau: 'plateau', wash: 'gravel', hardpan: 'hardpan', alkali: 'alkali', prairie: 'grass', redrock: 'redrock', scrub: 'scrub', badlands: 'scrub', ash: 'ash', basalt: 'basalt', lava: 'basalt' };

// `at` is wildlandsAt(x, y): the sea and the volcano are its answers, not the relief's.
// Returns { h, tier, step, flow, wet, form, biome, terrain }, where form is one of cliff, ramp,
// scree, wash, lakebed, ground.
export function reliefTileAt(V, x, y, at) {
  const h = surfaceH(V, x, y), tier = tierAt(V, x, y, h);
  let step = 0, lower = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const hn = surfaceH(V, x + dx, y + dy);
    step = Math.max(step, Math.abs(hn - h));
    if (!lower && tierAt(V, x + dx, y + dy, hn) < tier) lower = true;
  }
  const flow = V.flow(x, y), wet = V.wet(x, y), lay = V.layered(x, y), lake = V.lake(x, y);
  const rl = V.rules || {};
  let biome, form = 'ground';
  if (at?.sea) biome = 'water';
  // The volcano and its plume keep the ground wildlands.js gives them: basalt high on the cone,
  // ash on its lower slopes and everywhere the plume drops it, lava in the crater and the flows.
  else if (at && (at.landform || at.biome === 'ash' || at.biome === 'basalt' || at.biome === 'lava')) biome = at.biome === 'lava' || at.biome === 'basalt' ? at.biome : 'ash';
  // A step down to a lower tier on any side, at a steep enough slope, is a rim.
  else if (lower && step >= (rl.cliffSlope ?? 0.22)) { biome = 'cliff'; form = 'cliff'; }
  else if (lower) { biome = 'ramp'; form = 'ramp'; }
  else if (step >= (rl.screeSlope ?? 0.32)) { biome = lay > 0.45 ? 'scree' : 'badlands'; if (lay > 0.45) form = 'scree'; }
  else if (flow >= (rl.washFlow ?? 900) && step < 0.12) { biome = 'wash'; form = 'wash'; }
  else if (lake > (rl.lakeDepth ?? 0.03)) { biome = wet < 0.25 ? 'alkali' : 'hardpan'; form = 'lakebed'; }
  else if (wet >= (rl.prairieWet ?? 0.55) && step < (rl.prairieSlope ?? 0.06)) biome = 'prairie';
  else if (wet < 0.35 && lay > 0.45) biome = 'redrock';
  else if (step > 0.16) biome = 'badlands';
  else biome = wet >= 0.4 ? 'scrub' : 'badlands';
  return { h, tier, step, flow, wet, form, biome, terrain: BIOME_TO_TERRAIN[biome] || 'scrub' };
}
