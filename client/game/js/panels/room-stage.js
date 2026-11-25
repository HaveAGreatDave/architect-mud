// THE ROOM STAGE: a flat you walk round in first person (docs/proposals/room-stage.md,
// docs/proposals/home-stage.md; plugins/roomstage sends it).
//
// One payload builds the room (`room_view`): its spec, its pieces with their archetypes and spots,
// and everyone in it. The layout is client/shared/room-layout.js's, the walk is room-walk.js's (the
// Platinum Box suite walks the same way), the mesh is gl/room-mesh.js's and the picture gl/room.js's.
// After that, `room_piece` sends a piece that was placed or taken and `room_people` who's in the room
// now, and this sends `room_pos` when you settle so they see you where you are. `room_outlook` is the
// world round the building, and room-outlook.js points GLASS out of the window with it. `room_sky` is
// the weather and who's flying as they change; room-window.js works out what that looks like past the
// glass and room-sound.js what it sounds like through it.
//
// ⚠ AN EN-SUITE IS ACROSS A THRESHOLD, NOT ANOTHER STAGE. It's drawn behind the back wall with its door
// open, and walking through sends the ordinary `in` or `out`. The server answers `room_here`. If it
// refuses, nothing answers, and after a moment you're put back on the side of the door you came from.
//
// ⚠ EVERY GESTURE IS A VERB. Sitting sends `sit <piece>`, lying `lie <piece>`, getting up `stand`, a
// fridge `open <piece>`, a set `watch <piece>`; nothing here changes the world. Typing them works the
// other way round: a `sit sofa` typed in the log puts you on the sofa here, because your own posture
// comes back in `room_people` and the walker follows it.
//
// The card at the bottom of the picture lists what the piece you're facing offers (room-acts.js). F is
// its first line, 2 to 9 the rest, and a click on a piece holds the card on it until you walk off.
// It opens in the game pane, as free look and the flight sim do: the sidebar and the command box stay,
// and the seat ladder (seat-ladder.js) takes the log, the command box or the whole page away. The
// log is folded by default, so what the server answers a line with comes up on the card (`roomSays`).

import { switchOf, saveSwitch, litOf } from '../../../shared/room-lights.js';
import { lightAt } from '../../../shared/sky-keys.js';
import { FT_M } from '../../../shared/world-scale.js';
import { sendCmd, sendCmdSilent, sendCmdQuiet, sendRaw } from '../net.js';
import { clubOf } from './club-crest.js';
import { createHands } from './stands-hands.js';
import { closeDialogue } from './dialogue.js';
import { loadCss } from '../../../shared/dom.js';
import { LIFT_STOREY } from '../../../shared/building-graph.js';
import { cachetInner, WASH_FORMS, doorwaysOf } from '../../../shared/room-layout.js';
import { roomPath, roomNearFree, crowdSpot, crowdSeed, lineSpots, linePoints } from '../../../shared/room-layout.js';
import { pieceHangs, cleanSpot } from '../../../shared/room-layout.js';
import { roomLayout, inAnnex, onBalcony, pathAt, pathLength, roomYaw, seatsClash, openingCrossed, openingInside, roomFree, roomSees, facing, FT_PER_M, pieceBoxes, heldShort, openingPast, flightLocal, WALL_T } from '../../../shared/room-layout.js';
import { pieceActs, personActs as personLines } from '../../../shared/room-acts.js';
import { createRoomWalk } from './room-walk.js';
import { createOutlook, warmOutlook } from './room-outlook.js';
import { createRoomWindow } from './room-window.js';
import { makeContactTrack } from './world-feed.js';
import { createRoomSound } from './room-sound.js';
import { createRoomOutdoors } from './room-outdoors.js';
import { takeDoor, keepStill, stillFor, takeCarry } from './lobby-still.js';
import { createWallTv, paintBoot, BOOT_S, quadUV } from './room-tv.js';
import { createRoomLocks } from './room-lock.js';
import { createRoomEnvctl } from './room-envctl.js';
import { feedRequest } from './room-feed.js';
import { createPack } from './room-pack.js';
import { createCloseup } from './room-closeup.js';
import { createTalkShot } from './room-talk.js';
import { trophyCup } from './gl/room-stadium.js';
import { paintCupRoll, CUP_FACE } from './gl/room-cup.js';
import { loadFace } from './stadium-signs.js';
import { footDockHTML, bindFootDock } from './foot-dock.js';
import { setScreenHour } from './gl/room-screens.js';
import { createRoomLift } from './room-lift.js';
import { createMorphex } from './room-morphex.js';
import { createVitals } from './room-vitals.js';
import { createArrange, cutaway } from './room-arrange.js';
import { figureWorn } from '../../../shared/paper-doll.js';
import { aimWall, tagDecals, tagQuad, bakeRoomTag, tagVariant } from './room-tags.js';
import { sheetRuns, sheetDecals, setsOf, isWhole, createSheetScene, onArt, snapRun, wallPoint, WALL_GRID_M } from './room-sheets.js';
import { setSprayStage, clearSprayStage } from './spray-aim.js';
import { playerFigure, lookOfPlayer } from '../../../shared/player-figure.js';
// A person's settled look: an NPC's `figure`, or a player's from their MORPHEX columns (`look`), one object per look
// so the figure's key stays put between sends
const figs = new Map();
function figOf(p) {
  if (p.figure || !p.look) return p.figure;
  const k = JSON.stringify(p.look);
  let f = figs.get(k);
  if (!f) { if (figs.size > 64) figs.clear(); f = playerFigure(p.look); figs.set(k, f); }
  return f;
}
import { coverWithVeil, finishVeil, placeVeil } from './glass-veil.js';
import { STRIDE } from './gl/ballpark-mesh.js';
import { seatLadderHTML, bindSeatLadder, releaseSeatLadder, keepSeatRung } from './seat-ladder.js';
import { createRoomRenderer, warmRoomCanvas } from './gl/room.js';
import { assembleBatch } from './gl/room-mesh.js';
import { buildRoom, withShells, roomKitchenKit, spinBatch, swingBatch, liftDoorBatch, paintRoomTexture, paintView, paintScreen, ROOM_RUG } from './gl/room-mesh.js';
import { figurePeople, figureLooks, FIGURE_LOD, dressOf, clipOnce, actClip, clipHold, clipDur } from './gl/room-people.js';
import { figureAhead } from './figure-ahead.js';
import { mealProps } from './gl/room-meals.js';
import { plumbingProps, plumbingLive } from './gl/room-plumbing.js';
import { leaksProps, leaksLive } from './gl/room-squat.js';
import { beastsBatch, hasCats, onlyCats, catsFrame, catHit, catTouch, catActors } from './gl/room-beasts.js';
import { catDrawer } from './gl/cat-gpu.js';
import { createCatSound } from './room-cat-sound.js';
import { createRoomHoist } from './room-hoist.js';
import { createRoomVendor } from './room-vendor.js';
import { stashProps } from './gl/room-stash.js';
import { createShutters, shutterFrame } from './gl/room-shutters.js';
// a sash window's drapes drawn across (plugins/envcontrol scene 'drapes'): the mesh draws them, nothing goes on the glass
const drapesDrawn = (g) => !!g?.down && g.paint?.kind === 'drapes';
const glassCover = (g) => (drapesDrawn(g) ? { ...g, down: false } : g);
import { heldProps } from './gl/room-held.js';
import { pokerProps, pokerLive, pokerMineAt, pokerAnchors } from './gl/room-poker.js';
import { handOf, drawsOf, inHand, SUIT_GLYPH } from '../../../shared/poker-hand.js';
import { stashAt } from '../../../shared/table-stash.js';
import { mouthTrack, textTrack, mouthAt } from '../../../shared/lip-sync.js';
import { actOfLine, speakerOf } from '../../../shared/npc-acts.js';
import { createRoomStadium } from './room-stadium.js';
import { createVatCycle } from './room-vatcycle.js';
import { vatSleepers, sleeperCapsules } from './room-vat-sleepers.js';
import { cookFrame, cookersIn, coldIn } from './room-cook.js';   // where the kitchen stands in a room (shared with GLASS)   // the bodies in the clone vats (shared with GLASS)
import { ticketActs } from '../../../shared/stadium.js';

// the pane strip the live window view builds (lookOut): the margin each side, as a fraction of the width, for pitch
// and a tall building leaning in from off the strip
const CULL_PAD = 0.08;

const CSS = await loadCss(new URL('./room-stage.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-stage-css')) return;
  const s = document.createElement('style');
  s.id = 'room-stage-css'; s.textContent = CSS;
  document.head.appendChild(s);
  // the HUD's lettering (the cyber skin in room-stage.css), off the game's own font folder
  if (typeof FontFace === 'function' && document.fonts) {
    for (const [fam, file] of [['RS Orbitron', 'orbitron.woff2'], ['RS Audiowide', 'audiowide.woff2']]) {
      const f = new FontFace(fam, `url(${new URL(`../../../shared/fonts/${file}`, import.meta.url)})`, { display: 'swap' });
      document.fonts.add(f); f.load().catch(() => {});
    }
  }
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// how far a pixel of drag turns the head, radians
const TURN = 0.0045;
const SPIN_MS = 3000;   // a Cachet's turntable, half a turn
const ASSEMBLE_MS = 12000;   // a Cachet in a false wall: the bar turning away and the lab coming up out of its recess
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

let ui = null;
// WHO ANSWERS THE ARRANGE MODE (room-arrange.js): the game, by the `arrange` verbs, unless a page with no server sets a
// host of its own. The Room Lab does (tools/modelshop/room-lab.html): `host(cmd, msg)` takes the same command text and
// writes content/ files, then answers through roomArranged and roomCatalog as the server would.
let arrangeHost = null;
export function setArrangeHost(host) { arrangeHost = typeof host === 'function' ? host : null; }
// the outlook's handler while a room is open, and one that arrived a beat before the room finished
// loading: `room_view` goes through a dynamic import, `room_outlook` right behind it
let ui_outlook = null, pendingOutlook = null;
// the last view out of the window, kept so a Stage rebuilt after a lost GL context gets it back
let lastOutlook = null;
// The view out of the window between one room's Stage and the next room's of the same building
// (room-outlook.js `adopt`): kept running, not started again, so a doorway or a lift costs no reload.
// { outlook, building }; stopped if nothing takes it within PARK_MS.
let parkedView = null;
const PARK_MS = 15000;
function parkView(outlook, building) {
  dropParked();
  parkedView = { outlook, building, timer: setTimeout(dropParked, PARK_MS) };
}
function dropParked() {
  if (!parkedView) return;
  clearTimeout(parkedView.timer);
  try { parkedView.outlook.stop(); } catch { /* already gone */ }
  parkedView = null;
}
function takeParked(building) {
  const p = parkedView;
  if (!p || !building || p.building !== building) return null;
  clearTimeout(p.timer);
  parkedView = null;
  return p.outlook;
}
// A lift ride under way: the car you pressed a button in, and when. The car's next `room_view` (ride)
// opens with its doors shut, so the floor it arrives at is built behind them, and then they part.
let liftRide = null;
const DOORS_MS = 1100, DOORS_WAIT_MS = 450, RIDE_GIVE_UP_MS = 8000;

// ⚠ A ROOM'S MESH IS BUILT ONCE AND KEPT (docs/proposals/building-stage.md, "Baked ahead"). buildRoom is nearly all
// of what a crossing cost: 40 to 55 ms for a furnished flat, and a crossing built the room and every room round it in
// one frame. So a mesh is kept under everything it was built from (the spec, the pieces, the seed and the options),
// and the server's `room_ahead` lets the Stage build the rooms past the next doorway before you reach it (roomAhead).
// A miss builds as it always did, so a piece that moved since costs one build and never a wrong room.
// ⚠ NEVER HAND A KEPT MESH TO withShells: it adds the shells into the batches it's given. roomMesh copies first.
// Kept by size, the oldest dropped first. A furnished flat is 9 MB of vertices once its batches are cut to length
// (12.5 as built), and a hall wants its flats twice: as the shells it draws now and as the rooms you might walk into.
const BAKE_BYTES = matchMedia('(pointer: coarse)').matches ? 48e6 : 192e6;
const baked = new Map();
// ⚠ A ROOM'S PAINTED TEXTURES OUTLIVE THE STAGE. The same key paints the same canvas, but the map was the Stage's,
// so every room opened painted its plaster, brick and boards again on the CPU: most of what an open cost after the
// shaders. Kept here, least recently used out past PAINTED_MAX (a 512 canvas is about a megabyte).
const paintedTex = new Map(), PAINTED_MAX = 40;
let bakedBytes = 0;
const roomKey = (spec, pieces) => JSON.stringify([spec, pieces]);
const bakeKey = (room, o) => room + '|' + JSON.stringify([o.seed, !!o.lampOn, !!o.doorShut, o.turning ?? null, o.swinging ?? null, o.busy ?? null, [...(o.joined || [])].sort(), !!o.shell, ...(o.frontOpen ? ['front'] : []), ...(o.drawn ? ['drawn'] : []), ...(o.facade ? [JSON.stringify(o.facade)] : [])]);
const meshBytes = (m) => { let n = 0; for (const b of [m.solid, m.glass, m.screen, m.view, ...m.textured.values()]) n += b?.data?.byteLength || 0; return n; };

// ⚠ THE LIGHT SWITCH IS KEPT PER ROOM. It used to be one setting ('roomLamp', 'roomLampLevel') for every room, so lights
// switched off in one flat, or by its control panel, stayed off in the lobby and every room after. Now 'roomLights' is
// { zone: { off?: 1, level? } }, holding only the rooms that differ from on at full, the latest last and the oldest
// dropped past LIGHTS_KEPT. The old keys are cleared, so a viewer stuck dark gets their lights back.
try { localStorage.removeItem('roomLamp'); localStorage.removeItem('roomLampLevel'); } catch { /* private window */ }
// the switch, kept per room for this viewer: client/shared/room-lights.js, which a room walked in GLASS reads too
// what a room is drawn as: its switch, and its mains ('on', 'low' or 'off', plugins/roomstage powerOf). On 'low' the
// grid is down and the room's emergency lighting is all there is, so its lamps burn at this share of the dimmer.
const EMERGENCY_K = 0.3;

function bakedMesh(room, L, opts) {
  const key = bakeKey(room, opts);
  let e = baked.get(key);
  if (e) { baked.delete(key); baked.set(key, e); return e.mesh; }
  return keepMesh(key, buildRoom(L, opts));
}
function keepMesh(key, mesh) {
  const e = { mesh };
  for (const b of [mesh.solid, mesh.glass, mesh.screen, mesh.view, ...mesh.textured.values()]) if (b?.data && b.data.length > b.n * STRIDE) b.data = b.data.slice(0, b.n * STRIDE);
  e.bytes = meshBytes(mesh);
  baked.set(key, e); bakedBytes += e.bytes;
  for (const [k, old] of baked) { if (bakedBytes <= BAKE_BYTES || k === key) break; baked.delete(k); bakedBytes -= old.bytes; }
  return mesh;
}
// ⚠ BAKED AHEAD OFF THE MAIN THREAD (room-mesh-worker.js). A room baked ahead was 40 to 240 ms of one frame, run every
// 60 ms as you walked into a room: the stutter after every doorway. The worker builds it and the reply goes into the
// same cache, so the crossing finds it as before. A room asked for before its reply is built here, as a miss always
// was, and the late reply is dropped. Null when there's no worker, and the caller builds it here.
// ⚠ MESH_FIELDS IS EVERYTHING THE STAGE READS OFF A MESH; the rest of buildRoom's return can't be posted.
const MESH_FIELDS = ['solid', 'glass', 'screen', 'textured', 'view', 'mats', 'screens', 'lamps', 'windows', 'spin', 'slideDoors', 'liftDoors', 'dials', 'vats', 'gantries', 'voidRoom'];
let meshWorker = null, meshAsked = 0;
const meshWaits = new Map(), meshPending = new Map();
function bakeOffThread(spec, pieces, opts) {
  const key = bakeKey(roomKey(spec, pieces), opts);
  const have = baked.get(key);
  if (have) return Promise.resolve(have.mesh);
  if (meshPending.has(key)) return meshPending.get(key);
  if (!meshWorkerUp()) return null;
  const id = ++meshAsked;
  const p = new Promise((done) => meshWaits.set(id, (mesh, error) => {
    meshPending.delete(key);
    if (error && error !== 'worker') console.warn('[room] baking off the thread:', error);
    done(mesh ? (baked.get(key)?.mesh || keepMesh(key, mesh)) : null);
  }));
  meshPending.set(key, p);
  meshWorker.postMessage({ id, spec, pieces, opts, fields: MESH_FIELDS });
  return p;
}
function meshWorkerUp() {
  if (meshWorker === false) return false;
  if (meshWorker) return true;
  try {
    meshWorker = new Worker(new URL('./room-mesh-worker.js', import.meta.url), { type: 'module' });
    meshWorker.onmessage = ({ data: { id, mesh, bitmap, error } }) => { const w = meshWaits.get(id); if (w) { meshWaits.delete(id); w(error ? null : mesh || bitmap, error); } };
    // a worker that won't load: everything waiting is built here, and nothing is sent to it for a minute. Then it's
    // tried again: a server restarting under --watch refuses the worker's fetch for a few seconds, and giving up for
    // good left every room after it baked on the main thread until a reload
    meshWorker.onerror = (e) => { console.warn('[room] mesh worker:', e.message || e); meshWorker.terminate(); meshWorker = false; setTimeout(() => { if (meshWorker === false) meshWorker = null; }, 60000); for (const w of meshWaits.values()) w(null, 'worker'); meshWaits.clear(); };
    return true;
  } catch { meshWorker = false; return false; }
}
// ⚠ A MATERIAL BAKED AHEAD IS PAINTED IN THE SAME WORKER (room-mesh-worker.js), as an ImageBitmap for the renderer to
// upload. Painted here it was 5 to 35 ms of one frame, run every 60 ms whether or not you were turning: the hitches
// while you looked round a room you'd just walked into. A sign is still painted here, since its lettering may be in
// a font the page loaded and a worker hasn't. Null when there's no worker, or for a sign; the bitmap or null after.
function paintOffThread(key, seed) {
  if (key.startsWith('roomSign|') || typeof OffscreenCanvas !== 'function' || !meshWorkerUp()) return null;
  const id = ++meshAsked;
  const p = new Promise((done) => meshWaits.set(id, (bitmap, error) => {
    if (error && error !== 'worker') console.warn('[room] painting off the thread:', error);
    done(bitmap || null);
  }));
  meshWorker.postMessage({ id, texture: key, seed });
  return p;
}
// a mesh of its own to add the shells to, the kept one left as it was built
const meshCopy = (m) => { const cp = (b) => ({ ...b, data: b.data.slice() }); return { ...m, solid: cp(m.solid), glass: cp(m.glass), screen: cp(m.screen), textured: new Map([...m.textured].map(([k, b]) => [k, cp(b)])) }; };

export const roomStageOpen = () => !!ui;
// What the loading veil says going in (glass-veil.js `place`): the building (plugins/roomstage entryCard), the room
// and its street, and the start of the building's own description. A room in no building is named by itself.
export function roomVeilPlace(msg) {
  const e = msg?.entry, room = msg?.name || '';
  if (!e?.name) return room ? { kicker: 'ENTERING', title: room, room: true } : { room: true };
  return { kicker: 'ENTERING', title: e.name, sub: [room !== e.name ? room : '', e.street, e.region].filter(Boolean).join(' · '), blurb: e.blurb || '', room: true };
}

// Spare room canvases, one per kind (see out or not), made when the page is idle (gl/room.js warmRoomCanvas)
const spares = new Map();
function takeSpare(see) { const c = spares.get(see) || null; spares.delete(see); return c; }
function warmSpares() {
  const phone = matchMedia('(pointer: coarse)').matches;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
  for (const see of phone ? [false] : [true, false]) {
    if (spares.has(see)) continue;
    // a few seconds on, so the open room's own late programs (the close-up figure) are compiled first
    setTimeout(() => idle(() => { if (!spares.has(see)) { const c = warmRoomCanvas({ phone, see }); if (c) spares.set(see, c); } }, { timeout: 4000 }), 3000);
  }
}
// the first ones as soon as this module's loaded, so even the first room opens warm
if (typeof window !== 'undefined' && typeof window.WebGL2RenderingContext === 'function') setTimeout(warmSpares, 1500);

// ⚠ A FAILED OPEN MUST NOT LEAVE THE PANE BLANK. room-stage-on hides the room text; an open that threw
// partway left it hidden with nothing over it, the sidebar alone, until the Stage was opened again.
export function openRoomStage(msg) {
  askCrests(msg.people);
  try { openStage(msg); warmSpares(); } catch (err) {
    if (ui) closeRoomStage(true);
    else { document.getElementById('room-stage')?.remove(); document.body.classList.remove('room-stage-on'); releaseSeatLadder(); }
    throw err;
  }
}

function openStage(msg) {
  ensureStyles();
  // through a doorway or off a lift into the next room of the same building: the open Stage moves there
  if (ui?.cross && msg.via && !msg.relost && msg.building?.id && ui.building?.() === msg.building.id && ui.root.isConnected) { ui.cross(msg); return; }
  // the next room of the same building keeps the view out of the window running
  closeRoomStage(true, msg.building?.id || null);
  const root = document.createElement('div');
  root.id = 'room-stage';
  root.innerHTML = `<div class="rs-bar">
      <span class="rs-where"><b>${esc(msg.name)}</b>${msg.mine ? '' : ' · visiting'}</span>
      <span class="rs-tvbar" hidden>
      </span>
      <span class="rs-ladder">${seatLadderHTML('rs-chip')}</span>
      <button type="button" class="rs-arrange" title="${msg.admin ? 'Set the room up: move, add and remove furniture (B, staff)' : 'Move your furniture round (B)'}"${msg.mine || msg.admin ? '' : ' hidden'}>Arrange</button>
      <button type="button" class="rs-vattest" title="Kill a random NPC somewhere and reprint them here, down a tube into a release vat (staff)" hidden>Vat test</button>
      <button type="button" class="rs-leave" title="Back to the room text">▣ Close</button>
    </div>
    <div class="rs-host"><canvas class="rs-canvas"></canvas><div class="rs-tags"></div>
      <div class="rs-hover" hidden></div><div class="rs-flash"></div>
      <div class="rs-card" hidden><b class="rs-card-name"></b><div class="rs-card-acts"></div><p class="rs-card-say" hidden></p></div>
      <div class="rs-firehud" hidden role="dialog" aria-label="The gas fire">
        <button type="button" class="rs-firehud-x" title="Close (Esc)" aria-label="Close">×</button>
        <b class="rs-firehud-name">Gas fire</b>
        <button type="button" class="rs-knob" role="slider" aria-valuemin="0" aria-valuemax="100" aria-label="The gas fire" title="Drag, scroll or click to turn it ( , and . )"><span class="rs-knob-cap"><i></i></span></button>
        <span class="rs-fire-lbl">Pilot</span>
        <div class="rs-fire-steps"><button type="button" data-k="0">Pilot</button><button type="button" data-k="0.35">Low</button><button type="button" data-k="0.65">Medium</button><button type="button" data-k="1">High</button></div>
      </div>
      <div class="rs-firehud rs-lighthud" hidden role="dialog" aria-label="The light switch">
        <button type="button" class="rs-firehud-x rs-lighthud-x" title="Close (Esc)" aria-label="Close">×</button>
        <b class="rs-firehud-name">Lights</b>
        <button type="button" class="rs-lightrocker" aria-pressed="true" title="On or off (L)">On</button>
        <input type="range" class="rs-dim" min="10" max="100" step="5" value="100" title="Dim the lights (- and =)" aria-label="How bright the lights are">
        <span class="rs-fire-lbl rs-light-lbl">100%</span>
      </div>
      ${footDockHTML()}
      <!-- the controls tip is off for now (too much text); drop rs-tip-gone and hidden to bring it back -->
      <div class="rs-tip rs-tip-gone" hidden>WASD to walk, Shift to run, C to crouch · drag to look, Q and E to turn · face something or click it to see what you can do: F or a number picks · the switch by the door has the lights: L, - and = · click a fire's dial to set it, or , and . · F on a set you're looking at turns it on or off, and [ and ] or the wheel on its picture change the channel · I for your pack, to dress, undress, eat and drink, and P for what you can eat and drink · G to tag the wall you're facing, with a can on you · T for your tablet</div>
    </div>`;
  // into the game pane, over the room text, which stays underneath for when the Stage closes
  const pane = document.getElementById('area-content');
  if (pane) root.style.fontSize = getComputedStyle(pane).fontSize;
  (pane || document.body).appendChild(root);
  if (!pane) root.classList.add('rs-alone');
  document.body.classList.add('room-stage-on');
  bindSeatLadder(root);
  const host = root.querySelector('.rs-host'), phone = matchMedia('(pointer: coarse)').matches;
  // the spare canvas made after the last room closed (warmSpares), its programs compiled by now, when it was made
  // for the same kind of room: one that sees out through its panes or one that doesn't
  const seeEarly = (!phone && !!msg.hasView) || !!msg.spec?.rink || !!msg.building?.neighbours?.some((n) => n.spec?.rink);
  const spare = takeSpare(seeEarly);
  if (spare) { spare.className = 'rs-canvas'; root.querySelector('.rs-canvas').replaceWith(spare); }
  const canvas = root.querySelector('.rs-canvas');
  // ⚠ UP FIRST, BEFORE ANYTHING IS BUILT: everything below runs in this one task, and a veil put up after it was a
  // second of the room text with nothing over it. (The Room button and 'room' put one up sooner still, dispatch.js
  // roomOpening, and this takes it over where it stands.)
  // the GLASS loading screen, up until the room is drawn and the view out of it is in
  // (not when you've just walked in from the next room of the building: that's a step, not a load)
  // ⚠ THE VEIL WAITS FOR ONE PAINT OF THE CITY, AND NOT LONG FOR THAT. It waited for nine (`painted`, past the
  // provisional floor), which from a lobby took longer than the veil's own 25 s cap: the room sat behind a loading
  // screen with nothing wrong with it. A room with no glass doesn't wait for the city at all, and after VEIL_MS the
  // room shows anyway and the city comes in behind its glass when it's ready.
  // ⚠ AND IT WAITS FOR THE CITY IN A ROOM WITH NO GLASS TOO: the view out is the same one the next room shows, so
  // it is built and placed under the veil, not popped in at the first window.
  // ⚠ THE CAP IS THE COVER'S OWN (glass-veil.js COVER_MAX_MS, 25 s), NOT 10 s. At 10 s a cold city lifted the veil
  // half built, and the rest (first paint, then warmOpen's four quarter turns) froze the open room for 10 to 15 s.
  // A slow load belongs behind the loading screen; a fast one still lifts the moment the city is in.
  const opened = performance.now(), VEIL_MS = msg.hasView && !phone ? 24000 : 4000, STREET_VEIL_MS = 24000;
  // The veil also covers the rooms past the doorways being built (`bake`, below), so the loading is done once, here,
  // and not at each door. VEIL_MS caps that too; whatever is left is built between frames once the room is up.
  let veiled = !msg.via;
  if (!msg.via) coverWithVeil(host, 'room-stage', { place: roomVeilPlace(msg), ready: () => {
    const seen = !msg.hasView || phone || ui?.S?.outlook?.shown || ui?.S?.noView;
    // and for the Vat Hall's fluid to settle (gl/room-vat.js settled): its first frames flashed black and white
    const vats = !ui?.R?.vatLayer?.() || ui.R.vatLayer().settled();
    // and for the street outside, when it was asked for (warmStreet): built after the veil, it froze your first steps
    const street = !ui?.S?.streetAsked || streetWarm();
    const cap = ui?.S?.streetAsked ? STREET_VEIL_MS : VEIL_MS;
    const up = performance.now() - opened > cap || (!!seen && vats && street && !ui?.S?.bake?.owed());
    if (up) veiled = false;
    return up;
  } });
  // in off the street the veil is the door's (freelook-view.js coverPane): it gets the room's name and street now
  else placeVeil('room-stage', roomVeilPlace(msg));
  // with a view out, the room is drawn over a live GLASS view and its panes are holes (room-outlook.js); and a room at a
  // rink, or next door to one, is drawn over the ice itself, on a phone too (room-rink.js)
  const rinky = !!msg.spec?.rink || !!msg.building?.neighbours?.some((n) => n.spec?.rink);
  const phone0 = phone, see = (!phone0 && !!msg.hasView) || rinky;
  // the view's renderer starts loading now, beside the room's own build, unless this building's view is parked for us
  if (see && !(parkedView && parkedView.building === msg.building?.id)) warmOutlook();
  const R = createRoomRenderer(canvas, { phone, see });
  if (!R) {
    // the veil went up first; with nothing to draw there's nothing to wait for
    const v = document.getElementById('room-stage-veil');
    (v?.parentElement?.classList.contains('ws-veil-pre') ? v.parentElement : v)?.remove();
    host.innerHTML = '<p class="rs-none">This device can\'t draw the room in 3-D (no WebGL2). Everything in it is in the room text.</p>';
    root.querySelector('.rs-leave').addEventListener('click', () => closeRoomStage());
    ui = { root, stop() {} };
    return;
  }
  let seed = hashOf(msg.zone);
  // the rooms one doorway away, seen through it (docs/proposals/building-stage.md): each laid out with
  // its own furniture from where it stands as seen from here, and built as a shell, with its own seed
  // so it looks the same once you're in it. Built again only when a piece there comes or goes
  // (`room_piece` for that room); the people in them are drawn with this room's (bodiesNow)
  const neighboursOf = (m) => (m.building?.neighbours || []).map((n) => ({ ...n, pieces: n.pieces || [], people: n.people || [], L: null }));
  let nextDoor = neighboursOf(msg), joined = new Set(nextDoor.map((n) => n.zone));
  // shells and the bake keys they were built under, in order; reshell() sets both, so both are declared before it runs
  let shells = [], shellKeys = [];
  // ⚠ A ROOM NEXT DOOR IS LIT BY ITS OWN LAMPS (gl/room-light.js). It used to be lit by this room's, through the
  // wall, so it was dim from the doorway and jumped to its own light as you stepped in. Each shell gives its box
  // on the ground and its two strongest lamps, turned up to stand for all of them; the renderer has room for
  // four rooms, so the frame sends the four nearest (nextLit).
  const boxOf = (L, pad) => { const c = [[-L.w / 2, 0], [L.w / 2, 0], [L.w / 2, L.d], [-L.w / 2, L.d]].map(([u, v]) => L.world(u, v, 0)); return [Math.min(...c.map((p) => p[0])) - pad, Math.max(...c.map((p) => p[0])) + pad, Math.min(...c.map((p) => p[2])) - pad, Math.max(...c.map((p) => p[2])) + pad]; };
  let nextLight = [];
  const nextLightOf = (L, m) => {
    const all = (m.lamps || []).filter((l) => !l.annex).sort((a, b) => (b.k ?? 1) - (a.k ?? 1)), pick = all.slice(0, 2);
    if (!pick.length) return null;
    const sum = (list) => list.reduce((s, l) => s + (l.k ?? 1), 0), up = Math.min(2.5, sum(all) / sum(pick));
    return { box: boxOf(L, 0.03), lamps: pick.map((l) => ({ ...l, k: (l.k ?? 1) * up })) };
  };
  const reshell = () => {
    nextLight = [];
    const keys = [];
    shells = nextDoor.map((n) => {
      try {
        n.L = roomLayout(n.spec, n.pieces);
        const rk = roomKey(n.spec, n.pieces), so = { seed: hashOf(n.zone), lampOn: litOf(n.zone, n.power), joined: new Set([msg.zone]), shell: true };
        const m = bakedMesh(rk, n.L, so), lit = so.lampOn ? nextLightOf(n.L, m) : null;
        if (lit) nextLight.push(lit);
        keys.push(bakeKey(rk, so));
        return m;
      } catch (e) { console.error('[room] the next room', n.zone, e); return null; }
    }).filter(Boolean);
    shellKeys = keys;
  };
  // The four lit rooms nearest the eye, leaving out any whose box lies over this room's own (a lift car inside a
  // lobby's rectangle), which this room's lamps light as before.
  const nextLit = (L, eye) => {
    if (!nextLight.length) return null;
    const h = boxOf(L, -0.05), far = (b) => Math.hypot(Math.max(b[0] - eye[0], 0, eye[0] - b[1]), Math.max(b[2] - eye[2], 0, eye[2] - b[3]));
    const out = nextLight.filter(({ box: b }) => !(b[0] < h[1] && b[1] > h[0] && b[2] < h[3] && b[3] > h[2]));
    return out.length > 4 ? out.sort((a, b) => far(a.box) - far(b.box)).slice(0, 4) : out;
  };
  reshell();
  // `S.key` is the room `S.L` was laid out from (rebuild), so a mesh is never kept under pieces it wasn't built with
  // ⚠ A ROOM AHEAD IS COMPOSED AND UPLOADED BEFORE THE DOORWAY (S.ahead, compose). Copying the kept mesh, adding its
  // shells and uploading it were the 15 to 45 ms a crossing still cost; the composed mesh is kept here under its own
  // key and the shells' keys in order, and the renderer holds its upload (R.prepareRoom), so the crossing only swaps.
  // A key that doesn't match (a piece moved, the shells came in another order) composes here as before.
  const composed = new Map();
  const composeKey = (key, shellKeys) => key + '#' + shellKeys.join('#');
  const roomMesh = (L, opts) => {
    // (a plain flat's front door stands open while somebody goes through it: watchMoves)
    // (and a balcony room's outside in its building's own paint: takeFacade)
    const o = { ...opts, joined, ...(S.morphPod != null ? { busy: S.morphPod } : {}), ...(S.frontOpen ? { frontOpen: true } : {}), ...(S.drapes ? { drawn: true } : {}), ...(S.facade && L.spec?.balcony ? { facade: S.facade } : {}) }, ck = composeKey(bakeKey(S.key, o), shellKeys);
    const c = shells.length ? composed.get(ck) : null;
    if (c) return c;
    const m = bakedMesh(S.key, L, o);
    return shells.length ? withShells(meshCopy(m), shells) : m;
  };
  const paint = (key) => {
    const tk = key === ROOM_RUG ? key + '|' + seed : key;
    let c = paintedTex.get(tk);
    if (c) { paintedTex.delete(tk); paintedTex.set(tk, c); }
    if (!c) {
      c = paintRoomTexture(document, key, key === ROOM_RUG ? seed : 1); paintedTex.set(tk, c);
      if (paintedTex.size > PAINTED_MAX) paintedTex.delete(paintedTex.keys().next().value);
      // a Cup's engraving painted before its face loaded is painted again in it, and sent up again (gl/room-cup.js)
      if (c.cupLate) loadFace(CUP_FACE).then((ok) => { if (ok) { paintCupRoll(document, key, c); R.retexture?.(key, c); } });
    }
    return c;
  };
  // ⚠ THE LIGHTS ARE ON UNLESS THE ROOM HAS NO POWER OR THEY'VE BEEN SWITCHED OFF IN IT. The switch and the dimmer are
  // this viewer's, kept per room (switchOf); `power` is the mains, from the server (plugins/roomstage powerOf).
  // `lampOn` is what's drawn: the switch and the mains together.
  let { on: switchOn, level: lampLevel } = switchOf(msg.zone);
  let power = msg.power || 'on';
  let lampOn = switchOn && power !== 'off';

  const glassy = (s) => !!(s && !s.windowless && (s.windows?.length || s.balcony));
  // A balcony room keeps its own building in the view out, less its own spot in it (room-view.js roomCut). Rides
  // every place the view is moved to, so a room without one takes the tower off its tile as before.
  const balconyCut = (s) => (s?.balcony ? { w: s.w, d: s.d, h: s.h, deck: s.balcony.d || 0, wrap: s.balcony.wrap ? (s.balcony.sides ? 'sides' : 'all') : null,
    sides: (s.windows || []).some((q) => q.wall === 'left' || q.wall === 'right') } : null);

  const outside = createRoomWindow();
  const hearing = createRoomSound();
  // a pet cat (plugins/pets): its carves on the GPU, its bones each frame, its voice where it is (gl/room-beasts.js catsFrame)
  // the coat's shells, in triangles drawn: a fluffy cat's long fur wants about six layers over all of it
  const catDraw = catDrawer(R, { furBudget: phone ? 60000 : 480000 }), catVoice = createCatSound();
  const outdoors = createRoomOutdoors();   // the birds and the shore round the building, for `hearing`
  const pilots = makeContactTrack(), flights = makeContactTrack();
  // what's really flying is heard as well as drawn, phone included (frame(0, 0) keeps absolute tiles)
  outside.hearPilots(() => pilots.frame(0, 0));
  const S = { msg, spec: msg.lift ? { ...msg.spec, lift: msg.lift } : msg.spec, pieces: msg.pieces || [], people: msg.people || [], beasts: msg.beasts || [], next: nextDoor, reshell, L: null, mesh: null, walk: null, screenOn: new Set(), you: msg.you,
    here: msg.here || msg.zone, moving: null, outlook: null, lens: null, bearing: 0, phone };
  // THE SHUTTERS OVER THE GLASS (gl/room-shutters.js, plugins/envcontrol): as they are when the room opens, and they
  // move when `room_glass` says so
  S.glass = msg.glass || null;
  // water that moves (gl/room-plumbing.js, plugins/bodily): a running shower, a toilet's bowl, a stream into it
  S.plumb = msg.plumbing || null;
  // PAINT ON THE WALLS (room-tags.js, plugins/graffiti `room.tags`): what's sprayed here, and while the spray session is
  // up, the piece going on as it goes (`sprayLive`: { spot, src, fresh })
  S.tags = msg.tags || [];
  S.sprayLive = null;
  // SHEETS HUNG AS A RUN (room-sheets.js, plugins/posters `room.sheets`), and the join while it plays (`scene`)
  S.sheets = msg.sheets || [];
  S.scene = null;
  S.shutters = createShutters();
  // a sash window's drapes drawn (plugins/envcontrol 'drapes') are in the mesh, not on the glass: the shutters stay up
  S.drapes = drapesDrawn(S.glass);
  S.shutters.set(glassCover(S.glass), { snap: true });
  const seat = { eye: [0, 1.6, 0], yaw: Math.PI, pitch: 0, fov: 72, mode: 'free' };
  // THE LOCKS ON THIS ROOM'S DOORWAYS (room-lock.js, docs/proposals/room-hololock.md): a door in each, shut to
  // whoever the lock doesn't know, and a hologram off its reader that offers Unlock and Hack. The server says how
  // each stands (`locks` here, `room_locks` as they change); the verbs it offers are the ones you'd type.
  S.locks = msg.locks || [];
  // a vending machine you can pull out from the wall (room-vendor.js): drawn into the locks' layer beside the doors
  const vendorUi = createRoomVendor({ project: (p, w, h) => R.project(p, w, h) });
  S.vendor = vendorUi;
  const EMPTY_BATCH = { data: new Float32Array(0), n: 0 };
  function pushLocks() {
    const a = S.lockBatch || EMPTY_BATCH, v = vendorUi.batch();
    if (!v.n) { R.setLocks(a); return; }
    // one scratch, grown only: the upload reads the first n vertices, and copies them to the GPU there and then
    const need = (a.n + v.n) * 12;
    if (!(pushLocks.scratch?.length >= need)) pushLocks.scratch = new Float32Array(Math.max(need, (pushLocks.scratch?.length || 0) * 2));
    const data = pushLocks.scratch;
    data.set(a.data.subarray(0, a.n * 12)); data.set(v.data.subarray(0, v.n * 12), a.n * 12);
    R.setLocks({ data, n: a.n + v.n });
  }
  const lockUi = createRoomLocks({ host, project: (p, w, h) => R.project(p, w, h), setBatch: (b) => { S.lockBatch = b; pushLocks(); },
    send: (cmd) => { S.listenUntil = performance.now() + 2500; sendCmd(cmd); },
    // a hand-opened glass pair's panel beside it: Open and Close work the leaves here, as F at the doors does
    glass: (to, a) => handDoor(to, { verb: a.verb === 'open' ? 'opendoors' : 'shutdoors' }) });
  // the server's locks, and a door panel for each hand-opened glass pair (no lock on it: Open and Close only)
  const glassPanels = () => (S.spec?.openings || []).filter((o) => o.slide && o.hand && o.to && o.dir && !o.lift)
    .map((o) => ({ to: o.to, dir: o.dir, glass: true, lock: false, locked: false, pass: true, yours: true, hack: false, open: (S.slideShut?.[o.to] ?? 1) < 0.5 }));
  const locksWithGlass = () => [...(S.locks || []).filter((k) => !k.glass), ...glassPanels()];
  // a lift car's panel: the same kind of hologram, with a button for each floor (room-lift.js)
  const liftUi = createRoomLift({ host, project: (p, w, h) => R.project(p, w, h), press: (n) => pressFloor(n) });
  // a depot shed's lift and the truck on it (room-hoist.js); nothing in any other room
  // a flat's control panel: its OS laid on the panel's own glass, worked from where you stand (room-envctl.js)
  const envUi = createRoomEnvctl({ host, project: (p, w, h) => R.project(p, w, h) });
  const hoistUi = createRoomHoist({ host, send: (cmd) => sendCmd(cmd), walker: () => S.walk?.at || null, project: (p, w, h) => R.project(p, w, h) });
  hoistUi.load(null, msg.vehicles?.machine ? null : msg.vehicles || null);
  // a stadium's rooms: the last champion's board, the ice under a room at the rink, the resurfacer in its bay (room-stadium.js)
  const stadium = createRoomStadium({ R, host });
  stadium.setMsg(msg);
  // your tickets, for a seat door's card (plugins/stands `tickets` on room_view, then room_tickets)
  S.tickets = msg.tickets || [];
  // the car's doors: { from, to, t0 } between 0 (open) and 1 (shut). Arriving off a ride, they start
  // shut and part a beat after the room is drawn
  const doorsAt = () => {
    const arrived = msg.ride && liftRide?.car === msg.zone;
    S.doors = arrived ? { from: 1, to: 0, t0: performance.now() + DOORS_WAIT_MS } : { from: 0, to: 0, t0: 0 };
    if (arrived || liftRide?.car !== msg.zone) liftRide = null;
    S.doorsDirty = true;
  };
  doorsAt();
  let syncing = false, raf = 0, lastHour = -1;
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256; screenCanvas.height = 192;

  // the room's light from the server's clock: the hour now, and how much day comes through the glass
  const hourNow = () => { const c = msg.clock; if (!c) return 13; return ((c.hour + (Date.now() - c.hourMs) / 3.6e6 * (c.rate || 1)) % 24 + 24) % 24; };
  setScreenHour(hourNow());
  const dayOf = lightAt;   // the shared sky (sky-keys.js)
  const skyOf = (h) => {
    const d = dayOf(h), dusk = Math.exp(-(((h - 19) / 1.2) ** 2)) + Math.exp(-(((h - 6.3) / 1.0) ** 2));
    return [0.55 + 0.4 * d + 0.4 * dusk, 0.6 + 0.35 * d + 0.1 * dusk, 0.85 + 0.15 * d - 0.2 * dusk];
  };

  // Where you stand coming in from outside: just inside the street door, the way you came in off the street. A depot's
  // shed has no street-door opening, so it's just inside its roller door, clear of the lift. The old default stood
  // you at the back wall, which in a depot was a corner boxed in by its benches. Moved to the nearest free spot.
  function entryStand(L) {
    // just inside the room's way in: its street door, else its main doorway (one that isn't a bathroom's; with
    // several, the first). ⚠ Not the spec's own `door` first: on a building's walk that's a flat's default back corner,
    // where there's often no door at all, and you stood in an empty corner (Solenne B)
    const bath = (o) => /bath|ensuite|en_suite|shower|toilet|_wc\b|lavatory/i.test(String(o.to || ''));
    const ways = doorwaysOf(S.spec).filter((o) => o.kind !== 'stair');
    const front = (S.spec.openings || []).find((o) => o.kind === 'front') || ways.find((o) => !bath(o)) || ways[0];
    let st = front ? openingInside(L, front) : null;
    if (!st) {
      const bay = (L.spec?.bay || S.spec.bay) === 'truck';
      const at = bay ? [0, 1.8] : [((S.spec.door?.[0] ?? 0.7) + (S.spec.door?.[1] ?? 1.6)) / 2, S.spec.d - 0.6];
      const p = L.world(at[0], at[1], 0), q = L.world(at[0], at[1] + (bay ? 1 : -1), 0);
      st = { at, yaw: bay ? Math.atan2(q[0] - p[0], q[2] - p[2]) : Math.atan2(L.f[0], L.f[2]) };
    }
    if (!roomFree(L, st.at[0], st.at[1])) { const n = roomNearFree(L, st.at[0], st.at[1], 3); if (n) st = { ...st, at: n }; }
    return st;
  }
  // the layout and the mesh, from the spec and the pieces; again whenever a piece comes or goes
  function rebuild(keepPlace = true, hold = null, keys = null) {
    // arranging, the room is drawn from the draft (room-arrange.js apply): S.pieces stays the server's
    const wd = S.wallDrag?.kind === 'piece' ? S.wallDrag : null;
    const pieces = S.arrange?.on ? S.arrange.apply(S.pieces) : wd ? S.pieces.map((p) => (p.id === wd.id ? { ...p, spot: wd.spot } : p)) : S.pieces;
    const L = roomLayout(S.spec, pieces);
    const was = S.walk ? { at: S.walk.at, sat: S.walk.sat } : null;
    // walked in from the next room: just inside the doorway you came through, facing in
    const via = !was && msg.via ? (S.spec.openings || []).find((o) => o.to === msg.via) : null;
    const arrive = via ? openingInside(L, via) : null;
    S.L = L; S.key = roomKey(S.spec, pieces);
    hoistUi.load(L);
    vendorUi.load(L);
    stadium.load(L);
    envUi.load(L);
    S.mesh =roomMesh(L, { seed, lampOn, doorShut: S.doorShut, turning: S.spin?.turning, swinging: S.fridge?.id });
    R.setRoom(S.mesh, paint);
    paintTags();
    if (S.fridge) S.fridge.swing = S.mesh.swing || null;
    S.doorsDirty = true;
    // (a new room starts its doors shut, but for the one you came through; the same room keeps them where they are)
    lockUi.load(L, locksWithGlass(), { fresh: !keepPlace, via: msg.via || null });
    // in a car, its own panel; on a landing, the panel of the car next door, so it's there before you step in
    const car = S.spec.lift ? null : nextDoor.find((n) => n.lift && n.L);
    if (car) liftUi.load(car.L, { ...car.spec, lift: car.lift }, true); else liftUi.load(L);
    if (S.spin) S.spin.mesh = S.mesh.spin;
    // the keys held go to the new walker, or walking stops dead each time the room is built again
    // (in off the street, the keys held on the street: lobby-still.js)
    const carry = keys || S.walk?.keys?.() || (!S.walk ? takeCarry() : null);
    S.walk?.stop();
    // ⚠ SAT, YOU STAY SAT. A rebuild (a piece on the table changing, a card dealt) used to start the new walker on its
    // feet at the chair's spot, so you stood in your seat until something sat you again. The same seat in the new
    // layout: the same piece, nearest where it was.
    const reseat = keepPlace && !hold && was?.sat
      ? L.seats.filter((s) => s.piece === was.sat.piece && !!s.lie === !!was.sat.lie).sort((a, b) => Math.hypot(a.u - was.sat.u, a.v - was.sat.v) - Math.hypot(b.u - was.sat.u, b.v - was.sat.v))[0] || null
      : null;
    // a set in the room takes the TV's calls for as long as the room's open
    if (!S.tv && S.mesh.screens.length) S.tv = createWallTv(host, { onChange: showChannel });
    // seated again quietly: the server already has you in that chair, so no `sit` goes out
    syncing = !!reseat;
    try { S.walk = createRoomWalk({
      L, seat, pane: root, label: 'ROOM', carry,
      project: (p, w, h) => R.project(p, w, h),
      setMode: (m) => { seat.mode = m; },
      onStation: useStation,
      onUse: () => { const a = S.card?.acts[0]; if (a) runAct(a); return !!a; },
      aimable: (id) => reachable(S.pieces.find((p) => p.id === id)),
      // a piece's tag only when the eye can see it: the point is drawn half a foot toward the eye, so a piece
      // hung on a wall (its station in the plaster) isn't hidden by the wall it's on
      sees: (u, v) => {
        const e = seat.eye ? L.local(seat.eye) : S.walk?.at;
        if (!e) return true;
        const du = e[0] - u, dv = e[1] - v, n = Math.hypot(du, dv), k = n > 1e-6 ? Math.min(n, 0.5 * (L.ft || 1)) / n : 0;
        return roomSees(L, e, [u + du * k, v + dv * k]);
      },
      canSit: (s) => !takenBy(s),
      // a shut door is a wall: a lock's leaves (room-lock.js fence), and the en-suite's plain door with somebody in
      // there. The balcony's glass door slides open as you come up to it, shutters down or not, so nothing fences it.
      fence: (from, to) => lockUi.fence(from, to) || annexFence(from, to),
      onSit: (s) => {
        if (syncing) return;
        const piece = S.pieces.find((p) => p.id === s.piece);
        // a seat with its own verb sends that (a toilet's is 'poop'), so the Stage never asks the server to `sit` on it
        // a card table's chairs all share a name, so one of those is named by its id, or the server seats you in
        // the first and your cards stay there (plugins/interactions maybeSitAtPoker)
        const gameChair = S.pieces.some((q) => q.board?.chairs && Object.values(q.board.chairs).includes(s.piece));
        if (piece && gameChair && !s.lie) sendCmdSilent(`sit ${piece.id}`);
        else if (piece) sendCmd(`${s.lie ? 'lie' : s.verb || 'sit'} ${piece.name}`);
        sendRaw({ type: 'room_pos', at: [s.u, s.v], yaw: s.yaw, seat: L.seats.indexOf(s) });
      },
      onStand: () => { if (!syncing) sendCmd('stand'); },
      onSettle: (at, yaw) => sendRaw({ type: 'room_pos', at, yaw, seat: S.walk?.sat ? L.seats.indexOf(S.walk.sat) : null }),
      // in by the door, facing into the room
      start: hold ? hold : reseat ? reseat : keepPlace && was?.at ? { at: was.at, yaw: seat.yaw } : arrive ? arrive : S.here !== msg.zone && L.annex ? { at: annexStand(L), yaw: Math.atan2(-L.f[0], -L.f[2]) } : entryStand(L),
    }); } finally { syncing = false; }
    followSelf();
  }

  // where you stand on each side of the en-suite's door
  const annexStand = (L) => [(L.spec.annex.door[0] + L.spec.annex.door[1]) / 2, L.annex.v0 + 0.6];
  const roomStand = (L) => [(L.spec.annex.door[0] + L.spec.annex.door[1]) / 2, L.d - 0.6];

  // crossing the en-suite's threshold is the verb `in` or `out`: sent once, and held until the server
  // says which side of the door you're on
  function watchDoor(now) {
    const L = S.L, w = S.walk;
    if (!L?.annex || !w?.at) return;
    if (S.moving) {
      if (now - S.moving.t < 1800) return;
      // no answer: it didn't let you through
      const back = S.moving.to === msg.zone ? annexStand(L) : roomStand(L);
      S.moving = null;
      w.moveTo(back);
      flash("The door won't let you through.", false);
      return;
    }
    // ⚠ PAST THE BACK WALL ISN'T ALWAYS THE EN-SUITE. A building's doorway can be in the same wall (Solenne 30-B's
    // west door), and stepping through it sent `in` and `west` in one frame. Only the en-suite's own width counts,
    // and not while a doorway is being crossed.
    if (S.going || openingCrossed(L, w.at)) return;
    const A = L.annex, inSpan = !Number.isFinite(A.u0) || (w.at[0] > A.u0 - 0.15 && w.at[0] < A.u1 + 0.15);
    const want = !inAnnex(L, w.at[1], w.at[0]) ? msg.zone : inSpan ? S.spec.annex.zone : S.here;
    if (want === S.here) return;
    // the en-suite's privacy door (room-lock.js): bolted against you, you're put back; shut, it slides first
    const gate = lockUi.enter(want);
    if (gate === 'no') { w.moveTo(want === msg.zone ? annexStand(L) : roomStand(L)); return; }
    if (gate === 'wait') return;
    S.moving = { to: want, t: now };
    sendCmd(want === msg.zone ? 'out' : 'in');
  }

  // A building's doorway to the next room (docs/proposals/building-stage.md): stepping through it is the
  // verb `move <dir>`, sent once. The server answers with the next room's `room_view`, which reopens
  // the Stage there; with no answer the door didn't let you through, and you're put back inside it.
  // A spot in a doorway brought back to just short of where it counts as through, the same distance along the wall.
  // (a stair's is just short of the line on its flight where you'd have gone up or down: room-layout.js heldShort)
  const heldAtDoor = heldShort;
  // how far past a doorway's wall face a spot is, out of the room, or along a flight past where it takes you
  const pastDoor = openingPast;
  function watchDoorways(now) {
    const L = S.L, w = S.walk;
    if (!L?.spec.openings || !w?.at || w.sat || S.leaving) return;
    if (S.going) {
      if (now - S.going.t < 1800) return;
      const o = S.going.o, back = heldAtDoor(L, o, w.at);
      S.going = null;
      w.moveTo(back);
      flash(o.kind === 'stair' ? `You can't get ${o.dir} the stairs.` : "The door won't let you through.", false);
      return;
    }
    const o = openingCrossed(L, w.at);
    // ⚠ JUST THROUGH FROM THE NEXT ROOM, YOU'RE STILL IN THIS ROOM'S WALL. The two rooms' walls stand back to back,
    // so the spot where the last room called you through is 0.2 m short of where this one calls you in. Arriving
    // there used to jump you forward to this room's side of the line, every crossing a quick server answered. Now
    // you arrive where you stood, and it isn't the step back unless you turn round and go further out than you came.
    if (S.came) {
      const past = o && o.to === S.came.to ? pastDoor(L, o, w.at) : null;
      if (past === null || past > S.came.past + 0.03) S.came = null;
      else { S.came.past = Math.min(S.came.past, past); return; }
    }
    if (!o) return;
    // ⚠ A SHUT DOOR HOLDS YOU WHERE YOU STAND. A lift's doors, glass doors that haven't parted and a door that's
    // locked or still sliding back (room-lock.js) all used to differ: the first two put you back in the middle of
    // the doorway, every frame you kept walking at them, which read as being snapped back over and over until they
    // opened. Held at the door, the same distance along the wall, it's a door you've walked into and not a jump.
    if (L.spec.lift && (S.liftShut || 0) > 0.05) { w.moveTo(heldAtDoor(L, o, w.at)); return; }
    if (o.slide && (S.slideShut?.[o.to] ?? 0) > 0.35) { toldDoorShut(o); w.moveTo(heldAtDoor(L, o, w.at)); return; }
    if (lockUi.enter(o.to) !== 'go') { w.moveTo(heldAtDoor(L, o, w.at)); return; }
    S.going = { o, t: now };
    sendCmd(o.dir);
  }

  // The en-suite's door: shut behind a resident in there, and it stays shut till they come out. It used to give as
  // you came up to it; a bathroom door doesn't open itself. One remesh each way, as the lights are.
  function watchAnnexDoor() {
    const L = S.L, door = S.spec.annex?.door;
    if (!L?.annex || !door) return;
    // a privacy door drawn as a lock (room-lock.js) is the door; the plain leaf is for an en-suite without one
    const shut = !S.locks?.some((k) => k.annex) && S.people.some((p) => p.npc && p.shut);
    if (shut === !!S.doorShut) return;
    S.doorShut = shut;
    S.mesh = roomMesh(L, { seed, lampOn, doorShut: shut, turning: S.spin?.turning, swinging: S.fridge?.id });
    R.setRoom(S.mesh, paint);
    if (S.spin) S.spin.mesh = S.mesh.spin;
  }
  // that plain door, shut, as a wall: a step past the back wall's face inside its width, from short of the leaf,
  // stops where the wall beside it would have (room-lock.js fence does the same for a lock's leaves)
  function annexFence(from, to) {
    const L = S.L, door = S.spec.annex?.door;
    if (!S.doorShut || !L?.annex || !door || to[0] < door[0] - 0.05 || to[0] > door[1] + 0.05) return false;
    const p = to[1] - L.d, p0 = from[1] - L.d;
    if (p <= -0.9 * (L.ft || 1) || p <= p0 || p0 >= WALL_T / 2) return false;
    const now = performance.now();
    if (now - (S.annexBumpT || 0) > 2500) { S.annexBumpT = now; flash("It's shut. Somebody's in there.", false); }
    return true;
  }

  // A Cachet going round: lifted out of the room and turned on the people's layer, then put back as
  // whatever's facing out now.
  S.turn = (piece, was) => { S.spin = { turning: { id: piece.id, from: was, to: piece.form }, t0: performance.now(), mesh: null }; };
  // a heavy part seating home: a low thump, a short knock of metal, a little grit
  function chunk(i) {
    const f = 1 + ((i * 37) % 7 - 3) * 0.04;
    try {
      window.AudioEngine?.playSfx({ id: 'sfx_cachet_chunk', name: 'sfx_cachet_chunk', category: 'sfx', priority: 3, config: { duration: 0.35, layers: [
        { waveform: 'sine', freq: 70 * f, pitchBend: { to: 44 * f, time: 0.12 }, adsr: { a: 0.002, d: 0.16, s: 0, r: 0.08 }, gain: 0.45 },
        { waveform: 'square', freq: 210 * f, filter: { type: 'lowpass', freq: 900, q: 1.2 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.04 }, gain: 0.08 },
        { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1400 * f, q: 1.6 }, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 }, gain: 0.07 },
      ] } }, 0.5);
    } catch { /* silent is still a reveal */ }
  }
  // the mechanism's own noises: the latch letting go and dropping home, and the motor under it
  // A high five's slap and a fist bump's knock, at the moment the two hands meet (actor3d.js highFivePose and
  // fistBumpPose). Only the right-handed half of a pair sounds, so a pair is heard once.
  const CONTACT = {
    highFive: { at: 0.43, id: 'sfx_highfive', dur: 0.18, vol: 0.55, layers: [
      { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 2400, q: 0.9 }, adsr: { a: 0.001, d: 0.05, s: 0, r: 0.04 }, gain: 0.5 },
      { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 900, q: 0.7 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.03 }, gain: 0.3 },
      { waveform: 'sine', freq: 210, pitchBend: { to: 150, time: 0.04 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.15 }] },
    fistBump: { at: 0.45, id: 'sfx_fistbump', dur: 0.14, vol: 0.45, layers: [
      { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 700, q: 0.8 }, adsr: { a: 0.001, d: 0.035, s: 0, r: 0.03 }, gain: 0.4 },
      { waveform: 'sine', freq: 120, pitchBend: { to: 80, time: 0.05 }, adsr: { a: 0.001, d: 0.04, s: 0, r: 0.03 }, gain: 0.3 }] },
  };
  function contactSound(clip, dur) {
    const c = CONTACT[clip];
    if (c) setTimeout(() => cachetSfx(c.id, c.dur, c.layers, c.vol), c.at * dur * 1000);
  }
  function cachetSfx(id, duration, layers, vol = 0.5) {
    try { window.AudioEngine?.playSfx({ id, name: id, category: 'sfx', priority: 3, config: { duration, layers } }, vol); } catch { /* silent is still a reveal */ }
  }
  const latch = (home) => cachetSfx(home ? 'sfx_cachet_lock' : 'sfx_cachet_unlatch', 0.3, [
    { waveform: 'square', freq: home ? 1800 : 2400, filter: { type: 'bandpass', freq: home ? 2200 : 3000, q: 4 }, adsr: { a: 0.001, d: 0.025, s: 0, r: 0.02 }, gain: 0.12 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'highpass', freq: 3500, q: 0.8 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.08 },
    { waveform: 'sine', freq: home ? 90 : 140, pitchBend: { to: home ? 52 : 110, time: 0.1 }, adsr: { a: 0.002, d: 0.14, s: 0, r: 0.06 }, gain: home ? 0.5 : 0.22 },
  ]);
  const motor = (ms) => cachetSfx('sfx_cachet_motor', ms / 1000, [
    { waveform: 'sawtooth', freq: 62, pitchBend: { to: 78, time: ms / 2000 }, filter: { type: 'lowpass', freq: 420, q: 2 }, adsr: { a: 0.35, d: 0.2, s: 0.7, r: 0.5 }, gain: 0.07 },
    { waveform: 'sine', freq: 124, adsr: { a: 0.4, d: 0.2, s: 0.6, r: 0.5 }, gain: 0.05 },
    { waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 700, q: 1.4 }, adsr: { a: 0.5, d: 0.2, s: 0.5, r: 0.5 }, gain: 0.03 },
  ], 0.4);
  // A turntable's half turn, from 0 to 1 over the move: a little kick back as the latch lets go, a slow
  // start for the weight of it, a run, then past home by a few degrees and back as it drops on the latch
  function turnProfile(k) {
    const KICK = 0.08, RUN = 0.86;
    if (k < KICK) return -0.012 * Math.sin(Math.PI * k / KICK);
    if (k < RUN) { const x = (k - KICK) / (RUN - KICK); return 1.025 * (x * x * x * (x * (x * 6 - 15) + 10)); }
    const x = (k - RUN) / (1 - RUN);
    return 1 + 0.025 * Math.cos(1.5 * Math.PI * x) * (1 - x);
  }
  function watchSpin(now) {
    const sp = S.spin;
    if (!sp?.mesh) return;
    const ms = sp.mesh.asm ? ASSEMBLE_MS : SPIN_MS, k = Math.min(1, (now - sp.t0) / ms);
    if (!sp.started) { sp.started = true; latch(false); motor(ms * (sp.mesh.asm ? 0.9 : 0.82)); }
    if (!sp.mesh.asm && !sp.locked && k >= 0.86) { sp.locked = true; latch(true); }
    if (sp.mesh.asm) { const b = assembleBatch(sp.mesh, k); R.setPeople(b); R.setPropsGlass(b.glass); }
    else R.setPeople(spinBatch(sp.mesh, turnProfile(k) * Math.PI));
    // each part that arrives lands with a chunk; parts that land together chunk once
    if (sp.mesh.asm) {
      sp.landed ||= new Set();
      for (const m of sp.mesh.moves) {
        const at = m.land, key = at?.toFixed(2);   // the k each unit locks home at (gl/room-mesh.js assembly)
        if (at == null || k < at || sp.landed.has(key)) continue;
        sp.landed.add(key);
        chunk(sp.landed.size);
      }
    }
    if (k < 1) return;
    if (sp.mesh.asm) R.setPropsGlass(null);
    S.spin = null;
    R.setPeople({ data: new Float32Array(0), n: 0 });
    S.mesh = roomMesh(S.L, { seed, lampOn, doorShut: S.doorShut, swinging: S.fridge?.id });
    R.setRoom(S.mesh, paint);
  }

  // AN OPEN FRIDGE (or freezer, or chest freezer): clicked open, the room is baked once without its doors and
  // they swing out on the props layer (gl/room-mesh.js swingBatch) while its panel is up, then swing shut and
  // go back into the room's mesh. Typing `open fridge` opens the panel as ever; only the click swings it.
  // the forms whose doors or lid swing open (gl/room-mesh.js swingParts), with what's in them drawn behind at how full
  // the server says they are (`fill`, plugins/roomstage fill.js)
  const SWINGS = new Set(['fridge', 'double', 'chest', 'column', 'wardrobe', 'cupboard', 'locker', 'crate']);
  function openFridge(piece) {
    if (!piece || !SWINGS.has(piece.form) || !S.L) return;
    const now = performance.now();
    if (S.fridge && String(S.fridge.id) === String(piece.id)) { S.fridge.want = 1; S.fridge.t0 = now; S.fridge.seen = false; S.fridge.by = null; return; }
    if (S.fridge) shutFridgeNow();
    S.fridge = { id: piece.id, k: 0, want: 1, t0: now, seen: false, swing: null };
    S.mesh = roomMesh(S.L, { seed, lampOn, doorShut: S.doorShut, turning: S.spin?.turning, swinging: piece.id });
    R.setRoom(S.mesh, paint);
    S.fridge.swing = S.mesh.swing || null;
    if (!S.fridge.swing) shutFridgeNow();
  }
  function shutFridgeNow() {
    S.fridge = null;
    if (!S.L) return;
    S.mesh = roomMesh(S.L, { seed, lampOn, doorShut: S.doorShut, turning: S.spin?.turning });
    R.setRoom(S.mesh, paint);
  }
  // open while the container panel is up; shut once it's gone, or if it never came (refused, locked, too far)
  // A resident at the fridge (plugins/roomstage npc-life.js USE_STEPS sends `open` with the piece's id): the same
  // doors swing, open for as long as they stand at it. Yours wins: theirs never shuts a fridge you opened.
  function npcFridge() {
    const p = (S.people || []).find((x) => x.open != null);
    if (!p || S.fridge) return;
    const piece = (S.pieces || []).find((q) => String(q.id) === String(p.open));
    if (!piece) return;
    openFridge(piece);
    if (S.fridge) S.fridge.by = p.id;
  }
  // A resident's hand on the door they've opened (actor3d.js fridgeOpen/fridgeLook hold it in the left): the '…R'
  // mirror when its hinge (gl/room-mesh.js swingParts' `pt`, in the world) is on their right. A lid, or a fridge
  // with no door swung for them (yours is open, or it's a form that doesn't swing), and they rummage instead.
  function fridgeHand(p, pl, clip) {
    if (!clip || !clip.startsWith('fridge')) return clip;
    const f = S.fridge, q = f && String(f.by) === String(p.id) ? f.swing?.parts?.find((x) => !x.lid) : null;
    if (!q || !S.L?.world) return clip === 'fridgeOpen' ? 'reach' : 'rummage';
    const w = S.L.world(pl.at[0], pl.at[1], 0), F = [Math.sin(pl.yaw || 0), Math.cos(pl.yaw || 0)];
    // the body's right, the way the room's r is right of its f
    const c = S.L.r[0] * S.L.f[2] - S.L.r[2] * S.L.f[0], R = c > 0 ? [F[1], -F[0]] : [-F[1], F[0]];
    return (q.pt[0] - w[0]) * R[0] + (q.pt[2] - w[2]) * R[1] > 0 ? clip + 'R' : clip;
  }
  function watchFridge(now) {
    const f = S.fridge;
    if (!f) return;
    if (f.by != null) f.want = (S.people || []).some((x) => x.id === f.by && String(x.open) === String(f.id)) ? 1 : 0;
    // a wardrobe answers with its own panel (plugins/wardrobe `wardrobe_view`)
    const up = !f.by && (S.pack?.wardrobe() === f.id || ['container-panel', 'wardrobe-panel'].some((id) => document.getElementById(id)?.classList.contains('active')));
    if (up) f.seen = true;
    if (!f.by && ((f.seen && !up) || (!f.seen && now - f.t0 > 2500))) f.want = 0;
    const dt = Math.max(0, Math.min(0.1, (now - (f.last ?? now)) / 1000));
    f.last = now;
    // out briskly, back a little slower, as a door is pushed shut
    const step = dt / (f.want ? 0.55 : 0.7);
    f.k = Math.abs(f.want - f.k) <= step ? f.want : f.k + Math.sign(f.want - f.k) * step;
    if (!f.want && f.k <= 0) shutFridgeNow();
  }

  // THE CAR'S DOORS: how shut they are now, eased; drawn on the props layer every frame they move, so
  // the room is never rebuilt for them. Shut, nobody walks through. If the car never went (refused,
  // or the answer was lost), they open again where you are.
  function doorsNow(now) {
    const d = S.doors, k = Math.max(0, Math.min(1, (now - d.t0) / DOORS_MS)), e = k * k * (3 - 2 * k);
    return d.from + (d.to - d.from) * e;
  }
  // THE STREET'S GLASS DOORS (gl/room-mesh.js slideLeaves): they part as you come up to them and close a beat after
  // you've gone, on the props layer as the car's doors do. Come in off the street, they're open behind you.
  // A lift landing's bronze doors work the same way (building-graph.js gives its doorway `slide` and `lift`):
  // shut when you come into the lobby, apart as you walk up to the lift, and open behind you off a ride.
  // Each doorway keeps its own state, keyed by the room it leads to, so the lift doesn't open the street doors.
  // ⚠ A PAIR THAT'S OPENED BY HAND (`hand`, flags.room.street_door) DOESN'T OPEN AS YOU COME UP. It swings shut behind
  // you once you're clear of its leaves, and opens when you open it (F at the doors, doorAim); then it stands open
  // while you're near it and shuts a beat after you've gone, as the automatic ones do.
  const slidesAt = () => {
    S.slideShut = {}; S.slideHold = {}; S.slideDrawn = null; S.slideHand = new Set(); S.glassSig = null;
    for (const o of S.spec.openings || []) {
      if (!o.slide || !o.to) continue;
      S.slideShut[o.to] = msg.via && o.to === msg.via ? 0 : 1;
      if (o.hand) { S.slideHand.add(o.to); if (S.slideShut[o.to] === 0) S.slideHold[o.to] = performance.now() + SLIDE_HOLD_MS; }
    }
  };
  const SLIDE_NEAR = 2.6, SLIDE_HOLD_MS = 1400, SLIDE_OPEN_S = 0.55, SLIDE_SHUT_S = 0.9;
  // a hand-opened pair: how near keeps it open once it is (inside its leaves' sweep, and a step more), how long it
  // waits for you after F, and how near you open it from
  const HAND_NEAR = 1.7, HAND_WAIT_MS = 6000, HAND_REACH = 2.4;
  slidesAt();
  const LIFT_OPEN_S = 1.1, LIFT_SHUT_S = 1.3;
  // how far the balcony door stands open, eased as its leaf is, and half the doorway's width: the shutters'
  // pane over the doorway opens from the right as the one leaf slides left (gl/room-shutters.js uShutDoor)
  const balconyGap = () => {
    const d = S.spec?.balcony?.door;
    if (!d) return null;
    const k = S.slideShut?.balcony ?? 1, e = k * k * (3 - 2 * k);
    return [1 - e, (d[1] - d[0]) / 2];
  };
  function watchSlideDoors(now) {
    const leaves = S.mesh?.slideDoors;
    if (!leaves) return;
    const at = S.walk?.at, p = at ? S.L.world(at[0], at[1], 0) : null;
    const dt = Math.min(0.1, Math.max(0, (now - (S.slideT || now)) / 1000));
    S.slideT = now;
    const shut = [];
    let changed = false;
    for (const l of leaves) {
      if (shut[l.way] !== undefined) continue;
      const lift = !!S.spec.openings?.find((o) => o.to === l.to)?.lift, hand = S.slideHand?.has(l.to);
      const near = p && Math.hypot(p[0] - l.at[0], p[2] - l.at[1]);
      // by hand, nearness only keeps open what's open already (so the leaves never swing shut through you)
      if (near != null && (hand ? near < HAND_NEAR && (S.slideHold[l.to] || 0) > now : near < SLIDE_NEAR)) S.slideHold[l.to] = Math.max(S.slideHold[l.to] || 0, now + SLIDE_HOLD_MS);
      const want = (S.slideHold[l.to] || 0) > now ? 0 : 1, k = S.slideShut[l.to] ?? 1;
      const step = dt / (want < k ? (lift ? LIFT_OPEN_S : SLIDE_OPEN_S) : (lift ? LIFT_SHUT_S : SLIDE_SHUT_S));
      const next = Math.abs(want - k) <= step ? want : k + Math.sign(want - k) * step;
      if (next !== k) changed = true;
      S.slideShut[l.to] = next;
      shut[l.way] = next * next * (3 - 2 * next);
    }
    // a glass pair's panel reads OPEN or CLOSED as its leaves pass halfway
    if (changed && S.slideHand?.size) { const sig = [...S.slideHand].map((t) => ((S.slideShut[t] ?? 1) < 0.5 ? 1 : 0)).join(''); if (sig !== S.glassSig) { const first = S.glassSig == null; S.glassSig = sig; if (!first && S.L) lockUi.load(S.L, locksWithGlass(), { fresh: false }); } }
    if (!changed && S.slideDrawn && !S.doorsDirty) return;
    S.doorsDirty = false; S.slideDrawn = true;
    R.setProps(liftDoorBatch(leaves, shut));
  }
  // The hand-opened pair you're facing, within reach, as a card: Open the doors while they're shut, Shut them while
  // they stand open. The card's piece carries `door` (the room they lead to), so runAct hands it to handDoor.
  const doorCards = new Map();
  function doorAim() {
    const leaves = S.mesh?.slideDoors;
    if (!leaves || !S.slideHand?.size || !seat.eye) return null;
    const fx = Math.sin(seat.yaw || 0), fz = Math.cos(seat.yaw || 0);
    let best = null, score = Infinity;
    for (const to of S.slideHand) {
      const mine = leaves.filter((l) => l.to === to);
      if (!mine.length) continue;
      const mx = mine.reduce((s, l) => s + l.at[0], 0) / mine.length, mz = mine.reduce((s, l) => s + l.at[1], 0) / mine.length;
      const vx = mx - seat.eye[0], vz = mz - seat.eye[2], d = Math.hypot(vx, vz) || 1;
      if (d > HAND_REACH || (vx * fx + vz * fz) / d < 0.5 || d >= score) continue;
      score = d; best = to;
    }
    if (!best) return null;
    const open = (S.slideShut[best] ?? 1) < 0.5, key = best + (open ? ':open' : ':shut');
    let c = doorCards.get(key);
    if (!c) doorCards.set(key, c = { id: 'door:' + key, name: 'Front doors', door: best, doorActs: [open ? { verb: 'shutdoors', label: 'Shut the doors' } : { verb: 'opendoors', label: 'Open the doors' }] });
    return c;
  }
  // A sash window's drapes in reach and in front of you: F draws them or opens them, by hand, with the
  // ordinary `curtains` verb (plugins/envcontrol), whatever the panel has them set to.
  const curtainCards = new Map(), CURTAIN_REACH = 3.2;
  function curtainAim() {
    const L = S.L, spec = S.spec;
    if (!L || !spec || !seat.eye) return null;
    // in the world, as doorAim does: the nearest of a few points along each draped window, in reach and ahead
    const fx = Math.sin(seat.yaw || 0), fz = Math.cos(seat.yaw || 0);
    let near = Infinity, best = -1;
    for (const q of spec.windows || []) {
      if (!q.drapes) continue;
      for (let k = 0; k <= 6; k++) {
        const [u, v] = paneAt(spec, q, q.a + (q.b - q.a) * k / 6), p = L.world(u, v, 1.2);
        const vx = p[0] - seat.eye[0], vz = p[2] - seat.eye[2], d = Math.hypot(vx, vz) || 1, dot = (vx * fx + vz * fz) / d;
        if (d <= CURTAIN_REACH && dot > 0.8 && d < near) { near = d; best = dot; }
      }
    }
    if (near === Infinity) return null;
    const drawn = !!S.drapes, key = drawn ? 'drawn' : 'open';
    let c = curtainCards.get(key);
    if (!c) curtainCards.set(key, c = { id: 'curtains:' + key, name: 'Curtains', curtain: true, door: true, doorActs: [drawn ? { verb: 'curtains open', label: 'Open the curtains' } : { verb: 'curtains close', label: 'Draw the curtains' }] });
    return c;
  }
  function handDoor(to, a) {
    const now = performance.now(), open = a.verb === 'opendoors';
    S.slideHold[to] = open ? now + HAND_WAIT_MS : 0;
    // the push bar's latch, and the swing: a long draught of air going, or the heavy pair meeting
    cachetSfx(open ? 'sfx_frontdoor_open' : 'sfx_frontdoor_shut', open ? 0.7 : 0.45, open ? [
      { waveform: 'square', freq: 2100, filter: { type: 'bandpass', freq: 2600, q: 4 }, adsr: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, gain: 0.1 },
      { waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 700, q: 0.7 }, adsr: { a: 0.12, d: 0.4, s: 0, r: 0.15 }, gain: 0.08 },
    ] : [
      { waveform: 'sine', freq: 82, pitchBend: { to: 55, time: 0.1 }, adsr: { a: 0.002, d: 0.18, s: 0, r: 0.08 }, gain: 0.4 },
      { waveform: 'square', freq: 1800, filter: { type: 'bandpass', freq: 2200, q: 4 }, adsr: { a: 0.001, d: 0.025, s: 0, r: 0.02 }, gain: 0.1 },
    ], 0.45);
  }
  // walked into a hand-opened pair while it's shut: say how to open it, now and then, not every frame
  let doorToldAt = 0;
  function toldDoorShut(o) {
    if (!S.slideHand?.has(o.to) || performance.now() - doorToldAt < 4000) return;
    doorToldAt = performance.now();
    flash('The doors are shut. F opens them.', false);
  }
  function watchLiftDoors(now) {
    const leaves = S.mesh?.liftDoors;
    if (!leaves) return;
    if (liftRide?.car === msg.zone && now - liftRide.t > RIDE_GIVE_UP_MS) { liftRide = null; S.ride = null; S.doors = { from: doorsNow(now), to: 0, t0: now }; }
    const shut = doorsNow(now), moving = now < S.doors.t0 + DOORS_MS;
    S.liftShut = shut;
    if (!moving && !S.doorsDirty && shut === S.doorsDrawn) return;
    S.doorsDirty = false; S.doorsDrawn = shut;
    R.setProps(liftDoorBatch(leaves, shut));
  }
  // THE RIDE (plugins/elevator sends `elevator_ride` as the doors seal): the read-out counts the floors as the car
  // passes them, the floor gives a little as it pulls away and settles as it stops, and the shaft hums. The car
  // moves once its doors have shut and arrives when the server says so; this is only what it feels like.
  function rideK(now) {
    const r = S.ride;
    if (!r) return null;
    const go = r.t0 + Math.min(DOORS_MS, r.ms * 0.4), span = Math.max(300, r.t0 + r.ms - go);
    return { k: Math.max(0, Math.min(1, (now - go) / span)), t: (now - go) / 1000, span: span / 1000 };
  }
  function readoutNow(now) {
    const at = msg.lift?.at ?? 1, q = rideK(now);
    if (!q || !S.ride) return at;
    const e = q.k * q.k * (3 - 2 * q.k);
    return Math.round(S.ride.from + (S.ride.to - S.ride.from) * e);
  }
  // how far the eye dips and lifts, metres: down as the car pulls away upward, up as it slows, the other way going
  // down, and a hum's worth of shake while it runs
  function rideBob(now) {
    const q = rideK(now);
    if (!q || q.k <= 0 || q.k >= 1) return 0;
    const dir = Math.sign(S.ride.to - S.ride.from) || 1, pull = Math.exp(-(((q.t - 0.25) / 0.18) ** 2)), stop = Math.exp(-(((q.t - (q.span - 0.3)) / 0.2) ** 2));
    return dir * (-0.014 * pull + 0.011 * stop) + 0.0012 * Math.sin(q.t * 61) * Math.min(1, q.t * 2) * Math.min(1, (q.span - q.t) * 2);
  }
  S.rideStart = (m) => {
    const now = performance.now();
    S.ride = { from: Number(m.from) || (msg.lift?.at ?? 1), to: Number(m.to) || 1, t0: now, ms: Math.max(800, Number(m.ms) || 2000) };
    S.doorsDirty = true;
    // a ride typed in the log ('floor 30') shuts the doors too, as pressing the button does
    if (S.doors.to !== 1) { S.doors = { from: doorsNow(now), to: 1, t0: now }; liftRide = { car: msg.zone, t: now }; }
    // down to the ground floor: the street outside is built while the doors are shut (warmStreet)
    S.warmOnRide?.(S.ride.to, Math.min(DOORS_MS, S.ride.ms * 0.4) + 60);
    // the city at the next floor, built behind the shut doors (warmView)
    S.warmViewAt = now + Math.min(DOORS_MS, S.ride.ms * 0.4) + 60; S.warmTo = S.ride.to;
    // the shaft: a low motor note bending as it gets up to speed, air past the car, the rails' hiss
    const wait = Math.min(DOORS_MS, S.ride.ms * 0.4) / 1000, sec = Math.max(0.6, S.ride.ms / 1000 - wait), up = S.ride.to > S.ride.from;
    try {
      window.AudioEngine?.playSfx({ id: 'sfx_lift_ride', name: 'sfx_lift_ride', category: 'sfx', priority: 4, config: { duration: sec + wait, layers: [
        { delay: wait, waveform: 'sine', freq: up ? 44 : 50, pitchBend: { to: up ? 52 : 42, time: Math.min(1.2, sec * 0.4) }, adsr: { a: 0.5, d: 0.3, s: 0.85, r: 0.6 }, gain: 0.3 },
        { delay: wait, waveform: 'triangle', freq: up ? 88 : 100, pitchBend: { to: up ? 104 : 84, time: Math.min(1.2, sec * 0.4) }, adsr: { a: 0.6, d: 0.3, s: 0.6, r: 0.5 }, gain: 0.05 },
        { delay: wait, waveform: 'noise', noiseMix: 1, filter: { type: 'lowpass', freq: 360, q: 0.7 }, adsr: { a: 0.7, d: 0.4, s: 0.75, r: 0.7 }, gain: 0.12 },
        { delay: wait, waveform: 'noise', noiseMix: 1, filter: { type: 'bandpass', freq: 1800, q: 2.4 }, adsr: { a: 1.0, d: 0.5, s: 0.25, r: 0.5 }, gain: 0.025 },
      ] } }, 0.6);
    } catch { /* no sound is still a ride */ }
  };

  // A resident put the set on: it comes on here through the verb you'd use. Only what they turned on
  // for you goes off with them, and if you turn it off it stays off.
  S.syncTv = (on) => {
    if (!!on === !!S.npcTv) return;
    S.npcTv = !!on;
    if (on) {
      const piece = S.pieces.find((p) => p.arche === 'screen' && p.public && !p.annex) || S.pieces.find((p) => p.arche === 'screen' && !p.annex);
      if (piece && !S.tv?.on) { S.tvPiece = piece.id; S.tvFromNpc = true; sendCmdSilent(`watch ${piece.name}`); }
    } else if (S.tvFromNpc) { S.tvFromNpc = false; S.tv?.off(); }
  };

  // the routes people are on (plugins/roomstage/npc-life.js), from when each message came
  const routes = new Map();
  const WALK_MAX = 1.6;   // metres a second
  S.noteRoutes = () => {
    const now = performance.now();
    routes.clear();
    // ⚠ NO FASTER THAN A WALK LOOKS. A route resent late (or with `ms` 0) had them skate the rest of it in a blink
    // while the walk clip strode at its own pace; given too little time, they take the time a brisk walk would.
    for (const p of S.people) if (p.route?.path?.length > 1) {
      const len = pathLength(p.route.path);
      routes.set(p.id, { ...p.route, len, ms: Math.max(p.route.ms || 0, len / WALK_MAX * 1000), t0: now });
    }
  };
  S.noteRoutes();
  // WALKING OUT AND IN (plugins/roomstage `gone` and `came`). Somebody who's left by a doorway isn't dropped: they
  // stay drawn, get up if they were sat, walk from where they were to that doorway and through it, and its door
  // opens as they come up to it and shuts behind them. Somebody who's come in steps through the doorway they came by
  // and walks to where the room has them. Only the picture: the server moved them before any of this, so a leaver
  // can't be spoken to (`_gone`), and a move by no doorway (a jump, a death) still just goes.
  const MOVE_SPEED = 1.3, OPEN_AHEAD = 2.1, PAST = 1.0;
  const leaving = new Map(), entering = new Map();   // id -> { path, len, ms, t0, to, plain, opened } (+ `p`, leaving)
  // the way through to zone `to`, in the room's frame: just inside it, and a step out past it (none for a stair)
  function wayTo(to) {
    const L = S.L;
    if (!L || !to || to === S.spec.annex?.zone) return null;
    let o = (S.spec.openings || []).find((x) => x.to === to);
    // a plain flat has the one door, in its back wall (`doorWall` can put it in the front), wherever it leads
    if (!o && !Array.isArray(S.spec.openings) && !S.spec.car && !S.spec.lift) {
      const hu = S.spec.w / 2, d = S.spec.door || [hu - 1.3, hu - 0.4];
      o = { kind: 'door', wall: S.spec.doorWall === 'front' ? 'front' : 'back', a: d[0], b: d[1], plain: true };
    }
    if (!o) return null;
    const inside = openingInside(L, o).at;
    if (o.kind === 'stair') return { inside, outside: null, plain: false };
    const n = o.wall === 'front' ? [0, -1] : o.wall === 'back' ? [0, 1] : o.wall === 'left' ? [-1, 0] : [1, 0];
    return { inside, outside: [inside[0] + n[0] * PAST, inside[1] + n[1] * PAST], plain: !!o.plain };
  }
  // ⚠ NEVER A STRAIGHT LINE THROUGH THE WALL. With no way found this used to draw [from, to], and somebody walked
  // through the furniture or the wall. A start that's stood in something (a stale spot, a piece put down on them) is
  // stepped to the nearest floor first; still no way, and there's no walk: they just go, or are just there.
  const safePath = (L, a, b) => {
    const p = roomPath(L, a, b);
    if (p) return p;
    const a2 = roomNearFree(L, a[0], a[1], 1.2), b2 = roomNearFree(L, b[0], b[1], 1.2);
    return a2 && b2 ? roomPath(L, a2, b2) : null;
  };
  const walkOf = (path) => { const len = pathLength(path); return { path, len, ms: Math.max(500, len / MOVE_SPEED * 1000), t0: performance.now() }; };
  // after each room_people: who's just gone and who's just come, against who was here before it
  S.noteMoves = (msg, before) => {
    const L = S.L;
    if (!L) return;
    const here = new Set(S.people.map((p) => p.id));
    for (const g of msg.gone || []) {
      if (g.id === S.you || here.has(g.id) || leaving.has(g.id)) continue;
      const p = before.find((x) => x.id === g.id), w = p && !p.annex && wayTo(g.to), from = w && (shown.get(p.id)?.at || placeOf(p)?.at);
      if (!from) continue;
      const path = safePath(L, from, w.inside);
      if (!path) continue;
      if (w.outside) path.push(w.outside);
      entering.delete(p.id);
      leaving.set(p.id, { ...walkOf(path), to: g.to, plain: w.plain,
        p: { ...p, _gone: true, posture: 'standing', on: null, seat: undefined, route: undefined, at: undefined, clip: undefined, act: undefined, hold: undefined, open: undefined, shut: undefined, stash: undefined, meal: undefined, dealerAt: undefined } });
    }
    for (const c of msg.came || []) {
      if (c.id === S.you || entering.has(c.id) || before.some((x) => x.id === c.id && !x._gone)) continue;
      const p = S.people.find((x) => x.id === c.id);
      // a resident walked in by the server (npc-life.js) already has a route from the door
      if (!p || p.annex || routes.has(p.id)) continue;
      const w = wayTo(c.from), end = w && placeOf(p)?.at;
      if (!end) continue;
      const goal = roomNearFree(L, end[0], end[1], 1.2) || end;
      const inPath = safePath(L, w.inside, goal);
      if (!inPath) continue;
      leaving.delete(p.id);
      entering.set(p.id, { ...walkOf([...(w.outside ? [w.outside] : []), ...inPath]), to: c.from, plain: w.plain });
    }
    // somebody back before they were through is just here again
    for (const id of leaving.keys()) if (here.has(id)) leaving.delete(id);
    if (leaving.size) S.people = [...S.people, ...[...leaving.values()].map((g) => g.p)];
  };
  // each frame: a door opens for whoever's at it, and a leaver who's through is gone
  function watchMoves(now) {
    if (!leaving.size && !entering.size && !S.frontOpen) return;
    let through = false, plain = false;
    const open = (g) => {
      if (g.plain) plain = true;
      if (g.opened) return;
      g.opened = true;
      lockUi.pass(g.to);
      if (S.slideHold) S.slideHold[g.to] = now + 1800;
    };
    for (const [id, g] of leaving) {
      const k = (now - g.t0) / g.ms;
      if (k >= 1) { leaving.delete(id); through = true; } else if ((1 - k) * g.len < OPEN_AHEAD) open(g);
    }
    for (const [id, e] of entering) {
      const k = (now - e.t0) / e.ms;
      if (k >= 1) entering.delete(id); else if (k * e.len < OPEN_AHEAD - PAST + 1) open(e);
    }
    if (through) S.people = S.people.filter((p) => !p._gone || leaving.has(p.id));
    // a plain flat's front door is part of the room's mesh: built again with it open, and again shut (roomMesh)
    if (plain !== !!S.frontOpen) {
      S.frontOpen = plain;
      S.mesh = roomMesh(S.L, { seed, lampOn, doorShut: S.doorShut, turning: S.spin?.turning, swinging: S.fridge?.id });
      R.setRoom(S.mesh, paint);
      if (S.spin) S.spin.mesh = S.mesh.spin;
      if (S.fridge) S.fridge.swing = S.mesh.swing || null;
      S.doorsDirty = true;
    }
  }
  // who is sat in a seat, other than you
  function takenBy(s) {
    for (const p of S.people) if (p.id !== S.you && seatsClash(placeOf(p)?.seat, s)) return p;
    return null;
  }
  // where a person is drawn: a seat on the piece they're on (the one they said, or the first free),
  // where they settled, or by the door
  // Where a session at the table is now: `gone` was its age when the server sent it, and the clock runs on from there.
  const stashRx = new WeakMap();
  function stashNow(s) {
    if (!stashRx.has(s)) stashRx.set(s, performance.now() - (s.gone || 0));
    return stashAt(s, performance.now() - stashRx.get(s));
  }
  function placeOf(p) {
    const L = S.L;
    if (!L) return null;
    // walking out of the room, or just in (watchMoves)
    const mv = p._gone ? leaving.get(p.id) : entering.get(p.id);
    if (mv) {
      const k = Math.min(1, (performance.now() - mv.t0) / mv.ms), q = pathAt(mv.path, k * mv.len);
      if (k < 1 || p._gone) return { at: q.at, yaw: roomYaw(L, q.du, q.dv), pose: 'stand', ...(k < 1 ? { clip: 'walk', walked: k * mv.len } : {}) };
    }
    // on their way somewhere: along the route the server gave them, and stood at its end until it
    // says what they did there
    const r = routes.get(p.id);
    if (r) {
      const k = r.ms ? Math.min(1, (performance.now() - r.t0) / r.ms) : 1, q = pathAt(r.path, k * r.len);
      return { at: q.at, yaw: roomYaw(L, q.du, q.dv), pose: 'stand', ...(k < 1 ? { clip: 'walk', walked: k * r.len } : {}) };
    }
    if ((p.posture === 'sitting' || p.posture === 'lying') && p.on) {
      const want = p.posture === 'lying';
      const mine = L.seats.filter((s) => s.piece === p.on && !!s.lie === want);
      // a seat nobody who's said where they are is using, or two bodies end up in one another
      const used = S.people.filter((o) => o !== p && Number.isInteger(o.seat)).map((o) => L.seats[o.seat]);
      const pick = (Number.isInteger(p.seat) && L.seats[p.seat]?.piece === p.on && L.seats[p.seat]) || mine.find((s) => !used.some((o) => seatsClash(o, s))) || mine[0] || L.seats.find((s) => s.piece === p.on);
      // a clip the server gave them in the seat: eating, mostly (plugins/roomstage/npc-life.js)
      // at the table with a habit (client/shared/table-stash.js): the clip and its phase off the session's clock
      const ss = p.stash && !p.clip && !pick.lie ? stashNow(p.stash) : null;
      if (pick) return { seat: pick, at: [pick.u, pick.v], yaw: pick.yaw, pose: pick.lie ? 'lie' : 'sit', head: pick.head, top: pick.top, ...(pick.back != null && !pick.lie ? { back: pick.back } : {}), ...(pick.lift && !pick.lie ? { lift: pick.lift } : {}),...(p.clip ? { clip: p.clip } : {}), ...(ss ? { clip: ss.clip, phase: ss.phase } : {}) };
    }
    // the dealer at a card table (plugins/gametable `room.tablePeople`): stood at its deck end, facing down it
    if (p.dealerAt) {
      const q = L.placed.find((x) => x.id === p.dealerAt);
      if (q) {
        const [fu, fv] = facing(q.turn), back = q.d / 2 + 0.42;
        return { at: [q.u - fu * back, q.v - fv * back], yaw: roomYaw(L, fu, fv), pose: 'stand' };
      }
    }
    // a post the server gave them: a dancer at her pole, `face` the way she looks in the room's u and v, and
    // `lift` how far up she stands (the stage's top)
    if (p.at) return { at: p.at, yaw: p.face ? roomYaw(L, p.face[0], p.face[1]) : p.yaw || 0, pose: 'stand', ...(p.lift ? { lift: p.lift } : {}), ...(p.clip ? { clip: p.clip } : {}) };
    // nobody has said where: spread over the floor, or in line at a counter (crowdPlace)
    const i = S.people.indexOf(p), d = S.spec.door || [0.7, 1.6];
    if (p.annex && L.annex) { const [u, v] = annexStand(L); return { at: [u + (i % 3 - 1) * 0.4, v + 0.5], yaw: Math.atan2(-L.f[0], -L.f[2]), pose: 'stand' }; }
    const c = crowdPlace(L, p, S.people, () => {
      const out = [];
      for (const q of S.people) { if (q === p || q.id === S.you || q.annex) continue; const at = placeOf(q)?.at; if (at) out.push(at); }
      if (S.walk?.at) out.push(S.walk.at);
      return out;
    });
    return c || { at: [d[0] + 0.3 + (i % 3) * 0.45, S.spec.d - 0.5 - Math.floor(i / 3) * 0.5], yaw: Math.atan2(L.f[0], L.f[2]), pose: 'stand' };
  }
  // ── Where somebody stands when nothing has said where (room-layout.js crowdSpot, lineSpots) ──
  // A spot each, chosen once a layout and held while they're in the room, so nobody shuffles when somebody else
  // comes in: clear of everyone already placed (sat, posted, walking, you), anywhere on the open floor. An NPC
  // where there's a counter to queue at (a box office, a trade counter, a reception desk) joins its line about
  // half the time, by their id, up to LINE_MAX, one behind another; the line moves up as the front leaves.
  const LINE_SHARE = 0.5, LINE_MAX = 5;
  const crowds = new WeakMap();   // layout -> { spots: Map id -> { at, yaw }, lines: [{ spots, ids }], busy }
  function crowdPlace(L, p, people, others) {
    let C = crowds.get(L);
    if (!C) { C = { spots: new Map(), lines: linePoints(L).map((q) => ({ spots: lineSpots(L, q, LINE_MAX), ids: [] })).filter((ln) => ln.spots.length), busy: false }; crowds.set(L, C); }
    // (asked while working out somebody else's spot: everyone in C is counted from C itself)
    if (C.busy) return null;
    const here = new Set(people.filter((q) => !q._gone).map((q) => q.id));
    for (const ln of C.lines) {
      const k = ln.ids.filter((id) => here.has(id)).indexOf(p.id), q = k >= 0 && ln.spots[k];
      if (q) return { at: [...q.at], yaw: q.yaw, pose: 'stand' };
    }
    const had = C.spots.get(p.id);
    if (had) return { at: [...had.at], yaw: had.yaw, pose: 'stand' };
    // somebody new: whoever's gone is let go first
    for (const id of [...C.spots.keys()]) if (!here.has(id)) C.spots.delete(id);
    for (const ln of C.lines) ln.ids = ln.ids.filter((id) => here.has(id));
    const seed = crowdSeed(p.id);
    if (p.npc && C.lines.length && (seed & 0xffff) / 0x10000 < LINE_SHARE) {
      const ln = C.lines.reduce((a, b) => (b.ids.length < a.ids.length ? b : a));
      if (ln.ids.length < ln.spots.length) { ln.ids.push(p.id); const q = ln.spots[ln.ids.length - 1]; return { at: [...q.at], yaw: q.yaw, pose: 'stand' }; }
    }
    C.busy = true;
    let taken;
    try { taken = others(); } finally { C.busy = false; }
    for (const s of C.spots.values()) taken.push(s.at);
    // a line keeps the place behind its last one free, so the next to join isn't stood in somebody
    for (const ln of C.lines) for (const q of ln.spots.slice(0, ln.ids.length + 1)) taken.push(q.at);
    const at = crowdSpot(L, taken, seed);
    if (!at) return null;
    // facing into the room, give or take
    const [u0, u1, v0, v1] = L.bounds, turn = ((seed >>> 16) / 0x10000 - 0.5) * 2.2;
    const yaw = roomYaw(L, (u0 + u1) / 2 - at[0], (v0 + v1) / 2 - at[1]) + turn;
    C.spots.set(p.id, { at, yaw });
    return { at: [...at], yaw, pose: 'stand' };
  }
  // your own posture, from the server: a `sit` typed in the log seats you here too
  function followSelf() {
    const me = S.people.find((p) => p.id === S.you), w = S.walk;
    if (!me || !w) return;
    syncing = true;
    try {
      const down = (me.posture === 'sitting' || me.posture === 'lying') && me.on;
      if (down && w.sat?.piece !== me.on) { const pl = placeOf(me); if (pl?.seat) w.sit(pl.seat); }
      else if (!down && w.sat) w.standUp();
    } finally { syncing = false; }
  }

  // A MORPHEX pod (room-morphex.js). Nothing here decides anything: buying is the `morphex` verbs.
  function startMorph(piece) {
    if (S.morph?.on || S.cooking) return;
    const q = S.L.placed.find((x) => x.id === piece.id), mine = S.people.find((p) => p.id === S.you);
    if (!q) return;
    // nobody in the people list (the Room Lab) still gets a body: the columns' defaults
    S.morph = createMorphex({ L: S.L, piece: q, mount: root, me: { id: S.you, sex: mine?.sex, look: { ...(mine?.look || lookOfPlayer({})) } }, send: (c) => sendCmdSilent(c),
      done: ({ at }) => {
        S.morph = null; S.morphEnd = performance.now(); root.classList.remove('rs-morph');
        S.morphPod = null; podMesh();
        R.setProps({ data: new Float32Array(0), n: 0 }); R.setPropsGlass(null); R.setStageHalos(null); R.setGlows([]);
        // you're stood where you stepped out, looking back into the room
        S.walk?.moveTo?.(at);
      } });
    root.classList.add('rs-morph');
    // the pod's open halves are part of the room's mesh; while the sequence swings its own, the room's come out
    S.morphPod = q.id; podMesh();
  }
  function podMesh() {
    S.mesh = roomMesh(S.L, { seed, lampOn, doorShut: S.doorShut, turning: S.spin?.turning, swinging: S.fridge?.id });
    R.setRoom(S.mesh, paint);
  }

  // ARRANGING (room-arrange.js): the owner's furniture moved by hand from above, the walls down. Every mesh set
  // while it's open goes through its cutaway, so a lamp switched or a door shut keeps the walls down too.
  // Nothing is written until its Save, which is the `arrange layout` verb.
  const setRoomWhole = R.setRoom;
  // (and while the Pack has the camera going round you: room-pack.js, packView)
  R.setRoom = (m, paint) => setRoomWhole(S.arrange?.on ? S.arrange.cut(m) : S.packCam ? packCut(m) : m, paint);
  function startArrange() {
    if (!(msg.mine || msg.admin) || S.arrange?.on || S.morph?.on || S.cooking || !S.L) return;
    hoverEl.hidden = true;
    S.held = null;
    // `admin`: staff on a local server (plugins/roomstage adminHere) set any room up, authored pieces and all
    S.arrange = createArrange({ root, host, S, R, rebuild: () => rebuild(), repaint: () => paintTags(), opts: () => ({ seed, lampOn }), send: (c) => (arrangeHost ? arrangeHost(c, msg) : sendCmd(c)), sendSilent: (c) => (arrangeHost ? arrangeHost(c, msg) : sendCmdSilent(c)), admin: !!msg.admin,
      done: (saved) => {
        S.arrange = null; root.classList.remove('rs-arranging');
        if (saved) S.pieces = saved;
        rebuild();
      } });
    root.classList.add('rs-arranging');
    rebuild();
  }
  root.querySelector('.rs-arrange')?.addEventListener('click', () => startArrange());
  const vatBtn = root.querySelector('.rs-vattest');
  vatBtn?.addEventListener('click', () => sendCmd('room vatdrop'));

  // a station: the verb the piece answers to. Watching a set brings the broadcast up on it, and the
  // server's answer to `watch` goes to the set on the wall (room-tv.js); again, and you stop watching.
  // a button on the lift's hologram: the car goes where the panel says (plugins/elevator)
  function pressFloor(n) {
    if (!msg.lift || !Number.isFinite(n)) return;
    const here = n === msg.lift.at;
    flash(here ? 'The doors are already open here.' : `Floor ${n === 1 ? 'L' : n}.`, true);
    if (!here && !liftRide) { const now = performance.now(); S.doors = { from: doorsNow(now), to: 1, t0: now }; liftRide = { car: msg.zone, t: now }; }
    sendCmd(`floor ${n}`);
  }
  function useStation(st) {
    const piece = S.pieces.find((p) => p.id === st.piece);
    if (!piece) return;
    // a MORPHEX pod you can step into (`look.pod`): its sequence, and the sales screen over it
    // `use` too, so the server knows the machine opened (the prologue's gate waits on cosmetic.opened); its answer
    // comes back as morphex_panel, which dispatch.js hands to this pod rather than the 2D panel
    if (piece.pod) { startMorph(piece); sendCmdSilent(`use ${piece.name}`); return; }
    // a trophy case: the camera goes round its Cup (room-closeup.js), and the case is looked at as ever
    const trophy = st.verb === 'examine' ? S.L?.placed?.find((q) => q.id === piece.id && q.form === 'trophy') : null;
    if (trophy) { S.cupFor = trophy.id; hoverEl.hidden = true; if (!S.closeup.open(trophy.label || piece.name)) S.cupFor = null; }
    // the bench's HUD comes up over the room, and only the room's owner is told there's a keypad
    // which piece it was is remembered for a little while, so the kitchen opens standing you at it (cookFrame)
    if (st.verb === 'workspace') { if (!piece.lab) S.cookAt = { id: piece.id, t: performance.now() }; sendCmd(piece.lab ? 'workspace chembench' : 'workspace'); return; }
    // a piece whose card offers the workspace (a bar counter, a range) opens it, rather than being looked at
    if (st.verb === 'examine' && piece.acts?.some((a) => a.verb === 'workspace')) { S.cookAt = { id: piece.id, t: performance.now() }; sendCmd('workspace'); return; }
    // a vending machine: its buttons are on its card and on its front, so arriving at it only looks
    if (piece.form === 'vendor' && piece.vend) { sendCmd(`examine ${piece.name}`); return; }
    // a box that sells (the lacquered box's `vend`): the click opens it and brings its card up
    if (st.verb === 'examine' && piece.acts?.some((a) => a.verb === 'vend')) { S.lidFor = piece.id; sendCmdSilent(`${piece.acts.find((a) => a.verb === 'vend').cmd} menu`); return; }
    if (st.verb === 'keypad') { sendCmd(msg.keypad ? `keypad ${piece.name}` : `examine ${piece.name}`); return; }
    // a cabinet that doesn't open but sells (the humidor's `vend`): the click does what the card's first line does
    if (st.verb === 'open' && piece.acts && !piece.acts.some((a) => a.verb === 'open')) { const a = actsOf(piece)[0]; if (a && a.verb !== 'examine') { runAct(a); return; } }
    if (st.verb === 'watch') {
      if (tvOnHere(piece)) { S.tv.off(); flash(`You turn off the ${piece.name}.`, true); return; }
      S.tvPiece = piece.id;
    }
    if (st.verb === 'open') openFridge(piece);
    flash(st.verb === 'open' ? `You open the ${piece.name}.` : st.verb === 'watch' ? `You turn on the ${piece.name}.` : `You look at the ${piece.name}.`, true);
    sendCmd(`${st.verb} ${piece.name}`);
  }

  // The card. A piece in the en-suite answers from the en-suite, because the verb runs where you are.
  const reachable = (p) => !!p && !!p.annex === (S.here !== msg.zone);
  { // the help line goes away on a click or after 30 seconds
    const tipEl = root.querySelector('.rs-tip');
    const hideTip = () => tipEl?.classList.add('rs-tip-gone');
    tipEl?.addEventListener('click', hideTip, { once: true });
    setTimeout(hideTip, 30000);
  }
  const cardEl = root.querySelector('.rs-card'), cardName = root.querySelector('.rs-card-name'), cardActs = root.querySelector('.rs-card-acts'), cardSay = root.querySelector('.rs-card-say');
  function actsOf(piece) {
    // a vending machine: a button for each flavour, and pulling it out from the wall to get at its plug
    if (piece.form === 'vendor' && piece.vend) return vendorUi.acts(piece);
    // a card table you sit at: F deals you in (plugins/gametable `join`); once you are, its controls are on the felt
    const pk = piece.board?.poker && S.walk?.sat && !piece.board.seats?.some((s) => s && s.id === S.you);
    if (pk) return [{ verb: 'join', label: 'Join the game' }, { verb: 'stand', label: 'Get up' }];
    // in the game: Get up holds your seat (you check or fold while away); Leave the game cashes you out
    const inGame = (piece.board?.poker ? piece.board : S.pieces.find((q) => q.board?.poker && q.board.chairs && Object.values(q.board.chairs).includes(piece.id))?.board)?.seats?.find((s) => s && s.id === S.you);
    const leaveAct = { verb: 'leave', label: 'Leave the game' };
    if (inGame && S.walk?.sat) return [{ verb: 'stand', label: 'Get up (keep seat)' }, leaveAct];
    // stood at the card table itself: F takes a chair and deals you in (or back to your held seat), so the HUD comes up
    if (piece.board?.poker && !S.walk?.sat) {
      const rest = pieceActs(piece, S.L.seats.filter((s) => s.piece === piece.id));
      return [{ verb: 'pokerplay', label: inGame ? 'Back to the game' : 'Play poker' }, ...(inGame ? [leaveAct] : []), ...rest];
    }
    if (inGame) return [...pieceActs(piece, S.L.seats.filter((s) => s.piece === piece.id)), leaveAct];
    let acts = pieceActs(piece, S.L.seats.filter((s) => s.piece === piece.id));
    // a seat door: the tickets you hold for its sections first, each sitting you on it (plugins/stands `stands ticket`)
    if (piece.door) acts = [...ticketActs(S.tickets, piece.door), ...acts];
    // a Cachet's keypad, for whoever the room says may know of it: first on its card, so F at the bar brings the pad up
    // wherever on the cabinet you're facing, not only from the step in front of its little panel
    // a turned Cachet's lab is out: F cooks at it. The server's acts are the bar's, which know nothing of the lab.
    if (piece.turned && !acts.some((x) => x.verb === 'workspace')) acts = [{ verb: 'workspace', label: 'Cook', cmd: 'workspace chembench' }, ...acts];
    if (piece.keypad && msg.keypad) { const rest = acts.filter((x) => x.verb !== 'keypad'), pad = { verb: 'keypad', label: 'Use the keypad' }; acts = piece.turned ? [...rest, pad] : [pad, ...rest]; }
    // a set's Watch is its power switch (useStation): it says which way it'll go
    if (S.mesh.screens.some((s) => s.id === piece.id)) acts = acts.map((a) => (a.verb === 'watch' ? { ...a, label: tvOnHere(piece) ? 'Turn it off' : 'Turn it on' } : a));
    if (S.walk?.sat?.piece === piece.id) return [{ verb: 'stand', label: 'Get up' }, ...acts.filter((a) => a.verb !== 'sit' && a.verb !== 'lie')];
    // looked at from a seat, the set across the room: getting up stays on the card
    return S.walk?.sat ? [...acts, { verb: 'stand', label: 'Get up' }] : acts;
  }
  // whether this set is the one that's on (one turned on by typing `watch` never said which piece it was)
  const tvOnHere = (piece) => !!S.tv?.on && (S.tvPiece ?? piece.id) === piece.id;
  // The set you're looking at, from anywhere in the room: a set is watched from across it, further off than a
  // piece's card reaches. `square` when the middle of the view is on its screen, which beats a piece in reach.
  const TV_LOOK = 0.2, TV_FAR = 12, TV_NEAR = 0.1;
  function tvAimed() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!S.tv || !w || !h) return null;
    let best = null;
    for (const sc of S.mesh.screens) {
      const piece = S.pieces.find((p) => p.id === sc.id);
      if (!piece || !reachable(piece)) continue;
      const Q = sc.quad, mid = [0, 1, 2].map((i) => (Q[0][i] + Q[1][i] + Q[2][i] + Q[3][i]) / 4);
      if (Math.hypot(mid[0] - seat.eye[0], mid[2] - seat.eye[2]) > TV_FAR) continue;
      const m = R.project(mid, w, h);
      if (!m) continue;
      const off = Math.hypot(m.x / w - 0.5, m.y / h - 0.5);
      if (off >= TV_LOOK || (best && off >= best.off)) continue;
      const q = Q.map((p) => R.project(p, w, h)), cx = w / 2, cy = h / 2;
      const side = q.every(Boolean) && q.map((p, i) => { const n = q[(i + 1) % 4]; return Math.sign((n.x - p.x) * (cy - p.y) - (n.y - p.y) * (cx - p.x)); });
      best = { piece, off, square: !!side && (side.every((s) => s >= 0) || side.every((s) => s <= 0)) };
    }
    return best;
  }
  // Somebody you can talk to: the verb runs where you are, so they have to be on your side of the door.
  const talkable = (p) => !!p?.npc && !p._gone && !!p.annex === (S.here !== msg.zone);
  // a dancer on shift (plugins/roomstage `tip`) takes a tip off her card: the ordinary `tip` verb, which pays it
  // (Talk stays on F, so the key you press at anybody never spends money). The lines are client/shared/room-acts.js
  // personActs, which GLASS's card reads too.
  const personActs = (p) => personLines(p, { sat: !!S.walk?.sat });
  // Cash thrown at somebody: a fistful of notes from the bottom of the picture to her waist, the bigger the
  // tip the more of them. A drawing on the glass over the room, gone in a second and a half; the money is
  // the verb's to take, and a tip you can't cover is refused in words as it is in the text game.
  function throwCash(who, n) {
    const pl = who && placeOf(who), b = host.getBoundingClientRect();
    if (!pl || !b.width) return;
    const base = S.L.baseAt(pl.at[0], pl.at[1]), to = R.project(S.L.world(pl.at[0], pl.at[1], base + 1.0), b.width, b.height);
    if (!to) return;
    const count = Math.min(14, 3 + Math.round(n / 8));
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'rs-note';
      el.textContent = '₵';
      const x0 = b.width * (0.42 + 0.16 * Math.random()), y0 = b.height + 20;
      const x1 = to.x + (Math.random() - 0.5) * 70, y1 = to.y + (Math.random() - 0.5) * 60;
      const lift = 80 + 90 * Math.random(), spin = (Math.random() - 0.5) * 900, dur = 700 + 500 * Math.random();
      el.style.left = `${x0}px`; el.style.top = `${y0}px`;
      host.appendChild(el);
      el.animate([
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${(x1 - x0) * 0.55}px), calc(-50% + ${(y1 - y0) * 0.55 - lift}px)) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0 + 40}px)) rotate(${spin}deg)`, opacity: 0 },
      ], { duration: dur, delay: i * 45, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).onfinish = () => el.remove();
    }
  }
  // the nearest person you're facing, who wins over the furniture around them
  function personAimed() {
    let best = null, score = Infinity;
    for (const p of S.people) {
      if (!talkable(p)) continue;
      const pl = placeOf(p), s = pl && S.walk.sight(pl.at[0], pl.at[1]);
      if (s < score) { score = s; best = p; }
    }
    return best;
  }
  // who's under a point on the picture: the box from their feet to their head
  function personAt(x, y, w, h) {
    for (const p of S.people) {
      const pl = talkable(p) && placeOf(p);
      if (!pl) continue;
      const base = S.L.baseAt(pl.at[0], pl.at[1]), top = pl.pose === 'lie' ? (pl.top || 0.4) + 0.5 : (pl.pose === 'sit' ? 1.45 + (pl.lift || 0) : 1.95) + base;
      const a = R.project(S.L.world(pl.at[0], pl.at[1], top), w, h), b = R.project(S.L.world(pl.at[0], pl.at[1], base), w, h);
      if (a && b && y >= a.y && y <= b.y && Math.abs(x - (a.x + b.x) / 2) <= Math.max(24, (b.y - a.y) * 0.3)) return p;
    }
    return null;
  }
  function showCard(piece, who) {
    const holo = !!(piece?.lock || piece?.lift);
    const acts = who ? personActs(who) : piece?.lock ? piece.lockActs : piece?.lift ? piece.liftActs : piece?.door ? piece.doorActs : piece ? actsOf(piece) : [], on = who || piece, key = on ? on.id + acts.map((a) => a.verb + a.label).join() : '';
    if (key === (S.cardKey || '')) return;
    S.cardKey = key;
    S.card = on ? { piece, who, acts } : null;
    // a lock's card, or a lift's, is the hologram on the wall, so only its keys are taken from here
    cardEl.hidden = ((!on || holo) && cardSay.hidden) || S.cardGone === key;
    cardName.textContent = holo ? '' : on?.name || '';
    root.classList.toggle('rs-lock-on', holo);
    cardActs.innerHTML = (holo ? [] : acts).slice(0, 9).map((a, i) => `<button type="button" data-i="${i}"><kbd>${i ? i + 1 : 'F'}</kbd>${esc(a.label)}</button>`).join('');
  }
  // a click on the card off its buttons puts it away until you face something else
  cardEl.addEventListener('click', (e) => { if (e.target.closest('button')) return; S.cardGone = S.cardKey || ''; cardEl.hidden = true; cardSay.hidden = true; });
  cardActs.addEventListener('click', (e) => { const b = e.target.closest('button'), a = b && S.card?.acts[Number(b.dataset.i)]; if (a) runAct(a); });
  function watchCard() {
    const w = S.walk;
    if (!w?.at) return;
    // cooking, the kitchen's menu is the card
    if (S.cooking && !S.chemming) { if (S.card) showCard(null, null); return; }
    // held on a piece by a click until you walk away from where you clicked
    if (S.held && Math.hypot(w.at[0] - S.held.at[0], w.at[1] - S.held.at[1]) > 0.4) S.held = null;
    const heldWho = S.held?.who && S.people.find((p) => p.id === S.held.who);
    if (S.held?.who && !talkable(heldWho)) S.held = null;
    const who = heldWho || (S.held ? null : personAimed());
    const id = who ? null : S.held?.piece ?? w.aim();
    let piece = S.pieces.find((p) => p.id === id) || null;
    // the set you're looking at is the card over the seat you're on, and over a piece in reach once you're
    // looking straight at its screen, so F works it from the sofa
    // (or near enough: a set seen side-on or small across the room can miss the dead centre, and a piece beside you
    // that you merely face, a card table, mustn't take F off the screen you're plainly looking at)
    if (!who && !S.held) { const tv = tvAimed(); if (tv && (!piece || piece.id === w.sat?.piece || tv.square || tv.off < TV_NEAR)) piece = tv.piece; }
    // nothing nearer to hand: the lock you're stood at
    // the curtains you're facing win over a piece in front of them (the sofa under the window), but not a screen or a seat you're on
    const drape = who || S.held ? null : curtainAim();
    if (drape && piece && piece.id !== w.sat?.piece && !tvAimed()) piece = null;
    showCard(piece || (who || S.held ? null : lockUi.aim(w.at, seat.eye, seat.yaw) || liftUi.aim() || doorAim() || drape), who);
  }
  let sayT = 0;
  S.say = (text) => {
    // a lock answers on its own face
    if ((S.card?.piece?.lock || lockUi.hacking) && lockUi.said(text)) return;
    cardSay.textContent = cardSay.hidden ? text : `${cardSay.textContent} ${text}`;
    cardSay.hidden = false; cardEl.hidden = false;
    clearTimeout(sayT);
    sayT = setTimeout(() => { cardSay.hidden = true; cardEl.hidden = !S.card || S.cardGone === S.cardKey; }, 7000);
  };
  function runAct(a) {
    // a lacquered box lifts its lid while its card is up (gl/room-stash.js)
    if (a.verb === 'vend') { if (S.card?.piece?.form === 'lacquer') S.lidFor = S.card.piece.id; sendCmdSilent(`${a.cmd} menu`); return; }
    const piece = S.card?.piece, w = S.walk;
    if (!S.card || !w) return;
    if (piece?.lock) { lockUi.run(piece.lock, a); return; }
    if (piece?.lift) { pressFloor(a.n); return; }
    if (piece?.curtain) { sendCmd(a.verb); return; }
    if (piece?.door) { handDoor(piece.door, a); return; }
    S.held = null;
    if (a.verb === 'stand') { w.standUp(); return; }
    if (a.verb === 'join') { sendCmd('join'); return; }
    if (a.verb === 'pokerplay') {
      // your held chair if you have one, else the first free chair round the table; then join if you aren't in
      const st = piece?.board, i = st?.seats?.findIndex((s) => s && s.id === S.you) ?? -1;
      const ids = Object.entries(st?.chairs || {}).filter(([k]) => (i >= 0 ? +k === i : !st.seats?.[+k])).map(([, id]) => id);
      const seat = ids.flatMap((id) => S.L.seats.filter((s) => s.piece === id && !s.lie)).find((s) => !takenBy(s));
      if (!seat) { flash('No free chair at the table.', false); return; }
      w.sit(seat);
      if (i < 0) sendCmd('join');
      return;
    }
    if (a.verb === 'leave') { sendCmd('leave'); return; }
    if (a.verb === 'keypad') { sendCmd(`keypad ${piece.name}`); return; }
    // a wardrobe's Change clothes: your gear, to dress and undress
    if (a.verb === 'dress') { S.pack.open('wear', { wardrobe: piece?.arche === 'wardrobe' ? piece.id : null }); return; }
    // a wardrobe opens on the Pack, with its saved outfits, not the 2D wardrobe panel
    if (a.verb === 'open' && piece?.arche === 'wardrobe') { openFridge(piece); S.pack.open('wear', { wardrobe: piece.id }); return; }
    if (a.verb === 'sit' || a.verb === 'lie') {
      // a piece with only a place to lie (a sun lounger) takes a sit as a lie
      const all = S.L.seats.filter((s) => s.piece === piece.id), want = a.verb === 'lie' || all.every((s) => s.lie);
      const mine = all.filter((s) => !!s.lie === want), s = mine.find((x) => !takenBy(x));
      if (s) { w.sit(s); return; }
      if (mine.length) { flash(`${takenBy(mine[0]).name} is there.`, false); return; }
    }
    S.listenUntil = performance.now() + 2500;
    cardSay.hidden = true;
    if (a.verb === 'watch') { useStation({ piece: piece.id, verb: 'watch' }); return; }
    if (a.verb === 'tip') throwCash(S.card.who, a.n);
    if (a.verb === 'vendpress' && piece) vendorUi.press(piece.id, a.item);
    if (a.verb === 'workspace' && piece && !piece.lab) S.cookAt = { id: piece.id, t: performance.now() };
    if (a.verb === 'open') openFridge(piece);
    // a boombox's Music opens the AMP player, which is the client's own; the server never hears `music`
    if (a.verb === 'music') { import('./lazy-views.js').then((m) => m.openMusicPlayerPanel()); return; }
    sendCmd(a.cmd);
  }

  // the dial in the bar, while a set's on
  const tvBar = root.querySelector('.rs-tvbar');
  function showChannel() { tvBar.hidden = !S.tv?.on; }

  // Where the pointer is on the set's picture, { u, v } from its top left, or null off it. The corners
  // are projected and the square they came from solved for, which keeps the perspective right.
  function tvPoint(x, y, w, h) {
    const sc = S.tv?.on && (S.mesh.screens.find((s) => s.id === S.tvPiece) || S.mesh.screens[0]);
    // (room-tv.js quadUV, which the street view's pointer asks too)
    return sc ? quadUV(sc.quad.map((p) => R.project(p, w, h)), x, y) : null;
  }
  // the stretch of the screen batch showing the broadcast, and a new picture for it when there is one
  function tvNow(now) {
    if (!S.tv?.on) { S.tvBootAt = null; return null; }
    const sc = S.mesh.screens.find((s) => s.id === S.tvPiece) || S.mesh.screens[0];
    if (!sc) return null;
    // a set with a `boot` plays it each time it comes on (room-tv.js paintBoot), the broadcast opening out of it
    const boot = S.pieces.find((p) => p.id === sc.id)?.boot;
    if (boot && S.tvBootAt == null) S.tvBootAt = now;
    const bt = boot ? (now - S.tvBootAt) / 1000 : Infinity;
    // a set behind you isn't worth painting: the sound goes on, and it's the same picture when you turn
    const fx = Math.sin(seat.yaw), fz = Math.cos(seat.yaw);
    const seen = sc.quad.some((q) => (q[0] - seat.eye[0]) * fx + (q[2] - seat.eye[2]) * fz > 0);
    // how big it looks: its width over how far off it is, so a set across the room paints less often
    const Q = sc.quad, d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const mid = [0, 1, 2].map((i) => (Q[0][i] + Q[1][i] + Q[2][i] + Q[3][i]) / 4);
    const size = Math.max(d3(Q[0], Q[1]), d3(Q[1], Q[2])) / Math.max(0.3, d3(mid, seat.eye));
    if (bt < BOOT_S) {
      if (seen) {
        S.tv.paint(now, size);
        const c = S.bootCanvas || (S.bootCanvas = document.createElement('canvas'));
        if (c.width !== S.tv.canvas.width) { c.width = S.tv.canvas.width; c.height = S.tv.canvas.height; }
        paintBoot(c, S.tv.canvas, bt, boot);
        R.setLive(c);
      }
      S.tvBooted = false;
      return sc;
    }
    if (seen && (S.tv.paint(now, size) || (boot && !S.tvBooted))) { R.setLive(S.tv.canvas); if (boot) S.tvBooted = true; }
    // a venue's sets are on one feed: the one watched, and every other in the room showing the same picture
    if (!S.pieces.find((p) => p.id === sc.id)?.public) return sc;
    const also = S.mesh.screens.filter((s) => s !== sc && S.pieces.find((p) => p.id === s.id)?.public);
    return also.length ? [sc, ...also] : sc;
  }

  // THE LIGHTS are on the switch by the door (gl/room-mesh.js puts it on K.dials as kind 'switch'), not in the
  // bar: a click on it opens this panel beside it, as a fire's dial opens the fire's
  const lightHud = root.querySelector('.rs-lighthud'), rocker = root.querySelector('.rs-lightrocker'), lightLbl = root.querySelector('.rs-light-lbl');
  const dimEl = root.querySelector('.rs-dim');
  // how the lights stand, in words: the switch's own, or that there's nothing to switch
  const lightWord = () => (power === 'off' ? 'No power' : !switchOn ? 'Off' : power === 'low' ? 'Emergency' : `${Math.round(lampLevel * 100)}%`);
  // the rocker shows where the switch is, whatever the mains are doing
  const showLamp = () => { rocker.textContent = switchOn ? 'On' : 'Off'; rocker.setAttribute('aria-pressed', String(switchOn)); rocker.classList.toggle('on', switchOn); dimEl.value = String(Math.round(lampLevel * 100)); lightLbl.textContent = lightWord(); };
  // the switch and the mains together; the mesh changes only when that does (the lamps' faces are lit or not)
  const relight = () => {
    const was = lampOn;
    lampOn = switchOn && power !== 'off';
    showLamp();
    if (lampOn !== was) rebuild();
  };
  // dimming needs no rebuild, only the lamps' own light: turning it up from off does
  const setLevel = (k) => {
    lampLevel = Math.max(0.1, Math.min(1, k));
    if (!switchOn) toggleLamp(); else { saveSwitch(msg.zone, switchOn, lampLevel); showLamp(); }
  };
  dimEl.addEventListener('input', () => setLevel(Number(dimEl.value) / 100));
  // the slider gives the keyboard back, or WASD stops walking
  dimEl.addEventListener('change', () => dimEl.blur());
  dimEl.addEventListener('pointerup', () => dimEl.blur());
  const toggleLamp = () => {
    switchOn = !switchOn;
    saveSwitch(msg.zone, switchOn, lampLevel);
    relight();
  };
  showLamp();
  // the mains in this room or one next door (`room_power`, plugins/roomstage powerOf): this room's lamps follow,
  // and a room next door is drawn again lit or dark, with its light through the doorway
  S.setPower = (m) => {
    if (m.zone === msg.zone) { power = m.power || 'on'; relight(); return; }
    const n = nextDoor.find((x) => x.zone === m.zone);
    if (!n || n.power === m.power) return;
    n.power = m.power;
    reshell(); rebuild();
  };
  // a flat's control panel (envctl.js) dims this room's lights: the room follows, live as its bar is dragged
  const onPanelLight = (e) => {
    const d = e.detail;
    if (!d || d.zone !== msg.zone) return;
    if (d.on) lampLevel = Math.max(0.1, Math.min(1, d.level));
    if (d.on !== switchOn) toggleLamp(); else { saveSwitch(msg.zone, switchOn, lampLevel); showLamp(); }
  };
  window.addEventListener('envctl:light', onPanelLight);

  // the gas fire's dial: this viewer's, like the lights. 0 is the pilot alone. The dial is on the fire
  // itself (gl/room-fittings.js fireDial); a click on it opens this panel beside it, and nothing in the
  // bar. Drag the knob up or scroll to turn it up; a click without a drag steps off, low, medium, high
  const fireHud = root.querySelector('.rs-firehud'), knob = root.querySelector('.rs-knob'), fireLbl = root.querySelector('.rs-fire-lbl');
  let flame = 0.7;
  try { const v = localStorage.getItem('roomFlame'); if (v != null) flame = Math.max(0, Math.min(1, Number(v) || 0)); } catch { /* private window */ }
  const showFlame = () => {
    knob.style.setProperty('--turn', `${-135 + 270 * flame}deg`); knob.style.setProperty('--k', String(flame)); knob.classList.toggle('pilot', flame < 0.02);
    knob.setAttribute('aria-valuenow', String(Math.round(flame * 100)));
    fireLbl.textContent = flame < 0.02 ? 'Pilot' : `${Math.round(flame * 100)}%`;
    for (const b of fireHud.querySelectorAll('.rs-fire-steps button')) b.classList.toggle('on', Math.abs(Number(b.dataset.k) - flame) < 0.02);
  };
  // the dial under a point on the picture, if you're near enough to reach for it
  const DIAL_REACH = 4.5;
  const dialFar = (d) => Math.hypot(d.at[0] - seat.eye[0], d.at[1] - seat.eye[1], d.at[2] - seat.eye[2]);
  function dialAt(x, y, w, h) {
    for (const d of S.mesh?.dials || []) {
      if (dialFar(d) > DIAL_REACH) continue;
      const q = R.project(d.at, w, h), top = R.project([d.at[0], d.at[1] + d.r, d.at[2]], w, h);
      if (q && top && Math.hypot(x - q.x, y - q.y) <= Math.max(18, Math.abs(q.y - top.y) * 1.3)) return d;
    }
    return null;
  }
  let fireDialOpen = null;
  const closeFire = () => { fireHud.hidden = true; lightHud.hidden = true; fireDialOpen = null; };
  // beside the dial or switch it's for, on the picture
  function besideDial(hud, d) {
    const b = host.getBoundingClientRect(), q = R.project(d.at, b.width, b.height);
    hud.hidden = false;
    const hw = hud.offsetWidth, hh = hud.offsetHeight, x = q ? q.x + 28 : b.width / 2;
    hud.style.left = `${Math.max(8, Math.min(b.width - hw - 8, x + hw > b.width - 8 && q ? q.x - 28 - hw : x))}px`;
    hud.style.top = `${Math.max(8, Math.min(b.height - hh - 8, (q ? q.y : b.height / 2) - hh / 2))}px`;
  }
  function openFire(d) {
    closeFire(); fireDialOpen = d;
    besideDial(d.kind === 'switch' ? lightHud : fireHud, d);
  }
  // the panels keep their own clicks and their wheel, so the room behind doesn't turn or zoom
  for (const hud of [fireHud, lightHud]) for (const ev of ['pointerdown', 'pointerup', 'wheel']) hud.addEventListener(ev, (e) => e.stopPropagation());
  fireHud.querySelector('.rs-firehud-x').addEventListener('click', closeFire);
  lightHud.querySelector('.rs-lighthud-x').addEventListener('click', closeFire);
  rocker.addEventListener('click', () => { toggleLamp(); rocker.blur(); });
  dimEl.addEventListener('wheel', (e) => { e.preventDefault(); setLevel(lampLevel + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
  const fires = () => (S.mesh?.dials || []).filter((d) => d.kind !== 'switch');
  fireHud.querySelector('.rs-fire-steps').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { setFlame(Number(b.dataset.k)); b.blur(); } });
  const setFlame = (k) => {
    flame = Math.max(0, Math.min(1, Math.round(k * 20) / 20));
    try { localStorage.setItem('roomFlame', String(flame)); } catch { /* private window */ }
    showFlame();
  };
  let turning0 = null;
  knob.addEventListener('pointerdown', (e) => { turning0 = { y: e.clientY, k: flame, moved: false }; knob.setPointerCapture(e.pointerId); e.stopPropagation(); });
  knob.addEventListener('pointermove', (e) => {
    if (!turning0) return;
    const dy = turning0.y - e.clientY;
    if (Math.abs(dy) > 3) turning0.moved = true;
    if (turning0.moved) setFlame(turning0.k + dy / 120);
  });
  knob.addEventListener('pointerup', () => {
    if (turning0 && !turning0.moved) setFlame(flame < 0.02 ? 0.35 : flame < 0.6 ? 0.65 : flame < 0.95 ? 1 : 0);
    turning0 = null; knob.blur();
  });
  knob.addEventListener('wheel', (e) => { e.preventDefault(); setFlame(flame + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
  knob.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { setFlame(flame + 0.05); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { setFlame(flame - 0.05); e.preventDefault(); e.stopPropagation(); }
  });
  showFlame();
  // THE DOCK (foot-dock.js): Pack and the tablet, the same buttons and keys (I, P, T) the street has on foot
  const dock = bindFootDock(root, { pack: (tab) => S.pack.toggle(tab), tablet: () => sendCmd('tablet') });
  // THE PACK (room-pack.js): what you carry and wear, on a paper doll of you, from the dock, I, P (on what you can
  // eat and drink) or a wardrobe's Change clothes. Never the tablet. Eating and drinking from it is the first-person
  // ritual in your hands, as Pockets was; a can of paint opens on the wall you're facing, as G does.
  S.pack = createPack({
    host: root, silent: sendCmdSilent, cmd: sendCmd, spray: () => openCan(),
    take: (it) => takeInHand(it),
    onToggle: (open) => { dock.setPack(open); packView(open); },
    turn: (dYaw, dPitch, zoom) => packTurn(dYaw, dPitch, zoom),
  });

  // A CUP CLOSE UP (room-closeup.js): examining a trophy case takes the camera round its Cup (gl/room-cup.js), to turn
  // it and read who's engraved on it. `cupFor` is the case's id; a room rebuilt without it shuts the view.
  S.closeup = createCloseup({ host, target: () => cupTarget(), onClose: () => { S.cupFor = null; } });
  function cupTarget() {
    const p = S.cupFor != null ? S.L?.placed?.find((q) => q.id === S.cupFor) : null;
    if (!p) return null;
    const c = trophyCup(p), L = S.L, [fu, fv] = facing(p.turn);
    const o = L.world(p.u, p.v, c.foot), f = L.world(p.u + fu, p.v + fv, c.foot);
    // looking at its front is looking back along the way it faces
    // (the eye stays under the case's lid, which is its top 8 cm: gl/room-stadium.js trophy)
    return { c: [o[0], o[2]], y0: o[1], y1: o[1] + (c.top - c.foot), front: Math.atan2(o[0] - f[0], o[2] - f[2]), near: c.r + 0.09, far: 1.6, ceil: o[1] + (c.lid - c.foot) - 0.03 };
  }

  // YOU, IN THE PACK. While it's open the camera leaves your eyes and goes round you: your close-up figure, in what
  // the Pack says you have on (paper-doll.js figureWorn, since a player's figure carries no clothes of its own),
  // framed in the panel's clear box (room-pack.js dollRect), turned all the way round by a drag there, Q and E.
  // The walls come down as they do to arrange the room (room-arrange.js cutaway), so the camera can stand anywhere
  // round you, and the furniture goes, all but the seat you're on, or a fridge or a worktop between it and you hides
  // you; the room's lamps still light the floor. The mesh goes back whole when the Pack shuts. Your body stays where
  // you are, facing where you looked.
  const PACK_FOV = 38, PACK_PITCH = -0.28;
  const packCuts = new WeakMap();
  function packCut(m) {
    const on = S.walk?.sat?.piece ?? null, Lp = { ...S.L, placed: S.L.placed.filter((q) => q.id === on) };
    const bare = bakedMesh(S.key + '|pack|' + (on ?? ''), Lp, { seed, lampOn, doorShut: S.doorShut, joined });
    const c = packCuts.get(bare);
    if (c && c.L === S.L) return c.m;
    const out = { ...cutaway(bare, S.L), lamps: m.lamps, windows: m.windows };
    packCuts.set(bare, { L: S.L, m: out });
    return out;
  }
  function packView(open) {
    const was = !!S.packCam;
    S.packCam = open && S.L && S.walk?.at ? { yaw: seat.yaw + Math.PI, pitch: PACK_PITCH, zoom: 1, goal: { yaw: seat.yaw + Math.PI, pitch: PACK_PITCH, zoom: 1 }, face: seat.yaw, t: 0 } : null;
    if (was !== !!S.packCam && S.mesh) R.setRoom(S.mesh, paint);
  }
  function packTurn(dYaw = 0, dPitch = 0, zoom = 1) {
    const g = S.packCam?.goal;
    if (!g) return;
    g.yaw += dYaw;
    g.pitch = Math.max(-1.2, Math.min(0.12, g.pitch - dPitch));
    g.zoom = Math.max(0.4, Math.min(1.6, g.zoom * zoom));
  }
  // the camera: round you at the goal's angle, far enough back that you fill the clear box, and turned off you by
  // as much as the box is off the middle of the picture, so you stand in it and not behind the grid
  function packCamNow(now) {
    const pc = S.packCam, L = S.L, w = S.walk, r = S.pack?.dollRect(), cr = canvas.getBoundingClientRect();
    if (!pc || !L || !w?.at || !r || !r.height || !cr.height) return null;
    const dt = pc.t ? Math.min(0.1, (now - pc.t) / 1000) : 0.016, k = 1 - Math.exp(-dt * 14);
    pc.t = now;
    pc.yaw += (pc.goal.yaw - pc.yaw) * k; pc.pitch += (pc.goal.pitch - pc.pitch) * k; pc.zoom += (pc.goal.zoom - pc.zoom) * k;
    const m = S.spec.unit === 'ft' ? FT_PER_M : 1, s = w.sat, at = s ? [s.u, s.v] : w.at;
    const mid = (s ? (s.lie ? 0.5 : 0.72) : 0.95) * m, span = (s ? (s.lie ? 1.4 : 1.55) : 2.05) * m;
    const half = PACK_FOV * Math.PI / 360, hf = r.height / cr.height, aspect = cr.width / cr.height;
    const d = span / (2 * hf * Math.tan(half)) * pc.zoom;
    const c = L.world(at[0], at[1], mid), cp = Math.cos(pc.pitch);
    const eye = [c[0] - Math.sin(pc.yaw) * cp * d, c[1] - Math.sin(pc.pitch) * d, c[2] - Math.cos(pc.yaw) * cp * d];
    const nx = ((r.left + r.width / 2) - (cr.left + cr.width / 2)) / (cr.width / 2), ny = ((cr.top + cr.height / 2) - (r.top + r.height / 2)) / (cr.height / 2);
    const ax = Math.atan(nx * Math.tan(half) * aspect), ay = Math.atan(ny * Math.tan(half));
    return { eye, yaw: pc.yaw + ax, pitch: pc.pitch - ay, fov: PACK_FOV, mode: 'free' };
  }
  // your body for it: stood where you are, or in your seat, dressed from the Pack (kept per outfit)
  let packFig = { sig: null, fig: null };
  function packBody() { return S.packCam ? selfBody(S.packCam.face) : null; }
  // You, as a mirror shows you (gl/room.js mirror pass): as the Pack draws you, facing the way you look, your head
  // tipped with the camera and your eyes straight ahead, walking while you're on the move.
  const selfWalk = { at: null, walked: 0, moved: -1 };
  function mirrorBody(t) {
    const me = selfBody(seat.yaw), at = S.walk?.at;
    if (!me) return null;
    if (at && selfWalk.at && !S.walk.sat) { const d = Math.hypot(at[0] - selfWalk.at[0], at[1] - selfWalk.at[1]); if (d > 0.002 && d < 1) { selfWalk.walked += d; selfWalk.moved = t; } }
    selfWalk.at = at ? [...at] : null;
    const walking = !S.walk?.sat && t - selfWalk.moved < 0.2;
    return { ...me, gaze: [0, 0], look: [0, seat.pitch || 0], ...(walking ? { clip: 'walk', walked: selfWalk.walked } : {}) };
  }
  function selfBody(face) {
    const w = S.walk;
    if (!w?.at || !S.L) return null;
    const mine = S.people.find((p) => p.id === S.you), base = (mine && figOf(mine)) || figOf({ look: lookOfPlayer({}) }) || {};
    const items = S.pack?.worn(), sex = mine?.sex || 'male';
    const sig = items ? items.filter((x) => x.worn && x.slot).map((x) => x.id).join(',') : '';
    if (packFig.sig !== sig || packFig.base !== base) packFig = { sig, base, fig: items ? { ...base, ...figureWorn(items, { sex, skin: base.skin || null }) } : base };
    const s = w.sat;
    const pl = s ? { seat: s, at: [s.u, s.v], yaw: s.yaw, pose: s.lie ? 'lie' : 'sit', head: s.head, top: s.top, ...(s.back != null && !s.lie ? { back: s.back } : {}), ...(s.lift && !s.lie ? { lift: s.lift } : {}) }
      : { at: [...w.at], yaw: face, pose: 'stand' };
    return { id: S.you, ...pl, sculpt: true, sex, figure: packFig.fig };
  }

  // ── THE SPRAY CAN (room-tags.js, spray-session.js) ──
  // G, or the can in Pockets, opens the can on the room's wall: `spraycan` is the ordinary verb, and the server says
  // whether there's a can on you. Over the Stage the dialog's SPRAY IT runs the spray session (spray-aim.js), the paint
  // goes on the wall you were facing when you pressed it, and the session's piece is shown there as it fills in.
  // (the tags are baked here and kept, since the join sends the decals again every frame it plays)
  function paintTags() {
    if (!S.L) return;
    const list = tagDecals(S.L, S.tags);
    const lv = S.sprayLive;
    if (lv?.src && lv.src.width > 1) {
      const q = tagQuad(S.L, lv.spot, lv.src.width / Math.max(1, lv.src.height), lv.len);
      list.push({ key: 'spray:live', src: lv.src, fresh: lv.fresh, ...q });
      lv.fresh = false;
    }
    S.tagList = list;
    pushDecals();
    // a fresh canvas is uploaded once
    if (lv) for (const d of S.tagList) if (d.key === 'spray:live') d.fresh = false;
  }
  S.paintTags = paintTags;
  function pushDecals(scene = null) {
    try { R.setDecals([...(S.tagList || []), ...restingSheets(), ...stadium.decals(), ...vendorUi.decals(), ...(S.vitals?.decals() || []), ...(scene || [])]); } catch (err) { console.warn('[room] paint:', err?.message); }
  }

  // ── SHEETS HUNG AS A RUN, AND THE JOIN (room-sheets.js, plugins/posters `room.sheets`) ──
  // Each set's run is worked out once a layout. A whole set this browser has seen join is drawn as one sheet; a whole
  // set it hasn't plays the join once the room's settled, and a set made whole while you're here plays it then. A set
  // that loses a sheet forgets it joined, so making it whole again plays the join again.
  function joinedKey(set) { return `rs-joined:${S.msg.zone}:${set}`; }
  function seenJoin(set) { try { return localStorage.getItem(joinedKey(set)) === '1'; } catch { return false; } }
  function markJoin(set, on) { try { if (on) localStorage.setItem(joinedKey(set), '1'); else localStorage.removeItem(joinedKey(set)); } catch { /* it plays again, that's all */ } }
  function runsNow() {
    const c = S.sheetRunsFor;
    // arranging, the posters are where the draft has them (room-arrange.js sheets), worked out fresh each time
    if (S.arrange?.on) { const list = S.arrange.sheets(S.sheets); return S.L && list.length ? sheetRuns(S.L, list) : []; }
    const wd = S.wallDrag?.kind === 'sheet' ? S.wallDrag : null;
    if (wd) return S.L ? sheetRuns(S.L, S.sheets.map((s) => (s.set === wd.set ? { ...s, spot: wd.spot } : s))) : [];
    if (c?.L === S.L && c.sheets === S.sheets) return c.runs;
    const runs = S.L && S.sheets.length ? sheetRuns(S.L, S.sheets) : [];
    S.sheetRunsFor = { L: S.L, sheets: S.sheets, runs };
    return runs;
  }
  // every set but the one joining, as it rests
  function restingSheets() {
    if (!S.L) return [];
    const runs = runsNow().filter(({ g }) => g.set !== S.scene?.set);
    return sheetDecals(S.L, runs, new Set(runs.filter(({ g }) => isWhole(g) && seenJoin(g.set)).map(({ g }) => g.set)), { laid: !!S.arrange?.on });
  }
  function skipOnTap(e) { if (S.scene) { S.scene.skip(); e.stopPropagation(); e.preventDefault(); } }
  function startJoin(set) {
    if (S.scene || !S.L || S.arrange?.on || S.cooking) return false;
    const it = runsNow().find(({ g }) => g.set === set && isWhole(g));
    // (and its pictures are in: a set cut from one draws nothing until they are)
    if (!it || !sheetDecals(S.L, [it]).length) return false;
    S.scene = createSheetScene({ L: S.L, run: it.run, g: it.g, width: it.width, height: it.height, seat, aspect: () => (host.clientWidth || 16) / (host.clientHeight || 9), now: performance.now() });
    root.classList.add('rs-cine');
    host.addEventListener('pointerdown', skipOnTap, true);
    return true;
  }
  function endJoin() {
    if (!S.scene) return;
    S.scene = null;
    root.classList.remove('rs-cine');
    host.removeEventListener('pointerdown', skipOnTap, true);
    pushDecals();
  }
  // this frame of the join, if one's playing: its camera, with its decals sent
  function joinFrame(now) {
    const sc = S.scene;
    if (!sc) return null;
    const f = sc.frame(now);
    if (f.done) { markJoin(sc.set, true); endJoin(); return null; }
    pushDecals(f.decals);
    return f;
  }
  // a whole set not yet seen to join, a couple of seconds after the room's up
  function watchJoins(now) {
    if (S.scene || !S.L || !S.sheets.length) return;
    if (!S.builtAt) S.builtAt = now;
    if (now - S.builtAt < 2200) return;
    for (const { g } of runsNow()) if (isWhole(g) && !seenJoin(g.set) && startJoin(g.set)) return;
  }
  Object.assign(S, { startJoin, endJoin, markJoin });
  // a set cut from a picture goes up once the picture's in
  onArt(() => { if (ui?.S === S) paintTags(); });
  function openCan() { sendCmdSilent('spraycan'); }
  const sprayHost = {
    label: 'the wall in here', ground: 'plaster',
    aim: () => (S.L && S.walk?.at ? aimWall(S.L, seat.eye, seat.yaw || 0, seat.pitch || 0) : null),
    // the piece as this room's wall will have it, so what goes on in the session is what stays up
    bake: (text, runs, face, finish) => bakeRoomTag({ t: text, r: runs, f: face, x: finish, v: tagVariant(S.here || S.msg.zone) }),
    preview(src, fresh, len = 12) {
      if (!src) { S.sprayLive = null; paintTags(); return; }
      if (!S.sprayLive) {
        // the spot is fixed once, at the first paint: turning your head mid-piece doesn't move it
        let spot = null;
        try { spot = sprayHost.aim(); } catch { spot = null; }
        S.sprayLive = { spot, src, fresh: true, len };
      }
      S.sprayLive.src = src; S.sprayLive.fresh = S.sprayLive.fresh || !!fresh;
      paintTags();
    },
    // sent: the live piece stays up until the server's `room_tags` puts the real one there, or a few seconds pass
    done() { const lv = S.sprayLive; setTimeout(() => { if (ui?.S === S && S.sprayLive === lv) { S.sprayLive = null; paintTags(); } }, 5000); },
  };
  S.sprayHost = sprayHost;
  setSprayStage(sprayHost);
  root.querySelector('.rs-leave').addEventListener('click', () => closeRoomStage());

  // looking round: a drag turns the head the way the mouse moves, held where you leave it
  const turn = (dx, dy) => { seat.yaw -= dx * TURN; seat.pitch = Math.max(-1.35, Math.min(1.35, seat.pitch - dy * TURN)); };
  let drag = null;
  // STROKING A CAT with the mouse (a pet: plugins/pets, gl/room-beasts.js): press on him and drag. He answers the spot
  // under the pointer at once, here (catTouch: he leans and rubs into your hand, or turns round at you), and every
  // PET_EVERY of stroking it's sent as the typed 'pet <cat> <spot>', so the server's ladder runs and everybody in the
  // room sees him answer. Hovering over his face, he looks at the pointer.
  const PET_EVERY = 1100, PET_REACH = 1.5;
  const PET_SAY = { chin: 'Scratch under the chin', cheek: 'Rub his cheek', head: 'Stroke his head', ears: 'Rub behind the ears', back: 'Stroke his back', tail: 'Stroke his tail', paws: 'Touch a paw', belly: 'Rub his belly' };
  let petting = null;
  const catUnder = (x, y, w, h) => (S.walk && S.beasts?.some((b) => b?.cat) ? catHit(R.project, x, y, w, h, S.beasts) : null);
  const catNear = (id) => { const A = catActors().get(id), me = S.walk?.at; return !!A && !!me && Math.hypot(A.at[0] - me[0], A.at[1] - me[1]) <= PET_REACH; };
  const petSend = (p) => { sendCmdQuiet((p.person ? 'caress ' : 'pet ') + p.name + ' ' + p.spot); p.sent = performance.now(); p.moved = 0; if (p.person) S.tickle.set(p.id, performance.now() + 1600); };
  // TICKLING SOMEBODY WHO'S YOURS (plugins/consort life.js): the same press-and-drag, on a person the server marks
  // `keeper` as you. The spot is how far down them the pointer is; they laugh and squirm at once here, and every
  // PET_EVERY of it is sent as the typed 'caress <name> <spot>', so the server's ladder runs and the room sees it.
  S.tickle = new Map();   // person id → performance.now() the squirm lasts until
  const TICKLE_SAY = { hair: 'Ruffle their hair', cheek: 'Touch their cheek', neck: 'Tickle their neck', shoulder: 'Squeeze a shoulder', back: 'Tickle their back', waist: 'Tickle their sides', thigh: 'Tickle a knee', hand: 'Take their hand' };
  const tickleAt = (x, y, w, h) => {
    if (!S.walk) return null;
    const p = personAt(x, y, w, h);
    if (!p?.keeper || p.keeper !== S.you) return null;
    const pl = placeOf(p);
    const base = S.L.baseAt(pl.at[0], pl.at[1]), top = pl.pose === 'lie' ? (pl.top || 0.4) + 0.5 : (pl.pose === 'sit' ? 1.45 + (pl.lift || 0) : 1.95) + base;
    const a = R.project(S.L.world(pl.at[0], pl.at[1], top), w, h), b = R.project(S.L.world(pl.at[0], pl.at[1], base), w, h);
    if (!a || !b) return null;
    const f = (y - a.y) / Math.max(1, b.y - a.y), side = Math.abs(x - (a.x + b.x) / 2) / Math.max(12, (b.y - a.y) * 0.3);
    const spot = f < 0.09 ? 'hair' : f < 0.15 ? 'cheek' : f < 0.2 ? 'neck' : side > 0.6 && f < 0.55 ? (f < 0.3 ? 'shoulder' : 'hand') : f < 0.4 ? 'back' : f < 0.56 ? 'waist' : 'thigh';
    const me = S.walk.at, near = Math.hypot(pl.at[0] - me[0], pl.at[1] - me[1]) <= PET_REACH + 0.3;
    return { id: p.id, name: String(p.name).split(/\s+/)[0], spot, near, person: true };
  };
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    // a click on the world takes the keyboard back from the command line, so WASD walks again
    if (!e.target.closest('input, textarea, select, [contenteditable]')) {
      const f = document.activeElement; if (f?.matches?.('input, textarea, [contenteditable]')) f.blur();
    }
    if (e.button === 0 && ui?.hands?.click?.()) { e.preventDefault(); return; }
    if (e.button === 1) e.preventDefault();
    // pressing on a cat starts stroking it, not looking round
    if (e.button === 0) {
      const b = host.getBoundingClientRect(), hit = catUnder(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      const tk = !hit && tickleAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      if (tk) {
        if (!tk.near) { flash(`${tk.name} is out of reach.`, false); return; }
        petting = { ...tk, x: e.clientX, y: e.clientY, moved: 0, sent: 0, pointer: e.pointerId };
        S.tickle.set(tk.id, performance.now() + 1600);
        host.style.cursor = 'grabbing';
        try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        e.preventDefault();
        return;
      }
      if (hit) {
        if (!catNear(hit.id)) { flash(`${hit.name || 'The cat'} is out of reach.`, false); return; }
        petting = { id: hit.id, name: hit.name, spot: hit.spot, x: e.clientX, y: e.clientY, moved: 0, sent: 0, pointer: e.pointerId };
        catTouch(hit.id, { ...hit, down: true });
        host.style.cursor = 'grabbing';
        try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        e.preventDefault();
        return;
      }
    }
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId };
    // a poster or a hung piece of yours under the press: a drag (past WALL_GRAB_PX) slides it along the walls instead
    // of turning the view; a click is still a click
    if (e.button === 0 && S.walk && !S.cooking && !S.scene && (msg.mine || msg.admin)) {
      const b = host.getBoundingClientRect(), g = wallGrabAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      if (g) wallGrab = { ...g, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, live: false };
    }
    try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  const hoverEl = root.querySelector('.rs-hover'), flashEl = root.querySelector('.rs-flash');

  // ── POSTERS AND HUNG PIECES DRAGGED ALONG THE WALLS (the walk view) ──
  // The owner (or staff) grabs a poster run or a piece that hangs on a wall and slides it: along its wall, or round
  // onto another (never glass). Its middle goes on the wall grid (room-sheets.js WALL_GRID), or right against the
  // poster or hung piece beside it when it comes that near, the same snaps as the arrange mode. Letting go sends the
  // ordinary `arrange layout` Save for just that one thing (plugins/roomstage arrangeLayout), so the server checks
  // it as it does any layout; until it answers it's drawn where it was put, and a refusal puts it back.
  const WALL_GRAB_PX = 8, FLUSH_M = 0.2, KISS_M = 0.06;
  let wallGrab = null;
  const kOf = () => (S.spec?.unit === 'ft' ? FT_PER_M : 1);
  const wallsHere = () => ['left', 'right', 'front', 'back'].filter((w) => !(Array.isArray(S.spec?.glass) && S.spec.glass.includes(w)));
  const sideWall = (w) => w === 'left' || w === 'right';
  function hungHere() {
    const k = kOf();
    return (S.L?.placed || []).flatMap((q) => {
      const p = S.pieces.find((x) => x.id === q.id);
      if (!p || !q.wall || p.spot?.on || !pieceHangs(p)) return [];
      const mid = Number.isFinite(q.mount) ? q.mount : Math.max(0.6 * k, (Number(p.mount) || 1.5) * k - q.h / 2) + q.h / 2;
      return [{ p, q, wall: q.wall, c: sideWall(q.wall) ? q.v : q.u, half: q.w / 2, y: mid, hh: q.h / 2, d: q.d }];
    });
  }
  const inQuad = (x, y, Q) => {
    if (Q.some((p) => !p)) return false;
    let sgn = 0;
    for (let i = 0; i < 4; i++) {
      const a = Q[i], b = Q[(i + 1) % 4], c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) { if (sgn && Math.sign(c) !== sgn) return false; sgn = Math.sign(c); }
    }
    return true;
  };
  const faceQuad = (wall, c, half, y, hh, d, w, h) => [[c - half, y + hh], [c + half, y + hh], [c + half, y - hh], [c - half, y - hh]].map(([a, yy]) => R.project(wallPoint(S.L, wall, a, yy, d), w, h));
  function wallGrabAt(x, y, w, h) {
    if (!S.L) return null;
    for (const r of runsNow()) {
      if (inQuad(x, y, faceQuad(r.run.wall, r.run.c, r.width / 2, r.run.y, r.height / 2, 0.03, w, h))) return { kind: 'sheet', set: r.g.set, wall: r.run.wall, c: r.run.c, half: r.width / 2, y: r.run.y };
    }
    for (const H of hungHere()) {
      if (!(msg.admin || H.p.placed)) continue;
      if (inQuad(x, y, faceQuad(H.wall, H.c, H.half, H.y, H.hh, H.d, w, h))) return { kind: 'piece', id: H.p.id, name: H.p.name, wall: H.wall, c: H.c, half: H.half, y: H.y };
    }
    return null;
  }
  // the wall and how far along it under the pointer, at the grabbed thing's height: the nearest point on screen
  function wallUnder(x, y, w, h, at) {
    const L = S.L, hu = L.w / 2, step = 0.05 * kOf();
    let best = null;
    for (const wall of wallsHere()) {
      const lo = sideWall(wall) ? 0 : -hu, hi = sideWall(wall) ? L.d : hu;
      for (let a = lo; a <= hi; a += step) {
        const p = R.project(wallPoint(L, wall, a, at, 0), w, h);
        if (!p) continue;
        const dd = Math.hypot(p.x - x, p.y - y);
        if (!best || dd < best.dd) best = { wall, along: a, dd };
      }
    }
    return best;
  }
  function wallDragTo(x, y, w, h) {
    const g = wallGrab, at = wallUnder(x, y, w, h, g.y);
    if (!at) return;
    if (!('off' in g)) g.off = at.wall === g.wall ? g.c - at.along : 0;
    const along = at.along + (at.wall === g.wall ? g.off : 0);
    if (g.kind === 'sheet') {
      const others = runsNow().filter((r) => r.g.set !== g.set).map((r) => ({ wall: r.run.wall, c: r.run.c, half: r.width / 2 }));
      const spot = { wall: at.wall, along: Math.round(snapRun(S.L, at.wall, along, g.half, others) * 100) / 100 };
      if (JSON.stringify(spot) === JSON.stringify(S.wallDrag?.spot)) return;
      S.wallDrag = { kind: 'sheet', set: g.set, spot };
      paintTags();
      return;
    }
    // a hung piece: in metres on its spot; the grid, then flush against a hung neighbour on that wall
    const k = kOf(), L = S.L, len = (sideWall(at.wall) ? L.d : L.w) / k, base = sideWall(at.wall) ? 0 : -len / 2, half = g.half / k;
    let m = Math.round((along / k) / WALL_GRID_M) * WALL_GRID_M, flush = null;
    for (const H of hungHere()) {
      if (H.p.id === g.id || H.wall !== at.wall) continue;
      for (const c of [H.c / k + H.half / k + half + KISS_M, H.c / k - H.half / k - half - KISS_M]) if (Math.abs(c - along / k) < FLUSH_M && (flush === null || Math.abs(c - along / k) < Math.abs(flush - along / k))) flush = c;
    }
    if (flush !== null) m = flush;
    m = Math.max(base + half, Math.min(base + len - half, m));
    const spot = cleanSpot({ wall: at.wall, along: m });
    if (!spot || JSON.stringify(spot) === JSON.stringify(S.wallDrag?.spot)) return;
    S.wallDrag = { kind: 'piece', id: g.id, spot };
    rebuild();
  }
  function wallDrop() {
    const wd = S.wallDrag;
    if (!wd) return;
    const word = (sp) => `${sp.wall}:${Number(sp.along).toFixed(2)}`;
    S.wallUndo = { pieces: S.pieces, sheets: S.sheets };
    S.wallDrag = null;
    if (wd.kind === 'sheet') {
      const mine = S.sheets.filter((s) => s.set === wd.set);
      if (!mine.length) { paintTags(); return; }
      S.sheets = S.sheets.map((s) => (s.set === wd.set ? { ...s, spot: wd.spot } : s));
      paintTags();
      sendCmdSilent(`arrange layout ${mine.map((s) => `sheet:${s.id}@${word(wd.spot)}`).join(' ')}`);
      return;
    }
    S.pieces = S.pieces.map((p) => (p.id === wd.id ? { ...p, spot: wd.spot } : p));
    rebuild();
    sendCmdSilent(`arrange layout ${wd.id}@${word(wd.spot)}`);
  }
  // the server said no (roomArranged): back where it was, and why
  S.wallRefused = (m) => {
    const u = S.wallUndo;
    S.wallUndo = null;
    if (!u) return;
    S.pieces = u.pieces; S.sheets = u.sheets;
    rebuild(); paintTags();
    flash(m || "It won't go there.", false);
  };
  const label = (hit) => {
    if (!hit) return '';
    if (hit.who) return `Talk to ${hit.who.name}`;
    if (hit.station?.verb === 'workspace') return `Work at the ${hit.station.target}`;
    if (hit.station?.verb === 'examine' && S.pieces.find((x) => x.id === hit.station.piece)?.acts?.some((a) => a.verb === 'workspace')) return `Work at the ${hit.station.target}`;
    if (hit.station && S.pieces.find((x) => x.id === hit.station.piece)?.pod) return 'Step into the MORPHEX';
    if (hit.station?.verb === 'keypad' && msg.keypad) return 'Use the keypad';
    if (hit.station) { const p = S.pieces.find((x) => x.id === hit.station.piece); return p ? `${hit.station.verb === 'open' ? 'Open' : hit.station.verb === 'watch' ? 'Watch' : 'Look at'} the ${p.name}` : ''; }
    const p = S.pieces.find((x) => x.id === hit.seat.piece), who = takenBy(hit.seat);
    return who ? `${who.name} is there` : p ? `${hit.seat.lie ? 'Lie on' : 'Sit on'} the ${p.name}` : '';
  };
  host.addEventListener('pointermove', (e) => {
    const b = host.getBoundingClientRect();
    if (wallGrab && e.pointerId === wallGrab.pointer) {
      if (!wallGrab.live && Math.hypot(e.clientX - wallGrab.x0, e.clientY - wallGrab.y0) > WALL_GRAB_PX) { wallGrab.live = true; drag = null; hoverEl.hidden = true; }
      if (wallGrab.live) { host.style.cursor = 'grabbing'; wallDragTo(e.clientX - b.left, e.clientY - b.top, b.width, b.height); }
      return;
    }
    if (petting && e.pointerId === petting.pointer) {
      petting.moved += Math.hypot(e.clientX - petting.x, e.clientY - petting.y);
      petting.x = e.clientX; petting.y = e.clientY;
      if (petting.person) {
        const tk = tickleAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
        if (tk && tk.id === petting.id) {
          petting.spot = tk.spot;
          if (petting.moved > 6) S.tickle.set(tk.id, performance.now() + 1600);
          if (petting.moved > 24 && performance.now() - petting.sent > PET_EVERY) petSend(petting);
        }
        return;
      }
      const hit = catUnder(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      if (hit && hit.id === petting.id) {
        petting.spot = hit.spot;
        catTouch(hit.id, { ...hit, down: true });
        if (petting.moved > 24 && performance.now() - petting.sent > PET_EVERY) petSend(petting);
      }
      return;
    }
    if (!drag && S.walk && !S.cooking) {
      const hit = catUnder(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      if (hit) {
        catTouch(hit.id, { ...hit, down: false });
        host.style.cursor = 'grab';
        hoverEl.hidden = false;
        hoverEl.textContent = catNear(hit.id) ? `${hit.name}: ${(PET_SAY[hit.spot] || 'Stroke him').toLowerCase()}` : `${hit.name}`;
        hoverEl.style.left = (e.clientX - b.left + 16) + 'px'; hoverEl.style.top = (e.clientY - b.top + 12) + 'px';
        return;
      }
      const tk = tickleAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      if (tk) {
        host.style.cursor = 'grab';
        hoverEl.hidden = false;
        hoverEl.textContent = tk.near ? `${tk.name}: ${TICKLE_SAY[tk.spot].toLowerCase()}` : tk.name;
        hoverEl.style.left = (e.clientX - b.left + 16) + 'px'; hoverEl.style.top = (e.clientY - b.top + 12) + 'px';
        return;
      }
    }
    // cooking, what's under the pointer is the kitchen's to say (kitchen-stage.js hoverAt)
    if (!drag && S.walk && !S.cooking) {
      const x = e.clientX - b.left, y = e.clientY - b.top, who = personAt(x, y, b.width, b.height);
      const on = tvPoint(x, y, b.width, b.height), btn = on && S.tv.buttonAt(on.u, on.v);
      S.tv?.touching(on);
      const dial = !btn && !who && dialAt(x, y, b.width, b.height);
      const vh = !btn && !who && vendorUi.hitAt(x, y, b.width, b.height, S.walk.at);
      const t = vh ? vh.act.label : btn ? btn.title || btn.getAttribute('aria-label') || 'Press' : on && !who ? 'Scroll to change the channel' : dial ? (dial.kind === 'switch' ? 'The light switch' : `Turn the fire: ${flame < 0.02 ? 'pilot' : Math.round(flame * 100) + '%'} (scroll)`) : label(who ? { who } : S.walk.hit(x, y, b.width, b.height));
      host.style.cursor = t ? 'pointer' : '';
      hoverEl.hidden = !t;
      if (t) { hoverEl.textContent = t; hoverEl.style.left = (e.clientX - b.left + 16) + 'px'; hoverEl.style.top = (e.clientY - b.top + 12) + 'px'; }
    }
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (dx || dy) turn(dx, dy);
  });
  host.addEventListener('pointerup', (e) => {
    if (wallGrab && e.pointerId === wallGrab.pointer) {
      const g = wallGrab; wallGrab = null;
      if (g.live) { drag = null; host.style.cursor = ''; wallDrop(); return; }
    }
    if (petting && e.pointerId === petting.pointer) {
      // a press with no stroke to speak of is a pat on that spot, sent once
      if (!petting.sent) petSend(petting);
      if (!petting.person) catTouch(petting.id, null);
      petting = null; host.style.cursor = 'grab';
      return;
    }
    const d = drag; drag = null;
    if (!d || !S.walk || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 14) return;
    const b = host.getBoundingClientRect();
    // a button on the picture first, in this same event: going full screen needs the click's own turn
    const on = tvPoint(e.clientX - b.left, e.clientY - b.top, b.width, b.height), btn = on && S.tv.buttonAt(on.u, on.v);
    if (btn) { btn.click(); return; }
    // a vending machine's button, or its plug, pressed on the machine itself
    const vh = vendorUi.hitAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height, S.walk.at);
    if (vh) { if (vh.act.verb === 'vendpress') vendorUi.press(vh.piece.id, vh.act.item); S.listenUntil = performance.now() + 2500; sendCmd(vh.act.cmd); return; }
    const who = personAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    if (who) { S.held = { who: who.id, at: [...S.walk.at] }; return; }
    // the fire's dial, before the fireplace it's on
    const dial = dialAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    if (dial) { if (fireDialOpen === dial) closeFire(); else openFire(dial); return; }
    const hit = S.walk.hit(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    const id = hit?.station?.piece ?? hit?.seat?.piece, piece = S.pieces.find((p) => p.id === id);
    if (!piece) { S.held = null; return; }
    if (!reachable(piece)) { flash(`The ${piece.name} is through the door.`, false); return; }
    S.held = { piece: id, at: [...S.walk.at] };
  });
  host.addEventListener('pointercancel', () => { if (wallGrab?.live) { S.wallDrag = null; rebuild(); paintTags(); } wallGrab = null; drag = null; if (petting) { if (!petting.person) catTouch(petting.id, null); petting = null; } });
  host.addEventListener('pointerleave', () => { hoverEl.hidden = true; host.style.cursor = ''; S.tv?.touching(false); });
  // the wheel on the set: how far it turns for a station (a mouse's notch is 100), the least time between two,
  // and how long a pause starts the count again
  const TV_WHEEL_NOTCH = 50, TV_WHEEL_GAP = 220, TV_WHEEL_IDLE = 400;
  const tvWheel = { sum: 0, at: 0, stepped: 0 };
  host.addEventListener('wheel', (e) => {
    e.preventDefault();
    // over a dial or the switch, the wheel turns it, and the knob on the fire turns with it (gl/room-sky.js dialFace)
    if (S.walk) {
      const b = host.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, d = dialAt(x, y, b.width, b.height);
      if (d) {
        const up = e.deltaY < 0;
        if (d.kind === 'switch') setLevel(lampLevel + (up ? 0.05 : -0.05)); else setFlame(flame + (up ? 0.05 : -0.05));
        hoverEl.hidden = false;
        hoverEl.textContent = d.kind === 'switch' ? `Lights ${lightWord().toLowerCase()}` : `Fire ${flame < 0.02 ? 'pilot' : Math.round(flame * 100) + '%'}`;
        hoverEl.style.left = (x + 16) + 'px'; hoverEl.style.top = (y + 12) + 'px';
        return;
      }
      // over the set's picture the wheel changes the channel, a notch a station however fine the wheel turns
      if (tvPoint(x, y, b.width, b.height)) {
        const now = performance.now();
        if (now - tvWheel.at > TV_WHEEL_IDLE) tvWheel.sum = 0;
        tvWheel.at = now;
        tvWheel.sum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        if (Math.abs(tvWheel.sum) >= TV_WHEEL_NOTCH && now - tvWheel.stepped > TV_WHEEL_GAP) {
          const next = S.tv.step(tvWheel.sum < 0 ? 1 : -1);
          tvWheel.sum = 0; tvWheel.stepped = now;
          if (next) {
            hoverEl.hidden = false;
            hoverEl.textContent = `${next.number ? `Channel ${next.number}` : 'Tape'} · ${next.name}`;
            hoverEl.style.left = (x + 16) + 'px'; hoverEl.style.top = (y + 12) + 'px';
          }
        }
        return;
      }
    }
    seat.fov = Math.max(30, Math.min(95, seat.fov * (e.deltaY > 0 ? 1.06 : 1 / 1.06))); }, { passive: false });
  let flashT = 0;
  function flash(text, ok) {
    flashEl.textContent = text; flashEl.classList.toggle('rs-flash-no', !ok);
    flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on');
    clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove('on'), 1800);
  }

  const onKey = (e) => {
    // the Chem Stage has the keys, and so does the kitchen while it's showing you something close up
    if (S.cooking && (S.chemming || S.cookView?.cam)) return;
    // a field over the room (a container's count) keeps its keys, and the tablet has them when it's up
    const field = e.target.closest?.('input, textarea, [contenteditable]');
    if (field && field.closest('#room-stage, #container-panel')) return;
    if (document.getElementById('tablet-os-overlay')) return;
    // so does a cabinet's keypad (panels/keypad.js): its digits mustn't pick a card's line behind it
    if (document.getElementById('keypad-overlay')) return;
    // and the wardrobe's panel: it covers the room, so F or WASD mustn't walk you away behind it
    // (only while it can be seen: an open panel hidden behind the room must never swallow F)
    { const wp = document.getElementById('wardrobe-panel'); if (wp?.classList.contains('active') && wp.getBoundingClientRect().width > 0 && getComputedStyle(wp).zIndex >= 8900) return; }
    if (field) return;
    // the spray can's dialog and its session are over the room, and the room behind mustn't walk off
    if (document.getElementById('spray-overlay') || document.getElementById('spray-session')) return;
    const k = String(e.key || '');
    // the join playing has the keys: Space, Enter or Escape skips it, and nothing walks under it
    if (S.scene) { if (!e.repeat && (k === ' ' || k === 'Enter' || k === 'Escape')) S.scene.skip(); e.preventDefault(); return; }
    // looking at the Cup close up, its view has the keys (room-closeup.js key), Escape steps back
    if (S.closeup?.key(e)) { e.preventDefault(); return; }
    // cooking, you still walk and look: WASD (and Shift) and the arrows. Everything else is the kitchen's
    // (kitchen-stage.js onKey): Q and E are its utensils, F its flip, digits its dial and its keypad, Escape its close
    if (S.cooking) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[wasd]$/i.test(k) || k === 'Shift') { if (S.walk?.key(e, true)) e.preventDefault(); }
      else if (k === 'ArrowLeft') { turn(-26, 0); e.preventDefault(); }
      else if (k === 'ArrowRight') { turn(26, 0); e.preventDefault(); }
      else if (k === 'ArrowUp') { turn(0, -20); e.preventDefault(); }
      else if (k === 'ArrowDown') { turn(0, 20); e.preventDefault(); }
      return;
    }
    // a conversation has the keys. dialogue.js closes a talk on Escape but leaves a shop's to its host
    const talk = document.getElementById('dialogue-panel');
    if (talk?.classList.contains('active')) {
      if (k === 'Escape' && talk.classList.contains('shop-mode')) closeDialogue();
      return;
    }
    // the bypass on a door's hololock has Space and Escape while it's up (room-lock.js)
    if (lockUi.key(e)) { e.preventDefault(); return; }
    // the Pack, while it's open, has the keys: nothing walks or acts behind it (room-pack.js key)
    if (S.pack?.key(e)) { e.preventDefault(); return; }
    // what a machine handed you is in your hands (stands-hands.js): Space, F, Q and Escape are theirs
    if (ui?.hands?.key(e, true)) { e.preventDefault(); return; }
    if (k === 'Escape' && (!fireHud.hidden || !lightHud.hidden)) { closeFire(); e.preventDefault(); return; }
    if (/^[1-9]$/.test(k) && S.card?.acts[k - 1]) { if (!e.repeat) runAct(S.card.acts[k - 1]); e.preventDefault(); return; }
    // sat in a hand at a card table, C is your cards (tap to turn them up, hold to look) and V the view from the ceiling
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (k === 'c' || k === 'C' || k === 'v' || k === 'V') && pokerSeated()) {
      if (!e.repeat) { if (k === 'v' || k === 'V') { S.pokerTop = !S.pokerTop; pokerBar(); } else peekPress(); }
      e.preventDefault(); return;
    }
    if (S.pokerTop && k === 'Escape') { S.pokerTop = false; pokerBar(); e.preventDefault(); return; }
    if (S.walk?.key(e, true)) { e.preventDefault(); return; }
    if (k === 'Escape' && S.held) { S.held = null; e.preventDefault(); }
    // Escape never closes the stage: the toolbar's Close button does (David, 2026-11-12)
    // T, I and P are the dock's (foot-dock.js), as they are on the street
    if (dock.key(e)) e.preventDefault();
    else if ((k === 'g' || k === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) openCan(); e.preventDefault(); }
    else if ((k === 'b' || k === 'B') && (msg.mine || msg.admin) && !e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) startArrange(); e.preventDefault(); }
    else if (k === 'l' || k === 'L') { toggleLamp(); e.preventDefault(); }
    else if ((k === 'n' || k === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) toggleTags(); e.preventDefault(); }
    else if (k === '-' || k === '_') { setLevel(lampLevel - 0.1); e.preventDefault(); }
    else if (k === '=' || k === '+') { setLevel(lampLevel + 0.1); e.preventDefault(); }
    else if ((k === ',' || k === '<') && fires().length) { setFlame(flame - 0.1); e.preventDefault(); }
    else if ((k === '.' || k === '>') && fires().length) { setFlame(flame + 0.1); e.preventDefault(); }
    else if (k === '[' && S.tv?.on) { S.tv.step(-1); e.preventDefault(); }
    else if (k === ']' && S.tv?.on) { S.tv.step(1); e.preventDefault(); }
    else if (k === 'ArrowLeft') { turn(-26, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { turn(26, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { turn(0, -20); e.preventDefault(); }
    else if (k === 'ArrowDown') { turn(0, 20); e.preventDefault(); }
  };
  const onKeyUp = (e) => {
    if ((e.key === 'c' || e.key === 'C') && peekDown) { peekRelease(); return; }
    if (!ui?.hands?.key(e, false)) S.walk?.key(e, false);
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  // Cooking here: kitchen-stage.js mounts over the room. The room stops drawing under it and picks
  // up again where you stood when it closes.
  const onCook = (e) => {
    // the kitchen asks what this room cooks with, and builds its set from the answer
    if (e?.detail && S.L) { try { e.detail.kit = roomKitchenKit(S.L, seed); } catch (err) { console.warn('[room] kitchen kit', err); } }
    // the kitchen is drawn here, into the flat, at the hob, the microwave or a worktop (gl/kitchen.js host):
    // the room keeps drawing, from the kitchen's camera, with the kitchen's pieces as its props
    // at the piece you clicked, if it was a moment ago; else what the room cooks with
    const want = S.cookAt && performance.now() - S.cookAt.t < 20000 ? S.cookAt.id : null;
    S.cookAt = null;
    const frame = e?.detail && S.L ? cookFrame(S.L, want) : null;
    if (frame) {
      e.detail.host = {
        // `show` hands the room the kitchen's pieces every frame, with a camera when the kitchen is showing you
        // something close up (a cut, the plate, the fridge, the microwave's START) and none while you're on
        // your own feet; `view` is your own eye, which the kitchen picks with then
        frame, canvas, show: (v) => { if (!v) { S.cookView = null; R.setProps({ data: new Float32Array(0), n: 0 }); return true; } S.cookView = v; return !R.lost; },
        view: () => (S.walk ? seat : null),
        // the room's own fridges, which the kitchen opens; `hide` takes the ones it draws itself (with their doors
        // and shelves) out of the room's mesh until the kitchen closes, so there's one of each and not two.
        // The microwave the kitchen cooks in is always one of them: it draws it with its door and its light.
        cold: coldIn(S.L, frame),
        // every cooker in the room (hobs, ranges, microwaves), which the kitchen's appliance strip pans
        // between; `switchTo` stands you at another one, by the same road a click on it takes (S.cookAt)
        cookers: cookersIn(S.L, frame.stand?.piece),
        switchTo: (id) => { S.cookAt = { id, t: performance.now() }; sendCmdSilent('workspace'); },
        // the kitchen's drag to look, on your own feet: your eye turns, as a drag on the room does
        turn: (dx, dy) => turn(dx, dy),
        // the burner onto another of the hob's rings (room-cook.js hobRings): the frame, and the fridges in it, again
        setRing: (i) => { const h = e.detail.host, f = cookFrame(S.L, h.frame.piece, i); if (f) { h.frame = f; h.cold = coldIn(S.L, f); } return h.frame; },
        hide: (ids) => {
          const gone = new Set([...(ids || []), ...(frame.oven ? [frame.oven.id] : [])].map(String));
          if (!gone.size || !S.L) return;
          const Lc = { ...S.L, placed: S.L.placed.filter((p) => !gone.has(String(p.id))) };
          const m = bakedMesh(S.key + '|cook|' + [...gone].sort().join(','), Lc, { seed, lampOn, doorShut: S.doorShut, turning: S.spin?.turning, joined });
          R.setRoom(shells.length ? withShells(meshCopy(m), shells) : m, paint);
          S.cookHid = true;
        },
      };
      if (frame.oven) e.detail.host.hide([]);
      // on your feet in front of it, looking at it. Walk off and the kitchen shuts (watchCookStand)
      const w = S.walk, st = frame.stand;
      if (w && st) {
        if (w.sat) w.standUp();
        w.moveTo(st.at);
        seat.yaw = st.yaw; seat.pitch = Math.max(-1.1, Math.min(0.3, st.pitch));
        S.cookStand = st;
      }
    }
    S.cooking = true; root.classList.add('rs-cooking');
    hoverEl.hidden = true;
    if (!frame) { cancelAnimationFrame(raf); raf = 0; }
  };
  const onCooked = () => {
    if (!S.cooking) return;
    S.cooking = false; S.cookStand = null;
    if (S.cookView) { S.cookView = null; R.setProps({ data: new Float32Array(0), n: 0 }); }
    // the fridges the kitchen drew go back into the room
    if (S.cookHid) { S.cookHid = false; R.setRoom(S.mesh, paint); }
    root.classList.remove('rs-cooking');
    if (!raf) raf = requestAnimationFrame(frame);
  };
  window.addEventListener('kitchen:open', onCook);
  window.addEventListener('kitchen:close', onCooked);
  // walked off from where you were cooking: the kitchen shuts, as you'd stop cooking (kitchen-stage.js
  // listens). Not while it's showing you something close up, when you aren't the one moving.
  function watchCookStand() {
    const st = S.cookStand, w = S.walk;
    if (!S.cooking || S.chemming || !st || !w?.at || S.cookView?.cam) return;
    if (Math.hypot(w.at[0] - st.at[0], w.at[1] - st.at[1]) > st.leave) { S.cookStand = null; window.dispatchEvent(new Event('kitchen:walkaway')); }
  }

  // A CHEM LAB HERE (chem-stage.js, docs/proposals/chem-stage.md): the bench and its cook are played at this
  // room's own lab, drawn by this room's renderer from the Stage's camera. The lab is rebuilt with the stage's
  // tools out on it (`working`), and what moves, the liquids, the soft glows and the coloured light are this
  // room's props, props glass, halos and glows. Only a lab that's out: a sealed Cachet has none to give.
  const onChem = (e) => {
    const lab = S.L && (S.L.placed || []).find((q) => q.lab && !q.annex);
    if (!lab || !e?.detail) return;
    const inner = cachetInner(lab);
    e.detail.host = {
      L: S.L, p: inner, canvas, mount: root,
      project: (pt, w, h) => R.project(pt, w, h),
      // the room with the bench at work on `stage` (a stage's name, or true for its open bench cleared), or as it was
      work: (stage) => {
        if (!stage) { R.setRoom(S.mesh, paint); return; }
        const Lc = { ...S.L, placed: S.L.placed.map((q) => (q.id === lab.id ? { ...q, working: stage } : q)) };
        const m = bakedMesh(S.key + '|chem|' + stage, Lc, { seed, lampOn, doorShut: S.doorShut, joined });
        R.setRoom(shells.length ? withShells(meshCopy(m), shells) : m, paint);
      },
      show: (v) => { S.chemView = v || null; return !R.lost; },
    };
    S.chemming = true; S.cooking = true; root.classList.add('rs-cooking');
  };
  const onChemDone = () => {
    if (!S.chemming) return;
    S.chemming = false; S.cooking = false; S.chemView = null;
    R.setProps({ data: new Float32Array(0), n: 0 }); R.setPropsGlass(null); R.setStageHalos(null); R.setGlows([]);
    R.setRoom(S.mesh, paint);
    root.classList.remove('rs-cooking');
  };
  window.addEventListener('chem:open', onChem);
  window.addEventListener('chem:close', onChemDone);

  // the people, as the close-up figure (gl/figure-hd.js), a phone's at the lighter level. Their
  // meshes are built a beat after the room is up, so the room shows first; somebody who walks in
  // later builds theirs on the frame they first appear.
  const tagsEl = root.querySelector('.rs-tags'), figLevel = 'hd';   // a phone's too: indoors nobody is drawn at the lite level
  let peopleOn = false;
  // Bodies move between places smoothly: a step from the floor onto a seat, and a turn at a corner.
  // A walk is already smooth, and a body that's jumped the room just goes there.
  const shown = new Map(), talking = new Map(), onceFrom = new Map(), lips = new Map();
  let easedAt = 0;
  // who's on screen and on your side of the en-suite wall, as of the last frame: their lines go over
  // their heads, and anybody else's stay along the bottom
  const inView = new Set();
  const onSpeaking = (e) => {
    const d = e.detail;
    talking.set(d.name, { until: performance.now() + d.ms, text: d.text });
    if (inView.has(d.name)) d.over = true;
  };
  window.addEventListener('npc:speaking', onSpeaking);
  // the line being voiced, by speaker: its mouth shapes and when it starts
  const onVoice = (e) => {
    const d = e.detail;
    lips.set(d.name, { track: d.trace?.length ? mouthTrack(d.trace) : textTrack(d.text), t0: performance.now() + d.delay * 1000, effort: +d.effort || 0 });
    if (d.voice?.move) voiced.set(d.voice, d.name);
  };
  window.addEventListener('npc:voice', onVoice);
  // ⚠ A VOICE COMES OUT OF ITS MOUTH (docs/systems-procedural-audio.md#oracle-in-3d). npc-bubbles.js asks where a
  // speaker is (`npc:place`) before it voices them, and gets their head on this room's plan, the frame earPose puts
  // the ear in; then each frame (placeVoices) every live line follows its speaker and the ear follows you, so turning
  // to face somebody brings their voice round to the front. Somebody next door talks from where they're drawn,
  // through the doorway. The level falls gently with distance (VOICE_AT): it's a room, and the line must stay heard.
  const HEAD_Z = { stand: 1.6, sit: 1.15, lie: 0.45 }, VOICE_AT = { ref: 1.5, rolloff: 0.6 };
  const voiced = new Map();   // a live line's handle -> its speaker's name
  function speakerSpot(name) {
    let id = null, pl = null;
    const p = S.people.find((q) => q.name === name && q.id !== S.you);
    if (p) { id = p.id; pl = shown.get(id) || placeOf(p); }
    else for (const n of S.next) {
      const i = n.L ? n.people.findIndex((q) => q.name === name) : -1;
      if (i >= 0) { id = n.people[i].id; pl = shown.get(id) || placeNext(n, n.people[i], i); break; }
    }
    if (!pl?.at) return null;
    const head = pl.pose === 'lie' && pl.head ? pl.head : [0, 0];
    return [pl.at[0] + head[0], pl.at[1] + head[1], (HEAD_Z[pl.pose] ?? HEAD_Z.stand) + (pl.pose === 'sit' ? pl.lift || 0 : 0)];
  }
  const earNow = () => {
    const pose = S.walk?.at && earPose(S.walk.at).pose;
    if (pose) window.AudioEngine?.setListenerPose?.({ ...pose, vel: [0, 0, 0], metresPerUnit: 1 });
    return !!pose;
  };
  const onPlace = (e) => {
    const d = e.detail;
    if (!d) return;
    // who they are, for the voice (npc-bubbles.js), whether or not they're placed
    if (!d.sex) {
      const p = (S.people || []).find((q) => q.name === d.name) || (S.next || []).flatMap((n) => n.people || []).find((q) => q.name === d.name);
      if (p?.sex) d.sex = p.sex;
    }
    // how they feel, for the voice (client/shared/delivery.js): the mood the face is showing
    if (!d.mood) {
      const p = (S.people || []).find((q) => q.name === d.name);
      if (p?.mood?.m) d.mood = p.mood;
    }
    if (d.place || !S.walk?.at) return;
    const at = speakerSpot(d.name);
    if (at && earNow()) d.place = { position: at, ...VOICE_AT };
  };
  window.addEventListener('npc:place', onPlace);
  // TALKING TO SOMEBODY (room-talk.js): the camera on their face while a conversation is open (dialogue.js says who,
  // 'npc:talk'); their head is where their voice comes from, raised for a room laid out in feet
  const unitM = () => S.spec?.unit === 'ft' ? FT_PER_M : 1;
  S.talk = createTalkShot({ unit: unitM, head: (name) => { const at = S.L && speakerSpot(name); return at ? S.L.world(at[0], at[1], at[2] * unitM()) : null; } });
  const onTalk = (e) => S.talk.set(e.detail?.name || null);
  window.addEventListener('npc:talk', onTalk);
  { const panel = document.getElementById('dialogue-panel'); if (panel?.classList.contains('active') && !panel.classList.contains('shop-mode')) S.talk.set(document.getElementById('dialogue-npc-name')?.textContent || null); }
  function placeVoices() {
    if (!voiced.size) return;
    earNow();
    for (const [v, name] of voiced) {
      if (v.state()?.closed) { voiced.delete(v); continue; }
      const at = speakerSpot(name);
      if (at) v.move(at);
    }
  }
  // what an emote line says somebody's doing, acted out for a while: "Marla wipes down the bar." By name, as the
  // text gives it; a line about nobody in the room does nothing
  const acting = new Map();
  const onLine = (e) => {
    const text = e.detail?.text || '', who = speakerOf(text, S.people.filter((p) => p.id !== S.you).map((p) => p.name));
    const act = who && actOfLine(text.slice(who.length + 1));
    if (act) acting.set(who, { act, t0: performance.now() });
  };
  window.addEventListener('npc:line', onLine);
  const mouthOf = (name) => {
    const l = lips.get(name);
    if (!l) return undefined;
    const m = mouthAt(l.track, (performance.now() - l.t0) / 1000);
    if (!m && performance.now() > l.t0) lips.delete(name);
    // how hard the line is said (client/shared/delivery.js): the face widens for a yell
    return m ? (l.effort ? { ...m, effort: l.effort } : m) : undefined;
  };
  const SIT_DOWN = 1100, SIT_UP = 700;
  function eased(p, pl) {
    const now = performance.now(), k = 1 - Math.exp(-Math.min(0.1, (now - easedAt) / 1000) * 9), e = shown.get(p.id);
    const out = { ...pl, ...(pl.clip ? { clip: fridgeHand(p, pl, pl.clip) } : {}) };
    if (pl.pose === 'stand' && pl.clip !== 'walk' && talking.get(p.name)?.until > now) out.clip = 'talk';
    // an act an emote line gave them, over whatever they were idling at; not over a walk, a word or a ritual
    else if (acting.has(p.name) && pl.clip !== 'walk' && (!pl.clip || pl.clip === 'listen')) {
      const a = acting.get(p.name), c = actClip(a.act, pl.pose);
      if (!c || now - a.t0 > clipHold(c) * 1000) acting.delete(p.name);
      // from the top of its cycle as the line comes in, so a laugh starts as the text says it does
      else { out.clip = c; out.phase = (((now - a.t0) / 1000) / clipDur(c)) % 1; }
    }
    // a clip that plays once starts from its beginning when it comes on
    const once = clipOnce(out.clip);
    if (!once) onceFrom.delete(p.id);
    else {
      // and again from the top on each beat of an act (a sip, a bite, a dose), which the server counts
      const k = out.clip + '|' + (p.beat || 0);
      if (onceFrom.get(p.id)?.clip !== k) { onceFrom.set(p.id, { clip: k, t0: now }); contactSound(out.clip, once); }
      out.phase = Math.min(0.999, (now - onceFrom.get(p.id).t0) / 1000 / once);
    }
    if (pl.pose === 'lie') return out;
    if (!e || Math.hypot(e.at[0] - pl.at[0], e.at[1] - pl.at[1]) > 2) { shown.set(p.id, { at: [...pl.at], yaw: pl.yaw, pose: pl.pose }); return out; }
    // sitting down and getting up: from on their feet to the seat's clip over SIT_DOWN, turning to face out first
    // and then lowering, the lift (a stool's) coming up with the hips; getting up is the same backwards, quicker
    if (e.pose !== pl.pose && (pl.pose === 'sit' || e.pose === 'sit')) e.sit = { down: pl.pose === 'sit', t0: now, clip: pl.pose === 'sit' ? out.clip || 'sitRest' : e.clip || 'sitRest' };
    e.pose = pl.pose;
    if (pl.pose === 'sit') e.clip = out.clip || 'sitRest';
    if (e.sit) {
      const span = e.sit.down ? SIT_DOWN : SIT_UP, q = Math.min(1, (now - e.sit.t0) / span);
      if (q >= 1) e.sit = null;
      else {
        const r = e.sit.down ? Math.max(0, (q - 0.3) / 0.7) : q, s = r * r * (3 - 2 * r), k2 = e.sit.down ? s : 1 - s;
        out.mix = { a: 'idle', pa: 0, b: e.sit.clip, pb: 0, k: k2 };
        if (pl.lift && pl.pose === 'sit') out.lift = pl.lift * k2;
      }
    }
    if (pl.clip === 'walk') e.at = [...pl.at];
    else { e.at[0] += (pl.at[0] - e.at[0]) * k; e.at[1] += (pl.at[1] - e.at[1]) * k; }
    e.yaw += ((((pl.yaw - e.yaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * k;
    out.at = [...e.at]; out.yaw = e.yaw;
    return out;
  }
  // a player eating, drinking or taking something (plugins/roomstage acts.js): the clip for it, standing or sat, and
  // what's in their right hand (gl/figure-reach.js HELD)
  const ACT_CLIP = { eat: ['eat', 'sitEat'], drink: ['drink', 'sitDrink'], smoke: ['smoke', 'sitSmoke'], swallow: ['swallow', 'sitPill'], inject: ['inject', 'sitTie'], snort: ['snort', 'sitLine'], huff: ['huff', 'sitHuff'], tip: ['tipOffer', 'sitTipOffer'] };
  const acted = (p, pl) => (!p.act || !ACT_CLIP[p.act] || !pl || pl.pose === 'lie' || pl.clip === 'walk' ? pl : { ...pl, clip: ACT_CLIP[p.act][pl.pose === 'sit' ? 1 : 0] });
  // being tickled (by you, here, at once; or by anybody, as the server's `tickled` says): they laugh, and
  // figurePeople shakes them on the spot (room-people.js `tickle`). Lying down, it's the laugh without the clip.
  const tickled = (p, pl) => {
    if (!(p.tickled || (S.tickle?.get(p.id) || 0) > performance.now()) || p.asleep || p.out) return {};
    return { tickle: 1, mood: { m: 'laughing', i: 1, s: 2 }, ...(pl.pose === 'stand' && pl.clip !== 'walk' ? { clip: 'laugh' } : {}) };
  };
  const bodiesNow = () => {
    const bodies = [];
    for (const p of S.people) {
      if (p.id === S.you) continue;
      let pl = acted(p, placeOf(p));
      // who you're talking to turns to face you, stood still (room-talk.js)
      if (pl?.at && S.talk?.who === p.name && pl.pose === 'stand' && pl.clip !== 'walk') pl = { ...pl, yaw: S.talk.faceYou(p.name, S.L.world(pl.at[0], pl.at[1], 0), seat) ?? pl.yaw };
      // `rest` and `manner` pick what they idle at: asleep, out cold, or at work behind a bar, and `watch` is a dancer they
      // keep looking at (plugins/roomstage)
      if (pl) bodies.push({ id: p.id, ...eased(p, pl), dress: dressOf(p.order), sculpt: true, sex: p.sex, figure: figOf(p), wear: p.wear, feel: p.feel, ...(p.gait ? { gait: p.gait } : {}), mouth: mouthOf(p.name), rest: p.asleep ? 'sleep' : p.out ? 'out' : undefined, manner: p.manner, mood: p.mood, meal: p.meal, ...(p.watch ? { watch: S.L.world(p.watch[0], p.watch[1], p.watch[2]) } : {}), ...(p.stash && pl.seat ? { stash: p.stash, stashAt: stashNow(p.stash) } : {}), ...(p.act && p.hold ? { holds: { R: p.hold } } : {}), ...(p.bar ? { bar: p.bar } : {}), ...tickled(p, pl) });
    }
    // and whoever's next door, seen through the doorway: drawn, tagged, never spoken to from here (`next`)
    for (const n of S.next) {
      if (!n.L) continue;
      n.people.forEach((p, i) => {
        // (somebody still walking out of this room is drawn here, not where they've got to)
        if (p.id === S.you || p.annex || leaving.has(p.id)) return;
        const pl = placeNext(n, p, i);
        bodies.push({ id: p.id, ...eased(p, pl), next: true, dress: dressOf(p.order), sculpt: true, sex: p.sex, figure: figOf(p), wear: p.wear, feel: p.feel, ...(p.gait ? { gait: p.gait } : {}), rest: p.asleep ? 'sleep' : p.out ? 'out' : undefined, manner: p.manner, mood: p.mood });
      });
    }
    // you, while the MORPHEX pod has you (room-morphex.js): walking in, standing in it, walking out
    if (S.morph?.on) { const me = S.morph.self(performance.now()); if (me) bodies.push(me); }
    // and you, while the Pack has the camera going round you
    else if (S.packCam) { const me = packBody(); if (me) bodies.push(me); }
    easedAt = performance.now();
    return bodies;
  };
  // Somebody in a room next door, where they are in it, in this room's frame: on their seat in that
  // room's own layout, where they settled, or stood about its middle. That layout is laid out from where
  // the room stands as seen from here, so a seat's spot goes through its world() and this room's local(),
  // and a yaw the server sent, which is in that room's own frame, turns by the way it faces. No routes:
  // a resident walking round next door is seen where they're going.
  function placeNext(n, p, i) {
    const Ln = n.L, here = (u, v) => { const q = S.L.local(Ln.world(u, v, 0)); return [q[0], q[1]]; };
    let pl = null;
    if ((p.posture === 'sitting' || p.posture === 'lying') && p.on) {
      const want = p.posture === 'lying', s = Ln.seats.find((x) => x.piece === p.on && !!x.lie === want) || Ln.seats.find((x) => x.piece === p.on);
      if (s) pl = { at: [s.u, s.v], yaw: s.yaw, pose: s.lie ? 'lie' : 'sit', head: s.head, top: s.top, ...(s.back != null && !s.lie ? { back: s.back } : {}), ...(s.lift && !s.lie ? { lift: s.lift } : {}) };
    }
    if (!pl && p.at) pl = { at: p.at, yaw: (p.yaw || 0) + (n.spec.face || 0) * Math.PI / 180, pose: 'stand' };
    // nobody has said where: spread over that room's floor as they'd be stood in it (crowdPlace)
    if (!pl && !p.annex) pl = crowdPlace(Ln, p, n.people, () => n.people.filter((q) => q !== p && !q.annex && Array.isArray(q.at)).map((q) => q.at));
    if (!pl) pl = { at: [((i % 3) - 1) * 0.6, n.spec.d / 2 + Math.floor(i / 3) * 0.6], yaw: Math.atan2(Ln.f[0], Ln.f[2]), pose: 'stand' };
    const at = here(pl.at[0], pl.at[1]);
    if (pl.head) { const b = here(pl.at[0] + pl.head[0], pl.at[1] + pl.head[1]); pl.head = [b[0] - at[0], b[1] - at[1]]; }
    return { ...pl, at };
  }
  // ⚠ A FIGURE IS 50 TO 180 MS ON THE PAGE, so it's built in the worker (figure-ahead.js) where that can wait: the
  // people next door before you reach them (the bake below), and the room's own under the loading veil, which waits
  // for them (bake.pending). `figurePeople` then finds them made and only the upload is left here. Through a doorway
  // there's no veil to wait under, and they were built ahead, so the room's own go as they always did.
  // The keys come from figureLooks, which can't see the Figure Lab's own picks: a body with one is built where it's
  // drawn, as before. Only the levels asked for: a phone draws the lite figure and never builds the close one.
  const figuresReady = (bodies, level) => {
    let ok = true;
    for (const b of bodies) { const k = figureLooks(b); for (const key of level === 'hd' ? k : [k[1]]) if (!figureAhead(key)) ok = false; }
    return ok;
  };
  function whenFigures(bodies, level, done) {
    const bk = S.bake;
    let tries = 0, held = false;
    const step = () => {
      let ok = true;
      if (ui?.S === S) try { ok = figuresReady(bodies, level); } catch (err) { console.warn('[room] people:', err); }
      // about four seconds, then the old way for whatever the worker hasn't got to
      if (ok || ++tries > 50) { if (held) bk.pending--; if (ui?.S === S) done(); return; }
      if (!held) { held = true; bk.pending++; }
      setTimeout(step, 80);
    };
    step();
  }
  setTimeout(() => {
    if (ui?.S !== S) return;
    // whoever's next door only once the worker has them (drawPeople's ⚠); they're drawn when they arrive
    const ready = () => bodiesNow().filter((b) => !b.next || figuresReady([b], figLevel));
    const prep = () => {
      try { for (const r of figurePeople(S.L, ready(), 0, { level: figLevel })) R.prepareFigure(r.key); } catch (err) { console.warn('[room] people:', err); }
      // and you, in a room with a mirror, so walking up to it doesn't wait on your figure being built
      try { const me = R.hasMirror && selfBody(seat.yaw); if (me) for (const r of figurePeople(S.L, [me], 0, { level: figLevel })) R.prepareFigure(r.key); } catch (err) { console.warn('[room] you:', err); }
      peopleOn = true;
      // and each one's other level, ready for when they cross the room (figurePeople's eye)
      if (FIGURE_LOD.on) setTimeout(() => { if (ui?.S === S) try { for (const r of figurePeople(S.L, ready(), 0, { level: 'lite' })) R.prepareFigure(r.key); } catch (err) { console.warn('[room] people:', err); } }, 400);
    };
    if (veiled && S.bake) whenFigures(bodiesNow(), figLevel, prep); else prep();
  }, 60);

  // ⚠ BAKED AHEAD: THE ROOMS PAST THE NEXT DOORWAY, BEFORE YOU REACH IT. `room_ahead` (plugins/roomstage aheadPayload)
  // says what each room next door would open with. For each: its own mesh, the shells of the rooms round it as seen
  // from it, and a figure for anybody in those the Stage hasn't drawn. All of it goes into the kept meshes
  // (bakedMesh) and the figures' own cache, so the crossing finds them made. Rooms first, then people.
  // Under the loading veil a job runs every frame and the veil waits for the last (the `ready` test above). After a
  // crossing there's no veil, so a job runs when you've stood still a moment, and slowly while you walk: a figure
  // is 180 ms, which is a hitch mid-stride and nothing while you're looking at a shelf.
  const BAKE_STILL_MS = 250, BAKE_GAP_MS = 60, BAKE_WALKING_MS = 300;
  const bake = S.bake = { jobs: [], pending: 0, waiting: !!nextDoor.length && !msg.relost, owed: () => bake.waiting || bake.jobs.length > 0 || bake.pending > 0 };
  S.ahead = (a) => {
    bake.waiting = false; bake.jobs.length = 0;
    composed.clear(); R.dropPrepared();
    const gen = bake.gen = (bake.gen || 0) + 1;
    const composes = [];
    // the room as the crossing will ask for it (roomMesh): its own kept mesh with its shells added, uploaded now. Its
    // parts come back from the worker in their own time, so it waits for them, a few tries, and then leaves it
    const compose = (spec, pieces, opts, parts) => {
      let tries = 0;
      const job = Object.assign(() => {
        if (ui?.S !== S || bake.gen !== gen) return;
        const key = bakeKey(roomKey(spec, pieces), opts), m = baked.get(key)?.mesh;
        const sh = parts.map((p) => baked.get(bakeKey(roomKey(p.spec, p.pieces), p.opts))?.mesh);
        if (!m || sh.some((x) => !x)) { if (++tries < 40) setTimeout(() => { if (ui?.S === S && bake.gen === gen) bake.jobs.push(job); }, 100); return; }
        if (!sh.length) return;
        const ck = composeKey(key, parts.map((p) => bakeKey(roomKey(p.spec, p.pieces), p.opts)));
        if (composed.has(ck)) return;
        const c = withShells(meshCopy(m), sh);
        composed.set(ck, c);
        R.prepareRoom(c, paint);
      }, { quick: true });
      return job;
    };
    const rooms = [], figures = [], lite = [], drawn = new Set([...S.people, ...nextDoor.flatMap((n) => n.people)].map((p) => p.id));
    // a room's materials go straight after it: each new one is painted in the worker and uploaded as a job of its own
    const worn = new Set();
    // a room is a quick job, so it is tagged to keep going while you walk (runBake); a figure waits for you to stop
    // the mesh is built by the worker (bakeOffThread); its materials are painted here when it comes back
    const room = (spec, pieces, opts) => Object.assign(() => {
      // painted in the worker where it can be (paintOffThread), and only the upload is a job here
      const wear = (m) => {
        for (const key of m.textured.keys()) {
          if (worn.has(key)) continue;
          worn.add(key);
          const p = paintOffThread(key, key === ROOM_RUG ? seed : 1);
          if (!p) { bake.jobs.unshift(Object.assign(() => R.prepareTexture(key, paint), { quick: true })); continue; }
          bake.pending++;
          p.then((bm) => {
            bake.pending--;
            if (ui?.S !== S) { bm?.close(); return; }
            bake.jobs.unshift(Object.assign(() => { if (bm) { R.prepareTexture(key, () => bm); bm.close(); } else R.prepareTexture(key, paint); }, { quick: true }));
          });
        }
      };
      const here = () => bakedMesh(roomKey(spec, pieces), roomLayout(spec, pieces), opts);
      const p = bakeOffThread(spec, pieces, opts);
      if (!p) { wear(here()); return; }
      bake.pending++;
      p.then((m) => { bake.pending--; if (ui?.S === S) wear(m || here()); }).catch((err) => { bake.pending--; console.warn('[room] baking ahead:', err); });
    }, { quick: true });
    // built in the worker first (figuresReady), and asked again until it's back; this job then only uploads it
    const figure = (p, level) => {
      const body = { id: p.id, at: [0, S.spec.d / 2], yaw: 0, pose: 'stand', dress: dressOf(p.order), sculpt: true, sex: p.sex, figure: figOf(p), wear: p.wear, feel: p.feel,mood: p.mood };
      let tries = 0;
      const job = () => {
        if (ui?.S !== S || bake.gen !== gen) return;
        if (++tries < 40 && !figuresReady([body], level)) {
          bake.pending++;
          setTimeout(() => { bake.pending--; if (ui?.S === S && bake.gen === gen) bake.jobs.push(job); }, 100);
          return;
        }
        for (const r of figurePeople(S.L, [body], 0, { level })) R.prepareFigure(r.key);
      };
      return job;
    };
    // a ride (plugins/roomstage `elevator.boarded`): the car as it will stand open on the floor it's going to, and
    // that floor's landing as its shell, keyed as ui.cross and reshell will ask for them when the doors open
    const ahead = a.ride ? (a.next || []).map((x) => ({ ...x, pieces: x.pieces || [], people: x.people || [] })) : nextDoor;
    if (a.ride) {
      const carSpec = a.lift ? { ...a.spec, lift: a.lift } : a.spec, near = new Set(ahead.map((x) => x.zone));
      rooms.push(room(carSpec, S.pieces, { seed: hashOf(msg.zone), lampOn, doorShut: false, joined: near }));
      for (const x of ahead) {
        rooms.push(room(x.spec, x.pieces, { seed: hashOf(x.zone), lampOn: litOf(x.zone, x.power), joined: new Set([msg.zone]), shell: true }));
        for (const p of x.people) if (p.id !== S.you && !p.annex && !drawn.has(p.id)) { drawn.add(p.id); figures.push(figure(p, figLevel)); if (FIGURE_LOD.on) lite.push(figure(p, 'lite')); }
      }
    }
    for (const r of a.rooms || []) {
      const n = ahead.find((x) => x.zone === r.zone);
      if (n && r.place) n.place = r.place;
      if (!n) continue;
      // as ui.cross and reshell will ask for them, or the crossing builds them again
      const spec = r.lift ? { ...r.spec, lift: r.lift } : r.spec, around = r.neighbours || [];
      const own = { seed: hashOf(r.zone), lampOn: litOf(r.zone, r.power), doorShut: false, turning: null, swinging: null, joined: new Set(around.map((x) => x.zone)) }, parts = [];
      // each job knows the room it's for, so the doorway you're walking up to can go first (rushDoorway)
      const mine = (job) => Object.assign(job, { zone: r.zone });
      rooms.push(mine(room(spec, n.pieces, own)));
      for (const x of around) {
        const pieces = x.pieces || (x.zone === msg.zone ? S.pieces : []), so = { seed: hashOf(x.zone), lampOn: litOf(x.zone, x.power), joined: new Set([r.zone]), shell: true };
        parts.push({ spec: x.spec, pieces, opts: so });
        rooms.push(mine(room(x.spec, pieces, so)));
        for (const p of x.people || []) {
          if (p.id === S.you || p.annex || drawn.has(p.id)) continue;
          drawn.add(p.id);
          figures.push(mine(figure(p, figLevel)));
          if (FIGURE_LOD.on) lite.push(mine(figure(p, 'lite')));
        }
      }
      composes.push(mine(compose(spec, n.pieces, own, parts)));
    }
    bake.jobs.push(...rooms, ...composes, ...figures, ...lite);
  };
  let bakeAt = 0, movedAt = 0, lastAt = null, lastYaw = 0;
  function runBake(now) {
    if (!bake.jobs.length) return;
    const at = S.walk?.at;
    if (!at || !lastAt || Math.hypot(at[0] - lastAt[0], at[1] - lastAt[1]) > 0.002 || Math.abs(seat.yaw - lastYaw) > 0.002) movedAt = now;
    lastAt = at ? [at[0], at[1]] : null; lastYaw = seat.yaw;
    const loading = veiled && now - opened < VEIL_MS + 500;
    // the room you're walking up to is baked at once, a job a frame, whether you're walking or not (rushDoorway)
    const rushing = !!bake.rush && bake.jobs[0]?.zone === bake.rush;
    // the rooms next door are baked while you walk, so none of them is built at the doorway; figures wait
    if (!loading && !rushing && now - bakeAt < (now - movedAt > BAKE_STILL_MS || bake.jobs[0]?.quick ? BAKE_GAP_MS : BAKE_WALKING_MS)) return;
    // one job a frame; one that was already made costs nothing, so the next goes with it
    const t0 = performance.now();
    do { try { bake.jobs.shift()(); } catch (err) { console.warn('[room] baking ahead:', err); } } while (bake.jobs.length && performance.now() - t0 < 4);
    bakeAt = performance.now();
  }
  // ⚠ THE ROOM PAST THE DOOR YOU'RE WALKING UP TO IS BAKED BEFORE THE DOOR OPENS. The bake-ahead queue went in the
  // order room_ahead listed the rooms, a job every 300 ms while you walked, so a door you went straight for could
  // open on a room that was still being built, and the crossing built it at the doorway. Within DOOR_NEAR of a
  // doorway (further out than the glass doors part at, SLIDE_NEAR), that room's jobs go to the front of the queue
  // and run a frame apiece until they're done. Checked a few times a second; the spots are worked out once a room.
  const DOOR_NEAR = 4.5, RUSH_MS = 200;
  let rushAt = 0, spotsOf = null, spots = [];
  function rushDoorway(now) {
    if (now < rushAt) return;
    rushAt = now + RUSH_MS;
    const L = S.L, at = S.walk?.at;
    if (!bake.jobs.length || !L || !at || S.walk.sat) { bake.rush = null; return; }
    if (spotsOf !== L) {
      spotsOf = L; spots = [];
      for (const o of L.spec.openings || []) if (o.to && o.dir) try { spots.push({ to: o.to, at: openingInside(L, o).at }); } catch { /* no spot, no rush */ }
    }
    let best = null, bd = DOOR_NEAR;
    for (const s of spots) { const d = Math.hypot(at[0] - s.at[0], at[1] - s.at[1]); if (d < bd) { bd = d; best = s.to; } }
    bake.rush = best;
    if (!best) return;
    const first = bake.jobs.filter((j) => j.zone === best);
    if (!first.length || first.every((j, i) => bake.jobs[i] === j)) return;
    const rest = bake.jobs.filter((j) => j.zone !== best);
    bake.jobs.length = 0;
    bake.jobs.push(...first, ...rest);
  }

  // id → person, here and next door, rebuilt only when S.people or S.next is replaced (both are, never mutated).
  // drawPeople ran a find per body a frame, and a flatMap over next door for each body there.
  let whoHere = null, whoThere = null, whoPeople = null, whoNext = null, boxFor = null, boxHas = false;
  function personOf(id, next) {
    if (whoPeople !== S.people || whoNext !== S.next) {
      whoPeople = S.people; whoNext = S.next; whoHere = new Map(); whoThere = new Map();
      for (const x of S.people || []) if (!whoHere.has(x.id)) whoHere.set(x.id, x);   // first wins, as find did
      for (const n of S.next || []) for (const x of n.people || []) if (!whoThere.has(x.id)) whoThere.set(x.id, x);
    }
    return whoHere.get(id) || (next ? whoThere.get(id) : null) || null;
  }
  // the animals on the floor (gl/room-beasts.js), built again only when they change or you've moved half a metre,
  // since each one turns to face you
  // The shed's lift rides in the same batch (room-hoist.js), built every frame while it moves and once after.
  // A cat (a pet) isn't in the batch: catsFrame moves it every frame on the GPU, and room-cat-sound.js voices it.
  let beastsFor = null, beastsEye = null, beastsL = null, hoistVer = -1, hoistWas = false;
  function drawBeasts() {
    drawCats();
    const eye = S.walk?.at || null, moved = !onlyCats(S.beasts) && (!beastsEye !== !eye || (eye && Math.hypot(eye[0] - beastsEye[0], eye[1] - beastsEye[1]) > 0.5));
    const lifting = hoistUi.moving() || stadium.machine.moving(), lift = lifting || hoistWas || hoistVer !== hoistUi.ver + stadium.machine.ver * 1000;
    if (beastsFor === S.beasts && beastsL === S.L && !moved && !lift) return;
    beastsFor = S.beasts; beastsL = S.L; beastsEye = eye ? [eye[0], eye[1]] : null;
    hoistWas = lifting; hoistVer = hoistUi.ver + stadium.machine.ver * 1000;
    const b = beastsBatch(S.L, S.beasts, { eye });
    hoistUi.into(b);
    stadium.machine.into(b);
    R.setBeasts(b);
  }
  // where a person stands now, for a cat going to them: you where you've walked, anybody else where they're drawn
  const whereIs = (id) => { if (id === S.you) return S.walk?.at || null; const p = personOf(id); return shown.get(id)?.at || (p ? placeOf(p)?.at : null) || null; };
  function drawCats() {
    if (!hasCats(S.beasts)) { R.setCats([]); catVoice.tick([]); return; }
    // (everybody in the room, you first, so a cat can choose who to look at)
    const folk = () => [S.you, ...(S.people || []).map((p) => p.id)].map((id) => ({ id, at: whereIs(id) })).filter((x) => x.at);
    // how much light there is for the cats' pupils: the lamps, and the day through the windows if the room has any
    const h = hourNow(), lamp = lampOn ? (power === 'low' ? lampLevel * EMERGENCY_K : lampLevel) : 0;
    const day = S.mesh?.windows?.length || S.spec?.balcony ? dayOf(h) * outside.dimOf() : 0;
    const light = Math.min(1, 0.8 * lamp + 0.95 * day);
    // how far down somebody's head is, as a share of standing: yours drops when you crouch (3.3 ft of 5.4)
    const lowOf = (id) => (id === S.you && S.walk?.keys?.().crouched ? 3.3 / 5.4 : 1);
    const f = catsFrame(S.L, S.beasts, { now: Date.now(), hour: h, whereIs, folk, lowOf, drawer: catDraw, lite: phone, light, mouth: catVoice.mouth });
    R.setCats(f.cats);
    catVoice.tick(f.voices);
  }
  // The card table's controls are on the table: small holograms pinned to the felt (gl/room-poker.js pokerAnchors),
  // not a bar over the picture. Your cards are the peek (click them to turn them up, again to put them down) with the hand's
  // name over them; your stack is check/call, the bet (the wheel over it sizes it), raise and all in; a fold chip
  // sits by your cards to muck them; the pot reads the street and the pot; an empty seat says Sit; the middle of the
  // felt between hands has the dealer and the bots. Each button is the verb typed (plugins/gametable), so the table
  // decides everything; the hand's name is only read off the cards (client/shared/poker-hand.js). The markup is
  // built again only when what it shows changes; the places move every frame.
  let barEl = null, barSig = '', betAmt = 0;
  const cardTxt = (c) => (c ? `${String(c.rank).replace('T', '10')}${SUIT_GLYPH[c.suit] || ''}` : '');
  // how big a bet the sizer offers: the least it may be and the most (all you have)
  function betRange(st, me) {
    const most = (me.chips || 0) + (me.bet || 0), bb = st.bb || 10;
    const least = st.toMatch > 0 ? st.toMatch + Math.max(st.minRaise || 0, bb) : bb;
    return { least: Math.min(least, most), most };
  }
  function sizeBet(how) {
    const st2 = S.pieces.find((q) => q.board?.poker)?.board, me2 = st2?.seats?.find((s) => s && s.id === S.you);
    if (!me2) return;
    const r = betRange(st2, me2), step = Math.max(1, st2.bb || 10), pot = st2.pot || 0;
    // a raise "to" a share of the pot: what you'd owe to call, plus that share of the pot after your call
    const owe2 = Math.max(0, (st2.toMatch || 0) - (me2.bet || 0)), after = pot + owe2;
    const potTo = (k) => (st2.toMatch || 0) + Math.round(after * k / step) * step;
    const to = { dn: betAmt - step, up: betAmt + step, min: r.least, half: potTo(0.5), twoThirds: potTo(2 / 3), pot: potTo(1) }[how];
    betAmt = Math.max(r.least, Math.min(r.most, Math.round(to)));
    syncBet();
  }
  // The bet's figure in place, on the label, the button and the slider, without building the panel again (that would
  // drop a slider you're dragging)
  function syncBet() {
    if (!barEl) return;
    const txt = `₵${betAmt.toLocaleString()}`;
    barEl.querySelectorAll('[data-bet]').forEach((el) => { el.textContent = txt; });
    const sl = barEl.querySelector('.pkt-slide input');
    if (sl && +sl.value !== betAmt) sl.value = betAmt;
    const go = barEl.querySelector('[data-betgo]');
    if (go) go.dataset.cmd = `${go.dataset.betgo} ${betAmt}`;
  }
  // Your cards: tap to turn them up until you tap again, or hold to look and let go to put them down. The same for the
  // mouse on the cards and for the C key.
  let peekDown = 0;
  function peekPress() {
    if (peekDown) return;
    peekDown = performance.now();
    S.peek = { held: !!S.peek?.on, on: true };
    pokerBar();
  }
  function peekRelease() {
    if (!peekDown) return;
    // anything short of a deliberate hold is a tap, so an unhurried click still turns them up
    const tap = performance.now() - peekDown < 450;
    peekDown = 0;
    S.peek.on = tap ? !S.peek.held : false;
    pokerBar();
  }
  // whether you're sat in a hand at this room's table, so the table's keys are live
  const pokerSeated = () => {
    const st = S.pieces.find((q) => q.board?.poker)?.board;
    return !!(st && S.walk?.sat && st.seats?.some((s) => s && s.id === S.you && !s.away));
  };
  // The board from the ceiling: V swings the picture to look straight down on the felt, again to come back
  function pokerTopCam() {
    if (!S.pokerTop) return null;
    const A = pokerAnchors(), mid = A?.mid, eye = seat.eye;
    if (!mid || !eye || !pokerSeated()) { S.pokerTop = false; return null; }
    const far = Math.max(0.6, Math.hypot(eye[0] - mid[0], eye[2] - mid[2]));
    return { eye: [mid[0], mid[1] + far * 0.95, mid[2]], yaw: seat.yaw, pitch: -1.5, fov: 52, mode: 'free' };
  }
  const RANK_TXT = (c) => String(c.rank).replace('T', '10');
  // a card in the HUD: the index in two corners and the suit big in the middle, red for hearts and diamonds
  const hudCard = (c, cls = '') => `<i class="pkh-c${c.suit === 'h' || c.suit === 'd' ? ' red' : ''} ${cls}"><b>${esc(RANK_TXT(c))}<s>${SUIT_GLYPH[c.suit] || ''}</s></b><u>${SUIT_GLYPH[c.suit] || ''}</u><b class="far">${esc(RANK_TXT(c))}<s>${SUIT_GLYPH[c.suit] || ''}</s></b></i>`;
  function pokerBar(off = false) {
    const st = !off && S.pieces.find((q) => q.board?.poker)?.board;
    if (!st) { if (barEl) barEl.hidden = true; barSig = ''; return; }
    const me = st.seats?.find((s) => s && s.id === S.you), live = st.phase === 'InProgress';
    // nothing over the picture until you're in the game: F on the table from your chair deals you in (actsOf)
    // and nothing while you're up from the table either: the HUD is only for someone sitting at it
    if (!me || me.away || !S.walk?.sat) { if (barEl) barEl.hidden = true; barSig = ''; return; }
    const open = st.seats?.some((s) => !s), bots = st.seats?.filter((s) => s?.bot).length || 0;
    const mine = me && S.pokerMine, board = st.board || [];
    const hand = mine ? handOf([...mine, ...board]) : null, draws = mine ? drawsOf(mine, board) : [];
    const acting = !!(live && me?.acting), owe = acting ? Math.max(0, (st.toMatch || 0) - (me.bet || 0)) : 0;
    const R = acting ? betRange(st, me) : null;
    if (R) betAmt = Math.max(R.least, Math.min(R.most, betAmt || R.least));
    const verb = (st.toMatch || 0) > 0 ? 'raise' : 'bet';
    const B = (label, cmd, cls = '') => `<button type="button" class="pkt-b ${cls}" data-cmd="${esc(cmd)}">${label}</button>`;
    const street = st.street ? st.street.toUpperCase() : st.phase === 'HandComplete' ? 'SHOWDOWN' : 'WAITING';
    const nOpen = st.seats?.filter((s) => !s).length || 0;
    const sig = [street, !!me?.away, st.pot, me?.chips, me?.bet, acting, owe, JSON.stringify(mine), JSON.stringify(board), open, nOpen, bots, !!st.dealer, !!me, R?.least, R?.most, S.peek?.on, !!S.pokerTop].join('|');
    if (sig !== barSig) {
      barSig = sig;
      if (!barEl) {
        barEl = document.createElement('div');
        barEl.className = 'rs-pkt';
        barEl.addEventListener('click', (e) => {
          if (e.target.closest('[data-top]')) { S.pokerTop = !S.pokerTop; pokerBar(); return; }
          const btn = e.target.closest('[data-cmd],[data-size]');
          if (!btn) return;
          if (btn.dataset.cmd) sendCmd(btn.dataset.cmd); else sizeBet(btn.dataset.size);
        });
        // the slider sizes the bet as you drag it
        barEl.addEventListener('input', (e) => {
          if (!e.target.matches('.pkt-slide input')) return;
          betAmt = +e.target.value;
          syncBet();
        });
        // the wheel over your stack sizes the bet, a big blind a notch
        barEl.addEventListener('wheel', (e) => {
          if (!e.target.closest('.pkt-stack')) return;
          e.preventDefault(); e.stopPropagation();
          sizeBet(e.deltaY < 0 ? 'up' : 'dn');
        }, { passive: false });
        // your cards: click to turn them up until you click again, or hold to look and let go to put them down
        barEl.addEventListener('pointerdown', (e) => {
          if (e.target.closest('.pkt')) e.stopPropagation();
          if (!e.target.closest('[data-peek]')) return;
          e.stopPropagation();
          peekPress();
        });
        barEl.addEventListener('pointerup', peekRelease);
        barEl.addEventListener('pointerleave', peekRelease, true);
        barEl.addEventListener('pointercancel', peekRelease, true);
        host.append(barEl);
      }
      const made = (c) => !!mine && inHand(hand, c) && (hand.rank > 0 || mine.includes(c));
      const handLine = hand ? `<b>${esc(hand.name)}</b>${mine ? `<i>${mine.map(cardTxt).join(' ')}${board.some(made) ? ' + ' + board.filter(made).map(cardTxt).join(' ') : ''}</i>` : ''}`
        : `<b>${live ? 'Your cards' : 'Waiting for the deal'}</b>`;
      const parts = [];
      // the cards strip: the board as it's dealt (flop, turn, river), and your two, face down until you peek
      {
        // the board as the ceiling sees it: a patch of felt with the five cards on it, the pot under them
        const face = (c, cls = '') => hudCard(c, `${made(c) ? 'won' : ''} ${cls}`);
        const slots = [0, 1, 2, 3, 4].map((i) => (board[i] ? face(board[i], 'dealt') : '<i class="pkh-c empty"></i>')).join('');
        const up = !!S.peek?.on && !!mine;
        const two = mine ? mine.map((c) => (up && c ? face(c, 'flip') : '<i class="pkh-c back"></i>')).join('') : '<i class="pkh-c empty"></i><i class="pkh-c empty"></i>';
        const streetName = board.length >= 5 ? 'RIVER' : board.length === 4 ? 'TURN' : board.length === 3 ? 'FLOP' : live ? 'PRE-FLOP' : 'BOARD';
        parts.push(`<div class="pkt pkt-hud" data-dock="cards">
          <div class="pkh-grp pkh-felt" data-top title="V: look down on the table from the ceiling"><span>${esc(streetName)} <em>${S.pokerTop ? '▣ TABLE VIEW · V' : '▣ OVERHEAD · V'}</em></span><div class="pkh-row">${slots}</div><span class="pkh-pot">POT ₵${(st.pot || 0).toLocaleString()}</span></div>
          <div class="pkh-grp pkh-mine${up ? ' up' : ''}" data-peek title="Click or C to turn your cards up; again to put them down. Hold to look."><span>${up ? 'YOUR HAND' : 'CLICK OR C TO LOOK'}</span><div class="pkh-row">${two}</div>
          ${up && hand ? `<div class="pkh-hand">${esc(hand.name)}</div>` : ''}</div></div>`);
      }
      parts.push(`<div class="pkt pkt-pot" data-at="pot"><span>${esc(street)}</span><b>₵${(st.pot || 0).toLocaleString()}</b></div>`);
      {
        parts.push(`<div class="pkt pkt-cards${S.peek?.on ? ' up' : ''}" data-at="cards" data-peek title="Click to turn your cards up; click again to put them down">
          <div class="pkt-read">${handLine}${draws.length ? `<em>${esc(draws.join(' · '))}</em>` : ''}</div>
          <div class="pkt-hit"><span>${S.peek?.on ? 'CLICK TO HIDE' : 'CLICK TO LOOK'}</span></div></div>`);
        // the betting panel is docked at the side of the picture, not pinned over the felt in front of you, so the
        // middle of the screen stays the table; Fold is in it, at the foot, away from Call
        // up from the table: the seat is held and checks or folds for you until you sit back down
        if (acting) {
          parts.push(`<div class="pkt pkt-stack" data-dock title="Wheel to size the bet">
            <div class="pkt-figs"><span>STACK<b>₵${(me.chips || 0).toLocaleString()}</b></span><span>POT<b>₵${(st.pot || 0).toLocaleString()}</b></span><span>TO CALL<b>${owe ? `₵${owe.toLocaleString()}` : '—'}</b></span></div>
            ${owe >= (me.chips || 0) ? B(`Call all in ₵${(me.chips || 0).toLocaleString()}`, 'allin', 'go') : owe ? B(`Call ₵${owe.toLocaleString()}`, 'call', 'go') : B('Check', 'check', 'go')}
            ${R.most > R.least && owe < (me.chips || 0) ? `<div class="pkt-raise">
              <span class="pkt-size"><button type="button" data-size="dn" title="One big blind less">−</button><b data-bet>₵${betAmt.toLocaleString()}</b><button type="button" data-size="up" title="One big blind more">+</button></span>
              <label class="pkt-slide"><input type="range" min="${R.least}" max="${R.most}" step="${Math.max(1, st.bb || 10)}" value="${betAmt}" aria-label="Bet size"></label>
              <span class="pkt-size pkt-pre"><button type="button" data-size="min">Min</button><button type="button" data-size="half">½ Pot</button><button type="button" data-size="twoThirds">⅔ Pot</button><button type="button" data-size="pot">Pot</button></span>
              <button type="button" class="pkt-b gold" data-betgo="${verb}" data-cmd="${verb} ${betAmt}">${verb === 'raise' ? 'Raise to' : 'Bet'} <span data-bet>₵${betAmt.toLocaleString()}</span></button></div>` : ''}
            ${B(`All in ₵${(me.chips || 0).toLocaleString()}`, 'allin', 'hot')}<span class="pkt-gap"></span>${B('Fold', 'fold', 'cold')}</div>`);
        } else {
          // 'leave' cashes you out but keeps you in the chair, so "Just sit" is the way to sit here without playing;
          // F on the table deals you back in
          parts.push(`<div class="pkt pkt-stack idle" data-dock><span class="pkt-k">STACK ₵${(me.chips || 0).toLocaleString()}</span>${B(live ? 'Leave the game' : 'Just sit, no cards', 'leave', 'cold')}</div>`);
        }
      }
      if (!live) {
        const host2 = `${open ? B('Deal in AI', 'summon', 'gold') : ''}${bots ? B('Bot out', 'evict') : ''}${B(st.dealer ? 'Send dealer off' : 'Call dealer', 'calldealer')}`;
        parts.push(`<div class="pkt pkt-mid" data-dock="top">${host2}</div>`);
      }
      barEl.innerHTML = parts.join('');
      barEl.classList.toggle('acting', acting);
    }
    barEl.hidden = false;
    pokerPlace();
  }
  // Each hologram to its place on the felt this frame; one that's behind you or off the picture is hidden.
  function pokerPlace() {
    const A = pokerAnchors();
    if (!barEl || !A) return;
    const b = host.getBoundingClientRect();
    for (const el of barEl.children) {
      // a docked panel stays where the sheet puts it, at the side
      if (el.dataset.dock !== undefined) continue;
      const k = el.dataset.at, p = k?.startsWith('open') ? A.open[+k.slice(4)] : A[k] || A.me?.[k];
      // your cards: the hotspot is the cards themselves, the box round their corners as drawn this frame (lying
      // down or turned up), padded and never smaller than a thumb; it hangs from its top, the hand's name under it on
      // the rail, so it never sits over the board
      if (k === 'cards' && A.me?.box?.length) {
        const pts = A.me.box.map((w) => R.project(w, b.width, b.height)).filter(Boolean);
        if (pts.length) {
          const xs = pts.map((s) => s.x), ys = pts.map((s) => s.y), pad = 10;
          const w = Math.max(150, Math.max(...xs) - Math.min(...xs) + pad * 2), h = Math.max(110, Math.max(...ys) - Math.min(...ys) + pad * 2);
          const cx = (Math.max(...xs) + Math.min(...xs)) / 2, top = (Math.max(...ys) + Math.min(...ys)) / 2 - h / 2;
          const vis = cx > -40 && cx < b.width + 40 && top > -h && top < b.height + 40;
          el.style.display = vis ? '' : 'none';
          if (vis) { el.style.setProperty('--hw', `${w.toFixed(0)}px`); el.style.setProperty('--hh', `${h.toFixed(0)}px`); el.style.transform = `translate(${cx.toFixed(0)}px, ${top.toFixed(0)}px)`; }
          continue;
        }
      }
      const q = p && R.project(p, b.width, b.height);
      const vis = !!q && q.x > -40 && q.x < b.width + 40 && q.y > -40 && q.y < b.height + 40;
      el.style.display = vis ? '' : 'none';
      if (vis) el.style.transform = `translate(${q.x.toFixed(0)}px, ${q.y.toFixed(0)}px)`;
    }
  }
  // How far your cards are lifted toward you, 0 down to 1 up, eased toward what the Peek button says.
  let peekK = 0, peekT = 0;
  function peekNow(t) {
    const dt = Math.max(0, Math.min(0.1, t - (peekT || t)));
    peekT = t;
    peekK += ((S.peek?.on ? 1 : 0) - peekK) * Math.min(1, dt * 7);
    return peekK < 0.002 ? 0 : peekK;
  }
  // Looking out on the street (a window or a balcony), the lens keeps the room and what's just outside it sharp and
  // blurs only the buildings further off: the room's diagonal and six metres more (gl/room-dof.js `sharp`).
  function streetSharp() {
    const sp = S.spec;
    if (!sp || !(S.mesh?.windows?.length || sp.balcony)) return 0;
    const k = sp.unit === 'ft' ? FT_PER_M : 1;
    return Math.hypot(sp.w || 0, sp.d || 0) / k + 6;
  }
  // While you hold cards at a table, the lens is pinned at them (gl/room-dof.js), so they're never what's blurred.
  function pokerFocus() {
    const at = S.pokerMine && pokerMineAt(), eye = seat.eye;
    const out = at && eye ? { focus: Math.max(0.3, Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2])) } : {};
    const band = tableBand();
    if (band) out.focusBand = band;
    return out;
  }
  // Sat at a table, the lens holds a band sharp from the table's near edge to past the chairs across it, so the
  // table, its chairs and everybody round it are in focus wherever you look; the room beyond still falls off.
  function tableBand() {
    const L = S.L, s = S.walk?.sat, eye = seat.eye;
    if (!L || !s || s.lie || !eye) return null;
    const k = S.spec.unit === 'ft' ? FT_PER_M : 1;
    let t = null, bd = 1.2 * k;
    for (const q of L.placed) {
      if (q.arche !== 'table') continue;
      const dd = Math.max(0, Math.hypot(q.u - s.u, q.v - s.v) - Math.max(q.w, q.d) / 2);
      if (dd < bd) { bd = dd; t = q; }
    }
    if (!t) return null;
    // the table's corners pushed out by a chair and a body (0.9 m), as world points
    const [fu, fv] = facing(t.turn), su = -fv, sv = fu, m = 0.9 * k, hw = t.w / 2 + m, hd = t.d / 2 + m;
    let hi = 0;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = L.world(t.u + su * a * hw + fu * b * hd, t.v + sv * a * hw + fv * b * hd, 0);
      hi = Math.max(hi, Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]));
    }
    // the near edge: your own side of the table, a little short of it so your hands on it are sharp too
    const c = L.world(t.u, t.v, 0), near = Math.hypot(c[0] - eye[0], c[2] - eye[2]) - Math.min(t.w, t.d) / 2 - 0.35 * k;
    return [Math.max(0.3 * k, near), hi];
  }
  // Your own shower running: once you've stood in it, walking back out of the stall turns it off, as the log's
  // `shower off` does. Typing `shower` from across the room doesn't, since you never went in.
  function showerStepOut() {
    const at = S.walk?.at;
    const fid = Object.keys(S.plumb || {}).find((id) => S.plumb[id]?.shower && S.plumb[id].by === S.you);
    const p = fid ? S.L.placed.find((q) => String(q.id) === fid) : null;
    if (!p || !at || S.walk?.sat) { if (!fid) S.inShower = null; return; }
    const [u0, u1, v0, v1] = pieceBoxes(p)[0], m = 0.1 * (S.L.ft ? S.L.ft / FT_M : 1);
    const inside = at[0] > u0 - m && at[0] < u1 + m && at[1] > v0 - m && at[1] < v1 + m;
    if (inside) S.inShower = fid;
    else if (S.inShower === fid) { S.inShower = null; sendCmd('shower off'); }
  }
  // ⚠ SOMEBODY IDLING ACROSS THE ROOM IS POSED AT ABOUT 15 A SECOND, NOT EVERY FRAME. Their breathing, blinks
  // and glances are too small to see stepping at that distance, and posing a body was most of what a busy room
  // cost the CPU. Anybody walking, talking, next door, close (6 m) or changing pose is posed every frame as before.
  const poseKept = new Map(), figWait = new Map();
  function posePeople(bodies, t) {
    // ⚠ THE CAMERA'S EYE, NOT YOURS: a conversation's shot (room-talk.js) or a close-up is inches from their face while
    // you stand across the room, and measured from you they went lite (no painted face, no eyes) on the closest shot
    const eye = S.viewEye || seat.eye;
    const opts = { level: figLevel, eye };
    const me = eye ? S.L.local(eye) : S.walk?.at, far = 6 * (S.spec.unit === 'ft' ? FT_PER_M : 1);
    const keep = (bd) => {
      if (!me || bd.clip || bd.mix || bd.blend || bd.next || bd.mouth || bd.phase !== undefined || !Array.isArray(bd.at)) return null;
      const k = poseKept.get(bd.id);
      if (!k || t - k.t > 0.066 || t < k.t || k.L !== S.L || k.u !== bd.at[0] || k.v !== bd.at[1] || k.pose !== bd.pose) return null;
      return Math.hypot(bd.at[0] - me[0], bd.at[1] - me[1]) > far ? k.rec : null;
    };
    const kept = bodies.map(keep), fresh = bodies.filter((_, i) => !kept[i]);
    const made = fresh.length ? figurePeople(S.L, fresh, t, opts) : [];
    let j = 0;
    const recs = bodies.map((bd, i) => {
      if (kept[i]) return kept[i];
      const rec = made[j++];
      if (Array.isArray(bd.at)) poseKept.set(bd.id, { rec, t, L: S.L, u: bd.at[0], v: bd.at[1], pose: bd.pose });
      return rec;
    });
    if (poseKept.size > bodies.length * 2 + 16) for (const id of poseKept.keys()) if (!bodies.some((b) => b.id === id)) poseKept.delete(id);
    return recs;
  }
  function drawPeople(t) {
    // ⚠ NEXT DOOR WAITS FOR ITS FIGURE. Somebody seen through a doorway is left out until the worker has built them
    // (figuresReady asks it), or figurePeople built them here on the frame they came into view, 50 to 180 ms each,
    // while the bake was waiting on the worker for the same figure: in the Room Lab, with three people next door,
    // the page spent longer building figures than with no worker at all. Under the veil the bake holds the veil
    // for them, so they're there when it lifts.
    // ⚠ SO DOES SOMEBODY WHO WALKS IN. A newcomer to this room was built here on the frame they appeared: eight at
    // once held the page 1.4 s in the Room Lab. Now one not drawn last frame waits for the worker, four seconds at
    // most (a Lab pick the worker can't see is built here then, as before); anybody already drawn stays drawn.
    const all0 = bodiesNow(), all = S.vatCycle?.busy ? S.vatCycle.bodies(all0, S, performance.now()) : all0;
    const nowW = performance.now(), wasDrawn = S.drawnIds || new Set();
    const bodies = all.filter((b) => {
      if (b.next) return figuresReady([b], figLevel);
      if (wasDrawn.has(b.id) || !peopleOn) return true;
      const since = figWait.get(b.id) ?? figWait.set(b.id, nowW).get(b.id);
      return nowW - since > 4000 || figuresReady([b], figLevel);
    });
    S.drawnIds = new Set(bodies.map((b) => b.id));
    for (const id of S.drawnIds) figWait.delete(id);
    if (figWait.size > 64) figWait.clear();
    const recs = posePeople(bodies, t);
    // (built in the worker first, as next door's are: until they're back the vats stand empty, not the frame held)
    // the sleepers are always the close-up figure with the fine head (faceHd), on every device and at any distance:
    // they're the room's centrepiece, and there are few enough of them to afford it
    const sleepers0 = vatSleepers(S.L, S.mesh?.vats, t), sleepers = sleepers0.length && figuresReady(sleepers0, 'hd') ? sleepers0 : [];
    const slept = sleepers.length ? figurePeople(S.L, sleepers, t, { level: 'hd' }) : [];
    R.setFigures(slept.length ? [...recs, ...slept] : recs);
    if (slept.length) R.setVatBodies?.(slept.map((r, i) => ({ id: sleepers[i].vat, ...sleeperCapsules(r.rows) })));
    // where everyone stands, for the door cards to hide behind (room-lock.js peopleBlock)
    S.drawnBodies = bodies;
    // you, in a mirror: posed only while one was drawn last frame, and not while the Pack or the pod already has you
    // ⚠ YOU WAIT FOR THE WORKER TOO. You're never drawn in the room, so the first frame a mirror came into view built
    // you here (dressed in what you wear), and walking up to a wardrobe's mirror held the page about two seconds.
    // Asked from the room's open (any mirror in it) so you're usually made before you reach it; until then the
    // mirror shows the room without you.
    if (R.hasMirror) {
      const me = !S.morph?.on && !S.packCam ? mirrorBody(t) : null, ready = me && figuresReady([me], figLevel);
      R.setMirrorFigures(ready && R.mirrorSeen ? figurePeople(S.L, [me], t, { level: figLevel }) : []);
    }
    drawBeasts();
    // a pan, a stove, a plate: what anybody cooking or eating has (gl/room-meals.js), and nothing once nobody is
    // and the kit on a table (gl/room-stash.js), and the lid of a lacquered box, open while its card is up
    if (boxFor !== S.L) { boxFor = S.L; boxHas = S.L.placed.some((q) => q.form === 'lacquer'); }   // per layout, not per frame
    const box = boxHas, using = bodies.some((bd) => bd.stash);
    const lidTo = S.lidFor && root.querySelector('.st-menu') ? 1 : 0;
    const dt = Math.max(0, Math.min(0.1, t - (S.lidT ?? t)));
    S.lidK = (S.lidK || 0) + (lidTo - (S.lidK || 0)) * Math.min(1, dt * 5);
    S.lidT = t;
    if (!lidTo && S.lidK < 0.002) { S.lidK = 0; S.lidFor = null; }
    // and what's in a hand that nothing else draws: a bottle, a pill, a rig (gl/room-held.js)
    const eating = bodies.some((bd) => bd.meal), holding = recs.some((r) => r.hold?.L || r.hold?.R);
    const fridge = S.fridge?.swing ? S.fridge : null;
    // and a hand of hold'em on a card table (gl/room-poker.js): the cards, the chips, the deal
    const poker = pokerLive(S.pieces);
    if (!poker && barEl && !barEl.hidden) pokerBar(true);
    // a shower running, a stream, a bowl that isn't clean (gl/room-plumbing.js)
    const plumb = plumbingLive(S.plumb);
    if (plumb) showerStepOut();
    // a roof that lets the rain in drips into its bucket while it's raining (gl/room-squat.js)
    const drip = leaksLive(S.L, liveWx()?.weather);
    // a shut lacquer box with nothing else going on draws the same props every frame: build them once per layout
    // and leave the uploaded batch alone until something moves (a lid, a meal, a hand), not 60 rebuilds a second
    const still = box && !S.lidK && !lidTo && !(eating || using || holding || fridge || poker || plumb || drip);
    if (still && S.propsStill === S.L) { /* the batch on the GPU is already this */ }
    else if (eating || using || box || holding || S.propsOn || fridge || poker || plumb || drip) {
      S.propsStill = still ? S.L : null;
      const b = mealProps(S.L, bodies, recs, t);
      stashProps(b, S.L, bodies, recs, t, { id: S.lidFor, k: S.lidK || 0 });
      heldProps(b, bodies, recs);
      if (poker) { pokerProps(b, S.L, S.pieces, { id: S.you, cards: S.pokerMine, peek: peekNow(t) }, t, S.walk?.at || null); pokerBar(); }
      if (fridge) swingBatch(b, fridge.swing, fridge.k);
      // a running shower's steam goes on the see-through layer, unless a stage has that layer (chem, the kitchen)
      const steam = plumb && !S.chemming && Object.values(S.plumb).some((x) => x?.shower) ? { data: new Float32Array(0), n: 0 } : null;
      if (plumb) plumbingProps(b, S.L, S.plumb, bodies, S.walk?.at ? { id: S.you, at: S.walk.at, yaw: seat.yaw } : null, t, Date.now(), steam);
      if (steam) { R.setPropsGlass(steam); S.steamOn = true; } else if (S.steamOn) { R.setPropsGlass(null); S.steamOn = false; }
      if (drip) leaksProps(b, S.L, t);
      // (an open fridge keeps it on a frame longer, so its doors leave the props layer once they're back in the room)
      R.setProps(b); S.propsOn = eating || using || box || holding || !!fridge || poker || plumb || drip;
    }
    if (!plumb && S.steamOn) { R.setPropsGlass(null); S.steamOn = false; }
    // a name over each head. The host's size is kept by a ResizeObserver: reading its rect every frame forced a
    // layout whenever anything on the page had changed since the last one
    const b = hostSize();
    const nowMs = performance.now(), mineAnnex = !!(S.walk?.at && S.L.annex && inAnnex(S.L, S.walk.at[1], S.walk.at[0]));
    inView.clear();
    // ⚠ A NAME IS HTML OVER THE PICTURE, so the room's depth can't hide it: somebody behind a wall kept their
    // name, floating on the wall. roomSees says whether there's a wall between their head and your eye.
    const eye = seat.eye ? S.L.local(seat.eye) : S.walk?.at;
    // ⚠ WRITTEN ONLY WHEN IT CHANGES. Setting innerHTML every frame reparsed the tags and forced a layout for the
    // next frame's getBoundingClientRect, with nobody moving
    const shown = [];
    for (const bd of bodies) {
      if (bd.id === S.you || (eye && !roomSees(S.L, eye, bd.at))) continue;
      const p = personOf(bd.id, bd.next), y = bd.pose === 'lie' ? (bd.top || 0.4) + 0.5 : bd.pose === 'sit' ? 1.45 + (bd.lift || 0) : 1.95 + (bd.tagLift || 0);
      const q = R.project(S.L.world(bd.at[0], bd.at[1], bd.pose === 'lie' ? y : y + S.L.baseAt(bd.at[0], bd.at[1])), b.width, b.height);
      if (!q || q.x <= -50 || q.x >= b.width + 50 || q.y <= -20 || q.y >= b.height) continue;
      shown.push({ bd, p, q, w: String(p?.name || '').length * 7 + 14 });
    }
    // two names in the same place are stacked: each tag, nearest the bottom first, goes up past any tag it
    // would overlap. Eased per person, so a tag slides rather than jumping as people cross.
    const TAG_H = 18, placed = [], dtTag = Math.min(0.1, Math.max(0, t - (tagLift.t ?? t)));
    tagLift.t = t;
    shown.sort((m, n) => n.q.y - m.q.y || m.q.x - n.q.x);
    for (const s of shown) {
      let y = s.q.y;
      for (let moved = true, k = 0; moved && k < 12; k++) {
        moved = false;
        for (const o of placed) if (Math.abs(o.x - s.q.x) < (o.w + s.w) / 2 && Math.abs(o.y - y) < TAG_H) { y = o.y - TAG_H; moved = true; }
      }
      placed.push({ x: s.q.x, y, w: s.w });
      const want = y - s.q.y, was = tagLift.get(s.bd.id) ?? want;
      const off = was + (want - was) * Math.min(1, dtTag * 10);
      tagLift.set(s.bd.id, off);
      s.q = { x: s.q.x, y: s.q.y + off };
    }
    for (const id of tagLift.keys()) if (id !== 't' && !shown.some((s) => s.bd.id === id)) tagLift.delete(id);
    const html = shown.map(({ bd, p, q }) => {
      const tag = noTags ? '' : `<span class="rs-tag${p?.npc ? ' npc' : ''}" style="left:${q.x.toFixed(0)}px;top:${q.y.toFixed(0)}px">${esc(p?.name)}</span>`;
      if (!p || bd.next || !!p.annex !== mineAnnex || q.x < 0 || q.x > b.width) return tag;
      inView.add(p.name);
      const line = talking.get(p.name);
      if (!(line?.until > nowMs)) return tag;
      // kept on screen, above the name
      const sx = Math.max(170, Math.min(b.width - 170, q.x)), sy = Math.max(110, q.y - 30);
      return tag + `<span class="rs-say" style="left:${sx.toFixed(0)}px;top:${sy.toFixed(0)}px">${esc(line.text)}</span>`;
    }).join('');
    if (html !== tagsHtml) { tagsHtml = html; tagsEl.innerHTML = html; }
    padCue(b, eye);
  }
  let tagsHtml = '';
  // N hides the names over heads (and brings them back); what anybody says still shows. Kept for this browser
  let noTags = false;
  try { noTags = localStorage.getItem('rs-no-tags') === '1'; } catch {}
  function toggleTags() {
    noTags = !noTags;
    try { localStorage.setItem('rs-no-tags', noTags ? '1' : '0'); } catch {}
    flash?.(noTags ? 'Names hidden (N)' : 'Names shown (N)');
  }
  let hostBox = null;
  const hostRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { hostBox = null; }) : null;
  hostRO?.observe(host);
  function hostSize() {
    if (!hostBox || !hostRO) { const r = host.getBoundingClientRect(); hostBox = { width: r.width, height: r.height }; }
    return hostBox;
  }
  // ⚠ WHERE A CACHET'S KEYPAD IS, for whoever the room tells there's one (msg.keypad: the owner, or anybody in
  // unowned space). The pad is small and dressed as the bar's own (gl/room-mesh.js drawCachetPad), so within a few
  // steps a ring pulses on it, and the first time you see one the room says where it is. A guest in an owned room
  // gets neither, so nothing here gives the cabinet away. One element kept and moved, never rewritten, or the
  // pulse would start again every frame.
  let padEl = null;
  function padCue(b, eye) {
    let at = null;
    if (msg.keypad && S.walk?.at && eye && !S.cooking) {
      const k = S.spec.unit === 'ft' ? FT_PER_M : 1;
      let best = 4.5 * k;
      for (const st of S.L.stations || []) {
        if (!st.pad) continue;
        const dd = Math.hypot(st.u - S.walk.at[0], st.v - S.walk.at[1]);
        if (dd > best || !roomSees(S.L, eye, [st.u, st.v])) continue;
        const q = R.project(S.L.world(st.u, st.v, st.y), b.width, b.height);
        if (!q || q.x < 8 || q.x > b.width - 8 || q.y < 8 || q.y > b.height - 8) continue;
        best = dd; at = { q, st };
      }
    }
    if (!at) { if (padEl) padEl.hidden = true; return; }
    if (!padEl) { padEl = document.createElement('span'); padEl.className = 'rs-padcue'; padEl.setAttribute('aria-hidden', 'true'); tagsEl.parentNode.insertBefore(padEl, tagsEl); }
    padEl.hidden = false;
    padEl.style.left = at.q.x.toFixed(0) + 'px'; padEl.style.top = at.q.y.toFixed(0) + 'px';
    firstPad(at.st);
  }
  // said once per cabinet on this device, the first time its pad's in view
  function firstPad(st) {
    const key = 'rs-pad-seen:' + st.piece;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
    flash(`The ${st.target} has a keypad: the little lit panel at its left end. Click it, or face it and press F.`, true);
  }
  const tagLift = new Map();   // each name tag's eased lift off its head, in pixels, and `t` the frame it was last set

  // ⚠ THE VIEW OUT IS TURNED FOR THE NEXT ROOM BEFORE YOU'RE IN IT. In a room with no glass (a hall) nobody sees it,
  // so it's placed where the nearest room with windows past a doorway looks out from (`place`, from room_ahead):
  // a flat's view is built and lined up while you walk to its door, and going in doesn't move it. A lift car is left
  // alone: its ride places the view at the floor it's going to (plugins/roomstage `elevator.boarded`).
  let placedFor = null;
  function placeAhead() {
    if (!S.outlook || !S.walk?.at || S.spec.lift || S.spec.car || glassy(S.spec)) return;
    let best = null, far = Infinity;
    for (const o of S.spec.openings || []) {
      const n = o.dir && nextDoor.find((x) => x.zone === o.to);
      if (!n?.place || !glassy(n.spec)) continue;
      const at = openingInside(S.L, o).at, d = Math.hypot(at[0] - S.walk.at[0], at[1] - S.walk.at[1]);
      if (d < far) { far = d; best = n; }
    }
    if (!best || placedFor === best.zone) return;
    placedFor = best.zone;
    S.outlook.place({ ...best.place, cut: balconyCut(best.spec) });
  }

  function frame(now) {
    if (R.lost) { raf = 0; reopenLost(); return; }
    raf = requestAnimationFrame(frame); paceRes(now); draw(now); runBake(now); placeAhead();
    // in off the street: the street's last frame was left over the pane (freelook-view.js parkFreelook) and goes
    // now that the room has drawn one
    if (!uncovered) { uncovered = true; arrive(); }
    else if (keepAt) keepStillNow();
  }
  let uncovered = false, keepAt = null;
  // ⚠ THE ROOM'S RESOLUTION FOLLOWS ITS FRAME RATE (gl/room.js `setRes`). The time between frames is smoothed, and
  // past PACE_SLOW_MS the picture steps down a tenth (to half the pixels across at most), no more than one step every
  // PACE_STEP_MS so it doesn't hunt. A gap over 250 ms is a hidden tab or a load, not a slow frame, and is left out.
  // ⚠ IT CLIMBS BACK ON A HELD 60, NOT ON A FAST FRAME. It used to climb only under 15 ms, and vsync pins a 60 Hz
  // screen at 16.7, so once it stepped down it stayed down for good: the soft street out of the lobby windows. Now
  // a frame rate held under PACE_FAST_MS (one vsync and a bit) for paceWait climbs a twentieth. The hysteresis is
  // the wait: a climb that's knocked back down inside PACE_RELAPSE_MS doubles it (to PACE_WAIT_MAX_MS), so a scene
  // that can't hold the higher step tries it less and less often, and a long clean run puts it back to PACE_WAIT_MS.
  const PACE_SLOW_MS = 21, PACE_FAST_MS = 18, PACE_STEP_MS = 600, PACE_WAIT_MS = 1500, PACE_WAIT_MAX_MS = 12000, PACE_RELAPSE_MS = 4000;
  let paceLast = 0, paceDt = 16.7, paceAt = 0, paceFastSince = 0, paceWait = PACE_WAIT_MS, paceUpAt = -1e9;
  function paceRes(now) {
    const dt = now - paceLast;
    paceLast = now;
    if (!(dt > 0 && dt < 250) || !R.setRes) return;
    paceDt += (dt - paceDt) * 0.1;
    if (paceDt >= PACE_FAST_MS) paceFastSince = now;
    if (now - paceAt < PACE_STEP_MS) return;
    if (paceDt > PACE_SLOW_MS && R.res > 0.5) {
      if (now - paceUpAt < PACE_RELAPSE_MS) paceWait = Math.min(PACE_WAIT_MAX_MS, paceWait * 2);
      R.setRes(Math.max(0.5, R.res - 0.1)); paceAt = now; paceFastSince = now;
    } else if (R.res < 1 && now - paceFastSince > paceWait) {
      if (now - paceUpAt > PACE_RELAPSE_MS) paceWait = Math.max(PACE_WAIT_MS, paceWait * 0.75);   // the last climb held
      R.setRes(Math.min(1, R.res + 0.05)); paceAt = paceUpAt = now; paceFastSince = now;
    }
  }
  // for a harness: how the pacer stands
  S.paceState = () => ({ res: R.res, dt: paceDt, wait: paceWait });
  globalThis.__roomPace = S.paceState;
  // the lobby from its street door, kept some frames in (the room's pieces and people have come by then) and only
  // while you're still stood where you came in, looking where you came in looking; every visit refreshes it
  function keepStillNow() {
    const k = keepAt;
    // the very first frame is kept at once, from the door, in case you walk straight on; a later one replaces it
    if (k.n === 0 && !stillFor(k.door)) keepStill(k.door, canvas);
    if (++k.n < 20) return;
    keepAt = null;
    const a = S.walk?.at;
    if (!a || !k.at || Math.hypot(a[0] - k.at[0], a[1] - k.at[1]) > 0.05 || Math.abs((seat.yaw || 0) - (k.yaw || 0)) > 0.02) return;
    keepStill(k.door, canvas);
  }
  // The other half of going in off the street (freelook-view.js coverPane): the street faded to black with a loading
  // ring, and once the room is drawn the black fades off it. A room opened any other way just appears.
  function arrive() {
    const covers = [...document.querySelectorAll('.fl-cover')];
    // the veil on the street door's black (freelook-view.js coverPane) runs its bar to the end as it goes
    if (covers.length) finishVeil('room-stage');
    const ready = Math.max(0, ...covers.map((el) => +el.dataset.t || 0)) - performance.now();
    const fade = () => { for (const el of covers) { el.style.transition = 'opacity 450ms ease-out'; el.style.opacity = '0'; setTimeout(() => el.remove(), 520); } };
    if (ready > 0) setTimeout(fade, ready); else fade();
    const door = covers.length ? takeDoor() : null;
    if (door) keepAt = { door, n: 0, at: S.walk?.at?.slice(), yaw: seat.yaw };
  }
  // ⚠ A LOST CONTEXT IS REBUILT, NOT LEFT BLACK. The first open after the figure shader changes compiles
  // for a long time, and the browser can drop the context over it: render() then returned false every
  // frame and the pane stayed empty until it was opened again by hand. So this opens it again, with
  // what's in the room now and the view out of the window, up to three times. The event starts it as well
  // as the frame, since a hidden tab runs no frames.
  let reopening = false;
  canvas.addEventListener('webglcontextlost', () => setTimeout(() => { if (ui?.S === S) reopenLost(); }, 0));
  function reopenLost() {
    if (reopening) return;
    reopening = true;
    const tries = (msg.relost || 0) + 1;
    console.warn('[room] the 3-D context was lost; opening the room again (' + tries + ')');
    if (tries > 3) { host.innerHTML = '<p class="rs-none">The 3-D room stopped drawing. Close it and open it again, or use the room text.</p>'; return; }
    const again = { ...msg, pieces: S.pieces, people: S.people, here: S.here, locks: S.locks, glass: S.glass, relost: tries };
    const o = lastOutlook?.zone === msg.zone ? lastOutlook : null;
    setTimeout(() => { if (ui?.S !== S) return; openRoomStage(again); if (o) roomOutlook(o); }, 250);
  }
  function draw(now) {
    if (!S.L) return;
    const h = hourNow();
    // the street out of the window, repainted as the hour turns
    if (Math.abs(h - lastHour) > 0.08) { lastHour = h; R.setView(paintView(document, h, seed)); }
    // the glass under the broadcast's page: dark, on or off
    if (!S.screenPainted) { paintScreen(screenCanvas, false, 0, seed); R.setScreen(screenCanvas); S.screenPainted = true; }
    watchFridge(now);
    if (peopleOn) drawPeople(now / 1000);
    hoistUi.frame(now);
    if (vendorUi.frame(now)) { pushLocks(); pushDecals(); }
    if (stadium.frame(now, seat.eye, seat.yaw)) { pushDecals(); stadium.settled(); }
    watchDoor(now);
    rushDoorway(now);
    watchDoorways(now);
    watchAnnexDoor();
    watchCard();
    watchSpin(now);
    watchLiftDoors(now);
    watchMoves(now);
    watchSlideDoors(now);
    lockUi.slide(now);
    // with every pane under a lit scene there's nothing out there to paint
    // the view out isn't painted under lit shutters, unless a balcony door can open through them onto it
    S.seeLens = S.outlook?.tick(h, liveWx(), S.shutters.covered && !S.spec?.balcony ? null : lookOut()) || S.seeLens;
    toFaces(h);
    warmView(now, h);
    warmOpen(now, h);
    const Lr = S.L, A = Lr.annex;
    // the en-suite's box on the ground, in the frame the light is worked out in. It reaches a little
    // past the walls, or a wall sitting exactly on its edge flickers between the two rooms' lamps
    let annex = null;
    if (A) { const p = Lr.world(A.u0 - 0.06, A.v0 - 0.06, 0), q = Lr.world(A.u1 + 0.06, A.v0 + S.spec.annex.d + 0.2, 0); annex = [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[2], q[2])]; }
    // past the glass: less day under cloud, and a flash lights the room as well as the sky
    const out = outside.frame(now, h, dayOf(h), Lr, S.bearing), flare = 1 + out.flash * 3.4, sky = skyOf(h).map((c) => c * flare);
    // the fire's light follows the dial; the pilot alone lights nothing
    // its panel shuts when you walk off from the dial, or into a room that hasn't that fire
    if (fireDialOpen && (!S.mesh?.dials?.includes(fireDialOpen) || dialFar(fireDialOpen) > DIAL_REACH + 0.5)) closeFire();
    const fire = (0.84 + 0.1 * Math.sin(now * 0.011) + 0.06 * Math.sin(now * 0.027 + 1.3)) * Math.pow(flame, 0.8) * 1.25;
    // in a moving car the floor gives a little under you (rideBob); the walker's own eye is put back after the frame
    const bob = S.ride ? rideBob(now) : 0;
    if (bob) seat.eye[1] += bob;
    // cooking: the kitchen's camera, and its board, pans and food standing on this room's hob
    const mx = S.morph?.on ? S.morph.frame(now) : null;
    if (mx) { R.setProps(mx.props); R.setPropsGlass(mx.glass); R.setStageHalos(mx.halos); R.setGlows(mx.glows); }
    const cook = mx ? { cam: mx.cam } : S.cooking ? (S.chemming ? S.chemView : S.cookView) : null;
    if (cook?.props) R.setProps(cook.props);
    watchCookStand();
    // the Chem Stage's liquids, glows and light on this room's bench
    if (cook && S.chemming) { R.setPropsGlass(cook.glass); R.setStageHalos(cook.halos); R.setGlows(cook.glows); }
    // the shutters as they stand this frame; a phone's scene is a still picture
    const shf = S.shutters.frame(now);
    const shut = shf ? { ...shf, ...(S.shutAt?.mesh === S.mesh ? S.shutAt : (S.shutAt = { mesh: S.mesh, ...shutterFrame(Lr, S.mesh.windows) })), t: phone ? 41 : now / 1000, door: balconyGap() } : null;
    // arranging: its camera over the room, and its overlay drawn after the frame (room-arrange.js)
    const ax = S.arrange?.on ? S.arrange.frame(now) : null;
    // a run of sheets joining (room-sheets.js): its camera, until it's played
    watchJoins(now);
    const join = ax ? null : joinFrame(now);
    // the Pack open: the camera round you (packCamNow)
    const packed = !join && !ax && !cook && S.packCam ? packCamNow(now) : null;
    // a flat's door panel showing its camera: the landing drawn again from the camera's eye (room-feed.js)
    const feed = feedRequest(now, msg.zone, nextDoor, S.feedAt || (S.feedAt = { at: 0 }));
    // a Cup close up: the camera round it (room-closeup.js)
    const close = !join && !ax && !cook && !packed && S.closeup?.on ? S.closeup.frame(now) : null;
    // a conversation: the camera on who you're talking to (room-talk.js)
    const talk = !join && !ax && !cook && !packed && !close ? S.talk?.frame(now, seat) : null;
    // the Vat Hall's machines (room-vatcycle.js): the gantry's arms, a body down a tube, a release vat's fill and glass
    if (vatWaiting.length) vatCues(S);
    // the clone hall's monitors, live (room-vitals.js)
    if (S.L && S.vitalsOf !== S.L) { S.vitalsOf = S.L; S.vitals = createVitals(S.L); }
    if (S.vitals?.tick(now)) pushDecals();
    // the vat test, for staff in a room with a gantry
    if (vatBtn && vatBtn.hidden === !!(S.msg?.admin && S.mesh?.gantries?.length)) vatBtn.hidden = !vatBtn.hidden;
    if (S.mesh?.gantries?.length || S.vatCycle?.busy) {
      S.vatCycle ||= createVatCycle();
      const vc = S.vatCycle.frame(now, S);
      R.setVatScene?.(vc.scene);
      for (const l of vc.levels) R.vatLayer?.()?.setLevel(l.id, l.k);
      const out = S.vatCycle.stepOut(S, now);
      if (out && S.walk?.at) { S.walk.at[0] = out.at[0]; S.walk.at[1] = out.at[1]; seat.yaw = out.yaw; }
    }
    const vatcam = !join && !ax && !cook && !packed ? S.vatCycle?.cam(now, S, seat) || null : null;
    // where the picture is taken from, for who is drawn close up (posePeople)
    S.viewEye = (join?.cam || ax?.cam || cook?.cam || packed || vatcam || close || talk || null)?.eye || null;
    const topCam = !join && !ax && !cook && !packed && !close && !talk ? pokerTopCam() : null;
    R.render(join?.cam || ax?.cam || cook?.cam || packed || vatcam || close || talk || topCam || seat, { lamps: S.mesh.lamps, next: nextLit(Lr, seat.eye), lampOn, lampLevel: (power === 'low' ? lampLevel * EMERGENCY_K : lampLevel) * (S.spec.dim ?? 1), vatGain: S.spec.dim ? 1 + 1.6 * (1 - S.spec.dim) : 1, fire, flame,day: Math.min(1, (dayOf(h) * outside.dimOf() + out.flash * 0.5) * (S.spec.daylight ?? 1)), sky: S.drapes ? sky.map((v) => v * 0.3) : sky, wins: S.mesh.windows, annex, outZ: S.spec.balcony ? 0.145 : undefined, outRing: S.spec.balcony?.wrap ? [-S.spec.w / 2 - 0.145, S.spec.w / 2 + 0.145, S.spec.balcony.sides ? -1e6 : -S.spec.balcony.wrap - 0.005] : undefined, front: Lr.f, right: Lr.r, bearing: S.bearing, outside: out, lens: ax ? undefined : S.seeLens, tvOn: tvNow(now), shut, focusSharp: streetSharp(), panoGround: panoGround(), ...(feed ? { feed } : {}), ...pokerFocus(), ...(close || talk ? { dof: false } : {}) });
    if (bob) seat.eye[1] -= bob;
    if (ax) { ax.after(); if (lockUi.count) lockUi.hide(); hearing.tick(outside.hear, placeOfEar(h, now), outdoors); placeVoices(); return; }
    // shutters or blinds shut over the glass: a keypad or panel past a pane is hidden behind them
    const vis = { veiled: !!shf && (shf.drop > 0.5 || shf.vane > 0.6) };
    if (lockUi.count) lockUi.draw(host.clientWidth, host.clientHeight, seat.eye, S.walk?.at, S.drawnBodies, vis);
    if (envUi.on) envUi.draw(host.clientWidth, host.clientHeight, seat.eye, S.walk?.at, S.drawnBodies, vis);
    if (liftUi.on) liftUi.draw(host.clientWidth, host.clientHeight, readoutNow(now), S.ride && rideK(now)?.k < 1 ? S.ride : null);
    hearing.tick(outside.hear, placeOfEar(h, now), outdoors);
    hearing.room(S.spec?.decor?.sound, { now }, S.L?.world ? (u, v, y) => S.L.world(u, v, y) : null);
    placeVoices();
  }

  // ⚠ LIVE TOO DEAR, THE SIX FACES INSTEAD (room-outlook.js `slow`). A view of the same place is started without
  // `live` beside the live one, which goes on painting under the panes until all six faces are in; then the live one
  // stops and the new one is adopted, which hands the room every face at once, so no pane shows a face not yet
  // painted. `__roomFaces` is set for the page, so the rooms after this one start on faces and never pay to find
  // out again. A view that moves while the faces are coming (`place` gives it a new spot) starts them again.
  function toFaces(h) {
    const live = S.outlook, next = S.facesNext;
    if (!live?.live || !S.viewHooks) { if (next) { next.stop(); S.facesNext = null; } return; }
    if (!next) {
      if (!live.slow || S.spec?.balcony || S.spec?.open) return;   // a balcony (or a roof deck) stays live, slower (see the view's start below)
      console.info('[room] the live view out of the window is too slow here; changing to the six painted faces');
      globalThis.__roomFaces = true;
      const hooks = S.viewHooks;
      S.facesFor = live.spot;
      S.facesNext = createOutlook(live.spot, { host, onEye: () => {}, onFail: () => { S.facesNext?.stop(); S.facesNext = null; }, onPano: () => {}, feed: hooks.feed });
      return;
    }
    if (S.facesFor !== live.spot) { next.stop(); S.facesNext = null; return; }
    const look = lookOut();
    next.tick(h, liveWx(), look);
    if (!next.shown) return;
    live.stop();
    S.facesNext = null;
    S.outlook = next;
    next.adopt(S.viewHooks);
  }

  // What you can see the street through: the windows, and the street door. ⚠ THE STREET DOOR IS GLASS TOO. Its
  // leaves are glazed, a hotel pair has a fanlight over them, and open it's a hole onto the street, all of them holes
  // to the city under the room (gl/room.js `see`). Counting only the windows, facing the Embassy's doors from its
  // lobby was "no glass in view": the city stopped painting and the doors showed the last picture painted, the
  // street out of the front window, which then turned with your head.
  // A pane's spot on the plan: [u, v] at `m` along its wall
  const paneAt = (spec, q, m) => q.wall === 'front' ? [m, 0] : q.wall === 'back' ? [m, spec.d] : [(q.wall === 'left' ? -1 : 1) * spec.w / 2, m];
  const WALLS = new Set(['front', 'back', 'left', 'right']);
  const glassOf = (spec) => [...(spec.windows || []), ...(spec.openings || []).filter((o) => o.kind === 'front' && WALLS.has(o.wall)).map((o) => ({ wall: o.wall, a: o.a, b: o.b, y0: 0, y1: 3.2 }))];
  // Where you're looking out from, or null if there's no glass in front of you, so a wall or the en-suite
  // costs no paints (room-outlook.js).
  function lookOut() {
    const at = S.walk?.at, L = S.L, spec = S.spec;
    // a room at a rink looks out onto the ice, never the city (room-rink.js)
    if (!at || !L || spec?.rink || inAnnex(L, at[1], at[0])) return null;
    const fix = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const look = seat.yaw - Math.atan2(L.f[0], L.f[2]);
    const half = Math.atan(Math.tan(seat.fov * Math.PI / 360) * (host.clientWidth || 16) / (host.clientHeight || 9));
    const panes = glassOf(spec);
    // starts well before a pane is on screen, or the first frame of it at the edge is the last pose painted
    // a lift car has no glass of its own, but standing in it with the doors open you see the landing's (the
    // Solenne lobby's windows), so the city has to turn with you there too. Riding, the doors are shut.
    // a roof deck (spec.open) is outdoors everywhere on it, as a balcony's deck is: the city's all round you
    const outdoors = onBalcony(spec, at) || !!spec.open;
    let seen = outdoors || (!!(spec.car || spec.lift) && !S.ride);
    for (const q of panes) for (let k = 0; k <= 8 && !seen; k++) {
      const [u, v] = paneAt(spec, q, q.a + (q.b - q.a) * k / 8);
      seen = Math.abs(fix(Math.atan2(at[0] - u, at[1] - v) - look)) < half + 0.35;
    }
    if (!seen) return null;
    // ⚠ LIVE, ONLY THE PANES' STRIP IS BUILT (windshield.js v.cullX). The room's canvas covers the city but for its
    // panes, so a building that's off every pane's strip on screen is skipped as one off the side of the canvas is.
    // The strip is each pane's ends seen from the eye, with a margin for pitch and a tower leaning in; a pane edge
    // beside you or behind you, a balcony or a lift's landing, and it's the whole width.
    let cull = null;
    if (S.outlook?.live && !outdoors && !spec.car && !spec.lift) {
      // the room camera's own axes, pitch and all (gl/room.js roomMatrices), and each pane's four corners: a level
      // projection was a strip a third too narrow looking down from a penthouse, and cut the Coliseum's slices out
      const y = seat.yaw || 0, p = seat.pitch || 0, cp = Math.cos(p), sp = Math.sin(p);
      const f = [Math.sin(y) * cp, sp, Math.cos(y) * cp], r = [-Math.cos(y), 0, Math.sin(y)], e = seat.eye, tf = Math.tan(half);
      let lo = Infinity, hi = -Infinity;
      // a pane wholly behind you adds nothing; one with only some corners behind runs past the edge, the whole width
      for (const q of panes) {
        const xs = [];
        let behind = 0;
        for (const m of [q.a, q.b]) for (const h of [q.y0 ?? 0, q.y1 ?? 3]) {
          const [u, v] = paneAt(spec, q, m);
          const P = L.world(u, v, h), d = [P[0] - e[0], P[1] - e[1], P[2] - e[2]], ahead = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
          if (ahead < 0.3) { behind++; continue; }
          xs.push(0.5 + (d[0] * r[0] + d[2] * r[2]) / ahead / (2 * tf));
        }
        if (behind === 4) continue;
        if (behind) { lo = -Infinity; break; }
        for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
      }
      if (lo > -Infinity && hi > lo) cull = [Math.max(0, lo - CULL_PAD), Math.min(1, hi + CULL_PAD)];
    }
    // ⚠ LIVE, THE RESOLUTION FOLLOWS HOW MUCH GLASS IS ON SCREEN (windshield.js resCap). A street door across the
    // lobby is a narrow strip, and painting the whole canvas at full resolution for it halved the room's frame
    // rate; walk up to it and the strip widens and the street sharpens. No strip (beside the glass, or out on a
    // deck) is the full width, so full resolution.
    const res = cull ? Math.min(1, 0.3 + 1.2 * (cull[1] - cull[0])) : null;
    // ⚠ THE CITY'S EYE IS YOURS: live, it's painted every frame from where you stand (room-outlook.js `live`), and each
    // of the six faces is painted from where you stood when it was sent, and corrected for the step since (panoEye).
    // `deck`: out on the balcony, the only place the building's own face is in view (room-view.js roomCut)
    return { yaw: (S.bearing || 0) - look * 180 / Math.PI, pitch: seat.pitch, fov: seat.fov, at, room: [spec.w, spec.d], cull, ...(res ? { res } : {}), deck: !!onBalcony(spec, at), open: !!spec.open };
  }
  S.lookOut = lookOut;
  // where a face of the city was painted from (room-outlook.js `faceAt`, [u, v]), as a point in the room's frame at the
  // window view's own eye height (room-view.js viewOf: 1.6 m off the floor), for gl/room.js uPanoEye
  const panoEye = (at) => (Array.isArray(at) && S.L ? S.L.world(at[0], at[1], 1.6) : null);
  // how far down the street is from the eye, in metres, for the six faces' correction (gl/room.js uPanoGround): a
  // storey is about 3.2 m and the eye 1.6 m off the floor. 0 when the room doesn't say, which keeps the PANO_PROXY sphere alone
  const panoGround = () => (S.place?.storey ? Math.max(0, (S.place.storey - 1) * 3.2) + 1.6 : 0);

  // where you're hearing the outside from: how far from the glass, how much of an open door you've got,
  // and which way you're looking, on the compass
  function placeOfEar(h, now) {
    const at = S.walk?.at, spec = S.spec, L = S.L;
    let near = 99;
    if (at) for (const q of spec.windows || []) near = Math.min(near, q.wall === 'front' ? Math.max(0, at[1]) : Math.abs(at[0] - (q.wall === 'left' ? -1 : 1) * spec.w / 2));
    const b = spec.balcony, out = onBalcony(spec, at);
    const open = out ? 1 : b && at ? Math.exp(-Math.hypot(at[0] - (b.door[0] + b.door[1]) / 2, at[1]) / 2.2) : 0;
    return { now, hour: h, near, open, out, annex: !!(at && L?.annex && inAnnex(L, at[1], at[0])), look: (S.bearing || 0) * Math.PI / 180 - seat.yaw, storey: S.place?.storey ?? 1, storeys: S.place?.storeys ?? 0, wx: liveWx()?.weather || '', ...earPose(at) };
  }

  // Where the outside comes in, for room-sound.js to place it: the ear and its facing on the floor
  // plan (metres, u across, v back from the front wall, z up) and the nearest opening (a window's
  // middle, or the balcony door) with the way out through it. The plan maps to the world as
  // at + r·u − f·v (room-layout.js), a turn and no mirror, so facing (du, dv) the right is (−dv, du).
  function earPose(at) {
    const spec = S.spec, L = S.L;
    if (!at || !spec || !L) return {};
    const look = seat.yaw - Math.atan2(L.f[0], L.f[2]);
    const fwd = [-Math.sin(look), -Math.cos(look)];
    let spot = null, best = Infinity;
    const take = (u, v, out) => { const d = Math.hypot(at[0] - u, at[1] - v); if (d < best) { best = d; spot = { at: [u, v, 1.3], out }; } };
    for (const q of spec.windows || []) {
      const m = (q.a + q.b) / 2, side = q.wall === 'left' ? -1 : 1;
      if (q.wall === 'front') take(Math.max(q.a, Math.min(q.b, at[0])), 0, [0, -1]);
      else take(side * spec.w / 2, Math.max(Math.min(q.a, q.b), Math.min(Math.max(q.a, q.b), at[1] ?? m)), [side, 0]);
    }
    if (spec.balcony?.door) take((spec.balcony.door[0] + spec.balcony.door[1]) / 2, 0, [0, -1]);
    return { pose: { pos: [at[0], at[1], 1.6], fwd: [fwd[0], fwd[1], 0], right: [-fwd[1], fwd[0], 0], up: [0, 0, 1] }, spot };
  }

  // the weather for the view out: the live environment when it's loaded, else what the server sent
  let envSnapshot = null;
  import('./environment.js').then((m) => { envSnapshot = m.getEnvSnapshot; }).catch(() => {});
  const liveWx = () => { try { const s = envSnapshot?.(); return S.skyWord || s ? { weather: S.skyWord || String(s?.weatherType || '').toLowerCase() || undefined, moon: s?.moonPhase } : null; } catch { return null; } };

  // the world round the building has arrived: start shooting the view out of the window. A phone
  // keeps the painted street, since a second renderer is more than it should be asked for
  // ⚠ A BALCONY'S OUTSIDE IS THE BUILDING'S, NOT THE ROOM'S. The view's eye comes with the paint GLASS gives this
  // building's face on the room's side (room-view.js facadePaint), and the room is built again in it, once, so the
  // wall round the balcony door and the storeys round the flat are the Embassy's rose and not the lounge's plaster.
  // Kept for the Stage: every room of a building shares its view. A phone has no view, and gets gl/room-mesh.js's plain render.
  const takeFacade = (p) => {
    const k = p?.rgb ? JSON.stringify(p) : '';
    if (k === (S.facadeKey || '')) return;
    S.facade = k ? p : null; S.facadeKey = k;
    // (before the room's first build, the paint is only kept: that build takes it)
    if (S.spec?.balcony && S.mesh) rebuild();
  };
  ui_outlook = (o) => {
    o = { ...o, cut: balconyCut(S.spec) };
    S.bearing = o.bearing || 0;
    S.place = { storey: o.storey, storeys: o.storeys };
    outside.setPlace({ gx: o.gx, gy: o.gy, eyeX: 0, eyeY: 0, eyeZ: 1 + (o.storey || 1) * 0.3, fields: o.fields || [] });
    outside.weather(o.sky);
    if (o.sky?.weather) S.skyWord = String(o.sky.weather).toLowerCase();
    outdoors.setPlace({ map: o.map, gx: o.gx, gy: o.gy, bearing: S.bearing });
    pilots.update(o.contacts || []);
    S.actors = o.actors || [];
    if (phone || !o.map) { if (!o.map) S.noView = true; return; }
    // ⚠ A ROOM AT A RINK HAS NO CITY TO SEE (room-rink.js). Its openings are onto the ice, drawn under the room, and
    // the view box round the room is drawn over it: once the outlook's first paint landed there, the stands and the
    // ice gave way to GLASS's picture of the barn from inside its own walls. lookOut() kept it from painting again,
    // but not from painting once. So no outlook at all, and one handed on from the last room is stopped.
    if (S.spec?.rink) { S.outlook?.stop(); S.outlook = null; return; }
    const hooks = {
      host,
      onEye: (l) => { outside.setPlace({ eyeZ: l.eye, eyeX: l.eyeX, eyeY: l.eyeY }); takeFacade(l.paint); },
      onFail: () => { S.noView = true; },
      // a face of the city round the building, for the room's renderer to look the panes up in
      onPano: (i, pic, lens, at, ap) => (i === 6 ? R.setLook?.(pic, lens, panoEye(at), ap) : R.setPano(i, pic, lens, panoEye(at))),
      // what's moving out there: the timetable and anybody really flying or sailing, as GLASS draws any contact
      feed: () => { flights.update(outside.flightsNow()); return { actors: S.actors, contacts: [...flights.frame(o.gx, o.gy), ...pilots.frame(o.gx, o.gy)] }; },
    };
    // a view already running on this tile (handed on from the last room, or this room's own): move its eye here
    S.viewHooks = hooks;
    // ⚠ THE CITY IS PAINTED IN THE WORKER: the six faces and the look picture where you're looking (room-outlook.js
    // LOOK), so the room's frames never wait on GLASS. Painted here every frame (`live`), a Solenne balcony cost the
    // room 20 to 30 ms a frame. `__roomLive = true` puts the main-thread view back, for comparing.
    // ⚠ A ROOM WITH A STREET DOOR IS LIVE. The street is a few metres off, so a picture painted from one spot and
    // moved to your eye bent the kerb and the building opposite, and it stepped at the worker's rate as you walked
    // up. A ground floor sees little city, so live is cheap there; if it's still too slow, toFaces drops it to the
    // six faces as it does any window. `__roomFaces` (set by that drop) keeps the page on faces.
    const live = !!globalThis.__roomLive || ((S.spec?.openings || []).some((d) => d.kind === 'front' && d.dir) && !globalThis.__roomFaces);
    if (S.outlook && S.outlook.tile === `${o.gx},${o.gy}` && !!S.outlook.live === live) { S.outlook.adopt(hooks); S.outlook.place(o); return; }
    S.outlook?.stop();
    S.outlook = createOutlook(o, { ...hooks, live });
  };
  // the last room's view, when this is the next room of its building: shown at once, and moved here when
  // this room's `room_outlook` comes
  const kept = msg.hasView && !phone && !msg.spec?.rink ? takeParked(msg.building?.id) : null;
  if (msg.place) { S.bearing = msg.place.bearing || 0; S.lastPlace = msg.place; }
  if (kept) { S.outlook = kept; if (msg.place) kept.place({ ...msg.place, cut: balconyCut(S.spec) }); kept.adopt(S.viewHooks = { host, onEye: (l) => takeFacade(l.paint), onFail: () => { S.noView = true; }, onPano: (i, pic, lens, at, ap) => (i === 6 ? R.setLook?.(pic, lens, panoEye(at), ap) : R.setPano(i, pic, lens, panoEye(at))), feed: () => ({ actors: S.actors || [], contacts: [] }) }); }
  S.onSky = (m) => {
    if (m.weather !== undefined) { outside.weather(m); S.skyWord = String(m.weather || '').toLowerCase() || S.skyWord; S.outlook?.setSky({ weather: m.weather, wind: m.wind, here: m.here, event: m.event, ...(m.field ? { field: m.field } : {}) }); }
    if (m.contacts) pilots.update(m.contacts);
    if (m.actors) S.actors = m.actors;
  };
  if (pendingOutlook?.zone === msg.zone) ui_outlook(pendingOutlook);
  pendingOutlook = null;

  ui = { root, S, seat, outside, startMorph, openFridge, npcFridge, stop() {
    cancelAnimationFrame(raf);
    S.outlook?.stop();
    S.facesNext?.stop(); S.facesNext = null;
    hearing.stop();
    catVoice.stop(); catDraw.clear();
    hush(null);
    S.tv?.stop();
    window.removeEventListener('npc:speaking', onSpeaking);
    window.removeEventListener('npc:voice', onVoice);
    window.removeEventListener('npc:place', onPlace);
    window.removeEventListener('npc:talk', onTalk);
    S.talk?.dispose();
    voiced.clear();
    window.removeEventListener('npc:line', onLine);
    S.walk?.stop();
    ui?.hands?.stop();
    document.removeEventListener('keydown', onKey); hostRO?.disconnect();
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('kitchen:open', onCook);
    window.removeEventListener('kitchen:close', onCooked);
    S.morph?.close(); S.morph = null;
    S.pack?.destroy(); S.pack = null;
    S.arrange?.close(); S.arrange = null;
    window.removeEventListener('chem:open', onChem);
    window.removeEventListener('chem:close', onChemDone);
    clearTimeout(flashT);
    clearTimeout(sayT);
    S.studio?.dispose();
    lockUi.stop();
    liftUi.stop();
    envUi.stop();
    window.removeEventListener('envctl:light', onPanelLight);
    R.dispose();
    warmSpares();
  } };
  // ⚠ THE NEXT ROOM OF THE SAME BUILDING IS THE SAME STAGE (docs/proposals/building-stage.md). A doorway or a lift
  // ride used to close the Stage and open a new one: a new pane, a new GL context with its shaders compiled again,
  // the people's meshes made again and the seat ladder let go and claimed, which read as the room reloading. Now
  // the room's own state is swapped here and the renderer, the canvas, the bar and the view out are kept, so the
  // last frame of this room stays up until the first of the next.
  // ⚠ A DOORWAY IS WALKED THROUGH, NOT ARRIVED AT. A crossing used to stand you in the middle of the doorway
  // facing straight in, with the keys let go: whatever line you'd walked in on, the picture jumped sideways,
  // turned, and you stopped until W repeated. Now where you are and the way you face are carried into the next
  // room's frame, through the layout this room already has for it as a neighbour, and the keys you're holding
  // go with you (room-walk.js `carry`). Null (and the old spot in the doorway) when the server put you somewhere
  // you didn't walk to: a `north` typed in the log, the lab's __labVia.
  function carryThrough(next, held) {
    if (!held || next.ride || !S.L) return null;
    const n = nextDoor.find((x) => x.zone === next.zone);
    if (!n?.L) return null;
    try {
      const spec = next.lift ? { ...next.spec, lift: next.lift } : next.spec, Ln = roomLayout(spec, next.pieces || []);
      const o = (spec.openings || []).find((x) => x.to === msg.zone && x.dir);
      if (!o) return null;
      const p = S.L.world(held.at[0], held.at[1], 0), q = [p[0] + Math.sin(held.yaw), p[1], p[2] + Math.cos(held.yaw)];
      const a = n.L.local(p), b = n.L.local(q), at = [a[0], a[1]];
      // (still in that room's own wall is fine, and isn't the step back: watchDoorways `S.came`)
      const inside = openingInside(Ln, o), out = openingCrossed(Ln, at);
      // (a stair is crossed halfway up its flight, nowhere near where you'd stand off it: on the flight is near enough)
      const near = o.kind === 'stair' ? Math.abs(flightLocal(o, at[0], at[1])[1]) <= o.w / 2 : Math.hypot(at[0] - inside.at[0], at[1] - inside.at[1]) <= 1.5;
      if (!at.every(Number.isFinite) || !near || (out && out.to !== o.to) || !roomFree(Ln, at[0], at[1])) return null;
      const w0 = Ln.world(at[0], at[1], 0), w1 = Ln.world(at[0] + b[0] - a[0], at[1] + b[1] - a[1], 0);
      return { at, yaw: Math.atan2(w1[0] - w0[0], w1[2] - w0[2]) };
    } catch { return null; }
  }
  ui.cross = (next) => {
    const was = msg.zone, heldAt = S.walk?.at ? { at: S.walk.at.slice(), yaw: seat.yaw } : null;
    const through = S.walk?.sat ? null : carryThrough(next, heldAt), keys = S.walk?.keys?.() || null;
    // a draft belongs to the room it was made in: moved on to another, it's dropped unsaved
    if (S.arrange?.on) S.arrange.close();
    msg = next;
    S.msg = msg;
    seed = hashOf(msg.zone);
    S.spec = msg.lift ? { ...msg.spec, lift: msg.lift } : msg.spec;
    hush(S.spec);
    S.pieces = msg.pieces || []; S.people = msg.people || []; S.here = msg.here || msg.zone; S.locks = msg.locks || [];
    S.glass = msg.glass || null; S.drapes = drapesDrawn(S.glass); S.shutters.set(glassCover(S.glass), { snap: true });
    // this room's own switch and mains, before it's built (rebuild, below)
    ({ on: switchOn, level: lampLevel } = switchOf(msg.zone)); power = msg.power || 'on'; lampOn = switchOn && power !== 'off'; showLamp();
    S.plumb = msg.plumbing || null; S.inShower = null;
    S.tags = msg.tags || []; S.sprayLive = null;
    S.sheets = msg.sheets || []; endJoin(); S.builtAt = 0;
    // a depot room's stand is the new room's (room-hoist.js): the hangar next door has its own tug
    ui.hoistUi?.load(null, msg.vehicles?.machine ? null : msg.vehicles || null);
    S.tickets = msg.tickets || []; stadium.setMsg(msg);
    // what was being baked was for the doorways of the room you've left; this room's `room_ahead` is on its way
    bake.jobs.length = 0; bake.waiting = false; bake.gen = (bake.gen || 0) + 1; placedFor = null;
    nextDoor = neighboursOf(msg); joined = new Set(nextDoor.map((n) => n.zone)); S.next = nextDoor; reshell();
    S.moving = null; S.going = null; S.held = null; S.doorShut = false; S.spin = null; S.fridge = null; S.cardKey = null; showCard(null, null);
    // a set, a studio floor and whatever was on the props layer belonged to the last room
    S.tv?.stop(); S.tv = null; tvBar.hidden = true; S.npcTv = false; S.tvFromNpc = false; S.screenPainted = false;
    S.studio?.dispose(); S.studio = null;
    R.setProps({ data: new Float32Array(0), n: 0 }); S.propsOn = false;
    doorsAt(); slidesAt();
    lastHour = -1; shown.clear(); acting.clear(); onceFrom.clear();
    root.querySelector('.rs-where').innerHTML = `<b>${esc(msg.name)}</b>${msg.mine ? '' : ' · visiting'}`;
    // the Arrange button is the new room's: yours, or staff's on a local server (room-arrange.js)
    const arrangeBtn = root.querySelector('.rs-arrange');
    if (arrangeBtn) arrangeBtn.hidden = !(msg.mine || msg.admin);
    if (msg.place) { S.bearing = msg.place.bearing || 0; S.outlook?.place({ ...msg.place, cut: balconyCut(S.spec) }); S.lastPlace = msg.place; }
    S.warmTo = null; S.warmPlaced = null;
    // off a ride it's the same car, so you stay where you stood in it (it used to put you in its doorway, facing in)
    const hold = next.ride && was === next.zone && heldAt ? heldAt : null;
    S.ride = null; S.floorDrawn = null;
    S.walk?.stop(); S.walk = null;
    rebuild(false, hold || through, keys);
    S.came = through ? { to: was, past: Infinity } : null;
    S.noteRoutes();
    S.syncTv(msg.tv);
    sendRaw({ type: 'room_set', zone: msg.zone });
    warmStreet(false);
  };
  ui.building = () => msg.building?.id || null;
  // ⚠ THE NEXT FLOOR'S CITY IS BUILT DURING THE RIDE. In the car there's no glass, so the live view (room-outlook.js)
  // sat idle and did all its building as the doors opened on the new floor: the first frames there hitched. Once the
  // doors are shut, the eye is put at the floor the car is going to (a stop is LIFT_STOREY a floor, as the plan lays
  // the shaft out) and the city is painted unseen, facing the way the building faces, every other frame until it
  // arrives. The real placement comes with the new floor's room_view and moves the eye the last few centimetres.
  function warmView(now, h) {
    const o = S.outlook;
    if (!o?.live || !S.ride || !S.warmTo || now < (S.warmViewAt || 0) || !S.lastPlace?.frame) return;
    if (S.warmPlaced !== S.warmTo) {
      S.warmPlaced = S.warmTo;
      const fr = S.lastPlace.frame, dy = (S.warmTo - (S.ride.from || 1)) * LIFT_STOREY;
      o.place({ ...S.lastPlace, storey: S.warmTo, frame: { ...fr, floor: (Number(fr.floor) || 0) + dy } });
    }
    // ⚠ ALL FOUR WAYS, A QUARTER TURN A FRAME. Warming only the way the building faces left the other three to build
    // as the doors opened, so whichever way you faced popped in.
    const k = (S.warmTick = (S.warmTick || 0) + 1) % 4;
    o.warm(h, liveWx(), { yaw: (S.lastPlace.bearing || 0) + k * 90, pitch: 0, fov: seat.fov, at: [0, 1], room: [S.spec.w, S.spec.d] });
  }
  // ⚠ EVERY WAY OUT IS BUILT UNDER THE LOADING VEIL. A tile's first paint in the live view runs its arm cold and bakes
  // its surfaces into the atlas: 35 to 50 ms of arms and up to 180 ms of GL in one frame (perf:move --room 38 at the
  // Solenne). Only the way you faced was built as the room opened, so the first turn on a balcony stuttered through
  // every tile it brought into view. So the veil waits (bake.pending) while the view is painted unseen a quarter turn
  // a frame: level from inside, and from a balcony room looking down off the deck too (its own map, `deck`).
  function warmOpen(now, h) {
    const o = S.outlook;
    if (S.openWarmed || !S.spec || !S.lastPlace) return;
    // the view's renderer can still be loading (no outlook yet): wait for it, as long as the veil does
    if ((!o || (o.live && !o.shown)) && veiled && now - opened <= VEIL_MS) return;
    if (!o?.live || !veiled || now - opened > VEIL_MS) {
      if (S.openWarmN) S.bake.pending--;
      S.openWarmed = true;
      return;
    }
    if (!S.openWarmN) S.bake.pending++;
    const n = S.openWarmN = (S.openWarmN || 0) + 1, deckToo = !!S.spec.balcony, steps = deckToo ? 8 : 4;
    const k = (n - 1) % 4, deck = deckToo && n > 4;
    o.warm(h, liveWx(), { yaw: (S.lastPlace.bearing || 0) + k * 90, pitch: deck ? -0.3 : 0, fov: seat.fov, at: [0, S.spec.d / 2], room: [S.spec.w, S.spec.d], deck });
    if (n >= steps) { S.bake.pending--; S.openWarmed = true; }
  }
  // ⚠ THE STREET OUTSIDE IS ASKED FOR AHEAD (plugins/roomstage `roomstage.warm`, plugins/freelook): in a room with a
  // street door, a moment after it's up, so its own first frames come first. The street view it's sent is built hidden
  // (freelook-view.js `prewarm`), and walking out through the door shows it at once instead of a loading screen.
  // A phone keeps no second renderer, so it doesn't ask.
  // ⚠ ONLY UNDER THE LOADING VEIL. Building that view is main-thread GLASS: 1.8 s of one frame with the renderer
  // loaded and 6 s cold, then a dozen paints of 70 to 150 ms (headless Chrome, Solenne's lobby). Asked for 1.5 s after
  // the room was up, that froze the room you'd just walked into. Under the veil the same seconds hold a loading
  // screen. A room reached through a doorway or a lift has no veil, so it doesn't warm, and walking out loads as before.
  // ⚠ SO THE OTHER WAYS INTO A LOBBY WARM IT SOMEWHERE ELSE. Come in off the street and the view you walked in from
  // is kept asleep (freelook-view.js parkFreelook). Come down in the lift and it's built during the ride to the
  // ground floor, behind shut doors with nothing to walk into (`rideStart`). Open the Stage in the room next to the
  // lobby and it's built under that veil too; anywhere else in the building the veil only fetches the renderer,
  // which is most of a cold build, so the ride's share is short. The server answers from the building's entry room
  // whichever room asks (plugins/roomstage `roomstage.warm`).
  const frontIn = (spec) => (spec?.openings || []).some((o) => o.kind === 'front' && o.dir);
  const streetWarm = () => { try { return !!window.__freeLook?.()?.warm; } catch { return false; } };
  function warmStreet(veiled) {
    if (!veiled || phone || !msg.building?.id) return;
    if (frontIn(S.spec) || nextDoor.some((n) => frontIn(n.spec))) { if (!S.leaving && !streetWarm()) { S.streetAsked = true; sendRaw({ type: 'room_street' }); } return; }
    import('./freelook-view.js').then((m) => m.loadWindshield?.()).catch(() => {});
  }
  S.warmOnRide = (to, afterMs) => {
    if (phone || to !== 1 || !msg.building?.id || streetWarm()) return;
    setTimeout(() => { if (ui?.S === S && S.ride && !streetWarm()) sendRaw({ type: 'room_street' }); }, afterMs);
  };
  // ⚠ AN INNER ROOM HEARS THE OUTSIDE AND THE OTHER ROOMS AT HALF. A hall or a lift with no glass and no street door is
  // walls away from everything, but the zone's beds and the window beds (room-sound.js) all ride the ambient bus at
  // the level a room with a window gets. In one, the ambient bus is held 6 dB down (half the level) until you're in a
  // room that has glass, a balcony or a door onto the street, or the Stage closes. A sound from another room
  // (dispatch.js `audio_sfx` with `hops`) is on the sfx bus with your own, so it's halved where it's played, by the
  // gain left on the body as `data-room-hush`. Your own sounds and the TV aren't touched.
  const HUSH_DB = -6;
  let hushed = null;
  function hush(spec) {
    const inner = !!spec && !glassy(spec) && !frontIn(spec);
    if (inner === !!hushed) return;
    if (!inner) { try { hushed.release(); } catch { /* no audio */ } hushed = null; delete document.body.dataset.roomHush; return; }
    document.body.dataset.roomHush = String(Math.pow(10, HUSH_DB / 20));
    try { hushed = window.AudioEngine?.duck?.('ambient', HUSH_DB, { attack: 0.6, release: 0.8 }) || { release() {} }; } catch { hushed = { release() {} }; }
  }
  hush(S.spec);
  ui.lockUi = lockUi;
  ui.hoistUi = hoistUi;
  ui.stadium = stadium;
  ui.R = R; ui.draw = draw; ui.rebuild = rebuild; ui.followSelf = followSelf; ui.annexStand = annexStand; ui.roomStand = roomStand;
  rebuild(false);
  S.syncTv(msg.tv);
  // a studio set may claim this room (room-studio.js): ask, and the answer draws the set over it
  sendRaw({ type: 'room_set', zone: msg.zone });
  warmStreet(!msg.via);
  raf = requestAnimationFrame(frame);
  // the room keeps the keyboard from the command line while it's up
  const el = document.activeElement; if (el?.matches?.('input, textarea')) el.blur();
}

// The room's last frame, drawn now and copied in the same task (a GL canvas keeps nothing after it), laid over where
// the Stage was and faded out. A missing frame is a cut, not an error.
const FADE_MS = 520;
function fadeOver(u) {
  try {
    const cv = u.root.querySelector('.rs-canvas'), r = u.root.querySelector('.rs-host')?.getBoundingClientRect();
    if (!cv || !r?.width || !u.draw) return;
    u.draw(performance.now());
    const snap = document.createElement('canvas');
    snap.width = cv.width; snap.height = cv.height;
    snap.getContext('2d').drawImage(cv, 0, 0);
    snap.setAttribute('aria-hidden', 'true');
    Object.assign(snap.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: '9000', pointerEvents: 'none', opacity: '1', transition: `opacity ${FADE_MS}ms ease-out` });
    document.body.appendChild(snap);
    // stepping out is the push in reversed: the room draws back and brightens into daylight as it goes
    const move = !matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (move) { snap.style.transformOrigin = '50% 55%'; snap.style.transition += `, transform ${FADE_MS + 200}ms ease-out, filter ${FADE_MS}ms ease-in`; }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      snap.style.opacity = '0';
      if (move) { snap.style.transform = 'scale(0.9)'; snap.style.filter = 'brightness(1.4)'; }
    }));
    setTimeout(() => snap.remove(), FADE_MS + 200);
  } catch { /* the cut it was */ }
}

// The MORPHEX's menu on the visual rung: the pod's own (room-morphex.js), never the 2D modal. True when this room
// has a pod, so the caller drops the modal; the pod starts unless it's already running or has just let you out (the
// answers to what you bought arrive as morphex_panel too, and mustn't put you back in).
export function roomMorphex() {
  const S = ui?.S, pod = S?.pieces?.find((p) => p.pod);
  if (!pod) return false;
  if (!S.morph?.on && performance.now() - (S.morphEnd || 0) > 4000) ui.startMorph(pod);
  return true;
}

// For the gate and a harness: the eye and the room's state while it's open.
export const _test = () => (ui?.S ? { seat: ui.seat, S: ui.S, R: ui.R, draw: ui.draw, tv: ui.S.tv, outside: ui.outside, outlookMsg: lastOutlook, morph: (id) => ui.startMorph(ui.S.pieces.find((p) => p.id === id)), fridge: (id) => ui.openFridge(ui.S.pieces.find((p) => p.id === id)), baked: { n: baked.size, bytes: bakedBytes }, rebuild: () => ui.rebuild() } : null);

// Your hands in first person (stands-hands.js), made the first time and kept till the room closes. Each beat of a
// ritual (a bite, a sip, a drag, a dose) goes to the server as room_act, so everybody else in the room sees your
// figure do it (plugins/roomstage acts.js, gl/figure-reach.js).
function takeInHand(item) {
  if (!ui?.root || !item) return false;
  ui.hands ??= createHands(ui.root, ui.root.querySelector('.rs-host'), { send: sendCmd, onAct: (act, hold) => sendRaw({ type: 'room_act', act, hold }) });
  return ui.hands.take(item) !== false;
}
// What a machine in the room handed you (stands_hand, plugins/vending): held in first person, as a
// box's smokes are.
export function roomHand(msg) {
  if (msg?.item) takeInHand(msg.item);
}
// What's sprayed on this room's walls now (plugins/roomstage `room_tags`): a tag went up or was cleaned off. The real
// one takes the place of the spray session's piece.
export function roomTags(msg) {
  const S = ui?.S;
  if (!S || msg.zone !== S.msg.zone) return;
  S.tags = msg.tags || [];
  S.sprayLive = null;
  S.paintTags?.();
}
// The sheets hanging on this room's walls now (plugins/roomstage `room_sheets`): one went up or came down. A set made
// whole plays its join; a set that's lost a sheet comes apart and forgets it ever joined.
export function roomSheets(msg) {
  const S = ui?.S;
  if (!S || msg.zone !== S.msg.zone) return;
  const was = new Set(setsOf(S.sheets).filter(isWhole).map((g) => g.set));
  S.sheets = msg.sheets || [];
  const now = setsOf(S.sheets), whole = new Set(now.filter(isWhole).map((g) => g.set));
  for (const set of was) if (!whole.has(set)) { S.markJoin?.(set, false); if (S.scene?.set === set) S.endJoin?.(); }
  S.paintTags?.();
  for (const set of whole) if (!was.has(set)) { S.markJoin?.(set, false); S.startJoin?.(set); }
}
// The Pack (room-pack.js): what you carry and wear (plugins/roomstage pack.js `room_pack`), and a nudge to ask again
// when the inventory changed some other way (`inventory_dirty`, a `use`)
export function roomPack(msg) { ui?.S?.pack?.data(msg); }
export function roomPackDirty() { ui?.S?.pack?.dirty(); }

// A piece placed or taken while the room is open (or, with `pieces`, the whole room after a move-out).
export function roomPiece(msg) {
  if (!ui?.S) return;
  // in a room next door: its shell is built again with the piece where it is now
  const n = ui.S.next?.find((x) => x.zone === msg.zone);
  if (n) {
    if (Array.isArray(msg.pieces)) n.pieces = msg.pieces;
    else if (msg.gone) n.pieces = n.pieces.filter((p) => p.id !== msg.id);
    else if (msg.piece) n.pieces = [...n.pieces.filter((p) => p.id !== msg.piece.id), msg.piece];
    ui.S.reshell();
    ui.rebuild();
    return;
  }
  if (msg.zone !== ui.S.msg.zone) return;
  const S = ui.S;
  if (Array.isArray(msg.pieces)) S.pieces = msg.pieces;
  else if (msg.gone) S.pieces = S.pieces.filter((p) => p.id !== msg.id);
  else if (msg.piece) {
    const was = S.pieces.find((p) => p.id === msg.piece.id);
    S.pieces = [...S.pieces.filter((p) => p.id !== msg.piece.id), msg.piece];
    if (was?.keypad && was.form !== msg.piece.form) S.turn(msg.piece, was.form);
  }
  ui.rebuild();
}

// How the arrange mode's Save went (plugins/roomstage arrangeLayout): it closes, or points at what didn't fit.
export function roomArranged(msg) {
  if (ui?.S?.arrange?.on && msg.zone === ui.S.msg.zone) ui.S.arrange.result(msg);
  // a poster or hung piece dragged in the walk view (wallDrop)
  else if (ui?.S && msg.zone === ui.S.msg.zone) { if (msg.ok) ui.S.wallUndo = null; else ui.S.wallRefused?.(msg.message); }
}
// The admin arrange mode's Furniture menu (plugins/roomstage arrangeCatalog).
export function roomCatalog(msg) {
  if (ui?.S?.arrange?.on) ui.S.arrange.catalog(msg.items);
}
// The arrange mode's Posters menu: the rolls this player carries (plugins/roomstage arrangeSheetStock).
export function roomSheetStock(msg) {
  if (ui?.S?.arrange?.on) ui.S.arrange.stock(msg.items);
}

// A move on a chess table (plugins/gametable through plugins/roomstage): the position on that piece, and the room
// built again with it, as a piece that moved is.
export function roomBoard(msg) {
  const S = ui?.S;
  if (!S) return;
  const n = S.next?.find((x) => x.zone === msg.zone);
  const list = n ? n.pieces : msg.zone === S.msg.zone ? S.pieces : null;
  const p = list?.find((x) => x.id === msg.piece);
  // a poker felt is drawn every frame off the piece's state (gl/room-poker.js): nothing to rebuild
  if (p && msg.board?.poker) { p.board = msg.board; return; }
  if (!p || p.board?.board === msg.board?.board) return;
  p.board = msg.board;
  if (n) S.reshell();
  ui.rebuild();
}

// Your own hole cards at a card table, out of the felt the server just sent you (plugins/gametable render-pane.js
// `data-p3d`): the room's state on the table carries nobody's, so gl/room-poker.js turns yours face up from these.
export function roomPokerPane(html) {
  const S = ui?.S;
  if (!S) return;
  const m = /data-p3d="([^"]*)"/.exec(String(html || ''));
  let st = null;
  try { st = m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null; } catch { st = null; }
  const cards = st?.seats?.find((s) => s?.me)?.cards;
  S.pokerMine = Array.isArray(cards) && cards.some(Boolean) ? cards : null;
}

// The rooms past the next doorways, to build before you reach one (`bake` in openStage).
export function roomAhead(msg) {
  if (ui?.S?.ahead && msg?.zone === ui.S.msg.zone) ui.S.ahead(msg);
}

// The water in this room as it changed (plugins/roomstage `room_plumbing`): a shower turned on or off, a bowl
// filling, a stream starting or stopping, a flush.
export function roomPlumbing(msg) {
  const S = ui?.S;
  if (!S || msg.zone !== S.msg.zone) return;
  S.plumb = msg.plumbing || null;
}

// How the locks on this room's doorways stand now (plugins/roomstage `room_locks`): somebody locked one, or one gave.
// A body coming down a tube to a release vat in the room you're in (plugins/roomstage `room_vat`): the vat cycle plays it.
// (one that comes before its room has opened round you waits for it, a few seconds at most)
const vatWaiting = [];
export function roomVat(msg) {
  const S = ui?.S;
  if (!S?.L || msg.zone !== S.msg.zone) { vatWaiting.push({ msg, at: Date.now() }); return; }
  (S.vatCycle ||= createVatCycle()).arrive(msg, S.you);
}
function vatCues(S) {
  for (let i = vatWaiting.length - 1; i >= 0; i--) {
    const w = vatWaiting[i];
    if (Date.now() - w.at > 20000) { vatWaiting.splice(i, 1); continue; }
    if (S.L && w.msg.zone === S.msg.zone) { vatWaiting.splice(i, 1); (S.vatCycle ||= createVatCycle()).arrive(w.msg, S.you); }
  }
}
export function roomLocks(msg) {
  const S = ui?.S;
  if (!S?.L || msg.zone !== S.msg.zone) return;
  S.locks = msg.locks || [];
  ui.lockUi?.load(S.L, S.locks, { fresh: false, override: msg.override || null });
  if (msg.fx) ui.lockUi?.play?.(msg.fx);
}
// A `hololock_game` for a door of the room you're in: the bypass is played on its hologram. False when this room
// has no such door (a lock hacked from the log somewhere else), and the caller opens the ordinary board.
export const roomLockHack = (msg, args) => !!ui?.lockUi?.hack(msg, args);

// What stands on a depot shed's lift, changed by `hoist` or a drive off it (plugins/trucking hoist.js).
export function roomVehicles(msg) {
  if (!ui?.hoistUi || msg.zone !== ui.S?.msg.zone) return;
  // a stadium's resurfacer is room-machine.js's; a shed's truck is the hoist's
  if (msg.vehicles?.machine) { ui.stadium?.vehicles(msg.vehicles); return; }
  ui.hoistUi.load(null, msg.vehicles || null);
}
// Your tickets changed (plugins/stands `room_tickets`): a seat door's card lists them
export function roomTickets(msg) {
  if (!ui?.S) return;
  ui.S.tickets = Array.isArray(msg.tickets) ? msg.tickets : [];
  ui.S.card = null;
}

// The shutters over the room's glass and the scene on them, changed from its control panel (plugins/envcontrol).
// The mains in this room or one next door, as they change (plugins/roomstage `room_power`).
export function roomPower(msg) {
  ui?.S?.setPower?.(msg);
}

export function roomGlass(msg) {
  const S = ui?.S;
  if (!S?.shutters || msg.zone !== S.msg.zone) return;
  S.glass = msg.glass || null;
  S.shutters.set(glassCover(S.glass));
  // the drapes drawn or opened: they're geometry, so the room is built again with them as they now hang
  const drawn = drapesDrawn(S.glass);
  if (drawn !== S.drapes) { S.drapes = drawn; ui.rebuild(); }
}

// The world round the building, for the view out of the window.
export function roomOutlook(msg) {
  lastOutlook = msg;
  if (ui?.S && msg.zone === ui.S.msg.zone) ui_outlook?.(msg);
  else pendingOutlook = msg;
}

// The weather and who's flying, as they change.
export function roomSky(msg) {
  if (ui?.S && msg.zone === ui.S.msg.zone) ui.S.onSky?.(msg);
}

// What the server answered, for the couple of seconds after a line on the card. The log is covered.
export function roomSays(html) {
  const S = ui?.S;
  if (!S?.say || !(S.listenUntil > performance.now())) return;
  const text = new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent.trim();
  if (text) S.say(text);
}

// Which side of the en-suite's door you're on now. Usually you've just walked there; if you typed it,
// or something moved you, the walker goes to the door on that side.
export function roomHere(msg) {
  if (!ui?.S || msg.zone !== ui.S.msg.zone) return;
  const S = ui.S, L = S.L;
  S.here = msg.here; S.moving = null;
  const inside = msg.here !== msg.zone;
  if (L?.annex && S.walk?.at && inAnnex(L, S.walk.at[1], S.walk.at[0]) !== inside) S.walk.moveTo(inside ? ui.annexStand(L) : ui.roomStand(L));
}

// The studio set this room is, if one claims it (room-studio.js): the set and who's on its floor. Asked for when
// the room opens and again when its people change.
export function roomSet(msg) {
  const u = ui, S = u?.S;
  if (!S || msg.zone !== S.msg.zone) return;
  if (!msg.set) { S.studio?.dispose(); S.studio = null; return; }
  const host = u.root.querySelector('.rs-host');
  if (S.studio) { S.studio.show(msg); return; }
  import('./room-studio.js').then(({ createStudioFloor }) => {
    if (ui !== u) return;
    S.studio ??= createStudioFloor(host, { phone: matchMedia('(pointer: coarse)').matches });
    S.studio.show(msg);
  }).catch((err) => console.error('[room] the studio set failed to load:', err));
}

// The lift you're in has started to move (plugins/elevator): { car, from, to, ms }.
export function roomRide(msg) {
  if (ui?.S && msg?.car === ui.S.msg.zone) ui.S.rideStart?.(msg);
}

// Who's in the room now, and where.
// Somebody in the room wearing a club's crest on their cap (flags.figure.hat_badge, a club's name): the client asks for
// that league's clubs once, if it hasn't got the club, and the cap shows the crest when they come (gl/figure-hd.js).
const _crestAsked = new Set();
function askCrests(people) {
  for (const p of people || []) {
    const b = p.figure?.hat_badge, sport = p.figure?.hat_badge_sport || 'baseball';
    if (!b || b === 'bird' || clubOf(b, sport) || _crestAsked.has(sport)) continue;
    _crestAsked.add(sport);
    sendRaw({ type: 'tv_clubs', sport });
  }
}
export function roomPeople(msg) {
  askCrests(msg.people);
  if (!ui?.S) return;
  // next door: who you see through the doorway (bodiesNow draws them from here)
  const n = ui.S.next?.find((x) => x.zone === msg.zone);
  if (n) { n.people = msg.people || []; return; }
  if (msg.zone !== ui.S.msg.zone) return;
  // on a studio floor, somebody coming or going changes who's on the set's marks
  if (ui.S.studio && (msg.people || []).map((p) => p.id).sort().join('|') !== (ui.S.people || []).filter((p) => !p._gone).map((p) => p.id).sort().join('|')) sendRaw({ type: 'room_set', zone: msg.zone });
  const before = ui.S.people || [];
  ui.S.people = msg.people || [];
  ui.npcFridge?.();
  ui.S.beasts = msg.beasts || [];
  ui.S.noteRoutes();
  // somebody who's walked out is kept walking to the door, and somebody who's walked in comes through it
  ui.S.noteMoves?.(msg, before);
  ui.followSelf();
  ui.S.syncTv(msg.tv);
}

// Out of the street door: the server has you on the street and the GLASS view is on its way, so the
// room holds still and stays up until that view takes the pane (dispatch.js freelook_open).
export function roomStageLeaving() { if (ui?.S) { ui.S.leaving = true; ui.S.going = null; } }

// `handover` is the building the next Stage opens in: when it's this one's, the view out of the window is kept
// for it (parkView) instead of stopped.
// `fade`: out through a street door onto the warmed street (dispatch.js freelook_open): the room's last frame is laid
// over the pane and fades as the street takes it, so walking out reads as walking out. The glass in it is see-through,
// so the street shows through the doors and the windows first.
export function closeRoomStage(quiet = false, handover = null, { fade = false } = {}) {
  const u = ui;
  if (!u) { if (!handover) dropParked(); return; }
  ui = null;
  if (fade) fadeOver(u);
  // a street warmed for this lobby that nobody walked out into
  else if (!handover) import('./freelook-view.js').then((m) => m.dropWarmFreelook?.()).catch(() => {});
  const view = u.S?.outlook;
  if (view && handover && u.S.msg.building?.id === handover) { u.S.outlook = null; parkView(view, handover); }
  else if (!handover) dropParked();
  clearSprayStage(u.S?.sprayHost);
  u.stadium?.dispose();
  u.stop();
  u.root.remove();
  document.body.classList.remove('room-stage-on');
  // out onto the street the page stays laid out as it is: the street view binds the same ladder in this task
  if (fade) keepSeatRung(); else releaseSeatLadder();
  if (!quiet) sendCmd('room close');
}

// Where the Kitchen Stage stands in this room, on which ring, where you stand, the fridges and the other cookers:
// room-cook.js, which a room walked in GLASS asks too.
