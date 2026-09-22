// THE INSIDE OF THE THING YOU ARE SITTING IN, AS GEOMETRY.
//
// Every interior in this renderer is a PICTURE. `drawCabInterior` paints a windscreen aperture with
// a header, two pillars and a dash across the bottom of the canvas; the aircraft canopy is a baked
// arch; a shoulder-check swaps all of it for a second drawing of a side window and a third of a
// rear light. Three hand-drawn pictures for three fixed head angles, and the comment over the cab
// says so in its own words: "Three things fix that and none of them is 3-D."
//
// That is exactly right for a seat you can only face forward from, and it has one consequence the
// moment you can turn your head: THERE IS NOTHING TO TURN TOWARD. Look 40° off the nose and the
// painted cab is suppressed (it is a forward interior, and drawing it over a side window puts the
// windscreen surround on top of the glass you are trying to look out of), so what you get is the
// city with no vehicle around it — you are not in a cab, you are a floating camera that happens to
// be moving at 60. There is no floor, no roof, no seat and no back wall, because none of those has
// ever existed in any form.
//
// This is those surfaces, as real depth-buffered triangles.
//
// ── ⚠ AUTHORED IN METRES AGAINST THE EYE, RESOLVED IN EYE-HEIGHTS ────────────
//
// The obvious way to size this is metrically: a tile is some number of metres, a cab is 2.3 m wide,
// divide. Every step of that is correct and the answer is wrong, because THIS GAME HAS NO SINGLE
// TILE SCALE. `TILES_PER_MILE` is 3 (a tile is a third of a mile) on the long-haul road; a storey
// is 0.196 tiles and a building 0.76 across in the city (a tile is about twenty metres). They
// disagree by two orders of magnitude and both are load-bearing. Sizing an interior off either is
// the wheel-track bug again — a metrically honest derivation off a scale the renderer does not
// actually draw at.
//
// The one number that IS a statement about human scale at this seat is the seat's own `eyeH`: the
// cab passes 0.12 and it means "a truck driver's eye". So everything here is authored in metres
// from the eye and divided by EYE_M on the way out. An interior is expressed as a MULTIPLE OF HOW
// HIGH THE EYE IS, which is a ratio, so it is the same shape whatever the surrounding scale turns
// out to be — and a seat that changes its eye height gets a cab that changes with it rather than a
// cab it no longer fits in.
//
// ── ⚠ THE EYE IS INSIDE, AND THAT IS A CORRECTNESS INVARIANT ─────────────────
//
// A shell is the one object in this renderer drawn from within. Every face is depth-tested and
// writes depth, so a surface that closes over the origin is not a subtle error — it is a black
// screen, and it looks exactly like the renderer failing rather than like a number being wrong.
// `shellBounds()` states the box and the gate asserts the origin is strictly inside it.
//
// ── ⚠ THE WINDSCREEN IS THE ABSENCE OF GEOMETRY ──────────────────────────────
//
// There is no front face and there must not be one. The 2-D cab's own first rule is ONE APERTURE,
// STATED ONCE — the header, the pillars and the dash lip are all edges OF the hole — and the same
// rule holds here for the same reason: the hole is what the header, the pillars and the dash are
// bounded BY, so a pane across it would be a second description of a shape already fully described
// by the things around it, free to disagree with them.
//
// The side windows are holes the same way: four quads round a rectangle (sill, header, two posts),
// never one translucent quad. This layer writes depth whatever the alpha, so a pane over a side
// window would put a depth value in front of the entire city seen through it — the world would be
// there and be quietly fogged by a sheet of glass that is not supposed to be a surface at all.
//
// ── ⚠ THE PAINTED CAB OWNS THE FORWARD VIEW, AND KEEPS IT ────────────────────
//
// `drawCabInterior` is the best-looking thing in the seat: a windscreen aperture with a moulded
// header, two pillars with lit returns, a padded dash lip, and a board carrying every dial, lamp
// and needle at native resolution. It is drawn at AUTHORED SCREEN PROPORTIONS — the dash fills the
// lower third because that is what reads as a cab — and a physically-sized dash does not: measured
// through this seat's own lens, the real thing sits at the very bottom edge of the frame.
//
// Both are right, and they are right about DIFFERENT THINGS, so they must not both draw the same
// surface. The parts of the forward aperture carry `fwd` and the renderer drops them for as long
// as the painted cab is up; past the angle where it is dropped (see LOOK_DASH_OFF) they come back,
// because by then there is no painted anything and a windscreen with no header round it is a hole.
//
// ⚠ EVERYTHING ELSE IS ALWAYS DRAWN, and that is the whole feature: the floor, the roof, the rear
// bulkhead, the parcel shelf, the door cards and both seats are surfaces the forward aperture
// CANNOT show at any proportion, because they are not in front of you. That is why none of them
// has ever existed in this renderer, and why the first thing anybody did on turning their head was
// leave the vehicle entirely.
//
// ── ⚠ NO COLOUR IS AUTHORED HERE ─────────────────────────────────────────────
//
// `client/shared/cab-trim.js` carries seven colourways and the bench sells three of them. A shell
// with its own palette would be an eighth that nobody can buy and that goes out of step with the
// dash six inches in front of it. Every tone below is a key the colourway already has, moved toward
// the light or away from it — which is also the 2-D cab's rule, quoted, and it is why all seven
// interiors gained a floor and a roof at once and not one of them changed hue.
//
// ── ⚠ FLAT-SHADED ON THE CPU, AGAINST THE LIGHT THAT COMES IN THE SCREEN ─────
//
// `gl/solids.js` is a flat colour per face by design, and its own note says why the shading stays
// on the CPU: a lit-here shader would be a second lighting model for one object, agreeing with the
// canvas one until somebody edited either. So the relation here is the cab's own — the light in a
// cab comes in through the hole, so what decides a surface's tone is WHICH WAY IT FACES and not
// where it sits. The dash top and the pillar returns look at the daylight and are the brightest
// things in here; the roof lining and the fascia look at the driver and are the darkest.
//
// No side effects and nothing but pure data imported: the renderer reads it, and
// scripts/shapes/shell.mjs reads it headlessly. It draws nothing itself and knows nothing about a
// canvas, a camera or a tile.
//
// ── ⚠ AND THE BOAT'S ROOM IS NOT AUTHORED HERE AT ALL ────────────────────────
//
// The truck and the aircraft tub below are thirty hand-written scalars each, and that is fine for
// them: nothing else in the codebase describes a tractor cab, so there is nothing for those
// numbers to disagree with. The hydro is the opposite case. `buildBoat` already lofts an enclosed
// pilothouse — a wrapped screen, tumbled sides with a teardrop cut in them, an aft bulkhead with a
// door in it, a crowned hardtop — and a second hand-authored description of that same room is a
// second description of one object.
//
// It went exactly the way that always goes. Measured against each other, the two were THREE TIMES
// apart in height for their length and 27% in width; the sill you looked out over inside was
// somewhere the exterior has solid topside; the door behind your head was not the door on the
// back of the house. So the boat's profile is DERIVED, out of `boat-house.js`, which the exterior
// now reads too — and its room is built as a LOFT off those same curves rather than as a box,
// because the house tapers in plan, leans in as it rises and has a teardrop for a window, and a
// rectangular room inside it lines up at exactly four corners.
import { BOAT_ROWS } from './vehicle-models.js';
import { boatGeom, HELM } from './boat-house.js';

// How many metres up the eye is, at this seat. The divisor that turns the metres below into
// multiples of the seat's own eye height — see the ⚠ at the top. A truck driver's eye over the
// road, which is what `eyeH: 0.12` was chosen to look like.
//
// ⚠ IT IS A PER-SEAT NUMBER AND IT WAS A GLOBAL, which is the other half of why the boat did not
// fit inside itself. A race boat's helm eye is about 1.35 m over the water and a truck driver's is
// 2.6 m over the road, so dividing the boat's metres by the truck's number scaled its whole cabin
// by 1.9 against the world outside the glass. `profile.eyeM` overrides it; this stays the default,
// so the truck and the tub are untouched.
export const EYE_M = 2.60;
export const eyeMetresOf = (P) => (P && P.eyeM) || EYE_M;

// The hydro's derived profile, built on first ask. See the getter in SHELL_PROFILES.
let BOAT_PROFILE = null;

// ── THE PROFILES ─────────────────────────────────────────────────────────────
//
// Metres, origin AT THE EYE, +x right, +y forward (toward the nose), +z up.
//
// ⚠ THE DRIVER IS NOT IN THE MIDDLE, and that is not decoration — it is the single thing that makes
// an interior read as a cab rather than as a symmetrical frame. The 2-D panel has had the wheel at
// 0.42W since it was laid out, and its own note spells out what follows: the near pillar is a foot
// from your face and the far one is across the cab, so the left subtends several times the angle of
// the right. `xCentre` is how far the vehicle's centreline is to the RIGHT of your eye, and every
// symmetric part below is symmetric about THAT rather than about zero.
export const SHELL_PROFILES = {
  // A left-hand-drive tractor unit. Wide, flat-screened, and you sit high in the front of it.
  truck: {
    label: 'tractor cab',
    xCentre: 0.55,          // the cab's centreline, right of the eye
    halfW: 1.15,            // half the interior width, about the centreline
    floor: -1.15,           // the footwell, below the eye
    roof: 0.66,             // the headlining
    front: 1.00,            // the windscreen plane
    back: -0.78,            // the rear bulkhead
    dashY: 0.52,            // where the dash starts, coming back from the screen
    dashZ: -0.40,           // the top of the dash
    headerZ: 0.40,          // the bottom of the header above the screen
    pillarW: 0.13,          // how thick the A-pillars are
    winY: [-0.30, 0.74],    // the side-window aperture, fore and aft
    winZ: [-0.14, 0.44],    // and its sill and header
    seatZ: -0.80,           // the top of the cushion you are sitting on
    seatHalf: 0.28,         // half the width of a seat
    seatY: [-0.50, 0.10],   // the cushion, fore and aft
    backZ: 0.24,            // how far the backrest comes up past the eye
    centrePost: 0.055,      // the half-width of the post between the two screen panes
  },
  // A light aircraft tub. Narrow, you sit near the middle of it, and the sides come up to your
  // elbow rather than to your shoulder — which is most of why a cockpit feels open and a cab does
  // not, and it falls out of the numbers rather than being said anywhere.
  // ── THE HYDRO'S PILOTHOUSE ─────────────────────────────────────────────────
  //
  // ⚠ DERIVED, NOT AUTHORED. Every number in here is the exterior house measured — see the ⚠ at
  // the top of this file and the header of `boat-house.js`. Nothing below is a scalar somebody
  // chose to look right from the inside, because a scalar chosen that way is how the room and the
  // boat it is inside came to be three times apart.
  //
  // ⚠ AND IT IS THE ONE PROFILE WHOSE INSTRUMENTS ARE GEOMETRY. Everything else here gets a dash
  // SLAB and lets `paintCabDash` paint the dials onto it; this one carries `instruments: true` and
  // builds them. The note on the dash below says why that is normally forbidden — two boards a few
  // centimetres apart disagreeing about where the rev counter is — and the reason it does not bind
  // here is that a boat never calls `paintCabDash` at all, so there is no second board to disagree
  // with. That is enforced at the gate in windshield.js, not merely intended.
  // ⚠ A GETTER, BECAUSE A DERIVED PROFILE IS BUILT AND THE OTHER TWO ARE TYPED OUT. `boatProfile`
  // is a hoisted function declaration and reads `const`s further down this file, and a `const` read
  // before its own line is a temporal-dead-zone THROW rather than an undefined — so evaluating it
  // inside this literal takes the whole module down at import with "Cannot access ROOM before
  // initialization", which is the same trap the exterior's own `fw` note is written about. Built on
  // first ask and kept, because callers rely on a profile having a stable identity.
  get boat() { return (BOAT_PROFILE ||= boatProfile(BOAT_ROWS.hydro)); },
  cockpit: {
    label: 'cockpit tub',
    xCentre: 0.34,
    halfW: 0.62,
    floor: -0.92,
    roof: 0.52,
    front: 0.86,
    back: -0.62,
    dashY: 0.44,
    dashZ: -0.30,
    headerZ: 0.30,
    pillarW: 0.09,
    winY: [-0.34, 0.66],
    winZ: [-0.30, 0.34],
    seatZ: -0.74,
    seatHalf: 0.24,
    seatY: [-0.44, 0.08],
    backZ: 0.30,
    centrePost: 0,          // ⚠ ZERO IS A REAL ANSWER: a canopy is one curved pane with no post in
                            // it, and a post authored here would be a bar down the middle of an
                            // aircraft windscreen. The builder skips the part rather than drawing
                            // a degenerate one — see `if (P.centrePost > 0)`.
  },
};

// Which profile a vehicle class sits in. ⚠ A CLASS WITH NO ROW GETS NO SHELL, deliberately: the
// alternative is every helicopter, ultralight and wreck in the game wearing a tractor cab because
// a default looked tidier, and a wrong interior is much worse than none — it is a room that does
// not match the aircraft you can see the wings of.
// The map is EXPLICIT and the omissions each carry a reason. The tempting version is a default —
// everything that is not a truck gets the tub — and it would put an enclosed cabin around a Mayfly,
// which is an open ultralight you can see your own legs hanging out of, and around a helicopter,
// whose cabin is a glass bubble glazed below the floor line and is the opposite shape to this.
const SHELL_CLASS = {
  truck: 'truck',
  prop: 'cockpit',        // a light twin — the tub these numbers were measured against
  heavy: 'cockpit',       // a transport flight deck: bigger, same shape, and you sit in the nose of it
  gunship: 'cockpit',
  divebomber: 'cockpit',
  hydro: 'boat',          // a race boat: lower, narrower, one seat, and its dials are geometry
  // ultralight  — an open frame, with no cabin to be inside of
  // heli        — a bubble that glazes below your feet, which this profile cannot express
  // wreck       — it is a wreck
};

export function shellProfileFor(cls) {
  const key = cls && SHELL_CLASS[cls];
  return key ? SHELL_PROFILES[key] : null;
}

// ── GEOMETRY HELPERS ─────────────────────────────────────────────────────────
//
// A quad with the normal stated rather than derived. ⚠ STATED, BECAUSE THE WINDING CANNOT BE
// TRUSTED TO SAY IT — `gl/solids.js` disables face culling (a sheet is visible from both sides, and
// the mirrored pass flips every winding), so a normal recovered from the corner order is a normal
// that flips in the reflection and shades the floor as the ceiling in a puddle. The same sign
// argument the mass pass lost once and now solves rather than reasons through.
const quad = (p, n) => ({ p, n });

// A box, as its six faces, each with the direction it actually faces. Given as two corners so a
// part is described by where it IS rather than by a centre and three half-extents, which is the
// form every number in the profiles above is already in.
function box(x0, y0, z0, x1, y1, z1) {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
  return [
    quad([[ax, ay, bz], [bx, ay, bz], [bx, by, bz], [ax, by, bz]], [0, 0, 1]),    // top
    quad([[ax, by, az], [bx, by, az], [bx, ay, az], [ax, ay, az]], [0, 0, -1]),   // bottom
    quad([[ax, by, az], [ax, by, bz], [bx, by, bz], [bx, by, az]], [0, 1, 0]),    // front
    quad([[bx, ay, az], [bx, ay, bz], [ax, ay, bz], [ax, ay, az]], [0, -1, 0]),   // back
    quad([[bx, ay, az], [bx, by, az], [bx, by, bz], [bx, ay, bz]], [1, 0, 0]),    // right
    quad([[ax, by, az], [ax, ay, az], [ax, ay, bz], [ax, by, bz]], [-1, 0, 0]),   // left
  ];
}

// A wall in the x = k plane with a rectangular hole in it, as the four pieces around the hole.
//
// ⚠ FOUR QUADS AND NEVER A PANE. See the ⚠ at the top: this layer writes depth whatever the alpha,
// so a translucent quad across a window is a depth value in front of the whole city behind it.
// A hole is an absence, and the only way to express an absence in a triangle soup is to not put a
// triangle there.
function wallWithHole(k, nx, y0, y1, z0, z1, hy0, hy1, hz0, hz1) {
  const n = [nx, 0, 0];
  const pane = (a0, a1, b0, b1) => quad([[k, a0, b0], [k, a1, b0], [k, a1, b1], [k, a0, b1]], n);
  return [
    pane(y0, y1, z0, hz0),    // below the glass: the door card
    pane(y0, y1, hz1, z1),    // above it: the rail up to the roof
    pane(y0, hy0, hz0, hz1),  // aft of it
    pane(hy1, y1, hz0, hz1),  // and forward of it, which is the post you lean around
  ];
}

// ── THE SHELL ────────────────────────────────────────────────────────────────
//
// Returns faces in METRES about the eye, each carrying the direction it faces and which palette
// key it wants. Nothing here is a colour and nothing here is a tile: the renderer resolves both,
// so this function is pure and the gate can read it with no canvas, no camera and no DOM.
export function shellFaces(profile, live = null) {
  const P = profile;
  if (!P) return [];
  const out = [];
  // `fwd` marks a part of the FORWARD APERTURE — the header, the pillars, the centre post and the
  // dash slab. See the ⚠ THE PAINTED CAB OWNS THE FORWARD VIEW note above.
  //
  // `rgb` and `emis` are the instrument channel, and they are OPTIONAL so nothing that already had
  // a shell changed shape: a face with neither is resolved off the colourway and shaded by the
  // ambient exactly as before. `rgb` states a colour the colourway has no word for (a lit segment,
  // a redline tick), and `emis` 0..1 is how far that colour ignores the light in the cabin — which
  // is the whole of what makes a dial readable at midnight without a second lighting model.
  const push = (fs, tone, k, fwd, rgb, emis) => {
    for (const f of fs) {
      const o = { p: f.p, n: f.n, tone, k, fwd: fwd ? 1 : 0 };
      if (rgb) { o.rgb = rgb; o.emis = emis || 0; }
      out.push(o);
    }
  };

  // ⚠ THE BOAT IS A LOFT AND EVERYTHING ELSE IS A BOX, and that is a property of the SUBJECT
  // rather than a style: a tractor cab and an aircraft tub are described by nothing else in the
  // codebase, so six planes and two window rectangles are a complete and honest account of them.
  // The hydro's room is the inside of a house that is already drawn, curve for curve, a few
  // hundred lines away — so it is built off those curves. See the ⚠ at the top of this file.
  if (P.loft) {
    loftedRoom(P, push);
    seatFaces(P, push);
    if (P.instruments) instrumentFaces(P, live, push);
    return out;
  }

  const xL = P.xCentre - P.halfW, xR = P.xCentre + P.halfW;
  const [wy0, wy1] = P.winY, [wz0, wz1] = P.winZ;

  // THE FLOOR. Flat, dark, and the one surface in here nothing else describes — which is most of
  // why its absence read as floating rather than as a missing part.
  push([quad([[xL, P.back, P.floor], [xR, P.back, P.floor], [xR, P.front, P.floor], [xL, P.front, P.floor]], [0, 0, 1])],
       'floor', -0.30);

  // THE HEADLINING. It faces the driver, so by the one light it is the darkest thing in here.
  push([quad([[xL, P.front, P.roof], [xR, P.front, P.roof], [xR, P.back, P.roof], [xL, P.back, P.roof]], [0, 0, -1])],
       'hdr', -0.45);

  // THE REAR BULKHEAD, and a parcel shelf on it. ⚠ THE SHELF IS WHY THE BULKHEAD READS AS A WALL
  // AND NOT AS A BACKDROP: a flat plane at one tone behind you is the same picture whatever the
  // light is doing, and a lip standing off it catches the light on its top face and nowhere else,
  // which is the one cue that says the surface has a front.
  // ⚠ AND IT CARRIES A DOOR IF THE PROFILE SAYS SO. An enclosed helm is entered from somewhere, and
  // on a boat that somewhere is the aft deck — so the bulkhead behind your head is the one wall with
  // a way out of it. Drawn as a REVEAL and a panel rather than as a rectangle in a different shade,
  // for the reason the exterior's own door note gives: at any distance a shade change reads as dirt
  // and a step reads as a door. A profile with no `door` gets the single quad it always had, so the
  // truck and the aircraft tub are untouched.
  if (P.door) {
    const dw = P.door.halfW ?? 0.26, dtop = P.door.top ?? (P.floor + (P.roof - P.floor) * 0.78);
    const n = [0, 1, 0], b = P.back;
    const pane = (x0, x1, z0, z1) => quad([[x1, b, z0], [x0, b, z0], [x0, b, z1], [x1, b, z1]], n);
    push([pane(xL, -dw, P.floor, P.roof), pane(dw, xR, P.floor, P.roof),
          pane(-dw, dw, dtop, P.roof)], 'post', -0.16);
    // The door itself, set INTO the opening from inside so the jamb has depth. ⚠ FORWARD of the
    // bulkhead, never aft of it:  IS the shell bounds, so a panel hung 3 cm outside it is 28
    // vertices out of the box — which the gate refuses by name, and which would be a door floating
    // behind the boat.
    push([quad([[dw, b + 0.03, P.floor], [-dw, b + 0.03, P.floor], [-dw, b + 0.03, dtop], [dw, b + 0.03, dtop]], n)],
         'post', -0.24);
    push(box(-dw, b + 0.03, P.floor, -dw + 0.02, b, P.roof), 'pil', -0.12);   // the jambs, as solids
    push(box(dw - 0.02, b + 0.03, P.floor, dw, b, P.roof), 'pil', -0.12);
  } else {
    push([quad([[xR, P.back, P.floor], [xL, P.back, P.floor], [xL, P.back, P.roof], [xR, P.back, P.roof]], [0, 1, 0])],
         'post', -0.16);
  }
  push(box(xL, P.back, 0.10, xR, P.back + 0.22, 0.20), 'hdr', 0.10);

  // THE DOORS, each with the side window cut out of it.
  push(wallWithHole(xL, 1, P.back, P.front, P.floor, P.roof, wy0, wy1, wz0, wz1), 'pil', -0.10);
  push(wallWithHole(xR, -1, P.back, P.front, P.floor, P.roof, wy0, wy1, wz0, wz1), 'pil', -0.22);

  // THE HEADER over the screen, and the A-PILLARS down each side of it.
  //
  // ⚠ THEY ARE SOLIDS RATHER THAN SHEETS, which is the 2-D cab's third rule ("a pillar with a lit
  // return has thickness") and it matters more here than it does there: a pillar with no depth is
  // invisible edge-on, so the exact moment you turn your head to look past it — the only moment it
  // is doing anything — it stops existing.
  push(box(xL, P.front - 0.10, P.headerZ, xR, P.front, P.roof), 'hdr', 0.18, true);
  push(box(xL, P.front - P.pillarW, P.dashZ, xL + P.pillarW, P.front, P.roof), 'pil', 0.26, true);
  push(box(xR - P.pillarW, P.front - P.pillarW, P.dashZ, xR, P.front, P.roof), 'pil', 0.26, true);
  if (P.centrePost > 0) {
    push(box(P.xCentre - P.centrePost, P.front - P.pillarW, P.dashZ, P.xCentre + P.centrePost, P.front, P.headerZ),
         'post', 0.22, true);
  }

  // THE DASH, as a top face that looks at the daylight and a fascia that looks at the driver.
  //
  // ⚠ IT IS THE SLAB AND NEVER THE INSTRUMENTS. `paintCabDash` draws every dial, switch, needle and
  // lamp on its own canvas at native resolution, keyed to repaint only when a value moved, and it
  // is the best-looking thing in the seat. Modelling a second dashboard here would put two boards
  // a few centimetres apart disagreeing about where the rev counter is. This is what the painted
  // board SITS ON, which is the part that was missing — it is what you see when you look down.
  push(box(xL, P.dashY, P.dashZ - 0.06, xR, P.front, P.dashZ), 'dash', 0.34, true);
  push([quad([[xL, P.dashY, P.floor], [xR, P.dashY, P.floor], [xR, P.dashY, P.dashZ], [xL, P.dashY, P.dashZ]], [0, -1, 0])],
       'dash', -0.34, true);

  seatFaces(P, push);

  if (P.instruments) instrumentFaces(P, live, push);

  return out;
}

// THE SEATS. The one you are on — which you can only ever see the front edge and the squab of, and
// that is correct — and the empty one beside you, which is the one that actually reads, because it
// is the thing in here you can look straight at.
//
// ⚠ SHARED BY BOTH ROOMS, because a seat is a property of the person rather than of the vehicle:
// it is the same object at the same size in a truck, a light twin and a boat, and the only thing
// that moves is where the floor under it is.
function seatFaces(P, push) {
  const seat = (cx) => {
    push(box(cx - P.seatHalf, P.seatY[0], P.seatZ - 0.16, cx + P.seatHalf, P.seatY[1], P.seatZ), 'seat', 0.06);
    push(box(cx - P.seatHalf, P.seatY[0] - 0.16, P.seatZ, cx + P.seatHalf, P.seatY[0], P.backZ), 'seat', -0.08);
  };
  seat(0);                  // yours: the eye is over its centreline by construction
  // ⚠ AND THE PASSENGER'S ONLY IF THERE IS ONE. It is yours mirrored about the centreline, which is
  // the right construction for a cab and degenerate for a single-seater: a helm seat sits close
  // enough to the centreline that the mirror can land within a couple of centimetres of the
  // original, and the two squabs then z-fight with each other for every pixel. `seats` defaults to
  // 2, so nothing that already had a shell changed.
  if ((P.seats ?? 2) > 1) seat(2 * P.xCentre);
}

// ── THE INSTRUMENTS, AS GEOMETRY ─────────────────────────────────────────────
//
// ⚠ THIS EXISTS FOR ONE PROFILE AND MUST NOT SPREAD TO THE OTHERS. A truck's board is thirteen
// hundred lines of needles, six-pixel legends, gradients and glyphs, drawn at authored SCREEN
// proportions because that is what reads as a cab; rebuilding THAT here would be a worse copy of
// the best-looking thing in the seat. A race boat's board is five things — revs, speed, hull,
// bottle, and a lamp that means stop — and five things are cheaper as objects than as a painting.
//
// ⚠ EVERYTHING IS FLAT-SHADED AND SOME OF IT IS LIT. `gl/solids.js` is a flat colour per face by
// design, so there is no texture to letter with and no shader to glow with: a lit segment is a face
// carrying its own `rgb` and an `emis` that says how far it ignores the ambient. That is what makes
// a gauge readable at midnight without a second lighting model.
//
// ⚠ AND IT IS A PURE FUNCTION OF (PROFILE, LIVE). No clock, no camera, no canvas — so the gate can
// drive a needle to both stops and read where it went, and so the same numbers land in the same
// place whatever is drawing them.

// Which of the seven bars each digit lights. Index order: a top, b upper-right, c lower-right,
// d bottom, e lower-left, f upper-left, g middle.
const SEG7 = {
  0: [1, 1, 1, 1, 1, 1, 0], 1: [0, 1, 1, 0, 0, 0, 0], 2: [1, 1, 0, 1, 1, 0, 1],
  3: [1, 1, 1, 1, 0, 0, 1], 4: [0, 1, 1, 0, 0, 1, 1], 5: [1, 0, 1, 1, 0, 1, 1],
  6: [1, 0, 1, 1, 1, 1, 1], 7: [1, 1, 1, 0, 0, 0, 0], 8: [1, 1, 1, 1, 1, 1, 1],
  9: [1, 1, 1, 1, 0, 1, 1],
};

const LAMP_ON = [232, 246, 255];    // a lit segment or needle
const LAMP_RED = [255, 96, 84];     // the hull warning, and the tacho's own redline
const LAMP_AMBER = [255, 178, 72];  // the bottle
const LAMP_GREEN = [120, 240, 170];
const LAMP_OFF = [26, 30, 36];      // an unlit segment is a real object, not an absence

function instrumentFaces(P, live, push) {
  const I = P.instr || {};
  const L = live || {};
  // ⚠ THE CLUSTER IS IN FRONT OF THE DRIVER, NOT ON THE CENTRELINE, and those were the same place
  // until a profile moved its helm. A boat with a starboard wheel puts its gauges where the person
  // reading them is; keyed to `xCentre` they slide half a metre to port of the only pair of eyes
  // in the cabin. `instr.cx` says where the helm is, and defaults to the centreline so nothing
  // without one changes.
  const cx = (P.instr && P.instr.cx != null) ? P.instr.cx : P.xCentre;

  // ── THE PANEL IS A RAKED BINNACLE, NOT A PLATE ON THE FASCIA ───────────────
  //
  // ⚠ THE FIRST CUT PUT THE CLUSTER IN THE FASCIA PLANE — flat in y, hanging under the dash lip —
  // and measured, that is 48 DEGREES BELOW THE EYE LINE: you have to drop your chin onto your chest
  // to read your own rev counter, and in the seat it simply was not in frame. A race boat does not
  // put its gauges there. It stands a pod on TOP of the dash, raked back so you look slightly down
  // onto it, which is a plane tilted in both y and z — so the whole cluster is authored in panel
  // coordinates and mapped, rather than being authored in world axes and nudged.
  //
  // Bottom edge nearer the driver and lower, top edge further forward and higher — a lectern. That
  // sign is what puts the normal back-and-UP; flip it and the panel faces the floor.
  const yB = I.panelY0 ?? 0.52, zB = I.panelZ0 ?? -0.34;
  const yT = I.panelY1 ?? 0.62, zT = I.panelZ1 ?? -0.05;
  const ay = yT - yB, az = zT - zB;
  const PH = Math.hypot(ay, az) || 1;          // the panel's own height, in metres
  const uy = ay / PH, uz = az / PH;            // one metre up the panel
  const N = [0, -uz, uy];                      // and the way it faces
  const HW = I.panelHW ?? 0.42;                // half its width

  // Panel coordinates: `u` across from the centreline, `v` up the panel from its bottom edge,
  // `lift` proud of the face — which is how a needle sits in front of its own dial without
  // fighting it for the depth test.
  const pt = (u, v, lift = 0) => [cx + u, yB + uy * v + N[1] * lift, zB + uz * v + N[2] * lift];
  const plate = (pts, rgb, emis, lift = 0) =>
    push([quad(pts.map(([u, v]) => pt(u, v, lift)), N)], 'dash', 0.34, true, rgb, emis);
  const rect = (u0, v0, u1, v1, rgb, emis, lift = 0) =>
    plate([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], rgb, emis, lift);

  // The backplate, and the two cheeks that give the pod a thickness so it reads as an object
  // standing on the dash rather than as a decal lying on it.
  rect(-HW, 0, HW, PH, [22, 25, 30], 0, 0);
  for (const s of [-1, 1]) push([quad([
    pt(s * HW, 0, 0), pt(s * HW, PH, 0), [cx + s * HW, yB, zB - 0.05], [cx + s * HW, yB, zB - 0.05],
  ], [s, 0, 0])], 'dash', 0.10, true, [18, 20, 24], 0);

  // ── THE TACHO ──────────────────────────────────────────────────────────────
  // A ring of ticks and a needle. The ticks are objects, so the dial reads as an instrument at
  // night when the ambient has taken everything else away.
  const tr = I.tachoR ?? 0.088, tz = PH * 0.62;
  const tcx = -0.285;
  const SEGN = 20;
  for (let i = 0; i < SEGN; i++) {
    const a0 = (i / SEGN) * Math.PI * 2, a1 = ((i + 1) / SEGN) * Math.PI * 2;
    const r0 = tr, r1 = tr * 1.12;
    plate([
      [tcx + Math.cos(a0) * r0, tz + Math.sin(a0) * r0], [tcx + Math.cos(a1) * r0, tz + Math.sin(a1) * r0],
      [tcx + Math.cos(a1) * r1, tz + Math.sin(a1) * r1], [tcx + Math.cos(a0) * r1, tz + Math.sin(a0) * r1],
    ], [58, 64, 74], 0, 0.006);
  }
  plate(ringPts(tcx, tz, tr, SEGN), [14, 16, 20], 0, 0.002);
  const A0 = Math.PI * 1.25, SWEEP = Math.PI * 1.5;
  const TICKS = 9;
  for (let i = 0; i <= TICKS; i++) {
    const f = i / TICKS, a = A0 - f * SWEEP;
    const red = f > 0.78;                       // the redline, and it is a real mark on the dial
    const r0 = tr * (i % 3 === 0 ? 0.62 : 0.78), r1 = tr * 0.92;
    const wdt = (i % 3 === 0 ? 0.010 : 0.005);
    const nx = -Math.sin(a), nz = Math.cos(a);
    plate([
      [tcx + Math.cos(a) * r0 - nx * wdt, tz + Math.sin(a) * r0 - nz * wdt],
      [tcx + Math.cos(a) * r0 + nx * wdt, tz + Math.sin(a) * r0 + nz * wdt],
      [tcx + Math.cos(a) * r1 + nx * wdt, tz + Math.sin(a) * r1 + nz * wdt],
      [tcx + Math.cos(a) * r1 - nx * wdt, tz + Math.sin(a) * r1 - nz * wdt],
    ], red ? LAMP_RED : [150, 160, 172], red ? 0.55 : 0.22, 0.008);
  }
  const rev = clampN(L.rpm ?? 0, 0, 1);
  const na = A0 - rev * SWEEP;
  const ns = Math.sin(na), nc = Math.cos(na);
  const px = -ns, pz = nc;                      // perpendicular to the needle
  plate([
    [tcx + nc * (-tr * 0.22) - px * 0.008, tz + ns * (-tr * 0.22) - pz * 0.008],
    [tcx + nc * (-tr * 0.22) + px * 0.008, tz + ns * (-tr * 0.22) + pz * 0.008],
    [tcx + nc * (tr * 0.86) + px * 0.0022, tz + ns * (tr * 0.86) + pz * 0.0022],
    [tcx + nc * (tr * 0.86) - px * 0.0022, tz + ns * (tr * 0.86) - pz * 0.0022],
  ], rev > 0.78 ? LAMP_RED : LAMP_ON, 0.9, 0.012);
  plate(ringPts(tcx, tz, tr * 0.10, 8), [70, 78, 90], 0.2, 0.014);   // the pivot boss

  // ── THE SPEED ──────────────────────────────────────────────────────────────
  // Three seven-segment digits. ⚠ AN UNLIT SEGMENT IS DRAWN, not skipped: a real display has all
  // seven bars there whether or not they are lit, and leaving them out makes a 1 read as a stray
  // mark floating in the middle of nothing.
  const dh = I.digitH ?? 0.080, dw = dh * 0.52;
  const spd = Math.max(0, Math.min(999, Math.round(L.speed ?? 0)));
  const chars = String(spd).padStart(3, ' ').split('');
  const dx0 = -0.165;
  rect(dx0 - 0.014, tz - dh * 0.5 - 0.014, dx0 + 2 * (dw + dh * 0.16) + dw + 0.014,
    tz + dh * 0.5 + 0.014, [10, 12, 15], 0, 0.006);
  chars.forEach((ch2, i) => {
    const ox2 = dx0 + i * (dw + dh * 0.16);
    const on = ch2 === ' ' ? [0, 0, 0, 0, 0, 0, 0] : SEG7[+ch2];
    seg7Faces(ox2, tz - dh * 0.5, dw, dh).forEach((pts, k) => {
      plate(pts, on[k] ? LAMP_GREEN : LAMP_OFF, on[k] ? 0.95 : 0, 0.010);
    });
  });

  // ── THE GPS ────────────────────────────────────────────────────────────────
  //
  // ⚠ COURSE-UP, AND IT IS A CHART RATHER THAN A MAP. There is no terrain in here and there must
  // not be: threading the map window into the shell would make the cockpit depend on the world
  // snapshot, and a boat whose instruments stop working because a cell was missing is a worse
  // failure than one with a simpler screen. What a driver at 140 mph actually needs is WHERE THE
  // NEXT MARK IS RELATIVE TO THE BOW, which is two numbers — bearing and range — and both are
  // things a plotter genuinely knows.
  //
  // ⚠ THE OWN SHIP IS FIXED AND THE MARK MOVES. Course-up is the only presentation that works on a
  // hull that changes heading faster than it changes position; north-up would spin the whole screen
  // every time the boat twitched, which is unreadable and is why a plotter does not do it.
  const gx0 = 0.170, gx1 = HW - 0.02, gv0 = PH * 0.18, gv1 = PH * 0.92;
  const gcx = (gx0 + gx1) / 2, gcv = (gv0 + gv1) / 2;
  const gw = (gx1 - gx0) / 2, gh = (gv1 - gv0) / 2;
  rect(gx0 - 0.008, gv0 - 0.008, gx1 + 0.008, gv1 + 0.008, [52, 58, 68], 0, 0.005);   // bezel
  rect(gx0, gv0, gx1, gv1, [8, 14, 12], 0, 0.007);                                     // the screen
  // The range rings — two, because one is a circle and two are a SCALE.
  for (const k of [0.45, 0.85]) {
    const rr = Math.min(gw, gh) * k;
    const RN = 16;
    for (let i = 0; i < RN; i++) {
      const a0 = (i / RN) * Math.PI * 2, a1 = ((i + 0.55) / RN) * Math.PI * 2;
      plate([
        [gcx + Math.cos(a0) * rr, gcv + Math.sin(a0) * rr], [gcx + Math.cos(a1) * rr, gcv + Math.sin(a1) * rr],
        [gcx + Math.cos(a1) * (rr + 0.0022), gcv + Math.sin(a1) * (rr + 0.0022)],
        [gcx + Math.cos(a0) * (rr + 0.0022), gcv + Math.sin(a0) * (rr + 0.0022)],
      ], [40, 96, 70], 0.35, 0.009);
    }
  }
  // Own ship: a chevron at the middle, pointing up the screen, because up the screen is the bow.
  plate([[gcx, gcv + 0.020], [gcx + 0.013, gcv - 0.014], [gcx, gcv - 0.006], [gcx - 0.013, gcv - 0.014]],
    LAMP_GREEN, 0.95, 0.011);
  // The mark, if there is one. Bearing is RELATIVE to the bow in degrees; range is normalised 0..1
  // of the outer ring, and is CLAMPED rather than dropped — a mark off the top of the scale is the
  // one you most want to see the direction of.
  const g = L.gps;
  if (g && g.bearing != null) {
    const ba = (g.bearing || 0) * Math.PI / 180;
    const rr = Math.min(gw, gh) * 0.85 * clampN(g.range ?? 0.5, 0.08, 1);
    const mx = gcx + Math.sin(ba) * rr, mv = gcv + Math.cos(ba) * rr;
    const off = (g.range ?? 0) > 1;
    rect(mx - 0.011, mv - 0.011, mx + 0.011, mv + 0.011, off ? LAMP_AMBER : LAMP_ON, 0.95, 0.011);
    // And a rhumb from the boat to it, so the screen says GO THAT WAY rather than merely where it is.
    const dx1 = Math.sin(ba), dv1 = Math.cos(ba), nxp = -dv1 * 0.0028, nvp = dx1 * 0.0028;
    plate([[gcx + nxp, gcv + nvp], [mx + nxp, mv + nvp], [mx - nxp, mv - nvp], [gcx - nxp, gcv - nvp]],
      [60, 150, 110], 0.55, 0.010);
  }

  // ── THE THREE BARS ─────────────────────────────────────────────────────────
  // Fuel, hull and bottle, along the bottom where a glance finds them without leaving the road.
  // Each is a channel with a block in it: the channel is always there, so an empty one is legibly
  // EMPTY rather than gone — which is the whole difference between "no fuel" and "no gauge".
  // ⚠ VERTICAL COLUMNS, AND THAT IS FORCED BY THE SHAPE OF THE PANEL RATHER THAN CHOSEN. The pod is
  // a wide letterbox — it cannot be tall, because the top has to stay under the eye line and the
  // bottom quarter disappears behind the dash lip — so a row of horizontal bars across the bottom
  // is a row of bars you cannot see. Measured: with them there, the bottom 24% of the cluster was
  // below the visible dash edge. Everything lays out LEFT TO RIGHT for the same reason.
  const bw = 0.016, bv0 = 0.085, bv1 = PH - 0.010;
  const bar = (bu, frac, rgb) => {
    rect(bu - bw, bv0, bu + bw, bv1, [12, 14, 18], 0, 0.006);
    const f = clampN(frac, 0, 1);
    if (f > 0.001) rect(bu - bw + 0.004, bv0 + 0.004, bu + bw - 0.004,
      bv0 + 0.004 + (bv1 - bv0 - 0.008) * f, rgb, 0.85, 0.010);
  };
  const fuel = clampN(L.fuel ?? 1, 0, 1);
  const hull = clampN(L.hull ?? 1, 0, 1);
  bar(0.042, fuel, fuel < 0.12 ? LAMP_RED : fuel < 0.30 ? LAMP_AMBER : LAMP_GREEN);
  bar(0.086, hull, hull < 0.25 ? LAMP_RED : hull < 0.55 ? LAMP_AMBER : LAMP_GREEN);
  bar(0.130, clampN(L.nitro ?? 0, 0, 1), L.nitroOn ? LAMP_ON : LAMP_AMBER);

  // ── THE LAMP THAT MEANS STOP ───────────────────────────────────────────────
  // One warning, and it is deliberately the only one: a row of annunciators is a thing you learn
  // to ignore, and there is exactly one state on this boat worth a light. Above the three bars,
  // because those are the three things that light it.
  const warn = hull < 0.25 || fuel < 0.08 || (L.nitroHeat ?? 0) > 0.82 || !!L.aground;
  rect(-0.165, PH - 0.048, -0.045, PH - 0.008, warn ? LAMP_RED : [30, 18, 18], warn ? 1 : 0, 0.010);

  wheelFaces(P, L, push);
  throttleFaces(P, L, push);
}

// ── THE WHEEL ────────────────────────────────────────────────────────────────
//
// ⚠ A BUTTERFLY, NOT A RIM. A ship's wheel is a circle because it is geared several turns lock to
// lock and your hands travel round it; a race boat is ONE turn or less and your hands never leave
// the grips, so the top and bottom of the circle are dead weight and are cut away. That is what an
// F1 wheel is, and it is the same reason both of them arrived at the same shape. Getting this wrong
// is not a texture detail — a round wheel in here would say the boat steers like the Echelon.
//
// ⚠ AND IT TURNS. `steer` is -1..1 and the whole assembly rotates in its own plane, so what tells
// you how much lock is on is the WHEEL rather than a number somewhere else.
function wheelFaces(P, live, push) {
  const W = (P.instr && P.instr.wheel) || {};
  const L = live || {};
  // ⚠ THE CLUSTER IS IN FRONT OF THE DRIVER, NOT ON THE CENTRELINE, and those were the same place
  // until a profile moved its helm. A boat with a starboard wheel puts its gauges where the person
  // reading them is; keyed to `xCentre` they slide half a metre to port of the only pair of eyes
  // in the cabin. `instr.cx` says where the helm is, and defaults to the centreline so nothing
  // without one changes.
  const cx = (P.instr && P.instr.cx != null) ? P.instr.cx : P.xCentre;
  const cy = W.y ?? 0.44, cz = W.z ?? -0.40;
  // Raked back toward the driver, and much more upright than the gauge pod — you hold it, you do
  // not read it.
  const ay = W.rakeY ?? 0.05, az = W.rakeZ ?? 0.16;
  const M = Math.hypot(ay, az) || 1, uy = ay / M, uz = az / M;
  const N = [0, -uz, uy];
  const ang = (L.steer ?? 0) * (W.lock ?? 105) * Math.PI / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // Wheel coordinates: u across, v up, rotated by the lock on, then mapped onto the wheel plane.
  const pt = (u, v, lift = 0) => {
    const ru = u * ca - v * sa, rv = u * sa + v * ca;
    return [cx + ru, cy + uy * rv + N[1] * lift, cz + uz * rv + N[2] * lift];
  };
  const face = (pts, rgb, emis, lift = 0) =>
    push([quad(pts.map(([u, v]) => pt(u, v, lift)), N)], 'dash', 0.30, true, rgb, emis);
  const rect = (u0, v0, u1, v1, rgb, emis, lift = 0) =>
    face([[u0, v0], [u1, v0], [u1, v1], [u0, v1]], rgb, emis, lift);

  const R = W.r ?? 0.115;                      // half-width across the grips
  const GRIP = [26, 28, 33], RIM = [44, 48, 56];
  // The two grips — the only part your hands are ever on, so they are the fattest thing here.
  for (const s of [-1, 1]) {
    rect(s * R - 0.034, -R * 0.52, s * R, R * 0.52, GRIP, 0, 0.004);
    rect(s * R - 0.034, -R * 0.52, s * R, -R * 0.30, [18, 19, 23], 0, 0.006);   // a thumb stop
  }
  // The flattened top and the shorter flattened bottom — the cut-away that makes it a butterfly.
  rect(-R * 0.70, R * 0.38, R * 0.70, R * 0.52, RIM, 0, 0.004);
  rect(-R * 0.46, -R * 0.52, R * 0.46, -R * 0.40, RIM, 0, 0.004);
  // Two spokes out to the grips.
  for (const s of [-1, 1]) rect(s * 0.026, -0.016, s * (R - 0.030), 0.016, RIM, 0, 0.003);
  // The boss.
  rect(-0.036, -0.030, 0.036, 0.030, [30, 33, 39], 0, 0.006);
  // ⚠ AND THE SHIFT LIGHTS ACROSS THE TOP OF IT, which is the one part of an F1 wheel everybody can
  // picture. They are the SAME `rpm` the tacho needle reads, so the two can never disagree — and
  // they are what you actually use at speed, because they are in your eyeline and the dial is not.
  const rev = clampN(L.rpm ?? 0, 0, 1);
  for (let i = 0; i < 5; i++) {
    const lit = rev > 0.42 + i * 0.125;
    const col = i < 2 ? LAMP_GREEN : i < 4 ? LAMP_AMBER : LAMP_RED;
    rect(-0.028 + i * 0.0145, 0.014, -0.028 + i * 0.0145 + 0.010, 0.026,
      lit ? col : [22, 24, 28], lit ? 0.95 : 0, 0.009);
  }
}

// ── THE THROTTLE ─────────────────────────────────────────────────────────────
//
// ⚠ A LEVER ON THE GUNWALE, NOT A PEDAL. This is the one control on the boat that is genuinely
// different from the truck rather than differently tuned: you set a throttle and it STAYS set,
// which is why a boat can be trimmed to a speed and a car cannot, and it is why the hand that is
// not on the wheel has somewhere to be. It sits outboard at the top of the hull side because that
// is where your hand falls with your elbow on the coaming.
function throttleFaces(P, live, push) {
  const T = (P.instr && P.instr.throttle) || {};
  const L = live || {};
  const side = T.side ?? 1;                              // +1 = starboard hand
  const x = ((P.instr && P.instr.cx != null) ? P.instr.cx : P.xCentre) + side * (T.x ?? 0.44);
  const py = T.y ?? 0.34, pz = T.z ?? -0.44;             // the pivot
  const len = T.len ?? 0.15;
  // A quadrant plate for the lever to run in, so the arm has something to be mounted TO.
  const nrm = [-side, 0, 0];
  const face = (pts, rgb, emis) => push([quad(pts.map(([qy, qz]) => [x, qy, qz]), nrm)], 'dash', 0.16, true, rgb, emis);
  face([[py - 0.085, pz - 0.030], [py + 0.105, pz - 0.030], [py + 0.105, pz + 0.120], [py - 0.085, pz + 0.120]],
    [24, 26, 31], 0);
  // The gate the lever runs in: idle at the back, full ahead forward.
  const A_IDLE = -0.62, A_FULL = 0.72;                   // radians from vertical, aft negative
  const a = A_IDLE + (A_FULL - A_IDLE) * clampN(L.throttle ?? 0, 0, 1);
  const sy = Math.sin(a), sz = Math.cos(a);
  const w = 0.010;
  // The arm, as a bar from the pivot. Perpendicular in the y-z plane is (-sz, sy).
  face([
    [py - sz * w, pz + sy * w], [py + sz * w, pz - sy * w],
    [py + sy * len + sz * w, pz + sz * len - sy * w], [py + sy * len - sz * w, pz + sz * len + sy * w],
  ], [62, 68, 78], 0);
  // The knob, which is what your hand is actually on.
  const ky = py + sy * len, kz = pz + sz * len;
  face([[ky - 0.020, kz - 0.020], [ky + 0.020, kz - 0.020], [ky + 0.020, kz + 0.020], [ky - 0.020, kz + 0.020]],
    [92, 40, 36], 0.25);
  // ⚠ AND A TELL-TALE THAT THE BOTTLE IS OPEN, on the knob rather than on the panel — because the
  // hand that fires it is this one, and a light six inches from your eyes is a light you see with
  // the boat still in your peripheral vision.
  if (L.nitroOn) face([[ky - 0.010, kz + 0.022], [ky + 0.010, kz + 0.022], [ky + 0.010, kz + 0.030], [ky - 0.010, kz + 0.030]],
    LAMP_ON, 1);
}


const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function ringPts(cx, cz, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}

// The seven bars of a digit, as [x,z] quads in a box of width `w` and height `h` whose BOTTOM-LEFT
// is (x, z). Returned in the a,b,c,d,e,f,g order SEG7 indexes.
function seg7Faces(x, z, w, h) {
  const t = h * 0.11;                 // bar thickness
  const mz = z + h / 2, tz2 = z + h, i = t * 0.62;
  const H = (x0, x1, zc) => [[x0, zc - t / 2], [x1, zc - t / 2], [x1 - i, zc + t / 2], [x0 + i, zc + t / 2]];
  const V = (xc, z0, z1) => [[xc - t / 2, z0], [xc + t / 2, z0], [xc + t / 2, z1 - i], [xc - t / 2, z1 - i]];
  return [
    H(x + i, x + w - i, tz2 - t / 2),          // a
    V(x + w - t / 2, mz + i, tz2 - i),         // b
    V(x + w - t / 2, z + i, mz - i),           // c
    H(x + i, x + w - i, z + t / 2),            // d
    V(x + t / 2, z + i, mz - i),               // e
    V(x + t / 2, mz + i, tz2 - i),             // f
    H(x + i, x + w - i, mz),                   // g
  ];
}

// The interior's extent in metres, as [x0, y0, z0, x1, y1, z1]. ⚠ THE GATE READS THIS AND SO DOES
// NOTHING ELSE, on purpose: it is the statement that the eye is in a room, and a second copy
// derived from the faces would pass by construction and prove nothing.
export function shellBounds(profile) {
  const P = profile;
  if (!P) return null;
  return [P.xCentre - P.halfW, P.back, P.floor, P.xCentre + P.halfW, P.front, P.roof];
}

// ── THE HYDRO'S ROOM, MEASURED OFF ITS OWN HOUSE ─────────────────────────────
//
// ⚠ TWO KINDS OF NUMBER LIVE HERE AND THEY COME FROM DIFFERENT PLACES. Anything that is a fact
// about the BOAT — where the bulkhead is, how wide the cabin gets, where the sill runs, how much
// headroom there is — is measured off `boatGeom` and converted once; there is no second opinion
// about any of it. Anything that is a fact about a PERSON — how wide a seat is, how big a wheel
// is, how far your hand reaches — is authored in honest metres, because a human does not scale
// with the hull. Getting that split backwards is how you end up with a boat you resize and a
// steering wheel that resizes with it.
// How finely the room is lofted. ⚠ SHARED WITH `boatProfile` ABOVE ALL ELSE — the profile's
// `halfW` is a bound on vertices these counts decide, so two grids means a wall outside its own
// room by a rounding error.
const ROOM = { NF: 10, NR: 4, NT: 18, NV: 4 };

function boatProfile(row) {
  const G = boatGeom(row);
  const m = G.helm.mPerUnit;       // model units -> metres. See the scale bridge in boat-house.js.
  const E = G.helm;
  // ⚠ +x IS STARBOARD, which is what `throttle.side: 1` has always meant and what the shell's own
  // "+x right" means for somebody facing forward. The two agree, and they have to: the helm is
  // offset to one side and the door is not, so a sign wrong here puts the driver on the far side
  // of a cabin whose door is still where the exterior draws it.
  const X = (g) => (g - E.g) * m;
  const Y = (f) => (f - E.f) * m;
  const Z = (z) => (z - E.z) * m;
  // The lining stands just inboard of the pane, which is itself inboard of the wall. Three
  // surfaces in that order, which is what a real window reveal is and what stops the glass and
  // the trim z-fighting along the whole length of the cabin.
  const LIN = G.INSET - 0.014;

  // The widest the room gets. ⚠ SAMPLED AT EXACTLY THE STATIONS THE ROOM IS BUILT AT, and that is
  // not fussiness. The widest point is not at either end — the hull is still swelling aft of the
  // house while the plan taper has barely started, so the maximum sits a tenth of the way forward
  // and it is a very flat one. Sampled on its own grid the bound came out 0.0001 m UNDER the widest
  // vertex the loft actually emits, and the gate refused ten vertices for being outside a room they
  // are the wall of. A bound and the thing it bounds have to be sampled together.
  let maxHW = 0;
  for (const n of [ROOM.NF, ROOM.NT]) {
    for (let i = 0; i <= n; i++) {
      maxHW = Math.max(maxHW, G.hw(G.hF0 + (G.hF1 - G.hF0) * (i / n), 0) * LIN);
    }
  }

  // The dash top IS the window sill carried round to the screen corner — one line round the whole
  // cabin rather than two that happen to be close. It is also the height the exterior's own
  // aperture starts at, so what you rest your arm on inside is what you see the bottom of the
  // glass at from outside.
  const dashTopZ = G.hz(G.fw, G.sillAt(G.fw));
  const midF = (G.gAft + G.sideF1) / 2;

  const floor = Z(G.soleZ);
  const roofZ = Z(G.roof.rz(G.rF) + G.roof.crownH);

  return {
    label: 'pilothouse',
    // ── measured off the house ──
    xCentre: X(0),
    halfW: maxHW * m,
    floor,
    roof: roofZ,
    front: Y(G.hF1),
    back: Y(G.roof.rf0),
    // ⚠ THE DASH'S DEPTH IS A REACH AND ITS HEIGHT IS THE HOUSE — the two halves of this profile's
    // own split. Derived from the house as a fraction of its length it came out 0.28 m from the
    // eye, which is a dash in your lap and, worse, puts the wheel BEHIND its near edge and buried
    // inside the shelf: the exact failure the old profile's own wheel note is written about, back
    // again by another route. How far you can reach is a fact about arms.
    dashY: 0.72,
    dashZ: Z(dashTopZ),
    headerZ: Z(G.hz(G.rF, 1)),
    pillarW: (row.pillarW ?? 0.040) * m,
    winY: [Y(G.gAft), Y(G.sideF1)],
    winZ: [Z(G.hz(midF, G.sillAt(midF))), Z(G.hz(midF, Math.min(1, G.headAt(midF))))],
    door: { halfW: G.door.halfW * LIN * m, top: Z(G.hz(G.hF0, G.door.topT)) },
    eyeM: G.helm.eyeM,
    // ── authored in metres, because they are people rather than boat ──
    seatZ: floor * 0.72,        // the cushion: a seated eye is about 0.8 m over it
    seatHalf: 0.26,
    seatY: [-0.45, 0.10],
    backZ: 0.20,                // a race seat's headrest comes up past the eye
    centrePost: 0,              // a wrapped screen is one radius and has no post in it
    seats: 1,
    instruments: true,
    instr: {
      // ⚠ THE HELM, NOT THE CENTRELINE. The driver sits to starboard, so the cluster, the wheel
      // and the shift lights all hang off the eye rather than off the boat's axis — which is the
      // same point they were at on every profile until this one moved its seat.
      cx: 0,
      // The gauge pod stands ON the dash (bottom edge a couple of centimetres proud of it, see the
      // note in the exterior's own dash block) and stops short of the eye line, so the cluster is a
      // glance down and the forward ray is clear.
      panelY0: 0.78, panelZ0: Z(dashTopZ) + 0.02,
      panelY1: 0.90, panelZ1: -0.06,
      panelHW: 0.42,
      tachoR: 0.098, digitH: 0.084,
      // A wheel is held, so it sits a forearm in front of the fascia rather than flush to it, and
      // its rim stands proud of the dash top — which is what makes it read as a wheel and not as a
      // disc painted on a board.
      wheel: { y: 0.42, z: -0.40, r: 0.175, rakeY: 0.06, rakeZ: 0.20, lock: 105 },
      // Outboard on the starboard side, where your hand falls with your elbow up on the coaming.
      throttle: { side: 1, x: X(0) + maxHW * m - 0.16, y: 0.34, z: -0.42, len: 0.20 },
    },
    // The curves themselves, for the loft below. Its presence is what selects the lofted room.
    loft: { G, m, X, Y, Z, LIN },
  };
}

// ── THE ROOM, AS A LOFT ──────────────────────────────────────────────────────
//
// ⚠ A BOX INSIDE THIS HOUSE LINES UP AT FOUR CORNERS AND NOWHERE ELSE. The plan narrows toward the
// screen (`houseNose`), the sides lean in as they rise (`houseTumble`), the sheer runs up forward,
// the window is a teardrop and the top is crowned. Every one of those is a curve the exterior
// already draws, so the inside walks the same curves rather than approximating them — and the two
// cannot come apart, because there is only one of each.
function loftedRoom(P, push) {
  const { G, m, X, Y, Z, LIN } = P.loft;
  const { NF, NR, NT, NV } = ROOM;
  const pt = (f, g, z) => [X(g), Y(f), Z(z)];
  const wx = (f, t) => G.hw(f, t) * LIN;           // the lining's half-width
  // The wall at an absolute height: below the deck it is the house's own foot line, above it the
  // tumblehome takes over. One function, so the sole, the sill and the headlining all meet the
  // same surface.
  const tAt = (f, z) => Math.max(0, Math.min(1, (z - G.hz(f, 0)) / (G.hH || 1)));
  const wxAt = (f, z) => wx(f, tAt(f, z));
  const tri = (a, b, c, n) => quad([a, b, c, c], n);
  // ⚠ A WALL STOPS AT THE HEADLINING, NOT AT THE ROOFLINE, and the difference is the lining's own
  // thickness. Run up to `hz(f, 1)` the wall's top edge stands a `THK` slot proud of the panel
  // hung under it — a hairline gap the whole length of the cabin, on both sides, which is a bright
  // line along the top of the wall in a depth-buffered render. Every part that meets the ceiling
  // reads this: the side walls, the bulkhead and the screen pillars.
  const ceil = (f) => G.hz(f, 1) - G.roof.THK;

  const fA = G.hF0, fB = G.hF1;
  const fAt = (i, n) => fA + (fB - fA) * (i / n);

  // ── THE SOLE ───────────────────────────────────────────────────────────────
  {
    const fs = [];
    for (let i = 0; i < NF; i++) {
      const f0 = fAt(i, NF), f1 = fAt(i + 1, NF);
      const w0 = wxAt(f0, G.soleZ), w1 = wxAt(f1, G.soleZ);
      fs.push(quad([pt(f0, -w0, G.soleZ), pt(f1, -w1, G.soleZ),
                    pt(f1, w1, G.soleZ), pt(f0, w0, G.soleZ)], [0, 0, 1]));
    }
    push(fs, 'floor', -0.30);
  }

  // ── THE HEADLINING ─────────────────────────────────────────────────────────
  // The underside of the same crowned panel the exterior draws, spanning the room rather than the
  // overhang: what is outboard of the wall is under the eaves and belongs to the weather.
  {
    const fs = [];
    const THK = G.roof.THK;
    const hzTop = (f, u) => G.roof.rz(f) + G.roof.cr(u) - THK;
    for (let i = 0; i < NF; i++) {
      const f0 = fAt(i, NF), f1 = Math.min(fAt(i + 1, NF), G.rF);
      if (f1 <= f0) break;
      for (let j = 0; j < NR; j++) {
        const u0 = -1 + 2 * (j / NR), u1 = -1 + 2 * ((j + 1) / NR);
        const a = pt(f0, u0 * wx(f0, 1), hzTop(f0, u0)), b = pt(f1, u0 * wx(f1, 1), hzTop(f1, u0));
        const c = pt(f1, u1 * wx(f1, 1), hzTop(f1, u1)), d = pt(f0, u1 * wx(f0, 1), hzTop(f0, u1));
        fs.push(tri(a, b, c, [0, 0, -1]), tri(a, c, d, [0, 0, -1]));
      }
    }
    // ⚠ AND THE LIP AT ITS LEADING EDGE, WHICH IS NOT A DETAIL. The lining is a panel of real
    // thickness hung under the roofline, so its forward edge leaves a `THK` slot between it and
    // the top of the screen. That slot is the top of the windscreen frame, so this draws the
    // frame. ⚠ THE WHOLE-SPHERE SWEEP IS BLIND TO IT AND IS RIGHT TO BE — a ray through the slot
    // is inside the roof SLAB, which the exterior draws, so it never leaves the boat. What it
    // leaves is a bright hairline across the top of the screen from the seat, which is why the
    // gate checks this seam directly instead.
    const lip = [];
    for (let j = 0; j < NR; j++) {
      const u0 = -1 + 2 * (j / NR), u1 = -1 + 2 * ((j + 1) / NR);
      const w = wx(G.rF, 1);
      lip.push(quad([pt(G.rF, u0 * w, hzTop(G.rF, u0)), pt(G.rF, u1 * w, hzTop(G.rF, u1)),
                     pt(G.rF, u1 * w, G.roof.rz(G.rF) + G.roof.cr(u1)),
                     pt(G.rF, u0 * w, G.roof.rz(G.rF) + G.roof.cr(u0))], [0, -1, 0]));
    }
    push(lip, 'hdr', 0.18);
    push(fs, 'hdr', -0.45);
  }

  // ── THE AFT BULKHEAD, AND THE DOOR OUT OF IT ───────────────────────────────
  // ⚠ THE SAME OPENING THE EXTERIOR CUTS. `G.door` is one statement, read by both, so looking
  // through the doorway from the aft deck and looking at it from the helm cannot disagree about
  // where it is or how big it is. The wall it is in TAPERS, because the house does.
  {
    const b = G.hF0, n = [0, 1, 0];
    const dw = G.door.halfW * LIN;
    const zTop = G.hz(b, G.door.topT), zRoof = ceil(b);

    const fs = [];
    const zAt = (i, z0, z1) => z0 + (z1 - z0) * (i / NV);
    // Each side of the door, in vertical steps so the leaning edge is a line and not a stair.
    for (const s of [-1, 1]) {
      for (let i = 0; i < NV; i++) {
        const z0 = zAt(i, G.soleZ, zRoof), z1 = zAt(i + 1, G.soleZ, zRoof);
        const o0 = wxAt(b, z0), o1 = wxAt(b, z1);
        fs.push(quad([pt(b, s * dw, z0), pt(b, s * o0, z0), pt(b, s * o1, z1), pt(b, s * dw, z1)], n));
      }
    }
    // And the panel over the door.
    for (let i = 0; i < NV; i++) {
      const z0 = zTop + (zRoof - zTop) * (i / NV), z1 = zTop + (zRoof - zTop) * ((i + 1) / NV);
      fs.push(quad([pt(b, -dw, z0), pt(b, dw, z0), pt(b, dw, z1), pt(b, -dw, z1)], n));
    }
    // ⚠ AND THE CROWN OVER IT. The headlining is ARCHED across the beam, so a bulkhead with a
    // straight top edge meets it only at the two corners and leaves a lens-shaped gap up the
    // middle — which is five rays out the back of the boat in the gate's sweep, and from inside is
    // a slot of daylight over the door. Zero at the walls and `roofCrown` at the centreline, by
    // construction, so the two meet all the way across.
    const wTop = wxAt(b, zRoof);
    for (let j = 0; j < NR; j++) {
      const u0 = -1 + 2 * (j / NR), u1 = -1 + 2 * ((j + 1) / NR);
      const g0 = u0 * wTop, g1 = u1 * wTop;
      const c0 = zRoof + G.roof.cr(g0 / G.roof.rw(b)), c1 = zRoof + G.roof.cr(g1 / G.roof.rw(b));
      fs.push(quad([pt(b, g0, zRoof), pt(b, g1, zRoof), pt(b, g1, c1), pt(b, g0, c0)], n));
    }
    push(fs, 'post', -0.16);
    // The door itself, set INTO the opening from forward of the bulkhead so the jamb has depth.
    // ⚠ FORWARD, NEVER AFT: `back` is the shell's own bound, and a panel hung outside it is
    // vertices out of the box, which the gate refuses by name.
    const dIn = (G.hF1 - G.hF0) * 0.012;
    push([quad([pt(b + dIn, dw, G.soleZ), pt(b + dIn, -dw, G.soleZ),
                pt(b + dIn, -dw, zTop), pt(b + dIn, dw, zTop)], n)], 'post', -0.24);
    for (const s of [-1, 1]) {
      push([quad([pt(b, s * dw, G.soleZ), pt(b + dIn, s * dw, G.soleZ),
                  pt(b + dIn, s * dw, zTop), pt(b, s * dw, zTop)], [-s, 0, 0])], 'pil', -0.12);
    }
  }

  // ── THE SIDES, WITH THE TEARDROP CUT OUT OF THEM ───────────────────────────
  // ⚠ THE APERTURE IS THE EXTERIOR'S OWN CURVE, not a rectangle that roughly covers it. `sillAt`
  // and `headAt` are the two edges the house is cut by; read them here and the hole you look out
  // of IS the hole somebody outside sees you through, at every station along it.
  {

    for (const s of [-1, 1]) {
      const n = [-s, 0, 0];
      const below = [], above = [];
      for (let i = 0; i < NT; i++) {
        const f0 = G.hF0 + (G.hF1 - G.hF0) * (i / NT), f1 = G.hF0 + (G.hF1 - G.hF0) * ((i + 1) / NT);
        // Under the glass: from the sole up to the sill. Forward of the wrap there is no side
        // aperture at all — that is where the screen turns the corner — so the wall runs up to the
        // sill line the dash top sits on and stops.
        const t0 = Math.min(1, G.sillAt(f0)), t1 = Math.min(1, G.sillAt(f1));
        const s0 = G.hz(f0, t0), s1 = G.hz(f1, t1);
        below.push(
          tri(pt(f0, s * wxAt(f0, G.soleZ), G.soleZ), pt(f1, s * wxAt(f1, G.soleZ), G.soleZ), pt(f1, s * wx(f1, t1), s1), n),
          tri(pt(f0, s * wxAt(f0, G.soleZ), G.soleZ), pt(f1, s * wx(f1, t1), s1), pt(f0, s * wx(f0, t0), s0), n));
        // Over the glass: from the head up to the roofline. ⚠ A ZERO-HEIGHT BAND IS A BROKEN ONE,
        // not a cheap one — the aperture closes to a point aft and runs out at the roof forward,
        // so several of these have no area and a quad with no area has no normal.
        if (f1 > G.sideF1) continue;
        // ⚠ THE BAND CLOSES AT THE HEADLINING, NOT AT t = 1, and getting that wrong does not draw
        // a thin band — it draws an INVERTED one. Forward of about amidships the aperture's head
        // climbs past the panel's underside, so `1 - headAt` is still comfortably positive while
        // `tCeil - headAt` has gone negative, and the wall is emitted upside down between them.
        const tCeil = 1 - G.roof.THK / (G.hH || 1);
        const h0 = Math.min(tCeil, G.headAt(f0)), h1 = Math.min(tCeil, G.headAt(f1));
        if (Math.min(tCeil - h0, tCeil - h1) <= 0.004) continue;
        above.push(
          tri(pt(f0, s * wx(f0, h0), G.hz(f0, h0)), pt(f1, s * wx(f1, h1), G.hz(f1, h1)), pt(f1, s * wx(f1, 1), ceil(f1)), n),
          tri(pt(f0, s * wx(f0, h0), G.hz(f0, h0)), pt(f1, s * wx(f1, 1), ceil(f1)), pt(f0, s * wx(f0, 1), ceil(f0)), n));
      }
      push(below, 'pil', s < 0 ? -0.10 : -0.22);
      push(above, 'pil', s < 0 ? -0.06 : -0.18);
    }
  }

  // ── THE PILLARS AT THE CORNERS OF THE SCREEN ───────────────────────────────
  // The inboard face of the blade the exterior hangs the hardtop off, at the same two stations, so
  // the post you lean round is the post somebody outside sees.
  {
    const apW = (P.pillarW / m);
    for (const s of [-1, 1]) {
      const f0 = G.fw, f1 = G.fwT;
      // ⚠ EACH CORNER AT ITS OWN STATION'S CEILING. The blade rakes AFT as it rises while the
      // headlining rises FORWARD, so one height for both top corners stands the aft one 12 mm
      // proud of the panel it is supposed to be landing on.
      const zb = G.hz(f0, G.sillAt(f0)), zt = ceil(f1), ztA = ceil(f1 - apW);
      const w0 = wx(f0, G.sillAt(f0)), w1 = wx(f1, 1);
      push([quad([pt(f0, s * w0, zb), pt(f0 - apW, s * w0, zb),
                  pt(f1 - apW, s * w1, ztA), pt(f1, s * w1, zt)], [-s, 0, 0])], 'pil', 0.26, true);
      push([quad([pt(f0 - apW, s * w0, zb), pt(f0 - apW, s * w0 * 0.82, zb),
                  pt(f1 - apW, s * w1 * 0.82, ztA), pt(f1 - apW, s * w1, ztA)], [0, -1, 0])], 'pil', 0.10, true);
    }
  }

  // ── THE DASH ───────────────────────────────────────────────────────────────
  // A top face that looks at the daylight and a fascia that looks at the driver, at the height the
  // sill runs round the cabin at. ⚠ THE SLAB ONLY — the cluster standing on it is
  // `instrumentFaces`, which is this profile's own and is geometry rather than a painting.
  {
    const dz = G.hz(G.fw, G.sillAt(G.fw));
    // ⚠ THE NEAR EDGE IS THE PROFILE'S OWN `dashY`, CONVERTED BACK, not a second fraction of the
    // house. Two statements of where a dash starts is a fascia in one place and the slab you can
    // see under it in another.
    const f0 = G.helm.f + P.dashY / m, f1 = G.hF1;
    const top = [], face = [];
    for (let i = 0; i < 4; i++) {
      const a = f0 + (f1 - f0) * (i / 4), b = f0 + (f1 - f0) * ((i + 1) / 4);
      const wa = wxAt(a, dz), wb = wxAt(b, dz);
      top.push(quad([pt(a, -wa, dz), pt(b, -wb, dz), pt(b, wb, dz), pt(a, wa, dz)], [0, 0, 1]));
    }
    const w0 = wxAt(f0, dz);
    face.push(quad([pt(f0, -w0, G.soleZ), pt(f0, w0, G.soleZ),
                    pt(f0, w0, dz), pt(f0, -w0, dz)], [0, -1, 0]));
    push(top, 'dash', 0.34, true);
    push(face, 'dash', -0.34, true);
  }
}
