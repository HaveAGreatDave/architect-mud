// Feedback inbox: what players sent from the header's ⚑ button or the feedback
// verb. The list shows previews only; clicking a row fetches that one report
// with its telemetry. Live state, so every call is directAPI.

const _fbStatusColor = { open: '#f59e0b', seen: '#60a5fa', fixed: '#22c55e', wontfix: '#9ca3af' };
const _fbEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _fbWhen = t => t ? new Date(Number(t) * 1000).toLocaleString() : '';
let _fbFilter = 'open';

window.feedbackFilter = function (status) { _fbFilter = status; showPanel('feedback'); };

function renderFeedbackPanel(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const counts = data?.counts || {};
  const tabs = ['open', 'seen', 'fixed', 'wontfix', 'all'].map(s => `
    <button class="bc-tab${_fbFilter === s ? ' bc-tab-active' : ''}" onclick="feedbackFilter('${s}')">
      ${s}${s !== 'all' ? ` (${counts[s] || 0})` : ''}</button>`).join('');
  const list = rows.length ? `<table class="data-table" style="width:100%"><thead><tr>
      <th>#</th><th>When</th><th>Who</th><th>Type</th><th>Where</th><th>Says</th><th>Status</th>
    </tr></thead><tbody>${rows.map(r => `
      <tr style="cursor:pointer" onclick="feedbackOpen(${Number(r.id)})">
        <td>${Number(r.id)}</td><td style="white-space:nowrap">${_fbWhen(r.created_at)}</td>
        <td>${_fbEsc(r.handle)}</td><td>${_fbEsc(r.category)}</td><td>${_fbEsc(r.zone_id)}</td>
        <td>${_fbEsc(r.preview)}</td>
        <td style="color:${_fbStatusColor[r.status] || '#ccc'}">${_fbEsc(r.status)}</td>
      </tr>`).join('')}</tbody></table>`
    : `<div style="padding:16px;color:var(--text-dim, #888)">Nothing here.</div>`;
  document.getElementById('list-panel').innerHTML =
    `<div class="bc-tabs">${tabs}</div>${list}<div id="feedback-detail" style="margin-top:16px"></div>`;
}

// The report as markdown, ready for a GitHub issue or the bug skill.
function _fbMarkdown(r) {
  const s = r.server_ctx || {};
  const where = [s.zone?.name, s.zone?.id, s.district?.name, s.anchor ? `${s.anchor.x},${s.anchor.y}` : null].filter(Boolean).join(' / ');
  return `**${r.category}** from ${r.handle} (feedback #${r.id}, ${_fbWhen(r.created_at)})\n\n${r.body}\n\n` +
    `Where: ${where}\n\n<details><summary>Telemetry</summary>\n\n\`\`\`json\n` +
    JSON.stringify({ server: r.server_ctx, client: r.client_ctx }, null, 2) + '\n```\n</details>\n';
}

window.feedbackOpen = async function (id) {
  const r = await directAPI(`/feedback/${id}`);
  const el = document.getElementById('feedback-detail');
  if (!el || !r || r.error) return;
  window._fbCurrent = r;
  const opts = ['open', 'seen', 'fixed', 'wontfix'].map(s => `<option${s === r.status ? ' selected' : ''}>${s}</option>`).join('');
  el.innerHTML = `
    <div style="border:1px solid var(--border, #333);padding:12px;border-radius:4px">
      <div style="font-weight:bold;margin-bottom:6px">#${Number(r.id)} · ${_fbEsc(r.category)} · ${_fbEsc(r.handle)} · ${_fbWhen(r.created_at)}</div>
      <div style="white-space:pre-wrap;margin-bottom:10px">${_fbEsc(r.body)}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <select id="feedback-status">${opts}</select>
        <input id="feedback-note" type="text" style="flex:1;min-width:200px" placeholder="Staff note" value="${_fbEsc(r.staff_note || '')}">
        <button onclick="feedbackSave(${Number(r.id)})">Save</button>
        <button onclick="feedbackCopy()">Copy as issue</button>
      </div>
      <details open><summary>Server</summary><pre style="white-space:pre-wrap;font-size:11px">${_fbEsc(JSON.stringify(r.server_ctx, null, 2))}</pre></details>
      <details><summary>Client</summary><pre style="white-space:pre-wrap;font-size:11px">${_fbEsc(JSON.stringify(r.client_ctx, null, 2))}</pre></details>
    </div>`;
  el.scrollIntoView({ block: 'nearest' });
};

window.feedbackSave = async function (id) {
  const status = document.getElementById('feedback-status')?.value;
  const staff_note = document.getElementById('feedback-note')?.value ?? '';
  const res = await directAPI(`/feedback/${id}`, 'POST', { status, staff_note });
  if (res?.error) { await dpAlert(res.error); return; }
  showPanel('feedback');
};

window.feedbackCopy = async function () {
  if (!window._fbCurrent) return;
  try { await navigator.clipboard.writeText(_fbMarkdown(window._fbCurrent)); await dpAlert('Copied as markdown.'); }
  catch { await dpAlert('The clipboard refused. Select the telemetry by hand.'); }
};

registerDevPanel({
  id: 'feedback',
  title: 'Feedback',
  description: "What players sent from the ⚑ button or the feedback verb, with where they were and what their client was doing. Click a row for the detail.",
  fetch: () => directAPI(`/feedback/list/${_fbFilter}`),
  noEdit: true,
  render: renderFeedbackPanel,
});
