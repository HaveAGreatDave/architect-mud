// THE HELM SEAT — the second panel in this repo that anything mounts.
//
// `freelook-smoke.mjs` names the gap this fills: no gate had ever opened a panel, so a seat's own
// open → frame → close path is the class that "passes `client:smoke` (it parses), `imports:smoke`
// (every named import resolves) and all 26 shape gates, and then kills the view on the first real
// frame". `client/game/js/panels/helm-view.js` had none of that, and it is the seat with the most
// to go wrong quietly: it is the only one that mints a FRESH canvas id per open
// (`helm-chase-<rand>`), which `disposeWindshield`'s own note calls the difference between
// forgetting to dispose being merely wasteful and being unbounded — sixteen WebGL contexts and the
// browser starts force-losing the oldest, which in a session is the seat you are flying.
//
// ⚠ ITS FRAME BODY SWALLOWS ITS OWN THROWS, exactly as freelook's does and for the reason helm-view
// states inline: one throw in a loop that reschedules at the END freezes the view for good. So "no
// exception out here" proves nothing — console.error is captured and the real evidence is that
// `paintWindshield` ran with THIS panel's payload. A frame that silently did nothing and a frame
// that drew the basin are the same thing to a try/catch.
//
// ⚠ AND IT ASSERTS THE CHASE POSE, NOT JUST THAT SOMETHING DREW. The helm is an external cruise
// shot of the Echelon at sea level; `external`, `phase` and `height` silently drifting is a view
// that still renders, still passes every other gate, and is the wrong camera. `hideOwnShip` is the
// one flag of the four that CANNOT be checked here — `LAST_VIEW` publishes the camera's shape
// rather than every argument handed in, so asserting it would need windshield.js to expose it.
//
//   node scripts/client/helm-smoke.mjs
import { installSeatDom, fakeEl, TALLY, step as frameStep, pending, checker } from './seat-harness.mjs';

const { canvases } = await installSeatDom(['helm-chase-']);

const ws = await import('../../client/game/js/panels/windshield.js');
const helm = await import('../../client/game/js/panels/helm-view.js');

// No GL hook is installed here, so the pass would fail safe to 0 on its own; pinning it keeps the
// whole run on one path rather than on whichever one the fallback picked.
ws.RENDER_TUNE.gl = 0;
ws.RENDER_TUNE.glFloor = 0;

const ck = checker();

console.log('— the helm seat —');

// ── the seat opens ─────────────────────────────────────────────────────────
const container = fakeEl();
let api = null;
try {
  api = helm.openHelmChase(container, { gx: 897, gy: 898, heading: 90, hour: 19, weather: 'clear' });
} catch (e) {
  ck('openHelmChase does not throw', false, e.message);
}
ck('openHelmChase returns its api', !!api && typeof api.destroy === 'function');
ck('…and it wrote its markup', typeof container.innerHTML === 'string' && container.innerHTML.length > 0);
ck('…and it armed a frame', typeof pending() === 'function');

// ── a frame reaches the renderer ───────────────────────────────────────────
const realErr = console.error;
let logged = null;
const step = (t) => {
  logged = null;
  console.error = (...a) => { logged = a.map(String).join(' '); };
  try { frameStep(t); } catch (e) { logged = 'threw out of the loop: ' + e.message; }
  console.error = realErr;
  return logged;
};

ck('the frame body did not throw', step(1000) === null, logged);
const lv = ws.lastViewState();
ck('paintWindshield ran', !!lv, 'lastViewState() is null — the frame never reached the renderer');
ck('…with this panel\'s own canvas', !!lv && String(lv.id).startsWith('helm-chase-'), lv && String(lv.id));
ck('…as an EXTERNAL view', !!lv && lv.external === true, lv && String(lv.external));
// ⚠ `hideOwnShip` IS NOT PUBLISHED, so it cannot be asserted here — `LAST_VIEW` carries the
// camera's shape (external, phase, worldBlend, height, mapR) and not every flag handed in. What
// IS observable is the rest of the chase pose, and it is the half that would be visibly wrong:
// the helm is a cruise shot of the Echelon at sea level, so a phase or a height that drifts is a
// different camera that still renders and still passes every other gate.
ck('…in the cruise phase', !!lv && lv.phase === 'cruise', lv && String(lv.phase));
ck('…at sea level', !!lv && lv.height === 0, lv && String(lv.height));
ck('…over the full world, not a crossfade', !!lv && lv.worldBlend === 1, lv && String(lv.worldBlend));
ck('…on its own minted canvas id', [...canvases.keys()].some((k) => k.startsWith('helm-chase-')),
  [...canvases.keys()].join(', ') || 'none minted');
ck('…centred on the tile it was given', !!lv && lv.mapCenter?.x === 897 && lv.mapCenter?.y === 898,
  JSON.stringify(lv && lv.mapCenter));
ck('…and it rearmed the loop', typeof pending() === 'function');
ck('…and the world actually drew', Object.keys(TALLY.ops).length > 0, 'no canvas ops at all');

// ── the api moves the ship rather than throwing ────────────────────────────
for (const [name, run] of [
  ['setHeading', () => api.setHeading(180)],
  ['setCourse/steerBy', () => (api.steerBy ? api.steerBy(1) : api.setHeading(181))],
  ['setHour', () => api.setHour(3.5)],
  ['setWeather', () => api.setWeather('storm')],
  ['setPosition', () => api.setPosition(900, 901)],
]) {
  let ok = true, why;
  try { run(); } catch (e) { ok = false; why = e.message; }
  ck(`${name} does not throw`, ok, why);
}
ck('a frame after all of that still draws', step(1016) === null, logged);
const lv2 = ws.lastViewState();
ck('…and the window followed setPosition', !!lv2 && lv2.mapCenter?.x === 900 && lv2.mapCenter?.y === 901,
  JSON.stringify(lv2 && lv2.mapCenter));

// ── it comes down, and comes back ──────────────────────────────────────────
try { api.destroy(); } catch (e) { ck('destroy does not throw', false, e.message); }
ck('destroy cancels its frame', pending() === null);
ck('…and empties the container', container.innerHTML === '');
ck('…and a second destroy is harmless', (() => { try { api.destroy(); return true; } catch { return false; } })());

const api2 = helm.openHelmChase(fakeEl(), { gx: 897, gy: 898, heading: 0 });
ck('reopens after a destroy', !!api2 && typeof api2.destroy === 'function');
// ⚠ THE FRESH ID IS THE LEAK TRAP. A wheelhouse opened and closed repeatedly mints a new canvas
// each time; if `destroy` ever stops disposing, nothing here fails — but the count below is what
// makes the behaviour visible rather than assumed.
ck('…on a NEW canvas id', [...canvases.keys()].filter((k) => k.startsWith('helm-chase-')).length >= 2,
  `${[...canvases.keys()].filter((k) => k.startsWith('helm-chase-')).length} id(s) minted`);
api2.destroy();

const n = ck.fails();
console.log(n ? `\n✗ helm smoke — ${n} failure(s)\n` : '\n✓ helm smoke — the seat mounts, paints, steers and comes down\n');
process.exit(n ? 1 : 0);
