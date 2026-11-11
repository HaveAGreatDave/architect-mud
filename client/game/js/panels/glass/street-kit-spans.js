// ── THE STREET KIT'S UPPER BRIDGES: SERVICE, SKYBRIDGE AND EXECUTIVE ──────────────────────────────
//
// Coldwater Streets, phase 2 (docs/proposals/coldwater-streets.md). The footbridge belongs to the
// street and is in glass/street-kit.js. These three belong to the buildings either side of it: a
// twin-deck service bridge at 9 and 16 m for the staff, a glass skybridge at 12.5 m for the members
// and a gold box at 24 m by invitation. Stacked over one street they show the class system from the
// pavement, public at the bottom and executives at the top.
//
// ⚠ A BRIDGE LANDS IN A BUILDING OR IT ISN'T THERE. Each one runs out past the frontage and through
// a facade, so it stands only where the tiles either side are tall enough to take it (`landing` in
// street-kit.js reads their floors). It's never drawn ending in the air.
//
// ⚠ THEY NEVER DECAY. The condition ladder stops at the kerb: these are the same steel and the same
// lights on a street nobody has mended in years. That's the point of them.
//
// ⚠ NOBODY WALKS ON THESE. They're nothing to do with where a player or a street figure can go, and
// the walk (glass/street-kit-walk.js) doesn't know they exist. The riders in the skybridge are
// scenery, a pure function of the clock like the lift cars: no actor, no server, no tile.
//
// No renderer imports. `B` is the toolbox drawStreetKit builds, in its street frame (`u` along the
// street, `v` across it, `z` up, all in tiles): box, strut, face, pane, F, line, text, light, near,
// far, doStatic, doDynamic, now, night.
import { BIRD_M_PER_TILE as TILE_M } from '../../../../shared/birds.js';
const M = (m) => m / TILE_M;

// The brief's numbers. Every `*_Z` is the underside of a deck, as the footbridge's 7.0 m is.
export const SPAN_M = Object.freeze({
  SERVICE_Z: Object.freeze([9, 16]), SERVICE_T: 0.55, SERVICE_W: 3.0, LATTICE: 2.4,
  SKY_Z: 12.5, SKY_T: 0.25, SKY_W: 2.8, SKY_R: 1.9, SKY_FLOOR: 1.35, RIB_EVERY: 1.4,
  EXEC_Z: 24, EXEC_H: 2.6, EXEC_W: 4.2, FIN_EVERY: 2.2, FIN_L: 2.2,
});
const S = SPAN_M;
// In tiles. ⚠ `LAND` RUNS NEARLY TO THE MIDDLE OF THE NEXT TILE, not to its facade. A facade stands
// 0.56 to 0.62 from the street's centreline at the ground, but a tower sets back from its podium,
// and a deck that stopped at the first of those ended in the air 16 m up. The middle of a building
// has mass at every height it reaches, whatever its model does on the way. `U` is where they cross a
// tile: north or west of its centre, so they clear the footbridge at BRIDGE_U and don't stand
// directly over the crossing's arm.
export const SPAN = Object.freeze({ U: -0.15, LAND: 0.9 });

// Which bridges a street can carry, dearest first: the storeys both flanks need, with a margin for
// the 0.9 to 1.1 spread in a building's height, and where along the block each one wants to stand
// as a share of its length. The order along a block is the preview's: service, skybridge, executive.
export const KIT_SPANS = Object.freeze([
  Object.freeze({ kind: 'exec', floors: 9, at: 0.65 }),
  Object.freeze({ kind: 'sky', floors: 6, at: 0.4 }),
  Object.freeze({ kind: 'service', floors: 6, at: 0.1 }),
]);

// What a bridge can land in: buildings with floors at the height it arrives. ⚠ A LIST OF WHAT QUALIFIES,
// NOT OF WHAT DOESN'T. Height alone put four bridges into the Hughson Coliseum, which is an open bowl,
// and one into a gasholder. The water tower, the Halcyon Arch and the boathouse are tall and have no
// floors either. A new tower type gets no bridge until it's added here, which is the safe way round.
export const KIT_LANDS = Object.freeze(new Set(['office', 'apartment', 'hotel', 'asc_clinic', 'chrome_tower', 'chrome_slab',
  'shell_tower', 'torque_tower', 'bead_tower', 'cascade_block', 'glass_prism', 'sky_court', 'vertical_farm']));

const C = {
  steel: [154, 166, 181], steelDk: [42, 49, 64], amber: [255, 178, 29], cyan: [111, 227, 255], gold: [255, 210, 122],
  glass: [150, 210, 232], box: [34, 40, 56], mullion: [20, 24, 34], rider: [46, 54, 68], head: [190, 170, 148],
  cam: [215, 222, 230], red: [255, 59, 59],
};

// A camera on a bridge's underside: an arm, a white housing that sweeps side to side, a cyan lens and
// a red light that blinks while it records. Near to only, because it's a small part. It watches at
// every condition.
export function kitCamera(B, u, v, z, phase) {
  if (!B.near) return;
  const { box, strut, F } = B, drop = M(0.4);
  if (B.doStatic) box(u, v, M(0.04), M(0.04), z - drop, z, C.steelDk, 'metal');
  if (!B.doDynamic) return;
  const t = (B.now || 0) / 1000, a = Math.sin(t * 0.5 + phase) * 0.9 + (Math.sin(phase * 7) > 0 ? 0 : Math.PI);
  const zc = z - drop - M(0.12), L = M(0.55), du = Math.cos(a) * L, dv = Math.sin(a) * L;
  const tail = F(u - du * 0.4, v - dv * 0.4, zc), nose = F(u + du * 0.6, v + dv * 0.6, zc - M(0.1));
  strut(tail, nose, M(0.13), C.cam, 'metal');
  box(u + du * 0.62, v + dv * 0.62, M(0.05), M(0.05), zc - M(0.15), zc - M(0.05), C.cyan, 'lit');
  if (Math.sin(t * 4 + phase) > 0) box(u + du * 0.5, v + dv * 0.5, M(0.025), M(0.025), zc + M(0.08), zc + M(0.13), C.red, 'lit');
}

// Two dark steel decks tied together by a lattice down each side, amber lights along every edge.
function service(B) {
  if (!B.doStatic) return;
  const { box, strut, F, line, near, far } = B;
  const u = SPAN.U, hu = M(S.SERVICE_W / 2), L = B.land || SPAN.LAND, t = M(S.SERVICE_T);
  const [zA, zB] = S.SERVICE_Z.map(M);
  for (const z of [zA, zB]) {
    box(u, 0, hu, L, z, z + t, C.steelDk, 'metal', C.steelDk, 'metal', true);
    for (const e of [-1, 1]) {
      box(u + e * (hu + M(0.02)), 0, M(0.02), L, z + M(0.03), z + M(0.1), C.amber, 'lit');
      if (line) { line(F(u + e * hu, -L, z + t), F(u + e * hu, L, z + t)); line(F(u + e * hu, -L, z), F(u + e * hu, L, z)); }
    }
  }
  // The lattice: a zigzag from the lower deck to the upper down each side, uprights near to.
  const z0 = zA + t, z1 = zB, n = Math.max(2, Math.round(2 * L / M(far ? S.LATTICE * 2 : S.LATTICE)));
  for (const e of [-1, 1]) {
    const ue = u + e * (hu - M(0.1));
    for (let i = 0; i < n; i++) {
      const a = -L + 2 * L * i / n, b = -L + 2 * L * (i + 1) / n, up = i % 2 === 0;
      strut(F(ue, a, up ? z0 : z1), F(ue, b, up ? z1 : z0), M(0.07), C.steel, 'metal');
      if (near) strut(F(ue, a, z0), F(ue, a, z1), M(0.04), C.steelDk, 'metal');
    }
    // A rail on the upper deck, which is open to the weather.
    if (!far) {
      const zr = zB + t + M(1.05);
      strut(F(ue, -L, zr), F(ue, L, zr), M(0.03), C.steel, 'metal');
      for (let i = 0; i <= n; i += 2) strut(F(ue, -L + 2 * L * i / n, zB + t), F(ue, -L + 2 * L * i / n, zr), M(0.025), C.steel, 'metal');
    }
  }
}

// An enclosed glass tube on a thin deck, lit rings round it every 1.4 m and a gold line under it,
// the members walking about inside. The glass goes over as `pane`, which is film: tested against
// depth but not written to it, so what's inside and behind it still shows.
function sky(B) {
  const { box, face, pane, F, line, near, far, doStatic, doDynamic } = B;
  const u = SPAN.U, L = B.land || SPAN.LAND, R = M(S.SKY_R), z0 = M(S.SKY_Z), z1 = z0 + M(S.SKY_T), zc = z1 + M(S.SKY_FLOOR);
  const at = (a, v) => F(u + Math.cos(a) * R, v, zc + Math.sin(a) * R);
  if (doStatic) {
    const hu = M(S.SKY_W / 2);
    box(u, 0, hu, L, z0, z1, C.steel, 'metal', C.steelDk, 'metal', true);
    box(u, 0, M(0.15), L, z0 - M(0.06), z0 - M(0.01), C.gold, 'lit', C.gold, 'lit', true);
    if (line) for (const e of [-1, 1]) line(F(u + e * hu, -L, z0), F(u + e * hu, L, z0));
    // The rings: a ribbon each, twelve sides near to.
    const every = M(S.RIB_EVERY) * (far ? 3 : 1), n = near ? 12 : far ? 6 : 8, w = M(0.05);
    for (let v = -L + every / 2; v < L; v += every) {
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, b = (i + 1) / n * Math.PI * 2;
        face([at(a, v - w), at(b, v - w), at(b, v + w), at(a, v + w)], C.cyan, 'lit');
      }
    }
  }
  if (!doDynamic) return;
  // The riders first and the glass over them. Four people pacing up and down, a figure each near to,
  // a post at the middle distance, nobody from far off.
  if (!far) {
    const t = (B.now || 0) / 1000, reach = L - M(2.5), zf = z1, Hn = M(1.15);
    for (let i = 0; i < 4; i++) {
      const ph = (t / 46 + i / 4 + i * 0.07) % 1, k = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      const v = -reach + 2 * reach * k, uu = u + (i % 2 ? M(0.5) : -M(0.5));
      box(uu, v, M(0.2), M(0.22), zf, zf + Hn, C.rider, 'paint');
      if (near) box(uu, v, M(0.13), M(0.13), zf + Hn, zf + Hn + M(0.3), C.head, 'paint');
    }
  }
  const n = 8, a0 = -Math.asin(S.SKY_FLOOR / S.SKY_R), a1 = Math.PI - a0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * i / n, b = a0 + (a1 - a0) * (i + 1) / n;
    pane([at(a, -L), at(b, -L), at(b, L), at(a, L)], C.glass, 0.16);
  }
  if (B.night > 0.2 && B.light) { const p = F(u, 0, z0); B.light(p[0], p[1], p[2], '255,210,122', 7, 0.3 * B.night); }
}

// A dark box glazed in gold, with angled steel fins under it.
function exec(B) {
  const { box, face, F, line, near, far, doStatic, doDynamic } = B;
  const u = SPAN.U, hu = M(S.EXEC_W / 2), L = B.land || SPAN.LAND, z0 = M(S.EXEC_Z), z1 = z0 + M(S.EXEC_H);
  if (doStatic) {
    box(u, 0, hu, L, z0, z1, C.box, 'metal', C.box, 'metal', true);
    box(u, 0, M(0.25), L, z0 - M(0.05), z0 - M(0.01), C.cyan, 'lit', C.cyan, 'lit', true);
    for (const e of [-1, 1]) {
      const ue = u + e * (hu + M(0.01)), g0 = z0 + M(0.55), g1 = z0 + M(1.6);
      face([F(ue, -L, g0), F(ue, L, g0), F(ue, L, g1), F(ue, -L, g1)], C.gold, 'lit');
      if (near) for (let v = -L + M(1.5); v < L; v += M(1.6)) box(ue + e * M(0.005), v, M(0.012), M(0.03), g0, g1, C.mullion, 'paint');
      if (line) { line(F(u + e * hu, -L, z1), F(u + e * hu, L, z1)); line(F(u + e * hu, -L, z0), F(u + e * hu, L, z0)); }
    }
    if (!far) {
      // The fins lean away from the middle of the span, as a plate each: two faces back to back
      // aren't needed, because the solids layer draws both sides.
      const lean = M(S.FIN_L) * 0.45, hw = M(0.3);
      for (let v = -L + M(1.6); v < L - M(0.5); v += M(S.FIN_EVERY)) {
        const d = v < 0 ? -1 : 1, zb = z0 - M(S.FIN_L);
        face([F(u - hw, v, z0), F(u + hw, v, z0), F(u + hw, v + d * lean, zb), F(u - hw, v + d * lean, zb)], C.steel, 'metal');
      }
    }
  }
  if (doDynamic && B.night > 0.2 && B.light) { const p = F(u, 0, z0); B.light(p[0], p[1], p[2], '255,210,122', 9, 0.3 * B.night); }
}

const DRAW = { service, sky, exec };
export function drawKitSpan(kind, B) {
  DRAW[kind](B);
  if (kind === 'sky') kitCamera(B, SPAN.U + M(1.0), M(1.2), M(S.SKY_Z), 2.1);
  if (kind === 'exec') { kitCamera(B, SPAN.U - M(1.2), -M(3), M(S.EXEC_Z), 4.3); kitCamera(B, SPAN.U + M(1.2), M(3), M(S.EXEC_Z), 0.9); }
}
