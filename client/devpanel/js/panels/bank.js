// Bank panel — ATM network overview, unit management, and network CRUD.

let _bankUnits = [];
let _bankNetworks = [];
let _bankZones = [];

async function renderBankPanel() {
  const panel = document.getElementById('list-panel');
  panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">Loading ATM data…</div>';

  const [units, networks, zones] = await Promise.all([
    directAPI('/atm/units').catch(() => []),
    directAPI('/atm/networks').catch(() => []),
    API('/zones').catch(() => []),
  ]);

  _bankUnits    = Array.isArray(units)    ? units    : [];
  _bankNetworks = Array.isArray(networks) ? networks : [];
  _bankZones    = Array.isArray(zones)    ? zones    : (zones?.zones || []);
  _renderBankBody();
}

function _renderBankBody() {
  const panel = document.getElementById('list-panel');
  const units    = _bankUnits;
  const networks = _bankNetworks;

  const totalCash = units.reduce((s, u) => s + (u.cash_stock || 0), 0);
  const onlineCt  = units.filter(u => !u.is_broken && u.power_status !== 'offline').length;
  const offlineCt = units.filter(u => !u.is_broken && u.power_status === 'offline').length;
  const brokenCt  = units.filter(u => !!u.is_broken).length;

  const statCard = (icon, label, value, color) => `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:16px 20px;display:flex;flex-direction:column;gap:4px">
      <div style="font-size:20px">${icon}</div>
      <div style="font-size:24px;font-weight:700;color:${color || 'var(--text-bright)'}">${value}</div>
      <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">${label}</div>
    </div>`;

  const netColor = id => {
    const n = networks.find(n => n.id === id);
    return n ? n.color : '#888';
  };
  const netName = id => {
    const n = networks.find(n => n.id === id);
    return n ? n.name : '—';
  };

  const cashBar = (stock, max) => {
    const pct = max > 0 ? Math.min(100, Math.round((stock / max) * 100)) : 0;
    const low = pct < 20;
    return `<div style="display:flex;align-items:center;gap:8px;min-width:120px">
      <div style="flex:1;height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${low ? 'var(--red)' : 'var(--accent)'};border-radius:3px;transition:width 0.3s"></div>
      </div>
      <span style="font-size:11px;color:${low ? 'var(--red)' : 'var(--text)'};min-width:40px;text-align:right">₵${stock.toLocaleString()}</span>
    </div>`;
  };

  const powerBadge = status => {
    if (status === 'offline')     return `<span style="color:var(--red);font-size:11px">✗ OFFLINE</span>`;
    if (status === 'overloaded')  return `<span style="color:var(--yellow,#ffcc00);font-size:11px">⚠ OVERLOADED</span>`;
    return `<span style="color:var(--accent);font-size:11px">✓ ONLINE</span>`;
  };

  const statusBadge = u => {
    if (u.is_broken) return `<span style="color:var(--red);font-size:11px">☠ BROKEN</span>`;
    if (u.power_status === 'offline') return `<span style="color:var(--text-dim);font-size:11px">OFFLINE</span>`;
    return `<span style="color:var(--accent);font-size:11px">OK</span>`;
  };

  const unitRows = units.map(u => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;color:var(--text-bright)">${u.atm_name || u.id}</td>
      <td style="padding:8px 10px;color:var(--text-dim);font-size:11px">${u.zone_name || u.zone_id}</td>
      <td style="padding:8px 10px">
        ${u.network_id ? `<span style="font-size:11px;color:${netColor(u.network_id)}">${netName(u.network_id)}</span>` : '<span style="color:var(--text-dim);font-size:11px">—</span>'}
      </td>
      <td style="padding:8px 10px">${cashBar(u.cash_stock || 0, u.cash_max || 5000)}</td>
      <td style="padding:8px 10px">${powerBadge(u.power_status)}</td>
      <td style="padding:8px 10px">${statusBadge(u)}</td>
      <td style="padding:8px 10px;white-space:nowrap">
        <button class="action-btn" onclick="bankFillAtm('${u.id}')" title="Fill to max" style="padding:2px 8px;font-size:10px">Fill</button>
        <button class="action-btn" onclick="bankSetStock('${u.id}',${u.cash_stock || 0},${u.cash_max || 5000})" title="Set stock to custom amount" style="padding:2px 8px;font-size:10px">Set</button>
        ${u.is_broken ? `<button class="action-btn success" onclick="bankRepairAtm('${u.id}')" style="padding:2px 8px;font-size:10px">Repair</button>` : ''}
        <button class="action-btn" onclick="bankEditUnit('${u.id}')" style="padding:2px 8px;font-size:10px">Edit</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="7" style="padding:20px;color:var(--text-dim);text-align:center">No ATM units found. Add furniture with the <code>atm</code> flag and run the schema.</td></tr>`;

  const netRows = networks.map(n => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${n.color};margin-right:8px;vertical-align:middle"></span>
        <span style="color:var(--text-bright)">${n.name}</span>
      </td>
      <td style="padding:8px 10px;color:var(--text-dim);font-size:11px">${n.id}</td>
      <td style="padding:8px 10px;color:var(--text)">${(parseFloat(n.fee_rate) * 100).toFixed(1)}%</td>
      <td style="padding:8px 10px;color:var(--text)">₵${n.withdrawal_limit}</td>
      <td style="padding:8px 10px;color:var(--text-dim);font-size:11px">${n.faction_id || '—'}</td>
      <td style="padding:8px 10px;white-space:nowrap">
        <button class="action-btn" onclick="bankInjectNetwork('${n.id}')" title="Fill all ATMs on this network" style="padding:2px 8px;font-size:10px">Inject All</button>
        <button class="action-btn" onclick="bankEditNetwork('${n.id}')" style="padding:2px 8px;font-size:10px">Edit</button>
        <button class="action-btn danger" onclick="bankDeleteNetwork('${n.id}','${n.name}')" style="padding:2px 8px;font-size:10px">Delete</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="6" style="padding:20px;color:var(--text-dim);text-align:center">No networks defined.</td></tr>`;

  const thStyle = 'padding:8px 10px;color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:600;border-bottom:1px solid var(--border);text-align:left';

  panel.innerHTML = `
    <div style="padding:24px;max-width:1100px">

      <!-- Summary cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:28px">
        ${statCard('₵', 'Total Cash', '₵' + totalCash.toLocaleString(), 'var(--accent)')}
        ${statCard('✓', 'Online', onlineCt, 'var(--success,#4caf50)')}
        ${statCard('✗', 'Offline', offlineCt, offlineCt > 0 ? 'var(--red)' : 'var(--text-dim)')}
        ${statCard('☠', 'Broken', brokenCt, brokenCt > 0 ? 'var(--red)' : 'var(--text-dim)')}
        ${statCard('⬡', 'Networks', networks.length, 'var(--text-bright)')}
      </div>

      <!-- Networks section -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">ATM Networks</div>
        <button class="action-btn primary" onclick="bankNewNetwork()" style="font-size:11px;padding:4px 12px">+ New Network</button>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;margin-bottom:28px;overflow:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="${thStyle}">Name</th>
              <th style="${thStyle}">ID</th>
              <th style="${thStyle}">Fee</th>
              <th style="${thStyle}">Limit</th>
              <th style="${thStyle}">Faction Gate</th>
              <th style="${thStyle}">Actions</th>
            </tr>
          </thead>
          <tbody>${netRows}</tbody>
        </table>
      </div>

      <!-- ATM Units section -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">ATM Units</div>
        <div style="display:flex;gap:8px">
          <button class="action-btn primary" onclick="bankCreateAtm()" style="font-size:11px;padding:4px 12px">+ Create ATM Terminal</button>
          <button class="action-btn" onclick="bankReplenishAll()" style="font-size:11px;padding:4px 12px">↻ Replenish All</button>
          <button class="action-btn" onclick="renderBankPanel()" style="font-size:11px;padding:4px 12px">⟳ Refresh</button>
        </div>
      </div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;overflow:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="${thStyle}">Name</th>
              <th style="${thStyle}">Zone</th>
              <th style="${thStyle}">Network</th>
              <th style="${thStyle}">Cash Stock</th>
              <th style="${thStyle}">Power</th>
              <th style="${thStyle}">Status</th>
              <th style="${thStyle}">Actions</th>
            </tr>
          </thead>
          <tbody>${unitRows}</tbody>
        </table>
      </div>

    </div>`;
}

// ── ATM Unit actions ──────────────────────────────────────────────────────────

async function bankFillAtm(id) {
  await directAPI(`/atm/units/${id}/replenish`, 'POST');
  toast('ATM filled to max.');
  renderBankPanel();
}

async function bankRepairAtm(id) {
  await directAPI(`/atm/units/${id}/repair`, 'POST');
  toast('ATM repaired.');
  renderBankPanel();
}

function bankSetStock(id, current, max) {
  const val = prompt(`Set cash stock for ATM (max ${max}):`, current);
  if (val === null) return;
  const amount = parseInt(val, 10);
  if (isNaN(amount) || amount < 0) { toast('Invalid amount.', true); return; }
  directAPI(`/atm/units/${id}`, 'PUT', { cash_stock: Math.min(amount, max) })
    .then(() => { toast('Cash stock updated.'); renderBankPanel(); })
    .catch(e => toast(e.message, true));
}

function bankEditUnit(id) {
  const u = _bankUnits.find(u => u.id === id);
  if (!u) return;
  const netOptions = _bankNetworks.map(n =>
    `<option value="${n.id}" ${u.network_id === n.id ? 'selected' : ''}>${n.name}</option>`
  ).join('');
  openModal(`Edit ATM: ${u.atm_name || id}`, `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label>Network</label>
        <select id="beu-network" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%">
          <option value="">— Unaffiliated —</option>${netOptions}
        </select>
      </div>
      <div class="field"><label>Cash Max (₵)</label>
        <input id="beu-cashmax" type="number" min="1" value="${u.cash_max || 5000}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
      <div class="field"><label>Replenish Interval (hours)</label>
        <input id="beu-interval" type="number" min="1" value="${u.replenish_interval_hours || 6}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
      <div class="field"><label>Hack Difficulty (1–10)</label>
        <input id="beu-diff" type="number" min="1" max="10" value="${u.hack_difficulty || 5}" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
    </div>`);
  document.getElementById('modal-save').onclick = () => bankSaveUnit(id);
}

async function bankSaveUnit(id) {
  const body = {
    network_id:              document.getElementById('beu-network').value || null,
    cash_max:                parseInt(document.getElementById('beu-cashmax').value, 10),
    replenish_interval_hours: parseInt(document.getElementById('beu-interval').value, 10),
    hack_difficulty:          parseInt(document.getElementById('beu-diff').value, 10),
  };
  try {
    await directAPI(`/atm/units/${id}`, 'PUT', body);
    toast('ATM unit saved.');
    closeModal();
    renderBankPanel();
  } catch (e) { toast(e.message, true); }
}

async function bankReplenishAll() {
  const res = await directAPI('/atm/replenish-all', 'POST').catch(e => ({ error: e.message }));
  if (res && res.error) { toast(res.error, true); return; }
  toast(`Replenished ${res.count ?? '?'} ATM(s).`);
  renderBankPanel();
}

// ── Create ATM Terminal ───────────────────────────────────────────────────────

function bankCreateAtm() {
  const zoneOpts = _bankZones
    .slice().sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
    .map(z => `<option value="${z.id}">${z.name || z.id}</option>`)
    .join('');
  const netOpts = _bankNetworks
    .map(n => `<option value="${n.id}">${n.name}</option>`)
    .join('');
  const fieldStyle = 'background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box';

  openModal('Create ATM Terminal', `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-size:11px;color:var(--text-dim);padding:4px 8px;background:var(--bg3);border-radius:3px;border-left:2px solid var(--accent)">
        Creates the furniture item (with the <code>atm</code> flag) and registers it as an ATM unit in one step.
      </div>
      <div class="field"><label>Terminal Name</label>
        <input id="batm-name" type="text" value="ATM Terminal" placeholder="ATM Terminal" style="${fieldStyle}">
      </div>
      <div class="field"><label>Description</label>
        <input id="batm-desc" type="text" value="A cash dispensing terminal." placeholder="A cash dispensing terminal." style="${fieldStyle}">
      </div>
      <div class="field"><label>Zone</label>
        <select id="batm-zone" style="${fieldStyle}">
          <option value="">— Unplaced —</option>${zoneOpts}
        </select>
      </div>
      <div class="field"><label>Network</label>
        <select id="batm-network" style="${fieldStyle}">
          <option value="">— Unaffiliated (CENTRAL BANK) —</option>${netOpts}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Cash Max (₵)</label>
          <input id="batm-cashmax" type="number" min="1" value="10000" style="${fieldStyle}">
        </div>
        <div class="field"><label>Replenish (hours)</label>
          <input id="batm-interval" type="number" min="1" value="6" style="${fieldStyle}">
        </div>
      </div>
      <div class="field"><label>Hack Difficulty (1–10)</label>
        <input id="batm-diff" type="number" min="1" max="10" value="5" style="${fieldStyle}">
      </div>
    </div>`);
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = 'Create';
  saveBtn.onclick = bankCreateAtmSave;
}

async function bankCreateAtmSave() {
  const name    = document.getElementById('batm-name').value.trim();
  const desc    = document.getElementById('batm-desc').value.trim();
  const zoneId  = document.getElementById('batm-zone').value || null;
  const network = document.getElementById('batm-network').value || null;
  const cashMax = parseInt(document.getElementById('batm-cashmax').value, 10) || 10000;
  const interval = parseInt(document.getElementById('batm-interval').value, 10) || 6;
  const diff    = parseInt(document.getElementById('batm-diff').value, 10) || 5;

  if (!name) { toast('Terminal name is required.', true); return; }

  // Create the furniture — server auto-creates atm_units row when flags.atm is set
  const fur = await API('/furniture', 'POST', {
    name, description: desc,
    zone_id: zoneId,
    object_type: 'terminal',
    flags: { atm: true, interactions: [] },
    light_on: 0,
  }).catch(e => ({ error: e.message }));

  if (fur?.error) { toast(fur.error, true); return; }

  const atmId = fur.id || fur.entityId;

  // Set ATM unit settings (the auto-created row has defaults; overwrite now)
  await directAPI(`/atm/units/${atmId}`, 'PUT', {
    network_id: network,
    cash_max: cashMax,
    cash_stock: cashMax,
    replenish_interval_hours: interval,
    hack_difficulty: diff,
  }).catch(e => toast(e.message, true));

  toast(`ATM Terminal "${name}" created.`);
  closeModal();
  renderBankPanel();
}

// ── Network actions ───────────────────────────────────────────────────────────

function _networkModal(title, n) {
  openModal(title, `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label>Network ID</label>
        <input id="bnet-id" type="text" value="${n.id || ''}" placeholder="e.g. corpbank" ${n.id ? 'disabled' : ''}
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
      <div class="field"><label>Name</label>
        <input id="bnet-name" type="text" value="${n.name || ''}" placeholder="CorpBank Terminal"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
      <div class="field"><label>Color</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="bnet-color-picker" type="color" value="${n.color || '#00ff88'}"
            style="width:36px;height:32px;padding:2px;border:1px solid var(--border);background:var(--bg3);cursor:pointer;flex-shrink:0"
            oninput="document.getElementById('bnet-color').value=this.value">
          <input id="bnet-color" type="text" value="${n.color || '#00ff88'}" placeholder="#00ff88"
            style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;flex:1;box-sizing:border-box"
            oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('bnet-color-picker').value=this.value">
        </div>
      </div>
      <div class="field"><label>Fee Rate (0.0 – 1.0)</label>
        <input id="bnet-fee" type="number" min="0" max="1" step="0.01" value="${n.fee_rate ?? 0}"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
      <div class="field"><label>Withdrawal Limit (₵)</label>
        <input id="bnet-limit" type="number" min="1" value="${n.withdrawal_limit ?? 500}"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
      <div class="field"><label>Min Faction Rep (–200 = open)</label>
        <input id="bnet-rep" type="number" value="${n.min_faction_rep ?? -200}"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
      <div class="field"><label>Faction ID (optional)</label>
        <input id="bnet-faction" type="text" value="${n.faction_id || ''}" placeholder="e.g. corp"
          style="background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);padding:5px 8px;width:100%;box-sizing:border-box">
      </div>
    </div>`);
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = n.id ? 'Save' : 'Create';
  saveBtn.onclick = () => bankSaveNetwork(!!n.id);
}

function bankNewNetwork() { _networkModal('New ATM Network', {}); }

function bankEditNetwork(id) {
  const n = _bankNetworks.find(x => x.id === id);
  if (!n) return;
  _networkModal(`Edit Network: ${n.name}`, n);
}

async function bankSaveNetwork(isEdit) {
  const body = {
    id:              document.getElementById('bnet-id').value.trim(),
    name:            document.getElementById('bnet-name').value.trim(),
    color:           document.getElementById('bnet-color').value.trim() || '#00ff88',
    fee_rate:        parseFloat(document.getElementById('bnet-fee').value) || 0,
    withdrawal_limit: parseInt(document.getElementById('bnet-limit').value, 10) || 500,
    min_faction_rep:  parseInt(document.getElementById('bnet-rep').value, 10) ?? -200,
    faction_id:      document.getElementById('bnet-faction').value.trim() || null,
  };
  if (!body.id || !body.name) { toast('ID and Name are required.', true); return; }
  try {
    if (isEdit) {
      await directAPI(`/atm/networks/${body.id}`, 'PUT', body);
    } else {
      await directAPI('/atm/networks', 'POST', body);
    }
    toast(isEdit ? 'Network saved.' : 'Network created.');
    closeModal();
    renderBankPanel();
  } catch (e) { toast(e.message, true); }
}

async function bankDeleteNetwork(id, name) {
  if (!confirm(`Delete network "${name}"? All linked ATMs will become unaffiliated.`)) return;
  try {
    await directAPI(`/atm/networks/${id}`, 'DELETE');
    toast('Network deleted.');
    renderBankPanel();
  } catch (e) { toast(e.message, true); }
}

async function bankInjectNetwork(id) {
  const n = _bankNetworks.find(n => n.id === id);
  const res = await directAPI(`/atm/networks/${id}/inject`, 'POST').catch(e => ({ error: e.message }));
  if (res && res.error) { toast(res.error, true); return; }
  toast(`Injected funds into ${res.count ?? '?'} ATM(s) on ${n ? n.name : id}.`);
  renderBankPanel();
}
