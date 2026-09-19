// IS THERE A CLEAR BAND OF WALL UNDER THE NAME?
//
// `sign:stand` asks how far OUT a sign stands and `sign:fit` asks whether a WIRE is drawn across
// one. This asks the third question, which is about the wall itself: does the band of facade the
// name is painted on belong to the name, or is a shopfront window, a canopy or a cornice already
// occupying it?
//
// It is silent in every direction, and it is silent in the two ways that are hardest to read from a
// screenshot:
//
//   1. COPLANAR WITH THE THING IT CROSSES. A `signBoard` mounts at `faceY(cy)` and so does a
//      `windowBay`'s surround, so a board whose band dips into the glazing band is two quads in one
//      plane. On the painter the later one won and the sign drew; on a depth buffer it is a tie, a
//      tie is a coin toss, and the coin is tossed per pixel and per driver. What that looks like
//      from a cab is lettering lying ON the shopfront glass, flickering, half there.
//   2. BEHIND A SLAB THAT STICKS OUT. A `canopy` reaches `out` beyond its own mounting plane —
//      `adequate`'s reaches 0.115 of a tile, a quarter of the building's depth — so any part of a
//      sign inside the canopy's own height is simply not visible from the street, whatever the
//      depth test does. It reads as a name with its top sheared off.
//
// Both were live on Adequate! at once: 68% of that board's height was inside the shopfront glazing
// band, coplanar with it, and 15% more was behind the canopy, leaving 4% of the name on clear wall.
// Reported as "adequate logo floats ontop of windows and disappears", which is both halves of it.
//
// ⚠ THE Z SEMANTICS ARE NOT SHARED BETWEEN KINDS, AND READING THEM WRONG INVENTS AND HIDES FINDINGS
// IN EQUAL MEASURE. A first cut of this measurement treated every part as `z ± hh` and reported
// adequate's canopy at 31% when it is 15%, while missing the glazing overlap entirely because a
// `windowBay`'s surround is `hh + fr` tall rather than `hh`. The table below is read off the
// painters in windshield.js, and it is the whole of what this file knows:
//
//   signBoard   z is the CENTRE   band z ± hh                 plane faceY(cy)
//   windowBay   z is the CENTRE   band z ± (hh + fr)          front cy + depth   (fr = min(half,hh) * 0.26)
//   canopy      z is the BOTTOM   band z .. z + hh            front cy + out
//   awning      z is the BOTTOM   band z .. z + hh            front cy + out
//   parapet     z is the BOTTOM   band z .. z + hh            front half         (it wraps, so its reach is its radius)
//   neonRun     z is the TUBE     TWO regions, see below      plane faceY(cy)
//   shutter     z is the CENTRE   band z ± hh                 plane faceY(cy)
//
// ⚠ AND A PART IS NOT ALWAYS ONE BOX, WHICH IS WHY THIS RETURNS A LIST. `neonRun`'s `drop` hangs a
// vertical RETURN at each END of the run, not a curtain across the whole of it — so modelled as one
// box from `z - drop` to `z` it claims the entire band under the tube and reports a fascia sitting
// in clear air between the returns as buried. Adequate's corrected board tripped exactly that, and
// moving the board to satisfy it would have been the gate inventing the defect it exists to find.
//
// ⚠ AND IT READS THE FILES AN AUTHOR EDITS, NOT THE BAKE. The bake is derived from these, so a
// finding here is a finding there; what it buys is an error message naming the file and the part a
// person has to change. `repeat` is expanded, because a repeated bank of windows is exactly the
// thing a sign band runs into.
//
//   node scripts/shapes/signband.mjs            # gate
//   node scripts/shapes/signband.mjs --report   # every sign, with its numbers
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'building_models');
const REPORT = process.argv.includes('--report');

// How much of a name's own height another part may take before the name is compromised. A hair of
// overlap at the very edge of a band is what a fascia sitting ON a canopy looks like when the two
// numbers were chosen independently, and it costs nothing; a tenth of the lettering is a name with
// a bite out of it.
const TOL = 0.10;
// Two planes closer together than this are the same plane as far as a depth test is concerned —
// `FACE_EPS`'s own argument, and the reason a coplanar overlap counts as a conflict rather than as
// a sign that is safely in front.
const COPLANAR = 0.004;

const SIGNS = new Set(['signBoard', 'signPanel']);

// ── FOUR THAT NEED A DESIGN PASS RATHER THAN AN ARITHMETIC ONE ──────────────────────────────────
//
// ⚠ A PIN, NOT A BUDGET, AND NOT AN ALLOW-LIST OF NAMES. Each entry records the share MEASURED on
// 2026-09-19, and the gate fails if that share grows, if the conflict changes kind, or if an entry
// stops matching anything — so fixing one of these is a change that makes the gate ask for its pin
// to be deleted, and a NEW defect on a pinned model is still a failure. A bare list of model names
// would absorb both silently, which is the thing `signfit`'s own note warns about.
//
// All four are the same building: a one-storey shop whose podium is already full — shopfront
// glazing, a full-width canopy over the pavement, and a parapet a hand's breadth above it. There is
// no clear band to move the name into (the Cherry Pit's is 0.013 of a tile), so every arithmetic
// answer is bad in a different way: shrink the board to a third of its height, stand it 0.11 of a
// tile proud of the wall with nothing holding it up, or move the name onto the storey above. Which
// of those is right is a question about how the building should LOOK, and it wants somebody at the
// Modelshop rather than a number solved here.
const PINNED = new Map([
  ['thecherrypit|PIT|windowBay', 0.61],
  ['thecherrypit|PIT|canopy', 0.16],
  ['secondskin|SECOND SKIN|windowBay', 0.56],
  ['secondskin|SECOND SKIN|canopy', 0.17],
  ['deadspaceinteriors|DEAD SPACE|windowBay', 0.56],
  ['deadspaceinteriors|DEAD SPACE|canopy', 0.18],
  ['loafingaround|LOAFING AROUND|canopy', 0.17],
]);
const SEEN = new Set();

// ── WHAT A PART OCCUPIES ────────────────────────────────────────────────────────────────────────
// Returns a LIST of { z0, z1, front, lo, hi } in the model's own authored units, empty for a kind
// this gate has no opinion about. `front` is how far that region's FRONTMOST surface reaches out of
// the tile centre on its own side; `lo`/`hi` are its lateral span.
function extent(p) {
  const cy = Math.abs(p.cy || 0), cx = p.cx || 0;
  const half = p.half != null ? p.half : (p.w != null ? p.w : null);
  switch (p.kind) {
    case 'signBoard': case 'signPanel': case 'shutter': {
      if (p.z == null || p.hh == null || half == null) return [];
      return [{ z0: p.z - p.hh, z1: p.z + p.hh, front: cy, lo: cx - half, hi: cx + half }];
    }
    case 'windowBay': {
      if (p.z == null || p.hh == null || half == null) return [];
      const fr = Math.min(half, p.hh) * 0.26;                 // windshield.js: the surround's frame width
      const vo = p.hh + fr, ho = half + fr;
      const dep = p.depth != null ? p.depth : Math.min(half, p.hh) * 0.35;
      return [{ z0: p.z - vo, z1: p.z + vo, front: cy + dep, lo: cx - ho, hi: cx + ho }];
    }
    case 'canopy': case 'awning': {
      if (p.z == null || p.out == null || half == null) return [];
      const hh = p.hh != null ? p.hh : Math.max(p.out * 0.14, 0.01);
      return [{ z0: p.z, z1: p.z + hh, front: cy + p.out, lo: cx - half, hi: cx + half }];
    }
    case 'parapet': case 'cornice': {
      if (p.z == null || half == null) return [];
      const hh = p.hh != null ? p.hh : half * 0.12;
      // A parapet wraps the mass, so what it reaches is its own radius and it spans the whole width.
      return [{ z0: p.z, z1: p.z + hh, front: half, lo: -half, hi: half }];
    }
    case 'neonRun': {
      if (p.z == null || half == null) return [];
      const r = Math.max(0.004, half * 0.018);                // windshield.js: the tube's own radius
      const out = [{ z0: p.z - r, z1: p.z + r, front: cy, lo: cx - half, hi: cx + half }];
      if (p.drop) for (const sx of [-1, 1]) {                 // …and a return hanging at each END
        const bx = cx + sx * half;
        out.push({ z0: p.z - p.drop, z1: p.z, front: cy, lo: bx - r, hi: bx + r });
      }
      return out;
    }
    default: return [];
  }
}

// `repeat` is a count plus a per-step delta — a bank of windows, which is exactly what a sign band
// runs into, so it has to be expanded rather than skipped.
function* parts(list) {
  for (const p of list || []) {
    if (p.kind === 'repeat') {
      const n = p.count || 1, of = p.of || {}, st = p.step || {};
      for (let i = 0; i < n; i++) {
        const q = { ...of };
        for (const [k, v] of Object.entries(st)) q[k] = (q[k] || 0) + v * i;
        yield q;
      }
    } else yield p;
  }
}

const over = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const findings = [];
let signs = 0;

for (const f of files) {
  let d;
  try { d = JSON.parse(readFileSync(join(DIR, f), 'utf8')); }
  catch (e) { console.error(`  ${f}: ${e.message}`); process.exit(1); }
  const list = [...parts(d.detail)];
  for (const s of list) {
    if (!SIGNS.has(s.kind) || !s.label || s.bare) continue;
    const se = extent(s)[0]; if (!se) continue;
    signs++;
    const sh = se.z1 - se.z0;
    if (!(sh > 0)) continue;
    const sFront = (s.cy || 0) >= 0;                 // which face it is on; a parapet is on every one
    for (const o of list) {
      if (o === s) continue;
      const wraps = o.kind === 'parapet' || o.kind === 'cornice';
      if (!wraps && ((o.cy || 0) >= 0) !== sFront) continue;
      for (const oe of extent(o)) {
        const dz = over(se.z0, se.z1, oe.z0, oe.z1);
        if (dz <= 1e-9) continue;
        if (over(se.lo, se.hi, oe.lo, oe.hi) <= 1e-9) continue;
        // Behind the sign by a clear margin is the one safe arrangement: the sign is the frontmost
        // thing on that patch of wall and the depth test has a winner.
        if (oe.front < se.front - COPLANAR) continue;
        const share = dz / sh;
        if (share <= TOL) continue;
        const key = `${f.replace('.json', '')}|${s.label}|${o.kind}`;
        // ⚠ ROUNDED TO THE PRINTED PERCENT BEFORE COMPARING. The share is a ratio of authored
        // numbers and a pin written to two places would fail on a change that moves nothing a
        // person could see — the column this is read in is whole percent, so that is the precision
        // the pin is kept at, plus a percentage point of slack.
        const pin = PINNED.get(key);
        if (pin != null) { SEEN.add(key); if (share <= pin + 0.01) continue; }
        findings.push({
          f: f.replace('.json', ''), label: s.label, kind: o.kind, share,
          how: oe.front > se.front + COPLANAR ? 'in front of' : 'coplanar with',
          gap: oe.front - se.front, sz: [se.z0, se.z1], oz: [oe.z0, oe.z1],
          worse: pin != null ? pin : null,
        });
      }
    }
  }
}

findings.sort((a, b) => b.share - a.share);
if (REPORT || findings.length) {
  for (const r of findings) {
    console.log('  ' + r.f.padEnd(22) + String(r.label).slice(0, 18).padEnd(20) + r.kind.padEnd(11)
      + (r.share * 100).toFixed(0).padStart(4) + '%  ' + r.how.padEnd(14) + 'depth ' + r.gap.toFixed(3).padStart(7)
      + '   name z ' + r.sz.map((v) => v.toFixed(3)).join('..') + '  part z ' + r.oz.map((v) => v.toFixed(3)).join('..'));
  }
}
if (!signs) { console.error('  signband: no authored sign boards were read at all — the sweep is not wired'); process.exit(1); }
// A pin that matches nothing is a pin for a defect somebody has fixed, and leaving it behind is how
// this file would quietly stop noticing that model again.
const stale = [...PINNED.keys()].filter((k) => !SEEN.has(k));
if (stale.length) {
  console.error(`\n  ${stale.length} pinned conflict(s) no longer occur — delete them from PINNED:\n`);
  for (const k of stale) console.error('    ' + k);
  console.error('');
  process.exit(1);
}
if (findings.length) {
  console.error(`\n  ${findings.length} authored name band(s) share their wall with something else.`);
  for (const r of findings.filter((x) => x.worse != null)) {
    console.error(`    ${r.f} — ${r.kind} now takes ${(r.share * 100).toFixed(0)}% of "${r.label}", pinned at ${(r.worse * 100).toFixed(0)}%`);
  }
  console.error('  A name goes on a clear band: above the shopfront glazing, above the canopy deck, below the');
  console.error('  cornice. Move the board\'s `z` into the gap and shrink its `hh` to fit — or, where the board is');
  console.error('  simply sunk BEHIND the glazing it sits on, raise its `cy` so it stands proud of the glass.\n');
  process.exit(1);
}
console.log(`  signband: ${signs} authored name band(s) over ${files.length} models, every one on clear wall`
  + (PINNED.size ? ` (${PINNED.size} pinned — see PINNED)` : ''));
