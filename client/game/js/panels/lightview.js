import { sendCmdSilent } from '../net.js';

let _lvData = null;

export function openLightViewDialog(data) {
  _lvData = data;
  let modal = document.getElementById('lightview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'lightview-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:500;display:flex;align-items:center;justify-content:center';
    modal.addEventListener('click', e => { if (e.target === modal) closeLightViewDialog(); });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  _renderLightView(modal, data);
}

function closeLightViewDialog() {
  const modal = document.getElementById('lightview-modal');
  if (modal) modal.style.display = 'none';
}

function _renderLightView(modal, d) {
  const vis = d.visibility;
  const curPct = Math.round((vis.visibility || 0) * 100);
  const maxPct = Math.round((d.maxLight || 0) * 100);
  const powerColor = d.powerStatus === 'powered' ? 'var(--green)' : d.powerStatus === 'overloaded' ? 'var(--yellow)' : 'var(--red)';
  const powerLabel = d.powerStatus === 'powered' ? '⚡ Powered' : d.powerStatus === 'overloaded' ? '⚠ Overloaded' : '✗ Offline';
  const barColor = curPct > 70 ? 'var(--green)' : curPct > 30 ? 'var(--yellow)' : 'var(--red)';
  const bar = (pct, color) => `<div style="flex:1;background:var(--bg3);border-radius:3px;height:8px;position:relative">
    <div style="width:${pct}%;background:${color};height:100%;border-radius:3px;transition:width 0.3s"></div>
  </div>`;

  const lightRows = (d.lights || []).map(l => {
    const typeOpts = ['overhead', 'lamp', 'streetlight'].map(t =>
      `<option value="${t}" ${l.light_type === t ? 'selected' : ''}>${t}</option>`).join('');
    return `<tr id="lvlight-${l.id}">
      <td style="color:var(--text-bright)">${l.name}</td>
      <td><select data-lv-update-id="${l.id}" data-lv-update-field="light_type" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:2px 4px">${typeOpts}</select></td>
      <td style="text-align:center"><span style="color:${l.light_on ? 'var(--yellow)' : 'var(--text-dim)'}">${l.light_on ? '● ON' : '○ OFF'}</span></td>
      <td style="text-align:center"><span style="color:${d.powerStatus === 'powered' ? 'var(--green)' : 'var(--red)'}">
        ${d.powerStatus === 'powered' ? '✓ Receiving' : '✗ No power'}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button data-lv-toggle-light="${l.id}" data-lv-state="${l.light_on ? 0 : 1}" style="${_lvBtnStyle(l.light_on ? 'var(--red)' : 'var(--green)')}">${l.light_on ? 'Turn Off' : 'Turn On'}</button>
        <button data-lv-delete-light="${l.id}" style="${_lvBtnStyle('var(--text-dim)')}">✕</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="color:var(--text-dim);font-style:italic;padding:8px">No light fixtures in this room.</td></tr>`;

  const winRows = (d.windows || []).map(w => {
    const pct = Math.round((w.light_transmission || 0.8) * 100);
    const curtainColor = w.curtain_open ? 'var(--green)' : 'var(--text-dim)';
    const glassColor = w.glass_state === 'broken' ? 'var(--red)' : 'var(--text-bright)';
    return `<tr id="lvwin-${w.id}">
      <td style="color:var(--text-bright)">${w.name}</td>
      <td style="color:${curtainColor}">${w.curtain_open ? 'Open' : 'Closed'}</td>
      <td style="color:${glassColor}">${w.glass_state === 'broken' ? 'Broken' : 'Intact'}</td>
      <td style="min-width:80px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;background:var(--bg3);border-radius:2px;height:5px">
            <div style="width:${pct}%;background:var(--cyan);height:100%;border-radius:2px"></div>
          </div>
          <span style="font-size:10px;color:var(--text-dim)">${pct}%</span>
        </div>
      </td>
      <td style="text-align:right;white-space:nowrap">
        <button data-lv-toggle-curtain="${w.id}" data-lv-state="${w.curtain_open ? 0 : 1}" style="${_lvBtnStyle('var(--accent)')}">${w.curtain_open ? 'Close' : 'Open'}</button>
        <button data-lv-edit-window="${w.id}" style="${_lvBtnStyle('var(--text-dim)')}">✏</button>
        <button data-lv-delete-window="${w.id}" style="${_lvBtnStyle('var(--red)')}">✕</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="color:var(--text-dim);font-style:italic;padding:8px">No windows in this room.</td></tr>`;

  modal.innerHTML = `
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;width:620px;max-height:85vh;overflow-y:auto;font-family:var(--font-mono)">
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:13px;font-weight:bold;color:var(--accent);text-transform:uppercase;letter-spacing:2px">⚡ Light View</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${d.zoneName} <span style="color:var(--border)">·</span> ${d.zoneId}</div>
      </div>
      <button data-lv-close style="background:none;border:none;color:var(--text-dim);font-size:18px;cursor:pointer;padding:0 4px;line-height:1">✕</button>
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <span style="font-size:11px;color:var(--text-dim);width:90px">Current light</span>
        ${bar(curPct, barColor)}
        <span style="font-size:12px;font-weight:bold;color:${barColor};width:36px;text-align:right">${curPct}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <span style="font-size:11px;color:var(--text-dim);width:90px">Max possible</span>
        ${bar(maxPct, 'var(--text-dim)')}
        <span style="font-size:12px;color:var(--text-dim);width:36px;text-align:right">${maxPct}%</span>
      </div>
      <div style="display:flex;gap:16px;font-size:11px">
        <span style="color:${powerColor}">${powerLabel}</span>
        <span style="color:var(--text-dim)">Artificial: <span style="color:var(--text)">${Math.round((vis.artificialLight || 0) * 100)}%</span></span>
        <span style="color:var(--text-dim)">Window: <span style="color:var(--text)">${Math.round((vis.windowLight || 0) * 100)}%</span></span>
        <span style="color:var(--text-dim)">Ambient: <span style="color:var(--text)">${Math.round((vis.ambientLight || 0) * 100)}%</span></span>
        <span style="color:var(--text-dim)">Category: <span style="color:var(--text)">${vis.category}</span></span>
      </div>
    </div>

    <div style="padding:10px 16px 4px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px">Lights</span>
      <button data-lv-add-light style="${_lvBtnStyle('var(--green)')}">+ Add Light</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:var(--bg3)">
        <th style="padding:5px 8px;text-align:left;color:var(--text-dim)">Name</th>
        <th style="padding:5px 8px;text-align:left;color:var(--text-dim)">Type</th>
        <th style="padding:5px 8px;text-align:center;color:var(--text-dim)">State</th>
        <th style="padding:5px 8px;text-align:center;color:var(--text-dim)">Power</th>
        <th></th>
      </tr></thead>
      <tbody id="lv-lights-body">${lightRows}</tbody>
    </table>

    <div style="padding:10px 16px 4px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);margin-top:4px">
      <span style="font-size:12px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:1px">Windows</span>
      <button data-lv-add-window style="${_lvBtnStyle('var(--cyan)')}">+ Add Window</button>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:var(--bg3)">
        <th style="padding:5px 8px;text-align:left;color:var(--text-dim)">Name</th>
        <th style="padding:5px 8px;color:var(--text-dim)">Curtain</th>
        <th style="padding:5px 8px;color:var(--text-dim)">Glass</th>
        <th style="padding:5px 8px;color:var(--text-dim);min-width:90px">Light %</th>
        <th></th>
      </tr></thead>
      <tbody id="lv-windows-body">${winRows}</tbody>
    </table>
    <div style="padding:10px 16px;border-top:1px solid var(--border);text-align:right">
      <button data-lv-refresh style="${_lvBtnStyle('var(--accent)')}" title="Refresh data">↻ Refresh</button>
      <button data-lv-close style="${_lvBtnStyle('var(--text-dim)')}">Close</button>
    </div>
  </div>`;

  // Wire up event delegation for all data-lv-* buttons/selects
  const inner = modal.firstElementChild;
  inner.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.lvClose !== undefined) { closeLightViewDialog(); return; }
    if (btn.dataset.lvRefresh !== undefined) { sendCmdSilent('lightview'); return; }
    if (btn.dataset.lvAddLight !== undefined) { _lvInlineForm('light', null); return; }
    if (btn.dataset.lvAddWindow !== undefined) { _lvInlineForm('window', null); return; }
    if (btn.dataset.lvToggleLight !== undefined) {
      await _lvAPI(`/furniture/${btn.dataset.lvToggleLight}`, 'PUT', { light_on: parseInt(btn.dataset.lvState) });
      sendCmdSilent('lightview');
      sendCmdSilent('look'); return;
    }
    if (btn.dataset.lvDeleteLight !== undefined) {
      if (!confirm('Delete this light fixture?')) return;
      await _lvAPI(`/furniture/${btn.dataset.lvDeleteLight}`, 'DELETE');
      sendCmdSilent('lightview'); return;
    }
    if (btn.dataset.lvToggleCurtain !== undefined) {
      await _lvAPI(`/windows/${btn.dataset.lvToggleCurtain}`, 'PUT', { curtain_open: parseInt(btn.dataset.lvState) });
      sendCmdSilent('lightview'); return;
    }
    if (btn.dataset.lvEditWindow !== undefined) {
      const w = _lvData?.windows?.find(x => x.id === btn.dataset.lvEditWindow);
      if (w) _lvInlineForm('window', w); return;
    }
    if (btn.dataset.lvDeleteWindow !== undefined) {
      if (!confirm('Delete this window?')) return;
      await _lvAPI(`/windows/${btn.dataset.lvDeleteWindow}`, 'DELETE');
      sendCmdSilent('lightview'); return;
    }
  });

  inner.addEventListener('change', async e => {
    const sel = e.target.closest('select[data-lv-update-id]');
    if (!sel) return;
    await _lvAPI(`/furniture/${sel.dataset.lvUpdateId}`, 'PUT', { [sel.dataset.lvUpdateField]: sel.value });
    sendCmdSilent('lightview');
  });
}

function _lvBtnStyle(color) {
  return `background:transparent;border:1px solid ${color};color:${color};font-family:var(--font-mono);font-size:10px;padding:3px 8px;cursor:pointer;border-radius:2px;margin-left:4px`;
}

function _lvToken() { return sessionStorage.getItem('devpanel-token'); }

async function _lvAPI(path, method = 'GET', body) {
  const token = _lvToken();
  if (!token) return null;
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch('/api' + path, opts).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

function _lvInlineForm(kind, existing) {
  let overlay = document.getElementById('lv-form-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lv-form-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:600;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';

  const zoneId = _lvData?.zoneId || '';
  const isNew = !existing;

  let formHtml;
  if (kind === 'light') {
    formHtml = `
      <div class="field" style="margin-bottom:10px"><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Name</label>
        <input id="lvf-name" value="${existing?.name || 'light fixture'}" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px"></div>
      <div class="field" style="margin-bottom:10px"><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Description</label>
        <textarea id="lvf-desc" rows="2" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px;resize:vertical">${existing?.description || 'A light fixture.'}</textarea></div>
      <div class="field" style="margin-bottom:10px"><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Type</label>
        <select id="lvf-type" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px">
          ${['overhead', 'lamp', 'streetlight'].map(t => `<option value="${t}" ${(existing?.light_type || 'lamp') === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select></div>`;
  } else {
    formHtml = `
      <div class="field" style="margin-bottom:10px"><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Name</label>
        <input id="lvf-name" value="${existing?.name || 'window'}" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px"></div>
      <div class="field" style="margin-bottom:10px"><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Description</label>
        <textarea id="lvf-desc" rows="2" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px;resize:vertical">${existing?.description || 'A window.'}</textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
        <div><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Curtain</label>
          <select id="lvf-curtain" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px">
            <option value="1" ${(existing?.curtain_open ?? 1) ? 'selected' : ''}>Open</option>
            <option value="0" ${existing?.curtain_open === 0 ? 'selected' : ''}>Closed</option>
          </select></div>
        <div><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Glass</label>
          <select id="lvf-glass" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px">
            <option value="intact" ${(existing?.glass_state || 'intact') === 'intact' ? 'selected' : ''}>Intact</option>
            <option value="broken" ${existing?.glass_state === 'broken' ? 'selected' : ''}>Broken</option>
          </select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
        <div><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Light transmission (0–1)</label>
          <input id="lvf-lighttrans" type="number" min="0" max="1" step="0.05" value="${existing?.light_transmission ?? 0.8}" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px"></div>
        <div><label style="font-size:11px;color:var(--text-dim);display:block;margin-bottom:4px">Exterior zone ID <span style="color:var(--border)">(blank=outdoors)</span></label>
          <input id="lvf-exterior" value="${existing?.zone_exterior || ''}" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 8px"></div>
      </div>`;
  }

  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;width:420px;padding:16px;font-family:var(--font-mono)">
      <div style="font-size:12px;font-weight:bold;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">
        ${isNew ? 'Add' : 'Edit'} ${kind === 'light' ? 'Light Fixture' : 'Window'}
      </div>
      ${formHtml}
      <div style="display:flex;gap:8px;margin-top:4px">
        <button id="lvf-save" style="${_lvBtnStyle('var(--green)')}">Save</button>
        <button id="lvf-cancel" style="${_lvBtnStyle('var(--text-dim)')}">Cancel</button>
      </div>
    </div>`;

  document.getElementById('lvf-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
  document.getElementById('lvf-save').addEventListener('click', async () => {
    const name = document.getElementById('lvf-name').value.trim();
    if (!name) return;
    if (kind === 'light') {
      const b = { zone_id: zoneId, name, description: document.getElementById('lvf-desc').value.trim(), is_light: 1, light_on: 1, light_type: document.getElementById('lvf-type').value };
      const r = isNew ? await _lvAPI('/furniture', 'POST', b) : await _lvAPI(`/furniture/${existing.id}`, 'PUT', b);
      if (r?.error) { alert(r.error); return; }
    } else {
      const b = { zone_interior: zoneId, name, description: document.getElementById('lvf-desc').value.trim(), curtain_open: parseInt(document.getElementById('lvf-curtain').value), glass_state: document.getElementById('lvf-glass').value, light_transmission: parseFloat(document.getElementById('lvf-lighttrans').value) || 0.8, zone_exterior: document.getElementById('lvf-exterior').value.trim() || null };
      const r = isNew ? await _lvAPI('/windows', 'POST', b) : await _lvAPI(`/windows/${existing.id}`, 'PUT', b);
      if (r?.error) { alert(r.error); return; }
    }
    overlay.style.display = 'none';
    sendCmdSilent('lightview');
  });
}
