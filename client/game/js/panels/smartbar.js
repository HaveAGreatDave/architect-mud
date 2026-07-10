// Smart action bar. A contextual row of verb buttons that re-reads the current
// room from #area-content on every look/move (driven by parseZoneInfo) and
// surfaces only the verbs that apply here. Shown when the player has Smart UI
// on (settings.smartUI, toggled in Settings — any device, not mobile-only).
//
// A verb button can now open a MULTI-STEP flow, not just a single target
// chooser: e.g. Switch → On/Off → which light. Flows are modelled as a tree of
// choice nodes and rendered in a stackable bottom-sheet with Back navigation.
// Single-option steps auto-advance, so a room with one enemy still fires Attack
// on the first tap while a room with three lights walks you down Switch→On→pick.
//
// Every actionable room entity ships as a .action-link span carrying
// data-action + data-target (see describe.js). Furniture links additionally
// carry data-actions — the piece's full affordance set (furnitureVerbs: from
// flags.interactions + the specialized-action registry) — so the bar offers
// sit/lie/lean/watch/switch only where they actually apply; doors carry
// data-lock so lock/unlock show only on lockable doors, and lights carry an
// adjacent .light-state (on/off) sibling for the switch label. This module is a
// thumb-friendly re-presentation of those links; each leaf fires a real command
// (attack/talk/take/loot/examine, turn on|off, open/close/lock/unlock, knock,
// look through, sit/lie/lean/watch, scavenge) via sendCmd.
import { sendCmd } from '../net.js';

// ── Flow node model ─────────────────────────────────────────────────────────
// A node is one of:
//   leaf:   { label, cmd, logLabel? }        — tapping it fires `cmd`
//   branch: { label, title, options:[node] } — tapping it opens the next step
// A top-level smart action is just the root branch (or leaf) shown on the bar.

// Title-case a raw target name for display (raw targets are lowercased for cmds).
function titleCase(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

// Build a branch that lets you pick one of `items`, mapping each to a node via
// `toNode`. Returns null when there's nothing to pick — the button won't show.
function pick(label, title, items, toNode) {
  if (!items || !items.length) return null;
  return { label, title, options: items.map(toNode) };
}

// ── Room scan ────────────────────────────────────────────────────────────────
// Read the live room into a structured model. Everything derives from the
// .action-link spans describe.js already emits — no new protocol.
function scanRoom(area) {
  const m = {
    enemies: [], npcs: [], players: [], items: [], corpses: [],
    furniture: [], windows: [], doors: [],
  };
  if (!area) return m;

  for (const el of area.querySelectorAll('span.action-link[data-action]')) {
    const action = el.dataset.action;
    const target = el.dataset.target;
    if (!action || !target) continue;
    const label = el.dataset.label || el.textContent.trim();
    const cls = el.classList;

    if (cls.contains('enemy-link')) m.enemies.push({ target, label, id: el.dataset.instanceId || '' });
    else if (cls.contains('npc-link')) m.npcs.push({ target, label });
    else if (cls.contains('player-link')) m.players.push({ target, label });
    else if (cls.contains('room-item')) m.items.push({ target, label });
    else if (cls.contains('corpse-link')) m.corpses.push({ target, label });
    else if (cls.contains('door-link')) {
      // data-target is "door <dir>"; strip to bare direction for other verbs.
      // data-lock is present ("owned"/"locked") only on doors that have a lock.
      const dir = target.replace(/^door\s+/i, '');
      m.doors.push({ target, dir, label, lock: el.dataset.lock || '' });
    } else if (cls.contains('furniture-link')) {
      if (action === 'look') {
        // Windows: data-target is "through <window>".
        m.windows.push({ target, label });
      } else {
        // data-actions carries this piece's full affordance set (server-derived
        // from flags.interactions + the specialized-action registry).
        const verbs = (el.dataset.actions || '').split(/\s+/).filter(Boolean);
        const entry = { target, label, verbs };
        // Lights carry an adjacent (on)/(off) state span, used for the switch label.
        const sib = el.nextElementSibling;
        if (sib && sib.classList.contains('light-state')) entry.on = sib.classList.contains('light-on');
        m.furniture.push(entry);
      }
    }
  }
  return m;
}

// ── The catalog ───────────────────────────────────────────────────────────────
// Ordered list of smart actions. Each build(m) returns a flow node or null.
// Kept generous on purpose so we can eyeball how crowded the bar gets.
const CATALOG = [
  // Personal device — always available regardless of room, so it's the fixed
  // left-hand anchor of the (otherwise context-sensitive) bar and rendered a
  // touch brighter than the room verbs. One tap opens Tablet OS, the home for
  // Skills/Stats/Map/Music/Bank/etc. now that those quick-cmd buttons are gone.
  { build: () => ({ label: 'Tablet', cmd: 'tablet', accent: true }) },

  // Combat / social — single target, fires immediately when there's just one.
  { build: (m) => pick('Attack', 'Attack what?', m.enemies,
      (e) => ({ label: e.label, cmd: `attack ${e.id || e.target.toLowerCase()}`, logLabel: `attack ${e.label}` })) },
  { build: (m) => pick('Talk', 'Talk to whom?', m.npcs,
      (n) => ({ label: n.label, cmd: `talk ${n.target.toLowerCase()}`, logLabel: `talk ${n.label}` })) },

  // Items on the ground — pick one, or grab everything.
  { build: (m) => {
      if (!m.items.length) return null;
      const opts = m.items.map((it) => ({ label: it.label, cmd: `take ${it.target.toLowerCase()}`, logLabel: `take ${it.label}` }));
      if (m.items.length > 1) opts.push({ label: 'Everything', cmd: 'take all' });
      return { label: 'Take', title: 'Take what?', options: opts };
    } },
  { build: (m) => pick('Loot', 'Loot which corpse?', m.corpses,
      (c) => ({ label: c.label, cmd: `loot ${c.target}`, logLabel: `loot ${c.label}` })) },

  // ⭐ The exemplar: Switch → On/Off → which light. Gated on the piece actually
  // affording `switch` (so streetlights and non-lights never offer it).
  { build: (m) => {
      const lights = m.furniture.filter((f) => f.verbs.includes('switch'));
      if (!lights.length) return null;
      const dirStep = (dir) => pick(titleCase(dir), `Turn ${dir} which light?`, lights,
        (l) => ({ label: `${titleCase(l.label)}${l.on === undefined ? '' : l.on ? ' (on)' : ' (off)'}`, cmd: `turn ${dir} ${l.target.toLowerCase()}`, logLabel: `turn ${dir} ${l.label}` }));
      return { label: 'Switch', title: 'Turn the light…', options: [dirStep('on'), dirStep('off')] };
    } },

  // Doors. Open/Close/Knock apply to any door; Lock/Unlock only to doors that
  // actually have a lock (data-lock present).
  { build: (m) => pick('Open', 'Open which door?', m.doors,
      (d) => ({ label: d.label, cmd: `open ${d.target}`, logLabel: `open ${d.label}` })) },
  { build: (m) => pick('Close', 'Close which door?', m.doors,
      (d) => ({ label: d.label, cmd: `close ${d.target}`, logLabel: `close ${d.label}` })) },
  { build: (m) => pick('Lock', 'Lock which door?', m.doors.filter((d) => d.lock),
      (d) => ({ label: d.label, cmd: `lock ${d.target}`, logLabel: `lock ${d.label}` })) },
  { build: (m) => pick('Unlock', 'Unlock which door?', m.doors.filter((d) => d.lock),
      (d) => ({ label: d.label, cmd: `unlock ${d.target}`, logLabel: `unlock ${d.label}` })) },
  { build: (m) => pick('Knock', 'Knock on which door?', m.doors,
      (d) => ({ label: d.label, cmd: `knock ${d.dir}`, logLabel: `knock ${d.label}` })) },

  // Windows.
  { build: (m) => pick('Look', 'Look through which window?', m.windows,
      (w) => ({ label: w.label, cmd: `look ${w.target}`, logLabel: `look ${w.label}` })) },

  // Furniture postures — only pieces that declare the affordance in data-actions.
  { build: (m) => pick('Sit', 'Sit on what?', m.furniture.filter((f) => f.verbs.includes('sit')),
      (f) => ({ label: f.label, cmd: `sit ${f.target.toLowerCase()}`, logLabel: `sit ${f.label}` })) },
  { build: (m) => pick('Lie', 'Lie on what?', m.furniture.filter((f) => f.verbs.includes('lie')),
      (f) => ({ label: f.label, cmd: `lie ${f.target.toLowerCase()}`, logLabel: `lie ${f.label}` })) },
  { build: (m) => pick('Lean', 'Lean on what?', m.furniture.filter((f) => f.verbs.includes('lean')),
      (f) => ({ label: f.label, cmd: `lean ${f.target.toLowerCase()}`, logLabel: `lean ${f.label}` })) },
  { build: (m) => pick('Watch', 'Watch what?', m.furniture.filter((f) => f.verbs.includes('watch')),
      (f) => ({ label: f.label, cmd: `watch ${f.target.toLowerCase()}`, logLabel: `watch ${f.label}` })) },

  // Examine anything named in the room.
  { build: (m) => {
      const all = [...m.furniture, ...m.npcs, ...m.players, ...m.enemies, ...m.items, ...m.corpses];
      return pick('Examine', 'Examine what?', all,
        (x) => ({ label: x.label, cmd: `examine ${x.target}`, logLabel: `examine ${x.label}` }));
    } },

  // Targetless verb — a plain one-tap button, no sheet.
  { build: () => ({ label: 'Search', cmd: 'scavenge' }) },
];

// Affordance verbs the curated CATALOG above already renders (postures + the
// switch synonyms + the always-on examine/look/door verbs). Anything a piece
// declares in data-actions that isn't here gets an auto-generated button.
const HANDLED = new Set(['sit', 'lie', 'lean', 'watch', 'switch', 'flip', 'turn', 'examine', 'look', 'open', 'close']);

// Build a button for every unrecognized affordance verb, grouped by verb across
// the furniture that declares it (e.g. Read/Drink/Use on the pieces that carry
// them). Curated verbs never come through here. These verbs aren't posture
// verbs, so they target the bare name — matching the server's verbTarget().
function autoVerbNodes(m) {
  const byVerb = new Map();
  for (const f of m.furniture) {
    for (const v of f.verbs) {
      if (HANDLED.has(v)) continue;
      if (!byVerb.has(v)) byVerb.set(v, []);
      byVerb.get(v).push(f);
    }
  }
  const nodes = [];
  for (const [verb, items] of byVerb) {
    nodes.push(pick(titleCase(verb), `${titleCase(verb)} what?`, items,
      (f) => ({ label: f.label, cmd: `${verb} ${f.target.toLowerCase()}`, logLabel: `${verb} ${f.label}` })));
  }
  return nodes;
}

// ── Sheet navigator ───────────────────────────────────────────────────────────
let _sheet = null;
function closeSheet() { _sheet?.remove(); _sheet = null; }

const PAGE_SIZE = 4; // options shown per sheet page before it paginates

// Collapse single-option steps so obvious paths fire on the first tap.
function descend(node) {
  while (node.options && node.options.length === 1) node = node.options[0];
  return node;
}

// Render one step of a flow. `stack` is the breadcrumb of branches we descended
// through (powers Back); `page` is the current page within a long option list.
function renderStep(node, stack, page = 0) {
  closeSheet();
  const options = node.options.filter(Boolean);
  const pages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  page = Math.min(Math.max(0, page), pages - 1);

  const overlay = document.createElement('div');
  overlay.className = 'smart-sheet-overlay';
  overlay.innerHTML = `
    <div class="smart-sheet">
      <div class="smart-sheet-title">${node.title || node.label || ''}</div>
      <div class="smart-sheet-list"></div>
      <div class="smart-sheet-pager"></div>
      <div class="smart-sheet-nav"></div>
    </div>`;

  const list = overlay.querySelector('.smart-sheet-list');
  for (const raw of options.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)) {
    const child = descend(raw);
    const btn = document.createElement('button');
    btn.className = 'smart-sheet-item';
    btn.textContent = child.label;
    btn.addEventListener('click', () => {
      if (child.options) renderStep(child, [...stack, node]);
      else { sendCmd(child.cmd, child.logLabel); closeSheet(); }
    });
    list.appendChild(btn);
  }

  // Pager row — only when the list spills past one page.
  const pager = overlay.querySelector('.smart-sheet-pager');
  if (pages > 1) {
    const prev = document.createElement('button');
    prev.className = 'smart-sheet-page';
    prev.textContent = '‹ Prev';
    prev.disabled = page === 0;
    prev.addEventListener('click', () => renderStep(node, stack, page - 1));
    const ind = document.createElement('span');
    ind.className = 'smart-sheet-page-ind';
    ind.textContent = `${page + 1}/${pages}`;
    const next = document.createElement('button');
    next.className = 'smart-sheet-page';
    next.textContent = 'Next ›';
    next.disabled = page === pages - 1;
    next.addEventListener('click', () => renderStep(node, stack, page + 1));
    pager.append(prev, ind, next);
  } else {
    pager.remove();
  }

  const nav = overlay.querySelector('.smart-sheet-nav');
  if (stack.length) {
    const back = document.createElement('button');
    back.className = 'smart-sheet-cancel';
    back.textContent = '‹ Back';
    back.addEventListener('click', () => renderStep(stack[stack.length - 1], stack.slice(0, -1)));
    nav.appendChild(back);
  }
  const cancel = document.createElement('button');
  cancel.className = 'smart-sheet-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeSheet);
  nav.appendChild(cancel);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  document.body.appendChild(overlay);
  _sheet = overlay;
}

// Entry point for a bar button: collapse trivial chains, then fire or open.
function runNode(node) {
  const n = descend(node);
  if (n.options) renderStep(n, []);
  else sendCmd(n.cmd, n.logLabel);
}

// ── Bar render ─────────────────────────────────────────────────────────────────
// Rebuild the smart bar from the live room. Called from parseZoneInfo on every
// look/move, so it always tracks the current room.
export function renderSmartBar() {
  const bar = document.getElementById('smart-bar');
  if (!bar) return;
  const m = scanRoom(document.getElementById('area-content'));

  // Curated buttons first, then an auto-generated one per unrecognized affordance.
  const nodes = [];
  for (const entry of CATALOG) {
    const node = entry.build(m);
    if (node) nodes.push(node);
  }
  nodes.push(...autoVerbNodes(m).filter(Boolean));

  bar.textContent = '';
  for (const node of nodes) {
    // Show the choice count on branches so "Open (3)" hints at the sheet.
    const opts = node.options ? node.options.filter(Boolean) : null;
    const btn = document.createElement('button');
    btn.className = node.accent ? 'smart-btn smart-btn-accent' : 'smart-btn';
    btn.textContent = opts && opts.length > 1 ? `${node.label} (${opts.length})` : node.label;
    btn.addEventListener('click', () => runNode(node));
    bar.appendChild(btn);
  }

  // Collapse the row entirely when the room offers no actions.
  bar.classList.toggle('smart-bar-empty', nodes.length === 0);
}
