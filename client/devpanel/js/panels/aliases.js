// Aliases panel — verb shortcuts that rewrite to a canonical verb before dispatch.
// Pure CRUD over /command-aliases (directAPI, applied live — not staged). Engine
// defaults show as "default"; adding a row for a default alias overrides it, and
// deleting an override restores the shipped default.
function renderAliasesPanel(data) {
  const rows = Array.isArray(data) ? data : [];

  function esc(s) { return (s ?? '').toString().replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  document.getElementById('list-panel').innerHTML = `
    <div style="padding:12px;overflow-x:auto">
      <div style="display:flex;gap:6px;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap">
        <div class="field" style="margin:0"><label>Shortcut</label>
          <input id="alias-new-alias" placeholder="scav" style="width:120px" onkeydown="if(event.key==='Enter')aliasAdd()"></div>
        <div style="align-self:center;color:var(--text-dim);padding:0 2px 6px">→</div>
        <div class="field" style="margin:0"><label>Canonical verb</label>
          <input id="alias-new-verb" placeholder="scavenge" style="width:140px" onkeydown="if(event.key==='Enter')aliasAdd()"></div>
        <button class="action-btn success" style="margin-bottom:1px" onclick="aliasAdd()">+ Add</button>
      </div>
      <table class="data-table" style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="width:160px">Shortcut</th>
          <th style="width:40px"></th>
          <th>Canonical verb</th>
          <th style="width:90px">Source</th>
          <th style="width:60px"></th>
        </tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => `
            <tr>
              <td><code style="font-size:12px">${esc(r.alias)}</code></td>
              <td style="color:var(--text-dim)">→</td>
              <td><code style="font-size:12px">${esc(r.verb)}</code></td>
              <td>${r.is_default
                ? '<span style="color:var(--text-dim);font-size:11px">default</span>'
                : '<span style="color:var(--accent);font-size:11px">custom</span>'}</td>
              <td>${r.is_default
                ? '<span style="color:var(--text-dim);font-size:11px" title="Shipped with the engine. Add a row with this shortcut to override it.">—</span>'
                : `<button class="action-btn danger" style="font-size:11px;padding:2px 6px" onclick="aliasDelete('${esc(r.alias)}')">Del</button>`}</td>
            </tr>`).join('')
          : '<tr><td colspan="5" style="color:var(--text-dim);padding:12px">No aliases yet.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

window.aliasAdd = async function() {
  const alias = document.getElementById('alias-new-alias')?.value?.trim().toLowerCase();
  const verb  = document.getElementById('alias-new-verb')?.value?.trim().toLowerCase();
  if (!alias || !verb) { toast('Shortcut and verb are required', true); return; }
  const r = await directAPI('/command-aliases', 'POST', { alias, verb });
  if (r?.error) { toast(r.error, true); return; }
  toast(`Alias "${alias}" → "${verb}" saved`);
  loadPanel('aliases');
};

window.aliasDelete = async function(alias) {
  if (!(await dpConfirm(`Delete alias "${alias}"?`, { danger: true }))) return;
  const r = await directAPI(`/command-aliases/${encodeURIComponent(alias)}`, 'DELETE');
  if (r?.error) { toast(r.error, true); return; }
  toast(r?.reverted_to_default ? `"${alias}" reverted to engine default` : `Alias "${alias}" deleted`);
  loadPanel('aliases');
};
