// The Media Lot's buildings: the sound stage, KSAB5's block and the Sentinel, in one hand
// (docs/proposals/media-lot.md §6). The lot's ground and wall are glass/media-lot.js.
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// Each is one tile in its own frame: local +y is the door side, and every door on the block is on
// the lot's side, so -y is the street (Marrow Street for two of them, Meltwater Row for the stage).
//
// The hand is 1930s streamline moderne, the one the broadcasters built in: one render, one plinth and
// band line (the wall's own, LOT.PLINTH_H and LOT.BAND_Z0), one parapet with only the stage above
// it, three speed lines between the floors, steel casement ribbons, glass block in the stair drum.
// The words are the registry's (`m.letters`, `m.masthead`), so the arms carry nothing of Coldwater's.
//
// ⚠ IN CONSTANTS, NEVER fh AND h. Both are rolled per tile, and these three share a parapet and a
// wall with the ground, which can't roll anything.
// ⚠ THE LOT'S WALL STANDS IN FRONT OF THEIR STREET SIDES. drawLotMark draws it along `ml.w`, up to
// LOT.WALL_H, so nothing on a street side is worth drawing below that, and no mass may reach past
// LOT.BLD_FACE or it stands in the wall.
// ⚠ NO FACE EXISTS BY NIGHT ONLY. The night mesh is paired to the day one face for face, so glass,
// lamps and the band are always emitted and only their colour follows the hour.
// ⚠ NOTHING HERE MOVES BUT THE ON AIR LAMP, and that's a decal for the reason every moving part is
// (Moving parts in glass-notes.md): building-styles §4.5 keeps movement rare. The Sentinel's ticker is
// the lot's: its letters are in glass/media-lot.js, so this arm can stay kept.
import { faceAway,
  DECO_LIFT, DECO_PULL, DETAIL_LIFT, FACE_EPS, SHAPE_SINK, bakeSignText, flatsDropped, massDropped, blinkLight, clamp, dish, draw3DBoxAt,
  drawBarrelRoof, drawFacetDrum, drawRing, dutyPhase, emitDecoFill, emitSurfaceText, emitWire, faceYaw,
  glowPool, latticeTower, litStyle, motionOn, nearOrMesh, rgb,
} from '../../windshield.js';
import { state } from '../../../state.js';
import { flatOut, frontRing, tubeRun } from './downtown.js';
import { drawEntrance } from '../entrance.js';
import { LOT } from '../media-lot.js';

const RENDER = 'ty_dw_paint', PLINTH = 'ty_ksab_pc', COPE = 'ty_palais_stone', PLANT = 'ty_ksab_dk';
const CYAN = [57, 214, 255], CYAN_LIT = [132, 238, 255], FRAME = [44, 50, 56], STEEL = [104, 112, 118];
const RENDER_RGB = [176, 168, 150], COPE_RGB = [214, 206, 186], SHADE_RGB = [128, 122, 108];
const GLASS = [52, 66, 76], WARM = [255, 214, 150], BLIND = [206, 198, 176], VITROLITE = [18, 20, 24];
const GILT = '#dcb25e', GILT_SHADOW = '#2a2016';
const cl = (c) => c.map((v) => clamp(v, 0, 255));
const mixRgb = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
const hash = (k, i) => { const x = Math.sin(k * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };

const ROOF = LOT.ROOF_Z, FACE = LOT.BLD_FACE;
// The floors' sills and heads, and the three speed lines in the gap over each.
const FLOORS = [[0.08, 0.165], [0.272, 0.357], [0.468, 0.553]];
const SPEED = [0.196, 0.212, 0.228, 0.392, 0.408, 0.424];

// The sides of a tile, viewed from outside. `d` is how far the plane stands out from the tile's
// centre and `u` runs to the viewer's right, so a word laid along `u` reads the right way round.
const OUT = { f: [0, 1, 0], b: [0, -1, 0], l: [1, 0, 0], r: [-1, 0, 0] };
const ON = {
  f: (d, u, z) => [u, d, z], b: (d, u, z) => [-u, -d, z],
  l: (d, u, z) => [d, -u, z], r: (d, u, z) => [-d, u, z],
};

function kit(ctx, cam, F, W3, E, seed, night, alpha) {
  const yaw = faceYaw(E), dn = night ? clamp(+night, 0, 1) : 0, dusk = 1 - 0.55 * dn;
  const B = (x, y, hx, hy, z0, z1, pal, roof = true, s = 0) => {
    if (massDropped()) return;
    const [bx, by] = F(x, y);
    draw3DBoxAt(ctx, cam, bx, by, hx, z0, z1, pal, seed + s, night, alpha, roof, yaw, hy);
  };
  // A quad on a side's plane. `step` is its stand-off in FACE_EPS: nested faces need a real gap,
  // because a lift only reorders the painter and two coplanar quads z-fight in the mesh.
  // ⚠ IT RETURNS BEFORE BUILDING ANYTHING ON THE GL PATH, where the mesh already has the face: a
  // building is hundreds of these, every frame, and flatOut would build each to throw it away
  // (`perf/alloc`). So do the helpers below, for the arrays their arguments cost.
  const wall = (side, d, u0, u1, z0, z1, col, step = 1, opts) => {
    if (flatsDropped()) return;
    const dd = d + FACE_EPS * step, P = ON[side];
    flatOut(ctx, cam, W3, [P(dd, u0, z1), P(dd, u1, z1), P(dd, u1, z0), P(dd, u0, z0)], OUT[side], rgb(cl(col)), alpha, opts);
  };
  // Any polygon on a side's plane, as [u, z] pairs.
  const poly = (side, d, pts, col, step = 1) => {
    if (flatsDropped()) return;
    const dd = d + FACE_EPS * step, P = ON[side];
    flatOut(ctx, cam, W3, pts.map(([u, z]) => P(dd, u, z)), OUT[side], rgb(cl(col)), alpha);
  };
  const paint = (c) => c.map((v) => v * dusk);
  // A pane: glass by day, `lit` after dark by `k`.
  const glass = (k, lit = WARM) => mixRgb(mixRgb(GLASS, [22, 26, 30], dn), lit, dn * k);
  const at = (side, d, u, z) => { const p = ON[side](d, u, z); return [...F(p[0], p[1]), p[2]]; };
  const sees = (side, d) => {
    const p = ON[side](d, 0, 0), [ax, ay] = F(p[0], p[1]), [bx, by] = F(p[0] + OUT[side][0], p[1] + OUT[side][1]);
    return !faceAway(cam, ax, ay, bx - ax, by - ay);   // through faceAway, so a kept building sees it turn (ARM_FACE)
  };
  // Lettering on a side, in the lot's block face unless it says otherwise. `lit` is its own switch:
  // a word in the paint stays paint after dark.
  const word = (side, d, u0, u1, z0, z1, label, ink, lit = false, step = 3, font = 'block') => {
    if (!label || !sees(side, d)) return;
    const tex = bakeSignText(label, ink, lit ? 1 : 0, false, true, true, { font });
    if (!tex) return;
    const dd = d + FACE_EPS * step;
    const q = [[u0, z1], [u1, z1], [u1, z0], [u0, z0]].map(([u, z]) => { const [wx, wy, wz] = at(side, dd, u, z); return cam.proj(wx, wy, wz); });
    if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, DETAIL_LIFT * 2.5);
  };
  return { yaw, dn, dusk, B, wall, poly, paint, glass, at, sees, word };
}

// The foot of a wall: the plinth's line and the station's band, a lit strip after dark, as the
// ground's wall has them.
function footing(k, side, d, u0, u1) {
  if (flatsDropped()) return;
  k.wall(side, d, u0, u1, 0, LOT.PLINTH_H, k.paint(SHADE_RGB), 1);
  k.wall(side, d, u0, u1, LOT.BAND_Z0, LOT.BAND_Z1, mixRgb(CYAN, CYAN_LIT, k.dn), 1);
}
// Three speed lines over each floor, each with the shadow of its own bed under it.
function speedLines(k, side, d, u0, u1) {
  if (flatsDropped()) return;
  for (const z of SPEED) {
    k.wall(side, d, u0, u1, z - 0.003, z, k.paint(SHADE_RGB), 1);
    k.wall(side, d, u0, u1, z, z + 0.008, k.paint(COPE_RGB), 1.5);
  }
}
// A ribbon: a steel surround, `n` casements, each with a blind down to its own height and the bar
// the pair of leaves shut on. `lamp` is the one bay that's lit whatever the hour.
function ribbon(k, side, d, u0, u1, z0, z1, n, key, lamp = -1) {
  if (flatsDropped()) return;
  k.wall(side, d, u0 - 0.006, u1 + 0.006, z0 - 0.006, z1 + 0.006, k.paint(FRAME), 1);
  const w = (u1 - u0) / n;
  for (let i = 0; i < n; i++) {
    const a = u0 + w * i + 0.003, b = a + w - 0.006, on = i === lamp;
    const r = hash(key, i), pane = on ? WARM : k.glass(r > 0.62 ? 0.82 : 0.08);
    k.wall(side, d, a, b, z0, z1, pane, 2);
    const drop = z1 - (z1 - z0) * (0.10 + 0.66 * hash(key + 7, i));
    k.wall(side, d, a, b, drop, z1, on ? mixRgb(WARM, BLIND, 0.4) : mixRgb(k.paint(BLIND), WARM, k.dn * (r > 0.62 ? 0.7 : 0)), 3);
    const m = (a + b) / 2;
    k.wall(side, d, m - 0.0014, m + 0.0014, z0, z1, k.paint(FRAME), 4);
  }
}
// The parapet: a coping the whole way round, standing proud of the wall, on a shell whose own roof
// is the deck.
function parapet(k, cx, cy, hx, hy) {
  k.B(cx, cy, hx + 0.008, hy + 0.008, ROOF, ROOF + LOT.COPE_Z, COPE, true, 40);
}

// ── THE STAGE ──
// Square, because its roof is a barrel laid north to south and a barrel's capture reads its own
// frame: see the ⚠ at the roof.
const ST = { cy: -0.04, half: 0.40, eave: 0.72, rise: 0.15 };
const ST_FRONT = ST.cy + ST.half;                     // the shell's court face
const ST_LEAN = FACE;                                 // the lean-to's and the dock's, out from it
const ST_DOCK = { x0: 0.08, x1: 0.40, top: 0.52 };    // the scene dock, at the backlot end
const ST_LEANTO = { x0: -0.40, x1: 0.06, top: 0.27 }; // the stage door, the box office and the doorman
const ST_DOOR = { x: -0.06, w: 0.05, top: 0.128 };    // on the painted walk from the court
const ST_DECK = { x: 0.04, hx: 0.27, hy: 0.13, z: ST.eave + ST.rise - 0.012 };
const ST_MAST = { x: 0.24, y: ST.cy, top: 2.6 };

// ── KSAB5 ──
const WG = { cy: -0.02, hy: 0.42, drumX: -0.33, drumY: 0.34, drumR: 0.092, drumTop: 0.70, pierHW: 0.12, pierOut: 0.018 };
const WG_FRONT = WG.cy + WG.hy;

// ── THE SENTINEL ──
const SN = { hy: FACE, lights: [-0.32, 0.10], clockU: 0.27, clockZ: 0.43, clockR: 0.078, doorX: -0.22 };

export const LOT_BUILDING_ARMS = {
  lot_stage(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB-TV's sound stage: blind render under a barrel, the working face on the court
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, wall, poly, paint, dn, dusk } = k;
    const { cy, half, eave, rise } = ST;
    const west = half - ST.cy, east = ST_FRONT;       // the shell's planes, as distances out from the tile centre
    // ⚠ THE SHELL, AND THE PLINTH IT STANDS ON. No rooflights and no windows: a sound stage has none.
    B(0, cy, half + 0.006, half + 0.006, 0, LOT.PLINTH_H, PLINTH, true, 1);
    B(0, cy, half, half, LOT.PLINTH_H, eave, RENDER, false, 2);
    B(0, cy, half + 0.008, half + 0.008, eave, eave + 0.014, COPE, false, 3);
    // ⚠ THE BARREL RUNS NORTH TO SOUTH SO ITS GABLE IS ON FOUNDRY WAY, and drawBarrelRoof only sweeps
    // along local y, so it's handed a frame turned a quarter. The capture keeps the extents in its
    // own frame, which is why the shell is square: on a square the turned footprint is the same
    // footprint. Only the crown's line differs in the capture, by the rise at the eaves.
    drawBarrelRoof(ctx, cam, (lx, ly) => F(ly, cy - lx), 0, half, half, eave + 0.014, rise, 14, alpha, [128, 134, 138]);
    // The two gables in the lot's render, over the barrel's own tympana.
    for (const side of ['l', 'r']) {
      const c = side === 'r' ? cy : -cy, arch = [[c + half, eave]];
      for (let i = 0; i <= 14; i++) { const t = i / 14 * Math.PI; arch.push([c + half * Math.cos(t), eave + 0.014 + rise * Math.sin(t)]); }
      arch.push([c - half, eave]);
      poly(side, half, arch, paint(RENDER_RGB), 1);
    }
    // Ribs down the barrel, and the seam of each rib carried over the crown.
    if (nearOrMesh()) for (let i = 1; i < 7; i++) {
      const x = -half + 2 * half * i / 7;
      for (let j = 0; j < 14; j += 2) {
        const t0 = j / 14 * Math.PI, t1 = (j + 2) / 14 * Math.PI;
        emitWire(ctx, cam, W3(x, cy + half * Math.cos(t0), eave + 0.014 + rise * Math.sin(t0)), W3(x, cy + half * Math.cos(t1), eave + 0.014 + rise * Math.sin(t1)),
          1, 'rgba(70,76,80,0.55)', alpha, { pull: 0.01 });   // ⚠ a seam lies on the roof: DECO_PULL lifts it off the far side of the crown (`glself`)
      }
    }

    // ── MELTWATER ROW: the long blind wall, and the call letters once. Pilasters every bay, as the
    // lot's wall has them, stopping short of the letters' band.
    footing(k, 'b', west, -half, half);
    for (let i = 0; i <= 8; i++) {
      const u = -half + 0.012 + (2 * half - 0.024) * i / 8;
      B(-u, -west - 0.008, 0.012, 0.008, LOT.PLINTH_H, eave, RENDER, false, 50 + i);
    }
    {
      const z0 = 0.33, z1 = 0.60, ink = dn > 0.3 ? '#78ecff' : '#26343e', letters = String(m.letters || '');
      const u0 = -0.38, w = 0.76 / Math.max(1, letters.length);
      wall('b', west, -0.36, 0.36, z0 - 0.034, z0 - 0.022, mixRgb(CYAN, CYAN_LIT, dn), 2.4);
      // ⚠ ONE LETTER AT A TIME, because one of them is dark (`m.dead`, in the description). Letters
      // are a decal and the pilasters stand proud, so this plane is out in front of them.
      [...letters].forEach((c, i) => {
        const c0 = u0 + w * (i + 0.5);   // wider than its slot: `fitSignPts` sets a letter to the quad's short side
        k.word('b', west + 0.010, c0 - 0.135, c0 + 0.135, z0, z1, c, i === m.dead ? '#2c343a' : ink, dn > 0.3 && i !== m.dead, 3);
      });
      if (dn > 0) { const [gx, gy] = F(0, -west - 0.05); glowPool(ctx, cam, gx, gy, (z0 + z1) / 2, '90,220,255', 26, alpha * 0.32 * dn); }
    }

    // ── FOUNDRY WAY: the gable with the stage's number the height of the wall, the way lots do it.
    footing(k, 'r', half, cy - half, cy + half);
    {
      const c = cy, zt = eave + 0.06, zb = LOT.WALL_H + 0.05, bar = 0.09, ink = paint([38, 44, 50]);
      poly('r', half, [[c - 0.17, zt], [c + 0.17, zt], [c + 0.17, zt - bar], [c - 0.17, zt - bar]], ink, 2);
      poly('r', half, [[c + 0.17, zt - bar], [c + 0.04, zt - bar], [c - 0.13, zb], [c + 0.0, zb]], ink, 2);
      if (dn > 0) { const [gx, gy] = F(-half - 0.06, c); glowPool(ctx, cam, gx, gy, 0.46, '255,226,170', 24, alpha * 0.34 * dn); }
    }

    // ── THE BACKLOT END: the gable, and the scene door the flats go through.
    footing(k, 'l', half, -cy - half, -cy + half);
    {
      const u = -cy, w = 0.14, top = 0.40;
      wall('l', half, u - w - 0.012, u + w + 0.012, 0, top + 0.012, paint(FRAME), 1);
      wall('l', half, u - w, u + w, 0, top, paint(STEEL), 2);
      for (let i = 1; i < 6; i++) wall('l', half, u - w + 2 * w * i / 6 - 0.0014, u - w + 2 * w * i / 6 + 0.0014, 0, top, paint(FRAME), 3);
      wall('l', half, u - w - 0.03, u + w + 0.03, top + 0.012, top + 0.022, paint(FRAME), 2.4);   // the door's track
      if (dn > 0) { const [gx, gy] = F(half + 0.05, cy); glowPool(ctx, cam, gx, gy, top, '255,226,170', 12, alpha * 0.4 * dn); }
    }

    // ── THE COURT: the working face, from the backlot end. The scene dock and its elephant door;
    // the lean-to with the stage door, the ON AIR lamp over it, the box office and the doorman's rope.
    footing(k, 'f', east, -half, half);
    const dockC = (ST_DOCK.x0 + ST_DOCK.x1) / 2, dockH = (ST_DOCK.x1 - ST_DOCK.x0) / 2;
    const leanC = (ST_LEANTO.x0 + ST_LEANTO.x1) / 2, leanH = (ST_LEANTO.x1 - ST_LEANTO.x0) / 2;
    const out = (ST_LEAN - east) / 2, midY = (ST_LEAN + east) / 2;
    B(dockC, midY, dockH, out, 0, LOT.PLINTH_H, PLINTH, false, 12);
    B(dockC, midY, dockH, out, LOT.PLINTH_H, ST_DOCK.top, RENDER, true, 13);
    B(dockC, midY, dockH + 0.006, out + 0.006, ST_DOCK.top, ST_DOCK.top + LOT.COPE_Z, COPE, true, 14);
    footing(k, 'f', ST_LEAN, ST_DOCK.x0, ST_DOCK.x1);
    { // The elephant door: tall enough for a set on a truck, two steel leaves, the lintel over them.
      const u = dockC, w = 0.128, top = 0.44;
      wall('f', ST_LEAN, u - w - 0.012, u + w + 0.012, 0, top + 0.014, paint(FRAME), 1);
      wall('f', ST_LEAN, u - w, u + w, 0, top, paint(STEEL), 2);
      wall('f', ST_LEAN, u - 0.0018, u + 0.0018, 0, top, paint(FRAME), 3);
      for (let i = 1; i < 8; i++) for (const s of [-1, 1]) {
        wall('f', ST_LEAN, u + s * (w * i / 8) - 0.001, u + s * (w * i / 8) + 0.001, 0, top, paint([84, 90, 96]), 3);
      }
      for (const z of [0.06, 0.21, 0.36]) wall('f', ST_LEAN, u - w, u + w, z, z + 0.006, paint(FRAME), 3);
      k.word('f', ST_LEAN, u - 0.04, u + 0.04, top + 0.022, top + 0.06, m.number, '#26343e', false, 3);
    }
    B(leanC, midY, leanH, out, 0, LOT.PLINTH_H, PLINTH, false, 15);
    B(leanC, midY, leanH, out, LOT.PLINTH_H, ST_LEANTO.top, RENDER, true, 16);
    B(leanC, midY, leanH + 0.006, out + 0.006, ST_LEANTO.top, ST_LEANTO.top + LOT.COPE_Z, COPE, true, 17);
    footing(k, 'f', ST_LEAN, ST_LEANTO.x0, ST_LEANTO.x1);
    for (const z of [0.205, 0.221, 0.237]) k.wall('f', ST_LEAN, ST_LEANTO.x0, ST_LEANTO.x1, z, z + 0.008, paint(COPE_RGB), 1.5);
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: ST_DOOR.x, y: ST_LEAN, w: ST_DOOR.w, top: ST_DOOR.top, leaves: 1, frame: [84, 90, 96],
      solid: { fill: [66, 72, 78], planks: 0, handle: [196, 176, 120], crack: '255,214,150' },
      canopy: { out: 0.04, half: 0.078, hh: 0.004, pal: PLANT }, lamp: '255,226,170', frontVis,
    });
    // The box office window beside it: a counter, the glass and the card taped inside.
    {
      const a = -0.33, b = -0.19, z0 = 0.075, z1 = 0.158;
      wall('f', ST_LEAN, a - 0.008, b + 0.008, z0 - 0.008, z1 + 0.008, paint(FRAME), 1);
      wall('f', ST_LEAN, a, b, z0, z1, k.glass(0.9), 2);
      B((a + b) / 2, ST_LEAN + 0.009, (b - a) / 2 + 0.008, 0.009, z0 - 0.012, z0 - 0.004, COPE, true, 18);
      wall('f', ST_LEAN, -0.285, -0.235, 0.10, 0.13, paint([232, 226, 206]), 3);
      k.word('f', ST_LEAN, -0.282, -0.238, 0.104, 0.126, m.card, '#2a2a26', false, 4, 'condensed');
      if (dn > 0) { const [gx, gy] = F((a + b) / 2, ST_LEAN + 0.04); glowPool(ctx, cam, gx, gy, 0.11, '255,214,150', 9, alpha * 0.5 * dn); }
    }
    // The doorman's rope: two brass posts and the rope between them, off the door along the wall.
    if (nearOrMesh()) {
      const y = ST_LEAN + 0.038, p = [ST_DOOR.x - 0.075, ST_DOOR.x - 0.17], col = [176, 150, 92];
      for (const x of p) {
        tubeRun(ctx, cam, W3, [x, y, 0.002], [x, y, 0.052], 0.0032, 6, col, 'chrome', alpha, dusk);
        tubeRun(ctx, cam, W3, [x, y, 0], [x, y, 0.004], 0.009, 8, col, 'chrome', alpha, dusk);   // ⚠ a tube, not a drum: near-tier mass moves the capture (shapes:smoke)
      }
      for (let i = 0; i < 6; i++) {
        const t0 = i / 6, t1 = (i + 1) / 6, sag = (t) => 0.05 - 0.016 * Math.sin(t * Math.PI);
        emitWire(ctx, cam, W3(p[0] + (p[1] - p[0]) * t0, y, sag(t0)), W3(p[0] + (p[1] - p[0]) * t1, y, sag(t1)), 1.6, 'rgba(142,38,40,0.95)', alpha, { pull: DECO_PULL });
      }
    }
    // ON AIR: live from `studio_live` (broadcast plugin), else a duty cycle. ⚠ With motion off it's
    // on, which is what captures and gates see.
    const live = !motionOn() ? true
      : typeof state.studioLive === 'boolean' ? state.studioLive
      : dutyPhase(now, seed + 21, 210000, 0.66) >= 0;
    // ⚠ The red panel is the lamp and the letters are `solid` dark paint: neon ink's white core
    // swallows a glyph this size. ⚠ Keep it about 2.5:1, or `fitSignPts` shrinks the text to a thread.
    {
      const az0 = 0.158, az1 = 0.196, ax = ST_DOOR.x, aw = 0.052, pl = ST_LEAN + FACE_EPS * 1.2;
      const L = (u, z) => { const [wx, wy] = F(u, pl); return [wx, wy, z]; };
      const pane = live ? (night ? 'rgba(232,58,38,0.95)' : 'rgba(208,50,32,0.95)') : 'rgba(58,26,22,0.95)';
      emitDecoFill(ctx, cam, [L(ax - aw, az1), L(ax + aw, az1), L(ax + aw, az0), L(ax - aw, az0)], pane, alpha, DECO_LIFT, 'onair');
      if (frontVis) {
        const tex = bakeSignText(m.lamp, '#180a08', 0, false, true);
        const iz0 = az0 + (az1 - az0) * 0.2, iz1 = az1 - (az1 - az0) * 0.2, iw = aw * 0.86;
        const q = [[ax - iw, iz1], [ax + iw, iz1], [ax + iw, iz0], [ax - iw, iz0]].map(([u, z]) => { const [wx, wy] = F(u, pl + FACE_EPS); return cam.proj(wx, wy, z); });
        if (tex && q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha * (live ? 1 : 0.55));
      }
      if (live) { const [gx, gy] = F(ax, pl); glowPool(ctx, cam, gx, gy, (az0 + az1) * 0.5, '255,74,52', 11, alpha * (night ? 0.55 : 0.22)); }
    }

    // ── THE ROOF: a deck of air handling along the crown, on legs off the ribs, and the mast.
    const zd = ST_DECK.z;
    for (const s of [-1, 1]) for (const t of [-1, 1]) B(ST_DECK.x + s * ST_DECK.hx * 0.9, cy + t * ST_DECK.hy * 0.8, 0.01, 0.01, eave + rise - 0.03, zd, PLANT, false, 60 + s + t * 2);
    B(ST_DECK.x, cy, ST_DECK.hx, ST_DECK.hy, zd, zd + 0.012, PLANT, true, 21);
    for (const [x, y, hx, hy, top, s] of [[-0.11, 0.02, 0.09, 0.075, 0.075, 22], [0.05, -0.02, 0.05, 0.085, 0.10, 23]]) {
      B(x, cy + y, hx, hy, zd + 0.012, zd + top, PLANT, true, s);
      B(x, cy + y, hx + 0.006, hy + 0.006, zd + top, zd + top + 0.008, 'ty_ksab_pc', true, s + 8);
    }
    { const [ax, ay] = F(-0.11, cy + 0.02);
      drawRing(ctx, cam, ax, ay, zd + 0.083, 0.045, 12, 'rgba(126,138,150,0.55)', 1.4, alpha); }   // the extract cowl
    // The trunk between the two units.
    B(-0.02, cy, 0.05, 0.022, zd + 0.02, zd + 0.06, PLANT, true, 25);
    // The transmitter, the reason the station is on this corner. Its foot sits in a house through
    // the barrel, and three stays go down to the deck.
    const { x: mx, y: my, top: mastTop } = ST_MAST, mz = zd + 0.05;
    B(mx, my, 0.07, 0.07, eave, mz, RENDER, true, 26);
    B(mx, my, 0.076, 0.076, mz, mz + 0.008, COPE, true, 27);
    const [lx, ly] = F(mx, my);
    latticeTower(ctx, cam, lx, ly, mz, mastTop, 0.056, 0.016, alpha, now, seed + 5);
    dish(ctx, cam, lx, ly, mz + 0.42, 9, alpha);
    dish(ctx, cam, lx, ly, mz + 0.92, 7, alpha);
    blinkLight(ctx, cam, lx, ly, mastTop, '255,80,80', now, seed + 5, alpha, 2.0);
    blinkLight(ctx, cam, lx, ly, mz + 0.84, '255,80,80', now, seed + 7, alpha, 1.3);
    // ⚠ Anchored in the local frame, or they walk off the deck on three facings. ⚠ DECO_PULL: a stay
    // hangs in open air, and the default pull drags it in front of the building (`glself`).
    for (let i = 0; i < 3; i++) {
      const a = i * 2.0944 + 0.6, [gx, gy] = F(mx + Math.cos(a) * 0.09, my + Math.sin(a) * 0.09);
      emitWire(ctx, cam, [lx, ly, mz + (mastTop - mz) * 0.58], [gx, gy, mz], 0.9, 'rgba(170,180,194,0.5)', alpha, { pull: DECO_PULL });
    }
  },

  lot_wing(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // KSAB5: three storeys of ribbon windows, a glass-block stair drum and the door on the court
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, wall, paint, dn, dusk } = k;
    const { cy, hy } = WG, front = WG_FRONT, back = hy - cy, X = FACE;
    B(0, cy, X + 0.006, hy + 0.006, 0, LOT.PLINTH_H, PLINTH, true, 1);
    B(0, cy, X, hy, LOT.PLINTH_H, ROOF, RENDER, true, 2);
    parapet(k, 0, cy, X, hy);
    // ── THE STREET SIDE: the same ribbons as the court, and no door. Its lowest floor is behind the
    // lot's wall, so it starts on the first.
    footing(k, 'b', back, -X, X);
    speedLines(k, 'b', back, -X, X);
    for (let i = 0; i < 3; i++) ribbon(k, 'b', back, -X + 0.03, X - 0.03, FLOORS[i][0], FLOORS[i][1], 12, seed + i * 3, i === 2 ? 4 : -1);
    // ── THE SIDES: the ribbons carry on round the corners, short of the drum on the court end.
    for (const [side, a, b, n] of [['r', cy - hy + 0.02, cy + hy - 0.18, 8], ['l', -cy - hy + 0.03, -cy + hy - 0.03, 10]]) {
      footing(k, side, X, side === 'r' ? cy - hy : -cy - hy, side === 'r' ? cy + hy : -cy + hy);
      speedLines(k, side, X, side === 'r' ? cy - hy : -cy - hy, side === 'r' ? cy + hy : -cy + hy);
      for (let i = 0; i < 3; i++) ribbon(k, side, X, a, b, FLOORS[i][0], FLOORS[i][1], n, seed + 11 + i * 5 + (side === 'r' ? 1 : 2));
    }
    // ── THE COURT: the entrance pier up the middle, the upper ribbons either side of it.
    footing(k, 'f', front, -X, X);
    const pH = WG.pierHW, pF = front + WG.pierOut;
    B(0, front + WG.pierOut / 2, pH, WG.pierOut / 2 + 0.002, 0, LOT.PLINTH_H, PLINTH, false, 3);
    B(0, front + WG.pierOut / 2, pH, WG.pierOut / 2 + 0.002, LOT.PLINTH_H, ROOF + 0.05, RENDER, true, 4);
    B(0, front + WG.pierOut / 2, pH + 0.006, WG.pierOut / 2 + 0.008, ROOF + 0.05, ROOF + 0.05 + LOT.COPE_Z, COPE, true, 5);
    footing(k, 'f', pF, -pH, pH);
    const drumEdge = WG.drumX + WG.drumR + 0.012;
    for (const [a, b] of [[drumEdge, -pH], [pH, X]]) {
      for (const z of SPEED) { wall('f', front, a, b, z - 0.003, z, paint(SHADE_RGB), 1); wall('f', front, a, b, z, z + 0.008, paint(COPE_RGB), 1.5); }
    }
    for (let i = 1; i < 3; i++) {
      ribbon(k, 'f', front, drumEdge + 0.014, -pH - 0.014, FLOORS[i][0], FLOORS[i][1], 3, seed + 21 + i);
      ribbon(k, 'f', front, pH + 0.014, X - 0.03, FLOORS[i][0], FLOORS[i][1], 7, seed + 31 + i, i === 2 ? 2 : -1);
    }
    // The ground floor is glass from the plinth up, and the monitors stand behind it. Each of them
    // shows a ground: a pitch or a sheet of ice.
    {
      const a = pH + 0.014, b = X - 0.03, z0 = LOT.BAND_Z1 + 0.012, z1 = 0.158;
      wall('f', front, a - 0.006, b + 0.006, z0 - 0.006, z1 + 0.006, paint(FRAME), 1);
      wall('f', front, a, b, z0, z1, k.glass(0.55, [190, 214, 228]), 2);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
        const u = a + 0.02 + i * 0.044, z = z0 + 0.024 + j * 0.042, col = (i + j) % 2 ? [168, 206, 226] : [96, 168, 110];
        wall('f', front, u, u + 0.036, z, z + 0.034, mixRgb(mixRgb(col, [40, 56, 62], 0.45), col, dn), 3);
      }
      for (let i = 1; i < 5; i++) wall('f', front, a + (b - a) * i / 5 - 0.0015, a + (b - a) * i / 5 + 0.0015, z0, z1, paint(FRAME), 4);
      // The marquee over the glass: a lit box along the head of it, on two brackets.
      const mz0 = 0.163, mz1 = 0.191, my = front + 0.022;
      B((a + b) / 2, front + 0.011, (b - a) / 2, 0.011, mz0, mz1, PLANT, true, 6);
      k.wall('f', my - FACE_EPS * 1.2, a + 0.004, b - 0.004, mz0 + 0.003, mz1 - 0.003, mixRgb([34, 44, 50], [226, 246, 250], dn), 1.2);
      k.word('f', my, a + 0.02, b - 0.02, mz0 + 0.005, mz1 - 0.005, m.marquee, dn > 0.3 ? '#123038' : '#39d6ff', false, 2);
      if (dn > 0) { const [gx, gy] = F((a + b) / 2, front + 0.05); glowPool(ctx, cam, gx, gy, 0.12, '190,226,240', 15, alpha * 0.5 * dn); }
    }
    // The left of the door, the lounge's plain glass as far as the drum.
    {
      const a = drumEdge + 0.014, b = -pH - 0.014, z0 = LOT.BAND_Z1 + 0.012, z1 = 0.17;
      wall('f', front, a - 0.006, b + 0.006, z0 - 0.006, z1 + 0.006, paint(FRAME), 1);
      wall('f', front, a, b, z0, z1, k.glass(0.75), 2);
      wall('f', front, (a + b) / 2 - 0.0015, (a + b) / 2 + 0.0015, z0, z1, paint(FRAME), 3);
    }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: 0, y: pF, w: 0.056, top: 0.128, leaves: 2, frame: [168, 172, 170],
      lobby: { day: [56, 68, 76], night: [236, 214, 170] },
      transom: { hh: 0.014, day: [70, 84, 90], night: [214, 236, 230] },
      canopy: { out: 0.062, half: pH + 0.008, hh: 0.005, pal: COPE, strip: '90,220,255' },
      lamp: '255,226,170', frontVis,
    });
    // The name, once, over the canopy in raised letters with a shaded return.
    {
      const z0 = 0.205, z1 = 0.285, hw = 0.092;
      k.word('f', pF - FACE_EPS, -hw + 0.002, hw + 0.002, z0 - 0.002, z1 - 0.002, m.nameplate, '#6c6656', false, 2);
      k.word('f', pF, -hw, hw, z0, z1, m.nameplate, dn > 0.3 ? '#78ecff' : '#0e5f7e', dn > 0.3, 3);
      if (dn > 0) { const [gx, gy] = F(0, pF + 0.04); glowPool(ctx, cam, gx, gy, (z0 + z1) / 2, '90,220,255', 14, alpha * 0.4 * dn); }
    }
    // Three speed lines up the pier, either side of the top ribbon's line.
    for (const u of [-0.07, 0, 0.07]) wall('f', pF, u - 0.003, u + 0.003, 0.30, ROOF + 0.04, paint(COPE_RGB), 1.5);

    // ── THE STAIR DRUM: glass block from the plinth to over the roof, on the court corner.
    {
      const [sx, sy] = F(WG.drumX, WG.drumY), R = WG.drumR, top = WG.drumTop;
      const block = dn > 0.3 ? [244, 226, 186] : [168, 192, 196];
      const blockS = litStyle((f) => { const s = 0.66 + f.nl * 0.34; return rgb(block.map((v) => v * s * (dn > 0.3 ? 1 : dusk))); }, block, 'frost');
      const plainS = litStyle((f) => { const s = 0.58 + f.nl * 0.42; return rgb(RENDER_RGB.map((v) => v * s * dusk)); }, RENDER_RGB, 'plain');
      const copeS = litStyle((f) => { const s = 0.6 + f.nl * 0.4; return rgb(COPE_RGB.map((v) => v * s * dusk)); }, COPE_RGB, 'plain');
      drawFacetDrum(ctx, cam, sx, sy, 0, LOT.PLINTH_H, R + 0.006, R + 0.006, 16, alpha, plainS, null, PLINTH);
      drawFacetDrum(ctx, cam, sx, sy, LOT.PLINTH_H, top, R, R, 16, alpha, blockS, null, 'ty_clone_wall');
      drawFacetDrum(ctx, cam, sx, sy, top, top + LOT.COPE_Z, R + 0.008, R + 0.008, 16, alpha, copeS, rgb(COPE_RGB), COPE);
      // The courses of the block, and the band carried round the foot.
      if (nearOrMesh()) for (let z = LOT.PLINTH_H + 0.02; z < top - 0.01; z += 0.024) frontRing(ctx, cam, sx, sy, z, R + 0.0008, 16, dn > 0.3 ? 'rgba(170,140,96,0.5)' : 'rgba(96,110,116,0.55)', 1, alpha);
      frontRing(ctx, cam, sx, sy, (LOT.BAND_Z0 + LOT.BAND_Z1) / 2, R + 0.007, 16, dn > 0.3 ? 'rgba(132,238,255,0.95)' : 'rgba(57,214,255,0.9)', 2.4, alpha);
      if (dn > 0) glowPool(ctx, cam, sx, sy, top * 0.6, '255,226,176', 20, alpha * 0.34 * dn);
    }

    // ── THE ROOF: the lift overrun, condensers, and the link mast for the grounds' feeds.
    B(0.22, -0.16, 0.10, 0.07, ROOF, ROOF + 0.09, RENDER, true, 7);
    B(0.22, -0.16, 0.106, 0.076, ROOF + 0.09, ROOF + 0.09 + LOT.COPE_Z, COPE, true, 8);
    for (const [x, y] of [[-0.14, -0.24], [-0.02, -0.24]]) B(x, y, 0.045, 0.03, ROOF, ROOF + 0.05, PLANT, true, 9);
    { const [ax, ay] = F(0.32, 0.14);
      emitWire(ctx, cam, [ax, ay, ROOF], [ax, ay, ROOF + 0.34], 1.6, 'rgba(150,160,170,0.8)', alpha, { pull: DECO_PULL });
      dish(ctx, cam, ax, ay, ROOF + 0.20, 7, alpha);
      blinkLight(ctx, cam, ax, ay, ROOF + 0.34, '255,80,80', now, seed + 3, alpha, 1.2); }
    // The lamp on the top floor, whatever the hour.
    { const [gx, gy] = F(pH + 0.09, front + 0.03); glowPool(ctx, cam, gx, gy, FLOORS[2][1] - 0.04, '255,214,150', 8, alpha * (night ? 0.55 : 0.12)); }
  },

  lot_paper(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // The Coldwater Sentinel: render and black glass, the press behind tall windows on Marrow Street
    const k = kit(ctx, cam, F, W3, E, seed, night, alpha), { B, wall, poly, paint, dn } = k;
    const X = FACE, Y = SN.hy;
    B(0, 0, X + 0.006, Y + 0.006, 0, LOT.PLINTH_H, PLINTH, true, 1);
    B(0, 0, X, Y, LOT.PLINTH_H, ROOF, RENDER, true, 2);
    parapet(k, 0, 0, X, Y);
    // ── MARROW STREET: the press hall's tall windows, the black glass with the clock in it, and the
    // masthead across the parapet. ⚠ THE PAPER HAS NO STREET DOOR SINCE THE BLOCK CLOSED, and the
    // lot's wall covers the street front to LOT.WALL_H, so it all stands over the wall.
    footing(k, 'b', Y, -X, X);
    {
      const z0 = LOT.TICKER_Z1 + 0.024, z1 = 0.535, [a, b] = SN.lights, n = 5, w = (b - a) / n;
      // The press, a train of drums on one line, behind the tall lights. It runs through the night
      // for the morning paper, so it's after dark that it shows, dark against the lit hall.
      wall('b', Y, a - 0.012, b + 0.012, z0 - 0.012, z1 + 0.012, VITROLITE, 1);
      for (let i = 0; i < n; i++) {
        const u0 = a + w * i + 0.006, u1 = u0 + w - 0.012;
        wall('b', Y, u0, u1, z0, z1, mixRgb([20, 24, 28], [255, 200, 128], dn * 0.92), 2);
        for (const z of [z0 + 0.11, z0 + 0.22]) wall('b', Y, u0, u1, z, z + 0.004, paint(FRAME), 4);
        wall('b', Y, (u0 + u1) / 2 - 0.0016, (u0 + u1) / 2 + 0.0016, z0, z1, paint(FRAME), 4);
      }
      const drums = 7, r = 0.036, dz = z0 + 0.07;
      for (let i = 0; i < drums; i++) {
        const c = a + 0.03 + (b - a - 0.06) * i / (drums - 1), ring = [];
        for (let j = 0; j < 12; j++) { const t = j / 12 * Math.PI * 2; ring.push([c + Math.cos(t) * r, dz + Math.sin(t) * r]); }
        poly('b', Y, ring, mixRgb([30, 34, 38], [46, 34, 24], dn), 3);
      }
      wall('b', Y, a, b, dz - r - 0.018, dz - r - 0.010, mixRgb([30, 34, 38], [46, 34, 24], dn), 3);
      if (dn > 0) { const [gx, gy] = F((a + b) / -2, -Y - 0.05); glowPool(ctx, cam, gx, gy, 0.36, '255,200,128', 30, alpha * 0.42 * dn); }
    }
    // The ticker's housing, on the wall's top line: a black screen in a steel box, its two end caps
    // standing proud to take the letters in and out. Only the letters move, and they're the lot's
    // (the `ticker` part of drawMediaLot), so this arm stays kept.
    {
      const hw = LOT.TICKER_HW, o = LOT.TICKER_OUT, z0 = LOT.TICKER_Z0, z1 = LOT.TICKER_Z1, cap = 0.02;
      B(0, -Y - o / 2, hw + 0.012, o / 2, z0 - 0.006, z1 + 0.006, PLANT, true, 7);
      wall('b', Y + o, -hw, hw, z0, z1, [10, 8, 6], 1);
      wall('b', Y + o, -hw, hw, z0 + 0.002, z0 + 0.004, mixRgb([70, 44, 14], [180, 112, 34], dn), 1.5);
      wall('b', Y + o, -hw, hw, z1 - 0.004, z1 - 0.002, mixRgb([70, 44, 14], [180, 112, 34], dn), 1.5);
      for (const s of [-1, 1]) B(s * (hw + 0.012 - cap / 2), -Y - o / 2 - 0.003, cap / 2 + 0.002, o / 2 + 0.003, z0 - 0.008, z1 + 0.008, COPE, true, 8 + s);
      if (dn > 0) { const [gx, gy] = F(0, -Y - 0.05); glowPool(ctx, cam, gx, gy, (z0 + z1) / 2, '255,184,58', 24, alpha * 0.3 * dn); }
    }
    // The black glass beside the press, chrome-edged, with the clock on it. ⚠ THE HANDS ARE STOPPED
    // AT FIVE TO MIDNIGHT, the paper's own joke: a clock with moving hands is a moving part (§4.5).
    {
      const a = SN.lights[1] + 0.03, b = X - 0.03, z0 = LOT.TICKER_Z1 + 0.012, z1 = 0.547, c = SN.clockU, cz = SN.clockZ, R = SN.clockR;
      wall('b', Y, a, b, z0, z1, VITROLITE, 1);
      for (const z of [z0 + 0.09, z0 + 0.094]) wall('b', Y, a, b, z, z + 0.002, paint([170, 176, 180]), 2);
      const disc = (r) => { const p = []; for (let j = 0; j < 20; j++) { const t = j / 20 * Math.PI * 2; p.push([c + Math.cos(t) * r, cz + Math.sin(t) * r]); } return p; };
      poly('b', Y, disc(R + 0.006), paint([190, 150, 76]), 2);
      poly('b', Y, disc(R), mixRgb(paint([226, 220, 202]), [255, 236, 196], dn), 3);
      for (let i = 0; i < 12; i++) {
        const t = i / 12 * Math.PI * 2, s = Math.sin(t), q = Math.cos(t), r0 = R * 0.80, r1 = R * 0.94, hw = 0.0022;
        poly('b', Y, [[c + s * r0 - q * hw, cz + q * r0 + s * hw], [c + s * r1 - q * hw, cz + q * r1 + s * hw], [c + s * r1 + q * hw, cz + q * r1 - s * hw], [c + s * r0 + q * hw, cz + q * r0 - s * hw]], [36, 34, 30], 4);
      }
      const hand = (ang, len, hw) => {
        const s = Math.sin(ang), q = Math.cos(ang);
        poly('b', Y, [[c - q * hw, cz + s * hw], [c + s * len, cz + q * len], [c + q * hw, cz - s * hw]], [24, 24, 22], 5);
      };
      hand(-Math.PI / 6 * 0.1, R * 0.60, 0.006);   // the hour, a little before twelve
      hand(-Math.PI / 6, R * 0.86, 0.004);         // the minute, at the eleven
      if (dn > 0) { const [gx, gy] = F(-c, -Y - 0.03); glowPool(ctx, cam, gx, gy, cz, '255,226,170', 12, alpha * 0.4 * dn); }
    }
    // The masthead, the paper's own gilt hand on the black band under the coping. The paper's, so it
    // isn't the lot's block face and it isn't the lot's cyan.
    wall('b', Y, -X + 0.012, X - 0.012, ROOF - 0.048, ROOF - 0.006, VITROLITE, 1);
    k.word('b', Y - FACE_EPS, -X + 0.04 + 0.002, X - 0.04 + 0.002, ROOF - 0.044 - 0.002, ROOF - 0.01 - 0.002, m.masthead, GILT_SHADOW, false, 2.2, 'deco');
    k.word('b', Y, -X + 0.04, X - 0.04, ROOF - 0.044, ROOF - 0.01, m.masthead, GILT, dn > 0.3, 3, 'deco');
    if (dn > 0) { const [gx, gy] = F(0, -Y - 0.04); glowPool(ctx, cam, gx, gy, ROOF - 0.03, '232,190,110', 22, alpha * 0.3 * dn); }

    // ── THE SIDES: the upper floors' ribbons, over the lot's wall on the east and the slot on the west.
    for (const side of ['l', 'r']) {
      footing(k, side, X, -Y, Y);
      speedLines(k, side, X, -Y, Y);
      for (let i = 1; i < 3; i++) ribbon(k, side, X, -Y + 0.05, Y - 0.05, FLOORS[i][0], FLOORS[i][1], 9, seed + (side === 'l' ? 40 : 50) + i);
    }
    // ── THE CAR PARK: where the paper's work goes in and out. The door by the dock under its lamp,
    // the wired window with the feed screens in it, the shutter over the dock.
    footing(k, 'f', Y, -X, X);
    speedLines(k, 'f', Y, -X, X);
    for (let i = 1; i < 3; i++) ribbon(k, 'f', Y, -X + 0.05, X - 0.05, FLOORS[i][0], FLOORS[i][1], 10, seed + 60 + i);
    { // The shutter, at the dock's height, sized off the dock phase 1 drew.
      const a = LOT.DOCK_X0 + 0.012, b = LOT.DOCK_X1 - 0.012, z0 = LOT.DOCK_Z, z1 = 0.186;
      wall('f', Y, a - 0.01, b + 0.01, z0, z1 + 0.012, paint(FRAME), 1);
      wall('f', Y, a, b, z0, z1, paint(STEEL), 2);
      for (let z = z0 + 0.008; z < z1; z += 0.01) wall('f', Y, a, b, z, z + 0.0016, paint([82, 88, 94]), 3);
      B((a + b) / 2, Y + 0.012, (b - a) / 2 + 0.012, 0.012, z1 + 0.012, z1 + 0.03, PLINTH, true, 3);   // the box the shutter rolls up into
    }
    drawEntrance(ctx, cam, F, W3, E, seed, night, alpha, {
      x: SN.doorX, y: Y, w: 0.05, top: 0.128, leaves: 1, frame: [84, 90, 96],
      solid: { fill: [72, 78, 82], planks: 0, handle: [150, 146, 132], crack: '255,214,150' },
      lamp: '255,214,150', lampDay: 0.2, frontVis,
    });
    k.word('f', Y, SN.doorX - 0.042, SN.doorX + 0.042, 0.064, 0.086, m.stencil, '#d8d2bc', false, 4, 'stencil');
    { // The wired window, and the feed screens through it.
      const a = -0.385, b = -0.30, z0 = 0.066, z1 = 0.158;
      wall('f', Y, a - 0.008, b + 0.008, z0 - 0.008, z1 + 0.008, paint(FRAME), 1);
      wall('f', Y, a, b, z0, z1, k.glass(0.4, [150, 196, 214]), 2);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) wall('f', Y, a + 0.008 + i * 0.038, a + 0.038 + i * 0.038, z0 + 0.008 + j * 0.028, z0 + 0.030 + j * 0.028, mixRgb([44, 74, 82], [176, 226, 240], dn), 3);
      for (let i = 1; i < 4; i++) wall('f', Y, a + (b - a) * i / 4 - 0.0007, a + (b - a) * i / 4 + 0.0007, z0, z1, paint(FRAME), 4);
      for (let i = 1; i < 5; i++) wall('f', Y, a, b, z0 + (z1 - z0) * i / 5 - 0.0007, z0 + (z1 - z0) * i / 5 + 0.0007, paint(FRAME), 4);
    }
    // ── THE ROOF: plant, and the wire room's mast.
    B(-0.20, 0.14, 0.11, 0.075, ROOF, ROOF + 0.08, RENDER, true, 4);
    B(-0.20, 0.14, 0.116, 0.081, ROOF + 0.08, ROOF + 0.08 + LOT.COPE_Z, COPE, true, 5);
    for (const [x, y] of [[0.12, 0.20], [0.26, 0.20]]) B(x, y, 0.05, 0.03, ROOF, ROOF + 0.05, PLANT, true, 6);
    { const [ax, ay] = F(0.20, -0.10);
      emitWire(ctx, cam, [ax, ay, ROOF], [ax, ay, ROOF + 0.30], 1.5, 'rgba(150,160,170,0.8)', alpha, { pull: DECO_PULL });
      blinkLight(ctx, cam, ax, ay, ROOF + 0.30, '255,196,120', now, seed + 3, alpha, 1.4); }
  },
};
