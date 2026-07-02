// VINE Suite — a single cross-cutting INDEX of every VINE-authored graph in the game
// (dialogue, NPC/enemy behaviour, script, quest). It owns no editor of its own:
// clicking an asset jumps to the owning panel and opens that record's REAL per-panel
// VINE editor (npcOpenVine, enemyOpenVineAI, …). Cross-editor references
// (dialogue→quest/script, AI→quest, quest→dialogue) hop between the standalone editors
// via vineJumpTo without navigating away. No storage of its own — every category reads
// and writes the same field its owning panel does.

let _vineSuiteData = { npcs: [], enemies: [], scripts: [], quests: [] };

function _vsParse(g) {
  if (!g) return null;
  if (typeof g === 'string') { try { return JSON.parse(g); } catch { return null; } }
  return g;
}
function _vsNodeCount(raw) {
  const g = _vsParse(raw);
  return g && g.nodes ? Object.keys(g.nodes).length : 0;
}
function _vsEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Category registry. Index fields (label/icon/color/source/badge/panel/opener) drive
// the index list + the jump-to-owning-panel navigator. Cross-jump fields
// (noun/schema/listRoute/toGraph/save[/createStub]) power vineJumpTo — opening a
// referenced asset in the standalone modal, saved straight to the DB, without leaving
// the editor you jumped from. Kinds nobody references (aiNpc/aiEnemy) carry index
// fields only.
const VINE_KINDS = {
  dialogue: {
    label: 'NPC Dialogue', icon: '💬', color: '#4477aa', source: 'npcs', panel: 'npcs', opener: 'npcOpenVine',
    badge: (r) => _vsNodeCount(r.dialogue_tree),
    noun: 'Dialogue',
    schema: () => VineDialogueSchema,
    listRoute: () => directAPI('/npcs'),
    toGraph: (r) => VineDialogueSchema.fromDialogueTree(_vsParse(r.dialogue_tree) || {}),
    save: (id, g) => directAPI(`/npcs/${id}/graph`, 'PATCH', { field: 'dialogue_tree', graph: VineDialogueSchema.toDialogueTree(g) }),
  },
  aiNpc: {
    label: 'NPC Behaviour', icon: '🧠', color: '#886622', source: 'npcs', panel: 'npcs', opener: 'npcOpenVineAI',
    badge: (r) => _vsNodeCount(r.behaviour_graph),
  },
  aiEnemy: {
    label: 'Enemy Behaviour', icon: '👾', color: '#aa4422', source: 'enemies', panel: 'enemies', opener: 'enemyOpenVineAI',
    badge: (r) => _vsNodeCount(r.behaviour_graph),
  },
  script: {
    label: 'Scripts', icon: '⎇', color: '#4455aa', source: 'scripts', panel: 'scripts', opener: 'scriptsOpenVine',
    badge: (r) => _vsNodeCount(r.graph),
    noun: 'Script',
    schema: () => VineScriptSchema,
    listRoute: () => API('/scripts'),
    toGraph: (r) => VineScriptSchema.fromScriptGraph(_vsParse(r.graph) || {}),
    save: (id, g, rec) => API(`/scripts/${id}`, 'PUT', { name: rec.name, description: rec.description || '', graph: VineScriptSchema.toScriptGraph(g) }),
  },
  quest: {
    label: 'Quests', icon: '❗', color: '#a04488', source: 'quests', panel: 'quests', opener: 'questsOpenVine',
    badge: (r) => (Array.isArray(r.objectives) ? r.objectives : _vsParse(r.objectives) || []).length,
    noun: 'Quest',
    schema: () => VineQuestSchema,
    listRoute: () => API('/quests'),
    toGraph: (r) => VineQuestSchema.fromQuest(r),
    save: (id, g) => API(`/quests/${id}`, 'PUT', VineQuestSchema.toQuest(g)),
    createStub: async (id) => {
      const body = { id, name: id, description: '', repeatable: false, objectives: [], rewards: {} };
      const res = await API('/quests', 'POST', body);
      if (res && res.error) { toast(res.error, true); return null; }
      return body;
    },
  },
};

const _VS_ORDER = ['dialogue', 'aiNpc', 'aiEnemy', 'script', 'quest'];

// ── Data fetch ───────────────────────────────────────────────────────────────
async function fetchVineSuite() {
  const [npcs, enemies, scripts, quests] = await Promise.all([
    directAPI('/npcs'), directAPI('/enemies'), API('/scripts'), API('/quests'),
  ]);
  return {
    npcs: Array.isArray(npcs) ? npcs : [],
    enemies: Array.isArray(enemies) ? enemies : [],
    scripts: Array.isArray(scripts) ? scripts : [],
    quests: Array.isArray(quests) ? quests : [],
  };
}

// ── Index (the `vine` panel) ─────────────────────────────────────────────────
function renderVineSuite(data) {
  _vineSuiteData = data || _vineSuiteData;
  document.getElementById('list-panel').innerHTML = `
    <div style="padding:6px 2px 14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <input id="vine-index-search" placeholder="Filter every graph…" oninput="vsRenderIndex()"
          style="flex:1;min-width:220px;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:6px 10px;border-radius:3px">
        <div style="color:var(--text-dim);font-size:11px;flex:1;min-width:220px">
          Click any graph to open it in its own editor — you land on the owning panel with the record open.
          Cross-references (dialogue→quest, AI→quest, …) jump straight between editors.
        </div>
      </div>
      <div id="vine-index-body"></div>
    </div>`;
  vsRenderIndex();
}

function vsRenderIndex() {
  const q = (document.getElementById('vine-index-search')?.value || '').toLowerCase();
  const body = document.getElementById('vine-index-body');
  if (!body) return;
  body.innerHTML = _VS_ORDER.map(kind => {
    const cat = VINE_KINDS[kind];
    const all = _vineSuiteData[cat.source] || [];
    const recs = all
      .filter(r => !q || String(r.name || '').toLowerCase().includes(q) || String(r.id).toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (cat.badge(b) - cat.badge(a)) || String(a.name || a.id).localeCompare(String(b.name || b.id)));
    if (q && !recs.length) return '';
    const withGraphs = all.filter(r => cat.badge(r)).length;

    const rows = recs.map(rec => {
      const n = cat.badge(rec);
      const badge = n
        ? `<span style="color:${cat.color};font-size:11px;white-space:nowrap">● ${n}</span>`
        : `<span style="color:var(--text-dim);font-size:11px">—</span>`;
      return `<div onclick="vineOpenAsset('${kind}','${_vsEsc(rec.id)}')"
        style="display:flex;gap:8px;align-items:center;padding:5px 12px;cursor:pointer;border-bottom:1px solid var(--border)"
        onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='none'">
        <span style="flex:1;font-size:12px;color:var(--text-bright)">${_vsEsc(rec.name || '(unnamed)')}</span>
        <code style="font-size:10px;color:var(--text-dim)">${_vsEsc(rec.id)}</code>
        ${badge}
      </div>`;
    }).join('') || `<div style="padding:10px 12px;color:var(--text-dim);font-size:11px">None yet.</div>`;

    return `
      <div style="margin-bottom:14px;border:1px solid var(--border);border-left:3px solid ${cat.color};border-radius:4px;overflow:hidden">
        <div style="display:flex;gap:8px;align-items:center;padding:7px 12px;background:var(--bg2)">
          <span style="font-size:15px">${cat.icon}</span>
          <span style="font-weight:bold;color:${cat.color};font-size:12px">${cat.label}</span>
          <span style="color:var(--text-dim);font-size:11px;margin-left:auto">${withGraphs}/${all.length} with graphs</span>
        </div>
        ${rows}
      </div>`;
  }).join('');
}

// ── Navigator: open an asset in its owning panel's real editor ────────────────
// Switch to the owning panel, load it, open the record's edit form, then fire that
// panel's own VINE button (which reads the now-open form / its module state).
async function vineOpenAsset(kind, id) {
  const cat = VINE_KINDS[kind];
  if (!cat) return;
  activatePanelNav(cat.panel);
  currentPanel = cat.panel;
  await loadPanel(cat.panel);
  currentRecord = allRecords.find(r => String(r.id) === String(id));
  if (!currentRecord) return toast('Record not found — it may have been deleted.', true);
  await openEdit(currentRecord, false);
  const opener = window[cat.opener];
  if (typeof opener === 'function') opener();
}

// ── Cross-editor jump: open a referenced asset in the standalone modal ─────────
// Fired from inside an open editor (an action referencing a quest/script, a quest's
// "offered by" NPC). Commits the current graph back to its form so nothing is lost,
// then opens the target in the same modal, saved straight to the DB. Does NOT navigate
// panels — the editor you jumped from stays behind it.
async function vineJumpTo(kind, id) {
  if (!id) return;
  const cat = VINE_KINDS[kind];
  if (!cat || !cat.schema) return toast('Nothing to jump to for that reference.', true);

  vineModalSave(); // commit current graph → its form, then close the modal

  const list = await cat.listRoute();
  let rec = Array.isArray(list) ? list.find(r => String(r.id) === String(id)) : null;

  if (!rec) {
    if (!cat.createStub) return toast(`${cat.noun}: "${id}" not found — create it in its panel first.`, true);
    if (!confirm(`${cat.noun} "${id}" doesn't exist yet. Create a stub and open it?`)) return;
    rec = await cat.createStub(id);
    if (!rec) return;
  }

  vineModalOpen(
    `${cat.noun}: ${rec.name || id}`,
    cat.schema(),
    cat.toGraph(rec),
    async (saved) => {
      const res = await cat.save(rec.id, saved, rec);
      if (res && res.error) return toast(res.error, true);
      toast(`${cat.noun} '${rec.name || id}' saved.`);
    }
  );
}

// Back-compat shim: dialogue's quest-action jump button still calls this.
function vineJumpToQuest(questId) {
  return vineJumpTo('quest', questId);
}
