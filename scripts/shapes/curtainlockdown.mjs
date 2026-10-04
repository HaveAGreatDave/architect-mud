// curtainlockdown — does the Curtain shut and turn red when the city is locked down?
//
//   node scripts/shapes/curtainlockdown.mjs
//
// The ESP puts `cld` on every Curtain and gate tile (deriveSurfaceCell). Three claims, each silent
// in the direction it fails:
//
// 1. THE GATE IS SOLID. `curtainTopZAt` lets a rig through the gate tile, and only `cld` closes it.
//    Without it the field is drawn across the road and a truck drives through it.
// 2. THE WALL GOES RED, ON THE GPU. Every segment reaches CURTAIN_SINK with `red` set, and with the
//    lockdown off none of them do. A flag that never reaches the shader draws the normal blue wall.
// 3. A FRAME WITH EVERYTHING IN IT PAINTS. Gate, corner, both ends, a straight run and the lock's
//    shut door, all in lockdown, through the real world pass. These drawers only run their
//    lockdown branches here.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ws = await loadWindshield();
const { curtainTopZAt, CURTAIN_H } = ws;
const fails = [];
const check = (name, ok, detail = '') => { if (!ok) fails.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// ── 1. THE GATE ─────────────────────────────────────────────────────────────
{
  const gate = { mark: 'gate', cur: 'ew' };
  check('the gate is a way through when the city is open', curtainTopZAt(0, 0, gate, 0, 0) === 0);
  check('the gate is shut in lockdown', curtainTopZAt(0, 0, { ...gate, cld: 1 }, 0, 0) === CURTAIN_H,
    'a rig drives through the closed field');
}

// ── 2 and 3. A PAINTED FRAME ────────────────────────────────────────────────
{
  const CW = 320, CH = 200, N = 25, CR = 12;
  stubCanvas('__cl', CW, CH);
  // An east-west run across the view, a gate in the middle of it, a corner turning north at the
  // west end and a free end at the east one; the lock's outer tile in front of the gate.
  const scene = (cld) => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    const base = { kind: 'land', biome: 'parkland', flr: 0 };
    const row = CR - 4;
    if (y === row - 1 && x === CR - 3) return { ...base, cur: 's', cld };              // free end, north arm
    if (y === row && x >= CR - 3 && x <= CR + 3) {
      const cur = x === CR - 3 ? 'ne' : x === CR + 3 ? 'w' : 'ew';
      return x === CR ? { ...base, mark: 'gate', cur, cld } : { ...base, cur, cld };
    }
    if (y === row + 2 && x === CR) {
      return { ...base, road: true, mark: 'lock', lk: { k: 'deck', seg: 0, wl: 'ews', st: 'green', dn: cld ? 's' : undefined, mo: cld ? undefined : 's', ld: cld, he: 'ns' } };
    }
    return base;
  }));
  const view = (map) => ({
    cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height: 0, eyeH: 0.3,
    hour: 22, weather: 'clear', speed: 0, map, heading: 0,
    mapCenter: { x: 100, y: 100 }, mapOffset: { x: 0, y: 0 },
  });
  const glCanvas = globalThis.document.createElement('canvas');
  glCanvas.width = CW; glCanvas.height = CH;
  const was = { gl: ws.RENDER_TUNE.gl, floor: ws.RENDER_TUNE.glFloor };
  let seg = null;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld((cells, cam, o) => { seg = o.curtain || []; return { faces: 1, canvas: glCanvas }; });
  const frame = (cld) => {
    const v = view(scene(cld));
    try { for (let i = 0; i < 2; i++) { seg = null; ws.paintWindshield('__cl', v); } }
    catch (e) { return { threw: e.stack || String(e) }; }
    return { n: seg ? seg.length : 0, red: seg ? seg.filter((s) => s.red).length : 0 };
  };
  const open = frame(undefined), shut = frame(1);
  ws.installGLWorld(null);
  ws.RENDER_TUNE.gl = was.gl; ws.RENDER_TUNE.glFloor = was.floor;

  check('an open frame paints', !open.threw, open.threw);
  check('a locked-down frame paints', !shut.threw, shut.threw);
  if (!open.threw && !shut.threw) {
    check('the scene holds a wall', open.n > 0, `${open.n} segments`);
    check('an open wall is not red', open.red === 0, `${open.red} red of ${open.n}`);
    check('a locked-down wall is red, every segment', shut.n > 0 && shut.red === shut.n, `${shut.red} red of ${shut.n}`);
  }
}

if (fails.length) {
  console.error(`\n✗ curtainlockdown — ${fails.length} failure${fails.length === 1 ? '' : 's'}:`);
  for (const f of fails) console.error(`    ${f}`);
  process.exit(1);
}
console.log('  curtainlockdown: in lockdown the gate is shut, the wall is red, and the frame paints');
