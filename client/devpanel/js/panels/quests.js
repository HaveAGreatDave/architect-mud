// Quests panel — authors the `quests` table consumed by the quests plugin.
// Objectives/rewards are edited as raw JSON, matching the recipe/mutation editors.
//   objectives: [{ type:'kill'|'give'|'visit'|'deliver', target?, item_id?, zone?, count?, desc }]
//   rewards:    { credits?, items?:[{item_id,quantity}], flags?:[{scope,flag,value}] }
//
// quest_type distinguishes an ordinary hand-authored quest (also what jobboard pools)
// from a pilot-contract archetype ('flight_template', edited here; its `meta` fields
// drive plugins/flight/contracts.js's board generator) and a generated contract
// instance ('flight' — not editable here, hidden from the list by default).

function questMetaFields(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  return `
    <div class="field"><label>Kind</label>
      <select id="f-meta-kind">
        <option value="cargo" ${m.kind !== 'passenger' ? 'selected' : ''}>Cargo</option>
        <option value="passenger" ${m.kind === 'passenger' ? 'selected' : ''}>Passenger</option>
      </select>
    </div>
    <div class="field"><label>Legal?</label>
      <select id="f-meta-legal">
        <option value="1" ${m.legal !== false ? 'selected' : ''}>Legal</option>
        <option value="0" ${m.legal === false ? 'selected' : ''}>Contraband (fly dark)</option>
      </select>
    </div>
    <div class="field"><label>Pay multiplier</label><input id="f-meta-paymult" type="number" step="0.1" value="${m.payMult ?? 1.0}"></div>
    <div class="field"><label>Base risk (0-5)</label><input id="f-meta-riskbase" type="number" value="${m.riskBase ?? 0}"></div>
    <div class="field"><label>Weight min (kg)</label><input id="f-meta-wmin" type="number" value="${m.wMin ?? 40}"></div>
    <div class="field"><label>Weight max (kg)</label><input id="f-meta-wmax" type="number" value="${m.wMax ?? 100}"></div>
    <div class="field"><label>Delivery deadline (minutes)</label><input id="f-meta-deadline" type="number" value="${m.deadlineMins ?? 20}"></div>
    <div class="field"><label>Cargo/passenger names (one per line)</label><textarea id="f-meta-names" rows="3">${(Array.isArray(m.names) ? m.names : []).join('\n')}</textarea></div>
  `;
}

function readQuestMetaFields() {
  return {
    kind: document.getElementById('f-meta-kind').value,
    legal: document.getElementById('f-meta-legal').value === '1',
    payMult: parseFloat(document.getElementById('f-meta-paymult').value) || 1.0,
    riskBase: parseInt(document.getElementById('f-meta-riskbase').value, 10) || 0,
    wMin: parseInt(document.getElementById('f-meta-wmin').value, 10) || 0,
    wMax: parseInt(document.getElementById('f-meta-wmax').value, 10) || 0,
    deadlineMins: parseInt(document.getElementById('f-meta-deadline').value, 10) || 20,
    names: (document.getElementById('f-meta-names').value || '').split('\n').map(s => s.trim()).filter(Boolean),
  };
}

function toggleQuestMetaVisibility() {
  const isFlight = document.getElementById('f-quest-type').value === 'flight_template';
  const el = document.getElementById('f-meta-wrap');
  if (el) el.style.display = isFlight ? '' : 'none';
}

function questEditForm(rec, isNew) {
  const objectives = Array.isArray(rec.objectives) ? rec.objectives : JSON.parse(rec.objectives || '[]');
  const rewards = typeof rec.rewards === 'object' && rec.rewards ? rec.rewards : JSON.parse(rec.rewards || '{}');
  const questType = rec.quest_type || 'standard';
  const meta = typeof rec.meta === 'object' && rec.meta ? rec.meta : (rec.meta ? JSON.parse(rec.meta) : {});
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
    <div class="field"><label>Quest Type</label>
      <select id="f-quest-type" onchange="toggleQuestMetaVisibility()">
        <option value="standard" ${questType==='standard'?'selected':''}>Standard (incl. job board)</option>
        <option value="flight_template" ${questType==='flight_template'?'selected':''}>Flight Contract Template</option>
      </select>
    </div>
    <div id="f-meta-wrap" style="display:${questType==='flight_template'?'':'none'}">
      ${questMetaFields(meta)}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <label style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Quest Graph</label>
      <button type="button" class="action-btn" onclick="questsOpenVine()">🌿 Visual Editor</button>
    </div>
    <div class="field"><label>Objectives (JSON array — type: kill/give/visit/deliver + target/item_id/zone, count, desc)</label><textarea id="f-objectives" rows="6">${JSON.stringify(objectives, null, 2)}</textarea></div>
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
    id: currentRecord?.id,
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    repeatable: document.getElementById('f-repeatable').value === '1',
    quest_type: document.getElementById('f-quest-type').value,
    meta: document.getElementById('f-quest-type').value === 'flight_template' ? readQuestMetaFields() : {},
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
      document.getElementById('f-quest-type').value = q.quest_type;
      toggleQuestMetaVisibility();
      if (q.quest_type === 'flight_template') {
        document.getElementById('f-meta-wrap').innerHTML = questMetaFields(q.meta);
      }
      document.getElementById('f-objectives').value = JSON.stringify(q.objectives, null, 2);
      document.getElementById('f-rewards').value = JSON.stringify(q.rewards, null, 2);
      toast('Quest graph applied — click Save to persist.');
    },
    null,
    vineFamilyTabs('quest')
  );
}

async function saveQuest(existing) {
  const isNew = !existing?.id;
  let objectives, rewards;
  try { objectives = JSON.parse(document.getElementById('f-objectives').value); } catch { return { error: 'Objectives: invalid JSON' }; }
  try { rewards = JSON.parse(document.getElementById('f-rewards').value); } catch { return { error: 'Rewards: invalid JSON' }; }
  if (!Array.isArray(objectives)) return { error: 'Objectives must be a JSON array' };
  const questType = document.getElementById('f-quest-type').value;
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    repeatable: document.getElementById('f-repeatable').value === '1',
    objectives,
    rewards,
    quest_type: questType,
    meta: questType === 'flight_template' ? readQuestMetaFields() : {},
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/quests', 'POST', body); }
  return API(`/quests/${existing.id}`, 'PUT', body);
}
