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
      ${isHistory ? '' : `<td style="padding:5px 0 5px 12px;text-align:right;white-space:nowrap"><button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="clearWantedSlate('${_crimeEsc(c.playerId)}','${_crimeEsc(c.perpetrator)}')">Clear</button></td>`}
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
      ${isHistory ? '' : '<th style="padding:0 0 6px 12px;font-weight:700"></th>'}
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
  _refreshJailRoll();
  // One timer for both tables — they live on the same panel and share a cadence.
  _crimeLogTimer = setInterval(() => { _refreshCrimeLog(); _refreshJailRoll(); }, 3000);
}

// ── Prison roll: who's inside, and the pardon button ─────────────────────────
function _remain(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  return m ? `${m}m ${sec % 60}s` : `${sec}s`;
}

function _jailRollHtml(prisoners) {
  if (!prisoners.length) return `<div style="font-size:11px;color:var(--text-dim);padding:6px 0">Holding is empty.</div>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;font-size:9px">
      <th style="text-align:left;padding:0 12px 6px 0;font-weight:700">Prisoner</th>
      <th style="text-align:left;padding:0 12px 6px 0;font-weight:700">Charge</th>
      <th style="text-align:left;padding:0 12px 6px 0;font-weight:700">Sentence</th>
      <th style="text-align:right;padding:0 12px 6px 0;font-weight:700">Fine</th>
      <th style="text-align:right;padding:0 0 6px 0;font-weight:700">Remaining</th>
      <th style="padding:0 0 6px 12px;font-weight:700"></th>
    </tr></thead>
    <tbody>${prisoners.map(p => `
      <tr>
        <td style="padding:5px 12px 5px 0;color:var(--text);font-weight:600">${_crimeEsc(p.handle)}${p.online ? '' : ' <span style="font-weight:400;color:var(--text-dim)">(offline)</span>'}</td>
        <td style="padding:5px 12px 5px 0;color:var(--text-dim)">${_crimeEsc(p.charge)}</td>
        <td style="padding:5px 12px 5px 0;color:#ff6b6b;letter-spacing:1px;white-space:nowrap">${_starBar(p.stars)}</td>
        <td style="padding:5px 12px 5px 0;color:var(--text-dim);text-align:right;white-space:nowrap">₵${p.fine}</td>
        <td style="padding:5px 0;color:var(--text-dim);text-align:right;white-space:nowrap">${_remain(p.remainingSec)}</td>
        <td style="padding:5px 0 5px 12px;text-align:right"><button class="action-btn" style="font-size:10px;padding:3px 8px" onclick="pardonPrisoner('${_crimeEsc(p.playerId)}','${_crimeEsc(p.handle)}')">Pardon</button></td>
      </tr>`).join('')}</tbody>
  </table>`;
}

async function _refreshJailRoll() {
  const body = document.getElementById('jail-roll-body');
  if (!body) return;
  const data = await directAPI('/jail/prisoners');
  const el = document.getElementById('jail-roll-body');
  if (!el) return;   // navigated away mid-request
  if (data?.error) {
    el.innerHTML = `<div style="font-size:11px;color:var(--text-dim);padding:6px 0">${_crimeEsc(data.error)}</div>`;
    return;
  }
  el.innerHTML = _jailRollHtml(Array.isArray(data?.prisoners) ? data.prisoners : []);
}

async function pardonPrisoner(playerId, handle) {
  if (!playerId) { toast('No player id for that row', true); return; }
  if (!(await dpConfirm(`Pardon ${handle}? They walk out now and the fine is forgiven.`))) return;
  const r = await directAPI('/jail/pardon', 'POST', { playerId });
  if (r?.error) { toast(r.error, true); return; }
  toast(`${handle} pardoned${r.forgiven ? ` — ₵${r.forgiven} fine forgiven` : ''}`);
  _refreshJailRoll();
  _refreshCrimeLog();
}

let _espDefaultMessage = '';

function renderEmergencyPanel(data) {
  const panel = document.getElementById('list-panel');
  const active  = !!data?.active;
  const message = data?.message || '';
  _espDefaultMessage = data?.defaultMessage || '';
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

      <!-- Prison Roll -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim)">Prison Roll</div>
          <span style="font-size:10px;color:var(--text-dim)">a pardon releases at once and forgives the fine</span>
        </div>
        <div id="jail-roll-body"><div style="font-size:11px;color:var(--text-dim);padding:6px 0">Loading…</div></div>
      </div>

      <!-- Penalties -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px">Penalties</div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--text-dim)">Fine &amp; jail-time multiplier</span>
          <input id="crime-mult" type="number" min="0" max="100" step="0.5" value="6" style="width:70px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          <span style="font-size:12px;color:var(--text-dim)">×</span>
          <button class="action-btn" onclick="saveCrimeMult()">Save</button>
        </div>
        <div style="margin-top:10px;font-size:10px;color:var(--text-dim)">Scales every booking fine and jail sentence. Default 6 (6× the old baseline).</div>
      </div>

      <!-- Surveillance -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px">Surveillance</div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:11px;color:var(--text-dim);white-space:nowrap">Camera effectiveness</span>
          <input id="cam-eff" type="range" min="0" max="100" step="5" value="50" oninput="camEffLabel(this.value)" onchange="saveCamEff(this.value)" style="flex:1;accent-color:var(--accent)">
          <span id="cam-eff-val" style="font-size:12px;color:var(--text);font-weight:700;min-width:42px;text-align:right">50%</span>
        </div>
        <div style="margin-top:10px;font-size:10px;color:var(--text-dim)">Global scalar on every camera's chance to make a crime. 0% = lenses never catch you; 100% = full base→ceiling ramp. Cops and bystanders are unaffected.</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:16px">
          <span style="font-size:11px;color:var(--text-dim);white-space:nowrap">Camera buffer (lines/clip)</span>
          <input id="cam-buf" type="number" min="1" max="500" step="1" value="25" style="width:70px;background:var(--bg3);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 8px;border-radius:2px">
          <button class="action-btn" onclick="saveCamBuffer()">Save</button>
        </div>
        <div style="margin-top:10px;font-size:10px;color:var(--text-dim)">Rolling number of activity lines (speech, arrivals/exits, actions) a recording sticky-cam keeps per clip. Default 25.</div>
      </div>

      <!-- Crime Registry -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:20px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-dim);margin-bottom:12px">Crime Registry — enforcement &amp; wanted-star weight</div>
        <div id="crime-registry"><div style="font-size:11px;color:var(--text-dim);padding:6px 0">Loading…</div></div>
        <div style="margin-top:10px;font-size:10px;color:var(--text-dim)">A disabled crime never charges wanted stars or heat when witnessed. Stars are additive across crimes and capped at 5 (half-steps allowed).</div>
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
          <button class="action-btn" onclick="espResetMessage()" ${_espDefaultMessage ? '' : 'disabled style="opacity:0.35"'}>Reset to Default</button>
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
  _loadCrimeConfig();
}

// ── ESP controls ──────────────────────────────────────────────────────────────

// ── Crime config: penalty multiplier + per-crime on/off toggles ───────────────
async function _loadCrimeConfig() {
  const cfg = await directAPI('/crime-config');
  const mi = document.getElementById('crime-mult');
  if (mi && cfg && cfg.multiplier != null) mi.value = cfg.multiplier;
  if (cfg && cfg.cameraEffectiveness != null) {
    const pct = Math.round(cfg.cameraEffectiveness * 100);
    const ce = document.getElementById('cam-eff');
    if (ce) ce.value = pct;
    camEffLabel(pct);
  }
  const cb = document.getElementById('cam-buf');
  if (cb && cfg && cfg.cameraBufferLines != null) cb.value = cfg.cameraBufferLines;
  const crimes = await directAPI('/crimes');
  const box = document.getElementById('crime-registry');
  if (!box) return;
  if (!Array.isArray(crimes)) { box.innerHTML = `<div style="font-size:11px;color:#ff6b6b">${_crimeEsc(crimes?.error || 'failed to load crimes')}</div>`; return; }
  box.innerHTML = crimes.map(c => `
    <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border)">
      <label class="toggle-switch" style="flex-shrink:0"><input type="checkbox" ${c.enabled !== false ? 'checked' : ''} onchange="toggleCrime('${c.id}', this.checked)"><span class="toggle-slider"></span></label>
      <span style="font-size:11px;color:var(--text);${c.enabled === false ? 'opacity:0.45;text-decoration:line-through' : ''}">${_crimeEsc(c.label)}</span>
      <input type="number" min="0" max="5" step="0.5" value="${c.stars}" onchange="saveCrimeStars('${c.id}', this.value)" title="Wanted stars this crime adds" style="margin-left:auto;width:52px;background:var(--bg3);border:1px solid var(--border);color:#ff6b6b;font-family:var(--font);font-size:11px;padding:3px 6px;border-radius:2px;text-align:right">
      <span style="font-size:10px;color:#ff6b6b">★</span>
      <span style="font-size:9px;color:var(--text-dim);text-transform:uppercase;min-width:52px;text-align:right">${_crimeEsc(c.witness)}</span>
    </div>`).join('');
}

async function saveCrimeStars(id, value) {
  const stars = Number(value);
  const r = await directAPI(`/crimes/${id}`, 'PUT', { stars });
  if (r.error) { toast(r.error, true); return; }
  toast(`Wanted weight set to ${stars}★`);
  _loadCrimeConfig();
}
async function saveCrimeMult() {
  const v = Number(document.getElementById('crime-mult').value);
  const r = await directAPI('/crime-config', 'PUT', { multiplier: v });
  if (r.error) { toast(r.error, true); return; }
  toast(`Penalty multiplier set to ${r.multiplier}×`);
}
function camEffLabel(v) {
  const el = document.getElementById('cam-eff-val');
  if (el) el.textContent = `${Math.round(Number(v))}%`;
}
async function saveCamEff(v) {
  const r = await directAPI('/crime-config', 'PUT', { cameraEffectiveness: Number(v) / 100 });
  if (r.error) { toast(r.error, true); return; }
  toast(`Camera effectiveness set to ${Math.round((r.cameraEffectiveness ?? 0) * 100)}%`);
}
async function saveCamBuffer() {
  const v = Number(document.getElementById('cam-buf').value);
  const r = await directAPI('/crime-config', 'PUT', { cameraBufferLines: v });
  if (r.error) { toast(r.error, true); return; }
  toast(`Camera buffer set to ${r.cameraBufferLines} lines`);
}
async function toggleCrime(id, enabled) {
  const r = await directAPI(`/crimes/${id}`, 'PUT', { enabled });
  if (r.error) { toast(r.error, true); return; }
  _loadCrimeConfig();
}

// Admin scrub: wipe a suspect's wanted stars + invisible heat in one shot.
async function clearWantedSlate(playerId, perpetrator) {
  if (!playerId) { toast('No player id for that row', true); return; }
  if (!(await dpConfirm(`Clear ${perpetrator}'s wanted stars and heat? This wipes their entire slate.`, { danger: true }))) return;
  const r = await directAPI('/surveillance/clear-slate', 'POST', { playerId });
  if (r?.error) { toast(r.error, true); return; }
  toast(`${perpetrator}'s slate cleared`);
  _refreshCrimeLog();
}

async function espActivate() {
  const message = document.getElementById('esp-msg')?.value?.trim();
  const r = await directAPI('/emergency/activate', 'POST', { message: message || undefined });
  if (r.error) { toast(r.error, true); return; }
  toast(`⚠ Emergency Security Protocol ENGAGED — ${r.zones} zone(s) under alert`);
  updateEspDot(true);
  loadPanel('emergency');
}

async function espDeactivate() {
  if (!(await dpConfirm('Stand down Emergency Security Protocol? This will silence the siren and clear all alerts.', { danger: true }))) return;
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

// Restore the built-in default warning text (both the textarea and the server).
async function espResetMessage() {
  if (!_espDefaultMessage) { toast('Default message unavailable', true); return; }
  const ta = document.getElementById('esp-msg');
  if (ta) ta.value = _espDefaultMessage;
  const r = await directAPI('/emergency/message', 'PUT', { message: _espDefaultMessage });
  if (r.error) { toast(r.error, true); return; }
  toast('Warning message reset to default');
}

// ── Arbiter controls ──────────────────────────────────────────────────────────

async function arbitersActivate() {
  const r = await directAPI('/emergency/arbiters/activate', 'POST', {});
  if (r.error) { toast(r.error, true); return; }
  toast(`⚡ Arbiters deployed — ${r.spawned} unit(s) across ${r.arrays} array(s)`);
  loadPanel('emergency');
}

async function arbitersStandDown() {
  if (!(await dpConfirm('Order all Arbiters to stand down and return to their bays?', { danger: true }))) return;
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
