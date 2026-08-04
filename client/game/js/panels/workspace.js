// PREPARATION WORKSPACE — the client half of the `workspace` HUD.
//
// A text panel, not an inventory screen. Monospace, rules, tables, status
// readouts. No icons, no drag-and-drop, no cards. The point is density: the
// whole working area on one screen, so the answer to "what am I actually doing"
// is a glance instead of five examines.
//
// This file holds NO game knowledge. It does not know what a pan is, what
// "raw" means, or which verb chops an onion. It renders whatever the server put
// in the payload — which is what lets a chemistry bench reuse it untouched.
//
// Phase 1 is read-only. There is nothing to click but Refresh and Close, and
// the panel keeps no state the server needs to hear about: closing it is a
// purely local act, refreshing it is one more `workspace`.
import { sendCmd, sendCmdSilent } from '../net.js';

let active = false;
// The last payload, kept so selecting a recipe can re-render without a round
// trip — picking one is a way of LOOKING at what you already have, not a
// question for the server.
let lastData = null;
// The recipes the player is currently reading, by key. Everything they would use
// is highlighted wherever it appears — in the fridge, in the cabinet, in your
// hands — which is the answer to "what do I need to get out".
//
// A SET, not one key: planning a meal is several dishes, and "what do I need for
// all of this" is the question worth answering. The highlight is the union, which
// slightly overstates when two recipes want the same onion — each `uses` was
// computed independently — so it reads as "these rows are involved" rather than
// as an exact allocation. Saying that plainly is better than pretending to an
// accuracy a union can't have.
let selected = new Set();
// id -> Set of the 1-based ordinals of the open recipes that would use it. A
// plain "this row is involved" was honest about the union but silent about WHICH
// recipe, which is the question you actually have when two are open.
let wanted = new Map();
// recipe key -> its 1-based ordinal, in the order the player opened them.
let ordinals = new Map();
// Set while a cook is in progress somewhere on the panel. See scheduleTick.
let tickTimer = null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function el(id) { return document.getElementById(id); }

export function openWorkspacePanel(data) {
  active = true;
  render(data);
  el('workspace-panel').classList.add('active');
}

export function refreshWorkspacePanel(data) {
  if (!active) return;
  render(data);
}

export function isWorkspaceOpen() { return active; }

export function closeWorkspacePanel() {
  active = false;
  selected = new Set();
  wanted = new Map();
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  el('workspace-panel')?.classList.remove('active');
}

// LIVE REFRESH, but only when something is actually moving.
//
// A cook is the one thing on this panel with a clock — everything else changes
// only when you act, and the panel already refreshes on an action. So an idle
// workspace sends nothing at all, and a pan on the heat costs one refresh every
// few seconds. That gating is the whole reason this is affordable: a blanket
// poll would be two queries per player per tick for a panel that is usually
// staring at a cold cabinet.
const TICK_MS = 5000;
function scheduleTick(data) {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  const live = (data.area || []).some(v => v.hot)
    || (data.components || []).some(c => c.live)
    || (data.area || []).some(v => (v.contents || []).some(c => c.live));
  if (!live || !active) return;
  tickTimer = setTimeout(() => { if (active) sendCmdSilent('workspace'); }, TICK_MS);
}

// ── rendering ────────────────────────────────────────────────────────────────

// One component line. Everything after the name is dim — the name is what you
// scan for, the state is what you check once you've found it.
// The action strip. Every button carries the literal command in `data-cmd` and
// shows it in the tooltip — the panel is meant to TEACH the verb, not replace
// it, so a player who reads the tooltip a few times stops needing the panel.
//
// A `command` ending in a space is a PREFIX: the verb needs a second object the
// HUD can't choose (`marinate steak in …`). Those fill the input line instead of
// firing, which is the honest thing to do with a half-formed command.
function actionStrip(actions) {
  if (!(actions || []).length) return '';
  return `<span class="wsp-acts">` + actions.map(a => {
    const partial = a.command.endsWith(' ');
    return `<button class="wsp-act${partial ? ' wsp-act-partial' : ''}" data-cmd="${esc(a.command)}"`
      + ` title="${esc(a.command.trim())}${a.hint ? ` — ${esc(a.hint)}` : ''}">${esc(a.label)}</button>`;
  }).join('') + `</span>`;
}

// The cook meter. PIPS, not a bar and never a countdown: `stage` is which beat
// of the prose the food is on, and the server deliberately knows nothing finer —
// deciding when to plate is the largest quality lever in the kitchen, and a
// percentage would hand that half of the game over. Past the finish there is no
// beat to count towards, so the window says so in a word instead.
function cookMeter(cook) {
  if (!cook) return '';
  if (cook.phase === 'window') return `<span class="wsp-window">READY — plate it</span>`;
  if (cook.phase === 'over') return `<span class="wsp-over">PAST IT</span>`;
  if (cook.phase === 'burnt') return `<span class="wsp-burnt">BURNING</span>`;
  if (!cook.stages) return '';
  const pips = Array.from({ length: cook.stages }, (_, i) => (i < cook.stage ? '●' : '○')).join('');
  return `<span class="wsp-pips${cook.phase === 'thaw' ? ' wsp-thaw' : ''}">${pips}</span>`;
}

function componentLine(c, indent = 0) {
  const notes = (c.notes || []).length ? `<span class="wsp-note"> · ${esc(c.notes.join(' · '))}</span>` : '';
  const state = c.state ? `<span class="wsp-state"> — ${esc(c.state)}</span>` : '';
  const qty = c.qty ? `<span class="wsp-qty"> ×${c.qty}</span>` : '';
  const meter = c.cook ? ` ${cookMeter(c.cook)}` : '';
  // Wanted by the recipe you're reading. The marker goes in front so a column of
  // twenty fridge items reads as a list with four things picked out of it,
  // rather than twenty things of subtly different colours — which is also why the
  // NAME is left alone: the marker is the signal, and recolouring the row as well
  // was the second colour that argument warns about.
  //
  // With more than one recipe open the marker carries their ordinals, so a row
  // wanted by both says so rather than leaving the union to be guessed at.
  //
  // The ARROW keeps the fixed gutter it was designed with and the digits ride in
  // the flow after it — widening the gutter itself would hang a two-digit marker
  // outside the section on an unindented row.
  const by = wanted.get(c.id);
  const mark = by
    ? `<span class="wsp-mark">▸</span>`
      + (selected.size > 1 ? `<span class="wsp-ord">${[...by].sort().join('')}</span>` : '')
    : '';
  return `<div class="wsp-row${c.live ? ' wsp-live' : ''}${by ? ' wsp-wanted' : ''}" style="padding-left:${indent * 14}px">`
    + `${mark}<span class="wsp-name">${esc(c.name)}</span>${qty}${state}${meter}${notes}`
    + actionStrip(c.actions) + `</div>`;
}

function section(label, bodyHtml, emptyText) {
  return `<div class="wsp-section">`
    + `<div class="wsp-rule"><span class="wsp-label">${esc(label)}</span></div>`
    + (bodyHtml || `<div class="wsp-row wsp-empty">${esc(emptyText)}</div>`)
    + `</div>`;
}

function renderArea(area) {
  if (!area.length) return '';
  return area.map(v => {
    // A vessel on the heat is the only thing on this panel that is moving, so
    // it is the only thing that gets a colour.
    const heat = v.heat ? `<span class="wsp-heat">burner ${esc(v.heat)}</span>` : '';
    const head = `<div class="wsp-row wsp-vessel${v.hot ? ' wsp-hot' : ''}${v.idle ? ' wsp-idle' : ''}">`
      + `<span class="wsp-name">${esc(v.name)}</span>`
      + `<span class="wsp-state"> — ${esc(v.place)}</span> ${heat}`
      + actionStrip(v.actions) + `</div>`;
    // A free burner is a place to put a pan, not a container: it has no inside,
    // so it gets no "empty" line under it. The row IS the whole statement.
    if (v.idle) return head;
    const inner = (v.contents || []).length
      ? v.contents.map(c => componentLine(c, 1)).join('')
      : `<div class="wsp-row wsp-empty" style="padding-left:14px">empty</div>`;
    return head + inner;
  }).join('');
}

// Everything highlighted that is currently sitting in a room container — i.e.
// the things you'd have to go and get. Nothing in your hands: pulling something
// you're already holding is not a step.
function wantedInStorage(data) {
  const out = [];
  for (const s of data?.storage || []) for (const i of s.items || []) if (wanted.has(i.id)) out.push(i.id);
  return out;
}

function renderStorage(storage) {
  if (!storage.length) return '';
  return storage.map(s => {
    const cold = s.preserves ? `<span class="wsp-cold">${esc(s.preserves)}</span>` : '';
    const head = `<div class="wsp-row wsp-vessel"><span class="wsp-name">${esc(s.name)}</span> ${cold}</div>`;
    const items = (s.items || []).map(c => componentLine(c, 1)).join('');
    // A count, never a list. The rest of what's in a fridge is not a
    // preparation component, and listing it would make this an inventory screen.
    const other = s.other > 0
      ? `<div class="wsp-row wsp-empty" style="padding-left:14px">+ ${s.other} other item${s.other === 1 ? '' : 's'}</div>`
      : '';
    return head + items + other;
  }).join('');
}

// The Recipe Assistant. A completion bar and the specific shortfall, because
// "74%" alone tells you nothing you can act on and "ricotta, lasagna sheets" is
// a shopping list.
//
// It shows only recipes you know. That isn't the panel being coy — it's the
// cookbook's rule, and the server decides it; this renders whatever came.
function renderAssistant(a) {
  if (!a) return '';
  const bar = (pct) => {
    const filled = Math.round(pct / 10);
    return `<span class="wsp-bar">${'█'.repeat(filled)}${'░'.repeat(10 - filled)}</span>`;
  };
  const rows = (a.groups || []).map(g =>
    `<div class="wsp-group">${esc(g.label)}</div>` + g.recipes.map(r => {
      const open = selected.has(r.key);
      // A missing spoon is the LAST thing said, and only when nothing else is
      // wrong: it doesn't stop the dish, so it must never displace the line about
      // what does.
      //
      // NOUNS COLLAPSED, ROWS WHEN OPEN. The whole ingredient sentence — weight,
      // knife work, and the author's note about cooking it down — used to be
      // joined with semicolons into one line that ran off the panel, which is a
      // paragraph where the Components list above it is a column. So the closed
      // row says only WHAT ("need tomato, cream"), and the shortfall opens into
      // rows that read the same way Components does.
      const nouns = (r.shortfall || []).map(s => s.noun);
      const need = r.equipment.length ? `needs ${esc(r.equipment.join(', '))}`
        : nouns.length ? `need ${esc(nouns.join(', '))}`
        : r.missing.length ? `need ${esc(r.missing.join('; '))}`
        : (r.kitSoft || []).length ? `ready — no ${esc(r.kitSoft.join(', '))}`
        : esc(r.suggestion || 'ready');
      // Click to read it. The method and the ingredient list are already in the
      // payload — the Cookbook app has always shown them, and the HUD was
      // throwing everything past the first line away.
      // Its ordinal, shown only when there is more than one open — that is the
      // key to the ▸1/▸12 markers scattered up the panel, and with one recipe
      // open there is nothing to key.
      const ord = (open && selected.size > 1) ? `<span class="wsp-mark wsp-ord">${ordinals.get(r.key)}</span>` : '';
      const head = `<div class="wsp-row wsp-recipe${open ? ' wsp-open' : ''}" data-recipe="${esc(r.key)}">`
        + `${ord}<span class="wsp-name">${esc(r.name)}</span>`
        + (r.band ? `<span class="wsp-note"> ${esc(r.band)}</span>` : '')
        + ` ${bar(r.pct)}<span class="wsp-qty"> ${r.pct}%</span>`
        + `<span class="wsp-state"> — ${need}</span>`
        + actionStrip(r.actions) + `</div>`;
      if (!open) return head;

      const body = [];
      // WHAT YOU HAVEN'T GOT, FIRST AND AS A LIST.
      //
      // The same shape as Components — noun in bright, everything after it dim —
      // because it is the same kind of statement asked the other way round: that
      // list is what's in your hands, this is what isn't. It goes above the full
      // ingredient list rather than inside it, so the two lines nobody has are
      // not four rows down a list of six they mostly do.
      body.push(...(r.shortfall || []).map(s => {
        const amount = s.amount ? `<span class="wsp-qty"> ${esc(s.amount)}</span>` : '';
        const prep = s.prep ? `<span class="wsp-note"> · ${esc(s.prep)}</span>` : '';
        // Alternatives, never a shopping list: any ONE of these answers the line,
        // which is exactly why they're an aside and not their own rows.
        const alt = (s.ex || []).length ? `<span class="wsp-state"> — ${esc(s.ex.join(' or '))}</span>` : '';
        // A shop you know, or the honest absence of one. `sold: false` is the
        // most useful answer on this line: nobody stocks it, so no amount of
        // walking will find it and you're catching, growing or looting it.
        const where = s.shops?.length ? `<span class="wsp-shop"> · ${esc(s.shops.join(', '))}</span>`
          : s.sold === false ? `<span class="wsp-shop wsp-nosale"> · no shop sells it</span>`
          : s.sold ? `<span class="wsp-shop wsp-dimshop"> · a shop you've not met</span>`
          : '';
        return `<div class="wsp-row wsp-step wsp-missing">`
          + `<span class="wsp-name">${esc(s.noun)}</span>${amount}${prep}${alt}${where}</div>`;
      }));
      if ((r.shortfall || []).length && (r.ingredients || []).length) {
        body.push(`<div class="wsp-row wsp-step"> </div>`);
      }
      for (const line of r.ingredients || []) body.push(`<div class="wsp-row wsp-step">· ${esc(line)}</div>`);
      // What it's made IN, ticked against the room — the same question the
      // ingredients above answer, asked of the cupboard instead of the fridge.
      for (const g of r.kit || []) {
        const mark = g.held ? '✓' : (g.req === 'required' ? '✗' : '·');
        body.push(`<div class="wsp-row wsp-step${g.held ? '' : ' wsp-short'}">${mark} ${esc(g.label)}</div>`);
      }
      if ((r.ingredients || []).length && (r.method || []).length) body.push(`<div class="wsp-row wsp-step"> </div>`);
      (r.method || []).forEach((line, i) => {
        // Deliberately NOT escaped: the method comes from the server's own
        // catalog and may carry a <b> around the verb it wants you to type.
        body.push(`<div class="wsp-row wsp-step">${i + 1}. ${line}</div>`);
      });
      if (wanted.size) {
        body.push(`<div class="wsp-row wsp-step wsp-mark-note">▸ marks what it would use, wherever it is${selected.size > 1 ? ` — numbered by recipe, so ▸${ordinals.get(r.key)} is this one` : ''}.</div>`);
      }
      return head + body.join('');
    }).join('')
  ).join('');
  const note = a.note ? `<div class="wsp-row wsp-empty">${esc(a.note)}</div>` : '';
  return rows + note;
}

// The room's own state — power, which stove, how hot it is in here. It lives in
// the HEADER rather than at the foot of the panel because it is the shortest
// section and the one most likely to change what you can do next: a dead ring or
// a cut supply belongs where you look first, not below a screenful of recipes.
function renderStatus(status) {
  if (!status.length) return '';
  return `<div class="wsp-status">` + status.map(s =>
    `<div class="wsp-stat"><span class="wsp-stat-label">${esc(s.label)}</span>`
    + `<span class="wsp-stat-val wsp-${esc(s.state || 'ok')}">${esc(s.value)}</span></div>`
  ).join('') + `</div>`;
}

// Selecting a recipe is a way of LOOKING at what you already have, so it costs
// no round trip — the payload already says which rows it would use.
const allRecipes = (data) => (data?.assistant?.groups || []).flatMap(g => g.recipes);

// Recompute the highlight from whatever is selected and still exists. A recipe
// that vanished between refreshes — you cooked it, you forgot it — must not
// leave a stale highlight behind.
function recomputeWanted(data) {
  const live = new Set(allRecipes(data).map(r => r.key));
  for (const k of [...selected]) if (!live.has(k)) selected.delete(k);
  // Ordinals follow the order you opened them in, not the order they happen to
  // be listed in — so opening a third recipe cannot renumber the two you are
  // already reading. A Set iterates in insertion order, which is exactly that.
  ordinals = new Map([...selected].map((k, i) => [k, i + 1]));
  wanted = new Map();
  for (const r of allRecipes(data)) {
    if (!selected.has(r.key)) continue;
    for (const id of r.uses || []) {
      if (!wanted.has(id)) wanted.set(id, new Set());
      wanted.get(id).add(ordinals.get(r.key));
    }
  }
}

function selectRecipe(key) {
  if (selected.has(key)) selected.delete(key); else selected.add(key);
  if (lastData) render(lastData);
}

function render(data) {
  lastData = data;
  recomputeWanted(data);
  scheduleTick(data);

  el('workspace-title').textContent = data.title || 'WORKSPACE';
  // A room can be two workspaces at once — a kitchen with a chem lab in the back
  // is the case this exists for. The server picks one by priority; this is how
  // you say you meant the other, and it's an ordinary `workspace <key>`.
  const others = (data.providers || []).filter(p => p.key !== data.provider);
  el('workspace-provider').innerHTML = others.length
    ? others.map(p => `<button class="wsp-act" data-cmd="workspace ${esc(p.key)}" title="workspace ${esc(p.key)}">${esc(p.key)}</button>`).join('')
    : (data.provider ? `[${esc(data.provider)}]` : '');

  const body = [];
  // One button for the whole highlighted shelf. It fires the same `pullid` the
  // per-row Take button does, once each — a convenience over existing verbs, not
  // a new mechanic, which is why it needs nothing on the server.
  const toPull = wantedInStorage(data);
  const pullAll = toPull.length
    ? `<div class="wsp-row wsp-pullall"><button class="wsp-act" id="wsp-take-marked">take the ${toPull.length} marked</button></div>`
    : '';
  body.push(section('Storage', renderStorage(data.storage || []) + pullAll, 'no storage in reach'));
  body.push(section('Preparation Area', renderArea(data.area || []), 'nothing out'));
  body.push(section('Components',
    (data.components || []).map(c => componentLine(c)).join(''), 'nothing to hand'));
  if ((data.tools || []).length) {
    body.push(section('Tools', data.tools.map(c => componentLine(c)).join(''), ''));
  }
  if (data.assistant) {
    body.push(section('Recipe Assistant', renderAssistant(data.assistant), 'nothing to suggest'));
  }

  el('workspace-body').innerHTML = body.join('');
  el('workspace-status').innerHTML = renderStatus(data.status || []);
}

// ── wiring ───────────────────────────────────────────────────────────────────

// Running an action IS typing it. `sendCmd` rather than `sendCmdSilent` so the
// command echoes into the log exactly as though the player had typed it — which
// is the whole teaching mechanism, and the reason this panel doesn't make the
// verbs redundant. The refresh behind it is silent; that one is plumbing.
function runAction(cmd) {
  if (cmd.endsWith(' ')) {
    // A partial command — the verb wants a second object we can't choose for
    // them. Hand them the line, don't guess.
    const input = document.getElementById('cmd-input');
    if (input) { input.value = cmd; input.focus(); }
    closeWorkspacePanel();
    return;
  }
  sendCmd(cmd);
  sendCmdSilent('workspace');
}

export function initWorkspacePanel() {
  el('workspace-close').addEventListener('click', closeWorkspacePanel);
  el('workspace-close-btn').addEventListener('click', closeWorkspacePanel);
  el('workspace-refresh').addEventListener('click', () => sendCmdSilent('workspace'));
  el('workspace-panel').addEventListener('click', (e) => {
    if (e.target.id === 'workspace-panel') closeWorkspacePanel();
  });
  // Delegated: the body is rewritten on every refresh, so per-button listeners
  // would leak one set per build.
  el('workspace-body').addEventListener('click', (e) => {
    if (e.target.id === 'wsp-take-marked') {
      for (const id of wantedInStorage(lastData)) sendCmd(`pullid ${id}`);
      sendCmdSilent('workspace');
      return;
    }
    const btn = e.target.closest('.wsp-act');
    if (btn) { runAction(btn.getAttribute('data-cmd')); return; }
    const recipe = e.target.closest('[data-recipe]');
    if (recipe) selectRecipe(recipe.getAttribute('data-recipe'));
  });
  // The provider switcher lives in the header, and is the same kind of button.
  el('workspace-provider').addEventListener('click', (e) => {
    const btn = e.target.closest('.wsp-act');
    if (btn) sendCmdSilent(btn.getAttribute('data-cmd'));
  });
  // Escape closes, the way every other overlay in the game does. Bound once at
  // init and gated on `active` rather than added and removed per open, so a
  // panel that somehow fails to close can't leave a listener behind.
  document.addEventListener('keydown', (e) => {
    if (active && e.key === 'Escape') { e.stopPropagation(); closeWorkspacePanel(); }
  });
}
