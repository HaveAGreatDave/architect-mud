// FREELOOK — the detached camera with no vehicle under it.
//
// The three seats in this renderer (cab-view, cockpit, helm-view) are each a vehicle with a camera
// bolted to it, and each of them can take that camera off its mount. This is the camera with the
// vehicle deleted: a world window, a sky, and freecam.js flying through it.
//
// ⚠ IT IS ALMOST ENTIRELY OTHER PEOPLE'S CODE, AND THAT IS THE POINT. `paintWindshield` is handed
// the same shape the helm hands it — `external` + `hideOwnShip`, a map, a centre, a sky — so every
// building, light, sign, cloud, shadow and blade of grass is drawn by the renderer that draws them
// everywhere else. There is no second scene here and there must never be one: the whole worth of
// this view is that what you are looking at is what the game looks like.
//
// ⚠ AND THERE IS NO SUBJECT. The three seats frame a vehicle; this frames nothing, so the camera
// opens already detached and can never be stowed back onto a mount that does not exist. `O` and the
// ✕ close the VIEW rather than the camera — which is the one place this deliberately reads
// differently from the seats, and the hint says so.
//
// The server half is plugins/freelook/. Nothing here decides anything: the window and the sky
// arrive, and closing fires the ordinary `freelook close` verb so the server drops the viewer row
// rather than this file assuming it did.

// ⚠ THROUGH THE LAZY FACADE, NOT THE MODULE. `windshield.js` is 3.8 MB and with `aircraft3d.js`
// behind it is 43.6% of the cold boot payload — and a seat is the only thing that ever needs it.
// Imported directly it sits in the eager graph, so every player who has never opened a view
// downloads and parses the whole 3-D stack before they can type `look`. The facade has the same
// export names, so nothing below this line changed; what changed is that the bytes arrive when the
// seat is opened. See scripts/client/bake-lazy-view.mjs.
import { loadWindshield, isLoaded as windshieldLoaded, paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield, normalizeWx, navMarks, raptorsNow, yachtScopeMount, yachtDeckEye, modelTopZAt, curtainTopZAt, groundObstructionAt, doorBayAt, parkTopAt, streetKitFootAt, streetKitDeckAt, streetKitLiftPress, streetKitLiftBoard, bayFootSolid, bayDims, ROAD_RIG_MUL, viewFocal, viewLatFocal } from './windshield-lazy.js';
export { loadWindshield };
import { createFreeCam, freeCamHint, freeCamTouchUI, bindFreeCamPointer, bindFreeCamIdle } from './freecam.js';
import { makeContactTrack } from './world-feed.js';
import { internMap } from './map-intern.js';
import { seatLadderHTML, bindSeatLadder, releaseSeatLadder, keepSeatRung } from './seat-ladder.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';
import { setSprayStage, clearSprayStage } from './spray-aim.js';
import { footDockHTML, bindFootDock } from './foot-dock.js';
import { floorZAt } from './seabed-scene.js';
import { interiorRoomsOf } from './room-interiors.js';
import { noteDoor, noteCarry } from './lobby-still.js';
import { preVeil } from './glass-veil.js';
import { roomFree, openingCrossed, openingInside } from '../../../shared/room-layout.js';   // a building's rooms, drawn in the city (docs/proposals/one-world-interiors.md)
import { FT_M, m2t as m2tf } from '../../../shared/world-scale.js';
import { measureDoorway } from './glass/doorway-measure.js';   // a street door's opening, read off its building's mass
// The rooms the server sent for the buildings near you on foot, kept for the view (each building once, by its tile)
function keepInteriors(s, list) {
  const by = new Map((s.interiors || []).map((r) => [r.key, r]));
  let unplaced = false;
  for (const b of list) {
    const shift = doorShift(s, b.tile);
    if (!shift) unplaced = true;
    for (const r of interiorRoomsOf(b, { shift })) by.set(r.key, r);
  }
  s.interiors = [...by.values()];
  // a building whose doorway couldn't be measured yet is placed again when it can (doorLeaves)
  s.interiorsLater = unplaced ? list : null;
}
// From where the plan stands a building's street door (the middle of its tile's street edge, room-view.js anchorOf)
// to the doorway its model drew, in tiles: along the front to the doorway's middle, and in to the plane behind its
// leaves. Null until the doorway can be measured (the renderer and the map window are in).
const PLAN_EDGE = 0.47;
function doorShift(s, tile) {
  const d = tile && s.foot?.doors?.find((q) => q.gx === tile.x && q.gy === tile.y);
  const g = d && s.map ? doorway(s, d) : null, E = d && EDGE_VEC[d.edge];
  if (!g || !g.leaves || !E) return null;
  const along = g.cx || 0, deep = (g.back ?? g.wall) - PLAN_EDGE;
  return [along * E[1] + deep * E[0], -along * E[0] + deep * E[1]];
}
import { suppressWeatherFx } from './weather-fx.js';   // the 2-D overlay would paint its rain and rainbow over the 3-D scene   // the ground or seabed under the camera (plugins/submersible)

// Live world clock/weather through the shared env system — loaded OPTIONALLY, exactly as helm-view
// loads it, so a context that cannot provide it still runs on the sky the server sent rather than
// failing the whole module at import time.
let _getEnvSnapshot = null;
import('./environment.js').then((m) => { _getEnvSnapshot = m.getEnvSnapshot; }).catch(() => {});

function liveEnv() {
  if (!_getEnvSnapshot) return null;
  try {
    const s = _getEnvSnapshot();
    if (!s || !s.time) return null;
    const [h, m] = s.time.split(':').map(Number);
    return { hour: (h || 0) + (m || 0) / 60, weather: normalizeWx(s.weatherType), moon: s.moonPhase };
  } catch { return null; }
}

// Where the camera stands when it opens: a little above head height, looking north. Not on the
// ground — a camera that opens with its lens in the tarmac reads as broken — and not up in the air
// either, because the first thing anybody wants to see is the street they typed the verb on.
const OPEN_Z = 1.4;

// ── ⚠ THE CAMERA CAN OUTRUN ITS OWN WORLD, AND NOTHING SAID SO ───────────────
//
// The window the server sends is `FLIGHT_RADIUS` (36) tiles around the tile the camera OPENED on,
// and this camera then flies anywhere it likes. Past the edge of that square there are no cells at
// all — so the ground goes on (the floor shader draws terrain from its own LUT) and everything
// STANDING on it silently stops: buildings, lights, signs, and the Architect's Curtain.
//
// ⚠ IT PRESENTS AS ONE THING MISSING, NEVER AS AN EDGE. That is what makes it hard to read: the
// city is 30 tiles across and the walls seal its rim, so flying the camera out to frame the whole
// place puts exactly one wall past the window while the other two are still in it. Reported as
// "the western wall of the Curtain is missing", and measured: the same shot with the window centred
// 10 tiles east uploads 46 Curtain segments instead of 67 — the west run's 19, gone, with nothing
// in any log and the rest of the frame perfect.
//
// So the world follows the camera. `freelook <x> <y>` is already a re-centre the server and
// `openFreelook` both understand, and this is that verb fired by the camera rather than by a
// person. Half the radius is the drift it allows: at 18 tiles the nearest hole is still further
// than most shots reach, and a window push costs a 73×73 payload, so the number is a budget as
// much as a distance (this is a staff view, but a push every couple of seconds is still a push).
const RECENTER_R = 18;

// ── STANDING SOMEWHERE, RATHER THAN FLYING ───────────────────────────────────
//
// The same view with the camera on its feet: a vantage — a telescope on a sun deck, and whatever
// else gets bolted down later — opens this with a `stand` block and gets mouse-look and WASD inside
// a leash instead of a camera that flies. Everything else about the view is the one above: the same
// window, the same sky, the same renderer, the same way out.
//
// ⚠ AND THE EYE HEIGHT IS THE RENDERER'S TO ANSWER, WHICH IS WHY THERE IS A MOUNT TABLE AND NOT A
// NUMBER ON THE WIRE. A telescope on the Echelon's sun deck stands on a deck whose height is a
// property of her MODEL and whose position is a function of the swell — neither of which the server
// knows or should. So a vantage names a mount, the renderer answers where that is, and the number
// is never written down twice. A vantage with no mount may still author a plain `eye`, which is
// right for anything standing on ground that does not move.
//
// ⚠ THE CENTRE CELL IS THE SHIP. `mapWindow` centres on her tile, so the thing this camera is
// standing on is `map[R][R]`, and `heading` on that cell is the course she is lying on — the same
// field `drawYacht` is handed. Read per frame rather than captured, because she swings at anchor.
const MOUNTS = {
  yacht_scope(map, R, now) {
    const c = map?.[R]?.[R];
    if (!c || c.mark !== 'yacht') return null;
    return yachtScopeMount(0, 0, c.heading || 0, now);
  },
};

// ── A VANTAGE BUYS ITSELF MORE OF THE CITY ───────────────────────────────────
//
// Every LOD number in this renderer is set for a camera that is MOVING: a cab doing 50 through a
// dense night block has a frame budget, and `lodNear`, `decoFar` and `glowFar` are where it is
// spent. A vantage has none of that. It is bolted down, the world in front of it is the same world
// it was a second ago, and what it is FOR is looking at the far side of the Basin — so it is the one
// seat in the game that can afford to draw more and the one where drawing less is most obviously
// wrong. A telescope that showed you a coarser city than the truck you drove there in is a
// telescope with the lens in backwards.
//
// ⚠ IT GOES THROUGH `tune`, THE PER-SEAT SEAM, AND NOT THROUGH `RENDER_TUNE`. These are the player's
// own sliders; a view that wrote them would raise the detail for the cab they get into next and
// there would be nothing on screen saying why their frame rate had changed. `resolveTune` rebuilds
// the merge from `RENDER_TUNE` every frame, so a slider the player moves still reaches this seat.
//
// ⚠ AND EVERY KEY HERE IS IN `VIEW_TUNABLE`. One that is not is dropped with a console warning and
// nothing else — a detail setting that silently does nothing looks exactly like one that is already
// at its ceiling. `detailNear` is deliberately absent from that set and so is not here: it is the
// ring the near adornment tier runs in, and its own gate records 3→6 taking a dense night block
// from 21.0 ms to 24.3.
//
// ⚠ AND `texRes` IS DELIBERATELY NOT HERE, THOUGH IT IS TUNABLE. It is the one detail knob that can
// make the picture WORSE rather than slower: every surface in the city at 2 wants a 2048×4096 atlas
// page, the WebGL2 floor guarantee is only 2048 square, and `buildAtlas` answers a page it cannot
// fit by dropping the whole city to flat palette colours with one warning. A vantage that traded a
// crisper wall for a city with no texture on it at all would be the opposite of this feature.
const STAND_TUNE = { lodNear: 32, decoFar: 26, glowFar: 20, shadowFar: 26 };

// ON FOOT IS NOT A VANTAGE. On foot is standing too (freeCam.standing), so it picked up STAND_TUNE and drew
// the telescope's city: full models out to 32 tiles and every ring wider than a cab's, round an eye 1.6 m up
// a street whose own fronts hide most of that. So walking gets rings between the window view's (room-view.js
// TUNE) and a cab's: the near street at full detail, the far city as the governor leaves it. The city past
// 14 tiles is the skyline backdrop (farMax): perf:move --room 0 --gl --lite, turning, 41.7 ms a frame to 35.
const FOOT_TUNE = { lodNear: 12, decoFar: 12, glowFar: 11, shadowFar: 10, farMax: 14 };

// What the hint calls each raptor raptorsNow can report.
const RAPTOR_NAME = { peregrine: 'peregrine', hawk: 'red-tailed hawk' };

// How far the eye can back off a followed bird before it is inside something: a building's mass
// (solid from the ground up to modelTopZAt), the Curtain, or the ground. freecam's `setTrackReach`.
// Marched from REACH_SKIP out rather than from the bird, because a perched bird is sitting ON the mass
// and the line would hit it at once. Offset tiles in, like the camera's own.
const REACH_STEP = 0.02, REACH_SKIP = 0.06, REACH_PAD = 0.015;
function reachFrom(s, x, y, z, ux, uy, uz, max) {
  if (!s?.map) return Infinity;
  const R = (s.map.length - 1) / 2;
  for (let d = REACH_SKIP; d <= max; d += REACH_STEP) {
    const ox = x + ux * d, oy = y + uy * d, pz = z + uz * d;
    const px = s.gx + ox, py = s.gy + oy, wx = Math.round(px), wy = Math.round(py);
    const c = s.map[wy - s.gy + R]?.[wx - s.gx + R];
    let top = floorZAt(ox, oy);
    if (c) top = Math.max(top, modelTopZAt(wx, wy, c, px, py) || 0, curtainTopZAt(wx, wy, c, px, py) || 0);
    if (pz < top + REACH_PAD) return d - REACH_STEP;
  }
  return Infinity;
}

let st = null;

// A warm street view (`prewarm`, openFreelook) is built and painted but not on screen: it isn't the active view.
export function isFreelookActive() { return !!st && !st.warm; }
// Drop a warm street view nobody walked out into (room-stage.js, when the Stage closes another way).
export function dropWarmFreelook() { if (st?.warm) closeFreelook(); }
// A warm view that has finished its first paints and gone to rest: walking out onto it shows it at once.
export function warmFreelookReady() { return !!st && st.warm && !st.raf; }
// ⚠ A WARM VIEW IS PAINTED WHERE IT CAN'T BE SEEN. A GL canvas that's display:none has no size and draws nothing,
// and its first paints are the whole point (they compile the shaders and build the city), so it stands over the
// game pane at full size, see-through and behind everything.
function warmHolder() {
  const r = document.getElementById('area-content')?.getBoundingClientRect(), el = document.createElement('div');
  el.className = 'fl-warm'; el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { position: 'fixed', left: `${r?.left || 0}px`, top: `${r?.top || 0}px`, width: `${r?.width || globalThis.innerWidth || 1280}px`, height: `${r?.height || globalThis.innerHeight || 720}px`, opacity: '0', pointerEvents: 'none', zIndex: '-1', overflow: 'hidden' });
  document.body.appendChild(el);
  return el;
}
// The real open of the doorstep a warm view was built for: it goes into the pane as it is, already painted, takes
// the server's own window and sky, and wakes (the keyboard, the seat ladder, the frames).
function wakeWarm(ctx) {
  const s = st, mount = ctx.mount || document.getElementById('area-content');
  if (!mount) { closeFreelook(); return null; }
  s.warm = false;
  mount.innerHTML = '';
  mount.appendChild(s.root);
  s.holder?.remove(); s.holder = null; s.mount = mount;
  reseat(s, ctx);
  if (ctx.onExit) s.onExit = ctx.onExit;
  s.onRecenter = ctx.onRecenter || null;
  if (s.foot && ctx.onMove) s.foot.onMove = ctx.onMove;
  s.wake();
  return s.api;
}
// A street view that's already built, given the window the server has just sent and stood on the doorstep in it.
// The view may have been built for this doorstep (`prewarm`) or left by somebody who walked in somewhere else
// (parkFreelook), so the window moves to the new centre and the camera goes to the door, facing out.
function reseat(s, ctx) {
  const gx = ctx.gx ?? s.gx, gy = ctx.gy ?? s.gy;
  if (ctx.map) s.map = s.map ? internMap(s.map, s.gx, s.gy, ctx.map, gx, gy) : ctx.map;
  s.gx = gx; s.gy = gy; s.want = null;
  if (ctx.skyline) s.skyline = ctx.skyline;
  if (ctx.roads !== undefined) s.roads = ctx.roads || null;
  if (ctx.regions) s.regions = ctx.regions;
  freelookSetSky(ctx.sky); freelookSetActors(ctx.actors); freelookSetContacts(ctx.contacts);
  if (ctx.stand?.foot) s.stand = ctx.stand;
  if (s.foot) {
    s.foot.tile = { gx: ctx.stand?.step?.gx ?? gx, gy: ctx.stand?.step?.gy ?? gy };
    s.foot.server = { ...s.foot.tile }; s.foot.sent = null;
    s.foot.pending = null; s.foot.crouched = false; s.foot.eyeK = 1; s.foot.lift = 0; s.foot.spin.clear();
    s.foot.doors = ctx.doors || s.foot.doors || [];
    if (ctx.interiors) keepInteriors(s, ctx.interiors);
  }
  s.seat();
}

// IN OFF THE STREET (dispatch.js `freelook_close` with `indoors`): the Room Stage is about to take the pane. The
// street view isn't thrown away, because the next thing most people do in a lobby is walk back out of it: it's put
// to sleep where a warm one waits (warmHolder), and walking out wakes it. Its last frame is left over the pane
// until the room has drawn one of its own (room-stage.js fades `.fl-cover`), so there's no frame of neither.
const COVER_MS = 420, FADE_MS = 260, DOOR_FADE_MS = 520;
export function parkFreelook() {
  const s = st;
  if (!s || s.warm || !s.foot || !s.woke) { closeFreelook(); return; }
  // the keys held go through the door with you (room-stage.js takes them for its walker)
  noteCarry(s.freeCam.heldKeys?.(), false);
  // the cover went up at the door (enterCover); a frame taken now would be from inside the model's shell
  if (!document.querySelector('.fl-cover[data-entry]')) coverPane(s);
  keepSeatRung();
  s.sleep();
  s.warm = true; s.warmT0 = 0;
  s.holder = warmHolder();
  s.holder.appendChild(s.root);
  if (s.mount) s.mount.innerHTML = '';
  s.mount = s.holder;
  s.foot.pending = null;
  // ⚠ THE BLACK HOLDS UNTIL THE ROOM IS IN. The Stage loads lazily and can take well over 3 s on a cold cache or a
  // phone, and lifting the cover then showed the street again before the lobby came. So it waits for the room
  // (room-stage.js arrive fades it) and gives the page back only if nothing has come in 20 s.
  const t0 = performance.now();
  const wait = () => {
    if (document.getElementById('room-stage')) return;
    if (performance.now() - t0 < 20000) { setTimeout(wait, 250); return; }
    releaseSeatLadder();
    uncoverPane();
    if (st === s && s.warm) closeFreelook();
  };
  setTimeout(wait, 250);
}
// ⚠ AT THE DOOR, NOT AT THE ANSWER. The step through a door is sent the moment the eye crosses into the
// building's tile, and the server's answer takes a round trip; walking on in that time put the camera inside the
// model's shell, and you saw out through the back of its walls. So the cover (and the lobby still) go up as the
// step is sent, from the last frame still outside, and a refused step takes them down again (watchFoot).
function enterCover(s, d = null) {
  coverPane(s, d);
  for (const el of document.querySelectorAll('.fl-cover')) el.dataset.entry = '1';
}
function coverPane(s, door = null) {
  try {
    const wrap = s.root.querySelector('.ws-wrap') || s.root, r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // a GL canvas keeps nothing after its frame, so it's painted and copied in the same task
    s.paint?.(performance.now());
    const k = Math.min(2, globalThis.devicePixelRatio || 1), snap = document.createElement('canvas');
    snap.width = Math.round(r.width * k); snap.height = Math.round(r.height * k);
    const g = snap.getContext('2d');
    for (const cv of wrap.querySelectorAll('canvas')) {
      const b = cv.getBoundingClientRect();
      if (!cv.width || !b.width || getComputedStyle(cv).display === 'none') continue;
      g.drawImage(cv, (b.left - r.left) * k, (b.top - r.top) * k, b.width * k, b.height * k);
    }
    snap.className = 'fl-cover'; snap.setAttribute('aria-hidden', 'true');
    Object.assign(snap.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: '9000', pointerEvents: 'none', opacity: '1', transition: `opacity ${COVER_MS}ms ease-out` });
    uncoverPane(true);
    document.body.appendChild(snap);
    // through the door: the street fades to black, the Room Stage's loading veil comes up out of the black with the
    // building on it (plugins/roomstage entryCard, sent with the doors), and the room fades in out of all of it when
    // it's drawn (room-stage.js arrive, which runs the veil's bar to the end).
    const dark = document.createElement('div');
    dark.className = 'fl-cover'; dark.setAttribute('aria-hidden', 'true');
    Object.assign(dark.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: '9001', pointerEvents: 'none', background: 'var(--bg, #000)', opacity: '0', transition: `opacity ${door ? DOOR_FADE_MS : FADE_MS}ms ease-in`, display: 'flex', alignItems: 'center', justifyContent: 'center' });
    const fade = door ? DOOR_FADE_MS : FADE_MS;
    dark.dataset.t = String(performance.now() + fade);
    document.body.appendChild(dark);
    // the loading ring at once, over the street's last frame, so the step in answers the moment it's taken; the veil
    // (z 9002) comes up over it once the street has faded, and it goes with the covers
    const ring = document.createElement('div');
    ring.className = 'fl-cover'; ring.setAttribute('aria-hidden', 'true');
    Object.assign(ring.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: '9001', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: '1', transition: `opacity ${COVER_MS}ms ease-out` });
    ring.dataset.t = dark.dataset.t;
    ring.innerHTML = '<div class="fl-loading"></div>';
    document.body.appendChild(ring);
    const p = door?.place, veil = preVeil('room-stage', r, { delay: fade, ttl: 21000, place: p?.name
      ? { kicker: 'ENTERING', title: p.name, sub: [p.street, p.region].filter(Boolean).join(' · '), blurb: p.blurb || '', room: true } : { room: true } });
    // it goes with the cover: faded off by whatever takes the pane, or by uncoverPane
    if (veil) { veil.classList.add('fl-cover'); veil.dataset.t = dark.dataset.t; veil.style.transition = `opacity ${COVER_MS}ms ease-out`; }
    else dark.innerHTML = '<div class="fl-loading"></div>';
    // through a door, the last frame keeps going: it eases on in through the doorway while the dark comes up, so the
    // step in doesn't stop dead on a still
    if (door) { snap.style.transformOrigin = '50% 55%'; snap.style.transition += `, transform ${DOOR_FADE_MS + COVER_MS}ms cubic-bezier(0.3, 0, 0.4, 1)`; }
    requestAnimationFrame(() => requestAnimationFrame(() => { dark.style.opacity = '1'; if (door) snap.style.transform = 'scale(1.08)'; }));
    // no answer in 4 s and nothing came to take the pane: the street again. Once the view's been parked for a room
    // (parkFreelook) or the Stage is up and building, the cover waits for the room (room-stage.js arrive).
    setTimeout(() => { if (st?.warm || document.getElementById('room-stage')) return; uncoverPane(); }, 4000);
  } catch { /* a cut, as it was */ }
}
// The street's last frame fades off whatever took the pane (the Room Stage calls this by its class name).
export function uncoverPane(now = false) {
  for (const el of document.querySelectorAll('.fl-cover')) {
    if (now) { el.remove(); continue; }
    el.style.opacity = '0';
    setTimeout(() => el.remove(), COVER_MS + 100);
  }
}
// `__freeLook()` in the console: the live view state, so a shot can be framed exactly
// (`__freeLook().freeCam.open({ z, pitch, yaw })`) where the mouse would take a minute of nudging.
if (typeof window !== 'undefined') window.__freeLook = () => st;

// Who is standing in the window (server/engine/street-actors.js), absolute tiles. An empty list is a
// real answer; only an absent one keeps the last.
export function freelookSetActors(actors) {
  if (st && actors !== undefined) st.actors = actors || [];
}

// Everything moving in the window (aircraft, boats, trucks), absolute tiles, once a second from
// plugins/freelook. Dead-reckoned between pushes by the track (world-feed.js). An empty list clears.
export function freelookSetContacts(list) {
  if (st && list !== undefined) st.contacts.update(list || []);
}

export function freelookSetSky(sky) {
  if (!st || !sky) return;
  st.field = sky.field || st.field;
  st.ground = sky.ground || st.ground;
  if (typeof sky.hour === 'number') st.hour = sky.hour;
  if (sky.weather) st.weather = String(sky.weather).toLowerCase();
  if (sky.moon != null) st.moon = sky.moon;
  st.event = sky.event || null;
}

export function openFreelook(ctx = {}) {
  const mount = ctx.mount || document.getElementById('area-content');
  // (a warm view is built in a holder of its own, so it needs no pane)
  if (!mount && !ctx.prewarm) return null;
  // ⚠ THE FIRST OPEN FETCHES THE RENDERER AND SO RETURNS null, WHICH IS A CHANGE OF CONTRACT AND
  // IS SAID HERE BECAUSE NOTHING ELSE WOULD SAY IT. The seat re-enters itself once the module is
  // in and opens exactly as before; every open after that is synchronous, because the facade
  // caches. `dispatch.js` ignores the return, which is what makes this safe there — a caller that
  // needs the api on a cold open awaits `loadWindshield()` first, as the smoke does.
  if (!windshieldLoaded()) { loadWindshield().then(() => openFreelook(ctx)).catch(() => {}); return null; }
  // ⚠ THE STREET OUTSIDE A LOBBY, WARMED (`prewarm`, plugins/freelook): built hidden so walking out through the doors
  // shows it at once, no loading screen. It takes nothing (keyboard, seat ladder, weather) until the real open of the
  // same doorstep wakes it, and a view somebody is using always wins.
  if (ctx.prewarm) {
    if (st && !st.warm) return null;
    if (st?.warm && st.gx === ctx.gx && st.gy === ctx.gy) return null;
    // a view left asleep by somebody who walked in at another door: the window moves, and a paint builds what's new
    if (st?.warm && st.foot && ctx.stand?.foot) { reseat(st, ctx); st.warmT0 = performance.now(); if (!st.raf) st.raf = requestAnimationFrame(st.frame); return null; }
    if (st?.warm) closeFreelook();
  } else if (st?.warm) {
    if (ctx.stand?.foot && !ctx.recentre && st.foot) return wakeWarm(ctx);
    closeFreelook();
  }
  // Re-centring is an OPEN with a new window, not a second view: the server sends the same
  // `freelook_open` either way. Swap the ground under the camera and leave the camera where it is,
  // so `freelook 918 903` from an open view moves the world and not the shot.
  // ⚠ A VANTAGE IS NOT A RE-CENTRE, so it never takes the branch below. Re-centring keeps the shot
  // and slides the world under it, which is exactly wrong for somebody who has just walked up to a
  // different telescope: the camera has to be put down where the new one is, on its own mount, with
  // its own leash and its own name in the corner. Told apart on the mount rather than on `stand`
  // being set at all, so the same vantage re-sending its window is still a cheap swap.
  if (st && ctx.map && (ctx.stand?.mount || null) !== (st.stand?.mount || null)) { closeFreelook(); }
  if (st && ctx.map) {
    const ogx = st.gx, ogy = st.gy;
    st.map = internMap(st.map, st.gx, st.gy, ctx.map, ctx.gx ?? st.gx, ctx.gy ?? st.gy);   // see panels/map-intern.js
    st.gx = ctx.gx ?? st.gx; st.gy = ctx.gy ?? st.gy; if (ctx.skyline) st.skyline = ctx.skyline;
    // ⚠ AND THE CAMERA IS REBASED ONLY WHEN IT ASKED. The two re-centres arrive down the same wire
    // and want opposite things: a person typing `freelook 918 903` is naming a place to LOOK AT and
    // keeps the shot while the world slides under it, and the drift follow above is moving the
    // origin out from under a camera that has not moved at all. Matching the tile this view
    // requested is what tells them apart — anything else is somebody else's re-centre.
    if ((st.want && st.want.x === st.gx && st.want.y === st.gy) || (ctx.recentre && st.foot)) st.freeCam.rebase(ogx - st.gx, ogy - st.gy);
    st.want = null;
    freelookSetSky(ctx.sky);
    freelookSetActors(ctx.actors);
    if (ctx.roads !== undefined) st.roads = ctx.roads || null;
    if (ctx.regions) st.regions = ctx.regions;
    if (st.foot && ctx.doors) st.foot.doors = ctx.doors;
    if (st.foot && ctx.interiors) keepInteriors(st, ctx.interiors);
    freelookSetContacts(ctx.contacts);
    return st.api;
  }
  closeFreelook();
  ensureWindshieldStyles();
  ensureFreelookStyles();

  const id = 'freelook-' + Math.random().toString(36).slice(2, 8);
  // (`holder` is where a warm view is built; a harness hands its own in, as `mount` for an open one)
  const warm = !!ctx.prewarm, holder = warm ? ctx.holder || warmHolder() : null, into = holder || mount;
  // A vantage names itself, because "FREE LOOK" over a telescope is the tool's name rather than the
  // thing the player is holding — and this corner label is the only place the view says what it is.
  const stand = ctx.stand || null;
  const label = (stand?.label || 'FREE LOOK').toUpperCase().slice(0, 18);
  into.innerHTML = `<div class="fl-root">`
    + `<div class="fl-view">${windshieldHTML(id, label)}</div>`
    // ── THE SYSTEM CORNER ──────────────────────────────────────────────────
    // What every other seat puts in its top right and nothing else: how big the picture is, which
    // camera it is from, and the way out. Free look had two readouts, big screen and ✕, and none of
    // the ladder — so it is the one seat where the only choice was the whole page or two thirds of
    // a column. Reading outward to the corner: ◧ takes the sidebar, ⊟ the log, ⛶ the command box
    // with it, ⤢ the page; FPS is the camera rather than the screen and sits before them; ✕ is last
    // because it is the way off, which is where the wheelhouse puts its own.
    + `<div class="fl-chips">`
    + `<span class="fl-chip" data-at></span>`
    + `<span class="fl-chip" data-wx></span>`
    // ⚠ A VANTAGE DOES NOT GET THIS ONE. It is already standing, on a mount that re-asserts its eye
    // height every frame, and the whole of what a telescope is is that you cannot walk off with it.
    + (stand ? '' : `<button class="fl-chip fl-fps" type="button"></button>`)
    + seatLadderHTML('fl-chip')
    + `<button class="fl-chip fl-x" type="button" title="close the camera (O)">✕</button>`
    + `</div>`
    + `<div class="fl-hint"></div>`
    // on foot, your pack and your tablet, the same buttons and keys as in a room (foot-dock.js)
    + (stand?.foot ? footDockHTML() : '')
    // A phone moves this camera with the free camera's own touch layer (bindFreeCamTouch): drag
    // looks, a left thumbstick moves, pinch zooms, ▲ ▼ climb. It replaced a nine-key pad here.
    + `</div>`;

  const root = into.querySelector('.fl-root');
  const freeCam = createFreeCam();
  freeCam.setTrackReach((x, y, z, ux, uy, uz, max) => reachFrom(st, x, y, z, ux, uy, uz, max));

  st = {
    id, mount: into, root, freeCam, warm, holder, woke: false, warmT0: performance.now(),
    gx: ctx.gx ?? 0, gy: ctx.gy ?? 0,
    map: ctx.map || null,
    skyline: ctx.skyline || null,     // the tall towers outside the window (windshield.js noteSkyline)
    actors: ctx.actors || [],
    // What a cockpit is sent and this camera now is too: the highway past the window, the region's
    // colour grade, and everything moving.
    roads: ctx.roads || null, regions: ctx.regions || null, contacts: makeContactTrack(),
    want: null,                       // the re-centre this view has asked for and not yet been given
    onRecenter: ctx.onRecenter || null,
    stand,
    hour: 12, weather: 'clear', moon: undefined, field: null, ground: null, event: null,
    alive: true, raf: 0, last: performance.now(),
    onExit: ctx.onExit || (() => {}),
    // ON FOOT (building-stage.md step 5): the tile the server has you on, and the move sent and not
    // yet answered
    // (`crouched`, `eyeK` and `spin` are the room's crouch and its Q and E, see footKey; `doors` is the way into
    // each building round you, see footBlock)
    foot: stand?.foot ? { tile: { gx: stand.step?.gx ?? ctx.gx, gy: stand.step?.gy ?? ctx.gy }, pending: null, onMove: ctx.onMove || (() => {}),
      crouched: false, eyeK: 1, lift: 0, spin: new Set(), doors: ctx.doors || [],
      // the tile the server has you on (freelookStep), and the footstep on its way to it (footSync)
      server: { gx: stand.step?.gx ?? ctx.gx, gy: stand.step?.gy ?? ctx.gy }, sent: null } : null,
    api: null,
  };
  freelookSetSky(ctx.sky);
  freelookSetContacts(ctx.contacts);
  if (st.foot) freeCam.setWalkBlock((x0, y0, x1, y1) => footBlock(st, x0, y0, x1, y1));
  if (st.foot) {
    const s = st;
    root.classList.add('rp-host');
    s.dock = bindFootDock(root, { pack: (tab) => footPack(s, tab), tablet: () => s.foot.onMove('tablet') });
  }

  // ⚠ OPEN ALREADY DETACHED. There is no mount to be on, so the "stowed" state of the camera is not
  // a state this view has — a stowed camera here would be a frozen frame with no controls at all.
  //
  // Standing, the seed is where the vantage IS: the mount answers with a world-tile offset from the
  // tile the window is centred on, which is exactly the vocabulary the camera's own x/y are in.
  // ⚠ THE MOUNT'S OWN BEARING OUTRANKS THE AUTHORED ONE. An instrument on a ship points where the
  // ship is pointing plus its own train angle, and a world yaw written into a content file would be
  // right on the day it was authored and wrong the first time she was sailed anywhere. A vantage on
  // ground that does not move has no mount and keeps its authored yaw.
  // (a function, because a street view kept for the next walk out is stood on its doorstep again: `reseat`)
  const self = st;
  self.seat = () => {
    const sd = self.stand, spot = sd ? standSpot(self, performance.now()) : null;
    freeCam.open(spot
      ? { stand: true, yaw: spot.yaw != null ? spot.yaw : (sd.yaw || 0), x: spot.x, y: spot.y, z: spot.z, eye: spot.z, leash: sd.leash, ...(sd.foot ? { pace: FOOT_PACE } : {}) }
      : { yaw: 0, z: OPEN_Z });
  };
  self.seat();

  const hintEl = root.querySelector('.fl-hint');
  // The raptor being followed ({ id, sp, n, of, lostAt }), and the order ← → walk. See findRaptor.
  // Declared before the first paintHint, which reads it.
  let follow = null, ring = [];
  // The seats' own hint, with the one line that differs replaced: O stows the camera there and
  // closes the view here, and a hint that lied about the way out is worse than no hint.
  //
  // ⚠ AND IT FOLLOWS THE MODE RATHER THAN THE OPEN. The standing line is a DIFFERENT SENTENCE and
  // not the flying one with three clauses struck out — freecam.js's own note says why — so a
  // camera that has put its feet down while still advertising the orbit, the roll and the up-down
  // is advertising three controls that now refuse, which is the first minute of somebody deciding
  // the camera is broken.
  function paintHint() {
    if (follow) {
      hintEl.textContent = `FOLLOWING ${(RAPTOR_NAME[follow.sp] || 'raptor').toUpperCase()} ${follow.n}/${follow.of} · ← → or H next · ↑ ↓ nearer/further · mouse orbits · wheel zoom · WASD lets go · O close`;
      return;
    }
    // A phone gets the touch line, which has no keys in it to replace.
    if (freeCamTouchUI()) { hintEl.textContent = freeCamHint(freeCam.standing); return; }
    // on foot out of a building, the room's own line (room-stage.js), less what the street doesn't have
    if (stand?.foot) { hintEl.textContent = 'WASD to walk, Shift to run, C to crouch · drag to look, Q and E to turn · wheel zooms · F at a door goes in · G tags the wall you face · I for your pack, P for what you can eat and drink · T for your tablet · O or ✕ steps back'; return; }
    hintEl.textContent = (freeCam.standing
      ? freeCamHint(true).replace('O steps back', stand ? 'O or ✕ steps back' : 'O or ✕ closes')
      : freeCamHint(false).replace('O exit', 'H follow raptor · O close'));
  }
  paintHint();

  const atEl = root.querySelector('[data-at]');
  const wxEl = root.querySelector('[data-wx]');

  function frame(now) {
    if (!st || !st.alive) return;
    paint(now);
    // warm, it rests as soon as its loading veil has gone (the builds are done) or after 15 s, until it's woken. Every
    // paint here is main-thread GLASS under somebody's room: it used to keep going for 1.5 s, a dozen paints of 70 to 150 ms.
    if (st.warm && (!document.getElementById(st.id + '-veil') || now - st.warmT0 > 15000)) { st.raf = 0; return; }
    st.raf = requestAnimationFrame(frame);
  }
  function paint(now) {
    const dt = Math.max(0, Math.min(0.05, (now - st.last) / 1000)); st.last = now;
    // The whole body is guarded for the reason helm-view's is: this loop reschedules itself at the
    // END and paintWindshield has no try/catch of its own, so one throw would freeze the view for
    // good while everything around it carried on.
    try {
      if (follow) followStep();
      if (st.foot) footTurn(st, dt);
      freeCam.step(dt);
      if (st.foot) footBelt(st, dt);
      const env = liveEnv();
      const hour = env ? env.hour : st.hour;
      const weather = env ? env.weather : st.weather;
      const moon = env ? env.moon : st.moon;

      // ⚠ AND THE DECK UNDER A STANDING CAMERA MOVES. The Echelon heaves, pitches and rolls on the
      // same swell her hull is drawn standing in, so her sun deck is at a different height every
      // frame — and a camera pinned to a number taken when the view opened would hang in the air
      // while the ship rose and fell under it. One call, every frame, to the function that puts
      // her own geometry there.
      if (st.stand) { const s = standSpot(st, now); if (s) freeCam.setEye(s.z * footEye(st, dt) + footLift(st, dt)); }
      if (st.foot) watchFoot(st, now, flash);
      // A camera put on its feet with FPS has no mount, but on the Echelon the floor is her deck,
      // not the sea — at the default eye it stood inside her hull and the deck vanished. Asked every
      // frame, because she rides the swell and you walk between her decks.
      else if (freeCam.standing) { const fv = freeCam.view(); freeCam.setEye(deckEyeAt(st, fv, now) ?? FPS_EYE); }

      // THE WORLD FOLLOWS THE CAMERA — see RECENTER_R. One request outstanding at a time, cleared
      // by the window arriving, which is also the throttle: the next one cannot fire until the
      // camera has drifted the same distance again from the NEW centre.
      //
      // ⚠ NOT WHILE STANDING, AND SAID RATHER THAN LEFT TO THE ARITHMETIC. A leash is a fraction of
      // a tile, so the test below could never fire — but the reason it must not is that a vantage
      // is a PLACE, and a window that slid out from under one would be the ground moving while the
      // player stood still on it.
      // The camera may fly under the sea but not through the bottom of it, or into the ground.
      { const f0 = freeCam.view(); if (f0) freeCam.clampFloor(floorZAt(f0.x, f0.y) + 0.04); }
      const fc = freeCam.view();
      if (fc && !st.stand && st.onRecenter && !st.want
          && (Math.abs(fc.x) > RECENTER_R || Math.abs(fc.y) > RECENTER_R)) {
        const nx = st.gx + Math.round(fc.x), ny = st.gy + Math.round(fc.y);
        st.want = { x: nx, y: ny };
        st.onRecenter(nx, ny);
      }

      paintWindshield(st.id, {
        external: true, hideOwnShip: true, phase: 'cruise', worldBlend: 1, deckOverhead: true,   // the weather stays over a climbing camera (DECK_FLOOR)
        heading: 0, height: 0, speed: 0,
        hour, moon, weather, wxField: st.field, wxGround: st.ground, event: st.event,
        map: st.map, skyline: st.skyline, mapCenter: { x: st.gx, y: st.gy }, mapOffset: { x: 0, y: 0 },
        acX: st.gx, acY: st.gy, airport: 'default',
        tune: st.foot ? FOOT_TUNE : (st.stand || freeCam.standing) ? STAND_TUNE : undefined,   // see STAND_TUNE — a seat that cannot move can afford to draw more
        // the Pack open: the camera stands back round you, and you're drawn (packViewNow, packSelf)
        freeCam: (st.packCam && packViewNow(st, now)) || freeCam.view(),
        self: st.packCam ? packSelf(st) : null,
        actors: st.actors,   // pavement people; meshes up close (gl/actors.js)
        // ⚠ THE OWN SHIP IS THE WINDOW CENTRE, hidden, so a contact's offset is from there; the camera
        // flying away from it is the renderer's business (freeCam), exactly as for the helm.
        contacts: st.contacts.size ? st.contacts.frame(st.gx, st.gy, { roadRig: ROAD_RIG_MUL }) : null,
        roads: st.roads, regions: st.regions,
        bayDoors: st.foot ? bayWalk(st, now, dt) : null,   // a depot's roller door, up for you as you walk to it
        streetDoors: st.foot ? doorLeaves(st, now, dt) : null,
        // the rooms of the buildings near you, drawn in the city (gl/interiors.js); null off foot
        interiorRooms: st.foot && st.interiors?.length ? st.interiors : null,
        // inside a building (ONE_WORLD), its rooms are drawn whole; outside, a street door's rooms only through it
        interiorInside: !!st.inside,
        // and the storey you're on is cut out of its building's model, which otherwise stays (insideCut)
        roomCut: st.inside ? insideCut(st) : null,
        // on foot the near plane comes in to a third of a metre, so people stay whole as you walk up to them
        nearMax: st.foot ? FOOT_NEAR : 0,
      });

      // ⚠ WHERE THE CAMERA IS, NOT WHERE THE WINDOW IS CENTRED. This read `st.gx,st.gy`, which is
      // the tile the view OPENED on — so the one readout in the view was a constant, and the whole
      // hour spent working out where the missing wall was went past a chip that could have said.
      if (atEl) atEl.textContent = fc ? `${Math.round(st.gx + fc.x)},${Math.round(st.gy + fc.y)}` : `${st.gx},${st.gy}`;
      if (wxEl) wxEl.textContent = `${String(weather || 'clear').toUpperCase()} · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
    } catch (e) {
      if (!st._errLogged) { console.error('[freelook] frame render error (view kept alive — report this stack):', e); st._errLogged = true; }
    }
  }
  st.frame = frame; st.paint = paint;
  st.raf = requestAnimationFrame(frame);

  let freeIdle = null, unbindPointer = null;

  function onKey(e) {
    const k = (e.key || '').toLowerCase();
    const down = e.type === 'keydown';
    // ⚠ A PRESS ONLY COUNTS WHILE THIS SEAT HAS THE KEYBOARD, AND A RELEASE COUNTS WHEREVER IT IS
    // DELIVERED. The typing guard is right for a keydown — somebody writing a message must not be
    // flying the camera — and it was catastrophic for a keyup: click into the command box with E
    // down (or let input.js's auto-focus take it there for you) and the release is addressed to an
    // INPUT, dropped here, and never taken out of the camera's held set. The shot then swings at
    // 62°/s for the rest of the session with nothing held down and nothing on screen to say why.
    // Same rule, and the same reason, as cab-view.js's own HOLD_KEYS record.
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable) {
      if (!down) { freeCam.onKey(k, false); st.foot?.spin.delete(k); }
      return;
    }
    // the spray can's dialog is over the street: a press is the dialog's (a release still lets go here)
    if (down && document.getElementById('spray-overlay')) return;
    // on foot the tablet has the keys while it's up, as it does over a room, and the Pack while it's open; I, P and T
    // are the dock's (foot-dock.js)
    if (down && st.foot) {
      if (document.getElementById('tablet-os-overlay')) return;
      if (st.pack?.key(e) || st.dock?.key(e)) { e.preventDefault(); return; }
    }
    // ⚠ O CLOSES THE VIEW, NOT THE CAMERA. In a seat the camera goes back on its mount and the
    // vehicle is still there; here there is nothing to go back to, so the same key has to mean the
    // same thing to the player — "put this away" — and what it puts away is the whole view.
    if (k === 'o' && down && !e.repeat) { e.preventDefault(); st.onExit(); return; }
    // ON FOOT THE KEYS ARE THE ROOM'S (room-walk.js), so the street door doesn't change what your hands do: WASD,
    // Shift to run, C or Ctrl to crouch, Q and E to turn. Nothing else of the camera's is bound: no speed ladder,
    // no lift, no roll, no pointer key.
    if (st.foot) { if (footKey(st, e, k, down)) e.preventDefault(); return; }
    // The nav-mark switch is bound here too, even though this view suppresses the marks whatever it
    // is set to (a detached camera always does — see NAV_MARKS in windshield.js). It is the same
    // module flag the seats throw, so a builder who turns it off out here has turned it off in the
    // cab they get into next, which is very likely what they meant.
    if (k === 'n' && down && !e.repeat) { e.preventDefault(); navMarks(); return; }
    if (k === 'h' && down && !e.repeat) { e.preventDefault(); findRaptor(e.shiftKey ? -1 : 1); return; }
    // Following, the arrows are the bird's: ← → step through the raptors and ↑ ↓ bring the camera in
    // or send it back. The release still goes to the camera, so an arrow held from before the follow
    // started is let go of rather than left turning it.
    if (follow && k.startsWith('arrow')) {
      e.preventDefault();
      if (!down) freeCam.onKey(k, false);
      else if (k === 'arrowleft' || k === 'arrowright') { if (!e.repeat) findRaptor(k === 'arrowright' ? 1 : -1); }
      else freeCam.dolly(k === 'arrowup' ? -1 : 1);
      return;
    }
    if (freeCam.onKey(k, down)) e.preventDefault();
  }
  // ── H: FOLLOW A RAPTOR ──────────────────────────────────────────────────────
  // H flies the camera in on the nearest hawk or peregrine the renderer has in its flock window and
  // stays with it: freecam's `track`, fed where the bird is drawn every frame. ← → (or H and SHIFT+H)
  // step through the others, ↑ ↓ and SHIFT+wheel set the distance, the mouse swings round the bird,
  // and W/A/S/D/R/F let go where the camera is.
  // ⚠ THE ORDER IS FIXED WHEN THE FOLLOW STARTS. Sorted by distance from the eye on every press, the
  // nearest other bird to the one you are on is usually the one you just left, so → ping-ponged
  // between two and never reached a third. Birds that leave the window drop out of the ring and new
  // ones join the end.
  // ⚠ STANDING, H ONLY TURNS THE LENS. A camera on its feet (a vantage, or FPS) cannot fly to a bird,
  // and a telescope swung onto one is what H always did there.
  let raptorIdx = -1, raptorAt = 0;
  function raptorList() {
    const fv = freeCam.view();
    if (!fv) return [];
    const ex = st.gx + fv.x, ey = st.gy + fv.y;
    return raptorsNow().map((r) => ({ ...r, d: Math.hypot(r.x - ex, r.y - ey) })).sort((a, b) => a.d - b.d);
  }
  function findRaptor(step) {
    const list = raptorList();
    if (!list.length) { flash('No raptors in range.'); return; }
    if (freeCam.standing) {
      const fv = freeCam.view();
      const now = performance.now();
      raptorIdx = (now - raptorAt < 8000) ? (raptorIdx + 1) % list.length : 0;
      raptorAt = now;
      const r = list[raptorIdx];
      freeCam.aimAt(Math.atan2(r.x - st.gx - fv.x, -(r.y - st.gy - fv.y)) * 180 / Math.PI, Math.atan2(r.z - fv.z, Math.max(0.05, r.d)));
      const nm = RAPTOR_NAME[r.sp] || 'raptor';
      flash(`${nm[0].toUpperCase() + nm.slice(1)} · ${r.d.toFixed(1)} tiles (${raptorIdx + 1}/${list.length})`);
      return;
    }
    if (!follow) ring = list.map((r) => r.id);
    else {
      const live = new Set(list.map((r) => r.id));
      ring = ring.filter((id) => live.has(id));
      for (const r of list) if (!ring.includes(r.id)) ring.push(r.id);
    }
    const at = follow ? ring.indexOf(follow.id) : -1;
    const id = at < 0 ? ring[0] : ring[((at + step) % ring.length + ring.length) % ring.length];
    const r = list.find((q) => q.id === id);
    const fresh = !!follow && follow.id !== id;
    follow = { id, sp: r.sp, n: ring.indexOf(id) + 1, of: ring.length, lostAt: 0 };
    freeCam.track(r.x - st.gx, r.y - st.gy, r.z, fresh);
    paintHint();
  }
  // Every frame, before the camera steps: where the bird is now. A bird missing for a moment is a
  // re-centre in flight; missing for two seconds it has gone (out of the window, or dusk).
  function followStep() {
    if (!freeCam.tracking) { follow = null; paintHint(); return; }   // a movement key or FPS let go
    const r = raptorsNow(Date.now(), follow.id)[0];
    if (r) { follow.lostAt = 0; freeCam.track(r.x - st.gx, r.y - st.gy, r.z); return; }
    const now = performance.now();
    if (!follow.lostAt) follow.lostAt = now;
    else if (now - follow.lostAt > 2000) {
      const sp = follow.sp;
      freeCam.untrack(); follow = null;
      flash(`Lost the ${RAPTOR_NAME[sp] || 'raptor'}.`);
    }
  }
  let flashT = null;
  function flash(msg, ms = 2500) {
    hintEl.textContent = msg;
    clearTimeout(flashT);
    flashT = setTimeout(paintHint, ms);
  }
  // ⚠ AND ALT-TAB IS THE ONE THE LENIENCY ABOVE CANNOT CATCH. The keyup for whatever was held goes
  // to whatever you switched to and this window never hears it at all, so there is no release to be
  // lenient about — the camera simply flies on, over a city nobody is looking at, until somebody
  // comes back and presses the key again to let go of it. The cab binds both hooks for the same
  // failure and for the same reason: `blur` is "this window is no longer taking keys" and
  // `visibilitychange` is "this tab is not on screen", and either can happen without the other.
  const onLetGo = () => { freeCam.releaseAll(); self.foot?.spin.clear(); };
  const onHidden = () => { if (document.hidden) onLetGo(); };
  root.querySelector('.fl-x')?.addEventListener('click', () => st?.onExit());
  // ⤢ big screen — the whole window with nothing on it, which is what this view was always
  // reaching for: no sidebar, no log, no chips, no hint, no pane border. It is the only seat with
  // no ⛶ ladder under it, because there is no cockpit here to make room for — the pane was already
  // all picture, and the only thing left to take is the page.
  // ⚠ ESC LEAVES BIG SCREEN AND O STILL CLOSES THE VIEW. Two ways out of two different things, and
  // the second one goes on working in here — which is why this button is safe to let fade with the
  // rest of the chrome.

  // ── FPS: THE CAMERA PUTS ITS FEET DOWN ──────────────────────────────────────
  //
  // The one button in this row that is about the CAMERA rather than about the screen. `freecam.js`
  // has had a standing mode since the telescopes shipped and nothing could reach it without being
  // a vantage: feet on the ground, W walking on the level instead of carrying the lens, no orbit,
  // no roll, no up-down.
  //
  // ⚠ UNLEASHED, WHICH IS THE ONE THING THAT MAKES IT A PERSON RATHER THAN A TELESCOPE. A vantage
  // takes `STAND_LEASH` because it IS a place — half a deck's width, and walking off it would mean
  // it was never standing anywhere. This is somebody on foot in a city, so the tether is 0 and the
  // clamp in `place` is inert by arithmetic rather than by a guard.
  //
  // ⚠ AND `freeCam.standing` IS NOT `st.stand`. The second is "this view was OPENED as a vantage",
  // which decides the label, the recentre branch, the detail tune and whether the mount re-asserts
  // the eye height every frame; the first is "the camera's feet are down right now". Reading one
  // for the other puts a telescope's mount under a walking camera, which pins it to the deck it is
  // nowhere near.
  const fpsBtn = root.querySelector('.fl-fps');
  function paintFps() {
    if (!fpsBtn) return;
    const up = freeCam.standing;
    fpsBtn.textContent = up ? 'FLY' : 'FPS';
    fpsBtn.title = up ? 'back to the flying camera' : 'first person: put the camera on its feet and walk';
    fpsBtn.classList.toggle('on', up);
    fpsBtn.setAttribute('aria-pressed', up ? 'true' : 'false');
  }
  paintFps();
  fpsBtn?.addEventListener('click', () => {
    const fv = freeCam.view();
    const eye = deckEyeAt(st, fv, performance.now());
    freeCam.setStand(!freeCam.standing, { leash: 0, eye: eye ?? FPS_EYE });
    paintFps();
    paintHint();
  });
  // ⌨ THE KEYBOARD IS THIS VIEW'S WHILE IT IS OPEN. Every key this camera flies on — W/A/S/D, Q/E,
  // the brackets — is an ordinary letter, and the command bar is a text input a few hundred pixels
  // below the picture: a player who has clicked it once is flying nothing and typing "wasd" into
  // the chat box. The cab and the flight sim have taken the keyboard on mount for a long time and
  // this seat never did, which is why it is the one the complaint was about. See seat-keys.js.
  // What a view on screen takes: the page's weather overlay off, the idle timer, the pointer, the keys, the seat
  // ladder (◧ ⊟ ⛶ ⤢, opening on ⊟, seat-ladder.js) and the keyboard. A warm view takes them when it's woken.
  let ladderBound = false;
  self.wake = () => {
    if (self.woke) return;
    self.woke = true;
    suppressWeatherFx(true, 'freelook');   // this view draws its own sky; the room-pane overlay's bow lay flat across the towers
    freeIdle = bindFreeCamIdle(freeCam);
    freeIdle.wake();
    // on foot with a mouse it's the room's drag, not the camera's held pointer; a phone keeps the camera's touch layer
    const glass = root.querySelector('.ws-wrap') || root;
    unbindPointer = self.foot && !freeCamTouchUI() ? bindFootPointer(glass, freeCam) : bindFreeCamPointer(glass, freeCam);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onLetGo);
    document.addEventListener('visibilitychange', onHidden);
    // a view woken a second time (parkFreelook) gets fresh buttons: binding the same ones twice makes each click two
    if (ladderBound) for (const b of root.querySelectorAll('.seat-side, .seat-hide, .seat-fs, .seat-big')) b.replaceWith(b.cloneNode(true));
    ladderBound = true;
    bindSeatLadder(root);
    claimSeatKeyboard(root, { label: self.foot ? 'STREET' : stand ? 'VIEW' : 'CAMERA' });
    if (self.foot) setSprayStage(FOOT_SPRAY);
    self.last = performance.now();
    if (!self.raf) self.raf = requestAnimationFrame(frame);
  };
  if (!warm) self.wake();

  st.teardown = () => {
    if (!self.woke) return;
    clearSprayStage(FOOT_SPRAY);
    endSeatKeyboard(root);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onLetGo);
    document.removeEventListener('visibilitychange', onHidden);
    unbindPointer?.();
    freeIdle?.unbind();
  };
  // Asleep (parkFreelook): everything `wake` took is given back but the page's layout, which the Room Stage coming
  // into the pane keeps (keepSeatRung), and the frames stop.
  self.sleep = () => {
    if (!self.woke) return;
    self.teardown();
    self.woke = false;
    self.pack?.close();
    freeCam.releaseAll(); self.foot?.spin.clear();
    suppressWeatherFx(false, 'freelook');
    cancelAnimationFrame(self.raf); self.raf = 0;
  };
  st.api = {
    setSky: freelookSetSky,
    recentre(rows, gx, gy) { if (Array.isArray(rows) && rows.length) st.map = rows; if (gx != null) st.gx = gx; if (gy != null) st.gy = gy; },
  };
  return st.api;
}

export function closeFreelook() {
  if (!st) return;
  const s = st; st = null;
  s.alive = false;
  if (s.woke) suppressWeatherFx(false, 'freelook');
  cancelAnimationFrame(s.raf);
  try { s.teardown?.(); } catch { /* a half-built view still has to come down */ }
  // ⚠ THE GL SCENE GOES WITH IT. This view mints a fresh canvas id per open (the helm's own trap,
  // written up at disposeWindshield): without this, every open would leave a WebGL context, its
  // atlas page and its float targets behind, and the browser force-loses the OLDEST context past
  // sixteen — which is the seat somebody is actually flying.
  try { s.freeCam.close(); } catch { /* ditto */ }
  try { disposeWindshield(s.id); } catch { /* ditto */ }
  // The page-level layout this view turned on. All three are the PAGE's rather than the pane's, so
  // nothing else takes them down — and a player who closed the camera at ⛶ with the sidebar hidden
  // would be handed a room description with no panels, no log and no command box.
  if (s.woke) releaseSeatLadder();
  if (s.mount) s.mount.innerHTML = '';
  s.holder?.remove();
}

// Where the vantage is, in the vocabulary the camera's own x/y are in: a world-tile offset from the
// tile the window is centred on, plus an absolute eye height. A named mount is asked; otherwise the
// vantage's own authored numbers stand, which is right for anything on ground that does not move.
// ⚠ IT MAY ANSWER null — the mount reads the centre cell, and a window whose centre is not what the
// vantage said it was is a window this camera has no business standing in. The caller falls back to
// the flying camera rather than putting the eye somewhere invented.
// A standing eye, 1.6 m against a 3.5 m storey (windshield.js ACTOR_S). It was 0.12, about 2.2 m.
const FPS_EYE = 0.09;
// On foot, the Room Stage's pace (room-walk.js: 5.5 ft a second, Shift 1.9 times that), in tiles: FPS_EYE
// is 1.6 m, so a metre is FPS_EYE / 1.6 tiles. Out of the front door you walk as you did in the lobby.
const FOOT_PACE = { walk: 5.5 * FT_M * FPS_EYE / 1.6, run: 1.9 };
function deckEyeAt(s, fv, now) {
  if (!s.map || !fv) return null;
  const R = (s.map.length - 1) / 2, c = s.map?.[R]?.[R];
  if (!c || c.mark !== 'yacht') return null;
  return yachtDeckEye(fv.x, fv.y, c.heading || 0, now);
}

function standSpot(s, now) {
  const stand = s.stand;
  if (!stand) return null;
  if (stand.mount && MOUNTS[stand.mount]) {
    const R = s.map ? (s.map.length - 1) / 2 : 0;
    const m = MOUNTS[stand.mount](s.map, R, now);
    if (m) return m;
  }
  if (stand.foot) return { x: stand.x || 0, y: stand.y || 0, z: FPS_EYE };
  return stand.eye != null ? { x: stand.x || 0, y: stand.y || 0, z: stand.eye } : null;
}

// ── ON FOOT: EVERY TILE EDGE IS A MOVE ───────────────────────────────────────
//
// Walking the street after the street door (plugins/freelook openOnFoot). The camera walks freely;
// crossing into another tile sends `footstep <gx> <gy>` (footSync), and the server's 'freelook_step'
// says where you are. A refusal puts you back just inside the tile you're on. Walking in at a building's
// door is walking in: the engine passes you through its facade, and the Room Stage or the room text takes
// the pane. Anywhere else on a building's tile is an alley (footTile).
const FOOT_WAIT_MS = 8000, DOOR_ENTER_AT = 0.11;
function watchFoot(s, now, flash) {
  s.flash = flash;   // freelookStep's refusal reason
  const f = s.foot, fv = s.freeCam.view();
  if (!fv || s.inside) return;   // inside, a doorway sends the move (insideBlock)
  const ax = s.gx + fv.x, ay = s.gy + fv.y, cx = Math.round(ax), cy = Math.round(ay), T = f.tile;
  const back = (bx, by) => s.freeCam.rebase(bx - ax, by - ay);
  if (f.pending) {
    if (now - f.pending.t < FOOT_WAIT_MS) return;
    const b = f.pending.back;
    f.pending = null;
    uncoverPane();   // a door that wouldn't let you in: the street again
    back(b[0], b[1]);
    flash("You can't go that way.");
    return;
  }
  // inside a tile, a little in from its edge, on the side you were walking to
  const inside = (px, py) => [px + Math.max(-0.42, Math.min(0.42, ax - px)), py + Math.max(-0.42, Math.min(0.42, ay - py))];
  // ⚠ IN AT THE GLASS, NOT AT THE TILE'S EDGE. The doors stand 0.014 of a tile short of the edge, and the camera's
  // near plane cuts them away from about 0.07 out, so walking up to the edge showed the inside of the model's shell,
  // and that was the frame the cover was taken from. Measured at the Solenne: 0.11 from the glass the doorway (and the
  // lobby in it) fills the view, 0.06 is grey. So the step through a door goes from here, in the doorway's width.
  for (const d of f.doors) {
    const E = EDGE_VEC[d.edge];
    if (!E || T.gx !== d.gx + E[0] || T.gy !== d.gy + E[1]) continue;
    const g = doorway(s, d);
    if (!g) continue;
    // `along` from the doorway's own middle (footBlock's sum), which a model can put off the tile's
    const off = (ax - d.gx) * E[0] + (ay - d.gy) * E[1] - g.plane, along = (ax - d.gx) * E[1] - (ay - d.gy) * E[0] - (g.cx || 0);
    const mark = g.bay ? BAY_ENTER_AT : DOOR_ENTER_AT;
    if (off > mark || off < -0.3 || Math.abs(along) > g.half) continue;
    if ((g.leaves || !d.slide) && (d.open || 0) < passOpen(d)) continue;   // shut: it holds you, as footBlock does
    // a slow frame can carry the eye well past the mark in one step; the cover's frame is taken from the mark itself,
    // and nobody sees the eye go back, since the cover is over it from here on
    if (off < mark) s.freeCam.rebase(E[0] * (mark - off), E[1] * (mark - off));
    f.back = inside(T.gx, T.gy);
    f.pending = { t: now, back: f.back };
    noteDoor(d); enterCover(s, d);
    f.onMove(`footstep ${d.gx} ${d.gy}`);
    return;
  }
  if (cx !== T.gx || cy !== T.gy) {
    // ⚠ THE VIEW IS THE AUTHORITY ON FOOT. It reports the tile it walked into (`footstep`, plugins/freelook) and walks
    // on without waiting: the server follows. It used to send `move <dir>` and wait for the answer, and the pacing
    // queue held a quick step silently for longer than the wait, so you were pulled back with "You can't go that way"
    // and then moved anyway a moment later. Only a real refusal (a gate) puts you back now (freelookStep `refused`).
    // (onMove sends any command line silently, so it carries this one too.)
    const d = doorAt(s, cx, cy);
    if (d) {
      // a building: the room has to come, so this one waits for it, behind the cover (enterCover)
      f.back = inside(T.gx, T.gy);
      f.pending = { t: now, back: f.back };
      noteDoor(d); enterCover(s, d);
      f.onMove(`footstep ${d.gx} ${d.gy}`);
      return;
    }
    const want = footTile(s, ax, ay, cx, cy, T);
    if (want) { f.back = inside(T.gx, T.gy); f.tile = want; }
  }
  footSync(f, now);
}
// ⚠ THE SERVER'S TILE FOLLOWS THE VIEW'S UNTIL THEY AGREE. One footstep per tile wasn't enough: a step the command rate
// limit dropped, or one refused as "still working on your last command", got no answer, and the view went on believing
// a tile the server never put you on, so the text map and the eye drifted apart until the next step was refused and
// yanked you back. So the tile is sent again until the server's answer (freelookStep, every footstep is answered) says
// it's the one you're on, at most once every FOOT_GAP_MS and again after FOOT_RESEND_MS with no answer. The resend is
// short because a drift lasts that long: 2 s left the text a tile or two behind; 700 ms is about 1.4 lines a second,
// well inside the command bucket's 5 a second.
const FOOT_GAP_MS = 250, FOOT_RESEND_MS = 700;
function footSync(f, now) {
  const W = f.tile, S = f.server;
  if (S && S.gx === W.gx && S.gy === W.gy) { f.sent = null; return; }
  const q = f.sent;
  if (q && now - q.t < (q.gx === W.gx && q.gy === W.gy ? FOOT_RESEND_MS : FOOT_GAP_MS)) return;
  f.sent = { gx: W.gx, gy: W.gy, t: now };
  f.onMove(`footstep ${W.gx} ${W.gy}`);
}
// ⚠ AN ALLEY IS INSIDE A BUILDING'S TILE. The gap between two buildings, or down the side of one, is the margin its model
// leaves in its own tile, and nobody stands on a building: the step onto it used to walk you in through the wall, or be
// refused at a shut shop or a locked door and pull you back onto the street. So a building's tile is the building's
// grounds, and the tile the server has you on is the open one nearest the eye (never water, which would be a swim) until
// you come out the other end, which may be a few tiles off (plugins/freelook FOOT_REACH). null: no tile near, stay
// where you are.
// ⚠ ONLY A STAGE'S DOOR GOES IN. A building with no ROOM interior is walked round and used as it stands (a petrol
// station's pumps and forecourt are its exterior); walking at its front used to step you into its room, and the
// server then shut the street view for the room text. The way in is a door in `f.doors` (watchFoot), nothing else.
const openCell = (c) => !!c && c.kind !== 'air' && !c.lf && !c.bt && c.mark !== 'bay';
function footTile(s, ax, ay, cx, cy, T) {
  const c = cellOf(s, cx, cy);
  if (openCell(c)) return { gx: cx, gy: cy };
  let best = null, bd = Infinity;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const wx = cx + ox, wy = cy + oy, n = cellOf(s, wx, wy);
    if ((!ox && !oy) || !openCell(n) || n.biome === 'water') continue;
    const dd = Math.hypot(wx - ax, wy - ay);
    if (dd < bd) { bd = dd; best = { gx: wx, gy: wy }; }
  }
  // the tile you're on stays until another is clearly nearer, so an eye halfway between two doesn't send a step a frame
  if (best && Math.max(Math.abs(T.gx - cx), Math.abs(T.gy - cy)) <= 1 && Math.hypot(T.gx - ax, T.gy - ay) < bd + FOOT_KEEP) return null;
  return best;
}
const FOOT_KEEP = 0.3;

// ── ON FOOT: THE ROOM'S CONTROLS ─────────────────────────────────────────────
//
// The numbers are room-walk.js's and room-stage.js's, so walking out of a street door changes the picture and
// nothing about how you move: Q and E turn at TURN_RATE, a drag turns the head by TURN a pixel, C or Ctrl
// crouches to the same eye and the same half pace, and the wheel is the room's 6% a notch.
const FOOT_TURN = 2 * 180 / Math.PI;   // degrees a second on Q and E (room-walk.js TURN_RATE)
const FOOT_DRAG = 0.0045;              // radians a pixel of drag (room-stage.js TURN)
const FOOT_CROUCH = 3.3 / 5.4;         // a crouched eye over a standing one (room-walk.js CROUCH / STAND)
const FOOT_KEYS = new Set(['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown']);
function footKey(s, e, k, down) {
  const f = s.foot, cam = s.freeCam;
  // Shift off the event, as the room reads it: held before the door, it's still held after it
  cam.onKey('shift', !!e.shiftKey && !(k === 'shift' && !down));
  if (k === 'shift') return true;
  // ⚠ A TOGGLE, NOT A HOLD, for the room's reason: Ctrl+W shuts the browser tab and no page can stop it
  if (k === 'control' || (k === 'c' && !e.ctrlKey && !e.metaKey)) {
    if (down && !e.repeat) { f.crouched = !f.crouched; cam.setPace(f.crouched ? { walk: FOOT_PACE.walk * 0.5, run: 1 } : FOOT_PACE); }
    return true;
  }
  if (k === 'f' && !e.ctrlKey && !e.metaKey) { if (down && !e.repeat && !footCallLift(s)) footDoor(s); return true; }
  // G opens the can on the building you're facing (plugins/graffiti `spraycan <dir>`; the server says what's there and
  // whether you've a can), and the dialog's SPRAY IT then runs the spray session over the street (spray-aim.js)
  if (k === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) { if (down && !e.repeat) footCan(s); return true; }
  if ((k === 'q' || k === 'e') && !e.ctrlKey && !e.metaKey) { if (down) f.spin.add(k); else f.spin.delete(k); return true; }
  if (FOOT_KEYS.has(k)) return cam.onKey(k, down);
  return false;
}
// F by a footbridge's call button presses it: the deck's fetches the cars up, the foot's sends them down.
function footCallLift(s) {
  const fv = s.freeCam.view();
  if (!fv || s.inside || !s.map || !windshieldLoaded()) return false;
  return streetKitLiftPress(s.map, s.gx, s.gy, s.gx + fv.x, s.gy + fv.y, s.foot.lift || 0, performance.now());
}
// The compass point you're facing, off the camera's yaw (0 north, growing clockwise: freecam.js), and the can opened
// on that wall.
const FACING = ['north', 'east', 'south', 'west'];
function footCan(s) {
  const v = s.freeCam.view();
  const dir = v ? FACING[Math.round((((v.yaw % 360) + 360) % 360) / 90) % 4] : '';
  s.foot.onMove(`spraycan ${dir}`.trim());
}
// THE PACK ON THE STREET: the Room Stage's own panel (room-pack.js), fetched the first time it's opened, on the same
// `roompack` verb. Eating, drinking and the rest are the typed verb (take answers false), and the can opens on the wall
// you face, as G does.
// ⚠ YOU, IN 3D, AS IN A ROOM. While it's open the camera leaves your eyes and stands back round you (packViewNow), and
// GLASS draws your own body where you stood (windshield.js drawSelfFigure, `v.self`), dressed from the Pack's rows as
// the Room Stage dresses you (player-figure.js playerFigure, paper-doll.js figureWorn), so the street's close-up level
// draws the same figure the room does. A drag across the clear box, Q and E turn the camera round you; the wheel brings
// it in. Your body stays where you are, facing where you looked, and the camera goes back to your eyes when it shuts.
const PACK_FOV = 38, PACK_PITCH = -0.28;
let packMods = null;
function footPack(s, tab) {
  if (s.pack) { s.pack.toggle(tab); return; }
  if (s.packing) return;
  s.packing = true;
  Promise.all([import('./room-pack.js'), import('./gl/room-people.js'), import('../../../shared/player-figure.js'), import('../../../shared/paper-doll.js')]).then(([rp, people, pf, pd]) => {
    s.packing = false;
    packMods = { streetLook: people.streetLook, playerFigure: pf.playerFigure, figureWorn: pd.figureWorn };
    if (st !== s || !s.alive || !s.foot) return;
    s.pack = rp.createPack({
      host: s.root, silent: (line) => s.foot.onMove(line), cmd: (line) => import('../net.js').then((m) => m.sendCmd(line)),
      spray: () => footCan(s), take: () => false,
      onToggle: (open) => { s.dock?.setPack(open); if (open) { s.freeCam.releaseAll(); s.foot.spin.clear(); } packView(s, open); },
      turn: (dYaw, dPitch, zoom) => packTurn(s, dYaw, dPitch, zoom),
    });
    s.pack.open(tab);
  }).catch(() => { s.packing = false; });
}
function packView(s, open) {
  const v = open ? s.freeCam.view() : null;
  if (!v) { s.packCam = null; return; }
  const ground = Math.max(0, v.z - FPS_EYE * (s.foot.eyeK ?? 1));
  s.packCam = { x: v.x, y: v.y, ground, face: v.yaw, yaw: v.yaw + 180, pitch: PACK_PITCH, zoom: 1, goal: { yaw: v.yaw + 180, pitch: PACK_PITCH, zoom: 1 }, t: 0 };
}
// the Pack's turn is the room's: radians, yaw growing to the left; the street's camera is degrees, growing clockwise
function packTurn(s, dYaw = 0, dPitch = 0, zoom = 1) {
  const g = s.packCam?.goal;
  if (!g) return;
  g.yaw -= dYaw * 180 / Math.PI;
  g.pitch = Math.max(-1.2, Math.min(0.12, g.pitch - dPitch));
  g.zoom = Math.max(0.4, Math.min(1.6, g.zoom * zoom));
}
// The camera round you, as room-stage.js packCamNow frames you: far enough back that you fill the clear box, turned off
// you by as much as the box is off the middle of the picture. GLASS's lens is a multiplier on its own focal lengths
// (windshield.js viewFocal, viewLatFocal), so PACK_FOV is worked into one here.
function packViewNow(s, now) {
  const pc = s.packCam, r = s.pack?.dollRect(), host = s.root.querySelector('.ws-wrap') || s.root, cr = host.getBoundingClientRect();
  if (!pc || !r || !r.height || !cr.height || !cr.width) return null;
  const dt = pc.t ? Math.min(0.1, (now - pc.t) / 1000) : 0.016, k = 1 - Math.exp(-dt * 14);
  pc.t = now;
  pc.yaw += (pc.goal.yaw - pc.yaw) * k; pc.pitch += (pc.goal.pitch - pc.pitch) * k; pc.zoom += (pc.goal.zoom - pc.zoom) * k;
  const W = cr.width, H = cr.height, half = PACK_FOV * Math.PI / 360;
  const lens = (H / 2) / (Math.tan(half) * viewFocal(W, H));
  const tanH = (W / 2) / (viewLatFocal(W, null) * lens);
  const d = m2tf(2.05) / (2 * (r.height / H) * Math.tan(half)) * pc.zoom;
  const cx = pc.x, cy = pc.y, cz = pc.ground + m2tf(0.95), Y = pc.yaw * Math.PI / 180, cp = Math.cos(pc.pitch);
  const nx = ((r.left + r.width / 2) - (cr.left + W / 2)) / (W / 2), ny = ((cr.top + H / 2) - (r.top + r.height / 2)) / (H / 2);
  return {
    x: cx - Math.sin(Y) * cp * d, y: cy + Math.cos(Y) * cp * d, z: Math.max(pc.ground + 0.01, cz - Math.sin(pc.pitch) * d),
    yaw: pc.yaw - Math.atan(nx * tanH) * 180 / Math.PI, pitch: pc.pitch - Math.atan(ny * Math.tan(half)), roll: 0, fov: lens,
  };
}
// You, for GLASS (v.self): where you stood, facing where you looked, in what the Pack says you have on (kept per outfit).
function packSelf(s) {
  const pc = s.packCam, m = s.packMsg, M = packMods;
  if (!pc || !m || !M) return null;
  const items = s.pack?.worn() || m.items || [], sex = m.sex === 'female' ? 'female' : 'male';
  const sig = items.filter((x) => x.worn && x.slot).map((x) => x.id).join(',') + '|' + JSON.stringify(m.look || null);
  if (s.packLook?.sig !== sig) {
    const base = M.playerFigure(m.look || {}) || {};
    const fig = { ...base, ...M.figureWorn(items, { sex, skin: base.skin || null }) };
    const o = M.streetLook(String(m.you || 'you'), sex === 'female', fig);
    // the close-up figure rolls off your own id, as the room's does, so the two draw one person
    s.packLook = { sig, o: { ...o, hd: { ...o.hd, id: m.you || o.hd.id } }, k: fig.height > 1 ? fig.height / 1.776 : 1 };
  }
  const F = pc.face * Math.PI / 180;
  return { x: s.gx + pc.x, y: s.gy + pc.y, z: pc.ground, hd: Math.atan2(-Math.cos(F), Math.sin(F)), o: s.packLook.o, k: s.packLook.k };
}
// what plugins/roomstage pack.js answers, and a nudge when the inventory changed some other way (dispatch.js)
export function freelookPack(msg) { if (!st?.pack) return; st.packMsg = msg; st.pack.data(msg); }
export function freelookPackDirty() { st?.pack?.dirty(); }
// What the spray session needs of the street: a name for the wall, and brick for its close-up. Where on the facade the
// paint goes is GLASS's to solve (windshield.js drawWallTags), so there's no aim and no live paint: the window is sent
// again when the tag's up (plugins/freelook), and the wall has it.
const FOOT_SPRAY = Object.freeze({ label: 'the street', ground: 'brick' });
function footTurn(s, dt) {
  const sp = s.foot.spin, turn = (sp.has('e') ? 1 : 0) - (sp.has('q') ? 1 : 0), v = turn ? s.freeCam.view() : null;
  if (v) s.freeCam.aimAt(v.yaw + turn * FOOT_TURN * dt, v.pitch);
}
// How much of a standing eye is left, eased as the room eases a crouch. 1 for anything that isn't on foot.
function footEye(s, dt) {
  const f = s.foot;
  if (!f) return 1;
  const want = f.crouched ? FOOT_CROUCH : 1;
  f.eyeK += (want - f.eyeK) * (1 - Math.exp(-dt * 12));
  if (Math.abs(f.eyeK - want) < 0.002) f.eyeK = want;
  return f.eyeK;
}
// How high your feet are off the street: up a footbridge's lift and across its deck (glass/street-kit.js kitDeck).
// In a lift you go with the car the renderer draws, off the same clock; the step on and off it is eased.
function footLift(s, dt) {
  const f = s.foot, fv = s.freeCam.view();
  if (!f || !fv || s.inside || !s.map || !windshieldLoaded()) return f ? (f.lift = 0) : 0;
  const ax = s.gx + fv.x, ay = s.gy + fv.y;
  const tNow = performance.now(), d = streetKitDeckAt(s.map, s.gx, s.gy, ax, ay, f.lift || 0, tNow, false);
  // stepping into a car sends both cars of the bridge (glass/street-kit.js THE FOOTBRIDGE LIFTS)
  const inCar = d?.lift != null ? d.key : null;
  if (inCar != null && f.liftIn !== inCar) streetKitLiftBoard(inCar, (f.lift || 0) > 0.2, tNow);
  f.liftIn = inCar;
  // a park's hedges, copings, benches and walls are climbed onto, not walked through (windshield.js parkTopAt)
  const wx = Math.round(ax), wy = Math.round(ay), park = parkTopAt(wx, wy, cellOf(s, wx, wy), ax, ay, FOOT_CLIMB);
  const want = Math.max(d ? d.floor : 0, park);
  // a climb up is a pull-up, slower than the step down off the top
  const rate = !d && want > (f.lift || 0) ? 7 : 14;
  f.lift = (f.lift || 0) + (want - (f.lift || 0)) * (1 - Math.exp(-dt * rate));
  if (Math.abs(f.lift - want) < 0.0005) f.lift = want;
  return f.lift;
}
// A drag looks and the wheel zooms, as in the room. The cursor stays a cursor, so the buttons in the corner are
// one click away and nothing has to be pressed to free the mouse.
function bindFootPointer(el, cam) {
  let drag = null;
  const down = (e) => {
    if (e.target.closest?.('button')) return;
    // a click on the world takes the keyboard back from the command line
    if (!e.target.closest?.('input, textarea, select, [contenteditable]')) {
      const f = document.activeElement; if (f?.matches?.('input, textarea, [contenteditable]')) f.blur();
    }
    if (e.button === 1) e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, v = cam.view();
    drag.x = e.clientX; drag.y = e.clientY;
    if (v && (dx || dy)) cam.aimAt(v.yaw + dx * FOOT_DRAG * 180 / Math.PI, v.pitch - dy * FOOT_DRAG);
  };
  const up = () => { drag = null; };
  const wheel = (e) => { e.preventDefault(); cam.zoomBy(e.deltaY > 0 ? 1 / 1.06 : 1.06); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
  };
}

// ── ON FOOT: WALLS ARE WALLS, AND A BUILDING HAS A DOOR ──────────────────────
//
// Everything a truck can't drive through, somebody on foot can't walk through: the same captured mass
// (groundObstructionAt), asked at the eye's height so a canopy is walked under, with a body's width round the
// eye so the lens never reaches a wall. A step that ends in something slides along it.
//
// A building with a Stage (`doors`, plugins/roomstage streetDoorsNear) is entered at its door and nowhere else:
// its tile takes a step only from its doorstep, inside the doorway, with the doors apart. The move is still the
// tile edge's (watchFoot), and the wall behind the doors holds you the moment it takes the server to answer.
//
// ⚠ THE DOORWAY IS READ OFF THE MODEL, NOT WRITTEN DOWN TWICE. Where the front wall stands, how wide the gap
// between the jambs is and how high the lintel hangs are asked of the building's own mass, so the leaves fit
// whatever arm draws it. An arm with no jambs or lintel gets a doorway from the room's own width.
const METRE = FPS_EYE / 1.6;   // a metre in tiles: FPS_EYE is 1.6 m
// GLASS 2's near plane on foot (makeCam nearMax). The fixed 0.06 tiles is 1.07 m, which cut away anybody you walked up
// to. 0.3 m is about NEAR_MIN (gl/camera.js), the plane a camera flat on the road already ships with.
const FOOT_NEAR = 0.3 * METRE;
const FOOT_CLIMB = 1.8 * METRE;   // the highest park furniture you climb onto; anything taller (a lamp, a crown) you pass under
const FOOT_BODY = 0.016, FOOT_STEP = 0.011, DOOR_NEAR = 2.6 * METRE, DOOR_SLIDE_NEAR = 6 * METRE, DOOR_HOLD_MS = 1400, DOOR_OPEN_S = 0.55, DOOR_SHUT_S = 0.9;
// a hinged glass pair (`swing`) swings in more slowly and lets you through only once it's all the way in, so the
// step in (and the cover taken from it) never has a leaf across the doorway
const DOOR_SWING_S = 0.85, passOpen = (d) => (d.swing ? 0.97 : 0.65);
const EDGE_VEC = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const cellOf = (s, wx, wy) => { const R = (s.map.length - 1) / 2; return s.map[wy - s.gy + R]?.[wx - s.gx + R] || null; };
const doorAt = (s, wx, wy) => s.foot.doors.find((d) => d.gx === wx && d.gy === wy) || null;
function solidAt(s, ax, ay, z) {
  for (const [ox, oy] of [[0, 0], [FOOT_BODY, 0], [-FOOT_BODY, 0], [0, FOOT_BODY], [0, -FOOT_BODY]]) {
    const px = ax + ox, py = ay + oy, wx = Math.round(px), wy = Math.round(py), c = cellOf(s, wx, wy);
    if (!c) continue;
    // a depot's shed: its walls, and its roller door until it's up (bayWalk). A truck's rule for the shed (the
    // doorway only, opening for whatever comes at it) isn't a walker's.
    if (c.mark === 'bay') { if (bayFootSolid(wx, wy, c, px, py, z, s.foot?.bays?.get(`${wx},${wy}`)?.open || 0)) return true; continue; }
    if (groundObstructionAt(wx, wy, c, px, py, z, FOOT_STEP) > 0) return true;
  }
  // the street kit's guard rails, which are drawn and not mass (glass/street-kit.js kitFoot)
  // and its bollards, up to your knees: you walk round them, unless you're up on the footbridge over them
  const k = streetKitFootAt(s.map, s.gx, s.gy, ax, ay, FOOT_BODY);
  if (k?.rail || (k?.bollard && (s.foot?.lift || 0) < 0.02)) return true;
  return false;
}
// The street's belt under your feet carries you the way its chevrons point, at its own speed.
function footBelt(s, dt) {
  const fv = s.freeCam.view();
  if (!fv || s.inside || !s.map || !windshieldLoaded()) return;
  if ((s.foot?.lift || 0) > 0.002) return;   // up on a footbridge, over the strip
  const b = streetKitFootAt(s.map, s.gx, s.gy, s.gx + fv.x, s.gy + fv.y)?.belt;
  if (b) s.freeCam.carry(b[0] * dt, b[1] * dt);
}
// The doorway of a building, in its model's own frame (y out of the front, x along it), from its mass.
function doorway(s, d) {
  if (d.g !== undefined) return d.g;
  const c = cellOf(s, d.gx, d.gy), E = EDGE_VEC[d.edge];
  if (!c || !E || !windshieldLoaded()) return null;   // (not kept: the window or the renderer isn't in yet)
  const at = (lx, ly) => [d.gx + lx * E[1] + ly * E[0], d.gy - lx * E[0] + ly * E[1]];
  // a depot's shed has no mass to read (it's a mark, drawn by drawVehicleBay): its doorway is the roller door's
  // opening, in the shed's own front wall, and the door is bayWalk's
  if (c.mark === 'bay') {
    const D = bayDims(c);
    return (d.g = { E, at, wall: D.HL, plane: D.HL, half: D.DOOR_W, top: D.DOOR_H, leaves: false, bay: true });
  }
  // the doorway the model drew, if it recorded one (windshield.js doorBayAt), else its mass
  const cx = d.look?.cx || 0, bay = doorBayAt(d.gx, d.gy, c, cx);
  return (d.g = measureDoorway(d.gx, d.gy, c, E, d.w, groundObstructionAt, METRE, cx, bay, d.look?.h || 0));
}
// ── ON FOOT, INSIDE: ONE WORLD (docs/proposals/one-world-interiors.md) ──────────
//
// With ONE_WORLD on, walking in at a street door keeps you in GLASS: the building's rooms are already drawn in the
// city (gl/interiors.js), so the server's `room_view` is taken here (freelookTakeRoom) instead of opening the Room
// Stage. Its own model comes off the map, the rooms' walls and furniture hold you (room-layout.js roomFree, the
// Stage's own rule), and walking through a doorway sends that doorway's move, as the Stage does.
// ⚠ ON FOR ENTRY ROOMS ONLY (`entry`): a room with a street door and nothing that needs the Stage (oneWorldRoom).
// Everywhere else the Stage opens as before. `__oneWorld(true)` takes every drawn room, `__oneWorld(false)` none.
export const ONE_WORLD = { on: false, entry: true };
if (typeof window !== 'undefined') window.__oneWorld = (on = true) => { ONE_WORLD.on = !!on; ONE_WORLD.entry = !!on; return on; };
// Whether one-world takes this room: every drawn room with `on`; with `entry`, a room you come into off the street
// that has none of what only the Stage draws or works (a lift car or landing, the rink, a roof deck, a balcony).
function oneWorldRoom(s, r) {
  if (ONE_WORLD.on) return true;
  if (!ONE_WORLD.entry || !r) return false;
  const sp = r.L.spec || {}, ops = sp.openings || [];
  if (sp.car || sp.lift || sp.rink || sp.open || sp.balcony) return false;
  if (ops.some((o) => o.lift)) return false;
  // a shop: its counter or shelves are worked on the Stage (docs/proposals/shop-interiors.md)
  const shopFlag = (f) => f && (f.serves || f.checkout || f.vendor_stock);
  if ((r.L.placed || []).some((p) => shopFlag(p.flags) || shopFlag(p.row?.flags) || p.look?.stock)) return false;
  return ops.some((o) => o.dir && o.kind === 'front' && !(s.interiors || []).some((q) => q.zone === o.to));
}
// ⚠ THE BUILDING STAYS ON THE MAP, LESS THE STOREY YOU'RE ON (gl/context.js uCutA, the balcony's cut). Taking the
// whole model off left you in a lobby with no building over it, and the eye placed off the room's own sums, not the
// model's. Now the facade, the storeys over you and the doorway are the model's, and the rooms on this floor (drawn
// whole, gl/interiors.js) stand in the band the cut takes out of it: the building's tile, floor slab to ceiling.
// ⚠ ONE TILE ONLY: a building on several tiles (the Solenne's 2 by 2) keeps its other tiles whole for now.
const CUT_SLAB_M = 0.15, CUT_TILE_REACH = 0.52;
function insideCut(s) {
  const I = s.inside, r = I?.room;
  if (!r) return null;
  const M = r.M, k = M[6] || METRE, floorM = M[14] / k + (r.L.floor || 0), h = Number(r.L.spec?.h) || 3;
  const tx = r.gx - s.gx, ty = r.gy - s.gy;
  return { x: tx, y: ty, rad: 0, half: 4, back: 4, z0: k * (floorM - CUT_SLAB_M), z1: k * (floorM + h + CUT_SLAB_M), tx, ty, reach: CUT_TILE_REACH };
}
// Where a point (tiles about the window's centre) is in a room's own frame: [u, v], by its matrix's inverse.
function roomUV(s, r, x, y) {
  const M = r.M, tx = s.gx + x - r.gx - M[12], ty = s.gy + y - r.gy - M[13], det = M[0] * M[9] - M[8] * M[1];
  if (!det) return null;
  const px = (tx * M[9] - M[8] * ty) / det, pz = (M[0] * ty - M[1] * tx) / det;
  const l = r.L.local([px, r.L.floor, pz]);
  return [l[0], l[1]];
}
// The room of the building you're in that's free at a point, if any.
function roomAt(s, x, y) {
  const I = s.inside;
  for (const r of s.interiors || []) {
    if (r.gx !== I.gx || r.gy !== I.gy || r.L.floor !== I.room.L.floor) continue;
    const p = roomUV(s, r, x, y);
    if (p && roomFree(r.L, p[0], p[1])) return r;
  }
  return null;
}
// A step inside: into free floor of any room on this floor, or out through a doorway of the room you're in. A
// doorway to another room sends its move; the street door sends its own, and the server's window takes you out.
function insideBlock(s, x0, y0, x1, y1) {
  const I = s.inside;
  const ok = (x, y) => {
    const r = roomAt(s, x, y);
    if (r) {
      if (r !== I.room) {
        const o = (I.room.L.spec.openings || []).find((q) => q.to === r.zone && q.dir);
        if (!o) return false;
        I.room = r; I.zone = r.zone; s.foot.onMove?.(o.dir);
      }
      return true;
    }
    const p = roomUV(s, I.room, x, y), o = p && openingCrossed(I.room.L, p);
    if (o && o.dir && !(s.interiors || []).some((q) => q.zone === o.to)) {
      // out: the server's window takes it from here, and the tile edge mustn't send a second move meanwhile
      s.inside = null; s.foot.pending = { t: performance.now(), back: [s.gx + x0, s.gy + y0] }; s.foot.onMove?.(o.dir);
      return true;
    }
    return false;
  };
  if (ok(x1, y1)) return null;
  if (ok(x1, y0)) return [x1, y0];
  if (ok(x0, y1)) return [x0, y1];
  return [x0, y0];
}
// `room_view` for a room this view has drawn: stay in GLASS. True when it's taken; the Stage opens otherwise.
// whether you're walking round inside a building in GLASS, so the server's indoor close doesn't park the view
export function freelookInside() { return !!st?.inside; }
export function freelookTakeRoom(msg) {
  const s = st;
  if (!s || !s.foot) return false;
  const room = (s.interiors || []).find((r) => r.zone === msg.zone);
  if (!room || !oneWorldRoom(s, room)) { if (s.inside) s.inside = null; return false; }
  if (s.warm) {
    const mount = document.getElementById('area-content');
    if (!mount) return false;
    s.warm = false; mount.innerHTML = ''; mount.appendChild(s.root);
    s.holder?.remove(); s.holder = null; s.mount = mount;
    s.wake(); uncoverPane();
  }
  // the model stays; the storey you're on is cut out of it (insideCut)
  const from = s.inside;
  s.inside = { zone: msg.zone, room, gx: room.gx, gy: room.gy };
  s.foot.pending = null;
  // in from the street: stood just inside its door, as the Stage stands you (openingInside), since the doorway itself
  // is no room's floor
  const o = !from && (room.L.spec.openings || []).find((q) => q.dir && !(s.interiors || []).some((r) => r.zone === q.to));
  const v = o && s.freeCam.view();
  if (v) {
    const at = openingInside(room.L, o).at, P = room.L.world(at[0], at[1], 0), M = room.M;
    s.freeCam.rebase(room.gx + M[0] * P[0] + M[8] * P[2] + M[12] - (s.gx + v.x), room.gy + M[1] * P[0] + M[9] * P[2] + M[13] - (s.gy + v.y));
  }
  return true;
}
function footBlock(s, x0, y0, x1, y1) {
  const f = s.foot;
  if (!f || !s.map) return null;
  if (s.inside) return insideBlock(s, x0, y0, x1, y1);
  const z = s.freeCam.view()?.z ?? FPS_EYE, a0x = s.gx + x0, a0y = s.gy + y0;
  // stood in something already (put down there, or the window changed): walking out of it is allowed
  if (solidAt(s, a0x, a0y, z)) return null;
  // the footbridge: its lift towers take you when the car's at your feet, and up on the deck the rails hold you
  const tNow = performance.now(), h = f.lift || 0;
  const riding = streetKitDeckAt(s.map, s.gx, s.gy, a0x, a0y, h, tNow, true)?.lift != null;
  const ok = (x, y) => {
    const ax = s.gx + x, ay = s.gy + y, wx = Math.round(ax), wy = Math.round(ay);
    const d = (wx !== Math.round(a0x) || wy !== Math.round(a0y)) ? doorAt(s, wx, wy) : null;
    if (d) {
      const g = doorway(s, d), E = EDGE_VEC[d.edge];
      if (!g || Math.round(a0x) !== d.gx + E[0] || Math.round(a0y) !== d.gy + E[1]) return false;
      // across the doorway from its own middle, which isn't the tile's when the model put the door off-centre
      const along = Math.abs((ax - d.gx) * E[1] - (ay - d.gy) * E[0] - (g.cx || 0));
      if (along > g.half - FOOT_BODY || ((g.leaves || !d.slide) && (d.open || 0) < passOpen(d))) return false;
    }
    if (streetKitDeckAt(s.map, s.gx, s.gy, ax, ay, h, tNow, riding, FOOT_BODY)?.solid) return false;
    return !solidAt(s, ax, ay, z);
  };
  if (ok(x1, y1)) return null;
  if (ok(x1, y0)) return [x1, y0];
  if (ok(x0, y1)) return [x0, y1];
  return [x0, y0];
}
// The doors near you: how far apart each pair is now, and what the renderer draws (glass/street-doors.js). They
// part as you come up to them and shut a beat after you've gone, at the lobby's own distances and speeds.
function doorLeaves(s, now, dt) {
  const f = s.foot, fv = s.freeCam.view();
  if (!fv || !f.doors.length || !s.map) return null;
  if (s.interiorsLater && windshieldLoaded()) { const later = s.interiorsLater; s.interiorsLater = null; keepInteriors(s, later); if (s.interiorsLater === later) s.interiorsLater = null; }
  const ax = s.gx + fv.x, ay = s.gy + fv.y, out = [];
  for (const d of f.doors) {
    if (Math.abs(d.gx - ax) > 8 || Math.abs(d.gy - ay) > 8) continue;
    const g = doorway(s, d);
    if (!g || g.bay) continue;   // a depot's roller door is bayWalk's, and the shed draws it
    const [px, py] = g.at(0, g.wall);
    const near = Math.hypot(px - ax, py - ay) < (d.slide ? DOOR_SLIDE_NEAR : DOOR_NEAR) + (0.5 - g.wall);   // glass parts from further off, so you see it open
    // only automatic glass doors (`slide`, flags.room.street_door) part as you come up; a plain door waits for F (footDoor)
    if (near && d.slide) d.hold = now + DOOR_HOLD_MS;
    if (d.open === undefined) d.open = near && d.slide ? 1 : 0;   // come out of them, they're apart behind you
    const want = (d.hold || 0) > now ? 1 : 0, k = d.open || 0, step = dt / (want > k ? (d.swing ? DOOR_SWING_S : DOOR_OPEN_S) : DOOR_SHUT_S);
    d.open = Math.abs(want - k) <= step ? want : k + Math.sign(want - k) * step;
    // the glass is drawn only for a building that has it; any other door is the arm's own (the Cherry Pit's bars)
    // and behind any door, the lobby as it was last seen from it (lobby-still.js), so the street looks into it
    // a plain door (not automatic glass) is drawn here too, as one barred leaf that swings in when F opens it, over
    // whatever the arm baked into its doorway (glass/street-doors.js barredLeaf)
    const glass = !!(g.leaves && d.slide), card = null, bars = !!(g.leaves && !d.slide);
    if (glass || card || bars) out.push({ x: d.gx, y: d.gy, E: g.E, plane: g.plane, wall: g.wall, back: g.back, half: g.half, sill: g.sill || 0, top: g.top, fit: g.fit, open: d.open * d.open * (3 - 2 * d.open), glass, card, look: d.look || null, cx: g.cx || 0, kind: d.kind || null, ...(d.swing ? { swing: true } : {}), ...(bars ? { bars: true } : {}) });
  }
  return out.length ? out : null;
}

// ── ON FOOT: A DEPOT'S ROLLER DOOR ───────────────────────────────────────────
// A shed's door (windshield.js drawVehicleBay) goes up for somebody walking to it, as it does for a truck rolling at
// it, at a walker's distances: it starts up as you come within BAY_WALK_NEAR of the opening, and comes down a beat
// after you've gone. A roller is slower than a glass pair, so a brisk walk meets it still rising, and it holds you
// (bayFootSolid) until its bottom edge is over your head. How far up each one is goes to the renderer as
// `bayDoors`, so the door you see is the door that stops you, and onto the building's door record (`d.open`), so the
// step in (watchFoot) waits for it too. Every shed round you, whether or not it has a Stage behind it.
const BAY_WALK_NEAR = 5 * METRE, BAY_UP_S = 1.4, BAY_DOWN_S = 2.2, BAY_HOLD_MS = 1500;
const BAY_ENTER_AT = -0.03;   // the step in is taken just under the door, inside the threshold, not out on the apron
function bayWalk(s, now, dt) {
  const f = s.foot, fv = s.freeCam.view();
  if (!f || !fv || !s.map || !windshieldLoaded()) return null;
  const ax = s.gx + fv.x, ay = s.gy + fv.y, cx = Math.round(ax), cy = Math.round(ay);
  const bays = f.bays || (f.bays = new Map()), out = [];
  for (const [k, b] of bays) if (now - b.seen > 1000) bays.delete(k);   // a shed you've walked away from
  for (let wy = cy - 3; wy <= cy + 3; wy++) for (let wx = cx - 3; wx <= cx + 3; wx++) {
    const c = cellOf(s, wx, wy);
    if (c?.mark !== 'bay') continue;
    const key = `${wx},${wy}`, D = bayDims(c), E = EDGE_VEC[c.ent] || EDGE_VEC.south;
    // the walker in the shed's own frame: x along its front, y out through the door
    const ox = ax - wx, oy = ay - wy, lx = ox * E[1] - oy * E[0], ly = ox * E[0] + oy * E[1];
    const inside = Math.abs(lx) < D.HW && Math.abs(ly) < D.HL;
    const near = inside || (ly > D.HL - 0.05 && Math.hypot(Math.max(0, Math.abs(lx) - D.DOOR_W), ly - D.HL) < BAY_WALK_NEAR);
    let b = bays.get(key);
    if (!b) bays.set(key, (b = { open: near ? 1 : 0, hold: 0 }));   // come out of it, it's up behind you
    b.seen = now;
    if (near) b.hold = Math.max(b.hold, now + BAY_HOLD_MS);
    const want = b.hold > now ? 1 : 0, step = dt / (want > b.open ? BAY_UP_S : BAY_DOWN_S);
    b.open = Math.abs(want - b.open) <= step ? want : b.open + Math.sign(want - b.open) * step;
    out.push({ x: wx, y: wy, open: b.open });
  }
  for (const d of f.doors) { const b = bays.get(`${d.gx},${d.gy}`); if (b) d.open = b.open; }
  return out.length ? out : null;
}

// F AT A DOOR: open it and go in. Stood on a building's doorstep within reach of its doorway, the door is held
// open and the step through it is the ordinary 'move <dir>' (watchFoot's), so the Room Stage takes the pane as it
// does for somebody who walks in.
function footDoor(s) {
  const f = s.foot, fv = s.freeCam.view();
  if (!f || !fv || !s.map || f.pending) return;
  const ax = s.gx + fv.x, ay = s.gy + fv.y, T = f.tile;
  for (const d of f.doors) {
    const E = EDGE_VEC[d.edge];
    if (!E || T.gx !== d.gx + E[0] || T.gy !== d.gy + E[1]) continue;
    const g = doorway(s, d);
    if (!g) continue;
    const [px, py] = g.at(0, g.wall);
    if (Math.hypot(px - ax, py - ay) > DOOR_NEAR + (0.5 - g.wall)) continue;
    const now = performance.now();
    // a plain door (the Cherry Pit's bars) swings open first, and only then does the street go dark; an automatic
    // glass pair is already apart by the time you're close enough to press F
    // (a depot's roller door goes up at its own pace, bayWalk's, and you go in under it once it's up)
    const bay = g.bay ? f.bays?.get(`${d.gx},${d.gy}`) : null;
    if (g.bay && !bay) return;
    const wait = d.slide && !d.swing ? 0 : Math.round((bay ? BAY_UP_S : d.swing ? DOOR_SWING_S : DOOR_OPEN_S) * 1000 * (1 - (d.open || 0)));
    if (bay) bay.hold = now + wait + BAY_HOLD_MS;
    else d.hold = now + wait + DOOR_HOLD_MS;
    if (d.slide && !d.swing) d.open = 1;   // a hinged pair swings in at its own pace, never snaps
    f.pending = { t: now + wait, back: [ax, ay] };
    const go = () => {
      if (st !== s || f.pending?.back?.[0] !== ax) return;
      f.pending.t = performance.now();
      noteDoor(d); enterCover(s, d);
      f.onMove(`footstep ${d.gx} ${d.gy}`);
    };
    if (wait) setTimeout(go, wait); else go();
    return;
  }
}

// Where the server put you after a step on foot.
// The view leads on foot (watchFoot), so an ordinary answer only confirms a tile it's already left behind; a refused
// step (a gate said no) is the one that moves the view: back inside the tile the server has you on.
// ⚠ AND A MOVE THE VIEW DIDN'T MAKE (`moved`: a typed `north`, a click on the minimap, a GPS walk, a queued step) moves
// the view too. It used to be taken as a confirmation and dropped, so the text map went one way and the eye stayed.
export function freelookStep(msg) {
  const s = st, f = s?.foot;
  if (!f) return;
  if (Number.isInteger(msg.gx) && Number.isInteger(msg.gy)) f.server = { gx: msg.gx, gy: msg.gy };
  if (!msg.refused && !msg.moved) {
    f.pending = null;
    if (f.sent && f.sent.gx === msg.gx && f.sent.gy === msg.gy) f.sent = null;
    return;
  }
  f.tile = { gx: msg.gx, gy: msg.gy };
  f.pending = null; f.sent = null;
  uncoverPane();
  // why it wouldn't let you (a shut club, a locked door), on the view rather than only in the log behind it
  if (msg.refused && msg.message) s.flash?.(String(msg.message).replace(/<[^>]*>/g, ''), 6000);
  if (s.inside) return;   // walking round inside in GLASS (ONE_WORLD): the room has you, not the street
  const fv = s.freeCam.view();
  if (!fv) return;
  const ax = s.gx + fv.x, ay = s.gy + fv.y;
  // moved by the server and already there (stood on its doorstep as the street door let you out): nothing to do
  if (msg.moved && Math.round(ax) === msg.gx && Math.round(ay) === msg.gy) return;
  const bx = msg.gx + Math.max(-0.42, Math.min(0.42, ax - msg.gx)), by = msg.gy + Math.max(-0.42, Math.min(0.42, ay - msg.gy));
  s.freeCam.rebase(bx - ax, by - ay);
}

function ensureFreelookStyles() {
  const el = document.getElementById('freelook-styles') || document.createElement('style');
  el.id = 'freelook-styles';
  // Rewritten every time rather than early-returned, for the reason helm-mode gives: a stale block
  // left by an older build would pin the old layout under this module's fresh JS.
  el.textContent = `
    #area-content:has(.fl-root){ height:100%; overflow:hidden; overscroll-behavior:contain; touch-action:none; }
    .fl-root{ position:relative; width:100%; height:100%; min-height:380px; overflow:hidden;
      overscroll-behavior:contain; touch-action:none; background:#05070b; }
    .fl-view, .fl-view .ws-wrap{ position:absolute; inset:0; }
    /* The chrome fades with the rest of the free camera's — see bindFreeCamIdle. Anything on this
       glass is in the shot, and the two things that cannot simply go are the way out and the way
       out written down, so they go on a timer instead. */
    .fl-chips{ position:absolute; top:8px; right:8px; z-index:6; display:flex; gap:6px; align-items:center;
      transition:opacity .35s linear; }
    .fl-chip{ font:10px/1 monospace; letter-spacing:1px; color:#dfe6ef; background:rgba(8,11,15,0.62);
      border:1px solid rgba(255,255,255,0.16); border-radius:9px; padding:5px 9px; }
    button.fl-chip{ cursor:pointer; }
    button.fl-chip:hover{ border-color:rgba(255,255,255,0.42); }
    /* A pressed rung reads as pressed, the '.on' convention every other corner in this client uses.
       ⚠ The two readouts are SPANs and must never pick this up — 'button.fl-chip' rather than
       '.fl-chip', or a weather chip that happened to be given the class would light like a switch. */
    button.fl-chip.on{ background:rgba(233,241,250,0.90); color:#0a0f16; border-color:rgba(233,241,250,0.95); }
    /* FPS / FLY is a word where its neighbours are glyphs, so it gets a fixed width — otherwise the
       whole row shuffles sideways every time the mode changes and the button you were aiming at has
       moved. Same reason the flight sim's ◎ EXT is padded rather than sized to its text. */
    button.fl-chip.fl-fps{ min-width:34px; text-align:center; }
    /* On a phone the corner row is a row of 44px targets rather than 10px text. */
    html[data-density="compact"] .fl-chips{ gap:4px; flex-wrap:wrap; justify-content:flex-end; max-width:calc(100% - 16px); }
    html[data-density="compact"] .fl-chip{ font-size:12px; padding:0 10px; min-height:36px; display:inline-flex; align-items:center; }
    html[data-density="compact"] button.fl-chip{ min-width:40px; justify-content:center; }
    html[data-density="compact"] .fl-hint{ white-space:normal; width:max-content; max-width:calc(100% - 24px); text-align:center; line-height:1.35; }
    .fl-hint{ position:absolute; left:50%; bottom:12px; transform:translateX(-50%); z-index:6;
      font:11px/1 system-ui,sans-serif; letter-spacing:0.6px; color:#dfe6ef; background:rgba(8,11,15,0.62);
      padding:4px 12px; border-radius:11px; border:1px solid rgba(255,255,255,0.16);
      pointer-events:none; white-space:nowrap; transition:opacity .35s linear; }
    /* ── ⚠ THE HINT FADES AND THE BUTTONS DO NOT, WHICH IS THE OPPOSITE OF THE THREE SEATS ──
       In the cab, the cockpit and the wheelhouse the free camera is a MODE: you press O to take it
       off its mount and O to put it back, the vehicle is still there underneath, and the chrome
       going quiet after a few seconds is the reward for composing a shot. Out here the camera is
       never on a mount — this view IS the detached camera — so that timer is not a mode, it is the
       permanent state of the view: two and a half seconds after it opens, the way out, the big
       screen button and both readouts are gone and stay gone.
       ⚠ AND THE ONE THING THAT BRINGS THEM BACK IS THE ONE THING YOU CANNOT SPEND. Waking the
       chrome means moving the mouse, and in here the mouse IS the camera — so you cannot look at
       the row without losing the shot you were lining up, which is exactly when you wanted it.
       Reported as the buttons having disappeared, and they had.
       So the row stays. What the fade was FOR — a picture with nothing on it — is big screen's job
       now, and big screen takes the lot outright rather than hoping nobody breathes on the desk.
       The hint keeps the timer, because it is a paragraph of text across the bottom of the frame
       and it is genuinely read once. */
    body.freecam-idle .fl-hint{ opacity:0; }
    /* ── BIG SCREEN ────────────────────────────────────────────────────────
       Everything but the picture. The chips and the hint fade on the free camera's own timer up
       there; in here they go outright, because the way out of big screen is Esc and the mode
       carries its own line saying so — and O still closes the view from inside it.
       ⚠ AN ALLOW-LIST, the shape the three seats already use, so anything hung on this glass
       later is out of the shot the day it arrives. '.ws-label' is the vantage's own name in the
       corner, which is a caption, and there is no windscreen out here for the A-pillars to be. */
    body.bigscreen .fl-root > *:not(.fl-view):not(.foot-dock):not(.rp){ display:none !important; }
    /* On foot the Pack and tablet are bottom right (foot-dock.css), and stay there in big screen as they do in a
       room: your pockets don't go because the picture got bigger. On a phone the hint wraps, so it goes above them. */
    html[data-density="compact"] .fl-root:has(.foot-dock) .fl-hint{ bottom:64px; }
    body.bigscreen .fl-root .ws-label,
    body.bigscreen .fl-root .ws-frame::after{ display:none; }`;
  if (!el.parentNode) document.head.appendChild(el);
}
