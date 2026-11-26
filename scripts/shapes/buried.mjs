// buried — is any facade detail drawn inside the building's own mass?
//
// A window bay, balcony or fire escape is bolted to a wall and stands out from it. If another mass
// box stands in front of that wall at the part's height (a wing, a portico, a shopfront), the part is
// drawn inside it: a window on a party wall, a balcony through a wing. Phase 1 of
// docs/proposals/model-plan.md. `anchored.mjs` asks the opposite question (is there wall BEHIND a
// part); this asks whether there's mass IN FRONT of it.
//
// The test is `partBuried` in glass/derived-kit.js, the one `derivedTrim` filters with when
// `RENDER_TUNE.buriedDrop` is on. This gate counts what it would drop with the switch off (the
// census, and the control: zero there proves nothing), then fails if anything buried is left with
// it on. It covers `derivedTrim`'s rich list (the kit plus authored `m.detail` and `ARM_DETAIL`) for
// every model in the registry over eight seeds. Parts an arm draws by hand through `drawArmPart`
// aren't in that list and aren't covered.
//
//   node scripts/shapes/buried.mjs            the count by kind and the worst models
//   node scripts/shapes/buried.mjs --list     every part dropped, at seed 1
import { loadWindshield } from './dom-stub.mjs';
import { partBuried, buryBoxes } from '../../client/game/js/panels/glass/derived-kit.js';

const LIST = process.argv.includes('--list');
const ws = await loadWindshield();
const FH = 0.4, H = 1;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const V = (p) => (Array.isArray(p) ? p[0] * FH + p[1] * H + p[2] : (p ?? 0));

function sweep(on) {
  ws.RENDER_TUNE.buriedDrop = on ? 1 : 0;
  const byKind = {}, byModel = new Map(), rows = [];
  let parts = 0;
  for (const { key, m } of ws.shapeModelRegistry()) {
    for (const seed of SEEDS) {
      let segs, list;
      try { segs = ws.shapeForModel(m, seed); list = ws.derivedTrim(m, FH, H, seed, true); } catch { continue; }
      if (!segs || !segs.length || !list) continue;
      const boxes = buryBoxes(segs, V);
      for (const d of list) {
        parts++;
        if (!partBuried(d, boxes, V)) continue;
        byKind[d.kind] = (byKind[d.kind] || 0) + 1;
        byModel.set(key, (byModel.get(key) || 0) + 1);
        if (seed === 1) rows.push(`${key.padEnd(34)} ${d.kind.padEnd(11)} ${d.face === 'x' ? 'flank' : (V(d.cy) < 0 ? 'back ' : 'front')} cx ${V(d.cx).toFixed(3)} cy ${V(d.cy).toFixed(3)} z ${V(d.z ?? d.z0).toFixed(3)}`);
      }
    }
  }
  const total = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { byKind, byModel, rows, parts, total };
}

const off = sweep(false);
const on = sweep(true);
ws.RENDER_TUNE.buriedDrop = 1;

const pct = (100 * off.total / Math.max(off.parts, 1)).toFixed(1);
if (LIST || !on.total) {
  console.log(`buried: with buriedDrop off, ${off.total} of ${off.parts} parts (${pct}%) in ${off.byModel.size} models x ${SEEDS.length} seeds would be inside mass`);
  for (const [k, n] of Object.entries(off.byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(11)} ${n}`);
}
if (LIST) for (const r of off.rows) console.log('  ' + r);
if (!off.total) { console.error('buried: nothing buried with the switch off, so the test proves nothing'); process.exit(1); }
if (on.total) {
  console.error(`buried: ${on.total} parts still inside mass with buriedDrop on`);
  for (const r of on.rows.slice(0, 20)) console.error('  ✗ ' + r);
  process.exit(1);
}
