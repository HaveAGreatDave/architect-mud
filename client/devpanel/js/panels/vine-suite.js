// VINE Suite — a single cross-cutting INDEX of every VINE-authored graph in the game
// (dialogue, NPC/enemy behaviour, script, quest). It owns no editor of its own:
// clicking an asset jumps to the owning panel and opens that record's REAL per-panel
// VINE editor (npcOpenVine, enemyOpenVineAI, …). Cross-editor references
// (dialogue→quest/script, AI→quest, quest→dialogue) hop between the standalone editors
// via vineJumpTo without navigating away. No storage of its own — every category reads
// and writes the same field its owning panel does.
//
// The panel opens on a front page of 4 large family cards (VineQuest/VineDialogue/
// VineAI/VineScripts). Picking "Existing" on a card drills into a compact list scoped
// to that family; "+ New" jumps straight to the owning panel's blank record form.
// Every open VINE editor also carries a top-left tab strip (vineFamilyTabs) wired to
// vineGoToFamily so you can hop into another family's existing list without leaving
// the modal manually first.

let _vineSuiteData = { npcs: [], enemies: [], scripts: [], quests: [] };
let _vsView = 'front';         // 'front' | 'existing'
let _vsActiveFamily = null;
let _vsPendingOpen = null;     // { family, view } — consumed once by the next renderVineSuite

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
// the editor you jumped from.
const VINE_KINDS = {
  dialogue: {
    label: 'NPC Dialogue', icon: '💬', color: 'var(--accent2)', source: 'npcs', panel: 'npcs', opener: 'npcOpenVine',
    badge: (r) => _vsNodeCount(r.dialogue_tree),
    noun: 'Dialogue',
    schema: () => VineDialogueSchema,
    listRoute: () => directAPI('/npcs'),
    toGraph: (r) => VineDialogueSchema.fromDialogueTree(_vsParse(r.dialogue_tree) || {}),
    save: (id, g) => directAPI(`/npcs/${id}/graph`, 'PATCH', { field: 'dialogue_tree', graph: VineDialogueSchema.toDialogueTree(g) }),
  },
  aiNpc: {
    label: 'NPC Behaviour', icon: '🧠', color: 'var(--accent3)', source: 'npcs', panel: 'npcs', opener: 'npcOpenVineAI',
    badge: (r) => _vsNodeCount(r.behaviour_graph),
  },
  aiEnemy: {
    label: 'Enemy Behaviour', icon: '🧠', color: 'var(--accent3)', source: 'enemies', panel: 'enemies', opener: 'enemyOpenVineAI',
    badge: (r) => _vsNodeCount(r.behaviour_graph),
  },
  script: {
    label: 'Scripts', icon: '⎇', color: 'var(--cyan)', source: 'scripts', panel: 'scripts', opener: 'scriptsOpenVine',
    badge: (r) => _vsNodeCount(r.graph),
    noun: 'Script',
    schema: () => VineScriptSchema,
    listRoute: () => API('/scripts'),
    toGraph: (r) => VineScriptSchema.fromScriptGraph(_vsParse(r.graph) || {}),
    save: (id, g, rec) => API(`/scripts/${id}`, 'PUT', { name: rec.name, description: rec.description || '', graph: VineScriptSchema.toScriptGraph(g) }),
  },
  quest: {
    label: 'Quests', icon: '❗', color: 'var(--accent)', source: 'quests', panel: 'quests', opener: 'questsOpenVine',
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

// Families are what the front page shows: 4 large cards, always in this order. Each
// maps to 1+ VINE_KINDS (VineAI covers both NPC and enemy behaviour graphs).
const VINE_FAMILIES = {
  quest:    { label: 'VineQuest',    icon: '❗', color: 'var(--accent)',  tagline: 'Objective DAGs & rewards', kinds: ['quest'],   newPanels: [{ panel: 'quests', label: '+ New' }] },
  dialogue: { label: 'VineDialogue', icon: '💬', color: 'var(--accent2)', tagline: 'NPC conversation trees',   kinds: ['dialogue'], newPanels: [{ panel: 'npcs', label: '+ New NPC' }] },
  ai:       { label: 'VineAI',       icon: '🧠', color: 'var(--accent3)', tagline: 'NPC & enemy behaviour',    kinds: ['aiNpc', 'aiEnemy'], newPanels: [{ panel: 'npcs', label: '+ New NPC' }, { panel: 'enemies', label: '+ New Enemy' }] },
  script:   { label: 'VineScripts',  icon: '⎇', color: 'var(--cyan)',    tagline: 'Scripted events',          kinds: ['script'],  newPanels: [{ panel: 'scripts', label: '+ New' }] },
};
const _VF_ORDER = ['quest', 'dialogue', 'ai', 'script'];
const _VS_ORDER = ['dialogue', 'aiNpc', 'aiEnemy', 'script', 'quest'];

function _vsFamilyForKind(kind) {
  return _VF_ORDER.find(f => VINE_FAMILIES[f].kinds.includes(kind)) || null;
}

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

// ── Root render — front page of 4 family cards, or a family's compact existing list ──
function renderVineSuite(data) {
  _vineSuiteData = data || _vineSuiteData;
  if (_vsPendingOpen) {
    _vsActiveFamily = _vsPendingOpen.family;
    _vsView = _vsPendingOpen.view;
    _vsPendingOpen = null;
  } else {
    _vsView = 'front';
    _vsActiveFamily = null;
  }
  vsRenderRoot();
}

function vsRenderRoot() {
  const el = document.getElementById('list-panel');
  if (!el) return;
  el.innerHTML = _vsView === 'existing' ? _vsExistingHtml() : _vsFrontHtml();
  if (_vsView === 'existing') vsRenderExisting();
}

function _vsFrontHtml() {
  const cards = _VF_ORDER.map(key => {
    const fam = VINE_FAMILIES[key];
    const newBtns = fam.newPanels.map(np =>
      `<button class="action-btn" onclick="vsNewRecord('${np.panel}')">${np.label}</button>`
    ).join('');
    return `
      <div style="border:1px solid var(--border);border-top:4px solid ${fam.color};border-radius:6px;padding:20px 14px;text-align:center;background:var(--bg2)">
        <div style="font-size:40px;line-height:1">${fam.icon}</div>
        <div style="font-weight:bold;font-size:14px;letter-spacing:1px;color:${fam.color};margin:10px 0 4px">${fam.label}</div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:14px">${fam.tagline}</div>
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
          ${newBtns}
          <button class="action-btn" onclick="vsOpenExisting('${key}')">📂 Existing</button>
        </div>
      </div>`;
  }).join('');
  return `
    <div style="padding:10px 2px 14px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
        ${cards}
      </div>
    </div>`;
}

function _vsExistingHtml() {
  const fam = VINE_FAMILIES[_vsActiveFamily];
  return `
    <div style="padding:6px 2px 14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <button class="action-btn" onclick="vsBackToFront()">← Back</button>
        <span style="font-size:13px;font-weight:bold;color:${fam.color};letter-spacing:1px">${fam.icon} ${fam.label}</span>
        <input id="vine-index-search" placeholder="Filter…" oninput="vsRenderExisting()"
          style="flex:1;min-width:180px;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px 9px;border-radius:3px">
      </div>
      <div id="vine-index-body" style="border:1px solid var(--border);border-radius:4px;overflow:hidden"></div>
    </div>`;
}

function vsOpenExisting(familyKey) {
  _vsActiveFamily = familyKey;
  _vsView = 'existing';
  vsRenderRoot();
}

function vsBackToFront() {
  _vsView = 'front';
  _vsActiveFamily = null;
  vsRenderRoot();
}

// Compact flat list (no per-kind section boxes) for the active family. Rows carry a
// small kind tag when the family spans more than one VINE_KINDS entry (VineAI).
function vsRenderExisting() {
  const fam = VINE_FAMILIES[_vsActiveFamily];
  const body = document.getElementById('vine-index-body');
  if (!fam || !body) return;
  const q = (document.getElementById('vine-index-search')?.value || '').toLowerCase();
  const multi = fam.kinds.length > 1;

  const rows = [];
  for (const kind of fam.kinds) {
    const cat = VINE_KINDS[kind];
    const all = _vineSuiteData[cat.source] || [];
    for (const rec of all) {
      if (q && !String(rec.name || '').toLowerCase().includes(q) && !String(rec.id).toLowerCase().includes(q)) continue;
      rows.push({ kind, cat, rec, n: cat.badge(rec) });
    }
  }
  rows.sort((a, b) => (b.n - a.n) || String(a.rec.name || a.rec.id).localeCompare(String(b.rec.name || b.rec.id)));

  if (!rows.length) {
    body.innerHTML = `<div style="padding:14px 12px;color:var(--text-dim);font-size:11px">None yet.</div>`;
    return;
  }

  body.innerHTML = rows.map(({ kind, cat, rec, n }) => {
    const badge = n
      ? `<span style="color:${cat.color};font-size:10px;white-space:nowrap">● ${n}</span>`
      : `<span style="color:var(--text-dim);font-size:10px">—</span>`;
    const tag = multi
      ? `<span style="font-size:9px;color:var(--text-dim);border:1px solid var(--border);border-radius:2px;padding:0 4px;flex-shrink:0">${cat.label.replace(' Behaviour', '')}</span>`
      : '';
    return `<div onclick="vineOpenAsset('${kind}','${_vsEsc(rec.id)}')"
      style="display:flex;gap:6px;align-items:center;padding:4px 10px;cursor:pointer;border-bottom:1px solid var(--border)"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='none'">
      ${tag}
      <span style="flex:1;font-size:11px;color:var(--text-bright)">${_vsEsc(rec.name || '(unnamed)')}</span>
      <code style="font-size:9px;color:var(--text-dim)">${_vsEsc(rec.id)}</code>
      ${badge}
    </div>`;
  }).join('');
}

// "+ New" on a family card — jump to the owning panel and open its blank record form.
async function vsNewRecord(panel) {
  activatePanelNav(panel);
  currentPanel = panel;
  await loadPanel(panel);
  newRecord();
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
// "offered by" NPC). Commits the current graph back to its form, then opens the
// target in the same modal, saved straight to the DB. Does NOT navigate panels — the
// editor you jumped from stays behind it.
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
    },
    null,
    vineFamilyTabs(_vsFamilyForKind(kind))
  );
}

// Back-compat shim: dialogue's quest-action jump button still calls this.
function vineJumpToQuest(questId) {
  return vineJumpTo('quest', questId);
}

// ── Family tabs (top-left of every VINE editor) ────────────────────────────────
// Always the same 4, in the same order, each recolored to its family. The active
// family is inert; the other 3 commit + close the current editor and open the Suite
// straight into that family's compact existing list.
function vineFamilyTabs(activeFamilyKey) {
  return _VF_ORDER.map(key => {
    const fam = VINE_FAMILIES[key];
    return {
      label: fam.label,
      icon: fam.icon,
      color: fam.color,
      active: key === activeFamilyKey,
      onClick: () => vineGoToFamily(key),
    };
  });
}

async function vineGoToFamily(familyKey) {
  vineModalSave(); // commits the current graph to its form (if any) and closes the modal
  _vsPendingOpen = { family: familyKey, view: 'existing' };
  activatePanelNav('vine');
  currentPanel = 'vine';
  await loadPanel('vine');
}
