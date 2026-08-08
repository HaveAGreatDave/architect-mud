// CORP COMMAND CONSOLE — the megacorp ops terminal for a player corp.
// A fullscreen overlay built on the shared minigame chassis (minigame-common.js),
// so it inherits the exact CRT look of Circuit Breach / Hololock: moulded chassis,
// bulged-glass tube, drifting grid + scan-sweep + reticles, and the threat-LED
// deck (reused here as the ARCHITECT ATTENTION gauge). Branded per-corp by
// `--mg-accent` set from the org's colour. Rendered from a server `corp_console`
// payload; live-patched by `corp_console_patch` (e.g. after a member contributes).
//
// Phase-0 data: identity / treasury / members / diplomacy render now; territory &
// directives show "comes online with the territory system" until Phase 1.

import { sfx, esc, mountOverlay, ensureChassisStyles, deviceHeader, bezelScrews, crtOverlays, deckStrip, setDeckLevel } from './minigame-common.js';
import { sendCmdSilent } from '../net.js';

let _overlay = null;
let _close = null;
let _data = null;

function ensureStyles() {
  if (document.getElementById('corp-console-styles')) return;
  const s = document.createElement('style');
  s.id = 'corp-console-styles';
  s.textContent = `
    #corp-console-overlay { --mg-accent:#35e0c8; position:fixed; inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
      background:rgba(0,3,6,0.8); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
    #corp-console-overlay .cc-panel { width:min(780px,96vw); color:var(--mg-accent);
      background:linear-gradient(180deg,#1a2226 0%,#131a1e 7%,#0c1114 12%,#060a0c 100%);
      padding:14px 16px 16px; animation:cc-boot .32s ease-out; }
    @keyframes cc-boot { 0%{opacity:0;transform:scale(.985)} 100%{opacity:1;transform:scale(1)} }
    #corp-console-overlay .cc-screen { background:radial-gradient(130% 130% at 50% 40%, color-mix(in srgb, var(--mg-accent) 9%, #030806) 55%, #01050a 100%); }
    #corp-console-overlay .cc-body { position:relative; z-index:2; display:grid; grid-template-columns:1.05fr 1.3fr 1fr; gap:13px; padding:14px 13px; font-size:0.75rem; }
    #corp-console-overlay h4 { margin:0 0 7px; font-size:0.625rem; letter-spacing:2px; text-transform:uppercase; color:var(--mg-accent);
      text-shadow:0 0 6px color-mix(in srgb, var(--mg-accent) 45%, transparent); opacity:.9; }
    #corp-console-overlay .cc-card { background:rgba(4,10,12,0.5); border:1px solid color-mix(in srgb, var(--mg-accent) 22%, #0a1418); border-radius:6px; padding:9px 10px; margin-bottom:11px; }
    #corp-console-overlay .cc-bal { font-size:1.375rem; color:#eafffb; letter-spacing:1px; text-shadow:0 0 10px color-mix(in srgb, var(--mg-accent) 55%, transparent); }
    #corp-console-overlay .cc-flow { display:flex; justify-content:space-between; margin-top:5px; font-size:0.6875rem; color:#6b8a90; }
    #corp-console-overlay .up { color:#7bffb0; } #corp-console-overlay .down { color:#ff7a86; } #corp-console-overlay .dim { color:#5a7a80; }
    #corp-console-overlay .cc-give { display:flex; gap:5px; margin-top:9px; }
    #corp-console-overlay .cc-give input { flex:1; min-width:0; background:#04090b; border:1px solid color-mix(in srgb, var(--mg-accent) 30%, transparent); color:var(--mg-accent);
      font-family:inherit; font-size:0.6875rem; padding:5px 7px; border-radius:4px; }
    #corp-console-overlay .cc-give input:focus { outline:none; box-shadow:0 0 8px color-mix(in srgb, var(--mg-accent) 35%, transparent); }
    #corp-console-overlay .cc-mem, #corp-console-overlay .cc-rel { display:flex; justify-content:space-between; align-items:center; padding:3px 0; }
    #corp-console-overlay .rank { color:#ffcf4a; font-size:0.625rem; letter-spacing:.5px; }
    #corp-console-overlay .dot { color:#7bffb0; } #corp-console-overlay .dotoff { color:#2a3a41; }
    #corp-console-overlay .war { color:#ff5a6a; } #corp-console-overlay .nap { color:#ffcf4a; } #corp-console-overlay .ally { color:#7bffb0; } #corp-console-overlay .neu { color:#6b8a90; }
    #corp-console-overlay .zrow { display:flex; justify-content:space-between; padding:3px 0; }
    #corp-console-overlay .ztag { font-size:0.5625rem; letter-spacing:1px; padding:1px 5px; border-radius:3px; color:#7bffb0; border:1px solid #244; background:#0c1a15; }
    #corp-console-overlay .ztag.t-cont { color:#ffcf4a; border-color:#3a3018; background:#1a150a; }
    #corp-console-overlay .ztag.t-hq { color:var(--mg-accent); border-color:color-mix(in srgb,var(--mg-accent) 30%,transparent); background:#0a1418; }
    #corp-console-overlay .cc-zone { margin-bottom:9px; }
    #corp-console-overlay .zhead { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:3px; }
    #corp-console-overlay .ctug { position:relative; height:10px; border-radius:5px; background:#ff5a6a; overflow:hidden; border:1px solid #000; }
    #corp-console-overlay .ctug i { display:block; height:100%; background:linear-gradient(90deg,var(--mg-accent),#7bffb0); box-shadow:0 0 6px var(--mg-accent); transition:width .3s; }
    #corp-console-overlay .cc-zone.contested .ctug { animation:cc-tug-pulse 1.5s ease-in-out infinite; }
    @keyframes cc-tug-pulse { 0%,100%{box-shadow:inset 0 0 0 1px rgba(255,207,74,.2)} 50%{box-shadow:inset 0 0 0 1px rgba(255,207,74,.9),0 0 8px rgba(255,207,74,.4)} }
    #corp-console-overlay .zpct { display:flex; justify-content:space-between; font-size:0.625rem; margin-top:2px; color:#5a7a80; }
    #corp-console-overlay .zpct .my { color:var(--mg-accent); }
    #corp-console-overlay .cc-empty { color:#4a636a; font-size:0.6875rem; line-height:1.5; }
    /* ATM-recipe button */
    #corp-console-overlay .cc-btn { padding:6px 10px; border-radius:4px; font-family:'Courier New',monospace; font-size:0.6563rem; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase; cursor:pointer;
      color:var(--mg-accent); border:1px solid color-mix(in srgb, var(--mg-accent) 55%, transparent);
      background:linear-gradient(180deg, color-mix(in srgb, var(--mg-accent) 20%, transparent), color-mix(in srgb, var(--mg-accent) 7%, transparent));
      box-shadow:inset 0 -2px 0 rgba(0,0,0,0.4); transition:filter .12s, box-shadow .12s, transform .05s; }
    #corp-console-overlay .cc-btn:hover { filter:brightness(1.2); box-shadow:0 0 14px color-mix(in srgb, var(--mg-accent) 40%, transparent), inset 0 -2px 0 rgba(0,0,0,0.4); }
    #corp-console-overlay .cc-btn:active { transform:translateY(1px); }
    #corp-console-overlay .cc-actions { display:flex; gap:8px; margin-top:9px; justify-content:flex-end; }
    #corp-console-overlay .cc-flash { animation:cc-flash .5s ease-out; }
    @keyframes cc-flash { 0%{color:#fff;text-shadow:0 0 16px var(--mg-accent)} 100%{} }
  `;
  document.head.appendChild(s);
}

function stanceClass(s) { return s === 'hostile' ? 'war' : s === 'friendly' ? 'ally' : 'neu'; }
function stanceLabel(s) { return s === 'hostile' ? '⚔ HOSTILE' : s === 'friendly' ? '✦ FRIENDLY' : '◑ NEUTRAL'; }

function renderBody() {
  const d = _data;
  const t = d.treasury || { balance: 0, income: 0, upkeep: 0 };
  const net = (t.income || 0) - (t.upkeep || 0);

  const members = (d.members || []).map(m =>
    `<div class="cc-mem"><span><span class="${m.online ? 'dot' : 'dotoff'}">${m.online ? '●' : '○'}</span> ${esc(m.handle)}</span><span class="rank">${esc(m.rank)}</span></div>`
  ).join('') || '<div class="cc-empty">No members.</div>';

  const territory = (d.territory && d.territory.length)
    ? d.territory.map(z => {
        const inf = z.influence != null ? z.influence : 100;
        const cls = z.status === 'CONTESTED' ? 't-cont' : z.status === 'HQ' ? 't-hq' : 't-held';
        const rival = z.challenger ? `<span class="rv">${esc(z.challenger)} ${100 - inf}%</span>` : '<span class="dim">—</span>';
        return `<div class="cc-zone${z.status === 'CONTESTED' ? ' contested' : ''}">
          <div class="zhead"><span>${esc(z.zone)}</span><span class="ztag ${cls}">${esc(z.status)}</span></div>
          <div class="ctug"><i style="width:${inf}%"></i></div>
          <div class="zpct"><span class="my">GRIP ${inf}%</span>${rival}</div>
        </div>`;
      }).join('')
    : '<div class="cc-empty">No territory yet.<br>Claim a contestable zone with <b>corp claim</b>.</div>';

  const directives = (d.directives && d.directives.length)
    ? d.directives.map(o => `<div class="zrow"><span>${esc(o.title)}</span><span class="dim">${esc(String(o.progress ?? ''))}</span></div>`).join('')
    : '<div class="cc-empty">No directives yet.</div>';

  const relations = (d.relations && d.relations.length)
    ? d.relations.map(r => `<div class="cc-rel"><span>${esc(r.name)}</span><span class="${stanceClass(r.stance)}">${stanceLabel(r.stance)}</span></div>`).join('')
    : '<div class="cc-empty">No standing declarations.</div>';

  const ti = d.tierInfo || {};
  const tierBlock = ti.tier ? `
      <h4>Investment</h4>
      <div class="cc-card">
        <div class="cc-flow"><span>Tier <b style="color:#eafffb">${ti.tier}</b></span>${ti.nextCost != null ? `<button class="cc-btn" data-act="invest">Invest ₵${(ti.nextCost).toLocaleString()}</button>` : '<span class="dim">max tier</span>'}</div>
        <div class="cc-flow"><span class="dim">Members</span><span>${ti.members}/${ti.memberCap}</span></div>
        <div class="cc-flow"><span class="dim">Territory</span><span>${ti.zones}/${ti.slots} zones</span></div>
      </div>` : '';

  return `<div class="cc-body">
    <div>
      <h4>Treasury</h4>
      <div class="cc-card">
        <div class="cc-bal" id="cc-bal">₵ ${(t.balance || 0).toLocaleString()}</div>
        <div class="cc-flow"><span class="up">+${t.income || 0}/day income</span></div>
        <div class="cc-flow"><span class="down">−${t.upkeep || 0}/day upkeep</span><span class="dim">net <span class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : ''}${net}</span></span></div>
        <div class="cc-give">
          <input id="cc-give-amt" type="number" min="1" placeholder="amount" />
          <button class="cc-btn" data-act="contribute">Contribute</button>
        </div>
      </div>
      ${tierBlock}
      <h4>Operatives</h4>
      <div class="cc-card">${members}</div>
    </div>
    <div>
      <h4>Territory · Influence</h4>
      <div class="cc-card">${territory}</div>
    </div>
    <div>
      <h4>Directives</h4>
      <div class="cc-card">${directives}</div>
      <h4>Diplomacy</h4>
      <div class="cc-card">${relations}</div>
    </div>
  </div>`;
}

function wireBody() {
  const contribute = () => {
    const el = _overlay.querySelector('#cc-give-amt');
    const amt = parseInt(el?.value, 10);
    if (!amt || amt <= 0) { el?.focus(); return; }
    sfx('hololock-set');
    sendCmdSilent(`corp contribute ${amt}`);
    if (el) el.value = '';
  };
  _overlay.querySelector('[data-act="contribute"]')?.addEventListener('click', contribute);
  _overlay.querySelector('#cc-give-amt')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); contribute(); } });
  _overlay.querySelector('[data-act="invest"]')?.addEventListener('click', () => { sfx('hololock-set'); sendCmdSilent('corp invest'); });
  _overlay.querySelector('[data-act="refresh"]')?.addEventListener('click', () => { sfx('hololock-entry'); sendCmdSilent('corp console'); });
}

export function openCorpConsole(msg) {
  ensureStyles();
  ensureChassisStyles();
  close();
  _data = msg;
  const tag = msg.org?.tag || 'ORG';
  const subtitle = `[${esc(tag)}] · TIER ${msg.org?.tier || 1} · ${esc(msg.you?.rank || '—')}`;
  const html =
    `<div class="cc-panel mg-chassis">
      ${deviceHeader('&#9635;', esc(msg.org?.name || 'CORP'), subtitle)}
      <div class="cc-bezel mg-bezel">${bezelScrews()}<div class="cc-screen mg-screen" style="--mg-sweep-h:420px">${renderBody()}${crtOverlays()}</div></div>
      ${deckStrip('CORP BUS', 'ARCHITECT')}
      <div class="cc-actions">
        <button class="cc-btn" data-act="refresh">Refresh</button>
      </div>
    </div>`;
  const mounted = mountOverlay({ id: 'corp-console-overlay', html, onClose: () => { _data = null; } });
  _overlay = mounted.overlay;
  _close = mounted.close;
  _overlay.style.setProperty('--mg-accent', msg.accent || '#35e0c8');
  _overlay.querySelector('.mg-close').addEventListener('click', close);
  wireBody();
  window.AudioEngine?.init?.();
  sfx('hololock-entry');
  setDeckLevel(_overlay, (msg.architectHeat || 0) / 100);
}

// Live patch (server pushes on treasury/roster change to online members).
export function updateCorpConsole(patch) {
  if (!_overlay || !_data) return;
  if (patch.treasury) _data.treasury = patch.treasury;
  if (patch.members) _data.members = patch.members;
  if (patch.territory) _data.territory = patch.territory;
  if (patch.tierInfo) _data.tierInfo = patch.tierInfo;
  if (patch.architectHeat != null) _data.architectHeat = patch.architectHeat;
  const screen = _overlay.querySelector('.cc-screen');
  if (screen) {
    // Re-render body in place, preserving the CRT overlay layers.
    const overlays = screen.querySelector('.mg-crt-grid') ? crtOverlays() : '';
    screen.innerHTML = renderBody() + overlays;
    wireBody();
    const bal = _overlay.querySelector('#cc-bal');
    if (bal) bal.classList.add('cc-flash');
  }
  setDeckLevel(_overlay, (_data.architectHeat || 0) / 100);
}

export function closeCorpConsole() { close(); }

function close() {
  if (_close) { _close(); _close = null; }
  _overlay = null;
}
