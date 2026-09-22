// THE SEA'S SHAPE — the one JS copy of the swell, its slope, and the long roll under it.
//
// ⚠ THIS FILE EXISTS BECAUSE FOUR THINGS HAVE TO AGREE ABOUT WHERE A CREST IS. The GPU floor
// shades the water, the software raster shades the same water when `glFloor` is 0, a hull rides it,
// and a helideck sits on top of that hull. Two of those are JS and one is GLSL, so this is the
// `landform.js` arrangement rather than the `ground-accum.js` one: the JS lives here, and
// **gl/floor.js carries the GLSL twin by hand**, because a shader cannot import anything. Nothing
// else may hold a copy. `scripts/shapes/sea.mjs` reads the coefficients out of all three sources
// and fails when they drift, exactly as `coastwarp.mjs` does for the coast.
//
// ⚠ AND "BIT-FOR-BIT" IS NOT THE GOAL, BECAUSE IT IS NOT AVAILABLE. GLSL `highp` is a 24-bit
// mantissa and `sin()` has no specified precision; JS is a double. What must be identical is the
// COEFFICIENT TABLE, which is what the gate checks. At the shipping amplitude a 1e-3 relative
// disagreement is 2e-5 tiles, far below a pixel at any range.

// ── THE CHOP ──────────────────────────────────────────────────────────────────────────────────
//
// Three crossing sine trains, phase-modulated by one shared low-frequency sine so the crests
// wander instead of forming a corrugated diamond lattice. The FM is there instead of a noise
// domain-warp because a warp costs two noise samples on every water texel and tanked the frame
// rate over open sea; this costs one extra sine.
//
// ⚠ THESE ARE CHOP, NOT SWELL, AND THE NAME MATTERS. The wavenumber magnitudes are 5.75, 5.23 and
// 10.5, so the wavelengths are 1.09, 1.20 and 0.60 tiles — about 4 to 8 metres. That is wind chop.
// Lighting it gives a sparkling sea and NOT a rolling one, which is why SEA_ROLL exists below.
// Nothing here may be retuned without moving the whitecap thresholds with it: they are absolute
// numbers tested against this sum.
export const SEA_PH = { ku: 0.6, kv: -0.45, w: 0.25 };
export const SEA_TRAINS = [
  { a: 0.5,  ku: 5.6, kv:  1.3, w:  0.9,  pm: 1.6 },
  { a: 0.4,  ku: 3.7, kv: -3.7, w: -0.66, pm: 1.1 },
  { a: 0.11, ku: 7.4, kv:  7.4, w:  1.25, pm: 0.7 },
];

// ── THE ROLL ──────────────────────────────────────────────────────────────────────────────────
//
// One long train at 8.6 tiles — about sixty metres, which is an ocean swell rather than a wind
// wave. This is the term that carries the Wave Race read, and it is the ONLY one a rigid body may
// ride: the chop's wavelengths are all shorter than the Echelon's beam, so fitting a hull to them
// would be fitting it to noise.
//
// ⚠ ITS AMPLITUDE IS A CALLER'S ARGUMENT AND DEFAULTS TO ZERO, so every surface that has not opted
// in draws exactly the sea that shipped. That is what makes the sea-state flag's 0 provably the
// old picture rather than nearly it.
// k is the wavenumber MAGNITUDE, which is what steepness and the Stokes term are measured against.
// 8.6 tiles — and JONSWAP says that is right: at 50 km of fetch in a 20 m/s gale the peak is 58 m,
// which at this map scale is 8.3 tiles.
// ⚠ A WAVE CANNOT BE TALL WITHOUT BEING LONG, WHICH IS WHY THIS TRAIN GOT LONGER BEFORE THE SEA GOT
// BIGGER. The limiting steepness of a gravity wave is H/L = 1/7, so a 60 m train can carry 8.6 m
// trough-to-crest and no more — at Hs 4 m it was already at 64% of that, and simply raising the
// amplitude walks into a wave the arithmetic refuses to draw (the Stokes correction goes as kA and
// SEA_KA_LIMIT is 0.443, past which the crest notches rather than sharpens).
//
// So the dominant train is **179 m** now: k 0.7272 -> 0.2451, from w = 0.18 through the dispersion
// relation the whole sea uses. ⚠ THE FREQUENCY IS SNAPPED TO THE 0.01 rad/s GRID FIRST AND THE
// WAVENUMBER DERIVED FROM IT, never the other way round — 'seaClock' wraps at 2*PI/0.01 and is
// phase-exact only because every frequency divides it, so solving for k and letting w fall where it
// likes puts a seam across every client's sea every ten and a half minutes.
//
// ⚠ AND IT IS SIZED TO THE PATCH ON PURPOSE. 'PATCH_R' is 28 tiles now and this train is 25.6, so
// it is still ONE whole wave across the displaced mesh — which is the constraint that decided the
// wavelength rather than the other way round. The grid had to be graded before the wave could grow:
// a uniform patch at this radius is four times the triangles of the old fourteen-tile one, and the
// graded one is a third of them.
//
// ⚠ AND THE AUDIO FOLLOWS RATHER THAN NEEDING A SECOND EDIT: 'sea-audio.js' derives its LFO rates
// from this 'w', so a longer swell breathes slower on its own — 20.3 s -> 34.9 s.
export const SEA_ROLL = { a: 1.0, ku: 0.2090, kv: 0.1280, w: 0.18, k: 0.2451 };

// ── THE WIND SEA ──────────────────────────────────────────────────────────────────────────────
//
// The train between the two, at 3.2 tiles — about twenty-two metres — and the one that makes a
// storm look like a storm. The roll is a long ocean swell: it heaves you, and from a low seat you
// sit INSIDE one and see a moving horizon rather than waves. This is short enough that several are
// in front of you at once and steep enough to be walls rather than undulations.
//
// ⚠ ITS SPEED IS NOT A TASTE CHOICE. Deep-water gravity waves run at omega = sqrt(g·k), so a train
// with 2.7x the roll's wavenumber must run 1.64x its frequency or the two drift through each other
// at a rate no sea does — which reads as two effects playing at once rather than as one surface.
// 0.31 × sqrt(1.96 / 0.727) = 0.51.
//
// ⚠ AND ITS STEEPNESS IS BOUNDED BY PHYSICS, NOT BY PREFERENCE. Steepness is amplitude × wavenumber
// and a Stokes wave breaks near 0.44; at the shipping amplitude this runs about 0.39, which is a
// genuinely steep sea and still a surface rather than a fold. Raising the amplitude past ~0.22
// tiles makes the mesh self-intersect, which does not look like a bigger wave — it looks broken.
// ⚠ AND THE WIND SEA HAD TO LENGTHEN WITH IT OR IT BREAKS, which is the half that is easy to miss.
// Amplitude is split 60/40 between these two trains and rises with Hs, while the wavenumber does
// not — so at Hs 6.5 m on its old 22 m wavelength this train reaches kA = 0.610 against a limiting
// wave of 0.443. That is not a wave that draws badly, it is a wave the second-order correction
// inverts: past the limit the cos term overtakes the fundamental and the crest notches.
// 69 m now (k 1.9602 -> 0.6362, w 0.51 -> 0.29), which holds it at kA 0.366 against the 0.381 it
// used to run at — no steeper than it ever was, while carrying three times the height.
export const SEA_WIND = { a: 1.0, ku: 0.5030, kv: 0.3895, w: 0.29, pm: 0.9, k: 0.6362 };


// ── THE BAND AROUND EACH PEAK ─────────────────────────────────────────────────────────────────
//
// A real sea is a SPECTRUM, not two frequencies. `SEA_ROLL` and `SEA_WIND` are single trains, and a
// single train is a perfect corrugation: it repeats exactly every wavelength, for ever, and from a
// low seat that reads as a moving pattern rather than as water. The phase modulation the chop uses
// hides it at one-tile scales and cannot at sixty-metre ones, because there the repeat is bigger
// than anything else in the frame.
//
// ⚠ AND THE ANSWER IS NOT AN FFT, WHICH WAS CONSIDERED AND REJECTED ON A CONSTRAINT RATHER THAN A
// COST. A Tessendorf ocean produces a TEXTURE, and four things read this height field — the floor
// shader, the mesh's vertex shader, the ship's physics and the gate — two of them on the CPU. That
// would mean either a 256-squared FFT in JS every frame, a GPU readback no server can do, or a
// second coarse copy that disagrees with the first. What is actually wanted from Tessendorf is the
// SPECTRUM, and a sum of Gerstner trains drawn from one carries most of it while staying closed
// form, differentiable, CPU-samplable and deterministic.
//
// ⚠ SO EACH PEAK GAINS TWO SIDEBANDS AND KEEPS ITS OWN NUMBERS. `SEA_ROLL` and `SEA_WIND` are
// untouched — they are read by the sea audio for its LFO rates and pinned by that gate — and the
// sidebands are ADDED around them, with the peak giving up exactly the share they take. At spread 0
// the peak is 1.0 and the sidebands are 0, so the sea is bit-for-bit the one that shipped.
//
// ⚠ THE FREQUENCIES ARE SNAPPED TO THE 0.01 rad/s GRID, which is not decoration: `seaClock` wraps
// at 2*pi/0.01 and the wrap is phase-exact ONLY because every frequency in the sea is a multiple of
// that. A sideband at a physically-derived 0.2542 rad/s would put a discontinuity into the surface
// every ten and a half minutes — a visible jump, on every client at once, and deterministic enough
// that nobody would guess it was the clock.
//
// ⚠ AND THE WAVENUMBERS COME FROM THE DISPERSION RELATION, NOT FROM TASTE. Deep-water gravity waves
// run at omega^2 = g*k, so a sideband's k is the peak's scaled by (its omega / the peak's)^2. Pick k
// freely and the sidebands drift through the peak at a rate no sea does, which reads as three
// effects playing at once — the same argument `SEA_WIND`'s own note already makes for its 0.51.
const side = (peak, wFrac, aShare, turnDeg) => {
  const w = Math.round(peak.w * wFrac * 100) / 100;          // snapped to the 0.01 grid
  const k = peak.k * (w / peak.w) * (w / peak.w);            // omega^2 = g*k
  const th = Math.atan2(peak.kv, peak.ku) + turnDeg * Math.PI / 180;
  return { a: aShare, ku: k * Math.cos(th), kv: k * Math.sin(th), w, k, pm: peak.pm || 0 };
};

// ⚠ THE SPREAD IS AN ANGLE AS WELL AS A FREQUENCY, and the angle is what does the work. Two trains
// at different frequencies on ONE heading still make a corrugation — a beat pattern, marching in
// step — and it is only when they cross at an angle that the crests stop being parallel lines and
// start being a sea. +-22 degrees is a wind sea's own directional spread and is enough that no two
// crests stay aligned for more than a few wavelengths.
// How much of the band is spread into the sidebands by default. 0 is the single-train sea that
// shipped, bit for bit; 1 is the full band. It lives here rather than in RENDER_TUNE because the
// SERVER reads this module too, and a renderer flag is not something a server can honour.
export const SEA_SPREAD = 1;

// ⚠ AND THERE IS DELIBERATELY NO SHARPENING COMPENSATION HERE, WHICH IS WORTH KNOWING BECAUSE ONE
// WAS BUILT, MEASURED AND THEN DELETED. The second-order Stokes correction goes as amplitude
// SQUARED, so splitting a wave makes each component less sharp than the one it replaced — and with
// the peak's share taken LINEARLY (0.62 of its height) the surface skewness fell from 0.154 to
// 0.087, below the +0.1 an observed wind sea carries. The crests had quietly gone back to being
// sinusoids, which is the single thing that separates an angry sea from a placid one.
//
// A factor that scaled each component's correction back up fixed the number, and it was a fudge
// dressed as physics. The actual bug was one line away: the band was being normalised LINEARLY when
// independent trains add in QUADRATURE. With the energy preserved the peak keeps 96% of its height
// rather than 62%, its own correction is barely touched, and the skewness comes back to 0.146 on
// its own — inside the observed band, within noise of the 0.154 that shipped, and with nothing
// compensating for anything. Measured across the factor: 1.0 gives 0.146 and 1.6 gives 0.224.
//
// The lesson is the one this file keeps relearning: a number that has to be corrected is usually a
// number that is wrong somewhere else.
export const SEA_SWELL_SIDE = [side(SEA_ROLL, 0.82, 0.22, -22), side(SEA_ROLL, 1.22, 0.16, 22)];
export const SEA_WIND_SIDE = [side(SEA_WIND, 0.80, 0.20, 24), side(SEA_WIND, 1.24, 0.14, -19)];
// What the peak keeps once the band has taken its share. Written out rather than derived at each
// call because it is also the number the gate checks the GLSL against.
// ⚠ AND THE PEAK IS NORMALISED IN QUADRATURE, NOT LINEARLY, WHICH IS THE DIFFERENCE BETWEEN
// SPREADING A SPECTRUM AND SIMPLY TURNING THE SEA DOWN. Independent trains add as the ROOT of the
// sum of squares, not as the sum: three amplitudes of 0.62, 0.22 and 0.16 make a sea whose RMS is
// 0.68 of the single train they replaced, so a linear share hands back a sea 31% calmer at the same
// nominal sea state — measured, and exactly the kind of quiet regression a screenshot cannot show.
// Wave energy goes as amplitude squared, so preserving it is preserving how rough the sea IS.
const quad = (side) => Math.sqrt(Math.max(0, 1 - side.reduce((s, T) => s + T.a * T.a, 0)));
export const SEA_SWELL_PEAK = quad(SEA_SWELL_SIDE);
export const SEA_WIND_PEAK = quad(SEA_WIND_SIDE);

// Physical amplitude of the chop, in tiles, once a surface is lit rather than merely tinted. Small
// on purpose: at 1-tile wavelengths the SLOPE is what reads, and the slope is amplitude times a
// wavenumber of ~6, so 0.02 tiles already gives a 6.7° facet.
export const SEA_AMP = 0.02;

// ── EVALUATION ────────────────────────────────────────────────────────────────────────────────

// The shipped `wv`: the three chop trains, unit amplitude, no roll. Whitecap thresholds are tested
// against THIS and not against the total, so a heavy swell does not foam a calm surface.
export function seaChop(u, v, t) {
  const ph = Math.sin(SEA_PH.ku * u + SEA_PH.kv * v + SEA_PH.w * t);
  let s = 0;
  for (const T of SEA_TRAINS) s += T.a * Math.sin(T.ku * u + T.kv * v + T.w * t + T.pm * ph);
  return s;
}

// ── STOKES: WHY A REAL WAVE IS NOT A SINE ─────────────────────────────────────────────────────
//
// ⚠ THIS IS THE SINGLE BIGGEST THING BETWEEN "THE SEA IS MOVING" AND "THE SEA IS ANGRY", and it is
// one extra cosine per train. A linear (Airy) wave is a sinusoid: crest and trough are mirror
// images, which is true only in the limit of vanishing steepness and is exactly why a big sine
// swell reads as placid no matter how tall it is. A real gravity wave of finite steepness is a
// STOKES wave — the second-order correction adds a term at twice the frequency that SHARPENS the
// crest and FLATTENS the trough:
//
//     eta = a·cos(th) + (k·a²/2)·cos(2·th)
//
// Our trains are written in sine, and sin(th) = cos(th - pi/2), so substituting gives
// `a·sin(th) - (k·a²/2)·cos(2·th)` — the sign of the second term is NOT free and getting it
// backwards flattens the crests and digs out the troughs, which reads as an oddly soft sea rather
// than as an error.
//
// ⚠ STEEPNESS IS ka AND IT BREAKS NEAR 0.44. That is the Stokes limiting wave (120-degree crest
// angle); past it the surface is no longer single-valued, and a vertex grid asked to draw it folds
// through itself. The amplitudes in RENDER_TUNE are bounded by that, not by preference.
// ── HOW A WAVE LEANS ──────────────────────────────────────────────────────────────────────────
//
// A second-order Stokes wave is SKEWED: sharp high crests over broad shallow troughs. That is one of
// the two ways a real wave departs from a sine, and it is the only one this sea had.
//
// The other is ASYMMETRY — the front face steeper than the back, the crest pitched forward into the
// direction of travel — and it is the one that reads as a wave about to break. Coastal engineering
// keeps the two words apart for exactly this reason: skewness is the vertical shape (the Hilbert
// transform's third moment about the horizontal) and asymmetry is the horizontal one. A wave can be
// as skewed as you like and still be perfectly symmetric front-to-back, which is what ours was.
//
// ⚠ THE TWO TERMS ARE THE SAME HARMONIC IN QUADRATURE, which is why this costs nothing: skewness
// rides cos(2θ) and asymmetry rides sin(2θ), so the whole second order is one more sine per train.
//
// ⚠ AND BOTH SCALE WITH kA, WHICH IS NOT A STYLE CHOICE. The second-order correction to a Stokes
// wave IS proportional to the steepness — that is what makes it second order — so a glassy sea is
// symmetric and sinusoidal BY ARITHMETIC rather than by a guard, and a gale leans because it is
// steep. Written as a flat offset instead, a dead calm would sit there permanently pitched forward.
//
// ⚠ SEA_SKEW IS A GAIN ON THE NONLINEARITY AND NEVER ON THE HEIGHT. A wave approaching breaking
// redistributes energy INTO its harmonics at the same total energy — it gets sharper rather than
// taller — so this sharpens the crest without touching Hs, and JONSWAP goes on owning the height.
// 1.0 is the textbook second-order coefficient.
//
// ⚠ AND THE HEIGHT FIELD STAYS SINGLE-VALUED, which is the whole reason it is written as a vertical
// term rather than as the horizontal displacement a true Gerstner wave uses. Gerstner is parametric
// — x and z are both functions of a phase — so "what is the height at world point (u,v)" needs an
// inversion, and FOUR readers here ask exactly that question: the floor shader (which recovers a
// world point from the screen and asks for its height), the mesh's vertex shader, the hull's ride,
// and the gate. Gerstner would also FOLD past ka ~ 0.5, which is the cusped-shoreline bug
// 'coastWarp' already shipped once. This leans the wave and can never overturn it, and the honest
// statement of that limit is that a breaking wave is multi-valued and a height field is not.
// ⚠ SWEPT AGAINST THE FACE ANGLE, WHICH IS THE CEILING AND WAS ALREADY NEARLY REACHED. The Stokes
// limiting wave has a 120° crest, which is a 30° face — and the sea as it shipped already peaked at
// 30.8° over a long sweep, because a superposition of trains reaches slopes no single train in it
// does. So these are set where the shape changes and the face does not run away: measured at
// skew 1.4 / asym 2.0, vertical skewness 0.139 (observed seas +0.1..+0.3), horizontal asymmetry
// 0.483 (observed 0.5..1.5), steepest face 34.8°, and the crest and Hs barely move — 2.74 → 2.86 m
// and 3.99 → 4.06 m. That last pair is the point: the wave is SHAPED rather than made bigger.
// ⚠ Asymmetry SATURATES near 0.6 — 2.0 → 3.0 buys 0.51 → 0.60 and costs three degrees of face — so
// there is nothing above this worth taking.
export const SEA_SKEW = 1.4;   // gain on the crest-sharpening (cos 2θ) term
export const SEA_ASYM = 2.0;   // gain on the forward-pitch (sin 2θ) term
// The Stokes limiting wave: a 120° crest at ka = 0.443. Nothing here may be driven past it.
export const SEA_KA_LIMIT = 0.443;
// How far downwind the whitecap mask is read, in tiles.
//
// ⚠ IT MOVES WHERE FOAM LANDS AND NEVER HOW MUCH THERE IS. The threshold it feeds is quantile-
// inverted to hit the whitecap coverage Monahan & O'Muircheartaigh measured, and that inversion is
// load-bearing: bias the TEST and the sea foams at the wrong fraction for its wind, which is a
// physical claim this file makes and the suite checks. Shifting the sampling POSITION moves the
// pattern and leaves its distribution exactly alone — same field, same statistics, read a step
// downwind, so the foam sits on the face a crest is spilling down rather than symmetric about it.
//
// ⚠ AND IT IS READ OFF THE CHOP, never off the whole surface: a mask taken from the full height
// field would inherit the swell's 8.6-tile period, which is a band of whitecaps marching across the
// bay rather than a scatter of them.
export const SEA_FOAM_LEAD = 0.16;
const stokesD = (th, k, A, sk = SEA_SKEW, as = SEA_ASYM) =>
  A * (Math.cos(th) + sk * k * A * Math.sin(2 * th) + as * k * A * Math.cos(2 * th));
const stokes = (th, k, A, sk = SEA_SKEW, as = SEA_ASYM) => {
  const e = 0.5 * (k * A);
  return A * (Math.sin(th) - sk * e * Math.cos(2 * th) + as * e * Math.sin(2 * th));
};

// The long roll. No phase modulation: it is one train, so there is no lattice to break, and an FM
// term on it would only make the boats pitch for no reason anybody could see.
export function seaRoll(u, v, t, A = 1, sp = SEA_SPREAD) {
  // ⚠ THE PEAK GIVES UP EXACTLY WHAT THE BAND TAKES, so the total amplitude is unchanged whatever
  // the spread is — which is what keeps steepness, the Stokes limit and the hull's own ride meaning
  // the same thing at every setting. Adding sidebands ON TOP instead would raise the sea by a third
  // and push the wind train past breaking, and the tell would be a mesh that self-intersects.
  const pk = 1 - (1 - SEA_SWELL_PEAK) * sp;
  let h = stokes(SEA_ROLL.ku * u + SEA_ROLL.kv * v + SEA_ROLL.w * t, SEA_ROLL.k, A * pk);
  if (sp !== 0) for (const T of SEA_SWELL_SIDE) {
    h += stokes(T.ku * u + T.kv * v + T.w * t, T.k, A * T.a * sp);
  }
  return h;
}

// The wind sea. Phase-modulated by the SAME shared sine the chop uses, so a storm is not a perfect
// corrugation marching across the bay.
export function seaWind(u, v, t, A = 1, sp = SEA_SPREAD) {
  const ph = Math.sin(SEA_PH.ku * u + SEA_PH.kv * v + SEA_PH.w * t);
  const pk = 1 - (1 - SEA_WIND_PEAK) * sp;
  let h = stokes(SEA_WIND.ku * u + SEA_WIND.kv * v + SEA_WIND.w * t + SEA_WIND.pm * ph, SEA_WIND.k, A * pk);
  if (sp !== 0) for (const T of SEA_WIND_SIDE) {
    h += stokes(T.ku * u + T.kv * v + T.w * t + T.pm * ph, T.k, A * T.a * sp);
  }
  return h;
}

// Surface height in TILES. `roll` is the swell's amplitude, `wind` the wind sea's, `amp` the chop's.
export function seaHeight(u, v, t, roll = 0, amp = SEA_AMP, wind = 0, sp = SEA_SPREAD) {
  return seaRoll(u, v, t, roll, sp) + seaWind(u, v, t, wind, sp) + seaChop(u, v, t) * amp;
}

// ── THE SLOPE, IN CLOSED FORM ─────────────────────────────────────────────────────────────────
//
// The whole point of the FM formulation is that it stays differentiable: every train is a sine of
// an argument that is linear in u and v plus one shared `ph`, so the chain rule closes and a true
// surface normal costs four more cosines and NO texture taps. That is what makes lighting the sea
// affordable at all.
//
// ⚠ DO NOT RECOVER THE COSINE AS sqrt(1 - sin²). It throws the sign away, and a sign error here
// puts the highlight on the wrong face of every crest — which looks like water, so nothing and
// nobody will report it. The gate checks this against a central difference for that reason.
export function seaSlope(u, v, t, roll = 0, amp = SEA_AMP, wind = 0, sp = SEA_SPREAD) {
  const A = SEA_PH.ku * u + SEA_PH.kv * v + SEA_PH.w * t;
  const cA = Math.cos(A), sA = Math.sin(A);
  let du = 0, dv = 0;
  for (const T of SEA_TRAINS) {
    const c = Math.cos(T.ku * u + T.kv * v + T.w * t + T.pm * sA);
    du += T.a * c * (T.ku + T.pm * SEA_PH.ku * cA);
    dv += T.a * c * (T.kv + T.pm * SEA_PH.kv * cA);
  }
  du *= amp; dv *= amp;
  // ⚠ AND THE STOKES TERM IS IN THE SLOPE TOO. d/dth of A(sin th - (kA/2)cos 2th) is
  // A(cos th + kA·sin 2th) — leave the second half out and the LIGHTING goes on describing a
  // sinusoid while the GEOMETRY is a Stokes wave, so the highlight sits a little off every sharpened
  // crest. That is a small error everywhere rather than a big one somewhere, which is the hardest
  // kind to see and the reason this is derived rather than eyeballed.
  // ⚠ EVERY SIDEBAND IS IN THE SLOPE TOO, and its OWN amplitude is what its Stokes term is measured
  // against — not the band's. Steepness is amplitude times wavenumber per train, so folding the
  // peak's amplitude into a sideband's correction sharpens a crest that is not there and leaves the
  // lighting describing a wave the geometry never drew.
  if (roll !== 0) {
    const pk = 1 - (1 - SEA_SWELL_PEAK) * sp;
    const th = SEA_ROLL.ku * u + SEA_ROLL.kv * v + SEA_ROLL.w * t;
    const aR = roll * pk;
    const cR = stokesD(th, SEA_ROLL.k, aR);
    du += cR * SEA_ROLL.ku;
    dv += cR * SEA_ROLL.kv;
    if (sp !== 0) for (const T of SEA_SWELL_SIDE) {
      const ts = T.ku * u + T.kv * v + T.w * t;
      const aS = roll * T.a * sp;
      const cS = stokesD(ts, T.k, aS);
      du += cS * T.ku;
      dv += cS * T.kv;
    }
  }
  if (wind !== 0) {
    // The wind train is phase-modulated, so its chain rule closes the same way the chop's does.
    const pk = 1 - (1 - SEA_WIND_PEAK) * sp;
    const th = SEA_WIND.ku * u + SEA_WIND.kv * v + SEA_WIND.w * t + SEA_WIND.pm * sA;
    const aW = wind * pk;
    const cW = stokesD(th, SEA_WIND.k, aW);
    du += cW * (SEA_WIND.ku + SEA_WIND.pm * SEA_PH.ku * cA);
    dv += cW * (SEA_WIND.kv + SEA_WIND.pm * SEA_PH.kv * cA);
    if (sp !== 0) for (const T of SEA_WIND_SIDE) {
      const ts = T.ku * u + T.kv * v + T.w * t + T.pm * sA;
      const aS = wind * T.a * sp;
      const cS = stokesD(ts, T.k, aS);
      du += cS * (T.ku + T.pm * SEA_PH.ku * cA);
      dv += cS * (T.kv + T.pm * SEA_PH.kv * cA);
    }
  }
  return [du, dv];
}

// The unit surface normal, z up. Handed the same arguments as seaHeight.
export function seaNormal(u, v, t, roll = 0, amp = SEA_AMP, wind = 0, sp = SEA_SPREAD) {
  const [du, dv] = seaSlope(u, v, t, roll, amp, wind, sp);
  const n = Math.hypot(du, dv, 1);
  return [-du / n, -dv / n, 1 / n];
}

// ── HOW ROUGH IT IS, AND HOW SLOWLY THAT CHANGES ──────────────────────────────────────────────
//
// One scalar, 0 for glass and 1 for a full gale, and everything above scales off it.
//
// ⚠ IT IS DRIVEN BY WIND, NOT BY GLOOM. Sea state is fetch and duration — how hard it has been
// blowing and for how long — so a fog bank with WX_HAZE 0.75 sits over a sea like a mirror, and
// driving this off the storm grade alone would put a gale under it. The storm term is a FLOOR
// rather than the source, because a squall that has not yet built a sea has still got a sea under
// it somewhere.
//
// ⚠ AND IT HAS INERTIA, WHICH IS THE WHOLE REASON IT IS A RESERVOIR AND NOT A READING. Weather is
// sampled per CELL, so a craft crossing a squall boundary steps from clear to storm in one frame —
// and a sea that went from glass to breaking in that frame reads as a rendering glitch rather than
// as weather. Real seas build over hours and lie down over most of a day; scaled to this game's
// clock, minutes.
// ── IS THE EYE UNDER THE WATER? ───────────────────────────────────────────────────────────────
//
// A camera near the sea goes UNDER it, and not marginally. Every seat is floored at 0.05 tiles
// above MEAN sea level ('Math.max(0.05, ...)' in windshield.js), and a crest reaches 0.099 tiles at
// 10 knots, 0.199 at 22 and 0.404 at SEA_FULL_KT — so from about Force 4 a low camera is ducked by
// up to eight times its own height above the mean. Nothing in the renderer tested for it: the mesh
// is drawn two-sided and depth-writing, so what you got was the UNDERSIDE of the waves shaded
// exactly as if seen from above — sky reflection, sun glitter, whitecaps — under an air sky with
// air fog. That does not read as being underwater; it reads as the renderer being broken.
//
// ⚠ IT IS THE SAME HEIGHT FIELD THE MESH DISPLACES BY, WHICH IS THE WHOLE REASON THIS IS ONE LINE.
// A submersion test written from a second expression — a mean level, a sea-state scalar, a sampled
// texture — disagrees with the surface it is testing against, so the effect switches on while you
// are visibly above the water and off while you are under it. 'seaHeight' IS the surface.
//
// ⚠ AND IT STAYS A PURE FUNCTION OF (POSITION, TIME), so two clients agree exactly, the text rung
// can ask the same question with no renderer, and a server can check it with no table and no tick —
// the property every other part of this sea is built to keep.
//
// ⚠ AND THE TRANSITION IS A BAND, NEVER A BOOLEAN. At the waterline in a seaway the eye crosses the
// surface several times a second, so a hard test flickers — and this codebase has an explicit
// no-strobe rule (see the drug FX, which are held to it for photosensitivity). The band is a DEPTH
// rather than a time, because depth is what both sides of the boundary already speak in and a timer
// would be state on a function that must not have any.
export const SEA_DUNK_BAND = 0.03;   // tiles of depth over which the dunk blends fully in (~21 cm)

// Returns { depth, under }: 'depth' is how far the surface is ABOVE the eye in tiles (negative when
// the eye is clear of it) and 'under' is the 0..1 blend every consumer should weigh itself by.
export function seaSubmersion(u, v, z, t, roll = 0, amp = SEA_AMP, wind = 0, sp = SEA_SPREAD) {
  const depth = seaHeight(u, v, t, roll, amp, wind, sp) - z;
  const under = depth <= 0 ? 0 : (depth >= SEA_DUNK_BAND ? 1 : depth / SEA_DUNK_BAND);
  return { depth, under };
}

export const SEA_RISE_S = 150, SEA_FALL_S = 420;

// ── THE CLOCK, AND WHY IT WRAPS ───────────────────────────────────────────────────────────────
//
// ⚠ THE SEA WAS DETERMINISTIC IN PRINCIPLE AND PRIVATE IN PRACTICE. Every term here is a pure
// function of a world point and a time, so two machines handed the same inputs draw the same sea
// with nothing on the wire — except that the time came from `performance.now()`, which is
// **milliseconds since that browser tab's own time origin**. Two players standing on the same tile
// at the same instant were looking at completely different water, and nothing said so, because both
// of them looked like water.
//
// ⚠ AND `Date.now()` STRAIGHT IN IS WORSE, WHICH IS THE PART THAT IS NOT OBVIOUS. It is ~1.79e12 ms;
// at the roll's 0.31 rad/s that is 5.5e8 radians, and a float32 — which is what a GLSL uniform is —
// has a resolution of **64 radians** at that magnitude. Ten whole waves between representable
// values. The sea would not drift or stutter, it would FREEZE, on the GPU only, while the JS that
// rides it went on moving.
//
// ⚠ SO IT WRAPS, AND THE WRAP IS EXACT RATHER THAN TOLERABLE. Every temporal frequency in this
// file and in the floor's own water block — 0.25, 0.31, 0.51, 0.9, 0.66, 1.25, and the surf and
// near-field terms at 1.6, 1.3, 1.0, 0.4 — is an exact multiple of 0.01 rad/s. That was not
// arranged; it is what people pick when they pick numbers by hand, and it means a wrap at
// 2π/0.01 returns EVERY train to exactly the phase it started at. No discontinuity to hide, no
// blend to write, no drift to accumulate — the sea at t and at t + 628.3185s is bit-identical.
//
// ⚠ THE ONE TERM THAT IS NOT COMMENSURATE IS THE ROTOR DOWNWASH (`uT * (3.0 + 7.0 * uRotor)`),
// whose frequency is a live control input, so it cannot be a multiple of anything. Its phase jumps
// once every ten and a half minutes under a hovering helicopter, which is a local transient on a
// crater that is already being beaten into the water. `scripts/shapes/sea.mjs` asserts the rest.
export const SEA_BASE_W = 0.01;                          // rad/s — the greatest common frequency
export const SEA_PERIOD_S = 2 * Math.PI / SEA_BASE_W;    // 628.3185 s, about ten and a half minutes

// The shared sea clock, in seconds, from a SHARED epoch and wrapped to the period above.
//
// ⚠ `Date.now()` RATHER THAN `performance.now()` IS THE WHOLE POINT, and it costs one thing worth
// knowing: it is wall-clock, so an NTP correction can step it. A backwards step makes the swell
// jump, where `performance.now()` is monotonic and cannot. Corrections are milliseconds in normal
// operation and the alternative is a sea nobody else can see, so this is the right trade — but it
// is a trade, and a machine with a badly wrong clock will disagree with everyone else by exactly
// its own error.
export function seaClock(nowMs) {
  const s = (nowMs == null ? Date.now() : nowMs) / 1000;
  return s - Math.floor(s / SEA_PERIOD_S) * SEA_PERIOD_S;
}

// ── FROM WIND TO WAVES ────────────────────────────────────────────────────────────────────────
//
// ⚠ THE FIRST VERSION OF THIS SATURATED AT BEAUFORT 5 AND NOTHING SAID SO. It read the sea state
// off `windFromView().fly`, which is `clamp(kt / 18)` — and that number is the WINDSOCK's: "0 hangs
// down the pole, 1 stands straight out". A sock is fully out at 18 knots and stays fully out in a
// hurricane, which is correct for a sock and means every wind from a fresh breeze upward produced
// an identical full Force 10 sea. The whole weather response was two Beaufort numbers wide.
//
// So the chain is physical now, end to end: wind speed -> significant wave height -> amplitude.
//
// FETCH-LIMITED, BECAUSE A BASIN IS. JONSWAP's growth law gives, in dimensionless form,
// E~ = 1.6e-7 · F~ with F~ = gF/U² and E = E~·U⁴/g², so Hs = 4√E reduces to
//
//     Hs = 4·U·√(1.6e-7 · F / g)
//
// — significant height is LINEAR in wind speed once the fetch is fixed, which is the thing that
// separates an enclosed basin from an ocean and is why this does not use Pierson-Moskowitz (fully
// developed, Hs ∝ U², and far too big for anywhere you can see the far shore from).
// ⚠ THE FETCH IS THE LEVER ON HEIGHT AND THE WIND SCALE IS NOT, because JONSWAP puts Hs on
// sqrt(FETCH): 45 kt over 50 km is 4.06 m and reads as WMO sea state 6 — "very rough", and only
// just, since 6 starts at 4. A real storm sea is state 8 at 9-14 m. Raising SEA_FULL_KT instead
// would need 73 kt for the same answer and would make every OTHER wind-driven system in the game
// (the chill, the socks, the flags, the audio bed, the spindrift) read a wind nobody has ever
// measured in the Basin. 130 km is a bigger body of open water beyond the map, which is what this
// number has always meant. Measured: Hs 4.06 -> 12.0 m, WMO sea state 6 -> 8, "very high".
export const SEA_FETCH_M = 440000;  // the Basin's effective fetch: how far the wind gets to work
export const SEA_FULL_KT = 45;      // the wind that means "sea state 1" — Force 9, a strong gale
const KT_TO_MS = 0.5144;
const TILE_M = 7;                   // a lane is LANE_W across, so a tile is about seven metres

// ── SHELTER: LAND UPWIND IS THE WHOLE OF WHY A HARBOUR IS FLAT ────────────────────────────────
//
// Waves need distance to build, so water with land close upwind is flat however hard it is
// blowing — which is why an offshore gale leaves the lee shore like glass and the windward side
// of the same island unlandable. One number does both, and it is the direction that carries it.
//
// ⚠ THE SHAPE IS JONSWAP'S AND THE REFERENCE IS DELIBERATELY NOT. Hs goes as the square root of
// fetch, so that is the curve. What it may NOT use is `SEA_FETCH_M`: the authored ocean fetch is
// 50 km and the whole map window is about 350 m, three orders of magnitude smaller — so measured
// against it EVERY tile the renderer can see comes out at under 7% of the sea, and the moment the
// search runs off the end it jumps to 100%. That is a hard line drawn across the water at exactly
// the search limit, which is worse than no shelter at all.
//
// So the reference is the search itself: shelter is sqrt(d / maxD), which is 0 against a beach,
// about a fifth two tiles out, and exactly 1 where the search finds nothing — continuous by
// construction, with no seam to hide.
//
// ⚠ AND IT IS THE UPWIND DIRECTION, NEVER THE NEAREST LAND. A distance transform is cheaper,
// cacheable with the tile grid and wind-independent — and it makes a bay calm whichever way the
// wind blows, which is the one thing this exists to get right.
export const SEA_TILE_M = TILE_M;
export function seaShelter(d, maxD) {
  if (!(maxD > 0)) return 1;
  return Math.min(1, Math.sqrt(Math.max(0, d) / maxD));
}

// Significant wave height in METRES for a given wind in knots.
export function seaHsFor(kt, fetchM = SEA_FETCH_M) {
  return 4 * Math.max(0, kt) * KT_TO_MS * Math.sqrt(1.6e-7 * fetchM / 9.81);
}

// ⚠ AND THE AMPLITUDES COME OUT OF Hs RATHER THAN OUT OF A TASTE CURVE. Hs is by definition 4σ,
// where σ is the RMS surface elevation; a sine of amplitude a has RMS a/√2, so two trains carrying
// a fraction of the energy each land at a = (Hs/4)·√2·√(share). The 60/40 split between swell and
// wind sea is the ordinary shape of a mixed sea.
//
// ⚠ AND THE RESULT IS SMALLER THAN THE HAND-TUNED NUMBERS IT REPLACED, WHICH IS THE POINT. The old
// full-state pair was 0.32/0.20 tiles — Hs about 9 m, an open-ocean Force 11 — in a basin you can
// see across. What makes the physical figure dramatic anyway is the SUBJECT: the Echelon is 5.3 m
// long at this map scale, so a 2.6 m sea is half her length and genuinely dangerous for her.
export function seaAmpsFor(kt, gain = 1, fetchM = SEA_FETCH_M) {
  const hs = seaHsFor(kt, fetchM);
  const a = (hs / TILE_M) / 4 * Math.SQRT2 * gain;
  return { hs, roll: a * Math.sqrt(0.6), wind: a * Math.sqrt(0.4) };
}

// ── HOW MUCH OF IT IS BREAKING ────────────────────────────────────────────────────────────────
//
// Monahan & O'Muircheartaigh (1980): the fraction of the sea surface covered in whitecaps is
// W = 3.84e-6 · U^3.41, U in m/s at 10 m. About 1% at Force 5, 10.5% at Force 8, 22.5% at Force 10.
// ── HOW ROUGH THE WATER IS, AS A SLOPE DISTRIBUTION ───────────────────────────────────────────
//
// Cox & Munk 1954 (JOSA 44:838) photographed the sun's glitter from an aircraft over the Pacific
// and inverted its SHAPE to recover the sea-surface slope statistics. Near-Gaussian, and
// anisotropic — rougher along the wind than across it, which is why a real glitter path is an
// ellipse stretched downwind rather than a disc.
//
//     sigma_u^2 (along wind)  = 3.16e-3 * U
//     sigma_c^2 (across wind) = 3.0e-3 + 1.92e-3 * U        U in m/s
//
// ⚠ THIS IS THE WHOLE SEA'S ROUGHNESS, INCLUDING THE PART THIS RENDERER DOES NOT DRAW, and that is
// the point rather than a compromise. The mesh resolves the roll, the fragment normal carries the
// chop, and below about half a tile there is nothing at all — so the capillary and short gravity
// waves Cox & Munk measured are exactly the half of the spectrum a statistical glitter model is
// there to stand in for. Using the resolved sea's own slope variance instead would be measuring
// the part that is already drawn and ignoring the part that is not.
//
// ⚠ THE 0.003 INTERCEPT IS LOAD-BEARING. A normalised Gaussian's peak goes as 1/(su*sc), so a sea
// with no slope in it is a mirror of unbounded brightness one pixel across; the clean-surface
// intercept is what makes a dead calm finite.
//
// ⚠ AND BOTH AXES TAKE IT, WHICH IS A DEPARTURE FROM THE PUBLISHED FIT AND IS DELIBERATE. Cox &
// Munk's along-wind regression comes out with an intercept near zero — fine as a fit over the winds
// they flew in, and it says that a sea with no wind on it is a PERFECT MIRROR along one axis and a
// rough surface across it. Taken literally at kt 0 that gives an anisotropy of 0.18, which is a
// glitter path stretched ACROSS the wind, and a peak twenty-two times the reference. Sharing the
// intercept is what a real dead calm looks like: isotropic, and mirror-like in both directions.
// Above about Force 3 the two forms are within a per cent of each other, so nothing that matters
// moves — the anisotropy runs 1.19 at Force 2 to 1.24 at Force 9, stretched downwind throughout.
export function seaSlopeVariance(kt) {
  const u = Math.max(0, kt) * KT_TO_MS;
  return { u: SEA_SIG_CLEAN + 3.16e-3 * u, c: SEA_SIG_CLEAN + 1.92e-3 * u };
}
// The roughness the glitter gain is expressed against: at this, a streak's peak is 1. Roughly a
// Force 4 sea, so a harbour reads brighter and tighter than the reference and a gale broader and
// dimmer — see the ⚠ on normalisation in 'seaGlitter'.
export const SEA_SIG_REF = 0.012;
// Cox & Munk's clean-surface intercept: the slope variance of water with no wind working on it.
export const SEA_SIG_CLEAN = 3.0e-3;

export function whitecapFraction(kt) {
  const u = Math.max(0, kt) * KT_TO_MS;
  return Math.min(0.6, 3.84e-6 * Math.pow(u, 3.41));
}

// ⚠ AND THE THRESHOLD IS THE QUANTILE, NOT A FITTED CURVE. The shader decides a texel is breaking
// when `wv` exceeds a threshold, so the coverage that produces is entirely determined by the chop's
// own distribution — which is fixed and knowable. Sampling it once at module load and inverting it
// means the sea has EXACTLY Monahan's coverage at every wind speed, with nothing tuned and nothing
// to re-tune if the trains ever change. A curve fitted to three points would drift the moment they
// did, and drift silently.
// ── AND FOAM IS TORN, WHICH A SMOOTH THRESHOLD CANNOT BE ────────────────────────────────────────
//
// The whitecap mask was `chop > threshold` — a smooth threshold on a smooth field, which can only
// ever produce smooth-edged islands. Measured from the air at 45 kt, the foam patches had a
// perimeter 1.25x that of a perfectly round disc of the same area: they read as soft glowing blobs
// in rows rather than as foam, and no amount of retuning the THRESHOLD changes that, because the
// shape is a property of the field being thresholded and not of where the cut is made.
//
// ⚠ IT GOES INTO THE FIELD, NOT INTO THE ALPHA, AND THAT IS WHAT KEEPS THE COVERAGE HONEST. The
// obvious fix is to erode the finished mask with noise, and it silently breaks the one physical
// claim this sea makes about foam: `seaFoamThreshold` is the QUANTILE OF THE FIELD THE SHADER
// TESTS, inverted to hit Monahan & O'Muircheartaigh's observed coverage. Erode afterwards and the
// sea foams over a smaller fraction than its wind says it should, with the gate still green because
// the gate checks the threshold rather than the pixels. Perturb the field and re-quantile THAT, and
// the coverage is preserved by construction at every wind speed.
//
// ⚠ AND THE CORE STAYS SOLID FOR FREE. The shader's `cap` ramps from the threshold, so deep inside
// a breaking crest the mask is far past 1 and a perturbation changes nothing visible; at the rim it
// is near 0 and the perturbation decides. Solid core, torn edge, from one term — where noise
// multiplied into the finished alpha would punch holes in the middle of every whitecap and read as
// dither rather than as foam.
// ⚠ THE AMPLITUDE IS SET AGAINST THE FIELD'S OWN GRADIENT, not picked. A perturbation of the tested
// field moves the foam BOUNDARY by amplitude / |grad chop|, and that gradient is 2.43 per tile here
// — so 0.16 shifts the edge by 0.066 tiles against a crinkle period of 0.15, a ratio of 0.44, which
// is a gentle wobble. What reads as torn is a shift comparable to the crinkle's own wavelength.
// ⚠ And too FINE is as invisible as too coarse: at 90 rad/tile the shift exceeded a whole period,
// the edge folded through itself into sub-pixel noise, and the measured raggedness did not move at
// all. Both failures look identical from a screenshot — a foam edge that is simply still smooth.
export const SEA_FOAM_TEAR = 0.40;
// ⚠ AND FOAM IS ELONGATED ALONG THE CREST, WHICH IS THE OTHER HALF OF WHY IT READ AS BLOBS. A wave
// breaks along the LENGTH of its crest, so a whitecap is a streak running across the wave's line of
// travel and not a disc — obvious in any photograph of a gale and impossible to get from isotropic
// noise. The tear's sampling frame is stretched along the crest by this factor and compressed
// across it.
//
// ⚠ THE ANISOTROPY IS INVISIBLE TO THE QUANTILER, WHICH IS WHY IT MAY LIVE IN THE SHADER ALONE.
// Rotating and scaling the coordinates of a stationary field changes its correlation lengths and
// leaves its MARGINAL DISTRIBUTION exactly where it was — the amplitudes are what set that, and
// they do not move — so the threshold inverted from the isotropic field is the right threshold for
// the stretched one, and the shader can orient the tear per fragment for nothing.
export const SEA_FOAM_ALONG = 3.4;
// ⚠ THE TIME COEFFICIENT IS A MULTIPLE OF 0.01 rad/s LIKE EVERY OTHER ONE IN THIS FILE. `seaClock`
// wraps at 2*PI/0.01 and is phase-EXACT only because every frequency in the sea divides it; a tear
// drifting at 0.137 would put a seam across every client's foam every ten and a half minutes.
//
// ⚠ AND IT DRIFTS RATHER THAN SITTING STILL. A tear that is a pure function of position is a fixed
// stencil the waves move through, which reads as dirt on the lens rather than as water.
//
// Three octaves of domain-warped sine — each warped by the one before it, which is what turns a
// periodic grid of sines into something with no visible repeat. The frequencies are chosen for the
// scale foam actually tears at: the coarsest is about a 0.29-tile period (~2 m) and the finest
// about 0.06 (~0.4 m), against whitecap patches measuring 0.2-0.5 tiles across.
// ⚠ AND THE TEAR MUST BE MUCH FINER THAN THE THING IT IS TEARING, which the first cut got wrong
// by a factor of five. At 21.7 rad/tile the coarsest octave has a 0.29-tile period — the size of a
// whole whitecap — so it did not ragged an EDGE, it shuffled entire patches about and measured as
// no change in raggedness at all while moving 1% of the frame. An edge needs detail several times
// finer than the feature it belongs to.
export const SEA_FOAM_FREQ = 42;
export function seaFoamTear(u, v, t) {
  let qx = u * SEA_FOAM_FREQ, qy = v * SEA_FOAM_FREQ + t * 0.13;
  const a = Math.sin(qx + Math.sin(qy * 1.31));
  qx = qx * 2.17 + a * 1.7; qy = qy * 2.17 - a * 1.1;
  const b = Math.sin(qx * 0.93 + Math.sin(qy * 0.87));
  qx = qx * 2.31 + b * 1.3; qy = qy * 2.31 + b * 0.9;
  const c = Math.sin(qx * 0.89 + Math.sin(qy * 1.13));
  return a * 0.5 + b * 0.32 + c * 0.18;
}

// ── AND THE FOAM FIELD IS SHORTER THAN THE SURFACE FIELD ────────────────────────────────────────
//
// How BIG a whitecap is has nothing to do with how ragged its edge is: a patch is a level set of the
// field being thresholded, so its size is inherited from that field's wavelengths. The foam was
// tested on 'seaChop', whose trains are 1.09, 1.20 and 0.60 tiles — so every whitecap was a 4-to-8
// metre island however torn its rim, which is what still read as blobby after the tear landed.
//
// ⚠ AND MORE TEAR IS NOT THE ANSWER, WHICH THE CENSUS SAID PLAINLY. Swept to six times the shipping
// amplitude the patch COUNT rose 43 -> 122 while the LARGEST only fell 2454 -> 755 px and the median
// collapsed to 6 — noise shatters the small patches into speckle and leaves the big ones standing,
// because a big patch is a chop-scale feature and noise only nibbles its rim.
//
// ⚠ IT IS PHYSICALLY THE RIGHT FIELD TOO. Whitecaps are thrown by the SHORT breaking waves rather
// than by the dominant swell, so the field that decides where the sea is white should be shorter
// than the field that decides what it looks like. These are two real trains at about 0.25 and 0.17
// tiles (1.8 and 1.2 m), and ⚠ their frequencies come from the DISPERSION RELATION the rest of the
// sea uses (w^2 = g k, with g read off the chop's own trains at 0.141 in these units) and are
// snapped to the 0.01 rad/s grid, or 'seaClock' stops being phase-exact and every client gets a
// seam across its foam every ten and a half minutes.
//
// ⚠ AND THEY ARE ADDED TO THE FOAM TEST ONLY, NEVER TO THE SURFACE. The mesh cannot resolve a
// 0.17-tile wave (the grid carries 5.4 samples across the shortest chop train as it is), and the
// fragment normal describing a wave the geometry is not drawing is the one thing this sea's own
// rules forbid. This field is a statement about WHERE WATER IS BREAKING and about nothing else.
export function seaFoamFine(u, v, t) {
  return 0.34 * Math.sin(u * 22.6 + v * 10.4 + t * 1.88)
       + 0.22 * Math.sin(u * -13.1 + v * 31.8 - t * 2.31);
}

// ⚠ THE QUANTILE IS PER TEAR GAIN, because the threshold is the quantile of the field the shader
// tests and the tear is part of that field. With the flag at 0 the shader tests the smooth chop and
// must get the smooth chop's quantile, or switching the tear off would quietly change how much of
// the sea is breaking — which is the one thing an off switch may never do.
// ⚠ AND IT IS CAPPED, because the gain is a SLIDER and each entry is 65,536 doubles — half a
// megabyte. Sweeping the tune panel with an uncapped map would quietly allocate tens of megabytes
// of sorted samples nobody will look at again. Quantised to 0.02, four deep, oldest out.
const _q = new Map();
const _QMAX = 4;
function quantiles(tear0) {
  const tear = Math.round(tear0 * 50) / 50;
  const hit = _q.get(tear);
  if (hit) return hit;
  if (_q.size >= _QMAX) _q.delete(_q.keys().next().value);
  // The sample count and the lattice both matter, and both were wrong. At N = 8192 there are EIGHT
  // points above the 0.1% quantile, which is not an estimate of anything — measured against 400,000
  // fresh samples the sea foamed over 0.050% of itself where Monahan says 0.102%, and 0.92% where he
  // says 1.51%. That is a factor of two at the winds an ordinary day actually reaches, hidden
  // because the ABSOLUTE error is a fraction of a point and the claim was checked in points.
  //
  // The lattice was the other half: one multiplier per axis off the same index walks a LINE through
  // the domain rather than filling it, so the two coordinates are correlated and whole regions of
  // the surface are never sampled at all. This is the R2 low-discrepancy sequence, whose two
  // multipliers come from the plastic constant and are chosen precisely so the pair equidistributes.
  const N = 65536, s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const u = (((i + 1) * 0.7548776662) % 1) * 80 - 40;
    const v = (((i + 1) * 0.5698402910) % 1) * 80 - 40;
    s[i] = seaChop(u, v, 3.0)
         + (tear ? seaFoamFine(u, v, 3.0) + tear * seaFoamTear(u, v, 3.0) : 0);
  }
  s.sort();
  _q.set(tear, s);
  return s;
}
// The `wv` above which exactly `frac` of the surface lies.
export function seaFoamThreshold(kt, tear = SEA_FOAM_TEAR) {
  const frac = whitecapFraction(kt);
  const s = quantiles(tear);
  // ⚠ A FLAT CALM RETURNS A CUT ABOVE THE FIELD'S OWN MAXIMUM, AND THAT MAXIMUM MOVES. It was the
  // literal 1.2, which was above the smooth chop's range and is INSIDE the torn one — the tear widens
  // the field, so a hardcoded ceiling stops being a ceiling and a glass morning grows whitecaps.
  // The gate caught it as a threshold that stopped falling with wind; derived from the samples it
  // cannot drift whatever the tear, the trains or the gains are set to.
  if (frac <= 1e-5) return s[s.length - 1] + 0.01;
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((1 - frac) * s.length)));
  return s[i];
}

// ── AND THERE ARE TWO POPULATIONS OF FOAM, NOT ONE ──────────────────────────────────────────────
//
// Monahan & Lu (1990) name them, and every photograph of a gale shows both: STAGE A is the actively
// breaking crest — about a second of life, dense, bright, thin, lying along the crest — and STAGE B
// is the decaying patch it leaves, which lives five to ten times as long, spreads, dims, and at any
// instant covers between 1.5 and 40 times the area of the active crests.
//
// The mask had one population and one brightness, which is neither of them: a uniform white patch
// with a hard rim. `cap` ramped at x9 from the threshold, so it crossed 0 to 1 within about a tenth
// of the chop's range and nearly every foam pixel saturated — the flat white that reads as a blob.
// SEA_FOAM_A is where the ramp reaches the active core, and the softer ramp below it IS stage B.
export const SEA_FOAM_RAMP = 3.4;        // was 9: the ramp that made every patch a flat white slab
export const SEA_FOAM_A = 0.62;          // fraction of the ramp above which foam is actively breaking


// ⚠ THE STEP IS EXACT, NOT EULER. `S += dt * (target - S) / tau` is wrong by a few per cent every
// time the sky changes, and the whole point of the closed form is that one thirty-minute step and a
// hundred thousand sixteen-millisecond steps land on the same number — which is what would let a
// server seed this the way ground-accum.js seeds the snow.
export function stepSea(state, target, dt) {
  const tau = target > state ? SEA_RISE_S : SEA_FALL_S;
  const k = 1 - Math.exp(-dt / tau);
  return state + (target - state) * k;
}
