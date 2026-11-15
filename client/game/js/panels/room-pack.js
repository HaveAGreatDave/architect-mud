// THE PACK: the Room Stage's own inventory. What you carry, on a grid; what you wear, on you. Opened from the Pack
// button, I, P (on what you can eat and drink) or a wardrobe's Change clothes, over the room. It never opens the tablet.
//
// ⚠ THE DOLL IS YOU, IN 3D. The left-hand box is a hole in the panel: room-stage.js swings its camera round to
// frame your own close-up figure there, in what you're wearing (paper-doll.js figureWorn), and a drag across the
// box turns you all the way round (`turn`), as do Q and E; the wheel brings you closer. The paper doll's
// `garmentOf` still names each garment's kind and colour.
//
// Everything it does is a verb (plugins/roomstage pack.js has the server's half):
//   · drag a garment onto you, or its Wear button: `roompack wear <id>` (it shows on you before you let go)
//   · a worn thing's Take off, or double-click it: `roompack off <id>`
//   · drag a thing onto the floor strip, or Drop: `roompack drop <id> [qty]`
//   · Eat, Drink, Smoke, Take: ROOM's first-person ritual in your hands (stands-hands.js via `take`), which ends in
//     the ordinary verb; anything else is the typed verb by name (`read`, `use`, `open`)
//   · Undress and Dress again: `undress`, then `roompack wear` with what it took off
// The server answers each `roompack` with the whole pack again (`room_pack`), and `say` is its line about it.
//
// room-stage.js makes one: createPack({ host, silent, cmd, take, spray, onToggle, turn }) → { open, close, toggle,
// isOpen, data, dirty, key, dollRect, worn }. `silent` sends a line without echoing it, `cmd` sends one that answers
// on the card. `turn(dYaw, dPitch, zoom)` turns the camera round you; `worn()` is the pack's rows with a garment
// held over you counted as on.

import { garmentOf } from '../../../shared/paper-doll.js';
import { loadCss, escapeHtml as esc } from '../../../shared/dom.js';

const PACK_CSS = await loadCss(new URL('./room-pack.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('room-pack-css')) return;
  const s = document.createElement('style'); s.id = 'room-pack-css'; s.textContent = PACK_CSS; document.head.appendChild(s);
}

const TABS = [['all', 'All'], ['wear', 'Wear'], ['eat', 'Eat & drink'], ['other', 'Other']];
const RITUAL_LABEL = { eat: 'Eat', drink: 'Drink', smoke: 'Smoke', swallow: 'Take', snort: 'Snort', inject: 'Inject', huff: 'Huff', spray: 'Tag a wall' };
// Verbs worth a button of their own, in the order they're offered. Wear and drop are the panel's own.
const VERB_LABEL = { eat: 'Eat', drink: 'Drink', use: 'Use', read: 'Read', open: 'Open', smoke: 'Smoke', play: 'Play', light: 'Light', inject: 'Inject', fill: 'Fill', reload: 'Reload', unpack: 'Unpack' };
// a verb that opens a panel of its own: the Pack gets out of its way
const LEAVES = new Set(['read', 'open', 'play']);
const SLOT_LABEL = { head: 'Head', torso: 'Body', hands: 'Hands', legs: 'Legs', feet: 'Feet', accessory: 'Accessory', weapon_hand: 'In hand' };
const LAYER_LABEL = { 1: 'underwear', 2: 'clothes', 3: 'armour' };
const fmtW = (g) => { g = Number(g) || 0; return g < 1000 ? `${Math.round(g)} g` : `${Math.round(g / 100) / 10} kg`; };

// What a row is for, for the tabs.
const isWear = (it) => !!it.slot;
const isFood = (it) => !!(it.take && it.take.act !== 'spray') || it.consume === 'eat' || it.consume === 'drink';

// The one thing a click on a tile's chip does.
function primaryOf(it) {
  if (it.worn) return { op: 'off', label: it.slot === 'weapon_hand' ? 'Put away' : 'Take off' };
  if (it.take) return { op: 'take', label: RITUAL_LABEL[it.take.act] || 'Use' };
  if (it.slot) return { op: 'wear', label: it.slot === 'weapon_hand' ? 'Hold' : 'Wear' };
  const v = ['eat', 'drink', 'use', 'read', 'open', 'smoke', 'play', 'light'].find((x) => it.verbs?.includes(x)) || (it.consume || null);
  return v ? { op: 'verb', verb: v, label: VERB_LABEL[v] || v } : null;
}

// A small line icon for a tile: the garment's kind in its own colour, or what sort of thing it is.
function iconOf(it) {
  const g = it.slot ? garmentOf(it) : null;
  const col = g ? `rgb(${g.col.map((v) => v | 0).join(',')})` : 'currentColor';
  const fill = g ? ` fill="${col}" fill-opacity="0.85"` : ' fill="none"';
  const k = g?.kind || '';
  let d;
  if (it.slot === 'weapon_hand') d = /pistol|longgun/.test(k) ? 'M4 9h13v4H9l-1 5H5l1-5H4z' : /knife|sword/.test(k) ? 'M5 19l9-9 2-6 2 2-6 2-9 9z' : 'M6 20l10-14 2 1-10 14z';
  else if (it.slot === 'torso') d = /bra|harness/.test(k) ? 'M5 9q3-4 7 0q4-4 7 0v4q-3 3-7 0q-4 3-7 0z' : /coat|gown|apron|slicker/.test(k) ? 'M8 3l4 3 4-3 4 4-3 2v12H7V9L4 7z' : /vest|undershirt|crop/.test(k) ? 'M8 3l4 3 4-3 1 5v13H7V8z' : 'M8 3l4 3 4-3 5 4-3 3-1-1v11H8V9l-1 1-3-3z';
  else if (it.slot === 'legs') d = /briefs|boxers|micro/.test(k) ? 'M5 8h14v3l-5 5h-4l-5-5z' : /shorts/.test(k) ? 'M6 4h12l1 11h-5l-2-6-2 6H5z' : 'M7 3h10l1 18h-4l-2-12-2 12H6z';
  else if (it.slot === 'feet') d = /boots|waders/.test(k) ? 'M8 3h5v11l6 3v3H6v-6z' : 'M4 14q4-1 7-4l3 2q3 2 6 3v3H4z';
  else if (it.slot === 'hands') d = 'M8 21v-8l-3-3 2-1 2 2V5h2v6V4h2v7V5h2v7l1-3h2l-1 6-2 6z';
  else if (it.slot === 'head') d = /helmet|hood|balaclava/.test(k) ? 'M4 15q0-11 8-11t8 11v4H4z' : /mask|domino|glasses|respirator/.test(k) ? 'M3 10h18v3q-3 3-6 1l-3-2-3 2q-3 2-6-1z' : 'M4 15q0-10 8-10t8 10zM2 15h20v2H2z';
  else if (it.slot === 'accessory') d = /wrist|ring|chain|collar/.test(k) ? 'M12 4a8 8 0 1 0 .1 0zM12 8a4 4 0 1 1-.1 0z' : /tote|fanny|bag/.test(k) ? 'M5 9h14l-1 12H6zM9 9V6a3 3 0 0 1 6 0v3' : 'M12 3l3 6 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z';
  else if (it.take?.act === 'drink' || it.consume === 'drink') d = 'M9 2h6v4l2 3v13H7V9l2-3z';
  else if (it.take?.act === 'smoke') d = 'M3 15h15v3H3zM19 15h2v3h-2zM18 12q0-3 2-4';
  else if (it.take?.act === 'swallow' || it.take?.act === 'inject') d = 'M8 4h8v16H8zM8 12h8';
  else if (it.take || it.consume === 'eat') d = 'M4 12a8 7 0 0 0 16 0zM6 12q2-6 6-6t6 6';
  else if (it.bag) d = 'M5 9h14l-1 12H6zM9 9V6a3 3 0 0 1 6 0v3';
  else if (it.verbs?.includes('read')) d = 'M3 5q4-2 9 1q5-3 9-1v14q-4-2-9 1q-5-3-9-1zM12 6v14';
  else d = 'M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9';
  return `<svg viewBox="0 0 24 24" class="rp-ico" aria-hidden="true"><path d="${d}"${fill} stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export function createPack({ host, silent, cmd, take, spray, onToggle = null, turn = null }) {
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'rp';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Your pack');
  el.innerHTML = `
    <header class="rp-head">
      <b class="rp-title">Pack</b>
      <span class="rp-carry" title="What you're carrying, of what you can carry"><span class="rp-bar"><i></i></span><span class="rp-wt"></span></span>
      <span class="rp-cr" title="Credits on you"></span>
      <button type="button" class="rp-x" title="Close (I or Esc)" aria-label="Close">×</button>
    </header>
    <div class="rp-body">
      <section class="rp-dollbox" aria-label="What you're wearing">
        <div class="rp-doll" title="Drag to turn round, the wheel to come closer"><span class="rp-turn" aria-hidden="true">⟲ drag to turn</span></div>
        <div class="rp-dollacts">
          <button type="button" class="rp-undress" title="Take off everything you're wearing, but what's in your hand and your accessories">Undress</button>
          <button type="button" class="rp-redress" hidden title="Put back on what you took off">Dress again</button>
        </div>
      </section>
      <section class="rp-packbox" aria-label="What you're carrying">
        <nav class="rp-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join('')}</nav>
        <div class="rp-grid" role="listbox" aria-label="Your things"></div>
        <div class="rp-floor" title="Drag something here to leave it on the floor">Drop here to leave it on the floor</div>
      </section>
    </div>
    <footer class="rp-sel" aria-live="polite"></footer>
    <div class="rp-say" aria-live="polite"></div>`;
  host.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const dollEl = $('.rp-doll'), grid = $('.rp-grid'), selEl = $('.rp-sel'), sayEl = $('.rp-say'), floor = $('.rp-floor');

  let pack = null, tab = 'all', selected = null, ghost = null, open = false, waiting = false;
  let stripped = [];   // what Undress took off, for Dress again (this session only)
  let sayTimer = 0;

  const byId = (id) => pack?.items.find((x) => x.id === id) || null;
  const shown = () => {
    const all = pack?.items || [];
    const list = tab === 'wear' ? all.filter(isWear) : tab === 'eat' ? all.filter(isFood) : tab === 'other' ? all.filter((x) => !isWear(x) && !isFood(x)) : all;
    // what you have on first, then the rest by name (the server's order)
    return [...list.filter((x) => x.worn), ...list.filter((x) => !x.worn)];
  };

  function say(text, ok = true) {
    if (!text) return;
    sayEl.innerHTML = String(text).split('\n').map((l) => `<div>${l}</div>`).join('');
    sayEl.classList.toggle('bad', !ok);
    sayEl.classList.add('on');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => sayEl.classList.remove('on'), 4200);
  }

  // you're drawn by the room behind the box (room-stage.js); this keeps its buttons right
  function paintDoll() {
    if (!pack) return;
    const worn = pack.items.some((x) => x.worn && x.slot && x.slot !== 'weapon_hand' && x.slot !== 'accessory');
    $('.rp-undress').disabled = !worn;
    const back = stripped.filter((id) => byId(id) && !byId(id).worn);
    $('.rp-redress').hidden = !back.length;
  }

  function paintHead() {
    const w = pack?.weight || 0, cap = pack?.capacity || 0, pct = cap ? Math.min(100, Math.round((w / cap) * 100)) : 0;
    $('.rp-bar i').style.width = pct + '%';
    $('.rp-carry').classList.toggle('heavy', pct >= 90);
    $('.rp-wt').textContent = `${fmtW(w)} / ${fmtW(cap)}`;
    $('.rp-cr').textContent = pack ? `₵${pack.credits || 0}` : '';
    for (const b of el.querySelectorAll('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); }
  }

  function paintGrid() {
    if (!pack) { grid.innerHTML = '<i class="rp-empty">Going through your pockets...</i>'; return; }
    const list = shown();
    if (!list.length) { grid.innerHTML = `<i class="rp-empty">${tab === 'eat' ? 'Nothing on you to eat or drink.' : tab === 'wear' ? 'Nothing to wear but what you have on.' : 'Your pockets are empty.'}</i>`; return; }
    grid.innerHTML = list.map((it) => {
      const p = primaryOf(it), g = it.slot ? garmentOf(it) : null;
      const sub = it.worn ? (it.slot === 'weapon_hand' ? 'in hand' : 'on you') : it.slot === 'weapon_hand' ? 'to hold' : it.slot ? (SLOT_LABEL[it.slot] || it.slot).toLowerCase() : it.bag ? 'bag' : '';
      return `<button type="button" class="rp-tile${it.worn ? ' worn' : ''}${it.id === selected ? ' sel' : ''}" role="option" aria-selected="${it.id === selected}" data-id="${esc(it.id)}"${g ? ` style="--rp-col:rgb(${g.col.map((v) => v | 0).join(',')})"` : ''}>
        ${iconOf(it)}
        <span class="rp-name">${esc(it.name)}${it.qty > 1 ? ` <em>×${it.qty}</em>` : ''}</span>
        ${sub ? `<span class="rp-sub">${esc(sub)}</span>` : ''}
        ${it.cond ? `<span class="rp-cond" style="color:${esc(it.cond.colour)}">${esc(it.cond.label)}</span>` : ''}
        ${p ? `<span class="rp-quick" data-quick="1">${esc(p.label)}</span>` : ''}
      </button>`;
    }).join('');
  }

  function paintSel() {
    const it = selected && byId(selected);
    if (!it) { selEl.innerHTML = `<span class="rp-hint">Click a thing to see what you can do with it. Drag clothes onto yourself to put them on. Drag across yourself to turn round.</span>`; return; }
    const facts = [];
    if (it.slot) facts.push(it.slot === 'weapon_hand' ? 'held' : `${SLOT_LABEL[it.slot]}${LAYER_LABEL[it.layer] ? `, ${LAYER_LABEL[it.layer]}` : ''}`);
    if (it.soak) facts.push(`soak ${it.soak}`);
    if (it.warm) facts.push(`+${it.warm}° warm`);
    facts.push(fmtW(it.weight * (it.qty || 1)));
    const acts = [];
    const p = primaryOf(it);
    if (p) acts.push(`<button type="button" class="rp-act main" data-op="${p.op}"${p.verb ? ` data-verb="${esc(p.verb)}"` : ''}>${esc(p.label)}</button>`);
    // the other verbs it has, after the main one
    for (const v of it.verbs || []) {
      if (!VERB_LABEL[v] || (p?.op === 'verb' && p.verb === v) || (p?.op === 'take' && it.take?.verb === v)) continue;
      if ((v === 'eat' || v === 'drink') && it.take) continue;
      acts.push(`<button type="button" class="rp-act" data-op="verb" data-verb="${esc(v)}">${esc(VERB_LABEL[v])}</button>`);
    }
    if (it.slot && !it.worn && p?.op !== 'wear') acts.push(`<button type="button" class="rp-act" data-op="wear">${it.slot === 'weapon_hand' ? 'Hold' : 'Wear'}</button>`);
    if (!it.worn) {
      acts.push(`<button type="button" class="rp-act drop" data-op="drop">${it.qty > 1 ? 'Drop one' : 'Drop'}</button>`);
      if (it.qty > 1) acts.push(`<button type="button" class="rp-act drop" data-op="dropall">Drop all ${it.qty}</button>`);
    }
    selEl.innerHTML = `<div class="rp-selhead"><b>${esc(it.name)}</b><span>${esc(facts.join(' · '))}</span></div>
      ${it.desc ? `<p class="rp-desc">${esc(it.desc)}</p>` : ''}
      <div class="rp-acts">${acts.join('')}</div>`;
  }

  const paint = () => { paintHead(); paintDoll(); paintGrid(); paintSel(); };

  function fetchPack() {
    if (waiting) return;
    waiting = true;
    silent('roompack');
    setTimeout(() => { waiting = false; }, 4000);
  }

  // ── doing things ──
  function act(it, op, verb) {
    if (!it) return;
    if (op === 'wear') { silent(`roompack wear ${it.id}`); return; }
    if (op === 'off') { silent(`roompack off ${it.id}`); return; }
    if (op === 'drop') { silent(`roompack drop ${it.id} 1`); return; }
    if (op === 'dropall') { silent(`roompack drop ${it.id} ${it.qty || 1}`); return; }
    if (op === 'take' && it.take) {
      // into your hands, in first person: the Pack gets out of the way so you can see them
      close();
      if (it.take.act === 'spray') { spray(); return; }
      if (take({ id: it.id, name: it.name, kind: it.take.act, verb: it.take.verb, hold: it.take.hold }) === false) cmd(`${it.take.verb} ${it.name}`);
      return;
    }
    if (op === 'verb' && verb) {
      if (LEAVES.has(verb)) close();
      cmd(`${verb} ${it.name}`);
    }
  }
  const primary = (it) => { const p = it && primaryOf(it); if (p) act(it, p.op, p.verb); };

  function select(id) {
    selected = id && byId(id) ? id : null;
    paintDoll(); paintSel();
    for (const t of grid.querySelectorAll('.rp-tile')) { const on = t.dataset.id === selected; t.classList.toggle('sel', on); t.setAttribute('aria-selected', String(on)); }
  }

  // ── pointer: click, double-click and drag, one path for mouse and touch ──
  let drag = null;   // { id, from: 'grid', x, y, live, ghostEl }
  const DRAG_PX = 7;
  const overDoll = (x, y) => { const r = dollEl.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const overFloor = (x, y) => { const r = floor.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };

  function startDrag(e, id, from) {
    drag = { id, from, x: e.clientX, y: e.clientY, live: false, pid: e.pointerId };
  }
  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.live) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
      const it = byId(drag.id);
      if (!it) { drag = null; return; }
      drag.live = true;
      // held to the panel while it's live, so letting go outside it still ends the drag
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer's gone */ }
      drag.el = document.createElement('div');
      drag.el.className = 'rp-drag';
      drag.el.innerHTML = `${iconOf(it)}<span>${esc(it.name)}</span>`;
      el.appendChild(drag.el);
      el.classList.add('dragging', 'from-grid');
      if (drag.from === 'grid' && it.slot && !it.worn) el.classList.add('can-wear');
    }
    const r = el.getBoundingClientRect();
    drag.el.style.transform = `translate(${e.clientX - r.left + 10}px, ${e.clientY - r.top + 8}px)`;
    const it = byId(drag.id);
    // over the doll, a garment shows on you before you let go
    const want = drag.from === 'grid' && it?.slot && !it.worn && overDoll(e.clientX, e.clientY) ? it : null;
    if ((want?.id || null) !== (ghost?.id || null)) { ghost = want; paintDoll(); }
    dollEl.classList.toggle('drop-on', !!want);
    floor.classList.toggle('drop-on', overFloor(e.clientX, e.clientY) && !it?.worn);
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pid) return false;
    const d = drag; drag = null;
    el.classList.remove('dragging', 'from-grid', 'can-wear');
    dollEl.classList.remove('drop-on'); floor.classList.remove('drop-on');
    d.el?.remove();
    if (ghost) { ghost = null; paintDoll(); }
    if (!d.live) return false;
    const it = byId(d.id);
    if (!it) return true;
    if (overFloor(e.clientX, e.clientY)) { if (it.worn) say(`Take ${it.name} off first.`, false); else act(it, 'drop'); }
    else if (overDoll(e.clientX, e.clientY)) { if (it.slot && !it.worn) act(it, 'wear'); else if (!it.slot) say(`${it.name} isn't something you wear.`, false); }
    return true;
  }

  let lastTap = { id: null, at: 0 };
  grid.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.rp-tile');
    // a finger on the grid scrolls it (the tiles are pan-y in room-pack.css): on a touch screen a tap selects and the
    // buttons do the rest, and only the doll drags
    if (!t || e.button > 0 || e.pointerType === 'touch') return;
    startDrag(e, t.dataset.id, 'grid');
  });
  // across you: turning you round, a pixel a fifth of a degree, and up and down a little
  let spin = null;
  dollEl.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    spin = { pid: e.pointerId, x: e.clientX, y: e.clientY };
    try { dollEl.setPointerCapture(e.pointerId); } catch { /* the pointer's gone */ }
    dollEl.classList.add('turning');
  });
  dollEl.addEventListener('pointermove', (e) => {
    if (!spin || e.pointerId !== spin.pid) return;
    turn?.(-(e.clientX - spin.x) * 0.0105, (e.clientY - spin.y) * 0.006, 1);
    spin.x = e.clientX; spin.y = e.clientY;
  });
  const endSpin = (e) => { if (spin && e.pointerId === spin.pid) { spin = null; dollEl.classList.remove('turning'); } };
  dollEl.addEventListener('pointerup', endSpin);
  dollEl.addEventListener('pointercancel', endSpin);
  dollEl.addEventListener('wheel', (e) => { turn?.(0, 0, Math.exp(Math.max(-1, Math.min(1, e.deltaY / 240)) * 0.25)); e.preventDefault(); }, { passive: false });
  el.addEventListener('pointermove', moveDrag);
  el.addEventListener('pointerup', (e) => {
    if (endDrag(e)) return;
    // a click: a tile's chip does its main thing; a tile selects, twice quickly does its main thing
    const chip = e.target.closest('[data-quick]'), tile = e.target.closest('.rp-tile');
    const id = tile?.dataset.id;
    if (chip && tile) { primary(byId(tile.dataset.id)); return; }
    if (!id) return;
    const now = performance.now();
    if (lastTap.id === id && now - lastTap.at < 380) { lastTap = { id: null, at: 0 }; primary(byId(id)); return; }
    lastTap = { id, at: now };
    select(id);
  });
  el.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pid) { drag.el?.remove(); drag = null; el.classList.remove('dragging', 'from-grid', 'can-wear'); if (ghost) { ghost = null; paintDoll(); } } });
  // the room under it doesn't turn or walk while you're in the pack
  for (const ev of ['pointerdown', 'wheel', 'contextmenu']) el.addEventListener(ev, (e) => e.stopPropagation());

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.currentTarget.focus?.();
    if (b.classList.contains('rp-x')) { close(); return; }
    if (b.dataset.tab) { tab = b.dataset.tab; paintHead(); paintGrid(); return; }
    if (b.classList.contains('rp-undress')) {
      stripped = pack.items.filter((x) => x.worn && x.slot && x.slot !== 'weapon_hand' && x.slot !== 'accessory').map((x) => x.id);
      cmd('undress');
      return;
    }
    if (b.classList.contains('rp-redress')) {
      const back = stripped.filter((id) => byId(id) && !byId(id).worn);
      // underwear first, then clothes, then armour, so each goes on where it went before
      back.sort((a, b2) => (byId(a).layer || 2) - (byId(b2).layer || 2));
      if (back.length) silent(`roompack wear ${back.join(' ')}`);
      stripped = [];
      return;
    }
    if (b.dataset.op) act(byId(selected), b.dataset.op, b.dataset.verb);
  });

  // ── the keyboard, while it's open ──
  function key(e) {
    if (!open) return false;
    const k = e.key;
    if (k === 'Escape' || ((k === 'i' || k === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey)) { if (!e.repeat) close(); return true; }
    const list = shown(), at = list.findIndex((x) => x.id === selected);
    const cols = Math.max(1, Math.round(grid.clientWidth / (grid.querySelector('.rp-tile')?.offsetWidth || 160)));
    const move = (n) => { const i = at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + n)); if (list[i]) { select(list[i].id); grid.querySelector(`[data-id="${CSS.escape(list[i].id)}"]`)?.scrollIntoView({ block: 'nearest' }); } };
    if (k === 'ArrowRight') { move(1); return true; }
    if (k === 'ArrowLeft') { move(-1); return true; }
    if (k === 'ArrowDown') { move(cols); return true; }
    if (k === 'ArrowUp') { move(-cols); return true; }
    if (k === 'Enter' || k === 'f' || k === 'F') { if (!e.repeat) primary(byId(selected)); return true; }
    if (k === 'Delete' || k === 'Backspace') { const it = byId(selected); if (it && !it.worn && !e.repeat) act(it, 'drop'); return true; }
    if (/^[1-4]$/.test(k)) { tab = TABS[+k - 1][0]; paintHead(); paintGrid(); return true; }
    // Q and E turn you round, as they turn you in the room
    if (k === 'q' || k === 'Q') { turn?.(0.2, 0, 1); return true; }
    if (k === 'e' || k === 'E') { turn?.(-0.2, 0, 1); return true; }
    // the room's own keys stay the room's: nothing else walks or acts while the pack is up
    return k.length === 1 || k.startsWith('Arrow') || k === ' ';
  }

  function openPack(withTab) {
    if (withTab) tab = withTab;
    open = true; el.hidden = false;
    host.classList.add('rp-open');
    onToggle?.(true);
    paint();
    fetchPack();
  }
  function close() {
    if (!open) return;
    open = false; el.hidden = true; ghost = null; spin = null;
    host.classList.remove('rp-open');
    onToggle?.(false);
  }

  return {
    open: openPack,
    close,
    toggle(withTab) { if (open && (!withTab || withTab === tab)) close(); else openPack(withTab); },
    isOpen: () => open,
    // where you're drawn, on the page, for the room's camera to frame you in
    dollRect: () => (open ? dollEl.getBoundingClientRect() : null),
    // what you have on, with a garment held over you counted as on, for the figure (null till the pack's come)
    worn: () => (pack ? (ghost ? pack.items.map((x) => (x.id === ghost.id ? { ...x, worn: true } : x)) : pack.items) : null),
    // the server's `room_pack`
    data(msg) {
      waiting = false;
      pack = msg;
      if (selected && !byId(selected)) selected = null;
      if (msg.say) say(msg.say, msg.ok !== false);
      if (open) paint();
    },
    // the inventory changed some other way (`inventory_dirty`, a `use`): ask again, once, if it's open
    dirty() { if (open) { waiting = false; fetchPack(); } },
    say,
    key,
    destroy() { el.remove(); host.classList.remove('rp-open'); },
  };
}
