// Broadcast themes panel — create/edit CSS variable overrides for the TV panel.
// Includes live preview and color picker inputs.
// All functions land in global scope (no modules).

// Derive broadcast colors from a UI theme's CSS variables (LIGHT_THEMES / DARK_THEMES from settings.js)
function _broadcastColorsFromTheme(themeId) {
  const c = _getBuiltinThemeColors(themeId);
  return {
    bg_color:     c['--bg']     || '#080c10',
    border_color: c['--border'] || '#1a2a22',
    text_color:   c['--text']   || '#b8d4c8',
    header_color: c['--accent'] || '#00dbb4',
    live_color:   c['--red']    || '#ff4455',
    ticker_color: c['--yellow'] || '#ffc940',
  };
}

let _themeList = [];
let _themeEditTarget = null;

// ── Panel render ─────────────────────────────────────────────────────────────

function renderThemesPanel(data) {
  _themeList = Array.isArray(data) ? data : [];
  const panel = document.getElementById('list-panel');

  const previewSwatch = (t) => {
    const bg = t.bg_color || '#080c10';
    const border = t.border_color || 'rgba(0,220,180,0.45)';
    const hdr = t.header_color || '#00dbb4';
    return `<div style="display:inline-flex;gap:3px;vertical-align:middle">
      <div style="width:14px;height:14px;background:${escHtml3(bg)};border:1px solid ${escHtml3(border)};border-radius:1px"></div>
      <div style="width:14px;height:14px;background:${escHtml3(hdr)};border-radius:1px"></div>
    </div>`;
  };

  const rows = _themeList.map(t => `<tr>
    <td style="font-weight:600;color:var(--text-bright)">${escHtml3(t.name)}</td>
    <td>${previewSwatch(t)}</td>
    <td style="font-size:11px;color:var(--text-dim)">${escHtml3(t.preset || 'corporate')}</td>
    <td style="font-size:11px;color:var(--text-dim)">${escHtml3(t.description || '')}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="openBroadcastThemeEditor(${JSON.stringify(t).replace(/"/g,'&quot;')})">✏ Edit</button>
      <button class="action-btn danger" style="font-size:10px;padding:3px 8px;margin-left:4px" onclick="deleteTheme('${t.id}','${escHtml3(t.name).replace(/'/g,"\\'")}')">✕</button>
    </td>
  </tr>`).join('');

  panel.innerHTML = `
    <div style="padding:10px 16px;border-bottom:2px solid var(--border);background:var(--bg2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--accent);letter-spacing:1px;text-transform:uppercase">TV Themes</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${_themeList.length} theme${_themeList.length !== 1 ? 's' : ''} — applied to channels via the channel editor</div>
        </div>
        <button class="action-btn" onclick="openBroadcastThemeEditor(null)">+ New Theme</button>
      </div>
      ${_themeList.length ? `
      <table>
        <thead><tr><th>Name</th><th>Swatch</th><th>Preset</th><th>Description</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<div style="padding:24px;color:var(--text-dim)">No themes yet. Create one and assign it to a channel.</div>'}
    </div>`;
}

// ── Theme editor modal ────────────────────────────────────────────────────────

function openBroadcastThemeEditor(rec) {
  _themeEditTarget = rec || null;

  const currentPreset = rec?.preset || 'dark';
  const presetOpts =
    `<optgroup label="Light Themes">${LIGHT_THEMES.map(([v,l]) => `<option value="${v}"${currentPreset===v?' selected':''}>${l}</option>`).join('')}</optgroup>` +
    `<optgroup label="Dark Themes">${DARK_THEMES.map(([v,l])  => `<option value="${v}"${currentPreset===v?' selected':''}>${l}</option>`).join('')}</optgroup>`;

  // Color row: text input + color picker side by side
  const colorRow = (label, field, val) => {
    const safeVal = escHtml3(val || '');
    // Try to derive a hex for the color picker (best-effort; rgba won't work perfectly)
    const hexGuess = (val || '').match(/^#[0-9a-fA-F]{3,6}$/) ? val : '';
    return `
    <div style="display:flex;flex-direction:column;gap:4px">
      <label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">${label}</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="color" id="th-pick-${field}" value="${hexGuess || '#000000'}"
          style="width:36px;height:28px;border:1px solid var(--border);border-radius:2px;padding:1px;cursor:pointer;background:none"
          oninput="_themePickerSync('${field}', this.value)">
        <input id="th-${field}" class="form-input" value="${safeVal}" placeholder="blank = CSS default"
          style="flex:1" oninput="_themeTextSync('${field}', this.value)">
      </div>
    </div>`;
  };

  const body = `
    <div style="display:flex;gap:16px">
      <!-- Left: form controls -->
      <div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Name *</label>
            <input id="th-name" class="form-input" value="${escHtml3(rec?.name || '')}" placeholder="Theme name">
          </div>
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Preset</label>
            <select id="th-preset" class="form-input" onchange="_themeApplyPreset(this.value)">${presetOpts}</select>
          </div>
        </div>
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Description</label>
          <input id="th-description" class="form-input" value="${escHtml3(rec?.description || '')}" placeholder="Optional">
        </div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);border-bottom:1px solid var(--border);padding-bottom:4px;margin-top:2px">Color Overrides</div>
        ${colorRow('Background', 'bg_color', rec?.bg_color)}
        ${colorRow('Border / Accent', 'border_color', rec?.border_color)}
        ${colorRow('Body Text', 'text_color', rec?.text_color)}
        ${colorRow('Header Color', 'header_color', rec?.header_color)}
        ${colorRow('Live Badge', 'live_color', rec?.live_color)}
        ${colorRow('Ticker', 'ticker_color', rec?.ticker_color)}
        <div>
          <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:4px">Scanlines</label>
          <select id="th-scanlines" class="form-input">
            <option value="0"${(rec?.scanlines ?? 1) === 0 ? ' selected' : ''}>Off</option>
            <option value="1"${(rec?.scanlines ?? 1) === 1 ? ' selected' : ''}>Subtle (default)</option>
            <option value="2"${(rec?.scanlines ?? 1) === 2 ? ' selected' : ''}>Heavy (CRT)</option>
          </select>
        </div>
      </div>

      <!-- Right: live preview -->
      <div style="width:260px;flex-shrink:0">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Live Preview</div>
        <div id="th-preview-win" style="
          width:100%;
          aspect-ratio:16/10;
          display:flex;
          flex-direction:column;
          font-family:monospace;
          border:1px solid var(--border);
          overflow:hidden;
          font-size:10px;
          position:relative;
        ">
          <!-- preview header -->
          <div id="th-preview-hdr" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;flex-shrink:0;border-bottom:1px solid;gap:4px">
            <span id="th-preview-station" style="font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-size:9px">STATION NAME</span>
            <span style="font-size:9px;opacity:0.7">CH 1</span>
            <span id="th-preview-live" style="font-size:8px;letter-spacing:1px;font-weight:bold">● LIVE</span>
          </div>
          <!-- preview body -->
          <div style="flex:1;padding:6px 8px;overflow:hidden;line-height:1.5">
            <div id="th-preview-text" style="font-size:9px">Breaking: tensions escalate in the Sprawl as</div>
            <div id="th-preview-text2" style="font-size:9px;opacity:0.6">martial law advisory issued for Zone 4.</div>
          </div>
          <!-- lower third overlay sample -->
          <div id="th-preview-lt" style="padding:4px 8px;border-top:3px solid">
            <div id="th-preview-lt-name" style="font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">DR. ELAINE VOSS</div>
            <div id="th-preview-lt-sub" style="font-size:8px;opacity:0.75;margin-top:1px">Chief Science Officer, NovaCorp</div>
          </div>
          <!-- preview footer ticker -->
          <div id="th-preview-footer" style="padding:3px 8px;font-size:8px;letter-spacing:0.5px;border-top:1px solid">
            BREAKING NEWS ● Power grid failure imminent ●
          </div>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:6px">Colors update as you edit. Shows lower-third overlay sample.</div>
      </div>
    </div>`;

  openModal(rec ? `Edit Theme: ${escHtml3(rec.name)}` : 'New Theme', body);
  document.getElementById('modal-save').onclick = saveTheme;
  const card = document.querySelector('#generic-modal .modal-card');
  if (card) card.style.width = '780px';

  // Seed colors from preset when creating a new theme
  if (!rec) setTimeout(() => _themeApplyPreset(currentPreset), 0);
  else setTimeout(_updateThemePreview, 0);

  // Wire all inputs to update preview
  ['bg_color','border_color','text_color','header_color','live_color','ticker_color','scanlines'].forEach(f => {
    document.getElementById(`th-${f}`)?.addEventListener('input', _updateThemePreview);
    document.getElementById(`th-pick-${f}`)?.addEventListener('input', _updateThemePreview);
  });
}

function _themePickerSync(field, hex) {
  const txt = document.getElementById(`th-${field}`);
  if (txt) txt.value = hex;
  _updateThemePreview();
}

function _themeTextSync(field, val) {
  // Try to update color picker if it's a plain hex
  const pick = document.getElementById(`th-pick-${field}`);
  if (pick && /^#[0-9a-fA-F]{6}$/.test(val.trim())) pick.value = val.trim();
  _updateThemePreview();
}

function _themeApplyPreset(preset) {
  const seed = _broadcastColorsFromTheme(preset);
  const fields = ['bg_color','border_color','text_color','header_color','live_color','ticker_color'];
  for (const f of fields) {
    const v = seed[f] || '';
    const txt = document.getElementById(`th-${f}`);
    const pick = document.getElementById(`th-pick-${f}`);
    if (txt) txt.value = v;
    if (pick && /^#[0-9a-fA-F]{6}$/.test(v)) pick.value = v;
  }
  _updateThemePreview();
}

function _updateThemePreview() {
  const get = (f) => (document.getElementById(`th-${f}`)?.value || '').trim();
  const bg     = get('bg_color')     || '#080c10';
  const border = get('border_color') || 'rgba(0,220,180,0.45)';
  const text   = get('text_color')   || '#b8d4c8';
  const hdr    = get('header_color') || '#00dbb4';
  const live   = get('live_color')   || '#ff4455';
  const ticker = get('ticker_color') || '#ffc940';

  const win = document.getElementById('th-preview-win');
  if (!win) return;
  win.style.background = bg;
  win.style.borderColor = border;
  win.style.color = text;

  const phdr = document.getElementById('th-preview-hdr');
  if (phdr) { phdr.style.background = 'rgba(0,0,0,0.4)'; phdr.style.borderBottomColor = border; }
  const pstation = document.getElementById('th-preview-station');
  if (pstation) pstation.style.color = hdr;
  const plive = document.getElementById('th-preview-live');
  if (plive) plive.style.color = live;
  const pt1 = document.getElementById('th-preview-text');
  if (pt1) pt1.style.color = text;
  const pt2 = document.getElementById('th-preview-text2');
  if (pt2) pt2.style.color = text;
  const plt = document.getElementById('th-preview-lt');
  if (plt) { plt.style.background = 'rgba(0,0,0,0.85)'; plt.style.borderTopColor = hdr; }
  const pltname = document.getElementById('th-preview-lt-name');
  if (pltname) pltname.style.color = hdr;
  const pltsub = document.getElementById('th-preview-lt-sub');
  if (pltsub) pltsub.style.color = text;
  const pfooter = document.getElementById('th-preview-footer');
  if (pfooter) { pfooter.style.color = ticker; pfooter.style.borderTopColor = border; pfooter.style.background = 'rgba(0,0,0,0.5)'; }
}

async function saveTheme() {
  const name = document.getElementById('th-name')?.value?.trim();
  if (!name) { toast('Name is required.', true); return; }

  const get = (id) => document.getElementById(id)?.value?.trim() || '';

  const payload = {
    name,
    description: get('th-description'),
    preset: document.getElementById('th-preset')?.value || 'corporate',
    bg_color: get('th-bg_color'),
    border_color: get('th-border_color'),
    text_color: get('th-text_color'),
    header_color: get('th-header_color'),
    live_color: get('th-live_color'),
    ticker_color: get('th-ticker_color'),
    scanlines: parseInt(document.getElementById('th-scanlines')?.value ?? '1', 10),
  };

  try {
    if (_themeEditTarget) {
      await directAPI(`/broadcast/themes/${_themeEditTarget.id}`, 'PUT', payload);
    } else {
      await directAPI('/broadcast/themes', 'POST', payload);
    }
    closeModal();
    toast('Theme saved.');
    await bcSuiteRefresh('themes');
  } catch (e) {
    toast(`Save failed: ${e.message}`, true);
  }
}

async function deleteTheme(id, name) {
  if (!(await dpConfirm(`Delete theme "${name}"?`, { danger: true }))) return;
  try {
    await directAPI(`/broadcast/themes/${id}`, 'DELETE');
    toast('Theme deleted.');
    await bcSuiteRefresh('themes');
  } catch (e) {
    toast(`Delete failed: ${e.message}`, true);
  }
}

function escHtml3(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
