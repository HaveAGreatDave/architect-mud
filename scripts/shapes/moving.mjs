// moving — do the parts of the city that are supposed to move, move? And do they all stop?
//
//   node scripts/shapes/moving.mjs
//   node scripts/shapes/moving.mjs --report    # every model, and how many poses it has
//
// The motion layer has two promises and no gate held either of them.
//
//   1. THE NAMED PARTS MOVE. "All the cranes are animated" is a standing requirement now, and the
//      way it stops being true is nobody noticing: a crane added next month, or an arm refactored
//      so its jib goes back through `draw3DBoxAt`, draws a perfectly good still crane. Nothing
//      throws, no budget moves, and the only witness is somebody who happens to watch that one
//      building for thirty seconds.
//   2. `RENDER_TUNE.motion` 0 IS THE RENDERER AS IT SHIPPED. That flag's whole contract is "a still
//      crane, not a missing one" — so every animated arm has to collapse to exactly ONE pose with
//      it off, and the pose has to be the one its cycle calls home. An arm that still moves with
//      the slider off is a flag that does not work; an arm that draws NOTHING with it off is the
//      worse half of the same bug, and both of them look fine in a single screenshot.
//
// ⚠ IT SWEEPS A WHOLE PERIOD, NOT THREE INSTANTS. Every cycle here is a DUTY cycle — `work` is
// under half, so a machine is parked most of the time — and three samples can land in the idle
// stretch of all of them and report a city of statues. The sweep walks the longest period in the
// set, so a cycle cannot hide inside the gaps between samples.
//
// ⚠ AND A POSE IS THE WHOLE EMITTED FRAME, not a face count. A slewing crane emits the same number
// of quads at every bearing — what changes is where they are — so anything counting parts would
// pass a jib that had been nailed to one heading, which is the exact failure the motion layer's own
// ⚠ is written about.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const REPORT = process.argv.includes('--report');

// ⚠ A LIST OF REASONS, NOT A LIST OF NAMES. Each of these is here because somebody can look at that
// building and say what it is doing; that is the bar the whole layer is held to, and a model added
// without one does not belong on it.
const MUST_MOVE = new Map([
  ['type:wharf', 'the loading crane slews, runs its trolley and lifts'],
  ['type:quay_crane', 'the harbour crane slews, runs its trolley and lifts a box off a hull'],
  ['type:pier', 'the flags fly downwind and ripple'],
  ['type:junkyard', 'the grabber drops into the scrap pile and takes a bite'],
  ['type:fabrication', 'the gantry trolley runs its beam'],
  ['named:coldwaterclonefacility', 'the vats breathe'],
  ['named:halloransfixit', 'the chain block pulls an engine'],
  ['named:thedynamo', 'the wind wheel turns at the speed of the wind'],
  ['named:voltage', 'the club sweeps two searchlights across the sky'],
]);

// ⚠ AND ONE OF THEM ONLY EXISTS AFTER DARK. `skyBeam` draws nothing at noon — a searchlight at
// midday is a lamp nobody can see — so the sweep below has to ask for the hour the part is for.
// Everything else here is machinery and machinery works in daylight, which is why `night: 0` is
// the default and this is a per-entry exception rather than a change to all of them.
const AT_NIGHT = new Set(['named:voltage']);

// ⚠ AN ARM MAY CARRY BOTH KINDS OF ANIMATION, and one of them does. `RENDER_TUNE.motion` parks the
// motion LAYER; a smoke plume, a beacon and an arc strike are adornments on their own clocks that
// predate the flag and are not moving parts. So an arm holding one of those still reads as two
// poses with the slider off, and that is correct rather than a leak — but it is exactly the shape
// a jib nailed to one bearing would also have, so it is declared with its REASON rather than
// waved through by a number. Adding a name here without one is how this check stops meaning
// anything.
// ⚠ AND IT IS INERT SINCE THE DIGEST BECAME TAG-SCOPED, which is worth saying rather than
// deleting: smoke is not queued with MOTION_TAG, so it no longer reaches the pose hash at all and
// this entry can neither excuse nor hide anything. It is kept because the REASON is still true and
// is the shape of thing that would need declaring again the day a moving part borrows a drifting
// one. If it is ever the only entry left and nothing has needed it for a while, delete it.
const ALSO_DRIFTS = new Map([
  ['named:halloransfixit', 'the rooftop extractor smokes, and smoke is not a moving part'],
]);

// ⚠ AND THREE OF THEM MOVE IN A WAY THIS DIGEST CANNOT SEE, WHICH IS A GAP IN THE GATE AND NOT
// A PASS. Every entry below is a MUST_MOVE arm that genuinely animates in the picture and whose
// animation reaches neither a tagged position nor a part count. They are declared rather than
// deleted because the reason is the useful thing: a future moving part built the same way will
// be invisible here too, and a name in MUST_MOVE with nothing checking it is worse than a name
// on this list.
//
// HOW THEY WERE PASSING UNTIL 2026-09-20, which is the part worth keeping. `captureRawPass`
// saved and nulled FACE_SINK and left STROKE_SINK installed, so the shape capture — which runs
// the arm again against SHAPE_STUB_CAM — pushed that run's strokes into the live sink. The
// capture is memoised on the model, so it happened on the FIRST render of each model and never
// again: `named:thedynamo` emitted 321 strokes on frame one and 21 on every frame after it. The
// digest mixes `r.strokes` as a COUNT, so that cold-versus-warm difference read as a second
// pose, and three arms that move nothing this digest can hash scored exactly the two poses the
// check asks for. Fixing the leak turned all three red on the same run, which is how they were
// found. A gate that passes because of a bug somewhere else passes for as long as that bug lives.
//
// WHAT EACH ONE ACTUALLY DOES, measured over a 40 s sweep with the model warmed first:
//   named:thedynamo             — 12 distinct all-sink position signatures, 0 of them tagged. The
//                                 wheel is `windWheel`, a BAKED BILLBOARD: `emitDecoQuad` keyed
//                                 `wheel|<step>`, so its pose is the texture IDENTITY and its
//                                 quad never moves. The twelve signatures are the stack smoke and
//                                 the arc strike beside it, and this file is explicit that
//                                 neither of those is a moving part. Fixing it is two lines —
//                                 give the wheel the `moving|` prefix, and mix `d.key` for
//                                 `moving|` decals — but the prefix is also what `glresidue`
//                                 buckets on, so it is a change to make with that gate in view.
//   named:coldwaterclonefacility — 12 signatures, 0 tagged. The vats breathe on `motionPhase`,
//                                 and the ⚠ on the digest names a breathing vat as exactly the
//                                 kind of thing that is NOT a moving part. Either it should not
//                                 be in MUST_MOVE or the vats should be tagged; that is a
//                                 question about the building, not about this file.
//   type:pier                   — 5 arcflag decals every frame, 5 distinct keys, and 1 corner
//                                 signature over 40 s. Not a missing part and not a silent one:
//                                 a flag in a dead calm does not ripple, and that is correct.
//                                 Every animated term in `windFlag` — `wav` and `rip` — is
//                                 multiplied by `windOf().fly`; `canvasResidue` runs an arm
//                                 OUTSIDE a world pass so `WIND_STATE` is null, and
//                                 `WIND_CALM.fly` is 0. Observing this one at all would need the
//                                 harness to blow some wind, which needs a seam windshield.js
//                                 does not export today. An earlier draft of this note said the
//                                 flags "never reach a sink", which was simply wrong — they do,
//                                 five of them, every frame.
//                                 is any motion.
const UNSEEN = new Map([
  ['named:thedynamo', 'the wheel is a baked billboard; its pose is the texture key, not a position'],
  ['named:coldwaterclonefacility', 'the vats breathe, and a breathing vat is not a tagged moving part'],
  ['type:pier', 'the flags are becalmed — canvasResidue runs outside a world pass, so wind is WIND_CALM'],
]);

const ws = await loadWindshield();
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });
const reg = ws.shapeModelRegistry();
const byKey = new Map(reg.map((e) => [e.key, e.m]));

// The longest cycle in the layer is the wharf crane's 38 s. Twenty samples over forty seconds puts
// one inside the working stroke of every duty cycle in the set, whatever its phase offset.
const TIMES = Array.from({ length: 20 }, (_, i) => i * 2000);

// ⚠ A POSE IS WHERE THE PARTS ARE, AND FOR A LONG TIME THIS HASHED HOW MANY THERE WERE. The
// paragraph at the top of this file says a pose is the whole emitted frame precisely because
// anything counting parts would pass a jib nailed to one bearing — and then the check took
// `canvasResidue`'s default return, which is COUNTS plus a tally of canvas calls by name. Every
// entry here passed anyway, by luck: a slewing crane's own backface culling changes how many quads
// survive, so its counts moved even though nothing was asking them to.
//
// The luck ran out on the first part whose count is constant by construction. Voltage's
// searchlights are `lightBeam` cones, and a cone's node count is a property of the CONE — its
// length over its mean radius — so it is the same number at every bearing. The beams swept
// perfectly and the gate reported one pose, which is the exact false negative this file exists to
// prevent, pointed at the newest thing in the layer.
//
// So it collects and digests the POSITIONS. `collect: true` hands back the stroke, sprite and decal
// sinks by reference; the digest is a cheap rolling hash over their coordinates at three decimals,
// because JSON of every corner of every decal over 20 samples × 13 models × 2 settings is a minute
// of stringifying to answer a yes/no question.
const MOVING = 'moving';   // windshield.js's own MOTION_TAG — the parts RENDER_TUNE.motion parks
const R3 = (v) => Math.round(v * 1000);
const digest = (r) => {
  let hx = 0x811c9dc5;
  const mix = (n) => { hx = ((hx ^ (n | 0)) * 0x01000193) >>> 0; };
  mix(r.faces); mix(r.decals); mix(r.sprites); mix(r.scatter); mix(r.strokes || 0);
  for (const k of Object.keys(r.canvas).sort()) { for (let i = 0; i < k.length; i++) mix(k.charCodeAt(i)); mix(r.canvas[k]); }
  const s = r.sink;
  if (s) {
    // ⚠ ONLY WHAT THE MOTION LAYER ITSELF QUEUED, WHICH IS WHAT `MOTION_TAG` IS FOR. A building
    // moves things on clocks that are not this flag - a smoke plume drifts, an arc welder strikes,
    // a vat breathes, a beacon pulses - and the note further down this file is explicit that none
    // of those is a moving PART. Hashing every position in the frame reports all four of them as
    // never parking, which is a gate that has stopped meaning anything; hashing only the tagged
    // ones measures exactly what the slider controls. The tag is recorded by the painter, because
    // a census cannot infer who queued a thing - `glresidue`'s lesson, one layer over.
    for (const w of s.strokes) if (w.tag === MOVING) { mix(R3(w.a[0])); mix(R3(w.a[1])); mix(R3(w.a[2])); mix(R3(w.b[0])); mix(R3(w.b[1])); mix(R3(w.b[2])); }
    for (const p of s.sprites) if (p.tag === MOVING) { mix(R3(p.x)); mix(R3(p.y)); mix(R3(p.z)); }
    for (const d of s.decals) if (String(d.key).startsWith(MOVING + "|")) for (const q of d.p) { mix(R3(q[0])); mix(R3(q[1])); mix(R3(q[2])); }
  }
  return hx;
};

const poses = (m, motion, night = 0) => {
  ws.RENDER_TUNE.motion = motion;
  const seen = new Set();
  for (const now of TIMES) {
    const r = ws.canvasResidue(m, { cam, night, bn: 'THE EXAMPLE', dy: -2, now, collect: true });
    if (r.threw) return { threw: r.threw };
    seen.add(digest(r));
  }
  return { n: seen.size };
};

const unseen = [];   // MUST_MOVE arms this digest provably cannot observe — see UNSEEN
const problems = [], rows = [];
for (const [key, why] of MUST_MOVE) {
  const m = byKey.get(key);
  if (!m) { problems.push(`${key}: not in the model registry at all — ${why}`); continue; }
  const nite = AT_NIGHT.has(key) ? 1 : 0;
  const on = poses(m, 1, nite), off = poses(m, 0, nite);
  if (on.threw) { problems.push(`${key}: threw with motion on — ${on.threw}`); continue; }
  if (off.threw) { problems.push(`${key}: threw with motion off — ${off.threw}`); continue; }
  rows.push({ key, on: on.n, off: off.n, why });
  // Declared above: the arm moves, and this digest has no way to observe it. Not a pass —
  // a recorded blind spot, which is why it prints even when it is not failing.
  if (UNSEEN.has(key)) { unseen.push(`${key}: ${UNSEEN.get(key)}`); } else
  if (on.n < 2) problems.push(`${key}: ONE pose over a 40 s sweep with motion on — ${why}, and it is not`);
  const drifts = ALSO_DRIFTS.has(key);
  if (off.n !== 1 && !drifts) problems.push(`${key}: ${off.n} poses with RENDER_TUNE.motion 0 — that flag promises a still building, not a slower one`);
  // …and a declared exception still has to be STILLER with the slider off, or the declaration is
  // covering for a part that never parked.
  if (drifts && off.n >= on.n) problems.push(`${key}: ${off.n} poses with motion 0 against ${on.n} with it on — it is declared as "${ALSO_DRIFTS.get(key)}", but the motion layer is not parking either`);
}

// ⚠ AND THE SWEEP DELIBERATELY DOES NOT ASK THE OTHER 200 MODELS TO HOLD STILL, which a first cut
// did and which reported twenty arms as broken. `RENDER_TUNE.motion` parks the MOTION LAYER — the
// jibs, trolleys, hooks, flags and the wind wheel — and it was never a switch for every animated
// adornment in the renderer. A smoke plume drifts, a beacon blinks and an arc welder strikes on
// their own clocks; all three predate this flag and none of them is a moving PART. Widening the
// check to cover them would not have found a bug, it would have redefined the flag.
//
// The invariant those arms DO have to hold — that nothing reading the clock reaches the captured
// mass — is not this file's to assert either: `shapes:smoke` already captures every model twice and
// demands the two agree, which is the same question asked where it can be answered exactly.

// ── 3. AND THE FLAGS FOLLOW THE WIND ────────────────────────────────────────
//
// `canvasResidue` runs an arm on its own, outside a world pass, so `WIND_STATE` is null and every
// flag it draws is becalmed — which is right for the checks above and useless for this one. The
// wind only exists inside a frame, so this asks a frame.
//
// ⚠ THE SUBJECT MUST BE AHEAD OF THE CAMERA, and a first cut put the pier on the window's centre
// tile — which is where the camera itself sits, so the near clip dropped it and all three wind
// bearings came back byte-identical. A confident, reproducible, completely false green: the same
// trap `worldresidue` records for its junction, and the reason that file says the crossing has to
// be ahead rather than underfoot.
//
// ⚠ AND THE CLOCK AND THE DICE ARE BOTH PINNED. Two renders of one scene differ by themselves —
// the clouds drift and GLASS throws a meteor across a clear sky on a random timer — so without
// both, "the wind changed the picture" is a statement about the weather rather than the flags.
// The identity check at one bearing is what proves the pinning took.
{
  const el = stubCanvas('__moving', 900, 500);
  const real = el.getContext('2d');
  let ops = [];
  el.getContext = () => new Proxy(real, {
    get(o, k) { const v = o[k]; if (typeof v !== 'function') return v;
      return (...a) => { if (k === 'drawImage') ops.push(a.slice(1).map((x) => typeof x === 'number' ? x.toFixed(3) : '').join(',')); return v.apply(o, a); }; },
    set(o, k, v) { o[k] = v; return true; },
  });
  const clock = globalThis.performance; globalThis.performance = { ...clock, now: () => 1e6 };
  const rnd = Math.random; Math.random = () => 0.42;
  const RR = 8, N2 = RR * 2 + 1;
  const sea = Array.from({ length: N2 }, () => Array.from({ length: N2 }, () => ({ kind: 'land', biome: 'water', flr: 0 })));
  sea[RR - 3][RR] = { kind: 'land', biome: 'water', bt: 'pier', ent: 'south', flr: 1 };
  const field = (dir) => ({ tick: 1, bounds: { minX: 0, maxX: 200, minY: 0, maxY: 200 }, wind: { dir, kph: 34 }, baseCloud: 0.2, precipFloor: 0, floorType: 'none', cells: [] });
  const shot = (dir) => {
    const v = { cls: 'prop', phase: 'cruise', worldBlend: 1, map: sea, heading: 0, speed: 0, hour: 13, height: 0.02, weather: 'clear', wxField: field(dir), acX: 100, acY: 100 };
    ws.paintWindshield('__moving', v); ops = []; ws.paintWindshield('__moving', v); return ops.join('|');
  };
  shot(90);                       // warm every lazy cache and bake
  const w90 = shot(90), w90b = shot(90), w180 = shot(180), w270 = shot(270);
  globalThis.performance = clock; Math.random = rnd;
  if (!w90.length) problems.push('the wind scene drew no textured quads at all — the pier is not reaching the frame, so nothing below means anything');
  else if (w90 !== w90b) problems.push('the same wind twice drew two different frames — the clock or the dice are not pinned, so a difference between bearings proves nothing');
  else {
    if (w90 === w180) problems.push('the flags draw identically at 90° and 180° of wind — they are not following it');
    if (w90 === w270) problems.push('the flags draw identically at 90° and 270° of wind — they are not following it');
  }
  rows.push({ key: 'wind', on: 3, off: 1, why: 'the flags point downwind and re-point when it shifts' });
}

// ── 4. THE BERTH — A SHIP COMES, LOADS AND GOES, AND THE CRANE FOLLOWS HER ──
//
// The shipping cycle is the only thing in the motion layer that two SEPARATE drawers have to agree
// about: the gantry is a `building_type` arm and the freighter is a `mark`, they are different
// tiles in different passes, and all they share is `berthPhase`. Every way that goes wrong is
// silent — a crane working over open water, a ship lying at a berth nobody is loading, a berth
// that is simply always empty — and all three draw a perfectly good picture.
//
// ⚠ THE CLOCK IS HELD STILL AND THE CYCLE IS SWEPT WITH `RENDER_TUNE.shipForce`. The two are the
// same clock: move `now` to advance the shipping cycle and the sea moves under the ship, so the
// frames differ whatever the ship did. The first cut of this check did exactly that and reported
// five poses for a harbour that was correctly parked. With the clock pinned and only the cycle
// swept, any difference between two frames IS the ship.
//
// ⚠ AND THE PARKED POSE IS INVERTED HERE, WHICH IS WHY IT GETS ITS OWN CHECK. Every other cycle in
// this layer comes home to its own u = 0. For a berth u = 0 is OPEN WATER, so the obvious reading
// of "park it" DELETES the ship — the worse half of the bug `RENDER_TUNE.motion` exists to prevent,
// and the one this file refuses for every other arm three checks up.
{
  const el = stubCanvas('__berth', 900, 500);
  const real2 = el.getContext('2d');
  // ⚠ FILLED PATHS ONLY, AND THAT IS NOT A TIDY-UP. GLASS flies a flock of six birds across the
  // mid-sky whose positions are INTEGRATED PER FRAME (`st.birds`, stepped by `dt`) rather than
  // read off the clock, so pinning `performance.now` does not hold them still and two renders of
  // one empty sea differ by six drifting chevrons. They are STROKED; a hull, a container and a
  // wake are FILLED. Collecting a path only when something fills it drops the birds and keeps
  // every part of the ship that carries a position.
  let ops2 = [], pend = [];
  const N = (x) => typeof x === 'number' ? x.toFixed(2) : String(x);
  el.getContext = () => new Proxy(real2, {
    get(o, k) { const v = o[k]; if (typeof v !== 'function') return v;
      return (...a) => {
        if (k === 'beginPath') pend = [];
        else if (k === 'moveTo' || k === 'lineTo') pend.push(k + a.map(N).join(','));
        else if (k === 'fill') { ops2.push(...pend, 'fill'); pend = []; }
        return v.apply(o, a);
      }; },
    set(o, k, v) { o[k] = v; return true; },
  });
  // ⚠ BOTH CLOCKS, AND THE SECOND ONE IS THE POINT. Pinning `performance.now` alone leaves the
  // goose flocks drifting, because the flock clock is deliberately WALL TIME — see the ⚠ over
  // `flockAt`: a page-relative clock resets on every reload and would put the picture and the text
  // game on two zeroes. So a harness that holds only one of them still is comparing two frames of
  // a moving skein and calling the difference a ship.
  // ⚠ SET IT, NEVER ASSUME IT. Check 1 above sweeps every arm with the flag ON and then OFF, and
  // the loop it does that in leaves it OFF — the file only puts it back at the very bottom. A
  // block that inherits that reads a permanently parked harbour and reports every cycle below as
  // broken, which is exactly what the first run of this one did.
  ws.RENDER_TUNE.motion = 1;
  const clock2 = globalThis.performance, rnd2 = Math.random, date2 = Date.now;
  globalThis.performance = { ...clock2, now: () => 1e6 };
  Date.now = () => 1.7e12;
  Math.random = () => 0.42;
  const RR2 = 9, N2 = RR2 * 2 + 1;
  const seaOf = (berth) => {
    const m = Array.from({ length: N2 }, () => Array.from({ length: N2 }, () => ({ kind: 'land', biome: 'water', flr: 0 })));
    // ⚠ AHEAD OF THE CAMERA, NOT UNDER IT. The centre tile is where the eye is and the near clip
    // drops it — the same trap the wind check above records costing three identical frames.
    if (berth) m[RR2 - 4][RR2] = { kind: 'land', biome: 'water', flr: 0, mark: 'berth', bf: 'north', bq: 'west' };
    return m;
  };
  const sea = seaOf(true), bare = seaOf(false);
  const shot = (map, u) => {
    ws.RENDER_TUNE.shipForce = u;
    const v = { cls: 'prop', phase: 'cruise', worldBlend: 1, map, heading: 0, speed: 0, hour: 13, height: 0.02, weather: 'clear', acX: 100, acY: 100 };
    ws.paintWindshield('__berth', v); ops2 = []; ws.paintWindshield('__berth', v);
    return ops2.join('|');
  };
  shot(sea, 0.5);   // warm every lazy cache and bake before anything is compared

  // The control is the SAME SEA AT THE SAME INSTANT WITH NO BERTH ON IT, which is what turns "she
  // is drawn" into a number: everything the ship contributes is what this frame does not have.
  const water = shot(bare, 0.5);
  const twice = shot(bare, 0.5);
  const size = (u) => shot(sea, u).length - water.length;
  const alongside = size(0.50), gone = size(0.02), arriving = size(0.20), leaving = size(0.84);
  const early = size(0.30), late = size(0.70);
  if (water !== twice) problems.push('the same empty sea drew two different frames — the clock or the dice are not pinned, so nothing below is a statement about the ship');
  else if (alongside <= 0) problems.push('the berth draws nothing at all with a ship alongside — the `berth` mark is not reaching the world sweep, and nothing below means anything');
  else {
    if (gone !== 0) problems.push(`the berth still draws ${gone} characters of geometry at the empty point of the cycle — she never sails, so there is no "until the next ship arrives"`);
    if (!(arriving > 0)) problems.push('nothing is drawn on the inbound leg — she appears at the berth rather than coming up the fairway');
    if (!(leaving > 0)) problems.push('nothing is drawn on the outbound leg — she vanishes off the berth rather than steaming out of it');
    if (!(late > early)) problems.push(`the deck stow does not grow: ${early} at the start of the loading window against ${late} near the end of it, so the gantry is stacking boxes into nothing`);
    // ⚠ SHE HAS TO BE IN A DIFFERENT PLACE, not merely drawn in both — a ship whose outbound frame
    // is her alongside frame never left the quay, and every check above passes for her.
    // ⚠ AND THE TWO SAMPLES ARE TAKEN AT THE SAME LOAD, which is the whole of what makes this a
    // check about MOVEMENT. Picked either side of the loading window and the stow differs, so the
    // frames differ whether or not she moved an inch: a first cut compared 0.50 with 0.84 and a
    // mutation that pinned the outbound leg to the berth sailed straight through it. Both of these
    // are past SHIP_LOAD1, so she is fully loaded in both and the only thing left to differ is
    // where she is.
    if (shot(sea, 0.74) === shot(sea, 0.80)) problems.push('the frame alongside and the frame on the outbound leg are identical at the same load — she is not moving, only fading');
  }

  // Parked: ONE pose over the whole cycle, and that pose is a ship at a berth.
  ws.RENDER_TUNE.motion = 0;
  const still = new Set([0.02, 0.20, 0.50, 0.84, 0.95].map((u) => shot(sea, u)));
  const parked = shot(sea, 0.02).length - water.length;
  ws.RENDER_TUNE.motion = 1;
  if (still.size !== 1) problems.push(`the berth has ${still.size} poses with RENDER_TUNE.motion 0 — that flag promises a still harbour, not a slower one`);
  if (!(parked > alongside * 0.5)) problems.push(`parked, the berth draws ${parked} against ${alongside} alongside — "park it" has DELETED the ship, which is the half of that flag's contract this file refuses for every other arm`);

  ws.RENDER_TUNE.shipForce = null;
  globalThis.performance = clock2; Math.random = rnd2; Date.now = date2;
  rows.push({ key: 'berth', on: 5, off: 1, why: 'a freighter comes up the fairway, loads, and steams off again' });
}

// ── 4b. AND THE CRANE STOPS WHEN SHE GOES ───────────────────────────────────
//
// The other end of the same clock, and the thing the whole berth was asked for in so many words:
// the ship sails when the cranes stop. The gantry reads `berthPhase` and stands still outside the
// alongside window, so a sweep taken entirely inside the EMPTY stretch has to come back with one
// pose — while the sweep in check 1 above, which lands in the loading window, comes back with
// several.
// ⚠ THE TWO SWEEPS TOGETHER ARE THE CHECK. Either on its own passes for a crane broken the other
// way about: one pose everywhere is a machine that never runs, and many poses everywhere is a
// machine that never stops.
{
  const m = byKey.get('type:quay_crane');
  if (!m) problems.push('type:quay_crane: not in the model registry — the berth coupling cannot be checked');
  else {
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      ws.RENDER_TUNE.shipForce = 0.92 + i * 0.012;   // the berth stands empty either side of the wrap
      const r = ws.canvasResidue(m, { cam, night: 0, bn: 'THE EXAMPLE', dy: -2, now: i * 3400 });
      if (r.threw) { problems.push('type:quay_crane: threw with the berth empty — ' + r.threw); break; }
      seen.add(JSON.stringify(r));
    }
    ws.RENDER_TUNE.shipForce = null;
    if (seen.size > 1) problems.push(`type:quay_crane: ${seen.size} poses over a stretch with NO SHIP at the berth — the gantry is working an empty quay, so "she sails when the cranes stop" is not true`);
    rows.push({ key: 'quay_crane/empty', on: 1, off: 1, why: 'the gantry stands still while the berth is empty' });
  }
}

// ── 4c. AND THE BOX THE GANTRY LETS GO OF IS THE BOX THAT APPEARS ───────────
//
// The berth's second agreement, and a harder one than "is there a ship": the crane and the hull
// now have to concur about WHICH box, WHAT COLOUR and WHEN. Nothing passes between them — a lift
// is a slice of the working window, and each of them divides that window for itself — so every way
// this drifts draws a crane working beside a ship that is filling, which is what it looked like
// when the two had nothing whatever to do with each other:
//
//   • the hull back on a RAMP, filling continuously while the gantry mimes over the top of it;
//   • the stow advancing by the wrong number, so boxes appear that nobody lifted;
//   • the container on the spreader painted a fixed colour, so what swings out over the water is
//     never what lands;
//   • one gantry working every lift, which with two on the quay is two machines setting down
//     together and one box arriving.
//
// ⚠ AND THE CRANE'S OWN FILLS ARE THE DIFFERENCE BETWEEN TWO SCENES, never a colour found anywhere
// in the frame. The hull is stacked out of the same six colours, so "is that colour on screen" is
// answered yes by her deck whatever the gantry is carrying — the same vacuous-control trap this
// file's wind check records. The berth is rendered with a gantry beside it and again without one,
// and what is only in the first is the machine.
{
  const { berthPhase, berthBoxColour, berthRow, motionTopCss, BERTH_LIFTS, BERTH_SLOTS, BERTH_SETDOWN } = ws;
  const el = stubCanvas('__lift', 900, 500);
  const real3 = el.getContext('2d');
  // The same filled-paths-only recorder check 4 uses, and for the same reason — plus the FILL
  // STYLE, which is the whole question here.
  let ops3 = [], pend3 = [];
  const N3 = (x) => typeof x === 'number' ? x.toFixed(2) : String(x);
  el.getContext = () => new Proxy(real3, {
    get(o, k) { const v = o[k]; if (typeof v !== 'function') return v;
      return (...a) => {
        if (k === 'beginPath') pend3 = [];
        else if (k === 'moveTo' || k === 'lineTo') pend3.push(k + a.map(N3).join(','));
        else if (k === 'fill') { ops3.push(String(o.fillStyle) + '@' + pend3.join('|')); pend3 = []; }
        return v.apply(o, a);
      }; },
    set(o, k, v) { o[k] = v; return true; },
  });
  ws.RENDER_TUNE.motion = 1;
  const clock3 = globalThis.performance, rnd3 = Math.random, date3 = Date.now;
  globalThis.performance = { ...clock3, now: () => 1e6 };
  Date.now = () => 1.7e12;
  Math.random = () => 0.42;
  const RR3 = 9, N4 = RR3 * 2 + 1;
  const mapOf = (crane) => {
    const m = Array.from({ length: N4 }, () => Array.from({ length: N4 }, () => ({ kind: 'land', biome: 'water', flr: 0 })));
    m[RR3 - 4][RR3] = { kind: 'land', biome: 'water', flr: 0, mark: 'berth', bf: 'north', bq: 'west' };
    if (crane) m[RR3 - 4][RR3 - 1] = { kind: 'land', biome: 'docks', flr: 7, bt: 'quay_crane', ent: 'west' };
    return m;
  };
  const quay = mapOf(true), open = mapOf(false);
  const shot3 = (map, u) => {
    ws.RENDER_TUNE.shipForce = u;
    const v = { cls: 'prop', phase: 'cruise', worldBlend: 1, map, heading: 0, speed: 0, hour: 13, height: 0.02, weather: 'clear', acX: 100, acY: 100 };
    ws.paintWindshield('__lift', v); ops3 = []; ws.paintWindshield('__lift', v);
    return ops3.slice();
  };
  shot3(quay, 0.5);   // warm every lazy cache and bake before anything is compared
  // ⚠ WHERE A LIFT STARTS IS BISECTED OUT OF THE RENDERER, not written down here. The working
  // window's own bounds are the berth's business; a gate holding a copy of them would keep agreeing
  // with itself while the thing it is watching moved.
  const uOfLift = (L) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; ws.RENDER_TUNE.shipForce = m;
      if (berthPhase(0).lift >= L) hi = m; else lo = m; }
    return hi;
  };
  const u0 = uOfLift(0), W = uOfLift(1) - u0;
  const uAt = (L, f) => u0 + (L + f) * W;
  const at = (u) => { ws.RENDER_TUNE.shipForce = u; return berthPhase(0); };

  // 1. ONE BOX PER LIFT. Her stow is a step function with exactly one step in it per lift, and each
  //    step is one box — a ramp, a stall or a double count all fail here and only here.
  const aboard = [];
  for (let L = 0; L < BERTH_LIFTS; L++) aboard.push([at(uAt(L, BERTH_SETDOWN - 0.04)).aboard, at(uAt(L, BERTH_SETDOWN + 0.03)).aboard]);
  const steps = aboard.filter(([b, a]) => a - b === 1).length;
  if (steps !== BERTH_LIFTS) problems.push(`the deck stow steps by one box on ${steps} of ${BERTH_LIFTS} lifts — a lift is one box, and the rest of this check is about WHICH box`);
  if (aboard[BERTH_LIFTS - 1][1] - aboard[0][0] !== BERTH_LIFTS) problems.push('she does not end the call BERTH_LIFTS boxes heavier than she started it — the gantries and the stow are counting different things');

  // 2. AND SHE GAINS IT AT THE SET-DOWN AND AT NO OTHER TIME. The anti-ramp assertion, asked of the
  //    PICTURE rather than of the arithmetic: over the whole working window her frame is allowed to
  //    change only where a box joined the stow. ⚠ THE CONVERSE IS NOT ASSERTED — a box can join it
  //    and be hidden behind the ones already there, which is a real outcome at a tier boundary.
  let crept = 0, prevF = null, prevA = null;
  for (let i = 0; i <= 60; i++) {
    const u = uAt(0, 0) + (i / 60) * BERTH_LIFTS * W * 0.999;
    const P = at(u), f = shot3(open, u).join('|');
    if (prevF !== null && f !== prevF && P.aboard === prevA) crept++;
    prevF = f; prevA = P.aboard;
  }
  if (crept) problems.push(`her deck changed ${crept} times over the working window without a box joining the stow — she is filling on a ramp of her own again, and the gantry beside her is miming`);

  // 3. ONE GANTRY WORKS ITS SHARE, AND CARRIES THE COLOUR THE STOW IS ABOUT TO GAIN.
  const worked = [];
  for (let L = 0; L < BERTH_LIFTS; L++) {
    const u = uAt(L, 0.60);                       // mid-stroke: out over her, laden
    // ⚠ THE COLOUR IS ASKED OF THE RENDERER, NOT REBUILT HERE. A box is no longer painted at its raw
    // palette value — `movingBox` shades every face — so `'rgb(' + berthBoxColour(…) + ')'`, which is
    // what this line used to be, named a string that appears in no frame. It went red on a picture
    // that was correct, which is the failure a gate holding its own copy of somebody else's
    // arithmetic always has. See the ⚠ on `motionTopCss`.
    const P = at(u), css = motionTopCss(berthBoxColour(P.box, P.ship), 0);
    const withC = shot3(quay, u), without = new Set(shot3(open, u));
    const crane = withC.filter((x) => !without.has(x));
    if (crane.some((x) => x.startsWith(css + '@'))) worked.push({ L, row: berthRow(P.box), crane: crane.join('|') });
  }
  // ⚠ ONE COUNT, TWO CAUSES, AND FROM OUTSIDE THEY CANNOT BE TOLD APART. "The spreader was carrying
  // this lift's colour" goes wrong both when the gantry works the wrong lifts and when it paints the
  // container something of its own, and a crane that is not laden is drawing the NEXT box on its
  // chassis in a colour off the same six — so there is no fill in the frame that means "laden"
  // independently of the colour being right. The message names both rather than guessing.
  const CAUSES = 'either the two machines on the quay are not taking alternate lifts — so they set '
    + 'down together and one box arrives — or the container on the spreader is painted something of '
    + 'its own, and what swings out over the water is never what lands';
  if (!worked.length) problems.push(`no lift in the call puts the stow's next colour on the spreader — ${CAUSES}`);
  else if (worked.length !== BERTH_LIFTS / BERTH_SLOTS) problems.push(`one gantry carries this lift's own box on ${worked.length} of ${BERTH_LIFTS} lifts, not ${BERTH_LIFTS / BERTH_SLOTS} — ${CAUSES}`);
  // 4. …AND IT STOPS THE TROLLEY OVER THAT BOX'S OWN ROW. Two of its own lifts at the same point in
  //    the stroke, going into different rows across her beam, cannot draw the same crane.
  const pair = worked.find((a, i) => i && a.row !== worked[i - 1].row);
  if (worked.length > 1 && !pair) problems.push('every lift this gantry works goes into the same row — the stow is not walking across her beam, so the trolley has nothing to follow');
  else if (pair && pair.crane === worked[worked.indexOf(pair) - 1].crane) problems.push('the gantry draws identically on two lifts bound for different rows — the trolley is stopping at one fixed spot on her beam while she stows the boxes across six of them');
  rows.push({ key: 'berth/lift', on: BERTH_LIFTS, off: 1, why: 'one box per gantry stroke, in the colour and the row it was carried to' });

  ws.RENDER_TUNE.shipForce = null;
  globalThis.performance = clock3; Math.random = rnd3; Date.now = date3;
}

ws.RENDER_TUNE.motion = 1;

if (REPORT) {
  console.log('\n  poses over a 40 s sweep (motion on / off):');
  for (const r of rows.sort((a, b) => b.on - a.on)) console.log(`    ${String(r.on).padStart(3)} / ${r.off}   ${r.key.padEnd(20)} ${r.why}`);
}

if (problems.length) {
  console.error(`\n✗ moving — ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  if (problems.length > 20) console.error(`  …and ${problems.length - 20} more`);
  process.exit(1);
}

const tot = rows.reduce((a, r) => a + r.on, 0);
if (unseen.length) {
  console.log(`\n  ⚠ ${unseen.length} MUST_MOVE arm(s) this digest cannot observe — declared, not passed:`);
  for (const u of unseen) console.log('    ' + u);
}
console.log(`✓ moving: ${rows.length} arms move and every one of them parks — ${tot} distinct poses across a 40 s sweep, `
  + `down to one each with RENDER_TUNE.motion 0 (${ALSO_DRIFTS.size} declared exception: smoke, which is not a moving part).`);
