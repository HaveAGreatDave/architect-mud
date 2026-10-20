// The Ashway: building-model arms for the haul road's side of the south wall.
//
// Every arm takes drawTypeModelArm's arguments and its prologue locals, in this order:
//   (ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis)
// How a tile becomes a building is in docs/reference/world-rendering.md.
import { faceAway,
  DETAIL_LIFT, FACE_EPS, bakeSignText, clamp, draw3DBoxAt, drawBarrelRoof, drawFacetDrum,
  drawSmoke, emitSurfaceText, emitWire, faceYaw, glowPool, nearOrMesh, rgb, windFlag,
} from '../../windshield.js';
import { flatOut } from './downtown.js';
import { paintLayers, settCanvas } from '../../club-crest.js';
import { CPHL_CRESTS } from '../../../../../shared/cphl-crests.js';

// ── GOLDEN GOOSE GARDENS: SIX TILES, ONE BUILDING ────────────────────────────────────────────
// The CPhL's own barn (scripts/content/slush-fund.mjs, docs/proposals/slush-fund.md; it opened as
// The Slush Fund, which is why the ids say `slush`). A brick arena built like a basilica: a hall two
// tiles long down the middle, under one barrel vault the length of the rink, with a lower stand
// either side of it. The hall's front tile is the door (`ice_rink`), its back tile is
// `ice_rink_hall`, and the four stands share `ice_rink_wing`, told apart by their registry rows
// (which side the hall is on, which end, what their outer face is). A gilt goose stands on the front
// gable, and the east stand's front carries a shield for every club in the league.
//
// Every tile faces north, so local +y is north for all six and local +x is west. The hall runs
// from y = RINK.FRONT on the front tile to y = RINK.BACK on the back one; each half of the vault
// runs to its tile's edge and meets the other there, profile to profile.
//
// ⚠ THE WHOLE BUILDING IS IN CONSTANTS, NOT fh AND h. Both are rolled per tile, and six tiles sized
// off them would come out at six heights with steps at every joint (the terminal's ⚠ in
// downtown.js). The tiles carry `floors` 5 and 2 so collision and the skyline read the same mass.
// ⚠ A BOX IS NEVER WIDER THAN 0.44 A SIDE (draw3DBoxAt's cap), so everything that runs to a tile edge
// goes through `span`, which cuts it into pieces that fit.
// ⚠ NO KIT (the registry rows carry `noKit`). The kit hangs shopfronts and shutters on unyawed
// boxes; on a stand it would put a works ground floor across the box office.
const RINK = {
  WING: 0.40,       // the stands' flat roofs
  TOP: 0.62,        // the hall's eaves
  ARCH: 0.30,       // the vault's rise above the eaves
  FRONT: 0.36,      // the hall's front wall, on the front tile
  BACK: -0.36,      // its back wall, on the back tile
  EAVE: 0.012,      // how far the vault runs past each gable
  PLINTH: 0.035,
  PARA: 0.022,      // the stands' parapet
};
// The great window in the front gable: a straight-sided opening with an arched head inside the
// vault's own arch.
const GW = { HW: 0.36, Z0: 0.37, RISE: 0.22 };
// The clerestory, one window every eighth of the hall's length, mirrored on the back tile so the
// rhythm runs on across the joint.
const CLR = [0.2525, 0.0375, -0.1775, -0.3925];
const ROOF_RGB = [92, 108, 118];           // weathered standing-seam steel
const ICE_DAY = [104, 132, 150], ICE_NIGHT = [214, 232, 240];   // glass by day (the sky in it), and lit by the ice lights
const WARM_DAY = [58, 62, 64], WARM_NIGHT = [255, 214, 152]; // the concourse and the box office
const BRICK = 'ty_unit_brick', BRICK_DK = 'ty_oc_brick_dk', STEEL = 'ty_fab_steel', STONE = 'ty_precast', STONE_DK = 'ty_precast_dk';
const BAR = 'rgba(28,32,36,0.92)';

const mixRgb = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
// A box over local x0..x1, y0..y1, cut into pieces no wider than the 0.44 cap allows.
function span(ctx, cam, F, E, x0, x1, y0, y1, z0, z1, pal, seed, night, alpha, roof) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / 0.88 - 1e-9)), ny = Math.max(1, Math.ceil((y1 - y0) / 0.88 - 1e-9));
  const yaw = faceYaw(E), sx = (x1 - x0) / nx, sy = (y1 - y0) / ny;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const [cx, cy] = F(x0 + sx * (i + 0.5), y0 + sy * (j + 0.5));
    draw3DBoxAt(ctx, cam, cx, cy, sx / 2, z0, z1, pal, seed + i * 7 + j * 13, night, alpha, roof, yaw, sy / 2);
  }
}
// Does the wall with local outward normal (nx, ny) through local point (px, py) face the eye?
// ⚠ EVERY STROKE AND EVERY WORD OFF THE FRONT ASKS THIS. A stroke has nothing to cull it, so on
// the 2-D painter it draws straight through the building (the gym's ⚠ in yards.js).
function facing(cam, F, nx, ny, px, py) {
  const [ax, ay] = F(px, py), [bx, by] = F(px + nx, py + ny);
  return !faceAway(cam, ax, ay, bx - ax, by - ay);   // through faceAway, so a kept building sees it turn (ARM_FACE)
}
// Letters on a wall: a quad given left to right as seen from outside, lifted a hair off the plane.
// `pull` decides which of two decals on one wall wins the depth test (a shield over its shadow).
function wallText(ctx, cam, F, tex, pts, alpha, pull = DETAIL_LIFT * 2.5) {
  if (!tex) return;
  const q = pts.map(([x, y, z]) => { const [wx, wy] = F(x, y); return cam.proj(wx, wy, z); });
  if (q.every((p) => p.f > 0.12)) emitSurfaceText(ctx, cam, q, tex, false, alpha, DETAIL_LIFT * 2, false, pull);
}

// ── THE CLUB SHIELDS ─────────────────────────────────────────────────────────────────────────
// A heater shield per club for the east stand's front: a gilt rim, then a bordure and a field in the
// club's colours, and the small drawing of its crest on the field (client/shared/cphl-crests.js,
// written by scripts/content/build-cphl-clubs.mjs). The field takes whichever club colour stands
// furthest from the crest's own ground, so a gold badge goes on black and a navy one on white, and
// the bordure takes the next. A club with a tartan has its field woven in it instead, about one
// repeat across, so the sett reads from the street. Baked once per club and light level, and hung
// as a decal.
// ⚠ A DECAL IS ITS TEXTURE'S OWN COLOUR, on both renderers: nothing dims paint after dark. So the
// night bakes are darkened here, and only a little, because a lamp lights them.
const SHIELD_PX = [128, 150];
const SHIELD = { W: 0.12, X0: -0.36, STEP: 0.2, Z: [0.235, 0.08] };   // size, first column, column step, each row's foot
const _shields = new Map();
const hexRgb = (h) => {
  const v = parseInt(String(h || '').replace('#', '').slice(0, 6), 16);
  return Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [128, 128, 128];
};
function shieldPath(g, m) {
  const [W, H] = SHIELD_PX;
  g.beginPath();
  g.moveTo(m, m); g.lineTo(W - m, m); g.lineTo(W - m, H * 0.44);
  g.quadraticCurveTo(W - m, H * 0.8 - m * 0.3, W / 2, H - m);
  g.quadraticCurveTo(m, H * 0.8 - m * 0.3, m, H * 0.44);
  g.closePath();
}
function shieldTex(club, lvl) {
  const key = `${club.name}|${lvl}`;
  if (_shields.has(key)) return _shields.get(key);
  let c = null;
  if (typeof document !== 'undefined') {
    const [W, H] = SHIELD_PX;
    c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext && c.getContext('2d');
    if (g) {
      const ground = hexRgb(club.crest?.layers?.[0]?.fill);
      const far = (h) => { const r = hexRgb(h); return Math.hypot(r[0] - ground[0], r[1] - ground[1], r[2] - ground[2]); };
      const cols = [...(club.colours?.length ? club.colours : ['#2a2a2e', '#d8d2c4'])].sort((a, b) => far(b) - far(a));
      const gilt = g.createLinearGradient(0, 0, W, H);
      gilt.addColorStop(0, '#f6dc8a'); gilt.addColorStop(0.5, '#c99a3e'); gilt.addColorStop(1, '#8a6224');
      const weave = club.sett ? settCanvas(club.sett, 0.4) : null, tartan = weave && g.createPattern(weave, 'repeat');
      shieldPath(g, 1); g.fillStyle = gilt; g.fill();
      shieldPath(g, 6); g.fillStyle = tartan ? cols[0] : cols[1] || cols[0]; g.fill();
      shieldPath(g, 12); g.fillStyle = tartan || cols[0]; g.fill();
      const box = club.crest?.box || 100, S = W * (tartan ? 0.62 : 0.72);
      g.save(); g.translate(W / 2 - S / 2, H * 0.42 - S / 2); g.scale(S / box, S / box);
      paintLayers(g, club.crest?.layers, club, club.crest?.settUnit || 0.12);
      g.restore();
      shieldPath(g, 1); g.lineWidth = 2; g.strokeStyle = 'rgba(30,20,8,0.9)'; g.stroke();
      if (lvl < 1) {
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = `rgba(10,8,14,${(1 - lvl).toFixed(2)})`; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
      }
    }
    c._lit = 0;
  }
  _shields.set(key, c);
  return c;
}
// The shadow a shield throws on the brick: its outline in a dark wash, one for all eight.
let _shieldShadow;
function shieldShadow() {
  if (_shieldShadow !== undefined) return _shieldShadow;
  _shieldShadow = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = SHIELD_PX[0]; c.height = SHIELD_PX[1];
    const g = c.getContext && c.getContext('2d');
    if (g) { shieldPath(g, 1); g.fillStyle = 'rgba(16,10,6,0.5)'; g.fill(); }
    c._lit = 0;
    _shieldShadow = c;
  }
  return _shieldShadow;
}

// The hall, either half: plinth, walls, the vault over them, the lantern along its crown and the
// clerestory down both sides. `y0..y1` is the half's length on its own tile.
function rinkHall(ctx, cam, F, W3, E, seed, night, alpha, y0, y1, gableY, clr, NEAR) {
  const { WING, TOP, ARCH, PLINTH, EAVE } = RINK, dn = night ? clamp(night, 0, 1) : 0, dusk = 1 - 0.6 * dn;
  span(ctx, cam, F, E, -0.5, 0.5, y0, y1, 0, PLINTH, BRICK_DK, seed + 1, night, alpha, false);
  span(ctx, cam, F, E, -0.5, 0.5, y0, y1, PLINTH, TOP, BRICK, seed, night, alpha, false);
  // The vault, run a hair past the gable so its end reads as an eave. Its frame is shifted along the
  // hall rather than centred on the tile, because the half stops at the tile edge on one end and at
  // the gable on the other.
  const v0 = gableY < 0 ? gableY - EAVE : y0, v1 = gableY > 0 ? gableY + EAVE : y1;
  const yc = (v0 + v1) / 2, Fv = (lx, ly) => F(lx, ly + yc);
  drawBarrelRoof(ctx, cam, Fv, 0, 0.5, (v1 - v0) / 2, TOP, ARCH, 16, alpha, ROOF_RGB.map((c) => c * dusk));
  // The lantern along the crown: a glazed ridge vent, which from the air is what says the ice is lit.
  const crown = TOP + ARCH, l0 = Math.max(y0, -0.5), l1 = Math.min(y1, 0.5);
  const ly0 = gableY > 0 ? l0 : l0 + 0.03, ly1 = gableY > 0 ? l1 - 0.03 : l1;
  span(ctx, cam, F, E, -0.04, 0.04, ly0, ly1, crown - 0.008, crown + 0.035, STONE_DK, seed + 3, night, alpha, true);
  const lit = rgb(mixRgb(ICE_DAY, ICE_NIGHT, dn));
  for (const s of [-1, 1]) {
    flatOut(ctx, cam, W3, [[s * 0.041, ly0 + 0.02, crown + 0.03], [s * 0.041, ly1 - 0.02, crown + 0.03], [s * 0.041, ly1 - 0.02, crown + 0.004], [s * 0.041, ly0 + 0.02, crown + 0.004]], [s, 0, 0], lit, alpha);
  }
  // The clerestory, both sides, over the stands' roofs.
  const c0 = WING + 0.05, c1 = TOP - 0.05;
  for (const s of [-1, 1]) {
    const px = s * 0.502;
    for (const yc2 of clr) {
      flatOut(ctx, cam, W3, [[px, yc2 + 0.065, c1], [px, yc2 - 0.065, c1], [px, yc2 - 0.065, c0], [px, yc2 + 0.065, c0]], [s, 0, 0], lit, alpha);
      if (NEAR && facing(cam, F, s, 0, s * 0.5, yc2)) {
        emitWire(ctx, cam, W3(px + s * 0.002, yc2, c0), W3(px + s * 0.002, yc2, c1), 1.3, BAR, alpha, { pull: FACE_EPS });
        emitWire(ctx, cam, W3(px + s * 0.002, yc2 - 0.065, (c0 + c1) / 2), W3(px + s * 0.002, yc2 + 0.065, (c0 + c1) / 2), 1.3, BAR, alpha, { pull: FACE_EPS });
        emitWire(ctx, cam, W3(px + s * 0.004, yc2 - 0.072, c0 - 0.006), W3(px + s * 0.004, yc2 + 0.072, c0 - 0.006), 2.2, 'rgba(150,146,136,0.95)', alpha, { pull: FACE_EPS });   // the sill
      }
    }
    if (night) { const [gx, gy] = F(s * 0.52, (y0 + y1) / 2); glowPool(ctx, cam, gx, gy, (c0 + c1) / 2, '214,232,240', 18, alpha * 0.22); }
  }
  if (night) { const [gx, gy] = F(0, (ly0 + ly1) / 2); glowPool(ctx, cam, gx, gy, crown + 0.04, '214,232,240', 16, alpha * 0.3); }
}

// ── THE GOOSE ────────────────────────────────────────────────────────────────────────────────
// The name in one figure: a gilt goose on a stepped stone plinth at the top of the front gable,
// displayed the way a deco eagle is. Body and wings face the street, the neck goes straight up, the
// head is turned in profile to the viewer's left (heraldry's dexter), and each wing rises in four
// stepped feathers, the longest on top. It's cut from plate, every part a slab GOOSE.T thick, so it
// keeps a shape from the side. Floodlit after dark.
// ⚠ EVERY OUTLINE IS CONVEX. A flat face is a fan on the GPU, so a concave one fills wrong; the
// figure is built from convex parts instead.
// ⚠ NO TWO PARTS SHARE A PLANE. Each part's front stands at its own y (the `y` beside it), so
// where two parts overlap one is in front and neither z-fights. The wings stand furthest back.
const GOOSE = { Y: 0.33, Z: 0.968, T: 0.012, S: 1.3 };   // S scales the figure's outlines, not its plinth
// Each part: its front's y off GOOSE.Y, its outline (u across, v up from the plinth's top), and `k`,
// how much of the gilt's light it takes, so the parts read apart where they overlap.
const GOOSE_PARTS = [
  { y: 0.004, k: 0.86, pts: [[-0.016, 0], [0.016, 0], [0.009, 0.016], [-0.009, 0.016]] },            // the tail, fanned on the plinth
  { y: 0.006, k: 1, pts: [[0, 0.008], [0.014, 0.014], [0.026, 0.03], [0.03, 0.055], [0.022, 0.078], [0.009, 0.086],
    [-0.009, 0.086], [-0.022, 0.078], [-0.03, 0.055], [-0.026, 0.03], [-0.014, 0.014]] },              // the body
  { y: 0.0055, k: 0.97, pts: [[-0.0065, 0.084], [0.0065, 0.084], [0.0048, 0.162], [-0.0048, 0.162]] }, // the neck, long, which is what makes it a goose
  { y: 0.0065, k: 1.04, pts: Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return [0.002 + 0.0125 * Math.cos(a), 0.167 + 0.0085 * Math.sin(a)]; }) },   // the head
  { y: 0.006, k: 0.9, pts: [[-0.008, 0.171], [-0.032, 0.1655], [-0.032, 0.1625], [-0.008, 0.1605]] },   // the bill, pointing dexter
  { y: 0.0075, k: 0.84, pts: [[-0.017, 0], [-0.003, 0], [-0.01, 0.009]] },                              // the feet
  { y: 0.0075, k: 0.84, pts: [[0.003, 0], [0.017, 0], [0.01, 0.009]] },
];
// One wing's feathers, inside to tip, top first: [root u, foot v, head v, tip u]. Each rises toward
// its tip, and its tip leans out at the top. They darken a step at a time down the wing.
const GOOSE_WING = [[0.004, 0.112, 0.13, 0.118], [0.008, 0.092, 0.108, 0.1], [0.012, 0.073, 0.088, 0.082], [0.016, 0.056, 0.069, 0.064]];
for (const s of [1, -1]) GOOSE_WING.forEach(([u0, v0, v1, u1], i) => {
  const r = (u1 - u0) * 0.3;
  GOOSE_PARTS.push({ y: 0.002, k: 0.95 - i * 0.05, pts: [[s * u0, v0], [s * (u1 - 0.008), v0 + r], [s * u1, v1 + r], [s * u0, v1]] });
});
// Three chevrons down the breast, each arm its own strip, a shade darker than the body: the feathers
// as a deco sculptor cuts them. Face only, so they're plain flats, not slabs.
const GOOSE_CHEVRONS = [];
for (const v of [0.028, 0.044, 0.06]) for (const s of [1, -1]) {
  const w = 0.019 - (v - 0.028) * 0.1;
  GOOSE_CHEVRONS.push([[0, v], [s * w, v + 0.011], [s * w, v + 0.015], [0, v + 0.004]]);
}
function goose(ctx, cam, F, W3, E, seed, night, alpha) {
  const { Y, Z, T, S } = GOOSE, dn = night ? clamp(night, 0, 1) : 0;
  // The plinth: three stone steps, the bottom one sunk into the crown of the vault.
  span(ctx, cam, F, E, -0.06, 0.06, Y - 0.045, Y + 0.045, 0.9, 0.932, STONE_DK, seed + 70, night, alpha, true);
  span(ctx, cam, F, E, -0.047, 0.047, Y - 0.035, Y + 0.035, 0.932, 0.952, STONE, seed + 71, night, alpha, true);
  span(ctx, cam, F, E, -0.034, 0.034, Y - 0.026, Y + 0.026, 0.952, Z, STONE, seed + 72, night, alpha, true);
  // Gilt, lit by the sky by day and from the plinth after dark: the face, the edges that look up,
  // the edges that look down or sideways, and the back.
  const gilt = mixRgb([216, 172, 90], [255, 212, 132], dn), top = rgb(mixRgb([240, 208, 130], [255, 226, 156], dn));
  const side = rgb(mixRgb([150, 110, 52], [204, 152, 76], dn)), back = rgb(mixRgb([122, 90, 42], [176, 128, 62], dn));
  for (const { y, k, pts } of GOOSE_PARTS) {
    const yf = Y + y, yb = yf - T, face = rgb(gilt.map((c) => Math.min(255, c * k)));
    const cu = pts.reduce((a, p) => a + p[0], 0) / pts.length, cv = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    flatOut(ctx, cam, W3, pts.map(([u, v]) => [u * S, yf, Z + v * S]), [0, 1, 0], face, alpha);
    flatOut(ctx, cam, W3, pts.map(([u, v]) => [u * S, yb, Z + v * S]), [0, -1, 0], back, alpha);
    for (let i = 0; i < pts.length; i++) {
      const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % pts.length];
      let nu = v1 - v0, nv = u0 - u1;
      if (nu * ((u0 + u1) / 2 - cu) + nv * ((v0 + v1) / 2 - cv) < 0) { nu = -nu; nv = -nv; }
      const nl = Math.hypot(nu, nv) || 1;
      flatOut(ctx, cam, W3, [[u0 * S, yf, Z + v0 * S], [u1 * S, yf, Z + v1 * S], [u1 * S, yb, Z + v1 * S], [u0 * S, yb, Z + v0 * S]], [nu / nl, 0, nv / nl], nv / nl > 0.6 ? top : side, alpha);
    }
  }
  const cut = rgb(gilt.map((c) => c * 0.8));
  for (const pts of GOOSE_CHEVRONS) flatOut(ctx, cam, W3, pts.map(([u, v]) => [u * S, Y + 0.0068, Z + v * S]), [0, 1, 0], cut, alpha);
  // the eye, a dark chip on the head's face
  flatOut(ctx, cam, W3, [[-0.006, 0.169], [-0.0045, 0.1705], [-0.003, 0.169], [-0.0045, 0.1675]].map(([u, v]) => [u * S, Y + 0.0068, Z + v * S]), [0, 1, 0], 'rgb(64,44,18)', alpha);
  if (night) { const [gx, gy] = F(0, Y + 0.06); glowPool(ctx, cam, gx, gy, Z + 0.08 * S, '255,206,120', 12, alpha * 0.35); }
}

export const ASHWAY_ARMS = {
  ice_rink(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // GOLDEN GOOSE GARDENS: the front of the hall, and the door
    // The arched end of the hall, set back between the two stands, under a canopy that runs across
    // the court between them. From the pavement up: six glass doors, the canopy with tonight's board
    // on its fascia and a flag at each end, the name in gilt deco letters, the great window filling
    // the gable, and the goose on its plinth at the top.
    // ⚠ THE PROSE IS THE SPEC. zone_district_915_916, Glacier Street (915,915) and the concourse's
    // window all describe this front, and scripts/content/slush-fund.mjs writes them.
    const { TOP, FRONT, PLINTH, EAVE } = RINK, NEAR = nearOrMesh(), dn = night ? clamp(night, 0, 1) : 0, dusk = 1 - 0.55 * dn;
    rinkHall(ctx, cam, F, W3, E, seed, night, alpha, -0.5, FRONT, FRONT, CLR, NEAR);
    goose(ctx, cam, F, W3, E, seed, night, alpha);

    // 1) THE GREAT WINDOW: one opening from above the name to the crown, glass in a steel grid, cold
    //    blue by day and white after dark when the ice lights are on behind it.
    const gy = FRONT + EAVE + 0.003, arcZ = (x) => TOP + GW.RISE * Math.sqrt(Math.max(0, 1 - (x / GW.HW) ** 2));
    const arch = [[GW.HW, gy, GW.Z0], [GW.HW, gy, TOP]];
    for (let k = 1; k < 12; k++) { const t = k / 12 * Math.PI; arch.push([GW.HW * Math.cos(t), gy, TOP + GW.RISE * Math.sin(t)]); }
    arch.push([-GW.HW, gy, TOP], [-GW.HW, gy, GW.Z0]);
    flatOut(ctx, cam, W3, arch, [0, 1, 0], rgb(mixRgb(ICE_DAY, ICE_NIGHT, dn)), alpha);
    if (NEAR && frontVis) {
      for (let k = 1; k < 8; k++) { const x = -GW.HW + k * GW.HW / 4;
        emitWire(ctx, cam, W3(x, gy + 0.002, GW.Z0), W3(x, gy + 0.002, arcZ(x)), 1.4, BAR, alpha, { pull: FACE_EPS }); }
      for (const z of [0.45, 0.53, TOP]) emitWire(ctx, cam, W3(-GW.HW, gy + 0.002, z), W3(GW.HW, gy + 0.002, z), 1.4, BAR, alpha, { pull: FACE_EPS });
      for (let k = 0; k < 12; k++) {   // the brick reveal round the arch
        const t0 = k / 12 * Math.PI, t1 = (k + 1) / 12 * Math.PI;
        emitWire(ctx, cam, W3(GW.HW * Math.cos(t0), gy + 0.003, TOP + GW.RISE * Math.sin(t0)), W3(GW.HW * Math.cos(t1), gy + 0.003, TOP + GW.RISE * Math.sin(t1)), 2.6, 'rgba(70,40,32,0.95)', alpha, { pull: FACE_EPS });
      }
    }
    if (night) { const [gx, gyy] = F(0, FRONT + 0.06); glowPool(ctx, cam, gx, gyy, (GW.Z0 + TOP) / 2, '214,232,240', 30, alpha * 0.4); }
    // A stone string course across the front at the eaves, where the brick stops and the steel of the
    // gable starts.
    span(ctx, cam, F, E, -0.5, 0.5, FRONT - 0.004, FRONT + 0.014, TOP - 0.016, TOP, STONE, seed + 10, night, alpha, true);

    // 2) THE NAME, in gilt channel letters in the deco face on the brick between the canopy and the
    //    window. Gilt by day; after dark the letters light. The only place the building says what
    //    it is called.
    if (frontVis) {
      const tex = bakeSignText((name || 'GOLDEN GOOSE GARDENS').toUpperCase(), '#e2ae48', dn, false, dn < 0.05, true, { font: 'deco' });
      wallText(ctx, cam, F, tex, [[-0.44, FRONT + FACE_EPS, 0.345], [0.44, FRONT + FACE_EPS, 0.345], [0.44, FRONT + FACE_EPS, 0.25], [-0.44, FRONT + FACE_EPS, 0.25]], alpha);
    }
    if (night) { const [gx, gyy] = F(0, FRONT + 0.04); glowPool(ctx, cam, gx, gyy, 0.3, '255,196,110', 10, alpha * 0.3); }

    // 3) THE CANOPY across the court, on steel posts at the kerb, its fascia a lit board: what is on
    //    and when. Channel 7 carries the game Tuesday, Thursday and Sunday at six (the concession's
    //    hours say the same).
    const CZ0 = 0.17, CZ1 = 0.205, BY = 0.494;
    span(ctx, cam, F, E, -0.5, 0.5, FRONT, 0.5, CZ0, CZ1, STONE_DK, seed + 20, night, alpha, true);
    span(ctx, cam, F, E, -0.5, 0.5, BY - 0.006, 0.5, 0.15, 0.24, STONE, seed + 21, night, alpha, true);
    const boardRgb = mixRgb([206, 202, 188], [252, 244, 222], dn);
    // ⚠ AN UNLIT FACE, like the glass: after dark the board is lit from inside, so it brightens.
    flatOut(ctx, cam, W3, [[-0.47, 0.502, 0.232], [0.47, 0.502, 0.232], [0.47, 0.502, 0.158], [-0.47, 0.502, 0.158]], [0, 1, 0], rgb(boardRgb), alpha);
    if (frontVis) {
      const tex = bakeSignText('HOCKEY', '#a3201a', 0, false, true, true, { font: 'block', sub: 'TUE  THU  SUN  6PM' });
      wallText(ctx, cam, F, tex, [[-0.44, 0.504, 0.228], [0.44, 0.504, 0.228], [0.44, 0.504, 0.162], [-0.44, 0.504, 0.162]], alpha);
    }
    const post = (f) => { const s = (0.5 + f.nl * 0.45) * dusk; return `rgb(${(78 * s) | 0},${(82 * s) | 0},${(90 * s) | 0})`; };
    for (const x of [-0.45, -0.15, 0.15, 0.45]) { const [px, py] = F(x, 0.484); drawFacetDrum(ctx, cam, px, py, 0, CZ0, 0.008, 0.008, 6, alpha, post, 'rgb(40,42,46)', STEEL); }
    // A flag at each end, standing on the canopy.
    for (const s of [-1, 1]) { const [fx, fy] = F(s * 0.47, 0.47); windFlag(ctx, cam, fx, fy, CZ1, CZ1 + 0.2, 0.08, STEEL, alpha, night, now, seed + 30 + s); }
    if (night) {
      const [gx, gyy] = F(0, 0.43); glowPool(ctx, cam, gx, gyy, CZ0 - 0.01, '255,226,170', 22, alpha * 0.45);   // under the canopy
      const [bx, by] = F(0, 0.53); glowPool(ctx, cam, bx, by, 0.2, '255,244,214', 14, alpha * 0.3);            // the board
    }

    // 4) THE DOORS: six glass doors in steel frames under the canopy, the concourse lit behind them.
    const doorRgb = rgb(mixRgb(WARM_DAY, WARM_NIGHT, dn * 0.8));
    for (const x of [-0.35, -0.21, -0.07, 0.07, 0.21, 0.35]) {
      flatOut(ctx, cam, W3, [[x - 0.055, FRONT + 0.003, 0.15], [x + 0.055, FRONT + 0.003, 0.15], [x + 0.055, FRONT + 0.003, PLINTH], [x - 0.055, FRONT + 0.003, PLINTH]], [0, 1, 0], doorRgb, alpha);
      if (NEAR && frontVis) {
        for (const ex of [x - 0.055, x, x + 0.055]) emitWire(ctx, cam, W3(ex, FRONT + 0.005, PLINTH), W3(ex, FRONT + 0.005, 0.15), 1.8, BAR, alpha, { pull: FACE_EPS });
        emitWire(ctx, cam, W3(x - 0.055, FRONT + 0.005, 0.15), W3(x + 0.055, FRONT + 0.005, 0.15), 1.8, BAR, alpha, { pull: FACE_EPS });
        emitWire(ctx, cam, W3(x - 0.04, FRONT + 0.006, 0.085), W3(x + 0.04, FRONT + 0.006, 0.085), 2.2, 'rgba(176,182,184,0.9)', alpha, { pull: FACE_EPS });   // push bars
      }
    }
    if (night) { const [gx, gyy] = F(0, FRONT + 0.03); glowPool(ctx, cam, gx, gyy, 0.09, '255,214,152', 18, alpha * 0.35); }
  },

  ice_rink_hall(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // GOLDEN GOOSE GARDENS: the back of the hall
    // The vault comes down to a plain gable over the yard: louvres for the ice plant's air high up,
    // the resurfacer's roller door at the foot of it with a lamp over it, a fire door, and against
    // the wall beside the roller door the heap of scrapings the staff call the nest egg.
    // ⚠ THE PROSE IS THE SPEC: zone_district_915_917 and the yard (915,918) describe this end.
    const { TOP, BACK, PLINTH, EAVE } = RINK, NEAR = nearOrMesh(), dn = night ? clamp(night, 0, 1) : 0, dusk = 1 - 0.55 * dn;
    rinkHall(ctx, cam, F, W3, E, seed, night, alpha, BACK, 0.5, BACK, CLR.map((v) => -v), NEAR);
    const gy = BACK - EAVE - 0.003, wy = BACK - 0.003, back = facing(cam, F, 0, -1, 0, BACK);
    // 1) LOUVRES in the gable, dark, slatted at close range.
    for (const [x0, x1] of [[-0.24, -0.1], [-0.07, 0.07], [0.1, 0.24]]) {
      flatOut(ctx, cam, W3, [[x1, gy, TOP + 0.12], [x0, gy, TOP + 0.12], [x0, gy, TOP + 0.02], [x1, gy, TOP + 0.02]], [0, -1, 0], 'rgb(38,42,46)', alpha);
      if (NEAR && back) for (let k = 1; k < 6; k++) { const z = TOP + 0.02 + k * 0.1 / 6;
        emitWire(ctx, cam, W3(x0, gy - 0.002, z), W3(x1, gy - 0.002, z), 1.3, 'rgba(118,124,130,0.85)', alpha, { pull: FACE_EPS }); }
    }
    // 2) THE ROLLER DOOR the resurfacer comes out of, on a concrete apron, with a lamp over it.
    const shutter = rgb(mixRgb([112, 116, 120], [70, 74, 78], dn));
    flatOut(ctx, cam, W3, [[0.075, wy, 0.16], [-0.075, wy, 0.16], [-0.075, wy, PLINTH], [0.075, wy, PLINTH]], [0, -1, 0], shutter, alpha);
    if (NEAR && back) for (let k = 1; k < 9; k++) { const z = PLINTH + k * (0.16 - PLINTH) / 9;
      emitWire(ctx, cam, W3(-0.075, wy - 0.002, z), W3(0.075, wy - 0.002, z), 1.2, 'rgba(60,64,68,0.85)', alpha, { pull: FACE_EPS }); }
    span(ctx, cam, F, E, -0.12, 0.12, -0.5, BACK, 0, 0.008, STONE, seed + 40, night, alpha, true);
    // the fire door, green, west of the roller door
    flatOut(ctx, cam, W3, [[-0.26, wy, 0.13], [-0.32, wy, 0.13], [-0.32, wy, PLINTH], [-0.26, wy, PLINTH]], [0, -1, 0], rgb(mixRgb([60, 84, 64], [40, 52, 44], dn)), alpha);
    if (night) { const [gx, gyy] = F(0, BACK - 0.04); glowPool(ctx, cam, gx, gyy, 0.17, '255,226,176', 9, alpha * 0.4); }
    // 3) THE NEST EGG: scraped ice tipped out of the roller door, grey and crusted, never quite gone.
    const snow = (f) => { const s = (0.55 + f.nl * 0.42) * dusk; return `rgb(${(188 * s) | 0},${(194 * s) | 0},${(198 * s) | 0})`; };
    { const [hx, hy] = F(0.24, -0.43); drawFacetDrum(ctx, cam, hx, hy, 0, 0.05, 0.065, 0.012, 9, alpha, snow, 'rgb(150,154,158)', STONE); }
    { const [hx, hy] = F(0.33, -0.455); drawFacetDrum(ctx, cam, hx, hy, 0, 0.032, 0.04, 0.01, 8, alpha, snow, 'rgb(150,154,158)', STONE); }
  },

  ice_rink_wing(ctx, cam, dx, dy, fh, h, m, seed, night, alpha, now, E, name, board, pal, sign, F, W3, frontVis) {   // GOLDEN GOOSE GARDENS: a stand, either side of the hall
    // A two-storey brick range against the hall, the full depth of its tile. Its row in the
    // registry says where the hall is (`nave`, the local x side), which end of the building it is
    // (`end`: its outer face is the north front or the south back), and what that face carries:
    //   tickets  the box office on the forecourt          shields  the clubs' shields on Glacier Street
    //   plant    the ice plant, condensers on the roof    players  the players' door and loading bay
    // The two back ranges carry ICE along their outer walls in letters a storey high (the map code).
    const { WING, PLINTH, PARA } = RINK, NEAR = nearOrMesh(), dn = night ? clamp(night, 0, 1) : 0, dusk = 1 - 0.55 * dn;
    const nave = m.nave < 0 ? -1 : 1, ox = -nave, front = m.end !== 'back', oy = front ? 1 : -1, face = m.face || (front ? 'tickets' : 'plant');
    span(ctx, cam, F, E, -0.5, 0.5, -0.5, 0.5, 0, PLINTH, BRICK_DK, seed + 1, night, alpha, false);
    span(ctx, cam, F, E, -0.5, 0.5, -0.5, 0.5, PLINTH, WING, BRICK, seed, night, alpha, true);
    // The parapet on the two outer edges; the inner two meet the hall and the other stand.
    span(ctx, cam, F, E, ox > 0 ? 0.48 : -0.5, ox > 0 ? 0.5 : -0.48, -0.5, 0.5, WING, WING + PARA, STONE, seed + 2, night, alpha, true);
    span(ctx, cam, F, E, -0.5, 0.5, oy > 0 ? 0.48 : -0.5, oy > 0 ? 0.5 : -0.48, WING, WING + PARA, STONE, seed + 3, night, alpha, true);
    const outerX = ox * 0.5, outerY = oy * 0.5, seeSide = facing(cam, F, ox, 0, outerX, 0), seeEnd = facing(cam, F, 0, oy, 0, outerY);
    const warm = rgb(mixRgb(WARM_DAY, WARM_NIGHT, dn)), cold = rgb(mixRgb(ICE_DAY, ICE_NIGHT, dn * 0.7));

    // 1) THE OUTER SIDE. The front ranges have four tall stair windows; the back ones have ICE.
    const sx = outerX + ox * 0.002;
    if (front) {
      for (const y of [-0.375, -0.125, 0.125, 0.375]) {
        flatOut(ctx, cam, W3, [[sx, y + 0.03, 0.34], [sx, y - 0.03, 0.34], [sx, y - 0.03, 0.08], [sx, y + 0.03, 0.08]], [ox, 0, 0], cold, alpha);
        if (NEAR && seeSide) for (const z of [0.16, 0.25]) emitWire(ctx, cam, W3(sx + ox * 0.002, y - 0.03, z), W3(sx + ox * 0.002, y + 0.03, z), 1.3, BAR, alpha, { pull: FACE_EPS });
      }
      if (night) { const [gx, gy] = F(outerX + ox * 0.06, 0); glowPool(ctx, cam, gx, gy, 0.22, '214,232,240', 12, alpha * 0.2); }
    } else if (seeSide) {
      // painted white straight onto the brick, read left to right from outside
      const tex = bakeSignText('ICE', '#e9eef0', 0, false, true, true, { font: 'block' });
      wallText(ctx, cam, F, tex, [[sx, 0.42 * ox, 0.34], [sx, -0.42 * ox, 0.34], [sx, -0.42 * ox, 0.08], [sx, 0.42 * ox, 0.08]], alpha);
    }

    // 2) THE OUTER END.
    const ey = outerY + oy * 0.002;
    if (face === 'tickets') {
      // Four box office windows with steel shutters half down, TICKETS painted over them.
      for (const x of [-0.33, -0.11, 0.11, 0.33]) {
        flatOut(ctx, cam, W3, [[x - 0.05, ey, 0.15], [x + 0.05, ey, 0.15], [x + 0.05, ey, 0.07], [x - 0.05, ey, 0.07]], [0, oy, 0], warm, alpha);
        flatOut(ctx, cam, W3, [[x - 0.052, ey + oy * 0.001, 0.17], [x + 0.052, ey + oy * 0.001, 0.17], [x + 0.052, ey + oy * 0.001, 0.13], [x - 0.052, ey + oy * 0.001, 0.13]], [0, oy, 0], rgb(mixRgb([132, 136, 140], [84, 88, 92], dn)), alpha);
        if (NEAR && seeEnd) emitWire(ctx, cam, W3(x - 0.055, ey + oy * 0.003, 0.068), W3(x + 0.055, ey + oy * 0.003, 0.068), 2.4, 'rgba(150,146,136,0.95)', alpha, { pull: FACE_EPS });   // the counter ledge
      }
      const ty = ey + oy * 0.002;
      if (seeEnd) wallText(ctx, cam, F, bakeSignText('TICKETS', '#ece4cf', 0, false, true, true, { font: 'block' }),
        [[-0.3 * oy, ty, 0.27], [0.3 * oy, ty, 0.27], [0.3 * oy, ty, 0.2], [-0.3 * oy, ty, 0.2]], alpha);
      if (night) { const [gx, gy] = F(0, outerY + oy * 0.05); glowPool(ctx, cam, gx, gy, 0.1, '255,214,152', 16, alpha * 0.35); }
    } else if (face === 'shields') {
      // A shield for every club in the league, in league order, two rows read left to right from
      // the street, each with its shadow down and to the right of it on the brick; and an exit door
      // at the hall end. A lamp over the display lights them after dark.
      const lvl = dn < 0.25 ? 1 : dn < 0.75 ? 0.82 : 0.7, per = Math.ceil(CPHL_CRESTS.length / 2);
      const W = SHIELD.W, H = W * SHIELD_PX[1] / SHIELD_PX[0], sy = ey + oy * 0.002, shade = shieldShadow();
      if (seeEnd) CPHL_CRESTS.forEach((club, i) => {
        const cx = oy * (SHIELD.X0 + (i % per) * SHIELD.STEP), z0 = SHIELD.Z[Math.floor(i / per)] ?? SHIELD.Z[1];
        const quad = (ox, oz) => [[cx - oy * W / 2 + oy * ox, sy, z0 + H + oz], [cx + oy * W / 2 + oy * ox, sy, z0 + H + oz], [cx + oy * W / 2 + oy * ox, sy, z0 + oz], [cx - oy * W / 2 + oy * ox, sy, z0 + oz]];
        wallText(ctx, cam, F, shade, quad(0.006, -0.007), alpha, DETAIL_LIFT * 2);
        wallText(ctx, cam, F, shieldTex(club, lvl), quad(0, 0), alpha);
      });
      if (night) { const [gx, gy] = F(oy * (SHIELD.X0 + SHIELD.STEP * (per - 1) / 2), outerY + oy * 0.05); glowPool(ctx, cam, gx, gy, 0.24, '255,226,170', 14, alpha * 0.32); }
      flatOut(ctx, cam, W3, [[0.47, ey + oy * 0.002, 0.14], [0.39, ey + oy * 0.002, 0.14], [0.39, ey + oy * 0.002, PLINTH], [0.47, ey + oy * 0.002, PLINTH]], [0, oy, 0], rgb(mixRgb([60, 64, 70], [40, 44, 48], dn)), alpha);
    } else if (face === 'plant') {
      // The ice plant's wall: three big louvres and a steel door with a hazard diamond on it.
      for (const x of [-0.3, -0.05, 0.2]) {
        flatOut(ctx, cam, W3, [[x + 0.1, ey, 0.3], [x - 0.1, ey, 0.3], [x - 0.1, ey, 0.12], [x + 0.1, ey, 0.12]], [0, oy, 0], 'rgb(40,44,48)', alpha);
        if (NEAR && seeEnd) for (let k = 1; k < 7; k++) { const z = 0.12 + k * 0.18 / 7;
          emitWire(ctx, cam, W3(x - 0.1, ey + oy * 0.002, z), W3(x + 0.1, ey + oy * 0.002, z), 1.3, 'rgba(118,124,130,0.85)', alpha, { pull: FACE_EPS }); }
      }
      flatOut(ctx, cam, W3, [[0.42, ey, 0.14], [0.35, ey, 0.14], [0.35, ey, PLINTH], [0.42, ey, PLINTH]], [0, oy, 0], rgb(mixRgb([96, 100, 106], [60, 64, 68], dn)), alpha);
      flatOut(ctx, cam, W3, [[0.385, ey + oy * 0.002, 0.125], [0.40, ey + oy * 0.002, 0.11], [0.385, ey + oy * 0.002, 0.095], [0.37, ey + oy * 0.002, 0.11]], [0, oy, 0], rgb([214 * dusk, 176 * dusk, 40 * dusk]), alpha);
    } else {
      // The players' door under a lamp, and a loading bay with its shutter down.
      flatOut(ctx, cam, W3, [[-0.18, ey, 0.14], [-0.28, ey, 0.14], [-0.28, ey, PLINTH], [-0.18, ey, PLINTH]], [0, oy, 0], rgb(mixRgb([70, 54, 48], [48, 38, 34], dn)), alpha);
      flatOut(ctx, cam, W3, [[0.34, ey, 0.17], [0.06, ey, 0.17], [0.06, ey, PLINTH], [0.34, ey, PLINTH]], [0, oy, 0], rgb(mixRgb([112, 116, 120], [70, 74, 78], dn)), alpha);
      if (NEAR && seeEnd) for (let k = 1; k < 9; k++) { const z = PLINTH + k * (0.17 - PLINTH) / 9;
        emitWire(ctx, cam, W3(0.06, ey + oy * 0.002, z), W3(0.34, ey + oy * 0.002, z), 1.2, 'rgba(60,64,68,0.85)', alpha, { pull: FACE_EPS }); }
      if (night) { const [gx, gy] = F(-0.23, outerY + oy * 0.04); glowPool(ctx, cam, gx, gy, 0.16, '255,226,176', 8, alpha * 0.4); }
    }

    // 3) THE ROOF. The plant range carries the condensers, fans up, with their breath coming off them
    //    in cold weather and warm; the others a couple of vents.
    if (face === 'plant') {
      const fan = (f) => { const s = (0.45 + f.nl * 0.4) * dusk; return `rgb(${(52 * s) | 0},${(58 * s) | 0},${(64 * s) | 0})`; };
      for (const y of [-0.26, 0, 0.26]) {
        span(ctx, cam, F, E, -0.14, 0.14, y - 0.09, y + 0.09, WING, WING + 0.06, 'ty_cold_unit', seed + 50, night, alpha, true);
        for (const x of [-0.07, 0.07]) { const [fx, fy] = F(x, y); drawFacetDrum(ctx, cam, fx, fy, WING + 0.06, WING + 0.07, 0.05, 0.05, 10, alpha, fan, 'rgb(30,34,38)', STEEL); }
      }
      const [sx2, sy2] = F(0, 0); drawSmoke(ctx, cam, sx2, sy2, WING + 0.09, '226,232,236', alpha * 0.4, now, seed + 9);
    } else {
      for (const [x, y] of [[0.18, 0.2], [-0.12, -0.22]]) span(ctx, cam, F, E, x - 0.05, x + 0.05, y - 0.05, y + 0.05, WING, WING + 0.035, STONE_DK, seed + 60, night, alpha, true);
    }
  },
};
