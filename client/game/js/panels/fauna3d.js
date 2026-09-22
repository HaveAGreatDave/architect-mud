// FAUNA-3D — the single source of truth for what an animal looks like in 3D.
//
// The sibling of aircraft3d.js, and deliberately a much smaller thing. One low-poly model per
// authored animal, expressed as a list of faces in the animal's own frame (f = forward/nose+,
// g = right+, h = up+), each tagged with a role and a baked shade, built from a row of plain
// numbers under content/fauna_models/. Normalised the same way aircraft are — |f| ≲ 1.15, a wing
// tip at g ≈ ±1 — so a caller's size constant means the same thing here as it does there.
//
// ⚠ AN ANIMAL IS NOT A VEHICLE. This exists rather than a `kind` on aircraft3d.js because that
// file's mesh path is welded to liveries, jazz splatter, canopy glass, gear retraction, navigation
// lamps, CONTACT_SIZE, MODEL_SCALE and sortTruckFaces, and `vehicleRenderSmoke()` sweeps
// VEHICLE_CLASSES straight through drawAircraftModel. A goose filed over there arrives at every
// one of those, and each is a surface it has no business having and a way for a gate to go red on
// something that is not a bug. See the ⚠ in client/shared/fauna-model-schema.js.
//
// ⚠ NOTHING HERE IS MOTION, AND A POSE IS STILL A STATIC MESH. What changed is how many of them
// there are: the CARD renderer could afford three wing shapes, because each one is a texture per
// bearing, and the mesh renderer can afford a continuous beat, because a pose costs one build for
// the life of the page and nothing per frame. Either way this file answers what shape a bird is in
// and windshield.js owns the clock that decides which. A period or a rate authored in content here
// would be a second clock to disagree with the first.
//
// The row says what a goose IS; the renderer says what it does.
//
// ⚠ AND A DRAWN GOOSE IS TRIANGLES RATHER THAN A QUAD. `faunaWorldFaces` hands the same mesh to the
// depth buffer, so the world transform runs per bird per frame while the BUILD stays once per pose.
// See the ⚠ there for why a card could not stand on the ground.
//
// ⚠ THE FACE COUNT IS 62 IN THE AIR AND 54 ON THE GROUND, against the 16-20 the design guessed at
// before the parts were written down and the ~40 it settled at before the feathering pass. A bird
// has a body, a tapered rump, a tail, undertail coverts, a neck in two segments, a head, a bill, a
// chinstrap, a cambered arm and a hand cut into primaries, two legs and its blotches, and there is
// no honest way to spend fewer. `FACE_MAX` in scripts/shapes/fauna.mjs is what bounds a frame; the
// slack there is what any future part is spent out of, so check it before adding one.
import { BIRD_ROWS, BIRD_ROWS_FAR } from '../../../shared/fauna-models.js';

const V = (f, g, h) => [f, g, h];
const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// Spelled out rather than imported from aircraft3d.js. It is one line, and reaching over there for
// it would be the first thread of exactly the coupling the ⚠ above exists to prevent — it also
// drags a 7,000-line module and its raster dependency into anything that wants a goose.
const hex2rgb = (h) => { if (typeof h !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(h)) return null; const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// ── The row, and the Modelshop's override on top of it ────────────────────────
// The same seam aircraft3d.js exposes at vehicleParamBase/setVehicleParams: every read goes
// through `row()`, so a tuner slider reaches the mesh builder and a table read that skipped it
// would be a slider that moves half the animal.
const TABLES = { bird: BIRD_ROWS };
const FAR_TABLES = { bird: BIRD_ROWS_FAR };
const _override = { bird: new Map() };

function baseRow(kind, id) { return (TABLES[kind] || {})[id] || null; }
// ⚠ THE FAR TIER IS A WHOLE ROW, ALREADY MERGED BY THE BAKE. Nothing is combined here: this
// picks a table. Merging two rows per call would put an object spread on the path a murmuration
// walks a few thousand times a frame, to produce the same row every time.
//
// ⚠ AND A DEV-PANEL OVERRIDE BEATS BOTH TIERS. `setFaunaParams` is how the Modelshop tunes a
// live animal, and an override that only reached the near tier would leave a tuner watching a far
// bird ignore every change -- which is exactly the failure clearFaunaFacesCache exists to stop.
function row(kind, id, far) {
  const o = _override[kind]?.get(id);
  if (o) return o;
  if (far) { const t = FAR_TABLES[kind]; const r = t && t[id]; if (r) return r; }
  return baseRow(kind, id) || null;
}

export function faunaParamBase(kind, id) { const r = baseRow(kind, id); return r ? { ...r } : null; }
export function faunaParamIds(kind) { return Object.keys(TABLES[kind] || {}); }

export function setFaunaParams(kind, id, patch) {
  const t = _override[kind];
  if (!t) return;
  if (patch === null) { t.delete(id); } else {
    const base = baseRow(kind, id);
    if (!base) return;
    t.set(id, { ...base, ...patch });
  }
  // ⚠ A CHANGE MUST BUST THE MESH CACHE. `faunaFaces` memoises on kind:id:state:wing and nothing
  // in that key says which parameters built it, so without this the first build of a pose wins
  // for the rest of the session and the tuner appears to do nothing.
  clearFaunaFacesCache();
}

export function clearFaunaParams() { for (const k of Object.keys(_override)) _override[k].clear(); clearFaunaFacesCache(); }

// ── Palette ───────────────────────────────────────────────────────────────────
// A face's role names its colour directly. There is no livery here and there should not be: an
// animal is not painted, and a per-instance colour would mean a texture per instance.
const FALLBACK = {
  body: [107, 95, 78], belly: [201, 194, 180], neck: [22, 22, 26], cheek: [232, 230, 223],
  bill: [14, 14, 17], wing: [90, 81, 69], patch: [154, 154, 142], leg: [42, 38, 34],
  primary: [46, 42, 38], undertail: [238, 236, 230], head: [22, 22, 26],
  crown: [22, 22, 26], eye: [16, 14, 13],
};
const ROLE_FIELD = {
  body: 'bodyCol', belly: 'bellyCol', neck: 'neckCol', cheek: 'cheekCol',
  bill: 'billCol', wing: 'wingCol', patch: 'patchCol', leg: 'legCol',
  // The flight feathers, and the white under the tail.
  //
  // ⚠ `primary` IS NOT A SHADE OF `wing`, and that is why it is a role rather than an `sh`. The
  // hand of a goose is near-black where the arm is grey-brown, so the tips read as a separate
  // thing against the wing they hang off — which is the whole point of drawing them separately.
  // It is also the field a gull's black wingtip and a hawk's dark flight feathers will want, so
  // it is doing three species' work the day it lands.
  //
  // ⚠ AND `undertail` IS NOT `belly`. The belly is #c9c2b4, a warm grey; the coverts under a
  // goose's tail are white, and painting them the belly colour is a wedge that reads as more
  // barrel rather than as a marking.
  primary: 'primaryCol', undertail: 'undertailCol',
  // ⚠ THE HEAD IS NOT THE NECK, on five of the six birds in the table. A pigeon's head is blue-grey
  // over an iridescent collar, a vulture's is bare and pale over a dark ruff, a sparrow carries a
  // cap, a gull is white over a grey mantle and a hawk is dark over both. It was one role because
  // the goose is the one bird here whose head and neck genuinely ARE the same black, and the
  // species table was written from the goose outward.
  //
  // ⚠ AND IT COSTS NOTHING IN FACES. The head is already a tube of its own — this changes which
  // colour that tube is painted and nothing else, which is why the bird that most needs a hooded
  // read is also the one a murmuration draws twenty of.
  head: 'headCol',
  // The cap, and the eye. Both resolve to something sensible when a row leaves them out — see
  // `faunaPalette` — so neither is a field a species has to carry to be built.
  crown: 'crownCol', eye: 'eyeCol',
};

// ⚠ `hex2rgb` answers NULL on anything that is not exactly #rrggbb, and `rgb(null,null,null)` is a
// string the headless canvas stub accepts and a real browser throws on. The schema rejects a bad
// colour at author time; this is the second half of that, so a row that somehow got through paints
// the fallback instead of killing the frame.
export function faunaPalette(p) {
  const out = {};
  for (const role of Object.keys(ROLE_FIELD)) out[role] = hex2rgb(p?.[ROLE_FIELD[role]]) || FALLBACK[role];
  // ⚠ AN UNSET HEAD IS THE NECK, NOT THE FALLBACK. Every field in this file is zero-is-today, and
  // for a colour that means a row written before the head had a role of its own must paint exactly
  // the bird it painted then — the neck's own colour on the head, never a stand-in that happens to
  // be near it.
  if (!hex2rgb(p?.headCol)) out.head = out.neck;
  // ⚠ AND AN UNSET CROWN IS THE HEAD, for the same reason — a row with no cap must paint a head
  // all one colour, and the geometry is there either way. `crownCol` is what turns the top two
  // facets into a marking; without it they are simply more head.
  if (!hex2rgb(p?.crownCol)) out.crown = out.head;
  return out;
}

// ── Mesh primitives ───────────────────────────────────────────────────────────
// Deliberately local and tiny. aircraft3d.js's equivalents are private to it, and importing a
// mesh helper across the two files would be the first thread of exactly the coupling the ⚠ at the
// top of this file exists to prevent.

// A tapered prism between two points, `n` sides, optionally squashed so the cross-section is an
// ellipse rather than a circle.
//
// ⚠ THE CROSS-SECTION IS PERPENDICULAR TO THE AXIS, and that has to be solved rather than assumed.
// The first version built every ring in the (g, h) plane on the grounds that a bird's parts are
// all roughly fore-aft — which is true of the body and false of everything interesting. A leg runs
// straight DOWN and a standing goose's neck runs steeply UP, so a ring in that plane lies along
// the part instead of around it: the tube collapses to a flat plate smeared down its own length,
// which draws as a splayed kite rather than a leg and does not look like a frame bug at all.
// ⚠ `topRole` IS THE CHEAPEST MARKING IN THE FILE, and it is the one the references are full
// of: a cap. A sparrow's crown, a gull's hood, a pigeon's darker skull — every one of them is the
// TOP of a head that is a different colour from the SIDE of the same head, and the head is already
// a four-sided tube, so the facets are already there. Painting the two that face up is a role
// change on existing geometry and costs nothing at all.
//
// ⚠ AND IT IS THE FACETS THAT FACE UP, NOT AN INDEX. `up` is the same quantity the shade below is
// derived from, so a crown cannot end up on the throat if somebody changes where the ring starts.
// ⚠ AND 'botRole' IS THE SAME TRICK POINTED DOWN, which is what counter-shading IS. Almost
// every bird alive is dark over and pale under, and this file only had one way to say it: a flat
// sheet tucked inside the barrel's underside, which is a KEEL marking and is seen edge-on from
// nearly every angle. Painting the body's own lower facets says it properly and costs nothing.
//
// 'botCut' is where the pale stops climbing the flank: -1 is no facet at all (which is every bird
// that shipped before it), and toward 0 it comes further up until at 0 the whole lower half of the
// barrel is pale. A goose's stops low and a robin's comes right up under the wing.
function tube(faces, a, b, r0, r1, role, sh, n = 4, squash = 1, topRole = null, botRole = null, botCut = -1) {
  let ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
  const L = Math.hypot(ax, ay, az) || 1;
  ax /= L; ay /= L; az /= L;
  // Any vector not parallel to the axis will do to start the frame; up, unless the axis IS up.
  const upZ = Math.abs(az) > 0.94 ? [1, 0, 0] : [0, 0, 1];
  // u = axis × up, normalised; v = axis × u. Both unit and both perpendicular to the axis.
  let ux = ay * upZ[2] - az * upZ[1], uy = az * upZ[0] - ax * upZ[2], uz = ax * upZ[1] - ay * upZ[0];
  const uL = Math.hypot(ux, uy, uz) || 1;
  ux /= uL; uy /= uL; uz /= uL;
  const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;

  const ring = (c, r) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r * squash;
      out.push(V(c[0] + ux * cs + vx * sn, c[1] + uy * cs + vy * sn, c[2] + uz * cs + vz * sn));
    }
    return out;
  };
  const A = ring(a, r0), B = ring(b, r1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // A fixed shade per facet, so a rounded part reads as rounded without a light to compute
    // against. A bird is counter-shaded; this is the geometric half of what the belly role does
    // in colour.
    //
    // ⚠ `v` POINTS DOWN, and getting that backwards lit the whole animal from underneath. The
    // frame is u = axis × up and v = axis × u, which for a fore-aft axis comes out as u = -g and
    // v = -h — so `sin(mid)` is +1 at the KEEL and -1 at the SPINE. The first version read that as
    // "up", making the belly the brightest facet and the back the darkest. The back is also the
    // biggest facet you can see from any angle these poses bake at, so the animal read as a flat
    // dark slab with a glowing underside, and it looked like a polygon-count problem. It was not:
    // eight sides and six sides are equally wrong when the light is upside down.
    const mid = ((i + 0.5) / n) * Math.PI * 2;
    const up = -Math.sin(mid);                              // +1 on the spine, -1 on the keel
    const r2 = topRole && up > 0.5 ? topRole : (botRole && up < botCut ? botRole : role);
    faces.push({ role: r2, sh: sh * (0.74 + 0.30 * (0.5 + 0.5 * up)), p: [A[i], A[j], B[j], B[i]] });
  }
}

// A flat sheet — a wing panel, a tail, a blotch. Drawn from both sides by the painter, so the
// winding does not matter here.
function sheet(faces, pts, role, sh) { faces.push({ role, sh, p: pts }); }

// ── The goose ─────────────────────────────────────────────────────────────────
// STATES: 'walk' (standing and stepping on the ground), 'raft' (sitting on water — the same bird
// with its legs under it), 'air' (flying, with `wing` 0/1/2 picking the wingbeat shape).
//
// ⚠ A WINGBEAT HAS THREE SHAPES AND FOUR STEPS. Up, mid, down — and mid-on-the-way-down and
// mid-on-the-way-up are the same silhouette, so a caller steps 0,1,2,1 through three textures
// rather than paying for a fourth that is a duplicate of the second.
// × flapArc: the recovery, level, the power stroke.
//
// ⚠ THE BEAT IS NOT SYMMETRIC, and making it symmetric is what drew a spike. A goose's downstroke
// is the one that does the work and it goes deep; the recovery folds the wing and brings it back
// up barely above the shoulder. Raised as far as it is dropped, and seen from the side — where the
// span foreshortens into almost nothing and both wings overlap into one shape — the whole bird
// becomes a single vertical spike with no chord in it. Tuning the amplitude down did not help,
// because the amplitude was not the asymmetry.
const WING_DIHEDRAL = [0.5, 0, -1];

// ⚠ ONE BUILDER FOR EVERY BIRD, NOT ONE PER SPECIES. Every ⚠ in this function — eight sides
// and not six, the ring perpendicular to the axis, v points DOWN, the tail must be cocked, the
// folded wing is marking-sized, the origin is the ground contact, no pale underside sheet — is a
// BIRD fact rather than a goose fact. A builder per species means copying all of them four times
// or re-learning them four times, and this file's own history says re-learning is what happens.
//
// So a species is a ROW, and the parts that genuinely differ between birds are toggles on it.
// Generalising first does not foreclose a per-id registry later (that is five lines at the two
// call sites); registering first forecloses generalising.
//
// ⚠ AND THE TOGGLES ARE NUMBERS AND BOOLEANS, NEVER STRINGS. The schema's whole guarantee is
// that a string is only ever a colour — see the ⚠ in fauna-model-schema.js, and the {span:'wide'}
// that passed all four pipeline steps green. Binary is a boolean, ordered is a count, and
// something bipolar like a tail shape is a SIGNED SCALAR, which is also nicer to author because
// it interpolates.
// ── THE TWO RUNGS BETWEEN A BIRD AND A DOT ───────────────────────────────────
//
// ⚠ THE LADDER WENT FULL MESH → FAR MESH → DOT, AND THE LAST STEP WAS A CLIFF. Fifty-five faces
// to thirty-four is a trim nobody sees; thirty-four to ONE ROUND SPRITE is the whole animal gone
// at once, and it is what "many of them look like dots giving an insect feel" is. A murmuration
// hits it constantly, because `faunaMeshMax` rations the mesh budget in FLOCK ORDER — so a bird
// only a couple of tiles away can be a dot purely because seventeen hundred others asked first.
// The rung it needed is not a smaller bird, it is a SILHOUETTE: at a few pixels a starling is a
// body and two wings, and nothing else it has ever reached the raster.
//
// ⚠ AND THE FAR TIER EXISTS FOR ONE SPECIES OUT OF FIVE. `FAR_TABLES` is authored, and only the
// songbird has a row — so the goose, the gull, the pigeon and the hawk go from their full mesh
// straight to a dot with no reduction at all. These two rungs are DERIVED from whatever row the
// species already has, so all five get them with nothing authored and no new content file.
//
// ⚠ IT IS THE SAME `p` AND THE SAME FACE FORMAT, so it goes through faunaPose's cache, the
// palette, faunaWorldFacesInto's transform, the pose key and the depth buffer without any of them
// learning a new concept. A glyph is a bird with almost no faces, not a different kind of thing.
//
// ⚠ THE BODY IS A VERTICAL PLATE AND NOT A HORIZONTAL ONE. A flat plate lying in the wings' own
// plane is invisible edge-on, and level with a flock is exactly where a pilot and a driver see one
// from — so the one face that must never vanish carries the SIDE profile, and the coarse rung adds
// the plan view on top of it rather than instead of it.
//
// ⚠ AND THE WINGS STILL BEAT, WHICH IS MOST OF WHAT SAYS "BIRD" AT THIS SIZE. `dihK` is the same
// dihedral the full mesh is built from, so a glyph flaps in step with the bird beside it that
// happened to win a mesh — the one place these two tiers are guaranteed to be seen together.
function buildBirdGlyph(p, state, dihK, coarse) {
  const faces = [];
  const air = state === 'air';
  const span = p.span ?? 1, chord = p.chord ?? 0.3;
  const bodyLen = p.bodyLen ?? 0.34, bodyW = p.bodyW ?? 0.13, bodyH = p.bodyH ?? 0.14;
  const tailLen = p.tailLen ?? 0.22, tailW = p.tailW ?? 0.075;
  const sweep = p.wingSweep ?? 0.12;
  // A folded wing on a walking bird is a line down its side, not a span — so the glyph keeps the
  // body and tucks the wings in rather than drawing a bird standing on the grass with its wings out.
  const tip = air ? span : bodyW * 1.6;
  const dih = air && dihK != null ? dihK : 0;
  const nose = bodyLen * 0.52, tail0 = -bodyLen * 0.48;
  // The side profile: nose to tail, at the body's own depth. Always present, at every rung.
  faces.push({ p: [[nose, 0, 0], [nose * 0.1, 0, bodyH * 0.5], [tail0, 0, bodyH * 0.18],
    [tail0, 0, -bodyH * 0.3], [nose * 0.1, 0, -bodyH * 0.45]], role: 'body', sh: 1 });
  // One quad a side, root to tip, swept back and lifted by the beat.
  for (const s of [-1, 1]) {
    const ty = s * tip, tz = dih * tip;
    faces.push({ p: [[chord * 0.5, s * bodyW * 0.5, 0], [chord * 0.5 - sweep * tip, ty, tz],
      [-chord * 0.5 - sweep * tip * 1.3, ty, tz], [-chord * 0.45, s * bodyW * 0.5, 0]],
      role: 'wing', sh: 1 - 0.12 * s });
  }
  if (!coarse) return faces;
  // The coarse rung adds the plan view and the tail — the two things that say which way it is
  // going when you are above or below it, which the side plate alone cannot.
  faces.push({ p: [[nose, 0, 0], [nose * 0.1, bodyW * 0.5, 0], [tail0, bodyW * 0.3, 0],
    [tail0, -bodyW * 0.3, 0], [nose * 0.1, -bodyW * 0.5, 0]], role: 'body', sh: 0.88 });
  faces.push({ p: [[tail0, tailW * 0.4, 0], [tail0 - tailLen, tailW, 0],
    [tail0 - tailLen, -tailW, 0], [tail0, -tailW * 0.4, 0]], role: 'primary', sh: 0.8 });
  return faces;
}

function buildBird(p, state, wing, dihK, gear = 0) {
  const faces = [];
  const air = state === 'air';
  const bodyLen = p.bodyLen ?? 0.34, bodyW = p.bodyW ?? 0.13, bodyH = p.bodyH ?? 0.14;
  const span = p.span ?? 1, chord = p.chord ?? 0.3;
  const sweep = p.wingSweep ?? 0.12, flapArc = p.flapArc ?? 0.55, cup = p.wingCup ?? 0.45;
  const neckLen = p.neckLen ?? 0.3, neckW = p.neckW ?? 0.045, neckRise = p.neckRise ?? 0.22;
  const headLen = p.headLen ?? 0.1, headH = p.headH ?? 0.065, billLen = p.billLen ?? 0.09;
  const tailLen = p.tailLen ?? 0.22, tailW = p.tailW ?? 0.075;
  const legLen = p.legLen ?? 0.16, legW = p.legW ?? 0.018, footLen = p.footLen ?? 0.07;
  const bodyR = (bodyW + bodyH) / 2;
  // ── THE FEATHERING FIELDS ─────────────────────────────────────────────────
  // ⚠ EVERY ONE OF THESE IS ZERO-IS-TODAY. A row that does not set them builds the bird that
  // shipped before the pass, face for face — which is what lets an author back any one of them
  // out on its own in the tuner and see what it was doing, and what makes "the goose got worse"
  // a question with an answer rather than a bisect.
  //
  // ⚠ AND THAT PROPERTY IS THE INSTRUMENT, NOT JUST A COURTESY. Each field off against the row
  // live, over a set of cameras, is the only thing that answers whether a part is DOING anything
  // — no headless gate here reaches a rasteriser, and the eye cannot tell four faces from none.
  // It caught `covertStep` shipping as a no-op: at its first coefficient the two rows covered a
  // tenth of a panel already only a twentieth of a unit deep, measured 0.00% in three views of
  // five, and looked completely reasonable in the preview. Per cent of frame moved, at the
  // authored values:
  //
  //             air 3/4 front   air above   below 3/4   walk side   raft side
  //   wingSlots      2.04          8.37         8.03        —           —
  //   wingCamber     2.16          2.71         1.68        —           —
  //   covertStep      —             —            —         0.81        0.82
  //   rumpTaper      0.79          0.82          —         1.63        2.37
  //   undertail      0.02          0.06         0.25       0.02         —
  //
  // ⚠ READ THAT LAST ROW AS A WARNING ABOUT THE CAMERA RATHER THAN ABOUT THE PART. Every number
  // in this file was first taken from ABOVE, where a marking on a bird's underside is behind the
  // bird, and the undertail coverts measured 0.02% and were very nearly cut for not earning their
  // one face. A goose is almost always seen from BELOW — you are standing under it, or flying
  // under the skein — and from there it is ten times that. Measure a ventral part from a ventral
  // camera, or the measurement is an argument for deleting it.
  const slots = clampN(Math.round(p.wingSlots ?? 0), 0, 6);   // separated primary tips, per wing
  const slotSp = clampN(p.slotSpread ?? 0, 0, 1);             // how far they fan and rise
  const camber = clampN(p.wingCamber ?? 0, 0, 0.4);           // mid-chord lift above the chord line
  const covStep = clampN(p.covertStep ?? 0, 0, 1);            // covert/scapular inset, folded wing
  const utLen = clampN(p.undertailLen ?? 0, 0, 0.3);          // the white wedge under the tail
  const rumpT = clampN(p.rumpTaper ?? 0, 0, 1);               // how hard the body draws in aft
  // ── ANATOMY TOGGLES — what makes this bird a different bird ────────────────
  const neckSegs = clampN(Math.round(p.neckSegs ?? 2), 0, 2);  // 2 goose, 1 gull, 0 songbird
  const chinstrap = p.chinstrap !== false;                     // the goose's white cheek patch
  const billHook = !!p.billHook;                               // gull and raptor; flat on a goose
  const webbed = p.webbedFeet !== false;                       // a web, or three toes
  const tailNotch = clampN(p.tailNotch ?? 0, -1, 1);           // -1 forked, 0 square, +1 fanned
  // ⚠ HOW HIGH THE TAIL IS CARRIED IS A SPECIES FACT, and until this it was one number for every
  // bird. A wren or a sparrow cocks its tail well above the line of its back — it is most of what
  // says "small bird" at a glance, and it is the silhouette a murmuration is made of — where a
  // hawk on a perch carries one almost level with its body. 1 is the angle every bird here was
  // drawn at, so an unset row is the bird that shipped.
  //
  // ⚠ IT PIVOTS AT THE ROOT rather than lifting the whole fan, or a cocked tail detaches from the
  // rump it grows out of. The root z is untouched and only the trailing edge rises.
  const tailCock = clampN(p.tailCock ?? 1, 0, 3);
  const crownCol = typeof p.crownCol === 'string';             // a cap, painted on the head's top facets
  // ⚠ THE EYE IS A FRACTION OF THE HEAD, NEVER A LENGTH. Authored in model units it is an eye on
  // a goose and a whole face on a sparrow, whose head is a quarter the size — the same trap the
  // ⚠ on the primaries' `WIDE` records for a slot. 0 is no eye at all and no faces spent.
  const eyeF = clampN(p.eyeR ?? 0, 0, 0.5);
  // ⚠ A BILL'S WIDTH WAS WELDED TO THE SKULL'S DEPTH, which is most of a bill and not all of
  // it: a heron and a duck have the same head and nothing like the same beak. It only ever mattered
  // once the heads started differing -- widening the songbird's skull for the perching-bird look
  // made its bill 57% WIDER at the same length, and at 0.018 long by 0.037 across the thing was
  // twice as wide as it was long. That is not a beak, it is a flat stub, and it read as the bird
  // not having one. 0.42 is what every row was built at, so an unset one does not move.
  const billW = clampN(p.billW ?? 0.42, 0.1, 0.9);
  // How far the pale underside climbs the flank. 0 is the bird that shipped: no body facet takes
  // the belly colour at all and the only pale front is the keel sheet below.
  const bellyWrap = clampN(p.bellyWrap ?? 0, 0, 1);
  const botR = bellyWrap > 0.01 ? 'belly' : null, botCut = -(1 - bellyWrap);
  const sides = clampN(Math.round(p.bodySides ?? 8), 4, 8);    // the body's cross-section
  // -- POSTURE: HOW THE BODY IS CARRIED ------------------------------------
  // ⚠ THE SILHOUETTES WERE ALL THE SAME EGG, AND THIS IS THE REASON. Every bird in this file
  // was built with its body axis lying along f, so the ONLY thing that could differ between two
  // species was the neck -- which is why the goose reads as a goose and the other five read as one
  // animal at five sizes. It is not a detail problem and no amount of feathering fixes it: a hawk
  // on a post stands its body up near vertical, a gull carries one nearly level, a pigeon tips
  // forward onto its breast, and those are the shapes you name them by at fifty yards.
  //
  // Radians, positive nose-UP, about the shoulder. 0 is every bird that shipped before it.
  //
  // ⚠ GROUND POSES ONLY. In the air a body is aligned with where it is going by definition, and
  // a flying bird's silhouette is its WING PLANFORM instead -- 'span' over 'chord', already
  // authored, and retuned in the same pass as this.
  const pitch = air ? 0 : clampN(p.bodyPitch ?? 0, -0.5, 0.9);
  const cp = Math.cos(pitch), sp2 = Math.sin(pitch);
  const tilt = (v) => (pitch ? V(v[0] * cp - v[2] * sp2, v[1], v[0] * sp2 + v[2] * cp) : v);
  // ⚠ THE TORSO TURNS AND THE LEGS AND NECK DO NOT, which is the whole of why this rotates SOME
  // roles rather than the mesh. A bird standing up straighter does not lift its feet off the
  // ground or point its face at the sky -- the tarsus takes up the angle at the hip and the neck
  // takes it up at the shoulder, which is what a bird's neck is FOR. Rotate everything and you get
  // an animal tipped onto its nose staring upwards.
  const TORSO = new Set(['body', 'belly', 'undertail', 'patch', 'wing']);

  // BODY — two segments, fattest at the shoulder and drawn in toward the tail, on an EIGHT-sided
  // elliptical section.
  //
  // ⚠ SIX SIDES PUT A FLAT FACE ON THE BACK, which is what made it read as slab-sided from above.
  // `tube` starts its ring on the horizontal axis, so at six sides the vertices land at ±g and at
  // ±60° from it — there is a VERTEX at each flank and a FACE spanning the whole top. Seen from the
  // elevation these poses are baked at, that face is most of the bird. Eight sides put a vertex on
  // the spine and on the keel instead, so the back reads as a ridge falling away either side, which
  // is what a goose's back does. Four faces more; they cost nothing but bake time.
  const sq = bodyH / bodyW;
  // ⚠ THE RUMP IS A CONE, NOT A SHORTER CYLINDER. `rumpTaper` draws the rear tube's end in and
  // carries it on to a POINT at the root of the tail, because a goose's back end is a wedge and
  // the truncated barrel that was there read as a bird with its tail sawn off — most visible from
  // behind and above, which on a circuit is a good half of the time you see one. Four sides
  // rather than eight: it is a small part and it is the one part the eight-sided rule at the
  // ⚠ below does not need, since nothing here has a broad top face to go flat.
  const rumpR = bodyW * 0.40 * (1 - 0.55 * rumpT);
  const rumpF = -bodyLen + bodyLen * 0.10 * rumpT;
  tube(faces, V(rumpF, 0, bodyH * 0.10), V(0, 0, 0), rumpR, bodyW, 'body', 1, sides, sq, null, botR, botCut);
  tube(faces, V(0, 0, 0), V(bodyLen * 0.78, 0, bodyH * 0.16), bodyW, bodyW * 0.66, 'body', 1, sides, sq, null, botR, botCut);
  if (rumpT > 0.01) {
    tube(faces, V(rumpF, 0, bodyH * 0.10), V(-bodyLen - tailLen * 0.10, 0, bodyH * 0.16),
      rumpR, rumpR * 0.14, 'body', 0.96, 4, sq);
  }
  // The pale breast and belly, said in the other colour: a sheet tucked just inside the barrel's
  // underside rather than a second tube, because a bird's pale front is a marking and not a part.
  // ⚠ INSIDE the silhouette, not below it — a sheet at the full radius pokes through the curve it
  // is meant to be lying on and reads as a white flap hanging off the bird.
  sheet(faces, [V(-bodyLen * 0.55, -bodyW * 0.30, -bodyH * 0.72), V(bodyLen * 0.62, -bodyW * 0.28, -bodyH * 0.50),
    V(bodyLen * 0.62, bodyW * 0.28, -bodyH * 0.50), V(-bodyLen * 0.55, bodyW * 0.30, -bodyH * 0.72)], 'belly', 1);

  // TAIL — a short stiff fan, cocked up. ⚠ Cocked ENOUGH to catch the light: a flat horizontal
  // plate is seen nearly edge-on from every viewpoint this thing bakes at, so it draws as a bare
  // spike rather than as a tail. The angle is what makes it a surface.
  // ⚠ ONE SIGNED FIELD, THREE TAILS. `tailNotch` is -1 forked, 0 square, +1 a broad fan, and it
  // interpolates — which is both why it is not an enum (the schema would not take one) and why it
  // is nicer to author than three separate shapes. The trailing edge is what moves: a fork pulls
  // the CENTRE in toward the body, a fan pushes the corners out and back.
  {
    // ⚠ THE MID VERTEX MUST LIE ON THE STRAIGHT EDGE AT NOTCH 0, or a square tail is not
    // square. Written with its own constants (z at 0.58 where the tips are at 0.62) the
    // extra point sat BELOW the line it is meant to be on, so every goose in the world
    // quietly grew a notched tail out of a change that was supposed to be inert for it.
    // Both of its coordinates are interpolated from the tips now, and the deviation is
    // zero by arithmetic rather than by a number that happens to look close.
    const fan = Math.max(0, tailNotch), fork = Math.max(0, -tailNotch);
    const tipW = tailW * (1 + 0.5 * fan);
    const tipF = -bodyLen - tailLen * (1 + 0.15 * fan);
    // The trailing edge's height, which is the one thing `tailCock` moves — the mid vertex is
    // interpolated from it exactly as before, so a square tail is still square at any angle.
    const tipZ = bodyH * 0.62 * tailCock;
    const midF = tipF + (bodyLen * 0.86 * -1 - tipF) * (0.5 * fork);
    const midZ = tipZ + (bodyH * 0.02 - tipZ) * (0.5 * fork);
    sheet(faces, [V(-bodyLen * 0.86, -tailW * 0.55, bodyH * 0.02), V(tipF, -tipW, tipZ),
      V(midF, 0, midZ), V(tipF, tipW, tipZ),
      V(-bodyLen * 0.86, tailW * 0.55, bodyH * 0.02)], 'wing', 0.82);
  }

  // UNDERTAIL COVERTS — the white under the base of the tail, and the one marking on this bird
  // you can see from directly astern, which is the view a pilot overhauling a skein gets.
  //
  // ⚠ IT IS CANTED, for exactly the reason the tail fan above it is and the folded web below it
  // is: a flat horizontal plate is seen nearly edge-on from every elevation a bird is drawn at,
  // contributes no area, and is a face spent on nothing. Tipped the other way from the tail, it
  // reads as the wedge that closes the rump — and the gap between the two is what makes the tail
  // look like a separate thing lying on top rather than part of the same slab.
  // ⚠ AND IT ENDS AT THE RUMP, NOT PAST IT. Written as `-bodyLen - utLen` it ran up to three
  // quarters of its own length beyond the point the tapered rump closes at, and a pale wedge
  // hanging in the air off the back of a bird reads as a shard of something else — it is what the
  // white slivers astern of the walking pose were. The coverts lie UNDER a rump, so the far end is
  // the rump's own tip and `undertailLen` says how far FORWARD of it they start.
  if (utLen > 0.005) {
    const utAft = -bodyLen - tailLen * 0.10, utFore = utAft + Math.max(utLen, 0.02);
    sheet(faces, [V(utFore, -tailW * 0.62, -bodyH * 0.22),
      V(utAft, -tailW * 0.18, bodyH * 0.02),
      V(utAft, tailW * 0.18, bodyH * 0.02),
      V(utFore, tailW * 0.62, -bodyH * 0.22)], 'undertail', 1);
  }

  // NECK — two segments. Standing, it rises and holds the head high; flying, it reaches straight
  // out and a shade below level, which is most of what tells the two silhouettes apart at range.
  // ⚠ A HEAD CANNOT BE INSIDE THE CHEST, and the standing formula does not guarantee it.
  // `bodyLen * 0.5 + neckLen * 0.45` is tuned for a long neck: at the goose's 0.4 it puts
  // the head 0.085 AHEAD of the body's nose, and at a gull's 0.14 it lands 0.021 BEHIND
  // it — so the head is drawn overlapping the shoulders and reads as a box floating free
  // of the bird, which is exactly what it looked like. The floor below is a no-op for
  // every long neck (the goose is unchanged to the last decimal) and only bites on the
  // short ones the formula was never written for.
  // ⚠ AND A BIRD WITH NO NECK NEEDS THE FLOOR THE OTHER WAY UP. The floor above was written for a
  // head on the end of something: it holds the skull clear of the chest by half a neck. A songbird
  // has `neckSegs: 0` and so has NO neck tube at all — nothing is drawn between the shoulders and
  // the head — so clearing the chest by half a neck width leaves a measured 0.006 of daylight with
  // nothing to bridge it, and the head floats off the front of the bird. A head sitting ON the
  // shoulders is a head partly INSIDE them, which is what every reference photograph shows and
  // what these two figures say: every other species already overlaps its body by 0.03-0.05, and
  // the songbird was the one that did not.
  const chin = neckSegs ? bodyLen * 0.78 + neckW * 0.5 : bodyLen * 0.78 - neckW * 0.8;
  // ⚠ THE NECK HANGS OFF THE SHOULDER THE TORSO ACTUALLY ENDED UP AT, so its two upper points
  // are OFFSETS from that base rather than absolute positions. Left absolute, a tilted body swings
  // its shoulder up and back out from under a neck that stayed where it was and the head detaches
  // -- the defect the head-overlap gate was added for, arriving by a different road.
  const nb = tilt(V(bodyLen * 0.7, 0, bodyH * 0.35));
  const off = (f, h) => V(nb[0] + f - bodyLen * 0.7, 0, nb[2] + h - bodyH * 0.35);
  // ⚠ AND THE AIR POSE NEEDS THE SAME NO-NECK RULE THE GROUND POSE GOT. It reaches the head
  // straight out by a whole 'neckLen' -- which is right for a bird that DRAWS a neck between the
  // two, and for one with 'neckSegs: 0' it is the head hanging in front of the shoulders with
  // nothing joining them. The ground pose learned this already; this is the same fix in the pose
  // nobody looked at, and the head-overlap gate is what found it.
  //
  // ⚠ BOTH POINTS SCALE OR THE HEAD FACES BACKWARDS. The head's direction is 'nt - nm', so
  // pulling the tip in past the mid point reverses it and the bird flies looking over its own
  // shoulder -- which is not a silent failure, but it is an odd-looking one to debug.
  const nk = neckSegs ? 1 : 0.3;
  const nm = air ? V(bodyLen * 0.7 + neckLen * 0.5 * nk, 0, bodyH * 0.18)
    : off(Math.max(bodyLen * 0.55 + neckLen * 0.25, chin - neckLen * 0.35), bodyH * 0.35 + neckRise * 0.62);
  const nt = air ? V(bodyLen * 0.7 + neckLen * nk, 0, bodyH * 0.02)
    : off(Math.max(bodyLen * 0.5 + neckLen * 0.45, chin), bodyH * 0.35 + neckRise);
  // ⚠ THE SEGMENT COUNT IS THE SPECIES, AND THE SHAPE FOLLOWS IT. A goose is mostly
  // neck and takes two segments so it can bend; a gull's is short and straight and one
  // segment says it better than two nearly-collinear ones; a bird with none has its head
  // sitting on its shoulders, which is what a songbird and a pigeon look like. The
  // ⚠ below about the head not carrying on up the neck's line still applies to all three
  // — it is about how a bird LOOKS along the ground, not about how long its neck is.
  if (neckSegs >= 2) {
    tube(faces, nb, nm, neckW * 1.5, neckW, 'neck', 0.95, 3);
    tube(faces, nm, nt, neckW, neckW * 0.92, 'neck', 1, 3);
  } else if (neckSegs === 1) {
    tube(faces, nb, nt, neckW * 1.5, neckW * 0.92, 'neck', 1, 3);
  }

  // HEAD — a small block on the end of the neck.
  //
  // ⚠ IT DOES NOT CARRY ON UP THE NECK'S LINE. A standing goose's neck rises almost vertically and
  // then the head turns over the top of it and looks ALONG the ground — that right angle is the
  // whole silhouette. Pointing the head where the neck was going gives a bird staring at the sky
  // with its bill up like a spike, which is a heron at best.
  const dir = [nt[0] - nm[0], 0, nt[2] - nm[2]];
  const dl = Math.hypot(dir[0], dir[2]) || 1;
  const hx = dir[0] / dl, hz = dir[2] / dl;
  const fx = air ? hx : 1, fz = air ? hz : -0.08;
  const hEnd = V(nt[0] + fx * headLen, 0, nt[2] + fz * headLen);
  tube(faces, nt, hEnd, neckW * 1.15, headH, 'head', 1, 4, 1, crownCol ? 'crown' : null);
  // EYE — one small quad a side, set into the flank of the head and standing a hair proud of it.
  //
  // ⚠ IT IS THE THING EVERY REFERENCE HAS AND THIS FILE HAD NOT, and a bird without one does not
  // read as an animal at all — it reads as a shape. Two faces is a real price at the range a
  // murmuration is seen from, so it is a field rather than a part: a row that does not ask for one
  // builds the bird that shipped, face for face.
  //
  // ⚠ IT SITS FORWARD ON THE HEAD, not in the middle. A bird's eye is close behind the bill, and
  // placed at the centre of the skull it reads as an ear.
  const eyeR = eyeF * headLen;
  if (eyeF > 0.01) {
    const eF = 0.34;                                           // along the head, from the nape
    const cF = nt[0] + (hEnd[0] - nt[0]) * eF, cZ = nt[2] + (hEnd[2] - nt[2]) * eF + headH * 0.22;
    // The head's own half-width where the eye lands, so the marking lies ON the skull at any size.
    const hw = (neckW * 1.15) + (headH - neckW * 1.15) * eF;
    for (const s of [1, -1]) {
      sheet(faces, [V(cF + eyeR, s * hw * 1.02, cZ), V(cF, s * hw * 1.04, cZ + eyeR),
        V(cF - eyeR, s * hw * 1.02, cZ), V(cF, s * hw * 1.04, cZ - eyeR)], 'eye', 1);
    }
  }
  // CHINSTRAP — the white patch under the cheek, one sheet a side. The single most recognisable
  // thing about a Canada goose and worth two faces at any size — and worth NOTHING on a bird that
  // has not got one, where it reads as a stripe of the wrong colour down the side of the head.
  if (chinstrap) for (const s of [1, -1]) {
    sheet(faces, [V(nt[0] + fx * headLen * 0.15, s * headH * 0.8, nt[2] + fz * headLen * 0.15 - headH * 0.25),
      V(hEnd[0] - fx * headLen * 0.1, s * headH * 0.7, hEnd[2] - headH * 0.55),
      V(hEnd[0] - fx * headLen * 0.1, s * headH * 0.55, hEnd[2] + headH * 0.1),
      V(nt[0] + fx * headLen * 0.15, s * headH * 0.6, nt[2] + fz * headLen * 0.15 + headH * 0.2)], 'cheek', 1);
  }
  // BILL — a flat wedge off the front of the head, or a hooked one.
  //
  // ⚠ THE HOOK IS THE TIP DROPPING, NOT A LONGER BILL. A gull and a raptor both carry a
  // straight bill that turns down in the last fifth; lengthening it instead gives a
  // wader, which is a different bird entirely. One extra face, and only when asked.
  const bEnd = V(hEnd[0] + fx * billLen, 0, hEnd[2] + fz * billLen - headH * 0.12);
  const bw = headH * billW;
  sheet(faces, [V(hEnd[0], -bw, hEnd[2] + headH * 0.1), bEnd, V(hEnd[0], bw, hEnd[2] + headH * 0.1)], 'bill', 1);
  sheet(faces, [V(hEnd[0], -bw, hEnd[2] - headH * 0.2), bEnd, V(hEnd[0], bw, hEnd[2] - headH * 0.2)], 'bill', 0.8);
  if (billHook) {
    const hk = V(bEnd[0] + fx * billLen * 0.22, 0, bEnd[2] - headH * 0.42);
    sheet(faces, [V(bEnd[0] - fx * billLen * 0.3, -bw * 0.48, bEnd[2] + headH * 0.06), hk,
      V(bEnd[0] - fx * billLen * 0.3, bw * 0.48, bEnd[2] + headH * 0.06)], 'bill', 0.92);
  }

  // WINGS — two panels a side. Flying, they reach out at the beat's dihedral; on the ground they
  // fold back along the flanks, which is why a walking goose is a narrow shape and a flying one
  // is a wide one.
  const dih = air ? flapArc * (dihK == null ? WING_DIHEDRAL[clampN(wing | 0, 0, 2)] : dihK) : 0;
  for (const s of [1, -1]) {
    if (air) {
      // ⚠ THE WING BENDS AT THE ELBOW, and without that it is a plank. The inner panel and the
      // outer one used to share ONE dihedral, so the two lifted along a straight line and the
      // wings-up pose drew as a flat V — a broad slab hinged at the shoulder. A real wing is
      // cupped: the hand carries further than the arm, which is the whole shape of a downstroke
      // and of the flick at the top of the recovery. `wingCup` is how much further, and at level
      // (dih 0) it contributes exactly nothing, so the mid-beat silhouette is untouched.
      const dihTip = dih * (1 + cup);
      const midG = span * 0.5, tipG = span;
      const midZ = Math.sin(dih) * midG * 0.9, tipZ = Math.sin(dihTip) * tipG;
      const rootF = bodyLen * 0.35, midF = rootF - sweep * 0.4, tipF = rootF - sweep;
      const sh0 = s > 0 ? 1 : 0.82, sh1 = s > 0 ? 0.92 : 0.74;
      // The inner panel — the arm. Broad at the shoulder, already narrowing at the elbow.
      const leRoot = V(rootF, s * bodyW * 0.7, bodyH * 0.3);
      const leMid = V(midF, s * midG, midZ + bodyH * 0.25);
      const teMid = V(midF - chord * 0.72, s * midG, midZ + bodyH * 0.2);
      const teRoot = V(rootF - chord, s * bodyW * 0.7, bodyH * 0.22);
      // ⚠ CAMBER IS A SPAR ALONG THE MID-CHORD, NOT A SECOND SURFACE UNDERNEATH. The ⚠ two
      // paragraphs down records what a shape of its own under a wing costs; this is the other
      // reading of the same sentence — the arm is SPLIT at mid-chord and the seam is lifted, so
      // the two strips are built from the panel's own four corners and cannot be a pale cone,
      // because there is no extra outline to be one. At camber 0 the seam is exactly on the flat
      // panel, so the split is skipped outright and the pose is the one that shipped.
      if (camber > 0.005) {
        const spar = (a, b, k) => V((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + camber * chord * k);
        // Less lift at the elbow than at the shoulder: a wing flattens as it runs out to the hand,
        // and an even spar bends the tip up as much as the root, which reads as a warp.
        const spRoot = spar(leRoot, teRoot, 1), spMid = spar(leMid, teMid, 0.7);
        sheet(faces, [leRoot, leMid, spMid, spRoot], 'wing', sh0);
        sheet(faces, [spRoot, spMid, teMid, teRoot], 'wing', sh0 * 0.93);
      } else {
        sheet(faces, [leRoot, leMid, teMid, teRoot], 'wing', sh0);
      }
      // The outer panel — the primaries. A TRIANGLE to the tip rather than a quad, because a goose
      // wing comes to a point and a blunt-ended outer panel is the other half of why this read as a
      // plank. The trailing edge runs from the elbow straight to the tip.
      const tipP = V(tipF, s * tipG, tipZ + bodyH * 0.2);
      if (slots < 1) {
        sheet(faces, [leMid, tipP, teMid], 'wing', sh1);
      } else {
        // ⚠ THE FINGERS ARE THE HAND SPLIT UP, NOT SPIKES ADDED TO A WHOLE ONE. The outer panel
        // keeps its area and its outline — what changes is that past the wrist it is cut into
        // `wingSlots` tapered feathers that fan and lift instead of closing into one point. Bolted
        // on outside the existing triangle they read as a comb, which is a fan, which is a
        // different bird; cut out of it they read as the gap between primaries, which is the thing
        // the photographs actually show.
        const lerpV = (a, b, t) => V(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
        // ⚠ THE WRIST IS FAR OUT, BECAUSE A LONG THIN TRIANGLE IS A SPIKE. At 0.45 each feather was
        // over half the outer panel long and a quarter of the wrist chord wide, and the raised and
        // dropped poses came out as a crown of black thorns off the shoulder rather than as a hand
        // — the same failure the ⚠ on WING_DIHEDRAL records for the beat itself, arrived at from
        // the other direction. Past two thirds the feathers are short and broad, which is what a
        // primary is.
        const WRIST = 0.70;
        const wLe = lerpV(leMid, tipP, WRIST), wTe = lerpV(teMid, tipP, WRIST);
        sheet(faces, [leMid, wLe, wTe, teMid], 'wing', sh1);
        // The chord at the wrist, which is what the fan is measured in and what each feather is
        // pushed apart along. A separation in world units would be a slot the size of a finger on
        // a sparrow and the size of a plank on a goose.
        const cx = wTe[0] - wLe[0], cy = wTe[1] - wLe[1], cz = wTe[2] - wLe[2];
        // ⚠ THE FEATHERS OVERLAP RATHER THAN PARTITION. Cut into `slots` abutting strips they are
        // separate objects with gaps between them, which is a comb; a real primary lies OVER the
        // one behind it, so each base is widened past its own share and the neighbours run into
        // each other. It is also what stops the count changing how wide a feather is.
        const WIDE = 2.4;
        for (let k = 0; k < slots; k++) {
          const mid = (k + 0.5) / slots, half = WIDE / (2 * slots);
          const t0 = clampN(mid - half, 0, 1), t1 = clampN(mid + half, 0, 1);
          const b0 = lerpV(wLe, wTe, t0), b1 = lerpV(wLe, wTe, t1);
          const u = slots > 1 ? k / (slots - 1) : 0;         // 0 at the leading edge, 1 at the trailing
          // The leading finger is the longest and the trailing ones fall away behind it — which is
          // the shape of a hand, and is what stops a fan of equal spikes reading as a rake.
          const reach = 1 - 0.34 * u;
          const fan = (u - 0.5) * slotSp * 0.55;             // apart along the chord
          // ⚠ AND THE SPLAY FADES AS THE WING SWINGS. `rise` is in world h, and at the top and
          // bottom of the beat the wing is steep enough that h runs nearly ALONG its span — so a
          // fixed lift stopped separating the feathers and started throwing them outboard, which
          // compounds with the dihedral and is the other half of why these read as thorns. The
          // cosine is 1 at level, where the fan is the thing you can actually see.
          const rise = slotSp * span * 0.085 * (1 - u) * Math.cos(dih);
          const ft = V(b0[0] + (tipP[0] - b0[0]) * reach + cx * fan,
            b0[1] + (tipP[1] - b0[1]) * reach + cy * fan,
            b0[2] + (tipP[2] - b0[2]) * reach + cz * fan + rise);
          sheet(faces, [b0, ft, b1], 'primary', sh1 * (0.96 - 0.08 * u));
        }
      }
      // ⚠ NO PALE UNDERSIDE SHEET. One was tried — the reasoning being that these poses bake from
      // BELOW, so the surface facing you on a raised wing is the underside and a real bird's is the
      // pale one. Measured, it was worse than what it replaced: a quad spanning root to tip in the
      // belly colour is a large area, the depth sort correctly puts it in FRONT when seen from
      // below, and the recovery pose became a pale cone. If the wing ever needs two tones it has to
      // be the same shape as the panels it lies under, not a shape of its own.
    } else {
      // Folded: a closed wing lies ON the flank and its tip trails past the rump. ⚠ It is a
      // MARKING-SIZED panel, not a slab — a folded wing drawn at the body's full length and depth
      // covers the barrel it is supposed to be resting on, and the bird stops reading as round.
      const fSh = s > 0 ? 0.98 : 0.76;
      sheet(faces, [V(bodyLen * 0.34, s * bodyW * 0.92, bodyH * 0.24), V(-bodyLen * 0.42, s * bodyW * 0.9, bodyH * 0.22),
        V(-bodyLen - tailLen * 0.25, s * bodyW * 0.40, bodyH * 0.02), V(-bodyLen * 0.30, s * bodyW * 0.94, -bodyH * 0.30),
        V(bodyLen * 0.30, s * bodyW * 0.94, -bodyH * 0.10)],
      'wing', fSh);
      // COVERTS AND SCAPULARS — two stepped rows lying along the top of the closed wing.
      //
      // ⚠ THEY SUBDIVIDE THE PANEL ABOVE, AND MUST NEVER EXTEND IT. The ⚠ on that panel records
      // why it is marking-sized: a folded wing at the body's full depth covers the barrel it is
      // supposed to be resting on and the bird stops reading as round. A feather row hung off its
      // edge puts that straight back, so both bands are cut from the panel's own corners and lie
      // strictly inside it.
      //
      // ⚠ AND THE READ IS THE SHADE, NOT A COLOUR. There is deliberately no `covertCol` — see the
      // ⚠ in ROLE_FIELD. What says "feathers" here is the step of shadow under each row, which
      // `sheet` already takes as an argument, and at the size a bird is drawn a third hue would be
      // a field in every species file for a difference nobody can resolve.
      if (covStep > 0.01) {
        const tF = V(bodyLen * 0.34, s * bodyW * 0.97, bodyH * 0.24);
        const tA = V(-bodyLen * 0.42, s * bodyW * 0.95, bodyH * 0.22);
        const bF = V(bodyLen * 0.30, s * bodyW * 0.99, -bodyH * 0.10);
        const bA = V(-bodyLen * 0.30, s * bodyW * 0.99, -bodyH * 0.30);
        const down = (a, b, t) => V(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
        // ⚠ A ROW IS A THIRD OF THE WING, NOT A PINSTRIPE. At `covStep * 0.30` each band covered a
        // tenth of a panel that is only about a twentieth of a model unit deep to begin with, so
        // the two of them came to three pixels at preview size and MEASURED AT ZERO in three of
        // five views — four faces buying nothing, which is the failure a role census cannot see
        // and only an A/B can. The scapulars and the coverts between them cover most of a closed
        // wing on a real bird; what is left uncovered at the bottom is the primaries showing.
        const step = covStep * 0.40;
        for (let k = 0; k < 2; k++) {
          const t0 = k * step, t1 = (k + 1) * step;
          sheet(faces, [down(tF, bF, t0), down(tA, bA, t0), down(tA, bA, t1), down(tF, bF, t1)],
            'wing', fSh * (0.88 - 0.10 * k));
        }
      }
    }
  }

  // LEGS — two, in the air as well as on the ground, and what changes is where they are put.
  //
  // ⚠ A FLYING BIRD USED TO HAVE NONE AT ALL, on the grounds that a tucked leg is a stray dark
  // pixel rather than a leg. That is true of the TARSUS and false of the FOOT: what shows under a
  // goose in cruise is the black webs folded up against the undertail, trailing back past the
  // vent, and it is one of the few things about the silhouette that says which way the animal is
  // going. Left off, it did not read as a bird with its feet tucked away. It read as a bird with
  // no feet.
  //
  // ⚠ AND THE GEAR COMES DOWN FOR THE LANDING. `gear` swings the legs forward of the hip and
  // splays the webs into paddles, which is the whole shape of a goose on short finals — it puts
  // its feet out ahead of itself and lets the ground catch them. It is a SEPARATE flag from
  // `flare`, deliberately: the flare is the last second of the descent and exists to keep the
  // downstroke out of the turf, and a bird has its feet down a long way before that. One flag for
  // both would have meant retuning the wingbeat in order to fix the feet.
  //
  // ⚠ IT IS BINARY, AND THE SNAP IS THE POINT rather than a corner cut. Putting the gear down is a
  // thing a bird DOES, at a moment, and it does it at the far end of the circuit where it is a few
  // pixels across. Every intermediate position would be another dimension on a pose table that
  // already carries sixteen beats and a flare variant of each.
  //
  // ⚠ THE EXTENDED FOOT SITS AT THE WALKER'S OWN `footZ`, which is what keeps the swap at touchdown
  // continuous in the one axis anybody would notice. Both states take the same origin lift (below),
  // so z = 0 is the sole of the foot in each: a bird in the flare has its feet exactly where it is
  // about to be standing, and the pose change moves nothing.
  //
  // ⚠ RAFTING STILL HAS NONE, and that is a different rule rather than the old one surviving. A
  // bird on the water has its legs under it IN the water and the waterline cuts the body, so a leg
  // drawn there is a dark smear below the surface.
  if (state !== 'raft') {
    const hipF = -bodyLen * 0.05, footZ = -bodyH - legLen;
    const air = state === 'air';
    for (const s of [1, -1]) {
      if (!air || gear) {
        // Standing, or reaching for the ground. The landing stance is a shade wider than the
        // walking one and the ankle is AHEAD of the hip rather than behind it, which is the
        // difference between a bird about to touch down and one already walking about.
        const ankF = hipF + (air ? legLen * 0.55 : -legLen * 0.12);
        const gy = bodyW * (air ? 0.62 : 0.5);
        const fw = footLen * (air ? 1.15 : 0.7), fb = footLen * (air ? 0.28 : 0.3), fs = footLen * (air ? 0.52 : 0.35);
        const hip = tilt(V(hipF, 0, -bodyH * 0.6));
        tube(faces, V(hip[0], s * bodyW * 0.45, hip[2]), V(ankF, s * gy, footZ), legW * 1.4, legW, 'leg', 0.9, 3);
        if (webbed) {
          sheet(faces, [V(ankF + fw, s * gy, footZ + (air ? footLen * 0.42 : 0)),
            V(ankF - fb, s * (gy + fs), footZ), V(ankF - fb, s * (gy - fs), footZ)], 'leg', 1);
        } else {
          // ⚠ TOES ARE THE SAME AREA SPLIT THREE WAYS, NOT THREE FEET. A web is one
          // triangle because a web IS one surface; an unwebbed foot is three narrow ones
          // fanning from the same ankle, and drawn at a web's width each it reads as a
          // bird standing on dinner plates. Same total spread, three slivers inside it.
          for (const t of [-1, 0, 1]) {
            const sp = fs * 0.85 * t;
            sheet(faces, [V(ankF - fb, s * gy, footZ + legW * 0.6),
              V(ankF + fw * (t === 0 ? 1 : 0.82), s * (gy + sp), footZ),
              V(ankF - fb, s * gy, footZ - legW * 0.6)], 'leg', t === 0 ? 1 : 0.88);
          }
        }
      } else {
        // Folded away: the tarsus lies back along the flank and the web closes into a slim blade
        // under the rump. It runs from about the vent to the root of the tail — far enough aft to
        // read as feet trailing behind the bird, nowhere near far enough to reach the tail fan.
        const ank = V(-bodyLen * 0.62, s * bodyW * 0.30, -bodyH * 0.72);
        tube(faces, V(hipF, s * bodyW * 0.42, -bodyH * 0.6), ank, legW * 1.4, legW * 0.9, 'leg', 0.9, 3);
        // ⚠ THE BLADE IS CANTED, for the reason the tail fan is. A folded web lying flat is seen
        // nearly edge-on from every elevation these birds are drawn at and contributes no area at
        // all; tipped, it is a dark wedge under the rump, which is the read.
        sheet(faces, [V(ank[0], s * (bodyW * 0.30 + legW * 0.9), ank[2] + legW * 1.5),
          V(ank[0] - footLen * 1.05, s * (bodyW * 0.30 - footLen * 0.06), ank[2] + footLen * 0.20),
          V(ank[0], s * (bodyW * 0.30 - legW * 0.9), ank[2] - legW * 1.5)], 'leg', 1);
      }
    }
  }

  // BLOTCHES — the plumage gone wrong in patches. Deterministic off the index, never random: two
  // bakes of one pose must be the same picture or the cache serves whichever won the race.
  // ⚠ SMALL, AND HIGH ON THE SHOULDER. A blotch the size of the body is a two-tone bird, which is
  // a different animal; what is wanted is plumage that has gone wrong in places, so each one is
  // about a fifth of the barrel and they sit where a wing does not already cover.
  const nPatch = clampN(Math.round(p.patches ?? 0), 0, 6);
  const patchScale = clampN(p.patchScale ?? 1, 0.15, 2);
  for (let i = 0; i < nPatch; i++) {
    const t = (i + 0.5) / nPatch, s = i % 2 ? 1 : -1;
    const cf = bodyLen * (0.5 - t * 1.05), cz = bodyH * (0.62 - (i % 3) * 0.24);
    // ⚠ A BLOTCH AND A SPECKLE ARE THE SAME PART AT TWO SIZES. The figures here were chosen for
    // plumage that has gone wrong in patches -- about a fifth of the barrel each -- and a starling
    // is covered in small pale STARS, which is the same marking an order of magnitude smaller and
    // more of them. Drawn at blotch size they read as three cream tiles stuck to a dark bird.
    // 1 is every row that predates the field.
    const r = bodyR * (0.17 + ((i * 7) % 5) * 0.022) * patchScale;
    sheet(faces, [V(cf + r, s * bodyW * 0.86, cz), V(cf, s * bodyW * 0.93, cz + r * 0.8),
      V(cf - r, s * bodyW * 0.86, cz), V(cf, s * bodyW * 0.93, cz - r * 0.8)], 'patch', 0.95);
  }

  // ⚠ THE ORIGIN IS WHERE THE ANIMAL MEETS THE WORLD, and the mesh is shifted to make that true
  // rather than the caller being told to work it out. A billboard anchors on a ground contact
  // point, so h = 0 has to BE that contact: the soles of the feet for a walker, the waterline for
  // a rafting bird, which cuts the body, because that is what floating is. Leave them at the body
  // centre and every walking goose is buried to its knees.
  //
  // ⚠ AND THE AIR POSE TAKES THE WALKER'S LIFT, WHICH IT DIDN'T UNTIL THIS LINE. It sat at the
  // body centre, on the grounds that a flying bird has no ground contact so the centre of mass is
  // the honest choice — and that made `z` mean one thing on the grass and another in the air. The
  // circuit's altitude ramps to exactly 0 at both ends (`bump` in birds.js), so at touchdown a
  // bird was drawn with its BODY AXIS on the turf and everything below it clipped by the
  // depth-tested ground: 85% of a wings-down card, which is "the geese almost disappear below the
  // ground on landing, just the top of the heads visible". One expression shared with the walker
  // is also what makes the pose swap at touchdown continuous — both cards put the body in the same
  // place, so there's nothing left to blend.
  //
  // ⚠ WHAT IT COSTS IS THE BANK'S PIVOT. `gooseTilt` rotates the card about its anchor, which is
  // the feet now rather than the body, so a banking bird slides sideways by lift·sin(tilt): 0.14
  // model units at the 29° ceiling, which is 0.4 px on a cruising bird and 1.6 px on one passing
  // two tiles away. Cheaper than a second rotation centre in a billboard layer shared with every
  // tree in the world, and in the direction a banking body actually moves.
  // ⚠ IT RUNS BEFORE THE LIFT AND AFTER EVERYTHING IS BUILT. The lift is what puts the soles of
  // the feet on h = 0, so a rotation applied after it would swing the whole animal about a point
  // under the turf.
  if (pitch) for (const f of faces) if (TORSO.has(f.role)) f.p = f.p.map(tilt);
  const lift = state === 'raft' ? bodyH * 0.4 : bodyH + legLen;
  if (lift) for (const f of faces) f.p = f.p.map((v) => V(v[0], v[1], v[2] + lift));

  return faces;
}

// ── The pose table ────────────────────────────────────────────────────────────
// ⚠ A TABLE, NOT A CACHE. There are eleven poses in the whole game (walk, raft, and three wing
// shapes, per animal), they are built once and they never age out — so there is no eviction rule
// to get wrong and no bound to exceed. `clearFaunaFacesCache` exists for the Modelshop's tuner
// and for the gates, not for memory.
const _faces = new Map();

export function faunaFaces(kind, id, state = 'walk', wing = 0) {
  const w = state === 'air' ? clampN(wing | 0, 0, 2) : 0;
  const key = kind + ':' + id + ':' + state + ':' + w;
  const hit = _faces.get(key);
  if (hit) return hit;
  const p = row(kind, id);
  if (!p) return [];
  const faces = kind === 'bird' ? buildBird(p, state, w) : [];
  _faces.set(key, faces);
  return faces;
}

/** Does this animal have a far tier authored? A species with none is drawn near at any distance. */
// ── THE FIVE RUNGS ───────────────────────────────────────────────────────────
//
// One ordered ladder, named, because the numbers were about to be spelled out at four call sites
// across two files and a tier is exactly the kind of integer that gets compared with the wrong
// literal. Distance runs down it; 0 is what the animal really looks like and 4 is a coloured dot.
//
//   0 FULL    the authored mesh, every feather field            55 faces (songbird)
//   1 FAR     the authored reduced row, where one exists        34
//   2 COARSE  derived silhouette: body, wings, plan, tail        5
//   3 GLYPH   derived silhouette: body and two wings             3
//   4 DOT     one sprite, sized off the wingspan                 1 (no mesh at all)
//
// ⚠ 4 IS NOT A MESH AND MUST NEVER BE ASKED FOR ONE. It is the sprite branch in windshield.js and
// has no pose, so it is in this table to be COMPARED against, not to be built — faunaPose is never
// called with it.
export const FAUNA_LOD_FULL = 0, FAUNA_LOD_FAR = 1, FAUNA_LOD_COARSE = 2, FAUNA_LOD_GLYPH = 3, FAUNA_LOD_DOT = 4;

export function faunaHasFar(kind, id) { const t = FAR_TABLES[kind]; return !!(t && t[id]); }

export function clearFaunaFacesCache() { _faces.clear(); _poses.clear(); }

// ── THE BEAT AS A PHASE, FOR THE RENDERER THAT DRAWS THE MESH ITSELF ─────────
//
// Three wing shapes is what a BAKE can afford: each one is a texture per bearing, so a fourth
// costs twelve of them. A renderer handing triangles to a depth buffer pays nothing per shape —
// the mesh is built once per step and cached for the life of the page — so the beat can simply be
// a continuous angle, and the step count is about how smooth it looks rather than about a budget.
//
// ⚠ THE ASYMMETRY IS THE POINT, and it is the same asymmetry WING_DIHEDRAL records: the downstroke
// does the work and goes deep, the recovery folds the wing and brings it back up barely above the
// shoulder. Spread evenly over the cycle it reads as a metronome rather than as a bird. The ends
// ease because a real wing REVERSES there — it is momentarily still at the top and the bottom, and
// a linear ramp through those instants is what makes an animation look like a rotating part.
export const FAUNA_BEAT_STEPS = 16;
const BEAT_DOWN = 0.4;                            // the share of the cycle the power stroke takes
const ease = (t) => (1 - Math.cos(Math.PI * clampN(t, 0, 1))) / 2;
// ⚠ AND A LANDING BIRD BEATS ITS WINGS ABOVE LEVEL ONLY. A goose flares to land; it does not flap
// through the grass. The downstroke is the one pose that reaches under a bird's own feet, and on
// depth-tested ground that is up to half a bird gone for a sixth of a second at a time — the flock
// flickering into the field just as it arrives. A shallow flutter at twice the rate is what the
// last moment of a landing looks like anyway, and take-off gets it for the same reason: the ground
// is in the way in either direction.
export function beatDihedral(phase, flare = 0) {
  const f = phase - Math.floor(phase);
  if (flare) return WING_DIHEDRAL[0] * (1 - Math.cos(4 * Math.PI * f)) / 2;
  return f < BEAT_DOWN
    ? WING_DIHEDRAL[0] + (WING_DIHEDRAL[2] - WING_DIHEDRAL[0]) * ease(f / BEAT_DOWN)
    : WING_DIHEDRAL[2] + (WING_DIHEDRAL[0] - WING_DIHEDRAL[2]) * ease((f - BEAT_DOWN) / (1 - BEAT_DOWN));
}

// ── THE SAME ANIMAL, AS WORLD GEOMETRY ───────────────────────────────────────
//
// ⚠ ONE MESH, TWO RENDERERS. This is the same `buildGoose` output the card was baked from — there
// is no second model here and there must never be one, or the picture on a machine with WebGL2 and
// the picture without it become two different animals. What changes is only where the projection
// happens: the card bakes a fixed viewpoint into a texture and hangs it off one depth, and this
// hands the real triangles to the real camera.
//
// ⚠ AND THAT IS WHY IT CANNOT BE BURIED. A card carries ONE depth for the whole quad, so every
// pixel of a standing bird claims the distance of its own feet; the ground at the rows its body
// covers is nearer, and the depth buffer is right to paint over it. A vertex carries its own.
//
// ⚠ THE SIZE IS IN TILES AND IS A PROPERTY OF THE ANIMAL, not of the seat. The card's size came
// from `propS`, which is a SCREEN size with a per-seat multiplier in it — a truck's props draw
// 1.75× a cockpit's — and a solid object cannot have two physical sizes depending on who is
// looking. A tile is about fifteen metres (a storey is 0.196 of one), so 0.11 puts the wingspan at
// 1.15 model units ≈ 1.9 m, which is a Canada goose, and lands within a few per cent of the size
// the card drew at the seat it was tuned at.
export const FAUNA_TILE = 0.085;

// ── A BIRD AT RANGE IS A SPECK, AND 103 TRIANGLES IS THE WRONG SHAPE FOR ONE ────────
//
// Measured on a 640-wide frame: a songbird's whole WINGSPAN is 6.0 px at one tile, 3.0 at two and
// 1.5 at four, and its body is 1.75 px at one tile. A murmuration is never nearer than a couple of
// tiles, so the flock is a cloud of one- and two-pixel dots — and it was being drawn as 292 meshes
// at 103 triangles each, 30,079 triangles a frame, which measured as 4.1 ms of the flock's 6.2.
//
// These two exist so windshield.js can decide per bird whether it is worth a mesh, without
// reaching into the row or re-deriving the palette every frame.
const _dotRGB = new Map();
export function faunaDotColour(kind, id) {
  const k = kind + ':' + id;
  let c = _dotRGB.get(k);
  if (!c) { c = faunaPalette(row(kind, id)).body; _dotRGB.set(k, c); }
  return c;
}
// The animal's wingspan in world tiles — the widest thing about it, so it is the honest measure of
// whether a mesh has anything left to say at this distance.
// ⚠ AND THE THRESHOLD IS THE ANIMAL_S, NOT THE RENDERER_S. It was one number for all six, and
// one number cannot serve them: a goose's wingspan is five times a starling's, so the pixel count
// that makes a murmuration free is the same one that turns every goose past four tiles into a
// speck. Measured at each species' own drawRange -- the distance it stops being drawn at all --
// five of the six are only 2.4 to 3.3 px wide there, and the songbird is 1.03: its mesh is never
// doing any work at any range it is visible at, and the other five are doing work right out to
// their limit. So the number belongs beside the mesh it is deciding about.
//
// Unset, the row falls back to RENDER_TUNE.faunaDot, which stays the global default AND the master
// switch -- at 0 there is no LOD at all and the renderer is provably the one that shipped.
export function faunaDotPx(kind, id) {
  const r = row(kind, id);
  const v = r && r.dotPx;
  return typeof v === 'number' && v > 0 ? v : null;
}

export function faunaSpanTiles(kind, id) {
  const r = row(kind, id);
  return r ? (r.span ?? 1) * 2 * FAUNA_TILE : 0;
}

// The model faces plus their resolved colours, per pose. The palette is per row and the shade is
// per face, so both are constant for a pose — resolving them per frame would be a string-free
// version of the same waste `rv` exists to avoid on the rig.
const _poses = new Map();
function faunaPose(kind, id, state, beatStep, flare = 0, gear = 0, far = 0) {
  const air = state === 'air';
  const step = air ? ((beatStep | 0) % FAUNA_BEAT_STEPS + FAUNA_BEAT_STEPS) % FAUNA_BEAT_STEPS : 0;
  const fl = air && flare ? 1 : 0;
  // ⚠ THE GEAR IS ITS OWN LETTER IN THE KEY, not a widening of the flare's. The two flags are set
  // at different heights and the table has to be able to hold the pose in between — feet down and
  // still beating properly, which is what most of an approach looks like.
  const gr = air && gear ? 1 : 0;
  // ⚠ THE TIER IS IN THE KEY. Without it the first bird of a species to be drawn decides which
  // mesh every other one gets for the life of the session -- a near bird caching the far mesh is a
  // starling with no primaries at arm's length, and the reverse is the whole saving thrown away.
  // ⚠ THE TIER IS THE WHOLE TIER IN THE KEY, NOT WHETHER THERE IS ONE. It was `(far ? 'L' : '')`,
  // which was right while there were two rungs and silently collapses all four the moment there
  // are more — tiers 1, 2 and 3 would share one entry, and the first bird drawn at any of them
  // would decide what every other bird got for the life of the page. That is the same defect the
  // note below is about, arriving again through the fix for it.
  const key = kind + ':' + id + ':' + state + ':b' + step + (fl ? 'f' : '') + (gr ? 'g' : '') + 'L' + (far | 0);
  const hit = _poses.get(key);
  if (hit) return hit;
  // ⚠ THE GLYPH RUNGS TAKE THE SPECIES' OWN FULL ROW, never the far one. A far row is a reduction
  // of DETAIL fields — facet counts, slots, speckles — and the glyph reads none of them; what it
  // does read is span, chord and body size, which are the animal's PROPORTIONS and are the one
  // thing that must not change as it recedes. Handed the far row a species without one silently
  // gets a different-shaped bird at the two rungs that have to match everything above them.
  const glyph = kind === 'bird' && far >= FAUNA_LOD_COARSE;
  const p = row(kind, id, glyph ? 0 : far);
  if (!p) return null;
  const dih = air ? beatDihedral(step / FAUNA_BEAT_STEPS, fl) : null;
  const faces = kind !== 'bird' ? []
    : glyph ? buildBirdGlyph(p, state, dih, far === FAUNA_LOD_COARSE)
      : buildBird(p, state, 0, dih, gr);
  const pal = faunaPalette(p);
  const rgb = faces.map((f) => {
    const c = pal[f.role] || FALLBACK.body;
    return [clampN(c[0] * f.sh, 0, 255) | 0, clampN(c[1] * f.sh, 0, 255) | 0, clampN(c[2] * f.sh, 0, 255) | 0];
  });
  const out = { faces, rgb };
  _poses.set(key, out);
  return out;
}

/**
 * One pose's faces in MODEL units, roles and all — the thing `faunaWorldFaces` transforms and
 * throws the role away from.
 *
 * ⚠ FOR THE GATES, and it is exported rather than reimplemented for the reason `faunaPaintCount`
 * is: a check that rebuilt the mesh to look at it would be checking its own copy. A gate asking
 * "are the feet tucked up here and down there" needs to know which faces are feet, and `rgb` has
 * already resolved that to a colour by the time the world pass sees it.
 */
export function faunaPoseFaces(kind, id, opts = {}) {
  const { state = 'walk', beat = 0, flare = 0, gear = 0, far = 0 } = opts;
  return (faunaPose(kind, id, state, beat, flare, gear, far) || { faces: [] }).faces;
}

/**
 * One animal's faces in WORLD tiles, ready for a flat-shaded triangle layer.
 *
 * `heading` is the direction it is facing, in the same (cos, sin) convention the flock lattice
 * uses; `roll` banks it about its own forward axis and `pitch` tips the nose up.
 *
 * ⚠ THE BASIS MATCHES THE CARD'S, and it is derived rather than guessed. `faunaProject` maps model
 * +x onto "depth away from the camera" at bearing 0 — so +x is the way the bird is going — and
 * model +y onto screen right at that same bearing, which for a view direction rotated 90° counter-
 * clockwise is the world's (−sin, cos). Get that sign wrong and every bird is mirrored, which is
 * invisible on a goose and not on anything with a marking down one side.
 */
// ── THE SAME TRANSFORM, WITHOUT THE GARBAGE ────────────────────────────────
//
// 'faunaWorldFaces' builds a fresh array of fresh face objects holding fresh vertex arrays every
// time it is called, which is once per bird per frame: at fifty-five faces that is 330 allocations
// a bird, or about 66,000 a frame for a two-hundred-bird murmuration. It is the same defect the
// boids neighbour search had one layer down — correct, obvious, and quietly the dominant cost.
//
// ⚠ THE POOL IS OPT-IN AND THE PLAIN FUNCTION STAYS, which is not tidiness. Gates call
// 'faunaWorldFaces' twice and compare the two results — the dpr sweep and the leg-strike check both
// do — and a pooled call returns THE SAME OBJECTS mutated, so a comparison like that would be
// comparing a thing with itself and passing for ever. Only the render path, which reads each face
// once at upload and discards it, may use the pool.
//
// ⚠ AND A POOLED FACE MUST BE WIPED OF WHAT THE LAST CALLER WROTE ON IT. windshield.js stamps
// '.bird' on the first face of each animal for the census to read; left on a recycled object it
// would still be there next frame on a face belonging to nothing, and the census would report
// birds that were never drawn. It is cleared on every face handed out.
const _pool = [];
let _poolN = 0;
export function faunaPoolReset() { _poolN = 0; }
export function faunaPoolSize() { return _pool.length; }

export function faunaWorldFacesInto(out, kind, id, opts = {}) {
  const { state = 'walk', beat = 0, flare = 0, gear = 0, x = 0, y = 0, z = 0, heading = 0, roll = 0,
    pitch = 0, scale = FAUNA_TILE, alpha = 1, far = 0 } = opts;
  const pose = faunaPose(kind, id, state, beat, flare, gear, far);
  if (!pose || !pose.faces.length) return 0;
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const F0 = ch * cp, F1 = sh * cp, F2 = sp;
  const S0x = -sh, S0y = ch, S0z = 0;
  const U0x = -ch * sp, U0y = -sh * sp, U0z = cp;
  const Sx = S0x * cr + U0x * sr, Sy = S0y * cr + U0y * sr, Sz = S0z * cr + U0z * sr;
  const Ux = U0x * cr - S0x * sr, Uy = U0y * cr - S0y * sr, Uz = U0z * cr - S0z * sr;
  const faces = pose.faces;
  for (let i = 0; i < faces.length; i++) {
    const src = faces[i].p, n = src.length;
    let slot = _pool[_poolN];
    if (!slot) slot = _pool[_poolN] = { p: [], rgb: null, a: 1, bird: null };
    _poolN++;
    const q = slot.p;
    if (q.length !== n) q.length = n;
    for (let j = 0; j < n; j++) {
      const v = src[j], a = v[0] * scale, b = v[1] * scale, c = v[2] * scale;
      let t = q[j];
      if (!t) t = q[j] = [0, 0, 0];
      t[0] = x + F0 * a + Sx * b + Ux * c;
      t[1] = y + F1 * a + Sy * b + Uy * c;
      t[2] = z + F2 * a + Sz * b + Uz * c;
    }
    slot.rgb = pose.rgb[i];
    slot.a = alpha;
    slot.bird = null;
    out.push(slot);
  }
  return faces.length;
}

export function faunaWorldFaces(kind, id, opts = {}) {
  const { state = 'walk', beat = 0, flare = 0, gear = 0, x = 0, y = 0, z = 0, heading = 0, roll = 0, pitch = 0,
    scale = FAUNA_TILE, alpha = 1, far = 0 } = opts;
  const pose = faunaPose(kind, id, state, beat, flare, gear, far);
  if (!pose || !pose.faces.length) return [];
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // Forward, side and up after the pitch, then the roll about the forward axis.
  const F = [ch * cp, sh * cp, sp];
  const S0 = [-sh, ch, 0];
  const U0 = [-ch * sp, -sh * sp, cp];
  const S = [S0[0] * cr + U0[0] * sr, S0[1] * cr + U0[1] * sr, S0[2] * cr + U0[2] * sr];
  const U = [U0[0] * cr - S0[0] * sr, U0[1] * cr - S0[1] * sr, U0[2] * cr - S0[2] * sr];
  const out = [];
  for (let i = 0; i < pose.faces.length; i++) {
    const f = pose.faces[i], p = f.p, n = p.length, q = new Array(n);
    for (let j = 0; j < n; j++) {
      const v = p[j], a = v[0] * scale, b = v[1] * scale, c = v[2] * scale;
      q[j] = [x + F[0] * a + S[0] * b + U[0] * c,
        y + F[1] * a + S[1] * b + U[1] * c,
        z + F[2] * a + S[2] * b + U[2] * c];
    }
    out.push({ p: q, rgb: pose.rgb[i], a: alpha });
  }
  return out;
}

// ── HOW THE BAKE SHEET SAMPLES THE COMPASS ─────────────────────────
// ⚠ THIS WAS A TEXTURE BUDGET AND IS NOW A CONTACT SHEET. While a goose was a baked card, these
// numbers were the whole spend: one texture per pose per bearing, out of a 256-entry cache the
// billboard layer shares with every tree, rock, actor and landmark, and the air count could not be
// raised past 12 without taking the room from somebody else. The renderer hands over triangles now
// and bakes nothing, so the only reader left is the Modelshop’s sheet, where the count decides how
// many columns you get to judge a silhouette from rather than what the game holds in memory.
//
// The ground is sampled more coarsely than the air, which is still the right call for a sheet: a
// walking bird is a few pixels of blob whose aspect barely changes, a flying one is read almost
// entirely by the angle its wings make, and a rafting one is a lump on water.
export const FAUNA_BEARINGS = { walk: 6, raft: 4, air: 12 };
export const FAUNA_WINGS = 3;

const TAU = Math.PI * 2;

// The bearing a column is drawn at — the bucket’s own centre.
export const bucketBearing = (state, b) => ((b % (FAUNA_BEARINGS[state] ?? 6)) / (FAUNA_BEARINGS[state] ?? 6)) * TAU;

// Every pose an animal has, which is what the sheet renders and what the gates sweep. Derived from
// the table above, so a state added in one place cannot be missed in the other.
//
// ⚠ THREE WING SHAPES HERE, SIXTEEN IN THE AIR. This is the DISCRETE table — what a bake could
// afford and what the sheet shows; `FAUNA_BEAT_STEPS` is what the renderer actually walks.
export const FAUNA_POSES = [
  { state: 'walk', wing: 0 }, { state: 'raft', wing: 0 },
  ...Array.from({ length: FAUNA_WINGS }, (_, w) => ({ state: 'air', wing: w })),
];

// Every (pose, bearing) cell the sheet lays out, enumerated once so the layout and the paint agree
// by construction rather than by two copies of the same arithmetic.
export function faunaKeySpace() {
  const out = [];
  for (const p of FAUNA_POSES) {
    for (let b = 0; b < (FAUNA_BEARINGS[p.state] ?? 6); b++) out.push({ ...p, bearing: b });
  }
  return out;
}

// ── Projection and paint ──────────────────────────────────────────────────────
// `bearing` is the angle between the animal's own forward and the direction the camera is looking:
// 0 is going straight away from you, π is coming straight at you, π/2 is broadside heading right.
// ⚠ THE ELEVATION IS A PROPERTY OF THE STATE, AND IT HAS A SIGN. A baked texture is one fixed
// viewpoint, so it has to be the viewpoint that actually occurs — and there are exactly two.
// GLASS's optical axis is horizontal, the eye sits above the ground, and the goose pass is gated
// off above `v.height` half a tile: so a bird on the ground or on the water is always seen from a
// little ABOVE, and a bird in the air is always seen from a little BELOW. Baking both from
// overhead draws a flying goose you are looking down on while you are looking up at it, which
// reads as the wings being on backwards.
// ⚠ THE AIR VIEWPOINT IS STEEP, and that is a measurement rather than a preference. A bird
// overhead is seen from well below, and a wing is a flat sheet: at a shallow angle it is edge-on,
// so a whole wingbeat draws as a hairline and three poses that differ only in dihedral become
// three identical slivers. The bake sheet showed exactly that at 9° and reads as a bird at 22°.
// ⚠ AND THE AIR ANGLE IS A COMPROMISE WITH A FLOOR AND A CEILING. Too shallow (-0.16) and a wing
// is edge-on, so a whole wingbeat draws as a hairline and three poses collapse into one sliver.
// Too steep (-0.38) and the SPAN starts contributing as much to a tip's screen height as its real
// dihedral does — a modest 23° raise reads as a near-vertical fin, which is geometrically honest
// and looks like a sail. -0.26 keeps the wing a surface without exaggerating the beat.
const POSE_EL = { walk: 0.22, raft: 0.22, air: -0.26 };
export const faunaEl = (state) => POSE_EL[state] ?? 0.22;

// Exported because the Modelshop's framing and the gates both need to know how big a pose draws
// without painting one. `el` is free here so the Modelshop can orbit; the game only ever passes
// the state's own.
export function faunaProject(v, bearing, el = 0.22) {
  const sb = Math.sin(bearing), cb = Math.cos(bearing);
  const cx = v[0] * sb + v[1] * cb;          // screen right
  const cd = v[0] * cb - v[1] * sb;          // depth, away from the camera
  const cz = v[2];
  return [cx, -(cz * Math.cos(el) + cd * Math.sin(el)), cd * Math.cos(el) - cz * Math.sin(el)];
}

// The model's screen extent at a bearing, in model units: { w, h, ax, ay } where ax/ay locate the
// animal's own origin inside that box, measured from the left and the TOP.
export function faunaBounds(kind, id, state = 'walk', wing = 0, bearing = Math.PI * 0.5, el = faunaEl(state)) {
  const faces = faunaFaces(kind, id, state, wing);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of faces) {
    for (const v of f.p) {
      const q = faunaProject(v, bearing, el);
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
    }
  }
  if (!Number.isFinite(x0)) return { w: 0, h: 0, ax: 0, ay: 0, x0: 0, y0: 0 };
  return { w: x1 - x0, h: y1 - y0, ax: -x0, ay: -y0, x0, y0 };
}

const shadeCss = (c, m) => 'rgb(' + (clampN(c[0] * m, 0, 255) | 0) + ',' + (clampN(c[1] * m, 0, 255) | 0) + ',' + (clampN(c[2] * m, 0, 255) | 0) + ')';

/**
 * Paint one animal into `ctx`, centred on (cx, cy), at `unit` pixels per model unit.
 *
 * ⚠ THE SCALE IS PER MODEL UNIT, NOT PER DRAWN BOX, and that is the whole reason a caller can use
 * one size constant. Scaling to fill a box makes the size bearing-dependent in the wrong
 * direction: a goose coming straight at you is a narrow box, so filling the box to a fixed width
 * blows it up to the size of a swan exactly when it should be at its smallest. At a fixed unit the
 * apparent size follows the geometry, which is what a real thing does. Returns the drawn box so a
 * caller can size its quad off the same numbers the paint used.
 *
 * The one painter, called by three things that must never disagree: the billboard bake in
 * windshield.js, the Modelshop's viewport, and the Modelshop's bake sheet. A second copy of this
 * would be a preview that lies about the game.
 *
 * ⚠ FAR TO NEAR, EVERY TIME. There is no depth buffer on a 2-D canvas, so the far wing is drawn
 * before the body and the near wing after it, and a bird painted in list order has its off-side
 * wing lying on top of its own back.
 */
// ⚠ HOW MANY ANIMALS HAVE ACTUALLY BEEN PAINTED, and it exists for one failure that nothing else
// can see. A billboard drawer that only ever PUSHES draws nothing whenever GLASS 2 is off — which
// is a shipping configuration, not a corner — and a headless census cannot tell the difference,
// because with the sink closed `emitScatterFace` still queues the closure and the tally counts the
// queued faces. They simply paint nothing. Counting the painter is the difference between "the
// pass ran" and "a bird appeared".
//
// ⚠ PER STATE, NOT A TOTAL. A total is too weak by exactly the amount that matters: the walking and
// flying halves are different code, so deleting the canvas path from one of them leaves the other
// still painting and a `> 0` check still green. Restoring the bug with a total in place took the
// count from 56 to 32 and passed.
const _painted = { walk: 0, raft: 0, air: 0 };
export const faunaPaintCount = () => ({ ..._painted, total: _painted.walk + _painted.raft + _painted.air });
// The GL path hands triangles to gl/solids.js and never reaches 'paintFauna', so for as long as
// this counter lived only in the painter it answered ZERO for every bird GLASS 2 drew -- and zero
// is also what a flock that failed to draw reports, which is the one thing a census exists to tell
// apart. windshield.js's 'pushFauna' calls this so the count means BIRDS DRAWN rather than birds
// drawn on a canvas. The two paths are alternatives (see the FAUNA_SINK branch in paintGoose), so
// nothing is counted twice.
export function faunaCountPainted(state) { if (_painted[state] != null) _painted[state]++; }

export function paintFauna(ctx, kind, id, opts = {}) {
  const { state = 'walk', wing = 0, bearing = Math.PI * 0.5, unit = 16, x = 0, y = 0, alpha = 1, dim = 1 } = opts;
  const el = opts.el == null ? faunaEl(state) : opts.el;
  // ⚠ ONE POSE SOURCE FOR BOTH RENDERERS. `beat` is the continuous wingbeat the mesh walks; without
  // it this is the three-shape table, which is what the Modelshop's sheet and the bake still ask
  // for. A second interpolation here would be a canvas bird flapping out of step with a GL one.
  const faces = opts.beat == null ? faunaFaces(kind, id, state, wing)
    : (faunaPose(kind, id, state, opts.beat, opts.flare, opts.gear) || { faces: [] }).faces;
  if (!faces.length) return null;
  if (_painted[state] != null) _painted[state]++;
  const pal = faunaPalette(row(kind, id));

  const drawn = [];
  for (const f of faces) {
    const q = f.p.map((v) => faunaProject(v, bearing, el));
    let d = 0;
    for (const v of q) d += v[2];
    drawn.push({ f, q, d: d / q.length });
  }
  drawn.sort((a, z) => z.d - a.d);

  ctx.save();
  if (alpha !== 1) ctx.globalAlpha = alpha;
  for (const { f, q } of drawn) {
    ctx.fillStyle = shadeCss(pal[f.role] || FALLBACK.body, f.sh * dim);
    ctx.beginPath();
    ctx.moveTo(x + q[0][0] * unit, y + q[0][1] * unit);
    for (let i = 1; i < q.length; i++) ctx.lineTo(x + q[i][0] * unit, y + q[i][1] * unit);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return faunaBox(kind, id, state, wing, bearing, unit, el);
}

/**
 * The drawn box in PIXELS, and where the model's origin sits inside it — which is exactly what a
 * billboard anchor is made of. Available without painting, because a bake has to size its canvas
 * before it has anything to measure.
 *
 * `ax`/`ay` are measured from the box's left and TOP, and land on the ground contact (see the ⚠ on
 * the origin lift in buildGoose). A caller sizes a canvas `w × h`, paints with `x: ax, y: ay`, and
 * hands the same `ax`/`ay` straight to pushBillboard.
 */
export function faunaBox(kind, id, state = 'walk', wing = 0, bearing = Math.PI * 0.5, unit = 16, el = faunaEl(state)) {
  const b = faunaBounds(kind, id, state, wing, bearing, el);
  return { w: b.w * unit, h: b.h * unit, ax: b.ax * unit, ay: b.ay * unit };
}

// ── The Modelshop's two views ─────────────────────────────────────────────────
// Both live here, beside `paintFauna`, because both exist to show you what the game will bake and
// a copy of either somewhere else would be a preview that can drift from it. The Modelshop's
// vehicle preview sits in windshield.js for the opposite reason — it needs `makeCam` and
// `drawAircraftModel`, which live there. An animal needs neither: there is no camera in this
// file, and that is what makes it cheap.

const bg = (ctx, W, H, night) => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (night) { g.addColorStop(0, '#0b0f18'); g.addColorStop(1, '#171b23'); }
  else { g.addColorStop(0, '#26303c'); g.addColorStop(1, '#3c4652'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
};

/** One animal, large, on a plain backdrop. The orbit view. */
export function renderFaunaPreview(canvas, opts = {}) {
  const { kind = 'bird', id = 'goose', state = 'walk', wing = 0, bearing = Math.PI * 0.5, night = 0, fill = 0.62 } = opts;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  bg(ctx, W, H, night > 0.5);
  const el = opts.el == null ? faunaEl(state) : opts.el;
  const b = faunaBounds(kind, id, state, wing, bearing, el);
  if (!(b.w > 0) || !(b.h > 0)) return;
  // Solved on whichever axis is tight, the way previewFit does it for a vehicle: a wings-up goose
  // is tall and a level one is wide, and framing on one axis crops the other.
  const unit = Math.min((W * fill) / b.w, (H * fill) / b.h);
  const x = W / 2 - (b.x0 + b.w / 2) * unit, y = H / 2 - (b.y0 + b.h / 2) * unit;
  // Something to stand on, so "is it buried to the knees" is a question the view can answer.
  if (state !== 'air') {
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.fillStyle = state === 'raft' ? '#2b4a5e' : '#1b2a16';
    ctx.beginPath(); ctx.ellipse(x, y, b.w * unit * 0.62, b.w * unit * 0.13, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  paintFauna(ctx, kind, id, { state, wing, bearing, unit, x, y, night, el, dim: night > 0.5 ? 0.45 : 1 });
}

/**
 * THE BAKE SHEET — every texture the game will actually hold, at the size it will actually hold
 * it, in one strip.
 *
 * ⚠ THE POINT IS THAT IT IS TINY. You are authoring a silhouette that draws at four to twenty
 * pixels, and a model judged at 400 px is a model judged at a size no player will ever see it at.
 * Every cell here is `unit` — the same number the renderer passes — so what is on this strip is
 * the picture, not an impression of it. The magnified row underneath is the same pixels scaled up
 * with smoothing off, so you can see WHICH pixels rather than a different drawing of them.
 */
export function renderFaunaSheet(canvas, opts = {}) {
  const { kind = 'bird', id = 'goose', unit = 13, night = 0, mag = 4 } = opts;
  const ctx = canvas.getContext('2d');
  const space = faunaKeySpace();
  // Widest cell across the whole space, so the grid does not reflow as you tune.
  let cw = 8, ch = 8;
  for (const k of space) {
    const box = faunaBox(kind, id, k.state, k.wing, bucketBearing(k.state, k.bearing), unit);
    cw = Math.max(cw, box.w); ch = Math.max(ch, box.h);
  }
  const padX = 6, padY = 16, cols = Math.max(...FAUNA_POSES.map((p) => FAUNA_BEARINGS[p.state] ?? 6));
  const cellW = Math.ceil(cw) + padX * 2, cellH = Math.ceil(ch * (1 + mag)) + padY;
  canvas.width = cols * cellW; canvas.height = FAUNA_POSES.length * cellH;
  const W = canvas.width, H = canvas.height;
  bg(ctx, W, H, night > 0.5);

  ctx.font = '9px ui-monospace, monospace'; ctx.textBaseline = 'top';
  FAUNA_POSES.forEach((p, r) => {
    const n = FAUNA_BEARINGS[p.state] ?? 6;
    ctx.fillStyle = night > 0.5 ? '#7d8796' : '#aab3c0';
    ctx.fillText(p.state === 'air' ? 'air w' + p.wing : p.state, 4, r * cellH + 2);
    for (let b = 0; b < n; b++) {
      const bearing = bucketBearing(p.state, b);
      const box = faunaBox(kind, id, p.state, p.wing, bearing, unit);
      const cx = b * cellW + cellW / 2, cy = r * cellH + padY + box.h / 2;
      // Real size, where the eye judges the silhouette.
      paintFauna(ctx, kind, id, { state: p.state, wing: p.wing, bearing, unit, x: cx - box.w / 2 + box.ax, y: cy - box.h / 2 + box.ay, dim: night > 0.5 ? 0.45 : 1 });
      // …and the same pixels again, magnified, where the eye judges which ones they are.
      if (mag > 1 && box.w >= 1 && box.h >= 1) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        try {
          const src = ctx.getImageData(Math.floor(cx - box.w / 2), Math.floor(cy - box.h / 2), Math.ceil(box.w), Math.ceil(box.h));
          const tmp = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(src.width, src.height) : null;
          if (tmp) {
            tmp.getContext('2d').putImageData(src, 0, 0);
            ctx.globalAlpha = 0.95;
            ctx.drawImage(tmp, b * cellW + padX, r * cellH + padY + box.h + 4, src.width * mag, src.height * mag);
          }
        } catch { /* a tainted or zero-sized read is not worth a frame */ }
        ctx.restore();
      }
    }
  });
}

// ── Smoke ─────────────────────────────────────────────────────────────────────
// The fauna half of `vehicleRenderSmoke`. Every animal, every pose, several bearings, through a
// recording context — and the thing it is actually looking for is a colour that resolved to null
// or a vertex that resolved to NaN, both of which the headless canvas stub accepts in silence and
// a real browser throws on. Returns a list of complaints; empty is green.
export function faunaRenderSmoke(makeCtx) {
  const bad = [];
  for (const kind of Object.keys(TABLES)) {
    for (const id of Object.keys(TABLES[kind])) {
      for (const pose of FAUNA_POSES) {
        const faces = faunaFaces(kind, id, pose.state, pose.wing);
        if (!faces.length) { bad.push(kind + '/' + id + ' ' + pose.state + '/' + pose.wing + ': builds no faces at all'); continue; }
        for (const f of faces) {
          for (const v of f.p) {
            if (v.some((n) => !Number.isFinite(n))) { bad.push(kind + '/' + id + ' ' + pose.state + '/' + pose.wing + ': a non-finite vertex in a ' + f.role + ' face'); break; }
          }
          if (!Number.isFinite(f.sh)) bad.push(kind + '/' + id + ': a non-finite shade on a ' + f.role + ' face');
        }
        const pal = faunaPalette(row(kind, id));
        for (const role of Object.keys(pal)) {
          const c = pal[role];
          if (!Array.isArray(c) || c.length !== 3 || c.some((n) => !Number.isFinite(n))) bad.push(kind + '/' + id + ': ' + role + ' resolved to something that is not an rgb triple');
        }
        if (typeof makeCtx === 'function') {
          const { ctx, calls } = makeCtx();
          for (const bearing of [0, 1.2, Math.PI, 4.4]) paintFauna(ctx, kind, id, { ...pose, bearing, size: 24 });
          // ⚠ AND THE LANDING POSES, WHICH `FAUNA_POSES` CANNOT REACH. That table keys on (state,
          // wing) alone, so the flare's beat and the gear-down legs are geometry no sweep here ever
          // painted — and the canvas is the renderer a machine with no WebGL2 gets. Their VERTICES
          // are swept in world space by scripts/shapes/smoke.mjs; what is only answerable here is
          // whether painting them puts a null colour on a context.
          if (kind === 'bird' && pose.state === 'air') {
            for (const v of [{ flare: 0, gear: 1 }, { flare: 1, gear: 1 }]) {
              for (const beat of [0, 5, 11]) paintFauna(ctx, kind, id, { state: 'air', beat, ...v, bearing: 1.2, size: 24 });
            }
          }
          for (const c of calls || []) {
            const s = JSON.stringify(c.args ?? c);
            if (/NaN|null|undefined/.test(s)) bad.push(kind + '/' + id + ' ' + pose.state + ': ' + c.name + '(' + s + ') reached the canvas');
          }
        }
      }
    }
  }
  return bad;
}
