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
import { readFileSync, readdirSync } from 'node:fs';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { SPECIES, spOf, falconStoop, perchedNow, perchesHigh, flockSize, flockAt, flockState, speciesAt, placeOf, habitatState, U_GROUND, GOOSE_SETTLE_MS, BIRD_M_PER_TILE } from '../../client/shared/birds.js';
import { FAUNA_TILE, faunaRecordFaces, faunaScale } from '../../client/game/js/panels/fauna3d.js';
import { BIRD_ROWS } from '../../client/shared/fauna-models.js';

const ws = await loadWindshield();
const { buildLedges, kitLedges, wildLedges, perchableDepth, modelTopAt, perchFor, perchSpot, wireLedge, wireSag, perchCap, HUNT_REACH, HUNT_MIN_LEDGE, HUNT_BAND } = ws;
const RT = ws.RENDER_TUNE;
if (process.env.NO_POLES) RT.wirePoles = 0;
// ⚠ THE DOT LOD IS PINNED OFF, for the reason fauna.mjs pins it: this file reads a bird POSITION
// out of the geometry the frame pushed, and past `faunaDot` a bird is a sprite that carries no
// census metadata at all. It does not go missing loudly -- the standing birds simply thin out, and
// the check reports that nothing is perched, which is the same sentence it would print for a
// genuinely broken ledge search. It said exactly that the day the LOD landed: 23 standing birds
// and not one up on anything, on a build whose ledges were fine.
RT.faunaDot = 0;
// ⚠ AND SO IS THE FAR-BIRD MAGNIFIER, because the mesh check below measures how WIDE each bird is drawn.
// `faunaMinPx` draws a bird under a couple of pixels bigger than it is, so a far starling measured beside a
// near peregrine read 2.8 spans wide against the peregrine's 0.54 and failed as "the wrong mesh". It did
// that the day starlings started coming down on a lawn a few tiles off their road anchor (landSite), which
// put a flock six tiles from this camera; with the magnifier off the same birds read 1.07.
RT.faunaMinPx = 0;

const world = JSON.parse(readFileSync('client/game/flightsim-world.json', 'utf8'));
const cells = world.cells;
const problems = [];

// A point on a ledge may sit under something up to PERCH_COVER_EPS taller — that is the lip the
// cover test deliberately tolerates — so the agreement is two-sided at that width.
const TOL = 0.016;
// windshield.js's PERCH_COVER_EPS and PERCH_HEADROOM: mass this much taller than the feet buries a
// bird, unless it starts above a perched bird's head.
const COVER_EPS = 0.015, BIRD_HEADROOM = 0.02;

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
let kitIn = 0, kitInWorst = 0, kitInAt = "";
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
      // ⚠ AND NOT INSIDE ITS OWN BUILDING. The two checks around this one ask whether something
      // holds the part up; neither asks whether something taller stands where the bird does. A
      // coping ringing a podium runs through the tower on it, and 5,991 points were in a wall: H
      // followed a peregrine into Subject to Contract's roof. Mass spanning the bird, so a sill
      // under an overhanging storey, which is out in the open, passes.
      const inside = ws.groundObstructionAt(wx, wy, c, q.x, q.y, l.z + BIRD_HEADROOM) - l.z;
      if (inside > COVER_EPS) {
        kitIn++;
        if (inside > kitInWorst) { kitInWorst = inside; kitInAt = `${c.bn || c.bt} @ ${k}, ${l.kind}${l.ring ? ' ring' : ''} at z ${l.z.toFixed(3)}`; }
      }
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
if (!perchableDepth(0.02)) problems.push("a 36 cm sill is refused — the floor is set too high to be real");

if (kitOff) problems.push(`${kitOff} of ${kitPts} kit perch points stand off the end of the part — worst ${kitOffWorst.toFixed(3)} tiles at ${kitOffAt}`);
if (kitFlatRing) problems.push(kitFlatRing + " coping rings are collinear — they are being laid across the roof instead of round it");
if (kitSillLow) problems.push(`${kitSillLow} window perches are not on the sill — they sit at or above the bay centre`);

if (kitIn) problems.push(`${kitIn} of ${kitPts} kit perch points are inside their own building — worst ${kitInWorst.toFixed(3)} tiles under the mass at ${kitInAt}`);
if (kitBad) problems.push(`${kitBad} of ${kitPts} kit perch points have no wall behind them — worst ${kitWorst.toFixed(3)} tiles at ${kitWorstAt}`);
// ⚠ COUNTED SEPARATELY FROM THE REST OF THE KIT. Face parts and rings are two different code
// paths, and the face ones far outnumber them — so "the kit offers something" stays true with
// every coping in the city silently dropped.
if (!kitRings) problems.push("no coping ring anywhere is offered as a perch — parapets are not being read");
if (!kitLedgeCount) problems.push("the detail kit offers no perches at all — sills, balconies, awnings and copings are not being read");

// ── 1b, CONTINUED. A FLANK PART PERCHES ON ITS FLANK ────────────────────────
//
// `face: 'x'` puts a part on a side wall: the renderer turns its frame so `cy` is the model's X and
// `cx` runs along negative Y. `kitLedges` read every part as front-or-back, so a flank window's birds
// stood on a sill on the front or back wall where there is no window. The sweep in 1b only caught it
// when that phantom sill also had no wall behind it (Lather & Lye's set-back bath hall); on a plain
// box the phantom sill is against a wall and passes.
//
// So this finds the tiles whose model carries a flank window, balcony or canopy, from the content
// files rather than from anything `kitLedges` reports, and asks two things in the model's own frame:
// some kit perch on those tiles faces along X, and each one that does is mounted on the flank plane
// (mass just inside the mount, none at the perch height just outside it). Put `face` back out of
// `kitLedges` and the first fails.
const FLANK_KINDS = new Set(['windowBay', 'balcony', 'canopy']);
const flankNames = new Set();
for (const f of readdirSync('content/building_models')) {
  if (!f.endsWith('.json')) continue;
  let m = null;
  try { m = JSON.parse(readFileSync('content/building_models/' + f, 'utf8')); } catch { continue; }
  if (!(m.detail || []).some((d) => d.face === 'x' && FLANK_KINDS.has(d.kind))) continue;
  for (const b of (m.bind || [])) if (b.by === 'name' && b.key) flankNames.add(b.key);
}
const ENT_VEC = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
let flankTiles = 0, flankPerches = 0;
for (const [k, c] of Object.entries(cells)) {
  if (!c.bt || !flankNames.has(c.bn)) continue;
  flankTiles++;
  const [wx, wy] = k.split(',').map(Number);
  const E = ENT_VEC[c.ent] || [0, 1], th = Math.atan2(-E[0], E[1]);
  const ct = Math.cos(th), st = Math.sin(th);
  let ks = null;
  try { ks = kitLedges(c, wx, wy); } catch { ks = null; }
  let here = 0;
  for (const l of (ks || [])) {
    if (!l.mount) continue;
    const n = l.mount.out - th;
    if (Math.abs(Math.cos(n)) < 0.999) continue;          // a front or back part
    here++;
    const dx = l.mount.x - wx, dy = l.mount.y - wy;
    const mX = dx * ct + dy * st;                          // the mount, in the model frame
    // ⚠ AT THE PART'S OWN HEIGHT, NOT THE TOP OF THE COLUMN. `modelTopAt` is the tallest mass over a
    // point, so on Jolene's, whose upper storey overhangs the lower wall by a centimetre, "just
    // outside the window" read 0.57 from the floor above it. Solid at `z` is mass reaching `z` with
    // nothing starting above it there, which is what `overheadAt` answers.
    const zp = l.mid != null ? l.mid : l.z - 0.005;
    const solidAt = (x, y) => modelTopAt(wx, wy, c, x, y, false) >= zp && !ws.overheadAt(wx, wy, c, x, y, zp);
    const ox = Math.cos(l.mount.out), oy = Math.sin(l.mount.out);
    const at = `${c.bn} @ ${k}, ${l.kind} at z ${l.z.toFixed(3)}, mount x ${mX.toFixed(3)} in the model frame`;
    if (Math.sign(mX) !== Math.sign(Math.cos(n))) problems.push(`a flank perch faces into its own building: ${at}`);
    if (!solidAt(l.mount.x - ox * 0.01, l.mount.y - oy * 0.01)) problems.push(`a flank perch has no wall behind it at its own height: ${at}`);
    if (solidAt(l.mount.x + ox * 0.01, l.mount.y + oy * 0.01)) problems.push(`a flank perch is mounted inside the mass, not on the flank plane: ${at}`);
  }
  flankPerches += here;
}
// ⚠ COUNTED OVER THE CITY, NOT PER TILE. An authored height is a multiple of the tile's storey
// height, so on a low building a flank sill can land under PERCH_MIN_Z and be refused for the right
// reason: Camp Giardia (one floor) and Salvage Rites (two) offer no flank perch at all. What `face`
// being ignored looks like is no flank perch anywhere, since every part then reads as front or back.
if (!flankTiles) problems.push('no tile in the baked city uses a model with a flank perch part, so nothing checks that kitLedges reads `face`');
else if (!flankPerches) problems.push(`${flankTiles} tiles have a flank window, balcony or canopy and not one kit perch faces a flank: kitLedges is not reading \`face\``);

// ── 1c. AND THE BADLANDS HAS SOMETHING TO STAND ON ──────────────────────────
//
// The hawk is the reason this exists: the highest perch share in the table, a design built round
// a still-hunter on a vantage, and 100% of its life on the ground because its habitat has no
// buildings in it. A hoodoo is real geometry the painter already puts there, so the only question
// is whether the bird is standing on the part of it that exists.
let wildTiles = 0, wildCount = 0, wildBadProf = 0, wildTiny = 0, wildOffTile = 0, wildOdd = 0;
let redrockTiles = 0, snagCount = 0, snagOdd = 0, snagOffTile = 0;
// A snag is drawn from deadStandSnags at SNAG_H x 1..1.8 (windshield.js); a perch is its tip.
const SNAG_LO = 0.17, SNAG_HI = 0.17 * 1.8;
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
  if (c.biome === "redrock") wildTiles++;
  wildCount += L.length;
  for (const l of L) {
    // ⚠ A SNAG IS NOT A SPIRE, so none of the rock rules below apply to it. What does: it is at a
    // height the painter draws a snag at, and it is on its own tile.
    if (l.kind === "snag") {
      snagCount++;
      if (!(l.z >= SNAG_LO - 1e-6 && l.z <= SNAG_HI + 1e-6)) snagOdd++;
      if (l.pts.some((q) => Math.abs(q.x - wx) > 0.55 || Math.abs(q.y - wy) > 0.55)) snagOffTile++;
      continue;
    }
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
if (!snagCount) problems.push("no dead stand offers a snag to perch on — deadStandSnags is not reaching wildLedges");
if (snagOdd) problems.push(`${snagOdd} snag perches are at a height the painter cannot draw a snag at`);
if (snagOffTile) problems.push(`${snagOffTile} snag perches are off their own tile`);
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
  // ⚠ THE MASS AND THE COPINGS TOGETHER. Where a coping covers a setback's edge the coping is the
  // perch and the deck under it is not (`underCoping` in windshield.js), so a count of mass alone
  // loses the Meridian's two crown setbacks while the birds stand on them.
  const ls = [...(buildLedges(mc, mx, my) || []), ...((kitLedges(mc, mx, my) || []).filter((l) => l.ring))];
  const heights = [...new Set(ls.map((l) => Math.round(l.z * 100) / 100))].sort((a, b) => a - b);
  if (heights.length < 4) problems.push(`The Meridian offers ${heights.length} distinct ledge heights, wanted at least 4 — the setbacks are not being seen`);
  const big = ls.filter((l) => l.len > 0.9);
  if (big.length < 3) problems.push(`The Meridian offers ${big.length} ledges long enough for a flock, wanted at least 3`);
  // ⚠ AND A BIRD STANDS ON A COPING, NEVER INSIDE ONE. The kit lays a coping round the crown deck
  // and round the cornice under it, and the mass ledge for each deck ran 0.015 tiles in from the drop:
  // under the cap. The falcon that hunts from this tower spent every landing inside the parapet,
  // invisible from every angle. So each coping must be offered, with no mass ledge left on its deck.
  // Put `underCoping` back to false and the deck ledges return, the dedupe drops the copings, and
  // the count below goes to zero.
  const caps = (kitLedges(mc, mx, my) || []).filter((l) => l.ring);
  if (caps.length < 2) problems.push(`The Meridian offers ${caps.length} coping perches, wanted its two crown copings — a bird is being stood on the deck under them`);
  for (const k of caps) {
    const deck = k.z - (k.deep || 0);
    const under = (buildLedges(mc, mx, my) || []).find((l) => Math.abs(l.z - deck) < 0.01);
    if (under) problems.push(`The Meridian still offers the deck at ${under.z.toFixed(3)} under its coping at ${k.z.toFixed(3)} — a bird there stands inside the parapet`);
  }
}

// ── 3. WHO PERCHES, AND WHERE ────────────────────────────────────────────────
if (SPECIES.goose.perch) problems.push('a goose perches — it is a ground and water bird and must not');
for (const id of ['pigeon', 'songbird', 'gull', 'hawk', 'peregrine']) {
  if (!SPECIES[id].perch || !SPECIES[id].perch.share) problems.push(`${id} never perches`);
}
for (const id of ['hawk', 'peregrine']) if (!perchesHigh({ ax: 1, ay: 1, sp: id })) problems.push(`a ${id} does not take the highest perch — the hunt is the whole reason it has one`);
if (perchesHigh({ ax: 1, ay: 1, sp: 'pigeon' })) problems.push('a pigeon insists on the highest perch');

// The share is a probability over cycles, so it has to come out near what the row claims or the
// species is effectively always up or never up whatever the table says.
for (const id of ['pigeon', 'hawk', 'peregrine']) {
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
  for (const sp of ['pigeon', 'peregrine']) {
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
    // A hunter takes a real edge (not an ornament) in the upper band of what it can reach, and
    // varies between them by landing. The renderer's own constants, so the two cannot drift.
    const edges = pool.filter((l) => l.len >= HUNT_MIN_LEDGE);
    const ref = edges.length ? edges : pool;
    const maxZ = Math.max(...ref.map((l) => l.z));
    if (perchesHigh(fl) && (L.z < maxZ * HUNT_BAND - 1e-9 || (edges.length && L.len < HUNT_MIN_LEDGE))) highWrong++;
    const n = Math.max(1, flockSize(fl));
    const ROOM = 0.33 / BIRD_M_PER_TILE;   // PERCH_ROOM in windshield.js: 0.33 m of ledge a bird
    const fits = pool.filter((l) => l.len >= n * ROOM);
    if (fits.length) { roomPossible++; if (L.len < n * ROOM) roomShort++; }
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

if (highWrong) problems.push(`a hunter took an ornament or a perch below its band on ${highWrong} streets`);
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
  // The view's window is the game's: the server sends 36 tiles. At 12, a hunter framed on a ledge
  // six tiles from its anchor fell out of `hunterSpot`'s reach and was never drawn.
  const RV = 18;
  const win = (cx, cy) => Array.from({ length: RV * 2 + 1 }, (_, j) =>
    Array.from({ length: RV * 2 + 1 }, (_, i) => cells[(cx + i - RV) + ',' + (cy + j - RV)] || { kind: 'land', biome: 'citycore' }));

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
      const found = { wx, wy, sid, t, strict, place, paint: c.biome, fl };
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
    // ⚠ A HUNTER IS FRAMED ON ITS LEDGE, NOT ITS ANCHOR. The renderer draws a peregrine or hawk where
    // `hunterSpot` puts it, which can be six tiles off the anchor, and culls it by that distance. A
    // camera three tiles off the anchor looked away from a peregrine sitting behind it at 918,908.
    const aim = perchesHigh(site.fl) ? ws.hunterSpot(win(site.wx, site.wy), RV, site.wx, site.wy, site.fl, site.t, null) : null;
    const AX = aim ? aim[0] : site.wx, AY = aim ? aim[1] : site.wy;
    const CAM = { x: Math.round(AX), y: Math.round(AY) + 3 };
    const view = { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.3, speed: 0,
      hour: 11, weather: 'clear', heading: 0, map: win(CAM.x, CAM.y),
      mapCenter: { ...CAM }, mapOffset: { x: 0, y: 0 },
      resFloor: 1, tune: { gl: 1, perfDS: 0 } };
    const run = () => {
      let got = [], totalFaces = 0;
      ws.installGLWorld((glCells, cam, o) => {
        const mesh = faunaRecordFaces(o.fauna || []);   // bird records → the faces gl/fauna.js draws
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
      && Math.hypot((b.x + CAM.x) - AX, (b.y + CAM.y) - AY) < 2.5);
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
      const k = b.width / (BIRD_ROWS[b.sp].span * FAUNA_TILE * faunaScale('bird', b.sp));
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

// ── 7. A HUNTER IS DRAWN, AND FOUND, WHERE IT SITS ───────────────────────────
//
// A hunter perches up to HUNT_REACH tiles from its anchor, and two things measured it from the
// anchor anyway: the draw cull, so the Meridian's falcon (anchored on The Strand, six tiles off)
// was never drawn from the street under the tower it sat on; and freelook's raptor finder, which
// aimed H at the anchor's pavement while the bird was 60 m up. Both now ask `hunterSpot`.
//
// So: a perched hunter whose ledge is well away from its anchor, and a camera past the ledge,
// inside the species' draw range of the bird and outside it of the anchor. Measure from the anchor
// again and the bird is not in the frame; read the anchor again and H points at the ground.
let spotNote = '', diveNote = '';
{
  const DENS7 = 1, R7 = 18, T0 = 1.7e12;
  const bare7 = { kind: 'land' };
  const win7 = (cx, cy) => Array.from({ length: R7 * 2 + 1 }, (_, j) =>
    Array.from({ length: R7 * 2 + 1 }, (_, i) => cells[(cx + i - R7) + ',' + (cy + j - R7)] || bare7));
  const placeAt7 = (wx, wy) => {
    const c = cells[wx + ',' + wy];
    if (!c) return null;
    let bld = 0, shore = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nn = cells[(wx + dx) + ',' + (wy + dy)];
      if (!nn) continue;
      if (nn.bt) bld++;
      if (nn.kind === 'water') shore = true;
    }
    return placeOf(c.biome, bld, shore);
  };
  let site7 = null;
  for (const [k, c] of Object.entries(cells)) {
    if (c.bt || !c.biome) continue;
    const [wx, wy] = k.split(',').map(Number);
    const sid = speciesAt(placeAt7(wx, wy), wx, wy, { road: !!c.road, airfield: c.kind === 'field' });
    if (sid !== 'peregrine' && sid !== 'hawk') continue;
    const fl = flockAt(wx, wy, DENS7, sid);
    if (!fl) continue;
    const map = win7(wx, wy), per = SPECIES[sid].period;
    for (let i = 0; i < 400 && !site7; i++) {
      const t = T0 + i * per * 0.37;
      const st = flockState(fl, t);
      if (st.airborne || !perchedNow(fl, t)) continue;
      const p = ws.hunterSpot(map, R7, wx, wy, fl, t, null);
      if (p && p[2] > 0.5 && Math.hypot(p[0] - wx, p[1] - wy) >= 5) site7 = { fl, sid, t, p };
    }
    if (site7) break;
  }
  if (!site7) problems.push('no hunter in the city perches five tiles or more from its anchor — the cull check below has nothing to look at');
  else {
    const { fl, sid, t, p } = site7;
    const ux = (p[0] - fl.ax) / Math.hypot(p[0] - fl.ax, p[1] - fl.ay), uy = (p[1] - fl.ay) / Math.hypot(p[0] - fl.ax, p[1] - fl.ay);
    const range = SPECIES[sid].drawRange;
    // Stepped out past the ledge until the anchor is clearly beyond the range. The bird has to stay
    // well inside it, and inside the lens's own cut at this canvas width (FLOCK_RESOLVE_F, ~9.6).
    let cx = 0, cy = 0;
    for (let s = 3; s <= 8; s += 0.5) {
      cx = Math.round(p[0] + ux * s); cy = Math.round(p[1] + uy * s);
      if (Math.hypot(fl.ax - cx, fl.ay - cy) > range + 0.5) break;
    }
    const dBird = Math.hypot(p[0] - cx, p[1] - cy), dAnchor = Math.hypot(fl.ax - cx, fl.ay - cy);
    if (!(dBird < Math.min(range, 9) && dAnchor > range)) problems.push(`the hunter-cull camera is ${dBird.toFixed(1)} tiles from the bird and ${dAnchor.toFixed(1)} from its anchor against a ${range}-tile range — it proves nothing`);
    const held7 = { geese: RT.geese, gl: RT.gl, floor: RT.glFloor, dot: RT.faunaDot };
    try {
      RT.geese = DENS7; RT.gl = 1; RT.glFloor = 1; RT.faunaDot = 0;
      Date.now = () => t;
      stubCanvas('__hunt', 480, 300);
      const cv = globalThis.document.createElement('canvas'); cv.width = 480; cv.height = 300;
      let recs = [];
      ws.installGLWorld((glCells, cam, o) => { recs = o.fauna || []; return { faces: 1, canvas: cv }; });
      const view = { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.3, speed: 0, hour: 12, weather: 'clear',
        heading: Math.atan2(p[0] - cx, -(p[1] - cy)) * 180 / Math.PI, map: win7(cx, cy),
        mapCenter: { x: cx, y: cy }, mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 } };
      ws.paintWindshield('__hunt', view);
      ws.paintWindshield('__hunt', view);
      ws.installGLWorld(null);
      const drawn = recs.find((r) => r.sp === sid && Math.hypot(r.x + cx - p[0], r.y + cy - p[1]) < 0.3);
      if (!drawn) problems.push(`the ${sid} perched at ${p[0].toFixed(2)},${p[1].toFixed(2)} is ${dBird.toFixed(1)} tiles from the camera and was not drawn — it is being culled by its anchor, ${dAnchor.toFixed(1)} tiles off`);
      const found = ws.raptorsNow(t).find((q) => q.sp === sid && Math.hypot(q.x - p[0], q.y - p[1]) < 0.3 && Math.abs(q.z - p[2]) < 0.05);
      if (!found) problems.push(`raptorsNow does not report the ${sid} on its ledge at ${p[0].toFixed(2)},${p[1].toFixed(2)} z ${p[2].toFixed(2)} — H would aim at the anchor`);
      spotNote = `a ${sid} anchored at ${fl.ax},${fl.ay} and perched ${Math.hypot(p[0] - fl.ax, p[1] - fl.ay).toFixed(1)} tiles away, ${p[2].toFixed(2)} up, is drawn from ${dBird.toFixed(1)} tiles and found by H on its ledge.`;
    } catch (e) {
      problems.push(`the hunter-cull check threw — ${e.message}`);
    } finally {
      Date.now = realNow;
      RT.geese = held7.geese; RT.gl = held7.gl; RT.glFloor = held7.floor; RT.faunaDot = held7.dot;
    }
  }

  // ── AND WHERE IT IS WHILE IT STOOPS ────────────────────────────────────────
  // freelook's follow camera sits about 6 m off the bird and is placed from raptorsNow every frame,
  // so the finder has to report where the bird is DRAWN rather than the cull's hunterSpot. The two
  // differ most in a stoop, so this paints a peregrine half way down a dive and asks both.
  let dive = null;
  for (const [k, c] of Object.entries(cells)) {
    if (dive) break;
    if (c.bt || !c.biome) continue;
    const [wx, wy] = k.split(',').map(Number);
    if (speciesAt(placeAt7(wx, wy), wx, wy, { road: !!c.road, airfield: c.kind === 'field' }) !== 'peregrine') continue;
    const fl = flockAt(wx, wy, DENS7, 'peregrine');
    if (!fl) continue;
    // Its prey, rolled the way the draw rolls every flock in reach.
    const near = [];
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      const n = cells[(wx + dx) + ',' + (wy + dy)];
      if (!n || n.bt || !n.biome) continue;
      const sp = speciesAt(placeAt7(wx + dx, wy + dy), wx + dx, wy + dy, { road: !!n.road, airfield: n.kind === 'field' });
      const f = sp && SPECIES[sp]?.preyable ? flockAt(wx + dx, wy + dy, DENS7, sp) : null;
      if (f) near.push(f);
    }
    if (!near.length) continue;
    for (let t = T0; t < T0 + 6 * 3600e3 && !dive; t += 1000) {
      const s = falconStoop(fl, t, near);
      if (s) dive = { fl, s, t: s.at + 500 };   // half way down: the dive is FALCON_DIVE_S, 1 s
    }
  }
  if (!dive) problems.push('no peregrine in the city stoops within six hours — the dive check has nothing to look at');
  else {
    const { fl, s, t } = dive;
    const id = 'peregrine:' + fl.ax + ',' + fl.ay;
    const p0 = ws.hunterSpot(win7(fl.ax, fl.ay), R7, fl.ax, fl.ay, fl, t, null);
    // Half way down the bird is half way to its prey. The camera stands three tiles off that point,
    // square to the line of the dive, looking at it.
    const mx = (p0[0] + s.x) / 2, my = (p0[1] + s.y) / 2, L = Math.hypot(s.x - p0[0], s.y - p0[1]) || 1;
    const cx = Math.round(mx - (s.y - p0[1]) / L * 3), cy = Math.round(my + (s.x - p0[0]) / L * 3);
    const held8 = { geese: RT.geese, gl: RT.gl, floor: RT.glFloor, dot: RT.faunaDot };
    try {
      RT.geese = DENS7; RT.gl = 1; RT.glFloor = 1; RT.faunaDot = 0;
      Date.now = () => t;
      stubCanvas('__dive', 480, 300);
      const cv = globalThis.document.createElement('canvas'); cv.width = 480; cv.height = 300;
      let recs = [];
      ws.installGLWorld((glCells, cam, o) => { recs = o.fauna || []; return { faces: 1, canvas: cv }; });
      const view = { cls: 'truck', phase: 'cruise', worldBlend: 1, height: 0, eyeH: 0.3, speed: 0, hour: 12, weather: 'clear',
        heading: Math.atan2(mx - cx, -(my - cy)) * 180 / Math.PI, map: win7(cx, cy),
        mapCenter: { x: cx, y: cy }, mapOffset: { x: 0, y: 0 }, resFloor: 1, tune: { gl: 1, perfDS: 0 } };
      ws.paintWindshield('__dive', view);
      ws.paintWindshield('__dive', view);
      ws.installGLWorld(null);
      const rep = ws.raptorsNow(t, id)[0];
      const drawn = rep && recs.filter((r) => r.sp === 'peregrine')
        .map((r) => ({ r, d: Math.hypot(r.x + cx - rep.x, r.y + cy - rep.y, r.z - rep.z) })).sort((a, b) => a.d - b.d)[0];
      if (!rep) problems.push(`raptorsNow does not report the stooping peregrine ${id} at all`);
      else if (!drawn) problems.push(`the stooping peregrine ${id} was not drawn from ${cx},${cy}, so its dive cannot be compared`);
      else {
        const off = Math.hypot(rep.x - p0[0], rep.y - p0[1], rep.z - p0[2]);
        if (drawn.d > 0.01) problems.push(`mid-stoop, raptorsNow puts the peregrine ${drawn.d.toFixed(3)} tiles from where it is drawn — the follow camera would lose it`);
        if (off < 0.1) problems.push(`the peregrine is not diving at ${t} (${off.toFixed(3)} tiles off its circuit), so the stoop check proves nothing`);
        else diveNote = `a peregrine half way down a stoop is drawn ${off.toFixed(2)} tiles off its circuit, and raptorsNow reports it within ${drawn.d.toExponential(1)} tiles of the drawn bird.`;
      }
    } catch (e) {
      problems.push(`the stoop check threw — ${e.message}`);
    } finally {
      Date.now = realNow;
      RT.geese = held8.geese; RT.gl = held8.gl; RT.glFloor = held8.floor; RT.faunaDot = held8.dot;
    }
  }
}

// ── 8. AND NO PERCHED BIRD IS INSIDE A BUILDING ──────────────────────────────
//
// A ledge is built from one tile's model, and a model reaches past its own tile: The Meridian's
// lobby stood over the setback its falcon took, and Dual Aspect over Fire Station 4's roof edge. So
// every perching flock in the city is sat on its ledges, landing after landing, and its first bird is
// asked against the mass of every tile round it. Delete the own-model test in `kitLedges` and the
// Meridian's peregrine is back inside the lobby; delete the neighbour pass in `clearedFor` and a
// vulture stands in the next tile of The Wall.
let huntSat = 0, huntIn = 0, huntInAt = '';
{
  const R8 = 18, T0 = 1.7e12;
  const bare8 = { kind: 'land' };
  const win8 = (cx, cy) => Array.from({ length: R8 * 2 + 1 }, (_, j) =>
    Array.from({ length: R8 * 2 + 1 }, (_, i) => cells[(cx + i - R8) + ',' + (cy + j - R8)] || bare8));
  const placeAt8 = (wx, wy) => {
    let bld = 0, shore = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nn = (dx || dy) && cells[(wx + dx) + ',' + (wy + dy)];
      if (!nn) continue;
      if (nn.bt) bld++;
      if (nn.kind === 'water') shore = true;
    }
    return placeOf(cells[wx + ',' + wy].biome, bld, shore);
  };
  for (const [k, c] of Object.entries(cells)) {
    if (c.bt || !c.biome) continue;
    const [wx, wy] = k.split(',').map(Number);
    const sid = speciesAt(placeAt8(wx, wy), wx, wy, { road: !!c.road, airfield: c.kind === 'field' });
    if (!sid || !SPECIES[sid].perch) continue;
    const fl = flockAt(wx, wy, 1, sid);
    if (!fl) continue;
    const map = win8(wx, wy), per = SPECIES[sid].period;
    for (let i = 0; i < 40; i++) {
      const t = T0 + i * per * 0.37;
      if (flockState(fl, t).airborne || !perchedNow(fl, t)) continue;
      const p = ws.hunterSpot(map, R8, wx, wy, fl, t, null);
      if (!p || !(p[2] > 0)) continue;
      huntSat++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.round(p[0]) + dx, ty = Math.round(p[1]) + dy, n = cells[tx + ',' + ty];
        if (!n || !n.bt) continue;
        const over = ws.groundObstructionAt(tx, ty, n, p[0], p[1], p[2] + BIRD_HEADROOM) - p[2];
        if (over > COVER_EPS) { huntIn++; if (!huntInAt) huntInAt = `the ${sid} anchored at ${k} sits ${over.toFixed(3)} tiles down inside ${n.bn || n.bt} @ ${tx},${ty}`; }
      }
    }
  }
  if (!huntSat) problems.push('no flock in the city was ever sat on a ledge, so nothing checks that one is not inside a building');
  if (huntIn) problems.push(`${huntIn} of ${huntSat} perched birds are inside a building: ${huntInAt}`);
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
console.log(`  · ${perchers.join(', ')} perch and a goose never does; a hunter took a real edge in its upper band on all ${placed} streets tried, and no flock was crowded onto a small one.`);
console.log(`  · the badlands offer ${wildCount} hoodoo tops on ${wildTiles} tiles — caprocks, shears and stumps, never a spire tip.`);
if (spotNote) console.log('  · ' + spotNote);
if (diveNote) console.log('  · ' + diveNote);
console.log(`  · ${huntSat} perched flocks sat on their ledges round the city, and not one bird is inside a building, its own or the next tile's.`);
if (poleNote) console.log('  · ' + poleNote);
for (const n of notesPole) console.log('  · ' + n);
console.log(`  · rendered: ${e2eUp} birds standing on a building and ${e2eDown} on the deck (${e2eSite}), and the flag puts every one of them back down.`);
