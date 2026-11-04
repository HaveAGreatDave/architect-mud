// truck-fittings — the 38 truck fittings (plugins/trucking/fittings.js) as mesh parts, placed off a
// truck's anchors. buildTruck drew them inline off its proportion row; a truck that is a mesh file
// carries them as parts (`when: fit_<code>`), and every body has to put them somewhere that body has.
// So the geometry lives here once, and a body says where its roof, screen, mascot and racks are.
//
//   import { truckFittingParts, vintageAnchors } from './truck-fittings.mjs';
//   truckFittingParts(vintageAnchors(row))   // what buildTruck drew for that row, part for part
//
// scripts/shapes/meshes.mjs holds vintageAnchors(row) to the ported file's fittings, number for
// number, so this can't drift from what the four stock trucks wear.
//
// Every part is a box or a one-face poly in buildTruck's own shape, in buildTruck's order, named for
// its fitting, with `minDetail: 1` on what only the near detail drew. Nothing here moves a pod, a
// lamp, the door or the kingpin, which is the rule buildTruck kept for fittings.
import { FITTINGS } from '../../plugins/trucking/fittings.js';

const NAME = Object.fromEntries(Object.values(FITTINGS).map((f) => [f.code, f.name]));
const CHROME = [226, 232, 240];
const ACCENT = [96, 196, 214];
const PK = (t) => (t === CHROME ? 'bright' : t === ACCENT ? 'glow' : null);

// A stock truck's anchors, from its proportion row (content/vehicle_models/truck_<type>.json), by
// buildTruck's own sums. `pods` are the tractor's [f, g] lifter positions, in order.
export function vintageAnchors(S, pods) {
  const nose1 = 0.40, nose0 = nose1 - S.nose, cab1 = nose0, cab0 = cab1 - S.cab;
  const PLATE_BACK = 0.06, SWING_MARGIN = 1.15, NOSE_TAPER = 0.70;
  const frame0 = cab0 - (PLATE_BACK + S.w * 1.02 * NOSE_TAPER * SWING_MARGIN);
  const roofZ = S.hi + S.sleeper;
  const scr = { F0: nose0 - 0.004, F1: nose0 + 0.038, Lo: S.hi * 0.52, Hi: S.hi * 0.985 };
  const SD = 0.010;
  return {
    w: S.w, hi: S.hi, nose0, nose1, cab0, cab1, frame0, roofZ, barF: nose1 + 0.014,
    // The screen: a point at fraction t up it, at lateral g (in units of scrW), pushed proud by SD.
    scrW: S.w * 0.94,
    scrP: (t, g) => [scr.F0 + (scr.F1 - scr.F0) * t + SD, g, scr.Lo + (scr.Hi - scr.Lo) * t],
    cage: [cab1 - 0.150, cab0 + 0.010], parapet: [cab1 - 0.150, cab0 + 0.008],
    lightBarF: cab1 - 0.062, beaconF: cab0 - 0.006, totemF: cab0 - 0.004, aerialF: cab0 + 0.006,
    stacks: Array.from({ length: S.stacks }, (_, i) => (S.stacks === 1 ? 0 : (i ? 1 : -1)) * S.w * 0.94),
    stackF: cab0, stackTop: roofZ + 0.062,
    mascot: S.nose > 0.02 ? [nose1 - 0.030, 0.128] : [cab1 - 0.020, S.hi * 0.96],
    pods,
  };
}

export function truckFittingParts(A) {
  const parts = [];
  let cur = null, near = false;
  const emit = (r) => { r.name = NAME[cur]; r.when = 'fit_' + cur; if (near) r.minDetail = 1; parts.push(r); };
  const box = (f0, f1, w, z0, z1, role = 'body', tint = null, gc = 0) => {
    const r = { kind: 'box', f: [f0, f1], w, z: [z0, z1] };
    if (!Object.is(gc, 0)) r.g = gc;
    if (role !== 'body') r.role = role;
    if (tint) { r.tint = tint.slice(); const k = PK(tint); if (k) r.pk = k; }
    emit(r);
  };
  const poly = (role, sh, pts, tint = null) => {
    const fc = { role, sh, p: pts.map((v) => [v[0], v[1], v[2]]) };
    if (tint) { fc.tint = tint.slice(); const k = PK(tint); if (k) fc.pk = k; }
    emit({ kind: 'poly', faces: [fc] });
  };
  const bullet = (f0, len, g, r, z) => {
    for (let i = 0; i < 3; i++) {
      const t0 = f0 + (len * i) / 3, k = 1 - i * 0.3;
      box(t0, t0 + len / 3, r * k, z - r * k, z + r * k, 'window', CHROME, g);
    }
  };
  const fit = (code, fn) => { cur = code; fn(); cur = null; };
  const fine = (fn) => { const was = near; near = true; fn(); near = was; };
  const W = A.w, HI = A.hi, cab0 = A.cab0, cab1 = A.cab1, nose0 = A.nose0, frame0 = A.frame0;
  const roofZ = A.roofZ, barF = A.barF;

  // ── FRONT BAR ──
  fit('rp', () => {                        // Ram Plate: a ploughed wedge across the whole nose
    box(barF - 0.006, barF + 0.028, W * 1.02, 0.030, 0.150, 'strut');
    poly('strut', 0.86, [[barF + 0.028, -W * 1.02, 0.150], [barF + 0.028, W * 1.02, 0.150],
      [barF + 0.062, W * 0.42, 0.104], [barF + 0.062, -W * 0.42, 0.104]]);
    for (const g of [-1, 1]) box(barF - 0.030, barF + 0.004, 0.008, 0.052, 0.070, 'strut', null, g * W * 0.7);
  });
  fit('tu', () => {                        // Tusk Bar: four lengths of pipe, sharpened
    box(barF - 0.004, barF + 0.010, W * 0.96, 0.058, 0.074, 'strut');
    for (const g of [-0.72, -0.24, 0.24, 0.72]) {
      for (let i = 0; i < 3; i++) {
        const k = 1 - i * 0.3;
        box(barF + 0.010 + i * 0.020, barF + 0.030 + i * 0.020, 0.011 * k, 0.066 - 0.011 * k, 0.066 + 0.011 * k, 'strut', null, g * W);
      }
    }
  });
  fit('pb', () => {                        // Chrome Push Bar: a hoop with two lamps in it
    for (const g of [-1, 1]) box(barF - 0.002, barF + 0.010, 0.007, 0.048, 0.132, 'window', CHROME, g * W * 0.72);
    box(barF - 0.002, barF + 0.010, W * 0.74, 0.124, 0.136, 'window', CHROME);
    box(barF - 0.002, barF + 0.010, W * 0.74, 0.070, 0.080, 'window', CHROME);
    for (const g of [-1, 1]) box(barF + 0.008, barF + 0.016, 0.014, 0.096, 0.122, 'glass', [212, 208, 176], g * W * 0.34);
  });
  fit('wn', () => {                        // Recovery Winch: drum, fairlead, and cable on it
    box(barF - 0.004, barF + 0.026, 0.030, 0.052, 0.086, 'strut');
    box(barF + 0.002, barF + 0.020, 0.034, 0.060, 0.078, 'gear');
    box(barF + 0.024, barF + 0.030, 0.016, 0.058, 0.076, 'window', CHROME);
  });
  fit('sx', () => {                        // Spike Rack: rebar, cut, sharpened, stood up in a row
    box(barF - 0.004, barF + 0.008, W * 0.98, 0.050, 0.060, 'strut');
    for (const g of [-0.84, -0.50, -0.17, 0.17, 0.50, 0.84]) {
      for (let i = 0; i < 3; i++) {
        const k = 1 - i * 0.3;
        box(barF - 0.003, barF + 0.007, 0.005 * k, 0.060 + i * 0.016, 0.076 + i * 0.016, 'strut', null, g * W);
      }
    }
  });
  fit('gb', () => {                        // Grader Blade: a mouldboard on an angle
    poly('strut', 0.80, [[barF + 0.004, -W * 1.10, 0.024], [barF + 0.004, W * 1.10, 0.050],
      [barF + 0.036, W * 1.06, 0.106], [barF + 0.036, -W * 1.06, 0.080]]);
    poly('gear', 0.52, [[barF + 0.004, -W * 1.10, 0.024], [barF + 0.004, W * 1.10, 0.050],
      [barF - 0.006, W * 1.06, 0.058], [barF - 0.006, -W * 1.06, 0.032]]);
    box(barF + 0.030, barF + 0.040, W * 1.05, 0.098, 0.108, 'window', CHROME);
    for (const g of [-1, 1]) box(barF - 0.028, barF + 0.006, 0.008, 0.044, 0.068, 'strut', null, g * W * 0.66);
  });

  // ── Screen ── Quads in the screen's plane, pushed proud of it (A.scrP).
  const scrW = A.scrW;
  const scrQ = (role, sh, t0, t1, g0, g1, tint) => poly(role, sh, [A.scrP(t0, g0), A.scrP(t0, g1), A.scrP(t1, g1), A.scrP(t1, g0)], tint);
  fit('zm', () => {                        // Screen Mesh
    for (let i = -3; i <= 3; i++) scrQ('strut', 0.86, 0.03, 0.97, (i - 0.10) * scrW * 0.27, (i + 0.10) * scrW * 0.27);
    for (const t of [0.26, 0.54, 0.82]) scrQ('strut', 0.92, t - 0.030, t + 0.030, -scrW, scrW);
    for (const t of [0.03, 0.97]) scrQ('strut', 0.74, t - 0.026, t + 0.026, -scrW * 1.02, scrW * 1.02);
  });
  fit('zp', () => {                        // Slit Plate
    scrQ('gear', 0.88, 0.02, 0.44, -scrW * 1.02, scrW * 1.02);
    scrQ('gear', 0.88, 0.60, 0.98, -scrW * 1.02, scrW * 1.02);
    for (const g of [-1, 1]) scrQ('gear', 0.78, 0.44, 0.60, g * scrW * 0.58, g * scrW * 1.02);
    fine(() => { for (const t of [0.09, 0.93]) for (let i = -2; i <= 2; i++)
      scrQ('strut', 1.00, t - 0.018, t + 0.018, i * scrW * 0.40 - scrW * 0.05, i * scrW * 0.40 + scrW * 0.05); });
  });
  fit('zb', () => scrQ('window', 0.94, 0.80, 0.98, -scrW, scrW, [122, 70, 42]));   // Sun Strip

  // ── ROOF ──
  fit('rc', () => {                        // Roof Cage: bar, cans, a rolled tarp
    const [f0, f1] = A.cage;
    for (const g of [-1, 1]) box(f0, f1, 0.005, roofZ + 0.004, roofZ + 0.040, 'strut', null, g * W * 0.92);
    for (const f of [f0, (f0 + f1) / 2, f1]) box(f - 0.004, f + 0.004, W * 0.94, roofZ + 0.034, roofZ + 0.040, 'strut');
    fine(() => {
      for (const g of [-0.5, 0.5]) box(f0 + 0.014, f0 + 0.048, 0.018, roofZ + 0.006, roofZ + 0.036, 'body', null, g * W);
      box(f1 - 0.052, f1 - 0.006, W * 0.5, roofZ + 0.008, roofZ + 0.032, 'gear');
    });
  });
  fit('lb', () => {                        // Halogen Light Bar: eight lamps on a chrome rail
    const f = A.lightBarF;
    box(f - 0.008, f + 0.008, W * 0.92, roofZ + 0.004, roofZ + 0.012, 'window', CHROME);
    for (let i = -3; i <= 3; i += 2) {
      box(f - 0.010, f + 0.010, 0.017, roofZ + 0.012, roofZ + 0.044, 'window', CHROME, i * W * 0.24);
      box(f + 0.008, f + 0.013, 0.014, roofZ + 0.016, roofZ + 0.040, 'glass', [216, 210, 178], i * W * 0.24);
    }
  });
  fit('bc', () => {                        // Amber Beacon: one lamp on a stalk
    const f = A.beaconF;
    box(f - 0.004, f + 0.004, 0.005, roofZ, roofZ + 0.022, 'strut');
    box(f - 0.012, f + 0.012, 0.013, roofZ + 0.022, roofZ + 0.046, 'glass', [236, 158, 48]);
    box(f - 0.013, f + 0.013, 0.014, roofZ + 0.018, roofZ + 0.024, 'window', CHROME);
  });
  fit('tm', () => {                        // Totem Rack: everything on it was taken off something
    const f = A.totemF;
    box(f - 0.003, f + 0.003, W * 0.86, roofZ + 0.002, roofZ + 0.008, 'strut');
    for (const [g, h, w] of [[-0.78, 0.030, 0.010], [-0.30, 0.046, 0.007], [0.16, 0.024, 0.012], [0.66, 0.038, 0.008]]) {
      box(f - 0.004, f + 0.004, w, roofZ + 0.008, roofZ + 0.008 + h, 'gear', null, g * W);
    }
  });
  fit('np', () => {                        // Roof Parapet: plate up round the roof, cut low at the front
    const [f0, f1] = A.parapet;
    for (const g of [-1, 1]) box(f0, f1, 0.005, roofZ + 0.002, roofZ + 0.032, 'gear', null, g * W * 0.90);
    box(f0, f0 + 0.007, W * 0.90, roofZ + 0.002, roofZ + 0.017, 'gear');
    box(f1 - 0.007, f1, W * 0.90, roofZ + 0.002, roofZ + 0.032, 'gear');
    fine(() => {
      box(f0 + 0.026, f0 + 0.034, 0.008, roofZ + 0.017, roofZ + 0.050, 'strut', null, -W * 0.34);
      box(f0 + 0.024, f0 + 0.074, 0.010, roofZ + 0.006, roofZ + 0.020, 'gear', null, W * 0.36);
    });
  });
  fit('af', () => {                        // Aerial Farm: five whips, none of them the same length
    const f = A.aerialF;
    box(f - 0.004, f + 0.004, W * 0.82, roofZ, roofZ + 0.007, 'strut');
    for (const [g, h] of [[-0.86, 0.086], [-0.42, 0.052], [0.04, 0.106], [0.50, 0.066], [0.88, 0.040]]) {
      box(f - 0.002, f + 0.002, 0.002, roofZ + 0.007, roofZ + 0.007 + h, 'strut', null, g * W);
      fine(() => box(f - 0.003, f + 0.003, 0.004, roofZ + 0.005 + h, roofZ + 0.009 + h, 'window', CHROME, g * W));
    }
  });

  // ── Stacks ── Only on trucks that have them, one set per stack.
  const sF = A.stackF, stackTop = A.stackTop;
  for (const g of A.stacks) {
    fit('cs', () => box(sF - 0.019, sF + 0.019, 0.018, stackTop, stackTop + 0.030, 'gear', null, g));
    fit('ft', () => { for (let k = 0; k < 3; k++) box(sF - 0.018 - k * 0.003, sF + 0.018 + k * 0.003, 0.017 + k * 0.004,
      stackTop - 0.004 + k * 0.010, stackTop + 0.006 + k * 0.010, 'glass', [84, 96, 150], g); });
    fit('sn', () => { for (let k = 0; k < 4; k++) box(sF - 0.020, sF + 0.020, 0.019, 0.090 + k * 0.038, 0.100 + k * 0.038, 'window', ACCENT, g); });
    fit('so', () => {
      box(sF - 0.021, sF + 0.021, 0.020, stackTop - 0.034, stackTop + 0.004, 'gear', null, g);
      box(sF - 0.026, sF + 0.010, 0.022, stackTop + 0.004, stackTop + 0.010, 'gear', null, g);
    });
  }

  // ── FLANKS ──
  for (const g of [-1, 1]) {
    const gw = g * W;
    fit('ap', () => {                      // Riveted Plate: mismatched sheet over the doors
      box(cab1 - 0.118, cab1 - 0.040, 0.006, HI * 0.16, HI * 0.56, 'gear', null, gw + g * 0.005);
      box(cab1 - 0.046, cab1 - 0.004, 0.006, HI * 0.24, HI * 0.50, 'gear', null, gw + g * 0.005);
      fine(() => { for (const z of [HI * 0.20, HI * 0.52]) for (let i = 0; i < 4; i++)
        box(cab1 - 0.112 + i * 0.024, cab1 - 0.108 + i * 0.024, 0.003, z, z + 0.004, 'strut', null, gw + g * 0.010); });
    });
    fit('jc', () => {                      // Jerry Rack: range you can see
      box(cab0 - 0.078, cab0 - 0.020, 0.020, 0.086, 0.094, 'strut', null, gw + g * 0.016);
      for (let i = 0; i < 3; i++) box(cab0 - 0.074 + i * 0.020, cab0 - 0.058 + i * 0.020, 0.018, 0.094, 0.126, 'body', null, gw + g * 0.016);
    });
    fit('sw', () => {                      // Saw-Blade Skirt: teeth outward
      box(cab1 - 0.120, cab0 - 0.010, 0.004, 0.028, 0.036, 'strut', null, gw + g * 0.010);
      for (let i = 0; i < 5; i++) {
        const f = cab1 - 0.112 + i * 0.026;
        box(f - 0.014, f + 0.014, 0.003, 0.024, 0.030, 'window', CHROME, gw + g * 0.014);
        box(f - 0.004, f + 0.004, 0.003, 0.014, 0.040, 'window', CHROME, gw + g * 0.014);
      }
    });
    fit('sr', () => {                      // Chrome Runner: the show-truck answer
      box(cab1 - 0.108, cab0 - 0.006, 0.012, 0.040, 0.047, 'window', CHROME, gw + g * 0.018);
      box(cab1 - 0.104, cab0 - 0.010, 0.010, 0.036, 0.040, 'window', ACCENT, gw + g * 0.018);
      for (const f of [cab1 - 0.100, cab0 - 0.020]) box(f - 0.003, f + 0.003, 0.010, 0.047, 0.062, 'strut', null, gw + g * 0.014);
    });
    fit('xr', () => {                      // Spear Rack: pipe racked where a ladder would go
      for (const f of [cab1 - 0.096, cab0 + 0.024]) box(f - 0.004, f + 0.004, 0.013, HI * 0.28, HI * 0.42, 'strut', null, gw + g * 0.013);
      for (let i = 0; i < 4; i++) {
        const z = HI * 0.29 + i * 0.009, gg = gw + g * (0.009 + i * 0.0025);
        box(cab1 - 0.104, cab0 + 0.030, 0.004, z, z + 0.005, 'gear', null, gg);
        if (i < 2) fine(() => { for (let k = 0; k < 3; k++) {
          const kk = 1 - k * 0.3;
          box(cab1 - 0.104 - (k + 1) * 0.009, cab1 - 0.104 - k * 0.009, 0.004 * kk, z + 0.0025 - 0.0025 * kk, z + 0.0025 + 0.0025 * kk, 'strut', null, gg);
        } });
      }
    });
    fit('hd', () => {                      // Hide Drape: skins on a rail, weighted at the hem
      box(cab1 - 0.118, cab1 - 0.022, 0.004, HI * 0.60, HI * 0.645, 'strut', null, gw + g * 0.008);
      box(cab1 - 0.112, cab1 - 0.028, 0.005, HI * 0.20, HI * 0.61, 'body', [98, 76, 56], gw + g * 0.006);
      fine(() => { for (let i = 0; i < 4; i++)
        box(cab1 - 0.108 + i * 0.022, cab1 - 0.100 + i * 0.022, 0.004, HI * 0.165, HI * 0.205, 'gear', null, gw + g * 0.008); });
    });
  }

  // ── Underlights, halos, beltline, drag chains ──
  fit('ug', () => { for (const g of [-1, 1]) box(nose0 + 0.020, frame0 + 0.06, 0.006, 0.022, 0.028, 'window', ACCENT, g * W * 0.86); });
  fit('hl', () => { for (const [f, g] of A.pods) {
    box(f - 0.030, f + 0.030, 0.027, 0.030, 0.034, 'window', ACCENT, g);
    box(f - 0.032, f - 0.026, 0.026, 0.030, 0.052, 'window', ACCENT, g);
    box(f + 0.026, f + 0.032, 0.026, 0.030, 0.052, 'window', ACCENT, g);
  } });
  fit('bn', () => { for (const g of [-1, 1]) box(cab0 + 0.014, cab1 - 0.014, 0.004, HI * 0.425, HI * 0.455, 'window', ACCENT, g * W); });
  fit('dc', () => { for (const g of [-1, 1]) {   // Drag Chains: hung off both rails, sweeping
    box(frame0 + 0.020, cab1 - 0.060, 0.004, 0.026, 0.030, 'strut', null, g * W * 0.64);
    const span = (cab1 - 0.060) - (frame0 + 0.020);
    for (let i = 0; i < 5; i++) {
      const drop = [0.020, 0.006, 0.017, 0.009, 0.014][i];
      box(frame0 + 0.028 + i * (span - 0.016) / 4 - 0.003, frame0 + 0.028 + i * (span - 0.016) / 4 + 0.003,
        0.003, 0.026 - drop, 0.028, 'gear', null, g * W * 0.64);
    }
  } });

  // ── BACK END ──
  fit('ch', () => {                        // Chain Rack: loops of load chain, swinging
    for (const g of [-1, 1]) for (let i = 0; i < 3; i++) {
      const gg = g * W * (0.42 + i * 0.22);
      box(cab0 - 0.012, cab0 - 0.006, 0.006, 0.070, 0.090, 'strut', null, gg);
      box(cab0 - 0.011, cab0 - 0.007, 0.010, 0.058, 0.072, 'gear', null, gg);
    }
  });
  fit('sp', () => {                        // Spare Pod Cradle: a whole lifter, stood on end
    box(cab0 - 0.030, cab0 - 0.008, 0.048, 0.076, 0.086, 'strut');
    box(cab0 - 0.028, cab0 - 0.010, 0.044, 0.086, 0.150, 'gear');
    box(cab0 - 0.029, cab0 - 0.009, 0.046, 0.104, 0.118, 'window', CHROME);
  });
  fit('bp', () => {                        // Banner Pole: a whip with a rag on it
    const g = W * 0.9;
    box(cab0 - 0.006, cab0 - 0.002, 0.003, 0.070, roofZ + 0.070, 'strut', null, g);
    box(cab0 - 0.006, cab0 + 0.022, 0.002, roofZ + 0.020, roofZ + 0.062, 'body', null, g);
  });
  fit('ct', () => {                        // Scrap Hopper: a bin on the headboard, and a chute out the back of it
    box(cab0 - 0.046, cab0 - 0.012, 0.052, 0.076, 0.124, 'gear');
    box(cab0 - 0.050, cab0 - 0.008, 0.056, 0.124, 0.131, 'strut');
    box(cab0 - 0.056, cab0 - 0.036, 0.028, 0.054, 0.078, 'strut');
    fine(() => {
      for (const g of [-1, 1]) box(cab0 - 0.042, cab0 - 0.016, 0.005, 0.131, 0.146, 'gear', null, g * 0.038);
      box(cab0 - 0.034, cab0 - 0.022, 0.020, 0.131, 0.140, 'gear');
    });
  });
  fit('wb', () => {                        // Water Bowser: four hundred litres, and a tap at the bottom
    box(cab0 - 0.062, cab0 - 0.010, 0.058, 0.076, 0.126, 'body');
    for (const z of [0.086, 0.114]) box(cab0 - 0.064, cab0 - 0.008, 0.060, z, z + 0.005, 'strut');
    box(cab0 - 0.038, cab0 - 0.028, 0.011, 0.126, 0.136, 'strut');
    fine(() => box(cab0 - 0.070, cab0 - 0.060, 0.006, 0.062, 0.080, 'window', CHROME));
  });

  // ── Mascot ── On the bonnet, or the cowl on a cab-over.
  const [mF, mZ] = A.mascot;
  fit('sk', () => {                        // Bleached Skull
    box(mF - 0.010, mF + 0.010, 0.011, mZ, mZ + 0.016, 'body', [216, 208, 186]);
    box(mF + 0.008, mF + 0.020, 0.007, mZ + 0.001, mZ + 0.010, 'body', [216, 208, 186]);
    for (const g of [-1, 1]) box(mF + 0.004, mF + 0.009, 0.003, mZ + 0.008, mZ + 0.012, 'glass', [18, 16, 14], g * 0.005);
  });
  fit('cb', () => bullet(mF - 0.014, 0.034, 0, 0.009, mZ + 0.010));   // Chrome Bird
  fit('dh', () => {                        // Doll Head
    box(mF - 0.008, mF + 0.008, 0.009, mZ, mZ + 0.016, 'body', [222, 196, 176]);
    for (const g of [-1, 1]) box(mF + 0.006, mF + 0.009, 0.002, mZ + 0.008, mZ + 0.011, 'glass', [30, 40, 60], g * 0.004);
  });
  fit('wi', () => {                        // Wheel Idol: a steering wheel stood upright, facing the road
    box(mF - 0.005, mF + 0.005, 0.007, mZ, mZ + 0.009, 'strut');
    for (const z of [mZ + 0.009, mZ + 0.045]) box(mF - 0.002, mF + 0.002, 0.021, z, z + 0.004, 'window', CHROME);
    for (const g of [-1, 1]) box(mF - 0.002, mF + 0.002, 0.003, mZ + 0.009, mZ + 0.049, 'window', CHROME, g * 0.019);
    box(mF - 0.003, mF + 0.003, 0.005, mZ + 0.025, mZ + 0.033, 'window', CHROME);
    fine(() => { for (const g of [-1, 1]) box(mF - 0.002, mF + 0.002, 0.010, mZ + 0.027, mZ + 0.031, 'strut', null, g * 0.010); });
  });
  return parts;
}
