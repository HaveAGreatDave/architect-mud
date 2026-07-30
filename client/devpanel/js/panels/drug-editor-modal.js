// Pop-out structured drug editor (dev panel).
//
// The inline drug form (simple-entities.js) keeps a raw-JSON `effects` textarea
// as a fallback; this modal is the intuitive path. It opens from a button in
// that form, seeds from the current field values (parsing the effects JSON into
// sectioned controls), and on Save composes the effects object and PUT/POSTs to
// /drugs via the shared API helper (so staging still applies), then reloads.
//
// Global-scope script (dev panel has no bundler). Reuses .modal-overlay /
// .modal-card / .field / .field-row CSS. Self-builds its overlay — no index.html
// change needed beyond the <script> include.
//
// Effects schema (all sections optional): instant / phases / tolerance /
// withdrawal / overdose / hallucination — see server/engine/drugs.js.

let _dgRec = null;
let _dgIsNew = false;

// ── field helpers ────────────────────────────────────────────────────────────
function _num(id, label, val, step = 1, ph = '') {
  return `<div class="field"><label>${label}</label><input type="number" step="${step}" id="dg-${id}" value="${val ?? ''}" placeholder="${ph}"></div>`;
}
function _txt(id, label, val, ph = '') {
  return `<div class="field"><label>${label}</label><input id="dg-${id}" value="${_attr(val ?? '')}" placeholder="${ph}"></div>`;
}
function _area(id, label, val) {
  return `<div class="field"><label>${label}</label><textarea id="dg-${id}" rows="2">${_esc(val ?? '')}</textarea></div>`;
}
function _sel(id, label, val, opts) {
  const o = opts.map(v => `<option value="${v}"${String(val) === v ? ' selected' : ''}>${v}</option>`).join('');
  return `<div class="field"><label>${label}</label><select id="dg-${id}">${o}</select></div>`;
}
function _chk(id, label, on) {
  return `<label style="display:flex;gap:8px;align-items:center;margin:6px 0;cursor:pointer"><input type="checkbox" id="dg-${id}" ${on ? 'checked' : ''} style="width:auto"> <span>${label}</span></label>`;
}
function _hdr(t) { return `<div class="field-section-header" style="margin-top:16px;font-weight:600;color:var(--accent)">${t}</div>`; }
function _esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _attr(s) { return _esc(s).replace(/"/g, '&quot;'); }

// key/value mod row (peak_mods, withdrawal.mods, overdose.mods)
function _modRow(k = '', v = '') {
  return `<div class="dg-mod-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:2"><label>Stat key</label><input class="dg-mod-k" value="${_attr(k)}" placeholder="stat_brawn / hp_max / sanity_regen_per_sec"></div>
    <div class="field" style="flex:0 0 90px"><label>Value</label><input type="number" step="0.1" class="dg-mod-v" value="${v}"></div>
    <button type="button" class="action-btn" onclick="_dgRemoveRow(this)">×</button>
  </div>`;
}
function _eventRow(at = '', text = '') {
  return `<div class="dg-evt-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:0 0 80px"><label>At sec</label><input type="number" class="dg-evt-at" value="${at}"></div>
    <div class="field" style="flex:1"><label>Line ([trip]…[/trip] for melt FX)</label><input class="dg-evt-text" value="${_attr(text)}"></div>
    <button type="button" class="action-btn" onclick="_dgRemoveRow(this)">×</button>
  </div>`;
}
function _dgRemoveRow(btn) { btn.closest('.dg-mod-row,.dg-evt-row')?.remove(); }
function _dgAddMod(id) { document.getElementById(id).insertAdjacentHTML('beforeend', _modRow()); }
function _dgAddEvt(id) { document.getElementById(id).insertAdjacentHTML('beforeend', _eventRow()); }

// ── open ─────────────────────────────────────────────────────────────────────
// Launched by the inline form button: read its current field values so the modal
// works for both new and existing drugs without threading the record through.
async function openDrugEditorFromForm() {
  const g = (id) => document.getElementById(id);
  let effects = {};
  try { effects = JSON.parse(g('f-effects')?.value || '{}'); } catch { await dpAlert('Effects JSON is invalid — fix it before using the structured editor.'); return; }
  // Carry flags through the modal: start from the full stashed flags, then apply
  // the inline form's appearance edits so nothing is lost on round-trip.
  let flags = {}; try { flags = JSON.parse(g('f-flags-json')?.value || '{}'); } catch { flags = {}; }
  if (g('f-is_legal')) flags.legal = g('f-is_legal').value === '1';
  const _fm = g('f-form')?.value; if (_fm) flags.form = _fm; else delete flags.form;
  const _sb = g('f-sub')?.value.trim(); if (_sb) flags.sub = _sb; else delete flags.sub;
  if (g('f-color-on')) { if (g('f-color-on').checked) flags.color = g('f-color')?.value; else delete flags.color; }
  const _vv = g('f-volatility')?.value; if (_vv == null || _vv === '') delete flags.volatility; else flags.volatility = Math.max(0, Math.min(1, +_vv));
  const _ct = g('f-cook_tier')?.value; if (_ct == null || _ct === '') delete flags.cook_tier; else flags.cook_tier = Math.max(1, Math.min(5, Math.round(+_ct)));
  const rec = {
    id: g('f-id')?.value || '',
    name: g('f-name')?.value || '',
    description: g('f-description')?.value || '',
    item_id: g('f-item_id')?.value || '',
    duration_seconds: g('f-duration_seconds')?.value || 300,
    overdose_threshold: g('f-overdose_threshold')?.value || 3,
    addiction_chance: g('f-addiction_chance')?.value || 0,
    effects, flags,
    withdrawal_effects: (() => { try { return JSON.parse(g('f-withdrawal_effects')?.value || '{}'); } catch { return {}; } })(),
  };
  openDrugEditorModal(rec, !g('f-id')?.readOnly);
}

function openDrugEditorModal(rec, isNew) {
  _dgRec = rec; _dgIsNew = isNew;
  closeDrugEditor();
  const e = rec.effects || {};
  // Back-compat: a flat effects object (no structured keys) is the instant block.
  const structuredKeys = ['instant', 'phases', 'tolerance', 'withdrawal', 'overdose', 'hallucination'];
  const isStructured = structuredKeys.some(k => k in e);
  const inst = isStructured ? (e.instant || {}) : e;
  const ph = e.phases || {};
  const pm = ph.peak_mods || {};
  const tol = e.tolerance || {};
  const wd = e.withdrawal || {};
  const od = e.overdose || {};
  const hal = e.hallucination || {};

  const overlay = document.createElement('div');
  overlay.id = 'drug-editor-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:500;background:rgba(0,0,0,0.6)';
  overlay.innerHTML = `
    <div class="modal-card" style="width:min(860px,95vw);max-height:92vh;overflow-y:auto">
      <h2 style="margin-top:0">⚗ ${isNew ? 'New Drug' : 'Edit: ' + _esc(rec.name)}</h2>

      ${_hdr('Basics')}
      <div class="field-row">
        <div class="field" style="flex:1"><label>Drug ID</label><input id="dg-id" value="${_attr(rec.id)}" ${!isNew ? 'readonly style="opacity:.5"' : ''}></div>
        <div class="field" style="flex:1"><label>Name</label><input id="dg-name" value="${_attr(rec.name)}"></div>
      </div>
      ${_area('description', 'Description', rec.description)}
      <div class="field-row">
        ${_txt('item_id', 'Linked Item ID', rec.item_id, 'item_redline')}
        ${_num('duration_seconds', 'Duration (s)', rec.duration_seconds)}
        ${_num('overdose_threshold', 'OD threshold (doses)', rec.overdose_threshold)}
        ${_num('addiction_chance', 'Addiction/dose (0–1)', rec.addiction_chance, 0.01)}
        ${_num('diuretic', 'Diuretic (1=neutral, >1 pees, <1 retains)', e.diuretic, 0.05, '1')}
      </div>

      ${_hdr('🧪 Splice-bench appearance (blank = auto-derive)')}
      <div class="field-row">
        <div class="field"><label>Package form</label>
          <select id="dg-form">
            <option value="" ${!rec.flags?.form ? 'selected' : ''}>— auto —</option>
            <option value="liquid" ${rec.flags?.form === 'liquid' ? 'selected' : ''}>liquid (vial)</option>
            <option value="powder" ${rec.flags?.form === 'powder' ? 'selected' : ''}>powder (baggie)</option>
            <option value="gel" ${rec.flags?.form === 'gel' ? 'selected' : ''}>gel (pouch)</option>
            <option value="pill" ${rec.flags?.form === 'pill' ? 'selected' : ''}>pill (blister)</option>
            <option value="gas" ${rec.flags?.form === 'gas' ? 'selected' : ''}>gas (canister)</option>
            <option value="crystal" ${rec.flags?.form === 'crystal' ? 'selected' : ''}>crystal (shard)</option>
            <option value="blotter" ${rec.flags?.form === 'blotter' ? 'selected' : ''}>blotter (tab sheet)</option>
            <option value="paste" ${rec.flags?.form === 'paste' ? 'selected' : ''}>paste (tar brick)</option>
            <option value="leaf" ${rec.flags?.form === 'leaf' ? 'selected' : ''}>leaf (herb baggie)</option>
          </select></div>
        ${_txt('sub', 'Sub-form (mix behaviour)', rec.flags?.sub, 'auto — thin/oil/solvent/fine/crystalline/viscous/tablet')}
        <div class="field"><label>Colour</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="dg-color" value="${rec.flags?.color || '#4fe08a'}" oninput="var c=document.getElementById('dg-color_on');if(c)c.checked=true" style="width:34px;height:28px;padding:1px;border:1px solid var(--border);background:var(--bg3);cursor:pointer">
            <label style="font-size:12px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="dg-color_on" ${rec.flags?.color ? 'checked' : ''} style="width:auto"> custom</label>
          </div></div>
        ${_num('volatility', 'Volatility (0–1)', rec.flags?.volatility, 0.05, 'auto')}
        ${_num('cook_tier', 'Cook tier (1–5)', rec.flags?.cook_tier, 1, 'auto')}
      </div>

      ${_hdr('⚡ Instant (one-shot deltas)')}
      <div class="field-row">
        ${_num('i_hp', 'HP', inst.hp)}
        ${_num('i_sanity', 'Sanity', inst.sanity)}
        ${_num('i_hunger', 'Hunger', inst.hunger)}
        ${_num('i_thirst', 'Thirst', inst.thirst)}
        ${_num('i_radiation', 'Radiation', inst.radiation)}
        ${_num('i_horniness_increase', 'Horniness', inst.horniness_increase)}
      </div>

      ${_hdr('📈 Phased (come-up → peak → comedown)')}
      ${_chk('phases_on', 'Enable phased effects', isStructured && !!e.phases)}
      <div id="dg-phases-box">
        <div class="field-row">
          ${_num('p_comeup_seconds', 'Come-up (s)', ph.comeup_seconds)}
          ${_num('p_peak_seconds', 'Peak (s)', ph.peak_seconds)}
          ${_num('p_comedown_seconds', 'Comedown (s)', ph.comedown_seconds)}
          ${_num('p_comeup_scale', 'Come-up scale', ph.comeup_scale, 0.05)}
          ${_num('p_comedown_scale', 'Comedown scale', ph.comedown_scale, 0.05)}
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin:4px 0">Peak modifiers — buffs (stat_*, hp_max, sanity_max) + <code>*_regen_per_sec</code> drip keys:</div>
        <div id="dg-peakmods"></div>
        <button type="button" class="action-btn" onclick="_dgAddMod('dg-peakmods')">+ mod</button>
        ${_txt('p_comeup_message', 'Come-up message', ph.comeup_message)}
        ${_txt('p_peak_message', 'Peak message', ph.peak_message)}
        ${_txt('p_comedown_message', 'Comedown message', ph.comedown_message)}
        ${_txt('p_end_message', 'Wear-off message', ph.end_message)}
      </div>

      ${_hdr('🔄 Tolerance')}
      <div class="field-row">
        ${_num('t_gain_per_dose', 'Gain / dose', tol.gain_per_dose, 0.01)}
        ${_num('t_recovery_per_sec', 'Recovery / sec', tol.recovery_per_sec, 0.0001)}
        ${_num('t_max_reduction', 'Max reduction (0–1)', tol.max_reduction, 0.05)}
      </div>

      ${_hdr('🚑 Withdrawal')}
      <div class="field-row">
        ${_num('w_onset_seconds', 'Onset (s)', wd.onset_seconds)}
        ${_num('w_addiction_per_dose', 'Addiction / dose', wd.addiction_per_dose, 0.01)}
        ${_num('w_addiction_recovery_per_sec', 'Addiction recovery / sec', wd.addiction_recovery_per_sec, 0.000001)}
      </div>
      ${_txt('w_message', 'Withdrawal message', wd.message)}
      <div style="font-size:11px;color:var(--text-dim);margin:4px 0">Withdrawal modifiers (debuffs):</div>
      <div id="dg-wdmods"></div>
      <button type="button" class="action-btn" onclick="_dgAddMod('dg-wdmods')">+ mod</button>

      ${_hdr('💀 Overdose')}
      ${_chk('od_lethal', 'Overdose is LETHAL (exceeding threshold kills)', !!od.lethal)}
      ${_txt('od_message', 'Overdose message', od.message)}
      <div style="font-size:11px;color:var(--text-dim);margin:4px 0">Non-lethal overdose burst modifiers:</div>
      <div id="dg-odmods"></div>
      <button type="button" class="action-btn" onclick="_dgAddMod('dg-odmods')">+ mod</button>

      ${_hdr('👁 Hallucination')}
      ${_chk('hal_on', 'Enable hallucination', !!e.hallucination)}
      <div id="dg-hal-box">
        <div class="field-row">
          ${_sel('hal_mode', 'Mode', hal.mode || 'overlay', ['overlay', 'dreamzone'])}
          ${_sel('hal_palette', 'Palette', hal.palette || 'green', ['green', 'purple', 'red', 'gold', 'cyan', 'magenta', 'blue'])}
          ${_num('hal_intensity', 'Intensity (0–1)', hal.intensity, 0.05)}
          ${_num('hal_duration_seconds', 'Duration (s)', hal.duration_seconds)}
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin:4px 0"><b>dreamzone</b> mode builds a private, throwaway dreamscape for that one tripper — there is no room to name, and nobody else can walk into it.</div>
        <div style="font-size:11px;color:var(--text-dim);margin:4px 0">Timed events:</div>
        <div id="dg-events"></div>
        <button type="button" class="action-btn" onclick="_dgAddEvt('dg-events')">+ event</button>
      </div>

      <div style="display:flex;gap:8px;margin-top:20px">
        <button id="dg-save" class="action-btn primary success">Save & Publish</button>
        <button class="action-btn" onclick="closeDrugEditor()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) closeDrugEditor(); });

  // Fill dynamic rows.
  for (const [k, v] of Object.entries(pm)) document.getElementById('dg-peakmods').insertAdjacentHTML('beforeend', _modRow(k, v));
  for (const [k, v] of Object.entries(wd.mods || {})) document.getElementById('dg-wdmods').insertAdjacentHTML('beforeend', _modRow(k, v));
  for (const [k, v] of Object.entries(od.mods || {})) document.getElementById('dg-odmods').insertAdjacentHTML('beforeend', _modRow(k, v));
  for (const ev of (hal.events || [])) document.getElementById('dg-events').insertAdjacentHTML('beforeend', _eventRow(ev.atSec, ev.text));

  const toggle = (chkId, boxId) => {
    const c = document.getElementById(chkId), b = document.getElementById(boxId);
    const sync = () => { b.style.display = c.checked ? '' : 'none'; };
    c.addEventListener('change', sync); sync();
  };
  toggle('dg-phases_on', 'dg-phases-box');
  toggle('dg-hal_on', 'dg-hal-box');

  document.getElementById('dg-save').onclick = _dgSave;
}

function closeDrugEditor() {
  document.getElementById('drug-editor-overlay')?.remove();
}

// ── collect + save ─────────────────────────────────────────────────────────
function _v(id) { const el = document.getElementById('dg-' + id); return el ? el.value : ''; }
function _n(id) { const s = _v(id); return s === '' ? undefined : Number(s); }
function _collectMods(containerId) {
  const out = {};
  for (const row of document.querySelectorAll(`#${containerId} .dg-mod-row`)) {
    const k = row.querySelector('.dg-mod-k').value.trim();
    const v = Number(row.querySelector('.dg-mod-v').value);
    if (k && v) out[k] = v;
  }
  return out;
}
function _pruneUndef(o) { for (const k in o) if (o[k] === undefined) delete o[k]; return o; }

async function _dgSave() {
  const effects = {};

  const instant = _pruneUndef({ hp: _n('i_hp'), sanity: _n('i_sanity'), hunger: _n('i_hunger'), thirst: _n('i_thirst'), radiation: _n('i_radiation'), horniness_increase: _n('i_horniness_increase') });
  if (Object.keys(instant).length) effects.instant = instant;

  // Diuretic factor lives at the effects top level (survives structured/flat).
  const diuretic = _n('diuretic');
  if (diuretic !== undefined && diuretic !== 1) effects.diuretic = diuretic;

  if (document.getElementById('dg-phases_on').checked) {
    const peak_mods = _collectMods('dg-peakmods');
    effects.phases = _pruneUndef({
      comeup_seconds: _n('p_comeup_seconds'), peak_seconds: _n('p_peak_seconds'), comedown_seconds: _n('p_comedown_seconds'),
      comeup_scale: _n('p_comeup_scale'), comedown_scale: _n('p_comedown_scale'),
      peak_mods: Object.keys(peak_mods).length ? peak_mods : undefined,
      comeup_message: _v('p_comeup_message') || undefined, peak_message: _v('p_peak_message') || undefined,
      comedown_message: _v('p_comedown_message') || undefined, end_message: _v('p_end_message') || undefined,
    });
  }

  const tol = _pruneUndef({ gain_per_dose: _n('t_gain_per_dose'), recovery_per_sec: _n('t_recovery_per_sec'), max_reduction: _n('t_max_reduction') });
  if (Object.keys(tol).length) effects.tolerance = tol;

  const wdMods = _collectMods('dg-wdmods');
  const wd = _pruneUndef({ onset_seconds: _n('w_onset_seconds'), addiction_per_dose: _n('w_addiction_per_dose'), addiction_recovery_per_sec: _n('w_addiction_recovery_per_sec'), message: _v('w_message') || undefined, mods: Object.keys(wdMods).length ? wdMods : undefined });
  if (Object.keys(wd).length) effects.withdrawal = wd;

  const odMods = _collectMods('dg-odmods');
  const odLethal = document.getElementById('dg-od_lethal').checked;
  const od = _pruneUndef({ lethal: odLethal || undefined, message: _v('od_message') || undefined, mods: Object.keys(odMods).length ? odMods : undefined });
  if (Object.keys(od).length) effects.overdose = od;

  if (document.getElementById('dg-hal_on').checked) {
    const events = [];
    for (const row of document.querySelectorAll('#dg-events .dg-evt-row')) {
      const at = Number(row.querySelector('.dg-evt-at').value);
      const text = row.querySelector('.dg-evt-text').value.trim();
      if (text) events.push({ atSec: at || 0, text });
    }
    effects.hallucination = _pruneUndef({
      mode: _v('hal_mode'), palette: _v('hal_palette'), intensity: _n('hal_intensity'),
      duration_seconds: _n('hal_duration_seconds'),
      events: events.length ? events : undefined,
    });
  }

  const id = _v('id').trim();
  if (!id) { toast('Drug ID is required', true); return; }

  // Preserve flags (legal + anything else) and apply the appearance controls.
  // (Without this the modal used to silently wipe the drug's flags on save.)
  const flags = { ..._dgRec?.flags };
  { const v = _v('form'); if (v) flags.form = v; else delete flags.form; }
  { const v = _v('sub').trim(); if (v) flags.sub = v; else delete flags.sub; }
  { const on = document.getElementById('dg-color_on'); if (on) { if (on.checked) flags.color = _v('color'); else delete flags.color; } }
  { const v = _v('volatility'); if (v === '') delete flags.volatility; else flags.volatility = Math.max(0, Math.min(1, Number(v))); }
  { const v = _v('cook_tier'); if (v === '') delete flags.cook_tier; else flags.cook_tier = Math.max(1, Math.min(5, Math.round(Number(v)))); }

  const body = {
    name: _v('name'), description: _v('description'), item_id: _v('item_id') || null,
    duration_seconds: _n('duration_seconds') || 300, overdose_threshold: _n('overdose_threshold') || 3,
    addiction_chance: _n('addiction_chance') || 0, effects, flags,
    withdrawal_effects: _dgRec?.withdrawal_effects || {},
  };
  if (_dgIsNew) body.id = id;

  const btn = document.getElementById('dg-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  const r = _dgIsNew ? await API('/drugs', 'POST', body) : await API(`/drugs/${id}`, 'PUT', body);
  if (r?.error) { toast(r.error, true); btn.disabled = false; btn.textContent = 'Save & Publish'; return; }
  toast(r?.staged ? 'Staged for review ✓' : 'Saved ✓');
  closeDrugEditor();
  if (typeof loadPanel === 'function') loadPanel('drugs');
}
