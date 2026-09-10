function openAddRoomForm(zoneId, freeDirs, isBuilding) {
  const label = isBuilding ? 'Building Name' : 'Room Name';
  const placeholder = isBuilding ? 'e.g. Rusty Bar' : 'e.g. Kitchen';
  document.getElementById('zone-add-room-form').innerHTML = `
    <div class="zone-inline-form">
      <div class="field"><label>Direction</label><select id="nr-direction">${freeDirs.map(d=>`<option>${d}</option>`).join('')}</select></div>
      <div class="field"><label>${label}</label><input id="nr-name" placeholder="${placeholder}"></div>
      <div class="field"><label>Description</label><textarea id="nr-description" rows="3" placeholder="A small room."></textarea></div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick='submitAddRoom(${JSON.stringify(zoneId)}, ${!!isBuilding})'>Create</button>
        <button class="action-btn" onclick="document.getElementById('zone-add-room-form').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}
async function submitAddRoom(zoneId, isBuilding) {
  const direction = document.getElementById('nr-direction').value;
  const name = document.getElementById('nr-name').value.trim();
  const description = document.getElementById('nr-description').value.trim();
  if (!name) { toast('Name is required', true); return; }
  const result = await API(`/zones/${zoneId}/rooms`, 'POST', { direction, name, description, is_building: isBuilding });
  if (result?.error) { toast(result.error, true); return; }
  toast(result.message || (isBuilding ? 'Building added' : 'Room added'));
  await refreshZoneEditPanel(zoneId);
}
async function deleteRoomQuick(roomId, parentZoneId) {
  if (!(await dpConfirm(`Delete this room? This can't be undone.`, { danger: true }))) return;
  const result = await API(`/zones/${roomId}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast(result.message || 'Room deleted');
  await refreshZoneEditPanel(parentZoneId);
}

// NPCs
function openAddNpcForm(zoneId) {
  document.getElementById('zone-add-npc-form').innerHTML = `
    <div class="zone-inline-form">
      <div class="field"><label>Name</label><input id="nn-name" placeholder="e.g. Lowry"></div>
      <div class="field"><label>Description</label><textarea id="nn-description" rows="3"></textarea></div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick='submitAddNpc(${JSON.stringify(zoneId)})'>Create</button>
        <button class="action-btn" onclick="document.getElementById('zone-add-npc-form').innerHTML=''">Cancel</button>
      </div>
      <div class="zone-subsection-note">For dialogue trees or a vendor inventory, use the full NPCs panel after creating.</div>
    </div>`;
}
async function submitAddNpc(zoneId) {
  const name = document.getElementById('nn-name').value.trim();
  const description = document.getElementById('nn-description').value.trim();
  if (!name) { toast('NPC name is required', true); return; }
  const result = await API('/npcs', 'POST', { zone_id: zoneId, name, description, faction: null, dialogue_tree: {}, vendor_inventory: [], wanders: false, flags: {} });
  if (result?.error) { toast(result.error, true); return; }
  toast('NPC added');
  await refreshZoneEditPanel(zoneId);
}
function openAddExistingNpcForm(zoneId) {
  const available = zoneEditAllNpcsCache.filter(n => n.zone_id !== zoneId);
  const container = document.getElementById('zone-add-npc-form');
  if (!available.length) {
    container.innerHTML = `<div class="zone-inline-form"><div class="zone-subsection-note">No other NPCs available to move here.</div><div class="zone-inline-form-actions"><button class="action-btn" onclick="document.getElementById('zone-add-npc-form').innerHTML=''">Cancel</button></div></div>`;
    return;
  }
  container.innerHTML = `
    <div class="zone-inline-form">
      <div class="field"><label>NPC</label>
        <select id="existing-npc-select">
          ${available.map(n => `<option value="${n.id}">${n.name}${n.zone_id ? ` (from ${n.zone_id})` : ''}</option>`).join('')}
        </select>
      </div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick='submitAddExistingNpc(${JSON.stringify(zoneId)})'>Move Here</button>
        <button class="action-btn" onclick="document.getElementById('zone-add-npc-form').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}
async function submitAddExistingNpc(zoneId) {
  const sel = document.getElementById('existing-npc-select');
  const npcId = sel?.value;
  if (!npcId) return;
  const npc = zoneEditAllNpcsCache.find(n => n.id === npcId);
  if (!npc) return;
  const result = await API(`/npcs/${npcId}`, 'PUT', {
    name: npc.name, description: npc.description,
    zone_id: zoneId, faction: npc.faction,
    dialogue_tree: npc.dialogue_tree || {}, vendor_inventory: npc.vendor_inventory || [],
    wanders: npc.wanders, flags: npc.flags || {},
  });
  if (result?.error) { toast(result.error, true); return; }
  toast(`${npc.name} moved to this zone`);
  await refreshZoneEditPanel(zoneId);
}
function openEditNpcQuick(npcId) {
  const npc = zoneEditNpcsCache.find(n => n.id === npcId);
  const row = document.getElementById(`npc-row-${npcId}`);
  if (!npc || !row) return;
  row.innerHTML = `
    <div class="zone-inline-form">
      <div class="field"><label>Name</label><input id="en-name-${npc.id}" value="${npc.name||''}"></div>
      <div class="field"><label>Description</label><textarea id="en-description-${npc.id}" rows="3">${npc.description||''}</textarea></div>
      <div class="field"><label>Work Zone <span style="font-weight:400;color:var(--text-dim);font-size:11px">— zone this NPC works in (e.g. a dealer's table room); blank = none</span></label><input id="en-workzone-${npc.id}" value="${npc.work_zone_id||''}" placeholder="zone_id"></div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick="submitEditNpcQuick('${npc.id}')">Save</button>
        <button class="action-btn" onclick="refreshZoneEditPanel('${npc.zone_id}')">Cancel</button>
      </div>
    </div>`;
}
async function submitEditNpcQuick(npcId) {
  const npc = zoneEditNpcsCache.find(n => n.id === npcId);
  if (!npc) return;
  const name = document.getElementById(`en-name-${npc.id}`).value.trim();
  const description = document.getElementById(`en-description-${npc.id}`).value.trim();
  const work_zone_id = document.getElementById(`en-workzone-${npc.id}`).value.trim() || null;
  // Preserve everything this quick-edit form doesn't expose (faction,
  // dialogue_tree, vendor_inventory, wanders, flags) by round-tripping it
  // from the cached record.
  const result = await API(`/npcs/${npc.id}`, 'PUT', {
    name, description, work_zone_id,
    zone_id: npc.zone_id, faction: npc.faction,
    dialogue_tree: npc.dialogue_tree || {}, vendor_inventory: npc.vendor_inventory || [],
    wanders: npc.wanders, flags: npc.flags || {},
  });
  if (result?.error) { toast(result.error, true); return; }
  toast('NPC updated');
  await refreshZoneEditPanel(npc.zone_id);
}
async function deleteNpcQuick(npcId, zoneId) {
  if (!(await dpConfirm('Delete this NPC?', { danger: true }))) return;
  const result = await API(`/npcs/${npcId}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast(result.message || 'NPC deleted');
  await refreshZoneEditPanel(zoneId);
}

// Doors
async function refreshDoorList(zoneId) {
  const doors = await API(`/zones/${encodeURIComponent(zoneId)}/doors`).catch(() => []);
  const list = document.getElementById('zone-doors-list');
  const header = document.querySelector('.zone-subsection-header .zone-subsection-count');
  if (!list) return;

  const countEl = document.getElementById('zone-doors-count');
  if (countEl) countEl.textContent = doors.length;
  list.innerHTML = doors.length ? doors.map(d => {
    const dTags = (d.tags && !Array.isArray(d.tags)) ? d.tags : {};
    const dLockKey = Object.keys(dTags).find(k => k.startsWith('lock:'));
    const lockTag = dLockKey ? { type: dLockKey, ...dTags[dLockKey] } : null;
    const lockLabel = lockTag
      ? (lockTag.type === 'lock:keycardlock'
          ? `keycardlock${d.lock_state === 'locked' ? ' 🔒' : ''}`
          : lockTag.type === 'lock:privacylock'
          ? `privacy${d.lock_state === 'locked' ? ' 🔒' : ''}`
          : `hololock diff:${lockTag.difficulty}${d.lock_state === 'locked' ? ' 🔒' : ''}`)
      : 'no lock';
    const dIdSafe = d.id.replace(/'/g, "\\'");
    return `<div class="zone-subitem-row" id="door-row-${d.id}">
      <span style="display:flex;align-items:center;gap:6px"><strong>${d.name || d.id}</strong> <span style="color:var(--text-dim);font-size:11px">${d.door_type} · ${d.exit_dir||'?'} · ${d.hp}/${d.hp_max}HP · ${lockLabel}</span></span>
      <span class="zone-subitem-actions">
        <button class="action-btn" onclick="openEditDoorDialog('${dIdSafe}','${zoneId}')" style="padding:2px 8px;font-size:11px">Edit</button>
        <button class="action-btn danger" onclick="deleteDoorQuick('${dIdSafe}','${zoneId}')" style="padding:2px 8px;font-size:14px;font-weight:bold">−</button>
      </span>
    </div>`;
  }).join('') : '<div class="zone-subitem-empty">No doors here.</div>';

  // Refresh the exit dropdown to reflect which exits are now used. A door binds
  // to one exit (dir + target); value encodes "dir|targetId". A legacy door with
  // no target_zone occupies its whole direction.
  const exitSelect = document.getElementById('door-exit-select');
  if (exitSelect) {
    const usedExits = new Set(doors.map(d => d.target_zone ? `${d.exit_dir}|${d.target_zone}` : d.exit_dir));
    const availableExits = allExits(zoneEditExitsState).filter(e =>
      !usedExits.has(`${e.dir}|${e.target}`) && !usedExits.has(e.dir));
    exitSelect.innerHTML = availableExits.length
      ? availableExits.map(e => {
          const dest = (typeof allRecords !== 'undefined' ? allRecords : []).find(z => z.id === e.target);
          return `<option value="${e.dir}|${e.target}">${e.dir} → ${dest ? dest.name : e.target}</option>`;
        }).join('')
      : '<option value="">No free exits</option>';
  }
}

async function submitAddDoor(zoneId) {
  const doorType = document.getElementById('door-type-select')?.value;
  const raw = document.getElementById('door-exit-select')?.value;
  if (!raw) { toast('No free exits to install a door on', true); return; }
  const [exitDir, targetZone] = raw.split('|');
  const result = await API('/doors', 'POST', { zone_id: zoneId, exit_dir: exitDir, target_zone: targetZone || null, door_type: doorType });
  if (result?.error) { toast(result.error, true); return; }
  toast('Door installed');
  await refreshDoorList(zoneId);
}
const LOCK_MESSAGES = {
  'lock:hololock': {
    lock: 'The hololock hums as it engages.',
    unlock: 'The hololock disengages with a soft click.',
    denied: "The hololock doesn't recognize your credentials.",
    hackSuccess: 'You bypass the hololock\'s security matrix.',
    hackFail: 'The hololock resists your intrusion.'
  },
  'lock:privacylock': {
    lock: 'You slide the privacy bolt shut.',
    unlock: 'You slide the privacy bolt open.',
    denied: 'The privacy bolt only works from the other side.',
  },
  'lock:keycardlock': {
    lock: 'The keycard reader beeps twice as the lock engages.',
    unlock: 'The keycard reader flashes green. The lock disengages.',
    denied: 'The keycard reader flashes red. Access denied.'
  }
};

const DOOR_TYPE_OPTIONS = [
  { value: 'basic',  label: 'Basic',     hp: 1000 },
  { value: 'shoddy', label: 'Shoddy',    hp: 300  },
  { value: 'blast',  label: 'Blast Door', hp: 5000 },
];

async function openEditDoorDialog(doorId, zoneId) {
  const doors = await API(`/zones/${encodeURIComponent(zoneId)}/doors`).catch(() => []);
  const door = doors.find(d => d.id === doorId);
  if (!door) { toast('Door not found', true); return; }

  const tagObj = (door.tags && !Array.isArray(door.tags)) ? door.tags : {};
  const lockKey = Object.keys(tagObj).find(k => k.startsWith('lock:'));
  const lockTag = lockKey ? { type: lockKey, ...tagObj[lockKey] } : null;
  const curLockType = lockTag?.type || 'none';

  // Privacy-lock side switch: Auto (server picks the bathroom side) or an
  // explicit side (the two zones this door touches).
  const curSide = lockTag?.privacySide || '';
  const sideChoices = [
    { v: '', label: 'Auto — bathroom side' },
    { v: door.zone_id, label: `This side (${door.zone_id})` },
  ];
  if (door.target_zone) sideChoices.push({ v: door.target_zone, label: `Other side (${door.target_zone})` });
  const privSideOpts = sideChoices.map(o => `<option value="${o.v}" ${curSide===o.v?'selected':''}>${o.label}</option>`).join('');

  const typeOpts = DOOR_TYPE_OPTIONS.map(o =>
    `<option value="${o.value}" ${door.door_type === o.value ? 'selected' : ''}>${o.label} (${o.hp} HP)</option>`
  ).join('');

  const lockStateOpts = ['unlocked','locked'].map(s =>
    `<option value="${s}" ${door.lock_state === s ? 'selected' : ''}>${s}</option>`
  ).join('');

  openModal(`Edit Door — ${door.name || door.id}`, `
    <div style="display:flex;flex-direction:column;gap:10px;min-width:320px">
      <div class="field"><label>Name</label><input id="de-name" value="${(door.name || '').replace(/"/g,'&quot;')}" placeholder="${door.id}"></div>
      <div class="field-row">
        <div class="field"><label>Type</label><select id="de-type">${typeOpts}</select></div>
        <div class="field"><label>HP</label><input id="de-hp" type="number" min="1" value="${door.hp}" style="width:80px"></div>
        <div class="field"><label>Max HP</label><input id="de-hpmax" type="number" min="1" value="${door.hp_max}" style="width:80px"></div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:10px">
        <div class="field-row" style="align-items:flex-end;gap:10px">
          <div class="field"><label>Lock Type</label>
            <select id="de-lock-type" onchange="onEditDoorLockTypeChange()">
              <option value="none" ${curLockType==='none'?'selected':''}>None</option>
              <option value="lock:hololock" ${curLockType==='lock:hololock'?'selected':''}>Hololock</option>
              <option value="lock:keycardlock" ${curLockType==='lock:keycardlock'?'selected':''}>Keycard Lock</option>
              <option value="lock:privacylock" ${curLockType==='lock:privacylock'?'selected':''}>Privacy Lock</option>
            </select>
          </div>
          <div class="field" id="de-lock-state-field" style="${curLockType==='none'?'display:none':''}">
            <label>Lock State</label><select id="de-lock-state">${lockStateOpts}</select>
          </div>
        </div>
        <div id="de-hololock-opts" style="${curLockType==='lock:hololock'?'':'display:none'}">
          <div class="field-row" style="margin-top:6px">
            <div class="field"><label>Difficulty (1–20)</label><input id="de-lock-diff" type="number" min="1" max="20" value="${lockTag?.difficulty ?? 5}" style="width:70px"></div>
            <div class="checkbox-field" style="align-self:flex-end;padding-bottom:6px"><input type="checkbox" id="de-lock-hack" ${lockTag?.canHack?'checked':''}><label>Can hack</label></div>
          </div>
        </div>
        <div id="de-keycard-opts" style="${curLockType==='lock:keycardlock'?'':'display:none'}">
          <div class="field" style="margin-top:6px"><label>Key Item ID</label><input id="de-keycard-id" value="${lockTag?.keyItemId||''}" placeholder="e.g. item_voltage_vip_band">
            <div style="color:var(--text-dim);font-size:11px;margin-top:3px">An AUTHORED item that opens this door. Nothing is minted for you — create the item in the Items panel first, then name it here.</div>
          </div>
        </div>
        <div id="de-privacy-opts" style="${curLockType==='lock:privacylock'?'':'display:none'}">
          <div class="field" style="margin-top:6px"><label>Unlockable from (lock side)</label>
            <select id="de-privacy-side">${privSideOpts}</select>
            <div style="color:var(--text-dim);font-size:11px;margin-top:3px">Auto picks the side with a toilet. If neither side is a bathroom, choose a side explicitly.</div>
          </div>
        </div>
      </div>
    </div>
  `);
  document.getElementById('modal-save').onclick = () => saveDoorEdit(doorId, zoneId);
}

function onEditDoorLockTypeChange() {
  const type = document.getElementById('de-lock-type')?.value;
  document.getElementById('de-hololock-opts').style.display = type === 'lock:hololock' ? '' : 'none';
  document.getElementById('de-keycard-opts').style.display = type === 'lock:keycardlock' ? '' : 'none';
  document.getElementById('de-privacy-opts').style.display = type === 'lock:privacylock' ? '' : 'none';
  document.getElementById('de-lock-state-field').style.display = type === 'none' ? 'none' : '';
}

async function saveDoorEdit(doorId, zoneId) {
  const doors = await API(`/zones/${encodeURIComponent(zoneId)}/doors`).catch(() => []);
  const door = doors.find(d => d.id === doorId);
  if (!door) { toast('Door not found', true); return; }

  const name = document.getElementById('de-name').value.trim() || null;
  const door_type = document.getElementById('de-type').value;
  const hp = parseInt(document.getElementById('de-hp').value) || door.hp;
  const hp_max = parseInt(document.getElementById('de-hpmax').value) || door.hp_max;
  const lockType = document.getElementById('de-lock-type').value;

  const existingTagObj = (door.tags && !Array.isArray(door.tags)) ? door.tags : {};
  const tags = Object.fromEntries(Object.entries(existingTagObj).filter(([k]) => !k.startsWith('lock:')));
  let lock_state = null;

  if (lockType !== 'none') {
    const existingLockData = existingTagObj[lockType];
    const lockData = { messages: LOCK_MESSAGES[lockType] || {} };

    if (lockType === 'lock:keycardlock') {
      // No auto-minting (spec §6): a keycardlock reads an AUTHORED item, so the
      // key is a thing somebody made and can be stolen, sold or lost. Cutting one
      // on install manufactured a stray item AND anchored a door id inside it.
      const keyItemId = document.getElementById('de-keycard-id').value.trim() || existingLockData?.keyItemId;
      if (!keyItemId) { toast('A keycard lock needs a key item id — create the item first.', true); return; }
      lockData.keyItemId = keyItemId;
    } else if (lockType === 'lock:privacylock') {
      // Empty = Auto: the server resolves the bathroom side (and rejects the
      // save if neither side qualifies, prompting an explicit pick).
      const side = document.getElementById('de-privacy-side').value;
      if (side) lockData.privacySide = side;
    } else {
      lockData.difficulty = Math.max(1, Math.min(20, parseInt(document.getElementById('de-lock-diff').value) || 5));
      lockData.canHack = document.getElementById('de-lock-hack').checked;
    }

    tags[lockType] = lockData;
    lock_state = document.getElementById('de-lock-state').value;
  }

  const result = await API(`/doors/${doorId}`, 'PUT', { ...door, name, door_type, hp, hp_max, tags, lock_state });
  if (result?.error) { toast(result.error, true); return; }
  toast('Door saved');
  closeModal();
  await refreshDoorList(zoneId);
}

async function deleteDoorQuick(doorId, zoneId) {
  if (!(await dpConfirm('Remove this door?', { danger: true }))) return;
  const result = await API(`/doors/${doorId}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast('Door removed');
  await refreshDoorList(zoneId);
}

async function spawnItemInZone(zoneId) {
  const itemId = document.getElementById('spawn-item-id')?.value?.trim();
  const qty    = parseInt(document.getElementById('spawn-qty')?.value, 10) || 1;
  const fb     = document.getElementById('spawn-feedback');
  if (!itemId) { if (fb) fb.textContent = 'Enter an item_id first.'; return; }
  const r = await API('/spawn', 'POST', { item_id: itemId, zone_id: zoneId, quantity: qty });
  if (r?.error) {
    if (fb) fb.textContent = r.error;
    toast(r.error, true);
  } else {
    if (fb) fb.textContent = `${itemId} ×${qty} spawned in zone.`;
    toast(`Spawned ${itemId} ×${qty}`);
  }
}

// Tag Catalog panel
function openAddFurnitureForm(zoneId) {
  const allFurnitureOptions = (_furnitureAllItems || [])
    .filter(f => f.zone_id !== zoneId)
    .sort((a,b) => (a.name||'').localeCompare(b.name||''))
    .map(f => `<option value="${f.id}">${f.name} (${f.zone_id})</option>`)
    .join('');
  document.getElementById('zone-add-furniture-form').innerHTML = `
    <div class="zone-inline-form">
      <div style="display:flex;gap:12px;margin-bottom:10px">
        <label style="cursor:pointer"><input type="radio" name="nf-mode" value="new" checked onchange="document.getElementById('nf-new-fields').style.display='';document.getElementById('nf-clone-fields').style.display='none'"> Create New</label>
        <label style="cursor:pointer"><input type="radio" name="nf-mode" value="clone" onchange="document.getElementById('nf-new-fields').style.display='none';document.getElementById('nf-clone-fields').style.display=''"> Clone Existing</label>
      </div>
      <div id="nf-new-fields">
        <div class="field"><label>Name</label><input id="nf-name" placeholder="e.g. Bar Counter"></div>
        <div class="field"><label>Description</label><textarea id="nf-description" rows="3"></textarea></div>
      </div>
      <div id="nf-clone-fields" style="display:none">
        <div class="field"><label>Clone from existing furniture</label>
          <select id="nf-clone-source"><option value="">— pick one —</option>${allFurnitureOptions}</select>
        </div>
      </div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick='submitAddFurniture(${JSON.stringify(zoneId)})'>Add</button>
        <button class="action-btn" onclick="document.getElementById('zone-add-furniture-form').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}
async function submitAddFurniture(zoneId) {
  const mode = document.querySelector('input[name="nf-mode"]:checked')?.value || 'new';
  let body;
  if (mode === 'clone') {
    const sourceId = document.getElementById('nf-clone-source')?.value;
    if (!sourceId) { toast('Pick a furniture item to clone', true); return; }
    const source = (_furnitureAllItems || []).find(f => f.id === sourceId);
    if (!source) { toast('Source not found', true); return; }
    const { id: _id, zone_id: _z, ...rest } = source;
    body = { ...rest, zone_id: zoneId };
  } else {
    const name = document.getElementById('nf-name').value.trim();
    const description = document.getElementById('nf-description').value.trim();
    if (!name) { toast('Furniture name is required', true); return; }
    body = { zone_id: zoneId, name, description, flags: {} };
  }
  const result = await API('/furniture', 'POST', body);
  if (result?.error) { toast(result.error, true); return; }
  toast('Furniture staged — publish to apply');
  await updateStagingBadge();
  await refreshZoneEditPanel(zoneId);
}
function openEditFurnitureQuick(itemId) {
  const item = zoneEditFurnitureCache.find(f => f.id === itemId);
  const row = document.getElementById(`furniture-row-${itemId}`);
  if (!item || !row) return;
  row.innerHTML = `
    <div class="zone-inline-form">
      <div class="field"><label>Name</label><input id="ef-name-${item.id}" value="${item.name||''}"></div>
      <div class="field"><label>Description</label><textarea id="ef-description-${item.id}" rows="3">${item.description||''}</textarea></div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick="submitEditFurnitureQuick('${item.id}')">Save</button>
        <button class="action-btn" onclick="refreshZoneEditPanel('${item.zone_id}')">Cancel</button>
      </div>
    </div>`;
}
async function submitEditFurnitureQuick(itemId) {
  const item = zoneEditFurnitureCache.find(f => f.id === itemId);
  if (!item) return;
  const name = document.getElementById(`ef-name-${item.id}`).value.trim();
  const description = document.getElementById(`ef-description-${item.id}`).value.trim();
  const result = await API(`/furniture/${item.id}`, 'PUT', { zone_id: item.zone_id, name, description, flags: item.flags || {} });
  if (result?.error) { toast(result.error, true); return; }
  toast('Furniture updated');
  await refreshZoneEditPanel(item.zone_id);
}
async function deleteFurnitureQuick(furnitureId, zoneId) {
  if (!(await dpConfirm('Delete this furniture?', { danger: true }))) return;
  const result = await API(`/furniture/${furnitureId}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast(result.message || 'Furniture deleted');
  await refreshZoneEditPanel(zoneId);
}

// Windows are no longer a sub-entity. A window is the zone's own `flags.window`,
// edited on the Tags screen with everything else the room is — which is the
// whole point of the move: authoring one used to mean creating an entity, and
// the world had three windows in it. See docs/flags-keys.md.
