// FREELOOK + NAV MARKS — the gate for the one seat nothing else opens, and the switch over it.
//
// Two things here have no other coverage in the repo.
//
// THE PANEL. `client/game/js/panels/freelook-view.js` is a seat, and no gate in this repo has ever
// MOUNTED one — every shapes script calls `paintWindshield` directly with a hand-built view. So the
// panel's own open/frame/close path is exactly the class gl/bay.mjs's ⚠ names: a stale identifier
// inside a function nothing headless enters passes `client:smoke` (it parses), `imports:smoke`
// (every named import resolves) and all 26 shape gates, and then kills the view on the first real
// frame. It is also the seat least likely to be noticed, because it is staff-only.
//
// THE SWITCH. `navMarks()` suppresses two screen-pinned overlays — the red chevron that points at a
// contact out of shot, and the waypoint target — and a detached camera suppresses them regardless.
// Both failures are silent in both directions: a switch that does nothing looks like a switch, and
// a switch that hides too much looks like a frame.
//
// ⚠ THE INSTRUMENT IS AN OP TRACE, NOT A PIXEL DIFF, which is the repo's own rule for measuring a
// GLASS change headlessly. The two signals are chosen so neither can be confused with world
// drawing: the waypoint LETTERS ITS FIELD NAME through haloLabel, so a unique string in the
// fillText trace is unambiguous; the chevron is a bare triangle with no text, so it is the `fill`
// delta.
//
// ⚠ AND A DELTA ALONE WOULD PROVE NOTHING. "Fewer ops with the flag off" is also exactly what a
// broken frame looks like, so every run asserts the world still drew and the marks-on run asserts
// the marks were there to remove in the first place.
//
// The server half (plugins/freelook) is covered by its own regress.js and is not repeated here.

// ── A COUNTING CONTEXT, INSTALLED BEFORE windshield.js LOADS ────────────────
// The shared dom-stub's context is a Proxy answering every method with a no-op. This is that Proxy
// with a tally hung off it, so the module under test cannot tell the difference — deliberately not
// a second stub, because a second stub is a second thing to keep in step with the first.
const TALLY = { ops: {}, text: [] };
const gradient = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 640, height: 360 };
      if (k === 'measureText') return (txt) => ({ width: String(txt == null ? '' : txt).length * 20 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => gradient;
      if (k === 'createPattern') return () => null;
      // Two arities, and they are not the same one — see the dom-stub's own ⚠ on this pair.
      if (k === 'getImageData' || k === 'createImageData') return (...a) => {
        const [w, h] = a.length >= 4 ? [a[2], a[3]] : [a[0], a[1]];
        const W = Math.max(1, w | 0), H = Math.max(1, h | 0);
        return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
      };
      if (k in t) return t[k];
      return (...a) => {
        TALLY.ops[k] = (TALLY.ops[k] || 0) + 1;
        if (k === 'fillText' || k === 'strokeText') TALLY.text.push(String(a[0]));
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

await import('../shapes/dom-stub.mjs');   // installs document / window / canvas globals

// ⚠ THREE THINGS THE SHARED STUB CANNOT ANSWER, and all three are browser furniture rather than
// behaviour under test — nothing that goes through that stub has ever mounted a panel.
//
// 1. `pane:claimed` / `pane:released`: every panel that takes the area pane fires these (openHelm
//    has the identical line), and the stub has no `dispatchEvent` and no `Event`.
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.window.dispatchEvent = () => true;
globalThis.dispatchEvent = globalThis.window.dispatchEvent;

// 2. The panel writes its markup with innerHTML and then finds its own parts with querySelector. A
//    browser parses that string into findable elements; the stub answers null for every lookup, so
//    the panel would die on a dereference that is correct in a browser. An element that answers
//    every lookup stands in for the PARSE — the DOM's job, not the panel's logic.
function fakeEl(tag = 'DIV') {
  return {
    tagName: tag, style: {}, dataset: {}, children: [], innerHTML: '', textContent: '',
    clientWidth: 640, clientHeight: 360, width: 640, height: 360,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext: () => makeCtx(),
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => fakeEl(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360 }),
    focus() {}, blur() {},
  };
}

// 3. The panel mints its canvas id per open (`freelook-<rand>`), so it cannot be pre-registered.
const realGet = globalThis.document.getElementById;
const canvases = new Map();
globalThis.document.getElementById = (id) => {
  if (id === 'marks-ws' || (typeof id === 'string' && id.startsWith('freelook-'))) {
    if (!canvases.has(id)) canvases.set(id, fakeEl('CANVAS'));
    return canvases.get(id);
  }
  return realGet(id);
};

// The frame callback, captured so it can be stepped by hand — the stub's rAF never fires.
let pending = null;
globalThis.requestAnimationFrame = (fn) => { pending = fn; return 1; };
globalThis.cancelAnimationFrame = () => { pending = null; };
globalThis.window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

const ws = await import('../../client/game/js/panels/windshield.js');
const fl = await import('../../client/game/js/panels/freelook-view.js');

// No GL hook is installed here, so the pass would fail safe to 0 on its own; pinning it keeps the
// whole run on one path rather than on whichever one the fallback picked.
ws.RENDER_TUNE.gl = 0;
ws.RENDER_TUNE.glFloor = 0;

let fails = 0;
const ck = (name, ok, note) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || note === undefined ? '' : ' — ' + note));
  if (!ok) fails++;
};

const R = 8;
const map = [];
for (let y = -R; y <= R; y++) {
  const row = [];
  for (let x = -R; x <= R; x++) row.push({ kind: 'land', biome: 'urban', road: 0 });
  map.push(row);
}
const sky = { hour: 21.5, weather: 'clear', wind: 4, moon: 0.5, field: null };

// ── PART 1: the panel opens, paints, re-centres and comes down ──────────────
console.log('— the freelook seat —');
ck('starts inactive', fl.isFreelookActive() === false);

const mount = fakeEl();
let api = null;
try {
  api = fl.openFreelook({ mount, gx: 918, gy: 903, map, sky, onExit: () => {} });
} catch (e) {
  ck('openFreelook does not throw', false, e.message);
}
ck('openFreelook returns its api', !!api && typeof api.setSky === 'function');
ck('…and the panel reports active', fl.isFreelookActive() === true);
ck('…and it armed a frame', typeof pending === 'function');

// ⚠ THE PANEL'S FRAME BODY IS WRAPPED IN try/catch (helm-view's rule: one throw in a loop that
// reschedules at the END freezes the view for good), so a throw inside it is SWALLOWED and logged
// once. "No throw out here" therefore proves nothing — console.error is captured, and the real
// evidence is that paintWindshield ran with this panel's payload.
const realErr = console.error;
let logged = null;
const step = (t) => {
  logged = null;
  console.error = (...a) => { logged = a.map(String).join(' '); };
  try { pending(t); } catch (e) { logged = 'threw out of the loop: ' + e.message; }
  console.error = realErr;
  return logged;
};

ck('the frame body did not throw', step(1000) === null, logged);
const lv = ws.lastViewState();
ck('paintWindshield ran', !!lv, 'lastViewState() is null — the frame never reached the renderer');
ck('…with this panel\'s own canvas', !!lv && String(lv.id).startsWith('freelook-'), lv && String(lv.id));
ck('…as an external view', !!lv && lv.external === true, lv && String(lv.external));
ck('…on the window it was handed', !!lv && lv.mapR === R, lv && String(lv.mapR));
ck('…centred on the tile it was given', !!lv && lv.mapCenter?.x === 918 && lv.mapCenter?.y === 903, JSON.stringify(lv && lv.mapCenter));
ck('…and it rearmed the loop', typeof pending === 'function');

fl.freelookSetSky({ hour: 3.25, weather: 'storm', field: { cells: [] } });
ck('a streamed sky does not throw', step(1016) === null, logged);

// Re-centring is an OPEN with a new window, never a second view — the server sends the identical
// `freelook_open` either way, so this is the path `freelook <x> <y>` takes on an open camera.
const api2 = fl.openFreelook({ mount, gx: 920, gy: 905, map, sky });
ck('re-centring keeps the same view', fl.isFreelookActive() && api2 === api);
const moved = step(1032);
const lv2 = ws.lastViewState();
ck('…and the window moved under the camera', !moved && lv2?.mapCenter?.x === 920 && lv2?.mapCenter?.y === 905, moved || JSON.stringify(lv2 && lv2.mapCenter));

try { fl.closeFreelook(); } catch (e) { ck('closeFreelook does not throw', false, e.message); }
ck('closes clean', fl.isFreelookActive() === false);
ck('…and cancels its frame', pending === null);
ck('…and a second close is harmless', (() => { try { fl.closeFreelook(); return true; } catch { return false; } })());

// ⚠ A FRESH CANVAS ID PER OPEN is the helm's own leak trap (see disposeWindshield): it is what
// makes forgetting to dispose unbounded rather than merely wasteful, so it is worth pinning that
// this panel really does mint one and really does come back up after a close.
const api3 = fl.openFreelook({ mount, gx: 900, gy: 900, map, sky, onExit: () => {} });
ck('reopens after a close', !!api3 && fl.isFreelookActive());
ck('…on a new canvas id', [...canvases.keys()].filter((k) => k.startsWith('freelook-')).length >= 2,
  `${[...canvases.keys()].filter((k) => k.startsWith('freelook-')).length} id(s) minted`);
fl.closeFreelook();

// ── PART 2: the nav-mark switch reaches the canvas ──────────────────────────
console.log('\n— the nav-mark switch —');

// A target dead ahead (heading 0 ⇒ forward is −y) so it draws its on-screen ring and letters
// itself, and a contact hard off to the side so it lands off screen and takes the chevron branch.
const NAME = 'ZZMARKER';
const baseView = () => ({
  external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1,
  heading: 0, height: 0, speed: 0, hour: 12, weather: 'clear',
  map, mapCenter: { x: 900, y: 900 }, mapOffset: { x: 0, y: 0 },
  acX: 900, acY: 900, airport: 'default',
  apTarget: { dx: 0, dy: -4, name: NAME, dist: 4, kind: 'place' },
  contacts: [{ id: 7, x: 900, y: 900, dx: -30, dy: 2, alt: 400, hdg: 90, ias: 120, bank: 0, pitch: 0,
    vs: 0, band: 'low', onGround: false, hullPct: 100, reg: 'BOGEY', cls: 'prop', altDiff: 300 }],
});

function run(mutate) {
  TALLY.ops = {}; TALLY.text = [];
  const v = baseView();
  if (mutate) mutate(v);
  ws.paintWindshield('marks-ws', v);
  return {
    total: Object.values(TALLY.ops).reduce((a, b) => a + b, 0),
    fill: TALLY.ops.fill || 0,
    named: TALLY.text.filter((t) => t.includes(NAME)).length,
  };
}

ws.navMarks(true);
const on = run();
ws.navMarks(false);
const off = run();
ws.navMarks(true);
const free = run((v) => { v.freeCam = { x: 0, y: 0, z: 1.4, yaw: 0, pitch: 0, roll: 0, fov: 1 }; });
ws.navMarks(true);   // leave the flag as it was found

console.log(`    marks on   ${on.total} ops · ${on.fill} fills · name ×${on.named}`);
console.log(`    marks off  ${off.total} ops · ${off.fill} fills · name ×${off.named}`);
console.log(`    freelook   ${free.total} ops · ${free.fill} fills · name ×${free.named}`);

// The control. ⚠ The floor is a few hundred rather than a few thousand, and that is the MAP rather
// than a weak test: these tiles carry no `building_type`, and a tile with no building type is flat
// grass in the flight sim — a sparse landscape frame on purpose, which is what isolates the two
// overlays from a city's worth of drawing.
ck('marks-on run drew a world', on.total > 400, String(on.total));
ck('marks-off run drew a world', off.total > 400, String(off.total));
ck('freelook run drew a world', free.total > 400, String(free.total));

ck('marks on → the waypoint letters itself', on.named > 0, `${on.named} occurrences of ${NAME}`);
ck('marks off → the waypoint is gone', off.named === 0, `${off.named} survived`);
ck('a detached camera → the waypoint is gone whatever the switch says', free.named === 0, `${free.named} survived`);

ck('marks off drops the chevron\'s fill', off.fill < on.fill, `on ${on.fill} vs off ${off.fill}`);
ck('a detached camera drops it too', free.fill < on.fill, `on ${on.fill} vs freelook ${free.fill}`);

// And it must hide OVERLAYS, not the frame — the failure in the other direction.
const shed = (on.total - off.total) / on.total;
ck('the switch hides overlays, not the city', shed > 0 && shed < 0.25, `${(shed * 100).toFixed(2)}% of ops shed`);

console.log(fails
  ? `\n  ✗ freelook smoke — ${fails} FAILED`
  : '\n  ✓ freelook smoke — the seat mounts, paints and closes; the mark switch reaches the canvas');
process.exit(fails ? 1 : 0);
