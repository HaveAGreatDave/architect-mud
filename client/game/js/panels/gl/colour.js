// sRGB AND LINEAR LIGHT, FOR THE FLOAT TARGET (RENDER_TUNE.glLinear).
//
// Every colour in GLASS is a display value: palettes, textures and uniforms are bytes over 255, and
// the shaders light them, blend them and fog them as if those numbers were light. They aren't. Light
// adds and scales in linear units, and a display value is that light run through the sRGB curve, so
// doing the arithmetic on display values darkens every blend, flattens every falloff and leaves a
// tone curve nothing physical to compress (docs/proposals/glass-materials.md, stage 2).
//
// The move is made in two steps so each can be measured on its own:
//
//   1. Every layer that draws into the float target decodes its OWN OUTPUT to linear, and the HDR
//      composite encodes back to sRGB at the very end. The shading is untouched; what changes is
//      that the blends between layers (premultiplied over, the additive glows) happen in linear.
//   2. A layer at a time, the decode moves from the output to the inputs, so the shading itself
//      runs in linear. A converted layer stops decoding its output (it is already linear).
//
// ⚠ ONLY THE FLOAT TARGET IS EVER LINEAR. The sky pass, the room drawn alone after the world, the
// mirror's 8-bit buffer and every other 8-bit intermediate keep display values: eight bits of linear
// light band visibly in the darks. `LIN.out` is set where a target is bound (context.js) and every
// transformed program reads it at draw time through `applyLinOut`.

// What the frame is drawing into right now: 1 is the linear float target, 0 is anything else.
export const LIN = { out: 0 };

// The exact piecewise sRGB curve, both ways. ⚠ NOT pow(c, 2.2): the straight segment near black is
// where the 2.2 approximation is furthest off, and the darks are most of a night frame. Values over
// 1 (emissive gains, additive glows) take the curve's own continuation, which is monotonic.
export const LINEAR_GLSL = `
uniform float uGlassLinOut;
vec3 glassLin(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 glassSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
// A premultiplied output, decoded when this frame's target is linear: un-premultiply, decode,
// premultiply again, because the curve applies to the colour and not to the coverage. A pure-add
// output with no coverage is decoded as it stands.
vec4 glassOut(vec4 c) {
  if (uGlassLinOut < 0.5) return c;
  return c.a > 0.002 ? vec4(glassLin(c.rgb / c.a) * c.a, c.a) : vec4(glassLin(c.rgb), c.a);
}
// The same for a layer that blends with straight alpha (seabed.js PT_FRAG).
vec4 glassOutStraight(vec4 c) { return uGlassLinOut < 0.5 ? c : vec4(glassLin(c.rgb), c.a); }
`;

// A fragment source with its output decoded to linear when uGlassLinOut is set. The shader's own
// main is renamed and a new main calls it, then converts `out`: every return and discard path in
// the original goes through the one conversion, and with the uniform at 0 the colour is handed
// back untouched. The helpers go in front of the renamed main, after every declaration above it.
export function linearOut(src, out = 'outColor', straight = false) {
  const re = /void\s+main\s*\(\s*(void)?\s*\)/g;
  let m = null, last = null;
  while ((m = re.exec(src))) last = m;
  if (!last) throw new Error('linearOut: no main() in this shader');
  return src.slice(0, last.index) + LINEAR_GLSL + 'void glassMain()' + src.slice(last.index + last[0].length)
    + `\nvoid main() { glassMain(); ${out} = ${straight ? 'glassOutStraight' : 'glassOut'}(${out}); }\n`;
}

// Sends `LIN.out` (or `on`) to the program in use, only when it differs from what that program last
// had. Call it after useProgram. A uniform keeps its value per program, so a program drawn into the
// mirror at 0 and the city at 1 in one frame costs two calls, and a steady frame costs none.
const LOCS = new WeakMap();
export function applyLinOut(gl, prog, on = LIN.out) {
  let e = LOCS.get(prog);
  if (!e) { e = { loc: gl.getUniformLocation(prog, 'uGlassLinOut'), v: -1 }; LOCS.set(prog, e); }
  if (e.loc && e.v !== on) { gl.uniform1f(e.loc, on); e.v = on; }
}

// The JS twin of glassLin, for colours a converted layer uploads as uniforms (stage 2, step 2).
export function linOf(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
export const linRgb = (c) => [linOf(c[0]), linOf(c[1]), linOf(c[2])];
