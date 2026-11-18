// GL CORE · THE TONE CURVE AND THE DISPLAY ENCODE, AS GLSL (docs/proposals/gl-core.md).
//
// One copy of each, interpolated into a shader's source where it's needed. Each renderer used to
// paste its own; a change to the curve then reached one view and not the others.
//
// The linear/sRGB pair for GLASS's float target (glassLin, glassSrgb, glassOut) is in gl/colour.js
// LINEAR_GLSL, which carries its uniform with it.

// Narkowicz's fit of the ACES filmic curve. Cheap, and it's the curve almost every real-time
// renderer means when it says "tonemapped". Clamped to 0..1, so it takes any input.
export const ACES_GLSL = `
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
`;

// The sRGB encode, linear light to display values, for a target that's in 0..1.
export const OETF_GLSL = `
vec3 oetf(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;
