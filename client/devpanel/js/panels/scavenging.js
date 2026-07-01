// Scavenging tables panel — reusable loot templates attached to zones via
// flags.scavenging_table_id. Per-zone stock/state is derived by the engine and
// shown read-only. Entries are edited as a row builder (no raw JSON).

let _scavItems = [];

function scavItemOptions(items, selectedId) {
  const opts = items.map(it => `<option value="${it.id}" ${it.id===selectedId?'selected':''}>${it.name} (${it.id})</option>`);
  if (selectedId && !items.some(it => it.id===selectedId)) opts.unshift(`<option value="${selectedId}" selected>${selectedId} (missing!)</option>`);
  return opts.join('');
}

// difficulty is the opposing value in the 2d8−2d8 check; the swing tops out at
// +14, so an item is only reachable once effective skill ≥ difficulty − 14.
function scavReachHint(difficulty) {
  const d = parseInt(difficulty) || 0;
  const reach = d - 14;
  return reach <= 0 ? 'reachable by anyone' : `needs Scavenging ≥ ${reach}`;
}

function scavEntryRow(items, entry) {
  const e = entry || {};
  const sel = e.item_id || '';
  return `<div class="scav-entry-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:2"><label>Item</label>
      <select class="scav-item">${sel?'':'<option value="">— select item —</option>'}${scavItemOptions(items, sel)}</select>
    </div>
    <div class="field" style="flex:0 0 88px"><label>Difficulty</label>
      <input type="number" class="scav-difficulty" value="${e.difficulty ?? 5}" min="0" step="1" oninput="scavUpdateHints()">
    </div>
    <div class="field" style="flex:0 0 72px"><label>Weight</label>
      <input type="number" class="scav-weight" value="${e.weight ?? 10}" min="0" step="1" oninput="scavUpdateHints()">
    </div>
    <div class="field" style="flex:0 0 62px"><label>Max qty</label>
      <input type="number" class="scav-maxqty" value="${e.max_qty ?? 3}" min="1" step="1">
    </div>
    <button type="button" class="action-btn" onclick="removeScavEntry(this)" style="flex:0 0 auto">×</button>
  </div>
  <div class="scav-entry-hint" style="font-size:11px;color:var(--text-dim);margin:-4px 0 8px 2px"></div>`;
}

function addScavEntry() {
  document.getElementById('scav-entry-rows').insertAdjacentHTML('beforeend', scavEntryRow(_scavItems, {}));
  scavUpdateHints();
}
function removeScavEntry(btn) {
  const row = btn.closest('.scav-entry-row');
  const hint = row.nextElementSibling;
  if (hint && hint.classList.contains('scav-entry-hint')) hint.remove();
  row.remove();
  scavUpdateHints();
}

// Live per-row hints: reach threshold + this entry's share of the weighted draw.
function scavUpdateHints() {
  const rows = [...document.querySelectorAll('#scav-entry-rows .scav-entry-row')];
  const weights = rows.map(r => parseInt(r.querySelector('.scav-weight').value) || 0);
  const total = weights.reduce((a, b) => a + b, 0);
  rows.forEach((r, i) => {
    const diff = r.querySelector('.scav-difficulty').value;
    const pct = total > 0 ? Math.round((weights[i] / total) * 100) : 0;
    const hint = r.nextElementSibling;
    if (hint && hint.classList.contains('scav-entry-hint')) {
      hint.textContent = `${scavReachHint(diff)} · ~${pct}% of draws`;
    }
  });
}

async function scavengingEditForm(rec, isNew) {
  _scavItems = await API('/items');
  if (!Array.isArray(_scavItems)) _scavItems = [];
  _scavItems = _scavItems.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // The list row lacks entries/messages — fetch the full table when editing.
  let full = rec;
  if (!isNew && rec.id) {
    const fetched = await API(`/scavenging-tables/${encodeURIComponent(rec.id)}`);
    if (fetched && !fetched.error) full = fetched;
  }
  const entries = Array.isArray(full.entries) ? full.entries : [];
  const messages = (full.messages && typeof full.messages === 'object')
    ? full.messages
    : JSON.parse(full.messages || '{}');
  const playerLines = Array.isArray(messages.player) ? messages.player.join('\n') : '';
  const broadcastLines = Array.isArray(messages.broadcast) ? messages.broadcast.join('\n') : '';
  const intervalMin = ((parseInt(full.replenish_interval_seconds) || 300) / 60);

  const zoneNote = (!isNew && full.zone_count != null)
    ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">Attached to ${full.zone_count} zone(s).</div>` : '';

  return `
    <div class="field"><label>Table ID</label><input id="f-id" value="${isNew?'':full.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${full.name||''}">${zoneNote}</div>
    <div class="field"><label>Replenish interval (minutes) — one unit restocks per interval</label>
      <input type="number" id="f-interval-min" value="${intervalMin}" min="0.1" step="0.5" style="width:120px">
    </div>

    <div class="field-section-header" style="margin-top:14px;font-weight:600">Loot entries</div>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">
      Difficulty = how hard it is to find (2d8−2d8 check). Weight = relative draw chance. Max qty = per-zone stock cap.
    </div>
    <div id="scav-entry-rows">${entries.map(e => scavEntryRow(_scavItems, e)).join('')}</div>
    <button type="button" class="action-btn" onclick="addScavEntry()">+ Add item</button>

    <div class="field-section-header" style="margin-top:16px;font-weight:600">Flavor overrides (optional)</div>
    <div class="field"><label>Player lines — one per line; blank = engine defaults</label>
      <textarea id="f-msg-player" rows="3" placeholder="You paw through the debris…">${playerLines}</textarea>
    </div>
    <div class="field"><label>Broadcast lines — shown to the room on start; blank = engine defaults</label>
      <textarea id="f-msg-broadcast" rows="3" placeholder="{name} starts picking through the area…">${broadcastLines}</textarea>
    </div>
  `;
}

async function saveScavengingTable(existing) {
  const isNew = !existing?.id;
  const rows = [...document.querySelectorAll('#scav-entry-rows .scav-entry-row')];
  const entries = rows.map(r => ({
    item_id: r.querySelector('.scav-item').value,
    difficulty: parseInt(r.querySelector('.scav-difficulty').value) || 5,
    weight: parseInt(r.querySelector('.scav-weight').value) || 10,
    max_qty: parseInt(r.querySelector('.scav-maxqty').value) || 3,
  })).filter(e => e.item_id);

  const linesOf = id => document.getElementById(id).value.split('\n').map(s => s.trim()).filter(Boolean);
  const messages = {};
  const player = linesOf('f-msg-player');
  const broadcast = linesOf('f-msg-broadcast');
  if (player.length) messages.player = player;
  if (broadcast.length) messages.broadcast = broadcast;

  const body = {
    name: document.getElementById('f-name').value,
    replenish_interval_seconds: Math.max(1, Math.round((parseFloat(document.getElementById('f-interval-min').value) || 5) * 60)),
    entries,
    messages,
  };
  if (isNew) {
    body.id = document.getElementById('f-id').value.trim();
    if (!body.id) return { error: 'Table ID required' };
    return API('/scavenging-tables', 'POST', body);
  }
  return API(`/scavenging-tables/${existing.id}`, 'PUT', body);
}
