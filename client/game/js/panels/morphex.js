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

function cmToImperial(cm) {
  const totalIn = cm / 2.54;
  const feet = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn % 12);
  return { feet, inches };
}

function imperialToCm(feet, inches) {
  return Math.round((parseInt(feet) * 12 + parseInt(inches)) * 2.54);
}

function kgToLbs(kg) { return Math.round(kg / 0.453592); }
function lbsToKg(lbs) { return Math.round(lbs * 0.453592); }

let _modal = null;
let _currentData = null;

export function openMorphexPanel(data) {
  _currentData = data;
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

function _numInput(id, value, min, max, step) {
  return `<input id="${id}" type="number" min="${min}" max="${max}" step="${step||1}" value="${value}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:4px 6px;width:100%;box-sizing:border-box">`;
}

function _statRow(label, value, dim = false) {
  return `<div style="display:flex;padding:5px 0;border-bottom:1px solid var(--bg3);gap:8px">
    <span style="color:var(--text-dim);font-size:11px;min-width:80px;flex-shrink:0">${label}</span>
    <span style="color:${dim ? 'var(--text-dim)' : 'var(--text)'};font-size:11px">${value}</span>
  </div>`;
}

function _modRow(label, control) {
  return `<div style="display:grid;grid-template-columns:85px 1fr;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bg3)">
    <span style="color:var(--text-dim);font-size:11px">${label}</span>
    ${control}
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

  const imp = cmToImperial(h);
  const lbs = kgToLbs(w);

  // ── Character sheet ──────────────────────────────────────────
  let sheet = [
    _statRow('Sex',    sex.charAt(0).toUpperCase() + sex.slice(1)),
    _statRow('Height', `${imp.feet}'${imp.inches}" — ${heightDesc(h)}`),
    _statRow('Build',  buildDesc(w, h)),
    _statRow('Weight', `${lbs} lbs`),
    _statRow('Hair',   `${hs}, ${hl}, ${hc}`),
    _statRow('Eyes',   ec),
  ].join('');

//  if (isMis) {
//   if (sex === 'male') {
//      sheet += _sectionHeader('Biological');
//      sheet += _statRow('Penis',    `${app.penis_length_cm || 13}cm, ${app.penis_girth_cm || 1.3}cm girth`);
//      sheet += _statRow('Testicles', app.testicle_size || 'average');
//      sheet += _statRow('State',    d.erect ? 'erect' : 'flaccid', true);
//    } else {
//      sheet += _sectionHeader('Biological');
//     sheet += _statRow('Breasts',  app.breast_size || 'medium');
//      sheet += _statRow('Labia',    app.labia_style || 'average');
//    }
//  }

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

  const heightControl = `<div style="display:flex;gap:6px;align-items:center">
    ${_numInput('mx-feet', imp.feet, 4, 7)} <span style="color:var(--text-dim);font-size:11px">ft</span>
    ${_numInput('mx-inches', imp.inches, 0, 11)} <span style="color:var(--text-dim);font-size:11px">in</span>
  </div>`;

  let mods = [
    _sectionHeader('Appearance'),
    _modRow('Sex',         sexControl),
    _modRow('Hair Color',  _sel('mx-hc', HAIR_COLORS, hc)),
    _modRow('Hair Length', _sel('mx-hl', HAIR_LENGTHS, hl)),
    _modRow('Hair Style',  _sel('mx-hs', HAIR_STYLES, hs)),
    _modRow('Eye Color',   _sel('mx-ec', EYE_COLORS, ec)),
    _modRow('Height',      heightControl),
    _modRow('Weight (lbs)',_numInput('mx-lbs', lbs, 88, 330)),
  ].join('');

  if (isMis) {
    if (sex === 'male') {
      mods += _sectionHeader('Biological — 5₵/cm');
      mods += _modRow('Penis (cm)', _numInput('mx-penis', app.penis_length_cm || 13, 5, 30));
    } else {
      mods += _sectionHeader('Biological — 5₵/tier');
      mods += _modRow('Breast Size', _sel('mx-breast', BREAST_SIZES, app.breast_size || 'medium'));
    }
  }

  const applyBtnStyle = 'background:var(--accent);border:none;color:var(--bg);font-family:var(--font-mono);font-size:12px;font-weight:bold;padding:8px 24px;cursor:pointer;border-radius:2px;letter-spacing:1px';

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

    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div id="mx-toast" style="font-size:11px;color:var(--accent);flex:1">${d.toast || ''}</div>
      <button id="mx-apply" style="${applyBtnStyle}">Apply Changes</button>
    </div>

  </div>`;

  // ── Events ────────────────────────────────────────────────────
  document.getElementById('mx-close').addEventListener('click', _close);

  document.getElementById('mx-apply').addEventListener('click', () => {
    const d = _currentData;
    if (!d) return;
    const cmds = [];

    const newSex = _modal.querySelector('input[name="mx-sex"]:checked')?.value;
    if (newSex && newSex !== d.biological_sex) cmds.push(`morphex sex ${newSex}`);

    const newHc = document.getElementById('mx-hc')?.value;
    if (newHc && newHc !== d.hair_color) cmds.push(`morphex hair color ${newHc}`);

    const newHl = document.getElementById('mx-hl')?.value;
    if (newHl && newHl !== d.hair_length) cmds.push(`morphex hair length ${newHl}`);

    const newHs = document.getElementById('mx-hs')?.value;
    if (newHs && newHs !== d.hair_style) cmds.push(`morphex hair style ${newHs}`);

    const newEc = document.getElementById('mx-ec')?.value;
    if (newEc && newEc !== d.eye_color) cmds.push(`morphex eye color ${newEc}`);

    const feet = document.getElementById('mx-feet')?.value;
    const inches = document.getElementById('mx-inches')?.value;
    if (feet !== undefined && inches !== undefined) {
      const newCm = imperialToCm(feet, inches);
      if (newCm !== (d.height_cm || 170)) cmds.push(`morphex height ${newCm}`);
    }

    const lbsVal = document.getElementById('mx-lbs')?.value;
    if (lbsVal !== undefined) {
      const newKg = lbsToKg(parseInt(lbsVal));
      if (newKg !== (d.weight_kg || 70)) cmds.push(`morphex weight ${newKg}`);
    }

    const app = d.appearance_data || {};
    if (d.mis_active) {
      if (d.biological_sex === 'male') {
        const newPenis = parseInt(document.getElementById('mx-penis')?.value);
        if (!isNaN(newPenis) && newPenis !== (app.penis_length_cm || 13)) cmds.push(`morphex penis ${newPenis}`);
      } else {
        const newBreast = document.getElementById('mx-breast')?.value;
        if (newBreast && newBreast !== (app.breast_size || 'medium')) cmds.push(`morphex breast ${newBreast}`);
      }
    }

    if (!cmds.length) {
      document.getElementById('mx-toast').textContent = 'No changes detected.';
      return;
    }

    document.getElementById('mx-toast').textContent = 'Applying…';
    for (const cmd of cmds) sendCmdSilent(cmd);
  });
}
