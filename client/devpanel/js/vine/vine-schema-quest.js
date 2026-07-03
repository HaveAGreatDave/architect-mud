// VINE Quest schema — converts a quest row (objectives[] + rewards{}) ↔ VINE graph.
//
// A quest is authored as a small DAG:
//   [quest] --start--> [objective] --unlocks--> [objective] --> [reward]
// An edge INTO an objective from another objective means "requires that objective
// first" (gating). An edge from the quest node means "available from the start".
// Terminal objectives (nothing depends on them) feed the reward node.
//
// The graph is a projection: objectives[] + rewards{} stay the authoritative fields
// the quest runtime reads. `requires` and `_vine` are additive — a runtime that
// ignores them degrades to a flat, unordered objective list.

function _escQ(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _QS = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:5px;box-sizing:border-box;border-radius:2px;margin-bottom:6px';
const _QL = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:3px';

function _qField(label, inputHtml) {
  return `<div style="margin-bottom:8px"><label style="${_QL}">${label}</label>${inputHtml}</div>`;
}
function _qInput(field, value, placeholder, type) {
  const t = type || 'text';
  return `<input data-vine-field="${field}" ${t !== 'text' ? `type="${t}" data-vine-type="${t}"` : ''} value="${_escQ(value)}" placeholder="${_escQ(placeholder || '')}" style="${_QS}">`;
}
function _qTextarea(field, value, rows, jsonType) {
  return `<textarea data-vine-field="${field}" ${jsonType ? 'data-vine-type="json"' : ''} rows="${rows || 3}"
           style="${_QS};resize:vertical;font-size:11px">${_escQ(value)}</textarea>`;
}
function _qSelect(field, options, current) {
  const opts = options.map(([v, l]) => `<option value="${v}"${v === current ? ' selected' : ''}>${l || v}</option>`).join('');
  return `<select data-vine-field="${field}" style="${_QS}">${opts}</select>`;
}
function _qHelp(nodeId, desc, example) {
  const boxId = `qh-${nodeId}`;
  return `
    <div style="margin-bottom:10px">
      <button onclick="(function(b){var d=document.getElementById('${boxId}');var o=d.style.display==='block';d.style.display=o?'none':'block';b.style.color=o?'var(--text-dim)':'var(--accent)';b.style.borderColor=o?'var(--border)':'var(--accent)'})(this)"
              style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:1px 7px;cursor:pointer;border-radius:2px;letter-spacing:1px">?</button>
      <div id="${boxId}" style="display:none;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:2px;font-size:11px;line-height:1.5">
        <div style="color:var(--text);margin-bottom:6px">${desc}</div>
        ${example ? `<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:3px">Example</div>
        <pre style="margin:0;font-size:10px;color:var(--accent2);font-family:var(--font);white-space:pre-wrap;word-break:break-all">${_escQ(example)}</pre>` : ''}
      </div>
    </div>`;
}

// Reverse-link helpers: does an NPC's dialogue_tree reference this quest anywhere?
// Structure-agnostic deep scan for a matching `quest_id` (set by START_QUEST/TURN_IN/
// COMPLETE/ADVANCE dialogue actions), so it can't drift from the dialogue node shape.
function _qParseTree(t) {
  if (!t) return null;
  if (typeof t === 'string') { try { return JSON.parse(t); } catch { return null; } }
  return t;
}
function _questReferencedIn(obj, questId) {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(v => _questReferencedIn(v, questId));
  if (obj.quest_id === questId) return true;
  return Object.values(obj).some(v => v && typeof v === 'object' && _questReferencedIn(v, questId));
}

// The single target field's label + placeholder depend on the objective kind.
const _Q_KINDS = [['kill', 'Kill'], ['give', 'Give / turn in'], ['visit', 'Visit']];
function _qTargetLabel(kind) {
  if (kind === 'give') return ['Item ID', 'medkit'];
  if (kind === 'visit') return ['Zone ID', 'zone_downtown_alley'];
  return ['Enemy target', 'sewer_rat'];
}

const _questNodeDefs = {
  quest: {
    label: 'Quest',
    color: '#a04488',
    defaultData: { name: '', description: '', repeatable: false },
    renderBody: (n) => `<div style="font-size:11px;color:var(--accent)">${_escQ(n.data.name || '(unnamed quest)')}</div>
      ${n.data.repeatable ? '<div style="font-size:10px;color:var(--text-dim)">repeatable</div>' : ''}`,
    getOutPorts: () => [{ key: 'start', label: 'available' }],
    renderProperties: (n, ed, id) => `
      ${_qHelp(id,
        'The quest itself. Objectives wired to the "available" port are active from the moment the quest starts. This is the single start node — one per graph.',
        'name: Pest Control\ndescription: The super wants the sewer rats gone.'
      )}
      ${_qField('Name', _qInput('data.name', n.data.name, 'Pest Control'))}
      ${_qField('Description', _qTextarea('data.description', n.data.description, 3))}
      ${_qField('Repeatable?', _qSelect('data.repeatable', [[false, 'One-time'], [true, 'Repeatable']], !!n.data.repeatable))}
      <div id="q-offered-by-${id}"></div>
    `,
    // Reverse cross-link: list NPCs whose dialogue offers this quest, each a jump into
    // that NPC's dialogue editor. No stored field — scanned live from /npcs.
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const questId = node.data._questId;
      const host = propsEl.querySelector(`#q-offered-by-${nodeId}`);
      if (!questId || !host) return;
      directAPI('/npcs').then(npcs => {
        if (!Array.isArray(npcs)) return;
        const offerers = npcs.filter(npc => _questReferencedIn(_qParseTree(npc.dialogue_tree), questId));
        if (!offerers.length) return;
        host.innerHTML = `<label style="${_QL}">Offered by (dialogue)</label>`;
        offerers.forEach(npc => {
          const b = document.createElement('button');
          b.className = 'action-btn';
          b.style.cssText = 'font-size:10px;margin-bottom:5px;width:100%';
          b.textContent = `💬 ${_escQ(npc.name || npc.id)} ▸`;
          b.title = "Commit this graph and open this NPC's dialogue in VINE";
          b.onclick = () => vineJumpTo('dialogue', npc.id);
          host.appendChild(b);
        });
      }).catch(() => {});
    },
  },

  objective: {
    label: 'Objective',
    color: '#4477aa',
    defaultData: { kind: 'kill', target: '', count: 1, desc: '' },
    renderBody: (n) => {
      const tgt = _escQ(n.data.target || '?');
      const c = Number(n.data.count) || 1;
      return `<div style="font-size:11px;color:var(--text)">${_escQ(n.data.kind || 'kill')}: ${tgt}${c > 1 ? ` ×${c}` : ''}</div>
        ${n.data.desc ? `<div style="font-size:10px;color:var(--text-dim)">${_escQ((n.data.desc || '').slice(0, 48))}</div>` : ''}`;
    },
    getOutPorts: () => [{ key: 'unlocks', label: 'unlocks' }],
    renderProperties: (n, ed, id) => {
      const [tlabel, tph] = _qTargetLabel(n.data.kind);
      return `
      ${_qHelp(id,
        'One goal that advances by world events. Kind picks the event: kill an enemy, give/turn in an item, or visit a zone. Draw an edge from another objective\'s "unlocks" port into this one to gate it — it stays hidden until the prerequisite is done. No incoming objective edge = available from quest start.',
        'kind: kill\ntarget: sewer_rat\ncount: 5\ndesc: Exterminate the sewer rats'
      )}
      ${_qField('Kind', _qSelect('data.kind', _Q_KINDS, n.data.kind))}
      ${_qField(tlabel, _qInput('data.target', n.data.target, tph))}
      ${_qField('Count', _qInput('data.count', n.data.count ?? 1, '1', 'number'))}
      ${_qField('Description', _qTextarea('data.desc', n.data.desc, 2))}
      <div style="font-size:10px;color:var(--text-dim);line-height:1.4">Re-open this panel after changing Kind to relabel the target field.</div>
    `;
    },
  },

  reward: {
    label: 'Reward',
    color: '#b8912b',
    defaultData: { credits: 0, items: [], flags: [] },
    renderBody: (n) => {
      const items = Array.isArray(n.data.items) ? n.data.items.length : 0;
      const bits = [];
      if (n.data.credits) bits.push(`₵${n.data.credits}`);
      if (items) bits.push(`${items} item${items > 1 ? 's' : ''}`);
      return `<div style="font-size:11px;color:#b8912b">${bits.join(' + ') || '(no reward)'}</div>`;
    },
    getOutPorts: () => [],
    renderProperties: (n, ed, id) => `
      ${_qHelp(id,
        'Granted when every objective feeding this node is complete. Items and flags are JSON arrays; leave blank for none.',
        'credits: 250\nitems: [{"item_id":"pistol","quantity":1}]\nflags: [{"scope":"player","flag":"super_trusts_me","value":"true"}]'
      )}
      ${_qField('Credits', _qInput('data.credits', n.data.credits ?? 0, '0', 'number'))}
      ${_qField('Items (JSON)', _qTextarea('data.items', JSON.stringify(n.data.items || [], null, 2), 3, true))}
      ${_qField('Flags (JSON)', _qTextarea('data.flags', JSON.stringify(n.data.flags || [], null, 2), 3, true))}
    `,
  },
};

// Layer objectives by prerequisite depth so the graph reads left→right.
function _autoLayoutQuest(objs, byId) {
  const depth = {};
  function d(id) {
    if (depth[id] != null) return depth[id];
    const o = byId[id];
    const reqs = (o && Array.isArray(o.requires)) ? o.requires : [];
    depth[id] = reqs.length ? 1 + Math.max(...reqs.map(r => (byId[r] ? d(r) : 0))) : 1;
    return depth[id];
  }
  objs.forEach(o => d(o.id));
  const maxDepth = objs.length ? Math.max(...objs.map(o => depth[o.id])) : 0;
  const rowAt = {};
  const pos = {};
  objs.forEach(o => {
    const col = depth[o.id];
    rowAt[col] = (rowAt[col] || 0);
    pos[o.id] = { x: col * 300 + 40, y: rowAt[col] * 150 + 60 };
    rowAt[col]++;
  });
  return { pos, rewardCol: maxDepth + 1 };
}

window.VineQuestSchema = {
  vineIdentity: { kind: 'quest', tagline: 'Objectives & rewards', color: 'var(--accent)', icon: '❗' },
  nodeTypes: _questNodeDefs,

  // Quest row → VINE graph. rec: { name, description, repeatable, objectives[], rewards{} }
  //   objective: { type:'kill'|'give'|'visit', target?|item_id?|zone?, count, desc, id?, requires?[], _vine? }
  fromQuest(rec) {
    const rawObjs = Array.isArray(rec.objectives) ? rec.objectives : [];
    // Normalise to nodes with stable ids.
    const objs = rawObjs.map((o, i) => {
      const kind = o.type || 'kill';
      const target = o.target ?? o.item_id ?? o.zone ?? '';
      return {
        id: o.id || `obj_${i}`,
        kind, target,
        count: o.count ?? 1,
        desc: o.desc || '',
        requires: Array.isArray(o.requires) ? o.requires : [],
        _vine: o._vine,
      };
    });
    const byId = {}; objs.forEach(o => { byId[o.id] = o; });
    const { pos, rewardCol } = _autoLayoutQuest(objs, byId);

    const nodes = {};
    const edges = [];

    // `_questId` is a non-persisted hint (toQuest ignores it) so the quest node can
    // reverse-scan NPC dialogue for "offered by" links. Absent for brand-new quests.
    nodes.quest = { type: 'quest', x: 40, y: 40, data: { name: rec.name || '', description: rec.description || '', repeatable: !!rec.repeatable, _questId: rec.id || '' } };

    // Objective nodes + gating edges.
    const dependedOn = new Set();
    objs.forEach(o => o.requires.forEach(r => dependedOn.add(r)));
    objs.forEach(o => {
      const p = o._vine || pos[o.id] || { x: 340, y: 60 };
      nodes[o.id] = { type: 'objective', x: p.x, y: p.y, data: { kind: o.kind, target: o.target, count: o.count, desc: o.desc } };
      if (o.requires.length) {
        o.requires.forEach(r => { if (byId[r]) edges.push({ fromNode: r, fromPort: 'unlocks', toNode: o.id }); });
      } else {
        edges.push({ fromNode: 'quest', fromPort: 'start', toNode: o.id });
      }
    });

    // Reward node, fed by terminal objectives (or the quest itself if no objectives).
    const rewards = rec.rewards && typeof rec.rewards === 'object' ? rec.rewards : {};
    const rewardPos = rewards._vine || { x: rewardCol * 300 + 40, y: 60 };
    nodes.reward = { type: 'reward', x: rewardPos.x, y: rewardPos.y, data: { credits: rewards.credits || 0, items: rewards.items || [], flags: rewards.flags || [] } };
    const terminals = objs.filter(o => !dependedOn.has(o.id));
    if (terminals.length) terminals.forEach(o => edges.push({ fromNode: o.id, fromPort: 'unlocks', toNode: 'reward' }));
    else edges.push({ fromNode: 'quest', fromPort: 'start', toNode: 'reward' });

    return { nodes, edges };
  },

  // VINE graph → quest fields { name, description, repeatable, objectives[], rewards{} }
  toQuest(vineGraph) {
    const vnodes = vineGraph.nodes || {};
    const edges = vineGraph.edges || [];
    const questNode = Object.values(vnodes).find(n => n.type === 'quest');
    const rewardNode = Object.entries(vnodes).find(([, n]) => n.type === 'reward');

    const objectives = [];
    for (const [id, node] of Object.entries(vnodes)) {
      if (node.type !== 'objective') continue;
      // requires = incoming edges whose source is another objective node.
      const requires = edges
        .filter(e => e.toNode === id && vnodes[e.fromNode] && vnodes[e.fromNode].type === 'objective')
        .map(e => e.fromNode);
      const kind = node.data.kind || 'kill';
      const key = kind === 'give' ? 'item_id' : kind === 'visit' ? 'zone' : 'target';
      const obj = {
        id,
        type: kind,
        [key]: node.data.target || '',
        count: Number(node.data.count) || 1,
        desc: node.data.desc || '',
        _vine: { x: node.x, y: node.y },
      };
      if (requires.length) obj.requires = requires;
      objectives.push(obj);
    }

    const rewards = rewardNode ? {
      credits: Number(rewardNode[1].data.credits) || 0,
      items: Array.isArray(rewardNode[1].data.items) ? rewardNode[1].data.items : [],
      flags: Array.isArray(rewardNode[1].data.flags) ? rewardNode[1].data.flags : [],
      _vine: { x: rewardNode[1].x, y: rewardNode[1].y },
    } : {};

    return {
      name: questNode ? (questNode.data.name || '') : '',
      description: questNode ? (questNode.data.description || '') : '',
      repeatable: questNode ? !!questNode.data.repeatable : false,
      objectives,
      rewards,
    };
  },
};
