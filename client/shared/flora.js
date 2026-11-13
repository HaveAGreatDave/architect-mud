// FLORA: what grows on a tile of open country, as a pure function of the world tile.
//
// The species are content (content/map/flora.json, baked into the wildlands field). This file is
// the ecology: which of them can grow on a tile, given the carved relief's reading of it (ground,
// moisture, slope, height) and the region halo it sits in, how many plants the ground carries, and
// where on the tile each one stands. Nothing here names a species or a place.
//
// Two readers and they must agree, the way they do for the ground itself: the renderer draws the
// plants (windshield.js, through the growth-form drawers in panels/glass/flora-draw.js) and the
// walked void names them (plugins/voidwalking). A walker told "Joshua trees out on the flat" is
// standing among the Joshua trees the pilot overhead can see.
//
// ⚠ RENDER AND PROSE ONLY. A plant is never collision, never cover, never a resource. If one ever
// becomes harvestable it gets a system of its own that reads this, not a field added here.
//
// ⚠ THE PER-TILE DICE ARE AN INTEGER HASH (hn2h), never Math.random or a Math.sin hash: the server
// and every client must roll the same plant on the same tile, to the bit.
import { hn2h, hnoise2 } from './landform.js';
import { WILDLANDS_FIELD } from './wildlands-field.js';
import { wildlandsAt, reliefAt, highGroundAt } from './wildlands.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The growth forms the renderer can draw. A species names one; the gate fails a species whose form
// isn't here, and the renderer fails loudly on a form it has no drawer for.
export const FLORA_FORMS = ['shrub', 'columnar', 'paddle', 'cholla', 'barrel', 'rosette', 'yucca', 'joshua',
  'ocotillo', 'juniper', 'broadtree', 'feathery', 'grass', 'flowers', 'snag', 'thorn'];

// Ground a PLACED tile's biome stands for. A placed tile has no relief reading (the relief holds 0
// under a region), so it gets the habitat its biome implies and a typical moisture for it.
const PLACED = {
  scrub: ['scrub', 0.35], badlands: ['badlands', 0.25], redrock: ['redrock', 0.15], scarlet: ['redrock', 0.15],
  hardpan: ['hardpan', 0.2], alkali: ['alkali', 0.08], sinter: ['alkali', 0.12], ash: ['ash', 0.15],
  deadwood: ['ash', 0.2], basalt: ['basalt', 0.12], prairie: ['prairie', 0.6],
};
export const FLORA_PLACED_BIOMES = Object.keys(PLACED);

// How a species likes a value in its range: nothing outside it, best in the middle, still a fair
// showing at the edges, so a range edge thins a species out rather than drawing a line on the map.
function band(v, r) {
  if (!r) return 1;
  const [lo, hi] = r;
  if (v < lo || v > hi) return 0;
  const u = hi > lo ? (v - lo) / (hi - lo) : 0.5;
  return 0.3 + 0.7 * (1 - Math.abs(2 * u - 1));
}
// A 0..1 die for tile (x, y) and stream k.
const die = (x, y, k) => hn2h(Math.imul(x | 0, 31) + k * 7919, (y | 0) + k * 104729);
// A stable number per species name, for its own noise offset.
const nameSeed = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };

export function createFlora(F, W) {
  const cfg = F.flora || null;
  const SPECIES = cfg ? Object.entries(cfg.species).map(([id, s], i) => {
    const h = nameSeed(id);
    return { id, i, ...s, ox: (h % 997) * 0.731, oy: ((h >>> 10) % 991) * 0.577 };
  }) : [];
  const DENSITY = cfg?.density || {};

  // The habitat of an unplaced tile: what the relief says it is. `top` asks about the cap of a massif
  // standing on it, where the renderer draws one, rather than about the floor.
  function habitatAt(x, y, top = false) {
    const at = W.wildlandsAt(x, y);
    if (at.sea) return null;
    const rf = W.reliefAt(x, y, at);
    const halo = {};
    for (const [b, k] of at.blend) halo[b] = k;
    if (!rf) return { biome: PLACED[at.biome]?.[0] || 'badlands', wet: PLACED[at.biome]?.[1] ?? 0.25, step: 0.05, h: 0, halo };
    return { biome: top ? 'plateau' : rf.biome, wet: rf.wet, step: top ? Math.min(rf.step, 0.08) : rf.step, h: rf.h, halo };
  }
  function placedHabitat(biome) {
    const p = PLACED[biome];
    return p ? { biome: p[0], wet: p[1], step: 0.05, h: 0, halo: biome === 'scarlet' ? { scarlet: 1 } : {} } : null;
  }

  // How well each species does here, before its stands are applied. Shared by the plant roll and by
  // the walker's line, which asks the same question of a wider patch.
  function fitness(sp, hab) {
    const g = sp.where[hab.biome];
    if (!g) return 0;
    if (sp.halo && !((hab.halo[sp.halo] || 0) >= 0.25)) return 0;
    return sp.weight * g * band(hab.wet, sp.wet) * band(hab.step, sp.slope) * (sp.h ? (hab.h >= sp.h[0] && hab.h <= sp.h[1] ? 1 : 0) : 1);
  }
  // A species grows in stands: a slow noise of its own decides where its companies are, so the
  // ground reads as creosote here, cholla over there, and never as an even mix of everything.
  function stand(sp, x, y) {
    if (!sp.patch) return 1;
    const n = hnoise2(x * sp.patch + sp.ox, y * sp.patch + sp.oy);
    const k = clamp((n - 0.36) / 0.32, 0, 1);
    return 0.06 + 1.7 * k * k;
  }

  // The plants on a tile: [{ id, form, rgb, accent, scale, ox, oy, seed, flip }], at most three.
  // `ox`/`oy` are tile-local offsets (−0.45..0.45), `seed` a stable integer for the drawer's variant.
  function rollPlants(x, y, hab) {
    if (!hab || !SPECIES.length) return [];
    const base = DENSITY[hab.biome] || 0;
    if (!base) return [];
    const fit = SPECIES.map((sp) => fitness(sp, hab) * stand(sp, x, y));
    let tot = 0; for (const f of fit) tot += f;
    if (tot <= 0) return [];
    // Bare ground is the default and a thicket the exception: a slow coverage noise opens clearings
    // and closes up stands, and the ground's moisture carries the rest.
    const cover = 0.45 + 1.1 * hnoise2(x * 0.071 + 5.3, y * 0.071 - 3.7);
    const want = base * cover * (0.45 + 1.1 * hab.wet) * Math.min(1, tot / 2);
    const n = Math.min(3, Math.floor(want + die(x, y, 1)));
    if (n <= 0) return [];
    // A jittered 2×2 sub-grid, so two plants on a tile never stand in each other.
    const first = Math.floor(die(x, y, 2) * 4);
    const out = [];
    for (let i = 0; i < n; i++) {
      let r = die(x, y, 10 + i) * tot, sp = SPECIES[SPECIES.length - 1];
      for (let j = 0; j < SPECIES.length; j++) { r -= fit[j]; if (r <= 0) { sp = SPECIES[j]; break; } }
      if (!fit[sp.i]) continue;
      const slot = (first + i) % 4;
      const ox = ((slot & 1) - 0.5) * 0.5 + (die(x, y, 20 + i) - 0.5) * 0.36;
      const oy = ((slot >> 1) - 0.5) * 0.5 + (die(x, y, 30 + i) - 0.5) * 0.36;
      const sz = sp.size || [1, 1];
      out.push({
        id: sp.id, form: sp.form, rgb: sp.rgb, accent: sp.accent || null, size: sz,
        scale: sz[0] + (sz[1] - sz[0]) * die(x, y, 40 + i),
        ox, oy, seed: (Math.floor(die(x, y, 50 + i) * 65535) + sp.i * 7) >>> 0, flip: die(x, y, 60 + i) < 0.5,
      });
    }
    return out;
  }

  // ⚠ CACHED BY TILE, because the renderer asks every visible wild tile every frame and the relief
  // reading under it is about ten microseconds. Bounded, and cleared whole: the window only ever
  // holds a few thousand tiles, so a clear costs one rebuilt window.
  const CACHE = new Map(), CACHE_MAX = 60000;
  const key = (x, y, mode) => (((x + 32768) * 65536 + (y + 32768)) * 32) + mode;
  function cached(x, y, mode, make) {
    const k = key(x, y, mode);
    let v = CACHE.get(k);
    if (v === undefined) { if (CACHE.size >= CACHE_MAX) CACHE.clear(); v = make(); CACHE.set(k, v); }
    return v;
  }
  const NONE = Object.freeze([]);
  // The plants on an unplaced tile's floor, or on the cap of the massif standing on it (`top`).
  function floraAt(x, y, top = false) {
    x = Math.round(x); y = Math.round(y);
    return cached(x, y, top ? 1 : 0, () => { const p = rollPlants(x, y, habitatAt(x, y, top)); return p.length ? p : NONE; });
  }
  // The plants on a PLACED tile of a given biome (a region's own scrub or red rock).
  function floraPlaced(x, y, biome) {
    const bi = FLORA_PLACED_BIOMES.indexOf(biome);
    if (bi < 0) return NONE;
    x = Math.round(x); y = Math.round(y);
    return cached(x, y, 2 + bi, () => { const p = rollPlants(x, y, placedHabitat(biome)); return p.length ? p : NONE; });
  }

  // The ground an unplaced tile's plants grow on, as the habitat names it (prairie, wash, scree, …),
  // or null over the sea. The renderer picks its stone and spires by it, so a grass flat is never
  // strewn with the red rock's mesa stubs.
  const GROUND_NAMES = [null, 'prairie', 'scrub', 'badlands', 'redrock', 'wash', 'scree', 'ramp', 'cliff', 'hardpan', 'alkali', 'ash', 'basalt', 'lava', 'plateau'];
  function floraGround(x, y) {
    x = Math.round(x); y = Math.round(y);
    return GROUND_NAMES[cached(x, y, 31, () => { const h = habitatAt(x, y); return Math.max(0, GROUND_NAMES.indexOf(h ? h.biome : null)); })];
  }

  // What a walker notices growing round them: the commonest species over the tiles about them, as
  // its content line, or null on bare ground. Read off a 5×5 patch rather than the one tile, because
  // a person standing somewhere sees more than a tile's worth of country.
  function floraLine(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (W.highGroundAt(x, y) === 'cliff') return null;
    const count = new Map();
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      for (const p of floraAt(x + dx, y + dy, W.highGroundAt(x + dx, y + dy) === 'plateau')) count.set(p.id, (count.get(p.id) || 0) + 1);
    }
    let best = null, bn = 1;
    for (const [id, n] of count) if (n > bn || (n === bn && best && id < best)) { best = id; bn = n; }
    return best ? cfg.species[best].line || null : null;
  }

  return { floraAt, floraPlaced, floraLine, floraGround, habitatAt, species: () => SPECIES };
}

// ── bound to the shipped field ──────────────────────────────────────────────
const FL = createFlora(WILDLANDS_FIELD, { wildlandsAt, reliefAt, highGroundAt });
export const floraAt = FL.floraAt;
export const floraPlaced = FL.floraPlaced;
export const floraLine = FL.floraLine;
export const floraGround = FL.floraGround;
export const floraHabitat = FL.habitatAt;
export const floraSpecies = FL.species;
