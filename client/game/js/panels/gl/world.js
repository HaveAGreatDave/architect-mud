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
import { lightMatrix, eyePos } from './camera.js';
import { SHADOW_BIAS_TILES } from './shadow.js';

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
// ⚠ `gain` WAS 1.5 AND IT SATURATED THE BUILDINGS IT WAS MOST MEANT FOR. The wash is additive per
// light, and a neon-heavy frontage carries a dozen of its own — two glow pools, four beacons, a
// marquee, a pair of blades — so they stack and the facade goes flat. Measured at a truck cab in
// front of Voltage and Neon Vig at 22:00: at 1.5 both were a single uniform slab of their own sign
// colour with no wall texture, no window grid and no trim left. The detail is all still being
// drawn; it is just underneath. `__glLights()` sweeps what share of wall pixels each setting moves,
// which is the right question for "is the feature doing anything" and the wrong one for "is it
// doing too much" — more pixels moved scores better right up to the point everything is one colour.
//
// 0.45 was picked against the failure rather than the feature: at it, the same two buildings keep
// their texture and read as lit, and the buildings with ONE modest sign (an office, a walk-up) are
// visually unchanged — which is the check that matters, because it says the reduction bites only
// where the saturation was.
//
// ⚠ AND 0.45 → 0.70 BECAUSE THE WALLS UNDERNEATH IT CHANGED. The cut above was measured against the
// city as it was; the neon tone pass then deepened every night wall in proportion, and the emissive
// pass replaced punched window grids with ribbons and added roof armatures, corner blades and
// gable-end panels. A darker wall takes more wash before it flattens, so the same number was buying
// less than it had been — the shipping cab reading moved 17.6% → 18.9% of wall pixels with the knob
// untouched.
//
// ⚠ THE KNEE IS IN THE AIR SEAT'S `worst` COLUMN, NOT IN `litPct`. Share-of-pixels-moved rises
// smoothly and monotonically all the way to 1.4 and says nothing at all about saturation, exactly
// as the paragraph above warns. The worst single pixel is the one that does: from the air it goes
// 27 → 28 across 0.45 → 0.70 and then 28 → 38 across 0.70 → 1.00, so the first step costs nothing
// and the second costs most of the headroom. Held against the picture at the same three settings,
// 1.00 is where a block on the far side of the street starts going to one flat lavender — the same
// failure 1.5 had, arrived at more slowly.
//
// Measured at 0.70: cab 22.3% of wall pixels moved (worst 13), air 20.5% (worst 28), and the DAY
// seat 0.3% at every setting in the sweep — unchanged, because the term is scaled by the night and
// is therefore free at noon by arithmetic rather than by a threshold.
//
// ⚠ AND BACK TO 0.45, ON THE EYE IN THE GAME RATHER THAN ON THE BENCH. 0.70 was chosen off the
// sweep's knee and reported from a live cockpit as "the wash effect is too dramatic". The bench was
// not wrong about where the knee is; it was answering the wrong question. `litPct` and `worst` say
// how far a setting is from SATURATING a wall, and the complaint was never that walls were
// saturating — it was that the wash reads as a light show over a city rather than as signs lighting
// the walls they are bolted to. No number in that table is about that, and there is no obvious one
// to add: the thing being judged is whether the effect draws attention to itself.
//
// ⚠ AND `wrap` IS THE ANGLE HALF, reported in the same breath: "a few things seem influenced by the
// external camera view at certain angles". That is exactly what a wrapped diffuse does — it lights
// faces turned AWAY from the light, so from an external camera you see walls glowing whose source
// is round the other side of the building and nothing on screen explains them. It is measurably an
// aerial effect: swept at a fixed gain, dropping wrap 0.6 → 0 costs the cab 4.2 points of wall
// coverage and the air seat 7.4, so the term does close to twice as much work at the seat the
// complaint came from. 0.35 keeps the reason it exists — the commonest light here is mounted FLUSH
// on its wall, where a pure cosine is ~0 — and stops it reaching most of the way round a building.
export const LIGHT_TUNE = { minR: 0.8, span: 3.2, gain: 0.45, wrap: 0.35, rise: 0.22, fall: 0.38 };

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
// How many of the MAX_LIGHTS slots are held for surface washes rather than contested by every light
// in the frame — see the reservation at the end of pickLights. Two of twelve: enough that a lit
// street throws something on the road opposite, few enough that the neon still owns the frame.
const WASH_SLOTS = 2;
// How many of the ROAD's six reflection slots are held for surface washes. Mirrors WASH_SLOTS: the
// ground shader's own cut is the first `MAX_WET` of whatever it is handed, and pickLights puts
// washes last, so without this a wash can never reflect in a puddle it is standing over.
const ROAD_WASH_SLOTS = 2;
const ROAD_LIGHTS = 6;                 // ⚠ the same six as `MAX_WET` in ground.js — two copies, kept adjacent in comment
function roadLights(list) {
  if (!list || list.length <= ROAD_LIGHTS) return list;
  const wash = [], src = [];
  for (const L of list) (L.wash ? wash : src).push(L);
  if (!wash.length) return list;       // nothing to reserve for — the old behaviour exactly
  const take = Math.min(ROAD_WASH_SLOTS, wash.length);
  return wash.slice(0, take).concat(src.slice(0, ROAD_LIGHTS - take));
}

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
  // ⚠ THE NIGHT SCALE BELONGS TO THE WALL WASH, NOT TO THE LIST. Returning null in daylight meant
  // the frame had NO LIGHTS AT ALL by day — right for a wall (a shopfront measured a pink cast over
  // 19,000 pixels of its own wall at noon) and wrong for everything else that wants to know where
  // the lights ARE. A wet road reflects them at four in the afternoon in a downpour, and the city's
  // neon is certainly lit in one.
  //
  // So the list is always built and the night scale rides on the COLOUR the wall shader reads:
  // 'rgb' is night-weighted and falls to zero at noon by arithmetic, 'rgbRaw' is not. The caller
  // still hands the mass pass nothing when the gain is zero, so the wall side is unchanged.
  //
  // ⚠ A DAYLIGHT REFLECTION BEING FAINT IS THE SCENE, NOT A RULE. It is drawn at full strength and
  // sits on ground that is already bright, so it washes out on its own — which is what a wet road
  // actually looks like at four in the afternoon. Gating it would be deciding that in advance.
  const nightGain = LIGHT_TUNE.gain * Math.min(1, Math.max(0, night));
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
      // The same light with the NIGHT factor removed but `gain` kept, for surfaces that reflect
      // rather than catch.
      //
      // ⚠ DROPPING `gain` TOO MAKES A WET ROAD BRIGHTER THAN A DRY ONE, which is backwards. `gain`
      // is the tuning — the reflection strength downstream was swept against a night-weighted
      // colour, so a raw one runs about 2.2x over it. Measured with gain dropped: a daylight road
      // went 54.5 to 76.4 in the rain, when the whole point is that it darkens.
      rgbRaw: [c[0] / 255 * s.a * LIGHT_TUNE.gain, c[1] / 255 * s.a * LIGHT_TUNE.gain, c[2] / 255 * s.a * LIGHT_TUNE.gain],
      r,
      key,
      wash: !!s.wash,
      score: I * r / f,
    });
  }
  if (!out.length) return null;
  // Incumbents carry a bonus, so a challenger has to be clearly better rather than a hair better.
  if (held) for (const e of out) if (held.has(e.key)) e.score *= LIGHT_HOLD;
  out.sort((p, q) => q.score - p.score);
  // ── AND A FEW SLOTS ARE HELD FOR THE WASHES ─────────────────────────────────────────────────
  //
  // A lit facade throws light too, and until it did the city's windows were bright rectangles that
  // lit nothing. But a wash and a sign cannot be ranked against each other on one scale: there are
  // twelve slots against ~180 candidates, so at any brightness where a wash wins a slot it wins
  // MANY, and it wins them from the neon. Measured both ways on the aeroplane seat — washes at full
  // strength took the wall coverage from 13.7% of pixels to 11.5% (more lights, less light), and
  // dimmed until they stopped evicting anything they contributed exactly nothing, 13.7% again.
  // There is no brightness in between, because the failure is the ranking and not the value.
  //
  // So two of the twelve are reserved for the best washes and the rest are contested as before. A
  // frame with no washes in it is bit-identical: the splice only runs when the top N is all sources
  // AND there is a wash below the line waiting.
  if (WASH_SLOTS > 0 && out.length > MAX_LIGHTS) {
    const top = out.slice(0, MAX_LIGHTS);
    let have = 0;
    for (const e of top) if (e.wash) have++;
    if (have < WASH_SLOTS) {
      const want = out.filter((e) => e.wash && !top.includes(e)).slice(0, WASH_SLOTS - have);
      // Drop the weakest SOURCES to make room — never another wash, or two washes trade one slot
      // back and forth every frame and the disco is back.
      for (let i = top.length - 1, k = 0; i >= 0 && k < want.length; i--) {
        if (top[i].wash) continue;
        top[i] = want[k++];
      }
      return top.concat(out.slice(MAX_LIGHTS));
    }
  }
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

function sceneGL(id, w, h, msaa = 1) {
  let g = scenes.get(id);
  if (!g) { g = { canvas: null, view: null, key: '', atlasKey: '', epoch: '', atlas: null, msaa: msaa !== 0 ? 1 : 0 }; scenes.set(id, g); }
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
  // ⚠ A RESIZE DOES NOT NEED A NEW VIEW, AND REBUILDING ONE ON EVERY RESIZE IS WHAT KILLED THE
  // RENDERER MID-FLIGHT. This used to drop `g.view` whenever the canvas changed size, on the
  // comment "a resized canvas loses its context state". It does not: resizing a WebGL drawing
  // buffer clears it and resets the viewport, and leaves the context, its programs, its buffers,
  // its textures and its VAOs entirely intact. Nothing in `createGLView` is sized at creation
  // either — every `canvas.width/height` in it is read at DRAW time.
  //
  // What the rebuild did instead was recompile every program and reallocate every layer, every
  // time, while nothing anywhere deletes the old ones — there is no dispose path in this module.
  // A vertex buffer for an aeroplane's window is on the order of fifteen megabytes. And the thing
  // that resizes the canvas is the adaptive RESOLUTION DIAL, which steps whenever smoothed frame
  // time crosses a tenth — so turning to face a heavy view churns views, leaks their GPU objects,
  // and eventually the browser force-loses the context. The frame after that reports
  // `drew nothing — no context, a lost context, or a zero-sized host`, sets `RENDER_TUNE.gl = 0`,
  // and the session finishes on the CPU renderer: ghost buildings, banded roads and a 4x frame.
  //
  // Measured: 0 buffer rebuilds over 20 frames at a steady size, 20 over 20 alternating resizes.
  //
  // ⚠ MSAA IS THE ONE THING THAT GENUINELY CANNOT SURVIVE, because `antialias` is a context
  // CREATION attribute and `getContext` on a canvas that already has one hands back the original
  // whatever you ask for. So that case needs a NEW CANVAS, and the old context is explicitly lost
  // rather than left to the collector — which is also why the old code could not actually change
  // MSAA at all: it rebuilt the view against the same canvas and got the same context back.
  const wantMsaa = msaa !== 0 ? 1 : 0;
  if (g.view && g.msaa !== wantMsaa) {
    try { g.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* nothing to lose */ }
    const cv = document.createElement('canvas');
    cv.className = 'ws-gl';
    g.canvas = cv;
    g.view = null; g.key = ''; g.atlasKey = '';
  }
  g.msaa = wantMsaa;
  if (g.canvas.width !== w || g.canvas.height !== h) { g.canvas.width = w; g.canvas.height = h; }
  if (!g.view) { g.view = createGLView(g.canvas, { msaa: wantMsaa }); g.atlasKey = ''; g.key = ''; }
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
// ⚠ `RENDER_TUNE.richKit` IS DELIBERATELY NOT A TERM HERE, AND THAT MEANS IT NEEDS A RELOAD.
// `derivedTrim` keys its own two lists on it, but this memo does not — so flipping it in the console
// hands back the right list to a cache that already holds the wrong mesh, and the flag appears to do
// nothing. It is not threaded through because it is a dev lever, not a property of a building, and
// the route in would be install.js's options allowlist, which is precisely where two features have
// shipped inert by being wired at both ends and dropped in the middle. Set it before the first paint
// of a fresh page — the same rule every bench in the Modelshop already follows for the same reason.
const meshParams = (it) => it.fh + ':' + it.h + ':' + it.seed + ':' + it.E[0] + ',' + it.E[1];

// ── WHAT THE SUN PASS IS HANDED, OR NOTHING AT ALL ──────────────────────────
//
// Everything the shadow needs, assembled in one place so the three ways it must NOT run are three
// lines rather than three call sites: the knob is off, the sun is down, or the buffer has no
// geometry to fit a projection to. Returning null is a full answer — `draw` puts the strength to 0
// and the comparison in the shader never happens.
//
// ⚠ THE SUN GOING DOWN IS A HARD GATE AND NOT A FADE TO ZERO STRENGTH. `len` is 0 outside
// 05:30-18:30, which makes the light direction straight down and the ortho box degenerate; more to
// the point, the pass is a full re-render of the city and half of every day is night. Skipping it
// is the difference between a feature that costs something after dark and one that costs nothing.
function sunShadowFor(g, opts) {
  const str = opts.glShadow || 0;
  const sun = opts.sun;
  if (!(str > 0) || !sun || !(sun.len > 0) || !sun.dir) return null;
  const b = g.view.bounds;
  if (!b) return null;
  // ⚠ THE BIAS IS CONVERTED FROM TILES INTO THIS BOX'S OWN DEPTH RANGE. The box is fitted to the
  // mesh, so a cab's is about a third the depth of a cockpit's — a constant in clip units is two
  // different distances in the two seats, and the value that stops acne in one detaches a shadow
  // from its building in the other. The span here is the diagonal rather than the height, because
  // a low sun lays the light axis over almost as much ground as it does height.
  const span = Math.max(1, Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0));
  // Toward the sun, in three dimensions — for the slope term in the bias only. `len` is cotangent
  // of the elevation in this renderer's own terms (see lightMatrix), so the vertical component is 1
  // before normalising and a low sun leans the vector over.
  const sx = sun.dir[0] * sun.len, sy = sun.dir[1] * sun.len;
  const sl = Math.hypot(sx, sy, 1) || 1;
  return {
    str, lightVP: lightMatrix(sun, b), bias: SHADOW_BIAS_TILES / span,
    sunDir: [sx / sl, sy / sl, 1 / sl],
  };
}

// ── BAKED AMBIENT OCCLUSION, ON THE ONE AXIS THE HEIGHT TERM CANNOT SEE ───────────────────────
//
// `RENDER_TUNE.glAO` is a world-HEIGHT term — it darkens by distance above the ground — and it ships
// at 0 because that axis is already covered twice, by `wallLit`'s per-face gradient and by real cast
// shadows. The note on it names what occlusion would actually add and why it was not built: concave
// geometry, so a recessed doorway, the underside of a sill, the inner corner of a setback. That
// needs neighbours, and the two ways to get them were costed as SSAO (a screen pass) or per-vertex
// baking, the latter rejected at "6.5 ms for 240 buildings … the one budget that is genuinely tight".
//
// ⚠ THAT COSTING ASSUMED THE BAKE IS PAID PER BUFFER BUILD, AND IT IS NOT. `tileMesh` is memoised
// per model per parameter set, and a window of 240 buildings is instances of far fewer distinct
// models — so this is paid once per model, on first sight, and every later frame and every rebuild
// reads it back off the cached face. What was costed as a per-rebuild price is a one-off.
//
// The sample is a hemisphere about the face normal, tested against the model's own solid volume.
// ⚠ It is the SAME solid CFIT asks (`modelSolid` → `segContains` → the captured shape), so a corner
// that reads as dark is a corner that is really there.
const AO_DIRS = (() => {
  // One straight out along the normal, then two rings tilted off it. Fixed angles rather than a
  // random set: an unseeded pattern makes the bake non-deterministic, and `models:diff` is watching.
  const out = [[0, 0, 1]];
  for (const [tilt, n] of [[0.62, 4], [1.05, 4]]) {
    const st = Math.sin(tilt), ct = Math.cos(tilt);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (tilt > 1 ? Math.PI / 4 : 0);
      out.push([Math.cos(a) * st, Math.sin(a) * st, ct]);
    }
  }
  return out;
})();
// Two reaches, so a surface deep in a corner reads darker than one that merely touches another. In
// tiles: a wall is 0.88 across, so 0.05 is a hand's width against a building and 0.14 is a doorway.
const AO_REACH = [0.05, 0.14];
// How far off its own surface a sample starts. Trim stands proud of its wall by `FACE_EPS`, which is
// far smaller than this — so without the offset half the samples of every trim face begin inside the
// wall behind it and the whole piece bakes black.
const AO_BIAS = 0.006;

export function bakeFaceAO(faces, solid) {
  // ⚠ THE EARLY-OUT IS NOT AN OPTIMISATION, IT IS WHAT MAKES THIS SHIP. Sampling every vertex of
  // every face costs 4.7 ms on the average model and 45.8 ms on The Meridian Lobby, whose gargoyles
  // are 44% of every face in the city — and a 45 ms bake is a dropped frame the moment that
  // building comes round a corner. Most of it is wasted: 54% of vertices in the city touch nothing
  // at all, because most of a building is open wall.
  //
  // So a face whose own bounding box, grown by the furthest reach, misses every segment's box is
  // fully open by construction and is filled in without a single solid() call. ⚠ The segment boxes
  // are conservative on purpose (see modelSolid) — an under-sized one here would skip sampling on a
  // face that really is in a corner, and bake it open.
  const REACH = AO_REACH[AO_REACH.length - 1] + AO_BIAS;
  // ⚠ AND THE SEGMENTS THAT SURVIVED THE TEST ARE HANDED ON, WHICH IS WHERE THE TIME ACTUALLY GOES.
  // The early-out alone saves 22%: every wall face lies ON a box, so something is always near it and
  // the answer is almost always yes. Excluding a face's own host makes the test fire, and is WRONG —
  // it took the occluded share of the city from 45.7% of vertices to 33.6%, because a face nested
  // inside a larger box's bounding volume is genuinely occluded BY that box. So nothing is skipped
  // on that basis; instead the sampling below tests only the segments actually in range, which turns
  // a whole-model scan per sample into two or three boxes.
  // ⚠ NULL, NEVER AN EMPTY ARRAY, WHEN THERE ARE NO BOUNDS TO NARROW BY. `modelSolid` supplies
  // them, but this function takes any predicate — and an empty list means "test these zero segments"
  // rather than "test everything", so a solid without bounds would bake the whole city fully open.
  // Silently, and looking exactly like the strength being set to 0.
  const near = solid.bounds ? [] : null;
  const bounds = solid.bounds || null;
  const anyNear = (f) => {
    if (!bounds) return true;          // no narrowing available — `near` is null and the full scan runs
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of f.p) {
      if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
      if (q[2] < z0) z0 = q[2]; if (q[2] > z1) z1 = q[2];
    }
    x0 -= REACH; x1 += REACH; y0 -= REACH; y1 += REACH; z0 -= REACH; z1 += REACH;
    near.length = 0;
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      if (b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1 && b.z1 >= z0 && b.z0 <= z1) near.push(i);
    }
    return near.length > 0;
  };
  for (const f of faces) {
    if (!anyNear(f)) { f.ao = null; continue; }   // fills `near` with the segments in range
    const n = f.n && (f.n[0] || f.n[1] || f.n[2]) ? f.n : [0, 0, 1];
    // An orthonormal frame about the normal. ⚠ The seed axis must not be parallel to n, or the cross
    // product is zero, every sample direction collapses onto the normal, and the model bakes a
    // uniform mid-grey — which reads as a strength setting rather than as a bug.
    const ax = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    let tx = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
    const tl = Math.hypot(tx[0], tx[1], tx[2]) || 1;
    tx = [tx[0] / tl, tx[1] / tl, tx[2] / tl];
    const ty = [n[1] * tx[2] - n[2] * tx[1], n[2] * tx[0] - n[0] * tx[2], n[0] * tx[1] - n[1] * tx[0]];
    const ao = new Float32Array(f.p.length);
    for (let v = 0; v < f.p.length; v++) {
      const q = f.p[v];
      let hits = 0, taken = 0;
      for (const d of AO_DIRS) {
        const wx = tx[0] * d[0] + ty[0] * d[1] + n[0] * d[2];
        const wy = tx[1] * d[0] + ty[1] * d[1] + n[1] * d[2];
        const wz = tx[2] * d[0] + ty[2] * d[1] + n[2] * d[2];
        for (let r = 0; r < AO_REACH.length; r++) {
          const R = AO_REACH[r];
          taken++;
          if (solid(q[0] + n[0] * AO_BIAS + wx * R, q[1] + n[1] * AO_BIAS + wy * R,
                    q[2] + n[2] * AO_BIAS + wz * R, near)) hits++;
        }
      }
      ao[v] = taken ? 1 - hits / taken : 1;
    }
    f.ao = ao;
  }
}

function tileMesh(deps, it) {
  let byParam = meshCache.get(it.m);
  if (!byParam) { byParam = new Map(); meshCache.set(it.m, byParam); }
  const k = meshParams(it);
  let faces = byParam.get(k);
  if (!faces) {
    let mesh;
    try { mesh = deps.captureModelMesh(it.m, { fh: it.fh, h: it.h, seed: it.seed, E: it.E }); } catch { mesh = []; }
    // ── AND THE SAME BUILDING AFTER DARK ────────────────────────────────────────────────────────
    //
    // The capture above runs at `night: 0` (the default), and it always did — `meshParams` has no
    // night term, so this memo could never invalidate on one. That was invisible while the 2-D
    // painter drew the trim; under GLASS 2 `FLAT_OFF` is set and THE MESH IS THE ONLY SOURCE OF
    // TRIM APPEARANCE, so every surface that paints itself differently after dark — a lit window
    // bay, a canopy's strip light, a blade panel, a lit shopfront — was frozen at noon. Measured
    // across the registry: 4,973 of 28,717 faces on 163 of the 173 models.
    //
    // ⚠ THE SECOND CAPTURE IS FOR COLOUR ONLY, AND THAT IS WHY IT IS AFFORDABLE. The two are
    // geometrically identical face-for-face (0 of 173 models differ; `gl:mesh` asserts it), so the
    // night pass contributes nothing but `rgbN` — no second AO bake (AO is derived from geometry,
    // which has not moved), no second `faceUVs`, no second memo entry. Paid once per model per
    // parameter set, inside the same memo, exactly like the AO bake below.
    //
    // ⚠ IT IS INDEXED, NOT MATCHED. If a future model ever made its face COUNT depend on the hour,
    // the two lists would be misaligned and buildings would wear each other's colours. The length
    // guard below is what stops that being silent, and `gl:mesh` fails on it outright.
    let night = null;
    try { night = deps.captureModelMesh(it.m, { fh: it.fh, h: it.h, seed: it.seed, E: it.E, night: 1 }); } catch { night = null; }
    if (night && night.length !== mesh.length) night = null;
    faces = mesh.map((f, i) => {
      const day = f.rgbOverride || deps.palette.get(f.pal) || [120, 126, 134];
      const nf = night && night[i];
      const nrgb = nf && (nf.rgbOverride || deps.palette.get(nf.pal) || null);
      return {
        ...f,
        rgb: day,
        // Only a face that actually changes carries a second colour — see the ⚠ in `uploadGroups`.
        rgbN: nrgb && (nrgb[0] !== day[0] || nrgb[1] !== day[1] || nrgb[2] !== day[2]) ? nrgb : null,
        uv: faceUVs(f),
        texKey: f.pal ? (f.kind === 'roof' ? 'r:' : 'w:') + f.pal : null,
        // ── WHICH MATERIAL FAMILY THIS SURFACE IS, RESOLVED ONCE PER MODEL ────────────────
        //
        // Exactly the same shape of fact as `texKey` — a pure function of the palette key and
        // whether this is a roof — so it is resolved HERE, inside the per-model memo, and not per
        // vertex at upload. A city is one building geometry repeated at many tiles; a lookup per
        // vertex would pay for it once per copy per rebuild for an answer that cannot have changed.
        //
        // ⚠ A FACE WITH NO PALETTE TAKES 0, WHICH IS THE DEFAULT FACADE AND NOT A MISSING VALUE.
        // Those are the flat-shaded adornment surfaces, and the shader skips the whole material
        // block for them on `solid` anyway — but the index still has to be in range, because an
        // out-of-bounds read into a GLSL uniform array is undefined and on this driver returns
        // zeros, which is gloss 0: `pow(x, 0.0)` is 1.0 everywhere, a mirror-bright specular over
        // every piece of trim in the city.
        mat: f.pal
          ? (f.kind === 'roof'
            ? (deps.roofMaterialId ? deps.roofMaterialId(f.pal) : 0)
            : (deps.wallMaterialId ? deps.wallMaterialId(f.pal) : 0))
          : 0,
      };
    });
    // ⚠ Inside the memo, so it is paid once per model per parameter set and never per rebuild. A
    // model whose shape will not capture gets no term at all rather than a wrong one.
    try {
      const solid = deps.modelSolid && deps.modelSolid(it.m, it.seed, it.fh, it.h);
      if (solid) bakeFaceAO(faces, solid);
    } catch { /* an un-captured shape is not a claim about occlusion */ }
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
  const g = sceneGL(id, W, H, opts.msaa == null ? 1 : opts.msaa);
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
    // ⚠ The dusk blend goes in HERE and not into `windowKey`/`meshParams`. It is already in
    // `epoch` (via `texEpoch`), which is what forces this rebuild in the first place, so the trim
    // colours cross dusk on the same 64 steps the wall textures do — one rebuild, not two.
    g.view.uploadGroups(groups, (f) => (g.atlas && f.texKey ? g.atlas.rect.get(f.texKey) : null), opts.nb || 0);
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
  // ⚠ THE WALL PASS STILL GETS NOTHING BY DAY, and that is where the night gate moved to rather
  // than being deleted. `pickLights` now builds the list at every hour so the road can reflect in
  // daylight, but a wall wash at noon is the saturation bug this feature was tuned against — and
  // twelve per-fragment distance tests on every wall pixel is not free either. `rgb` is already
  // zero up there when the gain is, so this is belt and braces, and it keeps the daylight frame
  // exactly the shape it was.
  const wallLights = (LIGHT_TUNE.gain * Math.min(1, Math.max(0, opts.night || 0)) > 0.01) ? lightList : null;
  g.view.draw(camAt, { ...(opts.draw || {}), lights: wallLights, lightWrap: LIGHT_TUNE.wrap, cssH,
    ao: opts.glAO || 0, aoFall: AO_TUNE.fall, bakedAo: opts.glBakedAo || 0, sunShadow: sunShadowFor(g, opts),
    // ── THE MATERIAL RESPONSE ───────────────────────────────────────────────────────────────
    //
    // ⚠ THE EYE COMES OFF `camAt`, THE SHIFTED CAMERA, AND THAT IS THE WHOLE OF WHAT CAN GO WRONG
    // HERE. The vertices are in map-window tiles and `camAt` folds `ox`/`oy` into the offsets, so
    // this is the eye in the frame the mesh is in — the same conversion `pickLights` does for the
    // lights. Handing it the plain `cam` slides every highlight in the city by the window offset,
    // which does not read as a bug: it reads as the sun being somewhere else.
    eye: eyePos(camAt),
    matStr: opts.glMat == null ? 1 : opts.glMat,
    bumpStr: opts.glBump == null ? 1 : opts.glBump,
    mat: deps.matTable || null });
  // ⚠ AFTER THE MASS, AND THAT IS NOT AN ORDERING PREFERENCE. `draw()` OPENS with
  // gl.clear(COLOR | DEPTH) — so a floor drawn before it is drawn and then wiped, every frame.
  // It cost an afternoon: the result looked like a floor (the backstop wash showed through the
  // cleared canvas), it was smoothly graded and uniformly dark, and it ignored a debug uniform
  // wired straight into its own fragment output, which is what finally gave it away.
  //
  // Drawing it after costs nothing, because the floor WRITES depth and TESTS it: where a building
  // is nearer the floor loses the fragment, which is the same picture the other order would have
  // given if the clear had not been in the way.
  // ── AND THE CITY'S LIGHTS, LYING ON THE WET ROAD ───────────────────────────────────────────
  //
  // The same `lightList` the wall wash takes. Nothing extra is collected and nothing is authored.
  //
  // ⚠ THE REFLECTIONS GO ON THE GROUND PASS, NOT THE FLOOR, AND THAT WAS MEASURED RATHER THAN
  // CHOSEN. The floor shader looks like the right home — it owns the ground and it already knows
  // which tiles are paved. But `GROUND_FULL` draws every road and pavement tile as an OPAQUE QUAD
  // on top of it, so a reflection painted into the floor is covered by exactly the surface it
  // belongs on: the floor owns 55.6% of a frame over bare ground and 17.9% over a paved street.
  //
  // ⚠ AND PUTTING IT HERE MAKES THE FRAME FREE. These quads are recorded at their map-window tile —
  // the same frame `pickLights` has already shifted its lights into — so the positions go in
  // untouched. In the floor shader they would have needed a third conversion, into tiles measured
  // from the window centre, which is the kind of sub-tile slide that reads as art rather than as a
  // bug. The floor keeps its `uWet` uniforms and its debug mode 5 for the day somebody wants
  // reflections on unpaved ground, and they stay switched off.
  const fl = opts.floor;
  if (fl) { fl.wet = 0; fl.wetLights = null; }
  const floor = g.view.drawFloor(opts.floor);
  // ⚠ AFTER THE FLOOR AND IN THE WINDOW FRAME. The road quads are recorded at their map-window
  // tile exactly as the mesh is, so they take the SHIFTED camera; handing them the plain one
  // would slide the kerbs a fraction of a tile off the buildings standing on them. They also
  // stand ON the floor rather than being it — see the eps ladder in windshield.js.
  const ground = g.view.drawGround(camAt, opts.ground, cssH, {
    // No haze band: the per-quad alpha already carries drawGroundSurfaces own far fade, and
    // applying the window dissolve on top would fade the road twice.
    fog: opts.fogBand,
    // The wet road. `lightList` is already in this pass's own frame — see the ⚠ above — and the
    // camera's ground point is the window shift, because `camAt` is the shifted camera.
    // ⚠ NOT GATED ON THERE BEING LIGHTS, AND IT WAS. `pickLights` hands back null in daylight, so
    // `lightList && lightList.length` made the road dry every afternoon however hard it was raining
    // — reported from the game in an extreme deluge at 15:07. The wetness and the reflections are
    // two terms: the first needs only water, the second needs something to reflect. The shader
    // skips the reflection loop on its own when `uNWet` is 0.
    wet: opts.glWet > 0 ? opts.glWet : 0,
    // ⚠ THE ROAD PICKS ITS OWN SIX, AND HANDING IT `lightList` RAW MEANT WASHES NEVER REACHED IT.
    // `pickLights` satisfies `WASH_SLOTS` by replacing the WEAKEST sources, so a wash sits at
    // position 10 or 11 of the twelve — and `MAX_WET` in ground.js takes the FIRST SIX. A facade
    // wash was therefore always past the cut the road can see: measured at 0 road pixels moved
    // against 4,827 of building, which is the exact opposite of what it is for.
    //
    // ⚠ AND WASHES DO NOT SIMPLY GO FIRST. On tarmac the hero is a neon sign's sharp streak; a
    // facade throws a broad soft sheen. Both are wanted and the sign is the one you notice, so the
    // road reserves two of its six for washes and fills the rest with the best sources — the same
    // policy `WASH_SLOTS` applies one layer up, for the same reason.
    wetLights: roadLights(lightList),
    // ⚠ `cam.ox/oy` AND NOT A BARE `ox`. Those names are LOCAL TO `pickLights`, and reaching for
    // them here threw `ReferenceError: ox is not defined` on every frame — which the pass catches,
    // logs once per frame and falls back to 2-D from. So the whole feature was off, every
    // measurement of it was measuring the 2-D renderer, and no headless gate could see any of it
    // because none of them has a GL context. `glLastFrame()` returning null is the tell.
    eyeX: cam.ox || 0, eyeY: cam.oy || 0,
    // ⚠ AND HOW HIGH THE EYE IS, which is what keeps the reflections on the road instead of across
    // the map. See the Fresnel gate in ground.js.
    //
    // ⚠ `cam.EH`, IN CAPITALS, AND THE LOWERCASE ONE COST THE WHOLE ALTITUDE TERM. `eh` is the
    // name in RENDER_TUNE; the CAMERA calls it `EH`, because makeCam sums the tune value with the
    // climb lift and floors it. So `cam.eh` is undefined at every altitude and the ?? fell through
    // to the 0.2 literal — which is about right for a truck, and is why the cab looked correct
    // while the Fresnel gate was a constant and the aerial green wash it was written to fix was
    // still there. Found by `__glWet()` measuring 0.00% brighter at night and the probe that
    // followed; no headless gate can see it, because none of them has a GL context.
    eyeH: opts.eyeH == null ? (cam.EH == null ? 0.2 : cam.EH) : opts.eyeH,
    // ⚠ AND THE WINDOW CENTRE, WHICH IS NOT THE FLOOR'S TO OWN. The puddle field is phased on
    // absolute world tiles and `opts.floor` is null whenever `glFloor` is off, so taking wcx from
    // there would leave the puddles sliding with the window on exactly the setting that is meant
    // to change nothing but who draws the ground.
    wcX: (opts.wc && opts.wc.x) || 0, wcY: (opts.wc && opts.wc.y) || 0,
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
  // The wires — masts, rails, braces, cables, light-runners. After the mass for the same reason
  // the Curtain and the signage are: depth-tested, writing none of its own.
  const strokes = g.view.drawStrokes ? g.view.drawStrokes(cam, opts.strokes, cssH) : 0;
  // The scatter carries the renderer own fog curve, because the 2-D drawers tint by fogTint at
  // the anchor depth and a billboard that did not would be a different bush at every distance.
  const scatter = g.view.drawBillboards(cam, opts.scatter, cssH, opts.fogBand);
  // ⚠ `shadowSize` IS 0 WHEN THE DRIVER REFUSED THE DEPTH FRAMEBUFFER, and that is the only way to
  // tell that case apart from a sunny frame in which nothing happens to cast. Same argument as
  // `builds` and `cloudCards`: the picture is a correct picture either way.
  // ⚠ `wet` IS REPORTED BECAUSE IT IS OTHERWISE UNOBSERVABLE, and that cost seven failed attempts to
  // measure the wet road by diffing pixels. It is a product of three things that can each be zero
  // for a different reason — the tune, the integrated wetness, and whether any light was picked —
  // so a dry-looking road says nothing about WHICH of them it was. A number beside the frame does.
  return { faces: g.faces || 0, builds, lights, lit: lightList || [], curtains, decals, strokes, scatter, bbTex: g.view.billboardTextures ? g.view.billboardTextures() : 0, ground, floor, wet: opts.glWet || 0, shadowSize: g.view.shadowSize || 0, canvas: g.canvas };
}

