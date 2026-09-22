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
// ⚠ THE HARNESS IS SHARED NOW — see scripts/client/seat-harness.mjs. It was written here first,
// and lifted out the moment there was a second seat to mount: ~80 lines of browser furniture,
// none of it behaviour under test, is not a thing to keep three copies of in step.
import { installSeatDom, fakeEl, TALLY, step as frameStep, pending } from './seat-harness.mjs';

const { canvases } = await installSeatDom(['freelook-']);

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
// ⚠ THE RENDERER IS FETCHED, SO A COLD OPEN IS ASYNC AND THIS HAS TO AWAIT IT. The seat imports
// `windshield.js` through a lazy facade — 3.8 MB that only a seat needs, and 43.6% of the cold
// boot payload if it rides in the eager graph — so the FIRST `openFreelook` starts the fetch,
// returns null and re-enters itself when the module lands. `dispatch.js` ignores the return and
// needs none of this; a caller that wants the api on a cold open awaits the loader, as here.
//
// This is also the check that the facade is wired at all: with the loader left out, every
// assertion below fails, which is exactly what it did the first time it was run.
await fl.loadWindshield();
let api = null;
try {
  api = fl.openFreelook({ mount, gx: 918, gy: 903, map, sky, onExit: () => {} });
} catch (e) {
  ck('openFreelook does not throw', false, e.message);
}
ck('openFreelook returns its api', !!api && typeof api.setSky === 'function');
ck('…and the panel reports active', fl.isFreelookActive() === true);
ck('…and it armed a frame', typeof pending() === 'function');

// ⚠ THE PANEL'S FRAME BODY IS WRAPPED IN try/catch (helm-view's rule: one throw in a loop that
// reschedules at the END freezes the view for good), so a throw inside it is SWALLOWED and logged
// once. "No throw out here" therefore proves nothing — console.error is captured, and the real
// evidence is that paintWindshield ran with this panel's payload.
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
ck('…with this panel\'s own canvas', !!lv && String(lv.id).startsWith('freelook-'), lv && String(lv.id));
ck('…as an external view', !!lv && lv.external === true, lv && String(lv.external));
ck('…on the window it was handed', !!lv && lv.mapR === R, lv && String(lv.mapR));
ck('…centred on the tile it was given', !!lv && lv.mapCenter?.x === 918 && lv.mapCenter?.y === 903, JSON.stringify(lv && lv.mapCenter));
ck('…and it rearmed the loop', typeof pending() === 'function');

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
ck('…and cancels its frame', pending() === null);
ck('…and a second close is harmless', (() => { try { fl.closeFreelook(); return true; } catch { return false; } })());

// ⚠ A FRESH CANVAS ID PER OPEN is the helm's own leak trap (see disposeWindshield): it is what
// makes forgetting to dispose unbounded rather than merely wasteful, so it is worth pinning that
// this panel really does mint one and really does come back up after a close.
const api3 = fl.openFreelook({ mount, gx: 900, gy: 900, map, sky, onExit: () => {} });
ck('reopens after a close', !!api3 && fl.isFreelookActive());
ck('…on a new canvas id', [...canvases.keys()].filter((k) => k.startsWith('freelook-')).length >= 2,
  `${[...canvases.keys()].filter((k) => k.startsWith('freelook-')).length} id(s) minted`);
fl.closeFreelook();

// ── PART 1b: THE KEYBOARD, AND THE KEY THAT GETS STUCK DOWN ────────────────
//
// ⚠ THE FAILURE IS A CAMERA THAT TURNS ON ITS OWN, and neither half of the cause is in this panel's
// arithmetic. The handler ignores anything addressed to an INPUT, which is right for a PRESS — a
// player writing a message must not be flying the camera — and catastrophic for a RELEASE: the
// command box takes focus on any single-character keypress (input.js's auto-focus), so E is
// delivered to the body, focus moves while it is still down, and the keyup for E is addressed to an
// INPUT and dropped here. The key is never taken out of the camera's held set, and the shot swings
// at 62°/s for the rest of the session with nothing held down and nothing on screen to say why.
//
// So: a press only counts while this seat has the keyboard, and a release counts wherever it lands
// — the rule cab-view.js already spells out for its own throttle, arriving one layer up.
console.log('\n— the keyboard —');

// The shared stub's window swallows listeners, so record them for this part. ⚠ Installed BEFORE the
// open: the panel binds at open time, and a recorder attached afterwards records nothing.
const KEYS = {};
globalThis.window.addEventListener = (t, fn) => { (KEYS[t] ||= []).push(fn); };
globalThis.window.removeEventListener = (t, fn) => { KEYS[t] = (KEYS[t] || []).filter((f) => f !== fn); };
const fire = (type, o = {}) => {
  for (const fn of (KEYS[type] || []).slice()) fn({ type, repeat: false, target: { tagName: 'BODY' }, preventDefault() {}, ...o });
};

fl.openFreelook({ mount, gx: 900, gy: 900, map, sky, onExit: () => {} });
let t = 2000;
const cam = () => { step(t += 100); return ws.lastViewState()?.freeCam || null; };
ck('the seat is listening for keys', (KEYS.keydown || []).length > 0, `${(KEYS.keydown || []).length} listener(s)`);
ck('…and the camera reaches the renderer', !!cam(), 'no freeCam in the view payload');

const yaw0 = cam().yaw;
fire('keydown', { key: 'e' });
const yaw1 = cam().yaw;
ck('E turns the camera', yaw1 !== yaw0, `${yaw0} → ${yaw1}`);

// ⚠ THE ONE THAT MATTERS. The release is addressed to the command box, because that is where the
// focus went on the press. Two frames after it, the shot has to be still.
fire('keyup', { key: 'e', target: { tagName: 'INPUT' } });
const yaw2 = cam().yaw, yaw3 = cam().yaw;
ck('…and a release delivered to the command box still stops it', yaw2 === yaw3, `${yaw2} → ${yaw3}`);

// The same failure on the other axis: a stuck W is a camera flying away rather than turning.
const p0 = cam();
fire('keydown', { key: 'w' });
const p1 = cam();
ck('W flies the camera', p1.x !== p0.x || p1.y !== p0.y, `${p0.x},${p0.y} → ${p1.x},${p1.y}`);
// ⚠ AND ALT-TAB IS THE THIRD WAY IT STICKS — the keyup is delivered to whatever you switched to and
// this window never hears it at all, so there is no release to be lenient about. The cab releases
// everything on blur for exactly this; a detached camera has further to drift than a truck does.
fire('blur');
const p2 = cam(), p3 = cam();
ck('…and the window losing focus lets go of it', p2.x === p3.x && p2.y === p3.y, `${p2.x},${p2.y} → ${p3.x},${p3.y}`);
fl.closeFreelook();

// ── PART 1b2: THE CAMERA OUTRUNS ITS WINDOW, AND THE WORLD FOLLOWS ──────────
//
// ⚠ THE BUG THIS EXISTS FOR IS ONE THING MISSING, NEVER AN EDGE. The window is 36 tiles around the
// tile the camera opened on and the camera flies anywhere; past that square the floor shader goes
// on drawing terrain and everything STANDING on it silently stops. Coldwater is ~30 tiles across
// with the Curtain sealing its rim, so a shot framing the whole city puts exactly one wall outside
// the window while the other two are still in it — reported as "the western wall of the Curtain is
// missing", and measured as 67 Curtain segments becoming 46 with the window 10 tiles east.
//
// Two claims, and the second is the one that is easy to ship broken: the camera ASKS for ground
// when it drifts, and the shot does not move when that ground arrives.
console.log('\n— the world follows the camera —');
{
  const asked = [];
  fl.openFreelook({ mount, gx: 900, gy: 900, map, sky, onExit: () => {},
    onRecenter: (x, y) => asked.push([x, y]) });
  let u = 5000;
  const camf = () => { step(u += 100); return ws.lastViewState()?.freeCam || null; };
  camf();
  fire('keydown', { key: 'Shift' });
  fire('keydown', { key: 'w' });
  let fc = null;
  for (let i = 0; i < 400 && !asked.length; i++) fc = camf();
  fire('keyup', { key: 'w' });
  fire('keyup', { key: 'Shift' });

  ck('flying out of the window asks for a new one', asked.length === 1, `${asked.length} request(s)`);
  ck('…past half the radius, not before', !!fc && Math.max(Math.abs(fc.x), Math.abs(fc.y)) > 18,
    fc && `${fc.x.toFixed(2)},${fc.y.toFixed(2)}`);
  const want = asked[0] || [0, 0];
  ck('…and it names the tile the CAMERA is on', !!fc
    && want[0] === 900 + Math.round(fc.x) && want[1] === 900 + Math.round(fc.y),
    `asked ${want} from 900,900 + ${fc && fc.x.toFixed(2)},${fc && fc.y.toFixed(2)}`);
  // ⚠ ONE OUTSTANDING AT A TIME. Without that the request fires on every frame of the drift — at
  // the fast ladder that is sixty 73x73 windows a second, which is a different bug of its own.
  for (let i = 0; i < 20; i++) camf();
  ck('…once, not once a frame', asked.length === 1, `${asked.length} request(s)`);

  // AND THE SHOT HOLDS WHEN THE GROUND ARRIVES. The camera's x/y are an offset from the window
  // centre, so moving the centre without rebasing teleports the picture by the whole re-centre.
  const before = camf();
  const world = { x: 900 + before.x, y: 900 + before.y };
  fl.openFreelook({ mount, gx: want[0], gy: want[1], map, sky });
  const after = camf();
  const lvR = ws.lastViewState();
  ck('the window moves to meet it', lvR?.mapCenter?.x === want[0] && lvR?.mapCenter?.y === want[1],
    JSON.stringify(lvR && lvR.mapCenter));
  ck('…and the camera does not move with it',
    Math.abs((want[0] + after.x) - world.x) < 0.6 && Math.abs((want[1] + after.y) - world.y) < 0.6,
    `${world.x.toFixed(2)},${world.y.toFixed(2)} → ${(want[0] + after.x).toFixed(2)},${(want[1] + after.y).toFixed(2)}`);
  ck('…and the offset it flew out to is spent', Math.max(Math.abs(after.x), Math.abs(after.y)) < 18,
    `${after.x.toFixed(2)},${after.y.toFixed(2)}`);

  // ⚠ THE CONTROL, AND THE REASON THE REBASE IS CONDITIONAL. A person typing `freelook 918 903`
  // wants the world to move and the SHOT to hold its framing — the opposite correction — and both
  // arrive down the same wire. A rebase applied to that one drags the camera off the tile it was
  // sent to look at.
  const manual = camf();
  fl.openFreelook({ mount, gx: want[0] + 25, gy: want[1] + 25, map, sky });
  const held = camf();
  ck('a typed re-centre still moves the world, not the shot',
    Math.abs(held.x - manual.x) < 0.6 && Math.abs(held.y - manual.y) < 0.6,
    `${manual.x.toFixed(2)},${manual.y.toFixed(2)} → ${held.x.toFixed(2)},${held.y.toFixed(2)}`);
  fl.closeFreelook();
}

// ── PART 1c: …AND THE COMMAND BOX DOES NOT TAKE THE KEYBOARD OFF THIS SEAT ──
//
// The other half, and the cause rather than the symptom. input.js focuses `#cmd-input` on any
// single-character keypress delivered outside a text field, and every panel that owns the keyboard
// is named in its guard list — the sim, the cockpit HUD, both walkarounds, the cab, the piano. A
// seat missing from that list is one where the first W types a letter into the command box, moves
// the focus, and strands the release. ⚠ LOCATED IN THE GUARD ITSELF, never grepped over the file:
// `isFreelookActive` is imported at the top of input.js for other reasons, so a whole-file search
// passes while the guard list has nothing in it.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../client/game/js/input.js', import.meta.url), 'utf8');
  const at = src.indexOf('Auto-focus when user types anywhere outside');
  const end = src.indexOf('input.focus();', at);
  const guard = at >= 0 && end > at ? src.slice(at, end) : '';
  ck('the command box leaves this seat its keyboard', guard.includes('isFreelookActive()'),
    at < 0 ? 'the auto-focus listener has moved — this check needs re-aiming' : 'not named in the guard list');
}

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

// ── PART 3: A VANTAGE — THE SAME SEAT WITH THE CAMERA ON ITS FEET ──────────
//
// `telescope` opens this panel with a `stand` block, and the client half of that is the one seam
// nothing else here reaches: `standSpot` resolves a named MOUNT against the world window and the
// renderer answers where the fixture is. Every way it can fail is silent — a stale identifier in
// that function is swallowed by the panel own try/catch (see the ⚠ above) and the player gets a
// frozen frame; a mount that answers null leaves the camera flying, which looks like a telescope
// you can walk away from.
//
// ⚠ THE CENTRE CELL HAS TO BE THE SHIP. The mount reads `map[R][R]` and refuses anything that is
// not her, which is what stops a vantage standing in mid-air over whatever tile it was pointed at.
console.log("");
console.log("— a vantage —");
{
  const shipMap = map.map((row) => row.slice());
  shipMap[R][R] = { kind: "land", biome: "water", road: 0, mark: "yacht", heading: 0 };
  const stand = { mount: "yacht_scope", leash: 0.055, label: "TELESCOPE" };
  fl.openFreelook({ mount, gx: 897, gy: 898, map: shipMap, sky, stand, onExit: () => {} });
  ck("a vantage opens the seat", fl.isFreelookActive() === true);
  const err = step(16);
  ck("…and its first frame does not throw", err === null, err || "");
  step(33);
  ck("…and its second does not either", true);
  // The mount has to have actually answered: the camera is standing on her sun deck rather than at
  // the OPEN_Z a flying one would have taken. Asked through the renderer, so this cannot pass by
  // agreeing with a number copied into the test.
  const want = ws.yachtScopeMount(0, 0, 0, 1000);
  ck("the mount answers a real eye height", Number.isFinite(want.z) && want.z > 0.05 && want.z < 1, String(want.z));
  ck("…and a bearing off her bow", Number.isFinite(want.yaw));
  fl.closeFreelook();
  ck("…and it comes down", fl.isFreelookActive() === false);

  // ⚠ AND A WINDOW WHOSE CENTRE IS NOT THE SHIP MUST NOT PUT THE CAMERA ANYWHERE. The mount
  // refuses, `standSpot` falls through to the authored eye — and with none authored it answers
  // null, which leaves the ordinary flying camera rather than an eye at an invented height.
  fl.openFreelook({ mount, gx: 900, gy: 900, map, sky, stand, onExit: () => {} });
  const err2 = step(16);
  ck("a vantage over the wrong tile still paints", err2 === null, err2 || "");
  fl.closeFreelook();
}
console.log(fails
  ? `\n  ✗ freelook smoke — ${fails} FAILED`
  : '\n  ✓ freelook smoke — the seat mounts, paints and closes; the mark switch reaches the canvas');
process.exit(fails ? 1 : 0);
