// Gameday · Rink — the animated sub-screen for the CLUSTER PUCK (CPhL) broadcast.
//
// Same contract as gameday.js (the Deadball diamond): placement-agnostic, renders a
// per-beat `gameday` payload into whatever host it's handed, and exposes the identical
// { apply, clear, setCaption, showIdle, showCard } interface — which is what lets tv.js
// pick a view by sport and change nothing else. A future tablet app mounts it unchanged.
//
// WHAT IT PLAYS BACK. The payload carries the sim's own possession keyframes — a sparse
// chain of {t, p:[x,y], ev, carrier} the server already generated and every client
// splines identically. Nothing here decides anything: the outcome arrived decided, and
// this module's whole job is to make the decided thing legible.
//
// ── THREE THINGS THIS VIEW IS, AND WHY ────────────────────────────────────────────
//
// THE SHEET RUNS VERTICALLY, AND THE CAMERA CHASES THE PUCK. The panel is a landscape
// box; a whole 200×85 sheet drawn end-to-end across it puts every man at three pixels
// and makes the sport unreadable — which is exactly the problem NHL '94 solved by
// standing the rink up and scrolling a zoomed camera along its length. So the sheet is
// drawn TALL and LARGER THAN THE VIEWPORT, and `.gdr-cam` slides under a clipping
// window to keep the puck in frame. You see a zone and a bit, at a size where a man
// reads as a man.
//
// THE MODEL FRAME NEVER ROTATES. The sim's keyframes are `x` along the sheet and `y`
// across it, and so are GEO and DOTS. Standing the rink up is a PROJECTION applied at
// the very edge — `_sx`/`_sy` — and nothing upstream of those two functions knows the
// picture is vertical. Rotating the model instead would have meant reinterpreting every
// coordinate the server sends, which is the one thing a view must never do.
//
// THE ICE IS NEVER STILL. A beat of play arrives about every ten seconds; the old view
// animated the beat and then froze on its last frame for the other nine, which reads as
// a photograph of hockey rather than hockey. Now a rAF loop owns every token: ten
// skaters hold a formation RELATIVE TO THE PUCK, drift with their own seeded wander,
// and the puck keeps circulating through an idle flow between beats. When a beat lands
// it simply takes the puck over — the ice was already alive, and goes back to being
// alive when the beat resolves. The idle flow is COSMETIC and decides nothing: no goal,
// no shot, no stat ever comes out of it.
//
// THE GOALIE IS THE POINT. He is an articulated SVG — mask, chest, blocker, glove, two
// pads, stick — not a dot, because every save type in the sim is a DIFFERENT save and
// a top-down blob can't tell you which. He tracks the puck along his crease while play
// develops, then plays the shot the way the sim says it was played: chest, glove, pad,
// poke, or beaten.

import { cphlMark, cphlLockup } from './cphl-brand.js';

function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── rink geometry (fractions of the sheet, MODEL frame) ─────────────────────────
// `x` runs the LENGTH of the sheet (0 = the away end, 1 = the home end), `y` runs
// across it. This is the sim's own frame — see the possession keyframes — and it is
// deliberately independent of which way the picture is turned.
const GEO = {
  goalLine: [0.075, 0.925],       // the line the puck must fully cross
  cageBack: [0.025, 0.975],       // back mesh — where a scored puck actually stops
  blue: [0.365, 0.635],
  centre: 0.5,
  dotY: [0.26, 0.74],             // the two dot rows
  endDotX: [0.20, 0.80],
  neutralDotX: [0.415, 0.585],
  creaseR: 0.075,
  // Half the goal mouth. A real net is 6ft on an 85ft sheet (0.035); this is wider
  // so the cage still reads at panel size, but the old 0.085 drew a mouth almost half
  // the width of a faceoff circle and the end zone looked like a diagram of a net.
  netHalf: 0.052,
};

// Dot id → [x, y]. The ids are the sim's, and this table is the ONLY place that knows
// where they are; hockey.js deliberately doesn't carry coordinates.
const DOTS = {
  C:   [GEO.centre, 0.5],
  aZL: [GEO.endDotX[0], GEO.dotY[0]], aZR: [GEO.endDotX[0], GEO.dotY[1]],
  hZL: [GEO.endDotX[1], GEO.dotY[0]], hZR: [GEO.endDotX[1], GEO.dotY[1]],
  aNL: [GEO.neutralDotX[0], GEO.dotY[0]], aNR: [GEO.neutralDotX[0], GEO.dotY[1]],
  hNL: [GEO.neutralDotX[1], GEO.dotY[0]], hNR: [GEO.neutralDotX[1], GEO.dotY[1]],
};

// ── the projection ──────────────────────────────────────────────────────────────
// Model → sheet. The sheet SVG is authored at the real 85×200 so a faceoff circle is
// a CIRCLE: the viewBox already carries the sheet's true proportions, so nothing is
// stretched and no shape has to be pre-distorted to survive the box.
//
// The away end (model x = 0) lands at the TOP of the picture, which is the frame the
// sim's `winnerSide` and its dot ids are already computed in.
//
// ── AND THE PICTURE IS 3/4, NOT PLAN ────────────────────────────────────────────
// A pure top-down rink has one fatal problem that no amount of paint fixes: a man
// skating toward the bottom of the screen is the SAME SPRITE ROTATED 180°, so his
// helmet is below his feet and his number is upside down. It reads as a bug even when
// it is geometrically perfect, because nobody has ever watched hockey from directly
// above. NHL '94 never did this: it foreshortened the sheet and stood the players up
// on it, so a skater is always a figure with his head at the top.
//
// SHEET_TILT is that foreshortening — the ice is drawn at 0.62 of its true length, as
// if seen from up in the stands rather than from the roof. Two things fall out of it
// for free and are worth stating, because both look like bugs if you don't expect them:
//   · the faceoff circles become ELLIPSES, which is what a circle on a tilted plane is;
//   · the tokens do NOT squash with it, because the tilt is applied by making the
//     sheet's BOX shorter rather than by transforming it — so every man keeps his true
//     height and stands up off the ice with no counter-transform anywhere.
// The model frame is untouched. This is still a projection at the very edge, and
// nothing upstream of it knows the picture is anything but a rectangle.
const SHEET_TILT = 0.62;
const SHEET_W = 85, SHEET_L = 200;
const _sx = (y) => (1 - y) * SHEET_W;     // across the sheet → screen x
const _sy = (x) => x * SHEET_L;           // along the sheet  → screen y
// The same projection as a percentage, for the DOM tokens that live over the SVG.
const _px = (y) => `${((1 - y) * 100).toFixed(3)}%`;
const _py = (x) => `${(x * 100).toFixed(3)}%`;

// ── the roster ──────────────────────────────────────────────────────────────────
// Five skaters a side, in the positions a viewer expects to be able to name. `lane`
// is where the man lives across the sheet; `depth` is how far ahead of (or behind)
// the puck he plays, signed along his OWN attacking direction — so the identical
// table describes a forechecking winger and a back-checking one, and the defence
// ends up between the puck and its own net without that ever being stated.
// THE DEPTHS ARE BOUNDED BY THE CAMERA, not by realism. A real five-man unit is spread
// over half a zone; drawn at that spread the forwards and the defence were 0.26 of the
// sheet apart — WIDER THAN THE VIEWPORT — so one team was always entirely off-screen and
// the picture never showed a game, only a huddle. Nose to tail both teams now occupy
// about half the visible window, which is what makes a rush read as a rush.
// `grip` was raised across the board once the jobs above existed. The old values had the
// whole unit barely shading toward the puck, so a play that went into a corner moved
// nine men about two feet — the formation was correct and completely inert. A forward
// now follows the puck across most of the width of the sheet and only the defence pair
// really holds its lane, which is the one place holding a lane is the point.
const ROLES = [
  { pos: 'C',  lane: 0.50, withPuck:  0.022, without: -0.022, grip: 0.80 },
  { pos: 'LW', lane: 0.24, withPuck:  0.058, without:  0.004, grip: 0.64 },
  { pos: 'RW', lane: 0.76, withPuck:  0.058, without:  0.004, grip: 0.64 },
  { pos: 'LD', lane: 0.33, withPuck: -0.070, without: -0.098, grip: 0.42 },
  { pos: 'RD', lane: 0.67, withPuck: -0.070, without: -0.098, grip: 0.42 },
];

// Motion budget. A broadcast line holds ~10s on air, so the whole possession has to
// resolve well inside that and still leave the outcome on screen to be read.
const T_STEP = 470;          // a carry — the man skating, so the puck moves at his pace
const T_PASS = 210;          // off the stick and gone; a pass is the fast thing on the ice
const T_WINDUP = 290;        // he plants and the stick comes back before the shot leaves
const T_SHOT = 250;          // the shot itself — fast, it's the only quick thing
const T_DUMP = 260;          // flipped in behind them — it arrives long before he does
const T_BATTLE = 640;        // loose along the wall, and two men are coming for it
const T_DEKE = 520;          // a man beating a man happens slowly, in a phone box
const T_SETTLE = 620;        // the beat after the puck stops before the caption lands
const T_DRAW = 520;          // faceoff: centres in, puck down, swept back

// How hard each token resists being teleported. A skater carries momentum; the puck
// does not, because a pass IS an instantaneous change of direction and smoothing it
// turns every pass into a lazy curve.
const TAU_SKATER = 230;      // ms to close ~63% of the gap to his target
// The man with it is the quickest thing on the ice, and this got quicker still once the
// puck moved onto his blade: he now has a LATERAL offset to hold as well as a position,
// so a slow constant left the blade trailing the puck through the first half of every
// carry — the transient where it still looked like he was kicking it along.
const TAU_CARRIER = 85;
const TAU_CHASE = 105;       // racing a loose puck: the hardest anybody skates
// HOW FAR A MAN'S BLADE IS FROM HIS SPINE, in model-y (fractions of the sheet's width).
// DERIVED, not chosen: the blade sits ~0.43 of the way out from centre in a 32-unit
// viewBox drawn at `.gdr-skater`'s 8.8% of the sheet, so 0.43 × 0.088 ≈ 0.038 — which on
// an 85ft sheet is about three and a half feet of stick, the right answer for a reason
// rather than by coincidence. **If the figure's width or the stick's length changes,
// this changes with them**, or the puck slides off the end of the blade.
const BLADE_REACH = 0.038;
const TAU_WORKING = 165;     // forechecking or working to an outlet — with a purpose
// Camera lag. DELIBERATELY SLOW. This started at 430ms and the picture was queasy to
// watch for a whole period: the sheet is drawn much larger than the window, so a
// half-second correction moves the entire world several hundred pixels under a puck
// that has barely moved, and the eye reads that as the RINK sliding rather than the
// play advancing. A long lag costs nothing — the deadzone below means the camera is
// usually not moving at all — and what it buys is a picture you can look at.
const TAU_CAM = 820;
const TAU_GOALIE = 165;      // he is the quickest thing on the ice across six feet

// ── the free puck ───────────────────────────────────────────────────────────────
// A LOOSE PUCK IS NOT A KEYFRAME. Everything the sim decided — the carry, the pass,
// the shot, where it ended up — arrives as a chain of points and is played back by
// interpolating between them, because those are FACTS and a view may not re-derive a
// fact. But the aftermath of a shot is not a fact: the sim says "pad save", it does not
// say where the rebound went. That was being faked with one more straight lerp to a
// hand-picked resting spot, which is why every rebound in the league died in a gentle
// diagonal and no puck had ever hit the boards.
//
// So the aftermath is INTEGRATED instead: a velocity, ice friction, and dasher boards
// that give some of it back. Nothing that comes out of here can change an outcome —
// the puck is already dead in the sim's ledger by the time it gets a velocity — so a
// carom is free to be genuinely unpredictable. Velocities are in FEET PER SECOND on
// the real 85×200 sheet, which is the only frame in which a bounce angle is correct;
// the two axes are converted separately on the way back into model units, or a puck
// coming off the end boards would leave at the wrong angle.
const PUCK_FRICTION = 0.60;  // fraction of speed kept per second — ice keeps most of it
const BOARD_BOUNCE = 0.52;   // what the dashers give back
const PUCK_DEAD = 3.5;       // ft/s below which it has stopped
// The rink's inside face, in model units. Wider than the goal lines on purpose: a puck
// belongs behind the net, and half the retrievals in hockey happen back there.
const PUCK_BOUNDS = { x0: 0.014, x1: 0.986, y0: 0.030, y1: 0.970 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A tiny deterministic generator, so two viewers watching the same broadcast see the
// same men in the same places. Everything cosmetic is seeded off the payload; nothing
// here is ever asked a question whose answer matters.
function _rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function _hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ── the goalie ──────────────────────────────────────────────────────────────────
// Drawn facing the shooter (the group is flipped for the other end). Every piece is a
// named element so the save animations can move exactly one of them: a glove save that
// also swings the blocker is a goalie having a seizure, not making a save.
//
// Viewbox is 40×48, origin at his skates; he's placed by his centre and scaled by CSS
// so the same markup serves both ends and any panel size.
// HE STANDS TOO, in the same frame as the skaters — a top-down keeper lying in a crease
// full of standing men was the last thing in the picture still drawn in plan, and it
// read as a mask on the floor. Same convention as the skater: blades at y = 0, built
// upward, never rotated. The two ends differ by FRONT vs BACK, not by 180° — the keeper
// at the top of the picture faces down the ice toward you, the one at the bottom is
// seen from behind, and each is standing the right way up.
//
// Every piece keeps its class name, because the save poses address exactly one limb
// each and a glove save that also swings the blocker is a goalie having a seizure.
function _goalieSvg() {
  return (
    `<svg class="gdr-g-svg" viewBox="-16 -32 32 36" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
      `<ellipse class="gdr-g-shadow" cx="0" cy="0.4" rx="8.5" ry="2"/>` +
      `<g class="gdr-g-body">` +
        // THE PADS. Two slabs from the knee down and the widest thing on the ice — they
        // are what a goalie IS from the shooter's point of view. Rolls down the face of
        // each, a knee block at the top and a boot channel at the bottom, because a flat
        // rectangle is a door and a real pad is an assembly.
        `<g class="gdr-g-pad left"><rect x="-8.8" y="-13.4" width="7.0" height="13.4" rx="2.2"/>` +
          `<path class="gdr-g-pad-roll" d="M-8.4 -13 v13 M-6.1 -13 v13 M-3.8 -13 v13"/>` +
          `<line class="gdr-g-pad-strap" x1="-8.4" y1="-9.6" x2="-2.2" y2="-9.6"/>` +
          `<line class="gdr-g-pad-strap" x1="-8.4" y1="-5" x2="-2.2" y2="-5"/>` +
          `<rect class="gdr-g-pad-knee" x="-8.4" y="-13.2" width="6.2" height="2.6" rx="1"/></g>` +
        `<g class="gdr-g-pad right"><rect x="1.8" y="-13.4" width="7.0" height="13.4" rx="2.2"/>` +
          `<path class="gdr-g-pad-roll" d="M2.2 -13 v13 M4.5 -13 v13 M6.8 -13 v13"/>` +
          `<line class="gdr-g-pad-strap" x1="2.2" y1="-9.6" x2="8.4" y2="-9.6"/>` +
          `<line class="gdr-g-pad-strap" x1="2.2" y1="-5" x2="8.4" y2="-5"/>` +
          `<rect class="gdr-g-pad-knee" x="2.2" y="-13.2" width="6.2" height="2.6" rx="1"/></g>` +
        // Chest and arm protector — square and enormous, which is the silhouette. Shoulder
        // floaters on top of it: the two blocks that make a keeper twice as wide as a man.
        // ARMS. The blocker and the trapper used to float in space beside a rounded
        // rectangle, which is exactly why the body read as a sausage with mittens: there
        // was nothing CONNECTING him to his own hands. Two padded arms now run from the
        // shoulders out to each, drawn under the chest so the shoulder overlaps them.
        `<path class="gdr-g-arm" d="M-5.6 -23.2 L-8.0 -22.8 L-9.6 -18.6 L-7.2 -17.8 Z"/>` +
        `<path class="gdr-g-arm" d="M5.6 -23.2 L8.0 -22.8 L9.4 -18.4 L7.0 -17.6 Z"/>` +
        // Chest and belly, as two pieces rather than one slab: the chest protector sits
        // proud over a narrower waist, and that step is most of what gives him a shape.
        `<path class="gdr-g-chest" d="M-6.4 -24.2 h12.8 a2 2 0 0 1 2 2 v6.4 a1.6 1.6 0 0 1-1.6 1.6 h-13.6 a1.6 1.6 0 0 1-1.6-1.6 v-6.4 a2 2 0 0 1 2-2 z"/>` +
        `<path class="gdr-g-belly" d="M-5.2 -14.2 h10.4 a1.4 1.4 0 0 1 1.4 1.4 v1.6 a1.2 1.2 0 0 1-1.2 1.2 h-10.8 a1.2 1.2 0 0 1-1.2-1.2 v-1.6 a1.4 1.4 0 0 1 1.4-1.4 z"/>` +
        // The chest protector's own panels — a keeper's rig is a set of plates, and three
        // seams across it are the cheapest way to stop it reading as one moulded shell.
        `<path class="gdr-g-seam" d="M-6.0 -20.6 h12 M-6.0 -17.8 h12 M0 -24.0 v12"/>` +
        `<path class="gdr-g-float" d="M-7.8 -24.4 h5.6 a1 1 0 0 1 1 1 v2.6 h-6.6 z M2.2 -24.4 h5.6 v3.6 h-5.6 a1 1 0 0 1-1-1 z"/>` +
        // THE FUTURE PART, and it is one line rather than a costume: a live status bar
        // across his chest rig in the club's own colour. Everything else about him is a
        // keeper; this is the thing that says the keeper is wearing a machine.
        `<rect class="gdr-g-rig" x="-3.6" y="-19.6" width="7.2" height="1.2" rx="0.6"/>` +
        // Blocker on the stick side, with its own paddle face, and the stick from it.
        `<g class="gdr-g-blocker"><rect x="7.2" y="-22.4" width="6.0" height="8.0" rx="1"/>` +
          `<path class="gdr-g-blocker-face" d="M8.0 -21.4 v6.2 M9.6 -21.4 v6.2 M11.2 -21.4 v6.2"/></g>` +
        `<g class="gdr-g-stick"><path d="M9.8 -14.4 L12.0 -1.2 M12.0 -1.2 L3.8 -0.3"/>` +
          `<path class="gdr-g-paddle" d="M9.4 -13.6 L11.4 -3.4"/></g>` +
        // The trapper — the one that closes — with its web.
        `<g class="gdr-g-glove"><path d="M-8.2 -23 q-5.0 1.5-5.2 5.4 q-0.2 3.9 3.5 4.8 q3.3 0.8 4.4-2.2 l0.7-6.1 z"/>` +
          `<path class="gdr-g-glove-web" d="M-9.8 -20.8 q-2.2 2.2-1.8 5.0 M-11.6 -18.8 q2.0 0.6 4.0 0.2"/></g>` +
        // Mask and cage. The cage is the FRONT of him and vanishes on the far keeper,
        // which is how the two ends stay told apart — and it now sits behind a visor
        // glow, because in this league the mask is a display.
        `<g class="gdr-g-head"><ellipse cx="0" cy="-27.6" rx="4.4" ry="4.2"/>` +
          `<path class="gdr-g-visor" d="M-3.4 -28.6 q3.4-1.9 6.8 0 l-0.3 1.6 q-3.1-1.6-6.2 0 z"/>` +
          `<path class="gdr-g-cage" d="M-2.8 -27.8 h5.6 M-2.4 -29.8 h4.8 M-2.4 -25.8 h4.8 M0 -30.6 v5.6"/></g>` +
      `</g>` +
    `</svg>`
  );
}

// ── the skater ──────────────────────────────────────────────────────────────────
// A man, not a dot. At the zoom this view now runs at there is room for a body, a
// helmet and a stick, and the stick is the load-bearing part: it's what makes the
// direction he's facing readable, which is what makes a forecheck look like a
// forecheck. The whole figure rotates to his heading; the number tag doesn't, because
// an upside-down number is unreadable and a sweater number is the one thing on the ice
// a broadcast viewer is actually trying to read.
// ── the anatomy ─────────────────────────────────────────────────────────────────
// EVERY LIMB IS A NAMED PART WITH ITS OWN PIVOT, for two reasons that turned out to be
// one reason. The first is animation: a stride is limbs turning at their joints, and a
// figure whose arms are welded to its chest can only ever be a shape that slides. The
// second is the CPhL. This is a league that carries men off and sometimes kills them,
// and a limb that has a joint is a limb that can come OFF at that joint.
//
// So this table is the single source of what a man is made of. Each entry is drawn
// RELATIVE TO ITS OWN PIVOT and wrapped in a translate to put the pivot where it lives,
// which means the inner group's default SVG transform-origin (0,0) already IS the
// shoulder, the hip, the neck — no `transform-box` guesswork, and the same markup
// serves the man wearing the limb and the limb cartwheeling across the ice without it.
// The figure STANDS. His skates are at the origin — which is his position on the ice —
// and he is built upward from there, so placing him is placing his feet and not his
// navel. He is drawn facing RIGHT and is mirrored for the other way; forward is +x.
const LIMB = {
  // The near arm carries the stick, and the stick is the whole 3/4 read: it leaves his
  // hands at chest height and reaches DOWN AND FORWARD to a blade lying flat on the ice
  // in front of him. That one diagonal is what tells you the ice is a receding plane
  // rather than a wall, and it's why the stick is drawn long.
  // ── THE GRIP ────────────────────────────────────────────────────────────────
  // BOTH HANDS ARE ON THE STICK, and they are placed by solving for it rather than by
  // eye. Before this only the near hand held anything: the far glove floated beside his
  // hip with the shaft nowhere near it, so every man was carrying his stick one-handed
  // while his other arm did nothing — which is what made the arms read as flapping
  // beside the body instead of working.
  //
  // The shaft runs from a knob at (1.4, −18.4) down to the blade on the ice at
  // (13.5, −1.5). Both gloves are points ON that line: the TOP hand at (2.0, −17.5) and
  // the BOTTOM hand at (4.2, −14.5), each converted into its own arm's local frame.
  // **If the shaft moves, those two glove positions must be re-solved with it** — that
  // is the whole contract holding this together, and eyeballing it is what broke it.
  armR: { pivot: [3.8, -21.4], svg:
    // AN ARM HAS AN ELBOW. This was a single straight stroke from shoulder to glove —
    // a spar, not a limb — which is why the figure's top half read as a mannequin no
    // matter how well the legs were working. It is now an upper arm and a forearm meeting
    // at a bent elbow, drawn as tapered shapes so the shoulder is thick with padding and
    // the wrist is not, plus an elbow cap where a hockey player wears one.
    // A SHOULDER CAP over the joint. Without it the upper arm simply began at the edge of
    // the sweater — a limb sprouting from a torso rather than attached to it — and no
    // amount of elbow detail below fixes a shoulder that isn't there. It is the padded
    // cap a hockey player actually wears, and it rides with the arm so the joint stays
    // covered through the whole swing instead of opening a gap at full extension.
    `<path class="gdr-sk-shoulder" d="M-2.1 0.7 q-0.4-2.7 2.1-2.9 q2.5 0.2 2.1 2.9 q-2.1 1.0-4.2 0 z"/>` +
    // UPPER ARM AND FOREARM AS TAPERED CURVES, not flat quads. A limb narrows from a
    // padded shoulder to a wrist, and it does it along a curve — straight-edged trapezoids
    // read as planks the moment they rotate, which is all these do. The two overlap deep
    // at the elbow so the joint can swing through its whole range without ever opening a
    // gap between them; the cap on top is what hides the seam.
    // The BOTTOM hand, at local (0.4, 6.9) — a point on the shaft. The arm hangs almost
    // straight down from the shoulder with a slight kick out at the elbow, which is
    // what a lower hand on a stick actually does.
    `<path class="gdr-sk-arm right" d="M-1.5 -0.9 q1.6-0.5 3.0 0.3 q0.4 1.6 0.6 3.5 q-1.2 0.8-2.4 0.5 q-0.6-2.1-1.2-4.3 z"/>` +
    `<path class="gdr-sk-arm right" d="M0.0 2.9 q1.3-0.6 2.4-0.1 q0.3 2.0 0.2 3.9 q-1.0 0.7-2.0 0.4 q-0.3-2.1-0.6-4.2 z"/>` +
    `<ellipse class="gdr-sk-elbow" cx="1.2" cy="3.2" rx="1.4" ry="1.25"/>` +
    `<path class="gdr-sk-cuff" d="M0.5 5.4 L2.1 5.7"/>` +
    `<ellipse class="gdr-sk-glove" cx="0.4" cy="6.9" rx="2.0" ry="1.8"/>` +
    // A LONG stick, reaching all the way down to a blade lying flat on the ice out in
    // front of him. It is the single most important line in the figure: that diagonal
    // from chest height to ice level is what states that the ground is a receding plane
    // and not a wall, and a short stick collapses the whole 3/4 read.
    //
    // AND IT HAS A WRIST. Welded to the shoulder the stick swung as one rigid spar, so
    // every arm swing threw the blade through a huge arc and lifted it clean off the
    // ice — the giveaway that the stick was a painted-on radius after all. It now pivots
    // at the HANDS, inside the shoulder joint, and counter-rotates against the swing:
    // the arms drive it, the wrists absorb most of the throw, and the blade stays down
    // where a blade lives. It also lags the shoulder slightly, which is what makes the
    // whole limb read as a chain of parts rather than one piece.
    // …and inside the wrist, a YAW. The stick is the only part of a skater that reaches
    // out into the world, so it is the only part that can say he is coming AT you rather
    // than across you: swung low and in front when he skates at the camera, tucked high
    // and behind when he skates away, straight out to the side in profile. Without it a
    // man travelling down the ice was drawn in the identical pose as one travelling up
    // it, and the only difference was which marking showed — which is exactly why they
    // all looked like they were skating backwards.
    // The wrist sits at the BOTTOM hand, and the shaft runs THROUGH it — up past the
    // knob (which passes the top hand) and down to a blade flat on the ice. Pivoting
    // here rather than at the top of the stick is what lets the lower hand stay put
    // while the wrists roll, which is how a stick is actually worked.
    `<g class="gdr-sk-wrist" transform="translate(0.4,6.9)"><g class="gdr-sk-wristj">` +
      `<g class="gdr-sk-stickyaw">` +
        `<path class="gdr-sk-stick" d="M-2.8 -3.9 L9.3 13.0"/>` +
        `<path class="gdr-sk-blade" d="M9.3 13.0 L12.7 13.6"/>` +
      `</g>` +
    `</g></g>` },
  // The far arm is the top hand, higher up the shaft and half hidden behind him. It hangs
  // off the FAR shoulder, which on a turned body is higher, further back and closer to
  // the spine — and it is drawn a size smaller, because it is further from the camera.
  // Two arms of identical weight at identical heights is a figure facing you.
  armL: { pivot: [-3.0, -20.6], svg:
    `<path class="gdr-sk-shoulder far" d="M-1.8 0.6 q-0.35-2.4 1.8-2.6 q2.15 0.2 1.8 2.6 q-1.8 0.9-3.6 0 z"/>` +
    // It CROSSES THE BODY to reach the knob — glove at local (5.0, 3.1), which is the
    // point (2.0, −17.5) on the shaft. That diagonal across his chest is the pose the
    // reference is full of, and the thing that was missing: this arm used to hang beside
    // his hip holding nothing at all.
    `<path class="gdr-sk-arm left" d="M-1.2 -0.7 q1.5-0.6 2.8 0.4 q0.7 0.9 1.3 1.8 q-0.7 1.0-1.9 1.0 q-1.1-1.5-2.2-3.2 z"/>` +
    `<path class="gdr-sk-arm left" d="M2.0 1.1 q1.1-0.7 2.0 0.0 q0.7 0.9 1.2 1.8 q-0.6 0.9-1.6 0.9 q-0.9-1.3-1.6-2.7 z"/>` +
    `<ellipse class="gdr-sk-elbow" cx="2.5" cy="1.9" rx="1.1" ry="1.0"/>` +
    `<path class="gdr-sk-cuff" d="M3.6 2.4 L4.6 3.4"/>` +
    `<ellipse class="gdr-sk-glove far" cx="5.0" cy="3.1" rx="1.6" ry="1.4"/>` },
  // LEGS IN A SKATING STANCE — BENT AND SPLAYED. Drawn straight and parallel he stood
  // to attention on skates; nobody in the reference is upright, because a skater's legs
  // are always apart and always bent. Each is a tapered shape that kicks OUT from the
  // hip through a knee and finishes on a blade well outside his own shoulders, which is
  // the widest part of the pose and most of what reads as balance.
  legL: { pivot: [-2.3, -14.0], svg:
    `<path class="gdr-sk-legs" d="M2.2 0 L-1.9 0 L-3.6 6.9 L-4.4 12.2 L-1.8 12.4 L-0.1 7.1 Z"/>` +
    `<path class="gdr-sk-boot" d="M-4.8 12.1 h3.2 l0.45 2.1 h-4.1 z"/>` +
    `<path class="gdr-sk-skate" d="M-6.2 14.9 h5.6"/>` },
  legR: { pivot: [2.3, -14.0], svg:
    `<path class="gdr-sk-legs" d="M-2.2 0 L1.9 0 L3.6 6.9 L4.4 12.2 L1.8 12.4 L0.1 7.1 Z"/>` +
    `<path class="gdr-sk-boot" d="M1.6 12.1 h3.2 l0.45 2.1 h-4.1 z"/>` +
    `<path class="gdr-sk-skate" d="M0.6 14.9 h5.6"/>` },
  // Head on top, where a head goes — SMALL, because what makes a hockey player a hockey
  // player is that his shoulders are enormous and his head is not, and OFFSET toward the
  // way he is facing. Sitting dead on the spine it read as a man staring straight down
  // the camera; a head that leads the shoulders is most of what turns a front-on figure
  // into a three-quarter one.
  head: { pivot: [1.0, -26.6], svg:
    // The skull is an egg, not a ball — wider across the back of the head than the face,
    // which is the silhouette of a head seen from behind and to one side.
    `<path class="gdr-sk-helm" d="M-3.6 -0.4 q0.2-3.4 3.4-3.4 q3.0 0 3.4 3.0 q0.3 2.6-1.6 3.6 q-2.0 1.0-3.6 0.4 q-1.8-0.7-1.6-3.6 z"/>` +
    // The ear cup sits on the FAR side of the helmet, which only exists on a head that
    // is turned. Nothing about a straight-on figure would show it.
    `<ellipse class="gdr-sk-earcup" cx="-2.2" cy="0.4" rx="1.1" ry="1.3"/>` +
    `<path class="gdr-sk-helmline" d="M-3.2 -1.2 q3.4-2.0 6.4 0.2"/>` +
    // A FULL CAGE, and it is the loudest facing cue on the whole figure. It was one thin
    // arc, which at this size is a scratch on the helmet; a real cage is a bright bowl of
    // bars over the whole face, and a bright bowl on one side of a head is unmistakable
    // even at eleven pixels. It exists only on the front, so a man coming at you and a
    // man skating away are never in doubt. Drawn as a shell plus its bars so the shell
    // can carry a dark fill — the shadow inside a cage is what stops it reading as a
    // white blob stuck to his chin.
    // THE MASK, ON HIS FACE. This used to hang off the SIDE of the skull — a cage seen
    // edge-on, which is correct in profile and nonsense the moment a man skates straight
    // at you: the one frame where you should be looking into a full grey cage, and instead
    // it was a scratch at the edge of his head. It is centred on the face now and WIDENS
    // with `--gdr-front`, so head-on you are looking right at it and in profile it
    // narrows back to an edge. The dark field behind the bars carries as much of it as
    // the bars do — a cage is a shadow with metal in front of it, and bars on their own
    // read as a white smear on his chin.
    `<g class="gdr-sk-cage">` +
      `<ellipse class="gdr-sk-cage-shell" cx="0.4" cy="0.3" rx="3.0" ry="2.6"/>` +
      `<path class="gdr-sk-cage-bar" d="M-2.4 -0.8 q2.8 1.0 5.6 0 M-2.6 0.5 q2.9 1.0 5.8 0 M-2.3 1.8 q2.6 0.9 5.2 0"/>` +
      `<path class="gdr-sk-cage-bar" d="M0.4 -2.2 q0.5 2.6 0 5.0"/>` +
    `</g>` },
};
// A part on the body: pivot group, then the joint group CSS rotates.
// Three nested groups per limb, and they are three because they are driven by three
// different things that must not fight each other:
//   · `.gdr-sk-limb`   — the pivot. A translate to the joint, authored, never animated.
//   · `.gdr-sk-stance` — where the limb sits for his current HEADING. Static per frame,
//                        written from `--gdr-side` / `--gdr-front`.
//   · `.gdr-sk-joint`  — what the limb is DOING: stride, crossover, dangle, shot.
// A CSS animation always beats a static transform on the same element, so the heading and
// the action cannot share a group — which is exactly why turning was being done by
// squashing the whole figure instead. With a group of its own, a turn is limbs moving.
function _limb(part) {
  const L = LIMB[part];
  return `<g class="gdr-sk-limb" data-part="${part}" transform="translate(${L.pivot[0]},${L.pivot[1]})">` +
    `<g class="gdr-sk-stance"><g class="gdr-sk-joint">${L.svg}</g></g></g>`;
}

// A MAN, STANDING, SEEN FROM THE STANDS. The viewBox puts his blades at y = 0 and builds
// him upward, so the element is anchored at his FEET — which is where a figure touches
// the plane he's standing on, and the only anchor that makes a shadow land right.
//
// He never rotates. He MIRRORS to face left or right, and swaps between a front and a
// back, which is exactly how a sprite set works and is the reason he is never upside
// down. The number lives on the BACK, because that is where a sweater number is and
// because a man skating away from you is the case where you need to read it.
// The man himself, emitted twice — once upright and once flipped underneath him as his
// reflection. Duplicated markup rather than a `<use>` because a `<use>` needs a unique
// id per skater and ten of those in one document is a naming scheme nobody wants to
// maintain; the classes are shared, so the reflection strides, leans and loses limbs
// with him for free.
function _bodySvg(num, team) {
  return (
    // ── DRAW ORDER IS ANATOMY ────────────────────────────────────────────────
    // Order was: far arm, legs, body, marks, HEAD, near arm — and it was wrong at both
    // ends. The near arm sat in front of the HEAD, so the moment he raised his hands
    // (a check, the top of a slapshot) his own glove covered the mask, which is the
    // single most important thing on the figure for reading which way he faces. And
    // the far arm sat behind EVERYTHING, so when he turned to the camera and the stance
    // swung it round to the front it stayed buried under the sweater — a man facing you
    // with one arm.
    //
    // Now: legs, sweater, FAR ARM, markings, NEAR ARM, head. The far arm comes round in
    // front of the chest where it belongs on a turned body; the number and crest stay
    // legible over it; the near arm and its stick pass in front of the markings, which
    // is what a stick hand does; and the head is last, so the mask is never covered by
    // anything the man himself is holding.
    `<g class="gdr-sk-body">` +
      _limb('legL') + _limb('legR') +
      // Breezers over the top of the thighs: a dark block at the hips that reads as
      // padding rather than as a gap between a shirt and two legs.
      `<path class="gdr-sk-pants" d="M-5.6 -16.0 h11.2 q1.3 0 1.2 1.4 l-0.8 4.2 q-0.15 1.2-1.4 1.2 h-9.2 q-1.25 0-1.4-1.2 l-0.8-4.2 q-0.1-1.4 1.2-1.4 z"/>` +
      // HE HAS A NECK. The helmet used to sit straight down on the shoulder line, which
      // is exactly what makes a figure read as a flat front-on sprite — there was no gap
      // where a neck goes, so the head was just the top of the torso. Drawn before the
      // sweater and the head so both overlap it and only the sliver between them shows.
      `<path class="gdr-sk-neck" d="M-1.4 -24.4 h3.6 l-0.4 3.2 h-3.0 z"/>` +
      // The sweater. SHOULDERS ENORMOUS, waist narrow — the reference figures are about
      // two and a quarter shoulder-widths tall, and that squat, top-heavy proportion is
      // most of what separates a hockey player from a stick man in a shirt.
      //
      // AND IT IS ASYMMETRIC, which is the actual difference between three-quarter and
      // straight-on. The near shoulder (+x, the way he faces) is further out and sits
      // LOWER; the far shoulder is pulled in and rides higher, because it is further from
      // the camera and partly behind him. That sloped, uneven shoulder line is the single
      // strongest cue that a body is turned — a symmetric trapezoid can only ever be a
      // man facing you, however the rest of him is drawn.
      `<path class="gdr-sk-torso" d="M-5.2 -21.2 q0.3-2.1 2.3-2.4 h6.4 q2.7 0.4 3.0 3.0 l-1.7 7.9 q-0.2 1.2-1.7 1.2 h-6.6 q-1.5 0-1.7-1.2 z"/>` +
      // The shoulder yoke follows that same slope — a sweater is not a flat colour, and
      // this band plus the cuffs is what lets two clubs with similar primaries stay apart.
      `<path class="gdr-sk-yoke" d="M-5.2 -21.4 q2.6-2.9 5.6-2.9 q3.2 0 5.8 3.1 l0.26 2.1 q-2.7-2.9-6.06-2.9 q-2.96 0-5.34 2.7 z"/>` +
      // The far side of the chest falls into shadow. One soft wedge, and it is doing the
      // same job as the sloped shoulders: a plane turning away from the light is a plane
      // that is turned at all.
      `<path class="gdr-sk-shade" d="M-5.2 -21.2 q0.3-2.1 2.3-2.4 h2.0 l-0.8 11.1 h-1.8 q-1.5 0-1.7-1.2 z"/>` +
      // The FAR arm, over the sweater and under the markings.
      _limb('armL') +
      // THE MARKINGS ARE PRINTED ON THE SWEATER, so they live INSIDE the body and move
      // with every single thing it does — the lean, the ride, the mirror. They used to
      // sit outside it, which kept the numerals the right way round but left them pinned
      // in space while the torso bobbed and leaned underneath: the number visibly slid
      // about on the shirt.
      //
      // The mirror is cancelled LOCALLY instead. `.gdr-sk-marks` translates to the middle
      // of his chest — so the anchor mirrors with the body, and the crest stays on the
      // chest of a turned figure — and `.gdr-sk-marks-flip` then applies the SAME scaleX
      // again about that point. Two mirrors compose to none, so the glyphs come out
      // upright while everything carrying them is still fully mirrored.
      `<g class="gdr-sk-marks" transform="translate(0.6,-17.4)">` +
        `<g class="gdr-sk-marks-flip">` +
          `<text class="gdr-sk-num" x="0" y="0.7">${num == null ? '' : num}</text>` +
          `<g transform="translate(0.2,-0.9)">${_crestSvg(team)}</g>` +
        `</g>` +
      `</g>` +
      // The NEAR arm and its stick over the markings — the difference between a man
      // holding a stick and a man standing behind one — and the HEAD over everything,
      // so nothing he carries can ever cover his own mask.
      _limb('armR') +
      _limb('head') +
    `</g>`
  );
}

// ── the club crest ──────────────────────────────────────────────────────────────
// A SWEATER HAS A CREST ON THE FRONT AND A NUMBER ON THE BACK, and that split is worth
// more than the decoration: it means the two faces of the figure carry entirely different
// markings, so which way a man is pointed is legible from his chest as well as his
// helmet. Carrying a number on both sides — which is what this did — threw that away.
//
// DERIVED FROM THE CLUB NAME, exactly as the sim derives its colours: same input, same
// method, so a club's crest is its crest every night and no logo ever has to cross the
// wire for a cosmetic. Nothing here is authored per club and nothing can drift out of
// step with the league.
const CREST_EMBLEM = [
  'M0 -2.6 L1.9 2.2 L0 0.9 L-1.9 2.2 Z',                 // a chevron
  'M-2.2 -0.5 h4.4 v1.4 h-4.4 z',                        // a bar
  'M0 -2.6 L0.8 -0.8 L2.6 -0.6 L1.2 0.7 L1.6 2.5 L0 1.6 L-1.6 2.5 L-1.2 0.7 L-2.6 -0.6 L-0.8 -0.8 Z', // a star
  'M0 -2.6 L2.3 0 L0 2.6 L-2.3 0 Z',                     // a diamond
  'M0.9 -2.7 L-1.9 0.5 h1.6 l-0.8 2.6 L2.0 -0.3 h-1.7 z', // a bolt
  'M0 -2.4 a2.4 2.4 0 1 1 -0.01 0 M0 -0.9 a0.9 0.9 0 1 0 0.01 0',  // a ring
];
function _crestSvg(team) {
  const h = _hash(team || 'cphl');
  const emblem = CREST_EMBLEM[h % CREST_EMBLEM.length];
  // The shield: flat across the shoulders of it, tapering to a point. Small, because at
  // playing size this is five pixels and a busy crest is a smudge.
  return (
    `<g class="gdr-sk-crest">` +
      `<path class="gdr-sk-crest-field" d="M-2.9 -3.6 h5.8 v3.1 q0 2.7-2.9 4.0 q-2.9-1.3-2.9-4.0 z"/>` +
      `<path class="gdr-sk-crest-mark" d="${emblem}"/>` +
    `</g>`
  );
}

function _skaterSvg(num, team) {
  return (
    // The box runs well BELOW his blades, because the ice under him carries a
    // reflection and the reflection is part of the figure.
    `<svg class="gdr-sk-svg" viewBox="-16 -30 32 48" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
      // THE FLIP GROUP. Mirroring happens here rather than on the body, so the man and
      // his reflection turn around together and the numbers — outside it — never do.
      `<g class="gdr-sk-flip">` +
        // HE REFLECTS IN THE ICE. Every frame of the reference has it, and it is the
        // cheapest thing in the whole picture that says "polished sheet" rather than
        // "white background": the same body, flipped about the goal line of his own
        // blades, squashed into the foreshortened plane and faded almost out. Drawn
        // FIRST so the man himself covers its top edge, which is what hides the seam.
        `<g class="gdr-sk-reflect">${_bodySvg(num, team)}</g>` +
        _bodySvg(num, team) +
      `</g>` +
    `</svg>`
  );
}

// ── the net ─────────────────────────────────────────────────────────────────────
// A cage with depth, drawn behind the goal line so the puck can be INSIDE it. The mesh
// is a real grid element so it can bulge: a goal scales the mesh outward from the line
// and snaps it back, which is the single most recognisable image in the sport.
//
// `side` −1 = the away end (the TOP of the picture), +1 = the home end (the bottom).
function _netSvg(side) {
  const gl = side < 0 ? GEO.goalLine[0] : GEO.goalLine[1];
  const back = side < 0 ? GEO.cageBack[0] : GEO.cageBack[1];
  const y0 = Math.min(_sy(gl), _sy(back)), y1 = Math.max(_sy(gl), _sy(back));
  // The mouth spans the sheet's width, so it's an x-range once the picture stands up.
  const x0 = _sx(0.5 + GEO.netHalf), x1 = _sx(0.5 - GEO.netHalf);
  const w = x1 - x0, h = y1 - y0;
  let mesh = '';
  // Mesh lines are drawn per-cage rather than as a <pattern> so the bulge transform
  // has something local to scale — a pattern fill can't deform.
  for (let i = 1; i < 4; i++) { const y = y0 + (h * i / 4); mesh += `<line x1="${x0.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y.toFixed(2)}"/>`; }
  for (let i = 1; i < 7; i++) { const x = x0 + (w * i / 7); mesh += `<line x1="${x.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x.toFixed(2)}" y2="${y1.toFixed(2)}"/>`; }
  const lineY = _sy(gl), backY = _sy(back);
  return (
    `<g class="gdr-net" data-side="${side < 0 ? 'l' : 'r'}">` +
      `<g class="gdr-net-mesh">${mesh}</g>` +
      // the cage frame: the back bar and the two side bars, open toward the ice
      `<path class="gdr-net-frame" d="M${x0.toFixed(2)} ${lineY.toFixed(2)} L${x0.toFixed(2)} ${backY.toFixed(2)} L${x1.toFixed(2)} ${backY.toFixed(2)} L${x1.toFixed(2)} ${lineY.toFixed(2)}"/>` +
      // The two posts, drawn ON the goal line — the puck is only in when it's past
      // the plane they define, so they're the reference the crossing is read against.
      `<circle class="gdr-net-post-cap" cx="${x0.toFixed(2)}" cy="${lineY.toFixed(2)}" r="0.8"/>` +
      `<circle class="gdr-net-post-cap" cx="${x1.toFixed(2)}" cy="${lineY.toFixed(2)}" r="0.8"/>` +
      `<g class="gdr-net-lamp"><circle cx="${(SHEET_W / 2).toFixed(2)}" cy="${(side < 0 ? backY - 2.6 : backY + 2.6).toFixed(2)}" r="2.4"/></g>` +
    `</g>`
  );
}

// ── the hoardings ───────────────────────────────────────────────────────────────
// THE BARN SELLS ADVERTISING, and in Coldwater it sells it to Coldwater. Every name on
// these boards is a business that exists in the world — you can walk into most of them —
// which is worth more than any invented sponsor: a viewer who has bought a coffee at
// Battery Acid and then sees it lit up on the dashers is being told the league is part of
// the same city, without a word of exposition.
//
// They are LED panels, not painted boards, because it is not 1996 in Coldwater. Lit from
// within, saturated, and cycling — the arena's own light source at ice level.
const HOARDINGS = [
  'BATTERY ACID COFFEE', 'BODEGA VU', 'GREASE EXPECTATIONS', 'MEAT YOUR MAKER',
  'IN HOCK WE TRUST', 'OHM SWEET OHM', 'PERCUSSIVE MAINTENANCE', 'CO-PAY & PRAY',
  'NUTS TO THAT', 'SALVAGE RITES', 'BONDED & BOTHERED', 'CHILL OUT LOGISTICS',
  'SHELF LIFE', 'LATHER & LYE', 'PALLETS & PALS', 'SECOND SKIN',
  'CITADEL FINANCIAL', 'HALCYON', 'ADEQUATE!', 'SENTIMENTAL VALUE PAWN',
];
// The board band, just inside the dashers.
const AD_OUT = 1.5, AD_IN = 5.2;
function _adRingSvg() {
  const r = _rng(0xb0a4d5);
  let out = '';
  let n = 0;
  const next = () => HOARDINGS[(n++) % HOARDINGS.length];
  // A panel: the lit field, a brighter bleed along its inside edge (the light spilling
  // onto the ice is most of why a rink at night looks like a rink at night), and the name.
  const panel = (x, y, w, h, label, vertical) => {
    const hue = 1 + ((n * 5) % 4);
    out += `<g class="gdr-ad ad${hue}">` +
      `<rect class="gdr-ad-field" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"/>`;
    // EVERY NAME IS FORCED TO FIT ITS PANEL. `textLength` with `spacingAndGlyphs` squeezes
    // or stretches the whole string to an exact width, which is both the only way a board
    // can carry "PERCUSSIVE MAINTENANCE" and "ADEQUATE!" without one overflowing and the
    // other looking lost — and is genuinely what an LED board does with a long name.
    // Without it the long names ran straight off their panels and out onto the ice.
    if (vertical) {
      // Rotated text on a sheet that is FORESHORTENED needs the squash undone along its
      // advance direction, or the letters bunch into each other. After `rotate(-90)` the
      // advance runs along the sheet's compressed axis, so it is pre-stretched by 1/0.62
      // — and the glyph height, which now runs across the sheet, is left alone. The fit
      // length has to be given in that same pre-stretched space, hence the × TILT.
      const cx = x + w / 2, cy = y + h / 2;
      const fit = (h - 1.6) * SHEET_TILT;
      out += `<text class="gdr-ad-text" textLength="${fit.toFixed(2)}" lengthAdjust="spacingAndGlyphs"` +
        ` transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) rotate(-90) scale(${(1 / SHEET_TILT).toFixed(3)},1)">${_esc(label)}</text>`;
    } else {
      out += `<text class="gdr-ad-text" textLength="${(w - 1.4).toFixed(2)}" lengthAdjust="spacingAndGlyphs"` +
        ` x="${(x + w / 2).toFixed(2)}" y="${(y + h * 0.68).toFixed(2)}">${_esc(label)}</text>`;
    }
    out += `</g>`;
  };
  // The two ends, read face-on.
  const endW = (SHEET_W - 2 * (AD_IN + 3)) / 3;
  for (let i = 0; i < 3; i++) {
    const x = AD_IN + 3 + i * endW;
    panel(x, AD_OUT, endW - 0.6, AD_IN - AD_OUT, next(), false);
    panel(x, SHEET_L - AD_IN, endW - 0.6, AD_IN - AD_OUT, next(), false);
  }
  // The two sides, which is most of what a viewer actually sees.
  const sideH = (SHEET_L - 2 * (AD_IN + 10)) / 5;
  for (let i = 0; i < 5; i++) {
    const y = AD_IN + 10 + i * sideH;
    panel(AD_OUT, y, AD_IN - AD_OUT, sideH - 1.2, next(), true);
    panel(SHEET_W - AD_IN, y, AD_IN - AD_OUT, sideH - 1.2, next(), true);
  }
  void r;
  return `<g class="gdr-ads" aria-hidden="true">${out}</g>`;
}

// Static rink markings, drawn at the sheet's real proportions. Pure — built once per
// beat and never touched again, so all the per-frame work is transform-only.
function _rinkSvg() {
  const [glL, glR] = GEO.goalLine, [blL, blR] = GEO.blue;
  const R_CIRCLE = 15;   // 15ft radius on an 85ft sheet — the real one
  const dots = Object.entries(DOTS).map(([id, [x, y]]) => {
    const cx = _sx(y).toFixed(2), cy = _sy(x).toFixed(2);
    const zone = /Z/.test(id);
    const ring = (id === 'C' || zone) ? `<circle class="gdr-dot-ring" cx="${cx}" cy="${cy}" r="${R_CIRCLE}"/>` : '';
    // The four hash marks outside each end-zone circle. Nobody could name them, but a
    // faceoff circle without them reads as a plain ring and a rink drawn out of memory.
    let hash = '';
    if (zone) {
      for (const sx2 of [-1, 1]) for (const sy2 of [-1, 1]) {
        const hx = +cx + sx2 * 3.2, hy = +cy + sy2 * (R_CIRCLE + 1.1);
        hash += `<line class="gdr-hash" x1="${hx.toFixed(2)}" y1="${hy.toFixed(2)}" x2="${hx.toFixed(2)}" y2="${(hy - sy2 * 1.8).toFixed(2)}"/>`;
      }
    }
    return `<g class="gdr-dot ${id === 'C' ? 'centre' : zone ? 'zone' : 'neutral'}" data-dot="${id}">` +
      ring + hash + `<circle class="gdr-dot-spot" cx="${cx}" cy="${cy}" r="${id === 'C' ? 1.1 : 0.85}"/></g>`;
  }).join('');
  // Centre ice. Every barn paints its own mark there, and the CPhL's is a disc with one
  // line struck through it — the same drawing as the corner bug, faint enough under the
  // play that it never competes with a man standing on it.
  const centreMark = (() => {
    const cx = SHEET_W / 2, cy = _sy(GEO.centre), r = 7.5;
    return `<g class="gdr-centre-mark">` +
      `<circle cx="${cx}" cy="${cy}" r="${r}"/>` +
      `<line x1="${(cx - r * 0.8).toFixed(2)}" y1="${(cy + r * 0.48).toFixed(2)}" x2="${(cx + r * 0.8).toFixed(2)}" y2="${(cy - r * 0.48).toFixed(2)}"/>` +
    `</g>`;
  })();
  // Scuffed ice. A sheet in the second period is not a clean white rectangle, and a
  // faint scatter of blade marks is the cheapest thing that says the game has been
  // going on a while. Fixed positions — the ice does not reshuffle itself per beat.
  const scuffs = (() => {
    const r = _rng(0x5ca77ed), out = [];
    for (let i = 0; i < 46; i++) {
      const x = 6 + r() * (SHEET_W - 12), y = 10 + r() * (SHEET_L - 20);
      const len = 1.6 + r() * 4, ang = (r() - 0.5) * 2.6;
      out.push(`<line class="gdr-scuff" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(ang) * len).toFixed(1)}" y2="${(y + Math.sin(ang) * len).toFixed(1)}"/>`);
    }
    return out.join('');
  })();
  // The crease is a half-disc opening onto the ice, so it's mirrored per end.
  const crease = (side) => {
    const gy = _sy(side < 0 ? glL : glR), r = GEO.creaseR * SHEET_L * 0.5;
    const cx = SHEET_W / 2, half = r * 0.92, d = side < 0 ? 1 : -1;
    return `<path class="gdr-crease" d="M${(cx - half).toFixed(2)} ${gy.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${side < 0 ? 0 : 1} ${(cx + half).toFixed(2)} ${gy.toFixed(2)} Z" data-open="${d}"/>`;
  };
  const across = (cls, x, inset = 0) =>
    `<line class="gdr-line ${cls}" x1="${inset}" y1="${_sy(x).toFixed(2)}" x2="${(SHEET_W - inset).toFixed(2)}" y2="${_sy(x).toFixed(2)}"/>`;
  return (
    `<svg class="gdr-ice" viewBox="0 0 ${SHEET_W} ${SHEET_L}" preserveAspectRatio="none" aria-hidden="true">` +
      // Arena light falls off toward the ends. A flat white rectangle is the tell that
      // a rink was drawn rather than lit.
      `<defs><linearGradient id="gdrIceGrad" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#dce9f4"/><stop offset="0.32" stop-color="#f3f9fd"/>` +
        `<stop offset="0.68" stop-color="#f3f9fd"/><stop offset="1" stop-color="#dce9f4"/>` +
      `</linearGradient></defs>` +
      `<rect class="gdr-ice-bed" x="0" y="0" width="${SHEET_W}" height="${SHEET_L}" rx="14"/>` +
      // the two attacking zones, a shade colder than the neutral zone
      `<rect class="gdr-zone-att" x="0" y="0" width="${SHEET_W}" height="${_sy(blL).toFixed(2)}"/>` +
      `<rect class="gdr-zone-att" x="0" y="${_sy(blR).toFixed(2)}" width="${SHEET_W}" height="${(SHEET_L - _sy(blR)).toFixed(2)}"/>` +
      scuffs +
      centreMark +
      crease(-1) + crease(1) +
      across('goal', glL, 6) + across('goal', glR, 6) +
      across('blue', blL) + across('blue', blR) +
      across('red', GEO.centre) +
      dots +
      _netSvg(-1) + _netSvg(1) +
      // The dasher boards, then the kickplate inside them. Two rings rather than one
      // because the boards are a THING with a thickness, and the white face of them is
      // most of what separates the ice from the building behind it.
      // The dasher band, and the hoardings lit inside it. The band had to get wider to
      // hold them — it was 1.1 units of white, which is a line, not a set of boards.
      _adRingSvg() +
      `<rect class="gdr-kick" x="${AD_IN.toFixed(2)}" y="${AD_IN.toFixed(2)}" width="${(SHEET_W - AD_IN * 2).toFixed(2)}" height="${(SHEET_L - AD_IN * 2).toFixed(2)}" rx="11"/>` +
      `<rect class="gdr-boards" x="0.7" y="0.7" width="${(SHEET_W - 1.4).toFixed(2)}" height="${(SHEET_L - 1.4).toFixed(2)}" rx="14"/>` +
    `</svg>`
  );
}

// ── save selection ──────────────────────────────────────────────────────────────
// The sim's chance kind IS the save. This table is the whole mapping, kept in one place
// so a new chance outcome in hockey.js is one line here and not a hunt through the
// animation code.
//   cls      goalie animation class
//   stop     where the puck ends up, as a fraction of the way from the goal line back
//            toward the shooter (0 = on the line, 1 = well out) — negative is INSIDE
//   label    the neutral label (the announcer's line is separate)
const SAVE = {
  save:      { cls: 'chest',  stop: 0.10, label: 'Save' },
  glove:     { cls: 'glove',  stop: 0.06, label: 'Glove Save' },
  pad:       { cls: 'pad',    stop: 0.08, label: 'Pad Save' },
  blocked:   { cls: 'ready',  stop: 0.55, label: 'Blocked' },
  wide:      { cls: 'track',  stop: 0.02, label: 'Wide' },
  post:      { cls: 'beat',   stop: 0.03, label: 'Off the Post' },
  breakaway: { cls: 'poke',   stop: 0.12, label: 'Breakaway Stopped' },
  goal:      { cls: 'beaten', stop: -1,   label: 'GOAL' },
};

export function createRinkView(host) {
  let timers = [];
  let rink = null;              // the clipping viewport
  let cam = null;               // the sliding surface the sheet and tokens live on
  let sheet = null;             // the ice itself — tokens are positioned against THIS
  let caption = '';
  let pendingCaption = null;
  let pendingCard = null;
  let playAnimating = false;
  let cardTimer = null;
  let last = null;              // last payload, for the shell's header/strip

  // ── the live state ────────────────────────────────────────────────────────────
  // Everything the rAF loop integrates. `men` is ten skaters; `puck` is the disc; the
  // camera is a single scalar because it only ever tracks along the sheet.
  let raf = 0;
  let lastFrame = 0;
  let men = [];
  let goalies = [];
  let puckState = { x: 0.5, y: 0.5, hx: 0, hy: 0 };
  let camY = 0.5;               // where along the sheet the camera is centred
  let attackDir = 1;            // +1 = the side with the puck is attacking the home end
  let carrier = null;           // { side, i } or null — whoever is carrying
  let flow = null;              // the puck's current segment
  let flowRng = _rng(1);
  let puckTrailAt = 0;
  // Ten men digging in at once is ten shaved-ice noises on the same frame, which is a
  // hiss and not a hockey rink. One in three, and only the hard stops.
  let sprayLoud = 0;
  // Who currently owns the chase/press job on each side, so it can be held rather than
  // recomputed from scratch every frame. See the stickiness note in `_assignJobs`.
  const jobHolder = { a: null, h: null };
  let clockOff = 0;             // ms, for the per-man wander phases

  function _stop() {
    timers.forEach(clearTimeout); timers = [];
    playAnimating = false; pendingCard = null;
  }
  function _t(ms, fn) { timers.push(setTimeout(fn, Math.max(0, ms))); }
  function _stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  // ── sound ─────────────────────────────────────────────────────────────────────
  // The CPhL soundset (client/shared/hockey-sfx.js) is procedural and preset-addressed,
  // so the rink names the EVENT and the soundset owns what it sounds like. Silent by
  // design if the file or AudioEngine isn't there — the view must never depend on audio
  // to be readable, because most of the audience is reading text.
  const SFX = {
    shot: 'hk-puck-slap', chest: 'hk-check', pad: 'hk-pad-save', glove: 'hk-glove-save',
    post: 'hk-post', wide: 'hk-glass', block: 'hk-stick-hit', poke: 'hk-stick-hit',
    boards: 'hk-puck-tick', glass: 'hk-glass', stop: 'hk-skate-stop',
    net: 'hk-net', horn: 'hk-goal-horn', periodHorn: 'hk-period-horn',
    drop: 'hk-puck-tick', sweep: 'hk-skate-scrape', whistle: 'hk-whistle',
    punch: 'hk-punch', punchMiss: 'hk-punch-miss', gloves: 'hk-gloves-drop',
    roar: 'hk-crowd-roar', gasp: 'hk-crowd-gasp', groan: 'hk-crowd-groan',
  };
  // Resolve through the CATALOG, not the bank, so a preset retuned in the dev panel
  // (or overridden in `interface_sfx`) is what actually plays — then hand it to the
  // bank's `variant()` so repeated punches and saves still aren't identical takes.
  // Falls back to the bank alone, then to silence; the view never depends on audio.
  function _sfx(key, seed) {
    const id = SFX[key];
    if (!id) return;
    const def = window.SFXCatalog?.get?.(id);
    if (def && window.HockeySfx?.variant && window.AudioEngine?.playSfx) {
      window.AudioEngine.playSfx(window.HockeySfx.variant(def, seed == null ? _hash(key) : seed));
      return;
    }
    if (def && window.AudioEngine?.playSfx) { window.AudioEngine.playSfx(def); return; }
    window.HockeySfx?.play?.(id, seed);
  }
  // Crowd reactions ride slightly behind the event they're reacting to — a crowd that
  // roars on the same frame as the goal sounds like a laugh track.
  function _crowd(key, delay) { _t(delay == null ? 220 : delay, () => _sfx(key)); }

  const q = (sel) => rink && rink.querySelector(sel);
  const puckEl = () => q('.gdr-puck');
  const goalieEl = (side) => q(`.gdr-goalie[data-side="${side}"]`);

  // ── the rAF loop ──────────────────────────────────────────────────────────────
  // The single owner of every token's position. Nothing else writes `left`/`top` on a
  // skater: a CSS transition and an integrator fighting over the same element is how
  // you get men sliding to places nobody sent them.
  function _startLoop() {
    _stopLoop();
    lastFrame = 0;
    raf = requestAnimationFrame(_frame);
  }

  function _frame(now) {
    raf = requestAnimationFrame(_frame);
    if (!sheet || !sheet.isConnected) return;
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    clockOff += dt;

    _advancePuck(now, dt);
    _advanceDebris(now, dt);
    _advanceMen(now, dt);
    _advanceGoalies(dt);
    _advanceCamera(dt);
  }

  // The puck follows whatever segment is current — a beat's keyframe, a shot, or a
  // stretch of idle circulation. `flow` is always populated; the ice is never dead.
  function _advancePuck(now, dt) {
    if (!flow) { _nextIdleFlow(); }
    const f = flow;
    if (f.phys) { _advanceFreePuck(f, now, dt); return; }
    const t = clamp((now - f.t0) / Math.max(1, f.ms), 0, 1);
    const e = f.ease === 'in' ? t * t : f.ease === 'out' ? 1 - (1 - t) * (1 - t) : t * t * (3 - 2 * t);
    const nx = f.x0 + (f.x1 - f.x0) * e;
    const ny = f.y0 + (f.y1 - f.y0) * e;
    puckState.hx = nx - puckState.x; puckState.hy = ny - puckState.y;
    puckState.x = nx; puckState.y = ny;
    _writeToken(puckEl(), nx, ny); _depth(puckZ, nx, 4);
    // A trail behind a fast puck. Not decoration: a six-pixel disc crossing a zone in
    // half a second is genuinely hard to follow, and a short streak is what lets the
    // eye pick up where it came FROM and therefore where it is going. Throttled off
    // the clock rather than the frame rate so it looks the same on a slow machine.
    const sp = Math.hypot(puckState.hx * SHEET_L, puckState.hy * SHEET_W);
    if (sp > 0.55 && now - puckTrailAt > 26) { puckTrailAt = now; _spawn('gdr-ptrail', nx, ny, 260); }
    if (t >= 1) {
      if (f.onEnd) { const fn = f.onEnd; f.onEnd = null; fn(); }
      // A beat's chain schedules its own next segment; only the idle flow refills
      // itself, which is what stops idle motion from stepping on a live play.
      if (flow === f && f.idle) _nextIdleFlow();
      else if (flow === f && f.thenIdle) _nextIdleFlow();
    }
  }

  // ONE INTEGRATOR, EVERY LOOSE THING. A puck sliding on ice and a severed arm sliding
  // on ice are the same problem — a body with a velocity, friction under it and boards
  // around it — and writing that twice would have been two things to keep in agreement
  // for no gain. `o` is anything with {x, y, vx, vy}; it comes back moved, and the
  // return value is the speed it hit a wall at, or 0.
  //
  // Friction is a per-SECOND decay rather than a per-frame one, so the puck slows the
  // same on a 144Hz monitor as on a 30fps tablet.
  function _stepFree(o, dt, friction) {
    const s = dt / 1000;
    const decay = Math.pow(friction == null ? PUCK_FRICTION : friction, s);
    o.vx *= decay; o.vy *= decay;
    let nx = o.x + (o.vx * s) / SHEET_L;
    let ny = o.y + (o.vy * s) / SHEET_W;
    const B = PUCK_BOUNDS;
    // Reflect rather than clamp. A clamped body slides ALONG the wall it hit, which
    // reads as a puck stuck to the glass; a reflected one comes back out into the play,
    // and the rebound off the end boards is a thing hockey is largely made of.
    let hit = 0;
    if (ny < B.y0) { ny = B.y0 + (B.y0 - ny); o.vy = -o.vy * BOARD_BOUNCE; hit = 1; }
    else if (ny > B.y1) { ny = B.y1 - (ny - B.y1); o.vy = -o.vy * BOARD_BOUNCE; hit = 1; }
    if (nx < B.x0) { nx = B.x0 + (B.x0 - nx); o.vx = -o.vx * BOARD_BOUNCE; hit = 1; }
    else if (nx > B.x1) { nx = B.x1 - (nx - B.x1); o.vx = -o.vx * BOARD_BOUNCE; hit = 1; }
    o.x = nx; o.y = ny;
    return hit ? Math.hypot(o.vx, o.vy) : 0;
  }

  function _advanceFreePuck(f, now, dt) {
    const px = puckState.x, py = puckState.y;
    f.x = px; f.y = py;
    const wall = _stepFree(f, dt);
    if (wall) _boardRattle(now, f.x, f.y, wall);
    _puckHitsDebris(f, now);
    _puckHitsMen(f, now);
    const nx = f.x, ny = f.y;
    puckState.hx = nx - px; puckState.hy = ny - py;
    puckState.x = nx; puckState.y = ny;
    _writeToken(puckEl(), nx, ny); _depth(puckZ, nx, 4);
    const sp = Math.hypot(puckState.hx * SHEET_L, puckState.hy * SHEET_W);
    if (sp > 0.55 && now - puckTrailAt > 26) { puckTrailAt = now; _spawn('gdr-ptrail', nx, ny, 260); }
    // It has stopped. Idle circulation picks it up from exactly where it died, which is
    // what makes a rebound that dribbles into the corner turn into a retrieval.
    if (Math.hypot(f.vx, f.vy) < PUCK_DEAD) {
      if (f.onEnd) { const fn = f.onEnd; f.onEnd = null; fn(); }
      if (flow === f) _nextIdleFlow();
    }
  }

  // ── debris ────────────────────────────────────────────────────────────────────
  // What comes off a man goes into the SAME integrator the puck is in, because an arm
  // on ice is a loose body on ice and there is no second physics for it. It slides, it
  // caroms off the dashers, it spins down as it slows, and it stays where it ends up.
  //
  // A LIMB IS AN OBSTACLE. It is on the ice, so the puck can hit it — which is the one
  // thing that makes the debris part of the game rather than a decal drawn near it, and
  // it is also the funniest thing in the CPhL. It changes NOTHING: by the time anything
  // is on the ice the sim has already banked the outcome, and only cosmetic idle
  // circulation is ever running when a carom off a leg can happen.
  const DEBRIS_FRICTION = 0.14;  // meat does not glide like vulcanised rubber
  const DEBRIS_R = 0.020;        // its radius across the sheet, in model units
  let debris = [];

  function _advanceDebris(now, dt) {
    if (!debris.length) return;
    for (const d of debris) {
      if (d.dead) continue;
      const wall = _stepFree(d, dt, DEBRIS_FRICTION);
      if (wall > 6) _boardRattle(now, d.x, d.y, wall);
      // It spins down with it — a part that stops sliding but keeps rotating is a
      // sprite on a timer, and the eye catches that immediately.
      d.rot += d.spin * (dt / 1000);
      d.spin *= Math.pow(0.22, dt / 1000);
      if (d.el) {
        d.el.style.left = _px(d.y); d.el.style.top = _py(d.x);
        d.el.style.rotate = `${d.rot.toFixed(1)}deg`;
        _depth(d, d.x);
      }
      // It leaves a trail. A limb skidding across a white sheet and arriving somewhere
      // clean is the tell that it teleported; the smear is the evidence of the path, and
      // it is what makes a viewer's eye run BACK along it to the man it came off.
      const sp = Math.hypot(d.vx, d.vy);
      if (sp > 5 && now - (d.smearAt || 0) > 55) { d.smearAt = now; _spawn('gdr-smear', d.x, d.y, 8000); }
    }
  }

  // The puck finds a leg. A circle test against each part, resolved as an elastic-ish
  // bounce that pushes BOTH of them — the puck goes off at an angle and the limb is
  // knocked on, which is what sells it as a collision rather than a bounce off a wall
  // that happens to be limb-shaped.
  function _puckHitsDebris(f, now) {
    if (!debris.length) return;
    for (const d of debris) {
      if (d.dead) continue;
      const dx = (f.x - d.x) * SHEET_L, dy = (f.y - d.y) * SHEET_W;
      const dist = Math.hypot(dx, dy);
      const r = DEBRIS_R * SHEET_W;
      if (dist > r || dist < 0.001) continue;
      const nxn = dx / dist, nyn = dy / dist;
      const into = f.vx * nxn + f.vy * nyn;
      if (into > 0) continue;                     // already leaving it
      f.vx -= 2 * into * nxn * 0.7; f.vy -= 2 * into * nyn * 0.7;
      d.vx += into * nxn * 0.5; d.vy += into * nyn * 0.5;
      // Push it clear, or a slow puck sits inside the limb re-colliding every frame.
      f.x = d.x + (nxn * r * 1.02) / SHEET_L;
      f.y = d.y + (nyn * r * 1.02) / SHEET_W;
      if (now - boardRattleAt > 140) { boardRattleAt = now; _sfx('boards'); }
      return;
    }
  }

  // A LOOSE PUCK FINDS FEET. Ten men are standing in the middle of the physics and the
  // puck was passing straight through all of them, which is the single most obvious way
  // to see that a picture is two layers rather than one place. So a free puck bounces
  // off a skater the way it bounces off anything else — off his SKATES, which is why
  // the radius is small: a puck ticking off a man's feet in traffic is right, and a puck
  // bouncing off a six-foot bubble around him is a pinball table.
  //
  // Only ever a FREE puck. A carried, passed or shot puck is on somebody's stick and is
  // the sim's own keyframe — deflecting that would be the view overruling a fact.
  const MAN_R = 0.013;
  function _puckHitsMen(f, now) {
    for (const m of men) {
      if (m.pin) continue;                          // down, fighting, or dead — see below
      const dx = (f.x - m.x) * SHEET_L, dy = (f.y - m.y) * SHEET_W;
      const dist = Math.hypot(dx, dy);
      const r = MAN_R * SHEET_W;
      if (dist > r || dist < 0.001) continue;
      const nxn = dx / dist, nyn = dy / dist;
      const into = f.vx * nxn + f.vy * nyn;
      if (into > 0) continue;
      // Skates and shin pads deaden it. A puck off a man is slower than a puck off the
      // glass, and that difference is most of what makes traffic look like traffic.
      f.vx -= 2 * into * nxn * 0.55; f.vy -= 2 * into * nyn * 0.55;
      f.x = m.x + (nxn * r * 1.03) / SHEET_L;
      f.y = m.y + (nyn * r * 1.03) / SHEET_W;
      if (-into > 14 && now - boardRattleAt > 150) { boardRattleAt = now; _sfx('block'); _spawn('gdr-snow', f.x, f.y, 340); }
      return;
    }
  }

  // Hand the puck a velocity and let go of it. `dirX`/`dirY` are model-frame directions
  // (they need not be normalised); `speed` is feet per second.
  function _kickPuck(dirX, dirY, speed, opts) {
    const mag = Math.hypot(dirX * SHEET_L, dirY * SHEET_W) || 1;
    flow = {
      phys: true, t0: performance.now(),
      vx: (dirX * SHEET_L / mag) * speed,
      vy: (dirY * SHEET_W / mag) * speed,
      onEnd: (opts && opts.onEnd) || null,
    };
    return flow;
  }

  // The dashers take one. Throttled, because a puck rattling around a corner can clip
  // two walls in three frames and three overlapping bangs is a drum, not a rink.
  let boardRattleAt = 0;
  function _boardRattle(now, x, y, speed) {
    if (now - boardRattleAt < 140 || speed < 8) return;
    boardRattleAt = now;
    _sfx(speed > 45 ? 'glass' : 'boards');
    _spawn('gdr-ptrail', x, y, 220);
  }

  // Where one man wants to be, given where the puck is. The single source of the
  // formation — the per-frame integrator eases toward it, and a beat's opening CUT
  // snaps to it, so a play never begins with ten men sprinting in from the last one.
  function _targetFor(m, px, py, has, isCarrier, wander) {
    const role = m.role, d = m.dir;
    let tx, ty;
    if (m.pin) {
      // Held: locked up in a fight, pinned on the boards, or lying where he fell.
      // Nothing about the puck moves him until whatever is holding him lets go.
      [tx, ty] = m.pin;
    } else if (isCarrier) {
      // THE PUCK GOES ON HIS BLADE, NOT UNDER HIS FEET. This used to put the man's own
      // position on the puck — and since a standing figure is anchored at his SKATES,
      // that drew every carrier in the league dribbling it with his boots. He is offset
      // by his own stick reach instead, to whichever side he is currently facing, so the
      // puck sits at the end of the blade the rig already draws.
      //
      // `BLADE_REACH` is measured off the artwork rather than picked: the blade sits
      // about 0.43 of the way out from his spine in a viewBox that is `.gdr-skater` wide,
      // which lands at ~3½ feet of stick — and it has to be derived that way, or the
      // puck drifts off the stick the moment anybody resizes the figure.
      // The BLEND, not the sign: mid-switch he stands square over the puck with the
      // blade at his centre, which is what makes pulling it across his body a move you
      // can watch rather than a frame where it teleports past his boots.
      tx = px - d * 0.008;
      ty = clamp01(py + m.faceBlend * BLADE_REACH);
    } else if (m.mode === 'chase') {
      // A LOOSE PUCK IS A RACE. Nobody carries it, so the nearest man from each side
      // goes and GETS it — with a lead, because you skate to where a sliding puck is
      // going and not to where it is. This is the single biggest reason the ice used to
      // look like a formation drill: the puck would squirt into a corner and ten men
      // would slide two feet sideways and carry on holding their lanes.
      tx = clamp01(px + puckState.hx * 9);
      ty = clamp01(py + puckState.hy * 9);
    } else if (m.mode === 'support') {
      // His side has it and he is close: he is an OUTLET. He works to a passing
      // position off the carrier — up his own side of the ice and out toward his lane —
      // rather than holding a fixed depth, which is what makes two men look like they
      // are playing with each other instead of near each other.
      tx = px + d * (0.030 + m.rank * 0.026);
      ty = py + (role.lane - 0.5) * 0.62;
    } else if (m.mode === 'press') {
      // The other side has it and he is nearest: he FORECHECKS. He takes the angle —
      // a step to the defensive side of the puck, so he is between it and his own net
      // rather than trailing it, which is the difference between pressure and a chase.
      tx = px - d * 0.018;
      ty = py + (role.lane - 0.5) * 0.30;
    } else {
      // HE PLAYS HIS OWN AREA. Every off-puck man used to target the identical
      // puck-relative offset, so the whole five-man unit translated as one rigid body:
      // the puck moved a foot and ten men moved a foot, in perfect lockstep, which is the
      // single most artificial thing a crowd of tokens can do. Three things break that up
      // and none of them is randomness for its own sake.
      //
      // ONE — HIS OWN PATCH. Each man carries a small seeded bias on his depth and his
      // lane, so the unit is not a lattice and two men in the same role never stand at
      // mirrored coordinates.
      tx = px + d * (has ? role.withPuck : role.without) + m.biasX;
      // TWO — HIS INTEREST FALLS OFF WITH DISTANCE. A winger three zones from the puck
      // does not slide across the ice because it moved in the far corner; he holds his
      // lane and lets it come to him. Close to the play he shades over hard. This is what
      // turns one sliding formation into five men each minding their own area.
      const away = Math.abs(px - m.x);
      const interest = 1 / (1 + away * 7);
      ty = role.lane + m.biasY + (py - 0.5) * role.grip * interest;
      // THREE — he drifts inside it, on his own clock. Bigger and slower than the old
      // shared wander, and scaled per man, so a stretch of quiet ice reads as five people
      // patrolling rather than five sprites vibrating in sympathy.
      if (wander) {
        tx += Math.sin((clockOff + m.phase) / (1900 * m.wanderRate)) * 0.020 * m.wanderAmp;
        ty += Math.cos((clockOff + m.phase * 1.7) / (1500 * m.wanderRate)) * 0.034 * m.wanderAmp;
      }
      return [clamp(tx, 0.105, 0.895), clamp(ty, 0.06, 0.94)];
    }
    // Inside the boards — and NEVER into the paint. The carrier tracks the puck, and
    // the puck's last keyframe on a goal is inside the cage, so without this floor a
    // shooter skated through his own shot and stood in the net holding it. A skater
    // may crash the crease; he may not be behind the goal line in the goalmouth.
    return [clamp(tx, 0.105, 0.895), clamp(ty, 0.06, 0.94)];
  }

  // The cut. A broadcast doesn't dolly from the last play to this one, and neither does
  // this: at the top of a beat every man is PLACED in the formation the opening keyframe
  // implies, facing the right way. Without it a beat opened with the whole rink sprinting
  // in from wherever the previous beat left them, and the first second of every play was
  // spent watching ten men run to their marks.
  function _snapFormation(px, py) {
    for (const m of men) {
      const has = carrier && carrier.side === m.side;
      const isCarrier = has && carrier.i === m.i;
      const [tx, ty] = _targetFor(m, px, py, has, isCarrier, false);
      m.x = tx; m.y = ty; m.speed = 0; m.lean = 0;
      m.head = m.dir > 0 ? Math.PI : 0;
      // He faces the way he attacks from the very first frame of the cut. A CUT is the
      // one place facing is allowed to be instantaneous — it's a different camera shot,
      // not a man turning — so the blend is slammed to match rather than eased.
      m.showBack = m.dir < 0;
      m.faceBlend = m.faceWant = m.face;
      if (m.crossing) { m.crossing = false; m.el?.classList.remove('crossing'); }
      _writeSkater(m);
    }
  }

  // Formation. Every man targets a point derived from the puck and his role, so the
  // whole team shifts as one when the puck moves — which is the thing that reads as
  // hockey rather than ten independent wanderers.
  // WHO REACTS TO THE PUCK, decided fresh every frame. Each side's men are ranked by
  // their real distance to it, and the top one or two are given a job — chase it, support
  // the man who has it, or forecheck the man who has it. Everyone else holds the
  // formation as before, which is what keeps the picture a hockey team rather than ten
  // men all converging on the same square foot of ice.
  //
  // The ranking is by SHEET distance, not model distance, so the narrow axis isn't
  // treated as though it were as long as the rink.
  function _assignJobs() {
    for (const side of ['a', 'h']) {
      const list = [];
      for (const m of men) {
        if (m.side !== side) continue;
        m.mode = null; m.rank = 99;
        if (m.pin) continue;      // down, fighting, dead — he reacts to nothing
        list.push(m);
        m.dist = Math.hypot((m.x - puckState.x) * SHEET_L, (m.y - puckState.y) * SHEET_W);
      }
      list.sort((a, b) => a.dist - b.dist);
      // STICKY. Two men within a hair of each other swap rank 0 several times a second,
      // and since a chaser and a lane-holder want completely different places to be,
      // that churn threw both of them back and forth every frame — one of the three
      // sources of the shaking. The incumbent keeps the job unless somebody is
      // meaningfully closer, so ties resolve to whoever had it.
      const prev = jobHolder[side];
      if (prev && !prev.pin && list.length > 1 && list[0] !== prev) {
        const inc = list.indexOf(prev);
        if (inc > 0 && list[inc].dist < list[0].dist * 1.25) {
          list.splice(inc, 1); list.unshift(prev);
        }
      }
      jobHolder[side] = list[0] || null;
      const hasIt = carrier && carrier.side === side;
      list.forEach((m, i) => {
        m.rank = i;
        const isCarrier = hasIt && carrier.i === m.i;
        if (isCarrier) return;                       // he IS the puck; handled elsewhere
        if (!carrier) { if (i === 0) m.mode = 'chase'; return; }
        if (hasIt) { if (i <= 1) m.mode = 'support'; return; }
        if (i === 0) m.mode = 'press';
      });
    }
  }

  function _advanceMen(now, dt) {
    const px = puckState.x, py = puckState.y;
    _assignJobs();
    for (const m of men) {
      const role = ROLES[m.i];
      const d = m.dir;                                  // his own attacking direction
      const has = carrier && carrier.side === m.side;   // his side has the puck
      const isCarrier = carrier && carrier.side === m.side && carrier.i === m.i;

      const [tx, ty] = _targetFor(m, px, py, has, isCarrier, true);
      // A man with a JOB skates harder than a man holding a lane, and a man racing for a
      // loose puck skates hardest of all. This is where "they move with the puck" is
      // actually felt: without it the chaser has the right destination and still ambles
      // toward it at positional speed.
      // Per-man reaction, so the ten of them never arrive together. A shared time
      // constant makes a formation move like one object no matter how much its targets
      // differ; jobs are the exception, because a man who has been SENT somewhere is
      // supposed to go there at the pace the job demands.
      const tau = isCarrier ? TAU_CARRIER
        : m.mode === 'chase' ? TAU_CHASE
        : (m.mode === 'press' || m.mode === 'support') ? TAU_WORKING
        : TAU_SKATER * m.react;
      const k = 1 - Math.exp(-dt / tau);
      const nx = m.x + (tx - m.x) * k, ny = m.y + (ty - m.y) * k;
      const vx = nx - m.x, vy = ny - m.y;
      m.x = nx; m.y = ny;
      // Heading, low-passed — a man who snaps to face every jitter looks like a compass
      // needle. Below a threshold he keeps the heading he had rather than spinning.
      //
      // The figure is drawn facing UP, so 0 is up and the angle is taken in SCREEN
      // deltas: across the sheet is negated (model y runs the other way once the
      // picture stands up) and each axis is weighted by the sheet's real proportions,
      // or a man crossing the narrow axis appears to turn twice as far as he did.
      const sp = Math.hypot(vx, vy);
      // Screen deltas, which is the frame facing is decided in: across the sheet is
      // negated (model y runs the other way once the picture stands up) and along it is
      // foreshortened by the tilt, so a man drifting sideways on a squashed sheet isn't
      // judged to be skating up-ice.
      const sdx = -vy * SHEET_W, sdy = vx * SHEET_L * SHEET_TILT;
      // FACING IS DECIDED ON A SMOOTHED SIGNAL, NOT AN INSTANTANEOUS ONE, and that turned
      // out to be the whole fix. Hysteresis on the raw per-frame velocity was not enough:
      // every man carries a slow cosine WANDER so the ice looks occupied between beats,
      // and that wander's own peak lateral speed is several times any threshold worth
      // setting. A man standing still was therefore being told he had changed direction
      // once a second, and turned around — the violent shaking, with no actual movement
      // behind it. Low-passing over ~400ms averages the wander away to nothing while
      // leaving a real change of direction completely intact; the hysteresis on top then
      // only has to reject what's left.
      // The filter and the threshold are SET AGAINST THE WANDER, deliberately. The
      // wander is a cosine of ~1180ms period and 0.022 amplitude, whose peak lateral
      // speed lands around 0.16 in these units — so a 400ms filter only attenuated it to
      // ~0.07 and a 0.055 threshold still let it through, which is why men kept turning
      // around while standing still. A 700ms filter puts the wander's residue near 0.04
      // and the bar at 0.15, comfortably above it; a man genuinely crossing the sheet
      // reads several times that, so real turns are untouched.
      const kf = Math.min(1, dt / 700);
      m.sdx += (sdx - m.sdx) * kf;
      m.sdy += (sdy - m.sdy) * kf;
      // TURNING AROUND IS A MOVE, NOT A SIGN CHANGE. `faceWant` is the discrete answer
      // and `faceBlend` is the continuous one that eases toward it, and everything reads
      // the blend. That one indirection buys both of the things that were wrong here:
      //
      //   · A CARRIER CAN SWITCH STICK SIDE AGAIN. He couldn't, because an instantaneous
      //     mirror teleported his blade to his other hip and dragged the puck through his
      //     skates on the way. Easing the blend means his lateral offset travels from one
      //     side to the other over ~200ms — he PULLS THE PUCK ACROSS HIS BODY, which is
      //     the move a real player makes, and the mirror itself flips at the midpoint,
      //     exactly when the puck is in front of him and the blade is at his centre.
      //   · Nobody snaps. Even an off-puck man rotates through the turn now.
      //
      // A carrier needs a decisively bigger signal to commit, because switching hands is
      // a deliberate act and a winger drifting is not.
      // EIGHT HEADINGS OUT OF ONE DRAWING. Mirroring alone gives a man exactly two looks —
      // facing left and facing right — so a whole team drifting up the ice was a row of
      // profiles, and "coming at the camera" was indistinguishable from "crossing in front
      // of it". A sprite set solves this with five drawings; the same read comes out of one
      // by FORESHORTENING it.
      //
      // Screen heading θ is measured from straight-away: 0 is up the ice, π is at the
      // camera, ±π/2 is square across. |cos θ| is then how square-on he is, and it drives
      // his apparent WIDTH — a man facing you shows his whole chest, a man in profile
      // shows a shoulder. Together with the mirror (which way) and the front/back swap
      // (toward or away) that is eight legible headings, continuously.
      const yaw = Math.atan2(m.sdx, -m.sdy);
      const squareOn = 0.52 + 0.48 * Math.abs(Math.cos(yaw));
      // Quantised, or this is a style write per man per frame for a value nobody can see
      // change at that resolution.
      const tb = Math.round(squareOn * 20);
      if (tb !== m.turnBand) { m.turnBand = tb; m.el.style.setProperty('--gdr-turn', (tb / 20).toFixed(2)); }
      // HOW MUCH OF HIS FRONT YOU CAN SEE, continuously: 0 skating straight away, 1
      // coming straight at the camera, and everything between. The cage, the crest and
      // the back number cross-fade on this rather than snapping on a class, which is what
      // makes a man turning through profile a man TURNING rather than a man who suddenly
      // became a different sprite. Straight down the ice at the camera is `front = 1` —
      // full mask, full crest, no number — which is the frame that has to read hardest.
      //
      // Ramped rather than linear so the exchange happens across the middle of the turn
      // instead of dragging a half-visible number all the way round.
      const front = clamp01((((1 - Math.cos(yaw)) / 2) - 0.30) / 0.40);
      const fb = Math.round(front * 20);
      if (fb !== m.frontBand) { m.frontBand = fb; m.el.style.setProperty('--gdr-front', (fb / 20).toFixed(2)); }
      // AND THE STICK SWINGS THROUGH THE SAME ANGLE. This is the cue that was missing:
      // the body mirrors left and right, so a man skating AT the camera and one skating
      // AWAY were the identical drawing with a different badge on it — which is why a
      // whole team travelling up the ice looked like it was skating backwards. The stick
      // reaches out into the world, so it is the part that can point at you: swung low
      // and in front coming at the camera, tucked high and behind going away, straight
      // out to the side in profile.
      const sy = Math.round(-Math.cos(yaw) * 58);
      if (sy !== m.stickBand) { m.stickBand = sy; m.el.style.setProperty('--gdr-stickyaw', `${sy}deg`); }
      // HOW SIDE-ON HE IS — and it is NOT the inverse of the body squash, which is why it
      // needs its own number. A torso is widest facing the camera; a SKATE BLADE is the
      // opposite, longest across the screen in profile and pointing straight at you
      // head-on. Drawn as fixed horizontal lines they pointed right whatever he was
      // doing, so a man skating at the camera stood on two sideways blades.
      const side = Math.round(Math.abs(Math.sin(yaw)) * 20);
      if (side !== m.sideBand) { m.sideBand = side; m.el.style.setProperty('--gdr-side', (side / 20).toFixed(2)); }
      const faceWant = m.sdx < 0 ? -1 : 1;
      if (faceWant !== m.faceWant && Math.abs(m.sdx) > (isCarrier ? 0.34 : 0.15)) m.faceWant = faceWant;
      m.faceBlend += (m.faceWant - m.faceBlend) * Math.min(1, dt / 190);
      m.face = m.faceBlend < 0 ? -1 : 1;
      // HE CROSSES OVER. A skater changing direction at speed doesn't swivel — he steps
      // one skate over the other, and that is the most recognisable thing a hockey player
      // does with his feet. Driven off the lean (which is already the turn rate) with a
      // deliberate gap between the on and off thresholds, or a man hovering at the edge
      // of a turn would flicker between striding and crossing.
      const crossing = m.crossing ? (Math.abs(m.lean) > 3.5 && m.speed > 0.11) : (Math.abs(m.lean) > 7 && m.speed > 0.16);
      if (crossing !== m.crossing) { m.crossing = crossing; m.el?.classList.toggle('crossing', crossing); }
      const wantBack = m.sdy < 0;
      if (wantBack !== m.showBack && Math.abs(m.sdy) > 0.15) m.showBack = wantBack;
      let turn = 0;
      if (sp > 0.00025) {
        const want = Math.atan2(-vy * SHEET_W, -vx * SHEET_L);
        let da = want - m.head;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        turn = da * Math.min(1, dt / 120);
        m.head += turn;
      }
      const wasSpeed = m.speed;
      m.speed += (sp * 1000 - m.speed) * Math.min(1, dt / 200);
      // HE LEANS INTO IT. A skater turning at speed is not an upright figure that has
      // rotated — he is a man on two thin blades who must put his shoulders inside the
      // arc or fall over, and that lean is most of what separates skating from sliding.
      // Proportional to turn rate AND to speed, because a man crossing over at a
      // standstill leans nowhere; low-passed so it builds and releases through the turn
      // rather than snapping on at the first frame of it.
      // Capped much tighter than the old shear was. A standing figure past about 12° off
      // vertical stops reading as leaning and starts reading as falling over.
      const wantLean = clamp(-(turn / Math.max(0.001, dt / 1000)) * 5 * clamp(m.speed / 0.28, 0, 1), -12, 12);
      m.lean += (wantLean - (m.lean || 0)) * Math.min(1, dt / 140);
      // Snow. He sheds it when he digs in — hard on the brakes, or hard around a corner
      // — which are exactly the two moments a top-down figure has no other way to say
      // that anything strenuous just happened.
      const decel = (wasSpeed - m.speed) / Math.max(0.001, dt / 1000);
      const digging = (decel > 0.55 && wasSpeed > 0.18) || (Math.abs(m.lean) > 15 && m.speed > 0.2);
      if (digging && now - (m.sprayAt || 0) > 190) {
        m.sprayAt = now;
        _spawn('gdr-snow', m.x, m.y, 460);
        if (decel > 1.1 && sprayLoud++ % 3 === 0) _sfx('stop');
      }
      _cutIce(m, now);
      _tripOver(m, now);
      _writeSkater(m);
    }
  }

  // ── the ice remembers ─────────────────────────────────────────────────────────
  // THE SHEET IS CONSUMED BY BEING SKATED ON. The rink was authored with a fixed scatter
  // of scuffs, which says "this game has been going a while" exactly once and then says
  // nothing ever again — the same forty-six marks in the same forty-six places while ten
  // men skate over clean ice all night. Every stride now CUTS, along the man's heading,
  // and the cut stays. Over a beat the traffic pattern of the play writes itself into the
  // surface: the lane the rush came up is visibly chewed and the far corner is not.
  //
  // Bounded, FIFO, and static once drawn — a cut is one <line> that is never touched
  // again, so two hundred of them cost one paint and nothing per frame.
  // Tuned DOWN hard once the sheet was foreshortened: the same cadence that read as
  // light scuffing on a full-length plan view scribbled the whole zone solid once the
  // ice was compressed to 0.62 and the visible band held twice as much of it. The play
  // has to stay the brightest thing on the sheet.
  const MAX_CUTS = 90;
  let cuts = [];
  function _cutIce(m, now) {
    if (m.pin || m.speed < 0.16) return;
    // Faster men cut more often, which is what makes a breakaway leave a streak and a
    // man drifting in the neutral zone leave the occasional nick.
    if (now - (m.cutAt || 0) < 640 - clamp(m.speed, 0, 0.5) * 700) return;
    m.cutAt = now;
    const layer = q('.gdr-cuts'); if (!layer) return;
    // Along his heading, in SHEET units — the figure is drawn facing up, so his heading
    // maps back through the same negation the rotation used.
    const len = 1.2 + clamp(m.speed, 0, 0.5) * 5;
    const ux = -Math.cos(m.head), uy = -Math.sin(m.head);
    const x = _sx(m.y), y = _sy(m.x);
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', (x - ux * len * 0.5).toFixed(2));
    ln.setAttribute('y1', (y - uy * len * 0.5).toFixed(2));
    ln.setAttribute('x2', (x + ux * len * 0.5).toFixed(2));
    ln.setAttribute('y2', (y + uy * len * 0.5).toFixed(2));
    ln.setAttribute('class', 'gdr-cut');
    layer.appendChild(ln);
    cuts.push(ln);
    while (cuts.length > MAX_CUTS) cuts.shift().remove();
  }

  // A LIMB ON THE ICE IS A HAZARD. If a severed leg can stop a puck it can certainly
  // stop a man, and a rink where the debris is inert is a rink where the debris is
  // scenery. He goes down, he gets up, and it costs nothing but the picture — no beat,
  // no outcome and no stat has ever come out of a man falling over.
  function _tripOver(m, now) {
    if (m.pin || m.speed < 0.14 || !debris.length) return;
    for (const d of debris) {
      if (d.dead) continue;
      const dx = (m.x - d.x) * SHEET_L, dy = (m.y - d.y) * SHEET_W;
      if (Math.hypot(dx, dy) > DEBRIS_R * SHEET_W * 1.4) continue;
      m.pin = [m.x + (m.x - d.x) * 2.2, m.y + (m.y - d.y) * 2.2];
      m.el?.classList.add('down');
      _spawn('gdr-snow', m.x, m.y, 520);
      _sfx('stop');
      _crowd('gasp', 200);
      // He kicks it on as he goes over it, which is why the same leg doesn't trip the
      // whole team in the same two seconds.
      d.vx += (d.x - m.x) * SHEET_L * 3; d.vy += (d.y - m.y) * SHEET_W * 3;
      _t(1500, () => { if (m.el) { m.pin = null; m.el.classList.remove('down'); } });
      return;
    }
  }

  // The camera. It tracks the puck along the sheet with a lead in the direction of
  // travel — an operator anticipates, and a camera that only ever centres what already
  // happened feels a half-second behind the play the whole night.
  // A camera that leads hard and catches up fast whips, and a whipping camera makes a
  // small black disc genuinely impossible to follow — the puck barely moves against the
  // frame while the whole world slides under it. So the lead is small and the lag is
  // long: the operator anticipates a little and settles slowly, and the puck is allowed
  // to travel WITHIN the frame rather than being pinned to the middle of it.
  // A DEADZONE, not a spring. Easing toward the puck every frame gives you exactly one
  // of two bad cameras: tight enough to keep up and it whips on every pass, loose
  // enough not to whip and a rush outruns it — the puck and half the players leave the
  // frame, which is what was happening. So the camera holds perfectly still while the
  // puck is anywhere in the middle of the picture, and only follows the amount by which
  // it has left that band. Small movements cost nothing; a breakout is tracked; and
  // there is a hard leash so a shot from the far blue line can never escape.
  function _advanceCamera(dt) {
    if (!cam || !rink) return;
    const ch = cam.offsetHeight, vh = rink.clientHeight;
    if (!ch || !vh) return;
    const vis = vh / ch;                              // how much of the sheet is in frame
    // The lead is small on purpose and got smaller. Anticipation that overshoots is
    // just a second source of motion arguing with the first.
    const lead = clamp(puckState.hx * 3, -0.018, 0.018);
    const target = clamp01(puckState.x + lead);
    const err = target - camY;
    // A WIDE deadzone. The puck is allowed to live anywhere in the middle 56% of the
    // frame without the camera acknowledging it at all — most passes, most of the
    // circulation between beats and every scramble in a corner now cost zero motion,
    // which is what makes the remaining motion mean something.
    const dead = vis * 0.28;
    const outside = Math.abs(err) - dead;
    if (outside > 0) {
      // Escaping the frame entirely is worse than a fast pan, so once the puck is most
      // of the way to the edge the camera stops being polite about it. Raised with the
      // deadzone so the two don't overlap into a permanent hurry.
      const tau = Math.abs(err) > vis * 0.44 ? 260 : TAU_CAM;
      const want = camY + Math.sign(err) * outside;
      camY += (want - camY) * (1 - Math.exp(-dt / tau));
    }
    // A LITTLE past each end, and no further. Clamping hard at the sheet's edge jammed
    // the net into the last few pixels of the frame exactly when the play was in tight
    // and the net was the thing you needed to see. The overscroll shows end boards and
    // crowd, which is what is actually behind a net, and it is capped so the ice can
    // never drift into the middle of the picture.
    const over = vh * 0.15;
    const off = clamp(camY * ch - vh / 2, -over, Math.max(0, ch - vh) + over);
    cam.style.transform = `translate3d(0, ${-off.toFixed(1)}px, 0)`;
  }

  // ── depth ─────────────────────────────────────────────────────────────────────
  // THE PICTURE IS 3/4, SO DRAWING ORDER IS A POSITION, NOT A CONSTANT. Every token had
  // a fixed z-index — goalies 3, skaters 2 — which meant a keeper drew in front of every
  // man on the ice no matter where anybody was standing. A forward parked at the top of
  // the crease, unambiguously nearer the camera than the goalie behind him, vanished
  // behind him instead.
  //
  // The sheet's far end is at the TOP of the picture, so model `x` IS depth: the larger
  // it is, the lower on screen and the nearer the camera, and the later it must be
  // painted. Skaters, goalies and severed limbs all share one scale so they interleave
  // with each other rather than each obeying its own layer.
  //
  // Quantised into bands and only written on a change: this is a style write per token
  // per frame otherwise, and z-index churn on twenty elements is not free.
  const Z_BANDS = 300;
  function _depth(o, x, bias) {
    const band = 10 + Math.round(clamp01(x) * Z_BANDS) + (bias || 0);
    if (band !== o.zBand) { o.zBand = band; if (o.el) o.el.style.zIndex = String(band); }
  }
  // The puck sorts by depth like everything else, but with a nudge: it is the object the
  // viewer is tracking, and at the same depth as a body it should be the one you can see.
  // A few bands is enough to win a tie without letting it float over a man properly in
  // front of it.
  const puckZ = { el: null, zBand: 0 };

  function _writeToken(el, x, y) {
    if (!el) return;
    el.style.left = _px(y); el.style.top = _py(x);
  }
  function _writeSkater(m) {
    if (!m.el) return;
    m.el.style.left = _px(m.y); m.el.style.top = _py(m.x);
    _depth(m, m.x);
    // HE IS NEVER ROTATED, and that is the whole point of the 3/4. A standing figure
    // spun to face down-screen is a man standing on his head; a standing figure MIRRORED
    // is a man facing the other way. So heading becomes two discrete facts — which side
    // he faces, and whether you are looking at his front or his back — plus a lean, and
    // his helmet stays above his skates no matter where the play goes.
    //
    // Both are latched with a dead band. A man drifting almost straight up the ice has a
    // lateral velocity that crosses zero constantly, and reading the raw sign would flip
    // him left/right several times a second.
    // A LEAN IS A ROTATION ABOUT HIS SKATES, NOT A SHEAR. This was a `skewX`, which
    // slants a figure's verticals without moving its feet — on a top-down blob that
    // passed for leaning, but on a standing man it visibly WARPS him: his head slides
    // sideways off a body that stays put. He now rotates about the bottom of the box,
    // which is where his blades are, so the whole man tips the way a man tips.
    //
    // A LEAN IS SOMETHING HIS BODY DOES, not something done to his bounding box. Rotating
    // the whole figure was the second attempt at this (the first was a `skewX`, which
    // sheared him) and it is wrong in the same way: tipping a finished drawing is a
    // transform, and a viewer reads it as the sprite being tilted rather than as a man
    // leaning. It is nearly gone from the transform now — a couple of degrees of body
    // roll, no more — and the real weight of a turn is carried by the CROSSOVER, which is
    // limbs moving at their joints. That is the difference between animating a figure and
    // rotating a picture of one.
    if (m.svg) m.svg.style.transform = `rotate(${((m.lean || 0) * 0.28).toFixed(1)}deg)`;
    // FACING IS A CUSTOM PROPERTY, not a transform string, and that is what lets it reach
    // more than one place at once. The body reads it to mirror; the markings printed on
    // the sweater read the SAME value to cancel that mirror locally; and the reflection —
    // which carries its own copy of the whole body — picks both up for free instead of
    // needing to be found and written to separately.
    if (m.face !== m.wasFace) { m.el.style.setProperty('--gdr-face', String(m.face)); m.wasFace = m.face; }
    if (m.showBack !== m.wasBack) { m.el.classList.toggle('away', m.showBack); m.wasBack = m.showBack; }
    const fast = m.speed > 0.16;
    if (fast !== m.wasFast) { m.el.classList.toggle('striding', fast); m.wasFast = fast; }
    // THE STRIDE IS ALWAYS RUNNING; his speed sets its TEMPO and its AMPLITUDE. This
    // used to be gated on `fast`, so a man crossing the threshold popped between an
    // animated cycle and a frozen pose — legs snapping to neutral in a single frame,
    // ten times a beat. Driving two numbers instead of a switch means a man barely
    // moving runs a slow shallow version of the same cycle (weight shifting) and a man
    // on a breakaway runs a quick deep one, with nothing in between to pop across.
    //
    // BOTH ARE QUANTISED, and that is not a micro-optimisation. Rewriting the duration
    // restarts the animation, so a man accelerating smoothly would twitch in place on
    // every frame; coarse bands mean it re-times a few times across a whole rush.
    const sp = clamp(m.speed, 0, 0.45);
    const dur = Math.round((0.92 - sp * 1.35) * 12);      // 12ths of a second
    const amp = Math.round(3 + sp * 30);                  // unitless degrees
    // THE DURATION IS THE DANGEROUS ONE. Rewriting it RESTARTS the animation, so a man
    // whose speed sits on a band boundary re-triggers his own stride every frame and
    // shakes violently in place — the loudest of the three jitters. It only changes on a
    // TWO-band move now, and the bands are coarser, so hovering can't retrigger it.
    // Amplitude is safe to write freely: it is read inside the keyframes, so changing it
    // re-resolves the running animation smoothly instead of restarting it.
    if (Math.abs(dur - m.strideBand) >= 2) { m.strideBand = dur; m.el.style.setProperty('--gdr-stride', `${(dur / 12).toFixed(3)}s`); }
    if (amp !== m.ampBand) { m.ampBand = amp; m.el.style.setProperty('--gdr-amp', String(amp)); }
    const isCarrier = carrier && carrier.side === m.side && carrier.i === m.i;
    if (isCarrier !== m.wasCarrier) { m.el.classList.toggle('carrier', isCarrier); m.wasCarrier = isCarrier; }
  }

  // ── the puck's segments ───────────────────────────────────────────────────────
  function _segment(x1, y1, ms, opts) {
    flow = {
      x0: puckState.x, y0: puckState.y, x1: clamp01(x1), y1: clamp01(y1),
      ms: Math.max(16, ms), t0: performance.now(), ease: (opts && opts.ease) || 'smooth',
      onEnd: (opts && opts.onEnd) || null, idle: !!(opts && opts.idle), thenIdle: !!(opts && opts.thenIdle),
    };
    return flow;
  }

  // Idle circulation. Between beats the puck keeps moving the way a puck does when
  // nothing is happening: a D-to-D across the point, a wall play, a dump-in, a
  // retrieval behind the net. It resolves NOTHING — no shot ever comes out of here,
  // because the only shots that exist are the ones the sim decided.
  const IDLE = [
    { dx: -0.10, y: 0.18, ms: 900 },    // out to the wall
    { dx: -0.02, y: 0.82, ms: 1100 },   // D-to-D across
    { dx:  0.16, y: 0.72, ms: 1000 },   // up the far wing
    { dx:  0.10, y: 0.50, ms: 850 },    // into the middle
    { dx: -0.14, y: 0.30, ms: 1050 },   // turned back
    { dx:  0.22, y: 0.24, ms: 1200 },   // carried up the near wall
  ];
  function _nextIdleFlow() {
    const step = IDLE[(flowRng() * IDLE.length) | 0];
    const jitter = (flowRng() - 0.5) * 0.10;
    let nx = puckState.x + attackDir * step.dx + jitter;
    let ny = step.y + (flowRng() - 0.5) * 0.12;
    // Keep the idle puck off the goal lines entirely. A puck drifting into the crease
    // between beats would look like a chance that nobody called, and the announcer's
    // silence would be the tell.
    nx = clamp(nx, GEO.blue[0] * 0.45, 1 - (1 - GEO.blue[1]) * 0.45);
    // A change of possession, purely for the picture: the carrier flips sides now and
    // then so both sweaters get the puck between whistles.
    if (flowRng() < 0.22) {
      const side = flowRng() < 0.5 ? 'a' : 'h';
      carrier = { side, i: 1 + ((flowRng() * 4) | 0) };
      attackDir = side === 'a' ? 1 : -1;
    }
    _segment(nx, ny, step.ms * (0.8 + flowRng() * 0.5), { idle: true });
  }

  // ── the goalie ────────────────────────────────────────────────────────────────
  // He is never idle. Between shots he shuffles across his crease to stay square to
  // the puck — the depth of a goalie's game is lateral, and a still goalie reads as a
  // dead sprite. Driven off the loop rather than the beat, so he tracks the idle puck
  // as attentively as a live one.
  // HE STANDS ON THE ANGLE, and that is a geometry problem with a real answer rather
  // than a fraction to taste. A goalie's whole job is to put himself on the straight
  // line between the puck and the middle of his net, some distance out along it; how
  // far out is the only judgement in it. The old version covered a flat 0.42 of the
  // puck's lateral spread on a stepped 560ms transition, which meant he drifted the
  // wrong way on a puck in tight (the closer it gets, the MORE he has to move, not
  // less) and arrived in six visible hops.
  //
  // He is integrated on the frame loop now, from the same puck the picture is showing.
  function _advanceGoalies(dt) {
    for (const g of goalies) {
      if (!g.el || !g.el.isConnected) continue;
      const gl = g.side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
      const outward = g.side === 'l' ? 1 : -1;
      const dist = Math.abs(puckState.x - gl);
      // Out to cut the angle when the play is up the ice, back on his post when it is
      // in tight. A keeper sitting deep in his crease on a point shot is the most
      // obviously wrong thing a hockey picture can show, and he was doing it all night.
      const out = clamp(0.010 + dist * 0.20, 0.010, 0.052);
      const tx = gl + outward * out;
      // The similar-triangles bit: at `out` along a line `dist` long, he has covered
      // out/dist of the puck's offset from centre. Clamped so a puck behind the goal
      // line can't walk him out of his own net.
      const ty = clamp(0.5 + (puckState.y - 0.5) * clamp(out / Math.max(0.04, dist), 0, 1), 0.5 - 0.17, 0.5 + 0.17);
      const k = 1 - Math.exp(-dt / TAU_GOALIE);
      g.x += (tx - g.x) * k; g.y += (ty - g.y) * k;
      _writeToken(g.el, g.x, g.y);
      // He sorts with the skaters, so a man in front of the net is in front of him and a
      // man behind the goal line is behind him — which is the entire fix for keepers
      // that used to be painted over everybody on the ice.
      _depth(g, g.x);
    }
  }
  function _goaliePose(side, cls, holdMs) {
    const g = goalieEl(side); if (!g) return;
    g.className = `gdr-goalie ${side === 'l' ? 'left' : 'right'} pose-${cls}`;
    g.dataset.side = side;
    if (holdMs) _t(holdMs, () => { if (g.isConnected) g.className = `gdr-goalie ${side === 'l' ? 'left' : 'right'} pose-ready`; });
  }
  // Bind the two keepers to the loop. They start ON their line rather than easing in
  // from wherever the last mount left them.
  function _bindGoalies() {
    goalies = ['l', 'r'].map((side) => {
      const el = goalieEl(side);
      const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
      // The transition the pulse used to drive would now fight the integrator for the
      // same two properties, and two things writing one style is how a goalie ends up
      // skating to places nobody sent him.
      if (el) el.style.transition = 'none';
      const g = { side, el, x: gl + (side === 'l' ? 0.014 : -0.014), y: 0.5 };
      _writeToken(el, g.x, g.y);
      // Depth at MOUNT, not only in the loop. The skaters get theirs from
      // `_snapFormation`, which runs synchronously; the keepers only got theirs on the
      // first animation frame, so for one frame — and for the whole of a backgrounded
      // tab, where rAF never fires at all — they had no place in the paint order.
      _depth(g, g.x);
      return g;
    });
  }

  // ── the net ───────────────────────────────────────────────────────────────────
  // The mesh bulge. Fired the instant the puck reaches the back of the cage — not when
  // the goal is announced — so the picture and the physics agree.
  function _bulge(side) {
    const mesh = q(`.gdr-net[data-side="${side}"] .gdr-net-mesh`);
    if (mesh) { mesh.classList.remove('bulge'); void mesh.getBoundingClientRect(); mesh.classList.add('bulge'); _t(900, () => mesh.classList.remove('bulge')); }
    const net = q(`.gdr-net[data-side="${side}"]`);
    if (net) { net.classList.add('scored'); _t(2600, () => net.classList.remove('scored')); }
  }
  // THE BUILDING GOES OFF. A goal was the loudest thing in the sim and one of the
  // quietest things in the picture — a mesh bulge and a lamp, over a rink that carried
  // on looking exactly as it had a frame earlier. Three things fire together, and they
  // are three because a goal is a moment the whole arena participates in:
  //   the CAMERA reacts (a short punch in, the operator flinching toward it),
  //   the BUILDING lights up (the lamp and the hoardings), and
  //   four thousand people take a photograph.
  // The flashes are scattered across the STANDS and off the sheet entirely, which is
  // where cameras are; putting them on the ice would read as lightning.
  function _goalPunch(side) {
    if (!rink) return;
    rink.classList.add('scored');
    _t(1500, () => rink && rink.classList.remove('scored'));
    const layer = q('.gdr-flashes'); if (!layer) return;
    const r = _rng(_hash(`flash${side}${Math.round(camY * 1000)}`));
    // They don't all go at once — a stadium's flashes are a scatter over a second and a
    // half, and firing them on one frame is a lightning strike rather than a crowd.
    for (let i = 0; i < 26; i++) {
      _t(60 + r() * 1400, () => {
        if (!layer.isConnected) return;
        const el = document.createElement('div');
        el.className = 'gdr-flash';
        // Left third or right third of the camera — the tiers, never the ice.
        el.style.left = `${(r() < 0.5 ? r() * 15 : 85 + r() * 15).toFixed(1)}%`;
        // Around the camera's own centre, spread about the height of the visible band —
        // flashes going off well outside the frame are flashes nobody sees.
        el.style.top = `${(camY * 100 + (r() - 0.5) * 20).toFixed(1)}%`;
        layer.appendChild(el);
        _t(420, () => el.remove());
      });
    }
  }

  function _clang(side) {
    const net = q(`.gdr-net[data-side="${side}"]`);
    if (net) { net.classList.remove('rang'); void net.getBoundingClientRect(); net.classList.add('rang'); _t(700, () => net.classList.remove('rang')); }
  }

  // Short-lived effect token (spray, ring, whistle) at model coords.
  function _spawn(cls, x, y, life) {
    const layer = q('.gdr-fx'); if (!layer) return null;
    const el = document.createElement('div');
    el.className = cls; el.style.left = _px(y); el.style.top = _py(x);
    layer.appendChild(el); _t(life, () => el.remove());
    return el;
  }

  // ── shell ─────────────────────────────────────────────────────────────────────
  // Sweaters and numbers. The colours ride the payload (the sim derives them from the
  // club name), so both sides wear their own and the view holds no palette that could
  // drift from the league's. Numbers are seeded off the club name, so a club's 14 is
  // its 14 every night without a roster ever crossing the wire for a cosmetic.
  function _numbersFor(team) {
    const r = _rng(_hash(team || 'cphl'));
    const out = [], seen = new Set();
    while (out.length < 5) {
      const n = 2 + ((r() * 96) | 0);
      if (seen.has(n)) continue;
      seen.add(n); out.push(n);
    }
    return out;
  }

  // Only the man with the puck wears a name tag. Ten floating `##POS` labels collided
  // with each other and buried the ice they were drawn over; NHL '94 tagged the man you
  // were controlling and nobody else, for exactly this reason. The other nine are
  // identified by the number on the sweater, which is where a number belongs.
  const _clubVars = (colours) => (colours ? `--gdr-jersey:${colours[0]};--gdr-trim:${colours[1]};` : '');

  function _skaterMarkup(side, colours, team) {
    const style = _clubVars(colours);
    const nums = _numbersFor(team);
    return ROLES.map((role, i) =>
      `<div class="gdr-skater ${side === 'a' ? 'att' : 'def'}${colours ? ' clubbed' : ''}" data-side="${side}" data-i="${i}" style="${style}">` +
        _skaterSvg(nums[i], team) +
        `<span class="gdr-sk-tag">${nums[i]} ${role.pos}</span>` +
      `</div>`).join('');
  }

  // `attackedNet` is the end being shot at this beat: 'r' = the home end (bottom of the
  // picture). The attackers break out of the OTHER end — without this the formation and
  // the rush run in opposite directions on a home-team chance, which reads as the wrong
  // team attacking.
  function _shell(p, attackedNet) {
    const awayTeam = p.awayTeam || p.awayAbbr || 'away';
    const homeTeam = p.homeTeam || p.homeAbbr || 'home';
    return (
      `<div class="gdr-wrap">` +
        `<div class="gdr-head">` +
          `<span class="gdr-head-badge">${cphlMark('17px')}<i>CPhL</i></span>` +
          `<span class="gdr-head-score">${_esc(p.awayAbbr || p.awayTeam || 'AWY')} <b>${p.awayScore | 0}</b> — <b>${p.homeScore | 0}</b> ${_esc(p.homeAbbr || p.homeTeam || 'HOM')}</span>` +
          `<span class="gdr-head-clock">${_esc(p.section || '')} ${_esc(p.clock || '')}</span>` +
          (p.rivalry ? '<span class="gdr-head-rival">RIVALRY</span>' : '') +
          (p.strength && p.strength !== 'even' ? `<span class="gdr-head-str ${_esc(p.strength)}">${_esc(p.strength.toUpperCase())}</span>` : '') +
        `</div>` +
        // The viewport clips; the cam slides; the sheet is the coordinate space every
        // token is positioned in. Three elements, three jobs, and the tokens never need
        // to know the camera exists.
        `<div class="gdr-rink">` +
          `<div class="gdr-cam">` +
            `<div class="gdr-stands" aria-hidden="true"></div>` +
            // Camera flashes fire in the BUILDING, not on the ice, so they need a layer
            // spanning the whole camera rather than the sheet the tokens live on.
            `<div class="gdr-flashes" aria-hidden="true"></div>` +
            `<div class="gdr-sheet">` +
              _rinkSvg() +
              // Blade cuts go in their own layer over the markings and under everything
              // that moves — the ice is scored, not the lines painted on it.
              `<svg class="gdr-cuts" viewBox="0 0 ${SHEET_W} ${SHEET_L}" preserveAspectRatio="none" aria-hidden="true"></svg>` +
              `<div class="gdr-fx"></div>` +
              `<div class="gdr-skaters">` +
                _skaterMarkup('a', p.awayColours || p.attackingColours, awayTeam) +
                _skaterMarkup('h', p.homeColours || p.defendingColours, homeTeam) +
              `</div>` +
              // Each keeper wears his own club, so the two ends of the sheet are never
              // the same man in the same sweater facing opposite ways.
              `<div class="gdr-goalie left pose-ready" data-side="l" style="${_clubVars(p.awayColours || p.attackingColours)}">${_goalieSvg()}</div>` +
              `<div class="gdr-goalie right pose-ready" data-side="r" style="${_clubVars(p.homeColours || p.defendingColours)}">${_goalieSvg()}</div>` +
              `<div class="gdr-puck"></div>` +
            `</div>` +
          `</div>` +
          `<div class="gdr-vignette" aria-hidden="true"></div>` +
        `</div>` +
        `<div class="gdr-strip">` +
          `<span class="gdr-strip-desc">${_esc(p.desc || '')}</span>` +
          `<span class="gdr-strip-names">${_esc(p.shooter || '')}${p.assist ? ` · assist ${_esc(p.assist)}` : ''}${p.goalie ? ` · vs ${_esc(p.goalie)}` : ''}</span>` +
        `</div>` +
        // THE BUILD-UP, IN WORDS, OVER THE BUILD-UP. The sim reads it off the very
        // keyframes this view is splining, so the sentence and the picture are the same
        // rush by construction rather than by two authors agreeing. Absent entirely on a
        // beat with no possession — a fight has no zone entry to describe.
        (p.rush ? `<div class="gdr-rush">${_esc(p.rush)}</div>` : '') +
        `<div class="gdr-cap"><span class="gdr-cap-text">${_esc(caption)}</span></div>` +
      `</div>`
    );
  }

  // Which end is being attacked. The sim's keyframes run toward whichever net the
  // attacking side is shooting at; the last keyframe's x is the honest answer, so we
  // read it rather than trusting a flag that could disagree with the picture. With no
  // keyframes (a faceoff, a fight) nobody is attacking and the default just fixes the
  // away side attacking the home end, which is the frame `winnerSide` is computed in.
  function _attackSide(nodes) {
    if (!nodes || !nodes.length) return 'r';
    return nodes[nodes.length - 1].p[0] >= 0.5 ? 'r' : 'l';
  }

  // Bind the ten DOM skaters to the ten integrated men, and seed them into a legible
  // formation so the first frame is a hockey team rather than a pile at centre ice.
  function _bindMen(p, attackedNet) {
    men = [];
    const seed = _hash(`${p.awayTeam || ''}|${p.homeTeam || ''}|${p.clock || ''}`);
    const r = _rng(seed);
    for (const side of ['a', 'h']) {
      // The side attacking `attackedNet` moves toward it; the other defends it.
      const attacksHomeEnd = (side === 'a') === (attackedNet === 'r');
      const dir = attacksHomeEnd ? 1 : -1;
      for (let i = 0; i < ROLES.length; i++) {
        const el = sheet.querySelector(`.gdr-skater[data-side="${side}"][data-i="${i}"]`);
        const role = ROLES[i];
        const m = {
          side, i, el, dir, role,
          svg: el ? el.querySelector('.gdr-sk-svg') : null,
          body: el ? el.querySelector('.gdr-sk-flip') : null,
          wasFace: null,
          x: clamp01(0.5 - dir * (0.10 + i * 0.03)), y: role.lane,
          // Facing the way he attacks: the home end is the BOTTOM of the picture.
          head: dir > 0 ? Math.PI : 0,
          speed: 0, lean: 0, sprayAt: 0, strideBand: 0, ampBand: 0, cutAt: 0,
          // Facing, latched: which way he is mirrored, and whether you see his back.
          // A man attacking the home end is skating DOWN the picture, toward you.
          // Facing is a discrete WANT, a continuous BLEND that eases toward it, and the
          // sign of the blend. Everything that positions him reads the blend.
          face: 1, faceWant: 1, faceBlend: 1, crossing: false,
          showBack: dir < 0, wasBack: null, wasFace: null,
          // Low-passed screen velocity — the signal facing is actually decided on, so
          // the per-man wander can't be mistaken for a change of direction.
          sdx: 0, sdy: dir > 0 ? 1 : -1,
          phase: r() * 6000, wasFast: false, wasCarrier: false, pin: null,
          // HIS OWN PATCH AND HIS OWN CLOCK. Seeded per man, so the same fixture always
          // ices the same ten individuals, and no two of them stand on a lattice or drift
          // in sympathy. `react` is the one that does the most work: ten men easing toward
          // their targets with an identical time constant move as ONE OBJECT however
          // different their targets are, and that shared lag is most of what read as a
          // formation sliding about rather than five people skating.
          biasX: (r() - 0.5) * 0.036, biasY: (r() - 0.5) * 0.07,
          wanderRate: 0.75 + r() * 0.7, wanderAmp: 0.65 + r() * 0.8,
          react: 0.78 + r() * 0.55,
        };
        men.push(m);
        _writeSkater(m);
      }
    }
  }

  // ── the possession ────────────────────────────────────────────────────────────
  function _playPossession(p) {
    const nodes = Array.isArray(p.possession) ? p.possession.slice() : [];
    if (!nodes.length) { _resolveNoPuck(p); return; }
    const side = _attackSide(nodes);
    const kind = p.kind === 'goal' || p.type === 'goal' ? 'goal' : (p.kind || 'save');
    const save = SAVE[kind] || SAVE.save;

    playAnimating = true;
    // The attacking side is the one whose men should be ahead of the puck. `side` is
    // the end under siege, so whoever attacks it is the side with it.
    const attSide = side === 'r' ? 'a' : 'h';
    attackDir = side === 'r' ? 1 : -1;
    carrier = { side: attSide, i: 0 };
    for (const m of men) m.dir = (m.side === attSide) ? attackDir : -attackDir;

    puckState.x = nodes[0].p[0]; puckState.y = nodes[0].p[1];
    _writeToken(puckEl(), puckState.x, puckState.y); _depth(puckZ, puckState.x, 4);
    _snapFormation(puckState.x, puckState.y);
    camY = puckState.x;                       // the cut takes the camera with it
    _goaliePose(side, 'ready');

    // Chain the keyframes: each segment's end schedules the next, so the whole rush is
    // one continuous motion rather than a queue of timers that can drift apart.
    //
    // EACH KIND OF TOUCH MOVES DIFFERENTLY, which is the whole difference between a
    // sequence of positions and a passage of play. A carry is the man skating, so the
    // puck travels at his pace and he travels with it. A PASS is off his stick and gone
    // — twice the speed, dead straight, nobody carrying it while it's in the air, and
    // the receiver only becomes the carrier when it ARRIVES. A SHOT is preceded by a
    // wind-up: he plants, the puck sits still for a beat, and only then does it leave,
    // which is the anticipation that makes a slapshot read as a slapshot.
    let idx = 1;
    const step = () => {
      if (idx >= nodes.length) return;
      const nd = nodes[idx], prev = nodes[idx - 1];
      const ev = nd.ev;
      idx++;
      const held = { side: attSide, i: Math.max(0, nd.carrier | 0) % ROLES.length };
      const done = () => {
        if (idx < nodes.length) step();
        else _resolveShot(p, kind, save, side, nodes[nodes.length - 1]);
      };

      if (ev === 'shot') {
        // The wind-up. He stops, the puck sits, the stick comes back — and the shot
        // itself is fired by _resolveShot, not here, so the release and the outcome
        // are one motion instead of two that can disagree.
        // The wind-up lasts as long as THIS shot's wind-up: the puck sits on his blade
        // for the length of the load and leaves when the load finishes. A fixed duration
        // was what made a one-timer and a slapshot the same event with different words.
        const wind = SHOT_WIND[p.shotType] || T_WINDUP;
        _windUp(attSide, carrier ? carrier.i : 0, p.shotType);
        _segment(prev.p[0], prev.p[1], wind, { ease: 'out', onEnd: () => {
          _sfx('shot'); carrier = null; done();
        } });
        return;
      }
      if (ev === 'pass') {
        // In the air, belonging to nobody.
        carrier = null;
        _passTrail(prev.p, nd.p, T_PASS);
        _segment(nd.p[0], nd.p[1], T_PASS, { ease: 'out', onEnd: () => {
          // The carrier is the man the puck REACHED — the only reading that survives
          // a deflection or a pass that misses its man.
          if (nd.carrier >= 0) { carrier = held; _receive(held); }
          done();
        } });
        return;
      }
      // A BATTLE IS A PUCK NOBODY OWNS. Dropping the carrier is the whole behaviour:
      // the per-frame job assignment immediately sees a loose puck and sends the nearest
      // man from EACH side after it, so the two of them converge on the same corner and
      // race for it — which is the picture the booth is describing at the same moment.
      if (ev === 'battle') carrier = null;
      else if (nd.carrier >= 0) carrier = held;
      if (ev === 'entry') _flashLine(side);
      // Each touch takes its own time. A dump-in is a flip and a chase, so the puck
      // travels fast and arrives before the men do; a deke is a man beating a man, which
      // is slow because it happens in a phone box.
      const ms = ev === 'dump' ? T_DUMP : ev === 'battle' ? T_BATTLE : ev === 'deke' ? T_DEKE : T_STEP;
      _segment(nd.p[0], nd.p[1], ms, { ease: ev === 'dump' ? 'out' : 'smooth', onEnd: done });
    };
    step();
  }

  // A puck that never got shot (a faceoff, a fight, a whistle) still needs the rink to
  // do something honest, so those beats get their own short pieces below.
  function _resolveNoPuck(p) {
    playAnimating = true;
    if (p.type === 'faceoff') _playFaceoff(p);
    else if (p.type === 'fight') _playFight(p);
    else if (p.type === 'boards') _playHit(p);
    else if (p.type === 'injury') _playInjury(p);
    else if (p.type === 'death') _playDeath(p);
    else if (p.type === 'scrum') _playScrum(p);
    _t(T_DRAW + T_SETTLE, () => _reveal(p));
  }

  // ── the violence ──────────────────────────────────────────────────────────────
  // The CPhL is a league where men are carried off and sometimes killed, and the ice
  // used to sit perfectly still through every one of those calls — the announcer
  // describing a body going through the glass over a photograph of five men standing
  // in a diamond. Every violent beat the sim emits now happens ON the ice.
  //
  // WHOSE SWEATER. The narrator derives an att/def tag onto every violent beat — 'att'
  // is always the away club — so that is read first and is the documented contract the
  // broadcast regress enforces. The club NAME is checked as a fallback, because the
  // payload carries `victimTeam`/`hitterTeam` too and a beat that ever arrives without
  // the tag should still put the right body on the boards rather than a coin-flip one.
  function _sideOf(tag, team, p, fallback) {
    if (tag === 'def') return 'h';
    if (tag === 'att') return 'a';
    if (team && p && team === p.awayTeam) return 'a';
    if (team && p && team === p.homeTeam) return 'h';
    return fallback;
  }
  // Pick a man deterministically from a name, so the same hit puts the same sweater on
  // the boards for everybody watching — and so a defenceman doesn't get hit as the
  // centre on one screen and as a winger on the next.
  function _manFor(side, name, bias) {
    const i = name ? (_hash(name) % ROLES.length) : ((bias | 0) % ROLES.length);
    return men.find(m => m.side === side && m.i === i) || men.find(m => m.side === side);
  }
  // The nearest wall to a point — a hit finishes at the boards, and which boards is
  // simply whichever ones were closer.
  const _nearBoards = (y) => (y < 0.5 ? 0.075 : 0.925);

  // ── dismemberment ─────────────────────────────────────────────────────────────
  // A limb comes off. Two things happen and they are deliberately separate: the part is
  // HIDDEN on the man (he is now a man with one arm, and stays one for the rest of the
  // beat), and a COPY of it is thrown across the ice as its own token, spinning, in his
  // club's colours, leaving a smear where it lands.
  //
  // The copy is drawn from the same LIMB table the body is, so the arm on the ice is
  // the arm that was on the shoulder and cannot drift from it. It inherits the man's
  // club classes and his `--gdr-jersey` custom properties by copying his style
  // attribute, which is the only reason a severed sleeve is the right colour without
  // this code knowing anything about a palette.
  //
  // NOTHING HERE DECIDES ANYTHING. The sim already said the man is out or dead; this is
  // the picture of a fact, and no limb ever changes a score.
  function _sever(m, part, seed) {
    if (!m || !m.el || !LIMB[part]) return;
    if (m.el.classList.contains(`sev-${part}`)) return;
    m.el.classList.add(`sev-${part}`);
    const L = LIMB[part];
    const r = _rng(seed >>> 0);
    const el = _spawn('gdr-gore', m.x, m.y, 5200);
    if (!el) return;
    el.className = `gdr-gore ${m.el.className.replace('gdr-skater', '').replace(/sev-\S+/g, '')}`;
    el.setAttribute('style', `${el.getAttribute('style') || ''};${m.el.getAttribute('style') || ''}`);
    el.innerHTML = `<svg viewBox="-12 -14 24 28" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
      `<g transform="translate(${L.pivot[0]},${L.pivot[1]})">${L.svg}</g></svg>`;
    // And now it is a body on the ice, not an animation. Thrown off him in a direction
    // it keeps, at a speed the ice takes back off it — the same integrator the puck is
    // in, so where it comes to rest is nobody's decision and it can be hit.
    const ang = r() * Math.PI * 2;
    const speed = 16 + r() * 22;
    const d = {
      el, x: m.x, y: m.y, dead: false,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      rot: 0, spin: (500 + r() * 700) * (r() < 0.5 ? -1 : 1),
    };
    debris.push(d);
    _t(5000, () => { d.dead = true; debris = debris.filter(x => x !== d); });
    _spawn('gdr-blood', m.x, m.y, 9000);
    _splatter(m.x, m.y, ang, r);
  }

  // ARTERIAL. A pool under a man says he is bleeding; a SPLATTER says something happened
  // to him — the difference is direction. The droplets are thrown in a cone about the way
  // the limb went, so the mess points back at the event, and they land at a spread of
  // distances so it reads as a spray rather than a ring of dots. Fixed once they land:
  // blood on ice does not animate, it just stays there being blood.
  function _splatter(x, y, ang, r) {
    for (let i = 0; i < 14; i++) {
      const a = ang + (r() - 0.5) * 1.5;
      const dist = 0.012 + r() * r() * 0.085;      // squared, so most land near him
      const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist * (SHEET_L / SHEET_W) * 0.35;
      const el = _spawn('gdr-splat', clamp01(x + dy), clamp01(y + dx), 9000);
      if (!el) continue;
      const s = (0.35 + r() * 1.1).toFixed(2);
      el.style.setProperty('--sx', s);
      // A drop that hits at an angle is a streak, not a dot, and it points the way it
      // was travelling — which is what makes a splatter readable as one event.
      el.style.rotate = `${(a * 180 / Math.PI).toFixed(0)}deg`;
      el.style.setProperty('--sd', (0.6 + r() * 2.2).toFixed(2));
    }
  }

  // WHICH PART. Off the victim's name, so every screen watching the broadcast loses the
  // same arm — a man who is decapitated on one client and merely dearmed on the next is
  // two different games. A head is only ever taken on a death: a decapitated man who
  // gets up in four minutes is a joke the league doesn't need help making.
  const LIMBS_SURVIVABLE = ['armL', 'armR', 'legL', 'legR'];
  function _severPart(name, fatal) {
    const h = _hash(`${name || 'unknown'}|${fatal ? 'fatal' : 'hurt'}`);
    if (fatal && (h % 5) === 0) return 'head';
    return LIMBS_SURVIVABLE[h % LIMBS_SURVIVABLE.length];
  }

  function _down(m, cls) {
    if (!m || !m.el) return;
    m.pin = [m.x, m.y];
    m.el.classList.add(cls || 'down');
  }
  function _up(m) {
    if (!m || !m.el) return;
    m.pin = null;
    m.el.classList.remove('down', 'dead', 'shoving');
  }

  // A hit. The hitter closes, the victim goes into the wall, the boards take it. The
  // impact is the frame everything else is timed off — the spray, the sound and the
  // building's reaction all hang behind it, because a crowd that reacts on the same
  // frame as the collision sounds like it was expecting it.
  function _playHit(p) {
    const vSide = _sideOf(p.victimSide, p.victimTeam, p, 'h');
    const hSide = _sideOf(p.hitterSide, p.hitterTeam, p, vSide === 'a' ? 'h' : 'a');
    const victim = _manFor(vSide, p.victim, 1);
    const hitter = _manFor(hSide, p.hitter, 4);
    if (!victim || !hitter) return;
    const wall = _nearBoards(puckState.y);
    const hx = clamp(puckState.x, 0.12, 0.88);
    // Both men converge on the wall, the hitter arriving from the inside.
    victim.pin = [hx, wall];
    hitter.pin = [hx, wall + (wall < 0.5 ? 0.055 : -0.055)];
    // HE CLOSES WITH HIS HANDS UP AND HIS STICK ACROSS, which is what a check looks like
    // for the half-second before it lands — a man arriving with his arms out and the
    // shaft turned across the victim's chest. The old version had the hitter simply
    // teleport a foot closer and flash a scale pulse, so a body check was two tokens
    // overlapping. Both men wear a pose class through the approach.
    hitter.el?.classList.add('checking');
    victim.el?.classList.add('bracing');
    _t(300, () => {
      hitter.pin = [hx, wall + (wall < 0.5 ? 0.028 : -0.028)];
      hitter.el?.classList.add('swing');
    });
    _t(430, () => {
      _sfx('chest');
      _spawn('gdr-hit', hx, wall, 420);
      _boardsShake();
      victim.el?.classList.add('hit');
      _down(victim);
      _crowd('roar', 150);
      _t(150, () => victim.el?.classList.remove('hit'));
      _t(140, () => hitter.el?.classList.remove('swing'));
    });
    // He gets up — unless the sim follows this beat with an injury, which arrives as
    // its own beat and re-pins him. Play never stopped, so the puck keeps circulating.
    _t(1900, () => {
      _up(victim); hitter.pin = null;
      hitter.el?.classList.remove('checking'); victim.el?.classList.remove('bracing');
    });
  }

  // He isn't getting up. The man is helped off toward the near boards and out of the
  // picture, which is the whole visible consequence of an injury: his club is now
  // playing a man short, and the empty lane is how you see it.
  function _playInjury(p) {
    // The sim calls him `player` on this beat and `victim` on the hit that caused it.
    const name = p.player || p.victim;
    const vSide = _sideOf(p.victimSide, p.victimTeam || p.teamName, p, 'h');
    const victim = _manFor(vSide, name, 1);
    if (!victim) return;
    _down(victim);
    _sfx('whistle');
    _crowd('groan', 320);
    // HOW BADLY. `slotsOut` is the sim's own severity — how many games he'll miss — so
    // the picture reads that rather than rolling its own. A man out for a game took a
    // bad one; a man out for three left something on the ice, and the empty sleeve is
    // the only reason a viewer would believe the number.
    if ((p.slotsOut | 0) >= 3) {
      _t(220, () => _sever(victim, _severPart(name, false), _hash(`${name}|${p.clock || ''}`)));
      _crowd('gasp', 240);
    }
    _spawn('gdr-whistle', victim.x, victim.y, 900);
    _t(1200, () => {
      // Off toward the boards, and gone.
      victim.pin = [victim.x, _nearBoards(victim.y)];
      victim.el?.classList.add('leaving');
    });
    // Play is dead until the drop, so the puck stops where it lies.
    _segment(puckState.x, puckState.y, 3200, { thenIdle: true });
  }

  // The one the league is famous for. Everybody stops. The rink itself goes cold, the
  // other nine men drift into a ring around him and stay there, and nothing moves
  // again until the next beat — which is the only time this view is deliberately
  // still, and the stillness is the point.
  function _playDeath(p) {
    const name = p.player || p.victim;
    const vSide = _sideOf(p.victimSide, p.victimTeam || p.teamName, p, 'h');
    const victim = _manFor(vSide, name, 1);
    if (!victim) return;
    _down(victim, 'dead');
    victim.el?.classList.add('down');
    _spawn('gdr-blood', victim.x, victim.y, 9000);
    // He came apart. This is the beat the league is named for, and the one place the
    // rig's joints earn their keep twice over — the same pivot that swung the arm all
    // night is where the arm leaves him.
    _t(120, () => _sever(victim, _severPart(name, true), _hash(`${name}|dead`)));
    rink?.classList.add('mourning');
    _sfx('whistle');
    _crowd('groan', 500);
    // The ring. Everyone else closes to a stop around him rather than around the puck.
    const others = men.filter(m => m !== victim);
    others.forEach((m, k) => {
      const a = (k / others.length) * Math.PI * 2;
      m.pin = [clamp(victim.x + Math.cos(a) * 0.055, 0.05, 0.95), clamp(victim.y + Math.sin(a) * 0.13, 0.08, 0.92)];
    });
    _segment(puckState.x, puckState.y, 8000, { thenIdle: true });
  }

  // A scrum. No punches thrown and nobody charged — just a knot of bodies after the
  // whistle, which is a different picture from a fight and has to look like one.
  function _playScrum(p) {
    const knot = men.filter(m => m.i > 0).slice(0, 6);
    const cx = clamp(puckState.x, 0.10, 0.90), cy = clamp(puckState.y, 0.12, 0.88);
    knot.forEach((m, k) => {
      const a = (k / knot.length) * Math.PI * 2;
      m.pin = [cx + Math.cos(a) * 0.022, cy + Math.sin(a) * 0.05];
      m.el?.classList.add('shoving');
    });
    _sfx('gloves');
    _crowd('gasp', 260);
    _t(2600, () => knot.forEach(m => _up(m)));
  }

  // The glass takes it. A cheap cue and the most recognisable one in the building.
  function _boardsShake() {
    const b = q('.gdr-boards');
    if (b) { b.classList.remove('shook'); void b.getBoundingClientRect(); b.classList.add('shook'); _t(600, () => b.classList.remove('shook')); }
    if (rink) { rink.classList.add('jolt'); _t(320, () => rink.classList.remove('jolt')); }
  }

  function _resolveShot(p, kind, save, side, final) {
    const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
    const back = side === 'l' ? GEO.cageBack[0] : GEO.cageBack[1];
    const dir = side === 'l' ? -1 : 1;
    carrier = null;
    _goaliePose(side, save.cls, kind === 'goal' ? 2400 : 1400);

    // A goal has to cross BETWEEN THE POSTS. The sim decides the outcome and the depth,
    // not the lateral inch, and its keyframes were drawn against a wider cage than the
    // one now painted — so the crossing point is pulled inside the mouth. This changes
    // no outcome; it stops the picture from disagreeing with the call.
    const mouth = (y) => clamp(y, 0.5 - GEO.netHalf * 0.72, 0.5 + GEO.netHalf * 0.72);

    if (kind === 'goal') {
      // THE ONE THAT MATTERS. The puck travels past the goal line — visibly past, the
      // line is drawn and it crosses it — and only then reaches the mesh, which bulges.
      // Two separate motions, because "crossed the line" and "in the net" are two
      // separate facts and the second is the consequence of the first.
      _segment(gl, mouth(final.p[1]), T_SHOT, { ease: 'in', onEnd: () => {
        _crossFlash(side);
        _sfx('horn', p.hornSeed);   // every barn's horn is that barn's horn
        _segment(back - dir * 0.006, mouth(final.p[1]), 150, { ease: 'out', onEnd: () => {
          _bulge(side); _sfx('net'); _spawn('gdr-spray', back - dir * 0.02, mouth(final.p[1]), 700);
          _goalPunch(side);
          _t(T_SETTLE, () => _reveal(p));
          _t(2400, () => _nextIdleFlow());
        } });
      } });
      _crowd('roar', T_SHOT + 260);
      return;
    }

    // Everything else stops short of the line. `stop` is measured back from the goal
    // line toward the shooter, so a glove save is caught right on the doorstep and a
    // block dies out at the top of the circle.
    const stopX = gl - dir * save.stop * 0.30;
    _segment(stopX, final.p[1], T_SHOT, { ease: 'out', onEnd: () => {
      // THE REBOUND IS NOT A DESTINATION. Each of these hands the puck a direction and
      // a speed and lets the ice have it: away from the net, away from whatever it hit,
      // with the lateral sign taken from the side of the sheet the shot came from so a
      // puck kicked off the right pad goes to the right-hand corner. Where it finishes
      // is nobody's decision — it is wherever friction and the boards leave it.
      const away = final.p[1] < 0.5 ? -1 : 1;      // the side of the ice it came from
      const spread = () => (flowRng() - 0.5) * 0.9;
      // Iron. The only non-goal the building reacts to, so it gets the gasp.
      if (kind === 'post') {
        // Off the pipe it goes SIDEWAYS and it goes hard — a post is a rejection at
        // nearly the speed the shot arrived with, which is why the whole building
        // hears it and then watches the puck end up in the far corner.
        _clang(side); _sfx('post'); _crowd('gasp');
        _kickPuck(-dir * 0.35, away * (0.7 + flowRng() * 0.5), 62 + flowRng() * 22);
      } else if (kind === 'wide') {
        // It missed. So it does not stop beside the net — it carries on into the end
        // boards behind the cage and comes back out, which is the whole reason a
        // missed shot is still a scoring chance ten feet later.
        _sfx('wide');
        _kickPuck(dir * 1, away * 0.35, 54 + flowRng() * 16);
      } else if (kind === 'blocked') {
        // Off a shin pad: dead quick, and back the way it came.
        _spawn('gdr-block', stopX, final.p[1], 600); _sfx('block');
        _kickPuck(-dir * 0.8, spread(), 22 + flowRng() * 14);
      } else if (kind === 'pad') {
        // He kicked it. A pad rebound is the dangerous one — it comes off HARD and
        // into the slot, which is why the ring of forwards converging on it reads.
        _sfx('pad');
        _kickPuck(-dir * 0.75, away * (0.5 + flowRng() * 0.6), 34 + flowRng() * 16);
      } else if (kind === 'glove') { _sfx('glove'); _stickPuckToGlove(side, final.p[1]); }
      else if (kind === 'breakaway') {
        // Poked off his stick — it barely goes anywhere, and that is the picture.
        _sfx('poke');
        _kickPuck(-dir * 0.5, spread(), 14 + flowRng() * 8);
      } else {
        // plain save: held on the chest, and if the sim says he froze it, the whistle
        _sfx('chest');
        // He covered it. The whistle is the reason the next beat is a faceoff in this end.
        if (p.frozen) { _spawn('gdr-whistle', stopX, final.p[1], 900); _t(140, () => _sfx('whistle')); _holdPuck(side, final.p[1]); }
        // He didn't hold it. Off the chest a puck drops nearly straight down and sits
        // in the blue paint — slow, short, and exactly where nobody wants it.
        else _kickPuck(-dir * 0.9, spread() * 0.6, 12 + flowRng() * 8);
      }
      _t(T_SETTLE, () => _reveal(p));
    } });
  }

  // The trapper closes ON the puck: the puck is parked at the glove and hidden, which
  // is the only way a top-down view can say "he caught it" rather than "it stopped".
  function _stickPuckToGlove(side, y) {
    const gl = side === 'l' ? GEO.goalLine[0] : GEO.goalLine[1];
    const dir = side === 'l' ? -1 : 1;
    _segment(gl - dir * 0.018, clamp01(y * 0.5 + 0.25), 120, { ease: 'out', onEnd: () => _holdPuck(side, y) });
  }
  // Play is dead. The puck sits where it was covered until the next beat arrives —
  // which is honest: a frozen puck is the one moment the ice legitimately IS still.
  function _holdPuck(side, y) {
    const pk = puckEl();
    if (pk) { pk.classList.add('caught'); _t(1600, () => pk.classList.remove('caught')); }
    _segment(puckState.x, puckState.y, 1400, { thenIdle: true });
  }

  // He plants and the stick comes back. The class runs slightly longer than the wind-up
  // segment so the follow-through is still going as the puck leaves — a shooter who
  // finishes his swing before the puck moves looks like he pushed it.
  // EVERY SHOT IS THE SHOT THE SIM NAMED. The booth says "slapshot" off `shotType`, and
  // this plays that exact wind-up off the same field — so the call and the picture cannot
  // describe two different shots. Each type gets its own class and its own duration,
  // because the whole difference between them is TIMING: a slapshot is a long load and a
  // violent release, a snap shot has almost no load at all, and a one-timer has none by
  // definition because the puck never stopped.
  const SHOT_WIND = {
    slap: 470, wrist: 250, snap: 170, backhand: 290, onetimer: 90, tip: 70, wrap: 330,
  };
  function _windUp(side, i, type) {
    const m = men.find(mm => mm.side === side && mm.i === i);
    if (!m || !m.el) return;
    const kind = SHOT_WIND[type] ? type : 'wrist';
    m.el.classList.add('shooting', `shot-${kind}`);
    _t(SHOT_WIND[kind] + 220, () => m.el.classList.remove('shooting', `shot-${kind}`));
  }
  // Taking a pass. A short flash on the receiver, so the eye is told where the puck is
  // about to belong rather than having to find the carrier ring again.
  function _receive(who) {
    const m = men.find(mm => mm.side === who.side && mm.i === who.i);
    if (!m || !m.el) return;
    m.el.classList.add('receiving'); _t(260, () => m.el.classList.remove('receiving'));
    _sfx('drop');
  }
  function _flashLine(side) {
    const ln = rink && rink.querySelectorAll('.gdr-line.blue')[side === 'l' ? 0 : 1];
    if (ln) { ln.classList.add('lit'); _t(420, () => ln.classList.remove('lit')); }
  }
  function _crossFlash(side) {
    const ln = rink && rink.querySelectorAll('.gdr-line.goal')[side === 'l' ? 0 : 1];
    if (ln) { ln.classList.add('crossed'); _t(900, () => ln.classList.remove('crossed')); }
  }
  function _passTrail(from, to, ms) {
    for (let i = 1; i <= 3; i++) {
      const f = i / 4;
      _t(ms * f * 0.75, () => _spawn('gdr-trail', from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, 420));
    }
  }

  // ── faceoff ───────────────────────────────────────────────────────────────────
  // The two centres to the dot the sim named, the puck down between them, and the
  // winner's side sweeps it back. Which dot is the whole story of the stoppage, so the
  // dot itself pulses — the viewer's eye goes to the right end of the ice unprompted.
  function _playFaceoff(p) {
    const [dx, dy] = DOTS[p.dot] || DOTS.C;
    const dot = q(`.gdr-dot[data-dot="${p.dot}"]`);
    if (dot) { dot.classList.add('live'); _t(2200, () => dot.classList.remove('live')); }
    carrier = null;
    // Both centres to the dot; everyone else keeps his lane around it, which the
    // formation already does once the puck is sitting there.
    _segment(dx, dy, T_DRAW * 0.55, { ease: 'out', onEnd: () => {
      _sfx('drop');
      const won = p.winnerSide === 'def' ? -attackDir : attackDir;
      _segment(clamp01(dx - won * 0.10), clamp01(dy + (dy < 0.5 ? 0.05 : -0.05)), 300, { ease: 'out', onEnd: () => {
        _sfx('sweep');
        carrier = { side: p.winnerSide === 'def' ? 'h' : 'a', i: 3 };
      }, thenIdle: true });
    } });
  }

  // ── fight ─────────────────────────────────────────────────────────────────────
  // Played off the sim's own exchange list, so the number of punches, who threw each
  // and which landed are the server's facts, not the client's invention.
  function _playFight(p) {
    const ex = Array.isArray(p.exchange) ? p.exchange.slice(0, 10) : [];
    const a = men.find(m => m.side === 'a' && m.i === 0);
    const d = men.find(m => m.side === 'h' && m.i === 0);
    // The exchange names its thrower by NAME, and the only name we can place on the
    // ice is the winner — the server tells us which side he's on. Everything he didn't
    // throw was thrown by the other man, so two facts resolve the whole exchange.
    const winnerIsAtt = p.winnerSide !== 'def';
    const winMan = p.winner || '';
    carrier = null;
    // The two of them lock up wherever the puck last was — a fight starts where the
    // play was, not at centre ice.
    const fx = puckState.x, fy = puckState.y;
    if (a) { a.pin = [fx, fy - 0.035]; a.el?.classList.add('fighting'); }
    if (d) { d.pin = [fx, fy + 0.035]; d.el?.classList.add('fighting'); }
    _sfx('gloves');
    let at = 380;
    ex.forEach((e) => {
      _t(at, () => {
        const byWinner = e.thrower === winMan;
        const thrower = (byWinner === winnerIsAtt) ? a : d;
        const taker = thrower === a ? d : a;
        thrower?.el?.classList.add('swing'); _t(120, () => thrower?.el?.classList.remove('swing'));
        if (e.landed) { taker?.el?.classList.add('hit'); _t(150, () => taker?.el?.classList.remove('hit')); _spawn('gdr-hit', fx, fy, 300); _sfx('punch'); }
        else _sfx('punchMiss');
      });
      at += 170;
    });
    _t(at + 200, () => {
      a?.el?.classList.remove('fighting'); d?.el?.classList.remove('fighting');
      if (a) a.pin = null; if (d) d.pin = null;
    });
    _segment(fx, fy, at + 400, { thenIdle: true });
  }

  // ── reveal ────────────────────────────────────────────────────────────────────
  function _reveal(p) {
    playAnimating = false;
    if (pendingCaption) { _showCaption(pendingCaption.text); if (pendingCaption.speak) pendingCaption.speak(); pendingCaption = null; }
    if (pendingCard) { _renderCard(pendingCard); pendingCard = null; }
  }

  // ── the intermission board ────────────────────────────────────────────────────
  // Between periods the ice is empty for fifteen minutes and there is no play to
  // animate, so the sub-screen becomes what a real broadcast cuts to: the period
  // summary the announcer is reading, on a board, with the league table beside it.
  function _intermission(p) {
    const goals = Array.isArray(p.goals) ? p.goals : [];
    const rows = goals.length
      ? goals.map(g => `<div class="gdri-goal">` +
          `<span class="t">${_esc(g.clockStr || '')}</span>` +
          `<span class="n">${_esc(g.shooter || '')}</span>` +
          `<span class="a">${g.assist ? `from ${_esc(g.assist)}` : 'unassisted'}</span>` +
          `<span class="c">${_esc(g.teamName || '')}</span>` +
          (g.strength && g.strength !== 'even' ? `<span class="s">${_esc(String(g.strength).toUpperCase())}</span>` : '') +
        `</div>`).join('')
      : `<div class="gdri-none">No goals in the ${_esc(p.section || 'period')}.</div>`;
    const cas = (p.casualties || []).length
      ? `<div class="gdri-cas">Carried off: ${(p.casualties || []).map(_esc).join(', ')} — no replacements.</div>` : '';
    host.innerHTML =
      `<div class="gdr-wrap">` +
        `<div class="gdr-head">` +
          `<span class="gdr-head-badge">${cphlMark('17px')}<i>CPhL</i></span>` +
          `<span class="gdr-head-score">${_esc(p.awayAbbr || 'AWY')} <b>${p.awayScore | 0}</b> — <b>${p.homeScore | 0}</b> ${_esc(p.homeAbbr || 'HOM')}</span>` +
          `<span class="gdr-head-clock">INTERMISSION</span>` +
        `</div>` +
        `<div class="gdri">` +
          `<div class="gdri-main">` +
            `<div class="gdri-title">END OF THE ${_esc((p.section || '').toUpperCase())}</div>` +
            `<div class="gdri-sub">Scoring summary</div>` +
            `<div class="gdri-goals">${rows}</div>` +
            cas +
            `<div class="gdri-stats">` +
              `<span><i>SOG</i> ${_esc(p.awayAbbr || 'AWY')} ${p.shotsAway | 0} · ${_esc(p.homeAbbr || 'HOM')} ${p.shotsHome | 0}</span>` +
              `<span><i>PEN</i> ${p.penalties | 0}</span>` +
              `<span><i>FIGHTS</i> ${p.fights | 0}</span>` +
              `<span><i>HITS</i> ${p.hits | 0}</span>` +
            `</div>` +
            `<div class="gdri-next">Back for the ${_esc(p.nextOrd || 'next period')}</div>` +
          `</div>` +
          _standingsDock(p) +
        `</div>` +
        `<div class="gdr-cap"><span class="gdr-cap-text">${_esc(caption)}</span></div>` +
      `</div>`;
    // No ice on screen — the loop and the beat helpers must not try to move tokens.
    rink = null; cam = null; sheet = null; men = []; goalies = []; debris = []; cuts = []; _stopLoop();
    _t(T_SETTLE, () => _reveal(p));
  }

  // The league dock. Absent rather than empty before the CPhL has played a game —
  // a table of zeroes says less than no table at all.
  function _standingsDock(p) {
    const rows = Array.isArray(p.standings) ? p.standings.slice(0, 6) : [];
    if (!rows.length) return '';
    const me = (t) => (t === p.awayTeam || t === p.homeTeam) ? ' me' : '';
    return `<div class="gdri-stand">` +
      `<div class="gdri-stand-head">CPhL · PTS</div>` +
      rows.map((r, i) => `<div class="gdri-stand-row${me(r.team)}">` +
        `<span class="r">${i + 1}</span><span class="t">${_esc(r.team)}</span>` +
        `<span class="p">${r.points ?? 0}</span></div>`).join('') +
    `</div>`;
  }

  // Build the ice and start it living. Shared by `apply` and `showIdle`, because a
  // sub-screen opened before the first beat should show a rink with players on it —
  // "waiting for the drop" over a live warmup, not over a blank card.
  function _mount(p, attackedNet) {
    host.innerHTML = _shell(p, attackedNet);
    rink = host.querySelector('.gdr-rink');
    cam = host.querySelector('.gdr-cam');
    sheet = host.querySelector('.gdr-sheet');
    flowRng = _rng(_hash(`${p.awayTeam || ''}${p.clock || ''}${p.clockSecs || 0}`));
    attackDir = attackedNet === 'r' ? 1 : -1;
    carrier = { side: attackedNet === 'r' ? 'a' : 'h', i: 0 };
    _bindMen(p, attackedNet);
    // Place them before the first frame, around wherever the puck actually is. A beat
    // with no possession chain — a hit, a fight, a death — never went through the
    // possession cut, so its men stayed at whatever seed positions they were built
    // with while the camera sat on the puck somewhere else entirely: a man was killed
    // on an empty sheet, off-camera, with the rink greying out around nobody.
    _snapFormation(puckState.x, puckState.y);
    const pk = puckEl();
    if (pk) pk.classList.remove('caught');
    // A new mount is a new element, so the depth tracker has to be re-pointed at it and
    // its band forgotten — or the puck keeps whatever z-index the last beat left it on.
    puckZ.el = pk; puckZ.zBand = 0;
    _writeToken(pk, puckState.x, puckState.y); _depth(puckZ, puckState.x, 4);
    camY = puckState.x;
    flow = null;
    // A new beat rebuilds the sheet, so last beat's parts went with the old DOM. The
    // list has to go with them or the integrator keeps stepping orphans forever.
    debris = []; cuts = [];
    _bindGoalies();
    _startLoop();
  }

  function apply(p) {
    if (!host || !p) return;
    _stop();
    last = p;
    // An intermission is not a play — it has no possession, no shooter and no ice.
    if (p.type === 'intermission') { _clearCard(); _intermission(p); return; }
    const nodes = Array.isArray(p.possession) ? p.possession : null;
    _mount(p, _attackSide(nodes));
    _playPossession(p);
  }

  function _showCaption(text) {
    caption = String(text || '');
    const el = host && host.querySelector('.gdr-cap-text');
    if (el) { el.textContent = caption; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
  }
  function setCaption(text, opts) {
    const speak = opts && opts.speak;
    if (opts && opts.held) pendingCaption = { text: String(text || ''), speak };
    else { _showCaption(text); if (speak) speak(); }
  }

  // Jumbotron cards — the same sportsfx graphics tv.js would take the whole screen
  // with, rendered compact over the rink so the ice stays visible.
  const CARD = {
    hockeygoal: (fx) => ({ title: fx.hattrick ? 'HAT TRICK' : 'GOAL', cls: 'hot',
      sub: [fx.shooter, fx.assist ? `assist ${fx.assist}` : '', { pp: 'POWER PLAY', sh: 'SHORTHANDED', en: 'EMPTY NET' }[fx.strength] || ''].filter(Boolean).join(' · ') }),
    hockeyfight: (fx) => ({ title: 'GLOVES OFF', sub: `${fx.winner} def. ${fx.loser}`, cls: 'out' }),
    hockeydeath: (fx) => ({ title: 'SUDDEN DEATH', sub: fx.player || '', cls: 'dead' }),
    hockeycup: (fx) => ({ title: 'COLDWATER CUP', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: 'hot' }),
    matchup: (fx) => ({ title: 'CLUSTER PUCK', sub: (fx.away && fx.home) ? `${fx.away} vs ${fx.home}` : '', cls: '' }),
    gamewin: (fx) => ({ title: 'FINAL', sub: fx.winner ? `${fx.winner} ${fx.winScore}–${fx.loseScore}` : '', cls: 'final' }),
    champion: (fx) => ({ title: '🏆 CHAMPIONS', sub: fx.winner || '', cls: 'hot' }),
  };
  function _renderCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    const m = CARD[fx.kind](fx);
    let el = host.querySelector('.gdr-jumbo');
    if (!el) { el = document.createElement('div'); el.className = 'gdr-jumbo'; host.appendChild(el); }
    el.innerHTML = `<div class="gdr-jumbo-brand">${cphlMark('20px')}</div>` +
      `<div class="gdr-jumbo-title">${_esc(m.title)}</div>${m.sub ? `<div class="gdr-jumbo-sub">${_esc(m.sub)}</div>` : ''}`;
    el.className = `gdr-jumbo ${m.cls}`; void el.offsetWidth; el.classList.add('in');
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => el && el.classList.remove('in'), (fx.duration || 3.5) * 1000);
  }
  function showCard(fx) {
    if (!host || !fx || !CARD[fx.kind]) return;
    if (playAnimating) pendingCard = fx; else _renderCard(fx);
  }
  function _clearCard() { if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; } host?.querySelector('.gdr-jumbo')?.remove(); }

  // Opened before a beat arrived. Real ice, real men, circulating — with the lockup
  // over the top. Blank was always the wrong answer here: the sub-screen's whole claim
  // is that there's a game on.
  function showIdle() {
    if (!host) return;
    _stop(); _clearCard();
    const p = last || {};
    _mount(p, 'r');
    const veil = document.createElement('div');
    veil.className = 'gdr-idle';
    veil.innerHTML = cphlLockup('Rinkside', '46px') + `<div class="gdr-idle-sub">Waiting for the drop…</div>`;
    host.querySelector('.gdr-wrap')?.appendChild(veil);
  }

  function clear() {
    _stop(); _clearCard(); _stopLoop();
    if (host) host.innerHTML = '';
    rink = null; cam = null; sheet = null; men = []; goalies = []; debris = []; cuts = [];
    caption = ''; pendingCaption = null; last = null; flow = null; carrier = null;
  }

  return { apply, clear, setCaption, showIdle, showCard };
}

// Test hook — the pure geometry, exercised by the offline harness.
export const __test = {
  GEO, DOTS, SAVE, ROLES, SHEET_W, SHEET_L,
  rinkSvg: _rinkSvg, netSvg: _netSvg, goalieSvg: _goalieSvg, skaterSvg: _skaterSvg,
  sx: _sx, sy: _sy,
};
