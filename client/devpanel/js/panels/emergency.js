function _arbiterDot(arbiters) {
  if (arbiters?.active && !arbiters?.standingDown) return { color: '#ff4444', label: 'DEPLOYED' };
  if (arbiters?.standingDown)                      return { color: '#f59e0b', label: 'STANDING DOWN' };
  return { color: '#22c55e', label: 'READY' };
}

// ── Live crime log (perpetrator / zone / crime / wanted) ──────────────────────
const _crimeEsc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function _starBar(n) {
  n = Number(n) || 0;
  const full = Math.floor(n);
  const half = (n - full) >= 0.5;
  const empty = Math.max(0, 5 - full - (half ? 1 : 0));
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function _ago(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function _crimeRows(rows, isHistory) {
  return rows.map(c => `
    <tr>
      <td style="padding:5px 12px 5px 0;color:var(--text);font-weight:600">${_crimeEsc(c.perpetrator)}</td>
      <td style="padding:5px 12px 5px 0;color:var(--text-dim)">${_crimeEsc(c.zone)}</td>
      <td style="padding:5px 12px 5px 0;color:var(--text-dim)">${_crimeEsc(c.crime)}</td>
      <td style="padding:5px 12px 5px 0;color:#ff6b6b;letter-spacing:1px;white-space:nowrap">${_starBar(c.wanted)}</td>
      <td style="padding:5px 0;color:var(--text-dim);text-align:right;white-space:nowrap">${isHistory ? `${_crimeEsc(c.outcome)} · ${_ago(c.clearedTs)} ago` : `${_ago(c.ts)} ago`}</td>
    </tr>`).join('');
}

function _crimeTable(rows, isHistory) {
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px">
      <th style="text-align:left;padding:0 12px 6px 0;font-weight:700">Perpetrator</th>
      <th style="text-align:left;padding:0 12px 6px 0;font-weight:700">Zone</th>
      <th style="text-align:left;padding:0 12px 6px 0;font-weight:700">Crime</th>
      <th style="text-align:left;padding:0 12px 6px 0;font-weight:700">Wanted</th>
      <th style="text-align:right;padding:0 0 6px 0;font-weight:700">${isHistory ? 'Outcome' : 'When'}</th>
    </tr></thead>
    <tbody>${_crimeRows(rows, isHistory)}</tbody>
  </table>`;
}

function _crimeLogHtml(active, history) {
  const activeHtml = active.length
    ? _crimeTable(active, false)
    : `<div style="font-size:11px;color:var(--text-dim);padding:6px 0">No active crimes — the streets are quiet.</div>`;
  const historyHtml = history.length
    ? `<div style="margin-top:18px">
         <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:8px">Cleared — History (${history.length})</div>
         ${_crimeTable(history.slice(0, 25), true)}
       </div>`
    : '';
  return activeHtml + historyHtml;
}

let _crimeLogTimer = null;

function _stopCrimeLogPoll() {
  if (_crimeLogTimer) { clearInterval(_crimeLogTimer); _crimeLogTimer = null; }
}

async function _refreshCrimeLog() {
  const body = document.getElementById('crime-log-body');
  if (!body) { _stopCrimeLogPoll(); return; }   // navigated away from the panel
  const data = await directAPI('/surveillance/crime-log');
  if (!document.getElementById('crime-log-body')) { _stopCrimeLogPoll(); return; }
  if (data?.error) {
    body.innerHTML = `<div style="font-size:11px;color:var(--text-dim);padding:6px 0">${_crimeEsc(data.error)}</div>`;
    return;
  }
  body.innerHTML = _crimeLogHtml(
    Array.isArray(data?.active) ? data.active : [],
    Array.isArray(data?.history) ? data.history : []
  );
}

function _startCrimeLogPoll() {
  _stopCrimeLogPoll();
  _refreshCrimeLog();
  _crimeLogTimer = setInterval(_refreshCrimeLog, 3000);
}

function renderEmergencyPanel(data) {
  const panel = document.getElementById('list-panel');
  const active  = !!data?.active;
  const message = data?.message || '';
  const zones   = Array.isArray(data?.zones) ? data.zones : [];
  const arb     = data?.arbiters || {};

  const statusColor  = active ? '#ff4444' : 'var(--text-dim)';
  const statusBorder = active ? '1px solid #aa0000' : '1px solid var(--border)';
  const statusBg     = active ? 'rgba(140,0,0,0.18)' : 'var(--bg2)';
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const arbDot  = _arbiterDot(arb);
  const arbDisabled = arb.active ? 'disabled style="opacity:0.35"' : '';
  const sdDisabled  = !arb.active || arb.standingDown ? 'disabled style="opacity:0.35"' : '';

  panel.innerHTML = `
    <div style="padding:24px;max-width:680px;display:flex;flex-direction:column;gap:20px">

      <!-- ESP Status -->
      <div style="background:${statusBg};border:${statusBorder};border-radius:4px;padding:20px${active ? ';animation:esp-status-pulse 1.8s ease-in-out infinite' : ''}">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${statusColor};margin-bottom:10px">Protocol Status</div>
        <div style="display:flex;align-items:center;gap:20px">
          <div style="font-size:22px;font-weight:700;color:${statusColor};letter-spacing:2px">${active ? '⚠ ACTIVE' : '○ INACTIVE'}</div>
          ${active ? `<div style="font-size:11px;color:var(--text-dim)">${zones.length} streetlight zone(s) under alert</div>` : ''}
        </div>
      </div>

      <!-- Live Crime Log -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim)">Crime Log</div>
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;animation:esp-status-pulse 1.8s ease-in-out infinite"></span>
          <span style="font-size:10px;color:var(--text-dim)">live — active crimes clear to history on arrest, death, or decay</span>
        </div>
        <div id="crime-log-body"><div style="font-size:11px;color:var(--text-dim);padding:6px 0">Loading…</div></div>
      </div>

      <!-- ESP Controls -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:14px">Controls</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="action-btn danger" onclick="espActivate()" ${active ? 'disabled style="opacity:0.35"' : ''}>⚠ Engage ESP</button>
          <button class="action-btn" onclick="espDeactivate()" ${!active ? 'disabled style="opacity:0.35"' : ''}>✕ Stand Down</button>
        </div>
        ${active ? '<div style="margin-top:10px;font-size:10px;color:var(--text-dim)">Siren is broadcasting. Warning text fired once on activation.</div>' : '<div style="margin-top:10px;font-size:10px;color:var(--text-dim)">Engaging will target all zones containing a streetlight and play the emergency siren.</div>'}
      </div>

      <!-- Warning Message -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px">Warning Message</div>
        <textarea id="esp-msg" rows="5" style="width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:11px;padding:8px;border-radius:2px;resize:vertical;letter-spacing:0.5px">${esc(message)}</textarea>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
          <button class="action-btn" onclick="espSaveMessage()">Save Message</button>
          <span style="font-size:10px;color:var(--text-dim)">Sent once on activation${active ? ' — save to resend now' : ''}</span>
        </div>
      </div>

      ${active && zones.length ? `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px">Affected Zones (${zones.length})</div>
        <div style="font-size:11px;color:var(--text-dim);line-height:1.8">${zones.map(z => esc(z)).join('<br>')}</div>
      </div>` : ''}

      <!-- Arbiter Subsystem -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:16px">Arbiter Subsystem</div>

        <!-- Deployment status -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <span style="font-size:11px;color:var(--text-dim)">Deployment Status</span>
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:1px;color:${arbDot.color}">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${arbDot.color};flex-shrink:0"></span>
            ${arbDot.label}
          </span>
          ${arb.active ? `<span style="font-size:10px;color:var(--text-dim);margin-left:auto">${arb.count ?? 0} unit(s) active</span>` : ''}
        </div>

        <!-- Activate / Stand Down -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
          <button class="action-btn danger" onclick="arbitersActivate()" ${arbDisabled}>⚡ Activate Arbiters</button>
          <button class="action-btn" onclick="arbitersStandDown()" ${sdDisabled}>↩ Stand Down</button>
        </div>

        <!-- Admin Protection toggle -->
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--text-dim)">Admin Protection</span>
          <label class="toggle-switch" style="margin-left:4px">
            <input type="checkbox" id="arbiter-admin-protection-toggle" ${arb.adminProtection ? 'checked' : ''} onchange="arbitersAdminProtection(this.checked)">
            <span class="toggle-slider"></span>
          </label>
          <span style="font-size:10px;color:var(--text-dim)">Arbiters ignore admins and aggro on admin killers</span>
        </div>
      </div>

    </div>`;

  _startCrimeLogPoll();
}

// ── ESP controls ──────────────────────────────────────────────────────────────

async function espActivate() {
  const message = document.getElementById('esp-msg')?.value?.trim();
  const r = await directAPI('/emergency/activate', 'POST', { message: message || undefined });
  if (r.error) { toast(r.error, true); return; }
  toast(`⚠ Emergency Security Protocol ENGAGED — ${r.zones} zone(s) under alert`);
  updateEspDot(true);
  loadPanel('emergency');
}

async function espDeactivate() {
  if (!confirm('Stand down Emergency Security Protocol? This will silence the siren and clear all alerts.')) return;
  const r = await directAPI('/emergency/deactivate', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast('Emergency Security Protocol stood down');
  updateEspDot(false);
  loadPanel('emergency');
}

async function espSaveMessage() {
  const message = document.getElementById('esp-msg')?.value?.trim();
  if (!message) { toast('Message cannot be empty', true); return; }
  const r = await directAPI('/emergency/message', 'PUT', { message });
  if (r.error) { toast(r.error, true); return; }
  toast('Warning message updated' + (r.message ? ' and broadcast live' : ''));
}

// ── Arbiter controls ──────────────────────────────────────────────────────────

async function arbitersActivate() {
  const r = await directAPI('/emergency/arbiters/activate', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast(`⚡ Arbiters deployed — ${r.spawned} unit(s) across ${r.arrays} array(s)`);
  loadPanel('emergency');
}

async function arbitersStandDown() {
  if (!confirm('Order all Arbiters to stand down and return to their bays?')) return;
  const r = await directAPI('/emergency/arbiters/standdown', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast(`↩ Arbiters standing down — ${r.count} unit(s) en route`);
  loadPanel('emergency');
}

async function arbitersAdminProtection(enabled) {
  const r = await directAPI('/emergency/arbiters/admin-protection', 'POST', { enabled });
  if (r.error) { toast(r.error, true); document.getElementById('arbiter-admin-protection-toggle').checked = !enabled; return; }
  toast(`Admin protection ${enabled ? 'enabled' : 'disabled'}`);
}
