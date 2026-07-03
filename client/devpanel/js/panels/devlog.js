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
  if (gitUnavailable || _devlogGitInfo.gitError || (!commits.length && _devlogGitInfo.routeError)) {
    return `<div style="font-size:12px;color:var(--text-dim)">${_dlUnavailableMsg()}</div>`;
  }
  if (!commits.length) return `<div style="font-size:12px;color:var(--text-dim)">No commits in the last 14 days.</div>`;

  // Per-contributor summary, keyed on resolved handle when known.
  const disp = (c) => c.handle || c.author;
  const byAuthor = {};
  for (const c of commits) {
    const name = disp(c);
    (byAuthor[name] ||= { commits: 0, files: 0 });
    byAuthor[name].commits++;
    byAuthor[name].files += c.filesChanged || 0;
  }
  const summary = Object.entries(byAuthor)
    .sort((a, b) => b[1].commits - a[1].commits)
    .map(([author, s]) => `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:3px 9px;font-size:11px"><span style="font-weight:600;color:var(--text-bright)">${_dlEsc(author)}</span><span style="color:var(--text-dim)">${s.commits} commit${s.commits===1?'':'s'} · ${s.files} files</span></span>`)
    .join('');

  const rows = commits.slice(0, 40).map(c => {
    const day = new Date(c.date);
    const dayStr = isNaN(day) ? '' : day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const tc = _dlCoreColor(c.coreTier);
    const coreBadge = c.core
      ? `<span title="Core seam touched: ${_dlEsc((c.coreFiles||[]).join(', '))} — ${c.coreLines} lines" style="flex:0 0 auto;font-size:10px;color:${tc};border:1px solid ${tc};border-radius:3px;padding:0 5px;font-family:var(--font-mono)">⚙ ${c.coreLines}</span>`
      : '';
    const rowAccent = c.core ? `border-left:3px solid ${tc};padding-left:8px;` : 'padding-left:0;';
    const subjColor = c.coreTier >= 2 ? 'var(--text-bright)' : 'var(--text)';
    return `
      <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);align-items:baseline;${rowAccent}">
        <span style="flex:0 0 46px;font-size:10px;color:var(--text-dim);font-family:var(--font-mono)">${dayStr}</span>
        <span style="flex:0 0 110px;font-size:11px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_dlEsc(c.author)}">${_dlEsc(disp(c))}</span>
        <span style="flex:1;font-size:12px;color:${subjColor}">${_dlEsc(c.subject)}</span>
        ${coreBadge}
        <span style="flex:0 0 auto;font-size:10px;color:var(--text-dim);font-family:var(--font-mono)">${c.filesChanged || 0}f</span>
      </div>`;
  }).join('');

  const coreCount = commits.filter(c => c.core).length;
  const legend = `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:0 0 8px;font-size:10px;color:var(--text-dim)">
      <span>⚙ core seam change${coreCount ? ` — ${coreCount} in range` : ''}:</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:var(--accent)"></span>light</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:var(--yellow)"></span>medium</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:2px;background:var(--red)"></span>heavy</span>
    </div>`;

  return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${summary}</div>
    ${legend}
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px 14px">${rows}</div>
    ${commits.length > 40 ? `<div style="font-size:10px;color:var(--text-dim);margin-top:6px">Showing 40 of ${commits.length} commits.</div>` : ''}`;
}

function _dlCoreColor(tier) {
  return tier === 3 ? 'var(--red)' : tier === 2 ? 'var(--yellow)' : tier === 1 ? 'var(--accent)' : 'var(--border)';
}

// Cached per-range contribution stats, so the range toggle re-renders without a
// server round trip. Set in renderDevLog.
let _devlogContrib = null;
let _devlogGitInfo = { gitError: null, routeError: null };

// A specific, actionable message for why git data is missing.
function _dlUnavailableMsg() {
  if (_devlogGitInfo.gitError) return `Git history unavailable: ${_dlEsc(_devlogGitInfo.gitError)}`;
  if (_devlogGitInfo.routeError) return `Dev Log routes aren't responding (“${_dlEsc(_devlogGitInfo.routeError)}”). Run <code>npm run db:schema</code> and restart the server so the new routes load.`;
  return 'Git history unavailable on this server.';
}
const _DL_CONTRIB_COLORS = ['#2a78d6', '#eda100', '#199e70', '#e34948', '#9085e9', '#d95926'];
const _DL_RANGE_LABELS = { '7d': 'Last 7 days', '30d': 'Last 30 days', 'all': 'All time' };

function _dlContribSectionHtml() {
  if (!_devlogContrib) return `<div style="font-size:12px;color:var(--text-dim)">${_dlUnavailableMsg()}</div>`;
  const btn = (r) => `<button data-range="${r}" onclick="devlogSetContribRange('${r}')" style="flex:1;background:transparent;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font-mono);font-size:11px;padding:6px 8px;cursor:pointer;border-radius:2px">${_DL_RANGE_LABELS[r]}</button>`;
  return `
    <div id="devlog-contrib-toggle" style="display:flex;gap:6px;margin-bottom:14px">
      ${['7d','30d','all'].map(btn).join('')}
    </div>
    <div id="devlog-contrib-body"></div>`;
}

function _dlContribBody(range) {
  const list = (_devlogContrib && _devlogContrib[range]) || [];
  if (!list.length) return `<div style="font-size:12px;color:var(--text-dim)">No commits in this range.</div>`;
  const disp = a => a.handle || a.author;
  const col = i => _DL_CONTRIB_COLORS[i % _DL_CONTRIB_COLORS.length];
  const maxCommits = Math.max(...list.map(a => a.commits), 1);
  const maxLines   = Math.max(...list.map(a => a.add + a.del), 1);

  const cards = list.map((a, i) => `
    <div style="flex:1;min-width:150px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${col(i)};border-radius:4px;padding:12px 14px">
      <div style="font-size:13px;font-weight:600;color:var(--text-bright)">${_dlEsc(disp(a))}</div>
      <div style="font-size:24px;font-weight:700;color:var(--text-bright);margin-top:4px">${a.commits.toLocaleString()}</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">commits</div>
      <div style="font-size:12px"><span style="color:var(--green)">+${a.add.toLocaleString()}</span> &nbsp; <span style="color:var(--red)">−${a.del.toLocaleString()}</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${a.files.toLocaleString()} files</div>
    </div>`).join('');

  const commitBars = list.map((a, i) => `
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0">
      <span style="flex:0 0 130px;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_dlEsc(a.author)}">${_dlEsc(disp(a))}</span>
      <div style="flex:1;background:var(--bg);border-radius:2px;height:16px">
        <div style="width:${(a.commits/maxCommits*100).toFixed(1)}%;background:${col(i)};height:100%;border-radius:2px"></div>
      </div>
      <span style="flex:0 0 52px;text-align:right;font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">${a.commits.toLocaleString()}</span>
    </div>`).join('');

  const lineBars = list.map((a) => `
    <div style="display:flex;align-items:center;gap:10px;margin:6px 0">
      <span style="flex:0 0 130px;font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${_dlEsc(a.author)}">${_dlEsc(disp(a))}</span>
      <div style="flex:1;background:var(--bg);border-radius:2px;height:16px;display:flex;overflow:hidden">
        <div style="width:${(a.add/maxLines*100).toFixed(1)}%;background:var(--green);height:100%"></div>
        <div style="width:${(a.del/maxLines*100).toFixed(1)}%;background:var(--red);height:100%"></div>
      </div>
      <span style="flex:0 0 120px;text-align:right;font-size:10px;color:var(--text-dim);font-family:var(--font-mono)">+${a.add.toLocaleString()} −${a.del.toLocaleString()}</span>
    </div>`).join('');

  return `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">${cards}</div>
    <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Commits</div>
    ${commitBars}
    <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 4px">Lines changed — <span style="color:var(--green)">added</span> / <span style="color:var(--red)">deleted</span></div>
    ${lineBars}`;
}

function devlogSetContribRange(range) {
  const body = document.getElementById('devlog-contrib-body');
  if (body) body.innerHTML = _dlContribBody(range);
  document.querySelectorAll('#devlog-contrib-toggle button').forEach(b => {
    const on = b.dataset.range === range;
    b.style.background  = on ? 'var(--bg3)'    : 'transparent';
    b.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
    b.style.color       = on ? 'var(--accent)' : 'var(--text-dim)';
  });
}

function _dlIdentitiesHtml(commits, identities, players) {
  // Distinct git authors seen in the recent feed.
  const byKey = new Map();
  for (const c of commits) {
    if (!c.authorKey) continue;
    if (!byKey.has(c.authorKey)) byKey.set(c.authorKey, { key: c.authorKey, name: c.author, count: 0 });
    byKey.get(c.authorKey).count++;
  }
  const authors = [...byKey.values()].sort((a, b) => b.count - a.count);
  if (!authors.length) return `<div style="font-size:12px;color:var(--text-dim)">No git authors in recent history to map.</div>`;

  const idMap = new Map(identities.map(i => [i.git_key, i]));
  const optionsFor = (selPid) =>
    `<option value="">— unmapped —</option>` +
    players.map(p => `<option value="${_dlEsc(p.id)}"${p.id === selPid ? ' selected' : ''}>${_dlEsc(p.handle)} (${_dlEsc(p.role)})</option>`).join('');

  const rows = authors.map(a => {
    const bound = idMap.get(a.key);
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="flex:0 0 210px;font-size:12px;color:var(--text-bright)">${_dlEsc(a.name)}<span style="color:var(--text-dim);font-weight:400"> · ${a.count} commit${a.count===1?'':'s'}</span></span>
        <span style="font-size:11px;color:var(--text-dim)">→</span>
        <select data-name="${_dlEsc(a.name)}" onchange="devlogBindIdentity('${encodeURIComponent(a.key)}', this)"
          style="flex:1;background:var(--bg);border:1px solid ${bound ? 'var(--accent)' : 'var(--border)'};color:var(--text);font-family:var(--font-mono);font-size:11px;padding:5px 8px;border-radius:2px">
          ${optionsFor(bound?.player_id || '')}
        </select>
      </div>`;
  }).join('');

  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <button onclick="devlogAutomatch()" style="background:transparent;border:1px solid var(--border);color:var(--accent);font-family:var(--font-mono);font-size:10px;padding:4px 12px;cursor:pointer;border-radius:2px">Auto-match by email</button>
      <span style="font-size:11px;color:var(--text-dim)">Bind each git author to an admin account so the feed and check-in banner show handles (e.g. HaveAGreatDave → Cyd).</span>
    </div>
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px 14px">${rows}</div>`;
}

function renderDevLog(data) {
  const panel = document.getElementById('list-panel');
  _devlogContrib = data.contributions || null;
  _devlogGitInfo = { gitError: data.gitError || null, routeError: data.routeError || null };
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

      ${sectionLabel('Contributions')}
      ${_dlContribSectionHtml()}

      ${sectionLabel('Recent code activity (14 days)')}
      ${_dlActivityHtml(data.commits || [], data.gitUnavailable)}

      ${sectionLabel('Contributor identities')}
      ${_dlIdentitiesHtml(data.commits || [], data.identities || [], data.players || [])}
    </div>`;

  if (_devlogContrib) devlogSetContribRange('7d');
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

async function devlogBindIdentity(gitKeyEnc, sel) {
  const git_key = decodeURIComponent(gitKeyEnc);
  const git_name = sel.getAttribute('data-name') || '';
  const player_id = sel.value || null;
  const d = await directAPI('/dev/identities', 'POST', { git_key, git_name, player_id });
  if (d?.ok) { toast(player_id ? 'Identity bound' : 'Unbound'); loadPanel('devlog'); }
  else toast(d?.error || 'Error', true);
}

async function devlogAutomatch() {
  const d = await directAPI('/dev/identities/automatch', 'POST', {});
  if (d && typeof d.added === 'number') {
    toast(d.added ? `Matched ${d.added} author${d.added===1?'':'s'} by email` : (d.gitUnavailable ? 'Git unavailable' : 'No new email matches'));
    loadPanel('devlog');
  } else {
    toast(d?.error || 'Error', true);
  }
}
