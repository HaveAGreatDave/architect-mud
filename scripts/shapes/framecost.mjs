// framecost — what does one frame of the world actually cost, and has that changed?
//
//   node scripts/shapes/framecost.mjs            # measure, compare against the committed baseline
//   node scripts/shapes/framecost.mjs --write    # accept the current numbers as the new baseline
//   node scripts/shapes/framecost.mjs --detail   # per-case table
//
// THE BUDGET IS CANVAS CALLS, NOT POLYGONS. Two measurements in this renderer's own source say so:
// running a model arm costs ~3.2 ms/frame while QUEUEING its faces costs ~14.6 ms
// (windshield.js), and a headless tally put path CONSTRUCTION at 84% of all canvas2d calls — an
// order of magnitude above the texture blits everyone assumes are the expensive part. So this
// counts calls, by name, over a fixed scene, and holds the total against a committed number.
//
// ⚠ THE SCENE IS OWNED HERE, NOT BORROWED FROM viewRenderSmoke. That smoke's world is edited
// whenever somebody needs a new branch covered — which is right for a paint test and fatal for a
// budget: the baseline would move for reasons that have nothing to do with cost, and the gate would
// be re-blessed every time until it meant nothing. This scene changes only when the budget is
// deliberately re-cut, and changing it is a visible diff on the numbers.
//
// ⚠ AND IT IS NOT A FRAME TIMER. Wall-clock in node against a stub canvas measures the stub. A call
// count is what survives the machine it runs on, and it is the quantity the renderer's own
// optimisations move: the cheap wall branch is ~8 calls where a near textured wall is ~320.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { CAB_VIEW_TUNE } from '../../client/shared/cab-render-tune.js';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASELINE = ROOT + 'scripts/shapes/framecost.json';
const TOL_TOTAL = 0.02;   // 2% on the grand total
const TOL_CASE = 0.06;    // 6% on any single case — noise floor is zero, so this is real drift

// ── THE SCENE ───────────────────────────────────────────────────────────────
// A city block a driver would actually be in: a road with a crossroads, lit and unlit lamps, a
// terrace of shops on one side and offices on the other, one tower, and a water edge. The models
// are picked from the REAL registry rather than invented, because the cost being measured is the
// cost of the buildings that ship.
const R = 8, N = R * 2 + 1;
const SCENE = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R && y === R - 3) return { kind: 'land', biome: 'citycore', road: 1, rd: 'nesw', flr: 0, pw: 1 };
  if (x === R) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1, sl: y % 3 === 0 ? 1 : y % 3 === 1 ? 0 : undefined };
  if (y === R - 3) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ew', flr: 0, pw: 1, sl: x % 2 ? 1 : 0 };
  // The terrace: shops along the near kerb, which is what a cab looks at all day.
  if (x === R - 1 && y % 2 === 0) return { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'east', flr: 2 };
  if (x === R + 1 && y % 2 === 1) return { kind: 'land', biome: 'citycore', bt: 'office', ent: 'west', flr: 6 };
  // Two blocks back: the bigger stuff, which is what a cockpit sees.
  if (x === R - 4 && y % 3 === 0) return { kind: 'land', biome: 'freight', bt: 'warehouse', ent: 'east', flr: 1 };
  if (x === R + 4 && y === R) return { kind: 'land', biome: 'citycore', bt: 'luxtower', ent: 'west', flr: 21 };
  if (x === R + 4 && y % 4 === 0) return { kind: 'land', biome: 'citycore', bt: 'apartment', ent: 'west', flr: 4 };
  if (y === 0) return { kind: 'water', biome: 'coast' };
  return { kind: 'land', biome: 'citycore', flr: 0 };
}));

// ── THE COUNTER ─────────────────────────────────────────────────────────────
// The same shape pathreuse.mjs uses: a Proxy over the real stub context that tallies every method
// call by name. `getContext` is replaced rather than wrapped once, because paintWindshield asks for
// the context every frame.
function counted(el) {
  const inner = el.getContext('2d');
  let T = null;
  const reset = () => (T = { calls: 0, byName: new Map() });
  reset();
  el.getContext = () => new Proxy({}, {
    get(_t, k) {
      const v = inner[k];
      if (typeof v !== 'function') return v;
      return (...a) => {
        T.calls++;
        T.byName.set(k, (T.byName.get(k) || 0) + 1);
        return v(...a);
      };
    },
    set(_t, k, v) { inner[k] = v; return true; },
  });
  return { read: () => T, reset };
}

const GROUPS = {
  // What each group is: the four levers this renderer actually has.
  path: ['beginPath', 'moveTo', 'lineTo', 'closePath', 'rect', 'arc', 'arcTo', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo'],
  paint: ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText'],
  blit: ['drawImage', 'putImageData', 'getImageData'],
  state: ['save', 'restore', 'clip', 'transform', 'setTransform', 'translate', 'scale', 'rotate'],
  grad: ['createLinearGradient', 'createRadialGradient', 'addColorStop'],
};
const groupOf = (name) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(name)) || 'other';

// ── THE SWEEP ───────────────────────────────────────────────────────────────
// Two seats, four headings, day and night. The seats matter more than the headings: the cab reads
// buildings at eye height 0 through its own tune (lodNear 9, wallLodPx 44), the cockpit reads
// sixty of them at once from altitude, and an optimisation that helps one can cost the other.
const HEADINGS = [0, 45, 90, 200];
const SEATS = [
  ['cockpit', { cls: 'prop', phase: 'cruise', height: 0.5, worldBlend: 1 }],
  ['cab', { cls: 'truck', phase: 'ground', height: 0, worldBlend: 1, variant: 'rigid', tier: 2, resFloor: 0.5, resFloorPx: 1, tune: CAB_VIEW_TUNE }],
];

export async function measure({ width = 1280, height = 720 } = {}) {
  const ws = await loadWindshield();
  const el = stubCanvas('__framecost', width, height);
  const C = counted(el);
  const cases = {};

  // ⚠ THE CLOCK IS FROZEN, AND IT HAS TO BE — for two separate reasons.
  //
  // Reproducibility: paintWindshield reads `performance.now()` once per frame and hands it to every
  // animated thing in the world — blinking beacons, smoke plumes, traffic phases, rotor discs. On a
  // live clock the same scene measures a call or two apart every run, which is small enough to
  // ignore and large enough to make a committed baseline a lie.
  //
  // And the adaptive dials: a frozen clock reports a 0 ms frame, so dynamic resolution sits at its
  // ceiling and PERF_DS at 0. That is deliberately the EXPENSIVE end of both dials. A budget held
  // against a load-shedding renderer is a budget that quietly relaxes whenever the machine is slow,
  // which is the opposite of a gate — see the cab's own note about a saturated dial having no
  // authority left.
  const clock = globalThis.performance;
  globalThis.performance = { ...clock, now: () => 1e6 };

  for (const [seat, view] of SEATS) {
    for (const heading of HEADINGS) {
      for (const [lbl, hour] of [['day', 13], ['night', 2]]) {
        const key = `${seat}:${heading}:${lbl}`;
        C.reset();
        // Painted TWICE and only the second frame counted. The first builds every lazy cache this
        // renderer has — wall textures, sign sprites, glow sprites, the shape capture — and a
        // measurement that includes them is measuring startup, which is not the thing being held.
        for (let i = 0; i < 2; i++) {
          if (i === 1) C.reset();
          ws.paintWindshield('__framecost', { ...view, map: SCENE, heading, hour, weather: 'clear', speed: 0.4 });
        }
        const T = C.read();
        const groups = { path: 0, paint: 0, blit: 0, state: 0, grad: 0, other: 0 };
        for (const [name, n] of T.byName) groups[groupOf(name)] += n;
        cases[key] = { calls: T.calls, ...groups };
      }
    }
  }

  globalThis.performance = clock;
  const total = Object.values(cases).reduce((a, c) => a + c.calls, 0);
  return { total, cases, scene: { w: width, h: height, tiles: N * N } };
}

function compare(now, base) {
  const problems = [], notes = [];
  const rel = (a, b) => (b ? (a - b) / b : 0);
  const dTotal = rel(now.total, base.total);
  if (dTotal > TOL_TOTAL) {
    problems.push(`frame cost is up ${(dTotal * 100).toFixed(1)}% — ${base.total} → ${now.total} canvas calls `
      + `(tolerance ${(TOL_TOTAL * 100).toFixed(0)}%). Run with --write only if the rise is intended.`);
  }
  for (const key of Object.keys(now.cases)) {
    const b = base.cases[key];
    if (!b) { notes.push(`new case ${key}`); continue; }
    const d = rel(now.cases[key].calls, b.calls);
    if (d > TOL_CASE) problems.push(`${key}: ${b.calls} → ${now.cases[key].calls} calls (+${(d * 100).toFixed(1)}%)`);
  }
  for (const key of Object.keys(base.cases)) if (!now.cases[key]) problems.push(`case ${key} disappeared from the sweep`);
  return { problems, notes, dTotal };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const write = process.argv.includes('--write');
  const detail = process.argv.includes('--detail');
  const now = await measure();

  if (detail) {
    for (const [k, c] of Object.entries(now.cases)) {
      console.log(`  ${k.padEnd(22)} ${String(c.calls).padStart(7)} calls  ·  path ${String(c.path).padStart(6)} `
        + `paint ${String(c.paint).padStart(5)} blit ${String(c.blit).padStart(5)} state ${String(c.state).padStart(5)} grad ${String(c.grad).padStart(4)}`);
    }
  }
  const pathShare = Object.values(now.cases).reduce((a, c) => a + c.path, 0) / now.total;

  if (write || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 1) + '\n');
    console.log(`framecost — baseline written: ${now.total} canvas calls over ${Object.keys(now.cases).length} frames `
      + `(${(pathShare * 100).toFixed(0)}% of them describing paths).`);
  } else {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const { problems, dTotal } = compare(now, base);
    for (const p of problems) console.error(`  ✗ ${p}`);
    if (problems.length) process.exit(1);
    const move = dTotal <= -0.005 ? ` — ${(-dTotal * 100).toFixed(1)}% cheaper than the baseline` : '';
    console.log(`✓ framecost: ${now.total} canvas calls over ${Object.keys(now.cases).length} frames`
      + ` (${(pathShare * 100).toFixed(0)}% describe paths)${move}.`);
  }
}
