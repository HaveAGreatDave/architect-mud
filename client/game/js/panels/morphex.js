import { sendCmdSilent } from '../net.js';

const HAIR_COLORS  = ['black','dark brown','brown','auburn','dirty blonde','blonde','red','grey','white','silver','dyed blue','dyed green','dyed purple','dyed red'];
const HAIR_LENGTHS = ['shaved','short','medium','long','very_long'];
const HAIR_STYLES  = ['short','long','mohawk','shaved','dreadlocks','braided','messy','slicked-back','curly','wavy'];
const EYE_COLORS   = ['brown','dark brown','blue','light blue','green','hazel','grey','amber'];
const BREAST_SIZES = ['flat','small','medium','large','very large'];

function heightDesc(cm) {
  if (cm < 158) return 'short';
  if (cm < 168) return 'slightly below average';
  if (cm < 178) return 'average height';
  if (cm < 188) return 'tall';
  return 'very tall';
}

function buildDesc(kg, cm) {
  const bmi = kg / Math.pow(cm / 100, 2);
  if (bmi < 18.5) return 'lean';
  if (bmi < 22)   return 'slender';
  if (bmi < 25)   return 'average build';
  if (bmi < 28)   return 'stocky';
  return 'heavyset';
}

let _modal = null;

export function openMorphexPanel(data) {
  if (!_modal) {
    _modal = document.createElement('div');
    _modal.id = 'morphex-modal';
    _modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
    _modal.addEventListener('click', e => { if (e.target === _modal) _close(); });
    document.body.appendChild(_modal);
  }
  _modal.style.display = 'flex';
  _render(data);
}

export function closeMorphexPanel() { _close(); }

function _close() {
  if (_modal) _modal.style.display = 'none';
}

function _sel(id, options, selected) {
  const opts = options.map(o =>
    `<option value="${o}"${o === selected ? ' selected' : ''}>${o}</option>`
  ).join('');
  return `<select id="${id}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:4px 6px;width:100%;box-sizing:border-box">${opts}</select>`;
}

function _numInput(id, value, min, max) {
  return `<input id="${id}" type="number" min="${min}" max="${max}" value="${value}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:4px 6px;width:100%;box-sizing:border-box">`;
}

function _applyBtn(cmd) {
  return `<button data-mx-apply="${cmd}" style="background:transparent;border:1px solid var(--accent);color:var(--accent);font-family:var(--font-mono);font-size:10px;padding:4px 10px;cursor:pointer;border-radius:2px;white-space:nowrap">Apply</button>`;
}

function _statRow(label, value, dim = false) {
  return `<div style="display:flex;padding:5px 0;border-bottom:1px solid var(--bg3);gap:8px">
    <span style="color:var(--text-dim);font-size:11px;min-width:80px;flex-shrink:0">${label}</span>
    <span style="color:${dim ? 'var(--text-dim)' : 'var(--text)'};font-size:11px">${value}</span>
  </div>`;
}

function _modRow(label, control, applyCmd) {
  return `<div style="display:grid;grid-template-columns:85px 1fr auto;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bg3)">
    <span style="color:var(--text-dim);font-size:11px">${label}</span>
    ${control}
    ${_applyBtn(applyCmd)}
  </div>`;
}

function _sectionHeader(text) {
  return `<div style="padding:8px 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim)">${text}</div>`;
}

function _render(d) {
  const sex    = d.biological_sex || 'male';
  const isMis  = d.mis_active;
  const app    = d.appearance_data || {};
  const h      = d.height_cm || 170;
  const w      = d.weight_kg || 70;
  const hs     = d.hair_style  || 'short';
  const hl     = d.hair_length || 'short';
  const hc     = d.hair_color  || 'brown';
  const ec     = d.eye_color   || 'brown';
  const isFree = !d.appearance_free_used;

  // ── Character sheet ──────────────────────────────────────────
  let sheet = [
    _statRow('Sex',    sex.charAt(0).toUpperCase() + sex.slice(1)),
    _statRow('Height', `${h}cm — ${heightDesc(h)}`),
    _statRow('Build',  buildDesc(w, h)),
    _statRow('Weight', `${w}kg`),
    _statRow('Hair',   `${hs}, ${hl}, ${hc}`),
    _statRow('Eyes',   ec),
  ].join('');

  if (isMis) {
    if (sex === 'male') {
      sheet += _sectionHeader('Biological');
      sheet += _statRow('Penis',    `${app.penis_length_cm || 13}cm length, ${app.penis_girth_cm || 1.3}cm girth`);
      sheet += _statRow('Testicles', app.testicle_size || 'average');
      sheet += _statRow('State',    d.erect ? 'erect' : 'flaccid', true);
    } else {
      sheet += _sectionHeader('Biological');
      sheet += _statRow('Breasts',  app.breast_size || 'medium');
      sheet += _statRow('Labia',    app.labia_style || 'average');
    }
  }

  const balanceColor = (d.credits || 0) >= 10 ? 'var(--green)' : 'var(--red)';
  const freeTag = isFree
    ? `<span style="color:var(--accent)">First change: FREE</span>`
    : `<span style="color:var(--text-dim)">10₵ per change</span>`;

  // ── Modification controls ─────────────────────────────────────
  const sexControl = `<div style="display:flex;gap:10px;align-items:center">
    <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:var(--text)">
      <input type="radio" name="mx-sex" value="male" ${sex === 'male' ? 'checked' : ''}> Male
    </label>
    <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;color:var(--text)">
      <input type="radio" name="mx-sex" value="female" ${sex === 'female' ? 'checked' : ''}> Female
    </label>
  </div>`;

  let mods = [
    _sectionHeader('Appearance'),
    _modRow('Sex',         sexControl,                                             'sex'),
    _modRow('Hair Color',  _sel('mx-hc', HAIR_COLORS, hc),                        'hair color'),
    _modRow('Hair Length', _sel('mx-hl', HAIR_LENGTHS, hl),                       'hair length'),
    _modRow('Hair Style',  _sel('mx-hs', HAIR_STYLES, hs),                        'hair style'),
    _modRow('Eye Color',   _sel('mx-ec', EYE_COLORS, ec),                         'eye color'),
    _modRow('Height (cm)', _numInput('mx-height', h, 150, 210),                   'height'),
    _modRow('Weight (kg)', _numInput('mx-weight', w, 40, 150),                    'weight'),
  ].join('');

  if (isMis) {
    if (sex === 'male') {
      mods += _sectionHeader('Biological — 5₵/cm');
      mods += _modRow('Penis (cm)', _numInput('mx-penis', app.penis_length_cm || 13, 5, 30), 'penis');
    } else {
      mods += _sectionHeader('Biological — 5₵/tier');
      mods += _modRow('Breast Size', _sel('mx-breast', BREAST_SIZES, app.breast_size || 'medium'), 'breast');
    }
  }

  // ── Full modal HTML ───────────────────────────────────────────
  _modal.innerHTML = `
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;width:700px;max-width:100%;max-height:90vh;overflow-y:auto;font-family:var(--font-mono)">

    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:13px;font-weight:bold;color:var(--accent);text-transform:uppercase;letter-spacing:2px">☆ MORPHEX 9000 BioSculpt Terminal</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px">Complimentary cosmetic reconfiguration. Results may vary. Not liable for existential crises.</div>
      </div>
      <button id="mx-close" style="background:none;border:none;color:var(--text-dim);font-size:18px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0">✕</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;min-height:200px">

      <div style="padding:14px 16px;border-right:1px solid var(--border)">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:8px">Current Appearance</div>
        ${sheet}
        <div style="margin-top:12px;padding:8px 10px;background:var(--bg3);border-radius:2px;font-size:11px;display:flex;justify-content:space-between;align-items:center">
          <span style="color:var(--text-dim)">Balance: <span style="color:${balanceColor}">${d.credits || 0}₵</span></span>
          ${freeTag}
        </div>
      </div>

      <div style="padding:14px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:8px">Modifications</div>
        ${mods}
      </div>

    </div>

    <div id="mx-toast" style="padding:8px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--accent);min-height:30px;display:flex;align-items:center">
      ${d.toast ? `<span>${d.toast}</span>` : ''}
    </div>

  </div>`;

  // ── Events ────────────────────────────────────────────────────
  document.getElementById('mx-close').addEventListener('click', _close);

  _modal.firstElementChild.addEventListener('click', e => {
    const btn = e.target.closest('button[data-mx-apply]');
    if (!btn) return;
    const which = btn.dataset.mxApply;
    let cmd = null;

    if (which === 'sex') {
      const v = _modal.querySelector('input[name="mx-sex"]:checked')?.value;
      if (v) cmd = `morphex sex ${v}`;
    } else if (which === 'hair color') {
      cmd = `morphex hair color ${document.getElementById('mx-hc').value}`;
    } else if (which === 'hair length') {
      cmd = `morphex hair length ${document.getElementById('mx-hl').value}`;
    } else if (which === 'hair style') {
      cmd = `morphex hair style ${document.getElementById('mx-hs').value}`;
    } else if (which === 'eye color') {
      cmd = `morphex eye color ${document.getElementById('mx-ec').value}`;
    } else if (which === 'height') {
      cmd = `morphex height ${document.getElementById('mx-height').value}`;
    } else if (which === 'weight') {
      cmd = `morphex weight ${document.getElementById('mx-weight').value}`;
    } else if (which === 'penis') {
      cmd = `morphex penis ${document.getElementById('mx-penis').value}`;
    } else if (which === 'breast') {
      cmd = `morphex breast ${document.getElementById('mx-breast').value}`;
    }

    if (cmd) sendCmdSilent(cmd);
  });
}
