// STREET DOORS: the door in a building's doorway, for somebody on foot outside it.
//
// The street view on foot (freelook-view.js) hands the frame `v.streetDoors`: each door's tile, the way its front
// faces, its kind (client/shared/street-door.js DOOR_KINDS), the doorway as glass/doorway-measure.js read it off the
// model (where it is along the front, the plane the leaves stand in and the one behind them, its half-width, sill
// and head, in tiles), how it looks, and how far open it is now (0 shut, 1 open). Nothing here decides anything.
// See docs/reference/street-doors.md.
//
// ⚠ DECALS, NOT MASS, for the reason the Clone Facility's doors are: an arm's mass and flats are captured once at a
// frozen clock, and these move with where somebody is standing, which no clock knows. So the model keeps its own
// still door, and this covers it. Drawn from `drawWorldObjects` with the sinks open, depth-tested like any decal.
//
// ⚠ ONE DOOR, NOT TWO. Three things make sure nothing of the model's door shows round or through this one:
//   1. The doorway is the model's own (windshield.js markDoorway), so the leaves fill exactly the opening it drew.
//   2. Behind the leaves the opening is filled: by the room itself where the GPU draws it through the doorway
//      (gl/interiors.js portals, `portals` here), and otherwise by a backing card, the lobby's dim or the dark. Both
//      stand on the doorway's `back` plane, in front of the model's glazing and leaves, and are pulled toward the eye.
//   3. A leaf that swings in goes behind that plane, where the backing would hide it. So every leaf corner is moved
//      along its own line of sight onto the leaves' plane: the same place on the screen, in front of the backing.
const BACK_PULL = 0.035, LEAF_PULL = 0.05, LAYER = 0.0008;
// GAP is per leaf, in tiles: 0.004 was 7 cm a leaf, a 14 cm black slot down the middle of a pair
const GAP = 0.0008, SILL = 0.04, HEAD = 0.94, STILE = 0.06;
// a fanlight takes the doorway's head from FAN_AT up; a runner lies RUNNER_Z off the pavement, RUNNER_OUT (tiles) out
// (or the door's own runner_m, metres). Each layer of it sits a step higher rather than pulled harder toward
// the eye: a big pull on a ground decal slides it about as you walk, and it clipped and flashed.
const FAN_AT = 0.78, RUNNER_Z = 0.003, RUNNER_STEP = 0.0005, RUNNER_PULL = 0.008, RUNNER_OUT = 0.13;
// a revolving door's turn while somebody is at it, radians a second
const REV_SPEED = 1.1;
// a hinged glass leaf's frame stands this far (metres) either side of its glass
const LEAF_TH = 0.035;

import { emitDecoFill } from '../windshield.js';
import { DOOR_KINDS } from '../../../../shared/street-door.js';
import { TILE_M } from '../../../../shared/world-scale.js';

// The kind to draw: the server's, else what the old door record said (a glass pair that slides or swings, or a
// plain leaf with or without its grille).
function kindOf(d) {
  if (d.look?.kind && DOOR_KINDS[d.look.kind]) return d.look.kind;
  if (d.kind && DOOR_KINDS[d.kind]) return d.kind;
  if (d.bars) return d.look?.bars ? 'grille' : 'plain';
  return d.swing ? 'swing' : 'sliding';
}

export function drawStreetDoors(ctx, cam, v, now, night, portals = null) {
  const doors = v.streetDoors;
  if (!doors || !doors.length || !v.mapCenter) return;
  const ox = v.mapCenter.x + ((v.mapOffset && v.mapOffset.x) || 0);
  const oy = v.mapCenter.y + ((v.mapOffset && v.mapOffset.y) || 0);
  // the eye, in the frame the corners are in (emitDecoFill's sum), for the leaves' projection onto their plane
  const eye = Number.isFinite(cam.fx) && Number.isFinite(cam.EH) ? [cam.fx - (cam.back || 0) * (cam.sinh || 0), cam.fy + (cam.back || 0) * (cam.cosh || 0), cam.EH] : null;
  const glass = night ? ['rgb(206,204,198)', 'rgb(140,138,132)'] : ['rgb(170,168,162)', 'rgb(80,78,74)'];
  const rail = night ? 'rgb(96,84,62)' : 'rgb(122,104,74)';
  for (const d of doors) {
    const E = d.E, half = d.half, top = d.top;
    if (!E || !(half > 0.01) || !(top > 0.01)) continue;
    // the model's own door and its animation stand (flags.room.street_door.own: the clone arm's)
    if (d.look?.own) continue;
    const kind = kindOf(d), K = DOOR_KINDS[kind], L = d.look || null;
    const cx = d.cx || 0, sill = d.sill || 0, H = top - sill;
    // the model's own frame: y out of the front, x along it (windshield.js facePt), about the doorway's middle
    const at = (lx, ly, z) => [d.x - ox + (lx + cx) * E[1] + ly * E[0], d.y - oy - (lx + cx) * E[0] + ly * E[1], z];
    const P = (lx, z) => at(lx, d.plane, z);
    // a point moved onto the leaves' plane along the line from the eye (see the ⚠ above), `layer` steps nearer
    const n = [E[0], E[1]], c0 = n[0] * P(0, 0)[0] + n[1] * P(0, 0)[1];
    const onPlane = (p, layer) => {
      if (!eye) return p;
      const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2], den = n[0] * dx + n[1] * dy;
      if (Math.abs(den) < 1e-6) return p;
      const t = (c0 - n[0] * eye[0] - n[1] * eye[1]) / den, len = Math.hypot(dx, dy, dz) * t;
      if (!(t > 0) || !(len > 1e-4)) return p;
      const k = t * Math.max(0.5, 1 - (layer * LAYER) / len);
      return [eye[0] + dx * k, eye[1] + dy * k, eye[2] + dz * k];
    };
    // one quad of the door: corners in the doorway's frame, drawn on the leaves' plane
    const Q = (pts, fill, alpha = 1, layer = 1, ramp = null, skin = null) =>
      emitDecoFill(ctx, cam, pts.map((p) => onPlane(p, layer)), fill, alpha, LEAF_PULL, 'streetdoor', true, ramp, skin);
    const open = Math.max(0, Math.min(1, d.open || 0)), z0 = sill + H * SILL, z1 = sill + H * HEAD;

    // ── 2. WHAT FILLS THE OPENING ─────────────────────────────────────────────────────────────
    // The room through the doorway where the GPU draws it; else the lobby as last seen from here (lobby-still.js),
    // the dark for a dark door (flags.room.street_door.dark: the Cherry Pit's, the Embassy's), or a lobby's dim.
    // ⚠ ALWAYS ONE OR THE OTHER: with neither, the model's own still door is what you see through the glass.
    const portal = !!(portals && portals.has(d.x + ',' + d.y));
    if (!portal) {
      const back = d.back ?? d.plane - 0.006, B = (lx, z) => at(lx, back, z);
      const quad = [B(-half, top), B(half, top), B(half, sill), B(-half, sill)];
      if (L?.dark) emitDecoFill(ctx, cam, quad, 'rgb(5,5,7)', 1, BACK_PULL, 'streetdoor', true);
      else if (d.card) emitDecoFill(ctx, cam, quad, night ? 'rgb(70,64,52)' : 'rgb(96,88,74)', 1, BACK_PULL, 'lobbycard', true, null, d.card);
      else emitDecoFill(ctx, cam, quad, night ? 'rgb(112,94,68)' : 'rgb(30,30,32)', 1, BACK_PULL, 'streetdoor', true, night ? ['rgb(150,128,92)', 'rgb(84,70,50)'] : ['rgb(40,40,44)', 'rgb(20,20,22)']);
    }
    // a runner out of the door across the pavement (flags.room.street_door.runner, a colour), from the doorway's foot
    // to a couple of metres out, with a gilt edge either side. Flat on the ground, so not projected.
    if (L?.runner) {
      const out = L.runner_m ? L.runner_m / TILE_M : RUNNER_OUT, w = half * 0.72, y0 = d.plane - 0.004, y1 = d.plane + out;
      const R = (x0, x1, a, b, k, fill, ramp = null) => {
        const G = (lx, ly) => at(lx, ly, RUNNER_Z + k * RUNNER_STEP);
        emitDecoFill(ctx, cam, [G(x0, b), G(x1, b), G(x1, a), G(x0, a)], fill, 1, RUNNER_PULL, 'streetdoor', true, ramp);
      };
      const lit = night ? 0.72 : 1, cloth = shade(L.runner, lit), pile = [shade(L.runner, lit * 1.12), shade(L.runner, lit * 0.86)];
      const bind = shade(L.runner, lit * 0.45), gilt = night ? 'rgb(168,132,66)' : 'rgb(206,166,86)', brass = night ? 'rgb(196,160,92)' : 'rgb(222,190,118)';
      R(-w, w, y0, y1, 0, cloth, pile);                                                   // the wool, lighter by the door
      for (const s of [-1, 1]) {
        R(s * w, s * w * 0.95, y0, y1, 1, bind);                                         // the dark binding down each edge
        R(s * w * 0.86, s * w * 0.9, y0, y1, 2, gilt);                                   // a gold band just in from it
        R(s * w * 0.8, s * w * 0.815, y0, y1, 2, gilt);                                  // and a thin one inside that
      }
      R(-w, w, y1 - 0.006, y1, 1, bind);                                                 // the bound end at the kerb
      R(-w * 0.9, w * 0.9, y1 - 0.0045, y1 - 0.0025, 2, brass);                          // a brass rod holding it down
    }
    if (d.glass === false && K.glass) continue;

    // ── 3. THE LEAVES, BY KIND ────────────────────────────────────────────────────────────────
    // the glass's tint (flags.room.street_door.glass), darker with the dark behind it; the metal round each leaf
    const dark = L?.dark && !portal, dim = dark ? 0.38 : 1, tint = L?.glass ? shade(L.glass, (night ? 1.25 : 1) * dim) : (dark ? shade('#5a6e74', dim) : null);
    // the pane is clear: a tint keeps its brightness and loses its hue, so no door reads as painted blue
    // at night it takes the lobby's lamplight, the amber of the lit windows round it
    const pane = (tint ? [grey(tint, 1.35), grey(tint, 1)] : glass).map((c) => (night ? warm(c) : c)), trim = L?.trim ? shade(L.trim, night ? 0.85 : 1) : rail;
    const see = portal ? (night ? 0.24 : 0.34) : (d.card ? 0.28 : 0.6);
    // a door the model drew no doorway for (fit 'room': the room's own width on a plain wall or a curtain of glass)
    // gets a frame of its own, jambs and a head, so it's set in the wall and doesn't float on it
    if (d.fit === 'room') {
      const fw = Math.max(half * 0.09, 0.003);
      Q([P(-half - fw, top + fw), P(-half, top + fw), P(-half, sill), P(-half - fw, sill)], trim, 1, 3);
      Q([P(half, top + fw), P(half + fw, top + fw), P(half + fw, sill), P(half, sill)], trim, 1, 3);
      Q([P(-half - fw, top + fw), P(half + fw, top + fw), P(half + fw, top), P(-half - fw, top)], trim, 1, 3);
    }
    const D = { d, Q, P, at, half, top, sill, z0, z1, open, pane, trim, L, night, see, now, eye };
    if (K.move === 'revolve') revolving(D);
    else if (K.move === 'slide') slidingPair(D);
    else if (K.glass) hingedGlass(D, K.leaves);
    else paintedLeaf(D, kind === 'grille');
  }
}

// Two leaves that slide into the wall either side: each one's inner edge moves out and its outer edge stays, so open
// it's a sliver against the jamb.
function slidingPair({ Q, P, half, top, z0, z1, open, pane, trim, L, see }) {
  for (const s of [-1, 1]) {
    const inner = GAP + (half - GAP) * open * 0.92, outer = half;
    if (outer - inner < 0.002) continue;
    const a = s * inner, b = s * outer, w = (outer - inner) * STILE;
    Q([P(a, z1), P(b, z1), P(b, z0), P(a, z0)], pane[1], Math.max(see, 0.5), 0, pane);
    // the meeting stile, so a leaf reads as a leaf while it slides
    Q([P(a, z1), P(a + s * w, z1), P(a + s * w, z0), P(a, z0)], trim, 1, 1);
    if (!L) continue;
    // the trim: a rail along the head and the foot of the leaf and a stile at its outer edge
    const t = (z1 - z0) * 0.035, tw = half * 0.05;
    Q([P(a, z1), P(b, z1), P(b, z1 - t), P(a, z1 - t)], trim, 1, 1);
    Q([P(a, z0 + t * 2.5), P(b, z0 + t * 2.5), P(b, z0), P(a, z0)], trim, 1, 1);
    Q([P(b - s * tw, z1), P(b, z1), P(b, z0), P(b - s * tw, z0)], trim, 1, 1);
    // the S pull (flags.room.street_door.handle 's'): a tall cast handle by the meeting stile, the two leaves'
    // mirrored so the pair meets as a figure. It rides with the leaf.
    const zs = z0 + (top - z0) * 0.5;
    if (L.handle === 's') {
      const hw = half * 0.13, x0 = a + s * (w + half * 0.02), x1 = x0 + s * hw, hh = (top - z0) * 0.42;
      if (Math.abs(x1) <= outer) { const [l, r] = s < 0 ? [x1, x0] : [x0, x1]; Q([P(l, zs + hh / 2), P(r, zs + hh / 2), P(r, zs - hh / 2), P(l, zs - hh / 2)], trim, 1, 2, null, sHandleSkin(trim, pane[1], s < 0)); }
    } else if (L.monogram) {
      const hw = half * 0.16, x0 = a + s * (w + half * 0.03), x1 = x0 + s * hw, zm = z0 + (top - z0) * 0.47, hh = (top - z0) * 0.17;
      if (Math.abs(x1) <= outer) { const [l, r] = s < 0 ? [x1, x0] : [x0, x1]; Q([P(l, zm + hh / 2), P(r, zm + hh / 2), P(r, zm - hh / 2), P(l, zm - hh / 2)], trim, 1, 2, null, monogramSkin(L.monogram, trim)); }
    }
  }
}

// Glazed leaves hinged at the jambs, each a metal-framed pane with a middle rail and a kick plate, turned in by up to
// 80 degrees: a pair meeting in the middle (`swing`) or one leaf across the whole opening (`single`).
function hingedGlass({ d, Q, P, at, half, top, z0, z1: zHead, open, pane, trim, L, see: see0, eye }, leaves) {
  // black glass (a tint near black: the Solenne's) reads as black, not as a faint veil over the room
  const lum = L?.glass ? (shade(L.glass, 1).match(/\d+/g) || [255, 255, 255]).map(Number).reduce((a, b) => a + b, 0) / 3 : 255;
  const see = lum < 24 ? Math.max(see0, 0.78) : see0;
  const t = open * 1.4, metal = L?.trim ? trim : 'rgb(138,106,68)';
  const z1 = L?.fanlight ? d.sill + (top - d.sill) * FAN_AT : zHead;
  // the fanlight over the leaves: a transom rail, the frame, and glazing bars fanned from the middle of the rail
  if (L?.fanlight) {
    const zt = z1 + (top - d.sill) * 0.025, bar = (top - d.sill) * 0.022;
    Q([P(-half, zt), P(half, zt), P(half, z1), P(-half, z1)], metal, 1, 1);
    Q([P(-half, top), P(half, top), P(half, zt), P(-half, zt)], pane[1], see, 0, pane);
    Q([P(-half, top), P(half, top), P(half, top - bar), P(-half, top - bar)], metal, 1, 1);
    for (let i = 0; i < 7; i++) {
      // a bar from the rail's middle out to the head and the jambs, thin at the hub and wider where it lands
      const a = Math.PI * (i + 1) / 8, ex = -Math.cos(a), ez = Math.sin(a), span = top - zt;
      const rx = Math.min(half / Math.max(Math.abs(ex), 1e-3), span / Math.max(ez, 1e-3));
      const x1 = ex * rx, zz = zt + ez * rx, w0 = half * 0.008, w1 = half * 0.022, nx = ez, nz = -ex;
      Q([P(-nx * w0, zt - nz * w0), P(nx * w0, zt + nz * w0), P(x1 + nx * w1, zz + nz * w1), P(x1 - nx * w1, zz - nz * w1)], metal, 1, 1);
    }
  }
  const sides = leaves === 1 ? [-1] : [-1, 1];
  for (const s of sides) {
    const hx = s * half, len = leaves === 1 ? 2 * half - GAP : half - GAP;
    // a point `f` of the way from hinge to free edge, at height z: turned in about the hinge, behind the plane
    // `o` is tiles off the leaf's middle along its normal, for the frame's depth. The leaf is shortened by its own
    // half-thickness at the hinge, so a box turned in about the jamb stays inside the opening.
    const T = LEAF_TH / TILE_M, nx = Math.sin(t), ny = -s * Math.cos(t), L0 = T * 1.2, ln = len - L0;
    const pt = (f, z, o = 0) => at(hx - s * (L0 + ln * f) * Math.cos(t) + nx * o, d.plane - (L0 + ln * f) * Math.sin(t) + ny * o, z);
    const quad = (f0, f1, za, zb, col, layer, ramp, a = 1, skin = null, o = 0) => Q([pt(f0, zb, o), pt(f1, zb, o), pt(f1, za, o), pt(f0, za, o)], col, a, layer, ramp, skin);
    const h = z1 - z0, stile = leaves === 1 ? 0.06 : 0.12, zm = (z0 + z1) / 2;
    // which face of the leaf the eye sees: the frame's front is drawn on that side, its edges only where they face it
    const sees = (from, to) => !eye || ((to[0] - from[0]) * (eye[0] - to[0]) + (to[1] - from[1]) * (eye[1] - to[1]) + (to[2] - from[2]) * (eye[2] - to[2])) > 0;
    const sg = sees(pt(0.5, zm, 0), pt(0.5, zm, T)) ? 1 : -1;
    // ⚠ 3-D METAL, STILL DECALS: a bar is a box th tiles either side of the glass. Its edges are drawn first, shaded,
    // then its face, so the frame stands proud of the glass and the glass sits back in it.
    const bar = (f0, f1, za, zb, col, layer, th = T, skin = null) => {
      const fm = (f0 + f1) / 2, zc = (za + zb) / 2, side = shade(col, 0.55), top = shade(col, 1.3), foot = shade(col, 0.4);
      const edge = (pts, c) => Q(pts, c, 1, layer);
      if (sees(pt(fm, zc), pt(f0, zc))) edge([pt(f0, zb, -th), pt(f0, zb, th), pt(f0, za, th), pt(f0, za, -th)], side);
      if (sees(pt(fm, zc), pt(f1, zc))) edge([pt(f1, zb, -th), pt(f1, zb, th), pt(f1, za, th), pt(f1, za, -th)], side);
      if (sees(pt(fm, zc), pt(fm, zb))) edge([pt(f0, zb, -th), pt(f1, zb, -th), pt(f1, zb, th), pt(f0, zb, th)], top);
      if (sees(pt(fm, zc), pt(fm, za))) edge([pt(f0, za, -th), pt(f1, za, -th), pt(f1, za, th), pt(f0, za, th)], foot);
      quad(f0, f1, za, zb, col, layer + 0.5, null, 1, skin, sg * th);
    };
    // ⚠ SEE-THROUGH GLASS: the room (or the dark) shows through it, a little darkened
    quad(0, 1, z0, z1, pane[1], 0, pane, see);
    bar(0, stile, z0, z1, metal, 1); bar(1 - stile, 1, z0, z1, metal, 1);
    bar(stile, 1 - stile, z1 - h * 0.05, z1, metal, 1); bar(stile, 1 - stile, z0, z0 + h * 0.16, metal, 1);
    if (L?.handle !== 's') bar(stile, 1 - stile, z0 + h * 0.46, z0 + h * 0.49, metal, 1);
    if (L?.handle === 's') {
      // ORNATE: a lit bead inset round the glass, a raised kick plate with the monogram in a medallion, and the tall
      // cast S pull by the free edge on two posts, the pair's mirrored so the two meet as a figure (sHandleSkin)
      const bead = shade(metal, 1.4), deep = shade(metal, 0.62), e = 0.014, bt = T * 0.45;
      bar(stile, stile + e, z0 + h * 0.16, z1 - h * 0.05, bead, 2, bt); bar(1 - stile - e, 1 - stile, z0 + h * 0.16, z1 - h * 0.05, bead, 2, bt);
      bar(stile + e, 1 - stile - e, z1 - h * 0.06, z1 - h * 0.05, bead, 2, bt);
      bar(stile + e, 1 - stile - e, z0 + h * 0.16, z0 + h * 0.17, bead, 2, bt);
      bar(0.12, 0.88, z0 + h * 0.03, z0 + h * 0.13, deep, 3, T * 1.25);
      if (L.monogram) quad(s > 0 ? 0.58 : 0.42, s > 0 ? 0.42 : 0.58, z0 + h * 0.04, z0 + h * 0.12, metal, 4, null, 1, monogramSkin(L.monogram, metal), sg * T * 1.3);
      const f0 = leaves === 1 ? 0.8 : 0.7, f1 = leaves === 1 ? 0.9 : 0.86, mz = z0 + h * 0.56, mh = h * 0.42, fp = (f0 + f1) / 2, pw = (f1 - f0) * 0.12;
      // the posts it stands off the glass on, then the cast S itself out in front of the frame
      for (const zq of [mz - mh * 0.38, mz + mh * 0.38]) bar(fp - pw, fp + pw, zq - h * 0.012, zq + h * 0.012, metal, 4, T * 2.2);
      quad(f0, f1, mz - mh / 2, mz + mh / 2, metal, 5, null, 1, sHandleSkin(metal, pane[1], s > 0), sg * T * 2.3);
      continue;
    }
    // the pull: a plate by the free edge, with the monogram if the building has one
    const mz = z0 + h * 0.5, mh = h * 0.16, f0 = leaves === 1 ? 0.84 : 0.72, f1 = leaves === 1 ? 0.92 : 0.86;
    // ⚠ a right leaf runs from its hinge leftward, so its plate's corners go the other way or the letter reads backwards
    bar(s > 0 ? f1 : f0, s > 0 ? f0 : f1, mz - mh / 2, mz + mh / 2, metal, 2, T * 1.4, L?.monogram ? monogramSkin(L.monogram, metal) : null);
  }
}

// A painted leaf, or a steel grille for a door (`grille`, the Cherry Pit's), hinged at one jamb and swung in by up to
// about 85 degrees when F opens it. The leaf's colour is the building's (flags.room.street_door.leaf).
// ⚠ A GRILLE IS THE CAGE ALONE, NO LEAF: it swings open itself, the room (or the dark) showing between its bars.
// ⚠ A PAINTED LEAF HAS A LIGHT IN IT (flags.room.street_door.lite), so the room shows through every door as it does
// through the Cherry Pit's bars. The leaf is drawn as the wood round a hole and the backing (or the room) shows in
// the hole under a faint pane: 'porthole' a round window in a ring (a club's), 'half' the top half glazed in four
// lights (a shed's or a back door's), 'slot' a tall narrow vision strip. No lite is a 'slot'.
function paintedLeaf({ d, Q, at, half, top, sill, open, L, night, pane, trim, see }, grille) {
  const z0 = sill, z1 = sill + (top - sill) * HEAD, h = z1 - z0, t = open * 1.48, hx = half, len = 2 * half - GAP;
  const pt = (f, z) => at(hx - len * f * Math.cos(t), d.plane - len * f * Math.sin(t), z);
  const quad = (f0, f1, za, zb, col, layer, a = 1, ramp = null) => Q([pt(f0, zb), pt(f1, zb), pt(f1, za), pt(f0, za)], col, a, layer, ramp);
  const poly = (fz, col, layer, a = 1, ramp = null) => Q(fz.map(([f, z]) => pt(f, z)), col, a, layer, ramp);
  const leaf = shade(L?.leaf || 'rgb(84,74,62)', night ? 0.8 : 1), steel = night ? 'rgb(70,70,74)' : 'rgb(96,96,100)';
  if (!grille) {
    const lite = L?.lite || 'slot', rim = L?.trim ? trim : shade(leaf, 1.6), glassA = Math.min(see, 0.45);
    // the hole, as fractions across the leaf (f) and heights (z), by style
    const [f0, f1, za, zb] = lite === 'porthole' ? [0.26, 0.74, z0 + h * 0.56, z0 + h * 0.56 + len * 0.48]
      : lite === 'half' ? [0.12, 0.88, z0 + h * 0.52, z1 - h * 0.06] : [0.4, 0.6, z0 + h * 0.42, z1 - h * 0.1];
    const zt = Math.min(zb, z1 - h * 0.05);
    // the wood round the hole: below, above, either side
    quad(0, 1, z0, za, leaf, 0); quad(0, 1, zt, z1, leaf, 0);
    quad(0, f0, za, zt, leaf, 0); quad(f1, 1, za, zt, leaf, 0);
    if (lite === 'porthole') {
      // the hole's corners filled back in to an octagon, then a ring of trim round it
      const cf = (f1 - f0) * 0.29, cz = (zt - za) * 0.29;
      poly([[f0, zt], [f0 + cf, zt], [f0, zt - cz], [f0, zt - cz]], leaf, 0);
      poly([[f1 - cf, zt], [f1, zt], [f1, zt - cz], [f1, zt - cz]], leaf, 0);
      poly([[f0, za + cz], [f0, za + cz], [f0 + cf, za], [f0, za]], leaf, 0);
      poly([[f1, za + cz], [f1, za + cz], [f1, za], [f1 - cf, za]], leaf, 0);
      poly([[f0 + cf, zt], [f1 - cf, zt], [f1, zt - cz], [f1, za + cz], [f1 - cf, za], [f0 + cf, za], [f0, za + cz], [f0, zt - cz]], pane[1], 0, glassA, pane);
      const r = 0.035, rz = (zt - za) * 0.07, ring = [[f0 + cf, zt], [f1 - cf, zt], [f1, zt - cz], [f1, za + cz], [f1 - cf, za], [f0 + cf, za], [f0, za + cz], [f0, zt - cz]];
      for (let i = 0; i < 8; i++) {
        const [a, b] = [ring[i], ring[(i + 1) % 8]], mid = [(f0 + f1) / 2, (za + zt) / 2];
        const out = (p) => [p[0] + Math.sign(p[0] - mid[0]) * r * (Math.abs(p[0] - mid[0]) > 1e-4 ? 1 : 0), p[1] + Math.sign(p[1] - mid[1]) * rz * (Math.abs(p[1] - mid[1]) > 1e-4 ? 1 : 0)];
        poly([a, b, out(b), out(a)], rim, 1);
      }
    } else {
      quad(f0, f1, za, zt, pane[1], 0, glassA, pane);
      // the beading round the glass, and for a half-glazed leaf the bars that make it four lights
      const bw = 0.02, bz = h * 0.012;
      quad(f0 - bw, f0, za, zt, rim, 1); quad(f1, f1 + bw, za, zt, rim, 1);
      quad(f0, f1, za - bz, za, rim, 1); quad(f0, f1, zt, zt + bz, rim, 1);
      if (lite === 'half') {
        const fm = (f0 + f1) / 2, zm = (za + zt) / 2;
        quad(fm - bw / 2, fm + bw / 2, za, zt, rim, 1); quad(f0, f1, zm - bz / 2, zm + bz / 2, rim, 1);
        // a ledge rail across the boarded bottom half, so it reads as a ledged door
        quad(0.04, 0.96, z0 + h * 0.2, z0 + h * 0.24, shade(leaf, 0.7), 1);
      }
    }
    quad(0.86, 0.9, z0 + h * 0.4, z0 + h * 0.48, steel, 1);
    return;
  }
  // the grille: a frame, two rails and five bars
  quad(0, 0.07, z0, z1, steel, 1); quad(0.93, 1, z0, z1, steel, 1);
  quad(0, 1, z1 - h * 0.05, z1, steel, 1); quad(0, 1, z0, z0 + h * 0.05, steel, 1);
  quad(0, 1, z0 + h * 0.48, z0 + h * 0.52, steel, 1);
  for (let i = 1; i <= 5; i++) { const f = 0.07 + i * (0.86 / 6); quad(f - 0.018, f + 0.018, z0, z1, steel, 1); }
}

// A REVOLVING DOOR: four glass wings on a post, turning in a drum of curved glass under a round canopy. It turns
// while somebody is at it (`open`), and stops where it is. The drum is centred a little behind the doorway's plane,
// as wide as the opening; its two curved walls close the sides and the front and back are open.
// Each part is drawn in the order of its own distance from the eye, far first, so a wing passes behind the post.
const spins = new Map();
function revolving({ d, Q, at, half, top, z0, z1, open, pane, trim, now, eye }) {
  const key = d.x + ',' + d.y, was = spins.get(key) || { a: 0.3, t: now };
  const dt = Math.min(0.1, Math.max(0, (now - was.t) / 1000));
  const s = { a: was.a + dt * REV_SPEED * open, t: now };
  spins.set(key, s);
  if (spins.size > 32) spins.delete(spins.keys().next().value);
  const R = half, cy = d.plane - R * 0.55, C = (a, r, z) => at(Math.cos(a) * r, cy + Math.sin(a) * r, z);
  // ⚠ THE GLASS IS FAINT AND THE METAL IS HEAVY. Every pane is seen through two or three others, so glass as dense as
  // a sliding door's washed the whole drum to one pale sheet; the frames are what say it's a revolving door.
  const zw = z0 + (top - z0) * 0.86, h = zw - z0, parts = [];
  const push = (pts, col, alpha, ramp) => parts.push({ pts, col, alpha, ramp, m: pts.reduce((q, p) => [q[0] + p[0] / pts.length, q[1] + p[1] / pts.length], [0, 0]) });
  // the drum's walls: an arc either side, 50 degrees each way of the jambs' line, in four panes with a mullion each
  for (const mid of [0, Math.PI]) {
    for (let i = 0; i < 4; i++) {
      const a0 = mid - 0.87 + i * 0.435, a1 = a0 + 0.435;
      push([C(a0, R, zw), C(a1, R, zw), C(a1, R, z0), C(a0, R, z0)], pane[1], 0.2, pane);
      push([C(a0, R, zw), C(a0 + 0.07, R, zw), C(a0 + 0.07, R, z0), C(a0, R, z0)], trim, 1);
    }
    push([C(mid + 0.87 - 0.07, R, zw), C(mid + 0.87, R, zw), C(mid + 0.87, R, z0), C(mid + 0.87 - 0.07, R, z0)], trim, 1);
  }
  // the wings, each a glass pane in a frame with a push bar, and the post they turn on
  for (let k = 0; k < 4; k++) {
    const a = s.a + k * Math.PI / 2, r = R * 0.97, w = R * 0.06, bar = h * 0.05;
    push([C(a, 0, zw), C(a, r, zw), C(a, r, z0), C(a, 0, z0)], pane[1], 0.28, pane);
    push([C(a, r - w, zw), C(a, r, zw), C(a, r, z0), C(a, r - w, z0)], trim, 1);
    push([C(a, 0, zw), C(a, r, zw), C(a, r, zw - bar), C(a, 0, zw - bar)], trim, 1);
    push([C(a, 0, z0 + h * 0.1), C(a, r, z0 + h * 0.1), C(a, r, z0), C(a, 0, z0)], trim, 1);
    push([C(a, r * 0.3, z0 + h * 0.5), C(a, r * 0.85, z0 + h * 0.5), C(a, r * 0.85, z0 + h * 0.47), C(a, r * 0.3, z0 + h * 0.47)], trim, 1);
  }
  push([C(0, R * 0.05, zw), C(Math.PI, R * 0.05, zw), C(Math.PI, R * 0.05, z0), C(0, R * 0.05, z0)], trim, 1);
  // the canopy: the drum's top band from the head of the wings to the doorway's head, in twelve facets
  for (let i = 0; i < 12; i++) {
    const a0 = i * Math.PI / 6, a1 = a0 + Math.PI / 6;
    push([C(a0, R * 1.03, top), C(a1, R * 1.03, top), C(a1, R * 1.03, zw), C(a0, R * 1.03, zw)], trim, 1);
  }
  // far first: the layer each part is pulled by rises as it comes nearer, and the painter draws them in this order
  if (eye) {
    const dist = (p) => Math.hypot(p.m[0] - eye[0], p.m[1] - eye[1]);
    parts.sort((p, q) => dist(q) - dist(p));
  }
  parts.forEach((p, i) => Q(p.pts, p.col, p.alpha, i * 0.25, p.ramp || null));
}

// a colour as a warm-neutral grey of its own brightness, scaled by k
function grey(c, k) {
  const [r, g, b] = (shade(c, 1).match(/\d+/g) || [128, 128, 128]).map(Number), y = 0.3 * r + 0.59 * g + 0.11 * b;
  return shade(`rgb(${y * 1.03},${y},${y * 0.95})`, k);
}
// a grey pane lit from behind by lamps: the same brightness, gone amber
function warm(c) {
  const [r, g, b] = (shade(c, 1).match(/\d+/g) || [128, 128, 128]).map(Number);
  return shade(`rgb(${r * 1.18},${g},${b * 0.62})`, 1);
}
// a colour as rgb() scaled by k, from #rrggbb or rgb()
function shade(c, k) {
  let r, g, b;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim());
  if (m) { const n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
  // ⚠ DECIMALS: grey() hands this rgb(66.95,65,61.75), and \d+ alone read that as 66, 95, 65: a lime green door
  else { const q = String(c).match(/\d+(?:\.\d+)?/g) || [128, 128, 128]; [r, g, b] = q.map(Number); }
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
  const hi = shade(metal, 1.45), lo = shade(metal, 0.5);   // no dark outline round the gold
  const S = () => { g.beginPath(); g.moveTo(44, 26); g.bezierCurveTo(8, 10, 6, 112, 32, 128); g.bezierCurveTo(58, 144, 56, 246, 20, 230); };
  // the mounts: a stepped rosette top and bottom, with a stem out to the bar
  for (const y of [40, 216]) {
    g.fillStyle = metal; g.beginPath(); g.arc(32, y, 11, 0, 7); g.fill();
    g.fillStyle = lo; for (let i = 0; i < 8; i++) { const t = i * Math.PI / 4; g.beginPath(); g.arc(32 + Math.cos(t) * 8, y + Math.sin(t) * 8, 2, 0, 7); g.fill(); }
    g.fillStyle = hi; g.beginPath(); g.arc(30, y - 2, 4, 0, 7); g.fill();
  }
  g.lineCap = 'round'; g.lineJoin = 'round';
  // the shadow it casts on the glass, then the bar: dark edge, body, lit edge, engraved spine
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
    g.fillStyle = metal; g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.fill();
    g.fillStyle = hi; g.beginPath(); g.arc(x - 2.5, y - 2.5, 3, 0, 7); g.fill();
  }
  sk = { key, img: cv };
  skins.set(key, sk);
  return sk;
}
