// THE SAME FRAMES, BEFORE AND AFTER.
//
// Every stage of the material plan (docs/proposals/glass-materials.md) ships behind a RENDER_TUNE
// switch whose 0 is today's picture, and every stage at 1 is a look change somebody has to judge.
// `__glMaterials()` answers the second question inside one session. This answers the first, which
// spans a code change and a reload: real districts, from a cab and from the air, at noon, dusk,
// night and in a storm, saved and then compared.
//
//   await __glRefShots({ save: 'before' })      // kept in this browser's IndexedDB
//   // edit, reload the Modelshop
//   await __glRefShots({ against: 'before' })   // per shot: share of pixels moved, how far, worst
//
// ⚠ RUN `against` ONCE WITH NO CHANGE FIRST. That's the noise floor (caches warming, arm keep
// proving its sets); a stage that claims "unchanged at 0" means "inside that floor", not zero.
//
// ⚠ THE CLOCK, THE DATE AND Math.random ARE ALL PINNED, and the fade is settled before the clock
// stops (see settleFade in glbench.js): a frozen clock with no settle leaves every light dark.
import { paintWindshield } from '/client/game/js/panels/windshield.js';
import { installGL } from '/client/game/js/panels/gl/install.js';
import { PLACES, SEATS, world } from './districtcost.js';

const TIMES = [
  { tag: 'noon', hour: 12.5, weather: 'clear' },
  { tag: 'dusk', hour: 18.8, weather: 'clear' },
  { tag: 'night', hour: 23, weather: 'clear' },
  { tag: 'storm', hour: 15, weather: 'storm' },
];
// One rich district and one ordinary one. Halcyon carries the curtain glass, marble and chrome;
// Marrow Street is the brick and render most of the city is made of.
const SPOTS = ['halcyon', 'marrow'];

// One canvas for the whole session, for districtcost.js's reason: a canvas per call is a WebGL2
// context per call, and the browser loses the oldest past sixteen.
let _rig = null;
function rig(W, H) {
  if (!_rig) {
    const el = document.createElement('canvas');
    el.id = '__refshot';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0';
    holder.append(el); document.body.append(holder);
    _rig = { el, holder };
  }
  _rig.el.width = W; _rig.el.height = H;
  _rig.el.style.width = W + 'px'; _rig.el.style.height = H + 'px';
  _rig.holder.style.width = W + 'px'; _rig.holder.style.height = H + 'px';
  return { el: _rig.el, uninstall: installGL(() => _rig.el) };
}

// ── IndexedDB, because sixteen frames at 640x360 are about 15 MB and localStorage holds five ──
const DB = '__glRefShots', OS = 'runs';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function put(name, value) {
  const db = await idb();
  await new Promise((res, rej) => { const t = db.transaction(OS, 'readwrite'); t.objectStore(OS).put(value, name); t.oncomplete = res; t.onerror = () => rej(t.error); });
  db.close();
}
async function get(name) {
  const db = await idb();
  const v = await new Promise((res, rej) => { const r = db.transaction(OS).objectStore(OS).get(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  db.close();
  return v;
}

function diff(a, b) {
  let moved = 0, sum = 0, worst = 0;
  const px = a.length >> 2;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    if (d >= 2) { moved++; sum += d; }
    if (d > worst) worst = d;
  }
  return { movedPct: +(moved / px * 100).toFixed(2), meanOnMoved: moved ? +(sum / moved).toFixed(1) : 0, worst: Math.round(worst) };
}

export async function refShots({ save, against, W = 640, H = 360, settle = 24, places = SPOTS, seats = ['cab', 'air'], times = TIMES.map((t) => t.tag) } = {}) {
  const w = await world();
  const shots = {};
  const realNow = performance.now.bind(performance), realDate = Date.now, realRandom = Math.random;
  const { el, uninstall } = rig(W, H);
  const ctx = el.getContext('2d');
  // ⚠ THE WHOLE SEQUENCE RUNS TWICE AND ONLY THE SECOND IS KEPT. One canvas means one view state,
  // carried from shot to shot: the storm's wet ground, the cloud field, the fades. Without the
  // pre-pass the first shot of a fresh page followed nothing and the first shot of a second run
  // followed the last storm, and the same noon frame came back 41% different. With it, every
  // recorded shot follows the same history on every run.
  const pass = (keep) => {
    for (const place of places) for (const seatName of seats) for (const time of TIMES.filter((t) => times.includes(t.tag))) {
      const [x, y] = PLACES[place], S = SEATS[seatName], R = S.r, N = R * 2 + 1;
      const bare = { kind: 'land', biome: 'badlands', flr: 0 };
      const map = Array.from({ length: N }, (_, j) => Array.from({ length: N }, (_, i) => w.cells[(x + i - R) + ',' + (y + j - R)] || bare));
      const view = { ...S, phase: 'cruise', worldBlend: 1, hour: time.hour, weather: time.weather, map, wxField: null, resFloor: 1, heading: 30, tune: { perfDS: 0 } };
      // The same seed for every shot, so a storm's rain falls in the same streaks on both runs.
      let s = 0x2545f491;
      Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      Date.now = () => 1.7e12;
      let t = 1e6;
      for (let i = 0; i < settle; i++) { t += 33; performance.now = () => t; paintWindshield(el.id, view); }
      performance.now = () => t;
      paintWindshield(el.id, view);
      if (keep) shots[place + ' ' + seatName + ' ' + time.tag] = new Uint8ClampedArray(ctx.getImageData(0, 0, W, H).data);
    }
  };
  try {
    pass(false);
    pass(true);
  } finally {
    performance.now = realNow; Date.now = realDate; Math.random = realRandom;
    uninstall();
  }
  const run = { W, H, settle, at: new Date().toISOString(), shots };
  if (save) await put(save, run);
  if (!against) { console.log('__glRefShots', JSON.stringify({ saved: save || null, shots: Object.keys(shots).length })); return { shots: Object.keys(shots) }; }
  const ref = await get(against);
  if (!ref) { console.warn(`__glRefShots: nothing saved as '${against}'`); return null; }
  if (ref.W !== W || ref.H !== H) { console.warn(`__glRefShots: '${against}' is ${ref.W}x${ref.H}`); return null; }
  const rows = Object.keys(shots).map((k) => (ref.shots[k] ? { shot: k, ...diff(ref.shots[k], shots[k]) } : { shot: k, movedPct: null }));
  console.table(rows);
  return rows;
}

if (typeof window !== 'undefined') window.__glRefShots = refShots;
