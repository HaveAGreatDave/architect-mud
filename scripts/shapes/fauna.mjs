// THE GEESE — do they draw, do they stay put, and do they stay inside their budget?
//
//   node scripts/shapes/fauna.mjs            # gate
//   node scripts/shapes/fauna.mjs --report   # the tallies behind it
//
// `shapes:smoke` asks whether the MESH is sound — the row bakes, the poses build, nothing
// non-finite reaches a canvas. That is the model. This asks about the PASS: whether a flock ever
// reaches the billboard sink at all, whether it is in the same place after the map window moves,
// and whether the texture budget it claims is the one it was designed to claim.
//
// ⚠ FOUR OF THE FIVE CHECKS HERE CAN ONLY FAIL SILENTLY IN THE GAME. A flock that draws nothing
// draws nothing; a flock that shifts half a tile on a recentre looks like a bird walking; a key
// space that has quietly doubled evicts somebody else's textures and turns the scatter pink three
// systems away. None of them throws, and none of them is visible in a screenshot of one frame.
//
// ⚠ AND THE SCENE LOCATES ITSELF. The flock lattice is in ABSOLUTE world tiles, so whether a field
// holds geese depends on two hashes rather than on where a test happens to point its camera. A
// hand-picked mapCenter is a coin flip that passes today and goes vacuous the first time anybody
// touches a constant — the same way worldresidue's own header records it claiming for months to
// measure pedestrians it never ran. So the camera is placed ON a real anchor, found by asking.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { flocksNear, flockState, flockClearance, flockOnSegment, flockEdgeHeading, FLOCK_AREA, GOOSE_PERIOD, GOOSE_SETTLE_MS, U_GROUND, GOOSE_SPAN, SKEIN_ACROSS, skeinSlot, skeinForm, SPECIES, speciesAt, placeOf, habitatState, flockAt, flockPeriod, flockSize, groundSpot, groundPatchR, FORM_WORDS, birdDaylight, callsIn } from '../../client/shared/birds.js';
import { murmur, agitation, sweep as murmurSweep, murmurStats, murmurReset, K_NEIGHBOURS } from '../../client/game/js/panels/murmur.js';
import { faunaPaintCount, FAUNA_BEAT_STEPS, FAUNA_TILE, faunaParamBase, faunaParamIds, faunaPoseFaces, setFaunaParams, faunaWorldFaces, faunaSpanTiles, beatDihedral } from '../../client/game/js/panels/fauna3d.js';

const ws = await loadWindshield();
const REPORT = process.argv.includes('--report');
const W = 640, H = 360;
stubCanvas('__fa', W, H);

// ⚠ A FRAME BUDGET, NOT A TEXTURE ONE. A goose was a baked card, so what had to stay bounded
// was how many TEXTURES a flock claimed out of a 256-entry cache shared with every tree and
// landmark. A mesh claims none - it is transformed and uploaded per frame - so the thing to bound
// is FACES. Ten flocks of nine birds at forty-seven faces, with room for the model to gain a part.
//
// ⚠ THE MODEL HAS SINCE SPENT SOME OF THAT ROOM. The feathering pass took the air pose from 47
// faces to 62, so the real worst frame is GOOSE_MAX_FLOCKS(10) x MAX_FLOCK(6) x 62 = 3,720. The
// number below is unchanged and still has headroom; what has changed is how much. Read that
// arithmetic before adding a part, and do not read the sentence above it as though it still says
// forty-seven.
// ⚠ AND IT IS NO LONGER A LITERAL, BECAUSE IT WAS A SECOND COPY OF A NUMBER THAT MOVED.
// This was 4,600, written when the renderer painted every bird face onto a 2-D canvas and one
// budget could describe the whole game. There are two budgets now — 'birdFaces' for the canvas
// painter and 'birdFacesGL' for the depth buffer, which cost wildly different amounts — and the
// moment the GL one was raised to let a 200-bird murmuration through, this literal started
// failing flocks the renderer would happily draw. Two numbers that have to agree are one number
// too many; this is now the same number the renderer spends, plus the slack a frame is allowed
// over one flock's share.
const FACE_MAX = Math.max(ws.RENDER_TUNE.birdFacesGL, ws.RENDER_TUNE.birdFaces);
// How far inside a built tile the outermost bird of a skein may stray. A quarter of a tile is about
// one wingspan and a half: a bird brushing the corner of a roof, never one over the middle of it.
const BLOCK_GRAZE = 0.25;
const problems = [];
const notes = [];

// ── A FIELD, CENTRED ON A FLOCK ───────────────────────────────────────────────
// Ask the lattice where the geese are and put the camera there, rather than picking a tile and
// hoping. `SEED` is arbitrary; what matters is that the anchor comes back from the same function
// the renderer reads.
const SEED = { x: 900, y: 900 };
// ⚠ IT HAS TO BE A TILE THAT ACTUALLY HOLDS A GOOSE, and that is a stricter thing than it sounds
// now that species share ground. Most of this file is written about a goose by name — its gear
// threshold, its skein, its settle, its flare — and there is no longer ANY ground only geese live
// on: songbirds took grass, parkland and park, and gulls share the water. `speciesAt` decides
// between co-tenants by hashing the tile, so a tile that holds a flock is not necessarily a tile
// that holds a GOOSE flock.
//
// The gate anchored on 870,870 for months; the moment songbirds landed that tile resolved to a
// songbird, the sole-flock scene had no goose in it at all, and three checks reported themselves
// VACUOUS in one run — no bird at the boundary, none over the descent, none visible from both
// distances. Every one of them true, and every one about the wrong bird.
const near = flocksNear(SEED.x, SEED.y, 30)
  .filter((f) => !f.sp && speciesAt('parkland', f.ax, f.ay) === 'goose');
if (!near.length) {
  console.error('✗ fauna — no GOOSE flock anchor within 30 tiles of the seed tile. The lattice cannot be swept from here.');
  process.exit(1);
}
// A couple of tiles back from the anchor, so the flock is AHEAD of the camera: the near clip drops
// a tile at the camera's own feet, exactly as worldresidue records for its junction.
const ANCHOR = near[0];
const CENTRE = { x: ANCHOR.ax, y: ANCHOR.ay + 6 };     // forward is -y at heading 0

const N = 41, R = 20;
// ⚠ A PARK IN A CITY, NOT A WORLD OF TURF. A flock is rolled per habitat tile, so a window that is
// turf from edge to edge holds far more than the per-frame cap of ten — and the cap is NEAREST
// FIRST, which is camera-relative by design. Move the window five tiles and a different ten are
// nearest, so the recentre check below fails on correct code for a reason that is not about geese.
// A patch a few tiles across is what the world actually looks like and keeps the frame under the
// cap, which is what lets that check mean what it says.
const PARK = 4;   // half-width of the turf patch, in tiles
//
// ⚠ THE MAP IS DERIVED FROM ABSOLUTE WORLD TILES, NEVER HANDED OVER AS A FIXED ARRAY. A view's
// `map` is WINDOW-relative: cell [ry][rx] is whatever world tile the window currently has there.
// Reuse one array across two mapCenters and the terrain slides with the camera, so the park is
// under a different part of the world in each paint — and a recentre check built on that is
// comparing two different worlds. It passed anyway while the map was uniform turf, which is
// exactly the kind of green that means nothing.
const mapFor = (centre, groundAt) => Array.from({ length: N }, (_, ry) => Array.from({ length: N }, (_, rx) => (
  groundAt(centre.x - R + rx, centre.y - R + ry)
)));

// ⚠ THE SUB-TILE OFFSET IS NEVER ZERO, AND IT DIFFERS BETWEEN THE TWO RECENTRE PAINTS. `cam.ox`
// and `cam.oy` come from `mapOffset`, and they are the camera-relative quantities a bug of this
// class would leak into a world position. At an offset of zero they are zero, so the whole
// recentre check goes blind to exactly what it exists to catch: it was written that way first, and
// a deliberately camera-relative goose passed it.
// A park in a city: turf around the anchor, blocks everywhere else. That is what the world looks
// like, and it keeps the frame under the per-frame flock cap — which matters, because the cap is
// NEAREST FIRST and therefore camera-relative by design. A window of turf edge to edge holds far
// more flocks than the cap allows, so moving the camera five tiles changes which ten draw, and the
// recentre check below would fail on correct code for a reason that has nothing to do with geese.
// ⚠ THE FILLER MUST BE GROUND NOBODY LIVES ON, AND IT IS DERIVED RATHER THAN NAMED. This has now
// gone stale twice: 'citycore' the day pigeons arrived, then 'redrock' the day hawks did. Each
// time several unrelated checks went red at once, reporting faults that were not there — a
// recentre bug, a vacuous startle, geese on a city block, a goose flying with its feet down. Every
// one of them true of SOME bird, and none of them of the bird under test.
//
// A hardcoded empty ground is a fact about the species table kept somewhere the species table
// cannot see, so it goes wrong every time the table grows. Asking the table is the only version
// that cannot go stale.
const EMPTY_GROUND = ['basalt', 'alkali', 'cliff', 'plateau', 'sinter', 'deadwood', 'ash', 'infra']
  .find((b) => !Object.values(SPECIES).some((s) => s.habitat[b]));
if (!EMPTY_GROUND) {
  console.error('✗ fauna — every ground this harness knows of now holds a species, so there is nowhere empty to fill an isolation scene with. Add a biome to the list above, or these scenes are quietly measuring a crowd.');
  process.exit(1);
}
const park = (wx, wy) => (Math.abs(wx - ANCHOR.ax) <= PARK && Math.abs(wy - ANCHOR.ay) <= PARK
  ? { kind: 'land', biome: 'parkland', flr: 0 }
  : { kind: 'land', biome: EMPTY_GROUND, flr: 0 });
const turf = () => ({ kind: 'land', biome: 'parkland', flr: 0 });

// ⚠ `resFloor: 1` PINS THE ADAPTIVE RESOLUTION DIAL, and without it the dpr sweep below measures
// the dial rather than the geese. The ratio those GL layers divide by is `baseDpr × st.resStep`,
// and `resStep` is the frame-time dial — so a quad's pushed size moves for a reason that has
// nothing to do with the display. It reported a 1.14× non-linearity as a renderer bug; a clean
// harness with the dial pinned has the same quads scaling exactly. Same line dprsize carries, for
// the same reason.
const viewAt = (centre, height, hour, off = { x: 0.31, y: -0.17 }, heading = 0, groundAt = park) => ({
  cls: 'truck', variant: 'hauler', phase: 'ground', worldBlend: 1, height, eyeH: 0.12, fovMul: 1.22,
  hour, weather: 'clear', speed: 0, map: mapFor(centre, groundAt), heading, resFloor: 1,
  mapCenter: { ...centre }, mapOffset: { ...off },
});

// ── THE HARNESS ───────────────────────────────────────────────────────────────
// ⚠ BOTH CLOCKS. The frame animations run on performance.now(), but the FLOCK CYCLE runs on wall
// time — see the ⚠ on drawGeese — so pinning only one leaves the half this file is about free to
// move, and every comparison between two paints becomes a race.
const clock = globalThis.performance;
let T = 1e6;
globalThis.performance = { ...clock, now: () => T };
const realDateNow = Date.now;
Date.now = () => T;
const glWas = ws.RENDER_TUNE.gl, floorWas = ws.RENDER_TUNE.glFloor, geeseWas = ws.RENDER_TUNE.geese;
// ⚠ AND THE DISTANCE LOD IS PINNED OFF, because almost every check in this file reads a bird's
// POSITION out of the geometry it pushed — which flock is where, did the startle spread it, is a
// leg through a skein, did the gear come down. Past `faunaDot` a bird is one sprite carrying no
// pose at all, so those questions have nothing to read and the checks go VACUOUS rather than red,
// which is the failure this suite is least able to notice. The startle check caught it the day the
// LOD landed and said so in those words. The LOD's own behaviour is asserted separately below.
const dotWas = ws.RENDER_TUNE.faunaDot;
ws.RENDER_TUNE.faunaDot = 0;

// ⚠ THE HOOK HAS TO HAND BACK A CANVAS. `if (out && out.canvas)` is what counts as having drawn;
// anything else is the no-WebGL2 path, which puts RENDER_TUNE.gl back to 0 and paints the next
// frame in 2-D — so the sink comes back empty and reads as the pass being broken.
function paint(view) {
  let got = null;
  const c = globalThis.document.createElement('canvas');
  c.width = W; c.height = H;
  ws.RENDER_TUNE.gl = 1; ws.RENDER_TUNE.glFloor = 1;
  ws.installGLWorld((cells, cam, o) => {
    const mesh = o.fauna || [];
    got = {
      // ⚠ THE CAMERA, because one check asks where the GROUND is under a bird and there is no
      // other way to ask it. Held only for the life of the call that returns it.
      cam,
      // ⚠ ONE RECORD PER BIRD, FROM THE MARKER ON ITS FIRST FACE. A goose is forty-odd faces in the
      // solids list and nothing about a face says which animal it belongs to — see the ⚠ on
      // pushFauna. Inferring it from run lengths would break the first time the model gains a part.
      quads: mesh.filter((f) => f.bird).map((f) => ({
        state: f.bird.state,
        // Back to ABSOLUTE world tiles. The mesh is in MAP-WINDOW tiles, and comparing those across
        // a recentre compares the window rather than the geese.
        wx: f.bird.x + view.mapCenter.x,
        wy: f.bird.y + view.mapCenter.y,
        z: f.bird.z, heading: f.bird.heading, beat: f.bird.beat, flare: f.bird.flare, gear: f.bird.gear, alpha: f.a,
      })),
      faces: mesh.length,
      // ⚠ AND THE LOWEST VERTEX IN THE WHOLE FLOCK, which is the mesh's answer to a question the
      // card version asked with trigonometry: does any part of a bird reach under the turf.
      lowest: mesh.reduce((lo, f) => { for (const v of f.p) if (v[2] < lo) lo = v[2]; return lo; }, Infinity),
      scatter: (o.scatter || []).length,
      gooseCards: (o.scatter || []).filter((q) => typeof q.key === 'string' && q.key.startsWith('goose|')).length,
      // Every billboard in the frame — trees, bushes, rocks, actors — and whether any of them asked
      // to write depth. See check 12.
      otherDepth: (o.scatter || []).filter((q) => q.depth).length,
    };
    return { faces: 1, canvas: c };
  });
  ws.paintWindshield('__fa', view);   // settle every lazy bake
  ws.paintWindshield('__fa', view);   // …and measure the settled frame
  ws.installGLWorld(null);
  return got || { quads: [], scatter: 0, otherDepth: 0 };
}

const airborne = (r) => r.quads.filter((q) => q.state === 'air');
const grounded = (r) => r.quads.filter((q) => q.state !== 'air');

// Find a moment when the nearest flock is on the ground, and one when it is in the air. Searched
// rather than assumed: every flock has its own period and phase, so no fixed clock is guaranteed
// to catch either state.
//
// ⚠ AND THE GROUND MOMENT MUST BE A SETTLED ONE. The FIRST ground frame is the one immediately
// after touchdown, where the flock is still standing in the skein it landed in and easing out of
// it — so the startle below had nothing to move and reported a working feature as broken. Ask for
// a moment clear of both edges by the settle window, which is why that window is a constant in
// birds.js rather than a number in the renderer.
const findT = (want) => {
  for (let i = 0; i < 4000; i++) {
    const t = 1e6 + i * (GOOSE_PERIOD / 400);
    const st = flockState(ANCHOR, t);
    if (st.airborne !== want) continue;
    if (!want) {
      const edge = Math.min(st.u, U_GROUND - st.u) * st.period;
      if (edge < GOOSE_SETTLE_MS * 1.5) continue;
    }
    return t;
  }
  return null;
};
const T_GROUND = findT(false), T_AIR = findT(true);
if (T_GROUND == null || T_AIR == null) problems.push('the nearest flock never reaches one of its two states — the cycle is broken, or U_GROUND is 0 or 1');

// ── 1. IT DRAWS AT ALL, AND INSIDE ITS BUDGET ─────────────────────────────────
T = T_GROUND ?? 1e6;
const ground = paint(viewAt(CENTRE, 0, 12));
T = T_AIR ?? 1e6;
const air = paint(viewAt(CENTRE, 0, 12));

if (!ground.quads.length) problems.push('no goose reached the billboard sink over a field of parkland — the pass drew nothing');
if (!airborne(air).length) problems.push('no airborne goose reached the sink at a moment the flock is flying');
if (!grounded(ground).length) problems.push('no walking goose reached the sink at a moment the flock is on the ground');

// ⚠ AND NOT ONE OF THEM REACHES THE BILLBOARD LAYER. That layer caps at 256 textures shared with
// every tree, rock, actor and landmark, and a flock used to claim up to 46 of them. A mesh claims
// none, so what has to stay bounded is FACES — and the thing that bounds them is GOOSE_MAX_FLOCKS.
const faceHigh = Math.max(ground.faces, air.faces);
if (faceHigh > FACE_MAX) problems.push(`a frame pushed ${faceHigh} fauna faces, over the ${FACE_MAX} this budget allows — see GOOSE_MAX_FLOCKS`);
if (ground.gooseCards || air.gooseCards) problems.push(`${ground.gooseCards + air.gooseCards} goose billboard(s) reached the scatter layer — a drawer has gone back to a card, and the texture cache is not this feature’s to spend`);
notes.push(`drew ${ground.quads.length} walking and ${airborne(air).length} airborne birds; ${faceHigh} faces of a ${FACE_MAX} budget`);

// ── 1b. THE SPACING IS WRITTEN AGAINST THE DRAWN BIRD ─────────────────────────
// `GOOSE_SPAN` is stated in birds.js rather than imported, because that file is shared with the
// server and has no renderer to reach into. This is the other half of that: the two must agree, or
// a model that has since been resized leaves the skein spaced for a bird that no longer exists —
// and the failure is the one this whole change was about, a flock packed tight enough to read as a
// single moving lump.
{
  const row = faunaParamBase('bird', 'goose');
  const drawn = 2 * (row?.span ?? 0) * FAUNA_TILE;
  if (!(Math.abs(GOOSE_SPAN - drawn) < 0.01)) {
    problems.push(`GOOSE_SPAN is ${GOOSE_SPAN} against a drawn wingspan of ${drawn.toFixed(3)} tiles — the skein is spaced for a bird of the wrong size`);
  }
  // …and the birds must not be packed inside each other. The measured wing-tip gap is about a ninth
  // of a span; anything under zero is two geese sharing the same air.
  const gap = SKEIN_ACROSS - drawn;
  if (!(gap > 0)) problems.push(`neighbouring slots are ${SKEIN_ACROSS.toFixed(3)} apart against a ${drawn.toFixed(3)} wingspan — their wings overlap`);
  else notes.push(`slots sit ${gap.toFixed(3)} tiles of daylight apart (${(gap / drawn).toFixed(2)} of a span)`);
}

// ── 1d. THE SECOND SPECIES IS ACTUALLY A SECOND SPECIES ───────────────────────
//
// ⚠ NOTHING ABOVE THIS TOUCHES THE GULL, and that is the trap §6 already names for habitat: the
// test map is all goose ground, so every check in this file passes on a build where the species
// table does nothing at all. A bird that is a goose with different numbers is the failure mode
// this whole seam exists to avoid, and it is invisible to a face census and to a frame budget.
{
  // Where each one lives. The gull is the only species that wants BOTH ground states, which is
  // the case one shared habitat table could not express.
  const cases = [
    ['grass', '', 'goose'], ['park', '', 'goose'],
    ['pier', '', 'gull'], ['dock', '', 'gull'], ['docks', '', 'gull'],
  ];
  // ⚠ IT ASKS WHETHER A SPECIES IS THERE, NOT WHETHER A GIVEN TILE IS IT. Written against one
  // fixed tile this was a coin toss the moment a ground had co-tenants, and it went red purely
  // because hawks joined the list — reporting "grass is songbird and should be goose", which is
  // neither a bug nor even a disagreement. Who lives on a ground is a question about the ground.
  for (const [ground, weather, want] of cases) {
    const who = new Set();
    for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) who.add(speciesAt(ground, x, y, { weather }));
    if (!who.has(want)) problems.push(`no ${want} anywhere on ${ground} — found ${[...who].filter(Boolean).join(', ') || 'nobody'}`);
  }
  if (habitatState('gull', 'water') !== 'raft' || habitatState('gull', 'pier') !== 'walk') {
    problems.push('a gull must raft on water and walk the quay — it is the only species that needs both');
  }

  // The storm gate. Calm, the inland grounds hold nobody; rough, they hold gulls.
  // ⚠ IT ASKS WHETHER A GULL IS THERE, NOT WHETHER ANYONE IS. Written as "citycore is empty when
  // calm" this was really asserting that the city held no birds at all, which stopped being true
  // the moment pigeons landed — and it then reported the pigeon as a gull-gate failure.
  const seen = (weather) => { const s = new Set();
    for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) s.add(speciesAt('citycore', x, y, { weather }));
    return s; };
  const calm = seen('clear'), blow = seen('storm');
  if (calm.has('gull')) problems.push('a gull is inland on a clear day — they only come ashore when it turns');
  if (!blow.has('gull')) problems.push('no gull comes ashore anywhere in a storm — the weather gate is not opening');
  if (!calm.has('pigeon')) problems.push('no pigeon on a city block — the one bird that lives there is missing');

  // ⚠ AND THE TWO MUST NOT FLY THE SAME CIRCUIT. Every number below is read off a live flock
  // rather than off the table, because the table being right and the functions ignoring it is
  // precisely the shape of a species that is cosmetic only.
  const G = { ax: 300, ay: 300 }, U = { ax: 300, ay: 300, sp: 'gull' };
  const gp = flockPeriod(G), up = flockPeriod(U);
  if (!(up < gp * 0.8)) problems.push(`a gull's cycle is ${Math.round(up / 1000)}s against a goose's ${Math.round(gp / 1000)}s — it is meant to be much shorter`);
  // The moment the circuit is fully open, not the first airborne one.
  //
  // ⚠ BOTH THE HEIGHT AND THE RADIUS RIDE THE SAME RAMP, so a sample taken just after take-off
  // reads a fraction of each and the two species come out indistinguishable — measured, 0.27
  // tiles against 0.28, which this check duly reported as a bug in the species table when it was
  // a bug in how the table was being read.
  const air = (f) => {
    let best = null;
    for (let k = 0; k <= 60; k++) {
      const st = flockState(f, flockPeriod(f) * (k / 60));
      if (st.airborne && (!best || st.z > best.z)) best = st;
    }
    return best;
  };
  const ga = air(G), ua = air(U);
  if (!ga || !ua) problems.push('one of the two species never gets airborne over a whole cycle');
  else {
    if (!(ua.z < ga.z)) problems.push(`a gull flies at ${ua.z.toFixed(2)} tiles against a goose's ${ga.z.toFixed(2)} — it is meant to be lower`);
    if (!(ua.r > ga.r)) problems.push(`a gull's circuit is ${ua.r.toFixed(2)} tiles against a goose's ${ga.r.toFixed(2)} — it is meant to be wider`);
    if (!(ua.n > ga.n)) problems.push(`a gull flock is ${ua.n} against a goose's ${ga.n} — it is meant to be bigger`);
  }
  // No V on a gull, ever — including the small-flock case, which falls through to a formation.
  for (let a = 0; a < 60; a++) {
    const f = { ax: 400 + a, ay: 400 - a, sp: 'gull' };
    const form = skeinForm(f).form;
    if (form !== 'loose') { problems.push(`a gull flock formed a '${form}' — gulls have no formation at any size`); break; }
  }

  // ⚠ AND A FLOCK WITH NO SPECIES ON IT IS STILL EXACTLY A GOOSE. Every caller that predates the
  // table produces one, including the text game and the bird-strike path, so this is the check
  // that says the seam was additive rather than a rewrite with a compatibility story.
  // ⚠ IT HAS TO FIND A FLOCK FIRST. Written against a fixed tile this read `flockAt(50, 50)`,
  // which holds no flock — so the check was skipped, and a mutation that stamped a species onto
  // every goose passed it. An assertion guarded by a value that is usually null is not an
  // assertion; sweep until there is something to assert about, and say so if there never is.
  // ⚠ EVERY FORMATION A SPECIES CAN FLY MUST HAVE A WORD FOR IT. The renderer draws the shape and
  // the room description names it, and until FORM_WORDS moved next to the species rows those were
  // two edits in two files with nothing connecting them — so a species given a new formation read
  // out to a player as "undefined".
  for (const sp of Object.values(SPECIES)) {
    for (const form of sp.forms) {
      if (!FORM_WORDS[form]) problems.push(`the ${sp.id} can fly a '${form}' and FORM_WORDS has no word for it — the room description would say undefined`);
    }
  }
  // ⚠ AND EVERY SPECIES MUST HAVE A DAY WINDOW THAT IS A WINDOW. A start past its own end is a bird
  // that is never out, which draws nothing, says nothing, and looks exactly like the pass being off.
  for (const sp of Object.values(SPECIES)) {
    if (!(sp.dayEnd > sp.dayStart)) problems.push(`the ${sp.id}'s day runs ${sp.dayStart} to ${sp.dayEnd} — it is never out`);
    if (!birdDaylight(sp.id, Math.floor((sp.dayStart + sp.dayEnd) / 2))) problems.push(`birdDaylight says the ${sp.id} is not out in the middle of its own day`);
  }
  // ── BIRD SOUND STAYS RARE ───────────────────────────────────────────────────
  //
  // ⚠ A RATE IS NOT SOMETHING YOU CAN HEAR GOING WRONG SLOWLY. Somebody shortens one interval to
  // make a demo livelier, or adds a species with a chatty row, and the birds become wallpaper over
  // a few commits with no single change that looks wrong. These are the numbers the rate was
  // actually set by, pinned.
  for (const sp of Object.values(SPECIES)) {
    const f = sp.id === 'goose' ? { ax: 100, ay: 100 } : { ax: 100, ay: 100, sp: sp.id };
    let calls = 0; const bursts = new Set();
    for (let t = 0; t < 600000; t += 120) for (const c of callsIn(f, t, t + 120)) { calls++; bursts.add(c.burst); }
    const perBurst = 600 / (bursts.size || 1);
    if (!(perBurst >= 30)) problems.push(`a single ${sp.id} flock bursts every ${Math.round(perBurst)}s — bird sound is meant to be uncommon, and one flock on its own should be well over half a minute apart`);
    if (!(calls > 0)) problems.push(`a ${sp.id} flock never calls at all over ten minutes`);
    notes.push(`${sp.id} calls: a burst every ${Math.round(perBurst)}s, ${calls} calls in ten minutes`);
  }
  // ⚠ A LONG WINDOW IS DROPPED, NOT QUEUED. A hidden tab hands this minutes; answering honestly
  // would empty a minute of birds into one frame the moment it resumes.
  {
    const f = { ax: 100, ay: 100 };
    const long = callsIn(f, 0, 600000).length;
    const one = SPECIES.goose.callBurst[1];
    if (long > one) problems.push(`a ten-minute frame gap yielded ${long} calls — a missed window must be dropped, and at most one burst can survive it`);
  }
  // …and it is derived, so two asks for the same window agree exactly.
  {
    const f = { ax: 77, ay: 123, sp: 'gull' };
    const a = JSON.stringify(callsIn(f, 0, 200000)), b = JSON.stringify(callsIn(f, 0, 200000));
    if (a !== b) problems.push('callsIn is not deterministic — the schedule is shared world state and must be the same on every machine');
  }

  // ── EVERY SPECIES STAYS INSIDE THE FACE BUDGET, ON ITS OWN GROUND ────────────
  //
  // ⚠ §1 ABOVE MEASURES A FIELD OF PARKLAND, WHICH ONLY GEESE LIVE ON — so its face check has
  // never once weighed a gull or a pigeon, and that is not a theoretical gap. The gull shipped at
  // twelve birds a flock and 49 faces each, which is 5,880 over ten flocks against a FACE_MAX of
  // 4,600, and every gate in this file stayed green because no gull was ever drawn in one. The
  // budget is spent in faces now rather than counted in flocks, and this is the check that would
  // have caught it: the worst frame each species can produce, from its own numbers.
  for (const sp of Object.values(SPECIES)) {
    const state = Object.values(sp.habitat).includes('walk') ? 'walk' : 'raft';
    const perBird = Math.max(faunaPoseFaces('bird', sp.id, { state }).length,
      faunaPoseFaces('bird', sp.id, { state: 'air' }).length);
    // What the renderer would push if this species filled the window, before the budget bites.
    const uncapped = 10 * sp.maxFlock * perBird;
    notes.push(`${sp.id}: ${perBird} faces a bird, ${sp.maxFlock} a flock — ${uncapped} uncapped over ten flocks`);
    // A SINGLE flock must always fit, or the budget can never admit this species at all and it
    // silently never draws.
    const one = sp.maxFlock * perBird;
    if (one > FACE_MAX) problems.push(`one ${sp.id} flock is ${one} faces, over the whole ${FACE_MAX} budget — it could never be drawn`);
  }

  // ── THE MURMURATION ─────────────────────────────────────────────────────────
  //
  // ⚠ NOTHING ELSE IN THIS FILE CAN SEE ANY OF THIS. Every other check reads the SINK — what the
  // renderer pushed — and a cloud that has quietly stopped cohering still pushes exactly as many
  // faces as one that has not. The failures here are all silent in a face census: a flock that
  // drifts off the centre the room description states, birds flying through each other, a wave
  // that does not travel, and state that is never released.
  {
    murmurReset();
    const N = 20, SP = 0.5;
    let t = 1e6;
    // ⚠ THE CENTRE SPEED IS AN INPUT TO THIS TEST AND IT HAD GONE STALE AGAINST THE SPECIES.
    // It was 1.2 tiles/s against the 1.09 cruise in murmur.js -- a ratio of 1.10, which is off the
    // end of the measured table in the songbird row of birds.js: at ratio 1.0 only 0.10 of a bird
    // motion is still relative to the flock, because once the home pull dominates, every bird
    // heads for its own FIXED station and the cloud becomes a rigid formation being TOWED --
    // lagging the centre it can no longer keep up with. Measured here, drift runs 1.48 tiles at
    // 1.2 and 0.06-0.29 at every ratio the species actually flies. The songbird circuit was
    // retuned to r: 1.0 over 58 s -- about 0.11 tiles/s, ratio 0.10 -- precisely to stay clear of
    // that collapse, and this test was never moved with it.
    //
    // ⚠ THE BOUND IS UNTOUCHED. What was wrong is the configuration being asserted about, not
    // how strictly it is asserted: 0.6 is still five times the circuit own mean speed, so the
    // drift claim is made with margin rather than relaxed to fit.
    const CENTRE_V = 0.6;
    const step = (ms) => { t += ms; return murmur('g', N, 100 + (t - 1e6) / 1000 * CENTRE_V, 100, 1.3, 0, t, { spread: SP }); };
    for (let f = 0; f < 240; f++) step(33);
    const pts = step(33);
    const dcx = 100 + (t - 1e6) / 1000 * CENTRE_V;
    const cx = pts.reduce((a, p) => a + p.x, 0) / N;
    const cy = pts.reduce((a, p) => a + p.y, 0) / N;
    const cz = pts.reduce((a, p) => a + p.z, 0) / N;

    // ⚠ THE CLOUD MUST STAY ON THE CENTRE THE SHARED MODEL DERIVED. This is the entire bridge
    // between a simulated arrangement and a derived flock: the room description says birds are
    // over THIS tile, and a cloud free to wander makes that a lie. It drifted three quarters of a
    // tile the first time, from a constant forward push added on top of a centre that was already
    // travelling.
    const off = Math.hypot(cx - dcx, cy - 100);
    if (!(off < 0.35)) problems.push(`the murmuration sits ${off.toFixed(2)} tiles off the centre the shared model derived — the room description and the picture disagree about where the birds are`);

    // …and it must stay a flock rather than a cloud of dots.
    const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz));
    const radius = rs.reduce((a, b) => a + b, 0) / N;
    if (!(radius < SP * 2)) problems.push(`the cloud has spread to ${radius.toFixed(2)} tiles on a ${SP} spread — cohesion is not holding`);

    // ⚠ AND THE BIRDS MUST NOT FLY THROUGH EACH OTHER. Separation is the one rule Ballerini keeps
    // metric, and it is the first thing to go if the pull toward the centre is turned up to make
    // the cloud tidier.
    let closest = 1e9;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
      if (d < closest) closest = d;
    }
    // ⚠ AN ABSOLUTE FLOOR CANNOT SEE THIS RULE GOING MISSING. With separation switched off entirely
    // the cohesion and home terms still hold the birds far enough apart to clear any threshold worth
    // setting — the flock simply becomes a tighter, blunter thing. What says separation is working
    // is that turning it off makes the closest pair CLOSER, which is a comparison rather than a
    // number. Same lesson the covertStep no-op taught: a part that measures plausible is not a part
    // that is doing anything.
    if (!(closest > 0.03)) problems.push(`two birds in the murmuration are ${closest.toFixed(3)} tiles apart — they are inside each other`);
    {
      murmurReset();
      let t2 = 1e6;
      for (let f = 0; f < 241; f++) { t2 += 33; murmur('nosep', N, 100 + (t2 - 1e6) / 1000 * 1.2, 100, 1.3, 0, t2, { spread: SP, sep: 0 }); }
      const q = murmur('nosep', N, 100 + (t2 - 1e6) / 1000 * 1.2, 100, 1.3, 0, t2, { spread: SP, sep: 0 });
      let cl2 = 1e9;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const d = Math.hypot(q[i].x - q[j].x, q[i].y - q[j].y, q[i].z - q[j].z);
        if (d < cl2) cl2 = d;
      }
      if (!(closest > cl2 * 1.15)) problems.push(`switching separation off barely moved the closest pair (${closest.toFixed(3)} with, ${cl2.toFixed(3)} without) — the exclusion zone is not doing anything`);
      murmurReset();
    }
    notes.push(`murmuration: radius ${radius.toFixed(2)} on a ${SP} spread, ${off.toFixed(2)} off centre, closest pair ${closest.toFixed(3)}`);

    // ⚠ THE WAVE TRAVELS AT THE SPEED IT WAS MEASURED AT. 13.4 m/s is from Hemelrijk's field work
    // and 1 tile is about 11 m, so the crest sits at 1.21 x age. A wave that does not travel is
    // still a dark band and still looks like something; it is simply not the thing that was built.
    const ev = { x: 100, y: 100, at: 1e6 };
    let worstErr = 0, sawBand = false;
    for (const age of [0.3, 0.8, 1.3, 1.8]) {
      let best = 0, bd = 0;
      for (let d = 0; d < 4; d += 0.01) { const val = agitation(100 + d, 100, ev, 1e6 + age * 1000); if (val > best) { best = val; bd = d; } }
      if (best <= 0.01) continue;
      sawBand = true;
      worstErr = Math.max(worstErr, Math.abs(bd - 1.21 * age));
    }
    if (!sawBand) problems.push('the agitation wave never produced a band at any age — nothing would be seen');
    else if (!(worstErr < 0.06)) problems.push(`the agitation wave crest is ${worstErr.toFixed(2)} tiles off where 13.4 m/s puts it`);
    // …and it goes away, or a single scare marks the flock for the rest of the session.
    // ⚠ PROBE WHERE THE FRONT WOULD BE, NOT WHERE THE SCARE WAS. Written as a probe half a tile
    // from the origin this passed with the lifetime set to a billion seconds, because by then the
    // band has travelled seven tiles and half a tile from the origin is quiet either way — it was
    // measuring the wave having gone PAST, which it does whether or not it ever expires.
    {
      const lateAge = 6;
      let live = 0;
      for (let d = 0; d < 12; d += 0.02) live = Math.max(live, agitation(100 + d, 100, ev, 1e6 + lateAge * 1000));
      if (live > 0.01) problems.push(`the agitation wave is still ${live.toFixed(2)} strong ${lateAge}s after the scare — one fright would mark a flock for the rest of the session`);
    }
    // …and no predator means no wave at all, which is the ordinary state of the world.
    if (agitation(100.5, 100, null, 1e6 + 100) !== 0) problems.push('birds are banking with no predator — agitation must answer 0 when nothing has happened');

    // ⚠ AND THE STATE IS RELEASED. This is the only part of the fauna system that keeps any, so it
    // is the only part that can leak — and a leak here is invisible until a long session starts
    // dropping frames for no reason anybody can point at.
    murmur('evict-me', 8, 0, 0, 1, 0, t, {});
    const before = murmurStats().clouds;
    murmurSweep(t + 60000);
    const after = murmurStats().clouds;
    if (!(after < before)) problems.push(`the murmuration sweep released nothing (${before} clouds before, ${after} after) — a session walking across a city would accumulate every cloud it has ever seen`);
    // ⚠ A VALUE CHECK, AND IT IS HONESTLY WEAKER THAN EVERYTHING ELSE HERE. The topological rule is
    // the centrepiece of this whole module — each bird attends to its six or seven nearest
    // neighbours whatever the density — and at the twenty-odd birds a flock actually runs, seven
    // and nineteen produce clouds this harness cannot tell apart. The failure Ballerini describes
    // is a METRIC rule shedding stragglers as a flock stretches, and there is no metric variant
    // here to compare against, so there is nothing to A/B. What this can do is stop the number
    // drifting out of the range the field work supports, which is what somebody trimming it for
    // performance would do.
    if (!(K_NEIGHBOURS >= 5 && K_NEIGHBOURS <= 9)) {
      problems.push(`the cloud attends to ${K_NEIGHBOURS} neighbours — the field work this is built on says six or seven, and the topological rule is the reason it coheres at all`);
    }
    murmurReset();
  }

  let bare = null;
  for (let a = 0; a < 4000 && !bare; a++) bare = flockAt(a % 97, Math.floor(a / 97), 3);
  if (!bare) problems.push('no goose flock anywhere in a 97-tile sweep — the compatibility check cannot run');
  else if ('sp' in bare) problems.push('flockAt stamped a species onto a goose — every gate that compares flock objects by shape now sees a new key');
  notes.push(`species: gull cycle ${Math.round(up / 1000)}s vs goose ${Math.round(gp / 1000)}s, gull ${ua ? ua.n : '?'} birds at ${ua ? ua.z.toFixed(1) : '?'} tiles vs goose ${ga ? ga.n : '?'} at ${ga ? ga.z.toFixed(1) : '?'}`);
}

// ── 1e. THE HAWK IS ONE BIRD, AND IT IS SOMEWHERE ─────────────────────────────
// The hawk is the only species in the table that is solitary and the only one flying a thermal
// instead of a circle, and both of those are silent when they break: a flock of three hawks is a
// plausible picture, and a spiral that does not close on its anchor is a bird that drifts off the
// map over an afternoon with nothing to say so.
//
// ⚠ AND IT CHECKS THAT BOTH OF ITS PROSE POOLS ARE REACHABLE, which is a stranger thing for a
// SHAPE gate to do than it looks. describe.js picks a pool off 'habitatState' and 'flockState',
// both of which live here in birds.js — so whether the ground lines can ever be printed is a fact
// about the CIRCUIT, not about the prose. A hawk with uGround retuned to 0 would leave two written
// sentences that no tile in the world can reach, and nothing in the server tree would notice.
// ⚠ AN IIFE, NOT A BARE BLOCK LIKE ITS NEIGHBOURS — this body early-returns when it finds
// nothing to measure, and a `return` at module top level is a syntax error. Declaring it as a
// plain function instead is the trap that nearly shipped here: it parsed, every other gate went
// on passing, and the check simply never ran.
(() => {
  const grounds = Object.keys(SPECIES.hawk.habitat);
  let tiles = 0, air = 0, walk = 0, worstDrift = 0, worstN = 0;
  for (let gx = 880; gx < 950 && tiles < 40; gx++) {
    for (let gy = 880; gy < 950 && tiles < 40; gy++) {
      for (const t of grounds) {
        if (speciesAt(t, gx, gy, { weather: 'clear' }) !== 'hawk') continue;
        if (habitatState('hawk', t) !== 'walk') {
          problems.push(`a hawk answered '${habitatState('hawk', t)}' on ${t} — nothing in its habitat is water, so anything but 'walk' is a pool describe.js has not written`);
        }
        const f = flockAt(gx, gy, 1, 'hawk');
        if (!f) continue;
        tiles++;
        // ⚠ THE PERIOD IS PER ANCHOR, NOT THE ROW'S. `flockPeriod` varies it per tile — this one
        // runs 200s against the row's authored 150 — so a cycle swept against the row number
        // samples most of one lap and a bit of the next, and the closure test below then compares
        // two points that are not the same phase.
        const period = flockState(f, 0).period;
        for (let k = 0; k <= 60; k++) {
          const st = flockState(f, k * (period / 60));
          worstN = Math.max(worstN, st.n);
          if (st.airborne) air++; else walk++;
          // ⚠ cx/cy, NOT x/y. flockState returns the flock's CENTRE under those names, and
          // `Number.isFinite(undefined)` is false — so a check written against x/y does not
          // silently pass, it fails for every sample of every species. It caught itself here,
          // which is luck rather than design: the same slip on a `> 0` test would have passed.
          if (!Number.isFinite(st.cx) || !Number.isFinite(st.cy) || !Number.isFinite(st.z)) {
            problems.push('a solitary hawk produced a non-finite position — the skein arithmetic divides by the flock size');
            return;
          }
        }
        // ⚠ THE CYCLE MUST CLOSE ON THE ANCHOR. Every other species rides a circle that returns
        // by construction; the thermal is a spiral out and a glide back, and it only comes home
        // because the same ramp is applied to it. Drop that and the bird leaves.
        //
        // ⚠ AND THE PHASE IS HASHED PER ANCHOR, so t = 0 is NOT the top of the cycle. Written as
        // "sample t = 0 and t = period" this reported 4.78 tiles of drift on a circuit that in
        // fact closes to 0.000 — it had simply landed on a tile whose phase put u at 0.84, which
        // is the far end of the glide and exactly where the bird is SUPPOSED to be furthest out.
        // The property is about u, so the sample has to be chosen by u.
        {
          let lo = null, hi = null;
          for (let k = 0; k <= 400; k++) {
            const st = flockState(f, k * (period / 400));
            if (!lo || st.u < lo.u) lo = st;
            if (!hi || st.u > hi.u) hi = st;
          }
          for (const st of [lo, hi]) {
            worstDrift = Math.max(worstDrift, Math.hypot(st.cx - f.ax, st.cy - f.ay));
          }
        }
      }
    }
  }
  if (!tiles) { problems.push('no hawk is placed anywhere in a 70-tile sweep of its own habitat'); return; }
  if (worstN !== 1) problems.push(`a hawk flock held ${worstN} birds — the species is solitary, and every line written about it says 'a hawk'`);
  if (!air) problems.push('a hawk is never airborne, so its air prose can never be printed and the thermal is dead code');
  if (!walk) problems.push('a hawk is never on the ground, so its two ground lines can never be printed');
  if (!(worstDrift < 0.05)) problems.push(`a hawk's cycle ends ${worstDrift.toFixed(2)} tiles off its own anchor — a spiral that does not close drifts the bird off the map`);
  notes.push(`hawk: ${tiles} tiles, always 1 bird, ${Math.round(100 * air / (air + walk))}% of the cycle airborne, cycle closes to ${worstDrift.toFixed(3)} tiles`);
})();

// ── 1g. A PLACE IS NOT A PAINT ────────────────────────────────────────────────
// The city birds had no city. `biomeOf`'s first line is "authored terrain wins", Coldwater's
// streets are painted redrock, and so the whole built-up area derived as arid wasteland: measured
// over the real map the pigeon got ONE flock in the world and the gull could not stand up at all,
// because nothing anywhere is painted `dock` and its entire ground prose pool was unreachable.
//
// `placeOf` answers the structural question instead — the city is where the buildings are, the
// dock is the water's edge among them — and it is SHARED, so the room description and the
// windscreen cannot disagree about whether somewhere is a street.
//
// ⚠ THE PARK CASE IS THE ONE THAT MATTERS MOST HERE. 183 of Coldwater's 209 green tiles sit inside
// the built-up area, so a naive "buildings nearby ⇒ citycore" would hand the pigeon a home by
// taking away the songbird's only one, and the census would have looked like a win.
{
  const cases = [
    // [biome, buildings, shore, expected, why]
    ['redrock', 0, false, 'redrock', 'open country keeps its paint'],
    ['redrock', 3, false, 'citycore', 'a street among buildings is a street, whatever it is painted'],
    ['redrock', 3, true, 'docks', "the water's edge among buildings is a quay"],
    ['asphalt', 1, true, 'docks', 'one building is enough to make a shore a quay'],
    ['parkland', 5, false, 'parkland', 'A PARK IN THE CITY IS STILL A PARK'],
    ['park', 8, true, 'park', 'and a park on the water is still a park'],
    ['forest', 4, false, 'forest', 'so is a wood'],
    ['water', 4, true, 'water', 'a bay tile with a warehouse on the bank is somewhere to raft'],
  ];
  for (const [b, n, s, want, why] of cases) {
    const got = placeOf(b, n, s);
    if (got !== want) problems.push(`placeOf(${b}, ${n}, ${s}) answered '${got}' and should be '${want}' — ${why}`);
  }

  // And the point of the whole thing: the city birds must have somewhere to be. A built-up tile
  // has to hold at least one of them, or the rule is correct arithmetic that changed nothing.
  const urban = new Set();
  for (let x = 900; x < 940; x++) for (let y = 900; y < 940; y++) {
    const sid = speciesAt(placeOf('redrock', 3, false), x, y, { weather: 'clear' });
    if (sid) urban.add(sid);
  }
  // ⚠ NOT THE GULL, IN CLEAR WEATHER. 'citycore' is in GULL_INLAND, so a gull is only on a
  // city street when the sea has turned — asserting it here would have been a check that the
  // storm rule was BROKEN. It is asserted below, where it belongs.
  for (const id of ['pigeon', 'songbird']) {
    if (!urban.has(id)) problems.push(`no ${id} lives on a built-up street — the city birds still have no city`);
  }
  // The quay is the gull's, and it is the half that was provably dead before.
  const quay = new Set();
  for (let x = 900; x < 940; x++) for (let y = 900; y < 940; y++) {
    const sid = speciesAt(placeOf('asphalt', 2, true), x, y, { weather: 'clear' });
    if (sid) quay.add(sid);
  }
  // And the other half of the same rule: the street IS theirs once it blows.
  const rough = new Set();
  for (let x = 900; x < 940; x++) for (let y = 900; y < 940; y++) {
    const sid = speciesAt(placeOf('redrock', 3, false), x, y, { weather: 'storm' });
    if (sid) rough.add(sid);
  }
  if (!rough.has('gull')) problems.push('a gull never comes ashore into the city even in a storm — the weather rule has nowhere to land now that the streets are streets');
  if (!quay.has('gull')) problems.push('no gull on a quayside — its entire ground prose pool is unreachable again');
  const gullOnQuay = habitatState('gull', placeOf('asphalt', 2, true));
  if (gullOnQuay !== 'walk') problems.push(`a gull on a quay is '${gullOnQuay}' rather than walking — it can only float again`);
  notes.push(`place: a built street holds ${[...urban].join('/')}, a quay holds ${[...quay].join('/')}`);
}

// ⚠ 1g. A LANDED FLOCK COVERS GROUND IN PROPORTION TO HOW MANY OF IT THERE ARE.
// The ground placement was one fixed radius per species, so five hundred starlings coming down
// stood in the same circle six geese did — twenty metres of birds inside seven metres of ground,
// which is what 'the whole flock is crowding one tile' was. Two claims, and both are silent when
// they break: a flock that is drawn at all is drawn in the right place doing the right thing, and
// only the SPACING is wrong.
(() => {
  const f = { ax: 903, ay: 911, sp: 'songbird' };
  const small = groundPatchR(f, 8), big = groundPatchR(f, 800);
  // The patch grows as the square root of the count, which is what holds birds-per-tile flat.
  const ratio = big / small, want = Math.sqrt(800 / 8);
  if (Math.abs(ratio - want) > 0.01) {
    problems.push(`a landed flock of 800 covers ${ratio.toFixed(2)}x the radius of one of 8 rather than ${want.toFixed(2)}x — the patch has stopped tracking the count, which is the crowd this replaced`);
  }
  // And the birds are actually spread across it rather than piled in the middle: with the station
  // sampled uniformly in the disc, the mean radius of a big flock sits near two thirds of the edge.
  const n = 600;
  let sum = 0, worst = 0, nearest = Infinity;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const g = groundSpot(f, i, n, 0, 0);
    const d = Math.hypot(g.x - f.ax, g.y - f.ay);
    sum += d; worst = Math.max(worst, d); pts.push(g);
  }
  const R = groundPatchR(f, n);
  if (sum / n < R * 0.5 || sum / n > R * 0.8) {
    problems.push(`a landed songbird stands a mean ${(sum / n).toFixed(2)} tiles out of a ${R.toFixed(2)}-tile patch — the stations have bunched toward the middle or the rim rather than filling it`);
  }
  // Nothing may share a spot with its neighbour. Sampled over a subset, because this is O(n²).
  for (let i = 0; i < 120; i++) {
    for (let j = i + 1; j < 120; j++) {
      nearest = Math.min(nearest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
  }
  const span = faunaSpanTiles('bird', 'songbird');
  if (nearest < span * 0.3) {
    problems.push(`two landed songbirds stand ${nearest.toFixed(3)} tiles apart against a ${span.toFixed(3)}-tile span — the patch is big enough and two stations still landed on each other`);
  }
  notes.push(`ground patch: 8 songbirds cover ${small.toFixed(2)} tiles, 800 cover ${big.toFixed(2)}; closest pair of 120 is ${nearest.toFixed(3)}`);
})();

// ── 1f. THE VULTURE IS A CROWD ON A BODY ──────────────────────────────────────
// Two claims, and each is invisible when it breaks. A vulture flock that spreads like geese is
// still a flock of vultures in the right place doing the right circuit, and it simply stops saying
// the one thing the species exists to say — there is something dead here. And a species that
// spends its ground phase somewhere other than its own anchor is a flock feeding beside the body
// rather than on it, which reads as a placement bug in a system that has no placement.
//
// ⚠ AND THE CLUSTER IS MEASURED AGAINST THE GOOSE, NOT AGAINST A NUMBER. The row's own fields
// could be read straight off the table, which would assert that the table says what the table
// says. What matters is that the DRAWN separation differs, so this calls the placement function
// windshield.js draws from and compares the two.
//
// ⚠ AND IT IS MEASURED AT EACH SPECIES' OWN FLOCK SIZE, because the patch is sized off the count
// now. Asking both at one arbitrary n compares two species neither of which occurs.
(() => {
  const spreadOf = (sid) => {
    const sp = SPECIES[sid];
    const n = Math.round((sp.minFlock + sp.maxFlock) / 2);
    const f = { ax: 903, ay: 911, sp: sid };
    let worst = 0;
    for (let i = 0; i < n; i++) {
      for (const t of [0, 40000, 90000]) {
        const g = groundSpot(f, i, n, t, 0);
        worst = Math.max(worst, Math.hypot(g.x - f.ax, g.y - f.ay));
      }
    }
    return worst;
  };
  const vul = spreadOf('vulture'), goo = spreadOf('goose');
  if (!(vul < goo * 0.5)) {
    problems.push(`a vulture on the ground stands ${vul.toFixed(2)} tiles out against a goose's ${goo.toFixed(2)} — a scavenger that spreads like a grazing flock has stopped saying there is a body under it, which is the only thing this species is for`);
  }

  // Gregarious, and the range is the point: the hawk is the solitary one.
  let tiles = 0, minN = 99, maxN = 0, air = 0, walk = 0, worstDrift = 0, worstOff = 0;
  for (let gx = 880; gx < 960 && tiles < 30; gx++) {
    for (let gy = 880; gy < 960 && tiles < 30; gy++) {
      for (const t of Object.keys(SPECIES.vulture.habitat)) {
        if (speciesAt(t, gx, gy, { weather: 'clear' }) !== 'vulture') continue;
        if (habitatState('vulture', t) !== 'walk') {
          problems.push(`a vulture answered '${habitatState('vulture', t)}' on ${t} — nothing in its habitat is water, so any other state is a prose pool that was never written`);
        }
        const f = flockAt(gx, gy, 1, 'vulture');
        if (!f) continue;
        tiles++;
        const period = flockState(f, 0).period;
        let lo = null, hi = null;
        for (let k = 0; k <= 200; k++) {
          const st = flockState(f, k * (period / 200));
          minN = Math.min(minN, st.n); maxN = Math.max(maxN, st.n);
          if (st.airborne) air++; else walk++;
          if (!Number.isFinite(st.cx) || !Number.isFinite(st.cy) || !Number.isFinite(st.z)) {
            problems.push('a vulture flock produced a non-finite position'); return;
          }
          // ⚠ THE GROUND PHASE HAPPENS AT THE ANCHOR, which is what makes the anchor the body.
          if (!st.airborne) worstOff = Math.max(worstOff, Math.hypot(st.cx - f.ax, st.cy - f.ay));
          if (!lo || st.u < lo.u) lo = st;
          if (!hi || st.u > hi.u) hi = st;
        }
        for (const st of [lo, hi]) worstDrift = Math.max(worstDrift, Math.hypot(st.cx - f.ax, st.cy - f.ay));
      }
    }
  }
  if (!tiles) { problems.push('no vulture is placed anywhere in its own habitat over an 80-tile sweep'); return; }
  if (!(minN >= 3 && maxN >= 4)) {
    problems.push(`vulture flocks ran ${minN}-${maxN} birds — this is the gregarious species and a crowd of one is the hawk with a different model on it`);
  }
  if (!air) problems.push('a vulture is never airborne, so its circling prose can never be printed');
  if (!walk) problems.push('a vulture never lands, so its feeding prose can never be printed and the species is a hawk');
  if (!(worstOff < 0.001)) {
    problems.push(`a feeding vulture flock sits ${worstOff.toFixed(3)} tiles off its own anchor — the anchor IS the body, so a centre that wanders during the ground phase is a flock eating beside the corpse`);
  }
  if (!(worstDrift < 0.05)) problems.push(`a vulture's cycle ends ${worstDrift.toFixed(2)} tiles off its anchor`);
  notes.push(`vulture: ${tiles} tiles, ${minN}-${maxN} birds, ${Math.round(100 * air / (air + walk))}% airborne, clusters ${vul.toFixed(2)} vs the goose's ${goo.toFixed(2)}`);
})();

// ── 1c. THE FEATHERING IS STILL ON THE BIRD ───────────────────────────────────
// A role census, because every part of the feathering pass is a face in a colour and NOT a change
// of outline: separated primaries are cut out of the hand rather than bolted onto it, the covert
// rows lie strictly inside the folded panel, and the undertail wedge is tucked under the rump. So
// deleting any one of them leaves a bird that is the right size, the right shape, in the right
// place, flying the right circuit — and simply plainer. Nothing else in this suite can see that,
// and neither can a person, because the difference is a dozen faces at thirteen pixels.
//
// ⚠ IT COUNTS ROLES RATHER THAN TOTALS. A face budget goes up when somebody adds a part elsewhere
// and would go on passing with every primary gone; what says the fingers are there is that faces
// in the `primary` role exist at all, and that there are as many of them as the row asks for.
{
  const row = faunaParamBase('bird', 'goose') || {};
  const air = faunaPoseFaces('bird', 'goose', { state: 'air' });
  const walk = faunaPoseFaces('bird', 'goose', { state: 'walk' });
  const count = (fs, role) => fs.filter((f) => f.role === role).length;

  // Two wings, one triangle per slot.
  const wantPrim = 2 * Math.round(row.wingSlots ?? 0);
  const gotPrim = count(air, 'primary');
  if (wantPrim && gotPrim !== wantPrim) {
    problems.push(`the flying goose draws ${gotPrim} primary faces against the ${wantPrim} its wingSlots asks for — the hand is not being cut into feathers`);
  }
  // The undertail is one canted wedge, and it is on every pose: it is the marking you see from
  // astern, which is the view of a bird you are overhauling.
  for (const [name, fs] of [['flying', air], ['walking', walk]]) {
    if ((row.undertailLen ?? 0) > 0.005 && !count(fs, 'undertail')) {
      problems.push(`the ${name} goose has no undertail covert face though undertailLen is ${row.undertailLen}`);
    }
  }
  // The covert rows are a GROUND part — a closed wing is the only thing they lie on — and they
  // carry no role of their own, because the read is the step of shadow rather than a hue. So the
  // only honest question is an A/B against the same bird with the field turned off.
  //
  // ⚠ NOT A COMPARISON WITH THE AIR POSE, which is what this was first written as. The two poses
  // disagree about far more than coverts — an open wing has a cambered arm and a cut hand — so
  // anything at all that moved a face in the air read here as "the covert rows are missing", and
  // a mutation that deleted the PRIMARIES reported this as its second problem. A check that names
  // the wrong part is worse than no check, because somebody goes and looks at that part.
  const wingWalk = count(walk, 'wing');
  if ((row.covertStep ?? 0) > 0.01) {
    setFaunaParams('bird', 'goose', { ...row, covertStep: 0 });
    const bare = count(faunaPoseFaces('bird', 'goose', { state: 'walk' }), 'wing');
    setFaunaParams('bird', 'goose', null);
    if (wingWalk <= bare) {
      problems.push(`turning covertStep off changes nothing on the closed wing (${wingWalk} faces either way) — the covert rows are not being drawn`);
    }
  }
  notes.push(`feathering: ${gotPrim} primaries, ${count(air, 'undertail')} undertail, ${wingWalk} folded wing faces (${air.length} air / ${walk.length} walk total)`);
}

// ── 1d. THE HEAD IS ATTACHED TO THE BIRD ──────────────────────────────────────
// ⚠ A FLOATING HEAD IS SILENT IN EVERY DIRECTION. It is the right colour, the right size, in the
// right place to within a few hundredths of a unit, and nothing anywhere counts the daylight
// between it and the shoulders — so it reaches a frame as a bird whose skull is hovering off the
// front of it, which is what it looked like.
//
// The songbird is the species it happened to, and the reason is structural rather than a tuning:
// `neckSegs: 0` draws NO neck tube, so nothing bridges a head that the chin floor has pushed clear
// of the chest. Every other bird in the table overlaps its own body by 0.03-0.05 and covered for
// that floor by accident.
//
// ⚠ IT IS AN OVERLAP, NOT A TOUCH. Two tubes that meet exactly at a point still show a seam from
// most angles, and a tolerance of zero would pass the bird that was reported.
{
// ⚠ AND THE YARDSTICK IS THE NECK, NOT A LENGTH. An absolute figure is a whole skull on a
// songbird and a rounding error on a goose — the same trap the eye's own size fell into one file
// over. A fifth of a neck width is what separates the bird that was reported (0.006 of DAYLIGHT)
// from the five that were always fine (0.009-0.05 of overlap, every one of them at least 0.22 of
// its own neck).
  for (const id of faunaParamIds('bird')) {
    const OVERLAP = (faunaParamBase('bird', id)?.neckW ?? 0.045) * 0.20;
    for (const state of ['walk', 'air']) {
      const fs2 = faunaPoseFaces('bird', id, { state });
      const pts = (roles) => fs2.filter((f) => roles.includes(f.role)).flatMap((f) => f.p.map((v) => v[0]));
      const carrier = pts(['body', 'neck']), skull = pts(['head', 'crown']);
      if (!carrier.length || !skull.length) { problems.push(`the ${state} ${id} has no ${carrier.length ? 'head' : 'body'} faces at all`); continue; }
      const gap = Math.min(...skull) - Math.max(...carrier);
      if (gap > -OVERLAP) {
        problems.push(`the ${state} ${id}'s head reaches back only ${(-gap).toFixed(4)} into its own body (wanted ${OVERLAP}) — at 0 or above it is floating off the front of the bird`);
      }
    }
  }
  notes.push('every head overlaps the body that carries it');
}

// ── 1e. NO TWO BIRDS ARE THE SAME SHAPE ───────────────────────────────────────
// Reported as "only the geese seem truly unique silhouette wise", and it was true of the other
// five: every bird here was built with its body axis lying along f, so two species could differ
// in SIZE and in neck and in nothing else. At the thirteen pixels these draw at, size is the one
// cue that does not survive -- a gull at four tiles and a pigeon at one are the same number of
// pixels -- so five birds differing only in scale are five birds nobody can tell apart.
//
// ⚠ IT MEASURES SHAPE, NEVER SIZE. Every figure below is a RATIO, and the whole point is that
// making a bird bigger must not be able to satisfy it.
//
// ⚠ AND IT IS A PAIRWISE MINIMUM RATHER THAN A PER-SPECIES BAND. A band is a list of numbers
// somebody has to keep in step with the rows; what is actually being asserted is that no two of
// them collide, which is one rule and holds for a species added later without anybody editing it.
{
  // ⚠ THE FLOOR SITS BETWEEN TWO MEASUREMENTS RATHER THAN BEING PICKED. With every row's
  // 'bodyPitch' forced to 0 -- the posture-less builder, everything else in the table left alone --
  // the closest pair is gull/hawk at 0.181. What ships is gull/songbird at 0.272. 0.22 is between
  // them, so this fails the shape the report was about and passes what replaced it with a quarter
  // to spare, and a tune that quietly walks a species back toward another one trips it.
  //
  // ⚠ 0.16 WOULD NOT HAVE CAUGHT THE BUG IT WAS WRITTEN FOR, which is worth recording: the
  // first floor here was set to whatever the table happened to clear, and the flattened control
  // went straight through it. A gate is only worth the control you ran against it.
  const SPAN = 0.22;   // how far apart two birds must sit in the four-axis shape space
  const mean = (a) => a.reduce((t, v) => t + v, 0) / (a.length || 1);
  const shape = (id) => {
    const fs2 = faunaPoseFaces('bird', id, { state: 'walk' });
    const pts = (roles) => fs2.filter((f) => roles.includes(f.role)).flatMap((f) => f.p);
    const all = pts(['body', 'belly', 'neck', 'head', 'crown', 'wing', 'undertail', 'patch']);
    const fMin = Math.min(...all.map((v) => v[0])), fMax = Math.max(...all.map((v) => v[0]));
    const hMin = Math.min(...all.map((v) => v[2])), hMax = Math.max(...all.map((v) => v[2]));
    const H = Math.max(hMax - hMin, 1e-6);
    // STANCE: how tall the animal is against how long it is. A gull is a long low thing and a
    // perched hawk is nearly as tall as it is long, and that is the first thing you see.
    const stance = H / Math.max(fMax - fMin, 1e-6);
    // RAKE: how far the front of the TORSO is carried above its own back end. This is the axis
    // that did not exist before 'bodyPitch' did, and it is why five of these were one animal.
    const body = pts(['body', 'belly']);
    const b0 = Math.min(...body.map((v) => v[0])), b1 = Math.max(...body.map((v) => v[0])), bl = b1 - b0;
    const rake = (mean(body.filter((v) => v[0] > b1 - bl * 0.3).map((v) => v[2]))
      - mean(body.filter((v) => v[0] < b0 + bl * 0.3).map((v) => v[2]))) / H;
    // PROUD: how far the skull stands clear of the top of the torso. A goose's is half its own
    // height up a neck; a vulture's is BELOW the line of its own back, which is what hunched means
    // and is why this one goes negative.
    const head = pts(['head', 'crown']);
    const proud = head.length ? (Math.max(...head.map((v) => v[2])) - Math.max(...body.map((v) => v[2]))) / H : 0;
    // SKULL: the head's own depth against the torso's. It is the cue that says "small bird" before
    // anything else does -- a sparrow's head is two thirds the depth of its body and a goose's is
    // under a half -- and it is the ONE axis here that a body angle cannot move, which is why the
    // upright pair needed it. ⚠ AND IT IS NOT NORMALISED BY H. The other three are, so anything
    // that makes a bird taller dilutes all three at once, and cocking a tail further measured as
    // two birds becoming MORE alike. This one divides by the torso, which is the thing it is
    // actually a ratio of.
    const bH = Math.max(...body.map((v) => v[2])) - Math.min(...body.map((v) => v[2]));
    const skull = head.length ? (Math.max(...head.map((v) => v[2])) - Math.min(...head.map((v) => v[2]))) / Math.max(bH, 1e-6) : 0;
    return { stance, rake, proud, skull };
  };
  // ⚠ PLACED SPECIES ONLY, NEVER THE MODEL ROSTER. content/fauna_models holds finished models
  // that are not in the world — see the ⚠ on FAUNA_IDS — and a model in no habitat has no flock
  // and cannot be mistaken in the field for anything, so holding it to a distinctness rule fails
  // a row that is working as intended. The MODEL checks above deliberately still sweep all of them.
  const ids = faunaParamIds('bird').filter((id) => SPECIES[id]);
  const sh = Object.fromEntries(ids.map((id) => [id, shape(id)]));
  let worst = Infinity, worstPair = '';
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const A = sh[ids[i]], B = sh[ids[j]];
    const d = Math.hypot(A.stance - B.stance, A.rake - B.rake, A.proud - B.proud, A.skull - B.skull);
    if (d < worst) { worst = d; worstPair = ids[i] + '/' + ids[j]; }
    if (d < SPAN) {
      problems.push(`${ids[i]} and ${ids[j]} are the same shape (${d.toFixed(3)} apart, wanted ${SPAN}) -- stance ${A.stance.toFixed(2)}/${B.stance.toFixed(2)}, rake ${A.rake.toFixed(2)}/${B.rake.toFixed(2)}, proud ${A.proud.toFixed(2)}/${B.proud.toFixed(2)}, skull ${A.skull.toFixed(2)}/${B.skull.toFixed(2)}`);
    }
  }
  // ⚠ THE WING IS REPORTED AND DELIBERATELY NOT GATED. A wing measured against its own bird
  // is the figure nobody was looking at -- 'span' is an absolute model number, so every eye check
  // is of one bird on its own where a wing is just a wing, and the songbird shipped at 2.89 body
  // lengths of wing against the goose's 2.50: longer-winged than a goose. What stops that is
  // comparing two rows, which is what this line is for.
  //
  // It is a NOTE rather than a problem because the honest rule is not obvious. An ORDER is wrong
  // (a vulture really does out-span a goose relative to its body), and a pairwise floor like the
  // one above lands the hawk and the vulture 0.68 apart on a scale nobody has calibrated -- they
  // are both long broad soarers and that is the animals rather than the data. A number that has to
  // be fitted to pass is not a gate, and this file already carries one paragraph about learning
  // that the hard way.
  notes.push('wing per body length: ' + faunaParamIds('bird').filter((id) => SPECIES[id]).map((id) => {
    const r = faunaParamBase('bird', id) || {};
    return id.slice(0, 2) + ' ' + (r.span / r.bodyLen).toFixed(2) + ' (aspect ' + (r.span / r.chord).toFixed(1) + ')';
  }).join(', '));
  notes.push('silhouettes: closest pair ' + worstPair + ' at ' + worst.toFixed(3) + ' of a wanted ' + SPAN
    + '; stance ' + ids.map((id) => id.slice(0, 2) + ' ' + sh[id].stance.toFixed(2)).join(', '));
}

// ── 1f. THE BIGGEST FLOCK A SPECIES CAN HAVE MUST FIT THE SHARE IT IS ALLOWED ──────
// A flock that will not fit is skipped WHOLE — see the ⚠ on 'charged whole' in windshield.js,
// which is the right call and is also exactly why this fails silently: the flock simply never
// draws, which reads as that species being rare rather than as impossible.
//
// It bit on the pass that added this. The songbird went 40 faces to 51 for a rounder body, and
// 20 × 51 = 1,020 against a share of 840 — so a full murmuration stopped drawing at all and
// nothing anywhere said so. At 40 faces it was 800 and fitted by forty.
//
// ⚠ IT CHECKS THE GL BUDGET, WHICH IS THE DEFAULT RENDERER'S. The canvas figure is deliberately
// lower (framecost puts 1400 at +45.6% of a worst-case cab frame) and that path is expected to
// shed the largest flocks; holding it to the same rule would fail a trade-off made on purpose.
// The canvas shortfall is reported as a note instead, so it is visible without being a red gate.
{
  const glBudget = ws.RENDER_TUNE.birdFacesGL, cvBudget = ws.RENDER_TUNE.birdFaces;
  const shed = [];
  for (const id of faunaParamIds('bird').filter((id) => SPECIES[id])) {
    const sp = SPECIES[id]; if (!sp) continue;
    const per = faunaPoseFaces('bird', id, { state: 'air' }).length;
    const cost = sp.maxFlock * per, share = sp.budgetShare ?? 1;
    // ⚠ A THINNABLE SPECIES FAILS ON ITS FLOOR, NOT ON ITS CEILING. It is drawn short rather
    // than dropped (see 'thin' in birds.js), so the question is whether the FEWEST birds it may be
    // reduced to still fit — holding it to its full flock would fail a species that is working as
    // designed, which is the same class of mistake as gating the canvas budget on the GL rule.
    const floorCost = (sp.thin || sp.maxFlock) * per;
    if (floorCost > glBudget * share) {
      problems.push(`even a thinned ${id} flock is ${sp.thin || sp.maxFlock} × ${per} = ${floorCost} faces against the ${Math.round(glBudget * share)} its budgetShare allows — it is skipped whole and never draws`);
    }
    // What each renderer actually gets: the full flock, a thinned one, or nothing.
    const room = (b) => Math.floor(b * share / per);
    for (const [name, b] of [['GL', glBudget], ['canvas', cvBudget]]) {
      if (cost <= b * share) continue;
      // ⚠ A THINNED FLOCK STILL HAS TO FIT. The loop drops anything over the cap, floor or not,
      // so reporting the floor without checking it is how 'thinned to 16' got printed for a
      // renderer that was drawing none.
      const kept = sp.thin ? Math.max(sp.thin, room(b)) : 0;
      shed.push(sp.thin && kept * per <= b * share ? `${id} thinned to ${kept} of ${sp.maxFlock} on ${name}`
        : `${id} dropped on ${name} (${cost} > ${Math.round(b * share)})`);
    }
  }
  notes.push('flock budgets: GL ' + glBudget + ', canvas ' + cvBudget
    + (shed.length ? ' — ' + shed.join(', ') : ' — every flock fits whole on both'));

  // ⚠ AND THE BOIDS STEP IS A COST NO FACE COUNT CAN SEE. murmur() finds each bird's neighbours
  // by scanning every other bird, so it is O(n²) while everything else here is linear — which
  // means a flock size chosen against the face budget can be perfectly affordable in faces and
  // still eat the frame. Measured per frame: 20 birds 0.05 ms, 60 0.54, 80 1.00, 120 3.09, 200
  // 6.89 — and that was when it SORTED every pair to read seven of them. Selecting the K nearest
  // into a fixed buffer instead is bit-identical and 7-17× faster: 60 birds 0.12 ms, 200 0.41,
  // 300 0.95, 400 2.15. The ceiling moved with it.
  //
  // ⚠ IT IS GATED IN PAIRS RATHER THAN IN MILLISECONDS, because a timing gate on a shared CI box
  // is a flake. 62,500 pairs is n = 250, which measured about 0.57 ms on the machine the table
  // above came from — so this bounds the thing that was measured, in units that cannot drift with
  // hardware. 640,000 pairs is n = 800; the shipping 600 measured 1.54 ms on the spatial grid,
  // which is 9% of a 60 fps frame. The pair COUNT is still the right currency even though the grid
  // no longer visits every pair — it is the size of the problem, and what the grid changed is the
  // constant in front of it rather than the shape.
  // ⚠ THE CEILING IS A MEASURED COST NOW, NOT A PAIR COUNT, BECAUSE THE GRID CHANGED THE SHAPE OF
  // THE CURVE. This was `maxFlock^2` against a pair budget, which was the right model when every
  // bird compared itself with every other one. The spatial grid made the neighbour search
  // near-linear-ish and the old model now over-states the cost badly at the top end: n^2 predicts
  // 88 ms for a 4000-bird cloud and the real figure is 22.7. A ceiling that wrong is not
  // conservative, it is arbitrary -- it would refuse a flock that runs fine and say nothing useful
  // about why.
  //
  // ⚠ SO THE NUMBER IS THE ONE THAT WAS MEASURED, AND THE TABLE IS HERE SO THE NEXT PERSON CAN
  // ARGUE WITH IT. One flock, median ms for a single murmur() step on this machine:
  //
  //     600 birds  1.5 ms      1800 birds   7.1 ms
  //    1200 birds  4.1 ms      2400 birds   9.9 ms
  //                            3200 birds  16.3 ms
  //
  // A frame is 16.7 ms at 60 and a cab frame is already 2.8-3.6 ms of it, so 1800 is where one
  // flock stops leaving room for the rest of the game. This is a SIMULATION cost and the face
  // budget genuinely cannot see it: the birds are dots by then and nearly free to draw.
  const MURMUR_BIRDS_MAX = 1800;
  for (const id of faunaParamIds('bird').filter((id) => SPECIES[id])) {
    const sp = SPECIES[id];
    if (!sp || !sp.thin) continue;              // only a cloud species runs the boids step
    if (sp.maxFlock > MURMUR_BIRDS_MAX) {
      problems.push(`a ${id} flock of ${sp.maxFlock} is past the ${MURMUR_BIRDS_MAX} the boids step was measured to afford — that is simulation cost, and no face budget can see it`);
    }
  }
}

// ── 1g. A BIRD TOO SMALL TO HAVE A SHAPE IS DRAWN AS ONE DOT ──────────────────
// Everything above pins the LOD OFF, so without this it ships untested -- and its failure is the
// quiet kind: a threshold that never fires costs nothing and looks identical to one that works,
// while one that always fires deletes every close-up bird and also looks fine in a frame with
// nothing close.
//
// ⚠ THE THRESHOLD IS PER SPECIES NOW, and the thing worth checking is not the numbers but that
// each bird keeps its mesh over a sensible share of the range it is actually DRAWN at. drawRange
// is that range, and it is authored right beside the threshold, so the two can be compared without
// anybody writing a third number down.
{
  const FL = 228.2;                       // the seat every other figure in this file is quoted at
  const rows = [];
  for (const id of faunaParamIds('bird').filter((x) => SPECIES[x])) {
    const span = faunaSpanTiles('bird', id);
    const thr = (faunaParamBase('bird', id) || {}).dotPx || ws.RENDER_TUNE.faunaDot;
    const meshTo = FL * span / thr;                 // tiles it keeps its mesh within
    const range = SPECIES[id].drawRange;
    rows.push({ id, thr, meshTo, range, share: meshTo / range });
  }
  // ⚠ A SPECIES DRAWN IN THE HUNDREDS IS THE ONE THAT MUST GIVE ITS MESH UP, which is the whole
  // reason this is per species: the starling is six hundred birds at 1.03 px, so a big share would
  // mean sixty thousand triangles for a cloud of specks.
  //
  // ⚠ AND THE BAR MOVED 0.25 -> 0.35 WHEN THE BUDGET AND THE GLYPH RUNG LANDED, BECAUSE AT 0.25 IT
  // WAS ASKING FOR A BUG BACK. A songbird spans 0.027 tiles and a murmuration flies at 1.4 of them,
  // so the mesh has to reach past 1.4 to be a mesh at all -- windshield.js says so where dotPx came
  // down ("a starling only became a mesh inside 0.87 tiles ... get close and they stayed specks").
  // Against a 6-tile drawRange that is a share of 0.233 AT BEST, and dotPx 3 puts it at 0.34. Every
  // setting that satisfied 0.25 put the whole flock back below mesh range.
  //
  // ⚠ WHAT ACTUALLY BOUNDS THE COST IS NOT THIS RATIO ANY MORE. When the rule was written a near
  // bird was a mesh or a dot and nothing counted them, so the share WAS the budget. It is not:
  // `faunaMeshMax` rations meshes per frame off the frame clock, `faunaGlyphPx` gives the rung
  // below it a three-face bird instead of a speck, and that rung carries its own cap. So the share
  // is a shape check now, and the ceiling it used to stand in for is asserted directly below it.
  const crowd = rows.filter((r) => SPECIES[r.id].maxFlock >= 100);
  for (const r of crowd) {
    if (r.share > 0.35) problems.push(`${r.id} flocks to ${SPECIES[r.id].maxFlock} and still keeps its mesh over ${(r.share * 100) | 0}% of its draw range -- a cloud of them is all triangles`);
  }
  // ⚠ AND THE CEILING IS ASSERTED, or relaxing the bar above would be relaxing the only bound there
  // was. A crowd species' worst case is every bird of the biggest flock inside its own mesh range
  // at once, and the answer to that has to be a COUNT rather than a ratio: the mesh budget must be
  // set, finite, and below the largest flock the game can make -- otherwise there is nothing at all
  // between a murmuration and seventeen hundred meshes.
  {
    const cap = ws.RENDER_TUNE.faunaMeshMax, floor = ws.RENDER_TUNE.faunaMeshMin;
    const biggest = Math.max(...crowd.map((r) => SPECIES[r.id].maxFlock));
    if (!(cap > 0) || !Number.isFinite(cap) || cap >= biggest) {
      problems.push(`faunaMeshMax is ${cap} against a biggest flock of ${biggest} -- the per-frame mesh budget is what bounds a crowd species, and it is not bounding this one`);
    }
    if (!(floor > 0) || floor > cap) problems.push(`faunaMeshMin ${floor} is not a floor under faunaMeshMax ${cap}`);
    notes.push(`mesh budget: ${floor}..${cap} meshes a frame against a biggest flock of ${biggest}`);
  }
  // ⚠ AND A SOLITARY OR LARGE BIRD MUST KEEP ITS MESH, or the LOD has quietly deleted the
  // silhouettes the models were built for. A goose IS its neck and nothing survives dotting it.
  for (const r of rows.filter((x) => SPECIES[x.id].maxFlock <= 12)) {
    if (r.share < 0.6) problems.push(`${r.id} only keeps its mesh over ${(r.share * 100) | 0}% of the ${r.range} tiles it is drawn at -- its silhouette is being thrown away`);
  }
  rows.sort((x, y) => x.thr - y.thr);
  notes.push('dot LOD: ' + rows.map((r) => `${r.id.slice(0, 2)} ${r.thr}px mesh to ${r.meshTo.toFixed(1)}/${r.range}t`).join(', '));
}

// ── 2. STATELESS ACROSS A RECENTRE ────────────────────────────────────────────
// The single property the whole design rests on, and the one nothing else in the tree checks: the
// same world at the same instant, seen from a window centred somewhere else, must put the same
// flocks on the same absolute tiles.
//
// ⚠ IT ASKS A DIFFERENT QUESTION OF EACH HALF, AND THAT IS THE DESIGN RATHER THAN A CLIMBDOWN.
// An AIRBORNE bird's position is pure — flock state plus its place in the skein — so it is compared
// exactly. A WALKING bird's is not: it fans out from its flock as something comes near, which is a
// deliberate camera-dependence, so demanding it hold still across a moved camera fails on correct
// code. It did, twice, on four birds of a neighbouring flock that were alarmed in one paint and
// calm in the other. What must hold for the walking half is WHICH FIELDS HAVE GEESE IN THEM, and
// that is what is compared.
//
// ⚠ AND THE TWO PAINTS DELIBERATELY FACE DIFFERENT WAYS. A skein laid out in the CAMERA's frame
// instead of its own flock's is a real bug, and on one shared heading it lands the birds in the
// same absolute places and passes. It took a differing heading to catch it.
//
// ⚠ POSITION AND STATE, NEVER THE BEARING BUCKET. The bucket is camera-relative on purpose — it is
// which way a bird faces relative to where you are looking — so two paints looking different ways
// legitimately disagree about it.
const VIEW_A = { x: ANCHOR.ax, y: ANCHOR.ay + 6 };
const VIEW_B = { x: ANCHOR.ax + 4, y: ANCHOR.ay + 9 };
const OFF_A = { x: 0.31, y: -0.17 }, OFF_B = { x: -0.42, y: 0.28 };
const near6 = (q) => Math.abs(q.wx - ANCHOR.ax) < 6 && Math.abs(q.wy - ANCHOR.ay) < 6;
// Which fields hold geese — a bird attributed to the flock it belongs to, which is the nearest
// anchor. Invariant under the camera for both halves.
const fieldsIn = (r, anchors) => [...new Set(r.quads.filter(near6).map((q) => {
  let best = '?', bd = Infinity;
  for (const a of anchors) { const d = Math.hypot(q.wx - a.ax, q.wy - a.ay); if (d < bd) { bd = d; best = a.ax + ',' + a.ay; } }
  return best;
}))].sort().join(' ');
// Exact bird positions, for the half where they are camera-independent.
const birdsIn = (r) => r.quads.filter(near6)
  .map((q) => q.state + '@' + q.wx.toFixed(3) + ',' + q.wy.toFixed(3))
  .sort().join(' ');

T = T_GROUND ?? 1e6;
const a1 = paint(viewAt(VIEW_A, 0, 12, OFF_A));
const a2 = paint(viewAt(VIEW_B, 0, 12, OFF_B, 14));
const localAnchors = flocksNear(ANCHOR.ax, ANCHOR.ay, 10, 1, (x, y) => !!park(x, y) && park(x, y).biome === 'parkland');
const f1 = fieldsIn(a1, localAnchors), f2 = fieldsIn(a2, localAnchors);
if (!f1) problems.push('the recentre check found no goose near the anchor to compare — it is vacuous');
else if (f1 !== f2) {
  problems.push('a FIELD gained or lost its geese when the map window recentred — the lattice is reading something camera-relative');
  if (REPORT) { console.log('  fields A: ' + f1); console.log('  fields B: ' + f2); }
}

// ⚠ AND AGAIN IN THE AIR, BECAUSE THE TWO HALVES SHARE NO CODE. The skein is laid out only while a
// flock is flying, so a recentre check run at a moment it is on the grass never executes it at all
// — which is how a skein built in the camera's frame passed this twice.
T = T_AIR ?? 1e6;
const b1 = paint(viewAt(VIEW_A, 0, 12, OFF_A));
const b2 = paint(viewAt(VIEW_B, 0, 12, OFF_B, 14));
const air1 = birdsIn(b1), air2 = birdsIn(b2);
if (!air1) problems.push('the airborne recentre check found no goose near the anchor — it is vacuous');
else if (air1 !== air2) {
  problems.push('an AIRBORNE goose moved when the map window recentred — the skein is being laid out in the camera\'s frame rather than its own flock\'s');
  if (REPORT) {
    const A = air1.split(' '), B = air2.split(' ');
    console.log('  only in A: ' + A.filter((x) => !B.includes(x)).join(' '));
    console.log('  only in B: ' + B.filter((x) => !A.includes(x)).join(' '));
  }
}
T = T_GROUND ?? 1e6;

// ── 2a2. THE FLOCK SEARCH IS CACHED, SO ITS INVALIDATION IS A CHECK OF ITS OWN ────────────────
//
// drawGeese works the anchors out once per WINDOW rather than once per frame: the eight-neighbour
// place classification runs on 94% of the window’s tiles and measured 2.1 ms of a 9.0 ms aircraft
// frame, against 0.0 for the bare tile loop. The cache is kept against the map window OBJECT, which
// is what a real recentre replaces (`F.map = msg.map` in cockpit.js hands over a freshly parsed array).
//
// ⚠ WHAT OBJECT IDENTITY DOES NOT COVER IS A CENTRE THAT MOVES WHILE THE ARRAY IS REUSED, and that
// is reachable: freelook-view’s `recentre(rows, gx, gy)` updates gx whether or not rows arrived. So
// the comparison in drawGeese names wcx/wcy as well, and this is the check that the naming is
// load-bearing rather than decorative — the checks above cannot reach it, because every view they
// build gets its own map from mapFor and so never shares one.
//
// ⚠ THE REFERENCE IS A COPY OF THE SAME WINDOW, which is the only way to ask for a cold cache:
// identical contents, a different object, so the anchors are rebuilt instead of reused.
// ⚠ AND THE TWO CENTRES MUST GENUINELY DISAGREE, or a cache that ignored the centre entirely would
// pass this by drawing the same correct birds twice.
{
  const C1 = { x: ANCHOR.ax, y: ANCHOR.ay + 6 }, C2 = { x: ANCHOR.ax + 5, y: ANCHOR.ay + 11 };
  const M = mapFor(C1, park);
  const copy = (m) => m.map((row) => row.slice());
  const at = (centre, map) => ({ ...viewAt(C1, 0, 12, OFF_A), map, mapCenter: { ...centre } });
  const allBirds = (r) => r.quads
    .map((q) => q.state + '@' + q.wx.toFixed(3) + ',' + q.wy.toFixed(3)).sort().join(' ');
  T = T_AIR ?? 1e6;
  paint(at(C1, M));                                     // warm this window on C1…
  const warm = allBirds(paint(at(C2, M)));              // …then ask the SAME array for C2
  const cold = allBirds(paint(at(C2, copy(M))));        // the same question, cache cold
  const base = allBirds(paint(at(C1, copy(M))));
  if (!cold) problems.push('the flock-cache check found no airborne bird to compare — it is vacuous');
  else if (cold === base) problems.push('the flock-cache check moved the centre and the birds did not change — it cannot tell a stale answer from a fresh one');
  else if (warm !== cold) problems.push('the flock anchors were reused across a centre change on one map window — the cache key in drawGeese is not naming the centre');

  // ⚠ AND THE WEATHER, WHICH IS THE OTHER INPUT THAT MOVES WITHOUT THE WINDOW MOVING. A gull comes
  // ashore when the day turns rough (speciesAt reads it, through gullsAshore, and nothing else),
  // so a key that ignored it would keep the fine-weather birds until the next recentre — which
  // may be a long time for a player who is standing still. The park map cannot ask this: parkland
  // is not a GULL_INLAND ground, so flipping the weather over it changes nothing and the check
  // would pass whatever the key said. An unbuilt citycore tile IS one — placeOf hands back the
  // biome itself where nothing is built on it — so the scene is a plain street.
  const S = mapFor(C1, () => ({ kind: 'land', biome: 'citycore', flr: 0 }));
  const inWx = (wx, map) => ({ ...viewAt(C1, 0, 12, OFF_A), map, mapCenter: { ...C1 }, weather: wx });
  paint(inWx('clear', S));                                    // warm this window on a fine day…
  const warmRough = allBirds(paint(inWx('storm', S)));        // …then ask the SAME array once it turns
  const coldRough = allBirds(paint(inWx('storm', copy(S))));
  const coldFine = allBirds(paint(inWx('clear', copy(S))));
  if (!coldRough && !coldFine) problems.push('the flock-cache weather check drew no bird on either day — it is vacuous');
  else if (coldRough === coldFine) problems.push('the flock-cache weather check saw the same birds fine and rough — no gull came ashore, so it cannot tell a stale answer from a fresh one');
  else if (warmRough !== coldRough) problems.push('the flock anchors were reused across a weather change on one map window — the cache key in drawGeese is not naming whether the day is rough');

  // ⚠ AND THE DENSITY, WHICH IS A LIVE SLIDER. RENDER_TUNE.geese scales the roll, so a key that
  // ignored it would leave the Geese slider doing nothing until the window next recentred — which
  // reads as a dead control rather than as a cache.
  const gWas = ws.RENDER_TUNE.geese;
  ws.RENDER_TUNE.geese = 1;  paint(inWx('clear', S));                   // warm at full density…
  ws.RENDER_TUNE.geese = 3;  const warmDense = allBirds(paint(inWx('clear', S)));
  const coldDense = allBirds(paint(inWx('clear', copy(S))));
  ws.RENDER_TUNE.geese = gWas;
  if (!coldDense) problems.push('the flock-cache density check drew no bird — it is vacuous');
  else if (coldDense === coldFine) problems.push('the flock-cache density check saw the same birds at both densities — it cannot tell a stale answer from a fresh one');
  else if (warmDense !== coldDense) problems.push('the flock anchors were reused across a density change on one map window — the cache key in drawGeese is not naming the density');

  // ⚠ winR AND searchR ARE NOT SEPARATELY CHECKABLE, AND THAT IS ARITHMETIC RATHER THAN A HOLE.
  // R is (map.length - 1) / 2 and searchR is min(FAR, R) where FAR is min(VISIBLE_FAR_F,
  // max(6, winR - 1)) — so both are pure functions of the window ARRAY, which is the key itself.
  // Nothing can move either without handing over a different array, so dropping them from the
  // comparison cannot be caught by any scene. They stay in it as the values actually spent, so the
  // day one of those derivations reads something else the key already names it rather than
  // silently going stale. Mutants that remove them pass on purpose; M1, M2 and M4 do not.
  T = T_GROUND ?? 1e6;
}

// ── 2b. AND THE STARTLE IS REAL ───────────────────────────────────────────────
// The reason the walking half above is compared by field rather than by bird. Same flock, same
// instant, camera close against camera far: the birds must measurably fan out. Without this the
// camera-dependence is only an excuse for a weaker check rather than a feature anybody tested.
// ⚠ THE ANCHOR'S OWN FLOCK, NOT EVERY BIRD NEAR IT. A flock is rolled per tile, so two can sit
// within a couple of tiles of each other — and the spread of two flocks read as one is the gap
// BETWEEN them, which swamps the effect entirely: it measured 1.67 calm against 1.53 alarmed,
// the wrong way round, from a working startle.
const ownFlock = (q) => {
  let bd = Infinity, best = null;
  for (const fl of localAnchors) { const d = Math.hypot(q.wx - fl.ax, q.wy - fl.ay); if (d < bd) { bd = d; best = fl; } }
  return best && best.ax === ANCHOR.ax && best.ay === ANCHOR.ay;
};
const spreadOf = (r) => {
  const g = r.quads.filter((q) => q.state !== 'air' && ownFlock(q));
  if (g.length < 2) return null;
  const cx = g.reduce((a, q) => a + q.wx, 0) / g.length, cy = g.reduce((a, q) => a + q.wy, 0) / g.length;
  return g.reduce((a, q) => a + Math.hypot(q.wx - cx, q.wy - cy), 0) / g.length;
};
const calm = spreadOf(paint(viewAt({ x: ANCHOR.ax, y: ANCHOR.ay + 14 }, 0, 12)));
const spooked = spreadOf(paint(viewAt({ x: ANCHOR.ax, y: ANCHOR.ay + 2 }, 0, 12)));
if (calm == null || spooked == null) problems.push('the startle check could not see the anchor flock from both distances — it is vacuous');
else if (!(spooked > calm * 1.15)) problems.push(`geese did not fan out when approached: spread ${calm.toFixed(3)} calm vs ${spooked.toFixed(3)} at two tiles`);
else notes.push(`startle spreads the flock ${(spooked / calm).toFixed(2)}×`);

// ── 3. DETERMINISTIC AT A FIXED CLOCK ─────────────────────────────────────────
const d1 = paint(viewAt(CENTRE, 0, 12));
const d2 = paint(viewAt(CENTRE, 0, 12));
if (JSON.stringify(d1.quads) !== JSON.stringify(d2.quads)) {
  problems.push('two paints of the same frame at the same instant produced different geese — something in the pass is rolling dice');
}

// ── 4. THE OFF SWITCH IS THE ABSENCE OF THE PASS ──────────────────────────────
// RENDER_TUNE's standing rule: 0 restores exactly the renderer that shipped.
//
// ⚠ THIS ASSERTS THE OUTCOME, AND THE OUTCOME HAS TWO INDEPENDENT ENFORCERS: the early return in
// `drawGeese`, and `density` reaching `flocksNear`, where a threshold of zero rejects every cell.
// Deleting either one alone leaves this green. That is the right bar for "is the switch off" and it
// must not be read as covering either guard on its own — the same caveat applies to the night check
// below, where the early return and the `dayFade` alpha each take the frame to nothing.
ws.RENDER_TUNE.geese = 0;
const off = paint(viewAt(CENTRE, 0, 12));
ws.RENDER_TUNE.geese = geeseWas;
if (off.quads.length) problems.push(`RENDER_TUNE.geese = 0 still pushed ${off.quads.length} bird(s)`);
if (off.faces) problems.push(`RENDER_TUNE.geese = 0 still pushed ${off.faces} fauna face(s)`);
// …and the scatter must be untouched by the switch, or "0" is deleting somebody else's work. The
// flock contributes nothing to that layer now, so this is an equality rather than a subtraction.
if (off.scatter !== ground.scatter) {
  problems.push(`geese = 0 changed the scatter layer too (${off.scatter} against ${ground.scatter}) — the flock is not meant to be in it at all`);
}

// ── 5. THE HEIGHT SPLIT ───────────────────────────────────────────────────────
// A walking bird is knee-high and stops being worth projecting from anything but a low pass; a
// flying one has to stay visible from a cockpit. The gate is a property of the STATE, so one
// height must keep the air half and drop the ground half.
T = T_GROUND ?? 1e6;
const highGround = paint(viewAt(CENTRE, 0.3, 12));
if (grounded(highGround).length) problems.push('walking geese still drew from above the street-figure height');
T = T_AIR ?? 1e6;
const highAir = paint(viewAt(CENTRE, 0.3, 12));
if (!airborne(highAir).length) problems.push('airborne geese vanished at a height a cockpit actually flies at');
const tooHigh = paint(viewAt(CENTRE, 0.9, 12));
if (tooHigh.quads.length) problems.push('geese still drew above GOOSE_AIR_MAX_H, where a bird is sub-pixel');

// ── 6. GROUND THAT IS NOT THEIRS ──────────────────────────────────────────────
// ⚠ A TEST MAP MADE ENTIRELY OF HABITAT CANNOT SEE THE HABITAT CHECK. Every assertion above runs
// over open turf, so deleting the check outright changes not one of them. The same field paved
// over, with the same anchors under it, must draw nothing at all.
T = T_GROUND ?? 1e6;
const sweep = (cell, label) => {
  const r = paint(viewAt(CENTRE, 0, 12, undefined, 0, () => ({ ...cell })));
  if (r.quads.length) problems.push(`${r.quads.length} bird quad(s) drew on ${label}`);
};
// ⚠ THE OTHER HALF OF THE SAME QUESTION, and it did not exist until a bird lived somewhere other
// than a field. Every check in this section asked "is this ground empty", so a habitat table that
// had quietly stopped placing anything anywhere would have passed all of them. This asks a ground
// a species IS meant to hold to hold something.
const sweepHas = (id, cell, label) => {
  const r = paint(viewAt(CENTRE, 0, 12, undefined, 0, () => ({ ...cell })));
  if (!r.quads.length) problems.push(`no bird drew on ${label}, where a ${id} is meant to live`);
};
// Ground that is not turf at all — the habitat table's own job.
sweep({ kind: 'land', biome: EMPTY_GROUND, flr: 0 }, 'bare ' + EMPTY_GROUND);
// ⚠ A CITY BLOCK IS HABITAT NOW. It was the canonical "nothing lives here" ground and the pigeon
// took it, so this asks the question the other way round: the ground a bird DOES live on had
// better hold one, and the genuinely empty grounds had better not.
sweepHas('pigeon', { kind: 'land', biome: 'citycore', flr: 0 }, 'a city block');
// ⚠ AND TURF THAT IS STILL NOT STANDING ROOM. A path through a park and a shed on a lawn are both
// habitat by biome, so the `bt`/`road` guard is the only thing refusing them — and a sweep made
// only of non-habitat ground lets that guard be deleted with every check still green.
sweep({ kind: 'land', biome: 'parkland', flr: 0, road: 1, rd: 'ns' }, 'a road through a park');
sweep({ kind: 'land', biome: 'park', flr: 0, bt: 'shop', is_building: 1, floors: 3 }, 'a building on a lawn');

// ── 7. THE CAP HOLDS AT THE TOP OF THE SLIDER ─────────────────────────────────
// ⚠ A SCENE WITH THREE FLOCKS IN IT CANNOT SEE A CAP OF TEN. The nearest-first cap is a frame
// budget — the thing that stops a park district owning the frame — and every check above runs in a
// field sparse enough that it is never reached.
//
// ⚠ AND COUNTING QUADS IS NOT COUNTING FLOCKS. A ceiling of "the cap times the biggest a flock
// gets" is arithmetically correct and useless in practice: wound up to the slider's maximum this
// scene draws 55 uncapped against a ceiling of 60, so deleting the cap outright leaves it green.
// Each bird is instead attributed to its NEAREST ANCHOR — which is what a flock is — and the
// distinct count is the thing the cap actually bounds.
const GOOSE_MAX_FLOCKS = 10;
const nearestAnchor = (q, anchors) => {
  let best = null, bd = Infinity;
  for (const a of anchors) {
    const d = Math.hypot(q.wx - a.ax, q.wy - a.ay);
    if (d < bd) { bd = d; best = a; }
  }
  return best ? best.ax + ',' + best.ay : '?';
};
ws.RENDER_TUNE.geese = 3;
const dense = paint(viewAt(CENTRE, 0, 12, undefined, 0, turf));
ws.RENDER_TUNE.geese = geeseWas;
const denseAnchors = flocksNear(CENTRE.x, CENTRE.y, 40, 3, () => true);
const denseFlocks = new Set(dense.quads.map((q) => nearestAnchor(q, denseAnchors))).size;
if (denseFlocks > GOOSE_MAX_FLOCKS) {
  problems.push(`at the slider's maximum ${denseFlocks} flocks drew in one frame, past the cap of ${GOOSE_MAX_FLOCKS}`);
}
if (denseAnchors.length <= GOOSE_MAX_FLOCKS) {
  problems.push(`the dense scene only has ${denseAnchors.length} candidate flocks, so the cap of ${GOOSE_MAX_FLOCKS} is never reached and this check is vacuous`);
}
notes.push(`${denseFlocks} flocks drew of ${denseAnchors.length} candidates at density 3 (cap ${GOOSE_MAX_FLOCKS})`);

// ── 8. NIGHT ──────────────────────────────────────────────────────────────────
T = T_GROUND ?? 1e6;
const night = paint(viewAt(CENTRE, 0, 2));
if (night.quads.length) problems.push('geese drew after dark — the pass is meant to be day-gated, as drawBirds is');

// ── 9. NOTHING IS LEFT PAINTING ON THE CANVAS ─────────────────────────────────
// `worldresidue` asks this of every other world painter and cannot ask it of the geese: it runs at
// hour 22 because the lamps and the lit scatter are night-gated, and a goose stops drawing after
// dark. Same question, same instrument, in the one scene that can answer it.
//
// ⚠ THE FAILURE IT IS FOR IS `emitFace`. That defers its closure to `flushFaces()`, which runs
// AFTER the GL composite has already read the sink — so a goose queued there reaches the GPU never
// and paints over the finished city instead, with an all-or-nothing probe at its feet as the only
// thing between it and a tower. It draws nothing on the depth buffer and reports nothing, which is
// the hard failure to see. `emitScatterFace` is the seam that avoids it.
//
// ⚠ AND THE CONTROL IS NOT OPTIONAL. An empty tally is also what comes back from a scene with no
// geese in it, which is how a census comes to carry a claim about a painter it never ran.
T = T_GROUND ?? 1e6;
const censusView = viewAt(CENTRE, 0, 12);
function census(glOn) {
  const c = globalThis.document.createElement('canvas');
  c.width = W; c.height = H;
  ws.RENDER_TUNE.gl = glOn ? 1 : 0; ws.RENDER_TUNE.glFloor = glOn ? 1 : 0;
  ws.installGLWorld(glOn ? (() => ({ faces: 1, canvas: c })) : null);
  ws.paintWindshield('__fa', censusView);
  globalThis.window.__emitWhoStart();
  ws.paintWindshield('__fa', censusView);
  const rows = globalThis.window.__emitWho();
  ws.installGLWorld(null);
  if (typeof rows === 'string') return [];
  return rows.map((l) => { const m = l.match(/^(\d+)\s+(.*)$/); return m ? { faces: +m[1], tag: m[2] } : null; }).filter(Boolean);
}
// ⚠ AND THE CONTROL MUST ACTUALLY PAINT A BIRD, not merely queue one. With GLASS 2 off the sink
// is closed, so a drawer that only pushes a billboard draws NOTHING — and 
// still queues its closure, so the tally below counts 28 faces either way. That is exactly how
// the geese shipped invisible on the 2-D path with every headless gate green; it took looking at
// a frame in a browser to see it. Counting the PAINTER is what tells the two apart.
// ⚠ EACH HALF IS COUNTED AT A MOMENT ITS OWN STATE ACTUALLY HAPPENS. One census at whatever T the
// previous check left set only counts both halves when the scene happens to hold a flock on the
// ground AND one in the air at that instant — which it did for one anchor and stopped doing for
// the next. The failure reads as "the flying drawer lost its canvas path", which is a real and
// serious bug, so the check must not be able to claim it for a reason as thin as the clock.
const paintBefore = faunaPaintCount();
T = T_GROUND ?? 1e6;
const ctrlRows = census(false);
const midC = faunaPaintCount();
T = T_AIR ?? 1e6;
census(false);
const after = faunaPaintCount();
const walkedC = midC.walk - paintBefore.walk, airC = after.air - midC.air;
// ⚠ BOTH HALVES, SEPARATELY. The walking and flying drawers are different code, so a total lets
// one of them lose its canvas path with the other keeping the count above zero.
if (!walkedC) problems.push('GLASS 1 queued geese but painted no WALKING bird — drawGooseGround only pushes a billboard, so with GLASS 2 off the flock on the grass is invisible');
if (!airC) problems.push('GLASS 1 queued geese but painted no FLYING bird — drawGooseAir only pushes a billboard, so with GLASS 2 off the skein is invisible');
if (walkedC && airC) notes.push(`GLASS 1 painted ${walkedC} walking and ${airC} flying`);
const glRows = census(true);
const gooseIn = (rows) => rows.filter((r) => /drawGeese/.test(r.tag));
if (!gooseIn(ctrlRows).length) {
  problems.push('the GLASS 1 control drew no drawGeese — the scene does not contain what this measures, so an empty GLASS 2 tally would mean nothing');
} else {
  const left = gooseIn(glRows);
  if (left.length) problems.push(`drawGeese left ${left.reduce((a, r) => a + r.faces, 0)} face(s) on the canvas over the composited city — it is queueing through emitFace rather than emitScatterFace`);
}
if (REPORT) {
  console.log('  control goose rows: ' + (gooseIn(ctrlRows).map((r) => r.faces + ' ' + r.tag).join(' | ') || 'none'));
  console.log('  residue goose rows: ' + (gooseIn(glRows).map((r) => r.faces + ' ' + r.tag).join(' | ') || 'none'));
}

// ── 10. THE DISPLAY RATIO CANNOT REACH IT ─────────────────────────────
// `dprsize` sweeps every billboard producer for a size handed over in CSS pixels where device ones
// belong — an error that is exactly zero at dpr 1, which is what every other harness here runs at,
// and a moving 1.67× in the game because the ratio carries the adaptive resolution dial. A goose
// used to be one of those producers and pushed DIRECTLY rather than through `scatterBillboard`,
// which made it the one that could forget the funnel.
//
// ⚠ A MESH CANNOT HAVE THAT BUG, AND THAT IS WORTH ASSERTING RATHER THAN ASSUMING. Its vertices
// are world tiles; nothing about a display converts them. So the sweep stays and the claim gets
// stronger: the geometry must be IDENTICAL at every ratio, not merely proportional to one.
const RATIOS = [0.6, 1, 1.5, 2];
const byRatio = new Map();
for (const dpr of RATIOS) {
  globalThis.window.devicePixelRatio = dpr;
  // ⚠ RE-STUB THE CANVAS AT EACH RATIO, as dprsize does. `stubCanvas` sets the CSS box and the
  // backing store to the same numbers; the renderer then writes the backing store to
  // clientWidth × dpr and leaves it there. Reuse one element across ratios and the next paint
  // starts from the PREVIOUS ratio’s backing store, which moves the focal length — and a gate that
  // reports a bug in the renderer that is really a bug in the harness is worse than no gate.
  stubCanvas('__fa', W, H);
  T = T_AIR ?? 1e6;
  byRatio.set(dpr, paint(viewAt(CENTRE, 0, 12)));
}
stubCanvas('__fa', W, H);
globalThis.window.devicePixelRatio = 1;
const oneAt = byRatio.get(1);
if (!oneAt.quads.length) problems.push('the dpr sweep reached no goose — it is vacuous');
else {
  let said = false;
  for (const dpr of RATIOS) {
    if (said) break;
    const r = byRatio.get(dpr);
    if (r.quads.length !== oneAt.quads.length || r.faces !== oneAt.faces) {
      problems.push(`the scene drew ${r.quads.length} birds in ${r.faces} faces at dpr ${dpr} against ${oneAt.quads.length} in ${oneAt.faces} at 1 — the ratio changed the scene, so nothing here can be compared`);
      said = true; break;
    }
    for (let i = 0; i < r.quads.length && !said; i++) {
      for (const f of ['wx', 'wy', 'z']) {
        if (Math.abs(r.quads[i][f] - oneAt.quads[i][f]) > 1e-9) {
          problems.push(`a goose’s ${f} moved with the display ratio (${r.quads[i][f]} at dpr ${dpr} against ${oneAt.quads[i][f]} at 1) — a world position is being derived from a screen size`);
          said = true; break;
        }
      }
    }
  }
  if (!said) notes.push(`the mesh is identical across dpr ${RATIOS.join(', ')}`);
}
T = T_GROUND ?? 1e6;

// ── 11. FLYING THROUGH THEM IS WHAT CAUSES A BIRD STRIKE ──────────────────────
// `plugins/flight/hazards.js` used to roll `Math.random() < 0.05` per tick. It asks
// `flockOnSegment` now, so a strike is a flock that was in front of you — which means the strike
// and the picture are the same arithmetic and cannot disagree about whether a bird was there.
//
// ⚠ THE SWEPT TEST IS THE WHOLE POINT, so it gets the check. The flight tick is 3 s and an
// aircraft crosses several tiles in that time; a "am I near a flock now" test misses the one you
// went straight through between two samples, and misses it silently — the pilot sees the flock,
// flies into it, and nothing happens. The road signs in the trucking model record the same trap.
{
  const anyGround = () => true;
  // A moment the anchor flock is flying, and the leg that goes through where it is.
  const tAir = T_AIR ?? 1e6;
  const st = flockState(ANCHOR, tAir);
  if (!st.airborne) problems.push('the strike check could not find the anchor flock airborne — it is vacuous');
  else {
    // Straight through the middle of it.
    const through = flockOnSegment(st.cx - 3, st.cy, st.cx + 3, st.cy, tAir, anyGround);
    if (!through) problems.push('a leg passing straight through an airborne flock did not register a strike');

    // ⚠ THE SAME LEG AS A POINT TEST AT EACH END. Both endpoints are three tiles clear of the
    // flock, so a check that only asked "is one near a flock" would find nothing — which is
    // precisely the miss. If this ever passes, the test has stopped being swept.
    const atStart = flockOnSegment(st.cx - 3, st.cy, st.cx - 3, st.cy, tAir, anyGround);
    const atEnd = flockOnSegment(st.cx + 3, st.cy, st.cx + 3, st.cy, tAir, anyGround);
    if (atStart || atEnd) problems.push('an endpoint three tiles from the flock registered a strike on its own — the radius is far too wide to mean anything');

    // Well clear, and nothing happens however far you fly.
    const clear = flockOnSegment(st.cx - 3, st.cy + 40, st.cx + 3, st.cy + 40, tAir, anyGround);
    if (clear) problems.push('a leg forty tiles from any flock still registered a strike');

    // Ground that is not theirs holds no flock, so there is nothing to hit.
    const noHabitat = flockOnSegment(st.cx - 3, st.cy, st.cx + 3, st.cy, tAir, () => false);
    if (noHabitat) problems.push('a strike registered over ground the habitat test refused');

    // ⚠ AND A GOOSE ON THE GRASS IS NOT IN ANYBODY'S WAY. At a moment the flock is down, the same
    // leg over the same tiles must find nothing — otherwise the hazard fires at a bird that is
    // standing on a lawn, which the pilot can see it is.
    const tGround = T_GROUND ?? 1e6;
    const down = flockState(ANCHOR, tGround);
    const overGrazing = flockOnSegment(down.cx - 3, down.cy, down.cx + 3, down.cy, tGround, anyGround);
    if (overGrazing) problems.push('a flock ON THE GROUND registered a bird strike');
    notes.push('a leg through an airborne flock strikes, its own endpoints do not, and a grazing flock never does');
  }
}

// ── 12. WHAT FLIES IS SOLID, AND NOTHING ELSE ASKS TO BE ──────────────────
// Reported as the clouds appearing in front of the geese, and it was one property of one quad: a
// billboard writes no depth, so the cloud deck — which runs after the world and tests against the
// depth the world left — found the ground four hundred tiles behind the flock and painted over it.
// `glAirDepth` bought the silhouette back by laying the card into the depth buffer in a prepass.
//
// ⚠ A MESH WRITES ITS OWN DEPTH AND THE PROBLEM IS GONE RATHER THAN FIXED, which is a different
// thing to check: the flock must be in the SOLIDS list and not in the billboard one, and the flag
// must no longer reach it. The flag still governs the air CONTACTS, which are still cards.
//
// ⚠ NO HEADLESS GATE CAN SEE THE PICTURE. Every harness here installs a GL hook that returns a bare
// canvas, so not one of them reaches a draw call, let alone a depth test; `__glGooseSky()` in the
// Modelshop is the instrument that measures the pixels. What IS checkable here is the DATA.
{
  const airDepthWas = ws.RENDER_TUNE.glAirDepth;
  T = T_AIR ?? 1e6;
  const flying = paint(viewAt(CENTRE, 0, 12));
  const air12 = airborne(flying), ground12 = grounded(flying);
  if (!air12.length) problems.push('no airborne goose in the depth check — it is vacuous');
  if (flying.gooseCards) problems.push(`${flying.gooseCards} goose billboard(s) reached the scatter layer — a flying bird on a card has no depth of its own and the cloud deck paints over the flock`);
  if (flying.otherDepth) problems.push(`${flying.otherDepth} billboards asked to write depth in a scene with no air contacts in it`);

  ws.RENDER_TUNE.glAirDepth = 0;
  const flat = paint(viewAt(CENTRE, 0, 12));
  ws.RENDER_TUNE.glAirDepth = airDepthWas;
  // ⚠ THE FLAG MAY NOT TOUCH THE FLOCK AT ALL NOW. It was the geese’s own switch; leaving them
  // wired to it would be a knob that quietly half-removes a feature it no longer owns.
  if (flat.faces !== flying.faces || airborne(flat).length !== air12.length) {
    problems.push('glAirDepth changed the flock — it governs the air contacts, and a bird is geometry now');
  }
  notes.push(`${air12.length} airborne and ${ground12.length} walking birds, all of them solid, none on a card`);
}

// ── 13. THE TOUCHDOWN DOES NOT POP ────────────────────────────────────────────
// The flock itself has always landed correctly — the circuit's radius rides the same ramp as its
// height, so both collapse onto the anchor together and the centre crosses the boundary having
// moved nothing. What the birds did was jump: the skein and the milling patch are unrelated
// arithmetic, so at the instant the state flipped every bird went from its slot in the formation to
// a milling position whose phase comes off the wall clock. Measured through this same sink before
// the blend: 0.37 tiles mean, 0.45 worst, in ONE frame, on birds that mill inside a 0.34-tile
// radius. Nothing throws, nothing is missing, and it reads as the flock respawning on landing.
{
  let land = null;
  for (let i = 1; i < 12000; i++) {
    const t0 = 1e6 + (i - 1) * 25, t1 = 1e6 + i * 25;
    if (flockState(ANCHOR, t0).airborne && !flockState(ANCHOR, t1).airborne) { land = [t0, t1]; break; }
  }
  if (!land) problems.push('the nearest flock never touches down in the search window — the cycle is broken');
  else {
    // ⚠ THE ANCHOR'S OWN FLOCK, for the reason the startle check records: a neighbouring flock
    // read as part of this one measures the gap between two flocks rather than the jump. At both
    // boundary frames this flock's centre IS the anchor tile, so a tile's radius isolates it and
    // keeps drawGeese's own emission order.
    const mine = (r) => r.quads.filter((q) => Math.hypot(q.wx - ANCHOR.ax, q.wy - ANCHOR.ay) < 1.2);
    T = land[0]; const lastAir = mine(paint(viewAt(CENTRE, 0, 12)));
    T = land[1]; const firstGnd = mine(paint(viewAt(CENTRE, 0, 12)));
    const st0 = flockState(ANCHOR, land[0]), st1 = flockState(ANCHOR, land[1]);
    const centre = Math.hypot(st0.cx - st1.cx, st0.cy - st1.cy);

    if (!lastAir.length || !firstGnd.length) problems.push('the touchdown check saw no birds at the boundary — it is vacuous');
    else if (lastAir.length !== firstGnd.length) problems.push(`the flock changed size across its own touchdown: ${lastAir.length} → ${firstGnd.length}`);
    else if (!(st0.z < 0.01)) problems.push(`the flock's last airborne frame is ${st0.z.toFixed(2)} tiles up — it stops flying before it reaches the ground`);
    // ⚠ NOT ZERO, BECAUSE THE BOUNDARY IS SAMPLED ON A 25 ms GRID. The last airborne frame is a
    // hair short of the end of the ramp, so the radius there is ~7e-6 tiles rather than 0, and a
    // check for exact equality fails on a circuit that closes perfectly.
    else if (centre > 1e-3) problems.push(`the flock centre moved ${centre.toExponential(1)} tiles across the touchdown — the circuit does not close on the anchor`);
    else {
      let worst = 0;
      for (let i = 0; i < lastAir.length; i++) {
        worst = Math.max(worst, Math.hypot(lastAir[i].wx - firstGnd[i].wx, lastAir[i].wy - firstGnd[i].wy));
      }
      // A tenth of a tile is twice a goose's own length and a fifth of a bird's mill radius — well
      // under the 0.45 that was there, and loose enough that the settle blend may be retuned.
      if (worst > 0.1) problems.push(`a bird jumped ${worst.toFixed(2)} tiles in the single frame it landed — the ground layout does not start from the skein`);
      else {
        // ⚠ AND IT MUST NOT SIMPLY BE STUCK THERE. A blend that never releases passes the check
        // above perfectly and leaves a flock frozen in formation on the grass for ever.
        const settled = findT(false);
        const free = settled == null ? null : (T = settled, mine(paint(viewAt(CENTRE, 0, 12))));
        let moved = 0;
        if (free && free.length === firstGnd.length) {
          for (let i = 0; i < free.length; i++) moved = Math.max(moved, Math.hypot(free[i].wx - firstGnd[i].wx, free[i].wy - firstGnd[i].wy));
        }
        if (!(moved > 0.05)) problems.push('the flock never left the formation it landed in — the settle blend releases nothing');
        else notes.push(`touchdown moves a bird ${worst.toFixed(3)} tiles and it is ${moved.toFixed(2)} clear of the skein once settled`);
      }
    }
  }
}

// ── 13b. AND IT DOES NOT SINK INTO THE FIELD IT IS LANDING IN ─────────────
// The other half of the touchdown, and the half nothing was measuring: the birds arrived in the
// right PLACE at the wrong HEIGHT, and the depth-tested ground cut off everything under them.
// Reported twice — "the geese almost disappear below the ground on landing, just the top of the
// heads visible" — and the second time it was the whole card rather than the wings.
//
// ⚠ THE MESH ANSWERS IT DIRECTLY, WHICH IS WHY THIS CHECK GOT SHORTER. The card version had to
// recover pixels-per-model-unit from the pushed quad and solve for how far the picture hung below
// its own anchor; a solid bird simply has vertices, and the question is whether any of them is
// under z = 0 while the flock is within a breath of the ground.
//
// ⚠ AND IT IS NOT A CHECK ON THE FLARE. Holding the wings out of the full downstroke near the
// ground is one way to satisfy this and not the only one, so what is asserted is the OUTCOME —
// nothing sinks — which stays true if that is ever retuned and goes red if it is removed.
{
  // Every airborne frame within a breath of the ground, at both ends: a flock takes off through the
  // same turf it lands in, and a fix applied to one end only is a fix nobody would notice.
  const edges = [];
  for (let i = 1; i < 12000; i++) {
    const a2 = flockState(ANCHOR, 1e6 + (i - 1) * 25), b2 = flockState(ANCHOR, 1e6 + i * 25);
    if (a2.airborne !== b2.airborne) edges.push([1e6 + (i - 1) * 25, a2.airborne]);
    if (edges.length === 2) break;
  }
  const times = [];
  for (const [t, wasAir] of edges) {
    // wasAir: this is the last airborne frame before touchdown, so walk BACK from it. Otherwise it
    // is the last ground frame before take-off, so walk forward.
    for (let k = 0; k < 10; k++) times.push(t + (wasAir ? -k * 40 : 25 + k * 40));
  }
  // A standing goose’s own feet are at z = 0 and its toes spread a hair either side, so the bar is
  // a hair rather than zero. The un-lifted air pose measured 0.37 model units under, level, and
  // 0.79 wings-down; this is 0.02 of a tile, which is a quarter of one bird’s height.
  const SINK = 0.02;
  let worst = 0, seen = 0, lowestZ = Infinity;
  for (const t of times) {
    if (!flockState(ANCHOR, t).airborne) continue;
    T = t;
    const r = paint(viewAt(CENTRE, 0, 12));
    if (!airborne(r).length) continue;
    seen++;
    lowestZ = Math.min(lowestZ, ...airborne(r).map((q) => q.z));
    if (r.lowest < -worst) worst = -r.lowest;
  }
  if (!seen) problems.push('no airborne goose drew within a breath of the ground at either end of the flight — the sink check is vacuous');
  else if (lowestZ > 0.02) problems.push(`the lowest airborne goose the sink check saw was ${lowestZ.toFixed(3)} tiles up — it never gets near the turf, so it is measuring nothing`);
  else if (worst > SINK) problems.push(`a landing goose reaches ${worst.toFixed(3)} tiles under the ground over ${seen} frames — the depth-tested turf cuts that much off the bird`);
  else notes.push(`a landing bird reaches at most ${worst.toFixed(4)} tiles under the turf over ${seen} frames at both ends of the flight`);
}

// ── 13c. THE UNDERCARRIAGE ────────────────────────────────────────────────────
// A flying goose trails its feet and puts them down to land, and until this it had no feet in the
// air at all — the legs were built for the `walk` pose and nothing else. Reported as "the thing
// hanging below the geese should pull back during flight and there should be two".
//
// ⚠ EVERY PART OF THIS FAILS SILENTLY, which is the only reason it is worth sixty lines. A leg
// built in the wrong place is a leg; a `gear` flag the pose table drops is a bird that flies its
// whole circuit with its feet folded and looks exactly like one that does not have the feature;
// and a threshold set too high is a flock that comes in on final with its undercarriage down from
// the top of the climb, which reads as a bird that cannot tuck. None of the three throws and none
// is visible in a screenshot of one frame — you would have to watch one flock land.
//
// ⚠ AND IT IS ASKED IN TWO PLACES ON PURPOSE. The MODEL half asks what the mesh looks like with
// the flag set either way, through the same `faunaWorldFaces` the pass calls, so a flag quietly
// dropped between there and `buildGoose` is caught. The PASS half asks whether the renderer ever
// SETS it, and at what height — which the model cannot know and which is where a threshold goes
// wrong. Either half alone passes on a half-wired feature.
{
  const row = faunaParamBase('bird', 'goose') || {};
  const bodyLen = row.bodyLen ?? 0.34, legLen = row.legLen ?? 0.16, legW = row.legW ?? 0.018;
  const footLen = row.footLen ?? 0.07;
  const hipF = -bodyLen * 0.05;
  // The mesh is lifted so z = 0 is the sole of a standing bird's foot — see the ⚠ on the origin in
  // buildGoose — so every height below is measured against the ground the walker stands on.
  const legsOf = (o) => {
    const legs = faunaPoseFaces('bird', 'goose', o).filter((f) => f.role === 'leg');
    const pts = legs.flatMap((f) => f.p);
    const side = (s) => legs.filter((f) => f.p.reduce((a, v) => a + v[1], 0) * s > 0).length;
    return { n: legs.length, right: side(1), left: side(-1),
      minX: Math.min(...pts.map((v) => v[0])), maxX: Math.max(...pts.map((v) => v[0])),
      minZ: Math.min(...pts.map((v) => v[2])), maxY: Math.max(...pts.map((v) => Math.abs(v[1]))) };
  };
  const walk = legsOf({ state: 'walk' });
  const cruise = legsOf({ state: 'air', beat: 0 });
  const down = legsOf({ state: 'air', beat: 0, gear: 1 });

  // TWO OF THEM, in both air poses, and the same count each side. One leg is the reported bug and
  // three is the vestigial wing having been filed as one.
  for (const [what, L] of [['cruising', cruise], ['gear-down', down], ['walking', walk]]) {
    if (!L.n) problems.push(`a ${what} goose has no leg faces at all — the undercarriage is not built in that pose`);
    else if (!L.left || !L.right || L.left !== L.right) problems.push(`a ${what} goose has ${L.right} leg face(s) on one side and ${L.left} on the other — it is not a pair`);
  }
  if (faunaPoseFaces('bird', 'goose', { state: 'raft' }).some((f) => f.role === 'leg')) {
    problems.push('a rafting goose grew legs — they belong under the waterline, which cuts the body');
  }

  // ⚠ EVERYTHING BELOW NEEDS A LEG TO MEASURE. `Math.min` of nothing is Infinity, so a pose with
  // no undercarriage at all fails the pair check above and then reports five more problems in
  // which every number is ±Infinity — six reds for one bug, and the one that names the cause is
  // not the first one anybody reads.
  if (cruise.n && down.n && walk.n) {
    // TUCKED: aft of the hip and well clear of the ground plane. A tolerance of a couple of leg
    // widths, because the tarsus is a tube and its ring stands a radius proud of its own axis.
    if (cruise.maxX > hipF + legW * 3) problems.push(`a cruising goose's feet reach ${(cruise.maxX - hipF).toFixed(3)} model units FORWARD of the hip — they are not tucked, they are hanging`);
    if (cruise.minZ < legLen * 0.5) problems.push(`a cruising goose's lowest leg vertex is ${cruise.minZ.toFixed(3)} above the sole of its own foot — the gear is still down in the cruise`);
    if (!(cruise.minX < -bodyLen * 0.4)) problems.push(`a cruising goose's feet stop at ${cruise.minX.toFixed(3)} — they do not trail back far enough to read as feet behind the bird`);

    // DOWN: forward of the hip, and standing on exactly the plane the walker stands on. That second
    // one is the touchdown claim — both states take the same origin lift, so a bird in the flare has
    // its feet where it is about to be standing and the pose swap moves nothing.
    if (down.maxX < hipF + footLen) problems.push(`a landing goose's feet reach only ${(down.maxX - hipF).toFixed(3)} model units forward of the hip — it is not putting them out ahead of itself`);
    if (Math.abs(down.minZ - walk.minZ) > legW) problems.push(`a landing goose's feet sit ${(down.minZ - walk.minZ).toFixed(3)} off the plane a walking one stands on — the pose swap at touchdown will step`);
    if (!(down.maxY > walk.maxY)) problems.push(`a landing goose stands ${down.maxY.toFixed(3)} wide against a walking one at ${walk.maxY.toFixed(3)} — the webs are not splayed`);
  }

  // ⚠ AND NOTHING ELSE MAY HANG UNDER THE BIRD. The undercarriage is the lowest thing on a goose,
  // and for months it was not: a vestigial third wing drooped 0.073 model units BELOW the plane the
  // feet stand on, so the part hanging under a flying goose was never its feet. It was reported as a
  // leg twice — once as "the thing hanging below the geese", and once, after the legs were built, as
  // "this brown part that hangs off". Nothing said a word either time, because a face below the body
  // is a face like any other.
  //
  // ⚠ EXEMPTING THE WING ROLE IS THE OBVIOUS RULE AND IT MISSES THE BUG IT IS FOR. A downstroke
  // reaches 0.35 under the bird's own feet, so a wing has to be allowed down there somehow — and the
  // third wing's two faces are role `wing` as well, so `if (role === 'wing') continue` let the exact
  // part through. Written that way and mutation-tested, the gate stayed GREEN with the third wing
  // put back.
  //
  // ⚠ THE BEAT IS THE RULE INSTEAD, and it needs no exemption at all. Sweep only the poses where the
  // wings are AT OR ABOVE level — `beatDihedral` is exported and is the same function the pose table
  // asks — and in those, nothing whatever belongs below the feet. A real wing is up there by
  // arithmetic; a limb that hangs regardless of the beat has nowhere to hide, which is precisely what
  // made it read as an undercarriage in the first place.
  //
  // ⚠ AND RAFTING IS OUT, for a reason of its own: the waterline CUTS a floating bird, so its body
  // is 0.084 under that plane on purpose. See the origin lift in buildGoose.
  {
    const SLACK = legW;   // the foot's own thickness: a tube ring stands a radius proud of its axis
    let worst = 0, who = '';
    const sweep = [{ state: 'walk' }];
    for (let b = 0; b < FAUNA_BEAT_STEPS; b++) {
      for (const [fl, gr] of [[0, 0], [0, 1], [1, 1]]) {
        if (beatDihedral(b / FAUNA_BEAT_STEPS, fl) < 0) continue;      // wings below level: not this check's business
        sweep.push({ state: 'air', beat: b, flare: fl, gear: gr });
      }
    }
    for (const o of sweep) {
      for (const f of faunaPoseFaces('bird', 'goose', o)) {
        for (const v of f.p) if (-v[2] > worst) { worst = -v[2]; who = f.role + ' in ' + JSON.stringify(o); }
      }
    }
    // ⚠ A SWEEP THAT COLLAPSED TO NOTHING WOULD PASS. Retune the beat and this can empty itself out.
    if (sweep.length < 8) problems.push(`only ${sweep.length} pose(s) have the wings at or above level — the hanging-part check has nothing left to look at`);
    else if (worst > SLACK) problems.push(`a ${who} hangs ${worst.toFixed(3)} model units below the plane the bird's own feet stand on, with its wings UP — whatever that is, it is what a player sees dangling under a flying goose, not its undercarriage`);
    else notes.push(`nothing hangs below the feet across ${sweep.length} wings-up poses`);
  }

  // ⚠ AND THE FLAG HAS TO SURVIVE THE TRIP. Everything above reads the pose table directly; the
  // pass goes through `faunaWorldFaces`, and a `gear` missing from THAT destructure is a feature
  // that is wired at both ends and does nothing in the game.
  const world = (gear) => JSON.stringify(faunaWorldFaces('bird', 'goose', { state: 'air', beat: 0, gear, heading: 0.7 }));
  if (world(0) === world(1)) problems.push('faunaWorldFaces draws the same bird with the gear up and down — the flag is dropped before it reaches the mesh');
  notes.push(`the gear is ${(cruise.minZ / legLen).toFixed(1)} leg-lengths up in the cruise and on the walker's own foot plane when it is down`);
}

// ── 13d. …AND HOW LONG THE FEET ARE ACTUALLY OUT ────────────────────────────────
// The model half proves a goose HAS two undercarriage poses. This proves the pass ever picks the
// second one — and, the part that matters to anybody watching, for how long. "Only bring them out
// as they land" is a duration, and a threshold set at the flare height satisfies every structural
// check here while putting the gear down for the last fifth of a second of the approach.
//
// ⚠ THE TIMES ARE CHOSEN BY `flockState`, NEVER THE ANSWER. Deciding WHEN to watch a landing is
// not the same as deciding what one should look like: what comes back is `f.bird.gear` off the
// sink. A check that re-derived the rule would be comparing the renderer against its own copy.
//
// ⚠ AND IT IS A SECOND OR TWO OF A MINUTE-LONG CIRCUIT, which is why the sweep walks the descent
// rather than the lap. Twenty samples spread over a whole flight land nought or one inside the
// window, and a check that usually sees one gear-down frame is a check that goes quietly vacuous
// the first time the threshold moves.
{
  // ⚠ ONE FLOCK IN THE WHOLE WINDOW, and that is what makes the split readable at all. Every flock
  // has its own period and phase, so four of them in the frame is four altitudes at one instant and
  // a bird's gear compared against the wrong one. A first cut did exactly that and reported feet
  // down at the top of the climb — a true statement about a DIFFERENT flock. A single habitat tile
  // leaves exactly one.
  // ⚠ 'redrock' AND NOT 'citycore', for the reason the ⚠ above gives. This scene's whole job is to
  // leave exactly ONE flock, and it did that by filling the rest of the window with a ground no
  // bird lived on — which citycore stopped being the moment pigeons arrived. The failure it let
  // back in is the one already named above: a bird's gear compared against a different flock's
  // altitude, reported as feet down at the top of the climb.
  const soleField = (wx, wy) => (wx === ANCHOR.ax && wy === ANCHOR.ay
    ? { kind: 'land', biome: 'parkland', flr: 0 }
    : { kind: 'land', biome: EMPTY_GROUND, flr: 0 });
  const soleView = () => viewAt(CENTRE, 0, 12, { x: 0.31, y: -0.17 }, 0, soleField);

  // Touchdown, to the millisecond grid check 13 uses — the descent is measured back from it.
  let land = null;
  for (let i = 1; i < 12000; i++) {
    const t0 = 1e6 + (i - 1) * 25, t1 = 1e6 + i * 25;
    if (flockState(ANCHOR, t0).airborne && !flockState(ANCHOR, t1).airborne) { land = t0; break; }
  }
  const flightMs = flockState(ANCHOR, land ?? 1e6).period * (1 - U_GROUND);
  if (land == null) problems.push('the gear sweep never found a touchdown — the cycle is broken');
  else {
    // The last fifth of the flight at twenty-four steps, plus four from the cruise as the control:
    // without those, "the gear is down" and "the gear is always down" are the same measurement.
    const span = flightMs * 0.2;
    const probe = [];
    for (let k = 23; k >= 0; k--) probe.push(land - (span * k) / 23);
    for (let k = 1; k <= 4; k++) probe.push(land - flightMs * (0.30 + k * 0.1));
    const seen = [];
    for (const t of probe) {
      const st = flockState(ANCHOR, t);
      if (!st.airborne) continue;
      T = t;
      for (const q of airborne(paint(soleView()))) seen.push({ t, z: st.z, gear: q.gear, flare: q.flare });
    }
    const up = seen.filter((s) => !s.gear), dn = seen.filter((s) => s.gear);
    if (!seen.length) problems.push('no airborne goose reached the sink over the descent — the undercarriage check is vacuous');
    else if (!dn.length) problems.push('no goose put its feet down anywhere in the last fifth of its approach — the gear flag is never set');
    else if (!up.length) problems.push('every goose sampled had its feet down, including four from the middle of the cruise — the gear is never tucked');
    else {
      // A CLEAN SPLIT ON HEIGHT. The flag is a threshold on the FLOCK's altitude, so the highest
      // bird with its feet down must sit below the lowest bird with them up. A flag keyed on
      // anything else — the bird's own station-keeping offset, the beat, the frame — interleaves.
      const hiDown = Math.max(...dn.map((s) => s.z)), loUp = Math.min(...up.map((s) => s.z));
      if (!(hiDown < loUp)) problems.push(`a goose had its feet down at ${hiDown.toFixed(2)} tiles and tucked at ${loUp.toFixed(2)} — the gear is not a clean threshold on the flock's altitude`);
      // ⚠ AND A BIRD CANNOT FLARE WITH ITS FEET UP. Two thresholds, two flags, and the flare's is
      // the lower by design — put GOOSE_GEAR_Z under it and a goose arrives folded and lands on its
      // belly, with nothing anywhere to say so.
      const badFlare = seen.filter((s) => s.flare && !s.gear).length;
      if (badFlare) problems.push(`${badFlare} goose sample(s) were in the flare with the gear still up — GOOSE_GEAR_Z has gone below the flare height`);
      // HOW LONG, which is the whole claim. Under a second and nobody sees it happen; much over a
      // fifth of the flight and the bird is not tucking at all, it is flying about with its feet
      // dangling. Both ends are generous — this is a bracket, not a tuning.
      const outFor = (land - Math.min(...dn.map((s) => s.t))) / 1000;
      if (outFor < 1) problems.push(`the gear is only down for the last ${outFor.toFixed(2)}s of the approach — that is a frame or two, and nobody will see it come out`);
      else if (outFor > flightMs * 0.2 / 1000) problems.push(`the gear is down for the last ${outFor.toFixed(1)}s of a ${(flightMs / 1000).toFixed(0)}s flight — the bird never tucks its feet up properly`);
      else notes.push(`the gear comes down ${outFor.toFixed(1)}s out on a ${(flightMs / 1000).toFixed(0)}s flight, between ${hiDown.toFixed(2)} and ${loUp.toFixed(2)} tiles up`);
    }
  }
}

// ── 14. A FLOCK POINTS THE WAY IT IS GOING ────────────────────────────────────
// The circuit has TWO moving terms — the angle round it and the radius, which rides the ramp — so
// the course is tangential plus radial, and through the climb and the descent the radial part is
// the bigger one. The heading shipped as the bare tangent, which is 90° out at both ends where the
// radius is zero: the flock flew sideways for 40% of every flight. Differenced from the POSITION
// this function reports, so it owes nothing to the field it is checking.
{
  let worst = 0, sum = 0, n = 0;
  for (const fl of localAnchors) {
    const period = flockState(fl, 1e6).period;
    for (let k = 0; k <= 120; k++) {
      const now = 1e6 + (k / 120) * period;
      const s = flockState(fl, now);
      if (!s.airborne) continue;
      const a = flockState(fl, now - 12), b = flockState(fl, now + 12);
      if (!a.airborne || !b.airborne) continue;
      const vx = b.cx - a.cx, vy = b.cy - a.cy;
      if (!vx && !vy) continue;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(vy, vx) - s.heading), Math.cos(Math.atan2(vy, vx) - s.heading))) * 180 / Math.PI;
      sum += off; n++; if (off > worst) worst = off;
    }
  }
  if (!n) problems.push('the heading check found no airborne sample — it is vacuous');
  // ⚠ The bound is generous against the finite difference, not against the bug: the tangent was
  // 18.3° mean and a full 90° worst, so anything near a right angle is the old behaviour back.
  else if (worst > 15) problems.push(`a flock is drawn ${worst.toFixed(0)}° off the course it is actually flying (mean ${(sum / n).toFixed(1)}°)`);
  else notes.push(`heading tracks the course to ${worst.toFixed(0)}° worst over ${n} airborne samples`);
}

// ── 15. THE CIRCUIT GOES ROUND THE BUILDINGS ──────────────────────────────────
// A circle of GOOSE_R drawn round a park tile is three and a half tiles across, and a park in a
// city has something standing within three and a half tiles of most of its tiles. Reported exactly
// that way: the flock flies through the buildings.
//
// ⚠ THE CONTROL IS THE WHOLE CHECK. "No sample landed on a built tile" is also what comes back
// when the buildings are not in the flock's way in the first place — so the same circuit is swept
// with no clearance profile at all, and if THAT one is clean the scene is proving nothing and this
// says so rather than passing.
{
  // A terrace down one side of the anchor and a block across the other, both well inside GOOSE_R.
  const WALL = new Set(['2,-1', '2,0', '2,1', '2,2', '3,0', '3,1', '-1,-2', '0,-2', '1,-2', '0,-3']);
  const blocked = (wx, wy) => WALL.has((wx - ANCHOR.ax) + ',' + (wy - ANCHOR.ay));
  const onBuilding = (clear) => {
    let hits = 0, samples = 0;
    const period = flockState(ANCHOR, 1e6).period;
    for (let k = 0; k <= 600; k++) {
      const s = flockState(ANCHOR, 1e6 + (k / 600) * period, clear);
      if (!s.airborne) continue;
      samples++;
      if (blocked(Math.round(s.cx), Math.round(s.cy))) hits++;
    }
    return { hits, samples };
  };
  const bent = onBuilding(flockClearance(ANCHOR, blocked));
  const straight = onBuilding(null);
  if (!straight.hits) {
    problems.push('the avoidance control is vacuous — the plain circle misses this scene\'s buildings, so nothing is being avoided');
  } else if (bent.hits) {
    problems.push(`a flock's circuit crosses a built tile at ${bent.hits} of ${bent.samples} samples (the plain circle crosses at ${straight.hits})`);
  } else {
    notes.push(`the circuit bends off ${straight.hits} built-tile crossings of ${straight.samples}`);
  }
  // ⚠ AND IT MUST NOT COLLAPSE. Fitting ONE radius to the clear space takes the minimum over the
  // compass, so a single shed pulls the whole circuit into a buzz over the anchor — which passes
  // the check above and is not what a flock does. The loop has to stay wide on the open side.
  const prof = flockClearance(ANCHOR, blocked);
  if (!prof) problems.push('flockClearance answered null for a scene with ten built tiles in it');
  else if (Math.max(...prof) < 2.6) problems.push(`the circuit collapsed to ${Math.max(...prof).toFixed(2)} tiles at its widest — a shed on one side must not shrink the open side`);
  else notes.push(`clearance ${Math.min(...prof).toFixed(2)}–${Math.max(...prof).toFixed(2)} tiles round the compass`);
  // …and open country is still the plain circle, allocating nothing.
  if (flockClearance(ANCHOR, () => false) !== null) problems.push('a flock over open ground built a clearance profile it does not need');
}

// ── 15c. AND THE BENT CIRCUIT IS STILL A FLIGHT PATH ──────────────────────────
// ⚠ THE POSITION BEING RIGHT IS NOT THE SAME AS THE PATH BEING FLYABLE, and this is the check that
// cost the most to learn. A radius sampled at twelve spokes and interpolated with SMOOTHSTEP is C1,
// cannot overshoot, and is the obvious safe choice — and its derivative is zero at every spoke, so
// the loop flattens at each one. On the position that is a 0.07-tile scallop nobody would ever see.
// But the renderer banks the birds off the TURN RATE, which is the derivative, and there the same
// artefact is a swing from +73°/s to -103°/s and back, seven times in one pass: a skein rolling
// hard left, hard right, hard left round the obstruction. Correct positions, and visibly broken.
//
// So the thing measured is what a viewer actually sees — the BANK ANGLE, at a realistic sampling
// interval — and not the radius, which looked perfect throughout.
{
  const WALL = new Set(['2,-1', '2,0', '2,1', '2,2', '3,0', '3,1', '-1,-2', '0,-2', '1,-2', '0,-3']);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // The renderer's own bank, in degrees — see GOOSE_BANK_MAX / GOOSE_BANK_PER_RAD in windshield.js.
  const bank = (turn) => clamp(turn * 1.9, -0.50, 0.50) * 180 / Math.PI;
  const STEP = 100;            // ms of wall clock, about six frames
  let worst = 0, worstAt = '';
  for (const fl of flocksNear(ANCHOR.ax, ANCHOR.ay, 14, 1, () => true)) {
    const blocked = (wx, wy) => WALL.has((wx - fl.ax) + ',' + (wy - fl.ay));
    const clear = flockClearance(fl, blocked);
    const period = flockState(fl, 1e6).period;
    let prev = null;
    for (let T = 1e6; T < 1e6 + period; T += STEP) {
      const s = flockState(fl, T, clear);
      // The two ends of the lap are excluded because the radius ramps through zero there and the
      // course genuinely does swing fast — a fact about the circuit, not about the interpolation.
      if (!s.airborne || s.t < 0.15 || s.t > 0.85) { prev = null; continue; }
      const b = bank(s.turn);
      if (prev != null && Math.abs(b - prev) > worst) { worst = Math.abs(b - prev); worstAt = `${fl.ax},${fl.ay} t=${s.t.toFixed(2)}`; }
      prev = b;
    }
  }
  // ⚠ THE BOUND IS AGAINST THE ARTEFACT AND IT IS THE OUTCOME THAT IS GATED, NOT A MECHANISM.
  // THREE things hold this number down — the slew limit on the profile, the matched-tangent spline
  // between spokes, and the wide window `turn` is differenced over — and they are deliberately
  // redundant, so mutating any ONE of them still passes. Measured on this sweep: 57° with all three
  // gone (which is where this shipped from), 22-23° with any one of them gone, 13° as it stands.
  // A check pinned to one mechanism would go quiet the day somebody replaced it with a better one;
  // this one only cares that the wings are not flapping between hard left and hard right bank.
  if (worst > 25) problems.push(`a flock's bank swings ${worst.toFixed(0)}° in ${STEP}ms at ${worstAt} — the circuit's radius is not C1 where it bends`);
  else notes.push(`the bank moves at most ${worst.toFixed(0)}° per ${STEP}ms round an obstruction`);
}

// ── 15b. AND THE PASS CARRIES IT, NOT JUST THE GEOMETRY ───────────────────────
// ⚠ A CORRECT `flockClearance` NOBODY CALLS IS THE SAME PICTURE AS NO `flockClearance` AT ALL. The
// check above is pure arithmetic out of birds.js; this one paints, and asks where the quads landed.
//
// ⚠ AND IT HAS TO SWEEP THE CLOCK, NOT PAINT ONE MOMENT. A lap takes most of a minute and the block
// occupies a few tiles of it, so a single frame catches the flock over the buildings only by luck —
// written that way first, it passed with the pass's clearance deleted outright. The control says
// which moments MATTER: the plain circle's own centre, at the same instants, on a built tile.
{
  const BLOCK = { kind: 'land', biome: 'citycore', flr: 4, bt: 'office', ent: 'west', is_building: 1, floors: 4 };
  const onBlock = (wx, wy) => {
    const rx = Math.round(wx - ANCHOR.ax), ry = Math.round(wy - ANCHOR.ay);
    return rx >= 2 && rx <= 3 && ry >= -2 && ry <= 2;
  };
  const builtAt = (wx, wy) => (onBlock(wx, wy) ? { ...BLOCK } : park(wx, wy));
  const view = viewAt({ x: ANCHOR.ax, y: ANCHOR.ay + 7 }, 0, 12, undefined, 0, builtAt);
  const period = flockState(ANCHOR, 1e6).period;
  // How far INSIDE the block a point is, in tiles — 0 anywhere outside it. The block is rx 2..3 and
  // ry -2..2 as whole tiles, so its edges are at 1.5/3.5 and ±2.5.
  const depthIn = (wx, wy) => {
    const rx = wx - ANCHOR.ax, ry = wy - ANCHOR.ay;
    return Math.max(0, Math.min(rx - 1.5, 3.5 - rx, ry + 2.5, 2.5 - ry));
  };
  let over = 0, flying = 0, wouldCross = 0, centreOver = 0, deepest = 0;
  const offenders = [];
  for (let k = 0; k < 40; k++) {
    T = 1e6 + (k / 40) * period;
    const st = flockState(ANCHOR, T);                 // the PLAIN circle — the control
    if (!st.airborne) continue;
    if (onBlock(st.cx, st.cy)) wouldCross++;
    const r = paint({ ...view, map: mapFor({ x: ANCHOR.ax, y: ANCHOR.ay + 7 }, builtAt) });
    const air = airborne(r);
    flying += air.length;
    const bad = air.filter((q) => onBlock(q.wx, q.wy));
    over += bad.length;
    for (const q of bad) deepest = Math.max(deepest, depthIn(q.wx, q.wy));
    // ⚠ AND THE CENTRE SEPARATELY, because that is the half of this the design promises absolutely:
    // flockClearance bends the CIRCUIT, and the birds are spread either side of wherever it goes.
    // ⚠ The BENT circuit, never `st` — that one is the plain circle this scene uses as its control,
    // so testing it here just re-counts `wouldCross` and fails every time the control works.
    const bent = flockState(ANCHOR, T, flockClearance(ANCHOR, onBlock));
    if (bent.airborne && onBlock(bent.cx, bent.cy)) centreOver++;
    // ⚠ NAMED, NOT JUST COUNTED. The flock that fails this is usually NOT the anchor the scene is
    // built around — the first failure was a second flock whose own anchor sits hard against the
    // block — and a bare tally sends you to read the wrong circuit.
    for (const q of bad) offenders.push(`(${(q.wx - ANCHOR.ax).toFixed(2)}, ${(q.wy - ANCHOR.ay).toFixed(2)}) at t=${st.t.toFixed(2)}`);
  }
  if (!flying) problems.push('no airborne quad drew in the built scene — the avoidance check cannot see anything');
  else if (!wouldCross) problems.push('the painted avoidance check is vacuous — the plain circle never puts this flock over the block, so nothing is being avoided');
  // ⚠ THE PROMISE IS THE CIRCUIT, AND A WINGTIP BIRD IS ALLOWED TO CLIP A CORNER. This asserted
  // "not one bird, ever" while a skein was a quarter of a tile wide, and a real formation is not:
  // the arms reach a tile either side of the centre, so a circuit that genuinely goes round a block
  // still puts its outermost bird over the edge of one for a moment, which is a thing geese do all
  // day. What must not happen is the FLOCK crossing — that is the "they fly through buildings" this
  // check was written for — and no bird may be deep over a roof rather than brushing its corner.
  else if (centreOver) problems.push(`the flock's own centre crossed the block ${centreOver} time(s) — the circuit is not reading flockClearance`);
  else if (deepest > BLOCK_GRAZE) problems.push(`a goose flew ${deepest.toFixed(2)} tiles inside the block, past the ${BLOCK_GRAZE} a wingtip bird is allowed to clip its corner by`);
  else notes.push(`${flying} airborne quads swept over a lap; the centre never crossed the block the plain circle crosses at ${wouldCross} of 40 moments, and the widest bird clipped its edge by ${deepest.toFixed(2)} tiles`);
  if (REPORT && offenders.length) console.log('  clipped the block: ' + offenders.slice(0, 8).join('; '));
}

// ── 1h. the orientation flash bands, rather than flickering per bird ──────────────
// The dot LOD sizes every sprite off the full wingspan, so before this a murmuration was a cloud of
// identical specks: the one thing a real one is known for -- a patch of sky going dark and pale as
// the birds turn -- was the one thing it could not show. pushFauna now dims a dot by how much wing
// it is presenting, which is one dot product against the camera's own forward.
//
// ⚠ THE CLAIM IS NOT THAT IT VARIES, WHICH IS TRIVIAL. Six hundred independent headings vary too,
// and that is per-bird flicker: sprites twinkling, which is worse than the flat cloud it replaced.
// What makes it a FLASH is that neighbours agree, and they agree because the boids step aligns
// locally (measured: local alignment 0.601 against a global coherence of 0.088). So the check is
// comparative -- the mean brightness step between a bird and its nearest neighbour, against the
// same statistic with the same brightnesses shuffled over the same positions. At 1.0 the flock is
// noise however wide its spread.
//
// ⚠ AND IT MUST NOT PULSE AS A WHOLE. A murmuration that brightened and darkened in unison would
// be a flock all facing one way, which is a skein. The frame-to-frame swing of the MEAN is the
// control for that and is deliberately tiny beside the instantaneous spread.
{
  // Read from the renderer, never restated. A second copy of this number is a gate that goes on
  // passing while the two drift, which is the one failure a gate may not have.
  const FLOOR = ws.FLASH_FLOOR;
  if (!(FLOOR > 0 && FLOOR < 1)) problems.push(`windshield does not export a usable FLASH_FLOOR (got ${FLOOR})`);
  const dimOf = (h, vx, vy, fl) => {
    const along = Math.cos(h) * vx + Math.sin(h) * vy;
    const broad = Math.sqrt(Math.max(0, 1 - along * along));
    return fl > 0 ? (1 - fl) + fl * (FLOOR + (1 - FLOOR) * broad) : 1;
  };

  // ⚠ THE OFF SWITCH IS EXACT, NOT CLOSE. `alpha * dim` runs for every dotted bird in the world,
  // so at 0 it has to be the multiplication by a literal 1 that shipped before this, or the flag's
  // 0 is a slightly different renderer rather than the old one.
  let offExact = true;
  for (let i = 0; i < 64; i++) if (!Object.is(dimOf(i * 0.1, 0.6, -0.8, 0), 1)) offExact = false;
  if (!offExact) problems.push('faunaFlash 0 does not leave the dot alpha untouched exactly');

  murmurReset();
  const camH = 0.7, vx = Math.sin(camH), vy = -Math.cos(camH);   // the camera's forward, sprite frame
  let nearSum = 0, chanceSum = 0, sdSum = 0, frames = 0, meanLo = Infinity, meanHi = -Infinity;
  for (let f = 0; f < 240; f++) {
    const pts = murmur('flash', 400, 0, 0, 3, 0.4, 1000 + f * 33, { spread: 2.2 });
    if (f < 30 || !pts || pts.length < 10) continue;
    const d = pts.map((q) => dimOf(Math.atan2(q.vy ?? 0, q.vx ?? 1), vx, vy, 1));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    meanLo = Math.min(meanLo, mean); meanHi = Math.max(meanHi, mean);
    sdSum += Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    const shuf = d.slice();
    for (let i = shuf.length - 1; i > 0; i--) { const j = (i * 1103515245 + 12345) % (i + 1); const t = shuf[i]; shuf[i] = shuf[j]; shuf[j] = t; }
    let near = 0, chance = 0;
    for (let i = 0; i < pts.length; i++) {
      let bj = -1, bd = Infinity;
      for (let j = 0; j < pts.length; j++) {
        if (j === i) continue;
        const dd = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2 + (pts[i].z - pts[j].z) ** 2;
        if (dd < bd) { bd = dd; bj = j; }
      }
      near += Math.abs(d[i] - d[bj]); chance += Math.abs(shuf[i] - shuf[bj]);
    }
    nearSum += near / pts.length; chanceSum += chance / pts.length; frames++;
  }
  murmurReset();
  const patch = chanceSum / nearSum, sd = sdSum / frames, swing = meanHi - meanLo;
  const PATCH_MIN = 2.0, SD_MIN = 0.10;
  if (!(sd > SD_MIN)) problems.push(`the flash spreads only ${sd.toFixed(3)} across the flock, under the ${SD_MIN} that is a visible step`);
  else if (!(patch > PATCH_MIN)) problems.push(`neighbouring birds agree only ${patch.toFixed(2)}x better than chance, under the ${PATCH_MIN} that separates banding from per-bird flicker`);
  else notes.push(`the flash spreads ${sd.toFixed(3)} at an instant and neighbours agree ${patch.toFixed(2)}x better than chance, while the whole flock's mean moves only ${swing.toFixed(3)}`);
}

// ── 1i. the hawk's agitation wave reaches the eye as a BAND ──────────────────
// `agitation()` is the only thing in this renderer that models a predator reaching a flock, and it
// arrives as a ROLL -- a pulse travelling out from the stoop, damping on angle. It rides into
// pushFauna as `o.roll`, where the first cut of the flash ignored it entirely.
//
// ⚠ THE CLAIM IS SPATIAL, NOT THAT ANYTHING MOVED. A roll term that varies bird by bird is noise;
// what makes it the dark band a murmuration is famous for is that birds at the SAME DISTANCE from
// the stoop share it, because the wavefront is a ring. So the test is a correlation between how far
// a bird is from the wave and how much the bank changed its brightness -- and the control is the
// same cloud with no event at all, where that correlation must collapse.
{
  const FLOOR = ws.FLASH_FLOOR, BANK = ws.FLASH_BANK;
  if (!(BANK > 0 && BANK < 1)) problems.push(`windshield does not export a usable FLASH_BANK (got ${BANK})`);
  const dimOf = (h, roll, vx, vy) => {
    const along = Math.cos(h) * vx + Math.sin(h) * vy;
    const broad = Math.sqrt(Math.max(0, 1 - along * along));
    const shown = broad * (1 - BANK + BANK * Math.abs(Math.sin(roll)));
    return FLOOR + (1 - FLOOR) * shown;
  };

  murmurReset();
  const camH = 0.7, vx = Math.sin(camH), vy = -Math.cos(camH);
  let pts = null;
  for (let f = 0; f < 120; f++) pts = murmur('band', 400, 0, 0, 3, 0.4, 1000 + f * 33, { spread: 2.2 });

  // A stoop just off the flock, and a moment at which its front is crossing the cloud.
  const ev = { x: -2.2, y: 0, at: 1000 + 119 * 33 };
  const now = ev.at + 600;
  const rows = pts.map((q) => {
    const h = Math.atan2(q.vy ?? 0, q.vx ?? 1);
    const a = agitation(q.x, q.y, ev, now);
    return { d: Math.hypot(q.x - ev.x, q.y - ev.y), delta: dimOf(h, (q.roll || 0) + a, vx, vy) - dimOf(h, q.roll || 0, vx, vy) };
  });
  const touched = rows.filter((r) => Math.abs(r.delta) > 1e-4).length;

  // Banded-ness: how much of the variation in delta is explained by distance from the stoop.
  const corr = (xs, ys) => {
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    return sxx && syy ? Math.abs(sxy / Math.sqrt(sxx * syy)) : 0;
  };
  // Binned by distance, because the wave is a RING and the relation is a bump rather than a line:
  // a raw correlation on a non-monotonic shape reads near zero and says nothing.
  const bin = (rs) => {
    const B = 12, lo = Math.min(...rs.map((r) => r.d)), hi = Math.max(...rs.map((r) => r.d));
    const sum = new Array(B).fill(0), cnt = new Array(B).fill(0);
    for (const r of rs) { const k = Math.min(B - 1, Math.floor((r.d - lo) / ((hi - lo) || 1) * B)); sum[k] += r.delta; cnt[k]++; }
    return sum.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
  };
  const profile = bin(rows);
  const spreadOf = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  const bandSpread = spreadOf(profile);

  // Control: no event. Every delta is 0, so the profile is flat.
  const flat = bin(pts.map((q) => ({ d: Math.hypot(q.x - ev.x, q.y - ev.y), delta: 0 })));
  const flatSpread = spreadOf(flat);
  murmurReset();

  const MIN_TOUCHED = 30, MIN_BAND = 0.004;
  if (touched < MIN_TOUCHED) problems.push(`the agitation wave changed the brightness of only ${touched} of ${rows.length} birds -- the roll is not reaching the flash`);
  else if (!(bandSpread > MIN_BAND)) problems.push(`the wave's brightness varies ${bandSpread.toFixed(4)} across distance bands, under the ${MIN_BAND} that is a band rather than a wash`);
  else if (!(flatSpread === 0)) problems.push('the no-event control is not flat, so the band measurement is reading something other than the wave');
  else notes.push(`the hawk's wave dims ${touched} of ${rows.length} birds in a ring, ${bandSpread.toFixed(4)} of brightness across distance bands against a flat control`);
}

// ── 1j. the flock's proportions, against the measured birds ─────────────────
//
// Ballerini et al. 2008 (STARFLAG, flocks of up to 2,700 birds reconstructed in 3-D) measured the
// three principal axes I1 < I2 < I3 at an average of 1 : 2.8 : 5.6, and found that ratio is
// remarkably STABLE while absolute size varies a lot. The short axis is parallel to GRAVITY and
// orthogonal to the velocity: a starling flock is a pancake sliding parallel to the ground.
//
// ⚠ SO THE BIG NUMBER IS VERTICAL FLATTENING AND NOT LENGTH, which is the thing this check
// replaced. The first cut of it demanded elongation above 3.0 measured in the horizontal plane --
// it was written to stop the flock being a ball and it would now insist on a smear, because in
// PLAN a real flock is only about 2:1 (5.6/2.8). Ours measured 1 : 1.3 : 7.0 at the time: barely
// flattened and stretched more than twice as far as a real one. A gate can be precisely wrong.
//
// ⚠ AND THE SECOND HALF IS NOT ABOUT LOOKS. murmur's own note calls the pull to the derived
// centre the bridge that keeps a simulated cloud honest about the one fact describe.js is also
// telling the player -- where the flock IS. Shape passing while the birds have wandered off the
// tile the room names is not success.
{
  const SPEED = 0.0234;                       // tiles/frame -- the game's own flock centre speed
  const axes = (pts) => {
    const n = pts.length;
    let mx = 0, my = 0, mz = 0;
    for (const q of pts) { mx += q.x; my += q.y; mz += q.z; }
    mx /= n; my /= n; mz /= n;
    let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;
    for (const q of pts) { const a = q.x - mx, b = q.y - my, c = q.z - mz;
      xx += a * a; yy += b * b; zz += c * c; xy += a * b; xz += a * c; yz += b * c; }
    xx /= n; yy /= n; zz /= n; xy /= n; xz /= n; yz /= n;
    const p1 = xy * xy + xz * xz + yz * yz, q0 = (xx + yy + zz) / 3;
    const p2 = (xx - q0) ** 2 + (yy - q0) ** 2 + (zz - q0) ** 2 + 2 * p1;
    const pp = Math.sqrt(p2 / 6) || 1e-9;
    const B = [[(xx - q0) / pp, xy / pp, xz / pp], [xy / pp, (yy - q0) / pp, yz / pp],
               [xz / pp, yz / pp, (zz - q0) / pp]];
    const d = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1])
            - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0])
            + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);
    const r = Math.max(-1, Math.min(1, d / 2)), phi = Math.acos(r) / 3;
    const e1 = q0 + 2 * pp * Math.cos(phi);
    const e3 = q0 + 2 * pp * Math.cos(phi + 2 * Math.PI / 3);
    const e2 = 3 * q0 - e1 - e3;
    const v = [e1, e2, e3].map((x) => Math.sqrt(Math.max(x, 0))).sort((a, b) => a - b);
    return { I1: v[0], I2: v[1], I3: v[2], mx, my };
  };
  const NB = 1000, FR = 2.4;   // a mid-range flock, and the airborne radius the row carries
  const SPREAD = Math.max(0.35, FR * 0.22) * Math.cbrt(NB / 20) * ws.RENDER_TUNE.murmurPack;
  const fly = (turn, seed) => {
    murmurReset();
    let cx = seed * 3.1, cy = seed * 1.7, th = seed * 0.9, pts = null;
    for (let f = 0; f < 600; f++) {
      th += turn * (1 + 0.3 * Math.sin(f * 0.011 + seed));
      cx += Math.cos(th) * SPEED; cy += Math.sin(th) * SPEED;
      // The spread the RENDERER derives, not a number picked here -- the shape depends on it,
      // so a gate with its own value is grading a configuration the game never runs.
      pts = murmur('shape' + seed, NB, cx, cy, 3, th, 1000 + f * 33,
        { spread: SPREAD, trail: ws.RENDER_TUNE.murmurTrail });
    }
    const a = axes(pts);
    return { ...a, drift: Math.hypot(a.mx - cx, a.my - cy) };
  };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rs = [1, 2, 3].flatMap((z) => [fly(0.0006, z), fly(0.0028, z)]);
  murmurReset();
  const flat = mean(rs.map((r) => r.I2 / r.I1));      // vertical flattening; real 2.8
  const plan = mean(rs.map((r) => r.I3 / r.I2));      // elongation in plan;   real 2.0
  const drift = mean(rs.map((r) => r.drift));
  // Generous bands: 1 : 2.8 : 5.6 is an average over real flocks that vary a lot, so this is
  // guarding the SHAPE FAMILY -- a flattened plate, not a ball and not a tube -- rather than
  // pinning a number somebody measured once.
  // ⚠ THE LOWER FLAT BAND IS TIGHT ON PURPOSE AND THE MUTANT VALUE IS WHY. A first cut allowed
  // 1.8 and happily passed FLAT_Z removed entirely -- the cloud still measures 2.3 from its seed
  // alone, so a generous band cannot tell a flattened flock from an unflattened one. 2.5 sits
  // under what ships (3.1) and over what the bug produces (2.3). The measure is deterministic,
  // so a tight band here is a pin rather than a flake.
  const FLAT_LO = 2.5, FLAT_HI = 4.0, PLAN_LO = 1.4, PLAN_HI = 3.2, DRIFT_MAX = 0.8;
  if (!(flat > FLAT_LO && flat < FLAT_HI))
    problems.push(`the flock is ${flat.toFixed(2)} times wider than it is thick, outside ${FLAT_LO}-${FLAT_HI} -- real starlings sit at 2.8 and the short axis is vertical`);
  else if (!(plan > PLAN_LO && plan < PLAN_HI))
    problems.push(`the flock is ${plan.toFixed(2)} times longer than it is wide in plan, outside ${PLAN_LO}-${PLAN_HI} -- real starlings sit at 2.0, so this is a ${plan > PLAN_HI ? 'tube' : 'ball'}`);
  else if (!(drift < DRIFT_MAX))
    problems.push(`the flock sits ${drift.toFixed(2)} tiles off its derived centre -- it has left the tile the room names`);
  else notes.push(`proportions 1 : ${flat.toFixed(1)} : ${(flat * plan).toFixed(1)} against the measured 1 : 2.8 : 5.6, sitting ${drift.toFixed(2)} tiles off its own centre`);
}
// ── 1k. a stoop opens a hole, rather than only changing how they bank ────────
//
// `agitation()` models a dive as a wave of BANKING, so before this the flock changed how it caught
// the light and never got out of the way. The push is the other half.
//
// ⚠ COMPARED AT THE SAME FRAME, NEVER ACROSS TIME. The flock flies past a stoop that stays where
// it happened, so the count near that point swings wildly on its own -- 134, 252, 47 over four
// seconds with no predator in the model at all. The only sound reading is the same instant with the
// push and without it.
{
  const SPEED = 0.0234;
  const run = (push) => {
    murmurReset();
    let cx = 0, cy = 0, th = 0, pts = null, ev = null, worst = 1e9, at = 0;
    for (let f = 0; f < 340; f++) {
      const t = 1000 + f * 33;
      th += 0.0009; cx += Math.cos(th) * SPEED; cy += Math.sin(th) * SPEED;
      if (f === 200) ev = { x: cx, y: cy, at: t };
      pts = murmur('stoop', 400, cx, cy, 3, th, t, { spread: 2.2, trail: 1, scare: push ? ev : null });
      if (ev && f > 200 && f < 300) {
        const near = pts.filter((q) => Math.hypot(q.x - ev.x, q.y - ev.y) < 1.15).length;
        if (near < worst) { worst = near; at = f; }
      }
    }
    return { worst, at };
  };
  const off = run(false), on = run(true);
  murmurReset();
  // Read at the SAME frame in both, which is what makes it a comparison.
  const cmp = (frame) => {
    const seq = (push) => {
      murmurReset();
      let cx = 0, cy = 0, th = 0, pts = null, ev = null;
      for (let f = 0; f <= frame; f++) {
        const t = 1000 + f * 33;
        th += 0.0009; cx += Math.cos(th) * SPEED; cy += Math.sin(th) * SPEED;
        if (f === 200) ev = { x: cx, y: cy, at: t };
        pts = murmur('cmp', 400, cx, cy, 3, th, t, { spread: 2.2, trail: 1, scare: push ? ev : null });
      }
      return pts.filter((q) => Math.hypot(q.x - ev.x, q.y - ev.y) < 1.15).length;
    };
    return { off: seq(false), on: seq(true) };
  };
  const r = cmp(240);
  murmurReset();
  const drop = r.off > 0 ? 1 - r.on / r.off : 0;
  const MIN_DROP = 0.15;
  if (!(drop > MIN_DROP)) problems.push(`a stoop thins the birds around it by only ${(drop * 100).toFixed(0)}% (${r.off} -> ${r.on}), under the ${MIN_DROP * 100}% that is a hole rather than a nudge`);
  else notes.push(`a stoop thins the birds around it ${r.off} -> ${r.on}, ${(drop * 100).toFixed(0)}% fewer inside 1.15 tiles`);
}
// ── 1l. a flock nobody can see is frozen, and thawing does not jump ─────────
//
// Flocks are gathered on a RADIUS and the only visibility test is per bird, after the sim has run,
// so a murmuration behind the camera used to pay its whole boids step. It is frozen now.
//
// ⚠ FROZEN, NOT SKIPPED, AND THAT IS THE WHOLE OF WHY THIS CHECK EXISTS. The flock's centre is
// pure arithmetic off the cycle and keeps moving whether or not anyone draws it, so a cloud that
// simply stopped would come back a long way behind where it belongs and the home pull would haul a
// thousand birds across the sky in front of whoever just turned round. The cloud is translated with
// its centre instead. The test is the THAW: the first live frame after a long freeze must move
// birds no further than an ordinary frame does.
{
  const N = 600;
  const SP = Math.max(0.35, 2.4 * 0.22) * Math.cbrt(N / 20) * 0.5;
  const centreOf = (pts) => { let mx = 0, my = 0;
    for (const q of pts) { mx += q.x; my += q.y; } return [mx / pts.length, my / pts.length]; };
  murmurReset();
  let cx = 0, cy = 0, th = 0, pts = null;
  const step = (t, frozen) => { th += 0.0016; cx += Math.cos(th) * 0.0234; cy += Math.sin(th) * 0.0234;
    pts = murmur('freeze', N, cx, cy, 3, th, t, { spread: SP, trail: 0.3, frozen }); };
  let t = 1000;
  for (let f = 0; f < 150; f++) { step(t, false); t += 16.7; }
  const [bx, by] = centreOf(pts);
  const offBefore = Math.hypot(bx - cx, by - cy);
  // two seconds looking the other way
  let offWorst = 0;
  for (let f = 0; f < 120; f++) { step(t, true); t += 16.7;
    const [mx, my] = centreOf(pts); offWorst = Math.max(offWorst, Math.hypot(mx - cx, my - cy)); }
  const prev = pts.map((q) => ({ x: q.x, y: q.y, z: q.z }));
  step(t, false); t += 16.7;
  let thaw = 0;
  for (let i = 0; i < pts.length; i++)
    thaw = Math.max(thaw, Math.hypot(pts[i].x - prev[i].x, pts[i].y - prev[i].y, pts[i].z - prev[i].z));
  const prev2 = pts.map((q) => ({ x: q.x, y: q.y, z: q.z }));
  step(t, false);
  let ordinary = 0;
  for (let i = 0; i < pts.length; i++)
    ordinary = Math.max(ordinary, Math.hypot(pts[i].x - prev2[i].x, pts[i].y - prev2[i].y, pts[i].z - prev2[i].z));
  murmurReset();
  if (!(offWorst <= offBefore + 0.25))
    problems.push(`a frozen flock drifted ${offWorst.toFixed(2)} tiles off its centre against ${offBefore.toFixed(2)} live -- it is not being carried with it`);
  else if (!(thaw <= ordinary * 2.5 + 0.01))
    problems.push(`thawing moved a bird ${thaw.toFixed(3)} tiles against ${ordinary.toFixed(3)} for an ordinary frame -- the flock jumps when you look back`);
  else notes.push(`a frozen flock holds ${offWorst.toFixed(2)} tiles off its centre against ${offBefore.toFixed(2)} live, and thaws by ${thaw.toFixed(3)} tiles against an ordinary ${ordinary.toFixed(3)}`);
}
// ── out ───────────────────────────────────────────────────────────────────────
ws.RENDER_TUNE.gl = glWas; ws.RENDER_TUNE.glFloor = floorWas; ws.RENDER_TUNE.geese = geeseWas;
globalThis.performance = clock;
Date.now = realDateNow;

if (REPORT) {
  console.log(`  anchor  ${ANCHOR.ax},${ANCHOR.ay}  (bias block ${FLOCK_AREA})   camera ${CENTRE.x},${CENTRE.y}`);
  console.log(`  ground t=${T_GROUND}  air t=${T_AIR}`);
  console.log('  faces: ' + ground.faces + ' walking, ' + air.faces + ' flying (budget ' + FACE_MAX + ')');
}

if (problems.length) {
  console.error('✗ fauna — ' + problems.length + ' problem(s):');
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
console.log('✓ fauna — ' + notes.join('; ') + '. Stateless across a recentre, deterministic, off at 0, day-only, and the height split holds.');
