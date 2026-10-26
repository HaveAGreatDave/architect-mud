// WILDLANDS — what the ground is between the placed regions, as one function of the world tile.
//
// Four things read this and must agree: the flight/cab floor (what the ground looks like), the void
// highway (the terrain its verge tiles carry), the walked void (the terrain its rooms describe) and
// the world map. Before this each made its own guess — the floor from the 73 tiles it held, the
// highway from a dice roll every 18 tiles — so a pilot, a driver and a walker crossing the same
// ground saw three different countries.
//
// The rules are here; the numbers are content. `content/map/wildlands.json` says which ground each
// region spreads into the country round it and where the landforms are, and
// scripts/content/bake-wildlands.mjs bakes that with the region distance fields into
// wildlands-field.js. Nothing in this file names a region or a place.
//
// ⚠ RENDER AND PROSE ONLY. This must never become `surfaceAt` or reach collision: "no placed tile
// here" is how regionGates and voidwalking find the edge of the world (see plugins/trucking/roadnet.js).
//
// The noise is `hnoise2`, the integer-hash lattice from landform.js, because the GL floor evaluates
// the far field in GLSL and a Math.sin hash does not survive highp.
//
// ⚠ IT IS A FACTORY, BOUND ONCE BELOW TO THE SHIPPED FIELD. The bake needs the coast and the volcano
// to carve the relief, and those are answers this file gives from the field the bake is in the
// middle of writing. Read through the shipped module instead, the bake would depend on its own
// previous output and `--check` would go stale one bake behind every region move.
import { hnoise2 } from './landform.js';
import { cellSampler, reliefTileAt, surfaceH, tierAt, tierOfH, dipAt } from './relief-rules.js';
import { chamferCells } from './relief-route.js';
import { WILDLANDS_FIELD } from './wildlands-field.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (e0, e1, v) => { const u = clamp((v - e0) / (e1 - e0), 0, 1); return u * u * (3 - 2 * u); };

const decode = (b64) => {
  if (typeof atob === 'function') { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
};

// The relief planes back to their quantised integers. The bake stores each as its residual from
// the gradient predictor (left + up - upleft), so a cell is rebuilt from the three already rebuilt
// before it; height is 16 bits, split into a high and a low byte plane.
export function decodeReliefPlanes(rf) {
  const n = rf.cw * rf.ch, cw = rf.cw;
  const pred = (a, i) => { const x = i % cw, l = x ? a[i - 1] : 0, u = i >= cw ? a[i - cw] : 0, ul = x && i >= cw ? a[i - cw - 1] : 0; return l + u - ul; };
  const hi = decode(rf.planes.hHi), lo = decode(rf.planes.hLo), h = new Uint16Array(n);
  for (let i = 0; i < n; i++) h[i] = (pred(h, i) + hi[i] * 256 + lo[i]) & 0xffff;
  const p8 = (b64) => { const r = decode(b64), a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (pred(a, i) + r[i]) & 255; return a; };
  return { h, layered: p8(rf.planes.layered), flow: p8(rf.planes.flow), wet: p8(rf.planes.wet), lake: p8(rf.planes.lake) };
}
// …and on into the units relief-rules.js reads.
function decodeRelief(rf) {
  const n = rf.cw * rf.ch, p = decodeReliefPlanes(rf);
  const out = { h: new Float32Array(n), layered: new Float32Array(n), flow: new Float32Array(n), wet: new Float32Array(n), lake: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    out.h[i] = p.h[i] / rf.q.h;
    out.layered[i] = p.layered[i] / (rf.q.frac || 255);
    out.flow[i] = p.flow[i] ? Math.pow(2, (p.flow[i] - 1) / rf.q.flow + (rf.q.flowMin || 0)) - 1 : 0;
    out.wet[i] = p.wet[i] / (rf.q.frac || 255);
    out.lake[i] = p.lake[i] / rf.q.lake;
  }
  return out;
}

export function createWildlands(F) {
  // ── the baked planes ─────────────────────────────────────────────────────────
  const P = Object.fromEntries(Object.entries(F.planes).map(([k, v]) => [k, decode(v)]));
  const REGIONS = Object.keys(F.halo);

  // Bilinear sample of a plane at a world tile. Outside the baked rect the plane is clamped, and the
  // distance planes then UNDER-report, so `inField` lets a caller know it is past the edge.
  function plane(name, x, y) {
    const a = P[name];
    const fx = clamp((x - F.x0) / F.cell, 0, F.cw - 1.001), fy = clamp((y - F.y0) / F.cell, 0, F.ch - 1.001);
    const xi = fx | 0, yi = fy | 0, u = fx - xi, v = fy - yi, i = yi * F.cw + xi;
    const p = a[i], q = a[i + 1], r = a[i + F.cw], s = a[i + F.cw + 1];
    return p + (q - p) * u + (r - p) * v + (p - q - r + s) * u * v;
  }
  // Nearest-cell read (no blend) — for a plane of CATEGORIES, where averaging two ids is meaningless.
  function planeNearest(name, x, y) {
    const cx = clamp(Math.round((x - F.x0) / F.cell), 0, F.cw - 1), cy = clamp(Math.round((y - F.y0) / F.cell), 0, F.ch - 1);
    return P[name][cy * F.cw + cx];
  }
  // The route number of the highway joining two regions (content/map/routes.json), or null.
  function routeNumber(regionA, regionB) {
    const k = [regionA, regionB].sort().join('~');
    return F.routes?.[k]?.number ?? null;
  }
  // The highway type a road between two regions is built as (content/map/routes.json `type`).
  function routeType(regionA, regionB) {
    const k = [regionA, regionB].sort().join('~');
    return F.routes?.[k]?.type || 'branch';
  }
  const wildlandsRect = () => ({ x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1 });
  const inField = (x, y) => x >= F.x0 && x <= F.x1 && y >= F.y0 && y <= F.y1;
  // Past the baked rect the country is simply "deep out": far from land, far from every region.
  const distTo = (name, x, y) => {
    if (inField(x, y)) return plane(name, x, y);
    const ox = Math.max(F.x0 - x, 0, x - F.x1), oy = Math.max(F.y0 - y, 0, y - F.y1);
    return plane(name, x, y) + Math.hypot(ox, oy);
  };

  // ── the landforms ────────────────────────────────────────────────────────────
  const LANDFORMS = F.landforms.map((l) => {
    const out = { ...l };
    if (l.plume?.toward && F.centres[l.plume.toward]) {
      const [cx, cy] = F.centres[l.plume.toward], d = Math.hypot(cx - l.x, cy - l.y) || 1;
      out.ux = (cx - l.x) / d; out.uy = (cy - l.y) / d;
    }
    return out;
  });
  const landforms = () => LANDFORMS;

  // A volcano: cone height 0..1 (0 at the foot), which part of it this is, and how much lava.
  function volcanoAt(l, x, y) {
    const dx = x - l.x, dy = y - l.y;
    const r = Math.hypot(dx, dy) + (hnoise2(x * 0.08, y * 0.08) - 0.5) * 7;
    if (r > l.radius) return null;
    const ang = Math.atan2(dy, dx), CR = l.crater;
    const h = r < CR ? 0.78 + (r / CR) * 0.2 : Math.pow(1 - (r - CR) / (l.radius - CR), 1.4);
    const tongue = Math.sin(ang * 5 + hnoise2(r * 0.07 + 11, ang * 3) * 3.5);
    const flow = Math.max(0, tongue) ** 14 * sstep(1, 0.25, h);        // old dark flows down the flanks
    const lava = Math.max(0, tongue) ** 40 * sstep(0.55, 0.95, h);     // live lava near the top
    const part = r < CR ? 'crater' : lava > 0.3 ? 'lava' : 'flank';
    return { h, part, flow, lava, crater: r < CR ? 1 - r / CR : 0 };
  }
  // Ash blown off a vent along its plume, 0..1.
  function plumeAt(l, x, y) {
    if (!l.plume || l.ux == null) return 0;
    const dx = x - l.x, dy = y - l.y, along = dx * l.ux + dy * l.uy, across = Math.abs(-dx * l.uy + dy * l.ux);
    if (along < -20) return 0;
    const w = l.plume.width + Math.max(0, along) * 0.55;
    const n = hnoise2(x * 0.05 + 3.1, y * 0.05 - 8.4);
    return clamp(sstep(w, w * 0.3, across + (n - 0.5) * 14) * sstep(l.plume.length, 40, along), 0, 1) * 0.9;
  }
  // Cone height at a tile, for the relief shading. 0 away from any volcano.
  function landformHeight(x, y) {
    let h = 0;
    for (const l of LANDFORMS) if (l.kind === 'volcano') { const v = volcanoAt(l, x, y); if (v) h = Math.max(h, v.h); }
    return h;
  }

  // ── the answer ───────────────────────────────────────────────────────────────
  //
  // { sea, blend: [[biome, weight], …] summing to 1, biome (the dominant one), terrain (a
  //   content terrain key for a tile), landform: { id, name, part } | null, into }
  //
  // `blend` is what a renderer mixes colours from; `terrain` is what a tile or a room is.
  function wildlandsAt(x, y) {
    const wob = ((hnoise2(x * 0.09, y * 0.09) - 0.5) + (hnoise2(x * 0.23, y * 0.23) - 0.5) * 0.45) * 6;
    const dL = distTo('land', x, y), dW = inField(x, y) ? plane('bay', x, y) : 1e9;
    const south = inField(x, y) ? plane('baySouth', x, y) - 128 : 0;
    // The sea: the bay running out north of itself, or anywhere north of the coast line.
    const coast = F.coastY + wob * 1.6 + (hnoise2(x * 0.018, 7.3) - 0.5) * 14;
    if ((dW + wob < dL && south > wob) || (y < coast && dL > 3 + wob * 0.5)) {
      return { sea: true, blend: [['water', 1]], biome: 'water', terrain: 'water', landform: null, into: 0 };
    }

    // The region's own edge carries on past its rim for a few tiles, so a cliff line, a lava bed or a
    // scree slope that runs into the region's border finishes instead of being cut off by it. The
    // lookup is jittered so the 4-tile bake does not show as blocks, and the edge of the band is
    // SHARP (a 1.5-tile step, noise-warped) because a mesa has a rim, not a gradient.
    if (P.edge && inField(x, y)) {
      const jx = (hnoise2(x * 0.37 + 5.1, y * 0.37) - 0.5) * 5, jy = (hnoise2(x * 0.37, y * 0.37 - 9.7) - 0.5) * 5;
      const ter = F.edgeTerrains[planeNearest('edge', x + jx, y + jy)];
      const reach = ter ? (F.edge[ter] ?? F.edge.default ?? 0) : 0;
      if (reach > 0) {
        const d = dL + (hnoise2(x * 0.19 - 2.3, y * 0.19 + 4.4) - 0.5) * reach * 0.9;
        if (d < reach) {
          // A tableland keeps its top and ends in a rim: plateau inside the band, cliff at its edge.
          const high = ter === 'cliff' || ter === 'plateau' || ter === 'ramp';
          const t = high ? (d < reach - 2 ? 'plateau' : 'cliff') : ter;
          const biome = TERRAIN_BIOME[t] || t;
          return { sea: false, blend: [[biome, 1]], biome, terrain: t, landform: null, into: 0, edge: true };
        }
      }
    }

    // Base country: dirt at the edge of the built world going over to rust mesa further out.
    const into = clamp((dL - 1) / 26, 0, 1);
    const rr = clamp(into * 0.7 + hnoise2(x * 0.06, y * 0.06) * 0.6 - 0.15, 0, 1);
    const w = new Map([['badlands', 1 - rr], ['redrock', rr]]);
    const add = (b, k) => w.set(b, (w.get(b) || 0) + k);

    // Region halos: each region's ground spreads out from its edge, warped by noise so the edge of
    // the halo is not a ring. Weights are normalised, so two halos that meet mix.
    const nz = (hnoise2(x * 0.045, y * 0.045) - 0.5) * 22 + (hnoise2(x * 0.13, y * 0.13) - 0.5) * 7;
    let sw = 0; const hw = [];
    for (const r of REGIONS) {
      const h = F.halo[r], k = sstep(h.reach, 0, distTo(r, x, y) + nz);
      if (k > 0) { hw.push([h.biome, k]); sw += k; }
    }
    if (sw > 0) {
      const keep = 1 - Math.min(1, sw) * 0.92;
      for (const [b, v] of w) w.set(b, v * keep);
      for (const [b, k] of hw) add(b, (k / sw) * Math.min(1, sw) * 0.92);
    }

    // Landforms: ash fall first (it lies over everything under the plume), then the cone itself.
    let landform = null;
    for (const l of LANDFORMS) {
      if (l.kind !== 'volcano') continue;
      const ash = plumeAt(l, x, y);
      if (ash > 0) { for (const [b, v] of w) w.set(b, v * (1 - ash)); add('ash', ash); }
      const v = volcanoAt(l, x, y);
      if (!v) continue;
      const k = sstep(0, 0.12, v.h);
      for (const [b, val] of w) w.set(b, val * (1 - k));
      if (v.part === 'crater') add('lava', k);
      // Bare basalt up high, going over to the ash the mountain has thrown on its own lower slopes.
      else { const up = sstep(0.08, 0.55, v.h); add('basalt', k * up * (1 - v.lava)); add('ash', k * (1 - up) * (1 - v.lava)); add('lava', k * v.lava); }
      if (v.h > 0.12) landform = { id: l.id, name: l.name, part: v.part, h: v.h };
    }

    const blend = [...w].filter(([, v]) => v > 0.001).sort((a, b) => b[1] - a[1]);
    const tot = blend.reduce((s, [, v]) => s + v, 0) || 1;
    for (const e of blend) e[1] /= tot;
    const biome = blend[0][0];
    return { sea: false, blend, biome, terrain: BIOME_TERRAIN[biome] || 'scrub', landform, into };
  }

  // Colour for a tile given a palette of biome → [r,g,b] (the renderer's BIOME_GROUND). The map and
  // the floor both come through here so they cannot mix a blend two different ways.
  function wildlandsColour(x, y, palette, at = wildlandsAt(x, y)) {
    let r = 0, g = 0, b = 0;
    for (const [k, v] of at.blend) { const c = palette[k] || palette.badlands; r += c[0] * v; g += c[1] * v; b += c[2] * v; }
    return [r, g, b];
  }

  // ── the relief ───────────────────────────────────────────────────────────────
  //
  // The carved country (docs/proposals/wildlands-relief.md): one eroded height field with cliff
  // bands where hard beds outcrop. Phase 2: the World Map draws it and nothing in play reads it.
  // A field baked before the relief existed has none, and both readers then answer flat ground.
  //
  // ⚠ ASK ONLY ABOUT UNPLACED GROUND. The planes hold 0 under a region, and a placed tile's terrain
  // is its own `flags.terrain`, never this.
  let V = null, D = null;
  if (F.relief) {
    const rf = F.relief, S = (p) => cellSampler(p, rf.x0, rf.y0, rf.cell, rf.cw, rf.ch);
    D = decodeRelief(rf);
    V = { h: S(D.h), layered: S(D.layered), flow: S(D.flow), wet: S(D.wet), lake: S(D.lake), caps: rf.caps, dip: rf.dip, rules: rf.rules, zScale: rf.zScale };
  }
  // { z (world z), h (tier units), tier, step, flow, wet, form, biome, terrain } or null with no relief.
  // A caller that already has wildlandsAt for the tile passes it, and saves asking twice.
  function reliefAt(x, y, at = wildlandsAt(x, y)) {
    if (!V) return null;
    const r = reliefTileAt(V, x, y, at);
    r.z = r.h * V.zScale;
    return r;
  }
  // The height of the ground at a tile, in world z. 0 under a region, at the shore and with no relief.
  const groundZ = (x, y) => (V ? surfaceH(V, x, y) * V.zScale : 0);

  // Raised ground at a tile, as the void corridor builds it: null on the valley floor (tier 0),
  // otherwise 'plateau' where no neighbour sits lower and 'cliff' where one does, so the step from
  // tier 1 up to tier 2 is a rim as much as the step up from the floor. `groundTierAt` is which band
  // the tile stands on; the corridor ships it and the windshield stacks the massif by it.
  const groundTierAt = (x, y) => (V ? tierAt(V, x, y) : 0);
  function highGroundAt(x, y) {
    if (!V) return null;
    const t = groundTierAt(x, y);
    if (t < 1) return null;
    return groundTierAt(x + 1, y) >= t && groundTierAt(x - 1, y) >= t && groundTierAt(x, y + 1) >= t && groundTierAt(x, y - 1) >= t ? 'plateau' : 'cliff';
  }

  // What the flight floor shades from, on the relief's own cells: `z` the ground height in world z
  // (smooth, no sample warp) and `w` how far into the wildlands a cell is, 0 under a region and 1
  // past a 6-tile band round its rim. The floor fades its old badland terraces out by `w` and adds
  // the relief in, so a region keeps the shading it was authored with and the country between
  // shows the cliffs the corridor builds. gl/floor.js samples the same two planes as a texture.
  // ⚠ ONE GRID FOR BOTH FLOORS. The JS raster carries the near side and the shader the far side,
  // and a field the two sampled differently is a ring of mismatched hillshade at the window edge.
  // So both read these planes, bilinear, at the same cell centres.
  let shadeP;
  function reliefShadePlanes() {
    if (shadeP !== undefined) return shadeP;
    if (!V) return (shadeP = null);
    const rf = F.relief, n = rf.cw * rf.ch, z = new Float32Array(n), w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = rf.x0 + (i % rf.cw) * rf.cell, y = rf.y0 + ((i / rf.cw) | 0) * rf.cell;
      z[i] = D.h[i] * rf.zScale;
      w[i] = sstep(0, 6, distTo('land', x, y));
    }
    const S = (p) => cellSampler(p, rf.x0, rf.y0, rf.cell, rf.cw, rf.ch);
    return (shadeP = { z, w, cw: rf.cw, ch: rf.ch, x0: rf.x0, y0: rf.y0, cell: rf.cell, zAt: S(z), wAt: S(w) });
  }

  // The relief's cells as relief-route.js reads them, built once on first use: height, tier,
  // drainage, which cells are closed (the sea, a placed region) and how far each is from raised
  // ground. About 56,000 cells; nothing builds it until a road is routed.
  let grid = null;
  function reliefGrid() {
    if (grid || !V) return grid;
    const rf = F.relief, n = rf.cw * rf.ch, d = D;
    const tier = new Int8Array(n), closed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = rf.x0 + (i % rf.cw) * rf.cell, y = rf.y0 + ((i / rf.cw) | 0) * rf.cell;
      tier[i] = tierOfH(rf.caps, d.h[i] + dipAt(rf.dip, x, y), d.layered[i]);
      if (wildlandsAt(x, y).sea || distTo('land', x, y) < 1) closed[i] = 1;
    }
    const high = chamferCells(rf.cw, rf.ch, rf.cell, (i) => tier[i] >= 1);
    grid = { cw: rf.cw, ch: rf.ch, cell: rf.cell, x0: rf.x0, y0: rf.y0, h: d.h, tier, flow: d.flow, closed, high, roads: rf.roads || {} };
    return grid;
  }

  return { wildlandsAt, wildlandsColour, landformHeight, landforms, routeNumber, routeType, wildlandsRect, inField, reliefAt, groundZ, highGroundAt, groundTierAt, reliefGrid, reliefShadePlanes, reliefView: V };
}

// Terrain → biome, for the edge band (the same mapping plugins/flight/biomes.js TERRAIN_BIOME makes
// for a placed tile; only the terrains a region edge actually carries are needed here).
const TERRAIN_BIOME = {
  dirt: 'badlands', sand: 'badlands', gravel: 'badlands', marsh: 'badlands', scree: 'badlands',
  grass: 'parkland', park: 'park', forest: 'forest', ramp: 'plateau',
};

// Biome → the content terrain key a tile or void room carries. Terrains are what the rest of the
// game (flags.terrain, prose, the auto-tiler) understands; several biomes are only colours.
export const BIOME_TERRAIN = {
  badlands: 'scrub', redrock: 'redrock', scarlet: 'redrock', ash: 'ash', scrub: 'scrub',
  hardpan: 'hardpan', basalt: 'basalt', lava: 'basalt', water: 'water',
  cliff: 'cliff', plateau: 'plateau', deadwood: 'deadwood', sinter: 'sinter', alkali: 'alkali',
};

// ── bound to the shipped field ──────────────────────────────────────────────
const W = createWildlands(WILDLANDS_FIELD);
export const wildlandsAt = W.wildlandsAt;
export const wildlandsColour = W.wildlandsColour;
export const landformHeight = W.landformHeight;
export const landforms = W.landforms;
export const routeNumber = W.routeNumber;
export const routeType = W.routeType;
export const wildlandsRect = W.wildlandsRect;
export const inField = W.inField;
export const reliefAt = W.reliefAt;
export const groundZ = W.groundZ;
export const highGroundAt = W.highGroundAt;
export const groundTierAt = W.groundTierAt;
export const reliefGrid = W.reliefGrid;
export const reliefShadePlanes = W.reliefShadePlanes;
