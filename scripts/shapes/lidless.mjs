// IS THERE A BOX STANDING OUT IN FRONT OF THIS BUILDING WITH NO TOP ON IT?
//
// Most arms draw their ground-floor frontage — a shop window, a roller shutter, a boarded unit, a
// portico — as `draw3DBoxAt(..., F(0, fh * 0.90), fh * 0.6x, ..., roof=false)` with **no `fd`**. No
// `fd` means the box is SQUARE, so a frontage authored as a slab across a shopfront is actually a
// solid half a tile deep, and `roof=false` means it has no top face.
//
// ⚠ THE IDIOM WAS CORRECT BEFORE `tileFitBox` EXISTED AND IS A DEFECT AFTER IT. At `fh * 0.90` the
// box used to land a tile and a half into the street, where the painter's queue sorted it in front
// of everything and nobody could see its top or tell how deep it was. Trimmed back to the plot
// line it keeps its half-width, loses depth at the front only, and comes to rest about a tenth of
// a tile PROUD of the facade behind it — a real projecting mass, with an open top you look straight
// down into from any seat above it. That is the "if it's going to jut out like that, put a roof on
// it" report, and it is 55 models rather than one.
//
// ⚠ THE TEST IS PROUD **AND** LOWER **AND** EXPOSED, and dropping any one of the three makes it
// useless. `roof: false` on its own is the normal case: a wall box under a parapet, a box under a
// barrel roof (the barrel is its lid), a plinth under the storey above. 142 models have one of
// those and every one of them is correct. What is not correct is a box that (a) stands in front of
// the mass behind it, (b) is shorter than that mass, so there is a seat that looks down on it, and
// (c) has nothing covering its top face.
//
// ⚠ AND IT OVER-REPORTS, WHICH IS THE SAFE DIRECTION FOR A BOARD AND NOT FOR A GATE. Coverage is
// tested against captured SOLIDS — boxes, drums, barrels, sawteeth — and a top covered by a
// detail-layer canopy, awning or roof pitch (`emitFlat`, which is not mass) reads as exposed. So a
// row here is a question, and the Modelshop is where it is settled:
//
//   npm run modelshop   →   __street({ at: '<building>', seat: 'street', eyeH: 0.55 })
//
// ⚠ IT IS A GATE AT ZERO, AND THE ESCAPE HATCH IS A REASON RATHER THAN A BUDGET. All 55 were fixed
// in one pass, so the honest ceiling is none — and a budget ("no more than N") passes a new one
// silently the moment somebody fixes an old one, which is the failure this whole file exists to
// end. A building that genuinely wants an open-topped projecting box says so by name in `KNOWN`,
// with the reason written out.
//
//   node scripts/shapes/lidless.mjs                # the board
//   node scripts/shapes/lidless.mjs --fail-over 3  # …with a temporary ceiling, while a batch lands
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
ws.setTilePlace({ biome: 'citycore', wx: 909, wy: 910 });

const argv = process.argv.slice(2);
const capIx = argv.indexOf('--fail-over');
const CAP = capIx >= 0 ? Number(argv[capIx + 1]) : 0;

// Models allowed an open-topped projecting box, each with the reason it is allowed one. Empty, and
// meant to stay so — see the ⚠ above.
const KNOWN = new Map([]);

// ⚠ EIGHT SEEDS, BECAUSE THE OFFENDING BOX IS OFTEN SEEDED. `vacantunit` drew a shutter, three
// boards or a broken window off `seed % 3` and only two of the three were the big slab, so a
// one-seed sweep reports two thirds of that arm as clean.
const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7];
const PROUD = 0.02;    // how far in front of the mass behind it before it is "standing out"
const OPEN = 0.15;     // how much of its lid has to be missing before it is worth a line

const solidsOf = (segs, V) => {
  const out = [];
  for (const s of segs) {
    if (s.kind === 'box') {
      const f = ws.segFit(s, V);
      out.push({ kind: 'box', yaw: s.yaw || 0, cx: f.cx, cy: f.cy, hw: f.hw, fd: f.fd,
        z0: V(s.z0), z1: V(s.z1), roof: s.roof, pal: s.pal });
    } else if (s.kind === 'drum') {
      out.push({ kind: 'drum', cx: V(s.cx), cy: V(s.cy), r: Math.max(V(s.rb), V(s.rt)),
        z0: V(s.z0), z1: V(s.z1) });
    } else if (s.kind === 'barrel') {
      // A barrel IS the lid of the box under it, so it counts as cover for that box's whole span.
      out.push({ kind: 'box', yaw: 0, cx: V(s.cx), cy: V(s.cy), hw: V(s.hw) || 0.44, fd: V(s.hl) || 0.44,
        z0: V(s.z0) - 0.001, z1: V(s.z0) + V(s.archH), roof: true });
    } else if (s.kind === 'sawtooth') {
      out.push({ kind: 'box', yaw: 0, cx: V(s.cx), cy: V(s.cy), hx: 0, hw: V(s.hx) || 0.44, fd: V(s.hy) || 0.44,
        z0: V(s.z0) - 0.001, z1: V(s.z0) + (V(s.rh) || 0.05), roof: true });
    }
  }
  return out;
};

const inside = (s, x, y) => {
  if (s.kind === 'drum') return Math.hypot(x - s.cx, y - s.cy) <= s.r + 1e-6;
  if (s.yaw) {
    const c = Math.cos(-s.yaw), si = Math.sin(-s.yaw), dx = x - s.cx, dy = y - s.cy;
    return Math.abs(dx * c - dy * si) <= s.hw + 1e-6 && Math.abs(dx * si + dy * c) <= s.fd + 1e-6;
  }
  return Math.abs(x - s.cx) <= s.hw + 1e-6 && Math.abs(y - s.cy) <= s.fd + 1e-6;
};

const rows = [];
let models = 0, examined = 0;
for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  let worst = null;
  for (const seed of SEEDS) {
    const { fh, h } = ws.buildingScaleFor(4, seed);
    let segs;
    try { segs = ws.shapeForModel(m, seed); } catch { continue; }
    if (!segs || !segs.length) continue;
    const V = (p) => (Array.isArray(p) ? p[0] * fh + p[1] * h + p[2] : (p || 0));
    const solids = solidsOf(segs, V);
    // The mass everything else is judged against: the biggest footprint.
    let main = null;
    for (const s of solids) if (s.kind === 'box' && !s.yaw) { if (!main || s.hw * s.fd > main.hw * main.fd) main = s; }
    if (!main) continue;
    for (const b of solids) {
      if (b.kind !== 'box' || b.roof !== false || b === main) continue;
      examined++;
      if (!(b.hw > 0.02 && b.fd > 0.02)) continue;
      if (!(b.cy + b.fd > main.cy + main.fd + PROUD)) continue;   // standing out in front of it
      if (!(b.z1 < main.z1 - 0.01)) continue;                     // …and low enough to look down on
      let open = 0, tot = 0;
      const N = 7;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const lx = (-1 + 2 * (i + 0.5) / N) * b.hw, ly = (-1 + 2 * (j + 0.5) / N) * b.fd;
        let x, y;
        if (b.yaw) { const c = Math.cos(b.yaw), si = Math.sin(b.yaw); x = b.cx + lx * c - ly * si; y = b.cy + lx * si + ly * c; }
        else { x = b.cx + lx; y = b.cy + ly; }
        tot++;
        if (!solids.some((o) => o !== b && o.z1 > b.z1 + 1e-4 && o.z0 <= b.z1 + 1e-4 && inside(o, x, y))) open++;
      }
      const frac = open / tot;
      if (frac <= OPEN) continue;
      const area = 4 * b.hw * b.fd * frac;
      if (!worst || area > worst.area) {
        worst = { seed, area, frac, proud: (b.cy + b.fd) - (main.cy + main.fd), z1: b.z1, hw: b.hw, fd: b.fd, pal: b.pal };
      }
    }
  }
  if (worst && !KNOWN.has(key)) rows.push({ key, ...worst });
}

rows.sort((a, b) => b.area - a.area);
// ⚠ THE SECOND NUMBER IS WHAT SAYS THE SCAN IS DOING WORK. A gate whose only output is "0 found"
// reads the same whether nothing is wrong or nothing is being looked at, and a `roof: false` box is
// the NORMAL case here (a wall under a parapet, a box under a barrel roof) — so the count of them
// is the floor this gate is measured against. It should be in the low thousands.
console.log(`\n  lidless — ${models} models, ${SEEDS.length} seeds each, ${examined} roofless boxes examined\n`);
for (const r of rows) {
  console.log(`  ${r.area.toFixed(4)}  open ${String(Math.round(r.frac * 100)).padStart(3)}%  proud ${r.proud.toFixed(3)}`
    + `  ${(2 * r.hw).toFixed(2)}×${(2 * r.fd).toFixed(2)} at z ${r.z1.toFixed(3)}  ${(r.pal || '').padEnd(18)} ${r.key} (worst seed ${r.seed})`);
}
if (rows.length > CAP) {
  console.error(`\n✗ lidless — ${rows.length} model(s) with an open-topped box standing out in front`
    + ` of their own facade${CAP ? ` (${CAP} allowed)` : ''}. Give it a real half-depth and a roof,`
    + ` or name it in KNOWN with a reason.`);
  process.exit(1);
}
console.log(`  ✓ lidless: nothing juts out of a building with its top left open.`);
