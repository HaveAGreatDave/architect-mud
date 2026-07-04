// Dev-panel Flight debug — charter pilot work status + the flight request log.
// Data comes from the flight plugin's route: GET /flight/debug (charterDebug()).

function _flEsc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _flAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}
function _flStatusColor(st) {
  if (!st) return 'var(--text-dim)';
  if (st.startsWith('FLYING')) return '#f59e0b';
  if (st === 'ON DUTY') return '#22c55e';
  return '#64748b';
}
function _flLogColor(st) {
  return st === 'delivered' ? '#22c55e' : st === 'arrived' ? '#38bdf8' : st === 'en route' ? '#f59e0b' : 'var(--text-dim)';
}

function renderFlightPanel(data) {
  const th = 'text-align:left;padding:0 12px 6px 0;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px';
  const td = 'padding:5px 12px 5px 0;color:var(--text);font-size:12px;white-space:nowrap';

  const pilots = (data.pilots || []).map(p => `<tr>
      <td style="${td};font-weight:600">${_flEsc(p.name)}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(p.field)}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(p.shift)}</td>
      <td style="${td};color:${_flStatusColor(p.status)};font-weight:600">${_flEsc(p.status)}</td>
    </tr>`).join('') || `<tr><td colspan="4" style="${td};color:var(--text-dim)">No charter pilots seeded. Run scripts/seed-charter-pilots.js + reload the world.</td></tr>`;

  const log = (data.log || []).map(l => `<tr>
      <td style="${td};color:var(--text-dim)">${_flAgo(l.at)} ago</td>
      <td style="${td};font-weight:600">${_flEsc(l.player)}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(l.pilot)}</td>
      <td style="${td}">${_flEsc(l.from)} → <b>${_flEsc(l.to)}</b></td>
      <td style="${td};color:${_flLogColor(l.status)};font-weight:600">${_flEsc(l.status)}</td>
    </tr>`).join('') || `<tr><td colspan="5" style="${td};color:var(--text-dim)">No charter flights requested yet.</td></tr>`;

  document.getElementById('list-panel').innerHTML = `
    <div style="padding:16px 20px">
      <div style="color:var(--text-dim);font-size:12px;margin-bottom:14px">In-game hour: <b style="color:var(--text)">${String(data.hour ?? 0).padStart(2, '0')}:00</b> · a field is open only during its pilot's 8-hour shift.</div>

      <div style="font-weight:700;letter-spacing:1px;color:var(--accent);margin-bottom:8px">CHARTER PILOTS</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
        <thead><tr><th style="${th}">Pilot</th><th style="${th}">Field</th><th style="${th}">Shift</th><th style="${th}">Status</th></tr></thead>
        <tbody>${pilots}</tbody>
      </table>

      <div style="font-weight:700;letter-spacing:1px;color:var(--accent);margin-bottom:8px">FLIGHT REQUEST LOG</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th}">When</th><th style="${th}">Passenger</th><th style="${th}">Pilot</th><th style="${th}">Route</th><th style="${th}">Status</th></tr></thead>
        <tbody>${log}</tbody>
      </table>
    </div>`;
}
