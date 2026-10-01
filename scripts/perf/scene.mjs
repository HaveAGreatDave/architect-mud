// A real piece of Coldwater, painted headless with the GL path on, for the perf tools.
//
// The windshield loads through the shape gates' DOM stub. A stub GL hook keeps GLASS 2 switched on
// (it reports a canvas, so the frame never falls back to the 2-D renderer) and hands back every sink
// the frame filled. The host canvas gets a context that records every call with its arguments, so a
// tool can compare the canvas half of a frame as well. Both clocks are frozen while a tool runs, so a
// clock-animated mark draws the same in every frame and two runs can be compared exactly.
//
// ⚠ The stub's other canvases still hand out a fresh 2-D context per getContext, so a cache keyed on
// a context (bakeQuadTex) misses every time here. A top allocator that's a bake is that, not a
// finding: check it in the browser first.
import { readFileSync } from 'node:fs';
import { loadWindshield, stubCanvas } from '../shapes/dom-stub.mjs';

export const PLACES = {
  halcyon: [899, 916], marrow: [916, 909], nightlife: [909, 903], residential: [903, 913], oldcoldwater: [925, 917],
};
export const SEATS = {
  cab: { cls: 'truck', height: 0, eyeH: 0.12, speed: 0.15, R: 14 },
  cockpit: { cls: 'prop', height: 0.5, speed: 0.4, R: 36 },
};

const r6 = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : typeof x === 'string' ? x : typeof x);

export async function openScene({ record = true } = {}) {
  const ws = await loadWindshield();
  const clock = globalThis.performance, wall = Date.now;
  globalThis.performance = { ...clock, now: () => 1e6 };
  Date.now = () => 1.7e12;
  const host = stubCanvas('__perf', 640, 360);
  const glCanvas = stubCanvas('__perfgl', 640, 360);
  // ⚠ THE LOG HOLDS DRAWS, NOT CALLS. Each fill, stroke, blit or text is logged with the path it
  // drew, the style it drew in and the transform and clip stack it drew under. A style set or a
  // save/restore that never reaches a draw changes nothing on screen, and a cache that skips one is
  // still drawing the same picture (the ground cache does exactly that).
  let log = [];
  const DRAW = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'fillText', 'strokeText', 'putImageData']);
  const PATH = new Set(['moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'closePath']);
  const XF = new Set(['translate', 'rotate', 'scale', 'transform', 'setTransform', 'resetTransform', 'clip', 'setLineDash']);
  const STYLE = ['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'globalCompositeOperation', 'font', 'shadowBlur', 'shadowColor', 'filter', 'lineCap', 'lineJoin', 'textAlign'];
  let path = [], xf = [], stack = [];
  const ctx = new Proxy({}, {
    get(o, k) {
      if (k === 'canvas') return { width: 640, height: 360 };
      if (k === 'measureText') return (s) => ({ width: String(s ?? '').length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => ({ addColorStop() {} });
      if (k === 'createPattern') return () => null;
      if (k === 'getImageData' || k === 'createImageData') return () => ({ data: new Uint8ClampedArray(64), width: 4, height: 4 });
      if (k in o) return o[k];
      return (...a) => {
        const call = String(k) + '(' + a.map(r6).join(',') + ')';
        if (k === 'beginPath') { path = []; return; }
        if (PATH.has(k)) { path.push(call); return; }
        if (k === 'save') { stack.push({ xf: xf.slice(), st: STYLE.map((s) => o[s]) }); return; }
        if (k === 'restore') { const t = stack.pop(); if (t) { xf = t.xf; STYLE.forEach((s, i) => { o[s] = t.st[i]; }); } return; }
        if (XF.has(k)) { xf.push(call + (k === 'clip' ? '[' + path.join(' ') + ']' : '')); return; }
        if (DRAW.has(k)) {
          const st = STYLE.map((s) => s + '=' + r6(o[s])).join(';');
          log.push(call + ' path[' + (k === 'fill' || k === 'stroke' ? path.join(' ') : '') + '] ' + st + ' xf[' + xf.join(' ') + ']');
        }
      };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
  if (record) host.getContext = () => ctx;   // the alloc tool leaves it off: formatting the log allocates
  const world = JSON.parse(readFileSync(new URL('../../client/game/flightsim-world.json', import.meta.url), 'utf8'));
  let sinks = null;
  ws.RENDER_TUNE.gl = 1;
  ws.installGLWorld((cells, cam, o) => {
    sinks = { sprites: o.sprites, strokes: o.strokes, decals: o.decals, scatter: o.scatter, ground: o.ground, bay: o.bay, curtain: o.curtain, ship: o.ship };
    return { canvas: glCanvas, faces: 0 };
  });
  const bare = { kind: 'land', biome: 'badlands', flr: 0 };
  const view = (place, seat, extra = {}) => {
    const [x, y] = Array.isArray(place) ? place : PLACES[place];
    const S = SEATS[seat], N = S.R * 2 + 1;
    const map = Array.from({ length: N }, (_, j) => Array.from({ length: N }, (_, i) => world.cells[(x + i - S.R) + ',' + (y + j - S.R)] || bare));
    return { cls: S.cls, height: S.height, eyeH: S.eyeH, speed: S.speed, map, phase: 'cruise', worldBlend: 1, hour: 13,
      weather: 'clear', wxField: null, resFloor: 1, heading: 0, mapCenter: { x, y }, ...extra };
  };
  const paint = (v) => { ws.paintWindshield('__perf', v); return sinks; };
  const takeLog = () => { const l = log; log = []; return l; };
  const close = () => { globalThis.performance = clock; Date.now = wall; ws.installGLWorld(null); };
  return { ws, view, paint, takeLog, close };
}
