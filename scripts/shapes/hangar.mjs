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
//   · THE DOOR OPENS FOR AN AEROPLANE. The occupant list used to take trucks only, so an aircraft
//     rolling at a hangar door found it shut in the picture and open in nothing.
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
globalThis.performance = { ...clock, now: () => 1e6 };
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
  const classes = [['prop'], ['heavy'], ['gunship'], ['divebomber'], ['locust'], ['grasshopper'], ['ultralight'], ['drake'], ['heli'], ['heli', true]];
  const fits = [];
  for (const [cls, armed] of classes) {
    const f = ws.hangarFit(cls, !!armed);
    const name = cls + (armed ? ' (armed)' : '');
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

  // ── 4. THE DOOR OPENS FOR AN AEROPLANE ───────────────────────────────────────
  // The own ship sits at the frame origin; put the hangar's doorway just ahead of it and ask.
  const cellN = { ...AIR, ent: 'south' };
  ws.setBayVehicles({ cls: 'prop' });
  const openNear = ws.bayDoorOpen(0, -(D.HL + 0.3), cellN);
  ws.setBayVehicles({ cls: 'prop' });
  const openFar = ws.bayDoorOpen(0, -(D.HL + 6), cellN);
  // …and from INSIDE it is up while she stands on the hangar floor. The sensor measures her centre
  // and her nose is up to half a tile ahead of it, so the truck's 0.40 had her nose through the
  // door before it lifted.
  ws.setBayVehicles({ cls: 'prop' });
  const openInside = ws.bayDoorOpen(0, 0, cellN);
  ws.setBayVehicles(null);
  if (!(openInside > 0.99)) problems.push(`an aircraft parked in the middle of the hangar leaves its door ${openInside.toFixed(2)} open: her nose meets it before it lifts`);
  if (!(openNear > 0.5)) problems.push(`an aircraft 0.3 tiles off the hangar door leaves it ${openNear.toFixed(2)} open: the door does not see aeroplanes`);
  if (!(openFar < 0.01)) problems.push(`an aircraft six tiles away leaves the hangar door ${openFar.toFixed(2)} open: it should be shut`);

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
