// The Backups panel: a SQL dump of this database, and the content deploys CI
// recorded. It was the Changes panel until 2026-10-17, when dev-panel staging
// was removed; these two sections are what was worth keeping from it.

function renderBackupsPanel() {
  const panel = document.getElementById('list-panel');
  panel.innerHTML = `<div style="padding:20px;max-width:780px">
    <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Database Backup</div>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Download a full SQL dump (schema + world content) of this database: a backup, or a seed for a local/offline dev database (<code>psql "$DATABASE_URL" -f dump.sql</code> or <code>npm run db:restore -- dump.sql</code>).</div>
    <button class="action-btn" onclick="exportDatabaseDump()">⬇ Export Database (.sql)</button>
    <div style="margin-top:28px">
      <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Recent Deployments</div>
      <div id="deployments-list" style="border-top:1px solid var(--border)"><div style="padding:12px 0;color:var(--text-dim);font-size:12px">Loading…</div></div>
    </div>
  </div>`;

  API('/deployments').then(data => {
    const el = document.getElementById('deployments-list');
    if (!el) return;
    if (data?.error) { el.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:12px">${data.error}</div>`; return; }
    const deps = data?.deployments || [];
    if (!deps.length) { el.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:12px">No deployments yet.</div>`; return; }
    el.innerHTML = deps.map(d => `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="color:var(--success)">✓</span>
          <span style="font-weight:600;color:var(--text)">${new Date(d.deployedAt).toLocaleString()}</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim)">Deployed by ${d.deployedBy}${d.changes?.sha ? ` • ${String(d.changes.sha).slice(0, 9)}` : ''}</div>
      </div>`).join('');
  }).catch(() => {
    const el = document.getElementById('deployments-list');
    if (el) el.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:12px">Could not load deployment history.</div>`;
  });
}

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
