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
import { installGLWorld, captureModelMesh, wallTexMixed, roofTex, wallPaletteInfo, glLightState, RENDER_TUNE } from '../windshield.js';
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

// `hostFor` answers "which canvas is this frame being drawn into" — the GL canvas is inserted as its
// sibling, so the pass needs the element rather than the id alone.
export function installGL(hostFor) {
  installGLWorld((cells, cam, opts) => {
    const host = hostFor();
    if (!host) return;
    const L = glLightState(opts.night || 0);
    const u = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
    lastStats = glWorldPass(host.id || 'ws', host, cells, cam, {
      captureModelMesh, wallTexMixed, roofTex, palette: paletteMap(),
    }, {
      night: opts.night, nb: opts.nb,
      draw: {
        // The sky the 2-D pass is painting behind it, so the GL canvas does not show as a black
        // rectangle through every gap in the skyline. Transparent, and the 2-D sky shows through.
        clearAlpha: 0,
        key: u(L.key), shadow: u(L.shadow), skyTint: u(L.sky), str: L.str,
        keyDir: [L.dir[0], L.dir[1], 0.35],
        fogNear: 18, fogFar: 40,
      },
    });
  });
  return () => installGLWorld(null);
}

export { RENDER_TUNE };
