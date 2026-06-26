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
    </div>`;
}

// --- Players panel ---

