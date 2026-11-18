// depot-shed:bake: write client/shared/depot-shed.js, the truck shed you walk round in ROOM, from GLASS's own shed.
//
//   npm run depot-shed:bake
//   node scripts/shapes/bake-depot-shed.mjs --check    (compare with the file on disk, write nothing)
//
// The shed a truck drives into on the street (windshield.js drawVehicleBay) is the room the Room Stage draws
// when you're in a depot on foot (docs/systems-trucking.md, "The lift in the shed"): the same floor paint, the
// office, the bench, the racks, the lift in the middle and the garage under it. windshield.js
// `bayInteriorCapture` draws it once with you stood inside, the door down and the lift at the bottom of its
// well; this turns that into the Stage's frame and writes it as a module of literals, so ROOM (and its mesh
// worker) can draw it without loading GLASS.
//
// What it does to the faces, and nothing else:
//   - tiles to metres (world-scale.js TILE_M), into the room's frame: u across, to the right as you face the
//     roller door; v back from the door's wall; y up from the shed's floor
//   - the outside goes: a face whose middle is outside the walls or over the ridge can't be seen from in here
//   - a see-through face (paint, a stain, the ribs) is mixed onto the face it lies on, since the Stage's
//     batches have no alpha
//   - each face gets a normal that faces the way it's seen from: out of its own solid, or into the shed
//   - each solid standing on the floor gives a footprint the walker goes round
//
// Re-run after editing drawVehicleBay. `node scripts/shapes/depot-shed.mjs` fails on a stale bake.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadWindshield } from './dom-stub.mjs';
import { TILE_M } from '../../client/shared/world-scale.js';

export const OUT = fileURLToPath(new URL('../../client/shared/depot-shed.js', import.meta.url));

const r3 = (n) => Math.round(n * 1000) / 1000 + 0;
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mid = (ps) => ps.reduce((m, p) => [m[0] + p[0] / ps.length, m[1] + p[1] / ps.length, m[2] + p[2] / ps.length], [0, 0, 0]);
// Newell's normal, unit length (or null for a sliver)
function normalOf(ps) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l > 1e-12 ? [x / l, y / l, z / l] : null;
}
// whether a point on a face's plane is inside it, in the two axes the face shows most of
function inside(ps, n, q) {
  const k = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2);
  const [i, j] = [[1, 2], [0, 2], [0, 1]][k];
  let c = false;
  for (let a = 0, b = ps.length - 1; a < ps.length; b = a++) {
    const A = ps[a], B = ps[b];
    if ((A[j] > q[j]) !== (B[j] > q[j]) && q[i] < (B[i] - A[i]) * (q[j] - A[j]) / (B[j] - A[j]) + A[i]) c = !c;
  }
  return c;
}

export async function bakeDepotShed() {
  const ws = await loadWindshield();
  const cap = ws.bayInteriorCapture();
  const { hw, hl, wall, ridge, doorW, doorH, fz, lift, side, lamps } = cap.dims;
  const E = 1e-4;
  // ── which faces: the ones you can see from inside ──
  const faces = cap.faces.filter((f) => f.p.length >= 3).map((f) => ({ ...f, n: normalOf(f.p), c: mid(f.p) }))
    .filter((f) => f.n && Math.abs(f.c[0]) <= hw + E && f.c[1] <= hl + E && f.c[1] >= -hl - E && f.c[2] <= ridge + E);
  // ── see-through faces onto what's under them ──
  const solid = faces.filter((f) => f.a >= 0.99);
  for (const f of faces) {
    if (f.a >= 0.99) continue;
    let base = null, best = Infinity;
    for (const o of solid) {
      if (Math.abs(dot(o.n, f.n)) < 0.95 || (o.part || null) !== (f.part || null)) continue;
      const d = Math.abs(dot(o.n, sub(f.c, o.p[0])));
      if (d < 0.006 && d < best && inside(o.p, o.n, f.c)) { best = d; base = o; }
    }
    const under = base ? base.rgb : [96, 98, 102];
    f.rgb = f.rgb.map((v, i) => v * f.a + under[i] * (1 - f.a));
    f.a = 1;
  }
  // ── which way each face looks ──
  // a solid's faces outward from its middle; the shell's into the shed, and under the floor into the garage
  const groups = new Map();
  for (const f of faces) if (f.g) { const G = groups.get(f.g) || { pts: [], faces: [] }; G.pts.push(...f.p); G.faces.push(f); groups.set(f.g, G); }
  for (const G of groups.values()) G.c = mid(G.pts);
  const DEEP = -lift.DEPTH;
  for (const f of faces) {
    let ref;
    if (f.g) ref = groups.get(f.g).c;
    else if (f.part === 'plate' && Math.abs(f.n[2]) < 0.5) ref = [0, 0, f.c[2]];
    else ref = f.c[2] < -0.005 ? [0, 0, DEEP / 2] : [0, 0, wall / 2];
    const toward = sub(ref, f.c);
    const out = f.g || (f.part === 'plate' && Math.abs(f.n[2]) < 0.5);
    if ((dot(f.n, toward) > 0) === !!out) f.n = f.n.map((v) => -v);
  }
  // ── into the room's frame, in metres ──
  const M = TILE_M;
  const U = (x) => r3(x * M), V = (y) => r3((hl - y) * M), Y = (z) => r3((z - fz) * M);
  const pt = ([x, y, z]) => [U(x), V(y), Y(z)];
  const out = faces.map((f) => ({ c: hex(f.rgb), n: [r3(f.n[0]), r3(f.n[2]), r3(-f.n[1])], p: f.p.map(pt), ...(f.part ? { part: f.part } : {}) }));
  // ── what the walker goes round: every solid stood on the floor and taller than a kerb ──
  const foot = [];
  for (const G of groups.values()) {
    if (G.faces.some((f) => f.part)) continue;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of G.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    // anything reaching over a kerb and starting under your head: a drum, the bench, a rack's shelves
    if ((z0 - fz) * M > 1.8 || (z1 - fz) * M < 0.3) continue;
    foot.push([x0, x1, y0, y1]);
  }
  // overlapping footprints are one (a bench and the cabinet under it, a rack's uprights and shelves)
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < foot.length && !again; i++) for (let j = i + 1; j < foot.length; j++) {
      const a = foot[i], b = foot[j];
      if (a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3]) {
        foot[i] = [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3])];
        foot.splice(j, 1); again = true; break;
      }
    }
  }
  const solids = foot.map(([x0, x1, y0, y1]) => [U(x0), U(x1), V(y1), V(y0)]).sort((a, b) => a[2] - b[2] || a[0] - b[0]);
  const legends = cap.legends.map((l) => ({ text: l.text, at: [U(l.x), V(l.y)], h: r3(l.hl * 2 * M), colour: l.colour }));
  return {
    w: r3(2 * hw * M), d: r3(2 * hl * M), eaves: Y(wall), ridge: Y(ridge),
    door: { w: r3(2 * doorW * M), h: Y(doorH) },
    side: side ? { u0: U(side[0]), u1: U(side[1]) } : null,
    lift: { at: [0, V(0)], w: r3(2 * lift.HW * M), l: r3(2 * lift.HL * M), depth: r3(lift.DEPTH * M), rise: r3((lift.DEPTH + fz) * M) },
    lamps: lamps.map(pt), solids, legends, faces: out,
  };
}

export function moduleOf(S) {
  const { faces, ...rest } = S;
  const head = JSON.stringify(rest).slice(1, -1);
  return `// GENERATED by scripts/shapes/bake-depot-shed.mjs from GLASS's truck shed (windshield.js drawVehicleBay). Don't edit:
// change the shed there and run \`npm run depot-shed:bake\`. ROOM draws it as a truck depot's shed (gl/room-depot.js).
// Metres, in the room's frame: u across (right as you face the roller door), v back from the door's wall, y up.
// A face is { c: colour, n: [u, y, v] normal, p: [[u, v, y], ...], part }: 'plate' rides the lift, 'below' is the
// garage under the floor. \`solids\` are [u0, u1, v0, v1] footprints the walker goes round.
export const DEPOT_SHED = Object.freeze({ ${head},
  faces: [
${faces.map((f) => '    ' + JSON.stringify(f)).join(',\n')},
  ],
});
`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const S = await bakeDepotShed(), text = moduleOf(S);
  if (process.argv.includes('--check')) {
    const now = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (now !== text) { console.log('client/shared/depot-shed.js is stale: run npm run depot-shed:bake'); process.exit(1); }
  } else {
    writeFileSync(OUT, text, 'utf8');
    console.log(`depot-shed: ${S.faces.length} faces, ${S.solids.length} footprints, ${S.legends.length} legends, ${S.w} x ${S.d} m, eaves ${S.eaves} m, ridge ${S.ridge} m`);
  }
}
