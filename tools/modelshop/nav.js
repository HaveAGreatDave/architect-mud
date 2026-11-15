// THE MODELSHOP'S NAVIGATION. A slim rail down the left edge of every page, one labelled icon per
// page, so moving between the Modelshop's pages is never a page's own business. Each page adds two
// lines to its <head>:
//
//   <link rel="stylesheet" href="/nav.css">
//   <script type="module" src="/nav.js"></script>
//
// nav.css pads the body clear of the rail; a page that pins things to the window's left edge
// offsets them by var(--ms-nav-w). The pages are grouped into workspaces (Models, People,
// Creatures, Rooms), drawn between hairlines. Ctrl+K opens Go to, which finds any page or any
// action a page has offered; ? opens the shortcut sheet. A page offers its own with:
//
//   window.msNav.shortcuts([{ group: 'Transform', keys: ['G'], does: 'move' }, …])
//   window.msNav.actions([{ name: 'Open model…', hint: 'O', run: () => … }, …])
//
// Pages open in this tab; Ctrl-click or middle-click opens one in another, as any link does.

const WORKSPACES = [
  { id: 'models', name: 'Models' },
  { id: 'people', name: 'People' },
  { id: 'creatures', name: 'Creatures' },
  { id: 'rooms', name: 'Rooms' },
];

// 20-unit stroke icons, drawn for this rail
const I = {
  logo: '<path d="M10 2 17 6v8l-7 4-7-4V6zM3 6l7 4 7-4M10 10v8"/>',
  editor: '<path d="M4 17V7l4-3 4 3v10M12 17V10h4v7M2.5 17h15M6.5 9h3M6.5 12h3"/>',
  cab: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="2"/><path d="M3.5 9.5h4.6M11.9 9.5h4.6M10 12v5"/>',
  figures: '<circle cx="10" cy="5" r="2.5"/><path d="M5.5 17v-4.5a4.5 4.5 0 0 1 9 0V17M8 17v-3M12 17v-3"/>',
  poses: '<circle cx="11.5" cy="3.8" r="2"/><path d="m5 9 3.5-2.5 3 1.5 1.5 3 3 1M11.5 8l-2 4.5 3 2.5-1 3M9.5 12.5 6 15l-2 0"/>',
  firstgen: '<circle cx="10" cy="10" r="7"/><path d="M5.2 4.9c1.6 1.4 2.4 3.2 2.4 5.1s-.8 3.7-2.4 5.1M14.8 4.9c-1.6 1.4-2.4 3.2-2.4 5.1s.8 3.7 2.4 5.1"/>',
  bestiary: '<ellipse cx="10" cy="13" rx="3.6" ry="3"/><ellipse cx="4.6" cy="8.6" rx="1.5" ry="2"/><ellipse cx="8" cy="5" rx="1.5" ry="2"/><ellipse cx="12" cy="5" rx="1.5" ry="2"/><ellipse cx="15.4" cy="8.6" rx="1.5" ry="2"/>',
  cattery: '<path d="M4 3.5 7 7h6l3-3.5V11a6 6 0 0 1-12 0z"/><circle cx="7.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="12.5" cy="10.5" r=".6" fill="currentColor"/><path d="m9 13 1 .8 1-.8"/>',
  rooms: '<path d="M3 17V3h14v14M2 17h16M7.5 17V8h5v9"/><circle cx="11" cy="12.6" r=".6" fill="currentColor"/>',
  search: '<circle cx="8.5" cy="8.5" r="5"/><path d="m12.3 12.3 4.5 4.5"/>',
  keys: '<rect x="2" y="5" width="16" height="10" rx="2"/><path d="M5 8h.01M8 8h.01M11 8h.01M14 8h.01M5.5 12h9"/>',
};
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.5'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = I[name];
  return s;
};

const PAGES = [
  { ws: 'models', path: '/', name: 'Editor', icon: 'editor', blurb: 'GLASS buildings, vehicles and fauna: inspect, edit, compare' },
  { ws: 'models', path: '/cabtrinkets.html', name: 'Cab', long: 'Cab interior', icon: 'cab', blurb: "A truck's cab from the driver's seat, with the driver's things hung in it" },
  { ws: 'people', path: '/figure-lab.html', name: 'Figures', icon: 'figures', blurb: 'Everybody as a person: the close-up figure or the street crowd' },
  { ws: 'people', path: '/pose-lab.html', name: 'Poses', icon: 'poses', blurb: "Deadball's clips keyed on the real rig, played in the 3-D park" },
  { ws: 'people', path: '/first-gen-lab.html', name: '1st Gen', long: 'First Generation', icon: 'firstgen', blurb: 'The 32 Deadball expansion players in their club kit' },
  { ws: 'creatures', path: '/bestiary.html', name: 'Bestiary', icon: 'bestiary', blurb: "Every enemy and animal drawn to ROOM's standard" },
  { ws: 'creatures', path: '/cattery.html', name: 'Cattery', icon: 'cattery', blurb: 'The cat kit: every cat in each pose, with sliders to make a new one' },
  { ws: 'rooms', path: '/room-lab.html', name: 'Rooms', long: 'Room Lab', icon: 'rooms', blurb: 'The Room Stage on any room in content/, with the real view out of its windows' },
];
const longName = (p) => p.long || p.name;
const wsName = Object.fromEntries(WORKSPACES.map((w) => [w.id, w.name]));

const GLOBAL_KEYS = [
  { group: 'Anywhere', keys: ['Ctrl', 'K'], does: 'go to a page or an action' },
  { group: 'Anywhere', keys: ['?'], does: 'this sheet' },
  { group: 'Anywhere', keys: ['Esc'], does: 'close it' },
];

const here = PAGES.find((p) => p.path === location.pathname || (p.path === '/' && location.pathname === '/index.html')) || null;

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
};
const kbd = (keys) => keys.map((k) => h('kbd', {}, k));

// ── the hover label beside the rail ─────────────────────────────────────────
let tip = null, tipTimer = 0;
function showTip(el, title, kicker, text) {
  clearTimeout(tipTimer);
  if (!tip) { tip = h('div', { class: 'msn-tip', role: 'tooltip' }); document.body.append(tip); }
  tip.replaceChildren(...(kicker ? [h('i', {}, kicker)] : []), h('b', {}, title), ...(text ? [document.createTextNode(text)] : []));
  const r = el.getBoundingClientRect();
  tip.style.top = Math.max(6, Math.min(innerHeight - tip.offsetHeight - 6, r.top + r.height / 2 - tip.offsetHeight / 2)) + 'px';
  requestAnimationFrame(() => tip.classList.add('show'));
}
function hideTip() { tipTimer = setTimeout(() => tip?.classList.remove('show'), 40); }
const tipped = (el, title, kicker, text) => {
  el.addEventListener('mouseenter', () => showTip(el, title, kicker, text));
  el.addEventListener('mouseleave', hideTip);
  el.addEventListener('focus', () => showTip(el, title, kicker, text));
  el.addEventListener('blur', hideTip);
  el.addEventListener('click', hideTip);
  el.setAttribute('aria-label', title);
  return el;
};

// ── the rail ─────────────────────────────────────────────────────────────────
function rail() {
  const nav = h('nav', { id: 'ms-nav', 'aria-label': 'Modelshop pages' });
  nav.append(tipped(h('a', { class: 'msn-item msn-brand', href: '/' }, icon('logo')), 'Modelshop', null, 'GLASS models and the labs around them'));
  let ws = null;
  for (const p of PAGES) {
    if (p.ws !== ws) { if (ws) nav.append(h('div', { class: 'msn-rule', role: 'separator' })); ws = p.ws; }
    const on = p === here;
    nav.append(tipped(h('a', { class: 'msn-item' + (on ? ' on' : ''), href: p.path, 'aria-current': on ? 'page' : null },
      icon(p.icon), h('span', {}, p.name)), longName(p), wsName[p.ws], p.blurb));
  }
  nav.append(h('div', { class: 'msn-fill' }));
  nav.append(tipped(h('button', { class: 'msn-item', type: 'button', onclick: () => openGo() }, icon('search'), h('span', {}, 'Go to')), 'Go to', 'Ctrl + K', 'Any page, or anything this page can do'));
  nav.append(tipped(h('button', { class: 'msn-item', type: 'button', onclick: () => openKeys() }, icon('keys'), h('span', {}, 'Keys')), 'Keyboard shortcuts', '?', "Every key on the page you're on"));
  return nav;
}

// ── Go to ────────────────────────────────────────────────────────────────────
let pageActions = [];
let pageKeys = [];
const goBox = { root: null, input: null, list: null, items: [], sel: 0 };

function goEntries() {
  const acts = pageActions.map((a) => ({ group: here ? longName(here) : 'This page', name: a.name, sub: a.sub || '', hint: a.hint || '', run: a.run }));
  const pages = PAGES.map((p) => ({ group: 'Pages', icon: p.icon, name: longName(p), sub: wsName[p.ws] + ' · ' + p.blurb, hint: p === here ? 'you are here' : '',
    run: () => { location.href = p.path; } }));
  return [...acts, ...pages];
}

function renderGo() {
  const words = goBox.input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  goBox.items = goEntries().filter((e) => {
    const hay = (e.name + ' ' + e.sub + ' ' + e.group).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  goBox.sel = Math.min(goBox.sel, Math.max(0, goBox.items.length - 1));
  goBox.list.textContent = '';
  if (!goBox.items.length) { goBox.list.append(h('div', { class: 'msn-empty' }, 'Nothing matches.')); return; }
  let group = null;
  goBox.items.forEach((e, i) => {
    if (e.group !== group) { group = e.group; goBox.list.append(h('div', { class: 'msn-group' }, group)); }
    goBox.list.append(h('div', { class: 'msn-row' + (i === goBox.sel ? ' sel' : ''), role: 'option',
      onmousemove: () => { if (goBox.sel !== i) { goBox.sel = i; paintSel(); } },
      onclick: () => runGo(i) },
    e.icon ? icon(e.icon) : null,
    h('div', { class: 't' }, h('b', {}, e.name), e.sub ? h('span', {}, e.sub) : null),
    e.hint ? h('em', {}, e.hint) : null));
  });
}
function paintSel() {
  const rows = goBox.list.querySelectorAll('.msn-row');
  rows.forEach((r, i) => r.classList.toggle('sel', i === goBox.sel));
  rows[goBox.sel]?.scrollIntoView({ block: 'nearest' });
}
function runGo(i) {
  const e = goBox.items[i];
  if (!e) return;
  closeAll();
  e.run();
}

function openGo() {
  closeAll();
  if (!goBox.root) {
    goBox.input = h('input', { placeholder: 'Go to a page, or do something on this one…', 'aria-label': 'Go to', autocomplete: 'off', spellcheck: 'false' });
    goBox.list = h('div', { class: 'msn-list', role: 'listbox' });
    goBox.input.addEventListener('input', () => { goBox.sel = 0; renderGo(); });
    const foot = h('div', { class: 'msn-foot' }, h('span', {}, ...kbd(['↑', '↓']), ' choose'), h('span', {}, ...kbd(['Enter']), ' go'), h('span', {}, ...kbd(['Esc']), ' close'));
    goBox.root = h('div', { class: 'msn-overlay', hidden: true, onmousedown: (ev) => { if (ev.target === goBox.root) closeAll(); } },
      h('div', { class: 'msn-box' }, h('div', { class: 'msn-search' }, icon('search'), goBox.input), goBox.list, foot));
    document.body.append(goBox.root);
  }
  goBox.input.value = ''; goBox.sel = 0;
  renderGo();
  goBox.root.hidden = false;
  goBox.input.focus();
}

// ── the shortcut sheet ───────────────────────────────────────────────────────
let keysRoot = null;
function openKeys() {
  closeAll();
  const body = h('div', { class: 'msn-keys' });
  let group = null, box = null;
  for (const k of [...pageKeys, ...GLOBAL_KEYS]) {
    if (k.group !== group) { group = k.group; box = h('section', {}, h('h4', {}, group)); body.append(box); }
    box.append(h('div', {}, h('span', {}, k.does), h('span', {}, ...kbd(k.keys))));
  }
  keysRoot = h('div', { class: 'msn-overlay', onmousedown: (ev) => { if (ev.target === keysRoot) closeAll(); } },
    h('div', { class: 'msn-box' },
      h('div', { class: 'msn-head' }, h('span', {}, (here ? longName(here) + ' · ' : '') + 'Keyboard shortcuts'), h('kbd', {}, 'Esc')),
      body));
  document.body.append(keysRoot);
}

function closeAll() {
  if (goBox.root) goBox.root.hidden = true;
  keysRoot?.remove(); keysRoot = null;
}
const isOpen = () => (goBox.root && !goBox.root.hidden) || !!keysRoot;

// Capture phase on window, so the rail sees a key before any page does: a page's own arrow or
// Escape keys must not fire while Go to is open, and Ctrl+K must not reach the browser.
addEventListener('keydown', (ev) => {
  const k = ev.key;
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && k.toLowerCase() === 'k') {
    ev.preventDefault(); ev.stopPropagation();
    if (goBox.root && !goBox.root.hidden) closeAll(); else openGo();
    return;
  }
  if (isOpen()) {
    if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeAll(); return; }
    if (goBox.root && !goBox.root.hidden) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        ev.preventDefault();
        const n = goBox.items.length;
        if (n) { goBox.sel = (goBox.sel + (k === 'ArrowDown' ? 1 : n - 1)) % n; paintSel(); }
      } else if (k === 'Enter') { ev.preventDefault(); runGo(goBox.sel); }
    }
    ev.stopPropagation();   // the page under the overlay hears nothing
    return;
  }
  const t = ev.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (k === '?' && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); ev.stopPropagation(); openKeys(); }
}, true);

window.msNav = {
  shortcuts(list) { pageKeys = list.slice(); },
  actions(list) { pageActions = list.slice(); if (goBox.root && !goBox.root.hidden) renderGo(); },
  pages: PAGES.map((p) => ({ ...p })),
  here: here ? { ...here } : null,
};

const mount = () => {
  if (document.getElementById('ms-nav')) return;
  document.body.prepend(rail());
};
if (document.body) mount(); else addEventListener('DOMContentLoaded', mount, { once: true });
