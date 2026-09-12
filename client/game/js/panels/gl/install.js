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
import { installGLWorld, installGLClouds, captureModelMesh, modelSolid, wallTexMixed, roofTex, texEpoch, wallPaletteInfo, wallMaterialId, roofMaterialId, wallMaterialTable, glLightState, RENDER_TUNE } from '../windshield.js';
import { glWorldPass, glCloudPass } from './world.js';
import { NEAR, FAR } from './camera.js';
import { MAX_LIGHTS, MAX_MATERIALS } from './context.js';   // the uniform budgets the light pass and the material table ask for   // the clip range the matrix is built with — see the depth-buffer note in glCapabilities

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
  // vBakedAo 1 + vMat 1 + vWorld 3 = 18, against a WebGL2 guarantee of 60. It is not close, which is
  // exactly why the number is easy to leave stale — nothing fails when it is wrong, the report just
  // stops being the answer to "will this machine run it". ⚠ AND IT HAD GONE STALE: it read 16 and 8
  // with vBakedAo already in the shader, so the baked occlusion term had been uncounted since it
  // landed. Recount when you add one; there is nothing here that can do it for you.
  // Uniforms rather than varyings: the point lights are 3 arrays of MAX_LIGHTS plus a count and a
  // wrap, and the material table is 2 arrays of MAX_MATERIALS plus the eye, two environment colours,
  // a texel size and two strengths — ~91 vectors against a guarantee of 224.
  out.needs = { attribs: 9, varyingComponents: 18,
    fragUniformVectors: 3 * MAX_LIGHTS + 1 + 2 * MAX_MATERIALS + 6 };
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
      captureModelMesh, modelSolid, wallTexMixed, roofTex, texEpoch, palette: paletteMap(),
      // Which of the nineteen families a surface belongs to, and how each of them answers the
      // light. Both come from windshield.js because that is where the families are DECLARED — a
      // second table here would be a second opinion about what brick is, and the one thing this
      // module is for is not having one.
      wallMaterialId, roofMaterialId, matTable: wallMaterialTable(),
    }, {
      // ⚠ THIS LIST IS AN ALLOWLIST, NOT A SPREAD, so a new option added at the windshield end and
      // not added here is silently dropped one hop before the shader that reads it. Contact
      // occlusion shipped that way for an afternoon: the flag was set, the slider moved, the
      // uniform existed, and __glAO() reported 0.0% of wall pixels moved at every strength up to
      // 0.7 — which is what a correctly wired feature doing nothing looks like too. ⚠ AND IT
      // CAUGHT THE NEXT ONE: the baked per-vertex term was added at both ends, gated, measured and
      // swept before anybody read this paragraph, and reported exactly the same 0.0% at every
      // strength. The note is the only reason that took minutes instead of an afternoon.
      sprites: opts.sprites, glLights: opts.glLights, glAO: opts.glAO, glBakedAo: opts.glBakedAo, msaa: opts.msaa, cssW: opts.cssW, cssH: opts.cssH,
      // ⚠ AND `glWet` HAS TO BE HERE. This object is an ALLOWLIST, not a spread — two features have
      // shipped inert by being wired at both ends and dropped in the middle, which is exactly what
      // a missing line here produces: the tune key exists, the shader is correct, nothing happens.
      glWet: opts.glWet,
      // ⚠ AND SO DO THESE TWO, for the same reason and with the same failure. A material response
      // wired at the windshield end and dropped here reports 0.0% of wall pixels moved at every
      // strength — which is the third time that sentence has had to be written in this file.
      glMat: opts.glMat, glBump: opts.glBump,
      // And the map window's centre, for the same reason — the ground shader phases its puddles on
      // absolute world tiles off it, and dropped here they would silently crawl along the road.
      wc: opts.wc,
      // The sun's own depth pass. Both halves are needed and neither is derivable from the other:
      // `glShadow` is the strength the player set, `sun` is the frame's own light — the same two
      // numbers (`dir`, `len`) the ground hulls have always cast with, so the shadow on a wall and
      // the shadow on the pavement come from one source rather than two.
      glShadow: opts.glShadow, sun: opts.sun,
      curtain: opts.curtain, decals: opts.decals, strokes: opts.strokes, scatter: opts.scatter, ground: opts.ground,
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
        // ── WHAT A REFLECTION FINDS, AS TWO COLOURS ─────────────────────────────────────────
        //
        // An environment term needs somewhere for the reflected ray to land, and this renderer has
        // no cube map, no probe and no reason to grow one: the sky in GLASS is a vertical gradient,
        // so two colours and the ray's own elevation reproduce it. Up is the fog colour, which by
        // contract tracks the sky (pale by day, dark blue at night); down is the vertex light's own
        // base shadow, which is already the colour this renderer paints ground-side darkness.
        //
        // ⚠ WALLS ARE VERTICAL, SO THE GRADIENT HAS TO COME FROM THE REFLECTED RAY AND NOT FROM THE
        // NORMAL. Every facade in the city has the same normal elevation — zero — so a sky/ground
        // blend taken off `n` would be one flat colour on every wall and would look like a tint. It
        // is the REFLECTION that swings: the top of a tower bounces the ground into your eye and the
        // bottom bounces the sky, which is the gradient that makes a glass building read as glass
        // and which moves as you drive past it.
        envUp: opts.fog ? u(opts.fog.col) : u(L.sky),
        envDn: u(L.shadow),
        hazeFar: opts.far, hazeNear: opts.far == null ? null : opts.far - (opts.haze || 0),
      },
    }));
  });
  // The deck, on the same scene and the same depth buffer, from where the 2-D queue has always
  // drawn it. Its own installation because it is called at a different MOMENT — after the world
  // blit — and a moment is not something one hook can express twice.
  installGLClouds((cam, cards, opts) => {
    const out = glCloudPass(opts.id || (hostFor && hostFor() || {}).id || 'ws', cam, cards, opts);
    // Recorded on the world pass own stats rather than in a second place, so glLastFrame() stays the
    // one answer to what the GPU drew this frame — and so a deck that quietly stopped drawing shows
    // up as a zero next to the faces rather than not at all.
    if (lastStats) lastStats.cloudCards = out ? out.cards : 0;
    return out;
  });
  return () => { installGLWorld(null); installGLClouds(null); };
}

export { RENDER_TUNE };
