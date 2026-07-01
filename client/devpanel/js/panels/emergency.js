function renderEmergencyPanel(data) {
  const panel = document.getElementById('list-panel');
  const active = !!data?.active;
  const message = data?.message || '';
  const zones = Array.isArray(data?.zones) ? data.zones : [];

  const statusColor  = active ? '#ff4444' : 'var(--text-dim)';
  const statusBorder = active ? '1px solid #aa0000' : '1px solid var(--border)';
  const statusBg     = active ? 'rgba(140,0,0,0.18)' : 'var(--bg2)';
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  panel.innerHTML = `
    <div style="padding:24px;max-width:680px;display:flex;flex-direction:column;gap:20px">

      <div style="background:${statusBg};border:${statusBorder};border-radius:4px;padding:20px${active ? ';animation:esp-status-pulse 1.8s ease-in-out infinite' : ''}">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${statusColor};margin-bottom:10px">Protocol Status</div>
        <div style="display:flex;align-items:center;gap:20px">
          <div style="font-size:22px;font-weight:700;color:${statusColor};letter-spacing:2px">${active ? '⚠ ACTIVE' : '○ INACTIVE'}</div>
          ${active ? `<div style="font-size:11px;color:var(--text-dim)">${zones.length} streetlight zone(s) under alert</div>` : ''}
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:14px">Controls</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="action-btn danger" onclick="espActivate()" ${active ? 'disabled style="opacity:0.35"' : ''}>⚠ Engage ESP</button>
          <button class="action-btn" onclick="espDeactivate()" ${!active ? 'disabled style="opacity:0.35"' : ''}>✕ Stand Down</button>
        </div>
        ${active ? '<div style="margin-top:10px;font-size:10px;color:var(--text-dim)">Siren is broadcasting. Warning text fires every 10 seconds to all affected zones.</div>' : '<div style="margin-top:10px;font-size:10px;color:var(--text-dim)">Engaging will target all zones containing a streetlight and play the emergency siren.</div>'}
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px">Warning Message</div>
        <textarea id="esp-msg" rows="5" style="width:100%;box-sizing:border-box;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:11px;padding:8px;border-radius:2px;resize:vertical;letter-spacing:0.5px">${esc(message)}</textarea>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
          <button class="action-btn" onclick="espSaveMessage()">Save Message</button>
          <span style="font-size:10px;color:var(--text-dim)">Broadcasts every 10 s to affected zones${active ? ' — updates live immediately' : ''}</span>
        </div>
      </div>

      ${active && zones.length ? `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px">Affected Zones (${zones.length})</div>
        <div style="font-size:11px;color:var(--text-dim);line-height:1.8">${zones.map(z => esc(z)).join('<br>')}</div>
      </div>` : ''}

    </div>`;
}

async function espActivate() {
  const message = document.getElementById('esp-msg')?.value?.trim();
  const r = await directAPI('/emergency/activate', 'POST', { message: message || undefined });
  if (r.error) { toast(r.error, true); return; }
  toast(`⚠ Emergency Security Protocol ENGAGED — ${r.zones} zone(s) under alert`);
  loadPanel('emergency');
}

async function espDeactivate() {
  if (!confirm('Stand down Emergency Security Protocol? This will silence the siren and clear all alerts.')) return;
  const r = await directAPI('/emergency/deactivate', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast('Emergency Security Protocol stood down');
  loadPanel('emergency');
}

async function espSaveMessage() {
  const message = document.getElementById('esp-msg')?.value?.trim();
  if (!message) { toast('Message cannot be empty', true); return; }
  const r = await directAPI('/emergency/message', 'PUT', { message });
  if (r.error) { toast(r.error, true); return; }
  toast('Warning message updated' + (r.message ? ' and broadcast live' : ''));
}
