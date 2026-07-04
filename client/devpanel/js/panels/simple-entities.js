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
    <div class="field"><label>Radiation Threshold</label><input type="number" id="f-radiation_threshold" value="${rec.radiation_threshold||40}" min="0" max="100"></div>
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
    <input type="hidden" id="f-flags-json" value='${JSON.stringify(rec.flags||{}).replace(/'/g,'&#39;').replace(/</g,'&lt;')}'>
    <div class="field"><label>Drug ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description||''}</textarea></div>
    <div class="field"><label>Linked Item ID (must exist in Items)</label><input id="f-item_id" value="${rec.item_id||''}" placeholder="e.g. item_drug_buzz"></div>
    <div class="field-row">
      <div class="field"><label>Duration (seconds)</label><input type="number" id="f-duration_seconds" value="${rec.duration_seconds||300}"></div>
      <div class="field"><label>Overdose Threshold (doses in system)</label><input type="number" id="f-overdose_threshold" value="${rec.overdose_threshold||3}" min="1"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Addiction Chance (0.0 - 1.0)</label><input type="number" id="f-addiction_chance" value="${rec.addiction_chance||0}" min="0" max="1" step="0.01"></div>
      <div class="field"><label>Legality (legal = coffee/beer: normal vendors, no police heat)</label>
        <select id="f-is_legal">
          <option value="0" ${!rec.flags?.legal?'selected':''}>Controlled (illegal)</option>
          <option value="1" ${rec.flags?.legal?'selected':''}>Legal</option>
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Package form (how it looks on the splice bench)</label>
        <select id="f-form">
          <option value="" ${!rec.flags?.form?'selected':''}>— auto (derive from drug) —</option>
          <option value="liquid" ${rec.flags?.form==='liquid'?'selected':''}>liquid (vial)</option>
          <option value="powder" ${rec.flags?.form==='powder'?'selected':''}>powder (baggie)</option>
          <option value="gel" ${rec.flags?.form==='gel'?'selected':''}>gel (pouch)</option>
          <option value="pill" ${rec.flags?.form==='pill'?'selected':''}>pill (blister)</option>
          <option value="gas" ${rec.flags?.form==='gas'?'selected':''}>gas (canister)</option>
          <option value="crystal" ${rec.flags?.form==='crystal'?'selected':''}>crystal (shard)</option>
          <option value="blotter" ${rec.flags?.form==='blotter'?'selected':''}>blotter (tab sheet)</option>
          <option value="paste" ${rec.flags?.form==='paste'?'selected':''}>paste (tar brick)</option>
          <option value="leaf" ${rec.flags?.form==='leaf'?'selected':''}>leaf (herb baggie)</option>
        </select></div>
      <div class="field"><label>Sub-form (mix behaviour)</label><input id="f-sub" value="${rec.flags?.sub||''}" placeholder="auto — thin/oil/solvent/fine/crystalline/viscous/tablet"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Package colour</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="color" id="f-color" value="${rec.flags?.color||'#4fe08a'}" oninput="var c=document.getElementById('f-color-on');if(c)c.checked=true" style="width:34px;height:28px;padding:1px;border:1px solid var(--border);background:var(--bg3);cursor:pointer;flex-shrink:0">
          <label style="font-size:12px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="f-color-on" ${rec.flags?.color?'checked':''}> custom (else auto)</label>
        </div>
      </div>
      <div class="field"><label>Volatility (0–1 — splice danger)</label><input type="number" id="f-volatility" value="${rec.flags?.volatility ?? ''}" min="0" max="1" step="0.05" placeholder="auto"></div>
    </div>
    <div class="field"><button type="button" class="action-btn primary" style="width:100%" onclick="openDrugEditorFromForm()">⚗ Open Structured Editor…</button><div class="hint" style="font-size:11px;opacity:0.7;margin-top:4px">Sectioned pop-out for instant / phased / tolerance / withdrawal / overdose / hallucination — no raw JSON. Seeds from the fields below.</div></div>
    <div class="field"><label>Effects (JSON — advanced / fallback)</label>
      <div class="hint" style="font-size:11px;line-height:1.5;opacity:0.75;margin:2px 0 4px">
        All sub-blocks optional. A flat object (no keys below) is treated as <code>instant</code> for back-compat.<br>
        • <code>instant</code>: {hp, sanity, hunger, thirst, radiation, horniness_increase} one-shot deltas.<br>
        • <code>phases</code>: {comeup_seconds, peak_seconds, comedown_seconds, comeup_scale, comedown_scale, peak_mods, comeup_message, peak_message, comedown_message, end_message}. <code>peak_mods</code> holds buff deltas (stat_brawn, stat_reflexes, stat_brains, stat_cool, stat_endurance, hp_max, sanity_max) plus <code>*_regen_per_sec</code> drip keys (hp/sanity/stamina). Buffs ramp by scale on come-up/comedown and are cleanly reversed on expiry.<br>
        • <code>tolerance</code>: {gain_per_dose, recovery_per_sec, max_reduction} — repeated use lowers potency; recovers over time.<br>
        • <code>withdrawal</code>: {onset_seconds, mods, message, addiction_per_dose, addiction_recovery_per_sec} — bites after time without a dose once addicted.<br>
        • <code>overdose</code>: {lethal:true, message} — exceeding Overdose Threshold doses kills the player.<br>
        • <code>hallucination</code>: {mode:"overlay"|"dreamzone", intensity, palette, duration_seconds, events:[{atSec,text}] or eventPool+eventEverySec, dreamzone_id}. Palettes: green/purple/red/gold/cyan/magenta/blue. Use [trip]...[/trip] in text for melting FX.
      </div>
      <textarea id="f-effects" rows="6">${JSON.stringify(effects, null, 2)}</textarea></div>
    <div class="field"><label>Overdose Effects (JSON — applied on top of normal effects when overdosed)</label><textarea id="f-withdrawal_effects" rows="3">${JSON.stringify(withdrawal.overdose ? withdrawal : {overdose:{}}, null, 2)}</textarea></div>
  `;
}

async function saveDrug(existing) {
  const isNew = !existing?.id;
  let effects, withdrawal;
  try { effects = JSON.parse(document.getElementById('f-effects').value); } catch { return { error: 'Effects: invalid JSON' }; }
  try { withdrawal = JSON.parse(document.getElementById('f-withdrawal_effects').value); } catch { return { error: 'Overdose effects: invalid JSON' }; }
  // Preserve any existing flags; just set/clear the `legal` bit from the dropdown.
  const flags = (existing && typeof existing.flags === 'object' && existing.flags)
    ? { ...existing.flags }
    : (() => { try { return JSON.parse(existing?.flags || '{}'); } catch { return {}; } })();
  flags.legal = document.getElementById('f-is_legal').value === '1';
  // Splice-bench appearance (blank/unchecked = auto-derive; the plugin falls back).
  const _f = (id) => document.getElementById(id);
  if (_f('f-form')) { const v = _f('f-form').value; if (v) flags.form = v; else delete flags.form; }
  if (_f('f-sub')) { const v = _f('f-sub').value.trim(); if (v) flags.sub = v; else delete flags.sub; }
  if (_f('f-color-on')) { if (_f('f-color-on').checked) flags.color = _f('f-color').value; else delete flags.color; }
  if (_f('f-volatility')) { const v = _f('f-volatility').value; if (v === '') delete flags.volatility; else flags.volatility = Math.max(0, Math.min(1, +v)); }
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    item_id: document.getElementById('f-item_id').value || null,
    duration_seconds: +document.getElementById('f-duration_seconds').value || 300,
    overdose_threshold: +document.getElementById('f-overdose_threshold').value || 3,
    addiction_chance: +document.getElementById('f-addiction_chance').value || 0,
    effects, withdrawal_effects: withdrawal, flags,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/drugs', 'POST', body); }
  return API(`/drugs/${existing.id}`, 'PUT', body);
}


// --- Crime forms ---
// Crime keys are engine constants (server/engine/crimes.js) — the panel only
// tunes the star weight each act carries. Stars are additive across crimes and
// capped at 5; how a crime is "caught" (camera / any witness / always) is fixed
// in engine and shown read-only here.
function crimeEditForm(rec) {
  const caught = rec.witness === 'camera' ? 'a live camera only'
    : rec.witness === 'always' ? 'always (self-reporting)'
    : 'any witness — camera, on-duty cop, or another player';
  return `
    <div class="field"><label>Crime Key</label><input id="f-id" value="${rec.id||''}" readonly style="opacity:0.5"></div>
    <div class="field"><label>Label</label><input id="f-label" value="${rec.label||''}"></div>
    <div class="field"><label>Stars (0–5, half-steps allowed)</label><input type="number" id="f-stars" value="${rec.stars ?? 1}" min="0" max="5" step="0.5"></div>
    <div class="field"><label>Description</label><textarea id="f-description" rows="2">${rec.description||''}</textarea></div>
    <div class="hint" style="font-size:11px;opacity:0.75;line-height:1.5;margin-top:4px">
      Caught by: <b>${caught}</b>.<br>
      A camera that catches any crime flashes red and calls the suspect out to the whole room.<br>
      Wanted stars are additive across crimes and capped at 5.
    </div>
  `;
}

async function saveCrime(existing) {
  const id = existing?.id || document.getElementById('f-id').value.trim();
  const body = {
    label: document.getElementById('f-label').value,
    stars: +document.getElementById('f-stars').value,
    description: document.getElementById('f-description').value,
  };
  return API(`/crimes/${id}`, 'PUT', body);
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
