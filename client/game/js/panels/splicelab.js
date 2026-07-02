// SPLICE DESIGNER — the master-tier compound splicer UI.
//
// Opened by the `splice_designer` server message (the `splice` command). You
// pick a BASE drug (contributes all its effect blocks) and graft specific
// blocks (instant / phases / hallucination) from your other drugs onto it, name
// the result, and read the live risk/difficulty preview (server-computed via
// `splicepreview`). "Synthesize" fires `splicebegin <payload>` → the server
// validates + opens the (much harder) stabilize minigame. Consumes a dose of
// each source drug + a Stabilizer on resolve.

import { sendCmdSilent } from '../net.js';

let _overlay = null, _drugs = [], _base = null, _grafts = new Set(), _hasStab = false, _previewTimer = null;

function ensureStyles() {
  if (document.getElementById('splice-lab-styles')) return;
  const s = document.createElement('style');
  s.id = 'splice-lab-styles';
  s.textContent = `
  #splice-lab-overlay { position:fixed; inset:0; z-index:9995; display:flex; align-items:center; justify-content:center;
    background:rgba(2,6,4,0.82); backdrop-filter:blur(2px); font-family:var(--font-mono,monospace); }
  #splice-lab-overlay .sp-panel { background:#08110c; border:1px solid #1c3a24; border-radius:5px; padding:16px 18px;
    width:min(760px,95vw); max-height:90vh; overflow:hidden; box-shadow:0 0 44px rgba(40,220,120,0.16); display:flex; flex-direction:column; }
  #splice-lab-overlay .sp-title { color:#4fe08a; letter-spacing:2px; font-size:14px; }
  #splice-lab-overlay .sp-sub { color:#6f8f7a; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin:2px 0 10px; }
  #splice-lab-overlay .sp-cols { display:flex; gap:14px; overflow:hidden; }
  #splice-lab-overlay .sp-left { flex:1.3; overflow-y:auto; max-height:56vh; padding-right:6px; }
  #splice-lab-overlay .sp-right { flex:1; display:flex; flex-direction:column; gap:8px; }
  #splice-lab-overlay .sp-drug { border:1px solid #143020; border-radius:3px; padding:8px 10px; margin-bottom:8px; background:#0a140d; }
  #splice-lab-overlay .sp-drug.base { border-color:#4fe08a; box-shadow:0 0 10px rgba(80,240,150,0.15); }
  #splice-lab-overlay .sp-drug h4 { margin:0 0 4px; color:#cfe9d8; font-size:12px; display:flex; align-items:center; gap:8px; }
  #splice-lab-overlay label { color:#9fc7ac; font-size:11px; display:flex; gap:6px; align-items:flex-start; margin:3px 0; cursor:pointer; }
  #splice-lab-overlay label input { margin-top:2px; }
  #splice-lab-overlay .sp-blk { color:#7f9f8a; }
  #splice-lab-overlay .sp-included { color:#4fe08a; font-size:10px; }
  #splice-lab-overlay input[type=text] { width:100%; background:#050a07; border:1px solid #1c3a24; color:#cfe9d8; padding:6px 8px; border-radius:3px; font-family:inherit; }
  #splice-lab-overlay .sp-preview { border:1px solid #143020; border-radius:3px; padding:10px; background:#0a140d; font-size:11px; color:#9fc7ac; flex:1; overflow-y:auto; }
  #splice-lab-overlay .sp-diff { color:#e0b64f; } #splice-lab-overlay .sp-warn { color:#e0644f; }
  #splice-lab-overlay .sp-bar { height:8px; background:#102018; border-radius:4px; overflow:hidden; margin:6px 0; }
  #splice-lab-overlay .sp-bar > div { height:100%; background:linear-gradient(90deg,#4fe08a,#e0b64f,#e0644f); }
  #splice-lab-overlay .sp-actions { display:flex; gap:8px; }
  #splice-lab-overlay button.sp-btn { flex:1; background:#12241a; border:1px solid #245a38; color:#cfe9d8; padding:8px; border-radius:3px; cursor:pointer; font-family:inherit; }
  #splice-lab-overlay button.sp-btn.go { background:#1c5a34; border-color:#4fe08a; color:#eafff2; }
  #splice-lab-overlay button.sp-btn:disabled { opacity:0.4; cursor:not-allowed; }
  #splice-lab-overlay pre { white-space:pre-wrap; margin:6px 0 0; color:#cfe9d8; font-size:11px; }
  `;
  document.head.appendChild(s);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b64 = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));

export function openSpliceDesigner(msg) {
  ensureStyles();
  closeSplice();
  _drugs = msg.drugs || [];
  _hasStab = !!msg.hasStabilizer;
  _base = null; _grafts = new Set();

  const overlay = document.createElement('div');
  overlay.id = 'splice-lab-overlay';
  overlay.innerHTML = `
    <div class="sp-panel">
      <div class="sp-title">⚗ COMPOUND SPLICER</div>
      <div class="sp-sub">graft effects from your drugs onto a base — chemistry ${msg.minSkill}+ · real lab only${_hasStab ? '' : ' · ⚠ NO STABILIZER'}</div>
      <div class="sp-cols">
        <div class="sp-left" id="sp-left"></div>
        <div class="sp-right">
          <input type="text" id="sp-name" placeholder="name your compound (optional)" maxlength="40">
          <div class="sp-preview" id="sp-preview">Pick a base drug to begin.</div>
          <div class="sp-actions">
            <button class="sp-btn go" id="sp-go" disabled>Synthesize</button>
            <button class="sp-btn" id="sp-cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  _overlay = overlay;
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeSplice(); });
  overlay.querySelector('#sp-cancel').addEventListener('click', closeSplice);
  overlay.querySelector('#sp-go').addEventListener('click', _synth);
  window.addEventListener('keydown', _escHandler);
  renderDrugs();
}

function _escHandler(e) { if (e.key === 'Escape') closeSplice(); }

function renderDrugs() {
  const left = _overlay.querySelector('#sp-left');
  left.innerHTML = _drugs.map(d => {
    const isBase = _base === d.drug;
    const blockRows = Object.entries(d.blocks).map(([blk, summary]) => {
      if (isBase) return `<div class="sp-blk sp-included">◆ ${blk}: ${esc(summary)} <span class="sp-included">(base — included)</span></div>`;
      const key = `${d.drug}|${blk}`;
      const on = _grafts.has(key);
      return `<label><input type="checkbox" data-key="${key}" ${on ? 'checked' : ''}> <span class="sp-blk">${blk}: ${esc(summary)}</span></label>`;
    }).join('');
    return `<div class="sp-drug ${isBase ? 'base' : ''}">
      <h4><label style="margin:0"><input type="radio" name="sp-base" ${isBase ? 'checked' : ''} data-base="${d.drug}"> ${esc(d.name)}</label></h4>
      ${blockRows}
    </div>`;
  }).join('');

  left.querySelectorAll('input[data-base]').forEach(r => r.addEventListener('change', () => {
    _base = r.dataset.base;
    // Drop any grafts that belong to the new base.
    for (const k of [..._grafts]) if (k.startsWith(_base + '|')) _grafts.delete(k);
    renderDrugs(); requestPreview();
  }));
  left.querySelectorAll('input[data-key]').forEach(c => c.addEventListener('change', () => {
    if (c.checked) _grafts.add(c.dataset.key); else _grafts.delete(c.dataset.key);
    requestPreview();
  }));

  _overlay.querySelector('#sp-go').disabled = !_base || !_hasStab;
}

function _payload(withName) {
  const grafts = [..._grafts].map(k => { const [drug, block] = k.split('|'); return { drug, block }; });
  const p = { base: _base, grafts };
  if (withName) p.name = (_overlay.querySelector('#sp-name').value || '').trim();
  return p;
}

function requestPreview() {
  if (!_base) return;
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(() => sendCmdSilent('splicepreview ' + b64(_payload(false))), 180);
}

// Called from dispatch on `splice_preview`.
export function updateSplicePreview(msg) {
  if (!_overlay) return;
  const el = _overlay.querySelector('#sp-preview');
  if (!el) return;
  if (!msg.ok) { el.innerHTML = 'Pick a base drug to begin.'; return; }
  const instPct = Math.round((msg.instability || 0) * 100);
  const warns = (msg.warnings || []).map(w => `<div class="sp-warn">⚠ ${esc(w)}</div>`).join('');
  el.innerHTML = `
    <div class="sp-diff">Difficulty: ${msg.difficulty}</div>
    <div>Instability: ${instPct}%</div>
    <div class="sp-bar"><div style="width:${instPct}%"></div></div>
    <div>Overdoses at ${msg.odThreshold} · counts as ${msg.doseWeight} dose${msg.doseWeight > 1 ? 's' : ''}</div>
    ${warns}
    <pre>${esc(msg.summary || '')}</pre>`;
}

function _synth() {
  if (!_base || !_hasStab) return;
  sendCmdSilent('splicebegin ' + b64(_payload(true)));
  closeSplice(); // server replies with synth_minigame → the stabilize game opens
}

export function closeSplice() {
  clearTimeout(_previewTimer);
  window.removeEventListener('keydown', _escHandler);
  if (_overlay) { _overlay.remove(); _overlay = null; }
}
