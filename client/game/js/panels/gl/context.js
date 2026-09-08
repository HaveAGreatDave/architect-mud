// A WebGL2 world pass for GLASS — the spike, not the renderer.
//
// It draws ONE thing: mass, as triangles, through GLASS's own camera (see camera.js), shaded the
// way GLASS shades it. No textures, no adornments, no ground, no weather. That is enough to answer
// the question the spike exists for — can the same city be drawn with a depth buffer, from the same
// seat, at a cost worth the rewrite — and stopping there is deliberate: a spike that grows features
// stops being measurable against the thing it is meant to replace.
//
// ⚠ IT OWNS NO GEOMETRY AND NO PALETTE. The vertices come from `captureModelMesh`, which records the
// real primitives; the colours come from the caller, which reads `WALL_COL`. This file knows how to
// put triangles on a screen and nothing whatever about buildings — the same rule the Modelshop's
// server follows, for the same reason: two definitions of what a building looks like is the failure
// this whole effort is trying not to introduce.
//
// ⚠ AND IT IS NOT WIRED INTO THE GAME. `paintWindshield` does not know it exists. The only caller is
// the Modelshop's GL preview, where a wrong answer is a picture somebody is looking at rather than a
// city nobody can see.
import { viewProjMatrix } from './camera.js';
import { createSpriteLayer } from './sprites.js';

// Floats per vertex: position 3, normal 3, colour 3, atlas uv 2, wall ramp 1, alpha 1, flat 1.
const STRIDE = 14;

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;
in vec2 aUV;
in float aRamp;
in float aAlpha;
in float aFlat;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUV;
out float vRamp;
out float vDepth;
out float vAlpha;
out float vFlat;
void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  gl_Position = clip;
  vNormal = aNormal;
  vColor = aColor;
  vUV = aUV;
  vRamp = aRamp;
  vAlpha = aAlpha;
  vFlat = aFlat;
  vDepth = clip.w;              // the camera-forward distance, in tiles — the same f GLASS sorts on
}`;

// The shading GLASS already does, per fragment instead of per face: a key-light dot that warms the
// lit side and cools the shadow side, and a distance fade into the sky. `uKey`/`uSky`/`uShadow` are
// RENDER_TUNE's own vertex-light palette, handed in rather than restated.
const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUV;
in float vRamp;
in float vDepth;
in float vAlpha;
in float vFlat;
uniform sampler2D uAtlas;
uniform float uTextured;
uniform vec3 uKeyDir;
uniform vec3 uKey;
uniform vec3 uShadow;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform float uVLight;
uniform vec3 uSky;
uniform float uStr;
uniform float uFogAmt;
uniform float uHazeNear;
uniform float uHazeFar;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  float lit = clamp(0.5 + dot(n, normalize(uKeyDir)) * 0.5, 0.0, 1.0);
  // The palette colour is what a flat-shaded face gets; the atlas is what a textured one gets.
  // Mixed rather than branched because a branch here is a branch per fragment, and the untextured
  // path exists only for the silhouette comparison.
  // ⚠ A FLAT FACE IS ITS OWN COLOUR AND NOTHING ELSE. The panels, bands, louvres and coping the
  // adornments are made of are painted by the 2-D renderer as ONE fill — no wall texture, no light
  // ramp — so a shader that helpfully textured and shaded them would not be reproducing GLASS, it
  // would be improving on it, which is the one thing a port must not do.
  float solid = 1.0 - clamp(vFlat, 0.0, 1.0);
  vec3 surf = mix(vColor, texture(uAtlas, vUV).rgb, clamp(uTextured, 0.0, 1.0) * solid);
  // wallLit's own two overlays, per fragment instead of as a canvas gradient: a warm top tinted
  // between sky and key by the light dot, and a darker base, both at alphas that depend on that
  // same dot. A flat tint is what this looked like before, and a flat tint reads as a wall painted
  // a lighter colour rather than a wall standing in light.
  vec3 topCol = mix(uSky, uKey, lit);
  float aTop = uStr * (0.06 + 0.14 * lit);
  float aBot = uStr * (0.30 + 0.22 * (1.0 - lit));
  vec3 shaded = mix(mix(surf, topCol, aTop), mix(surf, uShadow, aBot), clamp(vRamp, 0.0, 1.0));
  vec3 base = mix(surf, shaded, clamp(uVLight, 0.0, 1.0) * solid);
  // GLASS's own fog curve, squared, scaled by the same amount its slider sets — see fogWeight.
  float ff = clamp((vDepth - uFogNear) / max(0.001, uFogFar - uFogNear), 0.0, 1.0);
  float fog = ff * ff * uFogAmt;
  // ⚠ AND THE FAR EDGE DISSOLVES RATHER THAN ENDING. The 2-D pass fades a building out over the
  // last few tiles of its draw distance, so distant blocks ghost up out of the horizon instead of
  // popping in — and this buffer is composited onto that same frame, so a mass that stayed opaque
  // to its last tile would paint a hard edge over the haze the rest of the picture dissolves into.
  // Premultiplied, because the canvas is.
  float a = (1.0 - smoothstep(uHazeNear, uHazeFar, vDepth)) * clamp(vAlpha, 0.0, 1.0);
  outColor = vec4(mix(base, uFog, fog) * a, a);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(label + ' shader: ' + log);
  }
  return sh;
}

export function createGLView(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, depth: true });
  if (!gl) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT, 'vertex'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG, 'fragment'));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    normal: gl.getAttribLocation(prog, 'aNormal'),
    color: gl.getAttribLocation(prog, 'aColor'),
    uv: gl.getAttribLocation(prog, 'aUV'),
    ramp: gl.getAttribLocation(prog, 'aRamp'),
    alpha: gl.getAttribLocation(prog, 'aAlpha'),
    flat: gl.getAttribLocation(prog, 'aFlat'),
    viewProj: gl.getUniformLocation(prog, 'uViewProj'),
    keyDir: gl.getUniformLocation(prog, 'uKeyDir'),
    key: gl.getUniformLocation(prog, 'uKey'),
    shadow: gl.getUniformLocation(prog, 'uShadow'),
    fog: gl.getUniformLocation(prog, 'uFog'),
    fogNear: gl.getUniformLocation(prog, 'uFogNear'),
    fogFar: gl.getUniformLocation(prog, 'uFogFar'),
    fogAmt: gl.getUniformLocation(prog, 'uFogAmt'),
    hazeNear: gl.getUniformLocation(prog, 'uHazeNear'),
    hazeFar: gl.getUniformLocation(prog, 'uHazeFar'),
    vlight: gl.getUniformLocation(prog, 'uVLight'),
    atlas: gl.getUniformLocation(prog, 'uAtlas'),
    textured: gl.getUniformLocation(prog, 'uTextured'),
    sky: gl.getUniformLocation(prog, 'uSky'),
    str: gl.getUniformLocation(prog, 'uStr'),
  };

  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  let count = 0;
  let atlasTex = null, hasAtlas = false;

  // One texture for the whole city. See gl/atlas.js for why this is an atlas rather than a bind
  // per face: a draw call can hold one texture, and per-face binds would make a skyline several
  // hundred draw calls — which is the cost GL is being asked to avoid.
  function setAtlas(canvas) {
    if (!canvas) { hasAtlas = false; return; }
    if (!atlasTex) atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    // ⚠ NO MIPMAPS AND CLAMP TO EDGE. A mipmap chain blends across tile boundaries at the coarse
    // levels, which is the atlas seam the padding exists to prevent, arriving by another door.
    //
    // ⚠ AND MAGNIFY WITH NEAREST, WHICH IS WHAT GLASS DOES. A wall texture is 16×32 stretched over
    // a whole facade, and the 2-D renderer draws it with smoothing ON only when the wall is being
    // MINIFIED (`drawTexQuadP(..., minify)`) — so close up the window rows are crisp blocks of
    // texel. LINEAR magnification turned every near facade into a soft grey wash with the windows
    // barely readable, which looked like the GL lighting being wrong and was the sampler.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    hasAtlas = true;
  }

  // ⚠ QUADS ARE FANNED, NOT ASSUMED TO BE FOUR-SIDED. A drum cap is an N-gon and a clipped roof is a
  // 3-to-5-gon, so anything that indexed 0,1,2 / 0,2,3 would quietly drop the rest of a cylinder's
  // lid. Every face here is convex, which is what makes a fan correct rather than merely convenient.
  // ⚠ THE MESH ARRIVES AS GROUPS, EACH WITH AN OFFSET, AND IS NEVER COPIED TO MOVE IT. A city is one
  // building geometry repeated at many tiles: placing it by rewriting every vertex allocates an
  // array per face and a point per vertex, and it is a rebuild of the whole buffer that pays for it.
  // The offset is added here, on the way into the vertex data, where the number was going to be
  // written anyway.
  //
  // ⚠ AND IT FILLS A TYPED ARRAY DIRECTLY. A plain array of a hundred and forty thousand numbers,
  // grown by `push` and then converted, was most of an eleven-millisecond rebuild on an aircraft
  // window — which is a dropped frame every time the map recentres, and invisible in a steady shot.
  function uploadGroups(groups, rectOf) {
    let verts = 0;
    for (const g of groups) for (const f of g.faces) verts += (f.p.length - 2) * 3;
    const data = new Float32Array(verts * STRIDE);
    let o = 0;
    for (const grp of groups) {
      const ox = grp.ox || 0, oy = grp.oy || 0;
      for (const f of grp.faces) {
        const [r, g, b] = f.rgb || [128, 128, 128];
        const n = f.n || [0, 0, 1];
        // The UV a face was given, mapped into its rect in the atlas. A face with neither keeps a
        // degenerate rect and samples one texel, which is what an untextured face wants.
        const uv = f.uv || null, rc = (rectOf ? rectOf(f) : f.rect) || [0, 0, 0, 0];
        const u0 = rc[0], v0 = rc[1], du = rc[2] - rc[0], dv = rc[3] - rc[1];
        const cr = r / 255, cg = g / 255, cb = b / 255;
        const fa = f.alpha == null ? 1 : f.alpha;
        const flat = f.kind === 'flat' ? 1 : 0;
        // The ramp is the vertex's height within its OWN face, 0 at the top: the 2-D renderer paints
        // its light as a gradient down each wall, so a shader that wants the same picture needs to
        // know where in the wall it is. A horizontal face has no extent and takes the top end.
        let z0 = Infinity, z1 = -Infinity;
        for (const p of f.p) { if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2]; }
        const dz = (z1 - z0) || 1;
        for (let i = 1; i + 1 < f.p.length; i++) {
          for (let e = 0; e < 3; e++) {
            const k = e === 0 ? 0 : i + e - 1;
            const p = f.p[k], t = uv ? uv[k] : null;
            data[o] = p[0] + ox; data[o + 1] = p[1] + oy; data[o + 2] = p[2];
            data[o + 3] = n[0]; data[o + 4] = n[1]; data[o + 5] = n[2];
            data[o + 6] = cr; data[o + 7] = cg; data[o + 8] = cb;
            data[o + 9] = u0 + du * (t ? t[0] : 0); data[o + 10] = v0 + dv * (t ? t[1] : 0);
            data[o + 11] = (z1 - p[2]) / dz;
            data[o + 12] = fa;
            data[o + 13] = flat;
            o += STRIDE;
          }
        }
      }
    }
    // ⚠ NO AXIS SWAP, AND THE FIRST CUT HAD ONE. It looked like the obvious hospitality to a GL
    // convention — trade y and z on the way into the buffer — but the matrix in camera.js is
    // written to take GLASS's own world coordinates (x east, y north, z up) and do the swap itself,
    // in the same expression `proj` uses. Swapping here fed it y where it wanted wz, which projects
    // every vertex somewhere off screen: a full buffer, a clean draw call, and an empty frame.
    count = verts;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const S = STRIDE * 4;
    gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(loc.normal); gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(loc.color); gl.vertexAttribPointer(loc.color, 3, gl.FLOAT, false, S, 24);
    if (loc.uv >= 0) { gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, S, 36); }
    if (loc.ramp >= 0) { gl.enableVertexAttribArray(loc.ramp); gl.vertexAttribPointer(loc.ramp, 1, gl.FLOAT, false, S, 44); }
    if (loc.alpha >= 0) { gl.enableVertexAttribArray(loc.alpha); gl.vertexAttribPointer(loc.alpha, 1, gl.FLOAT, false, S, 48); }
    if (loc.flat >= 0) { gl.enableVertexAttribArray(loc.flat); gl.vertexAttribPointer(loc.flat, 1, gl.FLOAT, false, S, 52); }
    gl.bindVertexArray(null);
    return count;
  }
  // One mesh at the origin, the way the model preview and the bench hand it over.
  function upload(faces) { return uploadGroups([{ faces }], null); }

  function draw(cam, opts = {}) {
    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // ⚠ NO BACKFACE CULL. The mesh carries every face of every solid, and a building here is not
    // guaranteed to be closed — a wall with no back, a soffit, a canopy underside. Culling would
    // delete exactly the surfaces a cab looks up at.
    gl.disable(gl.CULL_FACE);
    const sky = opts.sky || [0.09, 0.11, 0.14];
    // ⚠ PREMULTIPLIED, WHICH IS WHAT THE CANVAS IS. A transparent clear carrying a colour is not a
    // valid premultiplied pixel and fringes; a fully faded fragment must contribute nothing at all.
    const ca = opts.clearAlpha == null ? 1 : opts.clearAlpha;
    gl.clearColor(sky[0] * ca, sky[1] * ca, sky[2] * ca, ca);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (!count) return 0;

    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.viewProj, false, new Float32Array(viewProjMatrix(cam, H)));
    const k = opts.keyDir || [-0.7, 0.35, -0.7];
    gl.uniform3f(loc.keyDir, k[0], k[1], k[2]);
    const key = opts.key || [0.78, 0.59, 0.33], sh = opts.shadow || [0.13, 0.16, 0.21];
    const skyC = opts.skyTint || [0.59, 0.62, 0.59];
    gl.uniform3f(loc.key, key[0], key[1], key[2]);
    gl.uniform3f(loc.shadow, sh[0], sh[1], sh[2]);
    gl.uniform3f(loc.sky, skyC[0], skyC[1], skyC[2]);
    gl.uniform1f(loc.str, opts.str == null ? 1 : opts.str);
    const fogC = opts.fog || sky;
    gl.uniform3f(loc.fog, fogC[0], fogC[1], fogC[2]);
    gl.uniform1f(loc.fogNear, opts.fogNear == null ? 6 : opts.fogNear);
    gl.uniform1f(loc.fogFar, opts.fogFar == null ? 34 : opts.fogFar);
    gl.uniform1f(loc.fogAmt, opts.fogAmt == null ? 0 : opts.fogAmt);
    // No haze band given means none: the far edge stays solid, which is what the model preview and
    // the bench want. A world pass always gives one.
    gl.uniform1f(loc.hazeNear, opts.hazeNear == null ? 1e6 : opts.hazeNear);
    gl.uniform1f(loc.hazeFar, opts.hazeFar == null ? 1e6 + 1 : opts.hazeFar);
    gl.uniform1f(loc.vlight, opts.vlight == null ? 1 : opts.vlight);
    const textured = hasAtlas && opts.textured !== false;
    gl.uniform1f(loc.textured, textured ? 1 : 0);
    if (textured) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(loc.atlas, 0); }
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    return count;
  }

  // The lights, on the same context and the same depth buffer. Built lazily: a view that never
  // has a light never compiles the program.
  let sprites = null;
  const spriteLayer = () => (sprites || (sprites = createSpriteLayer(gl)));
  function drawSprites(cam, list) {
    if (!list || !list.length) return 0;
    const L = spriteLayer();
    L.upload(list);
    return L.draw(cam, canvas.width, canvas.height);
  }

  return { gl, upload, uploadGroups, draw, drawSprites, setAtlas, get triangles() { return count / 3; } };
}
