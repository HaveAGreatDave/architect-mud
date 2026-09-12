// dprsize — does anything GLASS 2 sizes in PIXELS change size when only the display ratio moves?
//
//   node scripts/shapes/dprsize.mjs            # gate
//   node scripts/shapes/dprsize.mjs --detail   # the table
//
// ⚠ THIS EXISTS BECAUSE THE SOUTH GATE CHANGED SIZE ON PROD BETWEEN TWO SCREENSHOTS OF A PARKED
// HELICOPTER. Three GL layers size themselves in pixels rather than in world units — the lights
// (gl/sprites.js), the wires (gl/strokes.js) and the billboards (gl/billboards.js) — and all three
// convert a pixel offset to clip space with `2.0 / uViewport`, handed the CANVAS's viewport, which
// is in DEVICE pixels. So a producer must push device pixels. `pushLight` and `pushStroke` did.
// All FOUR billboard producers did not, so every landmark, every scatter species, the rooftop
// marquee neon and every air contact rendered at 1/dpr of the size the 2-D painter draws them.
//
// ⚠ AND IT IS NOT A HIDPI-ONLY BUG, which is why it was worth a gate of its own rather than a
// one-line fix. The ratio the layers divide by is `baseDpr * st.resStep`, and `resStep` is the
// adaptive frame-time dial — so the error is not a constant, it MOVES. The flight sim's floor is
// 0.6, a 1.67x swing on a landmark that has not moved and a scene that has not changed.
//
// ⚠ AND EVERY EXISTING HARNESS IS BLIND TO IT, because the error is exactly ZERO at dpr 1 and
// `dom-stub` sets `devicePixelRatio: 1`, as does every Modelshop scene. That is the same trap the
// camera matrix fell into when it was built in the canvas's units rather than the camera's: nine
// reproduction attempts came back clean while a player saw it in every frame, and the answer there
// was to sweep ratios (`gl:parity`). This is that sweep for the pixel-sized layers.
//
// THE INVARIANT: the CSS frame is held still and only `window.devicePixelRatio` moves, so the
// scene, the camera and the projection are identical at every ratio. Anything sized correctly is
// therefore a FIXED NUMBER OF CSS PIXELS at every ratio — which is to say its pushed value divides
// by the ratio to the same number. Anything that does not scale is the bug.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const DETAIL = process.argv.includes('--detail');
const CW = 1280, CH = 720;
// Above and below 1. The sub-1 ratios are not hypothetical — they are where `resStep` actually
// sits on a loaded machine, and they are the half that makes things too BIG.
const RATIOS = [0.6, 0.8, 1, 1.25, 1.5, 2];
const TOL = 1e-6;

const ws = await loadWindshield();

// ⚠ THE SCENE HAS TO REACH ALL FOUR BILLBOARD PRODUCERS, because they are four separate pushes
// and fixing three of them looks exactly like fixing four. A gate for `markBillboard`, a bar for
// the rooftop neon in `drawMarquee`, `scrub` filler for the species in `scatterBillboard`, and a
// contact in the view for `bakeContacts` — plus lit towers for the glows and masts for the wires,
// so the two layers that were already correct stay covered as controls.
const R = 12, N = R * 2 + 1;
const SCENE = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
  if (x === R && y === R - 5) return { kind: 'land', biome: 'citycore', mark: 'gate', cur: 'ew' };
  if (x === R) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1, sl: 1 };
  if (x === R - 2 && y % 2 === 0) return { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'east', flr: 2 };
  // The office is the mast-and-light-runner one — it is what reaches the STROKE layer, which is a
  // control here rather than a subject and has to actually be present to be one.
  if (x === R + 2 && y % 2 === 1) return { kind: 'land', biome: 'citycore', bt: 'office', ent: 'west', flr: 9 };
  if (x === R + 5 && y === R) return { kind: 'land', biome: 'citycore', bt: 'luxtower', ent: 'west', flr: 24 };
  return { kind: 'land', biome: 'scrub', flr: 0 };
}));
// A bogey in the air ahead, which is the only way into `bakeContacts`.
const CONTACTS = [{ id: 7, cls: 'prop', reg: 'N7', dx: 1.5, dy: -6, altDiff: 40, pitch: 0, bank: 0 }];
// Which producer a billboard came from. The whole point of the gate is per-PRODUCER coverage, and
// after a bake the only thing left saying where a quad came from is its key.
const producerOf = (k) => (/\blm:/.test(k) ? 'landmark' : /\bct:/.test(k) ? 'contact' : /\bmq\|/.test(k) ? 'marquee' : 'scatter');

// Frozen, for framecost's reasons: a live clock moves the animated art and both adaptive dials,
// and this is measuring one variable. It also pins `resStep` at its ceiling, so the ratio under
// test is the only thing in `dpr`.
const clock = globalThis.performance;
globalThis.performance = { ...clock, now: () => 1e6 };

const runs = new Map();
for (const dpr of RATIOS) {
  globalThis.window.devicePixelRatio = dpr;
  const el = stubCanvas('__dprsize', CW, CH);
  let cap = null;
  ws.installGLWorld((cells, cam, opts) => {
    cap = {
      // Every quantity the three layers treat as a device-pixel length.
      // ⚠ `tex` IS A SECOND, SEPARABLE HALF. Sizing the quad in device pixels and leaving the bake
      // canvas in CSS ones passes every comparison below and still ships a landmark that is the
      // right size and visibly softer than the city behind it — the texture is upscaled. A bake
      // done at the live camera only keeps its promise (these are the pixels the 2-D pass would
      // have painted) if it is rasterised at the resolution it will be drawn at.
      billboard: (opts.scatter || []).map((b) => ({ id: b.key, v: [b.w, b.h, b.ax, b.ay], tex: b.img && b.img.width })),
      light: (opts.sprites || []).map((s, i) => ({ id: 'sprite#' + i, v: [s.r] })),
      stroke: (opts.strokes || []).map((s, i) => ({ id: 'stroke#' + i, v: [s.w, s.glow] })),
    };
    return { canvas: el };   // a pass that draws nothing switches itself off
  });
  const view = { cls: 'truck', phase: 'ground', height: 0, worldBlend: 1, variant: 'rigid',
    map: SCENE, heading: 0, hour: 2, weather: 'clear', speed: 0, resFloor: 1, contacts: CONTACTS };
  // Twice: the first frame builds every lazy cache this renderer has.
  for (let i = 0; i < 2; i++) ws.paintWindshield('__dprsize', view);
  ws.installGLWorld(null);
  runs.set(dpr, cap);
}
globalThis.performance = clock;

// ⚠ A FLOOR THAT CANNOT FAIL IS NOT A FLOOR. Deleting the fix under test must turn this red, and
// it cannot if the scene happens to contain no landmark, no glow or no mast — an empty list
// passes every ratio comparison there is. Each layer has to be REACHED before it can be gated.
const base = runs.get(1);
const problems = [];
for (const layer of ['billboard', 'light', 'stroke']) {
  if (!base[layer].length) problems.push(`scene reached no ${layer} at all — the gate is vacuous, fix the scene`);
}
// ⚠ AN EXCEPTION IS A REASON, NEVER A NAME — gl:opts's rule, for the same reason. `drawMarquee`'s
// billboard push is the fourth producer and it is fixed, but it CANNOT be reached from a scene:
// `bldgStyle` only answers arch 'marquee' for bt bar/club/casino (a bt present always takes the
// table, never the biome), and all three have TYPE_MODEL arms, so `modelFor` answers first and
// `drawBuilding`'s `case 'marquee'` never runs. If a model-less building type is ever put on that
// archetype the branch comes alive — delete this line then and the gate covers it.
const UNREACHABLE = { marquee: 'no model-less building type sits on the marquee archetype — see bldgStyle/TYPE_MODEL' };
const reached = new Set(base.billboard.map((b) => producerOf(b.id)));
for (const p of ['landmark', 'scatter', 'marquee', 'contact']) {
  if (reached.has(p) || UNREACHABLE[p]) continue;
  problems.push(`scene reached no ${p} billboard — that producer is ungated, fix the scene`);
}
for (const [dpr, cap] of runs) {
  for (const layer of ['billboard', 'light', 'stroke']) {
    if (cap[layer].length !== base[layer].length) {
      problems.push(`${layer}: ${cap[layer].length} at dpr ${dpr} against ${base[layer].length} at dpr 1 — the scene is not the same scene`);
      continue;
    }
    for (let i = 0; i < cap[layer].length; i++) {
      const a = base[layer][i], b = cap[layer][i];
      for (let k = 0; k < a.v.length; k++) {
        if (!(a.v[k] > 0) || !(b.v[k] > 0)) continue;      // a glow of 0 is an absence, not a length
        const cssAt1 = a.v[k], cssAtN = b.v[k] / dpr;
        if (Math.abs(cssAtN - cssAt1) > TOL * Math.max(1, cssAt1)) {
          problems.push(`${layer} ${a.id} field ${k}: ${cssAt1.toFixed(3)} CSS px at dpr 1, ${cssAtN.toFixed(3)} at dpr ${dpr}`
            + ` — pushed ${b.v[k].toFixed(3)}, wanted ${(cssAt1 * dpr).toFixed(3)}`);
        }
      }
      // The bake's own resolution, for the quads that bake at the live camera. A species canvas is
      // a FIXED drawing scaled by 1/f (see BB_W) and carries no camera, so it is exempt by nature
      // rather than by permission — it is the same texture at every ratio, correctly.
      if (layer === 'billboard' && producerOf(a.id) !== 'scatter' && a.tex > 0 && b.tex > 0) {
        const want = Math.max(1, Math.round(a.tex * dpr));
        if (Math.abs(b.tex - want) > 1) {
          problems.push(`billboard ${a.id}: baked ${b.tex}px wide at dpr ${dpr}, wanted ~${want}`
            + ' — the quad is device-sized but the texture is not, so it draws upscaled');
        }
      }
    }
  }
}

if (DETAIL) {
  const first = (cap, layer, pred) => {
    const e = pred ? cap[layer].find((b) => pred(b.id)) : cap[layer][0];
    return e ? e.v[0] : null;
  };
  const COLS = [
    ['light.r', (c) => first(c, 'light')],
    ['stroke.w', (c) => first(c, 'stroke')],
    ['landmark', (c) => first(c, 'billboard', (k) => producerOf(k) === 'landmark')],
    ['scatter', (c) => first(c, 'billboard', (k) => producerOf(k) === 'scatter')],
    ['marquee', (c) => first(c, 'billboard', (k) => producerOf(k) === 'marquee')],
    ['contact', (c) => first(c, 'billboard', (k) => producerOf(k) === 'contact')],
  ];
  const fmt = (v) => (v == null ? 'n/a' : v.toFixed(2));
  console.log(`CSS frame held at ${CW}x${CH} — only devicePixelRatio moves.`);
  console.log('Left half is what the producer pushes; right half is the CSS size that renders at.');
  console.log('A correct length is CONSTANT down the right half.\n');
  console.log('dpr    ' + COLS.map(([n]) => n.padEnd(9)).join('') + '|  ' + COLS.map(([n]) => n.padEnd(9)).join(''));
  for (const [dpr, cap] of runs) {
    const vals = COLS.map(([, f]) => f(cap));
    console.log(String(dpr).padEnd(7)
      + vals.map((v) => fmt(v).padEnd(9)).join('') + '|  '
      + vals.map((v) => fmt(v == null ? null : v / dpr).padEnd(9)).join(''));
  }
  console.log('');
}

const byProducer = [...reached].sort().map((p) => `${base.billboard.filter((b) => producerOf(b.id) === p).length} ${p}`).join(', ');
const counts = `${base.billboard.length} billboard (${byProducer}), ${base.light.length} light, ${base.stroke.length} stroke`;
if (problems.length) {
  console.error(`dprsize FAILED — a pixel-sized length does not follow the display ratio (${counts}, ${RATIOS.length} ratios)\n`);
  for (const p of problems.slice(0, 25)) console.error('  ' + p);
  if (problems.length > 25) console.error(`  … and ${problems.length - 25} more`);
  console.error('\n  The three layers convert with `2.0 / uViewport` against the CANVAS viewport (device px).');
  console.error('  A producer hands over CSS pixels only if it forgot `_frameDpr` — see pushBillboard.');
  process.exit(1);
}
console.log(`dprsize: ${counts} hold a constant CSS size across ${RATIOS.join(', ')} — OK`);
