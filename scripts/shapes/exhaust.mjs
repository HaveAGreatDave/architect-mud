// EXHAUST — is the fire coming out of the pipes, or out of thin air?
//
//   node scripts/shapes/exhaust.mjs [--report]
//
// `drawBoatExhaust` in windshield.js paints flame and smoke at points it is HANDED by the mesh
// (`boatExhaustPorts`), because that file has no access to the hull's stations and re-deriving a
// zoomie's mouth from the row would be a second copy of the motor's layout, free to drift. That is
// the arrangement `TRUCK_META.pin` is in, and its own note says what getting it wrong looks like:
// a guessed offset hinges three rigs of four about a point in mid-air.
//
// ⚠ AND THE FAILURE IS SILENT IN BOTH DIRECTIONS. A port a tenth of a tile off its pipe still
// draws a perfectly good flame, in the wrong place, and nothing throws; a port list that comes back
// empty draws nothing at all, which is indistinguishable from a motor that is not being asked for
// anything. Neither reaches any other gate — `shapes:smoke` proves a model RUNS, `glresidue`
// censuses what lands on the canvas, and none of them knows where a pipe is.
//
// WHAT IT GUARDS:
//   • one port per zoomie per flank, and the row's own `zoom` decides how many
//   • every port sits ON a pipe — within a bore of real PIPE-tinted geometry
//   • and points where a zoomie points: aft, outboard and up, on the flank it belongs to
//   • the coarse mesh publishes the SAME ports though it draws no plumbing, because a light
//     outruns the geometry it comes out of
//   • the ports are DERIVED: move the motor in the row and every one of them moves with it
//   • a hull with no inboard publishes none — fire from a pipe that is not there is worse than none
//   • and the pass actually paints when the motor is lit, and nothing at all when it is not

import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');
let fails = 0;
function check(label, cond, detail) {
  if (cond) { if (REPORT) console.log(`  . ${label}`); return true; }
  fails++;
  console.error(`  x ${label}${detail ? `\n      ${detail}` : ''}`);
  return false;
}

const ws = await loadWindshield();
const A3 = await import('../../client/game/js/panels/aircraft3d.js');

console.log('EXHAUST — where the fire comes out');

const CLS = 'hydro';
const row = A3.vehicleParamBase('boat', CLS);
const ZOOM = Math.max(0, Math.round(row.zoom ?? 4));
// Build the mesh first — the meta is stamped by the builder, and the accessor deliberately does not
// force one (see its note).
const facesAt = (d) => A3.aircraftFaces(CLS, d, false, '');
facesAt(1); facesAt(0);
const P1 = A3.boatExhaustPorts(CLS, 1), P0 = A3.boatExhaustPorts(CLS, 0);

console.log('\n  the port list');
check(`one port per zoomie per flank (${ZOOM} a side)`, P1.length === ZOOM * 2,
  `${P1.length} ports for zoom ${ZOOM}`);
check('both flanks are represented evenly',
  P1.filter((p) => p.side < 0).length === ZOOM && P1.filter((p) => p.side > 0).length === ZOOM);
check('every position and direction is finite',
  P1.every((p) => [...p.p, ...p.d].every(Number.isFinite)),
  JSON.stringify(P1.find((p) => ![...p.p, ...p.d].every(Number.isFinite)) || {}));
check('every direction is a unit vector',
  P1.every((p) => Math.abs(Math.hypot(...p.d) - 1) < 1e-9));
check('every port carries the bore the flame is sized against',
  P1.every((p) => p.bore > 0 && p.bore < 0.1));

// ⚠ A ZOOMIE POINTS SOMEWHERE, and which way is not a detail: the flame is stepped out along `d`,
// so a sign wrong here fires it INTO the hull, where the depth buffer eats it and nothing says so.
console.log('\n  which way a zoomie points');
check('aft', P1.every((p) => p.d[0] < 0), P1.map((p) => p.d[0].toFixed(3)).join(' '));
check('outboard, on its own flank', P1.every((p) => p.d[1] * p.side > 0),
  P1.map((p) => `${p.side > 0 ? '+' : '-'}${p.d[1].toFixed(3)}`).join(' '));
check('and up', P1.every((p) => p.d[2] > 0));
check('and the mouths straddle the centreline rather than sitting on it',
  P1.every((p) => Math.abs(p.p[1]) > 0.04));

// ── ON A PIPE, NOT IN MID-AIR ────────────────────────────────────────────────
//
// ⚠ THE TINT IS ASKED FOR, NOT WRITTEN DOWN. It was a literal here, and the first time the headers
// were chromed this gate went red — over a colour, on a check about geometry. `boatPipeTint` is the
// mesh's own answer, so a repaint moves both together.
// The PIPE tint is whatever `buildBoat` gives the headers, and nothing else on this hull
// wears — so the vertices of every face carrying it are the plumbing, and the nearest one to a port
// is how far the fire is from the thing it is supposed to be coming out of.
console.log('\n  is it on a pipe?');
{
  const PIPE = A3.boatPipeTint(CLS, 1);
  const pipeVerts = [];
  for (const f of facesAt(1)) {
    const t = f.tint;
    if (!t || t[0] !== PIPE[0] || t[1] !== PIPE[1] || t[2] !== PIPE[2]) continue;
    for (const v of f.p) pipeVerts.push(v);
  }
  check('the hull has pipe geometry to check against', pipeVerts.length > 0, `${pipeVerts.length} vertices`);
  let worst = 0, worstAt = null;
  for (const p of P1) {
    let best = Infinity;
    for (const v of pipeVerts) {
      const d = Math.hypot(v[0] - p.p[0], v[1] - p.p[1], v[2] - p.p[2]);
      if (d < best) best = d;
    }
    if (best > worst) { worst = best; worstAt = p; }
  }
  // A tube is drawn as a ring of vertices about its axis, so the nearest one to the mouth's CENTRE
  // is about a bore away by construction. Two bores is the honest bound; a port adrift from its
  // pipe fails this by a long way rather than marginally.
  const bound = (P1[0]?.bore || 0.012) * 2.4;
  check('every port is on its own pipe', worst <= bound,
    `worst ${worst.toFixed(4)} against a bound of ${bound.toFixed(4)} at ${JSON.stringify(worstAt?.p)}`);
}

// ── THE COARSE MESH ──────────────────────────────────────────────────────────
console.log('\n  at range');
{
  check('the coarse hull publishes the same ports', P0.length === P1.length, `${P0.length} against ${P1.length}`);
  const same = P0.every((p, i) => p.p.every((v, k) => Math.abs(v - P1[i].p[k]) < 1e-12));
  check('in exactly the same places, though it draws no plumbing', same);
  // ⚠ AND IT REALLY DOES DRAW NONE — otherwise the claim above is about a mesh that never sheds
  // anything, and the check is proving a tautology.
  const PIPE = A3.boatPipeTint(CLS, 1);
  const pipes0 = facesAt(0).filter((f) => f.tint && f.tint[0] === PIPE[0] && f.tint[1] === PIPE[1] && f.tint[2] === PIPE[2]);
  check('the coarse hull has shed its pipes', pipes0.length === 0, `${pipes0.length} pipe faces survived`);
}

// ── DERIVED, NOT WRITTEN DOWN ────────────────────────────────────────────────
//
// The whole reason the mesh publishes these rather than the painter computing them. If a port list
// does not follow the row, the two copies this exists to prevent are already back.
console.log('\n  derived from the row');
{
  const DF = 0.11;
  A3.setVehicleParams('boat', CLS, { v8F: (row.v8F ?? -0.6) + DF });
  facesAt(1);
  const moved = A3.boatExhaustPorts(CLS, 1);
  check('moving the motor aft-forward moves every port with it',
    moved.length === P1.length && moved.every((p, i) => Math.abs((p.p[0] - P1[i].p[0]) - DF) < 1e-9),
    moved.length ? `first moved by ${(moved[0].p[0] - P1[0].p[0]).toFixed(4)}, wanted ${DF}` : 'no ports');

  A3.setVehicleParams('boat', CLS, { zoom: 6 });
  facesAt(1);
  check('and the pipe COUNT follows the row too', A3.boatExhaustPorts(CLS, 1).length === 12,
    `${A3.boatExhaustPorts(CLS, 1).length} ports for zoom 6`);

  // ⚠ NO MOTOR, NO PORTS. `v8` and `motors` are exclusive by authoring, and a hull wearing a bank
  // of transom outboards has no zoomies at all — fire out of a pipe that is not drawn is a worse
  // picture than a boat that does not flame.
  A3.setVehicleParams('boat', CLS, { v8: 0, motors: 2 });
  facesAt(1);
  check('an outboard hull publishes no ports', A3.boatExhaustPorts(CLS, 1).length === 0,
    `${A3.boatExhaustPorts(CLS, 1).length} ports on a hull with no inboard`);

  A3.clearVehicleParams();
  facesAt(1);
  check('and clearing the override puts the motor back', A3.boatExhaustPorts(CLS, 1).length === ZOOM * 2);
}

// ── DOES ANYTHING ACTUALLY PAINT? ────────────────────────────────────────────
//
// ⚠ EVERYTHING ABOVE IS ABOUT A LIST. A correct list nothing reads is the same picture as no list
// at all, which is the `gl:opts` lesson one layer down — wired at one end, gated, swept, and
// dropped a hop short of the thing that draws.
console.log('\n  and does it paint?');
{
  // The stub's own context is a Proxy that synthesises methods on `get` and silently DISCARDS a
  // wrapper written onto it (see the ⚠ in floorfallback.mjs), so the counter has to go through a
  // Proxy of its own rather than by assignment.
  // ⚠ AREA, NOT A COUNT, AND THE COUNT WAS THE FIRST DRAFT. The pass paints a fixed number of
  // blobs — four flame nodes and two puffs per pipe, whatever the motor is doing — so what varies
  // with the throttle is entirely how BIG they are. Counted, a stab and a backfire were 28 arcs
  // each and the check could not tell the two apart; summed as r² it is the painted area, which is
  // the thing the eye is actually reading.
  //
  // ⚠ AND THE BASELINE IS NOT ZERO. A hull paints arcs for other reasons (its lamps, for one), so
  // the claim here is about the DELTA a running motor adds rather than about an empty canvas.
  //
  // ⚠ AND THE SUBJECT HAS TO FILL THE FRAME, which cost a second wrong reading. A flame's radius is
  // a fraction of the PIPE's projected bore with a floor under it so it never vanishes into a
  // sub-pixel — and at an arbitrary distance the whole motor is under that floor, so every flame in
  // every state comes back the same size and a stab and a backfire measure identically. Framing the
  // hull the way the Modelshop does puts the geometry back above the floor, where it is the
  // arithmetic under test rather than the clamp.
  const bnd = ws.vehicleBounds(CLS, false, '');
  const sizeMul = 1.2 / bnd.height * 1.5;
  const FRAME = { sizeMul, dist: ws.previewFit(
    { halfW: bnd.halfW * sizeMul * 1.3, height: bnd.height * sizeMul * 1.3, baseH: bnd.baseH * sizeMul },
    640, 300, 0.86).dist * 0.78 };
  // ⚠ AND IT IS THE FLAME'S REACH, WHICH IS THE THIRD METRIC THIS CHECK HAS HAD. Painted area was
  // the second, and it is dominated by SMOKE — a puff grows to seven bores across where a flame
  // node is under two, so a stab and a backfire came back within 2% of each other while their
  // flames differed by a third. What `fire` actually drives is the LENGTH the nodes are stepped out
  // along the pipe; the girth is pinned near the bore on purpose (a zoomie's mouth is the same
  // diameter at idle and at seven grand). So the measurement is how far the fire reaches, and the
  // flame is picked out of the frame by its own palette rather than by where it happens to land.
  const FLAME_INK = ['255,244,216', '255,198,104', '255,134,52', '226,70,36'];
  const SMOKE_INK = ['46,42,40', '116,110,106'];
  const paint = (craftOpts) => {
    const pts = [], smoke = [];
    let style = '';
    const el = globalThis.document.createElement('canvas');
    el.width = 640; el.height = 300;
    const raw = el.getContext('2d');
    const rec = new Proxy(raw, {
      get(t, k) {
        if (k === 'arc') {
          return (x, y, r, ...a) => {
            if (FLAME_INK.some((ink) => String(style).includes(ink))) pts.push([x, y, r]);
            if (SMOKE_INK.some((ink) => String(style).includes(ink))) smoke.push([x, y, r]);
            return t.arc?.(x, y, r, ...a);
          };
        }
        return t[k];
      },
      set(t, k, v) { if (k === 'fillStyle') style = v; t[k] = v; return true; },
    });
    el.getContext = () => rec;
    ws.renderVehiclePreview(el, { cls: CLS, heading: 118, night: 0, now: 4000, ground: true,
      dist: FRAME.dist, sizeMul: FRAME.sizeMul, ...craftOpts });
    const spread = (l) => (l.length ? { w: Math.max(...l.map((p) => p[0])) - Math.min(...l.map((p) => p[0])),
      h: Math.max(...l.map((p) => p[1])) - Math.min(...l.map((p) => p[1])) } : { w: 0, h: 0 });
    if (!pts.length) return { n: 0, reach: 0, maxR: 0, smoke: spread(smoke), smokeN: smoke.length };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { n: pts.length, maxR: Math.max(...pts.map((p) => p[2])), smoke: spread(smoke), smokeN: smoke.length,
      reach: Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
  };
  const idle = paint({ power: 0.05, rich: 0, bang: 0 });
  const stab = paint({ power: 0.35, rich: 0.30, bang: 0 });
  const chop = paint({ power: 0.85, rich: 0, bang: 0.30 });
  const full = paint({ power: 0.85, rich: 0, bang: 1 });
  check('a motor nobody is asking anything of throws no fire', idle.n === 0, `${idle.n} flame nodes at idle`);
  check('stabbing the throttle lights it', stab.n > 0, `${stab.n} flame nodes`);
  // ⚠ THE CHECK THAT CAUGHT THE CLAMP. At the same enrichment fraction the backfire has to be the
  // bigger event, or the two things `stepBoat` goes out of its way to keep apart draw one picture —
  // which is exactly what a ceiling of 1.35 against a 2.6 multiplier was doing.
  check('and at the same fraction, a bang reaches further than a stab', chop.reach > stab.reach * 1.15,
    `stab ${stab.reach.toFixed(1)} px, chop ${chop.reach.toFixed(1)} px`);
  check('and a full chop reaches further still', full.reach > chop.reach * 1.3,
    `${chop.reach.toFixed(1)} -> ${full.reach.toFixed(1)} px`);
  // ⚠ A FLAME IS A TONGUE, NOT A BALL, and this is the check for the bug that actually shipped:
  // sized off the HULL — which is what every other length in that painter is a fraction of — the
  // nodes came out 18 px across over a pipe whose own radius is under 4, and the entire motor
  // disappeared inside its own exhaust. The reach metric above cannot see that, because a fireball
  // is centred on the same points a flame is. What separates them is the ratio: girth is pinned
  // near the bore and only length moves, so a well-behaved flame is several times longer than it
  // is wide however hard the motor is hit.
  check('and it is much longer than it is wide', full.maxR < full.reach * 0.30,
    `radius ${full.maxR.toFixed(1)} px against a reach of ${full.reach.toFixed(1)} px`);

  // ── AND THE SMOKE STREAMS ──────────────────────────────────────────────────
  // ⚠ IT IS NOT A CHIMNEY, which is what the first cut drew. The trail rose 0.42 for every 1.0
  // aft, and on a hull 0.13 deep that puts it a full hull-height into the sky inside half a
  // boat-length — a plume hanging over a transom rather than exhaust off something doing ninety.
  // Measured side-on, a trail that STREAMS is wider than it is tall; one that CLIMBS is not.
  check('a rich motor smokes', stab.smokeN > 0, `${stab.smokeN} puffs`);
  check('and the trail streams astern rather than climbing',
    full.smoke.w > full.smoke.h * 1.6,
    `${full.smoke.w.toFixed(1)} px along against ${full.smoke.h.toFixed(1)} px up`);
}

// ── THE OTHER BRANCH ─────────────────────────────────────────────────────────
//
// ⚠ EVERYTHING ABOVE MEASURES THE CANVAS FALLBACK, AND THE GAME DOES NOT TAKE IT. With GLASS 2 on
// — which is the default — the flame and the smoke both go to the sprite layer, depth-tested
// against the hull, so the far bank is hidden per pixel rather than by the crude centreline cull
// the canvas branch makes do with. Those are two separate sets of statements and only one of them
// was ever executed by anything.
//
// ⚠ AND A PAINTED FRAME CANNOT REACH IT EITHER, which cost a working measurement to find out:
// every harness here installs a GL hook, that hook is the no-WebGL2 path unless it hands back a
// canvas, and even when it does, the sprite sink the hook is handed never receives a single push —
// measured, on a night TRUCK frame, which certainly has lamps. 'craftResidue' is the seam that
// answers it: the vehicle half of 'canvasResidue', arming the sinks around one model draw.
console.log('\n  and on the depth buffer');
{
  const craft = (eng) => ({ cls: CLS, variant: '', armed: false, gearAnim: 1, dx: 0, dy: -6,
    hdg: 35, bank: 0, pitch: 0, sizeMul: 1, own: true, rng: 0, ...eng });
  const cold = ws.craftResidue(craft({ power: 0, rich: 0, bang: 0 }), { night: 1 });
  const lit = ws.craftResidue(craft({ power: 0.9, rich: 0.9, bang: 1 }), { night: 1 });
  check('the sprite branch does not throw with the motor cold', !cold.threw, cold.threw || '');
  check('nor with it lit', !lit.threw, lit.threw || '');
  // ⚠ THE CHECK THAT COULD NOT BE MADE ANY OTHER WAY. A typo in this branch draws a perfect
  // picture in every gate that exists and nothing at all in the game.
  check('and a running one pushes a flame and a trail into the sprite layer', lit.sprites > cold.sprites,
    cold.sprites + ' -> ' + lit.sprites + ' lights');
  // ⚠ EVENLY, AND THAT IS THE ASSERTION RATHER THAN A TOTAL. The per-pipe node count is a function
  // of how big the hull lands on screen (six nodes close up, three at range), so pinning the total
  // would pin the LOD tier this stub camera happens to produce. What must hold at every tier is
  // that the pipes are treated ALIKE: a cull that dropped one flank — which is the canvas branch's
  // behaviour, and wrong here because the depth buffer hides the far bank per pixel — leaves four
  // pipes' worth, and four does not divide eight evenly.
  const per = (lit.sprites - cold.sprites) / P1.length;
  check('every zoomie contributes, and they all contribute the same', Number.isInteger(per) && per >= 3,
    (lit.sprites - cold.sprites) + ' lights over ' + P1.length + ' pipes = ' + per.toFixed(2) + ' each');

  // ⚠ AND THE FAR BANK IS NOT CULLED HERE, AT ANY ANGLE. The canvas branch drops a pipe whose
  // projected depth is behind the hull's own centreline, because a painter's queue has no other way
  // to hide it; the depth buffer does it per pixel and correctly, including the half of a flame
  // that stands proud of the sheer. Running the same cull on this branch would DELETE that half —
  // silently, and only from some angles, which is the hardest kind of rendering bug to be told
  // about. Every heading has to hand over the same number of lights.
  const deltaAt = (hdg) => {
    const c0 = ws.craftResidue(craft({ hdg, power: 0, rich: 0, bang: 0 }), { night: 1 });
    const c1 = ws.craftResidue(craft({ hdg, power: 0.9, rich: 0.9, bang: 1 }), { night: 1 });
    return c1.sprites - c0.sprites;
  };
  const byHdg = [0, 35, 90, 145, 180, 270].map((h) => [h, deltaAt(h)]);
  check('and the count does not depend on which way she is pointing',
    byHdg.every(([, n]) => n === byHdg[0][1]),
    byHdg.map(([h, n]) => h + 'deg:' + n).join(' '));
}
console.log(fails ? `\nEXHAUST: ${fails} FAILED` : '\nEXHAUST: all checks passed');
process.exit(fails ? 1 : 0);
