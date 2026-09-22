// groundcontact — a vehicle standing on the ground is geometry, not a card.
//
//   node scripts/shapes/groundcontact.mjs
//   node scripts/shapes/groundcontact.mjs --report
//
// ⚠ THIS EXISTS BECAUSE A BILLBOARD HAS ONE DEPTH. A contact reaches GLASS 2 as a card baked at the
// live camera (`bakeContacts`), and the card IS depth-tested — but `gl/billboards.js` offsets only
// `clip.xy`, so every pixel of it is compared at the ANCHOR's depth. A rig is a tile long. Back one
// into a depot and the anchor crosses the door plane while half the vehicle is still on the other
// side of it, so the whole rig paints over the front wall right up to the moment the whole rig
// disappears behind it. That is "the truck shows through the wall, even the depot", and no probe and
// no bias can fix it: the representation cannot express a vehicle that is partly behind something.
//
// The own ship has not had this problem since it became real triangles in `gl/solids.js`, and a
// contact is the same mesh through the same function. So a GROUND contact goes to the same layer —
// air traffic keeps the card, because something with wings is very often legitimately above a
// roofline and a few hundred faces is not worth paying for a dot on the horizon.
//
// What that leaves is a handover with three silent ways to go wrong, none of which shows in a
// picture: collected too late (the sink is opened INSIDE the world pass and `bakeContacts` runs
// before it, so the claim is made in one pass and honoured in the other), collected twice (a card
// AND geometry, which reads as a faint doubled rig), and claimed but never collected (the flag says
// "already on the depth buffer, do not paint" and nothing drew it — an invisible truck).
import { loadWindshield, stubCanvas, rigOnly } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 1200, H = 560;
stubCanvas('__gc', W, H);

// A depot ahead with warehouse frontage either side — the scene the report is about, and the one
// place in the game where a vehicle is routinely half inside a building.
const N = 41, R = 20, DEPOT = R - 5;
const map = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R && y === DEPOT) return { kind: 'land', biome: 'freight', bt: 'truck_depot', ent: 'north', flr: 1, mark: 'bay', bn: 'TEST DEPOT' };
  if (x === R) return { kind: 'land', biome: 'freight', flr: 0, road: 1, rd: 'ns', surf: 'road' };
  return Math.abs(x - R) <= 2
    ? { kind: 'land', biome: 'freight', flr: 0, bt: 'warehouse', is_building: 1, floors: 3 }
    : { kind: 'land', biome: 'freight', flr: 0 };
}));

// ⚠ THE CAB'S OWN SIZE, NOT THE DEFAULT. `CONTACT_SIZE.truck` is honest for a rig seen from the air
// and the road view multiplies it by seven (see ROAD_RIG_MUL); the bake's 700px guard is measured
// against the drawn box, so a gate using the unmultiplied size is testing a different object.
const RIG = () => ({ id: 1, cls: 'truck', reg: 'T1', dx: 0.2, dy: -2.6, altDiff: 0, groundZ: 0,
  onGround: true, band: 'ground', heading: 0, sizeMul: ws.ROAD_RIG_MUL });
const BOGEY = () => ({ id: 2, cls: 'prop', reg: 'P1', dx: -1.6, dy: -6, altDiff: 400, heading: 0 });

const BASE = {
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.12, fovMul: 1.22,
  hour: 13, weather: 'clear', speed: 0.2, map, heading: 0, resFloor: 1,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 },
};

const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };
globalThis.window.devicePixelRatio = 1;
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, shipWas = ws.RENDER_TUNE.glShip;
const problems = [];

function collect(view, ship) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glShip = ship;
  ws.installGLWorld((cells, cam, o) => {
    seen = { ship: rigOnly(o.ship),
             cards: (o.scatter || []).filter((b) => /^ct:/.test(b.key)).map((b) => b.key),
             ox: cam.ox, oy: cam.oy };
    return null;
  });
  ws.paintWindshield('__gc', view);
  ws.installGLWorld(null);
  return seen;
}

// Same statement as bay.mjs's: the geometry is a pure function of where the vehicle is standing.
// ⚠ AND THE SAME SPLIT ON EXACTNESS. Orbiting re-evaluates the identical expression, so a single
// differing bit is a finding; moving the camera inside its tile takes `dx` down by the offset and
// puts `cam.ox` up by it, and `(a - d) + d` is not `a` in floating point.
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

// ── THE RIG ON ITS OWN ──────────────────────────────────────────────────────
const on = collect({ ...BASE, contacts: [RIG()] }, 1);
if (!on || !on.ship.length) {
  problems.push('the GL frame collected NO geometry for a truck standing on the ground — it is still a single-depth card');
} else {
  let bad = 0, noCol = 0;
  for (const q of on.ship) {
    if (!q.p || q.p.length < 3) { bad++; continue; }
    for (const v of q.p) if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) { bad++; break; }
    if (!q.rgb || q.rgb.length !== 3 || !q.rgb.every(Number.isFinite)) noCol++;
    if (!(q.a > 0) || !Number.isFinite(q.a)) noCol++;
  }
  if (bad) problems.push(`${bad} of ${on.ship.length} collected faces carry a non-finite vertex — that buffer rasterises nothing and throws nothing`);
  if (noCol) problems.push(`${noCol} of ${on.ship.length} collected faces carry no usable colour or alpha`);
  const tall = span(on.ship);
  if (!(tall > 0.02)) problems.push(`the rig is ${tall.toFixed(4)} tiles tall — it is flat, so the local-to-world transform is not being applied`);
  // ⚠ AND IT MUST NOT ALSO BE A CARD. Both paths draw the same vehicle; running both puts a flat
  // photograph of the rig over the rig, which reads as a ghost rather than as a bug.
  if (on.cards.length) problems.push(`the rig arrived as geometry AND as ${on.cards.length} card(s) (${on.cards.join(', ')}) — it is being drawn twice`);
}

// ── AIR TRAFFIC IS SOLID TOO, AND THE BOGEY IS STILL THE CONTROL ───────────
// ⚠ IT USED TO KEEP ITS CARD AND DELIBERATELY NO LONGER DOES. `contactIsSolid` answered "is this
// one on the ground" and now answers `TUNE.glShip !== 0` for EVERY contact, so at glShip 1 there
// are no cards in the scene at all — no per-frame `texImage2D`, and no 700px guard above which a
// close bogey painted over the composited city. This gate asserted the old contract and went red
// on the change rather than on a defect.
//
// ⚠ AND THE CONTROL HAD TO SURVIVE THE REWRITE. The card was doing double duty here: if the bogey
// came back as nothing, the view was not reaching the contact pipeline and every "no geometry"
// answer above meant nothing. Geometry is the control now — the bogey must ADD faces to the scene,
// which is a stronger claim than the card was, because a card only proved `bakeContacts` ran.
const both = collect({ ...BASE, contacts: [RIG(), BOGEY()] }, 1);
if (!both) {
  problems.push('the two-contact scene produced no frame at all — nothing below is measuring what it claims');
} else if (!(both.ship.length > on.ship.length)) {
  problems.push(`adding an airborne contact added no geometry (${both.ship.length} faces against ${on.ship ? on.ship.length : 0} for the rig alone) — the scene is not reaching the contact pipeline, so nothing here is measuring what it claims`);
}
if (both && both.cards.length) {
  problems.push(`glShip 1 still produced ${both.cards.length} card(s) (${both.cards.join(', ')}) — every contact should be triangles, so something is being drawn twice`);
}
if (both && !both.ship.length) problems.push('adding a bogey to the scene cost the rig its geometry');

// ── AND THE WAY OUT STILL WORKS ─────────────────────────────────────────────
// ⚠ A CLAIM NOBODY COLLECTS IS AN INVISIBLE TRUCK. `bakeContacts` skips the card for a contact it
// expects the solids layer to take; with the layer switched off that claim has to be released, or
// the vehicle is neither geometry nor a card nor painted. This is the fail-safe, and it is the one
// failure of the three that a player would report as the truck being gone rather than as a z bug.
const off = collect({ ...BASE, contacts: [RIG()] }, 0);
if (off && off.ship.length) problems.push(`glShip 0 still collected ${off.ship.length} faces — the switch does not reach this path`);
if (off && !off.cards.length) problems.push('glShip 0 left the rig as neither geometry nor a card — the claim was made and never released, so nothing draws it');
// ⚠ AND THE BOGEY TAKES THE SAME WAY OUT, which it never needed while it was always a card.
const offAir = collect({ ...BASE, contacts: [RIG(), BOGEY()] }, 0);
if (offAir && offAir.ship.length) problems.push(`glShip 0 still collected ${offAir.ship.length} faces with air traffic in the scene`);
if (offAir && !offAir.cards.some((k) => /^ct:2/.test(k))) problems.push('glShip 0 left the airborne contact as neither geometry nor a card');

// ── DRIVING PAST IT MUST NOT MOVE IT ────────────────────────────────────────
// The same pair of checks bay.mjs makes, and for the same reason: the collection runs in the
// painter's camera-relative frame and the GL pass is handed that frame plus `cam.ox/oy`, so an
// omitted term lands the vehicle somewhere entirely plausible and slides it as you drive.
const orbit = collect({ ...BASE, contacts: [RIG()], external: true, extYaw: 0.6, extPitch: 0.3, extZoom: 1.2, hideOwnShip: true }, 1);
if (on && on.ship.length && orbit && orbit.ship.length) {
  const d = differs(on.ship, orbit.ship);
  if (d && d.count) problems.push(`orbiting the camera changed the rig's face COUNT (${d.count[0]} vs ${d.count[1]}) — the geometry is camera-dependent`);
  else if (d) problems.push(`orbiting the camera moved ${d.moved} coordinate(s) of the rig, worst ${d.worst.toExponential(2)} tiles — the geometry is camera-dependent`);
}
// ⚠ AND THE CONTACT HAS TO BE HELD STILL IN THE WORLD WHILE THE CAMERA MOVES, WHICH THE OWN SHIP
// NEVER NEEDS. `dx`/`dy` on a contact are CAMERA-RELATIVE — `contactsFor` computes them as the
// vehicle's position minus the cab's — so moving the eye inside its tile and leaving them alone
// genuinely moves the vehicle, and a first draft of this check read that as the bug it was looking
// for (0.64 tiles, exactly the offset). The rig is put back by the same delta, so the only thing
// that changes between the two frames is the frame the geometry is expressed in.
const NUDGE = { x: -0.38, y: 0.44 };
const back = RIG();
back.dx -= (NUDGE.x - BASE.mapOffset.x); back.dy -= (NUDGE.y - BASE.mapOffset.y);
const nudged = collect({ ...BASE, contacts: [back], mapOffset: NUDGE }, 1);
if (!on || !on.ship.length || !nudged || !nudged.ship.length) {
  problems.push('the map-offset comparison collected nothing — it cannot see the thing it is checking');
} else if (Object.is(on.ox, nudged.ox) && Object.is(on.oy, nudged.oy)) {
  problems.push(`both frames reported cam.ox/oy ${on.ox}/${on.oy} — the offset did not change, so this check proves nothing`);
} else {
  const d = differs(on.ship, nudged.ship, 1e-9);
  if (d && d.count) problems.push(`moving the camera within its tile changed the rig's face COUNT (${d.count[0]} vs ${d.count[1]})`);
  else if (d) problems.push(`moving the camera within its tile moved the rig by ${d.worst.toFixed(4)} tiles — cam.ox/oy is not being applied`);
}

ws.installGLWorld(null);
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.glShip = shipWas;
globalThis.performance = clock;

if (REPORT) {
  const row = (label, s) => console.log(`  ${label.padEnd(26)}${String(s ? s.ship.length : '—').padStart(6)} faces   cards: ${s ? (s.cards.join(', ') || 'none') : '—'}`);
  console.log('');
  row('rig alone, glShip 1', on);
  row('rig + bogey', both);
  row('rig alone, glShip 0', off);
  row('rig, orbiting camera', orbit);
  row('rig, camera nudged', nudged);
  if (on && on.ship.length) console.log(`\n  the rig stands ${span(on.ship).toFixed(3)} tiles tall.`);
  console.log('');
}

if (problems.length) {
  console.error(`\n✗ groundcontact — ${problems.length} problem(s):`);
  for (const p of problems) console.error('  · ' + p);
  console.error('\n  A card carries one depth for the whole quad. A vehicle on the ground is a tile long,');
  console.error('  so it needs real triangles — see contactIsSolid / collectSolidContacts.');
  process.exit(1);
}
console.log(`✓ groundcontact: a rig on the ground reaches the GPU as ${on.ship.length} faces standing ${span(on.ship).toFixed(3)} tiles tall`
  + `, air traffic arrives as triangles too, neither camera move shifts the geometry, and glShip 0 hands both back to the card path.`);
