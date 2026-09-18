// DOES A BUILDING PUT MASS OUT OVER THE STREET?
//
// `draw3DBoxAt` has capped a box's half-width at 0.44 for as long as there have been models, so a
// wide building keeps a setback inside its plot. It never capped the box's POSITION, and the two
// are not the same rule: an arm authors a canopy at `fh * 1.14` and a display case at `fh * 1.06`,
// so the further `fh` is pushed the further those land OUTSIDE the tile — over the pavement first
// and then over the carriageway. 79 of the 173 arms did it and the worst reached 1.1 tiles from
// their own centre, which is a slab of masonry hanging over the middle of the road.
//
// Nothing could see it. `shapes:smoke` asks whether a model THROWS, `glmesh` whether its mesh
// matches the shape it collides as, `anchored` whether its parts are on a wall — a building that
// reaches over the road is none of those. It draws perfectly, every frame, and the only thing that
// ever noticed was somebody standing in the street looking at it.
//
// So: `segFit` is the one function that resolves a captured box into the footprint the renderer
// actually draws, and this asserts the rule it applies — on the ENTRANCE side, which is where the
// street is and where every projecting part in the registry is authored.
//
//   node scripts/shapes/tilefit.mjs            # gate
//   node scripts/shapes/tilefit.mjs --report   # every model the rule moves, worst first
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');

// ⚠ TWO SCALES, AND THE SECOND ONE IS THE POINT. The overhang is `cy + fd` where both terms are
// affine in fh/h, so a model that fits at one footprint can fail at another — which is exactly how
// this got into the city, since `fh` is capped at 0.44 while the offsets authored against it are
// not. A single-scale gate would pass most of the registry and mean nothing.
const SCALES = [[0.34, 0.6], [0.4, 1], [0.44, 2.2]];
const SEED = 3;
const EPS = 1e-6;

// How far past the plot line a box's own axis reaches, in the model's local frame. Local +y is the
// entrance side: the capture runs every arm at E = [0, 1].
function over(s, f, V) {
  const yaw = s.yaw || 0, sn = Math.abs(Math.sin(yaw)), cs = Math.abs(Math.cos(yaw));
  // A box turned to some angle that is neither of its own axes is not trimmable in (hw, fd) and
  // `segFit` leaves it alone, so this does too rather than reporting a red nobody can act on.
  if (sn <= 0.999 && cs <= 0.999) return -Infinity;
  return f.cy + (sn > 0.999 ? f.hw : f.fd) - ws.TILE_REACH;
}

function sweep() {
  const bad = [], moved = new Map();
  for (const { key, m } of ws.shapeModelRegistry()) {
    let segs;
    try { segs = ws.shapeForModel(m, SEED); } catch { continue; }
    if (!segs) continue;
    const exempt = ws.NO_TILE_FIT.has((m && (m.trade || m.replaces || m.portedFrom || m.type)) || '');
    for (const [fh, h] of SCALES) {
      const V = (p) => (Array.isArray(p) ? p[0] * fh + p[1] * h + p[2] : (p || 0));
      for (const s of segs) {
        if (s.kind !== 'box') continue;
        const o = over(s, ws.segFit(s, V), V);
        if (o === -Infinity) continue;
        // What the arm asked for, so the report can say how far the rule actually had to move it.
        const raw = over(s, { cx: V(s.cx), cy: V(s.cy), hw: Math.min(V(s.hwRaw), 0.44), fd: Math.min(s.fdRaw ? V(s.fdRaw) : Math.min(V(s.hwRaw), 0.44), 0.44) }, V);
        if (raw > EPS && !exempt) moved.set(key, Math.max(moved.get(key) || 0, raw));
        if (o > EPS && !exempt) bad.push({ key, fh, h, o: +o.toFixed(4), pal: s.pal, z0: +V(s.z0).toFixed(3), z1: +V(s.z1).toFixed(3) });
      }
    }
  }
  return { bad, moved };
}

const on = sweep();

// ⚠ THE MUTATION CONTROL, and without it this gate is worth nothing: a rule that is never exercised
// passes identically to a rule that has been deleted. With the flag off the registry has to break,
// and by a lot — if this number ever collapses, the fit has stopped being applied somewhere and the
// green above is green about nothing.
ws.RENDER_TUNE.tileFit = 0;
const off = sweep();
ws.RENDER_TUNE.tileFit = 1;

const MIN_CAUGHT = 40;   // it was 79 arms over 107 models when the rule went in; 40 is a floor, not a target

if (REPORT) {
  const rows = [...on.moved].sort((a, b) => b[1] - a[1]);
  console.log(`tilefit — ${rows.length} model(s) trimmed back to the plot line, worst first:\n`);
  for (const [key, o] of rows) console.log(`  ${o.toFixed(3)} over  ${key}`);
  console.log(`\n  and ${ws.NO_TILE_FIT.size} arm(s) keep their reach — see NO_TILE_FIT for why.`);
}

const problems = [];
if (on.bad.length) {
  problems.push(`${on.bad.length} box(es) still cross the plot line with the fit on`);
  for (const b of on.bad.slice(0, 8)) {
    problems.push(`    ${b.key} · ${b.o} past the line at fh ${b.fh} · ${b.pal} · z ${b.z0}..${b.z1}`);
  }
}
if (off.bad.length < MIN_CAUGHT) {
  problems.push(`the control found only ${off.bad.length} crossing(s) with the fit OFF (want ≥ ${MIN_CAUGHT}) — `
    + 'the rule is not reaching the registry, so the pass above proves nothing');
}

if (problems.length) {
  console.log(`✗ tilefit — ${problems.length} problem(s):`);
  for (const p of problems) console.log('  ' + p);
  console.log('\n  A box past the plot line hangs over the pavement and then over the road. If it is');
  console.log('  meant to — a boardwalk porch, a shaded yard — put its ARM in NO_TILE_FIT with the');
  console.log('  reason, never its palette: five Coldwater buildings wear a frontier palette.');
  process.exit(1);
}

console.log(`✓ tilefit: ${on.moved.size} model(s) trimmed back to their own plot line across `
  + `${SCALES.length} scales, ${ws.NO_TILE_FIT.size} arm(s) deliberately exempt, and nothing crosses it.`);
console.log(`  With the fit off the same sweep finds ${off.bad.length} crossing(s), which is what says this gate can see the thing.`);
