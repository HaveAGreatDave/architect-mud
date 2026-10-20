// The derived kit: the trim a building gets without anybody drawing it.
// derivedTrim takes a model's captured mass and has derivedKit hang windows, signs, ledges, decline
// and the rest on it, clear of what the author already bolted to the wall (faceClaim). detailLayer
// and facadeLights in windshield.js draw the result.
import {
  ARM_DETAIL, BAY, DERIVED_MAX, HANZI_BIOMES, MESH_SINK, MODERN_NEUTRAL, PICTO_HANZI_INK,
  RENDER_TUNE, SECTION_MIN, SECTION_OF, SIGN_TRADE, SIGN_WORD, SUB_MAX_ASP, TUNE, WALL_PLANE_TOL,
  _derived, _place, accentOf, armSignsItself, clamp, dRand, derivedStyle, hanziFor, hexRgb,
  placeModern, segFit, shapeForModel, spansLess, stackBox, standOnMass, tagBandFor, tagHandFor,
  tradeOf, trimPalFor, wallPanesPainted,
} from '../windshield.js';
import { FLOOR_Z } from '../../../../shared/skyline-scale.js';
import { shadeOf } from './authored-detail.js';

// ── WHAT IS ALREADY BOLTED TO THIS WALL ─────────────────────────────────────────────────────────
// Claims are the wall rectangles already spoken for, from the author (`m.detail`) and from the
// kit's own `push`, so a sign never lands on glazing. See docs/reference/building-shapes.md#face-claims.
// ⚠ A claim is only what you see through or read (glazing, louvres, shutter, sign); signs may cross
// canopies, tubes and pipes.
const FACE_CLAIM = new Set(['windowBay', 'louvreBank', 'shutter', 'signBoard', 'bladePanel', 'neonArt']);
// ── WHAT WOULD BE STANDING IN FRONT OF PAINT ────────────────────────────────────────────────
// Anything opaque between a wall and the street. Don't merge with `faceClaim`, which asks whether
// facade is free for a fitting.
// ⚠ Kerb props (via `pushKerb`, which skips the claim funnel) count here too.
// ⚠ A `pilaster` rank resolves to its fins, so a piece can be sprayed in a bay between them.
const PAINT_WALL = new Set(['windowBay', 'louvreBank', 'shutter', 'signBoard', 'bladePanel', 'neonArt', 'canopy',
  'acUnit', 'vent', 'fireEscape', 'balcony', 'ductRun', 'pipe', 'conduit', 'cableRun', 'pilaster',
  'marqueeBand', 'awning', 'tag']);
const PAINT_KERB = new Set(['binStack', 'vendingMachine', 'streetLamp', 'bollard']);
// ⚠ `scripts/shapes/tagfit.mjs` imports this; a gate must never re-derive placement itself.
export function paintFoot(d, V) {
  if (!d) return null;
  const kerb = PAINT_KERB.has(d.kind);
  if (!kerb && !PAINT_WALL.has(d.kind)) return null;
  const w = d.half != null ? V(d.half) : (d.w != null ? V(d.w) : (d.r != null ? V(d.r) : 0));
  if (!(w > 0)) return null;
  const cx = V(d.cx), plane = V(d.cy);
  // ⚠ `z` means two things: a bolted part centres on it, a standing part rests on it and rises 2·hh.
  const z0 = d.z0 != null ? V(d.z0) : (kerb ? V(d.z) : V(d.z) - V(d.hh));
  const z1 = d.z1 != null ? V(d.z1) : (kerb ? V(d.z) + 2 * V(d.hh) : V(d.z) + V(d.hh));
  const at = (c, half) => ({ x: d.face === 'x', kerb, plane, x0: c - half, x1: c + half,
    z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  // `pier` marks a fin so the riser can keep its pipes off a colonnade; see `crossesPier`.
  if (d.kind === 'pilaster') {
    const step = d.n > 1 ? V(d.step) : 0, out = [];
    for (let i = 0; i < (d.n || 1); i++) out.push({ ...at(cx + (i - ((d.n || 1) - 1) / 2) * step, w), pier: true });
    return out;
  }
  const run = (d.kind === 'bollard' && d.count > 1) ? V(d.step) * (d.count - 1) * 0.5 : 0;
  return [at(cx, w + run)];
}

function faceClaim(d, V) {
  if (!d || !FACE_CLAIM.has(d.kind)) return null;
  const half = V(d.half), cx = V(d.cx), cy = V(d.cy);
  if (!(half > 0)) return null;
  const z0 = d.z0 != null ? V(d.z0) : V(d.z) - V(d.hh);
  const z1 = d.z1 != null ? V(d.z1) : V(d.z) + V(d.hh);
  const fr = d.kind === 'windowBay' ? Math.min(half, Math.abs(z1 - z0) * 0.5) * 0.26 : 0;
  return { x: d.face === 'x', cy, x0: cx - half - fr, x1: cx + half + fr, z0: Math.min(z0, z1) - fr, z1: Math.max(z0, z1) + fr };
}

export function derivedTrim(m, fh, h, seed, forceRich) {
  let byScale = _derived.get(m);
  if (!byScale) { byScale = new Map(); _derived.set(m, byScale); }
  // Two lists per building: lean for the 2-D painter (budgeted in canvas calls), rich for the
  // GLASS 2 mesh, which is far cheaper per part.
  // ⚠ The signal is `MESH_SINK` (set by `captureModelMesh`), never `RENDER_TUNE.gl`: the 2-D painter
  // still runs in a GLASS 2 frame, and a per-view flag can't be read from a cache shared by every seat.
  const rich = forceRich != null ? !!forceRich : !!MESH_SINK;
  // ⚠ Everything that changes the list is in the key (rich, the kit flag, the place), or one cache
  // entry answers another's question. The place is quantised to a twentieth so a street shares entries.
  const mod = placeModern(_place);
  const k = fh + ':' + h + ':' + seed + ':' + (RENDER_TUNE.derivedKit ? 1 : 0) + ':' + (rich ? 1 : 0)
    + ':' + Math.round(mod * 20) + ':' + (_place && HANZI_BIOMES.has(_place.biome) ? 1 : 0)
    + ':' + (RENDER_TUNE.glazeAll ? 1 : 0);
  let list = byScale.get(k);
  if (list) return list;
  // What somebody has already drawn for this building, and which sections that covers.
  // (`noKit`: the arm's parts were placed against a mass this model leaves out.)
  const base = m.noKit ? null : (m.detail && m.detail.length) ? m.detail : (ARM_DETAIL[m.type] || null);
  const have = new Set();
  // ⚠ Counted before it's claimed; see SECTION_MIN (default one part).
  if (base) {
    const tally = new Map();
    for (const d of base) {
      const k = d.kind === 'windowBay' && d.door ? 'door' : d.kind;   // see SECTION_OF.door
      if (SECTION_OF[k]) tally.set(k, (tally.get(k) || 0) + 1);
    }
    for (const [kind, n] of tally) if (n >= (SECTION_MIN[kind] || 1)) have.add(SECTION_OF[kind]);
  }
  // ⚠ Arms sign themselves in code, so the `sign` section comes from the shape capture (SIGN_SEEN).
  if (armSignsItself(m, seed)) have.add('sign');
  // A building may decline a section outright (KIT_DECLINE).
  // ⚠ Keyed on `tradeOf`, never `m.type`: an authored model's type is the string `authored`.
  for (const s of (KIT_DECLINE[tradeOf(m)] || [])) have.add(s);
  const kit = [], glazed = [];
  const segs = shapeForModel(m, seed);
  if (segs && segs.length) {
    const V = (p) => (p ? p[0] * fh + p[1] * h + p[2] : 0);
    const A = (v) => [0, 0, v];   // the derived list resolves to absolute numbers
    // Three lists. `deck`: boxes with a real roof and a near-square footprint, for the coping ring.
    // `cand`: any wall a part can mount on (a barrel-roofed shed has `roof: false` and still counts).
    // `mass`: every box, however thin, for what's in the way (`massAhead`).
    const cand = [], deck = [], mass = [];
    for (const sg of segs) {
      if (sg.kind !== 'box' || (sg.yaw || 0)) continue;
      const { cx, cy, hw, fd } = segFit(sg, V);
      const z1 = V(sg.z1), z0 = V(sg.z0);
      if (!(z1 > z0) || !(hw > 0.008)) continue;
      const e = { sg, hw, fd, z0, z1, cx, cy };
      mass.push(e);
      if (!(hw > 0.03)) continue;
      cand.push(e);
      if (sg.roof !== false && Math.abs(hw - fd) <= 0.02) deck.push(e);
    }
    cand.sort((a, b) => b.z1 - a.z1);
    deck.sort((a, b) => b.z1 - a.z1);

    // ── DRUMS ────────────────────────────────────────────────────────────────────────────────
    // A cylinder tower gets collars so it has something to judge its size against.
    // ⚠ Only a shaft (taller than three radii) takes collars; masts and discs are drums too.
    // ⚠ Size each band off the radius at its height (`rAt`), since shafts taper.
    const shafts = [];
    for (const sg of segs) {
      if (sg.kind !== 'drum') continue;
      const z0 = V(sg.z0), z1 = V(sg.z1), rb = V(sg.rb), rt = V(sg.rt != null ? sg.rt : sg.rb);
      const rm = Math.max(rb, rt);
      if (!(z1 > z0) || !(rm > 0.05)) continue;
      if (!((z1 - z0) > rm * 3.0)) continue;          // a shaft, not a lid, a disc, a bead or a silo
      shafts.push({ sg, z0, z1, rb, rt, cx: V(sg.cx), cy: V(sg.cy), n: Math.max(8, sg.n || 16) });
    }
    shafts.sort((a, b) => (b.z1 - b.z0) - (a.z1 - a.z0));
    for (const s of shafts.slice(0, 2)) {
      const rAt = (z) => s.rb + (s.rt - s.rb) * clamp((z - s.z0) / Math.max(1e-4, s.z1 - s.z0), 0, 1);
      const span = s.z1 - s.z0;
      // A collar about every fifth floor, counted off the storey height.
      const storey = FLOOR_Z * (RENDER_TUNE.bldgH || 1) * (RENDER_TUNE.bldgStretch || 1);
      const floors = Math.max(1, Math.round(span / Math.max(1e-4, storey)));
      const every = Math.max(4, Math.round(floors / 5));
      // ⚠ Rationed (at most three bands, twelve facets): collars land on every shaft in the city, and
      // five bands at full facets grew the registry mesh 11.5%.
      const bands = clamp(Math.floor(floors / every), 1, 3);
      const cn = Math.min(s.n, 12);
      if (!have.has('collar')) {
        for (let i = 1; i <= bands; i++) {
          const z = s.z0 + span * (i / (bands + 1));
          kit.push({ kind: 'collar', cx: [0, 0, s.cx], cy: [0, 0, s.cy], z: [0, 0, z],
            r: [0, 0, rAt(z) * 1.045], hh: [0, 0, Math.min(span * 0.05, rAt(z) * 0.09)], n: cn, pal: A.trim });
        }
        // The crown course at the head of the shaft.
        kit.push({ kind: 'collar', cx: [0, 0, s.cx], cy: [0, 0, s.cy], z: [0, 0, s.z1 - span * 0.035],
          r: [0, 0, s.rt * 1.07], hh: [0, 0, Math.min(span * 0.045, s.rt * 0.13)], n: cn, pal: A.trim });
      }
      // ⚠ Rich list only: the 2-D painter would pay for every fin at every distance.
      if (rich && !have.has('drumfin') && span > rAt(s.z0) * 3) {
        kit.push({ kind: 'drumfin', cx: [0, 0, s.cx], cy: [0, 0, s.cy],
          z0: [0, 0, s.z0 + span * 0.04], z1: [0, 0, s.z1 - span * 0.06],
          r: [0, 0, rAt((s.z0 + s.z1) / 2)], n: Math.min(s.n, 10),
          out: [0, 0, rAt(s.z0) * 0.05], hw: [0, 0, rAt(s.z0) * 0.030], pal: A.trim });
      }
    }

    // A squat drum (a rotunda, a storey high) takes one cornice collar. Never a dressed shaft or a
    // cone. Two per building at ten facets.
    if (!have.has('collar')) {
      const tiers = [];
      const dressed = new Set(shafts.slice(0, 2).map((x) => x.sg));
      for (const sg of segs) {
        if (sg.kind !== 'drum' || dressed.has(sg)) continue;
        const z0 = V(sg.z0), z1 = V(sg.z1), rb = V(sg.rb), rt = V(sg.rt != null ? sg.rt : sg.rb);
        const rm = Math.max(rb, rt);
        if (!(rm >= 0.12) || !(z1 - z0 >= 0.05) || !(z1 - z0 >= rm * 0.6)) continue;   // a storey, not a disc
        if (!(rt >= rb * 0.7)) continue;                                                  // not a cone
        tiers.push({ sg, z0, z1, rt, cx: V(sg.cx), cy: V(sg.cy), n: Math.max(8, sg.n || 16) });
      }
      tiers.sort((p, q) => q.rt - p.rt);
      for (const t of tiers.slice(0, 2)) {
        const span = t.z1 - t.z0;
        kit.push({ kind: 'collar', cx: [0, 0, t.cx], cy: [0, 0, t.cy], z: [0, 0, t.z1 - span * 0.06],
          r: [0, 0, t.rt * 1.05], hh: [0, 0, Math.min(span * 0.06, t.rt * 0.08)], n: Math.min(t.n, 10), pal: A.trim });
      }
    }

    if (!have.has('cope')) {
      for (const { sg, hw, z0, z1 } of deck.slice(0, DERIVED_MAX)) {
        kit.push({
          kind: 'parapet',
          cx: [0, 0, V(sg.cx)], cy: [0, 0, V(sg.cy)],
          z: [0, 0, z1],
          half: [0, 0, hw * 1.03],
          // About a third of a storey, so the deck reads as sitting inside it.
          hh: [0, 0, clamp((z1 - z0) * 0.07, 0.016, 0.072)],
          pal: sg.pal || m.pal,
          // ⚠ Only the roof-edge ring bleeds (the kit's plinth and crown parapets don't). About half.
          bleed: dRand(seed, 81) > 0.48 ? 1 : 0,
        });
      }
    }
    // ⚠ The arm's masts live on `segs.spars`, off the array; the kit needs them to keep hoardings clear.
    const spars = (segs.spars || []).map((s) => ({ cx: V(s.cx), cy: V(s.cy), z0: V(s.z0), z1: V(s.z1) }));
    // The author's parts on and in front of these walls, resolved to plain numbers.
    const claims = [];
    if (base) for (const d of base) { const c = faceClaim(d, V); if (c) claims.push(c); }
    const blocks = [];
    if (base) for (const d of base) { const f = paintFoot(d, V); if (f) for (const r of f) blocks.push(r); }
    if (cand.length) derivedKit(kit, cand, deck, m, seed, A, have, rich, spars, mod, _place, claims, blocks, mass, glazed);
  }
  // ⚠ Concatenate, never mutate `base`: it's a shared module constant or the baked model record.
  // Normalised by standOnMass before caching.
  list = standOnMass(base ? base.concat(kit) : kit, segs,
    (p) => (Array.isArray(p) ? p[0] * fh + p[1] * h + p[2] : (p || 0)));
  // The walls the kit put real windows on, for `captureModelMesh` to bake bare. See `glazeWalls`.
  if (glazed.length) list.glazed = glazed;
  byScale.set(k, list);
  return list;
}

// The kit itself: what the walls do, what stands on the roof, and what the ground floor is.
//
// ⚠ Every part is budgeted. `KIT_MAX` is the per-building ceiling, spent on the biggest surfaces
// first; lean is the 2-D fallback (tuned on `framecost`), rich feeds GLASS 2 and is counted in mesh
// faces against `gl:mesh`. Re-measure before raising; see docs/reference/glass-notes.md#derived-kit-budget.
const KIT_MAX = 26, KIT_MAX_RICH = 56;
// ⚠ A fixed number, never a share of KIT_MAX, so raising the ceiling for silhouette doesn't grow windows.
const WIN_SHARE_RICH = 23;
const WIN_MAX = 9, WIN_MAX_RICH = 40;   // windows per facade
const FLOOR_MAX = 6, FLOOR_MAX_RICH = 8;
const COL_MAX = 3, COL_MAX_RICH = 5;
const COL_PITCH_RICH = 0.085;
// Types the kit never touches.
// ⚠ Walls: the same tile repeats and each derives a different "front", so one-sided parts read as noise.
// ⚠ Jetty, yards and plots: their decks are unyawed boxes the kit would glaze like walls.
const NO_KIT = new Set(['trm_wall', 'thornwall', 'damwall', 'pier', 'harbour_yard', 'lighthouse', 'quay_crane', 'pontoon', 'fuel_dock', 'car_park', 'staff_lot', 'vacant_plot',
  // Each draws all four of its own sides (building-styles.md §4.3).
  'gym', 'boatshed', 'landing_stage',
  // The Coliseum draws all nine tiles itself; a bare-type tile would get a hoarding over the field.
  'ballpark',
  // The land office's board is its only box, so the kit read it as a wall.
  'land_office']);
// Spray colours: saturated and light, since a tag is read against a dark wall.
export const TAG_COLS = ['#b8f03a', '#ff4a9a', '#5fd0ff', '#ffcf3e', '#ff6a4a', '#c88cff'];
// ── A BUILDING MAY REFUSE ONE SECTION WITHOUT REFUSING THE KIT ─────────
// `have` keeps the kit out of a section somebody drew; KIT_DECLINE is for a section nobody should
// draw. ⚠ The test is that the part would be wrong on that building whoever built it. An arm that
// just has taste about its facade should draw the facade.

// What the slum trades decline, as one list so they can't drift. `paint` is here because kit paint
// is a lit throw-up that reads as a sign; the arms paint their own walls with `slumScrawl`.
const SLUM_DECLINE = ['sign', 'signRoof', 'neon', 'ground', 'roof', 'stair', 'cope', 'wall', 'paint'];
// ── BUILDINGS NOBODY IS GOING TO WASH ────────────────────────────
// Trades that get a `grime` run down a bare face. ⚠ Keep it short: every wall already weathers via
// `matGrain`. ⚠ Not the other slum trades: their frontmost box is a canopy or stall, so the run hangs
// in open air.
const GRIME_TRADE = new Set(['ruin']);
// Trades whose front is symmetric, so the riser's downpipe is hung on both flanks rather than one.
const RISER_PAIR = new Set(['meridian']);
const KIT_DECLINE = { meridian: ['signRoof', 'wall', 'pier'],   // 'wall' and 'pier': the kit's ribbon glazing and fins hid the deco skin, which has its own windows
  // The clinic emblem is drawn by `emitFlat`, which the shape capture can't see, so a hoarding would
  // stand through it. The embassy and meridian cut their names in stone.
  clinic: ['signRoof'], stitch: ['signRoof'], embassy: ['signRoof'],
  // An empty shop has no tenant paying for a neon tube; the rest of its kit stays.
  vacantunit: ['neon'],
  // Aurelia's highest deck is a lit vitrine lid.
  atelier: ['signRoof'],
  // Jolene's sign is the owner's likeness in neon; a container has no fire escape.
  honkytonk: ['signRoof', 'stair', 'neon', 'paint'],
  // The highest deck on these is a gas drum lid, a fan plate and a live gantry.
  gasholder: ['signRoof'], cooling_plant: ['signRoof'], substation: ['signRoof', 'ground'],
  // Mains Squeeze's highest deck is its header tank.
  water_seller: SLUM_DECLINE,
  // Highest deck is a weighbridge canopy and a palisade; every opening is the arm's own.
  weigh_station: ['signRoof', 'wall'], vehicle_pound: ['signRoof', 'wall'],
  // These stand under the outer lock hall's low roof.
  glacis_booth: SLUM_DECLINE, gate_post: SLUM_DECLINE,
  // Nothing in the Shingles carries words or assumes a landlord: no window grid, shopfront, roof
  // plant, fire escape or neat coping. `riser` stays.
  flophouse: SLUM_DECLINE, soup_kitchen: SLUM_DECLINE, bonesetter: SLUM_DECLINE, shebeen: SLUM_DECLINE,
  cornershop: SLUM_DECLINE,   // Bare Necessities, the Rag Row lock-up: an authored model, so it names its trade
  ruin: SLUM_DECLINE,
  // Second Helpings is one storey with its name on the fascia; the clone facility draws its own front.
  helpings: ['signRoof', 'wall', 'stair'], clone: ['stair', 'wall', 'riser'],
  // Batter Days draws one fogged window and paints its own name.
  chip_shop: ['ground', 'wall', 'signRoof', 'sign'],
  // These draw their own shopfront, windows or blank front.
  coffee_shop: ['ground', 'wall', 'signRoof', 'stair'],
  taxidermist: ['ground'],
  tattooist: ['wall'], lending_library: ['wall', 'ground'],
  strip: ['wall', 'signRoof', 'stair'],
  // ⚠ These draw their own door (glass/entrance.js); their lowest box isn't a shop.
  grindhouse: ['ground'], winter_garden: ['ground'],
  off_licence: ['ground', 'wall'],
  // ⚠ The institute is a drum with one box (a frieze plate high up); the fish works has no glazing.
  institute: ['ground', 'wall'], fishmonger: ['ground', 'wall'],
  // Both draw their own openings, roofs and light.
  incinerator: ['signRoof', 'wall', 'ground', 'neon', 'roof', 'stair', 'cope'],
  twocell: ['signRoof', 'wall', 'ground', 'neon', 'roof', 'stair', 'cope', 'riser'],
  // ⚠ Every Solenne plate is yawed, so the kit's highest deck is plate 0, a ledge near the podium.
  // The roof is a helideck and nothing may stand on it.
  solenne: ['ground', 'stair', 'roof', 'signRoof'],
  // Solenne's neighbours and Corbett draw their own trim (docs/proposals/marrow-midrises.md).
  kestrelcourt: ['signRoof', 'riser', 'neon'],
  marrowhouse: ['signRoof', 'stair', 'riser', 'neon'],
  corbettmansions: ['signRoof', 'neon'],
  // The Slip carries no lettering at all.
  slipback: ['sign', 'signRoof', 'neon', 'stair'],
  // St Garneau's draws its own portals and openings; the only lit thing is the plate over the door.
  // A window grid would land glazing over the portals. It keeps cope, riser and stair.
  church: ['signRoof', 'neon', 'ground', 'roof', 'wall'],
  // A hand-cart and a tarp camp have no landlord to put up a hoarding or plant. They keep their
  // hand-lettered name board, so they aren't UNSIGNED_TRADE.
  slagwares: ['signRoof', 'roof'], campgiardia: ['signRoof', 'roof'],
  // ⚠ This key repeats `fishmonger` above, so this later entry is the one that applies.
  fishmonger: ['signRoof'],
  // Sump has no sign, window or name over the door.
  sump: ['sign', 'signRoof', 'neon', 'wall', 'paint'],
  // Halcyon building sites: the arm prints the name on the hoarding, and nothing unfinished gets neon.
  ...Object.fromEntries(['shell_tower', 'hf_frame', 'hf_jumpform', 'hf_wrap', 'hf_scaffold', 'hf_stalled',
    'hf_hoist', 'hf_halfbuilt', 'hf_climber', 'hf_flood', 'hf_topout'].map((t) => [t, ['signRoof', 'neon']])) };
// Halcyon Fields signs in brushed metal and white light, never a neon tube. Every palette in the
// quarter starts `ty_hf`.
const quietSign = (pal) => typeof pal === 'string' && pal.startsWith('ty_hf');
// ── BUILDINGS THAT DON'T PUT THEIR NAME UP ────────────────────
// ⚠ Keyed on trade, never palette: `derivedStyle` reads the palette, and a power station faced in
// `window grid` would classify as `block` and get a shopfront and a name board.
// ⚠ The building's own signage only. The gable ad panel isn't gated on this: a works still rents its wall.
// `signWorks` on the model opts a works back in.
const UNSIGNED_TRADE = new Set([
  // Power and utility.
  'power', 'dynamo', 'dw_turbine', 'trm_charge', 'signalbox', 'damwall', 'interstack', 'trm_cistern',
  // Heavy industry and processing. The incinerator letters its own gate plate in its arm.
  'foundry', 'fabrication', 'ff_kiln', 'dw_forge', 'sw_foundry', 'sw_kiln', 'asc_vats',
  'clone', 'asc_weave', 'refinery', 'incinerator',
  // Freight, storage and yards: a shed with a number on the door.
  'warehouse', 'container_yard', 'cold_storage', 'junkyard', 'truck_depot', 'dw_depot', 'sw_depot',
  'trm_depot', 'wharf', 'hangar', 'reefer', 'fuel_yard',
  // The terminal's arms draw ARRIVALS and DEPARTURES themselves.
  'atc', 'arrivals', 'departures',
  // The jetty and marina: no wall to letter, or the arm letters itself.
  'pier', 'harbour_yard', 'lighthouse', 'quay_crane',
  'pontoon', 'boathouse', 'fuel_dock',
  // St Garneau's identifies itself by the building; its only lit thing is the plate over the door.
  'church',
  // A ruin's `building_name` isn't a trading name.
  'ruin',
  // The Shingles carry no lit sign. This also keeps the roundel out, which doesn't ask KIT_DECLINE.
  'flophouse', 'soup_kitchen', 'bonesetter', 'shebeen', 'water_seller', 'cornershop',
]);
// One answer for the name board, the corner blade and the roof hoarding, so they can't disagree.
const signsItself = (m, style) => !!m.signWorks || (style !== 'works' && !UNSIGNED_TRADE.has(tradeOf(m)));
// ── BUILDINGS SOMETHING DRIVES INTO ────────────────────────────────────
// Trades whose works shutter is dressed as a loading bay. Unlisted trades keep a plain shutter.
// ⚠ Don't fold into UNSIGNED_TRADE: "advertises itself" and "takes vehicles" disagree both ways.
const BAY_TRADE = new Set([
  // Freight, storage and yards.
  'warehouse', 'container_yard', 'cold_storage', 'junkyard', 'truck_depot', 'dw_depot', 'sw_depot',
  'trm_depot', 'wharf', 'hangar', 'reefer', 'fuel_yard', 'freight_forwarder', 'forwarder', 'bonded',
  // Heavy industry and anything with a shop floor.
  'foundry', 'fabrication', 'ff_kiln', 'dw_forge', 'sw_foundry', 'sw_kiln', 'refinery',
  'dw_winding', 'dw_stores', 'slagwares',
  // A sound stage is a shed with a truck door, whatever it makes.
  'studio', 'ksabstudio',
  // ⚠ Never `vacantunit`: the numbered units are shops in parades, and nothing drives into them.
]);
// Trades that won't carry somebody else's hoarding either: plant hung with catenary and pipework
// (the wires cross the board), and ruins, which have nobody to rent the wall from.
const NO_AD_TRADE = new Set(['power', 'dynamo', 'dw_turbine', 'trm_charge', 'signalbox', 'damwall',
  'interstack', 'foundry', 'fabrication', 'ff_kiln', 'dw_forge', 'sw_foundry', 'sw_kiln', 'asc_vats',
  'clone', 'refinery', 'fuel_yard', 'ruin',
  // The rest of the Shingles: nobody rents a wall in Old Coldwater.
  'flophouse', 'soup_kitchen', 'bonesetter', 'shebeen', 'water_seller', 'cornershop',
  // The airfield carries its own terminal boards and nobody else's.
  'atc', 'arrivals', 'departures']);
// ⚠ Read `RENDER_TUNE`, never the per-view `TUNE`: the list is cached per model and shared by every view.
// `cand` and `deck` are as in derivedTrim.
function derivedKit(list, cand, deck, m, seed, A, have, rich, spars = [], mod = MODERN_NEUTRAL, place = null, claims = [], blocks = [], mass = cand, glazed = []) {
  if (!RENDER_TUNE.derivedKit || NO_KIT.has(m.type) || m.noKit) return;
  const wants = (s) => !have.has(s);   // a section somebody already drew is theirs; stay out of it
  const pal = m.pal;
  // What the openings are dressed in (see trimPalFor); a surround in the wall colour reads as paint.
  const wpal = trimPalFor(m);
  const top = cand[0].z1;
  const main = cand.slice().sort((a, b) => (b.z1 - b.z0) * b.hw - (a.z1 - a.z0) * a.hw)[0];   // the biggest wall
  const style = derivedStyle(m, main.hw, top);
  const R = (salt) => dRand(seed, salt);
  // ── HOW LIT THIS STREET IS ────────────────────────
  // Every lit, signed or glazed part rolls against `gateFor(base)`, which `mod` (the district's
  // modernity, see `placeModern`) shifts. ⚠ It moves a gate, never a size: a poor district gets
  // fewer lit parts, not dimmer ones.
  const gateFor = (g) => clamp(g + (MODERN_NEUTRAL - mod) * 0.55, 0.03, 0.97);
  // About one building in nine is PERIOD: no neon, blade, roof hoarding or ribbon glazing. Rolled
  // against the district, so holdouts cluster in the modern west where they stand out.
  const period = R(401) > 0.80 + (1 - mod) * 0.19;
  const kitMax = rich ? KIT_MAX_RICH : KIT_MAX;
  const winMax = rich ? WIN_MAX_RICH : WIN_MAX;
  let spent = 0;
  // ⚠ Claims are recorded at the one funnel (`push`), never per section, so none can be forgotten.
  // Kit parts resolve through `A()`, so the absolute value is the triple's third term.
  const KA = (p) => (Array.isArray(p) ? p[2] : (p || 0));
  // ⚠ The window grid tests against the author's claims only, snapshotted before any push; against
  // the growing list it would refuse every bay after its first.
  const authorClaims = claims.slice();
  const clearOfAuthor = (fyP, x0, x1, z0, z1) => authorClaims.every((c) => c.x
    || Math.abs(c.cy - fyP) > 0.06
    || x0 > c.x1 + 0.012 || x1 < c.x0 - 0.012 || z0 > c.z1 + 0.012 || z1 < c.z0 - 0.012);
  // What stands in front of paint (see `paintFoot`), recorded at both funnels, `push` and `pushKerb`.
  const mark = (p) => { const f = paintFoot(p, KA); if (f) for (const r of f) blocks.push(r); };
  // The author's pilaster fins: a pipe or duct must never cross a colonnade.
  const authorPiers = blocks.filter((b) => b.pier && !b.x);
  const crossesPier = (plane, x0, x1, z0, z1) => authorPiers.some((b) => Math.abs(b.plane - plane) <= 0.06
    && x0 < b.x1 + 0.006 && x1 > b.x0 - 0.006 && z0 < b.z1 && z1 > b.z0);
  const push = (p) => {
    if (spent >= kitMax) return;
    list.push(p); spent++;
    const c = faceClaim(p, KA); if (c) claims.push(c);
    mark(p);
  };
  // ⚠ The window grid has its own cap: it's pushed first, and uncapped it eats the budget of every
  // later section, name board included. Kept under half, since the wall texture already draws windows.
  let winSpent = 0;
  const winCap = rich ? Math.min(winMax, WIN_SHARE_RICH) : winMax;
  const pushWin = (p) => { if (winSpent < winCap) { winSpent++; push(p); } };
  // The kerb props are pushed last, so they get a reserve past `kitMax` (one per kerb kind). It's
  // inert today; it's insurance against a bigger grid or a new section starving them.
  // ⚠ A sweep that gives every model one seed samples each roll once per seed; use many seeds.
  const KERB_RESERVE = 4;
  const pushKerb = (p) => { if (spent < kitMax + KERB_RESERVE) { list.push(p); spent++; mark(p); } };

  // ── 1. THE WALLS ──────────────────────────────────────────────────────────
  // Windows go on the front face of the biggest box, in whole storeys of ~0.17 (as `buildingScaleFor`).
  // ⚠ The ground floor and name band are derived once, here, for every section that reads them.
  const base = cand[cand.length - 1];
  const by = base.cy + base.fd, bh = base.z1 - base.z0;
  const GF = Math.min(bh * 0.62, 0.115);           // the shopfront band's height above the pavement
  // ── WHERE THE NAME GOES, DECIDED ONCE ──────────────────────────────────────────────────────
  // ⚠ The neon tube clears `signTop`; derived separately, it ran through the name board.
  const signHH = Math.min(Math.min(base.hw * 0.62, 0.19) * 0.3, 0.04);
  const signZ = base.z0 + GF + 0.036;
  const signTop = signZ + signHH;

  const fy = main.cy + main.fd;                      // the front face plane of the biggest mass
  const wallH = main.z1 - main.z0;
  // Where the crown course sits (drawn in section 6); anything that must clear it reads it here.
  const courseZ = main.z1 - Math.max(wallH * 0.16, 0.05);
  const courseHH = clamp(wallH * 0.045, 0.012, 0.03);
  const floors = clamp(Math.round(wallH / 0.17), 1, rich ? FLOOR_MAX_RICH : FLOOR_MAX);
  // ── IS THIS PATCH OF THE FRONT WALL FREE? ──────────────────────────────────────────────────
  // Tests against every claim (see `faceClaim`). `SIGN_GAP` is the bare wall a sign needs beside a
  // window. ⚠ The plane tolerance is loose on purpose: stacked boxes' faces differ by thousandths.
  const SIGN_GAP = 0.012;
  const clearsFace = (x0, x1, z0, z1) => claims.every((c) => c.x || Math.abs(c.cy - fy) > 0.06
    || x0 > c.x1 + SIGN_GAP || x1 < c.x0 - SIGN_GAP || z0 > c.z1 + SIGN_GAP || z1 < c.z0 - SIGN_GAP);
  // ── IS THIS PATCH OF ANY WALL BARE AND VISIBLE, FOR PAINT? ──────────────────────────────
  // Against `blocks` (see `paintFoot`), on all four walls.
  // ⚠ Kerb props are matched on the street face only: their loose plane tolerance would reach the
  // back wall of a shallow building.
  const paintFree = (face, plane, x0, x1, z0, z1, street) => blocks.every((b) => !!b.x !== !!face
    || (b.kerb ? (!street || Math.abs(b.plane - plane) > 0.22) : Math.abs(b.plane - plane) > 0.06)
    || x0 > b.x1 || x1 < b.x0 || z0 > b.z1 || z1 < b.z0);

  // ── LIFT A BAND OVER THE FITTINGS ON ITS WALL ────────────────────
  // The fittings half of `clearOfMass` (fire escapes, risers and piers are in `blocks`, not mass).
  // ⚠ It only lifts, and returns `z` unchanged when nothing fits above: never delete a name.
  const overFittings = (face, plane, mid, half, hh, z, ceil) => {
    let top = null;
    for (const b of blocks) {
      if (!!b.x !== !!face || b.kerb) continue;
      if (Math.abs(b.plane - plane) > WALL_PLANE_TOL) continue;
      if (mid - half > b.x1 || mid + half < b.x0) continue;
      if (z - hh > b.z1 || z + hh < b.z0) continue;
      if (top === null || b.z1 > top) top = b.z1;
    }
    if (top === null) return z;
    const up = top + hh + SIGN_GAP;
    return up + hh <= ceil ? up : z;
  };
  // ── WHERE IT CAN'T BE LIFTED, THE BARE WALL BESIDE THE FITTINGS ─────────────────────
  // For a stair that reaches the parapet. The graffiti gap solver (`spansLess`), widest bare run.
  // ⚠ A name may not shrink below `floor`; null puts the caller back on "half read beats nameless".
  const NAME_RUN_PAD = 0.008;
  // ⚠ A fixed floor: a band that shrinks until it fits always fits, and the test could never fail.
  const NAME_RUN_MIN = 0.45;
  const besideFittings = (face, plane, mid, half, hh, z, floor) => {
    const runs = spansLess([[mid - half, mid + half]], blocks
      .filter((b) => !!b.x === !!face && !b.kerb
        && Math.abs(b.plane - plane) <= WALL_PLANE_TOL
        && !(z - hh > b.z1 || z + hh < b.z0))
      .map((b) => [b.x0 - NAME_RUN_PAD, b.x1 + NAME_RUN_PAD]));
    if (!runs.length) return null;
    const g = runs.reduce((a, r) => (r[1] - r[0] > a[1] - a[0] ? r : a));
    const w = (g[1] - g[0]) * 0.5;
    return w >= floor ? { cx: (g[0] + g[1]) * 0.5, half: w } : null;
  };

  // ── IS THE BUILDING'S OWN MASS IN FRONT OF IT? ───────────────────────────────────
  // A shopfront slab trimmed to the plot line stands proud of the facade and buries a name behind
  // it in a depth buffer. The plane tests above can't see it; see
  // docs/reference/building-shapes.md#names-buried-by-their-own-mass.
  const MASS_EPS = 0.012;
  // The top of whatever mass stands between this patch and the street, or null when clear. `flank`
  // swaps to the rotated frame; `mid` is the patch's centre along the wall.
  // ⚠ `out` is passed in, never read off the sign of `plane`: a mass offset back over its yard has a
  // negative front plane that still faces +y.
  const massAhead = (flank, out, plane, mid, half, z0, z1) => {
    let top = null;
    for (const c of mass) {
      const ctr = flank ? c.cx : c.cy, ext = flank ? c.hw : c.fd;      // along the wall's normal
      if (out * ctr + ext <= out * plane + MASS_EPS) continue;         // behind the paint, or is it
      const across = flank ? c.cy : c.cx, aH = flank ? c.fd : c.hw;    // along the wall
      if (mid - half > across + aH || mid + half < across - aH) continue;
      if (z0 > c.z1 || z1 < c.z0) continue;
      if (top === null || c.z1 > top) top = c.z1;
    }
    return top;
  };
  // Lifts the band over mass in front of it while it fits under `ceiling`; four passes, since
  // clearing one box can expose a taller one. ⚠ It only moves the band up its own wall (never
  // declines, never seats forward), and reports `clear` so callers can tell readable from unmoved.
  const clearOfMass = (flank, out, plane, mid, half, hh, z, ceiling) => {
    for (let i = 0; i < 4; i++) {
      const top = massAhead(flank, out, plane, mid, half, z - hh, z + hh);
      if (top === null) return { z, clear: true };
      const nz = top + Math.max(hh * 0.5, 0.014) + hh;
      if (nz + hh > ceiling) break;
      z = nz;
    }
    return { z, clear: false };
  };

  // ── WHICH CORNERS THE SIGNAGE WILL WANT, DECIDED BEFORE THE GLAZING GOES UP ─────────────────
  // ⚠ Reserved before section 1 glazes, or section 4's blades only ever see a full wall.
  // ⚠ Rolls are pure, so reading them early moves nothing; section 4 reads these, never a second copy.
  const bladeSgn = R(311) > 0.5 ? 1 : -1;
  const hz = hanziFor(m);
  const tradePicto = (style !== 'works' && (SIGN_TRADE[tradeOf(m)] || ['', ''])[1]) || '';
  // How far glazing may reach per side (fraction of `main.hw`) once a sign of half-width `w` hangs
  // at 0.84. `Infinity` means nothing reserved.
  // ⚠ The reserve must exceed `clearsFace`'s strict gap and cover the window surround, or the sign
  // is refused on its own reserved corner.
  const SIGN_CLEAR = SIGN_GAP * 2 + 0.012;
  const reserveFor = (w) => 0.84 - (2 * w + SIGN_CLEAR) / main.hw;
  // Too narrow for both, the wall keeps its windows and the fitting isn't offered.
  const fitsBeside = (w) => reserveFor(w) >= 0.34;
  let resL = Infinity, resR = Infinity;
  const takeCorner = (sgn, w) => {
    const r = reserveFor(w);
    if (sgn > 0) resR = Math.min(resR, r); else resL = Math.min(resL, r);
  };
  const nameBw = clamp(main.hw * 0.15, 0.02, 0.05);
  const hzBw = clamp(main.hw * 0.13, 0.018, 0.042);
  // A roundel is square (half-width is half-height), sized like the blade it stands in for.
  const rdR = Math.min(main.hw * 0.15, 0.05);
  const signable = rich && !period && signsItself(m, style) && main.hw > 0.1;
  const nameBladeOK = signable && wants('sign') && wallH > 0.26 && fitsBeside(nameBw) && R(309) > gateFor(0.45);
  // ── ⚠ ONE TRADE FITTING PER FRONTAGE, NEVER TWO ────────────────────────────────────────────
  // The Chinese trade blade and the mark roundel say the same thing. The blade wins where eligible.
  const hanziOK = signable && !!hz && !!place && HANZI_BIOMES.has(place.biome)
    && wallH > 0.2 && fitsBeside(hzBw) && R(315) > gateFor(0.42);
  // ⚠ The roundel is also the blade's fallback (the blade can still be refused by `clearsFace`), so
  // it isn't gated on `!hanziOK`; section 4 reads `tradeHung`. It has its own roll.
  const roundelOK = signable && !!tradePicto && wallH > 0.2 && fitsBeside(rdR) && R(317) > gateFor(0.34);
  if (nameBladeOK) takeCorner(bladeSgn, nameBw);
  // One corner, whichever of the two ends up on it, so the reserve has to clear the wider of them.
  if (hanziOK || roundelOK) takeCorner(-bladeSgn, Math.max(hanziOK ? hzBw : 0, roundelOK ? rdR : 0));
  // ── WHERE AN UNSIGNED WORKS PAINTS ITS NAME ─────────────
  // A works with no board gets its name painted in stencil (`signBoard` with `bare`). Derived once,
  // since the louvres (section 1) and the paint (section 3b) both read it.
  // ⚠ 0.66 of the wall clears the crown course above and the louvres below at every height.
  // ⚠ `style === 'works'`, never just `!signsItself`: an unsigned `block` has a window grid to paint over.
  const paints = wants('sign') && style === 'works' && !signsItself(m, style)
    && wallH > 0.12 && main.hw > 0.1;
  const nameHH = Math.min(wallH * 0.085, 0.05);
  const nameZ = main.z0 + wallH * 0.66;
  // The louvres sit under the painted name, measured from its underside.
  const louvHH = Math.min(wallH * 0.16, 0.05);
  const louvZ = paints ? nameZ - nameHH - Math.max(wallH * 0.07, 0.025) - louvHH
    : main.z0 + wallH * 0.62;
  if (wants('wall') && style !== 'works' && wallH > 0.14 && main.hw > 0.12) {
    // ⚠ The grid is budgeted (`winMax`), keeping floors over columns: storeys are what read.
    // Glazing reaches 0.75 per side (0.76 for the ribbon), narrowed only by a corner reservation.
    const gl = Math.min(0.75, resL), gr = Math.min(0.75, resR);
    // ⚠ Columns come off the band, not the wall, so a narrowed band gets fewer panes, not crowded ones.
    const cols0 = clamp(Math.round((main.hw * (gl + gr)) / (1.5 * (rich ? COL_PITCH_RICH : 0.13))), 1, rich ? COL_MAX_RICH : COL_MAX);
    const cols = clamp(Math.floor(winMax / floors), 1, cols0);
    const cw = (main.hw * (gl + gr)) / cols;          // leave a pier at each end
    let litN = 0, litZ = 0;      // how many panes are lit and where their middle is
    // A pane's width comes off its height so it's always portrait, clamped by the pitch.
    const wh = Math.min(0.042, wallH / (floors * 2.9)), ww = Math.min(cw * 0.33, wh * 0.68);
    // Not every pane is lit. ⚠ Rolls are seeded off the tile, never per frame (`models:diff` asserts
    // two renders match). ⚠ Only the night `glow` varies; a per-pane day colour read as holes.
    const warm = style === 'front' ? '#bfe4ff' : '#e8d6a8';
    const unlit = '#1b2430';           // a dim cold pane, never the wall colour and never black
    // Each lit room tints the building's lamp in warmth and brightness, deterministically per pane.
    // ⚠ A tint around `warm`, never unrelated colours, which read as fairy lights.
    const paneLit = (k) => {
      const r = parseInt(warm.slice(1, 3), 16), g = parseInt(warm.slice(3, 5), 16), b = parseInt(warm.slice(5, 7), 16);
      const t = dRand(seed, k * 7 + 3) * 2 - 1;        // -1 cooler … +1 warmer
      const v = 0.72 + dRand(seed, k * 7 + 5) * 0.38;  // a dim back room … a bright one
      const cl = (x) => Math.max(0, Math.min(255, Math.round(x)));
      // Warmth moves red against blue, as colour temperature does.
      return 'rgb(' + cl((r + t * 26) * v) + ',' + cl((g + t * 4) * v) + ',' + cl((b - t * 34) * v) + ')';
    };
    // ── A RIBBON, NOT A GRID, FOR THE SHOPFRONT SET ─────────────────────────
    // One mullioned band per floor: far fewer faces than punched bays, and a shape the wall texture
    // can't paint. Lit per floor; `litN` still counts rooms so the wash is unchanged.
    // ⚠ Rich list only: `bars` is mesh-only, so on the painter it'd be an undivided slab.
    const ribbon = rich && style === 'front' && !period;
    for (let f = 0; f < floors; f++) {
      const z = main.z0 + wallH * ((f + 0.62) / floors);
      if (z + wh > main.z1 - 0.02) continue;
      if (ribbon) {
        // Re-centred when only one corner is reserved.
        const rl = Math.min(0.76, resL), rr = Math.min(0.76, resR);
        // ⚠ A band crossing the author's window is skipped, before the lit roll, so it adds no wash.
        const rcx = main.cx + (rr - rl) * main.hw * 0.5, rhalf = main.hw * (rl + rr) * 0.5;
        if (!clearOfAuthor(fy, rcx - rhalf, rcx + rhalf, z - wh, z + wh)) continue;
        const lit = dRand(seed, f * 11 + 1) > 0.34;
        if (lit) { litN += cols; litZ += z * cols; }
        pushWin({ kind: 'windowBay', cx: A(rcx), cy: A(fy), z: A(z),
          // Reveal depth off `wh`, never `min(ww, wh)`: the grid's pane width isn't the ribbon's.
          half: A(rhalf), hh: A(wh), depth: A(wh * 0.34), pal: wpal,
          bars: clamp(cols0 + 1, 2, 6), transom: 0.72, glow: lit ? paneLit(f * 11 + 1) : unlit });
        continue;
      }
      for (let i = 0; i < cols; i++) {
        const x = main.cx - main.hw * gl + cw * (i + 0.5);
        if (!clearOfAuthor(fy, x - ww, x + ww, z - wh, z + wh)) continue;   // the author's own window keeps its patch of wall
        const lit = dRand(seed, f * 11 + i * 3 + 1) > 0.34;
        if (lit) { litN++; litZ += z; }
        // A mullion and transom make it a sash. ⚠ Transom on the rich list only: the painter draws
        // transoms (authored bays need them), so the lean list would pay a quad per window.
        pushWin({ kind: 'windowBay', cx: A(x), cy: A(fy), z: A(z), half: A(ww), hh: A(wh),
          depth: A(Math.min(ww, wh) * 0.3), pal: wpal,
          bars: rich ? 1 : (cols > 2 ? 0 : 1), transom: rich ? 0.3 : undefined,
          glow: lit ? paneLit(f * 11 + i * 3 + 1) : unlit });
      }
    }
    // One wash for the lit rooms, at their centre, in the panes' own colour. Sized by how many are
    // lit, never by the mass, or an empty tower is the brightest thing on the street.
    if (litN > 0) {
      push({ kind: 'facadeGlow', cx: A(main.cx), cy: A(fy), z: A(litZ / litN),
        // Tuned by eye; `WASH_SLOTS`, not brightness, stops a wash evicting the neon.
        s: A(clamp(0.04 + litN * 0.009, 0.04, 0.10)),
        // Dimmer than the panes. `pickLights` reads this colour for reach too.
        rgb: hexRgb(warm).map((v) => Math.round(v * 0.7)).join(','),
        a: clamp(0.10 + litN * 0.012, 0.10, 0.26) });
    }
  } else if (wants('wall') && style === 'works' && wallH > 0.18 && main.hw > 0.12) {
    // A works gets louvres where a block gets windows: the same rhythm, doing a different job.
    const n = clamp(Math.round(main.hw / 0.16), 1, 2);
    // ⚠ Skipped, never squeezed into the roller door, when the painted name leaves no room.
    if (louvZ - louvHH > main.z0 + wallH * 0.1) for (let i = 0; i < n; i++) {
      const x = main.cx + (n === 1 ? 0 : (i ? 1 : -1) * main.hw * 0.44);
      push({ kind: 'louvreBank', drip: 1, cx: A(x), cy: A(fy), z: A(louvZ),
        half: A(main.hw * 0.26), hh: A(louvHH), n: 6, pal });
    }
  }
  // The riser: ducting on a works, a downpipe on anything else. Always on a flank, never centred.
  // ⚠ Chosen outside the `wants` guard: the stair reads it to take the other flank.
  const riserX = main.cx + main.hw * (R(3) > 0.5 ? 0.82 : -0.82);
  if (wants('riser')) {
    const rx = riserX;
    // ⚠ A part crossing an authored pier is dropped, never moved (`riserX` is shared with the stair).
    if (style === 'works') {
      const r = clamp(main.hw * 0.09, 0.012, 0.03), run = -Math.sign(rx - main.cx) * main.hw * 0.5;
      const z0 = main.z0 + wallH * 0.08, z1 = main.z1 - wallH * 0.12;
      if (!crossesPier(fy, Math.min(rx, rx + run) - r, Math.max(rx, rx + run) + r, z0, z1 + r))
        push({ kind: 'ductRun', cx: A(rx), cy: A(fy), z0: A(z0), z1: A(z1), r: A(r), run: A(run), pal });
    } else {
      const r = clamp(main.hw * 0.03, 0.006, 0.014), z1 = main.z1 - wallH * 0.06;
      // A symmetric facade (the Meridian's deco front) gets a matching pipe on the other flank.
      for (const x of RISER_PAIR.has(tradeOf(m)) ? [rx, 2 * main.cx - rx] : [rx])
        if (!crossesPier(fy, x - r, x + r, main.z0, z1))
          push({ kind: 'pipe', cx: A(x), cy: A(fy), z0: A(main.z0), z1: A(z1), r: A(r), pal });
      const cz = main.z1 - wallH * 0.14, sag = wallH * 0.05;
      if (!crossesPier(fy + 0.012, main.cx - main.hw * 0.8, main.cx + main.hw * 0.8, cz - sag, cz))
        push({ kind: 'cableRun', cx: A(main.cx), cy: A(fy + 0.012), z: A(cz),
          half: A(main.hw * 0.8), sag: A(sag), r: A(0.006), pal: 'infra' });
    }
  }

  // ── 1b. THE STAIR ─────────────────────────────────────────────────────────
  // A zigzag fire escape (~14 quads), on one flank of one building.
  // ⚠ It takes the flank the riser didn't.
  const stairSide = -Math.sign(riserX - main.cx) || 1;
  // ⚠ A fire escape goes on a flank (`face: 'x'`), never across the front, where it reads as a cage.
  // Balconies stay on the front with the windows. A lopsided mass (flank plane on the wrong side of
  // the origin, as in 1d) falls back to balconies.
  const stairX = main.cx + stairSide * main.hw;
  const flankOk = Math.abs(stairX) > 0.02 && Math.sign(stairX) === stairSide;
  if (wants('stair') && wallH > 0.26 && main.hw > 0.14) {
    if (flankOk && (style === 'works' || dRand(seed, 61) > 0.45)) {
      // Rotated frame (see 1d); `half` runs along the flank, so it comes off the depth.
      push({ kind: 'fireEscape', face: 'x', cx: A(-(main.cy - main.fd * 0.2)), cy: A(stairX),
        z0: A(main.z0 + wallH * 0.18), z1: A(main.z1 - wallH * 0.1),
        half: A(Math.min(main.fd * 0.22, 0.075)), out: A(clamp(main.hw * 0.14, 0.025, 0.05)),
        flights: clamp(Math.round(wallH / 0.2), 2, 4), pal });
    } else {
      // A balcony stack instead.
      const n = clamp(Math.round(wallH / 0.22), 2, 3);
      for (let i = 0; i < n; i++) {
        push({ kind: 'balcony', cx: A(main.cx + stairSide * main.hw * 0.55), cy: A(fy),
          z: A(main.z0 + wallH * (0.3 + i * 0.24)),
          half: A(Math.min(main.hw * 0.26, 0.09)), out: A(clamp(main.hw * 0.13, 0.022, 0.045)),
          rail: A(Math.min(wallH * 0.05, 0.022)), pal });
      }
    }
    // ── 1c. BALCONIES ACROSS A RESIDENTIAL FRONT (MESH ONLY) ────────────
    // A balcony breaks the silhouette, which is a better spend than more flat windows.
    // ⚠ It follows the window band, or the two read as unrelated grids.
    if (rich && style === 'block' && wallH > 0.3 && main.hw > 0.16) {
      const bCols = clamp(Math.round(main.hw / 0.16), 1, 3);
      const bFloors = clamp(Math.round(wallH / 0.26), 2, 4);
      // The windows' band, so the outer balcony doesn't land under the corner blade.
      const bl = Math.min(0.75, resL), br = Math.min(0.75, resR);
      const cw = (main.hw * (bl + br)) / bCols;
      for (let f = 0; f < bFloors; f++) {
        const z = main.z0 + wallH * ((f + 0.75) / bFloors);
        if (z > main.z1 - wallH * 0.08) continue;
        for (let i = 0; i < bCols; i++) {
          const x = main.cx - main.hw * bl + cw * (i + 0.5);
          // The flank the stair took already has one; two on the same column collide.
          if (Math.sign(x - main.cx) === stairSide && Math.abs(x - main.cx) > main.hw * 0.4) continue;
          push({ kind: 'balcony', cx: A(x), cy: A(fy), z: A(z),
            half: A(Math.min(cw * 0.34, 0.075)), out: A(clamp(main.hw * 0.1, 0.02, 0.038)),
            rail: A(Math.min(wallH * 0.04, 0.018)), pal });
        }
      }
    }
  }

  // ── 1d. THE OTHER THREE WALLS ─────────────────────────────────────────
  // Service on the flanks and back (riser, cable drop, condenser, grille, conduit); the windows come
  // later in section 7 (`glazeWalls`) and step round these. Rich list only.
  // ⚠ Nothing derived from the entrance (awning, door, board, kerb props) goes here.
  // ⚠ A flank part is placed only when its plane is on the side its sign says; `faceY` assumes a
  // centred building, so a lopsided mass declines.
  const fxPos = main.cx + main.hw, fxNeg = main.cx - main.hw;
  // ⚠ Chosen outside the guard, as `riserX` is: section 4's gable ad takes the other flank.
  const svcSide = dRand(seed, 201) > 0.5 ? 1 : -1;        // ⚠ salt 200+; the earlier sections use 3…74
  if (rich && wants('riser') && fxPos > 0.02 && fxNeg < -0.02 && wallH > 0.18) {
    // Rotated frame (see `face` in detailLayer): `cy` is which flank, `cx` is where along it.
    const along = (t) => A(-(main.cy + t));
    const svcX = svcSide > 0 ? fxPos : fxNeg;
    const othX = svcSide > 0 ? fxNeg : fxPos;
    const r = clamp(main.hw * 0.03, 0.006, 0.014);
    // The service flank: a riser the full height of the wall, and a cable drop beside it.
    push({ kind: style === 'works' ? 'ductRun' : 'pipe', face: 'x', cx: along(main.fd * 0.35), cy: A(svcX),
      z0: A(main.z0 + wallH * 0.04), z1: A(main.z1 - wallH * 0.08),
      r: A(style === 'works' ? Math.max(r, 0.012) : r), run: A(main.fd * 0.5), pal: 'infra' });
    // ⚠ With the flanks glazed, a run across the wall goes between window rows (`gapAt`), or the
    // row it crosses is dropped.
    const glz = RENDER_TUNE.glazeAll && floors > 1;
    const gapAt = (t) => {
      if (!glz) return main.z0 + wallH * t;
      const f = clamp(Math.round(t * floors - 1.12), 0, floors - 2);
      return main.z0 + wallH * (f + 1.12) / floors;
    };
    // In a gap, the sag is held to a third of a storey's spare wall.
    const gapSag = glz ? Math.min(wallH * 0.04, Math.max(0.004, (wallH / floors - 0.11) * 0.33)) : wallH * 0.04;
    push({ kind: 'cableRun', face: 'x', cx: along(-main.fd * 0.1), cy: A(svcX + Math.sign(svcX) * 0.004),
      z: A(glz ? gapAt(0.82) + gapSag * 0.5 : main.z1 - wallH * 0.18), half: A(main.fd * 0.55), sag: A(gapSag), r: A(0.005), pal: 'infra' });
    // The other flank: the machinery you walk past, and a run across the wall.
    push({ kind: 'acUnit', drip: 1, face: 'x', cx: along(main.fd * 0.2), cy: A(othX),
      w: A(Math.min(main.fd * 0.26, 0.03)), d: A(Math.min(main.fd * 0.18, 0.02)),
      hh: A(Math.min(wallH * 0.09, 0.022)), z: A(main.z0 + Math.min(wallH * 0.5, 0.09)), pal: 'ty_hangar_a' });
    if (dRand(seed, 203) > 0.4) {
      push({ kind: 'vent', drip: 1, face: 'x', cx: along(-main.fd * 0.3), cy: A(othX),
        w: A(Math.min(main.fd * 0.3, 0.034)), hh: A(Math.min(wallH * 0.07, 0.018)),
        z: A(main.z0 + wallH * 0.62), pal: 'ty_hangar_a' });
    }
    if (wallH > 0.3 && dRand(seed, 205) > 0.45) {
      push({ kind: 'conduit', face: 'x', cx: along(0), cy: A(othX),
        z: A(gapAt(0.34)), half: A(main.fd * 0.6), r: A(0.005), pal: 'infra' });
    }
    // And the back, which only the air ever sees: the cheapest pair on the list.
    const by2 = main.cy - main.fd;
    if (by2 < -0.02 || main.cy < 0) {
      push({ kind: 'pipe', cx: A(main.cx + main.hw * 0.5), cy: A(by2),
        z0: A(main.z0), z1: A(main.z1 - wallH * 0.1), r: A(r), pal: 'infra' });
    }
  }

  // ── 2. THE ROOF ───────────────────────────────────────────────────────────
  // ⚠ Presence, corner and size are all seeded off the tile; a fixed recipe makes every roof the same.
  // ⚠ Roof plant stands on a real deck, never the tallest box (a barrel-roofed shed's wall box). No
  // deck, no roof plant.
  const roofOn = deck.length ? deck[0] : null;
  const deckZ = roofOn ? roofOn.z1 : 0;   // ⚠ the deck's own top, not the tallest box in the tile
  const dhw = roofOn ? roofOn.hw : 0;
  // ── ⚠ A BUILDING SAYS ITS OWN NAME ONCE ─────────
  // The door board (3b), painted works name (3c) and roof hoarding (4) all letter `$name`. The roof
  // wins (it's read from down the street), so it's rolled here first. The loser carries the trade's
  // mark instead, or is declined if there's none. ⚠ Don't fold `signRoof` into `sign` (see SECTION_OF).
  const armNamed = have.has('sign') || paints;
  const roofSigns = rich && !period && wants('signRoof') && !!roofOn && dhw > 0.1
    && signsItself(m, style) && R(301) > gateFor(style === 'front' ? 0.22 : 0.40);
  // ⚠ Whether the hoarding can stand clear of the arm's masts is asked here, before the roof claims
  // the name, or a declined hoarding leaves the building nameless. Section 4 reads these; never copy them.
  const gantryNudge = dhw * 0.34;
  const gantryCx0 = roofOn ? roofOn.cx + dhw * (R(303) - 0.5) * 0.34 : 0;
  // Sized off the deck; a logo board (square mark) is narrower than a name board.
  const gantryW = (logo) => clamp(dhw * (logo ? 0.52 : 0.82), logo ? 0.045 : 0.055, logo ? 0.15 : 0.24);
  // A lateral gap test: a mast is a line, and both start at the deck.
  const gantryAt = (gw) => [gantryCx0, gantryCx0 + gantryNudge, gantryCx0 - gantryNudge]
    .find((cx) => spars.every((s) => Math.abs(s.cx - cx) > gw * 1.05 || s.z1 < deckZ + 0.005));
  // Tested at the wider name width; if it won't fit, the door keeps the name.
  const roofTakesName = roofSigns && !armNamed && gantryAt(gantryW(false)) != null;
  if (wants('roof') && roofOn && dhw > 0.08) {
    // Four corners, shuffled per building, so two neighbours do not agree about where the plant is.
    const CORNERS = [[-0.44, -0.4], [0.44, -0.36], [0.42, 0.4], [-0.4, 0.42]];
    const rot = Math.floor(R(21) * 4);
    const q = (i, jx = 0, jy = 0) => {
      const [fx, fy2] = CORNERS[(i + rot) % 4];
      return { x: roofOn.cx + dhw * (fx + jx), y: roofOn.cy + dhw * (fy2 + jy) };
    };
    const big = dhw > 0.15;
    if (style === 'works') {
      // Only the bigger works get a tank.
      if (big && R(31) > 0.35) {
        const t = q(0, 0.06, 0.04);
        push({ kind: 'tankFrame', cx: A(t.x), cy: A(t.y), z: A(deckZ), r: A(dhw * (0.24 + R(33) * 0.1)),
          hh: A(dhw * (0.38 + R(35) * 0.16)), rise: A(dhw * (0.26 + R(37) * 0.18)), pal });
      }
      const s = q(2, -0.05, -0.03);
      // ⚠ Kept short: a taller stack on a small roof reads as a gallows.
      push({ kind: 'stack', cx: A(s.x), cy: A(s.y), z: A(deckZ), r: A(clamp(dhw * 0.13, 0.014, 0.036)),
        hh: A(dhw * (0.34 + R(39) * 0.22)), pal });
    } else {
      if (R(41) > 0.3) {
        const t = q(0, 0.05, 0.05);
        push({ kind: 'roofTank', cx: A(t.x), cy: A(t.y), z: A(deckZ),
          r: A(dhw * (0.19 + R(43) * 0.09)), hh: A(dhw * (0.24 + R(45) * 0.12)), pal });
      }
      if (R(47) > 0.35) {
        const a = q(2, -0.04, -0.06);
        push({ kind: 'antennaCluster', cx: A(a.x), cy: A(a.y), z: A(deckZ), r: A(dhw * 0.2),
          hh: A(dhw * (0.34 + R(49) * 0.26)), n: 3 + Math.round(R(7) * 4), pal });
      }
    }
    // ── THE STAIR HEAD ───────────────────────────────────────
    // ⚠ Not rolled (something has to bring the stairs up); only its spot and size vary. It takes the
    // middle, clear of the parapet, since the corners are spoken for.
    // ⚠ Gated on deck height (over ~2.2 storeys), never width: the widest decks are one-storey sheds.
    const upFromStreet = deckZ - cand[cand.length - 1].z0;
    if (dhw > 0.1 && upFromStreet > 0.17 * 2.2) {
      const bkw = dhw * (0.17 + R(63) * 0.07);
      push({ kind: 'roofBulkhead',
        cx: A(roofOn.cx + dhw * (R(65) - 0.5) * 0.5), cy: A(roofOn.cy + dhw * (R(67) - 0.5) * 0.5),
        z: A(deckZ), w: A(bkw), d: A(bkw * (0.72 + R(69) * 0.4)),
        // ⚠ A room, so clamped to about a storey whatever the deck size.
        hh: A(clamp(dhw * 0.28, 0.05, 0.088)), pal });
    }
    // A rank of condensers; one alone reads as a crate. ⚠ They share a size and pitch, or it's litter.
    const rank = 2 + Math.round(R(51) * (big ? 2 : 1));
    const acW = dhw * (0.10 + R(53) * 0.04), acH = dhw * (0.09 + R(57) * 0.05);
    const u = q(1, -0.02, 0.02);
    const along = R(59) > 0.5;
    for (let i = 0; i < rank; i++) {
      const o = (i - (rank - 1) / 2) * acW * 2.6;
      push({ kind: 'acUnit', cx: A(u.x + (along ? o : 0)), cy: A(u.y + (along ? 0 : o)),
        z: A(deckZ), w: A(acW), d: A(acW * 0.8), hh: A(acH), pal });
    }
  }

  // ── 3. THE GROUND FLOOR ───────────────────────────────────────────────────
  // ⚠ Clamped, never scaled: a ground floor is sized by a door and a person, not the block above.
  if (wants('ground') && bh > 0.05 && base.hw > 0.1) {
    const dz = base.z0 + GF * 0.52;                 // the middle of that band
    if (style === 'works') {
      // A works meets the street with a vehicle door and a personnel door beside it.
      // A loading bay is wider (0.4) and still clears the personnel door at 0.52.
      const bay = BAY_TRADE.has(tradeOf(m));
      push({ kind: 'shutter', bay, cx: A(base.cx - base.hw * 0.18), cy: A(by), z: A(dz),
        half: A(base.hw * (bay ? 0.4 : 0.34)), hh: A(GF * 0.46), pal });
      // ⚠ A `door`'s `z - hh` is its threshold, so it's centred one half-height above the base.
      push({ kind: 'windowBay', door: 1, cx: A(base.cx + base.hw * 0.52), cy: A(by), z: A(base.z0 + GF * 0.4),
        half: A(Math.min(base.hw * 0.11, 0.035)), hh: A(GF * 0.4), depth: A(0.01), pal: wpal,
        glow: '#d8c88a', glass: '#1c2026' });
      push({ kind: 'louvreBank', drip: 1, cx: A(base.cx + base.hw * 0.8), cy: A(by), z: A(dz + GF * 0.1),
        half: A(Math.min(base.hw * 0.12, 0.04)), hh: A(GF * 0.26), n: 5, pal });
    } else {
      // A shopfront: glazing under an awning, and a door.
      push({ kind: 'canopy', cx: A(base.cx), cy: A(by), z: A(base.z0 + GF),
        half: A(base.hw * 0.86), out: A(clamp(base.hw * 0.26, 0.03, 0.075)), hh: A(0.014), pal,
        soffit: shadeOf(pal, 0.3), strip: style === 'front' ? '#ffd9a0' : undefined });
      const glow = style === 'front' ? '#cfe6ff' : '#f0d8a0';
      // Rich: one mullioned band. Lean: two panes either side of the door.
      // ⚠ The door stands 0.004 proud of the band, or the depth buffer puts it behind the glass.
      const out = (by < 0 ? -1 : 1) * 0.004;
      const band = rich;
      if (band) {
        push({ kind: 'windowBay', cx: A(base.cx), cy: A(by), z: A(dz),
          half: A(Math.min(base.hw * 0.8, 0.27)), hh: A(GF * 0.36), depth: A(0.012), pal: wpal,
          glow, bars: 5, transom: 0.78 });
      } else {
        for (const s of [-1, 1]) {
          push({ kind: 'windowBay', cx: A(base.cx + s * base.hw * 0.46), cy: A(by), z: A(dz),
            half: A(Math.min(base.hw * 0.3, 0.1)), hh: A(GF * 0.36), depth: A(0.012), pal: wpal,
            glow, bars: 1 });
        }
      }
      // The door (`door` draws leaf, kick plate, push bar and step); the lobby takes the band's glow.
      push({ kind: 'windowBay', door: 1, cx: A(base.cx), cy: A(band ? by + out : by), z: A(base.z0 + GF * 0.42),
        half: A(Math.min(base.hw * 0.13, 0.045)), hh: A(GF * 0.42), depth: A(0.016), pal: wpal,
        glow, ...(band ? { transom: 0.78 } : {}) });
    }
    // ── 3b. THE NAME ────────────────────────────────────────────────────────
    // A board over the door with the building's name, unless the arm signs itself.
    // ⚠ The label is `$name`, resolved at draw time: this list is cached per model and shared by
    // every building of that type. A board, not a blade, since the name's length isn't known.
    // A works doesn't sign its door (see `signsItself`; `signWorks` opts in).
    // The trade's own hand and mark, if any (SIGN_TRADE); a works keeps mono.
    const [tFont, tPicto] = (style !== 'works' && SIGN_TRADE[tradeOf(m)]) || ['', ''];
    // ⚠ Skipped when the roof has the name and there's no mark: a blank plate reads as peeled paint.
    if (wants('sign') && signsItself(m, style) && (!roofTakesName || tPicto)) {
      // Sized to read past the screen-size gate. ⚠ A mark-only plate is square, since `fitSignPts`
      // only ever shrinks the artwork into its quad.
      const sz = Math.min(base.hw * (roofTakesName ? 0.22 : 0.62), roofTakesName ? 0.07 : 0.19);
      const shh = roofTakesName ? sz * 0.92 : signHH;
      // ⚠ Shopfront plane first (ceiling `base.z1`), then the elevation's plane `fy`, else unmoved:
      // it's the building's only name. The elevation is used only when `main` spans the board's
      // width, or the board hangs over open air.
      let seat = clearOfMass(false, 1, by, base.cx, sz, shh, signZ, base.z1), sPlane = by;
      if (!seat.clear && Math.abs(main.cx - base.cx) + sz <= main.hw) {
        const up = clearOfMass(false, 1, fy, base.cx, sz, shh, signZ, main.z1);
        if (up.clear) { seat = up; sPlane = fy; }
      }
      const sZ = seat.z;
      // The trade word under the name (`SIGN_WORD`, `RENDER_TUNE.signSub`). ⚠ Only on a board with
      // room (`SUB_MAX_ASP`), never with a pictogram (`bakeSignText` drops it), rationed off the seed,
      // and never when the roof hoarding already says it. A declined hoarding still costs the sub.
      const roofSaysTrade = roofSigns && !roofTakesName
        && !!(SIGN_TRADE[tradeOf(m)] || ['', ''])[1] && !!SIGN_WORD[tradeOf(m)];
      const subWord = (TUNE.signSub | 0) && !tPicto && !roofTakesName && !roofSaysTrade && sz / shh <= SUB_MAX_ASP
        && R(331) < 0.62 ? SIGN_WORD[tradeOf(m)] : null;
      push({ kind: 'signBoard', cx: A(base.cx), cy: A(sPlane), z: A(sZ),
        half: A(sz), hh: A(shh),
        ...(roofTakesName ? {} : { label: '$name' }),
        ...(subWord ? { sub: subWord } : {}),
        color: style === 'works' ? shadeOf(pal, 0.34) : '#151119',
        ink: style === 'works' ? '#cfc6b4' : (m.neon || '#e8dcc8'),
        ...(tFont ? { font: tFont } : {}), ...(tPicto ? { picto: tPicto } : {}) });
    }
    // ── 3c. A WORKS PAINTS ITS NAME ON THE WALL INSTEAD ────────────────
    // Exclusive with 3b by construction. On `main` (the elevation), on the front and both flanks,
    // since most cameras meet a shed's sides; the back stays bare. A fire escape crossing it is fine.
    if (paints) {
      // Lifted clear of the building's own mass (`clearOfMass`). Rotated frame as in 1d.
      // ⚠ The lopsided-mass guard is the stair's (1b).
      const flankSides = main.fd > 0.14
        ? [1, -1].filter((sd) => { const px = main.cx + sd * main.hw; return Math.abs(px) > 0.02 && Math.sign(px) === sd; })
        : [];
      // ⚠ The front is dropped only when it can't clear AND a flank carries the name; otherwise a
      // half-read name beats none.
      const fHalf = Math.min(main.hw * 0.7, 0.3);
      const fSeat = clearOfMass(false, 1, fy, main.cx, fHalf, nameHH, nameZ, main.z1);
      if (fSeat.clear || !flankSides.length) {
        // Then clear the fittings: lift, else slide along the wall, else keep the half-read band.
        const fz = overFittings(false, fy, main.cx, fHalf, nameHH, fSeat.z, main.z1);
        const fSlide = fz === fSeat.z
          ? besideFittings(false, fy, main.cx, fHalf, nameHH, fz, fHalf * NAME_RUN_MIN) : null;
        push({ kind: 'signBoard', bare: true, cx: A(fSlide ? fSlide.cx : main.cx), cy: A(fy),
          z: A(fz), half: A(fSlide ? fSlide.half : fHalf), hh: A(nameHH), label: '$name' });
      }
      for (const sd of flankSides) {
        const px = main.cx + sd * main.hw;
        {
          // Along a flank the centre is the model's own y, so `main.cy`, not `-main.cy`.
          const kHalf = Math.min(main.fd * 0.7, 0.3);
          // ⚠ AND THEN LIFTED OVER THE STAIR, WHICH IS THE OTHER HALF OF THE SAME REPORT. The ⚠
          // above says a fire escape crossing a painted name is fine and it is — bolted across
          // ONE END of it. What this kit actually does is hang the zigzag at 0.2 of the flank and
          // derive the band at two thirds of the wall, so the stair goes through the MIDDLE of the
          // lettering and takes the readable part of the name with it. `overFittings` seats it in
          // the frieze above the stair head where that band exists, and hands the same z back
          // where it does not: a wall too short to clear its own stair keeps the picture it had.
          // ⚠ `-main.cy`, NOT `main.cy`. `clearOfMass` works in the rotated frame section 1d sets
          // up and reads the model's own y as `mid`; `blocks` holds what `paintFoot` recorded,
          // which is the part's own `cx` — and a flank part is pushed with `cx: -main.cy`. The two
          // agree on every centred building and disagree on exactly the lopsided ones this whole
          // section keeps having to guard.
          const seatZ = clearOfMass(true, sd, px, main.cy, kHalf, nameHH, nameZ, main.z1).z;
          const kZ = overFittings(true, px, -main.cy, kHalf, nameHH, seatZ, main.z1);
          // ⚠ AND WHERE THE LIFT FOUND NOWHERE TO GO, THE NAME MOVES ALONG THE WALL INSTEAD — see
          // `besideFittings`. Only then: a band that cleared vertically is already on bare brick at
          // its full width, and narrowing it to a run would be shrinking a name for nothing.
          const slide = kZ === seatZ
            ? besideFittings(true, px, -main.cy, kHalf, nameHH, kZ, kHalf * NAME_RUN_MIN) : null;
          push({ kind: 'signBoard', bare: true, face: 'x',
            cx: A(slide ? slide.cx : -main.cy), cy: A(px), z: A(kZ),
            half: A(slide ? slide.half : kHalf), hh: A(nameHH), label: '$name' });
        }
      }
    }
    // Street-level plant: a condenser bolted to the wall beside the door, and an extract grille.
    // Every one of the reference photographs has this and none of them has it on the ROOF only —
    // the machinery you actually walk past is at head height, which is the camera this game uses
    // most. Cheap enough to be unconditional: an acUnit is a top and one visible side.
    const px = base.cx + base.hw * (dRand(seed, 63) > 0.5 ? 0.78 : -0.78);
    push({ kind: 'acUnit', drip: 1, cx: A(px), cy: A(by + 0.012), z: A(base.z0 + GF * 0.72),
      w: A(Math.min(base.hw * 0.1, 0.032)), d: A(Math.min(base.hw * 0.07, 0.022)),
      hh: A(Math.min(GF * 0.17, 0.022)), pal });
    if (dRand(seed, 65) > 0.45) {
      push({ kind: 'vent', drip: 1, cx: A(base.cx - (px - base.cx) * 0.55), cy: A(by),
        z: A(base.z0 + GF * 0.78), w: A(Math.min(base.hw * 0.11, 0.036)),
        hh: A(Math.min(GF * 0.14, 0.02)), pal });
    }
    // ── AND THE PAVEMENT IN FRONT OF IT ────────────────────────────────────────────────────────
    //
    // ⚠ RATIONED, HARD, AND THAT IS THE WHOLE DESIGN. A lamp post outside every building in
    // Coldwater is not a street, it is a fence: the thing that reads as a lit street is a lamp every
    // few frontages with dark between them. So each of these is behind its own deterministic roll
    // and a machine needs a lit shopfront to stand against in the first place.
    //
    // ⚠ THE LAMP'S RATION IS UNTOUCHED AND THE OTHER TWO CAME UP, because the argument above is an
    // argument about LAMPS. A lamp is four tiles tall and spaces a street; a bollard and a vending
    // machine are knee- and shoulder-high, they are what a player on foot is actually level with,
    // and at the old rolls you could walk Coldwater for a long time without meeting either.
    // Measured over 64 seeds, as a share of ALL frontages: lamp 25.2% (unchanged), bollards
    // 7.8% → 10.9%, machine 10.0% → 14.8%. That is still one machine per seven shopfronts, which
    // is a street with things on it rather than a vending aisle.
    //
    // ⚠ AND THEY STAND OFF THE BUILDING, past `by`, which is the one place in this kit where that is
    // right. Everything else here is bolted to a wall and `anchored.mjs` proves it; these are on the
    // PAVEMENT, so they are deliberately not in that gate's FACE_PARTS and deliberately not in
    // SECTION_OF either — standing a lamp outside a building is not a claim to have drawn its
    // facade.
    const kerb = by + (by < 0 ? -1 : 1) * Math.min(base.hw * 0.34, 0.13);
    if (dRand(seed, 71) > 0.66) {
      const lx = base.cx + base.hw * (dRand(seed, 72) > 0.5 ? 0.82 : -0.82);
      pushKerb({ kind: 'streetLamp', cx: A(lx), cy: A(kerb), z0: A(base.z0), z1: A(base.z0 + GF * 1.5),
        out: A(Math.min(base.hw * 0.3, 0.1)), r: A(Math.min(base.hw * 0.035, 0.011)),
        flip: by > 0, pal, rgb: style === 'front' ? '255,206,140' : '210,226,255' });
    }
    if (style === 'front' && dRand(seed, 73) > 0.6) {
      pushKerb({ kind: 'bollard', cx: A(base.cx), cy: A(kerb), z: A(base.z0),
        r: A(Math.min(base.hw * 0.028, 0.009)), hh: A(Math.min(GF * 0.2, 0.024)),
        step: A(Math.min(base.hw * 0.32, 0.08)), count: 3, band: '#e8d8a0', pal });
    }
    // ⚠ BINS GO WHERE THE SHOPFRONT IS NOT, which is the only placement rule they need. `px` is the
    // doorway, so the far flank is the service end of the frontage — the bit of pavement a real
    // street puts its rubbish on, and the bit this kit has always left bare. Unlike the other three
    // this is NOT gated on `front`: a works, a shed and a block all put bins out, and the industrial
    // set is exactly where a clean kerb line looks most wrong.
    if (dRand(seed, 75) > 0.52) {
      const bx = base.cx + (base.cx - px) * 0.72;
      pushKerb({ kind: 'binStack', cx: A(bx), cy: A(by + (by < 0 ? -1 : 1) * Math.min(base.hw * 0.12, 0.045)),
        z: A(base.z0), w: A(Math.min(base.hw * 0.055, 0.017)), d: A(Math.min(base.hw * 0.045, 0.014)),
        hh: A(Math.min(GF * 0.3, 0.038)), n: 2 + Math.round(dRand(seed, 76) * 2), pal,
        lid: shadeOf(pal, 0.86) });
    }
    if (style === 'front' && dRand(seed, 74) > 0.55) {
      const vx = base.cx - (px - base.cx) * 0.9;
      pushKerb({ kind: 'vendingMachine', cx: A(vx), cy: A(by), z: A(base.z0),
        w: A(Math.min(base.hw * 0.1, 0.03)), d: A(Math.min(base.hw * 0.07, 0.02)),
        hh: A(Math.min(GF * 0.42, 0.052)), pal,
        glow: m.neon || '#c060e0', rgb: '190,110,230' });
    }
  }
  // ── AND NOBODY HAS WASHED IT ───────────────────────────────────────────────────────────────
  //
  // A run of water and soot down a bare face, on the buildings where the weather is the only thing
  // still working on them. `dripStain` has drawn exactly this under every vent and condenser in
  // the city since it was written, and its own note says a facade with no streaks below its
  // openings is one of the clearest tells that a building was generated rather than weathered.
  //
  // ⚠ THE PART THAT NEEDED IT MOST COULD NOT HAVE IT, WHICH IS WHY THE `grime` KIND EXISTS. The
  // stain is opt-in on a grille, correctly — a roof unit with one hangs a smear in mid-air below
  // its own deck — and a ruin has no grille to opt in: no vent, no louvre, no condenser, no roof
  // to stand one on, and `wall` declined so not a window either. It was the cleanest brick in
  // Coldwater, which on a heap of rubble is the one thing it must not be.
  //
  // ⚠ IT IS PUSHED BEFORE THE PAINT AND THAT IS THE RIGHT WAY ROUND. Position here is priority
  // against `kitMax`, and grime is two quads at a px floor of 4 where a piece of paint is a baked
  // canvas — but the ordering argument is the physical one rather than the cheap one: a wall is
  // dirty first and somebody paints over it afterwards, and `grime` is deliberately out of
  // `PAINT_WALL` so the piece still lands wherever the search was going to put it.
  //
  // ⚠ AND IT IS KEYED ON THE TRADE, NOT ON THE DISTRICT. Paint is something people do and people
  // are unevenly distributed; this is what the rain does, and it does it to every building. What a ruin has that a lived-in slum house has not is that nobody
  // is going to wash it off — which is a fact about the building, so the entry bar here is the
  // same as KIT_DECLINE’s: would this be true of the building whoever built it.
  if (GRIME_TRADE.has(tradeOf(m))) {
    const gy = base.cy + base.fd;
    // The street face, from the top of the standing wall down. `w` is the face’s own half-width
    // rather than a fraction of it: a stain under a grille is as wide as the grille, and a stain
    // under a broken roofline is as wide as the roofline.
    push({ kind: 'grime', cx: A(base.cx), cy: A(gy), z: A(base.z1), w: A(base.hw * 0.86), drip: 0.5 });
    // ⚠ AND A SECOND, NARROWER RUN OFF ONE END, because one stain centred on a wall reads as a
    // mark somebody made and two of different widths read as water finding its way. Rolled onto a
    // side rather than placed, so two ruins on one street do not stain identically.
    const gs = dRand(seed, 227) > 0.5 ? 1 : -1;
    push({ kind: 'grime', cx: A(base.cx + gs * base.hw * 0.62), cy: A(gy),
      z: A(base.z1 - (base.z1 - base.z0) * 0.18), w: A(base.hw * 0.3), drip: 0.85 });
    // The flanks and the back, on the rich list only — the same bargain the paint below strikes,
    // and the same lopsided-mass guard, for its reason: `faceY` pushes outward by the sign of the
    // plane, so a flank that does not straddle the origin stains the wrong side of its own wall.
    if (rich && main.hw > 0.08 && main.fd > 0.08) {
      const backY = main.cy - main.fd;
      if (backY < -0.02) push({ kind: 'grime', cx: A(main.cx), cy: A(backY), z: A(main.z1), w: A(main.hw * 0.8), drip: 0.6 });
      if (fxPos > 0.02 && fxNeg < -0.02) {
        push({ kind: 'grime', face: 'x', cx: A(-main.cy), cy: A(svcSide > 0 ? fxPos : fxNeg),
          z: A(main.z1), w: A(main.fd * 0.78), drip: 0.6 });
      }
    }
  }
  // ── AND SOMEBODY HAS BEEN AT THE WALL ──────────────────────────────────────────────────────
  //
  // ⚠ A PIECE IS PLACED BY SEARCH, NOT BY A FRACTION. Candidate patches run from the quiet ends of
  // a wall inward, each tested against everything recorded at the two funnels (`paintFoot`); the
  // first free one wins and a wall with none gets no paint. A fixed offset put the tag inside the
  // shopfront glazing and behind the bins, and the depth test hides that silently
  // (`scripts/shapes/tagfit.mjs` measured 83.1% obstructed, worst 100%).
  // ⚠ IT'S PUSHED AFTER THE KERB PROPS: the bins must be on the list before the search can avoid them.
  // ⚠ NOT INSIDE `wants('ground')`: paint isn't a ground-floor fitting. The author's own parts are in
  // `blocks`, which the search reads.
  // ⚠ THREE OF THE FOUR WALLS ARE RICH-ONLY, the same bargain as 1d: the street face is on both lists.
  // ⚠ AND A BUILDING CAN DECLINE IT (`paint`, see SLUM_DECLINE): every piece this places is a word.
  if (wants('paint')) {
    // ── HOW BIG A PIECE IS: AN ARM, NOT A STOREY ───────────────────────────────────────────────
    //
    // A throw-up is as tall as the person who sprayed it could reach, so the band is the same on
    // every wall of every building in the city and it is sized off the WALL THE PAINT IS ON.
    //
    // ⚠ AND `GF` IS THE PODIUM'S BAND, WHICH IS NOT THAT. It is `min(bh * 0.62, 0.115)` — the
    // ground-floor storey of the BASE box — and the flanks and the back belong to `main`. On a tower
    // standing on a shallow plinth that is a piece a fiftieth of a tile tall on a wall five storeys
    // high: under `TAG_MIN_PX` at any real distance, so it is uploaded, drawn, and never seen. The
    // same expression read against the wall's own height gives the street face a bit-identical
    // answer, because there the wall IS the base.
    const reach = (z0, z1) => Math.min((z1 - z0) * 0.62, 0.115);
    // ── THE BARE RUN IS SOLVED FOR, NOT GUESSED AT ─────────────────────────────────────────────
    //
    // ⚠ THE FIRST CUT WALKED A LIST OF CANDIDATE SPOTS AND THAT IS THE SAME MISTAKE ONE SIZE DOWN.
    // It fixed the obstruction — 83.1% to 2.1% — by declining wherever a fixed-size piece at a fixed
    // fraction happened not to fit, and on a shopfront that is nearly everywhere: a glazing band
    // spans 0.8 of the base half-width, which leaves a sixth of a tile of pier at each end while the
    // piece asks for a quarter. Measured, it painted 142 of a possible 1,688 street faces. A wall
    // with a real patch of brick on it and no tag is this feature not working, just quietly.
    //
    // ⚠ AND THE FIX IS NOT A THIRD SIZE TO TRY. A piece that keeps shrinking until it fits always
    // fits, which is an obstruction test that cannot fail. What a wall actually has is GAPS, so the
    // gaps are what is computed: the occupied runs at the paint band, merged, and the bare ones
    // between them — the same merge `wallSpanAt` does one question over. The piece is then sized to
    // the gap it is going in, bounded at both ends, and a wall whose widest bare run is narrower
    // than the floor gets nothing.
    // ⚠ THE SUBTRACTION ITSELF IS `spansLess`, SHARED WITH THE PLAYER'S OWN PAINT. The two searches
    // ask the same question of two different lists — this one of what the kit and the arm have put
    // on this wall, `drawWallTags` of the same list resolved through `tagWallParts` — and a second
    // hand-written gap walk is a second idea of what a bare wall is.
    const bareRuns = (face, plane, lo, hi, z0, z1, street) => spansLess([[lo, hi]], blocks
      .filter((b) => !!b.x === !!face
        && (b.kerb ? (street && Math.abs(b.plane - plane) <= 0.22) : Math.abs(b.plane - plane) <= WALL_PLANE_TOL)
        && !(z0 > b.z1 || z1 < b.z0))
      .map((b) => [b.x0, b.x1]));
    // ⚠ A MARGIN EITHER SIDE, SO A PIECE STOPS AT BRICK RATHER THAN AT A WINDOW FRAME. The painter
    // keeps its own `TAG_WALL_MARGIN` off the ends of the WALL; this is the same idea against the
    // fitting next door, and without it every piece on a shopfront is a rectangle wedged exactly
    // between the glass and the corner, which reads as a panel rather than as paint.
    const TAG_GAP_PAD = 0.006;
    const sprayOn = (face, plane, mid, run, z0, z1, street, salt) => {
      const gf = reach(z0, z1);
      // ⚠ THE HAND IS ROLLED OFF THE VARIANT THAT WAS ALREADY BEING ROLLED, not off a new salt.
      // Every piece in the city is placed by this function and its colour, its word and its
      // scrawl count all come off `salt`..`salt + 3`; taking a fifth roll would shift that stream
      // and move every tag in Coldwater to fix nothing. `v` is the number the word already comes
      // from, so a wall keeps the piece it had and gains a hand to have painted it in.
      const v = Math.floor(dRand(seed, salt + 3) * 997);
      const hand = tagHandFor(v);
      const band = tagBandFor(hand);
      // ⚠ AND THE BAND IS WHERE THE HANDS STOP BEING FIVE SKINS ON ONE SHAPE. A blockbuster three
      // feet off the pavement is a wide throw-up; what makes it read as a roller on a pole is that
      // it is ABOVE everything else on the wall. Clamped to the wall it is painted on, because
      // `lift` is a multiple of a reach band and a low shopfront has very little of one.
      const hh = Math.min(gf * 0.26, 0.032) * band.hh;
      const z = clamp(z0 + gf * (0.34 + 0.68 * band.lift), z0 + hh, z1 - hh);
      const full = Math.min(run * 0.34, 0.055) * band.w;
      const gaps = bareRuns(face, plane, mid - run, mid + run, z - hh, z + hh, street)
        .map((g) => [g[0] + TAG_GAP_PAD, g[1] - TAG_GAP_PAD])
        .filter((g) => g[1] - g[0] >= 0.024);
      if (!gaps.length) return;
      // ⚠ THE WIDEST RUN THAT WILL TAKE A FULL PIECE, AND THE WIDEST OF ALL WHEN NONE WILL. Always
      // taking the widest puts every tag in the middle of a bare flank; always taking the first puts
      // them all at one end. Among the runs that can carry a whole piece the roll chooses, which is
      // what makes two buildings on one street disagree about where the paint went.
      const big = gaps.filter((g) => g[1] - g[0] >= full * 2);
      const pool = big.length ? big : [gaps.reduce((a, g) => (g[1] - g[0] > a[1] - a[0] ? g : a))];
      const g = pool[Math.floor(dRand(seed, salt) * pool.length) % pool.length];
      const w = Math.min(full, (g[1] - g[0]) * 0.5);
      if (!(w > 0.012)) return;
      // Centred in its own run, so the brick either side of a piece is what says it is paint.
      const cx = (g[0] + g[1]) * 0.5;
      push({ kind: 'tag', ...(face ? { face: 'x' } : {}), cx: A(cx), cy: A(plane), z: A(z),
        w: A(w), hh: A(hh), hand,
        color: TAG_COLS[Math.floor(dRand(seed, salt + 1) * TAG_COLS.length) % TAG_COLS.length],
        n: 3 + Math.round(dRand(seed, salt + 2) * 3), v });
    };
    // The street face. Unchanged ration — what changes is that it now lands on brick.
    if (bh > 0.05 && base.hw > 0.1 && dRand(seed, 77) > 0.62) {
      sprayOn(false, by, base.cx, base.hw, base.z0, base.z1, true, 210);
    }
    if (rich && main.hw > 0.08 && main.fd > 0.08) {
      // ⚠ THE BACK CARRIES THE LOOSEST RATION IN THE WHOLE KIT, AND IT SHOULD. A yard elevation with
      // no window, no sign and no camera on it is the wall every reference photograph of graffiti
      // was taken against, and until now it was the one wall in Coldwater that had never held any.
      const backY = main.cy - main.fd;
      if (backY < -0.02 && dRand(seed, 214) > 0.34) {
        sprayOn(false, backY, main.cx, main.hw, main.z0, main.z1, false, 215);
      }
      // ⚠ THE LOPSIDED-MASS GUARD IS 1d's, WORD FOR WORD, and for its reason: `faceY`
      // pushes outward by the sign of the plane and assumes a roughly centred building, so a flank
      // plane that does not straddle the origin puts paint on the wrong side of its own wall.
      if (fxPos > 0.02 && fxNeg < -0.02) {
        // The service flank first, because that is the end with the bin yard behind it — and it is
        // reached through `svcSide` rather than re-rolled, which is what stops a third expression of
        // "which side is the service side" drifting away from 1d's.
        for (const [sd, gate, salt] of [[svcSide, 0.42, 219], [-svcSide, 0.62, 223]]) {
          if (dRand(seed, salt) <= gate) continue;
          sprayOn(true, sd > 0 ? fxPos : fxNeg, -main.cy, main.fd, main.z0, main.z1, false, salt + 1);
        }
      }
    }
  }

  // ── 4. SIGNS THE SIZE OF THE BUILDING ─────────────────────────────────────
  //
  // The name board in 3b is a modest plate over a door, and until now it was the only signage the
  // kit had. Going back through the eight reference boards, every one of them carries a sign that
  // is a fraction of a FACADE: an armature standing on a roof against the sky, a blade running the
  // full height of a corner. That is the difference between a lit city and a cyberpunk one, and it
  // is a change to the SILHOUETTE rather than to a texture — it reads from down the street, which
  // is where a truck cab spends its time and where a door plate is already unreadable.
  //
  // ⚠ RICH LIST ONLY. These are the biggest parts in the kit, the 2-D painter is held to its
  // committed `framecost`, and a depth buffer draws them for nothing.
  //
  // ⚠ AND THEY ARE RATIONED BY STYLE RATHER THAN BY A FLAT ROLL. A roof armature on nine buildings
  // in ten is a skyline of hoardings, which is not what the boards show either: what they show is a
  // commercial strip carrying them with the blocks behind it dark. `front` is the shopfront-and-neon
  // material set, so it gets one often, a plain block seldom, and a works almost never.
  if (rich) {
    const accent = accentOf(m);
    const [bFont, bPicto] = (style !== 'works' && SIGN_TRADE[tradeOf(m)]) || ['', ''];
    // ── A ROOF ARMATURE ──
    // It stands on the deck on its own legs, so it can only go where there IS a deck — the same
    // rule the roof plant follows two sections up, and for the same reason: a gantry on a barrel
    // lid floats inside the curve with nothing under it.
    // ⚠ THE RATES ARE SET AGAINST THE POPULATION THAT ACTUALLY REACHES HERE, NOT AGAINST THE
    // REGISTRY. Across all 173 models the styles run 66 front / 47 block / 56 works, and the first
    // cut's rates were chosen off that — but the models the kit signs at all are the ones whose
    // arms DIDN'T, and almost every 'front' arm signs itself. What arrives here is mostly block and
    // works, so rates picked for the registry's mix produced 16 gantries over the whole city.
    // ⚠ A WORKS GETS NO HOARDING AT ALL NOW. It was the MOST likely style to get one (a 0.60 gate
    // against `front`'s 0.22 reads backwards, and it was chosen to spend the budget on the models
    // that reach the kit rather than to say anything about industry) — so the refinery, the turbine
    // hall and the container yard each stood a lit, framed, lettered advertisement on the roof. See
    // the ⚠ on `signWorks` at the name board: a plant's name is on the gate.
    // ── ⚠ AND WHAT IT SAYS WAS DECIDED UP AT `roofTakesName`, NOT HERE ──────────────────────────
    //
    // The gate itself is `roofSigns`, rolled two hundred lines above so the name board underneath
    // could know the answer — this branch is only asking what to put ON it. Where the ARM already
    // letters the frontage, the hoarding carries the trade's MARK and no words: a martini, a fork,
    // a crane hook, standing lit on a roofline. That is a logo sign, it is what half the reference
    // boards show, and it says what the building is from further away than its name can be read at
    // all. ⚠ NO MARK MEANS NO HOARDING, rather than a blank board — the same call this section's
    // mast-clearance rule makes a dozen lines down, for the same reason.
    const logo = !roofTakesName;
    if (roofSigns && (!logo || bPicto)) {
      // ── …AND IT STANDS CLEAR OF THE MASTS THAT ARE ALREADY UP THERE ─────────────────────────
      //
      // ⚠ THIS IS THE "WIRES OVER THE SIGNAGE" REPORT, AND THE WIRE IS AN AERIAL MAST. Measured over
      // the registry, a guyed mast crossed a roof hoarding on 21 models: the arm raises one wherever
      // it likes, the kit rolled a lateral offset out of `R(303)` with no idea the mast was there,
      // and with the city's mass on a depth buffer the two simply intersect. It reads as somebody
      // having run a cable across the shop's name.
      //
      // Nothing can move the arm's mast — it is hand-written geometry and this pass is a guest on
      // that roof. What the kit CAN do is take the offset that clears it. Three candidates rather
      // than a solve, because the answer only has to be "not through the aerial": the rolled one,
      // and a step to either side of it.
      //
      // ⚠ THE SIZE AND THE SOLVE BOTH LIVE UP AT `roofTakesName` NOW, and the note there is why:
      // whether this board can stand decides whether the plate over the DOOR stands down, and that
      // is settled two hundred lines before this. Reading them rather than restating them is the
      // same rule `bladeSgn` and `hanziOK` already follow — see the ⚠ at `riserX`.
      const gw = gantryW(logo);
      const gx = gantryAt(gw);
      // ── ⚠ A LOGO BOARD SAYS WHAT THE SHOP IS, AND FOR A YEAR IT SAID NOTHING BUT ITS MARK ─────
      //
      // Reported off a pawnbroker: the three balls, alone, centred in a square gold frame on a
      // square dark plate, with a disc drawn round them — concentric geometry, most of the board
      // empty, and nothing on it a driver can read. A mark on its own is a trademark; a mark with
      // the trade under it is a sign, and `SIGN_WORD` has held that noun for fifty-odd trades
      // since the fascia subtitle shipped. So the biggest sign in the kit takes the stack.
      //
      // ⚠ AND THE BOARD IS CUT TO THE ARTWORK. `stackBox` is the one expression both ends read —
      // see its note. A square board under a wide stack is the dead plate this change is fixing,
      // in the other direction.
      const gWord = logo ? (SIGN_WORD[tradeOf(m)] || '') : '';
      const gBox = stackBox(gWord);
      // ⚠ AND IF NONE OF THEM CLEARS, THE SIGN IS NOT PUT UP. A deck with a mast up the middle and
      // no room either side gets a bare roof, which is what it had last week — a hoarding with an
      // aerial through it is worse than no hoarding, and this part is the one the kit can decline
      // most cheaply. ⚠ THAT ONLY EVER LOSES A LOGO BOARD NOW: a name hoarding that could not stand
      // never claimed the name in the first place, so the door plate is already carrying it.
      if (gx != null) push({ kind: 'signGantry',
        cx: A(gx),
        cy: A(roofOn.cy + roofOn.fd * 0.6),
        z: A(deckZ), half: A(gw), hh: A(gw * (logo ? clamp(gBox.H / gBox.W, 0.42, 1.0) : 0.28 + R(305) * 0.14)),
        rise: A(clamp(dhw * (0.2 + R(307) * 0.22), 0.018, 0.1)),
        ...(logo ? { label: gWord, stack: true } : { label: '$name' }), pal,
        // ── ⚠ A LOGO HOARDING IS A ROUNDEL ON A BOARD, AND A NAME HOARDING IS NOT ──────────────
        //
        // The `badge` plate is painted INTO the sign's texture (see `signBoard`), so unlike there —
        // where the flat quad is skipped and the disc IS the sign — the hoarding keeps its slab,
        // its legs, its edge returns and its lit surround, and the disc is drawn on the face of it.
        // That is what a logo hoarding actually is: a roundel on a backlit panel.
        //
        // ⚠ A NAME BOARD MUST NOT TAKE ONE. A disc round a word is a badge with a sentence in it —
        // the plate is sized to the artwork, and a ribbon of lettering inside a circle either
        // shrinks to nothing or spills out of it. Marks only, which is what `logo` already means.
        // ⚠ AND NOT ON A WORKS, whose hoarding is stencilled steel: see the neon note below.
        // ⚠ AND NO ROUNDEL UNDER IT ANY MORE. The disc was drawn INTO the artwork (see `signBoard`)
        // and is the second concentric shape in the report above: a circle, inside a square plate,
        // inside a lit rectangle. A stack has its own edges — the mark's and the word's — and a
        // plate round them is the one thing that stops them reading as two elements on a board.
        // A works never had one.
        color: style === 'works' ? shadeOf(pal, 0.32) : quietSign(pal) ? '#1c232a' : '#120f18',
        ink: style === 'works' ? '#cfc6b4' : quietSign(pal) ? '#eef3f7' : accent,
        // A lit tube round the board and lettering that burns rather than lettering that is painted.
        // A works keeps the steel surround and the stencil ink: a backlit hoarding on a chemical
        // plant is a different city from the one the rest of this kit is building.
        ...(style === 'works' || quietSign(pal) ? {} : { trim: accent, neon: true }),
        // The trade's own hand AND its mark. A board is wide enough to carry both, which is what
        // makes a martini beside a name read as a bar from down the street rather than as a name.
        ...(bFont ? { font: bFont } : {}), ...(bPicto ? { picto: bPicto } : {}) });
    }
    // ── AND A FULL-HEIGHT BLADE ──
    // The vertical slab down the corner of a bar or a hotel. It wants real height to be a blade
    // rather than a panel, and it belongs to the shopfront set — a blade on a warehouse is a
    // mistake you can see from the next street.
    //
    // ⚠ IT CARRIES A PICTOGRAM AND NEVER `$name`, and 3b's note is the reason. This list is cached
    // per MODEL and the name is resolved per BUILDING, so its LENGTH is not known here. A board
    // squashes a long name and stays readable; a blade turns one into a column of letters running
    // off the bottom of the building. The trade's own mark says the same thing at a fixed size.
    // ⚠ NOT `style === 'front'`, WHICH REACHED SIX MODELS. A blade down the corner of an office
    // tower is the reference boards' commonest sign and the neon set almost all sign themselves, so
    // the narrow gate put this on two buildings in the city. A works is still excluded: a lit slab
    // down a chemical plant is a different city.
    // ⚠ CHOSEN OUTSIDE THE GUARD, exactly as `riserX` and `svcSide` are and for the same reason:
    // the Chinese trade blade below reads it to take the OTHER corner, and a building whose name
    // blade was declined still needs the answer. Two copies of this roll would drift — which is
    // also why `bladeSgn` and this gate are now read from section 1, where the glazing band had to
    // know the answer before it could reserve the corner.
    if (nameBladeOK) {
      const bw = nameBw;
      const sgn = bladeSgn;
      // ── …AND WHAT THE BLADE SAYS ────────────────────────────────────────────────────────────
      //
      // ⚠ A TRADE WORD IN CHINESE IS THE ONE THING A BLADE CAN CARRY, and that is why it goes here
      // rather than anywhere else in the kit. This list is cached per MODEL and a name is resolved
      // per TILE, which is the whole reason the note above says a blade gets a pictogram and never
      // `$name`: its LENGTH is unknown here, and a twelve-character name down a blade runs off the
      // bottom of the building. A trade word is two characters, fixed, and known right now.
      //
      // It is also the right SHAPE for it. A blade is read top-to-bottom, CJK sets happily that way
      // and Latin does not, and `bakeSignText`'s vertical path already reserves one square CELL per
      // character — which is a compromise for Latin and exactly correct for a full-width glyph.
      //
      // ⚠ RATIONED TO ABOUT A THIRD, so this reads as a QUARTER of the city rather than as a theme.
      // A street where some frontages carry it and some do not is the one that looks real; every
      // shop in Coldwater wearing it is a costume. See the ⚠ on SIGN_HANZI.
      // Hard against one end of the front wall, in the strip section 1 reserved for it. A blade
      // through the middle of a facade is a partition, not a sign.
      const bx = main.cx + sgn * (main.hw * 0.84 - bw);
      const bz0 = main.z0 + Math.min(wallH * 0.3, GF + 0.02), bz1 = main.z1 - wallH * 0.07;
      // ⚠ AND IT IS STILL ASKED, BECAUSE THE RESERVATION ONLY REACHES THE KIT'S OWN GLAZING. An
      // AUTHORED window grid is in `m.detail` and nothing here can move it — Cash & Carrion puts a
      // column of bays at ±0.2915 and this lands at ±0.2914 — so the corner has to be checked as
      // well as reserved. Two candidates rather than a solve, exactly as the roof hoarding does
      // with a mast: the side the roll chose, then the other one.
      const bxOK = [bx, main.cx - sgn * (main.hw * 0.84 - bw)]
        .find((x) => clearsFace(x - bw, x + bw, bz0, bz1));
      // ⚠ AND IF NEITHER CORNER IS FREE THE BLADE IS NOT PUT UP. Same call the hoarding makes: a
      // sign drawn over a window is worse than a frontage without one, and this is the cheapest
      // part in the kit to decline.
      // ⚠ AND NO MARK MEANS NO BLADE, which is the roof hoarding's own call one section up and was
      // missing here. A blade genuinely cannot take `$name` — the note above says why, and it is
      // right — so a trade with nothing in `SIGN_TRADE`'s second column leaves this panel with
      // nothing on it at all. Measured over 227 models at eight seeds, 27 blades a city were a lit
      // slab with no content: not a quieter sign, a sign whose paint has come off.
      if (bxOK != null && bPicto) push({ kind: 'bladePanel',
        cx: A(bxOK), cy: A(fy),
        z0: A(bz0), z1: A(bz1),
        half: A(bw), out: A(bw * 0.95), color: accent, pal,
        picto: bPicto });
    }
    // ── AND THE TRADE, IN CHINESE, DOWN A BLADE OF ITS OWN ──────────────────
    //
    // ⚠ IT IS ITS OWN SECTION AND DELIBERATELY NOT PART OF `sign`, WHICH IS WHAT MAKES IT REACH THE
    // CITY AT ALL. Written inside the name blade above it was measured on 11 models: the `wants`
    // mechanism exists to keep the kit out of a section somebody has already drawn, and 66 arms
    // draw their own name — which is most of the neon set, because a bar with a hand-drawn sign is
    // exactly the building an arm author bothered with. So the one gate that reads "this frontage
    // is already signed" was excluding precisely the frontages this belongs on, and what was left
    // was Terminus, the Thornwarren and a few offices: 25 of 31 blade-bearing models had no trade
    // word at all, and none of the three districts that got one is the one this is for.
    //
    // A Chinese trade blade is NOT the building's name sign. It is a second fitting, like the neon
    // tube or the lamp post — a bar that has drawn its own name has said nothing about whether it
    // also hangs 酒吧 on the corner. So it asks only whether the building has a trade word and
    // whether there is a wall to hang it on.
    //
    // ⚠ IT TAKES THE OTHER FLANK FROM THE NAME BLADE. Both want a corner, and both defaulting to
    // the same roll would stand two lit slabs in the same place — the riser-and-stair rule again.
    // ⚠ AND IT IS SHORTER AND STARTS HIGHER than a name blade: this is a two-character sign hung at
    // first-floor level over the pavement, not a slab running the height of the building.
    // ⚠ THE GATE IS `hanziOK`, ROLLED IN SECTION 1 — see the ⚠ there. The glazing band had to know
    // whether this corner was going to be used before it could leave room for it, and the same
    // roll in two places is the drift this file warns about at `riserX`.
    // Whether the trade actually ended up SAID on this frontage. The roundel below is the other
    // half of that sentence and must not repeat it.
    let tradeHung = false;
    if (hanziOK) {
      const bw = hzBw;
      const side = -bladeSgn;
      // ⚠ IT HANGS ABOVE THE SHOPFRONT, NOT BESIDE IT, and the first cut did not — which the sign
      // gate caught immediately on four buildings. A ground-floor band is the busiest strip of wall
      // in the city: it carries the awning, the glazing, the name board, the neon tube, the
      // condenser and whatever bracket the arm hung there by hand. A blade started at first-floor
      // level lands in the middle of all of it.
      //
      // It is also simply what a projecting sign IS. The reason a blade exists rather than a board
      // is that it hangs out over the PAVEMENT to be read from down the street, which means it
      // starts where the awning stops. Clearing the name board is the same rule the neon tube two
      // sections up follows, for the same reason and off the same number.
      // ⚠ AND IT IS A FIRST-FLOOR FITTING, WHICH IS A FLOOR AND NOT A FRACTION. Clearing the name
      // board and the awning is not enough on its own: The Coyote's Rest has a full-width porch
      // whose rail stands 0.6 of a tile proud of its wall, and no projection a blade could sensibly
      // have will clear that — the answer is to hang above the porch rather than to reach past it.
      // 0.17 is the storey height `derivedKit` already works in, so this says "one floor up" in the
      // same units the window bands are placed in.
      const z0 = Math.max(signTop + 0.02, main.z0 + Math.max(GF + 0.05, 0.17));
      const z1 = Math.min(z0 + bw * 5.4, main.z1 - wallH * 0.06);
      // ⚠ THE CORNER IS RESERVED AND STILL CHECKED — see the name blade above. The reservation
      // reaches the kit's own glazing; an authored grid is in `m.detail` and cannot be moved, and
      // this is the sign that was landing on top of one. Two candidates, then decline.
      const hx = [main.cx + side * (main.hw * 0.84 - bw), main.cx - side * (main.hw * 0.84 - bw)]
        .find((x) => clearsFace(x - bw, x + bw, z0, z1));
      // ⚠ A CONDITIONAL PUSH AND NEVER AN EARLY `return`: this is the middle of `derivedKit`, and
      // bailing out here would take the gable-end ad panel and the trade roundel with it.
      tradeHung = hx != null;
      if (hx != null) push({ kind: 'bladePanel', label: hz, font: 'hanzi',
        cx: A(hx), cy: A(fy),
        z0: A(z0), z1: A(z1),
        // ⚠ THE HOT ACCENT RATHER THAN THE BUILDING'S OWN. A trade blade is the loudest small thing
        // on the frontage in every reference of this city, and `accentOf` answers a cold blue for
        // the whole `block` set — which is most of what this lands on.
        // ⚠ IT PROJECTS FURTHER THAN THE AWNING, AND AT `bw * 0.95` IT DID NOT. A blade exists to be
        // read from down the street, which means it has to stand clear of everything else on that
        // frontage — the kit's own canopy reaches 0.075 and a hand-drawn porch can reach past 0.11.
        // Measured on The Dry Goods: the blade sat 0.04 out and the building's porch framing stood
        // 0.04 to 0.11 out, so the sign was hung BEHIND the porch it was meant to be read past. The
        // same argument `BLADE_PROUD` already makes for `neonBlade`, and the same bound: comfortably
        // past the deepest frontage and comfortably under the 0.56 to a building one tile in front.
        half: A(bw), out: A(clamp(bw * 2.8, 0.075, 0.14)), color: m.neon || PICTO_HANZI_INK, pal });
    }
    // ── AND THE TRADE AS A MARK, ON A ROUNDEL ──────────────────────────────────────────────────
    //
    // ⚠ THE CITY HAD A TABLE OF TRADE MARKS AND ALMOST NOWHERE TO PUT ONE. `SIGN_TRADE`'s second
    // column has said what every listed trade SELLS since it was written, and the only two fittings
    // that could carry it were a name board and a roof hoarding — both gated on `wants('sign')`,
    // which is exactly the gate that excludes the 66 arms that letter their own frontage. So the
    // buildings somebody bothered to hand-draw, which are the landmarks, were the ones that could
    // never show their mark.
    //
    // A mark is not a name, and the Chinese blade above already makes this argument in full: a
    // building that has written CASH & CARRION over its door has said nothing about whether it also
    // hangs the three balls on the corner. So this asks only whether the trade HAS a mark and
    // whether there is a clear patch of wall — and `roundelOK` has already made sure it is not
    // being hung on a frontage that is carrying the Chinese word for the same thing.
    //
    // ⚠ IT IS A DISC, AND THE DISC IS PAINTED RATHER THAN BUILT. See the ⚠ in `signBoard`: nothing
    // in GLASS can draw a curved surface, so `badge` puts the rounded plate in the sign's own baked
    // texture and skips the square board quad underneath. The quad is an ordinary `signBoard` quad;
    // what you see is a roundel.
    // ⚠ `!tradeHung`, WHICH IS THE BLADE'S RESULT AND NOT ITS GATE. A frontage already carrying
    // 當舖 does not also want the three balls; a frontage whose blade was declined for want of a
    // clear corner still wants its trade said, and a badge is small enough to find one.
    if (roundelOK && !tradeHung) {
      const rz = Math.max(signTop + 0.03, main.z0 + Math.max(GF + 0.06, 0.19)) + rdR;
      const rx = [main.cx + -bladeSgn * (main.hw * 0.84 - rdR), main.cx + bladeSgn * (main.hw * 0.84 - rdR)]
        .find((x) => clearsFace(x - rdR, x + rdR, rz - rdR, rz + rdR));
      if (rx != null && rz + rdR < main.z1 - wallH * 0.05) {
        push({ kind: 'signBoard', badge: true, picto: tradePicto,
          cx: A(rx), cy: A(fy), z: A(rz), half: A(rdR), hh: A(rdR),
          // The plate is the building's own dark, the mark burns its accent. Same pair the name
          // board uses, so a roundel and a board on one street read as the same signwriter.
          color: '#151119', ink: accent, pal });
      }
    }
    // ── AND A GABLE-END AD PANEL ──
    // A blank flank is the one surface in the city a wall texture cannot make interesting, and it
    // is exactly where a real city hangs its biggest advertisement. Nearly flush — `out` is a
    // hundredth of a tile — because this is a backlit panel bolted to a wall rather than a blade
    // standing off one, and the edge return is all that separates the two.
    //
    // ⚠ IT TAKES THE FLANK THE SERVICE KIT DID NOT, which is why `svcSide` is chosen outside that
    // section's guard. A riser, a cable drop and a condenser all live on the other one, and a
    // billboard over the plumbing is the one arrangement nobody builds.
    //
    // ⚠ AND IT DECLINES ON A LOPSIDED MASS, the same rule the flank service kit follows: `faceY`
    // pushes outward by the sign of the coordinate and assumes a roughly centred building, so a
    // flank plane that does not straddle the origin can end up on the wrong side of its own wall.
    if (style !== 'works' && !NO_AD_TRADE.has(tradeOf(m)) && fxPos > 0.02 && fxNeg < -0.02 && wallH > 0.34 && main.fd > 0.1 && R(313) > gateFor(0.52)) {
      const adX = svcSide > 0 ? fxNeg : fxPos;
      const ph = clamp(wallH * 0.16, 0.04, 0.11);
      // ── ⚠ AND IT SAYS SOMETHING ───────────────────────────────────────────────────────────────
      // The kit's biggest sign. Over 227 models at eight seeds, 68 per city were blank and 23 held one
      // small mark.
      // ⚠ `$name` IS SAFE HERE AND NOT ON THE BLADE ABOVE: this is a wide board like the roof hoarding,
      // so `fitSignPts` handles the length, and `horiz` keeps it from lettering down a column.
      // ⚠ THE MARK STAYS BESIDE IT: `bakeSignText`'s horizontal path puts the pictogram left and the
      // word in the rest. The painter asks per TILE, so a nameless tile still gets its mark.
      // ── ⚠ AND NOW IT HAS TO ASK WHETHER THE WALL IS BARE ──────────────────────────────────────
      // A name fills the panel, so it reaches whatever else is on the flank (`signfit`: ten models drew
      // a pipe, cable or stair across it).
      // ⚠ `paintFree`, NOT `clearsFace`: that one answers for the entrance plane only (`c.x ||` passes
      // flanks); this checks any wall. `street` is false: no pavement rule on a side elevation.
      // ⚠ IT DECLINES ABOUT HALF (96 → 39 per city, 227 models × 8 seeds): the ones whose flank has a
      // window bay, louvre bank or riser. A sign over a window is worse than none.
      const adZ1 = main.z1 - wallH * 0.26, adZ0 = adZ1 - 2 * ph, adHW = main.fd * 0.62;
      // ── ⚠ AND THE NAME MADE THIS THE BUILDING'S OWN SIGNAGE, WHICH IT WAS EXEMPT FROM BEING ───
      //
      // `UNSIGNED_TRADE`'s own note says this panel is deliberately not gated on `signsItself`,
      // and gives the reason: a hoarding on a blank flank is somebody ELSE'S advertisement, which
      // is what the flank of a warehouse is for. That was true while it carried a pictogram. It
      // stopped being true the moment `$name` went on it: a panel three storeys wide spelling the
      // building's own name is the building advertising itself, on the one fitting that had been
      // excused from asking. Nothing caught it because the exemption was correct when it was
      // written and the note was never re-read against the change.
      //
      // ⚠ THE PANEL IS NOT GATED, THE NAME IS — AND GATING THE PANEL WAS TRIED AND IS WRONG.
      // `bPicto` is `''` for every `works`, so declining a panel that could say neither its name
      // nor its mark takes the hoarding off every warehouse, cold store and depot in the city:
      // precisely the buildings whose blank flank beside a road is what the exemption is about.
      // So the panel stands whatever the trade, and a building that does not letter its own
      // frontage goes back to the mark-or-nothing it carried before `$name` landed on this
      // fitting. A building with no wall left to rent says so in `NO_AD_TRADE`, which is the set
      // that already answers exactly that question.
      const adSays = signsItself(m, style);
      if (paintFree('x', adX, -main.cy - adHW, -main.cy + adHW, adZ0, adZ1, false)) {
        push({ kind: 'bladePanel', face: 'x', horiz: true, ...(adSays ? { label: '$name' } : {}),
          cx: A(-main.cy), cy: A(adX),
          z0: A(adZ0), z1: A(adZ1),
          half: A(adHW), out: A(0.008), color: accent, pal,
          ...(bPicto ? { picto: bPicto } : {}) });
      }
    }
  }
  // ── 5. THE MASS ITSELF, BANDED ────────────────────────────────────────────
  //
  // `models:quality` fails 22 of 173 on "more than one wall palette", and 26 more are a box and a
  // lid. The arms own the mass; the kit BANDS it: a plinth at the pavement and a frieze under the
  // cornice, both drawn with `parapet` (a darker face and a lighter cap).
  // ⚠ A BAND IS SQUARE-ONLY: `parapet` takes one half-width for all four sides (hence the deck
  // coping's `Math.abs(hw - fd) <= 0.02`). 163 of 172 models have a square base, 169 a square main.
  // ⚠ THE CROWN ASKS `wants('cope')` AND THE PLINTH DOESN'T. Both are `parapet`, but nobody
  // hand-draws a base course, and a second band under a hand-drawn cornice is a doubled line.
  // ── 6. AND THE LIGHT ON IT ────────────────────────────────────────────────
  //
  // A lit tube in the building's accent: the cheapest change to how a street looks at night, and
  // the only one the box-and-lid models can take.
  // ⚠ IT'S RATIONED (`gateFor`), NOT GATED ON `m.neon`. `accentOf` gives all 180 a colour from the
  // trade's mark and the facing, so there's no shared default cyan to avoid. An authored `m.neon`
  // still wins the colour and is never refused the tube.
  // ⚠ IT RUNS AT THE FOOT OF THE FRONTAGE, BELOW `GF`, BECAUSE THE FASCIA HAS NO ROOM. The name
  // board sits at `GF + 0.036` and the corner blades start at `GF + 0.02`, below the board's top.
  // The tube sits on the BASE box and the blades on the BIGGEST, which differ on a podium-and-tower,
  // so no lateral clearance works up there. Board, canopy and blades are above `GF`; this is below
  // it. No returns: they'd run into the pavement.
  // ⚠ IT'S ALSO THE NEON `glWet` REFLECTS: a line at ankle height sits over the puddle.
  const wantsTube = m.neon ? true : R(403) > gateFor(0.42);
  if (wantsTube && !period && wants('neon') && style !== 'works' && base.hw > 0.1 && bh > 0.08) {
    push({ kind: 'neonRun', cx: A(base.cx), cy: A(by), z: A(base.z0 + Math.min(GF * 0.2, 0.02)),
      half: A(base.hw * 0.92), drop: A(0), color: accentOf(m), pal });
  }
  if (rich) {
    const sq = (e) => Math.abs(e.hw - e.fd) <= 0.02;
    // ⚠ 0.05, NOT 0.08. The base box is often a podium lip or a step rather than a storey, and at
    // 0.08 the plinth reached 92 models where the geometry allows 135 — it was the box's own HEIGHT
    // turning it away, not its shape. The band's height is clamped at 0.012 anyway, so a short base
    // gets a proportionate one rather than a band as tall as itself.
    if (sq(base) && bh > 0.05 && base.hw > 0.1) {
      push({ kind: 'parapet', cx: A(base.cx), cy: A(base.cy), z: A(base.z0),
        half: A(base.hw * 1.04), hh: A(clamp(bh * 0.09, 0.012, 0.032)), pal });
    }
    // A storey below the top, not immediately under the coping: at a hand's width apart the two
    // bands merge into one thick line at any distance worth having them at.
    // ⚠ THE BAND IS `courseZ`/`courseHH`, DERIVED ONCE. A second expression of one height is
    // exactly how the neon tube came to run through the middle of the name board.
    if (wants('cope') && sq(main) && wallH > 0.3 && main.hw > 0.1) {
      push({ kind: 'parapet', cx: A(main.cx), cy: A(main.cy), z: A(courseZ),
        half: A(main.hw * 1.02), hh: A(courseHH), pal });
    }
  }
  // The front grid above is the kit's; a wall it glazed is a wall the texture no longer paints.
  if (rich && RENDER_TUNE.glazeAll && winSpent > 0 && wallPanesPainted(main.sg.pal || pal)) {
    glazed.push({ n: [0, 1], plane: fy, a0: main.cx - main.hw, a1: main.cx + main.hw, z0: main.z0, z1: main.z1 });
  }
  if (rich && RENDER_TUNE.glazeAll) glazeWalls(list, cand, mass, m, seed, A, style, main, signTop,
    claims, blocks, glazed, (KIT_DECLINE[tradeOf(m)] || []).includes('wall'));
}

// ── 7. EVERY OTHER WALL A PAINTED WINDOW WAS ON ───────────────────────────────────────────────
//
// Section 1 glazes the front of the biggest box, and section 1d's ⚠ explains why the flanks got
// plumbing and no windows: the wall texture already painted a grid on all four sides. That grid is
// two texels by three a pane at texRes 1 and four by six at the `paneFloor`, tiled over the wall
// with no idea where a pier, a riser or the next floor is, and beside a real bay it reads as a
// smudge. Reported from the street (2026-10-18) as "the right windows are bad", on a flank.
//
// So on the mesh, every wall whose palette paints the grid gets real bays instead, and the face is
// recorded in `glazed` so `captureModelMesh` bakes it bare (`wallTex`'s `bare`): the two never
// share a wall. A palette in a family (brick hall, stone civic, curtain glass) paints no grid and is
// left alone, because a blind wall there is the building's design and not a missing window.
//
// ⚠ IT RUNS LAST, so it can step round everything already hung: risers, the fire escape, the gable
// ad, tags, condensers (`blocks`, which records x-face parts with `x: true`). A bay that would land
// on one is dropped, never moved: a column of windows with one missing reads as a building.
// ⚠ ITS OWN CEILING, OUTSIDE `spent`. Pushed last, it could never starve another section anyway,
// and counting it against `kitMax` would make the budget say a building was full when it wasn't.
// ⚠ A BAY INSIDE OTHER MASS IS SKIPPED. A wing standing against a flank hides that stretch of it,
// and a bay there costs eight quads nobody sees and pokes its sill through the wing's wall.
// ⚠ THE FRONT OF THE BASE IS NOT GLAZED HERE. Below `signTop` is the shopfront band, which the
// ground section dresses; a front face is glazed only from the name band up.
// ⚠ A WALL RUNS OUT OF COLUMNS BEFORE IT RUNS OUT OF FLOORS. Vertical rhythm is what reads as
// storeys (section 1's ⚠), so a tall wall over its share keeps every floor and thins the columns.
const GLAZE_MAX_RICH = 96, GLAZE_FACE_MAX = 30;
function glazeWalls(list, cand, mass, m, seed, A, style, main, signTop, claims, blocks, glazed, declined) {
  if (declined) return;
  const warm = style === 'front' ? '#bfe4ff' : '#e8d6a8', unlit = '#1b2430';
  const wr = parseInt(warm.slice(1, 3), 16), wg = parseInt(warm.slice(3, 5), 16), wb = parseInt(warm.slice(5, 7), 16);
  const cl = (x) => Math.max(0, Math.min(255, Math.round(x)));
  // The same warmth-and-brightness roll the front grid gives its rooms (see `paneLit` there).
  const glowOf = (k) => {
    const t = dRand(seed, k * 7 + 3) * 2 - 1, v = 0.72 + dRand(seed, k * 7 + 5) * 0.38;
    return 'rgb(' + cl((wr + t * 26) * v) + ',' + cl((wg + t * 4) * v) + ',' + cl((wb - t * 34) * v) + ')';
  };
  const wpal = trimPalFor(m);
  // Is the point just outside a wall inside some OTHER box? `e` is the box the wall belongs to.
  const inOther = (e, x, y, z) => mass.some((o) => o !== e && z > o.z0 && z < o.z1
    && Math.abs(x - o.cx) < o.hw && Math.abs(y - o.cy) < o.fd);
  // Clear of every part on this plane? `xFace` says which kind of plane: blocks carry `x` for a flank.
  const clear = (xFace, plane, a0, a1, z0, z1) => blocks.every((b) => !!b.x !== xFace || Math.abs(b.plane - plane) > 0.06
    || a0 > b.x1 + 0.012 || a1 < b.x0 - 0.012 || z0 > b.z1 + 0.012 || z1 < b.z0 - 0.012)
    && claims.every((c) => !!c.x !== xFace || Math.abs(c.cy - plane) > 0.06
    || a0 > c.x1 + 0.012 || a1 < c.x0 - 0.012 || z0 > c.z1 + 0.012 || z1 < c.z0 - 0.012);
  // Every wall of every candidate box, but the one section 1 already did.
  const faces = [];
  for (const e of cand) {
    const wallH = e.z1 - e.z0;
    // Under 0.06 is a plinth or a lip, not a storey; the texture's grid on it is a few texels high.
    if (!(wallH > 0.06) || !wallPanesPainted(e.sg.pal || m.pal)) continue;
    const yB = e.cy - e.fd, yF = e.cy + e.fd, xP = e.cx + e.hw, xN = e.cx - e.hw;
    // ⚠ THE SIGN OF THE PLANE IS WHICH SIDE THE PAINTER PUTS IT, for section 1d's reason: a wall
    // on the wrong side of the origin would be drawn facing in. Declined rather than got wrong.
    if (xP > 0.02) faces.push({ e, x: true, out: 1, plane: xP, c: e.cy, half: e.fd, wallH });
    if (xN < -0.02) faces.push({ e, x: true, out: -1, plane: xN, c: e.cy, half: e.fd, wallH });
    if (yB < -0.02) faces.push({ e, x: false, out: -1, plane: yB, c: e.cx, half: e.hw, wallH });
    if (e !== main && yF > 0.02) faces.push({ e, x: false, out: 1, plane: yF, c: e.cx, half: e.hw, wallH, front: true });
  }
  // The broadest walls first, so the ceiling runs out on the small ones.
  faces.sort((a, b) => b.half * b.wallH - a.half * a.wallH);
  // ⚠ A GABLE AD IS PAINTED ON A BLIND WALL, and that is what it is for. Glazed round, it was a
  // billboard with a row of windows above it and four below. The flank carrying one stays blind.
  const R3 = (q) => (Array.isArray(q) ? q[2] : (q || 0));
  const gable = list.filter((d) => d.kind === 'bladePanel' && d.face === 'x').map((d) => R3(d.cy));
  // The ad is hung on the biggest box's own flank plane (`adX`), so the match is tight: a podium's
  // flank stands a few hundredths out from the tower's and keeps its windows.
  const blind = (f) => f.x && gable.some((p) => Math.abs(p - f.plane) < 0.01);
  let n = 0, k = 600, any = false;
  const bandOnly = [];
  for (const f of faces) {
    const { e, wallH } = f;
    // A band too short for a window (a podium lip, a parapet storey) takes no bays; it bakes bare
    // with the rest of the building below, rather than keeping a grid a few texels high.
    // So is a front wall that stands wholly in the shopfront band: the ground section dresses it.
    // And a wall the building's ceiling has run out for: smaller than everything before it, by the sort.
    if (wallH < 0.09 || (f.front && e.z1 < signTop + 0.1) || n >= GLAZE_MAX_RICH || blind(f)) { bandOnly.push(f); continue; }
    const floors = clamp(Math.round(wallH / 0.17), 1, FLOOR_MAX_RICH);
    const share = Math.max(1, Math.min(GLAZE_FACE_MAX, GLAZE_MAX_RICH - n));
    const cols = clamp(Math.round((f.half * 1.5) / (1.5 * COL_PITCH_RICH)), 1, Math.min(COL_MAX_RICH, Math.max(1, Math.floor(share / floors))));
    const cw = (f.half * 1.5) / cols;
    const wh = Math.min(0.042, wallH / (floors * 2.9)), ww = Math.min(cw * 0.33, wh * 0.68);
    const fr = Math.min(ww, wh) * 0.26;   // the surround: see `faceClaim`
    let put = 0;
    for (let fl = 0; fl < floors && put < GLAZE_FACE_MAX && n < GLAZE_MAX_RICH; fl++) {
      // A lone storey on a short box centres its window rather than losing it off the top.
      const z = Math.min(e.z0 + wallH * ((fl + 0.62) / floors), e.z1 - 0.012 - wh);
      if (z - wh < e.z0 + 0.008) continue;
      if (f.front && z - wh < signTop + 0.02) continue;
      for (let i = 0; i < cols && put < GLAZE_FACE_MAX && n < GLAZE_MAX_RICH; i++) {
        const t = f.c - f.half * 0.75 + cw * (i + 0.5);   // along the wall, in the model's own x or y
        // A flank's own along-axis is −y (see section 1d), so its rectangle is tested in those units.
        const a = f.x ? -t : t;
        if (!clear(f.x, f.plane, a - ww - fr, a + ww + fr, z - wh - fr, z + wh + fr)) continue;
        const px = f.x ? f.plane + f.out * 0.012 : t, py = f.x ? t : f.plane + f.out * 0.012;
        if (inOther(e, px, py, z)) continue;
        const lit = dRand(seed, k * 3 + 1) > 0.34;
        const p = { kind: 'windowBay', ...(f.x ? { face: 'x' } : {}), cx: A(a), cy: A(f.plane), z: A(z),
          half: A(ww), hh: A(wh), depth: A(Math.min(ww, wh) * 0.3), pal: wpal, bars: 1, transom: 0.3,
          glow: lit ? glowOf(k) : unlit };
        k++;
        list.push(p); n++; put++;
        const c = faceClaim(p, (q) => (Array.isArray(q) ? q[2] : (q || 0))); if (c) claims.push(c);
      }
    }
    // A wall every bay was refused on (a fire escape across it, a wing in front) bakes bare as well:
    // on a building whose other walls are glazed, a painted grid on this one is the odd one out.
    if (put) { any = true; glazed.push(glazeRec(f)); } else bandOnly.push(f);
  }
  if (any || glazed.length) for (const f of bandOnly) glazed.push(glazeRec(f));
}
// A glazed wall, in the model's own frame: `n` the outward normal, `plane` where the wall is along
// it, a0..a1 its run along the wall in plain x (front and back) or plain y (a flank).
const glazeRec = (f) => ({ n: f.x ? [f.out, 0] : [0, f.out], plane: f.plane, a0: f.c - f.half, a1: f.c + f.half, z0: f.e.z0, z1: f.e.z1 });
