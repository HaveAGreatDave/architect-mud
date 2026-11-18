// Strays: every street cat (plugins/pets/strays.js), where it is, and who took it in. "Roll a new batch" puts another
// twelve on Coldwater's streets, more to the east. Live state, so every call is directAPI.

const _stEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _stWhen = t => t ? new Date(Number(t) * 1000).toLocaleString() : '';
const _stCoat = c => !c ? '' : c.colour ? c.colour.replace(/_/g, ' ') : [c.pattern, c.base ? `<span style="display:inline-block;width:10px;height:10px;border:1px solid #888;background:${_stEsc(c.base)};vertical-align:middle"></span>` : ''].filter(Boolean).join(' ');

function renderStraysPanel(data) {
  const cats = Array.isArray(data?.cats) ? data.cats : [];
  const allTaken = cats.length > 0 && data.onStreet === 0;
  const head = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div><b>${data?.onStreet ?? 0}</b> on the street · <b>${data?.adopted ?? 0}</b> adopted · ${data?.tiles ?? 0} street tiles to land on</div>
      <input id="strays-count" type="number" min="1" max="50" value="${data?.batchSize || 12}" style="width:60px">
      <button class="action-btn" onclick="straysGenerate()">Roll a new batch</button>
      ${allTaken ? '<span style="color:#22c55e">Every stray has a home. Time for another batch.</span>' : ''}
    </div>`;
  const row = c => `<tr>
      <td><b>${_stEsc(c.name)}</b> <span style="color:var(--text-dim,#888)">${c.sex === 'female' ? '♀' : '♂'}</span></td>
      <td>${_stEsc((c.breed || '').replace(/_/g, ' '))}</td><td>${_stCoat(c.coat)}</td><td>${c.batch}</td>
      <td style="color:${c.adopted ? '#22c55e' : '#f59e0b'}">${c.adopted ? `adopted by ${_stEsc(c.owner)}` : 'stray'}</td>
      <td>${_stEsc(c.zone || c.zone_id || '—')}${c.x != null ? ` <span style="color:var(--text-dim,#888)">(${c.x},${c.y})</span>` : ''}</td>
      <td>${_stEsc(c.district || '')}</td>
      <td style="white-space:nowrap">${_stWhen(c.adopted ? c.adopted_at : c.spawned_at)}</td>
      <td><button class="action-btn" title="${_stEsc(c.description)}" onclick="straysRemove('${_stEsc(c.id)}','${_stEsc(c.name)}')">remove</button></td>
    </tr>`;
  const table = cats.length ? `<table class="data-table" style="width:100%"><thead><tr>
      <th>Name</th><th>Breed</th><th>Coat</th><th>Batch</th><th>Status</th><th>Where</th><th>District</th><th>Since</th><th></th>
    </tr></thead><tbody>${cats.map(row).join('')}</tbody></table>`
    : '<div style="padding:16px;color:var(--text-dim,#888)">No strays yet.</div>';
  document.getElementById('list-panel').innerHTML = head + table;
}

window.straysGenerate = async function () {
  const count = Number(document.getElementById('strays-count')?.value) || 12;
  const r = await directAPI('/strays/generate', 'POST', { count });
  if (r?.error) alert(r.error);
  showPanel('strays');
};
window.straysRemove = async function (id, name) {
  if (!confirm(`Remove ${name} from the world? An adopted cat leaves its owner's flat too.`)) return;
  const r = await directAPI(`/strays/${encodeURIComponent(id)}`, 'DELETE');
  if (r?.error) alert(r.error);
  showPanel('strays');
};

registerDevPanel({
  id: 'strays',
  title: 'Strays',
  description: 'Street cats players can take home with adopt. A batch lands on Coldwater streets, weighted to the east; roll another when the last lot have homes.',
  fetch: () => directAPI('/strays'),
  noEdit: true,
  render: renderStraysPanel,
});
