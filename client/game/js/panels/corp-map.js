// TERRITORY CONTROL — the standalone strategic map. A fullscreen overlay on the
// shared minigame chassis: the city grid tinted by controlling org, wired together
// by the arterial road network (avenues) for orientation, with a permanent marker
// on Franchise Strip (home), org-colour menace-glow on held turf, drag-to-pan, and
// a dramatic reticle-slam when you commit to contesting a zone. Rendered from a
// server `corp_map` payload (tiles + control + exits + arteries), opened by `corp map`.

import { sfx, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays } from './minigame-common.js';
import { sendCmdSilent } from '../net.js';

const START_ZONE = 'zone_city_west'; // Franchise Strip — always marked as home
let _overlay = null;
let _close = null;
let _data = null;
let _selected = null;
let _dragged = false;

function ensureStyles() {
  if (document.getElementById('corp-map-styles')) return;
  const s = document.createElement('style');
  s.id = 'corp-map-styles';
  s.textContent = `
    #corp-map-overlay { --mg-accent:#35e0c8; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,3,6,0.82); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #corp-map-overlay .cm-panel { width:min(940px,97vw); color:var(--mg-accent);
      background:linear-gradient(180deg,#1a2226 0%,#131a1e 7%,#0c1114 12%,#060a0c 100%); padding:14px 16px 16px; animation:cm-boot .32s ease-out; }
    @keyframes cm-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #corp-map-overlay .cm-screen { background:radial-gradient(130% 130% at 50% 40%, color-mix(in srgb, var(--mg-accent) 9%, #030806) 55%, #01050a 100%); }
    #corp-map-overlay .cm-body { position:relative; z-index:2; display:grid; grid-template-columns:1.8fr 1fr; gap:13px; padding:13px; }
    #corp-map-overlay .cm-gridwrap { max-height:58vh; overflow:auto; cursor:grab; user-select:none; scrollbar-width:thin; scrollbar-color:color-mix(in srgb,var(--mg-accent) 40%,transparent) transparent; }
    #corp-map-overlay .cm-gridwrap::-webkit-scrollbar { width:9px; height:9px; }
    #corp-map-overlay .cm-gridwrap::-webkit-scrollbar-thumb { background:color-mix(in srgb,var(--mg-accent) 35%,transparent); border-radius:5px; }
    #corp-map-overlay .cm-grid { display:grid; }
    /* tiles */
    #corp-map-overlay .cm-tile { position:relative; border-radius:4px; border:1px solid #00000066; cursor:pointer;
      display:flex; flex-direction:column; justify-content:space-between; padding:3px 4px; overflow:hidden; background:#0b1116; color:#8fb0b8; }
    #corp-map-overlay .cm-tile:hover { filter:brightness(1.18); }
    #corp-map-overlay .cm-tile.owned { color:#08110d; }
    #corp-map-overlay .cm-tile .tn { font-size:8px; line-height:1.05; font-weight:700; text-shadow:0 1px 0 rgba(255,255,255,.18); }
    #corp-map-overlay .cm-tile .ti { font-size:8px; font-weight:700; opacity:.92; }
    #corp-map-overlay .cm-tile.open { border:1px dashed #2c4a44; color:#5f8f88; }
    #corp-map-overlay .cm-tile.safe { background:#0a0f13; color:#3a545c; }
    #corp-map-overlay .cm-tile.enemy { animation:cm-menace 2.4s ease-in-out infinite; }
    @keyframes cm-menace { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.22)} }
    #corp-map-overlay .cm-tile.sel { outline:2px solid #fff; outline-offset:-2px; z-index:3; }
    #corp-map-overlay .cm-tile.cur .badge-cur { position:absolute; top:1px; right:3px; font-size:9px; color:#fff; text-shadow:0 0 4px #000; }
    #corp-map-overlay .cm-tile.mineflag .badge-hq { position:absolute; top:1px; left:3px; font-size:8px; opacity:.85; }
    #corp-map-overlay .cm-tile.start { box-shadow:inset 0 0 0 2px #ffd54a, 0 0 10px rgba(255,213,74,.45) !important; }
    #corp-map-overlay .cm-tile.start .badge-star { position:absolute; bottom:1px; right:3px; font-size:10px; color:#ffd54a; text-shadow:0 0 5px rgba(255,213,74,.8); }
    #corp-map-overlay .cm-tile.contested { animation:cm-pulse 1.4s ease-in-out infinite; }
    @keyframes cm-pulse { 0%,100%{box-shadow:inset 0 0 0 2px rgba(255,207,74,.25)} 50%{box-shadow:inset 0 0 0 2px rgba(255,207,74,.95),0 0 10px rgba(255,207,74,.5)} }
    /* roads / avenues */
    #corp-map-overlay .cm-link { display:flex; align-items:center; justify-content:center; color:#2c4650; font-size:13px; line-height:1; pointer-events:none; }
    #corp-map-overlay .cm-link.art { color:#c9a24a; font-weight:bold; text-shadow:0 0 6px rgba(201,162,74,.55); font-size:14px; }
    /* legend */
    #corp-map-overlay .cm-legend { display:flex; flex-wrap:wrap; gap:8px 12px; margin-top:9px; font-size:10px; color:#6b8a90; }
    #corp-map-overlay .lg { display:flex; align-items:center; gap:4px; }
    #corp-map-overlay .sw { width:10px; height:10px; border-radius:2px; }
    /* detail */
    #corp-map-overlay .cm-detail { background:rgba(4,10,12,.5); border:1px solid color-mix(in srgb,var(--mg-accent) 22%,#0a1418); border-radius:6px; padding:11px 12px; }
    #corp-map-overlay .cm-detail h3 { margin:0 0 4px; font-size:13px; color:#eafffb; letter-spacing:.5px; }
    #corp-map-overlay .cm-ctrl { font-size:10.5px; margin-bottom:9px; color:#6b8a90; }
    #corp-map-overlay .cm-tug { position:relative; height:13px; border-radius:7px; background:#ff5a6a; overflow:hidden; border:1px solid #000; }
    #corp-map-overlay .cm-tug i { display:block; height:100%; background:linear-gradient(90deg,var(--mg-accent),#7bffb0); box-shadow:0 0 8px var(--mg-accent); }
    #corp-map-overlay .cm-tugrow { display:flex; justify-content:space-between; font-size:10px; margin:3px 0 10px; }
    #corp-map-overlay .my { color:var(--mg-accent); } #corp-map-overlay .rv { color:#ff5a6a; } #corp-map-overlay .dim { color:#5a7a80; }
    #corp-map-overlay .cm-stat { display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px dashed #16242b; font-size:11px; }
    #corp-map-overlay .cm-stat .v { color:#eafffb; } .up{ color:#7bffb0; } .down{ color:#ff7a86; }
    #corp-map-overlay .cm-acts { display:flex; gap:6px; margin-top:11px; }
    #corp-map-overlay .cm-btn { flex:1; text-align:center; padding:7px 0; border-radius:4px; font-size:10.5px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; cursor:pointer;
      color:var(--mg-accent); border:1px solid color-mix(in srgb,var(--mg-accent) 55%,transparent); background:linear-gradient(180deg,color-mix(in srgb,var(--mg-accent) 18%,transparent),color-mix(in srgb,var(--mg-accent) 6%,transparent));
      box-shadow:inset 0 -2px 0 rgba(0,0,0,.4); transition:filter .12s,transform .05s; font-family:'Courier New',monospace; }
    #corp-map-overlay .cm-btn:hover { filter:brightness(1.2); } #corp-map-overlay .cm-btn:active { transform:translateY(1px); }
    #corp-map-overlay .cm-btn.hot { color:#ff5a6a; border-color:#ff5a6a; background:linear-gradient(180deg,rgba(255,90,106,.18),rgba(255,90,106,.05)); }
    #corp-map-overlay .cm-note { font-size:10px; color:#5a7a80; margin-top:9px; line-height:1.4; }
    /* dramatic contest FX */
    #corp-map-overlay .cm-fx { position:absolute; inset:0; z-index:20; pointer-events:none; display:flex; align-items:center; justify-content:center; }
    #corp-map-overlay .cm-fx .flash { position:absolute; inset:0; background:radial-gradient(circle at 50% 50%, rgba(255,60,80,.35), transparent 60%); animation:cm-flash .9s ease-out forwards; }
    @keyframes cm-flash { 0%{opacity:0} 15%{opacity:1} 100%{opacity:0} }
    #corp-map-overlay .cm-fx .reticle { position:absolute; width:220px; height:220px; border:2px solid #ff5a6a; border-radius:50%;
      box-shadow:0 0 30px rgba(255,90,106,.6), inset 0 0 30px rgba(255,90,106,.4); animation:cm-reticle 1.1s cubic-bezier(.2,.8,.2,1) forwards; }
    #corp-map-overlay .cm-fx .reticle::before, #corp-map-overlay .cm-fx .reticle::after { content:''; position:absolute; background:#ff5a6a; box-shadow:0 0 8px #ff5a6a; }
    #corp-map-overlay .cm-fx .reticle::before { left:50%; top:-14px; bottom:-14px; width:2px; transform:translateX(-1px); }
    #corp-map-overlay .cm-fx .reticle::after { top:50%; left:-14px; right:-14px; height:2px; transform:translateY(-1px); }
    @keyframes cm-reticle { 0%{transform:scale(2.4) rotate(-25deg); opacity:0} 30%{opacity:1} 60%{transform:scale(.9) rotate(3deg); opacity:1} 100%{transform:scale(1) rotate(0); opacity:0} }
    #corp-map-overlay .cm-fx .banner { position:relative; z-index:2; color:#fff; font-size:22px; font-weight:bold; letter-spacing:3px; text-transform:uppercase; text-align:center;
      text-shadow:0 0 14px #ff3c50, 0 2px 0 #000; animation:cm-banner 1.2s ease-out forwards; }
    @keyframes cm-banner { 0%{transform:scale(.6); opacity:0; letter-spacing:14px} 25%{opacity:1} 55%{transform:scale(1); letter-spacing:3px} 80%{opacity:1} 100%{opacity:0; transform:scale(1.05)} }
  `;
  document.head.appendChild(s);
}

function inkFor(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#08110d';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#08110d' : '#eafffb';
}
function sharesArtery(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.some(x => b.includes(x));
}

// The expanded (2n-1) cell grid: rooms at even indices, road/gap cells between.
function renderGrid() {
  const tiles = _data.tiles || [];
  if (!tiles.length) return '<div class="cm-note">No mapped territory on this level.</div>';
  const byId = new Map(tiles.map(t => [t.id, t]));
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const gCols = (maxX - minX) * 2 + 1, gRows = (maxY - minY) * 2 + 1;
  const cell = Array.from({ length: gRows }, () => new Array(gCols).fill(null));

  for (const t of tiles) cell[(t.y - minY) * 2][(t.x - minX) * 2] = { kind: 'room', tile: t };
  // Roads: draw a link cell between a tile and each grid-adjacent cardinal exit.
  for (const t of tiles) {
    const gx = (t.x - minX) * 2, gy = (t.y - minY) * 2;
    for (const tgt of Object.values(t.exits || {})) {
      const n = byId.get(tgt);
      if (!n) continue;
      const dx = n.x - t.x, dy = n.y - t.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue; // cardinal, adjacent only
      const cy = gy + dy, cx = gx + dx;
      if (cy < 0 || cy >= gRows || cx < 0 || cx >= gCols || cell[cy][cx]) continue;
      const art = sharesArtery(t.artery, n.artery);
      const ch = dx !== 0 ? (art ? '═' : '─') : (art ? '║' : '│');
      cell[cy][cx] = { kind: 'link', ch, art };
    }
  }

  // Column/row templates: room track / gap track alternating.
  const colT = Array.from({ length: gCols }, (_, i) => i % 2 ? '15px' : '58px').join(' ');
  const rowT = Array.from({ length: gRows }, (_, i) => i % 2 ? '13px' : '46px').join(' ');
  let html = `<div class="cm-grid" style="grid-template-columns:${colT};grid-template-rows:${rowT}">`;
  for (let r = 0; r < gRows; r++) for (let c = 0; c < gCols; c++) {
    const it = cell[r][c];
    const pos = `grid-column:${c + 1};grid-row:${r + 1};`;
    if (!it) { html += `<span style="${pos}"></span>`; continue; }
    if (it.kind === 'link') { html += `<span class="cm-link${it.art ? ' art' : ''}" style="${pos}">${it.ch}</span>`; continue; }
    const t = it.tile, ct = t.control || {};
    const owned = !!ct.org_id;
    const cls = ['cm-tile'];
    if (owned) cls.push('owned'); else if (ct.status === 'OPEN') cls.push('open'); else cls.push('safe');
    if (ct.status === 'CONTESTED') cls.push('contested');
    if (owned && !ct.mine) cls.push('enemy');
    if (ct.mine) cls.push('mineflag');
    if (t.isCurrent) cls.push('cur');
    if (t.isStart) cls.push('start');
    if (_selected === t.id) cls.push('sel');
    let style = pos;
    if (owned) {
      // Org-colour menace-glow — stronger + doubled for enemy-held turf.
      const glow = ct.mine ? 9 : 14;
      const enemyExtra = ct.mine ? '' : `, 0 0 5px ${ct.color}`;
      style += `background:${ct.color};color:${inkFor(ct.color)};filter:saturate(1.12);box-shadow:0 0 ${glow}px ${ct.color}${enemyExtra};`;
    }
    const label = owned ? `${esc(ct.tag)} ${ct.influence}%` : (ct.status === 'OPEN' ? 'open' : '');
    const badges = (t.isCurrent ? '<span class="badge-cur">◉</span>' : '') + (ct.mine ? '<span class="badge-hq">▣</span>' : '') + (t.isStart ? '<span class="badge-star">★</span>' : '');
    html += `<div class="${cls.join(' ')}" style="${style}" data-zone="${esc(t.id)}" title="${esc(t.name)}">${badges}<span class="tn">${esc(t.name)}</span><span class="ti">${label}</span></div>`;
  }
  html += '</div>';
  const legend = (_data.orgs || []).map(o =>
    `<span class="lg"><span class="sw" style="background:${o.color};box-shadow:0 0 6px ${o.color}"></span>${esc(o.tag)} ${esc(o.name)}${o.id === _data.myOrgId ? ' (you)' : ''}</span>`
  ).join('') + '<span class="lg">★ Franchise Strip · ◉ you · ▣ HQ · ═ artery</span>';
  return `<div class="cm-gridwrap">${html}</div><div class="cm-legend">${legend}</div>`;
}

function renderDetail() {
  const t = _data.tiles?.find(x => x.id === _selected);
  if (!t) return '<div class="cm-note">Select a zone on the map to inspect it.<br>Drag to pan; scroll to explore.</div>';
  const c = t.control || {};
  const inf = c.influence ?? (c.org_id ? 50 : 0);
  const controller = c.org_id ? `${esc(c.tag)} · ${c.status}` : (c.status === 'OPEN' ? 'UNCLAIMED' : 'not contestable');
  const home = t.isStart ? '<span style="color:#ffd54a"> · ★ FRANCHISE STRIP (home)</span>' : '';
  let acts = '';
  if (t.isCurrent && _data.myOrgId) {
    if (!c.org_id && c.status === 'OPEN') acts = `<div class="cm-acts"><div class="cm-btn" data-act="claim">Claim</div></div>`;
    else if (c.mine) acts = `<div class="cm-acts"><div class="cm-btn" data-act="reinforce">Reinforce</div></div>`;
    else if (c.org_id) acts = `<div class="cm-acts"><div class="cm-btn hot" data-act="contest">⚔ Contest</div></div>`;
  } else if (c.status === 'OPEN' || c.org_id) {
    acts = `<div class="cm-note">▸ Travel to <b>${esc(t.name)}</b> to act — the verbs work where you stand.</div>`;
  }
  const tug = c.org_id
    ? `<div class="cm-tug"><i style="width:${inf}%"></i></div>
       <div class="cm-tugrow"><span class="my">${esc(c.tag)} ${inf}%</span>${c.challenger ? `<span class="rv">${esc(c.challenger)} ${100 - inf}%</span>` : '<span class="dim">uncontested</span>'}</div>`
    : '';
  const econ = c.org_id
    ? `<div class="cm-stat"><span class="dim">Income</span><span class="v up">+${c.income}/day</span></div>
       <div class="cm-stat"><span class="dim">Upkeep</span><span class="v down">−${c.upkeep}/day</span></div>` : '';
  const artery = Array.isArray(t.artery) && t.artery.length ? `<div class="cm-stat"><span class="dim">On</span><span class="v">${t.artery.map(esc).join(' · ')}</span></div>` : '';
  return `<h3>${esc(t.name)}</h3><div class="cm-ctrl">${t.isCurrent ? '◉ you are here · ' : ''}${controller}${home}</div>${tug}${econ}${artery}${acts}`;
}

function renderBody() {
  return `<div class="cm-body"><div>${renderGrid()}</div><div class="cm-detail" id="cm-detail">${renderDetail()}</div></div>`;
}

function rerender() {
  const screen = _overlay.querySelector('.cm-screen');
  if (!screen) return;
  const wrapOld = _overlay.querySelector('.cm-gridwrap');
  const sl = wrapOld?.scrollLeft || 0, st = wrapOld?.scrollTop || 0;
  screen.innerHTML = renderBody() + crtOverlays();
  const wrap = _overlay.querySelector('.cm-gridwrap');
  if (wrap) { wrap.scrollLeft = sl; wrap.scrollTop = st; }
  wire();
}

// Dramatic reticle-slam + banner over the target zone before the contest fires.
function playContestFx(name, then) {
  const fx = document.createElement('div');
  fx.className = 'cm-fx';
  fx.innerHTML = `<div class="flash"></div><div class="reticle"></div><div class="banner">⚔ Contesting<br>${esc(name)}</div>`;
  _overlay.querySelector('.cm-panel')?.appendChild(fx);
  sfx('hololock-miss');
  setTimeout(() => { sfx('hololock-lose'); }, 350);
  setTimeout(() => { fx.remove(); if (then) then(); }, 1150);
}

function wire() {
  const wrap = _overlay.querySelector('.cm-gridwrap');
  if (wrap) wirePan(wrap);
  _overlay.querySelectorAll('.cm-tile').forEach(el =>
    el.addEventListener('click', () => { if (_dragged) return; _selected = el.dataset.zone; sfx('hololock-set'); rerender(); }));
  _overlay.querySelectorAll('.cm-btn[data-act]').forEach(el =>
    el.addEventListener('click', () => {
      const act = el.dataset.act;
      if (act === 'contest') {
        const t = _data.tiles?.find(x => x.id === _selected);
        playContestFx(t?.name || 'the zone', () => { sendCmdSilent('corp contest'); setTimeout(() => sendCmdSilent('corp map'), 500); });
        return;
      }
      sfx('hololock-set');
      sendCmdSilent(`corp ${act}`);
      setTimeout(() => sendCmdSilent('corp map'), 500);
    }));
}

// Drag-to-pan the grid; a real drag suppresses the next tile click.
function wirePan(wrap) {
  let down = false, sx = 0, sy = 0, sl = 0, st = 0;
  wrap.onpointerdown = (e) => { down = true; _dragged = false; sx = e.clientX; sy = e.clientY; sl = wrap.scrollLeft; st = wrap.scrollTop; };
  wrap.onpointermove = (e) => {
    if (!down) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 5) { _dragged = true; wrap.style.cursor = 'grabbing'; }
    wrap.scrollLeft = sl - dx; wrap.scrollTop = st - dy;
  };
  const end = () => { down = false; wrap.style.cursor = 'grab'; setTimeout(() => { _dragged = false; }, 0); };
  wrap.onpointerup = end; wrap.onpointerleave = end;
}

export function openCorpMap(msg) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _data = msg;
  if (!_selected || !msg.tiles?.some(t => t.id === _selected)) {
    _selected = msg.tiles?.find(t => t.isCurrent)?.id || null;
  }
  const html =
    `<div class="cm-panel mg-chassis">
      ${deviceHeader('&#9649;', 'TERRITORY CONTROL', 'COLDWATER · ' + esc(msg.myTag || 'UNAFFILIATED'))}
      <div class="cm-bezel mg-bezel">${bezelScrews()}<div class="cm-screen mg-screen" style="--mg-sweep-h:520px">${renderBody()}${crtOverlays()}</div></div>
    </div>`;
  const mounted = mountOverlay({ id: 'corp-map-overlay', html, onClose: () => { _data = null; } });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.style.setProperty('--mg-accent', msg.accent || '#35e0c8');
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  wire();
  // Centre the view on where you're standing.
  const curEl = _overlay.querySelector('.cm-tile.cur') || _overlay.querySelector('.cm-tile.start');
  if (curEl) curEl.scrollIntoView({ block: 'center', inline: 'center' });
  window.AudioEngine?.init?.();
  sfx('hololock-entry');
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
