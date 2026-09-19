// CAN YOU READ THE NAME, OR IS THE BUILDING STANDING IN FRONT OF IT?
//
// `signfit` asks whether a WIRE is drawn across a sign; this asks whether the building's own MASS
// is. They are different failures with different causes and only one of them was ever measured.
//
// ⚠ IT IS A CONSEQUENCE OF `tileFit` RATHER THAN OF THE ARMS, which is why it turned up all at
// once. Every shopfront in this registry is authored as a box shoved out to about `fh * 0.9`:
// before the plot-line trim existed that landed a tile and a half into the street, and the
// painter's queue sorted it clear of everything, sign included. Trimmed back to the plot line the
// same box is a mass standing a tenth of a tile PROUD of its own facade — still a shopfront, and
// now also a thing the name can hide behind. Nothing said so, because on the canvas a sign carries
// `DETAIL_LIFT` and is sorted in FRONT of the building it is physically inside. A depth buffer
// compares, and the lettering simply is not there.
//
// ⚠ IT IS A REPORT, NOT A GATE, for `models:quality`'s reason: a gate that is red on the day it
// lands is a gate somebody turns off. `--fail-over N` is here for the day the list is short enough
// to hold. It opened at 25 models, worst 100%, and the kit's `clearOfMass` took it to 9, worst
// 100%: a band that can be lifted onto bare wall above whatever is in the way is lifted, and a
// PAINTED band that cannot be — the Seed Vault's frontage is one blast door, the Paper Tomb's is a
// portico across four projecting window slots — is dropped in favour of the flank elevations,
// which on those buildings are bare wall. A BOARD is never dropped: it is the only name a building
// that signs itself gets, so half hidden beats nameless.
//
// ⚠ THE NINE THAT ARE LEFT SPLIT INTO TWO KINDS, and neither is a placement mistake the kit can
// reach. Six are boards on a frontage with no clear band anywhere on it — The Milk House has a
// trough at knee height, a door, and a shelf rank at the top of the wall, with a 0.07 gap between
// them for an 0.08 band. Three are painted names the kit measures as CLEAR, hidden only from off
// square by a wing or a corner standing beside them, which is the ray test being a stricter
// question than any placement rule (see the ⚠ above).
//
// ⚠ AND ONE OF THE SIX IS A `base` DEFECT RATHER THAN A SIGN ONE. `derivedKit` takes `base` as the
// box with the LOWEST TOP, which on a building with a plinth is the PLINTH — so The Milk House's
// whole shopfront band is derived off something 0.07 of a tile tall and the name board lands at
// knee height. That reaches the windows, the door, the vent and the condenser as well as the sign,
// so it is not a thing to change from inside the signage section.
//
// ⚠ AND IT CASTS RAYS RATHER THAN COMPARING PLANES, which is the whole care of it: `clearOfMass`
// asks about mass overlapping the sign's own rectangle, and that is the right question for a
// PLACEMENT rule. It is not the whole question a viewer asks. A wing standing beside the sign
// hides most of it from forty degrees off and overlaps its rectangle not at all, so the numbers
// here are deliberately larger than anything the kit can promise to fix.
//
//   node scripts/shapes/signhide.mjs                # the board
//   node scripts/shapes/signhide.mjs --fail-over 8  # …and fail if more than 8 models are on it
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
ws.setTilePlace({ biome: 'citycore', wx: 909, wy: 910 });

const argv = process.argv.slice(2);
const capIx = argv.indexOf('--fail-over');
const CAP = capIx >= 0 ? Number(argv[capIx + 1]) : null;

// ⚠ EIGHT SEEDS, BECAUSE THE OFFENDING BOX IS OFTEN SEEDED. `vacantunit` draws a shutter, three
// boards or a broken window off `seed % 3` and only two of the three bury anything, so a one-seed
// sweep reports two thirds of that arm as clean.
const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7];
// Where somebody stands to read it: three distances, five bearings, three eye heights — a driver
// at 0.24, somebody on a first floor, and an aircraft on approach. A sign hidden from one of those
// is a sign; hidden from all thirty it is not there.
const EYES = [];
for (const dist of [2.2, 4.0]) for (const ang of [0, 20, -20, 40, -40]) for (const ez of [0.24, 0.9, 1.6]) {
  const a = ang * Math.PI / 180;
  EYES.push([Math.sin(a) * dist, Math.cos(a) * dist, ez]);
}

// Segment p→e against an axis-aligned box. `t1 > 1e-4` so a point sitting exactly on its own wall
// is not read as buried in it.
const hits = (p, e, b) => {
  let t0 = 0, t1 = 1;
  const lo = [b.cx - b.hw, b.cy - b.fd, b.z0], hi = [b.cx + b.hw, b.cy + b.fd, b.z1];
  for (let k = 0; k < 3; k++) {
    const d = e[k] - p[k];
    if (Math.abs(d) < 1e-9) { if (p[k] < lo[k] - 1e-6 || p[k] > hi[k] + 1e-6) return false; continue; }
    let a = (lo[k] - p[k]) / d, c = (hi[k] - p[k]) / d;
    if (a > c) { const s = a; a = c; c = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return t1 > 1e-4;
};

const rows = [];
let models = 0, signs = 0;
for (const { key, m } of ws.shapeModelRegistry()) {
  models++;
  let worst = null;
  for (const seed of SEEDS) {
    const { fh, h } = ws.buildingScaleFor(4, seed);
    let segs, kit;
    try { segs = ws.shapeForModel(m, seed); kit = ws.derivedTrim(m, fh, h, seed, true); } catch { continue; }
    if (!segs || !kit) continue;
    const V = (p) => (Array.isArray(p) ? p[0] * fh + p[1] * h + p[2] : (p || 0));
    const boxes = [];
    for (const s of segs) {
      if (s.kind !== 'box' || (s.yaw || 0)) continue;
      const f = ws.segFit(s, V);
      if (!(f.hw > 0.02)) continue;
      boxes.push({ cx: f.cx, cy: f.cy, hw: f.hw, fd: f.fd, z0: V(s.z0), z1: V(s.z1) });
    }
    // The FRONT name only. A flank panel is read from a yard and has its own geometry; folding the
    // two together would average a real defect into a wall nobody stands square to.
    for (const d of kit) {
      if (d.kind !== 'signBoard' && d.kind !== 'marqueeBand') continue;
      if (d.face || d.label !== '$name') continue;
      const cx = V(d.cx), cy = V(d.cy), z = V(d.z), half = V(d.half), hh = V(d.hh);
      if (!(half > 0)) continue;
      if (seed === SEEDS[0]) signs++;
      let hid = 0, tot = 0;
      for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) {
        const P = [cx + (-1 + 2 * (i + 0.5) / 9) * half * 0.98, cy + 0.002, z + (-1 + 2 * (j + 0.5) / 3) * hh * 0.9];
        for (const e of EYES) {
          if (e[1] <= P[1]) continue;           // an eye behind the wall reads nothing either way
          tot++;
          if (boxes.some((b) => hits(P, e, b))) hid++;
        }
      }
      const frac = tot ? hid / tot : 0;
      if (!worst || frac > worst.frac) worst = { seed, frac, bare: !!d.bare, z, plane: cy };
    }
  }
  if (worst && worst.frac > 0.02) rows.push({ key, ...worst });
}

rows.sort((a, b) => b.frac - a.frac);
console.log(`\n  signhide — ${models} models, ${signs} front name bands, ${EYES.length} eye positions each\n`);
if (!rows.length) console.log('  nothing hidden.');
for (const r of rows) {
  console.log(`  ${String(Math.round(r.frac * 100)).padStart(3)}%  ${r.bare ? 'painted' : 'board  '}  plane ${r.plane.toFixed(3)} z ${r.z.toFixed(3)}  ${r.key} (worst seed ${r.seed})`);
}
console.log(`\n  ${rows.length} model(s) whose own name is hidden by their own mass.`);

if (CAP !== null && rows.length > CAP) {
  console.error(`\n✗ signhide — ${rows.length} over the ${CAP} allowed.`);
  process.exit(1);
}
