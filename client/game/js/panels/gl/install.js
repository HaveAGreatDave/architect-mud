// WIRING THE GL WORLD PASS INTO GLASS.
//
// windshield.js deliberately does not import any of this. Two things load that file where a GPU
// does not exist or must not be touched — the cold open, and the headless smoke suite against a DOM
// stub — so the world pass is INSTALLED from outside rather than imported in. Until something calls
// `install()`, `RENDER_TUNE.gl` does nothing whatever.
//
// This module is that call, and it is the only place that knows both halves: it hands the GL pass
// the renderer's own mesh capture, its own baked textures and its own palette, so nothing here has
// an opinion about what a building is made of.
import { installGLWorld, captureModelMesh, wallTexMixed, roofTex, texEpoch, wallPaletteInfo, glLightState, RENDER_TUNE } from '../windshield.js';
import { glWorldPass } from './world.js';
import { NEAR, FAR } from './camera.js';
import { MAX_LIGHTS } from './context.js';   // the uniform budget the light pass asks for   // the clip range the matrix is built with — see the depth-buffer note in glCapabilities

// What the last GL frame actually drew. A diagnostic rather than state: reading pixels back off a
// composited canvas is unreliable (the drawing buffer is not preserved by default), so the pass
// says what it did instead of being interrogated afterwards.
let lastStats = null;
export function glLastFrame() { return lastStats; }

// ── WHAT IS THIS MACHINE? ───────────────────────────────────────────────────
//
// GLASS 2 fails safe everywhere it can fail — no WebGL2, a lost context, a shader that will not
// compile and a texture page the device cannot hold each hand the world back to the 2-D renderer.
// What none of that tells you is WHY a particular machine went quiet, and "it turned itself off"
// is not a bug report. This answers that in one call, from a throwaway context that is released
// immediately: nothing here touches the pass or its canvas.
//
// ⚠ The atlas line is the one that matters. WebGL2 guarantees MAX_TEXTURE_SIZE ≥ 2048 and every
// surface in the city at `texRes: 2` wants 2048×4096, so a device at the floor draws flat colours
// in the worst view rather than textures — correct, deliberate, and worth being able to confirm.
export function glCapabilities() {
  const cv = document.createElement('canvas');
  const gl = cv.getContext('webgl2');
  if (!gl) return { webgl2: false, reason: 'no WebGL2 context — GLASS 2 will stay on the 2-D renderer' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const out = {
    webgl2: true,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    maxVarying: gl.getParameter(gl.MAX_VARYING_COMPONENTS),
    // ⚠ THE DEPTH BUFFER, AND WHAT THE GROUND LADDER IS WORTH ON IT. Everything on the ground
    // layer is held off the floor by a lift in WORLD z — 0.0008 to 0.004 tiles — and a depth
    // buffer stores 1/distance, so what those lifts are worth collapses as 1/f². On this machine
    // it is 24 bits and the road survives to about forty tiles unaided; at 16 it would not reach
    // ten, and the whole diagnosis that produced ground.js’s polygon offset was arithmetic
    // against 24. Reported rather than assumed, because every performance and precision number
    // in this renderer was measured on ONE discrete card.
    depthBits: gl.getParameter(gl.DEPTH_BITS),
  };
  // Priced in the device’s own depth-buffer steps: under about 1 the test cannot separate a
  // road, a kerb or a shadow from the floor it lies on, and the polygon offset in ground.js is
  // what has to carry it. That offset asks for 4 steps.
  {
    const A = (FAR + NEAR) / (FAR - NEAR), B = -2 * FAR * NEAR / (FAR - NEAR);
    const winZ = (f) => ((A + B / f) + 1) / 2;
    const lsb = 1 / (Math.pow(2, out.depthBits || 24) - 1);
    const worth = (eps, f) => +(Math.abs(winZ(f) - winZ(f + eps)) / lsb).toFixed(2);
    out.groundLadderSteps = {};
    for (const f of [10, 20, 40, 80]) {
      out.groundLadderSteps[f + ' tiles'] = { surface: worth(0.0008, f), road: worth(0.002, f), shadow: worth(0.004, f) };
    }
    out.polygonOffsetSteps = 4;
  }
  // ⚠ THESE ARE COUNTED BY HAND AND HAVE TO BE RECOUNTED WHEN A SHADER GAINS A VARYING. The mass
  // pass carries vNormal 3 + vColor 3 + vUV 2 + vRamp 1 + vDepth 1 + vAlpha 1 + vFlat 1 + vJit 1 +
  // vWorld 3 = 16, against a WebGL2 guarantee of 60. It is not close, which is exactly why the
  // number is easy to leave stale — nothing fails when it is wrong, the report just stops being
  // the answer to "will this machine run it".
  // Point lights add uniforms rather than varyings: 3 arrays of MAX_LIGHTS plus a count and a wrap,
  // 37 vectors against a guarantee of 224.
  out.needs = { attribs: 8, varyingComponents: 16, fragUniformVectors: 3 * MAX_LIGHTS + 1 };
  out.ok = out.maxAttribs >= out.needs.attribs && out.maxVarying >= out.needs.varyingComponents;
  out.atlasWorstCase = out.maxTexture >= 4096
    ? 'every surface fits, textured'
    : 'the worst view falls back to flat colours';
  const lose = gl.getExtension('WEBGL_lose_context');
  if (lose) lose.loseContext();
  return out;
}

let palette = null;
function paletteMap() {
  if (!palette) palette = new Map(wallPaletteInfo().map((p) => [p.key, p.rgb]));
  return palette;
}

// The pass is handed the canvas this frame belongs to, so installing it is a call with no
// arguments and no knowledge of which view is painting — four seats share one installation.
export function installGL(hostFor) {
  installGLWorld((cells, cam, opts) => {
    const host = (hostFor && hostFor()) || opts.host;
    if (!host) return;
    // ⚠ THE FRAME'S OWN LIGHT, NOT A SECOND DERIVATION OF IT. `glLightState` is the standalone
    // answer the Modelshop spike needs, and it has no sun to ask — so it falls back to a fixed
    // north-west fill. Used in the game that put the whole city under a key light pointing
    // somewhere the 2-D renderer's sun was not, which by day reads as every facade being in
    // shadow. `LIGHT_STATE` is what the arms are shading against this very frame; take that.
    const L = opts.light || glLightState(opts.night || 0);
    const dir = L.dir || [L.sx, L.sy];
    const u = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
    return (lastStats = glWorldPass(opts.id || host.id || 'ws', host, cells, cam, {
      captureModelMesh, wallTexMixed, roofTex, texEpoch, palette: paletteMap(),
    }, {
      sprites: opts.sprites, glLights: opts.glLights, cssW: opts.cssW, cssH: opts.cssH,
      curtain: opts.curtain, decals: opts.decals, scatter: opts.scatter, ground: opts.ground,
      floor: opts.floor, now: opts.now,
      fogBand: opts.fog ? { col: u(opts.fog.col), amt: opts.fog.amt, near: opts.fogNear, far: opts.fogFar } : null,
      night: opts.night, nb: opts.nb,
      draw: {
        // Transparent, because this buffer is BLITTED onto the 2-D frame rather than shown: every
        // pixel the skyline does not cover has to leave the sky and ground already painted there
        // alone. An opaque clear would blank the whole world and draw the city on the hole.
        clearAlpha: 0,
        worldBlend: opts.worldBlend,
        key: u(L.key), shadow: u(L.shadow), skyTint: u(L.sky), str: L.str,
        keyDir: [dir[0], dir[1], 0.35],
        // GLASS's own N64 fog — the colour it mixes toward, the amount its slider sets, over the
        // same 6..34 band (see fogWeight) — and its own far dissolve, which is a property of the
        // WINDOW rather than a constant: a truck asks for 15 tiles and an aeroplane for 34.
        fog: opts.fog ? u(opts.fog.col) : null,
        fogAmt: opts.fog ? opts.fog.amt : 0,
        hazeFar: opts.far, hazeNear: opts.far == null ? null : opts.far - (opts.haze || 0),
      },
    }));
  });
  return () => installGLWorld(null);
}

export { RENDER_TUNE };
