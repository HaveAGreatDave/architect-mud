// Dev-panel Flight debug — charter pilot work status, the flight request log, and
// every aircraft INSTANCE (test-flight conjures, player buy/rent, charter ghosts,
// wrecks). Deleting from here is the only cleanup path — test-flight conjures and
// player purchases otherwise just accumulate forever. Self-contained: fetches and
// re-fetches its own data (panels.js's config `fetch` is a no-op), matching the
// bank/ATM panel's pattern so a delete can refresh in place without a full reload.

let _flAircraft = [];
let _flDebug = {};
let _flKindFilter = 'all';

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
const _FL_KIND_COLOR = { test: '#f59e0b', owned: '#38bdf8', rental: '#a78bfa', charter: '#22c55e', wreck: '#ef4444', stock: 'var(--text-dim)' };
const _FL_KIND_LABEL = { test: 'TEST', owned: 'OWNED', rental: 'RENTAL', charter: 'CHARTER', wreck: 'WRECK', stock: 'STOCK' };

async function renderFlightPanel() {
  const panel = document.getElementById('list-panel');
  panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">Loading flight data…</div>';

  const [debug, aircraft] = await Promise.all([
    directAPI('/flight/debug').catch(() => ({})),
    directAPI('/flight/aircraft').catch(() => []),
  ]);
  _flAircraft = Array.isArray(aircraft) ? aircraft : [];
  _flDebug = debug || {};
  _flRenderBody();
}

function _flRenderBody() {
  const debug = _flDebug;
  const panel = document.getElementById('list-panel');
  const th = 'text-align:left;padding:0 12px 6px 0;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px';
  const td = 'padding:5px 12px 5px 0;color:var(--text);font-size:12px;white-space:nowrap';

  const pilots = (debug.pilots || []).map(p => `<tr>
      <td style="${td};font-weight:600">${_flEsc(p.name)}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(p.field)}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(p.shift)}</td>
      <td style="${td};color:${_flStatusColor(p.status)};font-weight:600">${_flEsc(p.status)}</td>
    </tr>`).join('') || `<tr><td colspan="4" style="${td};color:var(--text-dim)">No charter pilots seeded. Run scripts/seed-charter-pilots.js + reload the world.</td></tr>`;

  const log = (debug.log || []).map(l => `<tr>
      <td style="${td};color:var(--text-dim)">${_flAgo(l.at)} ago</td>
      <td style="${td};font-weight:600">${_flEsc(l.player)}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(l.pilot)}</td>
      <td style="${td}">${_flEsc(l.from)} → <b>${_flEsc(l.to)}</b></td>
      <td style="${td};color:${_flLogColor(l.status)};font-weight:600">${_flEsc(l.status)}</td>
    </tr>`).join('') || `<tr><td colspan="5" style="${td};color:var(--text-dim)">No charter flights requested yet.</td></tr>`;

  const counts = _flAircraft.reduce((m, a) => { m[a.kind] = (m[a.kind] || 0) + 1; return m; }, {});
  const kindFilterBtn = (kind, label) => `<button class="action-btn${_flKindFilter === kind ? ' primary' : ''}" onclick="_flSetFilter('${kind}')" style="padding:3px 10px;font-size:10px">${label}${kind !== 'all' ? ` (${counts[kind] || 0})` : ` (${_flAircraft.length})`}</button>`;

  const shown = _flKindFilter === 'all' ? _flAircraft : _flAircraft.filter(a => a.kind === _flKindFilter);
  const rows = shown.map(a => `<tr>
      <td style="${td};font-weight:600">${_flEsc(a.name || a.id)}</td>
      <td style="${td};color:${_FL_KIND_COLOR[a.kind] || 'var(--text-dim)'};font-weight:600">${_FL_KIND_LABEL[a.kind] || a.kind}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(a.type_name || a.type_id)}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(a.owner_handle || '—')}</td>
      <td style="${td};color:var(--text-dim)">${_flEsc(a.zone_name || a.parked_zone_id || '—')}</td>
      <td style="${td};color:var(--text-dim)">${a.live ? '<span style="color:#22c55e">● live</span>' : 'parked'}</td>
      <td style="${td}"><button class="action-btn danger" onclick="_flDeleteAircraft('${a.id}','${_flEsc(a.name || a.id).replace(/'/g, "\\'")}')" style="padding:2px 8px;font-size:10px">Delete</button></td>
    </tr>`).join('') || `<tr><td colspan="7" style="${td};color:var(--text-dim)">No aircraft match this filter.</td></tr>`;

  panel.innerHTML = `
    <div style="padding:16px 20px">
      <div style="color:var(--text-dim);font-size:12px;margin-bottom:14px">In-game hour: <b style="color:var(--text)">${String(debug.hour ?? 0).padStart(2, '0')}:00</b> · a field is open only during its pilot's 8-hour shift.</div>

      <div style="font-weight:700;letter-spacing:1px;color:var(--accent);margin-bottom:8px">CHARTER PILOTS</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
        <thead><tr><th style="${th}">Pilot</th><th style="${th}">Field</th><th style="${th}">Shift</th><th style="${th}">Status</th></tr></thead>
        <tbody>${pilots}</tbody>
      </table>

      <div style="font-weight:700;letter-spacing:1px;color:var(--accent);margin-bottom:8px">FLIGHT REQUEST LOG</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
        <thead><tr><th style="${th}">When</th><th style="${th}">Passenger</th><th style="${th}">Pilot</th><th style="${th}">Route</th><th style="${th}">Status</th></tr></thead>
        <tbody>${log}</tbody>
      </table>

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
        <div style="font-weight:700;letter-spacing:1px;color:var(--accent)">AIRCRAFT INSTANCES</div>
        <button class="action-btn" onclick="renderFlightPanel()" style="padding:3px 10px;font-size:10px">⟳ Refresh</button>
        <button class="action-btn danger" onclick="_flDeleteAllKind('test')" style="padding:3px 10px;font-size:10px">Delete all TEST aircraft</button>
        <button class="action-btn danger" onclick="_flDeleteAllKind('wreck')" style="padding:3px 10px;font-size:10px">Clear all WRECK aircraft</button>
      </div>
      <div style="color:var(--text-dim);font-size:11px;margin-bottom:10px">Test-flight conjures (<b>.testfly</b>) and player buy/rent purchases never expire on their own — clean up stale ones here. A <b>live</b> instance currently has a player aboard or is mid-flight; deleting one detaches its rider first.</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
        ${kindFilterBtn('all', 'All')}${kindFilterBtn('test', 'Test')}${kindFilterBtn('owned', 'Owned')}${kindFilterBtn('rental', 'Rental')}${kindFilterBtn('charter', 'Charter')}${kindFilterBtn('wreck', 'Wreck')}${kindFilterBtn('stock', 'Stock')}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th}">Name</th><th style="${th}">Kind</th><th style="${th}">Type</th><th style="${th}">Owner</th><th style="${th}">Location</th><th style="${th}">State</th><th style="${th}"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function _flSetFilter(kind) { _flKindFilter = kind; _flRenderBody(); }

async function _flDeleteAircraft(id, name) {
  if (!(await dpConfirm(`Delete aircraft "${name}"? This permanently removes it. If someone's aboard, they'll be dropped out first.`, { danger: true }))) return;
  const res = await directAPI(`/flight/aircraft/${id}`, 'DELETE');
  if (res && res.error) { toast(res.error, true); return; }
  toast('Aircraft deleted.');
  renderFlightPanel();
}

async function _flDeleteAllKind(kind) {
  const targets = _flAircraft.filter(a => a.kind === kind);
  const label = _FL_KIND_LABEL[kind] || kind;
  if (!targets.length) { toast(`No ${label.toLowerCase()} aircraft to delete.`); return; }
  if (!(await dpConfirm(`Delete all ${targets.length} ${label} aircraft? This can't be undone.`, { danger: true }))) return;
  let ok = 0;
  for (const a of targets) {
    const res = await directAPI(`/flight/aircraft/${a.id}`, 'DELETE');
    if (!res || !res.error) ok++;
  }
  toast(`Deleted ${ok}/${targets.length} ${label.toLowerCase()} aircraft.`);
  renderFlightPanel();
}
