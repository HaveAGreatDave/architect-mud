// STREET DOORS: the pair of glass leaves in a building's doorway, for somebody on foot outside it.
//
// The street view on foot (freelook-view.js) hands the frame `v.streetDoors`: each door's tile, the way
// its front faces, the plane the leaves stand in, the half-width of the doorway and the height of its
// head, all in tiles and read off the building's own mass there, plus how far apart the leaves are
// now (0 shut, 1 open). Nothing here decides anything.
//
// ⚠ DECALS, NOT MASS, for the reason the Clone Facility's doors are: an arm's mass and flats are
// captured once at a frozen clock, and these move with where somebody is standing, which no clock
// knows. So an arm whose building has a Stage leaves its doorway empty (the frame, no glass) and this
// draws the glass. It is drawn from `drawWorldObjects` with the sinks open, depth-tested like any
// decal.
//
// A leaf slides into the wall beside it: its inner edge moves out and its outer edge stays, so open
// it is a sliver against the jamb.
import { emitDecoFill } from '../windshield.js';

const CARD_IN = 0.006, CARD_PULL = 0.02, LIFT = 0.03, GAP = 0.004, SILL = 0.04, HEAD = 0.94, STILE = 0.06;

export function drawStreetDoors(ctx, cam, v, now, night) {
  const doors = v.streetDoors;
  if (!doors || !doors.length || !v.mapCenter) return;
  const ox = v.mapCenter.x + ((v.mapOffset && v.mapOffset.x) || 0);
  const oy = v.mapCenter.y + ((v.mapOffset && v.mapOffset.y) || 0);
  const glass = night ? ['rgb(190,214,220)', 'rgb(120,150,160)'] : ['rgb(150,178,186)', 'rgb(64,86,92)'];
  const rail = night ? 'rgb(96,84,62)' : 'rgb(122,104,74)';
  for (const d of doors) {
    const E = d.E, half = d.half, top = d.top;
    if (!E || !(half > 0.01) || !(top > 0.01)) continue;
    // the model's own frame: y out of the front, x along it (windshield.js facePt)
    const P = (lx, z) => [d.x - ox + lx * E[1] + d.plane * E[0], d.y - oy - lx * E[0] + d.plane * E[1], z];
    const open = Math.max(0, Math.min(1, d.open || 0)), z0 = top * SILL, z1 = top * HEAD;
    // the lobby behind the doors (lobby-still.js stillCard): its own picture of itself from just inside, on a card
    // in the opening. Solid, so it's what fills the doorway instead of the dark panel the model puts there.
    if (d.card) {
      // ⚠ A HAIR BEHIND THE LEAVES, NOTHING DEEPER. The arm fills its doorway a little way in with its own dark panel
      // (measured at the Solenne: a card 0.02 tiles behind the leaves was gone, 0.005 showed), so the card stands just
      // behind the glass and exactly the opening's width, or it spills over the jambs in front of it.
      // ⚠ AND ITS PULL HAS TO BEAT THE PANEL AT EVERY ANGLE. A decal is pulled along the line of sight, so at a slant
      // it moves less across the wall than head-on: set back 0.006 and pulled 0.006, it lost to the panel the moment
      // you turned and the doorway went grey. So it's pulled well past its setback, and the glass further still.
      const back = -CARD_IN, w = half, Q = (lx, z) => { const p = P(lx, z); return [p[0] + back * E[0], p[1] + back * E[1], z]; };
      emitDecoFill(ctx, cam, [Q(-w, z1), Q(w, z1), Q(w, 0), Q(-w, 0)], night ? 'rgb(70,64,52)' : 'rgb(96,88,74)', 1, CARD_PULL, 'lobbycard', true, null, d.card);
    }
    if (d.bars) { barredLeaf(ctx, cam, d, P, open, top, night); continue; }
    if (d.glass === false) continue;
    // a building can dress its doors (flags.room.street_door, via plugins/roomstage): the glass's tint, a metal trim
    // round each leaf and a monogram on the pull handle. Without, the plain glass and bronze stile.
    const L = d.look, tint = L?.glass ? shade(L.glass, night ? 1.25 : 1) : null;
    const pane = tint ? [shade(tint, 1.35), tint] : glass, trim = L?.trim ? shade(L.trim, night ? 0.85 : 1) : rail;
    // hinged hotel doors (flags.room.street_door kind 'swing'): each leaf turns in about its outer jamb
    if (d.swing) { swingPair(ctx, cam, d, P, pane, trim, L, open, z0, z1); continue; }
    for (const s of [-1, 1]) {
      const inner = GAP + (half - GAP) * open * 0.92, outer = half;
      if (outer - inner < 0.002) continue;
      const a = s * inner, b = s * outer, w = (outer - inner) * STILE;
      emitDecoFill(ctx, cam, [P(a, z1), P(b, z1), P(b, z0), P(a, z0)], pane[1], d.card ? 0.28 : 0.9, LIFT, 'streetdoor', true, pane);
      // the meeting stile, so a leaf reads as a leaf while it slides
      emitDecoFill(ctx, cam, [P(a, z1), P(a + s * w, z1), P(a + s * w, z0), P(a, z0)], trim, 1, LIFT * 1.5, 'streetdoor', true);
      if (!L) continue;
      // the trim: a rail along the head and the foot of the leaf and a stile at its outer edge
      const t = (z1 - z0) * 0.035, tw = half * 0.05;
      emitDecoFill(ctx, cam, [P(a, z1), P(b, z1), P(b, z1 - t), P(a, z1 - t)], trim, 1, LIFT * 1.5, 'streetdoor', true);
      emitDecoFill(ctx, cam, [P(a, z0 + t * 2.5), P(b, z0 + t * 2.5), P(b, z0), P(a, z0)], trim, 1, LIFT * 1.5, 'streetdoor', true);
      emitDecoFill(ctx, cam, [P(b - s * tw, z1), P(b, z1), P(b, z0), P(b - s * tw, z0)], trim, 1, LIFT * 1.5, 'streetdoor', true);
      // the S pull (flags.room.street_door.handle 's'): a tall cast handle by the meeting stile, the two leaves'
      // mirrored so the pair meets as a figure. It rides with the leaf.
      if (L.handle === 's') {
        const hw = half * 0.13, x0 = a + s * (w + half * 0.02), x1 = x0 + s * hw, zm = top * 0.50, hh = top * 0.42;
        if (Math.abs(x1) <= outer) {
          const [l, r] = s < 0 ? [x1, x0] : [x0, x1];
          emitDecoFill(ctx, cam, [P(l, zm + hh / 2), P(r, zm + hh / 2), P(r, zm - hh / 2), P(l, zm - hh / 2)], trim, 1, LIFT * 2, 'streetdoor', true, null, sHandleSkin(trim, pane[1], s < 0));
        }
      } else if (L.monogram) {
        const hw = half * 0.16, x0 = a + s * (w + half * 0.03), x1 = x0 + s * hw, zm = top * 0.47, hh = top * 0.17;
        if (Math.abs(x1) <= outer) {
          const [l, r] = s < 0 ? [x1, x0] : [x0, x1];
          emitDecoFill(ctx, cam, [P(l, zm + hh / 2), P(r, zm + hh / 2), P(r, zm - hh / 2), P(l, zm - hh / 2)], trim, 1, LIFT * 2, 'streetdoor', true, null, monogramSkin(L.monogram, trim));
        }
      }
    }
  }
}

// A pair of hinged leaves, each a bronze-framed pane with a middle rail and a kick plate, turned in about its outer
// jamb by up to 80 degrees. P(lx, z) is the doorway's plane; a point `back` behind it is P moved in along -E.
function swingPair(ctx, cam, d, P, pane, trim, L, open, z0, z1) {
  const E = d.E, half = d.half, t = open * 1.4, Q = (lx, back, z) => { const p = P(lx, z); return [p[0] - back * E[0], p[1] - back * E[1], z]; };
  const metal = L?.trim ? trim : 'rgb(138,106,68)';
  for (const s of [-1, 1]) {
    const hx = s * half, len = half - GAP;
    // a point `f` of the way from hinge to free edge, at height z
    const at = (f, z) => Q(hx - s * len * f * Math.cos(t), len * f * Math.sin(t), z);
    const quad = (f0, f1, za, zb, col, lift, shades) => emitDecoFill(ctx, cam, [at(f0, zb), at(f1, zb), at(f1, za), at(f0, za)], col, 1, lift, 'streetdoor', true, shades);
    const h = z1 - z0, stile = 0.12;
    quad(0, 1, z0, z1, pane[1], LIFT, pane);
    quad(0, stile, z0, z1, metal, LIFT * 1.5); quad(1 - stile, 1, z0, z1, metal, LIFT * 1.5);
    quad(0, 1, z1 - h * 0.05, z1, metal, LIFT * 1.5); quad(0, 1, z0, z0 + h * 0.16, metal, LIFT * 1.5);
    quad(0, 1, z0 + h * 0.46, z0 + h * 0.49, metal, LIFT * 1.5);
    // the pull: a gold plate by the free edge, with the monogram if the building has one
    const mz = z0 + h * 0.5, mh = h * 0.16;
    emitDecoFill(ctx, cam, [at(0.72, mz + mh / 2), at(0.86, mz + mh / 2), at(0.86, mz - mh / 2), at(0.72, mz - mh / 2)], metal, 1, LIFT * 2, 'streetdoor', true, null, L?.monogram ? monogramSkin(L.monogram, metal) : null);
  }
}

// A PLAIN DOOR: one leaf, behind a steel grille if the building asks for bars (the Cherry Pit), hinged at one jamb and swung in by up to
// about 85 degrees. Whatever the arm baked into the doorway is fixed mass and can't move, so while the leaf is open
// the opening behind it is filled dark, pulled in front of the baked door, and the doorway reads as open.
function barredLeaf(ctx, cam, d, P, open, top, night) {
  const E = d.E, half = d.half, z0 = 0, z1 = top * HEAD, h = z1 - z0;
  const Q = (lx, back, z) => { const p = P(lx, z); return [p[0] - back * E[0], p[1] - back * E[1], z]; };
  if (open > 0.02) {
    const w = half, back = CARD_IN;
    emitDecoFill(ctx, cam, [Q(-w, back, z1), Q(w, back, z1), Q(w, back, z0), Q(-w, back, z0)], night ? 'rgb(34,10,16)' : 'rgb(22,12,14)', 1, CARD_PULL, 'streetdoor', true);
  }
  const t = open * 1.48, hx = half, len = 2 * half - GAP;
  const at = (f, z) => Q(hx - len * f * Math.cos(t), len * f * Math.sin(t), z);
  const quad = (f0, f1, za, zb, col, lift) => emitDecoFill(ctx, cam, [at(f0, zb), at(f1, zb), at(f1, za), at(f0, za)], col, 1, lift, 'streetdoor', true);
  // the leaf's colour is the building's (flags.room.street_door.leaf), else a painted door of no particular colour
  const L = d.look, leaf = shade(L?.leaf || 'rgb(84,74,62)', night ? 0.8 : 1), steel = night ? 'rgb(70,70,74)' : 'rgb(96,96,100)';
  quad(0, 1, z0, z1, leaf, LIFT);
  if (!L?.bars) { quad(0.86, 0.9, z0 + h * 0.46, z0 + h * 0.54, steel, LIFT * 1.5); return; }   // a plain door: a handle
  // the grille: a frame, two rails and five bars in front of the leaf
  quad(0, 0.07, z0, z1, steel, LIFT * 1.5); quad(0.93, 1, z0, z1, steel, LIFT * 1.5);
  quad(0, 1, z1 - h * 0.05, z1, steel, LIFT * 1.5); quad(0, 1, z0, z0 + h * 0.05, steel, LIFT * 1.5);
  quad(0, 1, z0 + h * 0.48, z0 + h * 0.52, steel, LIFT * 1.5);
  for (let i = 1; i <= 5; i++) { const f = 0.07 + i * (0.86 / 6); quad(f - 0.018, f + 0.018, z0, z1, steel, LIFT * 1.5); }
}

// a colour as rgb() scaled by k, from #rrggbb or rgb()
function shade(c, k) {
  let r, g, b;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim());
  if (m) { const n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
  else { const q = String(c).match(/\d+/g) || [128, 128, 128]; [r, g, b] = q.map(Number); }
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
// the pull's plate: a metal plate, darker edge, and the letters on it in a serif, cut a shade darker than the plate
const skins = new Map();
function monogramSkin(text, metal) {
  const key = 'mono|' + text + '|' + metal;
  let sk = skins.get(key);
  if (sk || typeof document === 'undefined') return sk || null;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = shade(metal, 0.6); g.fillRect(0, 0, 64, 128);
  g.fillStyle = metal; g.fillRect(4, 4, 56, 120);
  g.fillStyle = shade(metal, 1.25); g.fillRect(4, 4, 56, 10);
  g.fillStyle = shade(metal, 0.45);
  g.font = 'bold 54px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 66);
  sk = { key, img: cv };
  skins.set(key, sk);
  return sk;
}

// The S pull: a cast gold S on two rosette mounts, over the leaf's own glass, drawn with a lit edge, a shadow side,
// an engraved line down its spine, a ball finial at each end and a scroll curled inside each bowl. `flip` mirrors
// it for the left leaf. ⚠ The card's ground is the glass, since a skin is painted opaque over its quad.
function sHandleSkin(metal, glassCol, flip) {
  const key = 'shandle|' + metal + '|' + glassCol + '|' + (flip ? 1 : 0);
  let sk = skins.get(key);
  if (sk || typeof document === 'undefined') return sk || null;
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = glassCol; g.fillRect(0, 0, 64, 256);
  if (flip) { g.translate(64, 0); g.scale(-1, 1); }
  const hi = shade(metal, 1.45), lo = shade(metal, 0.5), deep = shade(metal, 0.32);
  const S = () => { g.beginPath(); g.moveTo(44, 26); g.bezierCurveTo(8, 10, 6, 112, 32, 128); g.bezierCurveTo(58, 144, 56, 246, 20, 230); };
  // the mounts: a stepped rosette top and bottom, with a stem out to the bar
  for (const y of [40, 216]) {
    g.fillStyle = deep; g.beginPath(); g.arc(32, y, 13, 0, 7); g.fill();
    g.fillStyle = metal; g.beginPath(); g.arc(32, y, 11, 0, 7); g.fill();
    g.fillStyle = lo; for (let i = 0; i < 8; i++) { const t = i * Math.PI / 4; g.beginPath(); g.arc(32 + Math.cos(t) * 8, y + Math.sin(t) * 8, 2, 0, 7); g.fill(); }
    g.fillStyle = hi; g.beginPath(); g.arc(30, y - 2, 4, 0, 7); g.fill();
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  // the shadow it casts on the glass, then the bar: dark edge, body, lit edge, engraved spine
  g.save(); g.translate(3, 4); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 14; S(); g.stroke(); g.restore();
  g.strokeStyle = deep; g.lineWidth = 15; S(); g.stroke();
  g.strokeStyle = metal; g.lineWidth = 11; S(); g.stroke();
  g.save(); g.translate(-2, -1); g.strokeStyle = hi; g.lineWidth = 3; S(); g.stroke(); g.restore();
  g.strokeStyle = lo; g.lineWidth = 1.2; S(); g.stroke();
  // a scroll curled inside each bowl, and fine hatching across the waist
  g.strokeStyle = lo; g.lineWidth = 2;
  g.beginPath(); g.arc(30, 70, 9, 0.2, 4.6); g.stroke();
  g.beginPath(); g.arc(34, 186, 9, 3.3, 7.8); g.stroke();
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(26 + i * 2, 122 + i); g.lineTo(38 + i * 2, 134 + i); g.stroke(); }
  // the finials: a ball at each end with a lit cap
  for (const [x, y] of [[44, 26], [20, 230]]) {
    g.fillStyle = deep; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
    g.fillStyle = metal; g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.fill();
    g.fillStyle = hi; g.beginPath(); g.arc(x - 2.5, y - 2.5, 3, 0, 7); g.fill();
  }
  sk = { key, img: cv };
  skins.set(key, sk);
  return sk;
}
