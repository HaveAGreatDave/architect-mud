// THE LIGHTS, WITH A DEPTH BUFFER UNDER THEM.
//
// Every light in GLASS is the same shape: a WORLD POINT, a radius in SCREEN pixels, a colour and an
// alpha. A window bloom, a ground glow, an aviation beacon — a disc of light at a place, sized by
// how far away that place is. The 2-D renderer draws each one as a gradient or a sprite blit and
// then has to work out, separately and approximately, whether a building is in the way.
//
// ⚠ THAT SECOND PART IS THE BUG THE WHOLE PLAN OPENED WITH. There is no depth buffer, so a light
// behind a wall is hidden by a PROBE — `decoHidden` against a rasterised occluder field, with a
// bias, a shrink and a grow, each of which is a number somebody had to choose. Too generous and the
// lights come through the walls; too timid and signage disappears for reasons nobody will connect
// to an occlusion change months later. Here the question does not arise: the mass is already in a
// depth buffer, so a light is depth-TESTED per pixel and the answer is exact.
//
// ⚠ AND IT WRITES NO DEPTH. A light is not a thing, it is the appearance of one — it must not hide
// what is behind it, or two glows on the same wall would cut holes in each other.
//
// The quad is expanded in the vertex shader from a point and a pixel radius, so a light is six
// vertices and the CPU never has to know which way the camera is facing. That is also what keeps
// the sizes identical to the 2-D renderer's: `r` is the same `clamp(k / f, lo, hi)` the painter
// computes, handed over rather than re-derived.
import { viewProjMatrix, mat4f, zRow, NEAR } from './camera.js';
import { makeVertexStream } from './stream.js';

// The z row of the projection, from the ONE place NEAR and FAR are named. NDC depth is A + B/f,
// which is what lets the shader express its nudge as a distance instead of as a depth-buffer step.
// ⚠ PER FRAME, BECAUSE THE PLANE IS. These two were module constants off NEAR/FAR, which
// was right while the near plane was one — and is a silent half-tile depth error the moment
// a seat fits its own: the matrix would put a light at one depth and this shader would
// compare it at another, on the low seats only.
// How far toward the eye, in world tiles. DECO_PULL caps the 2-D path at 0.05 for the same job and
// this is that number: enough to win a tie against the surface a light is mounted on at any range,
// far less than the ~0.44 tiles to that surface own near face, so it can never clear a wall.
const LIGHT_PULL = 0.05;

// centre 3, corner 2, radius 1, colour 3, alpha 1, hardness 1
const STRIDE = 11;

const VERT = `#version 300 es
in vec3 aCenter;
in vec2 aCorner;
in float aRadius;
in vec3 aColor;
in float aAlpha;
in float aHard;
uniform mat4 uViewProj;
uniform vec2 uViewport;
// The projection's own z row, [A, B], so the pull below can be expressed in TILES. Passed rather
// than written out here: NEAR and FAR are named once in camera.js precisely because anything
// reasoning about coplanar surfaces needs the same two numbers the matrix was built with.
uniform vec2 uAB;
// How far toward the eye a light is nudged, in world tiles. See the WARN in main().
uniform float uPull;
out vec2 vCorner;
out vec3 vColor;
out float vAlpha;
out float vHard;
void main() {
  vec4 clip = uViewProj * vec4(aCenter, 1.0);
  // The corner offset is in PIXELS, applied after the perspective divide — which is what makes a
  // light the same size on screen as the disc the 2-D renderer paints, rather than a world-space
  // sphere that grows and shrinks on its own terms.
  clip.xy += aCorner * (2.0 * aRadius / uViewport) * clip.w;
  // A HAIR TOWARD THE CAMERA, AND IT HAS TO BE A HAIR AT EVERY DISTANCE. A glow sits ON the roof
  // or wall it belongs to, so at exactly that depth it z-fights the surface into a stipple.
  //
  // WARN THIS WAS 'clip.z -= 0.0012 * clip.w', A CONSTANT IN NDC, AND NDC IS NOT LINEAR IN DISTANCE.
  // Depth here is A + B/f, so a fixed NDC step is a world pull of 0.01*f*f/(1 + 0.01*f) TILES:
  // 0.04 at two tiles, 0.34 at six, 0.91 at ten, 3.3 at twenty and 8.6 at the draw limit. A
  // building's own near wall is 0.44 tiles from its tile centre, so past about SEVEN TILES every
  // light in the city was depth-tested as though it stood in front of the building it is bolted
  // inside. That is the depot lamps showing through its own walls from the street, and it was
  // never a depot bug: it reaches every glow, sign wash and window bloom in GLASS 2.
  //
  // So the nudge is a fixed pull in TILES along the view ray, which is what DECO_PULL does on the
  // 2-D path and for the same reason. x/w and y/w are untouched, so the light lands on the same
  // pixels at the same size and only the depth it is compared at moves.
  float fp = max(0.02, clip.w - uPull);
  clip.z = (uAB.x + uAB.y / fp) * clip.w;
  gl_Position = clip;
  vCorner = aCorner;
  vColor = aColor;
  vAlpha = aAlpha;
  vHard = aHard;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vCorner;
in vec3 vColor;
in float vAlpha;
in float vHard;
// ⚠ HOW FAR PAST WHITE AN EMITTER IS ALLOWED TO GO, AND IT IS THE ONLY THING IN GLASS THAT DOES.
// Every shader here was written against an 8-bit target and saturates by construction — measured on
// the float buffer, the city's brightest pixel is 1.016 at night with 0.01% of the frame over 1.0 —
// so a bright-pass at 1.0 finds nothing and a bright-pass below 1.0 finds the road markings, which
// are the palest thing in a dark street and are not lights. A sign has to actually be brighter than
// a white line before a bloom can tell them apart.
//
// ⚠ AND THE PICTURE DOES NOT CHANGE, WHICH IS WHY THIS IS SAFE. The composite clamps, so a glow
// already at 1.0 still resolves to 1.0; what moves is only what the bright-pass can see. It is
// applied to the ADDITIVE batch alone — those are light, and doubling a lay-over glow would just
// paint a brighter smear.
uniform float uIntensity;
out vec4 outColor;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  // Two profiles, because GLASS has two kinds of light and they do not look alike. A GLOW is a
  // radial falloff that is nearly gone by its own radius (the 'glowSprite' bitmap, and the bloom's
  // three-stop gradient); a LAMP is a small solid disc with a soft edge (blinkLight's arc). One
  // number picks between them so both can ride the same buffer and the same draw call.
  float soft = pow(max(0.0, 1.0 - d), 1.8);
  float hard = 1.0 - smoothstep(0.72, 1.0, d);
  float a = vAlpha * mix(soft, hard, clamp(vHard, 0.0, 1.0));
  // Premultiplied: the canvas is, and an additive blend wants the colour already scaled anyway.
  outColor = vec4(vColor * a * uIntensity, a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' sprite shader: ' + log);
  }
  return sh;
}

// A sprite is `{ x, y, z, r, rgb: [0-255 ×3], a, hard, add }` — the world point, the screen radius
// in pixels, the colour, the alpha, which profile, and whether it adds light or lays it over.
export function createSpriteLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('sprite link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    center: gl.getAttribLocation(prog, 'aCenter'),
    corner: gl.getAttribLocation(prog, 'aCorner'),
    radius: gl.getAttribLocation(prog, 'aRadius'),
    color: gl.getAttribLocation(prog, 'aColor'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    hard: gl.getAttribLocation(prog, 'aHard'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    viewport: gl.getUniformLocation(prog, 'uViewport'),
    intensity: gl.getUniformLocation(prog, 'uIntensity'),
    ab: gl.getUniformLocation(prog, 'uAB'),
    pull: gl.getUniformLocation(prog, 'uPull'),
  };

  const vao = gl.createVertexArray();
  // One stream, set up once: the attribute pointers are recorded into the VAO here and never
  // touched again, and the storage grows by doubling instead of being reallocated every frame.
  // See gl/stream.js.
  const stream = makeVertexStream(gl, vao, STRIDE, [[loc.center, 3, 0], [loc.corner, 2, 12], [loc.radius, 1, 20], [loc.color, 3, 24], [loc.alpha, 1, 36], [loc.hard, 1, 40]], 4096);
  let data = new Float32Array(0);
  let count = 0, split = 0;

  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];

  // ⚠ THE ADDITIVE ONES ARE PUT AT THE END, not interleaved. Two blend modes is two draw calls
  // whatever happens, and sorting once here is cheaper than binding twice per light — a bloom adds
  // light to what is behind it and a ground glow lays colour over it, and painting one as the other
  // is the difference between a lit window and a grey smear.
  function upload(sprites) {
    const over = [], add = [];
    for (const s of sprites) (s.add ? add : over).push(s);
    const all = over.concat(add);
    split = over.length * 6;
    count = all.length * 6;
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 4096));
    let o = 0;
    for (const s of all) {
      const [r, g, b] = s.rgb || [255, 255, 255];
      const cr = r / 255, cg = g / 255, cb = b / 255;
      // ⚠ A NUMBER, NOT A BOOLEAN, AND THE SHADER ALWAYS SAID SO. `vHard` is a MIX between the two
      // profiles and this line was flattening every value to an end of it, so the whole middle of a
      // knob that already existed was unreachable. A beam wants exactly that middle: a plateau
      // across the shaft with a soft rim, because a pure glow chain beads at any spacing worth
      // paying for and a pure lamp chain is a tube with an edge on it.
      // `true` is still 1 and `false`/absent still 0, so every existing caller is bit-identical.
      const hard = +s.hard || 0;
      for (const [cx, cy] of CORNERS) {
        data[o] = s.x; data[o + 1] = s.y; data[o + 2] = s.z;
        data[o + 3] = cx; data[o + 4] = cy;
        data[o + 5] = s.r;
        data[o + 6] = cr; data[o + 7] = cg; data[o + 8] = cb;
        data[o + 9] = s.a;
        data[o + 10] = hard;
        o += STRIDE;
      }
    }
    stream.write(data, count * STRIDE);
    return count / 6;
  }

  // `H` is the CANVAS height (device px) and sizes the viewport, because `aRadius` is already in
  // device pixels. `cssH` is the CAMERA's own frame height, which is what the matrix is built from.
  function draw(cam, W, H, cssH, intensity) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, mat4f(viewProjMatrix(cam, cssH || H)));
    gl.uniform2f(loc.viewport, W, H);
    const zr = zRow((cam && cam.near) || NEAR);
    gl.uniform2f(loc.ab, zr[0], zr[1]);
    gl.uniform1f(loc.pull, LIGHT_PULL);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);          // a light is the appearance of a thing, not a thing
    gl.enable(gl.BLEND);
    gl.bindVertexArray(vao);
    // ⚠ ONE, AND NOT THE GAIN, FOR THE LAY-OVER BATCH. Those glows are colour laid on a surface
    // rather than light added to it, so scaling them pushes no emitter into the headroom — it
    // paints a brighter smear, and the composite clamp cannot take that back.
    gl.uniform1f(loc.intensity, 1);
    if (split) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLES, 0, split); }
    if (count > split) {
      gl.uniform1f(loc.intensity, intensity > 0 ? intensity : 1);
      gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, split, count - split);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return count / 6;
  }

  return { upload, draw, get sprites() { return count / 6; } };
}
