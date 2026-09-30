// hangar: the aircraft hangar is the depot shed at aircraft scale, and it has to hold an aircraft.
//
//   node scripts/shapes/hangar.mjs
//
// An airfield's hangar tile (`flags.aircraft_hangar`) becomes a `bay` mark with `bk: 'air'`, and
// drawVehicleBay draws it from the HANGAR_BAY dimensions instead of the truck shed's. Everything the
// bay gate proves about the shed (it reaches the GPU, it is a function of its tile and not of the
// camera) is proved again here for the other size, plus the three things only a hangar has to do:
//
//   · EVERY AIRFRAME FITS THROUGH THE DOOR. The own ship is drawn 1.9x its contact size, so a
//     Leviathan is most of a tile across. A hangar whose door is narrower than the span of the
//     thing it exists to hold is a hangar you taxi out of through the wall.
//   · …AND UNDER THE DOOR HEAD, AND INSIDE THE SHED, nose to tail. The head climbs into the gable,
//     so it is checked against her profile across the span, not a box as tall as her fin.
//   · THE DOOR OPENS FOR AN AEROPLANE ARRIVING OR LEAVING, AND ONLY THEN. The occupant list used to
//     take trucks only, so an aircraft rolling at a hangar door found it shut. Then the door covered
//     the whole shed from inside, so it stood open all the time an aircraft was parked in it. Now it
//     has a motor and a memory (airDoorOpen): up for an approach, for an engine running on the floor
//     and for one that came in through it; down for one put on the floor cold.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const W = 640, H = 360;
stubCanvas('__hangar', W, H);

const N = 41, R = 20, SHED = R - 3;
const AIR = { kind: 'land', biome: 'airfield', bt: 'hangar', ent: 'north', flr: 1, mark: 'bay', bk: 'air', bn: 'TEST HANGAR' };
const mapWith = (row) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R && y === row) return { ...AIR };
  if (x === R) return { kind: 'field', biome: 'airfield', flr: 0, surf: 'asphalt' };
  return { kind: 'land', biome: 'airfield', flr: 0 };
}));
const map = mapWith(SHED);

const BASE = {
  cls: 'prop', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.24, fovMul: 1,
  hour: 13, weather: 'clear', speed: 0, map, heading: 0,
  mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0.1, y: -0.2 },
};

const clock = globalThis.performance;
let NOW = 1e6;   // the hangar door takes time to travel, so section 4 moves this on
globalThis.performance = { ...clock, now: () => NOW };
// The same pins the bay gate takes, for the same reason: this scene's sprite and face lists are
// meant to be one building's, and birds and vents would be counted as its own.
ws.RENDER_TUNE.geese = 0;
ws.RENDER_TUNE.glSteam = 0;
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, bayWas = ws.RENDER_TUNE.glBay;
const problems = [];

function collect(view) {
  let seen = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1; ws.RENDER_TUNE.glBay = 1;
  ws.installGLWorld((cells, cam, o) => { seen = { bay: (o.bay || []).map((q) => ({ p: q.p.map((v) => v.slice()), rgb: q.rgb, a: q.a })) }; return null; });
  ws.paintWindshield('__hangar', view);
  ws.installGLWorld(null);
  return seen;
}
const zSpan = (list) => {
  let a = Infinity, b = -Infinity;
  for (const q of list) for (const v of q.p) { if (v[2] < a) a = v[2]; if (v[2] > b) b = v[2]; }
  return b - a;
};

try {
  // ── 1. IT ARRIVES, AND IT IS A HANGAR'S HEIGHT ────────────────────────────────
  const D = ws.bayDims(AIR), T = ws.bayDims({ mark: 'bay' });
  if (D === T) problems.push('bayDims gives an aircraft hangar the truck shed\'s dimensions');
  const on = collect({ ...BASE });
  if (!on || !on.bay.length) problems.push('the GL frame collected NO hangar geometry');
  else {
    let bad = 0;
    for (const q of on.bay) if (!q.p.every((v) => v.every(Number.isFinite)) || !(q.a > 0)) bad++;
    if (bad) problems.push(`${bad} of ${on.bay.length} hangar faces carry a non-finite vertex or no alpha`);
    const tall = zSpan(on.bay);
    if (Math.abs(tall - D.RIDGE) > 0.03) problems.push(`the hangar stands ${tall.toFixed(3)} tall against a ridge of ${D.RIDGE}: it is being drawn at the wrong size`);
  }

  // ── 2. IT IS A FUNCTION OF ITS TILE, NOT OF THE CAMERA ───────────────────────
  // Orbiting the view must not change the geometry: the same statement the bay gate makes.
  const turned = collect({ ...BASE, heading: 70 });
  if (on && turned && on.bay.length !== turned.bay.length) problems.push(`orbiting the camera changed the hangar's face count (${on.bay.length} vs ${turned.bay.length})`);

  // ── 3. EVERY AIRFRAME FITS ───────────────────────────────────────────────────
  const MARGIN = 0.01;
  // The Leviathan has her own shed (the heavy bay, `bk: 'heavy'`); everything else goes in the
  // regular one, and she is checked against both so the heavy bay can't quietly stop holding her.
  const HEAVY = { ...AIR, bk: 'heavy' }, DH = ws.bayDims(HEAVY);
  if (DH === D) problems.push('bayDims gives a heavy bay the regular hangar\'s dimensions');
  const classes = [['prop'], ['heavy', false, DH], ['gunship'], ['divebomber'], ['locust'], ['grasshopper'], ['ultralight'], ['drake'], ['heli'], ['heli', true]];
  const fits = [];
  for (const [cls, armed, dims] of classes) {
    const f = ws.hangarFit(cls, !!armed);
    const name = cls + (armed ? ' (armed)' : '') + (dims ? ' (heavy bay)' : '');
    const D = dims || ws.bayDims(AIR);
    if (!f || !Number.isFinite(f.wid) || !Number.isFinite(f.top)) { problems.push(`hangarFit(${name}) gave no answer`); continue; }
    fits.push(`${name} ${(2 * f.wid).toFixed(2)}x${(2 * f.len).toFixed(2)}x${f.top.toFixed(2)}`);
    if (f.wid > D.DOOR_W - MARGIN) problems.push(`the ${name} is ${(2 * f.wid).toFixed(3)} tiles across and the hangar door is ${(2 * D.DOOR_W).toFixed(3)}: she does not fit through it`);
    if (f.top > D.DOOR_H - MARGIN) problems.push(`the ${name} stands ${f.top.toFixed(3)} tall and the door head is at ${D.DOOR_H}: her tail hits it`);
    // The head follows the gable, so it is lower out toward the jambs: every point of her has to
    // pass under the head at its own distance off the centreline (fin in the middle, wingtips out
    // wide). Checking vertices is exact, since the head is concave and a straight edge between two
    // vertices under it stays under it.
    let worst = null;
    for (const [y, z] of f.prof || []) {
      const room = ws.bayDoorHead(y, D) - MARGIN - z;
      if (room < 0 && (!worst || room < worst.room)) worst = { y, z, room };
    }
    if (worst) problems.push(`the ${name} has a point ${worst.z.toFixed(3)} up at ${worst.y.toFixed(3)} off her centreline, and the door head there is ${ws.bayDoorHead(worst.y, D).toFixed(3)}: she hits the gable`);
    if (f.len > D.HL - MARGIN) problems.push(`the ${name} is ${(2 * f.len).toFixed(3)} tiles long and the hangar is ${(2 * D.HL).toFixed(3)} deep`);
  }

  // ── 4. THE DOOR: SHUT UNLESS SOMETHING IS ARRIVING OR LEAVING ────────────────
  // The own ship sits at the frame origin and the shed is put around her. The door takes time to
  // travel, so each step runs `secs` of 50 ms frames and reads the last one. A null view resets
  // every door's memory.
  const cellN = { ...AIR, ent: 'south' };
  const NEAR = [0, -(D.HL + 0.3)], FAR = [0, -(D.HL + 6)], FLOOR = [0, 0];
  const cold = { cls: 'prop' }, running = { cls: 'prop', altOn: true };
  const step = (secs, view, [dx, dy]) => {
    let o = 0;
    for (let t = 0; t < secs * 1000; t += 50) { NOW += 50; ws.setBayVehicles(view); o = ws.bayDoorOpen(dx, dy, cellN); }
    return o;
  };
  ws.setBayVehicles(null);
  const openNear = step(3, running, NEAR);
  const openAway = step(3, running, FAR);   // …and she rolls on down the taxiway
  ws.setBayVehicles(null);
  const openFar = step(3, running, FAR);
  ws.setBayVehicles(null);
  const openPut = step(3, cold, FLOOR);     // Launch and Maintain: stood on the floor, cold
  const openStart1 = step(0.05, running, FLOOR);
  const openStart = step(3, running, FLOOR);
  ws.setBayVehicles(null);
  step(3, running, NEAR);
  const openTaxiedIn = step(3, cold, FLOOR);   // came in through it, then shut down on the floor
  ws.setBayVehicles(null);
  if (!(openNear > 0.99)) problems.push(`an aircraft 0.3 tiles off the hangar door leaves it ${openNear.toFixed(2)} open: the door does not see aeroplanes`);
  if (!(openAway < 0.01)) problems.push(`an aircraft that rolled six tiles away from the hangar leaves its door ${openAway.toFixed(2)} open: it should come down behind her`);
  if (!(openFar < 0.01)) problems.push(`an aircraft six tiles away leaves the hangar door ${openFar.toFixed(2)} open: it should be shut`);
  if (!(openPut < 0.01)) problems.push(`an aircraft put on the hangar floor cold leaves its door ${openPut.toFixed(2)} open: it should be shut until she leaves`);
  if (!(openStart1 < 0.1)) problems.push(`the hangar door is ${openStart1.toFixed(2)} open one frame after her engine starts: it should roll up, not appear`);
  if (!(openStart > 0.99)) problems.push(`an aircraft on the hangar floor with her engine running leaves its door ${openStart.toFixed(2)} open: she can't get out`);
  if (!(openTaxiedIn > 0.99)) problems.push(`an aircraft that taxied in and shut down leaves its door ${openTaxiedIn.toFixed(2)} open: it should stay up behind her`);

  if (!problems.length) console.log(`✓ hangar: ${on.bay.length} faces, ${D.RIDGE} to the ridge, eaves ${D.WALL}, door ${(2 * D.DOOR_W).toFixed(2)}x${D.DOOR_H} (${ws.bayDoorHead(D.DOOR_W, D).toFixed(2)} at the jambs); fits ${fits.join(', ')}`);
} finally {
  ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.glBay = bayWas;
  globalThis.performance = clock;
}

if (problems.length) {
  console.error(`✗ hangar: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
