// Gossip Pool panel — read-only inspector for the live in-memory gossip pool,
// with per-row and clear-all delete. Rows arrive pre-sorted by strength from
// GET /gossip; text/subject/zone are HTML-escaped server-side.
function renderGossip(data) {
  const panel = document.getElementById('list-panel');
  const rows = Array.isArray(data) ? data : [];

  let html = `<div style="padding:8px 0">
    <button class="action-btn danger" onclick="clearGossip()" ${rows.length ? '' : 'disabled'}>🗑 Clear all (${rows.length})</button>
  </div>`;

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

async function deleteGossipItem(id) {
  const r = await API('/gossip/' + encodeURIComponent(id), 'DELETE');
  if (r?.error) { toast(r.error, true); return; }
  toast('Gossip removed');
  loadPanel('gossip');
}

async function clearGossip() {
  if (!confirm('Clear the entire gossip pool?')) return;
  const r = await API('/gossip', 'DELETE');
  if (r?.error) { toast(r.error, true); return; }
  toast(`Cleared ${r.cleared ?? 0} item(s)`);
  loadPanel('gossip');
}
