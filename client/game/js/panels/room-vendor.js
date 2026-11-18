// ROOM · A VENDING MACHINE YOU CAN PULL OUT FROM THE WALL (a piece of form `vendor`, plugins/vending `nudge`). A steel
// cabinet with bevelled corners, a lit window of pouches on their coils, a row of flavour buttons that go in when
// pressed, a coin slot and a card reader, a dispensing tray and a kick plate, and the brand across its head. Behind
// it, a soft cable to a socket in the wall. The server says where it stands, whether it's plugged in and what it
// sells (`vend` on the piece, off room.pieceState: { out, plugged, menu: [{ item, label, price, tint }], title, sub });
// this eases the machine out or home, the plug in or out, and a button down and up again.
//
// It decides nothing. A button is `vend <machine> <item>`, the cable is `unplug`/`plug`, pulling it out is `nudge`,
// all typed verbs; the machine is drawn into the locks layer (gl/room.js setLocks), which room-stage.js shares with
// the door leaves, because a moving thing can't be in the room's baked mesh. Its lettering is painted on canvases and
// laid on its front as decals, moved with it.
//
// ⚠ NOTHING HERE NAMES A BRAND. The words and colours come from the furniture row (`look.label`, `look.sub`,
// `look.tint`, each menu entry's `label` and `tint`).
import { vtx, lin, MAT } from './gl/ballpark-mesh.js';
import { facing } from '../../../shared/room-layout.js';
import { loadFont } from './room-marks.js';

const { GLOSS, SATIN, METAL, MATTE } = MAT;
const GLOW = 40;
const SLIDE = 0.6, SLIDE_MS = 900, PLUG_MS = 700, PRESS_MS = 320, PRESS_D = 0.013;
const REACH = 2.6;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const C = (hex, k = 1) => lin(hex).map((c) => c * k);
const hexOk = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);

// where things are on the front, metres in the machine's frame: X to your right as you face it, Y up, Z out of its front
const WIN = { x0: -0.44, x1: 0.2, y0: 0.72, y1: 1.5 };
const SIDE = { x0: 0.26, x1: 0.46, y0: 0.78, y1: 1.5 };
const BTN = { x0: -0.44, x1: 0.44, y: 0.54, w: 0.096, h: 0.062 };
const STRIP = { y0: 0.6, y1: 0.655 };
const HEAD = { y0: 1.56, y1: 1.82 };
const TRAY = { x0: -0.3, x1: 0.3, y0: 0.18, y1: 0.4 };
const CABLE_AT = [0.3, 0.25], SOCKET = [0.32, 0.31];

/** The vending machines of one open Stage. */
export function createRoomVendor({ project }) {
  let L = null, ver = 0, dirty = true, fontsWanted = false;
  let batch = { data: new Float32Array(0), n: 0 }, decals = [];
  const st = new Map();   // piece id -> { slide: {from,to,t0}, plug: {from,to,t0}, press: Map(item -> t) }
  const canvases = new Map();
  const pieces = () => (L?.placed || []).filter((p) => p.form === 'vendor');
  const done = new WeakSet();

  function anim(a, now, ms) { return a.from + (a.to - a.from) * ease((now - a.t0) / ms); }
  function load(Lnew) {
    L = Lnew;
    const now = performance.now();
    for (const p of pieces()) {
      const v = p.vend || {}, out = v.out ? 1 : 0, lit = v.plugged === false ? 0 : 1;
      let s = st.get(p.id);
      if (!s) { s = { slide: { from: out, to: out, t0: 0 }, plug: { from: lit, to: lit, t0: 0 }, press: new Map() }; st.set(p.id, s); }
      if (s.slide.to !== out) s.slide = { from: anim(s.slide, now, SLIDE_MS), to: out, t0: now };
      if (s.plug.to !== lit) s.plug = { from: anim(s.plug, now, PLUG_MS), to: lit, t0: now };
      // pulled out, the machine stands further into the room: nobody walks through it, and its card is in reach
      if (out && L && !done.has(L)) {
        const [fu, fv] = facing(p.turn), su = -fv, sv = fu, hw = p.w / 2, hd = p.d / 2;
        const pts = [[-hw, hd], [hw, hd], [-hw, hd + SLIDE], [hw, hd + SLIDE]].map(([x, z]) => [p.u + su * x + fu * z, p.v + sv * x + fv * z]);
        L.solid?.push([Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))]);
        for (const s2 of L.stations || []) if (s2.piece === p.id) { s2.u += fu * SLIDE; s2.v += fv * SLIDE; }
      }
    }
    if (L) done.add(L);
    if (!fontsWanted && pieces().length) {
      fontsWanted = true;
      Promise.all(['Staatliches', 'Michroma', 'Geist', 'Doto'].map(loadFont)).then(() => { canvases.clear(); dirty = true; });
    }
    dirty = true; ver++;
  }

  function moving(now = performance.now()) {
    for (const s of st.values()) {
      if (now - s.slide.t0 < SLIDE_MS + 50 || now - s.plug.t0 < PLUG_MS + 50) return true;
      for (const t of s.press.values()) if (now - t < PRESS_MS + 50) return true;
    }
    return false;
  }

  // ── the frame of one piece, slid out `s` metres ──
  function frameOf(p, s) {
    const [fu, fv] = facing(p.turn), su = -fv, sv = fu, base = p.y0 || 0;
    const o = L.world(0, 0, 0), eu = L.world(1, 0, 0), ey = L.world(0, 0, 1), ev = L.world(0, 1, 0);
    const W = (X, Y, Z) => L.world(p.u - su * X + fu * (Z + s), p.v - sv * X + fv * (Z + s), base + Y);
    const N = (nx, ny, nz) => {
      const du = -su * nx + fu * nz, dv = -sv * nx + fv * nz;
      return [0, 1, 2].map((i) => (eu[i] - o[i]) * du + (ey[i] - o[i]) * ny + (ev[i] - o[i]) * dv);
    };
    return { W, N };
  }

  function build(now) {
    const b = { data: new Float32Array(4096 * 12), n: 0 };
    const out = [];
    for (const p of pieces()) {
      const s = st.get(p.id);
      if (!s) continue;
      const k = anim(s.slide, now, SLIDE_MS), lit = anim(s.plug, now, PLUG_MS);
      drawMachine(b, p, k * SLIDE, lit, s, now);
      out.push(...decalsOf(p, k * SLIDE, lit > 0.5));
    }
    batch = b; decals = out;
  }

  // ── geometry ──
  function drawMachine(b, p, slide, lit, s, now) {
    const v = p.vend || {}, menu = v.menu || [];
    const F = frameOf(p, slide), F0 = frameOf(p, 0);
    const hw = Math.min(0.5, p.w / 2), hd = p.d / 2, H = Math.min(1.95, p.h);
    const quad = (Fr, ps, n, col0, mat) => { const col = typeof col0 === 'string' ? C(col0) : col0, P = ps.map((q) => Fr.W(...q)), Nn = Fr.N(...n); for (const i of [0, 1, 2, 0, 2, 3]) vtx(b, P[i], Nn, [0, 0], col, mat); };
    const box = (x0, x1, y0, y1, z0, z1, col, mat, Fr = F) => {
      quad(Fr, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], col, mat);
      quad(Fr, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], col, mat);
      quad(Fr, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], col, mat);
      quad(Fr, [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [0, -1, 0], col, mat);
      quad(Fr, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], col, mat);
      quad(Fr, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], col, mat);
    };
    // a prism with its four upright edges chamfered by `c`: the cabinet's bevels
    const prism = (x0, x1, z0, z1, y0, y1, c, col, mat, capCol = col) => {
      const ring = [[x0 + c, z1], [x1 - c, z1], [x1, z1 - c], [x1, z0 + c], [x1 - c, z0], [x0 + c, z0], [x0, z0 + c], [x0, z1 - c]];
      for (let i = 0; i < 8; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 8], nx = bz - az, nz = -(bx - ax), l = Math.hypot(nx, nz) || 1;
        quad(F, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [nx / l, 0, nz / l], col, mat);
      }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      for (let i = 0; i < 8; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 8];
        quad(F, [[cx, y1, cz], [cx, y1, cz], [bx, y1, bz], [ax, y1, az]], [0, 1, 0], capCol, mat);
        quad(F, [[cx, y0, cz], [cx, y0, cz], [ax, y0, az], [bx, y0, bz]], [0, -1, 0], capCol, mat);
      }
    };
    const rod = (A, B, r, col, mat) => {
      const f = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], fl = Math.hypot(...f) || 1, fn = f.map((x) => x / fl);
      const up = Math.abs(fn[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const sx = [fn[1] * up[2] - fn[2] * up[1], fn[2] * up[0] - fn[0] * up[2], fn[0] * up[1] - fn[1] * up[0]], sl = Math.hypot(...sx) || 1, sN = sx.map((x) => x / sl);
      const uN = [fn[1] * sN[2] - fn[2] * sN[1], fn[2] * sN[0] - fn[0] * sN[2], fn[0] * sN[1] - fn[1] * sN[0]];
      const c = (P, i, j) => [P[0] + (sN[0] * i + uN[0] * j) * r, P[1] + (sN[1] * i + uN[1] * j) * r, P[2] + (sN[2] * i + uN[2] * j) * r];
      for (const [i0, j0, i1, j1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
        const n = [0, 1, 2].map((q) => sN[q] * (i0 + i1) / 2 + uN[q] * (j0 + j1) / 2);
        const P = [c(A, i0, j0), c(B, i0, j0), c(B, i1, j1), c(A, i1, j1)];
        for (const q of [0, 1, 2, 0, 2, 3]) vtx(b, P[q], n, [0, 0], col, mat);
      }
    };

    const body = hexOk(v.tint, '#1d5a3c'), trim = '#c9d2cf', dark = '#0d1011', on = lit > 0.5;
    // the plinth and its kick plate in brushed steel
    box(-hw + 0.03, hw - 0.03, 0, 0.12, -hd + 0.03, hd - 0.04, dark, MATTE);
    box(-hw + 0.05, hw - 0.05, 0.015, 0.105, hd - 0.045, hd - 0.035, '#9aa2a6', METAL);
    for (let i = 0; i < 9; i++) { const x = -hw + 0.1 + i * (2 * hw - 0.2) / 8; box(x - 0.004, x + 0.004, 0.03, 0.09, hd - 0.035, hd - 0.031, '#5d6467', METAL); }
    // the cabinet: a bevelled shell, its top cap in bright trim, a band down each side
    prism(-hw, hw, -hd, hd - 0.02, 0.12, H - 0.08, 0.035, body, SATIN);
    prism(-hw - 0.008, hw + 0.008, -hd - 0.008, hd - 0.012, H - 0.08, H, 0.05, trim, METAL);
    for (const sd of [-1, 1]) box(sd * hw - 0.002, sd * hw + 0.002, 0.2, H - 0.12, -hd + 0.1, hd - 0.1, trim, METAL);
    // the head, where the brand is: a recessed panel lit from behind, framed in trim
    // dark under the sign: a glow decal only ADDS light, so a lit panel behind it washes the lettering out white
    box(-hw + 0.03, hw - 0.03, HEAD.y0, HEAD.y1, hd - 0.02, hd - 0.005, on ? '#04140d' : '#0a100d', MATTE);
    // the head's frame down its sides, and a bolt at each corner
    for (const sd of [-1, 1]) box(sd * (hw - 0.02) - 0.012, sd * (hw - 0.02) + 0.012, HEAD.y0 - 0.02, HEAD.y1 + 0.02, hd - 0.02, hd + 0.012, trim, METAL);
    for (const sx of [-1, 1]) for (const y of [HEAD.y0 - 0.01, HEAD.y1 + 0.01]) box(sx * (hw - 0.02) - 0.006, sx * (hw - 0.02) + 0.006, y - 0.006, y + 0.006, hd + 0.012, hd + 0.018, '#7c8488', METAL);
    box(-hw + 0.02, hw - 0.02, HEAD.y0 - 0.02, HEAD.y0, hd - 0.02, hd + 0.012, trim, METAL);
    box(-hw + 0.02, hw - 0.02, HEAD.y1, HEAD.y1 + 0.02, hd - 0.02, hd + 0.012, trim, METAL);

    // THE WINDOW: a recess lit from its back, four shelves of pouches on their coils, the glass's frame and a glint
    const zb = hd - 0.32, zf = hd - 0.02;
    box(WIN.x0, WIN.x1, WIN.y0, WIN.y1, zb - 0.01, zb, C(on ? '#effff6' : '#141a18', on ? 1.25 : 1), on ? GLOW : MATTE);
    box(WIN.x0 - 0.01, WIN.x0, WIN.y0, WIN.y1, zb, zf, '#2a3330', SATIN);
    box(WIN.x1, WIN.x1 + 0.01, WIN.y0, WIN.y1, zb, zf, '#2a3330', SATIN);
    box(WIN.x0, WIN.x1, WIN.y1 - 0.012, WIN.y1, zb, zf, C(on ? '#ffffff' : '#30383a', on ? 1.6 : 1), on ? GLOW : SATIN);
    const rows = 4, cols = 4, cw = (WIN.x1 - WIN.x0) / cols, rh = (WIN.y1 - WIN.y0 - 0.03) / rows;
    for (let r = 0; r < rows; r++) {
      const y = WIN.y0 + 0.01 + r * rh;
      box(WIN.x0, WIN.x1, y - 0.008, y, zb, zf - 0.01, '#b9c2c6', METAL);
      box(WIN.x0, WIN.x1, y, y + 0.022, zf - 0.03, zf - 0.025, '#e8ecee', SATIN);
      for (let c = 0; c < cols; c++) {
        const m = menu.length ? menu[(r * cols + c) % menu.length] : null, tint = hexOk(m?.tint, '#c9ccd2');
        const x = WIN.x0 + (c + 0.5) * cw;
        // the coil, a spring of wire running back from the front
        const turns = 5, A = [];
        for (let i = 0; i <= turns * 6; i++) { const a = i / 6 * Math.PI * 2, z = zf - 0.05 - (i / (turns * 6)) * 0.24; A.push(F.W(x + Math.cos(a) * 0.055, y + 0.065 + Math.sin(a) * 0.055, z)); }
        for (let i = 0; i < A.length - 1; i++) rod(A[i], A[i + 1], 0.0025, C('#d7dde0'), METAL);
        // two pouches in it, the front one with its label and its straw
        for (const [dz, kk] of [[0.06, 1], [0.15, 0.82]]) {
          const z = zf - dz;
          box(x - 0.05, x + 0.05, y + 0.012, y + 0.13, z - 0.016, z + 0.016, tint, GLOSS, F);
          box(x - 0.04, x + 0.04, y + 0.13, y + 0.15, z - 0.01, z + 0.01, tint, GLOSS, F);
          if (kk === 1) {
            box(x - 0.032, x + 0.032, y + 0.05, y + 0.1, z + 0.016, z + 0.019, '#f4f1e8', MATTE, F);
            rod(F.W(x + 0.03, y + 0.13, z + 0.018), F.W(x + 0.034, y + 0.185, z + 0.018), 0.003, C('#f5f5f5'), SATIN);
          }
        }
      }
    }
    // the frame round the glass, and the glint across it
    box(WIN.x0 - 0.025, WIN.x1 + 0.025, WIN.y0 - 0.025, WIN.y0, zf - 0.005, hd + 0.01, trim, METAL);
    box(WIN.x0 - 0.025, WIN.x1 + 0.025, WIN.y1, WIN.y1 + 0.025, zf - 0.005, hd + 0.01, trim, METAL);
    box(WIN.x0 - 0.025, WIN.x0, WIN.y0, WIN.y1, zf - 0.005, hd + 0.01, trim, METAL);
    box(WIN.x1, WIN.x1 + 0.025, WIN.y0, WIN.y1, zf - 0.005, hd + 0.01, trim, METAL);
    for (const [x, w] of [[WIN.x0 + 0.12, 0.012], [WIN.x0 + 0.16, 0.005], [WIN.x1 - 0.18, 0.008]]) {
      quad(F, [[x, WIN.y0 + 0.02, zf], [x + w, WIN.y0 + 0.02, zf], [x + w + 0.18, WIN.y1 - 0.02, zf], [x + 0.18, WIN.y1 - 0.02, zf]], [0, 0, 1], C('#e6f2f0', 0.55), GLOSS);
    }

    // THE SIDE PANEL: a display, the coin slot, the card reader and the speaker (the words are its decal)
    box(SIDE.x0, SIDE.x1, SIDE.y0, SIDE.y1, hd - 0.02, hd, '#121516', SATIN);
    box(SIDE.x0 + 0.02, SIDE.x1 - 0.02, 1.38, 1.47, hd, hd + 0.004, on ? '#06140c' : '#050606', GLOSS);
    box(SIDE.x0 + 0.05, SIDE.x1 - 0.05, 1.24, 1.32, hd, hd + 0.012, '#b8c0c4', METAL);
    box(SIDE.x0 + 0.085, SIDE.x1 - 0.085, 1.265, 1.295, hd + 0.012, hd + 0.014, '#050505', MATTE);
    box(SIDE.x0 + 0.04, SIDE.x1 - 0.04, 1.04, 1.14, hd, hd + 0.02, '#1e2326', GLOSS);
    box(SIDE.x0 + 0.06, SIDE.x1 - 0.06, 1.12, 1.125, hd + 0.02, hd + 0.022, '#050505', MATTE);
    box(SIDE.x1 - 0.065, SIDE.x1 - 0.05, 1.06, 1.075, hd + 0.02, hd + 0.025, C(on ? '#5aff8a' : '#203024', on ? 1.6 : 1), on ? GLOW : SATIN);
    box(SIDE.x0 + 0.13, SIDE.x1 - 0.035, 1.205, 1.225, hd, hd + 0.016, '#9aa2a6', METAL);   // the coin-return lever
    for (const sd of [-1, 1]) for (let i = 0; i < 7; i++) { const y = 1.2 + i * 0.03; box(sd * (hw + 0.001) - 0.0015, sd * (hw + 0.001) + 0.0015, y, y + 0.012, -hd + 0.06, -hd + 0.3, '#050606', MATTE); }   // vents on each flank
    for (let i = 0; i < 5; i++) { const y = 0.82 + i * 0.022; box(SIDE.x0 + 0.04, SIDE.x1 - 0.04, y, y + 0.008, hd - 0.002, hd + 0.002, '#050606', MATTE); }

    // THE BUTTONS: a dark plate, a cap in each flavour's colour, pressed in for a moment when pushed
    box(BTN.x0 - 0.02, BTN.x1 + 0.02, 0.47, STRIP.y1 + 0.01, hd - 0.02, hd - 0.004, '#0b0d0e', GLOSS);
    const n = Math.max(1, menu.length), pitch = (BTN.x1 - BTN.x0) / n;
    menu.forEach((m, i) => {
      const x = BTN.x0 + (i + 0.5) * pitch, t = s.press.get(m.item), k = t == null ? 0 : Math.sin(Math.PI * Math.min(1, Math.max(0, (now - t) / PRESS_MS)));
      const depth = PRESS_D * k, tint = hexOk(m.tint, '#c9ccd2');
      box(x - BTN.w / 2 - 0.008, x + BTN.w / 2 + 0.008, BTN.y - BTN.h / 2 - 0.008, BTN.y + BTN.h / 2 + 0.008, hd - 0.004, hd + 0.004, trim, METAL);
      box(x - BTN.w / 2, x + BTN.w / 2, BTN.y - BTN.h / 2, BTN.y + BTN.h / 2, hd - 0.004, hd + 0.02 - depth, C(tint, on ? 0.85 : 0.55), on ? GLOW : SATIN);
      box(x - BTN.w / 2 + 0.006, x + BTN.w / 2 - 0.006, BTN.y + BTN.h / 2 - 0.012, BTN.y + BTN.h / 2 - 0.006, hd + 0.02 - depth, hd + 0.022 - depth, C('#ffffff', on ? 0.9 : 0.4), GLOSS);
    });

    // THE TRAY: an opening in a trim frame, dark inside, a smoked flap hung from its top
    box(TRAY.x0, TRAY.x1, TRAY.y0, TRAY.y1, hd - 0.2, hd - 0.19, '#050606', MATTE);
    box(TRAY.x0, TRAY.x1, TRAY.y0, TRAY.y0 + 0.01, hd - 0.2, hd - 0.02, '#1a1d1e', MATTE);
    box(TRAY.x0 - 0.03, TRAY.x1 + 0.03, TRAY.y0 - 0.03, TRAY.y0, hd - 0.03, hd + 0.03, trim, METAL);
    box(TRAY.x0 - 0.03, TRAY.x1 + 0.03, TRAY.y1, TRAY.y1 + 0.03, hd - 0.03, hd + 0.01, trim, METAL);
    for (const x of [TRAY.x0 - 0.03, TRAY.x1]) box(x, x + 0.03, TRAY.y0, TRAY.y1, hd - 0.03, hd + 0.01, trim, METAL);
    quad(F, [[TRAY.x0, TRAY.y0 + 0.03, hd - 0.05], [TRAY.x1, TRAY.y0 + 0.03, hd - 0.05], [TRAY.x1, TRAY.y1, hd - 0.005], [TRAY.x0, TRAY.y1, hd - 0.005]], [0, 0.45, 0.9], C('#24302d'), GLOSS);

    box(-0.08, 0.08, TRAY.y1 - 0.045, TRAY.y1 - 0.03, hd - 0.01, hd + 0.012, '#b8c0c4', METAL);   // the flap's pull

    // BEHIND IT: the socket on the wall (it doesn't move), the grommet the cable leaves the machine by, and the cable
    const zw = -hd - 0.02;
    box(SOCKET[0] - 0.045, SOCKET[0] + 0.045, SOCKET[1] - 0.06, SOCKET[1] + 0.06, zw, zw + 0.012, '#eeeae0', SATIN, F0);
    for (const dx of [-0.018, 0.018]) box(SOCKET[0] + dx - 0.004, SOCKET[0] + dx + 0.004, SOCKET[1] - 0.01, SOCKET[1] + 0.012, zw + 0.012, zw + 0.014, '#111111', MATTE, F0);
    box(CABLE_AT[0] - 0.02, CABLE_AT[0] + 0.02, CABLE_AT[1] - 0.02, CABLE_AT[1] + 0.02, -hd - 0.01, -hd, '#111111', MATTE);
    // the plug: in the socket, or lifted out and dropped on the floor beside the machine, in an arc between
    const inP = [SOCKET[0], SOCKET[1], zw + 0.045], restP = [hw + 0.16, 0.03, zw + 0.32];
    const pk = lit, lift = Math.sin(Math.PI * pk) * 0.22;
    const P0 = [restP[0] + (inP[0] - restP[0]) * pk, restP[1] + (inP[1] - restP[1]) * pk + lift, restP[2] + (inP[2] - restP[2]) * pk];
    box(P0[0] - 0.022, P0[0] + 0.022, P0[1] - 0.028, P0[1] + 0.028, P0[2] - 0.033, P0[2] + 0.02, '#e8e6de', SATIN, F0);
    if (pk > 0.98) for (const dx of [-0.018, 0.018]) box(SOCKET[0] + dx - 0.003, SOCKET[0] + dx + 0.003, SOCKET[1] - 0.01, SOCKET[1] + 0.01, zw + 0.012, zw + 0.014, '#c8a24a', METAL, F0);
    else for (const dx of [-0.018, 0.018]) box(P0[0] + dx - 0.003, P0[0] + dx + 0.003, P0[1] - 0.006, P0[1] + 0.006, P0[2] - 0.05, P0[2] - 0.033, '#c8a24a', METAL, F0);
    // the cable: from the grommet (which moves with the machine) to the back of the plug, slack enough to lie on the floor
    const A = [CABLE_AT[0], CABLE_AT[1], -hd + slide - 0.01], B = [P0[0], P0[1], P0[2] + 0.02];
    const d = Math.hypot(B[0] - A[0], B[2] - A[2]), sag = Math.max(0, 1.3 - d);
    const Cn = [(A[0] + B[0]) / 2 + 0.12 + sag * 0.15, Math.min(0.02, (A[1] + B[1]) / 2 - sag), (A[2] + B[2]) / 2];
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      const q = [0, 1, 2].map((j) => u * u * A[j] + 2 * u * t * Cn[j] + t * t * B[j]);
      q[1] = Math.max(0.008, q[1]);
      pts.push(F0.W(...q));
    }
    for (let i = 0; i < pts.length - 1; i++) rod(pts[i], pts[i + 1], 0.007, C('#141414'), SATIN);
  }

  // ── lettering ──
  function canvas(key, w, h, paint) {
    let c = canvases.get(key);
    if (!c && typeof document !== 'undefined') { c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); canvases.set(key, c); }
    return c || null;
  }
  const fitFont = (g, text, face, maxW, size, weight = '') => { let s = size; do { g.font = `${weight} ${s}px "${face}", Geist, Arial, sans-serif`; s -= 2; } while (s > 8 && g.measureText(text).width > maxW); };
  function paintHead(p, on) {
    const v = p.vend || {}, title = String(v.title || p.label || p.name || '').toUpperCase(), sub = String(v.sub || '').toUpperCase(), tint = hexOk(v.tint, '#1d5a3c');
    return canvas(`head:${title}|${sub}|${tint}|${on}`, 1024, 288, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, on ? '#0f5c3a' : '#0c1c15'); gr.addColorStop(1, on ? '#05261a' : '#060c09');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      // a sun coming up behind the name, the oldest trick in food packaging
      g.save(); g.translate(120, 150);
      g.fillStyle = on ? '#ffd35a' : '#4a3e1a';
      for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.fillRect(-6, 58, 12, 34); }
      g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.fill();
      g.fillStyle = on ? '#1a3a28' : '#141a14'; g.beginPath(); g.arc(-17, -8, 6, 0, Math.PI * 2); g.arc(17, -8, 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = g.fillStyle; g.beginPath(); g.arc(0, 6, 24, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
      g.restore();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      fitFont(g, title, 'Staatliches', 760, 150);
      if (on) { g.shadowColor = '#7dffb0'; g.shadowBlur = 14; }
      g.fillStyle = on ? '#eaffd8' : '#5d6b62';
      g.fillText(title, 590, sub ? 118 : 150);
      g.shadowBlur = 0;
      if (sub) {
        g.fillStyle = on ? '#ffd35a' : '#5b5130'; g.fillRect(250, 196, 680, 4);
        fitFont(g, sub, 'Michroma', 680, 44);
        g.fillText(sub, 590, 238);
      }
      g.strokeStyle = on ? '#c9ffe0' : '#2a3a32'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    });
  }
  function paintStrip(p, on) {
    const menu = p.vend?.menu || [];
    return canvas(`strip:${menu.map((m) => m.label + m.price).join()}|${on}`, 1408, 88, (g, w, h) => {
      g.fillStyle = '#0b0d0e'; g.fillRect(0, 0, w, h);
      const cw = w / Math.max(1, menu.length);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      menu.forEach((m, i) => {
        const x = (i + 0.5) * cw;
        g.font = '46px "Michroma", Geist, sans-serif';   // the names are on the caps now; the strip is the price
        g.fillStyle = on ? (m.price ? '#ffd35a' : '#7dffb0') : '#4a504c'; g.fillText(m.price ? `₵${m.price}` : 'FREE', x, h / 2 + 2);
        if (i) { g.fillStyle = '#2a2f31'; g.fillRect(i * cw - 1, 8, 2, h - 16); }
      });
    });
  }
  // a flavour's name on its own cap: dark ink with a pale edge, painted (not glowing) so it reads on any cap colour
  function paintCap(m) {
    const label = String(m.label || '').toUpperCase(), words = label.split(/\s+/).filter(Boolean);
    const half = Math.ceil(words.length / 2), lines = words.length > 1 && label.length > 7 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [label];
    const tint = hexOk(m.tint, '#c9ccd2'), lum = [1, 3, 5].reduce((a, j, k) => a + parseInt(tint.slice(j, j + 2), 16) * [0.3, 0.59, 0.11][k], 0);
    const [ink, edge] = lum > 110 ? ['#111414', 'rgba(255,255,255,0.55)'] : ['#f4f6f2', 'rgba(0,0,0,0.6)'];   // dark on a pale cap, pale on a dark one
    return canvas(`cap:${label}|${tint}`, 256, 160, (g, w, h) => {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach((t, i) => {
        fitFont(g, t, 'Staatliches', w - 20, lines.length > 1 ? 70 : 96);
        const y = lines.length > 1 ? h / 2 + (i ? 34 : -34) : h / 2 + 4;
        g.lineWidth = 8; g.strokeStyle = edge; g.strokeText(t, w / 2, y);
        g.fillStyle = ink; g.fillText(t, w / 2, y);
      });
    });
  }
  function paintSide(on) {
    return canvas(`side:${on}`, 320, 1152, (g, w, h) => {
      g.fillStyle = '#121516'; g.fillRect(0, 0, w, h);
      const y = (m) => (SIDE.y1 - m) / (SIDE.y1 - SIDE.y0) * h;   // metres up to canvas rows
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (on) { g.font = '44px "Doto", "Share Tech Mono", monospace'; g.fillStyle = '#5aff8a'; g.shadowColor = '#5aff8a'; g.shadowBlur = 12; g.fillText('SELECT', w / 2, y(1.425)); g.shadowBlur = 0; }
      g.font = 'bold 26px "Geist", sans-serif'; g.fillStyle = on ? '#cfd6d2' : '#59605c';
      g.fillText('COINS', w / 2, y(1.345)); g.fillText('TAP CARD', w / 2, y(1.165));
      g.font = '22px "Geist", sans-serif'; g.fillText('PUSH TO TAKE', w / 2, y(0.96));
      g.strokeStyle = '#2c3234'; g.lineWidth = 4; g.strokeRect(10, 10, w - 20, h - 20);
    });
  }
  function decalsOf(p, slide, on) {
    const F = frameOf(p, slide), hd = p.d / 2, hw = Math.min(0.5, p.w / 2);
    const [fu, fv] = facing(p.turn), o = L.world(0, 0, 0), f = L.world(fu, fv, 0), n = [f[0] - o[0], f[1] - o[1], f[2] - o[2]];
    // [tl, tr, br, bl] as you face it
    const q = (x0, x1, y0, y1, z) => [F.W(x0, y1, z), F.W(x1, y1, z), F.W(x1, y0, z), F.W(x0, y0, z)];
    const out = [];
    const head = paintHead(p, on), strip = paintStrip(p, on), side = paintSide(on);
    if (head) out.push({ key: `vendor:${p.id}:head`, src: head, quad: q(-hw + 0.04, hw - 0.04, HEAD.y0 + 0.01, HEAD.y1 - 0.01, hd - 0.003), n, ...(on ? { glow: 0.9 } : {}) });
    if (strip) out.push({ key: `vendor:${p.id}:strip`, src: strip, quad: q(BTN.x0, BTN.x1, STRIP.y0, STRIP.y1, hd - 0.002), n, ...(on ? { glow: 0.7 } : {}) });
    // each cap's name rides the cap, in with it when it's pushed
    const menu = p.vend?.menu || [], pitch = (BTN.x1 - BTN.x0) / Math.max(1, menu.length), now = performance.now(), s = st.get(p.id);
    menu.forEach((m) => {
      const cap = paintCap(m); if (!cap) return;
      const i = menu.indexOf(m), x = BTN.x0 + (i + 0.5) * pitch, t = s?.press.get(m.item), k = t == null ? 0 : Math.sin(Math.PI * Math.min(1, Math.max(0, (now - t) / PRESS_MS)));
      out.push({ key: `vendor:${p.id}:cap:${m.item}`, src: cap, quad: q(x - BTN.w / 2 + 0.003, x + BTN.w / 2 - 0.003, BTN.y - BTN.h / 2 + 0.003, BTN.y + BTN.h / 2 - 0.013, hd + 0.0205 - PRESS_D * k), n });
    });
    if (side) out.push({ key: `vendor:${p.id}:side`, src: side, quad: q(SIDE.x0, SIDE.x1, SIDE.y0, SIDE.y1, hd + 0.001), n, ...(on ? { glow: 0.5 } : {}) });
    return out;
  }

  /** Each frame: true when the batch and the decals changed and have to be handed on again. */
  function frame(now = performance.now()) {
    if (!L || !pieces().length) { if (batch.n || decals.length) { batch = { data: new Float32Array(0), n: 0 }; decals = []; return true; } return false; }
    if (!dirty && !moving(now)) return false;
    dirty = false;
    build(now);
    return true;
  }

  // ── what a player can do to it ──
  function acts(p) {
    const v = p.vend || {}, name = String(p.name || '').toLowerCase();
    const flav = (v.menu || []).map((m) => ({ verb: 'vendpress', item: m.item, label: `${m.label}${m.price ? ` ₵${m.price}` : ''}`, cmd: `vend ${name} ${m.item}` }));
    const nudge = { verb: 'nudge', label: v.out ? 'Push it back' : 'Pull it out from the wall', cmd: `nudge ${name} ${v.out ? 'back' : 'out'}` };
    if (!v.out) return [...flav, nudge];
    const plug = v.plugged === false ? { verb: 'plug', label: 'Plug it back in', cmd: `plug ${name}` } : { verb: 'unplug', label: 'Pull the plug', cmd: `unplug ${name}` };
    return [plug, nudge, ...flav];
  }
  function press(id, item) {
    const s = st.get(id);
    if (!s) return;
    s.press.set(item, performance.now());
    dirty = true;
  }
  // what's under the pointer: a button, or the plug once the machine is out; null otherwise
  function hitAt(x, y, w, h, at) {
    if (!L || !at) return null;
    let best = null;
    for (const p of pieces()) {
      if (Math.hypot(at[0] - p.u, at[1] - p.v) > REACH) continue;
      const s = st.get(p.id);
      if (!s) continue;
      const slide = anim(s.slide, performance.now(), SLIDE_MS) * SLIDE, F = frameOf(p, slide), hd = p.d / 2, all = acts(p), menu = p.vend?.menu || [];
      const pitch = (BTN.x1 - BTN.x0) / Math.max(1, menu.length);
      const targets = menu.map((m, i) => ({ c: [BTN.x0 + (i + 0.5) * pitch, BTN.y, hd + 0.02], r: 0.04, act: all.find((a) => a.item === m.item) }));
      if (p.vend?.out) {
        const hw = Math.min(0.5, p.w / 2), zw = -hd - 0.02, F0 = frameOf(p, 0);
        const plugAt = p.vend.plugged === false ? [hw + 0.16, 0.03, zw + 0.32] : [SOCKET[0], SOCKET[1], zw + 0.045];
        const c = project(F0.W(...plugAt), w, h), e = project(F0.W(plugAt[0] + 0.06, plugAt[1], plugAt[2]), w, h);
        if (c && e) { const d = Math.hypot(c.x - x, c.y - y), r = Math.max(12, Math.hypot(e.x - c.x, e.y - c.y)); if (d < r && (!best || d < best.d)) best = { d, piece: p, act: all[0] }; }
      }
      for (const t of targets) {
        if (!t.act) continue;
        const c = project(F.W(...t.c), w, h), e = project(F.W(t.c[0] + t.r, t.c[1], t.c[2]), w, h);
        if (!c || !e) continue;
        const d = Math.hypot(c.x - x, c.y - y), r = Math.max(8, Math.hypot(e.x - c.x, e.y - c.y));
        if (d < r && (!best || d < best.d)) best = { d, piece: p, act: t.act };
      }
    }
    return best;
  }

  return { load, frame, moving, acts, press, hitAt, batch: () => batch, decals: () => decals, get ver() { return ver; } };
}
