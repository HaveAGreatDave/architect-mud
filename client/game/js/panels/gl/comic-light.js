// GLASS 2 · COMIC LIGHT: dramatic comic-book shading that still reads as light on a form.
//
// The first comic look stepped the light against every surface's own normal, so a nose, a fold
// or a muscle each threw its own hard shadow, and an ink line round every one of them: blotchy,
// and too much. A comic artist puts one clean shadow shape on each big form and lets the small
// ones show faintly inside it. So:
//
//   · LIT OR IN SHADOW is decided by the FORM normal (figure.js formNormals: the part's normals
//     diffused until only the head's egg and a limb's cylinder are left), past a slight wrap, with
//     a terminator kept crisp and antialiased at a pixel or so whatever the distance;
//   · the shadow is a value, not a void: about half the light, shifted toward the painted shade
//     colour (gl/house-style.js HOUSE.shade), darkest in a core just past the terminator and
//     lifted again on the far side by light bounced back off the room;
//   · the small forms come back from the surface's own normal as a gentle modulation inside
//     either tone, never as a tone change;
//   · a thin rim lifts a silhouette edge in shadow off what's behind it.
//
// `comicTone` returns the colour before any finish. `lightC` is the key's light as it falls on a
// surface square to it (the caller's own light model, so the tone still follows a lamp or the
// hour), `amb` the bounce round the room, `key` the direction to the key light.
export const COMIC = Object.freeze({
  wrap: -0.12,       // the terminator, in N.L of the form normal: a little past side-on
  edge: 0.012,       // its least half-width in N.L, widened to about a pixel by fwidth
  lit: 0.9,          // the lit tone, of the key's light
  shadow: 0.5,       // the shadow tone, of the key's light
  tint: 0.6,         // how far the shadow moves toward the painted shade colour
  core: 0.16,        // how much darker the core is, just past the terminator
  bounce: 0.14,      // and how much the far side is lifted back
  detail: 0.35,      // how much the small forms move the light inside a tone
  rim: 0.22,         // the rim in shadow, of the key's light
});

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
// comicStep(d): the terminator alone, 0 in shadow and 1 lit, for a view that sums several lights
// (the park's lamp banks, the room's lamp and window). comicShadeK(d): the core and the bounce, to
// multiply a shadow by. comicKey: the whole tone under one key light with no light model of its
// own (the rink's banks), the lit side the colour as given. All three only behind a uniform branch
// or in straight-line code, for fwidth.
export const COMIC_LIGHT_GLSL = `
float comicStep(float d) { float w = max(fwidth(d) * 0.75, ${f(COMIC.edge)}); return smoothstep(${f(COMIC.wrap)} - w, ${f(COMIC.wrap)} + w, d); }
float comicShadeK(float d) {
  return (1.0 - ${f(COMIC.core)} * smoothstep(${f(COMIC.wrap)}, ${f(COMIC.wrap)} - 0.12, d) * (1.0 - smoothstep(-0.45, -0.85, d))) * (1.0 + ${f(COMIC.bounce)} * smoothstep(-0.5, -0.95, d));
}
vec3 comicKey(vec3 rgb, vec3 N, vec3 V, vec3 L, float specK, vec3 shade) {
  float d = dot(N, L), lit = comicStep(d);
  float rim = smoothstep(0.62, 0.86, 1.0 - max(dot(N, V), 0.0)) * (1.0 - lit);
  vec3 shC = rgb * mix(vec3(1.0), shade, ${f(COMIC.tint)}) * (${f(COMIC.shadow / COMIC.lit)}) * comicShadeK(d) + rgb * ${f(COMIC.rim)} * rim;
  float hi = step(0.75, pow(max(dot(N, normalize(L + V)), 0.0), 32.0)) * specK * lit;
  return mix(shC, rgb, lit) + vec3(hi);
}
vec3 comicTone(vec3 base, vec3 nf, vec3 n, vec3 v, vec3 key, vec3 lightC, vec3 amb, vec3 shade, out float lit) {
  float kf = dot(nf, key);
  float w = max(fwidth(kf) * 0.75, ${f(COMIC.edge)});
  lit = smoothstep(${f(COMIC.wrap)} - w, ${f(COMIC.wrap)} + w, kf);
  float det = 1.0 + ${f(COMIC.detail)} * clamp(dot(n, key) - kf, -0.3, 0.3);
  float core = 1.0 - ${f(COMIC.core)} * smoothstep(${f(COMIC.wrap)}, ${f(COMIC.wrap)} - 0.12, kf) * (1.0 - smoothstep(-0.45, -0.85, kf));
  float bounce = 1.0 + ${f(COMIC.bounce)} * smoothstep(-0.5, -0.95, kf);
  float rim = smoothstep(0.62, 0.86, 1.0 - max(dot(n, v), 0.0)) * (1.0 - lit);
  vec3 litC = base * (amb + lightC * ${f(COMIC.lit)}) * det;
  vec3 shC = base * mix(vec3(1.0), shade, ${f(COMIC.tint)}) * (amb + lightC * ${f(COMIC.shadow)}) * core * bounce * det + base * lightC * ${f(COMIC.rim)} * rim;
  return mix(shC, litC, lit);
}`;
