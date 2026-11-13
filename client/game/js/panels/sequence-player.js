// THE SEQUENCE PLAYER. A sequence (client/shared/sequence.js) on its set: the room, the cast in it,
// the cut between cameras and the graphics over the picture. Mounted by the TV for a live broadcast
// and by the Broadcast Studio to preview one, and it doesn't know which show it's playing.
//
// Two clocks. In `clock` mode it times itself and speaks the lines (the Studio). In `cued` mode the
// broadcast owns the time: `cue(i, text)` jumps to spoken beat i as its line airs, a silent beat after
// it runs on by itself, and the picture holds at the next spoken beat until that one's cued.
//
// A show with no sequence plays `live`: `liveStart` puts its people on the set's marks and each
// `liveLine` makes a beat as the line airs, shot by autoShot. That's every text show on the TV.
//
// The picture is gl/room.js, so a set is lit, inked and peopled exactly as a flat is. The people are
// the close-up figure (figure.js) in the comic manner, their mouths off lip-sync.js.
//
// ⚠ ONE RENDERER DRAWS BOTH CAMERAS. A picture in picture on `cam:` draws the frame from that camera
// first and copies it, then draws the programme over it, all in one task, since neither is kept.

import { createRoomRenderer } from './gl/room.js';
import { buildSet, SET_FRAME } from './gl/set-mesh.js';
import { figurePeople, actClip, clipDur, clipOnce } from './gl/room-people.js';
import { NPC_ACTS, speakerOf } from '../../../shared/npc-acts.js';
import { createGfxLayer, paintSlate, paintBoard } from './sequence-gfx.js';
import { paintBank } from './gl/screen-bank.js';
import { timeline, timelineLength, beatAt, gfxAt, shotCamera, roleMark, fill, tableRows, autoShot, lineSeconds, CUTS, sourceKind, camerasFacing, directionOf, parseCamLabel } from '../../../shared/sequence.js';
import { mouthTrack, textTrack, mouthAt } from '../../../shared/lip-sync.js';

const PIP_MS = 80;       // a second camera, twelve times a second
const WALL_MS = 66;      // the live feed on the wall
const TURN_K = 0.1;      // how fast a body turns to whoever's talking, a frame
const MONO = 'grayscale(1) contrast(1.18) brightness(1.06)';   // a set's `picture: 'mono'`
const NO_WIN = { p: [0, -40, 0], n: [0, 1, 0], a: [0.01, 0, 0], b: [0, 0, 0.01], k: 0 };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// `onFrame` is called straight after each frame is drawn, while its picture is still in the buffer: a
// set in the Room Stage copies it from there (room-tv.js), since a WebGL picture is gone after the task.
// `onAir` false draws a set as the room it is, never in black and white (the studio floor, room-studio.js).
export function createSequencePlayer(host, { mode = 'clock', phone = false, feed = null, photo = null, speak = null, onBeat = null, onEnd = null, onFrame = null, onAir = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sq-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  const veil = document.createElement('canvas');       // the outgoing picture, under a dissolve or a wipe
  veil.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0';
  const black = document.createElement('div');
  black.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none;opacity:0';
  host.append(canvas, veil, black);
  const R = createRoomRenderer(canvas, { phone });
  if (!R) { canvas.remove(); veil.remove(); black.remove(); return null; }
  const gfx = createGfxLayer(host, { photo });

  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 1024; wallCanvas.height = 384;
  const blank = document.createElement('canvas'); blank.width = blank.height = 2;

  let S = null, raf = 0, last = 0, playing = false, t = 0, beatNow = -1, lastPip = 0, lastWall = 0, wallKey = '', cueLimit = Infinity, trans = null;
  const lips = new Map(), turned = new Map();

  // ── live: the beats are made as the lines air ──
  const LIVE_KEEP = 40;
  const WALK_MS = 1.45;   // a host's brisk pace across his own stage, metres a second (startWalk, stepWalk)
  function liveStart({ set, people = [], data = {} }) {
    load({ seq: { id: 'live', roles: {}, beats: [] }, set, cast: {}, data, seed: 'live' });
    // `billed` is the name a line airs under ("THE CONTROL VOICE says"), and it's the same person as `name`
    S.live = { looks: new Map(people.map((p) => [p.name, p])), billed: new Map(people.filter((p) => p.billed).map((p) => [String(p.billed).toLowerCase(), p.name])), said: new Map(), prev: null, prevRole: '', n: 0, k: 0, home: new Map() };
    for (const p of people) seat(p.name);
    // a mark kept `for` somebody is filled before they speak, so the desk is never empty at the open
    for (const m of Object.values(S.set.marks || {})) for (const name of [].concat(m.for || [])) seat(name);
    // anybody the show has already moved (the host mid-monologue, for a viewer tuning in now)
    for (const p of people) if (p.to) liveBlock(p.name, p.to, { cut: false });
    // the set before anybody's said anything
    const shot = autoShot(S.set, S.seq, '', {});
    S.seq.beats.push({ id: 'l0', shot, gfx: [] });
    S.tl.push({ i: 0, beat: S.seq.beats[0], role: '', text: '', spoken: false, t0: 0, dur: 4, data: S.data });
    cueLimit = Infinity;
    playing = true;
    start();
  }
  // somebody's seat: the next free mark, or none, and then they're heard and not seen
  function seat(name) {
    name = S.live.billed?.get(String(name).toLowerCase()) || name;
    const L = S.live, have = Object.keys(S.cast).find((r) => S.cast[r].name === name);
    if (have) return have;
    // a line under one word, "John" or "AKERSON", is whoever's cast under that first name or surname,
    // or he'd take a free mark as a stranger with a rolled face and his own lower third
    const one = !/\s/.test(String(name).trim()) && roleNamed(name);
    if (one) return one;
    // the monologue's mark is somewhere to go, not a seat (liveBlock)
    // a mark kept `for` somebody (the commentators' chairs in a booth) is theirs, and nobody else's
    const used = new Set(Object.values(S.seq.roles).map((r) => r.mark)), marks = S.set.marks || {}, lc = String(name).toLowerCase();
    const kept = (m) => [].concat(marks[m].for || []).map((x) => String(x).toLowerCase());
    const mark = Object.keys(marks).find((m) => !used.has(m) && kept(m).includes(lc))
      || Object.keys(marks).find((m) => !used.has(m) && !marks[m].standup && !marks[m].walk && !kept(m).length)
      || floorSpot();
    if (!mark) return '';
    const role = `p${Object.keys(S.cast).length + 1}`;
    S.seq.roles[role] = { mark, label: name };
    const dressed = S.set.looks?.[lc];
    S.cast[role] = L.looks.get(name) || { id: `viewer:${name}`, name, ...(dressed ? { sex: dressed.sex || null, figure: dressed.figure || null } : {}) };
    return role;
  }
  // The marks are all taken: somebody else in the room (an NPC on the studio floor while a show's on) stands
  // on open floor instead of vanishing. A spot clear of the furniture, the marks, the cameras and the walls,
  // toward the back so the show stays in front, facing the set's focus. It's a mark made for them, on this
  // stage's own copy of the set, and it's no seat: never kept `for` anybody and never a standup or a walk.
  const FLAT = new Set(['wall', 'panelling', 'joists', 'rug', 'bulb', 'sign', 'poster', 'corkboard', 'can_wall']);
  function floorSpot() {
    const set = S.set, room = set.room || {}, w = +room.w || 0, d = +room.d || 0;
    if (!w || !d) return '';
    const marks = set.marks || {};
    const busy = [];
    for (const p of set.pieces || []) if (Array.isArray(p.at) && !FLAT.has(p.type)) busy.push([p.at[0], p.at[1], Math.max(0.6, (+p.w || 0) / 2 + 0.35)]);
    for (const m of Object.values(marks)) if (Array.isArray(m.at)) busy.push([m.at[0], m.at[1], 0.8]);
    for (const c of Object.values(set.cameras || {})) if (Array.isArray(c.at)) busy.push([c.at[0], c.at[1], 1]);
    const [fu, , fv] = set.focus || [0, 0, d / 2];
    let best = null;
    for (let v = d - 0.6; v >= 1.2; v -= 0.3) {
      for (let u = -w / 2 + 0.6; u <= w / 2 - 0.6; u += 0.3) {
        const clear = Math.min(...busy.map(([bu, bv, r]) => Math.hypot(u - bu, v - bv) - r));
        if (clear < 0) continue;
        // further back first, then the more room around it
        const score = v + Math.min(clear, 0.6);
        if (!best || score > best.score) best = { u, v, score };
      }
    }
    if (!best) return '';
    const name = `floor${Object.keys(marks).length + 1}`;
    const yaw = Math.round(Math.atan2(fu - best.u, fv - best.v) * 180 / Math.PI);
    S.set = { ...set, marks: { ...marks, [name]: { at: [+best.u.toFixed(2), +best.v.toFixed(2)], yaw, pose: 'stand', label: 'Standing by' } } };
    return name;
  }
  // a beat made now, as the line or the direction airs
  function pushLive(beat, { role = '', text = '', dur = 3, name = '' } = {}) {
    S.seq.beats.push(beat);
    const t0 = Math.max(t, S.tl.length ? S.tl[S.tl.length - 1].t0 + 0.01 : 0);
    S.tl.push({ i: S.seq.beats.length - 1, beat, role, text, spoken: !!(role && text), t0, dur, data: { ...S.data, ...S.cast, speaker: S.cast[role] || { name } } });
    if (S.tl.length > LIVE_KEEP * 2) { S.tl.splice(0, LIVE_KEEP); beatNow = -1; }
    t = t0;
    S.live.prev = beat.shot;
  }
  // whoever's cast under a name, or a first name, or a surname: "Nguyen" finds "Captain Nguyen"
  function roleNamed(word) {
    const w = String(word || '').toLowerCase().split(/\s+/)[0];
    if (!w) return '';
    return Object.keys(S.cast).find((r) => String(S.cast[r].name || '').toLowerCase().split(/\s+/).includes(w)) || '';
  }
  // a framing on somebody from the camera that faces them best, or the whole set
  function shotOn(role, frame, move) {
    const mark = role ? roleMark(S.set, S.seq, role) : null, cams = Object.keys(S.set.cameras || {});
    if (!mark) return { cam: cams[0] || '', frame: frame === 'wide' ? 'full' : 'wide', on: [], move, cut: 'cut' };
    return { cam: camerasFacing(S.set, mark)[0]?.id || cams[0] || '', frame, on: [role], move, cut: 'cut' };
  }
  function liveLine(name, text) {
    if (!S?.live || !text) return;
    const L = S.live, role = name ? seat(name) : '', said = L.said.get(role) || 0;
    // a CAM line in the script picked this shot; it holds for the line after it
    const dir = L.dir || L.floor;
    L.dir = null;
    // a line from nobody on the set (the crowd laughing, applause) holds on whoever just spoke, whose voice is
    // often still going: the whole set is framed on the desk, and from the star he's out of it
    const hold = !role && !dir && L.prevRole && S.cast[L.prevRole] && L.prev?.on?.includes(L.prevRole);
    const shot = dir ? { ...dir, on: dir.on.length || dir.frame === 'full' ? dir.on : role ? [role] : [] }
      : hold ? { ...L.prev, move: 'none', cut: 'cut' } : autoShot(S.set, S.seq, role, { prev: L.prev, prevRole: L.prevRole, said, n: L.n++ });
    const first = role && !said;
    const beat = { id: `l${++L.k}`, shot, ...(role ? { say: { role, lines: [text] } } : {}), gfx: first ? [{ kind: 'lower', text: S.cast[role]?.billed || '{speaker.name}', sub: S.cast[role]?.title || S.data.show || '', at: 0.4, for: 4.5 }] : [] };
    pushLive(beat, { role, text, dur: lineSeconds(text), name });
    if (role) { L.said.set(role, said + 1); lips.set(role, { track: textTrack(text), t0: performance.now() }); }
    L.prevRole = role || L.prevRole;
  }
  // A walk's step, by the clock: the walking mark moved that far along its path, up or down with its points'
  // lift (the step onto the deck), and turned the way he's going. At the end he's on the mark he was walking
  // to, and turns from there to face its way, or sits if it's a seat.
  function stepWalk(role) {
    const id = S.seq.roles[role]?.mark, m = S.set.marks[id], w = m?.walk;
    if (!w) return;
    let d = Math.max(0, (performance.now() - w.t0) / 1000) * WALK_MS;
    w.walked = d;
    for (let i = 1; i < w.path.length; i++) {
      const a = w.path[i - 1], b = w.path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= len) {
        const k = len ? d / len : 1;
        m.at = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        m.lift = (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * k;
        if (len > 1e-3) m.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
        return;
      }
      d -= len;
    }
    S.seq.roles[role].mark = w.to;
    delete S.set.marks[id];
  }
  // Whether a speaker is somebody the stage was given, look and all. One it wasn't would be seated as a
  // stranger with a rolled face, so the TV asks for the cast again (tv-stage.js onStranger).
  function liveKnows(name) {
    if (!S?.live || !name) return true;
    name = S.live.billed?.get(String(name).toLowerCase()) || name;
    if (S.live.looks.has(name)) return true;
    const r = Object.keys(S.cast).find((k) => S.cast[k].name === name) || (!/\s/.test(String(name).trim()) && roleNamed(name));
    return !!r && !String(S.cast[r]?.id || '').startsWith('viewer:');
  }
  // The show moves somebody (plugins/broadcast _block): 'standup' to the set's monologue mark (the mark with
  // `standup`, out of the free seats), 'seat' back to the one they were given. The cue comes with the line
  // they say there, which has already cut to where they were, so that beat's shot is redone on where they are.
  function liveBlock(name, to, { cut = true } = {}) {
    if (!S?.live || !name) return;
    const L = S.live, role = seat(name), r = role ? S.seq.roles[role] : null;
    if (!r) return;
    const stand = Object.keys(S.set.marks || {}).find((m) => S.set.marks[m].standup);
    if (!L.home.has(role)) L.home.set(role, r.mark);
    const walking = S.set.marks[r.mark]?.walk, now = walking ? walking.to : r.mark;
    // The walk-on: from the start of the stand-up mark's `from` path (behind the curtain) along it to the
    // mark. Already there, or on his way, it's nothing; tuning in late, or with no path, he's just there.
    if (to === 'walkon') {
      const m = stand ? S.set.marks[stand] : null;
      if (now === stand) return;
      if (!cut || !m?.from?.length) { liveBlock(name, 'standup', { cut }); return; }
      startWalk(role, [...m.from, m.at], stand, m);
      // the announcer's lower third gives way to his, which then isn't shown again on his first line
      const at = S.tl[S.tl.length - 1].t0;
      for (const it of S.tl.slice(0, -1)) for (const g of it.beat.gfx || []) {
        const from = it.t0 + (g.at || 0);
        // one due to start after the cut (0.4 s into the announcer's line) never shows; `for: 0` would mean the beat's length
        if (g.kind === 'lower' && (g.for ? from + g.for : it.t0 + it.dur) > at) g.for = Math.max(1e-3, at - from);
      }
      S.tl[S.tl.length - 1].beat.gfx = [{ kind: 'lower', text: '{speaker.name}', sub: S.cast[role]?.title || S.data.show || '', at: 0.8, for: 3.6 }];
      L.said.set(role, (L.said.get(role) || 0) + 1);
      return;
    }
    const want = to === 'standup' ? stand : L.home.get(role);
    if (!want || want === now) return;
    // Back to his seat by the set's route from where he is (the seat mark's `via`, keyed by the mark he's
    // leaving: the star to the desk goes along the front of the deck, up its step and round behind the desk)
    const via = S.set.marks[want]?.via?.[now];
    if (cut && !walking && via?.length) { startWalk(role, [S.set.marks[now].at, ...via, S.set.marks[want].at], want, null); return; }
    if (walking) delete S.set.marks[r.mark];   // cut off mid-walk: he's simply there
    r.mark = want;
    turned.delete(role);
    if (!cut) return;
    const shot = shotOn(role, 'medium', 'none'), last = S.tl[S.tl.length - 1];
    if (last?.role === role) last.beat.shot = shot;
    else pushLive({ id: `l${++L.k}`, shot, gfx: [] }, { dur: 1.6 });
    L.prev = shot;
  }
  // A walk along `path` ([x, z] or [x, z, lift] points, from where he is to the mark `to`) on a mark of its own
  // that moves (stepWalk), so a shot on him follows him; cut to a wide one from the camera that faces `face`
  // best (the walk-on's mark), or the middle of the route.
  function startWalk(role, path, to, face) {
    const L = S.live, r = S.seq.roles[role], pts = path.map((p) => [+p[0], +p[1], +(p[2] ?? 0)]);
    const lift0 = S.set.marks[r.mark]?.lift || 0;
    if (!path[0][2] && lift0) pts[0][2] = lift0;
    const end = S.set.marks[to];
    if (end?.lift && !(path[path.length - 1][2])) pts[pts.length - 1][2] = end.lift;
    const id = `~walk:${role}`;
    S.set.marks[id] = { at: [pts[0][0], pts[0][1]], lift: pts[0][2], yaw: end?.yaw ?? 180, pose: 'stand', walk: { path: pts, role, to, t0: performance.now(), walked: 0 } };
    r.mark = id;
    turned.delete(role);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const mid = pts[Math.floor(pts.length / 2)], aim = face || { at: [mid[0], mid[1]], yaw: 180 };
    const cam = camerasFacing(S.set, aim)[0]?.id || Object.keys(S.set.cameras || {})[0] || '', shot = { cam, frame: 'wide', on: [role], move: 'none', cut: 'cut' };
    pushLive({ id: `l${++L.k}`, shot, gfx: [] }, { role, dur: len / WALK_MS + 1.2 });
    L.prev = shot;
  }
  // A stage direction as it airs, "Neil slams his fist on the table.": true if it's somebody on the set,
  // who then does it while the camera does what the words say (directionOf).
  function liveAct(line) {
    if (!S?.live || !line) return false;
    const L = S.live, names = [...new Set([...L.looks.keys(), ...Object.values(S.cast).map((c) => c.name)])].filter(Boolean);
    const name = speakerOf(line, names);
    if (!name) return false;
    const role = seat(name);
    if (!role) return false;
    const { act, shot: dir } = directionOf(line.slice(name.length + 1));
    const shot = dir ? shotOn(roleNamed(dir.toward) || role, dir.frame, dir.move) : L.dir || L.prev || shotOn(role, 'medium', 'drift');
    if (!dir) L.dir = null;
    // a dropped camera lies on the floor for every line after it, until a CAM line picks it up
    if (dir?.move === 'drop') L.floor = { ...shot, move: 'floor' };
    const clip = act && actClipFor(act, roleMark(S.set, S.seq, role)?.pose);
    pushLive({ id: `l${++L.k}`, shot, ...(act ? { act: { [role]: act } } : {}), gfx: [] }, { role, dur: clip ? Math.min(6, Math.max(2.5, clipOnce(clip) || clipDur(clip))) : 3, name });
    L.prevRole = role;
    return true;
  }
  // A CAM line from the script, "CAM — 3 — SWING to Nguyen in the corner": the next shot is that one.
  // A set with fewer cameras than the script counts takes them round again.
  // Facts that change as the show airs (the score a film's tournament is at): the wall reads them now
  function liveData(patch) {
    if (!S?.live || !patch) return;
    Object.assign(S.data, patch);
    const last = S.tl[S.tl.length - 1];
    if (last) last.data = { ...last.data, ...patch };
    wallKey = '';
  }
  // A title card that aired (tv-stage.js): from now on it's what the set's screen shows, as a still of
  // `w` by `h` that rolls now and then. A set with a bank of screens keeps its own.
  function liveCard(img, w, h) {
    if (!S?.live || !img || !(w > 0) || !(h > 0)) return;
    S.live.card = { img, w, h };
    wallKey = '';
  }
  function paintCard(now) {
    if (now - lastWall < WALL_MS * 2 && wallKey === 'card') return;
    wallKey = 'card'; lastWall = now;
    const { img, w, h } = S.live.card, c = wallCanvas.getContext('2d'), W = wallCanvas.width, H = wallCanvas.height;
    // the canvas is stretched over the screen, so the card is fitted to the screen's shape, not the canvas's
    const k = (w / h) / (S.wall.aspect || W / H), dw = k <= 1 ? W * k : W, dh = k <= 1 ? H : H / k, x = (W - dw) / 2, y = (H - dh) / 2;
    // every eleven seconds the picture loses its hold for a moment and rolls
    const ph = (now / 1000) % 11, roll = ph > 10.2 ? ((ph - 10.2) / 0.8) * dh : 0;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    try { c.drawImage(img, x, y + roll, dw, dh); if (roll) c.drawImage(img, x, y + roll - dh, dw, dh); } catch { /* a lost image */ }
    // a faint bar of brighter lines climbing it, as a tube has
    const bar = H - ((now / 40) % (H * 1.6));
    c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(x, bar, dw, H * 0.12);
    R.setLive(wallCanvas);
  }
  function liveDirection(label) {
    if (!S?.live) return;
    const c = parseCamLabel(label);
    if (!c) return;
    const cams = Object.keys(S.set.cameras || {});
    if (!cams.length) return;
    const n = parseInt(c.cam.slice(3), 10) || 1, cam = S.set.cameras[c.cam] ? c.cam : cams[(n - 1) % cams.length];
    const who = roleNamed(c.on), frame = c.frame === 'wide' && !who ? 'full' : c.frame;
    S.live.dir = { cam, frame, move: c.move, on: who ? [who] : [], cut: 'cut' };
    S.live.floor = null;
    // a move the audience should see happen goes up now, before anybody speaks
    // and the line after it holds the shot still rather than doing the move again
    if (['whip', 'snap', 'pull'].includes(c.move)) {
      pushLive({ id: `l${++S.live.k}`, shot: S.live.dir, gfx: [] }, { dur: 1.6 });
      S.live.dir = { ...S.live.dir, move: 'none' };
    }
  }
  // the clip an act or a clip name plays for somebody sitting or standing; an act they can't do there is null
  function actClipFor(act, pose = 'sit') {
    if (!act || act === 'auto') return null;
    return NPC_ACTS.includes(act) ? actClip(act, pose) : act;
  }

  function load({ seq, set, cast = {}, data = {}, seed = '' }) {
    const m = buildSet(set);
    // a set shot in black and white (`picture: 'mono'`): the whole frame, the dissolve under it included.
    // A filter on the canvas, so it costs the renderer nothing, and a copy of the frame (page-paint.js grab)
    // takes the canvas's filter with it.
    canvas.style.filter = veil.style.filter = onAir && set?.picture === 'mono' ? MONO : '';
    R.setRoom(m.room, () => blank);
    R.setScreen(blank);
    S = { seq, set, cast, data, seed, lamps: m.lamps, wall: m.wall, tl: timeline(seq, data, { cast, seed }) };
    turned.clear(); lips.clear(); gfx.clear();
    t = 0; beatNow = -1; wallKey = ''; cueLimit = mode === 'cued' ? 0 : Infinity;
    for (const r of bodiesAt(null)) R.prepareFigure?.(figurePeople(SET_FRAME, [r], 0, { level: phone ? 'lite' : 'hd' })[0].key);
    return S;
  }
  // new data on the same sequence (the sample changed in the Studio): the lines may be different
  function setData(data) { if (!S) return; S.data = data; S.tl = timeline(S.seq, data, { cast: S.cast, seed: S.seed }); wallKey = ''; gfx.clear(); }

  const roles = () => Object.keys(S.seq.roles || {});
  // The people, each on their mark, turned a little to whoever's talking.
  function bodiesAt(it) {
    const out = [];
    for (const r of roles()) {
      if (roleMark(S.set, S.seq, r)?.walk) stepWalk(r);
      const mark = roleMark(S.set, S.seq, r), who = S.cast[r];
      if (!mark || !who) continue;
      // walking on: along his path, facing the way he's going, the walk clip paced by the ground covered
      if (mark.walk) {
        const yaw = (mark.yaw ?? 180) * Math.PI / 180;
        turned.set(r, yaw);
        out.push({ id: who.id, at: [...mark.at], yaw, pose: 'stand', lift: +mark.lift || 0, sculpt: true, sex: who.sex, figure: who.figure, dress: who.dress || '', mouth: mouthOf(r), clip: 'walk', walked: mark.walk.walked });
        continue;
      }
      const base = (mark.yaw ?? 180) * Math.PI / 180;
      let want = base;
      const speaker = it?.role, sm = speaker && speaker !== r ? roleMark(S.set, S.seq, speaker) : null;
      if (sm) want = base + wrapAngle(Math.atan2(sm.at[0] - mark.at[0], sm.at[1] - mark.at[1]) - base) * 0.6;
      const yaw = (turned.get(r) ?? want);
      const next = yaw + wrapAngle(want - yaw) * TURN_K;
      turned.set(r, next);
      // an act starts its clip at the head of the beat, so a slam lands once rather than wherever the clock was
      const clip = actClipFor(it?.beat.act?.[r] || mark.act, mark.pose || 'sit'), into = Math.max(0, t - (it?.t0 || 0));
      const phase = clip ? (clipOnce(clip) ? Math.min(0.999, into / clipOnce(clip)) : into / clipDur(clip)) : undefined;
      out.push({ id: who.id, at: mark.at, yaw: next, pose: mark.pose || 'sit', lift: +mark.lift || 0, table: mark.table || null, surfaces: mark.surfaces || null, sculpt: true, sex: who.sex, figure: who.figure, dress: who.dress || '', mouth: mouthOf(r), gaze: [0, 0.06], ...(clip ? { clip, phase } : {}) });
    }
    return out;
  }
  function mouthOf(role) {
    const l = lips.get(role);
    if (!l) return null;
    const m = mouthAt(l.track, (performance.now() - l.t0) / 1000);
    if (!m && performance.now() > l.t0) lips.delete(role);
    return m || null;
  }

  // A line starting: voiced, with its mouth off the voice's own timing, or off the letters without it.
  function voiceLine(it) {
    if (!it.text || !it.role && !speak) return;
    const trace = [], res = speak ? speak(it, trace) : null;
    lips.set(it.role, { track: trace.length ? mouthTrack(trace) : textTrack(it.text), t0: performance.now() + (res?.delay || 0) * 1000 });
    // a voice runs at its own pace, so the beat waits for it
    if (mode === 'clock' && res?.duration > it.dur) {
      const more = res.duration + 0.2 - it.dur;
      it.dur += more;
      for (const later of S.tl) if (later.t0 > it.t0) later.t0 += more;
    }
  }

  function enterBeat(i) {
    const it = S.tl[i], cut = it.beat.shot?.cut || 'cut', ms = CUTS[cut]?.ms || 0;
    if (ms && beatNow >= 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (cut === 'dip') trans = { cut, from: performance.now(), ms };
      else {
        veil.width = canvas.width; veil.height = canvas.height;
        veil.getContext('2d').drawImage(canvas, 0, 0);
        trans = { cut, from: performance.now(), ms };
      }
    }
    beatNow = i;
    if (mode === 'clock' && playing) voiceLine(it);
    onBeat?.(it, i);
  }

  function drawTransition(now) {
    if (!trans) return;
    const k = Math.min(1, (now - trans.from) / trans.ms);
    if (trans.cut === 'dip') black.style.opacity = String(1 - Math.abs(k * 2 - 1));
    else if (trans.cut === 'wipe') { veil.style.opacity = '1'; veil.style.clipPath = `inset(0 0 0 ${k * 100}%)`; } else { veil.style.opacity = String(1 - k); veil.style.clipPath = ''; }
    if (k >= 1) { trans = null; black.style.opacity = '0'; veil.style.opacity = '0'; veil.style.clipPath = ''; }
  }

  // What's on the wall: `feed` is the programme, `list` a list off the data, anything else the show's own title.
  function paintWall(it, now) {
    if (!S.wall) return;
    // a booth's bank of screens (set-mesh.js screen_bank): one atlas, each screen showing what the show asks
    if (S.wall.bank) {
      const d = it?.data || S.data, screens = { ...(S.set.screens || {}), ...(S.seq.screens || {}), ...(it?.beat.screens || {}) };
      const title = fill(it?.beat.wallText || S.seq.wallText || '{show}', d), sub = fill(S.seq.wallSub || '', d);
      const key = `bank|${JSON.stringify(screens)}|${title}|${sub}`;
      if (key === wallKey && !(S.bankMoves && now - lastWall > 250)) return;
      wallKey = key; lastWall = now;
      S.bankMoves = paintBank(wallCanvas, { screens, brand: S.set.brand || {}, show: fill('{show}', d) || S.set.brand?.name || '', title, sub, ticker: fill(S.seq.ticker || S.set.ticker || d.ticker || '', d), d, now });
      R.setLive(wallCanvas);
      return;
    }
    if (S.live?.card) { paintCard(now); return; }
    const src = it?.beat.wall || S.seq.wall || 'brand';
    if (src === 'feed') {
      const f = feed?.();
      if (now - lastWall < WALL_MS && wallKey === 'feed') return;
      lastWall = now;
      const c = wallCanvas.getContext('2d');
      if (f && f.width) { try { c.drawImage(f, 0, 0, wallCanvas.width, wallCanvas.height); } catch { /* a lost context */ } } else if (wallKey !== 'feed') paintSlate(wallCanvas, fill('{venue}', S.data) || 'Live', 'Live');
      wallKey = 'feed';
      R.setLive(wallCanvas);
      return;
    }
    // a set can letter its own wall from the data (an arena's scoreboard: '{score}'), falling back to the show
    const d = it?.data || S.data, title = fill(it?.beat.wallText || S.seq.wallText || S.set.wallText || '{show}', d) || fill('{show}', d);
    const rows = src === 'list' ? tableRows({ list: it?.beat.wallList, row: it?.beat.wallRow, limit: 6 }, d) : null, key = `${src}|${title}|${rows?.join()}`;
    if (key === wallKey) return;
    wallKey = key;
    if (rows) paintBoard(wallCanvas, title, rows); else paintSlate(wallCanvas, title, fill(S.seq.wallSub || S.set.wallSub || '', d));
    R.setLive(wallCanvas);
  }

  // `lights` in the data (0..1) dims the set: a house-lights-down moment in a show, sent as a live fact
  const lit = () => { const k = Number(S.data?.lights); return Number.isFinite(k) && S.data.lights !== '' ? Math.max(0.03, Math.min(1, k)) : 1; };
  const light = () => ({ lamps: S.lamps, lampOn: true, lampLevel: lit(), day: (S.set.ambient ?? 0.5) * lit(), sky: [0.7, 0.8, 1], wins: [NO_WIN], ...(S.wall ? { tvOn: { first: S.wall.first, count: S.wall.count } } : {}) });

  function paintSources(now, it) {
    const list = gfx.painted;
    if (!list.length || now - lastPip < PIP_MS) return;
    lastPip = now;
    for (const p of list) {
      const c = p.canvas.getContext('2d');
      if (p.kind === 'cam') {
        const shot = { cam: p.source.split(':')[1], frame: 'wide', on: Object.keys(S.seq.roles || {}) };
        R.render(shotCamera(S.set, S.seq, shot, 0.5, 0), light());
        c.drawImage(canvas, 0, 0, p.canvas.width, p.canvas.height);
      } else if (p.kind === 'wall') c.drawImage(wallCanvas, 0, 0, p.canvas.width, p.canvas.height);
      else if (p.kind === 'feed') {
        const f = feed?.();
        if (f && f.width) { try { c.drawImage(f, 0, 0, p.canvas.width, p.canvas.height); continue; } catch { /* the slate below */ } }
        if (!p.slated) paintSlate(p.canvas, fill('{venue}', p.data) || 'Live', 'Live');
      } else paintSlate(p.canvas, p.source.split(':')[1] || p.source);
    }
    void it;
  }

  function render(now) {
    if (!S || !S.tl.length) return;
    const i = beatAt(S.tl, t), it = S.tl[i];
    if (i !== beatNow) enterBeat(i);
    const k = Math.min(1, (t - it.t0) / it.dur), cam = shotCamera(S.set, S.seq, it.beat.shot, k, t - it.t0);
    R.setFigures(figurePeople(SET_FRAME, bodiesAt(it), now / 1000, { level: phone ? 'lite' : 'hd', eye: cam.eye }));
    paintWall(it, now);
    gfx.sync(gfxAt(S.tl, t));
    paintSources(now, it);
    R.render(cam, light());
    drawTransition(now);
    onFrame?.();
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    if (S && playing) {
      t = Math.min(t + dt, cueLimit);
      if (mode === 'clock' && t >= timelineLength(S.tl)) { playing = false; t = timelineLength(S.tl) - 0.001; onEnd?.(); }
    }
    render(now);
  }
  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

  return {
    canvas, renderer: R, gfx,
    get state() { return S; },
    get time() { return t; },
    get length() { return S ? timelineLength(S.tl) : 0; },
    get playing() { return playing; },
    get beat() { return beatNow; },
    load, setData, start, liveStart, liveLine, liveAct, liveDirection, liveBlock, liveKnows, liveData, liveCard,
    play() { if (S && t >= timelineLength(S.tl) - 0.01) { t = 0; beatNow = -1; } playing = true; if (beatNow >= 0) voiceLine(S.tl[beatNow]); start(); },
    pause() { playing = false; },
    seek(s) { t = Math.max(0, s); },
    seekBeat(i) { const it = S?.tl.find((x) => x.i === i); if (it) { t = it.t0 + Math.min(0.05, it.dur / 2); beatNow = -1; } },
    // Live: spoken beat `i` (an index into the sequence's beats) is airing now, and `trace` is its voice.
    cue(i, trace = null) {
      if (!S) return;
      const n = S.tl.findIndex((x) => x.i === i);
      if (n < 0) return;
      const it = S.tl[n];
      t = it.t0;
      const next = S.tl.slice(n + 1).find((x) => x.spoken);
      cueLimit = next ? next.t0 - 0.02 : timelineLength(S.tl) - 0.02;
      playing = true;
      if (it.text) lips.set(it.role, { track: trace?.length ? mouthTrack(trace) : textTrack(it.text), t0: performance.now() });
      start();
    },
    // Live: the voice has started on somebody's line, so their mouth takes its timing.
    voice(name, trace, delay = 0) {
      const role = S && Object.keys(S.cast).find((r) => S.cast[r].name === name);
      if (role && trace?.length) lips.set(role, { track: mouthTrack(trace), t0: performance.now() + delay * 1000 });
    },
    // one frame of beat `i` into a small canvas, for the storyboard
    thumb(i, out) {
      const it = S?.tl.find((x) => x.i === i);
      if (!it) return false;
      const cam = shotCamera(S.set, S.seq, it.beat.shot, 0.5, 0);
      R.setFigures(figurePeople(SET_FRAME, bodiesAt(it), 0, { level: 'lite', eye: cam.eye }));
      paintWall(it, 0);
      R.render(cam, light());
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
      return true;
    },
    stop() { cancelAnimationFrame(raf); raf = 0; playing = false; },
    dispose() { cancelAnimationFrame(raf); raf = 0; gfx.dispose(); R.dispose?.(); canvas.remove(); veil.remove(); black.remove(); S = null; },
  };
}
export { sourceKind };
