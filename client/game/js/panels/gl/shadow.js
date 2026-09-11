// THE SUN, ON THE DEPTH BUFFER.
//
// GLASS has always had exactly one kind of building shadow: `drawBuildingShadow` takes the convex
// hull of a footprint and the same footprint offset by the roof's cast, and lays it flat on z = 0.
// That is a correct shadow for a box on open ground and it is the only one there is — nothing
// shades a neighbour's wall, nothing shades itself, a setback casts nothing onto the storey below
// it, and past `shadowFar` there is nothing at all. A painter's queue cannot do better: the
// question "is this pixel lit" is per pixel, and the 2-D pass never had a pixel to ask about.
//
// GLASS 2 does. The city's mass is already a static vertex buffer on the GPU, uploaded once per
// map window, so a second render of it from where the light is costs one more draw of data that is
// already there. That is the whole feature: a depth-only pass into a depth texture, and one
// comparison per fragment in the shader that was going to shade that fragment anyway.
//
// ⚠ IT IS ADDITIVE, AND THAT IS WHY IT STARTS HERE RATHER THAN AT THE GROUND. The ground hulls
// stay exactly as they are. A shadow map that also owned the ground would have to suppress them,
// and the two would then have to agree about where a shadow falls — which is a second thing to get
// right in the same change. Walls and roofs have NO existing implementation to contradict, so this
// adds a picture that was simply missing and cannot double up with one that was already there.
// What makes the pair coherent is that both read the same two numbers off the same sun: see
// `lightMatrix` in camera.js, where the light direction is derived from `dir` and `len` rather than
// from an elevation angle, so a building's shadow on its neighbour points where its shadow on the
// ground points.
//
// ⚠ IT IS NOT FINISHED, AND RENDER_TUNE.glShadow DEFAULTS TO 0. The geometry, the depth pass, the
// night gate and the promise that the ground is untouched all measure correctly; the shading term
// in context.js does not respond to its own strength, so what lands is a mask rather than a shadow.
// The full account of what has been ruled out is on RENDER_TUNE.glShadow in windshield.js, and the
// two rigs to hold a next attempt to are npm run gl:shadow (headless, the light matrix against
// drawBuildingShadow own sun) and __glShadow() in the Modelshop (pixels, cost, and the night
// control). Nothing below is dead: it is all exercised the moment the knob leaves 0.
//
// ⚠ AND ITS FAILURE MODE IS A BLACK CITY, WHICH IS WHY EVERY EXIT RETURNS null. A framebuffer the
// driver will not complete, a depth texture it will not allocate, a program that will not link:
// each of those leaves the main shader sampling something undefined, and undefined here is not a
// missing shadow, it is a shadow everywhere. So nothing is half-installed — either the layer
// reports a texture and a matrix, or the caller runs the pass it has always run with the strength
// at zero, where the comparison multiplies by exactly 1.0.

// The map is square and its size is fixed rather than tracking the window, because the window
// changes with the seat and a texture that resized would reallocate on every seat change. 2048 is
// the WebGL2 guaranteed floor for MAX_TEXTURE_SIZE, so it fits everywhere; over a cab's 33-tile
// window that is 62 texels a tile and over an aeroplane's 73 it is 28.
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

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shadow shader: ' + log);
  }
  return sh;
}

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
    vs = compile(gl, gl.VERTEX_SHADER, VERT);
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
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
