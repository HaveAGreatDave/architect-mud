// The skyline past the map window: a tall tower outside the window the server sent is still drawn,
// to its own reach, and a short one isn't (client/shared/skyline-tall.js, windshield.js noteSkyline).
//
// The failure it exists for: the Spire and the other towers dropped out of the sky at 34 tiles, the
// same distance as a corner shop, because the window ends at 36 and nothing past it was known.
//
// It paints a cockpit frame 54 tiles south of the Spire, facing it, with a skyline list naming the
// Spire and a three-storey shop at the same range, and checks what reached the GL pass and the
// canvas. Then the same frame with GLASS 2 off, for the 2-D path.
import { loadWindshield, stubCanvas } from './dom-stub.mjs';
import { skylineFar, SKYLINE_BASE_FAR } from '../../client/shared/skyline-tall.js';

const ws = await loadWindshield();
const out = [];
const host = stubCanvas('__sky', 640, 360);
const glCanvas = stubCanvas('__skygl', 640, 360);
let draws = 0;
const ctx = new Proxy({}, {
  get(o, k) {
    if (k === 'canvas') return { width: 640, height: 360 };
    if (k === 'measureText') return (s) => ({ width: String(s ?? '').length * 20 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => ({ addColorStop() {} });
    if (k === 'createPattern') return () => null;
    if (k === 'getImageData' || k === 'createImageData') return () => ({ data: new Uint8ClampedArray(64), width: 4, height: 4 });
    if (k in o) return o[k];
    return () => { if (k === 'fill' || k === 'stroke' || k === 'fillRect') draws++; };
  },
  set(o, k, v) { o[k] = v; return true; },
});
host.getContext = () => ctx;

let cells = null;
ws.installGLWorld((c) => { cells = c; return { canvas: glCanvas, faces: 0 }; });

const SPIRE = [892, 906, 'asc_spire', 'The Spire', 30, 'west'];
const SHOP = [880, 906, 'shop', null, null, 'south'];
if (!skylineFar('asc_spire', 'The Spire', 30)) out.push('the Spire is not counted as skyline');
if (skylineFar('shop', null, null)) out.push('a three-storey shop is counted as skyline');

const R = 36, N = R * 2 + 1, bare = { kind: 'land', biome: 'badlands', flr: 0 };
const view = (x, y, extra = {}) => ({
  cls: 'prop', height: 0.5, speed: 0.4, map: Array.from({ length: N }, () => Array.from({ length: N }, () => bare)),
  phase: 'cruise', worldBlend: 1, hour: 13, weather: 'clear', wxField: null, resFloor: 1, heading: 0, mapCenter: { x, y }, ...extra,
});

// GLASS 2 on: the tower is a GL cell, with its fade pushed out to its reach.
ws.RENDER_TUNE.gl = 1;
ws.paintWindshield('__sky', view(892, 960, { skyline: [SPIRE, SHOP] }));
const spire = cells && cells.find((it) => it.c.bn === 'The Spire');
if (!spire) out.push('the Spire, 54 tiles out, never reached the GL pass');
else {
  const want = SKYLINE_BASE_FAR - skylineFar('asc_spire', 'The Spire', 30);
  if (spire.jit !== want) out.push(`the Spire's haze offset is ${spire.jit}, not ${want}: it would fade at the ordinary limit`);
  if (spire.gx !== 0 || spire.gy !== -54) out.push(`the Spire was placed at window ${spire.gx},${spire.gy}, not 0,-54`);
}
if (cells && cells.some((it) => it.c.bt === 'shop' && it.c.sky)) out.push('a shop on the skyline list was drawn past the window');

// GLASS 2 off: the canvas draws it. Compare against the same frame with no list.
ws.RENDER_TUNE.gl = 0;
ws.installGLWorld(null);
draws = 0; ws.paintWindshield('__sky', view(892, 1040)); const bareDraws = draws;   // nothing known out there
draws = 0; ws.paintWindshield('__sky', view(892, 960)); const withDraws = draws;    // list kept from the frame above
if (withDraws <= bareDraws) out.push(`with GLASS 2 off the Spire drew nothing (${withDraws} draws against ${bareDraws} with it out of reach)`);

if (out.length) { console.log('✗ skyline — ' + out.length + ' problem(s):'); for (const m of out) console.log('  ✗ ' + m); process.exit(1); }
console.log('✓ skyline: the Spire draws 54 tiles out on both renderers; a shop does not');
