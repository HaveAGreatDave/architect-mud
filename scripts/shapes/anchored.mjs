// anchored — is every part of an authored model actually ON the building?
//
// ⚠ THIS EXISTS BECAUSE VOLTAGE SHIPPED WITH A FLOATING SIGN, IN THE COMMIT WHOSE WHOLE POINT WAS
// THAT THE SIGNAGE SHOULD STAND ON STRUCTURE. The model was re-cut from one flat box into five
// stepped masses, and the marquee was left at the `cy` it had when the front of the building was a
// single plane. It spans x −0.20…0.20 at y 0.435; at its own height the only wall at y 0.43 is the
// forward wing, which starts at x −0.10. So a quarter of the board hangs over open air.
//
// Nothing caught it. `shapes:smoke` renders every model and asks whether it THROWS; `models:diff`
// asks whether it is deterministic; `glmesh` asks whether the mesh matches the collision shape. A
// part in mid-air is none of those — it draws perfectly, every frame, identically. The only thing
// that would ever notice is somebody looking at that building from an angle where the gap shows.
//
// So: for every face-mounted part in an authored model, find a mass box whose FRONT PLANE is the
// plane the part is mounted on, and whose extent covers it. No box, no anchor, no build.
//
//   node scripts/shapes/anchored.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../../content/building_models/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Parts whose `cy` names a WALL PLANE they are bolted to. The rest (roof plant, parapets, a gantry
// standing on a deck, a point light) are positioned in the volume and anchor differently.
const FACE_PARTS = new Set([
  'windowBay', 'louvreBank', 'signBoard', 'bladePanel', 'canopy', 'shutter', 'vent',
  'fireEscape', 'balcony', 'conduit', 'cableRun', 'ductRun', 'pipe', 'marqueeBand', 'awning',
]);
// ⚠ NOT EVERY PART MOUNTS AT ITS OWN `cy`, AND THE FIRST CUT OF THIS GATE ASSUMED THEY ALL DID — so
// it passed the exact sign it was written to catch. `marqueeBand` pushes itself out along the
// entrance normal by `half * 0.94` (the arms all call it with dx/dy UNCHANGED and `half ≈ fh*0.75`,
// so the push is what lands it on the facade), and `awning` mounts at `lip - depth/2`. Authoring a
// wall plane into `cy` as well double-counts the offset: Voltage's marquee asked for y 0.43 and the
// renderer put it at 0.618, a fifth of a tile out in clear air, which is what a floating sign IS.
//
// So the gate asks where the part will actually BE, not where its `cy` says. A gate that models the
// renderer loosely is a gate that agrees with whatever the code does, including the bug.
const MOUNT = {
  marqueeBand: (d) => (d.cy ?? 0) + (d.half ?? 0) * 0.94,
  awning: (d) => (d.cy ?? 0) + (d.lip ?? 0) - (d.depth ?? 0) * 0.5,
};
// How far a part may sit off its wall before it is floating rather than proud. A `canopy` or a
// `bladePanel` is MEANT to stand off the face, so the test is on the mounting plane, not the reach.
const PLANE_TOL = 0.05;
// Parts are allowed to overhang their own wall a little at the ends — a sign wider than its pier is
// normal. A quarter of the board over nothing is not.
const OVERHANG = 0.06;

const problems = [];
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const m = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const boxes = (m.segs || []).filter((s) => s.kind === 'box' && !s.yaw).map((s) => {
    const hw = s.hw ?? 0, fd = s.fd ?? hw, cx = s.cx ?? 0, cy = s.cy ?? 0;
    return { x0: cx - hw, x1: cx + hw, front: cy + fd, back: cy - fd, z0: s.z0 ?? 0, z1: s.z1 ?? 0 };
  });
  if (!boxes.length) continue;

  const parts = [...(m.adorn || []), ...(m.detail || [])].flatMap((d) =>
    d.kind === 'repeat' ? Array.from({ length: d.count || 0 }, (_, i) => {
      const o = { ...d.of }; for (const k of Object.keys(d.step || {})) o[k] = (o[k] ?? 0) + d.step[k] * i; return o;
    }) : [d]);

  for (const d of parts) {
    if (!FACE_PARTS.has(d.kind)) continue;
    const cy = MOUNT[d.kind] ? MOUNT[d.kind](d) : (d.cy ?? 0);
    const cx = d.cx ?? 0;
    const half = d.half ?? d.w ?? d.r ?? 0.02;
    const zLo = d.z0 ?? ((d.z ?? 0) - (d.hh ?? 0));
    const zHi = d.z1 ?? ((d.z ?? 0) + (d.hh ?? 0));
    const px0 = cx - half, px1 = cx + half;

    // A wall on the right plane, overlapping this part's height, that covers its width.
    const onPlane = boxes.filter((b) =>
      (Math.abs(b.front - cy) <= PLANE_TOL || Math.abs(b.back - cy) <= PLANE_TOL) &&
      b.z1 > zLo + 1e-6 && b.z0 < zHi - 1e-6);
    if (!onPlane.length) {
      const near = boxes.map((b) => Math.min(Math.abs(b.front - cy), Math.abs(b.back - cy)))
        .reduce((a, b) => Math.min(a, b), 9);
      problems.push(`${file}: ${d.kind} at cy ${cy} z ${zLo.toFixed(2)}..${zHi.toFixed(2)} is mounted on no wall `
        + `— nearest face plane is ${near.toFixed(3)} away`);
      continue;
    }
    // Covered along its width by the union of those walls? (One wall is the normal case; two
    // stacked boxes sharing a plane is legitimate and covers between them.)
    let uncovered = 0;
    const STEP = Math.max((px1 - px0) / 24, 1e-3);
    for (let x = px0; x <= px1 + 1e-9; x += STEP) {
      if (!onPlane.some((b) => x >= b.x0 - 1e-6 && x <= b.x1 + 1e-6)) uncovered += STEP;
    }
    if (uncovered > OVERHANG) {
      problems.push(`${file}: ${d.kind} spans x ${px0.toFixed(2)}..${px1.toFixed(2)} at cy ${cy} z `
        + `${zLo.toFixed(2)}..${zHi.toFixed(2)} — ${uncovered.toFixed(2)} tiles of it hangs over nothing `
        + `(walls on that plane at this height: ${onPlane.map((b) => `${b.x0.toFixed(2)}..${b.x1.toFixed(2)}`).join(', ')})`);
    }
  }
}

if (problems.length) {
  console.error(`✗ anchored — ${problems.length} part(s) not on the building:`);
  for (const p of problems) console.error('    ' + p);
  console.error('\n  A floating part draws perfectly and identically every frame, so no other gate sees it.');
  process.exit(1);
}
console.log(`✓ anchored: every face-mounted part in ${files.length} authored model(s) is on a wall that exists.`);
