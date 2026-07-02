// VINE Suite — one hub for every VINE-authored graph in the game. Lists all
// graph-bearing assets across the five schemas (dialogue, NPC/enemy behaviour,
// script, broadcast, quest) and launches the correct editor for each, saving
// back through that type's canonical API. No new storage: each category reads
// and writes the same field its owning panel does.

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
// (null for quests, which are derived from objectives[]/rewards{}).
const VINE_SUITE = {
  dialogue: {
    label: 'NPC Dialogue', icon: '💬', color: '#4477aa', source: 'npcs', field: 'dialogue_tree',
    schema: () => VineDialogueSchema,
    toGraph: (rec) => VineDialogueSchema.fromDialogueTree(_vsParse(rec.dialogue_tree) || {}),
    save: (id, g) => directAPI(`/npcs/${id}/graph`, 'PATCH', { field: 'dialogue_tree', graph: VineDialogueSchema.toDialogueTree(g) }),
    badge: (rec) => _vsNodeCount(rec.dialogue_tree),
  },
  aiNpc: {
    label: 'NPC Behaviour', icon: '🧠', color: '#886622', source: 'npcs', field: 'behaviour_graph',
    schema: () => VineAISchema,
    toGraph: (rec) => VineAISchema.fromAiGraph(_vsParse(rec.behaviour_graph) || {}),
    save: (id, g) => directAPI(`/npcs/${id}/graph`, 'PATCH', { field: 'behaviour_graph', graph: VineAISchema.toAiGraph(g) }),
    badge: (rec) => _vsNodeCount(rec.behaviour_graph),
  },
  aiEnemy: {
    label: 'Enemy Behaviour', icon: '👾', color: '#aa4422', source: 'enemies', field: 'behaviour_graph',
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
  },
  broadcast: {
    label: 'Broadcasts', icon: '📺', color: '#226644', source: 'broadcasts', field: 'broadcast_graph',
    schema: () => VineBroadcastSchema,
    toGraph: (rec) => VineBroadcastSchema.fromBroadcastGraph(_vsParse(rec.broadcast_graph) || {}),
    save: (id, g) => directAPI(`/broadcasts/${id}/graph`, 'PATCH', { field: 'broadcast_graph', graph: VineBroadcastSchema.toBroadcastGraph(g) }),
    badge: (rec) => _vsNodeCount(rec.broadcast_graph),
  },
  quest: {
    label: 'Quests', icon: '❗', color: '#a04488', source: 'quests', field: null,
    schema: () => VineQuestSchema,
    toGraph: (rec) => VineQuestSchema.fromQuest(rec),
    save: (id, g) => API(`/quests/${id}`, 'PUT', VineQuestSchema.toQuest(g)),
    badge: (rec) => (Array.isArray(rec.objectives) ? rec.objectives : _vsParse(rec.objectives) || []).length,
  },
};

const _VS_ORDER = ['dialogue', 'aiNpc', 'aiEnemy', 'script', 'broadcast', 'quest'];

// Panel fetch — pull every source in parallel (mirrors the Broadcasts suite fetch).
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

function renderVineSuite(data) {
  _vineSuiteData = data || _vineSuiteData;
  const sections = _VS_ORDER.map(key => {
    const cat = VINE_SUITE[key];
    const recs = (_vineSuiteData[cat.source] || []).slice().sort((a, b) => (cat.badge(b) - cat.badge(a)) || String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const rows = recs.map(rec => {
      const n = cat.badge(rec);
      const badge = n
        ? `<span style="color:${cat.color};font-size:11px">● ${n}</span>`
        : `<span style="color:var(--text-dim);font-size:11px">—</span>`;
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 8px">${_vsEsc(rec.name || '(unnamed)')}</td>
        <td style="padding:5px 8px"><code style="font-size:11px;color:var(--text-dim)">${_vsEsc(rec.id)}</code></td>
        <td style="padding:5px 8px;text-align:center">${badge}</td>
        <td style="padding:5px 8px;text-align:right"><button class="action-btn" onclick="vineSuiteEdit('${key}','${_vsEsc(rec.id)}')">🌿 Edit</button></td>
      </tr>`;
    }).join('') || `<tr><td colspan="4" style="padding:8px;color:var(--text-dim);font-size:12px">None yet.</td></tr>`;
    const withGraphs = recs.filter(r => cat.badge(r)).length;
    return `
      <div style="margin-bottom:22px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:15px">${cat.icon}</span>
          <span style="font-weight:bold;color:${cat.color};letter-spacing:1px;text-transform:uppercase;font-size:12px">${cat.label}</span>
          <span style="color:var(--text-dim);font-size:11px">${withGraphs}/${recs.length}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--border);border-radius:3px">
          <thead><tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:1px">
            <th style="padding:5px 8px;text-align:left">Name</th>
            <th style="padding:5px 8px;text-align:left">ID</th>
            <th style="padding:5px 8px;text-align:center">Nodes</th>
            <th style="padding:5px 8px"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  document.getElementById('list-panel').innerHTML = `
    <div style="padding:4px 2px 14px">
      <div style="color:var(--text-dim);font-size:12px;margin-bottom:16px">Every VINE graph in the game, in one place. Editing here saves straight to each asset — the same as opening it from its own panel.</div>
      ${sections}
    </div>`;
}

function vineSuiteEdit(key, id) {
  const cat = VINE_SUITE[key];
  const rec = (_vineSuiteData[cat.source] || []).find(r => String(r.id) === String(id));
  if (!rec) return toast('Record not found — try reloading the panel.', true);
  vineModalOpen(
    `${cat.label}: ${rec.name || id}`,
    cat.schema(),
    cat.toGraph(rec),
    async (saved) => {
      const res = await cat.save(id, saved, rec);
      if (res && res.error) return toast(res.error, true);
      toast(`${cat.label} saved.`);
      if (currentPanel === 'vine') showPanel('vine');
    }
  );
}

function _vsEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Cross-editor jump: from an open graph (e.g. a dialogue node's START_QUEST/TURN_IN
// action) straight into the referenced quest's editor. Commits the current graph
// first (same as Save & Close) so no edits are lost — there's only one VINE modal.
async function vineJumpToQuest(questId) {
  if (!questId) return;
  if (!confirm(`Save the current graph and open quest "${questId}" in VINE?`)) return;
  vineModalSave(); // runs the active editor's onSave, then closes the modal
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
