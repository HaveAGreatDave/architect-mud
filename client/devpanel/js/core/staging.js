let pendingChanges = [];
let _publishLog = []; // persists until next publish so it stays visible after panel reload

async function updateStagingBadge() {
  const data = await API('/staging/pending').catch(() => null);
  if (!data?.changes) return;
  pendingChanges = data.changes;
  const count = pendingChanges.length;
  const badge = document.getElementById('staging-badge');
  const publishBtn = document.getElementById('publish-all-btn');
  const rejectBtn = document.getElementById('reject-all-btn');
  if (badge) badge.textContent = count;
  if (publishBtn) publishBtn.style.display = count > 0 ? '' : 'none';
  if (rejectBtn) rejectBtn.style.display = count > 0 ? '' : 'none';
  const navItem = document.getElementById('changes-nav-item');
  if (navItem) navItem.textContent = count > 0 ? `📋 Changes (${count})` : '📋 Changes';
}

function _resolveReturnPanel() {
  if (mapZoneEditReturn) { mapZoneEditReturn = false; return 'maps'; }
  return currentPanel;
}

async function publishAll() {
  if (!(await dpConfirm(`Publish all ${pendingChanges.length} staged change${pendingChanges.length !== 1 ? 's' : ''} to the live world?`))) return;
  const stagedFurnitureNames = _furnitureAllItems.filter(f => f._staged).map(f => f.name);
  const hasFurnitureChanges = _furnitureAllItems.some(f => f._staged || f._markedForDeletion);
  const result = await API('/staging/publish', 'POST', { all: true });
  if (result.error) { toast(result.error, true); return; }
  _mapPendingOverrides.clear();
  _publishLog = buildPublishLog(result, pendingChanges);
  toast(`✓ ${result.message}`);
  await updateStagingBadge();
  if (hasFurnitureChanges) {
    const freshData = await PANELS.furniture.fetch();
    _furnitureAllItems = Array.isArray(freshData) ? freshData : (freshData.furniture || []);
    stagedFurnitureNames.forEach(n => _furniturePublishedNames.add(n));
    setTimeout(() => {
      stagedFurnitureNames.forEach(n => _furniturePublishedNames.delete(n));
      if (currentPanel === 'furniture') renderFurniturePanel({ furniture: _furnitureAllItems, zones: [..._furnitureZoneNames.entries()].map(([id, name]) => ({ id, name })) });
    }, 6000);
  }
  loadPanel(_resolveReturnPanel());
}

async function rejectAll() {
  if (!(await dpConfirm(`Discard all ${pendingChanges.length} staged change${pendingChanges.length !== 1 ? 's' : ''}? This cannot be undone.`, { danger: true }))) return;
  const result = await API('/staging/reject', 'POST', { all: true });
  if (result.error) { toast(result.error, true); return; }
  _mapPendingOverrides.clear();
  toast(result.message);
  await updateStagingBadge();
  if (currentPanel === 'changes') loadPanel('changes');
}

async function publishSelected() {
  const checked = [...document.querySelectorAll('.change-cb:checked')].map(el => el.dataset.id);
  if (!checked.length) { toast('Select at least one change', true); return; }
  if (!(await dpConfirm(`Publish ${checked.length} selected change${checked.length !== 1 ? 's' : ''}?`))) return;
  const result = await API('/staging/publish', 'POST', { ids: checked });
  if (result.error) { toast(result.error, true); return; }
  for (const c of pendingChanges) {
    if (checked.includes(c.id) && c.entityType === 'zone') _mapPendingOverrides.delete(c.entityId);
  }
  _publishLog = buildPublishLog(result, pendingChanges.filter(c => checked.includes(c.id)));
  toast(`✓ ${result.message}`);
  await updateStagingBadge();
  loadPanel(_resolveReturnPanel());
}

async function autoResolveFailures() {
  const failedIds = _publishLog.filter(e => e.error).map(e => e.id);
  if (!failedIds.length) return;
  const result = await API('/staging/resolve', 'POST', { ids: failedIds });
  if (result.error) { toast(result.error, true); return; }
  // Merge resolve results back into the log
  const resolvedSet = new Set((result.resolved || []).map(r => r.id));
  const resolveErrors = Object.fromEntries((result.errors || []).map(e => [e.id, e.error]));
  _publishLog = _publishLog.map(e => {
    if (!e.error) return e;
    if (resolvedSet.has(e.id)) return { ...e, error: null, resolved: true };
    if (resolveErrors[e.id]) return { ...e, resolveError: resolveErrors[e.id] };
    return e;
  });
  toast(result.message);
  await updateStagingBadge();
  loadPanel(_resolveReturnPanel());
}

function buildPublishLog(result, sourceChanges) {
  const errorMap = Object.fromEntries((result.errors || []).map(e => [e.id, e.error]));
  return sourceChanges.map(c => ({
    id: c.id,
    entityType: c.entityType,
    entityName: c.entityName || c.entityId,
    changeType: c.changeType,
    error: errorMap[c.id] || null,
  }));
}

async function rejectOne(id, name) {
  if (!(await dpConfirm(`Discard staged change for "${name}"?`, { danger: true }))) return;
  const result = await API('/staging/reject', 'POST', { ids: [id] });
  if (result.error) { toast(result.error, true); return; }
  toast(result.message);
  await updateStagingBadge();
  loadPanel(_resolveReturnPanel());
}

async function rejectSelected() {
  const checked = [...document.querySelectorAll('.change-cb:checked')].map(el => el.dataset.id);
  if (!checked.length) { toast('Select at least one change', true); return; }
  if (!(await dpConfirm(`Discard ${checked.length} selected change${checked.length !== 1 ? 's' : ''}?`, { danger: true }))) return;
  const result = await API('/staging/reject', 'POST', { ids: checked });
  if (result.error) { toast(result.error, true); return; }
  // Remove overrides for any rejected zone changes
  for (const c of pendingChanges) {
    if (checked.includes(c.id) && c.entityType === 'zone') _mapPendingOverrides.delete(c.entityId);
  }
  toast(result.message);
  await updateStagingBadge();
  loadPanel(_resolveReturnPanel());
}

function selectAllChanges(checked) {
  document.querySelectorAll('.change-cb').forEach(el => { el.checked = checked; });
}

const ENTITY_TYPE_LABELS = {
  zone: 'Zone', enemy: 'Enemy', item: 'Item', npc: 'NPC',
  furniture: 'Furniture', recipe: 'Recipe', mutation: 'Mutation', drug: 'Drug',
};
const CHANGE_TYPE_ICONS = { create: '✚', update: '✎', delete: '✕' };

function timeAgo(isoStr) {
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function renderChangesPanel(data) {
  const panel = document.getElementById('list-panel');
  const changes = data?.changes || [];
  pendingChanges = changes;

  let html = `<div style="padding:20px;max-width:780px">`;

  // Pending section
  html += `<div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Pending Changes</div>`;

  if (!changes.length) {
    html += `<div style="color:var(--text-dim);padding:16px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)">No staged changes. All edits are live.</div>`;
  } else {
    html += `<div style="border-top:1px solid var(--border)">`;
    for (const c of changes) {
      const typeIcon = CHANGE_TYPE_ICONS[c.changeType] || '✎';
      const typeLabel = ENTITY_TYPE_LABELS[c.entityType] || c.entityType;
      html += `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--border)">
          <input type="checkbox" class="change-cb" data-id="${c.id}" style="margin-top:3px;accent-color:var(--accent)">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
              <span style="font-size:11px;padding:1px 6px;background:var(--bg3);border-radius:3px;color:var(--text-dim)">${typeLabel}</span>
              <span style="font-weight:600;color:var(--text)">${c.entityName || c.entityId}</span>
              <span style="font-size:11px;color:var(--${c.changeType === 'delete' ? 'danger' : c.changeType === 'create' ? 'success' : 'accent'})">${typeIcon} ${c.changeType}</span>
            </div>
            <div style="font-size:11px;color:var(--text-dim)">By: ${c.author} • ${timeAgo(c.stagedAt)}</div>
          </div>
          <button class="action-btn danger" style="font-size:10px;padding:2px 8px;white-space:nowrap" onclick="rejectOne('${c.id}','${(c.entityName||c.entityId).replace(/'/g,"\\'")}')">Reject</button>
        </div>`;
    }
    html += `</div>
      <div style="display:flex;gap:8px;margin-top:14px;align-items:center">
        <button class="action-btn" onclick="selectAllChanges(true)">Select All</button>
        <button class="action-btn success" onclick="publishSelected()">Publish Selected</button>
        <button class="action-btn danger" onclick="rejectSelected()">Reject Selected</button>
      </div>`;
  }

  // Publish log
  if (_publishLog.length) {
    const hasFailures = _publishLog.some(e => e.error);
    const hasUnresolvedFailures = _publishLog.some(e => e.error && !e.resolveError);
    html += `<div style="margin-top:28px">
      <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Publish Log</div>
      <div style="border-top:1px solid var(--border)">`;
    for (const e of _publishLog) {
      const typeLabel = ENTITY_TYPE_LABELS[e.entityType] || e.entityType;
      const typeIcon = CHANGE_TYPE_ICONS[e.changeType] || '✎';
      let status, statusColor, detail = '';
      if (e.resolved) {
        status = '✓ resolved'; statusColor = 'var(--success)';
      } else if (e.error) {
        status = '✗ failed'; statusColor = 'var(--danger)';
        detail = `<div style="font-size:11px;color:var(--danger);margin-top:3px;padding-left:2px">${e.error}${e.resolveError ? ` → resolve also failed: ${e.resolveError}` : ''}</div>`;
      } else {
        status = '✓ published'; statusColor = 'var(--success)';
      }
      html += `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;padding:1px 6px;background:var(--bg3);border-radius:3px;color:var(--text-dim)">${typeLabel}</span>
          <span style="font-weight:600;color:var(--text)">${e.entityName}</span>
          <span style="font-size:11px;color:var(--text-dim)">${typeIcon} ${e.changeType}</span>
          <span style="font-size:11px;color:${statusColor};margin-left:auto">${status}</span>
        </div>
        ${detail}
      </div>`;
    }
    html += `</div>`;
    if (hasFailures) {
      html += `<div style="display:flex;gap:8px;margin-top:10px;align-items:center">`;
      if (hasUnresolvedFailures) html += `<button class="action-btn success" onclick="autoResolveFailures()">⚙ Auto-resolve failures</button>`;
      html += `<button class="action-btn" onclick="_publishLog=[];loadPanel('changes')" style="opacity:0.7">Clear log</button></div>`;
    }
    html += `</div>`;
  }

  // Database backup / export
  html += `<div style="margin-top:28px">
    <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Database Backup</div>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Download a full SQL dump (schema + world content) of the live database — a backup, or a seed for a local/offline dev database (<code>psql "$DATABASE_URL" -f dump.sql</code> or <code>npm run db:restore -- dump.sql</code>).</div>
    <button class="action-btn" onclick="exportDatabaseDump()">⬇ Export Database (.sql)</button>
  </div>`;

  // Deployment history
  html += `<div style="margin-top:28px">
    <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Recent Deployments</div>
    <div id="deployments-list" style="border-top:1px solid var(--border)"><div style="padding:12px 0;color:var(--text-dim);font-size:12px">Loading…</div></div>
  </div>`;

  html += `</div>`;
  panel.innerHTML = html;

  // Load deployment history async
  API('/staging/deployments').then(data => {
    const el = document.getElementById('deployments-list');
    if (!el) return;
    const deps = data?.deployments || [];
    if (!deps.length) { el.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:12px">No deployments yet.</div>`; return; }
    el.innerHTML = deps.map(d => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="color:var(--success)">✓</span>
          <span style="font-weight:600;color:var(--text)">${new Date(d.deployedAt).toLocaleString()}</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim)">Published by ${d.deployedBy} • ${d.changeCount} change${d.changeCount !== 1 ? 's' : ''}</div>
        ${d.changes?.length ? `<details style="margin-top:6px"><summary style="font-size:11px;color:var(--accent);cursor:pointer">View changes</summary>
          <div style="margin-top:6px;font-size:11px;color:var(--text-dim)">${d.changes.map(c => `${ENTITY_TYPE_LABELS[c.entityType]||c.entityType}: ${c.entityName}`).join('<br>')}</div>
        </details>` : ''}
      </div>`).join('');
  }).catch(() => {
    const el = document.getElementById('deployments-list');
    if (el) el.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:12px">Could not load deployment history.</div>`;
  });
}

// --- Zone Validator panel ---

async function exportDatabaseDump() {
  toast('Building database dump…');
  const res = await API('/admin/export-dump');
  if (!res || !res.sql) { toast('Export failed (admin only)', true); return; }
  const blob = new Blob([res.sql], { type: 'application/sql' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `architect-dump-${Date.now()}.sql`; a.click();
  URL.revokeObjectURL(url);
  toast('Database dump downloaded');
}

