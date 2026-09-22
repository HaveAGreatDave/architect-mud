// bay — the depot shed is geometry now, and both ways it can fail to be are invisible.
//
//   node scripts/shapes/bay.mjs
//   node scripts/shapes/bay.mjs --report
//
// The shed is the one building in GLASS drawn at a fixed size by its own function rather than
// extruded from a storey stack, so it is in `MASS_EXCEPT`, it never reaches the GL mass, and until
// now it was painted on the 2-D canvas AFTER the city was composited — with `markHidden`, an
// all-or-nothing probe, the only thing between it and a warehouse in front of it. A depot is a tile
// wide and a third of a storey tall, so standing behind a row of shops MOST of it is hidden and
// NONE of it is all hidden, and it drew whole. That is "the depot shows thru buildings".
//
// `gl/solids.js` takes it now — the same depth-writing layer the rig goes through — and this checks
// that the geometry arrives, because nothing in the picture says whether it did:
//
//   · COLLECTED TOO LATE is the whole of the first failure. Every other mark is drawn through
//     `emitFace`, which queues a closure that runs at FLUSH — after the GL pass has gone and every
//     sink is null. A shed collected from in there reaches the GPU never, draws nothing and reports
//     nothing, which is the Curtain's own trap. So the bay branch calls the painter INLINE.
//
//   · AND THE WRONG FRAME is the second. `F` answers in the camera-relative tile frame the 2-D
//     painter projects from; the GL pass is handed `camAt`, which is that frame plus `cam.ox/oy`.
//     ⚠ That offset is where the eye sits INSIDE its own tile, so it is always under a tile and a
//     shed built without it lands somewhere entirely plausible — on the ground, the right size, in
//     roughly the right place, sliding a fraction of a tile sideways as you drive at it. A first
//     draft of this gate held the shed against the map window's bounding box, which is the check
//     that reads as watertight and cannot fail: restoring the bug left every vertex well inside it.
//
// ⚠ AND THE CONTROL IS NOT OPTIONAL, for the reason worldresidue records: an empty tally is also
// what comes back when the scene contains no depot. So the GLASS 1 frame has to PAINT one.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__bay', W, H);

// A depot ahead with frontage either side of the approach — the scene the report is about.
const N = 41, R = 20, DEPOT = R - 5;
// …with the shed's row as a parameter, because how far away it is decides whether its ROLLER DOOR
// is open — and the door spill is one of the lights this gate checks the frame of. See `sprAt`.
const mapWith = (row) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R && y === row) return { kind: 'land', biome: 'freight', bt: 'truck_depot', ent: 'north', flr: 1, mark: 'bay', bn: 'TEST DEPOT' };
  if (x === R) return { kind: 'land', biome: 'freight', flr: 0, road: 1, rd: 'ns', surf: 'road' };
  return Math.abs(x - R) <= 2
    ? { kind: 'land', biome: 'freight', flr: 0, bt: 'warehouse', is_building: 1, floors: 3 }
    : { kind: 'land', biome: 'freight', flr: 0 };
}));
const map = mapWith(DEPOT);

const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0.2, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
// ⚠ THE FLOCKS ARE PINNED OFF, AND ANY GATE THAT CENSUSES SPRITES NOW HAS TO DO THIS. A bird
// past its species' `dotPx` is no longer a mesh -- it is one entry in the SPRITE layer, the same
// layer this file reads to prove the depot's six lights reach the GPU. So a flock drifting over the
// scene is counted as the depot's lighting, and the failure names neither birds nor the LOD: it
// says the sprite list is not the depot's alone, which reads like the depot emitting something it
// should not. Measured here as 9 stray sprites with the door shut and 14 with it open, varying with
// the clock because the flocks move. `geese` is the one flag that takes every species down.
//
// ⚠ AND IT IS THE FLOCKS RATHER THAN `faunaDot`. Turning the LOD off puts the birds back as MESHES,
// which then land in the face census instead -- a different check, wrong for the same reason.
ws.RENDER_TUNE.geese = 0;
// ⚠ AND THE STREET VENTS, FOR THE GEESE' REASON EXACTLY. A steam plume is four sprites off a road
// tile with a building near it, which this scene is made of, so switching the vents on by default
// put 14 strays in the shut-door frame and 18 in the open-door one and reddened this gate — a
// depot check failing because somebody turned on the weather two files away. Anything that emits
// sprites into a scene whose sprite list is meant to be one building's has to be pinned here, and
// the list is only ever going to get longer.
ws.RENDER_TUNE.glSteam = 0;
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, bayWas = ws.RENDER_TUNE.glBay;
const problems = [];

// The hook is where the frame hands its sinks over, so it is where "did it arrive" is answerable.
function collect(view, tune) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glBay = tune;
  ws.installGLWorld((cells, cam, o) => {
    seen = { bay: (o.bay || []).slice(),
             // ⚠ THE QUADS, NOT A COUNT. The legends drift in the WRONG FRAME, and a frame error
             // does not change how many of them there are — see the depot-decal check below.
             decals: (o.decals || []).map((q) => ({ key: q.key, p: q.p.map((v) => v.slice()) })),
             sprites: (o.sprites || []).map((q) => [q.x, q.y, q.z]), ox: cam.ox, oy: cam.oy };
    return null;
  });
  ws.paintWindshield('__bay', view);
  ws.installGLWorld(null);
  return seen;
}

// Every coordinate of one collection against another. Both of the checks below are the same
// statement — the shed's geometry is a pure function of the tile it stands on — asked of two
// different things that ought not to change it.
//
// ⚠ AND ONLY ONE OF THEM MAY ASK IT EXACTLY. Orbiting evaluates the identical expression on the
// identical inputs, so a single differing bit is a real finding and `eps` is 0. Moving the camera
// inside its tile does not: `dx` goes down by the offset and `cam.ox` goes up by it, and in floating
// point `(a - d) + d` is not `a`. That residue is ~1e-16 of a tile against a mutation worth 0.64 of
// one, so the bar is nine orders of magnitude clear of both — a tolerance here, and nowhere else.
function differs(A, B, eps = 0) {
  if (A.length !== B.length) return { count: [A.length, B.length] };
  let moved = 0, worst = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i].p, b = B[i].p;
    if (a.length !== b.length) { moved++; continue; }
    for (let k = 0; k < a.length; k++) for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[k][c] - b[k][c]);
      if (d > worst) worst = d;
      if (eps ? d > eps : !Object.is(a[k][c], b[k][c])) moved++;
    }
  }
  return moved ? { moved, worst } : null;
}

const span = (list) => {
  let a = Infinity, b = -Infinity;
  for (const q of list) for (const v of q.p) { if (v[2] < a) a = v[2]; if (v[2] > b) b = v[2]; }
  return b - a;
};

const on = collect({ ...BASE }, 1);

if (!on || !on.bay.length) {
  problems.push('the GL frame collected NO shed geometry — it reaches neither the depth buffer nor the reflection');
} else {
  let bad = 0, noCol = 0;
  for (const q of on.bay) {
    if (!q.p || q.p.length < 3) { bad++; continue; }
    let ok = true;
    for (const v of q.p) if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) { ok = false; break; }
    if (!ok) bad++;
    if (!q.rgb || q.rgb.length !== 3 || !q.rgb.every(Number.isFinite)) noCol++;
    if (!(q.a > 0) || !Number.isFinite(q.a)) noCol++;
  }
  if (bad) problems.push(`${bad} of ${on.bay.length} collected faces carry a non-finite vertex — that buffer rasterises nothing and throws nothing`);
  if (noCol) problems.push(`${noCol} of ${on.bay.length} collected faces carry no usable colour or alpha`);
  // A shed is a shed: eaves at 0.30 and a ridge at 0.43, so the set has to stand up.
  const tall = span(on.bay);
  if (!(tall > 0.2)) problems.push(`the shed is ${tall.toFixed(3)} tiles tall — it is flat, so the local-to-world transform is not being applied`);
}

// ── ⚠ DRIVING PAST IT MUST NOT MOVE IT, WHICH IS HOW cam.ox/oy IS CHECKED ────────────────────
//
// `mapOffset` is where the camera sits INSIDE its own centre tile, so changing it moves the eye and
// moves every tile's camera-relative `dx`/`dy` by the same amount the other way. `cam.ox`/`cam.oy`
// ARE that offset, and adding them is what converts the painter's camera-relative frame into the
// map-window frame the GL pass is handed. The two terms cancel exactly — which is the point, and
// is also the only way to see the addition at all from out here: the offset is SUB-TILE, so a shed
// built without it is still comfortably inside the map window and no bounding box will ever notice.
// Drop the addition and the depot slides across the ground as you drive up to it.
const nudged = collect({ ...BASE, mapOffset: { x: -0.38, y: 0.44 } }, 1);
if (!on || !on.bay.length || !nudged || !nudged.bay.length) {
  problems.push('the map-offset comparison collected nothing — it cannot see the thing it is checking');
} else if (Object.is(on.ox, nudged.ox) && Object.is(on.oy, nudged.oy)) {
  problems.push(`both frames reported cam.ox/oy ${on.ox}/${on.oy} — the offset did not change, so this check proves nothing`);
} else {
  const d = differs(on.bay, nudged.bay, 1e-9);
  if (d && d.count) problems.push(`moving the camera within its tile changed the face COUNT (${d.count[0]} vs ${d.count[1]})`);
  else if (d) problems.push(`moving the camera within its tile moved ${d.moved} of the shed's coordinates (worst ${d.worst.toExponential(2)} tiles) — cam.ox/oy is not being applied, so the depot slides across the ground as you drive at it`);
}

// ── ⚠ …AND THE LEGENDS PAINTED ON ITS FLOOR GO TO THE OTHER SINK, IN THE OTHER FRAME ──────
//
// The shed feeds THREE GL layers out of one function, and they are not all handed the same camera.
// `drawSolids` gets `camAt`, the camera shifted by `ox`/`oy`, because the mass buffer is built at
// map-window tiles so it can be cached; `drawDecals` gets the PLAIN camera, because every other
// decal in the renderer comes back through `cam.unproj` and is therefore in the camera's own
// craft-relative frame. So the check above — the shell must carry the offset — has an exact mirror
// image: the floor stencils must NOT, and for months they did.
//
// ⚠ AND THIS IS THE FAILURE THE COUNT CANNOT SEE, which is why the decals were collected as a
// length until now. The same five quads are pushed either way; they are simply `(ox, oy)` from
// where they belong. `ox` is where the RIG sits inside the map window — it grows as you drive and
// snaps back when the window recentres — so the legends slid across the city WITH THE TRUCK while
// the yellow lane paint beside them, which goes to the solids sink, stayed on the depot floor.
// Reported exactly that way: the depot markings are travelling with the truck.
//
// A fixed thing on a fixed tile does not move, so converted into the map window it must sit still
// under the same nudge. The bar is 0.01 tiles because it is not all exact: the floor legends are
// authored world quads and hold to the last bit, while the NAME BOARD comes back through
// `cam.unproj` with a pull, which slides a corner along its own view ray — a different ray from a
// different eye — and so moves by about 5e-4. The mutation is worth 0.64 of a tile.
//
// ⚠ AND THE SET IS TAKEN BY DIFFERENCE AGAINST `glBay 0`, NEVER BY NAMING KEYS. The sink holds
// every sign in the scene; the depot's own are the ones that stop being pushed when the shed goes
// back to the canvas. Naming `st:1` would pin a texture id that is assigned in bake order.
let nLegend = 0;
const noBay = collect({ ...BASE }, 0);
if (!on || !noBay) {
  problems.push('the depot-decal comparison collected nothing — it cannot see the thing it is checking');
} else {
  const had = new Set(noBay.decals.map((q) => q.key));
  const mine = on.decals.filter((q) => !had.has(q.key));
  // ⚠ AND THE CONTROL HAS TO NAME THE FLOOR, NOT JUST "a decal". The shed contributes two kinds
  // and only one of them was ever in the wrong frame: the legends go through `bayFace`, and the
  // NAME BOARD goes through `emitSurfaceText`, which recovers its quad from `cam.unproj` and was
  // therefore always right. So "the depot pushed something" is satisfied by the board alone —
  // stop pushing the legends entirely and this check goes green while covering nothing. A legend
  // is the flat one: authored at `MZ`, a hair above the slab, with all four corners at that height.
  const flat = mine.filter((q) => q.p.every((v) => Math.abs(v[2] - q.p[0][2]) < 1e-6 && v[2] < 0.05));
  nLegend = flat.length;
  if (!flat.length) {
    problems.push('the shed contributed no GROUND decals — the stencilled bay legends are not reaching the GPU at all, so the frame check below would be measuring the name board and nothing else');
  } else if (!nudged) {
    problems.push('the depot-decal comparison has no nudged frame to compare against');
  } else {
    const at = (L) => { const m = new Map(); for (const q of L) { if (!m.has(q.key)) m.set(q.key, []); m.get(q.key).push(q); } return m; };
    const A = at(on.decals), B = at(nudged.decals);
    let moved = 0, worst = 0, n = 0, gone = 0;
    for (const k of new Set(mine.map((q) => q.key))) {
      const la = A.get(k) || [], lb = B.get(k) || [];
      if (la.length !== lb.length) { gone++; continue; }
      for (let i = 0; i < la.length; i++) for (let c = 0; c < la[i].p.length; c++) {
        const a = la[i].p[c], b = lb[i].p[c];
        const d = Math.max(Math.abs((a[0] + on.ox) - (b[0] + nudged.ox)), Math.abs((a[1] + on.oy) - (b[1] + nudged.oy)));
        n++; if (d > worst) worst = d;
        if (d > 0.01) moved++;
      }
    }
    if (gone) problems.push(`${gone} of the shed's decal groups changed size when the camera moved within its tile`);
    if (moved) problems.push(`moving the camera within its tile slid ${moved} of ${n} depot decal corners by up to ${worst.toFixed(3)} tiles — the floor legends are being pushed in MAP-WINDOW tiles, and drawDecals is handed the unshifted camera, so they travel across the city with the rig`);
  }
}

// ── ⚠ …AND ITS HIGH-BAYS ARE IN A THIRD SINK, WHICH TAKES THE CAMERA'S FRAME TOO ─────────
//
// Same statement as the decals, asked of `SPRITE_SINK`: `drawSprites` is handed the unshifted
// camera as well, and `pickLights` is the ONE place that converts a light into the mesh's frame,
// by adding `ox`/`oy` itself. So a lamp pushed with the offset already on it hangs `(ox, oy)` from
// the shed it is bolted inside — which is where the rig sits in the window, so the high-bays drift
// across the yard with the truck exactly as the floor legends did.
//
// ⚠ AND THE SCENE IS THE CONTROL: with `glBay 0` the shed's glows go back to being canvas
// gradients, so it contributes NO sprites at all and every sprite in this frame is the depot's.
// That is asserted rather than assumed — a warehouse that grew a lamp would otherwise put a light
// that legitimately moves with the camera into a list this compares position by position.
//
// ⚠ AND IT IS ASKED TWICE, AT TWO DISTANCES, BECAUSE THE DOOR SPILL IS A FOURTH LIGHT AND THE
// SCENE ABOVE DOES NOT CONTAIN IT. `bayDoorOpen` is a function of how close the rig is, so from
// five tiles out the roller door is shut and the spill is never pushed — a mutation to that one
// line passed a green gate while the three lamps beside it were caught. Pulled right up to the
// shed the door is open, which is asserted below as a COUNT rather than assumed. ⚠ And it has to
// be one tile rather than two: at two the nudge itself crosses the threshold and shuts the door,
// so the comparison fails on a changed sprite count instead of on a frame.
const sprAt = (D, label) => {
  const m = mapWith(D);
  const a = collect({ ...BASE, map: m }, 1);
  const b = collect({ ...BASE, map: m, mapOffset: { x: -0.38, y: 0.44 } }, 1);
  const none = collect({ ...BASE, map: m }, 0);
  if (!a || !b || !none) { problems.push(`the depot-sprite comparison (${label}) collected nothing`); return 0; }
  if (none.sprites.length) {
    problems.push(`${none.sprites.length} sprites survive glBay 0 (${label}), so this frame's sprite list is not the depot's alone and the check would be comparing somebody else's lights`);
    return 0;
  }
  if (!a.sprites.length) {
    problems.push(`the shed contributed no sprites (${label}) — its high-bays are not reaching the GPU, so this check would prove nothing`);
    return 0;
  }
  if (a.sprites.length !== b.sprites.length) {
    problems.push(`the shed's sprite count changed with the camera offset (${label}: ${a.sprites.length} vs ${b.sprites.length})`);
    return a.sprites.length;
  }
  let moved = 0, worst = 0;
  for (let i = 0; i < a.sprites.length; i++) {
    const u = a.sprites[i], v = b.sprites[i];
    const d = Math.max(Math.abs((u[0] + a.ox) - (v[0] + b.ox)), Math.abs((u[1] + a.oy) - (v[1] + b.oy)), Math.abs(u[2] - v[2]));
    if (d > worst) worst = d;
    if (d > 1e-9) moved++;
  }
  if (moved) problems.push(`moving the camera within its tile slid ${moved} of ${a.sprites.length} depot lights (${label}) by up to ${worst.toFixed(3)} tiles — they are being pushed in MAP-WINDOW tiles, and drawSprites is handed the unshifted camera, so the shed's own lighting travels with the rig`);
  return a.sprites.length;
};
const nFar = sprAt(DEPOT, 'door shut');
const nNear = sprAt(R - 1, 'door open');
// The control for the second scene: if pulling up to the shed does not add a light, the door did
// not open and the spill is not being checked by anything.
if (nFar && nNear && nNear <= nFar) {
  problems.push(`the near scene collected ${nNear} lights against ${nFar} from five tiles out — the roller door did not open, so the door spill is not covered`);
}

// ORBITING MUST NOT MOVE A BUILDING. The shed is a fixed thing on a fixed tile and its geometry is
// a pure function of that tile, so two camera angles have to agree on every coordinate — exactly,
// because these are the same expression evaluated twice. This is the check that caught the rig's
// reflection rotating with the eye, and a building is the stronger case for it.
const orbitA = collect({ ...BASE, external: true, extYaw: 0, extPitch: 0.3, extZoom: 1 }, 1);
const orbitB = collect({ ...BASE, external: true, extYaw: 90, extPitch: 0.3, extZoom: 1 }, 1);
if (!orbitA || !orbitB || !orbitA.bay.length || !orbitB.bay.length) {
  problems.push('the orbit comparison collected nothing — it cannot see the thing it is checking');
} else {
  const d = differs(orbitA.bay, orbitB.bay);
  if (d && d.count) problems.push(`orbiting changed the face COUNT (${d.count[0]} vs ${d.count[1]}) — the shed is being rebuilt against the camera`);
  else if (d) problems.push(`orbiting the camera moved ${d.moved} of the shed's coordinates (worst ${d.worst.toFixed(3)} tiles) — a building is following the eye`);
}

// THE OFF SWITCH, which has to be the frame that shipped before this layer existed — and it is also
// the CONTROL: with the shed back on the canvas, the canvas has to be painting one. An empty GL
// tally beside an empty canvas tally is a scene with no depot in it, not a clean frame.
let offBay = 0;
ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glBay = 0;
ws.installGLWorld((cells, cam, o) => { offBay = (o.bay || []).length; return null; });
ws.paintWindshield('__bay', BASE);
globalThis.window.__emitWhoStart();
ws.paintWindshield('__bay', BASE);
const rows = globalThis.window.__emitWho();
ws.installGLWorld(null);

if (offBay) problems.push(`glBay 0 still collected ${offBay} faces — the off switch is not an off switch`);
const painted = Array.isArray(rows) && rows.some((l) => l.includes('emitMarked'));
if (!painted) problems.push('with glBay 0 the canvas queued no mark — the scene does not contain a depot, so an empty GL tally would mean nothing');

ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.glBay = bayWas;
globalThis.performance = clock;

if (REPORT && on) {
  console.log(`\n  shed faces on the GPU: ${on.bay.length}`);
  console.log(`  decals (the floor legends + the name board): ${on.decals.length}`);
  console.log(`  sprites (the high-bays, their pools, the door spill): ${on.sprites.length}`);
  console.log(`  canvas queue with glBay 0: ${Array.isArray(rows) ? rows.filter((l) => l.includes('emitMarked')).join(' | ') : rows}\n`);
}

if (problems.length) {
  console.error('\n✗ bay — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  The shed is not painted on the canvas any more, so a failure here is a depot that');
  console.error('  is simply not in the frame — no error, no warning, an empty tile where a building is.');
  process.exit(1);
}
console.log(`✓ bay: the depot reaches the GPU as ${on.bay.length} faces standing ${span(on.bay).toFixed(2)} tiles tall; neither orbiting the camera nor moving it within its tile shifts any of them; its ${nLegend} floor legends and ${on.sprites.length} lights reach the decal and sprite layers in the CAMERA's frame and hold still in the map window under the same nudge; glBay 0 collects none, and the canvas control still paints one.`);
