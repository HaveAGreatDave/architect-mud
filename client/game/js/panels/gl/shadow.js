// THE SUN, ON THE DEPTH BUFFER.
// GLASS's only building shadow is 'drawBuildingShadow': footprint hull plus roof cast, flat on
// z = 0. Nothing shades a neighbour's wall or itself, a setback casts nothing below, and past
// 'shadowFar' there's nothing. Here the static mass buffer is drawn once more from the light into a
// depth texture, and the shader does one comparison per fragment.
// ⚠ IT IS ADDITIVE: the ground hulls stay, and this covers only walls and roofs, which had no
// shadow to contradict. Both read the same sun: 'lightMatrix' in camera.js derives the direction
// from 'dir' and 'len', not an elevation, so wall and ground shadows point the same way.
// ⚠ IT IS NOT FINISHED, AND RENDER_TUNE.glShadow DEFAULTS TO 0. Geometry, depth pass, night gate and
// untouched ground measure correctly, but the term in context.js ignores its strength, so it lands
// as a mask. What's been ruled out is on RENDER_TUNE.glShadow in windshield.js; test with
// npm run gl:shadow (headless, against drawBuildingShadow's sun) and __glShadow() in the Modelshop.
// Nothing below is dead code; it all runs once the knob leaves 0.
// ⚠ EVERY EXIT RETURNS null: a failed framebuffer, texture or program would sample undefined, a
// shadow everywhere. The caller then runs strength 0, a comparison multiplying by exactly 1.0.

// The map is square and its size is fixed rather than tracking the window, because the window
// changes with the seat and a texture that resized would reallocate on every seat change. 2048 is
// the WebGL2 guaranteed floor for MAX_TEXTURE_SIZE, so it fits everywhere; over a cab's 33-tile
// window that is 62 texels a tile and over an aeroplane's 73 it is 28.
import { compileShader } from './programs.js';

export const SHADOW_SIZE = 2048;

// ⚠ THE BIAS IS IN WORLD UNITS AND CONVERTED HERE, NOT WRITTEN INTO THE SHADER. The ortho box is
// fitted to whatever the mesh happens to span, so its depth range is about 25 tiles from a cab and
// about 60 from a cockpit — a constant bias in clip units is therefore two different distances in
// the two seats, and the value that stops acne in one puts a building's shadow a foot away from it
// in the other. Tenths of a tile is the quantity that means something about a city.
export const SHADOW_BIAS_TILES = 0.035;

const VERT = `#version 300 es
in vec3 aPos;
uniform mat4 uLightVP;
void main() { gl_Position = uLightVP * vec4(aPos, 1.0); }`;

// Depth-only: there is no colour attachment, so the fragment shader exists purely because GLSL
// requires one. An empty main is what a depth pass wants.
const FRAG = `#version 300 es
precision mediump float;
void main() { }`;


// `posLoc` is the attribute location the MASS program uses for aPos. It has to be forced to match,
// because a VAO records its pointers against LOCATIONS, not names — and this layer deliberately
// draws the mass program's own VAO rather than building a second copy of the city. Let the linker
// choose and the two agree by luck on a one-attribute program, which is exactly the kind of luck
// that holds until somebody adds an attribute.
export function createShadowLayer(gl, posLoc, size = SHADOW_SIZE) {
  const dim = Math.min(size, gl.getParameter(gl.MAX_TEXTURE_SIZE) || size);

  const prog = gl.createProgram();
  let vs, fs;
  try {
    vs = compileShader(gl, gl.VERTEX_SHADER, VERT, 'shadow vertex');
    fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG, 'shadow fragment');
  } catch { return null; }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, posLoc, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  const uLightVP = gl.getUniformLocation(prog, 'uLightVP');
  if (!uLightVP) return null;

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, dim, dim, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  // ⚠ A PLAIN DEPTH READ AND NEAREST, NOT THE HARDWARE COMPARE SAMPLER. COMPARE_REF_TO_TEXTURE
  // with a sampler2DShadow is the textbook way to do this — the comparison runs in the sampler and
  // the RESULT is filtered, so one tap is already a 2x2 average — and it is what this was written
  // with. Through ANGLE on D3D11 it came back with the comparison saturated: the same fully
  // shadowed city at strength 0.35 and at 1.0, bit for bit, which is not a shading value at all.
  // A plain depth texture read and an explicit compare in the shader is the conservative path that
  // every driver implements the same way; the cost is doing the percentage-closer average by hand,
  // which is three extra taps and no extra state.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // ⚠ CLAMP TO EDGE WOULD SMEAR THE BORDER TEXEL ACROSS EVERYTHING OUTSIDE THE BOX. The ortho box
  // holds every caster, but a fragment being SHADED can sit outside it — the floor stretches past
  // the last building, and a contact or a cloud can be anywhere. The shader rejects out-of-range
  // coordinates itself, so this only decides what a coordinate a hair outside samples; edge clamp
  // there means the nearest building's depth, which paints a stripe of its shadow to the horizon.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  // ⚠ NO COLOUR ATTACHMENT, SO THE DRAW AND READ BUFFERS HAVE TO BE SAID TO BE NONE. A framebuffer
  // whose draw buffer points at a colour attachment that is not there is INCOMPLETE, and an
  // incomplete framebuffer fails the whole pass with no error anybody sees.
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) { gl.deleteFramebuffer(fbo); gl.deleteTexture(tex); return null; }

  // Draw the mass, from the sun, into depth. `vao` and `count` are the mass program's own — this
  // layer owns no geometry at all, which is what makes it impossible for the shadow to be cast by
  // a different city from the one being drawn.
  function render(vao, count, lightVP) {
    if (!count) return 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, dim, dim);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    // ⚠ NO BACKFACE CULL HERE EITHER, AND IT COSTS A BIAS. Rendering only back faces into the map
    // is the usual cure for shadow acne and it needs closed solids; GLASS's buildings are not
    // closed — a wall with no back, a canopy underside, a soffit — so culling would drop exactly
    // the surfaces a cab looks up at and let light through the roof of a shed. The depth offset
    // below does the same job without assuming anything about the geometry.
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    // Slope-scaled: a face nearly edge-on to the light spans many texels of depth inside one texel
    // of the map, and that is the case a constant offset cannot cover.
    gl.polygonOffset(2.0, 3.0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uLightVP, false, lightVP);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return count;
  }

  return { render, tex, size: dim, texel: 1 / dim };
}
