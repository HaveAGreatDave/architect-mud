// Can a bird stand where we put it?
//
// Perching gives a flock somewhere off the ground to be, and the ledge it stands on is DERIVED —
// the top of a captured mass segment, minus whatever sits on it. Nothing is authored, so nothing
// can be inspected: the only way to know a parapet is real is to ask the same question the
// aeroplane asks when it flies into the building, which is `modelTopAt`.
//
// ⚠ AND THAT IS THE ONE CHECK HERE THAT CANNOT BE EYEBALLED. A bird placed off the side of a
// building looks, from any distance a bird is visible at, exactly like a bird on the parapet: it is
// a few pixels, it is against the sky, and the wall it should be standing on is right there behind
// it. The bug this gate was written for put a row of pigeons 0.71 tiles out over the street at the
// fourth floor of The Meridian, and it was invisible in the picture — `perchRing` built its ring on
// the CAPTURED centre while `segContains` answers about the tile-FITTED one, and the two differ by
// however far `segFit` slid that box back off its plot line. Restore `V(s.cx)` in place of `f.cx`
// and the sweep below goes from 0 bad points to hundreds.
//
// ⚠ IT SWEEPS THE REAL CITY RATHER THAN THE REGISTRY, which is the opposite of what most gates in
// this directory do and is right here. A ledge is a function of the model AND the tile — the
// entrance facing rotates it, the floor count scales it, and the per-tile seed picks the variant —
// so a model swept at one synthetic scale proves nothing about the building anybody flies past.
// `client/game/flightsim-world.json` is the same baked snapshot `__street` reads.
import { readFileSync } from 'node:fs';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { SPECIES, spOf, perchedNow, perchesHigh, flockSize, flockAt, flockState, speciesAt, placeOf, habitatState, U_GROUND, GOOSE_SETTLE_MS } from '../../client/shared/birds.js';
import { FAUNA_TILE } from '../../client/game/js/panels/fauna3d.js';
import { BIRD_ROWS } from '../../client/shared/fauna-models.js';

const ws = await loadWindshield();
const { buildLedges, kitLedges, wildLedges, perchableDepth, modelTopAt, perchFor, perchSpot, wireLedge, wireSag, perchCap, HUNT_REACH } = ws;
const RT = ws.RENDER_TUNE;
if (process.env.NO_POLES) RT.wirePoles = 0;
// ⚠ THE DOT LOD IS PINNED OFF, for the reason fauna.mjs pins it: this file reads a bird POSITION
// out of the geometry the frame pushed, and past `faunaDot` a bird is a sprite that carries no
// census metadata at all. It does not go missing loudly -- the standing birds simply thin out, and
// the check reports that nothing is perched, which is the same sentence it would print for a
// genuinely broken ledge search. It said exactly that the day the LOD landed: 23 standing birds
// and not one up on anything, on a build whose ledges were fine.
RT.faunaDot = 0;

const world = JSON.parse(readFileSync('client/game/flightsim-world.json', 'utf8'));
const cells = world.cells;
const problems = [];

// A point on a ledge may sit under something up to PERCH_COVER_EPS taller — that is the lip the
// cover test deliberately tolerates — so the agreement is two-sided at that width.
const TOL = 0.016;

// ── 1. EVERY LEDGE IS MASS THAT IS REALLY THERE ──────────────────────────────
let tiles = 0, withLedge = 0, ledgeCount = 0, ptCount = 0, worst = 0, worstAt = '';
let tallest = 0, tallestAt = '';
for (const [k, c] of Object.entries(cells)) {
  if (!c.bt) continue;
  const [wx, wy] = k.split(',').map(Number);
  tiles++;
  let ls = null;
  try { ls = buildLedges(c, wx, wy); } catch (e) { problems.push(`${k} (${c.bn || c.bt}): buildLedges threw — ${e.message}`); continue; }
  if (!ls) continue;
  withLedge++;
  ledgeCount += ls.length;
  for (const l of ls) {
    if (!Number.isFinite(l.z) || !Number.isFinite(l.len)) { problems.push(`${k}: a ledge carries a non-finite z/len`); continue; }
    if (!(l.z > 0)) { problems.push(`${k}: a ledge at z ${l.z}`); continue; }
    if (l.z > tallest) { tallest = l.z; tallestAt = `${c.bn || c.bt} @ ${k}`; }
    for (const p of l.pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.out)) {
        problems.push(`${k}: a perch point carries a non-finite coordinate`); continue;
      }
      ptCount++;
      const top = modelTopAt(wx, wy, c, p.x, p.y, false);
      const d = Math.abs(top - l.z);
      if (d > worst) { worst = d; worstAt = `${c.bn || c.bt} @ ${k}, ledge z ${l.z.toFixed(3)}, mass top ${top.toFixed(3)}`; }
    }
  }
}
if (worst > TOL) problems.push(`a bird is standing on nothing: ${worst.toFixed(3)} tiles out at ${worstAt}`);
if (!withLedge) problems.push('not one building in the city offers a ledge');

// ── 1b. AND A SILL HAS A WALL BEHIND IT ─────────────────────────────────────
//
// ⚠ THE CHECK ABOVE CANNOT SPEAK FOR THESE. A mass ledge is validated against `modelTopAt` —
// the same question the aeroplane asks — and a window sill is not mass: it is a detail surface
// that stands PROUD of the wall, so asking whether an aeroplane collides with it answers no for
// every correct sill in the city. The equivalent question is the one that actually matters, and
// it is the same bug in a different costume: is there a building behind this bird, or is it
// standing in mid-air off the side of one?
//
// So step INWARD from the perch, back through the reveal, and demand the mass there rises at
// least to the sill. A sill on a wall passes by construction; a sill placed off the end of a
// facade, or on a tile whose model does not reach that height, does not.
let kitPts = 0, kitBad = 0, kitWorst = 0, kitWorstAt = "", kitLedgeCount = 0, kitTiles = 0;
let kitOff = 0, kitOffWorst = 0, kitOffAt = "", kitSillLow = 0, kitFlatRing = 0, kitRings = 0;
for (const [k, c] of Object.entries(cells)) {
  if (!c.bt) continue;
  const [wx, wy] = k.split(",").map(Number);
  let ks = null;
  try { ks = kitLedges(c, wx, wy); } catch (e) { problems.push(`${k}: kitLedges threw — ${e.message}`); continue; }
  if (!ks || !ks.length) continue;
  kitTiles++; kitLedgeCount += ks.length;
  for (const l of ks) {
    if (!(l.z > 0) || !Number.isFinite(l.z) || !Number.isFinite(l.len)) { problems.push(`${k}: a kit ledge carries a bad z/len`); continue; }
    // ⚠ A SILL IS THE BOTTOM OF A WINDOW, NOT ITS MIDDLE. `windowBay` takes z as the CENTRE and
    // the sill is the return at z - hh; read as the centre it still has a wall behind it and still
    // sits on the building, so nothing else here would notice — the birds simply stand half a
    // window too high, hanging in the glass.
    if (l.kind === "windowBay" && l.mid != null && !(l.z < l.mid - 1e-6)) kitSillLow++;
    // ⚠ A RING GOES ROUND THE BUILDING, AND THAT IS THE ONE THING THE WALL PROBE CANNOT SEE. Push
    // a coping through the face arithmetic every other part uses and its points come out collinear
    // down the middle of the roof — where there is plenty of mass underneath, so every other check
    // here passes while the birds stand in a line across the deck.
    if (l.ring) {
      kitRings++;
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for (const q of l.pts) { if(q.x<x0)x0=q.x; if(q.x>x1)x1=q.x; if(q.y<y0)y0=q.y; if(q.y>y1)y1=q.y; }
      if (Math.min(x1-x0, y1-y0) < 0.02) kitFlatRing++;
    }
    for (const q of l.pts) {
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.out)) { problems.push(`${k}: a kit perch point is non-finite`); continue; }
      kitPts++;
      // ⚠ AND STANDING ON THE PART, WHICH IS A SEPARATE QUESTION FROM THE WALL. Measured at the
      // mount alone this check is blind to the bird: slide every perch a third of a tile out and
      // the mount is still bolted to its wall. How far the surface reaches is `deep`, so that is
      // how far from the wall plane a bird may be.
      const offW = Math.abs((q.x - (l.mount ? l.mount.x : q.x)) * Math.cos(l.mount ? l.mount.out : 0)
        + (q.y - (l.mount ? l.mount.y : q.y)) * Math.sin(l.mount ? l.mount.out : 0));
      if (l.deep != null && offW > l.deep + 0.01) {
        kitOff++;
        if (offW - l.deep > kitOffWorst) { kitOffWorst = offW - l.deep; kitOffAt = `${c.bn || c.bt} @ ${k}, ${l.kind} reaches ${l.deep.toFixed(3)} and the bird is ${offW.toFixed(3)} out`; }
      }
      // ⚠ MEASURED AT THE MOUNT, NOT AT THE BIRD. A canopy and a balcony are CANTILEVERS — they
      // project over the pavement, so the bird is correctly out past the footprint and a fixed
      // step back from it never reaches the wall. A first cut stepped 0.10 tiles and reported 137
      // floating points, every one of them a canopy doing exactly what a canopy does. The question
      // that matters is whether the part is bolted to anything, so it is asked where it is bolted.
      // ⚠ AT THE MOUNT, NOT A STEP INSIDE IT. Stepping inward looks safer and is not: a stacked
      // building has tiers, and 6 cm through the wall of the tall one lands on the roof of the
      // short one behind it — Dual Aspect reports mass 1.662 at the mount and 1.264 a hair inside,
      // so a sill at 1.510 reads as floating while being bolted to a tower that clears it.
      // ⚠ SEVERAL DEPTHS, AND THE TALLEST WINS. Neither end works alone: exactly AT the mount is
      // a point-in-solid query on the boundary and 1880 points read as outside, while a fixed step
      // inward crosses onto a lower tier on a stacked building. What is being asked is whether
      // there is a wall behind this part that comes up to it, so probe through the thickness of
      // one and take the best answer.
      const mo = l.mount || q;
      const on = mo.out != null ? mo.out : q.out;
      let top = 0;
      for (const back of [0.005, 0.02, 0.05, 0.09, 0.14]) {
        const t = modelTopAt(wx, wy, c, mo.x - Math.cos(on) * back, mo.y - Math.sin(on) * back, false);
        if (t > top) top = t;
      }
      // ⚠ A PART MAY LIFT A BIRD BY ITS OWN THICKNESS, which is the whole point of a coping: it
      // STANDS ON the roof deck, so the mass behind it is its own height below the bird and a
      // flat comparison calls every correct coping in the city floating. What is not allowed is
      // clearing the mass by more than the part is deep — that is a band with nothing under it.
      const shortBy = l.z - top - (l.deep || 0);
      if (shortBy > 0.02) {
        kitBad++;
        if (shortBy > kitWorst) { kitWorst = shortBy; kitWorstAt = `${c.bn || c.bt} @ ${k}, sill z ${l.z.toFixed(3)}, wall behind it ${top.toFixed(3)}`; }
      }
    }
  }
}
// ⚠ A FLAT WINDOW IS REFUSED, ASKED DIRECTLY. Every bay in this city has a 9 cm reveal or better,
// so the minimum-depth floor changes no number in the sweep above and its deletion is invisible
// there — the rule has to be interrogated rather than inferred.
if (perchableDepth(0)) problems.push("a window painted flat on a wall counts as a perch");
if (perchableDepth(0.002)) problems.push("a 2 cm reveal counts as a perch — no bird stands on that");
if (!perchableDepth(0.02)) problems.push("a 22 cm sill is refused — the floor is set too high to be real");

if (kitOff) problems.push(`${kitOff} of ${kitPts} kit perch points stand off the end of the part — worst ${kitOffWorst.toFixed(3)} tiles at ${kitOffAt}`);
if (kitFlatRing) problems.push(kitFlatRing + " coping rings are collinear — they are being laid across the roof instead of round it");
if (kitSillLow) problems.push(`${kitSillLow} window perches are not on the sill — they sit at or above the bay centre`);

if (kitBad) problems.push(`${kitBad} of ${kitPts} kit perch points have no wall behind them — worst ${kitWorst.toFixed(3)} tiles at ${kitWorstAt}`);
// ⚠ COUNTED SEPARATELY FROM THE REST OF THE KIT. Face parts and rings are two different code
// paths, and the face ones far outnumber them — so "the kit offers something" stays true with
// every coping in the city silently dropped.
if (!kitRings) problems.push("no coping ring anywhere is offered as a perch — parapets are not being read");
if (!kitLedgeCount) problems.push("the detail kit offers no perches at all — sills, balconies, awnings and copings are not being read");

// ── 1c. AND THE BADLANDS HAS SOMETHING TO STAND ON ──────────────────────────
//
// The hawk is the reason this exists: the highest perch share in the table, a design built round
// a still-hunter on a vantage, and 100% of its life on the ground because its habitat has no
// buildings in it. A hoodoo is real geometry the painter already puts there, so the only question
// is whether the bird is standing on the part of it that exists.
let wildTiles = 0, wildCount = 0, wildBadProf = 0, wildTiny = 0, wildOffTile = 0, wildOdd = 0;
let redrockTiles = 0;
const WILD_OK = new Set(["capped", "sheared", "stump"]);
// The painter cannot make a spire outside this band: HOODOO_H x its own 0.58-1.63 roll x the
// tallest and shortest kind scalings. A perch beyond it is not on anything the painter drew.
const H_LO = 0.19 * 0.58 * 0.44, H_HI = 0.19 * 1.63 * 1.06;
for (const [k, c] of Object.entries(cells)) {
  const [wx, wy] = k.split(",").map(Number);
  let L = null;
  try { L = wildLedges(c, wx, wy); } catch (e) { problems.push(`${k}: wildLedges threw — ${e.message}`); continue; }
  if (c.biome === "redrock" && !c.bt && !c.road) redrockTiles++;
  if (!L || !L.length) continue;
  wildTiles++; wildCount += L.length;
  for (const l of L) {
    // ⚠ NEVER A POINT OR A BLADE. `spire` tapers to nothing and `fin` is a wall remnant; a bird
    // on either is balanced on an edge, and both are a majority of what a badland actually grows.
    if (!WILD_OK.has(l.prof)) wildBadProf++;
    // Wide enough to stand on, by the same rule a window sill is held to.
    if (!perchableDepth(l.topR * 2)) wildTiny++;
    if (!(l.z >= H_LO - 1e-6 && l.z <= H_HI + 1e-6)) wildOdd++;
    // ⚠ AND ON ITS OWN TILE. The spire is offset within the tile and its top is displaced again
    // by the lean; get either sign wrong and the rock is drawn here while the bird stands next
    // door. 0.27 is the offset half-range, plus the lean, plus the cap.
    for (const q of l.pts) {
      if (Math.abs(q.x - wx) > 0.55 || Math.abs(q.y - wy) > 0.55) { wildOffTile++; break; }
    }
  }
}
// ⚠ A FIELD, NOT A SPRINKLE — and this is the one wasteland check that is about the PAINTER
// rather than about the perch. The spires stand in companies with long bare stretches between,
// which is what the patch field in `wildLedges` reproduces; drop that roll and a perch appears on
// every eligible tile while the rock is only drawn on some, so the hawk stands on open
// ground that merely could have had something on it. Nothing else here would notice.
if (redrockTiles && wildTiles / redrockTiles > 0.25) problems.push(
  Math.round(wildTiles / redrockTiles * 100) + "% of redrock tiles offer a perch — the hoodoo patch field is not being applied");

if (!wildCount) problems.push("the open country offers no perch at all — the hawk has nowhere to hunt from");
if (wildBadProf) problems.push(`${wildBadProf} wasteland perches are on a spire tip or a fin edge`);
if (wildTiny) problems.push(`${wildTiny} wasteland perches are too narrow for a bird to stand on`);
if (wildOdd) problems.push(`${wildOdd} wasteland perches are at a height the painter cannot draw a spire at`);
if (wildOffTile) problems.push(`${wildOffTile} wasteland perches are off their own tile`);

// ── 2. A STEPPED TOWER HAS STEPPED LEDGES ────────────────────────────────────
//
// The point of the whole feature: a ziggurat's setbacks are perches at several heights, for free,
// because each tier's top ring is the part of it the tier above does not cover. If this collapses
// to one ledge the derivation has stopped seeing setbacks and is only finding roofs.
const MERIDIAN = Object.entries(cells).find(([, c]) => c.bn === 'The Meridian - Lobby');
if (!MERIDIAN) problems.push('The Meridian is not in the baked world — re-run `npm run snapshot:flight`');
else {
  const [mk, mc] = MERIDIAN;
  const [mx, my] = mk.split(',').map(Number);
  const ls = buildLedges(mc, mx, my) || [];
  const heights = [...new Set(ls.map((l) => Math.round(l.z * 100) / 100))].sort((a, b) => a - b);
  if (heights.length < 4) problems.push(`The Meridian offers ${heights.length} distinct ledge heights, wanted at least 4 — the setbacks are not being seen`);
  const big = ls.filter((l) => l.len > 0.9);
  if (big.length < 3) problems.push(`The Meridian offers ${big.length} ledges long enough for a flock, wanted at least 3`);
}

// ── 3. WHO PERCHES, AND WHERE ────────────────────────────────────────────────
if (SPECIES.goose.perch) problems.push('a goose perches — it is a ground and water bird and must not');
for (const id of ['pigeon', 'songbird', 'gull', 'hawk']) {
  if (!SPECIES[id].perch || !SPECIES[id].perch.share) problems.push(`${id} never perches`);
}
if (!perchesHigh({ ax: 1, ay: 1, sp: 'hawk' })) problems.push('a hawk does not take the highest perch — the hunt is the whole reason it has one');
if (perchesHigh({ ax: 1, ay: 1, sp: 'pigeon' })) problems.push('a pigeon insists on the highest perch');

// The share is a probability over cycles, so it has to come out near what the row claims or the
// species is effectively always up or never up whatever the table says.
for (const id of ['pigeon', 'hawk']) {
  let up = 0; const N = 3000;
  for (let i = 0; i < N; i++) if (perchedNow({ ax: 880 + (i % 71), ay: 890 + ((i * 13) % 67), sp: id }, 1e12 + i * 37000)) up++;
  const got = up / N, want = SPECIES[id].perch.share;
  if (Math.abs(got - want) > 0.05) problems.push(`${id} perches on ${(got * 100).toFixed(0)}% of cycles against an authored ${(want * 100).toFixed(0)}%`);
}

// ── 4. A HUNTER TAKES THE HIGHEST, AND A FLOCK GETS ROOM ─────────────────────
//
// Built against a real street rather than a synthetic one, for the reason at the top of the file.
// The window this gate hands perchFor. It must hold everything perchFor is allowed to search, or
// the hunter is being judged on a map smaller than its own reach and the clipping is silent.
const R = 6;
if (R < HUNT_REACH) problems.push(`this gate hands perchFor an R=${R} window while a hunter reaches ${HUNT_REACH} tiles`);
const mapAround = (cx, cy) => Array.from({ length: R * 2 + 1 }, (_, j) =>
  Array.from({ length: R * 2 + 1 }, (_, i) => cells[(cx + i - R) + ',' + (cy + j - R)] || { kind: 'land', biome: 'citycore' }));

// Somewhere with a tall building next to a standable tile: the street outside The Meridian.
let anchors = [];
for (const [k, c] of Object.entries(cells)) {
  if (c.bt || c.road) continue;
  const [wx, wy] = k.split(',').map(Number);
  let has = false;
  for (let dy = -1; dy <= 1 && !has; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const n = cells[(wx + dx) + ',' + (wy + dy)];
    if (n && n.bt) { has = true; break; }
  }
  if (has) anchors.push([wx, wy]);
}
if (anchors.length < 20) problems.push(`only ${anchors.length} standable tiles in the city have a building next door`);

let placed = 0, highWrong = 0, roomShort = 0, roomPossible = 0, rimOK = 0, rimUntested = 0, rimControl = 0;
for (const [wx, wy] of anchors.slice(0, 240)) {
  const map = mapAround(wx, wy);
  for (const sp of ['pigeon', 'hawk']) {
    const fl = { ax: wx, ay: wy, sp };
    const L = perchFor(map, R, wx, wy, fl, perchesHigh(fl));
    if (!L) continue;
    placed++;
    // Determinism — the same flock, asked twice, is on the same ledge.
    //
    // ⚠ SAME LEDGE MEANS THE SAME PLACE, NEVER THE SAME OBJECT, and this asked for the object for
    // months. `ledgesFor` memoises per tile and empties the WHOLE cache at its 192-entry bound, so
    // a sweep that walks more tiles than that straddles a wipe: the second call rebuilds, hands back
    // a fresh object with identical numbers in it, and an identity test calls that non-determinism.
    // It failed on exactly one tile of 240 for that reason, which is the shape of the finding --
    // whether it fires depends on where the tile falls relative to the wipe, not on anything
    // perchFor did. A ledge is its height and its standing points; nothing downstream holds one
    // across a frame or compares two by reference.
    const L2 = perchFor(map, R, wx, wy, fl, perchesHigh(fl));
    const sameLedge = L2 && L2.z === L.z && L2.len === L.len && L2.pts.length === L.pts.length
      && L2.pts.every((q, i) => q.x === L.pts[i].x && q.y === L.pts[i].y && q.out === L.pts[i].out);
    if (!sameLedge) problems.push(`${wx},${wy} ${sp}: perchFor is not deterministic`);
    // ⚠ AND THE SAME LEDGE WHEN THE MAP WINDOW MOVES UNDER IT, which is a different question from
    // determinism and is the one that was wrong. `perchFor` reads `map[wy - wcy + R]?.[wx - wcx + R]`
    // over the flock's anchor AND ITS EIGHT NEIGHBOURS, and `?.` on a tile outside the window is a
    // silent skip — so the pool, and with it `total`, the length-weighted pick and the spill list,
    // were a function of where the CAMERA was. Asked twice from one window it answered the same
    // thing every time and passed the check above; asked from two windows it moved the whole flock
    // to another ledge between frames, with the birds never crossing the gap. That is the "birds on
    // a wire seem to be flashing around", and no check here could see it because both calls shared
    // a window. This one recentres by a tile, which is what a frame of driving does.
    //
    // ⚠ THE WINDOW MOVES, THE FLOCK DOES NOT — so the flock is asked about from an OFF-CENTRE
    // window, which is the only arrangement the game ever uses. Every call above sits the anchor at
    // the exact centre, where the 3x3 is inside the window whatever R is, so a centred harness is
    // blind to this by construction. Slid toward the rim, the missing tiles start appearing.
    //
    // ⚠ AND IT IS ONLY ASKED OUT TO THE MARGIN THE RENDERER ITSELF KEEPS. windshield.js gathers
    // flocks at `R - 1` precisely so a reach-1 pool is always whole; testing past that would be
    // testing a case the renderer no longer produces, and would fail on correct code. The hunter's
    // six-tile reach needs a margin this harness cannot give it at R = HUNT_REACH — see the note
    // under `slack` — so it is measured and reported rather than asserted.
    const reach = perchesHigh(fl) ? HUNT_REACH : 1;
    const slack = R - 1 - reach;   // how far the renderer still lets the window slide off this flock
    for (let d = 1; d <= slack; d++) {
      const L3 = perchFor(mapAround(wx + d, wy), R, wx + d, wy, fl, perchesHigh(fl));
      const same = L3 && L3.z === L.z && L3.len === L.len && L3.pts.length === L.pts.length;
      if (!same) { problems.push(`${wx},${wy} ${sp}: perchFor moved the flock to another perch with the window slid ${d} tile(s) off it, inside its own ${reach}-tile reach — the pool is camera-dependent`); break; }
      rimOK++;
    }
    if (slack < 1) rimUntested++;
    // ⚠ AND THE SAME QUESTION ONE TILE PAST THE MARGIN, WHICH MUST STILL MOVE. Everything above is
    // a check that passes, and a check that passes proves nothing on its own — the margin could be
    // removed, or `perchFor` could stop reading the map at all, and the loop would go on reporting
    // green. So the control is measured rather than assumed: slid far enough to clip the pool, the
    // answer is expected to CHANGE, and if it never does the check above has gone vacuous and is
    // reported as a failure in its own right. Measured at the fix: 99.2% of flocks move (or lose
    // their perch entirely) at the rim, and 0.0% inside the margin.
    const past = perchFor(mapAround(wx + R, wy), R, wx + R, wy, fl, perchesHigh(fl));
    if (!(past && past.z === L.z && past.len === L.len)) rimControl++;
    // the pool this flock could have had
    // ⚠ BUILDINGS ONLY, AND THAT IS THE POINT RATHER THAN A SIMPLIFICATION. A hunter is the one
    // bird that will not use a wire (see `perchFor`), so the highest perch a hawk can reach IS the
    // highest ledge on the buildings around it, and counting spans here would let a hawk sitting on
    // a telegraph pole pass a check named for the opposite behaviour.
    //
    // ⚠ AND IT REACHES AS FAR AS THE RULE DOES. A hunter searches `HUNT_REACH` tiles and everything
    // else searches its eight neighbours, so a pool fixed at one radius is a SECOND opinion about
    // what "in reach" means -- and the cheap direction is the dangerous one: held to the neighbours
    // while perchFor looked six tiles out, this reported the hawk taking a LOWER perch than it could
    // reach on 218 streets, every one of them the hunter correctly taking a tower the pool could not
    // see.
    // (`reach` is declared once above, by the rim check, and serves both — same expression.)
    // ⚠ INCLUDING THE OPEN GROUND, AND INCLUDING THE FLOCK'S OWN TILE.  offers hoodoo
    // tops and counts the tile the flock is standing on for them; a pool that looked only at the
    // eight neighbouring BUILDINGS reported the hunter taking a lower perch than it could reach on
    // 12 streets, every one of them a hawk correctly on a rock this could not see.
    const pool = [];
    { let g = null; try { g = wildLedges(cells[wx + "," + wy], wx, wy); } catch { g = null; }
      if (g) pool.push(...g); }
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      if (!dx && !dy) continue;
      const c = cells[(wx + dx) + ',' + (wy + dy)];
      if (!c) continue;
      // ⚠ OPEN GROUND IS PART OF THE POOL NOW, AND IT IS BEHIND A `continue`. This walked buildings
      // only, which was exact while every perch was on one — a hoodoo is on bare redrock, so the
      // guard that used to mean "nothing to stand on here" now skips the very tiles the hunter is
      // hunting over. It reported the hawk taking a lower perch than it could reach on 12 streets,
      // every one of them the bird correctly on a rock this could not see.
      let gs = null; try { gs = wildLedges(c, wx + dx, wy + dy); } catch { gs = null; }
      if (gs) pool.push(...gs);
      if (!c.bt) continue;
      const ls = buildLedges(c, wx + dx, wy + dy);
      if (ls) pool.push(...ls);
      // ⚠ THE KIT IS PART OF "THE HIGHEST IT COULD REACH". Leaving it out here while perchFor
      // offers it is the same second-opinion bug the reach had: the hunter correctly takes a
      // balcony and a pool that cannot see balconies calls it a lower perch than it could reach.
      let ks = null; try { ks = kitLedges(c, wx + dx, wy + dy); } catch { ks = null; }
      if (ks) pool.push(...ks);
    }
    if (!pool.length) continue;
    const maxZ = Math.max(...pool.map((l) => l.z));
    if (perchesHigh(fl) && Math.abs(L.z - maxZ) > 1e-9) highWrong++;
    const n = Math.max(1, flockSize(fl));
    const fits = pool.filter((l) => l.len >= n * 0.03);
    if (fits.length) { roomPossible++; if (L.len < n * 0.03) roomShort++; }
    // and the birds land on the ledge they were given
    for (let i = 0; i < n; i++) {
      const s = perchSpot(L, fl, i, n, 1.7e12, 0);
      const on = L.pts.some((p) => Math.abs(p.x - s.x) < 1e-9 && Math.abs(p.y - s.y) < 1e-9);
      if (!on) { problems.push(`${wx},${wy} ${sp}: bird ${i} is not standing on a point of its own ledge`); break; }
    }
  }
}
// ── THE POLES ────────────────────────────────────────────────────────────────
//
// A span used to need a facade on BOTH sides, which is a downtown canyon and almost nowhere
// else. A pole carries the far end where the far side is a yard, a lot or a park.
//
// ⚠ THE INVARIANT IS THAT THE FLAG IS A NO-OP ON EVERY WALL-TO-WALL SPAN. A pole end makes the
// second axis of a tile matchable, and `wireLedge` used to return on the first axis that matched
// -- so without care a poled 0.46 span silently replaces the 0.8 wall span the tile already had.
// That is exactly how this landed the first time, and the check that finds it is not "are there
// poles" but "did anything that was already there MOVE".
let poleNote = '';
const allWires = [];
const notesPole = [];
const poleRows = [];
let wallSpans = 0, moved = 0;
for (const [wx, wy] of anchors.slice(0, 240)) {
  const map = mapAround(wx, wy);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = wx + dx, y = wy + dy;
    const c = cells[x + ',' + y];
    if (!c || c.bt) continue;
    RT.wirePoles = 1; const on = wireLedge(map, R, wx, wy, x, y);
    RT.wirePoles = 0; const off = wireLedge(map, R, wx, wy, x, y);
    RT.wirePoles = 1;
    if (off) {
      wallSpans++;
      const same = on && on.z === off.z && on.wire.x0 === off.wire.x0 && on.wire.x1 === off.wire.x1
        && on.wire.y0 === off.wire.y0 && on.wire.y1 === off.wire.y1;
      if (!same) moved++;
      if (on) allWires.push(on);
    } else if (on && (on.wire.pole0 || on.wire.pole1)) {
      allWires.push(on);
      poleRows.push(on);
    }
  }
}
if (moved) problems.push(`the poles moved ${moved} of ${wallSpans} spans that already ran wall to wall`);
if (!poleRows.length) problems.push('no span anywhere in the city is carried on a pole');

else {
  const bad = poleRows.filter((l) => l.wire.pole0 && l.wire.pole1);
  if (bad.length) problems.push(`${bad.length} spans are poles at BOTH ends, which nothing authors`);
  const zs = poleRows.map((l) => l.wire.z);
  poleNote = (`poles: ${poleRows.length} spans carried on one, hung ${Math.min(...zs).toFixed(2)}-${Math.max(...zs).toFixed(2)} tiles up, `
    + `beside ${wallSpans} that run wall to wall and did not move.`);
}

// ⚠ A WIRE LOADED TO ITS OWN CAP MUST STILL BE A WIRE OVER A ROAD. The sag is solved rather
// than chosen (wL^2/8T), which is worth doing and means the LOAD has to be real too -- and the
// cap was a multiple of a parapet's spacing rather than anything about a bird, so it allowed
// FIFTY A METRE. 552 starlings on an eleven-metre span sag it 0.312 tiles off a 0.253-tile hang:
// the cable and every bird on it hung through the carriageway. Nothing said a word, because each
// half was defensible on its own and no check held the two against each other.
// ⚠ THE BOTTOM CABLE, LOADED, AGAINST WHAT DRIVES UNDER IT. Three separate things have to be
// held together and checking any two of them passes: how many birds a span takes, how far the
// load bends it, and how far the LOWEST of the run started off the road. A truck is the tallest
// thing on that road and 0.0842 tiles is how tall GLASS draws one.
const TRUCK_H = 0.0842;
const WANT_CLEAR = TRUCK_H * 2.0;   // the renderer's own WIRE_CLEAR_TRUCKS
let worstRatio = 0, worstWire = null, sagBad = 0;
for (const L of allWires) {
  const lines = Math.max(1, L.wire.lines || 1);
  const bottom = L.wire.z - (lines - 1) * 0.026;
  const full = wireSag(L.wire.span, perchCap(L) / lines);   // per cable, as the draw shares it
  if (bottom - full < WANT_CLEAR) sagBad++;
  if (full / bottom > worstRatio) { worstRatio = full / bottom; worstWire = L; }
}
if (sagBad) problems.push(`${sagBad} of ${allWires.length} spans hang their lowest cable into the traffic when full`);
if (worstWire) {
  const lw = Math.max(1, worstWire.wire.lines || 1);
  const bot = worstWire.wire.z - (lw - 1) * 0.026;
  notesPole.push(`loaded: the worst of ${allWires.length} spans carries ${perchCap(worstWire)} birds on ${lw} cables, `
    + `bends its lowest ${(worstRatio * 100).toFixed(0)}% of the way down and still passes `
    + `${(bot - wireSag(worstWire.wire.span, perchCap(worstWire) / lw) - TRUCK_H).toFixed(3)} tiles over a lorry.`);
}

if (highWrong) problems.push(`a hunter took a lower perch than it could reach on ${highWrong} streets`);
if (roomShort) problems.push(`a flock was put on a ledge too small for it on ${roomShort} of ${roomPossible} streets that had a bigger one`);
if (placed && !rimOK) problems.push('the rim check never ran — no flock had any margin to slide the window across, so nothing here defends the perch pool against the camera');
if (rimOK && !rimControl) problems.push('the rim check is vacuous — no flock changed its perch even with the window slid clear off its pool, so the margin is not what is holding it steady');

if (!placed) problems.push('no flock anywhere in the city found a ledge');

// ── 5. THE FLAG PUTS THE CITY BACK ON THE DECK ───────────────────────────────
//
// ⚠ THE FLAG GOVERNS THE RENDERER AND NOT THE RULE. `perchedNow` is shared with the room
// description and goes on answering yes at 0 — what must stop is the renderer going looking for a
// ledge, which is the same branch as a flock over a field with no buildings round it.
const heldPerch = RT.birdPerch;
RT.birdPerch = 0;
const stillPerched = perchedNow({ ax: 918, ay: 909, sp: 'pigeon' }, 1e12) || perchedNow({ ax: 919, ay: 909, sp: 'pigeon' }, 1e12);
RT.birdPerch = heldPerch;
if (!stillPerched) problems.push('the shared rule stops answering when the renderer flag is off — the room and the window would disagree');

// ── 6. AND A BIRD IS ACTUALLY DRAWN UP THERE ─────────────────────────────────
//
// Everything above is about the RULE and about the GEOMETRY. This is the only check that runs a
// frame, and it earns its keep because there are four steps between a correct ledge and a bird
// standing on one, each of which fails silently: the flock has to exist at all (a density roll), it
// has to be in its ground phase, `drawGeese` has to go looking for a ledge, and the height has to
// survive into the mesh. A parapet nothing ever stands on is the same outcome as no feature.
//
// ⚠ IT CAUGHT ONE ALREADY, AND NOT IN THIS FILE'S CODE. `settle` eases a flock out of the formation
// it landed in, and it was measuring that window against `U_GROUND` — the GOOSE's ground share —
// for every species. Past that constant the take-off term goes negative, clamps, and pins `settle`
// at 1 for the rest of the phase: a pigeon (uGround 0.78) stood frozen in its landing skein for
// 50.2% of its time on the ground. The perch arrives as the settle departs, so it also meant the
// ledge height was multiplied by zero exactly when the birds should have been on it.
//
// ⚠ THE CLOCK IS PINNED AND THE MOMENT IS SEARCHED FOR, never assumed. Every flock has its own
// period and phase and the perch roll is per CYCLE, so no fixed timestamp is guaranteed to catch a
// perched one, and a gate that quietly found nothing to look at would pass for ever.
//
// ⚠ AND THE DENSITY IS CRANKED. At the shipping density a street holds a flock about one tile in
// seventy — 2 of 136 candidates measured over the built city — which is right for the game and
// useless here, where it would make this a coin flip on what the window happened to cover.
// ⚠ THE DENSITY IS RAISED BUT NOT FAR. At the shipping density a street holds a flock about one
// tile in seventy (2 of 136 candidates measured over the built city), which is right for the game
// and would make this a coin flip on what the window covered. Too HIGH is its own trap: the face
// budget draws nearest-first, so at 8 the flocks between the camera and the site spend the whole
// allowance and the flock this moment was chosen for is never drawn at all — which reads exactly
// like the perch not working.
const DENS = 3;
const realNow = Date.now;
const held = { geese: RT.geese, gl: RT.gl, floor: RT.glFloor, perch: RT.birdPerch };
let e2eUp = 0, e2eDown = 0, e2eSite = '';
try {
  RT.geese = DENS; RT.gl = 1; RT.glFloor = 1; RT.birdPerch = 1;
  const R2 = 12;
  const win2 = (cx, cy) => Array.from({ length: R2 * 2 + 1 }, (_, j) =>
    Array.from({ length: R2 * 2 + 1 }, (_, i) => cells[(cx + i - R2) + ',' + (cy + j - R2)] || { kind: 'land', biome: 'citycore' }));
  const win = (cx, cy) => Array.from({ length: R2 * 2 + 1 }, (_, j) =>
    Array.from({ length: R2 * 2 + 1 }, (_, i) => cells[(cx + i - R2) + ',' + (cy + j - R2)] || { kind: 'land', biome: 'citycore' }));

  // ⚠ THE SITE IS PREFERENTIALLY ONE WHERE THE PLACE AND THE PAINT DISAGREE, which is the only way
  // this check can see the other bug the perch work turned up. `drawGeese` chose its anchors through
  // `placeAt` (which counts buildings and answers 'citycore') and then filtered them on the raw
  // terrain the tile is PAINTED — and Coldwater's streets are painted `redrock`, which is in no
  // species' habitat table, so a pigeon on a street was anchored and then silently dropped. A test
  // site on parkland passes either way and says nothing about it.
  let site = null, fallback = null;
  for (const [wx, wy] of anchors) {
    const c = cells[wx + ',' + wy];
    if (!c.biome) continue;
    let bld = 0, shore = false, anyLedge = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nn = cells[(wx + dx) + ',' + (wy + dy)];
      if (!nn) continue;
      if (nn.bt) { bld++; if (buildLedges(nn, wx + dx, wy + dy)) anyLedge = true; }
      if (nn.kind === 'water') shore = true;
    }
    if (!bld || !anyLedge) continue;
    const sid = speciesAt(placeOf(c.biome, bld, shore), wx, wy, {});
    if (!sid || !SPECIES[sid].perch) continue;
    const fl = flockAt(wx, wy, DENS, sid);
    if (!fl) continue;
    // A perched ground phase, clear of the settle at both ends — the flock has to have finished
    // arriving, or the ledge is still fading in and the height under test is only partial.
    //
    // ⚠ AND PAST `U_GROUND`, WHICH IS THE HALF THAT MAKES THIS CHECK WORTH ANYTHING. The settle bug
    // in the note above only bites where a species' ground phase runs past the GOOSE's share, so a
    // moment chosen in the first 0.40 of the phase dodges it — a first cut of this search picked
    // `uG * 0.45`–`0.65`, which for a songbird is 0.25–0.36, and the mutant with `U_GROUND` put back
    // sailed through. Ask for a moment where the two formulas actually disagree.
    const uG = SPECIES[sid].uGround;
    const wantLate = uG > U_GROUND + 0.05;
    for (let k = 0; k < 8000; k++) {
      const t = 1.7e12 + k * 700;
      const st = flockState(fl, t);
      if (st.airborne || !perchedNow(fl, t)) continue;
      if (wantLate && st.u <= U_GROUND + 0.02) continue;
      // the settle as it SHOULD be computed, so "clear of both edges" means clear of them
      const uSettle = Math.min(uG * 0.45, GOOSE_SETTLE_MS / st.period);
      const edge = Math.min(st.u, uG - st.u);
      if (edge < uSettle * 1.6) continue;
      // ⚠ AND THE FLOCK MUST ACTUALLY GET A LEDGE. "A neighbour has one somewhere" is not the same
      // question `perchFor` answers — it pools eight neighbours, filters by whether the ledge can
      // hold this many birds and weights the pick by length — so a site chosen on the weaker test
      // can land on a building whose only ledges are too small, and the render check then reports
      // the feature broken when it is the site that is wrong.
      const probe = perchFor(win2(wx, wy), R2, wx, wy, fl, perchesHigh(fl));
      if (!probe) continue;
      const place = placeOf(c.biome, bld, shore);
      const strict = !!habitatState(sid, place) && !habitatState(sid, c.biome);
      const found = { wx, wy, sid, t, strict, place, paint: c.biome };
      if (strict) { site = found; } else if (!fallback) { fallback = found; }
      break;
    }
    if (site) break;
  }
  site = site || fallback;
  if (site && !site.strict) {
    problems.push(`the render site (${site.sid} at ${site.wx},${site.wy}) is painted ${site.paint}, which is already in its habitat table — nothing in the city exercised the place-vs-paint filter`);
  }

  if (!site) problems.push('no street in the city had a perched flock on it to render');
  else {
    e2eSite = `${site.sid} at ${site.wx},${site.wy}`;
    Date.now = () => site.t;
    // ⚠ `stubCanvas` REGISTERS THE ID, and without it nothing happens and nothing says so.
    // `paintWindshield`'s first two lines are a `getElementById` and a clientWidth check, and the
    // stub answers null for an id it has not been told about — so the whole world pass returns
    // before it starts, the GL hook is never called, `o.fauna` is never filled, and the frame
    // reports zero birds. Which reads exactly like a perch feature that is not working.
    stubCanvas('__perch', 480, 300);
    const cv = globalThis.document.createElement('canvas');
    cv.width = 480; cv.height = 300;
    // ⚠ THE CAMERA STANDS BACK FROM THE FLOCK, and this is not framing. `drawGeese` culls anything
    // inside VISIBLE_NEAR_F, so a camera parked on the anchor tile itself throws away the very birds
    // it was pointed at — the first cut of this check reported "no standing birds at all" for a
    // flock that was being placed perfectly.
    const CAM = { x: site.wx, y: site.wy + 3 };
    const view = { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.3, speed: 0,
      hour: 11, weather: 'clear', heading: 0, map: win(CAM.x, CAM.y),
      mapCenter: { ...CAM }, mapOffset: { x: 0, y: 0 },
      resFloor: 1, tune: { gl: 1, perfDS: 0 } };
    const run = () => {
      let got = [], totalFaces = 0;
      ws.installGLWorld((glCells, cam, o) => {
        const mesh = o.fauna || [];
        totalFaces = mesh.length;
        // ⚠ ONE BIRD IS A RUN OF FACES BETWEEN TWO MARKERS. `pushFauna` pushes an animal's faces
        // consecutively and tags only the first, so the run is the animal — which is how the width
        // below can be measured at all without the renderer handing one over.
        got = [];
        let cur = null;
        for (const f of mesh) {
          if (f.bird) { cur = { ...f.bird, lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] }; got.push(cur); }
          if (!cur) continue;
          for (const v of f.p) {
            if (v[0] < cur.lo[0]) cur.lo[0] = v[0];
            if (v[1] < cur.lo[1]) cur.lo[1] = v[1];
            if (v[0] > cur.hi[0]) cur.hi[0] = v[0];
            if (v[1] > cur.hi[1]) cur.hi[1] = v[1];
          }
        }
        for (const b of got) b.width = Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1]);
        return { faces: 1, canvas: cv };
      });
      ws.paintWindshield('__perch', view);   // settle the lazy bakes
      ws.paintWindshield('__perch', view);   // …and read the settled frame
      ws.installGLWorld(null);
      got.totalFaces = totalFaces;
      return got;
    };
    const birds = run();
    const standing = birds.filter((b) => b.state !== 'air');
    e2eUp = standing.filter((b) => b.z > 0.10).length;
    e2eDown = standing.length - e2eUp;
    if (!standing.length) problems.push(`the frame drew no standing birds at all (${e2eSite})`);
    else if (!e2eUp) problems.push(`${standing.length} birds are standing and not one is up on anything (${e2eSite})`);
    // ⚠ AND THE FLOCK THIS MOMENT WAS CHOSEN FOR HAS TO BE ONE OF THEM. A window holds several
    // flocks and the moment was searched against ONE of them, so a frame-wide "is anybody up" passes
    // on somebody else's birds — which is exactly how the settle mutant walked through this check:
    // the site species was pinned at the wrong phase and the pigeons two streets over were fine.
    const mine = standing.filter((b) => b.sp === site.sid
      && Math.hypot((b.x + CAM.x) - site.wx, (b.y + CAM.y) - site.wy) < 2.5);
    if (mine.length && !mine.some((b) => b.z > 0.10)) {
      problems.push(`the ${site.sid} flock at ${site.wx},${site.wy} is the one this moment was chosen for and all ${mine.length} of its birds are on the deck`);
    }
    // ⚠ AND EVERY BIRD IS THE SHAPE IT SAYS IT IS. `pushFauna` took a literal 'goose' for the species
    // until this feature went in, so every pigeon, gull, songbird, hawk and vulture in the world was
    // built out of the goose mesh, while the face BUDGET was charged per species and the prose named
    // the right bird. That is the bug this counts for.
    //
    // ⚠ AND IT MEASURES THE MESH, NEVER THE MARKER. `faces[0].bird.sp` is written from the same `sid`
    // the loop already has, so it goes on reporting 'songbird' for a bird built entirely out of goose
    // parts — the first cut of this check compared the marker and the mutant sailed through.
    //
    // ⚠ SIZE RATHER THAN FACE COUNT, for the same reason. A goose is 64 faces and a songbird 51, so
    // a total looks like it would separate them and does not: an air pose is built by `faunaPose`
    // and its count is not the `faunaFaces(…, 1)` the budget estimates with. What cannot be argued
    // with is how BIG the animal is — a songbird's span is 0.155 against a goose's 0.85.
    //
    // ⚠ AND IT IS A RATIO, NEVER AN ABSOLUTE WIDTH. A bounding box round a posed bird takes in the
    // tail and whatever the wings are doing, so it is reliably WIDER than the row's span (measured
    // about 1.8x for a standing songbird) and pinning that factor would be pinning today's pose
    // table. What has to hold is that the widths are PROPORTIONAL to the spans: with every bird
    // built out of one mesh they are all the same size instead, and the ratio falls apart. It needs
    // two species in frame to say anything, so it says so when it has only one.
    const sized = birds.filter((b) => b.width > 0 && BIRD_ROWS[b.sp]?.span);
    const byKind = new Map();
    for (const b of sized) {
      const k = b.width / (BIRD_ROWS[b.sp].span * FAUNA_TILE);
      const e = byKind.get(b.sp) || [];
      e.push(k); byKind.set(b.sp, e);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const ks = [...byKind.entries()].map(([sp, a]) => ({ sp, k: med(a) }));
    if (ks.length < 2) problems.push(`only ${ks.length} species in the test frame — the mesh-per-species check cannot say anything`);
    else {
      const lo = ks.reduce((m, r) => (r.k < m.k ? r : m)), hi = ks.reduce((m, r) => (r.k > m.k ? r : m));
      // ⚠ 2.6 SITS IN A MEASURED GAP, not at a round number. A bounding box round a posed bird is
      // a different multiple of its span for each species (measured in a correct build: pigeon 1.08,
      // goose 1.15, vulture 1.52, songbird 1.84 — a spread of 1.70), and with every bird built out of
      // the goose mesh the same frame reads 1.02 / 1.15 / 2.07 / 6.68, a spread of 6.55. Anything
      // between the two separates them; re-measure both before moving it.
      if (hi.k / lo.k > 2.6) {
        problems.push(`a ${hi.sp} is ${(hi.k / lo.k).toFixed(1)}x the size its span says it should be beside a ${lo.sp} — a bird is being built out of another species' mesh`);
      }
    }
    // and the flag puts the city back on the deck
    RT.birdPerch = 0;
    const stillUp = run().filter((b) => b.state !== 'air' && b.z > 0.10).length;
    RT.birdPerch = 1;
    if (stillUp) problems.push(`birdPerch 0 still left ${stillUp} birds standing on a building`);
  }
} catch (e) {
  problems.push(`the render check threw — ${e.message}`);
} finally {
  Date.now = realNow;
  RT.geese = held.geese; RT.gl = held.gl; RT.glFloor = held.floor; RT.birdPerch = held.perch;
}

if (problems.length) {
  console.error(`✗ perch: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems.slice(0, 24)) console.error(`  ✗ ${p}`);
  process.exit(1);
}

const perchers = Object.entries(SPECIES).filter(([, s]) => s.perch).map(([id]) => id);
console.log(`✓ perch: ${withLedge} of ${tiles} buildings offer a ledge — ${ledgeCount} of them, ${ptCount} standing points, every one on mass the aeroplane collides with (worst ${worst.toFixed(4)} tiles).`);
console.log(`  · the detail kit adds ${kitLedgeCount} perches on ${kitTiles} buildings — sills, balconies and awnings, ${kitPts} standing points, every one with a wall behind it.`);
console.log(`  · the highest thing to stand on in the city is ${tallest.toFixed(2)} tiles up, on ${tallestAt}.`);
console.log(`  · ${perchers.join(', ')} perch and a goose never does; a hunter took the top ledge on all ${placed} streets tried, and no flock was crowded onto a small one.`);
console.log(`  · the badlands offer ${wildCount} hoodoo tops on ${wildTiles} tiles — caprocks, shears and stumps, never a spire tip.`);
if (poleNote) console.log('  · ' + poleNote);
for (const n of notesPole) console.log('  · ' + n);
console.log(`  · rendered: ${e2eUp} birds standing on a building and ${e2eDown} on the deck (${e2eSite}), and the flag puts every one of them back down.`);
