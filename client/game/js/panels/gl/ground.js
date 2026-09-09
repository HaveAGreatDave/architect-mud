// THE ROAD SURFACE, AS GEOMETRY — AND EVERYTHING ELSE THAT IS A COLOURED POLYGON.
//
// It began as the road and it is no longer only the road: the headlight pool rides here as an
// additive range, building shadows as a translucent one, and a CLIFF MASSIF as ordinary depth-
// writing geometry. Nothing about this layer was ever specific to z = 0 — it takes a polygon, a
// colour and an alpha, which is what all four of those are. A massif could not go in the mesh
// (that is captured once and a cliff is coloured per frame off the sun, the night and a world
// noise) and could not go behind an occlusion probe (it spreads about 1.8 tiles either side of
// its own tile, so any box wide enough to hold it reaches into the gaps between buildings), so
// it comes here instead, where a stream is the honest shape and the depth buffer does the rest.
//
// Measured with scripts/shapes/armcost.mjs: once GLASS 2 owns the city's mass, 97% of the canvas
// calls a frame still makes are path construction, and the single biggest producer is the ground —
// `stripeA`, the helper behind every road surface, pavement, lane line and dash, at roughly 12,000
// calls a frame on a 33x33 window. Buildings, by then, account for almost none of it: the same
// window with every building deleted costs MORE, because you can see more road.
//
// So this is what is left of GLASS 1 in the world pass, and it is all flat quads at z=0 with a
// solid colour. There is nothing in it a GPU is not better at.
//
// ⚠ DEPTH-WRITE ON, unlike every other layer here. The lights, the Curtain, the signage and the
// scatter are all things you see THROUGH or things that sit ON a surface, so they test depth and
// write none. The road IS a surface — a building standing on it must be able to hide the road
// behind it, and the road must hide what is under it.
//
// ⚠ AND IT UPLOADS EVERY FRAME, DELIBERATELY. The mass buffer is cached on the map window and
// three separate bugs were needed to make that safe (an order-sensitive key, a camera-relative
// mesh position, and a set taken from camera-culled items). These quads are produced by a pass
// that culls per tile against the near plane and the far limit, so the set genuinely changes as
// you move inside a single tile — feeding that to a cached buffer would reintroduce all three
// failures at once. A stream is the honest shape for it; make it cacheable by moving the culls
// first, not by pretending they are not there.
import { viewProjMatrix } from './camera.js';

// pos3, colour3
const STRIDE = 7;   // pos3, colour3, alpha1

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aColor;
in float aAlpha;
uniform mat4 uViewProj;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
uniform float uHazeNear;
uniform float uHazeFar;
out vec3 vColor;
out float vFog;
out float vAlpha;
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  gl_Position = clip;
  vColor = aColor;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
  // The far dissolve is the WINDOW's, exactly as the mass uses it — a truck asks for 15 tiles and
  // an aeroplane for 34, and the road has to end where the buildings do or it draws a hard diagonal
  // across the haze that nothing else in the frame agrees with.
  // ⚠ THE FADE IS THE 2-D PASS’S OWN, HANDED OVER — not re-derived here. drawGroundSurfaces
  // fades every tile by clamp((FAR - f) / 6) on top of worldBlend, and a shader that invented its
  // own curve would disagree with the road the cab is actually driving on. The haze uniforms stay
  // for a caller that has no alpha to give.
  vAlpha = aAlpha * (uHazeFar > uHazeNear ? 1.0 - smoothstep(uHazeNear, uHazeFar, clip.w) : 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vFog;
in float vAlpha;
uniform vec3 uFog;
out vec4 outColor;
void main() {
  if (vAlpha <= 0.002) discard;
  vec3 c = mix(vColor, uFog, vFog);
  outColor = vec4(c * vAlpha, vAlpha);   // premultiplied, like every other layer on this canvas
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' ground shader: ' + log);
  }
  return sh;
}

// A quad is `{ p: [[x,y,z] x4], rgb: [0-255 x3] }` in the MAP WINDOW's frame — the same frame the
// mass mesh uses, so the caller hands both to the same shifted camera and they cannot disagree
// about where a kerb is.
export function createGroundLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('ground link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    color: gl.getAttribLocation(prog, 'aColor'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    hazeNear: gl.getUniformLocation(prog, 'uHazeNear'),
    hazeFar: gl.getUniformLocation(prog, 'uHazeFar'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(0);
  let count = 0, splitA = 0, splitB = 0;

  const tris = (list) => list.reduce((n, q) => n + (q.p.length - 2) * 3, 0);

  // ⚠ FILLED STRAIGHT INTO THE TYPED ARRAY. The mass rebuild cost 11.1 ms until it stopped building
  // plain arrays and converting them; at twelve thousand quads a frame this path cannot afford that
  // mistake a second time.
  // ⚠ THREE RANGES, NOT ONE LIST, AND THE ORDER IS THE CANVAS'S. Everything here shares the ground
  // plane, so what separates them is not depth but what they DO to what is already there:
  //
  //   base — the road SURFACE, which writes depth because it is a surface
  //   add  — a headlight pool, which is light landing on that surface ('lighter' on the canvas)
  //   over — a shadow, which is translucent dark laid on top of both
  //
  // Base first, then light, then shadow, is exactly the sequence the 2-D pass paints in:
  // drawGroundSurfaces, drawHeadlightBeam, then the shadows the building loop casts. Get it
  // backwards and a building's shadow stops falling across the beam.
  // Only the base writes depth: a translucent quad that wrote it would let its own dark alpha
  // occlude whatever else shares its plane.
  function upload(quads) {
    const base = [], add = [], over = [];
    for (const q of quads) (q.add ? add : q.over ? over : base).push(q);
    quads = base.concat(add, over);
    splitA = tris(base);
    splitB = splitA + tris(add);
    count = tris(quads);
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 1 << 16));
    let o = 0;
    for (const q of quads) {
      const p = q.p, c = q.rgb, qa = q.a == null ? 1 : q.a;
      // ⚠ COLOUR IS PER VERTEX IN THE BUFFER AND USUALLY PER QUAD IN THE CALLER, and the two are
      // not in tension — a road has one colour and writes it four times. `rgbs` is for the caller
      // that needs the other: a cliff face is painted with a vertical GRADIENT, which is the one
      // thing a flat quad cannot say and the reason a massif could not follow the road onto this
      // layer. Interpolating between the top and bottom vertices is what a gradient IS.
      const cs = q.rgbs;
      const r = c ? c[0] / 255 : 0, g = c ? c[1] / 255 : 0, b = c ? c[2] / 255 : 0;
      const put = (v, i) => {
        const k = cs && cs[i];
        data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2];
        data[o + 3] = k ? k[0] / 255 : r; data[o + 4] = k ? k[1] / 255 : g; data[o + 5] = k ? k[2] / 255 : b;
        data[o + 6] = qa; o += STRIDE;
      };
      // A fan, because a shadow is the convex hull of a footprint and its offset copy and can
      // carry up to eight corners; a road quad is the four-point case of the same loop.
      for (let i = 1; i + 1 < p.length; i++) { put(p[0], 0); put(p[i], i); put(p[i + 1], i + 1); }
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * STRIDE), gl.DYNAMIC_DRAW);
    const S = STRIDE * 4;
    const bind = (l, n, off) => { if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, S, off); } };
    bind(loc.pos, 3, 0); bind(loc.color, 3, 12); bind(loc.alpha, 1, 24);
    gl.bindVertexArray(null);
    return quads.length;
  }

  function draw(cam, H, opts = {}) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, H)));
    const f = opts.fog || {};
    const c = f.col || [0.5, 0.5, 0.55];
    gl.uniform3f(loc.fog, c[0], c[1], c[2]);
    gl.uniform1f(loc.fogNear, f.near == null ? 6 : f.near);
    gl.uniform1f(loc.fogFar, f.far == null ? 34 : f.far);
    gl.uniform1f(loc.fogAmt, f.amt || 0);
    gl.uniform1f(loc.hazeNear, opts.hazeNear == null ? 1e9 : opts.hazeNear);
    gl.uniform1f(loc.hazeFar, opts.hazeFar == null ? 1e9 : opts.hazeFar);
    gl.enable(gl.DEPTH_TEST);
    // ── ⚠ THE EPS LADDER IS A WORLD LIFT AND THE DEPTH BUFFER IS NOT LINEAR ───
    //
    // Everything on this layer lies on the ground and is held off the floor shader by a lift in
    // WORLD z — SURF_EPS 0.0008, ROAD_EPS 0.002, BEAM_EPS 0.003, SHADOW_EPS 0.004. A depth buffer
    // does not store distance, it stores 1/distance, so what those lifts are worth collapses as
    // 1/f². Measured on a 24-bit buffer at near 0.06 / far 400, in depth-buffer units:
    //
    //     tiles      road 0.002   shadow 0.004   surface 0.0008
    //         4          126           251             50
    //        10           20            40              8
    //        20            5             10              2
    //        40            1.3            2.5            0.5
    //        80            0.3            0.6            0.1
    //
    // Under about one unit the test cannot tell the quad from the floor it lies on, so the road
    // and the shadows z-fight — which reads as the road blinking between light levels and shadows
    // coming and going. It never showed from a cab, where the road in front of you is five to
    // thirty tiles out; it shows the moment the external view zooms back, because that pushes the
    // whole scene further away and every lift in the ladder is worth less.
    //
    // A polygon offset is the fix rather than a bigger number: it biases in DEPTH-BUFFER units and
    // scales with the polygon's own slope, so it is worth the same at four tiles and at eighty, and
    // a ground plane seen nearly edge-on — the case that fails hardest — is exactly the case the
    // slope term is for. ⚠ The ladder stays: it still orders these surfaces AGAINST EACH OTHER,
    // where they are all at the same distance and the lift is still meaningful. This only settles
    // the whole layer against the floor underneath it.
    // ⚠ And it works because these quads let the rasteriser interpolate their depth. Polygon offset
    // is ignored for a shader that writes gl_FragDepth, which the floor does — so the floor keeps
    // its own exact depth and the layer above is biased toward the eye off it.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    // ⚠ UNITS ONLY, FACTOR ZERO, AND THE FACTOR IS THE DANGEROUS HALF. A polygon offset is
    // factor·slope + units·resolution, and the slope of a ground plane seen nearly EDGE ON — a cab
    // at kerb height, an apron running to the horizon — is enormous. A factor of −1 there is not a
    // hair of bias, it is a large one, and a large bias toward the eye can carry the paving in
    // front of the building standing on it.
    // The units term is what this actually needs: a constant number of DEPTH-BUFFER steps, which is
    // already resolution-independent and is the whole reason a polygon offset beats a world lift.
    // Four steps is comfortably more than the 0.3 the eps ladder is worth at eighty tiles, and
    // cannot grow with the angle.
    gl.polygonOffset(0, -4);
    gl.depthMask(true);         // the road is a surface — see the ⚠ at the top
    gl.disable(gl.CULL_FACE);   // a road is looked at from above and from a cab at kerb height
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    if (splitA) { gl.depthMask(true); gl.drawArrays(gl.TRIANGLES, 0, splitA); }
    gl.depthMask(false);
    if (splitB > splitA) {
      // ⚠ ADDITIVE, AND THE ALPHA RIDES ALONG. The fragment output is premultiplied, so under
      // ONE/ONE the colour adds and so does the coverage — which it has to, because this buffer is
      // BLITTED source-over onto the 2-D frame and a pool of light over open ground would
      // otherwise composite onto nothing and vanish. Same compromise the Curtain makes.
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, splitA, splitB - splitA);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    if (count > splitB) gl.drawArrays(gl.TRIANGLES, splitB, count - splitB);
    gl.depthMask(true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    return count / 6;
  }

  return { upload, draw, get quads() { return count / 6; } };
}
