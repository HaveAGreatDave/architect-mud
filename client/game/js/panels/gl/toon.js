// GLASS 2 · THE CEL STEPS, as GLSL every toon shader splices in.
//
// The city mass (context.js), the tents (cloth.js) and the kitchen (kitchen.js) band their light
// with these two functions. They lived as copies in each shader; one changed its edge width and the
// others didn't.
//
// x rounded to the nearest of n even steps, and a hard step at an edge. Each edge is about a pixel
// wide, from the value's own rate of change across the pixel, so a band on a curve is antialiased
// rather than stair-stepped. ⚠ The width has a floor: on a flat face the value doesn't change,
// fwidth is 0, and smoothstep with equal edges is undefined. ⚠ In a shader that can turn the look
// off, call these only behind a uniform branch, for the derivative reason context.js's sunShadow
// gives.
export const TOON_GLSL = `
float toonBands(float x, float n) {
  float y = x * n;
  float w = max(fwidth(y), 1e-4);
  float i = floor(y);
  return (i + smoothstep(0.5 - w, 0.5 + w, y - i)) / n;
}
float toonStep(float edge, float x) {
  float w = max(fwidth(x), 1e-4);
  return smoothstep(edge - w, edge + w, x);
}
`;
