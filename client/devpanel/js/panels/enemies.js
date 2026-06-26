function renderEnemyRows(spawns, liveEnemies, zoneId) {
  if (!spawns.length) return '<div class="zone-subitem-empty">No enemies here.</div>';
  return spawns.map(s => {
    const live = liveEnemies.filter(e => e.templateId === s.enemy_id);
    const liveTag = live.length
      ? `<span style="color:var(--accent2);font-size:11px"> · ${live.map(e => `${e.hp}/${e.hp_max}HP`).join(', ')} live</span>`
      : `<span style="color:var(--text-dim);font-size:11px"> · none alive</span>`;
    return `<div class="zone-subitem-row" id="spawn-row-${s.id}">
      <span>${s.enemy_name}${liveTag} <span style="color:var(--text-dim);font-size:11px">· ×${s.max_count} · ${s.respawn_seconds}s respawn</span></span>
      <span class="zone-subitem-actions">
        <button class="action-btn" onclick="openEditEnemyInline('${s.enemy_id}')">Edit</button>
        <button class="action-btn danger" onclick="confirmDeleteSpawn('${s.id}','${zoneId}')">Remove</button>
      </span>
    </div>`;
  }).join('');
}
function openAddSpawnForm(zoneId) {
  const options = zoneEditAllEnemiesCache
    .slice().sort((a,b) => (a.name||'').localeCompare(b.name||''))
    .map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  document.getElementById('zone-add-spawn-form').innerHTML = `
    <div class="zone-inline-form">
      <div class="field"><label>Enemy</label>
        <select id="ns-enemy">${options || '<option value="">— no enemies defined —</option>'}</select>
      </div>
      <div class="field-row" style="gap:8px">
        <div class="field"><label>Max Count</label><input id="ns-max" type="number" value="1" min="1" style="width:70px"></div>
        <div class="field"><label>Respawn (s)</label><input id="ns-respawn" type="number" value="300" min="1" style="width:80px"></div>
      </div>
      <div class="zone-inline-form-actions">
        <button class="action-btn success" onclick='submitAddSpawn(${JSON.stringify(zoneId)})'>Add</button>
        <button class="action-btn" onclick="document.getElementById('zone-add-spawn-form').innerHTML=''">Cancel</button>
      </div>
    </div>`;
}
async function submitAddSpawn(zoneId) {
  const enemy_id = document.getElementById('ns-enemy')?.value;
  if (!enemy_id) { toast('Pick an enemy', true); return; }
  const max_count = parseInt(document.getElementById('ns-max').value) || 1;
  const respawn_seconds = parseInt(document.getElementById('ns-respawn').value) || 300;
  const result = await directAPI('/spawns', 'POST', { zone_id: zoneId, enemy_id, max_count, spawn_weight: 100, respawn_seconds });
  if (result?.error) { toast(result.error, true); return; }
  await directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`, 'POST', { enemy_id });
  document.getElementById('zone-add-spawn-form').innerHTML = '';
  toast('Enemy added');
  await refreshEnemiesSection(zoneId);
}
async function refreshEnemiesSection(zoneId) {
  const [spawnsData, liveData] = await Promise.all([
    API(`/zones/${encodeURIComponent(zoneId)}/spawns`).catch(() => []),
    API(`/zones/${encodeURIComponent(zoneId)}/live-enemies`).catch(() => []),
  ]);
  const spawns = Array.isArray(spawnsData) ? spawnsData : [];
  const live = Array.isArray(liveData) ? liveData : [];
  zoneEditSpawnsCache = spawns;
  const container = document.getElementById('zone-enemies-list');
  if (container) container.innerHTML = renderEnemyRows(spawns, live, zoneId);
  const header = container?.closest('.zone-subsection')?.querySelector('.zone-subsection-count');
  if (header) header.textContent = spawns.length;
}
async function openEditEnemyInline(enemyId) {
  const enemies = await API('/enemies');
  const rec = Array.isArray(enemies) ? enemies.find(e => e.id === enemyId) : null;
  if (!rec) { toast('Enemy not found', true); return; }
  zoneEnemyEditReturn = zoneEditCurrentZoneId;
  currentPanel = 'enemies';
  currentRecord = rec;
  openEdit(rec, false);
}
function confirmDeleteSpawn(spawnId, zoneId) {
  const row = document.getElementById(`spawn-row-${spawnId}`);
  if (!row) return;
  const actions = row.querySelector('.zone-subitem-actions');
  actions.innerHTML = `<span style="color:var(--text-dim);font-size:11px">Sure?</span>
    <button class="action-btn danger" onclick="deleteSpawnQuick('${spawnId}','${zoneId}')">Yes</button>
    <button class="action-btn" onclick="refreshEnemiesSection('${zoneId}')">No</button>`;
}
async function deleteSpawnQuick(spawnId, zoneId) {
  // Despawn all live instances of this template in the zone
  const liveData = await API(`/zones/${encodeURIComponent(zoneId)}/live-enemies`).catch(() => []);
  const live = Array.isArray(liveData) ? liveData : [];
  const spawn = zoneEditSpawnsCache.find(s => s.id === spawnId);
  if (spawn) {
    for (const e of live.filter(e => e.templateId === spawn.enemy_id)) {
      await API(`/live-enemies/${encodeURIComponent(e.instanceId)}`, 'DELETE');
    }
  }
  const result = await directAPI(`/spawns/${encodeURIComponent(spawnId)}`, 'DELETE');
  if (result?.error) { toast(result.error, true); return; }
  toast('Enemy removed');
  await refreshEnemiesSection(zoneId);
}
async function despawnAllEnemies() {
  const result = await API('/live-enemies/despawn-all', 'POST');
  if (result?.error) { toast(result.error, true); return; }
  toast(result.message || 'All enemies despawned');
  if (zoneEditCurrentZoneId) await refreshEnemiesSection(zoneEditCurrentZoneId);
}
async function despawnAllZoneEnemies(zoneId) {
  const liveData = await directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`);
  const live = Array.isArray(liveData) ? liveData : [];
  await Promise.all(live.map(e => directAPI(`/live-enemies/${e.id}`, 'DELETE')));
  toast(`Despawned ${live.length} enem${live.length === 1 ? 'y' : 'ies'}`);
  await refreshEnemiesSection(zoneId);
}
async function respawnAllZoneEnemies(zoneId) {
  const spawnsData = await directAPI(`/zones/${encodeURIComponent(zoneId)}/spawns`);
  const spawns = Array.isArray(spawnsData) ? spawnsData : [];
  const results = await Promise.all(spawns.map(s => directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`, 'POST', { enemy_id: s.enemy_id })));
  const spawned = results.filter(r => !r?.skipped && !r?.error).length;
  toast(`Spawned ${spawned} enem${spawned === 1 ? 'y' : 'ies'}`);
  await refreshEnemiesSection(zoneId);
}
async function deleteAllZoneSpawns(zoneId) {
  if (!confirm('Delete all enemy spawns from this zone? This cannot be undone.')) return;
  const [spawnsData, liveData] = await Promise.all([
    directAPI(`/zones/${encodeURIComponent(zoneId)}/spawns`),
    directAPI(`/zones/${encodeURIComponent(zoneId)}/live-enemies`),
  ]);
  const spawns = Array.isArray(spawnsData) ? spawnsData : [];
  const live = Array.isArray(liveData) ? liveData : [];
  await Promise.all(live.map(e => directAPI(`/live-enemies/${e.id}`, 'DELETE')));
  await Promise.all(spawns.map(s => directAPI(`/spawns/${encodeURIComponent(s.id)}`, 'DELETE')));
  toast(`Deleted ${spawns.length} spawn${spawns.length === 1 ? '' : 's'}`);
  await refreshEnemiesSection(zoneId);
}

// Furniture
let _lootItems = [];
function lootItemOptions(items, selectedId) {
  const opts = items.map(it => `<option value="${it.id}" ${it.id===selectedId?'selected':''}>${it.name} (${it.id})</option>`);
  if (selectedId && !items.some(it => it.id===selectedId)) opts.unshift(`<option value="${selectedId}" selected>${selectedId} (missing!)</option>`);
  return opts.join('');
}
function lootRow(items, entry) {
  const e = entry || {};
  const min = Array.isArray(e.qty) ? e.qty[0] : (e.qty ?? 1);
  const max = Array.isArray(e.qty) ? e.qty[1] : (e.qty ?? 1);
  const sel = e.item || '';
  return `<div class="loot-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:2"><label>Item</label>
      <select class="loot-item">${sel?'':'<option value="">— select item —</option>'}${lootItemOptions(items, sel)}</select>
    </div>
    <div class="field" style="flex:0 0 78px"><label>Chance %</label><input type="number" class="loot-weight" value="${e.weight ?? 100}" min="0" max="100" step="1"></div>
    <div class="field" style="flex:0 0 62px"><label>Qty min</label><input type="number" class="loot-min" value="${min}" min="1" step="1"></div>
    <div class="field" style="flex:0 0 62px"><label>Qty max</label><input type="number" class="loot-max" value="${max}" min="1" step="1"></div>
    <button type="button" class="action-btn" onclick="removeLootRow(this)" style="flex:0 0 auto">×</button>
  </div>`;
}
function addLootRow() {
  document.getElementById('loot-rows').insertAdjacentHTML('beforeend', lootRow(_lootItems, {}));
}
function removeLootRow(btn) { btn.closest('.loot-row').remove(); }

// Damage types shared by weapon components and per-part soak. Mirrors the
// item tag catalog's damage_type options.
const ENEMY_DAMAGE_TYPES = ['kinetic','edged','energy','fire','radiation'];
const ENEMY_BODY_PARTS = ['head','torso','left_arm','right_arm','left_leg','right_leg'];
const DEFAULT_BODY_PART_WEIGHTS = { head:10, torso:40, left_arm:12, right_arm:12, left_leg:13, right_leg:13 };

// --- Enemy weapon (typed multi-component damage) ---
function weaponRow(comp) {
  const c = comp || {};
  const type = c.type || 'kinetic';
  return `<div class="weapon-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:2"><label>Type</label>
      <select class="wpn-type">${ENEMY_DAMAGE_TYPES.map(t=>`<option ${t===type?'selected':''}>${t}</option>`).join('')}</select>
    </div>
    <div class="field" style="flex:0 0 62px"><label>Min</label><input type="number" class="wpn-min" value="${c.min ?? 1}" min="0" step="1"></div>
    <div class="field" style="flex:0 0 62px"><label>Max</label><input type="number" class="wpn-max" value="${c.max ?? 2}" min="0" step="1"></div>
    <button type="button" class="action-btn" onclick="removeWeaponRow(this)" style="flex:0 0 auto">×</button>
  </div>`;
}
function addWeaponRow() {
  document.getElementById('weapon-rows').insertAdjacentHTML('beforeend', weaponRow({}));
}
function removeWeaponRow(btn) { btn.closest('.weapon-row').remove(); }

// --- Enemy body parts (hit % + per-part typed soak) ---
function bodyPartRow(entry) {
  const e = entry || {};
  const part = e.part || 'torso';
  const soak = (e.soak && typeof e.soak === 'object') ? e.soak : {};
  return `<div class="bodypart-row field-row" style="align-items:flex-end;gap:6px">
    <div class="field" style="flex:0 0 110px"><label>Part</label>
      <select class="bp-part">${ENEMY_BODY_PARTS.map(p=>`<option ${p===part?'selected':''}>${p}</option>`).join('')}</select>
    </div>
    <div class="field" style="flex:0 0 70px"><label>Hit %</label><input type="number" class="bp-weight" value="${e.weight ?? 10}" min="0" step="1"></div>
    <div class="field" style="flex:2"><label>Soak (JSON, e.g. {"kinetic":3})</label><input class="bp-soak" value='${JSON.stringify(soak)}'></div>
    <button type="button" class="action-btn" onclick="removeBodyPartRow(this)" style="flex:0 0 auto">×</button>
  </div>`;
}
function addBodyPartRow() {
  document.getElementById('bodypart-rows').insertAdjacentHTML('beforeend', bodyPartRow({}));
}
function removeBodyPartRow(btn) { btn.closest('.bodypart-row').remove(); }
// Standard hit-location spread, with empty soak — the default for a new monster.
function defaultBodyParts() {
  return ENEMY_BODY_PARTS.map(p => ({ part: p, weight: DEFAULT_BODY_PART_WEIGHTS[p], soak: {} }));
}

function lootItemList(published) {
  // Mirror the loadPanel staging overlay so unpublished items are selectable too.
  let items = Array.isArray(published) ? published.slice() : [];
  if (stagingEnabled && pendingChanges.length) {
    const staged = pendingChanges.filter(c => c.entityType === 'item');
    const stagedById = new Map(staged.map(c => [c.entityId, c]));
    items = items.flatMap(r => {
      const s = stagedById.get(r.id);
      if (s?.changeType === 'delete') return [];
      if (s?.changeType === 'update') return [{ ...r, ...s.stagedData }];
      return [r];
    });
    for (const s of staged) {
      if (s.changeType === 'create' && !items.some(r => r.id === s.entityId)) {
        items.push({ ...s.stagedData, id: s.entityId });
      }
    }
  }
  return items.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
}

async function enemyEditForm(rec, isNew) {
  _lootItems = lootItemList(await API('/items'));
  const loot = Array.isArray(rec.loot_table) ? rec.loot_table : JSON.parse(rec.loot_table||'[]');
  let weapon = Array.isArray(rec.weapon) ? rec.weapon : JSON.parse(rec.weapon||'[]');
  if (!weapon.length) weapon = [{ type:'kinetic', min:1, max:2 }];
  let bodyParts = Array.isArray(rec.body_parts) ? rec.body_parts : JSON.parse(rec.body_parts||'[]');
  if (!bodyParts.length) bodyParts = defaultBodyParts();
  return `
    <div class="field"><label>Enemy ID</label><input id="f-id" value="${isNew?'':rec.id}" ${!isNew?'readonly style="opacity:0.5"':''}></div>
    <div class="field"><label>Name</label><input id="f-name" value="${rec.name||''}"></div>
    <div class="field"><label>Description</label><textarea id="f-description">${rec.description||''}</textarea></div>
    <div class="field"><label>Death Message</label><textarea id="f-death_message" rows="2">${rec.death_message||''}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Behavior</label>
        <select id="f-behavior">
          ${['aggressive','territorial','patrol','defensive','passive'].map(b=>`<option ${rec.behavior===b?'selected':''}>${b}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Faction</label><input id="f-faction" value="${rec.faction||''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Hit (attack rating)</label><input type="number" id="f-hit" value="${rec.hit ?? 1}" min="0"></div>
      <div class="field"><label>Dodge (defense rating)</label><input type="number" id="f-dodge" value="${rec.dodge ?? 1}" min="0"></div>
      <div class="field"><label>HP Max</label><input type="number" id="f-hp_max" value="${rec.hp_max||30}"></div>
    </div>
    <div class="field"><label>Weapon — typed damage components (e.g. 1-2 kinetic + 2-3 energy)</label>
      <div id="weapon-rows">${weapon.map(c=>weaponRow(c)).join('')}</div>
      <button type="button" class="action-btn" onclick="addWeaponRow()" style="margin-top:6px">+ Add Damage Type</button>
    </div>
    <div class="field"><label>Body Parts — hit % and per-part soak (defaults to the standard spread)</label>
      <div id="bodypart-rows">${bodyParts.map(e=>bodyPartRow(e)).join('')}</div>
      <button type="button" class="action-btn" onclick="addBodyPartRow()" style="margin-top:6px">+ Add Body Part</button>
    </div>
    <div class="field"><label>Loot Drops</label>
      <div id="loot-rows">${loot.map(e=>lootRow(_lootItems, e)).join('')}</div>
      <button type="button" class="action-btn" onclick="addLootRow()" style="margin-top:6px">+ Add Drop</button>
    </div>
    <div class="field"><label>First Strike Delay (ms) — hesitation before its first attack after aggroing. 0 = attacks immediately.</label><input type="number" id="f-first_strike_delay_ms" value="${rec.flags?.first_strike_delay_ms||0}" min="0" step="500"></div>
    <div class="field"><label>Battle Cries (one per line) — shown on its first strike</label><textarea id="f-battle_cries" rows="3">${(rec.flags?.battle_cries||[]).join('\n')}</textarea></div>
  `;
}

// --- Mutation forms ---
async function saveEnemy(existing) {
  const isNew = !existing?.id;
  const loot = [];
  for (const row of document.querySelectorAll('#loot-rows .loot-row')) {
    const item = row.querySelector('.loot-item').value;
    if (!item) continue;
    const weight = +row.querySelector('.loot-weight').value || 0;
    let min = +row.querySelector('.loot-min').value || 1;
    let max = +row.querySelector('.loot-max').value || 1;
    if (min < 1) min = 1;
    if (max < min) max = min;
    loot.push({ item, weight, qty: [min, max] });
  }
  const weapon = [];
  for (const row of document.querySelectorAll('#weapon-rows .weapon-row')) {
    const type = row.querySelector('.wpn-type').value;
    let min = +row.querySelector('.wpn-min').value || 0;
    let max = +row.querySelector('.wpn-max').value || 0;
    if (max < min) max = min;
    weapon.push({ type, min, max });
  }
  const body_parts = [];
  for (const row of document.querySelectorAll('#bodypart-rows .bodypart-row')) {
    const part = row.querySelector('.bp-part').value;
    const weight = +row.querySelector('.bp-weight').value || 0;
    let soak;
    try { soak = JSON.parse(row.querySelector('.bp-soak').value || '{}'); }
    catch { return { error: `Body part ${part}: soak is invalid JSON` }; }
    body_parts.push({ part, weight, soak });
  }
  const existingFlags = existing?.flags || {};
  const cries = document.getElementById('f-battle_cries').value.split('\n').map(s=>s.trim()).filter(Boolean);
  const flags = { ...existingFlags, first_strike_delay_ms: +document.getElementById('f-first_strike_delay_ms').value || 0, battle_cries: cries };
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-description').value,
    death_message: document.getElementById('f-death_message').value,
    behavior: document.getElementById('f-behavior').value,
    faction: document.getElementById('f-faction').value || null,
    hit: +document.getElementById('f-hit').value || 0,
    dodge: +document.getElementById('f-dodge').value || 0,
    hp_max: +document.getElementById('f-hp_max').value,
    weapon,
    body_parts,
    loot_table: loot,
    flags,
  };
  if (isNew) { body.id = document.getElementById('f-id').value.trim(); return API('/enemies', 'POST', body); }
  return API(`/enemies/${existing.id}`, 'PUT', body);
}

// --- Item forms (tag-driven; the catalog is the single source of truth) ---
