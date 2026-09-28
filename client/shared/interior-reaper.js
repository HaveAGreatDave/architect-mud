// THE REAPER'S COCKPIT: a Fairchild A-10A Thunderbolt II, from the seat.
//
// One pilot, high on an ACES II ejection seat in a titanium tub, under a bubble so clear that
// visibility was the whole sales pitch. Ahead of you a heavy windscreen bow carrying the HUD and
// three mirrors, a grey steam-gauge panel (armament on the left, flight in the middle, both engines
// on the right), the three fire T-handles along its top edge, and a stick between your knees. Two
// throttles side by side on the left console, the flap lever outboard of them.
//
// ⚠ WHY THE A-10A AND NOT THE A-10C. The C replaced the left of the panel with two multifunction
// displays and the armament panel with a stores-management page. The A keeps the armament control
// panel as a real row of switches and lamps, and every one of its gauges is a needle over a value
// this sim actually has (IAS, altitude, VVI, heading, engine speed, fuel). A glass cockpit would be
// two screens showing pictures of those same needles.
//
// Sources read (2026-09-24):
//   https://en.wikipedia.org/wiki/Fairchild_Republic_A-10_Thunderbolt_II
//     (16.26 m long; 540 kg titanium "bathtub" with a nylon spall liner; armoured windscreen)
//   https://www.lockon.ru/en/flaming_cliffs_2/training/A-10A.php
//     (the flight group: ADI in the middle, airspeed left of it, altimeter right, HSI under it, VVI)
//   https://www.digitalcombatsimulator.com/en/products/planes/warthog/ and the DCS A-10A manual
//     (armament control panel on the front LEFT; fuel panel on the forward left console)
//   https://thewarthogproject.com/the-plans  (panel/console/seat split of a builder's replica)
//
// ── ⚠ THE ROOM IS THE EXTERIOR'S CANOPY AND HULL, NEVER A SECOND DESCRIPTION ──
//
// The outside of this aeroplane is `FW_ROWS.gunship`, a row of plain numbers that aircraft3d.js's
// `buildFixedWing` turns into a mesh. This file reads the SAME row and runs the same three
// formulas (`czAt`, `radAt`, the canopy's windowed sine) — the precedent is `drawNoseArt`, which
// reconstructs the hull the same way so a decal wraps the real skin. It cannot import the builder:
// that is a 7,000-line canvas renderer in client/game, and client/shared must not reach into it.
// So the reconstruction is held against the built mesh by scripts/shapes/cockpit-reaper.mjs, which
// imports `aircraftFaces` itself and measures the glass independently.
//
//   · the SILL is the canopy's base ring, station for station: the glass base is where the rail is.
//   · the WALLS below it are the fuselage ring, inset by the tub (SKIN), at every station.
//   · the BOW is the canopy ring at t = 1/8, a real ring seam of the exterior's 8 segments.
//   · the EYE is where the exterior already draws the pilot: the 'reaper' canopy art paints the
//     helmet at U 0.30 along the canopy, and U runs f0 → f1. That fixes the eye's station.
//
// ⚠ ONE SCALE, STATED ONCE: M = 16.26 m / 2.08 units = 7.82 m per model unit. 16.26 m is the A-10A's
// overall length; 2.08 units is the model's nose tip (noseF 1.0) to its rearmost point (the fin
// trailing edge, finF2 −1.08). Everything off the row goes through X/Y/Z below and nowhere else.
//
// ⚠ WHERE THE EXTERIOR IS TOO COARSE, AND WHAT WAS DONE. The hull is a 12-gon, so its crown is a
// POINT: at the sill height the ring is only 0.29 m half-wide while the canopy base (0.58 m) hangs
// out past it. On the aircraft that overhang is covered by the canopy rail, so it is modelled as a
// flat sill SHELF from the tub wall out to the glass base. The shelf pokes past the 12-gon by up to
// 0.28 m over a band 5 cm tall. That is the exterior's own mismatch and it is left visible here
// rather than hidden by moving the sill off the glass. The floor (−1.15 m) is not the hull's belly
// (−2.5 m): below the tub are the gun and the nose-gear well, which the exterior does not describe
// at all. Seats, sticks, dials and levers are honest METRES for a person.
//
// Pure: no DOM, no camera. `live` is optional everywhere and every reader has a resting value.
import { makeKit, C, clamp, pedal, SHINY, PANE, TEXTURE } from './interior-kit.js';
import { eased, pressPulse, hotspotHalo } from './interior-cockpit-kit.js';
import { FW_ROWS } from './vehicle-models.js';

const TAU = Math.PI * 2;
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

// ── THE NUMBERS ABOUT THE AEROPLANE ──────────────────────────────────────────
export const REAPER_LEN_M = 16.26;   // A-10A overall length
export const REAPER_EYE_U = 0.30;    // the helmet's U in the 'reaper' canopy art (aircraft3d.js)
export const REAPER_BOW_T = 1 / 8;   // the bow frame: the first ring seam of the canopy's 8 segments
// ── THE NUMBERS ABOUT A PERSON (metres) ──────────────────────────────────────
const EYE_OVER_SILL = 0.44;   // a seated pilot's eye over the canopy rail, elbow on the sill
const SKIN = 0.06;            // skin, frames and the titanium tub with its spall liner
const FLOOR_Z = -1.15;        // the tub floor under the pedals
const BULK_Y = -0.64;         // the armour bulkhead behind the seat
const DECK_DROP = 0.10;       // the avionics deck aft of it, this far under the sill
const PANEL_Y = 0.56;         // the main instrument panel's face: a forearm and a half ahead
const PZ = -0.39;             // its centre height, and half its height
const PHH = 0.25;
// ⚠ THE GLARESHIELD LIP IS 13° UNDER THE HORIZON (0.09 down at 0.39 ahead). The first cut had the
// whole panel 0.64 ahead and 16° down, and from the seat it was a small grey card at the bottom of
// the frame. An A-10 pilot looks OVER a short coaming at a big panel close in front of the knees.
const COAM_Y = 0.39;          // the glareshield lip
const COAM_Z = -0.09;         // the glareshield's top
const CONS_Z = -0.60;         // the side consoles' tops
const CONS_IN = 0.25;         // their inboard edges
const SEAT_Z = -0.80;         // the top of the seat cushion (the survival kit)
const SEAT_Y = [-0.42, 0.04];
const BACK_Z = -0.18;         // the top of the back cushion: the headrest stands above it

// ── THE TRIM ─────────────────────────────────────────────────────────────────
// Authored here, like the Drake's: an A-10's cockpit is the same colours in every one ever built —
// dark gull grey (FS 36231) walls and panels, black console faces with white lettering, an olive
// survival-kit cushion and a sage harness.
export const REAPER_TRIM = {
  gull: [92, 96, 98], gullDk: [72, 76, 78], floor: [46, 48, 48], deck: [40, 42, 44],
  panel: [44, 47, 49], plate: [26, 27, 29], plateLt: [60, 64, 66], frame: [58, 62, 64],
  od: [80, 86, 54], odDk: [58, 62, 40], seat: [64, 68, 68], harness: [110, 112, 84],
  letter: [226, 226, 218], night: [255, 220, 160], metal: [150, 154, 160], ti: [128, 130, 128],
  mirror: [150, 170, 190], hudGlass: [30, 70, 50], liner: [84, 88, 86], grip: [32, 33, 35], boot: [24, 25, 27],
};
const T = REAPER_TRIM;
SHINY.set(T.metal, { spec: 0.7, pow: 20 });
// The surfaces, for the GL pass's per-pixel texture: a warbird is painted metal, not plastic.
for (const k of ['gull', 'gullDk', 'panel', 'plate', 'plateLt', 'frame', 'seat']) TEXTURE.set(T[k], 'paint');
for (const k of ['floor', 'deck', 'ti']) TEXTURE.set(T[k], 'cast');
for (const k of ['liner', 'od', 'odDk', 'harness']) TEXTURE.set(T[k], 'fabric');
TEXTURE.set(T.metal, 'brushed'); TEXTURE.set(T.grip, 'rubber'); TEXTURE.set(T.boot, 'rubber');
SHINY.set(T.mirror, { spec: 1, pow: 40 });
SHINY.set(T.frame, { spec: 0.2, pow: 10 });
// Contact shadows: see-through black under the seat and the stick boot.
const SHADE_SOFT = [0, 0, 2], SHADE_CORE = [2, 0, 0];
PANE.set(SHADE_SOFT, 0.18); PANE.set(SHADE_CORE, 0.30);

// ── THE EXTERIOR, RECONSTRUCTED FROM ITS OWN ROW ─────────────────────────────
//
// Exactly buildFixedWing at detail 1: `czAt`, `radAt`, `radVAt`, the ring, and the canopy's
// `crown`/`prof`. Coordinates are the model's own: f forward, g starboard, h up.
export function gunshipHull(p) {
  const cp = p.canopy;
  const sides = p.sides || 12, shapeExp = 1 - (p.boxy || 0) * 0.55;
  const noseK = p.noseBlunt || 2.4, tube = p.bodyTube || 0, cowl = p.noseCowl || 0;
  const czAt = (f) => {
    if (f < 0) return (p.tailUp ?? 0.05) * (f / p.tailF);
    const u = Math.min(1, f / p.noseF);
    const t = tube ? Math.max(0, (u - tube) / (1 - tube)) : u;
    return (p.noseZ ?? 0.02) * Math.pow(t, p.noseDroopK ?? 1);
  };
  const radAt = (f) => {
    let u = Math.min(1, Math.abs(f >= 0 ? f / p.noseF : f / p.tailF));
    u = u <= tube ? 0 : (u - tube) / (1 - tube);
    if (f >= 0) { const s = Math.pow(Math.max(0, 1 - Math.pow(u, noseK)), 1 / noseK); return cowl + (1 - cowl) * s; }
    return Math.pow(1 - u, 0.8);
  };
  const radVAt = (f) => {
    const rH = radAt(f);
    if (!(p.noseVTaper && f > 0)) return rH;
    const u = Math.min(1, f / p.noseF), t = u <= tube ? 0 : (u - tube) / (1 - tube);
    return rH * ((p.noseVFloor || 0) + (1 - (p.noseVFloor || 0)) * Math.pow(1 - t, p.noseVTaper));
  };
  const ring = (f) => {
    const rW = radAt(f), rH = radVAt(f), cz = czAt(f), out = [];
    for (let k = 0; k < sides; k++) {
      const a = k / sides * TAU, ca = Math.cos(a), sa = Math.sin(a);
      out.push([Math.sign(ca) * Math.pow(Math.abs(ca), shapeExp) * p.fr * rW,
        cz + Math.sign(sa) * Math.pow(Math.abs(sa), shapeExp) * p.fv * rH]);
    }
    return out;
  };
  // The hull's half-width at height h, off the ring's own edges.
  const hwAt = (f, h) => {
    const R = ring(f);
    let best = 0;
    for (let k = 0; k < R.length; k++) {
      const [g0, h0] = R[k], [g1, h1] = R[(k + 1) % R.length];
      if ((h - h0) * (h - h1) > 0 || h0 === h1) continue;
      best = Math.max(best, g0 + (g1 - g0) * (h - h0) / (h1 - h0));
    }
    return best;
  };
  const crown = (f) => czAt(f) + p.fv * radAt(f) - (cp.sink ?? 0.015);
  const cf = cp.front ?? 0.12, ct = cp.tail ?? 0.04;
  const prof = (t) => Math.sin(Math.PI * (cf + (1 - cf - ct) * t));
  const fAt = (t) => cp.f0 + (cp.f1 - cp.f0) * t;
  const tAt = (f) => (f - cp.f0) / (cp.f1 - cp.f0);
  // The canopy's ring at t: arc+1 points, starboard base → crown → port base, as [g, h].
  const canopyRing = (t) => {
    const f = fAt(t), s = prof(t), z0 = crown(f), arc = cp.arc || 3, out = [];
    for (let k = 0; k <= arc; k++) { const a = Math.PI * k / arc; out.push([Math.cos(a) * cp.w * s, z0 + Math.sin(a) * cp.h * s]); }
    return out;
  };
  return { czAt, radAt, ring, hwAt, crown, prof, fAt, tAt, canopyRing, cp };
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────
export function reaperProfile(row = FW_ROWS.gunship) {
  if (!row || !row.canopy) return null;
  const p = row, H = gunshipHull(p), cp = p.canopy;
  const tailMost = Math.min(p.tailF, p.finF2 ?? p.tailF, p.hTipB ?? p.tailF);
  const M = REAPER_LEN_M / (p.noseF - tailMost);
  const fE = H.fAt(REAPER_EYE_U);
  const hE = H.crown(fE) + EYE_OVER_SILL / M;
  const X = (g) => g * M, Y = (f) => (f - fE) * M, Z = (h) => (h - hE) * M;
  const fOf = (y) => fE + y / M, hOf = (z) => hE + z / M;
  // What a fitting needs to know about the room, in metres.
  const sillZ = (y) => Z(H.crown(fOf(y)));
  const wallX = (y, z) => Math.max(0.12, X(H.hwAt(fOf(y), hOf(z))) - SKIN);
  // The glass's inner half-width at height z over station y (0 where the glass is below z).
  const glassX = (y, z) => {
    const R = H.canopyRing(clamp(H.tAt(fOf(y)), 0, 1)), h = hOf(z);
    let best = 0;
    for (let k = 0; k < R.length - 1; k++) {
      const [g0, h0] = R[k], [g1, h1] = R[k + 1];
      if ((h - h0) * (h - h1) > 0 || h0 === h1) continue;
      best = Math.max(best, g0 + (g1 - g0) * (h - h0) / (h1 - h0));
    }
    return X(best);
  };
  const geo = { M, fE, hE, X, Y, Z, fOf, hOf, H, cp, sillZ, wallX, glassX };
  const room = buildRoom(geo);

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const f of room.faces) for (const q of f.p) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]);
    y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  // The roof is the canopy apex, which is glass: nothing is drawn there, but the room reaches it.
  let apex = -Infinity;
  for (let i = 0; i <= 40; i++) { const t = i / 40; apex = Math.max(apex, Z(H.crown(H.fAt(t)) + cp.h * H.prof(t))); }
  const halfW = Math.max(-x0, x1) + 1e-6;
  const sill0 = sillZ(0), top0 = Z(H.crown(fE) + cp.h * H.prof(REAPER_EYE_U));

  // ── THE GLASS ── one pane per exterior glass facet, off the same rings the rail is cut from: the
  // bubble's 8 × arc quads, the flat front pane and quarter panels (the front cap, fanned from its
  // centre exactly as buildFixedWing fans it) and the rear cap. Each point is pulled 5 mm in toward
  // the canopy's own axis, so the film lies just inside the skin and outboard of every frame. Then
  // the HUD combiner, last, between its two posts — film now, so it blocks no sight line.
  const segs = cp.segs || 5, arc = cp.arc || 3;
  const shellPt = (t, k) => {
    const R = H.canopyRing(t), f = H.fAt(t), zb = H.crown(f), [g, h] = R[k];
    const q = [X(g), Y(f), Z(h)], d = norm([q[0], 0, q[2] - Z(zb)]);
    return [q[0] - d[0] * 0.005, q[1], q[2] - d[2] * 0.005];
  };
  const glass = [];
  for (let i = 0; i < segs; i++) for (let k = 0; k < arc; k++) {
    const a = i / segs, b = (i + 1) / segs;
    glass.push([shellPt(a, k), shellPt(a, k + 1), shellPt(b, k + 1), shellPt(b, k)]);
  }
  for (const [t, dy] of [[0, -0.005], [1, 0.005]]) {
    const ring = Array.from({ length: arc + 1 }, (_, k) => { const q = shellPt(t, k); return [q[0], q[1] + dy, q[2]]; });
    const c = mul(ring.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / ring.length);
    for (let k = 0; k < arc; k++) glass.push([c, ring[k], ring[k + 1]]);
  }
  glass.push([[-0.058, 0.452, -0.03], [0.058, 0.452, -0.03], [0.058, 0.448, 0.045], [-0.058, 0.448, 0.045]]);

  const P = {
    label: 'A-10A cockpit', xCentre: 0, halfW, glass,
    floor: z0 - 1e-6, roof: Math.max(z1, apex) + 1e-6, front: y1 + 1e-6, back: y0 - 1e-6,
    dashY: COAM_Y, dashZ: COAM_Z, headerZ: apex, pillarW: 0.03,
    // The side glass: from the rail at the eye's station to a hand under the canopy's crown there.
    winY: [-0.30, 0.30], winZ: [sill0, top0 - 0.05],
    seatZ: SEAT_Z, seatHalf: 0.21, seatY: SEAT_Y, backZ: BACK_Z,
    seats: 1, centrePost: 0, roofGlass: [y0, y1], craft: 'reaper',
    normalLit: true,
    // Panel floods under the glareshield lip and over each console.
    floods: [{ p: [0, 0.38, -0.13], r: 0.45 }, { p: [-0.40, 0.05, -0.50], r: 0.34 }, { p: [0.40, 0.05, -0.50], r: 0.34 }],
    room: reaperShell,
    reaper: { ...geo, faces: room.faces, bow: room.bow, ringIn: room.ringIn, frameStatic: null },
    hotspots(live) { return reaperHotspots(this, live); },
  };
  return P;
}

// ── THE ROOM ─────────────────────────────────────────────────────────────────
// Built once per profile. Every face `{ p, n, tone, k, rgb }` in metres about the eye.
function buildRoom(G) {
  const { H, Y, Z, X, cp, fOf, hOf, sillZ } = G;
  const faces = [];
  const put = (p, n, tone, k, rgb, emis) => faces.push({ p, n, tone, k, rgb, emis: emis || 0 });
  const newell = (pts) => {
    let n = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
    }
    return norm(n);
  };
  // A polygon whose normal is solved and then turned to face `toward`.
  const polyToward = (pts, toward, tone, k, rgb) => {
    let n = newell(pts);
    const c = mul(pts.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / pts.length);
    if (dot(n, sub(toward, c)) < 0) n = mul(n, -1);
    put(pts, n, tone, k, rgb);
  };

  // Stations: every sixteenth of the canopy (so every exterior ring seam is one), plus the bulkhead.
  const NT = 16, ts = [];
  for (let i = 0; i <= NT; i++) ts.push(i / NT);
  const tB = H.tAt(fOf(BULK_Y));
  if (tB > 0 && tB < 1) ts.push(tB);
  ts.sort((a, b) => a - b);
  const st = ts.map((t) => {
    const f = H.fAt(t), y = Y(f), zs = Z(H.crown(f)), cw = X(cp.w * H.prof(t));
    return { t, f, y, zs, cw };
  });
  const wallAt = (y, z) => Math.max(0.12, X(H.hwAt(fOf(y), hOf(z))) - SKIN);
  const NV = 7;
  // Levels between a floor and the sill, finer near the top where the 12-gon's crown turns in.
  const levels = (z0, z1) => Array.from({ length: NV + 1 }, (_, j) => lerp(z0, z1, 1 - Math.pow(1 - j / NV, 1.5)));

  for (let i = 0; i < st.length - 1; i++) {
    const A = st[i], B = st[i + 1];
    if (B.y - A.y > -1e-9 && A.y - B.y > -1e-9) continue;
    const mid = (A.y + B.y) / 2, fwd = mid > BULK_Y;
    const flA = fwd ? FLOOR_Z : A.zs - DECK_DROP, flB = fwd ? FLOOR_Z : B.zs - DECK_DROP;
    const LA = levels(flA, A.zs), LB = levels(flB, B.zs);
    const WA = LA.map((z) => wallAt(A.y, z)), WB = LB.map((z) => wallAt(B.y, z));
    for (const s of [-1, 1]) {
      // THE TUB WALLS, following the hull ring down from the rail.
      for (let j = 0; j < NV; j++) {
        const pts = [[s * WA[j], A.y, LA[j]], [s * WB[j], B.y, LB[j]], [s * WB[j + 1], B.y, LB[j + 1]], [s * WA[j + 1], A.y, LA[j + 1]]];
        const c = mul(pts.reduce((q, v) => add(q, v), [0, 0, 0]), 0.25);
        polyToward(pts, [0, c[1], c[2]], 'pil', j === NV - 1 ? 0.0 : -0.12, j % 2 ? T.gull : T.gullDk);
        // ⚠ THE SPALL LINER: the tub is titanium plate and the inside of it is a nylon blanket
        // (the Wikipedia source's "multi-layer nylon spall shield"). Each bay carries a pad standing
        // 1.2 cm off the plate, bevelled, so the wall reads as padded plate rather than paint.
        if (fwd && j >= 1 && j <= NV - 2) {
          const inW = [-s, 0, 0], sh = 0.16;
          const top = pts.map((q) => add(add(q, mul(sub(c, q), sh)), mul(inW, 0.012)));
          polyToward(top, [0, c[1], c[2]], 'pil', 0.02, T.liner);
          for (let e = 0; e < 4; e++) {
            const a = pts[e], b = pts[(e + 1) % 4], ta = top[e], tb = top[(e + 1) % 4];
            const m2 = mul(add(add(a, b), add(ta, tb)), 0.25);
            let n = newell([a, b, tb, ta]);
            if (dot(n, sub(m2, c)) < 0 && dot(n, inW) < 0) n = mul(n, -1);
            if (dot(n, inW) < 0) n = mul(n, -1);
            put([a, b, tb, ta], n, 'pil', e === 3 ? 0.1 : -0.2, T.liner);
          }
        }
      }
      // THE SILL SHELF: the canopy rail, from the tub wall out to the exterior glass's own base.
      const aA = Math.min(WA[NV], A.cw), bA = Math.max(WA[NV], A.cw), aB = Math.min(WB[NV], B.cw), bB = Math.max(WB[NV], B.cw);
      polyToward([[s * aA, A.y, A.zs], [s * bA, A.y, A.zs], [s * bB, B.y, B.zs], [s * aB, B.y, B.zs]], [0, mid, 5], 'pil', 0.2, T.frame);
    }
    // THE FLOOR forward of the bulkhead, the AVIONICS DECK aft of it.
    polyToward([[-WA[0], A.y, flA], [WA[0], A.y, flA], [WB[0], B.y, flB], [-WB[0], B.y, flB]], [0, mid, 5], 'floor', -0.2, fwd ? T.floor : T.deck);
  }

  // A cross-section at station y from z0 to z1, as one convex polygon.
  const section = (y, z0, z1) => {
    const L = levels(z0, z1), W = L.map((z) => wallAt(y, z));
    return [...L.map((z, j) => [W[j], y, z]), ...L.slice().reverse().map((z, j) => [-W[L.length - 1 - j], y, z])];
  };
  const S0 = st[0], SN = st[st.length - 1];
  // THE FORWARD BULKHEAD, under the windscreen: behind the panel, seen only past its ends.
  polyToward(section(S0.y, FLOOR_Z, S0.zs), [0, 0, 0], 'post', -0.25, T.gullDk);
  // THE ARMOUR BULKHEAD behind the seat, from the floor to the deck.
  const zsB = sillZ(BULK_Y);
  polyToward(section(BULK_Y, FLOOR_Z, zsB - DECK_DROP), [0, 0, 0], 'post', -0.15, T.gullDk);
  // THE AFT END of the deck, under the rear of the glass.
  polyToward(section(SN.y, SN.zs - DECK_DROP, SN.zs), [0, 0, 0], 'post', -0.2, T.deck);

  // THE NOSE DECK: the anti-glare top ahead of the glareshield, at the rail, out to the windscreen.
  const yND = 0.66;
  const nd = st.filter((s) => s.y >= yND - 1e-9);
  for (let i = 0; i < nd.length - 1; i++) {
    const A = nd[i], B = nd[i + 1], zA = A.zs + 0.02, zB = B.zs + 0.02;
    const wa = Math.min(A.cw, wallAt(A.y, A.zs - 0.01) + 0.2) - 0.01, wb = Math.min(B.cw, wallAt(B.y, B.zs - 0.01) + 0.2) - 0.01;
    polyToward([[-wa, A.y, zA], [wa, A.y, zA], [wb, B.y, zB], [-wb, B.y, zB]], [0, 0, 5], 'dash', -0.1, T.plate);
  }

  // ── THE CANOPY FRAME, off the exterior's glass ──
  // The bow: the canopy ring at REAPER_BOW_T, pulled in by the frame's own depth so it stays inside.
  const ringIn = (t, inset, dy = 0) => {
    const f = H.fAt(t), y = Y(f), R = H.canopyRing(t), zb = Z(H.crown(f));
    return R.map(([g, h]) => {
      const x = X(g), z = Z(h), d = norm([x, 0, z - zb]);
      return [x - d[0] * inset, y + dy, z - d[2] * inset];
    });
  };
  const bow = ringIn(REAPER_BOW_T, 0.045);
  const front = ringIn(0, 0.03);
  return { faces, bow, front, ringIn };
}

// ── THE SHELL, AS interior-shell.js CALLS IT ─────────────────────────────────
function reaperShell(P, live, push, rich) {
  const D = P.reaper;
  for (const f of D.faces) push([{ p: f.p, n: f.n }], f.tone, f.k, false, f.rgb, f.emis || 0);
  // The frame and the things bolted to the room that nothing moves: built once, kept.
  if (!D.frameStatic) {
    const acc = [];
    const rec = (fs, tone, k, fwd, rgb, emis, mat) => acc.push([fs, tone, k, fwd, rgb, emis, mat]);
    staticFit(P, rec);
    D.frameStatic = acc;
  }
  for (const a of D.frameStatic) push(...a);
  if (rich) reaperFit(P, live, push);
}

// ── THE STATIC FITTINGS ──────────────────────────────────────────────────────
function staticFit(P, push) {
  const K = makeKit(push);
  const D = P.reaper, { H, Y, Z, X, sillZ, wallX, glassX } = D;
  // The canopy rails along the glass base, and the bow frame across it.
  const NR = 16;
  for (const s of [-1, 1]) {
    let prev = null;
    for (let i = 0; i <= NR; i++) {
      const t = i / NR, f = H.fAt(t), y = Y(f), cw = X(D.cp.w * H.prof(t));
      const q = [s * (cw - 0.02), clamp(y, P.back + 0.02, P.front - 0.02), Z(H.crown(f)) + 0.018];
      if (prev) K.rod(prev, q, 0.016, 'pil', 0.1, T.frame, 0, 5, false);
      prev = q;
    }
  }
  // ⚠ THE BOW IS HEAVY AND IT IS THE ONLY HEAVY THING IN THE GLASS: the Warthog's canopy is
  // frameless over the crown, and the bow carries the HUD's view forward. A box section, not a wire.
  const bow = D.bow;
  for (let k = 0; k < bow.length - 1; k++) K.rod(bow[k], bow[k + 1], 0.032, 'pil', 0.12, T.frame, 0, 6);
  // The windscreen's front frame and the two posts between the flat front pane and the quarters.
  const fr = D.ringIn(0, 0.025, -0.03);
  for (let k = 0; k < fr.length - 1; k++) K.rod(fr[k], fr[k + 1], 0.02, 'pil', 0.1, T.frame, 0, 5);
  const arc = bow.length - 1;
  for (const k of [1, arc - 1]) K.rod(bow[k], fr[k], 0.018, 'pil', 0.1, T.frame, 0, 5);
  // The rear arch where the canopy closes onto the spine.
  const ra = D.ringIn(1, 0.02, 0.03);
  for (let k = 0; k < ra.length - 1; k++) K.rod(ra[k], ra[k + 1], 0.02, 'pil', 0.05, T.frame, 0, 5);
  // Three rear-view mirrors on the bow: two quarters and a centre, the centre high on the arch.
  for (const k of [1, 2, 3, 4].filter((k2) => k2 !== Math.round(arc / 2))) {
    const b = bow[Math.min(arc, k)];
    if (!b) continue;
    const c = add(b, [-Math.sign(b[0] || 1) * 0.04, -0.05, -0.05]);
    if (c[2] < 0.06) continue;                       // never down into the forward sight line
    const n = norm([-c[0] * 0.3, -1, -0.2]);
    const r = norm(cross([0, 0, 1], n)), u = cross(n, r);
    K.obox(c, r, u, n, 0.055, 0.03, 0.006, 'dash', 0.1, T.frame);
    K.obox(add(c, mul(n, 0.007)), r, u, n, 0.05, 0.025, 0.001, 'dash', 0.3, T.mirror);
  }
  // The standby compass, hung under the bow's crown.
  const top = bow[Math.floor(arc / 2)], top2 = bow[Math.ceil(arc / 2)];
  const bc = [(top[0] + top2[0]) / 2, top[1] - 0.04, (top[2] + top2[2]) / 2 - 0.07];
  if (bc[2] > 0.06) {
    K.rod(add(bc, [0, 0.02, 0.05]), add(bc, [0, 0.01, 0.02]), 0.006, 'dash', 0, T.frame, 0, 4);
    K.box(bc[0] - 0.03, bc[1] - 0.02, bc[2] - 0.025, bc[0] + 0.03, bc[1] + 0.02, bc[2] + 0.02, 'dash', 0.05, C.black);
  }

  // ── THE GLARESHIELD ── a trapezoid, narrowing forward with the glass.
  const yR = COAM_Y, yF = 0.66, zT = COAM_Z;
  const hwR = Math.min(0.40, glassX(yR, zT) - 0.03), hwF = Math.min(0.34, glassX(yF, zT) - 0.03);
  const q = (pts, n, tone, k, rgb, emis) => push([{ p: pts, n }], tone, k, true, rgb, emis);
  q([[-hwR, yR, zT], [hwR, yR, zT], [hwF, yF, zT], [-hwF, yF, zT]], [0, 0, 1], 'dash', 0.3, T.plate);
  q([[-hwR, yR, zT - 0.04], [hwR, yR, zT - 0.04], [hwR, yR, zT], [-hwR, yR, zT]], [0, -1, 0], 'dash', -0.1, T.plate);
  for (const s of [-1, 1]) {
    q([[s * hwR, yR, zT - 0.04], [s * hwF, yF, zT - 0.04], [s * hwF, yF, zT], [s * hwR, yR, zT]], norm([s * (yF - yR), -(hwF - hwR), 0]), 'dash', 0, T.plate);
  }
  // The underside of the lip, and a skirt from it down to the panel so no gap shows over the dials.
  q([[-hwR, yR, zT - 0.04], [-hwR, PANEL_Y, zT - 0.04], [hwR, PANEL_Y, zT - 0.04], [hwR, yR, zT - 0.04]], [0, 0, -1], 'dash', -0.3, T.plate);

  // ── THE MAIN PANEL ── the plate itself. Its instruments are live and drawn every frame.
  const pw = Math.min(0.39, wallX(PANEL_Y, PZ - PHH) - 0.02, glassX(PANEL_Y, PZ + PHH) - 0.02);
  const Pn = K.panel([0, PANEL_Y, PZ], [1, 0, 0], [0, 0, 1]);
  Pn.rect(-pw, -PHH, pw, PHH, T.panel, 0, 0);
  // The sub-panels as raised plates: armament, gear, flight, engines, fuel.
  Pn.rect(-0.375, 0.035, -0.165, 0.215, T.plateLt, 0, 0.002);
  Pn.rect(-0.375, -0.215, -0.165, 0.025, T.plateLt, 0, 0.002);
  Pn.rect(0.185, -0.03, 0.375, 0.215, T.plateLt, 0, 0.002);
  Pn.rect(0.185, -0.215, 0.375, -0.04, T.plateLt, 0, 0.002);
  // The housing behind it, down to the tub floor's knee space.
  K.box(-pw, PANEL_Y, PZ - PHH - 0.04, pw, PANEL_Y + 0.08, PZ - PHH, 'dash', -0.2, T.plate);

  // ── THE HUD ── its body on the glareshield and its FRAME. ⚠ FRAME ONLY: the combiner would be
  // a sheet across the one sight line the gate guarantees, and a pane in a depth buffer is a depth
  // value in front of the entire world. The symbology is drawn as the HUD's own lit aperture.
  K.box(-0.075, 0.43, zT, 0.075, 0.59, zT + 0.055, 'dash', 0.05, C.black);
  K.box(-0.09, 0.40, zT, 0.09, 0.43, zT + 0.03, 'dash', 0.1, T.plate);           // its control panel
  for (const s of [-1, 1]) K.rod([s * 0.068, 0.47, zT + 0.055], [s * 0.068, 0.45, 0.05], 0.007, 'dash', 0.1, C.black, 0, 5);
  K.rod([-0.068, 0.45, 0.05], [0.068, 0.45, 0.05], 0.006, 'dash', 0.1, C.black, 0, 5);

  // ── THE CONSOLES ── black boxes either side of your knees, from the tub floor.
  const CY = [-0.44, 0.60];
  const outX = Math.min(wallX(CY[0], CONS_Z), wallX(0, CONS_Z), wallX(CY[1], CONS_Z)) - 0.01;
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -outX : CONS_IN, x1 = s < 0 ? -CONS_IN : outX;
    K.box(x0, CY[0], FLOOR_Z, x1, CY[1], CONS_Z, 'dash', -0.1, T.plate);
    const Cp = K.panel([(x0 + x1) / 2, (CY[0] + CY[1]) / 2, CONS_Z + 0.0005], [1, 0, 0], [0, 1, 0]);
    // The Dzus-fastened panel seams across the console.
    for (const yy of [-0.26, -0.08, 0.12, 0.34]) Cp.rect(-(x1 - x0) / 2, yy - 0.003, (x1 - x0) / 2, yy + 0.003, T.frame, 0, 0.001);
  }
  D.consX = outX;
  // The throttle quadrant: a raised slotted block on the left console.
  K.box(-0.45, -0.12, CONS_Z, -0.30, 0.30, CONS_Z + 0.025, 'dash', 0.05, T.plateLt);
  for (const x of [-0.405, -0.345]) K.box(x - 0.005, -0.10, CONS_Z + 0.025, x + 0.005, 0.28, CONS_Z + 0.026, 'dash', 0, C.black);
  // The flap lever's gate, outboard.
  K.box(-outX + 0.005, -0.06, CONS_Z, -0.455, 0.16, CONS_Z + 0.02, 'dash', 0.05, T.plateLt);

  // ── THE ACES II ── the bucket, the cushions, the headrest, the rails, and the pull handles.
  const sz = SEAT_Z, [sy0, sy1] = SEAT_Y;
  for (const s of [-1, 1]) {
    K.box(s * 0.215, sy0 - 0.08, sz - 0.30, s * 0.245, sy1, sz + 0.09, 'seat', 0.0, T.seat);          // bucket sides
    K.box(s * 0.19, sy0 - 0.16, sz, s * 0.235, sy0 - 0.04, BACK_Z - 0.04, 'seat', -0.05, T.seat);     // back frame
    K.rod([s * 0.10, -0.60, sz - 0.30], [s * 0.10, -0.60, 0.22], 0.012, 'seat', 0.2, T.metal, 0, 5);  // catapult rails
  }
  K.box(-0.215, sy0 - 0.02, sz - 0.30, 0.215, sy1, sz - 0.06, 'seat', -0.1, T.seat);                   // the pan
  K.box(-0.20, sy0, sz - 0.06, 0.20, sy1 - 0.01, sz, 'seat', 0.1, T.od);                              // survival kit
  K.box(-0.19, sy0 - 0.08, sz, 0.19, sy0 - 0.02, BACK_Z, 'seat', -0.05, T.od);                        // back cushion
  K.box(-0.22, sy0 - 0.16, sz - 0.30, 0.22, sy0 - 0.08, BACK_Z, 'seat', -0.15, T.seat);               // seat back shell
  // The headrest, with the parachute container behind it: behind the eye, never at it.
  K.box(-0.13, -0.53, BACK_Z, 0.13, -0.41, 0.15, 'seat', -0.05, T.odDk);
  K.box(-0.16, -0.60, BACK_Z - 0.05, 0.16, -0.53, 0.20, 'seat', -0.2, T.seat);
  K.box(-0.12, -0.411, 0.02, 0.12, -0.405, 0.09, 'seat', 0, T.harness);                               // the pad
  // The two ejection handles either side of the pan, yellow and black.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y0 = -0.10 + i * 0.035;
      K.rod([s * 0.23, y0, sz + 0.02], [s * 0.23, y0 + 0.035, sz + 0.02], 0.011, 'seat', 0.25, i % 2 ? C.black : C.yellow, 0.05, 6);
    }
  }
  // The harness, laid out on the empty seat: two shoulder straps down the back cushion, the lap belt
  // halves on the kit, the negative-g strap between, and the koch fittings.
  for (const s of [-1, 1]) {
    K.box(s * 0.10 - 0.022, sy0 - 0.021, -0.40, s * 0.10 + 0.022, sy0 - 0.015, BACK_Z + 0.01, 'seat', 0.1, T.harness);
    K.box(s * 0.08 - 0.022, sy0 - 0.02, sz + 0.001, s * 0.08 + 0.022, sy0 + 0.20, sz + 0.006, 'seat', 0.1, T.harness);
    K.box(s * 0.19 - 0.025, sy0 + 0.02, sz + 0.001, s * 0.19 + 0.02, sy0 + 0.25, sz + 0.006, 'seat', 0.1, T.harness);
    K.box(s * 0.08 - 0.02, sy0 + 0.20, sz + 0.001, s * 0.08 + 0.02, sy0 + 0.24, sz + 0.012, 'seat', 0.3, T.metal);
  }
  K.box(-0.02, sy1 - 0.12, sz + 0.001, 0.02, sy1 - 0.01, sz + 0.006, 'seat', 0.1, T.harness);
  // Contact shadows under the seat pan and round the stick's boot.
  const shadowQ = (x0, y0, x1, y1, z, rgb) => q([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], 'floor', 0, rgb, 0);
  shadowQ(-0.30, -0.66, 0.30, 0.10, FLOOR_Z + 0.002, SHADE_SOFT);
  shadowQ(-0.23, -0.60, 0.23, 0.05, FLOOR_Z + 0.003, SHADE_CORE);
  shadowQ(-0.09, 0.22, 0.09, 0.40, FLOOR_Z + 0.002, SHADE_SOFT);
  // The rudder pedal rails.
  for (const s of [-1, 1]) K.box(s * 0.13 - 0.02, 0.62, FLOOR_Z, s * 0.13 + 0.02, 0.95, FLOOR_Z + 0.03, 'dash', -0.1, T.frame);
  // ── THE TUB'S OWN STRUCTURE ── a frame at every station down the wall, the spall-liner blankets
  // between them held on with a row of snap fasteners, and the canopy rail's lock hooks.
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, f = H.fAt(t), y = Y(f);
    if (y < BULK_Y + 0.05 || y > PANEL_Y + 0.25) continue;
    const zs = sillZ(y);
    for (const s of [-1, 1]) {
      let prev = null;
      for (let j = 0; j <= 5; j++) {
        const z = lerp(FLOOR_Z + 0.02, zs - 0.03, j / 5), x = s * (wallX(y, z) - 0.012);
        const pnt = [x, y, z];
        if (prev) K.rod(prev, pnt, 0.012, 'pil', 0.05, T.gullDk, 0, 4, false);
        prev = pnt;
      }
      for (let j = 1; j < 5; j++) {
        const z = lerp(FLOOR_Z + 0.1, zs - 0.08, j / 5), yy = y + 0.10;
        const pnt = [s * (wallX(yy, z) - 0.004), yy, z], nn = norm([-s, 0, 0]);
        const r = [0, 1, 0], u = cross(nn, r);
        K.obox(pnt, r, u, nn, 0.006, 0.006, 0.003, 'pil', 0.2, T.metal);
      }
      if (i % 2 === 0) K.obox([s * (wallX(y, zs - 0.02) - 0.01), y, zs - 0.02], [0, 1, 0], [0, 0, 1], [-s, 0, 0], 0.02, 0.012, 0.008, 'pil', 0.2, T.metal);
    }
  }
  // Circuit breakers: a field of them on the aft right console, and more on the left wall aft.
  for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
    const x = CONS_IN + 0.03 + c * 0.028, y = -0.42 + r * 0.03;
    K.rod([x, y, CONS_Z], [x, y, CONS_Z + 0.012], 0.006, 'dash', 0.1, C.black, 0, 6);
    K.rod([x, y, CONS_Z + 0.012], [x, y, CONS_Z + 0.016], 0.0035, 'dash', 0.3, T.letter, 0, 6);
  }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
    const y = -0.40 + c * 0.03, z = CONS_Z + 0.05 + r * 0.03, x = -wallX(y, z);
    K.rod([x, y, z], [x + 0.014, y, z], 0.006, 'dash', 0.1, C.black, 0, 6);
  }
  // Knobs on the consoles that nothing in the sim drives: the lighting rheostats, the IFF modes.
  for (const [x, y] of [[-0.34, -0.20], [-0.30, -0.20], [-0.42, -0.20], [0.30, 0.44], [0.36, 0.44], [0.42, 0.44], [0.30, 0.52], [0.36, 0.52]]) {
    K.rod([x, y, CONS_Z], [x, y, CONS_Z + 0.014], 0.011, 'dash', 0.1, C.black, 0, 10);
    K.rod([x, y, CONS_Z + 0.014], [x, y, CONS_Z + 0.018], 0.004, 'dash', 0.3, T.letter, 0, 6);
  }
  // ── THE CONSOLES, FILLED IN ── the first cut left them black slabs, which is what they read as
  // from a turned head. An A-10's consoles are wall-to-wall Dzus panels: each a raised plate with a
  // screw at every corner, a column of toggles or knobs, and white lettering under every one.
  const plate = (cx, cy, hw, hh, cols, rows, kind) => {
    const Pp = K.panel([cx, cy, CONS_Z + 0.004], [1, 0, 0], [0, 1, 0]);
    K.box(cx - hw, cy - hh, CONS_Z, cx + hw, cy + hh, CONS_Z + 0.004, 'dash', 0.05, T.plateLt);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) Pp.disc(a * (hw - 0.007), b * (hh - 0.007), 0.0035, T.metal, 0, 0.001, 6);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = -hw + (c + 0.5) * (2 * hw / cols), b = hh - (r + 0.5) * (2 * hh / rows);
      if (kind === 'knob') { Pp.knob(a, b, 0.010, 0.012, C.black, 0); Pp.spoke(a, b, Math.PI / 2 + (r * 7 + c * 3) % 5 * 0.4, 0, 0.009, 0.0015, T.letter, 0, 0.0125); }
      else if (kind === 'lamp') Pp.lamp(a, b, 0.008, 0.005, false, C.amber);
      else Pp.toggle(a, b, (r + c) % 3 !== 0);
      Pp.rect(a - 0.010, b - 0.018, a + 0.010, b - 0.0155, T.letter, 0, 0.001);
    }
  };
  // Left: the LASTE and antenna panels inboard of the throttles, the SAS and intercom panels aft.
  plate(-0.275, 0.10, 0.022, 0.19, 1, 6, 'toggle');
  plate(-0.33, -0.43 + 0.04, 0.07, 0.035, 4, 1, 'knob');
  plate(-0.475, 0.28, 0.035, 0.07, 1, 3, 'toggle');
  // Right: the environment panel under the rheostats, a caution-lamp strip, the lighting panel.
  plate(0.37, 0.48, 0.10, 0.08, 3, 2, 'knob');
  plate(0.37, 0.33 + 0.0, 0.10, 0.012, 5, 1, 'lamp');
  plate(0.37, -0.215, 0.10, 0.035, 5, 1, 'toggle');

  // ── THE CANOPY RAIL ── the elbow pad by your arm, the defog duct inboard of the rail, and the
  // canopy's lock hooks: what fills the edge of the frame when you turn your head.
  for (const s of [-1, 1]) {
    let prev = null;
    for (let i = 0; i <= 12; i++) {
      const y = lerp(-0.55, PANEL_Y - 0.06, i / 12), zs = sillZ(y), x = s * (wallX(y, zs - 0.06) - 0.03);
      const pnt = [x, y, zs - 0.05];
      if (prev) K.rod(prev, pnt, 0.018, 'pil', 0.1, T.frame, 0, 6, false);
      if (i % 3 === 1) K.obox(pnt, [0, 1, 0], [0, 0, 1], [-s, 0, 0], 0.012, 0.02, 0.022, 'pil', 0.2, T.metal);
      prev = pnt;
    }
    const zs = sillZ(-0.10);
    K.box(s > 0 ? wallX(-0.1, zs) - 0.09 : -wallX(-0.1, zs) + 0.01, -0.30, zs - 0.03, s > 0 ? wallX(-0.1, zs) - 0.01 : -wallX(-0.1, zs) + 0.09, 0.10, zs + 0.012, 'pil', 0.1, T.od);
  }

  // Aft of the bulkhead, on the avionics deck: the canopy actuator and two equipment boxes.
  const zd = sillZ(BULK_Y) - DECK_DROP;
  K.box(-0.12, -1.20, zd, 0.12, -0.80, zd + 0.10, 'post', -0.1, T.gullDk);
  K.rod([0, -0.82, zd + 0.10], [0, -1.35, zd + 0.02], 0.02, 'post', 0.2, T.metal, 0, 6);
  void wallX; void Z;
}

// ── THE LIVE FIT ─────────────────────────────────────────────────────────────
export function readReaper(live) {
  const L = live || {};
  const ias = Math.max(0, num(L.ias)), vsi = num(L.vsi), pitch = num(L.pitch);
  // Angle of attack, derived: pitch less the flight path angle (vsi in ft/min, ias in knots).
  const gamma = ias > 5 ? Math.atan2(vsi, ias * 101.27) * 180 / Math.PI : pitch;
  return {
    L, pitch, bank: num(L.bank), hdg: num(L.hdg), ias, vne: Math.max(40, num(L.vne, 450)),
    alt: Math.max(0, num(L.alt)), vsi, aoa: clamp(pitch - gamma, -5, 30),
    rpm: clamp(num(L.rpm), 0, 1.05), thr: clamp(num(L.throttle), 0, 1),
    fuel: clamp(num(L.fuel, 1), 0, 1), hull: clamp(num(L.hull, 1), 0, 1),
    powered: L.powered !== false,
    ail: clamp(num(L.stickX), -1, 1), elev: clamp(num(L.stickY), -1, 1), rud: clamp(num(L.rudder), -1, 1),
    flap: clamp(num(L.flapNotch) / 3, 0, 1), gear: L.gearDown !== false, trim: clamp(num(L.trim), -1, 1),
    // ⚠ NOT YET PASSED BY windshield.js's liveInstruments: the sim's `armed` and `weapon` (cockpit.js
    // puts both on the view). Read here so the armament panel lights the moment they arrive.
    armed: !!(L.weaponsArmed ?? L.armed), weapon: L.weapon === 'guns' ? 'gun' : (L.weapon || 'gun'), ammo: L.ammo,
    missiles: num(L.missiles), bombs: num(L.bombs),
    hour: num(L.hour, 12), stall: !!L.stall, bingo: !!L.bingo,
  };
}

// Where the moving things are, stated once: the drawing and the hotspots both read these.
const THR_PIVOT = (i) => [-0.405 + i * 0.06, 0.09, CONS_Z - 0.12];
const THR_LEN = 0.21;
function throttleTip(i, thr) {
  const a = lerp(-0.62, 0.62, thr), p = THR_PIVOT(i);
  return [p[0], p[1] + Math.sin(a) * THR_LEN, p[2] + Math.cos(a) * THR_LEN];
}
const STICK_BASE = [0, 0.30, FLOOR_Z];
function stickTip(R) { return [R.ail * 0.07, 0.34 + R.elev * 0.08, -0.52]; }
const FLAP_PIVOT = [-0.49, 0.05, CONS_Z - 0.06];
function flapTip(R) { const a = lerp(-0.55, 0.55, R.flap); return [FLAP_PIVOT[0], FLAP_PIVOT[1] + Math.sin(a) * 0.11, FLAP_PIVOT[2] + Math.cos(a) * 0.11]; }
// The lighting panel's switch row on the right console, in that console's panel coords.
const SW_ROW = { o: [0.40, -0.18, CONS_Z + 0.0015], ids: ['master', 'beacon', 'nav', 'strobe', 'dome'], pitch: 0.028 };
const swPos = (i) => [SW_ROW.o[0] - 0.056 + i * SW_ROW.pitch, SW_ROW.o[1], SW_ROW.o[2]];
const GEAR = { u: -0.33, v: -0.07 };

export function reaperHotspots(P, live) {
  const R = readReaper(live), out = [];
  SW_ROW.ids.forEach((id, i) => out.push({ id: 'ck:' + id, p: add(swPos(i), [0, 0, 0.012]), r: 0.013, kind: 'click' }));
  out.push({ id: 'ck:land', p: [-0.27, PANEL_Y - 0.012, PZ - 0.175], r: 0.014, kind: 'click' });
  out.push({ id: 'gear', p: [GEAR.u, PANEL_Y - 0.07, PZ + (R.gear ? -0.13 : -0.02)], r: 0.022, kind: 'click' });
  out.push({ id: 'guns', p: [-0.33, PANEL_Y - 0.012, PZ + 0.10], r: 0.016, kind: 'click' });
  out.push({ id: 'ck:flaps', p: flapTip(R), r: 0.02, kind: 'click' });
  out.push({ id: 'yoke', p: add(stickTip(R), [0, 0.01, 0.07]), r: 0.07, kind: 'yoke' });
  out.push({ id: 'throttle', p: throttleTip(0, R.thr), r: 0.04, kind: 'throttle' });
  return out;
}

export function reaperFit(P, live, push) {
  const K = makeKit(push);
  const R = readReaper(live), on = R.powered;
  const night = on && (R.hour < 6.5 || R.hour > 19.5);
  const Pn = K.panel([0, PANEL_Y, PZ], [1, 0, 0], [0, 0, 1]);
  // A placard is its lettering now: the old stripe's box is the room the words get, shrunk to fit.
  const placard = (pn, a0, b0, a1, b1, str) => pn.fitText(str, (a0 + a1) / 2, (b0 + b1) / 2, a1 - a0 + 0.006, 0.007, night ? T.night : T.letter, night ? 0.9 : 0.35, 0.003);

  // ── ARMAMENT CONTROL PANEL (upper left) ──
  // Eleven station-select buttons with their READY lamps, master arm, gun arm, the delivery-mode
  // rotary, and the rounds counter.
  for (let i = 0; i < 11; i++) {
    const u = -0.36 + i * 0.0182;
    Pn.rect(u - 0.007, 0.175, u + 0.007, 0.200, C.black, 0, 0.003);
    // Stations 1-5 and 7-11 carry the bombs and missiles the sim counts; 6 is the centreline.
    const st = i < 5 ? i : i > 5 ? i - 1 : -1, stores = st < 0 ? 0 : st % 2 ? R.missiles > (st >> 1) : R.bombs > (st >> 1);
    Pn.stud(u, 0.1875, 0.0065, 0.0105, 0.004, T.plate, 0, 0.002);
    Pn.lamp(u, 0.19, 0.0045, 0.0035, on && R.armed && !!stores, C.green);
    Pn.lamp(u, 0.1805, 0.0045, 0.002, on && !!stores, C.amber);
    placard(Pn, u - 0.004, 0.2045, u + 0.004, 0.207, String(i + 1));
  }
  Pn.rect(-0.345, 0.07, -0.315, 0.14, C.black, 0, 0.003);
  Pn.toggle(-0.33, 0.10, R.armed, 'ARM');                                  // MASTER ARM
  Pn.stud(-0.33, 0.13, 0.012, 0.005, 0.004, R.armed && on ? C.red : [70, 20, 18], R.armed && on ? 0.9 : 0, 0.003);
  Pn.toggle(-0.28, 0.10, R.armed && R.weapon !== 'msl', 'GUN');            // GUN ARM
  Pn.knob(-0.215, 0.10, 0.017, 0.012, C.black, 0);                         // delivery mode
  const dm = R.weapon === 'msl' ? 0.8 : R.weapon === 'bomb' ? 0.3 : -0.3;
  Pn.spoke(-0.215, 0.10, Math.PI / 2 + dm, 0, 0.016, 0.002, C.white, 0.4, 0.013);
  const rounds = Number.isFinite(+R.ammo) ? String(Math.max(0, Math.round(+R.ammo)) % 10000).padStart(4, '0') : '1150';
  Pn.digits(-0.37, 0.048, 0.013, on ? rounds : '    ', C.amber);
  placard(Pn, -0.30, 0.055, -0.20, 0.058, 'DLVY MODE');

  // ── LANDING GEAR AND FLAPS (lower left) ──
  const gear = eased('reaper:gear', R.gear ? 1 : 0, 10);
  const piv = Pn.pt(GEAR.u, GEAR.v, 0.006), knob = Pn.pt(GEAR.u, GEAR.v + lerp(0.05, -0.06, gear), 0.07);
  K.rod(piv, knob, 0.006, 'dash', 0.1, T.metal, 0, 6);
  K.rod(add(knob, [0, 0.008, 0]), add(knob, [0, -0.008, 0]), 0.019, 'dash', 0.1, [226, 226, 222], on && gear > 0.05 && gear < 0.95 ? 0.6 : 0.05, 10);
  for (let i = 0; i < 3; i++) Pn.lamp(-0.26, -0.03 - i * 0.03, 0.009, 0.009, on && R.gear, C.green);
  Pn.text('GEAR', -0.26, -0.008, 0.0075);   // one name over the three, which are too close to letter each
  Pn.dial(-0.205, -0.11, 0.028, R.flap, { a0: Math.PI * 0.75, sweep: Math.PI * 0.5, ticks: 3, major: 1, name: 'FLAP' });
  Pn.toggle(-0.27, -0.175, !!R.L.landingLight, 'LAND');                  // LAND / TAXI lights
  placard(Pn, -0.36, -0.20, -0.30, -0.197, 'GEAR');

  // ── THE FLIGHT GROUP ──
  const vmax = Math.max(R.vne * 1.1, 500);
  Pn.dial(-0.125, 0.10, 0.042, clamp(R.ias / vmax, 0, 1), { a0: Math.PI / 2, sweep: Math.PI * 1.9, ticks: 20, major: 4, red: R.vne / vmax, name: 'KTS' });
  Pn.attitude(0, 0.085, 0.058, R.pitch, R.bank);
  Pn.dial(0.125, 0.10, 0.042, (R.alt % 1000) / 1000, { a0: Math.PI / 2, sweep: TAU, ticks: 10, major: 1, frac2: (R.alt % 10000) / 10000, name: 'ALT' });
  Pn.digits(0.098, 0.075, 0.008, on ? String(Math.round(R.alt / 10) * 10 % 100000).padStart(5, ' ') : '     ', C.white);
  Pn.compass(0, -0.105, 0.055, R.hdg);
  Pn.dial(-0.125, -0.02, 0.03, clamp(R.aoa / 30, 0, 1), { a0: Math.PI * 1.25, sweep: Math.PI * 1.5, ticks: 6, major: 2, arcs: [[0.55, 0.7, C.green]], red: 0.8, name: 'AOA' });
  Pn.dial(0.125, -0.02, 0.03, clamp(0.5 + R.vsi / 12000, 0, 1), { a0: Math.PI, sweep: Math.PI * 1.8, ticks: 12, major: 3, name: 'VSI' });
  Pn.dial(-0.125, -0.14, 0.028, (R.hour % 12) / 12, { a0: Math.PI / 2, sweep: TAU, ticks: 12, major: 3, frac2: R.hour % 1, name: 'CLOCK' });
  Pn.dial(0.125, -0.14, 0.028, clamp(0.5 + R.trim * 0.5, 0, 1), { a0: Math.PI * 1.25, sweep: Math.PI * 1.5, ticks: 4, major: 2, needle: C.white, name: 'TRIM' });

  // ── THE ENGINES (upper right): fan speed, ITT, core speed and fuel flow, left and right ──
  for (let e = 0; e < 2; e++) {
    const u = 0.235 + e * 0.09, rr = R.rpm * (e ? 0.992 : 1);
    Pn.dial(u, 0.182, 0.021, rr, { ticks: 10, major: 5, red: 0.98, name: 'FAN' });
    Pn.dial(u, 0.128, 0.021, clamp(0.25 + rr * 0.6, 0, 1), { ticks: 8, major: 4, arcs: [[0.3, 0.8, C.green]], red: 0.9, name: 'ITT' });
    Pn.dial(u, 0.074, 0.021, clamp(0.55 + rr * 0.4, 0, 1), { ticks: 10, major: 5, red: 0.99, name: 'CORE' });
    Pn.dial(u, 0.020, 0.021, clamp(R.thr * rr, 0, 1), { ticks: 6, major: 3, name: 'FF' });
  }
  Pn.lamp(0.28, -0.015, 0.012, 0.005, on && R.fuel < 0.15, C.amber, 'LO FUEL');
  // ── FUEL QUANTITY (lower right): the two tank needles and the total counter ──
  Pn.dial(0.28, -0.125, 0.045, R.fuel, { a0: Math.PI * 1.25, sweep: Math.PI * 1.5, ticks: 10, major: 5, red: 0.0001, frac2: clamp(R.fuel * 1.02, 0, 1), arcs: [[0, 0.12, C.red]], name: 'FUEL' });
  Pn.digits(0.258, -0.16, 0.009, on ? String(Math.round(R.fuel * 10700)).padStart(5, ' ') : '     ', C.white);

  // ── ALONG THE TOP EDGE: the three fire T-handles, master caution, the AOA indexer ──
  const fire = on && R.hull < 0.2;
  for (const u of [-0.07, 0, 0.07]) {
    const b = Pn.pt(u, PHH - 0.012, 0.004), t = Pn.pt(u, PHH - 0.012, 0.035);
    K.rod(b, t, 0.004, 'dash', 0, T.metal, 0, 5);
    K.obox(t, [1, 0, 0], [0, 0, 1], [0, -1, 0], 0.026, 0.009, 0.008, 'dash', 0.2, fire ? C.red : [150, 36, 30], fire ? 1 : 0.1);
  }
  const lip = K.panel([0, COAM_Y - 0.0005, COAM_Z - 0.02], [1, 0, 0], [0, 0, 1]);
  lip.lamp(-0.30, 0, 0.022, 0.011, on && R.hull < 0.35, C.amber, 'CAUTION'); // MASTER CAUTION
  lip.lamp(-0.16, 0.007, 0.008, 0.003, on && R.aoa > 14, C.red);           // AOA indexer: slow
  lip.lamp(-0.16, 0.0, 0.004, 0.003, on && R.aoa > 9 && R.aoa <= 14, C.green);
  lip.lamp(-0.16, -0.007, 0.008, 0.003, on && R.aoa <= 9, C.amber);        //   fast
  lip.lamp(0.30, 0, 0.022, 0.011, on && (R.stall || R.bingo), C.red, 'WARN');
  // The HUD's own aperture, lit: the symbology glows up out of the body, under the sight line.
  if (on) {
    const hp = K.panel([0, 0.51, COAM_Z + 0.0555], [1, 0, 0], [0, 1, 0]);
    hp.rect(-0.06, -0.06, 0.06, 0.06, T.hudGlass, 0.5, 0);
    hp.rect(-0.03, -0.001, 0.03, 0.001 + 0.0, C.lcd, 0.9, 0.001);
    hp.rect(-0.001, -0.03, 0.001, 0.03, C.lcd, 0.9, 0.001);
  }

  // ── THE LEFT CONSOLE: two throttles, the flap lever, the fuel panel, the trim panel ──
  for (let i = 0; i < 2; i++) {
    const p = THR_PIVOT(i), tip = throttleTip(i, R.thr);
    K.rod([p[0], p[1], CONS_Z + 0.02], tip, 0.009, 'dash', 0.1, T.metal, 0, 6);
    const a = lerp(-0.62, 0.62, R.thr), up = [0, Math.sin(a), Math.cos(a)], fw = [0, Math.cos(a), -Math.sin(a)];
    K.obox(add(tip, mul(up, 0.03)), [1, 0, 0], up, fw, 0.024, 0.035, 0.028, 'dash', 0.1, T.grip);
    if (i === 0) {   // the left grip carries the speedbrake and the mic switches, thumb side
      K.obox(add(add(tip, mul(up, 0.045)), [0.026, 0, 0]), [1, 0, 0], up, fw, 0.004, 0.008, 0.008, 'dash', 0.2, T.metal);
      K.obox(add(add(tip, mul(up, 0.02)), [0.026, 0, 0]), [1, 0, 0], up, fw, 0.004, 0.006, 0.006, 'dash', 0.2, C.red, 0.1);
    }
  }
  const ft = flapTip(R);
  K.rod([FLAP_PIVOT[0], FLAP_PIVOT[1], CONS_Z + 0.02], ft, 0.006, 'dash', 0.1, T.metal, 0, 5);
  K.obox(ft, [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.012, 0.016, 0.009, 'dash', 0.1, C.white);
  const Lc = K.panel([-0.39, 0.45, CONS_Z + 0.0015], [1, 0, 0], [0, 1, 0]);    // fuel panel
  const FUEL_SW = ['BST L', 'BST R', 'WING L', 'WING R', 'XFEED', 'GATE', 'FILL L', 'FILL R'];
  for (let i = 0; i < 8; i++) Lc.toggle(-0.09 + (i % 4) * 0.06, 0.06 - (i >> 2) * 0.07, on && i !== 3, FUEL_SW[i]);
  placard(Lc, -0.11, -0.13, 0.11, -0.127, 'FUEL');
  const Tc = K.panel([-0.38, -0.30, CONS_Z + 0.0015], [1, 0, 0], [0, 1, 0]);   // emergency flight control
  Tc.bar(-0.05, -0.07, 0.07, 0.008, 0.5 + R.trim * 0.5, C.white, 'TRIM');
  Tc.toggle(0.04, 0.03, on, 'ELEV');
  Tc.toggle(0.08, 0.03, false, 'AIL');
  placard(Tc, -0.10, -0.10, 0.10, -0.097, 'EMER FLT CTL');
  // The utility light on the left rail, aft: it lights the seat when the dome is on.
  const ul = [-0.40, -0.30, P.reaper.sillZ(-0.30) + 0.05];
  K.rod(add(ul, [0, 0, -0.04]), ul, 0.006, 'pil', 0.1, T.frame, 0, 5);
  K.rod(ul, add(ul, [0.03, 0.02, 0]), 0.014, 'pil', 0.1, C.black, 0, 8);
  K.rod(add(ul, [0.03, 0.02, 0]), add(ul, [0.034, 0.023, 0]), 0.011, 'pil', 0, R.L.dome && on ? C.lampOn : C.lampOff, R.L.dome && on ? 1 : 0, 8);

  // ── THE RIGHT CONSOLE: the lighting and electrical panel, UHF, IFF ──
  const Rc = K.panel([0.40, 0.00, CONS_Z + 0.0015], [1, 0, 0], [0, 1, 0]);
  const SW_NAME = { master: 'BAT', beacon: 'BCN', nav: 'NAV', strobe: 'STRB', dome: 'DOME' };
  const swState = { master: on, beacon: on, nav: on, strobe: on, dome: !!(R.L.dome && on) };
  SW_ROW.ids.forEach((id, i) => {
    const p = swPos(i), a = p[0] - 0.40, b = p[1] - 0.0;
    const sw = !!swState[id];
    const f = eased('reaper:' + id, sw ? 1 : 0, 18) - pressPulse('reaper:' + id, sw) * 0.3;
    Rc.rect(a - 0.009, b - 0.016, a + 0.009, b + 0.016, C.black, 0, 0.002);
    Rc.stud(a, b + (f * 2 - 1) * 0.005, 0.0068, 0.0078, 0.006 + f * 0.004, id === 'master' ? [210, 44, 38] : [232, 230, 222], 0, 0.003);
    placard(Rc, a - 0.009, b + 0.020, a + 0.009, b + 0.023, SW_NAME[id]);
  });
  const freq = on ? '251' + String(Math.floor(R.hour * 7) % 10) : '    ';
  Rc.rect(-0.12, 0.05, 0.12, 0.17, T.plateLt, 0, 0.002);                        // UHF
  Rc.digits(-0.05, 0.09, 0.016, freq, C.amber);
  Rc.text('UHF', 0, 0.155, 0.009);
  Rc.knob(-0.09, 0.11, 0.014, 0.01, C.black, 0); Rc.knob(0.09, 0.11, 0.014, 0.01, C.black, 0);
  Rc.rect(-0.12, 0.22, 0.12, 0.34, T.plateLt, 0, 0.002);                        // IFF
  for (let i = 0; i < 4; i++) Rc.knob(-0.08 + i * 0.053, 0.28, 0.011, 0.008, C.black, 0);
  Rc.text('IFF', 0, 0.32, 0.009);
  Rc.rect(-0.12, -0.40, 0.12, -0.26, T.plateLt, 0, 0.002);                      // oxygen regulator
  Rc.lamp(-0.05, -0.33, 0.012, 0.012, on && (Math.floor(R.hour * 360) % 2 === 0), C.white, 'FLOW');
  Rc.toggle(0.05, -0.33, on, 'O2');
  Rc.text('OXY', 0, -0.28, 0.009);

  // ── THE STICK ── an A-10A grip: trigger, pickle button on top, trim hat, NWS button.
  const tip = stickTip(R);
  K.obox([0, STICK_BASE[1], FLOOR_Z + 0.03], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.07, 0.07, 0.03, 'dash', 0, T.boot);
  K.rod([0, STICK_BASE[1], FLOOR_Z + 0.06], mul(add([0, STICK_BASE[1], FLOOR_Z + 0.20], tip), 0.5), 0.04, 'dash', 0, T.boot, 0, 8);
  K.rod([0, STICK_BASE[1], FLOOR_Z + 0.03], tip, 0.014, 'dash', 0, C.black, 0, 6);
  const grip = add(tip, [0, 0.012, 0.12]);
  K.rod(tip, grip, 0.021, 'dash', 0.05, T.grip, 0, 8);
  K.obox(add(tip, [0, 0.024, 0.05]), [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.006, 0.013, 0.007, 'dash', 0.2, C.black);   // trigger
  K.obox(add(grip, [0.008, 0, 0.004]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.006, 0.006, 0.004, 'dash', 0.3, C.red, R.armed && on ? 0.4 : 0.1);   // pickle
  K.obox(add(grip, [-0.009, 0.004 + R.trim * 0.004, 0.003]), [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.005, 0.005, 0.004, 'dash', 0.2, T.metal);   // trim hat
  K.obox(add(tip, [-0.02, 0.0, 0.08]), [1, 0, 0], [0, 0, 1], [-1, 0, 0], 0.005, 0.005, 0.004, 'dash', 0.2, C.black);  // NWS

  // ── THE PEDALS ──
  for (const s of [-1, 1]) pedal(K, [s * 0.13, 0.78 + (s * R.rud) * -0.0, -0.84], 0.045, 0.22, Math.max(0, s * R.rud), T.metal);

  // ── NIGHT: the console edge-lighting and the flood wash on the panel's lettering ──
  if (night) {
    for (const s of [-1, 1]) {
      const x = s < 0 ? -CONS_IN - 0.004 : CONS_IN + 0.004;
      K.box(x - 0.002, -0.44, CONS_Z - 0.004, x + 0.002, 0.60, CONS_Z, 'dash', 0, T.night, 0.5);
    }
  }
  hotspotHalo(K, reaperHotspots(P, live), live);
}
