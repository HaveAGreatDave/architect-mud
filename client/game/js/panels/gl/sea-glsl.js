// THE SEA'S SHAPE, IN GLSL — the one copy any shader may include.
//
// ⚠ A SHADER CANNOT IMPORT, SO THIS IS A STRING. `client/shared/sea-swell.js` is the JS original
// and this is its hand-written twin; `scripts/shapes/sea.mjs` reads the coefficients out of both
// and fails when they drift, exactly as `coastwarp.mjs` does for the coast.
//
// ⚠ AND IT EXISTS BECAUSE THERE ARE NOW TWO SHADERS. The floor shades the water and `water.js`
// displaces it, and they have to agree about where every crest is down to the last decimal — a
// mesh standing a few centimetres off the surface the floor is painting is a sea with a seam in
// it. One string, included by both, is the only arrangement in which they cannot disagree. This is
// the `HEIGHT_FOG_GLSL` pattern from fog.js.
//
// The chop is three crossing sine trains phase-modulated by one shared low-frequency sine, so the
// crests wander instead of forming a corrugated diamond lattice. The FM is there instead of a
// noise domain-warp because a warp costs two noise samples on every water texel and tanked the
// frame rate over open sea.
//
// ⚠ THE THREE TRAINS ARE CHOP AND THE FOURTH IS SWELL, AND THE SPLIT IS LOAD-BEARING. The chop's
// wavelengths are 1.09, 1.20 and 0.60 tiles — wind waves of four to eight metres — so it is far
// too fine to put in a vertex grid at any affordable density, and far too short for a hull to ride
// without simply fitting the boat to noise. It is SHADING. The roll is 8.6 tiles, which is about
// sixty metres, and that is the term the mesh displaces and the term a boat rides.
import {
  SEA_SWELL_SIDE, SEA_WIND_SIDE, SEA_SWELL_PEAK, SEA_WIND_PEAK, SEA_SKEW, SEA_ASYM,
  SEA_FOAM_ALONG, SEA_FOAM_FREQ } from '../../../../shared/sea-swell.js';

// ⚠ THE SIDEBANDS ARE GENERATED FROM THE JS TABLE RATHER THAN RETYPED, and that is a change of kind
// rather than of style: the peak trains above are a hand-written twin held to the original by a
// gate, and every one of those gate claims exists because two copies of a number drift. A band of
// six is six more chances, so these are interpolated straight out of 'client/shared/sea-swell.js'
// and cannot disagree with it at all.
const f = (n) => n.toFixed(6);
const band = (T, ph) => 'h += seaStokes(p.x * ' + f(T.ku) + ' + p.y * ' + f(T.kv) + ' + t * ' + f(T.w)
  + (ph ? ' + ph * ' + f(T.pm) : '') + ', ' + f(T.k) + ', A * ' + f(T.a) + ' * sp);';
// d/du and d/dv of one sideband's Stokes term, which is the peak's own chain rule with the band's
// own amplitude — see the note in client/shared/sea-swell.js about why it may not borrow the peak's.
const bandSlope = (T, ph) => {
  const th = 'p.x * ' + f(T.ku) + ' + p.y * ' + f(T.kv) + ' + t * ' + f(T.w) + (ph ? ' + ph * ' + f(T.pm) : '');
  const a = ph ? 'windA' : 'rollA';
  return 'float aS = ' + a + ' * ' + f(T.a) + ' * sp;\n'
    + '    float thS = ' + th + ';\n'
    + '    float cS = seaStokesD(thS, ' + f(T.k) + ', aS);\n'
    + '    du += cS * (' + f(T.ku) + (ph ? ' + ' + f(T.pm * 0.6) + ' * cA' : '') + ');\n'
    + '    dv += cS * (' + f(T.kv) + (ph ? ' - ' + f(T.pm * 0.45) + ' * cA' : '') + ');';
};
export const SEA_GLSL = `
float seaPh(vec2 p, float t) {
  return sin(p.x * 0.6 - p.y * 0.45 + t * 0.25);
}
float seaChop(vec2 p, float t, float ph) {
  return 0.5  * sin(p.x * 5.6 + p.y * 1.3 + t * 0.9  + ph * 1.6)
       + 0.4  * sin((p.x - p.y) * 3.7    - t * 0.66 + ph * 1.1)
       + 0.11 * sin((p.x + p.y) * 7.4    + t * 1.25 + ph * 0.7);
}
// ── THE TEAR IN THE FOAM ────────────────────────────────────────────────────────────────────────
//
// The twin of 'seaFoamTear' in client/shared/sea-swell.js, and it must stay the twin: the whitecap
// threshold is the QUANTILE OF THIS FIELD, inverted in JS at module load against Monahan's observed
// coverage, so a shader testing a different field than the one that was quantiled foams over the
// wrong fraction of the sea — silently, and with the gate green, because the gate checks the
// threshold and not the pixels.
//
// ⚠ EVERY CONSTANT IS INTERPOLATED, never retyped, for the sidebands' own stated reason.
//
// ⚠ AND IT IS STRETCHED ALONG THE CREST BY THE CALLER, not here. A wave breaks along the LENGTH of
// its crest, so a whitecap is a streak across the line of travel rather than a disc; the caller
// hands in coordinates already resolved into the crest frame. That stretch is invisible to the
// quantiler — rotating and scaling a stationary field changes its correlation lengths and leaves
// its marginal distribution exactly where it was — which is why the threshold stays valid.
float seaFoamTear(vec2 p, float t) {
  vec2 q = vec2(p.x * ${f(SEA_FOAM_FREQ)}, p.y * ${f(SEA_FOAM_FREQ)} + t * 0.13);
  float a = sin(q.x + sin(q.y * 1.31));
  q = vec2(q.x * 2.17 + a * 1.7, q.y * 2.17 - a * 1.1);
  float b = sin(q.x * 0.93 + sin(q.y * 0.87));
  q = vec2(q.x * 2.31 + b * 1.3, q.y * 2.31 + b * 0.9);
  float c = sin(q.x * 0.89 + sin(q.y * 1.13));
  return a * 0.5 + b * 0.32 + c * 0.18;
}
// The tear resolved into the crest frame and scaled: 'wd' is where the wind is going, so the crest
// runs across it. 'amt' is the live tear gain, 0 putting back the smooth threshold exactly.
// The twin of 'seaFoamFine'. Added to the FOAM TEST only — never to the surface, which cannot
// resolve a wave this short and must not be lit as though it could.
float seaFoamFine(vec2 p, float t) {
  return 0.34 * sin(p.x * 22.6 + p.y * 10.4 + t * 1.88)
       + 0.22 * sin(p.x * -13.1 + p.y * 31.8 - t * 2.31);
}
float seaFoamTorn(vec2 p, float t, vec2 wd, float amt) {
  if (amt <= 0.0) return 0.0;
  vec2 cr = vec2(-wd.y, wd.x);                       // along the crest
  vec2 q = vec2(dot(p, wd), dot(p, cr) / ${f(SEA_FOAM_ALONG)});
  return amt * seaFoamTear(q, t);
}
// ⚠ STOKES, NOT AIRY, AND IT IS THE WHOLE DIFFERENCE BETWEEN A MOVING SEA AND AN ANGRY ONE. A
// linear wave is a sinusoid — crest and trough mirror images — which is true only as steepness goes
// to zero and is why a big sine swell reads as placid however tall it is. The second-order term at
// twice the frequency sharpens the crest and flattens the trough. Written in sine the correction is
// MINUS a half-kA cosine, and that sign is not free: backwards, it flattens the crests and digs out
// the troughs, which looks like a soft sea rather than like a mistake.
// Measured: this takes the surface's skewness from 0 to +0.20, and real wind seas run +0.1 to +0.3.
// ⚠ THE GAINS ARE INTERPOLATED FROM THE JS TABLE, never retyped — the sidebands already are, for the
// reason that every "two copies of a number" claim in sea.mjs exists. Skewness rides cos(2th) and
// asymmetry rides sin(2th): the same harmonic in quadrature, so the forward pitch costs one sine.
float seaStokes(float th, float k, float A) {
  float e = 0.5 * (k * A);
  return A * (sin(th) - ${f(SEA_SKEW)} * e * cos(2.0 * th) + ${f(SEA_ASYM)} * e * sin(2.0 * th));
}
// d/dth of the above. ⚠ ONE DERIVATIVE FOR ONE HEIGHT FUNCTION — it was written out at three call
// sites here and four in the JS, which is seven chances for the lighting to describe a surface the
// geometry is not drawing.
float seaStokesD(float th, float k, float A) {
  return A * (cos(th) + ${f(SEA_SKEW)} * k * A * sin(2.0 * th) + ${f(SEA_ASYM)} * k * A * cos(2.0 * th));
}
// ── SHOALING: CRESTS TURN TO FACE THE BEACH ───────────────────────────────────────────────────
//
// Waves slow down as the water shallows (c = sqrt(g*d)), so the end of a crest that reaches the
// shallows first falls behind and the whole crest swings round until it is parallel with the shore.
// It is why surf arrives square on to a beach whatever direction the wind is blowing from.
//
// ⚠ IT IS A DOMAIN WARP AND NOT A ROTATED WAVEVECTOR, WHICH IS THE ONLY REASON IT IS EXPRESSIBLE
// HERE AT ALL. The obvious way to write refraction is to turn each train's k toward the shore
// normal — and the phase of a plane wave is k.x, so the moment k varies with position the honest
// phase is the integral of k along the ray and k.x is no longer a wave: crests stop joining up.
// Warping the SAMPLING POSITION instead keeps a genuine scalar phase field — the crests are level
// sets of a real function of position — and turning out falls out of it: with p' = p + t*g(d), the
// phase k.u.p' has an effective wavevector of k*u + k*(u.t)*grad(g), so a train running obliquely
// (u.t nonzero) picks up exactly the shoreward component refraction says it should, and one already
// square on to the beach (u.t zero) is left alone.
//
// ⚠ A WARP OF THE PLANE ONTO ITSELF HAS TO BE INJECTIVE OR IT IS A FOLD, and this codebase has
// already shipped that bug once: 'coastWarp' was a sine per axis whose Jacobian determinant went
// to -2.13, and what a fold draws is a CUSP — it put a row of sharp corners along every shoreline
// at the sine's own period and rendered a pond as a starburst. Here the displacement is along the
// shore tangent and its magnitude only ever grows over the shoal band, so the Jacobian is
// I + t (x) grad(g) and stays invertible while |grad g| < 1 — which at the shipping strength over a
// band a few tiles wide is about 0.2.
//
// ⚠ AND THE SLOPE IS TAKEN IN THE WARPED FRAME, WHICH IS AN APPROXIMATION AND IS STATED RATHER THAN
// HIDDEN. The true gradient is the warped one carried back through that Jacobian; this uses the
// warped one directly, so the lighting is off by order |grad g| — about a fifth, tangentially,
// inside the shoal band only, and zero everywhere else. Carrying it properly needs second
// derivatives of the tile grid, which is a noisy thing to ask a texture for.
vec2 seaShoal(vec2 p, float waterW, vec2 gradW, float amt) {
  if (amt <= 0.0) return p;
  float L = length(gradW);
  if (L < 1e-5) return p;
  // 0 in open water, 1 at the waterline. Squared so the band has a soft outer edge and the turn
  // happens where the water is genuinely shallow rather than across the whole bay.
  float shal = clamp(1.0 - waterW, 0.0, 1.0);
  vec2 n = gradW / L;                 // waterW rises seaward, so this points away from the land
  vec2 t = vec2(-n.y, n.x);           // along the shore
  return p + t * (amt * shal * shal);
}
float seaRoll(vec2 p, float t, float A, float sp) {
  float h = seaStokes(p.x * 0.2090 + p.y * 0.1280 + t * 0.18, 0.2451, A * (1.0 - ${f(1 - SEA_SWELL_PEAK)} * sp));
  ${SEA_SWELL_SIDE.map((T) => band(T, false)).join('\n  ')}
  return h;
}
// The wind sea: 3.2 tiles, steep, and the train that makes a storm look like one. Its speed is
// omega = sqrt(g·k) against the roll's, not a chosen number — see client/shared/sea-swell.js.
float seaWind(vec2 p, float t, float ph, float A, float sp) {
  float h = seaStokes(p.x * 0.5030 + p.y * 0.3895 + t * 0.29 + ph * 0.9, 0.6362, A * (1.0 - ${f(1 - SEA_WIND_PEAK)} * sp));
  ${SEA_WIND_SIDE.map((T) => band(T, true)).join('\n  ')}
  return h;
}
// ── WHAT A HULL DOES TO THE WATER ─────────────────────────────────────────────────────────────
//
// A boat is not a decal on the sea: it pushes a crest up in front of itself, drags a trough along
// behind, and throws two diverging arms out sideways. Given a source at 'c' heading 'd' (a unit
// vector) at speed 'spd' with beam 'bw', this is the displacement it puts on the point 'p'.
//
// ⚠ IT IS A DISPLACEMENT, NOT A TEXTURE, which is the whole difference between this and the foam
// that has always been painted behind the Echelon. The foam said a wake was there; this makes the
// surface actually lower behind her, so the wake OCCLUDES, catches light on its own walls, and a
// second boat crossing it rides over it.
//
// ⚠ THE ARMS OPEN AT 19.5 DEGREES AND THAT IS NOT A STYLE CHOICE. The Kelvin wedge is a constant of
// deep water — half-angle arcsin(1/3) — and it does not depend on how fast the boat is going, only
// on how big the wake is. A wedge that widened with speed is the single most common way a wake is
// drawn wrong, and it reads as the boat skidding.
float seaWake(vec2 p, vec2 c, vec2 d, float spd, float bw) {
  if (spd <= 0.001) return 0.0;
  vec2 rel = p - c;
  float s = dot(rel, d);              // along track; negative is astern
  float n = dot(rel, vec2(-d.y, d.x));  // across track
  float an = abs(n);

  // How far astern the wake survives. A real one runs for ever; this fades over a few hull lengths
  // so the uniform budget is bounded and the far field is not a permanent scar.
  float reach = 6.0 + 14.0 * spd;
  float fade = clamp(1.0 + s / reach, 0.0, 1.0);
  fade *= fade;

  float h = 0.0;

  // The trough: astern, centred on the track, widening as it goes. This is the hollow the hull
  // leaves behind it and it is the part that reads at any distance.
  if (s < 0.0) {
    float w = bw * 0.9 + (-s) * 0.16;
    float t = n / max(0.05, w);
    h -= exp(-t * t) * fade * (0.55 + 0.45 * spd);
  }

  // The bow wave: a crest standing just ahead of the stem and pushed out to either side of it.
  float bs = (s - bw * 0.35) / (bw * 1.2 + 0.25);
  float bn = an / (bw * 1.6 + 0.3);
  h += exp(-bs * bs - bn * bn) * (0.6 + 0.9 * spd);

  // The diverging arms, on the Kelvin wedge. A ridge either side, strongest near the boat.
  float arm = an - (-s) * 0.3639;     // tan(19.5 degrees)
  float aw = bw * 1.1 + (-s) * 0.06;
  float ar = arm / max(0.06, aw);
  if (s < 0.0) h += exp(-ar * ar) * fade * (0.45 + 0.75 * spd);

  return h;
}

// The slope of (chop * amp + roll * rollA + wind * windA), in closed form.
//
// ⚠ NEVER RECOVER THESE COSINES AS sqrt(1 - sin^2) — it throws the sign away, and a sign error
// here puts the highlight on the wrong face of every crest, which still looks exactly like water.
// The chain-rule constants are pm * 0.6 on x and pm * 0.45 on y, the y ones negative because the
// shared phase term's own y wavenumber is.
vec2 seaSlope(vec2 p, float t, float ph, float amp, float rollA, float windA, float sp) {
  float cA = cos(p.x * 0.6 - p.y * 0.45 + t * 0.25);
  float c1 = cos(p.x * 5.6 + p.y * 1.3 + t * 0.9  + ph * 1.6);
  float c2 = cos((p.x - p.y) * 3.7    - t * 0.66 + ph * 1.1);
  float c3 = cos((p.x + p.y) * 7.4    + t * 1.25 + ph * 0.7);
  // ⚠ THE STOKES TERM IS IN THE SLOPE TOO: d/dth of A(sin th - (kA/2)cos 2th) is
  // A(cos th + kA·sin 2th). Leave the second half out and the LIGHTING describes a sinusoid while
  // the GEOMETRY is a Stokes wave, so every sharpened crest carries its highlight slightly off —
  // a small error everywhere rather than a big one somewhere, which is the hardest kind to see.
  float thR = p.x * 0.2090 + p.y * 0.1280 + t * 0.18;
  float thW = p.x * 0.5030 + p.y * 0.3895 + t * 0.29 + ph * 0.9;
  float pkR = rollA * (1.0 - ${f(1 - SEA_SWELL_PEAK)} * sp);
  float pkW = windA * (1.0 - ${f(1 - SEA_WIND_PEAK)} * sp);
  float cR = seaStokesD(thR, 0.2451, pkR);
  float cW = seaStokesD(thW, 0.6362, pkW);
  float du = (0.5 * c1 * (5.6 + 0.960 * cA) + 0.4 * c2 * ( 3.7 + 0.660 * cA) + 0.11 * c3 * (7.4 + 0.420 * cA)) * amp + cR * 0.2090 + cW * (0.5030 + 0.540 * cA);
  float dv = (0.5 * c1 * (1.3 - 0.720 * cA) + 0.4 * c2 * (-3.7 - 0.495 * cA) + 0.11 * c3 * (7.4 - 0.315 * cA)) * amp + cR * 0.1280 + cW * (0.3895 - 0.405 * cA);
  ${SEA_SWELL_SIDE.map((T) => '{ ' + bandSlope(T, false) + ' }').join('\n  ')}
  ${SEA_WIND_SIDE.map((T) => '{ ' + bandSlope(T, true) + ' }').join('\n  ')}
  return vec2(du, dv);
}

// ── THE CITY LYING ON THE WATER ────────────────────────────────────────────────────────────────
//
// A planar mirror gives the GEOMETRY of a reflection and on a choppy sea it gives very little of
// the look: measured under a full neon skyline it moved 0.7% of the frame at a peak of 15/255,
// against the same mirror moving 20.1% of a wet road. What actually reads as a harbour at night is
// the long broken STREAK a point source draws down the water toward you, and until now nothing in
// this renderer drew one — the per-light smear in floor.js is gated on 'uWet' and 'pavedW', which
// is to say on RAIN, on TARMAC, and over a clear-night bay both are zero.
//
// ⚠ IT IS NOT THE TARMAC SMEAR WITH A DIFFERENT GATE. That one is two hand-fitted Gaussians in the
// eye frame with a length somebody chose. A sea has a measured answer: the size and shape of a
// glitter pattern is the PROBABILITY that a patch of surface happens to be tilted far enough to
// bounce that light into your eye, so it is the slope distribution of the water and nothing else.
//
// ⚠ AND THE DISTRIBUTION IS THE ONE FROM THE SUN-GLITTER PHOTOGRAPHS (Cox & Munk 1954, JOSA 44:838
// — they flew over the Pacific, photographed the sun's glitter and inverted its shape to get the
// slope statistics, which is this calculation run backwards). Near-Gaussian, and ANISOTROPIC:
// rougher along the wind than across it, which is what makes a real glitter path an ellipse
// stretched downwind rather than a circle.
//
//     sigma_u^2 (along wind)  = 3.16e-3 * U
//     sigma_c^2 (across wind) = 3.0e-3 + 1.92e-3 * U        U in m/s
//
// ⚠ THE WIND IS ALREADY INTEGRATED — 'SEA_STATE' is driven off knots through a reservoir — so the
// streak lengthens as the sea gets up with nothing authored and no second knob: a glass harbour
// gives a tight bright reflection and a gale gives a long dim smear, by arithmetic.
//
// ⚠ AND USING THE REAL OCEAN'S VARIANCE IS CORRECT RATHER THAN OPTIMISTIC, which is the argument
// worth keeping. Cox & Munk measured EVERYTHING, down to the capillary ripples — and the capillary
// ripples are precisely what this renderer does not carry: the mesh resolves the roll, the fragment
// normal carries the chop, and below that there is nothing. A statistical glitter model is how the
// unresolved half of the spectrum is meant to be represented, so the right variance to use is the
// whole sea's, not the part we happen to draw.
//
// ⚠ THE FLOOR IS 0.003 AND IT IS LOAD-BEARING. That is Cox & Munk's clean-surface intercept, and it
// is what stops a dead calm dividing by zero: the peak of a normalised Gaussian goes as 1/(su*sc),
// so a sea with no slope in it is a mirror of infinite brightness and one pixel across.
//
// ⚠ AND IT IS NORMALISED AGAINST A REFERENCE ROUGHNESS RATHER THAN IN ABSOLUTE UNITS. Energy
// conservation is the reason the streak dims as it lengthens and that behaviour is wanted; what is
// not wanted is a gain whose meaning changes every time the sea state does. At SEA_SIG_REF the peak
// is 1, calmer is brighter and tighter, rougher is broader and dimmer.
float seaGlitter(vec2 here, vec2 eyeA, float eyeH, vec3 lp, vec2 windDir, float sig2u, float sig2c) {
  // The direction a facet here would have to face to put that light in your eye: the half-vector of
  // the two unit directions, and the slope it implies. ⚠ THE LIGHT'S HEIGHT IS THE WHOLE STREAK —
  // a sign three storeys up throws a long way down the water and a kerb lamp barely off its own
  // reflection, and that falls out of this rather than being a length somebody picked.
  vec3 v = normalize(vec3(eyeA - here, eyeH));
  vec3 l = normalize(vec3(lp.xy - here, lp.z));
  vec3 hv = v + l;
  float hz = max(hv.z, 1e-3);
  vec2 sl = -hv.xy / hz;
  // Into the wind frame, where the two variances differ.
  float su = dot(sl, windDir);
  float sc = dot(sl, vec2(-windDir.y, windDir.x));
  float e = exp(-0.5 * (su * su / sig2u + sc * sc / sig2c));
  // ⚠ AND THE 1/cos^4 OF THE FACET TILT IS DELIBERATELY LEFT OUT. It is the projection of the facet
  // area onto the horizontal and it is within a few per cent of 1 over the slopes that carry any
  // brightness at all; carrying it would cost a pow and move nothing.
  return e * (0.012000 / sqrt(sig2u * sig2c));
}
`;
