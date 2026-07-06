// The visual HANGAR — a centered modal (poker/trade "server renders the data,
// client draws" pattern). The server (flight/hangars.js) pushes a roster of the
// player's aircraft at this field plus the paint catalogs; this client draws each
// as a tinted top-down silhouette and runs the paint bay: hex pickers + one-click
// presets for exterior (base/trim/pattern/finish) and interior (cabin/upholstery),
// a live LOW↔HIGH signature meter, and per-craft embark/store/pull.
//
// Paint is previewed entirely client-side; only APPLY commits, sending a single
// `paintset` command. Signature is computed here from the catalog's sig weights so
// the meter tracks the pickers with no round-trip.
import { sendCmdSilent } from '../net.js';

let overlay = null;
let DATA = null;     // last server payload { field, hasBay, credits, craft[], catalog }
let selId = null;    // selected aircraft id
let work = null;     // working (uncommitted) livery copy for the selected craft

export function initHangarPanel() {
  if (overlay) return;
  ensureStyles();
  overlay = document.createElement('div');
  overlay.id = 'hangar-overlay';
  overlay.innerHTML = '<div id="hangar-box"><div id="hangar-body"></div></div>';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);
  // Close on backdrop click.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHangar(); });
}

export function updateHangar(data) {
  if (!overlay) initHangarPanel();
  DATA = data || {};
  const craft = DATA.craft || [];
  // Keep the current selection if it survived; else pick the first paintable, else first.
  if (!craft.find(c => c.id === selId)) {
    const first = craft.find(c => c.paintable) || craft[0];
    selId = first ? first.id : null;
    work = first ? { ...first.livery } : null;
  } else if (!work) {
    const c = craft.find(x => x.id === selId);
    work = c ? { ...c.livery } : null;
  }
  render();
  overlay.style.display = 'flex';
}

export function closeHangar() { if (overlay) overlay.style.display = 'none'; }

// ── Selection / edits ─────────────────────────────────────────────────────────
function selCraft() { return (DATA?.craft || []).find(c => c.id === selId) || null; }
function selectCraft(id) {
  selId = id;
  const c = selCraft();
  work = c ? { ...c.livery } : null;
  render();
}
function edit(field, val) { if (!work) return; work[field] = val; render(); }
function applyPreset(p) {
  if (!work) return;
  work = { ...work, base: p.base, trim: p.trim, pattern: p.pattern, finish: p.finish, cabin: p.cabin, uphol: p.uphol };
  render();
}
function apply() {
  const c = selCraft(); if (!c || !work) return;
  sendCmdSilent(`paintset ${c.id} ${work.base} ${work.trim} ${work.pattern} ${work.finish} ${work.cabin} ${work.uphol} ${work.decal || 'none'}`);
  // Server re-pushes the panel with the saved state; nothing else to do here.
}
function revert() { const c = selCraft(); if (c) { work = { ...c.livery }; render(); } }

// ── Signature (mirrors livery.js so the meter tracks the pickers live) ─────────
function lum(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 0.4;
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
function sigMult(lv) {
  const cat = DATA?.catalog || {};
  const pat = (cat.patterns || []).find(p => p.id === lv.pattern)?.sig ?? 1;
  const fin = (cat.finishes || []).find(f => f.id === lv.finish)?.sig ?? 1;
  const m = (0.85 + lum(lv.base) * 0.30) * pat * fin;
  return Math.max(0.75, Math.min(1.25, m));
}
function sigScore(lv) { return Math.round((sigMult(lv) - 0.75) / 0.5 * 100); }

// ── Silhouettes (top-down, nose up). Base = var(--b), trim = var(--t). ─────────
// Pattern draws trim accents; finish is a CSS class on the wrapper (gloss adds a
// highlight, matte flattens, weathered grimes + desaturates).
// NB: SVG presentation attributes don't resolve CSS var() — so we interpolate the
// literal hex straight into fill/stroke. Only the finish sheen/filter is CSS-driven.
function pattern(lv) {
  // Trim-accent overlay for a fixed-wing fuselage centered at x=100, spanning
  // y≈40..150 with the wing box at y≈78..104. Generic across the fixed-wing classes.
  const t = lv.trim;
  switch (lv.pattern) {
    case 'solid':    return `<rect x="92" y="34" width="16" height="14" rx="6" fill="${t}"/><rect x="70" y="140" width="60" height="9" rx="3" fill="${t}"/>`;
    case 'twotone':  return `<path d="M100 30 L118 96 L82 96 Z" fill="${t}" opacity="0.9"/>`;
    case 'stripes':  return `<rect x="94" y="34" width="4" height="120" fill="${t}"/><rect x="102" y="34" width="4" height="120" fill="${t}"/>`;
    case 'splinter': return `<path d="M60 82 L92 78 L88 104 L58 100 Z" fill="${t}" opacity="0.85"/><path d="M140 82 L108 78 L112 104 L142 100 Z" fill="${t}" opacity="0.85"/><path d="M92 120 L108 120 L104 150 L96 150 Z" fill="${t}" opacity="0.7"/>`;
    case 'hazard':   return `<g fill="${t}">${[0,1,2].map(i => `<path d="M${52+i*30} 84 l10 0 l-6 14 l-10 0 Z"/><path d="M${118-i*30} 84 l10 0 l-6 14 l-10 0 Z"/>`).join('')}</g>`;
    default:         return '';   // bare
  }
}
function canopy(lv) {
  // Glass reads dark; on 'solid' it takes the trim colour as a painted spine.
  const fill = lv.pattern === 'solid' ? lv.trim : '#0e1a24';
  return `<ellipse cx="100" cy="62" rx="7" ry="13" fill="${fill}" opacity="0.9"/>`;
}
function fixedWing(lv, { span = 150, chord = 26, fLen = 110, fW = 20, engines = 0 } = {}) {
  const b = lv.base, t = lv.trim;
  const wingY = 82, x0 = 100 - span / 2, x1 = 100 + span / 2;
  const nacX = engines <= 2 ? [100 - span * 0.24, 100 + span * 0.24].slice(0, engines)
                            : [100 - span * 0.18, 100 - span * 0.34, 100 + span * 0.18, 100 + span * 0.34];
  const nac = nacX.map(x => `<rect x="${x - 4}" y="${wingY - 4}" width="8" height="20" rx="2" fill="${t}"/>`).join('');
  return `
    <rect x="${100 - fW / 2}" y="${100 - fLen / 2}" width="${fW}" height="${fLen}" rx="${fW / 2}" fill="${b}"/>
    <path d="M${x0} ${wingY + chord} L${x1} ${wingY + chord} L${100 + fW / 2 + 4} ${wingY - 4} L${100 - fW / 2 - 4} ${wingY - 4} Z" fill="${b}"/>
    <path d="M74 148 L126 148 L112 136 L88 136 Z" fill="${b}"/>
    <polygon points="100,30 ${100 - fW / 2 + 3},46 ${100 + fW / 2 - 3},46" fill="${b}"/>
    ${nac}${pattern(lv)}${canopy(lv)}`;
}
function heli(lv) {
  const b = lv.base, t = lv.trim;
  return `
    <circle cx="100" cy="92" r="82" fill="none" stroke="${t}" stroke-width="1.5" opacity="0.35"/>
    <rect x="86" y="58" width="28" height="70" rx="14" fill="${b}"/>
    <rect x="96" y="126" width="8" height="52" rx="4" fill="${b}"/>
    <rect x="90" y="172" width="20" height="6" rx="3" fill="${t}"/>
    <rect x="60" y="90" width="80" height="5" fill="${t}" opacity="0.9"/>
    <rect x="97" y="52" width="6" height="80" fill="${t}" opacity="0.9" transform="rotate(58 100 92)"/>
    ${pattern(lv)}
    <ellipse cx="100" cy="72" rx="9" ry="11" fill="#0e1a24" opacity="0.9"/>`;
}
function wreck(lv) {
  const b = lv.base;
  return `<g opacity="0.75" filter="url(#hg-wreck)">
    <rect x="90" y="48" width="20" height="96" rx="10" fill="${b}"/>
    <path d="M34 96 L96 80 L104 80 L120 92 L96 100 Z" fill="${b}"/>
    <path d="M108 84 L150 70 L146 92 Z" fill="${b}" opacity="0.5"/>
    <path d="M74 148 L120 148 L110 138 L86 138 Z" fill="${b}"/>
  </g><text x="100" y="180" fill="#9bd06a" font-size="9" text-anchor="middle" font-family="monospace" letter-spacing="2">WRECK</text>`;
}
function silhouette(cls, lv) {
  switch (cls) {
    case 'heli':       return heli(lv);
    case 'wreck':      return wreck(lv);
    case 'ultralight': return fixedWing(lv, { span: 160, chord: 12, fLen: 92, fW: 13, engines: 0 });
    case 'heavy':      return fixedWing(lv, { span: 184, chord: 30, fLen: 140, fW: 30, engines: 4 });
    case 'gunship':    return fixedWing(lv, { span: 128, chord: 22, fLen: 122, fW: 19, engines: 2 });
    default:           return fixedWing(lv, { span: 150, chord: 26, fLen: 112, fW: 20, engines: 2 });   // prop
  }
}
// Nose art / decals — a crisp top layer (drawn outside the finish-affected body).
function decalLayer(lv) {
  switch (lv.decal) {
    case 'sharkmouth': return `<g>
      <path d="M87 45 Q100 61 113 45 L113 51 Q100 65 87 51 Z" fill="#c0242a"/>
      <path d="M88 49 l4 6 l4 -6 l4 6 l4 -6 l4 6 l4 -6 v-2 h-24 z" fill="#f2f4f6"/>
      <circle cx="93" cy="43" r="2.2" fill="#f2f4f6"/><circle cx="107" cy="43" r="2.2" fill="#f2f4f6"/></g>`;
    case 'killmarks':  return `<g fill="#e8e8e8">${[0, 1, 2, 3].map(i => `<rect x="113" y="${58 + i * 4}" width="6" height="2.4"/>`).join('')}</g>`;
    case 'sigil':      return `<g transform="translate(100 142)"><circle r="7" fill="none" stroke="#ffcf3e" stroke-width="1.5"/>
      <path d="M0 -5 L1.5 -1.5 L5 -1.5 L2 1 L3 5 L0 2.5 L-3 5 L-2 1 L-5 -1.5 L-1.5 -1.5 Z" fill="#ffcf3e"/></g>`;
    default:           return '';
  }
}
function craftSvg(cls, lv, size = 200) {
  return `<svg viewBox="0 0 200 200" class="hg-svg hg-fin-${lv.finish}" style="width:${size}px;height:${size}px">
    <defs><filter id="hg-wreck"><feColorMatrix type="saturate" values="0.4"/></filter>
      <linearGradient id="hg-gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,0.35)"/><stop offset="0.5" stop-color="rgba(255,255,255,0)"/></linearGradient></defs>
    <g class="hg-body">${silhouette(cls, lv)}</g>
    ${cls !== 'wreck' ? decalLayer(lv) : ''}
    <rect class="hg-sheen" x="0" y="0" width="200" height="200" fill="url(#hg-gloss)"/>
  </svg>`;
}

// Interior cross-section: a cabin box + seats coloured by upholstery, panel in cabin colour.
function cabinSvg(lv, seats = 1) {
  const uphColor = { standard: '#4a4f57', leather: '#6b3a2a', quilted: '#3a4a6b', mesh: '#22262b' }[lv.uphol] || '#4a4f57';
  const n = Math.max(1, Math.min(3, seats || 1));
  const seatEls = Array.from({ length: n }, (_, i) => {
    const x = 100 + (i - (n - 1) / 2) * 34;
    return `<rect x="${x - 12}" y="70" width="24" height="30" rx="5" fill="${uphColor}" stroke="#0008"/><rect x="${x - 12}" y="62" width="24" height="12" rx="4" fill="${uphColor}" stroke="#0008"/>`;
  }).join('');
  return `<svg viewBox="0 0 200 140" class="hg-svg" style="width:100%;height:120px">
    <rect x="26" y="30" width="148" height="92" rx="14" fill="${lv.cabin}" stroke="#0006"/>
    <rect x="34" y="34" width="132" height="20" rx="6" fill="#0e1a24" opacity="0.85"/>
    ${seatEls}
    <text x="100" y="132" fill="#8fb0c6" font-size="9" text-anchor="middle" font-family="monospace" letter-spacing="1">CABIN · ${(lv.uphol || 'standard').toUpperCase()}</text>
  </svg>`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function locBadge(c) {
  if (c.wreck) return '<span class="hg-badge hg-b-wreck">WRECK</span>';
  if (c.rental) return '<span class="hg-badge hg-b-rent">RENTAL</span>';
  if (c.location === 'hangar') return '<span class="hg-badge hg-b-bay">IN BAY</span>';
  return '<span class="hg-badge hg-b-ramp">ON RAMP</span>';
}
function card(c) {
  const sel = c.id === selId ? ' hg-card-sel' : '';
  return `<div class="hg-card${sel}" data-sel="${c.id}">
    <div class="hg-card-art">${craftSvg(c.class, c.livery, 78)}</div>
    <div class="hg-card-meta">
      <div class="hg-card-tail">${esc(c.tail)}</div>
      <div class="hg-card-type">${esc(c.typeName)} ${locBadge(c)}</div>
      <div class="hg-bars">
        <span class="hg-bar"><i style="width:${c.hullPct}%;background:${c.hullPct <= 25 ? '#ff5b5b' : c.hullPct <= 55 ? '#ffb23e' : '#46e05a'}"></i></span>
        <span class="hg-bar"><i style="width:${c.fuelPct}%;background:#4fb8e0"></i></span>
      </div>
    </div>
  </div>`;
}
function swatchRow(label, field) {
  return `<label class="hg-ctl"><span>${label}</span><input type="color" data-color="${field}" value="${work[field]}"></label>`;
}
function selectRow(label, field, opts) {
  return `<label class="hg-ctl"><span>${label}</span><select data-sel-field="${field}">${
    opts.map(o => `<option value="${o.id}"${o.id === work[field] ? ' selected' : ''}>${o.label}</option>`).join('')
  }</select></label>`;
}
function render() {
  const body = document.getElementById('hangar-body'); if (!body) return;
  const craft = DATA?.craft || [];
  const cat = DATA?.catalog || { patterns: [], finishes: [], uphol: [], presets: [] };
  const c = selCraft();

  const roster = craft.length
    ? craft.map(card).join('')
    : '<div class="hg-empty">No aircraft of yours at this field.<br>Buy one at a dealer, or fly one in.</div>';

  let editor = '<div class="hg-empty">Select an aircraft.</div>';
  if (c && work) {
    const score = sigScore(work);
    const paintable = c.paintable;
    const dirty = JSON.stringify(work) !== JSON.stringify(c.livery);
    editor = `
      <div class="hg-preview">${craftSvg(c.class, work, 190)}</div>
      <div class="hg-sig">
        <div class="hg-sig-lbl">SIGNATURE <span class="hg-dim">how easily you're spotted</span></div>
        <div class="hg-sig-bar"><i style="left:${score}%"></i></div>
        <div class="hg-sig-ends"><span>LOW · stealthy</span><span>HIGH · exposed</span></div>
      </div>
      ${paintable ? `
      <div class="hg-presets">${(cat.presets || []).map(p => `<button class="hg-preset" data-preset="${p.id}"><span class="hg-chip" style="background:${p.base};box-shadow:inset 0 0 0 3px ${p.trim}"></span>${p.label}</button>`).join('')}</div>
      <div class="hg-section">EXTERIOR</div>
      <div class="hg-ctls">
        ${swatchRow('Base', 'base')}${swatchRow('Trim', 'trim')}
        ${selectRow('Pattern', 'pattern', cat.patterns)}${selectRow('Finish', 'finish', cat.finishes)}
        ${selectRow('Nose art', 'decal', cat.decals || [])}
      </div>
      <div class="hg-section">INTERIOR</div>
      <div class="hg-cabin">${cabinSvg(work, c.seats)}</div>
      <div class="hg-ctls">
        ${swatchRow('Cabin', 'cabin')}${selectRow('Upholstery', 'uphol', cat.uphol)}
      </div>
      <div class="hg-apply-row">
        <button class="hg-btn hg-apply" data-act="apply"${dirty ? '' : ' disabled'}>Apply · ${c.paintCost}c</button>
        <button class="hg-btn" data-act="revert"${dirty ? '' : ' disabled'}>Revert</button>
      </div>
      <div class="hg-section">SCHEMES</div>
      <div class="hg-schemes">${(c.schemes || []).length
        ? c.schemes.map(s => `<span class="hg-scheme"><button class="hg-scheme-load" data-scheme-load="${esc(s.name)}"><span class="hg-chip" style="background:${s.base};box-shadow:inset 0 0 0 3px ${s.trim}"></span>${esc(s.name)}</button><button class="hg-scheme-del" data-scheme-del="${esc(s.name)}" title="delete">✕</button></span>`).join('')
        : '<span class="hg-dim">none saved yet</span>'}</div>
      <div class="hg-scheme-save">
        <input id="hg-scheme-name" placeholder="scheme name" maxlength="16">
        <button class="hg-btn" data-act="scheme-save"${dirty ? ' disabled title="Apply your paint first"' : ''}>Save current look</button>
      </div>` : `<div class="hg-note">${c.wreck ? 'A wreck — nothing worth painting.' : c.rental ? 'Rentals can\'t be painted.' : 'You can only paint an aircraft you own.'}</div>`}
      <div class="hg-actions">
        ${!c.wreck ? `<button class="hg-btn hg-embark" data-act="embark" data-id="${c.id}" data-tail="${esc(c.tail)}">Embark</button>` : ''}
        ${DATA.hasBay && !c.wreck && c.location === 'ramp' ? `<button class="hg-btn" data-act="store" data-id="${c.id}">Store in bay</button>` : ''}
        ${DATA.hasBay && c.location === 'hangar' ? `<button class="hg-btn" data-act="pull" data-id="${c.id}">Roll out</button>` : ''}
      </div>`;
  }

  body.innerHTML = `
    <div class="hg-head"><span class="hg-title">✈ HANGAR — ${esc(DATA.field || '')}</span>
      <span class="hg-credits">₵ ${DATA.credits ?? 0}</span>
      <button class="hg-x" data-act="close">✕</button></div>
    <div class="hg-grid">
      <div class="hg-roster">${roster}</div>
      <div class="hg-editor">${editor}</div>
    </div>`;
  wire();
}

function wire() {
  const body = document.getElementById('hangar-body'); if (!body) return;
  body.querySelectorAll('[data-sel]').forEach(el => el.addEventListener('click', () => selectCraft(el.getAttribute('data-sel'))));
  body.querySelectorAll('[data-color]').forEach(el => el.addEventListener('input', () => edit(el.getAttribute('data-color'), el.value)));
  body.querySelectorAll('[data-sel-field]').forEach(el => el.addEventListener('change', () => edit(el.getAttribute('data-sel-field'), el.value)));
  body.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', () => {
    const p = (DATA.catalog.presets || []).find(x => x.id === el.getAttribute('data-preset')); if (p) applyPreset(p);
  }));
  body.querySelectorAll('[data-scheme-load]').forEach(el => el.addEventListener('click', () => sendCmdSilent(`scheme load ${el.getAttribute('data-scheme-load')}`)));
  body.querySelectorAll('[data-scheme-del]').forEach(el => el.addEventListener('click', () => sendCmdSilent(`scheme delete ${el.getAttribute('data-scheme-del')}`)));
  body.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
    const act = el.getAttribute('data-act');
    if (act === 'close') return closeHangar();
    if (act === 'apply') return apply();
    if (act === 'revert') return revert();
    if (act === 'scheme-save') { const n = (document.getElementById('hg-scheme-name')?.value || '').trim(); if (n) sendCmdSilent(`scheme save ${n}`); return; }
    if (act === 'embark') { sendCmdSilent(`board ${el.getAttribute('data-tail')}`); return closeHangar(); }
    if (act === 'store') return sendCmdSilent(`hangaract store ${el.getAttribute('data-id')}`);
    if (act === 'pull') return sendCmdSilent(`hangaract pull ${el.getAttribute('data-id')}`);
  }));
}

function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])); }

// ── Styles ────────────────────────────────────────────────────────────────────
function ensureStyles() {
  if (document.getElementById('hangar-styles')) return;
  const st = document.createElement('style'); st.id = 'hangar-styles';
  st.textContent = `
  #hangar-overlay { position:fixed; inset:0; z-index:9300; display:flex; align-items:center; justify-content:center;
    background:rgba(0,4,7,0.82); backdrop-filter:blur(3px); font-family:'Courier New',monospace; }
  #hangar-box { width:min(880px,96vw); max-height:92vh; overflow:hidden; color:#a9d4ec;
    background:linear-gradient(180deg,#232b33,#12171c 60%,#0a0e12); border:1px solid #05080b; border-radius:10px;
    box-shadow:0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06); }
  #hangar-body { display:flex; flex-direction:column; max-height:92vh; }
  .hg-head { display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid #2a3540; }
  .hg-title { color:#eaf6ff; font-weight:bold; letter-spacing:2px; }
  .hg-credits { margin-left:auto; color:#ffcf3e; letter-spacing:1px; }
  .hg-x { background:none; border:1px solid #2a3540; color:#8fb0c6; border-radius:5px; cursor:pointer; padding:2px 9px; }
  .hg-x:hover { background:#1a2730; }
  .hg-grid { display:flex; gap:0; min-height:0; overflow:hidden; }
  .hg-roster { width:260px; flex:0 0 260px; overflow-y:auto; padding:10px; border-right:1px solid #2a3540; display:flex; flex-direction:column; gap:8px; }
  .hg-editor { flex:1 1 auto; overflow-y:auto; padding:12px 16px; min-width:0; }
  .hg-card { display:flex; gap:10px; padding:8px; border-radius:8px; cursor:pointer; border:1px solid transparent;
    background:linear-gradient(160deg,#2a333c,#161c22 70%); align-items:center; }
  .hg-card:hover { border-color:#39434d; }
  .hg-card-sel { border-color:var(--accent,#4fb8e0); box-shadow:0 0 0 1px var(--accent,#4fb8e0); }
  .hg-card-art { flex:0 0 78px; height:78px; display:flex; align-items:center; justify-content:center; }
  .hg-card-meta { min-width:0; flex:1; }
  .hg-card-tail { color:#eaf6ff; font-weight:bold; letter-spacing:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .hg-card-type { font-size:11px; color:#7fae99; margin:2px 0 6px; }
  .hg-badge { font-size:8px; letter-spacing:1px; padding:1px 5px; border-radius:3px; margin-left:4px; }
  .hg-b-ramp { background:#14324a; color:#7fc0ff; } .hg-b-bay { background:#143a2a; color:#6fe0a0; }
  .hg-b-rent { background:#3a3414; color:#e0c86f; } .hg-b-wreck { background:#3a1a14; color:#e08a6f; }
  .hg-bars { display:flex; gap:5px; }
  .hg-bar { flex:1; height:5px; background:#0a1620; border-radius:3px; overflow:hidden; }
  .hg-bar i { display:block; height:100%; }
  .hg-preview { display:flex; justify-content:center; padding:4px 0 8px; }
  .hg-svg { display:block; }
  .hg-fin-matte .hg-sheen { display:none; }
  .hg-fin-satin .hg-sheen { opacity:0.35; }
  .hg-fin-gloss .hg-sheen { opacity:1; }
  .hg-fin-weathered .hg-body { filter:saturate(0.7) brightness(0.92); } .hg-fin-weathered .hg-sheen { display:none; }
  .hg-sig { margin:2px 0 12px; }
  .hg-sig-lbl { font-size:9px; letter-spacing:2px; color:#8fb0c6; margin-bottom:4px; }
  .hg-dim { color:#5f8299; letter-spacing:0; }
  .hg-sig-bar { position:relative; height:8px; border-radius:5px; background:linear-gradient(90deg,#2f6d4a,#ffb23e,#ff5b5b); }
  .hg-sig-bar i { position:absolute; top:-3px; width:4px; height:14px; background:#eaf6ff; border-radius:2px; box-shadow:0 0 5px #000; transform:translateX(-50%); transition:left .15s; }
  .hg-sig-ends { display:flex; justify-content:space-between; font-size:8px; color:#5f8299; margin-top:3px; letter-spacing:1px; }
  .hg-presets { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .hg-preset { display:flex; align-items:center; gap:6px; font-size:10px; letter-spacing:1px; color:#a9d4ec; cursor:pointer;
    background:#161c22; border:1px solid #2a3540; border-radius:6px; padding:4px 8px; font-family:inherit; }
  .hg-preset:hover { border-color:#4fb8e0; }
  .hg-chip { width:14px; height:14px; border-radius:3px; display:inline-block; }
  .hg-section { font-size:9px; letter-spacing:3px; color:#5f8299; margin:10px 0 6px; border-bottom:1px solid #1e2833; padding-bottom:3px; }
  .hg-ctls { display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; }
  .hg-ctl { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; color:#a9d4ec; letter-spacing:1px; }
  .hg-ctl input[type=color] { width:44px; height:26px; padding:0; border:1px solid #2a3540; border-radius:5px; background:none; cursor:pointer; }
  .hg-ctl select { flex:1; max-width:120px; background:#0a1620; color:#a9d4ec; border:1px solid #2a3540; border-radius:5px; padding:4px; font-family:inherit; }
  .hg-cabin { display:flex; justify-content:center; margin:4px 0; }
  .hg-apply-row, .hg-actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
  .hg-btn { font-family:inherit; font-size:11px; letter-spacing:1px; color:#a9d4ec; cursor:pointer; padding:7px 12px;
    background:linear-gradient(160deg,#2a333c,#12171c); border:1px solid #2a3540; border-radius:6px; }
  .hg-btn:hover:not(:disabled) { border-color:#4fb8e0; color:#eaf6ff; }
  .hg-btn:disabled { opacity:0.4; cursor:default; }
  .hg-apply { border-color:#2f6d4a; color:#8fe0b0; } .hg-apply:hover:not(:disabled) { border-color:#46e05a; }
  .hg-embark { border-color:#3f6d8c; }
  .hg-schemes { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .hg-scheme { display:inline-flex; align-items:center; background:#161c22; border:1px solid #2a3540; border-radius:6px; overflow:hidden; }
  .hg-scheme-load { display:flex; align-items:center; gap:6px; font-size:10px; letter-spacing:1px; color:#a9d4ec; cursor:pointer; background:none; border:none; padding:4px 6px 4px 8px; font-family:inherit; }
  .hg-scheme-load:hover { color:#eaf6ff; }
  .hg-scheme-del { background:none; border:none; border-left:1px solid #2a3540; color:#5f8299; cursor:pointer; padding:4px 7px; font-family:inherit; }
  .hg-scheme-del:hover { color:#ff5b5b; }
  .hg-scheme-save { display:flex; gap:8px; }
  .hg-scheme-save input { flex:0 0 120px; background:#0a1620; color:#a9d4ec; border:1px solid #2a3540; border-radius:5px; padding:5px 8px; font-family:inherit; }
  .hg-note, .hg-empty { color:#5f8299; font-size:12px; text-align:center; padding:20px 10px; line-height:1.6; }
  @media (max-width:620px) { .hg-grid { flex-direction:column; } .hg-roster { width:auto; flex:0 0 auto; flex-direction:row; border-right:none; border-bottom:1px solid #2a3540; } .hg-ctls { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(st);
}
