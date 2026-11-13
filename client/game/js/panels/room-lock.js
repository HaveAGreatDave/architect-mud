// ROOM · THE HOLOLOCK (docs/proposals/room-hololock.md). A locked doorway in the Room Stage: its door, the
// hologram hung off the reader beside it, and the bypass played on that hologram.
//
// The server says which doorways have a lock and how each stands for you (`room_view.locks`, `room_locks`).
// This draws them and offers the verbs; it decides nothing. Unlock is `unlock door <dir>`, Lock is `lock door
// <dir>`, Hack is `hack door <dir>`, each typeable in the log, and walking through is still `move <dir>` past
// the engine's own lock gate.
//
// The hologram is a page, bent onto four points of the room each frame (`matrix3d` from the corners the
// renderer projects), so its words are sharp at any distance and its buttons are real buttons. It isn't hidden
// by what stands in front of it, which is what a hologram does anyway.
//
// ⚠ THE BYPASS IS hololock.js's OWN GAME WITH THE DRAWING SWAPPED (its skin seam, as texthololock.js uses):
// same pins, same sweep, same miss penalty, same result through the same `hackresolve`. Nothing here may
// change the odds. At the `textgames` and `log` rungs the server sends `render`, and those boards open as ever.

import { loadCss } from '../../../shared/dom.js';
import { doorwaysOf, roomSees } from '../../../shared/room-layout.js';
import { buildLocks, lockHue } from './gl/room-lock.js';
import { liftDoorBatch } from './gl/room-mesh.js';
import { comicOn } from './gl/house-style.js';

const CSS = await loadCss(new URL('./room-lock.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-lock-css')) return;
  const s = document.createElement('style');
  s.id = 'room-lock-css'; s.textContent = CSS;
  document.head.appendChild(s);
  // the hand lettering the comic replays use (client/shared/fonts); the words fall back until it lands
  try {
    if (document.fonts && typeof FontFace !== 'undefined') new FontFace('Permanent Marker', `url(${new URL('../../../shared/fonts/permanent-marker.woff2', import.meta.url)})`).load().then((f) => document.fonts.add(f), () => {});
  } catch { /* the fallback face */ }
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// the page each hologram is laid out at, px: the reader's card, and the board the bypass is played on
const CARD = [300, 400], BOARD = [640, 384], PAD = [150, 360];
// how near the reader you have to be to work it, and to see it at all, metres
const REACH = 2.3, SEEN = 11;
// the door: how long it takes to slide each way, how long one you pushed through stays back, and how long the one
// you came in by stays open behind you
const OPEN_S = 0.32, SHUT_S = 0.8, PUSH_MS = 1600, BEHIND_MS = 900;
const WORD = { north: 'North', south: 'South', east: 'East', west: 'West', up: 'Upper', down: 'Lower', in: 'Inner', out: 'Outer' };

// Whether anything placed in the room (L.placed) stands across the line from a to b, each [u, v, y] in the room's
// frame. The card is a page over the picture, so the picture's depth can't hide it: this does, so a wardrobe
// between you and a keypad hides the keypad instead of the keypad showing through it. Small things don't count.
export function piecesBlock(L, a, b) {
  for (const p of L.placed || []) {
    if (!(p.h > 0.35)) continue;
    const q = Math.round(((p.turn || 0) % 180 + 180) % 180) === 90, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
    const y0 = p.rise || p.y0 || 0;
    let t0 = 0, t1 = 1;
    for (const [s, e, lo, hi] of [[a[0], b[0], p.u - hw, p.u + hw], [a[1], b[1], p.v - hd, p.v + hd], [a[2], b[2], y0, y0 + p.h]]) {
      const d = e - s;
      if (Math.abs(d) < 1e-9) { if (s < lo || s > hi) { t0 = 2; break; } continue; }
      const k0 = (lo - s) / d, k1 = (hi - s) / d;
      t0 = Math.max(t0, Math.min(k0, k1)); t1 = Math.min(t1, Math.max(k0, k1));
    }
    // a little short of the card, so a piece standing just behind it doesn't count
    if (t0 < t1 && t0 < 0.97) return true;
  }
  return false;
}

// The CSS transform that lays a w x h page over four points on screen (top left, top right, bottom right,
// bottom left), or null when they don't make a quad.
export function quadMatrix(w, h, p) {
  const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2], [x3, y3] = p[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-9) return null;
  const g = (sx * dy2 - dx2 * sy) / den, k = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return m.every(Number.isFinite) ? `matrix3d(${m.map((v) => +v.toFixed(7)).join(',')})` : null;
}

// What a door offers you.
//   standing open: Close.
//   shut and unlocked: Open, and Lock where it has a lock.
//   locked, and the lock knows you: Open, which unlocks it and then opens it (`then`).
//   locked otherwise: Unlock, and Hack where the lock can be hacked.
// ⚠ A DOOR IS SHUT UNTIL SOMEBODY OPENS IT. Nothing here opens one because you walked up to it: each of these is
// a verb sent to the server, and the leaves follow the door's own `open` when it comes back.
export function lockActs(k) {
  const d = `door ${k.dir}`;
  // a shop shut for the night (plugins/roomstage locksOf): nothing to press, the hours are the card
  if (k.shop) return [];
  if (k.open) return [{ verb: 'close', label: 'Close', cmd: `close ${d}` }];
  if (!k.locked) return [{ verb: 'open', label: 'Open', cmd: `open ${d}` }, ...(k.lock !== false ? [{ verb: 'lock', label: 'Lock', cmd: `lock ${d}` }] : [])];
  // staff at a lock that doesn't know them: the unlock is an override, and the card plays it as one
  if (k.staff) return [{ verb: 'unlock', label: 'Unlock', cmd: `unlock ${d}`, then: `open ${d}` }];
  if (k.pass) return [{ verb: 'unlock', label: 'Unlock', cmd: `unlock ${d}`, then: `open ${d}` }];
  return [{ verb: 'unlock', label: 'Unlock', cmd: `unlock ${d}` }, ...(k.hack && !k.yours ? [{ verb: 'hack', label: 'Hack', cmd: `hack ${d}` }] : [])];
}
// how the card is drawn: 'shut' (locked to you), 'pass' (locked, and it knows you), 'open' (unlocked), 'ajar' (standing open)
// A locked door reads LOCKED, in the locked colour, even one that knows you: reading UNLOCKED in the open blue,
// your own flat looked as if Lock had done nothing.
const stateOf = (k) => (k.open ? 'ajar' : !k.locked ? 'open' : k.pass ? 'pass' : 'shut');
const stateWord = (k) => (k.shop ? 'CLOSED' : k.open ? 'OPEN' : !k.locked ? (k.lock === false ? 'CLOSED' : 'UNLOCKED') : 'LOCKED');

/**
 * The locks of one open Stage. `project(p, w, h)` is the renderer's; `send(cmd)` types a verb.
 */
export function createRoomLocks({ host, project, send, setBatch }) {
  ensureStyles();
  const layer = document.createElement('div');
  layer.className = 'rl-layer';
  host.appendChild(layer);
  let L = null, list = [], geo = null, panels = [], shut = [], pushed = [], lastT = 0, dirty = true;
  let game = null, sayT = 0, tried = null, acted = null;

  const cardHtml = (k) => `<div class="rl-head"><b>${k.lock === false ? 'DOOR' : 'HOLOLOCK'}</b><span>${esc(WORD[k.dir] || k.dir)} door</span></div>
      ${k.owner ? `<p class="rl-owner">${esc(k.owner)}</p>` : ''}
      <div class="rl-state"><i class="rl-icon"></i><strong${stateWord(k).length > 6 ? ' class="rl-long"' : ''}>${stateWord(k)}</strong></div>
      ${k.shop && k.hours ? `<p class="rl-note rl-hours">${esc(k.hours)}</p>` : ''}
      <div class="rl-acts">${lockActs(k).map((a, i) => `<button type="button" data-i="${i}" class="rl-act rl-act-${a.verb}"><kbd>${i ? i + 1 : 'F'}</kbd>${esc(a.label)}</button>`).join('')}</div>
      <p class="rl-say" hidden></p>
      <div class="rl-burst" hidden></div>`;

  // A keypad, where the wall beside the door is too narrow for the card (gl/room-lock.js `pad`). The digits only
  // light the screen: the server decides who gets in, so ENT sends the card's first verb whatever was keyed, and
  // the rest of the card's verbs (Hack) are the keys under it.
  const padHtml = (k) => {
    const acts = lockActs(k);
    return `<div class="rl-pad-screen"><strong>${stateWord(k)}</strong><span class="rl-pad-code"></span></div>
      <div class="rl-pad-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'ENT'].map((d) => `<button type="button" class="rl-pad-key${d === 'ENT' ? ' rl-pad-ent' : d === 'C' ? ' rl-pad-clr' : ''}" data-k="${d}"${d === 'ENT' && !acts.length ? ' disabled' : ''}>${d}</button>`).join('')}</div>
      <div class="rl-acts">${acts.slice(1).map((a, i) => `<button type="button" data-i="${i + 1}" class="rl-act rl-act-${a.verb}">${esc(a.label)}</button>`).join('')}</div>
      <p class="rl-say" hidden></p>
      <div class="rl-burst" hidden></div>`;
  };
  // A bathroom's bolt (the en-suite door, `k.annex`): no digits and no Hack, the same on both sides. One big
  // Open (or Close) and a small Lock or Unlock under it. Still only verbs; the server decides.
  const bathActs = (k) => {
    const d = `door ${k.dir}`;
    if (k.open) return { big: { verb: 'close', label: 'Close', cmd: `close ${d}` }, small: null };
    if (!k.locked) return { big: { verb: 'open', label: 'Open', cmd: `open ${d}` }, small: k.lock !== false ? { verb: 'lock', label: 'Lock', cmd: `lock ${d}` } : null };
    const unlock = { verb: 'unlock', label: 'Unlock', cmd: `unlock ${d}` };
    return { big: k.pass || k.staff ? { ...unlock, label: 'Open', then: `open ${d}` } : null, small: unlock };
  };
  const bathHtml = (k) => {
    const { big, small } = bathActs(k);
    return `<div class="rl-pad-screen"><strong>${stateWord(k)}</strong></div>
      <button type="button" class="rl-bath-big" data-w="big"${big ? '' : ' disabled'}>${esc(big?.label || 'Open')}</button>
      ${small ? `<button type="button" class="rl-bath-small" data-w="small">${esc(small.label)}</button>` : ''}
      <p class="rl-say" hidden></p>
      <div class="rl-burst" hidden></div>`;
  };
  function padKey(pn, d) {
    const code = pn.el.querySelector('.rl-pad-code');
    if (d === 'ENT') { const a = lockActs(pn.lock)[0]; if (code) code.textContent = ''; if (a) run(pn, a); return; }
    if (!code) return;
    code.textContent = d === 'C' ? '' : (code.textContent + '*').slice(-6);
    try { window.AudioEngine?.init?.(); } catch { /* silent */ }
  }

  function paint(pn) {
    const k = pn.lock;
    if (pn.g?.pad) {
      pn.el.className = `rl-holo rl-pad${k.annex ? ' rl-bath' : ''} rl-${stateOf(k)}${comicOn() ? ' rl-comic' : ''}`;
      pn.el.style.setProperty('--rl-hue', lockHue(k));
      pn.el.style.width = PAD[0] + 'px'; pn.el.style.height = PAD[1] + 'px';
      pn.el.innerHTML = k.annex ? bathHtml(k) : padHtml(k);
      pn.comic = comicOn();
      return;
    }
    pn.el.className = `rl-holo rl-${stateOf(k)}${k.lock === false ? ' rl-plain' : ''}${comicOn() ? ' rl-comic' : ''}`;
    pn.el.style.setProperty('--rl-hue', lockHue(k));
    pn.el.style.width = CARD[0] + 'px'; pn.el.style.height = CARD[1] + 'px';
    pn.el.innerHTML = cardHtml(k);
    pn.comic = comicOn();
  }
  function burst(pn, word, bad = false) {
    const b = pn?.el.querySelector('.rl-burst');
    if (!b) return;
    b.textContent = word; b.hidden = false;
    b.classList.toggle('rl-bad', bad);
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    if (bad) { pn.el.classList.remove('rl-shake'); void pn.el.offsetWidth; pn.el.classList.add('rl-shake'); }
    clearTimeout(pn.burstT);
    pn.burstT = setTimeout(() => { b.hidden = true; pn.el.classList.remove('rl-shake'); }, 1100);
  }
  // An admin override: an amber sweep down the card, hazard tape across it and ADMIN OVERRIDE stamped over, then
  // it settles to its new state. Looks only; the server has already done it.
  // First the card glitches for a second still showing the lock as it was, then it repaints unlocked and stamps.
  function overridden(pn, prev) {
    const el = pn.el, now = pn.lock;
    clearTimeout(pn.ovrT); clearTimeout(pn.glT);
    if (prev) { pn.lock = prev; paint(pn); pn.lock = now; }
    el.querySelector('.rl-gl')?.remove();
    const g = document.createElement('div');
    g.className = 'rl-gl';
    g.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><b>ADMIN<br>OVERRIDE</b>';
    el.appendChild(g);
    el.classList.add('rl-glitching');
    pn.glT = setTimeout(() => { if (pn.lock === now) { paint(pn); stamp(pn); } if (pn.ovrChain) { send(pn.ovrChain); pn.ovrChain = null; } }, 1150);
  }
  function stamp(pn) {
    const el = pn.el;
    el.querySelector('.rl-ovr')?.remove();
    const o = document.createElement('div');
    o.className = 'rl-ovr';
    o.innerHTML = '<i class="rl-ovr-sweep"></i><i class="rl-ovr-tape"></i><b>ADMIN<br>OVERRIDE</b><small>AUTH BYPASSED</small>';
    el.appendChild(o);
    el.classList.remove('rl-overriding'); void el.offsetWidth; el.classList.add('rl-overriding');
    clearTimeout(pn.ovrT);
    pn.ovrT = setTimeout(() => { o.remove(); el.classList.remove('rl-overriding'); }, 2200);
  }
  function say(pn, text) {
    const el = pn?.el.querySelector('.rl-say');
    if (!el) return;
    el.textContent = text; el.hidden = !text;
    clearTimeout(sayT);
    if (text) sayT = setTimeout(() => { el.hidden = true; }, 6000);
  }

  // The room's locks, new or changed. `via`: the room you came in from, whose door is open behind you.
  // `fresh`: a room you've just come into, whose doors start shut; false keeps each door where it is.
  function load(layout, locks, { via = null, fresh = true, override = null } = {}) {
    if (!L) fresh = true;
    const was = new Map(panels.map((p) => [p.lock.to, p]));
    L = layout;
    list = (locks || []).filter((k) => k && k.to && k.dir);
    const ways = doorwaysOf(L.spec);
    geo = buildLocks(L, ways, list);
    if (game && !list.some((k) => k.door === game.door)) endGame();
    const next = [];
    list.forEach((k, i) => {
      const g = geo.panels[i];
      if (!g) return;
      const old = fresh ? null : was.get(k.to);
      const pn = old || { el: document.createElement('div') };
      const before = old ? stateOf(old.lock) : null, prevLock = old?.lock;
      Object.assign(pn, { lock: k, g, way: i });
      if (!old) { layer.appendChild(pn.el); pn.el.addEventListener('click', (e) => { const w = e.target.closest('[data-w]'); if (w) { const a = bathActs(pn.lock)[w.dataset.w]; if (a) run(pn, a); return; } const p = e.target.closest('.rl-pad-key'); if (p) { padKey(pn, p.dataset.k); return; } const b = e.target.closest('.rl-act'); if (b) run(pn, lockActs(pn.lock)[Number(b.dataset.i)]); }); }
      if (game?.pn !== pn) paint(pn);
      // the lock gave, or took: say so on it
      if (before && before !== stateOf(k)) {
        const wasOpen = before === 'ajar', wasLocked = before === 'shut' || before === 'pass';
        // staff opened a lock that wasn't theirs: the card is overridden, not unlocked
        if (override && override === k.door && !k.locked) overridden(pn, prevLock);
        else burst(pn, k.open ? 'SHHK!' : wasOpen ? 'THUNK!' : k.locked ? 'KA-CHUNK!' : wasLocked ? 'CLACK!' : 'CLICK!');
        if (tried?.to === k.to) tried = null;
        // the lock you opened with one press: it gave, so the door follows
        // an override plays its glitch first and opens the door after it
        if (pn.chain && !k.locked && !k.open && performance.now() < pn.chain.until) {
          if (override && override === k.door) pn.ovrChain = pn.chain.cmd; else send(pn.chain.cmd);
        }
        pn.chain = null;
      }
      next.push(pn);
    });
    for (const p of was.values()) if (!next.includes(p)) p.el.remove();
    panels = next;
    const keep = shut;
    // a room you've just come into shows each door as it stands, with no slide. The one you walked through is
    // open behind you and swings shut a moment later, unless somebody has left it standing open.
    const now = performance.now(), behind = (k) => fresh && via && k.to === via;
    shut = list.map((k, i) => (!fresh && keep[i] !== undefined ? keep[i] : k.open || behind(k) ? 0 : 1));
    pushed = list.map((k, i) => (behind(k) ? now + BEHIND_MS : fresh ? 0 : pushed[i] || 0));
    dirty = true;
  }

  const lockAt = (i) => list[i];
  // The doors, slid to where the server says each stands: open once somebody has opened it, shut otherwise.
  function slide(now) {
    if (!geo) return;
    const dt = Math.min(0.1, Math.max(0, (now - (lastT || now)) / 1000));
    lastT = now;
    let moved = false;
    const eased = [];
    for (let i = 0; i < list.length; i++) {
      const k = lockAt(i), leaf = geo.leaves.find((l) => l.way === i);
      if (!leaf) continue;
      const want = k.open || (pushed[i] || 0) > now ? 0 : 1, v = shut[i] ?? 1, step = dt / (want < v ? OPEN_S : SHUT_S);
      const nv = Math.abs(want - v) <= step ? want : v + Math.sign(want - v) * step;
      if (nv !== v) moved = true;
      shut[i] = nv;
      eased[i] = nv * nv * (3 - 2 * nv);
    }
    if (!moved && !dirty) return;
    dirty = false;
    setBatch(geo.leaves.length || geo.fixed.length ? liftDoorBatch(geo.leaves, eased, geo.fixed) : { data: new Float32Array(0), n: 0 });
  }
  // Somebody has walked into the doorway to `to`. 'go': nothing's in the way, send the step. 'wait': a shut door
  // that will let you through is sliding back, as it does in the room text, where walking through a shut door
  // opens it for the step and it swings shut behind you. 'no': it's locked to you.
  // ⚠ WALKING INTO A DOOR IS THE ONLY THING THAT OPENS ONE UNASKED. Standing near it doesn't.
  function enter(to) {
    const i = list.findIndex((k) => k.to === to);
    if (i < 0) return 'go';
    const k = list[i];
    if (!k.open && !k.pass) { bump(to); return 'no'; }
    if (!k.open) pushed[i] = performance.now() + PUSH_MS;
    return (shut[i] ?? 1) > 0.35 ? 'wait' : 'go';
  }
  // Walked into a door that's shut to you.
  function bump(to) {
    const pn = panels.find((p) => p.lock.to === to), now = performance.now();
    if (!pn || pn.lock.open || now - (pn.bumpT || 0) < 1500) return;
    pn.bumpT = now;
    burst(pn, pn.lock.shop ? 'CLOSED!' : pn.lock.locked ? 'LOCKED!' : 'SHUT!', true);
  }

  // The lock you're stood at and facing, as the card's piece ({ id, name, lock, lockActs }), or null.
  function aim(at, eye, yaw) {
    if (!at || game) return game ? cardOf(game.pn) : null;
    let best = null, score = Infinity;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const pn of panels) {
      const d = Math.min(Math.hypot(at[0] - pn.g.at[0], at[1] - pn.g.at[1]), Math.hypot(at[0] - pn.g.door[0], at[1] - pn.g.door[1]));
      if (d > REACH) continue;
      const vx = pn.g.mid[0] - eye[0], vz = pn.g.mid[2] - eye[2], len = Math.hypot(vx, vz) || 1;
      if ((vx * fx + vz * fz) / len < 0.45) continue;
      if (d < score) { score = d; best = pn; }
    }
    return best ? cardOf(best) : null;
  }
  const cardOf = (pn) => (pn.card && pn.cardFor === pn.lock ? pn.card : (pn.cardFor = pn.lock, pn.card = { id: 'lock:' + pn.lock.to, name: `${WORD[pn.lock.dir] || pn.lock.dir} door`, lock: pn.lock.to, lockActs: lockActs(pn.lock) }));

  // One of the card's lines: the verb goes to the server as typed, and the lock answers on its own face.
  function run(pn, a) {
    if (!pn || !a || game) return;
    acted = pn;
    say(pn, '');
    pn.chain = a.then ? { cmd: a.then, until: performance.now() + 3000 } : null;
    if (a.verb !== 'hack') {
      const was = stateOf(pn.lock);
      clearTimeout(tried?.t);
      // no change in a second: it refused, and the server's line says why
      tried = { to: pn.lock.to, t: setTimeout(() => { if (tried?.to === pn.lock.to && panels.includes(pn) && stateOf(pn.lock) === was) burst(pn, 'DENIED!', true); tried = null; }, 1000) };
    }
    send(a.cmd);
  }
  const runFor = (to, a) => run(panels.find((p) => p.lock.to === to), a);
  // What the server said back, for the lock you last worked.
  function said(text) {
    const pn = game?.pn || acted;
    if (!pn || !panels.includes(pn)) return false;
    if (game) { const s = pn.el.querySelector('.rl-g-status'); if (s) s.textContent = text; return true; }
    say(pn, text);
    return true;
  }

  // ── the bypass, on the board in front of the door ──────────────────────────────────────────────
  // hololock.js runs the lock; this skin draws it. `onResult` is dispatch.js's, which sends `hackresolve`.
  function hack(msg, args) {
    const pn = panels.find((p) => p.lock.door === msg.doorId);
    if (!pn || game) return false;
    game = { pn, door: msg.doorId, H: null, over: false };
    const g = game;
    pn.el.className = `rl-holo rl-hacking${comicOn() ? ' rl-comic' : ''}`;
    pn.el.style.width = BOARD[0] + 'px'; pn.el.style.height = BOARD[1] + 'px';
    pn.el.innerHTML = `<div class="rl-head"><b>BYPASS</b><span>${esc(String(args.deviceName || 'hololock'))}</span></div>
      <div class="rl-g-hud"><span>PINS <b class="rl-g-pins">0/0</b></span><span class="rl-g-fb">FEEDBACK <i><u class="rl-g-fill"></u></i></span></div>
      <div class="rl-g-chans"></div>
      <p class="rl-g-status">Set each pin while the scanner is in the lit window.</p>
      <div class="rl-acts"><button type="button" class="rl-act rl-g-set"><kbd>Space</kbd>Set pin</button><button type="button" class="rl-act rl-g-abort"><kbd>Esc</kbd>Pull the deck</button></div>
      <div class="rl-burst" hidden></div>`;
    pn.el.querySelector('.rl-g-set').addEventListener('click', () => g.H?.hololockSet());
    pn.el.querySelector('.rl-g-abort').addEventListener('click', () => endGame());
    Promise.all([import('./hololock.js'), import('./minigame-common.js')]).then(([H, C]) => {
      if (game !== g) return;
      g.H = H;
      const chans = pn.el.querySelector('.rl-g-chans');
      const hud = (s) => {
        pn.el.querySelector('.rl-g-pins').textContent = `${s.pins.filter((p) => p.set).length}/${s.pins.length}`;
        const f = pn.el.querySelector('.rl-g-fill'), pct = Math.round(s.feedback * 100);
        f.style.width = pct + '%'; f.dataset.level = pct > 75 ? 'bad' : pct > 45 ? 'warn' : 'ok';
      };
      // one row a pin: the lit window on the live one, and its scanner, which `frame` moves
      const board = (s) => {
        chans.innerHTML = s.pins.map((pin, i) => `<div class="rl-ch${pin.set ? ' rl-set' : i === s.active ? ' rl-live' : ''}"><i class="rl-sweet" style="left:${((pin.center - pin.width / 2) * 100).toFixed(2)}%;width:${(pin.width * 100).toFixed(2)}%"></i><i class="rl-scan"></i></div>`).join('');
        g.scan = chans.querySelector('.rl-live .rl-scan');
      };
      H.setHololockSkin({
        board, hud,
        status(html) { const el = pn.el.querySelector('.rl-g-status'); if (el) el.innerHTML = html; },
        frame(s) {
          const pin = s.pins[s.active];
          if (g.scan && pin && !pin.set) g.scan.style.left = (H.hololockPos(pin) * 100).toFixed(2) + '%';
          hud(s);
        },
        finish(s, won) {
          g.over = true;
          hud(s);
          burst(pn, won ? 'CRACKED!' : 'ZZAP!', !won);
          setTimeout(() => { if (game === g) endGame(); }, won ? 1100 : 1700);
        },
      });
      try { window.AudioEngine?.init?.(); } catch { /* silent */ }
      C.sfx('hololock-entry');
      // hololock.js paints a board only when a pin is set, so the first one is painted here
      const s = H.startHololockGame({ skill: args.skill, difficulty: args.difficulty, deviceName: args.deviceName, onResult: args.onResult });
      if (s) { board(s); hud(s); } else endGame();
    }).catch((err) => { console.error('[room] the hololock failed to load:', err); if (game === g) endGame(); });
    return true;
  }
  // The deck out: with the lock still running that's walking away from it, which costs nothing here as it costs
  // nothing on the overlay's Abort (the pending arm just lapses).
  function endGame() {
    const g = game;
    if (!g) return;
    game = null;
    try { g.H?.stopHololockGame(); g.H?.setHololockSkin(null); } catch { /* already stopped */ }
    if (panels.includes(g.pn)) paint(g.pn);
    if (g.pn.card) g.pn.cardFor = null;
  }
  // The keys the bypass takes while it's up: Space sets the pin, Escape pulls the deck.
  function key(e) {
    if (!game) return false;
    const k = e.key;
    if (k === ' ' || k === 'Spacebar' || e.code === 'Space') { if (!e.repeat && !game.over) game.H?.hololockSet(); return true; }
    if (k === 'Escape') { endGame(); return true; }
    return false;
  }

  // Each hologram laid over its four points, every frame. `at` is where you stand, to walk off a bypass.
  function draw(w, h, eye, at) {
    if (game && at && Math.hypot(at[0] - game.pn.g.door[0], at[1] - game.pn.g.door[1]) > REACH + 0.8) endGame();
    const comic = comicOn();
    for (const pn of panels) {
      if (pn.comic !== comic && game?.pn !== pn) paint(pn);
      const board = game?.pn === pn, size = board ? BOARD : pn.g.pad ? PAD : CARD, q = (board ? pn.g.board : pn.g.card).map((p) => project(p, w, h));
      const dist = Math.hypot(pn.g.mid[0] - eye[0], pn.g.mid[2] - eye[2]);
      let m = null;
      // read from the room's side only: from behind, it showed mirrored through the wall it hangs on
      const front = !pn.g.face || (eye[0] - pn.g.mid[0]) * pn.g.face[0] + (eye[2] - pn.g.mid[2]) * pn.g.face[1] > 0.02;
      // and only with no wall between you and its door. The card is a page over the picture, so the picture's
      // depth can't hide it: a flat's front door is down a hall beside the en-suite, and its card showed through
      // the bathroom and its door from anywhere in the room.
      const here = at || L.local(eye);
      // nor through anything standing in front of it: each corner and the middle, eye to card
      const E = L.local(eye), pts3 = [pn.g.mid, ...(board ? pn.g.board : pn.g.card)].map((p) => L.local(p));
      const seen = (!here || (roomSees(L, here, pn.g.door) && roomSees(L, here, pts3[0]))) && !pts3.some((p) => piecesBlock(L, E, p));
      if (front && seen && q.every(Boolean) && dist < SEEN) {
        let pts = q.map((p) => [p.x, p.y]);
        // seen the other way round (the wall's `along` runs right to left from here): turn it to read
        const area = pts.reduce((s, p, i) => { const n = pts[(i + 1) % 4]; return s + p[0] * n[1] - n[0] * p[1]; }, 0);
        if (area < 0) pts = [pts[1], pts[0], pts[3], pts[2]];
        const tall = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1]);
        if (tall > 22 && pts.every((p) => Math.abs(p[0]) < 6 * w + 2000 && Math.abs(p[1]) < 6 * h + 2000)) m = quadMatrix(size[0], size[1], pts);
      }
      if (!m) { if (!pn.hidden) { pn.el.style.display = 'none'; pn.hidden = true; } continue; }
      if (pn.hidden !== false) { pn.el.style.display = ''; pn.hidden = false; }
      pn.el.style.transform = m;
      const near = dist < REACH + 1.2;
      if (pn.near !== near) { pn.near = near; pn.el.classList.toggle('rl-far', !near); }
    }
  }

  // A resident keyed through their own lock while you watched (plugins/roomstage `fx`): the lock never changed, so
  // the card plays it, CLACK! as it opens and KA-CHUNK! as they lock it behind them.
  function play(fx) {
    const pn = panels.find((p) => p.lock.door === fx?.door);
    // both arrive in the one step, so the relock waits for the open to be read
    if (pn && !game) setTimeout(() => { if (panels.includes(pn)) burst(pn, fx.cue === 'lock' ? 'KA-CHUNK!' : 'CLACK!'); }, fx.cue === 'lock' ? 900 : 0);
  }

  return {
    load, slide, enter, bump, aim, run: runFor, said, hack, key, draw, play,
    get hacking() { return !!game; },
    get count() { return list.length; },
    stop() { endGame(); clearTimeout(sayT); clearTimeout(tried?.t); layer.remove(); },
  };
}
