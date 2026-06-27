function renderDashboard(data) {
  const panel = document.getElementById('list-panel');
  const online = (data.online_players || []);
  const admins = online.filter(p => ['admin','dev','builder','designer'].includes(p.role));
  const env = data._env || window._lastEnv || {};
  const forecast = env.forecast || [];
  const timeStr = env.time || '—';
  const dateStr = env.date || '—';
  const season = env.season || '—';
  const weatherStr = env.weatherType ? `${env.weatherIcon || ''} ${env.weatherType}  ${env.tempC != null ? env.tempC + '°C' : ''}`.trim() : '—';

  const card = (icon, label, value, sub, onclick) => `
    <div onclick="${onclick}" style="cursor:pointer;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px 24px;display:flex;flex-direction:column;gap:6px" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="font-size:22px">${icon}</div>
      <div style="font-size:26px;font-weight:700;color:var(--text-bright)">${value}</div>
      <div style="font-size:12px;font-weight:600;color:var(--text)">${label}</div>
      ${sub ? `<div style="font-size:11px;color:var(--text-dim)">${sub}</div>` : ''}
    </div>`;

  const dayLabel = (f, i) => {
    if (f.date) { const d = new Date(f.date); return isNaN(d) ? `Day ${i}` : d.toLocaleDateString(undefined,{weekday:'short'}); }
    return i === 0 ? 'Today' : `+${i}d`;
  };

  const forecastHtml = forecast.length
    ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
        ${forecast.slice(0,7).map((f,i)=>`
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:10px 14px;text-align:center;min-width:72px">
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">${dayLabel(f,i)}</div>
            <div style="font-size:22px;margin-bottom:4px">${f.icon||'?'}</div>
            <div style="font-size:11px;color:var(--text)">${f.weatherType||'?'}</div>
            ${f.tempC!=null?`<div style="font-size:10px;color:var(--text-dim);margin-top:2px">${f.tempC}°C</div>`:''}
          </div>`).join('')}
      </div>`
    : `<div style="font-size:12px;color:var(--text-dim)">No forecast data — weather plugin may not be active.</div>`;

  const btnStyle = (active) => `flex:1;background:${active?'var(--bg3)':'transparent'};border:1px solid ${active?'var(--accent)':'var(--border)'};color:${active?'var(--accent)':'var(--text-dim)'};font-family:var(--font-mono);font-size:11px;padding:5px 8px;cursor:pointer;border-radius:2px`;

  panel.innerHTML = `
    <div style="padding:24px;max-width:1000px">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:28px">
        ${card('👥', 'Players Online', online.length, online.length ? online.map(p=>p.handle).join(', ') : 'None', "showPanel('players')")}
        ${card('🛡', 'Admins Online', admins.length, admins.length ? admins.map(p=>p.handle).join(', ') : 'None', "showPanel('players')")}
        ${card('🕐', 'Server Time', timeStr, `${dateStr} · ${season} · ${weatherStr}`, "showPanel('timeweather')")}
        ${card('👾', 'Live Enemies', data.live_enemies ?? '—', `${(data.zones||[]).length} zones active`, "showPanel('enemies')")}
      </div>

      <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">7-Day Forecast</div>
      ${forecastHtml}

      <div style="margin-top:28px">
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Message of the Day</div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px">

          <!-- Top bar: size toggle + read-only toggle -->
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
            <div style="display:flex;gap:4px">
              <button id="motd-toggle-big"    style="${btnStyle(true)}">Big</button>
              <button id="motd-toggle-medium" style="${btnStyle(false)}">Medium</button>
              <button id="motd-toggle-small"  style="${btnStyle(false)}">Small</button>
            </div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">Read Only</span>
              <button id="motd-readonly-toggle" style="background:var(--bg3);border:1px solid var(--accent);color:var(--accent);font-family:var(--font-mono);font-size:11px;padding:4px 12px;cursor:pointer;border-radius:2px;min-width:44px">ON</button>
            </div>
          </div>

          <!-- MOTD text editor -->
          <textarea id="motd-editor"
            readonly
            spellcheck="false"
            style="width:100%;height:360px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.3;white-space:pre;overflow:auto;word-wrap:normal;overflow-wrap:normal"
            placeholder="Loading…"></textarea>

          <!-- Dynamic text editor -->
          <div style="margin-top:14px">
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:6px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px">Dynamic Text <span style="font-weight:400;color:var(--text-dim);font-size:10px">(replaces &lt;dynamic text&gt; in all sizes)</span></div>
            <textarea id="motd-dynamic"
              spellcheck="false"
              style="width:100%;height:60px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:8px 10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.4"
              placeholder="e.g. Systems are online."></textarea>
          </div>

          <!-- Action buttons -->
          <div style="display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap">
            <button id="motd-save-btn" style="background:var(--accent);border:none;color:#000;font-family:var(--font-mono);font-size:11px;font-weight:600;padding:6px 18px;cursor:pointer;border-radius:2px">Save</button>
            <button id="motd-push-btn" style="background:transparent;border:1px solid var(--purple);color:var(--purple);font-family:var(--font-mono);font-size:11px;padding:6px 18px;cursor:pointer;border-radius:2px">Push MOTD</button>
            <span id="motd-status" style="font-size:11px;color:var(--text-dim)"></span>
          </div>

        </div>
      </div>
    </div>`;

  _initMotdEditor();
}

// ── MOTD editor logic ────────────────────────────────────────────────────────

async function _initMotdEditor() {
  const editor        = document.getElementById('motd-editor');
  const dynamicBox    = document.getElementById('motd-dynamic');
  const saveBtn       = document.getElementById('motd-save-btn');
  const pushBtn       = document.getElementById('motd-push-btn');
  const status        = document.getElementById('motd-status');
  const readonlyBtn   = document.getElementById('motd-readonly-toggle');
  const toggleBig     = document.getElementById('motd-toggle-big');
  const toggleMedium  = document.getElementById('motd-toggle-medium');
  const toggleSmall   = document.getElementById('motd-toggle-small');
  if (!editor || !saveBtn) return;

  let _view     = 'big';      // 'big' | 'medium' | 'small'
  let _readonly = true;
  let _motd     = { big: '', medium: '', small: '', dynamic: '' };

  const TOKEN = () => sessionStorage.getItem('devpanel-token');

  const btnStyle = (active) => {
    if (active) {
      return 'var(--bg3)';
    }
    return 'transparent';
  };

  function _refreshToggleBtns() {
    [['big', toggleBig], ['medium', toggleMedium], ['small', toggleSmall]].forEach(([key, btn]) => {
      if (!btn) return;
      const active = _view === key;
      btn.style.background   = active ? 'var(--bg3)'    : 'transparent';
      btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border)';
      btn.style.color        = active ? 'var(--accent)' : 'var(--text-dim)';
    });
  }

  function _getPreview(view) {
    const dyn = (dynamicBox?.value ?? _motd.dynamic) || '';
    return (_motd[view] || '').replace(/<dynamic text>/g, dyn || '[dynamic text]');
  }

  function _updateEditor() {
    if (!editor) return;
    editor.value    = _readonly ? _getPreview(_view) : (_motd[_view] || '');
    editor.readOnly = _readonly;
    editor.style.color       = _readonly ? 'var(--text-dim)' : 'var(--text)';
    editor.style.borderColor = _readonly ? 'var(--border)' : 'var(--accent)';
  }

  function _setView(v) {
    // Save current edits before switching if in edit mode
    if (!_readonly && editor) _motd[_view] = editor.value;
    _view = v;
    _refreshToggleBtns();
    _updateEditor();
  }

  function _toggleReadonly() {
    if (!_readonly && editor) _motd[_view] = editor.value; // save before locking
    _readonly = !_readonly;
    readonlyBtn.textContent  = _readonly ? 'ON' : 'OFF';
    readonlyBtn.style.borderColor = _readonly ? 'var(--accent)' : 'var(--yellow)';
    readonlyBtn.style.color       = _readonly ? 'var(--accent)' : 'var(--yellow)';
    _updateEditor();
  }

  // Update preview when dynamic text box changes (only in readonly mode)
  dynamicBox?.addEventListener('input', () => {
    if (_readonly) _updateEditor();
  });

  toggleBig?.addEventListener('click',    () => _setView('big'));
  toggleMedium?.addEventListener('click', () => _setView('medium'));
  toggleSmall?.addEventListener('click',  () => _setView('small'));
  readonlyBtn?.addEventListener('click',  _toggleReadonly);

  function _applySpaceAdjustment(template, dynamicText) {
    const removal = Math.max(0, 14 - dynamicText.length);
    return template.replace(/<player name>( *)/g, (_, spaces) => {
      const keep = Math.max(0, spaces.length - removal);
      return '<player name>' + spaces.slice(0, keep);
    });
  }

  function _showStatus(msg, ok = true) {
    if (!status) return;
    status.textContent  = msg;
    status.style.color  = ok ? 'var(--green)' : 'var(--red)';
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
  }

  saveBtn.addEventListener('click', async () => {
    // Capture current edit state into local store
    if (!_readonly && editor) _motd[_view] = editor.value;
    const dyn = dynamicBox?.value ?? '';

    // Only save the currently-viewed template + dynamic text.
    // Sending only the current view key means the other two slots are untouched in DB.
    const adjusted = _applySpaceAdjustment(_motd[_view] || '', dyn);
    const body = { [_view]: adjusted, dynamic: dyn };

    saveBtn.disabled = true;
    try {
      const r = await fetch('/api/motd', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        _motd[_view] = adjusted;
        _motd.dynamic = dyn;
        _updateEditor();
        _showStatus(`✓ Saved (${_view})`);
      } else {
        _showStatus(d.error || 'Error', false);
      }
    } catch { _showStatus('Network error', false); }
    saveBtn.disabled = false;
  });

  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true;
    try {
      const r = await fetch('/api/motd/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN()}` },
      });
      const d = await r.json();
      _showStatus(d.ok ? '✓ Pushed to all players' : (d.error || 'Error'), d.ok);
    } catch { _showStatus('Network error', false); }
    pushBtn.disabled = false;
  });

  // Load from server
  try {
    const r = await fetch('/api/motd', { headers: { Authorization: `Bearer ${TOKEN()}` } });
    const d = await r.json();
    _motd = { big: d.big || '', medium: d.medium || '', small: d.small || '', dynamic: d.dynamic || '' };
    if (dynamicBox) dynamicBox.value = _motd.dynamic;
    _refreshToggleBtns();
    _updateEditor();
  } catch {
    if (editor) editor.placeholder = 'Failed to load MOTD.';
  }
}

// --- Players panel ---
