// Quests panel — authors the `quests` table consumed by the quests plugin.
// Objectives/rewards are edited as raw JSON, matching the recipe/mutation editors.
//   objectives: [{ type:'kill'|'give'|'visit', target?, item_id?, zone?, count?, desc }]
//   rewards:    { credits?, items?:[{item_id,quantity}], flags?:[{scope,flag,value}] }

function questEditForm(rec, isNew) {
  const objectives = Array.isArray(rec.objectives) ? rec.objectives : JSON.parse(rec.objectives || '[]');
  const rewards = typeof rec.rewards === 'object' && rec.rewards ? rec.rewards : JSON.parse(rec.rewards || '{}');
  return `
    <div class="field"><label>Quest ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''} placeholder="quest_pest_control"></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description||''}</textarea></div>
    <div class="field"><label>Repeatable?</label>
      <select id="f-repeatable">
        <option value="0" ${!rec.repeatable?'selected':''}>One-time</option>
        <option value="1" ${rec.repeatable?'selected':''}>Repeatable</option>
      </select>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Quest Graph</label>
      <button type="button" class="action-btn" onclick="questsOpenVine()">🌿 Visual Editor</button>
    </div>
    <div class="field"><label>Objectives (JSON array — type: kill/give/visit + target/item_id/zone, count, desc)</label><textarea id="f-objectives" rows="6">${JSON.stringify(objectives, null, 2)}</textarea></div>
    <div class="field"><label>Rewards (JSON — { credits, items:[{item_id,quantity}], flags:[{scope,flag,value}] })</label><textarea id="f-rewards" rows="5">${JSON.stringify(rewards, null, 2)}</textarea></div>
  `;
}

// Open the VINE quest editor seeded from the current form values; on save, write the
// derived objectives[]/rewards{} back into the form fields (saveQuest persists them).
function questsOpenVine() {
  let objectives, rewards;
  try { objectives = JSON.parse(document.getElementById('f-objectives').value || '[]'); } catch { return toast('Objectives: invalid JSON', true); }
  try { rewards = JSON.parse(document.getElementById('f-rewards').value || '{}'); } catch { return toast('Rewards: invalid JSON', true); }
  const rec = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    repeatable: document.getElementById('f-repeatable').value === '1',
    objectives, rewards,
  };
  vineModalOpen(
    `Quest: ${rec.name || currentRecord?.id || 'Quest'}`,
    VineQuestSchema,
    VineQuestSchema.fromQuest(rec),
    (savedGraph) => {
      const q = VineQuestSchema.toQuest(savedGraph);
      document.getElementById('f-name').value = q.name;
      document.getElementById('f-description').value = q.description;
      document.getElementById('f-repeatable').value = q.repeatable ? '1' : '0';
      document.getElementById('f-objectives').value = JSON.stringify(q.objectives, null, 2);
      document.getElementById('f-rewards').value = JSON.stringify(q.rewards, null, 2);
      toast('Quest graph applied — click Save to persist.');
    }
  );
}

async function saveQuest(existing) {
  const isNew = !existing?.id;
  let objectives, rewards;
  try { objectives = JSON.parse(document.getElementById('f-objectives').value); } catch { return { error: 'Objectives: invalid JSON' }; }
  try { rewards = JSON.parse(document.getElementById('f-rewards').value); } catch { return { error: 'Rewards: invalid JSON' }; }
  if (!Array.isArray(objectives)) return { error: 'Objectives must be a JSON array' };
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    repeatable: document.getElementById('f-repeatable').value === '1',
    objectives,
    rewards,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/quests', 'POST', body); }
  return API(`/quests/${existing.id}`, 'PUT', body);
}
