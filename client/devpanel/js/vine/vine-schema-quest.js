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
const _Q_KINDS = [
  ['kill', 'Kill (a species of enemy)'], ['assassinate', 'Assassinate (a named NPC)'],
  ['give', 'Give / turn in'], ['retrieve', 'Retrieve item (spawns)'],
  ['visit', 'Visit'], ['escort', 'Escort NPC to a zone'], ['deliver', 'Deliver (flight)'],
  ['talk', 'Talk to an NPC'], ['buy', 'Buy from a vendor'], ['sell', 'Sell to a vendor'],
  ['craft', 'Craft an item'], ['equip', 'Equip / wear an item'],
  ['hack', 'Hack something'], ['spend', 'Spend credits'], ['survive', 'Survive a storm outdoors'],
  ['install', 'Install an augment'], ['mutate', 'Gain a mutation'],
  ['subdue', 'Knock someone out (alive)'], ['restore', 'Die and be restored (a claimed death)'],
];
// Kinds carrying a SECOND zone field alongside their target ('Spawn / find zone' for
// retrieve, 'Deliver them to' for escort). Both round-trip through the objective's
// `zone` key — see fromQuest/toQuest.
const _Q_ZONE_KINDS = new Set(['retrieve', 'escort']);
// Kinds whose ONE field is a zone rather than a target — the objective's `zone` key
// IS its target field, and there's no second box.
const _Q_ZONE_ONLY = new Set(['visit', 'deliver', 'hack']);
// Kinds where a blank target legitimately means "anything counts" (buy 3 of ANYTHING,
// hack ANY till, survive ANY storm). Says so in the field label so it doesn't read
// like an unfilled box.
const _Q_ANY_OK = new Set(['buy', 'sell', 'craft', 'hack', 'spend', 'survive', 'install', 'mutate', 'witnessed']);
// Kinds with NO target field at all — the event either happened to you or it did
// not, and there is nothing to narrow it to. An empty box the author can't fill
// reads as a thing they forgot, so these hide it rather than label it.
const _Q_NO_TARGET = new Set(['restore', 'spotted', 'broke', 'died']);
// Failure conditions reuse every objective kind (an event that ADVANCES a quest
// reads just as well as one that BLOWS it), plus the ones that only make sense as
// failures. Timeout leads because it's the common case.
const _Q_FAIL_KINDS = [
  ['timeout', 'Ran out of time'], ['escort_lost', 'Lost the escortee'],
  ['spotted', 'Was seen (stealth blown)'], ['witnessed', 'The crime was witnessed'],
  ['broke', 'Broke a piece of gear'], ['died', 'Died (an ordinary death)'],
  ..._Q_KINDS.filter(([k]) => k !== 'deliver'),
];
function _qTargetLabel(kind) {
  if (_Q_NO_TARGET.has(kind)) return [null, ''];
  if (kind === 'escort_lost') return ['NPC id (or part of their name) — blank = any escortee', 'npc_vale'];
  const any = _Q_ANY_OK.has(kind) ? ' — blank = anything counts' : '';
  if (kind === 'give' || kind === 'retrieve') return ['Item ID', 'medkit'];
  if (kind === 'equip') return ['Item ID', 'dinner_jacket'];
  if (kind === 'buy' || kind === 'sell' || kind === 'craft') return [`Item ID${any}`, 'medkit'];
  if (_Q_ZONE_ONLY.has(kind)) return [`Zone ID${any}`, 'zone_downtown_alley'];
  if (kind === 'assassinate' || kind === 'escort' || kind === 'talk') return ['NPC id (or part of their name)', 'npc_vale'];
  if (kind === 'spend') return [`Spent-on filter${any}`, 'vendor'];
  if (kind === 'survive') return [`Storm type${any}`, 'acid_rain'];
  if (kind === 'install') return [`Augment ID${any}`, 'aug_cortical_stack'];
  if (kind === 'mutate') return [`Mutation ID${any}`, 'mut_gill_slits'];
  if (kind === 'subdue') return ['NPC id (or part of their name)', 'npc_vale'];
  if (kind === 'witnessed') return [`Crime key${any}`, 'burglary'];
  return ['Enemy target', 'sewer_rat'];
}
// 'spend' counts CREDITS, everything else counts repetitions — worth saying on the
// field, since "count: 5000" reads as an absurd number of anything else.
function _qCountLabel(kind) {
  return kind === 'spend' ? 'Credits to spend' : 'Count';
}

// Flight-template settings — only shown when the quest node's questType is
// 'flight_template'. Drives plugins/flight/contracts.js's board generator (topUp).
// Broken out of the old single JSON blob into first-class fields (the vine-core
// binder only supports one-level "data.<key>" paths, so each field binds to a flat
// `fm*` key; fromQuest seeds them off the row's meta and toQuest reassembles the
// meta object). Shape rebuilt: { kind, legal, payMult, riskBase, wMin, wMax,
// deadlineMins, names:[...], destZone? }. See scripts/migrate-flight-job-types.js
// for the seed shape.
const _FM_KIND = [['cargo', 'Cargo haul'], ['passenger', 'Passenger charter']];
const _FM_LEGAL = [['legal', 'Legal'], ['illegal', 'Contraband (fly dark)']];
function _qFlightMetaFields(d) {
  const names = d.fmNames != null ? d.fmNames : '';
  return `
    <div style="margin:10px 0 6px;padding-top:8px;border-top:1px solid var(--border)">
      <label style="${_QL};color:var(--accent)">✈ Flight template settings</label>
    </div>
    ${_qField('Job kind', _qSelect('data.fmKind', _FM_KIND, d.fmKind || 'cargo'))}
    ${_qField('Legality', _qSelect('data.fmLegal', _FM_LEGAL, d.fmLegal || 'legal'))}
    ${_qField('Land at (fixed destination airfield — blank = random)', _qInput('data.fmDest', d.fmDest, 'zone_slag_gate'))}
    ${_qField('Pay multiplier', _qInput('data.fmPayMult', d.fmPayMult ?? 1.0, '1.0', 'number'))}
    ${_qField('Risk base (0–5)', _qInput('data.fmRisk', d.fmRisk ?? 0, '0', 'number'))}
    ${_qField('Cargo weight min (kg)', _qInput('data.fmWMin', d.fmWMin ?? 40, '40', 'number'))}
    ${_qField('Cargo weight max (kg)', _qInput('data.fmWMax', d.fmWMax ?? 100, '100', 'number'))}
    ${_qField('Deadline (minutes)', _qInput('data.fmDeadline', d.fmDeadline ?? 20, '20', 'number'))}
    ${_qField('Cargo / passenger descriptions (one per line)', _qTextarea('data.fmNames', names, 4))}`;
}
// Seed the flat fm* editing fields off a row's meta (round-trips even if untouched).
function _fmFromMeta(m) {
  m = (m && typeof m === 'object') ? m : {};
  return {
    fmKind: m.kind || 'cargo',
    fmLegal: m.legal === false ? 'illegal' : 'legal',
    fmDest: m.destZone || '',
    fmPayMult: m.payMult ?? 1.0,
    fmRisk: m.riskBase ?? 0,
    fmWMin: m.wMin ?? 40,
    fmWMax: m.wMax ?? 100,
    fmDeadline: m.deadlineMins ?? 20,
    fmNames: Array.isArray(m.names) ? m.names.join('\n') : '',
  };
}

const _questNodeDefs = {
  quest: {
    label: 'Quest',
    color: '#a04488',
    defaultData: { name: '', description: '', repeatable: false, questType: 'standard', meta: {}, ..._fmFromMeta({}) },
    renderBody: (n) => `<div style="font-size:11px;color:var(--accent)">${_escQ(n.data.name || '(unnamed quest)')}</div>
      ${n.data.questType === 'flight_template' ? '<div style="font-size:10px;color:var(--text-dim)">✈ flight template</div>' : ''}
      ${n.data.repeatable ? '<div style="font-size:10px;color:var(--text-dim)">repeatable</div>' : ''}`,
    getOutPorts: () => [{ key: 'start', label: 'available' }],
    renderProperties: (n, ed, id) => `
      ${_qHelp(id,
        'The quest itself. Objectives wired to the "available" port are active from the moment the quest starts. This is the single start node — one per graph. Quest Type "Flight Contract Template" makes this an authored pilot-contract archetype (plugins/flight/contracts.js rolls concrete board postings from it) — the ✈ Flight template settings appear below for those. Re-open this panel after changing Quest Type to reveal/hide them.',
        'name: Pest Control\ndescription: The super wants the sewer rats gone.'
      )}
      ${_qField('Name', _qInput('data.name', n.data.name, 'Pest Control'))}
      ${_qField('Description', _qTextarea('data.description', n.data.description, 3))}
      ${_qField('Repeatable?', _qSelect('data.repeatable', [[false, 'One-time'], [true, 'Repeatable']], !!n.data.repeatable))}
      ${_qField('Quest Type', _qSelect('data.questType', [['standard', 'Standard (incl. job board)'], ['flight_template', 'Flight Contract Template']], n.data.questType || 'standard'))}
      ${n.data.questType === 'flight_template'
        ? _qFlightMetaFields(n.data)
        : _qField('Advanced meta (JSON)', _qTextarea('data.meta', JSON.stringify(n.data.meta || {}, null, 2), 4, true))}
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
    defaultData: { kind: 'kill', target: '', count: 1, desc: '', spawnZone: '', spawn: 'spawn', emotes: '', taskSeconds: '' },
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
        'One goal that advances by world events. Kind picks the event: kill an enemy, give/turn in an item, visit a zone, retrieve an item, assassinate a named NPC, or escort one somewhere. "Retrieve item" completes when the player picks up the named item, and (unless auto-spawn is off) drops a fresh copy into the spawn zone the moment the quest starts, so it is always there to find. "Assassinate" names a PERSON where "Kill" names a species — any three rats satisfy a kill, only that one NPC satisfies an assassination. "Escort" is met when that NPC ARRIVES at the delivery zone walking with the player; give the NPC flags.escortable, or have their dialogue fire ESCORT_START, and remember they can be killed on the way. The commerce/act kinds (buy, sell, craft, equip, hack, spend, survive) take a blank target to mean "anything counts". "Spend" is counted in CREDITS, not in purchases. "Survive" means standing OUTDOORS from the peak of a named storm through to the all-clear — ducking inside earns nothing. Draw an edge from another objective\'s "unlocks" port into this one to gate it — it stays hidden until the prerequisite is done. No incoming objective edge = available from quest start.',
        'kind: retrieve\ntarget: ancient_relic\nspawnZone: zone_sewers\ncount: 1\ndesc: Recover the ancient relic from the sewers'
      )}
      ${_qField('Kind', _qSelect('data.kind', _Q_KINDS, n.data.kind))}
      ${tlabel ? _qField(tlabel, _qInput('data.target', n.data.target, tph)) : ''}
      ${n.data.kind === 'retrieve' ? `
      ${_qField('Spawn / find zone', _qInput('data.spawnZone', n.data.spawnZone, 'zone_sewers'))}
      ${_qField('Auto-spawn the item?', _qSelect('data.spawn', [['spawn', 'Yes — drop it in that zone on quest start'], ['nospawn', 'No — it already exists in the world']], n.data.spawn || 'spawn'))}
      ` : ''}
      ${n.data.kind === 'escort' ? _qField('Deliver them to (zone)', _qInput('data.spawnZone', n.data.spawnZone, 'zone_clinic')) : ''}
      ${_qField(_qCountLabel(n.data.kind), _qInput('data.count', n.data.count ?? 1, n.data.kind === 'spend' ? '5000' : '1', 'number'))}
      ${_qField('Description', _qTextarea('data.desc', n.data.desc, 2))}
      ${_qField('Action lines — flavour shown to the room each tick (one per line, {who} = player; blank = none)',
        _qTextarea('data.emotes', n.data.emotes, 3))}
      ${n.data.kind === 'visit' ? _qField('Task time (seconds) — how long standing here takes; a random Action line fires every couple seconds (blank/0 = completes instantly)',
        _qInput('data.taskSeconds', n.data.taskSeconds ?? '', '5', 'number')) : ''}
      <div style="font-size:10px;color:var(--text-dim);line-height:1.4">Re-open this panel after changing Kind to relabel the target field,${' '}reveal retrieve options, and show/hide the visit task timer.</div>
    `;
    },
  },

  // A failure condition. Deliberately the SAME kinds as an objective, because that
  // is exactly what the runtime does with it: `quests.fail_on` is evaluated by the
  // same predicates against the same events, only it blows the quest instead of
  // advancing it. Two kinds are failure-only and have no objective counterpart —
  // a timeout and a lost escortee.
  fail: {
    label: 'Fails if',
    color: '#aa4444',
    defaultData: { kind: 'timeout', target: '', count: 300, desc: '' },
    renderBody: (n) => {
      const k = n.data.kind || 'timeout';
      const body = k === 'timeout'
        ? `after ${Number(n.data.count) || 0}s`
        : `${_escQ(k)}: ${_escQ(n.data.target || 'anything')}`;
      return `<div style="font-size:11px;color:#dd8888">${body}</div>
        ${n.data.desc ? `<div style="font-size:10px;color:var(--text-dim)">${_escQ((n.data.desc || '').slice(0, 48))}</div>` : ''}`;
    },
    getOutPorts: () => [],
    renderProperties: (n, ed, id) => {
      const kind = n.data.kind || 'timeout';
      const [tlabel, tph] = _qTargetLabel(kind);
      return `
      ${_qHelp(id,
        'A way this quest can BLOW. Same kinds as an objective and judged the same way — "assassinate npc_vale" as an objective means kill him, as a failure means he must not die. Two kinds are failure-only: "Ran out of time" (measured from the moment the quest was taken) and "Lost the escortee". A failed quest can be taken again from the start unless the quest node\'s meta sets failPermanent. Fail nodes need no edges — they are always live while the quest is.',
        'kind: timeout\ncount: 600\ndesc: The meet was over by then.'
      )}
      ${_qField('Kind', _qSelect('data.kind', _Q_FAIL_KINDS, kind))}
      ${kind === 'timeout'
        ? _qField('Seconds allowed (from taking the quest)', _qInput('data.count', n.data.count ?? 300, '300', 'number'))
        : (tlabel ? _qField(tlabel, _qInput('data.target', n.data.target, tph)) : '')}
      ${_qField('Failure line shown to the player (blank = a generic one)', _qTextarea('data.desc', n.data.desc, 2))}
      <div style="font-size:10px;color:var(--text-dim);line-height:1.4">Re-open this panel after changing Kind to relabel the field.</div>
    `;
    },
  },

  // What failing COSTS you. The mirror of Reward, and deliberately the same shape
  // minus items — the package being gone is usually why the quest failed, so
  // confiscating it is a no-op that reads like a bug. Edgeless like the fail nodes:
  // penalties apply whenever the quest fails, however it failed.
  penalty: {
    label: 'Penalty',
    color: '#8a5a2b',
    defaultData: { credits: 0, rep: [], flags: [] },
    renderBody: (n) => {
      const reps = Array.isArray(n.data.rep) ? n.data.rep.length : 0;
      const bits = [];
      if (n.data.credits) bits.push(`−₵${n.data.credits}`);
      if (reps) bits.push(`${reps} rep hit${reps > 1 ? 's' : ''}`);
      return `<div style="font-size:11px;color:#cc9955">${bits.join(' + ') || '(no penalty)'}</div>`;
    },
    getOutPorts: () => [],
    renderProperties: (n, ed, id) => `
      ${_qHelp(id,
        'Applied when this quest FAILS, however it failed. Without a penalty, failing costs you nothing you had and every failure condition is cosmetic — you just take the quest again. Credits are stated POSITIVE and taken; a player is never pushed below zero. Reputation is a list of {ideology, delta} — negative deltas are the point. No item confiscation: the thing you were carrying is usually already gone, which is WHY it failed.',
        'credits: 200\nrep: [{"ideology":"ascendants","delta":-5}]\nflags: [{"scope":"player","flag":"vale_wont_talk","value":"true"}]'
      )}
      ${_qField('Credits taken', _qInput('data.credits', n.data.credits ?? 0, '0', 'number'))}
      ${_qField('Reputation (JSON)', _qTextarea('data.rep', JSON.stringify(n.data.rep || [], null, 2), 3, true))}
      ${_qField('Flags (JSON)', _qTextarea('data.flags', JSON.stringify(n.data.flags || [], null, 2), 3, true))}
    `,
  },

  reward: {
    label: 'Reward',
    color: '#b8912b',
    defaultData: { credits: 0, xp: 0, items: [], flags: [], rep: [] },
    renderBody: (n) => {
      const items = Array.isArray(n.data.items) ? n.data.items.length : 0;
      const reps = Array.isArray(n.data.rep) ? n.data.rep.length : 0;
      const bits = [];
      if (n.data.credits) bits.push(`₵${n.data.credits}`);
      if (n.data.xp) bits.push(`${n.data.xp} xp`);
      if (items) bits.push(`${items} item${items > 1 ? 's' : ''}`);
      if (reps) bits.push(`${reps} standing${reps > 1 ? 's' : ''}`);
      return `<div style="font-size:11px;color:#b8912b">${bits.join(' + ') || '(no reward)'}</div>`;
    },
    getOutPorts: () => [],
    renderProperties: (n, ed, id) => `
      ${_qHelp(id,
        'Granted when every objective feeding this node is complete. Items, flags and reputation are JSON arrays; leave blank for none. Reputation is the mirror of the Penalty node\'s — a list of {ideology, delta} — and it is how faction work PAYS. Standing decays on a 30-day half-life by design (it is meant to be kept up, not banked), so an order you want players to stay in needs repeatable work that pays it. The player is told only when a reward crosses them into a new TIER; a move within one passes without comment, which is what stops a repeatable printing a line every hand-in.',
        'credits: 250\nxp: 50\nitems: [{"item_id":"pistol","quantity":1}]\nrep: [{"ideology":"ideology_ascendants","delta":40}]\nflags: [{"scope":"player","flag":"super_trusts_me","value":"true"}]'
      )}
      ${_qField('Credits', _qInput('data.credits', n.data.credits ?? 0, '0', 'number'))}
      ${_qField('XP', _qInput('data.xp', n.data.xp ?? 0, '0', 'number'))}
      ${_qField('Items (JSON)', _qTextarea('data.items', JSON.stringify(n.data.items || [], null, 2), 3, true))}
      ${_qField('Reputation (JSON)', _qTextarea('data.rep', JSON.stringify(n.data.rep || [], null, 2), 3, true))}
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
        // retrieve carries a spawn/find zone alongside its item target, and a
        // toggle for whether the engine drops the item in on quest start.
        spawnZone: _Q_ZONE_KINDS.has(kind) ? (o.zone || '') : '',
        spawn: o.spawn === false ? 'nospawn' : 'spawn',
        // Action lines edited as one-per-line text (accepts the legacy singular `emote`);
        // task delay is per-objective (visit only) — both round-trip back in toQuest.
        emotes: Array.isArray(o.emotes) ? o.emotes.join('\n') : (o.emote ? String(o.emote) : ''),
        taskSeconds: o.taskSeconds != null ? o.taskSeconds : '',
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
    nodes.quest = { type: 'quest', x: 40, y: 40, data: { name: rec.name || '', description: rec.description || '', repeatable: !!rec.repeatable, questType: rec.quest_type || 'standard', meta: (rec.meta && typeof rec.meta === 'object') ? rec.meta : {}, _questId: rec.id || '', ..._fmFromMeta(rec.meta) } };

    // Objective nodes + gating edges.
    const dependedOn = new Set();
    objs.forEach(o => o.requires.forEach(r => dependedOn.add(r)));
    objs.forEach(o => {
      const p = o._vine || pos[o.id] || { x: 340, y: 60 };
      nodes[o.id] = { type: 'objective', x: p.x, y: p.y, data: { kind: o.kind, target: o.target, count: o.count, desc: o.desc, spawnZone: o.spawnZone, spawn: o.spawn, emotes: o.emotes, taskSeconds: o.taskSeconds } };
      if (o.requires.length) {
        o.requires.forEach(r => { if (byId[r]) edges.push({ fromNode: r, fromPort: 'unlocks', toNode: o.id }); });
      } else {
        edges.push({ fromNode: 'quest', fromPort: 'start', toNode: o.id });
      }
    });

    // Failure nodes. Edgeless by design — a fail condition is live for as long as
    // the quest is, so there is nothing for a wire to say. Laid out in a column
    // under the quest node rather than in the objective flow, because they aren't
    // steps in it.
    (Array.isArray(rec.fail_on) ? rec.fail_on : []).forEach((f, i) => {
      const p = f._vine || { x: 40, y: 260 + i * 130 };
      nodes[`fail_${i}`] = {
        type: 'fail', x: p.x, y: p.y,
        data: {
          kind: f.type || 'timeout',
          target: f.target ?? f.item_id ?? f.zone ?? '',
          count: f.count ?? 300,
          desc: f.desc || '',
        },
      };
    });

    // Penalty node — one per graph, and only drawn when the quest actually has
    // penalties, so an ordinary quest's canvas isn't cluttered by an empty box.
    const pen = (rec.penalties && typeof rec.penalties === 'object') ? rec.penalties : {};
    if (pen.credits || (pen.rep || []).length || (pen.flags || []).length) {
      const pp = pen._vine || { x: 340, y: 260 + (rec.fail_on || []).length * 130 };
      nodes.penalty = {
        type: 'penalty', x: pp.x, y: pp.y,
        data: { credits: pen.credits || 0, rep: pen.rep || [], flags: pen.flags || [] },
      };
    }

    // Reward node, fed by terminal objectives (or the quest itself if no objectives).
    const rewards = rec.rewards && typeof rec.rewards === 'object' ? rec.rewards : {};
    const rewardPos = rewards._vine || { x: rewardCol * 300 + 40, y: 60 };
    nodes.reward = { type: 'reward', x: rewardPos.x, y: rewardPos.y, data: { credits: rewards.credits || 0, xp: rewards.xp || 0, items: rewards.items || [], rep: rewards.rep || [], flags: rewards.flags || [] } };
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
      // Which objective key the single target box writes to. Item-shaped kinds land
      // in item_id, zone-shaped ones in zone, everything else in the generic target.
      const key = (kind === 'give' || kind === 'retrieve' || kind === 'equip') ? 'item_id'
        : _Q_ZONE_ONLY.has(kind) ? 'zone'
        : 'target';
      const obj = {
        id,
        type: kind,
        [key]: node.data.target || '',
        count: Number(node.data.count) || 1,
        desc: node.data.desc || '',
        _vine: { x: node.x, y: node.y },
      };
      // retrieve: the item lives in item_id (above); the zone it spawns/is-found
      // in is a separate field, plus the auto-spawn toggle the engine reads.
      if (kind === 'retrieve') {
        obj.zone = node.data.spawnZone || '';
        obj.spawn = node.data.spawn !== 'nospawn';
      }
      // escort: the NPC lives in `target` (above), the delivery zone rides the same
      // second field retrieve uses. No spawn toggle — the escortee is a real NPC
      // already standing in the world, never conjured.
      if (kind === 'escort') obj.zone = node.data.spawnZone || '';
      // Action lines: one-per-line text → array (only when non-empty, so an
      // untouched objective stays clean). Task delay is visit-only.
      const emotes = String(node.data.emotes || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (emotes.length) obj.emotes = emotes;
      const ts = Number(node.data.taskSeconds);
      if (kind === 'visit' && ts > 0) obj.taskSeconds = ts;
      if (requires.length) obj.requires = requires;
      objectives.push(obj);
    }

    // Failure conditions. Same key mapping as an objective, so an author who wrote
    // "assassinate npc_vale" as a fail node gets the identical shape they'd get
    // from the objective node — which is precisely why the runtime can judge both
    // with one predicate.
    const fail_on = [];
    for (const [, node] of Object.entries(vnodes)) {
      if (node.type !== 'fail') continue;
      const kind = node.data.kind || 'timeout';
      const cond = { type: kind, _vine: { x: node.x, y: node.y } };
      if (kind === 'timeout') {
        cond.count = Number(node.data.count) || 0;
      } else {
        const key = (kind === 'give' || kind === 'retrieve' || kind === 'equip') ? 'item_id'
          : _Q_ZONE_ONLY.has(kind) ? 'zone'
          : 'target';
        cond[key] = node.data.target || '';
      }
      if (node.data.desc) cond.desc = node.data.desc;
      fail_on.push(cond);
    }

    const penaltyNode = Object.entries(vnodes).find(([, n]) => n.type === 'penalty');
    const penalties = penaltyNode ? {
      credits: Number(penaltyNode[1].data.credits) || 0,
      rep: Array.isArray(penaltyNode[1].data.rep) ? penaltyNode[1].data.rep : [],
      flags: Array.isArray(penaltyNode[1].data.flags) ? penaltyNode[1].data.flags : [],
      _vine: { x: penaltyNode[1].x, y: penaltyNode[1].y },
    } : {};

    // xp must be carried here as well as rendered. It is paid at runtime
    // (plugins/quests TURN_IN → grantXp) and shipped content relies on it, so a
    // reward node that forgets it silently zeroes the XP of every quest ever
    // opened and saved in this editor. `rep` is here for the same reason and is
    // the newer of the two — a faction quest that loses its standing on a save
    // still pays credits, so the loss reads as nothing at all.
    const rewards = rewardNode ? {
      credits: Number(rewardNode[1].data.credits) || 0,
      xp: Number(rewardNode[1].data.xp) || 0,
      items: Array.isArray(rewardNode[1].data.items) ? rewardNode[1].data.items : [],
      rep: Array.isArray(rewardNode[1].data.rep) ? rewardNode[1].data.rep : [],
      flags: Array.isArray(rewardNode[1].data.flags) ? rewardNode[1].data.flags : [],
      _vine: { x: rewardNode[1].x, y: rewardNode[1].y },
    } : {};

    const questType = questNode ? (questNode.data.questType || 'standard') : 'standard';
    // Flight templates rebuild their meta from the first-class fm* fields; every
    // other quest type keeps whatever meta it carried (task timing is now per-
    // objective — obj.taskSeconds — not quest meta).
    let meta = (questNode && questNode.data.meta && typeof questNode.data.meta === 'object') ? questNode.data.meta : {};
    if (questType === 'flight_template' && questNode) {
      const d = questNode.data;
      const num = (v, def) => { const x = Number(v); return Number.isFinite(x) ? x : def; };
      const names = String(d.fmNames || '').split('\n').map(s => s.trim()).filter(Boolean);
      meta = {
        kind: d.fmKind || 'cargo',
        legal: (d.fmLegal || 'legal') !== 'illegal',
        payMult: num(d.fmPayMult, 1.0),
        riskBase: num(d.fmRisk, 0),
        wMin: num(d.fmWMin, 40),
        wMax: num(d.fmWMax, 100),
        deadlineMins: num(d.fmDeadline, 20),
        names: names.length ? names : ['a shipment'],
      };
      if (d.fmDest) meta.destZone = String(d.fmDest).trim();
    }

    return {
      name: questNode ? (questNode.data.name || '') : '',
      description: questNode ? (questNode.data.description || '') : '',
      repeatable: questNode ? !!questNode.data.repeatable : false,
      quest_type: questType,
      meta,
      objectives,
      rewards,
      fail_on,
      penalties,
    };
  },
};
