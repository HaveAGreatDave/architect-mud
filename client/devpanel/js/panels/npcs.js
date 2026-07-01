async function npcSendToWork(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Moving…'; }
  try {
    const res = await API('/npcs/send-to-work', 'POST');
    if (res?.error) { toast(res.error, true); return; }
    if (!res.count) { toast('All NPCs already at their work zone.'); return; }
    toast(`Moved ${res.count} NPC${res.count !== 1 ? 's' : ''} to their work zones.`);
    await loadPanel('npcs');
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

async function deleteNpcRow(id) {
  const rec = allRecords.find(r => r.id === id);
  if (!rec || rec._stagingStatus === 'pending delete') return;
  if (!confirm(`Delete ${rec.name || id}?`)) return;
  const prev = currentRecord;
  currentRecord = rec;
  const result = await API(`/npcs/${id}`, 'DELETE');
  currentRecord = prev;
  if (result?.error) { toast(result.error, true); return; }
  if (result?.staged) {
    toast('Marked for deletion — publish to apply');
    await updateStagingBadge();
  } else {
    toast(result?.message || 'Deleted');
  }
  await loadPanel('npcs');
}

function renderNpcsPanel(data) {
  const records = Array.isArray(data) ? data : [];
  allRecords = records;
  const panel = document.getElementById('list-panel');
  if (!records.length) { panel.innerHTML = '<div style="padding:24px;color:var(--text-dim)">No NPCs found.</div>'; return; }

  const columns = PANELS.npcs.columns;
  const hasStagedRows = records.some(r => r._stagingStatus);
  let html = '<table><thead><tr>';
  for (const col of columns) {
    const isSorted = sortState.key === col.key;
    const arrow = isSorted ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    html += `<th class="sortable-col${isSorted?' sorted':''}" onclick="sortTableBy('${col.key}')">${col.label}${arrow}</th>`;
  }
  if (hasStagedRows) html += '<th>Status</th>';
  html += '<th></th></tr></thead><tbody>';

  let sorted = records;
  if (sortState.key) {
    sorted = [...records].sort((a, b) => {
      let av = a[sortState.key], bv = b[sortState.key];
      if (av == null) av = ''; if (bv == null) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortState.dir;
      return String(av).localeCompare(String(bv)) * sortState.dir;
    });
  }

  for (const rec of sorted) {
    const isPendingDelete = rec._stagingStatus === 'pending delete';
    const rowStyle = isPendingDelete
      ? 'cursor:pointer;opacity:0.6;text-decoration:line-through'
      : rec._stagingStatus ? 'cursor:pointer;border-left:3px solid var(--warning)' : 'cursor:pointer';
    html += `<tr style="${rowStyle}" onclick="editRecord('${rec.id}')">`;
    for (const col of columns) {
      const raw = rec[col.key];
      const val = col.render ? col.render(raw) : (raw ?? '—');
      html += `<td>${val}</td>`;
    }
    if (hasStagedRows) {
      const s = rec._stagingStatus;
      const badge = s === 'pending delete'
        ? `<span style="color:var(--danger);font-size:11px">⚠ ${s}</span>`
        : s ? `<span style="color:var(--warning);font-size:11px">● ${s}</span>` : '';
      html += `<td>${badge}</td>`;
    }
    html += `<td style="white-space:nowrap">
      <button class="action-btn" onclick="event.stopPropagation();editRecord('${rec.id}')">Edit</button>
      ${isPendingDelete ? '' : `<button class="action-btn danger" style="margin-left:3px" onclick="event.stopPropagation();deleteNpcRow('${rec.id}')">Delete</button>`}
    </td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';

  const lateCount = records.filter(r => r.work_zone_id && r.zone_id !== r.work_zone_id).length;
  const lateLabel = lateCount ? `Send to Work (${lateCount} late)` : 'Send to Work';
  const toolbar = `<div style="padding:6px 12px;border-bottom:1px solid var(--border);background:var(--bg2);display:flex;align-items:center;gap:8px">
    <button class="action-btn" style="font-size:11px;padding:3px 10px" onclick="npcSendToWork(this)"
      title="Teleport all NPCs with a work_zone who aren't there yet">${lateLabel}</button>
    ${lateCount ? `<span style="font-size:11px;color:var(--text-dim)">${lateCount} NPC${lateCount !== 1 ? 's' : ''} not at their work zone</span>` : '<span style="font-size:11px;color:var(--text-dim)">All NPCs at work</span>'}
  </div>`;

  panel.innerHTML = toolbar + html;
}

// --- Zone forms ---
// Controls which entrance-discovery flavor-text bank a building uses
// (server-side bank lives in commands.js, keyed by the same ids).
const NPC_CHITCHAT_PRESETS = {
  tv_host: [
    "We'll be right back after these messages.",
    "Incredible. Simply incredible. Stay with us.",
    "That's all the time we have for tonight, folks.",
    "Let's go to our correspondent in the field.",
    "Live from the ruins of civilization — this is the news.",
    "Don't touch that dial. Actually, you can't. The dial broke years ago.",
    "Our ratings are through the roof. The roof itself is on fire.",
    "I'm told we have a caller. Hello, you're on the air.",
    "This next segment has been approved by our corporate overlords.",
    "Remember: what you're about to see cannot be unseen.",
  ],
  bartender: [
    "What'll it be?",
    "You look like you've had a rough one.",
    "Pay first. Trust later. That's policy.",
    "You're not the first person to cry at this bar. Won't be the last.",
    "I've heard worse. Much worse.",
    "Last call was three hours ago. I'm still here.",
    "We're out of the good stuff. We were always out of the good stuff.",
    "Tab's running. Keep drinking.",
    "I don't ask questions. That's why people come here.",
    "You want ice with that? Funny.",
  ],
  vendor: [
    "Best prices in the district. That's not saying much.",
    "You touch it, you bought it.",
    "Everything's genuine. Genuinely acquired.",
    "Trade you for it. Credits preferred. Bullets accepted.",
    "Limited supply. Always limited. That's the pitch.",
    "I don't know where it came from. That's not your business either.",
    "Come back tomorrow — stock changes. If I'm still here.",
    "Quality merchandise at prices that won't kill you. Probably.",
  ],
  guard: [
    "Move along.",
    "Eyes forward.",
    "I see you.",
    "Nothing happens on my watch. Usually.",
    "This area is restricted. That's not a suggestion.",
    "I've had a long shift. Don't make it longer.",
    "Protocol says I have to say something. So: stop.",
    "Keep it moving.",
    "Don't make me call this in.",
  ],
  thug: [
    "You looking at something?",
    "Watch where you're walking.",
    "This block's got rules.",
    "Nice gear. Shame what happens to nice things.",
    "I seen you around here before?",
    "Mind your business and you'll keep your fingers.",
    "The crew knows your face now.",
    "We run things here. Not them. Us.",
  ],
  doctor: [
    "Don't touch that with your bare hands.",
    "I've seen worse. Barely.",
    "The human body is remarkably resilient. And remarkably stupid.",
    "This won't hurt much.",
    "I can fix that. The question is whether you'll want me to.",
    "My rates are reasonable. For the apocalypse.",
    "Symptom management is all any of us are doing at this point.",
    "Sign the waiver. Everyone signs the waiver.",
  ],
  politician: [
    "We're making progress.",
    "The data supports our approach.",
    "I hear your concerns. I'll note them down.",
    "The situation is under control. My definition of control.",
    "We're committed to accountability. The accountability of others.",
    "This is a temporary measure.",
    "Due process is very important to us.",
    "We are exploring all options. Except the obvious ones.",
  ],
  preacher: [
    "The end was promised. The end delivered.",
    "Repent. It won't help, but the gesture matters.",
    "He watches. Even here.",
    "Salvation is available. Supply is limited.",
    "Blessed are the adaptable.",
    "The scripture didn't specify what kind of fire.",
    "Sin freely. Confess generously. That's the cycle.",
    "Judgment is coming. It commutes.",
  ],
  vagrant: [
    "You got a smoke?",
    "I used to have a job. Good job too.",
    "Don't sleep near the east wall. Trust me.",
    "Seen things out there you wouldn't believe.",
    "It's gonna rain. I can tell. My knee knows.",
    "You got any credits? Just asking.",
    "They took everything. But not this spot. This spot's mine.",
    "The machines don't sleep. I've watched.",
  ],
  mercenary: [
    "This isn't personal. It's a contract.",
    "Better paid than the last job. That's all I ask.",
    "Don't mistake my silence for hesitation.",
    "I've seen a lot of warzones. They all look the same eventually.",
    "Loyalty's expensive. I'm surprisingly affordable.",
    "Eyes open. That's the whole philosophy.",
    "I get paid either way.",
    "There's no good side. Just better rates.",
  ],
  scientist: [
    "The results were unexpected. As always.",
    "Containment is holding. For now.",
    "This is theoretically reversible.",
    "The ethical review board no longer exists. We proceed.",
    "Note: do not touch the sample with your left hand.",
    "I've run the numbers. The numbers are concerning.",
    "Progress requires sacrifice. Usually someone else's.",
    "We're close. We are always close.",
  ],
  cult_member: [
    "He is coming. He is always coming.",
    "Join us. The waiting is easier with company.",
    "The old world is ash. This is better.",
    "We don't recruit. We recognise.",
    "Pain is just loyalty with nerve endings.",
    "Doubt is the first step. We help with the next ones.",
    "There is no leaving. There is only becoming.",
    "The vessel is willing. Are you?",
  ],
};

function npcLoadChitchatPreset() {
  const key = document.getElementById('f-chitchat-preset')?.value;
  if (!key || !NPC_CHITCHAT_PRESETS[key]) return;
  const ta = document.getElementById('f-chitchat');
  if (!ta) return;
  const existing = ta.value.trim();
  const preset = NPC_CHITCHAT_PRESETS[key].join('\n');
  ta.value = existing ? `${existing}\n${preset}` : preset;
}

async function npcEditForm(rec, isNew) {
  const tree = typeof rec.dialogue_tree === 'object' ? rec.dialogue_tree : JSON.parse(rec.dialogue_tree||'{}');
  const vendor = Array.isArray(rec.vendor_inventory) ? rec.vendor_inventory : JSON.parse(rec.vendor_inventory||'[]');
  const behaviourGraph = typeof rec.behaviour_graph === 'object' ? rec.behaviour_graph : JSON.parse(rec.behaviour_graph||'{}');
  const flags = typeof rec.flags === 'object' ? rec.flags : JSON.parse(rec.flags||'{}');
  const chitchat = Array.isArray(rec.chitchat) ? rec.chitchat : JSON.parse(rec.chitchat||'[]');
  const zones = await API('/zones').catch(() => []);
  const zoneList = Array.isArray(zones) ? [...zones].sort((a, b) => (a.id||'').localeCompare(b.id||'')) : [];
  const homeZoneVal = rec.home_zone || 'zone_residential_lobby';
  const homeZoneOpts = zoneList.map(z => `<option value="${z.id}" ${z.id===homeZoneVal?'selected':''}>${z.id}</option>`).join('');
  const presetOpts = [
    ['', '— load preset —'],
    ['tv_host',     '📺 TV Host'],
    ['bartender',   '🍺 Bartender'],
    ['vendor',      '🛒 Vendor'],
    ['guard',       '🔒 Guard'],
    ['thug',        '🔪 Thug'],
    ['doctor',      '🩺 Doctor'],
    ['politician',  '🎙 Politician'],
    ['preacher',    '✝ Preacher'],
    ['vagrant',     '🚬 Vagrant'],
    ['mercenary',   '💀 Mercenary'],
    ['scientist',   '🔬 Scientist'],
    ['cult_member', '👁 Cult Member'],
  ].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  return `
    <div class="field"><label>NPC ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}" ${isNew?'oninput="autoFillId(this)"':''}></div>
    <div class="field"><label>Description</label><textarea id="f-description">${rec.description||''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Zone ID</label><input id="f-zone_id" value="${rec.zone_id||''}"></div>
      <div class="field"><label>Home Zone</label><select id="f-home_zone">${homeZoneOpts}</select></div>
      <div class="field"><label>Faction</label><input id="f-faction" value="${rec.faction||''}"></div>
    </div>
    <div class="checkbox-field"><input type="checkbox" id="f-wanders" ${rec.wanders?'checked':''} onchange="document.getElementById('f-wander_zones-wrap').style.display=this.checked?'':'none'"><label>Wanders between zones</label></div>
    <div class="field" id="f-wander_zones-wrap" style="${rec.wanders?'':'display:none'}">
      <label>Permitted Wander Zones (one zone ID per line)</label>
      <textarea id="f-wander_zones" rows="4" placeholder="Leave blank to wander to adjacent zones only">${(Array.isArray(rec.wander_zones)?rec.wander_zones:JSON.parse(rec.wander_zones||'[]')).join('\n')}</textarea>
      <div class="zone-subsection-note">Current zone is always included at runtime.</div>
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>Chitchat Lines <span style="font-weight:400;color:var(--text-dim);font-size:11px">— one per line, spoken at random during idle</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="f-chitchat-preset" class="form-input" style="font-size:11px;padding:3px 6px">${presetOpts}</select>
          <button type="button" class="action-btn" style="font-size:11px;padding:3px 8px" onclick="npcLoadChitchatPreset()">Load</button>
        </div>
      </div>
      <textarea id="f-chitchat" rows="6" placeholder="She took everything, man.\nYou want another?">${chitchat.join('\n')}</textarea>
    </div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>Dialogue Tree (JSON)</label>
        <button type="button" class="action-btn" onclick="npcOpenVine()">🌿 Visual Editor</button>
      </div>
      <textarea id="f-dialogue_tree" rows="10">${JSON.stringify(tree, null, 2)}</textarea>
    </div>
    <div class="field"><label>Vendor Inventory — array of { "item_id": "...", "price"?: 0, "stock"?: 99 } (price/stock optional)</label><textarea id="f-vendor_inventory" rows="5">${JSON.stringify(vendor, null, 2)}</textarea></div>
    <div class="field">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <label>AI Behaviour Graph (JSON) — overrides random wander when set</label>
        <button type="button" class="action-btn" onclick="npcOpenVineAI()">🌿 AI Behaviour</button>
      </div>
      <textarea id="f-behaviour_graph" rows="6">${JSON.stringify(behaviourGraph, null, 2)}</textarea>
    </div>
    <div class="field"><label>Flags (JSON) — e.g. gender, first_strike_delay_ms, battle_cries</label><textarea id="f-flags" rows="3">${JSON.stringify(flags, null, 2)}</textarea></div>
  `;
}

async function saveNpc(existing) {
  const isNew = !existing?.id;
  let tree, vendor, behaviour_graph;
  try { tree = JSON.parse(document.getElementById('f-dialogue_tree').value); } catch { return { error: 'Dialogue tree: invalid JSON' }; }
  try { vendor = JSON.parse(document.getElementById('f-vendor_inventory').value); } catch { return { error: 'Vendor inventory: invalid JSON' }; }
  if (!Array.isArray(vendor)) return { error: 'Vendor inventory must be a JSON array.' };
  for (const e of vendor) {
    if (!e || typeof e.item_id !== 'string' || !e.item_id.trim()) {
      return { error: 'Vendor inventory: each entry needs an "item_id" string (price/stock optional).' };
    }
  }
  try { behaviour_graph = JSON.parse(document.getElementById('f-behaviour_graph')?.value || '{}'); } catch { return { error: 'Behaviour graph: invalid JSON' }; }
  let flags;
  try { flags = JSON.parse(document.getElementById('f-flags')?.value || '{}'); } catch { return { error: 'Flags: invalid JSON' }; }
  const wanderZonesRaw = document.getElementById('f-wander_zones')?.value || '';
  const wander_zones = wanderZonesRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const chitchat = (document.getElementById('f-chitchat')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    zone_id: document.getElementById('f-zone_id').value || null,
    home_zone: document.getElementById('f-home_zone').value || null,
    faction: document.getElementById('f-faction').value || null,
    wanders: document.getElementById('f-wanders').checked,
    wander_zones,
    chitchat,
    dialogue_tree: tree,
    vendor_inventory: vendor,
    behaviour_graph,
    flags,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim() || document.getElementById('f-name').value.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''); return API('/npcs', 'POST', body); }
  return API(`/npcs/${existing.id}`, 'PUT', body);
}

function npcOpenVine() {
  let tree;
  try { tree = JSON.parse(document.getElementById('f-dialogue_tree').value || '{}'); }
  catch { toast('Dialogue tree: invalid JSON — fix it before opening the visual editor.', true); return; }
  const graphData = VineDialogueSchema.fromDialogueTree(tree);
  vineModalOpen(
    `Dialogue: ${currentRecord?.name || 'NPC'}`,
    VineDialogueSchema,
    graphData,
    (savedGraph) => {
      const treeOut = VineDialogueSchema.toDialogueTree(savedGraph);
      document.getElementById('f-dialogue_tree').value = JSON.stringify(treeOut, null, 2);
      toast('Dialogue saved to form — click Save to persist.');
    }
  );
}

function npcOpenVineAI() {
  let graph;
  try { graph = JSON.parse(document.getElementById('f-behaviour_graph').value || '{}'); }
  catch { toast('Behaviour graph: invalid JSON — fix it before opening the visual editor.', true); return; }
  const graphData = VineAISchema.fromAiGraph(graph);
  vineModalOpen(
    `AI Behaviour: ${currentRecord?.name || 'NPC'}`,
    VineAISchema,
    graphData,
    (savedGraph) => {
      const out = VineAISchema.toAiGraph(savedGraph);
      document.getElementById('f-behaviour_graph').value = JSON.stringify(out, null, 2);
      toast('Behaviour graph saved to form — click Save to persist.');
    }
  );
}

// --- Furniture panel (grouped by zone) ---

