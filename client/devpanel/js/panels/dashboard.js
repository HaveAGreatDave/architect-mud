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
      <div id="checkin-banner" style="margin-bottom:22px"></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:28px">
        ${card('👥', 'Players Online', online.length, online.length ? online.map(p=>p.handle).join(', ') : 'None', "showPanel('players')")}
        ${card('🛡', 'Admins Online', admins.length, admins.length ? admins.map(p=>p.handle).join(', ') : 'None', "showPanel('players')")}
        ${card('🕐', 'Server Time', timeStr, `${dateStr} · ${season} · ${weatherStr}`, "showPanel('timeweather')")}
        ${card('👾', 'Live Enemies', data.live_enemies ?? '—', `${(data.zones||[]).length} zones active`, "showPanel('enemies')")}
      </div>

      <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">7-Day Forecast</div>
      ${forecastHtml}

      <div style="margin-top:28px">
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Active Players</div>
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px">
          <div style="display:flex;align-items:flex-start;gap:28px;margin-bottom:14px">
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">Active Now</div>
              <div id="pcl-active-now" style="font-size:22px;font-weight:700;color:var(--text-bright)">${online.length}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">Peak Concurrent</div>
              <div id="pcl-peak" style="font-size:22px;font-weight:700;color:var(--text-bright)">—</div>
            </div>
            <div style="margin-left:auto;display:flex;gap:4px" id="pcl-range-toggle">
              <button data-range="7d"  style="${btnStyle(false)}">7 Days</button>
              <button data-range="30d" style="${btnStyle(true)}">30 Days</button>
              <button data-range="all" style="${btnStyle(false)}">All Time</button>
            </div>
          </div>
          <div id="pcl-chart" style="width:100%;height:120px"></div>
        </div>
      </div>

      <div style="margin-top:28px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Server Activity Log</div>
          <button id="log-collapse-btn" onclick="(function(){var b=document.getElementById('log-section-body');var btn=document.getElementById('log-collapse-btn');var hidden=b.style.display==='none';b.style.display=hidden?'':'none';btn.textContent=hidden?'Hide':'Show';})()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:2px 8px;cursor:pointer;border-radius:2px">Hide</button>
        </div>
        <div id="log-section-body" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px">
          <textarea id="activity-log-box"
            readonly
            spellcheck="false"
            style="width:100%;height:360px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:10px;box-sizing:border-box;resize:none;border-radius:2px;line-height:1.52;white-space:pre;overflow:auto;word-wrap:normal;overflow-wrap:normal"
            placeholder="Loading…"></textarea>
        </div>
      </div>

      <div style="margin-top:28px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Message of the Day</div>
          <button id="motd-collapse-btn" onclick="(function(){var b=document.getElementById('motd-section-body');var btn=document.getElementById('motd-collapse-btn');var hidden=b.style.display==='none';b.style.display=hidden?'':'none';btn.textContent=hidden?'Hide':'Show';})()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:2px 8px;cursor:pointer;border-radius:2px">Hide</button>
        </div>
        <div id="motd-section-body" style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px">

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

          <!-- MOTD Template editor -->
          <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:6px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px">MOTD Template</div>
          <textarea id="motd-editor"
            readonly
            spellcheck="false"
            style="width:100%;height:360px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.3;white-space:pre;overflow:auto;word-wrap:normal;overflow-wrap:normal"
            placeholder="Loading…"></textarea>
          <div style="margin-top:8px">
            <button id="motd-save-btn" style="background:var(--accent);border:none;color:#000;font-family:var(--font-mono);font-size:11px;font-weight:600;padding:6px 18px;cursor:pointer;border-radius:2px">Save</button>
          </div>

          <!-- Dynamic text editor -->
          <div style="margin-top:14px">
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:6px;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px">Dynamic Text <span style="font-weight:400;color:var(--text-dim);font-size:10px">(replaces &lt;dynamic text&gt; in all sizes)</span></div>
            <textarea id="motd-dynamic"
              spellcheck="false"
              style="width:100%;height:60px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:8px 10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.4"
              placeholder="e.g. Systems are online."></textarea>
            <div style="margin-top:8px">
              <button id="motd-push-btn" style="background:var(--accent);border:none;color:#000;font-family:var(--font-mono);font-size:11px;font-weight:600;padding:6px 18px;cursor:pointer;border-radius:2px">Send</button>
              <span id="motd-status" style="font-size:10px;color:var(--text-dim);margin-left:10px"></span>
            </div>
          </div>

        </div>
      </div>

    </div>`;

  _initMotdEditor();
  _initActivityLog();
  _initPlayerCountChart();
  _initCheckinBanner();
}

// ── "Since you last checked in" banner ────────────────────────────────────────
// Surfaces what other contributors added since this dev last cleared the banner:
// recent commits + any unresolved action-required Dev Log notes. Last-seen is a
// per-handle localStorage marker (nothing server-side to keep in sync).

async function _initCheckinBanner() {
  const el = document.getElementById('checkin-banner');
  if (!el) return;
  const handle = (typeof devHandle !== 'undefined' && devHandle) || 'dev';
  const key = 'devLastSeen:' + handle;
  const last = localStorage.getItem(key);
  const firstVisit = !last;

  const [act, notesResp] = await Promise.all([
    directAPI('/dev/activity' + (last ? `?since=${encodeURIComponent(last)}` : '')),
    directAPI('/dev/notes'),
  ]);
  const allCommits = (act && act.commits) || [];
  // "By others" — exclude commits resolved to this dev's own handle. Unmapped
  // authors count as others (can't prove they're you).
  const commits   = allCommits.filter(c => !(c.handle && c.handle === handle));
  const notes     = (notesResp && notesResp.notes) || [];
  const actionReq = notes.filter(n => n.kind === 'action-required' && !n.resolved);

  if (!commits.length && !actionReq.length && !firstVisit) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text-dim);border:1px solid var(--border);border-radius:4px;padding:10px 14px;background:var(--bg2)">✓ You're up to date — nothing new since your last check-in.</div>`;
    return;
  }

  const authors = [...new Set(commits.map(c => c.handle || c.author))];
  const sinceLabel = last
    ? `since ${new Date(last).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}`
    : 'in the last 14 days';

  const coreCount = commits.filter(c => c.core).length;
  const bits = [];
  if (commits.length) bits.push(`<strong style="color:var(--text-bright)">${commits.length}</strong> commit${commits.length===1?'':'s'}${authors.length ? ` by ${authors.slice(0,4).map(a=>_dashEsc(a)).join(', ')}${authors.length>4?'…':''}` : ''}`);
  if (coreCount) bits.push(`<strong style="color:var(--red)">⚙ ${coreCount}</strong> core-engine change${coreCount===1?'':'s'}`);
  if (actionReq.length) bits.push(`<strong style="color:var(--red)">${actionReq.length}</strong> action-required note${actionReq.length===1?'':'s'}`);
  const summary = bits.length ? bits.join(' · ') : 'Welcome — no code activity yet.';

  const noteList = actionReq.slice(0, 4).map(n =>
    `<div style="font-size:11px;color:var(--text);margin-top:4px">⚠ <strong>${_dashEsc(n.title)}</strong><span style="color:var(--text-dim)"> — ${_dashEsc(n.author)}</span></div>`
  ).join('');

  const accent = actionReq.length ? 'var(--red)' : 'var(--accent)';
  el.innerHTML = `
    <div style="border:1px solid var(--border);border-left:3px solid ${accent};border-radius:4px;padding:12px 16px;background:var(--bg2)">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Since you last checked in</span>
        <span style="font-size:12px;color:var(--text)">${summary} <span style="color:var(--text-dim)">${sinceLabel}</span></span>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button onclick="showPanel('devlog')" style="background:transparent;border:1px solid var(--border);color:var(--accent);font-family:var(--font-mono);font-size:10px;padding:3px 10px;cursor:pointer;border-radius:2px">Open Dev Log</button>
          <button onclick="_checkinMarkRead()" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:3px 10px;cursor:pointer;border-radius:2px">Mark all read</button>
        </span>
      </div>
      ${noteList}
    </div>`;
}

function _dashEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function _checkinMarkRead() {
  const handle = (typeof devHandle !== 'undefined' && devHandle) || 'dev';
  localStorage.setItem('devLastSeen:' + handle, new Date().toISOString());
  _initCheckinBanner();
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

  function _setEditorContent(text) {
    if (!editor) return;
    editor.value = text != null ? text : (_motd[_view] || '');
  }

  function _updateEditor() {
    if (!editor) return;
    editor.readOnly = _readonly;
    editor.style.color       = _readonly ? 'var(--text-dim)' : 'var(--text)';
    editor.style.borderColor = _readonly ? 'var(--border)' : 'var(--accent)';
  }

  function _setView(v) {
    if (!_readonly && editor) _motd[_view] = editor.value;
    _view = v;
    _refreshToggleBtns();
    _setEditorContent();
    _updateEditor();
  }

  function _toggleReadonly() {
    if (!_readonly && editor) _motd[_view] = editor.value;
    _readonly = !_readonly;
    readonlyBtn.textContent  = _readonly ? 'ON' : 'OFF';
    readonlyBtn.style.borderColor = _readonly ? 'var(--accent)' : 'var(--yellow)';
    readonlyBtn.style.color       = _readonly ? 'var(--accent)' : 'var(--yellow)';
    _updateEditor(); // only toggles editability — content unchanged
  }

  toggleBig?.addEventListener('click',    () => _setView('big'));
  toggleMedium?.addEventListener('click', () => _setView('medium'));
  toggleSmall?.addEventListener('click',  () => _setView('small'));
  readonlyBtn?.addEventListener('click',  _toggleReadonly);

  function _showStatus(msg, ok = true) {
    if (!status) return;
    status.textContent  = msg;
    status.style.color  = ok ? 'var(--green)' : 'var(--red)';
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
  }

  saveBtn.addEventListener('click', async () => {
    if (!_readonly && editor) _motd[_view] = editor.value;
    const dyn = dynamicBox?.value ?? '';
    const body = { big: _motd.big, medium: _motd.medium, small: _motd.small, dynamic: dyn };

    saveBtn.disabled = true;
    const d = await directAPI('/motd', 'PUT', body);
    if (d.ok) {
      _motd.dynamic = dyn;
      _showStatus('✓ Saved (all)');
    } else {
      _showStatus(d.error || 'Error', false);
    }
    saveBtn.disabled = false;
  });

  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true;
    const dyn = dynamicBox?.value ?? '';
    const d = await directAPI('/motd/push', 'POST', { dynamic: dyn });
    if (d.ok) _motd.dynamic = dyn;
    _showStatus(d.ok ? '✓ Pushed to all players' : (d.error || 'Error'), d.ok);
    pushBtn.disabled = false;
  });

  // Load from server
  const d = await directAPI('/motd');
  if (d.error) {
    if (editor) editor.placeholder = 'Failed to load MOTD.';
  } else {
    _motd = { big: d.big || '', medium: d.medium || '', small: d.small || '', dynamic: d.dynamic || '' };
    if (dynamicBox) dynamicBox.value = _motd.dynamic;
    _refreshToggleBtns();
    _setEditorContent();
    _updateEditor();
  }
}

async function _initActivityLog() {
  const box = document.getElementById('activity-log-box');
  if (!box) return;
  const d = await directAPI('/server-activity-log');
  if (d.error || !d.rows?.length) { box.value = d.error ? 'Failed to load activity log.' : '(no activity yet)'; return; }
  const lines = d.rows.map(row => {
    const ts = new Date(row.occurred_at).toLocaleString();
    if (row.event_type === 'connect')      return `[${ts}] *** ${row.handle} Connects`;
    if (row.event_type === 'disconnect')   return `[${ts}] *** ${row.handle} Disconnects`;
    if (row.event_type === 'death')        return `[${ts}] ${row.handle} Dies`;
    if (row.event_type === 'kick')         return `[${ts}] ${row.handle} was kicked by ${row.admin_handle || 'An administrator'}`;
    if (row.event_type === 'pvp_kill')     return `[${ts}] ☠ ${row.handle} killed ${row.detail || '???'}`;
    if (row.event_type === 'char_created') return `[${ts}] ✦ ${row.handle} created`;
    if (row.event_type === 'admin_cmd')    return `[${ts}] [ADMIN] ${row.handle}: ${row.detail || ''}`;
    if (row.event_type === 'timescale')    return `[${ts}] ⏱ [ADMIN] ${row.handle} ${row.detail || 'changed game speed'}`;
    return `[${ts}] ${row.event_type}: ${row.handle}`;
  });
  box.value = lines.join('\n');
}

async function _initPlayerCountChart(rangeKey = '30d') {
  const container = document.getElementById('pcl-chart');
  const peakEl    = document.getElementById('pcl-peak');
  const toggle    = document.getElementById('pcl-range-toggle');
  if (!container) return;

  // Wire the range buttons once, on first render.
  if (toggle && !toggle.dataset.wired) {
    toggle.dataset.wired = '1';
    toggle.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach(b => {
          const active = b === btn;
          b.style.background  = active ? 'var(--bg3)'    : 'transparent';
          b.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
          b.style.color       = active ? 'var(--accent)' : 'var(--text-dim)';
        });
        _initPlayerCountChart(btn.dataset.range);
      });
    });
  }

  container.innerHTML = `<div style="height:120px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-dim)">Loading…</div>`;
  const d = await directAPI('/player-count-log?range=' + encodeURIComponent(rangeKey));
  const rows = (d.rows || []);

  const peak = rows.length ? Math.max(...rows.map(r => r.count)) : 0;
  if (peakEl) peakEl.textContent = rows.length ? peak : '—';

  if (rows.length < 2) {
    container.innerHTML = `<div style="height:120px;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-dim)">${rows.length === 0 ? 'No data yet — check back in a minute.' : 'Collecting data…'}</div>`;
    return;
  }

  const W = 900, H = 100, PAD = 4;
  const counts = rows.map(r => r.count);
  const maxV   = Math.max(...counts, 1);
  const minV   = 0;
  const range  = maxV - minV || 1;

  const x = (i) => PAD + (i / (rows.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - minV) / range) * (H - PAD * 2);

  const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r.count).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${H} ` +
    rows.map((r, i) => `L${x(i).toFixed(1)},${y(r.count).toFixed(1)}`).join(' ') +
    ` L${x(rows.length - 1).toFixed(1)},${H} Z`;

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:120px;display:block">
      <defs>
        <linearGradient id="pcl-line-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e05555"/>
          <stop offset="100%" stop-color="#55bb55"/>
        </linearGradient>
        <linearGradient id="pcl-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e05555" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#55bb55" stop-opacity="0.04"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#pcl-area-grad)"/>
      <polyline points="${pts}" fill="none" stroke="url(#pcl-line-grad)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

// --- Players panel ---
