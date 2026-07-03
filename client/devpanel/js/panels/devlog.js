// Dev Log panel — team heads-ups + recent code activity.
// Notes are curated (posted by devs); commits are pulled live from git.

const DEVLOG_KINDS = {
  'change':          { label: 'Change',          color: 'var(--text-dim)',  icon: '•' },
  'heads-up':        { label: 'Heads-up',         color: 'var(--yellow)',    icon: '⚑' },
  'action-required': { label: 'Action required',  color: 'var(--red)',       icon: '⚠' },
};

function _dlEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function _dlRelTime(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs/86400)}d ago`;
  return d.toLocaleDateString();
}

function _dlKindBadge(kind) {
  const k = DEVLOG_KINDS[kind] || DEVLOG_KINDS.change;
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:${k.color};border:1px solid ${k.color};border-radius:3px;padding:1px 6px">${k.icon} ${k.label}</span>`;
}

function _dlNoteCard(n) {
  const k = DEVLOG_KINDS[n.kind] || DEVLOG_KINDS.change;
  const accent = n.resolved ? 'var(--border)' : k.color;
  const dim = n.resolved ? 'opacity:.55;' : '';
  const bodyHtml = n.body ? `<div style="font-size:12px;color:var(--text);margin-top:6px;white-space:pre-wrap;line-height:1.5">${_dlEsc(n.body)}</div>` : '';
  const resolveLabel = n.resolved ? 'Reopen' : 'Resolve';
  return `
    <div style="background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${accent};border-radius:4px;padding:12px 14px;${dim}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ${_dlKindBadge(n.kind)}
        <span style="font-size:13px;font-weight:600;color:var(--text-bright)">${_dlEsc(n.title)}</span>
        ${n.resolved ? '<span style="font-size:10px;color:var(--green)">✓ resolved</span>' : ''}
        <span style="margin-left:auto;font-size:11px;color:var(--text-dim)">${_dlEsc(n.author)} · ${_dlRelTime(n.created_at)}</span>
      </div>
      ${bodyHtml}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="devlogToggleResolved(${n.id}, ${!n.resolved})" style="background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:10px;padding:3px 10px;cursor:pointer;border-radius:2px">${resolveLabel}</button>
        <button onclick="devlogDeleteNote(${n.id})" style="background:transparent;border:1px solid var(--border);color:var(--red);font-family:var(--font-mono);font-size:10px;padding:3px 10px;cursor:pointer;border-radius:2px">Delete</button>
      </div>
    </div>`;
}

function _dlActivityHtml(commits, gitUnavailable) {
  if (gitUnavailable) return `<div style="font-size:12px;color:var(--text-dim)">Git history unavailable on this server.</div>`;
  if (!commits.length) return `<div style="font-size:12px;color:var(--text-dim)">No commits in the last 14 days.</div>`;

  // Per-author summary.
  const byAuthor = {};
  for (const c of commits) {
    (byAuthor[c.author] ||= { commits: 0, files: 0 });
    byAuthor[c.author].commits++;
    byAuthor[c.author].files += c.filesChanged || 0;
  }
  const summary = Object.entries(byAuthor)
    .sort((a, b) => b[1].commits - a[1].commits)
    .map(([author, s]) => `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:3px 9px;font-size:11px"><span style="font-weight:600;color:var(--text-bright)">${_dlEsc(author)}</span><span style="color:var(--text-dim)">${s.commits} commit${s.commits===1?'':'s'} · ${s.files} files</span></span>`)
    .join('');

  const rows = commits.slice(0, 40).map(c => {
    const day = new Date(c.date);
    const dayStr = isNaN(day) ? '' : day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);align-items:baseline">
        <span style="flex:0 0 46px;font-size:10px;color:var(--text-dim);font-family:var(--font-mono)">${dayStr}</span>
        <span style="flex:0 0 110px;font-size:11px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_dlEsc(c.author)}</span>
        <span style="flex:1;font-size:12px;color:var(--text)">${_dlEsc(c.subject)}</span>
        <span style="flex:0 0 auto;font-size:10px;color:var(--text-dim);font-family:var(--font-mono)">${c.filesChanged || 0}f</span>
      </div>`;
  }).join('');

  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${summary}</div>
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px 14px">${rows}</div>
    ${commits.length > 40 ? `<div style="font-size:10px;color:var(--text-dim);margin-top:6px">Showing 40 of ${commits.length} commits.</div>` : ''}`;
}

function renderDevLog(data) {
  const panel = document.getElementById('list-panel');
  const notes = data.notes || [];
  const active = notes.filter(n => !n.resolved);
  const resolved = notes.filter(n => n.resolved);
  // Action-required first, then heads-up, then changes — most urgent on top.
  const order = { 'action-required': 0, 'heads-up': 1, 'change': 2 };
  active.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || new Date(b.created_at) - new Date(a.created_at));

  const sectionLabel = (txt) => `<div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin:26px 0 12px">${txt}</div>`;

  panel.innerHTML = `
    <div style="padding:24px;max-width:1000px">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">Post important changes so the next dev checking in sees them — server restarts, DB migrations, content scripts to run.</div>

      ${sectionLabel('Post a note')}
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:14px;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <input id="devlog-title" type="text" maxlength="140" placeholder="What changed? (e.g. Restart server after pulling — new smoking plugin)"
            style="flex:1;min-width:260px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:8px 10px;border-radius:2px">
          <select id="devlog-kind" style="background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:8px 10px;border-radius:2px">
            <option value="change">Change</option>
            <option value="heads-up">Heads-up</option>
            <option value="action-required">Action required</option>
          </select>
        </div>
        <textarea id="devlog-body" placeholder="Optional detail — the exact command to run, files touched, why it matters…"
          style="width:100%;height:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:8px 10px;box-sizing:border-box;resize:vertical;border-radius:2px;line-height:1.4"></textarea>
        <div>
          <button onclick="devlogCreateNote()" style="background:var(--accent);border:none;color:#000;font-family:var(--font-mono);font-size:11px;font-weight:600;padding:7px 20px;cursor:pointer;border-radius:2px">Post note</button>
          <span id="devlog-status" style="font-size:10px;color:var(--text-dim);margin-left:10px"></span>
        </div>
      </div>

      ${sectionLabel(`Active notes${active.length ? ` (${active.length})` : ''}`)}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${active.length ? active.map(_dlNoteCard).join('') : `<div style="font-size:12px;color:var(--text-dim)">No active notes. You're all caught up.</div>`}
      </div>

      ${resolved.length ? `
        ${sectionLabel(`Resolved (${resolved.length})`)}
        <div style="display:flex;flex-direction:column;gap:8px">${resolved.slice(0, 20).map(_dlNoteCard).join('')}</div>
      ` : ''}

      ${sectionLabel('Recent code activity (14 days)')}
      ${_dlActivityHtml(data.commits || [], data.gitUnavailable)}
    </div>`;
}

async function devlogCreateNote() {
  const titleEl = document.getElementById('devlog-title');
  const kindEl  = document.getElementById('devlog-kind');
  const bodyEl  = document.getElementById('devlog-body');
  const status  = document.getElementById('devlog-status');
  const title = (titleEl?.value || '').trim();
  if (!title) { if (status) { status.textContent = 'Title required'; status.style.color = 'var(--red)'; } return; }

  const d = await directAPI('/dev/notes', 'POST', { title, kind: kindEl?.value || 'change', body: bodyEl?.value || '' });
  if (d?.note) {
    toast('Note posted');
    loadPanel('devlog');
  } else {
    if (status) { status.textContent = d?.error || 'Error'; status.style.color = 'var(--red)'; }
  }
}

async function devlogToggleResolved(id, resolved) {
  const d = await directAPI(`/dev/notes/${id}`, 'PATCH', { resolved });
  if (d?.ok) loadPanel('devlog');
  else toast(d?.error || 'Error', true);
}

async function devlogDeleteNote(id) {
  const ok = await dpConfirm('Delete this note permanently?');
  if (!ok) return;
  const d = await directAPI(`/dev/notes/${id}`, 'DELETE');
  if (d?.ok) { toast('Note deleted'); loadPanel('devlog'); }
  else toast(d?.error || 'Error', true);
}
