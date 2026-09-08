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
import { viewProjMatrix } from './camera.js';

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
  // ⚠ A HAIR TOWARD THE CAMERA. A glow sits ON the roof or wall it belongs to, so at exactly that
  // depth it would z-fight with the surface into a stipple. The 2-D renderer has the same problem
  // and solves it by sorting (DECO_LIFT); this is that lift, in the only units a depth buffer has.
  clip.z -= 0.0012 * clip.w;
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
  outColor = vec4(vColor * a, a);
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
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
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
      const hard = s.hard ? 1 : 0;
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
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.center, 3, 0); bind(loc.corner, 2, 12); bind(loc.radius, 1, 20);
    bind(loc.color, 3, 24); bind(loc.alpha, 1, 36); bind(loc.hard, 1, 40);
    gl.bindVertexArray(null);
    return count / 6;
  }

  function draw(cam, W, H) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, H)));
    gl.uniform2f(loc.viewport, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);          // a light is the appearance of a thing, not a thing
    gl.enable(gl.BLEND);
    gl.bindVertexArray(vao);
    if (split) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLES, 0, split); }
    if (count > split) { gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, split, count - split); }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return count / 6;
  }

  return { upload, draw, get sprites() { return count / 6; } };
}
