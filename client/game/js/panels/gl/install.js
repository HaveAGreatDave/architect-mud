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

// What the last GL frame actually drew. A diagnostic rather than state: reading pixels back off a
// composited canvas is unreliable (the drawing buffer is not preserved by default), so the pass
// says what it did instead of being interrogated afterwards.
let lastStats = null;
export function glLastFrame() { return lastStats; }

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
    const L = glLightState(opts.night || 0);
    const u = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
    return (lastStats = glWorldPass(opts.id || host.id || 'ws', host, cells, cam, {
      captureModelMesh, wallTexMixed, roofTex, texEpoch, palette: paletteMap(),
    }, {
      night: opts.night, nb: opts.nb,
      draw: {
        // Transparent, because this buffer is BLITTED onto the 2-D frame rather than shown: every
        // pixel the skyline does not cover has to leave the sky and ground already painted there
        // alone. An opaque clear would blank the whole world and draw the city on the hole.
        clearAlpha: 0,
        key: u(L.key), shadow: u(L.shadow), skyTint: u(L.sky), str: L.str,
        keyDir: [L.dir[0], L.dir[1], 0.35],
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
