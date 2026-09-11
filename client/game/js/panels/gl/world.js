// GLASS 2, STAGE ONE: THE MASS, ON THE GPU.
//
// The city's solid geometry drawn in WebGL2 into a buffer the 2-D frame BLITS, with everything else
// — lights, signage, ground, weather, contacts, the HUD — still painted over it exactly as it is
// today. That split is not a compromise reached for want of time; it is the shape the port takes,
// and it works because the seam already existed: `MASS_OFF` has always let an arm run with its mass
// suppressed and its lights intact, which is how distance LOD draws a far building's neon without
// its walls. See sceneGL for why it is a blit and not a second element on the page.
//
// ⚠ IT IS OFF BY DEFAULT AND OFF IS BYTE-IDENTICAL. `RENDER_TUNE.gl` at 0 means this module is never
// called, no canvas is created, no context is asked for. The renderer that ships is the renderer
// that shipped, and the only way to see any of this is to turn it on.
//
// ⚠ AND THE MESH IS CACHED ON THE WINDOW, NOT REBUILT PER FRAME. A city is static geometry; the
// entire argument for a vertex buffer is that it is uploaded before the first frame rather than
// during it. The cache key is the map window's own contents, so it rebuilds when the world scrolls
// to a new tile and at no other time.
//
// ⚠ WHICH IS WORTH CHECKING RATHER THAN BELIEVING. A buffer rebuilt on every frame draws exactly
// the same picture as one uploaded once, so nothing about the frame says which is happening —
// three separate things made the key move every frame before `builds` existed to say so: an
// order-sensitive key, a mesh built at the camera-relative position, and a set taken from what
// survived the camera culls. `glLastFrame().builds` is the number, and over a turning camera it
// should be 1.
import { createGLView, MAX_LIGHTS } from './context.js';
import { buildAtlas, faceUVs } from './atlas.js';

const scenes = new Map();
// How many times the vertex buffer has been rebuilt since the page loaded. The whole argument for
// GL here is that a city is uploaded once and drawn many times, and there is no way to see from
// outside whether that is what is happening — a buffer rebuilt every frame draws exactly the same
// picture as one rebuilt once. So the pass counts, and `glLastFrame().builds` is the number.
let builds = 0;

// ── THE CITY LIGHTS ITS OWN WALLS ───────────────────────────────────────────
//
// The mass shader takes point lights, and the list to give it already exists: `SPRITE_SINK` is
// every light in the frame, collected by the arms that own them, as a world point + a colour +
// an alpha. Up to now that list only ever drew DISCS. Handing the same entries to the wall
// shader costs no new authoring, no new content and no second idea of where a light is.
//
// ⚠ HOW FAR A LIGHT REACHES COMES FROM HOW BRIGHT IT IS, NOT FROM HOW BIG ITS BLOOM IS DRAWN,
// and the first cut had that backwards. A sprite carries a radius in SCREEN pixels, so converting
// it back through the projection looks like the obvious answer — and it is an answer to the wrong
// question. That radius is `clamp(k / f, lo, hi)`: a clamped screen size, chosen so a halo looks
// right on a canvas, carrying almost nothing about how much light the source puts out. Measured,
// it resolved every sign in the city to about half a tile of reach and the whole feature moved
// ZERO pixels on a building lit by two neon signs — a wash the size of the mounting bracket.
// Brightness is the quantity that decides reach, it needs no camera at all, and it cannot go wrong
// at a device pixel ratio the way the projection round-trip can.
//
// ⚠ THE SELECTION IS A SCREEN QUESTION AND THE REACH IS NOT, and they are scored separately for
// that reason. Twelve slots against a hundred and twenty lights in a dense frame, so what has to
// be ranked is how much of the PICTURE each wash covers — `reach / distance`, weighted by how
// bright it is. A light that reaches three tiles from forty tiles away covers nothing.
//
// ⚠ AND THE RANK MUST NOT MOVE WITH A LIGHT OWN ALPHA, WHICH IS THE BUG THIS SHIPPED WITH.
// `blinkLight` pulses its alpha by design and window blooms come and go, so scoring on alpha made
// a beacon rise and fall through the cut line in time with its own blink — and because the list is
// twelve of a hundred and twenty, one eviction reshuffles the whole set and every wall in frame
// changes brightness at once. Reported as a disco: the scene getting brighter and darker quickly,
// with nothing in the world doing anything of the kind. Rank is taken from the light COLOUR and
// its distance, both of which hold still; alpha stays where it belongs, on how bright the wash is,
// so a blinking sign pulses its own wall and nobody else moves.
//
// ⚠ AND THE SET IS STICKY, because ranking on steady numbers is not enough on its own: two lights
// a hair apart either side of the cut swap places as the camera creeps, which is the same
// reshuffle arriving more slowly. An incumbent has to be BEATEN, not merely matched — a challenger
// carries the slot only at a clear margin, so the set changes when the view genuinely changes.
//
// ⚠ AND THE POSITIONS ARE IN THE WRONG FRAME BY DEFAULT. The mass is built at MAP-WINDOW tiles
// so the buffer can be cached, and the camera is shifted by `ox/oy` to compensate; a sprite is
// collected fresh each frame in camera-relative tiles and takes the plain camera. Those are the
// two frames `drawSprites` is deliberately given the unshifted camera for, so a light crossing
// into the shader has to be moved into the mesh own frame: `p_window = p_camera + (ox, oy)`.
// A missed shift is a sub-tile error that reads as the wash sitting beside its sign.

// ⚠ FOUR LOOK NUMBERS, EXPORTED SO THEY CAN BE SWEPT RATHER THAN ARGUED ABOUT. `__glLights()` in
// the Modelshop walks them and reports what share of the wall pixels each setting actually moves,
// which is how the first three got their values — the defaults below are the row that was chosen,
// not a starting guess that nobody went back to.
//
//   minR  — what the faintest light still reaches, in tiles
//   span  — how much further the brightest one reaches, over root brightness (root, because the
//           interesting range is the dim half: linear puts every ordinary sign at the bottom)
//   gain  — how bright the wash is, against a base in 0..1
//   wrap  — how far round the light reaches; 0 is exactly lambert. See the ⚠ in context.js: a
//           sign is mounted FLUSH on its wall, so a pure cosine is ~0 for the commonest case.
export const LIGHT_TUNE = { minR: 0.8, span: 3.2, gain: 1.5, wrap: 0.6, rise: 0.22, fall: 0.38 };

// ── CONTACT OCCLUSION, AS TWO NUMBERS ───────────────────────────────────────
//
// `fall` is how fast the ground lets go of a surface, in inverse tiles: the term is
// exp(-z * fall), so 1/fall is the height at which a third of it is left. 1.6 puts the
// visible band in the bottom ~1.5 tiles, which is a shopfront entire and the plinth of a
// tower — the two places a contact shadow belongs.
//
// ⚠ THE STRENGTH IS NOT HERE. It is `RENDER_TUNE.glAO`, because it is the knob somebody
// drags in the flight-sim panel and it doubles as the off switch — 0 makes the shader
// multiply by exactly 1.0 and the frame is what shipped.
export const AO_TUNE = { fall: 1.6 };

// ⚠ AND IT IS SCALED BY THE NIGHT, WHICH IS NOT THE SAME AS BEING LEFT TO THE SPRITE ALPHAS.
// GLASS goes on drawing signage by day, dimmed — so without this the wash goes on landing too, and
// a shopfront measured a pink cast over 19,000 pixels of its own wall AT NOON, mean 8/255. A sign
// does not visibly light a sunlit wall, so `night` (1 at midnight, 0.5 at dusk, 0 by day, the same
// scalar every arm shades against) multiplies the gain and the whole term is exactly zero at midday
// rather than merely small.
// How much better a challenger has to be to take a sitting light own slot. See the ⚠ above: this
// is the difference between a set that changes when the view does and one that changes every frame.
const LIGHT_HOLD = 1.35;

// ── ⚠ A LIGHT FADES IN AND OUT. IT MUST NEVER BE SWITCHED. ──────────────────
//
// There are twelve uniform slots and a night city has far more than twelve lights near you, so the
// chosen set churns constantly as you move — that is the budget working, and `LIGHT_HOLD` only
// decides WHICH twelve, not what happens at the moment one is swapped. Without a ramp a light's
// entire wall wash appears or vanishes between two consecutive frames.
//
// Measured flying a lit street: the pixels the light pass visibly changes ran
// 3642 → 2812 → 3640 → 4852 → 3158 → 2218, with a **1,654-pixel step in a single frame** — 1.7% of
// the frame lighting up or going out at once, repeatedly, which is what reads as a strobe on the
// buildings you are passing. It is worst exactly where it is most visible: near, dense and at night.
//
// So a slot carries a WEIGHT that ramps, and a light on its way out keeps its slot while it fades.
// Because the final sort is on `score * weight`, a fading light gives its slot up on its own as the
// weight decays — no separate eviction rule, and no starving the wanted set.
//
// ⚠ THE RAMP IS IN SECONDS, NOT FRAMES. A per-frame step makes the fade take four times as long on
// a 240 Hz monitor as on a 60 Hz one, and this renderer already sheds frames deliberately under
// load — so the one moment the fade most needs to be smooth is the moment a frame-counted one would
// be slowest. `dt` is clamped because a tab that was in the background hands back a huge delta, and
// an unclamped ramp would snap every light to its target on the first frame back — the pop this
// exists to remove, arriving exactly when somebody alt-tabs in.
// In LIGHT_TUNE rather than as constants so the fade has an off switch: setting both to 0 restores
// the instant swap exactly, which is what the A/B that justified this measures against.
const LIGHT_DT_MAX = 0.1;  // clamp on one frame's delta
// How many of the twelve slots an outgoing light may borrow while it fades. Three, because that is
// about as many as turn over at once when flying a lit street, and because each one costs the frame
// its twelfth-brightest light for a third of a second — a trade worth making to stop a wash
// vanishing between two frames, and not worth making many times over.
const FADE_SLOTS = 3;

function pickLights(cam, sprites, night, held) {
  if (!sprites || !sprites.length || !cam) return null;
  const nightGain = LIGHT_TUNE.gain * Math.min(1, Math.max(0, night));
  if (!(nightGain > 0.01)) return null;
  const { sinh, cosh, back, fx = 0, fy = 0 } = cam;
  const tx = back * sinh - fx, ty = -back * cosh - fy;
  const ox = cam.ox || 0, oy = cam.oy || 0;
  const out = [];
  for (const s of sprites) {
    if (!(s.a > 0.02)) continue;
    const bx = s.x + tx, by = s.y + ty;
    const f = bx * sinh - by * cosh;
    if (!(f > 0.2)) continue;             // behind the eye, or on it
    const c = s.rgb || [255, 255, 255];
    // The light own colour, weighted the way an eye weights it. NO ALPHA — see the ⚠ above.
    const I = Math.min(1, (c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1) / 255);
    const r = LIGHT_TUNE.minR + LIGHT_TUNE.span * Math.sqrt(I);
    const k = s.a * nightGain;
    // A stable name for this light, so last frame own choices can be recognised in this one. The
    // sprite objects are rebuilt every frame and share no identity, so the POSITION is the identity
    // — quantised, or a light drifting a thousandth of a tile is a different light every frame.
    const key = ((s.x * 8) | 0) * 1048576 + ((s.y * 8) | 0) * 1024 + ((s.z * 8) | 0);
    out.push({
      p: [s.x + ox, s.y + oy, s.z],
      rgb: [c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k],
      r,
      key,
      score: I * r / f,
    });
  }
  if (!out.length) return null;
  // Incumbents carry a bonus, so a challenger has to be clearly better rather than a hair better.
  if (held) for (const e of out) if (held.has(e.key)) e.score *= LIGHT_HOLD;
  out.sort((p, q) => q.score - p.score);
  return out;
}

// Ramp each light's contribution toward its target and hand back the slots, weight applied. See the
// ⚠ on LIGHT_RISE. `state` is the scene's own map, so two views painting two cities keep their own.
export function fadeLights(ranked, state, dt) {
  // ⚠ THE SET IS CHOSEN ON SCORE ALONE, AND THE WEIGHT ONLY DECIDES BRIGHTNESS. Ranking the slots
  // on `score * weight` is the obvious build and it is wrong: a light that has just been elected
  // starts at weight 0, so it sorts BELOW the one it just beat, and the two trade the slot back and
  // forth while neither gets bright. Measured, a short fade that way came out WORSE than no fade at
  // all — worst step 367 against 311 — which is the tell that the fade had started driving the
  // churn it exists to smooth. The wanted set is now exactly the set HEAD would have picked;
  // fading-out lights take whatever slots are left over, and the ramp is only ever a multiplier.
  const rise = LIGHT_TUNE.rise > 0 ? dt / LIGHT_TUNE.rise : 1;
  const fall = LIGHT_TUNE.fall > 0 ? dt / LIGHT_TUNE.fall : 1;
  // ⚠ A FADING LIGHT NEEDS A SLOT, AND THE WANTED SET HAS TO GIVE ONE UP. There are exactly
  // MAX_LIGHTS uniform slots; if the top MAX_LIGHTS by score take all of them there is nowhere for
  // an outgoing light to fade, and eviction stays instant — which is half the pop still shipping.
  // The first cut appended fading lights "into whatever slots remain" and in a dense city there are
  // never any, so the fade only ever worked on the way IN. The gate caught it; the frame did not.
  //
  // So the wanted set is trimmed by however many lights are actually on their way out, up to
  // FADE_SLOTS. The light that gets bumped is the LOWEST-SCORING of the twelve, which is the one
  // covering least of the picture — and it then joins the outgoing set and fades on the next frame
  // rather than snapping off, so the cascade decays instead of ringing.
  const ideal = ranked.slice(0, MAX_LIGHTS);
  const idealKeys = new Set(ideal.map((e) => e.key));
  const fading = ranked.filter((e) => !idealKeys.has(e.key) && (state.get(e.key) ?? 0) > 0);
  const reserve = Math.min(fading.length, FADE_SLOTS);
  const wanted = ideal.slice(0, Math.max(1, MAX_LIGHTS - reserve));
  const inSet = new Set(wanted.map((e) => e.key));
  const live = [];
  for (const e of wanted) {
    const w = Math.min(1, (state.get(e.key) ?? 0) + rise);
    state.set(e.key, w);
    if (w > 0) live.push({ e, w });
  }
  for (const e of ranked) {
    if (inSet.has(e.key)) continue;
    const w0 = state.get(e.key);
    if (w0 === undefined) continue;
    const w = w0 - fall;
    if (w <= 0) { state.delete(e.key); continue; }
    state.set(e.key, w);
    if (live.length < MAX_LIGHTS) live.push({ e, w });
  }
  // ⚠ A LIGHT THAT LEFT THE FRAME ENTIRELY IS NOT IN `ranked` AT ALL, so it never reaches the loop
  // above and would keep its stale weight for ever — and snap back to it the moment it returned.
  // Anything not seen this frame is decayed here and dropped when it reaches zero.
  const seen = new Set(ranked.map((e) => e.key));
  for (const [k, w0] of [...state]) {
    if (seen.has(k)) continue;                 // handled above, in one of the two loops
    const w = w0 - fall;
    if (w <= 0) state.delete(k); else state.set(k, w);
  }
  if (!live.length) return null;
  return live.map(({ e, w }) => ({ ...e, rgb: [e.rgb[0] * w, e.rgb[1] * w, e.rgb[2] * w] }));
}

function sceneGL(id, w, h) {
  let g = scenes.get(id);
  if (!g) { g = { canvas: null, view: null, key: '', atlasKey: '', epoch: '', atlas: null }; scenes.set(id, g); }
  // ⚠ THE GL CANVAS IS A BUFFER, NOT AN ELEMENT ON THE PAGE. Stacking it under the 2-D one is the
  // obvious arrangement and it cannot work: the 2-D pass paints the sky and the ground, opaquely,
  // over the whole frame — so a GL city underneath is drawn perfectly and covered completely, and
  // the only way to notice is to look, which the face counters do not. Put it on TOP instead and
  // the mass covers every light, sign and marquee, which are painted before it and belong in front
  // of it. Neither order is the painter's order. So it never joins the document at all: the pass
  // draws into it and the caller blits it onto the 2-D canvas at exactly the point in the frame
  // where the mass used to be queued — after the ground, before the lights.
  if (!g.canvas) {
    const cv = document.createElement('canvas');
    cv.className = 'ws-gl';
    g.canvas = cv;
  }
  if (g.canvas.width !== w || g.canvas.height !== h) {
    g.canvas.width = w; g.canvas.height = h;
    g.view = null;                    // a resized canvas loses its context state; rebuild it
    g.key = '';
  }
  if (!g.view) { g.view = createGLView(g.canvas); g.atlasKey = ''; g.key = ''; }
  return g;
}

// What the buildings in this window are, as a string. Cheap to build and exact: if two frames agree
// on it they are looking at the same city and the same buffer is correct.
//
// ⚠ IT IS SORTED, AND THAT IS NOT TIDINESS. The cells arrive in the order the painter queued them,
// which is far-to-near — so the same city seen from a heading nine degrees round arrives as the
// same set in a different order, and an order-sensitive key calls it a different city. That is a
// full mesh rebuild on every frame of every turn, which is the whole cost the buffer exists to
// avoid, and it is invisible: the picture is correct throughout.
function windowKey(cells) {
  // ⚠ bt/bn decide WHICH model this is and meshParams decides what that model was BUILT AS.
  // Both halves are needed: the first cannot see a reseeded variant, the second cannot see a
  // different building that happens to share a footprint and a height.
  const parts = cells.map((it) => it.gx + ',' + it.gy + ':' + (it.c.bt || '') + ':' + (it.c.bn || '') + ':' + meshParams(it));
  parts.sort();
  return parts.join(';');
}

// ── WHAT A BUILDING IS, CACHED ON THE BUILDING ──────────────────────────────
//
// `captureModelMesh` RUNS THE MODEL'S OWN ARM to record its faces. That is precisely the work a
// vertex buffer exists to stop doing, so doing it inside the rebuild made the rebuild the most
// expensive thing in the frame — and the rebuild is not rare, because the set of buildings in the
// window changes every time the frustum cull or the occluder pass changes its mind, which is on
// every turn of the wheel. Cached here instead, a rebuild is a walk over faces that already exist.
//
// The key is everything the capture depends on and nothing else: the model, the footprint, the
// storey height, the seed and the entrance. The camera is deliberately absent — a capture that
// varied with where you stood would not be geometry.
//
// ⚠ KEYED ON THE MODEL OBJECT'S IDENTITY, the same rule `shapeForModel` follows: the Modelshop
// makes a NEW record for every edit rather than patching one, so a WeakMap sees the edit and a
// name-keyed cache would serve the pre-edit shape for ever.
const meshCache = new WeakMap();
// EVERYTHING A TILE’S MESH IS BUILT FROM, AS ONE STRING. Two things need to agree about this and
// they used to say it separately: the per-tile mesh cache below, and `windowKey`, which decides
// whether the whole vertex buffer is stale. The buffer’s half named the tile, its type, its name
// and its floors; the mesh is built from the FOOTPRINT, the HEIGHT, the SEED and the ENTRANCE.
// ⚠ Seed is the one that bites. Twenty-three of the 173 models are seed-variant — they build
// DIFFERENT GEOMETRY for a different seed — and seed also feeds `fh` and `floorHeight`. So a tile
// whose seed changed while its type, name and floor count did not left the GPU holding the old
// building: no rebuild, because nothing in the key had moved. It then popped to the new shape at
// whatever unrelated moment next changed the key, which reads as a building that changes size at
// random while you fly. `shapeForModel(m, seed)` is also where the ground shadow’s hull comes
// from, so the same staleness shows up as a shadow that changes with it.
// ── AND A WAY TO CATCH IT IN THE ACTUAL GAME ────────────────────────────────
//
// A building that changes size while you fly past it is invisible to every gate in this repo:
// each of them renders a scene somebody wrote down, and the scenes somebody writes down are
// never the one that breaks. Three synthetic cities in a row gave a confident wrong answer
// about this pass before anybody thought to record a real flight.
//
// __glChurnStart() in the console, fly for a while, then __glChurn(). It answers the only
// question that matters here: did any building in view change what its mesh is BUILT FROM —
// its footprint, its storey height, its seed or its facing — while you were watching it. A
// building should report one set of parameters for its whole life; two means the geometry was
// rebuilt as something else, and the value it prints says which of the four moved.
//
// ⚠ IT KEYS ON THE BUILDING’S NAME, which is exact in Coldwater (408 of the 416 building tiles
// carry one and they do not repeat) and WRONG in a synthetic city that puts the same model on
// forty tiles — there each tile has its own seed, so one name honestly reports forty builds. If
// you are reading this against a generated map rather than the world, that is what the number is.
//
// ⚠ Off by default and it costs nothing when off: the recording walk is behind a null check,
// and nothing allocates until somebody asks.
let CHURN = null;
if (typeof window !== 'undefined') {
  window.__glChurnStart = () => { CHURN = new Map(); return String.fromCharCode(114) + "ecording — fly for a bit, then call __glChurn()"; };
  window.__glChurn = () => {
    if (!CHURN) return "not recording — call __glChurnStart() first";
    const rows = [];
    for (const [name, set] of CHURN) if (set.size > 1) rows.push({ building: name, builtAs: set.size, saw: [...set] });
    rows.sort((a, b) => b.builtAs - a.builtAs);
    const seen = CHURN.size; CHURN = null;
    const note = "each row is one building that was built more than one way; in the real world a"
      + " name is one tile, so anything above 1 is the bug. On a generated map repeats are normal.";
    return rows.length ? { changed: rows.length, of: seen, note, rows }
      : { changed: 0, of: seen, note: "no building changed its footprint, height, seed or facing" };
  };
}
const meshParams = (it) => it.fh + ':' + it.h + ':' + it.seed + ':' + it.E[0] + ',' + it.E[1];

function tileMesh(deps, it) {
  let byParam = meshCache.get(it.m);
  if (!byParam) { byParam = new Map(); meshCache.set(it.m, byParam); }
  const k = meshParams(it);
  let faces = byParam.get(k);
  if (!faces) {
    let mesh;
    try { mesh = deps.captureModelMesh(it.m, { fh: it.fh, h: it.h, seed: it.seed, E: it.E }); } catch { mesh = []; }
    faces = mesh.map((f) => ({
      ...f,
      rgb: f.rgbOverride || deps.palette.get(f.pal) || [120, 126, 134],
      uv: faceUVs(f),
      texKey: f.pal ? (f.kind === 'roof' ? 'r:' : 'w:') + f.pal : null,
    }));
    byParam.set(k, faces);
  }
  return faces;
}

// `cells` is [{ gx, gy, c, m, fh, h, seed, E }] — what drawWorldObjects already resolved for each
// building tile, handed over rather than recomputed, so the two renderers cannot disagree about
// which building stands where. `gx`/`gy` are the tile's place in the MAP WINDOW, which holds still
// while you drive across it; where the camera is standing inside that tile is a camera fact and is
// applied below.
// ── THE CLOUD DECK, AS A SECOND PASS OVER THE SAME BUFFER ──────────────────
//
// Called AFTER glWorldPass on the same frame and the same scene, from the point in the 2-D queue
// where the deck has always drawn — which is after the world blit, which is why it cannot ride the
// first pass. The trick that makes it cheap is in context.drawCloudDeck: the colour is cleared and
// the depth is not, so the cards test against the city already in the buffer.
//
// ⚠ IT RETURNS null RATHER THAN THROWING when there is no scene to draw into. This runs after the
// world pass has already decided whether GLASS 2 is alive this frame; a missing scene here means
// the world pass answered nothing, and the caller has already put the flag back and painted the
// city in 2-D. Falling over a second time would only replace one fallback with a worse one.
export function glCloudPass(id, cam, cards, opts = {}) {
  const g = scenes.get(id);
  if (!g || !g.view || !g.canvas || !cards || !cards.length) return null;
  if (g.view.lost && g.view.lost()) return null;
  const dpr = cam && cam.W ? g.canvas.width / cam.W : 1;
  const cssH = opts.cssH || (dpr > 0 ? g.canvas.height / dpr : g.canvas.height);
  // ⚠ THE PLAIN CAMERA, NOT THE SHIFTED ONE. A card is collected fresh every frame in the
  // camera-relative tiles the deck works in, the way a light is — only the cached mesh lives in
  // the map window frame. Same ⚠ as the sprites, one pass later.
  const n = g.view.drawCloudDeck(cam, cards, cssH, opts);
  return n ? { cards: n, canvas: g.canvas } : null;
}

export function glWorldPass(id, host, cells, cam, deps, opts = {}) {
  const W = host.width, H = host.height;
  // ⚠ THE CANVAS IS IN DEVICE PIXELS AND THE CAMERA IS IN CSS PIXELS, AND THE MATRIX NEEDS THE
  // CAMERA'S UNITS. `host.width/height` is the backing store; `cam.horizonY` and `cam.depth` come
  // from `makeCam`, which works in the CSS pixels the 2-D context is transformed into. In
  // `projMatrix` the x row is `2·FL / cam.W` — CSS over CSS, right by accident of both coming off
  // the camera — while the y row is `2·depth / H` and `1 − 2·horizonY / H`, CSS over DEVICE. So
  // the vertical axis was scaled by 1/dpr and the horizon put in the wrong place while the
  // horizontal stayed correct: the city squashed against a ground drawn from the real camera.
  // ⚠ AND IT IS EXACTLY INVISIBLE AT dpr 1, which is every synthetic canvas a test builds.
  // The VIEWPORT stays in device pixels — that mapping is resolution-independent and correct.
  const dpr = cam && cam.W ? W / cam.W : 1;
  // Handed over by the caller when it knows (the sim always does); derived only for a caller that
  // does not, where the rounding of a device-pixel canvas costs a fraction of a pixel.
  const cssH = opts.cssH || (dpr > 0 ? H / dpr : H);
  if (!W || !H) return null;
  const g = sceneGL(id, W, H);
  // No WebGL2 on this machine, or the driver took the context away. Either way the pass draws
  // nothing and must SAY so — the caller has already suppressed the 2-D mass on the strength of
  // this pass existing. The scene is dropped so a restored context rebuilds from scratch.
  if (!g.view) { scenes.delete(id); return null; }
  if (g.view.lost && g.view.lost()) { scenes.delete(id); return null; }

  const key = windowKey(cells);
  if (CHURN) for (const it of cells) {
    const n = it.c.bn || it.c.bt || '?';
    let set = CHURN.get(n); if (!set) CHURN.set(n, set = new Set());
    set.add(meshParams(it));
  }
  // The baked textures the atlas is a COPY of, as they stand this frame. Nothing about the city
  // has to change for them to: crossing a dusk step redraws every wall canvas in place.
  const epoch = deps.texEpoch ? deps.texEpoch(opts.nb || 0) : '';
  if (key !== g.key || epoch !== g.epoch) {
    // ⚠ THE PLACED MESH IS NEVER MATERIALISED. A tile is its shared face list plus where it stands,
    // handed over as a group; the offset is added on the way into the vertex data. Copying every
    // face to move it allocated an array per face and a point per vertex, per rebuild, for nothing.
    const groups = [];
    const need = new Set();
    let nFaces = 0;
    for (const it of cells) {
      const faces = tileMesh(deps, it);
      for (const f of faces) if (f.texKey) need.add(f.texKey);
      groups.push({ ox: it.gx, oy: it.gy, jit: it.jit || 0, faces });
      nFaces += faces.length;
    }
    // The atlas is rebuilt on the SET OF SURFACES, not on the set of buildings. Driving down a
    // street changes which buildings are in the window constantly and what they are MADE of almost
    // never, and repacking a texture page is the one part of this that touches the GPU.
    const akey = [...need].sort().join('|') + '@' + epoch;
    if (akey !== g.atlasKey) {
      const { wallTexMixed, roofTex } = deps;
      const tiles = [];
      for (const tk of need) {
        const roof = tk[0] === 'r';
        const canvas = roof ? roofTex(tk.slice(2), opts.night || 0) : wallTexMixed(tk.slice(2), opts.nb || 0);
        if (canvas && canvas.width) tiles.push({ key: tk, canvas });
      }
      g.atlas = buildAtlas(tiles, g.view.maxTexture || 2048);
      // A page the device cannot hold is refused rather than uploaded, and the fragment shader
      // already knows what to do without one: flat palette colours. Said once per scene, because a
      // per-frame warning about a permanent property of the machine is noise.
      if (!g.atlas && !g.warnedAtlas) { g.warnedAtlas = true; console.warn(`[glass2] the texture atlas for ${tiles.length} surfaces does not fit this device (max ${g.view.maxTexture}) — drawing flat colours`); }
      g.view.setAtlas(g.atlas ? g.atlas.canvas : null);
      g.atlasKey = akey;
    }
    // Resolved per face at fill time rather than written onto it: the face objects are SHARED between
    // every tile of that building and between scenes, and two scenes can hold two atlases.
    g.view.uploadGroups(groups, (f) => (g.atlas && f.texKey ? g.atlas.rect.get(f.texKey) : null));
    builds++;
    g.key = key;
    g.epoch = epoch;
    g.faces = nFaces;
  }

  // The sub-tile offset the mesh does not carry. `fx`/`fy` are already the "subtract this from the
  // world position" terms the chase camera uses, so the shift needs no new matrix and no new code in
  // camera.js — which matters, because that file is the one the parity gate holds still.
  const camAt = (cam.ox || cam.oy)
    ? { ...cam, fx: (cam.fx || 0) + cam.ox, fy: (cam.fy || 0) + cam.oy }
    : cam;
  // ⚠ COMPUTED FROM THE PLAIN CAMERA AND HANDED TO THE SHIFTED ONE — see pickLights.
  // Remembered on the SCENE rather than in the module, because two views can be painting two
  // different cities in one frame and each has its own twelve — and now its own fade state too.
  // ⚠ THE FRAME'S OWN CLOCK (`opts.now`), NOT A FRESH performance.now(). Sampling the clock here
  // gives a SECOND idea of what time it is inside one frame, and the two disagree in both directions
  // that matter: the pass is called twice for one frame in places, so the second call sees dt≈0 and
  // the ramp stalls; and any harness that drives `now` to step through time — which is the only way
  // to test a fade headlessly — cannot move this at all. `now` is what every animated thing in the
  // renderer already shades against, so the fade is on the same clock as everything it fades.
  if (!g.litW) g.litW = new Map();
  const tNow = (opts.now || 0) / 1000;
  const dt = Math.min(LIGHT_DT_MAX, Math.max(0, tNow - (g.litT ?? tNow)));
  g.litT = tNow;
  let lightList = null;
  if (opts.glLights !== 0) {
    const ranked = pickLights(cam, opts.sprites, opts.night || 0, g.litHeld);
    lightList = ranked ? fadeLights(ranked, g.litW, dt) : null;
    // The HELD set is what was WANTED this frame, not what is lit — an incumbent bonus given to a
    // light that is only still on screen because it is fading out would keep re-electing it.
    g.litHeld = ranked ? new Set(ranked.slice(0, MAX_LIGHTS).map((e) => e.key)) : null;
  } else { g.litHeld = null; g.litW.clear(); }
  g.view.draw(camAt, { ...(opts.draw || {}), lights: lightList, lightWrap: LIGHT_TUNE.wrap, cssH,
    ao: opts.glAO || 0, aoFall: AO_TUNE.fall });
  // ⚠ AFTER THE MASS, AND THAT IS NOT AN ORDERING PREFERENCE. `draw()` OPENS with
  // gl.clear(COLOR | DEPTH) — so a floor drawn before it is drawn and then wiped, every frame.
  // It cost an afternoon: the result looked like a floor (the backstop wash showed through the
  // cleared canvas), it was smoothly graded and uniformly dark, and it ignored a debug uniform
  // wired straight into its own fragment output, which is what finally gave it away.
  //
  // Drawing it after costs nothing, because the floor WRITES depth and TESTS it: where a building
  // is nearer the floor loses the fragment, which is the same picture the other order would have
  // given if the clear had not been in the way.
  const floor = g.view.drawFloor(opts.floor);
  // ⚠ AFTER THE FLOOR AND IN THE WINDOW FRAME. The road quads are recorded at their map-window
  // tile exactly as the mesh is, so they take the SHIFTED camera; handing them the plain one
  // would slide the kerbs a fraction of a tile off the buildings standing on them. They also
  // stand ON the floor rather than being it — see the eps ladder in windshield.js.
  const ground = g.view.drawGround(camAt, opts.ground, cssH, {
    // No haze band: the per-quad alpha already carries drawGroundSurfaces own far fade, and
    // applying the window dissolve on top would fade the road twice.
    fog: opts.fogBand,
  });
  // ⚠ THE LIGHTS ARE IN THE CAMERA'S OWN FRAME, NOT THE WINDOW'S. The mesh is built at map-window
  // tiles so it can be cached; a light is collected fresh every frame from the arm that owns it,
  // in the camera-relative coordinates the arm works in. So it takes the plain camera, and the
  // shifted one exists only for the buffer that needed shifting.
  const lights = g.view.drawSprites(cam, opts.sprites, cssH);
  // ⚠ AFTER THE MASS, ALWAYS. It is depth-TESTED and writes none of its own, so the buildings
  // have to be in the buffer before it is asked what stands in front of it.
  const curtains = g.view.drawCurtain(cam, opts.curtain, cssH, opts.now);
  const decals = g.view.drawDecals(cam, opts.decals, cssH);
  // The scatter carries the renderer own fog curve, because the 2-D drawers tint by fogTint at
  // the anchor depth and a billboard that did not would be a different bush at every distance.
  const scatter = g.view.drawBillboards(cam, opts.scatter, cssH, opts.fogBand);
  return { faces: g.faces || 0, builds, lights, lit: lightList || [], curtains, decals, scatter, bbTex: g.view.billboardTextures ? g.view.billboardTextures() : 0, ground, floor, canvas: g.canvas };
}

