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
    // ── ⚠ A FLANK PART IS MEASURED IN THE ROTATED FRAME, AND THIS GATE USED TO MEASURE IT IN THE
    // FRONT ONE. `face: 'x'` turns the local frame (see the ⚠ on `face` in
    // client/shared/building-model-schema.js): `cy` becomes the part's position along the model's
    // X, and `cx` runs along NEGATIVE Y. So a fire escape correctly bolted to a flank at cy = hw
    // was being held against the box's FRONT and BACK planes, which are at ±fd — and on any
    // building that is not square in plan those are different numbers. It reported six real,
    // correctly-placed parts as floating, off by exactly `hw − fd` every time.
    //
    // ⚠ AND IT HAD NEVER MET THE CASE. Every `face: 'x'` in `content/building_models/` was authored
    // in one pass, months after this gate; before that the key was used only by `derivedKit`, which
    // this half of the file does not read. A gate with a blind spot nothing has walked into yet
    // looks exactly like a gate that works.
    const flank = d.face === 'x';
    const planes = flank ? boxes.map((b) => ({ ...b, front: b.x1, back: b.x0, x0: b.back, x1: b.front }))
      : boxes;
    const along = flank ? -cx : cx;
    const px0 = along - half, px1 = along + half;

    // A wall on the right plane, overlapping this part's height, that covers its width.
    const onPlane = planes.filter((b) =>
      (Math.abs(b.front - cy) <= PLANE_TOL || Math.abs(b.back - cy) <= PLANE_TOL) &&
      b.z1 > zLo + 1e-6 && b.z0 < zHi - 1e-6);
    if (!onPlane.length) {
      const near = planes.map((b) => Math.min(Math.abs(b.front - cy), Math.abs(b.back - cy)))
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

// ── …AND THE OTHER 171 BUILDINGS ────────────────────────────────────────────
//
// ⚠ EVERYTHING ABOVE THIS LINE GUARDS TWO MODELS. `content/building_models/` holds `foundry` and
// `voltage` and nothing else, so the gate written for the floating-sign bug was watching 1.2% of
// the city while the other 171 buildings — and the whole derived kit, which is 29,698 of the
// city's 38,464 faces — had no support check of any kind. `gl:mesh` has a bound at half a tile,
// which catches trim that has left the building entirely and is two orders too loose to see a
// condenser hanging in the air beside its own wall.
//
// So the same question is asked of the real part list: `derivedTrim` is what the renderer draws,
// arm-authored `ARM_DETAIL` and rolled kit together, and `shapeForModel` is the mass it has to be
// attached to. Three ways a part can be wrong, and they are genuinely different defects:
//
//   FLOATING    — bolted to no wall and standing on no deck. Draws perfectly, every frame.
//   OVERHANGING — on a real wall, with a chunk of it past the end of that wall.
//   BURIED      — standing inside the building's own mass, usually under a crown box added to the
//                 arm after the roof plant was placed. Drawn, lit, costed, and invisible.
//
// ⚠ IT SWEEPS SEEDS. Half the kit is behind a deterministic roll (`dRand(seed, …)`), so a
// single-seed pass gives every model in the city the SAME dice — which reads as whole part kinds
// being unreachable. A first cut of this gate reported `vendingMachine` and `bollard` as emitted
// by nothing at all; they are emitted, on 4.6% and 9.2% of frontages, and one seed could not see
// either. Eight seeds is enough that a rolled part appears somewhere.
//
// ⚠ A WALL PART'S COVERAGE IS TANGENT-ONLY. It stands PROUD of its wall by FACE_EPS, so its own
// mounting plane is outside the mass by design, and a test that includes the normal axis reports
// all 28,112 checks as unsupported — which looks exactly like a city of floating parts.
//
// ⚠ AND `z` MEANS TWO THINGS. A part that STANDS is pushed with `z: A(deckZ)` — the base it rests
// on. A part BOLTED to a wall centres on `z`. Reading one as the other puts every roof unit half a
// box out and invents a floating city a second way.
const { loadWindshield } = await import('./dom-stub.mjs');
const ws = await loadWindshield();
const FH = 0.4, H = 1, SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const V = (p) => (Array.isArray(p) ? p[0] * FH + p[1] * H + p[2] : (p ?? 0));

const STANDS = new Set(['roofTank', 'tankFrame', 'stack', 'antennaCluster', 'acUnit', 'signGantry']);
// ⚠ `tag` IS IN HERE AND WAS NOT, WHICH IS HOW A PIECE CAME TO BE HANGING OFF A CRANE. Paint is as
// bolted to a wall as a vent is, and leaving it out of this set meant the twelve authored ones were
// checked by nothing at all: `Load of Old Rope` carries a tag spanning the gap BETWEEN two legs of
// a gantry, with 97% of it over open air, and `Velk's Pre-Owned` had one 0.0075 of a tile past the
// corner at the authoring basis (and a fifth of a tile past it at the top of the footprint roll —
// see wallSpanAt, which is the renderer's own half of that fix).
const WALL = new Set(['windowBay', 'louvreBank', 'signBoard', 'bladePanel', 'canopy', 'shutter', 'vent',
  'fireEscape', 'balcony', 'conduit', 'cableRun', 'ductRun', 'pipe', 'marqueeBand', 'awning', 'neonRun',
  'tag']);
// On the PAVEMENT, not on the building — see the ⚠ on the kerb props in derivedKit. A parapet is a
// ring derived from the deck it is placed on, so it is anchored by construction.
const OFF_BUILDING = new Set(['streetLamp', 'bollard', 'vendingMachine', 'facadeGlow', 'parapet']);
const REG_MOUNT = { marqueeBand: (d, h) => V(d.cy) + h * 0.94, awning: (d) => V(d.cy) + V(d.lip) - V(d.depth) * 0.5 };
const R_PLANE = 0.06, R_OVER = 0.06, R_DECK = 0.05, R_MARGIN = 0.02;

function regSolids(segs) {
  const out = [];
  for (const s of segs) {
    const cx = V(s.cx), cy = V(s.cy), z0 = V(s.z0), z1 = V(s.z1);
    if (s.kind === 'box') {
      if (s.yaw) continue;   // a rotated box needs a rotated test; the kit places on none
      // ⚠ `segFit`, NOT a local `min(hwRaw, 0.44)`. The capture is raw and the renderer applies TWO
      // clamps to it — the half-width cap and the plot-line fit — so a gate holding parts against a
      // hand-resolved footprint is holding them against a building that is not the one drawn.
      const f = ws.segFit(s, V);
      out.push({ t: 'aabb', x0: f.cx - f.hw, x1: f.cx + f.hw, y0: f.cy - f.fd, y1: f.cy + f.fd, z0, z1 });
    } else if (s.kind === 'drum') {
      out.push({ t: 'cyl', cx, cy, rb: V(s.rb), rt: V(s.rt != null ? s.rt : s.rb), z0, z1 });
    } else if (s.kind === 'barrel') {
      const cl = V(s.cxL), hl = V(s.hl), hw = V(s.hw);
      out.push({ t: 'aabb', x0: cx + cl - hl, x1: cx + cl + hl, y0: cy - hw, y1: cy + hw, z0, z1 });
    } else if (s.kind === 'sawtooth') {
      const hx = V(s.hx), hy = V(s.hy);
      out.push({ t: 'aabb', x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy, z0, z1 });
    }
  }
  return out;
}
const rAt = (s, z) => {
  const t = s.z1 > s.z0 ? (z - s.z0) / (s.z1 - s.z0) : 0;
  return s.rb + (s.rt - s.rb) * Math.max(0, Math.min(1, t));
};
const regCovers = (s, x, y, z) => (s.t === 'aabb'
  ? (x >= s.x0 - 1e-6 && x <= s.x1 + 1e-6 && y >= s.y0 - 1e-6 && y <= s.y1 + 1e-6)
  : (Math.hypot(x - s.cx, y - s.cy) <= rAt(s, z) + 1e-6));
function regPlaneGap(s, plane, flank) {
  if (s.t === 'aabb') {
    return flank ? Math.min(Math.abs(s.x1 - plane), Math.abs(s.x0 - plane))
      : Math.min(Math.abs(s.y1 - plane), Math.abs(s.y0 - plane));
  }
  const r = (s.rb + s.rt) / 2, c = flank ? s.cx : s.cy;
  return Math.min(Math.abs(c + r - plane), Math.abs(c - r - plane));
}

// ⚠ AND THE ONE PART THAT IS MEANT TO LEAVE ITS OWN BUILDING. Everything above asks whether a
// part is attached to THIS model, because a model is all a per-model gate can see — and that is
// right for every part in the registry but one. Second Helpings and the Coldwater Clone Facility
// share a party wall, and the service main that feeds the shop runs out of the facility, which
// is on the next tile. The gate cannot see that wall and never will, so the run reads as 0.52
// tiles hanging off the end of nothing.
//
// ⚠ A REASON, NEVER A BUDGET, AND NEVER A BARE NAME. Overhang is held at zero on purpose (see
// the ⚠ on BURIED_BUDGET) and a number that may be nudged is a gate that stops meaning
// anything. An entry here says which model, which kind, and what carries the far end — so the
// next person to read it can check the claim instead of trusting it. The far end of this one is
// asserted where it is authored: the facility’s block is always clamped to a 0.44 half-width, so
// its wall is at a constant 0.56 from this tile’s centre and the run ends 0.39 inside it.
const CROSSES_TO_NEIGHBOUR = new Map([
  ['named:secondhelpings · conduit', 'runs onto the Coldwater Clone Facility’s east wall — the two share a party wall'],
]);

const floating = new Map(), overhang = new Map(), inMass = new Map();
let regChecked = 0;
const note = (bag, key, kind, detail) => {
  const k = key + ' · ' + kind + ' · ' + detail;
  bag.set(k, (bag.get(k) || 0) + 1);
};

for (const seed of SEEDS) {
  for (const { key, m } of ws.shapeModelRegistry()) {
    const S = regSolids(ws.shapeForModel(m, seed) || []);
    if (!S.length) continue;
    for (const d of ws.derivedTrim(m, FH, H, seed, true) || []) {
      const stands = STANDS.has(d.kind), wall = WALL.has(d.kind);
      if (OFF_BUILDING.has(d.kind) || !(stands || wall)) continue;
      regChecked++;
      const half = V(d.half ?? d.w ?? d.r ?? 0.02), hh = V(d.hh ?? 0);
      const zLo = d.z0 != null ? V(d.z0) : (stands ? V(d.z) : V(d.z) - hh);
      // ⚠ A STANDING PART SPANS z … z + hh, NOT z + 2hh. `hh` is a HALF height on a wall part
      // and the FULL rise above the deck on a standing one: roofTank, stack, acUnit and
      // antennaCluster all draw their top face at z + hh. Getting this wrong puts the midpoint on
      // the part own lid, which is where the box lid it rests against also is.
      const zHi = d.z1 != null ? V(d.z1) : V(d.z) + hh;
      const cx = V(d.cx), cy = V(d.cy), flank = d.face === 'x', zc = (zLo + zHi) / 2;

      // BURIED — a standing part swallowed by mass. Asked of standing parts ONLY: a wall part is
      // mounted AT a face, so a boundary point reads as inside and every one would flag.
      if (stands && S.some((s) => zc > s.z0 + R_MARGIN && zc < s.z1 - R_MARGIN && (s.t === 'aabb'
        ? (cx > s.x0 + R_MARGIN && cx < s.x1 - R_MARGIN && cy > s.y0 + R_MARGIN && cy < s.y1 - R_MARGIN)
        : (Math.hypot(cx - s.cx, cy - s.cy) < rAt(s, zc) - R_MARGIN)))) {
        note(inMass, key, d.kind, 'inside the mass at z ' + zc.toFixed(2));
        continue;
      }
      // STANDING on a top that carries its footprint.
      if (stands && S.some((s) => Math.abs(s.z1 - zLo) <= R_DECK && regCovers(s, cx, cy, s.z1))) continue;
      // BOLTED to a wall plane that covers it along the tangent.
      const plane = REG_MOUNT[d.kind] ? REG_MOUNT[d.kind](d, half) : cy;
      const a0 = cx - half, a1 = cx + half;
      const on = S.filter((s) => regPlaneGap(s, plane, flank) <= R_PLANE && s.z1 > zLo + 1e-6 && s.z0 < zHi - 1e-6);
      if (on.length) {
        const step = Math.max((a1 - a0) / 24, 1e-3);
        const tan = (s, t) => (s.t === 'aabb'
          ? (flank ? (-t >= s.y0 - 1e-6 && -t <= s.y1 + 1e-6) : (t >= s.x0 - 1e-6 && t <= s.x1 + 1e-6))
          : (Math.abs(t - (flank ? -s.cy : s.cx)) <= (s.rb + s.rt) / 2 + 1e-6));
        let unc = 0;
        for (let x = a0; x <= a1 + 1e-9; x += step) if (!on.some((s) => tan(s, x))) unc += step;
        if (unc <= R_OVER) continue;
        if (CROSSES_TO_NEIGHBOUR.has(key + ' · ' + d.kind)) continue;
        note(overhang, key, d.kind, unc.toFixed(2) + ' tiles of it past the end of its wall');
        continue;
      }
      const gap = Math.min(...S.map((s) => regPlaneGap(s, plane, flank)));
      note(floating, key, d.kind, 'on no wall (nearest face ' + gap.toFixed(2) + ' away) and no deck under it');
    }
  }
}

// ⚠ BURIED IS REPORTED, NOT FAILED, AND THAT IS DELIBERATE. A gate that goes red on the day it is
// written is a gate somebody switches off. Floating and overhanging are real breakage and are held
// at zero; buried geometry is waste rather than a wrong picture, so it carries a BUDGET that may
// only ever come down. Lower the number when you fix some.
// 100 before `standOnMass` existed; it puts 86 of them back on the surface under them. The 14
// left are the two cases that pass deliberately refuses: a part swallowed by a DRUM (sliding clear
// of a cone means solving for a tangent, and it would be the only caller), and one where no top in
// the model carries the footprint at all, where moving it would trade waste for a visible bug.
// Those want a hand pass over five arms — archive, firedforgotten, warehouse, truck_depot and the
// Meridian. ⚠ THIS NUMBER MAY ONLY EVER COME DOWN.
const BURIED_BUDGET = 14;
const buriedN = inMass.size;

for (const [bag, label] of [[floating, 'FLOATING'], [overhang, 'OVERHANGING']]) {
  if (!bag.size) continue;
  problems.push(label + ':');
  for (const k of bag.keys()) problems.push('  ' + k);
}
if (buriedN > BURIED_BUDGET) {
  problems.push('BURIED — ' + buriedN + ' part(s) inside their own building, budget ' + BURIED_BUDGET + ':');
  for (const k of inMass.keys()) problems.push('  ' + k);
}

if (problems.length) {
  console.error('✗ anchored — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('    ' + p);
  console.error('\n  A floating part draws perfectly and identically every frame, so no other gate sees it.');
  process.exit(1);
}
console.log('✓ anchored: ' + files.length + ' authored model(s) and ' + regChecked
  + ' structural parts over ' + SEEDS.length + ' seeds — every one bolted to a wall that exists or'
  + ' standing on a deck that carries it; ' + buriedN + ' buried, budget ' + BURIED_BUDGET + '.');
