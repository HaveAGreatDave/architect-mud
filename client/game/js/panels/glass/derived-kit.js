// The derived kit: the trim a building gets without anybody drawing it.
//
// derivedTrim takes a model's captured mass and has derivedKit hang windows, signs, ledges, decline
// and the rest on it, clear of what the author already bolted to the wall (faceClaim). detailLayer
// and facadeLights in windshield.js draw the result. Moved out of windshield.js on 2026-10-01.
import {
  ARM_DETAIL, BAY, DERIVED_MAX, HANZI_BIOMES, MESH_SINK, MODERN_NEUTRAL, PICTO_HANZI_INK,
  RENDER_TUNE, SECTION_MIN, SECTION_OF, SIGN_TRADE, SIGN_WORD, SUB_MAX_ASP, TUNE, WALL_PLANE_TOL,
  _derived, _place, accentOf, armSignsItself, clamp, dRand, derivedStyle, hanziFor, hexRgb,
  placeModern, segFit, shapeForModel, spansLess, stackBox, standOnMass, tagBandFor, tagHandFor,
  tradeOf, trimPalFor,
} from '../windshield.js';
import { FLOOR_Z } from '../../../../shared/skyline-scale.js';
import { shadeOf } from './authored-detail.js';

// ── WHAT IS ALREADY BOLTED TO THIS WALL ─────────────────────────────────────────────────────────
//
// ⚠ THE KIT HUNG ITS SIGNS WITH NO IDEA WHAT WAS ON THE FRONTAGE, AND THE ARITHMETIC ALWAYS SAID
// SO. A corner blade goes at `main.hw * 0.84 - bw` and the glazing band reaches `main.hw * 0.76`,
// so on any building wide enough for the blade to clamp at its own ceiling the two overlap by more
// than half the blade's width — every time, on every building, in both renderers. Measured on Cash
// & Carrion, whose upper windows are AUTHORED at ±0.2915 while the Chinese trade blade lands at
// ±0.2914: the sign covers two whole window bays. That is the "signage overlaps windows" report,
// and no roll produces it — it is a fixed collision that has been there since the blade was added.
//
// `signfit` could not see it either: that gate compares a sign decal against STROKES, because the
// crossings it was written for are masts and catenary. A window is quads.
//
// So the kit is given the rectangles that are already spoken for, on the wall it is about to hang
// something on. Two sources, one list: what the AUTHOR drew (`m.detail`, resolved here) and what
// the kit has pushed so far (recorded by `push`, below) — because the glazing the blade collides
// with is usually the kit's own.
//
// ⚠ A CLAIM IS A RECTANGLE OF WALL, NOT EVERYTHING ON IT. A canopy, a tube and a downpipe are
// crossed by signage constantly in a real city and the blade is deliberately hung clear of the
// first two already (see the ⚠ on the Chinese blade's `z0`). What a sign must not be drawn over is
// something you are meant to SEE THROUGH or READ — glazing, louvres, a shutter, another sign.
const FACE_CLAIM = new Set(['windowBay', 'louvreBank', 'shutter', 'signBoard', 'bladePanel', 'neonArt']);
// A part's footprint on the face it is on, or null if it does not claim one. `V` resolves the
// affine triples; `z0`/`z1` for a blade, `z ± hh` for everything else.
// ⚠ A `windowBay`'s SURROUND IS WIDER THAN ITS GLASS. `windowBay` adds `min(half, hh) * 0.26` of
// frame on every side and that plate is part of the window — a blade landing on the jamb of one is
// the same picture as a blade landing on the pane.
// ── WHAT WOULD BE STANDING IN FRONT OF PAINT ────────────────────────────────────────────────
//
// `faceClaim` below answers a different question and must not be widened to answer this one. It is
// "is this patch of FACADE free for a fitting", and its readers are the signage sections deciding
// where a blade or a board can hang; a vending machine is not a fitting, and a riser is not
// something a sign has to avoid. What every part below has in common is only that it is OPAQUE and
// between a wall and the street, which is the one thing paint cares about.
//
// ⚠ A PART THAT STANDS ON THE PAVEMENT COUNTS, AND THAT IS THE HALF NOTHING RECORDED. The kerb props
// go through `pushKerb`, which deliberately bypasses the claim funnel — standing a lamp outside a
// building is not a claim to have drawn its facade — so the bins the kit puts on the service end of
// a frontage were invisible to everything, including to the tag placed on that same end of that
// same wall off that same doorway offset.
//
// ⚠ AND A RANK OF PIERS RESOLVES TO ITS FINS, NOT TO ITS EXTENT. `pilaster` is one part drawing `n`
// fins at a pitch, so a rectangle round the whole rank says a back wall is full when what it has is
// four thin verticals with bays of bare brick between them. Returning the fins is what lets a piece
// be sprayed in a bay, which is where a piece on a piered wall goes.
const PAINT_WALL = new Set(['windowBay', 'louvreBank', 'shutter', 'signBoard', 'bladePanel', 'neonArt', 'canopy',
  'acUnit', 'vent', 'fireEscape', 'balcony', 'ductRun', 'pipe', 'conduit', 'cableRun', 'pilaster',
  'marqueeBand', 'awning', 'tag']);
const PAINT_KERB = new Set(['binStack', 'vendingMachine', 'streetLamp', 'bollard']);
// ⚠ RESOLVED BY THE FUNCTION THAT PLACES THEM, never re-derived by a gate — `scripts/shapes/tagfit.mjs`
// imports this. Same rule `signstand` records for its own two numbers: a gate that works out where a
// part went is a second opinion about the placement rule, and it agrees with the code including
// wherever the code is wrong.
export function paintFoot(d, V) {
  if (!d) return null;
  const kerb = PAINT_KERB.has(d.kind);
  if (!kerb && !PAINT_WALL.has(d.kind)) return null;
  const w = d.half != null ? V(d.half) : (d.w != null ? V(d.w) : (d.r != null ? V(d.r) : 0));
  if (!(w > 0)) return null;
  const cx = V(d.cx), plane = V(d.cy);
  // ⚠ `z` MEANS TWO THINGS, and `anchored.mjs` records the same split. A part BOLTED to a wall
  // centres on `z`; a part that STANDS is pushed with `z` as the pavement it rests on and rises by
  // twice its own `hh`. Reading one as the other floats every bin half a box off the ground.
  const z0 = d.z0 != null ? V(d.z0) : (kerb ? V(d.z) : V(d.z) - V(d.hh));
  const z1 = d.z1 != null ? V(d.z1) : (kerb ? V(d.z) + 2 * V(d.hh) : V(d.z) + V(d.hh));
  const at = (c, half) => ({ x: d.face === 'x', kerb, plane, x0: c - half, x1: c + half,
    z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  if (d.kind === 'pilaster' && d.n > 1) {
    const step = V(d.step), out = [];
    for (let i = 0; i < d.n; i++) out.push(at(cx + (i - (d.n - 1) / 2) * step, w));
    return out;
  }
  // A run of bollards is one part too, and its footprint is the whole run.
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
  // ── TWO LISTS PER BUILDING: ONE THE PAINTER CAN AFFORD, ONE THE MESH CAN ────────────────────
  //
  // Every ceiling in this pass was set against `framecost`, which counts CANVAS CALLS — the 2-D
  // painter spends ~7 quads on a window bay and put the budget 12.6% over tolerance on a dense cab
  // frame at six floors by three columns. None of that is true of the GPU: the mesh is uploaded
  // once per window and drawn by a depth buffer, and `__glFrame` puts the whole adornment queue at
  // 43 faces against a city block's 17,400 calls. So the renderer that ships is paying a bill the
  // renderer that ships does not owe.
  //
  // ⚠ THE SIGNAL IS `MESH_SINK`, WHICH NEEDS NO PLUMBING AND CANNOT DISAGREE WITH ITSELF.
  // `captureModelMesh` sets it (and forces `ADORN_NEAR`), and `detailLayer` already branches on it
  // twice for exactly this bargain — jambs and mullions are mesh-only, and the screen-size gate is
  // skipped under it. Reading `RENDER_TUNE.gl` here instead would be wrong twice over: the 2-D
  // painter still runs in a GLASS 2 frame (its output is thrown away by `FLAT_OFF`), and a per-view
  // flag cannot be read from a cache shared by every seat — see the ⚠ on `derivedKit`.
  //
  // ⚠ AND IT IS IN THE KEY, not just read at build time. Same rule the kit flag below follows: this
  // is now TWO lists per model per scale, and one cache entry serving both would hand whichever
  // renderer asked first its answer to the other one's question.
  const rich = (forceRich != null ? !!forceRich : !!MESH_SINK) && RENDER_TUNE.richKit !== 0;
  // The kit flag is in the KEY, not just read at build time: it is an A/B switch for a change that
  // reaches most of the city, and a cache that outlives the flag makes the switch look broken.
  // ⚠ THE PLACE IS IN THE KEY — see the ⚠ on `_place`. It is quantised to a twentieth, because it is
  // read as a probability and nothing in the kit can tell 0.611 from 0.613, while a continuous term
  // would mint a cache entry per tile for a model that is otherwise identical across a whole street.
  const mod = placeModern(_place);
  const k = fh + ':' + h + ':' + seed + ':' + (RENDER_TUNE.derivedKit ? 1 : 0) + ':' + (rich ? 1 : 0)
    + ':' + Math.round(mod * 20) + ':' + (_place && HANZI_BIOMES.has(_place.biome) ? 1 : 0);
  let list = byScale.get(k);
  if (list) return list;
  // What somebody has already drawn for this building, and which sections that covers.
  // (`noKit`: the arm's parts were placed against a mass this model leaves out — see the terminal.)
  const base = m.noKit ? null : (m.detail && m.detail.length) ? m.detail : (ARM_DETAIL[m.type] || null);
  const have = new Set();
  // ⚠ COUNTED BEFORE IT IS CLAIMED — see SECTION_MIN. A kind with no entry there needs one part,
  // which is what every kind did before the table existed.
  if (base) {
    const tally = new Map();
    for (const d of base) {
      const k = d.kind === 'windowBay' && d.door ? 'door' : d.kind;   // see SECTION_OF.door
      if (SECTION_OF[k]) tally.set(k, (tally.get(k) || 0) + 1);
    }
    for (const [kind, n] of tally) if (n >= (SECTION_MIN[kind] || 1)) have.add(SECTION_OF[kind]);
  }
  // ⚠ THE `sign` SECTION IS THE ONE THAT CANNOT BE READ OFF A LIST. 66 of the 173 arms already sign
  // themselves with a blade, a band or lettering painted onto a frieze, and every one of those calls
  // is inside the arm's own code where there is nothing declarative to inspect. `armSignsItself`
  // rides the shape capture to answer it — see the ⚠ on SIGN_SEEN.
  if (armSignsItself(m, seed)) have.add('sign');
  // ⚠ AND A BUILDING MAY DECLINE A SECTION OUTRIGHT — see KIT_DECLINE. Same mechanism as owning
  // one: the kit stays out, and nothing else in this function needs to know why.
  // ⚠ KEYED ON `tradeOf`, NEVER ON `m.type`, AND THAT IS A FIX RATHER THAN A PREFERENCE. An
  // authored model's `type` is the literal string `authored`, so `KIT_DECLINE[m.type]` matched
  // NOTHING for any of them — the exact miss `validateModel`'s own ⚠ records for the signage
  // tables, one function later and not fixed with them. Measured over 40 seeds: the `clinic` arm
  // declines the rooftop hoarding 0/40 as intended, while `copaypray` and `chromeclinic` — both
  // authored models that REPLACE a clinic arm — were handed one 25/40 and 17/40. That is the
  // advertisement standing through the hospital sign that this table exists to prevent, on the two
  // buildings it was written for.
  for (const s of (KIT_DECLINE[tradeOf(m)] || [])) have.add(s);
  const kit = [];
  const segs = shapeForModel(m, seed);
  if (segs && segs.length) {
    const V = (p) => (p ? p[0] * fh + p[1] * h + p[2] : 0);
    const A = (v) => [0, 0, v];   // the derived list resolves to ABSOLUTE numbers — see the ⚠ above
    // ⚠ TWO CANDIDATE LISTS, BECAUSE A COPING BAND AND A WINDOW WANT DIFFERENT THINGS. Coping sits
    // ON a roof and is drawn as a SQUARE ring off `half`, so it needs a box with a real roof face
    // and a near-square footprint. A window, a shutter, a stair or a sign goes on a WALL and needs
    // neither — and requiring both shut out every shed in the city.
    //
    // A box under a barrel roof carries `roof: false`, because the barrel is its lid. That is the
    // whole industrial set: type:warehouse, type:truck_depot, type:hangar, type:diner, both named
    // hangars and The Glasshouse had **no usable candidate at all** and so got nothing — no
    // louvres, no roller shutter, no duct, no name board. Crate Expectations rendering as a
    // featureless dark shed in the game is exactly this, and it is the works kit missing the
    // buildings it was written for.
    // ⚠ AND A THIRD LIST, WHICH IS EVERY BOX RATHER THAN EVERY USABLE ONE. `cand` answers "what can
    // a part be MOUNTED on", so it drops anything under 0.03 — right for a wall and wrong for the
    // one question that is about what is IN THE WAY (see `massAhead`). Two-Cell Supply hangs six
    // crates 0.048 of a tile wide across its frontage, standing proud of the wall its name is
    // painted on: too thin to be a wall, and between them they hid 62% of the lettering.
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

    // ── ⚠ AND THE DRUMS, WHICH THE LOOP ABOVE HAS ALWAYS THROWN AWAY ────────────────────────────
    //
    // `if (sg.kind !== 'box')` is correct for every part in the vocabulary that bolts to a flat
    // wall, and it has meant that a building made of cylinders gets NOTHING from this pass: no
    // plinth, no crown course, no rank, no board. Five of the ten models in the registry with no
    // trim at all are drum-mass towers, and a smooth untrimmed cylinder is the thing that reads as
    // clay — there is nothing on it to judge its size against.
    //
    // ⚠ A COLLAR GOES ON THE SHAFT, NOT ON EVERY DRUM. A mast, a finial, a canopy disc and a
    // handrail are all drums too, and a band round a 0.03-tile mast is a bead on a stick. The test
    // is that the drum is TALLER THAN IT IS WIDE and a real fraction of the building — which is
    // what "shaft" means and is the same shape of test `cand`'s own `hw > 0.03` makes for a wall.
    //
    // ⚠ AND IT IS THE RADIUS AT THAT HEIGHT, NEVER THE BASE RADIUS. Most of these shafts taper, so
    // a band sized off `rb` floats clear of the wall at the top of the building — the same error
    // `chrome_tower`'s arm avoids by hand-interpolating `r` at every collar it places.
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
      // ⚠ THE BAND COUNT COMES OFF THE STOREY AND NOT OFF A LITERAL. A collar every fifth floor is
      // what a real shaft does at its plant levels, and tying it to the storey keeps the rhythm
      // right on a four-floor drum and a thirty-floor one from one expression.
      const storey = FLOOR_Z * (RENDER_TUNE.bldgH || 1) * (RENDER_TUNE.bldgStretch || 1);
      const floors = Math.max(1, Math.round(span / Math.max(1e-4, storey)));
      const every = Math.max(4, Math.round(floors / 5));
      // ⚠ AND THE RATION IS THE POINT, NOT AN AFTERTHOUGHT. A collar is `n` facets × 2 quads and
      // these land on every shaft in the CITY, not just this quarter — first cut at the drum's own
      // facet count with five bands a shaft grew the registry mesh 11.5%, against `glCourse`'s 4.8%
      // for a change that reached far more buildings. Three bands at twelve
      // facets reads identically at any range a collar is legible from and costs a third of it.
      const bands = clamp(Math.floor(floors / every), 1, 3);
      const cn = Math.min(s.n, 12);
      if (!have.has('collar')) {
        for (let i = 1; i <= bands; i++) {
          const z = s.z0 + span * (i / (bands + 1));
          kit.push({ kind: 'collar', cx: [0, 0, s.cx], cy: [0, 0, s.cy], z: [0, 0, z],
            r: [0, 0, rAt(z) * 1.045], hh: [0, 0, Math.min(span * 0.05, rAt(z) * 0.09)], n: cn, pal: A.trim });
        }
        // …and one at the head of the shaft, which is the crown course a box gets from `cope` and a
        // cylinder has never had. A drum that simply stops is the other half of the lid problem.
        kit.push({ kind: 'collar', cx: [0, 0, s.cx], cy: [0, 0, s.cy], z: [0, 0, s.z1 - span * 0.035],
          r: [0, 0, s.rt * 1.07], hh: [0, 0, Math.min(span * 0.045, s.rt * 0.13)], n: cn, pal: A.trim });
      }
      // ⚠ RICH LIST ONLY, for `pilaster`'s reason: a rank is n parts' worth of quads on every
      // elevation of a round tower, and the 2-D painter pays for all of them at every distance.
      if (rich && !have.has('drumfin') && span > rAt(s.z0) * 3) {
        kit.push({ kind: 'drumfin', cx: [0, 0, s.cx], cy: [0, 0, s.cy],
          z0: [0, 0, s.z0 + span * 0.04], z1: [0, 0, s.z1 - span * 0.06],
          r: [0, 0, rAt((s.z0 + s.z1) / 2)], n: Math.min(s.n, 10),
          out: [0, 0, rAt(s.z0) * 0.05], hw: [0, 0, rAt(s.z0) * 0.030], pal: A.trim });
      }
    }

    // ── ⚠ AND A SQUAT DRUM GETS ITS CORNICE (RENDER_TUNE.drumTier) ─────────────────────────────
    //
    // The shaft rule above wants height over three radii, which is right for the fins and the
    // collars up a tower and leaves every ROTUNDA with nothing: the Exchange's drum, Rising Sums'
    // stepped tiers and the glass prism's core all came out with no trim at all. A classical round
    // building has one thing a box has too, a cornice where the wall stops, so a drum that is a real
    // storey (not a disc, not a bead, not a cone) takes that one collar and nothing more.
    // ⚠ NOT A SHAFT ALREADY DRESSED, and never a cone: a band round a spire is a ring on a point.
    // Two per building at ten facets: measured at +3.0% of the registry mesh with three at twelve.
    if (RENDER_TUNE.drumTier > 0 && !have.has('collar')) {
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
          // ⚠ A PARAPET IS A WALL YOU CAN STAND BEHIND, AND THIS WAS A KERB. At 0.045 of the box it
          // came to about a fifth of a storey — ankle height on a real building — which from the air
          // reads as a chamfer on the lid rather than as an edge the deck sits INSIDE. That inner
          // face is most of what makes a flat roof read as a place instead of a surface, and it is
          // the cheapest silhouette in the kit: the quads are already drawn, they are just short.
          // About a third of a storey now, in the 0.17 this file works in.
          hh: [0, 0, clamp((z1 - z0) * 0.07, 0.016, 0.072)],
          pal: sg.pal || m.pal,
          // ⚠ ONLY THE ROOF-EDGE RING BLEEDS, which is why the flag is set here and not in the kit.
          // `derivedKit` pushes `parapet` twice more — a plinth at the pavement and a crown course a
          // storey down — and neither sheds water down a facade: a plinth has the pavement under it,
          // and a course has more building. Rationed at roughly half, because a street where every
          // roofline has run is a street in one weather.
          bleed: dRand(seed, 81) > 0.48 ? 1 : 0,
        });
      }
    }
    // ⚠ THE MASTS THE ARM ALREADY RAISED, RESOLVED — see the ⚠ on the roof armature. `mast()`
    // records itself into the shape capture as `kind: 'spar'` and `splitSpars` hangs those off the
    // returned array rather than putting them in it, so nothing that asks "how solid is this
    // building" has ever seen them. The kit is the first consumer that needs to: it is about to
    // stand a hoarding on the same roof.
    const spars = (segs.spars || []).map((s) => ({ cx: V(s.cx), cy: V(s.cy), z0: V(s.z0), z1: V(s.z1) }));
    // What the author already put on these walls — see faceClaim. Resolved here, where `V` is, and
    // handed over as plain numbers so the kit has one kind of thing to test against whether the
    // rectangle came from a file or from its own `push`.
    const claims = [];
    if (base) for (const d of base) { const c = faceClaim(d, V); if (c) claims.push(c); }
    // …and what the author already put IN FRONT of these walls — see paintFoot. Seeded the same way
    // and for the same reason: a building whose arm draws its own shutter and its own fire escape
    // has to be able to say so, or the kit paints on both.
    const blocks = [];
    if (base) for (const d of base) { const f = paintFoot(d, V); if (f) for (const r of f) blocks.push(r); }
    if (cand.length) derivedKit(kit, cand, deck, m, seed, A, have, rich, spars, mod, _place, claims, blocks, mass);
  }
  // ⚠ THE BASE IS CONCATENATED, NEVER MUTATED. `ARM_DETAIL`'s lists are module constants shared by
  // every tile of that type and `m.detail` is the baked model record — pushing onto either would
  // grow the authored list by a kitful on every cache miss, for ever.
  // ⚠ NORMALISED BEFORE IT IS CACHED — see standOnMass. Roof plant that an arm placed against
  // mass the arm no longer has is put back on the surface under it, once per model per scale.
  list = standOnMass(base ? base.concat(kit) : kit, segs,
    (p) => (Array.isArray(p) ? p[0] * fh + p[1] * h + p[2] : (p || 0)));
  byScale.set(k, list);
  return list;
}

// The kit itself. Three jobs, in the order they read from a street: what the walls do, what stands
// on the roof, and what the ground floor is.
//
// ⚠ EVERY PART IS BUDGETED, because this multiplies across the whole city. The 2-D painter only
// runs the detail layer inside `RENDER_TUNE.detailNear`, so its cost is bounded by how many
// buildings are near you — but the GLASS 2 MESH IS NOT GATED, and a mesh is built for every tile in
// the window. `KIT_MAX` is the ceiling per building, and the pass spends it on the biggest surfaces
// first rather than scattering it evenly.
// ⚠ AND THE MESH GETS THE SECOND COLUMN — see the ⚠ on `rich` in `derivedTrim`. These four numbers
// were every one of them chosen against `framecost`, which counts canvas calls, and the GPU does not
// pay in canvas calls. The lean column is untouched, so the CPU fallback is exactly the renderer it
// was; the rich column is what GLASS 2 builds a mesh from.
//
// ⚠ THE CURRENCY IS MESH FACES, NOT PARTS, and a part count is genuinely the wrong unit: a
// `windowBay` is 6-7 quads and a `ductRun` can be 32. So the ceilings are walked up against the
// registry total that `gl:mesh` prints and now holds to a committed budget, not against a feeling
// about how many things a building should have on it.
//
// ⚠ THE COST OF RAISING THESE IS NOT IN THE FRAME, IT IS IN THE FIRST CAPTURE. `tileMesh` memoises
// per model per scale, so the frame only ever pays for extra vertices in a buffer uploaded once —
// but `bakeFaceAO` runs 9 directions × 2 reaches per vertex over every face in the same memo, and
// in the game the first capture of a model is the one that ships, cold, the moment that building
// comes into view. Measured over the whole registry, lean column against rich:
//
//   28,717 → 35,478 faces (+23.5%) · capture 282 → 360 ms · AO bake 231 → 321 ms (both totals)
//   models over 8 ms on a cold capture: 7 → 14 · over 16 ms: 2 → 2
//
// The two that cost a dropped frame — The Meridian Lobby at 57 ms and Halcyon Towers at 40 — were
// both over that line BEFORE any of this, so the rich kit did not create the worst case; it made
// the middle of the distribution twice as likely to be felt. Re-run the numbers before raising
// these again rather than assuming the headroom below is still there.
//
// ⚠ EACH OF THE FIVE WAS SWEPT AND THREE OF THEM SATURATE, WHICH IS WHY THEY ARE THESE VALUES:
//   FLOOR_MAX_RICH — 10 and 12 give FEWER faces than 8, because `cols` is `winMax / floors` and a
//     taller grid trades its columns away. 8 is the top of the curve, not a cautious number.
//   KIT_MAX_RICH  — 30 → 33,982, 44 → 35,478, 60 → 35,534. Sixty buys fifty-six faces.
//   WIN_MAX_RICH  — 40 is deliberately not binding; `FLOOR_MAX_RICH × COL_MAX_RICH` is the real cap.
//   COL_PITCH_RICH — the one that actually moves: 0.13 → 0.085 is +3,600 faces. `main.hw` is clamped
//     to 0.44, so at the lean pitch `round(hw / 0.13)` can never exceed 3 and `COL_MAX` above 3 is
//     unreachable — which is why raising the cap alone did nothing and the pitch had to come with it.
// ⚠ RAISED 52 → 56 TO PAY FOR THE ROOF, AND THE WINDOW SHARE DELIBERATELY DID NOT FOLLOW IT.
// The roof section grew by about three parts a building — a stair head and a rank of condensers
// instead of one lone box — and at 52 that came straight out of the sections pushed AFTER it:
// `gl:mesh` failed nine models with "the rich kit LOST sign", which is a building losing the board
// carrying its own name, the exact bad trade the window sub-budget's own ⚠ two screens down was
// written about. Measured over six seeds the mesh total moved 1.4%, well inside the committed
// budget, because the parts bought are the smallest ones in the vocabulary.
const KIT_MAX = 26, KIT_MAX_RICH = 56;
// ⚠ AND IT IS A NUMBER RATHER THAN A SHARE OF THE CEILING, WHICH IS THE WHOLE POINT OF RAISING IT.
// This was `round(kitMax * 0.45)`, so every future rise in the ceiling hands the window grid 45% of
// it automatically — and the ceiling was raised here to buy SILHOUETTE, which is the thing that
// sub-budget's own note says windows are the wrong place to spend on ("the wall texture is already
// drawing a window grid at that range"). 23 is what `round(52 * 0.45)` came to, so the facade of
// every building in the city is bit-for-bit the one that shipped.
const WIN_SHARE_RICH = 23;
const WIN_MAX = 9, WIN_MAX_RICH = 40;   // windows per facade — see the ⚠ on the grid below
const FLOOR_MAX = 6, FLOOR_MAX_RICH = 8;
const COL_MAX = 3, COL_MAX_RICH = 5;
const COL_PITCH_RICH = 0.085;
// ⚠ THE THREE WALL ARMS ARE EXCLUDED, AND IT IS THE SAME CORRECTNESS RULE THEIR OWN ARMS OPEN WITH.
// A wall is the SAME TILE seventy times in a row, and every one of those tiles derives its own
// entrance facing from a door that is not there — so anything this kit places on a "front" face
// points a different way on each tile and the run reads as noise rather than as a wall. Every arm
// in the switch above obeys that by using centred mass and symmetric (±) pairs only; this pass
// deliberately does the opposite, because an ordinary building wants a riser on ONE flank and a
// door in ONE place. The two cannot both be right, so a wall gets the coping band and nothing else.
// ⚠ THE JETTY IS HERE FOR THE REASON THE WALLS ARE. The kit reads unyawed boxes and hangs a
// facade on them, and a deck slab, a kerb and a yard are all unyawed boxes — so without this a
// pier section gets window bays, a coping band and a roller shutter. The beacon is here on a
// stronger version of the same argument: the whole of it is that nobody here built it, and the
// kit's entire job is to make a building look like the street it is on.
// ⚠ THE JETTY IS HERE FOR THE REASON THE WALLS ARE. The kit reads unyawed boxes and hangs a facade
// on them, and a deck slab, a kerb, a yard and a quay are all unyawed boxes — so without this a
// pier section gets window bays, a coping band and a roller shutter. The beacon is here on a
// stronger version of the same argument: the whole of it is that nobody here built it, and the
// kit's entire job is to make a building look like the street it stands on.
const NO_KIT = new Set(['trm_wall', 'thornwall', 'damwall', 'pier', 'harbour_yard', 'lighthouse', 'quay_crane', 'pontoon', 'fuel_dock']);
// What somebody had in the can. Saturated and light, because a tag is read against a wall that is
// almost always the dark half of the frame — a dark tag on dark concrete is the `shadeOf(pal, 0.34)`
// mistake the bracket colour already records, in a different costume.
export const TAG_COLS = ['#b8f03a', '#ff4a9a', '#5fd0ff', '#ffcf3e', '#ff6a4a', '#c88cff'];
// ── …AND A BUILDING MAY REFUSE ONE SECTION WITHOUT REFUSING THE KIT ─────────
//
// `have` already keeps the kit out of a section somebody has drawn. This is the other half of that
// sentence: a section nobody has drawn and nobody should. The only test is whether the part would
// be wrong on that building whoever built it, which is a short list and meant to stay one — an
// arm that merely has taste about its own facade should draw the facade.
//
// `meridian` — a 1930s deco apartment landmark whose crown is a stone lantern under a verdigris
// copper cupola, and whose name is already cut into a limestone frieze over the entrance. A backlit
// hoarding on legs over that is an advertisement on a listed building. The rest of the kit stays:
// it is the ROOF this building has an answer for, not the walls.
// ⚠ A CLINIC DECLINES THE ROOF HOARDING BECAUSE ITS ROOF IS ALREADY TAKEN. The emblem is the
// sign on these — a lit cross the height of the parapet again — and the kit cannot see it to
// avoid it: `clears` steers the board round a MAST, which is the only rooftop thing that records
// itself into the shape capture, and `roofCross` is `emitFlat`, which deliberately does not.
// Measured by `signfit`: six (sign, heading) pairs across the two arms, which reads as somebody
// having stood an advertisement through the hospital sign. The rest of their kit stays.
// ⚠ AND THE EMBASSY, FOR THE MERIDIAN'S REASON AND ONE MORE. Both versions of that building — the
// brick arm and the deco model standing in for it — cut their name into the parapet and carry no
// neon and no blade at all, which is the whole of a grand hotel's signage. The extra reason is
// where the kit was putting the board: this building's tallest deck is a corner TURRET CORNICE, so
// the hoarding stood on the turret, under its own dome, and `anchored` reported it buried in the
// mass at z 1.22. A hotel that advertises through its own roof is not the building either of these
// is. The rest of the kit stays.
// ⚠ AND SECOND HELPINGS, WHICH WAS SAYING ITS OWN NAME TWICE. The kit hands it a lit board on legs
// at the parapet, labelled `$name`, and the arm already sets the same words across the fascia a
// metre below it. Nobody puts a hoarding on the roof of a single-storey shop to repeat what is
// written over the door. It was invisible for as long as the marquee was buried behind the wall —
// the roof board was the only one of the two a depth buffer let through — so fixing the marquee's
// stand-off is what surfaced it. The rest of the kit stays.
// ⚠ AND SECOND HELPINGS DECLINES ITS FACADE TOO, BECAUSE IT HAS ONE FLOOR AND THE KIT GAVE IT FOUR.
// `wall` and `stair` are derived off the tallest usable box, and here that box is a single-storey
// unit whose wall runs 0 → 0.66·h — so the kit stacked four ranks of glazing up it at z 0.102 /
// 0.267 / 0.432 / 0.597 and hung three balconies beside them. Four floors of windows with a balcony
// on each is an apartment block, drawn over a free-food dispensary whose entire frontage is one rank
// of machines open to the pavement. Nobody looks out of a window at Second Helpings, and the arm
// says as much in its own opening comment. The rest of its kit stays.
// ⚠ AND THE VAT HOUSE DECLINES THE BALCONIES, WHICH IS THE OTHER HALF OF A MISCLASSIFICATION THIS
// FILE ALREADY RECORDS. The note on UNSIGNED_TRADE below has `ty_clone` resolving to `window grid`
// and classifying as `block`, and the fix then reached SIGNAGE only — so the residential half of it
// stayed, and the clone facility wore nine balconies across the frontage it shows Ironside Street.
// A lab block with balconies is somewhere people live.
// ⚠ AND SINCE THE 2026-10 REBUILD IT DECLINES THE WINDOW GRID AND THE RISERS TOO. The grid put a
// pane exactly where the door belongs, which is how the first building every player sees came to
// have a window standing in its doorway. The arm draws its own frontage now (a door, the vats, the
// main to Second Helpings, slit windows down the flanks), and the kit's downpipes ran through it.
// ⚠ AND TINE & TEMPER DECLINES ITS WHOLE FRONTAGE, WHICH IS THE `helpings` CASE ON A SMALLER
// SCALE. The arm draws an iron canopy across its own entrance and hangs a rail of pans under it,
// and the kit hung a SECOND canopy over the top of that; `wall` then put a continuous glazed
// ribbon across the brick, which on a `ty_unit_brick` palette is a black slab three storeys wide
// with the ironmongery lost inside it. Neither is a mistake in the kit — a ribbon is right on a
// shop and a canopy is right over a door — and both are wrong on a two-storey brick workshop whose
// whole frontage is one lit window with iron hung in front of it, which is a thing only an arm can
// draw. What replaces them is authored a few hundred lines down: a warm glazed shopfront with iron
// mullions, and a clerestory under the eaves on the flanks, which is where a workshop's light
// actually comes from.
// The kit sections the six slum trades decline, as one list so they cannot drift apart. Why each
// is here is in the note under `flophouse` in KIT_DECLINE.
// ⚠ `paint` replaced a knob. `TAG_DENSE` used to
// scale the paint gates by a quarter for these six so the slum carried more throw-ups than a bank,
// and nothing else ever read it. Kit paint is a lit throw-up (`bakeTagText`), which on a slum wall
// reads as a sign, so the arms paint their own walls with `slumScrawl` instead: zigzags, and on the
// decal path anti-Architect slogans darkened with the wall at night (`slumSlogan`).
const SLUM_DECLINE = ['sign', 'signRoof', 'neon', 'ground', 'roof', 'stair', 'cope', 'wall', 'paint'];
// ── AND WHICH BUILDINGS NOBODY IS GOING TO WASH ────────────────────────────
//
// A `grime` run down a bare face, for the buildings where the weather is the only thing still
// working on them. See the push in derivedKit, and the schema entry for why the kind exists at all.
//
// ⚠ THE ENTRY BAR IS KIT_DECLINE’S, ASKED THE OTHER WAY ROUND: would this be true of the building
// whoever built it. A ruin qualifies because there is nobody left to clean it, and that is a fact
// about the building rather than about the district. Paint is something people do; this is what
// the rain does.
//
// ⚠ AND IT MUST STAY SHORT. Every wall in Coldwater is weathered by `matGrain` and its material
// already; this is a RUN down a face, which is an event on a wall rather than a property of one,
// and a city where every building has one is a city with no ruins in it.
// ⚠ THE REST OF THE SHINGLES WAS TRIED HERE AND TAKEN BACK OUT. The street-face run hangs off
// `base`, the kit's frontmost box, and on the water seller, the canteen, the bonesetter and the
// shebeen that is a canopy, a stall or a counter standing clear of any wall, so the run came down
// through open air and on into the ground as a dark wedge under the building. Their arms paint
// their own wear instead.
const GRIME_TRADE = new Set(['ruin']);
// Trades whose front is symmetric, so the riser's downpipe is hung on both flanks rather than one.
const RISER_PAIR = new Set(['meridian']);
const KIT_DECLINE = { meridian: ['signRoof', 'wall', 'pier'],   // 'wall' and 'pier': the kit's ribbon glazing and fins hid the deco skin, which has its own windows
  clinic: ['signRoof'], stitch: ['signRoof'], embassy: ['signRoof'],
  // ⚠ AN EMPTY SHOP DECLINES THE NEON, AND ONLY THE NEON. `neonRun` is architectural light — the
  // kit was running a cyan tube along the pavement at the foot of a unit with no tenant in it, which
  // is somebody paying an electricity bill on a shop they are trying to let. It is the part being
  // wrong on this building whoever built it, which is the test for an entry here. Everything else
  // the kit hangs STAYS, and the `facadeGlow` over the flats especially: the block is lived in and
  // that warm wash two storeys up is the whole reason the dead shopfront under it reads as dead.
  vacantunit: ['neon'],
  // ⚠ AND THE COUTURE HOUSE DECLINES IT TOO, which is `meridian`'s reason rather than a new one.
  // Aurelia's highest deck is the lid of a lit glass vitrine with its own name cut across the
  // band under it; a backlit hoarding on legs standing on that is a part that would be wrong on
  // this building whoever built it, which is the test for an entry here. The rest of its kit stays.
  atelier: ['signRoof'],
  // ⚠ JOLENE'S DECLINES EVERYTHING IT DOES NOT AUTHOR ITSELF, because the kit's version of each is
  // wrong on a roadhouse bolted together out of shipping containers. Its sign is the owner's likeness
  // in neon across the upper storey, so a rooftop hoarding and a kit tube along the pavement would be
  // a second and a third sign on one frontage. A fire escape has no business on a container, and
  // its one tag is authored where the wall can take it.
  honkytonk: ['signRoof', 'stair', 'neon', 'paint'],
  // ⚠ AND THE WHOLE OF HALCYON FIELDS' PLANT HALF DECLINES THE ROOF SIGN, for the water seller's
  // reason and not for a new one. The candidate loop finds the highest deck on a building and
  // stands a backlit hoarding on legs on it, and on these three that deck is the lid of a
  // telescoping gas drum, the top of a fan plate on stilts, and the crossarm of a live gantry.
  // Nobody advertises off any of them, so the part would be wrong on these buildings whoever
  // built them — which is the test for an entry here — and it showed up as a real defect as well
  // as a taste one: `glself` counted the hoarding's back board INSIDE the gasholder's own drum.
  // The three arms already say in their own comments that the plant half does not letter itself,
  // and this is what makes that true rather than merely stated. The rest of their kit stays.
  gasholder: ['signRoof'], cooling_plant: ['signRoof'], substation: ['signRoof'],
  // ⚠ THE WATER SELLER DECLINES THE ROOF SIGN, AND IT IS THE KIT BEING WRONG RATHER THAN A MATTER
  // OF TASTE. Old Coldwater's Mains Squeeze is a riveted header tank standing on a timber trestle
  // over a one-room hut, and the candidate loop finds the top of that TANK as the highest deck and
  // stands a backlit hoarding on legs on it. Nobody bolts an advertising board to the crown of a
  // two-tonne water vessel on stilts, so the part would be wrong on this building whoever built
  // it, which is the test for an entry here. It also showed up as a real defect and not only as a
  // taste one:  counted the hoarding's back board and soffit INSIDE the tank they were
  // standing on, which is the leak that made this the shortest building in the city to trip that
  // gate. ⚠ It takes the rest of the slum's list now as well; see the note under `flophouse`.
  water_seller: SLUM_DECLINE,
  // ⚠ THE STATION AND THE POUND DECLINE BOTH, and it is the kit being wrong rather than taste. The
  // candidate loop finds the highest deck and stands a backlit hoarding on legs on it: on the booth
  // that deck is a CANOPY OVER A PUBLIC WEIGHBRIDGE and on the pound it is the top of a palisade,
  // and nobody advertises off either. `wall` goes for the flophouse's reason — neither has a
  // glazing rhythm, because every opening either one has is one its own arm drew, once, on purpose:
  // a strip of glass at cab height, and a gate.
  weigh_station: ['signRoof', 'wall'], vehicle_pound: ['signRoof', 'wall'],
  // ⚠ AND THE TWO ROOMS INSIDE THE OUTER LOCK DECLINE ALL OF IT. They stand under the hall's roof,
  // which comes down to 0.75 tiles at the wall, so a hoarding on legs, a stair or a roof tank goes
  // through the chrome; and every opening either room has is its own glass band, drawn once.
  glacis_booth: SLUM_DECLINE, gate_post: SLUM_DECLINE,
  // AND THE WHOLE SLUM DECLINES THE WALL SECTION. `wall` is the derived glazing rhythm, and a doss
  // house, a free canteen, a bonesetter's front room and a shebeen do not have one: every opening
  // any of them has is one its own arm drew, in one place, on purpose. A regular grid of windows
  // is the single thing that stops a building reading as poor.
  // ⚠ IT WAS ALSO TRIED AS A FIX FOR THE PAINT AND THAT HALF IS UNPROVEN. The paint pass returns
  // hard when `bareRuns` finds nowhere clean, so bare wall is a PRECONDITION for a tag — but four
  // seeds of Bed Rock still showed none after this, and the Modelshop preview could not be made to
  // settle the question (its texture caches warm on the first render of a type, so a canvas-mint
  // count answers for the cache rather than for the building).
  // ⚠ AND SINCE THE SHANTY PASS IT DECLINES EVERY SECTION THAT ASSUMES A LANDLORD. Nothing in the
  // Shingles carries a sign with words on it (see the block comment over the arms): not a board, a
  // blade, a hoarding or a tube. `ground` is a glazed shopfront under an awning with a lit vending
  // machine at the kerb, `roof` is plant standing on what is now a tarp over a hole, `stair` is a
  // fire escape somebody inspected and `cope` is a neat band along a wall top the arms break on
  // purpose. `riser` stays: a downpipe hanging off a bracket is exactly what these walls have.
  flophouse: SLUM_DECLINE, soup_kitchen: SLUM_DECLINE, bonesetter: SLUM_DECLINE, shebeen: SLUM_DECLINE,
  ruin: SLUM_DECLINE,
  helpings: ['signRoof', 'wall', 'stair'], clone: ['stair', 'wall', 'riser'], kitchenware: ['ground', 'wall'],
  // Stuff It's canted window and painted sign ground ARE its shopfront, so the kit's glazed band
  // and awning would stand in front of the one thing the building is about.
  taxidermist: ['ground'],
  // No Regerts is one lit strip up a dark wall and Fine Print one high band of glass: each draws its
  // own windows, once, and the kit's grid round them is what made both read as an ordinary block.
  tattooist: ['wall'], lending_library: ['wall'],
  // Spirit Level is a steel shutter over the whole front with one hatch cut in it. A glazed
  // shopfront or a window grid on that wall is the one thing the building says it hasn't got.
  off_licence: ['ground', 'wall'],
  // ⚠ THE INSTITUTE AND THE LAND OFFICE ARE DRUMS WITH ONE BOX EACH, and the kit's ground floor and
  // window grid were landing on that box: a shopfront and a door hanging off the institute's frieze
  // plate 0.78 h up, and glazing drawn across the land office's hoarding, over its lettering. The
  // Codfather says it outright: "no glazing on this building anywhere".
  institute: ['ground', 'wall'], land_office: ['ground', 'wall'], fishmonger: ['ground', 'wall'],
  // ⚠ ASH MANAGEMENT AND TWO-CELL SUPPLY DRAW THEIR OWN OPENINGS, ROOFS AND LIGHT. The destructor's
  // windows, doors, ramp and roof plant are all its arm's, and the kit's office glazing on the hall
  // is what made it read as an office block. Two-Cell is a corrugated lean-to: no glazing grid, no
  // fire escape, no coping, no tube, no duct up the front, and its roof already carries the panels
  // and the wind wheel. Both keep `paint`, and the destructor keeps `riser`.
  incinerator: ['signRoof', 'wall', 'ground', 'neon', 'roof', 'stair', 'cope'],
  twocell: ['signRoof', 'wall', 'ground', 'neon', 'roof', 'stair', 'cope', 'riser'],
  // ⚠ THE SOLENNE DECLINES THE SHOP AND THE ROOF, AND ONE OF THE TWO IS A REAL BUG RATHER THAN A
  // MATTER OF TASTE. `ground` and `stair` are taste: the arm draws its own reveal, canopy, columns
  // and nameplate (§1a–1c), and a zigzag of balconies bolted across the front of a tower whose
  // whole point is that it is expensive is the kit's commercial vocabulary landing on the one
  // address it is wrong for. `roof` and `signRoof` are the bug. The candidate loop skips any box
  // with a `yaw`, and every plate of this shaft is turned — so the highest deck it can find is the
  // top of plate 0, a twenty-fourth of the way up. Measured: a water tank, a bulkhead, two
  // condensers and a backlit hoarding, all standing on a ledge of the champagne glass three metres
  // above the podium. The arm already refuses a mast for the same reason one rung higher — the
  // roof is a licensed helideck (`af_solenne`) and nothing may stand on it.
  solenne: ['ground', 'stair', 'roof', 'signRoof'],
  // ⚠ ST GARNEAU'S DECLINES EVERY SECTION THAT ASSUMES A SHOP, and it had been taking all four.
  // The kit's vocabulary is a commercial street's — a glazed shopfront with an awning over it, a
  // neon tube round the frontage, roof plant, a hoarding on the parapet — and `derivedStyle` reads
  // the PALETTE, so coursed ashlar classified this as an ordinary block and dressed it like one.
  // The arm draws its own three portals and its own base course, and the one thing that is
  // supposed to be lit on this building is the plate somebody bolted over the door, so a tube
  // round the gable is not a decoration here, it is the building's whole point undone.
  //
  // ⚠ AND IT DECLINES `wall` TOO, WHICH IT WAS KEEPING FOR A REASON THAT TURNED OUT TO BE WRONG.
  // The note here used to say `wall` was kept "for the flank piers a long masonry nave genuinely
  // needs". Those piers were never part of `wall`, and the kit no longer draws flank piers at all,
  // so declining this costs the flanks nothing. What it was actually buying
  // was the FRONT window grid, and a grid on this frontage lands a bay of glazing straight over the
  // head of each of the three portals: reported as the doors having windows on top of them, which
  // is precisely what a fanlight over a shop door is and precisely what a church door has not got.
  // The arm draws its own openings on every elevation now — three portals, a blind arcade, four
  // lancets a flank and the wheel — so there is nothing left for the grid to add.
  //
  // What it KEEPS is `cope`, `riser` and `stair` — a downpipe and a fire escape are what a
  // century of being a real building leaves on one, and they are the only things here that say
  // anybody still uses it.
  church: ['signRoof', 'neon', 'ground', 'roof', 'wall'],
  // ⚠ AND THE TWO THINGS ON THE WATER END OF FILAMENT STREET THAT ARE NOT PREMISES. A backlit
  // hoarding on legs and a deck of roof plant are both things a LANDLORD puts up, and neither of
  // these has one: Slag & Wares is a hand-cart under a sheet of corrugate that "could leave
  // tomorrow", and Camp Giardia is a tarpaulin over a bus shell. The kit had no way to know — it
  // reads the palette and the mass, and a low box under a wide flat lid is a shop — so the camp
  // was wearing a lit knife-and-fork board bigger than the camp. The `signRoof` reason is already
  // stated at `helpings`: nobody puts a hoarding on the roof of a single-storey shop to repeat
  // what is written over the door, and these two do not even have a door.
  // They KEEP the name board: the prose has SLAG & WARES chalked on the tailboard and CAMP
  // GIARDIA hand-lettered on a plank, so this is not `UNSIGNED_TRADE` — that set is for a shed
  // with a number on it, and both of these are named by hand on purpose.
  slagwares: ['signRoof', 'roof'], campgiardia: ['signRoof', 'roof'],
  // The Halcyon building sites. A site's name is printed on its hoarding, which the arm draws, and
  // the kit was standing a lit board on legs on the podium deck, where it ran through the
  // scaffold standards on Completion Date. Nobody puts neon on a building that isn't finished.
  ...Object.fromEntries(['shell_tower', 'hf_frame', 'hf_jumpform', 'hf_wrap', 'hf_scaffold', 'hf_stalled',
    'hf_hoist', 'hf_halfbuilt', 'hf_climber', 'hf_flood', 'hf_topout'].map((t) => [t, ['signRoof', 'neon']])) };
// Halcyon Fields signs in brushed metal and white light, never a neon tube. Every palette in the
// quarter starts `ty_hf`.
const quietSign = (pal) => typeof pal === 'string' && pal.startsWith('ty_hf');
// ── AND WHICH BUILDINGS DO NOT PUT THEIR NAME UP AT ALL ────────────────────
//
// ⚠ THE MATERIAL CANNOT ANSWER THIS, AND `derivedStyle` IS THE ONLY THING THAT WAS ASKED. That
// function reads the palette, and a palette says when a building went up rather than what happens
// inside it: `ty_power`, `ty_refinery` and `ty_clone` all resolve to `window grid` — the 53-model
// default — so the power station, the refinery and the clone vats each classified as `block` and
// were handed a shopfront, a lit name board over the door, a blade down the corner and a chance at
// a rooftop hoarding. Gating on `style !== 'works'` looks like it covers industry and covers the
// buildings that happen to be faced in steel.
//
// What a works actually does is identify itself with a unit number on a door and the name on the
// GATE. So the TRADE answers, because the trade is the one thing the game already knows for
// certain — `m.type` IS the arm, and the arm is the building.
//
// ⚠ IT IS THE BUILDING'S OWN SIGNAGE ONLY. The gable-end ad panel is deliberately NOT gated on
// this: a hoarding on the blank flank of a warehouse is somebody ELSE's advertisement, it is what
// the flank of a warehouse is for, and it is most of what makes an industrial district read as
// part of the same city as the neon. A works does not advertise ITSELF; it still rents its wall.
//
// ⚠ AND `signWorks` ON THE MODEL IS THE STATED EXCEPTION — the "special circumstances". A works
// that sells over a counter, or one whose name is the reason it is on the map, opts back in.
const UNSIGNED_TRADE = new Set([
  // Power and utility.
  'power', 'dynamo', 'dw_turbine', 'trm_charge', 'signalbox', 'damwall', 'interstack', 'trm_cistern',
  // Heavy industry and processing. The incinerator letters its own gate plate in its arm.
  'foundry', 'fabrication', 'ff_kiln', 'dw_forge', 'sw_foundry', 'sw_kiln', 'hulls', 'asc_vats',
  'clone', 'asc_weave', 'refinery', 'incinerator',
  // Freight, storage and yards — a shed with a number on the door.
  'warehouse', 'container_yard', 'cold_storage', 'junkyard', 'truck_depot', 'dw_depot', 'sw_depot',
  'trm_depot', 'wharf', 'hangar', 'reefer', 'fuel_yard',
  // An airfield says what it is by its shape: the only signs on it are the lit boards on the
  // terminal, ARRIVALS and DEPARTURES, which its two arms draw themselves.
  'atc', 'arrivals', 'departures',
  // The jetty. A deck has no wall to letter, a quay is plant on a slab, the yard letters itself on
  // the hut by hand in its own arm, and the beacon is not advertising anything.
  'pier', 'harbour_yard', 'lighthouse', 'quay_crane',
  // …and the marina, for both halves of the same reason. A pontoon has no wall to letter either,
  // and the Conservatory letters ITSELF: its arm stands a chrome fascia over the doors and puts a
  // marqueeBand on it, so a derived board here would be the building's own name a second time —
  // which is the one thing the naming rule forbids outright.
  'pontoon', 'boathouse', 'fuel_dock',
  // ⚠ AND THE CHURCH, WHICH IS THE ONE ENTRY HERE THAT IS NOT INDUSTRIAL. Every other name on this
  // list is a works or a yard, and the reason they are here is that a shed identifies itself with a
  // number on a door. St Garneau's is here for the opposite reason: it identifies itself with the
  // building. A parish church does not put a lit name board over its portal, and this one least of
  // all — its own arm carries a note saying it is the one frontage in Coldwater with nothing burning
  // on it except the plate somebody bolted across the middle, and a derived blade down the corner
  // was quietly making that untrue on every tile that draws it.
  'church',
  // ⚠ AND THE RUIN, WHICH IS THE ONE ENTRY HERE THAT IS NOT A BUILDING AT ALL. A `ruin` tile
  // carries a `building_name` because every tile does — A Collapsed Terrace, The Burnt House — and
  // the kit read that as a trading name and hung a lit board over the rubble, plus a blade down a
  // corner that is not there. Old Coldwater's own block comment already states the district rule
  // in so many words: not one of the six carries a lit sign, because a district where the
  // buildings advertise is a district with money in it. A heap with no door advertises nothing,
  // and there is nobody left to pay for the electricity.
  'ruin',
  // ⚠ AND THE REST OF THE SHINGLES, which is the district rule above applied to the kit rather than
  // only to the arms. The derived board over the door, the blade and the roundel were all reaching
  // these five, and "A STITCH IN TIME" stood on a lit hoarding over a one-room clinic the arm's own
  // note says has no name on it anywhere. Everyone who uses these places already knows where they
  // are. `KIT_DECLINE` shuts the `sign` section as well; this is what keeps the roundel out, which
  // does not ask that section.
  'flophouse', 'soup_kitchen', 'bonesetter', 'shebeen', 'water_seller',
]);
// Does this building letter its own frontage? The two answers the kit needs, in one place, so the
// name board, the corner blade and the roof hoarding cannot disagree about it.
const signsItself = (m, style) => !!m.signWorks || (style !== 'works' && !UNSIGNED_TRADE.has(tradeOf(m)));
// -- AND WHICH OF THEM HAVE SOMETHING DRIVE THROUGH THE FRONT ------------------------------------
//
// The works ground floor has always put a shutter on the frontage, and `bay` dresses one as a
// loading bay: a roller housing, guide channels, a bottom rail. That is right for a shed a truck
// reverses into and wrong for a bathhouse, and `derivedStyle` cannot tell them apart -- it reads
// the PALETTE, so half the Terminus and Deepwater set (a dormitory, an inn, a wash house, an
// undertaker) classifies as `works` off a plain rendered wall.
//
// ⚠ IT IS NOT UNSIGNED_TRADE, THOUGH IT LOOKS LIKE IT COULD BE. That set answers "does this
// building advertise itself", which is a question about a sign trade; this one answers "is the
// opening on the front big enough to drive into", which is a question about what happens inside.
// They overlap because heavy industry is both, and they disagree in both directions: a freight
// forwarder and a sound stage take vehicles and are not on that list, and a live substation is on
// it and has a personnel door. Folding them together would be the `derivedStyle`-reads-the-palette
// mistake again, one layer up.
//
// ⚠ A TRADE THAT IS NOT LISTED KEEPS THE PLAIN SHUTTER IT ALREADY HAD, which still reads as a
// shut roller door. Nothing is lost by being absent from this set.
const BAY_TRADE = new Set([
  // Freight, storage and yards.
  'warehouse', 'container_yard', 'cold_storage', 'junkyard', 'truck_depot', 'dw_depot', 'sw_depot',
  'trm_depot', 'wharf', 'hangar', 'reefer', 'fuel_yard', 'freight_forwarder', 'forwarder', 'bonded',
  // Heavy industry and anything with a shop floor.
  'foundry', 'fabrication', 'ff_kiln', 'dw_forge', 'sw_foundry', 'sw_kiln', 'hulls', 'refinery',
  'dw_winding', 'dw_stores', 'slagwares', 'thumbscale',
  // A sound stage is a shed with a truck door, whatever it makes.
  'studio', 'ksabstudio',
  // ⚠ `vacantunit` WAS HERE AND THE PREMISE WAS WRONG. This entry read "the four numbered units are
  // shells on a trading estate", and not one of them is: their own prose puts them in a parade, in
  // a terrace between studio blocks, at the pawn end of a street, and under three floors of flats.
  // Nothing drives into any of them. The kit was giving them a vehicle door because `derivedStyle`
  // classified `ty_unit` as `works` off a flat painted palette — the reads-the-palette mistake that
  // set's own ⚠ warns about, one layer down — and the palette move above ends it: they are `block`
  // now, so the works frontage never runs and the arm draws the shop door itself.
]);
// ⚠ AND THE SUBSET THAT WILL NOT CARRY SOMEBODY ELSE'S HOARDING EITHER. The argument above — a
// works does not advertise itself but still rents its wall — holds for a warehouse, a cold store
// and a depot, which is what a big blank flank beside a road is for. It does not hold for a live
// substation, a refinery or a vat house: those are hung with catenary, aerials and pipework, which
// is both why a hoarding has nothing clear to bolt to and why the wires cross it when it does.
// Measured: the last of the "wires over the signage" crossings were exactly these.
// ⚠ AND THE RUIN, WHICH IS HERE FOR NEITHER OF THOSE REASONS. The rest of this set is hung with
// catenary and pipework, so a hoarding has nothing clear to bolt to and the wires cross it when it
// does. A collapsed terrace is the opposite problem: the flank is perfectly clear and there is
// nobody to rent it FROM. A three-storey backlit panel is the most expensive thing the kit hangs
// on anything, and a heap of brick with no roof cannot be carrying one.
const NO_AD_TRADE = new Set(['power', 'dynamo', 'dw_turbine', 'trm_charge', 'signalbox', 'damwall',
  'interstack', 'foundry', 'fabrication', 'ff_kiln', 'dw_forge', 'sw_foundry', 'sw_kiln', 'asc_vats',
  'clone', 'refinery', 'fuel_yard', 'ruin',
  // …and the rest of the Shingles, for the ruin's reason: nobody rents a wall in Old Coldwater.
  'flophouse', 'soup_kitchen', 'bonesetter', 'shebeen', 'water_seller',
  // …and the airfield, which carries its own terminal boards and nobody else's.
  'atc', 'arrivals', 'departures']);
// ⚠ `RENDER_TUNE` AND NOT THE PER-VIEW `TUNE`, BECAUSE THE LIST IS CACHED PER MODEL. A view can
// override a tunable (`VIEW_TUNABLE`), and two views can paint in one frame — so a per-view value
// read here would be baked into a cache the other view then reads, and which view got there first
// would decide what the city looks like. The kit is a property of the building, not of the seat.
// `cand` is every usable box — what a wall part stands on. `deck` is the subset with a real, roughly
// square roof face — what a roof part stands ON. They differ for every shed in the city: a box under
// a barrel roof is a fine wall and not a floor you can put a water tank on. See the ⚠ in derivedTrim.
function derivedKit(list, cand, deck, m, seed, A, have, rich, spars = [], mod = MODERN_NEUTRAL, place = null, claims = [], blocks = [], mass = cand) {
  if (!RENDER_TUNE.derivedKit || NO_KIT.has(m.type) || m.noKit) return;
  const wants = (s) => !have.has(s);   // a section somebody already drew is theirs; stay out of it
  const pal = m.pal;
  // What the OPENINGS are dressed in, as opposed to what the wall is faced in — see trimPalFor.
  // Every glazed part below takes this rather than `pal`, because a surround shaded off the wall's
  // own key is the wall colour and reads as paint. Free: the same quads, a different colour.
  const wpal = trimPalFor(m);
  const top = cand[0].z1;
  const main = cand.slice().sort((a, b) => (b.z1 - b.z0) * b.hw - (a.z1 - a.z0) * a.hw)[0];   // the biggest wall
  const style = derivedStyle(m, main.hw, top);
  const R = (salt) => dRand(seed, salt);
  // ── HOW LIT THIS STREET IS, AND THE FEW BUILDINGS THAT REFUSE TO BE ────────────────────────
  //
  // `mod` is the district's own modernity — see `placeModern`. Every lit, signed or glazed part
  // below is rolled against `gateFor(base)` rather than against a flat number, so the SAME kit
  // produces a dense neon frontage in the west end and a dark one in the Yards with nothing
  // authored for either and no second code path.
  //
  // ⚠ IT MOVES A GATE, NEVER A SIZE. A building in a poor district gets FEWER lit parts, not smaller
  // or dimmer ones — a half-height blade and a dim tube read as a rendering fault, where a street
  // with three signs on it instead of nine reads as a different part of town. Every existing gate
  // keeps its own number as the midpoint, so `mod` at 0.5 reproduces exactly what shipped.
  const gateFor = (g) => clamp(g + (MODERN_NEUTRAL - mod) * 0.55, 0.03, 0.97);
  // ⚠ AND A FEW BUILDINGS OPT OUT ENTIRELY, WHICH IS THE OTHER HALF OF "MODERNISE MOST OF THEM".
  // A city where every frontage carries the same kit at the same density is uniform however dense
  // it is, and the thing that makes a modern street READ as modern is the one soot-black Victorian
  // warehouse still standing in the middle of it. So roughly one building in nine is PERIOD: no
  // neon, no blade, no roof hoarding, no ribbon glazing. It keeps its windows, its stair, its
  // cornice and its name board, so it is a building rather than a gap.
  // ⚠ ROLLED AGAINST THE DISTRICT, so the holdouts cluster where they would: about one in six in the
  // glass west, where a survivor is conspicuous, and almost none in the east, where the whole
  // district already reads that way and a "period" building would just be another dark shed.
  const period = R(401) > 0.80 + (1 - mod) * 0.19;
  // The four ceilings this building is built to. One line, read once, so nothing below has to
  // remember which renderer it is building for.
  const kitMax = rich ? KIT_MAX_RICH : KIT_MAX;
  const winMax = rich ? WIN_MAX_RICH : WIN_MAX;
  let spent = 0;
  // ⚠ CLAIMS ARE RECORDED AT THE ONE FUNNEL, NEVER BESIDE EACH SECTION. The glazing a corner blade
  // collides with is usually the kit's OWN, so the list the blade tests against has to contain
  // what this pass has already pushed — and a section that remembered to register its parts by
  // hand would be a section somebody could forget. Every kit part resolves through `A()`, so the
  // absolute value is the third term of its own triple.
  const KA = (p) => (Array.isArray(p) ? p[2] : (p || 0));
  // ⚠ AND A SNAPSHOT OF WHAT THE AUTHOR CLAIMED, TAKEN BEFORE THE KIT PUSHES ANYTHING. `push`
  // above appends every kit part to `claims`, which is right for a blade asking what it would
  // land on — and fatal for the window grid, which asks the same question once per bay: by the
  // second bay the list contains the first one, so the grid would refuse every window after the
  // one it just drew. The grid tests against the AUTHORED rectangles only, which cannot grow.
  const authorClaims = claims.slice();
  // Does a bay of glazing land clear of a window the author already drew on this face? Same plane
  // tolerance and same gap as `clearsFace`, against the frozen list.
  const clearOfAuthor = (fyP, x0, x1, z0, z1) => authorClaims.every((c) => c.x
    || Math.abs(c.cy - fyP) > 0.06
    || x0 > c.x1 + 0.012 || x1 < c.x0 - 0.012 || z0 > c.z1 + 0.012 || z1 < c.z0 - 0.012);
  // ── …AND WHAT IS IN FRONT OF THE PAINT, AT THE SAME FUNNEL ─────────────────────────────────
  //
  // See `paintFoot`. A second list rather than a second reading of `claims`, because the two
  // questions differ at both ends: a riser and a bin hide paint and claim no facade, while every
  // one of them is recorded here whether it went through `push` or `pushKerb` — and the kerb props
  // are the half that was invisible. Recorded at the funnels for `claims`' own stated reason: a
  // section that registered its parts by hand is a section somebody can forget.
  const mark = (p) => { const f = paintFoot(p, KA); if (f) for (const r of f) blocks.push(r); };
  const push = (p) => {
    if (spent >= kitMax) return;
    list.push(p); spent++;
    const c = faceClaim(p, KA); if (c) claims.push(c);
    mark(p);
  };
  // ⚠ THE WINDOW GRID GETS ITS OWN CEILING, BECAUSE IT IS PUSHED FIRST AND EVERYTHING ELSE IS
  // PUSHED AFTER IT. Every section shares `spent`, and the grid is section 1 — so a grid big enough
  // to reach `kitMax` silently eats the riser, the fire escape, the roof plant, the shopfront and
  // the name board, in that order, and nothing anybody measures would say so. Raising the rich
  // ceilings did exactly that: two buildings lost the board carrying their own name and gained
  // thirty-four windows, which is a bad trade in any city.
  //
  // ⚠ AND THE SHARE IS BELOW A HALF ON PURPOSE. What reads at street distance is the SILHOUETTE —
  // a balcony, a fire escape, a canopy, a tank on the roof — and the wall texture is already drawing
  // a window grid at that range (`FACADE_MAT`, 65 palettes of it). Measured: raising the grid alone
  // took the registry to 35,478 faces and moved 0.77% of a close cab frame. Geometry spent on
  // windows is geometry spent on something the texture was doing for nothing.
  let winSpent = 0;
  const winCap = rich ? Math.min(winMax, WIN_SHARE_RICH) : winMax;
  const pushWin = (p) => { if (winSpent < winCap) { winSpent++; push(p); } };
  // ── …AND THE PAVEMENT GETS A RESERVATION, WHICH IS CURRENTLY INERT ──────
  //
  // ⚠ THIS CHANGES NOTHING TODAY AND THE MEASUREMENT SAYS SO: 25.2% / 10.9% / 14.8% with it at 3
  // and the identical three numbers with it at 0, over 64 seeds. It is here as insurance, and the
  // note is here so nobody re-derives the reason from scratch.
  //
  // ⚠ IT WAS ADDED ON A MEASUREMENT THAT TURNED OUT TO BE AN ARTIFACT, which is the part worth
  // keeping. A 12-seed sweep put the vending machine at 4.6% of frontages against a roll implying
  // 10.5%, and that reads exactly like the budget eating half of them. It was not: `dRand(seed, 74)`
  // is ONE value per seed, so a sweep that gives every model in the city the same seed is sampling
  // the roll twelve times, not 2,076 — the same trap that made a first cut of `anchored.mjs` report
  // `vendingMachine` and `bollard` as emitted by nothing at all. At 64 seeds the real baseline was
  // 10.0%, and the whole gain since is the ROLLS, not this.
  //
  // It stays because the kerb props are pushed LAST — after the windows, the riser, the stair, the
  // roof plant and the whole shopfront — so they are the first things `spent` would run out on if
  // anyone raised the window grid or added a section, and this file already carries that exact ⚠
  // one budget up. They are also the only geometry in the kit a player ON FOOT is level with: a
  // window bay lost at the top of a tower costs nothing, a machine lost at head height costs the
  // street. Four, because four is how many kerb parts there are.
  const KERB_RESERVE = 4;
  const pushKerb = (p) => { if (spent < kitMax + KERB_RESERVE) { list.push(p); spent++; mark(p); } };

  // ── 1. THE WALLS ──────────────────────────────────────────────────────────
  // Windows go on the FRONT face of the biggest box, in whole storeys. A storey is ~0.17 world
  // units here, which is the figure `buildingScaleFor` already works in, so a band lands where a
  // floor is rather than where a fraction of the wall is.
  // ⚠ THE GROUND FLOOR AND THE NAME BAND ARE DERIVED HERE, BEFORE ANY SECTION USES THEM. They
  // used to be declared in section 3, where the shopfront is drawn, which was fine while the
  // shopfront was the only thing that needed to know where the name goes. They moved up for the
  // front pier rank, which had to start above the name, and they stay up here now that the rank
  // is gone: every reader takes one expression of the band, and deriving it a second time is the
  // failure the ⚠ below is about.
  const base = cand[cand.length - 1];
  const by = base.cy + base.fd, bh = base.z1 - base.z0;
  const GF = Math.min(bh * 0.62, 0.115);           // the shopfront band's height above the pavement
  // ── WHERE THE NAME GOES, DECIDED ONCE ──────────────────────────────────────────────────────
  //
  // ⚠ THE NEON TUBE WAS RUNNING STRAIGHT THROUGH THE NAME BOARD, on every building that had both.
  // Both are placed off `GF`, independently, a few thousandths of a tile apart: the board sits at
  // `GF + 0.036` and is up to 0.04 deep, so it spans `GF − 0.004 … GF + 0.076`, and the tube sat at
  // `GF + 0.055` — inside it — and ran 0.88 of the frontage against the board's 0.62, so it came out
  // of both ends of the shop's own name. The tube's own note already makes this exact argument one
  // part lower down ("it sits ABOVE the shopfront, not on it, or it is behind the awning"); it just
  // stopped one part short.
  //
  // So the band the name occupies is derived HERE, where both readers can see it, and the tube
  // clears its top. Two independent expressions of one height is how they disagreed in the first
  // place.
  const signHH = Math.min(Math.min(base.hw * 0.62, 0.19) * 0.3, 0.04);
  const signZ = base.z0 + GF + 0.036;
  const signTop = signZ + signHH;

  const fy = main.cy + main.fd;                      // the front face plane of the biggest mass
  const wallH = main.z1 - main.z0;
  // ── WHERE THE CROWN COURSE SITS ────────────────────────────────────────────────────────────
  //
  // Section 6 draws the course. It's derived up here because the front pier rank used to stop
  // under it; that rank is gone, and anything else that has to clear the course reads it here.
  const courseZ = main.z1 - Math.max(wallH * 0.16, 0.05);
  const courseHH = clamp(wallH * 0.045, 0.012, 0.03);
  const floors = clamp(Math.round(wallH / 0.17), 1, rich ? FLOOR_MAX_RICH : FLOOR_MAX);
  // ── IS THIS PATCH OF THE FRONT WALL FREE? ──────────────────────────────────────────────────
  //
  // See `faceClaim`. A rectangle on the front plane against everything already claimed there — the
  // author's parts and the kit's own. `SIGN_GAP` is the finger of wall a sign needs beside a window
  // to read as a separate fitting rather than as something resting on it.
  //
  // ⚠ THE PLANE TEST IS GENEROUS ON PURPOSE. A shopfront band and an upper-storey grid sit on boxes
  // whose front faces differ by a few thousandths, and two parts a centimetre apart in `y` are on
  // the same wall as far as anybody looking at the building is concerned.
  const SIGN_GAP = 0.012;
  const clearsFace = (x0, x1, z0, z1) => claims.every((c) => c.x || Math.abs(c.cy - fy) > 0.06
    || x0 > c.x1 + SIGN_GAP || x1 < c.x0 - SIGN_GAP || z0 > c.z1 + SIGN_GAP || z1 < c.z0 - SIGN_GAP);
  // ── …AND IS THIS PATCH OF ANY WALL BARE, AND CAN IT BE SEEN? ──────────────────────────────
  //
  // The same shape of test as `clearsFace` and deliberately not the same test — see `paintFoot`.
  // That one asks whether a FITTING can hang here and is answered for the facade only; this one asks
  // whether PAINT here would ever be looked at, on any of the four walls, and a window and a vending
  // machine are the same answer to it.
  //
  // ⚠ THE PAVEMENT IS ONLY TESTED FOR THE STREET FACE, AND THAT IS A GUARD RATHER THAN A SAVING. A
  // prop stands OFF its wall — out to a third of the base half-width — so it has to be matched on a
  // loose plane tolerance, and on a shallow building that tolerance reaches the BACK wall too, where
  // there is no pavement and nothing standing on it. 1d's rule is what makes this safe to state:
  // pavement props are derived from the entrance, and a building has one of those.
  const paintFree = (face, plane, x0, x1, z0, z1, street) => blocks.every((b) => !!b.x !== !!face
    || (b.kerb ? (!street || Math.abs(b.plane - plane) > 0.22) : Math.abs(b.plane - plane) > 0.06)
    || x0 > b.x1 || x1 < b.x0 || z0 > b.z1 || z1 < b.z0);

  // ── …AND CAN A BAND BE LIFTED OVER WHAT IS ALREADY BOLTED TO THAT WALL? ────────────────────
  //
  // `clearOfMass` asks this of the building's own MASS and its ⚠ says why lifting beats moving the
  // band forward. This is the fittings half of it, and it is a second function rather than a wider
  // reading of that one because the two lists hold different things: a fire escape, a riser and a
  // rank of piers are all in `blocks` and none of them is mass, while a painted name band derived
  // at two thirds of the wall lands in the middle of every one of them.
  //
  // ⚠ IT ONLY EVER LIFTS, AND IT HANDS BACK `z` UNCHANGED WHEN NOTHING FITS ABOVE. Declining would
  // delete a building's name, which is the trade `clearOfMass` has already measured and refused —
  // a stair bolted across painted lettering is a photograph of any goods yard in the world and no
  // name at all is not. So the worst case here is exactly what shipped before it.
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
  // ── …AND WHERE IT CANNOT BE LIFTED, WHAT IS LEFT OF THE WALL BESIDE IT ─────────────────────
  //
  // The band above fails on exactly the buildings that need it most: a two-storey unit whose fire
  // escape reaches its own parapet has no frieze to be lifted into, and Unit 3, Kessler Street is
  // one — 0.702 of stair on a 0.78 wall. What such a wall does have is the panel BESIDE the stair,
  // which on that unit is 0.338 of a tile of bare brick against the 0.15 the zigzag occupies.
  //
  // ⚠ IT IS THE SAME GAP SOLVER THE GRAFFITI SEARCH USES, ASKED FOR A DIFFERENT SIZE. `spansLess`
  // subtracts the occupied runs from the wall and hands back the bare ones; a tag then takes the
  // widest run it can and shrinks to it. A NAME may not shrink indefinitely — that is `sign:band`'s
  // whole argument — so this floors the run at two thirds of the band it was asked for and returns
  // null below it, which puts the caller back on "half read beats nameless".
  const NAME_RUN_PAD = 0.008;
  // ⚠ AND THE FLOOR IS A NUMBER RATHER THAN "WHATEVER FITS", WHICH IS THE TAG SEARCH'S OWN ⚠ ONE
  // SIZE UP: a band that keeps shrinking until it fits always fits, and an obstruction test that
  // cannot fail is not a test. Below this the name is competing with the graffiti for size and the
  // stair is the more honest picture — a fire escape across a full-width painted name is a
  // photograph of any goods yard, and a stamp in the corner of a blank wall is not.
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

  // ── …AND IS THE BUILDING ITSELF STANDING IN FRONT OF IT? ───────────────────────────────────
  //
  // ⚠ NEITHER TEST ABOVE CAN ANSWER THIS, AND WIDENING EITHER ONE WOULD BE WRONG. Both compare a
  // part's PLANE against the wall's within a few hundredths, because both are asking "is this patch
  // of wall already taken" — a question about FITTINGS. What buries a name is a box a TENTH of a
  // tile proud of the wall it is painted on, and both tests answer "clear" precisely because it is
  // nowhere near the plane. `blocks` cannot see it either: it is built from the DETAIL list, and a
  // shopfront slab is MASS.
  //
  // ⚠ AND IT IS A CONSEQUENCE OF `tileFit`, NOT OF THE ARMS. Every shopfront in this registry is
  // authored as a box shoved out to about `fh * 0.9` — before the plot-line trim existed that
  // landed a tile and a half into the street and the painter's queue sorted it clear of everything.
  // Trimmed back to the plot line, the same box is a mass standing a tenth of a tile PROUD of its
  // own facade: still a shopfront, and now also a thing a sign can hide behind. On the canvas it
  // never showed, because a sign carries `DETAIL_LIFT` and sorted in front of the building it was
  // inside. A depth buffer compares. Measured over the registry before this: 25 models have their
  // own name buried by their own mass, and on Unit 3, Kessler Street — the tile it was reported
  // from — 67% of the lettering sat behind the shopfront at every angle and every eye height.
  //
  // ⚠ THE ANSWER IS TO LIFT, NOT TO MOVE THE SIGN FORWARD. Seating it on the foremost plane is the
  // shorter fix and it paints the building's name across a roller shutter, a broken shop window or
  // a portico lintel — the ground-floor dressing is exactly what is in the way. What a real
  // building does is put the name ABOVE the shopfront, which is also where there is bare wall.
  const MASS_EPS = 0.012;
  // The top of whatever the building stands between this patch of wall and the street, or null when
  // the patch is clear. `flank` swaps into the rotated frame section 1d works in; `mid` is the
  // patch's centre ALONG the wall, in the model's own axes.
  //
  // ⚠ `out` IS AN ARGUMENT AND MUST NOT BE READ OFF THE SIGN OF `plane`, which is what a first cut
  // did. The capture frame puts the street at +y, so the front face looks outward at +1 whatever
  // its plane comes to — and an arm that offsets its whole mass BACKWARDS over its own yard (The
  // Kept, The Long Fire) has `main.cy + main.fd` NEGATIVE. Those two then searched away from the
  // street and seated their names on the back wall.
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
  // Where the band ends up: unchanged when the wall is clear — which is the whole registry bar the
  // 25 — and lifted over whatever is in front of it while it still fits under `ceiling`. Four
  // passes, because clearing one box can put the band in front of a taller one beside it.
  //
  // ⚠ IT ONLY EVER MOVES THE BAND UP ITS OWN WALL. Two richer answers were built and measured and
  // both cost more than they bought:
  //
  //   DECLINING when nothing clears DELETES A BUILDING'S NAME. Twelve models lost their front
  //   lettering, and two of them — The Kept and the church — have no flank panel either, so they
  //   lost it altogether to fix an occlusion of 94% and 22%. A name you can half read is worth
  //   more than no name.
  //
  //   SEATING IT FORWARD onto whatever is in the way paints the name across a roller shutter, a
  //   broken shop window or a portico lintel, and it OVERHANGS: `anchored` caught the wash house
  //   with 0.11 of a tile of its own name past the end of the box it had been moved onto, which is
  //   that gate's founding bug in a new costume — a band covered by a RUN of boxes at one plane is
  //   not a band covered by a WALL.
  //
  // So the worst case here is the placement that shipped, unchanged, and the change can only ever
  // improve a building or leave it exactly as it was.
  // ⚠ IT REPORTS WHETHER IT SUCCEEDED, and the two callers do different things with the answer —
  // see each. A `z` on its own cannot say whether the band is now readable or merely unmoved.
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
  //
  // ⚠ THE ORDER IS HALF THE FIX. Section 1 glazes the wall and section 4 hangs the blades, and
  // section 1 runs first — so a blade could only ever be offered a wall that was already full, and
  // `clearsFace` on its own would decline nearly every one of them. Reserving the corner first is
  // the other way round and is cheap where declining is not: a glazing band a finger narrower is
  // not a picture anybody would report, and a lit sign drawn over the top of one is.
  //
  // ⚠ THE ROLLS ARE PURE (`dRand(seed, salt)`), SO READING THEM HERE MOVES NOTHING. Same salts,
  // same values, two hundred lines earlier. What must not happen is a SECOND copy of a roll further
  // down — the drift this file already warns about at `riserX` — so section 4 reads these.
  const bladeSgn = R(311) > 0.5 ? 1 : -1;
  const hz = hanziFor(m);
  const tradePicto = (style !== 'works' && (SIGN_TRADE[tradeOf(m)] || ['', ''])[1]) || '';
  // How far the glazing may reach on each side, as a fraction of `main.hw`, once a sign of
  // half-width `w` is hung hard against that corner at 0.84. `Infinity` means nothing is reserved,
  // so an untouched building glazes exactly as wide as it always did.
  // ⚠ THE RESERVE MUST BE WIDER THAN THE TEST IS STRICT, and at exactly `SIGN_GAP` it was not.
  // `clearsFace` demands MORE than a gap of `SIGN_GAP`, so a reservation that leaves precisely one
  // declines the very corner it was keeping — measured, 416 of 598 eligible roundels refused on
  // their own reserved wall, which reads as the feature not existing. It also has to cover the
  // window SURROUND: `faceClaim` counts a bay's frame as part of the bay, and that plate is up to
  // 0.26 of the band's own half-height proud of the glass on each side.
  const SIGN_CLEAR = SIGN_GAP * 2 + 0.012;
  const reserveFor = (w) => 0.84 - (2 * w + SIGN_CLEAR) / main.hw;
  // ⚠ AND A WALL TOO NARROW TO CARRY BOTH CARRIES THE WINDOWS. On a one-tile shopfront the reserve
  // eats the whole band, and a frontage that is all sign and no glass is a worse building than one
  // with no blade on it. Below a third of the half-width the fitting is simply not offered.
  const fitsBeside = (w) => reserveFor(w) >= 0.34;
  let resL = Infinity, resR = Infinity;
  const takeCorner = (sgn, w) => {
    const r = reserveFor(w);
    if (sgn > 0) resR = Math.min(resR, r); else resL = Math.min(resL, r);
  };
  const nameBw = clamp(main.hw * 0.15, 0.02, 0.05);
  const hzBw = clamp(main.hw * 0.13, 0.018, 0.042);
  // A roundel is square, so its half-width IS its half-height — see the trade fitting in section 4.
  // Sized against the BLADE rather than against the wall: a badge and a blade say the same thing,
  // and one of them being a fifth of the facade wide would not read as the same class of fitting.
  const rdR = Math.min(main.hw * 0.15, 0.05);
  const signable = rich && !period && signsItself(m, style) && main.hw > 0.1;
  const nameBladeOK = signable && wants('sign') && wallH > 0.26 && fitsBeside(nameBw) && R(309) > gateFor(0.45);
  // ── ⚠ ONE TRADE FITTING PER FRONTAGE, NEVER TWO ────────────────────────────────────────────
  //
  // The Chinese trade blade and the mark roundel say the SAME THING — 當舖 and three balls are both
  // "this is a pawnbroker" — so a building wearing both has said it twice and spent two corners
  // doing it. They are also the two loudest small things the kit hangs, and the report this whole
  // pass answers is that there is too much signage on the frontage, not too little.
  //
  // ⚠ THE BLADE WINS WHERE IT IS ELIGIBLE, so the Chinese quarter keeps its density: a street where
  // some shops carry the word and the rest carry the mark is the one that reads, and a mark that
  // replaced the word everywhere would quietly delete a feature that was rationed on purpose.
  const hanziOK = signable && !!hz && !!place && HANZI_BIOMES.has(place.biome)
    && wallH > 0.2 && fitsBeside(hzBw) && R(315) > gateFor(0.42);
  //
  // ⚠ AND THE ROUNDEL IS ALSO THE BLADE'S FALLBACK, which is why this is not gated on `!hanziOK`.
  // A blade can be eligible here and still be declined down there — `clearsFace` refuses a corner
  // an AUTHORED window grid is already sitting in, which is exactly what happens on Cash & Carrion
  // — and a frontage that ends up saying nothing about its trade because the fitting it was
  // allocated turned out not to fit is a worse answer than the badge it could have had. Section 4
  // reads the blade's RESULT (`tradeHung`), not its gate.
  //
  // ⚠ IT IS RATIONED ON ITS OWN ROLL. Every fitting in this kit is rolled so a street carries a
  // mixture rather than a uniform costume, and "whatever the blade did not take" would put a badge
  // on every marked shopfront in the city at once.
  const roundelOK = signable && !!tradePicto && wallH > 0.2 && fitsBeside(rdR) && R(317) > gateFor(0.34);
  if (nameBladeOK) takeCorner(bladeSgn, nameBw);
  // One corner, whichever of the two ends up on it, so the reserve has to clear the wider of them.
  if (hanziOK || roundelOK) takeCorner(-bladeSgn, Math.max(hanziOK ? hzBw : 0, roundelOK ? rdR : 0));
  // -- WHERE A BUILDING THAT WILL NOT PUT UP A BOARD PAINTS ITS NAME, DECIDED ONCE -------------
  //
  // 107 of the 173 arms sign themselves with nothing, and section 3b hands most of them a lit
  // plate over the door -- but it deliberately refuses the industrial half of the city, because a
  // plant does not advertise itself and a refinery wearing a backlit shopfront sign is what made
  // the east read as a retail street with dirtier walls. That argument is right about the FITTING
  // and it was taken as an argument about the NAME, so a warehouse, a cold store, a depot, a
  // turbine hall and a container yard all ended up as anonymous boxes with a louvre on them.
  //
  // What they actually have is the name PAINTED ON THE WALL, in stencil, the height of a storey,
  // across the frontage -- no plate, no backing, no light, and no less legible for it. That is a
  // `signBoard` with `bare` set, and `signFontOf` already answers `stencil` for every one of
  // those trades through SIGN_TRADE, so the hand needs nothing authored either.
  //
  // ⚠ THE BAND IS DERIVED HERE BECAUSE TWO SECTIONS READ IT, which is the same lesson `signHH`
  // records one screen down: the works louvres are placed off `wallH` in section 1 and the paint
  // in section 3b, and two independent expressions of one height is exactly how the neon tube came
  // to run through the middle of the name board.
  //
  // ⚠ 0.66 OF THE WALL, AND IT IS BRACKETED RATHER THAN CHOSEN. Above it sits the crown course
  // (`z1 - max(wallH * 0.16, 0.05)`, half a band deep) and below it the works louvres; at 0.66 the
  // paint clears the course at every wall height the course exists at, from 0.31 up.
  // ⚠ `style === 'works'` AND NOT SIMPLY `!signsItself`, WHICH WOULD HAVE BEEN TIDIER AND WRONG.
  // The other half of the unsigned city is the trades in UNSIGNED_TRADE whose PALETTE classifies
  // them as `block` -- the power station, the refinery and the vat house, all three of which
  // resolve to `window grid`. Those get the full window grid across the frontage, and a name
  // painted over four ranks of glazing is not a ghost sign, it is a mistake. They stay nameless
  // until somebody decides where a lettered band goes on a glazed wall.
  const paints = wants('sign') && style === 'works' && !signsItself(m, style)
    && wallH > 0.12 && main.hw > 0.1;
  const nameHH = Math.min(wallH * 0.085, 0.05);
  const nameZ = main.z0 + wallH * 0.66;
  // ⚠ AND THE LOUVRES GET WHAT IS LEFT, MEASURED FROM THE PAINT RATHER THAN GUESSED AT. A works
  // bank sat at 0.62 of the wall, which is where the name now is. Deriving the bank's own centre
  // from the band's underside is what makes "nothing crosses the name" arithmetic instead of two
  // fractions somebody checked once at one building height.
  const louvHH = Math.min(wallH * 0.16, 0.05);
  const louvZ = paints ? nameZ - nameHH - Math.max(wallH * 0.07, 0.025) - louvHH
    : main.z0 + wallH * 0.62;
  if (wants('wall') && style !== 'works' && wallH > 0.14 && main.hw > 0.12) {
    // ⚠ THE GRID IS BUDGETED, NOT JUST BOUNDED. Six floors by three columns is eighteen windows,
    // and a `windowBay` is the most-instanced part in the kit at eight quads apiece — so the tall
    // wide buildings, which are exactly the ones a dense frame is full of, were spending ~150 quads
    // each on glazing alone and put `framecost` 14% over its 2% tolerance on the cab:200 case.
    // Floors are kept in preference to columns because vertical rhythm is what reads as storeys.
    // ── HOW WIDE THE GLAZING IS ALLOWED TO BE, PER SIDE ────────────────────
    //
    // 0.75 for the grid and 0.76 for the ribbon are the numbers that have always shipped; the
    // reservation above only ever narrows them, and on a building with no corner fitting both
    // `resL` and `resR` are `Infinity`, so this is the identical band to the character.
    const gl = Math.min(0.75, resL), gr = Math.min(0.75, resR);
    // ⚠ THE COLUMN COUNT IS DERIVED FROM THE BAND, NOT FROM THE WALL, or a narrowed band keeps the
    // same number of columns and the panes crowd together instead of the row getting shorter.
    // At the full 1.5 this is `round(main.hw / pitch)` exactly, which is what it was.
    const cols0 = clamp(Math.round((main.hw * (gl + gr)) / (1.5 * (rich ? COL_PITCH_RICH : 0.13))), 1, rich ? COL_MAX_RICH : COL_MAX);
    const cols = clamp(Math.floor(winMax / floors), 1, cols0);
    const cw = (main.hw * (gl + gr)) / cols;          // leave a pier at each end
    let litN = 0, litZ = 0;      // how many panes are lit and where their middle is — see below
    // ⚠ A WINDOW IS TALLER THAN IT IS WIDE, AND THESE WERE SQUARE. `ww` was a flat third of the
    // column pitch and `wh` is capped by the floor spacing, so at the rich column pitch every pane
    // in the city came out 0.044 x 0.042 — a tile, not a window, and no amount of framing rescues
    // that silhouette. The width is derived from the HEIGHT now so the proportion is guaranteed,
    // and still clamped by the pitch so a narrow building cannot overrun its own piers.
    const wh = Math.min(0.042, wallH / (floors * 2.9)), ww = Math.min(cw * 0.33, wh * 0.68);
    // ⚠ NOT EVERY WINDOW IS LIT, and this is the cheapest thing on the whole pass. A facade where
    // every pane carries the same glow reads as a texture swatch rather than as a building with
    // people in it; the reference dioramas are all lit unevenly and it is most of what makes them
    // look inhabited. `dRand` is seeded off the tile, so a building keeps the same windows on every
    // frame — `models:diff` asserts two renders are identical and a flicker would fail it — while
    // two buildings of the same type on the same street light differently.
    // ⚠ ONLY THE NIGHT COLOUR VARIES, AND THE FIRST CUT VARIED BOTH. `windowBay` takes `glow` (what
    // the pane is after dark) and `glass` (what it is by day), and setting the day colour per window
    // too is wrong twice over: by daylight you cannot tell an occupied room from an empty one, and
    // the unlit value — a dark shade of the building's own palette — came out near-black on a dark
    // wall, so the windows read as HOLES punched in the facade rather than as glass. Day glazing is
    // left at the primitive's own default; only the lamp behind it is a coin toss.
    const warm = style === 'front' ? '#bfe4ff' : '#e8d6a8';
    const unlit = '#1b2430';           // a dim cold pane, never the wall colour and never black
    // ── AND NO TWO ROOMS HAVE THE SAME LAMP IN THEM ──────────────────────────
    //
    // The roll above decides WHETHER a pane is lit and there it stopped, so every lit window in
    // Coldwater was one of exactly TWO colours — the cool one on a shopfront and the warm one on
    // everything else — which is a texture rather than a building full of people. What the note above
    // says about an uneven facade applies one step further in: rooms differ because the lamps in them
    // do, and a tower reads as inhabited when its windows disagree about what colour light is.
    //
    // ⚠ DETERMINISTIC, off the same `dRand` stream and the same tile seed, for the reason recorded
    // above: `models:diff` asserts two renders of a model are identical and anything that moved here
    // would fail it. This is a fixed property of a pane, not an animation.
    //
    // ⚠ AND IT VARIES THE NIGHT COLOUR ONLY, which is the rule the paragraph above already had to
    // learn the hard way — by daylight you cannot tell an occupied room from an empty one, and a
    // per-pane day glazing read as holes punched in the wall.
    //
    // ⚠ A TINT, NOT A PALETTE. Swapping in unrelated colours makes a street of identical towers look
    // like a street of identical towers wearing fairy lights; what a real block does is vary in
    // WARMTH and in BRIGHTNESS around whatever that building's own lamp is. So the base colour keeps
    // its identity and each room shifts along those two axes — a tungsten table lamp, an overhead a
    // shade cooler, a room lit by one bulb at the back.
    const paneLit = (k) => {
      const r = parseInt(warm.slice(1, 3), 16), g = parseInt(warm.slice(3, 5), 16), b = parseInt(warm.slice(5, 7), 16);
      // Two independent draws off the same stream: one for warmth, one for how bright the room is.
      const t = dRand(seed, k * 7 + 3) * 2 - 1;        // -1 cooler … +1 warmer
      const v = 0.72 + dRand(seed, k * 7 + 5) * 0.38;  // a dim back room … a bright one
      const cl = (x) => Math.max(0, Math.min(255, Math.round(x)));
      // Warmth is a counter-rotation of red against blue, which is what a colour temperature IS —
      // scaling all three channels together would only ever make a paler or darker version of one
      // colour, which is the thing this is here to stop.
      return 'rgb(' + cl((r + t * 26) * v) + ',' + cl((g + t * 4) * v) + ',' + cl((b - t * 34) * v) + ')';
    };
    // ── A RIBBON, NOT A GRID, FOR THE SHOPFRONT SET ─────────────────────────
    //
    // Voltage's own authoring note already prescribes this and the kit was doing the opposite:
    // "ONE continuous glazed band, divided by mullions rather than punched into separate windows".
    // Three of the eight reference boards glow in big flat rectangles rather than in grids of
    // little ones, and it is the cheaper of the two by a wide margin — one bay with five mullions
    // is eleven faces where five punched bays are forty, and it lights a far bigger area.
    //
    // ⚠ AND IT IS THE ANSWER TO WHAT PHASE 2 MEASURED. Raising the grid alone took the registry to
    // 35,478 faces and moved 0.77% of a close cab frame, because the wall texture is already
    // drawing a window grid at that range. A ribbon is not competing with the texture — it is a
    // different shape from anything `FACADE_MAT` can paint.
    //
    // ⚠ THE LIT ROLL MOVES FROM THE PANE TO THE FLOOR, and that is a change of look rather than a
    // loss of one. A grid reads as inhabited because some panes are dark; a ribbon reads that way
    // because some FLOORS are, which is what an office tower actually looks like after dark and
    // what every one of these boards shows. `litN` still counts rooms rather than parts, so the
    // facade wash below is unchanged in strength.
    //
    // ⚠ RICH LIST ONLY, and it has to be: `bars` is mesh-only, so on the 2-D painter a ribbon
    // would be one undivided glowing slab with no mullions at all.
    const ribbon = rich && RENDER_TUNE.glBand !== 0 && style === 'front' && !period;
    for (let f = 0; f < floors; f++) {
      const z = main.z0 + wallH * ((f + 0.62) / floors);
      if (z + wh > main.z1 - 0.02) continue;
      if (ribbon) {
        // A ribbon reaches a hair further than the grid's piers do, and it is re-centred when only
        // one corner is reserved — a band that kept the middle of the wall would run under the
        // sign on one side and leave a bare pier on the other.
        const rl = Math.min(0.76, resL), rr = Math.min(0.76, resR);
        // ⚠ A BAND THAT WOULD CROSS THE AUTHOR'S OWN WINDOW IS SKIPPED, not narrowed: a ribbon
        // spans the frontage by definition, so there is nothing to trim it to.
        // ⚠ AND THE SKIP COMES BEFORE THE LIT ROLL, or a band nobody can see still tells
        // `facadeGlow` how many rooms are occupied and the wash carries light off a wall that has
        // none. Same reason `litN` counts rooms rather than parts.
        const rcx = main.cx + (rr - rl) * main.hw * 0.5, rhalf = main.hw * (rl + rr) * 0.5;
        if (!clearOfAuthor(fy, rcx - rhalf, rcx + rhalf, z - wh, z + wh)) continue;
        const lit = dRand(seed, f * 11 + 1) > 0.34;
        if (lit) { litN += cols; litZ += z * cols; }
        pushWin({ kind: 'windowBay', cx: A(rcx), cy: A(fy), z: A(z),
          // ⚠ OFF `wh` AND NOT `min(ww, wh)`: a ribbon is a band the width of the facade, so the
          // grid's pane width is nothing to do with it — and narrowing `ww` to make the GRID's
          // panes portrait would otherwise have quietly made every ribbon's reveal shallower.
          half: A(rhalf), hh: A(wh), depth: A(wh * 0.34), pal: wpal,
          bars: clamp(cols0 + 1, 2, 6), transom: 0.72, glow: lit ? paneLit(f * 11 + 1) : unlit });
        continue;
      }
      for (let i = 0; i < cols; i++) {
        const x = main.cx - main.hw * gl + cw * (i + 0.5);
        if (!clearOfAuthor(fy, x - ww, x + ww, z - wh, z + wh)) continue;   // the author's own window keeps its patch of wall
        const lit = dRand(seed, f * 11 + i * 3 + 1) > 0.34;
        if (lit) { litN++; litZ += z; }
        // ⚠ A MULLION AND A TRANSOM ARE WHAT MAKE IT A SASH RATHER THAN A HOLE, and the grid had
        // neither: `bars` was switched OFF above two columns, which at the rich pitch is almost
        // every building, and no branch here has ever set a transom at all. The Embassy's authored
        // bays carry both (`bars: 1, transom: 0.3` on its guest floors) and that is most of why its
        // windows read as windows.
        // ⚠ RICH LIST ONLY, WHICH IS THE SAME BARGAIN `bars` WAS ALREADY STRUCK ON. A mullion is
        // mesh-only inside the painter, so setting it costs the 2-D renderer nothing — but a
        // TRANSOM is not gated in there (an authored bay draws one on the fallback, and must go on
        // doing so), so asking for one unconditionally would spend a quad per window per frame on
        // the weakest machine we support. The lean list stays exactly the renderer it was.
        pushWin({ kind: 'windowBay', cx: A(x), cy: A(fy), z: A(z), half: A(ww), hh: A(wh),
          depth: A(Math.min(ww, wh) * 0.3), pal: wpal,
          bars: rich ? 1 : (cols > 2 ? 0 : 1), transom: rich ? 0.3 : undefined,
          glow: lit ? paneLit(f * 11 + i * 3 + 1) : unlit });
      }
    }
    // ── AND WHAT ALL THOSE LIT ROOMS THROW ──────────────────────────────────
    //
    // One light for the whole grid, at the centre of the panes that are actually lit — see the ⚠ on
    // `facadeGlow`. Its colour is the same `warm` the panes burn, so a bar's magenta frontage
    // washes magenta and an office's cold white washes white, with nothing authored for either.
    //
    // ⚠ ITS SIZE COMES FROM HOW MANY ARE LIT, NOT FROM HOW BIG THE BUILDING IS. A tower with two
    // rooms occupied should throw about as much light as a shop with two, and scaling on the mass
    // would make an empty tower the brightest thing on the street.
    if (litN > 0) {
      push({ kind: 'facadeGlow', cx: A(main.cx), cy: A(fy), z: A(litZ / litN),
        // ⚠ PULLED BACK ON THE EYE, from a 0.14 ceiling and a 0.16+0.02n alpha clamped at 0.42.
        // Reported from a live cockpit as "the wash effect is too dramatic", which is the judgement
        // this number was always waiting for — the note below says it is free to be whatever looks
        // right, because `WASH_SLOTS` and not the brightness is what stops a wash evicting a sign.
        // This is the broadest light in the vocabulary: it covers a whole facade rather than a
        // patch of one, so it is the one that reads as the city being lit by something other than
        // its own signs.
        s: A(clamp(0.04 + litN * 0.009, 0.04, 0.10)),
        // Dimmer than the panes themselves, because a room seen through glass throws a fraction of
        // what its own window shows. `pickLights` also reads this colour for REACH, so the number
        // sets how far the wash carries as well as how bright it is — which is the right coupling.
        //
        // ⚠ IT IS NOT WHAT KEEPS THE WASHES FROM EVICTING THE NEON. That was tried: at full strength
        // the aeroplane seat went 13.7% of wall pixels moved to 11.5% — more lights, less light —
        // and dimmed far enough to stop evicting anything it contributed exactly nothing, 13.7%
        // again. There is no brightness in between, because the problem is the ranking rather than
        // the value. `WASH_SLOTS` is the fix; this number is free to be whatever looks right.
        rgb: hexRgb(warm).map((v) => Math.round(v * 0.7)).join(','),
        a: clamp(0.10 + litN * 0.012, 0.10, 0.26) });
    }
  } else if (wants('wall') && style === 'works' && wallH > 0.18 && main.hw > 0.12) {
    // A works gets louvres where a block gets windows: the same rhythm, doing a different job.
    const n = clamp(Math.round(main.hw / 0.16), 1, 2);
    // ⚠ THE BANK IS SKIPPED RATHER THAN SQUEEZED when the paint has taken the wall. On a
    // single-storey shed there is not room for a name and a louvre bank above the shopfront band,
    // and a bank shoved down into the roller door is worse than no bank -- the ground section
    // already puts a smaller one beside the personnel door, which is where extract on a shed is.
    if (louvZ - louvHH > main.z0 + wallH * 0.1) for (let i = 0; i < n; i++) {
      const x = main.cx + (n === 1 ? 0 : (i ? 1 : -1) * main.hw * 0.44);
      push({ kind: 'louvreBank', drip: 1, cx: A(x), cy: A(fy), z: A(louvZ),
        half: A(main.hw * 0.26), hh: A(louvHH), n: 6, pal });
    }
  }
  // The riser: ducting on a works, a downpipe on anything else. Always on a flank, never centred.
  // ⚠ The flank is chosen OUTSIDE the `wants` guard, because the stair below reads it to take the
  // other one — and a building whose riser was suppressed still needs the answer to that question.
  const riserX = main.cx + main.hw * (R(3) > 0.5 ? 0.82 : -0.82);
  if (wants('riser')) {
    const rx = riserX;
    if (style === 'works') {
      push({ kind: 'ductRun', cx: A(rx), cy: A(fy), z0: A(main.z0 + wallH * 0.08), z1: A(main.z1 - wallH * 0.12),
        r: A(clamp(main.hw * 0.09, 0.012, 0.03)), run: A(-Math.sign(rx - main.cx) * main.hw * 0.5), pal });
    } else {
      // A symmetric facade (the Meridian's deco front) gets a matching pipe on the other flank.
      for (const x of RISER_PAIR.has(tradeOf(m)) ? [rx, 2 * main.cx - rx] : [rx])
        push({ kind: 'pipe', cx: A(x), cy: A(fy), z0: A(main.z0), z1: A(main.z1 - wallH * 0.06),
          r: A(clamp(main.hw * 0.03, 0.006, 0.014)), pal });
      push({ kind: 'cableRun', cx: A(main.cx), cy: A(fy + 0.012), z: A(main.z1 - wallH * 0.14),
        half: A(main.hw * 0.8), sag: A(wallH * 0.05), r: A(0.006), pal: 'infra' });
    }
  }

  // ── 1b. THE STAIR ─────────────────────────────────────────────────────────
  // A zigzag fire escape is the most characterful thing in the whole vocabulary — a blank wall and a
  // wall with one of these read as two different neighbourhoods — and until now the kit never
  // emitted one, so it reached the two arms that hand-author it and nothing else. It is also the
  // dearest part on the list at ~14 quads, so it goes on ONE flank of ONE building, never repeated.
  //
  // ⚠ IT TAKES THE FLANK THE RISER DID NOT. Both want a side of the facade, and both defaulting to
  // the same coin flip put a downpipe through the middle of a staircase on about half of them.
  const stairSide = -Math.sign(riserX - main.cx) || 1;
  // ── ⚠ AND IT GOES ON A FLANK, NOT ACROSS THE SHOPFRONT ──────────────────────────────────────
  //
  // Every wall part above this point is placed on `fy`, the FRONT face, because until `face`
  // worked that was the only plane the kit had. For a downpipe or a vent that is merely arbitrary.
  // For a zigzag fire escape it is wrong, and it is the one thing about the derived kit anybody has
  // ever reported: fourteen quads of landing and railing bolted across the street elevation reads
  // as a CAGE over the frontage — over a shopfront, over a hotel entrance, and (because the kit
  // reaches every model without an authored `stair`) over the Meridian, which is the most
  // deliberately composed facade in Coldwater.
  //
  // A fire escape belongs on a flank or a back. The kit already knows how to reach one — `face: 'x'`
  // turns the local frame, which is how section 1d hangs the whole service kit on the sides — so
  // this is a placement change and not a new mechanism. Nothing is lost: the part still draws, the
  // silhouette still breaks, and a truck turning the corner still sees it.
  //
  // ⚠ THE BALCONY BRANCH DOES NOT MOVE, and that is the distinction rather than an oversight. A
  // balcony stack is not a cage: it is where somebody steps out of a window, it belongs on the
  // elevation with the windows in it, and section 1c deliberately puts a whole grid of them across
  // the front of a residential block for exactly that reason.
  //
  // ⚠ A LOPSIDED MASS FALLS BACK TO BALCONIES RATHER THAN TO THE FRONT. `faceY` pushes outward by
  // the sign of the plane and assumes a roughly centred building — invisible at 0.006 tiles on a
  // front or back, and capable of putting a flank part on the wrong side of an off-centre box. Same
  // guard section 1d states; the difference is that declining here has somewhere good to go.
  const stairX = main.cx + stairSide * main.hw;
  const flankOk = Math.abs(stairX) > 0.02 && Math.sign(stairX) === stairSide;
  if (wants('stair') && wallH > 0.26 && main.hw > 0.14) {
    if (flankOk && (style === 'works' || dRand(seed, 61) > 0.45)) {
      // The rotated frame puts `cy` on the model's x and `cx` along negative y — see section 1d.
      // `half` is measured along the FLANK, so it comes off the depth rather than the width.
      push({ kind: 'fireEscape', face: 'x', cx: A(-(main.cy - main.fd * 0.2)), cy: A(stairX),
        z0: A(main.z0 + wallH * 0.18), z1: A(main.z1 - wallH * 0.1),
        half: A(Math.min(main.fd * 0.22, 0.075)), out: A(clamp(main.hw * 0.14, 0.025, 0.05)),
        flights: clamp(Math.round(wallH / 0.2), 2, 4), pal });
    } else {
      // A balcony stack instead — the same wall doing the same job for somebody who lives there.
      const n = clamp(Math.round(wallH / 0.22), 2, 3);
      for (let i = 0; i < n; i++) {
        push({ kind: 'balcony', cx: A(main.cx + stairSide * main.hw * 0.55), cy: A(fy),
          z: A(main.z0 + wallH * (0.3 + i * 0.24)),
          half: A(Math.min(main.hw * 0.26, 0.09)), out: A(clamp(main.hw * 0.13, 0.022, 0.045)),
          rail: A(Math.min(wallH * 0.05, 0.022)), pal });
      }
    }
    // ── 1c. AND ON THE MESH, THE REST OF THE FACADE GETS ONE TOO ────────────
    //
    // The section above puts a stair OR a stack on ONE flank, because on the painter that is what
    // fourteen quads cost. The mesh has the budget for the thing the reference boards are actually
    // made of: a residential block wears balconies across its whole front, on every floor, and it
    // is the single most recognisable silhouette in the vocabulary.
    //
    // ⚠ THIS IS THE SPEND THAT SHOWS, AND THE WINDOW GRID IS THE ONE THAT DOES NOT. A balcony
    // projects off the wall, so it breaks the silhouette, catches the key light on its slab and
    // shades the wall under it — it reads from down the street. A window bay is flat on a facade
    // that already has a window grid baked into its texture, so past a few tiles it is a texture
    // detail competing with a texture. Same cost per part, completely different return.
    //
    // ⚠ AND IT TAKES THE COLUMNS THE WINDOWS ARE ON, not a rhythm of its own. A balcony is where
    // somebody steps OUT of a window; on an independent spacing the two read as two unrelated grids
    // on one wall, which is worse than either alone.
    if (rich && style === 'block' && wallH > 0.3 && main.hw > 0.16) {
      const bCols = clamp(Math.round(main.hw / 0.16), 1, 3);
      const bFloors = clamp(Math.round(wallH / 0.26), 2, 4);
      // The band the windows were given — see the ⚠ on `gl`/`gr`. A balcony is where somebody steps
      // OUT of a window, so it narrows with them or the outer one ends up under the corner blade.
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

  // ── 1d. AND THE OTHER THREE WALLS ─────────────────────────────────────────
  //
  // Everything above this point is placed on ONE plane — `fy`, the front face of the biggest box —
  // because until `face` worked there was nowhere else to put it. So a building in Coldwater has a
  // facade and three blank elevations, and a truck turning a corner drives past the back of a set.
  //
  // ⚠ WHAT GOES ON A FLANK IS SERVICE, NOT FACADE. No windows: the wall texture is already drawing
  // a window grid on all four sides (65 `FACADE_MAT` palettes of it), and Phase 2 measured what
  // adding geometry on top of that buys — 0.77% of a close frame. No awning, no doorway, no name
  // board, no pavement props either, and those for a different reason: every one of them is derived
  // from the ENTRANCE, and a building has one of those. What a flank has is the plumbing — a riser,
  // a cable drop, a condenser, an extract grille, a conduit run — which is exactly what the dense
  // grey reference facades are made of and exactly what a texture cannot express.
  //
  // ⚠ THE SIGN OF `cy` IS WHICH SIDE, so a flank part is only placed when its plane is actually on
  // the side of the model origin that its sign says. `faceY` pushes outward by that sign and has
  // always assumed a roughly centred building; for the front and back that assumption is invisible
  // at 0.006 tiles, but a flank kit chooses its own planes and can put one on the wrong side of a
  // lopsided mass. Cheaper to decline than to get it subtly wrong.
  //
  // Rich list only — this is the whole point of having two budgets.
  const fxPos = main.cx + main.hw, fxNeg = main.cx - main.hw;
  // ⚠ CHOSEN OUTSIDE THE GUARD, exactly as `riserX` is and for the same reason: the gable-end ad
  // panel in section 4 reads it to take the OTHER flank, and a building whose service kit was
  // suppressed still needs the answer to that question. Two copies of this expression would drift.
  const svcSide = dRand(seed, 201) > 0.5 ? 1 : -1;        // ⚠ salt 200+ — the earlier sections use 3…74
  if (rich && wants('riser') && fxPos > 0.02 && fxNeg < -0.02 && wallH > 0.18) {
    // The rotated frame puts a part's `cy` along the model's x and its `cx` along negative y — see
    // the ⚠ on `face` in detailLayer. So `cy` is which flank, and `cx` is where along it.
    const along = (t) => A(-(main.cy + t));
    const svcX = svcSide > 0 ? fxPos : fxNeg;
    const othX = svcSide > 0 ? fxNeg : fxPos;
    const r = clamp(main.hw * 0.03, 0.006, 0.014);
    // The service flank: a riser the full height of the wall, and a cable drop beside it.
    push({ kind: style === 'works' ? 'ductRun' : 'pipe', face: 'x', cx: along(main.fd * 0.35), cy: A(svcX),
      z0: A(main.z0 + wallH * 0.04), z1: A(main.z1 - wallH * 0.08),
      r: A(style === 'works' ? Math.max(r, 0.012) : r), run: A(main.fd * 0.5), pal: 'infra' });
    push({ kind: 'cableRun', face: 'x', cx: along(-main.fd * 0.1), cy: A(svcX + Math.sign(svcX) * 0.004),
      z: A(main.z1 - wallH * 0.18), half: A(main.fd * 0.55), sag: A(wallH * 0.04), r: A(0.005), pal: 'infra' });
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
        z: A(main.z0 + wallH * 0.34), half: A(main.fd * 0.6), r: A(0.005), pal: 'infra' });
    }
    // And the back, which only the air ever sees: the cheapest pair on the list.
    const by2 = main.cy - main.fd;
    if (by2 < -0.02 || main.cy < 0) {
      push({ kind: 'pipe', cx: A(main.cx + main.hw * 0.5), cy: A(by2),
        z0: A(main.z0), z1: A(main.z1 - wallH * 0.1), r: A(r), pal: 'infra' });
    }
  }

  // ── 2. THE ROOF ───────────────────────────────────────────────────────────
  // From the air a flat roof is the biggest surface a building has and usually the emptiest, and
  // this game spends half its time looking down. The deck is the TOP box's own roof, so the plant
  // stands on it rather than hovering over the tallest thing on the tile.
  // ⚠ THE ROOF IS THE ONE PLACE THIS PASS CAN MAKE THE CITY WORSE, AND THE FIRST CUT DID. Every
  // other section is bounded by the wall it sits on, so it varies with the building whether it means
  // to or not. A roof is a bare deck, so a fixed recipe puts the SAME mast in the SAME corner of
  // every building — and swept over 124 models that read as more uniform than the bare decks it
  // replaced, which is the opposite of the point. Presence, corner and size are all seeded off the
  // tile: `dRand` is deterministic (`models:diff` asserts two renders match), so a building keeps
  // its own skyline for ever while its neighbour gets a different one.
  // ⚠ ROOF PLANT STANDS ON A REAL DECK, NEVER ON THE TALLEST BOX. A shed's wall box is the tallest
  // thing in `cand` and its lid is a barrel — putting a tank on it floats the tank inside the curve.
  // `deck` is empty for a building with no flat roof at all, and then there is simply no roof plant,
  // which is the right answer rather than a fallback.
  const roofOn = deck.length ? deck[0] : null;
  const deckZ = roofOn ? roofOn.z1 : 0;   // ⚠ the DECK own top, not the tallest box in the tile
  const dhw = roofOn ? roofOn.hw : 0;
  // ── ⚠ A BUILDING SAYS ITS OWN NAME ONCE, AND THIS IS WHERE IT IS DECIDED WHO SAYS IT ─────────
  //
  // Three sections letter `$name`: the board over the door (3b), the works' painted elevation (3c)
  // and the rooftop hoarding (4). 3b and 3c are mutually exclusive by construction, and the
  // hoarding was exclusive with NEITHER — it gates on `signsItself`, the question "does this TRADE
  // advertise", never on whether anything has actually put the name up. So a shop was handed a lit
  // board on its roof saying the same words as the plate over its own door, and a shop whose ARM
  // letters its fascia got one too: TINE & TEMPER, twice, a metre apart, which is what the street
  // reads as. `KIT_DECLINE` already carries a `helpings: ['signRoof']` entry written for exactly
  // this one building, and the note there states the principle — "nobody puts a hoarding on the
  // roof of a single-storey shop to repeat what is written over the door". 66 arms letter
  // themselves; a per-building table was never going to reach them.
  //
  // ⚠ THE ROOF WINS THE NAME, NOT THE DOOR, and that is a decision rather than an ordering
  // accident. A hoarding stands against the sky and is read from down the street; a door plate is
  // unreadable from the far kerb. So the hoarding is ROLLED FIRST — which is the only reason its
  // gate is hoisted up here, two hundred lines above where it is drawn — and the board underneath
  // then knows whether the name is spoken for.
  //
  // ⚠ AND NEITHER IS DELETED, THEY ARE RE-LETTERED. Folding `signRoof` into `sign` is the tidier
  // fix and it is the one SECTION_OF's own ⚠ argues against at length: a name band across a
  // shopfront is not a claim to have used the roof, and a gantry gated on the wall is excluded
  // from exactly the neon frontages a city like this puts one on. What the loser of the coin toss
  // carries instead is the trade's MARK — a martini, a fork, a crane hook — which says what the
  // building is without repeating what it is called, and is what half the reference boards show.
  // A fitting with no mark to carry is declined rather than left blank: `signGantry`'s own guard
  // already refuses an unlettered board, because "a blank board reads as one whose paint has come
  // off".
  const armNamed = have.has('sign') || paints;
  const roofSigns = rich && !period && wants('signRoof') && !!roofOn && dhw > 0.1
    && signsItself(m, style) && R(301) > gateFor(style === 'front' ? 0.22 : 0.40);
  // ── ⚠ AND WHETHER THE HOARDING CAN ACTUALLY STAND, ASKED HERE RATHER THAN WHERE IT IS BUILT ──
  //
  // Section 4 sizes the hoarding, then looks for a lateral offset that clears the aerial masts the
  // ARM has already raised on that deck, and declines outright when none of the three candidates
  // does — with a ⚠ saying why that is the right call: "a hoarding with an aerial through it is
  // worse than no hoarding, and this part is the one the kit can decline most cheaply".
  //
  // It was the cheapest part to decline while the board over the door was still there to fall back
  // on. It stopped being, the moment `roofTakesName` was hoisted up here so 3b could stand down —
  // because the roof then claims the name two hundred lines before it finds out it has nowhere to
  // put it, and 3b has already skipped the plate. The building ends up with its name on NOTHING.
  //
  // Measured over the registry: `type:office`, `type:corporate_office`, `type:asc_spire` and
  // `type:asc_shrine` each carry a lettered board in the lean kit and nothing at all in the rich
  // one — and the rich kit is what GLASS 2 builds every mesh from, so that is the default renderer
  // on four of the most-instanced models in Coldwater. None of them is near the budget ceiling
  // (47, 47, 25 and 55 parts against 56), which is what says the cause is this and not `spent`.
  //
  // So the question moves to where the answer is used. The roll and the clearance test are HOISTED
  // rather than copied — section 4 reads these two — because the same roll expressed twice is the
  // drift this file warns about at `riserX`, and here the two copies would have to agree about
  // which sign the building is wearing.
  const gantryNudge = dhw * 0.34;
  const gantryCx0 = roofOn ? roofOn.cx + dhw * (R(303) - 0.5) * 0.34 : 0;
  // ⚠ SIZED OFF THE DECK AND CLAMPED AT BOTH ENDS, and a LOGO BOARD IS NARROWER — a mark is square
  // and a name is a ribbon. Both were section 4's; they are a function now because the name width
  // has to be known up here to ask the question this whole note is about.
  const gantryW = (logo) => clamp(dhw * (logo ? 0.52 : 0.82), logo ? 0.045 : 0.055, logo ? 0.15 : 0.24);
  // ⚠ THE TEST IS A LATERAL GAP AND NOT A BOX INTERSECTION, because a mast is a LINE with no
  // thickness — it is drawn as a 1.1-pixel stroke — so "does the board's span contain the mast's x"
  // is the whole question, and the z ranges always overlap (both start at the deck).
  const gantryAt = (gw) => [gantryCx0, gantryCx0 + gantryNudge, gantryCx0 - gantryNudge]
    .find((cx) => spars.every((s) => Math.abs(s.cx - cx) > gw * 1.05 || s.z1 < deckZ + 0.005));
  // ⚠ AT THE NAME WIDTH, WHICH IS THE WIDER OF THE TWO. If the name hoarding will not fit, the roof
  // does not claim the name and the board over the door keeps it — and section 4 may still try the
  // narrower LOGO board, which is a bonus rather than a substitute and may decline on its own.
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
      // A tank is the landmark and only the bigger works get one; the rest get the stack alone,
      // which is what stops every industrial roof carrying the same two objects.
      if (big && R(31) > 0.35) {
        const t = q(0, 0.06, 0.04);
        push({ kind: 'tankFrame', cx: A(t.x), cy: A(t.y), z: A(deckZ), r: A(dhw * (0.24 + R(33) * 0.1)),
          hh: A(dhw * (0.38 + R(35) * 0.16)), rise: A(dhw * (0.26 + R(37) * 0.18)), pal });
      }
      const s = q(2, -0.05, -0.03);
      // ⚠ Toned from `dhw * 0.85`. At that height a stack on a small roof is a mast half the height
      // of its own building, and swept across the works set it read as a gallows rather than as a
      // flue — the single worst-looking thing the first cut produced.
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
    // ── THE STAIR HEAD, ON EVERY DECK THAT CAN HOLD ONE ───────────────────────────────────────
    //
    // ⚠ THE ONE ROOF PART THAT IS NOT ROLLED, AND THAT IS THE DECISION. Everything else up here is
    // a coin toss precisely because a fixed recipe put the same mast in the same corner of every
    // building — the trap this section's own ⚠ opens with. A bulkhead is the exception because it
    // is not decoration: something has to bring the stairs up, so a deck WITHOUT one is the odd
    // case rather than the plain one, and rolling it would leave half the city still reading as a
    // lid. What varies is where it stands and how big it is, which is what stops it being a recipe.
    //
    // ⚠ IT TAKES THE MIDDLE, NOT A CORNER. `q()` hands out the four corners and all of them are
    // spoken for — the landmark, the aerials and the plant rank — and a stair rises through the
    // middle of a building because that is where the core is. It also has to stand clear of the
    // parapet, or from a shallow angle the two silhouettes merge into one thicker lid, which is
    // the read this part exists to break.
    // ⚠ AND IT IS GATED ON HOW FAR UP THE DECK IS, NEVER ON HOW WIDE IT IS. A stair head exists
    // because somebody has to climb to the roof, and nobody builds a stair enclosure to reach a
    // shop's own lid — a single-storey frontage takes a ladder, if it takes anything. Gated on
    // `dhw` alone, the widest decks in the city are exactly the single-storey sheds and shops, so
    // the part landed on the buildings it is most wrong on and skipped the towers. Two and a bit
    // storeys, in the 0.17 this section already works in.
    const upFromStreet = deckZ - cand[cand.length - 1].z0;
    if (dhw > 0.1 && upFromStreet > 0.17 * 2.2) {
      const bkw = dhw * (0.17 + R(63) * 0.07);
      push({ kind: 'roofBulkhead',
        cx: A(roofOn.cx + dhw * (R(65) - 0.5) * 0.5), cy: A(roofOn.cy + dhw * (R(67) - 0.5) * 0.5),
        z: A(deckZ), w: A(bkw), d: A(bkw * (0.72 + R(69) * 0.4)),
        // ⚠ A STAIR HEAD IS A ROOM, SO ITS HEIGHT IS A STOREY AND NOT A FRACTION OF THE DECK. The
        // rest of this section scales off `dhw` because a tank on a big roof IS bigger; a door is
        // the same height on a shed and on a tower. Same argument `GF` makes for the ground floor,
        // and the same shape of fix: a fraction of the deck, clamped by an absolute.
        hh: A(clamp(dhw * 0.28, 0.05, 0.088)), pal });
    }
    // ── AND THE PLANT READS AS PLANT, WHICH MEANS MORE THAN ONE OF IT ─────────────────────────
    //
    // ⚠ ONE CONDENSER ON A DECK IS A CRATE. Air handling is installed in RANKS — a row of identical
    // units on a common frame, all facing the same way, because that is how the pipework runs — and
    // a rank is the thing that reads as machinery at a range where a single box reads as litter. It
    // is also nearly free: the units are already the smallest part in the kit, and three of them in
    // a line cost what the old pair cost plus one.
    // ⚠ THEY SHARE A SIZE, WHICH IS WHAT MAKES IT A RANK. Jittering each one reads as rubbish
    // somebody left on a roof; identical units at an even pitch read as an installation.
    const rank = 2 + Math.round(R(51) * (big ? 2 : 1));
    const acW = dhw * (0.10 + R(53) * 0.04), acH = dhw * (0.09 + R(57) * 0.05);
    const u = q(1, -0.02, 0.02);
    // Along whichever axis has the room — a rank laid across the short side of a deck runs off it.
    const along = R(59) > 0.5;
    for (let i = 0; i < rank; i++) {
      const o = (i - (rank - 1) / 2) * acW * 2.6;
      push({ kind: 'acUnit', cx: A(u.x + (along ? o : 0)), cy: A(u.y + (along ? 0 : o)),
        z: A(deckZ), w: A(acW), d: A(acW * 0.8), hh: A(acH), pal });
    }
  }

  // ── 3. THE GROUND FLOOR ───────────────────────────────────────────────────
  //
  // The one part a player on foot or in a cab actually stands in front of, and the part every one
  // of the reference dioramas is dominated by: an awning, a lit shopfront, a shutter, a door. The
  // upper floors are what a building looks like from an aeroplane; this is what it looks like from
  // the game's commonest camera, which sits at eye height 0.
  //
  // ⚠ THE STOREY IS CLAMPED, NOT SCALED. A ground floor is about the same height whoever built it —
  // it is sized by a door and a person, not by how tall the block above it is — so every dimension
  // here is `min(a fraction of the base, an absolute)`. Scaling it with the mass gave a thirty-storey
  // tower a two-storey front door.
  if (wants('ground') && bh > 0.05 && base.hw > 0.1) {
    const dz = base.z0 + GF * 0.52;                 // the middle of that band
    if (style === 'works') {
      // A works meets the street with a vehicle door and a personnel door beside it.
      // ⚠ `bay` AND A WIDER OPENING, BECAUSE THIS IS THE THING THE FRONTAGE IS FOR. At 0.34 of
      // the base half-width with no housing and no guides it was a patch of slightly different
      // wall, indistinguishable at a glance from the louvre bank three of these buildings also
      // carry. A works frontage is a door big enough to reverse a truck into and some wall around
      // it, in that order. The personnel door sits at 0.52 with its own half under 0.11, so at 0.4
      // plus a guide channel the two still clear each other by a fifth of the frontage.
      const bay = BAY_TRADE.has(tradeOf(m));
      push({ kind: 'shutter', bay, cx: A(base.cx - base.hw * 0.18), cy: A(by), z: A(dz),
        half: A(base.hw * (bay ? 0.4 : 0.34)), hh: A(GF * 0.46), pal });
      push({ kind: 'windowBay', cx: A(base.cx + base.hw * 0.52), cy: A(by), z: A(dz),
        half: A(Math.min(base.hw * 0.11, 0.035)), hh: A(GF * 0.4), depth: A(0.01), pal: wpal,
        glow: '#d8c88a', glass: '#1c2026' });
      push({ kind: 'louvreBank', drip: 1, cx: A(base.cx + base.hw * 0.8), cy: A(by), z: A(dz + GF * 0.1),
        half: A(Math.min(base.hw * 0.12, 0.04)), hh: A(GF * 0.26), n: 5, pal });
    } else {
      // A shopfront: a run of glazing under an awning, with the entrance bay left dark beside it.
      // The awning is the thing that reads first — it is the only horizontal on the whole facade.
      push({ kind: 'canopy', cx: A(base.cx), cy: A(by), z: A(base.z0 + GF),
        half: A(base.hw * 0.86), out: A(clamp(base.hw * 0.26, 0.03, 0.075)), hh: A(0.014), pal,
        soffit: shadeOf(pal, 0.3), strip: style === 'front' ? '#ffd9a0' : undefined });
      const glow = style === 'front' ? '#cfe6ff' : '#f0d8a0';
      // ── ONE CONTINUOUS BAND, DIVIDED BY MULLIONS ──────────────────────────
      //
      // Voltage's authoring note, applied to the whole city: a modern shopfront is one sheet of
      // glass with uprights in it, and the kit was building two punched panes with a dark gap
      // between them, which is a Victorian shop. The band is also fewer parts than the pair it
      // replaces once the doorway is counted.
      //
      // ⚠ THE DOOR STANDS PROUD OF THE GLASS RATHER THAN BEING A HOLE IN IT. A dark bay drawn at
      // the same plane as the band is a coin toss on the depth buffer — the band's glazing sits at
      // a higher lift than the door's surround, so the glass would win and the doorway would be
      // behind its own shopfront. Four thousandths of a tile is nothing to look at and settles it
      // by geometry, which is the whole point of `FACE_EPS` one layer down.
      const out = (by < 0 ? -1 : 1) * 0.004;
      const band = rich && RENDER_TUNE.glBand !== 0;
      if (band) {
        push({ kind: 'windowBay', cx: A(base.cx), cy: A(by), z: A(dz),
          half: A(Math.min(base.hw * 0.8, 0.27)), hh: A(GF * 0.36), depth: A(0.012), pal: wpal,
          glow, bars: 5, transom: 0.78 });
      } else {
        // Two panes and a doorway between them, which is what a shop actually is.
        for (const s of [-1, 1]) {
          push({ kind: 'windowBay', cx: A(base.cx + s * base.hw * 0.46), cy: A(by), z: A(dz),
            half: A(Math.min(base.hw * 0.3, 0.1)), hh: A(GF * 0.36), depth: A(0.012), pal: wpal,
            glow, bars: 1 });
        }
      }
      push({ kind: 'windowBay', cx: A(base.cx), cy: A(band ? by + out : by), z: A(base.z0 + GF * 0.42),
        half: A(Math.min(base.hw * 0.13, 0.045)), hh: A(GF * 0.42), depth: A(0.016), pal: wpal,
        glow: shadeOf(pal, 0.5), glass: shadeOf(pal, 0.42) });   // the doorway: a recess, not a light
    }
    // ── 3b. THE NAME ────────────────────────────────────────────────────────
    // A board over the door, carrying the building's own name. 107 of the 173 arms sign themselves
    // with nothing at all, and an unsigned building in a city is the thing that most makes it read
    // as scenery rather than as a place — every one of the reference photographs is covered in
    // lettering. The 66 that already sign themselves are detected rather than guessed and skipped.
    //
    // ⚠ THE LABEL IS `$name`, RESOLVED AT DRAW TIME, AND BAKING THE TEXT IN WOULD BE A REAL BUG.
    // This list is cached per MODEL, and one model is drawn by many differently-named buildings —
    // `type:shop` is every shop in Coldwater. A resolved name here would put whichever building was
    // rendered first onto all of them.
    //
    // ⚠ A HORIZONTAL BOARD RATHER THAN A VERTICAL BLADE, for the same reason: the name is not known
    // when this list is built, so its LENGTH is not known either, and a twelve-character name down a
    // blade is unreadable while a board just squashes. An author who knows the name can choose.
    // ⚠ A WORKS DOES NOT PUT ITS NAME OVER THE DOOR, AND IT USED TO. Every industrial building in
    // the city — refinery, foundry, turbine hall, fabrication shop, container yard — was given a
    // lettered plate over its personnel door, because this section did not ask what kind of
    // building it was before signing it. That is not what a plant looks like: a works identifies
    // itself with a stencilled unit number on a door, a hazard placard and nothing else, and the
    // name on the gate is on the GATE. Signing all of them is also what made the industrial east
    // read as a retail street with dirtier walls.
    //
    // ⚠ `signWorks` IS THE STATED EXCEPTION AND IT IS A PROPERTY OF THE BUILDING, not a roll. Some
    // industry does sign itself — a works that sells to the public over a counter, and a landmark
    // whose name is the reason it is on the map. It is opt-in per model so the default stays
    // "unsigned", which is what the street wants.
    // The trade's own hand and mark, if it has one — see SIGN_TRADE. A works building keeps mono
    // whatever its trade says, because a stencilled number on a plant is the point of it.
    const [tFont, tPicto] = (style !== 'works' && SIGN_TRADE[tradeOf(m)]) || ['', ''];
    // ⚠ AND THE BOARD IS SKIPPED OUTRIGHT WHEN THE ROOF HAS THE NAME AND THERE IS NO MARK — see
    // `roofTakesName`. A door plate with nothing on it is not a quieter sign, it is a sign whose
    // paint has come off, which is the same argument `signGantry` makes in its own guard.
    if (wants('sign') && signsItself(m, style) && (!roofTakesName || tPicto)) {
      // ⚠ SIZED TO BE READ, NOT TO BE TIDY. `signBoard` is screen-size gated like everything else,
      // and at the first cut's proportions the board only cleared its floor inside ~1.3 tiles —
      // close enough to touch the wall. A sign you can only read with your nose against it is not
      // doing the job a sign exists to do, so the band is deeper and its floor is lower than a
      // vent's: high-contrast lettering stays legible at a size at which a louvre is mush.
      // ⚠ A MARK-ONLY PLATE IS SQUARE, because `fitSignPts` centres the artwork in the quad it is
      // given and only ever takes LESS of it — so a pictogram on a board sized for a name is a
      // small badge adrift in a lot of dead board.
      const sz = Math.min(base.hw * (roofTakesName ? 0.22 : 0.62), roofTakesName ? 0.07 : 0.19);
      const shh = roofTakesName ? sz * 0.92 : signHH;
      // ⚠ THE SHOPFRONT FIRST, THE ELEVATION SECOND, AND THE PLANE MOVES WITH IT. This board hangs
      // over the DOOR, so its plane is the shopfront's own front face and its ceiling is that box's
      // top: lifted past `base.z1` on the same plane it would stand in front of the wall above
      // rather than on it. Where the shopfront has no clear band left — a stoop, a trough, a canopy
      // across the whole of it — the board goes up onto the elevation, where `fy` is the plane. If
      // neither clears it stays where it was: a board is the ONLY name a building that signs itself
      // gets (`paints` is the other branch and is mutually exclusive), so dropping it leaves the
      // building nameless, which is worse than a name you can half read.
      // ⚠ AND THE ELEVATION HAS TO REACH THE BOARD WHERE THE BOARD IS. The board is centred on
      // `base.cx` and `main` is whichever box has the most wall — on The Long Fire that is a corner
      // screen at x 0.248…0.440, and moving the board to its plane while leaving it at x ±0.074 put
      // the whole thing over open air. `anchored` caught it: that gate's founding bug, one branch
      // later. The stage is only taken when the main wall spans the board's own width.
      let seat = clearOfMass(false, 1, by, base.cx, sz, shh, signZ, base.z1), sPlane = by;
      if (!seat.clear && Math.abs(main.cx - base.cx) + sz <= main.hw) {
        const up = clearOfMass(false, 1, fy, base.cx, sz, shh, signZ, main.z1);
        if (up.clear) { seat = up; sPlane = fy; }
      }
      const sZ = seat.z;
      // ── …AND WHAT THE SHOP SELLS, UNDER WHAT IT IS CALLED ────────────────────────────────────
      //
      // See `SIGN_WORD` and `RENDER_TUNE.signSub`. Three gates, and each of them is the difference
      // between a fascia and a template:
      //
      // ⚠ ONLY ON A BOARD WITH ROOM. The sub costs about half the name's cap height, and a fascia
      // is a wide shallow strip — on the shallowest of them the name would be bought down to buy a
      // word nobody asked to read. `sz / shh` is the board's own proportion, and a board wider than
      // `SUB_MAX_ASP` of its height keeps the name alone.
      // ⚠ NEVER WITH A PICTOGRAM. `bakeSignText` refuses that combination anyway (a mark, a name
      // and a word is not a thing any reference has), so asking here keeps the two in step rather
      // than silently handing over a field that is dropped.
      // ⚠ AND RATIONED, for `SIGN_HANZI`'s stated reason: a street where some frontages carry a
      // trade word and some do not is the one that looks real, and every shop in Coldwater wearing
      // one is a costume. Off the seed, so a building keeps its answer.
      // ⚠ AND NEVER WHEN THE ROOF IS ALREADY SAYING IT. The logo hoarding used to carry a mark and
      // nothing else, so the fascia was the only thing in the city that said what the shop SELLS;
      // now that board is a stack with the same word under the same mark, and a frontage that says
      // PAWNBROKER twice, ten metres apart, is the "three boards all repeating CASH & CARRION"
      // this table's own note opens by refusing. The board above wins, because it is bigger and
      // because it is read from further away.
      // ⚠ A DECLINED HOARDING STILL COSTS THE SUB — whether it finds a clear patch of deck is not
      // known until two hundred lines below this. The sub is rationed to begin with, so losing one
      // is cheaper than the alternative, which is reading this list twice.
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
    // -- 3c. AND A WORKS PAINTS ITS NAME ON THE WALL INSTEAD ------------------------------------
    //
    // The branch above and this one are mutually exclusive by construction -- `paints` is
    // `!signsItself` -- so no building can get both, which is the whole reason the test is written
    // once up at the band rather than negated here.
    //
    // ⚠ IT GOES ON THE BIGGEST WALL, NOT ON THE BASE BOX. A board hangs over a door and belongs
    // to the shopfront, which is why section 3b sizes its off `base`; painted lettering belongs to
    // the ELEVATION and is read from the far side of a yard, so it takes `main` and the band the
    // louvres were moved out of.
    //
    // ⚠ AND IT IS ON THE FLANKS AS WELL, WHICH IS THE HALF THAT ANSWERS THE ACTUAL COMPLAINT. A
    // shed is long, its door faces one way, and almost every camera in this game meets one of the
    // other three sides -- that is what "terrible boring and unsightly" is a report about. A name
    // across a blank flank is also the single most characteristic thing a real warehouse has on it.
    //
    // ⚠ BOTH FLANKS, AND THE FIRST CUT TOOK ONLY THE ONE THE FIRE ESCAPE DID NOT. That reads as
    // the more tasteful answer and it makes the feature a COIN FLIP: `stairSide` is one
    // deterministic roll per model, so whether the wall you happen to be driving past carries the
    // name was decided by which side a downpipe went on. Half the buildings still answering "blank
    // shed" is the report not fixed. The back is deliberately left bare -- a yard elevation is
    // where a works genuinely has nothing -- so this is three sides, which is what a distribution
    // shed on a corner plot actually wears.
    //
    // ⚠ A FIRE ESCAPE CROSSING ONE OF THEM IS FINE AND `signfit` AGREES. That gate is about a
    // wire, mast or tube drawn OVER lettering by something that could have moved; a zigzag stair
    // bolted across a painted name is a photograph of any goods yard in the world.
    if (paints) {
      // ⚠ LIFTED CLEAR OF THE BUILDING'S OWN FRONTAGE — see `clearOfMass`. The band is derived at
      // two thirds of the wall, which on a shed is above everything and on a shop unit is behind
      // the shopfront: on Unit 3, Kessler Street the glazing box tops out at z 0.313 against a
      // name band of 0.265–0.343, so two thirds of the lettering was inside the building.
      // The rotated frame puts `cy` on the model's x and `cx` along negative y — see section 1d.
      // ⚠ AND THE LOPSIDED-MASS GUARD IS THE STAIR'S, for the reason section 1b states: `faceY`
      // pushes outward by the sign of the plane, so an off-centre box can put a flank part on the
      // wrong side of the building. Declining here costs one wall's lettering and nothing else.
      const flankSides = main.fd > 0.14
        ? [1, -1].filter((sd) => { const px = main.cx + sd * main.hw; return Math.abs(px) > 0.02 && Math.sign(px) === sd; })
        : [];
      // ⚠ AND THE FRONT IS DROPPED WHEN IT CANNOT BE CLEARED **AND** A FLANK IS CARRYING THE NAME.
      // That is the one case where declining is right, and the distinction is whether the building
      // ends up nameless: the Seed Vault's whole frontage is a blast door, the Paper Tomb's is a
      // portico across four projecting window slots, the wash house's is a rack of drying cloth —
      // on all three the band has nowhere on the FRONT to go, and on all three the flank elevations
      // are bare wall the name reads off perfectly. Painting it on the front anyway is lettering
      // inside a building. Without a flank to fall back on it stays, half hidden, because a name
      // you can half read beats no name (see `clearOfMass`).
      const fHalf = Math.min(main.hw * 0.7, 0.3);
      const fSeat = clearOfMass(false, 1, fy, main.cx, fHalf, nameHH, nameZ, main.z1);
      if (fSeat.clear || !flankSides.length) {
        // ⚠ AND THE FRONT GETS THE FITTINGS TREATMENT TOO, WHICH IS WHERE IT WAS REPORTED FROM.
        // `clearOfMass` answers for the building's own MASS and that is the whole of what the
        // branch above ever asked — so a band that cleared the shopfront was then painted straight
        // through the louvre bank, the riser and the extract grille bolted to the wall above it,
        // which on Unit 3, Kessler Street ate four letters out of the middle of its own name.
        // Same two moves as the flanks, in the same order and for the same reasons: lift into the
        // frieze if there is one, otherwise move along the wall, otherwise keep the half-read band.
        const fz = overFittings(false, fy, main.cx, fHalf, nameHH, fSeat.z, main.z1);
        const fSlide = fz === fSeat.z
          ? besideFittings(false, fy, main.cx, fHalf, nameHH, fz, fHalf * NAME_RUN_MIN) : null;
        push({ kind: 'signBoard', bare: true, cx: A(fSlide ? fSlide.cx : main.cx), cy: A(fy),
          z: A(fz), half: A(fSlide ? fSlide.half : fHalf), hh: A(nameHH), label: '$name' });
      }
      for (const sd of flankSides) {
        const px = main.cx + sd * main.hw;
        {
          // The patch's centre along a flank is the model's own y, which is `-cx` back out of the
          // rotated frame — so `main.cy`, not `-main.cy`.
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
  // ⚠ THE OLD PLACEMENT RULE WAS ONE SENTENCE AND BOTH HALVES OF IT WERE WRONG. It read: "nobody
  // sprays a shop window, and on this kit the middle of the ground floor is glazing — so the tag
  // takes the service end of the frontage, the same flank the bins are on". The glazing is not in
  // the middle: a shopfront band spans 0.8 of the base half-width, and even the two-pane fallback it
  // replaced centred a pane at 0.46 of it, while the tag sat at 0.484 — inside both. And the bins
  // are not cover, they are the problem: the tag, the bin stack and the vending machine were all
  // placed off the SAME doorway offset, at 0.62, 0.72 and 0.9 of it, so the one patch of wall the
  // kit painted was the one patch of pavement it puts its rubbish on.
  //
  // ⚠ AND EVERY WAY THAT FAILS IS SILENT. The decal is built, uploaded and drawn every frame; the
  // depth test hides it per pixel behind the glass or the bin; the wall reads clean. Measured by
  // `scripts/shapes/tagfit.mjs`: 83.1% of the kit's graffiti obstructed, worst 100%, and not one
  // piece anywhere but the frontage.
  //
  // So a piece is PLACED BY SEARCH rather than by a fraction — candidate patches from the quiet ends
  // of a wall inward, tested against everything recorded at the two funnels (`paintFoot`), first
  // free patch wins, and a wall with nowhere free gets no paint at all. That last part is the `tag`
  // painter's own stated rule arriving one layer up: a piece on the wrong wall is worse than a
  // clean wall.
  //
  // ⚠ AND IT IS PUSHED AFTER THE KERB PROPS, WHICH IS WHY IT MOVED DOWN THE FUNCTION. Position here
  // is priority, and paint yielding to the street furniture is the right way round — but the
  // ordering is not a preference: the bins have to be on the list before a search can avoid them.
  //
  // ⚠ AND IT IS NO LONGER INSIDE `wants('ground')`. Paint is not a ground-floor FITTING, and gating
  // it on one meant a building whose arm drew its own shopfront was also a building nobody had ever
  // tagged. What that gate was standing in for is the author's own parts, and those are in `blocks`
  // now, which is where the search reads them.
  //
  // ⚠ THREE OF THE FOUR WALLS ARE RICH-ONLY, THE SAME BARGAIN 1d STRIKES. The street face keeps
  // its slot on both lists; the flanks and the back are where 1d hangs plumbing, so they are walls
  // a GLASS 2 frame is already paying for.
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
      // ── ⚠ AND IT SAYS SOMETHING, WHICH FOR A YEAR IT DID NOT ───────────────────────────────────
      //
      // This is the biggest sign fitting in the kit and it carried a pictogram or nothing: measured
      // over 227 models at eight seeds, 68 of these a city were blank and 23 held one small mark
      // stranded in the middle of a billboard. An advertisement with no artwork on it is not a
      // quieter advertisement.
      //
      // ⚠ `$name` IS SAFE HERE AND IS NOT SAFE ON THE BLADE ABOVE, and the blade's own note is what
      // says so: "a board squashes a long name and stays readable; a blade turns one into a column
      // of letters running off the bottom of the building". This is a board — a wide letterbox on a
      // flank, the same shape and the same aspect as the roof hoarding that has carried `$name`
      // since it was written — so it takes the name and `fitSignPts` takes care of the length.
      // `horiz` is what stops it being lettered down a column like its sibling.
      //
      // ⚠ THE MARK STAYS BESIDE IT. `bakeSignText`'s horizontal path sets a pictogram at the left
      // and keeps the middle of what is left for the word, so a fork and a name read as a chophouse
      // from further away than either does alone — and a nameless tile with a mark still gets the
      // mark, because the painter asks per TILE.
      // ── ⚠ AND NOW IT HAS TO ASK WHETHER THE WALL IS BARE, WHICH IT NEVER DID ───────────────────
      //
      // A mark is baked at one square CELL, so a mark-only panel was fitted to about a third of its
      // own width and sat in the middle of a wall it barely touched. A NAME fills the panel — that
      // is the point of it — and the same panel then reaches whatever else is on that flank.
      // `signfit` measured the difference the moment the lettering went on: ten models drawing a
      // pipe, a cable or a stair across their own advertisement, none of them new geometry and none
      // of them visible before, because there was nothing on the panel to draw across.
      //
      // ⚠ `paintFree` AND NOT `clearsFace`. That one is the FACADE's test and answers for the
      // entrance plane only (`c.x ||` passes every flank claim straight through); this asks whether
      // a patch of ANY of the four walls is bare and would be looked at, which is the question a
      // gable end poses. `street` is false: this is the side elevation, and there is no pavement
      // rule to apply to it.
      //
      // ⚠ IT DECLINES ABOUT HALF OF THEM, AND THAT IS THE FITTING WORKING. Measured over 227 models
      // at eight seeds, 96 of these a city became 39 — and the 57 it stands down are the ones whose
      // flank already carries a window bay, a louvre bank or a service riser. The blade above states
      // the same rule in its own words: a sign drawn over a window is worse than a frontage without
      // one, and this is the cheapest part in the kit to decline.
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
  // `models:quality` scores four things and the worst-first board is dominated by one of them:
  // **more than one wall palette**, failed by 22 of 173, with another 26 that are two mass segments
  // or fewer — a box and a lid. Voltage's own authoring note already names the fix and the reason:
  // "the crown takes a different palette so the silhouette carries a light value instead of being
  // one tone top to bottom".
  //
  // The mass is the arms' and stays theirs. What a detail pass can do instead is BAND it, which is
  // how every real building of any period breaks its own height: a plinth where it meets the
  // pavement, a frieze under the cornice. `parapet` already draws exactly that — a four-sided band
  // with a darker face and a lighter cap — and the kit was only ever using it at the roof edge.
  //
  // ⚠ A BAND IS SQUARE-ONLY, because `parapet` takes ONE half-width and uses it on all four sides.
  // That is why the deck coping above filters on `Math.abs(hw - fd) <= 0.02`, and it is not the
  // restriction it looks like: measured over the registry, 163 of 172 models have a square base and
  // 169 a square main box, so this reaches nearly all of them.
  //
  // ⚠ THE PLINTH DOES NOT ASK `wants('cope')` AND THE CROWN DOES. Both are the `parapet` KIND, so
  // the section table cannot tell them apart — but a base course and a cornice are not the same
  // surface, and gating a plinth on whether somebody drew a roof edge is the category error already
  // recorded against `vent`-under-`wall` and the roof sign. Nobody hand-draws a base course; plenty
  // hand-draw a cornice, and a second band just under one of those is a doubled line.
  // ── 6. AND THE LIGHT ON IT ────────────────────────────────────────────────
  //
  // A tube across the top of the ground floor with a return down each end, in the building's own
  // accent. This is the cheapest thing on the whole pass that changes what a street LOOKS like: the
  // 26 models that are a box and a lid cannot be given a silhouette by trim, and they can be given
  // a lit line, which is what the eye actually reads a night street by.
  //
  // ⚠ IT WAS GATED ON AN AUTHORED `m.neon` AND NO LONGER IS, BECAUSE THE REASON EXPIRED. The old
  // note read: "`m.neon` is a colour the model's author chose and 53 of the 173 have one; the rest
  // fall through to the painter's own default, which would put the same cyan on every unstyled shed
  // in Coldwater and make the city look uniform in a NEW way." That was exactly right at the time
  // and it is an argument about the COLOUR, not about the tube — and `accentOf` was written since,
  // which answers a real colour for all 180 off the trade's own mark and the facing material. A bar
  // burns magenta, a clinic cyan-green, a works sodium, with nothing authored.
  //
  // So the tube is rationed instead of gated, which is what "modernise most of them" means here: a
  // lit line along a frontage is the single cheapest thing that makes a street read as this city
  // rather than as a row of boxes, and two thirds of the city could not have one at any price.
  // ⚠ AN AUTHORED `m.neon` STILL WINS THE COLOUR, and a model that has one is never refused the
  // tube — an author who lit their building keeps it lit in every district.
  //
  // ⚠ IT RUNS AT THE FOOT OF THE FRONTAGE, AND THAT IS THE ONLY POSITION WITH NO CONFLICT IN IT.
  // The obvious place is the fascia, above the shopfront — and three separate clearances were
  // written to make that work before the geometry was read properly. It cannot: the name board sits
  // at `GF + 0.036` and the corner blades' own floor is at `GF + 0.02`, so the blades START BELOW
  // THE TOP OF THE BOARD and there is no band between them for a tube to occupy. Every attempt to
  // find one moved the crossing somewhere else — the sign gate reported it on two models, then four,
  // then a different four — because the tube is placed on the BASE box and the blades on the BIGGEST
  // one, which on a podium-and-tower building are different walls at different depths, so lateral
  // clearance on one of them means nothing on the other.
  //
  // A lit line at the foot of a frontage is an ordinary fitting — the plinth strip under the glazing
  // — and it is clear of all of it BY CONSTRUCTION rather than by three numbers agreeing: the board,
  // the canopy and both blades are above `GF`, and this is below it. No returns, because a return
  // hanging off a tube already at the kerb would run into the pavement.
  //
  // ⚠ AND IT IS THE HALF OF THE NEON THAT REACHES THE ROAD. `glWet` reflects lights off wet tarmac
  // and a tube three storeys up contributes almost nothing to that; a line at ankle height is
  // directly above the puddle. The fascia is not left dark either — it already carries the name
  // board's lit ink and, on most frontages, a blade.
  const wantsTube = m.neon ? true : R(403) > gateFor(0.42);
  if (wantsTube && !period && wants('neon') && style !== 'works' && base.hw > 0.1 && bh > 0.08) {
    push({ kind: 'neonRun', cx: A(base.cx), cy: A(by), z: A(base.z0 + Math.min(GF * 0.2, 0.02)),
      half: A(base.hw * 0.92), drop: A(0), color: accentOf(m), pal });
  }
  if (rich && RENDER_TUNE.glCourse !== 0) {
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
}
