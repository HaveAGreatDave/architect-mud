// VINE Suite — one launcher for a tabbed, multi-editor workspace covering every
// VINE-authored graph in the game (dialogue, NPC/enemy behaviour, script,
// broadcast, quest). Each schema is a colour-coded tab; every tab keeps its own
// live editor so switching between them loses nothing. Assets are opened/created
// through a compact picker popup, and cross-references (e.g. a dialogue node's
// quest action) hop straight into the matching tab. No new storage: each category
// reads and writes the same field its owning panel does.

let _vineSuiteData = { npcs: [], enemies: [], scripts: [], quests: [], broadcasts: [] };

function _vsParse(g) {
  if (!g) return null;
  if (typeof g === 'string') { try { return JSON.parse(g); } catch { return null; } }
  return g;
}
function _vsNodeCount(raw) {
  const g = _vsParse(raw);
  return g && g.nodes ? Object.keys(g.nodes).length : 0;
}

// Category registry. `source` keys into _vineSuiteData; `field` is the graph column
// (null for quests, derived from objectives[]/rewards{}). `entity: true` marks a
// graph that attaches to an existing record (NPC/enemy) — no standalone "New".
// `create` (standalone types only) POSTs a blank asset and returns the new record.
const VINE_SUITE = {
  dialogue: {
    label: 'NPC Dialogue', icon: '💬', color: '#4477aa', source: 'npcs', field: 'dialogue_tree', entity: true,
    schema: () => VineDialogueSchema,
    toGraph: (rec) => VineDialogueSchema.fromDialogueTree(_vsParse(rec.dialogue_tree) || {}),
    save: (id, g) => directAPI(`/npcs/${id}/graph`, 'PATCH', { field: 'dialogue_tree', graph: VineDialogueSchema.toDialogueTree(g) }),
    badge: (rec) => _vsNodeCount(rec.dialogue_tree),
  },
  aiNpc: {
    label: 'NPC Behaviour', icon: '🧠', color: '#886622', source: 'npcs', field: 'behaviour_graph', entity: true,
    schema: () => VineAISchema,
    toGraph: (rec) => VineAISchema.fromAiGraph(_vsParse(rec.behaviour_graph) || {}),
    save: (id, g) => directAPI(`/npcs/${id}/graph`, 'PATCH', { field: 'behaviour_graph', graph: VineAISchema.toAiGraph(g) }),
    badge: (rec) => _vsNodeCount(rec.behaviour_graph),
  },
  aiEnemy: {
    label: 'Enemy Behaviour', icon: '👾', color: '#aa4422', source: 'enemies', field: 'behaviour_graph', entity: true,
    schema: () => VineAISchema,
    toGraph: (rec) => VineAISchema.fromAiGraph(_vsParse(rec.behaviour_graph) || {}),
    save: (id, g) => directAPI(`/enemies/${id}/graph`, 'PATCH', { field: 'behaviour_graph', graph: VineAISchema.toAiGraph(g) }),
    badge: (rec) => _vsNodeCount(rec.behaviour_graph),
  },
  script: {
    label: 'Scripts', icon: '⎇', color: '#4455aa', source: 'scripts', field: 'graph',
    schema: () => VineScriptSchema,
    toGraph: (rec) => VineScriptSchema.fromScriptGraph(_vsParse(rec.graph) || {}),
    save: (id, g, rec) => API(`/scripts/${id}`, 'PUT', { name: rec.name, description: rec.description || '', graph: VineScriptSchema.toScriptGraph(g) }),
    badge: (rec) => _vsNodeCount(rec.graph),
    create: async () => {
      const id = (prompt('New script ID (e.g. script_intro):') || '').trim();
      if (!id) return null;
      const res = await API('/scripts', 'POST', { id, name: id, description: '', graph: { start: '', nodes: {} } });
      if (res && res.error) { toast(res.error, true); return null; }
      return { id, name: id, description: '', graph: { start: '', nodes: {} } };
    },
  },
  broadcast: {
    label: 'Broadcasts', icon: '📺', color: '#226644', source: 'broadcasts', field: 'broadcast_graph',
    schema: () => VineBroadcastSchema,
    toGraph: (rec) => VineBroadcastSchema.fromBroadcastGraph(_vsParse(rec.broadcast_graph) || {}),
    save: (id, g) => directAPI(`/broadcasts/${id}/graph`, 'PATCH', { field: 'broadcast_graph', graph: VineBroadcastSchema.toBroadcastGraph(g) }),
    badge: (rec) => _vsNodeCount(rec.broadcast_graph),
    create: async () => {
      const name = (prompt('New broadcast name:') || '').trim();
      if (!name) return null;
      const body = { name, category: 'general', playback_mode: 'scripted', message_interval: 5, override_duration: null, loop: 0, enabled: 1, messages: [], broadcast_graph: null, channel_id: null };
      const res = await directAPI('/broadcast/broadcasts', 'POST', body);
      if (!res || res.error) { toast((res && res.error) || 'Create failed', true); return null; }
      return { ...body, id: res.id || res.broadcast?.id };
    },
  },
  quest: {
    label: 'Quests', icon: '❗', color: '#a04488', source: 'quests', field: null,
    schema: () => VineQuestSchema,
    toGraph: (rec) => VineQuestSchema.fromQuest(rec),
    save: (id, g) => API(`/quests/${id}`, 'PUT', VineQuestSchema.toQuest(g)),
    badge: (rec) => (Array.isArray(rec.objectives) ? rec.objectives : _vsParse(rec.objectives) || []).length,
    create: async () => {
      const id = (prompt('New quest ID (e.g. quest_pest_control):') || '').trim();
      if (!id) return null;
      const body = { id, name: id, description: '', repeatable: false, objectives: [], rewards: {} };
      const res = await API('/quests', 'POST', body);
      if (res && res.error) { toast(res.error, true); return null; }
      return body;
    },
  },
};

const _VS_ORDER = ['dialogue', 'aiNpc', 'aiEnemy', 'script', 'broadcast', 'quest'];

// ── Data fetch ───────────────────────────────────────────────────────────────
async function fetchVineSuite() {
  const [npcs, enemies, scripts, quests, broadcasts] = await Promise.all([
    directAPI('/npcs'), directAPI('/enemies'), API('/scripts'), API('/quests'), directAPI('/broadcast/broadcasts'),
  ]);
  return {
    npcs: Array.isArray(npcs) ? npcs : [],
    enemies: Array.isArray(enemies) ? enemies : [],
    scripts: Array.isArray(scripts) ? scripts : [],
    quests: Array.isArray(quests) ? quests : [],
    broadcasts: Array.isArray(broadcasts) ? broadcasts : [],
  };
}
function _vsRec(cat, id) {
  return (_vineSuiteData[cat.source] || []).find(r => String(r.id) === String(id));
}

// ── Launch screen (the `vine` panel) ─────────────────────────────────────────
function renderVineSuite(data) {
  _vineSuiteData = data || _vineSuiteData;
  const chips = _VS_ORDER.map(key => {
    const cat = VINE_SUITE[key];
    const recs = _vineSuiteData[cat.source] || [];
    const withGraphs = recs.filter(r => cat.badge(r)).length;
    return `
      <button onclick="vineWorkspaceOpen('${key}')"
        style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;padding:12px 14px;background:var(--bg2);
               border:1px solid var(--border);border-left:4px solid ${cat.color};border-radius:4px;cursor:pointer;min-width:150px;flex:1">
        <span style="font-size:18px">${cat.icon}</span>
        <span style="font-weight:bold;color:${cat.color};font-size:13px">VINE<span style="text-transform:capitalize">${key === 'aiNpc' ? 'NPC' : key === 'aiEnemy' ? 'Enemy' : key}</span></span>
        <span style="color:var(--text-dim);font-size:11px">${cat.label}</span>
        <span style="color:var(--text-dim);font-size:11px">${withGraphs}/${recs.length} with graphs</span>
      </button>`;
  }).join('');

  document.getElementById('list-panel').innerHTML = `
    <div style="padding:8px 2px 14px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <button class="action-btn success" style="font-size:14px;padding:10px 18px" onclick="vineWorkspaceOpen()">🌿 Launch VINE Suite</button>
        <div style="color:var(--text-dim);font-size:12px;flex:1;min-width:240px">
          One workspace, every graph. Open any editor as a colour-coded tab; each keeps its own live editor so you can hop
          between dialogue, behaviour, quests and more without losing your place. Cross-references jump you straight to the target.
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${chips}</div>
    </div>`;
}

// ── Workspace ────────────────────────────────────────────────────────────────
// Per-tab live state: key -> { editor, container, recId, rec }.
let _vwTabs = {};
let _vwActive = null;
let _vwOpen = false;
let _vwTabbarBuilt = false;

async function vineWorkspaceOpen(startKey) {
  _vineSuiteData = await fetchVineSuite();
  if (!_vwTabbarBuilt) _vsBuildTabbar();
  document.getElementById('vine-workspace').style.display = 'flex';
  _vwOpen = true;
  _vsActivateTab(startKey || _vwActive || 'dialogue');
}

function vineWorkspaceClose() {
  document.getElementById('vine-workspace').style.display = 'none';
  vsClosePicker();
  _vwOpen = false;
}

function _vsBuildTabbar() {
  const bar = document.getElementById('vw-tabbar');
  bar.innerHTML = _VS_ORDER.map(key => {
    const cat = VINE_SUITE[key];
    return `<button data-vw-tab="${key}" onclick="_vsActivateTab('${key}')"
      style="display:flex;gap:6px;align-items:center;padding:8px 14px;background:none;border:none;border-bottom:3px solid transparent;
             color:var(--text-dim);cursor:pointer;font-family:var(--font);font-size:12px;white-space:nowrap">
      <span>${cat.icon}</span><span>${cat.label}</span></button>`;
  }).join('');
  _vwTabbarBuilt = true;
}

function _vsEnsureTab(key) {
  let tab = _vwTabs[key];
  if (tab && tab.editor) return tab;
  const body = document.getElementById('vw-body');
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;inset:0;display:none';
  body.appendChild(container);
  const editor = new VineEditor(container, VINE_SUITE[key].schema());
  editor.load({ nodes: {}, edges: [] });
  tab = _vwTabs[key] = { editor, container, recId: null, rec: null };
  return tab;
}

function _vsActivateTab(key) {
  const cat = VINE_SUITE[key];
  if (!cat) return;
  _vwActive = key;
  const tab = _vsEnsureTab(key);

  // Show only this tab's editor container.
  for (const k of Object.keys(_vwTabs)) {
    _vwTabs[k].container.style.display = k === key ? 'flex' : 'none';
  }
  // Tab bar highlight.
  document.querySelectorAll('#vw-tabbar [data-vw-tab]').forEach(btn => {
    const on = btn.dataset.vwTab === key;
    btn.style.borderBottomColor = on ? cat.color : 'transparent';
    btn.style.color = on ? cat.color : 'var(--text-dim)';
    btn.style.background = on ? 'var(--bg3)' : 'none';
    btn.style.fontWeight = on ? 'bold' : 'normal';
  });
  // Toolbar identity + title.
  document.getElementById('vw-icon').textContent = cat.icon;
  document.getElementById('vw-toolbar').style.borderLeft = `4px solid ${cat.color}`;
  _vsUpdateTitle();

  // Nothing open in this tab yet → prompt the new/import picker.
  if (!tab.recId) vsOpenPicker(key);
}

function _vsUpdateTitle() {
  const tab = _vwTabs[_vwActive];
  const cat = VINE_SUITE[_vwActive];
  const el = document.getElementById('vw-title');
  el.style.color = cat.color;
  el.textContent = tab && tab.recId ? `${cat.label}: ${tab.rec?.name || tab.recId}` : `${cat.label} — no asset open`;
}

function vsLoadAsset(key, id) {
  const cat = VINE_SUITE[key];
  const rec = _vsRec(cat, id);
  if (!rec) return toast('Record not found — try reloading the Suite.', true);
  if (_vwActive !== key) _vsActivateTab(key);
  const tab = _vsEnsureTab(key);
  tab.recId = id;
  tab.rec = rec;
  tab.editor.load(cat.toGraph(rec));
  _vsUpdateTitle();
  vsClosePicker();
}

async function vsSaveActive() {
  const key = _vwActive;
  const cat = VINE_SUITE[key];
  const tab = _vwTabs[key];
  if (!tab || !tab.recId) return toast('Open an asset first.', true);
  const res = await cat.save(tab.recId, tab.editor.save(), tab.rec);
  if (res && res.error) return toast(res.error, true);
  toast(`${cat.label} saved.`);
}

function vsImportJSON() {
  const tab = _vwTabs[_vwActive];
  if (!tab || !tab.recId) return toast('Open an asset first.', true);
  openModal('Load JSON into VINE', `
    <div class="field"><label>Paste graph JSON</label>
      <textarea id="vw-import-json" style="width:100%;height:300px;font-family:monospace;font-size:11px" placeholder='{"nodes":{},"edges":[]}'></textarea>
    </div>`);
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = 'Load';
  saveBtn.onclick = () => {
    try {
      const graph = JSON.parse(document.getElementById('vw-import-json').value.trim());
      tab.editor.load(graph);
      closeModal();
    } catch (e) { toast('Invalid JSON: ' + e.message, true); }
  };
}

// ── Picker popup (new / import / open) ───────────────────────────────────────
let _vpKey = null;

function vsOpenPicker(key) {
  _vpKey = key || _vwActive;
  const cat = VINE_SUITE[_vpKey];
  document.getElementById('vp-head').style.borderLeft = `4px solid ${cat.color}`;
  document.getElementById('vp-icon').textContent = cat.icon;
  const titleEl = document.getElementById('vp-title');
  titleEl.textContent = `Open ${cat.label}`;
  titleEl.style.color = cat.color;
  const newBtn = document.getElementById('vp-new');
  if (cat.create) {
    newBtn.style.display = '';
    newBtn.textContent = `＋ New ${cat.label}`;
  } else {
    // Entity-bound graph — attaches to an existing record, can't be created here.
    newBtn.style.display = 'none';
  }
  document.getElementById('vp-search').value = '';
  vsRenderPickerList();
  document.getElementById('vine-picker').style.display = 'flex';
  setTimeout(() => document.getElementById('vp-search').focus(), 0);
}

function vsClosePicker() {
  document.getElementById('vine-picker').style.display = 'none';
}

function vsRenderPickerList() {
  const cat = VINE_SUITE[_vpKey];
  const q = (document.getElementById('vp-search').value || '').toLowerCase();
  const recs = (_vineSuiteData[cat.source] || [])
    .filter(r => !q || String(r.name || '').toLowerCase().includes(q) || String(r.id).toLowerCase().includes(q))
    .slice()
    .sort((a, b) => (cat.badge(b) - cat.badge(a)) || String(a.name || a.id).localeCompare(String(b.name || b.id)));
  const rows = recs.map(rec => {
    const n = cat.badge(rec);
    const badge = n
      ? `<span style="color:${cat.color};font-size:11px;white-space:nowrap">● ${n}</span>`
      : `<span style="color:var(--text-dim);font-size:11px">—</span>`;
    return `<div onclick="vsLoadAsset('${_vpKey}','${_vsEsc(rec.id)}')"
      style="display:flex;gap:8px;align-items:center;padding:6px 12px;cursor:pointer;border-bottom:1px solid var(--border)"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='none'">
      <span style="flex:1;font-size:12px;color:var(--text-bright)">${_vsEsc(rec.name || '(unnamed)')}</span>
      <code style="font-size:10px;color:var(--text-dim)">${_vsEsc(rec.id)}</code>
      ${badge}
    </div>`;
  }).join('') || `<div style="padding:16px 12px;color:var(--text-dim);font-size:12px">${cat.entity ? 'No records — create the NPC/enemy in its own panel first.' : 'None yet — use New above.'}</div>`;
  document.getElementById('vp-list').innerHTML = rows;
}

async function vsNewAsset() {
  const cat = VINE_SUITE[_vpKey];
  if (!cat.create) return;
  const rec = await cat.create();
  if (!rec) return;
  _vineSuiteData[cat.source].push(rec);
  const key = _vpKey;
  vsLoadAsset(key, rec.id);
}

function _vsEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Cross-editor jump: dialogue/other node → the referenced quest ────────────
// Inside the workspace, hop live into the Quest tab (no save prompt — the source
// tab keeps its own live editor untouched). Outside the workspace (e.g. editing a
// dialogue tree straight from the NPC panel's single modal), fall back to the
// commit-then-open-in-modal flow so no edits are lost.
async function vineJumpToQuest(questId) {
  if (!questId) return;

  if (_vwOpen) {
    if (!_vsRec(VINE_SUITE.quest, questId)) {
      const quests = await API('/quests');
      if (Array.isArray(quests)) _vineSuiteData.quests = quests;
    }
    if (!_vsRec(VINE_SUITE.quest, questId)) {
      if (!confirm(`Quest "${questId}" doesn't exist yet. Create a stub and open it?`)) return;
      const body = { id: questId, name: questId, description: '', repeatable: false, objectives: [], rewards: {} };
      const res = await API('/quests', 'POST', body);
      if (res && res.error) return toast(res.error, true);
      _vineSuiteData.quests.push(body);
    }
    vsLoadAsset('quest', questId);
    return;
  }

  // Standalone-modal path (unchanged behaviour).
  if (!confirm(`Save the current graph and open quest "${questId}" in VINE?`)) return;
  vineModalSave();
  const quests = await directAPI('/quests');
  const rec = Array.isArray(quests) ? quests.find(q => q.id === questId) : null;
  if (!rec) return toast(`Quest '${questId}' not found — create it in the Quests panel first.`, true);
  vineModalOpen(
    `Quest: ${rec.name || questId}`,
    VineQuestSchema,
    VineQuestSchema.fromQuest(rec),
    async (saved) => {
      const res = await API(`/quests/${questId}`, 'PUT', VineQuestSchema.toQuest(saved));
      if (res && res.error) return toast(res.error, true);
      toast(`Quest '${rec.name || questId}' saved.`);
    }
  );
}
