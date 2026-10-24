// GLASS · THE COLISEUM'S WINDOWS. The concourse window in each bay of the bowl wall, as the map draws
// it (glass/models/coliseum.js) and the broadcast's park builds it (gl/ballpark-mesh.js buildBowl,
// and gl/ballpark.js EXTERIOR_GLSL on the faces that keep a solid wall). All three read it from here,
// so a change to a window is one change.
//
// Two windows, one language: lights in a bronze frame between each pair of fins, the middle light
// the widest and the tallest and the ones outside it stepping down toward the frame, transoms across,
// and a gilt sunburst rising in the middle light's head off the step under it. Under the name band a
// window stops short of it, square-headed and with no sun.
//
//   WIN       Sorrel Way and the east, where the grandstand stands against the wall: three lights
//             and one step, under a bronze spandrel with a gilt chevron.
//   WIN_OPEN  the outfield faces, the boulevard and the west: five lights and two steps, wider,
//             from a lower sill up through where the spandrel was. The broadcast cuts their glass
//             through the wall, so the city shows through them from the field, and from home plate
//             the bleachers hide everything under about 40 ft, so the height is what shows the city.
//
// `mulls` are the mullions' offsets from the bay's middle, innermost first; `steps` the heads of the
// lights outside each one, innermost first (the middle light's head is `z1`). Tiles: `t` along the
// face from the bay's middle, `z` up, as the map measures them. Pure: no DOM and no GL.

export const WIN = Object.freeze({
  frame: 0.082,                 // the bronze frame's half-width
  frameZ: Object.freeze([0.094, 0.291]),
  hw: 0.074,                    // the glass's half-width
  z0: 0.100,                    // the sill
  z1: 0.285,                    // the head
  band: 0.252,                  // the head under the name band: 0.016 under the band's foot (0.268)
  bandFrame: 0.258,             // the frame's top there
  mulls: Object.freeze([0.030]),
  steps: Object.freeze([0.240]),
  bar: 0.0025,                  // a mullion's or a transom's half-width
  transoms: Object.freeze([0.150, 0.200]),
  spandrel: true,
});

// ⚠ THE FRAME CLEARS THE FINS. They stand 0.1115 either side of the bay's middle, 0.011 thick, so
// the frame at 0.104 leaves a strip of stone either side. Its top stops 0.004 under the frieze.
export const WIN_OPEN = Object.freeze({
  frame: 0.104,
  frameZ: Object.freeze([0.069, 0.336]),
  hw: 0.097,
  z0: 0.075,
  z1: 0.330,
  band: WIN.band,
  bandFrame: WIN.bandFrame,
  mulls: Object.freeze([0.036, 0.067]),
  steps: Object.freeze([0.290, 0.255]),
  bar: 0.0025,
  transoms: Object.freeze([0.140, 0.200]),
  spandrel: false,
});

// The sun's rays, by their angle up from the step, in degrees.
export const RAYS = Object.freeze([24, 57, 90, 123, 156]);
// The hub's radius, and the half-width of a ray at its foot, both in tiles along the face.
export const SUN = Object.freeze({ hub: 0.0075, foot: 0.0015, inset: 0.0025 });

// The bronze in a window's head over the lights outside the middle one, as [t0, t1, z0, z1] on one
// side of the bay's middle (t positive; mirror it for the other): a panel over each light from its
// step to the head, and the step the sun rises off across the middle light.
export function headPanels(W) {
  const out = [], top = W.z1;
  W.steps.forEach((z, i) => out.push([W.mulls[i] - W.bar, i + 1 < W.mulls.length ? W.mulls[i + 1] + W.bar : W.hw, z - W.bar, top]));
  out.push([0, W.mulls[0], W.steps[0] - W.bar, W.steps[0] + W.bar]);
  return out;
}

// The sunburst in the middle light's head, as convex polygons [[t, z], ...] from the bay's middle:
// the half-disc of the hub sitting on the step, then each ray, a long thin triangle from just off
// the hub to just short of the frame. `zPerT` is a tile up against a tile along as the view draws
// them, so the sun comes out round: 1 / 1.4 on the map (its heights are drawn 1.4 times taller) and
// its feet along over its feet up on the broadcast.
export function sunburst(zPerT = 1, W = WIN) {
  const zb = W.steps[0] + W.bar, at = (x, y) => [x, zb + y * zPerT];
  const out = [];
  const hub = [];
  for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; hub.push(at(SUN.hub * Math.cos(a), SUN.hub * Math.sin(a))); }
  out.push(hub);
  for (const deg of RAYS) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), L = rayReach(deg, zPerT, W);
    const r0 = SUN.hub * 1.3, px = -s * SUN.foot, py = c * SUN.foot;
    out.push([at(c * r0 + px, s * r0 + py), at(c * L, s * L), at(c * r0 - px, s * r0 - py)]);
  }
  return out;
}
// How far a ray at `deg` reaches from the hub's centre before it meets the middle light's frame,
// less the inset, in tiles along the face (the painted window draws it from this too).
export function rayReach(deg, zPerT = 1, W = WIN) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const side = W.mulls[0] - W.bar, room = (W.z1 - W.steps[0] - W.bar) / zPerT;
  return Math.min(Math.abs(c) > 1e-6 ? side / Math.abs(c) : Infinity, room / s) - SUN.inset;
}
