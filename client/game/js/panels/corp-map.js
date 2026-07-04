// TERRITORY CONTROL — the standalone strategic map. A fullscreen overlay on the
// shared minigame chassis: the city grid tinted by controlling org, per-zone
// influence, contested tiles pulsing, and a selected-zone detail panel with
// context-aware CLAIM / CONTEST / REINFORCE actions (enabled only where you
// actually stand — the verbs act on your current zone). Rendered from a server
// `corp_map` payload (tiles + control), opened by `corp map`.

import { sfx, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays } from './minigame-common.js';
import { sendCmdSilent } from '../net.js';

let _overlay = null;
let _close = null;
let _data = null;
let _selected = null;

function ensureStyles() {
  if (document.getElementById('corp-map-styles')) return;
  const s = document.createElement('style');
  s.id = 'corp-map-styles';
  s.textContent = `
    #corp-map-overlay { --mg-accent:#35e0c8; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,3,6,0.82); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #corp-map-overlay .cm-panel { width:min(880px,96vw); color:var(--mg-accent);
      background:linear-gradient(180deg,#1a2226 0%,#131a1e 7%,#0c1114 12%,#060a0c 100%); padding:14px 16px 16px; animation:cm-boot .32s ease-out; }
    @keyframes cm-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #corp-map-overlay .cm-screen { background:radial-gradient(130% 130% at 50% 40%, color-mix(in srgb, var(--mg-accent) 9%, #030806) 55%, #01050a 100%); }
    #corp-map-overlay .cm-body { position:relative; z-index:2; display:grid; grid-template-columns:1.7fr 1fr; gap:13px; padding:13px; }
    #corp-map-overlay .cm-gridwrap { max-height:52vh; overflow:auto; }
    #corp-map-overlay .cm-grid { display:grid; gap:4px; }
    #corp-map-overlay .cm-tile { position:relative; min-width:52px; aspect-ratio:1/.8; border-radius:4px; border:1px solid #00000066; cursor:pointer;
      display:flex; flex-direction:column; justify-content:space-between; padding:3px 4px; overflow:hidden; background:#0b1116; color:#8fb0b8; }
    #corp-map-overlay .cm-tile.owned { color:#08110d; }
    #corp-map-overlay .cm-tile .tn { font-size:8px; line-height:1.05; font-weight:700; text-shadow:0 1px 0 rgba(255,255,255,.18); }
    #corp-map-overlay .cm-tile .ti { font-size:8px; font-weight:700; opacity:.9; }
    #corp-map-overlay .cm-tile.open { border:1px dashed #2c4a44; color:#5f8f88; }
    #corp-map-overlay .cm-tile.safe { background:#0a0f13; color:#3a545c; }
    #corp-map-overlay .cm-tile.sel { outline:2px solid #fff; outline-offset:-2px; }
    #corp-map-overlay .cm-tile.cur::after { content:'◉'; position:absolute; top:2px; right:3px; font-size:9px; color:#fff; text-shadow:0 0 4px #000; }
    #corp-map-overlay .cm-tile.mine.owned::before { content:'▣'; position:absolute; top:2px; left:3px; font-size:8px; opacity:.8; }
    #corp-map-overlay .cm-tile.contested { animation:cm-pulse 1.5s ease-in-out infinite; }
    @keyframes cm-pulse { 0%,100%{box-shadow:inset 0 0 0 2px rgba(255,207,74,.25)} 50%{box-shadow:inset 0 0 0 2px rgba(255,207,74,.95),0 0 8px rgba(255,207,74,.4)} }
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
  `;
  document.head.appendChild(s);
}

// A readable text colour over an arbitrary org colour.
function inkFor(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#08110d';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#08110d' : '#eafffb';
}

function renderGrid() {
  const tiles = _data.tiles || [];
  if (!tiles.length) return '<div class="cm-note">No mapped territory on this level.</div>';
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const cols = maxX - minX + 1;
  let html = `<div class="cm-grid" style="grid-template-columns:repeat(${cols},1fr)">`;
  for (const t of tiles) {
    const c = t.control || {};
    const owned = !!c.org_id;
    const cls = ['cm-tile'];
    if (owned) cls.push('owned'); else if (c.status === 'OPEN') cls.push('open'); else cls.push('safe');
    if (c.status === 'CONTESTED') cls.push('contested');
    if (c.mine) cls.push('mine');
    if (t.isCurrent) cls.push('cur');
    if (_selected === t.id) cls.push('sel');
    // tint owned tiles by controller colour at influence-scaled strength
    let style = `grid-column:${t.x - minX + 1};grid-row:${t.y - minY + 1};`;
    if (owned) {
      const alpha = 0.35 + 0.6 * ((c.influence ?? 50) / 100);
      style += `background:${c.color};opacity:1;filter:saturate(1.1);color:${inkFor(c.color)};`;
      // fade toward panel bg by influence via an inner overlay is overkill; alpha via rgba mix:
      style += `box-shadow:inset 0 0 0 999px rgba(6,10,12,${(1 - alpha).toFixed(2)});`;
    }
    const label = owned ? `${esc(c.tag)} ${c.influence}%` : (c.status === 'OPEN' ? 'open' : '');
    html += `<div class="${cls.join(' ')}" style="${style}" data-zone="${esc(t.id)}" title="${esc(t.name)}">
      <span class="tn">${esc(t.name)}</span><span class="ti">${label}</span></div>`;
  }
  html += '</div>';
  // legend
  const legend = (_data.orgs || []).map(o =>
    `<span class="lg"><span class="sw" style="background:${o.color}"></span>${esc(o.tag)} ${esc(o.name)}${o.id === _data.myOrgId ? ' (you)' : ''}</span>`
  ).join('') + '<span class="lg">◉ you · ▣ HQ · ⚔ pulsing = contested</span>';
  return `<div class="cm-gridwrap">${html}</div><div class="cm-legend">${legend}</div>`;
}

function renderDetail() {
  const t = _data.tiles?.find(x => x.id === _selected);
  if (!t) return '<div class="cm-note">Select a zone on the map to inspect it.</div>';
  const c = t.control || {};
  const inf = c.influence ?? (c.org_id ? 50 : 0);
  const controller = c.org_id ? `${esc(c.tag)} · ${c.status}` : (c.status === 'OPEN' ? 'UNCLAIMED' : 'not contestable');
  let acts = '';
  if (t.isCurrent && _data.myOrgId) {
    if (!c.org_id && c.status === 'OPEN') acts = `<div class="cm-acts"><div class="cm-btn" data-act="claim">Claim</div></div>`;
    else if (c.mine) acts = `<div class="cm-acts"><div class="cm-btn" data-act="reinforce">Reinforce</div></div>`;
    else if (c.org_id) acts = `<div class="cm-acts"><div class="cm-btn hot" data-act="contest">Contest</div></div>`;
  } else if (c.status === 'OPEN' || c.org_id) {
    acts = `<div class="cm-note">▸ Travel to <b>${esc(t.name)}</b> to act on it — the verbs work where you stand.</div>`;
  }
  const tug = c.org_id
    ? `<div class="cm-tug"><i style="width:${inf}%"></i></div>
       <div class="cm-tugrow"><span class="my">${esc(c.tag)} ${inf}%</span>${c.challenger ? `<span class="rv">${esc(c.challenger)} ${100 - inf}%</span>` : '<span class="dim">uncontested</span>'}</div>`
    : '';
  const econ = c.org_id
    ? `<div class="cm-stat"><span class="dim">Income</span><span class="v up">+${c.income}/day</span></div>
       <div class="cm-stat"><span class="dim">Upkeep</span><span class="v down">−${c.upkeep}/day</span></div>` : '';
  return `<h3>${esc(t.name)}</h3><div class="cm-ctrl">${t.isCurrent ? '◉ you are here · ' : ''}${controller}</div>${tug}${econ}${acts}`;
}

function renderBody() {
  return `<div class="cm-body"><div>${renderGrid()}</div><div class="cm-detail" id="cm-detail">${renderDetail()}</div></div>`;
}

function rerender() {
  const screen = _overlay.querySelector('.cm-screen');
  if (!screen) return;
  screen.innerHTML = renderBody() + crtOverlays();
  wire();
}

function wire() {
  _overlay.querySelectorAll('.cm-tile').forEach(el =>
    el.addEventListener('click', () => { _selected = el.dataset.zone; sfx('hololock-set'); rerender(); }));
  _overlay.querySelectorAll('.cm-btn[data-act]').forEach(el =>
    el.addEventListener('click', () => {
      const act = el.dataset.act;
      sfx(act === 'contest' ? 'hololock-miss' : 'hololock-set');
      sendCmdSilent(`corp ${act}`);
      setTimeout(() => sendCmdSilent('corp map'), 500); // refresh after the server settles
    }));
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
      <div class="cm-bezel mg-bezel">${bezelScrews()}<div class="cm-screen mg-screen" style="--mg-sweep-h:480px">${renderBody()}${crtOverlays()}</div></div>
    </div>`;
  const mounted = mountOverlay({ id: 'corp-map-overlay', html, onClose: () => { _data = null; } });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.style.setProperty('--mg-accent', msg.accent || '#35e0c8');
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  wire();
  window.AudioEngine?.init?.();
  sfx('hololock-entry');
}

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
