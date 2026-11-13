// The environmental control screen (plugins/envcontrol), a little operating system for a flat. It
// runs on the panel's own glass in the Room Stage (room-envctl.js lays it there, as a hololock's card
// is laid), and pops out into a window for whoever wants one, docked or full screen.
// It wakes with "Welcome, <owner>" on screen and out loud (ORACLE, on the ui channel), then shows its
// home menu: a tile per app (Lights, Climate, Security and, where the room has a glass wall,
// Shutters), each opening that app's page.
// It holds no logic: every button sends a typeable verb (`lights on`, `thermostat 22`, `doorcam`,
// `shutters space`, `panel refresh`) and it redraws from the state each answer carries. Which page
// is up is each screen's own business.

import { sendCmd, sendCmdSilent } from '../net.js';
import { loadCss, escapeHtml } from '../../../shared/dom.js';

const css = loadCss(new URL('./envctl.css', import.meta.url));
const REFRESH_MS = 4000, WELCOME_MS = 2600;
let last = null, timer = 0, styled = null;
// the window (popped out) and the wall's glass, either of which may be absent
let win = null, wall = null;

const esc = (s) => escapeHtml(String(s ?? ''));
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// the sleeping clock: the digits big and the AM/PM small beside them, so a 12-hour locale never wraps it
const sleepClock = () => {
  const parts = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const mer = parts.filter((p) => p.type === 'dayPeriod').map((p) => p.value).join('');
  const digits = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  return `<span>${digits}</span>${mer ? `<small>${mer}</small>` : ''}`;
};
const fmtC = (n) => (Number.isFinite(n) ? `${Math.round(n * 10) / 10}°` : '--');
function partOfDay() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }

export function ensureEnvctlStyles() {
  if (!styled) styled = css.then((t) => { const s = document.createElement('style'); s.id = 'envctl-css'; s.textContent = t; document.head.appendChild(s); });
  return styled;
}

/**
 * One screen of the OS on element `el`. `kind` is 'window' or 'wall': the wall has a Pop out button
 * and sleeps; the window has Full screen and Close. Clicks on its buttons send their verbs.
 */
function createView(el, kind) {
  const v = { el, kind, page: kind === 'wall' ? 'sleep' : 'home', full: false, welcomeT: 0, touchedAt: 0, pg: {}, tab: null };
  // a page of a paged list forward or back, kept in range when it's drawn
  v.flip = (key, d) => { v.pg[key] = (v.pg[key] || 0) + d; v.draw(); };
  el.addEventListener('click', (e) => {
    v.touchedAt = performance.now();
    if (v.page === 'welcome') { v.endWelcome(); e.stopPropagation(); return; }
    // a touch on the sleeping glass wakes it: `panel` answers with the welcome
    if (v.page === 'sleep') { sendCmd('panel'); e.stopPropagation(); return; }
    // the blinds' colour wheel: round it is the hue, out from the middle how strong; it sends `shutters colour`.
    // offsetX/Y are in the wheel's own frame, so this holds on the wall's glass, which is drawn in perspective.
    const wheel = e.target.closest('.envctl-wheel');
    if (wheel) {
      e.stopPropagation();
      const r = wheel.clientWidth / 2, dx = e.offsetX - r, dy = e.offsetY - r;
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, sat = Math.min(1, Math.hypot(dx, dy) / r);
      sendCmd(`shutters colour ${hslHex(hue, sat, Number(wheel.dataset.l) || 0.5)}`);
      return;
    }
    const b = e.target.closest('[data-cmd],[data-ui],[data-page],[data-sel],[data-pg],[data-tab]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.ui === 'full') { v.full = !v.full; v.draw(); return; }
    if (b.dataset.ui === 'close') { closeWindow(true); return; }
    if (b.dataset.ui === 'popout') { popOut(); return; }
    if (b.dataset.ui === 'sleep') { v.sleep(); return; }
    if (b.dataset.pg) { const [key, to] = b.dataset.pg.split(':'); if (to === '+' || to === '-') v.flip(key, to === '+' ? 1 : -1); else { v.pg[key] = Number(to) || 0; v.draw(); } return; }
    if (b.dataset.tab) { v.tab = b.dataset.tab; v.draw(); return; }
    if (b.dataset.page) { if (v.page !== b.dataset.page) v.tab = null; v.page = b.dataset.page; v.draw(); return; }
    if (b.dataset.sel) { v.sel = b.dataset.sel; v.draw(); return; }
    sendCmd(b.dataset.cmd);
  });
  v.welcome = (greet) => {
    v.page = 'welcome'; v.touchedAt = performance.now();
    clearTimeout(v.welcomeT);
    v.welcomeT = setTimeout(v.endWelcome, WELCOME_MS);
    const name = greet?.name || '', hello = greet?.owner || !name ? 'Welcome home' : 'Welcome';
    try { window.AudioEngine?.speak(name ? `${hello}, ${name}.` : `${hello}.`, { channel: 'ui', seed: 30 }); } catch { /* no sound: the screen still says it */ }
    v.draw();
  };
  v.endWelcome = () => { clearTimeout(v.welcomeT); v.welcomeT = 0; if (v.page === 'welcome') { v.page = 'home'; v.draw(); } };
  v.sleep = () => { clearTimeout(v.welcomeT); v.page = 'sleep'; v.draw(); };
  v.awake = () => v.page !== 'sleep';
  // the dimmer: the room follows it as you drag, and the level goes to the server when you let go
  el.addEventListener('input', (e) => {
    const r = e.target.closest('.envctl-dimmer');
    if (!r) return;
    v.dragging = true; v.touchedAt = performance.now();
    const n = Number(r.value), out = el.querySelector('.envctl-dimval');
    if (out) out.textContent = n ? n + '%' : 'OFF';
    r.style.setProperty('--p', n / 100);
    tellRoom({ [r.dataset.id]: n });
  });
  el.addEventListener('change', (e) => {
    const r = e.target.closest('.envctl-dimmer');
    if (!r) return;
    v.dragging = false;
    sendCmd(`dim ${r.dataset.n} ${r.value}`);
  });
  // a paged list turns with a swipe across it or the mouse wheel over it, as well as its arrows
  let swipe = null;
  el.addEventListener('pointerdown', (e) => { const p = e.target.closest('[data-pages]'); swipe = p && !e.target.closest('.envctl-dimmer,.envctl-wheel') ? { key: p.dataset.pages, x: e.clientX, y: e.clientY } : null; });
  el.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, key = swipe.key;
    swipe = null;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.5) { v.touchedAt = performance.now(); v.flip(key, dx < 0 ? 1 : -1); }
  });
  el.addEventListener('wheel', (e) => {
    const p = e.target.closest('[data-pages]');
    if (!p || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 4) return;
    e.preventDefault();
    const now = performance.now();
    if (now - (v.wheelAt || 0) < 350) return;
    v.wheelAt = now; v.touchedAt = now;
    v.flip(p.dataset.pages, (e.deltaY || e.deltaX) > 0 ? 1 : -1);
  }, { passive: false });
  v.draw = () => { if (!v.dragging) draw(v); };
  return v;
}

// ── the apps ────────────────────────────────────────────────────────────────
// Each: its tile on the menu (a glyph, a name, one line of state) and its page.
function apps(s) {
  const c = s.climate || {}, lights = s.lights || [], lit = lights.filter((l) => l.on).length, cam = s.cam || {}, sh = s.shutters;
  const list = [
    { id: 'lights', name: 'Lights', glyph: '✺', on: lit > 0, state: lit ? `${lit} of ${lights.length} on` : 'All off' },
    { id: 'climate', name: 'Climate', glyph: '❄', on: c.target != null, state: c.target == null ? `${fmtC(c.now)} · off` : `${fmtC(c.now)} → ${c.target}°` },
    { id: 'security', name: 'Security', glyph: '◉', on: !!cam.frame, state: cam.frame ? 'Door camera live' : cam.status === 'none' ? 'No camera' : 'No signal' },
  ];
  if (sh) list.push({ id: 'shutters', name: 'Shutters', glyph: '▤', on: sh.down, state: !sh.down ? 'Up' : sh.scene === 'blinds' ? `Blinds ${sh.level}%` : (sh.scenes.find((x) => x.id === sh.scene)?.name || 'Down') });
  return list;
}

// ⚠ A REDRAW PATCHES, IT DOESN'T REBUILD. The open screen asks again every REFRESH_MS and redraws from every
// answer, and each page has an entry animation (envctl.css `envctl-rise`, a fade up out of a blur). Rebuilt with
// innerHTML each time, every control faded out and back every four seconds, and a click that landed mid-rebuild
// was lost. So a page is built whole only when it changes, and after that only what differs is touched.
function paint(v, html) {
  const key = `${v.page}|${v.full ? 1 : 0}`;
  if (v.painted !== key || !v.el.firstChild) { v.el.innerHTML = html; v.painted = key; return; }
  const t = document.createElement('template');
  t.innerHTML = html;
  morph(v.el, t.content);
}
function morph(a, b) {
  const an = [...a.childNodes], bn = [...b.childNodes];
  bn.forEach((y, i) => {
    const x = an[i];
    if (!x) { a.appendChild(y); return; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y, x); return; }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
    for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
    for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
    // a slider's position is its property, not its attribute, once it's been touched
    if (x.tagName === 'INPUT' && document.activeElement !== x && x.value !== (y.getAttribute('value') ?? x.value)) x.value = y.getAttribute('value');
    morph(x, y);
  });
  for (let i = an.length - 1; i >= bn.length; i--) an[i].remove();
}

function draw(v) {
  const { el } = v, s = last;
  const isWin = v.kind === 'window';
  el.classList.toggle('envctl-full', isWin && v.full);
  el.classList.toggle('envctl-dark', s?.power === 'unpowered');
  if (v.page === 'sleep' || !s) {
    // the glass at rest: the time, and a hint to touch it
    paint(v, `<div class="envctl-sleep"><div class="envctl-sleep-time">${sleepClock()}</div><div class="envctl-sleep-hint">Touch to wake</div></div>`);
    return;
  }
  if (!s.shutters && v.page === 'shutters') v.page = 'home';
  if (v.page === 'welcome') {
    // whoever woke it, by name; in your own flat, "Welcome home"
    const name = s.greet?.name, home = !!s.greet?.owner || !name;
    paint(v, `<div class="envctl-welcome" aria-live="polite">
        <div class="envctl-crest" aria-hidden="true"><i></i></div>
        <div class="envctl-hello">Welcome${home ? ' home' : ''}${name ? ',' : ''}</div>
        <div class="envctl-who">${name ? esc(name) : ''}</div>
        <div class="envctl-sub">${esc(s.name)} · ${clock()}</div>
      </div>`);
    return;
  }
  const app = apps(s).find((a) => a.id === v.page);
  const tools = isWin
    ? `<button type="button" data-ui="full" title="${v.full ? 'Dock' : 'Full screen'}" aria-label="${v.full ? 'Dock' : 'Full screen'}">${v.full ? '▣' : '⛶'}</button>
       <button type="button" data-ui="close" title="Close" aria-label="Close">✕</button>`
    : `<button type="button" data-ui="popout" title="Pop out into a window" aria-label="Pop out">⧉</button>
       <button type="button" data-ui="sleep" title="Sleep" aria-label="Sleep">⏻</button>`;
  // the dock: every app one touch away from anywhere, so nothing needs a way back to the menu
  const dock = `<nav class="envctl-dock" aria-label="Apps">
      <button type="button" data-page="home" class="${!app ? 'sel' : ''}" aria-label="Home"><i aria-hidden="true">⌂</i><span>Home</span></button>
      ${apps(s).map((a) => `<button type="button" data-page="${a.id}" class="${app?.id === a.id ? 'sel' : ''}${a.on ? ' on' : ''}"><i aria-hidden="true">${a.glyph}</i><span>${a.name}</span></button>`).join('')}
    </nav>`;
  paint(v, `
    <header class="envctl-head">
      <span class="envctl-name">${app ? esc(app.name) : esc(s.name)}</span>
      <span class="envctl-status">${s.power === 'unpowered' ? '<b class="envctl-warn">NO POWER</b>' : ''}<span>${fmtC(s.climate?.now)}</span><span>${clock()}</span></span>
      ${tools}
    </header>
    <div class="envctl-page envctl-p-${esc(v.page)}">${app ? appPage(app.id, s, v) : home(s)}</div>
    ${dock}`);
}

function home(s) {
  const name = s.greet?.name;
  return `<div class="envctl-greet">${name ? `Good ${partOfDay()}, <b>${esc(name)}</b>` : `Good ${partOfDay()}`}</div>
    <div class="envctl-menu">${apps(s).map((a) => `<button type="button" class="envctl-app${a.on ? ' on' : ''}" data-page="${a.id}">
        <i aria-hidden="true">${a.glyph}</i><span class="envctl-appname">${a.name}</span><span class="envctl-appstate">${esc(a.state)}</span>
      </button>`).join('')}</div>`;
}

function appPage(id, s, v) {
  if (id === 'lights') return lightsPage(v, s);
  if (id === 'climate') {
    const c = s.climate || {}, t = c.target, lo = c.min ?? 16, hi = c.max ?? 28;
    const pct = t == null ? 0 : Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
    return `<div class="envctl-dial${t == null ? '' : ' on'}" style="--p:${pct}">
        <div class="envctl-dial-in"><span class="envctl-set">${t == null ? 'OFF' : `${t}°`}</span><small>now ${fmtC(c.now)}</small></div>
      </div>
      <div class="envctl-row envctl-big2">
        <button type="button" data-cmd="thermostat down" aria-label="Cooler">−</button>
        <button type="button" data-cmd="thermostat ${t == null ? 21 : 'off'}">${t == null ? 'Turn on' : 'Turn off'}</button>
        <button type="button" data-cmd="thermostat up" aria-label="Warmer">+</button>
      </div>`;
  }
  if (id === 'security') {
    const cam = s.cam || {};
    const body = cam.frame
      ? `<div class="envctl-frame">${esc(cam.frame)}</div>`
      : `<div class="envctl-frame envctl-nosig">${cam.status === 'none' ? 'NO CAMERA FITTED' : `NO SIGNAL · ${esc(String(cam.status || '').toUpperCase())}`}</div>`;
    return `<div class="envctl-camhead"><span>${esc(cam.label || 'Front door')}</span><span class="envctl-live">${cam.frame ? '● LIVE' : ''}</span></div>
      ${body}
      <div class="envctl-row"><button type="button" data-cmd="doorcam">Snapshot to log</button></div>`;
  }
  if (id === 'shutters') return shutterPage(s.shutters, v);
  return '';
}

// A list too long for the glass goes a page at a time: the page's items, and the arrows and dots under it.
// `per` is how many fit; a window at full screen has room for them all.
function pages(v, key, items, per) {
  const n = Math.max(1, Math.ceil(items.length / per)), at = Math.max(0, Math.min(n - 1, v.pg[key] || 0));
  v.pg[key] = at;
  const bar = n < 2 ? '' : `<div class="envctl-pager">
      <button type="button" data-pg="${key}:-" ${at ? '' : 'disabled'} aria-label="Previous page">‹</button>
      <span class="envctl-dots">${Array.from({ length: n }, (_, i) => `<button type="button" data-pg="${key}:${i}" class="${i === at ? 'sel' : ''}" aria-label="Page ${i + 1} of ${n}"></button>`).join('')}</span>
      <button type="button" data-pg="${key}:+" ${at < n - 1 ? '' : 'disabled'} aria-label="Next page">›</button>
    </div>`;
  return { items: items.slice(at * per, at * per + per), bar, at };
}

// The lights: a grid of them to pick one from, six to a page, and the picked one's dimmer under it.
function lightsPage(v, s) {
  const lights = s.lights || [], lit = lights.filter((l) => l.on).length;
  if (!lights.length) return '<div class="envctl-empty">No lights</div>';
  const i = Math.max(0, lights.findIndex((l) => l.id === v.sel)), l = lights[i];
  v.sel = l.id;
  const lvl = l.on ? l.dim : 0;
  // the picked light's page comes up with it, unless the arrows have moved off it since
  const per = v.full ? 12 : 6;
  if (v.pgFor !== l.id) { v.pg.lights = Math.floor(i / per); v.pgFor = l.id; }
  const pg = pages(v, 'lights', lights.map((x, j) => ({ x, j })), per);
  const grid = lights.length > 1 ? `<div class="envctl-lights" data-pages="lights" role="listbox" aria-label="Lights">${pg.items.map(({ x, j }) => `<button type="button" role="option" aria-selected="${j === i}" class="envctl-light-pick${j === i ? ' sel' : ''}${x.on ? ' on' : ''}" data-sel="${esc(x.id)}" title="${esc(x.name)}${x.room ? ' · ' + esc(x.room) : ''}">
        <i aria-hidden="true"></i><span class="envctl-ln">${esc(x.name)}</span><b>${x.on ? x.dim + '%' : 'Off'}</b><span class="envctl-lr">${esc(x.room || '')}</span></button>`).join('')}</div>${pg.bar}` : '';
  return `${grid}
    <div class="envctl-dimbox${l.on ? ' on' : ''}">
      <div class="envctl-dimhead"><span class="envctl-clip">${esc(l.name)}</span><b class="envctl-dimval">${lvl ? lvl + '%' : 'Off'}</b></div>
      <input type="range" class="envctl-dimmer" min="0" max="100" step="5" value="${lvl}" style="--p:${lvl / 100}" data-id="${esc(l.id)}" data-n="${i + 1}" aria-label="${esc(l.name)} brightness">
      <div class="envctl-row envctl-even">
        <button type="button" data-cmd="dim ${i + 1} ${l.on ? 0 : l.dim || 100}">${l.on ? 'Off' : 'On'}</button>
        ${lights.length > 1 ? `<button type="button" data-cmd="lights on" ${lit === lights.length ? 'class="sel"' : ''}>All on</button><button type="button" data-cmd="lights off" ${!lit ? 'class="sel"' : ''}>All off</button>` : ''}
      </div>
    </div>`;
}

// The Room Stage's light follows the panel's: for each room, on if any of its lights is, at the mean
// level of those that are. `over` is a level being dragged, by light id. The Stage listens for
// 'envctl:light' and takes the room you're in (room-stage.js). Each room's is said once per change, so
// the switch by the door still works between answers.
const told = new Map();
function tellRoom(over = null) {
  const rooms = new Map();
  for (const l of last?.lights || []) {
    const lvl = over && l.id in over ? over[l.id] : l.on ? l.dim : 0;
    const r = rooms.get(l.zone) || { sum: 0, n: 0 };
    if (lvl > 0) { r.sum += lvl; r.n++; }
    rooms.set(l.zone, r);
  }
  for (const [zone, r] of rooms) {
    const on = r.n > 0, level = on ? r.sum / r.n / 100 : 0, key = on ? level.toFixed(2) : 'off';
    if (!over && told.get(zone) === key) continue;
    told.set(zone, key);
    window.dispatchEvent(new CustomEvent('envctl:light', { detail: { zone, on, level } }));
  }
}

// The shutters: up or down, and a button for each scene the panel offers, with its colours as a swatch.
const colour = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c)) ? c : '#000');
// colours as hue (degrees), saturation and lightness (0..1), for the blinds' wheel
function hexHsl(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0, r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255).toString(16).padStart(2, '0');
  return `#${f(0)}${f(8)}${f(4)}`;
}
// Three shades the wheel's colours come in; the wheel is drawn at the one the blinds are nearest.
const SHADES = [['Pale', 0.74], ['Mid', 0.52], ['Deep', 0.3]];
function colourPicker(sh, blinds) {
  const cur = colour(blinds.swatch?.[1] || '#6f9dc4'), [h, s, l] = hexHsl(cur);
  const shade = SHADES.reduce((m, x) => (Math.abs(x[1] - l) < Math.abs(m[1] - l) ? x : m))[1];
  const x = 50 + Math.cos((h * Math.PI) / 180) * s * 50, y = 50 + Math.sin((h * Math.PI) / 180) * s * 50;
  return `<div class="envctl-colour">
      <div class="envctl-wheel" data-l="${shade}" style="--l:${Math.round(shade * 100)}%" role="img" aria-label="Colour wheel: click to colour the blinds">
        <i class="envctl-wheel-dot" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;background:${cur}"></i>
      </div>
      <div class="envctl-shades">${SHADES.map(([n, v]) => `<button type="button" data-cmd="shutters colour ${hslHex(h, s, v)}" ${v === shade ? 'class="sel"' : ''}>${n}</button>`).join('')}
        <button type="button" data-cmd="shutters colour #6f9dc4" title="The blinds' own blue">Reset</button></div>
    </div>`;
}
// The shutters, in two tabs where the panel has blinds: Scenes (up, down and the pictures, six to a page)
// and Blinds (how much light and what colour). It opens on whichever is down.
function shutterPage(sh, v) {
  const now = sh.scenes.find((x) => x.id === sh.scene);
  const blinds = sh.scenes.find((x) => x.id === 'blinds'), drawn = sh.down && sh.scene === 'blinds';
  const scenes = sh.scenes.filter((x) => x.id !== 'blinds');
  const tab = blinds && (v.tab || (drawn ? 'blinds' : 'scenes')) === 'blinds' ? 'blinds' : 'scenes';
  const tabs = blinds ? `<div class="envctl-tabs" role="tablist">
      <button type="button" role="tab" data-tab="scenes" aria-selected="${tab === 'scenes'}" class="${tab === 'scenes' ? 'sel' : ''}">Scenes</button>
      <button type="button" role="tab" data-tab="blinds" aria-selected="${tab === 'blinds'}" class="${tab === 'blinds' ? 'sel' : ''}">Blinds</button>
    </div>` : '';
  const status = `<div class="envctl-state${sh.down ? ' on' : ''}"><b>${drawn ? 'Blinds drawn' : sh.down ? 'Shutters down' : 'Shutters up'}</b><span class="envctl-clip">${drawn ? `${sh.level}% light` : sh.down ? esc(now?.name || '') : 'Window clear'}</span></div>`;
  if (tab === 'blinds') {
    return `${tabs}${status}
      <div class="envctl-label">Light through them</div>
      <div class="envctl-row envctl-even">${[0, 25, 50, 75, 100].map((n) => `<button type="button" data-cmd="shutters blinds ${n}" ${drawn && sh.level === n ? 'class="sel"' : ''}>${n}%</button>`).join('')}</div>
      ${colourPicker(sh, blinds)}
      <div class="envctl-row envctl-even"><button type="button" data-cmd="shutters up" ${!sh.down ? 'class="sel"' : ''}>Open the window</button></div>`;
  }
  const pg = pages(v, 'scenes', scenes, v.full ? 12 : 6);
  return `${tabs}${status}
    <div class="envctl-row envctl-even">
      <button type="button" data-cmd="shutters up" ${!sh.down ? 'class="sel"' : ''}>Up</button>
      <button type="button" data-cmd="shutters down" ${sh.down && !drawn ? 'class="sel"' : ''}>Down</button>
    </div>
    <div class="envctl-scenes" data-pages="scenes">${pg.items.map((x) => {
      const [a, b, c] = (x.swatch || []).map(colour);
      return `<button type="button" class="envctl-scene${sh.down && x.id === sh.scene ? ' sel' : ''}" data-cmd="shutters ${esc(x.id)}" style="--a:${a};--b:${b};--c:${c}" title="${esc(x.name)}"><i aria-hidden="true"></i><span>${esc(x.name)}</span></button>`;
    }).join('')}</div>${pg.bar}`;
}

// ── the window ──────────────────────────────────────────────────────────────
async function mountWindow() {
  if (win) return win;
  await ensureEnvctlStyles();
  const el = document.createElement('div');
  el.className = 'envctl envctl-window';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Control panel');
  el.hidden = true;
  document.body.appendChild(el);
  win = createView(el, 'window');
  // the room's keys stay the room's, except Esc: back to the menu, then out of full screen, then shut
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !win || win.el.hidden) return;
    e.stopPropagation(); e.preventDefault();
    if (win.page !== 'home') { win.page = 'home'; win.draw(); } else if (win.full) { win.full = false; win.draw(); } else closeWindow(true);
  }, true);
  return win;
}
// The wall's screen into a window, on the page the wall was showing.
async function popOut() {
  const w = await mountWindow();
  w.page = wall && wall.awake() && wall.page !== 'welcome' ? wall.page : 'home';
  w.el.hidden = false;
  w.draw();
  poll();
}
function closeWindow(tell = false) {
  if (!win || win.el.hidden) return;
  win.el.hidden = true; win.full = false;
  if (!busy()) stopPoll();
  if (tell && !wall?.awake()) sendCmdSilent('panel close');
}
export const close = closeWindow;

// ── the wall's glass (room-envctl.js) ───────────────────────────────────────
/** Lays the OS on `el`, the page over the panel's glass. Returns the view; detach with `detachWall`. */
export function attachWall(el) {
  wall = createView(el, 'wall');
  el.classList.add('envctl', 'envctl-wall');
  ensureEnvctlStyles();
  wall.draw();
  return wall;
}
export function detachWall(v) {
  if (wall !== v) return;
  clearTimeout(v.welcomeT);
  wall = null;
  if (!busy()) stopPoll();
}

const busy = () => (win && !win.el.hidden) || wall?.awake();
function poll() {
  if (timer) return;
  timer = setInterval(() => {
    if (!busy()) { stopPoll(); return; }
    if (!document.hidden) sendCmdSilent('panel refresh');
  }, REFRESH_MS);
}
function stopPoll() { clearInterval(timer); timer = 0; }

// Every answer from the panel's verbs comes here. `open` (from `panel`) wakes the wall's glass with its
// welcome, or the window where there's no wall to wake (a panel opened from the log away from the
// Stage); the others redraw whatever's up.
export async function onEnvctl(msg) {
  if (msg.close) { closeWindow(false); return; }
  // the greeting comes only with `open`; keep it for the menu's "Good evening, <name>"
  last = { ...msg, greet: msg.greet ?? last?.greet };
  tellRoom();
  if (msg.open) {
    if (wall && wall.el.isConnected && !(win && !win.el.hidden)) {
      if (!wall.awake()) wall.welcome(msg.greet); else wall.draw();
    } else {
      const w = await mountWindow();
      const waking = w.el.hidden;
      w.el.hidden = false;
      if (waking) w.welcome(msg.greet); else w.draw();
    }
    poll();
    return;
  }
  if (win && !win.el.hidden && win.page !== 'welcome') win.draw();
  if (wall?.awake() && wall.page !== 'welcome') wall.draw();
}

export const isEnvctlOpen = () => !!win && !win.el.hidden;
