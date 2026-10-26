// The Carcass: a Bowers Fly Baby, found in a field and flown again in three donors' paint.
//
// ⚠ THE BODY TUBE IS THE COCKPIT. interior-carcass.js reads the first body part's rings straight off
// its faces and builds the room inside them, at one scale: 5.74 m over the tube's 2.10 units. So the
// tube aft of the firewall ring (f 0.693) is kept face for face from the file, and its length must
// stay 2.10 from nose point to tail point or every metre in the cockpit moves. Only the nose is new:
// two rings ahead of the firewall turn the old cone into a blunt cowl, the way the real one is.
//
// ⚠ AND THE COCKPIT FITTINGS ARE THE INTERIOR'S, NOT A SECOND DESCRIPTION. The opening, the cheek
// boards, the glareshield hump, the windscreen frame and its two shards of perspex, the roll bar and
// the headrest are all placed from carcassProfile() and carcassGlass(), converted out of the
// interior's metres (eye at the origin) into model units. Change one there and re-run this.
//
// The paint is the interior's too: grey forward of f 0.30, red over the cockpit, blue aft of the
// opening (the outside skin you see over the windscreen is drawn in those three in the interior).
import { readFileSync } from 'node:fs';
import { R, P3, foilFaces, foilPt, lerpSt, ctrlOn, tube, mirror, group, poly, wheel } from './lib.mjs';
import { carcassProfile, carcassGlass, CARCASS } from '../../../client/shared/interior-carcass.js';

const FILE = new URL('../../../content/vehicle_models/mesh_wreck.json', import.meta.url);
const FIREWALL_RING = 0.693;

// ── vector bits ──
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => a + (b - a) * t;
const newell = (p) => {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]); }
  return [x, y, z];
};
const centroid = (p) => p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length, s[2] + q[2] / p.length], [0, 0, 0]);
// Wound so the Newell normal points away from `inside` (the lib's convention: derivedShade reads it).
const outward = (p, inside) => (dot(newell(p), sub(centroid(p), inside)) < 0 ? p.slice().reverse() : p);
// Keep the part of a polygon where fn(q) >= 0.
function clip(poly, fn) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = fn(a), db = fn(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]); }
  }
  return out;
}
const box = (f0, f1, g0, g1, h0, h1, extra) => {
  const c = [(f0 + f1) / 2, (g0 + g1) / 2, (h0 + h1) / 2];
  const v = (i, j, k) => [i ? f1 : f0, j ? g1 : g0, k ? h1 : h0];
  return [[v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)], [v(0, 0, 1), v(0, 1, 1), v(1, 1, 1), v(1, 0, 1)],
    [v(0, 0, 0), v(0, 0, 1), v(1, 0, 1), v(1, 0, 0)], [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)], [v(1, 0, 0), v(1, 0, 1), v(1, 1, 1), v(1, 1, 0)]].map((p) => ({ ...extra, p: outward(p, c) }));
};

export default async function carcass() {
  // ── THE TUBE ──────────────────────────────────────────────────────────────
  const doc = JSON.parse(readFileSync(FILE, 'utf8'));
  const oldBody = doc.params.parts.find((p) => p.faces && p.faces.some((f) => f.role === 'body'));
  const kept = oldBody.faces.filter((f) => f.p.every((q) => q[0] <= FIREWALL_RING + 1e-6));
  // The firewall ring, in order round the section (angle about its own centre).
  const ringPts = [];
  for (const f of kept) for (const q of f.p) if (Math.abs(q[0] - FIREWALL_RING) < 1e-6 && !ringPts.some((r) => Math.abs(r[1] - q[1]) < 1e-9 && Math.abs(r[2] - q[2]) < 1e-9)) ringPts.push(q);
  const c0 = ringPts.reduce((s, q) => s + q[2] / ringPts.length, 0);
  ringPts.sort((a, b) => Math.atan2(a[2] - c0, a[1]) - Math.atan2(b[2] - c0, b[1]));
  const N = ringPts.length;
  // The cowl: flat-sided back to the firewall, a round nose bowl, the prop hub on the old nose point.
  const NOSE = [1.05, 0, 0.02];
  const cowlRing = (f, s, c) => ringPts.map((q) => [f, q[1] * s, c + (q[2] - c0) * s]);
  const r90 = cowlRing(0.90, 0.95, 0.016), r100 = cowlRing(1.0, 0.64, 0.019);
  const axisAt = (f) => [f, 0, f > FIREWALL_RING ? lerp(c0, 0.02, (f - FIREWALL_RING) / (1.05 - FIREWALL_RING)) : 0.0];
  const nose = [];
  for (let j = 0; j < N; j++) {
    const k = (j + 1) % N;
    nose.push({ role: 'body', p: outward([ringPts[j], r90[j], r90[k], ringPts[k]], axisAt(0.8)) });
    nose.push({ role: 'body', p: outward([r90[j], r100[j], r100[k], r90[k]], axisAt(0.95)) });
    nose.push({ role: 'body', p: outward([r100[j], NOSE, NOSE, r100[k]], axisAt(1.02)) });
  }
  // Every station of the tube, nose to tail, for the overlays below.
  const stations = new Map();
  for (const f of [...kept, ...nose]) for (const q of f.p) {
    const key = q[0].toFixed(5);
    if (!stations.has(key)) stations.set(key, { f: q[0], pts: [] });
    const s = stations.get(key);
    if (!s.pts.some((r) => Math.abs(r[1] - q[1]) < 1e-9 && Math.abs(r[2] - q[2]) < 1e-9)) s.pts.push(q);
  }
  const ST = [...stations.values()].sort((a, b) => a.f - b.f);
  for (const s of ST) {
    s.c = s.pts.reduce((a, q) => a + q[2] / s.pts.length, 0);
    s.pts.sort((a, b) => Math.atan2(a[2] - s.c, a[1]) - Math.atan2(b[2] - s.c, b[1]));
    if (s.pts.length < N) s.pts = Array.from({ length: N }, () => s.pts[0]);
  }
  // The ring at any f, linear between stations as the quads are, pushed `off` proud of the skin.
  const ringAt = (f, off = 0) => {
    let i = 0;
    while (i < ST.length - 2 && ST[i + 1].f < f) i++;
    const A = ST[i], B = ST[i + 1], t = Math.min(1, Math.max(0, (f - A.f) / (B.f - A.f))), c = lerp(A.c, B.c, t);
    return { c, pts: A.pts.map((q, j) => {
      const g = lerp(q[1], B.pts[j][1], t), h = lerp(q[2], B.pts[j][2], t), r = Math.hypot(g, h - c) || 1;
      return [f, g + g / r * off, h + (h - c) / r * off];
    }) };
  };
  const cuts = (f0, f1) => [f0, ...ST.map((s) => s.f).filter((f) => f > f0 + 1e-6 && f < f1 - 1e-6), f1];
  // Skin panels proud of the tube between f0 and f1 on the facets `js` (all when omitted), clipped
  // by `keep` if given. The paint jobs, the tape and the hole all go on with this.
  const skinPanels = (f0, f1, extra, { js = null, keep = null, off = 0.0022 } = {}) => {
    const out = [], fs = cuts(f0, f1);
    for (let i = 0; i < fs.length - 1; i++) {
      const A = ringAt(fs[i], off), B = ringAt(fs[i + 1], off);
      for (let j = 0; j < N; j++) {
        if (js && !js.includes(j)) continue;
        const k = (j + 1) % N;
        let p = [A.pts[j], B.pts[j], B.pts[k], A.pts[k]];
        if (keep) p = clip(p, keep);
        if (p.length < 3) continue;
        out.push({ role: 'body', ...extra, p: outward(p, [(fs[i] + fs[i + 1]) / 2, 0, (A.c + B.c) / 2]) });
      }
    }
    return out;
  };
  // Facet j's mid-angle, 0 at starboard waterline, 90 at the crown.
  const facetAng = (j) => { const s = ringAt(0); const a = s.pts[j], b = s.pts[(j + 1) % N]; return Math.atan2((a[2] + b[2]) / 2 - s.c, (a[1] + b[1]) / 2) * 180 / Math.PI; };
  const facets = (lo, hi) => [...Array(N).keys()].filter((j) => { const a = facetAng(j); return a >= lo && a <= hi; });

  // The donors: grey forward, red over the cockpit, blue aft, exactly where the interior paints them.
  const paintOf = (f) => (f.p.some((q) => q[0] > 0.3466) ? 'grey' : f.p.every((q) => q[0] >= -1e-6) ? 'red' : f.p.every((q) => q[0] >= -0.3676) ? 'red' : 'blue');
  // ⚠ EXACT: the kept faces go back out digit for digit (rounding them moves the room, and makes the
  // next run read a different firewall ring); only the new nose is rounded.
  const body = poly('body 1', [...kept.map((f) => ({ ...f, paint: paintOf(f) })), ...nose.map((f) => ({ ...f, p: f.p.map((q) => (ringPts.includes(q) ? q : P3(q))), paint: 'grey' }))], { exact: true });
  const donors = poly('donor panels', [
    ...skinPanels(-0.3675, CARCASS.open[0], { paint: 'blue' }),
    ...skinPanels(0.30, 0.3465, { paint: 'grey' }),
    // A gaffer seam where the blue tail cone was joined on, and one round the firewall.
    ...skinPanels(CARCASS.open[0] - 0.012, CARCASS.open[0] + 0.004, { paint: 'tape' }, { off: 0.0034 }),
    ...skinPanels(0.68, 0.70, { paint: 'tape' }, { off: 0.0034 }),
    // A road sign riveted over a hole in the port side, and an alloy panel on the starboard tail cone.
    ...skinPanels(0.05, 0.16, { paint: 'sign' }, { js: facets(-200, -150).slice(0, 1), off: 0.0034 }),
    ...skinPanels(-0.62, -0.48, { paint: 'alu' }, { js: facets(-10, 40).slice(0, 2), off: 0.0034 }),
    // Oil down the belly from the cowl.
    ...skinPanels(-0.05, 0.69, { paint: 'oil' }, { js: facets(-110, -70), off: 0.0026 }),
  ]);

  // ── THE COCKPIT, FROM THE INTERIOR'S OWN NUMBERS ─────────────────────────
  const P = carcassProfile({ parts: [body] });
  const D = P.carcass;
  const K = CARCASS;
  // Interior metres (x right, y forward, z up, eye at 0) to model units (f, g, h).
  const toM = (q) => [q[1] / D.m + K.eyeF, q[0] / D.m, q[2] / D.m + D.hE];
  const hOf = (z) => z / D.m + D.hE;
  const [fO0, fO1] = K.open;
  const sill = D.hSill;
  // The hole: the skin above the sill between the fore and aft edges of the opening, gone dark.
  const hole = poly('cockpit opening', skinPanels(fO0, fO1, { paint: 'hole' }, { keep: (q) => q[2] - sill, off: 0.0028 }));
  // The cheek boards up the sides of it, to shoulder height, their outsides in red, standing on the
  // skin; a padded roll along the top of each and carried round to the glareshield.
  const cheekG = (K.cheekX + 0.012) / D.m, cheekTop = hOf(K.cheekZ);
  // The top of the skin over (f, g); where g is outboard of the tube, its widest point.
  const skinTop = (f, g) => { const z = D.deckAt(f, g * D.m); return Number.isFinite(z) ? hOf(z) : ringAt(f).c; };
  const boards = [], rolls = [];
  for (const s of [1, -1]) {
    const fs = [0, 1, 2, 3, 4].map((i) => lerp(fO0, fO1, i / 4));
    for (let i = 0; i < 4; i++) {
      const a = fs[i], b = fs[i + 1];
      boards.push({ role: 'body', paint: 'red', p: outward([[a, s * cheekG, Math.min(sill, skinTop(a, cheekG)) - 0.003], [b, s * cheekG, Math.min(sill, skinTop(b, cheekG)) - 0.003], [b, s * cheekG, cheekTop], [a, s * cheekG, cheekTop]], [(a + b) / 2, 0, cheekTop - 0.03]) });
    }
    boards.push({ role: 'body', paint: 'ply', p: outward([[fO0, s * (cheekG - 0.0045), sill], [fO0, s * cheekG, sill], [fO0, s * cheekG, cheekTop], [fO0, s * (cheekG - 0.0045), cheekTop]], [fO0 + 0.05, s * cheekG, cheekTop - 0.03]) });
    rolls.push(tube('cheek roll', [[fO0, s * (cheekG - 0.002), cheekTop + 0.004], [fO1, s * (cheekG - 0.002), cheekTop + 0.004], toM([s * 0.25 * 0.98, D.glareY, D.glareZ + 0.008])], 0.0058, { role: 'body', paint: 'vinyl', sides: 6 }));
  }
  // The glareshield hump: a plywood deck over the panel, from the opening's front edge down to the
  // tube 1.05 m ahead of the eye, 0.5 m wide, with its sides boarded down to the skin.
  const GS = { f0: toM([0, D.glareY, 0])[0], f1: toM([0, 1.05, 0])[0], half: 0.25 / D.m };
  const gzAt = (f) => lerp(hOf(D.glareZ), hOf(D.deckAt(0.40, 0) + 0.01), (f - GS.f0) / (GS.f1 - GS.f0));
  const hump = [];
  for (let k = 0; k < 6; k++) {
    const a = lerp(GS.f0, GS.f1, k / 6), b = lerp(GS.f0, GS.f1, (k + 1) / 6);
    hump.push({ role: 'body', paint: 'ply', p: outward([[a, -GS.half, gzAt(a)], [a, GS.half, gzAt(a)], [b, GS.half, gzAt(b)], [b, -GS.half, gzAt(b)]], [(a + b) / 2, 0, gzAt((a + b) / 2) - 0.05]) });
    for (const s of [1, -1]) {
      const sa = Math.min(skinTop(a, GS.half), gzAt(a)) - 0.004, sb = Math.min(skinTop(b, GS.half), gzAt(b)) - 0.004;
      hump.push({ role: 'body', paint: 'ply', p: outward([[a, s * GS.half, sa], [b, s * GS.half, sb], [b, s * GS.half, gzAt(b)], [a, s * GS.half, gzAt(a)]], [(a + b) / 2, 0, gzAt((a + b) / 2) - 0.03]) });
    }
  }
  // Its back edge is the top of the panel, seen through the hole.
  hump.push({ role: 'body', paint: 'panel', p: outward([[GS.f0, -GS.half, sill], [GS.f0, GS.half, sill], [GS.f0, GS.half, gzAt(GS.f0)], [GS.f0, -GS.half, gzAt(GS.f0)]], [GS.f0 + 0.05, 0, sill + 0.05]) });
  rolls.push(tube('glareshield roll', [[GS.f0 - 0.0015, -GS.half * 0.98, gzAt(GS.f0) + 0.003], [GS.f0 - 0.0015, GS.half * 0.98, gzAt(GS.f0) + 0.003]], 0.0058, { role: 'body', paint: 'vinyl', sides: 6 }));

  // The windscreen: the interior's square frame, and the two shards of perspex still in it.
  const yW = D.glareY + 0.03, base = D.glareZ - 0.01, tz = 0.06;
  const screen = [
    tube('screen post', [toM([-0.19, yW, base]), toM([-0.185, yW - 0.05, tz])], 0.0035, { role: 'strut', paint: 'steel', sides: 5 }),
    tube('screen post', [toM([0.19, yW, base]), toM([0.185, yW - 0.05, tz])], 0.0035, { role: 'strut', paint: 'steel', sides: 5 }),
    tube('screen top', [toM([-0.185, yW - 0.05, tz]), toM([0.185, yW - 0.05, tz])], 0.0035, { role: 'strut', paint: 'steel', sides: 5 }),
    tube('screen base', [toM([-0.19, yW, base]), toM([0.19, yW, base])], 0.003, { role: 'strut', paint: 'steel', sides: 5 }),
    poly('perspex shards', carcassGlass(D).map((pane) => ({ role: 'glass', two: true, p: pane.map(toM) }))),
    // The landing light: a torch gaffer-taped to the left post.
    tube('torch', [toM([-0.215, yW - 0.03, -0.03]), toM([-0.215, yW + 0.07, -0.03])], 0.018 / D.m, { role: 'strut', paint: 'orange', sides: 6 }),
  ];
  // The roll bar: scaffold pipe and clamps; the headrest: a sofa cushion strapped to it.
  const rbY = -0.56, rbTop = 0.16;
  const rollBar = [
    ...[1, -1].map((s) => tube('roll bar post', [toM([s * 0.19, rbY, D.deckAt(-0.225, s * 0.19)]), toM([s * 0.19, rbY, rbTop])], 0.021 / D.m, { role: 'strut', paint: 'scaffold', sides: 6 })),
    tube('roll bar top', [toM([-0.19, rbY, rbTop]), toM([0.19, rbY, rbTop])], 0.021 / D.m, { role: 'strut', paint: 'scaffold', sides: 6 }),
  ];
  const lo = toM([-0.13, rbY + 0.022, -0.26]), hi = toM([0.13, rbY + 0.10, 0.06]);
  const strapLo = toM([-0.14, rbY + 0.02, -0.08]), strapHi = toM([0.14, rbY + 0.104, -0.06]);
  const headrest = poly('headrest', [...box(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], { role: 'body', paint: 'cushion' }),
    ...box(strapLo[0], strapHi[0], strapLo[1], strapHi[1], strapLo[2], strapHi[2], { role: 'body', paint: 'orange' })]);

  const cockpit = group('cockpit', [
    hole, poly('cheek boards', boards), poly('glareshield', hump),
    group('fittings', [...rolls, ...screen, ...rollBar, headrest], { minDetail: 1 }),
  ]);

  // ── THE WING: low, straight, wire-braced; the port panel off a silver donor ──────────────────
  const W = [
    { g: 0.06, le: 0.385, te: -0.07, h: -0.085, t: 1.0 },
    { g: 1.40, le: 0.385, te: -0.07, h: -0.024, t: 0.92 },
    { g: 1.49, le: 0.37, te: -0.058, h: -0.020, t: 0.75 },
    { g: 1.535, le: 0.33, te: -0.034, h: -0.019, t: 0.45 },
  ];
  const sidePaint = (faces, stbd, port) => faces.map((f) => ({ ...f, paint: f.p.every((q) => q[1] >= 0) ? stbd : port }));
  const wing = group('wing', [
    poly('wing (near)', sidePaint(foilFaces(W, { nx: 9, lowerSh: 0.55 }), 'fabric', 'silver'), { minDetail: 1 }),
    poly('wing (far)', sidePaint(foilFaces(W, { nx: 4, lowerSh: 0.55 }), 'fabric', 'silver'), { maxDetail: 0 }),
  ]);
  // One ctrl per side, so each wears its own wing's donor; the starboard aileron is a third donor's.
  const portOf = (c) => ({ ...c, le: c.le.map((q) => [q[0], -q[1], q[2]]), te: c.te.map((q) => [q[0], -q[1], q[2]]), side: -c.side });
  const ail = { ...ctrlOn('aileron', W[0], W[1], 0.56, 0.98, 0.25).parts[0] };
  const flp = { ...ctrlOn('flap', W[0], W[1], 0.06, 0.52, 0.22).parts[0] };
  const surfaces = group('ailerons and flaps', [
    { ...ail, paint: 'blue' }, { ...portOf(ail), paint: 'silver' },
    { ...flp, paint: 'fabric' }, { ...portOf(flp), paint: 'silver' },
  ]);
  // Doped linen over a tear in the starboard wing, and tape across a split in the port one.
  const onW = (g) => lerpSt(W[0], W[1], (g - W[0].g) / (W[1].g - W[0].g));
  const upper = (g, x, o = 0.0022) => { const p = foilPt(onW(g), x, 1); return [p[0], p[1], p[2] + o]; };
  const wingPatches = poly('wing patches', [
    { role: 'wing', paint: 'linen', p: [upper(0.62, 0.30), upper(0.84, 0.30), upper(0.84, 0.55), upper(0.62, 0.55)] },
    { role: 'wing', paint: 'tape', p: [upper(0.98, 0.10), upper(1.02, 0.10), upper(1.02, 0.78), upper(0.98, 0.78)].map((q) => [q[0], -q[1], q[2]]).reverse() },
  ], { minDetail: 1 });

  // The wires: landing wires from a cabane on the hump to the spars, flying wires from the lower
  // longerons to the same spars underneath.
  const spar = (x, g, up) => { const s = onW(g), u = foilPt(s, x, 1), l = foilPt(s, x, 0); return [u[0], g, up ? u[2] : l[2]]; };
  const cabF = 0.27, apex = [cabF, 0, 0.255];
  const cab = [[0.33, 0.06], [0.21, 0.06]].map(([f, g]) => [f, g, gzAt(f)]);
  const WG = 0.86;
  const wires = mirror('wires', [
    ...cab.map((q) => tube('cabane strut', [q, apex], 0.0045, { role: 'strut', paint: 'steel', sides: 5 })),
    tube('landing wire', [apex, spar(0.25, WG, true)], 0.0018, { role: 'strut', paint: 'wire', sides: 4 }),
    tube('landing wire', [apex, spar(0.7, WG, true)], 0.0018, { role: 'strut', paint: 'wire', sides: 4 }),
    tube('flying wire', [[0.36, 0.07, -0.098], spar(0.25, WG, false)], 0.0018, { role: 'strut', paint: 'wire', sides: 4 }),
    tube('flying wire', [[0.08, 0.075, -0.108], spar(0.7, WG, false)], 0.0018, { role: 'strut', paint: 'wire', sides: 4 }),
  ], { minDetail: 1 });

  // ── THE GEAR: steel-tube vees to the axles, and a tailwheel on a leaf spring ──
  const axle = [0.44, 0.265, -0.262];
  const gear = mirror('main gear', [
    tube('gear leg', [[0.47, 0.065, -0.094], axle], 0.0075, { role: 'gear', paint: 'steel', sides: 6 }),
    tube('gear leg', [[0.31, 0.075, -0.105], axle], 0.0075, { role: 'gear', paint: 'steel', sides: 6 }),
    tube('axle', [[axle[0], axle[1] - 0.03, axle[2]], axle], 0.006, { role: 'gear', paint: 'steel', sides: 6 }),
    wheel('main wheel', axle, 0.068, 0.024, 14),
  ]);
  const tailwheel = group('tailwheel', [
    tube('tail spring', [[-0.86, 0, 0.016], [-0.93, 0, 0.007], [-0.952, 0, 0.004]], 0.0045, { role: 'gear', paint: 'steel', sides: 5 }),
    wheel('tailwheel', [-0.955, 0, 0.004], 0.024, 0.01, 10),
  ]);

  // ── THE TAIL: a braced tailplane off the red donor, a tall round fin, a primer-green rudder ──
  const T = [
    { g: 0, le: -0.79, te: -1.035, h: 0.068, t: 0.85 },
    { g: 0.38, le: -0.82, te: -1.035, h: 0.068, t: 0.75 },
    { g: 0.445, le: -0.87, te: -1.02, h: 0.068, t: 0.5 },
  ];
  const tailplane = group('tailplane', [
    poly('tailplane (near)', foilFaces(T, { nx: 8, role: 'stab' }), { minDetail: 1, paint: 'red' }),
    poly('tailplane (far)', foilFaces(T, { nx: 4, role: 'stab' }), { maxDetail: 0, paint: 'red' }),
  ]);
  const elevators = { ...ctrlOn('elevator', T[0], T[1], 0.12, 0.98, 0.4), paint: 'red' };
  const F = [
    { g: 0.05, le: -0.80, te: -1.125, h: 0, t: 1.0 },
    { g: 0.26, le: -0.89, te: -1.135, h: 0, t: 0.9 },
    { g: 0.33, le: -0.95, te: -1.12, h: 0, t: 0.7 },
    { g: 0.36, le: -1.01, te: -1.09, h: 0, t: 0.4 },
  ];
  const fin = group('fin', [
    poly('fin (near)', foilFaces(F, { nx: 8, role: 'fin', axis: 'g', sides: 1, lowerSh: 0.72 }), { minDetail: 1, paint: 'fabric' }),
    poly('fin (far)', foilFaces(F, { nx: 4, role: 'fin', axis: 'g', sides: 1, lowerSh: 0.72 }), { maxDetail: 0, paint: 'fabric' }),
  ]);
  const rudder = { ...ctrlOn('rudder', F[0], F[1], 0, 1, 0.3, { axis: 'g', sh: 0.72 }), paint: 'chromate' };
  const tailWires = mirror('tail wires', [
    tube('tail wire', [[-0.90, 0.26, 0.076], [-0.92, 0, 0.22]], 0.0016, { role: 'strut', paint: 'wire', sides: 4 }),
    tube('tail wire', [[-0.90, 0.26, 0.062], [-0.86, 0, 0.014]], 0.0016, { role: 'strut', paint: 'wire', sides: 4 }),
  ], { minDetail: 1 });

  // Two stacks under the cowl, rusted through.
  const stacks = mirror('exhaust stacks', [tube('exhaust stack', [[0.80, 0.045, -0.07], [0.68, 0.05, -0.112]], 0.009, { role: 'nacelle', paint: 'exhaust', sides: 6 })]);

  const tip = foilPt(W[3], 0.5, 1);
  const parts = [body, donors, cockpit, wing, surfaces, wingPatches, wires, gear, tailwheel, tailplane, elevators, fin, rudder, tailWires, stacks];
  return {
    id: 'wreck', kind: 'mesh',
    params: {
      name: 'Carcass',
      note: 'A Bowers Fly Baby rebuilt from three wrecks: a grey cowl, a red cockpit section and a blue tail cone, a cream starboard wing and a silver port one, a primer-green rudder. Open cockpit with plywood cheek boards, a square military windscreen frame with two shards of perspex left in it, a scaffold roll bar with a sofa cushion for a headrest, a cabane and landing and flying wires, steel-tube main gear and a tailwheel. The tube aft of the firewall and every cockpit fitting are the interior\'s (interior-carcass.js); see scripts/shapes/fw-meshes/carcass.mjs.',
      groundPitch: 12.5,
      navLamps: P3([tip[0], 1.535, tip[2]]),
      rotors: [{ at: [1.062, 0, 0.02], plane: 'fore', r: 0.29, blades: 2, lead: 0.85 }],
      paints: {
        grey: { rgb: [118, 120, 116], livery: 'fixed' },
        red: { rgb: [142, 54, 42], livery: 'fixed' },
        blue: { rgb: [58, 80, 112], livery: 'fixed' },
        fabric: { rgb: [196, 186, 160], livery: 'fixed', mat: 'matte' },
        silver: { rgb: [168, 172, 170], livery: 'fixed' },
        chromate: { rgb: [132, 146, 72], livery: 'fixed', mat: 'matte' },
        linen: { rgb: [214, 200, 160], livery: 'fixed', mat: 'matte' },
        alu: { rgb: [150, 154, 156], livery: 'fixed' },
        sign: { rgb: [214, 180, 40], livery: 'fixed' },
        tape: { rgb: [150, 152, 150], livery: 'fixed' },
        oil: { rgb: [54, 48, 40], livery: 'fixed', mat: 'matte' },
        hole: { rgb: [20, 18, 17], livery: 'fixed', mat: 'matte' },
        ply: { rgb: [96, 104, 86], livery: 'fixed', mat: 'matte' },
        panel: { rgb: [70, 72, 70], livery: 'fixed', mat: 'matte' },
        vinyl: { rgb: [52, 40, 34], livery: 'fixed', mat: 'matte' },
        cushion: { rgb: [120, 88, 60], livery: 'fixed', mat: 'matte' },
        orange: { rgb: [226, 108, 30], livery: 'fixed' },
        steel: { rgb: [96, 100, 104], livery: 'fixed' },
        scaffold: { rgb: [128, 132, 136], livery: 'fixed' },
        wire: { rgb: [70, 72, 74], livery: 'fixed' },
        exhaust: { rgb: [124, 64, 30], livery: 'fixed', mat: 'matte' },
      },
      parts,
    },
  };
}
