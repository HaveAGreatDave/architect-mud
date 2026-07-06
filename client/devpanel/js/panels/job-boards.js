// Job Boards panel — authors the `job_boards` table (jobboard plugin). A board posts a
// rotating subset of a pool of repeatable quests in a zone as legal early-money gigs.
// The pool is picked from the existing quests; rotation size/period control how many
// post at once and how often the selection re-rolls. Rotation period is stored in
// seconds but edited in hours here.

async function jobBoardEditForm(rec, isNew) {
  let quests = await API('/quests');
  if (!Array.isArray(quests)) quests = [];
  const pool = Array.isArray(rec.quest_pool) ? rec.quest_pool : JSON.parse(rec.quest_pool || '[]');
  const hours = Math.round(((rec.rotation_period || 21600) / 3600) * 10) / 10;

  const rows = quests.map(q => {
    const rewards = typeof q.rewards === 'object' && q.rewards ? q.rewards : JSON.parse(q.rewards || '{}');
    const credits = rewards.credits || 0;
    const rep = q.repeatable
      ? '<span title="repeatable">↻</span>'
      : '<span style="color:var(--danger,#e05555)" title="one-time — a board job should be repeatable">one-time</span>';
    return `<label style="display:flex;gap:8px;align-items:center;padding:2px 0">
      <input type="checkbox" class="jb-pool" value="${q.id}" ${pool.includes(q.id) ? 'checked' : ''}>
      <span>${q.name} <code style="font-size:11px;color:var(--text-dim)">${q.id}</code> — ${credits}₵ ${rep}</span>
    </label>`;
  }).join('') || '<span style="color:var(--text-dim)">No quests yet — author some in the Quests panel first.</span>';

  return `
    <div class="field"><label>Board ID</label><input id="f-id" value="${isNew ? '' : rec.id}" ${!isNew ? 'readonly style="opacity:0.5"' : ''} placeholder="board_franchise_strip"></div>
    <div class="field"><label>Zone ID (where the board is posted)</label><input id="f-zone_id" value="${rec.zone_id || ''}" placeholder="zone_city_west"></div>
    <div class="field"><label>Board Name</label><input id="f-name" value="${rec.name || 'Job Board'}"></div>
    <div class="field"><label>Description (blurb shown above the postings)</label><textarea id="f-description" rows="2">${rec.description || ''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Rotation size (how many post at once)</label><input type="number" id="f-rotation_size" min="1" value="${rec.rotation_size || 3}"></div>
      <div class="field"><label>Rotation period (hours)</label><input type="number" id="f-rotation_hours" min="0" step="0.5" value="${hours}"></div>
    </div>
    <div class="field"><label>Quest pool (jobs eligible to rotate onto this board — should be repeatable)</label>
      <div style="max-height:280px;overflow:auto;border:1px solid var(--border,#333);padding:8px;border-radius:4px">${rows}</div>
    </div>
  `;
}

async function saveJobBoard(existing) {
  const isNew = !existing?.id;
  const pool = Array.from(document.querySelectorAll('.jb-pool:checked')).map(el => el.value);
  const zone = document.getElementById('f-zone_id').value.trim();
  if (!zone) return { error: 'Zone ID is required.' };
  const body = {
    zone_id: zone,
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    quest_pool: pool,
    rotation_size: +document.getElementById('f-rotation_size').value || 3,
    rotation_period: Math.round((+document.getElementById('f-rotation_hours').value || 6) * 3600),
  };
  if (isNew) {
    body.id = document.getElementById('f-id').value.trim();
    if (!body.id) return { error: 'Board ID is required.' };
    return API('/job-boards', 'POST', body);
  }
  return API(`/job-boards/${existing.id}`, 'PUT', body);
}
