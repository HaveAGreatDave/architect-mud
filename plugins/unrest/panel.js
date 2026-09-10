// Unrest — the faction-conflict ledger.
//
// This panel is the deliberate opposite of the player's view. Rule 2 of the design
// says there is NO player-facing readout, ever, because a number turns the sim into
// a dashboard to optimise and the flavour dies. The operator gets the complete
// numeric picture instead, because somebody who cannot see the ledger cannot tune
// it. The line is the client boundary, not the data.
//
// Live state, so every call is directAPI — the same class as emergency and power.
//
// One nav row, two tabs, because Unrest and its catalogue are two halves of one
// system and a reader coming to the nav cannot tell which half is which. They stay
// two PANELS entries rather than becoming one: this half is live ops through
// directAPI, and the catalogue half is authored content through API(), so a write
// there stages for review. Collapsing the write paths to collapse the nav would
// either stage an operator action or let content edits bypass review.

const UNREST_SUITE_TITLE = 'Unrest';
const UNREST_SUITE_DESC = "The faction-conflict ledger and the catalogue behind it — grip/heat/pressure per derived city block, what's standing right now, and every authored thing that CAN stand. Operator-only by design: none of it reaches the player.";
const UNREST_SUITE_TABS = [
  { panel: 'unrest',    label: '🔥 Live ledger' },
  { panel: 'incidents', label: '🧨 Catalogue' },
];

window.unrestSuiteTab = function (panel) { showPanel(panel); };

// The tab strip, plus the suite's own title over whichever panel drew it —
// loadPanel wrote the active PANELS entry's title into the toolbar, and as far as
// the author is concerned this is one place. 'incidents' renders through the
// generic list, so it reaches this through 'beforeList', which runs even when the
// list is empty.
function unrestSuiteHeader(active) {
  const t = document.getElementById('panel-title');
  const d = document.getElementById('panel-description');
  if (t) t.textContent = UNREST_SUITE_TITLE;
  if (d) d.textContent = UNREST_SUITE_DESC;
  return `<div class="bc-tabs">${UNREST_SUITE_TABS.map(x => `
    <button class="bc-tab${active === x.panel ? ' bc-tab-active' : ''}"
      onclick="unrestSuiteTab('${x.panel}')">${x.label}</button>`).join('')}</div>`;
}

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
    return `<div title="${_unrestEsc(c.key)} — ${band.label} · grip ${c.grip} · heat ${c.heat} · pressure ${c.pressure}${c.lit ? ' · LIT' : ''}"
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
      <td style="padding:6px 12px 6px 0"><span style="color:${band.color};font-size:9px;letter-spacing:1px;font-weight:700">${band.label}</span>${c.lit ? '<span title="lit: burning until the grievance under it\'s spent" style="color:#ff9f43;font-weight:700;margin-left:6px">&#9650;</span>' : ''}</td>
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

// Incidents. Two tables, because they answer two different operator questions:
// what is standing right now, and — much more often — why is nothing standing.
// A refusal reason per definition per cell is the whole difference between
// "the sim is broken" and "the sim is waiting for a signal, as designed".
function _unrestLive(inc) {
  const live = Array.isArray(inc?.live) ? inc.live : [];
  if (!live.length) {
    return '<div style="color:var(--text-dim);font-size:11px">Nothing staged. That\'s the normal state of a quiet city.</div>';
  }
  const now = Date.now();
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px">
      <th style="text-align:left;padding:0 12px 6px 0">Incident</th>
      <th style="text-align:left;padding:0 12px 6px 0">Cell</th>
      <th style="text-align:left;padding:0 12px 6px 0">Order</th>
      <th style="text-align:left;padding:0 12px 6px 0">Band at staging</th>
      <th style="text-align:right;padding:0 12px 6px 0">Ends in</th>
      <th></th>
    </tr></thead><tbody>${live.map(i => `
      <tr>
        <td style="padding:5px 12px 5px 0;color:var(--text);font-weight:600">${_unrestEsc(i.name || i.incident)}</td>
        <td style="padding:5px 12px 5px 0;color:var(--text-dim)">${_unrestEsc(i.cell)}</td>
        <td style="padding:5px 12px 5px 0;color:${i.writes === 'grip' ? '#60a5fa' : '#ff6b6b'}">${_unrestEsc(i.writes)}</td>
        <td style="padding:5px 12px 5px 0;color:var(--text-dim)">${_unrestEsc(i.band)}</td>
        <td style="padding:5px 12px 5px 0;color:var(--text-dim);text-align:right">${Math.max(0, Math.round((i.endsAt - now) / 60000))}m</td>
        <td style="padding:5px 0;text-align:right">
          <button class="action-btn" style="font-size:10px;padding:3px 8px"
            onclick="unrestTeardown('${_unrestEsc(i.instanceId)}')">Tear down</button>
        </td>
      </tr>`).join('')}</tbody></table>`;
}

const _unrestWhy = {
  band: 'band too low',
  signal: 'no signal from that order yet',
  cooldown: 'on cooldown here',
  occupied: 'cell already has one',
};

function _unrestCatalogue(inc) {
  const cat = Array.isArray(inc?.catalogue) ? inc.catalogue : [];
  if (!cat.length) {
    return `<div style="color:#f59e0b;font-size:11px">No incident definitions loaded. Run
      <code>npm run content:import</code>, then hit Reload catalogue.</div>`;
  }
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px">
      <th style="text-align:left;padding:0 12px 6px 0">Definition</th>
      <th style="text-align:left;padding:0 12px 6px 0">Order</th>
      <th style="text-align:left;padding:0 12px 6px 0">Min band</th>
      <th style="text-align:left;padding:0 0 6px 0">Eligible cells</th>
    </tr></thead><tbody>${cat.map(d => {
      const open = (d.blocked || []).filter(b => !b.why);
      const reasons = {};
      for (const b of d.blocked || []) if (b.why) reasons[b.why] = (reasons[b.why] || 0) + 1;
      const summary = open.length
        ? open.map(b => `<button class="action-btn" style="font-size:10px;padding:2px 7px;margin:0 4px 3px 0"
            onclick="unrestStage('${_unrestEsc(d.id)}','${_unrestEsc(b.cell)}')">${_unrestEsc(b.cell)}</button>`).join('')
        : `<span style="color:var(--text-dim)">none — ${Object.keys(reasons)
            .map(k => `${reasons[k]} ${_unrestWhy[k] || k}`).join(', ')}</span>`;
      return `<tr>
        <td style="padding:5px 12px 5px 0;color:var(--text)">${_unrestEsc(d.name)}</td>
        <td style="padding:5px 12px 5px 0;color:${d.writes === 'grip' ? '#60a5fa' : '#ff6b6b'}">${_unrestEsc(d.writes)}</td>
        <td style="padding:5px 12px 5px 0;color:var(--text-dim)">${_unrestEsc(d.minBand)}</td>
        <td style="padding:5px 0">${summary}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function renderUnrestPanel(data) {
  const cells = Array.isArray(data?.cells) ? data.cells : [];
  const roles = Array.isArray(data?.roles) ? data.roles : [];
  const counts = cells.reduce((a, c) => { a[c.band] = (a[c.band] || 0) + 1; return a; }, {});
  const chips = Object.keys(_unrestBand).map(b =>
    `<span style="color:${_unrestBand[b].color};font-size:10px;letter-spacing:1px;margin-right:14px">
       ${_unrestBand[b].label} ${counts[b] || 0}</span>`).join('');

  const html = `
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

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <div style="font-weight:700">Live incidents</div>
        <div style="color:var(--text-dim);font-size:11px">${(data?.incidents?.live || []).length} of ${data?.incidents?.cap ?? '?'} citywide</div>
        <div style="margin-left:auto"><button class="action-btn" onclick="unrestReload()">Reload catalogue</button></div>
      </div>
      <div style="color:var(--text-dim);font-size:11px;margin-bottom:10px">
        A staging is <b>never persisted</b> — a restart leaves the cell hot and the checkpoint gone,
        and the next tick re-stages it if it's still warranted. Nothing may stage in a cell that has
        not carried a perceivable signal <i>from the same order</i> in the last six hours, which is
        what makes a checkpoint read as a reply to the graffiti rather than as spawn noise.
      </div>
      ${_unrestLive(data?.incidents)}
      <div style="font-weight:700;margin:16px 0 8px">Eligibility — why nothing is standing</div>
      <div style="color:var(--text-dim);font-size:11px;margin-bottom:8px">
        Every enabled definition against every cell, with the refusal counted per reason. This is the
        question you'll ask ninety times for every once you ask what's happening. Click a cell to
        stage that incident there by hand. The definitions themselves — stage steps, weights,
        durations — are authored content and live on the <b>Catalogue</b> tab.
      </div>
      ${_unrestCatalogue(data?.incidents)}
      <div style="color:var(--text-dim);font-size:11px;margin-top:10px">
        Stage steps registered: <code>${_unrestEsc((data?.incidents?.steps || []).join(', '))}</code>
      </div>
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

  document.getElementById('list-panel').innerHTML = unrestSuiteHeader('unrest') + html;
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

async function unrestStage(incident, key) {
  const res = await directAPI('/unrest/incidents/stage', 'POST', { incident, key });
  if (res?.error) await dpAlert(res.error);
  showPanel('unrest');
}

async function unrestTeardown(instanceId) {
  if (!(await dpConfirm('Tear this incident down now? Everything it put up comes back off.'))) return;
  await directAPI('/unrest/incidents/teardown', 'POST', { instanceId });
  showPanel('unrest');
}

async function unrestReload() {
  const res = await directAPI('/unrest/reload', 'POST', {});
  await dpAlert(`Catalogue reloaded — ${res?.incidents ?? 0} incident definitions.`);
  showPanel('unrest');
}

async function unrestReindex() {
  const res = await directAPI('/unrest/reindex', 'POST', {});
  await dpAlert(`Reindexed — ${res?.blocks ?? 0} cells.`);
  showPanel('unrest');
}

// ── Registration ─────────────────────────────────────────────────────────────
// Both halves of the suite, declared here rather than in client/devpanel/. One
// nav row (the manifest's `devPanel.nav`), two tabs — the live ledger and the
// authored catalogue — which is why the second registers a `navAlias` back to
// this one: a panel that shares a nav entry highlights that entry, not its own.
registerDevPanel({
  id: 'unrest',
  title: 'Unrest',
  description: 'The faction-conflict ledger — grip/heat/pressure per derived city block, the band each is in, the authored role roster, and every live incident. Operator-only by design: none of it reaches the player.',
  fetch: async () => {
    const [state, incidents] = await Promise.all([
      directAPI('/unrest/state'),
      directAPI('/unrest/incidents'),
    ]);
    return { ...state, incidents };
  },
  noEdit: true,
  render: renderUnrestPanel,
});

registerDevPanel({
  id: 'incidents',
  title: 'Incidents',
  description: "The authored catalogue behind Unrest — what CAN happen in a city block, never what's happening. The live side is the Live ledger tab.",
  navAlias: 'unrest',
  idPrefix: 'incident',
  noEdit: false,
  // This half renders through the generic list, so the suite strip arrives via
  // beforeList — which runs even when the list is empty.
  beforeList: () => unrestSuiteHeader('incidents'),
  fetch: () => API('/incidents'),
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'writes', label: 'Order', render: v => v === 'grip' ? 'authority' : 'insurgency' },
    { key: 'min_band', label: 'From band' },
    { key: 'weight', label: 'Weight' },
    { key: 'duration_min', label: 'Runs for', render: v => `${v}m` },
    { key: 'stage', label: 'Steps', render: v => (Array.isArray(v) ? v : []).map(s => s.do).join(' → ') || '—' },
    { key: 'enabled', label: 'On', render: v => v ? '✓' : '—' },
  ],
  editForm: incidentEditForm,
  save: saveIncident,
  delete: id => API(`/incidents/${id}`, 'DELETE'),
});
