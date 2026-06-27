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

  // Day label: use date string shortened, or forecastDay offset
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

  panel.innerHTML = `
    <div style="padding:24px;max-width:860px">
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
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Shown to all players on login via #system channel. Use <code style="color:var(--accent)">&lt;dynamic current date&gt;</code> and <code style="color:var(--accent)">&lt;player name&gt;</code> as placeholders.</div>
          <textarea id="motd-editor" spellcheck="false" style="width:100%;height:320px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.4" placeholder="Loading…"></textarea>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
            <button id="motd-save-btn" style="background:var(--accent);border:none;color:#000;font-family:var(--font-mono);font-size:11px;font-weight:600;padding:6px 18px;cursor:pointer;border-radius:2px">Save MOTD</button>
            <span id="motd-status" style="font-size:11px;color:var(--text-dim)"></span>
          </div>
        </div>
      </div>
    </div>`;

  // Load and wire MOTD editor
  _initMotdEditor();
}

// --- Players panel ---

