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
import { figurePeople } from './gl/room-people.js';
import { createGfxLayer, paintSlate, paintBoard } from './sequence-gfx.js';
import { timeline, timelineLength, beatAt, gfxAt, shotCamera, roleMark, fill, tableRows, autoShot, lineSeconds, CUTS, sourceKind } from '../../../shared/sequence.js';
import { mouthTrack, textTrack, mouthAt } from '../../../shared/lip-sync.js';

const PIP_MS = 80;       // a second camera, twelve times a second
const WALL_MS = 66;      // the live feed on the wall
const TURN_K = 0.1;      // how fast a body turns to whoever's talking, a frame
const NO_WIN = { p: [0, -40, 0], n: [0, 1, 0], a: [0.01, 0, 0], b: [0, 0, 0.01], k: 0 };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// `onFrame` is called straight after each frame is drawn, while its picture is still in the buffer: a
// set in the Room Stage copies it from there (room-tv.js), since a WebGL picture is gone after the task.
export function createSequencePlayer(host, { mode = 'clock', phone = false, feed = null, photo = null, speak = null, onBeat = null, onEnd = null, onFrame = null } = {}) {
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
  function liveStart({ set, people = [], data = {} }) {
    load({ seq: { id: 'live', roles: {}, beats: [] }, set, cast: {}, data, seed: 'live' });
    S.live = { looks: new Map(people.map((p) => [p.name, p])), said: new Map(), prev: null, prevRole: '', n: 0, k: 0 };
    for (const p of people) seat(p.name);
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
    const L = S.live, have = Object.keys(S.cast).find((r) => S.cast[r].name === name);
    if (have) return have;
    const used = new Set(Object.values(S.seq.roles).map((r) => r.mark)), mark = Object.keys(S.set.marks || {}).find((m) => !used.has(m));
    if (!mark) return '';
    const role = `p${Object.keys(S.cast).length + 1}`;
    S.seq.roles[role] = { mark, label: name };
    S.cast[role] = L.looks.get(name) || { id: `viewer:${name}`, name };
    return role;
  }
  function liveLine(name, text) {
    if (!S?.live || !text) return;
    const L = S.live, role = name ? seat(name) : '', said = L.said.get(role) || 0;
    const shot = autoShot(S.set, S.seq, role, { prev: L.prev, prevRole: L.prevRole, said, n: L.n++ });
    const first = role && !said;
    const beat = { id: `l${++L.k}`, shot, ...(role ? { say: { role, lines: [text] } } : {}), gfx: first ? [{ kind: 'lower', text: '{speaker.name}', sub: S.cast[role]?.title || S.data.show || '', at: 0.4, for: 4.5 }] : [] };
    S.seq.beats.push(beat);
    const dur = lineSeconds(text), t0 = Math.max(t, S.tl.length ? S.tl[S.tl.length - 1].t0 + 0.01 : 0);
    S.tl.push({ i: S.seq.beats.length - 1, beat, role, text, spoken: !!role, t0, dur, data: { ...S.data, ...S.cast, speaker: S.cast[role] || { name } } });
    if (S.tl.length > LIVE_KEEP * 2) { S.tl.splice(0, LIVE_KEEP); beatNow = -1; }
    t = t0;
    if (role) { L.said.set(role, said + 1); lips.set(role, { track: textTrack(text), t0: performance.now() }); }
    L.prev = shot; L.prevRole = role || L.prevRole;
  }

  function load({ seq, set, cast = {}, data = {}, seed = '' }) {
    const m = buildSet(set);
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
      const mark = roleMark(S.set, S.seq, r), who = S.cast[r];
      if (!mark || !who) continue;
      const base = (mark.yaw ?? 180) * Math.PI / 180;
      let want = base;
      const speaker = it?.role, sm = speaker && speaker !== r ? roleMark(S.set, S.seq, speaker) : null;
      if (sm) want = base + wrapAngle(Math.atan2(sm.at[0] - mark.at[0], sm.at[1] - mark.at[1]) - base) * 0.6;
      const yaw = (turned.get(r) ?? want);
      const next = yaw + wrapAngle(want - yaw) * TURN_K;
      turned.set(r, next);
      const act = it?.beat.act?.[r];
      out.push({ id: who.id, at: mark.at, yaw: next, pose: mark.pose || 'sit', sculpt: true, sex: who.sex, figure: who.figure, dress: who.dress || '', mouth: mouthOf(r), ...(act && act !== 'auto' ? { clip: act } : {}) });
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
    const d = it?.data || S.data, title = fill(it?.beat.wallText || S.seq.wallText || '{show}', d);
    const rows = src === 'list' ? tableRows({ list: it?.beat.wallList, row: it?.beat.wallRow, limit: 6 }, d) : null, key = `${src}|${title}|${rows?.join()}`;
    if (key === wallKey) return;
    wallKey = key;
    if (rows) paintBoard(wallCanvas, title, rows); else paintSlate(wallCanvas, title, fill(S.seq.wallSub || '', d));
    R.setLive(wallCanvas);
  }

  const light = () => ({ lamps: S.lamps, lampOn: true, lampLevel: 1, day: S.set.ambient ?? 0.5, sky: [0.7, 0.8, 1], wins: [NO_WIN], ...(S.wall ? { tvOn: { first: S.wall.first, count: S.wall.count } } : {}) });

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
    load, setData, start, liveStart, liveLine,
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
