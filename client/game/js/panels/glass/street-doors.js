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
    if (d.glass === false) continue;
    // a building can dress its doors (flags.room.street_door, via plugins/roomstage): the glass's tint, a metal trim
    // round each leaf and a monogram on the pull handle. Without, the plain glass and bronze stile.
    const L = d.look, tint = L?.glass ? shade(L.glass, night ? 1.25 : 1) : null;
    const pane = tint ? [shade(tint, 1.35), tint] : glass, trim = L?.trim ? shade(L.trim, night ? 0.85 : 1) : rail;
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
      // the pull: a gold plate with the monogram on it, by the meeting stile at hand height. It rides with the leaf.
      if (L.monogram) {
        const hw = half * 0.16, x0 = a + s * (w + half * 0.03), x1 = x0 + s * hw, zm = top * 0.47, hh = top * 0.17;
        if (Math.abs(x1) <= outer) {
          const [l, r] = s < 0 ? [x1, x0] : [x0, x1];
          emitDecoFill(ctx, cam, [P(l, zm + hh / 2), P(r, zm + hh / 2), P(r, zm - hh / 2), P(l, zm - hh / 2)], trim, 1, LIFT * 2, 'streetdoor', true, null, monogramSkin(L.monogram, trim));
        }
      }
    }
  }
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
