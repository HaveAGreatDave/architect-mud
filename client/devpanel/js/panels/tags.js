function renderTagsPanel(catalog) {
  const SHAPES = ['text','flag','int','enum','range','hot','statmap'];
  const SCOPES = ['class','instance'];
  let _catalog = catalog && typeof catalog === 'object' ? { ...catalog } : {};
  let _sortKey = 'key';
  let _sortDir = 1;

  function buildRows() {
    return Object.entries(_catalog)
      .map(([k, v]) => ({ key: k, ...(v || {}) }))
      .sort((a, b) => {
        const av = (a[_sortKey] ?? '').toString().toLowerCase();
        const bv = (b[_sortKey] ?? '').toString().toLowerCase();
        return av < bv ? -_sortDir : av > bv ? _sortDir : 0;
      });
  }

  function th(key, label) {
    const arrow = _sortKey === key ? (_sortDir === 1 ? ' ▲' : ' ▼') : '';
    return `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="tagSortBy('${key}')">${label}${arrow}</th>`;
  }

  function escVal(s) { return (s ?? '').toString().replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  const STD_KEYS = new Set(['key','label','shape','scope','group','help']);
  function rowExtraJson(r) {
    const obj = Object.fromEntries(Object.entries(r).filter(([k]) => !STD_KEYS.has(k)));
    return Object.keys(obj).length ? JSON.stringify(obj, null, 2) : '';
  }

  function tagDialogForm(r) {
    const xj = r ? rowExtraJson(r) : '';
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div class="field"><label>Label</label><input id="td-label" value="${escVal(r?.label ?? '')}"></div>
        <div class="field"><label>Group</label><input id="td-group" value="${escVal(r?.group ?? '')}" placeholder="Core"></div>
        <div class="field"><label>Shape</label>
          <select id="td-shape">${SHAPES.map(s=>`<option value="${s}"${r?.shape===s?' selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Scope</label>
          <select id="td-scope">${SCOPES.map(s=>`<option value="${s}"${r?.scope===s?' selected':''}>${s}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label>Help</label><input id="td-help" value="${escVal(r?.help ?? '')}" placeholder="What this tag does..." style="width:100%"></div>`;
  }

  function readDialogFields() {
    const label = document.getElementById('td-label')?.value ?? '';
    const shape = document.getElementById('td-shape')?.value ?? 'flag';
    const scope = document.getElementById('td-scope')?.value ?? 'class';
    const group = document.getElementById('td-group')?.value ?? '';
    const help  = document.getElementById('td-help')?.value ?? '';
    return { label, shape, scope, group, help };
  }

  function render() {
    const rows = buildRows();
    window._tagRows    = rows;
    window._tagCatalog = _catalog;
    document.getElementById('list-panel').innerHTML = `
      <div style="padding:12px;overflow-x:auto">
        <div style="margin-bottom:10px">
          <button class="action-btn success" onclick="tagShowAdd()">+ New Tag</button>
        </div>
        <table class="data-table" style="width:100%;border-collapse:collapse">
          <thead><tr>
            ${th('key','Key')}
            ${th('label','Label')}
            ${th('shape','Shape')}
            ${th('scope','Scope')}
            ${th('group','Group')}
            <th>Help</th>
            <th style="width:80px"></th>
          </tr></thead>
          <tbody>
            ${rows.map((r, i) => `
              <tr>
                <td><code style="font-size:11px">${escVal(r.key)}</code></td>
                <td>${escVal(r.label)}</td>
                <td><span class="badge">${escVal(r.shape)}</span></td>
                <td style="color:var(--text-dim);font-size:11px">${escVal(r.scope)}</td>
                <td style="color:var(--text-dim);font-size:11px">${escVal(r.group)}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text-dim)" title="${escVal(r.help)}">${escVal(r.help)}</td>
                <td style="white-space:nowrap">
                  <button class="action-btn" style="font-size:11px;padding:2px 6px" onclick="tagEditRow(${i})">Edit</button>
                  <button class="action-btn danger" style="font-size:11px;padding:2px 6px;margin-left:3px" onclick="tagDeleteRow(${i})">Del</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  window.tagSortBy = function(key) {
    if (_sortKey === key) _sortDir = -_sortDir; else { _sortKey = key; _sortDir = 1; }
    render();
  };

  window.tagEditRow = function(i) {
    const r = window._tagRows[i];
    document.getElementById('modal-title').textContent = `Edit Tag: ${r.key}`;
    document.getElementById('modal-body').innerHTML = tagDialogForm(r);
    document.getElementById('modal-save').onclick = () => window.tagSaveRow(i);
    document.getElementById('generic-modal').style.display = 'flex';
    document.getElementById('td-label')?.focus();
  };

  window.tagSaveRow = async function(i) {
    const key = window._tagRows[i].key;
    const fields = readDialogFields();
    if (!fields) return;
    const { label, shape, scope, group, help } = fields;
    window._tagCatalog[key] = { label, shape, scope, group, help };
    const r = await API('/tag-catalog', 'PUT', window._tagCatalog);
    if (r?.error) { toast(r.error, true); return; }
    toast('Tag saved');
    closeModal();
    _catalog = { ...window._tagCatalog };
    render();
  };

  window.tagDeleteRow = async function(i) {
    const key = window._tagRows[i].key;
    if (!confirm(`Delete tag "${key}" from the catalog? Existing items with this tag are unaffected.`)) return;
    delete window._tagCatalog[key];
    const r = await API('/tag-catalog', 'PUT', window._tagCatalog);
    if (r?.error) { toast(r.error, true); return; }
    toast(`"${key}" removed from catalog`);
    _catalog = { ...window._tagCatalog };
    render();
  };

  window.tagShowAdd = function() {
    document.getElementById('modal-title').textContent = 'New Tag';
    document.getElementById('modal-body').innerHTML = `
      <div class="field" style="margin-bottom:8px">
        <label>Key <span style="font-weight:normal;color:var(--text-dim)">(namespace:name)</span></label>
        <input id="td-key" placeholder="lock:newtype" style="width:100%">
      </div>
      ${tagDialogForm(null)}`;
    document.getElementById('modal-save').onclick = window.tagAddNew;
    document.getElementById('generic-modal').style.display = 'flex';
    document.getElementById('td-key')?.focus();
  };

  window.tagAddNew = async function() {
    const key = document.getElementById('td-key')?.value?.trim();
    if (!key) { toast('Key is required', true); return; }
    if (window._tagCatalog[key]) { toast(`"${key}" already exists`, true); return; }
    const fields = readDialogFields();
    if (!fields) return;
    const { label, shape, scope, group, help } = fields;
    window._tagCatalog[key] = { label, shape, scope, group, help };
    const r = await API('/tag-catalog', 'PUT', window._tagCatalog);
    if (r?.error) { toast(r.error, true); return; }
    toast(`"${key}" added to catalog`);
    closeModal();
    _catalog = { ...window._tagCatalog };
    render();
  };

  render();
}

// Enemies / spawns
