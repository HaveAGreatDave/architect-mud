// HOW THICK THE AIR IS DOWN HERE.
//
// GLASS has had distance fog since the N64 band: a term in the forward distance alone, so every
// surface the same distance away recedes by the same amount whether it is a kerbstone or the crown
// of a tower. That is a fine model for a haze at altitude and it is the wrong one for a basin city
// at street level, where what actually happens is that the air near the ground holds the water and
// the smoke and the air two hundred feet up does not. A tower standing in morning mist is soft at
// its feet and sharp at its parapet, and no amount of distance fog can say that, because the two
// ends of it are the same distance away.
//
// This is the missing axis. Density falls off exponentially with height — the standard atmospheric
// profile, and the one a city's own smoke and river damp actually follow — and what a fragment
// needs is the INTEGRAL of that density along the ray from the eye to it.
//
// ⚠ THE INTEGRAL IS ANALYTIC AND THAT IS THE WHOLE REASON THIS IS AFFORDABLE. Nothing is marched.
// For a ray running from z0 to z1 over a distance d through density exp(-z/H):
//
//     optical depth = d · H/(z1-z0) · (exp(-z0/H) - exp(-z1/H))
//
// which is two exponentials and a divide, per fragment, with no loop and no second buffer.
//
// ⚠ AND IT IS ONE FUNCTION IN ONE FILE BECAUSE THREE SHADERS DRAW GROUND. The floor takes the open
// terrain, the ground pass takes the streets and the mass takes the buildings standing on them —
// the same split `uSnow` is written around, for the same reason — and a road that disagrees with
// the wall beside it about how far you can see is worse than no fog at all. Three copies of this
// arithmetic would be three chances to retune two of them.
//
// ⚠ THE GROUND SHADERS ARE THE DEGENERATE CASE, NOT A DIFFERENT ONE. Every fragment the floor and
// the ground pass draw is at z = 0, so for them this collapses to a function of the eye height and
// the distance — which is worth knowing when reading it, and is NOT worth writing a second, simpler
// version of: the moment the two expressions differ by a constant the kerb stops matching the wall.
export const HEIGHT_FOG_GLSL = `
// Fraction of a surface hidden by the air between it and the eye. 0 is perfectly clear.
// 'dens' is per tile at ground level and 'sH' is the height in tiles the density falls by 1/e over.
float heightFog(float eyeZ, float fragZ, float dist, float dens, float sH) {
  if (dens <= 0.0) return 0.0;
  // ⚠ CLAMPED AT THE GROUND. A basement floor, a sunken forecourt or a camera below datum would
  // otherwise read as DENSER than the street, which is a fog bank in a hole nobody can see into.
  float z0 = max(eyeZ, 0.0), z1 = max(fragZ, 0.0);
  float e0 = exp(-z0 / sH), e1 = exp(-z1 / sH);
  float dz = z1 - z0;
  // The mean density along the ray. ⚠ Both branches are POSITIVE — looking up, (e0-e1) and dz are
  // both positive; looking down, both are negative — so this never hands back a negative depth.
  // The guard is for a ray that is level, where the expression is 0/0 and the answer is simply the
  // density at that one height.
  float avg = abs(dz) < 1e-4 ? e0 : (e0 - e1) * sH / dz;
  return 1.0 - exp(-dens * dist * avg);
}
`;

// How far up the density falls by 1/e, in tiles. A storey in GLASS is FLOOR_Z x bldgH x bldgStretch
// ~= 0.196 tiles, so this is about two and a half storeys: thick along a street, thinning through
// the first few floors, and effectively gone by the time a tower is tall enough to have a name.
//
// ⚠ IT IS NOT A PLAYER KNOB AND SHOULD NOT BECOME ONE. The STRENGTH is the thing worth a slider,
// and a second number here multiplies into it to make one that means neither — the argument already
// recorded beside the bloom threshold.
export const FOG_H_SCALE = 0.5;

// ── AND WHAT THE AIR DOES WITH A LIGHT IN IT ────────────────────────────────────────────────────
//
// Fog with nothing in it is grey. What makes a lit city in weather look the way it does is the
// other half: a lamp, a sign or a headlight throws a CONE, because the water in the air between it
// and you scatters some of its light back along your line of sight. GLASS has never had that, which
// is measurably why height fog at night moved 0.02% of a frame — the fog colour after dark is a
// near-black horizon band mixed into a near-black city, and the only thing that can make it read is
// light landing IN it.
//
// ⚠ IT IS AN INTEGRAL ALONG THE VIEW RAY AND IT IS ALSO ANALYTIC. The in-scattered amount from a
// point source falling off as 1/r² over a ray passing it at perpendicular distance dp is
//
//     ∫ dt / (dp² + t²) = (1/dp)·[ atan(t/dp) ]
//
// evaluated over the segment the eye can actually see — so it is two atans and a divide per light,
// with no march, no shadow volume and no second buffer. The shape that falls out is the right one:
// it peaks where the ray passes closest to the lamp and falls away smoothly to either side, which
// is a cone seen edge-on.
//
// ⚠ AND IT IS ADDED, NEVER MIXED. The fog above REPLACES a surface with the colour of the air in
// front of it; this is light arriving from the side that was never part of the surface at all. Mixed
// in, a bright shaft would have to take something away from the thing behind it, which is exactly
// backwards — you can see a searchlight beam against a black sky.
export const LIGHT_SHAFT_GLSL = `
// In-scattered light from ONE source along the ray from the eye to a surface, as a multiplier on
// that source's own colour. 'reach' is the light's radius in tiles; 'dens' and 'sH' are the medium.
float lightShaft(vec3 eye, vec3 P, vec3 Q, float reach, float dens, float sH) {
  if (dens <= 0.0) return 0.0;
  vec3 d = P - eye;
  float L = length(d);
  if (L < 1e-4) return 0.0;
  vec3 V = d / L;
  // How far along the ray the light is at its closest, clamped to the part of the ray you can see:
  // past the surface is behind a wall, and behind the eye is behind you.
  float tc = clamp(dot(Q - eye, V), 0.0, L);
  // ⚠ FLOORED. The integral goes to infinity as the ray passes exactly through the lamp, which on
  // screen is one pixel of pure white in the middle of an otherwise soft cone.
  float dp = max(length(Q - (eye + V * tc)), 0.03);
  float integ = (atan((L - tc) / dp) + atan(tc / dp)) / dp;
  // ⚠ THE MEDIUM IS SAMPLED AT THE LIGHT'S OWN HEIGHT, which is what keeps this a STREET effect. A
  // lamp standing in the thick air over a road throws a cone; a beacon on a mast three hundred feet
  // up is in air this profile says is clear, and throws nothing.
  return integ * reach * dens * exp(-max(Q.z, 0.0) / sH);
}
`;
