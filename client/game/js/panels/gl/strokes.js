// THE WIRES, ON THE DEPTH BUFFER.
//
// A great deal of GLASS is not mass, not a light and not a sign: it is a STROKE. A guyed antenna
// mast, a lattice tower's legs and braces, a catwalk rail, a crane jib, a mooring cable, a
// light-runner tracing a tower's corner, a windsock pole. Each is a line between two world points
// drawn at a width in SCREEN pixels, because that is what makes a lattice read as a lattice at four
// hundred metres instead of dissolving into nothing.
//
// ⚠ AND THAT IS EXACTLY WHY THEY WERE THE LAST THINGS PAINTING THROUGH BUILDINGS. A stroke has a
// screen width and no world thickness, so there was nothing to hand a triangle list and nothing for
// `MESH_SINK` to record — every one of them stayed on the 2-D canvas, which with the mass on the GPU
// is composited AFTER the city and cannot be painted over. The only thing between a mast and the
// warehouse in front of it was `decoHidden`, which answers per SURFACE: a mast anchored on a hidden
// roof still has its tip in clear air, so it answers "draw" for the whole wire.
//
// ⚠ THE ANSWER IS NOT A BAKED BILLBOARD, AND THAT WAS TRIED AND MEASURED AND TAKEN BACK OUT. Baking
// a wire into a canvas and uploading it is a canvas repaint plus a texImage2D PER INSTANCE PER
// FRAME — affordable for the handful of landmarks it was written for, and a cockpit framerate below
// GLASS 1 for a part that hangs off ordinary buildings by the dozen.
//
// So it is geometry after all, built where the screen width is a thing you can express: the quad is
// expanded IN THE VERTEX SHADER from the two endpoints and a pixel width, exactly as the sprite
// layer expands a light from a point and a pixel radius. Six vertices a segment, no texture, no
// bake, one draw call for every wire in the city.
import { viewProjMatrix } from './camera.js';

// a3, b3, param2 (side, end), style3 (width px, alpha, feather), colour3
const STRIDE = 14;

const VERT = `#version 300 es
in vec3 aA;
in vec3 aB;
in vec2 aParam;
in vec3 aStyle;
in vec3 aColor;
uniform mat4 uViewProj;
uniform vec2 uViewport;
out float vSide;
out float vFeather;
out vec3 vColor;
out float vAlpha;
void main() {
  vec4 ca = uViewProj * vec4(aA, 1.0);
  vec4 cb = uViewProj * vec4(aB, 1.0);
  // The direction the line runs ON SCREEN, which is the only frame a pixel width means anything in.
  // Taken after the perspective divide, so a wire running away from the eye is thickened across its
  // apparent direction rather than its world one.
  vec2 sa = ca.xy / max(1e-6, ca.w) * uViewport * 0.5;
  vec2 sb = cb.xy / max(1e-6, cb.w) * uViewport * 0.5;
  vec2 d = sb - sa;
  float len = length(d);
  // A degenerate segment (both ends on the same pixel) has no direction to be perpendicular to.
  // Pick one rather than dividing by zero: the quad is a pixel-sized dot either way.
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec4 clip = mix(ca, cb, aParam.y);
  clip.xy += perp * aParam.x * (aStyle.x * 0.5) * (2.0 / uViewport) * clip.w;
  // ⚠ A HAIR TOWARD THE CAMERA, for the reason the sprite layer needs one: a rail sits ON the deck
  // it runs along and a light-runner ON the corner it traces, so at exactly that depth the wire
  // z-fights its own host into a stipple. This is DECO_LIFT, in the only units a depth buffer has.
  clip.z -= 0.0012 * clip.w;
  gl_Position = clip;
  vSide = aParam.x;
  vFeather = aStyle.z;
  vColor = aColor;
  vAlpha = aStyle.y;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vSide;
in float vFeather;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() {
  // 'feather' is 0 for a hard line and 1 for a halo. A canvas stroke is antialiased across its own
  // edge and a shadowBlur halo falls off across its whole width, and one number covers both.
  // (Single quotes, never backticks: this comment is inside a template literal.)
  float a = vAlpha * (1.0 - smoothstep(1.0 - max(0.08, vFeather), 1.0, abs(vSide)));
  if (a < 0.004) discard;
  outColor = vec4(vColor * a, a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' stroke shader: ' + log);
  }
  return sh;
}

// A stroke is `{ a: [x,y,z], b: [x,y,z], w, rgb: [0-255 x3], alpha, glow }` — two world points in
// the same camera-relative tile frame the lights use, a width in DEVICE pixels, a colour, a fade,
// and how many pixels of soft halo to lay round it (the 2-D renderer's `shadowBlur`, which is the
// single most expensive thing it does and here is one more quad).
export function createStrokeLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('stroke link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    a: gl.getAttribLocation(prog, 'aA'),
    b: gl.getAttribLocation(prog, 'aB'),
    param: gl.getAttribLocation(prog, 'aParam'),
    style: gl.getAttribLocation(prog, 'aStyle'),
    color: gl.getAttribLocation(prog, 'aColor'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    viewport: gl.getUniformLocation(prog, 'uViewport'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  let count = 0, split = 0;

  // side, end — the four corners of the quad as two triangles.
  const CORNERS = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];

  function upload(list) {
    // ⚠ THE HALOES GO AT THE END, for the reason the sprite layer's additive lights do: two blend
    // modes is two draw calls whatever happens, and a halo ADDS light to the wall behind it while
    // the wire itself lays colour over it.
    const core = [], halo = [];
    for (const s of list) {
      if (!s || !s.a || !s.b) continue;
      core.push(s);
      if (s.glow > 0) halo.push(s);
    }
    split = core.length * 6;
    count = split + halo.length * 6;
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 4096));
    let o = 0;
    const put = (s, w, feather, alpha) => {
      const [r, g, b] = s.rgb || [255, 255, 255];
      const cr = r / 255, cg = g / 255, cb = b / 255;
      for (const [side, end] of CORNERS) {
        data[o] = s.a[0]; data[o + 1] = s.a[1]; data[o + 2] = s.a[2];
        data[o + 3] = s.b[0]; data[o + 4] = s.b[1]; data[o + 5] = s.b[2];
        data[o + 6] = side; data[o + 7] = end;
        data[o + 8] = w; data[o + 9] = alpha; data[o + 10] = feather;
        data[o + 11] = cr; data[o + 12] = cg; data[o + 13] = cb;
        o += STRIDE;
      }
    };
    // A canvas stroke is antialiased over its own edge, so a 0.8px brace is not 80 per cent of a
    // pixel of coverage — it is a whole pixel at 80 per cent alpha. Widening to a floor of one
    // device pixel and carrying the shortfall in the alpha is what keeps a lattice reading as a
    // lattice rather than as a scatter of dropouts.
    for (const s of core) {
      const w = Math.max(1, s.w || 1);
      put(s, w, 0, (s.alpha == null ? 1 : s.alpha) * Math.min(1, (s.w || 1) / w));
    }
    for (const s of halo) put(s, Math.max(1, s.w || 1) + s.glow * 2, 1, (s.alpha == null ? 1 : s.alpha) * 0.38);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.a, 3, 0); bind(loc.b, 3, 12); bind(loc.param, 2, 24); bind(loc.style, 3, 32); bind(loc.color, 3, 44);
    gl.bindVertexArray(null);
    return count / 6;
  }

  // `W`/`H` are the CANVAS in device pixels, because the width arrives already scaled by the
  // frame's dpr; `cssH` is the CAMERA's own frame height, which is what the matrix is built from.
  // Same two-heights trap as the sprites.
  function draw(cam, W, H, cssH) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, cssH || H)));
    gl.uniform2f(loc.viewport, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);        // a wire is thinner than the depth buffer can express; it must not hide anything
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(vao);
    if (split) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLES, 0, split); }
    if (count > split) { gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLES, split, count - split); }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return count / 6;
  }

  return { upload, draw, get strokes() { return count / 6; } };
}
