// VINE AI Behaviour schema — converts AI behaviour_graph JSON ↔ VINE graph format.
// Defines node types for the visual AI behaviour editor.

function _escAI(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const _AI_IS = 'width:100%;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:var(--font);font-size:12px;padding:4px 6px;box-sizing:border-box;border-radius:2px';
const _AI_LS = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);display:block;margin-bottom:3px';

function _aiHelpBox(nodeId, desc, example) {
  const boxId = `ai-help-${nodeId}`;
  return `
    <div style="margin-bottom:10px">
      <button onclick="(function(b){var d=document.getElementById('${boxId}');var open=d.style.display==='block';d.style.display=open?'none':'block';b.style.color=open?'var(--text-dim)':'var(--accent)';b.style.borderColor=open?'var(--border)':'var(--accent)'})(this)"
              style="background:none;border:1px solid var(--border);color:var(--text-dim);font-family:var(--font);font-size:10px;padding:1px 7px;cursor:pointer;border-radius:2px;letter-spacing:1px">?</button>
      <div id="${boxId}" style="display:none;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:2px;font-size:11px;line-height:1.5">
        <div style="color:var(--text);margin-bottom:6px">${desc}</div>
        ${example ? `<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:3px">Example</div>
        <pre style="margin:0;font-size:10px;color:var(--accent2);font-family:var(--font);white-space:pre-wrap;word-break:break-all">${_escAI(example)}</pre>` : ''}
      </div>
    </div>`;
}

function _aiField(label, inputHtml) {
  return `<div style="margin-bottom:8px"><label style="${_AI_LS}">${label}</label>${inputHtml}</div>`;
}

function _aiInput(field, value, placeholder, type) {
  const t = type || 'text';
  return `<input data-vine-field="${field}" ${t !== 'text' ? `data-vine-type="${t}" type="${t}"` : ''} value="${_escAI(value)}" placeholder="${placeholder || ''}" style="${_AI_IS}">`;
}

function _aiTextarea(field, value, rows) {
  return `<textarea data-vine-field="${field}" data-vine-type="json" rows="${rows || 3}" style="${_AI_IS};resize:vertical;font-size:11px">${_escAI(typeof value === 'object' ? JSON.stringify(value, null, 2) : (value || ''))}</textarea>`;
}

function _aiSelect(field, options, current) {
  const opts = options.map(o => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('');
  return `<select data-vine-field="${field}" style="${_AI_IS}">${opts}</select>`;
}

// ── Condition type catalogue ──────────────────────────────────────────────────

const AI_CONDITIONS = [
  { type: 'HAS_TARGET',       label: 'Has Target',              params: [] },
  { type: 'HP_BELOW',         label: 'HP Below %',              params: [{ key: 'pct',     label: 'Threshold %',       type: 'number', default: 30 }] },
  { type: 'HP_ABOVE',         label: 'HP Above %',              params: [{ key: 'pct',     label: 'Threshold %',       type: 'number', default: 70 }] },
  { type: 'IN_ZONE',          label: 'In Zone',                 params: [{ key: 'zone_id', label: 'Zone ID',           type: 'text',   default: '' }] },
  { type: 'PLAYER_IN_ZONE',   label: 'Player In Zone',          params: [{ key: 'min',     label: 'Min players',       type: 'number', default: 1 }] },
  { type: 'TARGET_HP_BELOW',  label: "Target's HP Below %",     params: [{ key: 'pct',     label: 'Threshold %',       type: 'number', default: 30 }] },
  { type: 'FACTION_MATCH',    label: 'Target In Org/Faction',   params: [{ key: 'faction', label: 'Org/Faction id',     type: 'text',   default: '' }] },
  { type: 'FLAG_SET',         label: 'Flag Is Set',             params: [{ key: 'flag',    label: 'Flag key',          type: 'text',   default: '' }, { key: 'scope', label: 'Scope', type: 'select', options: ['self'], default: 'self' }] },
  { type: 'RANDOM_CHANCE',    label: 'Random Chance',           params: [{ key: 'chance',  label: 'Probability 0–1',   type: 'number', default: 0.5 }] },
  { type: 'IS_DAYTIME',       label: 'Is Daytime',              params: [] },
  { type: 'CHANNEL_HAS_VIEWERS', label: 'Channel Has Viewers', params: [{ key: 'channel_id', label: 'Channel ID', type: 'text', default: '' }] },
  { type: 'HOUR_RANGE', label: 'Hour Range', params: [
    { key: 'from', label: 'From (0–23)', type: 'number', default: 8 },
    { key: 'to',   label: 'To (0–23)',   type: 'number', default: 20 },
  ]},
  { type: 'TARGETABLE_IN_ZONE',   label: 'Targetable In Zone',    params: [] },
  { type: 'IS_BROADCAST_SCHEDULED', label: 'Broadcast Scheduled Now', params: [] },
  { type: 'AT_WORK_ZONE',         label: 'At Work Zone',          params: [] },
  { type: 'IS_VENDOR_WORK_TIME',  label: 'Vendor Work Time',      params: [] },
  { type: 'AT_HOME',              label: 'At Home',               params: [] },
];

// ── Action type catalogue ─────────────────────────────────────────────────────

const AI_ACTIONS = [
  { type: 'ATTACK',          label: 'Attack',          params: [] },
  { type: 'ACQUIRE_TARGET',  label: 'Acquire Target',  params: [{ key: 'prefer',      label: 'Prefer',                type: 'select', options: ['random', 'lowest_hp'], default: 'random' }] },
  { type: 'DROP_TARGET',     label: 'Drop Target',     params: [] },
  { type: 'PATROL',          label: 'Patrol',          params: [
    { key: 'waypoints',  label: 'Waypoints',  type: 'zone-list',  default: [] },
    { key: 'mode',       label: 'Move mode',                           type: 'select',  options: ['walk', 'teleport'], default: 'walk' },
    { key: 'loop',       label: 'Loop back to start',                  type: 'boolean', default: true },
  ]},
  // No params, deliberately. FLEE is ONE hop to an adjacent zone and then it
  // clears targetId — there is no multi-hop retreat for a distance to bound, and
  // every exit it chooses between is adjacent by definition. This used to offer a
  // `max_distance` field that the engine never read. How hard it is to break away
  // is `flags.flee_skill`; where it ends up afterwards is the next ROAM beat.
  { type: 'FLEE',            label: 'Flee',            params: [] },
  { type: 'SAY',             label: 'Say',             params: [
    { key: 'message',    label: 'Message',           type: 'text',    default: '' },
    { key: 'once',       label: 'Say once only',     type: 'boolean', default: false },
    { key: 'cooldown_s', label: 'Cooldown (s)',      type: 'number',  default: 30 },
  ]},
  { type: 'CALL_BACKUP',     label: 'Call Backup',     params: [
    { key: 'radius',       label: 'Search radius (zones)', type: 'number',  default: 2 },
    { key: 'faction_only', label: 'Same faction only',     type: 'boolean', default: true },
  ]},
  { type: 'TELEPORT',        label: 'Teleport',        params: [{ key: 'zone_id', label: 'Zone ID', type: 'text', default: '' }] },
  { type: 'IDLE',            label: 'Idle',            params: [] },
  { type: 'SET_FLAG',        label: 'Set Flag',        params: [
    { key: 'flag',  label: 'Flag key', type: 'text',   default: '' },
    { key: 'value', label: 'Value',    type: 'text',   default: 'true' },
    { key: 'scope', label: 'Scope',    type: 'select', options: ['self'], default: 'self' },
  ]},
  { type: 'BROADCAST_SAY', label: 'Broadcast Say', params: [
    { key: 'channel_id', label: 'Channel ID', type: 'text',   default: '' },
    { key: 'text',       label: 'Text',       type: 'text',   default: '' },
  ]},
  { type: 'START_QUEST', label: 'Start Quest', params: [
    { key: 'quest_id',   label: 'Quest ID',   type: 'text',   default: '' },
    { key: 'cooldown_s', label: 'Cooldown (s)', type: 'number', default: 60 },
  ]},
  { type: 'GO_HOME',   label: 'Go Home',   params: [] },
  { type: 'HAVE_LIFE', label: 'Have Life', params: [] },
  { type: 'AT_WORK',   label: 'At Work',   params: [] },
  { type: 'EMOTE',     label: 'Emote',     params: [
    { key: 'message', label: 'Action text', type: 'text', default: '' },
  ]},
  { type: 'GO_TO_WORK', label: 'Go To Work', params: [
    { key: 'zone_id',              label: 'Work Zone (override)', type: 'text',   default: '' },
    { key: 'arrive_by',            label: 'Arrive By (hour)',     type: 'number', default: 20 },
    { key: 'depart_early_minutes', label: 'Buffer (min)',         type: 'number', default: 0 },
  ]},
  { type: 'CHECK_WORK', label: 'Check Work', params: [] },
  { type: 'ROAM',       label: 'Roam',       params: [{ key: 'interval_s', label: 'Interval (s)', type: 'number', default: 10 }] },
  // Pursuit. Put it between HAS_TARGET and ATTACK: it no-ops when the target is
  // already in the room, so ATTACK still runs on the same tick. Adding this node
  // is what makes a creature keep its target after you leave the room — without
  // it, a mob forgets you the instant you step out. Range is the creature's
  // flags.leash_radius, pace is flags.chase_speed_s; neither is a node param.
  { type: 'CHASE', label: 'Chase Target', params: [
    // 'target' follows the combat target. 'flag' follows a player id stamped on the
    // instance, which lets a unit pursue somebody it is deliberately NOT targeting
    // — how the SPECTER-PD manhunt arrives to detain rather than to swing.
    { key: 'quarry',     label: 'Quarry',            type: 'text',   default: 'target' },
    { key: 'flag',       label: 'Quarry flag',       type: 'text',   default: 'suspect_id' },
    { key: 'wander_pct', label: 'Wander chance 0-1', type: 'number', default: 0 },
  ] },
  { type: 'GO_TO_STUDIO',       label: 'Go To Studio',        params: [] },
  // Vendor daily-routine actions (parameterless — driven by NPC fields + blackboard).
  { type: 'CHECK_VENDOR_WORK',  label: 'Check Vendor Work',    params: [] },
  { type: 'VENDOR_CHITCHAT',    label: 'Vendor Chitchat',      params: [] },
  { type: 'AT_HOME_LIFE',       label: 'At Home (Life)',       params: [] },
  { type: 'VENDOR_COLLECT_SAFE',label: 'Vendor Collect Safe',  params: [] },
  { type: 'VENDOR_GO_TO_ATM',   label: 'Vendor Go To ATM',     params: [] },
  { type: 'VENDOR_DEPOSIT',     label: 'Vendor Deposit',       params: [] },
];

// ── Shared param form renderer ────────────────────────────────────────────────

function _renderParamFields(container, catalogue, typeKey, dataObj, onChange) {
  container.innerHTML = '';
  const def = catalogue.find(d => d.type === dataObj[typeKey]);
  if (!def || !def.params.length) return;

  for (const p of def.params) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:10px;color:var(--text-dim);min-width:80px;flex-shrink:0';
    lbl.textContent = p.label;

    let inp;
    if (p.type === 'boolean') {
      inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.checked = dataObj.params?.[p.key] ?? p.default ?? false;
      inp.onchange = () => { (dataObj.params = dataObj.params || {})[p.key] = inp.checked; onChange(); };
    } else if (p.type === 'select') {
      inp = document.createElement('select');
      inp.style.cssText = _AI_IS;
      const cur = dataObj.params?.[p.key] ?? p.default ?? (p.options || [])[0];
      inp.innerHTML = (p.options || []).map(o => `<option value="${o}" ${o === cur ? 'selected' : ''}>${o}</option>`).join('');
      inp.onchange = () => { (dataObj.params = dataObj.params || {})[p.key] = inp.value; onChange(); };
    } else if (p.type === 'json') {
      inp = document.createElement('textarea');
      inp.style.cssText = _AI_IS + ';resize:vertical;font-size:10px;height:44px';
      const cur = dataObj.params?.[p.key] ?? p.default ?? [];
      inp.value = typeof cur === 'string' ? cur : JSON.stringify(cur, null, 2);
      inp.onchange = () => {
        try { (dataObj.params = dataObj.params || {})[p.key] = JSON.parse(inp.value); onChange(); } catch {}
      };
    } else if (p.type === 'zone-list') {
      row.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;gap:4px;margin-bottom:4px';
      inp = document.createElement('div');
      const getWps = () => dataObj.params?.[p.key] ?? p.default ?? [];
      const setWps = (arr) => { (dataObj.params = dataObj.params || {})[p.key] = arr; onChange(); renderWpList(); };

      const listEl = document.createElement('div');
      listEl.style.cssText = 'display:flex;flex-direction:column;gap:2px';

      const selectorWrap = document.createElement('div');
      selectorWrap.style.cssText = 'display:none;gap:4px;align-items:center';

      const addBtnRow = document.createElement('div');
      addBtnRow.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap';

      const addBtn = document.createElement('button');
      addBtn.textContent = '+';
      addBtn.className = 'action-btn';
      addBtn.style.cssText = 'padding:1px 8px;font-size:11px';

      addBtn.onclick = async () => {
        if (selectorWrap.style.display !== 'none') { selectorWrap.style.display = 'none'; return; }
        const zones = await API('/zones').catch(() => []);
        const sorted = (Array.isArray(zones) ? zones : []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        inp._zoneNames = Object.fromEntries(sorted.map(z => [z.id, z.name]));
        const sel = document.createElement('select');
        sel.style.cssText = _AI_IS + ';flex:1;min-width:0';
        sel.innerHTML = sorted.map(z => `<option value="${z.id}">${z.name} (${z.id})</option>`).join('');
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Add';
        confirmBtn.className = 'action-btn success';
        confirmBtn.style.cssText = 'padding:1px 6px;font-size:10px';
        confirmBtn.onclick = () => {
          if (!sel.value) return;
          setWps([...getWps(), sel.value]);
          selectorWrap.style.display = 'none';
        };
        selectorWrap.innerHTML = '';
        selectorWrap.appendChild(sel);
        selectorWrap.appendChild(confirmBtn);
        selectorWrap.style.display = 'flex';
        renderWpList();
      };

      const renderWpList = () => {
        listEl.innerHTML = '';
        getWps().forEach((zid, i) => {
          const name = inp._zoneNames?.[zid] || zid;
          const item = document.createElement('div');
          item.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:10px';
          const badge = document.createElement('span');
          badge.style.cssText = _AI_IS + ';padding:1px 5px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
          badge.textContent = `${i + 1}. ${name}`;
          const rm = document.createElement('button');
          rm.textContent = '×';
          rm.className = 'action-btn danger';
          rm.style.cssText = 'padding:0 5px;font-size:11px;line-height:1.3;flex-shrink:0';
          rm.onclick = () => { const arr = [...getWps()]; arr.splice(i, 1); setWps(arr); };
          item.appendChild(badge);
          item.appendChild(rm);
          listEl.appendChild(item);
        });
      };

      // Eagerly fetch zone names for existing waypoints
      API('/zones').then(zones => {
        inp._zoneNames = Object.fromEntries((Array.isArray(zones) ? zones : []).map(z => [z.id, z.name]));
        renderWpList();
      });

      renderWpList();
      addBtnRow.appendChild(addBtn);
      addBtnRow.appendChild(selectorWrap);
      inp.appendChild(listEl);
      inp.appendChild(addBtnRow);
    } else {
      inp = document.createElement('input');
      inp.type = p.type === 'number' ? 'number' : 'text';
      inp.style.cssText = _AI_IS;
      inp.value = dataObj.params?.[p.key] ?? p.default ?? '';
      if (p.type === 'number') inp.step = 'any';
      inp.oninput = () => {
        (dataObj.params = dataObj.params || {})[p.key] = p.type === 'number' ? Number(inp.value) : inp.value;
        onChange();
      };
    }

    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  }
}

// ── Branch editor (for random nodes) ─────────────────────────────────────────

function _buildBranchEditor(container, node, editor, nodeId) {
  const branches = node.data.branches || (node.data.branches = []);
  const onChange = () => {
    editor._refreshNodeDisplay(nodeId);
    editor._renderEdges();
    editor._fire('change');
  };

  const render = () => {
    container.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:5px';

    branches.forEach((b, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:6px;display:flex;align-items:center;gap:6px';

      const lbl = document.createElement('span');
      lbl.style.cssText = 'font-size:10px;color:var(--text-dim);min-width:60px';
      lbl.textContent = `Branch ${i}`;

      const wLbl = document.createElement('label');
      wLbl.style.cssText = 'font-size:10px;color:var(--text-dim);flex-shrink:0';
      wLbl.textContent = 'Weight';

      const wInp = document.createElement('input');
      wInp.type = 'number';
      wInp.min = '1';
      wInp.step = '1';
      wInp.style.cssText = _AI_IS + ';width:60px;flex-shrink:0';
      wInp.value = b.weight ?? 1;
      wInp.oninput = () => { b.weight = Math.max(1, parseInt(wInp.value) || 1); onChange(); };

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn danger';
      delBtn.style.cssText = 'padding:1px 5px;font-size:10px;flex-shrink:0';
      delBtn.textContent = '✕';
      delBtn.onclick = () => {
        branches.splice(i, 1);
        onChange();
        render();
      };

      card.appendChild(lbl);
      card.appendChild(wLbl);
      card.appendChild(wInp);
      card.appendChild(delBtn);
      list.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'action-btn';
    addBtn.style.cssText = 'font-size:11px;width:100%;margin-top:2px';
    addBtn.textContent = '+ Add Branch';
    addBtn.onclick = () => { branches.push({ weight: 1 }); onChange(); render(); };
    list.appendChild(addBtn);
    container.appendChild(list);
  };

  render();
}

// ── Node type definitions ─────────────────────────────────────────────────────

const _aiNodeDefs = {

  start: {
    label: 'Start',
    color: '#334433',
    defaultData: {},
    renderBody: () => `<div style="font-size:11px;color:var(--accent);letter-spacing:1px">↳ ENTRY</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_aiHelpBox(id, 'Entry point for the behaviour graph. The AI walks from here every tick. There can only be one Start node — connect its output to the first condition or action you want evaluated.', null)}
      <div style="color:var(--text-dim);font-size:12px">Connect to the first node to evaluate each tick.</div>`,
  },

  condition: {
    label: 'Condition',
    color: '#aa4422',
    defaultData: { condition_type: 'HAS_TARGET', params: {} },
    renderBody: (n) => {
      const def = AI_CONDITIONS.find(c => c.type === n.data.condition_type);
      return `<div style="font-size:11px;color:var(--text-dim)">${_escAI(def?.label || n.data.condition_type || '(no condition)')}</div>`;
    },
    getOutPorts: () => [{ key: 'ifTrue', label: 'if true' }, { key: 'ifFalse', label: 'if false' }],
    renderProperties: (n, ed, id) => {
      const condOpts = AI_CONDITIONS.map(c =>
        `<option value="${c.type}" ${c.type === n.data.condition_type ? 'selected' : ''}>${c.label}</option>`
      ).join('');
      return `
        ${_aiHelpBox(id,
          'Evaluates a condition each tick and routes down "if true" or "if false". Conditions never execute game logic — they only check state.',
          'HAS_TARGET → if true: ATTACK\n            → if false: ACQUIRE_TARGET\n\nHP_BELOW (pct: 25) → if true: FLEE\n                   → if false: ATTACK'
        )}
        ${_aiField('Condition Type', `<select data-vine-field="data.condition_type" style="${_AI_IS}" id="ai-cond-type-${id}">${condOpts}</select>`)}
        <div id="ai-cond-params-${id}"></div>
      `;
    },
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const sel = propsEl.querySelector(`#ai-cond-type-${nodeId}`);
      const paramContainer = propsEl.querySelector(`#ai-cond-params-${nodeId}`);
      const onChange = () => {
        editor._refreshNodeDisplay(nodeId);
        editor._fire('change');
      };
      if (paramContainer) _renderParamFields(paramContainer, AI_CONDITIONS, 'condition_type', node.data, onChange);
      if (sel) {
        sel.addEventListener('change', () => {
          node.data.condition_type = sel.value;
          node.data.params = {};
          if (paramContainer) _renderParamFields(paramContainer, AI_CONDITIONS, 'condition_type', node.data, onChange);
          onChange();
        });
      }
    },
  },

  action: {
    label: 'Action',
    color: '#4455aa',
    defaultData: { action_type: 'IDLE', params: {} },
    renderBody: (n) => {
      const def = AI_ACTIONS.find(a => a.type === n.data.action_type);
      return `<div style="font-size:11px;color:var(--accent)">${_escAI(def?.label || n.data.action_type || '(no action)')}</div>`;
    },
    getOutPorts: (n) => {
      if (n.data.action_type === 'CHECK_WORK') {
        return [
          { key: 'goToWork', label: 'go to work' },
          { key: 'haveLife', label: 'have life' },
        ];
      }
      if (n.data.action_type === 'CHECK_VENDOR_WORK') {
        return [
          { key: 'goToWork', label: 'go to work' },
          { key: 'haveLife', label: 'have life' },
          { key: 'endShift', label: 'end shift' },
          { key: 'offWork',  label: 'off work' },
        ];
      }
      return [{ key: 'next', label: 'next' }];
    },
    renderProperties: (n, ed, id) => {
      const actOpts = AI_ACTIONS.map(a =>
        `<option value="${a.type}" ${a.type === n.data.action_type ? 'selected' : ''}>${a.label}</option>`
      ).join('');
      return `
        ${_aiHelpBox(id,
          'Executes one game action, then stops graph evaluation for this tick. The "next" port runs on the following tick if the graph reaches this node again. CHECK_WORK is the exception: it has two named ports, "go to work" and "have life", instead of "next".',
          'PATROL  — move through a list of zone IDs step by step\nATTACK  — strike current target using normal combat\nSAY     — broadcast a message to the zone\nFLEE    — move away from target\'s zone\nCALL_BACKUP — alert nearby same-faction entities\nCHECK_WORK — branches to go-to-work or have-life based on schedule + travel time'
        )}
        ${_aiField('Action Type', `<select data-vine-field="data.action_type" style="${_AI_IS}" id="ai-act-type-${id}">${actOpts}</select>`)}
        <div id="ai-act-params-${id}"></div>
      `;
    },
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const sel = propsEl.querySelector(`#ai-act-type-${nodeId}`);
      const paramContainer = propsEl.querySelector(`#ai-act-params-${nodeId}`);

      // Cross-link: a START_QUEST action jumps into the referenced quest's editor.
      const jumpHost = document.createElement('div');
      if (paramContainer) paramContainer.after(jumpHost);
      const refreshJump = () => {
        jumpHost.innerHTML = '';
        const qid = node.data.action_type === 'START_QUEST' ? node.data.params?.quest_id : '';
        if (!qid) return;
        const b = document.createElement('button');
        b.className = 'action-btn';
        b.style.cssText = 'font-size:10px;margin-top:6px;width:100%';
        b.textContent = `🌿 Open quest ▸ ${qid}`;
        b.title = 'Commit this graph and open the referenced quest in VINE';
        b.onclick = () => vineJumpTo('quest', qid);
        jumpHost.appendChild(b);
      };

      const onChange = () => {
        editor._refreshNodeDisplay(nodeId);
        editor._fire('change');
        refreshJump();
      };
      if (paramContainer) _renderParamFields(paramContainer, AI_ACTIONS, 'action_type', node.data, onChange);
      refreshJump();
      if (sel) {
        sel.addEventListener('change', () => {
          node.data.action_type = sel.value;
          node.data.params = {};
          if (paramContainer) _renderParamFields(paramContainer, AI_ACTIONS, 'action_type', node.data, onChange);
          onChange();
        });
      }
    },
  },

  wait: {
    label: 'Wait',
    color: '#446688',
    defaultData: { seconds: 5 },
    renderBody: (n) => `<div style="font-size:11px;color:var(--text-dim)">${n.data.seconds || 0}s pause</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_aiHelpBox(id,
        'Suspends this entity\'s AI graph for N seconds. The graph won\'t be walked again until the timer expires. Useful for pacing SAY messages, adding a delay between attacks, or making patrol stops feel natural.',
        'seconds: 10\n\n→ entity pauses at current waypoint for 10s before continuing'
      )}
      ${_aiField('Seconds', `<input data-vine-field="data.seconds" data-vine-type="number" type="number" min="0" step="1" value="${n.data.seconds || 0}" style="${_AI_IS}">`)}
    `,
  },

  loop: {
    label: 'Loop',
    color: '#446644',
    defaultData: {},
    renderBody: () => `<div style="font-size:11px;color:var(--accent);letter-spacing:1px">↺ LOOP</div>`,
    getOutPorts: () => [{ key: 'next', label: 'next' }],
    renderProperties: (n, ed, id) => `
      ${_aiHelpBox(id,
        'Jumps to the connected node — or back to Start if unconnected — without stopping execution. Use this at the end of a branch to cycle the graph rather than ending it. Graphs without a Loop node end naturally after the last action, then restart next tick.',
        'PATROL → Loop → (back to Start)\n\nAttack → Loop\nPatrol → Loop\n→ both branches cycle back to Start each tick,\n  re-evaluating conditions every time'
      )}
      <div style="color:var(--text-dim);font-size:12px">Connect to the node you want to jump to, or leave unconnected to jump to Start.</div>`,
  },

  random: {
    label: 'Random Branch',
    color: '#886644',
    defaultData: { branches: [{ weight: 1 }, { weight: 1 }] },
    renderBody: (n) => {
      const branches = n.data.branches || [];
      return `<div style="font-size:11px;color:var(--text-dim)">${branches.length} branch${branches.length !== 1 ? 'es' : ''}</div>`;
    },
    getOutPorts: (n) => {
      const branches = n.data.branches || [];
      return branches.map((b, i) => ({
        key: `branch_${i}`,
        label: `branch ${i}${b.weight !== 1 ? ` (×${b.weight})` : ''}`,
      }));
    },
    renderProperties: (n, ed, id) => `
      ${_aiHelpBox(id,
        'Picks one output branch at random each tick. Weights are relative — a branch with weight 3 is three times as likely to be chosen as one with weight 1. Use this to add unpredictability: idle vs. wander vs. say something.',
        'Branch 0 (weight 3) → IDLE\nBranch 1 (weight 1) → SAY "..."\nBranch 2 (weight 1) → PATROL\n\n→ 60% idle, 20% say, 20% patrol'
      )}
      <div id="ai-branches-${id}"></div>
    `,
    afterRenderProperties(propsEl, node, editor, nodeId) {
      const container = propsEl.querySelector(`#ai-branches-${nodeId}`);
      if (container) _buildBranchEditor(container, node, editor, nodeId);
    },
  },
};

// ── Conversion: DB graph ↔ VINE graph ─────────────────────────────────────────

// Named output ports that carry graph edges (not node data). Kept in one place so the
// DB↔VINE (de)serialization below stays in lockstep with the runtime's normalizeGraph
// (server/engine/ai-behaviour.js) — a port missing here is silently dropped on save.
// branch_N ports (random nodes) are handled separately by prefix.
const AI_EDGE_PORTS = ['next', 'ifTrue', 'ifFalse', 'goToWork', 'haveLife', 'endShift', 'offWork'];

function _autoLayoutAI(dbGraph) {
  const pos = {};
  const W = 320, H = 170;
  const colRows = {};
  const visited = new Set();
  const queue = [{ id: dbGraph._start, col: 0 }];
  const nodes = dbGraph.nodes || {};

  while (queue.length) {
    const { id, col } = queue.shift();
    if (visited.has(id) || !nodes[id]) continue;
    visited.add(id);
    colRows[col] = (colRows[col] || 0);
    pos[id] = { x: col * W + 40, y: colRows[col] * H + 60 };
    colRows[col]++;

    const n = nodes[id];
    const nexts = [...AI_EDGE_PORTS.map(p => n[p]), ...Object.keys(n).filter(k => k.startsWith('branch_')).map(k => n[k])].filter(Boolean);
    const nextCols = n.ifTrue || n.ifFalse || (n.goToWork && n.haveLife) ? [col + 1, col + 2] : [col + 1];
    nexts.forEach((nid, i) => {
      if (!visited.has(nid)) queue.push({ id: nid, col: nextCols[i] || col + 1 });
    });
  }

  // Orphan nodes
  let orphanRow = Object.keys(pos).length;
  for (const id of Object.keys(nodes)) {
    if (!pos[id]) { pos[id] = { x: 40, y: orphanRow * H + 60 }; orphanRow++; }
  }
  return pos;
}

window.VineAISchema = {
  vineIdentity: { kind: 'behaviour', tagline: 'Behaviour tree', color: 'var(--accent3)', icon: '🧠' },
  nodeTypes: _aiNodeDefs,

  // DB format → VINE internal graph
  fromAiGraph(dbGraph) {
    if (!dbGraph || !dbGraph.nodes) return { nodes: {}, edges: [], _start: '' };

    const layout = _autoLayoutAI(dbGraph);
    const nodes = {};
    const edges = [];

    for (const [id, node] of Object.entries(dbGraph.nodes)) {
      const { type, _vine, ...rest } = node;
      const pos = _vine || layout[id] || { x: 40, y: 40 };

      // Split flat node keys into edge ports (→ edges) and node data (→ data).
      const fields = {};
      for (const [k, v] of Object.entries(rest)) {
        if (AI_EDGE_PORTS.includes(k) || k.startsWith('branch_')) {
          if (v) edges.push({ fromNode: id, fromPort: k, toNode: v });
        } else {
          fields[k] = v;
        }
      }

      nodes[id] = { type: type || 'action', x: pos.x, y: pos.y, data: { ...fields } };
    }

    return { nodes, edges, _start: dbGraph._start || '' };
  },

  // VINE internal graph → DB format
  toAiGraph(vineGraph) {
    const nodes = {};
    const edges = vineGraph.edges || [];

    // Find _start: prefer node with type 'start', else first node
    let _start = vineGraph._start || '';
    if (!_start) {
      const startNode = Object.entries(vineGraph.nodes || {}).find(([, n]) => n.type === 'start');
      _start = startNode ? startNode[0] : Object.keys(vineGraph.nodes || {})[0] || '';
    }

    for (const [id, node] of Object.entries(vineGraph.nodes || {})) {
      const data = { ...node.data };

      // Flatten every outgoing edge back onto the node as a port field. Any named port
      // (AI_EDGE_PORTS) and random-branch ports round-trip without an explicit case.
      const portFields = {};
      for (const e of edges) {
        if (e.fromNode !== id) continue;
        if (AI_EDGE_PORTS.includes(e.fromPort) || e.fromPort.startsWith('branch_')) {
          portFields[e.fromPort] = e.toNode;
        }
      }

      nodes[id] = {
        type: node.type,
        ...data,
        ...portFields,
        _vine: { x: node.x, y: node.y },
      };
    }

    return { _start, nodes };
  },
};
