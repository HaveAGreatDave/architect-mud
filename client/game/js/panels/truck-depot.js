// THE LONG HAUL — the depot.
//
// ONE screen for the whole yard: the trucks you own, the dealer's line along the fence, the freight
// board and the exchange. It was two panels behind two verbs, which was wrong twice over — a depot
// is one PLACE and the choice being made there is a single one (what do I drive, and what do I put
// in it), so splitting it made a player compare two screens to answer one question.
//
// It OPENS WHEN YOU WALK IN and closes when you leave, exactly as flight's hangar bay does. The
// verbs (`yard`, `market`) survive as the deliberate way in; walking through the gate is the
// discovered one, and both land here.
//
// Same contract as every other surface in this system: the client computes NOTHING. Affordability,
// resale, deck capacity and the spread against the last market you stood in all arrive as facts.
// Every button is an ordinary verb string a player could have typed, so the log rung types exactly
// what the visual rung clicks.

import { sendCmdSilent } from '../net.js';
import { drawWireframe3D, themeColor } from './wireframe-plane.js';

let tab = 'fleet';

export function openTruckDepot(msg) {
  ensureStyles();
  tab = msg.tab || tab || 'fleet';
  close();
  const host = document.getElementById('overlay-host') || document.body;
  const el = document.createElement('div');
  el.className = 'td-wrap';
  el.dataset.payload = '1';
  el._msg = msg;
  el.innerHTML = render(msg, tab);
  host.appendChild(el);
  startSchematics(el);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; el.innerHTML = render(el._msg, tab); startSchematics(el); return; }
    const b = e.target.closest('[data-cmd]');
    if (b && !b.disabled) { sendCmdSilent(b.dataset.cmd); return; }
    if (e.target.closest('[data-td-close]') || e.target === el) close();
  });
  document.addEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') close(); }
export function closeTruckDepot() { close(); }
function close() {
  document.removeEventListener('keydown', onKey);
  for (const n of document.querySelectorAll('.td-wrap')) { if (n._raf) cancelAnimationFrame(n._raf); n.remove(); }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `${Number(n).toLocaleString()}₵`;

function render(m, active) {
  const deck = m.cargo
    ? m.cargo.kind === 'goods'
      ? `<b>${esc(m.cargo.qty)} × ${esc(m.cargo.name)}</b> · ${m.cargo.kg} kg · paid ${money(m.cargo.paid)}/unit`
      : `<b>${esc(m.cargo.name)}</b> · contracted to ${esc(m.cargo.to)}`
    : '<span class="td-dim">empty</span>';

  const TABS = [['fleet', 'Yard'], ['buy', 'For sale'], ['freight', 'Freight'], ['market', 'Exchange']];
  const nav = TABS.map(([k, label]) =>
    `<button class="td-tab${k === active ? ' on' : ''}" data-tab="${k}">${label}</button>`).join('');

  return `
  <div class="td-panel" role="dialog" aria-label="Depot">
    <header>
      <div><b>${esc(m.depot)}</b><span class="td-dim"> · ${esc(m.regionName || '')}</span></div>
      <div class="td-right">${money(m.credits)}${m.fuel != null ? ` · fuel ${Math.round(m.fuel * 100)}%` : ''}</div>
      <button class="td-x" data-td-close aria-label="Close">✕</button>
    </header>
    <div class="td-deck">On the deck: ${deck}${m.driving ? '' : ' <span class="td-dim">(you are not in a truck)</span>'}</div>
    <nav class="td-nav">${nav}</nav>
    <div class="td-body">${
      active === 'buy' ? renderStock(m)
      : active === 'freight' ? renderBoard(m)
      : active === 'market' ? renderMarket(m)
      : renderFleet(m)}</div>
    <footer class="td-dim">Everything here is a command: <code>yard buy krell</code>, <code>haul 1</code>, <code>market buy scrap full</code>, <code>drive</code>.</footer>
  </div>`;
}

function renderFleet(m) {
  if (!(m.fleet || []).length) {
    return '<div class="td-none">You own nothing with wheels on it. The line along the fence is waiting — see <b>For sale</b>.</div>';
  }
  return `<div class="td-grid">${m.fleet.map((t) => `
    <div class="td-card ${t.hereNow ? 'here' : 'away'}">
      <div class="td-badge">${t.hereNow ? 'IN THE YARD' : esc(t.whereName || 'elsewhere')}</div>
      <div class="td-name">${esc(t.name)}</div>
      <div class="td-sub">${esc(t.type)}</div>
      ${schematic(t.typeId, true)}
      ${spec(t)}
      <div class="td-bar" title="fuel ${Math.round(t.fuel * 100)}%"><i style="width:${Math.round(t.fuel * 100)}%"></i></div>
      <div class="td-meta">${t.odometer.toLocaleString()} tiles on the clock</div>
      <div class="td-acts">
        ${t.hereNow ? '<button data-cmd="drive">Take it out</button>' : ''}
        <button class="ghost" data-cmd="yard sell ${esc(t.id)}" ${t.hereNow ? '' : 'disabled title="Bring it here first"'}>Sell · ${money(t.resale)}</button>
      </div>
    </div>`).join('')}</div>`;
}

function renderStock(m) {
  return `<div class="td-grid">${(m.stock || []).map((t) => `
    <div class="td-card stock ${t.afford ? '' : 'poor'}">
      <div class="td-badge">TIER ${t.tier}</div>
      <div class="td-name">${esc(t.name)}</div>
      <div class="td-blurb">${esc(t.blurb)}</div>
      ${schematic(t.id, false)}
      ${spec(t)}
      <div class="td-acts">
        <button data-cmd="yard buy ${esc(t.id)}" ${t.afford ? '' : 'disabled title="You cannot afford it"'}>Buy · ${money(t.price)}</button>
      </div>
    </div>`).join('')}</div>`;
}
// THE SCHEMATIC. The dealer's line already had one of these for aircraft (`drawWireframe3D` — the
// real face geometry stroked as hollow edges through the same ¾ camera the hangar turntable uses),
// and a truck yard had nothing but a table of three numbers. It is the SAME MESH a pilot sees go
// past on the road, so a buyer is looking at the thing they will own rather than at an illustration
// of it — which is also what makes the four silhouettes worth having.
//
// Owned trucks are drawn WITH A TRAILER and dealer stock without: what you have is a working rig,
// what is on the lot is a bare tractor. That is true, and it saves a legend.
function schematic(typeId, withTrailer) {
  if (!typeId) return '';
  return `<canvas class="td-schem" width="260" height="104" data-truck="${esc(typeId)}${withTrailer ? '+t' : ''}" aria-hidden="true"></canvas>`;
}
// One rAF for the whole panel, spinning every canvas on it. Per-card loops would be a dozen timers
// racing each other; this is the cadence the hangar's own showroom uses.
let _spin = 0;
function startSchematics(root) {
  const cvs = [...root.querySelectorAll('.td-schem')];
  if (!cvs.length) return;
  const accent = themeColor('--accent', '#d8892e');
  const tick = () => {
    if (!root.isConnected) return;
    _spin += 0.006;
    for (const c of cvs) {
      const ctx = c.getContext('2d');
      if (ctx) drawWireframe3D(ctx, { cls: 'truck', variant: c.dataset.truck, w: c.width, h: c.height, accent, yaw: _spin });
    }
    root._raf = requestAnimationFrame(tick);
  };
  tick();
}

const spec = (t) => `<dl class="td-spec">
  <div><dt>deck</dt><dd>${t.kg} kg</dd></div>
  <div><dt>tank</dt><dd>${t.tank}</dd></div>
  <div><dt>top</dt><dd>${t.top} mph</dd></div>
</dl>`;

// Contracts: a fixed fee to move somebody else's box. No capital, no risk.
function renderBoard(m) {
  if (!(m.board || []).length) return '<div class="td-none">Nothing on the board today.</div>';
  return `<div class="td-rows">${m.board.map((b) => `
    <div class="td-row">
      <div class="td-main"><b>${esc(b.name)}</b><span class="td-dim"> · ${b.kg} kg → ${esc(b.toName)}${b.crosses ? ' <span class="td-warn">across the waste</span>' : ''}</span></div>
      <div class="td-pay">${money(b.pay)}</div>
      <button data-cmd="haul ${b.i + 1}" ${m.driving ? '' : 'disabled title="Get in a truck first"'}>Take</button>
    </div>`).join('')}</div>`;
}

// The exchange: your own money on your own guess. `thereBid` is the only comparison, and only for
// a market you have actually stood in — learning the map by driving it is the whole discovery loop.
function renderMarket(m) {
  const rows = (m.quotes || []).map((q) => {
    const gain = q.thereBid == null ? null : q.thereBid - q.ask;
    const there = q.thereBid == null
      ? '<span class="td-dim">—</span>'
      : `<span class="${gain > 0 ? 'td-good' : 'td-dim'}">${money(q.thereBid)}${gain > 0 ? ` (+${gain}/u)` : ''}</span>`
        + (q.thereAge ? ` <span class="td-dim">${q.thereAge}d</span>` : '');
    const fits = Math.min(q.canAfford, q.holds);
    return `
    <div class="td-row">
      <div class="td-main"><b>${esc(q.name)}</b><span class="td-dim"> · ${q.kg} kg</span></div>
      <div class="td-num">${money(q.ask)}</div>
      <div class="td-num td-dim">${money(q.bid)}</div>
      <div class="td-num">${there}</div>
      <button data-cmd="market buy ${q.key} full" ${m.driving && fits > 0 ? '' : 'disabled'}
        title="${fits > 0 ? `Fills the deck: ${fits}` : 'Not enough credits, or no truck'}">Buy ${fits > 0 ? fits : ''}</button>
    </div>`;
  }).join('');
  const sell = m.cargo?.kind === 'goods'
    ? `<div class="td-sell"><button data-cmd="market sell">Sell ${esc(m.cargo.qty)} × ${esc(m.cargo.name)} here</button></div>` : '';
  return `<div class="td-rows">
    <div class="td-head"><div class="td-main">good</div><div class="td-num">buy</div><div class="td-num">sell</div><div class="td-num">${m.thereName ? esc(m.thereName) : 'there'}</div><div></div></div>
    ${rows}</div>${sell}
    <div class="td-dim td-note">Your deck holds ${m.deckKg} kg.</div>`;
}

function ensureStyles() {
  if (document.getElementById('td-styles')) return;
  const s = document.createElement('style');
  s.id = 'td-styles';
  s.textContent = `
  .td-wrap{position:fixed;inset:0;background:rgba(4,5,7,.72);display:flex;align-items:center;justify-content:center;z-index:900}
  .td-panel{width:min(880px,95vw);max-height:90vh;overflow:auto;background:#0e1114;border:1px solid #2b3138;border-radius:8px;
    padding:14px 16px 12px;font:13px/1.45 inherit;color:#cdd6e0;box-shadow:0 18px 60px rgba(0,0,0,.6)}
  .td-panel header{display:flex;align-items:center;gap:10px;border-bottom:1px solid #262c33;padding-bottom:8px}
  .td-right{margin-left:auto;color:#e8c07a;font-variant-numeric:tabular-nums}
  .td-x{background:none;border:0;color:#7c848f;font-size:15px;cursor:pointer}
  .td-x:hover{color:#e8e8e8}
  .td-deck{padding:6px 0 8px;color:#9aa3ad}
  .td-nav{display:flex;gap:4px;border-bottom:1px solid #262c33;margin-bottom:10px}
  .td-tab{background:none;border:0;border-bottom:2px solid transparent;padding:6px 12px;color:#7c848f;
    font:600 11px/1 inherit;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
  .td-tab:hover{color:#cdd6e0}
  .td-tab.on{color:#e8c07a;border-bottom-color:#e8c07a}
  .td-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
  .td-card{border:1px solid #262c33;border-radius:6px;padding:10px;background:linear-gradient(#14181d,#0f1216)}
  .td-card.here{border-color:#3b5a43}
  .td-card.away{opacity:.72}
  .td-card.poor{opacity:.55}
  .td-schem{display:block;width:100%;height:auto;margin:6px 0 2px;opacity:.92}
  .td-badge{font-size:9px;letter-spacing:.12em;color:#69727d;text-transform:uppercase}
  .td-name{font-weight:600;color:#e8e8e8;margin-top:2px}
  .td-sub,.td-blurb{color:#828c98;font-size:11.5px;margin-top:2px}
  .td-blurb{min-height:3.6em}
  .td-spec{display:flex;gap:12px;margin:8px 0 6px}
  .td-spec div{display:flex;flex-direction:column}
  .td-spec dt{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#69727d}
  .td-spec dd{margin:0;font-variant-numeric:tabular-nums}
  .td-bar{height:4px;background:#1c2126;border-radius:2px;overflow:hidden;margin:4px 0}
  .td-bar i{display:block;height:100%;background:#5c8f6a}
  .td-meta{font-size:10.5px;color:#69727d}
  .td-acts{display:flex;gap:6px;margin-top:8px}
  .td-head,.td-row{display:grid;grid-template-columns:1fr 74px 74px 132px 96px;gap:8px;align-items:center;padding:5px 0}
  .td-head{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#69727d;border-bottom:1px solid #20262c}
  .td-row+.td-row{border-top:1px solid #191e23}
  .td-main{min-width:0}
  .td-num{text-align:right;font-variant-numeric:tabular-nums}
  .td-pay{grid-column:2 / 5;text-align:right;color:#e8c07a;font-variant-numeric:tabular-nums}
  .td-none{color:#727b86;padding:10px 0}
  .td-dim{color:#727b86}
  .td-good{color:#6fcf83}
  .td-warn{color:#d8a24e}
  .td-sell{padding:10px 0 2px;text-align:right}
  .td-note{font-size:11px;padding-top:6px}
  .td-panel button:not(.td-tab){padding:5px 10px;font:600 11px/1 inherit;letter-spacing:.06em;color:#cdd6e0;
    background:#1a1f25;border:1px solid #333a43;border-radius:4px;cursor:pointer}
  .td-panel button.ghost{background:none}
  .td-panel button:not(.td-tab):hover:not(:disabled){background:#232a31;border-color:#4d5763;color:#fff}
  .td-panel button:disabled{opacity:.35;cursor:not-allowed}
  .td-panel footer{margin-top:12px;padding-top:8px;border-top:1px solid #20262c;font-size:11px}
  .td-panel code{background:#171b20;padding:1px 4px;border-radius:3px}
  @media (max-width:620px){.td-head,.td-row{grid-template-columns:1fr 60px 60px 84px}.td-row button{grid-column:1 / -1}}
  `;
  document.head.appendChild(s);
}
