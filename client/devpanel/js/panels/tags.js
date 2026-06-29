function renderTagsPanel(data) {
  const catalog = data?.catalog ?? data;
  const supertags = data?.supertags ?? {};
  const SHAPES = ['text','flag','int','enum','range','hot','statmap'];
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
    const isInstance = r?.scope === 'instance';
    const targets = isInstance ? [] : (r ? tagTargets(r) : ['item']);
    const ck = v => v ? ' checked' : '';
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div class="field"><label>Label</label><input id="td-label" value="${escVal(r?.label ?? '')}"></div>
        <div class="field"><label>Group</label><input id="td-group" value="${escVal(r?.group ?? '')}" placeholder="Core"></div>
        <div class="field"><label>Shape</label>
          <select id="td-shape">${SHAPES.map(s=>`<option value="${s}"${r?.shape===s?' selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"></div>
      </div>
      <div class="field" style="margin-bottom:8px">
        <label>Usable on</label>
        <div style="display:flex;gap:18px;padding:4px 0">
          <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer"><input type="checkbox" id="td-item"${ck(targets.includes('item'))}> Items</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer"><input type="checkbox" id="td-furniture"${ck(targets.includes('furniture'))}> Furniture</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer" title="Per-item runtime state (e.g. broken). Set by game logic, not attached in an editor."><input type="checkbox" id="td-instance"${ck(isInstance)}> Per-instance flag</label>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">Which editors offer this tag. A tag can apply to both. "Per-instance" tags are item runtime state and aren't offered in any editor.</div>
      </div>
      <div class="field"><label>Help</label><input id="td-help" value="${escVal(r?.help ?? '')}" placeholder="What this tag does..." style="width:100%"></div>`;
  }

  function readDialogFields() {
    const label = document.getElementById('td-label')?.value ?? '';
    const shape = document.getElementById('td-shape')?.value ?? 'flag';
    const group = document.getElementById('td-group')?.value ?? '';
    const help  = document.getElementById('td-help')?.value ?? '';
    const isInstance = document.getElementById('td-instance')?.checked;
    if (isInstance) return { label, shape, scope: 'instance', group, help, targets: [] };
    const targets = [];
    if (document.getElementById('td-item')?.checked) targets.push('item');
    if (document.getElementById('td-furniture')?.checked) targets.push('furniture');
    if (!targets.length) { toast('Pick at least one of Items / Furniture (or Per-instance flag)', true); return null; }
    return { label, shape, scope: 'class', group, help, targets };
  }

  function render() {
    const rows = buildRows();
    window._tagRows    = rows;
    window._tagCatalog = _catalog;
    document.getElementById('tag-catalog-section').innerHTML = `
      <div style="padding:12px;overflow-x:auto">
        <h3 style="margin:0 0 10px">Tags</h3>
        <div style="margin-bottom:10px">
          <button class="action-btn success" onclick="tagShowAdd()">+ New Tag</button>
        </div>
        <table class="data-table" style="width:100%;border-collapse:collapse">
          <thead><tr>
            ${th('key','Key')}
            ${th('label','Label')}
            ${th('shape','Shape')}
            ${th('scope','Usable on')}
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
                <td style="color:var(--text-dim);font-size:11px">${escVal(r.scope === 'instance' ? 'instance (runtime)' : (tagTargets(r).join(', ') || '—'))}</td>
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
    const { label, shape, scope, group, help, targets } = fields;
    window._tagCatalog[key] = { ...(window._tagCatalog[key] || {}), label, shape, scope, group, help, targets };
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
    const { label, shape, scope, group, help, targets } = fields;
    window._tagCatalog[key] = { ...(window._tagCatalog[key] || {}), label, shape, scope, group, help, targets };
    const r = await API('/tag-catalog', 'PUT', window._tagCatalog);
    if (r?.error) { toast(r.error, true); return; }
    toast(`"${key}" added to catalog`);
    closeModal();
    _catalog = { ...window._tagCatalog };
    render();
  };

  // ---- Supertags (reusable bundles of tags) ----
  let _supers = supertags && typeof supertags === 'object' ? { ...supertags } : {};

  function memberSummary(members) {
    const ks = Object.keys(members || {});
    if (!ks.length) return '<span style="color:var(--text-dim)">no member tags</span>';
    return ks.map(k => `<code style="font-size:11px">${escVal(k)}</code>`).join(' ');
  }

  function renderSupers() {
    const keys = Object.keys(_supers).sort();
    window._superDefs = _supers;
    document.getElementById('tag-supertag-section').innerHTML = `
      <div style="padding:12px;overflow-x:auto;border-top:1px solid var(--border);margin-top:12px">
        <h3 style="margin:0 0 4px">Supertags</h3>
        <div class="zone-subsection-note" style="margin-bottom:10px">Bundles of tags applied as a unit, e.g. a <code>weapon</code> supertag carrying its slot and combat tags. Applying one to an item stamps its members; editing a supertag re-applies it to every item using it.</div>
        <div style="margin-bottom:10px">
          <button class="action-btn success" onclick="superShowAdd()">+ New Supertag</button>
        </div>
        <table class="data-table" style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="white-space:nowrap">Key</th>
            <th>Label</th>
            <th>Group</th>
            <th>Member tags</th>
            <th style="width:80px"></th>
          </tr></thead>
          <tbody>
            ${keys.length ? keys.map(k => {
              const s = _supers[k] || {};
              return `<tr>
                <td><code style="font-size:11px">${escVal(k)}</code></td>
                <td>${escVal(s.label)}</td>
                <td style="color:var(--text-dim);font-size:11px">${escVal(s.group)}</td>
                <td>${memberSummary(s.members)}</td>
                <td style="white-space:nowrap">
                  <button class="action-btn" style="font-size:11px;padding:2px 6px" onclick="superEditRow('${escVal(k)}')">Edit</button>
                  <button class="action-btn danger" style="font-size:11px;padding:2px 6px;margin-left:3px" onclick="superDeleteRow('${escVal(k)}')">Del</button>
                </td>
              </tr>`;
            }).join('') : '<tr><td colspan="5" style="color:var(--text-dim);padding:8px">No supertags yet.</td></tr>'}
          </tbody>
        </table>
      </div>`;
  }

  function superMemberPickerHtml() {
    const present = [...document.querySelectorAll('#super-members .tag-row')].map(r => r.dataset.tag);
    const groups = {};
    for (const [name, def] of Object.entries(TAG_CATALOG)) {
      if (def.scope !== 'class' || name === 'description' || present.includes(name)) continue;
      (groups[def.group] = groups[def.group] || []).push([name, def]);
    }
    const optgroups = Object.entries(groups).map(([g, list]) =>
      `<optgroup label="${g}">${list.map(([n, d]) => `<option value="${n}">${d.label}</option>`).join('')}</optgroup>`).join('');
    return `<div class="field-row" style="align-items:flex-end">
      <div class="field"><label>Add member tag</label><select id="super-add-member">${optgroups}</select></div>
      <button type="button" class="action-btn" onclick="superAddMember()">Add</button>
    </div>`;
  }

  function superMemberRow(name, value) {
    const def = TAG_CATALOG[name];
    if (!def) return '';
    return `<div class="field tag-row" data-tag="${name}">
      <label>${def.label}<button type="button" onclick="superRemoveMember(this)" style="float:right;background:none;border:none;color:inherit;cursor:pointer;font-size:15px;line-height:1">×</button></label>
      ${itemTagWidget(name, value)}
      <div class="zone-subsection-note">${def.help}</div>
    </div>`;
  }

  function superDialogForm(s) {
    const members = (s && s.members) || {};
    const rows = Object.keys(members).filter(n => TAG_CATALOG[n]).map(n => superMemberRow(n, members[n])).join('');
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div class="field"><label>Label</label><input id="sd-label" value="${escVal(s?.label ?? '')}"></div>
        <div class="field"><label>Group</label><input id="sd-group" value="${escVal(s?.group ?? '')}" placeholder="Classes"></div>
      </div>
      <div class="field" style="margin-bottom:8px"><label>Help</label><input id="sd-help" value="${escVal(s?.help ?? '')}" placeholder="What this class of item is..." style="width:100%"></div>
      <label style="display:block;margin-bottom:4px">Member tags</label>
      <div id="super-members">${rows}</div>
      <div id="super-member-picker">${superMemberPickerHtml()}</div>`;
  }

  function readSuperMembers() {
    const members = {};
    for (const row of document.querySelectorAll('#super-members .tag-row')) members[row.dataset.tag] = readItemTag(row);
    return members;
  }

  window.superAddMember = function() {
    const name = document.getElementById('super-add-member')?.value;
    if (!name) return;
    const def = TAG_CATALOG[name];
    const defaults = { flag:true, int:0, enum:def.options?.[0], range:{min:0,max:0}, hot:{amount:0,duration_seconds:0}, statmap:{}, text:'' };
    document.getElementById('super-members').insertAdjacentHTML('beforeend', superMemberRow(name, defaults[def.shape]));
    document.getElementById('super-member-picker').innerHTML = superMemberPickerHtml();
  };

  window.superRemoveMember = function(btn) {
    btn.closest('.tag-row').remove();
    document.getElementById('super-member-picker').innerHTML = superMemberPickerHtml();
  };

  async function commitSupers() {
    const r = await API('/tag-supertags', 'PUT', _supers);
    if (r?.error) { toast(r.error, true); return false; }
    return true;
  }

  window.superShowAdd = function() {
    document.getElementById('modal-title').textContent = 'New Supertag';
    document.getElementById('modal-body').innerHTML = `
      <div class="field" style="margin-bottom:8px">
        <label>Key <span style="font-weight:normal;color:var(--text-dim)">(short name, e.g. weapon)</span></label>
        <input id="sd-key" placeholder="weapon" style="width:100%">
      </div>
      ${superDialogForm(null)}`;
    document.getElementById('modal-save').onclick = window.superAddNew;
    document.getElementById('generic-modal').style.display = 'flex';
    document.getElementById('sd-key')?.focus();
  };

  window.superEditRow = function(key) {
    const s = _supers[key];
    document.getElementById('modal-title').textContent = `Edit Supertag: ${key}`;
    document.getElementById('modal-body').innerHTML = superDialogForm(s);
    document.getElementById('modal-save').onclick = () => window.superSaveRow(key);
    document.getElementById('generic-modal').style.display = 'flex';
    document.getElementById('sd-label')?.focus();
  };

  function readSuperFields() {
    let members;
    try { members = readSuperMembers(); } catch (e) { toast(e.message, true); return null; }
    return {
      label: document.getElementById('sd-label')?.value ?? '',
      group: document.getElementById('sd-group')?.value ?? '',
      help:  document.getElementById('sd-help')?.value ?? '',
      members,
    };
  }

  window.superAddNew = async function() {
    const key = document.getElementById('sd-key')?.value?.trim();
    if (!key) { toast('Key is required', true); return; }
    if (_supers[key]) { toast(`"${key}" already exists`, true); return; }
    const fields = readSuperFields();
    if (!fields) return;
    _supers[key] = fields;
    if (!await commitSupers()) { delete _supers[key]; return; }
    toast(`"${key}" added`);
    closeModal();
    renderSupers();
  };

  window.superSaveRow = async function(key) {
    const fields = readSuperFields();
    if (!fields) return;
    const prev = _supers[key];
    _supers[key] = fields;
    const r = await API('/tag-supertags', 'PUT', _supers);
    if (r?.error) { _supers[key] = prev; toast(r.error, true); return; }
    toast(r?.rematerialized ? `Saved — ${r.rematerialized} item(s) updated` : 'Supertag saved');
    closeModal();
    renderSupers();
  };

  window.superDeleteRow = async function(key) {
    if (!confirm(`Delete supertag "${key}"? Items already stamped keep their tags but lose the live link.`)) return;
    const prev = _supers[key];
    delete _supers[key];
    if (!await commitSupers()) { _supers[key] = prev; return; }
    toast(`"${key}" deleted`);
    renderSupers();
  };

  document.getElementById('list-panel').innerHTML =
    '<div id="tag-catalog-section"></div><div id="tag-supertag-section"></div>';
  render();
  renderSupers();
}

// Enemies / spawns
