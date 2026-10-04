// THE HYDRO'S HULL AND PILOTHOUSE, AS ONE SET OF NUMBERS.
//
// Two things draw this boat's cabin and they used to have nothing in common. `buildBoat` in
// aircraft3d.js lofts the house you see from outside — a wrapped screen, tumbled sides with a
// teardrop cut in them, an aft bulkhead with a door, a crowned hardtop on struts — out of station
// tables and curve functions declared inside its own closure. `interior-shell.js` builds the room
// you sit in out of THIRTY HAND-AUTHORED SCALARS in a different unit.
//
// Measured against each other before this file existed, they were not the same cabin and not
// close: the interior was three times as tall for its length as the house it is inside, and 27%
// too wide. Looking out of a side window put your eye somewhere the exterior has solid topside;
// the door in the bulkhead behind your head was not where the door is on the transom side of it.
// Nothing could have caught that, because there was no expression anywhere that both of them read.
//
// This is that expression. It is pure — no canvas, no camera, no tile — so the renderer, the
// interior and `scripts/shapes/shell.mjs` all call it, and a retuned beam or a raised roof moves
// all three together.
//
// ── ⚠ THE SCALE BRIDGE, AND WHY THE METRES CANCEL ────────────────────────────
//
// The exterior is in MODEL UNITS (z = 0 at the waterline, f = +1 at the stem, -1 at the transom).
// The interior is in METRES ABOUT THE EYE, which the renderer divides by the seat's own eye height
// in metres and multiplies by its `eyeH` in tiles. Put those together for one part:
//
//   world tiles  =  metres / eyeM * eyeH        (the interior's route)
//                =  units * mPerUnit / eyeM * eyeH
//
// and the exterior's route is `units * tilesPerUnit`. A seat's `eyeH` IS the eye's height above
// the water, so `eyeH = eyeZ * tilesPerUnit`, and the two agree exactly when
//
//   mPerUnit = eyeM / eyeZ
//
// with `tilesPerUnit` cancelling out of both sides. So the absolute metre value is free — it is
// the unit the interior happens to be authored in — and the ONE thing that has to hold is that
// relation. `helm.mPerUnit` below is the only place it is stated.
//
// ⚠ WHICH MEANS `eyeM` IS A STATEMENT ABOUT THE BOAT'S SIZE, not a knob. Setting the helm eye 1.35
// m above the water makes this a 15.0 m hull with a 3.7 m beam, a 5.7 m pilothouse, 1.54 m from
// the sole to the headlining and 0.43 m of air over your head — an offshore racer, which is what
// the flight model already calls it. Double it and the same mesh is a 30 m motor yacht whose helm
// you cannot see over the dash of. The mesh does not care; everything a human is measured against
// does.

// ── THE HELM ─────────────────────────────────────────────────────────────────
//
// Where the driver's eye is, and it is the one thing here that is not read off the exterior —
// there is no helm feature in the mesh to derive it from. Everything else on this page is.
//
// ⚠ EVERY FIELD HERE IS THE HYDRO'S AND A ROW MAY OVERRIDE IT (`helmEyeM`, `helmF`, `helmG`,
// `helmUp`). A canopy cat sits its driver low and far forward; a pilothouse cruiser sits them up
// and back. What a row must NOT do is pick `helmEyeM` to frame the view: it sets metres per unit,
// so every hull's eye is solved to one fleet scale (`FLEET_M_PER_UNIT`), and shell.mjs fails a
// hull whose metre is not the hydro's metre.
export const HELM = {
  // Metres above the water. See the scale bridge above: this number sizes the boat.
  eyeM: 1.35,
  // How far aft of the screen foot, as a fraction of the house's length. You stand back from the
  // glass far enough that the dash fits between you and it.
  fFrac: 0.35,
  // How far to STARBOARD of the centreline, as a fraction of the house's half-width there. The
  // throttle is already authored on the starboard gunwale, so the driver is on that side of the
  // boat; dead-centre is a race tub's arrangement and this hull has a pilothouse.
  gFrac: 0.34,
  // How far up from the sole to the headlining. A seated eye, low in the hull, looking out over a
  // sill that is roughly at your chin — which is what the exterior's own side aperture gives.
  upFrac: 0.72,
};

// ⚠ MEMOISED ON THE ROW'S IDENTITY, not on its id. The Modelshop hands a REPLACED row in when
// somebody tunes a parameter, so a cache keyed on 'hydro' would serve the pre-edit house for the
// life of the page — the same trap `shapeForModel`'s WeakMap is written about.
const CACHE = new WeakMap();

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export function boatGeom(S = {}) {
  const hit = CACHE.get(S);
  if (hit) return hit;
  const G = build(S);
  CACHE.set(S, G);
  return G;
}

function build(S) {
  const LEN = S.len ?? 1.0;
  const BEAM = S.beam ?? 0.25;           // HALF-beam at the widest station
  const DECK = S.deckZ ?? 0.095;         // sheer height at the transom
  const BOW = S.bowZ ?? 0.150;           // sheer height at the stem — the sheer RUNS UP forward
  const KEEL = S.keel ?? 0.060;          // how far the vee drops below the waterline
  const CH = S.chineZ ?? 0.016;          // chine height above the waterline aft

  // ── THE HULL, AS STATIONS ──────────────────────────────────────────────────
  // Each station is [f, keel depth, chine half-width, chine height, sheer half-width, sheer
  // height]. The sheer RISES toward the bow, which is most of what says "fast boat"; the entry is
  // deliberately finer than it looks it should be, because that is what a deep-V is.
  const st = (f, k, cw, cz, sw, sz) => ({ f, k, cw, cz, sw, sz });
  const B1 = BEAM, DK = DECK, BW = BOW;
  // ── ⚠ TWO HULL FORMS, ONE TABLE SHAPE ──────────────────────────────────────
  // `hullForm: 'cat'` is an offshore tunnel catamaran: two sponsons, each its own small vee, with an
  // air tunnel between them roofed by the deck. It is a different table and not a different
  // builder, because everything that stands ON a hull (the deck, the topside, the chine, the house,
  // the room you sit in) only asks a station for its chine and its sheer, and a cat has both. What
  // a cat adds is three numbers per station that only the BOTTOM reads:
  //   tw  the tunnel's half-width, which is where each sponson's inner wall stands
  //   tz  the tunnel roof, the underside of the deck between the sponsons
  //   iz  the inner chine, where the tunnel wall meets the sponson's own bottom
  // ⚠ AND THE NOSE IS BLUNT ON PURPOSE. A monohull's stem closes to a point, so a tunnel that is a
  // fraction of the chine width closes with it and the two sponsons fuse into one vee for the last
  // tenth of the boat, which from dead ahead is a monohull. The cat's stem station is a third of the
  // beam wide, so the two sponson tips are still two tips at the very front.
  const CAT = S.hullForm === 'cat';
  const STATIONS = (CAT ? [
    { ...st( 1.000 * LEN, 0.038, 0.30 * B1, 0.056, 0.34 * B1, BW), tw: 0.14 * B1, tz: BW - 0.022, iz: 0.056 },
    { ...st( 0.860 * LEN, 0.004, 0.62 * B1, 0.044, 0.68 * B1, BW * 0.97), tw: 0.30 * B1, tz: 0.074, iz: 0.046 },
    { ...st( 0.640 * LEN, -0.020, 0.85 * B1, 0.032, 0.88 * B1, DK + (BW - DK) * 0.70), tw: 0.38 * B1, tz: 0.062, iz: 0.034 },
    { ...st( 0.380 * LEN, -0.030, 0.96 * B1, 0.026, 0.97 * B1, DK + (BW - DK) * 0.45), tw: 0.42 * B1, tz: 0.054, iz: 0.027 },
    { ...st( 0.060 * LEN, -0.034, 1.00 * B1, 0.021, 1.00 * B1, DK + (BW - DK) * 0.22), tw: 0.44 * B1, tz: 0.049, iz: 0.022 },
    { ...st(-0.320 * LEN, -0.034, 1.00 * B1, CH + 0.002, 1.00 * B1, DK + (BW - DK) * 0.08), tw: 0.44 * B1, tz: 0.046, iz: CH + 0.002 },
    { ...st(-0.700 * LEN, -0.032, 0.99 * B1, CH, 0.99 * B1, DK + (BW - DK) * 0.02), tw: 0.44 * B1, tz: 0.044, iz: CH },
    { ...st(-1.000 * LEN, -0.030, 0.98 * B1, CH, 0.98 * B1, DK), tw: 0.44 * B1, tz: 0.042, iz: CH },
  ].map((s) => ({ ...s, k: s.k * (KEEL / 0.034) })) : [
    st( 1.000 * LEN, -0.004, 0.012 * B1 / 0.25, 0.055, 0.016 * B1 / 0.25, BW),
    st( 0.860 * LEN, -0.030, 0.19 * B1, 0.050, 0.25 * B1, BW * 0.97),
    st( 0.640 * LEN, -0.052, 0.45 * B1, 0.036, 0.54 * B1, DK + (BW - DK) * 0.80),
    st( 0.380 * LEN, -0.062, 0.76 * B1, 0.027, 0.84 * B1, DK + (BW - DK) * 0.55),
    st( 0.060 * LEN, -0.064, 0.97 * B1, 0.020, 0.99 * B1, DK + (BW - DK) * 0.30),
    st(-0.320 * LEN, -0.060, 1.00 * B1, CH + 0.004, 1.00 * B1, DK + (BW - DK) * 0.12),
    st(-0.700 * LEN, -0.050, 0.98 * B1, CH, 0.99 * B1, DK + (BW - DK) * 0.04),
    st(-1.000 * LEN, -0.038, 0.94 * B1, CH, 0.96 * B1, DK),
  ].map((s) => ({ ...s, k: s.k * (KEEL / 0.060) })));
  // Where a sponson's keel runs: off-centre, a little outboard of the middle of the sponson, so its
  // inner bottom (the tunnel side) is the steeper face. Null on a monohull, whose keel is the
  // centreline.
  for (const s of STATIONS) if (s.tw != null) s.kg = s.tw + (s.cw - s.tw) * 0.46;

  // The hull at a fore-aft position, interpolated between the two stations bracketing it. Every
  // part that stands ON the hull — the house, the well coaming, the sole — is placed through this
  // rather than against a literal, so a retuned beam or sheer carries all of them with it.
  // ⚠ IT ANSWERS THE KEEL AND THE TUNNEL TOO, which nothing standing on the hull asks for but the
  // bottom does: a step or a strake cut part-way between two stations has to know how deep the
  // vee is there, and on a cat where the sponson's keel and the tunnel roof are.
  const lerpSt = (a, b, t) => {
    const L = (k) => a[k] + (b[k] - a[k]) * t;
    const o = { f: L('f'), k: L('k'), cw: L('cw'), cz: L('cz'), sw: L('sw'), sz: L('sz') };
    if (a.tw != null) { o.tw = L('tw'); o.tz = L('tz'); o.iz = L('iz'); o.kg = L('kg'); }
    return o;
  };
  const atF = (f) => {
    for (let i = 0; i < STATIONS.length - 1; i++) {
      const a = STATIONS[i], b = STATIONS[i + 1];
      if (f <= a.f && f >= b.f) return lerpSt(a, b, (a.f - f) / ((a.f - b.f) || 1));
    }
    const e = f > STATIONS[0].f ? STATIONS[0] : STATIONS[STATIONS.length - 1];
    return lerpSt(e, e, 0);
  };

  // ── THE PILOTHOUSE ─────────────────────────────────────────────────────────
  const hF1 = S.houseF1 ?? 0.22, hF0 = S.houseF0 ?? -0.54;
  const hH = S.houseH ?? 0.132, rake = S.houseRake ?? 0.115;
  const TUM = S.houseTumble ?? 0.20;      // how far the sides lean in over the full height
  const WRAP = S.houseWrap ?? 0.085;      // how far aft the screen corners carry
  const NOSE = S.houseNose ?? 0.16;       // how much the plan narrows toward the screen

  // Where the wrapped screen LANDS on the side of the house: its foot at `fw`, its head further
  // aft at `fwT`, which is what gives the corner a rake of its own.
  const fw = hF1 - WRAP;
  const fwT = fw - (S.screenRakeSide ?? 0.066);
  const rF = hF1 - rake;                  // the screen's top edge, leaning back

  // Half-width at a station, at height fraction t. ⚠ ONE FUNCTION, AND EVERY PART READS IT — the
  // sides, the screen, the roof, the struts and now the room inside all have to agree about where
  // the wall IS, and a second copy of a taper is a strut standing in mid-air or a headlining that
  // does not meet its own wall.
  // `houseWidth` is how much of the deck the house takes: nearly all of it on a pilothouse boat,
  // about half on a cat, whose canopy is a capsule on the centreline with open deck either side.
  const HWID = S.houseWidth ?? 0.92;
  const hw = (f, t) => {
    const fwd = clampN((f - hF0) / ((hF1 - hF0) || 1), 0, 1);
    return atF(f).sw * HWID * (1 - NOSE * fwd * fwd) * (1 - TUM * t);
  };
  const hz = (f, t) => atF(f).sz + hH * t;
  const cen = [(hF0 + hF1) / 2, 0, (hz(hF0, 0) + hz(hF1, 1)) / 2];
  const sideF1 = fw;                      // the side runs forward to the wrap, not to the screen

  // ── THE DAYLIGHT OPENING ───────────────────────────────────────────────────
  // A window is a closed curve: `u` is 0 at the aft point and 1 at the screen, the half-height is
  // elliptical in u (so the aft end is ROUNDED rather than a cusp), and the sill is a near-flat
  // beltline with the head carrying all of the shape.
  const sillF = S.sillFwd ?? 0.24;
  const headF = S.headFwd ?? 1.0;
  const tPt = S.sillAft ?? 0.60;                         // the height the opening closes at
  const gAft = hF0 + (rF - hF0) * (S.glassAft ?? 0.16);  // and where, as a fraction along
  const uOf = (f) => clampN((f - gAft) / ((rF - gAft) || 1), 0, 1);
  const eHalf = (headF - sillF) / 2;
  const kick = tPt - sillF;
  const halfAt = (u) => eHalf * Math.sqrt(Math.max(0, 2 * u - u * u));
  const sillAt = (f) => sillF + kick * (1 - uOf(f));
  const headAt = (f) => sillAt(f) + 2 * halfAt(uOf(f));

  // The painted band that follows the aperture, and the pane's foot under the widest part of it.
  const TW = S.trimBand ?? 0.075;
  const TWtap = S.trimTaper ?? 1.6;
  const bandAt = (f) => TW * (1 + (1 - uOf(f)) * TWtap);
  const gLo = Math.max(0.02, sillF - TW * (1 + TWtap) - 0.05);
  const INSET = 0.968;                    // how far the pane sits behind the wall

  // ── THE BACK, AND THE DOOR OUT OF IT ───────────────────────────────────────
  const door = { halfW: hw(hF0, 0) * 0.42, topT: 0.80 };

  // ── THE HARDTOP ────────────────────────────────────────────────────────────
  const over = S.roofOver ?? 0.028;
  const crownH = S.roofCrown ?? 0.010;
  const SWEEP = S.roofSweep ?? 0.085;
  const THK = 0.013;
  const rf0 = hF0 - over, rf1 = rF + over * 1.4;
  const rw = (f) => {
    const g = clampN((f - rf0) / ((rf1 - rf0) || 1), 0, 1);
    return hw(clampN(f, hF0, rF), 1) * (1 - 0.10 * g * g) + over;
  };
  const rz = (f) => hz(clampN(f, hF0, rF), 1);
  const cr = (u) => crownH * (1 - u * u);
  const frontAt = (u) => rf1 - SWEEP * u * u;

  // ── THE SOLE ───────────────────────────────────────────────────────────────
  // ⚠ THE WELL'S FLOOR, NOT A NEW NUMBER. The deck aft of the house is cut away and floored at
  // `DK * 0.34`, and the door in the bulkhead joins the two — so a cabin sole at any other height
  // is a step you can see through the doorway from outside and fall down from inside.
  // ⚠ ON A CAT THE WELL FLOOR HAS TO CLEAR THE TUNNEL ROOF. At `DK * 0.34` it is below the
  // underside of the deck between the sponsons, so the cabin sole would hang down into the tunnel
  // as a shelf across it, visible from every angle low enough to see daylight through her. The
  // floor sits a deck's thickness over the highest tunnel roof under the house and the well.
  const tunnelTop = CAT ? Math.max(...STATIONS.filter((s) => s.f <= hF1 + 0.1 && s.f >= (S.cockpitF0 ?? -0.88) - 0.1).map((s) => s.tz)) : -Infinity;
  const soleZ = S.soleZ ?? Math.max(DK * 0.34, tunnelTop + 0.010);

  // ── WHERE THE DRIVER'S EYE IS ──────────────────────────────────────────────
  const H = { eyeM: S.helmEyeM ?? HELM.eyeM, fFrac: S.helmF ?? HELM.fFrac, gFrac: S.helmG ?? HELM.gFrac, upFrac: S.helmUp ?? HELM.upFrac };
  const helmF = hF1 - H.fFrac * (hF1 - hF0);
  const roofUnder = rz(helmF);
  const helmZ = soleZ + H.upFrac * (roofUnder - soleZ);
  const helmG = H.gFrac * hw(helmF, (helmZ - hz(helmF, 0)) / (hH || 1));
  // ⚠ A SECOND HULL STATES THE FLEET'S METRE, NOT ITS OWN EYE. Written as an eye height, a cat whose
  // driver sits low would be handed the hydro's 1.35 m and come out a third bigger than her, in
  // metres, than she is in the water beside her. `mPerUnit` on the row is the hydro's own figure
  // copied, and the eye falls out of where the seat is; shell.mjs holds every row to the hydro's.
  if (S.mPerUnit != null && S.helmEyeM == null) H.eyeM = helmZ * S.mPerUnit;
  const helm = {
    f: helmF, g: helmG, z: helmZ,
    eyeM: H.eyeM,
    // The one relation that makes the inside and the outside the same size. See the header.
    mPerUnit: H.eyeM / helmZ,
  };

  return {
    S, LEN, BEAM, DECK, BOW, KEEL, CH, CAT,
    STATIONS, atF,
    hF0, hF1, hH, rake, TUM, WRAP, NOSE, fw, fwT, rF, sideF1,
    hw, hz, cen,
    sillF, headF, tPt, gAft, uOf, eHalf, kick, halfAt, sillAt, headAt,
    TW, TWtap, bandAt, gLo, INSET,
    door, soleZ, helm,
    roof: { over, crownH, SWEEP, THK, rf0, rf1, rw, rz, cr, frontAt },
  };
}
