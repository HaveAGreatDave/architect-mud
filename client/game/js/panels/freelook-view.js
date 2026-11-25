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
import { loadWindshield, isLoaded as windshieldLoaded, paintWindshield, windshieldHTML, ensureWindshieldStyles, disposeWindshield, normalizeWx, navMarks, raptorsNow, yachtScopeMount, yachtDeckEye, seaRideAt, modelTopZAt, curtainTopZAt, groundObstructionAt, doorBayAt, parkTopAt, streetKitFootAt, streetKitDeckAt, streetKitLiftPress, streetKitLiftBoard, bayFootSolid, bayDims, ROAD_RIG_MUL, viewFocal, viewLatFocal, GL_TIER, streetActorSpots } from './windshield-lazy.js';
export { loadWindshield };
import { createFreeCam, freeCamHint, freeCamTouchUI, bindFreeCamPointer, bindFreeCamIdle } from './freecam.js';
import { makeContactTrack } from './world-feed.js';
import { internMap } from './map-intern.js';
import { seatLadderHTML, bindSeatLadder, releaseSeatLadder, keepSeatRung } from './seat-ladder.js';
import { claimSeatKeyboard, endSeatKeyboard } from './seat-keys.js';
import { setSprayStage, clearSprayStage } from './spray-aim.js';
import { footDockHTML, bindFootDock } from './foot-dock.js';
import { floorZAt } from './seabed-scene.js';
import { interiorRoomsOf, placeOnVessel } from './room-interiors.js';
import { setVesselCut } from './gl/solids.js';   // her storey cut out of her hull while you stand in it (owVesselTick)
import { YACHT_SCALE, YACHT_SB, YACHT_BOW, YACHT_LEN } from '../../../shared/yacht-hull.js';
import { noteDoor, noteCarry } from './lobby-still.js';
import { preVeil, veilReady } from './glass-veil.js';
import { roomFree, openingCrossed, openingInside, roomNearFree, FT_PER_M, stairsOf, wellBoxes } from '../../../shared/room-layout.js';   // a building's rooms, drawn in the city (docs/proposals/one-world-interiors.md)
import { FT_M, m2t as m2tf } from '../../../shared/world-scale.js';
import { measureDoorway } from './glass/doorway-measure.js';   // a street door's opening, read off its building's mass
import { oneWorldTakes, sameStorey, RINK_IN_GLASS } from './glass/interiors-near.js';   // which rooms leave the Stage, and which share a storey
import { createOneWorldCard, facedPiece, seatFor, sitCmd, facedLock } from './oneworld-card.js';
import { lockActs, lockLetsThrough, doorName } from '../../../shared/room-locks.js';
import { createBatch } from './gl/ballpark-mesh.js';
import { roomKitchenKit } from './gl/room-mesh.js';   // what a room cooks with, for the kitchen at its hob (phase F)
import { cookFrame, cookersIn, coldIn } from './room-cook.js';   // where the kitchen stands in the room, shared with the Stage
import { multiply as mat4Mul, invert as mat4Inv } from './gl/core/mat4.js';   // a depot's vehicle, written for the interiors layer
import { createOneWorldSound } from './oneworld-sound.js';   // inside, the outside through the windows (phase D)
import { state } from '../state.js';   // the room the server last said you're in (owGoingTick)
import { roomPeopleRecords, lyingBodies, placePeople, facedPerson, noteMoves, routesOf, walking as walkingNow } from './oneworld-people.js';
import { personActs } from '../../../shared/room-acts.js';
import { token as personToken } from '../../../shared/person-token.js';   // inside, what somebody you face offers
import { litOf, switchOf, saveSwitch } from '../../../shared/room-lights.js';   // inside, each room's lamps (phase D)   // inside, the room's people (phase C)   // a locked doorway inside   // inside, what the piece you face offers
// The rooms the server sent for the buildings near you on foot, kept for the view (each building once, by its tile)
function keepInteriors(s, list) {
  const by = new Map((s.interiors || []).map((r) => [r.key, r]));
  let unplaced = false;
  for (const b of list) {
    const shift = doorShift(s, b.tile);
    if (!shift && !b.vessel) unplaced = true;   // (a vessel has no door to measure: owVesselTick places her rooms)
    for (const r of interiorRoomsOf(b, { shift, lampOn: owLit, lampLevel: owLevel, was: by })) by.set(r.key, r);
  }
  s.interiors = [...by.values()];
  // the room you're in, made again (a piece moved, a lamp switched): you stay in its new entry
  if (s.inside?.room) { const now = by.get(s.inside.room.key); if (now && now !== s.inside.room) { s.inside.room = now; s.owVend && (s.owVend.room = null); } }
  // a building whose doorway couldn't be measured yet is placed again when it can (doorLeaves)
  s.interiorsLater = unplaced ? list : null;
}
// A ROOM'S LAMPS (phase D): lit when its switch, this viewer's own and the Stage's too (client/shared/room-lights.js), is
// on and its mains aren't off. The mains of a room are known once its `room_view` or a `room_power` has said; until
// then they're taken as on, as the Stage takes them.
const roomPower = new Map();   // zone -> 'on' | 'low' | 'off'
const owLit = (zone) => litOf(zone, roomPower.get(zone));
// how far up its dimmer is, and on low mains the emergency lighting's share of it (room-stage.js EMERGENCY_K)
const OW_EMERGENCY_K = 0.3;
const owLevel = (zone) => switchOf(zone).level * (roomPower.get(zone) === 'low' ? OW_EMERGENCY_K : 1);
// the rooms made again with their lamps as they stand now, after a switch or the mains changed
function owRelight(s) { if (s?.foot && sentInteriors.size) keepInteriors(s, allSentInteriors()); }
// A flat's control panel (envctl.js, opened as its window from the card's `panel`) dims a room's lights: the rooms
// drawn in GLASS follow, live as its bar is dragged, as the Stage's do (room-stage.js onPanelLight). One listener for the
// page, which does nothing with no street view up.
if (typeof window !== 'undefined') window.addEventListener('envctl:light', (e) => {
  const d = e.detail;
  if (!d?.zone || !st?.interiors?.some((r) => r.zone === d.zone)) return;
  const sw = switchOf(d.zone);
  saveSwitch(d.zone, !!d.on, d.on ? Math.max(0.1, Math.min(1, Number(d.level) || 1)) : sw.level);
  owRelight(st);
});
// `room_power`: the mains in a room changed. The Stage hears it too; this relights the rooms drawn in GLASS.
export function freelookPower(msg) {
  if (!msg?.zone) return false;
  const was = roomPower.get(msg.zone);
  roomPower.set(msg.zone, msg.power || 'on');
  if (was !== (msg.power || 'on') && st?.interiors?.some((r) => r.zone === msg.zone)) owRelight(st);
  return !!st?.inside && st.inside.zone === msg.zone;
}
// ⚠ THE SERVER SENDS A BUILDING'S ROOMS ONCE A SESSION (plugins/freelook interiorsFor, `roomsSent`), but the open that
// carries them can land where the view drops it: a prewarm while an older view is still up returns early, and a view
// closed and opened again starts empty. Either way the street had no rooms in it for the rest of the session, so a
// lobby opened the Stage. So every building sent is kept here, for the page, and each view on foot starts with them.
const sentInteriors = new Map();   // "x,y" -> the building as the server sent it
const SENT_INTERIORS_KEEP = 48;
function noteInteriors(list) {
  for (const b of list || []) {
    const k = b.tile.x + ',' + b.tile.y;
    sentInteriors.delete(k); sentInteriors.set(k, b);
    if (sentInteriors.size > SENT_INTERIORS_KEEP) sentInteriors.delete(sentInteriors.keys().next().value);
  }
}
const allSentInteriors = () => [...sentInteriors.values()];
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
import { selfLookFor } from '../../../shared/self-look.js';   // a zone's own look for your body (the In Between's outline)
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
  freelookSetSky(ctx.sky); freelookSetActors(ctx.actors); freelookSetHere(ctx.here); freelookSetContacts(ctx.contacts);
  if (ctx.stand?.foot) s.stand = ctx.stand;
  if (s.foot) {
    s.foot.tile = { gx: ctx.stand?.step?.gx ?? gx, gy: ctx.stand?.step?.gy ?? gy };
    s.foot.server = { ...s.foot.tile }; s.foot.sent = null;
    s.foot.pending = null; s.foot.crouched = false; s.foot.eyeK = 1; s.foot.lift = 0; s.foot.spin.clear();
    s.foot.doors = ctx.doors || s.foot.doors || [];
    if (sentInteriors.size) keepInteriors(s, allSentInteriors());
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
  // parked, its frame loop stops: the rain through a room's windows mustn't go on under the Stage's own
  if (s.owSound) { s.owSound.stop(); s.owSound = null; }
  // and the set: the Stage makes its own and claims tv.js's panel, which this one letting go later would take from it
  if (s.owTv) { s.owTv.stop(); s.owTv = null; }
  owLockStop(s);   // and a locked doorway's hologram
  if (s.owEnv) { s.owEnv.ui.stop(); s.owEnv.host.remove(); s.owEnv = null; }   // and a control panel's page, likewise
  if (s.owHoist) { s.owHoist.ui.dispose(); if (s.owHoist.room) s.owHoist.room.extra = null; s.owHoist = null; }   // and a depot's vehicle
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
// On foot: who's on the tile you're standing on, by name, keyed by street token (plugins/freelook hereFor). Only these
// figures can be walked up to and talked to (streetCardTick).
export function freelookSetHere(list) {
  if (st && list !== undefined) { st.here = new Map((list || []).map((q) => [q.t, q])); st.owCardAt = 0; }
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
  // and the weather the windows of a room walked in GLASS let in (oneworld-sound.js)
  st.owSky = sky; st.owSound?.sky(sky);
  if (sky.moon != null) st.moon = sky.moon;
  st.event = sky.event || null;
}

export function openFreelook(ctx = {}) {
  if (ctx.interiors) noteInteriors(ctx.interiors);   // before any branch below can drop this open
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
    freelookSetHere(ctx.here);
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
    here: new Map((ctx.here || []).map((q) => [q.t, q])),   // who's on your tile, by name (freelookSetHere)
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
    // the rooms of every building the server has sent this session, this open's among them (noteInteriors)
    if (sentInteriors.size) keepInteriors(s, allSentInteriors());
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
    if (stand?.foot) { hintEl.textContent = 'WASD to walk, Shift to run, C to crouch · drag to look, Q and E to turn · wheel zooms · F at a door goes in · G tags the wall you face · I for your pack, P for what you can eat and drink · V looks from behind you · T for your tablet · O or ✕ steps back'; return; }
    hintEl.textContent = (freeCam.standing
      ? freeCamHint(true).replace('O steps back', stand ? 'O or ✕ steps back' : 'O or ✕ closes')
      : freeCamHint(false).replace('O exit', 'H follow raptor · O close'));
  }
  paintHint();

  const atEl = root.querySelector('[data-at]');
  const wxEl = root.querySelector('[data-wx]');

  function frame(now) {
    if (!st || !st.alive) return;
    // ⚠ A VIEW TORN OUT OF THE PAGE CLOSES ITSELF. Anything that rewrites #area-content without asking (the marina's
    // counter did) left this loop painting a detached canvas at full rate: a blank pane, its GL context and a city's
    // worth of garbage a second held until the tab ran out of memory. A parked view is warm and lives in its holder.
    if (!st.warm && st.root && !st.root.isConnected) { const exit = st.onExit; closeFreelook(); try { exit?.(); } catch { /* the socket may be gone */ } return; }
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
      owVesselTick(st, now);   // a vessel's rooms on her hull as she sits this frame, and you carried with the deck
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
      if (st.stand) { const s = standSpot(st, now); if (s) freeCam.setEye(st.inside?.talkCam ? st.inside.talkCam.z : st.inside?.vatCam ? st.inside.vatCam.z : st.inside?.joinCam ? st.inside.joinCam.z : st.inside?.cookCam ? st.inside.cookCam.z : st.inside?.morphCam ? st.inside.morphCam.z : st.inside?.arrangeCam ? st.inside.arrangeCam.z : st.inside?.cupCam ? st.inside.cupCam.z : st.inside?.sat ? st.inside.sat.z : s.z * footEye(st, dt) + (st.inside ? owFloorZ(st) : footLift(st, dt))); }   // sat inside (owSit): the seat's eye; inside, off the floor under you (owFloorZ)
      if (st.foot) watchFoot(st, now, flash);
      if (st.foot) owStairTick(st);   // up or down a flight inside: stood off its far end in the next room
      if (st.foot) owGoingTick(st, flash);   // a step through a doorway the server never answered: put back
      if (st.foot) owSoundTick(st);   // inside, the outside heard through the room's windows (oneworld-sound.js)
      if (st.foot) owTvTick(st, now);   // inside, the set on the wall showing what's on (room-tv.js)
      if (st.foot) owTalkTick(st, now);   // inside, talking to somebody: the camera on their face (room-talk.js's shot)
      st.owLate = null;   // (a frame that threw before laying them mustn't pile them up)
      if (st.foot) owEnvctlTick(st);   // inside, a flat's control panel: its page on its own glass (room-envctl.js)
      if (st.foot) owLockTick(st, now);   // inside, a locked doorway's leaves and the hologram off its reader (room-lock.js)
      if (st.foot) owVendTick(st, now);   // inside, a vending machine sliding out, its plug and its buttons (room-vendor.js)
      if (st.foot) owHoistTick(st, now);   // inside a depot, the vehicle on its stand and its panel (room-hoist.js)
      if (st.foot) owVatTick(st, now);   // inside the clone hall, its vats, sleepers, machines and monitors (gl/room-vat.js)
      if (st.foot) owFigTick(st, now);   // inside, whoever the crowd's body can't draw (lying down, in a vat), close up
      if (st.foot) owCatTick(st, now, hour);
      if (st.foot) owBeastTick(st);
      if (st.foot) owMorphTick(st, now);
      if (st.foot) owArrangeTick(st, now);
      if (st.foot) owStadiumTick(st);
      if (st.foot) owCupTick(st, now);   // inside, a Cup close up (room-closeup.js)
      if (st.foot) owRinkTick(st, now);   // inside at a rink, the live ice through its openings (room-rink.js)   // inside, a stadium's boards, banners and signs (room-stadium.js)
      if (st.owStudio && st.owStudio.zone !== st.inside?.zone) owStudioStop(st);   // out of the studio's room   // inside, the arrange mode's camera over the room (room-arrange.js)   // inside, a MORPHEX pod's sequence (room-morphex.js)
      if (st.foot) owCookTick(st);   // inside, cooking at the room's hob: walk off and the kitchen shuts   // inside, a pet cat, his day, his voice (gl/room-beasts.js, gl/cat-layer.js)
      if (st.foot) owDecals(st);   // inside, the posters and the tags on the walls (room-sheets.js, room-tags.js)
      streetTagsTick(st);   // outside on foot, a name over everybody nearby (street-tags.js)
      owSpeechTick(st, now);   // inside, what people say over their heads, and their voices from where they stand (oneworld-speech.js)
      if (st.foot) owCardTick(st, now);   // inside a building in GLASS, the card for the piece you face (oneworld-card.js)
      if (st.foot) owPromptTick(st);   // brackets round what F works on, and the key the first few times (oneworld-prompt.js)
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
        freeCam: (st.packCam && packViewNow(st, now)) || (st.extView && extViewNow(st, now)) || freeCam.view(),
        self: st.packCam ? packSelf(st) : st.extView ? extSelf(st, now) : fpSelf(st, now),
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
        // the floor of the room you're in (its matrix's height, tiles): a room below it loses its ceiling (interiorsFrame)
        interiorFloorZ: st.inside?.room?.M ? st.inside.room.M[14] : null,
        // and under its ceiling no rain falls on you (windshield.js `roofed`); a roof deck or a balcony is out in it
        roofed: st.inside ? owRoofed(st) : false,
        // which building that is, so a weak PC spends its interiors on it (interiors-near.js interiorTuneFor)
        interiorHome: st.inside ? st.inside.gx + ',' + st.inside.gy : null,
        // and the storey you're on is cut out of its building's model, which otherwise stays (insideCut)
        roomCut: st.inside ? insideCut(st) : null,
        // and a sunken floor's hole in the street's ground, or the ground lies over the pit (insidePitHole)
        groundHoles: st.inside ? insidePitHole(st) : null,
        // and its people, stood where the Stage would stand them (oneworld-people.js, phase C)
        roomPeople: st.inside ? owPeople(st) : null,
        // on foot the near plane comes in to a third of a metre, so people stay whole as you walk up to them
        // (and with your own body drawn under you, closer still, or your chest and hands are cut away: fpSelf)
        nearMax: st.foot ? (st.fp?.drawn ? FP_NEAR_M * METRE : FOOT_NEAR) : 0,
      });

      // ⚠ WHERE THE CAMERA IS, NOT WHERE THE WINDOW IS CENTRED. This read `st.gx,st.gy`, which is
      // the tile the view OPENED on — so the one readout in the view was a constant, and the whole
      // hour spent working out where the missing wall was went past a chip that could have said.
      if (atEl) atEl.textContent = fc ? `${Math.round(st.gx + fc.x)},${Math.round(st.gy + fc.y)}` : `${st.gx},${st.gy}`;
      if (wxEl) wxEl.textContent = `${String(weather || 'clear').toUpperCase()} · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
      // the pages laid on a room's glass (the control panel, a door's hologram), by the matrix this frame was drawn with
      if (st.owLate) { const late = st.owLate; st.owLate = null; for (const fn of late) fn(); }
    } catch (e) {
      if (!st._errLogged) { console.error('[freelook] frame render error (view kept alive — report this stack):', e); st._errLogged = true; }
    }
  }
  st.frame = frame; st.paint = paint;
  st.raf = requestAnimationFrame(frame);
  // the loading screen stays up until the world round you is in and the rooms near you are built (worldReady), so
  // nothing is still loading in while you stand there
  veilReady(id, () => worldReady(st));

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
      // the kitchen over a room walked in GLASS (kitchen-stage.js) has the keys while it's up, but for walking and turning
      // when it's drawn into the room at its hob (`ks-hosted`) and not showing you something close up, as on the Stage
      const ks = document.getElementById('ks-root');
      if (ks && !(ks.classList.contains('ks-hosted') && !st.inside?.cookCam && !e.ctrlKey && !e.metaKey && !e.altKey && (/^[wasd]$/i.test(e.key) || e.key === 'Shift' || /^Arrow/.test(e.key)))) return;
      if (st.pack?.key(e) || st.dock?.key(e)) { e.preventDefault(); return; }
      // the arrange mode has the keys while it's up (room-arrange.js); B opens it in a room that's yours
      if (st.owArrange) return;
      // a Cup close up has the keys while it's open, Escape steps back (room-closeup.js key)
      if (st.owCup?.ui?.key(e)) { e.preventDefault(); return; }
      if (st.owCup?.ui?.on) return;
      if (k === 'b' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && st.inside && (st.inside.mine || st.inside.admin)) { e.preventDefault(); owArrangeStart(st); return; }
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
    unbindPointer = self.foot && !freeCamTouchUI() ? bindFootPointer(glass, freeCam, (e) => owClick(self, e, glass), (e) => owTvHover(self, e, glass), (e) => owTvWheel(self, e, glass), (e) => owCatPress(self, e, glass)) : bindFreeCamPointer(glass, freeCam);
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
  setVesselCut(null);   // (module state in gl/solids.js: another view mustn't draw a ship with our storey out of her)
  const s = st; st = null;
  s.alive = false;
  if (s.owSound) { s.owSound.stop(); s.owSound = null; }
  if (s.owTv) { s.owTv.stop(); s.owTv = null; }   // and the set, which hands tv.js's panel back
  if (s.owHoist) { s.owHoist.ui.dispose(); s.owHoist = null; }   // and a depot's vehicle panel
  owLockStop(s);   // and a locked doorway's hologram
  if (s.owEnv) { s.owEnv.ui.stop(); s.owEnv.host.remove(); s.owEnv = null; }   // and a control panel's page   // the rain through a room's windows goes with the view
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
    // a room GLASS will take, its mesh built: no cover, no fade; you walk on in and are stood inside its door when the
    // server answers (freelookTakeRoom). Anything else still goes to the Stage behind the cover.
    noteDoor(d); if (!owSeamless(s, d)) enterCover(s, d);
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
  // the set's dial while it's on, as on the Stage: [ and ] step down and up it
  if (s.inside && s.owTv?.on && (k === '[' || k === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) { if (down && !e.repeat) s.owTv.step(k === ']' ? 1 : -1); return true; }
  // inside a building in GLASS, L is the room's light switch, as on the Stage (client/shared/room-lights.js)
  // and - and = its dimmer, a tenth at a time; turning it up from off switches it on
  if (s.inside && (k === '-' || k === '_' || k === '=' || k === '+') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (down) { const z = s.inside.zone, sw = switchOf(z), up = k === '=' || k === '+'; saveSwitch(z, sw.on || up, Math.max(0.1, Math.min(1, sw.level + (up ? 0.1 : -0.1)))); owRelight(s); }
    return true;
  }
  if (s.inside && k === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) { if (down && !e.repeat) { const z = s.inside.zone, sw = switchOf(z); saveSwitch(z, !sw.on, sw.level); owRelight(s); } return true; }
  // inside a building in GLASS, F and 2 to 9 are the card's lines while it's up (oneworld-card.js); on the street, the
  // card of somebody you've walked up to (streetCardTick)
  if (s.owCard?.up() && (k === 'f' || /^[2-9]$/.test(k)) && !e.ctrlKey && !e.metaKey && !e.altKey) { if (down && !e.repeat) { if (k === 'f') s.owPrompt?.used(s.owCard.target()?.act); s.owCard.key(k); } return true; }
  if (k === 'f' && !e.ctrlKey && !e.metaKey) { if (down && !e.repeat && !footCallLift(s)) { if (footDoorNear(s)) s.owPrompt?.used(DOOR_ACT); footDoor(s); } return true; }
  // G opens the can on the building you're facing (plugins/graffiti `spraycan <dir>`; the server says what's there and
  // whether you've a can), and the dialog's SPRAY IT then runs the spray session over the street (spray-aim.js)
  if (k === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) { if (down && !e.repeat) footCan(s); return true; }
  // V: the camera behind you and you drawn walking (extViewNow), or back to your eyes; on the street only
  if (k === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey) { if (down && !e.repeat) footExtView(s); return true; }
  if ((k === 'q' || k === 'e') && !e.ctrlKey && !e.metaKey) { if (down) f.spin.add(k); else f.spin.delete(k); return true; }
  // sat inside (owSit): a step gets you up first, as it does on the Stage
  if (s.inside?.sat && down && !e.repeat && FOOT_KEYS.has(k)) owStand(s);
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
function footPack(s, tab, opts = null) {
  // `opts` ({ wardrobe }) opens it on a wardrobe's outfits (oneworld-card.js Change clothes) rather than toggling it
  if (s.pack) { if (opts) s.pack.open(tab, opts); else s.pack.toggle(tab); return; }
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
    s.pack.open(tab, opts || undefined);
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
export function freelookPack(msg) { if (!st) return; st.packMsg = msg; st.pack?.data(msg); }
export function freelookPackDirty() { st?.pack?.dirty(); }
// THE VIEW FROM BEHIND YOU (V), on the street only. The camera stands EXT_BACK behind your eyes and EXT_UP over your
// head, turning as you turn and tilting with your look, and GLASS draws your body where your eyes are (drawSelfFigure,
// `v.self`), walking as far as you've walked. Everything else (where you are, what you face, the door you'd go in
// by) is still your eyes: only the picture moves. Dressed as the Pack dresses you, from the `roompack` answer it asks
// for once (freelookPack keeps it even with the Pack shut). Going inside drops it: a room is too small for it.
const EXT_BACK = 3.4, EXT_UP = 0.55, EXT_AIM = 1.45, EXT_NEAR = 0.6;   // metres behind you, over your head, the height it looks at, and the closest a wall brings it
function footExtView(s) {
  if (s.extView) { s.extView = null; return; }
  if (s.inside) return;
  s.extView = { gd: 0, lx: null, ly: null, mv: 0, t: 0 };
  needPackLook(s);
}
// what dressing you needs: the Pack's answer (asked for once) and the three modules that turn it into a figure
function needPackLook(s) {
  if (!s.packMsg && !s.packAsked) { s.packAsked = true; s.foot.onMove('roompack'); }
  if (!packMods) Promise.all([import('./gl/room-people.js'), import('../../../shared/player-figure.js'), import('../../../shared/paper-doll.js')]).then(([people, pf, pd]) => {
    packMods = packMods || { streetLook: people.streetLook, playerFigure: pf.playerFigure, figureWorn: pd.figureWorn };
  }).catch(() => {});
}
function extViewNow(s, now) {
  const E = s.extView, v = s.freeCam.view();
  if (!E || !v) return null;
  if (s.inside) { s.extView = null; return null; }
  const ground = Math.max(0, v.z - FPS_EYE * (s.foot.eyeK ?? 1));
  // how far you've walked drives the gait, as the crowd's does; a jump (a recentre) isn't walking
  const dt = E.t ? Math.min(0.1, (now - E.t) / 1000) : 0;
  E.t = now;
  if (E.lx != null) { const d = Math.hypot(v.x - E.lx, v.y - E.ly); if (d < 0.5) { E.gd += d; E.mv = dt > 0 ? d / dt : E.mv; } }
  E.lx = v.x; E.ly = v.y; E.ground = ground; E.yaw = v.yaw;
  const Y = v.yaw * Math.PI / 180, pitch = Math.max(-1.0, Math.min(0.35, (v.pitch || 0) - 0.22)), d = m2tf(EXT_BACK);
  const cz = ground + m2tf(EXT_AIM), cp = Math.cos(pitch);
  // ⚠ NEVER INSIDE A WALL. A ray from your head back to where the camera wants to be (reachFrom, the same march the
  // reach uses against the models, the curtain and the ground); a hit brings the camera in front of it at once, and
  // it eases back out when the wall's gone, so walking past a corner doesn't make it jump in and out.
  const ux = -Math.sin(Y) * cp, uy = Math.cos(Y) * cp, uz = -Math.sin(pitch) + m2tf(EXT_UP) / d, n = Math.hypot(ux, uy, uz);
  const hit = reachFrom(s, v.x, v.y, cz, ux / n, uy / n, uz / n, d * n);
  const want = Number.isFinite(hit) ? Math.max(m2tf(EXT_NEAR), hit - m2tf(0.25)) / n : d;
  E.d = E.d == null || want < E.d ? want : E.d + (want - E.d) * (1 - Math.exp(-dt * 3));
  const r = E.d;
  return { ...v, x: v.x + ux * r, y: v.y + uy * r, z: Math.max(ground + m2tf(0.3), cz + uz * r), pitch, roll: 0 };
}
// you as the Pack dresses you, kept per outfit (s.packLook)
function selfLookNow(s) {
  const M = packMods;
  if (!M) return null;
  const m = s.packMsg || {}, items = m.items || [], sex = m.sex === 'female' ? 'female' : 'male';
  const sig = items.filter((x) => x.worn && x.slot).map((x) => x.id).join(',') + '|' + JSON.stringify(m.look || null) + '|' + sex;
  if (s.packLook?.sig !== sig) {
    const base = M.playerFigure(m.look || {}) || {};
    const fig = { ...base, ...M.figureWorn(items, { sex, skin: base.skin || null }) };
    const o = M.streetLook(String(m.you || 'you'), sex === 'female', fig);
    s.packLook = { sig, o: { ...o, hd: { ...o.hd, id: m.you || o.hd.id } }, k: fig.height > 1 ? fig.height / 1.776 : 1 };
  }
  return s.packLook;
}
function extSelf(s, now) {
  const E = s.extView;
  if (!E || E.ground == null || !selfLookNow(s)) return null;
  const F = E.yaw * Math.PI / 180, walking = E.mv > 0.05;
  return { x: s.gx + E.lx, y: s.gy + E.ly, z: E.ground, hd: Math.atan2(-Math.cos(F), Math.sin(F)), o: s.packLook.o, k: s.packLook.k,
    clip: walking ? 'walk' : 'idle', gd: E.gd };
}
// YOUR OWN BODY IN FIRST PERSON. On foot, with neither the Pack nor the view from behind you up, GLASS draws you under
// your own eyes from the neck down (figure-hd.js uNoHead), so looking down shows your legs and feet and your hands
// swing into view as you walk. Your feet stand FP_BODY.back behind your eyes, as a head sits forward of the spine, so
// the eye isn't inside your chest; the near plane comes in to FP_NEAR_M while it's drawn. The street's close-up figure
// draws it (gl/street-hd.js), in a room as on the pavement. A zone may ask for another look (client/shared/
// self-look.js: the In Between's outline of light), carried on the record as `skin` for drawSelfFigure.
// FP_BODY.on is the setting: off on a phone, and `localStorage.fpBody = '0'` turns it off anywhere.
// ⚠ ARMS: the walk and idle clips hang them at your sides, so you see your hands looking down, not held up in front.
// back: metres your feet stand behind your eyes. At 0.1 the eye was over the collar and looked down into it; at 0.25
// it's in front of the chest, so looking down shows chest, belly, hands and boots. cut: the rest height (metres) the
// figure is cut at, low enough to take the collar of a jumpsuit with the neck.
export const FP_BODY = { on: fpBodyDefault(), back: 0.25, cut: 1.40 };
const FP_NEAR_M = 0.05;   // metres (METRE is declared further down, so it's applied where it's read)
function fpBodyDefault() {
  try { if (localStorage.getItem('fpBody') === '0') return false; } catch { /* on */ }
  try { if (document.documentElement.dataset.density === 'compact') return false; } catch { /* on */ }
  return true;
}
export function setFirstPersonBody(on) { FP_BODY.on = !!on; try { localStorage.setItem('fpBody', on ? '1' : '0'); } catch { /* this session only */ } }
function fpSelf(s, now) {
  const P = s.fp || (s.fp = { gd: 0, lx: null, ly: null, mv: 0, t: 0, drawn: false });
  P.drawn = false;
  if (!FP_BODY.on || !s.foot || !s.freeCam.standing) return null;
  const v = s.freeCam.view();
  if (!v) return null;
  needPackLook(s);
  const look = selfLookNow(s);
  if (!look) return null;
  const dt = P.t ? Math.min(0.1, (now - P.t) / 1000) : 0;
  P.t = now;
  if (P.lx != null) { const d = Math.hypot(v.x - P.lx, v.y - P.ly); if (d < 0.5) { P.gd += d; P.mv = dt > 0 ? P.mv + ((d / dt) - P.mv) * Math.min(1, dt * 10) : P.mv; } }
  P.lx = v.x; P.ly = v.y;
  const Y = v.yaw * Math.PI / 180, b = m2tf(FP_BODY.back), ground = Math.max(0, v.z - FPS_EYE * (s.foot.eyeK ?? 1));
  P.drawn = true;
  look.fpO ??= { ...look.o, hd: { ...look.o.hd, noHead: FP_BODY.cut } };   // one object per outfit: street-hd keys its builds on it
  return { x: s.gx + v.x - Math.sin(Y) * b, y: s.gy + v.y + Math.cos(Y) * b, z: ground,
    hd: Math.atan2(-Math.cos(Y), Math.sin(Y)), o: look.fpO, k: look.k,
    clip: P.mv > 0.02 ? 'walk' : 'idle', gd: P.gd, fp: true, skin: selfLookFor(s.inside?.zone) };   // 0.02 tiles a second is about 0.35 m/s
}
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
// one click away and nothing has to be pressed to free the mouse. A press that doesn't drag is a click (`onClick`):
// inside a building, it holds the card on the piece under it (owClick).
const CLICK_PX = 5;
function bindFootPointer(el, cam, onClick = null, onHover = null, onWheel = null, onPress = null) {
  let drag = null, grab = null;
  const down = (e) => {
    if (e.target.closest?.('button')) return;
    // a press that something takes (a cat being stroked, owCatPress) owns the drag till it lets go
    if (e.button === 0 && onPress && (grab = onPress(e))) { try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ } e.preventDefault(); return; }
    // a click on the world takes the keyboard back from the command line
    if (!e.target.closest?.('input, textarea, select, [contenteditable]')) {
      const f = document.activeElement; if (f?.matches?.('input, textarea, [contenteditable]')) f.blur();
    }
    if (e.button === 1) e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, x0: e.clientX, y0: e.clientY, button: e.button };
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const move = (e) => {
    if (grab) { grab.move(e); return; }
    if (!drag) { onHover?.(e); return; }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, v = cam.view();
    drag.x = e.clientX; drag.y = e.clientY;
    if (v && (dx || dy)) cam.aimAt(v.yaw + dx * FOOT_DRAG * 180 / Math.PI, v.pitch - dy * FOOT_DRAG);
  };
  const up = (e) => {
    if (grab) { const g = grab; grab = null; g.up(e); return; }
    const d = drag;
    drag = null;
    if (onClick && d && e?.type === 'pointerup' && d.button === 0 && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < CLICK_PX) onClick(e);
  };
  const wheel = (e) => { e.preventDefault(); if (onWheel?.(e)) return; cam.zoomBy(e.deltaY > 0 ? 1 / 1.06 : 1.06); };
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
  // up on a footbridge, over the strip. Not a hair over the ground: the walkway's own kerb lifts you 0.01 of a tile,
  // and the old 0.002 here meant nobody standing on a walkway was ever carried. The deck is 0.4 up.
  if ((s.foot?.lift || 0) > 0.1) return;
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
// ⚠ ON FOR THE ROOMS ONLY THE STAGE DOESN'T NEED (`entry`, the desktop default): an entry room off the street, and
// once you're inside a building in GLASS, any room of it on your floor a doorway takes you to, as long as it has
// nothing only the Stage draws or works (glass/interiors-near.js oneWorldBlocker). Everywhere else the Stage opens as
// before. A phone always opens the Stage (one-world-interiors.md, "The conversion"). `__oneWorld(true)` takes every
// drawn room, phone or not; `__oneWorld(false)` none.
export const ONE_WORLD = { on: false, entry: true };
if (typeof window !== 'undefined') window.__oneWorld = (on = true) => { ONE_WORLD.on = !!on; ONE_WORLD.entry = !!on; return on; };
// Whether the step through this street door goes on in GLASS (one-world): the building's room behind it is one GLASS
// takes from the street, and its whole mesh is built, so no box or still stands in the doorway as you go through.
function owSeamless(s, d) {
  if (GL_TIER === 'phone' || !(ONE_WORLD.on || ONE_WORLD.entry)) return false;
  const r = (s.interiors || []).find((q) => q.gx === d.gx && q.gy === d.gy && (q.L.spec.openings || []).some((o) => o.dir && o.kind === 'front'));
  return !!r && oneWorldRoom(s, r) && !!r.meshReady?.();
}
function oneWorldRoom(s, r, fromLift = null) {
  if (ONE_WORLD.on) return true;
  if (!ONE_WORLD.entry) return false;
  return oneWorldTakes(r, s.inside, (zone) => (s.interiors || []).some((q) => q.zone === zone), GL_TIER === 'phone', { fromLift });
}
// The last `room_view` this page was sent, whoever took it: a lift car's (`lift` on it) is how a landing you step out
// onto from the Stage's ride knows where you came from (phase E).
let lastView = null;
const OW_WINDOW_MARGIN = 2;   // tiles: a building taken in GLASS is at least this far inside the view's window
// ⚠ THE BUILDING STAYS ON THE MAP, LESS THE STOREY YOU'RE ON (gl/context.js uCutA, the balcony's cut). Taking the
// whole model off left you in a lobby with no building over it, and the eye placed off the room's own sums, not the
// model's. Now the facade, the storeys over you and the doorway are the model's, and the rooms on this floor (drawn
// whole, gl/interiors.js) stand in the band the cut takes out of it: the building's tile, floor slab to ceiling.
// ⚠ A BUILDING ON SEVERAL TILES IS CUT ACROSS ALL OF THEM (phase E): the Solenne's 2 by 2 kept three tiles whole, so
// its lobby's far half stood inside its own model. The cut is the square round the building's footprint as the map
// records it (cutFootprint), which for a one-tile building is that tile, as it always was.
// ⚠ NOT FROM THE ROOMS' BOXES: rooms overhang their tiles all over the city (the hostel, Jolene's, Screw It), and a cut
// sized off them took the next building's storey too.
const CUT_SLAB_M = 0.15, CUT_TILE_REACH = 0.52;
// while the arrange mode looks down on the room from above, every storey over it goes too, not only its own
const CUT_ALL_ABOVE_M = 400;
function insideCut(s) {
  const I = s.inside, r = I?.room;
  if (!r || r.vessel) return null;   // a vessel's storey is cut out of her hull instead (owVesselTick)
  const M = r.M, k = M[6] || METRE, floorM = M[14] / k + (r.L.floor || 0), h = Number(r.L.spec?.h) || 3;
  const sunk = Number(r.L.spec?.pit?.depth) || 0;   // a pit's floor is below the room's, and the model's slab with it
  const f = cutFootprint(s.map, s.gx, s.gy, r.gx, r.gy);
  const tx = f.cx - s.gx, ty = f.cy - s.gy;
  return { x: tx, y: ty, rad: 0, half: 4, back: 4, z0: k * (floorM - sunk - CUT_SLAB_M), z1: k * (floorM + (s.owArrange ? CUT_ALL_ABOVE_M : h) + CUT_SLAB_M), tx, ty, reach: f.reach };
}
// A SUNKEN FLOOR, INSIDE: GLASS's ground is drawn at street level under every building, so a pit in the room you're
// in (spec.pit, the Cherry Pit's round one) was covered by it. The pit's square comes out of the ground as a hole
// (gl/floor.js uHole), in world tiles; the room's own floor is laid round the circle inside that square
// (gl/room-mesh.js), so the hole shows only the pit.
// A ROOM AT STREET LEVEL, the same way: its floor (or, a storey down, its ceiling) is at the ground's height, so the
// two fought for the picture, and from a few metres off the ground's shadows came up through the floor in patches and
// over the stairwell down (Golden Goose Gardens' Stands, 2026-11-23). Every room of the building you're in whose box
// touches street level comes out of the ground, yours first, then the nearest; then the wells in your room's floor and
// ceiling (stairsOf, wellBoxes). The renderer takes six holes (gl/floor.js MAX_HOLE), the pit first.
const GROUND_EPS = 0.02;   // tiles, about 36 cm: a room's floor or ceiling this near street level fights the ground
function insidePitHole(s) {
  const r = s.inside?.room;
  if (!r?.M || r.vessel || !r.L?.world) return null;
  const rect = ([u0, u1, v0, v1]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) {
      const t = roomPt(r.M, r.L.world(u, v, 0)), x = r.gx + t[0], y = r.gy + t[1];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1];
  };
  const q = r.L.spec?.pit, out = [];
  if (q && [q.u0, q.u1, q.v0, q.v1].every(Number.isFinite)) out.push(rect([q.u0, q.u1, q.v0, q.v1]));
  const atStreet = (x) => x?.box && x.gx === r.gx && x.gy === r.gy && x.box[4] <= GROUND_EPS && x.box[5] >= -GROUND_EPS;
  const mid = (x) => [(x.box[0] + x.box[2]) / 2, (x.box[1] + x.box[3]) / 2], [mx, my] = r.box ? mid(r) : [r.gx, r.gy];
  const street = (s.interiors || []).filter((x) => x !== r && atStreet(x)).sort((a, b) => Math.hypot(mid(a)[0] - mx, mid(a)[1] - my) - Math.hypot(mid(b)[0] - mx, mid(b)[1] - my));
  for (const x of atStreet(r) ? [r, ...street] : street) out.push(x.box.slice(0, 4));
  for (const o of stairsOf(r.L.spec)) if (o.wall === 'floor' || o.wall === 'ceiling') for (const b of wellBoxes(o)) out.push(rect(b));
  return out.length ? out : null;
}
// A building's footprint from the window's map: its facade tile [fx, fy] and every cell marked part of it (`po`, the
// facade's [x, y]; docs/proposals/multi-tile-buildings.md), as their middle and the half-width of the square round
// them, in absolute tiles. Exported for the gate.
export function cutFootprint(map, gx, gy, fx, fy) {
  let x0 = fx, x1 = fx, y0 = fy, y1 = fy;
  const R = map ? (map.length - 1) / 2 : 0;
  for (let y = 0; y < (map?.length || 0); y++) for (let x = 0; x < (map[y]?.length || 0); x++) {
    const po = map[y][x]?.po;
    if (!Array.isArray(po) || po[0] !== fx || po[1] !== fy) continue;
    const ax = gx + x - R, ay = gy + y - R;
    x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); y0 = Math.min(y0, ay); y1 = Math.max(y1, ay);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, reach: Math.max(x1 - x0, y1 - y0) / 2 + CUT_TILE_REACH };
}
// ── ON A VESSEL (docs/proposals/echelon-decks.md, phase 2) ─────────────────────────────────────────────────────────
// Her rooms come with where each stands in her own frame (room-interiors.js placeOnVessel), and every frame they're put
// on her hull as GLASS draws it: her cell's heading and `sub` (she swings at anchor and sails), and the ride the hull
// is drawn with (seaRideAt), so they heave and pitch with her. Standing in one, you're carried with the floor: the spot
// under you in the room's frame is where it was, wherever the room went. And her storey is cut out of her hull and
// deckhouse (gl/solids.js setVesselCut), as a building's storey is cut out of its mass (insideCut).
// ⚠ BEFORE ANYTHING READS A ROOM'S MATRIX THIS FRAME: the walk, the floor under you and the draw all read r.M.
const VESSEL_CUT_SLAB_M = 0.15;
function vesselPose(s, gx, gy, now) {
  const c = cellOf(s, gx, gy);
  if (!c || c.mark !== 'yacht') return null;
  const sub = c.sub || { x: 0, y: 0 }, heading = c.heading || 0;
  return { x: sub.x, y: sub.y, heading, ride: seaRideAt(gx - s.gx + sub.x, gy - s.gy + sub.y, heading, now) };
}
function owVesselTick(s, now) {
  if (!s?.foot || !s.map || !s.interiors?.length || !windshieldLoaded()) { setVesselCut(null); return; }
  const I = s.inside, fv = s.freeCam.view(), poses = new Map();
  let cut = null;
  for (const r of s.interiors) {
    if (!r.vessel) continue;
    const k = r.gx + ',' + r.gy;
    if (!poses.has(k)) poses.set(k, vesselPose(s, r.gx, r.gy, now));
    const P = poses.get(k);
    if (!P) continue;
    const mine = I?.room === r && fv, uv = mine ? roomUV(s, r, fv.x, fv.y) : null;
    const was = uv ? roomPt(r.M, r.L.world(uv[0], uv[1], 0)) : null;
    placeOnVessel(r, P);
    if (was) { const now2 = roomPt(r.M, r.L.world(uv[0], uv[1], 0)); s.freeCam.carry(now2[0] - was[0], now2[1] - was[1]); }
    if (mine) {
      const D = Math.PI / 180, R = P.ride || { heave: 0, roll: 0, pitch: 0 }, V = r.vessel, k2 = m2tf(1);
      const floor = ((Number(V.deck) || 0) + V.floor) * k2, h = Number(r.L.spec?.h) || 3;
      cut = { x: r.gx - s.gx + P.x, y: r.gy - s.gy + P.y, rad: P.heading * D,
        half: 0.13 * YACHT_SB * YACHT_SCALE, fore: -YACHT_BOW * YACHT_SCALE + 0.05, aft: -(YACHT_BOW + YACHT_LEN) * YACHT_SCALE - 0.05,
        z0: floor - VESSEL_CUT_SLAB_M * k2, z1: floor + (h + VESSEL_CUT_SLAB_M) * k2, heave: R.heave, sinRoll: Math.sin(R.roll * D), sinPitch: Math.sin(R.pitch * D) };
    }
  }
  setVesselCut(cut);
}
// Where a point (tiles about the window's centre) is in a room's own frame: [u, v], by its matrix's inverse.
function roomUV(s, r, x, y) {
  const M = r.M, tx = s.gx + x - r.gx - M[12], ty = s.gy + y - r.gy - M[13], det = M[0] * M[9] - M[8] * M[1];
  if (!det) return null;
  const px = (tx * M[9] - M[8] * ty) / det, pz = (M[0] * ty - M[1] * tx) / det;
  const l = r.L.local([px, r.L.floor, pz]);
  return [l[0], l[1]];
}
// Whether there's a ceiling over you inside: yes in any room but a roof deck (`open`), and not out on its balcony, which
// is in front of its front wall (v < 0). The renderer stops the rain on it as it does under a depot's roof.
function owRoofed(s) {
  const r = s.inside?.room;
  if (!r?.M || !r.L || r.L.spec?.open) return false;
  const v = s.freeCam.view(), at = v ? roomUV(s, r, v.x, v.y) : null;
  return !(at && at[1] < 0);
}
// THE CARD, INSIDE (phase B, oneworld-card.js): the piece of the room you're in that you face and can reach, by the
// Stage's own aim. Where you stand and a step ahead of you are taken into the room's frame (roomUV), so the room's
// turn on the map doesn't matter. Asked a few times a second, not every frame; off the moment you're back outside.
const OW_CARD_MS = 120, OW_AHEAD = 0.02;   // tiles: a step ahead, only its direction is used
const OW_HOLD_M = 0.4;   // a click holds the card on its piece until you've walked this far from where you clicked
const seatsOf = (r, piece) => (piece ? (r.L.seats || []).filter((q) => String(q.piece) === String(piece.id)) : []);
// the piece you'd face looking along `bearing` (degrees, the camera's sense), from where you stand
function facedAlong(s, r, v, bearing) {
  const y = bearing * Math.PI / 180;   // 0 north, clockwise (freecam.js), +y south
  const at = roomUV(s, r, v.x, v.y), ahead = roomUV(s, r, v.x + Math.sin(y) * OW_AHEAD, v.y - Math.cos(y) * OW_AHEAD);
  return facedPiece(r.L, s.inside.pieces, at, ahead);
}
const pieceById = (s, id) => (s.inside?.pieces || []).find((p) => String(p.id) === String(id)) || null;
function owCardTick(s, now) {
  if (!s.inside) { streetCardTick(s, now); return; }
  const c = s.owCard;
  if (!c) return;
  if (now - (s.owCardAt || 0) < OW_CARD_MS) return;
  s.owCardAt = now;
  const v = s.freeCam.view(), I = s.inside, r = I.room;
  if (!v || !r || s.packCam) { c.show(null); return; }
  // sat: the card is the seat's piece, Get up first, as on the Stage
  if (I.sat) { const p = pieceById(s, I.sat.piece); c.show(p, seatsOf(r, p), { sat: true }); return; }
  // held by a click until you walk off from where you clicked
  if (I.held && Math.hypot(s.gx + v.x - I.held.at[0], s.gy + v.y - I.held.at[1]) > m2tf(OW_HOLD_M)) I.held = null;
  // in a lift car: its panel, a button for every floor it stops at, each the elevator's typed `floor <n>`
  if (r.L.spec?.car && I.lift?.floors?.length) {
    c.show({ id: 'lift:' + r.zone, name: I.lift.brand || 'Lift' }, [], { acts: I.lift.floors.map((f) => ({ verb: 'floor', label: f.n === I.lift.at ? `${f.label || 'Floor ' + f.n} (here)` : f.label || 'Floor ' + f.n, cmd: `floor ${f.n}` })) });
    return;
  }
  // somebody you face wins over the furniture round them, as on the Stage (oneworld-people.js facedPerson)
  if (!I.held) {
    const yw = (v.yaw || 0) * Math.PI / 180, a0 = roomUV(s, r, v.x, v.y), a1 = roomUV(s, r, v.x + Math.sin(yw) * OW_AHEAD, v.y - Math.cos(yw) * OW_AHEAD);
    const who = facedPerson(r.L, I.people, I.you, a0, a1);
    if (who) { c.show({ id: 'person:' + who.id, name: who.name, person: who }, [], { acts: personActs(who) }); return; }
  }
  const piece = I.held ? pieceById(s, I.held.piece) : facedAlong(s, r, v, v.yaw || 0);
  if (piece) { c.show(piece, seatsOf(r, piece), { tvOn: piece.arche === 'screen' ? !!s.owTv?.on : null, keypad: I.keypad }); return; }
  // nothing to hand: the door you're stood at and facing, or the one you just walked into (owDoorLets)
  const y = (v.yaw || 0) * Math.PI / 180, at = roomUV(s, r, v.x, v.y), ahead = roomUV(s, r, v.x + Math.sin(y) * OW_AHEAD, v.y - Math.cos(y) * OW_AHEAD);
  const bump = I.bumped && now - I.bumped.t < OW_BUMP_MS ? I.locks.find((q) => q.to === I.bumped.to) : null;
  const k = bump || facedLock(r.L, I.locks, at, ahead);
  c.show(k ? { id: 'lock:' + k.to, name: doorName(k), lock: k } : null, [], k ? { acts: lockActs(k) } : {});
}
const OW_BUMP_MS = 2500;
// THE CARD, OUTSIDE: somebody on the street you're facing and close to, by name, with the lines a person has indoors
// (room-acts.js personActs). The figure is where GLASS drew them (streetActorSpots); the name is the server's `here`,
// which covers only the tile you're on, so a figure further off never gets one. A click holds it on them (streetClick).
const STREET_REACH_M = 3.5, STREET_FACING = 0.8;
const streetActs = (who) => (who.npc ? personActs({ name: who.n }) : [{ verb: 'look', label: 'Look', cmd: `look ${String(who.n).toLowerCase()}` }]);
// who's at a drawn spot, within reach of the eye, or null
function streetWho(s, v, q, reachM = STREET_REACH_M) {
  const who = q && s.here?.get(q.t);
  if (!who || Math.hypot(q.x - (s.gx + v.x), q.y - (s.gy + v.y)) > m2tf(reachM)) return null;
  return { ...who, x: q.x, y: q.y };
}
// the named person you'd face looking along `bearing` (degrees, the camera's sense)
function streetFaced(s, v, bearing) {
  if (!s.here?.size) return null;
  const y = bearing * Math.PI / 180, fx = Math.sin(y), fy = -Math.cos(y), ex = s.gx + v.x, ey = s.gy + v.y;
  let best = null, score = Infinity;
  for (const q of streetActorSpots()) {
    const who = streetWho(s, v, q);
    if (!who) continue;
    const dx = q.x - ex, dy = q.y - ey, d = Math.hypot(dx, dy), facing = d ? (dx * fx + dy * fy) / d : 1;
    if (facing < STREET_FACING) continue;
    const sc = d * (2 - facing);
    if (sc < score) { score = sc; best = who; }
  }
  return best;
}
function streetCardTick(s, now) {
  if (!s.owCard && !s.here?.size) return;
  if (now - (s.owCardAt || 0) < OW_CARD_MS) return;
  s.owCardAt = now;
  const v = s.freeCam.view();
  // held by a click until you walk off from where you clicked, or they walk out of reach
  if (s.streetHeld && (!v || Math.hypot(s.gx + v.x - s.streetHeld.at[0], s.gy + v.y - s.streetHeld.at[1]) > m2tf(OW_HOLD_M))) s.streetHeld = null;
  let who = null;
  if (v && !s.packCam) {
    if (s.streetHeld) who = streetWho(s, v, streetActorSpots().find((q) => q.t === s.streetHeld.t), s.streetHeld.reachM) || (s.streetHeld = null);
    if (!who) who = streetFaced(s, v, v.yaw || 0);
  }
  s.streetOn = who ? who.t : null;
  if (!who) { s.owCard?.show(null); return; }
  if (!s.owCard) s.owCard = createOneWorldCard(s.root, (a, piece) => owAct(s, a, piece));
  s.owCard.show({ id: 'street:' + who.t, name: who.n, street: who }, [], { acts: streetActs(who) });
}
// THE PROMPT (oneworld-prompt.js): light brackets round what F works on, the card's piece or person or the street door
// footDoor would take, with the key named the first few times. Where it is comes from the same places the card's
// choice does; it chooses nothing.
const DOOR_ACT = { verb: 'door', label: 'Go in' };
const PROMPT_H_M = { piece: 0.75, person: 1.3, door: 1.1 }, PROMPT_W_M = { piece: 0.8, person: 0.6, door: 1.0 };
let promptMod = null;
function roomToTile(r, u, v) {
  const w = r.L.world?.(u, v, 0), M = r.M;
  return w && M ? [M[0] * w[0] + M[8] * w[2] + M[12] + r.gx, M[1] * w[0] + M[9] * w[2] + M[13] + r.gy] : null;
}
function promptTarget(s) {
  const c = s.owCard?.target?.(), I = s.inside, r = I?.room;
  if (c?.act) {
    const p = c.piece;
    if (p.street) return { id: p.id, act: c.act, x: p.street.x, y: p.street.y, kind: 'person' };
    if (!r?.L || I?.sat) return null;
    let uv = null, kind = 'piece';
    if (p.person) { uv = placePeople(r.L, I.people, I.you).find((q) => q.p.id === p.person.id)?.at; kind = 'person'; }
    else if (p.lock) { const o = (r.L.spec?.openings || []).find((q) => q.to === p.lock.to && q.dir); uv = o && openingInside(r.L, o)?.at; kind = 'door'; }
    else { const q = (r.L.placed || []).find((z) => String(z.id) === String(p.id)); uv = q && [q.u, q.v]; }
    const at = uv && roomToTile(r, uv[0], uv[1]);
    return at ? { id: String(p.id), act: c.act, x: at[0], y: at[1], kind } : null;
  }
  const hit = !I && footDoorNear(s);
  return hit ? { id: 'door:' + hit.d.gx + ',' + hit.d.gy + ',' + hit.d.edge, act: DOOR_ACT, x: hit.px, y: hit.py, kind: 'door' } : null;
}
function owPromptTick(s) {
  if (!s.owPrompt) {
    if (!promptMod) promptMod = import('./oneworld-prompt.js').then((m) => { promptMod = m; }).catch(() => { promptMod = null; });
    if (promptMod instanceof Promise) return;
    s.owPrompt = promptMod.createOneWorldPrompt(s.root);
  }
  const v = s.freeCam.view(), W = s.root.clientWidth, t = v && !s.packCam ? promptTarget(s) : null;
  if (t) { t.dz = m2tf(PROMPT_H_M[t.kind]) - FPS_EYE; t.w = m2tf(PROMPT_W_M[t.kind]); }
  const eye = v ? { x: s.gx + v.x, y: s.gy + v.y, yaw: v.yaw || 0, pitch: v.pitch || 0 } : null;
  s.owPrompt.tick(t, eye, W ? viewLatFocal(W, { fovMul: v?.fov || 1 }) : 0, state.player?.name || null);
}
// NAMETAGS (street-tags.js): on foot and outside, a name over everybody nearby the server has named for you. A click on
// one holds the card on them, as a click on the figure does. Loaded the first time you're on foot outside.
let streetTagsMod = null;
function streetTagsTick(s) {
  const out = s.foot && !s.inside && !s.packCam;
  if (!out) { s.streetTags?.clear(); return; }
  if (!s.here?.size && !s.streetTags) return;
  if (!s.streetTags) {
    if (!streetTagsMod) streetTagsMod = import('./street-tags.js').then((m) => { streetTagsMod = m; }).catch(() => { streetTagsMod = null; });
    if (streetTagsMod instanceof Promise) return;
    s.streetTags = streetTagsMod.createStreetTags(s.root, (t) => {
      const v = s.freeCam.view();
      if (v) { s.streetHeld = { t, at: [s.gx + v.x, s.gy + v.y], reachM: 15 }; s.owCardAt = 0; }
    });
  }
  const v = s.freeCam.view(), W = s.root.clientWidth;
  const eye = v ? { x: s.gx + v.x, y: s.gy + v.y, z: v.z, yaw: v.yaw || 0, pitch: v.pitch || 0 } : null;
  s.streetTags.tick(s.here, v ? streetActorSpots() : [], eye, W ? viewLatFocal(W, { fovMul: v?.fov || 1 }) : 0, s.streetOn || null);
}
// A click on the street: the named person nearest the bearing under the pointer holds the card; a click on nothing lets
// it go.
function streetClick(s, e, el) {
  const v = s.freeCam.view(), box = el.getBoundingClientRect();
  if (!v || !box.width) return;
  const nx = (e.clientX - box.left - box.width / 2) / (box.width / 2), tanH = (box.width / 2) / viewLatFocal(box.width, { fovMul: v.fov || 1 });
  const who = streetFaced(s, v, (v.yaw || 0) + Math.atan(nx * tanH) * 180 / Math.PI);
  s.streetHeld = who ? { t: who.t, at: [s.gx + v.x, s.gy + v.y] } : null;
  s.owCardAt = 0;
}
// A line on the street card: Talk turns you to face them first, as it does indoors (owFace).
function streetAct(s, a, who) {
  s.streetHeld = null;
  const v = s.freeCam.view();
  if (a.verb === 'talk' && who && v) {
    const dx = who.x - (s.gx + v.x), dy = who.y - (s.gy + v.y);
    if (dx || dy) s.freeCam.aimAt(Math.atan2(dx, -dy) * 180 / Math.PI, v.pitch);
  }
  s.foot.onMove(a.cmd);
}
// THE ROOM'S PEOPLE (phase C, oneworld-people.js): worked out again only when who's there or the room you're in changes.
function owPeople(s) {
  const I = s.inside;
  if (!I) return null;
  // (every frame while somebody's walking in or out, oneworld-people.js noteMoves)
  const now = performance.now(), going = (I.walks?.size && walkingNow(I.walks, now)) || (I.routes?.size && walkingNow(I.routes, now));
  if (going || I.walkedLast || I.peopleFor !== I.people || I.peopleRoom !== I.room) {
    I.peopleFor = I.people; I.peopleRoom = I.room; I.walkedLast = going;
    I.peopleRec = roomPeopleRecords(I.room, I.people, I.you, I.walks, now, I.routes);
  }
  // (whoever the vat cycle has coming down a tube is drawn by the vat hall instead, owVatTick)
  const recs = I.vatHide?.size ? I.peopleRec.filter((q) => !I.vatHide.has(q.t)) : I.peopleRec;
  // somebody saying a line stands on the talk clip while it lasts (oneworld-speech.js)
  return owSpeech ? owSpeech.clipOf(recs, I.people, now) : recs;
}
// WHAT PEOPLE SAY (phase C, oneworld-speech.js): the line over the speaker's head, the talk clip, and their voice from
// where they stand, answering npc-bubbles.js's events as the Stage does. Made the first time you're inside.
let owSpeech = null, owSpeechW = null;
function owSpeechTick(s, now) {
  if (!s.inside) { owSpeech?.clear(); return; }
  if (!owSpeech) {
    if (owSpeechW === null) { owSpeechW = import('./gl/world.js').then((w) => { owSpeechW = w; }).catch(() => { owSpeechW = null; }); }
    if (owSpeechW instanceof Promise || !owSpeechW) return;
    owSpeech = 'loading';
    import('./oneworld-speech.js').then((m) => {
      owSpeech = m.createOneWorldSpeech({
        get: () => (st?.inside ? st : null),
        project: (x, y, z) => { const at = st && owSpeechW.glInteriorProject(st.id, x - st.gx, y - st.gy, z); return at && at.f > 0 ? { x: at.x * st.root.clientWidth, y: at.y * st.root.clientHeight } : null; },
        eared: () => !!st?.owSound,
      });
    }).catch(() => { owSpeech = null; });
    return;
  }
  if (owSpeech === 'loading') return;
  owSpeech.tick(owPeople(s), now);
}
// `room_people`: who's in the room you're walking in GLASS changed. True when it was that room.
export function freelookPeople(msg) {
  const I = st?.inside;
  if (!I || msg.zone !== I.zone) return false;
  const before = I.people || [];
  I.people = msg.people || [];
  I.beasts = msg.beasts || [];
  if (!!msg.tv !== !!I.npcTv) { I.npcTv = !!msg.tv; I.npcTvAsked = false; }
  I.routes = routesOf(I.people, performance.now());
  // somebody walking in at a door, or out of one (`came`, `gone`)
  if (msg.came?.length || msg.gone?.length) noteMoves(I.walks || (I.walks = new Map()), I.room?.L, msg, before, I.people, I.you, performance.now());
  // on a studio floor, somebody coming or going changes who's on the set's marks
  if (st.owStudio && before.map((p) => p.id).sort().join('|') !== I.people.map((p) => p.id).sort().join('|')) owRaw({ type: 'room_set', zone: msg.zone });
  return true;
}
// THE STUDIO FLOOR (phase F): a room a studio set claims is drawn as the set, the TV's live stage (room-studio.js, the
// Stage's own) laid over the street view's picture as the Stage lays it over its room. Asked for when you walk in and
// again when the room's people change; it goes when you leave the room or the view's put away.
const owRaw = (m) => import('../net.js').then((n) => n.sendRaw(m)).catch(() => {});
function owStudioStop(s) { if (s?.owStudio) { s.owStudio.ui?.dispose(); s.owStudio = null; } }
// 'room_set': the set the room you're walking in GLASS is, or none. True when it was that room.
export function freelookSet(msg) {
  const s = st, I = s?.inside;
  if (!I || msg.zone !== I.zone) return false;
  if (!msg.set) { owStudioStop(s); return true; }
  if (s.owStudio?.ui) { s.owStudio.ui.show(msg); return true; }
  const O = (s.owStudio = { zone: I.zone, ui: null });
  import('./room-studio.js').then(({ createStudioFloor }) => {
    if (s.owStudio !== O || s.inside?.zone !== O.zone) return;
    O.ui = createStudioFloor(s.root, { phone: false });
    O.ui.show(msg);
  }).catch((err) => { console.error('[one-world] the studio set failed to load:', err); if (s.owStudio === O) s.owStudio = null; });
  return true;
}   // a door you walked into keeps its card up this long
// `room_locks`: a lock of the room you're in changed (somebody worked it, a shop shut, the rent lapsed). An Unlock that
// was to open the door too (`then`) opens it now the lock's given.
export function freelookLocks(msg) {
  const I = st?.inside;
  if (!I || msg.zone !== I.zone) return false;
  I.locks = msg.locks || [];
  st.owCardAt = 0;
  const c = I.chain;
  if (c && performance.now() < c.until && I.locks.some((k) => k.to === c.to && !k.locked)) { I.chain = null; st.foot.onMove(c.cmd); }
  return true;
}
// A line on the card. Sit down and Lie down put you on the seat, as the Stage's runAct does; Get up takes you off;
// everything else is its typed verb.
function owAct(s, a, piece) {
  if (piece?.street) { streetAct(s, a, piece.street); return; }
  const I = s.inside;
  if (!I) return;
  I.held = null;
  if (a.verb === 'stand') { owStand(s); return; }
  // a set's Watch is its power switch, as on the Stage (room-stage.js useStation): on, it goes off here
  if (a.verb === 'watch' && piece && s.owTv?.on) { s.owTv.off(); return; }
  // Talk turns you to face them, eye to eye, as the Stage's talk camera comes in on a face (room-talk.js); the rest of
  // the camera's move onto the face is to come
  if (a.verb === 'talk' && piece?.person) owFace(s, piece.person.id);
  if (piece?.lock) { I.chain = a.then ? { to: piece.lock.to, cmd: a.then, until: performance.now() + 3000 } : null; s.foot.onMove(a.cmd); return; }
  if ((a.verb === 'sit' || a.verb === 'lie') && piece && owSit(s, piece, a.verb)) return;
  // a wardrobe's Change clothes: the street's own Pack (room-pack.js) on what you can wear, with its saved outfits
  if (a.verb === 'dress') { footPack(s, 'wear', { wardrobe: piece?.arche === 'wardrobe' ? piece.id : null }); return; }
  // a boombox's Music: the AMP player is the client's own, and the server never hears `music` (room-stage.js runAct)
  if (a.verb === 'music') { import('./lazy-views.js').then((m) => m.openMusicPlayerPanel()); return; }
  // a vending machine's flavour: its button goes in as it's bought, as on the Stage
  if (a.verb === 'vendpress' && piece) s.owVend?.ui.press(piece.id, a.item);
  // Cook at a cooker: the kitchen stands you at that one, not the room's first (owCookOpen)
  if (a.verb === 'workspace' && piece && !piece.lab) I.cookAt = { id: piece.id, t: performance.now() };
  // Examine a trophy case: the camera goes round its Cup, and the case is looked at as ever (owCupOpen)
  if (a.verb === 'examine' && piece && I.room?.L.placed?.some((q) => q.id === piece.id && q.form === 'trophy')) owCupOpen(s, piece);
  s.foot.onMove(a.cmd);
}
// A THING CLOSE UP (phase F): examining a trophy case takes the camera round its Cup to turn it and read who's engraved
// on it, by the Stage's own room-closeup.js over the street view: its camera put on the street view's (owTakeCam), and
// put back where you stood when it shuts. 'target' is asked every frame, so a room rebuilt without the case shuts it.
let cupMods = null;
function owCupOpen(s, piece) {
  const I = s.inside, r = I?.room;
  if (!r || s.owCup) return;
  s.owCup = { room: r, id: piece.id, ui: null, home: owSeat(s, r) };
  if (!cupMods) cupMods = Promise.all([import('./room-closeup.js'), import('./gl/room-stadium.js'), import('../../../shared/room-layout.js')]);
  Promise.resolve(cupMods).then(([rc, rs, rl]) => {
    cupMods = [rc, rs, rl];
    const C = s.owCup;
    if (!C || C.room !== s.inside?.room) { s.owCup = null; return; }
    const target = () => {
      const L = C.room.L, p = L.placed?.find((q) => q.id === C.id);
      if (!p) return null;
      const c = rs.trophyCup(p), [fu, fv] = rl.facing(p.turn);
      const o = L.world(p.u, p.v, c.foot), f = L.world(p.u + fu, p.v + fv, c.foot);
      return { c: [o[0], o[2]], y0: o[1], y1: o[1] + (c.top - c.foot), front: Math.atan2(o[0] - f[0], o[2] - f[2]), near: c.r + 0.09, far: 1.6, ceil: o[1] + (c.lid - c.foot) - 0.03 };
    };
    C.ui = rc.createCloseup({ host: s.root, target, onClose: () => { C.shut = true; } });
    if (!C.ui.open(piece.label || piece.name)) { C.ui.dispose(); s.owCup = null; }
  }).catch((e) => { console.warn('[one-world] the close-up would not load:', e?.message); s.owCup = null; cupMods = null; });
}
function owCupStop(s) {
  const C = s.owCup;
  if (!C) return;
  if (C.ui?.on) C.ui.close();
  C.ui?.dispose();
  if (s.inside) s.inside.cupCam = null;
  if (C.home && C.room === s.inside?.room) owTakeCam(s, C.room, C.home, () => {});
  s.owCup = null;
}
function owCupTick(s, now) {
  const C = s.owCup;
  if (!C?.ui) return;
  if (C.shut || !C.ui.on || C.room !== s.inside?.room) { owCupStop(s); return; }
  const cam = C.ui.frame(now);
  if (cam) owTakeCam(s, C.room, cam, (c) => { s.inside.cupCam = c; });
}
// Turn to face somebody in the room, at their eye height (oneworld-people.js records: absolute tiles, z their floor).
const OW_FACE_EYE_M = 1.6;
function owFace(s, id) {
  const v = s.freeCam.view(), q = (owPeople(s) || []).find((r) => r.t === personToken(id));
  if (!v || !q) return;
  const dx = q.x - (s.gx + v.x), dy = q.y - (s.gy + v.y), d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const dz = q.z + m2tf(q.clip === 'sit' ? OW_FACE_EYE_M * 0.72 : OW_FACE_EYE_M) - v.z;
  s.freeCam.aimAt(Math.atan2(dx, -dy) * 180 / Math.PI, Math.atan2(dz, d));
}
// ON THE SEAT: the camera goes to the seat's eye, facing the way it faces (the layout's `y`, `dir` and `pitch`, put
// through the room's matrix), and stays there (the eye in watchFoot, the feet in footBlock) until you get up. Where
// you stood is kept, and Get up or a step puts you back there.
const roomPt = (M, p) => [M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]];
function owSit(s, piece, verb) {
  const I = s.inside, r = I.room, L = r.L, v = s.freeCam.view();
  const seat = seatFor(L.seats, piece.id, verb);
  if (!seat || !v) return false;
  const dir = seat.dir || [0, 1], P = roomPt(r.M, L.world(seat.u, seat.v, seat.y)), Q = roomPt(r.M, L.world(seat.u + dir[0], seat.v + dir[1], seat.y));
  I.sat = { piece: piece.id, z: P[2], from: { x: s.gx + v.x, y: s.gy + v.y, yaw: v.yaw, pitch: v.pitch } };
  s.freeCam.rebase(r.gx + P[0] - (s.gx + v.x), r.gy + P[1] - (s.gy + v.y));
  s.freeCam.aimAt(Math.atan2(Q[0] - P[0], -(Q[1] - P[1])) * 180 / Math.PI, seat.pitch || 0);
  s.foot.onMove(sitCmd(seat, piece));
  return true;
}
function owStand(s) {
  const I = s.inside, at = I?.sat?.from, v = s.freeCam.view();
  if (!at) return;
  I.sat = null;
  if (v) { s.freeCam.rebase(at.x - (s.gx + v.x), at.y - (s.gy + v.y)); s.freeCam.aimAt(at.yaw, at.pitch); }
  s.foot.onMove('stand');
}
// A click on the picture, inside: the piece in that direction within reach holds the card, as a click on a piece does
// on the Stage (`held`); a click on nothing lets it go. The bearing under the pointer is worked from GLASS's own lens
// (windshield.js viewLatFocal), the way packViewNow works the other way.
function owClick(s, e, el) {
  if (!s.inside) { streetClick(s, e, el); return; }
  const I = s.inside, v = s.freeCam.view(), r = I?.room;
  if (!I || !v || !r || I.sat) return;
  const box = el.getBoundingClientRect();
  if (!box.width) return;
  // a vending machine's button or plug under the pointer is pressed (room-vendor.js hitAt, by the picture GLASS drew)
  if (I.join) { I.join.scene.skip(); return; }
  // a button on the set's picture first, in this same event: going full screen needs the click's own turn
  const on = owTvPoint(s, e, el), btn = on && s.owTv?.buttonAt(on.u, on.v);
  if (btn) { btn.click(); return; }
  const vh = s.owVend?.ui.hitAt(e.clientX - box.left, e.clientY - box.top, box.width, box.height, roomUV(s, r, v.x, v.y));
  if (vh) { if (vh.act.verb === 'vendpress') s.owVend.ui.press(vh.piece.id, vh.act.item); s.foot.onMove(vh.act.cmd); return; }
  const nx = (e.clientX - box.left - box.width / 2) / (box.width / 2), tanH = (box.width / 2) / viewLatFocal(box.width, { fovMul: v.fov || 1 });
  const piece = facedAlong(s, r, v, (v.yaw || 0) + Math.atan(nx * tanH) * 180 / Math.PI);
  I.held = piece ? { piece: piece.id, at: [s.gx + v.x, s.gy + v.y] } : null;
  s.owCardAt = 0;
}
// The room of the building you're in that's free at a point, if any.
function roomAt(s, x, y) {
  const I = s.inside;
  for (const r of s.interiors || []) {
    if (r.gx !== I.gx || r.gy !== I.gy || !sameStorey(r, I.room)) continue;
    const p = roomUV(s, r, x, y);
    if (p && roomFree(r.L, p[0], p[1])) return r;
  }
  return null;
}
// A step inside: into free floor of any room on this floor, or out through a doorway of the room you're in. A
// doorway to another room sends its move; the street door sends its own, and the server's window takes you out.
// ⚠ A SHUT DOOR IS A WALL, inside as on the Stage (room-lock.js `enter` and `fence`): a step through a doorway whose
// lock doesn't let you (client/shared/room-locks.js lockLetsThrough) stops there, and its card says what you can do.
// Without this the step was taken here and refused by the server, and you stood in a room it said you weren't in.
function owDoorLets(s, o) {
  const k = (s.inside?.locks || []).find((q) => q.to === o.to);
  // (its leaf slides back for you, as walking into it does on the Stage, room-lock.js enter)
  if (lockLetsThrough(k)) { s.owLock?.ui.enter(o.to); return true; }
  s.inside.bumped = { to: o.to, t: performance.now() };
  s.owCardAt = 0;
  return false;
}
const OW_LIFT_MS = 1500;
// ⚠ A STEP THROUGH A DOORWAY OR UP A FLIGHT IS TAKEN HERE BEFORE THE SERVER ANSWERS, so a move it refused or never got
// (a dropped socket) left you in a room it said you weren't in. As on the Stage (room-stage.js S.going): with no
// `room_view` for the room in OW_GOING_MS you're put back where you stepped from, in the room you were in.
const OW_GOING_MS = 1800;
function owGoing(s, x0, y0) {
  const I = s.inside;
  I.going = { room: I.room, zone: I.zone, at: [s.gx + x0, s.gy + y0], yaw: s.freeCam.view()?.yaw, t: performance.now() };
}
// ⚠ NO ROOM_VIEW ISN'T ALWAYS A REFUSAL. A reconnect drops the server's note that you're watching the room (plugins/
// roomstage player.logout), and then a step it took comes back as plain text. So the room the server last said you're
// in (state.currentZone, from `move`) decides: in the new room, you stay and the room is asked for again (`room`);
// still in the old one, you're put back.
function owGoingTick(s, flash) {
  const I = s.inside, g = I?.going;
  if (!g || performance.now() - g.t < OW_GOING_MS) return;
  I.going = null;
  if (state.currentZone && state.currentZone === I.zone) { s.foot.onMove('room'); return; }
  I.stairTo = null;
  const v = s.freeCam.view(), wasStair = g.room && !sameStorey(g.room, I.room);
  I.room = g.room; I.zone = g.zone;
  if (v) { s.freeCam.rebase(g.at[0] - (s.gx + v.x), g.at[1] - (s.gy + v.y)); if (g.yaw != null) s.freeCam.aimAt(g.yaw, v.pitch); }
  flash?.(wasStair ? "You can't get that way." : "The door won't let you through.");
}
function insideBlock(s, x0, y0, x1, y1) {
  const I = s.inside;
  const ok = (x, y) => {
    if (I.stairTo) return false;   // on the way up or down: owStairTick moves you next frame
    // ⚠ THROUGH A DOORWAY OR UP A FLIGHT TO ANOTHER ROOM OF THE BUILDING, PAST THE LINE THE STAGE COUNTS (room-layout.js
    // openingCrossed): the move goes, the room switches, and the next frame stands you just inside the next room
    // (owStairTick). It used to wait for the next room's own floor under you, and where two rooms don't quite meet in
    // GLASS (the hostel's desk and kitchen) the doorway's reveal ended short of it and held you there.
    const ps = roomUV(s, I.room, x, y), os = ps && openingCrossed(I.room.L, ps);
    // (into a lift car, the copy of it open onto this landing: the server says whether the car's here)
    const next = os?.dir ? (s.interiors || []).find((q) => q.zone === os.to && q.gx === I.gx && q.gy === I.gy && (!q.stop || q.stop === I.zone)) : null;
    if (next) {
      if (!owDoorLets(s, os)) return false;
      I.stairTo = { room: next, from: I.room.zone };
      owGoing(s, x0, y0);
      I.room = next; I.zone = next.zone; s.foot.onMove?.(os.dir);
      return false;
    }
    // on this room's floor, or the floor of the next one a doorway already took you onto
    const r = roomAt(s, x, y);
    if (r) return r === I.room;
    const p = roomUV(s, I.room, x, y), o = p && openingCrossed(I.room.L, p);
    // a lift's doors from its landing: the move goes (once a beat) and you stay on the landing; the car's `room_view`
    // opens the Stage for the ride, and a car that isn't here leaves you where you stood (phase E)
    if (o && o.dir && o.lift) {
      const t = performance.now();
      if (t - (I.liftAsked || 0) > OW_LIFT_MS) { I.liftAsked = t; s.foot.onMove?.(o.dir); }
      return false;
    }
    if (o && o.dir && !(s.interiors || []).some((q) => q.zone === o.to)) {
      if (!owDoorLets(s, o)) return false;
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
// THE STOREYS (phase E). Up or down a flight: the move was sent and the room switched in insideBlock, and here, a frame
// later and outside the camera's own step, you're stood where the Stage stands you coming off that flight in the next
// room (room-layout.js openingInside), facing the way it faces.
// Into a room of the building by a move the walk didn't make: just inside the way back to the room you came from, as
// the Stage stands you, or on clear floor near its middle when there's no way back drawn (an `up` with no stair).
function owArrive(s, room, fromZone) {
  const L = room.L, v = s.freeCam.view();
  if (!v) return;
  // the doorway you came through; else (a login, a respawn) just inside the street door, as the Stage's entryStand.
  // ⚠ Not the room's middle: in the Embassy that stood you behind the card table's chairs.
  const ops = L.spec.openings || [], back = ops.find((q) => q.to === fromZone && q.dir) || ops.find((q) => q.kind === 'front' && q.dir);
  const at = back ? openingInside(L, back).at : roomNearFree(L, 0, (L.spec.d || 4) / 2, 3) || [0, (L.spec.d || 4) / 2];
  const P = roomPt(room.M, L.world(at[0], at[1], 0));
  s.freeCam.rebase(room.gx + P[0] - (s.gx + v.x), room.gy + P[1] - (s.gy + v.y));
}
// THE OUTSIDE THROUGH THE WINDOWS (phase D, oneworld-sound.js): a fresh set each time you're inside a building, stopped
// on the way out, since room-sound.js can't start again once stopped.
function owSoundTick(s) {
  const I = s.inside;
  if (!I) { if (s.owSound) { s.owSound.stop(); s.owSound = null; } return; }
  const v = s.freeCam.view(), r = I.room;
  if (!v || !r) return;
  if (!s.owSound) { s.owSound = createOneWorldSound(); s.owSound.sky(s.owSky); }
  const y = (v.yaw || 0) * Math.PI / 180, at = roomUV(s, r, v.x, v.y), ahead = roomUV(s, r, v.x + Math.sin(y) * OW_AHEAD, v.y - Math.cos(y) * OW_AHEAD);
  s.owSound.tick(r, { map: s.map, gx: s.gx, gy: s.gy, wx: s.weather }, at, ahead, s.hour);
}
// THE SET ON THE WALL (phase B): room-tv.js's own wall TV, made while you're in a room with a set and stopped when
// you leave it, so tv.js's panel comes up on the set and not as a popup, as on the Stage. Its picture goes on the room's
// screen in GLASS (gl/interiors.js, the entry's `screen`), uploaded only when it's painted a new one.
// TALKING TO SOMEBODY (phase C): while a conversation is open, the camera leaves your eyes and comes in on their face,
// a little to one side of the line from you to them, at their eye height, head and shoulders, and eases back to where
// you stood when it closes. room-talk.js's shot, worked in GLASS's tiles: dialogue.js says who (`npc:talk`), the room's
// people records say where. Somebody not drawn in the room leaves the camera where it was.
const TALK_EYE_M = 1.62, TALK_SIT_EYE_M = 1.18, TALK_SIDE_M = 0.16, TALK_NEAR_M = 1.0, TALK_FAR_M = 1.35;
if (typeof window !== 'undefined') window.addEventListener('npc:talk', (e) => { if (st?.inside) st.inside.talkWho = e.detail?.name || null; });
function owTalkTick(s, now) {
  const I = s.inside;
  if (!I || (!I.talkWho && !I.talkCur)) return;
  const v = s.freeCam.view();
  if (!v) return;
  const dt = I.talkT ? Math.min(0.1, (now - I.talkT) / 1000) : 0.016;
  I.talkT = now;
  const who = I.talkWho && (I.people || []).find((p) => String(p.name || '').toLowerCase() === String(I.talkWho).toLowerCase());
  const q = who && (owPeople(s) || []).find((r) => r.t === personToken(who.id));
  const ax = s.gx + v.x, ay = s.gy + v.y, m = m2tf(1);
  let goal;
  if (q) {
    if (!I.talkCur) { I.talkFrom = { x: ax, y: ay, z: v.z, yaw: v.yaw, pitch: v.pitch }; I.talkCur = { ...I.talkFrom }; }
    const from = I.talkFrom, H = [q.x, q.y, q.z + (q.clip === 'sit' ? TALK_SIT_EYE_M : TALK_EYE_M) * m];
    const dx = H[0] - from.x, dy = H[1] - from.y, D = Math.hypot(dx, dy) || 1, fx = dx / D, fy = dy / D;
    const d = Math.max(TALK_NEAR_M * m, Math.min(TALK_FAR_M * m, D * 0.7)), side = TALK_SIDE_M * m;
    const ex = H[0] - fx * d - fy * side, ey = H[1] - fy * d + fx * side, ez = H[2] + 0.03 * m;
    const lz = H[2] - 0.1 * d, hz = Math.hypot(H[0] - ex, H[1] - ey);
    goal = { x: ex, y: ey, z: ez, yaw: Math.atan2(H[0] - ex, -(H[1] - ey)) * 180 / Math.PI, pitch: Math.atan2(lz - ez, hz), k: 1 - Math.exp(-dt * 5) };
  } else {
    if (!I.talkCur) return;
    goal = { ...I.talkFrom, k: 1 - Math.exp(-dt * 10) };
  }
  const c = I.talkCur, wrap = (a) => ((a % 360) + 540) % 360 - 180;
  c.x += (goal.x - c.x) * goal.k; c.y += (goal.y - c.y) * goal.k; c.z += (goal.z - c.z) * goal.k;
  c.yaw += wrap(goal.yaw - c.yaw) * goal.k; c.pitch += (goal.pitch - c.pitch) * goal.k;
  s.freeCam.rebase(c.x - ax, c.y - ay);
  s.freeCam.aimAt(c.yaw, c.pitch);
  I.talkCam = { z: c.z };
  // back at your own eyes: the shot's over
  if (!q && Math.hypot(c.x - goal.x, c.y - goal.y) < 1e-4 && Math.abs(wrap(c.yaw - goal.yaw)) < 0.2) { I.talkCur = null; I.talkFrom = null; I.talkCam = null; I.talkT = 0; }
}
// A FLAT'S CONTROL PANEL ON ITS GLASS (phase B): room-envctl.js's own page, bent onto the panel's four corners each
// frame as on the Stage, the corners put on the picture by the matrix GLASS drew the room with (gl/world.js
// glInteriorProject). It's made while you're in a room with a panel and let go when you leave; the card's `panel` still
// opens the same OS as a window. Its host is the canvas's own box, so a share of the picture is a share of it.
// A DEPOT'S VEHICLE ON ITS STAND (phase F): room-hoist.js's own, as on the Stage: its panel (call one out, send it back,
// climb in, buy, every button a typed verb) over the view, and the vehicle on the floor where it stands, written into a
// batch hung on the room (`extra`, gl/interiors.js drawExtra), made again while it moves and once after. Fed by
// room_view's and room_vehicles' `vehicles`; made while you're in a room with some and let go when you leave.
let hoistMod = null, hoistW = null;
function owHoistTick(s, now) {
  const I = s.inside, r = I?.room;
  if (!r || !I.vehicles) { if (s.owHoist) { s.owHoist.ui.dispose(); if (s.owHoist.room) s.owHoist.room.extra = null; s.owHoist = null; } return; }
  if (!hoistMod) { hoistMod = Promise.all([import('./room-hoist.js'), import('./gl/world.js')]).then(([m, w]) => { hoistMod = m; hoistW = w; }).catch(() => { hoistMod = null; }); return; }
  if (hoistMod instanceof Promise) return;
  if (!s.owHoist) s.owHoist = { ui: hoistMod.createRoomHoist({ host: s.root, send: (cmd) => s.foot.onMove(cmd), walker: () => { const v = s.freeCam.view(), rr = s.inside?.room; return v && rr ? roomUV(s, rr, v.x, v.y) : null; },
    // the hangar's display is laid over its glass from these (room-hangar-kiosk.js), as a door's hologram is
    project: (p, w, h) => { const rr = s.inside?.room; if (!rr || !hoistW) return null; const q = roomPt(rr.M, p), at = hoistW.glInteriorProject(s.id, q[0] + rr.gx - s.gx, q[1] + rr.gy - s.gy, q[2]); return at && at.f > 0 ? { x: at.x * w, y: at.y * h } : null; } }), room: null, fed: null, ver: -1, was: false, n: 0 };
  const H = s.owHoist;
  if (H.room !== r) { if (H.room) H.room.extra = null; H.room = r; H.ui.load(r.L, I.vehicles); H.fed = I.vehicles; H.ver = -1; }
  else if (H.fed !== I.vehicles) { H.ui.load(null, I.vehicles); H.fed = I.vehicles; }
  H.ui.frame(now);
  const moving = H.ui.moving(now);
  if (moving || H.was || H.ver !== H.ui.ver || !r.extra) {
    H.was = moving; H.ver = H.ui.ver;
    const b = createBatch(4096);
    H.ui.into(b, now);
    r.extra = { batch: b, ver: ++H.n };
  }
}
// `room_vehicles`: what stands on the depot floor of the room you're walking in GLASS changed. True when it was that room.
export function freelookVehicles(msg) {
  const I = st?.inside;
  if (!I || (msg.zone && msg.zone !== I.zone)) return false;
  I.vehicles = msg.vehicles?.machine ? null : msg.vehicles || null;
  if (msg.vehicles?.machine) { I.machineVeh = msg.vehicles; st.owStad?.ui.vehicles(msg.vehicles); }
  return true;
}
let envMods = null;
function owEnvctlTick(s) {
  const I = s.inside, r = I?.room, has = r && (r.L.placed || []).some((x) => x.dress === 'envctl');
  if (!has) { if (s.owEnv) { s.owEnv.ui.stop(); s.owEnv.host.remove(); s.owEnv = null; } return; }
  if (!envMods) { envMods = Promise.all([import('./room-envctl.js'), import('./gl/world.js')]).then(([e, w]) => { envMods = { e, w }; }).catch(() => { envMods = null; }); return; }
  if (envMods instanceof Promise) return;
  const wrap = s.root.querySelector('.ws-wrap');
  if (!wrap) return;
  if (!s.owEnv) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3';
    wrap.appendChild(host);
    const ui = envMods.e.createRoomEnvctl({ host, project: (p, w, h) => owProject(s, p, w, h) });
    // (its layer is styled under #room-stage in room-lock.css: here it's given the same place by hand)
    const layer = host.firstElementChild;
    if (layer) layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
    s.owEnv = { host, ui, room: null };
  }
  const E = s.owEnv;
  if (E.room !== r) { E.room = r; E.ui.load(r.L); }
  const v = s.freeCam.view();
  if (!v) return;
  const at = roomUV(s, r, v.x, v.y);
  if (!at) return;
  const eye = r.L.world(at[0], at[1], (v.z - r.M[14]) / (Math.hypot(r.M[4], r.M[5], r.M[6]) || 1));
  // laid after the frame is drawn (owLate): projected here, it took the last frame's camera and slid as you walked
  (s.owLate ||= []).push(() => E.ui.draw(E.host.clientWidth, E.host.clientHeight, eye, at, []));
}
// A LOCKED DOORWAY (phase B): room-lock.js's own, as on the Stage. The door's steel leaves in the doorway, slid to where
// the server says each stands and back for you as you walk through one you can pass (owDoorLets), written into a batch
// hung on the room ('lockExtra', drawn by gl/interiors.js drawExtra), and the hologram off its reader, its page bent onto
// the reader's corners by the matrix GLASS drew the room with (owProject), its buttons the typed verbs. Hack on it sends
// 'hack door <dir>', whose board opens as the ordinary hololock board here. Fed by room_view's and room_locks' 'locks'.
let lockMod = null;
function owLockStop(s) {
  const K = s.owLock;
  if (!K) return;
  K.ui.stop(); K.host.remove();
  if (K.room) K.room.lockExtra = null;
  s.owLock = null;
}
function owLockTick(s, now) {
  const I = s.inside, r = I?.room;
  if (!r || !I.locks?.length) { owLockStop(s); return; }
  if (!lockMod) { lockMod = Promise.all([import('./room-lock.js'), import('./gl/world.js')]).then(([m, w]) => { lockMod = { m, w }; }).catch(() => { lockMod = null; }); return; }
  if (lockMod instanceof Promise) return;
  const wrap = s.root.querySelector('.ws-wrap');
  if (!wrap) return;
  if (!s.owLock) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3';
    wrap.appendChild(host);
    const K = { host, room: null, fed: null, batch: null, ver: 0 };
    K.ui = lockMod.m.createRoomLocks({ host, send: (cmd) => s.foot.onMove(cmd), setBatch: (b) => { K.batch = b; K.ver++; },
      project: (p, w, h) => { const rr = s.inside?.room; if (!rr) return null; const q = roomPt(rr.M, p), at = lockMod.w.glInteriorProject(s.id, q[0] + rr.gx - s.gx, q[1] + rr.gy - s.gy, q[2]); return at && at.f > 0 ? { x: at.x * w, y: at.y * h } : null; } });
    s.owLock = K;
  }
  const K = s.owLock;
  if (K.room !== r) { if (K.room) K.room.lockExtra = null; K.room = r; K.ui.load(r.L, I.locks, { fresh: true, via: I.via }); K.fed = I.locks; }
  else if (K.fed !== I.locks) { K.ui.load(r.L, I.locks, { fresh: false }); K.fed = I.locks; }
  K.ui.slide(now);
  r.lockExtra = K.batch?.n ? { batch: K.batch, ver: K.ver } : null;
  const v = s.freeCam.view(), at = v && roomUV(s, r, v.x, v.y);
  if (!at) return;
  const eye = r.L.world(at[0], at[1], (v.z - r.M[14]) / (Math.hypot(r.M[4], r.M[5], r.M[6]) || 1));
  (s.owLate ||= []).push(() => K.ui.draw(K.host.clientWidth, K.host.clientHeight, eye, at, []));   // after the frame (owLate)
}
// A VENDING MACHINE (phase B): room-vendor.js's own, as on the Stage. The room's baked mesh leaves the machine out
// (gl/room-stadium.js) because it moves: here it's written into a batch hung on the room ('vendExtra', drawn by
// gl/interiors.js drawExtra) and its lettering laid on its front as decals, eased out from the wall or home, its plug in
// or out, a button in as it's bought. What it shows is the server's ('vend' on the piece, room_view's 'pieces' and then
// room_piece), laid over the room's layout here, since the layout GLASS walks is built from the building's plan.
let vendMod = null;
function owVendTick(s, now) {
  const I = s.inside, r = I?.room, has = r && (r.L.placed || []).some((p) => p.form === 'vendor');
  if (!has) { if (s.owVend) { if (s.owVend.room) s.owVend.room.vendExtra = null; s.owVend = null; } if (I) I.vendDecals = null; return; }
  if (!vendMod) { vendMod = Promise.all([import('./room-vendor.js'), import('./gl/world.js')]).then(([m, w]) => { vendMod = { m, w }; }).catch(() => { vendMod = null; }); return; }
  if (vendMod instanceof Promise) return;
  if (!s.owVend || s.owVend.room !== r) {
    if (s.owVend?.room) s.owVend.room.vendExtra = null;
    const ui = vendMod.m.createRoomVendor({ project: (p, w, h) => { const rr = s.inside?.room; if (!rr) return null; const q = roomPt(rr.M, p), at = vendMod.w.glInteriorProject(s.id, q[0] + rr.gx - s.gx, q[1] + rr.gy - s.gy, q[2]); return at && at.f > 0 ? { x: at.x * w, y: at.y * h } : null; } });
    s.owVend = { ui, room: r, fed: null, ver: 0 };
  }
  const V = s.owVend;
  if (V.fed !== I.pieces) {
    V.fed = I.pieces;
    // the layout as it stands, each machine carrying what the server says it shows (its 'solid' is the room's own, so a
    // machine pulled out stands in your way here too)
    const by = new Map((I.pieces || []).map((p) => [String(p.id), p]));
    const Lv = Object.create(r.L);
    Lv.placed = r.L.placed.map((p) => (p.form === 'vendor' ? { ...p, vend: by.get(String(p.id))?.vend } : p));
    V.ui.load(Lv);
  }
  if (V.ui.frame(now)) { V.ver++; I.vendDecals = V.ui.decals(); }
  const b = V.ui.batch();
  r.vendExtra = b.n ? { batch: b, ver: V.ver } : null;
}
// 'room_piece': a piece of the room you're walking in GLASS changed (a vending machine nudged or unplugged, plugins/
// vending, or anything else furniture.changed sends). True when it was that room. Only what it shows is taken: a
// piece moved or added still needs the room built again, which the Stage does and this doesn't yet.
export function freelookPiece(msg) {
  const I = st?.inside;
  if (!I || msg.zone !== I.zone) return false;
  if (Array.isArray(msg.pieces)) I.pieces = msg.pieces;
  else if (msg.gone) I.pieces = (I.pieces || []).filter((p) => p.id !== msg.id);
  else if (msg.piece) I.pieces = [...(I.pieces || []).filter((p) => p.id !== msg.piece.id), msg.piece];
  st.owCardAt = 0;
  if (owRepiece(msg.zone, I.pieces)) keepInteriors(st, allSentInteriors());
  return true;
}
// A piece moved, added or taken in a room walked in GLASS: the building's rooms as the server sent them get the room's
// pieces as they stand now, and a version (room-interiors.js keys its mesh by it), and are made again, as the Stage
// builds its room again (room-stage.js roomPiece). What a vending machine shows isn't in the mesh (owVendTick), so
// a change only to that builds nothing. True when anything changed.
const pieceShape = (ps) => JSON.stringify((ps || []).filter((p) => !p.annex).map(({ vend: _v, ...p }) => p).sort((a, b) => String(a.id).localeCompare(String(b.id))));
function owRepiece(zone, pieces) {
  let hit = false;
  const main = (pieces || []).filter((p) => !p.annex), shape = pieceShape(main);
  for (const b of sentInteriors.values()) for (const r of b.rooms || []) {
    if (r.zone !== zone || !r.pieces || pieceShape(r.pieces) === shape) continue;
    r.pieces = main; r.ver = (r.ver || 0) + 1; hit = true;
  }
  return hit;
}
// A point in a room's frame (L.world) on the street view's picture, in px of a `w` by `h` box over the canvas, or null
// behind the eye: through the room's matrix to the frame's tiles, then GLASS's own camera (gl/world.js).
function owProject(s, p, w, h) {
  const r = s.inside?.room;
  if (!r || !envMods?.w) return null;
  const q = roomPt(r.M, p), at = envMods.w.glInteriorProject(s.id, q[0] + r.gx - s.gx, q[1] + r.gy - s.gy, q[2]);
  return at && at.f > 0 ? { x: at.x * w, y: at.y * h } : null;
}
let roomTvMod = null;
// THE PAINT ON THE WALLS (phase B): the room's tags (plugins/graffiti) and its sheets (plugins/posters), as decals by the
// Stage's own builders (room-tags.js tagDecals, room-sheets.js sheetRuns and sheetDecals), hung on the room entry for
// gl/interiors.js. Worked out again only when they change or the room does; a set whose join you've seen on the Stage
// is drawn joined (its `rs-joined` mark). The join itself, and the foil and glow, are the Stage's for now.
// THE CLONE HALL (phase F): its vats as the Stage has them. The sleepers posed in the room's own frame (room-vat-sleepers.js,
// figurePeople), the vat cycle (room-vatcycle.js) playing whoever comes down a tube to a release vat, and the monitors'
// screens (room-vitals.js), hung on the room's entry as 'vatLive' for gl/interiors.js, which runs the fluid and the
// machines by the Stage's own gl/room-vat.js and draws the sleepers by the street's close-up figure. Your own arrival
// takes the camera into the vat with you and stands you out of its front after, as on the Stage. Nothing here decides
// anything: the cue is the server's 'room_vat'.
let vatMods = null;
const owVatCues = [];   // a room_vat for a room you're not in yet, kept a few seconds (room-stage.js vatWaiting)
const OW_VAT_LAMPS = 10;
const hexRgb = (hex, d = [0.27, 0.88, 0.66]) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return d; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
function owVatTick(s, now) {
  const I = s.inside, r = I?.room, vs = r?.vatsNow?.() || null, racks = !!r?.L?.placed?.some((p) => p.form === 'vatrack');
  if (!r || (!vs?.length && !racks)) {
    if (s.owVat) { if (s.owVat.room) { s.owVat.room.vatLive = null; s.owVat.room.figLive = null; } s.owVat = null; }
    if (I) { I.vatHide = null; I.vatCam = null; I.vitalList = null; }
    return;
  }
  if (!vatMods) {
    vatMods = Promise.all([import('./room-vatcycle.js'), import('./room-vat-sleepers.js'), import('./gl/room-people.js'), import('./figure-ahead.js'), import('./room-vitals.js'), import('../../../shared/player-figure.js')])
      .then(([c, sl, rp, fa, vi, pf]) => { vatMods = { c, sl, rp, fa, vi, pf }; }).catch((e) => { console.warn('[one-world] the vat hall would not load:', e?.message); vatMods = null; });
    return;
  }
  if (vatMods instanceof Promise) return;
  const { c, sl, rp, fa, vi, pf } = vatMods;
  if (!s.owVat || s.owVat.room !== r) {
    if (s.owVat?.room) s.owVat.room.vatLive = null;
    s.owVat = { room: r, cycle: s.owVat?.cycle || c.createVatCycle(), vitals: vi.createVitals(r.L) };
  }
  const V = s.owVat;
  // the monitors, ten frames a second
  if (V.vitals.tick(now)) I.vitalList = V.vitals.decals();
  if (!vs?.length) { r.vatLive = null; V.bodies = null; return; }
  const v = s.freeCam.view(), at = v ? roomUV(s, r, v.x, v.y) : null;
  // the cycle reads the Stage's state; this is what of it it reads
  const S = { L: r.L, mesh: { vats: vs, gantries: r.gantriesNow() }, walk: { at } };
  for (let i = owVatCues.length - 1; i >= 0; i--) {
    const q = owVatCues[i];
    if (Date.now() - q.at > 8000) { owVatCues.splice(i, 1); continue; }
    if (q.msg.zone === I.zone) { owVatCues.splice(i, 1); V.cycle.arrive(q.msg, I.you); }
  }
  const vc = V.cycle.frame(now, S), t = now / 1000;
  // the sleepers, and anybody the cycle has coming down a tube (you aren't drawn: the camera's in there with you)
  let coming = [];
  if (V.cycle.busy) {
    const people = (I.people || []).filter((p) => p.id !== I.you).map((p) => ({ id: p.id, sex: p.sex, sculpt: true, figure: p.figure || (p.look ? pf.playerFigure(p.look) : undefined) }));
    coming = V.cycle.bodies(people, S, now).filter((b) => Array.isArray(b.at));
  }
  I.vatHide = coming.length ? new Set(coming.map((b) => personToken(b.id))) : null;
  // posed with the room's other close-up figures (owFigTick), which hands the sleepers' capsules back to the fluid
  V.bodies = [...sl.vatSleepers(r.L, vs, t), ...coming];
  // their light: each vat's crown in its fluid's colour, nearest first, and the room's own lamps
  const eye = at ? r.L.world(at[0], at[1], 1.6) : null, d2 = (p) => (eye ? (p[0] - eye[0]) ** 2 + (p[2] - eye[2]) ** 2 : 0);
  const crowns = vs.filter((x) => x.h > 0.3 && x.state !== 'drained').map((x) => ({ p: [x.c[0], x.c[1] + x.h, x.c[2]], k: 0.45, c: hexRgb(x.fluid) }));
  crowns.sort((a, b) => d2(a.p) - d2(b.p));
  const lamps = [...crowns.slice(0, OW_VAT_LAMPS), ...(r.lampsNow?.() || []).map((l) => ({ p: l.p, k: (l.k ?? 1) * 0.6 }))];
  V.lamps = lamps;
  r.vatLive = { scene: vc.scene, levels: vc.levels, bodies: r.vatLive?.bodies || [] };
  // your own arrival: the camera at your eyes in the vat, then stood just out of its front (room-vatcycle.js cam, stepOut)
  const toTiles = (p) => { const q = roomPt(r.M, p); return [r.gx + q[0], r.gy + q[1], q[2]]; };
  const bearingOf = (from, yaw) => { const a = toTiles(from), b = toTiles([from[0] + Math.sin(yaw), from[1], from[2] + Math.cos(yaw)]); return Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI; };
  const cam = v ? V.cycle.cam(now, S, {}) : null;
  if (cam) {
    const E = toTiles(cam.eye);
    s.freeCam.rebase(E[0] - (s.gx + v.x), E[1] - (s.gy + v.y));
    s.freeCam.aimAt(bearingOf(cam.eye, cam.yaw), cam.pitch);
    I.vatCam = { z: E[2] };
  } else if (I.vatCam) I.vatCam = null;
  const out = v ? V.cycle.stepOut(S, now) : null;
  if (out) {
    const W = r.L.world(out.at[0], out.at[1], 0), E = toTiles(W);
    s.freeCam.rebase(E[0] - (s.gx + v.x), E[1] - (s.gy + v.y));
    s.freeCam.aimAt(bearingOf(W, out.yaw), 0);
  }
}
// THE ROOM'S CLOSE-UP FIGURES: whoever the street's crowd body can't draw, posed in the room's own frame by the Stage's
// figurePeople and drawn by the street's close-up figure (gl/interiors.js liveDraw, gl/street-hd.js drawRoom): the people
// lying down (oneworld-people.js lyingBodies) and the vat hall's sleepers and arrivals (owVatTick). Each waits for its
// figure to be built by the worker (figure-ahead.js), as on the Stage, and isn't drawn till then. Hung on the room as
// 'figLive'; a sleeper's capsules go back to the vat's fluid.
let figMods = null;
function owFigTick(s, now) {
  const I = s.inside, r = I?.room;
  if (!r) return;
  const lying = lyingBodies(r.L, I.people, I.you), vat = s.owVat?.room === r ? s.owVat : null;
  const me = s.owMorph?.room === r && s.owMorph.ui?.on ? s.owMorph.ui.self(now) : null;
  const want = [...lying, ...(vat?.bodies || []), ...(me ? [me] : [])];
  if (!want.length) { r.figLive = null; r.heldExtra = null; return; }
  if (!figMods) { figMods = Promise.all([import('./gl/room-people.js'), import('./figure-ahead.js'), import('./room-vat-sleepers.js'), import('./gl/room-held.js'), import('./gl/ballpark-mesh.js')]).then(([rp, fa, sl, rh, bm]) => { figMods = { rp, fa, sl, rh, bm }; }).catch((e) => { console.warn('[one-world] the close-up figures would not load:', e?.message); figMods = null; }); return; }
  if (figMods instanceof Promise) return;
  const { rp, fa, sl, rh, bm } = figMods, t = now / 1000;
  const bodies = want.filter((b) => rp.figureLooks(b).every((k) => fa.figureAhead(k)));
  const recs = bodies.length ? rp.figurePeople(r.L, bodies, t, { level: 'hd' }) : [];
  if (r.vatLive) r.vatLive.bodies = recs.map((q, i) => (bodies[i].vat != null ? { id: bodies[i].vat, ...sl.sleeperCapsules(q.rows) } : null)).filter(Boolean);
  // their light: the room's own lamps, and in the vat hall each vat's crown first
  const lamps = vat?.lamps || (r.lampsNow?.() || []).map((l) => ({ p: l.p, k: (l.k ?? 1) * 0.6 }));
  r.figLive = recs.length ? { recs, lamps, amb: r.lamp ? [0.1, 0.1, 0.11] : null } : null;
  // what's in their hands that the figure doesn't draw (a barbell on a press bench: gl/room-held.js), built every frame
  // while somebody holds it, hung on the room ('heldExtra') as the Stage puts it in its props
  if (recs.some((q) => q?.hold?.L || q?.hold?.R)) { const b = bm.createBatch(2048); rh.heldProps(b, bodies, recs); r.heldExtra = b.n ? { batch: b, ver: (r.heldExtra?.ver || 0) + 1 } : null; } else r.heldExtra = null;
}
// A PET CAT (phase C, docs/proposals/pets.md), as on the Stage: his day from his id and the clock (client/shared/
// cat-life.js through gl/room-beasts.js catsFrame), posed in the room's frame and skinned on the GPU by the Stage's own
// catDrawer into GLASS's cat layer (gl/cat-layer.js, gl/world.js glRoomCats), heard where he is (room-cat-sound.js, by the
// ear oneworld-sound.js sets). Beats (greet, petted, cross) come on the beasts from room_view and room_people.
let catMods = null;
const OW_CAT_REACH_M = 1.5, OW_PET_MS = 1100;
function owCatStop(s) { if (s.owCat) { s.owCat.voice.stop(); s.owCat = null; } }
// THE ROOM'S OTHER ANIMALS (phase C): the Stage's own beasts batch (gl/room-beasts.js beastsBatch), each standing its
// ground and turned to face you, hung on the room ('beastExtra', gl/interiors.js drawExtra). Built again only when they
// change, the room does or you've moved half a metre, as room-stage.js drawBeasts has it. A cat isn't in it (owCatTick).
// A MORPHEX POD (phase F): the Stage's own sequence (room-morphex.js) in the room walked in GLASS. You back into it, it
// shuts, the menu comes up over the picture and you come out somebody else, as on the Stage: its camera is put on the
// street view's (owTakeCam), its swinging halves and ring are a batch hung on the room ('morphExtra'), the pod's own
// halves are left out of the room's mesh meanwhile (hideMesh's busy), and your body is posed with the close-up figures
// (owFigTick). Started by the morphex_panel the pod's `use` brings (dispatch.js, freelookMorphex), as the Stage's is.
// It decides nothing: buying is the `morphex` verbs. Its visor is glass hung on the room ('morphGlass', drawn see-through
// last by gl/interiors.js), and its glows light the room ('glowLive', gl/interiors.js glowLight); its steam and ring's halos are added over the picture ('haloLive', gl/interiors.js haloDraw).
let morphMod = null;
export function freelookMorphex() {
  const s = st, I = s?.inside, r = I?.room, pod = I && (I.pieces || []).find((p) => p.pod && !p.annex);
  if (!pod || !r) return false;
  if (s.owMorph || performance.now() - (s.owMorphEnd || 0) < 4000) return true;
  const q = (r.L.placed || []).find((x) => String(x.id) === String(pod.id));
  if (!q) return false;
  s.owMorph = { room: r, ui: null, ver: 0 };
  Promise.all([import('./room-morphex.js'), import('../../../shared/player-figure.js')]).then(([m, pf]) => {
    const M = s.owMorph;
    if (!M || M.room !== s.inside?.room) { s.owMorph = null; return; }
    const mine = (s.inside.people || []).find((p) => p.id === s.inside.you);
    M.ui = m.createMorphex({ L: r.L, piece: q, mount: s.root, me: { id: s.inside.you, sex: mine?.sex, look: { ...(mine?.look || pf.lookOfPlayer({})) } }, send: (c) => s.foot.onMove(c),
      done: ({ at, yaw }) => { owMorphStop(s); const v = s.freeCam.view(); if (v) owTakeCam(s, r, { eye: r.L.world(at[0], at[1], 1.6), yaw, pitch: 0 }, () => {}); } });
    r.hideMesh?.([], q.id);
  }).catch((e) => { console.warn('[one-world] the MORPHEX would not load:', e?.message); s.owMorph = null; });
  return true;
}
function owMorphStop(s) {
  const M = s.owMorph;
  if (!M) return;
  if (M.ui?.on) M.ui.close();
  if (M.room) { M.room.morphExtra = null; M.room.morphGlass = null; M.room.morphGlows = null; M.room.haloLive = null; M.room.hideMesh?.(null); }
  if (s.inside) s.inside.morphCam = null;
  s.owMorph = null; s.owMorphEnd = performance.now();
}
function owMorphTick(s, now) {
  const M = s.owMorph;
  if (!M) return;
  if (M.room !== s.inside?.room) { owMorphStop(s); return; }
  if (!M.ui) return;
  if (!M.ui.on) { owMorphStop(s); return; }
  const f = M.ui.frame(now);
  if (s.owMorph !== M) return;   // it let you out this frame
  M.room.morphExtra = f.props?.n ? { batch: f.props, ver: ++M.ver } : null;
  M.room.morphGlass = f.glass?.n ? { batch: f.glass, ver: M.ver, glass: true } : null;
  M.room.morphGlows = f.glows?.length ? f.glows : null;
  M.room.haloLive = f.halos?.n ? { batch: f.halos, ver: M.ver } : null;
  if (f.cam) owTakeCam(s, M.room, f.cam, (c) => { s.inside.morphCam = c; });
}
// THE ARRANGE MODE (phase F): the owner's furniture moved by hand, by the Stage's own room-arrange.js over a room walked in
// GLASS. Its camera is put on the street view's (owTakeCam), the room's mesh is the draft built with its walls down and
// drawn instead of the room's own (room-interiors.js override), the piece in your hand a batch hung on the room
// ('arrangeExtra'), and its picking reads GLASS's own lens (owKitchenMatrices through its 'ray'). Nothing is saved till
// its Save, the typed 'arrange layout'; the server's room_arranged comes back through dispatch.js (freelookArranged).
let arrangeMods = null;
const ID_FRAME = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], o: [0, 0, 0], s: 1 };
function owArrangeStart(s) {
  const I = s.inside, r = I?.room;
  if (!r || s.owArrange || s.owMorph || document.getElementById('ks-root')) return;
  s.owArrange = { room: r, ui: null };
  if (!arrangeMods) arrangeMods = Promise.all([import('./room-arrange.js'), import('./gl/room-mesh.js'), import('../../../shared/room-layout.js')]);
  Promise.resolve(arrangeMods).then(([ra, rm, rl]) => {
    arrangeMods = [ra, rm, rl];
    const A = s.owArrange;
    if (!A || A.room !== s.inside?.room) { s.owArrange = null; return; }
    const spec = r.L.spec, opts = { seed: r.seed, lampOn: !!r.lamp };
    const S = { spec, pieces: I.pieces, sheets: I.sheets, L: r.L };
    const rebuild = () => {
      const ps = A.ui?.on ? A.ui.apply(I.pieces) : I.pieces;
      S.L = rl.roomLayout(spec, ps);
      r.override(A.ui?.on ? A.ui.cut(rm.buildRoom(S.L, opts)) : null);
    };
    const R = { setProps: (b) => { r.arrangeExtra = b?.n ? { batch: b, ver: (r.arrangeExtra?.ver || 0) + 1 } : null; }, project: (p, w, h) => owProject(s, p, w, h) };
    const ray = (sx, sy) => { const K = owKitchenMatrices(s, r, ID_FRAME); return K ? { eye: K.eye, dir: K.ray(sx, sy) } : null; };
    const send = (c) => s.foot.onMove(c);
    A.ui = ra.createArrange({ root: s.root, host: s.root, S, R, rebuild, opts: () => opts, send, sendSilent: send, admin: !!I.admin, ray,
      done: (saved) => { if (saved) I.pieces = saved; owArrangeStop(s); if (saved && owRepiece(I.zone, I.pieces)) keepInteriors(s, allSentInteriors()); } });
    rebuild();
  }).catch((e) => { console.warn('[one-world] the arrange mode would not load:', e?.message); s.owArrange = null; arrangeMods = null; });
}
function owArrangeStop(s) {
  const A = s.owArrange;
  if (!A) return;
  if (A.ui?.on) A.ui.close();
  A.room.override?.(null); A.room.arrangeExtra = null;
  if (s.inside) s.inside.arrangeCam = null;
  s.owArrange = null;
}
function owArrangeTick(s, now) {
  const A = s.owArrange;
  if (!A?.ui) return;
  if (A.room !== s.inside?.room || !A.ui.on) { owArrangeStop(s); return; }
  const f = A.ui.frame(now);
  if (f?.cam) owTakeCam(s, A.room, f.cam, (c) => { s.inside.arrangeCam = c; });
  if (f?.after) (s.owLate ||= []).push(f.after);
}
// The arrange mode's answers while it's up in GLASS: 'arranged' how its Save went (room_arranged), 'catalog' the staff
// menu's furniture (room_catalog), 'stock' the posters you carry (room_sheet_stock). True when it took it.
export function freelookArrange(kind, msg) {
  const A = st?.owArrange;
  if (!A?.ui?.on) return false;
  if (kind === 'arranged') { if (msg.zone !== st.inside?.zone) return false; A.ui.result(msg); }
  else if (kind === 'catalog') A.ui.catalog(msg.items);
  else A.ui.stock(msg.items);
  return true;
}
// A STADIUM'S ROOMS (phase F): the Stage's own room-stadium.js over a room walked in GLASS: the last champion's board
// and the clubs' banners painted on their pieces, the venue's signs and the room's marks, as decals on the room
// ('stadDecals', drawn by owDecals), and the champion's colour lighting the room with the MORPHEX's glows ('glowLive',
// put together here every frame). It's given no rink and no neighbours, so it never starts the ice: a room at the rink
// is still the Stage's. The resurfacer in its bay isn't drawn in GLASS yet.
let stadMod = null;
const STAD_FORMS = new Set(['champion', 'banner', 'trophy', 'seatdoor', 'boxoffice', 'smokebooth', 'packs', 'resurfacer']);
function owStadiumTick(s) {
  const I = s.inside, r = I?.room;
  const want = !!r && (!!r.L.spec?.stadium || (r.L.placed || []).some((p) => STAD_FORMS.has(p.form)));
  if (s.owStad && (!want || s.owStad.room !== r)) { s.owStad.ui.dispose(); if (s.owStad.room) { s.owStad.room.stadGlows = null; s.owStad.room.machineExtra = null; } s.owStad = null; if (I) I.stadDecals = null; }
  if (want && !s.owStad) {
    if (!stadMod) { stadMod = import('./room-stadium.js').then((m) => { stadMod = m; }).catch((e) => { console.warn('[one-world] the stadium would not load:', e?.message); stadMod = null; }); }
    else if (!(stadMod instanceof Promise)) {
      const host = document.createElement('div');
      const R = { setGlows: (g) => { r.stadGlows = g?.length ? g : null; }, setUnder: () => {} };
      const ui = stadMod.createRoomStadium({ R, host });
      ui.setMsg({ vehicles: I.machineVeh || null });
      // the pieces as the server has them now (each champion board's 'champ', each banner's 'club'), over the layout
      const by = new Map((I.pieces || []).map((p) => [String(p.id), p]));
      const Ls = Object.create(r.L);
      Ls.placed = r.L.placed.map((p) => { const q = by.get(String(p.id)); return q ? { ...p, champ: q.champ, club: q.club } : p; });
      ui.load(Ls);
      s.owStad = { room: r, ui };
    }
  }
  if (s.owStad && s.owStad.ui.frame()) I.stadDecals = s.owStad.ui.decals().slice();
  // THE RESURFACER in its bay, and out on the ice at the break (room-machine.js, the stadium's): written into a batch
  // hung on the room ('machineExtra'), made again every frame while it moves and once after, as the Stage's beasts batch
  const mc = s.owStad?.ui.machine;
  if (mc?.active) {
    const O = s.owStad, moving = mc.moving();
    if (moving || O.mWas || O.mVer !== mc.ver) {
      O.mWas = moving; O.mVer = mc.ver;
      const b = createBatch(4096);
      mc.into(b);
      r.machineExtra = b.n ? { batch: b, ver: (r.machineExtra?.ver || 0) + 1 } : null;
    }
  } else if (r?.machineExtra) r.machineExtra = null;
  // the room's glows: the stadium's and a MORPHEX's sequence (owMorphTick), six at most (gl/interiors.js glowLight)
  if (r) { const g = [...(r.morphGlows || []), ...(r.stadGlows || [])]; r.glowLive = g.length ? g : null; }
}
// THE ICE (phase F, behind RINK_IN_GLASS, off): a room at a rink, or next door to one, as on the Stage. The Stage's own
// room-rink.js runs the arena (gameday-rink.js) in a box behind GLASS's canvas, its eye put on GLASS's own each frame (the
// eye, the way it looks and the lens from owKitchenMatrices, in the room's frame), and its picture is painted into the
// room's openings onto the ice where they land on the screen ('underExtra': room-interiors.js openHoles, gl/interiors.js
// uScreenOn 2). Every room of the building gets it, so the ice through a doorway is the same ice. It decides nothing:
// the server tunes you to the game's channel as it does for the Stage (room_view's 'rink').
let rinkMod = null;
// for the walk: `__oneWorldRink(true)` in the console lets a rink's rooms into GLASS for this page
if (typeof globalThis !== 'undefined') globalThis.__oneWorldRink = (on = true) => { RINK_IN_GLASS.on = !!on; return RINK_IN_GLASS.on; };
function owRinkStop(s) {
  const K = s.owRink;
  if (!K) return;
  K.ui?.dispose(); K.host.remove();
  for (const r of s.interiors || []) r.underExtra = null;
  s.owRink = null;
}
function owRinkTick(s, now) {
  const I = s.inside, r = I?.room;
  const want = RINK_IN_GLASS.on && !!r && (!!r.L.spec?.rink || (I.neighbours || []).some((n) => n.spec?.rink));
  if (!want) { owRinkStop(s); return; }
  if (!rinkMod) { rinkMod = import('./room-rink.js').then((m) => { rinkMod = m; }).catch((e) => { console.warn('[one-world] the ice would not load:', e?.message); rinkMod = null; }); return; }
  if (rinkMod instanceof Promise) return;
  if (!s.owRink) {
    const host = document.createElement('div');
    host.className = 'fl-under';
    host.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;overflow:hidden';
    s.root.insertBefore(host, s.root.firstChild);
    s.owRink = { host, ui: rinkMod.createRoomRink(host), room: null, ver: 0 };
  }
  const K = s.owRink;
  if (K.room !== r) { K.room = r; K.ui.load(r.L, I.neighbours, I.rinkCh); }
  const box = K.host.firstElementChild;
  if (box && !box.dataset.fl) { box.dataset.fl = '1'; box.style.cssText += ';position:absolute;inset:0'; }
  const M = owKitchenMatrices(s, r, ID_FRAME), w = s.root.clientWidth || 1, h = s.root.clientHeight || 1;
  if (!M) return;
  const d = M.ray(0.5, 0.5), top = M.ray(0.5, 0), half = Math.acos(Math.max(-1, Math.min(1, d[0] * top[0] + d[1] * top[1] + d[2] * top[2])));
  K.ui.tick(now, { eye: M.eye, yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1]))), fov: 2 * half * 180 / Math.PI }, r.L, w, h);
  const cv = box?.querySelector('canvas');
  if (!cv) return;
  K.ver++;
  for (const q of s.interiors || []) {
    if (q.gx !== r.gx || q.gy !== r.gy) continue;
    const b = q.holes?.();
    q.underExtra = b?.n ? { batch: b, ver: 1, under: cv, uver: K.ver } : null;
  }
}
let beastMod = null;
function owBeastTick(s) {
  const I = s.inside, r = I?.room, list = I?.beasts || [];
  if (!r || !list.some((b) => b && !b.cat)) { if (s.owBeast?.room) s.owBeast.room.beastExtra = null; s.owBeast = null; return; }
  if (!beastMod) { beastMod = import('./gl/room-beasts.js').then((m) => { beastMod = m; }).catch(() => { beastMod = null; }); return; }
  if (beastMod instanceof Promise) return;
  const v = s.freeCam.view(), eye = v ? roomUV(s, r, v.x, v.y) : null, B = s.owBeast;
  const moved = !B || !B.eye !== !eye || (eye && Math.hypot(eye[0] - B.eye[0], eye[1] - B.eye[1]) > 0.5);
  if (B && B.room === r && B.fed === list && !moved) return;
  if (B?.room && B.room !== r) B.room.beastExtra = null;
  const batch = beastMod.beastsBatch(r.L, list, { eye: eye ? [eye[0], eye[1]] : null }), ver = (B?.ver || 0) + 1;
  s.owBeast = { room: r, fed: list, eye: eye ? [eye[0], eye[1]] : null, ver };
  r.beastExtra = batch.n ? { batch, ver } : null;
}
function owCatTick(s, now, hour) {
  const I = s.inside, r = I?.room;
  if (!r || !(I.beasts || []).some((b) => b?.cat)) { if (r) r.catLive = null; owCatStop(s); return; }
  if (!catMods) { catMods = Promise.all([import('./gl/room-beasts.js'), import('./gl/cat-gpu.js'), import('./room-cat-sound.js'), import('./gl/world.js')]).then(([b, g, v, w]) => { catMods = { b, g, v, w }; }).catch((e) => { console.warn('[one-world] no cats:', e?.message); catMods = null; }); return; }
  if (catMods instanceof Promise) return;
  const { b, g, v, w } = catMods, R = w.glRoomCats(s.id);
  if (!R) return;
  if (!s.owCat || s.owCat.R !== R) { owCatStop(s); s.owCat = { R, drawer: g.catDrawer(R, { furBudget: 480000 }), voice: v.createCatSound() }; }
  const C = s.owCat, fv = s.freeCam.view(), me = fv ? roomUV(s, r, fv.x, fv.y) : null;
  // where everybody is, you first, so a cat can choose who to look at and go to
  const placed = new Map(placePeople(r.L, I.people, I.you).map((q) => [q.p.id, q.at]));
  const whereIs = (id) => (id === I.you ? me : placed.get(id) || null);
  const folk = () => [I.you, ...(I.people || []).map((p) => p.id)].map((id) => ({ id, at: whereIs(id) })).filter((x) => x.at);
  // how much light there is for his pupils: the lamps, and some of the day
  const h = Number.isFinite(hour) ? hour : 12, day = h > 6.5 && h < 19 ? 1 : 0.2;
  const light = Math.min(1, 0.8 * (r.lamp ? 1 : 0) + 0.6 * day);
  const f = b.catsFrame(r.L, I.beasts, { now: Date.now(), hour: h, whereIs, folk, lowOf: () => 1, drawer: C.drawer, lite: false, light, mouth: C.voice.mouth });
  r.catLive = { cats: f.cats, lamps: (r.lampsNow?.() || []).map((l) => ({ p: l.p, k: (l.k ?? 1) * 0.6 })), amb: null };
  C.voice.tick(f.voices);
  C.b = b;
}
// STROKING HIM WITH THE MOUSE, as on the Stage (room-stage.js): press on him and drag. He answers the spot under the
// pointer at once (catTouch), and every OW_PET_MS of stroking it's sent as the typed 'pet <cat> <spot>', so the server's
// ladder runs and everybody in the room sees him answer.
function owCatPress(s, e, el) {
  const I = s.inside, r = I?.room, C = s.owCat, b = C?.b, W = catMods && !(catMods instanceof Promise) ? catMods.w : null;
  if (!r || !b || !W || !(I.beasts || []).some((x) => x?.cat)) return null;
  const box = el.getBoundingClientRect();
  const project = (p, w, h) => { const q = roomPt(r.M, p), at = W.glInteriorProject(s.id, q[0] + r.gx - s.gx, q[1] + r.gy - s.gy, q[2]); return at && at.f > 0 ? { x: at.x * w, y: at.y * h } : null; };
  const hitAt = (ev) => b.catHit(project, ev.clientX - box.left, ev.clientY - box.top, box.width, box.height, I.beasts);
  const hit = hitAt(e);
  if (!hit) return null;
  const v = s.freeCam.view(), me = v && roomUV(s, r, v.x, v.y), A = b.catActors().get(hit.id);
  if (!A || !me || Math.hypot(A.at[0] - me[0], A.at[1] - me[1]) > OW_CAT_REACH_M) { s.flash?.(`${hit.name || 'The cat'} is out of reach.`); return null; }
  const p = { id: hit.id, name: hit.name, spot: hit.spot, x: e.clientX, y: e.clientY, moved: 0, sent: 0 };
  b.catTouch(hit.id, { ...hit, down: true });
  el.style.cursor = 'grabbing';
  const send = () => { s.foot.onMove('pet ' + p.name + ' ' + p.spot); p.sent = performance.now(); p.moved = 0; };
  return {
    move(ev) {
      p.moved += Math.hypot(ev.clientX - p.x, ev.clientY - p.y); p.x = ev.clientX; p.y = ev.clientY;
      const t = hitAt(ev);
      if (t && t.id === p.id) { p.spot = t.spot; b.catTouch(p.id, { ...t, down: true }); }
      if (p.moved > 30 && performance.now() - p.sent > OW_PET_MS) send();
    },
    up() { el.style.cursor = ''; b.catTouch(p.id, null); if (!p.sent) send(); },
  };
}
// THE KITCHEN AT THE ROOM'S OWN HOB (phase F), as on the Room Stage (room-stage.js onCook): kitchen-stage.js asks
// 'kitchen:open' what the room cooks with and where, and the street view answers with the room's kit and a host. The
// kitchen stands on a ring of the room's hob, its microwave or a worktop (room-cook.js cookFrame, the one you chose Cook
// at first), you're stood in front of it, and its pieces are a live part on the room ('cookExtra', gl/interiors.js
// drawExtra), drawn every frame. A close-up (a cut, the plate, the fridge) takes the camera and gives it back; the fridges
// and the microwave it draws itself leave the room's mesh till it shuts (room-interiors.js hideMesh). It picks through
// the matrix GLASS drew the room with (owKitchenMatrices), so a pan grabbed is the pan you see.
function owCookOpen(s, e) {
  const I = s?.inside, r = I?.room;
  if (!I || !r || !s.foot || !e?.detail) return;
  try { e.detail.kit = roomKitchenKit(r.L, r.seed || 1); } catch (err) { console.warn('[one-world] the kitchen kit:', err?.message); }
  const want = I.cookAt && performance.now() - I.cookAt.t < 20000 ? I.cookAt.id : null;
  I.cookAt = null;
  const frame = cookFrame(r.L, want);
  if (!frame) return;
  const canvas = s.root.querySelector('.ws-wrap canvas') || s.root.querySelector('canvas');
  let ver = 0;
  const host = {
    frame, canvas,
    show(v) {
      if (!v) { r.cookExtra = null; owCookCam(s, r, null); return true; }
      r.cookExtra = { batch: v.props, ver: ++ver };
      owCookCam(s, r, v.cam || null);
      return true;
    },
    view: () => I.cookHome || owSeat(s, r),
    cold: coldIn(r.L, frame),
    cookers: cookersIn(r.L, frame.stand?.piece),
    switchTo: (id) => { I.cookAt = { id, t: performance.now() }; s.foot.onMove('workspace'); },
    hide: (ids) => { const gone = [...(ids || []), ...(host.frame.oven ? [host.frame.oven.id] : [])]; r.hideMesh?.(gone); },
    setRing: (i) => { const f = cookFrame(r.L, host.frame.piece, i); if (f) { host.frame = f; host.cold = coldIn(r.L, f); } return host.frame; },
    matrices: () => owKitchenMatrices(s, r, host.frame),
    // the kitchen's drag to look, on your own feet: your own eye turns (kitchen-stage.js onMove 'look')
    turn: (dx, dy) => { const fv = s.freeCam.view(); if (fv) s.freeCam.aimAt(fv.yaw + dx * FOOT_DRAG * 180 / Math.PI, fv.pitch - dy * FOOT_DRAG); },
  };
  if (frame.oven) host.hide([]);
  e.detail.host = host;
  I.cooking = { room: r, stand: frame.stand };
  // on your feet in front of it, looking at it
  const st0 = frame.stand, v = s.freeCam.view();
  if (st0 && v) {
    if (I.sat) owStand(s);
    const k = r.L.spec?.unit === 'ft' ? FT_PER_M : 1;
    owTakeCam(s, r, { eye: r.L.world(st0.at[0], st0.at[1], 1.6 * k), yaw: st0.yaw, pitch: Math.max(-1.1, Math.min(0.3, st0.pitch)) }, () => {});
  }
}
function owCookClose(s) {
  const I = s?.inside;
  if (!I?.cooking) return;
  const r = I.cooking.room;
  I.cooking = null;
  if (r) { r.cookExtra = null; r.hideMesh?.(null); }
  owCookCam(s, r, null);
}
// a close-up's camera, or none: your own eye back where it was before the first one
function owCookCam(s, r, cam) {
  const I = s.inside;
  if (!I || !r) return;
  if (cam) { if (!I.cookHome) I.cookHome = owSeat(s, r); owTakeCam(s, r, cam, (c) => { I.cookCam = c; }); return; }
  if (I.cookHome) { owTakeCam(s, r, I.cookHome, () => {}); I.cookHome = null; }
  I.cookCam = null;
}
// walked off from where you were cooking: the kitchen shuts, as on the Stage (room-stage.js watchCookStand)
function owCookTick(s) {
  const I = s.inside, c = I?.cooking;
  if (!c?.stand || I.cookCam || c.room !== I.room) return;
  const v = s.freeCam.view(), at = v && roomUV(s, c.room, v.x, v.y);
  if (at && Math.hypot(at[0] - c.stand.at[0], at[1] - c.stand.at[1]) > c.stand.leave) { c.stand = null; window.dispatchEvent(new Event('kitchen:walkaway')); }
}
// The kitchen's frame (cm, gl/kitchen.js F) on GLASS's picture: through the room's frame and its matrix to the window's
// tiles, then the matrix GLASS last drew the rooms with. `vp` for its labels (toScreen), and `eye` and `ray` for its
// picks (pickPlane), all in the kitchen's frame. Null till GLASS has drawn a frame.
function owKitchenMatrices(s, r, F) {
  const W = owWorld(), at = W?.glInteriorVP?.(s.id);
  if (!at?.vp || !F) return null;
  const Fm = [F.x[0] * F.s, F.x[1] * F.s, F.x[2] * F.s, 0, F.y[0] * F.s, F.y[1] * F.s, F.y[2] * F.s, 0, F.z[0] * F.s, F.z[1] * F.s, F.z[2] * F.s, 0, F.o[0], F.o[1], F.o[2], 1];
  const Mt = r.M.slice(); Mt[12] += r.gx - s.gx - at.o[0]; Mt[13] += r.gy - s.gy - at.o[1];
  const vp = new Float32Array(mat4Mul(at.vp, mat4Mul(Mt, Fm))), inv = mat4Inv(vp, new Float64Array(16));
  if (!inv) return null;
  const hom = (x, y, z, w) => [inv[0] * x + inv[4] * y + inv[8] * z + inv[12] * w, inv[1] * x + inv[5] * y + inv[9] * z + inv[13] * w, inv[2] * x + inv[6] * y + inv[10] * z + inv[14] * w, inv[3] * x + inv[7] * y + inv[11] * z + inv[15] * w];
  const e = hom(0, 0, 1, 0), eye = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
  return { vp, eye, ray: (sx, sy) => { const p = hom(sx * 2 - 1, 1 - sy * 2, 1, 1), q = [p[0] / p[3] - eye[0], p[1] / p[3] - eye[1], p[2] / p[3] - eye[2]], n = Math.hypot(q[0], q[1], q[2]) || 1; return [q[0] / n, q[1] / n, q[2] / n]; } };
}
if (typeof window !== 'undefined') {
  window.addEventListener('kitchen:open', (e) => owCookOpen(st, e));
  window.addEventListener('kitchen:close', () => owCookClose(st));
}
// 'room_vat': somebody coming down a tube to a release vat (plugins/roomstage). True when you're walking a building in GLASS,
// which plays it in the room it's for when you're in it, or once you walk in within a few seconds.
export function freelookVat(msg) {
  const I = st?.inside;
  if (!I) return false;
  if (msg.zone === I.zone && st.owVat?.room === I.room) st.owVat.cycle.arrive(msg, I.you);
  else owVatCues.push({ msg, at: Date.now() });
  return true;
}
let wallMods = null;
function owDecals(s) {
  const I = s.inside, r = I?.room;
  if (!r) return;
  const more = [...(I.vitalList || []), ...(I.vendDecals || []), ...(I.stadDecals || [])];
  if (!(I.tags?.length || I.sheets?.length)) { r.decals = more.length ? more : null; return; }
  if (!wallMods) { wallMods = Promise.all([import('./room-tags.js'), import('./room-sheets.js')]).then(([t, sh]) => { wallMods = { t, sh }; sh.onArt(() => { if (st?.inside) st.inside.decalsFor = null; }, 'glass'); }).catch(() => { wallMods = null; }); return; }
  if (wallMods instanceof Promise) return;
  const joining = I.join?.set ?? null;
  if (I.decalsFor !== r || I.decalsTags !== I.tags || I.decalsSheets !== I.sheets || I.decalsJoin !== joining) {
    I.decalsFor = r; I.decalsTags = I.tags; I.decalsSheets = I.sheets; I.decalsJoin = joining;
    const L = r.L, { t, sh } = wallMods;
    let list = [];
    try {
      I.runs = I.sheets?.length ? sh.sheetRuns(L, I.sheets) : [];
      // every set but the one joining, as it rests: a whole set this browser has seen join drawn as one sheet
      const runs = I.runs.filter(({ g }) => g.set !== joining);
      list = [...(I.tags?.length ? t.tagDecals(L, I.tags) : []), ...sh.sheetDecals(L, runs, new Set(runs.filter(({ g }) => sh.isWhole(g) && owSeenJoin(r, g.set)).map(({ g }) => g.set)))];
    } catch (e) { console.warn('[one-world] the walls would not paint:', e?.message); }
    I.decalList = list;
  }
  owJoinTick(s, performance.now());
  const all = [...I.decalList, ...(I.joinDecals || []), ...more];
  r.decals = all.length ? all : null;
}
// THE JOIN (phase B), as on the Stage (room-stage.js startJoin, room-sheets.js createSheetScene): a whole set of sheets
// this browser hasn't seen join, a couple of seconds after you're in the room, closes up into one picture, its gold
// seams lit and its foil lettering coming up a slot at a time, the camera taken square onto it and given back. A click
// skips it. Seen once, it's drawn joined from then on (the Stage's own 'rs-joined' mark, so either view's join counts).
const OW_JOIN_WAIT_MS = 2200;
const owJoinKey = (r, set) => `rs-joined:${r.zone}:${set}`;
function owSeenJoin(r, set) { try { return localStorage.getItem(owJoinKey(r, set)) === '1'; } catch { return false; } }
function owJoinTick(s, now) {
  const I = s.inside, r = I?.room, sh = wallMods?.sh;
  if (!I || !r || !sh) return;
  if (I.join && I.join.room !== r) { I.join = null; I.joinDecals = null; I.joinCam = null; }
  if (!I.join) {
    if (!I.runs?.length || I.sat || I.talkCur || I.vatCam) return;
    if (I.joinWatch !== r) { I.joinWatch = r; I.joinFrom = now; return; }
    if (now - I.joinFrom < OW_JOIN_WAIT_MS) return;
    const pick = I.runs.find(({ g }) => sh.isWhole(g) && !owSeenJoin(r, g.set));
    if (!pick || !sh.sheetDecals(r.L, [pick]).length) return;
    const seat = owSeat(s, r);
    if (!seat) return;
    I.join = { room: r, set: pick.g.set, scene: sh.createSheetScene({ L: r.L, run: pick.run, g: pick.g, width: pick.width, height: pick.height, seat, aspect: () => { const c = s.root.querySelector('canvas'); return c && c.clientHeight ? c.clientWidth / c.clientHeight : 16 / 9; }, now }) };
  }
  const f = I.join.scene.frame(now);
  if (f.done) {
    try { localStorage.setItem(owJoinKey(r, I.join.set), '1'); } catch { /* it plays again, that's all */ }
    I.join = null; I.joinDecals = null; I.joinCam = null; I.decalsFor = null;
    return;
  }
  I.joinDecals = f.decals;
  if (f.cam) owTakeCam(s, r, f.cam, (c) => { I.joinCam = c; });
}
// Where you stand and look, as the Stage's camera ('seat': eye in the room's frame, yaw, pitch, fov), for a shot that
// starts from you and comes back to you.
function owSeat(s, r) {
  const v = s.freeCam.view(), at = v && roomUV(s, r, v.x, v.y);
  if (!at) return null;
  const y = (v.yaw || 0) * Math.PI / 180, ahead = roomUV(s, r, v.x + Math.sin(y) * OW_AHEAD, v.y - Math.cos(y) * OW_AHEAD);
  if (!ahead) return null;
  const eye = r.L.world(at[0], at[1], (v.z - r.M[14]) / (Math.hypot(r.M[4], r.M[5], r.M[6]) || 1));
  const a = r.L.world(at[0], at[1], 0), b = r.L.world(ahead[0], ahead[1], 0);
  return { eye, yaw: Math.atan2(b[0] - a[0], b[2] - a[2]), pitch: v.pitch || 0, fov: 72 };
}
// A shot of the Stage's ({ eye in the room's frame, yaw, pitch }) put on the street view's camera: where it stands, the way
// it looks, and its eye height handed to 'hold' ({ z }, which the stand line reads).
function owTakeCam(s, r, cam, hold) {
  const v = s.freeCam.view();
  if (!v) return;
  const T = (p) => { const q = roomPt(r.M, p); return [r.gx + q[0], r.gy + q[1], q[2]]; };
  const E = T(cam.eye), F = T([cam.eye[0] + Math.sin(cam.yaw), cam.eye[1], cam.eye[2] + Math.cos(cam.yaw)]);
  s.freeCam.rebase(E[0] - (s.gx + v.x), E[1] - (s.gy + v.y));
  s.freeCam.aimAt(Math.atan2(F[0] - E[0], -(F[1] - E[1])) * 180 / Math.PI, cam.pitch || 0);
  hold({ z: E[2] });
}
// `room_tags` and `room_sheets`: the paint on the walls of the room you're walking in GLASS changed. True when it was that room.
export function freelookWalls(msg, kind) {
  const I = st?.inside;
  if (!I || (msg.zone && msg.zone !== I.zone)) return false;
  if (kind === 'tags') I.tags = msg.tags || []; else I.sheets = msg.sheets || [];
  return true;
}
function owTvTick(s, now) {
  const I = s.inside, set = I && (I.pieces || []).find((p) => p.arche === 'screen' && !p.annex);
  if (!set) { if (s.owTv) { s.owTv.stop(); s.owTv = null; } return; }
  if (!s.owTv) {
    if (!roomTvMod) { roomTvMod = import('./room-tv.js').then((m) => { roomTvMod = m; }).catch(() => { roomTvMod = null; }); return; }
    if (roomTvMod instanceof Promise || !roomTvMod.createWallTv) return;
    s.owTv = roomTvMod.createWallTv(s.root, { onChange: () => {} });
    return;
  }
  // a set somebody in the room has on (`tv` on room_view and room_people, plugins/roomstage setOn): it comes on here
  // too, the public one first, and goes off when they turn it off, unless you turned it on (room-stage.js syncTv)
  if (I.npcTv && !s.owTv.on && !I.npcTvAsked) { I.npcTvAsked = true; I.tvFromNpc = true; s.foot.onMove(`watch ${(I.pieces.find((p) => p.arche === 'screen' && p.public && !p.annex) || set).name}`); }
  if (!I.npcTv && I.tvFromNpc && s.owTv.on) { I.tvFromNpc = false; s.owTv.off(); }
  const r = I.room;
  if (!s.owTv.on) { if (r) r.screen = null; s.owTvBoot = null; return; }
  // a set with a `boot` plays it each time it comes on, the broadcast opening out of it (room-tv.js paintBoot)
  const boot = set.boot, m = roomTvMod && !(roomTvMod instanceof Promise) ? roomTvMod : null;
  if (boot && s.owTvBoot == null) s.owTvBoot = now;
  const bt = boot ? (now - s.owTvBoot) / 1000 : Infinity;
  const fresh = s.owTv.paint(now, 1);
  if (m?.paintBoot && bt < m.BOOT_S) {
    const c = s.owBootCanvas || (s.owBootCanvas = document.createElement('canvas'));
    if (c.width !== s.owTv.canvas.width) { c.width = s.owTv.canvas.width; c.height = s.owTv.canvas.height; }
    m.paintBoot(c, s.owTv.canvas, bt, boot);
    s.owTvVer = (s.owTvVer || 0) + 1;
    if (r) r.screen = { canvas: c, ver: s.owTvVer };
    return;
  }
  if (fresh || (boot && r?.screen?.canvas !== s.owTv.canvas)) s.owTvVer = (s.owTvVer || 0) + 1;
  if (r) r.screen = { canvas: s.owTv.canvas, ver: s.owTvVer || 0 };
}
// THE SET UNDER THE POINTER (phase B), as on the Stage (room-stage.js tvPoint): its screen's corners put on the picture by
// the matrix GLASS drew the room with, and the pointer's place on them (room-tv.js quadUV). Over it the set's own buttons
// show and take a click, and the wheel changes the channel, a notch a station.
let owWorldMod = null;
const owWorld = () => { if (!owWorldMod) owWorldMod = import('./gl/world.js').then((w) => { owWorldMod = w; }).catch(() => { owWorldMod = null; }); return owWorldMod instanceof Promise ? null : owWorldMod; };
function owTvPoint(s, e, el) {
  const I = s.inside, r = I?.room, W = owWorld(), m = roomTvMod && !(roomTvMod instanceof Promise) ? roomTvMod : null;
  if (!r || !s.owTv?.on || !W || !m?.quadUV) return null;
  const set = (I.pieces || []).find((p) => p.arche === 'screen' && !p.annex), all = r.screensNow?.() || [];
  const sc = all.find((q) => String(q.id) === String(set?.id)) || all[0];
  if (!sc) return null;
  const box = el.getBoundingClientRect();
  const q = sc.quad.map((p) => { const t = roomPt(r.M, p), at = W.glInteriorProject(s.id, t[0] + r.gx - s.gx, t[1] + r.gy - s.gy, t[2]); return at && at.f > 0 ? { x: at.x * box.width, y: at.y * box.height } : null; });
  return m.quadUV(q, e.clientX - box.left, e.clientY - box.top);
}
function owTvHover(s, e, el) { if (s.owTv) s.owTv.touching(!!owTvPoint(s, e, el)); }
const OW_TV_NOTCH = 100, OW_TV_GAP_MS = 220, OW_TV_IDLE_MS = 400;
function owTvWheel(s, e, el) {
  if (!owTvPoint(s, e, el)) return false;
  const W = s.owTvWheel || (s.owTvWheel = { sum: 0, at: 0, stepped: 0 }), now = performance.now();
  if (now - W.at > OW_TV_IDLE_MS) W.sum = 0;
  W.at = now;
  W.sum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  if (Math.abs(W.sum) >= OW_TV_NOTCH && now - W.stepped > OW_TV_GAP_MS) { s.owTv.step(W.sum < 0 ? 1 : -1); W.sum = 0; W.stepped = now; }
  return true;
}
// THE LIFT CAR (phase E): which copy of a room this view has drawn is the one to take: for a car, the one open onto the
// landing it's parked at (`lift.parked` on room_view), or with none said, its lowest; anything else has one copy.
function liftCopy(s, zone, lift) {
  const all = (s.interiors || []).filter((r) => r.zone === zone);
  if (all.length < 2) return all[0] || null;
  return (lift?.parked && all.find((r) => r.stop === lift.parked)) || all.reduce((a, b) => (b.M[14] < a.M[14] ? b : a));
}
// Ridden to another floor: the same spot in the car, in its copy there, and facing as you were.
function owRide(s, was, now) {
  const v = s.freeCam.view(), at = v && roomUV(s, was, v.x, v.y);
  if (!at) return;
  const P = roomPt(now.M, now.L.world(at[0], at[1], 0));
  s.freeCam.rebase(now.gx + P[0] - (s.gx + v.x), now.gy + P[1] - (s.gy + v.y));
}
function owStairTick(s) {
  const I = s.inside, go = I?.stairTo;
  if (!go) return;
  I.stairTo = null;
  const r = go.room, L = r.L, back = (L.spec.openings || []).find((q) => q.to === go.from), v = s.freeCam.view();
  const there = back && openingInside(L, back);
  if (!there || !v) return;
  // openingInside's yaw is in the layout's own x and z (L.world), so the step that says which way is taken there
  const W = L.world(there.at[0], there.at[1], 0), P = roomPt(r.M, W), Q = roomPt(r.M, [W[0] + Math.sin(there.yaw), W[1], W[2] + Math.cos(there.yaw)]);
  s.freeCam.rebase(r.gx + P[0] - (s.gx + v.x), r.gy + P[1] - (s.gy + v.y));
  s.freeCam.aimAt(Math.atan2(Q[0] - P[0], -(Q[1] - P[1])) * 180 / Math.PI, v.pitch);
}
// How high the floor under you is inside, in tiles: the room's storey and its own ground there (a flight's steps, a
// raised floor), put through its matrix. On the ground floor it's the street's 0, so the eye is FPS_EYE above it as
// outside; upstairs it's the storey's height, which before this left you looking at the floor above from the one below.
function owFloorZ(s) {
  const r = s.inside?.room, v = s.freeCam.view();
  if (!r || !v) return 0;
  const p = roomUV(s, r, v.x, v.y), L = r.L;
  const g = p && L.groundAt ? L.groundAt(p[0], p[1]) || 0 : 0;
  return roomPt(r.M, L.world(p ? p[0] : 0, p ? p[1] : 0, g))[2];
}
// `room_view` for a room this view has drawn: stay in GLASS. True when it's taken; the Stage opens otherwise.
// whether you're walking round inside a building in GLASS, so the server's indoor close doesn't park the view
export function freelookInside() { return !!st?.inside; }
// Whether the street view is up on foot with this room's building in it, so a room_view for it can be taken (dispatch.js
// waits on it for the room button's `world`).
// Whether the street view's own loading veil is still up (its first builds not done)
export function freelookVeiled() { return !!(st && document.getElementById(st.id + '-veil')); }
// Whether the street view has what's round you before its loading screen lifts: the map window, and every room within
// WORLD_READY_TILES of you built whole (room-interiors.js meshReady, which asks for it, so they build behind the veil).
const WORLD_READY_TILES = 1.5;
function worldReady(s) {
  if (!s || !s.map) return false;
  const v = s.freeCam.view(), ex = s.gx + (v?.x || 0), ey = s.gy + (v?.y || 0);
  return (s.interiors || []).every((r) => !r.box || !r.meshReady || Math.hypot(Math.max(r.box[0] - ex, 0, ex - r.box[2]), Math.max(r.box[1] - ey, 0, ey - r.box[3])) > WORLD_READY_TILES || r.meshReady());
}
// Whether the building you've walked into is ready to be seen: every room of it the street view has is built whole
// (room-interiors.js meshReady), so the loading veil can stay up over the rooms building and the people arriving
// (dispatch.js roomVeilOff) and you're never shown a room half there.
export function freelookRoomsReady() {
  const s = st, I = s?.inside;
  if (!I) return true;
  return (s.interiors || []).filter((r) => r.gx === I.gx && r.gy === I.gy).every((r) => !r.meshReady || r.meshReady());
}
export function freelookCanTake(zone) { return !!(st?.foot && st.map && (st.interiors || []).some((r) => r.zone === zone)); }
export function freelookTakeRoom(msg, prev = undefined) {
  if (msg.zone && msg.power && roomPower.get(msg.zone) !== msg.power) { roomPower.set(msg.zone, msg.power); if (st?.interiors?.some((r) => r.zone === msg.zone)) owRelight(st); }
  // dispatch.js says which room the last room_view was (`prev`); this module's own memory is only a fallback
  const was = prev !== undefined ? prev : lastView;
  lastView = { zone: msg.zone, car: !!msg.lift };
  const s = st;
  if (!s || !s.foot) return false;
  const fromLift = was?.car && !s.inside ? was.zone : null;
  const room = liftCopy(s, msg.zone, msg.lift);
  // ⚠ ONLY A BUILDING IN THE VIEW'S WINDOW. A street view parked behind the Stage can be centred anywhere you last
  // walked, and the rooms it was sent stay with the page (sentInteriors); taking one far off stood you in a building
  // the window has no map for. The Stage keeps it, and the window comes round when you're next on the street.
  const R = s.map ? (s.map.length - 1) / 2 : 0;
  const inWindow = !!room && R > OW_WINDOW_MARGIN && Math.abs(room.gx - s.gx) <= R - OW_WINDOW_MARGIN && Math.abs(room.gy - s.gy) <= R - OW_WINDOW_MARGIN;
  if (!room || !inWindow || !oneWorldRoom(s, room, fromLift)) { if (s.inside) s.inside = null; owStudioStop(s); owRinkStop(s); if (s.owSound) { s.owSound.stop(); s.owSound = null; } if (s.owTv) { s.owTv.stop(); s.owTv = null; } if (s.owEnv) { s.owEnv.ui.stop(); s.owEnv.host.remove(); s.owEnv = null; } owLockStop(s); owCatStop(s); if (s.owHoist) { s.owHoist.ui.dispose(); if (s.owHoist.room) s.owHoist.room.extra = null; s.owHoist = null; } return false; }
  if (s.warm) {
    const mount = document.getElementById('area-content');
    if (!mount) return false;
    s.warm = false; mount.innerHTML = ''; mount.appendChild(s.root);
    s.holder?.remove(); s.holder = null; s.mount = mount;
    s.wake(); uncoverPane();
  }
  // the model stays; the storey you're on is cut out of it (insideCut)
  const from = s.inside;
  if (s.inside) s.inside.going = null;
  owWorld();
  s.inside = { zone: msg.zone, room, gx: room.gx, gy: room.gy, lift: msg.lift || null, pieces: msg.pieces || [], locks: msg.locks || [], via: msg.via || null, people: msg.people || [], beasts: msg.beasts || [], you: msg.you ?? null, npcTv: !!msg.tv, vehicles: msg.vehicles?.machine ? null : msg.vehicles || null, machineVeh: msg.vehicles?.machine ? msg.vehicles : null, tags: msg.tags || [], sheets: msg.sheets || [], neighbours: msg.building?.neighbours || null, rinkCh: msg.rink || null, mine: !!msg.mine, admin: !!msg.admin, keypad: !!msg.keypad, routes: routesOf(msg.people || [], performance.now()) };
  if (!s.owCard) s.owCard = createOneWorldCard(s.root, (a, piece) => owAct(s, a, piece));
  // a studio set may claim this room (room-studio.js): ask, as the Stage asks, and freelookSet draws it
  if (from?.zone !== msg.zone) { owStudioStop(s); owRaw({ type: 'room_set', zone: msg.zone }); }
  s.foot.pending = null;
  // in from the street: stood just inside its door, as the Stage stands you (openingInside), since the doorway itself
  // is no room's floor
  // the lift arrived at another floor: the same spot in the car, in its copy at that floor, as it rides you there
  if (from && from.room !== room && from.room.zone === room.zone) owRide(s, from.room, room);
  // a room of this building you didn't walk into (a typed `up` where the plan has no stair): stood in it (owArrive)
  else if (from && from.room !== room) owArrive(s, room, from.zone);
  // taken from the Stage: stood just inside the way back to the room it last showed (`was`), as the Stage stands you,
  // so down its stairs you're at their foot and out of a lift car outside its doors, facing out of them. Only from the
  // street, or from a room with no way back drawn, are you stood inside the street door.
  // ⚠ IT USED TO BE THE STREET DOOR EVERY TIME: down the hostel's stairs on the Stage, GLASS took the desk and stood
  // you at its front door facing the street.
  const ops = room.L.spec.openings || [];
  const back = !from && was?.zone ? ops.find((q) => q.to === was.zone && (q.dir || q.lift)) : null;
  const o = from ? null : back || ops.find((q) => q.dir && !(s.interiors || []).some((r) => r.zone === q.to));
  const v = o && s.freeCam.view();
  // a room with no street door, opened by the room button (`world`): stood in its middle, on clear floor
  if (!from && !o && msg.world) {
    const v0 = s.freeCam.view(), L = room.L, mid = roomNearFree(L, 0, L.d / 2) || [0, L.d / 2];
    if (v0) { const P = roomPt(room.M, L.world(mid[0], mid[1], 0)); s.freeCam.rebase(room.gx + P[0] - (s.gx + v0.x), room.gy + P[1] - (s.gy + v0.y)); }
  }
  if (v) {
    const there = openingInside(room.L, o), W = room.L.world(there.at[0], there.at[1], 0), P = roomPt(room.M, W);
    s.freeCam.rebase(room.gx + P[0] - (s.gx + v.x), room.gy + P[1] - (s.gy + v.y));
    // turned into the room: down the stairs (`back`), and by the room button (`world`), whose street view looked away
    // from the building, so you stood inside the door facing the street
    if (back || msg.world) { const Q = roomPt(room.M, [W[0] + Math.sin(there.yaw), W[1], W[2] + Math.cos(there.yaw)]); s.freeCam.aimAt(Math.atan2(Q[0] - P[0], -(Q[1] - P[1])) * 180 / Math.PI, 0); }
  }
  return true;
}
function footBlock(s, x0, y0, x1, y1) {
  const f = s.foot;
  if (!f || !s.map) return null;
  if (s.inside?.sat) return [x0, y0];   // on a seat (owSit): a step gets you up (footKey), it doesn't slide the seat
  if (s.inside?.talkCam) return [x0, y0];   // in a conversation the camera's on their face (owTalkTick), not walking
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
// The street door F would take you in by from where you stand, or null: footDoor's own test, which the prompt reads too.
function footDoorNear(s) {
  const f = s.foot, fv = s.freeCam.view();
  if (!f || !fv || !s.map || f.pending || s.inside) return null;
  const ax = s.gx + fv.x, ay = s.gy + fv.y, T = f.tile;
  for (const d of f.doors) {
    const E = EDGE_VEC[d.edge];
    if (!E || T.gx !== d.gx + E[0] || T.gy !== d.gy + E[1]) continue;
    const g = doorway(s, d);
    if (!g) continue;
    const [px, py] = g.at(0, g.wall);
    if (Math.hypot(px - ax, py - ay) > DOOR_NEAR + (0.5 - g.wall)) continue;
    return { d, g, px, py, ax, ay };
  }
  return null;
}
function footDoor(s) {
  const f = s.foot, hit = footDoorNear(s);
  if (!hit) return;
  const { d, g, ax, ay } = hit;
  {
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
  freelookSetHere(msg.here);
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
