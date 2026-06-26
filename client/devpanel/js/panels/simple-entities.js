function mutationEditForm(rec, isNew) {
  const statMods = typeof rec.stat_modifiers === 'object' ? rec.stat_modifiers : JSON.parse(rec.stat_modifiers||'{}');
  const effects = typeof rec.effects === 'object' ? rec.effects : JSON.parse(rec.effects||'{}');
  const drawbacks = Array.isArray(rec.drawbacks) ? rec.drawbacks : JSON.parse(rec.drawbacks||'[]');
  return `
    <div class="field"><label>Mutation ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description||''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Polarity</label>
        <select id="f-polarity">
          ${['positive','negative','mixed'].map(p=>`<option ${rec.polarity===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Visible? (drives Custodian outcast checks)</label>
        <select id="f-visible">
          <option value="1" ${rec.visible?'selected':''}>Visible</option>
          <option value="0" ${!rec.visible?'selected':''}>Hidden</option>
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Rarity</label><input id="f-rarity" value="${rec.rarity||'uncommon'}"></div>
      <div class="field"><label>Radiation Threshold</label><input type="number" id="f-radiation_threshold" value="${rec.radiation_threshold||40}" min="0" max="100"></div>
    </div>
    <div class="field"><label>Stat Modifiers (JSON — permanent, applied once on grant)</label><textarea id="f-stat_modifiers" rows="2">${JSON.stringify(statMods, null, 2)}</textarea></div>
    <div class="field"><label>Effects (JSON — freeform, read by engine code as needed)</label><textarea id="f-effects" rows="3">${JSON.stringify(effects, null, 2)}</textarea></div>
    <div class="field"><label>Drawbacks (JSON array of strings, shown to the player)</label><textarea id="f-drawbacks" rows="2">${JSON.stringify(drawbacks, null, 2)}</textarea></div>
  `;
}

async function saveMutation(existing) {
  const isNew = !existing?.id;
  let statMods, effects, drawbacks;
  try { statMods = JSON.parse(document.getElementById('f-stat_modifiers').value); } catch { return { error: 'Stat modifiers: invalid JSON' }; }
  try { effects = JSON.parse(document.getElementById('f-effects').value); } catch { return { error: 'Effects: invalid JSON' }; }
  try { drawbacks = JSON.parse(document.getElementById('f-drawbacks').value); } catch { return { error: 'Drawbacks: invalid JSON' }; }
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    polarity: document.getElementById('f-polarity').value,
    visible: document.getElementById('f-visible').value === '1',
    rarity: document.getElementById('f-rarity').value || 'uncommon',
    radiation_threshold: +document.getElementById('f-radiation_threshold').value || 40,
    stat_modifiers: statMods, effects, drawbacks,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/mutations', 'POST', body); }
  return API(`/mutations/${existing.id}`, 'PUT', body);
}

// --- Drug forms ---
function drugEditForm(rec, isNew) {
  const effects = typeof rec.effects === 'object' ? rec.effects : JSON.parse(rec.effects||'{}');
  const withdrawal = typeof rec.withdrawal_effects === 'object' ? rec.withdrawal_effects : JSON.parse(rec.withdrawal_effects||'{}');
  return `
    <div class="field"><label>Drug ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description||''}</textarea></div>
    <div class="field"><label>Linked Item ID (must exist in Items)</label><input id="f-item_id" value="${rec.item_id||''}" placeholder="e.g. item_drug_buzz"></div>
    <div class="field-row">
      <div class="field"><label>Duration (seconds)</label><input type="number" id="f-duration_seconds" value="${rec.duration_seconds||300}"></div>
      <div class="field"><label>Overdose Threshold (doses in system)</label><input type="number" id="f-overdose_threshold" value="${rec.overdose_threshold||3}" min="1"></div>
    </div>
    <div class="field"><label>Addiction Chance (0.0 - 1.0)</label><input type="number" id="f-addiction_chance" value="${rec.addiction_chance||0}" min="0" max="1" step="0.01"></div>
    <div class="field"><label>Effects (JSON — hp/sanity/hunger/thirst/radiation deltas)</label><textarea id="f-effects" rows="3">${JSON.stringify(effects, null, 2)}</textarea></div>
    <div class="field"><label>Overdose Effects (JSON — applied on top of normal effects when overdosed)</label><textarea id="f-withdrawal_effects" rows="3">${JSON.stringify(withdrawal.overdose ? withdrawal : {overdose:{}}, null, 2)}</textarea></div>
  `;
}

async function saveDrug(existing) {
  const isNew = !existing?.id;
  let effects, withdrawal;
  try { effects = JSON.parse(document.getElementById('f-effects').value); } catch { return { error: 'Effects: invalid JSON' }; }
  try { withdrawal = JSON.parse(document.getElementById('f-withdrawal_effects').value); } catch { return { error: 'Overdose effects: invalid JSON' }; }
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    item_id: document.getElementById('f-item_id').value || null,
    duration_seconds: +document.getElementById('f-duration_seconds').value || 300,
    overdose_threshold: +document.getElementById('f-overdose_threshold').value || 3,
    addiction_chance: +document.getElementById('f-addiction_chance').value || 0,
    effects, withdrawal_effects: withdrawal,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/drugs', 'POST', body); }
  return API(`/drugs/${existing.id}`, 'PUT', body);
}


function recipeEditForm(rec, isNew) {
  const skillReq = typeof rec.skill_req === 'object' ? rec.skill_req : JSON.parse(rec.skill_req||'{}');
  const ingredients = Array.isArray(rec.ingredients) ? rec.ingredients : JSON.parse(rec.ingredients||'[]');
  const output = typeof rec.base_output === 'object' ? rec.base_output : JSON.parse(rec.base_output||'{}');
  return `
    <div class="field"><label>Recipe ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description||''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Category</label><input id="f-category" value="${rec.category||'misc'}" placeholder="weapons / armor / medicine / tech"></div>
      <div class="field"><label>Requires Station (blank = none)</label><input id="f-requires_station" value="${rec.requires_station||''}" placeholder="e.g. chemistry_set"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Primary Skill (used for the craft roll)</label><input id="f-skill_id" value="${rec.skill_id||'fabrication'}"></div>
      <div class="field"><label>Base Difficulty</label><input type="number" id="f-base_difficulty" value="${rec.base_difficulty||3}" min="1" max="20"></div>
    </div>
    <div class="field"><label>Skill Requirements (JSON object — skill_id: min_rank)</label><textarea id="f-skill_req" rows="3">${JSON.stringify(skillReq, null, 2)}</textarea></div>
    <div class="field"><label>Ingredients (JSON array)</label><textarea id="f-ingredients" rows="5">${JSON.stringify(ingredients, null, 2)}</textarea></div>
    <div class="field"><label>Output (JSON: item_id + quantity)</label><textarea id="f-base_output" rows="2">${JSON.stringify(output, null, 2)}</textarea></div>
  `;
}

async function saveRecipe(existing) {
  const isNew = !existing?.id;
  let skillReq, ingredients, output;
  try { skillReq = JSON.parse(document.getElementById('f-skill_req').value); } catch { return { error: 'Skill requirements: invalid JSON' }; }
  try { ingredients = JSON.parse(document.getElementById('f-ingredients').value); } catch { return { error: 'Ingredients: invalid JSON' }; }
  try { output = JSON.parse(document.getElementById('f-base_output').value); } catch { return { error: 'Output: invalid JSON' }; }
  if (!output.item_id) return { error: 'Output must include an item_id' };

  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    category: document.getElementById('f-category').value || 'misc',
    requires_station: document.getElementById('f-requires_station').value || null,
    skill_id: document.getElementById('f-skill_id').value,
    base_difficulty: +document.getElementById('f-base_difficulty').value || 3,
    skill_req: skillReq,
    ingredients,
    base_output: output,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/recipes', 'POST', body); }
  return API(`/recipes/${existing.id}`, 'PUT', body);
}

// ── Script node editor (Phase 4: shared graph) ──────────────────────────────
// Edits the exact JSON the graph runtime executes:
//   { start, nodes: { id: { type, ...fields } } }
// The node list is the source of truth; a raw-JSON box mirrors it for power use.
