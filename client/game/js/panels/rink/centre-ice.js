// Rinkside · the paint at centre ice, under the sheet.
//
// Two paintings, both inside the fifteen-foot faceoff circle and drawn in feet (the caller hands
// the context translated to the centre dot, `S` texels a foot):
//
//   the league's, every night: the CPhL mark (a puck with one red line through it, cphl-brand.js)
//     as a roundel, COLDWATER and HOCKEY LEAGUE round its rim, and CLUSTERPUCK across it on a
//     raked band that runs out past the puck;
//   the Cup's, on Cup final night: the Cup on a navy field in a gold ring, the two finalists'
//     crests either side of it, and a painted banner under them reading COLDWATER CUP, with which
//     inaugural this is in small letters above it. Every Cup is the inaugural Cup; this year's is
//     only the latest of them.
//
// Paint under ice is a little washed out, so both finish with a thin frost over them.
// textures.js calls this for the clean sheet; `dress()` there repaints it when the night changes.

import { paintCrest } from '../club-crest.js';
import { GOOSE_PARTS, GOOSE_CHEVRONS, GOOSE_EYE, GOOSE_H } from '../../../../shared/goose-emblem.js';

const TAU = Math.PI * 2;
// Big Shoulders Display, the game's condensed display face (styles.css @font-face 'K7 Shoulders',
// weight 800 only, so every weight asked for here is 800): textures.js repaints once it loads
export const CENTRE_FONT = '"K7 Shoulders", "Saira Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
// the mark's own colours (styles.css .cphl-mark, .cphl-lockup-word)
const PUCK = '#070d14', CYAN = '#4fd2ff', RED = '#e0342c', WHITE = '#eaf6ff', CORAL = '#ff6b5e';
const GOLD = '#e3b74c', GOLD_D = '#a8781e', GOLD_L = '#ffe39a', NAVY = '#0f1d36', CRIMSON = '#b3121f', CRIMSON_D = '#6e0a12';
const FROST = 'rgba(236,243,247,0.13)';

// Feet either side of centre the paint can reach (the banner's tails run past the faceoff
// circle): what a repaint has to cover.
export const CENTRE_REACH = 19;

// ── which inaugural ─────────────────────────────────────────────────────────────
const ONES = ['', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH',
  'ELEVENTH', 'TWELFTH', 'THIRTEENTH', 'FOURTEENTH', 'FIFTEENTH', 'SIXTEENTH', 'SEVENTEENTH', 'EIGHTEENTH', 'NINETEENTH'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const TENTHS = ['', '', 'TWENTIETH', 'THIRTIETH', 'FORTIETH', 'FIFTIETH', 'SIXTIETH', 'SEVENTIETH', 'EIGHTIETH', 'NINETIETH'];
// 1 → FIRST INAUGURAL, 2 → SECOND INAUGURAL, 23 → TWENTY-THIRD INAUGURAL; past 99, digits
export function inauguralLine(n) {
  n = Math.floor(+n);
  if (!(n >= 1)) return '';
  let w;
  if (n < 20) w = ONES[n];
  else if (n < 100) w = n % 10 ? `${TENS[(n / 10) | 0]}-${ONES[n % 10]}` : TENTHS[n / 10];
  else w = `${n}${[11, 12, 13].includes(n % 100) ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH'}`;
  return `${w} INAUGURAL`;
}

// ── lettering ───────────────────────────────────────────────────────────────────
const font = (c, px) => { c.font = `800 ${px}px ${CENTRE_FONT}`; };
// Characters round a circle about (0, cy), `r` from it, centred on angle `mid` (φ, 0 = straight
// down from the centre). `outward`: the letters' heads point away from the centre (the top of a
// ring); otherwise at it (the foot of a ring, and a banner that smiles). `outline` strokes each
// letter under its fill in the current stroke style.
function arcText(c, str, cy, r, mid, outward, track = 0, outline = false) {
  const chars = [...str], ws = chars.map((ch) => c.measureText(ch).width);
  const total = ws.reduce((a, b) => a + b + track, -track);
  // reading left to right runs along −φ over the top of a ring and +φ along its foot
  const dir = outward ? -1 : 1;
  let s = -total / 2;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  chars.forEach((ch, i) => {
    const phi = mid + dir * (s + ws[i] / 2) / r;
    c.save();
    c.translate(r * Math.sin(phi), cy + r * Math.cos(phi));
    c.rotate(outward ? Math.PI - phi : -phi);
    if (outline) c.strokeText(ch, 0, 0);
    c.fillText(ch, 0, 0);
    c.restore();
    s += ws[i] + track;
  });
}

// ── the league: CLUSTERPUCK ────────────────────────────────────────────────────
function paintLeague(c) {
  // the roundel: a black puck, a cyan rim, a band round it for the lettering
  c.fillStyle = PUCK; c.beginPath(); c.arc(0, 0, 11.6, 0, TAU); c.fill();
  c.strokeStyle = CYAN; c.lineWidth = 0.7; c.beginPath(); c.arc(0, 0, 11.25, 0, TAU); c.stroke();
  c.strokeStyle = 'rgba(79,210,255,0.55)'; c.lineWidth = 0.3; c.beginPath(); c.arc(0, 0, 8.3, 0, TAU); c.stroke();
  // the red line, at the angle it always arrives at (cphl-brand.js), inside the inner ring
  c.save(); c.beginPath(); c.arc(0, 0, 8.05, 0, TAU); c.clip();
  c.strokeStyle = RED; c.lineWidth = 2.3; c.lineCap = 'butt';
  c.beginPath(); c.moveTo(-9, 6.1); c.lineTo(9, -6.1); c.stroke();
  c.restore();
  // round the rim: COLDWATER over the top, HOCKEY LEAGUE under
  c.fillStyle = CYAN; font(c, 1.55);
  arcText(c, 'COLDWATER', 0, 9.75, Math.PI, true, 0.32);
  arcText(c, 'HOCKEY LEAGUE', 0, 9.75, 0, false, 0.26);
  // CLUSTERPUCK across it, raked like the stick hit it, on a band that runs out past the puck
  c.save();
  c.transform(1, 0, -0.2, 1, 0, 0);
  const bw = 14.1, bh = 2.35;
  c.fillStyle = PUCK; c.fillRect(-bw, -bh, bw * 2, bh * 2);
  c.strokeStyle = CYAN; c.lineWidth = 0.32; c.strokeRect(-bw + 0.35, -bh + 0.35, bw * 2 - 0.7, bh * 2 - 0.7);
  font(c, 3.5); c.textBaseline = 'middle'; c.textAlign = 'left';
  const t1 = 'CLUSTER', t2 = 'PUCK', gap = 0.15, tr = 0.22;
  const wOf = (t) => [...t].reduce((a, ch) => a + c.measureText(ch).width + tr, -tr);
  const w1 = wOf(t1), w2 = wOf(t2), all = w1 + gap + w2, room = (bw - 1.1) * 2;
  const k = all > room ? room / all : 1;
  c.save(); c.scale(k, 1);
  let x = -all / 2;
  const word = (t, col) => {
    for (const ch of t) {
      c.lineWidth = 0.5; c.strokeStyle = PUCK; c.strokeText(ch, x, 0.2);
      c.fillStyle = col; c.fillText(ch, x, 0.2);
      x += c.measureText(ch).width + tr;
    }
  };
  word(t1, WHITE); x += gap - tr; word(t2, CORAL);
  c.restore();
  c.restore();
  // frost over it all
  c.fillStyle = FROST; c.beginPath(); c.arc(0, 0, 11.7, 0, TAU); c.fill();
  c.save(); c.transform(1, 0, -0.2, 1, 0, 0); c.fillRect(-bw, -bh, bw * 2, bh * 2); c.restore();
}

// ── the Cup ─────────────────────────────────────────────────────────────────────
// The Cup in silhouette, after the one in its case: a gold foot, a banded barrel, three tiers
// narrowing up to a neck, the bowl, and the goose on top. Half-widths in feet up from its foot
// (y down is +). Its foot stands behind the banner.
const CUP_PROFILE = [
  [2.75, 0], [2.75, -0.45], [2.55, -0.55], [2.55, -3.6],           // the foot and the barrel
  [2.25, -3.7], [2.25, -5.1], [1.9, -5.2], [1.9, -6.4],             // the tiers
  [1.55, -6.5], [1.55, -7.5], [0.55, -8.1], [0.5, -8.9],            // up to the neck
  [1.6, -9.4], [2.45, -10.4], [2.7, -11.2], [2.45, -11.3],          // the bowl and its lip
];
const BANDS = [-0.5, -1.25, -2.0, -2.75, -3.6, -5.15, -6.45, -7.5];
// The goose, the same bird as on the Gardens' gable and the Cup in its case (shared/goose-emblem.js),
// GOOSE_FT tall, its feet at (x, y). Its parts go on back to front, each gold shaded by its `k`,
// then the chevrons down its breast and its eye.
const GOOSE_FT = 4.0;
const gilt = (k) => `rgb(${[227, 183, 76].map((v) => Math.min(255, Math.round(v * k))).join(',')})`;
function paintGoose(c, x, y, h) {
  const s = h / GOOSE_H;
  const poly = (pts) => { c.beginPath(); pts.forEach(([u, v], i) => (i ? c.lineTo(x + u * s, y - v * s) : c.moveTo(x + u * s, y - v * s))); c.closePath(); };
  c.save();
  c.lineJoin = 'round'; c.lineWidth = 0.12; c.strokeStyle = '#3a2a0a';
  for (const p of [...GOOSE_PARTS].sort((a, b) => a.y - b.y)) { poly(p.pts); c.fillStyle = gilt(p.k); c.fill(); c.stroke(); }
  c.fillStyle = gilt(0.78);
  for (const pts of GOOSE_CHEVRONS) { poly(pts); c.fill(); }
  c.fillStyle = '#241c0c'; poly(GOOSE_EYE); c.fill();
  c.restore();
}
function paintCupShape(c, x, y) {
  c.save(); c.translate(x, y);
  c.beginPath();
  CUP_PROFILE.forEach(([w, h], i) => (i ? c.lineTo(w, h) : c.moveTo(w, h)));
  for (let i = CUP_PROFILE.length - 1; i >= 0; i--) c.lineTo(-CUP_PROFILE[i][0], CUP_PROFILE[i][1]);
  c.closePath();
  const g = c.createLinearGradient(-2.8, 0, 2.8, 0);
  g.addColorStop(0, '#8d99a6'); g.addColorStop(0.32, '#f4f8fb'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(0.7, '#c3ccd5'); g.addColorStop(1, '#6f7a86');
  c.fillStyle = g; c.fill();
  c.lineWidth = 0.28; c.strokeStyle = '#241c0c'; c.lineJoin = 'round'; c.stroke();
  c.save(); c.clip();
  // gold on every edge, as the real one has
  c.fillStyle = GOLD;
  c.fillRect(-3, -0.45, 6, 0.45);
  for (const b of BANDS) c.fillRect(-3, b - 0.07, 6, 0.14);
  c.fillRect(-3, -11.4, 6, 0.32);
  // the engraving, as a band of fine lines on the barrel
  c.fillStyle = 'rgba(60,70,82,0.35)';
  for (let h = -0.75; h > -3.5; h -= 0.75) for (let r = 0; r < 3; r++) c.fillRect(-2.2, h - 0.15 - r * 0.17, 4.4, 0.05);
  c.restore();
  // the gilt goose on its plinth in the bowl, as it stands on the Cup in its case
  c.beginPath(); c.moveTo(-0.95, -11.3); c.lineTo(0.95, -11.3); c.lineTo(0.7, -11.75); c.lineTo(-0.7, -11.75); c.closePath();
  c.fillStyle = GOLD_D; c.fill(); c.lineWidth = 0.16; c.strokeStyle = '#241c0c'; c.stroke();
  paintGoose(c, 0, -11.75, GOOSE_FT);
  c.restore();
}

function paintBadge(c, club, colours, abbr, x, y) {
  c.save();
  c.fillStyle = '#f6efdc'; c.beginPath(); c.arc(x, y, 3.75, 0, TAU); c.fill();
  c.strokeStyle = GOLD; c.lineWidth = 0.42; c.stroke();
  c.strokeStyle = GOLD_D; c.lineWidth = 0.14; c.beginPath(); c.arc(x, y, 3.42, 0, TAU); c.stroke();
  if (!(club && paintCrest(c, club, x, y, 6.2))) {
    // no identity to hand: the club's colours and its letters
    const [a, b] = Array.isArray(colours) && colours.length ? colours : ['#2b3d5c', '#e8e8e8'];
    c.fillStyle = a; c.beginPath(); c.arc(x, y, 3.0, 0, TAU); c.fill();
    c.strokeStyle = b || '#ffffff'; c.lineWidth = 0.4; c.stroke();
    if (abbr) {
      c.fillStyle = b || '#ffffff'; font(c, 2.1); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(abbr).slice(0, 3), x, y + 0.1, 5);
    }
  }
  c.restore();
}

// The banner: a ribbon that smiles, its ends folded behind it. A circle of radius R about a
// centre R above the ribbon's middle; the ribbon is H deep and runs PHI either side.
const BR = 38, BH = 5.6, BMID = 5.6, BPHI = 0.34;
function paintBanner(c, edition, name) {
  const cy = BMID - BR, r0 = BR - BH / 2, r1 = BR + BH / 2;
  const P = (r, phi) => [r * Math.sin(phi), cy + r * Math.cos(phi)];
  const band = (ra, rb, p0, p1) => {
    c.beginPath();
    // (canvas angles run from +x; ours from straight down, so +π/2 − φ)
    c.arc(0, cy, ra, Math.PI / 2 - p0, Math.PI / 2 - p1, true);
    c.arc(0, cy, rb, Math.PI / 2 - p1, Math.PI / 2 - p0, false);
    c.closePath();
  };
  // the tails, behind, a step lower, each cut in a V
  for (const sd of [-1, 1]) {
    const pa = sd * (BPHI - 0.07), pb = sd * (BPHI + 0.08), drop = 1.3;
    const a0 = P(r0 + drop, pa), a1 = P(r0 + drop, pb), b1 = P(r1 + drop, pb), b0 = P(r1 + drop, pa);
    const notch = P(BR + drop, sd * (BPHI + 0.035));
    c.beginPath(); c.moveTo(...a0); c.lineTo(...a1); c.lineTo(...notch); c.lineTo(...b1); c.lineTo(...b0); c.closePath();
    c.fillStyle = CRIMSON_D; c.fill(); c.strokeStyle = GOLD_D; c.lineWidth = 0.25; c.stroke();
    // the fold, where the tail goes under
    const f0 = P(r1, sd * BPHI), f1 = P(r1 + drop, sd * (BPHI - 0.07)), f2 = P(r0 + drop, sd * (BPHI - 0.07));
    c.beginPath(); c.moveTo(...f0); c.lineTo(...f1); c.lineTo(...f2); c.closePath();
    c.fillStyle = '#3d050a'; c.fill();
  }
  // the ribbon, gold-edged
  band(r0, r1, -BPHI, BPHI);
  const g = c.createLinearGradient(0, BMID - BH / 2, 0, BMID + BH / 2);
  g.addColorStop(0, '#d01a28'); g.addColorStop(1, CRIMSON);
  c.fillStyle = g; c.fill();
  c.lineWidth = 0.3; c.strokeStyle = '#2a0408'; c.stroke();
  c.strokeStyle = GOLD; c.lineWidth = 0.28;
  for (const r of [r0 + 0.42, r1 - 0.42]) { c.beginPath(); c.arc(0, cy, r, Math.PI / 2 + BPHI - 0.004, Math.PI / 2 - BPHI + 0.004, true); c.stroke(); }
  // the lettering, following it: which inaugural, small, over the Cup's name
  const big = String(name || 'COLDWATER CUP').toUpperCase();
  c.save();
  if (edition) {
    c.fillStyle = GOLD_L;
    fitArc(c, edition, cy, BR - 1.55, 1.2, 800, 0.28, false);
    c.fillStyle = '#fff6e0';
    fitArc(c, big, cy, BR + 0.85, 2.55, 900, 0.2, true);
  } else {
    c.fillStyle = '#fff6e0';
    fitArc(c, big, cy, BR + 0.15, 2.9, 900, 0.24, true);
  }
  c.restore();
}
// arcText on the ribbon, shrunk to fit it if the words are long
function fitArc(c, str, cy, r, px, weight, track, outline) {
  const room = r * BPHI * 2 * 0.86;
  font(c, px);
  const w = [...str].reduce((a, ch) => a + c.measureText(ch).width + track, -track);
  if (w > room) { font(c, px * room / w); track *= room / w; }
  c.lineWidth = 0.32; c.strokeStyle = '#3a0509';
  arcText(c, str, cy, r, 0, false, track, outline);
}

function paintCup(c, d) {
  // the field: navy in a gold ring, rays off the Cup
  c.fillStyle = NAVY; c.beginPath(); c.arc(0, 0, 11.7, 0, TAU); c.fill();
  c.save(); c.beginPath(); c.arc(0, 0, 11.3, 0, TAU); c.clip();
  c.fillStyle = 'rgba(227,183,76,0.16)';
  for (let i = 0; i < 18; i++) {
    const a0 = (i / 18) * TAU, a1 = a0 + TAU / 36;
    c.beginPath(); c.moveTo(0, -4); c.lineTo(Math.cos(a0) * 16, -4 + Math.sin(a0) * 16); c.lineTo(Math.cos(a1) * 16, -4 + Math.sin(a1) * 16); c.closePath(); c.fill();
  }
  c.restore();
  c.strokeStyle = GOLD; c.lineWidth = 0.75; c.beginPath(); c.arc(0, 0, 11.35, 0, TAU); c.stroke();
  c.strokeStyle = GOLD_D; c.lineWidth = 0.18; c.beginPath(); c.arc(0, 0, 10.75, 0, TAU); c.stroke();
  // stars round the top of the ring
  c.fillStyle = GOLD_L;
  for (const a of [-0.84, -0.63, -0.42, 0.42, 0.63, 0.84]) star(c, 10.05 * Math.sin(a), -10.05 * Math.cos(a), 0.42);
  paintCupShape(c, 0, 5.2);
  paintBadge(c, d.away, d.awayColours, d.awayAbbr, -7.0, -2.2);
  paintBadge(c, d.home, d.homeColours, d.homeAbbr, 7.0, -2.2);
  paintBanner(c, inauguralLine(d.cupNo), d.final);
  c.fillStyle = FROST; c.beginPath(); c.arc(0, 0, 11.75, 0, TAU); c.fill();
}
function star(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath(); c.fill();
}

// The paint at centre ice, (cx, cy) in texels, `S` texels a foot. `d` is the night's dress:
// null or { cup: false } for the league's, or { cup: true, away, home (club identities, or
// null), awayColours, homeColours, awayAbbr, homeAbbr, cupNo, final } for the Cup's.
export function paintCentreIce(c, cx, cy, S, d) {
  c.save();
  c.translate(cx, cy); c.scale(S, S);
  if (d && d.cup) paintCup(c, d); else paintLeague(c);
  c.restore();
}
