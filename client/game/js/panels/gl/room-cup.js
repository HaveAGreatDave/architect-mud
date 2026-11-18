// GLASS 2 · THE CUP, CLOSE UP, on the Room Stage: a league's Cup turned from its design (client/shared/cup-design.js)
// in polished chrome with its edges in gold, its winners engraved round its barrel as the Stanley Cup's are, its own
// name inlaid in gold round the bowl, and its emblem (the goose, client/shared/goose-emblem.js) on a plinth in the
// bowl. Built to be looked at from a hand's width away (panels/room-closeup.js), so every surface is turned with
// smooth normals.
//
// THE ENGRAVING IS PAINTED, NOT BUILT. A hundred seasons of names cut as geometry would be a quarter of a million
// vertices, so every engraved band is one textured chrome cylinder reading its strip of an atlas (`paintCupRoll`,
// laid out by cup-design.js cupAtlas) in an engraver's face, Playfair Display SC, about 3 mm to the capital. The
// atlas's key carries everything painted on it ('roomCup|' + JSON), as a sign's does, so a new winner is a new key.
//
// ⚠ POLISH IS MATERIAL 49 (gl/room.js): a sharp mirror of the room, tinted by the face's colour and by the texture,
// so chrome is a pale tint and gold a warm one, and a dark texel is a cut, dulled in the shine. The probe that
// mirrors the room stands inside the Cup and leaves 49 out of its own bake, so the Cup reflects the room round it.
// ⚠ NOTHING HERE NAMES A CLUB. The winners are the piece's `rolls` (plugins/stands champions.js), its name
// `inscription` (`look.inscription`).

import { cupDesign, cupSlots, cupLines, cupAtlas, cupU, cupClean, ROWS, PANELS, PER_BARREL } from '../../../../shared/cup-design.js';
import { GOOSE_PARTS, GOOSE_CHEVRONS, GOOSE_EYE, GOOSE_FACE, GOOSE_T, GOOSE_H } from '../../../../shared/goose-emblem.js';

export const POLISH = 49;
export const CUP_FACE = 'Playfair Display SC';
const METALS = { chrome: '#e8edf2', gold: '#ffd47e' };
const EYE_C = '#3a2a12';
// the atlas is laid out at this width; a phone paints it at half (the same layout, scaled), so the uvs never change
const ATLAS_W = 4096;

// ── turning ─────────────────────────────────────────────────────────────────────────────────────
// A turned part round the upright axis at (cx, cz) in the piece's frame, its profile [r, y] from the bottom up, cut
// into n facets round. The normals are smoothed across a joint in the profile under 40°, and kept apart at a sharper
// one, so a bead rolls and a step stays a step. `uv(angle, y)` maps it onto a texture in batch `b`.
const SMOOTH = Math.cos(40 * Math.PI / 180);
function turn(K, F, cx, cz, prof, hex, n, b = K.solid, uv = null) {
  const col = K.C(hex, 1), segs = [];
  for (let i = 0; i + 1 < prof.length; i++) {
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy);
    segs.push(l < 1e-7 ? null : [dy / l, -dr / l]);
  }
  const endN = (i, end) => {
    const s = segs[i], o = segs[end ? i + 1 : i - 1];
    if (!o || s[0] * o[0] + s[1] * o[1] < SMOOTH) return s;
    const a = s[0] + o[0], c = s[1] + o[1], l = Math.hypot(a, c) || 1;
    return [a / l, c / l];
  };
  const P = (r, a, y) => F.P(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r);
  const N = ([nr, ny], a) => F.N(Math.sin(a) * nr, ny, Math.cos(a) * nr);
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i]) continue;
    const [r0, y0] = prof[i], [r1, y1] = prof[i + 1], na = endN(i, false), nb = endN(i, true);
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2;
      K.quad(b, [P(r0, a0, y0), P(r0, a1, y0), P(r1, a1, y1), P(r1, a0, y1)], [N(na, a0), N(na, a1), N(nb, a1), N(nb, a0)], col, POLISH,
        uv ? [uv(a0, y0), uv(a1, y0), uv(a1, y1), uv(a0, y1)] : null);
    }
  }
}
const facetsFor = (prof) => { const r = Math.max(...prof.map((p) => p[0])); return r > 0.15 ? 56 : r > 0.09 ? 44 : 32; };

// ── the goose ───────────────────────────────────────────────────────────────────────────────────
// The roof's figure (ashway.js goose) in gold plate, `h` tall with its feet at y, facing the piece's front.
// The roof's −u is your left as you face it, and so is the piece's +x.
function goose(K, F, cx, cz, y, h, hex) {
  const S = h / GOOSE_H, T = GOOSE_T * S, zc = cz - 0.004 * S;
  const X = (u) => cx - u * S, Y = (v) => y + v * S;
  for (const { y: py, k, pts } of GOOSE_PARTS) {
    const zf = zc + py * S, zb = zf - T, col = K.C(hex, k);
    const cu = pts.reduce((s, p) => s + p[0], 0) / pts.length, cv = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const fc = F.P(X(cu), Y(cv), zf), bc = F.P(X(cu), Y(cv), zb);
    for (let i = 0; i < pts.length; i++) {
      const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length];
      const a = F.P(X(u0), Y(v0), zf), b = F.P(X(u1), Y(v1), zf);
      K.quad(K.solid, [fc, a, b, b], F.N(0, 0, 1), col, POLISH);
      K.quad(K.solid, [bc, F.P(X(u1), Y(v1), zb), F.P(X(u0), Y(v0), zb), F.P(X(u0), Y(v0), zb)], F.N(0, 0, -1), K.C(hex, k * 0.9), POLISH);
      // the edge, its normal out of the outline
      let nu = v1 - v0, nv = u0 - u1;
      if (nu * ((u0 + u1) / 2 - cu) + nv * ((v0 + v1) / 2 - cv) < 0) { nu = -nu; nv = -nv; }
      const nl = Math.hypot(nu, nv) || 1;
      K.quad(K.solid, [a, b, F.P(X(u1), Y(v1), zb), F.P(X(u0), Y(v0), zb)], F.N(-nu / nl, nv / nl, 0), col, POLISH);
    }
  }
  const zFace = zc + GOOSE_FACE * S;
  for (const pts of GOOSE_CHEVRONS) K.quad(K.solid, pts.map(([u, v]) => F.P(X(u), Y(v), zFace)), F.N(0, 0, 1), K.C(hex, 0.72), POLISH);
  K.quad(K.solid, GOOSE_EYE.map(([u, v]) => F.P(X(u), Y(v), zFace + 0.0002)), F.N(0, 0, 1), K.C(EYE_C, 1), POLISH);
}

// The atlas's key: everything painted on it, so the texture is painted again only when that changes.
export function cupKey(design, rolls, inscription) {
  const r = cupSlots(design, rolls).map(({ roll }) => [cupClean(roll.name), roll.season || 0, Number.isFinite(roll.year) ? roll.year : 0]);
  const i = (Array.isArray(inscription) ? inscription : []).map((s) => cupClean(s, 32)).filter(Boolean).slice(0, 2);
  return 'roomCup|' + JSON.stringify({ s: design.sport, b: design.barrels, i, r });
}

/**
 * The Cup of `design` stood at the piece's (x, z) with its foot at y. `rolls` are its winners, oldest first;
 * `inscription` up to two lines round the bowl, the first at the front and the second at the back.
 */
export function drawCup(K, F, design, x, y, z, { rolls = null, inscription = null } = {}) {
  const atlas = cupAtlas(design, ATLAS_W), key = cupKey(design, rolls, inscription), tb = K.TB(key);
  const stripOf = new Map(atlas.strips.map((s) => [s.band, s]));
  for (const { metal, prof, band } of design.parts) {
    const P = prof.map(([r, h]) => [r, y + h]);
    const s = band && stripOf.get(band);
    if (!s) { turn(K, F, x, z, P, METALS[metal] || METALS.chrome, facetsFor(prof)); continue; }
    // an engraved band reads its strip: u round it, v down it from the band's top
    const uv = (a, wy) => [cupU(a), (s.v0 + ((y + band.y1 - wy) / (band.y1 - band.y0)) * (s.v1 - s.v0)) / atlas.H];
    turn(K, F, x, z, P, METALS.chrome, 72, tb, uv);
  }
  // the studs under the bowl: small gold domes, each turned on its own axis
  const st = design.studs;
  if (st) for (let i = 0; i < st.n; i++) {
    const a = ((i + 0.5) / st.n) * Math.PI * 2, s = st.size;
    turn(K, F, x + Math.sin(a) * st.r, z + Math.cos(a) * st.r, [[0, y + st.y - s * 0.4], [s, y + st.y - s * 0.1], [s * 0.6, y + st.y + s * 0.6], [0, y + st.y + s * 0.8]], METALS.gold, 6);
  }
  if (design.emblem?.kind === 'goose') goose(K, F, x, z, y + design.emblem.y, design.emblem.h, METALS.gold);
}

// ── the engraving ───────────────────────────────────────────────────────────────────────────────
// White is the bare metal (the texture multiplies the chrome's colour), a dark grey is a cut and gold is an inlay.
// Everything is laid out in the atlas's own pixels; `px` is how many there are to a millimetre on a band.
const CUT = '#3a3a3a', INLAY = '#ffcd58';
const fontPx = (capMm, px) => (capMm / 0.71) * px;   // Playfair's capitals are 0.71 of its em
function face(g, capMm, px, weight = 400) { g.font = `${weight} ${fontPx(capMm, px).toFixed(1)}px "${CUP_FACE}", "Playfair Display", Georgia, serif`; }
// a line of lettering centred at x, its baseline at y, `track` em of space between letters, drawn again a strip's
// width either side so a panel across the seam is whole
function letter(g, text, x, y, W, track = 0.06) {
  if ('letterSpacing' in g) g.letterSpacing = `${track}em`;
  for (const dx of [0, -W, W]) g.fillText(text, x + dx, y);
}
const hair = (g, x0, y0, x1, y1, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };

// A winner's panel: the year, the club's name (two lines if it's long), the season under it, centred in its panel.
function panel(g, roll, cx, top, bottom, wide, px, W) {
  const L = cupLines(roll), gap = 1.1 * px, lines = [];
  if (L.head) lines.push([L.head, 3.0]);
  face(g, 2.8, px);
  if (g.measureText(L.name).width > wide && L.name.includes(' ')) {
    const words = L.name.split(' ');
    let best = 1, bestD = Infinity;
    for (let k = 1; k < words.length; k++) { const d = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length); if (d < bestD) { bestD = d; best = k; } }
    lines.push([words.slice(0, best).join(' '), 2.6], [words.slice(best).join(' '), 2.6]);
  } else lines.push([L.name, 2.8]);
  if (L.foot) lines.push([L.foot, 2.0]);
  const tall = lines.reduce((s, [, mm]) => s + mm * px, 0) + gap * (lines.length - 1);
  let y = (top + bottom) / 2 - tall / 2;
  for (const [text, mm] of lines) {
    face(g, mm, px, mm >= 3 ? 700 : 400);
    // squeezed, never cut off, if a name is wider than its panel
    const w = g.measureText(text).width, k = Math.min(1, wide / Math.max(1, w));
    y += mm * px;
    g.save(); g.translate(cx, y); g.scale(k, 1); letter(g, text, 0, 0, W / k); g.restore();
    y += gap;
  }
}

// guilloché: interlaced waves across a tier, the engraver's ornament where there are no names
function ornament(g, v0, v1, W, px, tier) {
  const mid = (v0 + v1) / 2, amp = (v1 - v0) * 0.28, waves = 48 + tier * 8;
  g.lineWidth = 0.22 * px;
  for (let k = 0; k < 6; k++) {
    const ph = (k / 6) * Math.PI * 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 4) { const yy = mid + amp * Math.sin((x / W) * Math.PI * 2 * waves + ph) * (0.75 + 0.25 * Math.cos((x / W) * Math.PI * 2 * 6 + k)); if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy); }
    g.stroke();
  }
}

/** Paints the atlas `key` names (cupKey) into a canvas, or into `into` again (once the face has loaded). */
export function paintCupRoll(doc, key, into = null) {
  let data;
  try { data = JSON.parse(key.slice('roomCup|'.length)); } catch { data = { r: [], i: [] }; }
  // the same design, rebuilt from what the key says (a design is a pure function of its sport and its barrels)
  const design = cupDesignFor(data);
  const atlas = cupAtlas(design, ATLAS_W), phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, s = phone ? 0.5 : 1;
  const c = into || doc.createElement('canvas');
  c.width = Math.round(atlas.W * s); c.height = Math.round(atlas.H * s);
  const g = c.getContext('2d'), W = atlas.W;
  g.setTransform(s, 0, 0, s, 0, 0);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, atlas.H);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.strokeStyle = CUT; g.fillStyle = CUT;
  const slots = cupSlots(design, (data.r || []).map(([name, season, year]) => ({ name, season: season || null, year: year || null })));
  const at = new Map(slots.map((q) => [`${q.barrel}:${q.band}:${q.row}:${q.panel}`, q.roll]));
  for (const { band, v0, v1 } of atlas.strips) {
    const px = W / (2 * Math.PI * band.r * 1000), h = v1 - v0;
    // a double hairline in from each edge
    for (const [y, w] of [[v0 + 1.0 * px, 0.25], [v0 + 1.8 * px, 0.45], [v1 - 1.8 * px, 0.45], [v1 - 1.0 * px, 0.25]]) hair(g, 0, y, W, y, w * px);
    if (band.kind === 'ornament') { ornament(g, v0 + 2.6 * px, v1 - 2.6 * px, W, px, band.tier); continue; }
    if (band.kind === 'name') {
      const names = (data.i || []).slice(0, 2);
      g.fillStyle = INLAY;
      names.forEach((n, i) => { face(g, 8.5, px, 400); letter(g, n, (cupU(i * Math.PI) % 1 + 1) % 1 * W, v0 + h / 2 + 4.25 * px, W, 0.12); });
      // a small lozenge either side, between the two names
      for (const u of [0.25, 0.75]) { const x = u * W, y = v0 + h / 2, r = 1.6 * px; g.beginPath(); g.moveTo(x - r * 1.6, y); g.lineTo(x, y - r); g.lineTo(x + r * 1.6, y); g.lineTo(x, y + r); g.closePath(); g.fill(); }
      g.fillStyle = CUT;
      continue;
    }
    // a band of winners: two rows of ten panels, a hairline between each
    const top = v0 + 2.6 * px, bottom = v1 - 2.6 * px, rowH = (bottom - top) / ROWS, pw = W / PANELS;
    for (let r = 1; r < ROWS; r++) hair(g, 0, top + r * rowH, W, top + r * rowH, 0.3 * px);
    for (let p = 0; p < PANELS; p++) {
      const x = ((0.5 + (p + 0.5) / PANELS) % 1) * W;
      hair(g, x, top, x, bottom, 0.3 * px);
    }
    for (let r = 0; r < ROWS; r++) for (let p = 0; p < PANELS; p++) {
      const roll = at.get(`${band.barrel}:${band.band}:${r}:${p}`);
      if (!roll) continue;
      panel(g, roll, ((0.5 + p / PANELS) % 1) * W, top + r * rowH, top + (r + 1) * rowH, pw - 3 * px, px, W);
    }
  }
  // drawn before the face had loaded: the caller paints it again when it has (room-stage.js paint)
  // (⚠ not fonts.check: it answers true for a face that was never added, since nothing need load)
  c.cupLate = !!doc.fonts && ![...doc.fonts].some((f) => f.family.replace(/["']/g, '') === CUP_FACE && f.status === 'loaded');
  return c;
}
const cupDesignFor = (data) => cupDesign(data.s || 'hockey', (data.b || 1) * PER_BARREL);
