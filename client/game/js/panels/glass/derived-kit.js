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
          // Then lifted over the stair, which otherwise crosses the middle of the name.
          // ⚠ `overFittings` takes `-main.cy`: `blocks` holds the pushed part's own `cx`.
          const seatZ = clearOfMass(true, sd, px, main.cy, kHalf, nameHH, nameZ, main.z1).z;
          const kZ = overFittings(true, px, -main.cy, kHalf, nameHH, seatZ, main.z1);
          // Only if the lift found nowhere, slide along the wall (`besideFittings`).
          const slide = kZ === seatZ
            ? besideFittings(true, px, -main.cy, kHalf, nameHH, kZ, kHalf * NAME_RUN_MIN) : null;
          push({ kind: 'signBoard', bare: true, face: 'x',
            cx: A(slide ? slide.cx : -main.cy), cy: A(px), z: A(kZ),
            half: A(slide ? slide.half : kHalf), hh: A(nameHH), label: '$name' });
        }
      }
    }
    // Street-level plant beside the door: a condenser and an extract grille.
    const px = base.cx + base.hw * (dRand(seed, 63) > 0.5 ? 0.78 : -0.78);
    push({ kind: 'acUnit', drip: 1, cx: A(px), cy: A(by + 0.012), z: A(base.z0 + GF * 0.72),
      w: A(Math.min(base.hw * 0.1, 0.032)), d: A(Math.min(base.hw * 0.07, 0.022)),
      hh: A(Math.min(GF * 0.17, 0.022)), pal });
    if (dRand(seed, 65) > 0.45) {
      push({ kind: 'vent', drip: 1, cx: A(base.cx - (px - base.cx) * 0.55), cy: A(by),
        z: A(base.z0 + GF * 0.78), w: A(Math.min(base.hw * 0.11, 0.036)),
        hh: A(Math.min(GF * 0.14, 0.02)), pal });
    }
    // ── THE PAVEMENT ────────────────────────────────────────────────────────
    // ⚠ Each prop is rationed on its own roll; a lamp at every door is a fence. Over 64 seeds: lamp
    // 25%, bollards 11%, vending machine 15% of frontages.
    // ⚠ They stand off the building on the pavement, so they're deliberately out of `anchored.mjs`'s
    // FACE_PARTS and out of SECTION_OF.
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
    // Bins at the service end, away from the door (`px`), on any style.
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
  // ── NOBODY HAS WASHED IT ───────────────────────────────────────────────────────────────
  // `grime` runs for GRIME_TRADE, which has no grille for `dripStain` to hang off.
  // ⚠ Pushed before the paint (a wall gets dirty first); `grime` is out of PAINT_WALL so paint still lands.
  if (GRIME_TRADE.has(tradeOf(m))) {
    const gy = base.cy + base.fd;
    // The street face, from the top of the standing wall down.
    push({ kind: 'grime', cx: A(base.cx), cy: A(gy), z: A(base.z1), w: A(base.hw * 0.86), drip: 0.5 });
    // A second, narrower run off a rolled end; one centred stain reads as a mark.
    const gs = dRand(seed, 227) > 0.5 ? 1 : -1;
    push({ kind: 'grime', cx: A(base.cx + gs * base.hw * 0.62), cy: A(gy),
      z: A(base.z1 - (base.z1 - base.z0) * 0.18), w: A(base.hw * 0.3), drip: 0.85 });
    // Flanks and back on the rich list only, with 1d's lopsided-mass guard.
    if (rich && main.hw > 0.08 && main.fd > 0.08) {
      const backY = main.cy - main.fd;
      if (backY < -0.02) push({ kind: 'grime', cx: A(main.cx), cy: A(backY), z: A(main.z1), w: A(main.hw * 0.8), drip: 0.6 });
      if (fxPos > 0.02 && fxNeg < -0.02) {
        push({ kind: 'grime', face: 'x', cx: A(-main.cy), cy: A(svcSide > 0 ? fxPos : fxNeg),
          z: A(main.z1), w: A(main.fd * 0.78), drip: 0.6 });
      }
    }
  }
  // ── SOMEBODY HAS BEEN AT THE WALL ──────────────────────────────────────────────────────
  // ⚠ A piece is placed by solving for bare runs against `blocks`, never at a fixed fraction (the
  // depth buffer hides an obstructed tag silently; see `scripts/shapes/tagfit.mjs`).
  // ⚠ Pushed after the kerb props, so the bins are on the list. Not inside `wants('ground')`.
  // The street face is on both lists; the other three walls are rich-only. `paint` can be declined.
  if (wants('paint')) {
    // A piece is an arm's reach tall, sized off the wall it's on. ⚠ Never `GF`, the base box's band:
    // on a tower over a shallow plinth that's too small to see.
    const reach = (z0, z1) => Math.min((z1 - z0) * 0.62, 0.115);
    // The bare runs at the paint band. ⚠ The piece is sized to its gap with a floor; a piece that
    // shrinks until it fits makes the test unable to fail. ⚠ `spansLess` is shared with the player's
    // own paint (`drawWallTags`), so there's one idea of a bare wall.
    const bareRuns = (face, plane, lo, hi, z0, z1, street) => spansLess([[lo, hi]], blocks
      .filter((b) => !!b.x === !!face
        && (b.kerb ? (street && Math.abs(b.plane - plane) <= 0.22) : Math.abs(b.plane - plane) <= WALL_PLANE_TOL)
        && !(z0 > b.z1 || z1 < b.z0))
      .map((b) => [b.x0, b.x1]));
    // A margin so a piece stops at brick, not at a window frame.
    const TAG_GAP_PAD = 0.006;
    const sprayOn = (face, plane, mid, run, z0, z1, street, salt) => {
      const gf = reach(z0, z1);
      // ⚠ The hand comes off `v` (salt + 3), never a new salt, which would move every tag in the city.
      const v = Math.floor(dRand(seed, salt + 3) * 997);
      const hand = tagHandFor(v);
      const band = tagBandFor(hand);
      // Each hand has its own height band (a roller piece sits high), clamped to the wall.
      const hh = Math.min(gf * 0.26, 0.032) * band.hh;
      const z = clamp(z0 + gf * (0.34 + 0.68 * band.lift), z0 + hh, z1 - hh);
      const full = Math.min(run * 0.34, 0.055) * band.w;
      const gaps = bareRuns(face, plane, mid - run, mid + run, z - hh, z + hh, street)
        .map((g) => [g[0] + TAG_GAP_PAD, g[1] - TAG_GAP_PAD])
        .filter((g) => g[1] - g[0] >= 0.024);
      if (!gaps.length) return;
      // A rolled pick among runs that fit a full piece, else the widest.
      const big = gaps.filter((g) => g[1] - g[0] >= full * 2);
      const pool = big.length ? big : [gaps.reduce((a, g) => (g[1] - g[0] > a[1] - a[0] ? g : a))];
      const g = pool[Math.floor(dRand(seed, salt) * pool.length) % pool.length];
      const w = Math.min(full, (g[1] - g[0]) * 0.5);
      if (!(w > 0.012)) return;
      const cx = (g[0] + g[1]) * 0.5;
      push({ kind: 'tag', ...(face ? { face: 'x' } : {}), cx: A(cx), cy: A(plane), z: A(z),
        w: A(w), hh: A(hh), hand,
        color: TAG_COLS[Math.floor(dRand(seed, salt + 1) * TAG_COLS.length) % TAG_COLS.length],
        n: 3 + Math.round(dRand(seed, salt + 2) * 3), v });
    };
    // The street face.
    if (bh > 0.05 && base.hw > 0.1 && dRand(seed, 77) > 0.62) {
      sprayOn(false, by, base.cx, base.hw, base.z0, base.z1, true, 210);
    }
    if (rich && main.hw > 0.08 && main.fd > 0.08) {
      // The back has the loosest ration in the kit.
      const backY = main.cy - main.fd;
      if (backY < -0.02 && dRand(seed, 214) > 0.34) {
        sprayOn(false, backY, main.cx, main.hw, main.z0, main.z1, false, 215);
      }
      // ⚠ 1d's lopsided-mass guard.
      if (fxPos > 0.02 && fxNeg < -0.02) {
        // Service flank first, read from `svcSide`, never re-rolled.
        for (const [sd, gate, salt] of [[svcSide, 0.42, 219], [-svcSide, 0.62, 223]]) {
          if (dRand(seed, salt) <= gate) continue;
          sprayOn(true, sd > 0 ? fxPos : fxNeg, -main.cy, main.fd, main.z0, main.z1, false, salt + 1);
        }
      }
    }
  }

  // ── 4. SIGNS THE SIZE OF THE BUILDING ─────────────────────────────────────
  // A roof hoarding and a full-height corner blade. Rich list only: the biggest parts in the kit.
  // Rationed by style so the commercial strip carries them and the blocks behind stay dark.
  if (rich) {
    const accent = accentOf(m);
    const [bFont, bPicto] = (style !== 'works' && SIGN_TRADE[tradeOf(m)]) || ['', ''];
    // ── A ROOF HOARDING ──
    // Only on a real deck. A works gets none. The gate (`roofSigns`) and what it says
    // (`roofTakesName`) were decided above; where the arm letters the front, it carries the trade's
    // mark and word instead, and with no mark there's no hoarding.
    const logo = !roofTakesName;
    if (roofSigns && (!logo || bPicto)) {
      // Offset to clear the arm's aerial masts (sized and solved at `roofTakesName`).
      const gw = gantryW(logo);
      const gx = gantryAt(gw);
      // A logo board is the mark with the trade word under it, cut to the artwork by `stackBox`.
      const gWord = logo ? (SIGN_WORD[tradeOf(m)] || '') : '';
      const gBox = stackBox(gWord);
      // ⚠ If no offset clears a mast, no hoarding; only a logo board can be lost this way.
      if (gx != null) push({ kind: 'signGantry',
        cx: A(gx),
        cy: A(roofOn.cy + roofOn.fd * 0.6),
        z: A(deckZ), half: A(gw), hh: A(gw * (logo ? clamp(gBox.H / gBox.W, 0.42, 1.0) : 0.28 + R(305) * 0.14)),
        rise: A(clamp(dhw * (0.2 + R(307) * 0.22), 0.018, 0.1)),
        ...(logo ? { label: gWord, stack: true } : { label: '$name' }), pal,
        // ⚠ No `badge` roundel on a hoarding: a stack has its own edges, and a disc round a word fails.
        color: style === 'works' ? shadeOf(pal, 0.32) : quietSign(pal) ? '#1c232a' : '#120f18',
        ink: style === 'works' ? '#cfc6b4' : quietSign(pal) ? '#eef3f7' : accent,
        // Neon trim and lettering, except on a works or in Halcyon Fields.
        ...(style === 'works' || quietSign(pal) ? {} : { trim: accent, neon: true }),
        // The trade's own hand and its mark.
        ...(bFont ? { font: bFont } : {}), ...(bPicto ? { picto: bPicto } : {}) });
    }
    // ── AND A FULL-HEIGHT BLADE ──
    // A vertical slab down a corner; not on a works.
    // ⚠ A pictogram, never `$name`: the list is cached per model, so the name's length is unknown
    // and a long one runs off the building. The gate and side were decided in section 1.
    if (nameBladeOK) {
      const bw = nameBw;
      const sgn = bladeSgn;
      // Hard against one end of the front wall, in the strip section 1 reserved.
      const bx = main.cx + sgn * (main.hw * 0.84 - bw);
      const bz0 = main.z0 + Math.min(wallH * 0.3, GF + 0.02), bz1 = main.z1 - wallH * 0.07;
      // ⚠ Still checked: the reservation only moves the kit's glazing, not authored windows. The
      // rolled corner, then the other.
      const bxOK = [bx, main.cx - sgn * (main.hw * 0.84 - bw)]
        .find((x) => clearsFace(x - bw, x + bw, bz0, bz1));
      // ⚠ No free corner, or no mark to carry, means no blade.
      if (bxOK != null && bPicto) push({ kind: 'bladePanel',
        cx: A(bxOK), cy: A(fy),
        z0: A(bz0), z1: A(bz1),
        half: A(bw), out: A(bw * 0.95), color: accent, pal,
        picto: bPicto });
    }
    // ── THE TRADE, IN CHINESE, DOWN A BLADE OF ITS OWN ──────────────────
    // ⚠ Its own fitting, never part of `sign`: arms that draw their own name are exactly the
    // frontages it belongs on. It takes the corner opposite the name blade, is shorter and starts a
    // floor up. The gate is `hanziOK` from section 1.
    // `tradeHung`: whether the trade got said here, so the roundel doesn't repeat it.
    let tradeHung = false;
    if (hanziOK) {
      const bw = hzBw;
      const side = -bladeSgn;
      // ⚠ Starts above the shopfront band and at least one storey (0.17) up, clear of porches.
      const z0 = Math.max(signTop + 0.02, main.z0 + Math.max(GF + 0.05, 0.17));
      const z1 = Math.min(z0 + bw * 5.4, main.z1 - wallH * 0.06);
      // ⚠ Reserved and still checked against authored windows, as the name blade is.
      const hx = [main.cx + side * (main.hw * 0.84 - bw), main.cx - side * (main.hw * 0.84 - bw)]
        .find((x) => clearsFace(x - bw, x + bw, z0, z1));
      // ⚠ Never an early `return` here: the gable ad and roundel follow.
      tradeHung = hx != null;
      if (hx != null) push({ kind: 'bladePanel', label: hz, font: 'hanzi',
        cx: A(hx), cy: A(fy),
        z0: A(z0), z1: A(z1),
        // The hot ink, not `accentOf` (cold blue on the block set).
        // ⚠ It projects past the awning and porches (0.075 to 0.14), as `BLADE_PROUD` does.
        half: A(bw), out: A(clamp(bw * 2.8, 0.075, 0.14)), color: m.neon || PICTO_HANZI_INK, pal });
    }
    // ── THE TRADE AS A MARK, ON A ROUNDEL ──────────────────────────────────────────────────
    // A mark isn't a name, so like the Chinese blade it isn't gated on `sign`. The disc is painted
    // into the texture (`badge`, see `signBoard`).
    // ⚠ `!tradeHung` is the blade's result, not its gate: a declined blade falls back to this.
    if (roundelOK && !tradeHung) {
      const rz = Math.max(signTop + 0.03, main.z0 + Math.max(GF + 0.06, 0.19)) + rdR;
      const rx = [main.cx + -bladeSgn * (main.hw * 0.84 - rdR), main.cx + bladeSgn * (main.hw * 0.84 - rdR)]
        .find((x) => clearsFace(x - rdR, x + rdR, rz - rdR, rz + rdR));
      if (rx != null && rz + rdR < main.z1 - wallH * 0.05) {
        push({ kind: 'signBoard', badge: true, picto: tradePicto,
          cx: A(rx), cy: A(fy), z: A(rz), half: A(rdR), hh: A(rdR),
          // The name board's colour pair.
          color: '#151119', ink: accent, pal });
      }
    }
    // ── A GABLE-END AD PANEL ──
    // A nearly flush backlit panel on a blank flank. ⚠ It takes the flank the service kit didn't
    // (`svcSide`), and declines on a lopsided mass as 1d does.
    if (style !== 'works' && !NO_AD_TRADE.has(tradeOf(m)) && fxPos > 0.02 && fxNeg < -0.02 && wallH > 0.34 && main.fd > 0.1 && R(313) > gateFor(0.52)) {
      const adX = svcSide > 0 ? fxNeg : fxPos;
      const ph = clamp(wallH * 0.16, 0.04, 0.11);
      // ⚠ `$name` is safe here (a wide board, `horiz`), unlike on the blade; the mark sits beside it.
      // ⚠ Checked with `paintFree`, never `clearsFace` (front plane only). It declines about half.
      const adZ1 = main.z1 - wallH * 0.26, adZ0 = adZ1 - 2 * ph, adHW = main.fd * 0.62;
      // ⚠ The name is gated on `signsItself`; the panel isn't, since an unsigned works still rents
      // its flank (NO_AD_TRADE is for walls nobody rents).
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
  // A plinth at the pavement and a course under the cornice, both `parapet`.
  // ⚠ Square boxes only: `parapet` takes one half-width for all four sides.
  // ⚠ Only the course asks `wants('cope')`; nobody hand-draws a base course.
  // ── 6. THE NEON TUBE ────────────────────────────────────────────────
  // Rationed by `gateFor`; an authored `m.neon` always gets one and wins the colour.
  // ⚠ It runs at the foot of the frontage, below `GF`: the fascia above is taken by the board and
  // blades. It's also the neon `glWet` reflects.
  const wantsTube = m.neon ? true : R(403) > gateFor(0.42);
  if (wantsTube && !period && wants('neon') && style !== 'works' && base.hw > 0.1 && bh > 0.08) {
    push({ kind: 'neonRun', cx: A(base.cx), cy: A(by), z: A(base.z0 + Math.min(GF * 0.2, 0.02)),
      half: A(base.hw * 0.92), drop: A(0), color: accentOf(m), pal });
  }
  if (rich) {
    const sq = (e) => Math.abs(e.hw - e.fd) <= 0.02;
    // A low threshold (0.05): the base is often a podium lip, and the band height is clamped anyway.
    if (sq(base) && bh > 0.05 && base.hw > 0.1) {
      push({ kind: 'parapet', cx: A(base.cx), cy: A(base.cy), z: A(base.z0),
        half: A(base.hw * 1.04), hh: A(clamp(bh * 0.09, 0.012, 0.032)), pal });
    }
    // A storey below the coping, or the two bands merge. ⚠ Read `courseZ`/`courseHH`, never re-derive.
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
// On the mesh, every wall whose palette paints a window grid gets real bays instead, and is
// recorded in `glazed` so `captureModelMesh` bakes it bare: the two never share a wall. Palettes
// that paint no grid are left blind on purpose.
// ⚠ Runs last, so bays step round everything in `blocks`; a blocked bay is dropped, never moved.
// ⚠ Its own ceiling, outside `spent`. A bay inside other mass is skipped.
// ⚠ A front face is glazed only above `signTop`; the shopfront band is the ground section's.
// ⚠ A wall over its share thins columns and keeps every floor.
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
    // ⚠ A wall on the wrong side of the origin would face in (1d's guard), so it's declined.
    if (xP > 0.02) faces.push({ e, x: true, out: 1, plane: xP, c: e.cy, half: e.fd, wallH });
    if (xN < -0.02) faces.push({ e, x: true, out: -1, plane: xN, c: e.cy, half: e.fd, wallH });
    if (yB < -0.02) faces.push({ e, x: false, out: -1, plane: yB, c: e.cx, half: e.hw, wallH });
    if (e !== main && yF > 0.02) faces.push({ e, x: false, out: 1, plane: yF, c: e.cx, half: e.hw, wallH, front: true });
  }
  // The broadest walls first, so the ceiling runs out on the small ones.
  faces.sort((a, b) => b.half * b.wallH - a.half * a.wallH);
  // ⚠ A flank carrying a gable ad stays blind. Matched tightly to `adX`, so a podium flank keeps its windows.
  const R3 = (q) => (Array.isArray(q) ? q[2] : (q || 0));
  const gable = list.filter((d) => d.kind === 'bladePanel' && d.face === 'x').map((d) => R3(d.cy));
  const blind = (f) => f.x && gable.some((p) => Math.abs(p - f.plane) < 0.01);
  let n = 0, k = 600, any = false;
  const bandOnly = [];
  for (const f of faces) {
    const { e, wallH } = f;
    // No bays (but baked bare) for a band too short for a window, a front wall wholly in the
    // shopfront band, a blind gable, or once the ceiling has run out.
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
    // A wall every bay was refused on bakes bare too, to match its glazed neighbours.
    if (put) { any = true; glazed.push(glazeRec(f)); } else bandOnly.push(f);
  }
  if (any || glazed.length) for (const f of bandOnly) glazed.push(glazeRec(f));
}
// A glazed wall, in the model's own frame: `n` the outward normal, `plane` where the wall is along
// it, a0..a1 its run along the wall in plain x (front and back) or plain y (a flank).
const glazeRec = (f) => ({ n: f.x ? [f.out, 0] : [0, f.out], plane: f.plane, a0: f.c - f.half, a1: f.c + f.half, z0: f.e.z0, z1: f.e.z1 });
