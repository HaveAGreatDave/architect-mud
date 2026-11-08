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
// The log is covered, so what the server answers a line with comes up on the card (`roomSays`).

import { sendCmd, sendCmdSilent, sendRaw } from '../net.js';
import { closeDialogue } from './dialogue.js';
import { loadCss } from '../../../shared/dom.js';
import { roomLayout, inAnnex, onBalcony, pathAt, pathLength, roomYaw, seatsClash } from '../../../shared/room-layout.js';
import { pieceActs } from '../../../shared/room-acts.js';
import { createRoomWalk } from './room-walk.js';
import { createOutlook } from './room-outlook.js';
import { createRoomWindow } from './room-window.js';
import { makeContactTrack } from './world-feed.js';
import { createRoomSound } from './room-sound.js';
import { createWallTv } from './room-tv.js';
import { coverWithVeil } from './glass-veil.js';
import { createRoomRenderer } from './gl/room.js';
import { buildRoom, spinBatch, paintRoomTexture, paintView, paintScreen, ROOM_RUG } from './gl/room-mesh.js';
import { figurePeople, dressOf, clipOnce, actClip, clipHold, clipDur } from './gl/room-people.js';
import { mouthTrack, textTrack, mouthAt } from '../../../shared/lip-sync.js';
import { actOfLine, speakerOf } from '../../../shared/npc-acts.js';

const CSS = await loadCss(new URL('./room-stage.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-stage-css')) return;
  const s = document.createElement('style');
  s.id = 'room-stage-css'; s.textContent = CSS;
  document.head.appendChild(s);
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// how far a pixel of drag turns the head, radians
const TURN = 0.0045;
const SPIN_MS = 3000;   // a Cachet's turntable, half a turn
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

let ui = null;
// the outlook's handler while a room is open, and one that arrived a beat before the room finished
// loading: `room_view` goes through a dynamic import, `room_outlook` right behind it
let ui_outlook = null, pendingOutlook = null;

export const roomStageOpen = () => !!ui;

export function openRoomStage(msg) {
  ensureStyles();
  closeRoomStage(true);
  const root = document.createElement('div');
  root.id = 'room-stage';
  root.innerHTML = `<div class="rs-bar">
      <span class="rs-where"><b>${esc(msg.name)}</b>${msg.mine ? '' : ' · visiting'}</span>
      <span class="rs-tvbar" hidden>
        <button type="button" class="rs-ch-down" title="Channel down ([)" aria-label="Channel down">◂</button>
        <select class="rs-ch" title="Change the channel" aria-label="Channel"></select>
        <button type="button" class="rs-ch-up" title="Channel up (])" aria-label="Channel up">▸</button>
        <button type="button" class="rs-tv-off" title="Stop watching">Off</button>
      </span>
      <button type="button" class="rs-sit" title="Sit down or get up (E)">Sit down</button>
      <button type="button" class="rs-lamp" title="The lights, on or off (L)">Lights: on</button>
      <input type="range" class="rs-dim" min="10" max="100" step="5" value="100" title="Dim the lights (- and =)" aria-label="How bright the lights are">
      <button type="button" class="rs-tablet" title="Open your tablet">Tablet</button>
      <button type="button" class="rs-leave" title="Back to the room text (Esc)">▣ Close</button>
    </div>
    <div class="rs-host"><canvas class="rs-canvas"></canvas><div class="rs-tags"></div>
      <div class="rs-hover" hidden></div><div class="rs-flash"></div>
      <div class="rs-card" hidden><b class="rs-card-name"></b><div class="rs-card-acts"></div><p class="rs-card-say" hidden></p></div>
      <div class="rs-tip">WASD to walk, Shift to run, C to crouch · drag to look, Q and E to turn · face something or click it to see what you can do: F or a number picks · L for the lights, - and = to dim them · [ and ] change the channel</div>
    </div>`;
  document.body.appendChild(root);
  const host = root.querySelector('.rs-host'), canvas = root.querySelector('.rs-canvas');
  const phone = matchMedia('(pointer: coarse)').matches;
  // with a view out, the room is drawn over a live GLASS view and its panes are holes (room-outlook.js)
  const phone0 = phone, see = !phone0 && !!msg.hasView;
  const R = createRoomRenderer(canvas, { phone, see });
  if (!R) {
    host.innerHTML = '<p class="rs-none">This device can\'t draw the room in 3-D (no WebGL2). Everything in it is in the room text.</p>';
    root.querySelector('.rs-leave').addEventListener('click', () => closeRoomStage());
    ui = { root, stop() {} };
    return;
  }
  const seed = hashOf(msg.zone);
  const textures = new Map();
  const paint = (key) => { let c = textures.get(key); if (!c) { c = paintRoomTexture(document, key, key === ROOM_RUG ? seed : 1); textures.set(key, c); } return c; };
  let lampOn = true;
  // the dimmer: this viewer's, like the switch
  let lampLevel = 1;
  try { lampOn = localStorage.getItem('roomLamp') !== 'off'; lampLevel = Math.max(0.1, Math.min(1, Number(localStorage.getItem('roomLampLevel')) || 1)); } catch { /* private window */ }

  // the GLASS loading screen, up until the room is drawn and the view out of it is in
  coverWithVeil(host, 'room-stage', { ready: () => !msg.hasView || phone || ui?.S?.outlook?.painted || ui?.S?.noView });

  const outside = createRoomWindow();
  const hearing = createRoomSound();
  const pilots = makeContactTrack(), flights = makeContactTrack();
  const S = { msg, spec: msg.spec, pieces: msg.pieces || [], people: msg.people || [], L: null, mesh: null, walk: null, screenOn: new Set(), you: msg.you,
    here: msg.here || msg.zone, moving: null, outlook: null, lens: null, bearing: 0, phone };
  const seat = { eye: [0, 1.6, 0], yaw: Math.PI, pitch: 0, fov: 72, mode: 'free' };
  let syncing = false, raf = 0, lastHour = -1;
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256; screenCanvas.height = 192;

  // the room's light from the server's clock: the hour now, and how much day comes through the glass
  const hourNow = () => { const c = msg.clock; if (!c) return 13; return ((c.hour + (Date.now() - c.hourMs) / 3.6e6 * (c.rate || 1)) % 24 + 24) % 24; };
  const dayOf = (h) => Math.max(0, Math.min(1, (Math.sin((h - 6) / 12 * Math.PI) + 0.15) / 0.75));
  const skyOf = (h) => {
    const d = dayOf(h), dusk = Math.exp(-(((h - 19) / 1.2) ** 2)) + Math.exp(-(((h - 6.3) / 1.0) ** 2));
    return [0.55 + 0.4 * d + 0.4 * dusk, 0.6 + 0.35 * d + 0.1 * dusk, 0.85 + 0.15 * d - 0.2 * dusk];
  };

  // the layout and the mesh, from the spec and the pieces; again whenever a piece comes or goes
  function rebuild(keepPlace = true) {
    const L = roomLayout(S.spec, S.pieces);
    const was = S.walk ? { at: S.walk.at, sat: S.walk.sat } : null;
    S.L = L;
    S.mesh = buildRoom(L, { seed, lampOn, doorShut: S.doorShut, turning: S.spin?.turning });
    R.setRoom(S.mesh, paint);
    if (S.spin) S.spin.mesh = S.mesh.spin;
    S.walk?.stop();
    // a set in the room takes the TV's calls for as long as the room's open
    if (!S.tv && S.mesh.screens.length) S.tv = createWallTv(host, { onChange: showChannel });
    S.walk = createRoomWalk({
      L, seat, pane: root, label: 'ROOM', turnKeys: true,
      project: (p, w, h) => R.project(p, w, h),
      setMode: (m) => { seat.mode = m; },
      onStation: useStation,
      onUse: () => { const a = S.card?.acts[0]; if (a) runAct(a); return !!a; },
      aimable: (id) => reachable(S.pieces.find((p) => p.id === id)),
      canSit: (s) => !takenBy(s),
      onSit: (s) => {
        sitBtn.textContent = 'Get up';
        if (syncing) return;
        const piece = S.pieces.find((p) => p.id === s.piece);
        if (piece) sendCmd(`${s.lie ? 'lie' : 'sit'} ${piece.name}`);
        sendRaw({ type: 'room_pos', at: [s.u, s.v], yaw: s.yaw, seat: L.seats.indexOf(s) });
      },
      onStand: () => { sitBtn.textContent = 'Sit down'; if (!syncing) sendCmd('stand'); },
      onSettle: (at, yaw) => sendRaw({ type: 'room_pos', at, yaw, seat: S.walk?.sat ? L.seats.indexOf(S.walk.sat) : null }),
      // in by the door, facing into the room
      start: keepPlace && was?.at ? { at: was.at, yaw: seat.yaw } : S.here !== msg.zone && L.annex ? { at: annexStand(L), yaw: Math.atan2(-L.f[0], -L.f[2]) } : { at: [((S.spec.door?.[0] ?? 0.7) + (S.spec.door?.[1] ?? 1.6)) / 2, S.spec.d - 0.6], yaw: Math.atan2(L.f[0], L.f[2]) },
    });
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
    const want = inAnnex(L, w.at[1], w.at[0]) ? S.spec.annex.zone : msg.zone;
    if (want === S.here) return;
    S.moving = { to: want, t: now };
    sendCmd(want === msg.zone ? 'out' : 'in');
  }

  // The en-suite's door: shut behind a resident in there, and it gives as you come up to it, because
  // walking in on them is allowed. One remesh each way, as the lights are.
  function watchAnnexDoor() {
    const L = S.L, at = S.walk?.at, door = S.spec.annex?.door;
    if (!L?.annex || !door) return;
    const near = at && Math.hypot(at[0] - (door[0] + door[1]) / 2, at[1] - L.annex.v0) < 1.3;
    const shut = !near && S.people.some((p) => p.npc && p.shut);
    if (shut === !!S.doorShut) return;
    S.doorShut = shut;
    S.mesh = buildRoom(L, { seed, lampOn, doorShut: shut, turning: S.spin?.turning });
    R.setRoom(S.mesh, paint);
    if (S.spin) S.spin.mesh = S.mesh.spin;
  }

  // A Cachet going round: lifted out of the room and turned on the people's layer, then put back as
  // whatever's facing out now.
  S.turn = (piece, was) => { S.spin = { turning: { id: piece.id, from: was, to: piece.form }, t0: performance.now(), mesh: null }; };
  function watchSpin(now) {
    const sp = S.spin;
    if (!sp?.mesh) return;
    const k = Math.min(1, (now - sp.t0) / SPIN_MS), eased = k * k * (3 - 2 * k);
    R.setPeople(spinBatch(sp.mesh, eased * Math.PI));
    if (k < 1) return;
    S.spin = null;
    R.setPeople({ data: new Float32Array(0), n: 0 });
    S.mesh = buildRoom(S.L, { seed, lampOn, doorShut: S.doorShut });
    R.setRoom(S.mesh, paint);
  }

  // A resident put the set on: it comes on here through the verb you'd use. Only what they turned on
  // for you goes off with them, and if you turn it off it stays off.
  S.syncTv = (on) => {
    if (!!on === !!S.npcTv) return;
    S.npcTv = !!on;
    if (on) {
      const piece = S.pieces.find((p) => p.arche === 'screen' && !p.annex);
      if (piece && !S.tv?.on) { S.tvPiece = piece.id; S.tvFromNpc = true; sendCmdSilent(`watch ${piece.name}`); }
    } else if (S.tvFromNpc) { S.tvFromNpc = false; S.tv?.off(); }
  };

  // the routes people are on (plugins/roomstage/npc-life.js), from when each message came
  const routes = new Map();
  S.noteRoutes = () => {
    const now = performance.now();
    routes.clear();
    for (const p of S.people) if (p.route?.path?.length > 1) routes.set(p.id, { ...p.route, len: pathLength(p.route.path), t0: now });
  };
  S.noteRoutes();
  // who is sat in a seat, other than you
  function takenBy(s) {
    for (const p of S.people) if (p.id !== S.you && seatsClash(placeOf(p)?.seat, s)) return p;
    return null;
  }
  // where a person is drawn: a seat on the piece they're on (the one they said, or the first free),
  // where they settled, or by the door
  function placeOf(p) {
    const L = S.L;
    if (!L) return null;
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
      if (pick) return { seat: pick, at: [pick.u, pick.v], yaw: pick.yaw, pose: pick.lie ? 'lie' : 'sit', head: pick.head, top: pick.top };
    }
    if (p.at) return { at: p.at, yaw: p.yaw || 0, pose: 'stand', ...(p.clip ? { clip: p.clip } : {}) };
    // nobody has said where: by the door, a step apart from the next
    const i = S.people.indexOf(p), d = S.spec.door || [0.7, 1.6];
    if (p.annex && L.annex) { const [u, v] = annexStand(L); return { at: [u + (i % 3 - 1) * 0.4, v + 0.5], yaw: Math.atan2(-L.f[0], -L.f[2]), pose: 'stand' }; }
    return { at: [d[0] + 0.3 + (i % 3) * 0.45, S.spec.d - 0.5 - Math.floor(i / 3) * 0.5], yaw: Math.atan2(L.f[0], L.f[2]), pose: 'stand' };
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

  // a station: the verb the piece answers to. Watching a set brings the broadcast up on it, and the
  // server's answer to `watch` goes to the set on the wall (room-tv.js); again, and you stop watching.
  function useStation(st) {
    const piece = S.pieces.find((p) => p.id === st.piece);
    if (!piece) return;
    // the bench's HUD comes up over the room, and only the room's owner is told there's a keypad
    if (st.verb === 'workspace') { sendCmd('workspace'); return; }
    if (st.verb === 'keypad') { sendCmd(msg.keypad ? `keypad ${piece.name}` : `examine ${piece.name}`); return; }
    if (st.verb === 'watch') {
      if (S.tv?.on && S.tvPiece === piece.id) { S.tv.off(); return; }
      S.tvPiece = piece.id;
    }
    flash(st.verb === 'open' ? `You open the ${piece.name}.` : st.verb === 'watch' ? `You turn to the ${piece.name}.` : `You look at the ${piece.name}.`, true);
    sendCmd(`${st.verb} ${piece.name}`);
  }

  // The card. A piece in the en-suite answers from the en-suite, because the verb runs where you are.
  const reachable = (p) => !!p && !!p.annex === (S.here !== msg.zone);
  const cardEl = root.querySelector('.rs-card'), cardName = root.querySelector('.rs-card-name'), cardActs = root.querySelector('.rs-card-acts'), cardSay = root.querySelector('.rs-card-say');
  function actsOf(piece) {
    const acts = pieceActs(piece, S.L.seats.filter((s) => s.piece === piece.id));
    return S.walk?.sat?.piece === piece.id ? [{ verb: 'stand', label: 'Get up' }, ...acts.filter((a) => a.verb !== 'sit' && a.verb !== 'lie')] : acts;
  }
  // Somebody you can talk to: the verb runs where you are, so they have to be on your side of the door.
  const talkable = (p) => !!p?.npc && !!p.annex === (S.here !== msg.zone);
  const personActs = (p) => [{ verb: 'talk', label: 'Talk', cmd: `talk ${p.name.toLowerCase()}` }, ...(S.walk?.sat ? [{ verb: 'stand', label: 'Get up' }] : [])];
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
      const base = S.L.baseAt(pl.at[0], pl.at[1]), top = pl.pose === 'lie' ? (pl.top || 0.4) + 0.5 : (pl.pose === 'sit' ? 1.45 : 1.95) + base;
      const a = R.project(S.L.world(pl.at[0], pl.at[1], top), w, h), b = R.project(S.L.world(pl.at[0], pl.at[1], base), w, h);
      if (a && b && y >= a.y && y <= b.y && Math.abs(x - (a.x + b.x) / 2) <= Math.max(24, (b.y - a.y) * 0.3)) return p;
    }
    return null;
  }
  function showCard(piece, who) {
    const acts = who ? personActs(who) : piece ? actsOf(piece) : [], on = who || piece, key = on ? on.id + acts.map((a) => a.verb).join() : '';
    if (key === (S.cardKey || '')) return;
    S.cardKey = key;
    S.card = on ? { piece, who, acts } : null;
    cardEl.hidden = !on && cardSay.hidden;
    cardName.textContent = on?.name || '';
    cardActs.innerHTML = acts.slice(0, 9).map((a, i) => `<button type="button" data-i="${i}"><kbd>${i ? i + 1 : 'F'}</kbd>${esc(a.label)}</button>`).join('');
  }
  cardActs.addEventListener('click', (e) => { const b = e.target.closest('button'), a = b && S.card?.acts[Number(b.dataset.i)]; if (a) runAct(a); });
  function watchCard() {
    const w = S.walk;
    if (!w?.at) return;
    // held on a piece by a click until you walk away from where you clicked
    if (S.held && Math.hypot(w.at[0] - S.held.at[0], w.at[1] - S.held.at[1]) > 0.4) S.held = null;
    const heldWho = S.held?.who && S.people.find((p) => p.id === S.held.who);
    if (S.held?.who && !talkable(heldWho)) S.held = null;
    const who = heldWho || (S.held ? null : personAimed());
    const id = who ? null : S.held?.piece ?? w.aim();
    showCard(S.pieces.find((p) => p.id === id) || null, who);
  }
  let sayT = 0;
  S.say = (text) => {
    cardSay.textContent = cardSay.hidden ? text : `${cardSay.textContent} ${text}`;
    cardSay.hidden = false; cardEl.hidden = false;
    clearTimeout(sayT);
    sayT = setTimeout(() => { cardSay.hidden = true; cardEl.hidden = !S.card; }, 7000);
  };
  function runAct(a) {
    const piece = S.card?.piece, w = S.walk;
    if (!S.card || !w) return;
    S.held = null;
    if (a.verb === 'stand') { w.standUp(); return; }
    if (a.verb === 'sit' || a.verb === 'lie') {
      const mine = S.L.seats.filter((s) => s.piece === piece.id && !!s.lie === (a.verb === 'lie')), s = mine.find((x) => !takenBy(x));
      if (s) { w.sit(s); return; }
      if (mine.length) { flash(`${takenBy(mine[0]).name} is there.`, false); return; }
    }
    S.listenUntil = performance.now() + 2500;
    cardSay.hidden = true;
    if (a.verb === 'watch') { useStation({ piece: piece.id, verb: 'watch' }); return; }
    sendCmd(a.cmd);
  }

  // the dial in the bar, while a set's on
  const tvBar = root.querySelector('.rs-tvbar'), chSel = root.querySelector('.rs-ch');
  function showChannel(info) {
    tvBar.hidden = !S.tv?.on;
    const want = info.list.map((c) => `${c.number}|${c.name}`).join();
    if (chSel.dataset.list !== want) {
      chSel.dataset.list = want;
      chSel.innerHTML = info.list.map((c) => `<option value="${c.number}">${c.number} · ${esc(c.name)}</option>`).join('');
    }
    chSel.value = String(info.number);
  }
  chSel.addEventListener('change', () => { S.tv?.tune(Number(chSel.value)); chSel.blur(); });
  root.querySelector('.rs-ch-down').addEventListener('click', () => S.tv?.step(-1));
  root.querySelector('.rs-ch-up').addEventListener('click', () => S.tv?.step(1));
  root.querySelector('.rs-tv-off').addEventListener('click', () => S.tv?.off());

  // Where the pointer is on the set's picture, { u, v } from its top left, or null off it. The corners
  // are projected and the square they came from solved for, which keeps the perspective right.
  function tvPoint(x, y, w, h) {
    const sc = S.tv?.on && (S.mesh.screens.find((s) => s.id === S.tvPiece) || S.mesh.screens[0]);
    const q = sc && sc.quad.map((p) => R.project(p, w, h));
    if (!q || q.some((p) => !p)) return null;
    const [a, b, c, d] = q;
    const dx1 = b.x - c.x, dx2 = d.x - c.x, sx = a.x - b.x + c.x - d.x, dy1 = b.y - c.y, dy2 = d.y - c.y, sy = a.y - b.y + c.y - d.y;
    const den = dx1 * dy2 - dx2 * dy1;
    if (!den) return null;
    const g = (sx * dy2 - dx2 * sy) / den, k = (dx1 * sy - sx * dy1) / den;
    const A = b.x - a.x + g * b.x, B = d.x - a.x + k * d.x, D = b.y - a.y + g * b.y, E = d.y - a.y + k * d.y;
    // screen = (A u + B v + a) / (g u + k v + 1), the same in y: two lines in u and v
    const m00 = A - g * x, m01 = B - k * x, r0 = x - a.x, m10 = D - g * y, m11 = E - k * y, r1 = y - a.y, det = m00 * m11 - m01 * m10;
    if (!det) return null;
    const u = (r0 * m11 - m01 * r1) / det, v = (m00 * r1 - r0 * m10) / det;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { u, v } : null;
  }
  // the stretch of the screen batch showing the broadcast, and a new picture for it when there is one
  function tvNow(now) {
    if (!S.tv?.on) return null;
    const sc = S.mesh.screens.find((s) => s.id === S.tvPiece) || S.mesh.screens[0];
    if (!sc) return null;
    // a set behind you isn't worth painting: the sound goes on, and it's the same picture when you turn
    const fx = Math.sin(seat.yaw), fz = Math.cos(seat.yaw);
    const seen = sc.quad.some((q) => (q[0] - seat.eye[0]) * fx + (q[2] - seat.eye[2]) * fz > 0);
    if (seen && S.tv.paint(now)) R.setLive(S.tv.canvas);
    return sc;
  }

  const sitBtn = root.querySelector('.rs-sit'), lampBtn = root.querySelector('.rs-lamp');
  const dimEl = root.querySelector('.rs-dim');
  const showLamp = () => { lampBtn.textContent = `Lights: ${lampOn ? (lampLevel < 1 ? Math.round(lampLevel * 100) + '%' : 'on') : 'off'}`; lampBtn.setAttribute('aria-pressed', String(lampOn)); dimEl.value = String(Math.round(lampLevel * 100)); };
  // dimming needs no rebuild, only the lamps' own light: turning it up from off does
  const setLevel = (k) => {
    lampLevel = Math.max(0.1, Math.min(1, k));
    try { localStorage.setItem('roomLampLevel', String(lampLevel)); } catch { /* private window */ }
    if (!lampOn) toggleLamp(); else showLamp();
  };
  dimEl.addEventListener('input', () => setLevel(Number(dimEl.value) / 100));
  // the slider gives the keyboard back, or WASD stops walking
  dimEl.addEventListener('change', () => dimEl.blur());
  dimEl.addEventListener('pointerup', () => dimEl.blur());
  const toggleLamp = () => {
    lampOn = !lampOn; showLamp();
    try { localStorage.setItem('roomLamp', lampOn ? 'on' : 'off'); } catch { /* private window */ }
    rebuild();
  };
  showLamp();
  sitBtn.addEventListener('click', () => { if (S.walk && !S.walk.sitOrStand()) flash('Nowhere free to sit.', false); });
  lampBtn.addEventListener('click', toggleLamp);
  root.querySelector('.rs-tablet').addEventListener('click', () => sendCmd('tablet'));
  root.querySelector('.rs-leave').addEventListener('click', () => closeRoomStage());

  // looking round: a drag turns the head the way the mouse moves, held where you leave it
  const turn = (dx, dy) => { seat.yaw -= dx * TURN; seat.pitch = Math.max(-1.35, Math.min(1.35, seat.pitch - dy * TURN)); };
  let drag = null;
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.button === 1) e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId };
    try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  const hoverEl = root.querySelector('.rs-hover'), flashEl = root.querySelector('.rs-flash');
  const label = (hit) => {
    if (!hit) return '';
    if (hit.who) return `Talk to ${hit.who.name}`;
    if (hit.station?.verb === 'workspace') return `Work at the ${hit.station.target}`;
    if (hit.station?.verb === 'keypad' && msg.keypad) return 'Use the keypad';
    if (hit.station) { const p = S.pieces.find((x) => x.id === hit.station.piece); return p ? `${hit.station.verb === 'open' ? 'Open' : hit.station.verb === 'watch' ? 'Watch' : 'Look at'} the ${p.name}` : ''; }
    const p = S.pieces.find((x) => x.id === hit.seat.piece), who = takenBy(hit.seat);
    return who ? `${who.name} is there` : p ? `${hit.seat.lie ? 'Lie on' : 'Sit on'} the ${p.name}` : '';
  };
  host.addEventListener('pointermove', (e) => {
    const b = host.getBoundingClientRect();
    if (!drag && S.walk) {
      const x = e.clientX - b.left, y = e.clientY - b.top, who = personAt(x, y, b.width, b.height);
      const on = tvPoint(x, y, b.width, b.height), btn = on && S.tv.buttonAt(on.u, on.v);
      S.tv?.touching(on);
      const t = btn ? btn.title || btn.getAttribute('aria-label') || 'Press' : label(who ? { who } : S.walk.hit(x, y, b.width, b.height));
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
    const d = drag; drag = null;
    if (!d || !S.walk || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 14) return;
    const b = host.getBoundingClientRect();
    // a button on the picture first, in this same event: going full screen needs the click's own turn
    const on = tvPoint(e.clientX - b.left, e.clientY - b.top, b.width, b.height), btn = on && S.tv.buttonAt(on.u, on.v);
    if (btn) { btn.click(); return; }
    const who = personAt(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    if (who) { S.held = { who: who.id, at: [...S.walk.at] }; return; }
    const hit = S.walk.hit(e.clientX - b.left, e.clientY - b.top, b.width, b.height);
    const id = hit?.station?.piece ?? hit?.seat?.piece, piece = S.pieces.find((p) => p.id === id);
    if (!piece) { S.held = null; return; }
    if (!reachable(piece)) { flash(`The ${piece.name} is through the door.`, false); return; }
    S.held = { piece: id, at: [...S.walk.at] };
  });
  host.addEventListener('pointercancel', () => { drag = null; });
  host.addEventListener('pointerleave', () => { hoverEl.hidden = true; host.style.cursor = ''; S.tv?.touching(false); });
  host.addEventListener('wheel', (e) => { e.preventDefault(); seat.fov = Math.max(30, Math.min(95, seat.fov * (e.deltaY > 0 ? 1.06 : 1 / 1.06))); }, { passive: false });
  let flashT = 0;
  function flash(text, ok) {
    flashEl.textContent = text; flashEl.classList.toggle('rs-flash-no', !ok);
    flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on');
    clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove('on'), 1800);
  }

  const onKey = (e) => {
    // a field over the room (a container's count) keeps its keys, and the tablet has them when it's up
    const field = e.target.closest?.('input, textarea, [contenteditable]');
    if (field && field.closest('#room-stage, #container-panel')) return;
    if (document.getElementById('tablet-os-overlay')) return;
    if (field) return;
    const k = String(e.key || '');
    // a conversation has the keys. dialogue.js closes a talk on Escape but leaves a shop's to its host
    const talk = document.getElementById('dialogue-panel');
    if (talk?.classList.contains('active')) {
      if (k === 'Escape' && talk.classList.contains('shop-mode')) closeDialogue();
      return;
    }
    if (/^[1-9]$/.test(k) && S.card?.acts[k - 1]) { if (!e.repeat) runAct(S.card.acts[k - 1]); e.preventDefault(); return; }
    if (S.walk?.key(e, true)) { e.preventDefault(); return; }
    if (k === 'Escape' && S.held) { S.held = null; e.preventDefault(); }
    else if (k === 'Escape') { closeRoomStage(); e.preventDefault(); }
    else if (k === 'l' || k === 'L') { toggleLamp(); e.preventDefault(); }
    else if (k === '-' || k === '_') { setLevel(lampLevel - 0.1); e.preventDefault(); }
    else if (k === '=' || k === '+') { setLevel(lampLevel + 0.1); e.preventDefault(); }
    else if (k === '[' && S.tv?.on) { S.tv.step(-1); e.preventDefault(); }
    else if (k === ']' && S.tv?.on) { S.tv.step(1); e.preventDefault(); }
    else if (k === 'ArrowLeft') { turn(-26, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { turn(26, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { turn(0, -20); e.preventDefault(); }
    else if (k === 'ArrowDown') { turn(0, 20); e.preventDefault(); }
  };
  const onKeyUp = (e) => { S.walk?.key(e, false); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  // the people, as the close-up figure (gl/figure-hd.js), a phone's at the lighter level. Their
  // meshes are built a beat after the room is up, so the room shows first; somebody who walks in
  // later builds theirs on the frame they first appear.
  const tagsEl = root.querySelector('.rs-tags'), figLevel = phone ? 'lite' : 'hd';
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
  const onVoice = (e) => { const d = e.detail; lips.set(d.name, { track: d.trace?.length ? mouthTrack(d.trace) : textTrack(d.text), t0: performance.now() + d.delay * 1000 }); };
  window.addEventListener('npc:voice', onVoice);
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
    return m || undefined;
  };
  function eased(p, pl) {
    const now = performance.now(), k = 1 - Math.exp(-Math.min(0.1, (now - easedAt) / 1000) * 9), e = shown.get(p.id);
    const out = { ...pl };
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
      if (onceFrom.get(p.id)?.clip !== out.clip) onceFrom.set(p.id, { clip: out.clip, t0: now });
      out.phase = Math.min(0.999, (now - onceFrom.get(p.id).t0) / 1000 / once);
    }
    if (pl.pose === 'lie') return out;
    if (!e || Math.hypot(e.at[0] - pl.at[0], e.at[1] - pl.at[1]) > 2) { shown.set(p.id, { at: [...pl.at], yaw: pl.yaw }); return out; }
    if (pl.clip === 'walk') e.at = [...pl.at];
    else { e.at[0] += (pl.at[0] - e.at[0]) * k; e.at[1] += (pl.at[1] - e.at[1]) * k; }
    e.yaw += ((((pl.yaw - e.yaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * k;
    out.at = [...e.at]; out.yaw = e.yaw;
    return out;
  }
  const bodiesNow = () => {
    const bodies = [];
    for (const p of S.people) {
      if (p.id === S.you) continue;
      const pl = placeOf(p);
      // `rest` and `manner` pick what they idle at: asleep, out cold, or at work behind a bar (plugins/roomstage)
      if (pl) bodies.push({ id: p.id, ...eased(p, pl), dress: dressOf(p.order), sex: p.sex, figure: p.figure, mouth: mouthOf(p.name), rest: p.asleep ? 'sleep' : p.out ? 'out' : undefined, manner: p.manner });
    }
    easedAt = performance.now();
    return bodies;
  };
  setTimeout(() => {
    if (ui?.S !== S) return;
    try { for (const r of figurePeople(S.L, bodiesNow(), 0, { level: figLevel })) R.prepareFigure(r.key); } catch (err) { console.warn('[room] people:', err); }
    peopleOn = true;
    // and each one's other level, ready for when they cross the room (figurePeople's eye)
    if (figLevel === 'hd') setTimeout(() => { if (ui?.S === S) try { for (const r of figurePeople(S.L, bodiesNow(), 0, { level: 'lite' })) R.prepareFigure(r.key); } catch (err) { console.warn('[room] people:', err); } }, 400);
  }, 60);
  function drawPeople(t) {
    const bodies = bodiesNow();
    R.setFigures(figurePeople(S.L, bodies, t, { level: figLevel, eye: seat.eye }));
    // a name over each head
    const b = host.getBoundingClientRect();
    const nowMs = performance.now(), mineAnnex = !!(S.walk?.at && S.L.annex && inAnnex(S.L, S.walk.at[1], S.walk.at[0]));
    inView.clear();
    tagsEl.innerHTML = bodies.map((bd) => {
      const p = S.people.find((x) => x.id === bd.id), y = bd.pose === 'lie' ? (bd.top || 0.4) + 0.5 : bd.pose === 'sit' ? 1.45 : 1.95;
      const q = R.project(S.L.world(bd.at[0], bd.at[1], bd.pose === 'lie' ? y : y + S.L.baseAt(bd.at[0], bd.at[1])), b.width, b.height);
      if (!q || q.x <= -50 || q.x >= b.width + 50 || q.y <= -20 || q.y >= b.height) return '';
      const tag = `<span class="rs-tag${p?.npc ? ' npc' : ''}" style="left:${q.x.toFixed(0)}px;top:${q.y.toFixed(0)}px">${esc(p?.name)}</span>`;
      if (!p || !!p.annex !== mineAnnex || q.x < 0 || q.x > b.width) return tag;
      inView.add(p.name);
      const line = talking.get(p.name);
      if (!(line?.until > nowMs)) return tag;
      // kept on screen, above the name
      const sx = Math.max(170, Math.min(b.width - 170, q.x)), sy = Math.max(110, q.y - 30);
      return tag + `<span class="rs-say" style="left:${sx.toFixed(0)}px;top:${sy.toFixed(0)}px">${esc(line.text)}</span>`;
    }).join('');
  }

  function frame(now) { raf = requestAnimationFrame(frame); draw(now); }
  function draw(now) {
    if (!S.L) return;
    const h = hourNow();
    // the street out of the window, repainted as the hour turns
    if (Math.abs(h - lastHour) > 0.08) { lastHour = h; R.setView(paintView(document, h, seed)); }
    // the glass under the broadcast's page: dark, on or off
    if (!S.screenPainted) { paintScreen(screenCanvas, false, 0, seed); R.setScreen(screenCanvas); S.screenPainted = true; }
    if (peopleOn) drawPeople(now / 1000);
    watchDoor(now);
    watchAnnexDoor();
    watchCard();
    watchSpin(now);
    S.seeLens = S.outlook?.tick(h, liveWx(), lookOut()) || S.seeLens;
    const Lr = S.L, A = Lr.annex;
    // the en-suite's box on the ground, in the frame the light is worked out in. It reaches a little
    // past the walls, or a wall sitting exactly on its edge flickers between the two rooms' lamps
    let annex = null;
    if (A) { const p = Lr.world(A.u0 - 0.06, A.v0 - 0.06, 0), q = Lr.world(A.u1 + 0.06, A.v0 + S.spec.annex.d + 0.2, 0); annex = [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[2], q[2])]; }
    // past the glass: less day under cloud, and a flash lights the room as well as the sky
    const out = outside.frame(now, h, dayOf(h), Lr, S.bearing), flare = 1 + out.flash * 3.4, sky = skyOf(h).map((c) => c * flare);
    const fire = 0.84 + 0.1 * Math.sin(now * 0.011) + 0.06 * Math.sin(now * 0.027 + 1.3);
    R.render(seat, { lamps: S.mesh.lamps, lampOn, lampLevel, fire, day: Math.min(1, dayOf(h) * outside.dimOf() + out.flash * 0.5), sky, wins: S.mesh.windows, annex, outZ: S.spec.balcony ? 0.145 : undefined, outRing: S.spec.balcony?.wrap ? [-S.spec.w / 2 - 0.145, S.spec.w / 2 + 0.145, -S.spec.balcony.wrap - 0.005] : undefined, front: Lr.f, right: Lr.r, bearing: S.bearing, outside: out, lens: S.seeLens, tvOn: tvNow(now) });
    hearing.tick(outside.hear, placeOfEar(h, now));
  }

  // Where you're looking out from, or null if there's no glass in front of you, so a wall or the en-suite
  // costs no paints (room-outlook.js).
  function lookOut() {
    const at = S.walk?.at, L = S.L, spec = S.spec;
    if (!at || !L || inAnnex(L, at[1], at[0])) return null;
    const fix = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const look = seat.yaw - Math.atan2(L.f[0], L.f[2]);
    const half = Math.atan(Math.tan(seat.fov * Math.PI / 360) * (host.clientWidth || 16) / (host.clientHeight || 9));
    // starts well before a pane is on screen, or the first frame of it at the edge is the last pose painted
    let seen = onBalcony(spec, at);
    for (const q of spec.windows || []) for (let k = 0; k <= 8 && !seen; k++) {
      const m = q.a + (q.b - q.a) * k / 8, u = q.wall === 'front' ? m : (q.wall === 'left' ? -1 : 1) * spec.w / 2, v = q.wall === 'front' ? 0 : m;
      seen = Math.abs(fix(Math.atan2(at[0] - u, at[1] - v) - look)) < half + 0.35;
    }
    if (!seen) return null;
    return { yaw: (S.bearing || 0) - look * 180 / Math.PI, pitch: seat.pitch, fov: seat.fov, at, room: [spec.w, spec.d] };
  }
  S.lookOut = lookOut;

  // where you're hearing the outside from: how far from the glass, how much of an open door you've got,
  // and which way you're looking, on the compass
  function placeOfEar(h, now) {
    const at = S.walk?.at, spec = S.spec, L = S.L;
    let near = 99;
    if (at) for (const q of spec.windows || []) near = Math.min(near, q.wall === 'front' ? Math.max(0, at[1]) : Math.abs(at[0] - (q.wall === 'left' ? -1 : 1) * spec.w / 2));
    const b = spec.balcony, out = onBalcony(spec, at);
    const open = out ? 1 : b && at ? Math.exp(-Math.hypot(at[0] - (b.door[0] + b.door[1]) / 2, at[1]) / 2.2) : 0;
    return { now, hour: h, near, open, out, annex: !!(at && L?.annex && inAnnex(L, at[1], at[0])), look: (S.bearing || 0) * Math.PI / 180 - seat.yaw, storey: S.place?.storey ?? 1, storeys: S.place?.storeys ?? 0 };
  }

  // the weather for the view out: the live environment when it's loaded, else what the server sent
  let envSnapshot = null;
  import('./environment.js').then((m) => { envSnapshot = m.getEnvSnapshot; }).catch(() => {});
  const liveWx = () => { try { const s = envSnapshot?.(); return S.skyWord || s ? { weather: S.skyWord || String(s?.weatherType || '').toLowerCase() || undefined, moon: s?.moonPhase } : null; } catch { return null; } };

  // the world round the building has arrived: start shooting the view out of the window. A phone
  // keeps the painted street, since a second renderer is more than it should be asked for
  ui_outlook = (o) => {
    S.bearing = o.bearing || 0;
    S.place = { storey: o.storey, storeys: o.storeys };
    outside.setPlace({ gx: o.gx, gy: o.gy, eyeX: 0, eyeY: 0, eyeZ: 1 + (o.storey || 1) * 0.3, fields: o.fields || [] });
    outside.weather(o.sky);
    pilots.update(o.contacts || []);
    S.actors = o.actors || [];
    if (phone || S.outlook || !o.map) { if (!o.map) S.noView = true; return; }
    S.outlook = createOutlook(o, {
      host,
      onEye: (l) => { outside.setPlace({ eyeZ: l.eye, eyeX: l.eyeX, eyeY: l.eyeY }); },
      onFail: () => { S.noView = true; },
      // what's moving out there: the timetable and anybody really flying or sailing, as GLASS draws any contact
      feed: () => { flights.update(outside.flightsNow()); return { actors: S.actors, contacts: [...flights.frame(o.gx, o.gy), ...pilots.frame(o.gx, o.gy)] }; },
    });
  };
  S.onSky = (m) => {
    if (m.weather !== undefined) { outside.weather(m); S.skyWord = String(m.weather || '').toLowerCase() || S.skyWord; S.outlook?.setSky({ weather: m.weather, wind: m.wind, here: m.here, event: m.event, ...(m.field ? { field: m.field } : {}) }); }
    if (m.contacts) pilots.update(m.contacts);
    if (m.actors) S.actors = m.actors;
  };
  if (pendingOutlook?.zone === msg.zone) ui_outlook(pendingOutlook);
  pendingOutlook = null;

  ui = { root, S, seat, outside, stop() {
    cancelAnimationFrame(raf);
    S.outlook?.stop();
    hearing.stop();
    S.tv?.stop();
    window.removeEventListener('npc:speaking', onSpeaking);
    window.removeEventListener('npc:voice', onVoice);
    window.removeEventListener('npc:line', onLine);
    S.walk?.stop();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    clearTimeout(flashT);
    clearTimeout(sayT);
    R.dispose();
  } };
  ui.R = R; ui.draw = draw; ui.rebuild = rebuild; ui.followSelf = followSelf; ui.annexStand = annexStand; ui.roomStand = roomStand;
  rebuild(false);
  S.syncTv(msg.tv);
  raf = requestAnimationFrame(frame);
  // the room keeps the keyboard from the command line while it's up
  const el = document.activeElement; if (el?.matches?.('input, textarea')) el.blur();
}

// For the gate and a harness: the eye and the room's state while it's open.
export const _test = () => (ui?.S ? { seat: ui.seat, S: ui.S, R: ui.R, draw: ui.draw, tv: ui.S.tv, outside: ui.outside } : null);

// A piece placed or taken while the room is open (or, with `pieces`, the whole room after a move-out).
export function roomPiece(msg) {
  if (!ui?.S || msg.zone !== ui.S.msg.zone) return;
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

// The world round the building, for the view out of the window.
export function roomOutlook(msg) {
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

// Who's in the room now, and where.
export function roomPeople(msg) {
  if (!ui?.S || msg.zone !== ui.S.msg.zone) return;
  ui.S.people = msg.people || [];
  ui.S.noteRoutes();
  ui.followSelf();
  ui.S.syncTv(msg.tv);
}

export function closeRoomStage(quiet = false) {
  const u = ui;
  if (!u) return;
  ui = null;
  u.stop();
  u.root.remove();
  if (!quiet) sendCmd('room close');
}
