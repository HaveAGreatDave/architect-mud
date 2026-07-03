// Gossip Pool panel — inspector for the live in-memory gossip pool, with per-row
// and clear-all delete, plus a "spread as NPC" form that plants a rumour into the
// pool at a chosen NPC's zone. Rows arrive pre-sorted by strength from GET /gossip;
// text/subject/zone are HTML-escaped server-side.
const _gossipEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderGossip(data) {
  const panel = document.getElementById('list-panel');
  const rows = Array.isArray(data) ? data : [];

  let html = `<div class="gossip-spread" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:8px">
      <select id="gossip-npc-select" style="min-width:200px"><option value="">Loading NPCs…</option></select>
      <input id="gossip-spread-text" type="text" maxlength="200" placeholder="What's the word on the street?" style="flex:1;min-width:220px" onkeydown="if(event.key==='Enter')spreadGossipAsNpc()" />
      <button class="action-btn" onclick="spreadGossipAsNpc()">🗣 Spread as NPC</button>
    </div>
    <div style="padding:8px 0">
      <button class="action-btn danger" onclick="clearGossip()" ${rows.length ? '' : 'disabled'}>🗑 Clear all (${rows.length})</button>
    </div>`;

  populateGossipNpcs();

  if (!rows.length) {
    panel.innerHTML = html + '<div style="padding:24px;color:var(--text-dim)">Pool is empty — no gossip circulating.</div>';
    return;
  }

  const age = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  html += '<table><thead><tr>'
    + ['Str', 'Category', 'Subject', 'Zone', 'On the street', 'Reach', 'Planted', 'Truth', 'Age', '']
        .map(h => `<th>${h}</th>`).join('')
    + '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr>'
      + `<td>${(r.strength ?? 0).toFixed(3)}</td>`
      + `<td>${r.category}</td>`
      + `<td>${r.subject}</td>`
      + `<td>${r.zone}</td>`
      + `<td><span style="color:var(--text-dim)">${r.text || ''}</span></td>`
      + `<td>${r.reach}</td>`
      + `<td>${r.planted ? '🗣' : ''}</td>`
      + `<td>${r.truth == null ? '' : Number(r.truth).toFixed(2)}</td>`
      + `<td>${age(r.age_s)}</td>`
      + `<td><button class="action-btn danger" onclick="deleteGossipItem('${r.id}')">🗑</button></td>`
      + '</tr>';
  }
  html += '</tbody></table>';
  panel.innerHTML = html;
}

// Fill the NPC picker from the live roster (fetch first, then touch the DOM so the
// select — rendered by renderGossip after this kicks off — is present).
async function populateGossipNpcs() {
  const npcs = await API('/npcs');
  const sel = document.getElementById('gossip-npc-select');
  if (!sel) return;
  if (!Array.isArray(npcs)) { sel.innerHTML = '<option value="">Failed to load NPCs</option>'; return; }
  npcs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = '<option value="">— pick an NPC —</option>'
    + npcs.map(n => `<option value="${_gossipEsc(n.id)}">${_gossipEsc(n.name)}${n.zone_id ? ` — ${_gossipEsc(n.zone_id)}` : ''}</option>`).join('');
}

async function spreadGossipAsNpc() {
  const npcId = document.getElementById('gossip-npc-select')?.value;
  const text  = document.getElementById('gossip-spread-text')?.value.trim();
  if (!npcId) { toast('Pick an NPC first', true); return; }
  if (!text)  { toast('Enter the rumour text', true); return; }
  const r = await API('/gossip', 'POST', { npcId, text });
  if (r?.error) { toast(r.error, true); return; }
  toast('Rumour spread');
  loadPanel('gossip');
}

async function deleteGossipItem(id) {
  const r = await API('/gossip/' + encodeURIComponent(id), 'DELETE');
  if (r?.error) { toast(r.error, true); return; }
  toast('Gossip removed');
  loadPanel('gossip');
}

async function clearGossip() {
  if (!(await dpConfirm('Clear the entire gossip pool?', { danger: true }))) return;
  const r = await API('/gossip', 'DELETE');
  if (r?.error) { toast(r.error, true); return; }
  toast(`Cleared ${r.cleared ?? 0} item(s)`);
  loadPanel('gossip');
}
