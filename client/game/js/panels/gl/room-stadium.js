// GLASS 2 · A STADIUM'S PIECES on the Room Stage (client/shared/room-layout.js forms): a box office window with its
// grille and slot, a card pack machine lit from inside, a league's Cup in a glass case on a plinth, the board that
// shows the last champion, a door into the seats, a turnstile, a glass balustrade, the restrooms' urinals and cubicles,
// and the concourse's: a club's banner, a concession grill served over, and a tobacco booth. The resurfacer in its
// bay is GLASS's own machine (panels/room-machine.js), so its piece draws nothing here. Pure: batches, no GL.
//
// ⚠ IT'S ALL DATA. Nothing here names a building or a club: a seat door letters its row's `look.label`, a case holds
// whichever Cup its `look.cup` names (by sport), and the champion board's crest and colours are painted over it on
// the client from what the server sends (panels/room-stadium.js), so a second game on THOMAS uses these as they are.
//
// The frame is the piece's (gl/room-kit.js frame): x across it, y up, z out of its front, metres.

import { MAT } from './ballpark-mesh.js';
import { legend, legendWidth } from '../../../../shared/legend-font.js';
import { FT_M } from '../../../../shared/world-scale.js';
import { cupDesign } from '../../../../shared/cup-design.js';
import { drawCup } from './room-cup.js';

const { GLOSS, METAL, SATIN, MATTE } = MAT;
// the codes gl/room.js reads for a light's own face (room-mesh.js GLOW, LAMP)
const GLOW = 40, LAMP = 42;
const FT = FT_M;
const STEEL = '#8d949b', DARKSTEEL = '#3a3f45', PORCELAIN = '#f1f1ec', CHROME = '#d8dde2';

// THE CUPS with no design of their own (shared/cup-design.js has the hockey Cup's), as each sport's renderer has them
// (gl/ballpark-mesh.js cupInto), turned here as [radius, height] in feet and stood in metres. `rim` is what each band
// is in: silver, dark, gold.
const CUPS = {
  // the hockey Cup: a stepped silver barrel banded in black, a gold collar, a short neck and the bowl
  hockey: { parts: [
    ['dark', [[0.62, 0], [0.62, 0.18], [0, 0.2]]], ['silver', [[0.56, 0.18], [0.56, 0.62]]], ['dark', [[0.58, 0.62], [0.58, 0.68]]],
    ['silver', [[0.5, 0.68], [0.5, 1.12]]], ['dark', [[0.52, 1.12], [0.52, 1.18]]], ['silver', [[0.44, 1.18], [0.38, 1.58], [0.4, 1.6], [0, 1.64]]],
    ['gold', [[0.3, 1.6], [0.3, 1.72]]], ['silver', [[0.17, 1.72], [0.13, 2.2]]], ['gold', [[0.02, 2.1], [0.22, 2.2], [0.02, 2.3]]],
    ['silver', [[0.05, 2.24], [0.36, 2.32], [0.46, 2.5], [0.4, 2.66], [0.3, 2.74]]], ['gold', [[0.47, 2.62], [0.5, 2.7]]],
  ], scale: 1.15 },
  // Deadball's: a stepped base, the stem, a deep bowl flaring to its lip, a ring handle either side, all gold
  baseball: { parts: [['gold', [[0.9, 0], [0.9, 0.25], [0.62, 0.32], [0.55, 0.6], [0.22, 0.75], [0.18, 1.4], [0.3, 1.55], [0.75, 1.8], [1.05, 2.4], [1.15, 3.1], [1.1, 3.2], [0.9, 3.1]]]],
    handles: { r: 1.15, y: 2.7, ring: 0.48 }, scale: 0.9 },
};
const CUP_COL = { silver: '#d4d9df', dark: '#6e757e', gold: '#d8b24a' };

// Letters at most `h` tall, and no wider than `w`
const fit = (text, w, h) => Math.min(h, w * h / Math.max(1e-3, legendWidth(String(text).toUpperCase(), h)));
// Lettering on the piece's front face at depth z, centred at x as seen from in front, y up, h tall.
function lettering(K, F, text, x, y, z, h, hex, emis = 0) {
  const n = F.N(0, 0, 1);
  legend({ plate: (ps, col, e) => K.quad(K.solid, ps.map(([a, b]) => F.P(x - a, b, z)), n, col, e > 0.5 ? GLOW : MATTE, null, true) }, String(text).toUpperCase(), 0, y, h, K.C(hex, emis ? 2 : 1), emis);
}

// The Cup turned at the piece's (x, z), its foot at y.
function cup(K, F, sport, x, y, z) {
  const C = CUPS[sport] || CUPS.hockey, s = FT * C.scale, [u, v] = F.P(x, 0, z);
  for (const [rim, prof] of C.parts) K.lathe(u, v, prof.map(([r, h]) => [r * s, y + h * s]), CUP_COL[rim], rim === 'gold' ? 1.12 : 1.06, 18, METAL);
  if (C.handles) {
    const H = C.handles;
    for (const sd of [-1, 1]) for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + Math.PI * i / 6, [bu, bv] = F.P(x + sd * (H.r + Math.cos(a) * H.ring) * s, 0, z);
      K.ball(bu, bv, y + (H.y + Math.sin(a) * H.ring) * s, 0.032, CUP_COL.gold, 1.12, 8, METAL);
    }
  }
}

// Where a trophy case's Cup stands in its piece: its foot and top, metres up from the room's floor, and how far out
// it reaches, for the close-up's camera (panels/room-closeup.js). The case's plinth is `ph` below.
// A Cup that has grown a barrel (shared/cup-design.js: a hundred seasons a barrel) stands taller, and the plinth comes
// down to take it, so its top stays clear of the lid.
export function trophyCup(p) {
  const design = cupDesign(p.cup || 'hockey', Array.isArray(p.rolls) ? p.rolls.length : 0), tall = design?.height ?? 0.84;
  const ph = Math.max(0.3, Math.min(1.0, p.h * 0.45, p.h - 0.08 - 0.07 - tall - 0.06)), foot = (p.y0 || 0) + ph + 0.07;
  return { design, ph, foot, top: foot + tall, r: design?.radius ?? 0.22, lid: (p.y0 || 0) + p.h - 0.08 };
}

// A banner's cloth, which hangs from the top of its piece: the rod's height, the foot of the cloth's sides and the
// tip of its point, metres up the piece. The piece runs to the floor so it can be hung at any height by its `h`.
export function bannerCloth(p) {
  const top = p.h - 0.12, len = Math.min(2.3, Math.max(0.8, top - 0.3));
  return { top, foot: top - len + 0.45, tip: top - len };
}

// Called from room-mesh.js drawPiece with the piece's own frame; true when it drew the piece.
export function drawStadiumForm(K, F, p) {
  const { P, pbox } = F, w = p.w, d = p.d, h = p.h, hw = w / 2, hd = d / 2;
  const lamp = K.lampOn !== false;
  // the venue's house style (spec.stadium): its colours on the frames, and its signs painted in its own faces over
  // the plates (panels/stadium-signs.js), so the stroke lettering here is only for a room with no style
  const ST = K.L?.spec?.stadium || null, hx = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
  const FRAME = hx(ST?.frame, '#2e4a5e'), ACCENT = hx(ST?.accent, '#c9a24a');
  switch (p.form) {
    case 'resurfacer': return true;   // GLASS's machine, stood here by panels/room-machine.js
    case 'vendor': return true;       // a vending machine that slides out from its wall: panels/room-vendor.js draws it
    case 'boxoffice': {
      // a ticket window: a panelled counter to the sill, a glass screen over it behind a grille of bars with a slot
      // under it, the frame in painted steel, a lit band over the top lettered with the row's `label`
      const sill = 1.05, top = h - 0.42, frame = FRAME, ply = { t: 'roomWood', c: '#6a4e34' };
      pbox(-hw, hw, 0, 0.1, -hd, hd - 0.04, '#1b1c1e', 1, null, SATIN);
      pbox(-hw, hw, 0.1, sill - 0.04, -hd, hd - 0.02, '#7a5a3c', 1, ply, SATIN);
      for (let i = 1; i < 4; i++) { const x = -hw + i * w / 4; pbox(x - 0.015, x + 0.015, 0.14, sill - 0.08, hd - 0.02, hd, '#4a3424', 1, null, SATIN); }
      pbox(-hw - 0.03, hw + 0.03, sill - 0.04, sill, -hd, hd + 0.1, '#c8ccd0', 1, { t: 'roomSteel', c: '#b8bcc0' }, METAL);
      // the frame, the screen and its bars
      for (const s of [-1, 1]) pbox(s < 0 ? -hw : hw - 0.08, s < 0 ? -hw + 0.08 : hw, sill, top, -hd, hd - 0.1, frame, 1, null, SATIN);
      pbox(-hw, hw, top, top + 0.08, -hd, hd - 0.08, frame, 1, null, SATIN);
      K.quad(K.glass, [P(-hw + 0.08, sill + 0.16, hd - 0.2), P(hw - 0.08, sill + 0.16, hd - 0.2), P(hw - 0.08, top, hd - 0.2), P(-hw + 0.08, top, hd - 0.2)], F.N(0, 0, 1), [0.78, 0.84, 0.88], GLOSS, null, true);
      const bars = Math.max(6, Math.round((w - 0.16) / 0.11));
      for (let i = 1; i < bars; i++) { const x = -hw + 0.08 + i * (w - 0.16) / bars; pbox(x - 0.008, x + 0.008, sill + 0.16, top, hd - 0.15, hd - 0.134, DARKSTEEL, 1, null, METAL); }
      pbox(-hw + 0.08, hw - 0.08, sill + 0.13, sill + 0.17, hd - 0.16, hd - 0.12, DARKSTEEL, 1, null, METAL);
      // the slot: a dished steel tray through the screen's foot, dark inside
      pbox(-0.22, 0.22, sill, sill + 0.025, hd - 0.32, hd + 0.08, '#a4aab0', 1.02, null, METAL);
      pbox(-0.18, 0.18, sill + 0.025, sill + 0.13, hd - 0.21, hd - 0.19, '#0c0d0f', 1, null, MATTE);
      // behind the glass: the clerk's shelf, a roll of tickets on it and a lamp over it
      pbox(-hw + 0.1, hw - 0.1, 0.9, 0.94, -hd + 0.04, hd - 0.24, '#5a4430', 1, null, SATIN);
      const [ru, rv] = P(hw - 0.45, 0, hd - 0.4);
      K.lathe(ru, rv, [[0, 0.94], [0.06, 0.94], [0.06, 1.0], [0, 1.0]], '#d8c8a0', 1.05, 12, MATTE);
      if (lamp) pbox(-hw + 0.2, hw - 0.2, top - 0.03, top - 0.01, -hd + 0.1, hd - 0.3, '#fff0d0', 1.9, null, LAMP);
      // the lit band and its letters
      pbox(-hw - 0.04, hw + 0.04, top + 0.08, h, -hd, hd - 0.02, '#14181c', 1, null, SATIN);
      pbox(-hw + 0.04, hw - 0.04, top + 0.12, h - 0.04, hd - 0.02, hd, ST ? '#0c0c10' : lamp ? '#ffe9b8' : '#3a3628', ST ? 1 : lamp ? 1.45 : 1, null, lamp && !ST ? GLOW : MATTE);
      if (!ST) lettering(K, F, p.label || 'Tickets', 0, (top + 0.12 + h - 0.04) / 2, hd + 0.004, fit(p.label || 'Tickets', w - 0.3, Math.min(0.2, (h - top - 0.2) * 0.62)), '#3a1c10', 0);
      return true;
    }
    case 'packs': {
      // a card machine: a deep steel cabinet, its front a lit window onto coils of foil packs in rows, a header
      // lettered CARDS, a keypad and a coin slot down the right, and a flap at the foot where the pack drops
      const body = ST ? FRAME : '#1e2a3c', glow = lamp ? 1.5 : 1;
      pbox(-hw + 0.02, hw - 0.02, 0, 0.06, -hd + 0.02, hd - 0.04, '#0c0d0f', 1, null, MATTE);
      const wx0 = -hw + 0.06, wx1 = hw - 0.24, wy0 = 0.5, wy1 = h - 0.32, zb = hd - 0.46;
      // the cabinet is a shell round its window: the back, the frame and the keypad's column, so what's in the window shows
      pbox(-hw, hw, 0.06, h, -hd, zb, body, 1, null, SATIN);
      pbox(-hw, wx0, 0.06, h, zb, hd - 0.02, body, 1, null, SATIN);
      pbox(wx1, hw, 0.06, h, zb, hd - 0.02, body, 1, null, SATIN);
      pbox(wx0, wx1, 0.06, wy0, zb, hd - 0.02, body, 1, null, SATIN);
      pbox(wx0, wx1, wy1, h, zb, hd - 0.02, body, 1, null, SATIN);
      pbox(wx0, wx1, wy0, wy1, zb, zb + 0.02, lamp ? '#f2f6ff' : '#3a4048', lamp ? 1.3 : 1, null, lamp ? GLOW : MATTE);
      const rows = 5, cols = 4, PACK = ['#d23c3c', '#2a7ad8', '#e8b42a', '#2aa86a', '#9a4ad8'];
      for (let r = 0; r < rows; r++) {
        const y = wy0 + 0.06 + r * (wy1 - wy0 - 0.08) / rows;
        pbox(wx0 + 0.02, wx1 - 0.02, y - 0.012, y, hd - 0.42, hd - 0.1, CHROME, 1, null, METAL);
        for (let c = 0; c < cols; c++) { const x = wx0 + 0.05 + (c + 0.5) * (wx1 - wx0 - 0.1) / cols; pbox(x - 0.05, x + 0.05, y, y + 0.13, hd - 0.16, hd - 0.12, PACK[(r + c) % PACK.length], 1.1, null, GLOSS); }
      }
      K.quad(K.glass, [P(wx0, wy0, hd - 0.02), P(wx1, wy0, hd - 0.02), P(wx1, wy1, hd - 0.02), P(wx0, wy1, hd - 0.02)], F.N(0, 0, 1), [0.82, 0.88, 0.92], GLOSS, null, true);
      // the header, lit
      pbox(-hw + 0.04, hw - 0.04, h - 0.27, h - 0.05, hd - 0.02, hd, ST ? '#0a0a0e' : lamp ? '#ff4a8a' : '#4a2232', ST ? 1 : glow, null, lamp && !ST ? GLOW : MATTE);
      if (!ST) lettering(K, F, p.label || 'Cards', 0, h - 0.16, hd + 0.004, fit(p.label || 'Cards', w - 0.2, 0.13), '#ffffff', lamp ? 1 : 0);
      // the keypad and the coin slot
      const kx = hw - 0.13;
      pbox(kx - 0.08, kx + 0.08, 1.0, 1.28, hd - 0.02, hd + 0.004, '#0a0c10', 1, null, GLOSS);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) pbox(kx - 0.06 + c * 0.04, kx - 0.04 + c * 0.04, 1.03 + r * 0.06, 1.06 + r * 0.06, hd + 0.004, hd + 0.012, '#c8ccd0', 1.05, null, METAL);
      pbox(kx - 0.025, kx + 0.025, 0.86, 0.94, hd - 0.02, hd + 0.01, '#9aa0a6', 1.05, null, METAL);
      pbox(-hw + 0.12, hw - 0.3, 0.14, 0.34, hd - 0.02, hd + 0.006, '#0c0d0f', 1, null, GLOSS);
      return true;
    }
    case 'trophy': {
      // the Cup in its case: a stone plinth with a brass plate, a glass box on it with a downlight in its lid, and the
      // league's Cup on a velvet cushion inside
      const { ph, design } = trophyCup(p), stone = { t: 'roomStone', c: '#cfc8bb' };
      pbox(-hw, hw, 0, 0.08, -hd, hd, '#2a2622', 1, null, SATIN);
      pbox(-hw + 0.05, hw - 0.05, 0.08, ph - 0.05, -hd + 0.05, hd - 0.05, '#e0d8cc', 1, stone, SATIN);
      pbox(-hw, hw, ph - 0.05, ph, -hd, hd, '#2a2622', 1, null, SATIN);
      pbox(-0.32, 0.32, ph * 0.5 - 0.02, ph * 0.5 + 0.18, hd - 0.05, hd - 0.04, ACCENT, 1.1, null, METAL);
      // the case: four glass sides on a steel frame, and the lid
      const g0 = ph, g1 = h - 0.08, e = 0.04;
      for (const [x, z] of [[-hw + e, -hd + e], [hw - e, -hd + e], [-hw + e, hd - e], [hw - e, hd - e]]) pbox(x - 0.015, x + 0.015, g0, g1, z - 0.015, z + 0.015, '#2b2f34', 1, null, METAL);
      const pane = (a, b) => K.quad(K.glass, [P(a[0], g0, a[1]), P(b[0], g0, b[1]), P(b[0], g1, b[1]), P(a[0], g1, a[1])], F.N(b[1] - a[1], 0, a[0] - b[0]), [0.84, 0.9, 0.94], GLOSS, null, true);
      pane([-hw + e, hd - e], [hw - e, hd - e]); pane([hw - e, hd - e], [hw - e, -hd + e]); pane([hw - e, -hd + e], [-hw + e, -hd + e]); pane([-hw + e, -hd + e], [-hw + e, hd - e]);
      pbox(-hw, hw, g1, h, -hd, hd, '#1f2226', 1, null, METAL);
      if (lamp) pbox(-0.12, 0.12, g1 - 0.012, g1, -0.12, 0.12, '#fff4dc', 2.2, null, LAMP);
      // the cushion and the Cup
      const [cu, cv] = P(0, 0, 0);
      K.lathe(cu, cv, [[0, g0], [0.24, g0], [0.26, g0 + 0.04], [0.2, g0 + 0.07], [0, g0 + 0.075]], '#5a1424', 1, 16, SATIN);
      // a Cup with a design (shared/cup-design.js) is turned in polished chrome and gold with its winners cut into it
      // (gl/room-cup.js), to be looked at close up; one without is the plain turned shape below
      if (design) drawCup(K, F, design, 0, g0 + 0.07, 0, { rolls: p.rolls, inscription: p.inscription });
      else cup(K, F, p.cup || 'hockey', 0, g0 + 0.07, 0);
      return true;
    }
    case 'champion': {
      // the last champion's board: a deep frame on the wall, its face dark. panels/room-stadium.js lays the club's crest
      // and colour bands over the face, lit, and the room takes their colour; with nobody crowned it stays as it is here
      const fr = '#1c1a18', gold = ACCENT;
      pbox(-hw, hw, 0.35, h, -hd, hd, fr, 1, null, SATIN);
      pbox(-hw + 0.06, hw - 0.06, 0.41, h - 0.06, hd - 0.02, hd, '#0d0e10', 1, null, MATTE);
      for (const y of [0.38, h - 0.03]) pbox(-hw, hw, y - 0.015, y + 0.015, hd, hd + 0.01, gold, 1.08, null, METAL);
      for (const x of [-hw + 0.03, hw - 0.03]) pbox(x - 0.015, x + 0.015, 0.36, h, hd, hd + 0.01, gold, 1.08, null, METAL);
      // a brass plate under it for the season
      pbox(-0.32, 0.32, 0.1, 0.28, hd - 0.04, hd, gold, 1.05, null, METAL);
      return true;
    }
    case 'seatdoor': {
      // a door into the seats: a concrete portal standing out from the wall, a flight of steps inside it going up and
      // away from you to the light of the bowl at the back, a handrail, and a lit sign over the mouth with the
      // sections it leads to (`look.label`). The wall behind is never cut: the portal is the stairwell's own block.
      // the portal in the venue's frame colour where it has one, faced in brick or concrete as the venue says
      const face = ST?.portal === 'brick' ? { t: 'roomBrick', c: hx(ST?.brick, '#9a5a40') } : { t: 'roomStone', c: '#8c8a84' }, conc = face, oh = h - 0.55, ow = Math.max(0.9, w - 0.5), cw = '#8a8882';
      // an architrave round the mouth in the frame colour, a gilt line inside it
      for (const [x0, x1, y0, y1, k, c, m] of [[-ow / 2 - 0.1, -ow / 2, 0, oh + 0.1, 1, FRAME, SATIN], [ow / 2, ow / 2 + 0.1, 0, oh + 0.1, 1, FRAME, SATIN], [-ow / 2 - 0.1, ow / 2 + 0.1, oh, oh + 0.1, 1, FRAME, SATIN],
        [-ow / 2 - 0.03, -ow / 2 - 0.015, 0, oh + 0.03, 1.08, ACCENT, METAL], [ow / 2 + 0.015, ow / 2 + 0.03, 0, oh + 0.03, 1.08, ACCENT, METAL], [-ow / 2 - 0.03, ow / 2 + 0.03, oh + 0.015, oh + 0.03, 1.08, ACCENT, METAL]])
        pbox(x0, x1, y0, y1, hd, hd + (c === FRAME ? 0.03 : 0.04), c, k, null, m);
      pbox(-hw, -ow / 2, 0, h, -hd, hd, cw, 1, conc, MATTE);
      pbox(ow / 2, hw, 0, h, -hd, hd, cw, 1, conc, MATTE);
      pbox(-ow / 2, ow / 2, oh, h, -hd, hd, cw, 1, conc, MATTE);
      // the stairwell's lining, dark, and its steps rising to the back, each nosed in yellow
      for (const s of [-1, 1]) pbox(s * ow / 2 - (s > 0 ? 0.02 : 0), s * ow / 2 + (s < 0 ? 0.02 : 0), 0, oh, -hd, hd - 0.02, '#26262a', 1, null, MATTE);
      pbox(-ow / 2, ow / 2, oh - 0.02, oh, -hd, hd - 0.02, '#1a1a1d', 1, null, MATTE);
      const n = Math.max(3, Math.floor((d - 0.2) / 0.26)), go = (d - 0.2) / n;
      for (let i = 0; i < n; i++) {
        const z1 = hd - 0.1 - i * go, rise = 0.17 * (i + 1);
        pbox(-ow / 2 + 0.02, ow / 2 - 0.02, 0, rise, -hd, z1, i % 2 ? '#3a3a3c' : '#444446', 1, null, MATTE);
        pbox(-ow / 2 + 0.02, ow / 2 - 0.02, rise - 0.012, rise + 0.002, z1 - 0.04, z1 + 0.002, '#d8c040', 1.1, null, MATTE);
      }
      // the bowl's light at the top of the steps
      const top = 0.17 * n;
      pbox(-ow / 2 + 0.02, ow / 2 - 0.02, top, oh - 0.02, -hd, -hd + 0.02, lamp ? '#cfe0ff' : '#2a3038', lamp ? 1.55 : 1, null, lamp ? GLOW : MATTE);
      // the far side of the bowl against it: rows of seat backs climbing away, and a rail across the top step
      for (let i = 0; i < 4; i++) { const y = top + 0.12 + i * (oh - top - 0.3) / 4; pbox(-ow / 2 + 0.02, ow / 2 - 0.02, y, y + 0.05, -hd + 0.02, -hd + 0.03, '#2a3a52', 1, null, MATTE); for (let x = -ow / 2 + 0.1; x < ow / 2 - 0.05; x += 0.14) pbox(x, x + 0.08, y + 0.05, y + 0.1, -hd + 0.02, -hd + 0.03, '#3a4c66', 1, null, MATTE); }
      pbox(-ow / 2 + 0.02, ow / 2 - 0.02, top + 0.9, top + 0.93, -hd + 0.05, -hd + 0.08, CHROME, 1.05, null, METAL);
      pbox(ow / 2 - 0.09, ow / 2 - 0.06, 0.9, 0.94, -hd, hd, CHROME, 1.05, null, METAL);
      // the sign, its letters as wide as the plate allows
      // (a styled venue's lightbox is its decal, which is light: the plate under it stays dark, or the two add up to white)
      pbox(-ow / 2, ow / 2, oh + 0.07, h - 0.07, hd, hd + 0.05, ST ? '#0c0c10' : lamp ? '#ffffff' : '#555555', ST ? 1 : lamp ? 1.35 : 1, null, lamp && !ST ? GLOW : MATTE);
      const label = p.label || 'Seats', lh = Math.min(0.24, (h - oh - 0.14) * 0.7, (ow - 0.16) * 0.24 / Math.max(0.24, legendWidth(String(label).toUpperCase(), 0.24)));
      if (!ST) lettering(K, F, label, 0, (oh + h) / 2, hd + 0.054, lh, '#1a2a5a', 0);
      return true;
    }
    case 'urinal': {
      // a wall urinal: a porcelain bowl standing off a back plate, a chrome flush pipe down to it, a privacy panel on
      // each side, at the height a man uses one
      const y0 = 0.42, y1 = Math.min(h + 0.4, 1.12);
      pbox(-hw + 0.02, hw - 0.02, y0, y1, -hd, -hd + 0.06, PORCELAIN, 1.04, null, GLOSS);
      K.rounded(...F.alongY(), y0, y1 - 0.12, -hw + 0.04, hw - 0.04, -hd + 0.05, hd - 0.04, 0.12, PORCELAIN, 1.06, GLOSS);
      pbox(-hw + 0.08, hw - 0.08, y0 + 0.24, y0 + 0.27, -hd + 0.1, hd - 0.06, '#c8ccc8', 1, null, GLOSS);
      pbox(-0.012, 0.012, y1, 1.42, -hd + 0.02, -hd + 0.044, CHROME, 1.1, null, METAL);
      pbox(-0.04, 0.04, 1.3, 1.38, -hd + 0.01, -hd + 0.07, CHROME, 1.1, null, METAL);
      for (const s of [-1, 1]) pbox(s * (hw + 0.12) - 0.012, s * (hw + 0.12) + 0.012, 0.35, 1.5, -hd, hd + 0.08, '#4a5a66', 1, null, SATIN);
      return true;
    }
    case 'urinaltrough': {
      // a trough: a long stainless channel at knee height on two brackets, a tiled splash back, the flush pipe along
      // its top with a spray rose every 0.6 m
      const ty = 0.6;
      pbox(-hw, hw, 0, h, -hd, -hd + 0.03, '#dfe6e6', 1, { t: 'roomTile', c: '#e2e8e8' }, GLOSS);
      pbox(-hw, hw, ty - 0.22, ty, -hd + 0.03, hd, '#b4bac0', 1.05, { t: 'roomSteel', c: '#b8bec4' }, METAL);
      pbox(-hw + 0.04, hw - 0.04, ty - 0.02, ty + 0.001, -hd + 0.07, hd - 0.04, '#5a6066', 1, null, METAL);
      for (const x of [-hw + 0.2, hw - 0.2]) pbox(x - 0.02, x + 0.02, 0, ty - 0.22, -hd + 0.03, -hd + 0.12, DARKSTEEL, 1, null, METAL);
      pbox(-hw, hw, h - 0.06, h - 0.03, -hd + 0.03, -hd + 0.06, CHROME, 1.1, null, METAL);
      for (let x = -hw + 0.3; x < hw - 0.2; x += 0.6) pbox(x - 0.03, x + 0.03, h - 0.1, h - 0.06, -hd + 0.04, -hd + 0.09, CHROME, 1.1, null, METAL);
      return true;
    }
    case 'cubicle': {
      // a cubicle: two laminate side panels on steel feet, standing off the floor, a door in its frame at the front
      // stood ajar on the hinge side, the pan at the back with its cistern, a roll and a coat hook
      const pan = '#efefea', lam = '#5d7d8a', top = h, gap = 0.15, t = 0.03;
      for (const s of [-1, 1]) {
        const x = s * (hw - t / 2);
        pbox(x - t / 2, x + t / 2, gap, top, -hd, hd - 0.04, lam, 1, null, SATIN);
        for (const z of [-hd + 0.1, hd - 0.12]) pbox(x - 0.02, x + 0.02, 0, gap, z - 0.02, z + 0.02, CHROME, 1.05, null, METAL);
      }
      // the front: a header rail over the doorway and the door, swung in 70 degrees about the left jamb
      pbox(-hw, hw, top - 0.04, top, hd - 0.06, hd - 0.02, '#4a5a64', 1, null, METAL);
      const dw = w - 2 * t - 0.02, a = 70 * Math.PI / 180, hx = -hw + t, hz = hd - 0.05;
      const doorAt = (s, y, zOff = 0) => P(hx + Math.cos(a) * s, y, hz - Math.sin(a) * s + zOff);
      const dn = F.N(Math.sin(a), 0, Math.cos(a));
      for (const [z, k] of [[0.015, 1], [-0.015, 0.9]]) K.quad(K.solid, [doorAt(0, gap, z), doorAt(dw, gap, z), doorAt(dw, top - 0.06, z), doorAt(0, top - 0.06, z)], z > 0 ? dn : F.N(-Math.sin(a), 0, -Math.cos(a)), K.C(lam, k), SATIN);
      const [lu, lv] = doorAt(dw - 0.08, 0);
      K.ball(lu, lv, 1.0, 0.025, CHROME, 1.1, 8, METAL);
      // the pan and cistern at the back
      const [pu, pv] = P(0, 0, -hd + 0.42);
      K.lathe(pu, pv, [[0.12, 0], [0.16, 0.05], [0.18, 0.3], [0.2, 0.4], [0.17, 0.42], [0, 0.42]], pan, 1.04, 16, GLOSS);
      pbox(-0.2, 0.2, 0.42, 0.44, -hd + 0.2, -hd + 0.64, '#202022', 1, null, GLOSS);
      pbox(-0.2, 0.2, 0.44, 0.84, -hd + 0.02, -hd + 0.2, pan, 1.03, null, GLOSS);
      pbox(-0.05, 0.05, 0.84, 0.86, -hd + 0.07, -hd + 0.14, CHROME, 1.1, null, METAL);
      // a roll on the right panel, a hook on the back of the door
      const [ru, rv] = P(hw - t - 0.08, 0, -hd + 0.75);
      K.lathe(ru, rv, [[0, 0.7], [0.055, 0.7], [0.055, 0.8], [0, 0.8]], '#f6f6f2', 1.02, 12, MATTE);
      return true;
    }
    case 'balustrade': {
      // the edge of a terrace over the ice: glass panels between steel posts, a kick plate along the foot and a handrail
      // in the venue's frame colour along the top, so you see the ice below through it and lean on the rail
      const n = Math.max(1, Math.round(w / 1.5)), post = 0.05, kick = 0.12, rail = 0.06, top = h;
      pbox(-hw, hw, 0, kick, -0.03, 0.03, '#2a2c30', 1, null, METAL);
      for (let i = 0; i <= n; i++) { const x = -hw + i * w / n; pbox(x - post / 2, x + post / 2, 0, top - rail, -post / 2, post / 2, CHROME, 1.05, null, METAL); }
      for (let i = 0; i < n; i++) {
        const x0 = -hw + i * w / n + post / 2 + 0.01, x1 = -hw + (i + 1) * w / n - post / 2 - 0.01;
        K.quad(K.glass, [P(x0, kick + 0.02, 0), P(x1, kick + 0.02, 0), P(x1, top - rail - 0.04, 0), P(x0, top - rail - 0.04, 0)], F.N(0, 0, 1), [0.86, 0.92, 0.96], GLOSS, null, true);
      }
      K.rounded(...F.alongX(), -hw - 0.04, hw + 0.04, -0.05, 0.05, top - rail, top, 0.025, FRAME, 1.05, SATIN);
      return true;
    }
    case 'turnstile': {
      // a turnstile: a brushed steel cabinet on a plinth, its length along the way through, a lid with a reader lit green
      // on the end you come up to, and three arms on a hub at hip height across the lane on its right. The lane is
      // the gap to the next one: the piece is only the cabinet and the arm over the lane is in the air
      const steel = '#b8bec4', tall = Math.min(h, 1.02), hub = 0.86;
      pbox(-hw, hw, 0, 0.06, -hd, hd, '#2a2c30', 1, null, METAL);
      K.rounded(...F.alongY(), 0.06, tall - 0.06, -hw + 0.02, hw - 0.02, -hd + 0.02, hd - 0.02, 0.05, steel, 1.05, METAL);
      pbox(-hw - 0.02, hw + 0.02, tall - 0.06, tall, -hd - 0.02, hd + 0.02, '#d8dde2', 1.08, null, METAL);
      // the reader: a black glass slope on the lid's front end, a green arrow lit in it
      pbox(-hw + 0.04, hw - 0.04, tall, tall + 0.03, hd - 0.2, hd - 0.04, '#0c0e10', 1, null, GLOSS);
      pbox(-0.03, 0.03, tall + 0.03, tall + 0.035, hd - 0.16, hd - 0.08, lamp ? '#40e070' : '#1a3a22', lamp ? 1.8 : 1, null, lamp ? GLOW : MATTE);
      // the hub on the lane side (+x), and the three arms off it, one level across the lane and two dropped behind it
      pbox(hw, hw + 0.05, hub - 0.08, hub + 0.08, -0.08, 0.08, CHROME, 1.08, null, METAL);
      for (const [a, k] of [[0, 1], [2.09, 0.6], [-2.09, 0.6]]) {
        const ca = Math.cos(a), sa = Math.sin(a), len = 0.5;
        // each arm a short run of boxes out from the hub, in the plane across the lane: x out, y and z by its angle
        for (let i = 0; i < 6; i++) {
          const t0 = 0.05 + i * len / 6, t1 = t0 + len / 6, x0 = hw + 0.05 + t0 * ca * k, x1 = hw + 0.05 + t1 * ca * k, z0 = t0 * sa, z1 = t1 * sa, y0 = hub - (1 - k) * t0 * 0.9, y1 = hub - (1 - k) * t1 * 0.9;
          pbox(Math.min(x0, x1) - 0.016, Math.max(x0, x1) + 0.016, Math.min(y0, y1) - 0.016, Math.max(y0, y1) + 0.016, Math.min(z0, z1) - 0.016, Math.max(z0, z1) + 0.016, CHROME, 1.06, null, METAL);
        }
      }
      // the venue's colour as a band round the cabinet under the lid
      pbox(-hw + 0.015, hw - 0.015, tall - 0.16, tall - 0.12, -hd + 0.015, hd - 0.015, FRAME, 1, null, SATIN);
      return true;
    }
    case 'banner': {
      // a club's banner on the wall: a brass rod on two brackets with finials, the cloth hanging from it in the club's
      // first colour, edged in its second, cut to a point at the foot with a tassel, and a band of its third over the
      // point. panels/room-stadium.js paints the crest and the name on the cloth from `club` (plugins/stands
      // champions.js, `flags.club_banner`); with no club it's the venue's colours, blank.
      const cols = (p.club?.colours || []).filter((x) => /^#[0-9a-f]{6}$/i.test(x));
      const field = cols[0] || FRAME, edge = cols[1] || ACCENT, band = cols[2] || cols[1] || ACCENT;
      const { top, foot, tip } = bannerCloth(p), z = 0.02, cw = hw - 0.06;
      // the rod, its brackets back to the wall and a ball on each end
      K.rounded(...F.alongX(), -hw - 0.02, hw + 0.02, z - 0.012, z + 0.012, top, top + 0.024, 0.01, ACCENT, 1.1, METAL);
      for (const s of [-1, 1]) {
        pbox(s * (hw - 0.12) - 0.012, s * (hw - 0.12) + 0.012, top - 0.01, top + 0.03, -hd, z, ACCENT, 1.05, null, METAL);
        const [bu, bv] = P(s * (hw + 0.05), 0, z);
        K.ball(bu, bv, top + 0.012, 0.035, ACCENT, 1.12, 10, METAL);
      }
      // the cloth: the field, the edging down both sides and along the top, all a hair proud of each other
      pbox(-cw, cw, foot, top - 0.02, z - 0.008, z + 0.004, field, 1, null, MATTE);
      for (const s of [-1, 1]) pbox(s * cw - (s > 0 ? 0.06 : 0), s * cw + (s < 0 ? 0.06 : 0), foot, top - 0.02, z + 0.004, z + 0.008, edge, 1, null, MATTE);
      pbox(-cw, cw, top - 0.12, top - 0.02, z + 0.004, z + 0.008, edge, 1, null, MATTE);
      // the point: the field narrowing to the tip, banded, and a gold tassel off it
      const n = F.N(0, 0, 1), C = (hex) => K.C(hex, 1);
      K.quad(K.solid, [P(-cw, foot, z + 0.004), P(cw, foot, z + 0.004), P(0, tip + 0.08, z + 0.004), P(0, tip + 0.08, z + 0.004)], n, C(field), MATTE, null, true);
      K.quad(K.solid, [P(-cw, foot + 0.001, z + 0.007), P(cw, foot + 0.001, z + 0.007), P(cw * 0.78, foot - 0.09, z + 0.007), P(-cw * 0.78, foot - 0.09, z + 0.007)], n, C(band), MATTE, null, true);
      const [tu, tv] = P(0, 0, z + 0.01);
      K.lathe(tu, tv, [[0, tip + 0.08], [0.018, tip + 0.06], [0.03, tip - 0.02], [0.034, tip - 0.06], [0, tip - 0.06]], ACCENT, 1.05, 8, MATTE);
      return true;
    }
    case 'grill': {
      // a concession grill, served over: a steel counter faced in the venue's enamel with a gilt rail, a sneeze guard
      // leaning out over the front, and on the cook's side (behind, -z) a flat-top with patties on it, a roller grill
      // of franks, a bun warmer, the pumps (mustard, ketchup, relish), a stack of paper boats and a beer tower
      const top = Math.min(h, 1.02), back = -hd + 0.05, steel = { t: 'roomSteel', c: '#b8bec4' };
      pbox(-hw, hw, 0, 0.1, -hd + 0.04, hd - 0.06, '#151618', 1, null, MATTE);
      pbox(-hw, hw, 0.1, top - 0.05, -hd, hd - 0.04, '#9aa0a6', 1, steel, METAL);
      // the front: enamel panels in the frame colour with the accent as a band and a gilt rail
      pbox(-hw + 0.02, hw - 0.02, 0.14, top - 0.1, hd - 0.04, hd, FRAME, 1, null, GLOSS);
      pbox(-hw + 0.02, hw - 0.02, 0.5, 0.58, hd, hd + 0.006, ACCENT, 1.08, null, METAL);
      const panels = Math.max(2, Math.round(w / 1.2));
      for (let i = 1; i < panels; i++) { const x = -hw + i * w / panels; pbox(x - 0.012, x + 0.012, 0.14, top - 0.1, hd, hd + 0.008, ACCENT, 1.05, null, METAL); }
      // the worktop and the customers' ledge, and the sneeze guard on two posts
      pbox(-hw - 0.02, hw + 0.02, top - 0.05, top, -hd, hd + 0.02, '#c8ccd0', 1.05, steel, METAL);
      pbox(-hw, hw, top - 0.02, top + 0.02, hd - 0.02, hd + 0.16, '#d8dde2', 1.05, null, METAL);
      for (const s of [-1, 0, 1]) pbox(s * (hw - 0.1) - 0.012, s * (hw - 0.1) + 0.012, top, top + 0.42, hd - 0.14, hd - 0.12, CHROME, 1.08, null, METAL);
      K.quad(K.glass, [P(-hw + 0.06, top + 0.12, hd - 0.13), P(hw - 0.06, top + 0.12, hd - 0.13), P(hw - 0.06, top + 0.46, hd - 0.2), P(-hw + 0.06, top + 0.46, hd - 0.2)], F.N(0, 0.2, 1), [0.82, 0.88, 0.92], GLOSS, null, true);
      // the flat-top, left: black steel with a splash rim, eight patties browning on it
      const gx0 = -hw + 0.12, gx1 = -hw + 0.12 + Math.min(1.1, w * 0.32), gz0 = back, gz1 = back + 0.5;
      pbox(gx0, gx1, top, top + 0.03, gz0, gz1, '#1c1d20', 1, null, METAL);
      pbox(gx0, gx1, top + 0.03, top + 0.11, gz0 - 0.01, gz0 + 0.01, '#8a9096', 1, null, METAL);
      for (let i = 0; i < 8; i++) {
        const [pu, pv] = P(gx0 + 0.13 + (i % 4) * (gx1 - gx0 - 0.2) / 3, 0, gz0 + 0.14 + Math.floor(i / 4) * 0.22);
        K.lathe(pu, pv, [[0, top + 0.03], [0.055, top + 0.03], [0.058, top + 0.042], [0.05, top + 0.05], [0, top + 0.052]], i % 3 ? '#4a2a18' : '#5a3420', 1, 10, SATIN);
        if (i % 2) K.lathe(pu, pv, [[0, top + 0.052], [0.05, top + 0.052], [0.05, top + 0.055], [0, top + 0.056]], '#e8b830', 1.05, 4, SATIN);
      }
      // the roller grill, middle: steel rollers under a lamp hood, a frank on every other one
      const rx0 = gx1 + 0.15, rx1 = rx0 + Math.min(0.75, w * 0.22);
      pbox(rx0, rx1, top, top + 0.06, gz0, gz0 + 0.42, '#7a8086', 1, null, METAL);
      for (let i = 0; i < 9; i++) {
        const zz = gz0 + 0.05 + i * 0.04;
        K.rounded(...F.alongX(), rx0 + 0.02, rx1 - 0.02, zz - 0.012, zz + 0.012, top + 0.06, top + 0.084, 0.011, '#c4cad0', 1.08, METAL);
        if (i % 2 === 0) K.rounded(...F.alongX(), rx0 + 0.05, rx1 - 0.05, zz - 0.014, zz + 0.014, top + 0.082, top + 0.11, 0.013, i % 4 ? '#9a3c1c' : '#a8441e', 1.05, GLOSS);
      }
      pbox(rx0 - 0.02, rx1 + 0.02, top + 0.38, top + 0.42, gz0 - 0.02, gz0 + 0.46, '#2a2c30', 1, null, METAL);
      for (const s of [rx0, rx1]) pbox(s - 0.012, s + 0.012, top + 0.06, top + 0.38, gz0, gz0 + 0.024, CHROME, 1.05, null, METAL);
      if (lamp) pbox(rx0 + 0.04, rx1 - 0.04, top + 0.37, top + 0.38, gz0 + 0.04, gz0 + 0.4, '#ffb070', 1.9, null, LAMP);
      // the bun warmer: a steel drawer box with a glass lid, buns showing
      const bx0 = rx1 + 0.12, bx1 = bx0 + 0.42;
      if (bx1 < hw - 0.5) {
        pbox(bx0, bx1, top, top + 0.22, gz0, gz0 + 0.36, '#b4bac0', 1.05, null, METAL);
        for (let i = 0; i < 6; i++) { const [uu, vv] = P(bx0 + 0.08 + (i % 3) * 0.13, 0, gz0 + 0.1 + Math.floor(i / 3) * 0.15); K.ball(uu, vv, top + 0.235, 0.045, '#d9a05c', 1, 8, SATIN); }
      }
      // the pumps, the boats and the cups along the front of the worktop, where the customer reaches
      for (const [x, hex] of [[hw - 0.95, '#e8c020'], [hw - 0.8, '#c8281e'], [hw - 0.65, '#4a8a2a']]) {
        const [uu, vv] = P(x, 0, hd - 0.32);
        K.lathe(uu, vv, [[0, top], [0.05, top], [0.05, top + 0.2], [0.03, top + 0.22], [0.012, top + 0.22], [0.012, top + 0.27], [0, top + 0.27]], hex, 1.05, 10, GLOSS);
        pbox(x - 0.008, x + 0.008, top + 0.25, top + 0.262, hd - 0.32, hd - 0.24, '#1a1a1a', 1, null, GLOSS);
      }
      for (let i = 0; i < 5; i++) pbox(hw - 0.48, hw - 0.3, top + i * 0.016, top + i * 0.016 + 0.012, hd - 0.4 + i * 0.003, hd - 0.28 + i * 0.003, i % 2 ? '#e8e2cc' : '#d8d0b4', 1, null, MATTE);
      const [cu, cv] = P(hw - 0.15, 0, hd - 0.34);
      K.lathe(cu, cv, [[0, top], [0.045, top], [0.05, top + 0.32], [0, top + 0.32]], '#efe8d8', 1.02, 10, MATTE);
      // the beer tower at the far end of the cook's side, two taps and a drip tray
      const tx = hw - 0.4, [tu, tv] = P(tx, 0, back + 0.15);
      K.lathe(tu, tv, [[0.06, top], [0.05, top + 0.04], [0.04, top + 0.42], [0.06, top + 0.44], [0, top + 0.46]], CHROME, 1.1, 12, METAL);
      for (const s of [-1, 1]) {
        pbox(tx + s * 0.05 - 0.01, tx + s * 0.05 + 0.01, top + 0.3, top + 0.33, back + 0.15, back + 0.26, CHROME, 1.1, null, METAL);
        pbox(tx + s * 0.05 - 0.012, tx + s * 0.05 + 0.012, top + 0.33, top + 0.47, back + 0.23, back + 0.26, s < 0 ? '#c8281e' : ACCENT, 1.05, null, GLOSS);
      }
      pbox(tx - 0.14, tx + 0.14, top, top + 0.02, back + 0.18, back + 0.32, '#3a3d42', 1, null, METAL);
      return true;
    }
    case 'smokebooth': {
      // a tobacco booth: a little kiosk in the venue's frame colour, a glass case for a counter with the packs laid out
      // in it, shelves of cartons up the back wall, a striped awning over the window and a lit band lettered with the
      // row's `label`. Nobody's inside: the packs drop through a chute at the side, and the slot takes the money.
      const sill = 1.0, win = h - 0.62, awn = h - 0.42, side = 0.1, wood = { t: 'roomWood', c: '#5a3a24' };
      pbox(-hw, hw, 0, 0.08, -hd, hd, '#151618', 1, null, MATTE);
      // the shell: the back, the two sides, the roof
      pbox(-hw, hw, 0.08, h - 0.08, -hd, -hd + side, FRAME, 1, null, SATIN);
      for (const s of [-1, 1]) pbox(s < 0 ? -hw : hw - side, s < 0 ? -hw + side : hw, 0.08, h - 0.08, -hd, hd - 0.02, FRAME, 1, null, SATIN);
      pbox(-hw - 0.06, hw + 0.06, h - 0.1, h, -hd - 0.04, hd + 0.04, '#1c1a18', 1, null, SATIN);
      // the counter: a panelled base and the glass case on it, the packs in rows inside
      pbox(-hw + side, hw - side, 0.08, sill - 0.3, hd - 0.12, hd - 0.02, '#6a4a30', 1, wood, SATIN);
      pbox(-hw + side, hw - side, sill - 0.3, sill - 0.27, hd - 0.5, hd, ACCENT, 1.05, null, METAL);
      pbox(-hw + side, hw - side, sill - 0.27, sill - 0.26, hd - 0.48, hd - 0.04, lamp ? '#f4ecd8' : '#5a564c', lamp ? 1.35 : 1, null, lamp ? GLOW : MATTE);
      const PACK = ['#c8281e', '#f2efe6', '#1f4a8a', '#e8c020', '#2a7a4a', '#1a1a1a', '#d8a050', '#8a1a3a'];
      for (let r = 0; r < 3; r++) for (let c = 0; c < Math.floor((w - 2 * side - 0.1) / 0.11); c++) {
        const x = -hw + side + 0.08 + c * 0.11, zz = hd - 0.42 + r * 0.13;
        pbox(x, x + 0.06, sill - 0.26, sill - 0.17, zz, zz + 0.022, PACK[(r * 3 + c) % PACK.length], 1.05, null, GLOSS);
      }
      K.quad(K.glass, [P(-hw + side, sill - 0.26, hd - 0.02), P(hw - side, sill - 0.26, hd - 0.02), P(hw - side, sill, hd - 0.02), P(-hw + side, sill, hd - 0.02)], F.N(0, 0, 1), [0.84, 0.9, 0.94], GLOSS, null, true);
      K.quad(K.glass, [P(-hw + side, sill, hd - 0.02), P(hw - side, sill, hd - 0.02), P(hw - side, sill, hd - 0.5), P(-hw + side, sill, hd - 0.5)], F.N(0, 1, 0), [0.84, 0.9, 0.94], GLOSS, null, true);
      pbox(-hw + side, hw - side, sill, sill + 0.03, hd - 0.5, hd, '#c8ccd0', 1.05, null, METAL);
      // the back wall's shelves of cartons, and a lamp over them
      for (let r = 0; r < 4; r++) {
        const y = sill + 0.1 + r * (win - sill - 0.15) / 4;
        pbox(-hw + side, hw - side, y - 0.02, y, -hd + side, -hd + side + 0.3, '#3a2a1e', 1, null, SATIN);
        for (let x = -hw + side + 0.04; x < hw - side - 0.2; x += 0.2) pbox(x, x + 0.17, y, y + 0.09, -hd + side + 0.04, -hd + side + 0.26, PACK[Math.round((x + hw) * 7 + r) % PACK.length], 1.02, null, SATIN);
      }
      if (lamp) pbox(-hw + side + 0.1, hw - side - 0.1, win - 0.03, win - 0.01, -hd + side, -hd + side + 0.3, '#fff0d0', 1.8, null, LAMP);
      // the window's head, and the awning: striped, leaning out over the counter
      pbox(-hw, hw, win, h - 0.1, hd - 0.12, hd - 0.02, FRAME, 1, null, SATIN);
      const stripes = Math.max(6, Math.round(w / 0.22));
      for (let i = 0; i < stripes; i++) {
        const x0 = -hw - 0.04 + i * (w + 0.08) / stripes, x1 = x0 + (w + 0.08) / stripes;
        K.quad(K.solid, [P(x0, awn, hd), P(x1, awn, hd), P(x1, awn - 0.32, hd + 0.42), P(x0, awn - 0.32, hd + 0.42)], F.N(0, 0.8, 0.6), K.C(i % 2 ? '#efe6d2' : '#b8261e', 1), MATTE, null, true);
      }
      // the lit band over the awning
      pbox(-hw + 0.04, hw - 0.04, h - 0.4, h - 0.12, hd - 0.02, hd + 0.01, ST ? '#0c0c10' : lamp ? '#ffe9b8' : '#3a3628', ST ? 1 : lamp ? 1.45 : 1, null, lamp && !ST ? GLOW : MATTE);
      if (!ST) lettering(K, F, p.label || 'Tobacco', 0, h - 0.26, hd + 0.014, fit(p.label || 'Tobacco', w - 0.3, 0.18), '#3a1c10', 0);
      // the money slot and the chute at the right side, where the packs come out
      pbox(hw - side - 0.3, hw - side - 0.1, sill + 0.03, sill + 0.05, hd - 0.1, hd + 0.02, '#a4aab0', 1.05, null, METAL);
      pbox(hw, hw + 0.06, 0.7, 0.95, hd - 0.4, hd - 0.12, '#2a2c30', 1, null, METAL);
      pbox(hw + 0.06, hw + 0.07, 0.72, 0.8, hd - 0.38, hd - 0.14, '#0a0b0c', 1, null, MATTE);
      return true;
    }
    default: return false;
  }
}
