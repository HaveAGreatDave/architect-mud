// A HOVER CAR'S BODY AS A SURFACE: the arithmetic every cabin-<id>.js shares.
//
// Each hover car after the Merlin (docs/proposals/hover-cars.md) states its body once, in its own
// cabin-<id>.js: the loft's stations, where the glass is, where the doors are and how they hinge,
// where the fans stand. `makeCabin` turns that statement into the surface both its exterior script
// (scripts/shapes/concepts/<id>.mjs) and its cockpit (interior-<id>.js) read, so the inside of the
// windscreen is the windscreen you see from outside. cabin-merlin.js is the same idea written out by
// hand for the first car, and is left as it is.
//
// Frame: f fore, g right, h up, in model units. An angle on a section is in degrees, 0 = the right
// waterline, +90 = the crown, -90 = the keel (scripts/shapes/fw-meshes/lib.mjs).
//
// What a cabin states:
//   stations   [f, rg, rvT, rvB, cz, boxy] nose to tail: a super-ellipse section, as emitLoft's
//   sides      the loft's side count. The glass is whole faces of the loft, so this fixes every pane
//   glass      { windscreen, side, rear? }: each { f: [aft, fore], a: [low, high] }. `f` ends on
//              stations and `a` on face edges. The side glass is mirrored for the left
//   door       { f: [aft, fore], aLo, aHi, hinge, swing }: hinge is 'front' (a car door), 'rear'
//              (a coach door), 'scissor' (lifts on its front edge) or 'roof' (a gull wing)
//   inside     { floorH, bulkheadF, seatG, eyeF, eyeM }: the tub floor, the wall behind the seats,
//              the seats' offset, and the driver's eye (station, and metres over the floor)
//   ducts      { at: [[f, g], [f, g]], rOut, rIn, h0, h1, fanH, fanR }: the right-hand pair
//   groundH, feet, pusher { f, h, r }, lengthM
//
// Pure data and arithmetic: no imports, so the bake, the gates and the browser all read it.

const lerp = (a, b, t) => a + (b - a) * t;

export function makeCabin(C) {
  const stations = C.stations.map(([f, rg, rvT, rvB, cz, boxy]) => ({ f, rg, rvT, rvB, cz, boxy }));
  const sides = C.sides;
  // The section at any station, interpolated linearly between stations (exact at the stations,
  // which is where emitLoft puts its vertices).
  function section(f) {
    const st = stations;
    if (f >= st[0].f) return { ...st[0], f };
    for (let i = 0; i < st.length - 1; i++) {
      const A = st[i], B = st[i + 1];
      if (f <= A.f && f >= B.f) {
        const t = (A.f - f) / (A.f - B.f || 1);
        return { f, rg: lerp(A.rg, B.rg, t), rvT: lerp(A.rvT, B.rvT, t), rvB: lerp(A.rvB, B.rvB, t), cz: lerp(A.cz, B.cz, t), boxy: lerp(A.boxy, B.boxy, t) };
      }
    }
    return { ...st[st.length - 1], f };
  }
  // A point on the section at angle `aDeg`, grown by `out` (negative goes in). lib.mjs secPt exactly.
  function point(f, aDeg, out = 0) {
    const s = section(f), a = aDeg * Math.PI / 180;
    const e = 1 - s.boxy * 0.55, cs = Math.cos(a), sn = Math.sin(a);
    const rg = s.rg + out, rvT = s.rvT + out, rvB = s.rvB + out;
    const g = Math.sign(cs) * Math.pow(Math.abs(cs), e) * rg;
    const h = sn >= 0 ? Math.pow(sn, e) * rvT : -Math.pow(-sn, e) * rvB;
    return [f, g, s.cz + h];
  }
  // Whether a point in model units is inside the skin (the ring's own identity, with a hair of slack).
  function within(f, g, h) {
    if (f > stations[0].f || f < stations[stations.length - 1].f) return false;
    const s = section(f), e = 1 - s.boxy * 0.55, dh = h - s.cz, rv = dh >= 0 ? s.rvT : s.rvB;
    return Math.pow(Math.abs(g) / s.rg, 2 / e) + Math.pow(Math.abs(dh) / rv, 2 / e) <= 1.0005;
  }
  // The angle on the section a point at (f, g, h) lies at, in degrees.
  function angleAt(f, g, h) {
    const s = section(f), e = 1 - s.boxy * 0.55, dh = h - s.cz;
    return Math.atan2(Math.sign(dh) * Math.pow(Math.abs(dh) / (dh >= 0 ? s.rvT : s.rvB), 1 / e), Math.sign(g) * Math.pow(Math.abs(g) / s.rg, 1 / e)) * 180 / Math.PI;
  }
  // The glass as rectangles in (f, angle), both sides: what the cockpit cuts out of its walls.
  function panes() {
    const G = C.glass, out = [{ id: 'windscreen', f: G.windscreen.f, a: G.windscreen.a }];
    out.push({ id: 'side', f: G.side.f, a: G.side.a }, { id: 'side', f: G.side.f, a: [180 - G.side.a[1], 180 - G.side.a[0]] });
    if (G.rear) out.push({ id: 'rear', f: G.rear.f, a: G.rear.a });
    return out;
  }
  function glassAt(f, aDeg) {
    const a = ((aDeg % 360) + 540) % 360 - 180;
    for (const p of panes()) if (f >= p.f[0] && f <= p.f[1] && a >= p.a[0] && a <= p.a[1]) return p.id;
    return null;
  }
  // The loft's face indices k (k spans k*step to (k+1)*step degrees) covering [a0, a1].
  const faceKs = (a0, a1) => {
    const step = 360 / sides, out = [];
    for (let k = Math.round(a0 / step); k < Math.round(a1 / step); k++) out.push(((k % sides) + sides) % sides);
    return out;
  };
  return { ...C, stations, section, point, within, angleAt, panes, glassAt, faceKs };
}
