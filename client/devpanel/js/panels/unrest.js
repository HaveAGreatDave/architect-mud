// Unrest — the faction-conflict ledger.
//
// This panel is the deliberate opposite of the player's view. Rule 2 of the design
// says there is NO player-facing readout, ever, because a number turns the sim into
// a dashboard to optimise and the flavour dies. The operator gets the complete
// numeric picture instead, because somebody who cannot see the ledger cannot tune
// it. The line is the client boundary, not the data.
//
// Live state, so every call is directAPI — the same class as emergency and power.

const _unrestBand = {
  quiet:      { color: '#22c55e', label: 'QUIET' },
  watchful:   { color: '#f59e0b', label: 'WATCHFUL' },
  tense:      { color: '#f97316', label: 'TENSE' },
  flashpoint: { color: '#ff4444', label: 'FLASHPOINT' },
};

const _unrestEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function _unrestBar(value, color) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div style="background:var(--bg-deep);border-radius:2px;height:8px;width:100%;overflow:hidden">
    <div style="background:${color};height:100%;width:${pct}%"></div>
  </div>`;
}

// The ledger is spatial, so the primary view is the map rather than the table —
// one glance answers "where is it kicking off". Cells are laid out on their own
// block coordinates, so the shape on screen is the shape of the city.
function _unrestMap(cells) {
  if (!cells.length) return '<div style="color:var(--text-dim)">No cells indexed. Is the world loaded?</div>';
  const xs = cells.map(c => Math.floor(c.cx));
  const ys = cells.map(c => Math.floor(c.cy));
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const step = 12;
  const cols = Math.max(1, Math.round((Math.max(...xs) - minX) / step) + 1);
  const rows = Math.max(1, Math.round((Math.max(...ys) - minY) / step) + 1);

  const tiles = cells.map(c => {
    const col = Math.round((c.cx - minX) / step) + 1;
    const row = Math.round((c.cy - minY) / step) + 1;
    const band = _unrestBand[c.band] || _unrestBand.quiet;
    return `<div title="${_unrestEsc(c.key)} — ${band.label} · grip ${c.grip} · heat ${c.heat} · pressure ${c.pressure}"
      style="grid-column:${col};grid-row:${row};background:${band.color};opacity:.85;border-radius:3px;
             min-height:44px;display:flex;align-items:center;justify-content:center;
             font-size:9px;color:#000;font-weight:700;cursor:pointer"
      onclick="unrestForce('${_unrestEsc(c.key)}')">${_unrestEsc(c.key)}</div>`;
  }).join('');

  return `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(44px,1fr));
                      grid-template-rows:repeat(${rows},auto);gap:4px;max-width:520px">${tiles}</div>`;
}

function _unrestRows(cells) {
  return cells.map(c => {
    const band = _unrestBand[c.band] || _unrestBand.quiet;
    return `<tr>
      <td style="padding:6px 12px 6px 0;font-weight:600;color:var(--text)">${_unrestEsc(c.key)}</td>
      <td style="padding:6px 12px 6px 0"><span style="color:${band.color};font-size:9px;letter-spacing:1px;font-weight:700">${band.label}</span></td>
      <td style="padding:6px 12px 6px 0;width:90px">${_unrestBar(c.grip, '#60a5fa')}</td>
      <td style="padding:6px 12px 6px 0;color:var(--text-dim);width:34px">${c.grip}</td>
      <td style="padding:6px 12px 6px 0;width:90px">${_unrestBar(c.heat, '#ff6b6b')}</td>
      <td style="padding:6px 12px 6px 0;color:var(--text-dim);width:34px">${c.heat}</td>
      <td style="padding:6px 12px 6px 0;width:90px">${_unrestBar(c.pressure, '#a78bfa')}</td>
      <td style="padding:6px 12px 6px 0;color:var(--text-dim);width:34px">${c.pressure}</td>
      <td style="padding:6px 0;color:var(--text-dim);text-align:right">${c.zones} zones</td>
      <td style="padding:6px 0 6px 12px;text-align:right">
        <button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="unrestForce('${_unrestEsc(c.key)}')">Force</button>
      </td>
    </tr>`;
  }).join('');
}

function _unrestRoles(roles) {
  if (!roles.length) {
    return `<div style="color:#f59e0b">No org declares a <code>flags.role</code>. The sim will do nothing —
      add <code>role</code> to the canon <code>content/orgs/ideology_*.json</code> and re-import.</div>`;
  }
  return `<table style="font-size:11px;border-collapse:collapse">
    <thead><tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px">
      <th style="text-align:left;padding:0 14px 4px 0">Order</th>
      <th style="text-align:left;padding:0 14px 4px 0">Writes</th>
      <th style="text-align:left;padding:0 14px 4px 0">Reads</th>
      <th style="text-align:left;padding:0 0 4px 0">Drift</th>
    </tr></thead><tbody>${roles.map(r => `
      <tr>
        <td style="padding:3px 14px 3px 0;color:var(--text)">${_unrestEsc(r.id)}</td>
        <td style="padding:3px 14px 3px 0;color:var(--text-dim)">${_unrestEsc(r.writes)}</td>
        <td style="padding:3px 14px 3px 0;color:var(--text-dim)">${_unrestEsc(r.reads || '—')}</td>
        <td style="padding:3px 0;color:var(--text-dim)">${_unrestEsc(r.drift || '—')}</td>
      </tr>`).join('')}</tbody></table>`;
}

function renderUnrestPanel(data) {
  const cells = Array.isArray(data?.cells) ? data.cells : [];
  const roles = Array.isArray(data?.roles) ? data.roles : [];
  const counts = cells.reduce((a, c) => { a[c.band] = (a[c.band] || 0) + 1; return a; }, {});
  const chips = Object.keys(_unrestBand).map(b =>
    `<span style="color:${_unrestBand[b].color};font-size:10px;letter-spacing:1px;margin-right:14px">
       ${_unrestBand[b].label} ${counts[b] || 0}</span>`).join('');

  return `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-weight:700">${cells.length} cells</div>
        <div>${chips}</div>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button class="action-btn" onclick="unrestStep()">Run one tick</button>
          <button class="action-btn" onclick="unrestReindex()">Reindex</button>
        </div>
      </div>
      <div style="color:var(--text-dim);font-size:11px;margin-bottom:12px">
        Cells are <b>derived</b> 12&times;12 blocks of grid coordinates, not authored districts.
        Nothing downstream knows what a cell is, so painting the districts later swaps one key
        function and changes nothing else. <b>None of this reaches the player</b> — the ledger is
        felt through an NPC saying the north end is tense, never read as a number.
      </div>
      ${_unrestMap(cells)}
    </div>

    <div class="card" style="margin-bottom:14px">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px">
          <th style="text-align:left;padding:0 12px 6px 0">Cell</th>
          <th style="text-align:left;padding:0 12px 6px 0">Band</th>
          <th colspan="2" style="text-align:left;padding:0 12px 6px 0">Grip</th>
          <th colspan="2" style="text-align:left;padding:0 12px 6px 0">Heat</th>
          <th colspan="2" style="text-align:left;padding:0 12px 6px 0">Pressure</th>
          <th style="text-align:right;padding:0 0 6px 0">Size</th>
          <th></th>
        </tr></thead>
        <tbody>${_unrestRows(cells)}</tbody>
      </table>
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">Roles</div>
      <div style="color:var(--text-dim);font-size:11px;margin-bottom:10px">
        Authored on <code>orgs.flags.role</code>, never a switch statement. An insurgency is
        <i>writes heat AND reads grip</i> — an order that reads a clock is a driver into the
        ledger rather than part of its cycle.
      </div>
      ${_unrestRoles(roles)}
    </div>`;
}

async function unrestForce(key) {
  const raw = await dpPrompt(`Force cell ${key} — grip,heat,pressure (blank to leave one alone)`, '60,40,10');
  if (!raw) return;
  const [grip, heat, pressure] = String(raw).split(',').map(s => s.trim());
  const body = {key};
  if (grip !== '' && grip != null) body.grip = Number(grip);
  if (heat !== '' && heat != null) body.heat = Number(heat);
  if (pressure !== '' && pressure != null) body.pressure = Number(pressure);
  await directAPI('/unrest/force', 'POST', body);
  showPanel('unrest');
}

async function unrestStep() {
  await directAPI('/unrest/step', 'POST', {});
  showPanel('unrest');
}

async function unrestReindex() {
  const res = await directAPI('/unrest/reindex', 'POST', {});
  await dpAlert(`Reindexed — ${res?.blocks ?? 0} cells.`);
  showPanel('unrest');
}
