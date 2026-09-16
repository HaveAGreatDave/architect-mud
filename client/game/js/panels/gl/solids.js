// THE SOLIDS THE FRAME DRAWS ITSELF: THE VEHICLE YOU ARE IN, AND THE DEPOT SHED.
//
// ⚠ TWO CLIENTS, ONE LAYER, AND THE SECOND ONE IS WHY IT IS NOT CALLED `ownship` ANY MORE. What
// this draws is a flat-shaded triangle soup that writes depth and is not culled, and the rig was
// simply the first thing in GLASS that needed one. The depot shed is the second: it is the one
// building drawn at a fixed size by its own function rather than extruded from a storey stack, so
// it is in MASS_EXCEPT, it never reaches the GL mass, and it was painted on the canvas AFTER the
// city was composited — the 'depot shows thru buildings' report, and the same shape as every
// see-through bug before it.
//
// ⚠ THE SHED COULD NOT GO IN THE MASS AND THAT IS A PROPERTY OF THE SHED, NOT A SHORTCUT. The mass
// buffer is cached per map window; the shed's roller door OPENS as a truck comes up the apron, and
// its palette flips between an interior and an exterior read depending on which side of the walls
// the eye is. Both are per-frame, per-tile answers, and a cached buffer cannot carry either — so it
// would rebuild the whole window's vertex data every frame, which is the one thing the mass buffer
// exists not to do. Here it is a few hundred triangles uploaded per frame, which is what this layer
// already does for the rig.
//
//
// The own ship was the last solid object in the frame with no presence in GL at all. It is drawn by
// `model-raster.js` — a software rasteriser with its own depth buffer — straight onto the 2-D
// canvas, AFTER the GL canvas has been blitted. That is exactly correct for a renderer where the
// painter's order is the depth order, and it has two consequences once the city is on a depth
// buffer and everything else in the world has followed it there:
//
//   · the rig draws THROUGH buildings, because nothing composited later can be hidden by something
//     composited earlier — the 'truck shows thru buildings' report, and the same shape as the
//     lights, the Curtain, the signage and the wires before it;
//   · and it cannot appear in a PUDDLE, because the reflection pass renders the mass, the sprites
//     and the decals into its buffer and the rig is in none of them. A mirror can only show what
//     was drawn into it.
//
// Both are the one missing capability, so this is the one fix.
//
// ⚠ IT PORTS NO GEOMETRY AND NO SHADING, WHICH IS WHY IT IS SMALL. Every face the model draws
// already carries `wv` — its vertices in world 3-space — and `rv`, the same three numbers the
// software rasteriser writes into a pixel, shaded by the baked `sh`, the livery finish and the sun.
// Both exist because the self-shadowing pass and the rasteriser already needed them, and the note
// over `rv` in windshield.js is explicit that they are kept as numbers so nobody re-derives them.
// So this layer is handed finished polygons and does nothing to them but project.
//
// ⚠ AND THE SHADING STAYS ON THE CPU DELIBERATELY. A lit-here shader would be a second lighting
// model for one object, agreeing with the canvas one until somebody edited either — the failure
// the ⚠ over `rv` names. The truck is a few hundred faces once; there is nothing to win.
//
// ⚠ NO FACE CULLING. A face with no `cen` is a free polygon in that mesh — a raked screen, a fin
// blade, a sheet with nothing behind it — and a sheet is visible from both sides. The mirrored pass
// needs the other reason too: reflecting the world about z flips the winding, so a fixed cull would
// show the reflection inside out.
//
// ⚠ AND IT UPLOADS ONCE AND DRAWS TWICE. The rig moves every frame, so there is nothing to cache;
// what matters is that the REFLECTION pass runs before the main one (see the prepass note in
// world.js), so the buffer has to be filled before either. Upload and draw are separate calls for
// that reason alone.
import { viewProjMatrix } from './camera.js';

const STRIDE = 7;   // pos3, colour3, alpha1

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aColor;
in float aAlpha;
uniform mat4 uViewProj;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogAmt;
out vec3 vColor;
out float vFog;
out float vAlpha;
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  gl_Position = clip;
  vColor = aColor;
  vAlpha = aAlpha;
  float ff = clamp((clip.w - uFogNear) / max(1e-3, uFogFar - uFogNear), 0.0, 1.0);
  vFog = ff * ff * uFogAmt;
}`;

// The fog is the only thing done here, and it is done because the rest of the frame does it: a rig
// seen from a long way off in a chase camera has to recede into the same haze wall the city does.
// At the distance an own ship is actually drawn from it is worth nothing, and it costs nothing.
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
    throw new Error(label + ' solids shader: ' + log);
  }
  return sh;
}

export function createSolidsLayer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('solids link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    color: gl.getAttribLocation(prog, 'aColor'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let data = new Float32Array(1 << 13);
  let count = 0;

  // A fan, so a triangle, a quad and the occasional ring out of the mesh builders all go through
  // one loop — the same shape ground.js fills for the same reason.
  const tris = (list) => list.reduce((n, q) => n + Math.max(0, q.p.length - 2) * 3, 0);

  function upload(quads) {
    count = quads && quads.length ? tris(quads) : 0;
    if (!count) return 0;
    if (data.length < count * STRIDE) data = new Float32Array(Math.max(count * STRIDE, 1 << 13));
    let o = 0;
    for (const q of quads) {
      const p = q.p, c = q.rgb, qa = q.a == null ? 1 : q.a;
      const r = c ? c[0] / 255 : 0, g = c ? c[1] / 255 : 0, b = c ? c[2] / 255 : 0;
      const put = (v) => {
        data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2];
        data[o + 3] = r; data[o + 4] = g; data[o + 5] = b;
        data[o + 6] = qa; o += STRIDE;
      };
      for (let i = 1; i + 1 < p.length; i++) { put(p[0]); put(p[i]); put(p[i + 1]); }
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

  function draw(cam, cssH, opts = {}) {
    if (!count) return 0;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, viewProjMatrix(cam, cssH));
    const f = opts.fog;
    gl.uniform3f(loc.fog, f ? f.col[0] : 0, f ? f.col[1] : 0, f ? f.col[2] : 0);
    gl.uniform1f(loc.fogNear, f ? f.near : 1e9);
    gl.uniform1f(loc.fogFar, f ? f.far : 1e9 + 1);
    gl.uniform1f(loc.fogAmt, f ? f.amt : 0);
    // ⚠ DEPTH-WRITE ON. This is a solid object: it has to hide what is behind it and be hidden by
    // what is in front, which is the whole point of moving it here.
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);   // see the ⚠ at the top — sheets, and a mirrored winding
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    return count / 3;
  }

  return { upload, draw, get faces() { return count / 3; } };
}
